/**
 * Symptom Orchestrator.
 *
 * Two implementations behind one interface:
 *   - DeterministicOrchestrator: no model, fully offline, always available.
 *   - ModelOrchestrator: Claude with tool-use, used only to interpret free
 *     text into grounded candidates.
 *
 * The hard boundary: the model may propose. It may not confirm, and it may not
 * write. Everything it returns is an `ai_candidate` that the user has to accept
 * on the anatomy model before it becomes part of the record.
 *
 * The other hard boundary: THERE IS NO DEFAULT REGION. A previous version fell
 * back to `shoulder` whenever nothing matched, so a chest complaint silently
 * entered the shoulder questionnaire. Localisation now returns either a grounded
 * result or an explicit refusal, and callers must handle both.
 */
import { z } from 'zod';
import {
  getSubRegion,
  REGIONS,
  type BodyRegion,
  type ConsideredStructure,
  type Depth,
  type Side,
} from '@asi/shared';
import {
  ALL_RULES,
  getStructure,
  groundFromText,
  groundingRefusal,
  detectOutOfScope,
  structuresForRegion,
  structureBelongsToRegion,
  signalIsAskedInRegion,
  SIGNAL_NAMES,
} from '@asi/shared';
import { hasModel, env } from '../env.ts';

export interface LocaliseRequest {
  utterance: string;
  /** Region already pinned by the user on the model, if any. */
  pinnedRegion?: BodyRegion;
}

interface GroundedBase {
  status: 'grounded';
  userPhrase: string;
  consideredStructures: ConsideredStructure[];
  by: 'deterministic' | 'model';
  matchedTerms: string[];
  score: number;
  /** A short question to ask before proceeding, if the input is ambiguous. */
  clarificationQuestion: string | null;
}

export type LocaliseResult =
  | (GroundedBase & {
      region: BodyRegion;
      side: Side;
      depth: Depth;
      suggestedSubRegionId: string | null;
    })
  | {
      /** Explicitly NOT localised. Callers must not start an MSK interview. */
      status: 'unsupported';
      reason: 'ungrounded' | 'out_of_scope';
      userPhrase: string;
      message: string;
      supportedRegions: BodyRegion[];
      outOfScopeRegions: string[];
    };

/** Rule ids a model must never be able to influence. Used for prompt hygiene. */
const SAFETY_RULE_IDS = ALL_RULES.map((r) => r.id);

export interface Orchestrator {
  readonly kind: 'deterministic' | 'model';
  localise(req: LocaliseRequest): Promise<LocaliseResult>;
}

/* ------------------------------------------------------------------ */
/* Deterministic                                                      */
/* ------------------------------------------------------------------ */

function deterministicLocalise(utterance: string, pinned?: BodyRegion): LocaliseResult {
  const outOfScope = detectOutOfScope(utterance);
  if (outOfScope) {
    const r = groundingRefusal(utterance, outOfScope);
    return {
      status: 'unsupported',
      reason: r.reason,
      userPhrase: r.userPhrase,
      message: r.message,
      supportedRegions: r.supportedRegions,
      outOfScopeRegions: r.outOfScopeRegions,
    };
  }

  const g = groundFromText(utterance);
  // A user who has already pinned a region on the model has grounded it by
  // pointing, which is stronger evidence than text matching. That is the only
  // case where we proceed without a text match.
  if (!g && !pinned) {
    const r = groundingRefusal(utterance, null);
    return {
      status: 'unsupported',
      reason: r.reason,
      userPhrase: r.userPhrase,
      message: r.message,
      supportedRegions: r.supportedRegions,
      outOfScopeRegions: r.outOfScopeRegions,
    };
  }

  if (!g) {
    return {
      status: 'grounded',
      region: pinned!,
      side: 'unknown',
      depth: 'unknown',
      suggestedSubRegionId: null,
      consideredStructures: [],
      userPhrase: utterance,
      by: 'deterministic',
      matchedTerms: [],
      score: 0,
      clarificationQuestion: 'Which side, and is it on the surface or deeper in?',
    };
  }

  const region = pinned ?? g.region;
  const structures = pinned
    ? g.consideredStructures.filter((c) => structureBelongsToRegion(c.structureId, pinned))
    : g.consideredStructures;

  return {
    status: 'grounded',
    region,
    side: g.side,
    depth: g.depth,
    suggestedSubRegionId: pinned ? null : g.suggestedSubRegionId,
    consideredStructures: structures,
    userPhrase: g.userPhrase,
    by: 'deterministic',
    matchedTerms: g.matchedTerms,
    score: g.score,
    // Ask rather than assume when the side is unresolved on a paired region.
    clarificationQuestion:
      region === 'lower_back' || region === 'neck'
        ? g.side === 'unknown'
          ? 'Is this in the middle of the area, or on one side?'
          : null
        : g.side === 'unknown'
          ? 'Which side?'
          : null,
  };
}

export class DeterministicOrchestrator implements Orchestrator {
  readonly kind = 'deterministic' as const;
  async localise(req: LocaliseRequest): Promise<LocaliseResult> {
    return deterministicLocalise(req.utterance, req.pinnedRegion);
  }
}

