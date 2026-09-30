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
  BodyRegionSchema,
  FieldPolicyError,
  groundFromText,
  groundOrRefuse,
  INTERVIEW,
  nextQuestion,
  questionProgress,
  REGIONS,
  releaseReady,
  SourceTypeSchema,
  totalRuleCount,
  VerificationStatusSchema,
  writablePaths,
  ANSWER_SCHEMA_NOTE,
} from '@asi/shared';
import { env, gate, hasModel, releaseProfile } from './env.ts';
import { createOrchestrator } from './orchestrator/index.ts';
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
type ParsedMutation = z.infer<typeof MutationInput>;
type ParsedAnswer = z.infer<typeof AnswerInput>;

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
  if (!r) return c.json({ error: 'unknown region' }, 404);
  return c.json(r);
});

/* ---------------- grounding / routing ---------------- */

const LocaliseBody = z.object({
  utterance: z.string().min(1).max(2000),
  pinnedRegion: BodyRegionSchema.optional(),
});

app.post('/api/localise', async (c) => {
  const body = LocaliseBody.safeParse(await c.req.json());
  if (!body.success) return c.json({ error: body.error.flatten() }, 400);
  // Returns either a grounded result or an explicit refusal. There is no
  // default region, so a caller cannot proceed without handling 'unsupported'.
  return c.json(await orchestrator.localise(body.data));
});

/* ---------------- interview ---------------- */

app.get('/api/interview/:region', (c) => {
  const region = c.req.param('region') as keyof typeof INTERVIEW;
  if (!INTERVIEW[region]) return c.json({ error: 'unknown region' }, 404);
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

const ProvenanceInput = z.object({
  sourceType: SourceTypeSchema,
  verificationStatus: VerificationStatusSchema,
  createdBy: z.string().min(1).max(120),
  sourceReference: z.string().max(200).nullish(),
  confidence: z.number().min(0).max(1).nullish(),
  rawText: z.string().max(4000).nullish(),
  evidenceStatus: z.enum(['user_report', 'visual_selection', 'ai_candidate', 'clinician_finding', 'system_derived']).optional(),
});

const MutationInput = z.object({
  fieldPath: z.string().min(1).max(120),
  value: z.unknown(),
  provenance: ProvenanceInput,
});

const AnswerInput = z.object({
  questionId: z.string().min(1).max(120),
  raw: z.unknown(),
  wroteFields: z.array(z.string().max(120)).max(16).default([]),
  createdBy: z.string().min(1).max(120),
  rawText: z.string().max(4000).nullish(),
});

const CreateEpisodeBody = z.object({
  personId: z.string().min(1).max(120).default('local'),
  displayName: z.string().max(200).optional(),
  title: z.string().max(300).optional(),
  side: z.enum(['left', 'right', 'midline', 'bilateral', 'unknown']).optional(),
  /** Where localisation landed. Required, and must be a real outcome. */
  grounding: z.discriminatedUnion('status', [
    z.object({
      status: z.literal('grounded'),
      region: BodyRegionSchema,
      side: z.enum(['left', 'right', 'midline', 'bilateral', 'unknown']).optional(),
      by: z.enum(['deterministic', 'model']).optional(),
      score: z.number().min(0).max(1).nullish(),
      clarification: z.string().max(240).nullish(),
    }),
    z.object({
      status: z.literal('unsupported'),
      reason: z.enum(['ungrounded', 'out_of_scope']),
    }),
  ]),
  mutations: z.array(MutationInput).max(64).default([]),
  answers: z.array(AnswerInput).max(64).default([]),
});

app.post('/api/episodes', async (c) => {
  const body = CreateEpisodeBody.safeParse(await c.req.json());
  if (!body.success) return c.json({ error: body.error.flatten() }, 400);
  const g = body.data.grounding;

  if (g.status === 'unsupported') {
    return c.json(
      {
        error: 'episode_not_localised',
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
    if (e instanceof FieldPolicyError) {
      return c.json({ error: 'field_policy_violation', field: e.path, reason: e.message }, 422);
    }
    if (e instanceof MutationRejected) return c.json({ error: e.message }, 404);
    throw e;
  }
});

/**
 * THE write path. Every field change in the product goes through here.
 * Validation, provenance checks, the claim-class merge, the field row, the
 * preserved assertions, the record projection and the safety re-evaluation all
 * happen inside one transaction. A rejected mutation rolls the batch back.
 */
const ApplyBody = z.object({
  mutations: z.array(MutationInput).max(64).default([]),
  answers: z.array(AnswerInput).max(64).default([]),
  status: z.enum(['open', 'resolved', 'ongoing', 'archived']).optional(),
});

app.post('/api/episodes/:id/mutations', async (c) => {
  const id = c.req.param('id');
  const body = ApplyBody.safeParse(await c.req.json());
  if (!body.success) return c.json({ error: body.error.flatten() }, 400);
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
    if (e instanceof FieldPolicyError) {
      return c.json({ error: 'field_policy_violation', field: e.path, reason: e.message }, 422);
    }
    if (e instanceof MutationRejected) return c.json({ error: e.message }, 404);
    throw e;
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
  if (!ep) return c.json({ error: 'not found' }, 404);
  return c.json({
    ...ep,
    grounding: getGrounding(id),
    answers: answersFor(id),
    safety: safetyFor(id, releaseProfile),
  });
});

app.post('/api/episodes/:id/note', async (c) => {
  const body = z.object({ text: z.string().min(1).max(4000) }).safeParse(await c.req.json());
  if (!body.success) return c.json({ error: body.error.flatten() }, 400);
  appendTranscript(c.req.param('id'), 'user', body.data.text);
  return c.json({ ok: true });
});

app.get('/api/episodes/:id/prior', (c) => c.json(priorEpisodes(c.req.param('id'))));

app.get('/api/episodes/:id/summary', (c) => {
  const out = summaryFor(c.req.param('id'), releaseProfile);
  if (!out) return c.json({ error: 'not found' }, 404);
  return c.json(out);
});

app.get('/api/episodes/:id/summary.txt', (c) => {
  const out = summaryFor(c.req.param('id'), releaseProfile);
  if (!out) return c.json({ error: 'not found' }, 404);
  return c.text(out.text);
});

/* ---------------- personal health map ---------------- */

app.get('/api/healthmap/:personId', (c) => c.json(healthMap(c.req.param('personId'))));

/* ---------------- offline grounding preview ---------------- */

app.get('/api/ground', (c) => {
  const q = c.req.query('q') ?? '';
  return c.json(groundOrRefuse(q));
});

export { app, ANSWER_SCHEMA_NOTE };
