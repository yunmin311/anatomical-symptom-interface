/**
 * Anatomy asset manifest.
 *
 * The manifest, not the mesh, is the deliverable of the anatomy pipeline. Every
 * layer above the viewer keys off `asiId`, so the mesh format stays a swappable
 * detail: replacing the schematic 2D map with decimated BodyParts3D geometry is a
 * rendering change, not a data migration. That only holds if the manifest is a
 * real, validated contract rather than a JSON file somebody edits by hand.
 *
 * WHY NOT USE THE SOURCE IDS AS PRIMARY KEYS. Third-party terminologies get
 * re-numbered, renamed and re-released. If `Supraspinatus_tendon_L` were our
 * identity, then an upstream rename would silently repoint a user's saved visual
 * selection at a different structure, and the record would claim the user
 * pointed at something they did not. So the source mesh name is carried as
 * provenance, and `asiId` is ours. See docs/adr/0002-anatomy-model-source.md.
 *
 * The `subRegionIds` field is a list because the domain genuinely needs it to be:
 * `asi:shoulder.deltoid` is selectable from both `shoulder.anterior` and
 * `shoulder.lateral`, and one mesh serves both. A single `subRegionId` would have
 * forced a duplicate mesh or a lie.
 *
 * Every field is validated at runtime rather than trusted, because a manifest is
 * generated from a third-party archive and a malformed entry must fail loudly at
 * build time, not surface as a structure that renders at the origin or a licence
 * line that was never checked.
 */
import { z } from 'zod';
import { BodyRegionSchema, TissueLayerSchema, getStructure, getSubRegion } from './anatomy.ts';

/** Which side of the body a mesh represents. */
export const LateralitySchema = z.enum(['left', 'right', 'bilateral', 'midline', 'not_applicable']);
export type Laterality = z.infer<typeof LateralitySchema>;

/**
 * FMA binding status. Never 'verified' by default: a code is only 'verified'
 * after a human has checked it against the issuing authority, and an
 * auto-generated manifest has done no such thing.
 */
export const FmaBindingSchema = z.object({
  /** FMA concept id, when the source dataset supplied one. */
  conceptId: z.string().min(1).nullish(),
  status: z.enum(['unverified', 'verified', 'absent']).default('unverified'),
  /** Where the claim came from, e.g. "bp3d 4.3i concept list, 2026-09-30". */
  note: z.string().min(1).nullish(),
});
export type FmaBinding = z.infer<typeof FmaBindingSchema>;

/**
 * Where the geometry came from, precisely enough to be re-derived.
 *
 * `release` and `conceptId` are the two fields that stop a licence or a rename
 * becoming a mystery later. A mesh with no recorded release cannot be traced
 * back to the archive it came from, which is how a licence change goes unnoticed.
 */
export const SourceSchema = z.object({
  dataset: z.string().min(1),
  release: z.string().min(1),
  /** The concept or file id inside that release. */
  conceptId: z.string().min(1).nullish(),
  /** Archive file the mesh was extracted from, when it came from a bulk archive. */
  archive: z.string().min(1).nullish(),
  /** DOI of the source dataset, for citation. */
  doi: z.string().min(1).nullish(),
  /** Date the geometry was generated, ISO. */
  retrievedAt: z.string().min(4).nullish(),
});
export type AssetSource = z.infer<typeof SourceSchema>;

/**
 * Licence and attribution.
 *
 * `attribution` is required, not optional, and the manifest schema refuses an
 * entry without it. A redistributed mesh with no attribution line is a licence
 * violation, and the cheapest place to prevent that is a schema that will not
 * validate without it.
 */
export const LicenceSchema = z.object({
  /** SPDX-style short id, e.g. 'CC-BY-4.0'. */
  id: z.string().min(1),
  name: z.string().min(1),
  url: z.string().url(),
  /** The exact attribution string that must ship with the asset. */
  attribution: z.string().min(1),
  /** ISO date the licence page was last read. This is what reveals a stale copy. */
  verifiedOn: z.string().min(4),
});
export type AssetLicence = z.infer<typeof LicenceSchema>;

/** Axis-aligned bounds in the mesh's own units, for framing and culling. */
export const BoundsSchema = z.object({
  min: z.tuple([z.number(), z.number(), z.number()]),
  max: z.tuple([z.number(), z.number(), z.number()]),
});
export type Bounds = z.infer<typeof BoundsSchema>;

