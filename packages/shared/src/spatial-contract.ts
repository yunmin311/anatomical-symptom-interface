/**
 * The spatial history transport contract.
 * This lives in shared because it is a CONTRACT between the server read model and
 * the browser, and a contract that lives in only one of them is a contract the two
 * sides can drift from. Before this, the server returned places grouped by
 * (person, region, side, sub-region, quantised point cell) and the browser
 * re-derived places by grouping episodes on region + sub-region + side.
 *
 * That combination was not a display convenience, it was a contradiction. Two
 * episodes in one sub-region but two different point cells are two places on the
 * server and one mark in the browser, so the client silently undid a semantic
 * decision the storage layer had already made and made carefully. Sharing the type
 * is what makes that class of bug a compile error or an obvious type mismatch
 * rather than a subtle difference in what "a place" means.
 *
 * WHAT THIS IS NOT. It is not a client-side schema and not a cache: there is no
 * second place identity here, and a client that groups these nodes again is
 * re-deciding identity it was handed. Presentation — sorting, labelling,
 * filtering — belongs above this type and never inside it.
 *
 * And still not a risk map. `episodeCount` is how OFTEN something was described
 * at a place. It carries no severity, no weighting and no inference about cause,
 * and the two facts are kept separate rather than merged into a score, because a
 * body map that shades by frequency invites exactly the reading this product must
 * not support.
 */
import type { Episode } from './symptom.ts';
import type { AnswerMap } from './answers.ts';
import type { SafetyEvaluation } from './rules/redflags.ts';
import type { InterviewQuestion, QuestionProgress } from './interview/engine.ts';

/** Normalised 0..1 on the body map, so 2D and 3D agree on where a place is. */
export interface SpatialPoint {
  x: number;
  y: number;
}

/** One episode behind a place's count, enough to draw a marker without a fetch. */
export interface SpatialEpisodeRef {
  id: string;
  startedAt: string;
  endedAt: string | null;
  status: string;
  /** The episode's own title, already a short human phrase. */
  title: string;
  /**
   * THIS EPISODE's pin, from its own record.
   *
   * Present alongside the place's aggregate `point` because they are different
   * facts: the episode is where this occurrence was described, the place point is
   * the mean of every pin in the same cell. A client given only the aggregate could
   * not tell where one episode actually was, and would attribute every episode in a
   * place to the same spot.
   */
  point: SpatialPoint | null;
  /** Safety flags raised on this episode, so a marker can show it without a fetch. */
  safetyFlagCount: number;
  /**
   * Structures the user pointed at, as LABELS. A location, not a finding: these are
   * what someone indicated, never what was diagnosed.
   */
  visualSelections: string[];
}

/** One place in a person's body history, as the server groups it. */
export interface SpatialHistoryNode {
  /**
   * Stable server-side row identity, for keying and for "go to this place". Empty
   * for a region the person has never described anything in — see the placeholder
   * note below.
   */
  regionRowId: string;
  region: string;
  side: string;
  subRegionId: string | null;
  /**
   * The place's AGGREGATE point: the mean of the pins of the episodes behind this
   * place. Null when no episode in this place carried a pin, which is most of them
   * and must never be filled in with a guess.
   */
  point: SpatialPoint | null;
  /** The true total. Never the length of a truncated `episodes` list. */
  episodeCount: number;
  lastEpisodeAt: string | null;
  lastTitle: string | null;
  /**
   * Newest first, and possibly TRUNCATED by the server's per-place limit. The
   * count is always authoritative; a client that needs every episode fetches them.
   */
  episodes: SpatialEpisodeRef[];
}

/**
 * Every region the map has to draw, including the ones with no history.
 *
 * The body map draws the whole body, so a region with nothing in it has to come
 * back as an empty node rather than being absent. An absent region is one the
 * client has to special-case, and a client that special-cases it will eventually
 * special-case it wrongly.
 */
export function isSpatialPlaceholder(node: SpatialHistoryNode): boolean {
  return node.episodeCount === 0;
}

/** True when a node carries at least one episode, and so can be drawn as history. */
export function hasSpatialHistory(node: SpatialHistoryNode): boolean {
  return node.episodeCount > 0;
}

/* ------------------------------------------------------------------ */
/* Episode reopen                                                       */
/* ------------------------------------------------------------------ */

/**
 * Everything needed to resume an episode.
 *
 * Declared in shared for the same reason as the spatial nodes: the browser
 * consumes it, and a resume payload that the client has to guess at is a resume
 * that can disagree with the server about what comes next.
 *
 * The concrete value types are left as the shared domain's own — `Episode`,
 * `AnswerMap`, `SafetyEvaluation`, `QuestionProgress` — and the next question is
 * the interview engine's own question shape. This is a transport description, not
 * a redefinition of any of them.
 *
 * `summary` is deliberately absent. Rebuilding one is cheap, but it evaluates the
 * safety rules, and a resume should not re-present a blocked gate as if it were
 * new. The client fetches a summary when it actually renders one.
 */
export interface EpisodeReopen {
  episode: Episode;
  /**
   * How this episode was localised, carried through rather than re-inferred.
   * `by` names the orchestrator that read the text and MUST reach the UI and the
   * stored episode; inferring it from `status` would be wrong, because a grounded
   * result can have come from either orchestrator.
   */
  grounding: {
    status: string;
    reason: 'ungrounded' | 'out_of_scope' | null;
    by: 'deterministic' | 'model' | null;
    score: number | null;
    clarification: string | null;
  } | null;
  answers: AnswerMap;
  safety: SafetyEvaluation | null;
  /** The next unanswered question for this episode's region, or null when done. */
  nextQuestion: InterviewQuestion | null;
  progress: QuestionProgress;
  /**
   * Fields with no stored value: what a clinician would still need to ask.
   * Derived from the field store, so it is the truth rather than a guess from
   * which questions happened to be displayed.
   */
  outstandingFields: string[];
  /** False when this build has no interview for the episode's region. */
  interviewable: boolean;
}