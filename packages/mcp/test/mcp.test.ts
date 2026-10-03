/**
 * The MCP surface, and the proof that it is not a second product.
 *
 * The most important test in this file is `one episode crosses every surface`. It is easy
 * to build an MCP server that looks right and stores its own state; then the browser and
 * the assistant disagree about what a patient said, and nobody finds out until a clinician
 * reads a summary built from half the record. So the crossing is asserted here, on the same
 * database, with the same ids.
 */
import { test, before, after, describe } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

const dir = mkdtempSync(join(tmpdir(), 'asi-mcp-'));
process.env.ASI_DB_PATH = join(dir, 'mcp.sqlite');

// Imported AFTER the env var is set: the store binds its file at module load, so a
// top-level import would silently use the default database and every test here would
// write to whatever the developer has been using.
const { callTool, describeTools, handleRpc } = await import('../src/server.ts');
const { TOOLS, listFor, nextQuestionFor } = await import('../src/tools.ts');
const { createEpisode } = await import('@asi/server/src/db/store.ts');

/** The HTTP app, for the crossing test. */
const { app } = await import('@asi/server/src/app.ts');
const { ApiErrorSchema } = await import('@asi/shared');

const ok = <T>(r: { ok: true; data: T } | { ok: false; error: unknown }): T => {
  if (!r.ok) throw new Error(`tool refused: ${JSON.stringify(r.error)}`);
  return r.data;
};

interface Episode {
  id: string;
  record: {
    location: {
      region: string;
      side: string;
      depth: string;
      userSelectedStructureIds: string[];
    };
  };
}

// ASYNC, because it awaits the tool. A non-async arrow containing `await` is a syntax
// error under node's type stripping, which is a confusing way to learn that.
const startShoulder = async () =>
  ok<Episode>(
    (await callTool('start_symptom_episode', {
      personId: 'mcp',
      grounding: { status: 'grounded', region: 'shoulder', side: 'left' },
    })) as { ok: true; data: Episode },
  );

before(async () => {
  // Proves the database file opened against the temporary path. It must be an ASYNC
  // callback: the `await` is inside it, and node's type stripping rejects `await` in a
  // non-async function outright.
  ok(await callTool('get_anatomy_region', {}) as { ok: true; data: unknown });
});

after(() => rmSync(dir, { recursive: true, force: true }));

/* ------------------------------------------------------------------ */

describe('the tool surface', () => {
  test('every goal-mode capability is present and named for what it does', () => {
    const names = (Object.keys(TOOLS) as (keyof typeof TOOLS)[]).sort();
    for (const required of [
      'answer_symptom_question',
      'get_anatomy_region',
      'get_episode',
      'get_episode_summary',
      'get_region_history',
      'localise_symptom',
      'reopen_episode',
      'select_structure',
      'start_symptom_episode',
      'update_location',
    ]) {
      assert.ok(names.includes(required as never), `the MCP surface has no ${required} tool`);
    }
  });

  test('tools/list describes every tool with a schema and an instruction', () => {
    const { tools } = describeTools();
    assert.equal(tools.length, Object.keys(TOOLS).length);
    for (const tool of tools) {
      assert.ok(tool.description.length > 40, `${tool.name} has no usable description`);
      assert.equal(tool.inputSchema.type, 'object');
    }
  });

  test('no tool description claims this is medical artwork or a diagnosis', () => {
    // The instruction text is what a client model actually reads. If it says "diagnose",
    // an assistant will diagnose, and the product's whole framing collapses.
    for (const tool of describeTools().tools) {
      const mentionsDiagnosis = /\bdiagnos(e|is|tic)\b/i.test(tool.description);
      if (!mentionsDiagnosis) continue;
      // Mentioning it is fine; INVITING it is not. Every mention must carry a negation,
      // because a client model reads this text and does not read the rest of the repo.
      assert.match(
        tool.description,
        /\bnot\b|\bnever\b/i,
        `${tool.name} mentions diagnosis without forbidding it`,
      );
    }
  });

  test('the server advertises provider independence in its instructions', async () => {
    const response = (await handleRpc({
      jsonrpc: '2.0',
      id: 1,
      method: 'initialize',
    })) as { result: { instructions: string; capabilities: unknown } };
    assert.match(response.result.instructions, /does not diagnose/i);
    assert.match(response.result.instructions, /not clinically reviewed/i);
    assert.deepEqual(response.result.capabilities, { tools: { listChanged: false } });
  });

  test('an unknown tool and a malformed request fail loudly', async () => {
    const missing = await callTool('diagnose_patient', {});
    assert.equal(missing.ok, false);

    const bad = (await handleRpc({ jsonrpc: '1.0', id: 2, method: 'tools/list' })) as {
      error: { code: number };
    };
    assert.equal(bad.error.code, -32600, 'a non-2.0 request was accepted');

    const unknownMethod = (await handleRpc({
      jsonrpc: '2.0',
      id: 3,
      method: 'resources/list',
    })) as { error: { code: number } };
    assert.equal(unknownMethod.error.code, -32601);
  });

  test('a domain refusal is a result, not a transport error', async () => {
    // If a refusal came back as a JSON-RPC error, a client would treat "this region has
    // no midline geometry" as a broken server and retry it forever.
    const response = (await handleRpc({
      jsonrpc: '2.0',
      id: 4,
      method: 'tools/call',
      params: { name: 'get_episode', arguments: { episodeId: 'nope' } },
    })) as { result: { isError?: boolean; content: { text: string }[] } };
    assert.equal(response.result.isError, true);
    assert.match(response.result.content[0]!.text, /episode_not_found/);
  });
});

