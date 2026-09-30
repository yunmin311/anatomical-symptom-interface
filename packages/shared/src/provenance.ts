/**
 * Provenance, claim class and evidence status.
 *
 * This is the single most important file in the product. The whole point of
 * Anatomical Symptom Interface is that "what the user felt", "what the model
 * guessed", "what a device measured" and "what a doctor concluded" never get
 * flattened into one undifferentiated "medical history".
 *
 * There are TWO INDEPENDENT AXES, and conflating them was a real bug:
 *
 *   1. PROVENANCE  — who supplied the value, when, how sure, verified or not.
 *                    (`sourceType`, `capturedAt`, `confidence`, `verificationStatus`)
 *
 *   2. EVIDENCE STATUS — what KIND of claim it is.
 *                    (`evidenceStatus`: user report / visual selection /
 *                     AI candidate / clinician finding / system derived)
 *
 * These are not the same thing. A user clicking a tendon on the body map has
 * `sourceType: 'user_selection'` AND `evidenceStatus: 'visual_selection'`. That
 * means "the user pointed here" — it emphatically does NOT mean "this tendon is
 * the problem". See docs/adr/0004-visual-selection-is-not-a-finding.md.
 *
 * Hard rules enforced here (see docs/adr/0003-separate-clinical-layer.md):
 *   1. Every persisted value carries a Provenance record.
 *   2. AI inference can never be marked user_confirmed or clinician_confirmed.
 *   3. A source type and an evidence status must be compatible.
 *   4. Merge authority is per claim class, not global. A device reading or a
 *      lab report must never overwrite what the patient said they feel.
 *   5. Nothing in this file represents a diagnosis.
 */
import { z } from 'zod';

/* ------------------------------------------------------------------ */
/* Axis 1 — provenance: who supplied it                                */
/* ------------------------------------------------------------------ */

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

/* ------------------------------------------------------------------ */
/* Axis 2 — evidence status: what kind of claim it is                  */
/* ------------------------------------------------------------------ */

/**
 * Deliberately contains NO disease or pathology vocabulary. These are
 * epistemic categories, not clinical conclusions. Adding "suspected_diagnosis"
 * here would be the exact boundary violation ADR 0003 forbids.
 */
export const EvidenceStatusSchema = z.enum([
  'user_report', // the patient described it in words
  'visual_selection', // the patient pointed at it on the anatomy model
  'ai_candidate', // the model proposed it; not asserted by anyone
  'clinician_finding', // a clinician asserted it
  'system_derived', // computed by our own deterministic code
]);
export type EvidenceStatus = z.infer<typeof EvidenceStatusSchema>;

/**
 * Which evidence status a source type is allowed to produce. This is a hard
 * invariant: a model can only ever produce a candidate, and only a clinician
 * can produce a finding.
 */
const EVIDENCE_FOR_SOURCE: Record<SourceType, readonly EvidenceStatus[]> = {
  ai_inference: ['ai_candidate'],
  system_rule: ['system_derived'],
  user_selection: ['visual_selection'],
  user_statement: ['user_report'],
  user_edited: ['user_report', 'visual_selection'],
  device_import: ['user_report'], // the patient chose to import it; still not a finding
  external_record: ['user_report', 'clinician_finding'],
  clinician_confirmed: ['clinician_finding'],
};

export function evidenceStatusFor(sourceType: SourceType): EvidenceStatus {
  const first = EVIDENCE_FOR_SOURCE[sourceType][0];
  // Every source type has at least one entry; the non-null assertion is safe
  // because EVIDENCE_FOR_SOURCE is exhaustive over SourceType.
  if (!first) throw new Error(`[provenance] no evidence status defined for sourceType "${sourceType}"`);
  return first;
}

export const VerificationStatusSchema = z.enum([
  'unverified', // nobody has checked it; raw capture
  'user_confirmed', // the user has acknowledged this value
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
  /**
   * Which axis-2 category this value is. Defaults to the only status the
   * sourceType permits, so callers that do not care never have to set it.
   */
  evidenceStatus: EvidenceStatusSchema.optional(),
});
export type Provenance = z.infer<typeof ProvenanceSchema>;

/** A domain value plus where it came from. */
export interface Attributed<T> {
  value: T;
  provenance: Provenance;
}

