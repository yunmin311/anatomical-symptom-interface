/**
 * Restart persistence.
 *
 * The claim being tested is the one that matters most for a local-first health
 * product: a record the user saved is still there after the app is closed, and
 * the summary and the history still read back correctly.
 *
 * This deliberately does NOT use the seed script. Seed proves the seed runs; it
 * says nothing about whether a write survived. Instead it boots the real server
 * as a child process, writes through the real HTTP API, kills the process with
 * SIGKILL, boots a second one against the same file, and reads everything back. A
 * seed-based test would pass even if persistence were completely broken.
 *
 * It also asserts the things that make a record a record rather than a row:
 * field provenance is still attached to its value, the four-state interview
 * answers are still distinguishable, the derived selection flag is still
 * recomputed on read, and a refused complaint still refuses rather than
 * inventing a region.
 */
import { test, after } from 'node:test';
import assert from 'node:assert/strict';
import { spawn, type ChildProcess } from 'node:child_process';
import { mkdtempSync, rmSync, existsSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const here = fileURLToPath(new URL('.', import.meta.url));
const serverDir = resolve(here, '..');
const entry = join(serverDir, 'src/index.ts');

const dir = mkdtempSync(join(tmpdir(), 'asi-persist-'));
const dbPath = join(dir, 'persist.sqlite');
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

type Json = Record<string, unknown>;

interface HealthMapNode {
  region: string;
  side: string;
  subRegionId: string | null;
  point: { x: number; y: number } | null;
  episodeCount: number;
  lastEpisodeAt: string | null;
  lastTitle: string | null;
}

interface EpisodeDetail {
  id: string;
  record: {
    location: { userPhrase: string | null; userSelectedStructureIds: string[] };
    consideredStructures: {
      structureId: string;
      rationale: string;
      confidence: number;
      selectedByUser: boolean;
    }[];
  };
  answers: Record<string, { triState: string }>;
}

/** `summaryFor` returns an envelope: the summary, its plain text, and safety state. */
interface SummaryEnvelope {
  summary: {
    history: { label: string; value: string }[];
    visualSelections: string[];
    unselectedSuggestions: string[];
  };
  text: string;
  blocked: boolean;
}

let child: ChildProcess | null = null;

async function waitForHealth(timeoutMs = 30_000): Promise<void> {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    try {
      const r = await fetch(`${BASE}/api/health`);
      if (r.ok) return;
    } catch { /* not up yet */ }
    await new Promise((r) => setTimeout(r, 150));
  }
  throw new Error('server did not become healthy');
}

/** Boot the real server against the same database file. */
async function startServer(): Promise<void> {
  child = spawn(
    process.execPath,
    ['--experimental-strip-types', '--no-warnings', entry],
    {
      cwd: serverDir,
      env: {
        ...process.env,
        ASI_DB_PATH: dbPath,
        ASI_PORT: String(PORT),
        ASI_RELEASE_PROFILE: 'development',
        // No model: everything under test is deterministic.
        ANTHROPIC_API_KEY: '',
      },
      stdio: ['ignore', 'pipe', 'pipe'],
    },
  );
  child.stdout?.on('data', () => {});
  child.stderr?.on('data', () => {});
  await waitForHealth();
}

async function stopServer(): Promise<void> {
  const c = child;
  child = null;
  if (!c || c.exitCode !== null) return;
  const exited = new Promise<void>((res) => c.once('exit', () => res()));
  c.kill('SIGKILL');
  await exited;
}

async function req<T>(method: string, path: string, body?: unknown): Promise<{ status: number; body: T }> {
  const r = await fetch(`${BASE}${path}`, {
    method,
    headers: body ? { 'content-type': 'application/json' } : undefined,
    body: body ? JSON.stringify(body) : undefined,
  });
  const text = await r.text();
  try { return { status: r.status, body: JSON.parse(text) as T }; }
  catch { return { status: r.status, body: text as T }; }
}

after(async () => {
  await stopServer();
  rmSync(dir, { recursive: true, force: true });
});

/* ================================================================== */

