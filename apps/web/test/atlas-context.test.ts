import assert from 'node:assert/strict';
import { test, describe } from 'node:test';

import {
  CONTEXT_OPACITY,
  boxDiagonal,
  deriveContext,
  describeContext,
  isAdjacent,
  type Box,
  type ContextInput,
} from '../src/atlas/context.ts';
import { INITIAL_ATLAS_STATE, type AtlasState } from '../src/atlas/atlas-state.ts';

/**
 * Build a ContextInput from BodyParts3D's real per-mesh bounds, in mm.
 *
 * Real values, copied from the OBJ headers, so the adjacency thresholds under
 * test are the ones the shipped data produces rather than invented numbers.
 */
const S = (
  id: string,
  system: string,
  min: [number, number, number],
  max: [number, number, number],
): ContextInput => ({
  id,
  system,
  bounds: {
    min: { x: min[0], y: min[1], z: min[2] },
    max: { x: max[0], y: max[1], z: max[2] },
  },
});

const scapula = S('bp3d:FJ3384', 'bone', [-166, -103, 1184], [-57, 5, 1350]);
const clavicle = S('bp3d:FJ3362', 'bone', [-145, -147, 1309], [-10, -54, 1355]);
const humerus = S('bp3d:FJ3368', 'bone', [-241, -100, 1029], [-140, -51, 1337]);
const supraspinatus = S('bp3d:FJ1506', 'muscle', [-189, -92, 1307], [-64, -13, 1343]);
const infraspinatus = S('bp3d:FJ1500', 'muscle', [-189, -77, 1207], [-60, 4, 1331]);
/** Far away: mid-thigh territory, nowhere near the shoulder. */
const rectusFemoris = S('bp3d:FJ9000', 'muscle', [-90, -90, 400], [-40, -40, 900]);
const axillaryArtery = S('bp3d:FJ2268', 'artery', [-160, -110, 1250], [-110, -80, 1330]);
const axillaryVein = S('bp3d:FJ2269', 'vein', [-160, -110, 1250], [-108, -78, 1340]);
const skin = S('bp3d:FJ2810', 'skin', [-334, -220, -78], [333, 250, 1641]);

const ALL: ContextInput[] = [
  scapula, clavicle, humerus, supraspinatus, infraspinatus,
  rectusFemoris, axillaryArtery, axillaryVein, skin,
];

const st = (over: Partial<AtlasState> = {}): AtlasState => ({ ...INITIAL_ATLAS_STATE, ...over });

const run = (s: AtlasState) => deriveContext(ALL, s);
const cls = (r: ReturnType<typeof run>, id: string) => r.classes.get(id);

describe('adjacency is measured from real bounds', () => {
  test('a structure overlapping another is adjacent', () => {
    assert.ok(isAdjacent(supraspinatus.bounds!, infraspinatus.bounds!));
  });

  test('a structure on the far side of the body is not adjacent', () => {
    assert.equal(isAdjacent(supraspinatus.bounds!, rectusFemoris.bounds!), false);
  });

  test('the margin scales with the selected structure, not a global constant', () => {
    // One probe, two candidate "selections", opposite answers. The probe sits
    // inside the scapula's box and 96 mm above a 20 mm cube at the scapula's
    // inferior end. The scapula's reach is ~79 mm so it reaches; the cube's reach
    // is ~12 mm so it does not. The cubes do NOT touch the probe: separating
    // them is what makes the assertion mean anything.
    const probe: Box = { min: { x: -100, y: -40, z: 1300 }, max: { x: -90, y: -30, z: 1310 } };
    const big: Box = { min: { x: -166, y: -103, z: 1184 }, max: { x: -57, y: 5, z: 1350 } }; // scapula
    const small: Box = { min: { x: -166, y: -103, z: 1184 }, max: { x: -146, y: -83, z: 1204 } }; // 20 mm cube
    assert.ok(isAdjacent(big, probe), 'a wide margin should reach the probe');
    assert.equal(isAdjacent(small, probe), false, 'a small margin should not');
  });

  test('boxDiagonal is the corner-to-corner distance', () => {
    assert.equal(boxDiagonal({ min: { x: 0, y: 0, z: 0 }, max: { x: 3, y: 4, z: 0 } }), 5);
  });
});

