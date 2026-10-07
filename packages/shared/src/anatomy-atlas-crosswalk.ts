import { z } from 'zod';

import { getStructure, REGIONS, type BodyRegion } from './anatomy.ts';

/**
 * THE ATLAS -> DOMAIN CROSSWALK.
 *
 * The Atlas carries BodyParts3D structures that are more detailed than the ASI
 * ontology. For the right shoulder: 43 atlas structures, 10 canonical `asi:*`
 * structures. The other 33 -- the clavicle, the humerus, every vessel in the
 * axilla -- have no canonical identity at all, and there is no honest way to
 * invent one.
 *
 * They are still completely usable. A person may search for them, hover them,
 * isolate them, hide them, and use them as spatial context. What they may not do
 * is become a persisted `SymptomRecord` structure id, because
 * `location.userSelectedStructureIds` is a set of canonical ids and anything
 * else in it is a value the domain cannot resolve.
 *
 * So the rule is enforced here, once, in a pure module both the viewer and the
 * server can use:
 *
 *   atlas structure id  ->  canonical asi:* id  ->  writable?
 *   bp3d:FJ3384         ->  asi:shoulder.scapula  ->  yes
 *   bp3d:FJ3362         ->  (none)                 ->  no, view only
 *
 * `resolveAtlasSelection` is the ONLY function in the product allowed to turn an
 * atlas structure into something the record can hold. If a future code path
 * needs that conversion, it calls this, and a view-only structure simply has no
 * result. There is no second place to get it wrong.
 */

/** The view-only case, made explicit rather than returned as null. */
export type AtlasSelectionOutcome =
  | {
      /** The structure may be written to the record. */
      readonly writable: true;
      readonly atlasStructureId: string;
      readonly canonicalAsiId: string;
      readonly label: string;
    }
  | {
      /**
       * The structure is displayable but has no canonical identity. It can be
       * searched, hovered, isolated and hidden; it cannot be recorded.
       */
      readonly writable: false;
      readonly atlasStructureId: string;
      readonly label: string;
      /** Why, in one sentence, for the interface to show. */
      readonly reason: string;
    };

/**
 * Why a structure is view-only, phrased for a person rather than a developer.
 *
 * The honest explanation is the useful one: the source model is more finely
 * divided than the vocabulary this product records in. Saying "no canonical
 * mapping" would be accurate and would also read like an error.
 */
export const VIEW_ONLY_REASON =
  'This model shows more anatomical detail than the vocabulary this record is written in. ' +
  'You can look at it and use it for context, but there is no matching entry to record it against.';

/**
 * Decide whether an atlas selection may be written to a SymptomRecord.
 *
 * Pure and total: every atlas structure gets an answer, and the "no" answer is a
 * real outcome rather than an error to be handled by the caller.
 */
export function resolveAtlasSelection(
  structure: {
    id: string;
    label: string;
    canonicalAsiId?: string | null;
    symptomRecordSelectable?: boolean;
  },
  options: { region?: BodyRegion } = {},
): AtlasSelectionOutcome {
  const selectable = structure.symptomRecordSelectable === true;
  const canonicalAsiId = structure.canonicalAsiId ?? null;

  // A structure is writable only if it says so AND names a canonical id AND that
  // id is a structure the domain actually knows. The third check is what stops a
  // typo in a generated manifest from becoming an unresolvable value in the
  // record: it is cheap and it is the only place that knows what the domain
  // contains.
  if (selectable && canonicalAsiId) {
    if (getStructure(canonicalAsiId)) {
      return {
        writable: true,
        atlasStructureId: structure.id,
        canonicalAsiId,
        label: structure.label,
      };
    }
  }

  return {
    writable: false,
    atlasStructureId: structure.id,
    label: structure.label,
    reason: VIEW_ONLY_REASON,
  };
}

/**
 * Which canonical asi ids an atlas manifest offers, and which are writable.
 *
 * For the interface: this is how a search result can say "recordable" or "view
 * only" BEFORE the user clicks, rather than refusing after they have.
 */
export interface AtlasSelectableIndex {
  /** Every atlas structure id, in manifest order. */
  readonly all: readonly string[];
  /** Atlas structure ids that may be written to a record. */
  readonly writable: ReadonlySet<string>;
  /** atlasStructureId -> canonical asi id, writable entries only. */
  readonly toCanonical: ReadonlyMap<string, string>;
}