export function attributed<T>(
  value: T,
  init: Omit<Provenance, 'capturedAt' | 'evidenceStatus'> & {
    capturedAt?: string;
    evidenceStatus?: EvidenceStatus;
  },
): Attributed<T> {
  return {
    value,
    provenance: {
      ...init,
      capturedAt: init.capturedAt ?? new Date().toISOString(),
      evidenceStatus: init.evidenceStatus ?? evidenceStatusFor(init.sourceType),
    },
  };
}

/* ------------------------------------------------------------------ */
/* Claim classes — what KIND of statement a field makes                 */
/* ------------------------------------------------------------------ */

/**
 * A claim class describes the epistemic type of a field, which determines
 * which sources are even allowed to assert it and how they are ranked.
 *
 * The reason this exists: a single global rank is wrong for health data. With a
 * global rank, `device_import` (60) outranks `user_statement` (40), so a
 * wearable step count would silently overwrite "my knee hurts". That is
 * indefensible — a device measures something narrow and objective; the patient's
 * subjective report is the primary source for symptoms and is not replaceable
 * by any measurement of a different thing.
 */
export const ClaimClassSchema = z.enum([
  'symptom_subjective', // what the patient feels: pain, quality, triggers
  'location_anatomical', // where it is on the body, which structure they pointed at
  'measurement', // numbers: temperature, range of motion, heart rate
  'clinical_conclusion', // clinician assertions: diagnosis, treatment, outcome
  'derived', // computed by our own deterministic code
]);
export type ClaimClass = z.infer<typeof ClaimClassSchema>;

/**
 * Per-class authority. A source type ABSENT from a class may not become the
 * winner for that class; its value is preserved in parallel instead (see
 * `mergeField`). That absence is the mechanism, not an oversight.
 *
 * Note `device_import` and `external_record` are deliberately missing from
 * `symptom_subjective` and `location_anatomical`.
 */
const CLASS_AUTHORITY: Record<ClaimClass, Partial<Record<SourceType, number>>> = {
  symptom_subjective: {
    ai_inference: 10,
    system_rule: 15,
    user_selection: 20,
    user_statement: 60,
    user_edited: 70,
    // clinician may annotate a symptom description
    clinician_confirmed: 80,
  },
  location_anatomical: {
    ai_inference: 10,
    system_rule: 15,
    user_statement: 40,
    user_selection: 60,
    user_edited: 70,
    clinician_confirmed: 80,
  },
  measurement: {
    ai_inference: 5,
    system_rule: 10,
    user_statement: 20,
    user_edited: 40,
    device_import: 80,
    external_record: 85,
    clinician_confirmed: 90,
  },
  clinical_conclusion: {
    ai_inference: 1,
    user_statement: 5,
    user_edited: 5,
    external_record: 50,
    clinician_confirmed: 95,
  },
  derived: {
    ai_inference: 40,
    system_rule: 50,
  },
};

export function authorityFor(claimClass: ClaimClass, sourceType: SourceType): number | null {
  return CLASS_AUTHORITY[claimClass][sourceType] ?? null;
}

