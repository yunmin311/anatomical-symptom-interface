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
import {
  BodyRegionSchema,
  TissueLayerSchema,
  getStructure,
  getSubRegion,
  regionsForStructure,
} from './anatomy.ts';

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
 * One manifest ENTRY: exactly one canonical `asiId`, bound to one or more source meshes.
 *
 * `asiId` must already exist in the domain. A manifest cannot introduce a
 * structure the product does not know about, because nothing else would be able
 * to resolve it and it would be invisible to the interview engine.
 *
 * ## WHY AN ENTRY IS NO LONGER ONE MESH
 *
 * It used to be, and the assumption was false the moment a second region was built.
 * The neck audit found real source geometry for concepts our ontology models more
 * coarsely than the source does:
 *
 *   asi:neck.cervical-spine  -> atlas + axis + C3 + C4 + C5 + C6 + C7  (7 meshes)
 *   asi:neck.scalenes         -> anterior + medius + posterior, per side
 *
 * Those are not "the source is missing". They are one canonical concept resolving to
 * several externally sourced elements, and the alternative -- binding C1 and calling it
 * "the cervical spine" -- would show a user who pointed at their whole neck one
 * vertebra under a label claiming seven.
 *
 * So a composite entry carries its components explicitly, and each component keeps its
 * OWN provenance: mesh id, source concept, laterality, file, geometry and bounds. The
 * parent keeps the aggregate, which is what a viewer needs to frame it, and is
 * explicitly NOT a source claim about a single mesh.
 *
 * `selectable` on the composite says whether the components are themselves separately
 * selectable canonical structures (the deltoid parts are) or internal parts of one
 * selection (cervical vertebrae are). It is what stops "make composites work" from
 * quietly turning every source mesh into a user-facing concept.
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

/**
 * One externally sourced element of a composite.
 *
 * A complete provenance record in its own right. Collapsing these into one
 * "the vertebrae" source claim is precisely the fabrication the composite model
 * exists to prevent: the seven meshes have seven different FMA concepts and a
 * clinician citing one is not citing the other six.
 */
export const AssetComponentSchema = z.object({
  meshName: z.string().min(1),
  fma: FmaBindingSchema,
  source: SourceSchema,
  laterality: LateralitySchema,
  geometry: GeometrySchema,
  bounds: BoundsSchema,
  /** Path to the generated .glb, relative to the asset root. */
  file: z.string().min(1),
  /** The SOURCE's own name for this element, kept verbatim as provenance. */
  sourceLabel: z.string().min(1).nullish(),
}).strict();
export type AssetComponent = z.infer<typeof AssetComponentSchema>;