export function buildSelectableIndex(
  structures: readonly {
    id: string;
    label: string;
    canonicalAsiId?: string | null;
    symptomRecordSelectable?: boolean;
  }[],
): AtlasSelectableIndex {
  const all: string[] = [];
  const writable = new Set<string>();
  const toCanonical = new Map<string, string>();
  for (const s of structures) {
    all.push(s.id);
    const outcome = resolveAtlasSelection(s);
    if (outcome.writable) {
      writable.add(s.id);
      toCanonical.set(s.id, outcome.canonicalAsiId);
    }
  }
  return { all, writable, toCanonical };
}

/**
 * A guard for write paths that receive an id of unknown provenance.
 *
 * `location.userSelectedStructureIds` is a set of canonical ids. If a raw
 * BodyParts3D id ever reaches a mutation -- a copy-paste, a bad bridge, a
 * regression in the viewer -- this is the function that refuses it, and it
 * refuses on the PREFIX as well as on resolution, so a well-formed-looking id
 * that happens not to resolve cannot slip through either.
 */
/**
 * Which region owns a canonical structure.
 *
 * A `Structure` carries no region of its own -- it belongs to whichever
 * `SubRegion` holds it -- so this is a lookup rather than a field read. Asking for
 * the region instead of inferring it from the id prefix is deliberate: the two
 * spellings differ for some regions, and a structure that is not in any region
 * must report that rather than have a region guessed from its own name.
 */
export function regionOfStructure(id: string): BodyRegion | undefined {
  for (const [region, definition] of Object.entries(REGIONS) as [BodyRegion, (typeof REGIONS)[BodyRegion]][]) {
    if (definition.subRegions.some((sub) => sub.structures.some((s) => s.id === id))) return region;
  }
  return undefined;
}

export function assertCanonicalStructureId(id: string, region?: BodyRegion): string {
  if (id.startsWith('bp3d:')) {
    throw new Error(
      `refusing to persist a raw BodyParts3D id ("${id}") as a SymptomRecord structure id. ` +
        'Atlas structures are view-only unless the crosswalk maps them to a canonical asi:* id; ' +
        'use resolveAtlasSelection.',
    );
  }
  const structure = getStructure(id);
  if (!structure) {
    throw new Error(`"${id}" is not a structure the domain knows, so it cannot be recorded`);
  }
  if (region) {
    const owner = regionOfStructure(id);
    if (owner !== region) {
      throw new Error(
        `"${id}" belongs to ${owner ?? 'no region'}, not ${region}; a ${region} record cannot hold it`,
      );
    }
  }
  return id;
}

/* ------------------------------------------------------------------ */
/* Reading a run-length grid. Shared so the viewer and the tests agree.  */
/* ------------------------------------------------------------------ */

/**
 * Which structure a grid cell names, or undefined for empty space.
 *
 * Empty is a real answer rather than an error: these maps are scoped to one
 * region, so most of the canvas is legitimately outside the anatomy. The caller
 * has to decide what that means -- see `resolveAtlasSelection` for the rule that
 * decides whether a hit may be recorded.
 */
export function gridIdAt(g: DerivedViewGrid, x: number, y: number): string | undefined {
  if (x < 0 || y < 0 || x >= g.grid.w || y >= g.grid.h) return undefined;
  for (const [startX, length, structureIndex] of g.rows[y] ?? []) {
    if (x >= startX && x < startX + length) return g.structures[structureIndex];
  }
  return undefined;
}

/**
 * The image is square; the grid is not.
 *
 * Treating a click as the same fraction of width and height biases every tap
 * upward, which reads as "the map is slightly wrong" rather than as a coordinate
 * bug. `offsetFraction` is the caller's measurement, in 0..1.
 */
export function cellFromFraction(
  g: DerivedViewGrid,
  fx: number,
  fy: number,
): { x: number; y: number } {
  return {
    x: Math.min(g.grid.w - 1, Math.max(0, Math.floor(fx * g.grid.w))),
    y: Math.min(g.grid.h - 1, Math.max(0, Math.floor(fy * g.grid.h))),
  };
}

/**
 * Expand a grid to a row-major table of ids.
 *
 * Only for tests and for the coverage readout: the product resolves single cells
 * through `gridIdAt` and never needs the whole table.
 */
