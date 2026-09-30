import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  assertFieldWrite,
  DERIVED_FIELD_PATHS,
  FieldPolicyError,
  FIELD_POLICIES,
  getFieldPolicy,
  writablePaths,
} from '../src/field-policy.ts';
import type { Provenance } from '../src/provenance.ts';

const prov = (over: Partial<Provenance> = {}): Provenance => ({
  sourceType: 'user_statement',
  verificationStatus: 'user_confirmed',
  createdBy: 'user',
  capturedAt: '2026-01-01T00:00:00.000Z',
  ...over,
});

const aiProv = (over: Partial<Provenance> = {}): Provenance => ({
  sourceType: 'ai_inference',
  verificationStatus: 'unverified',
  createdBy: 'model',
  confidence: 0.7,
  capturedAt: '2026-01-01T00:00:00.000Z',
  ...over,
});

test('ISSUE 2: every writable field declares a claim class and a strategy', () => {
  for (const p of FIELD_POLICIES) {
    assert.ok(p.claimClass, `${p.path} has no claim class`);
    assert.ok(p.strategy, `${p.path} has no provenance strategy`);
    assert.ok(p.note.length > 10, `${p.path} has no meaningful note`);
    assert.ok(p.allowedSources.length > 0, `${p.path} allows no sources at all`);
  }
});

test('ISSUE 2: every field is either writable or explicitly documented as derived', () => {
  const writable = new Set(writablePaths());
  for (const [path, reason] of Object.entries(DERIVED_FIELD_PATHS)) {
    assert.ok(!writable.has(path), `${path} is both writable and documented as derived`);
    assert.ok(reason.length > 20, `${path} has no real explanation for being provenance-free`);
  }
  // gaps is the one field the client must never write, and it must be listed.
  assert.ok(Object.hasOwn(DERIVED_FIELD_PATHS, 'gaps'));
  assert.equal(getFieldPolicy('gaps'), undefined);
});

test('ISSUE 2: an unknown field path is rejected outright', () => {
  assert.throws(
    () => assertFieldWrite('location.notAField', 'x', prov()),
    FieldPolicyError,
  );
  assert.throws(
    () => assertFieldWrite('__proto__.polluted', true, prov()),
    FieldPolicyError,
  );
});

test('ISSUE 2: a model cannot write a user-grounded field', () => {
  assert.throws(
    () => assertFieldWrite('location.userSelectedStructureIds', ['asi:shoulder.deltoid'], aiProv()),
    /cannot be written by a model/,
  );
  assert.throws(
    () => assertFieldWrite('location.subRegionId', 'shoulder.anterior', aiProv()),
    /cannot be written by a model/,
  );
});

test('ISSUE 2: a model cannot write a subjective symptom field', () => {
  assert.throws(() => assertFieldWrite('quality', ['dull'], aiProv()), /cannot be written by a model/);
  assert.throws(() => assertFieldWrite('triggers', ['night'], aiProv()), /cannot be written by a model/);
});

test('ISSUE 2: a model CAN write a field that is not user-grounded', () => {
  assert.doesNotThrow(() => assertFieldWrite('consideredStructures', [], aiProv()));
});

test('ISSUE 2: a system rule cannot write a user statement field', () => {
  const rule = prov({ sourceType: 'system_rule', verificationStatus: 'unverified' });
  assert.throws(() => assertFieldWrite('quality', ['dull'], rule), /may not write this field/);
});

test('ISSUE 2: a client cannot write the store-derived relatedEpisodeIds', () => {
  const rule = prov({ sourceType: 'system_rule', verificationStatus: 'unverified' });
  // It IS writable, but only by a system rule, never by a user or a model.
  assert.doesNotThrow(() => assertFieldWrite('context.relatedEpisodeIds', ['ep1'], rule));
  assert.throws(() => assertFieldWrite('context.relatedEpisodeIds', ['ep1'], prov()), /may not write this field/);
  assert.throws(() => assertFieldWrite('context.relatedEpisodeIds', ['ep1'], aiProv()), /may not write this field/);
});

test('ISSUE 2: values are validated, not just the path', () => {
  assert.throws(() => assertFieldWrite('location.side', 'sideways', prov()), /value rejected/);
  assert.throws(() => assertFieldWrite('function.intensity', 99, prov()), /value rejected/);
  assert.throws(() => assertFieldWrite('quality', ['not_a_quality'], prov()), /value rejected/);
  // location.point is set by a map interaction, so the source must be a selection.
  const selection = prov({ sourceType: 'user_selection', verificationStatus: 'user_confirmed' });
  assert.throws(() => assertFieldWrite('location.point', { x: 5, y: 0.2 }, selection), /value rejected/);
  assert.doesNotThrow(() => assertFieldWrite('location.point', { x: 0.4, y: 0.6 }, selection));
  assert.doesNotThrow(() => assertFieldWrite('function.intensity', 7, prov()));
});

test('a user_statement cannot write a field that only a map interaction may write', () => {
  assert.throws(
    () => assertFieldWrite('location.point', { x: 0.4, y: 0.6 }, prov()),
    /may not write this field/,
  );
});

test('ISSUE 2: clinician_confirmed status cannot be faked by a non-clinician', () => {
  assert.throws(
    () => assertFieldWrite('quality', ['dull'], prov({ sourceType: 'user_statement', verificationStatus: 'clinician_confirmed' })),
    /cannot carry verificationStatus|cannot be written by a model|requires a clinician/,
  );
});

test('the previously bypassable /confirm targets are not writable at all', () => {
  // These are the paths the old provenance-only endpoint could stamp.
  assert.equal(getFieldPolicy('location.point.user_confirmed'), undefined);
  assert.equal(getFieldPolicy('record_json'), undefined);
  assert.equal(getFieldPolicy('gaps'), undefined);
});
