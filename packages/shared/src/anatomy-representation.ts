/**
 * Anatomical identity versus representation capability.
 *
 * These are two different questions and the codebase must never answer one with
 * the other:
 *
 *   "Does this concept exist?"          — anatomy. A thing in the body.
 *   "Can we draw it from the sources?"  — representation. A thing in OUR assets.
 *
 * A concept with no mesh is not a concept that does not exist. The acromion is a
 * bone whether or not BodyParts3D 4.0 ships an isolated mesh for it, and a build
 * that cannot render it has a GAP, not a finding. Collapsing the two produces the
 * two failures this file exists to prevent:
 *
 *   - deleting the acromion from the anatomy model because no asset was found,
 *     which erases a real structure from the product's vocabulary; and
 *   - binding the acromion to the scapula, which is anatomically wrong and
 *     renders a plausible-looking bone where the user pointed at a different one.
 *
 * So capability is stated, per concept, with a REASON CODE. A reason code is
 * machine-checkable and reviewable, which a free-text note is not.
 *
 * ## Why not one concept = one mesh
 *
 * Because that is not true of real anatomy data. BodyParts3D's deltoid exists only
 * as three parts, so the deltoid is a COMPOSITE of three external concepts; a
 * concept may equally be a space rather than a solid, or a sub-region of a larger
 * mesh. The mapping already expresses that by binding one `asiId` to several
 * source elements; this file is where the CONSEQUENCE of that lives, so the viewer
 * and the adapters consume a declared capability rather than inferring one from a
 * filename or from a mesh's absence.
 *
 * ## What this deliberately does not do
 *
 * It does not synthesise a stand-in. There is no `placeholder` status here, and
 * adding one would defeat the purpose: a declared gap is visible and safe, whereas
 * a placeholder that reaches the anatomy library is a convincing lie. Test
 * fixtures remain fixtures — they live in `test/` and are never described here.
 */
import { z } from 'zod';
import type { Structure, TissueLayer } from './anatomy.ts';

/**
 * Why a concept cannot be represented, as a closed vocabulary.
 *
 * These are the only honest reasons, and each is chosen because it points at
 * something a reader must do differently:
 *
 *   `no-source-concept`  the source dataset has no such concept at all
 *   `non-solid-space`    the concept is a space, and the source carries solids
 *   `not-yet-sourced`    the concept exists here and has no approved source yet
 *   `composite-unsupported`  it needs several sources joined, which nothing does yet
 *
 * `no-mesh-in-source` exists for a source that HAS the concept but shipped no
 * geometry for it, which is a different situation from the source not modelling the
 * concept at all. Distinguishing them matters when a new archive is audited.
 */
export const RepresentationGapReasonSchema = z.enum([
  'no-source-concept',
  'no-mesh-in-source',
  'non-solid-space',
  'not-yet-sourced',
  'composite-unsupported',
]);
export type RepresentationGapReason = z.infer<typeof RepresentationGapReasonSchema>;

/**
 * A 2D representation, which is independent of 3D.
 *
 * The distinction is not decorative: a structure can have legitimate schematic 2D
 * geometry and no valid 3D geometry, and reporting it as simply "unavailable" would
 * throw away a working representation along with the missing one.
 */
export const Representation2DSchema = z.object({
  available: z.boolean(),
  /**
   * `true` marks PLACEHOLDER GEOMETRY — hand-built, schematic, or otherwise not
   * professionally sourced medical content.
   *
   * Phase 1A's body map is exactly this: drawn by hand to answer \"is the viewer
   * usable\" before any external 2D library existed. It is honest to render and
   * wrong to ship, so the flag travels with the capability and a production 2D
   * asset cannot be mistaken for it.
   */
  placeholder: z.boolean().default(false),
  source: z.string().nullish(),
});
export type Representation2D = z.infer<typeof Representation2DSchema>;

export const Representation3DSchema = z.discriminatedUnion('status', [
  z.object({
    status: z.literal('available'),
    /** How many external elements make it up. Never assumed to be one. */
    elementCount: z.number().int().positive(),
    /** Which sides the available geometry covers, from the source's own naming. */
    sides: z.array(z.enum(['left', 'right'])).min(1),
  }),
  z.object({
    status: z.literal('unavailable'),
    reason: RepresentationGapReasonSchema,
    /** Why, in words. The reason code is the checkable part; this is for a human. */
    detail: z.string(),
  }),
]);
export type Representation3D = z.infer<typeof Representation3DSchema>;

