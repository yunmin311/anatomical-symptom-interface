/**
 * Anatomical camera presets.
 *
 * ## The axis convention, stated once and tested
 *
 * These are anatomical directions derived from the source data, never inferred
 * from where the canvas happens to point. The convention was established by
 * measurement in `scripts/scope-shoulder-review.mjs` and verified by a
 * per-axis assertion in the Blender build:
 *
 *   BodyParts3D source space (millimetres)
 *     anterior  = -Y   sternum sits at y = -189.5, the most anterior midline point
 *     posterior = +Y   infraspinatus sits at y = -36.5, behind it
 *     superior  = +Z   skin spans z = -78 .. 1641, feet to head
 *     the body's own RIGHT occupies -X
 *
 *   glTF viewer space, after Blender's Y-up export (which also rotated the body
 *   once, silently, before this was pinned down -- see spikes/shoulder-geometry/
 *   GEOMETRY-GATE.md section 6.1)
 *     anterior  = +Z   Blender -Y
 *     posterior = -Z
 *     superior  = +Y   Blender +Z
 *     body RIGHT = -X   unchanged
 *     body LEFT  = +X
 *
 * That mapping is what makes `front` show the anterior surface rather than a
 * confident, wrong picture of the back.
 */

import type { Vector3 } from './math-types.ts';

/** Viewer-space anatomical axes. */
export const AXES = {
  anterior: '+Z',
  posterior: '-Z',
  superior: '+Y',
  inferior: '-Y',
  bodyLeft: '+X',
  bodyRight: '-X',
} as const;

export type PresetName = 'front' | 'back' | 'left' | 'right' | 'superior' | 'inferior';

export interface CameraPreset {
  name: PresetName;
  label: string;
  /** Unit direction from the target to the camera, in viewer space. */
  direction: Vector3;
  /** Short cue shown in the orientation indicator when this preset is active. */
  facing: string;
  /**
   * A one-line statement of what the user is looking at, in anatomical terms.
   * Used for the accessible name of the button and for the view caption, so the
   * control can never be read as "the front of the screen".
   */
  looksAt: string;
}

const v = (x: number, y: number, z: number): Vector3 => ({ x, y, z });

export const CAMERA_PRESETS: Readonly<Record<PresetName, CameraPreset>> = {
  front: {
    name: 'front',
    label: 'Front',
    direction: v(0, 0, 1),
    facing: 'A',
    looksAt: 'the anterior surface',
  },
  back: {
    name: 'back',
    label: 'Back',
    direction: v(0, 0, -1),
    facing: 'P',
    looksAt: 'the posterior surface',
  },
  left: {
    name: 'left',
    label: 'Left',
    direction: v(1, 0, 0),
    facing: 'L',
    looksAt: "the body's left side",
  },
  right: {
    name: 'right',
    label: 'Right',
    direction: v(-1, 0, 0),
    facing: 'R',
    looksAt: "the body's right side",
  },
  superior: {
    name: 'superior',
    label: 'Top',
    direction: v(0, 1, 0),
    facing: 'S',
    looksAt: 'the superior aspect, looking down',
  },
  inferior: {
    name: 'inferior',
    label: 'Bottom',
    direction: v(0, -1, 0),
    facing: 'I',
    looksAt: 'the inferior aspect, looking up',
  },
};

/** The four the brief requires as user-facing controls, in anatomical order. */
export const PRIMARY_PRESETS: readonly PresetName[] = ['front', 'back', 'left', 'right'];

export function presetDirection(name: PresetName): Vector3 {
  return CAMERA_PRESETS[name].direction;
}

/** Normalise a direction; zero-length input falls back to anterior. */
export function normalize(v0: Vector3): Vector3 {
  const len = Math.hypot(v0.x, v0.y, v0.z);
  if (len === 0) return v(0, 0, 1);
  return v(v0.x / len, v0.y / len, v0.z / len);
}

export function dot(a: Vector3, b: Vector3): number {
  return a.x * b.x + a.y * b.y + a.z * b.z;
}

