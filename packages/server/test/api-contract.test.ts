/**
 * The V1 transport contract, at the HTTP surface.
 *
 * These are the tests that keep the API from quietly becoming two APIs. Each one asserts a
 * property an external client -- and specifically the MCP server -- depends on:
 *
 *   - every refusal carries a STABLE code, not a sentence to be parsed
 *   - anatomy capability reports what the renderer can actually mount, including the
 *     regions where the honest answer is "no 3D"
 *   - a retired canonical id comes back canonical
 *   - answer correction is expressed, and is decided by the server
 */
import { test, after, before } from 'node:test';
import assert from 'node:assert/strict';
import { spawn, type ChildProcess } from 'node:child_process';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { AnatomyCapabilitySchema, ApiErrorSchema } from '@asi/shared';

const here = fileURLToPath(new URL('.', import.meta.url));
const serverDir = resolve(here, '..');
const entry = join(serverDir, 'src/index.ts');

const dir = mkdtempSync(join(tmpdir(), 'asi-api-'));
const dbPath = join(dir, 'api.sqlite');
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

let child: ChildProcess | undefined;

before(async () => {
  child = spawn(process.execPath, [entry], {
    env: { ...process.env, ASI_DB_PATH: dbPath, PORT: String(PORT), ASI_PORT: String(PORT) },
    stdio: ['ignore', 'pipe', 'pipe'],
  });
  const deadline = Date.now() + 30_000;
  while (Date.now() < deadline) {
    try {
      const r = await fetch(`${BASE}/api/health`);
      if (r.ok) return;
    } catch {
      /* not up yet */
    }
    await new Promise((r) => setTimeout(r, 250));
  }
  throw new Error('the API never became ready');
});

after(() => {
  child?.kill();
  rmSync(dir, { recursive: true, force: true });
});

const post = (path: string, body: unknown) =>
  fetch(`${BASE}${path}`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(body),
  });

test('every refusal carries a stable, machine-readable code', async () => {
  const cases: [string, Promise<Response>][] = [
    ['unknown episode read', fetch(`${BASE}/api/episodes/does-not-exist`)],
    ['unknown episode summary', fetch(`${BASE}/api/episodes/does-not-exist/summary`)],
    ['unknown episode reopen', fetch(`${BASE}/api/episodes/does-not-exist/reopen`)],
    ['unknown region', fetch(`${BASE}/api/regions/pancreas`)],
    ['unknown interview region', fetch(`${BASE}/api/interview/pancreas`)],
    [
      'malformed mutation body',
      post('/api/episodes/does-not-exist/mutations', { mutations: [{ fieldPath: 7 }] }),
    ],
  ];

  for (const [label, response] of cases) {
    const r = await response;
    assert.equal(r.status >= 400, true, `${label} did not fail`);
    const body = ApiErrorSchema.safeParse(await r.json());
    assert.equal(
      body.success,
      true,
      `${label} returned an error body that does not match the contract: ${JSON.stringify(body)}`,
    );
    // The code is the contract. The message is for a person, so it must exist and must not
    // BE the code.
    //
    // `if (!body.success) return;` was here, and it was the shape of a gate that quietly
    // stops covering: if the FIRST envelope stopped matching, the remaining five cases were
    // never exercised and the test was green. It only stayed unreachable because the
    // assertion three lines up threw first -- i.e. the loop's safety depended on a line a
    // future edit could weaken. `if (!body.success) continue;` keeps every case running.
    if (!body.success) continue;
    assert.ok(body.data.message.length > 0, `${label} has no human message`);
    assert.notEqual(body.data.message, body.data.error, `${label} put the code in the message`);
  }
});

test('a missing episode is episode_not_found specifically, not a generic 404', async () => {
  // The code is what a client branches on. "not_found" for everything would make a
  // missing episode and a missing region indistinguishable to a caller that wants to
  // retry one and report the other.
  const episode = ApiErrorSchema.parse(await (await fetch(`${BASE}/api/episodes/does-not-exist`)).json());
  assert.equal(episode.error, 'episode_not_found');

  const region = ApiErrorSchema.parse(await (await fetch(`${BASE}/api/regions/pancreas`)).json());
  assert.equal(region.error, 'unknown_region');
  assert.equal(region.region, 'pancreas', 'the refusal does not say which region was asked for');
});

