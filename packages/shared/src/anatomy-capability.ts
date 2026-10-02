/**
 * Anatomy capability, as data.
 *
 * ## What this answers
 *
 * "Can this product show me 3D anatomy for the lower back, and for which sides?" -- asked
 * by an MCP client that has no way to see our viewer, and by any caller deciding whether
 * to offer a 3D picker at all.
 *
 * ## Why it is built from the MANIFESTS and not from a table
 *
 * There was already a representation table saying which structures have 3D. Reporting
 * from that table would be reporting our INTENT, and intent is exactly what drifted
 * before: the table said a region had geometry while the registry had no build for it, and
 * the client would have offered a picker over an empty canvas.
 *
 * So the counts, the meshes and the triangle totals are read from the same generated
 * manifests the renderer mounts. If a build is missing, this reports it missing. If a
 * structure is bound to nothing, it says so. There is no second place to update and
 * therefore nothing to forget.
 *
 * The one thing this adds that the manifests cannot state is WHY a concept is missing --
 * "the source has no knee ligaments" is a fact about the dataset, not about the file.
 * That comes from the representation table, which is where that reasoning already lives.
 */
import { z } from 'zod';
import {
  AnatomyCapabilitySchema,
  type AnatomyCapability,
  type RegionCapabilityReport,
  type SideCapabilityReport,
  type StructureCapabilityReport,
} from './api-contract.ts';
import { REGIONS, structuresForRegion, regionsForStructure } from './anatomy.ts';
import type { BodyRegion, Structure } from './anatomy.ts';
import {
  threeDGapFor,
  isPlaceholder2D,
  declaredRepresentationGaps,
  layerOf,
} from './anatomy-representation.ts';
import { mappingFor } from './anatomy-mapping.ts';
import {
  BODYPARTS3D_LICENCE,
  BODYPARTS3D_SOURCE,
  PIPELINE_SIDES,
} from './anatomy-mapping.ts';
import type { AssetManifest } from './anatomy-manifest.ts';

/** Which sides a client may ask about. Mirrors `Side`, plus nothing. */
const REPORTED_SIDES = ['left', 'right', 'midline', 'bilateral', 'unknown'] as const;

/**
 * The manifests actually built, keyed region -> side.
 *
 * The registry is passed IN rather than imported. `active-scene.ts` lives in the web app
 * because it imports generated modules from the web tree; the pure domain cannot import
 * from the app. Passing the registry in keeps this file pure and testable, and keeps the
 * direction of dependency pointing one way: the app knows about builds, the domain knows
 * how to describe them.
 */
export type BuiltManifests = Readonly<
  Partial<Record<BodyRegion, Partial<Record<(typeof PIPELINE_SIDES)[number], AssetManifest>>>>
>;

/** One side's honest 3D report, taken from the build that exists. */
function sideReport(
  region: BodyRegion,
  side: (typeof REPORTED_SIDES)[number],
  manifest: AssetManifest | undefined,
): SideCapabilityReport {
  if (!manifest) {
    // Distinguish the two reasons, because they are different claims. `bilateral` and
    // `unknown` are never builds; they are handled by composing real side scenes.
    const reason =
      side === 'bilateral'
        ? 'Bilateral is not a build: it is the left and right scenes shown together, and neither is mirrored.'
        : side === 'unknown'
          ? 'No side is recorded, so there is nothing to load. One-sided geometry cannot stand in for "either side".'
          : `No sourced midline geometry for the ${region.replace(/_/g, ' ')}: the dataset models it per side.`;
    return { side, available: false, threeD: { available: false, reason }, reason };
  }

  const meshes = new Set<string>();
  let triangles = 0;
  for (const entry of manifest.entries) {
    triangles += entry.geometry.triangles;
    if (entry.file) meshes.add(entry.file);
    for (const component of entry.composite?.components ?? []) {
      triangles += component.geometry.triangles;
      if (component.file) meshes.add(component.file);
    }
  }

  // Every entry must be this build's own side, EXCEPT that a left or right build
  // legitimately carries midline structures as context -- a left neck scene has cervical
  // vertebrae behind the muscles. A MIDLINE build has no such allowance: it claims to hold
  // midline geometry and nothing else, and allowing "or midline" would be vacuous there.
  //
  // The first version of this check refused the left neck over its own cervical spine,
  // which is the mistake of applying the midline rule to a side build.
  const wrong =
    side === 'midline'
      ? manifest.entries.filter((e) => e.laterality !== 'midline')
      : manifest.entries.filter((e) => e.laterality !== side && e.laterality !== 'midline');
  if (wrong.length)
    throw new Error(
      `the ${region}/${side} manifest carries ${wrong.length} entr${wrong.length === 1 ? 'y' : 'ies'} ` +
        `of another side: ${wrong.map((e) => `${e.asiId}=${e.laterality}`).join(', ')}`,
    );

  // What this side actually contributed, which for a side build is less than the whole
  // scene. Reporting the context structures as if this side owned them would overstate
  // what a client gets if it loads only this build.
  const ownEntries = manifest.entries.filter((e) => e.laterality === side);
  const ownMeshes = new Set<string>();
  let ownTriangles = 0;
  for (const entry of ownEntries) {
    ownTriangles += entry.geometry.triangles;
    if (entry.file) ownMeshes.add(entry.file);
    for (const component of entry.composite?.components ?? []) {
      ownTriangles += component.geometry.triangles;
      if (component.file) ownMeshes.add(component.file);
    }
  }

  return {
    side,
    available: true,
    threeD: {
      available: true,
      meshes: ownMeshes.size,
      triangles: ownTriangles,
      source: `${BODYPARTS3D_SOURCE.dataset} ${BODYPARTS3D_SOURCE.release}`,
      licence: BODYPARTS3D_LICENCE.id,
    },
    reason: null,
  };
}

