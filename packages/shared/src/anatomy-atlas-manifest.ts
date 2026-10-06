import { z } from 'zod';

/**
 * The ATLAS manifest contract.
 *
 * This is NOT the canonical anatomy asset contract, and it is deliberately a
 * different document at a different path
 * (`assets/anatomy/atlas/<region>/<side>/atlas-manifest.json`).
 *
 * WHY IT IS SEPARATE
 * ------------------
 * The canonical `AssetManifest` in anatomy-manifest.ts describes DOMAIN evidence:
 * one entry per canonical `asi:*` structure, the source mesh it was bound to, its
 * laterality, and the geometry budget. It is the product's answer to "which
 * anatomy do we claim, and on what evidence".
 *
 * The atlas viewer needs something the canonical manifest cannot be: structures
 * that are more detailed than the ASI ontology. BodyParts3D has 42 shoulder
 * meshes; the canonical ontology has 10 shoulder entries. A viewer that showed
 * only canonical entries could not show a clavicle, a humerus, a deltoid's
 * neighbours, or any vessel. So the atlas carries all 43 and marks each one with
 * whether it is legal to write into a SymptomRecord.
 *
 * That difference is not a reason to overload the canonical document. An earlier
 * atlas build wrote its viewer manifest straight to
 * `assets/anatomy/generated/shoulder/right/manifest.json`, replacing the
 * canonical file and breaking 12 laterality tests that read real builds as
 * evidence. Those tests were right and the overwrite was wrong.
 *
 * SO THE CROSSWALK IS EXPLICIT
 * ---------------------------
 * Every atlas structure carries:
 *   - `atlasStructureId`     the atlas's own id, `bp3d:FJ####`
 *   - `sourceMeshName`       the BodyParts3D mesh it came from
 *   - `canonicalAsiId`       the `asi:*` id, or null when there is no mapping
 *   - `symptomRecordSelectable` whether that mapping is legal to persist
 *
 * The invariant: `symptomRecordSelectable === true` REQUIRES a non-null
 * `canonicalAsiId` matching `asi:*`. A `bp3d:FJ####` must never become a
 * persisted domain structure id, and the only way that can happen is somebody
 * copying an atlas id into a write path, so the flag is the thing that stops it.
 *
 * A structure with no canonical mapping is still fully usable in the viewer: it
 * can be displayed, searched, hovered, isolated and hidden. It simply cannot be
 * written into the record.
 */

/** `bp3d:FJ1506` -- the atlas's own identity, never a domain identity. */
export const AtlasStructureIdSchema = z
  .string()
  .regex(/^bp3d:FJ\d+M?$/, 'an atlas structure id must be bp3d:FJ####, optionally with an M suffix');

/** `asi:shoulder.scapula` -- the only prefix allowed to reach a SymptomRecord. */
export const CanonicalAsiIdSchema = z
  .string()
  .regex(/^asi:[a-z_]+\.[a-z0-9-]+$/, 'a canonical asi id must look like asi:<region>.<structure>');

export const AtlasCoordinateSystemSchema = z
  .object({
    /**
     * Explicit, because the atlas spans two unit systems and a single ambiguous
     * top-level `units` field is exactly how they get mixed up: the previous
     * viewer manifest said `units: "metres"` while every `boundsMm` field it
     * carried was in millimetres.
     */
    sourceUnits: z.literal('mm'),
    renderUnits: z.literal('m'),
    /** Multiply a source-space value by this to get render space. */
    sourceToRenderScale: z.literal(0.001),
    /** The GLB was exported Y-up, so the viewer must not re-apply the rotation. */
    glTFYUp: z.literal(true),
    /**
     * Source axis convention, stated rather than inferred. An import once rotated
     * the body silently and every camera preset became confidently wrong.
     */
    sourceAxes: z.object({
      anterior: z.literal('-Y'),
      posterior: z.literal('+Y'),
      superior: z.literal('+Z'),
      bodyRight: z.literal('-X'),
    }),
  })
  .strict();
export type AtlasCoordinateSystem = z.infer<typeof AtlasCoordinateSystemSchema>;

const Vec3Schema = z.tuple([z.number(), z.number(), z.number()]);

export const AtlasBoundsSchema = z
  .object({
    /** From the source dataset. Millimetres. */
    min: Vec3Schema,
    max: Vec3Schema,
    /** Same box in render space. Metres. Must be sourceBounds x 0.001. */
    renderMin: Vec3Schema,
    renderMax: Vec3Schema,
  })
  .strict();

