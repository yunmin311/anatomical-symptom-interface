/**
 * The MCP tool surface, as plain functions.
 *
 * ## Why this file is not the MCP server
 *
 * The protocol is a transport. The semantics are not. So the semantics live here, as
 * ordinary functions over ASI Core, and `server.ts` is a thin JSON-RPC shell that calls
 * them. That split is what makes the tools testable without a socket, and it is why the
 * tests can assert that a tool does exactly what the HTTP route does.
 *
 * ## What these tools are NOT
 *
 * They are not a second write path. There is no `db.execute` here, no raw SQL, and no way
 * to write a field that the HTTP API could not write. Every mutation goes through
 * `applyMutations`, the same function `POST /api/episodes/:id/mutations` calls, so field
 * policy, provenance, canonicalisation, the claim-class merge, atomicity and safety
 * re-evaluation all happen exactly once, in one place, identically.
 *
 * A tool that re-implemented any of those would have two answers to one question. The
 * permissive one is the one that ships.
 *
 * ## Provider independence
 *
 * Nothing here names a model vendor, and nothing here calls a model. Localisation goes
 * through the `Orchestrator` interface, which on a machine with no key is the
 * deterministic implementation. An MCP client gets the same grounding the browser gets,
 * with the same refusal behaviour when a complaint is out of scope.
 */
import { z } from 'zod';
import {
  anatomyCapability,
  apiError,
  applyAnswer,
  ApplyMutationsRequestSchema,
  buildAnswer,
  mutationsForAnswer,
  userProvenance,
  BodyRegionSchema,
  CreateEpisodeRequestSchema,
  FieldPolicyError,
  INTERVIEW,
  LocaliseRequestSchema,
  nextQuestion,
  regionsForStructure,
  canonicalStructureId,
  questionProgress,
  RETIRED_CANONICAL_IDS,
  SideSchema,
  getStructure,
  type ApiErrorCode,
  type BodyRegion,
  AnswerInputBaseSchema,
  requireAnswerRaw,
  ProvenanceError,
  UnknownStructureError,
  isKnownStructureId,
} from '@asi/shared';

import {
  answersFor,
  applyMutations,
  createEpisode,
  getEpisode,
  getGrounding,
  listEpisodes,
  MutationRejected,
  priorEpisodes,
  safetyFor,
  summaryFor,
} from '@asi/server/src/db/store.ts';
import { episodeForReopen } from '@asi/server/src/db/episode-lifecycle.ts';
import { spatialHistoryWithEmptyRegions } from '@asi/server/src/db/spatial.ts';
import { BUILT_MANIFESTS } from '@asi/server/src/anatomy-manifests.ts';
import { createOrchestrator } from '@asi/server/src/orchestrator/index.ts';
import { releaseProfile } from '@asi/server/src/env.ts';

/**
 * A tool result. `ok: false` carries the same stable code the HTTP API returns.
 *
 * The error shape is the shared `ApiError`'s, not a local invention: `canonicalId` is gone
 * because retired ids are accepted and canonicalised, so nothing produces it, and `detail`
 * is here so a schema failure can say WHICH part of the payload was wrong.
 */
export type ToolResult =
  | { ok: true; data: unknown }
  | {
      ok: false;
      error: {
        code: ApiErrorCode;
        message: string;
        field?: string;
        detail?: { path: string; message: string }[];
      };
    };

const fail = (
  code: ApiErrorCode,
  message: string,
  extra: { field?: string; detail?: { path: string; message: string }[] } = {},
): ToolResult => ({ ok: false, error: { code, message, ...extra } });

/**
 * Turn a thrown domain refusal into the same envelope the API uses.
 *
 * Exported, and used by BOTH nets -- the one inside the write-path wrapper below and the
 * one in `server.ts` around the tool dispatch. They were separate functions, which is the
 * same drift that made the MCP contract disagree with itself: a refusal raised deep in the
 * write path and one raised at the tool boundary were classified by two lists, and
 * `ProvenanceError` was on neither.
 *
 * A domain refusal is NOT a crash. Reporting it as `internal_error` tells a client the
 * server has faulted, invites a retry that can never succeed, and hides a rule the product
 * enforces on purpose.
 */
