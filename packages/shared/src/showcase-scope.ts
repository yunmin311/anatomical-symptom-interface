import type { BodyRegion } from './anatomy.ts';

/**
 * SHOWCASE SCOPE, STATED ONCE.
 *
 * Right Shoulder Showcase V1 is ONE region receiving investment. Every other
 * anatomical region is FROZEN: the platform still supports it, the generic code
 * still works, and nothing here removes it. What is frozen is *investment* --
 * no new anatomy packs, no new interview content, no visual work on those
 * regions until this showcase is done.
 *
 * WHY THIS IS A MODULE AND NOT A CONSTANT IN A COMPONENT
 * ------------------------------------------------------
 * Because the honesty requirement is the whole point. If a region can be quietly
 * presented as though it matched shoulder quality, the product starts making
 * claims about anatomy it has not reviewed. A single declaration that says which
 * region is being worked on, which are frozen, and WHY is auditable in one place,
 * and the interface renders from it rather than each screen deciding for itself.
 *
 * WHY THE STATES ARE NOT CALLED "COMPLETE"
 * ---------------------------------------
 * The first version of this file had `showcase | frozen | future`, with the
 * showcase region reading "Fully worked through in this showcase." Both halves of
 * that were wrong, and they were wrong in the direction this project most needs to
 * avoid.
 *
 * `showcase` was read as a certification -- "this region IS the finished one" --
 * while the work was explicitly still in progress. A state name that describes an
 * INTENT ("we are building this one") cannot be mistaken for a state name that
 * asserts an OUTCOME ("this one is done"). So the states are investment states,
 * and `regionIsComplete` is a separate, currently-false fact rather than a
 * meaning smuggled into a label.
 *
 * The frozen notes made the same error more quietly. They said neck's "anatomy pack
 * and interview wording are complete". Nobody has reviewed that claim, and
 * "complete" was being asserted about work that has not been through the showcase
 * review -- which is the whole reason the region is frozen. A frozen region is
 * untested against this bar, so its note describes what it DOES (the platform path
 * works) and never claims a quality level nobody has checked.
 *
 * Collapsing "frozen" into either of the others is the failure mode. Frozen
 * regions work; they are just not finished, and saying so is not the same as
 * hiding them.
 */

export type RegionShowcaseState = 'active' | 'frozen' | 'future';

export interface RegionShowcaseStatus {
  readonly region: BodyRegion;
  readonly state: RegionShowcaseState;
  /**
   * Whether this region has been through the showcase review end to end.
   *
   * Separate from `state` on purpose. `active` says where the effort is going;
   * this says whether it has arrived. Right shoulder is the first region where
   * that can honestly become true, and it is not true yet.
   */
  readonly reviewed: boolean;
  /** One sentence, written for a person, shown when a frozen region is reached. */
  readonly note: string;
  /** What a frozen region can still do, so the note is not just a refusal. */
  readonly stillWorks: readonly string[];
}

/**
 * Showcase V1: right shoulder only.
 *
 * Everything else is frozen, not removed. The order is deliberate -- shoulder is
 * the region the anatomy pipeline has the deepest real geometry for, so it is the
 * one that can be finished properly first rather than the one that happened to be
 * built first.
 */
export const REGION_SHOWCASE: Record<BodyRegion, RegionShowcaseStatus> = {
  shoulder: {
    region: 'shoulder',
    state: 'active',
    // Not reviewed yet. The content pack, the interview, the mobile experience and
    // the summary are all still outstanding, and a record that says otherwise is a
    // record the acceptance gate cannot catch.
    reviewed: false,
    note: 'Being worked through for this showcase. Not finished yet.',
    stillWorks: [],
  },
  neck: {
    region: 'neck',
    state: 'frozen',
    reviewed: false,
    /*
      States the platform path and stops there.

      The previous note said neck's "anatomy pack and interview wording are
      complete". Nothing has reviewed that, and the region is frozen precisely
      because it has not been through the review that would establish it. Claiming
      completeness for the one thing that is untested is how a frozen region quietly
      reads as a finished one.
    */
    note:
      'Neck works through the same platform, but it has not been through the ' +
      'showcase review. Treat its anatomy and wording as unverified.',
    stillWorks: [
      'Describe a symptom and get a grounded localisation',
      'Answer the neck interview and save an episode',
      'See it in history and produce a pre-visit summary',
    ],
  },
  lower_back: {
    region: 'lower_back',
    state: 'frozen',
    reviewed: false,
    note:
      'Lower back works through the same platform, but it has not been through ' +
      'the showcase review. Treat its anatomy and wording as unverified.',
    stillWorks: [
      'Describe a symptom and get a grounded localisation',
      'Answer the lower-back interview and save an episode',
      'See it in history and produce a pre-visit summary',
    ],
  },
  knee: {
    region: 'knee',
    state: 'frozen',
    reviewed: false,
    note:
      'Knee works through the same platform, but it has not been through the ' +
      'showcase review. Treat its anatomy and wording as unverified.',
    stillWorks: [
      'Describe a symptom and get a grounded localisation',
      'Answer the knee interview and save an episode',
      'See it in history and produce a pre-visit summary',
    ],
  },
};

