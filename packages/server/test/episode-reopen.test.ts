/**
 * Episode reopen, against the real service.
 *
 * The reopen endpoint existed and was correct, and nothing called it. "Continue
 * episode" is not a feature you can add by having an endpoint: the interesting
 * failures are all about what happens around it, and none of them are visible from
 * the server side.
 *
 * The journey proved here is the one a user actually takes, including a restart in
 * the middle, because that is what makes it a test rather than a demonstration:
 *
 *   create -> answer -> save -> server RESTART -> history -> reopen
 *   -> viewer restored -> next question correct -> continue -> save
 *   -> SAME episode id
 *
 * The id assertion is the load-bearing one. A reopen that quietly creates a second
 * episode would pass every other check in this file and would make the history
 * report twice as many occasions as there were.
 */
import { spawn } from 'node:child_process';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { after, before, describe, it } from 'node:test';
import assert from 'node:assert/strict';
import type { Episode, EpisodeReopen, AnswerMap, SpatialHistoryNode } from '@asi/shared';

/** Run from the package root so the server resolves its own imports and schema. */
const SERVER_DIR = join(fileURLToPath(new URL('.', import.meta.url)), '..');
const SERVER_ENTRY = join(SERVER_DIR, 'src/index.ts');
/**
 * A port nothing else in this package uses.
 *
 * `node --test` runs test FILES IN PARALLEL, so a port shared with
 * persistence.test.ts does not fail loudly -- the two files each poll
 * /api/health until it answers, and whichever server came up second answers for
 * both. The symptom is a hang, not an assertion failure, which is why this is
 * spelled out rather than left to chance.
 */
const PORT = 8797;
const BASE = `http://127.0.0.1:${PORT}`;
const DB = join(mkdtempSync(join(tmpdir(), 'asi-reopen-')), 'reopen.sqlite');

let child: ReturnType<typeof spawn> | null = null;

/**
 * Provenance is not decoration: the field registry rejects the wrong claim class
 * per field, and a pin or a visual selection is a `user_selection` rather than a
 * `user_statement`. Getting that wrong is a 422, which is the point.
 */
const STATEMENT = {
  sourceType: 'user_statement',
  verificationStatus: 'user_confirmed',
  createdBy: 'user',
} as const;
const SELECTION = {
  sourceType: 'user_selection',
  verificationStatus: 'user_confirmed',
  createdBy: 'user',
} as const;

async function waitForApi(timeoutMs = 25_000): Promise<void> {
  const deadline = Date.now() + timeoutMs;
  for (;;) {
    try {
      const res = await fetch(`${BASE}/api/health`);
      if (res.ok) return;
    } catch {
      /* not up yet */
    }
    if (Date.now() > deadline) throw new Error(`server did not start within ${timeoutMs}ms`);
    await new Promise((r) => setTimeout(r, 150));
  }
}

async function startServer(): Promise<void> {
  child = spawn(
    process.execPath,
    ['--experimental-strip-types', '--no-warnings', SERVER_ENTRY],
    {
      cwd: SERVER_DIR,
      env: {
        ...process.env,
        // No model: everything under test is deterministic.
        ANTHROPIC_API_KEY: '',
        ASI_DB_PATH: DB,
        ASI_PORT: String(PORT),
        ASI_RELEASE_PROFILE: 'development',
      },
      stdio: 'ignore',
    },
  );
  await waitForApi();
}

/** SIGKILL, not SIGTERM: a graceful stop could flush a write the test relies on failing. */
async function stopServer(): Promise<void> {
  if (!child) return;
  const dead = new Promise<void>((resolve) => child!.once('exit', () => resolve()));
  child.kill('SIGKILL');
  await dead;
  child = null;
  // The port has to actually be free before the next process binds it.
  await new Promise((r) => setTimeout(r, 250));
}

async function post<T>(path: string, body: unknown): Promise<T> {
  const res = await fetch(`${BASE}${path}`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(body),
  });
  const text = await res.text();
  if (!res.ok) throw new Error(`POST ${path} -> ${res.status}: ${text}`);
  return JSON.parse(text) as T;
}