/** What the conversion did to the geometry, so the cost is auditable. */
export const GeometrySchema = z.object({
  /** Triangles after reduction. The number the budget is enforced against. */
  triangles: z.number().int().nonnegative(),
  /** Triangles in the source mesh, before reduction. */
  sourceTriangles: z.number().int().nonnegative().nullish(),
  /** Reduction factor actually achieved, 0..1. Null when nothing was removed. */
  reduction: z.number().min(0).max(1).nullish(),
  /** Units the bounds are expressed in. */
  units: z.enum(['m', 'cm', 'mm', 'unitless']).default('unitless'),
});
export type AssetGeometry = z.infer<typeof GeometrySchema>;

/**
 * One manifest entry: exactly one mesh, bound to exactly one `asiId`.
 *
 * `asiId` must already exist in the domain. A manifest cannot introduce a
 * structure the product does not know about, because nothing else would be able
 * to resolve it and it would be invisible to the interview engine.
 *
 * STRICT on purpose. The default Zod object silently strips keys it does not
 * recognise, which for a generated file is the wrong failure: a pipeline that
 * starts emitting a new field would appear to succeed while the field was
 * dropped on the floor, and nobody would find out until an asset rendered wrong.
 * Rejecting means the generator and the schema have to be changed together, which
 * is what `schemaVersion` is for. It also means an entry cannot quietly carry a
 * clinical claim -- a `selectedByUser`, a `severity` or a `diagnosis` is a
 * parse error rather than a stripped extra.
 */
export const AssetManifestEntrySchema = z.object({
  asiId: z.string().regex(/^asi:/, 'an asset id must be an asi:* id, never a source id'),
  /** Name in the source dataset. Provenance only; never used as an identity. */
  meshName: z.string().min(1),
  region: BodyRegionSchema,
  subRegionIds: z.array(z.string().min(1)).min(1),
  layer: TissueLayerSchema,
  /** Precise anatomical name, for a clinician-facing surface. */
  anatomicalLabel: z.string().min(1),
  /** Plain-language name. Falls back to the anatomical label when unwritten. */
  layTerm: z.string().min(1).nullish(),
  laterality: LateralitySchema,
  fma: FmaBindingSchema,
  source: SourceSchema,
  licence: LicenceSchema,
  geometry: GeometrySchema,
  bounds: BoundsSchema,
  /** Path to the generated .glb, relative to the asset root. */
  file: z.string().min(1),
}).strict();
export type AssetManifestEntry = z.infer<typeof AssetManifestEntrySchema>;

export const AssetManifestSchema = z.object({
  /** Bumped when the pipeline changes shape, not when content changes. */
  schemaVersion: z.literal(1),
  /** Which regions this manifest covers. Phase 1 starts with shoulder. */
  regions: z.array(BodyRegionSchema).min(1),
  /** Applies to every entry unless an entry overrides it. */
  licence: LicenceSchema,
  /** The pipeline run that produced this file, for reproducibility. */
  generator: z.object({
    name: z.string().min(1),
    version: z.string().min(1),
  }),
  entries: z.array(AssetManifestEntrySchema),
});
export type AssetManifest = z.infer<typeof AssetManifestSchema>;

/* ------------------------------------------------------------------ */
/* Cross-checks a per-entry schema cannot express                       */
/* ------------------------------------------------------------------ */

export interface ManifestIssue {
  severity: 'error' | 'warning';
  asiId?: string;
  meshName?: string;
  message: string;
}

export interface GeometryBudget {
  /** Total triangles across the whole manifest. */
  maxTotalTriangles: number;
  /** Triangles for any single mesh. */
  maxTrianglesPerMesh: number;
  /** Total generated bytes across the manifest. */
  maxTotalBytes?: number;
}

export const DEFAULT_GEOMETRY_BUDGET: GeometryBudget = {
  // Four V1 regions under ~10MB is the constraint from
  // docs/research/anatomy-assets.md. A decimated GLB runs roughly 12-20 bytes
  // per triangle, so ~600k triangles is the order of magnitude that fits. Phase 1
  // ships one region and has far more headroom than it needs.
  maxTotalTriangles: 600_000,
  maxTrianglesPerMesh: 120_000,
  maxTotalBytes: 12 * 1024 * 1024,
};

/**
 * Validate a parsed manifest against the domain and the budget.
 *
 * Separate from the Zod schema because these are the checks that need the rest
 * of the product: an `asiId` that resolves to a structure, a sub-region that
 * exists in that region, uniqueness, and a size budget. All of them are
 * properties of the manifest *in the context of this build*, which is exactly
 * what a generated file can get wrong and a schema cannot catch.
 */
