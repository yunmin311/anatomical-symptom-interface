/**
 * TEST / DEV-ONLY FIXTURE MANIFEST. NOT ANATOMY.
 *
 * Every mesh below is a procedural primitive — a box, a sphere, a cylinder, a
 * capsule — positioned roughly where a region sits on a standing figure so that
 * camera presets, picking, layer visibility and highlight state can be exercised
 * against a real renderer. Nothing here is a model of a body, and the shapes
 * are not anatomically shaped, proportioned or labelled as though they were.
 *
 * Its only job is to prove the renderer contract before the real BodyParts3D
 * asset pipeline exists. `assertNonMedical` refuses to let this be used as if
 * it were an anatomy source, and the UI must surface `disclaimer` whenever this
 * manifest is the active source.
 *
 * When the real pipeline lands, add a manifest with `source: 'bodyparts3d'`
 * and `geometry.type: 'url'`. No renderer code changes: the manifest is the only
 * thing that knows how an `asiId` relates to geometry.
 *
 * Coordinate space: y is up, origin at the figure's centre, roughly 1.8 units
 * tall. +z is anterior (front), -z is posterior (back), +x is the figure's left
 * as seen from the front, which is mirrored in the lateral presets.
 */
import { REGIONS, TISSUE_LAYER_ORDER } from '@asi/shared';
import type { BodyRegion, Structure, SubRegion, TissueLayer } from '@asi/shared';
import type { AnatomyManifest, ManifestEntry } from './manifest.ts';
import type { CameraPreset } from './types.ts';

export const FIXTURE_DISCLAIMER =
  'Development fixture: schematic placeholder volumes, not anatomy. No structure shown here is a medical claim.';

const ALL_VIEWS: CameraPreset[] = ['anterior', 'posterior', 'lateral_left', 'lateral_right'];

/** Figure landmarks, in manifest units. */
const Y = {
  head: 0.74,
  neckTop: 0.6,
  shoulder: 0.46,
  chest: 0.28,
  waist: 0.02,
  lowerBack: -0.12,
  hip: -0.28,
  knee: -0.56,
  ankle: -0.84,
} as const;

type Primitive = {
  type: 'primitive';
  shape: 'box' | 'sphere' | 'cylinder' | 'capsule';
  position: [number, number, number];
  scale: [number, number, number];
  rotation?: [number, number, number];
};

const box = (
  position: [number, number, number],
  scale: [number, number, number],
  rotation?: [number, number, number],
): Primitive => ({ type: 'primitive', shape: 'box', position, scale, rotation });
const sphere = (position: [number, number, number], scale: [number, number, number]): Primitive => ({
  type: 'primitive',
  shape: 'sphere',
  position,
  scale,
});
const capsule = (
  position: [number, number, number],
  scale: [number, number, number],
): Primitive => ({ type: 'primitive', shape: 'capsule', position, scale });

/**
 * Where each region's sub-areas sit on the fixture figure, per view. These are
 * deliberately crude bounding volumes: the point is that every sub-region has
 * reachable, non-overlapping geometry in every view that claims it, so picking
 * and camera work can be tested without an anatomy asset.
 *
 * `focusPoint` is normalised 0..1 with y down, matching the 2D map, so the same
 * sub-region can be cross-referenced between the two viewers.
 */
const SUBREGION_PROXIES: Record<
  string,
  { geometry: Primitive; views: CameraPreset[]; focusPoint: [number, number] }[]