async function get<T>(path: string): Promise<T> {
  const res = await fetch(`${BASE}${path}`);
  const text = await res.text();
  if (!res.ok) throw new Error(`GET ${path} -> ${res.status}: ${text}`);
  return JSON.parse(text) as T;
}

before(async () => {
  await startServer();
});
after(async () => {
  await stopServer();
  rmSync(DB, { force: true });
  rmSync(join(DB, '-wal'), { force: true });
  rmSync(join(DB, '-shm'), { force: true });
});

describe('episode reopen', () => {
  it('resumes the SAME episode after a restart, without creating a second one', async () => {
    /* ---- 1. create ---- */
    const created = await post<Episode>('/api/episodes', {
      personId: 'reopener',
      displayName: 'Reopener',
      grounding: { status: 'grounded', region: 'shoulder', side: 'left', by: 'deterministic' },
      mutations: [
        { fieldPath: 'location.region', value: 'shoulder', provenance: STATEMENT },
        { fieldPath: 'location.side', value: 'left', provenance: STATEMENT },
        { fieldPath: 'location.subRegionId', value: 'shoulder.anterior', provenance: SELECTION },
        { fieldPath: 'location.userSelectedStructureIds', value: ['asi:shoulder.deltoid'], provenance: SELECTION },
        { fieldPath: 'location.point', value: { x: 0.42, y: 0.61 }, provenance: SELECTION },
        { fieldPath: 'location.userPhrase', value: 'aching on the front of my shoulder', provenance: STATEMENT },
      ],
      title: 'shoulder aching',
    });
    assert.ok(created.id, 'no episode id came back');
    const originalId = created.id;

    /* ---- 2. answer, then save ---- */
    const first = await post<{ next: { id: string } | null }>(
      `/api/episodes/${originalId}/interview/next`,
      {},
    );
    assert.ok(first.next?.id, 'the interview offered no first question');

    const answered = await post<{ summary: unknown }>(`/api/episodes/${originalId}/mutations`, {
      mutations: [],
      answers: [
        {
          questionId: first.next!.id,
          raw: true,
          wroteFields: [],
          createdBy: 'user',
          rawText: 'yes',
        },
      ],
    });
    void answered;

    /* ---- 3. the server goes away and comes back ---- */
    await stopServer();
    await startServer();

    /* ---- 4. history, as the browser sees it ---- */
    const places = await get<SpatialHistoryNode[]>(`/api/healthmap/reopener/spatial`);
    const withHistory = places.filter((p) => p.episodeCount > 0);
    assert.equal(withHistory.length, 1, 'the saved episode is not in the health map after a restart');
    const place = withHistory[0]!;
    assert.equal(place.episodeCount, 1);
    assert.equal(place.episodes.length, 1);
    assert.equal(place.episodes[0]!.id, originalId);
    // The visual selection and the pin survived the restart.
    assert.deepEqual(place.episodes[0]!.point, { x: 0.42, y: 0.61 });
    assert.deepEqual(place.episodes[0]!.visualSelections, ['Deltoid']);

    /* ---- 5. reopen ---- */
    const reopened = await get<EpisodeReopen>(`/api/episodes/${originalId}/reopen`);
    assert.equal(reopened.episode.id, originalId, 'reopen returned a different episode');
    assert.equal(reopened.interviewable, true);
    // The record the client hydrates carries the user's own selection, which is
    // what the viewer gets restored from.
    assert.deepEqual(reopened.episode.record.location.userSelectedStructureIds, [
      'asi:shoulder.deltoid',
    ]);
    assert.equal(reopened.episode.record.location.subRegionId, 'shoulder.anterior');
    assert.equal(reopened.grounding?.by, 'deterministic', 'the orchestrator was not carried through');
    // The answer given before the restart is still there, so the next question
    // ADVANCES rather than repeating.
    const answers = reopened.answers as AnswerMap;
    assert.ok(Object.keys(answers).length >= 1, 'the pre-restart answer was lost');
    assert.ok(reopened.nextQuestion, 'reopen offered no next question');
    assert.notEqual(
      reopened.nextQuestion!.id,
      first.next!.id,
      'reopen offered the question that was already answered',
    );
    assert.ok(reopened.progress.total > 0);
    assert.ok(reopened.progress.answered >= 1);
    assert.ok(reopened.outstandingFields.length > 0, 'a resumed episode claims nothing is outstanding');

    /* ---- 6. continue: answer the next question and save ---- */
    await post(`/api/episodes/${originalId}/mutations`, {
      mutations: [],
      answers: [
        {
          questionId: reopened.nextQuestion!.id,
          raw: false,
          wroteFields: [],
          createdBy: 'user',
          rawText: 'no',
        },
      ],
    });
    const saved = await post<{ id: string }>(`/api/episodes/${originalId}/mutations`, {
      mutations: [],
      answers: [],
    });
    assert.equal(saved.id, undefined, 'a save returned a new episode id, which would be a duplicate');

    /* ---- 7. still one episode ---- */
    const after = await get<SpatialHistoryNode[]>(`/api/healthmap/reopener/spatial`);
    const total = after
      .filter((p) => p.episodeCount > 0)
      .reduce((sum, p) => sum + p.episodeCount, 0);
    assert.equal(total, 1, `continuing created a second episode (total ${total})`);
    const ids = after.flatMap((p) => p.episodes.map((e) => e.id));
    assert.deepEqual(new Set(ids), new Set([originalId]));

    // And the record now holds both answers.
    const final = await get<EpisodeReopen>(`/api/episodes/${originalId}/reopen`);
    assert.ok(Object.keys(final.answers).length >= 2);
    assert.equal(final.episode.id, originalId);
  });

  it('reports progress the interview can carry on from, not a rewind', async () => {
    const episode = await post<Episode>('/api/episodes', {
      personId: 'progress',
      displayName: 'Progress',
      grounding: { status: 'grounded', region: 'knee', side: 'right', by: 'deterministic' },
      mutations: [
        { fieldPath: 'location.region', value: 'knee', provenance: STATEMENT },
        { fieldPath: 'location.side', value: 'right', provenance: STATEMENT },
      ],
      title: 'knee',
    });
    const reopened = await get<EpisodeReopen>(`/api/episodes/${episode.id}/reopen`);
    assert.ok(reopened.nextQuestion, 'a fresh episode has no next question');
    const firstId = reopened.nextQuestion!.id;
    assert.equal(reopened.progress.answered, 0);
    assert.equal(reopened.progress.requiredLeft, reopened.progress.total);

    await post(`/api/episodes/${episode.id}/mutations`, {
      mutations: [],
      answers: [{ questionId: firstId, raw: true, wroteFields: [], createdBy: 'user', rawText: 'yes' }],
    });

    const after = await get<EpisodeReopen>(`/api/episodes/${episode.id}/reopen`);
    assert.equal(after.progress.answered, 1);
    assert.equal(after.progress.requiredLeft, after.progress.total - 1);
    assert.notEqual(after.nextQuestion?.id, firstId);
    // The answered question is no longer outstanding; the unasked ones are.
    assert.equal(after.progress.outstanding.includes(firstId), false);
  });

  it('reports interviewable truthfully, and 404s an episode that does not exist', async () => {
    // An episode can name a region this build has no interview for, and reopen must
    // not manufacture a question list for it. This one IS interviewable, so the
    // negative case is the assertion that matters: `interviewable` is derived from
    // the question list, not asserted optimistically.
    const episode = await post<Episode>('/api/episodes', {
      personId: 'odd',
      displayName: 'Odd',
      grounding: { status: 'grounded', region: 'knee', side: 'left', by: 'deterministic' },
      mutations: [
        { fieldPath: 'location.region', value: 'knee', provenance: STATEMENT },
        { fieldPath: 'location.side', value: 'right', provenance: STATEMENT },
      ],
      title: 'knee',
    });
    const reopened = await get<EpisodeReopen>(`/api/episodes/${episode.id}/reopen`);
    assert.equal(reopened.interviewable, true);
    assert.ok(reopened.progress.total > 0);

    const missing = await get<EpisodeReopen>('/api/episodes/does-not-exist/reopen').catch(
      (e: unknown) => e,
    );
    assert.ok(missing instanceof Error, 'reopening a missing episode did not fail');
    assert.match(String((missing as Error).message), /404/);
  });
});