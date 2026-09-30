import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  assertProvenance,
  attributed,
  authorityFor,
  ClaimClassSchema,
  evidenceStatusFor,
  isAuthoritativeFor,
  mergeField,
} from '../src/provenance.ts';

const at = (source: Parameters<typeof attributed>[1]) => attributed('x', source);

const user = (over: Partial<Parameters<typeof attributed>[1]> = {}) =>
  attributed('user-value', {
    sourceType: 'user_statement',
    verificationStatus: 'user_confirmed',
    createdBy: 'user',
    capturedAt: '2026-01-01T00:00:00.000Z',
    ...over,
  });

const device = (over: Partial<Parameters<typeof attributed>[1]> = {}) =>
  attributed('device-value', {
    sourceType: 'device_import',
    verificationStatus: 'unverified',
    createdBy: 'fitbit',
    capturedAt: '2026-01-02T00:00:00.000Z',
    ...over,
  });

const ai = (over: Partial<Parameters<typeof attributed>[1]> = {}) =>
  attributed('ai-value', {
    sourceType: 'ai_inference',
    verificationStatus: 'unverified',
    createdBy: 'model',
    confidence: 0.7,
    capturedAt: '2026-01-03T00:00:00.000Z',
    ...over,
  });

const clinician = (over: Partial<Parameters<typeof attributed>[1]> = {}) =>
  attributed('clinician-value', {
    sourceType: 'clinician_confirmed',
    verificationStatus: 'clinician_confirmed',
    createdBy: 'dr-x',
    capturedAt: '2026-01-04T00:00:00.000Z',
    ...over,
  });

/* ---------------- axis 1: provenance invariants ---------------- */

test('ai_inference can never be marked user_confirmed', () => {
  assert.throws(
    () =>
      assertProvenance('quality', {
        sourceType: 'ai_inference',
        verificationStatus: 'user_confirmed',
        createdBy: 'model',
        capturedAt: new Date().toISOString(),
        confidence: 0.9,
      }),
    /cannot carry/,
  );
});

test('ai_inference requires an explicit confidence', () => {
  assert.throws(
    () =>
      assertProvenance('quality', {
        sourceType: 'ai_inference',
        verificationStatus: 'unverified',
        createdBy: 'model',
        capturedAt: new Date().toISOString(),
      }),
    /requires an explicit confidence/,
  );
});

test('an unknown sourceType is a hard error', () => {
  assert.throws(
    () =>
      assertProvenance('quality', {
        sourceType: 'psychic' as never,
        verificationStatus: 'unverified',
        createdBy: 'x',
        capturedAt: new Date().toISOString(),
      }),
    /unknown sourceType/,
  );
});

/* ---------------- axis 2: evidence status invariants ---------------- */

test('every source type has a defined evidence status', () => {
  for (const s of ['ai_inference', 'system_rule', 'user_selection', 'user_statement', 'user_edited', 'device_import', 'external_record', 'clinician_confirmed'] as const) {
    assert.doesNotThrow(() => evidenceStatusFor(s), `${s} has no evidence status`);
  }
});

test('a model can only ever produce an ai_candidate', () => {
  assert.equal(evidenceStatusFor('ai_inference'), 'ai_candidate');
  assert.throws(
    () =>
      assertProvenance('q', {
        sourceType: 'ai_inference',
        verificationStatus: 'unverified',
        createdBy: 'model',
        confidence: 0.5,
        capturedAt: new Date().toISOString(),
        evidenceStatus: 'user_report',
      }),
    /cannot carry evidenceStatus/,
  );
});

test('only a clinician or an external record may be a clinician_finding', () => {
  assert.throws(
    () =>
      assertProvenance('q', {
        sourceType: 'user_statement',
        verificationStatus: 'unverified',
        createdBy: 'user',
        capturedAt: new Date().toISOString(),
        evidenceStatus: 'clinician_finding',
      }),
    /cannot carry evidenceStatus|only a clinician or an external record/,
  );
  assert.doesNotThrow(() =>
    assertProvenance('q', {
      sourceType: 'clinician_confirmed',
      verificationStatus: 'clinician_confirmed',
      createdBy: 'dr-x',
      capturedAt: new Date().toISOString(),
      evidenceStatus: 'clinician_finding',
    }),
  );
});