export const RepresentationSchema = z.object({
  twoD: Representation2DSchema,
  threeD: Representation3DSchema,
});
export type Representation = z.infer<typeof RepresentationSchema>;

/**
 * Declared overrides, keyed by `asiId`.
 *
 * Held as data rather than inferred so the source of every claim is inspectable.
 * A structure with no entry here is NOT assumed unavailable — it is ASSUMED
 * unreviewed, which `representationFor` reports as `not-yet-sourced`. That default
 * is the important part: it means a new structure cannot quietly inherit a
 * representation nobody has checked, and a build cannot claim 3D for something
 * because a filename happened to match.
 */
const REPRESENTATION_DECLARATIONS: Readonly<Record<string, Representation>> = {
  // --- Bound to real BodyParts3D 4.0 elements, verified against the archive ---
  'asi:shoulder.supraspinatus-tendon': {
    twoD: { available: true, placeholder: true },
    threeD: { status: 'available', elementCount: 1, sides: ['left'] },
  },
  'asi:shoulder.infraspinatus': {
    twoD: { available: true, placeholder: true },
    threeD: { status: 'available', elementCount: 1, sides: ['left'] },
  },
  'asi:shoulder.teres-minor': {
    twoD: { available: true, placeholder: true },
    threeD: { status: 'available', elementCount: 1, sides: ['left'] },
  },
  'asi:shoulder.subscapularis': {
    twoD: { available: true, placeholder: true },
    threeD: { status: 'available', elementCount: 1, sides: ['left'] },
  },
  'asi:shoulder.trapezius-upper': {
    twoD: { available: true, placeholder: true },
    threeD: { status: 'available', elementCount: 1, sides: ['left'] },
  },
  'asi:shoulder.scapula': {
    twoD: { available: true, placeholder: true },
    threeD: { status: 'available', elementCount: 1, sides: ['left'] },
  },
  'asi:shoulder.biceps-long-head-tendon': {
    twoD: { available: true, placeholder: true },
    threeD: { status: 'available', elementCount: 1, sides: ['left'] },
  },

  // --- Part-level deltoid, from the source's own terminology ---
  //
  // BodyParts3D 4.0 has no whole-muscle deltoid; it has three parts, each a
  // separate FMA concept with its own geometry. Naming them after the SOURCE is the
  // point: `clavicular`/`acromial`/`spinal` are the source's names, and renaming
  // them to anterior/middle/posterior to match our sub-regions would be our
  // vocabulary imposed on its data, which is the mistake the mapping table already
  // made once with invented filenames.
  'asi:shoulder.deltoid-clavicular-part': {
    twoD: { available: false, placeholder: false },
    threeD: { status: 'available', elementCount: 1, sides: ['left'] },
  },
  'asi:shoulder.deltoid-acromial-part': {
    twoD: { available: false, placeholder: false },
    threeD: { status: 'available', elementCount: 1, sides: ['left'] },
  },
  'asi:shoulder.deltoid-spinal-part': {
    twoD: { available: false, placeholder: false },
    threeD: { status: 'available', elementCount: 1, sides: ['left'] },
  },

  // --- Concepts that exist, with no valid 3D in the current source ---
  //
  // Searched in isa_element_parts.txt across the WHOLE vocabulary, not only our
  // spellings. These are absences of a SOURCE CONCEPT, not failed searches, which
  // is why the reason code is `no-source-concept` rather than `no-mesh-in-source`.
  'asi:shoulder.deltoid': {
    twoD: { available: true, placeholder: true },
    threeD: {
      status: 'unavailable',
      reason: 'composite-unsupported',
      detail:
        'BodyParts3D 4.0 has no whole-muscle deltoid. It exists only as three parts, each with its own asi: identity, and joining them into one representation is not implemented. Binding one part to the whole deltoid would render a third of the muscle as all of it.',
    },
  },
  'asi:shoulder.acromion': {
    twoD: { available: true, placeholder: true },
    threeD: {
      status: 'unavailable',
      reason: 'no-source-concept',
      detail:
        'no acromion concept exists anywhere in isa_element_parts.txt for BodyParts3D 4.0; the dataset has no isolated acromion mesh',
    },
  },
  'asi:shoulder.coracoid': {
    twoD: { available: true, placeholder: true },
    threeD: {
      status: 'unavailable',
      reason: 'no-source-concept',
      detail: 'no coracoid concept exists in the archive',
    },
  },
  'asi:shoulder.glenohumeral-joint': {
    twoD: { available: true, placeholder: true },
    threeD: {
      status: 'unavailable',
      reason: 'no-source-concept',
      detail:
        'no glenohumeral joint concept exists; the dataset carries bones and muscles, not joint spaces',
    },
  },
  'asi:shoulder.acromioclavicular-joint': {
    twoD: { available: true, placeholder: true },
    threeD: {
      status: 'unavailable',
      reason: 'no-source-concept',
      detail: 'no acromioclavicular joint concept exists in the archive',
    },
  },
  'asi:shoulder.spine-of-scapula': {
    twoD: { available: true, placeholder: true },
    threeD: {
      status: 'unavailable',
      reason: 'no-source-concept',
      detail:
        'no spine-of-scapula concept exists; the dataset has the scapula as a whole bone only',
    },
  },
  'asi:shoulder.subacromial-bursa': {
    twoD: { available: true, placeholder: true },
    threeD: {
      status: 'unavailable',
      reason: 'non-solid-space',
      detail:
        'a bursal space, and BodyParts3D carries solid anatomy only. A space is a real anatomical concept, so it stays in the model with 2D representation and no 3D.',
    },
  },
};

