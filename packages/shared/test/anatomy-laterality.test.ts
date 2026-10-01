import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import {
  REPRESENTATION_DECLARATIONS,
  assertSidesMatch,
  producedSides,
} from '../src/anatomy-representation.ts';
import type { Representation } from '../src/anatomy-representation.ts';
import type { AssetManifest, AssetManifestEntry } from '../src/anatomy-manifest.ts';

/**
 * The declarations are checked against the COMMITTED manifests, not against a list
 * typed into this test.
 *
 * That distinction is the whole point. `assertSidesMatch(asiId, decl, ['left','right'])`
 * would pass against a hand-written list of both sides and prove nothing at all. So
 * the evidence is read from `assets/anatomy/generated/<side>/manifest.json`: the claim
 * `sides: ['left', 'right']` can then only hold if a real right-side build is actually
 * committed, with a real right-side source mesh behind it.
 *
 * Nothing here is mirrored, sampled or inferred from a filename. If the right build
 * is ever deleted, these assertions fail rather than quietly passing on the left.
 */
// `import.meta.dirname` is `packages/shared/test`, and these manifests are
// generated output at the repo root, so the path is walked explicitly rather than
// assumed to be one level up.
const repoRoot = join(import.meta.dirname, '..', '..', '..');

function manifest(side: 'left' | 'right'): AssetManifest {
  return JSON.parse(
    readFileSync(join(repoRoot, 'assets/anatomy/generated', side, 'manifest.json'), 'utf8'),
  ) as AssetManifest;
}

const representation = (id: string): Representation => {
  const declared = REPRESENTATION_DECLARATIONS[id];
  assert.ok(declared, `${id} has no representation declaration`);
  return declared;
};

const LEFT = manifest('left');
const RIGHT = manifest('right');
const BOTH = [LEFT, RIGHT];

describe('laterality is proven by the generated manifests, not asserted', () => {
  it('both committed manifests declare the side they were built for', () => {
    // A `--side right` build that emitted `laterality: 'left'` would put right-shaped
    // anatomy on screen wearing left provenance, and nothing downstream could tell.
    for (const entry of LEFT.entries) assert.equal(entry.laterality, 'left', entry.asiId);
    for (const entry of RIGHT.entries) assert.equal(entry.laterality, 'right', entry.asiId);
  });

  it('both sides cover the same canonical structures', () => {
    assert.deepEqual(
      RIGHT.entries.map((e) => e.asiId).sort(),
      LEFT.entries.map((e) => e.asiId).sort(),
    );
  });

  it('the two sides use DIFFERENT source meshes for every structure', () => {
    const left = new Map(LEFT.entries.map((e) => [e.asiId, e.meshName]));
    for (const entry of RIGHT.entries) {
      assert.notEqual(
        left.get(entry.asiId),
        entry.meshName,
        `${entry.asiId} uses ${entry.meshName} on BOTH sides -- that is one mesh, not two`,
      );
    }
  });

  it('the two sides carry different FMA concept ids', () => {
    const left = new Map(LEFT.entries.map((e) => [e.asiId, e.fma.conceptId]));
    for (const entry of RIGHT.entries) {
      assert.notEqual(
        left.get(entry.asiId),
        entry.fma.conceptId,
        `${entry.asiId} carries FMA ${entry.fma.conceptId} on both sides`,
      );
    }
  });

  it('each side sits on its own side of the body, by centroid', () => {
    // Centroid rather than `bounds.min[0]`, because some anatomy legitimately crosses
    // the midline: trapezius-upper spans x -1.11..145.39 on the left. Asserting on a
    // min would either fail on a true case or force the test to whitelist, and a
    // whitelist is where a mirrored build would hide.
    const centre = (e: AssetManifestEntry) =>
      ((e.bounds.min[0] ?? 0) + (e.bounds.max[0] ?? 0)) / 2;
    for (const entry of LEFT.entries)
      assert.ok(centre(entry) > 0, `${entry.asiId} centroid ${centre(entry)} is not on the left`);
    for (const entry of RIGHT.entries)
      assert.ok(centre(entry) < 0, `${entry.asiId} centroid ${centre(entry)} is not on the right`);
  });

  it('the two sides are not the same file with different names', () => {
    // Cheap and strong, but deliberately NOT the whole mirror test. Byte-identity
    // would be caught here; a re-exported mirror would not.
    //
    // Two heuristics were tried here and both were dropped, which is worth recording:
    //
    //   - "identical triangle counts mean a mirror". FALSE. Three of the ten pairs DO
    //     have identical counts (acromial 198/198, supraspinatus 126/126,
    //     infraspinatus 182/182). BodyParts3D's own left and right meshes are
    //     approximate reflections -- measuring the source OBJ files finds ~75% of
    //     vertices shared after negating x -- so near-symmetry is what a CORRECT right
    //     build looks like.
    //   - "bounds that are exact reflections mean a mirror". ALSO FALSE. The
    //     deltoid spinal part is exactly mirrored to the last decimal
    //     (left 86.82..218.26, right -218.26..-86.82) while only 699 of 982 vertices
    //     are shared. Coarse bounds simply cannot see the difference.
    //
    // The test that can see it compares the loaded VERTEX SETS, and it lives in the
    // real-geometry browser gate where the GLBs are actually mounted.
    const leftBytes = new Map(
      LEFT.entries.map((e) => [e.file, readFileSync(join(repoRoot, 'assets/anatomy/generated/left', e.file))]),
    );
    for (const entry of RIGHT.entries) {
      const right = readFileSync(join(repoRoot, 'assets/anatomy/generated/right', entry.file));
      assert.notDeepEqual(
        right,
        leftBytes.get(entry.file),
        `${entry.file} is byte-identical on both sides`,
      );
    }
  });

  it('the geometry unit is millimetres on both sides', () => {
    for (const entry of [...LEFT.entries, ...RIGHT.entries]) {
      assert.equal(entry.geometry.units, 'mm', `${entry.asiId} declares ${entry.geometry.units}`);
    }
  });
});