/* ------------------------------------------------------------------ */
/* Model                                                              */
/* ------------------------------------------------------------------ */

/** Runtime schema for the tool result. Never trust the model's output shape. */
const ToolResultSchema = z.object({
  region: z.enum(['shoulder', 'neck', 'lower_back', 'knee']),
  side: z.enum(['left', 'right', 'midline', 'bilateral', 'unknown']),
  depth: z.enum(['superficial', 'intermediate', 'deep', 'unknown']),
  suggestedSubRegionId: z.string().nullish(),
  structureIds: z.array(z.string().max(80)).max(8).default([]),
  needsClarification: z.boolean().default(false),
  clarificationQuestion: z.string().max(240).nullish(),
});

/**
 * Bounded candidate structure list. This is what the previous implementation
 * CLAIMED to send and did not — the model was asked to choose from "the
 * candidate list" that was never present in the prompt, so it could only
 * invent ids. Now the list is built, length-capped, and sent.
 */
/**
 * The tripwire, not the truncation point.
 *
 * The ontology holds 54 structures across four regions. The old cap was 40 and the
 * catalogue was built in region order, so the fourteen that fell off the end were the
 * knee's -- a knee complaint could not produce knee candidates, and the ids were then
 * filtered out downstream, which made it present as "the model chose nothing".
 *
 * This is set ABOVE the real size deliberately. The whole ontology costs roughly 2k tokens
 * of ids and labels, which is not a prompt-length problem; the problem was a cap that
 * silently ate a body part. So the cap is now generous, and the guard below throws if the
 * ontology ever outgrows it -- which turns "some region is invisible to the model" from a
 * silent defect into a startup failure somebody has to look at.
 */
const MAX_CANDIDATE_STRUCTURES = 200;

/**
 * Every structure id the model may propose, deduplicated.
 *
 * Three defects in the version this replaces:
 *
 *  1. `slice(0, 40)` over a list built in REGION ORDER, while the prompt states "the
 *     catalogue is the complete set of ids you may use". It was 40 of 54, and the 14 that
 *     fell off the end were the knee's -- so a knee complaint could not produce knee
 *     candidates at all. The ids were then silently filtered out by `catalogueIds.has(id)`,
 *     which is why it presented as "the model picked nothing" rather than as a truncation.
 *  2. The region list was hardcoded rather than read from `REGIONS`, so a fifth region would
 *     have been invisible here.
 *  3. No deduplication. `asi:shoulder.deltoid` belongs to three shoulder sub-regions and
 *     occupied three of the forty slots, so each additional region pushed more out.
 *
 * The cap is now a real safety valve rather than a silent truncation: if the ontology ever
 * grows past it, this THROWS rather than quietly dropping the tail. A cap that fires is a
 * decision somebody has to make.
 */
function candidateCatalogue(): { id: string; label: string; layTerm: string | null; region: string }[] {
  const byId = new Map<string, { id: string; label: string; layTerm: string | null; region: string }>();
  for (const region of Object.keys(REGIONS) as BodyRegion[]) {
    for (const structure of structuresForRegion(region)) {
      const existing = byId.get(structure.id);
      // Keep the FIRST region a structure belongs to: it is the one whose prefix it wears,
      // and the model only needs the id.
      if (!existing) byId.set(structure.id, { id: structure.id, label: structure.label, layTerm: structure.layTerm ?? null, region });
    }
  }
  const all = [...byId.values()];
  if (all.length > MAX_CANDIDATE_STRUCTURES)
    throw new Error(
      `the candidate catalogue has ${all.length} structures, above the ${MAX_CANDIDATE_STRUCTURES} cap. ` +
        `Raising the cap sends a longer prompt; LOWERING it silently drops ids and the model ` +
        `cannot propose them -- which is what the previous unconditional slice did, losing ` +
        `every knee structure. This must be a decision, not a truncation.`,
    );
  return all;
}

const CATALOGUE = candidateCatalogue();

const LOCALISE_TOOL = {
  name: 'propose_anatomical_location',
  description:
    'Propose where on the body the patient is describing a symptom. This is a CANDIDATE, ' +
    'not a finding. Never state a diagnosis, a condition name, a disease, or a probability. ' +
    'Only location, side, depth, structure ids from the supplied catalogue, and optionally ' +
    'one short clarification question.',
  input_schema: {
    type: 'object' as const,
    properties: {
      region: { type: 'string', enum: ['shoulder', 'neck', 'lower_back', 'knee'] },
      side: { type: 'string', enum: ['left', 'right', 'midline', 'bilateral', 'unknown'] },
      depth: { type: 'string', enum: ['superficial', 'intermediate', 'deep', 'unknown'] },
      suggestedSubRegionId: { type: ['string', 'null'] },
      structureIds: {
        type: 'array',
        items: { type: 'string' },
        description: 'IDs chosen ONLY from the supplied catalogue. Do not invent ids.',
      },
      needsClarification: { type: 'boolean' },
      clarificationQuestion: {
        type: 'string',
        description: 'One short question, only if needsClarification is true.',
      },
    },
    required: ['region', 'side', 'depth', 'structureIds'],
  },
};

