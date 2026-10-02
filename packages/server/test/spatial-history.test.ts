/**
 * Spatial history and episode reopen.
 *
 * Both are READ models added in Phase 1A, and both exist for the same reason:
 * without them the browser has to re-derive things the server already knows, and
 * a client that re-derives eventually disagrees with the server.
 *
 * The spatial model in particular exists so the client never scans every episode
 * to work out where this person's body has been sore. A test asserts the episode
 * metadata comes back in the payload, because a count without the episodes behind
 * it just moves the scanning somewhere else.
 *
 * It is also a LOCATION history, not a risk map, and one test pins that: the
 * payload must not contain anything that invites reading frequency as severity.
 */
import { test, after } from 'node:test';
import assert from 'node:assert/strict';
import { spawn, type ChildProcess } from 'node:child_process';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { writablePaths } from '@asi/shared';

const here = fileURLToPath(new URL('.', import.meta.url));
const serverDir = resolve(here, '..');
const entry = join(serverDir, 'src/index.ts');

const dir = mkdtempSync(join(tmpdir(), 'asi-spatial-'));
const dbPath = join(dir, 'spatial.sqlite');
import { createServer } from 'node:net';

/**
 * A free port for this test run.
 *
 * Asked of the OS rather than hardcoded: a fixed port is not safe, only familiar. This
 * machine had unrelated `python3 -m http.server` processes on 8788-8791, and the server
 * under test could not bind -- so the test polled a health check that could never pass and
 * reported a 501 from somebody else's server as if it were an API failure.
 */
const PORT = Number(process.env.ASI_TEST_PORT ?? 0) || (await freePort());

function freePort(): Promise<number> {
  return new Promise((resolve, reject) => {
    const probe = createServer();
    probe.once('error', reject);
    probe.listen(0, '127.0.0.1', () => {
      const address = probe.address();
      if (address === null || typeof address === 'string') {
        probe.close(() => reject(new Error('could not determine a free port')));
        return;
      }
      const { port } = address;
      probe.close(() => resolve(port));
    });
  });
}
const BASE = `http://127.0.0.1:${PORT}`;

interface SpatialNode {
  regionRowId: string;
  region: string;
  side: string;
  subRegionId: string | null;
  point: { x: number; y: number } | null;
  episodeCount: number;
  lastEpisodeAt: string | null;
  lastTitle: string | null;
  episodes: {
    id: string;
    startedAt: string;
    status: string;
    title: string;
    point: { x: number; y: number } | null;
    safetyFlagCount: number;
    visualSelections: string[];
  }[];
}

interface ReopenOut {
  episode: { id: string; record: { location: { region: string } } };
  nextQuestion: { id: string } | null;
  progress: { total: number; answered: number; outstanding: string[] };
  outstandingFields: string[];
  interviewable: boolean;
  answers: Record<string, { triState: string }>;
}

let child: ChildProcess | null = null;

async function waitForHealth(timeoutMs = 30_000): Promise<void> {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    try { if ((await fetch(`${BASE}/api/health`)).ok) return; } catch { /* not up */ }
    await new Promise((r) => setTimeout(r, 150));
  }
  throw new Error('server did not become healthy');
}

async function startServer(): Promise<void> {
  child = spawn(process.execPath, ['--experimental-strip-types', '--no-warnings', entry], {
    cwd: serverDir,
    env: { ...process.env, ASI_DB_PATH: dbPath, ASI_PORT: String(PORT), ASI_RELEASE_PROFILE: 'development', ANTHROPIC_API_KEY: '' },
    stdio: ['ignore', 'pipe', 'pipe'],
  });
  child.stdout?.on('data', () => {});
  child.stderr?.on('data', () => {});
  await waitForHealth();
}

async function stopServer(): Promise<void> {
  const c = child;
  child = null;
  if (!c || c.exitCode !== null) return;
  const done = new Promise<void>((res) => c.once('exit', () => res()));
  c.kill('SIGKILL');
  await done;
}

