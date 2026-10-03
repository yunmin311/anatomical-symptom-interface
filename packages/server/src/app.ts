/**
 * HTTP surface. Thin by design: validate, delegate to the store, serialise.
 * No business logic lives in a route handler.
 *
 * NOTABLE REMOVALS, and why:
 *   - `PATCH /api/episodes/:id/record` accepted a whole client-supplied
 *     SymptomRecord and wrote it straight to `record_json`. It is gone. Writing
 *     now goes through `POST /api/episodes/:id/mutations`, which validates each
 *     field against the registry and its provenance, and commits value and
 *     provenance in one transaction.
 *   - `POST /api/episodes/:id/confirm` wrote a provenance row for a field with
 *     no check that the value existed or that the value matched. It is gone.
 *   There is no remaining endpoint through which a client can manufacture a
 *     user-confirmed fact.
 */
import { Hono } from 'hono';
import { cors } from 'hono/cors';
import { z } from 'zod';
import {
  apiError,
  ApplyMutationsRequestSchema,
  anatomyCapability,
  BodyRegionSchema,
  CreateEpisodeRequestSchema,
  FieldPolicyError,
  ProvenanceError,
  groundOrRefuse,
  INTERVIEW,
  LocaliseRequestSchema,
  nextQuestion,
  questionProgress,
  REGIONS,
  releaseReady,
  totalRuleCount,
  validationError,
  writablePaths,
  ANSWER_SCHEMA_NOTE,
  type AnswerInput,
  type FieldMutationInput,
} from '@asi/shared';
import { env, gate, hasModel, releaseProfile } from './env.ts';
import { createOrchestrator } from './orchestrator/index.ts';
import { spatialHistoryWithEmptyRegions } from './db/spatial.ts';
import { BUILT_MANIFESTS } from './anatomy-manifests.ts';
import { episodeForReopen } from './db/episode-lifecycle.ts';
import {
  answersFor,
  appendTranscript,
  applyMutations,
  createEpisode,
  getEpisode,
  getGrounding,
  healthMap,
  listEpisodes,
  MutationRejected,
  priorEpisodes,
  safetyFor,
  summaryFor,
} from './db/store.ts';
import type { AnswerMutation, FieldMutation } from './db/store.ts';
import type { Provenance } from '@asi/shared';

/**
 * Zod infers `z.unknown()` as an OPTIONAL property, because `unknown` includes
 * `undefined`. Spreading the parsed object would therefore let a mutation
 * arrive with no `value` at all, which the field store must never accept. These
 * two builders make the presence explicit and give the compiler a required type.
 */
type ParsedMutation = FieldMutationInput;
type ParsedAnswer = AnswerInput;

function toFieldMutation(m: ParsedMutation): FieldMutation {
  if (!('value' in m)) throw new Error(`[api] mutation for "${m.fieldPath}" has no value`);
  return { fieldPath: m.fieldPath, value: m.value, provenance: { ...m.provenance } as Provenance };
}

function toAnswerMutation(a: ParsedAnswer): AnswerMutation {
  if (!('raw' in a)) throw new Error(`[api] answer for "${a.questionId}" has no raw value`);
  return {
    questionId: a.questionId,
    raw: a.raw,
    wroteFields: a.wroteFields,
    createdBy: a.createdBy,
    rawText: a.rawText ?? null,
    capturedAt: new Date().toISOString(),
  };
}

const app = new Hono();
app.use('*', cors());

/**
 * The ONE place a domain refusal becomes an HTTP response.
 *
 * There were five hand-written error shapes before this, and they disagreed: one route
 * returned `{ error: 'not found' }`, another `{ error: e.message }` -- the message text
 * used AS a code -- and the two the smoke test cares about used real codes. A client could
 * branch on those last two and had to string-match the rest, which is how an MCP client
 * ends up parsing English to find out what happened.
 *
 * Every refusal now carries a stable code from `ApiErrorCodeSchema`, plus a human message
 * and, where it exists, the detail a caller needs to act: the offending field, the
 * canonical id that replaced a retired one, or the validation issues.
 */
function refuse(
  c: { json: (body: unknown, status?: number) => Response },
  code: Parameters<typeof apiError>[0],
  message: string,
  status: number,
  extra: Parameters<typeof apiError>[2] = {},
): Response {
  return c.json(apiError(code, message, extra), status);
}

/** Map a thrown domain refusal onto the envelope. Reused by every write route. */
function refuseThrown(c: { json: (body: unknown, status?: number) => Response }, e: unknown): Response {
  if (e instanceof FieldPolicyError)
    return refuse(c, 'field_policy_violation', e.message, 422, { field: e.path });
  // A broken provenance rule is the SAME class of refusal as a broken field policy: the
  // client sent something the product will not accept. It used to fall through to Hono's
  // default handler and answer HTTP 500 `Internal Server Error`, which told the client the
  // server had faulted and handed it a body it could not parse.
  if (e instanceof ProvenanceError)
    return refuse(c, 'field_policy_violation', e.message, 422, { field: e.field });
  if (e instanceof MutationRejected) return refuse(c, 'mutation_rejected', e.message, 404);
  throw e;
}

