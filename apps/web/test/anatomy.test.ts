import { test } from 'node:test';
import assert from 'node:assert/strict';
import { REGIONS, TISSUE_LAYER_ORDER } from '@asi/shared';
import type { BodyRegion, Structure, SubRegion, TissueLayer } from '@asi/shared';
import { FIXTURE_MANIFEST, buildFixtureManifest } from '../src/anatomy/fixture-manifest.ts';
import {
  ManifestError,
  assertNonMedical,
  entriesFor,
  indexManifest,
  verifyAgainstOntology,
} from '../src/anatomy/manifest.ts';
import type { AnatomyManifest } from '../src/anatomy/manifest.ts';
import { CAMERA_PRESETS, Three3dAnatomyAdapter, layersForDepth, sortLayers } from '../src/anatomy/three3d.ts';
import { Svg2dAnatomyAdapter, REGION_DEFAULT_VIEW } from '../src/anatomy/svg2d.ts';
import {
  ZONES,
  VIEW_H,
  VIEW_W,
  bodyToUser,
  clientToBody,
  firstViewFor,
  mirrorPath,
  nearestZone,
  silhouetteFor,
  zonesForRegionView,
} from '../src/anatomy/svg-geometry.ts';
import type { ViewName } from '../src/anatomy/types.ts';

const VIEWS: ViewName[] = ['anterior', 'posterior', 'lateral_left', 'lateral_right'];
const REGION_IDS = Object.keys(REGIONS) as BodyRegion[];

const allSubRegions = (): SubRegion[] =>
  REGION_IDS.flatMap((id) => REGIONS[id].subRegions);
const allStructures = (): Structure[] =>
  allSubRegions().flatMap((sub) => sub.structures);

/* ---------------- manifest / mesh mapping ---------------- */

test('the fixture manifest is self-declaring and non-medical', () => {
  assert.equal(FIXTURE_MANIFEST.source, 'fixture');
  assert.match(FIXTURE_MANIFEST.disclaimer ?? '', /not anatomy/i);
  // Must not throw: a fixture that cannot prove it is a fixture is rejected.
  assert.doesNotThrow(() => assertNonMedical(FIXTURE_MANIFEST));
});

test('a fixture may not reference external assets', () => {
  const smuggled: AnatomyManifest = {
    ...FIXTURE_MANIFEST,
    entries: [
      {
        ...FIXTURE_MANIFEST.entries[0]!,
        geometry: { type: 'url', url: '/real/body.glb' },
      },
    ],
  };
  assert.throws(() => assertNonMedical(smuggled), ManifestError);
});

test('a fixture without a disclaimer is rejected', () => {
  const { disclaimer: _drop, ...rest } = FIXTURE_MANIFEST;
  assert.throws(() => assertNonMedical(rest as AnatomyManifest), ManifestError);
});

test('the manifest indexes one entry per asiId and rejects duplicates', () => {
  const index = indexManifest(FIXTURE_MANIFEST);
  assert.equal(index.size, FIXTURE_MANIFEST.entries.length);
  for (const entry of FIXTURE_MANIFEST.entries) assert.ok(index.has(entry.asiId));
  const duplicated: AnatomyManifest = {
    ...FIXTURE_MANIFEST,
    entries: [FIXTURE_MANIFEST.entries[0]!, FIXTURE_MANIFEST.entries[0]!],
  };
  assert.throws(() => indexManifest(duplicated), ManifestError);
});

test('every asiId is stable, namespaced and free of engine handles', () => {
  for (const entry of FIXTURE_MANIFEST.entries) {
    assert.match(entry.asiId, /^fixture:(sub|struct):/, `not namespaced: ${entry.asiId}`);
    // A three.js UUID or object hash must never appear as a business id.
    assert.doesNotMatch(entry.asiId, /[0-9a-f]{8}-[0-9a-f]{4}/i);
    assert.doesNotMatch(entry.asiId, /^Object\d/);
  }
});

test('structure entries bind to real domain structure ids', () => {
  const known = new Set(allStructures().map((s) => s.id));
  const bound = FIXTURE_MANIFEST.entries.filter((e) => e.kind === 'structure');
  assert.ok(bound.length > 0, 'fixture must exercise the structure path');
  for (const entry of bound) {
    assert.ok(entry.structureId, 'structure entry needs a structureId');
    assert.ok(known.has(entry.structureId), `unknown structure ${entry.structureId}`);
  }
  assert.doesNotThrow(() => verifyAgainstOntology(FIXTURE_MANIFEST, allSubRegions(), allStructures()));
});