export const AtlasStructureSchema = z
  .object({
    id: AtlasStructureIdSchema,
    label: z.string().min(1),

    /**
     * The BodyParts3D mesh this structure was built from. Not optional and not
     * nullable: an atlas structure with no source mesh has no provenance at all,
     * which is the thing this whole contract exists to prevent.
     */
    sourceMeshName: z.string().regex(/^FJ\d+M?$/),

    laterality: z.enum(['left', 'right', 'midline']),

    /** FMA evidence, carried with its status so it cannot read as verified. */
    fma: z.object({
      conceptId: z.string().nullable(),
      status: z.enum(['verified', 'unverified', 'pending_human_review']),
    }),
    /** BodyParts3D concept id, where the source declares one. */
    bp: z.string().nullable(),

    /** The system the viewer colours and layers this by. */
    presentationSystem: z.string().min(1),
    /** How that system was decided. Presentation evidence only. */
    presentationSystemClassification: z.enum([
      'source_declared',
      'evidence_supported',
      'machine_derived',
      'manual_review',
    ]),
    /** The ontology axis, carried SEPARATELY and never upgraded by presentation. */
    ontologyFmaVerification: z.enum(['verified', 'unverified', 'pending_human_review']),

    triangles: z.number().int().nonnegative(),

    /**
     * THE CROSSWALK.
     *
     * `canonicalAsiId` is null when this structure has no canonical mapping, and
     * then `symptomRecordSelectable` must be false.
     */
    canonicalAsiId: CanonicalAsiIdSchema.nullable(),
    symptomRecordSelectable: z.boolean(),

    /** Role in the scene. `context` structures are shell, not anatomy claims. */
    role: z.enum(['primary', 'context']),

    /** Null for a context structure that is whole-body and not in the source set. */
    sourceBounds: AtlasBoundsSchema.nullable(),
  })
  .strict();
export type AtlasStructure = z.infer<typeof AtlasStructureSchema>;

export const AtlasUnavailableSystemSchema = z
  .object({
    system: z.string().min(1),
    reason: z.string().min(1),
    /**
     * How many meshes the whole-body source does have of this system. Required
     * and required to be non-zero: a not-in-source claim with a zero count would
     * imply the tissue does not exist in anatomy, which is a different statement.
     */
    wholeBodySourceCount: z.number().int().positive(),
  })
  .strict();

export const AtlasProvenanceSchema = z
  .object({
    dataset: z.literal('BodyParts3D'),
    release: z.string().min(1),
    archive: z.string().min(1),
    archiveSha256: z.string().regex(/^[a-f0-9]{64}$/),
    doi: z.string().min(1),
    licence: z.literal('CC-BY-4.0'),
    licenceUrl: z.string().url(),
    attribution: z.string().min(1),
    retrievedAt: z.string().nullable(),
    officialLicenseLastUpdated: z.string().nullable(),
    ourLicenseEvidenceCheckedAt: z.string().nullable(),
    /** The source geometry is used unmodified; what we made is derived. */
    geometryModified: z.literal(false),
    modification: z.string().min(1),
    codeLicence: z.literal('MIT'),
    assetLicence: z.literal('CC BY 4.0'),
  })
  .strict();

export const AtlasManifestSchema = z
  .object({
    /** Bumped when the atlas contract changes shape, not when content changes. */
    schemaVersion: z.literal(1),

    region: z.string().min(1),
    side: z.enum(['left', 'right', 'midline']),

    /** The canonical manifest this was derived from, by path. */
    derivedFrom: z.object({
      canonicalManifestPath: z.string().min(1),
      canonicalManifestSchemaVersion: z.literal(1),
      /** Inputs, all of which are authoritative rather than hand-maintained. */
      inputs: z.array(z.string().min(1)).min(1),
    }),
    generator: z.object({ name: z.string().min(1), version: z.string().min(1) }),

    coordinateSystem: AtlasCoordinateSystemSchema,

    /** The combined region GLB the viewer loads. */
    atlas: z.object({
      file: z.string().min(1),
      objects: z.number().int().nonnegative(),
      triangles: z.number().int().nonnegative(),
      bytes: z.number().int().nonnegative(),
    }),
    /** The whole-body shell. Context, never selectable. */
    bodyContext: z.object({
      file: z.string().min(1),
      objects: z.number().int().nonnegative(),
      triangles: z.number().int().nonnegative(),
      bytes: z.number().int().nonnegative(),
    }),

    structures: z.array(AtlasStructureSchema),

    /** Systems the source does not carry for this region, stated not hidden. */
    unavailableInSource: z.array(AtlasUnavailableSystemSchema),

    provenance: AtlasProvenanceSchema,
  })
  .strict();