const orchestrator = createOrchestrator();

/**
 * Release-safety metadata. CI asserts on these exact field names, so they are
 * declared once here and never renamed without updating the workflow.
 */
app.get('/api/health', (c) =>
  c.json({
    ok: true,
    orchestrator: orchestrator.kind,
    modelAvailable: hasModel(),
    regions: Object.keys(REGIONS),
    releaseProfile,
    releaseReady: gate.ready,
    unreviewedSafetyRules: gate.unreviewed,
    totalSafetyRules: totalRuleCount(),
    blockingSafetyRules: gate.blocking,
    writableFields: writablePaths().length,
    env: { model: env.ASI_MODEL, logLevel: env.ASI_LOG_LEVEL },
  }),
);

/* ---------------- anatomy reference data ---------------- */

app.get('/api/regions', (c) => c.json(Object.values(REGIONS)));
app.get('/api/regions/:region', (c) => {
  const r = REGIONS[c.req.param('region') as keyof typeof REGIONS];
  if (!r) return refuse(c, 'unknown_region', 'No such region in this build.', 404, {
    region: c.req.param('region'),
  });
  return c.json(r);
});

/**
 * What can actually be RENDERED, per region and side.
 *
 * `/api/regions` answers "does this region exist in the ontology", which is not the
 * question a client has before offering a 3D picker. This answers "is there sourced
 * geometry for it, on which sides, and what is missing and why" -- including that the
 * 2D map is a hand-made placeholder.
 *
 * The counts come from the generated manifests the renderer mounts, not from a table of
 * intentions, so a missing build is reported as missing.
 */
app.get('/api/anatomy/capability', (c) => c.json(anatomyCapability(BUILT_MANIFESTS)));

/* ---------------- grounding / routing ---------------- */

app.post('/api/localise', async (c) => {
  const body = LocaliseRequestSchema.safeParse(await c.req.json());
  if (!body.success) return c.json(validationError(body.error), 400);
  // Returns either a grounded result or an explicit refusal. There is no
  // default region, so a caller cannot proceed without handling 'unsupported'.
  return c.json(await orchestrator.localise(body.data));
});

/* ---------------- interview ---------------- */

app.get('/api/interview/:region', (c) => {
  const region = c.req.param('region') as keyof typeof INTERVIEW;
  if (!INTERVIEW[region])
    return refuse(c, 'unknown_region', 'No such region in this build.', 404, {
      region: c.req.param('region'),
    });
  return c.json(INTERVIEW[region]);
});

/**
 * Next question. Refuses for an episode whose grounding was not successful.
 * An unsupported or ungrounded episode must not enter a region-specific
 * musculoskeletal interview.
 */
app.post('/api/episodes/:id/interview/next', async (c) => {
  const id = c.req.param('id');
  const ep = getEpisode(id);
  if (!ep) return c.json({ error: 'not found' }, 404);
  const grounding = getGrounding(id);
  if (!grounding || grounding.status !== 'grounded') {
    return c.json(
      {
        ...apiError('episode_not_localised', grounding?.reason ?? 'ungrounded'),
        next: null,
        blocked: true,
        reason: grounding?.reason ?? 'ungrounded',
        message:
          'This episode was not localised to a supported body region, so the region-specific ' +
          'interview will not run. Locating it safely would require a workflow this build does not have.',
      },
      409,
    );
  }
  const answers = answersFor(id);
  const ctx = { record: ep.record, answers };
  return c.json({ next: nextQuestion(ctx) ?? null, progress: questionProgress(ctx), blocked: false });
});

/* ---------------- episodes ---------------- */

// The request shapes come from `@asi/shared`, NOT from here. They used to be declared in
// this file, which meant an MCP server had no way to validate against them and grew its
// own. One definition, two surfaces.

app.post('/api/episodes', async (c) => {
  const body = CreateEpisodeRequestSchema.safeParse(await c.req.json());
  if (!body.success) return c.json(validationError(body.error), 400);
  const g = body.data.grounding;

  if (g.status === 'unsupported') {
    return c.json(
      {
        ...apiError('episode_not_localised', g.reason),
        reason: g.reason,
        message:
          'This workflow only records shoulder, neck, lower back and knee problems. ' +
          'It did not localise the description, so no episode was created.',
      },
      409,
    );
  }

  try {
    const ep = createEpisode({
      personId: body.data.personId,
      displayName: body.data.displayName,
      region: g.region,
      side: body.data.side ?? g.side,
      title: body.data.title,
      grounding: {
        status: 'grounded',
        reason: null,
        by: g.by ?? null,
        score: g.score ?? null,
        clarification: g.clarification ?? null,
      },
      mutations: body.data.mutations.map(toFieldMutation),
      answers: body.data.answers.map(toAnswerMutation),
    });
    return c.json(ep, 201);
  } catch (e) {
    return refuseThrown(c, e);
  }
});