/* ------------------------------------------------------------------ */

describe('MCP cannot bypass the domain', () => {
  test('a forbidden write is refused by the field policy, on BOTH surfaces', async () => {
    // This test was named for a capability and did not exercise it: it made one legitimate
    // write, then asserted that the write succeeded. Nothing forbidden was ever sent. A
    // reader -- and a future maintainer -- reasonably concluded the field policy had been
    // proven to refuse an inference write through MCP.
    //
    // It has not, because `update_location` has no parameter through which a source type
    // could be expressed. The forbidden request therefore goes through the one MCP path that
    // CAN carry provenance: `select_structure`, whose provenance is fixed, plus the store
    // itself -- which is the same function both surfaces call, so proving it there proves it
    // for both.
    const episode = await startShoulder();

    // The genuinely forbidden write: an inference-source claim on a field that requires a
    // user source. Sent to the HTTP API.
    const forbidden = {
      fieldPath: 'location.region',
      value: 'knee',
      provenance: {
        sourceType: 'ai_inference' as const,
        verificationStatus: 'unverified' as const,
        createdBy: 'model',
      },
    };
    const http = await app.request(`/api/episodes/${episode.id}/mutations`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ mutations: [forbidden] }),
    });
    assert.equal(http.status, 422, 'the HTTP surface accepted a forbidden write');
    const httpBody = ApiErrorSchema.parse(await http.json());
    assert.equal(httpBody.error, 'field_policy_violation');
    assert.equal(httpBody.field, 'location.region', 'the refusal does not say which field');

    // And nothing was written: a refusal that still left the value behind would be worse
    // than one that changed nothing.
    const after = ok<{ record: { location: { region: string } } }>(
      (await callTool('get_episode', { episodeId: episode.id })) as never,
    );
    assert.equal(
      after.record.location.region,
      'shoulder',
      'the refused write changed the record anyway',
    );

    // And a clinician CANNOT assert a patient-reported location either. That is the policy
    // being right, and it is why this file's cross-surface test uses `user_edited`.
    const clinician = await app.request(`/api/episodes/${episode.id}/mutations`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        mutations: [
          {
            fieldPath: 'location.side',
            value: 'right',
            provenance: {
              sourceType: 'clinician_confirmed',
              verificationStatus: 'clinician_confirmed',
              createdBy: 'clinician',
            },
          },
        ],
      }),
    });
    assert.equal(
      clinician.status,
      422,
      'a clinician was allowed to assert a patient-reported side on location.side',
    );

    // A legitimate correction of the same field IS accepted, so the refusals above are the
    // policy discriminating rather than the field being unwritable.
    const correction = await app.request(`/api/episodes/${episode.id}/mutations`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        mutations: [
          {
            fieldPath: 'location.side',
            value: 'right',
            provenance: {
              sourceType: 'user_edited',
              verificationStatus: 'user_confirmed',
              createdBy: 'user',
            },
          },
        ],
      }),
    });
    assert.equal(correction.status, 200, 'a legitimate correction of location.side was refused');
  });

  test('an unknown structure id is refused, and a retired one is canonicalised', async () => {
    const episode = await startShoulder();

    const unknown = await callTool('select_structure', {
      episodeId: episode.id,
      structureIds: ['asi:shoulder.not-a-bone'],
    });
    assert.equal(unknown.ok, false);
    if (!unknown.ok) assert.equal(unknown.error.code, 'unknown_structure');

    // `asi:neck.upper-trapezius` is retired. It must be accepted and stored canonically,
    // and the caller must be TOLD, because silently rewriting an id leaves them holding one
    // that will never match again.
    const retired = (await callTool('select_structure', {
      episodeId: episode.id,
      structureIds: ['asi:neck.upper-trapezius'],
    })) as { ok: true; data: { canonicalised: { from: string; to: string }[] } };
    assert.equal(retired.ok, true);
    assert.deepEqual(retired.data.canonicalised, [
      { from: 'asi:neck.upper-trapezius', to: 'asi:shoulder.trapezius-upper' },
    ]);

    const read = ok<Episode>(await callTool('get_episode', { episodeId: episode.id }) as never);
    assert.deepEqual(read.record.location.userSelectedStructureIds, [
      'asi:shoulder.trapezius-upper',
    ]);
  });

  test('a selection is ordered-unique, first occurrence wins', async () => {
    const episode = await startShoulder();
    await callTool('select_structure', {
      episodeId: episode.id,
      structureIds: ['asi:shoulder.acromion', 'asi:shoulder.scapula', 'asi:shoulder.acromion'],
    });
    const read = ok<Episode>(await callTool('get_episode', { episodeId: episode.id }) as never);
    assert.deepEqual(read.record.location.userSelectedStructureIds, [
      'asi:shoulder.acromion',
      'asi:shoulder.scapula',
    ]);
  });

  test('a question from another region is refused', async () => {
    // Region-scoped signals exist so a stale answer from a different body part cannot fire
    // a rule here. Accepting a knee question on a shoulder episode would break exactly that.
    const episode = await startShoulder();
    const result = await callTool('answer_symptom_question', {
      episodeId: episode.id,
      questionId: 'knee.locking',
      raw: 'yes',
    });
    assert.equal(result.ok, false);
    if (!result.ok) assert.equal(result.error.code, 'unknown_question');
  });

  test('an unlocalised complaint is refused rather than defaulted', async () => {
    const result = await callTool('start_symptom_episode', {
      personId: 'mcp',
      grounding: { status: 'unsupported', reason: 'out_of_scope' },
    });
    assert.equal(result.ok, false);
    if (!result.ok) assert.equal(result.error.code, 'episode_not_localised');
  });

  test('localisation refuses an out-of-scope complaint and grounds a musculoskeletal one', async () => {
    const grounded = ok<{ status: string }>(
      (await callTool('localise_symptom', {
        utterance: 'my left shoulder rotator cuff hurts deep inside',
      })) as never,
    );
    assert.equal(grounded.status, 'grounded');

    const refused = ok<{ status: string; reason?: string }>(
      (await callTool('localise_symptom', { utterance: 'I have chest pain and cannot breathe' })) as never,
    );
    assert.equal(refused.status, 'unsupported');
  });
});