describe('representation declarations cannot outrun what was built', () => {
  it('every available 3D declaration matches the sides actually produced', () => {
    for (const [asiId, declared] of Object.entries(REPRESENTATION_DECLARATIONS)) {
      assertSidesMatch(asiId, declared.threeD, producedSides(asiId, BOTH));
    }
  });

  it('nothing claims right unless a right build exists behind it', () => {
    // The over-claim this phase had to confront: the declarations said `['left']`
    // because only the left build existed, and widening them to `['left', 'right']`
    // without a build would have been the easy way to look finished.
    const rightBuilt = new Set(RIGHT.entries.map((e) => e.asiId));
    for (const [asiId, declared] of Object.entries(REPRESENTATION_DECLARATIONS)) {
      if (declared.threeD.status !== 'available') continue;
      if (declared.threeD.sides.includes('right'))
        assert.ok(rightBuilt.has(asiId), `${asiId} claims right with no right-side geometry`);
    }
  });

  it('a structure with one side built cannot declare both', () => {
    const leftOnly = [{ entries: [{ asiId: 'asi:shoulder.scapula', laterality: 'left' }] }];
    assert.throws(
      () =>
        assertSidesMatch(
          'asi:shoulder.scapula',
          { status: 'available', elementCount: 1, sides: ['left', 'right'] },
          producedSides('asi:shoulder.scapula', leftOnly),
        ),
      /declares 3D for left and right but the build produced only left/,
    );
  });

  it('a declaration that omits a side the build produced is also rejected', () => {
    // The under-claim direction. Real geometry on both sides with a declaration of
    // `['left']` tells a reader the right shoulder is unavailable when it is not.
    assert.throws(
      () =>
        assertSidesMatch(
          'asi:shoulder.scapula',
          { status: 'available', elementCount: 1, sides: ['left'] },
          ['left', 'right'],
        ),
      /has real geometry for right but declares only left/,
    );
  });

  it('unavailable concepts stay unavailable however many sides exist nearby', () => {
    // Neighbouring anatomy having geometry is not evidence about a concept we have
    // no source mesh for. The composite deltoid is the case that matters: all three
    // parts exist on both sides and the composite still has no source mesh.
    for (const [asiId, declared] of Object.entries(REPRESENTATION_DECLARATIONS)) {
      if (declared.threeD.status !== 'unavailable') continue;
      assert.equal(
        producedSides(asiId, BOTH).length,
        0,
        `${asiId} is declared unavailable but geometry exists for it`,
      );
    }
assert.equal(representation('asi:shoulder.deltoid').threeD.status, 'unavailable');
    for (const part of ['clavicular', 'acromial', 'spinal']) {
      const declared = representation(`asi:shoulder.deltoid-${part}-part`).threeD;
      assert.equal(declared.status, 'available');
      assert.deepEqual(
        declared.status === 'available' ? declared.sides : null,
        ['left', 'right'],
        `the ${part} part is available on both sides`,
      );
    }
  });

  it('an unavailable declaration is never side-checked into availability', () => {
    // The guard returns early for unavailable, so an absent side cannot be read as a
    // permission slip.
    assert.doesNotThrow(() =>
      assertSidesMatch('asi:shoulder.deltoid', representation('asi:shoulder.deltoid').threeD, []),
    );
  });
});