async function req<T>(method: string, path: string, body?: unknown): Promise<{ status: number; body: T }> {
  const r = await fetch(`${BASE}${path}`, {
    method,
    headers: body ? { 'content-type': 'application/json' } : undefined,
    body: body ? JSON.stringify(body) : undefined,
  });
  const text = await r.text();
  return { status: r.status, body: JSON.parse(text) as T };
}
const post = <T>(p: string, b: unknown) => req<T>('POST', p, b);
const get = <T>(p: string) => req<T>('GET', p);

after(async () => {
  await stopServer();
  rmSync(dir, { recursive: true, force: true });
});

/* ================================================================== */

const PROV = { sourceType: 'user_statement', verificationStatus: 'user_confirmed', createdBy: 'user' } as const;

async function makeEpisode(
  personId: string,
  region: string,
  side: string,
  phrase: string,
  point: { x: number; y: number } | null,
  selections: string[] = [],
  subRegionId?: string,
): Promise<string> {
  const mutations: Record<string, unknown>[] = [
    { fieldPath: 'location.userPhrase', value: phrase, provenance: PROV },
  ];
  if (subRegionId) {
    mutations.push({
      fieldPath: 'location.subRegionId',
      value: subRegionId,
      provenance: { sourceType: 'user_selection', verificationStatus: 'user_confirmed', createdBy: 'user' },
    });
  }
  if (point) {
    // A pin dropped on the body map is a user selection, not a statement. The
    // field registry says so, and getting this wrong is a 422 rather than a
    // silently accepted write.
    mutations.push({
      fieldPath: 'location.point',
      value: point,
      provenance: { sourceType: 'user_selection', verificationStatus: 'user_confirmed', createdBy: 'user' },
    });
  }
  if (selections.length) {
    mutations.push({
      fieldPath: 'location.userSelectedStructureIds',
      value: selections,
      provenance: { sourceType: 'user_selection', verificationStatus: 'user_confirmed', createdBy: 'user' },
    });
    mutations.push({
      fieldPath: 'consideredStructures',
      value: selections.map((id) => ({ structureId: id, rationale: 'Because.', confidence: 0.5, selectedByUser: false })),
      provenance: { sourceType: 'ai_inference', verificationStatus: 'unverified', createdBy: 'model', confidence: 0.5 },
    });
  }
  const r = await post<{ id: string }>('/api/episodes', {
    personId,
    displayName: 'Spatial Tester',
    title: phrase,
    grounding: { status: 'grounded', region, side, by: 'deterministic' },
    mutations,
  });
  assert.equal(r.status, 201, JSON.stringify(r.body));
  return r.body.id;
}

test('the spatial history returns a place, a point and the episodes behind it', async () => {
  await startServer();
  const id = await makeEpisode('sp', 'knee', 'left', 'left knee after a walk', { x: 0.42, y: 0.77 }, ['asi:knee.patella']);

  const res = await get<SpatialNode[]>('/api/healthmap/sp/spatial');
  assert.equal(res.status, 200);
  const kneeLeft = res.body.find((n) => n.region === 'knee' && n.side === 'left');
  assert.ok(kneeLeft, 'the knee place is missing from the spatial history');
  assert.equal(kneeLeft.episodeCount, 1);
  assert.deepEqual(kneeLeft.point, { x: 0.42, y: 0.77 });
  assert.equal(kneeLeft.lastTitle, 'left knee after a walk');
  assert.ok(kneeLeft.lastEpisodeAt, 'no last-episode timestamp');

  // The episodes must be IN the payload, not just counted. Otherwise the client
  // is still scanning, which is the thing this model exists to stop.
  assert.equal(kneeLeft.episodes.length, 1);
  assert.equal(kneeLeft.episodes[0]!.id, id);
  assert.equal(kneeLeft.episodes[0]!.title, 'left knee after a walk');
  // Visual selections come back as labels, and they are location not findings.
  assert.deepEqual(kneeLeft.episodes[0]!.visualSelections, ['Patella']);
});

