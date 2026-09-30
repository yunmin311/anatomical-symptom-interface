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
const PORT = 8793;
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
): Promise<string> {
  const mutations: Record<string, unknown>[] = [
    { fieldPath: 'location.userPhrase', value: phrase, provenance: PROV },
  ];
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