test('the manifest cannot claim anatomy the ontology does not define', () => {
  const bogus: AnatomyManifest = {
    ...FIXTURE_MANIFEST,
    entries: [
      {
        ...FIXTURE_MANIFEST.entries[0]!,
        kind: 'structure',
        structureId: 'asi:shoulder.does-not-exist',
        asiId: 'fixture:struct:bogus',
      },
    ],
  };
  assert.throws(() => verifyAgainstOntology(bogus, allSubRegions(), allStructures()), ManifestError);
});

test('every sub-region in the ontology has geometry, in at least one view', () => {
  const covered = new Set(
    FIXTURE_MANIFEST.entries.map((e) => e.subRegionId).filter(Boolean),
  );
  for (const sub of allSubRegions())
    assert.ok(covered.has(sub.id), `no fixture geometry for ${sub.id}`);
  for (const sub of allSubRegions())
    assert.ok(firstViewFor(sub.id), `${sub.id} is undrawable on every view`);
});

test('entries are filtered by region, view and layer', () => {
  const shoulder = entriesFor(FIXTURE_MANIFEST, 'shoulder', 'anterior');
  assert.ok(shoulder.length > 0);
  assert.ok(shoulder.every((e) => e.region === 'shoulder'));
  assert.ok(shoulder.every((e) => e.views.includes('anterior')));
  const deepOnly = entriesFor(FIXTURE_MANIFEST, 'shoulder', 'anterior', (l) => l === 'bone');
  assert.ok(deepOnly.every((e) => e.layer === 'bone'));
});

test('several tissue layers are represented, so depth is observable', () => {
  const layers = new Set(
    FIXTURE_MANIFEST.entries.filter((e) => e.kind === 'structure').map((e) => e.layer),
  );
  assert.ok(layers.size >= 4, `only ${layers.size} layers in the fixture`);
  for (const required of ['muscle', 'tendon', 'bone'] as TissueLayer[])
    assert.ok(layers.has(required), `missing layer ${required}`);
});

/* ---------------- depth ---------------- */

test('depth changes layer visibility and never names a tissue', () => {
  assert.deepEqual(layersForDepth('superficial'), ['skin', 'subcutaneous', 'fascia']);
  assert.deepEqual(layersForDepth('intermediate'), [
    'subcutaneous',
    'fascia',
    'muscle',
    'tendon',
  ]);
  assert.ok(layersForDepth('deep').includes('bone'));
  // Deeper means more layers, never a different set of semantics.
  assert.ok(layersForDepth('superficial').length < layersForDepth('intermediate').length);
  assert.ok(layersForDepth('intermediate').length < layersForDepth('deep').length);
  // "Not sure" shows everything rather than guessing a depth.
  assert.deepEqual(layersForDepth('unknown'), [...TISSUE_LAYER_ORDER]);
  for (const depth of ['superficial', 'intermediate', 'deep'] as const)
    for (const layer of layersForDepth(depth)) assert.ok(TISSUE_LAYER_ORDER.includes(layer));
});

test('layers are ordered superficial to deep', () => {
  const sorted = sortLayers(['bone', 'skin', 'muscle', 'nerve']);
  assert.deepEqual(sorted, ['skin', 'muscle', 'bone', 'nerve']);
});

/* ---------------- 3D adapter, without a GPU ---------------- */

test('the adapter refuses a fixture that cannot declare itself', () => {
  const { disclaimer: _drop, ...rest } = FIXTURE_MANIFEST;
  assert.throws(
    () => new Three3dAnatomyAdapter({ manifest: rest as AnatomyManifest }),
    ManifestError,
  );
});

test('mount failure is a rejected promise, not a thrown blank canvas', async () => {
  const adapter = new Three3dAnatomyAdapter({
    manifest: FIXTURE_MANIFEST,
    failMount: true,
  });
  await assert.rejects(() => adapter.mount({} as HTMLElement), /mount failed/);
  assert.equal(adapter.isLive(), false);
  // dispose must be safe on a viewer that never mounted.
  assert.doesNotThrow(() => adapter.dispose());
});