test('side and region are separate places, and they accumulate independently', async () => {
  await makeEpisode('sp', 'knee', 'right', 'right knee now', { x: 0.58, y: 0.77 });
  const res = await get<SpatialNode[]>('/api/healthmap/sp/spatial');
  const kneeRows = res.body.filter((n) => n.region === 'knee');
  assert.equal(kneeRows.length, 2, 'left and right knee were collapsed into one place');
  assert.equal(kneeRows.reduce((a, n) => a + n.episodeCount, 0), 2);
  // A new place sorts ahead of nothing in particular, but the newest is findable.
  const right = kneeRows.find((n) => n.side === 'right');
  assert.equal(right?.episodeCount, 1);
  assert.ok(right!.lastEpisodeAt! >= kneeRows.find((n) => n.side === 'left')!.lastEpisodeAt!);
});

test('every V1 region comes back, so the client can draw a whole body', async () => {
  const res = await get<SpatialNode[]>('/api/healthmap/sp/spatial');
  for (const region of ['shoulder', 'neck', 'lower_back', 'knee']) {
    assert.ok(res.body.some((n) => n.region === region), `region ${region} missing entirely`);
  }
  // A region with nothing in it is present and explicitly empty, not absent.
  const neck = res.body.find((n) => n.region === 'neck' && n.side === 'left');
  assert.ok(neck, 'an empty neck place is missing');
  assert.equal(neck!.episodeCount, 0);
  assert.equal(neck!.point, null);
  assert.deepEqual(neck!.episodes, []);
});

test('the count is the true total, not the length of the truncated list', async () => {
  const many = await Promise.all(
    Array.from({ length: 5 }, (_, i) => makeEpisode('bulk', 'shoulder', 'left', `shoulder episode ${i}`, null)),
  );
  assert.equal(many.length, 5);
  const res = await get<SpatialNode[]>('/api/healthmap/bulk/spatial?limit=2');
  const place = res.body.find((n) => n.region === 'shoulder' && n.side === 'left');
  assert.equal(place?.episodeCount, 5, 'the count was truncated with the list');
  assert.equal(place?.episodes.length, 2, 'the per-place limit was not applied');
});

test('a place with no pin reports a null point rather than a fake one', async () => {
  await makeEpisode('nopin', 'neck', 'right', 'neck ache', null);
  const res = await get<SpatialNode[]>('/api/healthmap/nopin/spatial');
  const place = res.body.find((n) => n.region === 'neck' && n.side === 'right');
  assert.equal(place?.point, null, 'a place with no pin reported a point');
  assert.equal(place?.episodeCount, 1);
});

test('the spatial payload is a location history, not a risk score', async () => {
  // Frequency is how OFTEN a place was described. Nothing here may invite reading
  // it as severity, which is the failure mode a body heatmap invites.
  const res = await get<SpatialNode[]>('/api/healthmap/sp/spatial');
  const text = JSON.stringify(res.body).toLowerCase();
  for (const forbidden of ['risk', 'severity', 'score', 'danger', 'risklevel', 'diagnosis', 'condition']) {
    assert.equal(text.includes(forbidden), false, `the spatial payload contains "${forbidden}"`);
  }
  // The field is named for what it is.
  assert.ok('episodeCount' in res.body[0]!, 'the count should be named episodeCount');
});

test('people do not see each other history', async () => {
  await makeEpisode('personA', 'knee', 'left', 'person A knee', null);
  const other = await get<SpatialNode[]>('/api/healthmap/personB/spatial');
  assert.equal(other.body.filter((n) => n.episodeCount > 0).length, 0, 'one person saw another history');
});

/* ================================================================== */
/* Place identity                                                      */
/* ================================================================== */

/**
 * A place is (person, region, side, sub-region, cell), where the cell is the
 * normalised pin quantised onto a 0.05 grid. Region/side/sub-region alone are not
 * enough: the same shoulder sore in two clearly different places is two entries
 * in a body history.
 *
 * Each test below is one of the two failure modes the earlier design allowed, or
 * a consequence of fixing them.
 */

test('the same region/side/sub-region twice aggregates into ONE place', async () => {
  await makeEpisode('agg', 'knee', 'left', 'first knee episode', null, [], 'knee.anterior');
  await makeEpisode('agg', 'knee', 'left', 'second knee episode', null, [], 'knee.anterior');

  const res = await get<SpatialNode[]>('/api/healthmap/agg/spatial');
  const rows = res.body.filter((n) => n.region === 'knee' && n.episodeCount > 0);
  assert.equal(rows.length, 1, 'one place was split into two rows');
  assert.equal(rows[0]!.episodeCount, 2, 'the two episodes were not aggregated');
  // The count must equal the episodes actually listed, or the client cannot trust it.
  assert.equal(rows[0]!.episodes.length, 2);
  assert.equal(new Set(rows[0]!.episodes.map((e) => e.id)).size, 2, 'the same episode was listed twice');
  assert.equal(rows[0]!.subRegionId, 'knee.anterior');
});

