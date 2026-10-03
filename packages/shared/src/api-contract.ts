/**
 * The V1 transport contract.
 *
 * ## Why this file exists
 *
 * The request schemas used to be declared inline in `packages/server/src/app.ts`. That
 * was fine while there was exactly one client. Now there are two surfaces -- the browser
 * and an MCP server -- and the failure mode of keeping them separate is specific: the
 * second surface grows its own loosely-typed payloads, and the two drift until an answer
 * correction means one thing over HTTP and another over MCP.
 *
 * So the wire shapes live HERE, in the pure domain package, and both surfaces import the
 * same objects. There is one definition of what a mutation is, one definition of what an
 * error is, and one definition of what an episode looks like on the wire.
 *
 * ## What this file deliberately does NOT do
 *
 * It does not implement anything. It has no I/O, no database and no HTTP. Every schema
 * here describes something the domain already decided; none of them gets to decide
 * anything. In particular:
 *
 *   - It does not decide whether a mutation is ALLOWED. That is the field registry's job,
 *     and it runs inside `applyMutations`.
 *   - It does not decide provenance. `ProvenanceInput` checks that provenance was
 *     supplied and is well-formed; whether this source type may write this field is a
 *     field-policy question answered in the transaction.
 *   - It does not compute safety, summarise, or canonicalise. Those all live in the
 *     domain and are called by the surfaces.
 *
 * A schema here that could ACCEPT something the domain would REJECT is a documentation
 * bug. A schema here that could REJECT something the domain accepts is a real bug, and
 * the tests in this repository check both directions.
 */
import { z } from 'zod';
import { SourceTypeSchema, VerificationStatusSchema } from './provenance.ts';
import { BodyRegionSchema } from './anatomy.ts';
import type { BodyRegion } from './anatomy.ts';

/* ------------------------------------------------------------------ */
/* Errors                                                             */
/* ------------------------------------------------------------------ */

/**
 * Stable, machine-readable failure codes.
 *
 * A string `error` field that holds a human sentence cannot be branched on. The old
 * surface returned `{ error: 'not found' }` from one route and
 * `{ error: e.message }` from another, so a client could only ever display the text and
 * never decide what to DO. These codes are the contract; the message is for people.
 */
export const ApiErrorCodeSchema = z.enum([
  /** The request body or query failed schema validation. `detail` carries the issues. */
  'validation_failed',
  /** No episode with that id. */
  'episode_not_found',
  /** The episode exists but its grounding did not succeed, so the interview is refused. */
  'episode_not_localised',
  /** A field mutation was refused by the field registry. `field` says which. */
  'field_policy_violation',
  /** The write was refused by the store itself (bad episode id, closed transaction). */
  'mutation_rejected',
  /** The region is not one this build knows. */
  'unknown_region',
  /** A question id that the region's interview does not contain. */
  'unknown_question',
  /** A canonical structure id the domain does not have. */
  'unknown_structure',
  /** The request was well-formed but names something that does not exist in the ontology. */
  'not_found',
  /** Anything unclassified. Never used to hide a known failure. */
  'internal_error',
]);
export type ApiErrorCode = z.infer<typeof ApiErrorCodeSchema>;

/**
 * The error envelope. `error` is the code, so existing clients that only check for the
 * presence of `error` keep working, and `message` is for a human.
 */
export const ApiErrorSchema = z.object({
  error: ApiErrorCodeSchema,
  message: z.string(),
  /** Schema issues, for `validation_failed`. */
  detail: z.unknown().optional(),
  /** For `field_policy_violation`. */
  field: z.string().optional(),
  /** For `unknown_region`. */
  region: z.string().optional(),
});
export type ApiError = z.infer<typeof ApiErrorSchema>;

/* ------------------------------------------------------------------ */
/* Provenance                                                         */
/* ------------------------------------------------------------------ */

/**
 * Provenance as it arrives over the wire.
 *
 * Checks that provenance was supplied and is well-formed. It deliberately does NOT check
 * that this source type may write this field: that is a field-policy decision made inside
 * the transaction, and duplicating it here would create a second answer to the same
 * question -- the two would drift, and the permissive one would be the one that ships.
 */
export const ProvenanceInputSchema = z.object({
  sourceType: SourceTypeSchema,
  verificationStatus: VerificationStatusSchema,
  createdBy: z.string().min(1).max(120),
  sourceReference: z.string().max(200).nullish(),
  confidence: z.number().min(0).max(1).nullish(),
  rawText: z.string().max(4000).nullish(),
  evidenceStatus: z
    .enum(['user_report', 'visual_selection', 'ai_candidate', 'clinician_finding', 'system_derived'])
    .optional(),
});
export type ProvenanceInput = z.infer<typeof ProvenanceInputSchema>;

/* ------------------------------------------------------------------ */
/* The write path                                                     */
/* ------------------------------------------------------------------ */

/**
 * Does this object OWN `key`?
 *
 * `'value' in obj` is not enough: it is true for an inherited property, and `z.unknown()`
 * happily produces `undefined` for a key that was never sent.
 */