describe('isolate draws less rather than drawing everything paler', () => {
  const s = st({ selectedId: supraspinatus.id, mode: 'isolate' });
  const r = run(s);

  test('the selection is at full opacity', () => {
    assert.equal(cls(r, supraspinatus.id), 'selected');
    assert.equal(r.opacities.get(supraspinatus.id), 1);
  });

  test('bone stays as orientation context', () => {
    for (const b of [scapula, clavicle, humerus]) {
      assert.equal(cls(r, b.id), 'bone');
      const o = r.opacities.get(b.id)!;
      assert.ok(o >= 0.12 && o <= 0.18, `bone opacity ${o} is outside the 12-18% band`);
    }
  });

  test('a neighbouring muscle is faint context', () => {
    assert.equal(cls(r, infraspinatus.id), 'adjacent');
    const o = r.opacities.get(infraspinatus.id)!;
    assert.ok(o >= 0.04 && o <= 0.07, `adjacent opacity ${o} is outside the 4-7% band`);
  });

  test('an unrelated muscle is hidden, not made faint', () => {
    // This is the fix for the fog: the muscle that caused it is not drawn at all.
    assert.equal(cls(r, rectusFemoris.id), 'hidden');
    assert.equal(r.opacities.get(rectusFemoris.id), 0);
  });

  test('vessels are ghosts only when the user had that layer on', () => {
    assert.equal(cls(r, axillaryArtery.id), 'system');
    assert.equal(cls(r, axillaryVein.id), 'system');
    const off = run(st({ selectedId: supraspinatus.id, mode: 'isolate', systemVisibility: { artery: false } }));
    assert.equal(cls(off, axillaryArtery.id), 'hidden', 'an artery the user switched off stays off');
    assert.equal(cls(off, axillaryVein.id), 'system', 'the vein was still on, so it stays');
  });

  test('the whole-body shell is not part of regional isolate', () => {
    assert.equal(cls(r, skin.id), 'hidden');
  });

  test('far fewer structures are drawn than the old global-ghost version', () => {
    // The old isolate drew 41 of 42 structures at one opacity and fogged. Here 7 of
    // 9 are drawn: the selection, the three bones, the one nearby muscle, and the
    // two vessels. Dropped are the unrelated muscle, and the skin, which is a
    // whole-body surface with no place in a regional close-up. The point is that
    // nothing is drawn merely because it exists.
    const drawn = [...r.classes.values()].filter((c) => c !== 'hidden');
    assert.equal(drawn.length, 7);
    assert.equal(cls(r, rectusFemoris.id), 'hidden');
    assert.equal(cls(r, skin.id), 'hidden');
  });

  test('bone is the largest visible class, which is the opposite of the old fog', () => {
    // The fog was 27 muscles stacked at 13%. Now the skeleton dominates the
    // context, which is what a person actually orients by.
    assert.ok(r.counts.bone >= r.counts.adjacent, `bone ${r.counts.bone} vs adjacent ${r.counts.adjacent}`);
  });

  test('the selection is the only thing at full opacity', () => {
    const full = [...r.opacities.entries()].filter(([, o]) => o >= 0.9);
    assert.equal(full.length, 1);
    assert.equal(full[0]![0], supraspinatus.id);
  });
});

describe('isolate still respects an explicit hide', () => {
  test('hiding the bone removes it from the orientation context', () => {
    const s = st({
      selectedId: supraspinatus.id,
      mode: 'isolate',
      hiddenIds: [scapula.id],
    });
    assert.equal(cls(run(s), scapula.id), 'hidden');
  });
});

describe('solo still removes everything but the selection', () => {
  const s = st({ selectedId: supraspinatus.id, mode: 'solo' });
  const r = run(s);
  test('only the selection is drawn', () => {
    for (const i of ALL) {
      assert.equal(cls(r, i.id), i.id === supraspinatus.id ? 'selected' : 'hidden', i.id);
    }
  });
  test('and it stays at full opacity even with a layer off', () => {
    const off = run(st({ selectedId: supraspinatus.id, mode: 'solo', systemVisibility: { muscle: false } }));
    assert.equal(cls(off, supraspinatus.id), 'selected');
  });
});

describe('explore is unchanged by all of this', () => {
  test('with no selection, layer visibility and the opacity slider decide', () => {
    const r = run(st({ opacity: 0.7 }));
    assert.equal(cls(r, scapula.id), 'system');
    assert.equal(r.opacities.get(scapula.id), 0.7);
    const off = run(st({ systemVisibility: { bone: false } }));
    assert.equal(cls(off, scapula.id), 'hidden');
  });

  test('a selection in explore does not ghost anything', () => {
    const r = run(st({ selectedId: supraspinatus.id }));
    assert.equal(r.opacities.get(infraspinatus.id), 1, 'explore must not fade the neighbours');
  });
});

describe('the caption reports what isolate is actually doing', () => {
  test('it counts the hidden structures', () => {
    const r = run(st({ selectedId: supraspinatus.id, mode: 'isolate' }));
    const caption = describeContext(r.counts);
    assert.match(caption, /skeleton for orientation/);
    assert.match(caption, /\d+ nearby/);
    assert.match(caption, /hidden/);
  });

  test('with nothing selected it says so instead of describing nothing', () => {
    assert.match(describeContext(run(INITIAL_ATLAS_STATE).counts), /Pick a structure/);
  });
});

describe('opacity bands are the ones the design asked for', () => {
  test('bone sits in 12-18% and adjacent muscle in 4-7%', () => {
    assert.ok(CONTEXT_OPACITY.bone >= 0.12 && CONTEXT_OPACITY.bone <= 0.18);
    assert.ok(CONTEXT_OPACITY.adjacent >= 0.04 && CONTEXT_OPACITY.adjacent <= 0.07);
  });

  test('bone is more present than muscle context, because it is the landmark', () => {
    assert.ok(CONTEXT_OPACITY.bone > CONTEXT_OPACITY.adjacent);
  });
});

describe('a structure with no bounds cannot be called adjacent', () => {
  test('it falls back to hidden rather than guessing', () => {
    const noBounds: ContextInput = { id: 'x', system: 'muscle', bounds: null };
    const r = deriveContext([...ALL, noBounds], st({ selectedId: supraspinatus.id, mode: 'isolate' }));
    assert.equal(r.classes.get('x'), 'hidden');
  });
});

describe('the box helper handles degenerate input', () => {
  test('a zero-size box is adjacent to anything overlapping it', () => {
    const dot: Box = { min: { x: 0, y: 0, z: 0 }, max: { x: 0, y: 0, z: 0 } };
    assert.equal(isAdjacent(dot, { min: { x: 0, y: 0, z: 0 }, max: { x: 0, y: 0, z: 0 } }), true);
  });
});