export const AssetManifestEntrySchema = z.object({
  asiId: z.string().regex(/^asi:/, 'an asset id must be an asi:* id, never a source id'),
  /**
   * The single source mesh this entry is built from, when it is not a composite.
   *
   * Null exactly when `composite` is present, and the cross-checks enforce that in
   * both directions: a composite cannot also claim one mesh, and a non-composite
   * cannot omit it. A single field that means "sometimes one, sometimes many" would
   * make every reader re-derive the rule.
   */
  meshName: z.string().min(1).nullish(),
  region: BodyRegionSchema,
  subRegionIds: z.array(z.string().min(1)).min(1),
  layer: TissueLayerSchema,
  /** Precise anatomical name, for a clinician-facing surface. */
  anatomicalLabel: z.string().min(1),
  /** Plain-language name. Falls back to the anatomical label when unwritten. */
  layTerm: z.string().min(1).nullish(),
  laterality: LateralitySchema,
  /**
   * Single-mesh provenance, for the common case.
   *
   * Null on a composite, where claiming one source concept would be a lie: seven
   * vertebrae are seven concepts.
   */
  fma: FmaBindingSchema.nullish(),
  source: SourceSchema.nullish(),
  licence: LicenceSchema,
  geometry: GeometrySchema,
  bounds: BoundsSchema,
  /** Path to the generated .glb, relative to the asset root. Absent on a composite. */
  file: z.string().min(1).nullish(),
  /** Present when this canonical concept resolves to several sourced elements. */
  composite: z
    .object({
      /**
       * Whether the components are ALSO separately selectable canonical structures.
       *
       * True for the deltoid, where each part has its own `asi:` id because a
       * clinician names them. False for cervical vertebrae, which are parts of the
       * one thing a user pointed at.
       */
      selectable: z.boolean(),
      /** Why this is a composite, in words from the mapping. Never inferred. */
      reason: z.string().min(1),
      components: z.array(AssetComponentSchema).min(2),
    })
    .strict()
    .nullish(),
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
  /** Absent on a composite parent, which has no single mesh of its own. */
  meshName?: string | null;
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
      // Region membership comes from the ONTOLOGY, not from the id prefix.
      //
      // This used to be a string-prefix test, and it rejected four correct lower-back
      // entries: the region is spelled `lower_back` while its structures are prefixed
      // `asi:lower-back.`, so no prefix rule could have matched. A longer rule would have
      // been the wrong fix -- the id prefix records where a user first meets a structure
      // and is not authoritative, since `shoulder.trapezius-upper` also belongs to the
      // neck.
      if (!regionsForStructure(e.asiId).includes(e.region)) {
        issues.push({
          severity: 'error', asiId: e.asiId, meshName: e.meshName,
          message:
            `structure is not a member of the declared region ${e.region}; it belongs to ` +
            `${regionsForStructure(e.asiId).join(', ') || 'no region in the ontology'}`,
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

// A mesh may be used once across the WHOLE manifest, whether it is a plain entry
    // or a composite component. Checked in one set on purpose: allowing the two to be
    // tracked separately is exactly how one source element ends up backing two
    // canonical identities.
    const meshesForEntry = [e.meshName, ...(e.composite?.components.map((c) => c.meshName) ?? [])].filter(
      (name): name is string => Boolean(name),
    );
    for (const name of meshesForEntry) {
      if (seenMesh.has(name)) {
        issues.push({ severity: 'error', asiId: e.asiId, meshName: name, message: 'mesh is used more than once in the manifest' });
      }
      seenMesh.add(name);
    }

    // A composite has no single mesh, and a non-composite cannot pretend it has one.
    // Checked in both directions because either half alone is exploitable: allow a
    // composite to also carry `meshName` and a real component could be hidden from the
    // per-component provenance checks; allow a non-composite to omit it and an entry
    // could be a composite that nobody validated.
    if (e.composite && e.meshName) {
      issues.push({
        severity: 'error', asiId: e.asiId, meshName: e.meshName,
        message: 'a composite entry also claims a single meshName; the components are the truth',
      });
    }
    if (!e.composite && !e.meshName) {
      issues.push({ severity: 'error', asiId: e.asiId, message: 'a non-composite entry has no meshName' });
    }
    if (!e.composite && (!e.fma || !e.source)) {
      issues.push({
        severity: 'error', asiId: e.asiId, meshName: e.meshName,
        message: 'a non-composite entry must carry its own fma and source provenance',
      });
    }

    // Every component carries its own provenance.
    for (const component of e.composite?.components ?? []) {
      if (component.geometry.triangles > budget.maxTrianglesPerMesh) {
        issues.push({
          severity: 'error', asiId: e.asiId, meshName: component.meshName,
          message: `component ${component.meshName} has ${component.geometry.triangles} triangles, over the per-mesh budget of ${budget.maxTrianglesPerMesh}`,
        });
      }
      if (options.fileSizes) {
        const bytes = options.fileSizes.get(component.file);
        if (bytes === undefined) {
          issues.push({
            severity: 'error', asiId: e.asiId, meshName: component.meshName,
            message: `component mesh file not found: ${component.file}`,
          });
        }
      }
      if (component.fma.status !== 'verified') {
        issues.push({
          severity: 'warning', asiId: e.asiId, meshName: component.meshName,
          message: `component ${component.meshName} FMA binding is unverified`,
        });
      }
    }

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

    // A composite's own files are checked per component above; its aggregate budget
    // still counts toward the manifest total.
    if (options.fileSizes && e.file) {
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
    // Every generated file, including composite components, counts against the
    // byte budget. Counting only `entry.file` would let a composite hide its real
    // weight from the budget that exists to bound exactly that.
    for (const e of manifest.entries)
      for (const file of [e.file, ...(e.composite?.components.map((c) => c.file) ?? [])])
        if (file) totalBytes += options.fileSizes.get(file) ?? 0;
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
    if (e.fma?.status === 'unverified') {
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