/**
 * Representation for one structure.
 *
 * An undeclared structure is reported as `not-yet-sourced` rather than
 * unavailable, because the truth is that nobody has checked: claiming either
 * availability or unavailability would be a claim about a source we have not read.
 */
export function representationFor(structure: Structure | string): Representation {
  const id = typeof structure === 'string' ? structure : structure.id;
  const declared = REPRESENTATION_DECLARATIONS[id];
  if (declared) return declared;
  return {
    twoD: { available: false, placeholder: false },
    threeD: {
      status: 'unavailable',
      reason: 'not-yet-sourced',
      detail: `no representation has been reviewed for ${id}`,
    },
  };
}

/** True when this structure has 3D geometry we may actually render. */
export function hasThreeD(structure: Structure | string): boolean {
  return representationFor(structure).threeD.status === 'available';
}

/** True when any 3D representation is declared unavailable, with the reason. */
export function threeDGapFor(structure: Structure | string): Representation3D | null {
  const threeD = representationFor(structure).threeD;
  return threeD.status === 'unavailable' ? threeD : null;
}

/** True when the only 2D we have is hand-made placeholder geometry. */
export function isPlaceholder2D(structure: Structure | string): boolean {
  return representationFor(structure).twoD.placeholder;
}

/**
 * Every declared gap, for a build log or a review.
 *
 * Sorted so the output is stable: a report that reorders between runs cannot be
 * diffed, and a diff is how a mapping change gets reviewed.
 */
export function declaredRepresentationGaps(): {
  asiId: string;
  reason: RepresentationGapReason;
  detail: string;
}[] {
  return Object.entries(REPRESENTATION_DECLARATIONS)
    .flatMap(([asiId, r]) =>
      r.threeD.status === 'unavailable'
        ? [{ asiId, reason: r.threeD.reason, detail: r.threeD.detail }]
        : [],
    )
    .sort((a, b) => a.asiId.localeCompare(b.asiId));
}

/**
 * Guard: a structure may not claim 3D without saying which sides it covers.
 *
 * A build that reports `available` with `sides: ['left']` while the manifest
 * contains geometry for the right is claiming something false, and the failure is
 * invisible until a user looks at the wrong shoulder. `sides` is therefore
 * non-empty by schema, and callers compare it against the geometry they produced.
 */
export function assertSidesMatch(
  asiId: string,
  declared: Representation3D,
  produced: readonly ('left' | 'right')[],
): void {
  if (declared.status !== 'available') return;
  const missing = declared.sides.filter((s) => !produced.includes(s));
  if (missing.length)
    throw new Error(
      `${asiId} declares 3D for ${declared.sides.join(' and ')} but the build produced only ` +
        `${produced.join(' and ') || 'nothing'}. Missing: ${missing.join(', ')}.`,
    );
}

/**
 * Tissue layers a representation may occupy, for callers that need to reason about
 * what a gap means for depth visibility.
 *
 * Kept as a helper rather than a field because layer is anatomy, not representation,
 * and duplicating it per declaration would let the two drift.
 */
export function layerOf(structure: Structure): TissueLayer {
  return structure.layer;
}