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

function manifest(region: string, side: 'left' | 'right'): AssetManifest {
  return JSON.parse(
    readFileSync(join(repoRoot, 'assets/anatomy/generated', region, side, 'manifest.json'), 'utf8'),
  ) as AssetManifest;
}

const representation = (id: string): Representation => {
  const declared = REPRESENTATION_DECLARATIONS[id];
  assert.ok(declared, `${id} has no representation declaration`);
  return declared;
};

/** Every generated manifest, so a new region is covered by writing it once here. */
const BUILDS = ['shoulder', 'neck'].flatMap((region) =>
  (['left', 'right'] as const).map((side) => ({ region, side, manifest: manifest(region, side) })),
);
// EVERY generated manifest, shoulder and neck alike. `producedSides` reads this, so a
// region added to BUILDS is checked automatically rather than needing its own
// assertions -- and, just as importantly, cannot be declared available without the
// corresponding manifest actually containing the entry.
const BOTH = BUILDS.map((b) => b.manifest);
const LEFT = manifest('shoulder', 'left');
const RIGHT = manifest('shoulder', 'right');

describe('every generated build, across every region', () => {
  it('declares a laterality this build is allowed to carry, in millimetres', () => {
    // A build is NOT one laterality. A left neck scene carries left structures AND the
    // midline cervical spine as context; requiring every entry to equal --side was
    // correct while no midline geometry existed and wrong the moment it did.
    //
    // What must hold: an entry is either this build's side or midline, and NEVER the
    // other side. The second half is the one that catches a real error.
    for (const { region, side, manifest: m } of BUILDS) {
      for (const entry of m.entries) {
        assert.ok(
          entry.laterality === side || entry.laterality === 'midline',
          `${region}/${side}: ${entry.asiId} is ${entry.laterality}, which this build may not carry`,
        );
        assert.equal(entry.geometry.units, 'mm', `${region}/${side}: ${entry.asiId} units`);
        assert.equal(entry.region, region, `${entry.asiId} built under ${region} says ${entry.region}`);
      }
    }
    assert.ok(BUILDS.length >= 4, 'expected at least two regions x two sides');
  });

  it('uses a different source mesh on each side of every region', () => {
    for (const region of new Set(BUILDS.map((b) => b.region))) {
      // Midline excluded, for the same reason: the vertebrae are legitimately the same
      // meshes in both builds, and requiring them to differ would force the exact
      // duplication the laterality work exists to prevent.
      const oneSided = (m: AssetManifest) => m.entries.filter((e) => e.laterality !== 'midline');
      // Compare the RESOLVED mesh set, not `meshName`: a composite has no single
      // `meshName` (it is null on both sides), so comparing that field would compare
      // null with null and report every composite as "sharing a mesh" -- a failure that
      // looks like a real collision and is nothing of the kind.
      const meshesOf = (e: AssetManifestEntry): string[] =>
        e.composite ? e.composite.components.map((c) => c.meshName) : [e.meshName!];
      const left = new Map(
        oneSided(BUILDS.find((b) => b.region === region && b.side === 'left')!.manifest).map((e) => [
          e.asiId,
          meshesOf(e),
        ]),
      );
      for (const entry of oneSided(
        BUILDS.find((b) => b.region === region && b.side === 'right')!.manifest,
      )) {
        const shared = meshesOf(entry).filter((m) => left.get(entry.asiId)?.includes(m));
        assert.deepEqual(
          shared,
          [],
          `${region}: ${entry.asiId} shares source mesh(es) ${shared.join(', ')} between sides`,
        );
      }
    }
  });

  it('no build claims a structure another build also claims for the same side', () => {
    // A mesh cannot serve two canonical ids. If a region ever binds the same
    // source mesh twice, picking would be ambiguous.
    for (const { region, side, manifest: m } of BUILDS) {
      const meshes = m.entries.flatMap((e) =>
        e.composite ? e.composite.components.map((c) => c.meshName) : [e.meshName!],
      );
      assert.equal(
        new Set(meshes).size,
        meshes.length,
        `${region}/${side} reuses a mesh across canonical ids`,
      );
    }
  });
});

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

  it('the two sides use DIFFERENT source meshes for every one-sided structure', () => {
    // Midline entries are EXCLUDED and that is the correct expectation, not a
    // convenience: the cervical vertebrae are the same seven meshes in the left and the
    // right scene, because there is one cervical spine. Duplicating them per side is
    // what "one left copy of the midline" means, and the rule below would have caught it
    // as if it were a bug.
    const oneSided = (m: AssetManifest): AssetManifestEntry[] =>
      m.entries.filter((e) => e.laterality !== 'midline');

    const left = new Map(LEFT.entries.map((e) => [e.asiId, e.meshName]));
    for (const entry of RIGHT.entries) {
      assert.notEqual(
        left.get(entry.asiId),
        entry.meshName,
        `${entry.asiId} uses ${entry.meshName} on BOTH sides -- that is one mesh, not two`,
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
    // A side's own file PATH is side-independent -- `asi-<id>.glb` exists in both the
    // left and the right build directory. So the paths matching is expected and means
    // nothing; what must differ is the CONTENT, because the two sides load different
    // source meshes. Comparing paths here would have "proven" the two sides are
    // different on the first run and then told us nothing.
    const filesOf = (e: AssetManifestEntry): string[] =>
      e.composite ? e.composite.components.map((c) => c.file) : e.file ? [e.file] : [];
    for (const { region, side, manifest: m } of BUILDS) {
      const other = side === 'left' ? 'right' : 'left';
      const otherManifest = BUILDS.find((b) => b.region === region && b.side === other)!.manifest;
      const otherByAsi = new Map(otherManifest.entries.map((e) => [e.asiId, e]));
      for (const entry of m.entries) {
        const counterpart = otherByAsi.get(entry.asiId);
        // A midline entry is the SAME geometry in both builds by definition.
        if (!counterpart || entry.laterality === 'midline') continue;
        const mine = filesOf(entry).map((f) =>
          readFileSync(join(repoRoot, 'assets/anatomy/generated', region, side, f)),
        );
        const theirs = filesOf(counterpart).map((f) =>
          readFileSync(join(repoRoot, 'assets/anatomy/generated', region, other, f)),
        );
        for (const bytes of mine)
          for (const other2 of theirs)
            assert.notDeepEqual(
              bytes,
              other2,
              `${region}: ${entry.asiId} is byte-identical on the ${side} and ${other} builds`,
            );
      }
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
    const rightBuilt = new Set(
      BUILDS.filter((b) => b.side === 'right').flatMap((b) => b.manifest.entries.map((e) => e.asiId)),
    );
    for (const [asiId, declared] of Object.entries(REPRESENTATION_DECLARATIONS)) {
      if (declared.threeD.status !== 'available') continue;
      if (declared.threeD.sides.right?.available)
        assert.ok(rightBuilt.has(asiId), `${asiId} claims right with no right-side geometry`);
    }
  });

  it('a structure with one side built cannot declare both', () => {
    const leftOnly = [{ entries: [{ asiId: 'asi:shoulder.scapula', laterality: 'left' }] }];
    assert.throws(
      () =>
        assertSidesMatch(
          'asi:shoulder.scapula',
          {
            status: 'available',
            sides: {
              left: { available: true, componentCount: 1 },
              right: { available: true, componentCount: 1 },
            },
          },
          producedSides('asi:shoulder.scapula', leftOnly),
        ),
      /no (left|right) build contains it/,
    );
  });

  it('a declaration that omits a side the build produced is also rejected', () => {
    // The under-claim direction. Real geometry on both sides with a declaration of
    // `['left']` tells a reader the right shoulder is unavailable when it is not.
    assert.throws(
      () =>
        assertSidesMatch(
          'asi:shoulder.scapula',
          { status: 'available', sides: { left: { available: true, componentCount: 1 } } },
          [
            { laterality: 'left', componentCount: 1 },
            { laterality: 'right', componentCount: 1 },
          ],
        ),
      /has real right geometry but the declaration does not mention right/,
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
      if (declared.status !== 'available') continue;
      // Per-laterality now, so the assertion names the sides rather than comparing a
      // whole record against an array.
      assert.deepEqual(
        Object.entries(declared.sides)
          .filter(([, c]) => c.available)
          .map(([side]) => side)
          .sort(),
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