> = {
  'shoulder.anterior': [
    {
      geometry: box([-0.17, Y.shoulder, 0.1], [0.15, 0.15, 0.09]),
      views: ['anterior', 'lateral_left', 'lateral_right'],
      focusPoint: [0.33, 0.36],
    },
    {
      geometry: box([0.17, Y.shoulder, 0.1], [0.15, 0.15, 0.09]),
      views: ['anterior', 'lateral_left', 'lateral_right'],
      focusPoint: [0.67, 0.36],
    },
  ],
  'shoulder.lateral': [
    {
      geometry: sphere([-0.26, Y.shoulder, 0.0], [0.09, 0.09, 0.1]),
      views: ['anterior', 'posterior', 'lateral_left', 'lateral_right'],
      focusPoint: [0.26, 0.37],
    },
    {
      geometry: sphere([0.26, Y.shoulder, 0.0], [0.09, 0.09, 0.1]),
      views: ['anterior', 'posterior', 'lateral_left', 'lateral_right'],
      focusPoint: [0.74, 0.37],
    },
  ],
  'shoulder.posterior': [
    {
      geometry: box([-0.17, Y.shoulder, -0.1], [0.16, 0.16, 0.08]),
      views: ['posterior', 'lateral_left', 'lateral_right'],
      focusPoint: [0.33, 0.4],
    },
    {
      geometry: box([0.17, Y.shoulder, -0.1], [0.16, 0.16, 0.08]),
      views: ['posterior', 'lateral_left', 'lateral_right'],
      focusPoint: [0.67, 0.4],
    },
  ],
  'neck.anterior': [
    {
      geometry: capsule([0, Y.neckTop - 0.03, 0.05], [0.07, 0.08, 0.07]),
      views: ['anterior', 'lateral_left', 'lateral_right'],
      focusPoint: [0.5, 0.3],
    },
  ],
  'neck.lateral': [
    {
      geometry: capsule([-0.08, Y.neckTop - 0.03, 0.0], [0.05, 0.08, 0.06]),
      views: ['anterior', 'posterior', 'lateral_left', 'lateral_right'],
      focusPoint: [0.42, 0.31],
    },
    {
      geometry: capsule([0.08, Y.neckTop - 0.03, 0.0], [0.05, 0.08, 0.06]),
      views: ['anterior', 'posterior', 'lateral_left', 'lateral_right'],
      focusPoint: [0.58, 0.31],
    },
  ],
  'neck.posterior': [
    {
      geometry: capsule([0, Y.neckTop - 0.03, -0.06], [0.08, 0.08, 0.06]),
      views: ['posterior', 'lateral_left', 'lateral_right'],
      focusPoint: [0.5, 0.33],
    },
  ],
  'lower_back.central': [
    {
      geometry: box([0, Y.lowerBack, -0.09], [0.09, 0.16, 0.08]),
      views: ['posterior', 'lateral_left', 'lateral_right'],
      focusPoint: [0.5, 0.65],
    },
  ],
  'lower_back.left_paravertebral': [
    {
      geometry: box([-0.12, Y.lowerBack, -0.08], [0.09, 0.16, 0.08]),
      views: ['posterior', 'lateral_left'],
      focusPoint: [0.44, 0.66],
    },
  ],
  'lower_back.right_paravertebral': [
    {
      geometry: box([0.12, Y.lowerBack, -0.08], [0.09, 0.16, 0.08]),
      views: ['posterior', 'lateral_right'],
      focusPoint: [0.56, 0.66],
    },
  ],
  'lower_back.sacrococcygeal': [
    {
      geometry: box([0, Y.hip + 0.04, -0.1], [0.11, 0.09, 0.08]),
      views: ['posterior', 'lateral_left', 'lateral_right'],
      focusPoint: [0.5, 0.74],
    },
  ],
  'knee.anterior': [
    {
      geometry: sphere([-0.1, Y.knee, 0.07], [0.08, 0.08, 0.07]),
      views: ['anterior', 'lateral_left', 'lateral_right'],
      focusPoint: [0.43, 0.85],
    },
    {
      geometry: sphere([0.1, Y.knee, 0.07], [0.08, 0.08, 0.07]),
      views: ['anterior', 'lateral_left', 'lateral_right'],
      focusPoint: [0.57, 0.85],
    },
  ],
  'knee.medial': [
    {
      geometry: box([-0.02, Y.knee, 0.02], [0.05, 0.08, 0.06]),
      views: ['anterior', 'lateral_left', 'lateral_right'],
      focusPoint: [0.48, 0.85],
    },
  ],
  'knee.lateral': [
    {
      geometry: box([-0.18, Y.knee, 0.0], [0.05, 0.08, 0.07]),
      views: ['anterior', 'posterior', 'lateral_left', 'lateral_right'],
      focusPoint: [0.39, 0.85],
    },
    {
      geometry: box([0.18, Y.knee, 0.0], [0.05, 0.08, 0.07]),
      views: ['anterior', 'posterior', 'lateral_left', 'lateral_right'],
      focusPoint: [0.61, 0.85],
    },
  ],
  'knee.posterior': [
    {
      geometry: sphere([-0.1, Y.knee, -0.08], [0.08, 0.08, 0.06]),
      views: ['posterior', 'lateral_left', 'lateral_right'],
      focusPoint: [0.43, 0.86],
    },
    {
      geometry: sphere([0.1, Y.knee, -0.08], [0.08, 0.08, 0.06]),
      views: ['posterior', 'lateral_left', 'lateral_right'],
      focusPoint: [0.57, 0.86],
    },
  ],
};

/**
 * Structure proxies, bound to REAL domain structure ids so a highlight can be
 * traced back to something the record can actually store. Several layers are
 * represented per region so that changing depth and hiding layers is visibly
 * observable rather than a no-op.
 */
