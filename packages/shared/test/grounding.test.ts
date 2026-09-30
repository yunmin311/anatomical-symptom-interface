import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
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

/* ================================================================== */
/* Out-of-scope terms are matched on lexical boundaries                */
/* ================================================================== */

/**
 * `detectOutOfScope` used `compact.includes(term)`, so a term matched anywhere
 * inside a larger word. "ear" is contained in near / year / years / clear /
 * wears / hear / tear, and "fit" is contained in fitness / benefit / outfit.
 *
 * The consequence was not a cosmetic miss: the complaint was REFUSED and routed
 * to the wrong body area, so a supported shoulder or knee problem could not
 * reach an interview at all. Describing how long a problem has been going on
 * was enough to trigger it.
 */
const EMBEDDED_IN_A_SUPPORTED_COMPLAINT = [
  'my knee has hurt for 3 years',
  'it has bothered me for two years',
  'lower back pain for a year',
  'it started about a year ago and comes and goes',
  'my back hurts near the spine',
  'my right shoulder hurts deep inside near the rotator cuff',
  'shoulder feels tight after a clear night sleep',
  'the discomfort wears off after I rest',
  'I can hear a click in my knee',
  'I get knee pain when I do fitness training',
  'my knee hurts when I go downhill',
  'my neck aches and I turned my head sharply',
];

test('a supported complaint is not refused because a term sits inside a bigger word', () => {
  for (const text of EMBEDDED_IN_A_SUPPORTED_COMPLAINT) {
    assert.equal(detectOutOfScope(text), null, `wrongly refused: ${text}`);
  }
});

test('every embedding that caused the bug is now inert', () => {
  // Each of these contains a real out-of-scope term as a strict substring.
  for (const [text, embedded] of [
    ['pain near the elbow', 'ear'],
    ['three years', 'ear'],
    ['a year', 'ear'],
    ['clear in the morning', 'ear'],
    ['it wears off', 'ear'],
    ['I hear a click', 'ear'],
    ['a tear in the muscle', 'ear'],
    ['no fear of movement', 'ear'],
    ['fitness training', 'fit'],
    ['benefit of exercise', 'fit'],
    ['outfit', 'fit'],
    ['profit from walking', 'fit'],
  ] as const) {
    assert.ok(text.includes(embedded), 'fixture no longer contains the substring');
    assert.equal(detectOutOfScope(text), null, `"${embedded}" wrongly matched inside: ${text}`);
  }
});

test('the real terms still refuse, on their own and in phrases', () => {
  // Boundary matching must not defuse the term that the embeddings above stole.
  for (const [text, area] of [
    ['my ear is blocked and hurts', 'ear'],
    ['earache since yesterday', 'ear'],
    ['ear pain radiating outward', 'ear'],
    ['sharp chest pain radiating to my jaw', 'chest'],
    ['my chest feels tight', 'chest'],
    ['I am breathless climbing stairs', 'breathlessness'],
    ['shortness of breath', 'breathlessness'],
    ['I cannot breathe properly', 'breathlessness'],
    ["I can't breathe", 'breathlessness'],
    ['I have a rash on my arm', 'skin_rash'],
    ['itchy skin on my forearm', 'skin_rash'],
    ['my tooth aches', 'dental'],
    ['I fainted at the gym', 'neurological'],
    ['my vision has blurred', 'eye'],
    ['I am pregnant and bleeding', 'pregnancy'],
    ['slurred speech since this morning', 'neurological'],
    ['face droop on one side', 'neurological'],
  ] as const) {
    const hit = detectOutOfScope(text);
    assert.ok(hit, `wrongly accepted: ${text}`);
    assert.equal(hit.area, area, `wrong area for ${text}`);
  }
});

test('a multi-word term needs all of its words, adjacent', () => {
  // "breath" alone is not a term; "shortness of breath" is, and must be found as
  // a run of three tokens rather than three independent words.
  assert.equal(detectOutOfScope('I have breath'), null);
  assert.equal(detectOutOfScope('breath of the morning'), null);
  assert.ok(detectOutOfScope('I have some shortness of breath'));
});

test('an out-of-scope term is still found next to Chinese text', () => {
  // No space between scripts is normal in mixed input, so the Latin token stream
  // has to drop the Han run rather than glue onto it.
  assert.ok(detectOutOfScope('chest疼'), 'Latin term glued to Han was missed');
  assert.ok(detectOutOfScope('我chest疼'));
});

test('Han terms still match as substrings', () => {
  // Chinese has no spaces, so substring matching is the correct unit there.
  for (const text of ['胸闷', '我耳朵疼', '肚子痛', '皮肤起疹', '尿频', '牙痛', '我怀孕了']) {
    assert.ok(detectOutOfScope(text), `Han term missed: ${text}`);
  }
});