export type AtlasManifest = z.infer<typeof AtlasManifestSchema>;

/* ------------------------------------------------------------------ */
/* Cross-checks a per-entry schema cannot express                       */
/* ------------------------------------------------------------------ */

export interface AtlasIssue {
  severity: 'error' | 'warning';
  structureId?: string;
  message: string;
}

/**
 * The invariants that matter, and that a Zod schema cannot see because they are
 * relations BETWEEN fields and between this document and the canonical one.
 */
export function validateAtlasManifest(
  manifest: AtlasManifest,
  options: {
    /** asi ids the domain actually knows, when the caller can supply them. */
    knownCanonicalAsiIds?: ReadonlySet<string>;
  } = {},
): AtlasIssue[] {
  const issues: AtlasIssue[] = [];
  const scale = manifest.coordinateSystem.sourceToRenderScale;
  const seen = new Set<string>();

  for (const s of manifest.structures) {
    if (seen.has(s.id)) {
      issues.push({ severity: 'error', structureId: s.id, message: 'duplicate atlas structure id' });
    }
    seen.add(s.id);

    // THE invariant. A selectable structure must name the canonical id it is
    // selecting. Without this, `symptomRecordSelectable: true` next to a
    // `bp3d:FJ####` id is a raw source id one refactor away from being persisted.
    if (s.symptomRecordSelectable && s.canonicalAsiId === null) {
      issues.push({
        severity: 'error',
        structureId: s.id,
        message: 'symptomRecordSelectable is true but canonicalAsiId is null',
      });
    }
    // And the converse, because a canonical id that is not selectable would be
    // structure the record may name but the viewer cannot hand over.
    if (!s.symptomRecordSelectable && s.canonicalAsiId !== null) {
      issues.push({
        severity: 'warning',
        structureId: s.id,
        message: 'has a canonicalAsiId but is marked not symptomRecordSelectable',
      });
    }
    if (s.canonicalAsiId && options.knownCanonicalAsiIds && !options.knownCanonicalAsiIds.has(s.canonicalAsiId)) {
      issues.push({
        severity: 'error',
        structureId: s.id,
        message: `canonicalAsiId ${s.canonicalAsiId} is not an asi id the domain knows`,
      });
    }

    // A primary structure must have source bounds. Context may not: the
    // whole-body shell is not part of the scoped source set.
    if (s.role === 'primary' && s.sourceBounds === null) {
      issues.push({ severity: 'error', structureId: s.id, message: 'primary structure has no source bounds' });
    }

    if (s.sourceBounds) {
      // The two unit systems are the whole reason this contract spells them out,
      // so prove they agree rather than trusting the generator.
      for (const axis of ['x', 'y', 'z'] as const) {
        const i = axis === 'x' ? 0 : axis === 'y' ? 1 : 2;
        const lo = s.sourceBounds.min[i];
        const hi = s.sourceBounds.max[i];
        const rlo = s.sourceBounds.renderMin[i];
        const rhi = s.sourceBounds.renderMax[i];
        if (lo === undefined || hi === undefined || rlo === undefined || rhi === undefined) continue;
        if (lo > hi) {
          issues.push({ severity: 'error', structureId: s.id, message: `sourceBounds min.${axis} exceeds max.${axis}` });
        }
        if (Math.abs(rlo - lo * scale) > 1e-9 || Math.abs(rhi - hi * scale) > 1e-9) {
          issues.push({
            severity: 'error',
            structureId: s.id,
            message: `render bounds on ${axis} are not source bounds x ${scale}`,
          });
        }
      }
    }

    // Presentation evidence must not silently upgrade the ontology axis. This is
    // the two-axis rule: a system can be evidence_supported for colouring while
    // the FMA identity is still pending human review.
    if (
      s.presentationSystemClassification === 'evidence_supported' &&
      s.ontologyFmaVerification === 'verified'
    ) {
      issues.push({
        severity: 'warning',
        structureId: s.id,
        message: 'presentation evidence is cited while the ontology axis claims verified',
      });
    }
  }

  const selectable = manifest.structures.filter((s) => s.symptomRecordSelectable).length;
  if (selectable === 0) {
    issues.push({
      severity: 'error',
      message: 'no atlas structure is symptomRecordSelectable; the viewer could not start a record',
    });
  }

  return issues;
}

export function atlasHasErrors(issues: AtlasIssue[]): boolean {
  return issues.some((i) => i.severity === 'error');
}