test('two different pins in the same sub-region are TWO places and cannot overwrite', async () => {
  await makeEpisode('pins', 'shoulder', 'left', 'front of shoulder', { x: 0.10, y: 0.20 }, [], 'shoulder.anterior');
  await makeEpisode('pins', 'shoulder', 'left', 'back of shoulder', { x: 0.85, y: 0.55 }, [], 'shoulder.anterior');

  const res = await get<SpatialNode[]>('/api/healthmap/pins/spatial');
  const rows = res.body.filter((n) => n.region === 'shoulder' && n.episodeCount > 0);
  assert.equal(rows.length, 2, 'two clearly different pins were merged into one place');
  for (const r of rows) assert.equal(r.episodeCount, 1);
  // Neither pin may be the other's.
  const points = rows.map((r) => r.point).sort((a, b) => a!.x - b!.x);
  assert.ok(Math.abs(points[0]!.x - 0.10) < 0.02, `first pin lost: ${JSON.stringify(points[0])}`);
  assert.ok(Math.abs(points[1]!.x - 0.85) < 0.02, `second pin lost: ${JSON.stringify(points[1])}`);
});

test('pins within the same cell aggregate, and the rule is the documented one', async () => {
  // 0.05 grid: these two are 0.01 apart, so they are the same cell.
  await makeEpisode('near', 'knee', 'right', 'pin a', { x: 0.500, y: 0.500 }, [], 'knee.anterior');
  await makeEpisode('near', 'knee', 'right', 'pin b', { x: 0.510, y: 0.505 }, [], 'knee.anterior');

  const res = await get<SpatialNode[]>('/api/healthmap/near/spatial');
  const rows = res.body.filter((n) => n.region === 'knee' && n.episodeCount > 0);
  assert.equal(rows.length, 1, 'two pins in the same cell should aggregate');
  assert.equal(rows[0]!.episodeCount, 2);

  // Straddling a cell boundary must NOT aggregate. That is the same rule seen
  // from the other side: 0.499 and 0.501 are 0.002 apart and still two places.
  await makeEpisode('straddle', 'knee', 'right', 'below', { x: 0.499, y: 0.500 }, [], 'knee.anterior');
  await makeEpisode('straddle', 'knee', 'right', 'above', { x: 0.501, y: 0.500 }, [], 'knee.anterior');
  const s = await get<SpatialNode[]>('/api/healthmap/straddle/spatial');
  assert.equal(
    s.body.filter((n) => n.region === 'knee' && n.episodeCount > 0).length,
    2,
    'pins either side of a cell boundary were merged',
  );
});

test('an identical pin in two episodes aggregates to a count of two', async () => {
  await makeEpisode('same', 'knee', 'left', 'one', { x: 0.42, y: 0.77 }, [], 'knee.anterior');
  await makeEpisode('same', 'knee', 'left', 'two', { x: 0.42, y: 0.77 }, [], 'knee.anterior');

  const res = await get<SpatialNode[]>('/api/healthmap/same/spatial');
  const rows = res.body.filter((n) => n.region === 'knee' && n.episodeCount > 0);
  assert.equal(rows.length, 1);
  assert.equal(rows[0]!.episodeCount, 2);
  assert.equal(rows[0]!.episodes.length, 2);
});