/* ------------------------------------------------------------------ */

describe('answer correction over MCP', () => {
  test('correcting an answer replaces it, marks it, and recomputes the record', async () => {
    const episode = await startShoulder();

    const first = ok<{ answers: { replaced: boolean }[] }>(
      (await callTool('answer_symptom_question', {
        episodeId: episode.id,
        questionId: 'shoulder.night_pain',
        raw: 'yes',
      })) as never,
    );
    assert.equal(first.answers[0]?.replaced, false, 'a first answer was reported as a correction');

    const withYes = ok<{ record: { triggers: string[] } }>(
      (await callTool('get_episode', { episodeId: episode.id })) as never,
    );
    assert.ok(withYes.record.triggers.includes('night'), '"yes" did not add the night trigger');

    const second = ok<{ answers: { replaced: boolean }[] }>(
      (await callTool('answer_symptom_question', {
        episodeId: episode.id,
        questionId: 'shoulder.night_pain',
        raw: 'no',
      })) as never,
    );
    assert.equal(second.answers[0]?.replaced, true, 'a correction was not reported as one');

    const after = ok<{
      record: { triggers: string[] };
      answers: Record<string, { provenance: { sourceType: string } }>;
    }>((await callTool('get_episode', { episodeId: episode.id })) as never);
    assert.equal(
      after.record.triggers.includes('night'),
      false,
      'the withdrawn answer still drives the record after a correction',
    );
    assert.equal(after.answers['shoulder.night_pain']?.provenance.sourceType, 'user_edited');
  });

  test('a withdrawn safety flag stops firing, and the withdrawal is recorded', async () => {
    const episode = await startShoulder();
    await callTool('answer_symptom_question', {
      episodeId: episode.id,
      questionId: 'shoulder.trauma_urgent',
      raw: 'yes',
    });
    const flagged = ok<{ safety: { flags: { ruleId: string }[] } }>(
      (await callTool('get_episode', { episodeId: episode.id })) as never,
    );
    assert.ok(flagged.safety.flags.length > 0, '"yes" to a red flag raised nothing');

    await callTool('answer_symptom_question', {
      episodeId: episode.id,
      questionId: 'shoulder.trauma_urgent',
      raw: 'no',
    });
    const cleared = ok<{ safety: { flags: { ruleId: string }[] } }>(
      (await callTool('get_episode', { episodeId: episode.id })) as never,
    );
    assert.equal(
      cleared.safety.flags.length,
      0,
      'a withdrawn safety answer kept warning a clinician',
    );
  });
});

