/**
 * Provenance & authority model.
 *
 * This is the single most important file in the product. The whole point of
 * Anatomical Symptom Interface is that "what the user felt", "what the AI
 * guessed", "what a device measured" and "what a doctor concluded" never get
 * flattened into one undifferentiated "medical history".
 *
 * Hard rules enforced here (see docs/adr/0003-separate-clinical-layer.md):
 *   1. Every value carries a Provenance record.
 *   2. AI inference can never be marked user_confirmed or clinician_confirmed.
 *   3. Clinician-confirmed facts outrank everything else on merge.
 *   4. Nothing in this file represents a diagnosis.
 */
import { z } from 'zod';

/** Who produced the value. */
export const SourceTypeSchema = z.enum([
  'user_statement', // user typed or said it
  'user_selection', // user clicked / dragged on the anatomy model
  'ai_inference', // model reasoning — candidate only, never fact
  'device_import', // wearable / phone / health platform measurement
  'external_record', // lab report, imaging report, discharge summary
  'clinician_confirmed', // a human clinician asserted it
  'system_rule', // deterministic rule engine (e.g. red-flag matcher)
  'user_edited', // user corrected an existing value
]);
export type SourceType = z.infer<typeof SourceTypeSchema>;

/**
 * Authority ranking. Higher wins when two values for the same field conflict.
 * This ordering is business logic, not opinion: a doctor's diagnosis outranks
 * a user self-report, which outranks an AI guess.
 */
export const AUTHORITY_RANK: Record<SourceType, number> = {
  ai_inference: 10,
  system_rule: 20,
  user_selection: 30,
  user_statement: 40,
  user_edited: 50,
  device_import: 60,
  external_record: 70,
  clinician_confirmed: 90,
};

export const VerificationStatusSchema = z.enum([
  'unverified', // nobody has checked it; raw capture
  'user_confirmed', // the user looked at it and said "yes, this is right"
  'clinician_confirmed', // a clinician has accepted or corrected it
  'refuted', // explicitly contradicted and should be shown differently
]);
export type VerificationStatus = z.infer<typeof VerificationStatusSchema>;

export const ProvenanceSchema = z.object({
  sourceType: SourceTypeSchema,
  /** Concrete pointer: transcript turn id, file name, FHIR resource id, rule id. */
  sourceReference: z.string().nullish(),
  capturedAt: z.string().datetime(),
  /**
   * 0..1. Only meaningful for ai_inference. User-stated and clinician-stated
   * values are treated as assertions, not probabilities.
   */
  confidence: z.number().min(0).max(1).nullish(),
  verificationStatus: VerificationStatusSchema,
  /** Human-readable actor: "user", "claude-opus-5", "rule:redflag:msk-007". */
  createdBy: z.string(),
  /** Verbatim user phrasing, so the original feeling is never lost. */
  rawText: z.string().nullish(),
});
export type Provenance = z.infer<typeof ProvenanceSchema>;

export const ProvenanceSchemaFor = <T extends z.ZodTypeAny>(value: T) =>
  z.object({ value: value, provenance: ProvenanceSchema });

/** A domain value plus where it came from. */
export interface Attributed<T> {
  value: T;
  provenance: Provenance;
}

export function attributed<T>(
  value: T,
  init: Omit<Provenance, 'capturedAt'> & { capturedAt?: string },
): Attributed<T> {
  return {
    value,
    provenance: {
      ...init,
      capturedAt: init.capturedAt ?? new Date().toISOString(),
    },
  };
}

/* ------------------------------------------------------------------ */
/* Invariants                                                          */
/* ------------------------------------------------------------------ */

const VERIFICATION_ALLOWED: Record<SourceType, VerificationStatus[]> = {
  ai_inference: ['unverified', 'refuted'],
  system_rule: ['unverified', 'user_confirmed', 'refuted'],
  user_statement: ['unverified', 'user_confirmed', 'refuted'],
  user_selection: ['unverified', 'user_confirmed', 'refuted'],
  user_edited: ['user_confirmed'],
  device_import: ['unverified', 'user_confirmed', 'clinician_confirmed', 'refuted'],
  external_record: ['unverified', 'clinician_confirmed', 'refuted'],
  clinician_confirmed: ['clinician_confirmed', 'refuted'],
};

export type InvariantViolation = { field: string; reason: string };

/**
 * Throws on any provenance that would let a model assertion masquerade as a
 * confirmed fact. Called on every write path that persists a record.
 */
export function assertProvenance(field: string, p: Provenance): void {
  const allowed = VERIFICATION_ALLOWED[p.sourceType];
  if (!allowed) {
    throw new Error(`[provenance] ${field}: unknown sourceType "${p.sourceType}"`);
  }
  if (!allowed.includes(p.verificationStatus)) {
    throw new Error(
      `[provenance] ${field}: sourceType "${p.sourceType}" cannot carry ` +
        `verificationStatus "${p.verificationStatus}". Allowed: ${allowed.join('|')}`,
    );
  }
  if (p.sourceType === 'ai_inference' && p.confidence == null) {
    throw new Error(`[provenance] ${field}: ai_inference requires an explicit confidence`);
  }
}

export function checkProvenance(field: string, p: Provenance): InvariantViolation[] {
  const out: InvariantViolation[] = [];
  try {
    assertProvenance(field, p);
  } catch (e) {
    out.push({ field, reason: e instanceof Error ? e.message : String(e) });
  }
  return out;
}

/**
 * Merge two competing values for the same field. Higher authority wins; ties
 * break toward the more human-verified record, then the more recent one.
 * The loser's provenance is preserved so the UI can show "this was changed".
 */
export function mergeAttributed<T>(a: Attributed<T> | null, b: Attributed<T> | null): Attributed<T> | null {
  if (!a) return b;
  if (!b) return a;
  const ra = AUTHORITY_RANK[a.provenance.sourceType];
  const rb = AUTHORITY_RANK[b.provenance.sourceType];
  if (rb > ra) return b;
  if (ra > rb) return a;
  const confirmed = (p: Provenance) =>
    p.verificationStatus === 'clinician_confirmed' ? 2 : p.verificationStatus === 'user_confirmed' ? 1 : 0;
  if (confirmed(b.provenance) > confirmed(a.provenance)) return b;
  if (confirmed(a.provenance) > confirmed(b.provenance)) return a;
  return a.provenance.capturedAt >= b.provenance.capturedAt ? a : b;
}
