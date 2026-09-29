import { test } from 'node:test';
import assert from 'node:assert/strict';
import { emptyRecord } from '../src/symptom.ts';
import type { SymptomRecord } from '../src/symptom.ts';
import { evaluateRedFlags, highestSeverity, unreviewedRuleCount } from '../src/rules/redflags.ts';

const rec = (patch: (r: SymptomRecord) => void): SymptomRecord => {
  const r = emptyRecord('lower_back');
  patch(r);
  return r;
};

test('a clean mechanical episode raises no emergency flag', () => {
  const r = rec((x) => {
    x.quality = ['aching'];
    x.triggers = ['lifting'];
    x.temporal = { ...x.temporal, frequency: 'intermittent', onset: 'after_activity', trend: 'stable' };
  });
  const flags = evaluateRedFlags(r);
  assert.equal(highestSeverity(flags), null, `unexpected flags: ${JSON.stringify(flags)}`);
});

test('cauda equina features raise an emergency flag', () => {
  const r = rec((x) => {
    x.radiation = ['saddle area numbness'];
    x.quality = ['numbness'];
    x.function.activitiesAffected = ['difficulty urinating', 'new bladder problems'];
  });
  const flags = evaluateRedFlags(r);
  assert.equal(highestSeverity(flags), 'emergency');
  assert.ok(flags.some((f) => f.ruleId === 'msk.cauda_equina'));
});

test('a rule match never asserts a diagnosis at the user', () => {
  // A red flag means "get this assessed", never "you have condition X".
  const FORBIDDEN = [
    /you have (cauda|septic|disc|torn|fracture|infection|syndrome)/i,
    /you are suffering from/i,
    /you probably have/i,
    /most likely you/i,
    /the diagnosis is/i,
    /you have been diagnosed/i,
  ];
  const r = rec((x) => {
    x.quality = ['numbness'];
    x.function.activitiesAffected = ['bladder problems'];
  });
  const flags = evaluateRedFlags(r);
  assert.ok(flags.length > 0);
  for (const f of flags) {
    for (const banned of FORBIDDEN) {
      assert.doesNotMatch(f.userMessage, banned, `rule ${f.ruleId} used banned phrasing`);
    }
    assert.ok(f.actionSteps.length > 0, 'every safety flag must tell the user what to do');
  }
});

test('hot swollen joint with fever is urgent, not merely info', () => {
  const r = rec((x) => {
    x.location.region = 'knee';
    x.quality = ['swelling'];
    x.context.systemicSymptoms = ['fever'];
    x.temporal = { ...x.temporal, durationValue: 2, durationUnit: 'days' };
  });
  const sev = highestSeverity(evaluateRedFlags(r));
  assert.ok(sev === 'urgent' || sev === 'emergency', `got ${sev}`);
});

test('every red-flag rule is honestly marked unreviewed until a clinician signs off', () => {
  assert.ok(unreviewedRuleCount() > 0);
  const r = rec((x) => {
    x.radiation = ['saddle area numbness'];
    x.quality = ['numbness'];
    x.function.activitiesAffected = ['bladder problems'];
  });
  const reviewedOnly = evaluateRedFlags(r, { requireReviewed: true });
  assert.equal(reviewedOnly.length, 0, 'unreviewed rules must be suppressible for release gating');
});

test('a throwing predicate cannot take down evaluation', () => {
  const r = rec((x) => {
    x.function.activitiesAffected = ['bladder problems'];
  });
  assert.doesNotThrow(() => evaluateRedFlags(r));
});