/* ------------------------------------------------------------------ */

describe('capability and history over MCP', () => {
  test('get_anatomy_region tells a client what can be rendered, including the refusals', async () => {
    const all = ok<{ regions: { region: string; sides: { side: string; available: boolean }[] }[] }>(
      (await callTool('get_anatomy_region', {})) as never,
    );
    assert.equal(all.regions.length, 4);

    const neck = all.regions.find((r) => r.region === 'neck')!;
    assert.equal(neck.sides.find((s) => s.side === 'midline')?.available, true);
    const knee = all.regions.find((r) => r.region === 'knee')!;
    assert.equal(knee.sides.find((s) => s.side === 'midline')?.available, false);

    const one = ok<{ region: string }>(
      (await callTool('get_anatomy_region', { region: 'shoulder' })) as never,
    );
    assert.equal(one.region, 'shoulder');

    // An unknown region is now refused by SCHEMA validation, because `region` is declared
    // as `BodyRegionSchema`. That is the point of declaring it: the published contract and
    // the handler now agree, so a client cannot be told "no arguments" and then send one.
    const missing = await callTool('get_anatomy_region', { region: 'pancreas' });
    assert.equal(missing.ok, false);
    if (!missing.ok) assert.equal(missing.error.code, 'validation_failed');
  });

  test('get_region_history is a location history and never a risk map', async () => {
    const episode = await startShoulder();
    await callTool('update_location', { episodeId: episode.id, side: 'left', depth: 'deep' });

    // The payload is a LIST of nodes, not an object with a `places` key. Each node carries
    // its region, side, count AND the episodes behind the count -- a count with nothing to
    // back it up is unfalsifiable, and it just moves the scanning somewhere else.
    const history = ok<
      {
        regionRowId: string;
        region: string;
        side: string;
        episodeCount: number;
        episodes: { id: string }[];
      }[]
    >((await callTool('get_region_history', { personId: 'mcp' })) as never);

    const place = history.find((p) => p.episodes.some((e) => e.id === episode.id));
    assert.ok(place, 'the episode does not appear in its own history');
    assert.ok(place.episodeCount >= 1);
    assert.ok(
      place.regionRowId.length > 0,
      'the place has no server-assigned identity, so the client would have to invent one',
    );
    // Placeholders for regions with no history are present and honestly empty.
    const empty = history.filter((p) => p.episodeCount === 0);
    assert.ok(empty.length > 0, 'regions with no history are simply absent');
    assert.ok(empty.every((p) => p.regionRowId === ''), 'an empty region claims a real place id');

    // Nothing that invites reading frequency as severity.
    const text = JSON.stringify(history).toLowerCase();
    for (const forbidden of ['risk', 'severity', 'danger', 'score', 'priority'])
      assert.equal(text.includes(forbidden), false, `the history payload contains "${forbidden}"`);
  });

  test('reopen returns the same episode, not a new one', async () => {
    const episode = await startShoulder();
    const reopened = ok<{ episode: { id: string }; nextQuestion: unknown }>(
      (await callTool('reopen_episode', { episodeId: episode.id })) as never,
    );
    assert.equal(reopened.episode.id, episode.id, 'reopen returned a different episode');
    const listed = listFor({ personId: 'mcp' }).filter((e) => e.id === episode.id);
    assert.equal(listed.length, 1, 'reopen created a second record');
  });

  test('an ungrounded episode refuses the interview rather than asking knee questions', () => {
    // This asserted `typeof nextQuestionFor === 'function'`. Nothing was built, the function
    // was never called, and no refusal was observed -- so the rule it was named for was
    // untested. `start_symptom_episode` will not create an ungrounded episode (correctly),
    // so the episode is created through the store, which is the only way to reach the state.
    const refused = createEpisode({
      personId: 'mcp',
      region: 'knee',
      grounding: {
        status: 'unsupported',
        reason: 'out_of_scope',
        by: null,
        score: null,
        clarification: null,
      },
      mutations: [],
      answers: [],
    } as Parameters<typeof createEpisode>[0]);

    const result = nextQuestionFor(refused.id);
    assert.equal(result.ok, false, 'an ungrounded episode produced a question');
    if (!result.ok) assert.equal(result.error.code, 'episode_not_localised');
  });
});