function systemPrompt(): string {
  return `You localise symptoms on the human body. You do NOT diagnose.

You will be given one patient sentence and a CATALOGUE of anatomical structures with their
exact ids. Call the tool with:
- the best-matching region from the catalogue's four regions
- left / right / midline / bilateral / unknown
- superficial / intermediate / deep / unknown
- structure ids copied EXACTLY from the catalogue
- needsClarification true and one short question ONLY if the sentence is genuinely ambiguous

The catalogue is the complete set of ids you may use. If nothing in the catalogue fits, return
an empty structureIds array rather than inventing an id.

Never output a disease name, a diagnosis, a probability of disease, or a treatment.

These rule ids exist in this system and are not yours to reason about: ${SAFETY_RULE_IDS.join(', ')}.
Safety messaging is produced by a deterministic rule engine, not by you.`;
}

export class ModelOrchestrator implements Orchestrator {
  readonly kind = 'model' as const;
  // Declared explicitly: TypeScript parameter properties are not supported by
  // the strip-only type-stripping this project runs under.
  private apiKey: string;
  private model: string;
  private fallback: Orchestrator;

  constructor(apiKey: string, model: string, fallback?: Orchestrator) {
    this.apiKey = apiKey;
    this.model = model;
    this.fallback = fallback ?? new DeterministicOrchestrator();
  }

  async localise(req: LocaliseRequest): Promise<LocaliseResult> {
    // The model may only be consulted for input the router considers in scope.
    // Deciding scope is not the model's job.
    const precheck = detectOutOfScope(req.utterance);
    if (precheck) return deterministicLocalise(req.utterance, req.pinnedRegion);

    try {
      const res = await fetch('https://api.anthropic.com/v1/messages', {
        method: 'POST',
        headers: {
          'content-type': 'application/json',
          'x-api-key': this.apiKey,
          'anthropic-version': '2023-06-01',
        },
        body: JSON.stringify({
          model: this.model,
          max_tokens: 1024,
          system: systemPrompt(),
          messages: [{ role: 'user', content: req.utterance }],
          tools: [LOCALISE_TOOL],
          tool_choice: { type: 'tool', name: LOCALISE_TOOL.name },
        }),
      });
      if (!res.ok) return this.fallback.localise(req);

      const json = (await res.json()) as {
        content?: { type: string; name?: string; input?: unknown }[];
      };
      const call = json.content?.find((c) => c.type === 'tool_use');
      if (!call) return this.fallback.localise(req);

      // Validate the COMPLETE tool result at runtime, not field by field.
      const parsed = ToolResultSchema.safeParse(call.input);
      if (!parsed.success) return this.fallback.localise(req);
      const input = parsed.data;

      const catalogueIds = new Set(CATALOGUE.map((c) => c.id));
      const consideredStructures: ConsideredStructure[] = input.structureIds
        .filter((id) => catalogueIds.has(id) && structureBelongsToRegion(id, input.region))
        .map((id) => {
          const s = getStructure(id);
          return {
            structureId: id,
            rationale: s?.layTerm ? `You described something like “${s.layTerm}”.` : null,
            // The model self-reports. It is never treated as calibrated, and a
            // fixed value is used so a model cannot inflate its own confidence.
            confidence: 0.5,
            selectedByUser: false,
          } satisfies ConsideredStructure;
        });

      // A sub-region must actually exist in the region, or we drop it.
      const subRegionId =
        input.suggestedSubRegionId && signalSafeSubRegion(input.region, input.suggestedSubRegionId)
          ? input.suggestedSubRegionId
          : null;

      return {
        status: 'grounded',
        region: input.region,
        side: input.side,
        depth: input.depth,
        suggestedSubRegionId: subRegionId,
        consideredStructures,
        userPhrase: req.utterance,
        by: 'model',
        matchedTerms: [],
        score: 0.7,
        // The clarification output is USED, not declared and dropped.
        clarificationQuestion: input.needsClarification ? (input.clarificationQuestion ?? null) : null,
      };
    } catch {
      return this.fallback.localise(req);
    }
  }
}

/**
 * Does this sub-region exist in this region?
 *
 * It used to answer `structuresForRegion(region).length > 0 && subRegionId.startsWith(
 * region + '.')`, with the comment "a sub-region must actually exist in the region, or we
 * drop it". It did not check that: `'shoulder.anything-at-all'` passed both clauses. The
 * first clause is also true for every `BodyRegion`, so it read like a check and was not one.
 *
 * `getSubRegion` is the ontology's own answer, and this is the validator for what a MODEL
 * proposes -- which is exactly where a weak check lets a fabricated location through into
 * the record.
 */
function signalSafeSubRegion(region: BodyRegion, subRegionId: string): boolean {
  return Boolean(getSubRegion(region, subRegionId));
}

export function createOrchestrator(): Orchestrator {
  if (hasModel()) {
    return new ModelOrchestrator(env.ANTHROPIC_API_KEY!, env.ASI_MODEL);
  }
  return new DeterministicOrchestrator();
}

export { SIGNAL_NAMES, signalIsAskedInRegion };
