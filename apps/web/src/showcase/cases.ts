/**
 * Right Shoulder Showcase cases — SYNTHETIC demonstration material.
 *
 * ## WHAT THESE ARE, AND WHY THEY ARE DATA
 *
 * Each case is a scripted walk-through of a complaint that does not exist, written
 * so the Showcase can be run by somebody who has never seen the product: the words
 * to type, what to point at, and which answer to give at each question.
 *
 * They are data rather than a demo mode in the product because a showcase must not
 * be a second way of doing things. Every case runs through the same describe →
 * locate → interview → review → save → history path a real person takes, with the
 * same grounding, the same registry and the same single write path. A "demo mode"
 * that pre-filled answers would prove nothing about the product and would give the
 * showcase a second write path to keep in step with the first.
 *
 * ## WHAT THEY MAY NOT CONTAIN
 *
 * No condition names, no investigation results, no treatment advice, no advice of
 * any kind. Every answer here is something a person can observe about their own
 * body — what they felt, what they pointed at, what they were doing when it
 * started. `showcase-cases.test.ts` enforces the vocabulary, because the fastest way
 * to break that rule is to be helpful while writing an example.
 *
 * The scripts are validated against the live interview registry, so a question that
 * is renamed or re-optioned fails a test instead of quietly telling a demonstrator
 * to click something that no longer exists.
 */

export interface ShowcaseAnswer {
  /** A question id from the shoulder interview registry. */
  questionId: string;
  /** The option value(s), or the free text to type. */
  answer: string | string[];
  /** What the demonstrator does at this question, in one line. */
  how: string;
}

export interface ShowcaseCase {
  id: string;
  title: string;
  /** The single thing this case exists to show. */
  shows: string;
  /** The person's own words. Prefilled into the describe box. */
  utterance: string;
  /** Things to do at the body map that are not answering a question. */
  locate?: string[];
  steps: ShowcaseAnswer[];
  /** Order matters: run this case before the one it refers to. */
  after?: string[];
  notes?: string[];
}