export function fromThrown(e: unknown): ToolResult {
  if (e instanceof FieldPolicyError)
    return fail('field_policy_violation', e.message, { field: e.path });
  if (e instanceof ProvenanceError)
    return fail('field_policy_violation', e.message, { field: e.field });
  // The CENTRAL refusal. The write path refuses an unknown anatomical id for every surface,
  // so this is what MCP reports for one arriving through a generic field mutation -- and it
  // is the same code the HTTP route returns for the same request.
  if (e instanceof UnknownStructureError)
    return fail('unknown_structure', e.message);
  if (e instanceof MutationRejected) return fail('mutation_rejected', e.message);
  return fail('internal_error', e instanceof Error ? e.message : String(e));
}

/**
 * Shared by the tools, because "which side did they say?" must be asked identically
 * everywhere. Created once: the orchestrator is stateless apart from its kind.
 */
const orchestrator = createOrchestrator();

/* ------------------------------------------------------------------ */
/* The write path, wrapped once                                        */
/* ------------------------------------------------------------------ */

/**
 * THE only way these tools change an episode.
 *
 * Takes the same request shape as the HTTP route and hands it to the same function, so
 * the two surfaces cannot diverge. Everything that matters about a write -- validation,
 * provenance, merging, atomicity, safety -- is inside `applyMutations` and is not
 * repeated here.
 */
function write(
  episodeId: string,
  request: unknown,
): ToolResult {
  const parsed = ApplyMutationsRequestSchema.safeParse(request);
  if (!parsed.success)
    return fail('validation_failed', 'The mutation batch did not match the expected shape.');
  // A batch may legitimately contain no field mutations -- a status change, or an answer
  // on its own -- so emptiness is not an error. Each mutation is checked for its own
  // `value` below, because Zod types `unknown` as optional and a write must never arrive
  // without one.

  try {
    const outcome = applyMutations(
      episodeId,
      {
        fieldMutations: parsed.data.mutations.map((m) => {
          if (!('value' in m))
            throw new FieldPolicyError('a mutation must carry a value', m.fieldPath);
          return { fieldPath: m.fieldPath, value: m.value, provenance: { ...m.provenance } };
        }),
        answerMutations: parsed.data.answers.map((a) => {
          if (!('raw' in a))
            throw new FieldPolicyError('an answer must carry a raw value', a.questionId);
          return {
            questionId: a.questionId,
            raw: a.raw,
            wroteFields: a.wroteFields,
            createdBy: a.createdBy,
            rawText: a.rawText ?? null,
            capturedAt: new Date().toISOString(),
          };
        }),
        status: parsed.data.status,
      },
      releaseProfile,
    );
    return { ok: true, data: outcome };
  } catch (e) {
    return fromThrown(e);
  }
}

// Provenance for a value the USER stated comes from `@asi/shared`'s `userProvenance`,
// which already encodes that `location.point`, `location.subRegionId` and
// `location.userSelectedStructureIds` are SELECTIONS rather than statements.
//
// This file used to declare its own copy with `sourceType: 'user_statement'` and no special
// case, so `update_location({ point })` always failed field policy -- which allows a pin
// only from `user_selection` -- while the tool's description advertised "optionally an
// approximate pin" and its schema accepted `point`. A client following the description got a
// refusal for something the browser does routinely.
//
// Two copies of the provenance rule is exactly how they disagreed.
export { userProvenance } from '@asi/shared';


/* ------------------------------------------------------------------ */
/* Tools                                                              */
/* ------------------------------------------------------------------ */