test('adapter state follows the same command semantics as the 2D map', () => {
  const adapter = new Three3dAnatomyAdapter({ manifest: FIXTURE_MANIFEST });
  adapter.apply({ type: 'focusRegion', region: 'knee' });
  assert.equal(adapter.getState().region, 'knee');
  assert.equal(adapter.getView(), REGION_DEFAULT_VIEW.knee);
  adapter.apply({ type: 'highlight', structureIds: ['asi:knee.patella'], as: 'candidate' });
  assert.deepEqual(adapter.getState().highlightedStructureIds, ['asi:knee.patella']);
  adapter.apply({ type: 'highlight', structureIds: ['asi:knee.patella'], as: 'selected' });
  assert.deepEqual(adapter.getState().selectedStructureIds, ['asi:knee.patella']);
  assert.deepEqual(adapter.getState().highlightedStructureIds, []);
  adapter.apply({ type: 'setDepth', depth: 'superficial' });
  assert.deepEqual(adapter.getState().visibleLayers, ['skin', 'subcutaneous', 'fascia']);
  adapter.apply({ type: 'dropPin', point: { x: 0.4, y: 0.6 } });
  assert.deepEqual(adapter.getState().activePin, { x: 0.4, y: 0.6 });
});

test('rejection is presentation only and never withdraws a selection', () => {
  const adapter = new Three3dAnatomyAdapter({ manifest: FIXTURE_MANIFEST });
  adapter.apply({ type: 'highlight', structureIds: ['asi:shoulder.deltoid'], as: 'selected' });
  adapter.apply({ type: 'reject', structureIds: ['asi:shoulder.deltoid'] });
  assert.deepEqual(adapter.getState().rejectedStructureIds, ['asi:shoulder.deltoid']);
  // The canonical authority is location.userSelectedStructureIds. A rejection is
  // a visual "not that one" and must not silently unselect something the record
  // still says the user pointed at — only setSelected may change this set.
  assert.deepEqual(adapter.getState().selectedStructureIds, ['asi:shoulder.deltoid']);
  // A rejected structure still leaves the pickable set until it is cleared.
  assert.equal(
    adapter.pickableStructures().some((s) => s.id === 'asi:shoulder.deltoid'),
    false,
  );
  adapter.apply({ type: 'clearReject', structureIds: ['asi:shoulder.deltoid'] });
  assert.deepEqual(adapter.getState().rejectedStructureIds, []);
  assert.deepEqual(adapter.getState().selectedStructureIds, ['asi:shoulder.deltoid']);
});

test('a candidate highlight never withdraws a selection either', () => {
  const adapter = new Three3dAnatomyAdapter({ manifest: FIXTURE_MANIFEST });
  adapter.apply({ type: 'setSelected', structureIds: ['asi:shoulder.deltoid'] });
  // Re-running localisation replaces the candidate list. That must not reach
  // into the canonical selection projection.
  adapter.apply({ type: 'setHighlighted', structureIds: ['asi:shoulder.acromion'] });
  assert.deepEqual(adapter.getState().selectedStructureIds, ['asi:shoulder.deltoid']);
  assert.deepEqual(adapter.getState().highlightedStructureIds, ['asi:shoulder.acromion']);
});

test('a rejected structure is not pickable until the rejection is cleared', () => {
  const two = new Svg2dAnatomyAdapter();
  two.apply({ type: 'highlight', structureIds: ['asi:shoulder.acromion'], as: 'candidate' });
  const before = two.pickableStructures().length;
  two.apply({ type: 'reject', structureIds: ['asi:shoulder.acromion'] });
  const after = two.pickableStructures().length;
  assert.equal(after, before - 1);
  two.apply({ type: 'clearReject', structureIds: ['asi:shoulder.acromion'] });
  assert.equal(two.pickableStructures().length, before);
});

test('camera presets are four distinct stations', () => {
  const positions = VIEWS.map((v) => CAMERA_PRESETS[v].position.join(','));
  assert.equal(new Set(positions).size, 4, 'presets must not share a camera position');
  for (const view of VIEWS) {
    const station = CAMERA_PRESETS[view];
    assert.ok(station.position.some((n) => n !== 0), `${view} is inside the figure`);
  }
  // Anterior and posterior must be on opposite sides of the body.
  assert.ok(CAMERA_PRESETS.anterior.position[2] * CAMERA_PRESETS.posterior.position[2] < 0);
  assert.ok(CAMERA_PRESETS.lateral_left.position[0] * CAMERA_PRESETS.lateral_right.position[0] < 0);
});

