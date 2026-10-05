import assert from 'node:assert/strict';
import { test, describe } from 'node:test';

import {
  INITIAL_ATLAS_STATE,
  deriveRenderStates,
  hover,
  reset,
  searchStructures,
  select,
  setBodyVisible,
  setMode,
  setOpacity,
  setSystem,
  toggleHidden,
  toggleSystem,
  type StructureLike,
} from '../src/atlas/atlas-state.ts';
import { GHOST_OPACITY } from '../src/atlas/material-system.ts';
import {
  NOT_IN_SOURCE_REASONS,
  SHOULDER_SYSTEM_COUNTS,
  WHOLE_BODY_SYSTEM_COUNTS,
  coverageClaimsAreHonest,
  coverageForRegion,
  coverageSentence,
} from '../src/atlas/coverage.ts';
import {
  clampDistance,
  fidelityPolicy,
  inCloseInspectionBand,
} from '../src/atlas/fidelity.ts';

const S = (id: string, label: string, system: StructureLike['system']): StructureLike => ({
  id,
  label,
  system,
});

const STRUCTURES: StructureLike[] = [
  S('bp3d:FJ3368', 'Right humerus', 'bone'),
  S('bp3d:FJ3384', 'Right scapula', 'bone'),
  S('bp3d:FJ3362', 'Right clavicle', 'bone'),
  S('bp3d:FJ1506', 'Right supraspinatus', 'muscle'),
  S('bp3d:FJ1500', 'Right infraspinatus muscle', 'muscle'),
  S('bp3d:FJ1504', 'Right subscapularis', 'muscle'),
  S('bp3d:FJ1508', 'Right teres minor', 'muscle'),
  S('bp3d:FJ1513', 'Spinal part of right deltoid', 'muscle'),
  S('bp3d:FJ1520', 'Ascending part of right trapezius', 'muscle'),
  S('bp3d:FJ2268', 'Right axillary artery', 'artery'),
  S('bp3d:FJ2269', 'Right axillary vein', 'vein'),
];

const state = (over: Partial<typeof INITIAL_ATLAS_STATE> = {}) => ({
  ...INITIAL_ATLAS_STATE,
  ...over,
});
const rs = (st: typeof INITIAL_ATLAS_STATE, id: string) =>
  deriveRenderStates(STRUCTURES, st).get(id)!;

describe('layer visibility', () => {
  test('everything is visible by default', () => {
    const m = deriveRenderStates(STRUCTURES, INITIAL_ATLAS_STATE);
    for (const s of STRUCTURES) assert.equal(m.get(s.id)!.visible, true, s.id);
  });

  test('switching a system off hides only that system', () => {
    const st = toggleSystem(INITIAL_ATLAS_STATE, 'muscle');
    assert.equal(rs(st, 'bp3d:FJ1506').visible, false);
    assert.equal(rs(st, 'bp3d:FJ3368').visible, true);
    assert.equal(rs(st, 'bp3d:FJ2268').visible, true);
  });

  test('switching a system back on restores it', () => {
    const off = toggleSystem(INITIAL_ATLAS_STATE, 'muscle');
    const on = toggleSystem(off, 'muscle');
    assert.equal(rs(on, 'bp3d:FJ1506').visible, true);
  });

  test('artery and vein are independent', () => {
    const st = toggleSystem(INITIAL_ATLAS_STATE, 'artery');
    assert.equal(rs(st, 'bp3d:FJ2268').visible, false, 'artery should be off');
    assert.equal(rs(st, 'bp3d:FJ2269').visible, true, 'vein must stay on');
  });

  test('setSystem is idempotent', () => {
    const a = setSystem(INITIAL_ATLAS_STATE, 'muscle', false);
    const b = setSystem(a, 'muscle', false);
    assert.deepEqual(a.systemVisibility, b.systemVisibility);
  });
});