/*
 * TOOL INPUT SCHEMAS, DECLARED ONCE.
 *
 * These used to be written twice per tool: once in `inputSchema`, which is what
 * `tools/list` publishes and what a client codes against, and again inline in the handler,
 * which is what actually validated the request. Two literals, kept in step by hand.
 *
 * They were not in step. `answer_symptom_question` published a required `raw` and then
 * parsed with `z.unknown()` -- which is OPTIONAL, because it accepts absence -- so MCP took
 * an answer with no raw value that HTTP refused with `validation_failed`. Two surfaces, two
 * contracts, one rule.
 *
 * So: one object, used for both advertising and enforcing.
 *
 * `AnswerToolInputSchema` cannot `.extend()` the shared answer, because a refined Zod type
 * does not expose `.shape`. That is why the shared contract exports the base shape AND the
 * presence rule separately: a surface that must add its own `episodeId` re-uses the real
 * rule instead of paraphrasing it.
 *
 * `createdBy` keeps this tool's `'user'` default rather than the HTTP route's required
 * value. A tool call from an assistant is not an HTTP client, and making it name an author
 * it cannot know is a worse trade than the inconsistency being fixed. The presence rule,
 * which is what actually broke, is not duplicated here.
 */
const AnswerToolInputSchema = z
  .object({
    episodeId: z.string().min(1),
    ...AnswerInputBaseSchema.shape,
    createdBy: z.string().min(1).max(120).default('user'),
  })
  .superRefine(requireAnswerRaw);

/** At least one id, because a selection tool called with nothing has nothing to select. */
const SelectStructureToolInputSchema = z.object({
  episodeId: z.string().min(1),
  structureIds: z.array(z.string().min(1)).min(1).max(64),
  /** Append to the existing selection instead of replacing it. */
  additive: z.boolean().optional(),
});

const RegionHistoryToolInputSchema = z.object({
  personId: z.string().min(1).default('local'),
  limit: z.number().int().min(1).max(200).optional(),
});

