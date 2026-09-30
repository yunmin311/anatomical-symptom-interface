import { test } from 'node:test';
import assert from 'node:assert/strict';
import { groundFromText, groundOrRefuse, detectOutOfScope } from '../src/grounding.ts';

test('grounds a plain English shoulder complaint', () => {
  const g = groundFromText('right shoulder hurts deep inside when I lift my arm');
  assert.ok(g);
  assert.equal(g.region, 'shoulder');
  assert.equal(g.side, 'right');
  assert.equal(g.depth, 'deep');
});

test('grounds Chinese input', () => {
  const g = groundFromText('左边的膝盖疼，上下楼的时候更明显');
  assert.ok(g);
  assert.equal(g.region, 'knee');
  assert.equal(g.side, 'left');
});

test('does not confuse lower back with shoulder', () => {
  const g = groundFromText('my lower back pain goes down my left leg');
  assert.ok(g);
  assert.equal(g.region, 'lower_back');
  assert.equal(g.side, 'left');
});

test('returns null for ungrounded text rather than guessing', () => {
  assert.equal(groundFromText('I feel a bit off today'), null);
  assert.equal(groundFromText(''), null);
});

test('midline words do not invent a side on a paired region', () => {
  const g = groundFromText('my shoulder aches');
  assert.ok(g);
  assert.equal(g.side, 'unknown');
});

test('surface hint terms become candidate structures, never selections', () => {
  const g = groundFromText('my shoulder has rotator cuff pain');
  assert.ok(g);
  const cuff = g.consideredStructures.find((s) => s.structureId === 'asi:shoulder.supraspinatus-tendon');
  assert.ok(cuff, 'expected the rotator cuff to map onto the supraspinatus tendon');
  assert.equal(cuff.selectedByUser, false, 'candidates must never be pre-selected');
  assert.ok(g.candidateStructureIds.length > 0, 'candidate ids must be exposed for the model prompt');
});

test('preserves the user verbatim', () => {
  const phrase = '右肩里面这里疼';
  const g = groundFromText(phrase);
  assert.equal(g?.userPhrase, phrase);
});

/* ================================================================== */
/* ISSUE 4: no silent default region                                  */
/* ================================================================== */

test('ISSUE 4: an ungrounded complaint is refused, not defaulted to shoulder', () => {
  const result = groundOrRefuse('I just feel a bit off today');
  assert.equal(result.ok, false);
  if (result.ok) throw new Error('expected a refusal');
  assert.equal(result.refusal.reason, 'ungrounded');
  assert.deepEqual(result.refusal.supportedRegions, ['shoulder', 'neck', 'lower_back', 'knee']);
});

test('ISSUE 4: empty input is refused', () => {
  const result = groundOrRefuse('   ');
  assert.equal(result.ok, false);
});

test('ISSUE 4: non-MSK body areas route out instead of into a shoulder interview', () => {
  for (const phrase of [
    'my chest feels tight',
    'I get short of breath going upstairs',
    'my stomach hurts badly',
    'I have a rash on my arm',
    'my vision has gone blurry',
    'I have a toothache',
    'I am pregnant and my back hurts', // mixed: still needs care, but must not auto-route
  ]) {
    const result = groundOrRefuse(phrase);
    assert.equal(result.ok, false, `"${phrase}" must not auto-localise`);
  }
});

test('ISSUE 4: out-of-scope is distinguished from merely ungrounded', () => {
  const chest = groundOrRefuse('my chest feels tight');
  assert.equal(chest.ok, false);
  if (chest.ok) throw new Error('expected refusal');
  assert.equal(chest.refusal.reason, 'out_of_scope');
  assert.deepEqual(chest.refusal.outOfScopeRegions, ['chest']);

  const vague = groundOrRefuse('I feel a bit off');
  assert.equal(vague.ok, false);
  if (vague.ok) throw new Error('expected refusal');
  assert.equal(vague.refusal.reason, 'ungrounded');
  assert.deepEqual(vague.refusal.outOfScopeRegions, []);
});

test('ISSUE 4: the router does NOT assert a diagnosis or a severity', () => {
  // The router may point at a clinician. It must not name a condition, not
  // estimate severity, and not imply that the user's problem is or is not serious.
  const FORBIDDEN = [
    /heart attack/i, /angina/i, /anxiety/i, /panic attack/i, /asthma/i, /reflux/i,
    /you (?:have|are suffering from|suffer from)\b/i,
    /diagnos/i, /most likely/i, /probably/i, /sounds like/i, /consistent with/i,
    /life.threatening/i, /dangerous/i, /serious(ly)? (?:condition|illness)/i,
    /seek emergency care (?:now|immediately)/i, /call (?:999|911|112)/i,
  ];
  for (const phrase of ['my chest feels tight', 'I feel a bit off today', 'I cannot breathe']) {
    const r = groundOrRefuse(phrase);
    if (r.ok) continue;
    const text = `${r.refusal.message} ${r.refusal.reason}`;
    for (const banned of FORBIDDEN) {
      assert.doesNotMatch(text, banned, `router message matched banned phrase ${banned} for "${phrase}"`);
    }
  }
});

test('ISSUE 4: the router does not imply the problem is unimportant either', () => {
  const r = groundOrRefuse('my chest feels tight');
  assert.equal(r.ok, false);
  if (r.ok) throw new Error('expected refusal');
  for (const dismissive of [/nothing to worry/i, /probably nothing/i, /minor/i, /harmless/i, /all fine/i]) {
    assert.doesNotMatch(r.refusal.message, dismissive);
  }
  assert.match(r.refusal.message, /contact a clinician or your local emergency service/i);
});

test('ISSUE 4: the refusal still points somewhere useful', () => {
  const r = groundOrRefuse('my chest feels tight');
  assert.equal(r.ok, false);
  if (r.ok) throw new Error('expected refusal');
  assert.match(r.refusal.message, /shoulder, neck, lower back and knee/);
  assert.match(r.refusal.message, /Nothing has been recorded/);
});

test('ISSUE 4: detectOutOfScope is conservative and does not fire on MSK words', () => {
  assert.equal(detectOutOfScope('my shoulder hurts'), null);
  assert.equal(detectOutOfScope('my arm hurts when I lift'), null);
  assert.equal(detectOutOfScope('my lower back is stiff'), null);
  assert.equal(detectOutOfScope('my knee clicks'), null);
  assert.ok(detectOutOfScope('chest pain'));
  assert.ok(detectOutOfScope('胸闷'));
});
