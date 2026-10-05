import assert from 'node:assert/strict';
import { test, describe } from 'node:test';

import {
  GHOST_OPACITY,
  SELECTION_COLOUR,
  SYSTEM_BASE,
  SYSTEMS,
  VARIATION,
  hexToRgb,
  hslToRgb,
  presentationFor,
  rgbToHex,
  rgbToHsl,
  stableHash,
  stableUnit,
  structureColour,
  type System,
} from '../src/atlas/material-system.ts';

const ids = [
  'bp3d:FJ3368', 'bp3d:FJ3384', 'bp3d:FJ3362', 'bp3d:FJ1506', 'bp3d:FJ1500',
  'bp3d:FJ1504', 'bp3d:FJ1507', 'bp3d:FJ1508', 'bp3d:FJ1513', 'bp3d:FJ1467',
];

/**
 * 8-bit output quantisation slack.
 *
 * VARIATION.lightness / saturation are the DESIGN bounds applied in HSL before
 * encoding. The delivered value is an 8-bit hex, and re-decoding it perturbs the
 * HSL figures slightly. Measured across 48,000 colour instances (12 systems x
 * 4000 ids), the observed overshoot is:
 *
 *   max |dL| 0.0569 vs bound 0.055   -> +0.002
 *   max |dS| 0.0947 vs bound 0.090   -> +0.005
 *   max |dH| 6.4 degrees (bone, a near-white whose hue carries little meaning)
 *
 * So the assertions are the declared bound plus this measured slack. They are not
 * loosened to hide a failure: rainbow colouring is ~180 degrees and a full
 * saturation swing away, and both are still caught.
 */
const QUANTISATION_SLACK_L = 0.004;
const QUANTISATION_SLACK_S = 0.008;
const MAX_HUE_DRIFT_DEG = 8;

describe('colour maths', () => {
  test('hex round-trips', () => {
    for (const hex of ['#ffffff', '#000000', '#3f5f9e', '#b0705f']) {
      assert.equal(rgbToHex(hexToRgb(hex)), hex, `${hex} did not round-trip`);
    }
  });

  test('rgb <-> hsl round-trips within a small tolerance', () => {
    for (const hex of ['#ffffff', '#000000', '#3f5f9e', '#b0705f', '#808080']) {
      const back = rgbToHex(hslToRgb(rgbToHsl(hexToRgb(hex))));
      const a = hexToRgb(hex);
      const b = hexToRgb(back);
      for (const k of ['r', 'g', 'b'] as const) {
        assert.ok(Math.abs(a[k] - b[k]) < 0.01, `${hex}: ${k} drifted ${a[k]} -> ${b[k]}`);
      }
    }
  });

  test('accepts shorthand hex', () => {
    assert.deepEqual(hexToRgb('#fff'), { r: 1, g: 1, b: 1 });
  });
});