describe('hide', () => {
  test('hide removes one structure without touching its neighbours', () => {
    const st = toggleHidden(INITIAL_ATLAS_STATE, 'bp3d:FJ1506');
    assert.equal(rs(st, 'bp3d:FJ1506').visible, false);
    assert.equal(rs(st, 'bp3d:FJ1500').visible, true);
  });

  test('hide is reversible', () => {
    const hidden = toggleHidden(INITIAL_ATLAS_STATE, 'bp3d:FJ1506');
    const shown = toggleHidden(hidden, 'bp3d:FJ1506');
    assert.equal(rs(shown, 'bp3d:FJ1506').visible, true);
    assert.deepEqual(shown.hiddenIds, []);
  });

  test('hide beats the selection', () => {
    // The selected structure is the ONLY one the panel offers Hide for, so if
    // selection short-circuited before hidden, the Hide button was a no-op in
    // precisely the case anyone would press it.
    for (const mode of ['explore', 'isolate', 'solo'] as const) {
      const st = toggleHidden(state({ selectedId: 'bp3d:FJ1506', mode }), 'bp3d:FJ1506');
      const r = rs(st, 'bp3d:FJ1506');
      assert.equal(r.visible, false, `hide must win in ${mode} mode`);
      assert.equal(r.opacity, 0, `a hidden structure is not drawn at any opacity in ${mode}`);
    }
  });

  test('hide does not leak to the rest of the system', () => {
    const st = toggleHidden(state({ selectedId: 'bp3d:FJ1506' }), 'bp3d:FJ1506');
    assert.equal(rs(st, 'bp3d:FJ1500').visible, true, 'a sibling muscle stays visible');
    assert.equal(rs(st, 'bp3d:FJ3368').visible, true, 'bone stays visible');
  });
});

describe('opacity', () => {
  test('opacity applies to ordinary structures', () => {
    const st = setOpacity(INITIAL_ATLAS_STATE, 0.4);
    assert.ok(Math.abs(rs(st, 'bp3d:FJ3368').opacity - 0.4) < 1e-9);
  });

  test('opacity is clamped to a usable range', () => {
    assert.equal(setOpacity(INITIAL_ATLAS_STATE, 0).opacity, 0.05);
    assert.equal(setOpacity(INITIAL_ATLAS_STATE, 5).opacity, 1);
  });
});

describe('isolate is the primary action, solo is not the default', () => {
  test('isolate keeps the selection solid and ghosts the rest', () => {
    const st = state({ selectedId: 'bp3d:FJ1506', mode: 'isolate' });
    const sel = rs(st, 'bp3d:FJ1506');
    const other = rs(st, 'bp3d:FJ3368');
    assert.equal(sel.visible, true);
    assert.equal(sel.opacity, 1);
    assert.equal(sel.ghosted, false);
    assert.equal(other.visible, true, 'isolate keeps context visible');
    assert.ok(Math.abs(other.opacity - GHOST_OPACITY) < 1e-9);
    assert.equal(other.ghosted, true);
  });

  test('solo hides everything but the selection', () => {
    const st = state({ selectedId: 'bp3d:FJ1506', mode: 'solo' });
    assert.equal(rs(st, 'bp3d:FJ1506').visible, true);
    assert.equal(rs(st, 'bp3d:FJ3368').visible, false);
    assert.equal(rs(st, 'bp3d:FJ2268').visible, false);
  });

  test('the initial mode is explore, never solo', () => {
    assert.equal(INITIAL_ATLAS_STATE.mode, 'explore');
    assert.equal(INITIAL_ATLAS_STATE.selectedId, null);
  });

  test('isolate respects a layer that is switched off', () => {
    // Ghosting must not smuggle back a layer the user deliberately hid.
    const st = setSystem(state({ selectedId: 'bp3d:FJ3368', mode: 'isolate' }), 'bone', false);
    const m = deriveRenderStates(STRUCTURES, st);
    assert.equal(m.get('bp3d:FJ3368')!.visible, true, 'the selection itself stays visible');
    assert.equal(m.get('bp3d:FJ3384')!.visible, false, 'its layer-mates stay hidden');
  });

  test('the selection stays visible even in its own switched-off layer', () => {
    // The user just asked for that structure by name. Hiding its layer must not
    // make the selection silently disappear.
    const st = setSystem(state({ selectedId: 'bp3d:FJ3368' }), 'bone', false);
    assert.equal(rs(st, 'bp3d:FJ3368').visible, true);
    assert.equal(rs(st, 'bp3d:FJ3384').visible, false);
  });

  test('hover is independent of selection', () => {
    const st = hover(state({ selectedId: 'bp3d:FJ3368' }), 'bp3d:FJ1506');
    const m = deriveRenderStates(STRUCTURES, st);
    assert.equal(m.get('bp3d:FJ1506')!.hovered, true);
    assert.equal(m.get('bp3d:FJ1506')!.selected, false);
    assert.equal(m.get('bp3d:FJ3368')!.selected, true);
  });

  test('reset clears the selection AND leaves the mode', () => {
    // Otherwise returning from solo would re-apply soloing nobody asked for.
    const st = reset(state({ selectedId: 'bp3d:FJ1506', mode: 'solo', opacity: 0.2 }));
    assert.equal(st.selectedId, null);
    assert.equal(st.mode, 'explore');
    assert.equal(st.opacity, 1);
  });

  test('leaving solo returns to explore', () => {
    const st = setMode(state({ selectedId: 'x', mode: 'solo' }), 'explore');
    assert.equal(st.mode, 'explore');
    assert.equal(rs(st, 'bp3d:FJ3368').visible, true);
  });

  test('body context toggle is carried', () => {
    assert.equal(setBodyVisible(INITIAL_ATLAS_STATE, false).bodyVisible, false);
  });
});