test('anatomy capability matches what the renderer can actually mount', async () => {
  const r = await fetch(`${BASE}/api/anatomy/capability`);
  assert.equal(r.status, 200);
  const parsed = AnatomyCapabilitySchema.safeParse(await r.json());
  assert.equal(parsed.success, true, `capability failed its own schema: ${JSON.stringify(parsed.error)}`);
  if (!parsed.success) return;
  const capability = parsed.data;

  assert.equal(capability.regions.length, 4, 'a region is missing from the capability report');

  // Real counts, not intent. A region that has a build reports real mesh counts; one
  // that does not reports a refusal with a reason.
  const neck = capability.regions.find((x) => x.region === 'neck')!;
  const neckLeft = neck.sides.find((s) => s.side === 'left')!;
  assert.equal(neckLeft.available, true);
  assert.equal(neckLeft.threeD.available, true);
  if (neckLeft.threeD.available) {
    assert.ok(neckLeft.threeD.meshes > 0, 'the left neck claims availability with zero meshes');
    assert.ok(neckLeft.threeD.triangles > 0);
    assert.equal(neckLeft.threeD.licence, 'CC-BY-4.0');
  }

  // Midline where the source has it.
  const neckMidline = neck.sides.find((s) => s.side === 'midline')!;
  assert.equal(neckMidline.available, true, 'the neck has real midline geometry but reports none');
  const lumbar = capability.regions.find((x) => x.region === 'lower_back')!;
  assert.equal(
    lumbar.sides.find((s) => s.side === 'midline')!.available,
    true,
    'the lumbar spine and sacrum are midline but are reported unavailable',
  );

  // Midline where the source does NOT have it: a refusal with the reason attached.
  for (const region of ['shoulder', 'knee'] as const) {
    const entry = capability.regions.find((x) => x.region === region)!;
    const midline = entry.sides.find((s) => s.side === 'midline')!;
    assert.equal(midline.available, false, `${region} claims midline geometry it does not have`);
    if (!midline.threeD.available)
      assert.match(midline.threeD.reason, /per side/i, `${region} midline gives no reason`);
  }

  // Bilateral is never a build. Saying otherwise would invite a client to ask for a
  // mirrored scene.
  for (const entry of capability.regions) {
    const bilateral = entry.sides.find((s) => s.side === 'bilateral')!;
    assert.equal(bilateral.available, false, `${entry.region} claims a bilateral build`);
  }
});

test('capability reports the source gaps instead of pretending they do not exist', async () => {
  const r = await fetch(`${BASE}/api/anatomy/capability`);
  const capability = AnatomyCapabilitySchema.parse(await r.json());

  const totalUnavailable = capability.regions.reduce((n, x) => n + x.unavailable.length, 0);
  assert.ok(
    totalUnavailable > 20,
    `only ${totalUnavailable} unavailable concepts reported; the source gaps have gone missing`,
  );

  // Every unavailable entry must say WHY. "unavailable" with no reason is the thing this
  // endpoint exists to prevent.
  for (const entry of capability.regions)
    for (const gap of entry.unavailable)
      assert.ok(gap.reason.length > 10, `${gap.asiId} is unavailable without a reason`);

  // A named, well-known gap, so this cannot pass on unrelated counts alone.
  const knee = capability.regions.find((x) => x.region === 'knee')!;
  const ids = knee.unavailable.map((g) => g.asiId);
  assert.ok(ids.includes('asi:knee.mcl'), 'the MCL gap has disappeared from the knee report');
  assert.ok(ids.includes('asi:knee.meniscus-medial'), 'the meniscus gap has disappeared');
});