test('moving an episode re-homes it: the old place stops counting it', async () => {
  const id = await makeEpisode('move', 'shoulder', 'left', 'starts at the front', { x: 0.10, y: 0.20 }, [], 'shoulder.anterior');

  const before = await get<SpatialNode[]>('/api/healthmap/move/spatial');
  assert.equal(before.body.filter((n) => n.region === 'shoulder' && n.episodeCount > 0).length, 1);

  // The user moves the pin to the back of the same shoulder.
  const moved = await post(`/api/episodes/${id}/mutations`, {
    mutations: [{
      fieldPath: 'location.point',
      value: { x: 0.85, y: 0.55 },
      provenance: { sourceType: 'user_selection', verificationStatus: 'user_confirmed', createdBy: 'user' },
    }],
  });
  assert.equal(moved.status, 200, JSON.stringify(moved.body));

  const after = await get<SpatialNode[]>('/api/healthmap/move/spatial');
  const rows = after.body.filter((n) => n.region === 'shoulder' && n.episodeCount > 0);
  // One place, because the only episode moved rather than being duplicated.
  assert.equal(rows.length, 1, 'moving an episode left a stale place behind');
  assert.equal(rows[0]!.episodeCount, 1, 'the old place still counts a location that is no longer there');
  assert.ok(Math.abs(rows[0]!.point!.x - 0.85) < 0.02, `the place did not follow the episode: ${JSON.stringify(rows[0]!.point)}`);
  // And it is the same episode, not a new one.
  assert.equal(rows[0]!.episodes[0]!.id, id);
});

test('moving an episode to a different sub-region also re-homes it', async () => {
  const id = await makeEpisode('submove', 'shoulder', 'left', 'starts anterior', { x: 0.50, y: 0.50 }, [], 'shoulder.anterior');
  const before = await get<SpatialNode[]>('/api/healthmap/submove/spatial');
  assert.equal(before.body.filter((n) => n.episodeCount > 0).length, 1);
  assert.equal(before.body.find((n) => n.episodeCount > 0)!.subRegionId, 'shoulder.anterior');

  const moved = await post(`/api/episodes/${id}/mutations`, {
    mutations: [{
      fieldPath: 'location.subRegionId',
      value: 'shoulder.posterior',
      provenance: { sourceType: 'user_selection', verificationStatus: 'user_confirmed', createdBy: 'user' },
    }],
  });
  assert.equal(moved.status, 200, JSON.stringify(moved.body));

  const after = await get<SpatialNode[]>('/api/healthmap/submove/spatial');
  const rows = after.body.filter((n) => n.episodeCount > 0);
  assert.equal(rows.length, 1, 'the place did not follow the sub-region');
  assert.equal(rows[0]!.subRegionId, 'shoulder.posterior');
  assert.equal(rows[0]!.episodeCount, 1);
});

test('one episode\'s pin never changes because another episode was added', async () => {
  await makeEpisode('stable', 'knee', 'left', 'first', { x: 0.20, y: 0.20 }, [], 'knee.anterior');
  const first = await get<SpatialNode[]>('/api/healthmap/stable/spatial');
  const beforePlace = first.body.find((n) => n.region === 'knee' && n.episodeCount > 0)!;

  // A second episode, somewhere else entirely.
  await makeEpisode('stable', 'knee', 'left', 'second', { x: 0.80, y: 0.80 }, [], 'knee.anterior');

  const after = await get<SpatialNode[]>('/api/healthmap/stable/spatial');
  const places = after.body.filter((n) => n.region === 'knee' && n.episodeCount > 0);
  assert.equal(places.length, 2);

  // The first place must still be exactly where it was, with the same pin.
  const original = places.find((p) => p.point && Math.abs(p.point.x - 0.20) < 0.02)!;
  assert.ok(original, 'the original place moved or was absorbed');
  assert.equal(original.episodeCount, 1, 'the second episode was aggregated into the first place');
  assert.ok(Math.abs(original.point!.x - beforePlace.point!.x) < 1e-9, 'the first place pin changed');
  assert.ok(Math.abs(original.point!.y - beforePlace.point!.y) < 1e-9, 'the first place pin changed');
});