/**
 * The region this build is being worked on.
 *
 * NOT "the showcase region", in the sense of "the finished one". The distinction
 * is the whole point of the module.
 */
export function isActiveShowcaseRegion(region: BodyRegion): boolean {
  return REGION_SHOWCASE[region].state === 'active';
}

/**
 * Whether a region has completed the showcase review.
 *
 * False for every region today, and that is the correct answer rather than a
 * placeholder: no region has been reviewed end to end. It exists so that flipping
 * it is a deliberate, visible act in one place instead of a wording change
 * scattered across a note string.
 */
export function regionIsReviewed(region: BodyRegion): boolean {
  return REGION_SHOWCASE[region].reviewed;
}

/**
 * How many regions are actually reviewed.
 *
 * The unreviewed count is reported honestly rather than left implicit: a
 * "polished" claim is exactly what a summary of this module is most likely to
 * imply, so the number is available to be checked.
 */
export function reviewedRegionCount(): number {
  return Object.values(REGION_SHOWCASE).filter((s) => s.reviewed).length;
}

export function showcaseNote(region: BodyRegion): string {
  return REGION_SHOWCASE[region].note;
}

/**
 * The regions this build is being worked on.
 *
 * Used by the demo entry point to say what this is. Deliberately derived from
 * `state`, so it follows the investment decision and cannot drift into "the
 * finished regions" by anyone renaming a field.
 */
export const SHOWCASE_REGIONS: readonly BodyRegion[] = Object.values(REGION_SHOWCASE)
  .filter((s) => s.state === 'active')
  .map((s) => s.region);

/* ------------------------------------------------------------------ */
/* Medical safety position. Stated once, read everywhere.               */
/* ------------------------------------------------------------------ */

/**
 * WHAT THIS PRODUCT IS, in words the interface can quote verbatim.
 *
 * Showcase V1 is pre-clinical symptom localisation and structured recording for
 * pre-visit communication. It is NOT diagnosis, NOT medical advice, NOT treatment
 * recommendation, and NOT certified for emergency triage.
 *
 * `clinicalReview: 'incomplete'` and `releaseReady: false` are not display
 * strings that a redesign could soften. They are the current true state of the
 * safety rules, and `scripts/check-safety-metadata.mjs` asserts the count
 * honestly, so nothing in this effort may make them look better than they are.
 */
export const MEDICAL_POSITION = {
  is: [
    'pre-clinical symptom localisation',
    'structured symptom recording',
    'pre-visit communication',
  ],
  isNot: [
    'a diagnosis',
    'medical advice',
    'a treatment recommendation',
    'certified for emergency triage',
  ],
  clinicalReview: 'incomplete',
  releaseReady: false,
  /**
   * Phrased so it can be shown without embarrassment. The product may be
   * demonstrated publicly with synthetic data; what it may not be is represented
   * as a clinically approved medical product.
   */
  demoStatement:
    'This is a demonstration build using synthetic data. The safety rules it applies have not ' +
    'been reviewed by a clinician, so it is not a clinically approved medical product.',
  /**
   * What the product will not do, stated as capability rather than apology.
   * "It does not diagnose" is a stronger and more useful sentence than "it is not
   * a medical device".
   */
  limits: [
    'It does not diagnose, and nothing it shows is a finding.',
    'Indicating a structure says where you mean. It never says what is involved.',
    'A suggested structure is a candidate, never a conclusion.',
    '"Not answered" is not "no", and "not shown in this model" is not "not there".',
    'It cannot judge urgency. If you are worried, contact a clinician.',
  ],
} as const;