import { test } from 'node:test';
import assert from 'node:assert/strict';
import { evaluateSafety, releaseReady, unreviewedRuleIds, totalRuleCount } from '../src/rules/redflags.ts';
import { buildAnswer, putAnswer } from '../src/answers.ts';
import type { AnswerMap } from '../src/answers.ts';
import { emptyRecord } from '../src/symptom.ts';

const ans = (q: string, s: 'yes' | 'no' | 'unknown') =>
  buildAnswer({ questionId: q, raw: s, triState: s, provenance: { capturedAt: '2026-01-01T00:00:00.000Z', createdBy: 'user' } });

const answersOf = (...pairs: [string, 'yes' | 'no' | 'unknown'][]): AnswerMap =>
  pairs.reduce<Record<string, ReturnType<typeof ans>>>((acc, [q, s]) => putAnswer(acc, ans(q, s)), {}) as AnswerMap;

const rec = () => emptyRecord('lower_back');

test('the rule set is not empty — a zero-rule build would look safe', () => {
  assert.ok(totalRuleCount() >= 8, `only ${totalRuleCount()} rules defined`);
  assert.ok(unreviewedRuleIds().length > 0, 'prototype rules must be honestly marked unreviewed');
});

test('the development profile surfaces unreviewed rules with their status attached', () => {
  const result = evaluateSafety(rec(), {
    answers: answersOf(['lower_back.bladder', 'yes']),
    region: 'lower_back',
    profile: 'development',
  });
  const flag = result.flags.find((f) => f.ruleId === 'msk.cauda_equina');
  assert.ok(flag, 'development must show unreviewed rules rather than hide them');
  assert.equal(flag.reviewStatus, 'unreviewed');
  assert.equal(result.withheld.length, 0);
  assert.equal(result.blocked, false);
  assert.equal(result.profile, 'development');
});

test('ISSUE 8: the release profile withholds an unreviewed rule instead of showing it', () => {
  const result = evaluateSafety(rec(), {
    answers: answersOf(['lower_back.bladder', 'yes']),
    region: 'lower_back',
    profile: 'release',
  });
  // The rule fired, so it must not simply vanish.
  assert.equal(result.flags.length, 0, 'an unreviewed rule must not be user-facing in the release profile');
  assert.equal(result.withheld.length, 1);
  assert.equal(result.withheld[0]?.ruleId, 'msk.cauda_equina');
  assert.match(String(result.withheld[0]?.reason), /not completed clinical review/);
});

test('ISSUE 8: withholding a time-critical rule blocks the record rather than hiding it', () => {
  const result = evaluateSafety(rec(), {
    answers: answersOf(['lower_back.bladder', 'yes']),
    region: 'lower_back',
    profile: 'release',
  });
  assert.equal(result.blocked, true, 'a withheld emergency rule must block, not disappear');
});

test('releaseReady is false while time-critical rules are unreviewed', () => {
  const g = releaseReady();
  assert.equal(g.ready, false, 'this build is not release ready and must say so');
  assert.ok(g.blocking.length > 0, 'the blocking rules must be named, not just counted');
  assert.ok(g.blocking.includes('msk.cauda_equina'));
});

test('the evaluation always reports the signals it used, for audit', () => {
  const result = evaluateSafety(rec(), {
    answers: answersOf(['lower_back.bladder', 'no']),
    region: 'lower_back',
  });
  assert.equal(result.signals.bladder_or_bowel_change, 'no');
  assert.equal(result.signals.saddle_numbness, 'not_asked');
});