test('aggregation survives a restart unchanged', async () => {
  await makeEpisode('restart', 'shoulder', 'left', 'front', { x: 0.10, y: 0.20 }, [], 'shoulder.anterior');
  await makeEpisode('restart', 'shoulder', 'left', 'front again', { x: 0.10, y: 0.20 }, [], 'shoulder.anterior');
  await makeEpisode('restart', 'shoulder', 'left', 'back', { x: 0.85, y: 0.55 }, [], 'shoulder.anterior');

  const before = await get<SpatialNode[]>('/api/healthmap/restart/spatial');
  const beforeRows = before.body.filter((n) => n.region === 'shoulder' && n.episodeCount > 0);
  assert.equal(beforeRows.length, 2);
  assert.deepEqual(beforeRows.map((r) => r.episodeCount).sort(), [1, 2]);

  await stopServer();
  await startServer();

  const after = await get<SpatialNode[]>('/api/healthmap/restart/spatial');
  const afterRows = after.body.filter((n) => n.region === 'shoulder' && n.episodeCount > 0);
  assert.equal(afterRows.length, 2, 'the number of places changed across a restart');
  assert.deepEqual(afterRows.map((r) => r.episodeCount).sort(), [1, 2], 'counts drifted across a restart');
  // Every count must equal the episodes listed under it.
  for (const r of afterRows) {
    assert.equal(r.episodeCount, r.episodes.length, 'a count did not match its episode list');
    assert.equal(new Set(r.episodes.map((e) => e.id)).size, r.episodes.length, 'duplicate episode in a place');
  }
  assert.deepEqual(
    afterRows.map((r) => r.episodes.map((e) => e.id).sort()).sort(),
    beforeRows.map((r) => r.episodes.map((e) => e.id).sort()).sort(),
    'the membership of a place changed across a restart',
  );
});

test('a place with no episodes does not exist', async () => {
  const id = await makeEpisode('gc', 'neck', 'left', 'neck thing', { x: 0.40, y: 0.30 }, [], 'neck.lateral');
  const moved = await post(`/api/episodes/${id}/mutations`, {
    mutations: [{
      fieldPath: 'location.point',
      value: { x: 0.60, y: 0.30 },
      provenance: { sourceType: 'user_selection', verificationStatus: 'user_confirmed', createdBy: 'user' },
    }],
  });
  assert.equal(moved.status, 200);

  const res = await get<SpatialNode[]>('/api/healthmap/gc/spatial');
  const rows = res.body.filter((n) => n.episodeCount > 0);
  assert.equal(rows.length, 1, 'an emptied place was left behind');
  assert.equal(rows[0]!.episodes.length, 1);
});

test('the episode list and the count agree in every place, always', async () => {
  await makeEpisode('agree', 'knee', 'left', 'a', { x: 0.30, y: 0.30 }, [], 'knee.anterior');
  await makeEpisode('agree', 'knee', 'left', 'b', { x: 0.30, y: 0.30 }, [], 'knee.anterior');
  await makeEpisode('agree', 'knee', 'right', 'c', { x: 0.70, y: 0.30 }, [], 'knee.anterior');

  const res = await get<SpatialNode[]>('/api/healthmap/agree/spatial');
  const allIds = new Set<string>();
  let summed = 0;
  for (const n of res.body) {
    assert.equal(n.episodeCount, n.episodes.length, `count ${n.episodeCount} != listed ${n.episodes.length} at ${n.region}/${n.side}`);
    summed += n.episodeCount;
    for (const e of n.episodes) {
      assert.equal(allIds.has(e.id), false, `episode ${e.id} appears in two places`);
      allIds.add(e.id);
    }
  }
  assert.equal(summed, 3, 'the places do not account for every episode');
});

test('each episode reports its OWN pin, distinct from the place aggregate', async () => {
  // Two episodes in one cell, a little apart. The place point is their mean; each
  // episode must still report where it was actually described, or a client would
  // attribute both to the same spot.
  await makeEpisode('own', 'knee', 'left', 'lower pin', { x: 0.50, y: 0.50 }, [], 'knee.anterior');
  await makeEpisode('own', 'knee', 'left', 'upper pin', { x: 0.54, y: 0.54 }, [], 'knee.anterior');

  const res = await get<SpatialNode[]>('/api/healthmap/own/spatial');
  const place = res.body.find((n) => n.region === 'knee' && n.episodeCount > 0)!;
  assert.equal(place.episodes.length, 2);
  const xs = place.episodes.map((e) => e.point!.x).sort();
  assert.deepEqual(xs, [0.5, 0.54], 'episodes did not each report their own pin');
  // The aggregate is between them, not equal to either.
  assert.ok(place.point!.x > 0.5 && place.point!.x < 0.54, `aggregate should be a mean: ${place.point!.x}`);
});