function ownsKey(obj: unknown, key: string): boolean {
  return (
    typeof obj === 'object' &&
    obj !== null &&
    Object.prototype.hasOwnProperty.call(obj, key)
  );
}

/**
 * Require the key to be PRESENT, whatever its value.
 *
 * `value: z.unknown()` does NOT do this. Zod types `unknown` as OPTIONAL, because `unknown`
 * includes `undefined`, so a mutation sent with no `value` at all parsed successfully and
 * arrived at the store as "write undefined". Both surfaces then noticed afterwards, by hand,
 * and disagreed about what to say about it: HTTP threw a generic `Error`, which surfaced as
 * `internal_error`, and MCP built a `FieldPolicyError` with its arguments REVERSED --
 * `(path, message)` into a `(message, path)` constructor -- so the path and the sentence
 * were swapped. A client could not branch on either.
 *
 * The check belongs HERE, at the shared boundary, because that is the only place both
 * surfaces are guaranteed to pass through. Now a missing `value` or `raw` is
 * `validation_failed` on HTTP and on MCP, before the store is reached and before any write
 * is attempted.
 *
 * `null` is a legitimate value and is NOT rejected: "the user said the side is unknown" is
 * different from "no value supplied", and only the second is a malformed request.
 */
export const FieldMutationInputBaseSchema = z.object({
  fieldPath: z.string().min(1).max(120),
  value: z.unknown(),
  provenance: ProvenanceInputSchema,
});

/**
 * The presence rule, exported on its own so it can be re-applied to a COMPOSITION.
 *
 * This exists because MCP has to declare its own tool inputs -- a tool is keyed by name and
 * carries an extra `episodeId` -- and the first version of that declared `value: z.unknown()`
 * inline. `z.unknown()` is OPTIONAL, so the tool accepted a mutation with no value that the
 * HTTP surface refused, and `answer_symptom_question` likewise accepted an answer with no
 * `raw`. Two surfaces, two contracts, for the same rule.
 *
 * Exposing the base shape plus the rule lets a surface that must compose re-use BOTH, so
 * there is one declaration of what "a value must be present" means.
 */
export function requireMutationValue(
  mutation: { value?: unknown },
  ctx: z.RefinementCtx,
): void {
  if (!ownsKey(mutation as Record<string, unknown>, 'value'))
    ctx.addIssue({
      code: z.ZodIssueCode.custom,
      path: ['value'],
      message: 'a field mutation must carry a value; null is a value, absence is not',
    });
}

export const FieldMutationInputSchema = FieldMutationInputBaseSchema.superRefine(
  requireMutationValue,
);
export type FieldMutationInput = z.infer<typeof FieldMutationInputSchema>;

export const AnswerInputBaseSchema = z.object({
  questionId: z.string().min(1).max(120),
  raw: z.unknown(),
  /** The fields this answer is allowed to write. Advisory; the engine owns the mapping. */
  wroteFields: z.array(z.string().max(120)).max(16).default([]),
  createdBy: z.string().min(1).max(120),
  rawText: z.string().max(4000).nullish(),
});

/** Exported for the same reason as `requireMutationValue`: one rule, re-usable in a composition. */
export function requireAnswerRaw(answer: { raw?: unknown }, ctx: z.RefinementCtx): void {
  if (!ownsKey(answer as Record<string, unknown>, 'raw'))
    ctx.addIssue({
      code: z.ZodIssueCode.custom,
      path: ['raw'],
      message: 'an answer must carry its raw value; "I am not sure" is a value, absence is not',
    });
}

export const AnswerInputSchema = AnswerInputBaseSchema.superRefine(requireAnswerRaw);
export type AnswerInput = z.infer<typeof AnswerInputSchema>;

/**
 * The one batch a client sends to change an episode.
 *
 * Field mutations and answer mutations travel together because that is how the product
 * works: a safety question's answer must exist before the rules run. Splitting them into
 * two calls would let a client record "no night pain" and keep the trigger, which is
 * exactly the stale-record bug the answer-editing work fixed.
 */
export const ApplyMutationsRequestSchema = z.object({
  mutations: z.array(FieldMutationInputSchema).max(64).default([]),
  answers: z.array(AnswerInputSchema).max(64).default([]),
  status: z.enum(['open', 'resolved', 'ongoing', 'archived']).optional(),
});
export type ApplyMutationsRequest = z.infer<typeof ApplyMutationsRequestSchema>;

/**
 * Re-exported from the domain rather than re-declared.
 *
 * This file's first draft declared its own `SideSchema` with the same five values. The
 * star exports from `index.ts` then had two symbols of that name, and the build failed --
 * which is the correct outcome, because a second enum for the same vocabulary is how two
 * places end up disagreeing about what "midline" means.
 */
export { SideSchema } from './anatomy.ts';
import { SideSchema } from './anatomy.ts';
export type SideInput = z.infer<typeof SideSchema>;

/**
 * Grounding as a client reports it.
 *
 * Required, and it must be a real outcome. There is no default region, so an episode
 * cannot be created without the caller stating what localisation concluded -- including
 * saying it concluded "unsupported", which the surface then refuses.
 */
