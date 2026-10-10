import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  REGION_SHOWCASE,
  SHOWCASE_REGIONS,
  MEDICAL_POSITION,
  isActiveShowcaseRegion,
  regionIsReviewed,
  reviewedRegionCount,
  showcaseNote,
} from '../src/showcase-scope.ts';
import type { BodyRegion } from '../src/anatomy.ts';

const ALL_REGIONS = Object.keys(REGION_SHOWCASE) as BodyRegion[];

/**
 * Whether a sentence claims a completion state.
 *
 * Words are not enough: "Not finished yet" contains "finished" and is the most
 * honest thing a note can say, so a plain word-ban fails the wording that does the
 * job. What is banned is the word standing on its own -- so a negator earlier in
 * the same clause excuses it.
 *
 * Deliberately imperfect: a negator three clauses away would excuse a real claim.
 * That is the acceptable direction to fail in, because the alternative -- banning
 * "finished" outright -- pushes the author to write something vaguer than the
 * truth.
 */
const COMPLETION_WORDS = /\b(complete|completed|fully|polished|finished|production[- ]ready|reviewed)\b/gi;
const NEGATOR = /\b(not|no|never|without|isn't|hasn't|have not|has not|yet to be)\b/i;

function claimsCompletion(text: string): boolean {
  COMPLETION_WORDS.lastIndex = 0;
  for (let m = COMPLETION_WORDS.exec(text); m !== null; m = COMPLETION_WORDS.exec(text)) {
    const before = text.slice(0, m.index);
    const clauseStart = Math.max(before.lastIndexOf('. '), before.lastIndexOf('; '), -1);
    if (!NEGATOR.test(before.slice(clauseStart + 1))) return true;
  }
  return false;
}

/*
  These tests exist because the module's first version was not caught by anything.

  It had `state: 'showcase'` on the shoulder and a note reading "Fully worked
  through in this showcase", and the frozen notes asserted that neck's "anatomy
  pack and interview wording are complete". No test read this file, so those were
  statements of completion about work that was, and is, in progress. A wording
  change is cheap to make and expensive to notice, which is the wrong way round for
  the one file whose job is to be the honest answer.
*/

test('every region is declared, so none can be quietly unmentioned', () => {
  for (const region of ALL_REGIONS) {
    assert.ok(REGION_SHOWCASE[region], `${region} has no showcase status`);
    assert.equal(REGION_SHOWCASE[region].region, region, `${region} disagrees about which region it is`);
  }
});

test('a note never claims a region is complete, finished or polished', () => {
  // The specific failure this file had. "Complete" is the word that turns a target
  // into a claim, and it is banned in every note regardless of state -- including
  // the frozen ones, which is where it actually leaked.
  for (const region of ALL_REGIONS) {
    const note = showcaseNote(region);
    assert.ok(
      !claimsCompletion(note),
      `${region} note claims a completion state: "${note}"`,
    );
  }
});

test('the completion-word check is not vacuous -- it still catches a claim', () => {
  /*
    A guard against the guard.

    The check above is a negation-aware word scan, which is the shape most likely to
    quietly become a no-op: someone softens the negator, or the clause split moves,
    and it stops catching anything while still reporting green. So it is asserted
    against the exact sentence the file used to contain, and against the negation
    that has to stay allowed.
  */
  assert.ok(claimsCompletion('Fully worked through in this showcase.'));
  assert.ok(claimsCompletion('Its anatomy pack and interview wording are complete.'));
  assert.ok(!claimsCompletion('Being worked through for this showcase. Not finished yet.'));
  assert.ok(!claimsCompletion('Treat its anatomy and wording as unverified.'));
});

test('a frozen region says what still works, so the note is not only a refusal', () => {
  for (const region of ALL_REGIONS) {
    const status = REGION_SHOWCASE[region];
    if (status.state !== 'frozen') continue;
    assert.ok(
      status.stillWorks.length > 0,
      `${region} is frozen but lists nothing that still works, which reads as removal`,
    );
    for (const line of status.stillWorks) {
      assert.ok(!claimsCompletion(line), `${region} stillWorks claims completion: "${line}"`);
    }
  }
});

test('an active region is not reported as reviewed', () => {
  /*
    The distinction the rename exists to protect: `active` is where the effort is
    going, `reviewed` is whether it arrived. If these two are the same fact then
    the state name is doing the assertion, which is how "showcase" came to read as
    a certification. Asserted separately so the flag cannot be inferred from the
    state.
  */
  for (const region of ALL_REGIONS) {
    if (REGION_SHOWCASE[region].state !== 'active') continue;
    assert.equal(
      regionIsReviewed(region),
      false,
      `${region} is marked reviewed; the showcase review has not been completed for any region`,
    );
  }
});

test('the reviewed count is honest: no region claims the review', () => {
  // This is the number a summary is most likely to quote. If it went to 1 without
  // the review having happened, the whole file would be lying in the one place
  // that is checked.
  assert.equal(reviewedRegionCount(), 0);
});

test('exactly one region is being worked on, and it is the shoulder', () => {
  assert.deepEqual([...SHOWCASE_REGIONS], ['shoulder']);
  assert.ok(isActiveShowcaseRegion('shoulder'));
  for (const region of ALL_REGIONS) {
    if (region === 'shoulder') continue;
    assert.equal(isActiveShowcaseRegion(region), false, `${region} claims active investment`);
  }
});

test('a future region is neither active nor claimed to work', () => {
  for (const region of ALL_REGIONS) {
    const status = REGION_SHOWCASE[region];
    if (status.state !== 'future') continue;
    assert.equal(status.stillWorks.length, 0, `${region} is future but lists what works`);
    assert.equal(regionIsReviewed(region), false);
  }
});

test('the medical position states both what this is and what it is not', () => {
  assert.ok(MEDICAL_POSITION.is.length > 0);
  assert.ok(MEDICAL_POSITION.isNot.length > 0);
  // The four refusals are the ones a redesign is most tempted to soften.
  const notText = MEDICAL_POSITION.isNot.join(' ').toLowerCase();
  for (const refusal of ['diagnosis', 'advice', 'treatment', 'emergency triage']) {
    assert.ok(notText.includes(refusal), `the position no longer refuses ${refusal}`);
  }
});

test('the safety position is reported unreviewed, and the gate would notice', () => {
  // `clinicalReview` and `releaseReady` are not display strings a redesign can
  // soften. If either is flipped, this fails rather than shipping a build that
  // looks clinically approved.
  assert.equal(MEDICAL_POSITION.clinicalReview, 'incomplete');
  assert.equal(MEDICAL_POSITION.releaseReady, false);
});
