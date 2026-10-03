/**
 * THE IDENTITY INVARIANT, PROVED ON BOTH SURFACES AT ONCE.
 *
 * For a field whose value is an anatomical identity:
 *
 *   current canonical id -> accept
 *   retired id           -> canonicalise, then accept
 *   neither              -> REFUSE
 *
 * ## WHY THIS NEEDS BOTH SURFACES IN ONE FILE
 *
 * The third clause was missing, and only from HTTP. `canonicalStructureId` resolves retired
 * ids and returns anything else UNCHANGED, so an invented id passed through canonicalisation
 * unharmed -- and the field schemas are `array<string>` and `string`, which accept any string
 * at all. `MCP select_structure` called `getStructure` and refused. A generic HTTP field
 * mutation did not.
 *
 * So the same request had two answers depending on which door it came through, and a
 * `location.userSelectedStructureIds` of `['asi:shoulder.not-a-real-structure']` was storable
 * over HTTP -- an identity that resolves to nothing.
 *
 * The check now lives at the one boundary both surfaces pass through. These tests exist to
 * keep it there, and they read the RAW field row rather than the projected record, because
 * the projection is exactly the layer that hides this class of bug.
 */
import { test, describe, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

const dir = mkdtempSync(join(tmpdir(), 'asi-identity-'));
process.env.ASI_DB_PATH = join(dir, 'identity.sqlite');

const { app } = await import('@asi/server/src/app.ts');
const { callTool } = await import('../src/server.ts');
const { ApiErrorSchema } = await import('@asi/shared');
const { serve } = await import('@hono/node-server');

const RETIRED = 'asi:neck.upper-trapezius';
const CANONICAL = 'asi:shoulder.trapezius-upper';
const CURRENT = 'asi:shoulder.acromion';
const INVENTED = 'asi:shoulder.not-a-real-structure';

let stop: (() => void) | undefined;
let base: string;

before(async () => {
  const server = serve({ fetch: app.fetch, port: 0, hostname: '127.0.0.1' });
  if (!server.listening)
    await new Promise<void>((resolve, reject) => {
      server.once('listening', () => resolve());
      server.once('error', reject);
    });
  const address = server.address();
  if (address === null || typeof address === 'string') throw new Error('the server did not bind');
  base = `http://127.0.0.1:${address.port}`;
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

const ok = <T>(r: { ok: true; data: T } | { ok: false; error: unknown }): T => {
  if (!r.ok) throw new Error(`tool refused: ${JSON.stringify(r.error)}`);
  return r.data;
};

const post = (path: string, body: unknown) =>
  fetch(`${base}${path}`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(body),
  });

async function httpEpisode(personId: string) {
  const response = await post('/api/episodes', {
    personId,
    grounding: { status: 'grounded', region: 'shoulder', side: 'left' },
  });
  assert.equal(response.status, 201);
  return ((await response.json()) as { id: string }).id;
}

async function mcpEpisode(personId: string) {
  return ok<{ id: string }>(
    (await callTool('start_symptom_episode', {
      personId,
      grounding: { status: 'grounded', region: 'shoulder', side: 'left' },
    })) as never,
  );
}

const selectionProv = () => ({
  sourceType: 'user_selection',
  verificationStatus: 'unverified',
  createdBy: 'user',
});

const candidateProv = () => ({
  sourceType: 'ai_inference',
  // Mandatory: a model candidate with no confidence is refused by rule, and this fixture is
  // about identity, so it has to satisfy the provenance rules to reach the identity check.
  confidence: 0.4,
  verificationStatus: 'unverified',
  createdBy: 'model',
});

/** The value actually STORED, read from the raw row. The projection cannot answer this. */
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

const selectMutation = (value: unknown) => ({
  mutations: [
    {
      fieldPath: 'location.userSelectedStructureIds',
      value,
      provenance: selectionProv(),
    },
  ],
});

describe('an id that is neither current nor retired is REFUSED centrally', () => {
  test('A. HTTP generic mutation: unknown_structure, and nothing persisted', async () => {
    const id = await httpEpisode('identity-http-unknown');
    const response = await post(`/api/episodes/${id}/mutations`, selectMutation([INVENTED]));

    assert.equal(response.status, 422, 'an unknown structure id was not refused');
    const body = ApiErrorSchema.parse(await response.json());
    assert.equal(body.error, 'unknown_structure');
    assert.notEqual(body.error, 'internal_error', 'a client error surfaced as a server fault');
    assert.equal(body.structureId, INVENTED, 'the refusal does not say which id was rejected');

    assert.equal(
      await rawField(id, 'location.userSelectedStructureIds'),
      undefined,
      'an unknown structure id reached the field store',
    );
  });

  test('B. MCP select_structure: the SAME refusal for the SAME id', async () => {
    const episode = await mcpEpisode('identity-mcp-unknown');
    const result = await callTool('select_structure', {
      episodeId: episode.id,
      structureIds: [INVENTED],
    });

    assert.equal(result.ok, false);
    if (!result.ok) {
      assert.equal(result.error.code, 'unknown_structure');
      assert.notEqual(result.error.code, 'internal_error');
    }

    assert.equal(
      await rawField(episode.id, 'location.userSelectedStructureIds'),
      undefined,
      'an unknown structure id reached the field store',
    );
  });

  test('the two surfaces return the SAME code and status for one request', async () => {
    // The parity claim itself, as a single assertion: identical input, identical refusal.
    const id = await httpEpisode('identity-parity');
    const episode = await mcpEpisode('identity-parity-mcp');

    const http = await post(`/api/episodes/${id}/mutations`, selectMutation([INVENTED]));
    const httpBody = ApiErrorSchema.parse(await http.json());
    const mcp = await callTool('select_structure', {
      episodeId: episode.id,
      structureIds: [INVENTED],
    });

    assert.equal(http.status, 422);
    assert.equal(mcp.ok, false);
    if (!mcp.ok) assert.equal(mcp.error.code, httpBody.error);
  });

  test('C. consideredStructures: an unknown candidate id is refused centrally too', async () => {
    // The OTHER identity-bearing field. A fix that only covered the selection set would
    // leave a model free to invent a candidate structure, and a candidate is what a summary
    // would render under "considered".
    const id = await httpEpisode('identity-candidate-unknown');
    const response = await post(`/api/episodes/${id}/mutations`, {
      mutations: [
        {
          fieldPath: 'consideredStructures',
          value: [{ structureId: INVENTED, rationale: 'looked like it', confidence: 0.4 }],
          provenance: candidateProv(),
        },
      ],
    });

    assert.equal(response.status, 422);
    const body = ApiErrorSchema.parse(await response.json());
    assert.equal(body.error, 'unknown_structure');
    assert.equal(body.structureId, INVENTED);
    assert.equal(
      await rawField(id, 'consideredStructures'),
      undefined,
      'an unknown candidate reached the field store',
    );
  });

  test('one bad id in an otherwise valid batch rolls the whole batch back', async () => {
    // Atomicity, with the new refusal in the middle of it: a candidate list where only the
    // second id is invented must persist NEITHER. A partial write here would leave a
    // suggestion list that silently lost entries.
    const id = await httpEpisode('identity-atomic');
    const response = await post(`/api/episodes/${id}/mutations`, {
      mutations: [
        {
          fieldPath: 'consideredStructures',
          value: [
            { structureId: CURRENT, rationale: 'on the bone', confidence: 0.5 },
            { structureId: INVENTED, rationale: 'invented', confidence: 0.3 },
          ],
          provenance: candidateProv(),
        },
      ],
    });
    assert.equal(response.status, 422);
    assert.equal(
      await rawField(id, 'consideredStructures'),
      undefined,
      'a rejected batch left a partial write behind',
    );
  });

  test('an unknown id is refused even when it is the ONLY thing wrong', async () => {
    // Guards against the refusal being an artefact of some other rule firing first. The id
    // is well-formed, the provenance is legal, and the field is writable.
    const episode = await mcpEpisode('identity-isolated');
    const result = await callTool('select_structure', {
      episodeId: episode.id,
      structureIds: [CURRENT, INVENTED],
    });
    assert.equal(result.ok, false);
    if (!result.ok) assert.equal(result.error.code, 'unknown_structure');
    assert.equal(await rawField(episode.id, 'location.userSelectedStructureIds'), undefined);
  });
});

describe('current and retired ids are still accepted', () => {
  test('D. a retired id is accepted and stored canonical, on both surfaces', async () => {
    const httpId = await httpEpisode('identity-retired-http');
    const viaMcp = await mcpEpisode('identity-retired-mcp');

    assert.equal((await post(`/api/episodes/${httpId}/mutations`, selectMutation([RETIRED]))).status, 200);
    ok(
      (await callTool('select_structure', {
        episodeId: viaMcp.id,
        structureIds: [RETIRED],
      })) as never,
    );

    // The raw row, on both. The projection would show the canonical id either way, which is
    // exactly why it cannot be the thing this test reads.
    assert.deepEqual(await rawField(httpId, 'location.userSelectedStructureIds'), [CANONICAL]);
    assert.deepEqual(await rawField(viaMcp.id, 'location.userSelectedStructureIds'), [CANONICAL]);
  });

  test('E. a current canonical id is accepted unchanged', async () => {
    const httpId = await httpEpisode('identity-current-http');
    const viaMcp = await mcpEpisode('identity-current-mcp');

    assert.equal((await post(`/api/episodes/${httpId}/mutations`, selectMutation([CURRENT]))).status, 200);
    ok(
      (await callTool('select_structure', {
        episodeId: viaMcp.id,
        structureIds: [CURRENT],
      })) as never,
    );

    assert.deepEqual(await rawField(httpId, 'location.userSelectedStructureIds'), [CURRENT]);
    assert.deepEqual(await rawField(viaMcp.id, 'location.userSelectedStructureIds'), [CURRENT]);
  });

  test('a retired id and its canonical form are ONE point, after resolution', async () => {
    // Order matters here: resolution has to happen BEFORE dedup, or the two spellings
    // survive as two entries and the summary tells a clinician the user pointed at the same
    // structure twice.
    const id = await httpEpisode('identity-collapse');
    const response = await post(
      `/api/episodes/${id}/mutations`,
      selectMutation([RETIRED, CANONICAL, CURRENT]),
    );
    assert.equal(response.status, 200);
    assert.deepEqual(await rawField(id, 'location.userSelectedStructureIds'), [CANONICAL, CURRENT]);
  });

  test('a candidate with a retired id is stored canonical', async () => {
    const id = await httpEpisode('identity-candidate-retired');
    const response = await post(`/api/episodes/${id}/mutations`, {
      mutations: [
        {
          fieldPath: 'consideredStructures',
          value: [{ structureId: RETIRED, rationale: 'top of the shoulder', confidence: 0.5 }],
          provenance: candidateProv(),
        },
      ],
    });
    assert.equal(response.status, 200);
    const stored = (await rawField(id, 'consideredStructures')) as { structureId: string }[];
    assert.equal(stored[0]?.structureId, CANONICAL);
  });

  test('a non-identity field is untouched by the identity boundary', async () => {
    // The boundary is scoped by field path. `location.side` carries a string that is not an
    // anatomical identity, and treating it as one would refuse ordinary values.
    const id = await httpEpisode('identity-non-identity');
    const response = await post(`/api/episodes/${id}/mutations`, {
      mutations: [
        {
          fieldPath: 'location.side',
          value: 'left',
          provenance: { sourceType: 'user_statement', verificationStatus: 'unverified', createdBy: 'user' },
        },
      ],
    });
    assert.equal(response.status, 200);
    assert.equal(await rawField(id, 'location.side'), 'left');
  });
});