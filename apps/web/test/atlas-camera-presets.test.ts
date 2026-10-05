import assert from 'node:assert/strict';
import { test, describe } from 'node:test';

import {
  AXES,
  CAMERA_PRESETS,
  PRIMARY_PRESETS,
  cueText,
  facingOf,
  isFacing,
  normalize,
  orientationCue,
  type PresetName,
} from '../src/atlas/camera-presets.ts';

const TARGET = { x: 0, y: 0, z: 0 };
const at = (x: number, y: number, z: number) => ({ eye: { x, y, z }, target: TARGET });
/** Camera placed along a preset's own direction, at any distance. */
const along = (name: PresetName, d = 5) => {
  const p = CAMERA_PRESETS[name].direction;
  return at(p.x * d, p.y * d, p.z * d);
};

describe('anatomical axis convention', () => {
  // This is the whole point of the module. The convention was measured from the
  // source data, and `wm.obj_import` silently rotated the body once already, so
  // it is pinned here rather than left to a comment.
  test('viewer space maps anterior to +Z, not -Z', () => {
    assert.equal(AXES.anterior, '+Z');
    assert.equal(AXES.posterior, '-Z');
  });

  test('the body own right is -X in viewer space', () => {
    assert.equal(AXES.bodyRight, '-X');
    assert.equal(AXES.bodyLeft, '+X');
  });

  test('superior is +Y after the Y-up export', () => {
    assert.equal(AXES.superior, '+Y');
    assert.equal(AXES.inferior, '-Y');
  });

  test('the axis pairs are exact opposites', () => {
    const opp = (a: string, b: string) => {
      const inv = (s: string) => (s.startsWith('-') ? `+${s.slice(1)}` : `-${s.slice(1)}`);
      return inv(a) === b;
    };
    assert.ok(opp(AXES.anterior, AXES.posterior));
    assert.ok(opp(AXES.bodyLeft, AXES.bodyRight));
    assert.ok(opp(AXES.superior, AXES.inferior));
  });
});

describe('camera presets put the camera on the side they claim', () => {
  // These are the "automated tests must verify the preset transforms" checks. Each
  // one fails if a preset direction is negated or permuted.
  for (const name of PRIMARY_PRESETS) {
    test(`${name}: camera along its own direction reports ${name}`, () => {
      assert.ok(
        isFacing(along(name), name),
        `${name} preset did not report ${name}; got ${facingOf(along(name))}`,
      );
    });
  }

  test('front and back are exact opposites', () => {
    // Compared with a tolerance: -0 !== 0 under strictEqual, and a unit vector on
    // an axis has a zero component that negates to negative zero.
    const opp = (a: { x: number; y: number; z: number }, b: { x: number; y: number; z: number }) => {
      for (const k of ['x', 'y', 'z'] as const) {
        assert.ok(Math.abs(a[k] + b[k]) < 1e-9, `${k}: ${a[k]} vs ${-b[k]}`);
      }
    };
    opp(CAMERA_PRESETS.front.direction, CAMERA_PRESETS.back.direction);
    opp(CAMERA_PRESETS.left.direction, CAMERA_PRESETS.right.direction);
    opp(CAMERA_PRESETS.superior.direction, CAMERA_PRESETS.inferior.direction);
  });

  test('left and right are exact opposites', () => {
    const l = CAMERA_PRESETS.left.direction;
    const r = CAMERA_PRESETS.right.direction;
    assert.ok(Math.abs(l.x + r.x) < 1e-9);
    assert.ok(Math.abs(l.y + r.y) < 1e-9);
    assert.ok(Math.abs(l.z + r.z) < 1e-9);
  });

  test('no front preset looks at the posterior surface', () => {
    // The specific regression the geometry gate nearly shipped: the importer
    // rotated the body, so "front" was showing the back.
    assert.ok(!isFacing(along('front'), 'back'), 'front must not be back');
    assert.ok(!isFacing(along('back'), 'front'), 'back must not be front');
    assert.ok(!isFacing(along('left'), 'right'), 'left must not be right');
    assert.ok(!isFacing(along('right'), 'left'), 'right must not be left');
  });

  test('every preset direction is a unit vector', () => {
    for (const name of Object.keys(CAMERA_PRESETS) as PresetName[]) {
      const d = CAMERA_PRESETS[name].direction;
      assert.ok(Math.abs(Math.hypot(d.x, d.y, d.z) - 1) < 1e-9, `${name} is not unit length`);
    }
  });

  test('distance does not change which side is facing', () => {
    for (const d of [0.1, 1, 50, 5000]) {
      assert.equal(facingOf(along('front', d)), 'front');
      assert.equal(facingOf(along('right', d)), 'right');
    }
  });

  test('normalize falls back to anterior on a zero vector', () => {
    const n = normalize({ x: 0, y: 0, z: 0 });
    assert.deepEqual(n, { x: 0, y: 0, z: 1 });
  });

  test('a mixed oblique resolves to its nearest anatomical axis, not to a screen direction', () => {
    const eye = { x: -3, y: 2, z: 3 };
    const f = facingOf({ eye, target: TARGET });
    assert.equal(f, 'front', 'an oblique mostly anterior and superior should read as front');
  });
});