export function validateManifest(
  manifest: AssetManifest,
  options: { budget?: GeometryBudget; fileSizes?: Map<string, number> } = {},
): ManifestIssue[] {
  const budget = options.budget ?? DEFAULT_GEOMETRY_BUDGET;
  const issues: ManifestIssue[] = [];

  const seenAsi = new Set<string>();
  const seenMesh = new Set<string>();
  let totalTriangles = 0;

  for (const e of manifest.entries) {
    // The id must resolve to a real structure, and that structure must be in the
    // region the entry claims. A manifest that disagrees with anatomy.ts would
    // make a visual selection unrenderable at the moment the user needs it.
    const structure = getStructure(e.asiId);
    if (!structure) {
      issues.push({ severity: 'error', asiId: e.asiId, meshName: e.meshName, message: 'asiId does not exist in the domain' });
    } else {
      if (structure.layer !== e.layer) {
        issues.push({
          severity: 'error', asiId: e.asiId, meshName: e.meshName,
          message: `layer disagrees with the domain: manifest says ${e.layer}, anatomy says ${structure.layer}`,
        });
      }
      if (!e.asiId.startsWith(`asi:${e.region}.`) && !e.asiId.startsWith(`asi:${e.region}-`)) {
        issues.push({
          severity: 'error', asiId: e.asiId, meshName: e.meshName,
          message: `asiId prefix does not match the declared region ${e.region}`,
        });
      }
    }

    for (const sub of e.subRegionIds) {
      if (!getSubRegion(e.region, sub)) {
        issues.push({ severity: 'error', asiId: e.asiId, meshName: e.meshName, message: `unknown sub-region ${sub} in ${e.region}` });
      }
    }

    if (seenAsi.has(e.asiId)) {
      issues.push({ severity: 'error', asiId: e.asiId, message: 'duplicate asiId in the manifest' });
    }
    seenAsi.add(e.asiId);

    if (seenMesh.has(e.meshName)) {
      issues.push({ severity: 'error', meshName: e.meshName, message: 'duplicate meshName in the manifest' });
    }
    seenMesh.add(e.meshName);

    if (!manifest.regions.includes(e.region)) {
      issues.push({ severity: 'error', asiId: e.asiId, meshName: e.meshName, message: `entry region ${e.region} is not listed in manifest.regions` });
    }

    // The derived flag is the domain's business. An asset is geometry; it must
    // not smuggle in a claim that the user selected it.
    if (e.geometry.triangles > budget.maxTrianglesPerMesh) {
      issues.push({
        severity: 'error', asiId: e.asiId, meshName: e.meshName,
        message: `mesh has ${e.geometry.triangles} triangles, over the per-mesh budget of ${budget.maxTrianglesPerMesh}`,
      });
    }
    totalTriangles += e.geometry.triangles;

    if (options.fileSizes) {
      const bytes = options.fileSizes.get(e.file);
      if (bytes === undefined) {
        issues.push({ severity: 'error', asiId: e.asiId, meshName: e.meshName, message: `mesh file not found: ${e.file}` });
      }
    }
  }

  if (totalTriangles > budget.maxTotalTriangles) {
    issues.push({
      severity: 'error',
      message: `manifest totals ${totalTriangles} triangles, over the budget of ${budget.maxTotalTriangles}`,
    });
  }

  if (options.fileSizes) {
    let totalBytes = 0;
    for (const e of manifest.entries) totalBytes += options.fileSizes.get(e.file) ?? 0;
    if (budget.maxTotalBytes && totalBytes > budget.maxTotalBytes) {
      issues.push({
        severity: 'error',
        message: `generated meshes total ${totalBytes} bytes, over the budget of ${budget.maxTotalBytes}`,
      });
    }
  }

  // A mesh with an unverified FMA binding is expected for generated output, but it
  // is worth surfacing so it cannot quietly become the norm unnoticed.
  for (const e of manifest.entries) {
    if (e.fma.status === 'unverified') {
      issues.push({ severity: 'warning', asiId: e.asiId, meshName: e.meshName, message: 'FMA binding is unverified' });
    }
  }

  return issues;
}

/** Parse and cross-check in one step. Throws with every issue, not just the first. */
export function parseManifest(
  raw: unknown,
  options: { budget?: GeometryBudget; fileSizes?: Map<string, number> } = {},
): AssetManifest {
  const manifest = AssetManifestSchema.parse(raw);
  const issues = validateManifest(manifest, options);
  const errors = issues.filter((i) => i.severity === 'error');
  if (errors.length) {
    throw new Error(
      `invalid anatomy manifest:\n${errors.map((e) => `  - ${e.asiId ?? ''} ${e.meshName ?? ''}: ${e.message}`).join('\n')}`,
    );
  }
  return manifest;
}

export function manifestHasErrors(issues: ManifestIssue[]): boolean {
  return issues.some((i) => i.severity === 'error');
}
