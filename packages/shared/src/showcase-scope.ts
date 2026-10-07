import type { BodyRegion } from './anatomy.ts';

/**
 * SHOWCASE SCOPE, STATED ONCE.
 *
 * Right Shoulder Showcase V1 is one complete, polished region. Every other
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
 * regions are polished, which are frozen, and WHY is auditable in one place, and
 * the interface renders from it rather than each screen deciding for itself.
 *
 * The three states are deliberately distinct:
 *
 *   showcase   complete and polished; the showcase is built on this
 *   frozen     the platform supports it and nothing is broken, but it is not
 *              finished and the interface says so
 *   future     present in the vocabulary, not built yet
 *
 * Collapsing "frozen" into either of the others is the failure mode. Frozen
 * regions work; they are just not finished, and saying so is not the same as
 * hiding them.
 */

export type RegionShowcaseState = 'showcase' | 'frozen' | 'future';

export interface RegionShowcaseStatus {
  readonly region: BodyRegion;
  readonly state: RegionShowcaseState;
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
    state: 'showcase',
    note: 'Fully worked through in this showcase.',
    stillWorks: [],
  },
  neck: {
    region: 'neck',
    state: 'frozen',
    note:
      'Neck is built and working, but it has not been through the showcase review. ' +
      'Its anatomy pack and interview wording are complete; its visual and language ' +
      'quality is not yet at shoulder level.',
    stillWorks: [
      'Describe a symptom and get a grounded localisation',
      'Answer the neck interview and save an episode',
      'See it in history and produce a pre-visit summary',
    ],
  },
  lower_back: {
    region: 'lower_back',
    state: 'frozen',
    note:
      'Lower back is built and working, but it has not been through the showcase ' +
      'review. Same position as neck.',
    stillWorks: [
      'Describe a symptom and get a grounded localisation',
      'Answer the lower-back interview and save an episode',
      'See it in history and produce a pre-visit summary',
    ],
  },
  knee: {
    region: 'knee',
    state: 'frozen',
    note:
      'Knee is built and working, but it has not been through the showcase review. ' +
      'Same position as neck.',
    stillWorks: [
      'Describe a symptom and get a grounded localisation',
      'Answer the knee interview and save an episode',
      'See it in history and produce a pre-visit summary',
    ],
  },
};

export function isShowcaseRegion(region: BodyRegion): boolean {
  return REGION_SHOWCASE[region].state === 'showcase';
}

export function showcaseNote(region: BodyRegion): string {
  return REGION_SHOWCASE[region].note;
}

/**
 * The regions a showcase build actually covers.
 *
 * Used by the demo entry point to say what this is, and by the content gate to
 * refuse a demo case for a region that has not been worked through.
 */
export const SHOWCASE_REGIONS: readonly BodyRegion[] = Object.values(REGION_SHOWCASE)
  .filter((s) => s.state === 'showcase')
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