describe('structure search', () => {
  test('finds by label', () => {
    const hits = searchStructures(STRUCTURES, 'supraspinatus');
    assert.equal(hits[0]!.item.id, 'bp3d:FJ1506');
  });

  test('is case insensitive', () => {
    assert.equal(searchStructures(STRUCTURES, 'SUPRASPINATUS')[0]!.item.id, 'bp3d:FJ1506');
  });

  test('ranks an exact label above a substring', () => {
    const hits = searchStructures(STRUCTURES, 'Right scapula');
    assert.equal(hits[0]!.item.label, 'Right scapula');
  });

  test('ranks a prefix above a mid-word match', () => {
    const hits = searchStructures(STRUCTURES, 'right');
    const first = hits[0]!.item.label;
    assert.ok(
      first.toLowerCase().startsWith('right'),
      `expected a label-prefix match first, got "${first}"`,
    );
  });

  test('returns nothing for an empty query rather than everything', () => {
    assert.equal(searchStructures(STRUCTURES, '').length, 0);
    assert.equal(searchStructures(STRUCTURES, '   ').length, 0);
  });

  test('returns nothing for a term that matches nothing', () => {
    assert.equal(searchStructures(STRUCTURES, 'zzzznotathing').length, 0);
  });

  test('reports the matched range so the UI can highlight it', () => {
    const [hit] = searchStructures(STRUCTURES, 'scapula');
    assert.ok(hit);
    assert.deepEqual(hit.ranges[0], [6, 13]);
  });

  test('is stable for equal scores', () => {
    const a = searchStructures(STRUCTURES, 'right').map((h) => h.item.id);
    const b = searchStructures(STRUCTURES, 'right').map((h) => h.item.id);
    assert.deepEqual(a, b);
  });

  test('finds the trapezius part whose derived class is UNKNOWN', () => {
    // It is presented as muscle, so it must be findable alongside its siblings.
    const hits = searchStructures(STRUCTURES, 'trapezius');
    assert.equal(hits.length, 1);
    assert.equal(hits[0]!.item.system, 'muscle');
  });
});