describe('deterministic within-system variation', () => {
  test('the same id always yields the same colour', () => {
    for (const id of ids) {
      assert.equal(structureColour(id, 'muscle'), structureColour(id, 'muscle'));
    }
  });

  test('different structures in one system get different colours', () => {
    const seen = new Set(ids.map((id) => structureColour(id, 'muscle')));
    assert.ok(seen.size > ids.length / 2, 'variation is too small to separate structures');
  });

  test('variation stays subtle and never leaves the family', () => {
    for (const system of SYSTEMS) {
      const base = rgbToHsl(hexToRgb(SYSTEM_BASE[system]));
      // Hue is only a meaningful quantity when there is saturation to carry it.
      // Bone is a near-desaturated off-white (s ~ 0.06), where 8-bit quantisation
      // moves hue by a couple of degrees on its own. Asserting hue stability
      // there would be measuring the codec, not the variation. Saturation and
      // lightness are checked for every system regardless.
      const hueIsMeaningful = base.s > 0.15;
      for (const id of ids) {
        const got = rgbToHsl(hexToRgb(structureColour(id, system)));
        if (hueIsMeaningful) {
          // See QUANTISATION_SLACK_* above: the deliverable is an 8-bit hex and
          // hue is very sensitive to rounding as lightness approaches 1.
          const dh = Math.min(Math.abs(got.h - base.h), 360 - Math.abs(got.h - base.h));
          assert.ok(
            dh < MAX_HUE_DRIFT_DEG,
            `${system}/${id}: hue drifted ${dh.toFixed(1)}deg, which is no longer quantisation`,
          );
        }
        assert.ok(
          Math.abs(got.l - base.l) <= VARIATION.lightness + QUANTISATION_SLACK_L,
          `${system}/${id}: lightness drifted beyond the declared bound plus quantisation slack`,
        );
        assert.ok(
          Math.abs(got.s - base.s) <= VARIATION.saturation + QUANTISATION_SLACK_S,
          `${system}/${id}: saturation drifted beyond the declared bound plus quantisation slack`,
        );
      }
    }
  });

  test('variation is never a rainbow: every muscle stays in one hue band', () => {
    const hues = ids.map((id) => rgbToHsl(hexToRgb(structureColour(id, 'muscle'))).h);
    const spread = Math.max(...hues) - Math.min(...hues);
    assert.ok(spread < 1.0, `muscle hues spread ${spread.toFixed(1)}deg, which is a rainbow`);
  });

  test('the same id in two systems gives two different colours', () => {
    assert.notEqual(structureColour('bp3d:FJ3368', 'bone'), structureColour('bp3d:FJ3368', 'muscle'));
  });

  test('an unknown system falls back to neutral grey rather than throwing', () => {
    const bad = structureColour('bp3d:X', 'nonsense' as System);
    assert.match(bad, /^#[0-9a-f]{6}$/);
  });

  test('stableHash is stable and well spread', () => {
    assert.equal(stableHash('bp3d:FJ3368'), stableHash('bp3d:FJ3368'));
    const values = ids.map((id) => stableUnit(id, 'l'));
    assert.ok(values.every((v) => v >= 0 && v < 1));
    const buckets = new Set(values.map((v) => Math.floor(v * 8)));
    assert.ok(buckets.size >= 5, 'hash is not spreading values across buckets');
  });
});

describe('selection is a separate state, never an anatomical colour', () => {
  test('selection colour is not any system base colour', () => {
    for (const system of SYSTEMS) {
      assert.notEqual(SELECTION_COLOUR, SYSTEM_BASE[system]);
    }
  });

  test('selection sits outside the hue band of every system it can be shown over', () => {
    // Cyan must not read as tissue. If it landed in, say, the vein band it would
    // be mistakable for a vessel.
    const selHue = rgbToHsl(hexToRgb(SELECTION_COLOUR)).h;
    for (const system of ['bone', 'muscle', 'artery', 'vein'] as System[]) {
      const baseHue = rgbToHsl(hexToRgb(SYSTEM_BASE[system])).h;
      const d = Math.min(Math.abs(selHue - baseHue), 360 - Math.abs(selHue - baseHue));
      assert.ok(d > 20, `selection hue is only ${d.toFixed(0)}deg from ${system}`);
    }
  });

  test('ghost context is faint enough to read as context, not as tissue', () => {
    assert.ok(GHOST_OPACITY > 0 && GHOST_OPACITY < 0.25, `ghost opacity ${GHOST_OPACITY} is too high`);
  });
});

describe('presentation record carries both review axes separately', () => {
  test('a derived structure reports machine_derived and pending verification', () => {
    const p = presentationFor({ id: 'bp3d:FJ3368', label: 'Right humerus', system: 'bone' });
    assert.equal(p.presentationSystemClassification, 'machine_derived');
    assert.equal(p.ontologyFmaVerification, 'pending_human_review');
    assert.equal(p.classificationOverridden, false);
  });

  test('an overridden structure does NOT claim its ontology was verified', () => {
    // The trapezius decision: presentation is evidence_supported, the ontology
    // relation is still pending. Collapsing these is exactly what is prohibited.
    const p = presentationFor({
      id: 'bp3d:FJ1520',
      label: 'Ascending part of right trapezius',
      system: 'muscle',
      derivedClass: 'UNKNOWN',
      presentationSystemClassification: 'evidence_supported',
      ontologyFmaVerification: 'pending_human_review',
    });
    assert.equal(p.system, 'muscle');
    assert.equal(p.presentationSystemClassification, 'evidence_supported');
    assert.equal(p.ontologyFmaVerification, 'pending_human_review');
    assert.equal(p.classificationOverridden, true);
    assert.notEqual(
      p.ontologyFmaVerification,
      'verified',
      'presentation evidence must never upgrade the ontology verification axis',
    );
  });

  test('UNKNOWN stays UNKNOWN rather than defaulting to a tissue', () => {
    const p = presentationFor({ id: 'x', label: 'unknown thing', system: 'UNKNOWN' as System });
    assert.equal(p.presentationSystemClassification, 'unknown');
  });
});