export function decodeDerivedGrid(g: DerivedViewGrid): string[][] {
  return Array.from({ length: g.grid.h }, (_, y) =>
    Array.from({ length: g.grid.w }, (_, x) => gridIdAt(g, x, y) ?? ''),
  );
}

/** Every distinct structure a grid can resolve to, for the coverage note. */
export function distinctGridStructures(g: DerivedViewGrid): string[] {
  return [...new Set(g.rows.flat().map(([, , si]) => g.structures[si]))].filter(
    (id): id is string => typeof id === 'string',
  );
}

/* ------------------------------------------------------------------ */
/* The 2D view manifest: derived orthographic maps over the same source */
/* ------------------------------------------------------------------ */

export const DerivedViewNameSchema = z.enum(['front', 'back', 'left', 'right']);
export type DerivedViewName = z.infer<typeof DerivedViewNameSchema>;

/**
 * The four layers the derived pipeline renders where the source supports them.
 *
 * NOT the product's `TissueLayer`. That union carries skin/subcutaneous/fascia/
 * tendon/ligament/joint/nerve, most of which BodyParts3D does not model for the
 * shoulder at all. Mapping a renderable set onto the full tissue vocabulary is
 * exactly the kind of claim this project refuses to make, so the two are kept
 * apart and the coverage panel states the difference.
 */
export const DerivedLayerSchema = z.enum(['surface', 'bone', 'muscle', 'vascular']);
export type DerivedLayer = z.infer<typeof DerivedLayerSchema>;

export const DerivedViewGridSchema = z
  .object({
    schemaVersion: z.literal(1),
    view: DerivedViewNameSchema,
    layer: DerivedLayerSchema,
    grid: z.object({ w: z.number().int().positive(), h: z.number().int().positive() }),
    /**
     * False when the layer draws only skin, which is context and carries no
     * selectable structure. Stated rather than implied by an empty grid.
     */
    selectable: z.boolean(),
    note: z.string().min(1),
    /**
     * How many cells were dropped because they named skin.
     *
     * Skin is the whole-body context shell, not a canonical structure, so it is
     * removed from the hit map. Recording how many were removed is what makes that
     * a stated decision rather than a silent hole in the map.
     */
    skinCellsDropped: z.number().int().nonnegative(),
    /** Human-readable count per structure, for the coverage note. Not authority. */
    structureCells: z.record(z.string(), z.number().int().nonnegative()),
    structures: z.array(z.string()),
    /** Per row: [startX, length, structureIndex] runs into structures[]. */
    rows: z.array(z.array(z.tuple([z.number().int(), z.number().int(), z.number().int()]))),
  })
  .strict();
export type DerivedViewGrid = z.infer<typeof DerivedViewGridSchema>;

export const DerivedViewEntrySchema = z.object({
  image: z.string().min(1),
  grid: z.string().min(1),
  pngBytes: z.number().int().nonnegative(),
  gridBytes: z.number().int().nonnegative(),
  selectable: z.boolean(),
  cellsFilled: z.number().int().nonnegative(),
  cellsTotal: z.number().int().nonnegative(),
  distinctStructures: z.number().int().nonnegative(),
});
export type DerivedViewEntry = z.infer<typeof DerivedViewEntrySchema>;

export const DerivedViewsManifestSchema = z
  .object({
    schemaVersion: z.literal(1),
    region: z.string().min(1),
    side: z.enum(['left', 'right', 'midline']),
    /** The atlas manifest these views were rendered from. Same ids, same geometry. */
    sourceAtlasManifest: z.string().min(1),
    generator: z.object({ name: z.string().min(1), version: z.string().min(1) }),
    grid: z.object({ w: z.number().int().positive(), h: z.number().int().positive() }),
    views: z.record(DerivedViewNameSchema, z.object({ layers: z.record(DerivedLayerSchema, DerivedViewEntrySchema) })),
    provenance: z.object({
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
      geometryModified: z.literal(false),
      modification: z.string().min(1),
      handDrawn: z.literal(false),
      aiGenerated: z.literal(false),
      codeLicence: z.literal('MIT'),
      assetLicence: z.literal('CC BY 4.0'),
    }),
  })
  .strict();
export type DerivedViewsManifest = z.infer<typeof DerivedViewsManifestSchema>;