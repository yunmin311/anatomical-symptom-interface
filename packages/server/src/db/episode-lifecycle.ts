/**
 * Episode lifecycle read model.
 *
 * The write path is unchanged and stays single: everything goes through
 * `applyMutations`. This is a READ side, and it exists because "reopen an episode
 * and carry on" was not a first-class thing: the pieces were all reachable, but
 * nothing assembled them into the one payload a resuming session needs.
 *
 * A resuming session needs more than the record. It needs to know which question
 * comes next, how far through the interview the user was, what is still
 * outstanding, and whether anything was flagged while they were away. Without
 * that, reopening an episode means re-deriving it in the browser, which is how a
 * client ends up disagreeing with the server about what the next question is.
 *
 * So the server derives it once, from the same functions the interview engine
 * uses, and the client renders it.
 */
import { answersFor, coverageFor, getEpisode, getGrounding, safetyFor } from './store.ts';
import { nextQuestion, questionProgress } from '@asi/shared';
import type { Episode, SafetyEvaluation } from '@asi/shared';
import type { ReleaseProfile } from '@asi/shared';

export interface EpisodeReopen {
  episode: Episode;
  grounding: ReturnType<typeof getGrounding>;
  answers: ReturnType<typeof answersFor>;
  safety: SafetyEvaluation | null;
  /** The next unanswered question for this episode's region, or null when done. */
  nextQuestion: ReturnType<typeof nextQuestion> | null;
  progress: ReturnType<typeof questionProgress>;
  /**
   * Fields with no stored value, i.e. what a clinician would still need to ask.
   * Derived from the field store, so it is the truth rather than a guess from
   * which questions happen to have been displayed.
   */
  outstandingFields: string[];
  /** True when the episode's region is not one this build has an interview for. */
  interviewable: boolean;
}

/**
 * Everything needed to resume an episode.
 *
 * `summary` is deliberately NOT included. Rebuilding a summary is cheap but it
 * evaluates the safety rules, and a resume should not re-present a blocked gate
 * as if it were new. The client fetches the summary when it actually renders it.
 */
export function episodeForReopen(episodeId: string, profile: ReleaseProfile): EpisodeReopen | null {
  const episode = getEpisode(episodeId);
  if (!episode) return null;

  const answers = answersFor(episodeId);
  const region = episode.record.location.region;
  const interviewable = questionProgress({ record: episode.record, answers }).total > 0;

  return {
    episode,
    grounding: getGrounding(episodeId),
    answers,
    safety: safetyFor(episodeId, profile),
    nextQuestion: interviewable ? nextQuestion({ record: episode.record, answers }) : null,
    progress: questionProgress({ record: episode.record, answers }),
    outstandingFields: Object.entries(coverageFor(episodeId))
      .filter(([, recorded]) => !recorded)
      .map(([path]) => path),
    interviewable,
  };
}
