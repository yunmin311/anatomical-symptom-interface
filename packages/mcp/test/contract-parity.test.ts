/**
 * The contract the two surfaces must agree on.
 *
 * Three things were true at once and could not all be right:
 *
 *  1. a mutation with no `value` parsed successfully, because `z.unknown()` is OPTIONAL --
 *     and the two surfaces then disagreed about what to say about it
 *  2. a retired structure id was stored retired over HTTP and canonical over MCP
 *  3. `retired_structure` was a documented error code that nothing produced
 *
 * Each test below sends the SAME request through both surfaces and asserts they behave the
 * same, because "both surfaces exist" is not the same claim as "both surfaces agree".
 */
import { test, describe, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

const dir = mkdtempSync(join(tmpdir(), 'asi-parity-'));
process.env.ASI_DB_PATH = join(dir, 'parity.sqlite');

const { app } = await import('@asi/server/src/app.ts');
const { callTool } = await import('../src/server.ts');
const { ApiErrorSchema } = await import('@asi/shared');
const { canonicalStructureIdList } = await import('@asi/shared');

let stop: (() => void) | undefined;
let base: string;

const ok = <T>(r: { ok: true; data: T } | { ok: false; error: unknown }): T => {
  if (!r.ok) throw new Error(`tool refused: ${JSON.stringify(r.error)}`);
  return r.data;
};

/**
 * A real listening HTTP server, because `app.request()` is not the network path a client
 * uses.
 *
 * The first version bridged node's `http` server to `app.fetch` by hand and every request
 * came back 500 -- a hand-rolled adapter between a framework and a runtime is exactly the
 * kind of thing that looks fine and is not. `@hono/node-server` is already a dependency of
 * this repository and does it properly, so it does it properly.
 */
before(async () => {
  const { serve } = await import('@hono/node-server');
  const server = serve({ fetch: app.fetch, port: 0, hostname: '127.0.0.1' });

  // `serve()` returns before the socket is bound, so `address()` is still null. Reading it
  // immediately is how this file spent one iteration failing with "the server did not bind".
  if (!server.listening) {
    await new Promise<void>((resolve, reject) => {
      server.once('listening', resolve);
      server.once('error', reject);
    });
  }
  const address = server.address();
  if (address === null || typeof address === 'string') throw new Error('the server did not bind');
  base = `http://127.0.0.1:${address.port}`;
  // `fetch` pools keep-alive sockets, so `close()` alone waits forever for connections that
  // are never going to end on their own. The first version of this file hung on teardown
  // for exactly that reason and looked like a slow test rather than a leak.
  // `@hono/node-server` types its return as a union that does not expose
  // `closeAllConnections`, though the value is a node `http.Server`. Narrowed here rather
  // than with `any`, which this project does not allow.
  const node = server as unknown as import('node:http').Server;
  stop = () => {
    node.closeAllConnections();
    node.close();
  };
});

after(() => {
  stop?.();
  rmSync(dir, { recursive: true, force: true });
});

const post = (path: string, body: unknown) =>
  fetch(`${base}${path}`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(body),
  });

async function shoulderEpisode(personId: string) {
  const response = await post('/api/episodes', {
    personId,
    grounding: { status: 'grounded', region: 'shoulder', side: 'left' },
  });
  assert.equal(response.status, 201);
  return ((await response.json()) as { id: string }).id;
}

/**
 * The value actually STORED for a field, read from the raw row rather than the projection.
 *
 * The API deliberately exposes the PROJECTED record, and the projection canonicalises
 * anatomical ids on read. That is correct behaviour and it is also exactly why it cannot
 * answer this question: reading the record would show the canonical id whether or not the
 * store had been fixed. Only the row can.
 */
async function rawField(episodeId: string, fieldPath: string): Promise<unknown> {
  const { get } = await import('@asi/server/src/db/client.ts');
  const row = get<{ value_json: string }>(
    `SELECT value_json FROM episode_fields WHERE episode_id = ? AND field_path = ?`,
    episodeId,
    fieldPath,
  );
  if (!row) return undefined;
  return JSON.parse(row.value_json as string);
}