test('the keyboard path offers asiIds without a canvas', () => {
  const adapter = new Three3dAnatomyAdapter({ manifest: FIXTURE_MANIFEST });
  adapter.apply({ type: 'focusRegion', region: 'shoulder' });
  const order = adapter.keyboardOrder();
  assert.ok(order.length > 0);
  assert.ok(order.every((id) => typeof id === 'string' && id.startsWith('fixture:')));
  assert.equal(new Set(order).size, order.length, 'keyboard order must be stable and unique');
  // A rejected structure must not be offered again by accident.
  const someStructure = FIXTURE_MANIFEST.entries.find((e) => e.structureId === 'asi:shoulder.deltoid');
  if (someStructure) {
    adapter.apply({ type: 'reject', structureIds: ['asi:shoulder.deltoid'] });
    assert.equal(adapter.keyboardOrder().includes(someStructure.asiId), false);
  }
});

test('subscribers are notified and released', () => {
  const adapter = new Three3dAnatomyAdapter({ manifest: FIXTURE_MANIFEST });
  let seen = 0;
  const off = adapter.subscribe(() => {
    seen += 1;
  });
  adapter.apply({ type: 'focusRegion', region: 'neck' });
  assert.equal(seen, 1);
  off();
  adapter.apply({ type: 'focusRegion', region: 'knee' });
  assert.equal(seen, 1, 'unsubscribe must actually detach');
});

test('a disposed 3D adapter cannot be remounted', async () => {
  const adapter = new Three3dAnatomyAdapter({ manifest: FIXTURE_MANIFEST });
  adapter.dispose();
  assert.equal(adapter.isLive(), false);
  await assert.rejects(() => adapter.mount({} as HTMLElement), /disposed/);
});

test('resize and pick are safe before mount', () => {
  const adapter = new Three3dAnatomyAdapter({ manifest: FIXTURE_MANIFEST });
  assert.doesNotThrow(() => adapter.resize(100, 100));
  assert.deepEqual(adapter.pick(10, 10), { kind: 'none' });
  assert.equal(adapter.projectPin({ x: 0.5, y: 0.5 }), null);
});

/* ---------------- 2D geometry ---------------- */

test('each view has its own silhouette', () => {
  const anterior = JSON.stringify(silhouetteFor('anterior'));
  const posterior = JSON.stringify(silhouetteFor('posterior'));
  const lateral = JSON.stringify(silhouetteFor('lateral_left'));
  const right = JSON.stringify(silhouetteFor('lateral_right'));
  assert.notEqual(anterior, lateral, 'a profile must not be the front view');
  assert.notEqual(lateral, right, 'the two profiles must be mirrored, not identical');
  // Back marks make the back view more than a copy of the front.
  assert.ok(('spine' in silhouetteFor('posterior')));
});

test('mirroring flips x only', () => {
  // Pairs are (x y); y must survive untouched or the figure turns inside out.
  assert.equal(mirrorPath('M 10 20 L 30 40'), 'M 90 20 L 70 40');
  assert.equal(mirrorPath('M 50 6 C 60 6 66 16 66 26'), 'M 50 6 C 40 6 34 16 34 26');
});

test('zones never overlap inside a single view', () => {
  for (const view of VIEWS) {
    const drawn = zonesForRegionView('shoulder', view).concat(
      ...REGION_IDS.filter((r) => r !== 'shoulder').map((r) => zonesForRegionView(r, view)),
    );
    for (let i = 0; i < drawn.length; i += 1) {
      for (let j = i + 1; j < drawn.length; j += 1) {
        const a = drawn[i]!;
        const b = drawn[j]!;
        if (a.subRegionId === b.subRegionId) continue;
        const ca = a.centroids[view];
        const cb = b.centroids[view];
        if (!ca || !cb) continue;
        // Centroids closer than this would make one zone steal the other's taps.
        const distance = Math.hypot(ca[0] - cb[0], ca[1] - cb[1]);
        assert.ok(
          distance >= 4,
          `${a.subRegionId} and ${b.subRegionId} are ${distance.toFixed(1)}u apart in ${view}`,
        );
      }
    }
  }
});