const STRUCTURE_PROXIES: {
  region: BodyRegion;
  subRegionId: string;
  structureId: string;
  layer: TissueLayer;
  geometry: Primitive;
  views: CameraPreset[];
  focusPoint: [number, number];
}[] = [
  // shoulder — muscle, tendon, joint, bone
  {
    region: 'shoulder',
    subRegionId: 'shoulder.lateral',
    structureId: 'asi:shoulder.deltoid',
    layer: 'muscle',
    geometry: sphere([0.26, Y.shoulder, 0.0], [0.1, 0.1, 0.11]),
    views: ALL_VIEWS,
    focusPoint: [0.74, 0.37],
  },
  {
    region: 'shoulder',
    subRegionId: 'shoulder.anterior',
    structureId: 'asi:shoulder.biceps-long-head-tendon',
    layer: 'tendon',
    geometry: capsule([0.17, Y.shoulder - 0.01, 0.1], [0.03, 0.07, 0.03]),
    views: ['anterior', 'lateral_left', 'lateral_right'],
    focusPoint: [0.67, 0.36],
  },
  {
    region: 'shoulder',
    subRegionId: 'shoulder.lateral',
    structureId: 'asi:shoulder.acromion',
    layer: 'bone',
    geometry: box([0.24, Y.shoulder + 0.07, 0.0], [0.08, 0.03, 0.08]),
    views: ALL_VIEWS,
    focusPoint: [0.74, 0.33],
  },
  {
    region: 'shoulder',
    subRegionId: 'shoulder.lateral',
    structureId: 'asi:shoulder.acromioclavicular-joint',
    layer: 'joint',
    geometry: sphere([0.2, Y.shoulder + 0.08, 0.02], [0.035, 0.035, 0.035]),
    views: ALL_VIEWS,
    focusPoint: [0.7, 0.32],
  },
  {
    region: 'shoulder',
    subRegionId: 'shoulder.lateral',
    structureId: 'asi:shoulder.supraspinatus-tendon',
    layer: 'tendon',
    geometry: box([0.2, Y.shoulder + 0.05, -0.02], [0.07, 0.025, 0.05]),
    views: ['posterior', 'lateral_left', 'lateral_right'],
    focusPoint: [0.7, 0.34],
  },
  // neck — muscle, bone, nerve
  {
    region: 'neck',
    subRegionId: 'neck.anterior',
    structureId: 'asi:neck.sternocleidomastoid',
    layer: 'muscle',
    geometry: capsule([-0.05, Y.neckTop - 0.04, 0.06], [0.03, 0.07, 0.03]),
    views: ['anterior', 'lateral_left', 'lateral_right'],
    focusPoint: [0.46, 0.3],
  },
  {
    region: 'neck',
    subRegionId: 'neck.anterior',
    structureId: 'asi:neck.cervical-spine',
    layer: 'bone',
    geometry: capsule([0, Y.neckTop - 0.05, 0.0], [0.04, 0.08, 0.04]),
    views: ALL_VIEWS,
    focusPoint: [0.5, 0.31],
  },
  {
    region: 'neck',
    subRegionId: 'neck.lateral',
    structureId: 'asi:neck.brachial-plexus',
    layer: 'nerve',
    geometry: sphere([0.09, Y.neckTop - 0.06, 0.0], [0.025, 0.04, 0.025]),
    views: ALL_VIEWS,
    focusPoint: [0.59, 0.33],
  },
  // lower back — muscle, bone, fascia, ligament
  {
    region: 'lower_back',
    subRegionId: 'lower_back.central',
    structureId: 'asi:lower-back.lumbar-spine',
    layer: 'bone',
    geometry: box([0, Y.lowerBack, -0.09], [0.045, 0.16, 0.04]),
    views: ['posterior', 'lateral_left', 'lateral_right'],
    focusPoint: [0.5, 0.65],
  },
  {
    region: 'lower_back',
    subRegionId: 'lower_back.left_paravertebral',
    structureId: 'asi:lower-back.erector-spinae',
    layer: 'muscle',
    geometry: box([-0.12, Y.lowerBack, -0.09], [0.04, 0.16, 0.05]),
    views: ['posterior', 'lateral_left'],
    focusPoint: [0.44, 0.66],
  },
  {
    region: 'lower_back',
    subRegionId: 'lower_back.central',
    structureId: 'asi:lower-back.thoracolumbar-fascia',
    layer: 'fascia',
    geometry: box([0, Y.lowerBack, -0.13], [0.2, 0.17, 0.02]),
    views: ['posterior', 'lateral_left', 'lateral_right'],
    focusPoint: [0.5, 0.66],
  },
  {
    region: 'lower_back',
    subRegionId: 'lower_back.sacrococcygeal',
    structureId: 'asi:lower-back.coccyx',
    layer: 'bone',
    geometry: sphere([0, Y.hip + 0.03, -0.12], [0.035, 0.045, 0.03]),
    views: ['posterior', 'lateral_left', 'lateral_right'],
    focusPoint: [0.5, 0.75],
  },
  {
    region: 'lower_back',
    subRegionId: 'lower_back.sacrococcygeal',
    structureId: 'asi:lower-back.sacrotuberous-ligament',
    layer: 'ligament',
    geometry: box([0.06, Y.hip + 0.02, -0.12], [0.05, 0.06, 0.02]),
    views: ['posterior', 'lateral_left', 'lateral_right'],
    focusPoint: [0.56, 0.75],
  },
  // knee — bone, tendon, cartilage via joint, fascia
  {
    region: 'knee',
    subRegionId: 'knee.anterior',
    structureId: 'asi:knee.patella',
    layer: 'bone',
    geometry: sphere([0.1, Y.knee, 0.08], [0.05, 0.05, 0.03]),
    views: ['anterior', 'lateral_left', 'lateral_right'],
    focusPoint: [0.57, 0.85],
  },
  {
    region: 'knee',
    subRegionId: 'knee.anterior',
    structureId: 'asi:knee.patellar-tendon',
    layer: 'tendon',
    geometry: box([0.1, Y.knee - 0.07, 0.06], [0.035, 0.05, 0.025]),
    views: ['anterior', 'lateral_left', 'lateral_right'],
    focusPoint: [0.57, 0.88],
  },
  {
    region: 'knee',
    subRegionId: 'knee.anterior',
    structureId: 'asi:knee.prepatellar-bursa',
    layer: 'fascia',
    geometry: sphere([0.1, Y.knee + 0.01, 0.1], [0.055, 0.05, 0.02]),
    views: ['anterior', 'lateral_left', 'lateral_right'],
    focusPoint: [0.57, 0.84],
  },
];