describe('dataset coverage is stated honestly', () => {
  const present = Object.keys(SHOULDER_SYSTEM_COUNTS);

  test('the shoulder reports bone, muscle, artery and vein as available', () => {
    const r = coverageForRegion('Shoulder', present);
    const have = r.available.map((c) => c.system).sort();
    assert.deepEqual(have, ['artery', 'bone', 'muscle', 'skin', 'vein']);
  });

  test('nerve, tendon, ligament and cartilage are reported as NOT in this model', () => {
    const r = coverageForRegion('Shoulder', present);
    const missing = r.notInSource.map((c) => c.system).sort();
    for (const s of ['nerve', 'tendon', 'ligament', 'cartilage']) {
      assert.ok(missing.includes(s), `${s} must be reported as not in source`);
    }
  });

  test('a not-in-source reason describes the MODEL, never the body', () => {
    // The whole point: absence from this dataset is not absence from anatomy.
    for (const reason of Object.values(NOT_IN_SOURCE_REASONS)) {
      assert.match(reason, /this model/i, 'the reason must talk about the model');
    }
  });

  test('every not-in-source reason carries a non-zero whole-body count', () => {
    for (const system of Object.keys(NOT_IN_SOURCE_REASONS)) {
      assert.ok(
        (WHOLE_BODY_SYSTEM_COUNTS[system] ?? 0) > 0,
        `${system} claims not-in-source but has no meshes anywhere, which would imply ` +
          `it does not exist in anatomy`,
      );
    }
  });

  test('coverageClaimsAreHonest passes for the real shoulder coverage', () => {
    const r = coverageForRegion('Shoulder', present);
    assert.deepEqual(coverageClaimsAreHonest(r), []);
  });

  test('coverageClaimsAreHonest catches a bogus not-in-source claim', () => {
    // Built directly rather than via coverageForRegion, because that function
    // only reports systems it has a count or a reason for -- an invented system
    // name never enters the report at all, so passing one in proves nothing
    // about the guard.
    const problems = coverageClaimsAreHonest({
      available: [],
      notInSource: [
        {
          system: 'unicorn',
          label: 'Shoulder',
          state: 'not-in-source',
          structuresInRegion: 0,
          systemMeshCount: 0,
          reason: 'Not present in this model.',
        },
      ],
      all: [],
    });
    assert.equal(problems.length, 1);
    assert.match(problems[0]!, /unicorn/);
    assert.match(problems[0]!, /does not exist in anatomy/);
  });

  test('a system absent everywhere is still reported honestly when it has a count', () => {
    // fascia has 4 meshes in the whole body and 0 in the shoulder. Saying it is
    // "not in this model" is correct and must not trip the guard.
    const r = coverageForRegion('Shoulder', present);
    const fascia = r.notInSource.find((c) => c.system === 'fascia');
    assert.ok(fascia, 'fascia should be reported as not in this shoulder model');
    assert.equal(fascia.systemMeshCount, 4);
    assert.deepEqual(coverageClaimsAreHonest(r), []);
  });

  test('the counts match the counts the shoulder was scoped with', () => {
    const r = coverageForRegion('Shoulder', present);
    const bone = r.available.find((c) => c.system === 'bone')!;
    const muscle = r.available.find((c) => c.system === 'muscle')!;
    assert.equal(bone.structuresInRegion, 3);
    assert.equal(muscle.structuresInRegion, 27);
  });

  test('the sentence distinguishes available from absent', () => {
    const r = coverageForRegion('Shoulder', present);
    const bone = r.available.find((c) => c.system === 'bone')!;
    const nerve = r.notInSource.find((c) => c.system === 'nerve')!;
    assert.match(coverageSentence(bone), /in this model/i);
    assert.match(coverageSentence(nerve), /not present in this model/i);
  });
});

describe('geometry fidelity guard', () => {
  test('the policy states what the source can and cannot be used for', () => {
    const p = fidelityPolicy(0.3);
    assert.ok(p.approvedFor.includes('regional anatomical localisation'));
    assert.ok(p.notApprovedFor.includes('surgical-grade anatomy'));
    assert.ok(p.notApprovedFor.includes('high-magnification inspection of origins and insertions'));
  });

  test('zoom is clamped so an extreme close-up cannot be presented', () => {
    const p = fidelityPolicy(0.3);
    assert.equal(clampDistance(p, 0.0001), p.minDistance);
    assert.equal(clampDistance(p, 0.001), p.minDistance);
  });

  test('a zoom request beyond the limit is reduced, not refused', () => {
    const p = fidelityPolicy(0.3);
    assert.equal(clampDistance(p, 10), 10, 'a distant view must still be allowed');
  });

  test('a sensible mid-range zoom passes through unchanged', () => {
    const p = fidelityPolicy(0.3);
    const mid = (p.minDistance + p.cautionDistance) / 2;
    assert.equal(clampDistance(p, mid), mid);
  });

  test('the close-inspection band is entered before the hard floor', () => {
    const p = fidelityPolicy(0.3);
    assert.equal(inCloseInspectionBand(p, p.regionRadius), false);
    assert.equal(inCloseInspectionBand(p, p.cautionDistance), true);
    assert.equal(inCloseInspectionBand(p, p.minDistance), true);
  });

  test('limits scale with the region, so a bigger region is not artificially locked', () => {
    const small = fidelityPolicy(0.1);
    const big = fidelityPolicy(1.0);
    assert.ok(big.minDistance > small.minDistance);
    assert.ok(big.minDistance / small.minDistance > 5);
  });

  test('a degenerate region radius does not produce a zero or NaN limit', () => {
    const p = fidelityPolicy(0);
    assert.ok(Number.isFinite(p.minDistance));
    assert.ok(p.minDistance > 0);
    assert.ok(Number.isFinite(clampDistance(p, 1)));
  });
});