test('a saved episode survives closing and reopening the app', async () => {
  await startServer();

  // ---- session 1: create, as a user would ----
  const created = await req<{ id: string }>('POST', '/api/episodes', {
    personId: 'persisted',
    displayName: 'Persistence Tester',
    title: 'Left knee after long walks',
    grounding: { status: 'grounded', region: 'knee', side: 'left', by: 'deterministic' },
    mutations: [
      {
        fieldPath: 'location.userPhrase',
        value: 'my left knee aches after long walks',
        provenance: { sourceType: 'user_statement', verificationStatus: 'user_confirmed', createdBy: 'user' },
      },
      {
        fieldPath: 'location.userSelectedStructureIds',
        value: ['asi:knee.patella'],
        provenance: { sourceType: 'user_selection', verificationStatus: 'user_confirmed', createdBy: 'user' },
      },
      {
        fieldPath: 'consideredStructures',
        value: [
          { structureId: 'asi:knee.patella', rationale: 'Near the kneecap.', confidence: 0.5, selectedByUser: false },
          { structureId: 'asi:knee.meniscus-medial', rationale: 'Possible.', confidence: 0.3, selectedByUser: false },
        ],
        provenance: { sourceType: 'ai_inference', verificationStatus: 'unverified', createdBy: 'model', confidence: 0.5 },
      },
    ],
  });
  assert.equal(created.status, 201, JSON.stringify(created.body));
  const id = created.body.id;

  // ---- then answer an interview question, through the write path ----
  const answered = await req<Json>('POST', `/api/episodes/${id}/mutations`, {
    answers: [{ questionId: 'knee.cauda_equina', raw: false, createdBy: 'user' }],
  });
  assert.equal(answered.status, 200, `answer failed: ${answered.status}`);

  // What the user saw before closing, for comparison after reopening.
  const beforeEpisode = await req<EpisodeDetail>('GET', `/api/episodes/${id}`);
  const beforeSummary = await req<SummaryEnvelope>('GET', `/api/episodes/${id}/summary`);
  const beforeHistory = await req<HealthMapNode[]>('GET', '/api/healthmap/persisted');
  assert.equal(beforeEpisode.status, 200);
  assert.equal(beforeSummary.status, 200);
  assert.equal(beforeHistory.status, 200);

  // ---- close the app ----
  await stopServer();
  assert.ok(existsSync(dbPath), 'the database file did not survive the process being killed');

  // ---- reopen it ----
  await startServer();

  // ---- everything is still there, and identical ----
  const afterEpisode = await req<EpisodeDetail>('GET', `/api/episodes/${id}`);
  assert.equal(afterEpisode.status, 200, 'the episode was not found after restart');
  assert.deepEqual(afterEpisode.body, beforeEpisode.body, 'the reopened episode differs from what was saved');

  const afterSummary = await req<SummaryEnvelope>('GET', `/api/episodes/${id}/summary`);
  assert.equal(afterSummary.status, 200);
  assert.ok(
    afterSummary.body.summary.history.some((h) => h.value.includes('left knee aches')),
    'the user phrase did not survive restart',
  );
  assert.deepEqual(afterSummary.body.summary.visualSelections, ['Patella'], 'the visual selection did not survive restart');
  assert.match(afterSummary.body.text, /not a diagnosis/i);

  // Provenance is still attached to the value it describes.
  const patella = afterEpisode.body.record.consideredStructures
    .find((c) => c.structureId === 'asi:knee.patella');
  assert.equal(patella?.rationale, 'Near the kneecap.', 'candidate rationale did not survive restart');
  assert.equal(patella?.confidence, 0.5, 'candidate confidence did not survive restart');
  // The derived flag is recomputed from the canonical set on every read.
  assert.equal(patella?.selectedByUser, true, 'the derived selection flag was not recomputed on read');
  assert.deepEqual(
    afterEpisode.body.record.location.userSelectedStructureIds,
    ['asi:knee.patella'],
    'the canonical selection set did not survive restart',
  );

  // The four-state answer survived as itself, not flattened to a default.
  const cauda = afterEpisode.body.answers['knee.cauda_equina'];
  assert.ok(cauda, 'the interview answer did not survive restart');
  assert.equal(cauda.triState, 'no', 'the answer value did not survive restart');

  // The history read model still counts it, unchanged.
  const afterHistory = await req<HealthMapNode[]>('GET', '/api/healthmap/persisted');
  assert.deepEqual(afterHistory.body, beforeHistory.body, 'history differs after restart');
  const knee = afterHistory.body.find((x) => x.region === 'knee');
  assert.equal(knee?.episodeCount, 1, 'the episode is missing from the history after restart');
});

test('a second episode in the same region accumulates in the history', async () => {
  const second = await req<{ id: string }>('POST', '/api/episodes', {
    personId: 'persisted',
    displayName: 'Persistence Tester',
    title: 'Now the other knee',
    grounding: { status: 'grounded', region: 'knee', side: 'right', by: 'deterministic' },
    mutations: [
      {
        fieldPath: 'location.userPhrase',
        value: 'now the other knee too',
        provenance: { sourceType: 'user_statement', verificationStatus: 'user_confirmed', createdBy: 'user' },
      },
    ],
  });
  assert.equal(second.status, 201, JSON.stringify(second.body));
  const id2 = second.body.id;

  await stopServer();
  await startServer();

  const history = await req<HealthMapNode[]>('GET', '/api/healthmap/persisted');
  assert.equal(history.status, 200);
  const kneeRows = history.body.filter((x) => x.region === 'knee');
  assert.equal(
    kneeRows.reduce((a, x) => a + x.episodeCount, 0),
    2,
    'the second episode did not accumulate in history',
  );
  // Side is part of the place, so left and right are distinct rows.
  assert.equal(kneeRows.length, 2, 'left and right were collapsed into one place');

  const ep2 = await req('GET', `/api/episodes/${id2}`);
  assert.equal(ep2.status, 200, 'the second episode was lost');
});

test('a refused complaint still refuses after restart, and leaves no record', async () => {
  const before = await req<HealthMapNode[]>('GET', '/api/healthmap/persisted');
  const countBefore = before.body.reduce((a, x) => a + x.episodeCount, 0);

  const refused = await req<{ id: string; error: string }>('POST', '/api/episodes', {
    personId: 'persisted',
    grounding: { status: 'unsupported', reason: 'out_of_scope' },
  });
  assert.equal(refused.status, 409, 'an unsupported episode must not be creatable');
  assert.equal(refused.body.error, 'episode_not_localised');

  await stopServer();
  await startServer();

  // The refusal is still authoritative after a restart: no phantom record, and
  // no region was invented for it.
  const after = await req<HealthMapNode[]>('GET', '/api/healthmap/persisted');
  assert.equal(
    after.body.reduce((a, x) => a + x.episodeCount, 0),
    countBefore,
    'a refused complaint left a record behind',
  );
  assert.equal(
    after.body.some((x) => x.region === 'chest' || x.region === 'unknown' || x.region === ''),
    false,
    'a region was invented for a refused complaint',
  );

  // And localising the same complaint still refuses, rather than defaulting.
  const localised = await req<{ status: string; by?: string }>('POST', '/api/localise', {
    utterance: 'sharp chest pain radiating to my jaw',
  });
  assert.equal(localised.body.status, 'unsupported');
  assert.equal(localised.body.by, undefined, 'a refusal must not claim an orchestrator read it');
});