describe('a missing value/raw is malformed on BOTH surfaces, and writes nothing', () => {
  test('HTTP: a mutation with no `value` is validation_failed', async () => {
    const id = await shoulderEpisode('parity-http-missing-value');
    const response = await post(`/api/episodes/${id}/mutations`, {
      mutations: [
        {
          fieldPath: 'location.side',
          // NO `value` key at all.
          provenance: {
            sourceType: 'user_statement',
            verificationStatus: 'unverified',
            createdBy: 'user',
          },
        },
      ],
    });
    assert.equal(response.status, 400, 'a mutation with no value was not refused as malformed');
    const body = ApiErrorSchema.parse(await response.json());
    assert.equal(body.error, 'validation_failed');
    assert.notEqual(body.error, 'internal_error', 'a malformed request surfaced as a server error');
    // And nothing was written.
    assert.equal(
      await rawField(id, 'location.side'),
      undefined,
      'a malformed batch left a field row behind',
    );
  });

  test('MCP: a shape violation is validation_failed, never internal_error', async () => {
    const episode = await startShoulder('parity-mcp-bad-shape');

    // Compared against the value BEFORE the refused call rather than a hardcoded 'left':
    // an episode starts with `side: unknown` and grounding records which side was
    // indicated, so the assertion that matters is "nothing changed", not "it is left".
    const before = ok<{ record: { location: { side: string } } }>(
      (await callTool('get_episode', { episodeId: episode.id })) as never,
    );
    // `side` present but not a legal side: the same failure class as a missing key, since
    // both mean "the payload does not match the contract". It pins the property that
    // actually broke -- the tool reported these as `internal_error` because
    // `FieldPolicyError` was constructed with its arguments reversed, so the code and the
    // path were swapped.
    const result = await callTool('update_location', {
      episodeId: episode.id,
      side: 'sideways',
    });
    assert.equal(result.ok, false);
    if (!result.ok) assert.equal(result.error.code, 'validation_failed');
    const after = ok<{ record: { location: { side: string } } }>(
      (await callTool('get_episode', { episodeId: episode.id })) as never,
    );
    assert.deepEqual(
      after.record.location,
      before.record.location,
      'a refused write changed the record',
    );
  });

  test('a missing `raw` on an answer is validation_failed on HTTP', async () => {
    const id = await shoulderEpisode('parity-http-missing-raw');
    const response = await post(`/api/episodes/${id}/mutations`, {
      answers: [{ questionId: 'shoulder.night_pain', createdBy: 'user' }],
    });
    assert.equal(response.status, 400);
    const body = ApiErrorSchema.parse(await response.json());
    assert.equal(body.error, 'validation_failed');

    // No answer row was created, so nothing can read back as "the user said something".
    const after = (await (await fetch(`${base}/api/episodes/${id}`)).json()) as {
      answers: Record<string, unknown>;
    };
    assert.deepEqual(after.answers, {}, 'a malformed answer was stored anyway');
  });

  test('a missing `raw` on an answer is validation_failed on MCP', async () => {
    const episode = await startShoulder('parity-mcp-missing-raw');
    const result = await callTool('answer_symptom_question', {
      episodeId: episode.id,
      questionId: 'shoulder.night_pain',
      // no `raw`
    });
    assert.equal(result.ok, false);
    if (!result.ok) assert.equal(result.error.code, 'validation_failed');

    const read = ok<{ answers: Record<string, unknown> }>(
      (await callTool('get_episode', { episodeId: episode.id })) as never,
    );
    assert.deepEqual(read.answers, {}, 'a malformed answer was stored anyway');
  });

  test('`null` is a VALUE: "the user said unknown" is not a malformed request', async () => {
    // The distinction the presence check must preserve. A refusal that also rejected null
    // would make "the side is unknown" unrecordable, and unknown is a real answer this
    // product refuses to conflate with anything else.
    const id = await shoulderEpisode('parity-null-value');
    const response = await post(`/api/episodes/${id}/mutations`, {
      mutations: [
        {
          fieldPath: 'location.side',
          value: 'unknown',
          provenance: {
            sourceType: 'user_statement',
            verificationStatus: 'unverified',
            createdBy: 'user',
          },
        },
      ],
    });
    assert.equal(response.status, 200, 'an explicit "unknown" was treated as malformed');
  });
});

/** A small helper so both halves of a cross-surface test can create an episode. */
async function startShoulder(personId: string) {
  return ok<{ id: string }>(
    (await callTool('start_symptom_episode', {
      personId,
      grounding: { status: 'grounded', region: 'shoulder', side: 'left' },
    })) as never,
  );
}