test('capability says the 2D map is a placeholder, and never claims it is medical art', async () => {
  const r = await fetch(`${BASE}/api/anatomy/capability`);
  const capability = AnatomyCapabilitySchema.parse(await r.json());
  const structures = capability.regions.flatMap((x) => x.structures);
  assert.ok(structures.length > 10, 'no structures were reported at all');
  assert.ok(
    structures.some((s) => s.twoDPlaceholder),
    'no structure reports its 2D as a placeholder',
  );
  // Any structure with real 3D in one region reports membership in every region it
  // belongs to -- the ontology, not the id prefix.
  // NOT conditional. This was `if (trapezius) { ... }`, so if the trapezius ever
  // disappeared from the capability report the whole block was skipped and the test passed.
  // It is the assertion guarding the `regionsForStructure` fix -- the cross-region
  // membership this project already got wrong once -- and it was guarding it with a
  // conditional.
  const trapezius = structures.find((s) => s.asiId === 'asi:shoulder.trapezius-upper');
  assert.ok(
    trapezius,
    'the upper trapezius is missing from the capability report, so cross-region membership ' +
      'cannot be checked at all',
  );
  assert.ok(trapezius.regions.includes('shoulder'));
  assert.ok(
    trapezius.regions.includes('neck'),
    'the upper trapezius no longer reports the neck as a region it belongs to',
  );
  // And the retired id must NOT appear as a structure of its own.
  assert.equal(
    structures.some((s) => s.asiId === 'asi:neck.upper-trapezius'),
    false,
    'the retired upper-trapezius id is back as a second canonical structure',
  );
});

test('a retired structure id comes back canonical', async () => {
  // Create a grounded episode, then write a selection using a RETIRED id. The response
  // and the read-back must both carry the canonical id, because a client that stored the
  // retired string would never match it against the anatomy ontology again.
  const created = await post('/api/episodes', {
    personId: 'contract',
    grounding: { status: 'grounded', region: 'neck', side: 'left' },
  });
  assert.equal(created.status, 201);
  const episode = (await created.json()) as { id: string };

  const applied = await post(`/api/episodes/${episode.id}/mutations`, {
    mutations: [
      {
        fieldPath: 'location.userSelectedStructureIds',
        value: ['asi:neck.upper-trapezius'],
        provenance: {
          sourceType: 'user_selection',
          verificationStatus: 'unverified',
          createdBy: 'user',
        },
      },
    ],
  });
  assert.equal(applied.status, 200);

  const read = await fetch(`${BASE}/api/episodes/${episode.id}`);
  const body = (await read.json()) as { record: { location: { userSelectedStructureIds: string[] } } };
  const ids = body.record.location.userSelectedStructureIds;
  assert.deepEqual(
    ids,
    ['asi:shoulder.trapezius-upper'],
    `the retired id was not projected to canonical; stored ${JSON.stringify(ids)}`,
  );
  assert.equal(
    ids.includes('asi:neck.upper-trapezius'),
    false,
    'the retired id survived into the stored record',
  );
});

test('answer correction is reported, and the server decides that it was one', async () => {
  const created = await post('/api/episodes', {
    personId: 'contract',
    grounding: { status: 'grounded', region: 'knee', side: 'left' },
  });
  const episode = (await created.json()) as { id: string };

  const first = await post(`/api/episodes/${episode.id}/mutations`, {
    answers: [{ questionId: 'knee.locking', raw: 'yes', createdBy: 'user' }],
  });
  const firstBody = (await first.json()) as {
    answers: { questionId: string; replaced: boolean }[];
  };
  assert.equal(firstBody.answers[0]?.replaced, false, 'a first answer was reported as a correction');

  const second = await post(`/api/episodes/${episode.id}/mutations`, {
    answers: [{ questionId: 'knee.locking', raw: 'no', createdBy: 'user' }],
  });
  const secondBody = (await second.json()) as {
    answers: { questionId: string; replaced: boolean }[];
  };
  assert.equal(
    secondBody.answers[0]?.replaced,
    true,
    'a correction was not reported as one, so a client cannot tell the user their answer changed',
  );

  // And the stored provenance says so, without the client having claimed it.
  const read = await fetch(`${BASE}/api/episodes/${episode.id}`);
  const body = (await read.json()) as {
    answers: Record<string, { provenance: { sourceType: string } }>;
  };
  assert.equal(body.answers['knee.locking']?.provenance.sourceType, 'user_edited');
});