/**
 * Symptom Orchestrator.
 *
 * Two implementations behind one interface:
 *   - DeterministicOrchestrator: no model, fully offline, always available.
 *   - ModelOrchestrator: Claude with tool-use, used only to interpret free
 *     text into grounded candidates.
 *
 * The hard boundary: the model may propose. It may not confirm, and it may not
 * write. Everything it returns is an `ai_inference` candidate that the user has
 * to accept on the anatomy model before it becomes part of the record.
 */
import type { BodyRegion, ConsideredStructure, Depth, Side } from '@asi/shared';
import { groundFromText, structureBelongsToRegion, getStructure } from '@asi/shared';
import { hasModel, env } from '../env.ts';

export interface LocaliseRequest {
  utterance: string;
  /** Region already pinned by the user on the model, if any. */
  pinnedRegion?: BodyRegion;
}

export interface LocaliseResult {
  region: BodyRegion;
  side: Side;
  depth: Depth;
  suggestedSubRegionId: string | null;
  consideredStructures: ConsideredStructure[];
  userPhrase: string;
  /** 'deterministic' | 'model' — surfaced in the UI so the user knows. */
  by: 'deterministic' | 'model';
  matchedTerms: string[];
  score: number;
}

export interface Orchestrator {
  readonly kind: 'deterministic' | 'model';
  localise(req: LocaliseRequest): Promise<LocaliseResult>;
}

const toResult = (utterance: string, pinned?: BodyRegion): LocaliseResult | null => {
  const g = groundFromText(utterance);
  if (!g) return null;
  // A region the user already pinned on the model outranks text matching.
  const region = pinned ?? g.region;
  const structures = pinned
    ? g.consideredStructures.filter((c) => structureBelongsToRegion(c.structureId, pinned))
    : g.consideredStructures;
  return {
    region,
    side: g.side,
    depth: g.depth,
    suggestedSubRegionId: pinned ? null : g.suggestedSubRegionId,
    consideredStructures: structures,
    userPhrase: g.userPhrase,
    by: 'deterministic',
    matchedTerms: g.matchedTerms,
    score: g.score,
  };
};

export class DeterministicOrchestrator implements Orchestrator {
  readonly kind = 'deterministic' as const;
  async localise(req: LocaliseRequest): Promise<LocaliseResult> {
    const result = toResult(req.utterance, req.pinnedRegion);
    if (result) return result;
    // Nothing matched. Rather than invent a region, defer to the user.
    const region = req.pinnedRegion ?? 'shoulder';
    return {
      region,
      side: 'unknown',
      depth: 'unknown',
      suggestedSubRegionId: null,
      consideredStructures: [],
      userPhrase: req.utterance,
      by: 'deterministic',
      matchedTerms: [],
      score: 0,
    };
  }
}

const LOCALISE_TOOL = {
  name: 'propose_anatomical_location',
  description:
    'Propose where on the body the patient is describing a symptom. This is a CANDIDATE. ' +
    'Never state a diagnosis, a condition name, or a disease. Only location, side, depth and ' +
    'candidate anatomical structures.',
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
        description: 'IDs from the candidate structure list only.',
      },
      needsClarification: { type: 'boolean' },
      clarificationQuestion: {
        type: 'string',
        description: 'One short question, e.g. asking whether it is the top or the outside of the shoulder.',
      },
    },
    required: ['region', 'side', 'depth', 'structureIds'],
  },
};

/**
 * Model-backed orchestrator.
 *
 * Constructed only when a key is present. It calls Claude with the candidate
 * structure list in the system prompt and forces a tool call, so the response
 * is schema-shaped rather than prose we have to parse. The tool's output is
 * still only a proposal — see ADR 0003.
 */
export class ModelOrchestrator implements Orchestrator {
  readonly kind = 'model' as const;
  constructor(
    private apiKey: string,
    private model: string,
    private fallback: Orchestrator = new DeterministicOrchestrator(),
  ) {}

  async localise(req: LocaliseRequest): Promise<LocaliseResult> {
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
          system: SYSTEM_PROMPT,
          messages: [{ role: 'user', content: req.utterance }],
          tools: [LOCALISE_TOOL],
          tool_choice: { type: 'tool', name: LOCALISE_TOOL.name },
        }),
      });
      if (!res.ok) return (await this.fallback.localise(req)) as LocaliseResult;
      const json = (await res.json()) as {
        content?: { type: string; name?: string; input?: Record<string, unknown> }[];
      };
      const call = json.content?.find((c) => c.type === 'tool_use');
      const input = call?.input;
      if (!input) return (await this.fallback.localise(req)) as LocaliseResult;

      const region = (input.region as BodyRegion) ?? 'shoulder';
      const ids = Array.isArray(input.structureIds) ? (input.structureIds as string[]) : [];
      const consideredStructures: ConsideredStructure[] = ids
        .filter((id) => typeof id === 'string' && id.startsWith('asi:') && structureBelongsToRegion(id, region))
        .map((id) => ({
          structureId: id,
          rationale: getStructure(id)?.layTerm ? `You described something like “${getStructure(id)!.layTerm}”.` : null,
          // The model self-reports; it is never treated as calibrated.
          confidence: 0.5,
          confirmedByUser: false,
        }));

      return {
        region,
        side: (input.side as Side) ?? 'unknown',
        depth: (input.depth as Depth) ?? 'unknown',
        suggestedSubRegionId: (input.suggestedSubRegionId as string | null) ?? null,
        consideredStructures,
        userPhrase: req.utterance,
        by: 'model',
        matchedTerms: [],
        score: 0.7,
      };
    } catch {
      return (await this.fallback.localise(req)) as LocaliseResult;
    }
  }
}

const SYSTEM_PROMPT = `You localise symptoms on the human body. You do NOT diagnose.

You will be given one patient sentence, usually in the first person, and a list of
candidate anatomical structures for each region. Call the tool with:
- the best-matching region
- left / right / midline / bilateral / unknown
- superficial / intermediate / deep / unknown
- structure ids chosen ONLY from the candidate list
- one short clarification question if the sentence is genuinely ambiguous

Never output a disease name, a diagnosis, a probability of disease, or a treatment.
The patient will confirm the location themselves on an anatomy model.`;

export function createOrchestrator(): Orchestrator {
  if (hasModel()) {
    return new ModelOrchestrator(env.ANTHROPIC_API_KEY!, env.ASI_MODEL);
  }
  return new DeterministicOrchestrator();
}