test('a user_selection is a visual selection, never a finding', () => {
  assert.equal(evidenceStatusFor('user_selection'), 'visual_selection');
  const p = user({ sourceType: 'user_selection', verificationStatus: 'user_confirmed' });
  assert.equal(p.provenance.evidenceStatus, 'visual_selection');
});

/* ---------------- axis 3: per-claim-class merge ---------------- */

test('claim classes are all declared', () => {
  for (const c of ['symptom_subjective', 'location_anatomical', 'measurement', 'clinical_conclusion', 'derived'] as const) {
    assert.doesNotThrow(() => ClaimClassSchema.parse(c));
  }
});

test('ISSUE 6: a device reading cannot overwrite a subjective symptom report', () => {
  const outcome = mergeField(user(), device(), 'symptom_subjective');
  assert.equal(outcome.winner?.value, 'user-value');
  assert.equal(outcome.applied, false);
  // The device value is preserved, not discarded.
  assert.equal(outcome.preserved.length, 1);
  assert.equal(outcome.preserved[0]?.value, 'device-value');
  assert.match(String(outcome.reason), /cannot assert a "symptom_subjective" value/);
});

test('a lab report cannot overwrite a subjective symptom report either', () => {
  const lab = attributed('lab-value', {
    sourceType: 'external_record',
    verificationStatus: 'clinician_confirmed',
    createdBy: 'lab',
    capturedAt: '2026-02-01T00:00:00.000Z',
  });
  const outcome = mergeField(user(), lab, 'symptom_subjective');
  assert.equal(outcome.winner?.value, 'user-value');
  assert.equal(outcome.preserved[0]?.value, 'lab-value');
});

test('a device reading DOES win a measurement field', () => {
  const outcome = mergeField(user(), device(), 'measurement');
  assert.equal(outcome.winner?.value, 'device-value');
  assert.equal(outcome.applied, true);
  assert.equal(outcome.preserved[0]?.value, 'user-value');
});

test('a clinician wins a clinical conclusion but not a subjective symptom', () => {
  assert.equal(mergeField(user(), clinician(), 'clinical_conclusion').winner?.value, 'clinician-value');
  assert.equal(mergeField(user(), clinician(), 'symptom_subjective').winner?.value, 'clinician-value');
});

test('the user outranks the model on both subjective and location fields', () => {
  assert.equal(mergeField(user(), ai(), 'symptom_subjective').winner?.value, 'user-value');
  assert.equal(mergeField(user(), ai(), 'location_anatomical').winner?.value, 'user-value');
});

test('an AI candidate never becomes the winner over anything user-sourced', () => {
  const out = mergeField(ai(), user(), 'location_anatomical');
  assert.equal(out.winner?.value, 'user-value');
  assert.equal(out.preserved[0]?.value, 'ai-value');
});

test('a user edit outranks the earlier user statement', () => {
  const edited = attributed('user-value', {
    sourceType: 'user_edited',
    verificationStatus: 'user_confirmed',
    createdBy: 'user',
    capturedAt: '2026-01-05T00:00:00.000Z',
  });
  assert.equal(mergeField(user(), edited, 'symptom_subjective').winner?.value, 'user-value');
  assert.equal(mergeField(user(), edited, 'symptom_subjective').applied, true);
});

test('an empty store accepts the first value', () => {
  const out = mergeField(null, user(), 'symptom_subjective');
  assert.equal(out.winner?.value, 'user-value');
  assert.equal(out.applied, true);
});

test('authority is class specific, not a single global ladder', () => {
  // The point of issue 6: the SAME source ranks differently by claim class.
  assert.equal(authorityFor('symptom_subjective', 'device_import'), null);
  assert.equal(authorityFor('measurement', 'device_import'), 80);
  assert.equal(authorityFor('symptom_subjective', 'user_statement'), 60);
  assert.equal(isAuthoritativeFor('measurement', 'ai_inference'), true);
  assert.equal(isAuthoritativeFor('symptom_subjective', 'external_record'), false);
});

test('a same-value merge with an older timestamp is not applied', () => {
  const older = user({ capturedAt: '2025-01-01T00:00:00.000Z' });
  const out = mergeField(user(), older, 'symptom_subjective');
  assert.equal(out.applied, false);
  assert.match(String(out.reason), /same authority/);
});

test('evidenceStatus defaults to the only legal value for the source', () => {
  assert.equal(at({ sourceType: 'user_selection', verificationStatus: 'user_confirmed', createdBy: 'user' }).provenance.evidenceStatus, 'visual_selection');
});