describe('orientation cue', () => {
  test('is always one of the six anatomical labels', () => {
    const cases = [
      at(0, 0, 1),
      at(0, 0, -1),
      at(1, 0, 0),
      at(-1, 0, 0),
      at(0, 1, 0),
      at(0, -1, 0),
      at(1, -2, 3),
    ];
    const allowed = new Set(['front', 'back', 'left', 'right', 'superior', 'inferior']);
    for (const c of cases) {
      assert.ok(allowed.has(facingOf(c)), `unexpected facing ${facingOf(c)}`);
    }
  });

  test('renders anatomical letters, and says level when square-on', () => {
    // Square to the anterior surface is level left-right and level
    // superior-inferior. Claiming "left" or "superior" there would be a lie in
    // the one widget whose job is to be trusted about orientation.
    assert.equal(cueText(orientationCue(along('front'))), 'A / level / level');
    assert.equal(cueText(orientationCue(along('back'))), 'P / level / level');
    // A top-down view is genuinely level laterally AND genuinely superior.
    assert.equal(cueText(orientationCue(along('superior'))), 'S / level / S');
    assert.equal(cueText(orientationCue(along('inferior'))), 'I / level / I');
  });

  test('a side view reports its side and level vertically', () => {
    // From the body's right the dominant axis IS right, so `view` reads R and
    // `lateral` reads R. Looking square at the anterior surface is the only case
    // that is level in both other axes.
    assert.equal(cueText(orientationCue(along('right'))), 'R / R / level');
    assert.equal(cueText(orientationCue(along('left'))), 'L / L / level');
  });

  test('each axis resolves to exactly one value', () => {
    const cases = [
      at(0, 0, 1), at(0, 0, -1), at(1, 0, 0), at(-1, 0, 0),
      at(0, 1, 0), at(0, -1, 0), at(1, -2, 3), at(-5, 4, -2),
    ];
    const lateral = new Set(['L', 'R', 'level']);
    const vertical = new Set(['S', 'I', 'level']);
    const view = new Set(['A', 'P', 'S', 'I', 'L', 'R']);
    for (const c of cases) {
      const cue = orientationCue(c);
      assert.ok(view.has(cue.view), `bad view ${cue.view}`);
      assert.ok(lateral.has(cue.lateral), `bad lateral ${cue.lateral}`);
      assert.ok(vertical.has(cue.vertical), `bad vertical ${cue.vertical}`);
    }
  });

  test('lateral is only claimed when the camera is genuinely off the midline', () => {
    assert.equal(orientationCue(at(0, 0, 4)).lateral, 'level');
    assert.equal(orientationCue(at(0.05, 0, 4)).lateral, 'level', 'inside the epsilon is still level');
    assert.equal(orientationCue(at(0.9, 0, 0.4)).lateral, 'L');
    assert.equal(orientationCue(at(-0.9, 0, 0.4)).lateral, 'R');
  });

  test('each preset names the anatomical surface it looks at', () => {
    assert.equal(CAMERA_PRESETS.front.looksAt, 'the anterior surface');
    assert.equal(CAMERA_PRESETS.back.looksAt, 'the posterior surface');
    assert.equal(CAMERA_PRESETS.left.looksAt, "the body's left side");
    assert.equal(CAMERA_PRESETS.right.looksAt, "the body's right side");
  });
});