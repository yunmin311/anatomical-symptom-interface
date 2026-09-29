import { test } from 'node:test';
import assert from 'node:assert/strict';
import { assertProvenance, attributed, mergeAttributed, AUTHORITY_RANK } from '../src/provenance.ts';

const base = { createdBy: 'test' } as const;

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

test('user statements may be confirmed by the user', () => {
  const p = attributed('dull', {
    sourceType: 'user_statement',
    verificationStatus: 'user_confirmed',
    createdBy: 'user',
  });
  assert.doesNotThrow(() => assertProvenance('quality', p.provenance));
});

test('authority ordering puts the clinician above the user above the model', () => {
  assert.ok(AUTHORITY_RANK.clinician_confirmed > AUTHORITY_RANK.device_import);
  assert.ok(AUTHORITY_RANK.device_import > AUTHORITY_RANK.user_edited);
  assert.ok(AUTHORITY_RANK.user_edited > AUTHORITY_RANK.user_statement);
  assert.ok(AUTHORITY_RANK.user_statement > AUTHORITY_RANK.ai_inference);
});

test('merge keeps the higher-authority value and does not silently upgrade it', () => {
  const aiGuess = attributed('sharp', {
    sourceType: 'ai_inference',
    verificationStatus: 'unverified',
    createdBy: 'model',
    confidence: 0.8,
  });
  const userSays = attributed('burning', {
    sourceType: 'user_statement',
    verificationStatus: 'user_confirmed',
    createdBy: 'user',
  });
  const merged = mergeAttributed(aiGuess, userSays);
  assert.equal(merged?.value, 'burning');
  assert.equal(merged?.provenance.verificationStatus, 'user_confirmed');

  const clinician = attributed('sharp', {
    sourceType: 'clinician_confirmed',
    verificationStatus: 'clinician_confirmed',
    createdBy: 'dr-x',
  });
  assert.equal(mergeAttributed(userSays, clinician)?.value, 'sharp');
});