export const TOOLS = {
  /* ---------------------------------------------------------- anatomy */

  /**
   * What this product can actually render, per region and side.
   *
   * Exposed because an MCP client cannot see the viewer. Without it, an assistant would
   * offer to "point at the shoulder" for a region with no 3D, and the user would find out
   * at the point of failure.
   */
  get_anatomy_region: {
    description:
      'List the regions this build supports, and for each: which sides have real sourced 3D ' +
      'geometry, which concepts are unavailable in the source dataset and why, and whether the ' +
      '2D map is a placeholder. Read this before offering any anatomy-based interaction. ' +
      'Pass a region to get just that one; omit it for all of them.',
    /*
     * `region` is OFFICIALLY part of the schema.
     *
     * It used to be `z.object({})` while the handler read `input.region` anyway, so the tool
     * accepted an argument that its published contract forbade: `additionalProperties` was
     * not even constrained, and a client built from this schema had no way to know the
     * filter existed. A hidden parameter is a parameter no client can use and one we cannot
     * change without breaking someone.
     *
     * Now it is declared, validated against the ontology's own `BodyRegionSchema`, and
     * documented -- so an unknown region is refused by SCHEMA validation with
     * `validation_failed` rather than by a hand-written check that the contract never
     * described.
     */
    inputSchema: z.object({ region: BodyRegionSchema.optional() }),
    handler: async (input: unknown) => {
      const parsed = z.object({ region: BodyRegionSchema.optional() }).safeParse(input ?? {});
      if (!parsed.success)
        return fail('validation_failed', 'get_anatomy_region takes an optional region.');
      const capability = anatomyCapability(BUILT_MANIFESTS);
      const region = parsed.data.region;
      if (!region) return { ok: true, data: capability };
      const found = capability.regions.find((r) => r.region === region);
      // Unreachable while `region` is `BodyRegionSchema`-constrained and the capability
      // report covers every region in the ontology -- and kept anyway, because a
      // capability report missing a region is a bug worth a clear error rather than a
      // silent `undefined`.
      if (!found) return fail('unknown_region', `No such region: ${region}.`, { field: region });
      return { ok: true, data: found };
    },
  },

  /* -------------------------------------------------------- grounding */

  localise_symptom: {
    description:
      'Localise a described symptom to a supported body region and side, or refuse explicitly. ' +
      'There is no default region: an out-of-scope complaint is refused, never guessed. ' +
      'Run this before starting an episode.',
    inputSchema: LocaliseRequestSchema,
    handler: async (input: unknown) => {
      const parsed = LocaliseRequestSchema.safeParse(input);
      if (!parsed.success)
        return fail('validation_failed', 'localise_symptom needs a non-empty utterance.');
      // The same orchestrator the browser uses. Its result may be a proposal, never a
      // record: nothing is written here.
      return { ok: true, data: await orchestrator.localise(parsed.data) };
    },
  },

  /* --------------------------------------------------------- episodes */

  start_symptom_episode: {
    description:
      'Start a symptom episode. Requires the outcome of localise_symptom, including an ' +
      'explicit "unsupported" outcome, which is refused rather than defaulted. Creates the ' +
      'record; later changes go through update_location, select_structure and ' +
      'answer_symptom_question, all of which share the same atomic write path as the web app.',
    inputSchema: CreateEpisodeRequestSchema,
    handler: (input: unknown) => {
      const parsed = CreateEpisodeRequestSchema.safeParse(input);
      if (!parsed.success) return fail('validation_failed', 'The episode request did not validate.');
      const g = parsed.data.grounding;
      if (g.status === 'unsupported')
        return fail(
          'episode_not_localised',
          'The description did not localise to a supported region, so no episode was created.',
        );
      try {
        return {
          ok: true,
          data: createEpisode({
            personId: parsed.data.personId,
            displayName: parsed.data.displayName,
            region: g.region,
            side: parsed.data.side ?? g.side,
            title: parsed.data.title,
            grounding: {
              status: 'grounded',
              reason: null,
              by: g.by ?? null,
              score: g.score ?? null,
              clarification: g.clarification ?? null,
            },
            mutations: parsed.data.mutations.map((m) => {
              if (!('value' in m)) throw new FieldPolicyError('a mutation must carry a value', m.fieldPath);
              return { fieldPath: m.fieldPath, value: m.value, provenance: { ...m.provenance } };
            }),
            answers: parsed.data.answers.map((a) => {
              if (!('raw' in a)) throw new FieldPolicyError('an answer must carry a raw value', a.questionId);
              return {
                questionId: a.questionId,
                raw: a.raw,
                wroteFields: a.wroteFields,
                createdBy: a.createdBy,
                rawText: a.rawText ?? null,
                capturedAt: new Date().toISOString(),
              };
            }),
          }),
        };
      } catch (e) {
        return fromThrown(e);
      }
    },
  },

  get_episode: {
    description:
      'Read an episode with its grounding, answers and safety state. The same payload the ' +
      'web app reads.',
    inputSchema: z.object({ episodeId: z.string().min(1) }),
    handler: (input: unknown) => {
      const parsed = z.object({ episodeId: z.string().min(1) }).safeParse(input);
      if (!parsed.success) return fail('validation_failed', 'get_episode needs an episodeId.');
      const ep = getEpisode(parsed.data.episodeId);
      if (!ep) return fail('episode_not_found', `No episode with id ${parsed.data.episodeId}.`);
      return {
        ok: true,
        data: {
          ...ep,
          grounding: getGrounding(parsed.data.episodeId),
          answers: answersFor(parsed.data.episodeId),
          safety: safetyFor(parsed.data.episodeId, releaseProfile),
        },
      };
    },
  },

  reopen_episode: {
    description:
      'Resume an existing episode: record, answers, next question, progress and what is still ' +
      'outstanding, in one payload. Reopening does NOT create a second record -- the next ' +
      'write updates the same episode, so a history stays honest about how many times ' +
      'something happened.',
    inputSchema: z.object({ episodeId: z.string().min(1) }),
    handler: (input: unknown) => {
      const parsed = z.object({ episodeId: z.string().min(1) }).safeParse(input);
      if (!parsed.success) return fail('validation_failed', 'reopen_episode needs an episodeId.');
      const out = episodeForReopen(parsed.data.episodeId, releaseProfile);
      if (!out) return fail('episode_not_found', `No episode with id ${parsed.data.episodeId}.`);
      return { ok: true, data: out };
    },
  },

  /* --------------------------------------------------------- location */

  update_location: {
    description:
      'Record where a symptom is: side, depth, sub-region, and optionally an approximate pin. ' +
      'Writes through the same atomic mutation path as the web app, so provenance and field ' +
      'policy apply. "Midline" is a real value and means the structure has no side.',
    inputSchema: z.object({
      episodeId: z.string().min(1),
      side: SideSchema.optional(),
      depth: z.enum(['superficial', 'deep']).optional(),
      subRegionId: z.string().min(1).optional(),
      /** Approximate schematic point. Normalised 0..1, not a measurement. */
      point: z.object({ x: z.number().min(0).max(1), y: z.number().min(0).max(1) }).nullish(),
    }),
    handler: (input: unknown) => {
      const parsed = z
        .object({
          episodeId: z.string().min(1),
          side: SideSchema.optional(),
          depth: z.enum(['superficial', 'deep']).optional(),
          subRegionId: z.string().min(1).optional(),
          point: z.object({ x: z.number().min(0).max(1), y: z.number().min(0).max(1) }).nullish(),
        })
        .safeParse(input);
      if (!parsed.success) return fail('validation_failed', 'update_location did not validate.');
      const { episodeId, ...location } = parsed.data;
      const ep = getEpisode(episodeId);
      if (!ep) return fail('episode_not_found', `No episode with id ${episodeId}.`);

      const mutations = Object.entries(location)
        .filter(([, value]) => value !== undefined)
        .map(([fieldPath, value]) => ({
          fieldPath: `location.${fieldPath}`,
          value,
          provenance: userProvenance(`location.${fieldPath}`),
        }));
      if (!mutations.length)
        return fail('validation_failed', 'update_location was given nothing to change.');
      return write(episodeId, { mutations });
    },
  },

  /**
   * Record which structures the user POINTED AT.
   *
   * Deliberately named "select", never "confirm": a visual selection is not a finding, and
   * an assistant that calls it a confirmation has already misrepresented it.
   *
   * The id is canonicalised here, so a retired id is accepted and stored canonically, and
   * a structure from another region is not silently rejected -- it is recorded, because
   * anatomy does not respect the conversation.
   */
  select_structure: {
    description:
      'Record structures the user pointed at on the anatomy view. This is a visual ' +
      'selection, NOT a finding and NOT a diagnosis: never describe the result as confirmed. ' +
      'Accepts a retired id and stores its canonical replacement. Order is the order the user ' +
      'pointed, first occurrence wins.',
    inputSchema: SelectStructureToolInputSchema,
    handler: (input: unknown) => {
      const parsed = SelectStructureToolInputSchema.safeParse(input);
      if (!parsed.success) return fail('validation_failed', 'select_structure did not validate.');
      const { episodeId, structureIds, additive } = parsed.data;
      const ep = getEpisode(episodeId);
      if (!ep) return fail('episode_not_found', `No episode with id ${episodeId}.`);

      /*
       * A RETIRED id resolves to a canonical one, so it is checked against the canonical id
       * -- otherwise a caller passing a retired id would be told the structure does not
       * exist, when the honest answer is that the id moved.
       *
       * `isKnownStructureId` is the SHARED definition of "known": it resolves the alias and
       * then asks the ontology, which is the same two steps the central write boundary takes.
       * This loop asks it rather than calling `getStructure` itself, so the two cannot drift,
       * and it exists only to NAME EVERY bad id in one refusal -- the store would otherwise
       * report just the first, because it resolves ids one at a time.
       *
       * The refusal itself does not depend on this loop: the store refuses an unknown id on
       * every surface, so removing these lines would not let one through.
       */
      const resolved = structureIds.map((id) => ({
        from: id,
        to: canonicalStructureId(id),
        retired: id in RETIRED_CANONICAL_IDS,
      }));
      const unknown = resolved.filter((r) => !isKnownStructureId(r.to));
      // No `canonicalId` here, and none is needed: retired ids were resolved on the line
      // above, so anything still unknown was never known. The hint used to fire only for a
      // retired id, which is now accepted rather than refused.
      if (unknown.length)
        return fail(
          'unknown_structure',
          `No such structure: ${unknown.map((u) => u.from).join(', ')}.`,
        );

      const canonical = resolved.map((r) => r.to);
      const retired = resolved.filter((r) => r.retired);

      const existing = ep.record.location.userSelectedStructureIds as string[];
      // Ordered-unique, first occurrence wins. Sorting or deduplicating differently here
      // would make the stored order disagree with the order the user pointed.
      const merged = [...(additive ? existing : []), ...canonical].filter(
        (id, index, all) => all.indexOf(id) === index,
      );

      const outcome = write(episodeId, {
        mutations: [
          {
            fieldPath: 'location.userSelectedStructureIds',
            value: merged,
            // No `sourceType` override: `userProvenance` already knows
            // `location.userSelectedStructureIds` is a selection, and it encodes that from the
            // PATH. Overriding it here was a third copy of the same rule.
            provenance: userProvenance('location.userSelectedStructureIds'),
          },
        ],
      });
      if (!outcome.ok) return outcome;
      // Say what was canonicalised. Silently rewriting the caller's id would leave them
      // holding an id that will never match anything again.
      return {
        ok: true,
        data: {
          outcome: outcome.data,
          canonicalised: retired.map((r) => ({ from: r.from, to: r.to })),
        },
      };
    },
  },

  /* ---------------------------------------------------------- answers */

  /**
   * Record an answer to one of the region's questions.
   *
   * Correcting an answer is THIS tool, not another one: posting an answer for a question
   * that already has one replaces it and the response says `replaced: true`. The store
   * marks it `user_edited` from the row, so the tool cannot claim a correction that did
   * not happen. The previous value is not retained.
   */
  answer_symptom_question: {
    description:
      'Record an answer to a question in the region interview. Answering a question that ' +
      'already has an answer CORRECTS it: the previous value is replaced and the response ' +
      'reports replaced: true. Never state a diagnosis; a "yes" to a safety question means ' +
      'the user reported it, nothing more.',
    inputSchema: AnswerToolInputSchema,
    handler: (input: unknown) => {
      const parsed = AnswerToolInputSchema.safeParse(input);
      if (!parsed.success) return fail('validation_failed', 'answer_symptom_question did not validate.');
      const { episodeId, questionId, raw, createdBy, rawText } = parsed.data;
      const ep = getEpisode(episodeId);
      if (!ep) return fail('episode_not_found', `No episode with id ${episodeId}.`);
      // The question must exist in THIS region's interview. Accepting a question from
      // another region would let a stale answer from a different body part fire a safety
      // rule here, which is the one thing region-scoped signals exist to prevent.
      const known = new Set(INTERVIEW[ep.record.location.region].map((q) => q.id));
      if (!known.has(questionId))
        return fail(
          'unknown_question',
          `The ${ep.record.location.region} interview has no question "${questionId}".`,
        );

      /*
       * The answer AND the fields it implies, in ONE batch.
       *
       * This tool's first version stored the answer and nothing else, so "the user says
       * it wakes them at night" became a stored answer that changed nothing a clinician
       * reads. An answer that does not move the record is a decoration.
       *
       * `applyAnswer` and `mutationsForAnswer` are the SAME functions the browser uses,
       * so "what does this answer write" has one answer across surfaces. Both go into one
       * `applyMutations` call, which is what makes the safety re-evaluation see the new
       * signal: an answer and its fields in separate transactions would let the rules run
       * against the record the answer has not reached yet.
       */
      const capturedAt = new Date().toISOString();
      const answer = buildAnswer({
        questionId,
        raw,
        provenance: { capturedAt, createdBy, rawText: rawText ?? null },
      });
      const working = structuredClone(ep.record);
      const wroteFields = applyAnswer(working, questionId, answer);
      return write(episodeId, {
        answers: [{ questionId, raw, createdBy, rawText, wroteFields }],
        mutations: mutationsForAnswer(working, answer, wroteFields, capturedAt),
      });
    },
  },

  /* ---------------------------------------------------------- reading */

  get_episode_summary: {
    description:
      'The clinician-facing pre-visit summary for an episode. Deterministic, never ' +
      'generated, and it never states a negative it does not have: an unasked field reads ' +
      'as "not asked". It does not diagnose.',
    inputSchema: z.object({ episodeId: z.string().min(1) }),
    handler: (input: unknown) => {
      const parsed = z.object({ episodeId: z.string().min(1) }).safeParse(input);
      if (!parsed.success) return fail('validation_failed', 'get_episode_summary needs an episodeId.');
      const out = summaryFor(parsed.data.episodeId, releaseProfile);
      if (!out) return fail('episode_not_found', `No episode with id ${parsed.data.episodeId}.`);
      return { ok: true, data: out };
    },
  },

  /**
   * Where this person's body has been sore, as places.
   *
   * A LOCATION history, not a risk map: the count is how often a place was described, and
   * nothing here weighs frequency against severity. Place identity is computed
   * server-side; do not recompute it, or the numbers will disagree with the web app.
   */
  get_region_history: {
    description:
      'The places this person has reported symptoms, with how many episodes are behind each ' +
      'and the episode ids themselves. This is a LOCATION history, not a risk map: episode ' +
      'count is how often a place was described, and must never be presented as severity ' +
      'or risk.',
    inputSchema: RegionHistoryToolInputSchema,
    handler: (input: unknown) => {
      const parsed = RegionHistoryToolInputSchema.safeParse(input ?? {});
      if (!parsed.success) return fail('validation_failed', 'get_region_history did not validate.');
      return {
        ok: true,
        data: spatialHistoryWithEmptyRegions(parsed.data.personId, parsed.data.limit),
      };
    },
  },
} as const;