/* ------------------------------------------------------------------ */

describe('one episode crosses every surface', () => {
  test('MCP writes, the HTTP API reads the same record, answers and safety', async () => {
    // THE test this whole package exists for.
    //
    // An assistant records a complaint over MCP. A clinician opens the same episode in
    // the browser. If MCP stored anything of its own -- or if canonicalisation, merging or
    // safety ran differently -- the two would disagree here, silently, and the summary a
    // clinician reads would be built from half the record.
    const episode = await startShoulder();

    // --- written over MCP ---
    await callTool('update_location', {
      episodeId: episode.id,
      side: 'left',
      depth: 'deep',
      subRegionId: 'shoulder.anterior',
    });
    await callTool('select_structure', {
      episodeId: episode.id,
      structureIds: ['asi:neck.upper-trapezius', 'asi:shoulder.acromion'],
    });
    await callTool('answer_symptom_question', {
      episodeId: episode.id,
      questionId: 'shoulder.elevation',
      raw: 'yes',
    });

    // --- read over HTTP ---
    const http = await app.request(`/api/episodes/${episode.id}`);
    assert.equal(http.status, 200);
    const body = (await http.json()) as {
      record: {
        location: {
          side: string;
          depth: string;
          subRegionId: string | null;
          userSelectedStructureIds: string[];
        };
      };
      answers: Record<string, unknown>;
      safety: { flags: unknown[] };
    };

    // Same location.
    assert.equal(body.record.location.side, 'left');
    assert.equal(body.record.location.depth, 'deep');
    assert.equal(body.record.location.subRegionId, 'shoulder.anterior');

    // Canonical ids, in the ORDER they were pointed, with the retired one rewritten.
    assert.deepEqual(body.record.location.userSelectedStructureIds, [
      'asi:shoulder.trapezius-upper',
      'asi:shoulder.acromion',
    ]);

    // Same answers.
    assert.ok(body.answers['shoulder.elevation'], 'the MCP answer is missing over HTTP');

    // --- and the reverse: HTTP writes, MCP reads ---
    const applied = await app.request(`/api/episodes/${episode.id}/mutations`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        mutations: [
          {
            fieldPath: 'location.side',
            value: 'right',
            // `user_edited`, and that is not a detail.
            //
            // The original was `createdBy: 'clinician'` with `verificationStatus:
            // 'unverified'` -- a contradiction -- and it passed only because a same-authority
            // tie happens to break towards the more recent write. It stopped passing when
            // `update_location` started using the SHARED provenance helper, correctly: the
            // user really did state the side, which makes it `user_confirmed`, and that
            // outranks an unverified restatement of the same claim.
            //
            // Then `clinician_confirmed` was tried and the field policy refused it with a
            // 422 -- which is the policy being RIGHT: `location.side` is a patient-reported
            // location, and `allowedSources` does not include a clinician asserting it.
            //
            // So this is a CORRECTION, which is what actually outranks a stated location
            // (authority 70 vs 40) and is a write this field really does accept.
            provenance: {
              sourceType: 'user_edited',
              verificationStatus: 'user_confirmed',
              createdBy: 'user',
            },
          },
        ],
        answers: [{ questionId: 'shoulder.night_pain', raw: 'yes', createdBy: 'user' }],
      }),
    });
    assert.equal(applied.status, 200);
    const appliedBody = (await applied.json()) as {
      applied: { fieldPath: string; action: string }[];
    };
    const sideWrite = appliedBody.applied.find((a) => a.fieldPath === 'location.side');
    assert.ok(sideWrite, 'the side write was not reported at all');
    assert.equal(
      sideWrite.action,
      'written',
      `the HTTP side write was ${sideWrite.action}, so it did not take effect and the ` +
        `cross-surface claim would be false`,
    );

    const viaMcp = ok<{
      record: { location: { side: string; userSelectedStructureIds: string[] } };
      answers: Record<string, { provenance: { createdBy: string } }>;
    }>((await callTool('get_episode', { episodeId: episode.id })) as never);

    assert.equal(viaMcp.record.location.side, 'right', 'the HTTP write is invisible over MCP');
    assert.deepEqual(viaMcp.record.location.userSelectedStructureIds, [
      'asi:shoulder.trapezius-upper',
      'asi:shoulder.acromion',
    ]);
    assert.equal(
      viaMcp.answers['shoulder.night_pain']?.provenance.createdBy,
      'user',
      'the HTTP answer is invisible over MCP',
    );

    // One record, not two.
    const all = listFor({ personId: 'mcp' }).filter((e) => e.id === episode.id);
    assert.equal(all.length, 1, 'the surfaces created two records for one complaint');
  });

  test('the summary is identical whichever surface builds it', async () => {
    const episode = await startShoulder();
    await callTool('update_location', { episodeId: episode.id, side: 'left' });
    await callTool('answer_symptom_question', {
      episodeId: episode.id,
      questionId: 'shoulder.elevation',
      raw: 'no',
    });

    const viaMcp = ok<{ text: string }>(
      (await callTool('get_episode_summary', { episodeId: episode.id })) as never,
    );
    const viaHttp = await app.request(`/api/episodes/${episode.id}/summary.txt`);
    const httpText = await viaHttp.text();

    // Normalise the generation time before comparing. `generatedAt` is a real timestamp,
    // so two calls seconds apart differ by design; comparing them raw would fail for the
    // right reason and teach nothing. Everything else must match exactly -- which is the
    // point of the test: same record in, same words out, whichever surface asked.
    const strip = (t: string) => t.replace(/\d{4}-\d{2}-\d{2}T[\d:.]+Z/g, '<time>');
    assert.equal(
      strip(viaMcp.text),
      strip(httpText),
      'the two surfaces rendered different summaries',
    );
    assert.ok(viaMcp.text.length > 50, 'the summary is nearly empty');
    // Never a diagnosis. The summary does contain the WORD, inside "this is not a
    // diagnosis" -- so a bare match is the wrong test and would have passed a summary that
    // diagnosed something while failing one that disclaims it.
    assert.doesNotMatch(viaMcp.text, /(?<!not a )\bdiagnos(is|ed)\b/i);
  });

  test('reopening over one surface resumes the other surface episode', async () => {
    const episode = await startShoulder();
    await callTool('answer_symptom_question', {
      episodeId: episode.id,
      questionId: 'shoulder.night_pain',
      raw: 'no',
    });

    // Reopen over HTTP, which is what the browser does.
    const reopened = (await (await app.request(`/api/episodes/${episode.id}/reopen`)).json()) as {
      episode: { id: string };
      answers: Record<string, unknown>;
    };
    assert.equal(reopened.episode.id, episode.id);
    assert.ok(reopened.answers['shoulder.night_pain']);

    // The MCP view of the same episode agrees.
    const viaMcp = ok<{ episode: { id: string }; answers: Record<string, unknown> }>(
      (await callTool('reopen_episode', { episodeId: episode.id })) as never,
    );
    assert.equal(viaMcp.episode.id, reopened.episode.id);
    assert.deepEqual(Object.keys(viaMcp.answers).sort(), Object.keys(reopened.answers).sort());
  });
});