export const GroundingInputSchema = z.discriminatedUnion('status', [
  z.object({
    status: z.literal('grounded'),
    region: BodyRegionSchema,
    side: SideSchema.optional(),
    by: z.enum(['deterministic', 'model']).optional(),
    score: z.number().min(0).max(1).nullish(),
    clarification: z.string().max(240).nullish(),
  }),
  z.object({
    status: z.literal('unsupported'),
    reason: z.enum(['ungrounded', 'out_of_scope']),
  }),
]);
export type GroundingInput = z.infer<typeof GroundingInputSchema>;

export const CreateEpisodeRequestSchema = z.object({
  personId: z.string().min(1).max(120).default('local'),
  displayName: z.string().max(200).optional(),
  title: z.string().max(300).optional(),
  side: SideSchema.optional(),
  grounding: GroundingInputSchema,
  mutations: z.array(FieldMutationInputSchema).max(64).default([]),
  answers: z.array(AnswerInputSchema).max(64).default([]),
});
export type CreateEpisodeRequest = z.infer<typeof CreateEpisodeRequestSchema>;

/* ------------------------------------------------------------------ */
/* Grounding                                                          */
/* ------------------------------------------------------------------ */

export const LocaliseRequestSchema = z.object({
  utterance: z.string().min(1).max(2000),
  pinnedRegion: BodyRegionSchema.optional(),
});
export type LocaliseRequest = z.infer<typeof LocaliseRequestSchema>;

/* ------------------------------------------------------------------ */
/* Anatomy capability, for clients that need to know what exists      */
/* ------------------------------------------------------------------ */

/**
 * What a region can actually render, per side.
 *
 * This exists because "the region exists" and "the region has geometry" are different
 * questions, and a client that cannot tell them apart will offer a 3D picker over a body
 * part with no 3D -- or refuse a region that has plenty. `available: false` carries a
 * `reason` in the product's own words, so a client can show it rather than invent one.
 */
export const SideCapabilityReportSchema = z.object({
  side: SideSchema,
  available: z.boolean(),
  /** Source-backed availability of 3D geometry for this side. Never assumed. */
  threeD: z.union([
    z.object({
      available: z.literal(true),
      /** Source meshes in the build. */
      meshes: z.number().int().nonnegative(),
      triangles: z.number().int().nonnegative(),
      source: z.string(),
      licence: z.string(),
    }),
    z.object({ available: z.literal(false), reason: z.string() }),
  ]),
  /** Why this side cannot be shown, when it cannot. */
  reason: z.string().nullish(),
});
export type SideCapabilityReport = z.infer<typeof SideCapabilityReportSchema>;

export const StructureCapabilityReportSchema = z.object({
  asiId: z.string(),
  label: z.string(),
  regions: z.array(BodyRegionSchema),
  layer: z.string(),
  /** `true` only when real sourced 3D geometry exists for at least one side. */
  threeDAvailable: z.boolean(),
  /** The 2D map is a hand-made placeholder and says so. */
  twoDPlaceholder: z.boolean(),
  /** Source-backed reason this structure has no 3D, when it has none. */
  threeDGapReason: z.string().nullish(),
});
export type StructureCapabilityReport = z.infer<typeof StructureCapabilityReportSchema>;

export const RegionCapabilityReportSchema = z.object({
  region: BodyRegionSchema,
  label: z.string(),
  /** True when the region has real sourced 3D for BOTH sides. */
  hasThreeD: z.boolean(),
  sides: z.array(SideCapabilityReportSchema),
  structures: z.array(StructureCapabilityReportSchema),
  /** Concepts with no representation in the source dataset, with the reason. */
  unavailable: z.array(z.object({ asiId: z.string(), label: z.string(), reason: z.string() })),
});
export type RegionCapabilityReport = z.infer<typeof RegionCapabilityReportSchema>;

export const AnatomyCapabilitySchema = z.object({
  schemaVersion: z.literal(1),
  /** The dataset every real geometry claim traces back to. */
  dataset: z.object({ name: z.string(), release: z.string(), licence: z.string(), url: z.string() }),
  regions: z.array(RegionCapabilityReportSchema),
});
export type AnatomyCapability = z.infer<typeof AnatomyCapabilitySchema>;

/* ------------------------------------------------------------------ */
/* Helpers both surfaces share                                        */
/* ------------------------------------------------------------------ */

/** Build the error envelope. One constructor, so no surface invents its own shape. */
export function apiError(
  code: ApiErrorCode,
  message: string,
  extra: Omit<Partial<ApiError>, 'error' | 'message'> = {},
): ApiError {
  return { error: code, message, ...extra };
}

/**
 * Turn a Zod failure into the error envelope.
 *
 * `flatten()` is used rather than `issues` because the field-level shape is what a client
 * can render next to a form input, and the raw issue list leaks internal paths.
 */
export function validationError(error: z.ZodError): ApiError {
  return apiError('validation_failed', 'The request did not match the expected shape.', {
    detail: error.flatten(),
  });
}