test('every zone centroid sits inside the drawing', () => {
  for (const zone of ZONES) {
    for (const [view, centroid] of Object.entries(zone.centroids)) {
      assert.ok(centroid, `${zone.subRegionId} ${view}`);
      const [x, y] = centroid!;
      assert.ok(x > 0 && x < VIEW_W, `${zone.subRegionId} centroid x off the body`);
      assert.ok(y > 0 && y < VIEW_H, `${zone.subRegionId} centroid y off the body`);
    }
  }
});

test('a tap resolves to the nearest zone, so small zones stay tappable', () => {
  // Aim at the knee centroid with a sloppy thumb offset and still land on it.
  const zone = ZONES.find((z) => z.subRegionId === 'knee.anterior')!;
  const [cx, cy] = zone.centroids.anterior!;
  const sloppy = { x: (cx + 3) / VIEW_W, y: (cy - 2) / VIEW_H };
  assert.equal(nearestZone(sloppy, 'knee', 'anterior', 'left')?.subRegionId, 'knee.anterior');
  // A tap in empty space selects nothing rather than guessing.
  assert.equal(nearestZone({ x: 0.5, y: 0.06 }, 'knee', 'anterior', 'left'), null);
});

test('side mirrors the map, so the same body point means the other side', () => {
  // Zones are authored on the figure's left (x~70) and mirrored for the right,
  // so the same sub-region lives at mirrored x depending on the chosen side.
  const authored = zonesForRegionView('shoulder', 'anterior').find(
    (z) => z.subRegionId === 'shoulder.lateral',
  )!;
  const [cx, cy] = authored.centroids.anterior!;
  const left = nearestZone({ x: cx / VIEW_W, y: cy / VIEW_H }, 'shoulder', 'anterior', 'left');
  const right = nearestZone(
    { x: (VIEW_W - cx) / VIEW_W, y: cy / VIEW_H },
    'shoulder',
    'anterior',
    'right',
  );
  assert.equal(left?.subRegionId, 'shoulder.lateral');
  assert.equal(right?.subRegionId, 'shoulder.lateral');
  // The mirrored side must not also answer on the un-mirrored side.
  assert.equal(
    nearestZone({ x: cx / VIEW_W, y: cy / VIEW_H }, 'shoulder', 'anterior', 'right'),
    null,
  );
});

test('pointer coordinates round-trip through the same box the pin uses', () => {
  const rect = { left: 100, top: 50, width: 400, height: 720 };
  const centre = clientToBody(300, 410, rect);
  assert.equal(centre.x, 0.5);
  assert.equal(Number(centre.y.toFixed(3)), 0.5);
  const [ux, uy] = bodyToUser(centre);
  assert.equal(ux, VIEW_W / 2);
  assert.equal(uy, VIEW_H / 2);
  // A zero-size rect must not divide by zero.
  assert.deepEqual(clientToBody(1, 1, { left: 0, top: 0, width: 0, height: 0 }), {
    x: 0.5,
    y: 0.5,
  });
});

test('the 2D adapter only offers the focused region', () => {
  const adapter = new Svg2dAnatomyAdapter();
  adapter.apply({ type: 'focusRegion', region: 'shoulder' });
  const zones = adapter.zones();
  assert.ok(zones.length > 0);
  assert.ok(zones.every((z) => z.subRegionId.startsWith('shoulder.')));
  adapter.apply({ type: 'focusRegion', region: 'lower_back' });
  assert.ok(adapter.zones().every((z) => z.subRegionId.startsWith('lower_back.')));
});

test('the 2D adapter finds a view that can draw any sub-region', () => {
  const adapter = new Svg2dAnatomyAdapter();
  for (const region of REGION_IDS)
    for (const sub of REGIONS[region].subRegions) {
      const view = adapter.viewForSubRegion(sub.id);
      assert.ok(view, `${sub.id} has no drawable view`);
      assert.ok(
        zonesForRegionView(region, view!).some((z) => z.subRegionId === sub.id),
        `${sub.id} claims view ${view} but is not drawn there`,
      );
    }
});

test('buildFixtureManifest is deterministic', () => {
  assert.deepEqual(buildFixtureManifest(), buildFixtureManifest());
});