/**
 * THE write path. Every field change in the product goes through here.
 * Validation, provenance checks, the claim-class merge, the field row, the
 * preserved assertions, the record projection and the safety re-evaluation all
 * happen inside one transaction. A rejected mutation rolls the batch back.
 *
 * ANSWER CORRECTION is this endpoint, not another one. Posting an answer for a question
 * that already has one REPLACES it, and the response says so per question:
 * `answers[].replaced`. The store marks the replacement `user_edited` on its own, from the
 * row, so a client cannot claim a correction that did not happen -- and a client cannot
 * downgrade a real correction either, because the store does not believe the client.
 */
app.post('/api/episodes/:id/mutations', async (c) => {
  const id = c.req.param('id');
  const body = ApplyMutationsRequestSchema.safeParse(await c.req.json());
  if (!body.success) return c.json(validationError(body.error), 400);
  try {
    const outcome = applyMutations(
      id,
      {
        fieldMutations: body.data.mutations.map(toFieldMutation),
        answerMutations: body.data.answers.map(toAnswerMutation),
        status: body.data.status,
      },
      releaseProfile,
    );
    return c.json(outcome);
  } catch (e) {
    return refuseThrown(c, e);
  }
});

app.get('/api/episodes', (c) => {
  const q = c.req.query();
  return c.json(listEpisodes({
    personId: q.personId,
    region: q.region,
    side: q.side,
    limit: q.limit ? Number(q.limit) : undefined,
  }));
});

app.get('/api/episodes/:id', (c) => {
  const id = c.req.param('id');
  const ep = getEpisode(id);
  if (!ep) return refuse(c, 'episode_not_found', `No episode with id ${id}.`, 404);
  return c.json({
    ...ep,
    grounding: getGrounding(id),
    answers: answersFor(id),
    safety: safetyFor(id, releaseProfile),
  });
});

/**
 * Everything a resuming session needs, in one payload: the record, the answers,
 * the next question, how far through the interview the user was, and what is
 * still outstanding.
 *
 * Without this a client reopening an episode has to re-derive the next question
 * and the outstanding set in the browser, which is how a client ends up
 * disagreeing with the server about both. The write path is untouched.
 */
app.get('/api/episodes/:id/reopen', (c) => {
  const out = episodeForReopen(c.req.param('id'), releaseProfile);
  if (!out) return refuse(c, 'episode_not_found', `No episode with id ${c.req.param('id')}.`, 404);
  return c.json(out);
});

app.post('/api/episodes/:id/note', async (c) => {
  const body = z.object({ text: z.string().min(1).max(4000) }).safeParse(await c.req.json());
  if (!body.success) return c.json(validationError(body.error), 400);
  appendTranscript(c.req.param('id'), 'user', body.data.text);
  return c.json({ ok: true });
});

app.get('/api/episodes/:id/prior', (c) => c.json(priorEpisodes(c.req.param('id'))));

app.get('/api/episodes/:id/summary', (c) => {
  const out = summaryFor(c.req.param('id'), releaseProfile);
  if (!out) return refuse(c, 'episode_not_found', `No episode with id ${c.req.param('id')}.`, 404);
  return c.json(out);
});

app.get('/api/episodes/:id/summary.txt', (c) => {
  const out = summaryFor(c.req.param('id'), releaseProfile);
  if (!out) return refuse(c, 'episode_not_found', `No episode with id ${c.req.param('id')}.`, 404);
  return c.text(out.text);
});

/* ---------------- personal health map ---------------- */

app.get('/api/healthmap/:personId', (c) => c.json(healthMap(c.req.param('personId'))));

/**
 * The spatial history read model: every place, its normalised point, and the
 * episodes behind the count, so the client never scans episodes to draw a body.
 *
 * A LOCATION history, not a risk map. Episode count is how often a place was
 * described, and nothing in this payload weighs it against anything.
 */
app.get('/api/healthmap/:personId/spatial', (c) => {
  const limit = c.req.query('limit');
  return c.json(
    spatialHistoryWithEmptyRegions(
      c.req.param('personId'),
      limit ? Math.max(1, Math.min(200, Number(limit))) : undefined,
    ),
  );
});

/* ---------------- offline grounding preview ---------------- */

app.get('/api/ground', (c) => {
  const q = c.req.query('q') ?? '';
  return c.json(groundOrRefuse(q));
});

export { app, ANSWER_SCHEMA_NOTE };