export interface FrameInput {
  /** Camera position. */
  eye: Vector3;
  /** Point the camera looks at. */
  target: Vector3;
}

/**
 * Which anatomical direction the camera is looking FROM.
 *
 * Derived from eye - target, so it stays correct after any orbit. Used to drive
 * the A/P L/R S/I indicator, and by the tests to assert that the presets really
 * do put the camera on the anatomical side they claim.
 */
export function facingOf({ eye, target }: FrameInput): PresetName {
  const d = normalize({ x: eye.x - target.x, y: eye.y - target.y, z: eye.z - target.z });
  // Compare against each preset's direction, and report the closest axis.
  let best: PresetName = 'front';
  let bestDot = -Infinity;
  for (const name of Object.keys(CAMERA_PRESETS) as PresetName[]) {
    const pd = dot(d, CAMERA_PRESETS[name].direction);
    if (pd > bestDot) {
      bestDot = pd;
      best = name;
    }
  }
  return best;
}

/** True when the camera sits on the anatomical side `name` claims, within tolerance. */
export function isFacing(frame: FrameInput, name: PresetName, tolerance = 0.999): boolean {
  const d = normalize({ x: frame.eye.x - frame.target.x, y: frame.eye.y - frame.target.y, z: frame.eye.z - frame.target.z });
  return dot(d, CAMERA_PRESETS[name].direction) >= tolerance;
}

/**
 * The six-way orientation cue.
 *
 * Each axis is reported from the camera's own direction, and an axis the camera
 * lies ON reports `level` rather than picking a side arbitrarily. Standing
 * square to the anterior surface is level left-right and level superior-inferior,
 * and claiming "left" or "superior" there would be a small lie in a widget whose
 * entire job is to be trusted about orientation.
 */
export interface OrientationCue {
  /**
   * The dominant anatomical direction, which is what the camera is square to.
   * Can be L or R: viewing the body squarely from its own left or right is a
   * perfectly ordinary view, and forcing it into a four-letter set would lose the
   * dominant axis.
   */
  view: 'A' | 'P' | 'L' | 'R' | 'S' | 'I';
  /** Which side the camera is on, or level when it is square-on. */
  lateral: 'L' | 'R' | 'level';
  /** Whether the camera is above or below, or level. */
  vertical: 'S' | 'I' | 'level';
  /** The nearest single preset, for highlighting a preset button. */
  active: PresetName;
}

/** Below this component magnitude an axis counts as level, not as a side. */
export const LEVEL_EPSILON = 0.15;

export function orientationCue(frame: FrameInput): OrientationCue {
  const d = normalize({
    x: frame.eye.x - frame.target.x,
    y: frame.eye.y - frame.target.y,
    z: frame.eye.z - frame.target.z,
  });

  const view: OrientationCue['view'] =
    Math.abs(d.z) >= Math.abs(d.x) && Math.abs(d.z) >= Math.abs(d.y)
      ? d.z >= 0
        ? 'A'
        : 'P'
      : Math.abs(d.y) >= Math.abs(d.x)
        ? d.y >= 0
          ? 'S'
          : 'I'
        : d.x >= 0
          ? 'L'
          : 'R';

  const lateral: OrientationCue['lateral'] =
    Math.abs(d.x) < LEVEL_EPSILON ? 'level' : d.x >= 0 ? 'L' : 'R';
  const vertical: OrientationCue['vertical'] =
    Math.abs(d.y) < LEVEL_EPSILON ? 'level' : d.y >= 0 ? 'S' : 'I';

  return { view, lateral, vertical, active: facingOf(frame) };
}

/**
 * Compact string for the indicator, e.g. "A / R / level".
 *
 * Deliberately spells out "level" instead of blanking it, so a square-on view is
 * visibly a square-on view.
 */
export function cueText(cue: OrientationCue): string {
  return `${cue.view} / ${cue.lateral} / ${cue.vertical}`;
}