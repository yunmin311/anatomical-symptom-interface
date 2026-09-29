/**
 * HTTP surface. Thin by design: validate, delegate to the store, serialise.
 * No business logic lives in a route handler.
 */
import { Hono } from 'hono';
import { cors } from 'hono/cors';
import { z } from 'zod';
import {
  BodyRegionSchema,
  buildPreVisitSummary,
  emptyRecord,
  highestSeverity,
  INTERVIEW,
  nextQuestion,
  questionProgress,
  REGIONS,
  SymptomRecordSchema,
  unreviewedRuleCount,
  renderPlainText,
  groundFromText,
} from '@asi/shared';
import { env, hasModel } from './env.ts';
import { createOrchestrator } from './orchestrator/index.ts';
import {
  appendTranscript,
  createEpisode,
  getEpisode,
  healthMap,
  listEpisodes,
  priorEpisodes,
  putProvenance,
  recordField,
  saveRecord,
  summaryFor,
} from './db/store.ts';

const app = new Hono();
app.use('*', cors());

const orchestrator = createOrchestrator();

app.get('/api/health', (c) =>
  c.json({
    ok: true,
    orchestrator: orchestrator.kind,
    modelAvailable: hasModel(),
    regions: Object.keys(REGIONS),
    unreviewedSafetyRules: unreviewedRuleCount(),
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

/* ---------------- grounding ---------------- */

const LocaliseBody = z.object({
  utterance: z.string().min(1).max(2000),
  pinnedRegion: BodyRegionSchema.optional(),
});

app.post('/api/localise', async (c) => {
  const body = LocaliseBody.safeParse(await c.req.json());
  if (!body.success) return c.json({ error: body.error.flatten() }, 400);
  return c.json(await orchestrator.localise(body.data));
});

/* ---------------- interview ---------------- */

app.get('/api/interview/:region', (c) => {
  const region = c.req.param('region') as keyof typeof INTERVIEW;
  if (!INTERVIEW[region]) return c.json({ error: 'unknown region' }, 404);
  return c.json(INTERVIEW[region]);
});

const ProgressBody = z.object({ record: SymptomRecordSchema, asked: z.array(z.string()).default([]) });

app.post('/api/interview/:region/next', async (c) => {
  const region = c.req.param('region') as keyof typeof INTERVIEW;
  if (!INTERVIEW[region]) return c.json({ error: 'unknown region' }, 404);
  const body = ProgressBody.safeParse(await c.req.json());
  if (!body.success) return c.json({ error: body.error.flatten() }, 400);
  const ctx = { record: body.data.record, asked: new Set(body.data.asked) };
  return c.json({ next: nextQuestion(ctx) ?? null, progress: questionProgress(ctx) });
});

/* ---------------- episodes ---------------- */

const CreateEpisodeBody = z.object({
  personId: z.string().min(1).default('local'),
  displayName: z.string().optional(),
  region: BodyRegionSchema,
  side: z.enum(['left', 'right', 'midline', 'bilateral', 'unknown']).optional(),
  userPhrase: z.string().optional(),
  title: z.string().optional(),
  record: SymptomRecordSchema.optional(),
});

app.post('/api/episodes', async (c) => {
  const body = CreateEpisodeBody.safeParse(await c.req.json());
  if (!body.success) return c.json({ error: body.error.flatten() }, 400);
  const ep = createEpisode({ ...body.data, record: body.data.record ?? emptyRecord(body.data.region) });
  if (body.data.userPhrase) {
    appendTranscript(ep.id, 'user', body.data.userPhrase);
  }
  return c.json(ep, 201);
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
  const ep = getEpisode(c.req.param('id'));
  return ep ? c.json(ep) : c.json({ error: 'not found' }, 404);
});

app.patch('/api/episodes/:id/record', async (c) => {
  const body = z.object({ record: SymptomRecordSchema }).safeParse(await c.req.json());
  if (!body.success) return c.json({ error: body.error.flatten() }, 400);
  const existing = getEpisode(c.req.param('id'));
  if (!existing) return c.json({ error: 'not found' }, 404);
  return c.json(saveRecord(c.req.param('id'), body.data.record));
});

/**
 * The one endpoint that writes user confirmation. This is the moment a
 * candidate becomes a fact, so it is deliberately narrow and explicit.
 */
const ConfirmBody = z.object({
  fieldPath: z.string().min(1),
  value: z.unknown(),
  verificationStatus: z.enum(['unverified', 'user_confirmed', 'refuted']).default('user_confirmed'),
});

app.post('/api/episodes/:id/confirm', async (c) => {
  const body = ConfirmBody.safeParse(await c.req.json());
  if (!body.success) return c.json({ error: body.error.flatten() }, 400);
  const id = c.req.param('id');
  const result = recordField(id, body.data.fieldPath, body.data.value, {
    sourceType: 'user_selection',
    verificationStatus: body.data.verificationStatus,
    createdBy: 'user',
    capturedAt: new Date().toISOString(),
    sourceReference: `episode:${id}`,
  });
  return c.json(result);
});

app.post('/api/episodes/:id/note', async (c) => {
  const body = z.object({ text: z.string().min(1) }).safeParse(await c.req.json());
  if (!body.success) return c.json({ error: body.error.flatten() }, 400);
  appendTranscript(c.req.param('id'), 'user', body.data.text);
  return c.json({ ok: true });
});

app.get('/api/episodes/:id/prior', (c) => c.json(priorEpisodes(c.req.param('id'))));

app.get('/api/episodes/:id/summary', (c) => {
  const out = summaryFor(c.req.param('id'));
  if (!out) return c.json({ error: 'not found' }, 404);
  return c.json(out);
});

app.get('/api/episodes/:id/summary.txt', (c) => {
  const out = summaryFor(c.req.param('id'));
  if (!out) return c.json({ error: 'not found' }, 404);
  return c.text(out.text);
});

/* ---------------- personal health map ---------------- */

app.get('/api/healthmap/:personId', (c) => c.json(healthMap(c.req.param('personId'))));

/* ---------------- offline grounding preview ---------------- */

app.get('/api/ground', (c) => {
  const q = c.req.query('q') ?? '';
  const g = groundFromText(q);
  return c.json(g ?? { error: 'could not ground' });
});

export { app, buildPreVisitSummary, highestSeverity, putProvenance };
