import { test } from 'node:test';
import assert from 'node:assert/strict';
import { groundFromText } from '../src/grounding.ts';

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

test('midline regions resolve to midline', () => {
  const g = groundFromText('my lower back is stiff in the morning');
  assert.ok(g);
  assert.equal(g.side, 'midline');
});

test('surface hint terms become candidate structures, never confirmations', () => {
  const g = groundFromText('my shoulder has rotator cuff pain');
  assert.ok(g);
  const cuff = g.consideredStructures.find((s) => s.structureId === 'asi:shoulder.supraspinatus-tendon');
  assert.ok(cuff, 'expected the rotator cuff to map onto the supraspinatus tendon');
  assert.equal(cuff.confirmedByUser, false, 'candidates must never be pre-confirmed');
});

test('preserves the user verbatim', () => {
  const phrase = '右肩里面这里疼';
  const g = groundFromText(phrase);
  assert.equal(g?.userPhrase, phrase);
});