export const SHOWCASE_CASES: ShowcaseCase[] = [
  {
    id: 'action',
    title: 'Pain that comes on with a movement',
    shows:
      'The whole path from words to a saved record, on a complaint with nothing unusual about it.',
    utterance: 'My right shoulder hurts deep inside when I raise my arm.',
    locate: [
      'Point at the sore spot on the right shoulder. Your words already said right and deep inside.',
      'Tap a structure on the anatomy map, then tap it again to withdraw it. Withdrawing keeps the suggestion — the record still shows it was considered.',
    ],
    steps: [
      {
        questionId: 'shoulder.injury_context',
        answer: 'activity',
        how: 'After physical activity.',
      },
      {
        questionId: 'shoulder.night_pain',
        answer: 'no',
        how: 'No. A definite "no" is not the same answer as "I am not sure".',
      },
      {
        questionId: 'shoulder.elevation',
        answer: 'It starts once my arm passes about shoulder height, and eases when I lower it again.',
        how: 'Type where it starts, in your own words.',
      },
      {
        questionId: 'shoulder.weakness',
        answer: ['pain_only'],
        how: 'Just pain, strength feels normal. It is exclusive: picking it clears any weakness you had selected.',
      },
      {
        questionId: 'shoulder.radiation',
        answer: 'none',
        how: 'No, it stays in the shoulder.',
      },
      {
        questionId: 'shoulder.tenderness',
        answer: 'mild',
        how: 'A bit tender.',
      },
      {
        questionId: 'shoulder.trauma_urgent',
        answer: 'no',
        how: 'No deformity and no inability to lift at all. This question feeds the safety review and writes nothing to the record itself.',
      },
      {
        questionId: 'shoulder.vascular',
        answer: 'no',
        how: 'No — the hand is not cold, pale or numb. Another safety question that records no field.',
      },
    ],
    notes: [
      'Save the record, then open your health map: this episode is now a place you have pointed at.',
    ],
  },
  {
    id: 'injury',
    title: 'Something you could name',
    shows:
      'A mechanism that is not "nothing in particular", a safety question asked on its own terms, and a correction that actually changes the record.',
    utterance: 'I fell onto my right shoulder playing football yesterday and it hurts to lift my arm.',
    steps: [
      {
        questionId: 'shoulder.injury_context',
        answer: 'injury',
        how: 'An injury or fall. This is the mechanism the record keeps.',
      },
      {
        questionId: 'shoulder.night_pain',
        answer: 'yes',
        how: 'Yes — it wakes me. This adds a night trigger.',
      },
      {
        questionId: 'shoulder.elevation',
        answer: 'Reaching across to the other side and lifting my bag are the worst.',
        how: 'Type the movements, and where each one starts.',
      },
      {
        questionId: 'shoulder.weakness',
        answer: ['weak_above_head'],
        how: 'Weak reaching overhead. Select only what applies — weakness and "just pain" are opposites, and mixing them records nothing at all.',
      },
      { questionId: 'shoulder.radiation', answer: 'none', how: 'It stays in the shoulder.' },
      { questionId: 'shoulder.tenderness', answer: 'moderate', how: 'Quite tender.' },
      {
        questionId: 'shoulder.trauma_urgent',
        answer: 'no',
        how: 'No deformity, and not unable to lift at all. Answer what is true here, not what the last case said.',
      },
      { questionId: 'shoulder.vascular', answer: 'no', how: 'The hand is normal.' },
    ],
    notes: [
      'On the review screen, change "Does it wake you from sleep" to No. The night trigger leaves the record it was written to — a correction withdraws what the original answer recorded, rather than sitting beside it.',
      'The review screen labels that row as changed.',
    ],
  },
  {
    id: 'uncertainty',
    title: 'Not knowing, said out loud',
    shows:
      '"I am not sure" is an answer in its own right: recorded, never a negative, and never a guess.',
    utterance: 'Something is not right in my right shoulder but I honestly cannot pin it down.',
    steps: [
      {
        questionId: 'shoulder.injury_context',
        answer: 'unknown',
        how: 'I am not sure. The answer is kept; no mechanism is written, because not recalling one is not "nothing in particular".',
      },
      {
        questionId: 'shoulder.night_pain',
        answer: 'unknown',
        how: 'I am not sure. No night trigger is added, and none is removed.',
      },
      {
        questionId: 'shoulder.elevation',
        answer: 'unsure',
        how: 'Use the "I am not sure" button under the box. Typing "I do not know" would otherwise be stored as a movement description.',
      },
      {
        questionId: 'shoulder.weakness',
        answer: ['unknown'],
        how: 'I am not sure. Exclusive, like "just pain": it cannot be combined with a weakness.',
      },
      {
        questionId: 'shoulder.radiation',
        answer: 'unsure',
        how: 'I am not sure. Unsure is not a direction, so nothing is recorded as radiation.',
      },
      {
        questionId: 'shoulder.tenderness',
        answer: 'unknown',
        how: 'I am not sure. Contrast it with "I have not tried", which is a real observation and is recorded as one.',
      },
      {
        questionId: 'shoulder.trauma_urgent',
        answer: 'no',
        how: 'No — where a safety question can be answered, it is answered. Uncertainty is not a reason to leave it blank.',
      },
      {
        questionId: 'shoulder.vascular',
        answer: 'unknown',
        how: 'I am not sure.',
      },
    ],
    notes: [
      'On review, these read as "Not established" and stay on the outstanding list. In the summary they are never printed as a negative, and a question that was never asked reads "Not asked" — a different thing again.',
      'Save it and compare the two summaries side by side.',
    ],
  },
  {
    id: 'recurrence',
    title: 'The same place, later',
    shows:
      'Two episodes in one place, and reopening the first one without creating a second record.',
    utterance: 'It is the same right shoulder again, three weeks after last time.',
    after: ['action'],
    steps: [
      {
        questionId: 'shoulder.injury_context',
        answer: 'nothing',
        how: 'Nothing in particular — this time it started on its own.',
      },
      {
        questionId: 'shoulder.night_pain',
        answer: 'unknown',
        how: 'I am not sure this time. A stale answer from the earlier episode does not leak in.',
      },
      {
        questionId: 'shoulder.elevation',
        answer: 'Same as before, mostly reaching up to a shelf.',
        how: 'Type it.',
      },
      {
        questionId: 'shoulder.weakness',
        answer: ['pain_only'],
        how: 'Just pain.',
      },
      {
        questionId: 'shoulder.radiation',
        answer: 'none',
        how: 'Stays in the shoulder.',
      },
      {
        questionId: 'shoulder.tenderness',
        answer: 'not_tested',
        how: 'I have not tried. That is an observation about what you did, and the record keeps it as one.',
      },
      { questionId: 'shoulder.trauma_urgent', answer: 'no', how: 'No.' },
      { questionId: 'shoulder.vascular', answer: 'no', how: 'No.' },
    ],
    notes: [
      'Point at the same spot. Save this one as well.',
      'Open your health map: one place, two episodes, each with its own date.',
      'Expand the earlier episode and choose "Continue this episode". You land back in its interview with a banner naming it, and what you add now is added to that same record rather than starting a third.',
    ],
  },
  {
    id: 'pointing',
    title: 'What pointing at does, and does not, mean',
    shows:
      'The difference between a structure you pointed at and a structure the tool suggested — and what happens when a view cannot load.',
    utterance: 'My right shoulder feels sore right where I can touch it.',
    locate: [
      'Point at the sore spot on the right shoulder.',
      'Tap a solid structure. It becomes an indication you pointed at, and you can withdraw it.',
      'Tap a lighter, outlined structure. It highlights but cannot be selected, and the app tells you why rather than ignoring the tap.',
      'Switch the viewer to the 3D view. Where it cannot load, the note under the viewer says so; it does not fail silently.',
    ],
    steps: [
      { questionId: 'shoulder.injury_context', answer: 'nothing', how: 'Nothing in particular.' },
      { questionId: 'shoulder.night_pain', answer: 'no', how: 'No.' },
      {
        questionId: 'shoulder.elevation',
        answer: 'Lifting my arm sideways, mostly.',
        how: 'Type the movement.',
      },
      { questionId: 'shoulder.weakness', answer: ['pain_only'], how: 'Just pain.' },
      { questionId: 'shoulder.radiation', answer: 'none', how: 'It stays put.' },
      { questionId: 'shoulder.tenderness', answer: 'mild', how: 'A bit tender.' },
      { questionId: 'shoulder.trauma_urgent', answer: 'no', how: 'No.' },
      { questionId: 'shoulder.vascular', answer: 'no', how: 'No.' },
    ],
    notes: [
      // Deliberately never uses the forbidden word, not even to deny it: this line
      // gets read aloud, and a demonstrator who hears it once will use it for the
      // rest of the session.
      'A structure you pointed at is an indication, not a finding, and the summary will not call it one. The words this product uses are "pointed at" and "indicated".',
      'The derived anatomy you tapped is a schematic for showing where something was indicated. It is not a clinically reviewed map of the shoulder.',
    ],
  },
];

/** The case a demonstrator starts from, and the one that needs a prior case first. */
export function caseById(id: string): ShowcaseCase | undefined {
  return SHOWCASE_CASES.find((c) => c.id === id);
}