export type ToolName = keyof typeof TOOLS;

/* ------------------------------------------------------------------ */
/* Two read-only helpers the spec above names but this surface does   */
/* not need as separate tools                                          */
/* ------------------------------------------------------------------ */

/** Not a tool: the interview itself, for a client that wants to drive it question by question. */
export function interviewFor(region: BodyRegion) {
  return INTERVIEW[region] ?? null;
}

/** Not a tool: prior episodes in the same place. */
export function priorFor(episodeId: string) {
  return priorEpisodes(episodeId);
}

/** Not a tool: list episodes. */
export function listFor(opts: { personId?: string; region?: string; side?: string; limit?: number }) {
  return listEpisodes(opts);
}

/** Not a tool: next question, mirroring the HTTP route's refusal for ungrounded episodes. */
export function nextQuestionFor(episodeId: string): ToolResult {
  const ep = getEpisode(episodeId);
  if (!ep) return fail('episode_not_found', `No episode with id ${episodeId}.`);
  const grounding = getGrounding(episodeId);
  if (!grounding || grounding.status !== 'grounded')
    return fail(
      'episode_not_localised',
      'This episode was not localised to a supported region, so the region interview will not run.',
    );
  const answers = answersFor(episodeId);
  const ctx = { record: ep.record, answers };
  return { ok: true, data: { next: nextQuestion(ctx) ?? null, progress: questionProgress(ctx) } };
}

/** Exported for the tests that prove the tools agree with the ontology, not a table. */
export const __internals = {
  regionsForStructure,
  canonicalStructureId,
  apiError,
  BodyRegionSchema,
};