function subRegionEntries(): ManifestEntry[] {
  const entries: ManifestEntry[] = [];
  for (const [subRegionId, proxies] of Object.entries(SUBREGION_PROXIES)) {
    const region = subRegionId.split('.')[0] as BodyRegion;
    const domainSub = REGIONS[region]?.subRegions.find((s) => s.id === subRegionId);
    proxies.forEach((proxy, i) => {
      entries.push({
        asiId: `fixture:sub:${subRegionId}:${i}`,
        kind: 'subregion',
        region,
        subRegionId,
        // Sub-region volumes are proxies, not tissue, so they sit on the skin
        // layer: hiding "deep" tissue must not make a region unpickable.
        layer: 'skin',
        views: proxy.views,
        geometry: proxy.geometry,
        focusPoint: { x: proxy.focusPoint[0], y: proxy.focusPoint[1] },
        label: domainSub?.label,
      });
    });
  }
  return entries;
}

function structureEntries(): ManifestEntry[] {
  return STRUCTURE_PROXIES.map((proxy) => ({
    asiId: `fixture:struct:${proxy.structureId}`,
    kind: 'structure' as const,
    region: proxy.region,
    subRegionId: proxy.subRegionId,
    structureId: proxy.structureId,
    layer: proxy.layer,
    views: proxy.views,
    geometry: proxy.geometry,
    focusPoint: { x: proxy.focusPoint[0], y: proxy.focusPoint[1] },
  }));
}

export function buildFixtureManifest(): AnatomyManifest {
  return {
    version: 'phase1-fixture-1',
    source: 'fixture',
    disclaimer: FIXTURE_DISCLAIMER,
    bounds: { height: 1.8, radius: 0.45 },
    entries: [...subRegionEntries(), ...structureEntries()],
  };
}

/** The single instance the app uses while the real asset pipeline is pending. */
export const FIXTURE_MANIFEST: AnatomyManifest = buildFixtureManifest();

/** Convenience for tests: every sub-region in the ontology has fixture geometry. */
export function fixtureCoversOntology(): { subRegions: string[]; structures: string[] } {
  const subRegions = new Set<string>();
  const structures = new Set<string>();
  for (const entry of FIXTURE_MANIFEST.entries) {
    if (entry.subRegionId) subRegions.add(entry.subRegionId);
    if (entry.structureId) structures.add(entry.structureId);
  }
  return { subRegions: [...subRegions], structures: [...structures] };
}

/** All layers actually represented, so layer tests assert on real data. */
export function fixtureLayers(): TissueLayer[] {
  const used = new Set<TissueLayer>();
  for (const entry of FIXTURE_MANIFEST.entries) used.add(entry.layer);
  return TISSUE_LAYER_ORDER.filter((layer) => used.has(layer));
}

export type { Structure, SubRegion };