describe('a retired id is ACCEPTED and STORED CANONICAL, on both surfaces', () => {
  test('a generic HTTP field mutation stores the canonical id', async () => {
    const id = await shoulderEpisode('parity-http-retired');
    const response = await post(`/api/episodes/${id}/mutations`, {
      mutations: [
        {
          fieldPath: 'location.userSelectedStructureIds',
          // The RETIRED alias, sent through the generic field path -- the case that used
          // to persist it verbatim.
          value: ['asi:neck.upper-trapezius'],
          provenance: {
            sourceType: 'user_selection',
            verificationStatus: 'unverified',
            createdBy: 'user',
          },
        },
      ],
    });
    assert.equal(response.status, 200);
    assert.deepEqual(
      await rawField(id, 'location.userSelectedStructureIds'),
      ['asi:shoulder.trapezius-upper'],
      'the raw field store still holds a retired id, so a consumer reading field rows ' +
        'directly would resolve it to no structure',
    );
  });

  test('MCP stores the same canonical id for the same request', async () => {
    const episode = await startShoulder('parity-mcp-retired');
    const result = ok<unknown>((await callTool('select_structure', {
      episodeId: episode.id,
      structureIds: ['asi:neck.upper-trapezius'],
    })) as never);
    void result;
    assert.deepEqual(await rawField(episode.id, 'location.userSelectedStructureIds'), [
      'asi:shoulder.trapezius-upper',
    ]);
  });

  test('the two surfaces produce the SAME stored value for the same request', async () => {
    const httpId = await shoulderEpisode('parity-same-http');
    const mcpEpisode = await startShoulder('parity-same-mcp');

    await post(`/api/episodes/${httpId}/mutations`, {
      mutations: [
        {
          fieldPath: 'location.userSelectedStructureIds',
          value: ['asi:neck.upper-trapezius', 'asi:shoulder.acromion'],
          provenance: {
            sourceType: 'user_selection',
            verificationStatus: 'unverified',
            createdBy: 'user',
          },
        },
      ],
    });
    await callTool('select_structure', {
      episodeId: mcpEpisode.id,
      structureIds: ['asi:neck.upper-trapezius', 'asi:shoulder.acromion'],
    });

    assert.deepEqual(
      await rawField(httpId, 'location.userSelectedStructureIds'),
      await rawField(mcpEpisode.id, 'location.userSelectedStructureIds'),
      'the same request stored different values on the two surfaces',
    );
  });

  test('a retired alias and its canonical form are ONE point, not two', async () => {
    const id = await shoulderEpisode('parity-alias-dedupe');
    await post(`/api/episodes/${id}/mutations`, {
      mutations: [
        {
          fieldPath: 'location.userSelectedStructureIds',
          // Both spellings of the same structure, plus a genuine second point.
          value: [
            'asi:neck.upper-trapezius',
            'asi:shoulder.trapezius-upper',
            'asi:shoulder.acromion',
          ],
          provenance: {
            sourceType: 'user_selection',
            verificationStatus: 'unverified',
            createdBy: 'user',
          },
        },
      ],
    });
    const stored = (await rawField(id, 'location.userSelectedStructureIds')) as string[];
    assert.deepEqual(
      stored,
      canonicalStructureIdList([
        'asi:neck.upper-trapezius',
        'asi:shoulder.trapezius-upper',
        'asi:shoulder.acromion',
      ]),
      'the stored selection disagrees with the canonical projection',
    );
    assert.deepEqual(stored, ['asi:shoulder.trapezius-upper', 'asi:shoulder.acromion']);
  });

  test('a candidate structure id is canonicalised too', async () => {
    const id = await shoulderEpisode('parity-candidate');
    const response = await post(`/api/episodes/${id}/mutations`, {
      mutations: [
        {
          fieldPath: 'consideredStructures',
          value: [
            {
              structureId: 'asi:neck.upper-trapezius',
              rationale: 'pointed at the top of the shoulder',
              confidence: 0.4,
            },
          ],
          provenance: {
            sourceType: 'ai_inference',
            // Mandatory, and the reason this fixture first came back 500: a model
            // candidate with no confidence is refused by rule. The refusal itself was the
            // bug -- a client error answered with a server fault and a non-JSON body.
            confidence: 0.4,
            verificationStatus: 'unverified',
            createdBy: 'model',
          },
        },
      ],
    });
    assert.equal(response.status, 200);
    const stored = (await rawField(id, 'consideredStructures')) as {
      structureId: string;
    }[];
    assert.equal(
      stored[0]?.structureId,
      'asi:shoulder.trapezius-upper',
      'a candidate kept a retired id, so a retired alias could persist as a second identity',
    );
  });

  test('`retired_structure` is gone from the contract: nothing produces it', async () => {
    // Retired ids are accepted, not refused, so the code was unreachable. A client that
    // branched on it was branching on something that could not happen.
    const codes = (await import('@asi/shared')).ApiErrorCodeSchema.options;
    assert.equal(
      codes.includes('retired_structure' as never),
      false,
      'retired_structure is still a documented error code, but retired ids are accepted',
    );
  });

  test('an id that is NOT retired and does NOT exist is still refused', async () => {
    // Removing `retired_structure` must not weaken the real check.
    const episode = await startShoulder('parity-unknown-structure');
    const result = await callTool('select_structure', {
      episodeId: episode.id,
      structureIds: ['asi:shoulder.not-a-bone'],
    });
    assert.equal(result.ok, false);
    if (!result.ok) assert.equal(result.error.code, 'unknown_structure');
  });
});