/* ================================================================== */
/* Episode reopen                                                      */
/* ================================================================== */

test('reopening an episode returns where the user had got to', async () => {
  const id = await makeEpisode('re', 'knee', 'left', 'knee thing', null);
  const before = await get<ReopenOut>(`/api/episodes/${id}/reopen`);
  assert.equal(before.status, 200);
  assert.equal(before.body.episode.id, id);
  assert.equal(before.body.interviewable, true);
  // Nothing answered yet, so there is a next question and progress is at zero.
  assert.ok(before.body.nextQuestion, 'a fresh episode should have a next question');
  assert.equal(before.body.progress.answered, 0);
  assert.ok(before.body.progress.total > 0);

  await post(`/api/episodes/${id}/mutations`, {
    answers: [{ questionId: before.body.nextQuestion!.id, raw: 'yes', createdBy: 'user' }],
  });

  const after = await get<ReopenOut>(`/api/episodes/${id}/reopen`);
  assert.equal(after.status, 200);
  assert.equal(after.body.progress.answered, 1, 'progress did not advance after answering');
  // And the next question moved on rather than repeating.
  assert.notEqual(after.body.nextQuestion?.id, before.body.nextQuestion?.id);
  // The answer is here, so a resuming session does not refetch to find it.
  assert.ok(after.body.answers[before.body.nextQuestion!.id], 'the answer is missing from the reopen payload');
});

test('reopening reports what is still outstanding, from the field store', async () => {
  const id = await makeEpisode('out', 'shoulder', 'left', 'shoulder thing', null);
  const r = await get<ReopenOut>(`/api/episodes/${id}/reopen`);
  assert.ok(r.body.outstandingFields.length > 0, 'a nearly-empty record should have outstanding fields');
  // Outstanding means no stored value. Every entry must be a path the registry
  // actually knows how to write, or a client would offer to ask for a field that
  // cannot be stored. Not all paths are dotted: `quality` and
  // `consideredStructures` are top level.
  const writable = new Set(writablePaths());
  for (const p of r.body.outstandingFields) {
    assert.ok(writable.has(p), `outstanding field is not a writable registry path: ${p}`);
  }
});

test('reopening an episode that does not exist is a 404, not a crash', async () => {
  const r = await get(`/api/episodes/does-not-exist/reopen`);
  assert.equal(r.status, 404);
});

test('a saved episode can be reopened and then continued', async () => {
  // The full user journey the lifecycle has to support: create, answer, close,
  // reopen, keep going. If reopening lost the answers this would be impossible.
  const id = await makeEpisode('journey', 'lower_back', 'left', 'back thing', { x: 0.5, y: 0.4 });
  const first = await get<ReopenOut>(`/api/episodes/${id}/reopen`);
  const q1 = first.body.nextQuestion!.id;
  await post(`/api/episodes/${id}/mutations`, {
    answers: [{ questionId: q1, raw: 'no', createdBy: 'user' }],
  });

  await stopServer();
  await startServer();

  const resumed = await get<ReopenOut>(`/api/episodes/${id}/reopen`);
  assert.equal(resumed.status, 200);
  assert.equal(resumed.body.answers[q1]?.triState, 'no', 'the answer was lost across a restart');
  assert.equal(resumed.body.progress.answered, 1);

  // Carry on from where it stopped, which is the point of the whole model.
  const q2 = resumed.body.nextQuestion?.id;
  assert.ok(q2, 'no next question after resuming');
  const continued = await post(`/api/episodes/${id}/mutations`, {
    answers: [{ questionId: q2, raw: false, createdBy: 'user' }],
  });
  assert.equal(continued.status, 200);

  const after = await get<ReopenOut>(`/api/episodes/${id}/reopen`);
  assert.equal(after.body.progress.answered, 2);

  // And the place is now on the map.
  const map = await get<SpatialNode[]>('/api/healthmap/journey/spatial');
  const place = map.body.find((n) => n.region === 'lower_back' && n.side === 'left');
  assert.equal(place?.episodeCount, 1);
  assert.deepEqual(place?.point, { x: 0.5, y: 0.4 });
});