export function isAuthoritativeFor(claimClass: ClaimClass, sourceType: SourceType): boolean {
  return authorityFor(claimClass, sourceType) !== null;
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
 * Throws on provenance that would let a model assertion masquerade as a
 * confirmed fact, or a candidate masquerade as a finding. Called on every
 * write path that persists a value.
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
  const evidence = p.evidenceStatus ?? evidenceStatusFor(p.sourceType);
  const evidenceAllowed = EVIDENCE_FOR_SOURCE[p.sourceType];
  if (!evidenceAllowed.includes(evidence)) {
    throw new Error(
      `[provenance] ${field}: sourceType "${p.sourceType}" cannot carry ` +
        `evidenceStatus "${evidence}". Allowed: ${evidenceAllowed.join('|')}`,
    );
  }
  // Belt and braces: the two axes must never be allowed to imply each other.
  if (evidence === 'clinician_finding' && p.sourceType !== 'clinician_confirmed' && p.sourceType !== 'external_record') {
    throw new Error(`[provenance] ${field}: only a clinician or an external record may be a clinician_finding`);
  }
  if (evidence === 'ai_candidate' && p.sourceType !== 'ai_inference') {
    throw new Error(`[provenance] ${field}: only a model may produce an ai_candidate`);
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

/* ------------------------------------------------------------------ */
/* Merge — per claim class, with parallel preservation                 */
/* ------------------------------------------------------------------ */

/** A value that lost the merge but is kept so the conflict stays visible. */
export interface PreservedAssertion {
  value: unknown;
  provenance: Provenance;
  reason: string;
}

export interface MergeOutcome<T> {
  /** The value that now stands for this field. */
  winner: Attributed<T> | null;
  /** The incoming value, when it was allowed to take the field. */
  applied: boolean;
  reason?: string;
  /** Losing values kept alongside, with why they lost. */
  preserved: PreservedAssertion[];
}

const verificationWeight = (p: Provenance): number =>
  p.verificationStatus === 'clinician_confirmed' ? 2 : p.verificationStatus === 'user_confirmed' ? 1 : 0;

/**
 * Merge a new value into an existing one, per CLAIM CLASS.
 *
 * Rules:
 *  - If the incoming source type is not authoritative for the class, it can
 *    never win. It is preserved as a parallel assertion and the incumbent
 *    stands. This is how a lab report ends up recorded alongside "my knee
 *    hurts" instead of replacing it.
 *  - Otherwise higher authority wins; ties break to the more human-verified,
 *    then to the more recent.
 *  - The loser is always preserved, so the UI can show "this was changed" and
 *    the clinician can see both statements.
 */
export function mergeField<T>(
  incumbent: Attributed<T> | null,
  incoming: Attributed<T>,
  claimClass: ClaimClass,
): MergeOutcome<T> {
  if (!incumbent) {
    return { winner: incoming, applied: true, preserved: [] };
  }

  const incAuth = authorityFor(claimClass, incumbent.provenance.sourceType);
  // An incumbent whose own source is out of class for this field is not
  // defended as the winner (score -1), but it is still never silently erased:
  // it lands in `preserved` if the incoming value takes the field.
  const incAuthValue = incAuth ?? -1;
  const incV = incAuth === null ? -1 : verificationWeight(incumbent.provenance);

  const incomingAuth = authorityFor(claimClass, incoming.provenance.sourceType);
  if (incomingAuth === null) {
    return {
      winner: incumbent,
      applied: false,
      reason: `source "${incoming.provenance.sourceType}" cannot assert a "${claimClass}" value; kept in parallel`,
      preserved: [{ value: incoming.value, provenance: incoming.provenance, reason: 'not authoritative for class' }],
    };
  }

  const incomingV = verificationWeight(incoming.provenance);

  if (incomingAuth > incAuthValue) {
    return {
      winner: incoming,
      applied: true,
      preserved: [{ value: incumbent.value, provenance: incumbent.provenance, reason: `outranked by "${incoming.provenance.sourceType}"` }],
    };
  }

  if (incomingAuth < incAuthValue) {
    return {
      winner: incumbent,
      applied: false,
      reason: `field is owned by higher-authority source "${incumbent.provenance.sourceType}" for class "${claimClass}"`,
      preserved: [{ value: incoming.value, provenance: incoming.provenance, reason: 'incoming: lower authority' }],
    };
  }

  // Equal authority: prefer the more verified, then the more recent.
  if (incomingV > incV) {
    return {
      winner: incoming,
      applied: true,
      preserved: [{ value: incumbent.value, provenance: incumbent.provenance, reason: 'replaced: better verification' }],
    };
  }
  if (incomingV < incV) {
    return {
      winner: incumbent,
      applied: false,
      reason: 'incoming: less verified than incumbent',
      preserved: [{ value: incoming.value, provenance: incoming.provenance, reason: 'incoming: less verified' }],
    };
  }
  if (incoming.provenance.capturedAt > incumbent.provenance.capturedAt) {
    return {
      winner: incoming,
      applied: true,
      preserved: [{ value: incumbent.value, provenance: incumbent.provenance, reason: 'replaced: more recent' }],
    };
  }
  return {
    winner: incumbent,
    applied: false,
    reason: 'incoming: same authority, not more recent',
    preserved: [],
  };
}

/**
 * @deprecated Kept only so existing call sites fail loudly rather than silently
 * using global ranking. Use `mergeField` with an explicit claim class.
 */
export function mergeAttributed<T>(
  _a: Attributed<T> | null,
  _b: Attributed<T> | null,
): Attributed<T> | null {
  throw new Error(
    '[provenance] mergeAttributed() has no correct behaviour without a claim class. ' +
      'Use mergeField(incumbent, incoming, claimClass) — global ranking is what allowed ' +
      'a device reading to overwrite a subjective symptom report.',
  );
}