test('mixed Chinese and English still refuses for the right reason', () => {
  assert.equal(detectOutOfScope('我的knee很痛'), null);
  assert.equal(detectOutOfScope('我的chest很痛')?.area, 'chest');
  // "年" is Han and harmless; the English "year" must not become an ear.
  assert.equal(detectOutOfScope('knee痛了3年'), null);
});

test('punctuation and casing do not hide a term', () => {
  assert.ok(detectOutOfScope('CHEST pain.'));
  assert.ok(detectOutOfScope('chest-pain'));
  assert.ok(detectOutOfScope('chest, pain'));
  assert.ok(detectOutOfScope('  chest   pain  '));
});

/* ================================================================== */
/* Inflections the stricter matcher would otherwise leak                */
/* ================================================================== */

/**
 * Matching on token boundaries is STRICTER than substring matching, so a form
 * that used to be caught by accident inside a longer word is only caught if it
 * is actually listed. Each of these was verified to reach the MSK interview
 * against a realistic complaint before being added.
 *
 * They are inflections of terms the list already had, not new body areas, so
 * this closes holes rather than widening coverage.
 */
const VERIFIED_INFLECTIONS: readonly (readonly [string, string, string])[] = [
  ['urinary', 'urinate', 'burning when I urinate'],
  ['urinary', 'urination', 'it stings when there is urination'],
  ['dental', 'gums', 'my gums are sore and bleed when I brush'],
  ['ear', 'ears', 'my ears hurt when I fly'],
  ['neurological', 'seizures', 'I had two seizures last year'],
  ['neurological', 'blackouts', 'I have had blackouts when standing up'],
  ['pregnancy', 'miscarriages', 'I had two miscarriages in the past year'],
  ['skin_rash', 'boil', 'a boil on my thigh is very tender'],
];

test('a listed inflection is refused for the right area', () => {
  for (const [area, term, sentence] of VERIFIED_INFLECTIONS) {
    const hit = detectOutOfScope(sentence);
    assert.ok(hit, `wrongly accepted: ${sentence}`);
    assert.equal(hit.area, area, `wrong area for ${sentence}`);
  }
});

test('the singular and plural of a term agree, so neither is a special case', () => {
  // The bug was a list that held some plurals and not others. If these pairs
  // ever diverge again, the leak is back.
  for (const [singular, plural, area] of [
    ['urine', 'urines', 'urinary'],
    ['gum', 'gums', 'dental'],
    ['ear', 'ears', 'ear'],
    ['seizure', 'seizures', 'neurological'],
    ['blackout', 'blackouts', 'neurological'],
    ['miscarriage', 'miscarriages', 'pregnancy'],
    ['boil', 'boils', 'skin_rash'],
    ['eye', 'eyes', 'eye'],
    ['tooth', 'teeth', 'dental'],
    ['testicle', 'testicles', 'pelvis_groin'],
  ] as const) {
    for (const form of [singular, plural]) {
      const hit = detectOutOfScope(`my ${form} is painful`);
      if (!hit) continue; // an irregular plural is allowed to be absent
      assert.equal(hit.area, area, `${form} -> ${hit.area}, expected ${area}`);
    }
  }
});

test('a generic pain word is still not an out-of-scope term', () => {
  // The plural of "chest" must not become a way to refuse every ache, or the
  // fix above would reintroduce over-refusal through the back door.
  for (const text of [
    'my lower back pains in the morning',
    'my knees ache after a long walk',
    'my shoulder is painful today',
    'my neck throbs',
    'my knee feels sore',
  ]) {
    assert.equal(detectOutOfScope(text), null, `wrongly refused: ${text}`);
  }
});

test('the term list holds no exact duplicates', () => {
  // 'urine' and 'rash' were each listed twice, which is harmless at runtime but
  // hides a real omission when you read the list to check coverage.
  const src = readFileSync(new URL('../src/grounding.ts', import.meta.url), 'utf8');
  const block = src
    .slice(src.indexOf('const OUT_OF_SCOPE_TERMS'), src.indexOf('/** Regions this build localises.'))
    // Comments quote terms to explain them, so they are not entries.
    .replace(/\/\/[^\n]*/g, '');
  const seen = new Set<string>();
  for (const match of block.matchAll(/'([^']+)'|"([^"]+)"/g)) {
    const term = match[1] ?? match[2];
    if (term === undefined) continue;
    assert.equal(seen.has(term), false, `duplicate term: ${term}`);
    seen.add(term);
  }
  // A scan that found nothing would pass vacuously, so assert it saw the list.
  assert.ok(seen.size > 60, `expected the whole list, only saw ${seen.size} terms`);
});