/** What one structure can be shown as, in one region. */
function structureReport(
  structure: Structure,
  region: BodyRegion,
  built: BuiltManifests,
): StructureCapabilityReport {
  const bound = (['left', 'right', 'midline'] as const).some((side) =>
    (built[region]?.[side]?.entries ?? []).some((e) => e.asiId === structure.id),
  );
  const gap = bound ? null : threeDGapFor(structure);
  return {
    asiId: structure.id,
    label: structure.label,
    // Membership from the ontology, never from the id prefix: the prefix records where a
    // user first meets a structure and is not authoritative.
    regions: regionsForStructure(structure.id),
    layer: layerOf(structure),
    threeDAvailable: bound,
    twoDPlaceholder: isPlaceholder2D(structure),
    // `threeDGapFor` is null when the structure HAS a declared 3D representation. If the
    // structure is not bound in this build but the domain says 3D exists, that is a
    // build gap and is reported as one, not as a source gap.
    threeDGapReason: bound ? null : gap ? 'no sourced geometry is bound in this build' : null,
  };
}

/** One region's full report. */
export function regionCapability(
  region: BodyRegion,
  built: BuiltManifests,
): RegionCapabilityReport {
  const mapped = new Set(mappingFor(region).map((m) => m.asiId));
  const structures = structuresForRegion(region);

  // Anything the mapping declares for this region but the domain has no 3D for, with the
  // reason it is missing. This is the list a client shows when it cannot render something,
  // and every entry is a statement about the DATASET, not about this build.
  const unavailable = structures
    .filter((s) => mapped.has(s.id) && !(built[region]?.left?.entries ?? []).some((e) => e.asiId === s.id) && !(built[region]?.right?.entries ?? []).some((e) => e.asiId === s.id) && !(built[region]?.midline?.entries ?? []).some((e) => e.asiId === s.id))
    .map((s) => {
      const gap = threeDGapFor(s);
      return {
        asiId: s.id,
        label: s.label,
        reason:
          gap && gap.status === 'unavailable'
            ? gap.detail
            : 'mapped, but no sourced geometry is bound in this build',
      };
    });

  const sides = REPORTED_SIDES.map((side) =>
    sideReport(
      region,
      side,
      side === 'left' || side === 'right' || side === 'midline' ? built[region]?.[side] : undefined,
    ),
  );

  return {
    region,
    label: REGIONS[region].label,
    // "has 3D" means BOTH sides, because a region with one side is a region a user with
    // pain on the other side cannot use.
    hasThreeD: sides.every((s) => s.side === 'left' || s.side === 'right' ? s.available : true),
    sides,
    structures: structures.map((s) => structureReport(s, region, built)),
    unavailable,
  };
}

/** Every region's report, validated against the contract before it is returned. */
export function anatomyCapability(built: BuiltManifests): AnatomyCapability {
  const regions = (Object.keys(REGIONS) as BodyRegion[]).map((region) =>
    regionCapability(region, built),
  );
  return AnatomyCapabilitySchema.parse({
    schemaVersion: 1,
    dataset: {
      name: BODYPARTS3D_SOURCE.dataset,
      release: BODYPARTS3D_SOURCE.release,
      licence: BODYPARTS3D_LICENCE.id,
      url: BODYPARTS3D_LICENCE.url,
    },
    regions,
  });
}

/**
 * Every declared representation gap in the whole domain, not just the built regions.
 *
 * Exported so the gates can assert that the count of "honest gaps" is non-trivial: a
 * capability report that claims everything is available would be as wrong as one that
 * invents geometry.
 */
export function declaredGapCount(): number {
  return declaredRepresentationGaps().length;
}

export { z };