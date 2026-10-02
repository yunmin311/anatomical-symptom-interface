/**
 * BodyParts3D -> asi:* mapping.
 *
 * ## How a BodyParts3D mesh is actually named
 *
 * Not the way this file used to assume. Every mesh in `isa_BP3D_4.0_obj_99.zip` is
 * an `FJ####.obj` — a numeric element id — and every one of the 2234 files contains
 * exactly one unnamed group, `g grp1`. There is no anatomy anywhere in the mesh
 * files. A search for "Deltoid" across all 2234 filenames returns zero.
 *
 * The identity is in a SEPARATE download, `isa_element_parts.txt`, which is
 * tab-separated `concept id -> English name -> element file id`. Resolving a mesh
 * therefore takes three steps, not one:
 *
 *   English label -> FMA concept id -> isa_element_parts.txt -> FJ#### file
 *
 * and a mapping row has to name the FJ id, because that is what the pipeline can
 * actually find in a directory of files. The earlier version of this table listed
 * English labels such as `Deltoid_L`, which matched nothing: run against the real
 * archive it bound 0 of 14 structures. `scripts/audit-bodyparts3d.sh` exists to
 * make that failure impossible to miss again.
 *
 * ## Laterality, and why it is per-candidate and per-file
 *
 * Side is in the CONCEPT NAME, and which file carries which side is not guessable:
 *
 *   FJ1506   FMA32544  'right supraspinatus'   geometry entirely x < 0
 *   FJ1506M  FMA32545  'left supraspinatus'    geometry entirely x > 0
 *
 * So the base file is the RIGHT side and the `M` file is the LEFT. Reading `M` as
 * "mirror" would mirror the body the wrong way round. 220 of the 237 id pairs name
 * one side each and agree with their geometry; the other 17 (intercostals,
 * sphincters) name neither and must not be treated as a pair.
 *
 * `M` is also NOT a reflection in general: the vertex coordinate multisets differ
 * for 236 of 237 pairs, so nothing may assume it can be mirrored instead of loaded.
 *
 * Because a `asiId` is one structure and the source carries two sides of it, one
 * mesh is bound per (structure, side) and the side is recorded on the candidate.
 * `PIPELINE_SIDES` says which side a build represents; binding the same
 * `asiId` twice would make a visual selection ambiguous, which is why
 * `selectStructures` refuses a claimed mesh.
 *
 * ## What this table deliberately does NOT bind
 *
 * A structure with no honest counterpart is left unmapped with a reason. The
 * alternative -- binding something adjacent and shipping it as anatomy -- is the
 * failure this whole file exists to prevent.
 *
 * - `acromion`, `coracoid`, `glenohumeral-joint`, `acromioclavicular-joint`,
 *   `spine-of-scapula`: absent from this archive at ANY name. Not "not found by
 *   our spelling"; searching the whole vocabulary finds no such concept. BodyParts3D
 *   4.0 carries muscle and whole-bone meshes, not the small bones and joint spaces
 *   these ids name.
 * - `subacromial-bursa`: a space, and BodyParts3D carries solid anatomy. A space is
 *   still a real anatomical concept, so it stays in the model with 2D representation.
 * - `deltoid` (the whole muscle): the source HAS deltoid geometry, as three parts.
 *   The composite is therefore `composite-unsupported`, not `no-source-concept`, and
 *   the three parts are bound above under their own `asi:` ids. Binding one part to
 *   the composite would render a third of the muscle as all of it.
 *
 * Representation capability for all of these lives in `anatomy-representation.ts`,
 * which is where \"the concept exists\" is kept distinct from \"we can draw it\".
 *
 * `fmaConceptId` is recorded as a claim, not a fact. Nothing here has been checked
 * against FMA Explorer, so every entry stays 'unverified' until a human verifies
 * it. See docs/adr/0002-anatomy-model-source.md.
 */

/** Which side of the body a source mesh represents. */
export type SourceSide = 'left' | 'right' | 'bilateral' | 'midline' | 'not_applicable';

/** What a mesh in the source archive can be bound to. */
export interface SourceCandidate {
  /**
   * The mesh name as it appears in the ARCHIVE, which is an `FJ####` element id
   * (optionally `FJ####M` for the second side). NOT an anatomical label: the mesh
   * files contain no anatomy, and a label here would match nothing.
   */
  meshName: string;
  /**
   * The FMA concept id the concept list gives this exact file, which is how the
   * side and the anatomical name were recovered.
   */
  fmaConceptId: string | null;
  /**
   * Side carried by THIS file. Per-candidate because the base and `M` files of a
   * pair name different sides, and which is which is not guessable — see the file
   * header.
   */
  side: SourceSide;
  /** The English concept name, for a human auditing a binding. */
  sourceLabel: string | null;
}

/** One structure we want, and the source names that might carry it. */
export interface MappingEntry {
  asiId: string;
  /** Candidate source names, most specific first. */
  candidates: SourceCandidate[];
  /**
   * True when no source mesh carries this structure. A joint space, a bursa or a
   * named portion of a larger mesh has no single upstream counterpart, and
   * pretending otherwise would mean shipping geometry under a name it does not
   * have.
   */
  expectAbsent?: boolean;
}

/**
 * Which side a build represents.
 *
 * One build is one side. BodyParts3D carries both, and binding both into a single
 * `asiId` would make a visual selection ambiguous — `selectStructures` refuses a
 * claimed mesh for exactly that reason — so laterality is a build decision rather
 * than a mapping decision.
 */
export const PIPELINE_SIDES = ['left', 'right'] as const;
export type PipelineSide = (typeof PIPELINE_SIDES)[number];

/**
 * Shoulder, the Phase 1 vertical slice.
 *
 * Every `meshName` below was read out of `isa_element_parts.txt` for this archive
 * and cross-checked against the file's own geometry, not guessed. Left out are the
 * structures with no honest counterpart in BodyParts3D 4.0; they are listed in
 * `UNMAPPABLE_SHOULDER` with the reason, so a build reports the gap instead of
 * binding something adjacent.
 *
 * Candidates are per side. `side` is on the candidate because the base and `M` files
 * carry different sides and the mapping has to say which is which.
 */
export const SHOULDER_MAPPING: readonly MappingEntry[] = [
  // The three deltoid PARTS, each bound to the external element that IS that part.
  //
  // These are separate `asiId`s because each is a separate anatomical concept with
  // its own FMA id, geometry and provenance. Naming them after the source is the
  // point: `clavicular`/`acromial`/`spinal` are the dataset's terms, and renaming
  // them to anterior/middle/posterior would impose our vocabulary on its data.
  {
    asiId: 'asi:shoulder.deltoid-clavicular-part',
    candidates: [
      { meshName: 'FJ1468', fmaConceptId: '34680', side: 'right', sourceLabel: 'clavicular part of right deltoid' },
      { meshName: 'FJ1468M', fmaConceptId: '34681', side: 'left', sourceLabel: 'clavicular part of left deltoid' },
    ],
  },
  {
    asiId: 'asi:shoulder.deltoid-acromial-part',
    candidates: [
      { meshName: 'FJ1467', fmaConceptId: '34682', side: 'right', sourceLabel: 'acromial part of right deltoid' },
      { meshName: 'FJ1467M', fmaConceptId: '34683', side: 'left', sourceLabel: 'acromial part of left deltoid' },
    ],
  },
  {
    asiId: 'asi:shoulder.deltoid-spinal-part',
    candidates: [
      { meshName: 'FJ1513', fmaConceptId: '34684', side: 'right', sourceLabel: 'spinal part of right deltoid' },
      { meshName: 'FJ1513M', fmaConceptId: '34685', side: 'left', sourceLabel: 'spinal part of left deltoid' },
    ],
  },
  {
    asiId: 'asi:shoulder.supraspinatus-tendon',
    candidates: [
      { meshName: 'FJ1506', fmaConceptId: '32544', side: 'right', sourceLabel: 'right supraspinatus' },
      { meshName: 'FJ1506M', fmaConceptId: '32545', side: 'left', sourceLabel: 'left supraspinatus' },
    ],
  },
  {
    asiId: 'asi:shoulder.infraspinatus',
    candidates: [
      { meshName: 'FJ1500', fmaConceptId: '32547', side: 'right', sourceLabel: 'right infraspinatus muscle' },
      { meshName: 'FJ1500M', fmaConceptId: '32548', side: 'left', sourceLabel: 'left infraspinatus muscle' },
    ],
  },
  {
    asiId: 'asi:shoulder.teres-minor',
    candidates: [
      { meshName: 'FJ1508', fmaConceptId: '32553', side: 'right', sourceLabel: 'right teres minor' },
      { meshName: 'FJ1508M', fmaConceptId: '32554', side: 'left', sourceLabel: 'left teres minor' },
    ],
  },
  {
    asiId: 'asi:shoulder.subscapularis',
    candidates: [
      { meshName: 'FJ1504', fmaConceptId: '13414', side: 'right', sourceLabel: 'right subscapularis' },
      { meshName: 'FJ1504M', fmaConceptId: '13415', side: 'left', sourceLabel: 'left subscapularis' },
    ],
  },
  {
    // BodyParts3D carries the ascending (upper) portion as its own concept, which
    // is what our `trapezius-upper` id actually means. Binding it to a whole
    // trapezius would claim coverage we do not have.
    asiId: 'asi:shoulder.trapezius-upper',
    candidates: [
      { meshName: 'FJ1520', fmaConceptId: '33581', side: 'right', sourceLabel: 'ascending part of right trapezius' },
      { meshName: 'FJ1520M', fmaConceptId: '33583', side: 'left', sourceLabel: 'ascending part of left trapezius' },
    ],
  },
  {
    asiId: 'asi:shoulder.scapula',
    candidates: [
      { meshName: 'FJ3384', fmaConceptId: '13395', side: 'right', sourceLabel: 'right scapula' },
      { meshName: 'FJ3279', fmaConceptId: '13396', side: 'left', sourceLabel: 'left scapula' },
    ],
  },
  {
    asiId: 'asi:shoulder.biceps-long-head-tendon',
    candidates: [
      { meshName: 'FJ1478', fmaConceptId: '37686', side: 'right', sourceLabel: 'long head of right biceps brachii' },
      { meshName: 'FJ1478M', fmaConceptId: '37687', side: 'left', sourceLabel: 'long head of left biceps brachii' },
    ],
  },
  {
    // The whole-muscle deltoid, marked expected-absent.
    //
    // The source DOES have deltoid geometry — three parts of it — so this is not
    // `no-source-concept`. It is a composite we do not yet join, and the parts above
    // are bound in its place. Marking it absent is what stops the pipeline binding
    // one part to the composite and rendering a third of the muscle as all of it.
    //
    // The candidate name is DELIBERATELY impossible: `expectAbsent` documents an
    // expectation but does not skip the lookup, so a real-looking name would be a
    // live claim that such a mesh exists. A name no archive can contain fails closed.
    asiId: 'asi:shoulder.deltoid',
    candidates: [
      { meshName: 'UNAVAILABLE:deltoid-composite', fmaConceptId: null, side: 'not_applicable', sourceLabel: null },
    ],
    expectAbsent: true,
  },
  {
    // A bursal space. BodyParts3D carries solid anatomy, so this has no mesh, and a
    // space is a real anatomical concept anyway -- it stays in the model, 2D-capable,
    // with no 3D. See anatomy-representation.ts.
    asiId: 'asi:shoulder.subacromial-bursa',
    candidates: [
      { meshName: 'UNAVAILABLE:subacromial-bursa', fmaConceptId: null, side: 'not_applicable', sourceLabel: null },
    ],
    expectAbsent: true,
  },
  {
    asiId: 'asi:shoulder.acromion',
    candidates: [
      { meshName: 'UNAVAILABLE:acromion', fmaConceptId: null, side: 'not_applicable', sourceLabel: null },
    ],
    expectAbsent: true,
  },
  {
    asiId: 'asi:shoulder.coracoid',
    candidates: [
      { meshName: 'UNAVAILABLE:coracoid', fmaConceptId: null, side: 'not_applicable', sourceLabel: null },
    ],
    expectAbsent: true,
  },
  {
    asiId: 'asi:shoulder.glenohumeral-joint',
    candidates: [
      { meshName: 'UNAVAILABLE:glenohumeral-joint', fmaConceptId: null, side: 'not_applicable', sourceLabel: null },
    ],
    expectAbsent: true,
  },
  {
    asiId: 'asi:shoulder.acromioclavicular-joint',
    candidates: [
      { meshName: 'UNAVAILABLE:acromioclavicular-joint', fmaConceptId: null, side: 'not_applicable', sourceLabel: null },
    ],
    expectAbsent: true,
  },
  {
    asiId: 'asi:shoulder.spine-of-scapula',
    candidates: [
      { meshName: 'UNAVAILABLE:spine-of-scapula', fmaConceptId: null, side: 'not_applicable', sourceLabel: null },
    ],
    expectAbsent: true,
  },
];

/**
 * Structures the shoulder has, that this archive cannot honestly supply.
 *
 * Listed with reasons so a build prints a real gap report and a reader can see
 * WHY something is missing rather than assuming the mapping was never finished.
 * Absence from this list would be a claim that nothing is wrong.
 */
export const UNMAPPABLE_SHOULDER: readonly { asiId: string; reason: string }[] = [
  {
    asiId: 'asi:shoulder.deltoid',
    reason:
      'the source has deltoid geometry only as three parts, each with its own asi: identity above; joining them into one representation is not implemented, so the composite is not bound',
  },
  {
    asiId: 'asi:shoulder.acromion',
    reason:
      'no acromion concept exists anywhere in isa_element_parts.txt; BodyParts3D 4.0 has no isolated acromion mesh',
  },
  {
    asiId: 'asi:shoulder.coracoid',
    reason: 'no coracoid concept exists in the archive',
  },
  {
    asiId: 'asi:shoulder.glenohumeral-joint',
    reason:
      'no glenohumeral joint concept exists; the archive carries bones and muscles, not joint spaces',
  },
  {
    asiId: 'asi:shoulder.acromioclavicular-joint',
    reason: 'no acromioclavicular joint concept exists in the archive',
  },
  {
    asiId: 'asi:shoulder.spine-of-scapula',
    reason:
      'no spine-of-scapula concept exists; the archive has the scapula as a whole bone only',
  },
  {
    asiId: 'asi:shoulder.subacromial-bursa',
    reason: 'a bursal space, and BodyParts3D carries solid anatomy only',
  },
];

/**
 * The three parts of the deltoid, and the composite they belong to.
 *
 * BodyParts3D 4.0 has no whole-muscle deltoid; it carries these three parts, each a
 * separate FMA concept with its own geometry per side. Each therefore has its own
 * `asi:` id, named after the source's terminology, and each is bound in
 * `SHOULDER_MAPPING` above.
 *
 * The composite `asi:shoulder.deltoid` stays a real anatomical concept — it is how a
 * user and a clinician talk about the muscle — but its 3D representation is reported
 * as `composite-unsupported` rather than being assembled from the three parts. Joining
 * them is not implemented, and doing it badly would render a convincing lie.
 *
 * This table exists so the relationship is DATA rather than prose: the parts and their
 * parent are queryable, which is what a future composite resolver needs, and what a
 * test asserts against.
 */
export interface DeltoidPart {
  /** The source's name for the part. Not ours to rename. */
  part: string;
  /** The canonical identity of THIS part. */
  asiId: string;
  /** The composite this part belongs to. */
  parentAsiId: string;
  rightMesh: string;
  leftMesh: string;
  fmaRight: string;
  fmaLeft: string;
}

export const DELTOID_PARTS: readonly DeltoidPart[] = [
  {
    part: 'clavicular',
    asiId: 'asi:shoulder.deltoid-clavicular-part',
    parentAsiId: 'asi:shoulder.deltoid',
    rightMesh: 'FJ1468',
    leftMesh: 'FJ1468M',
    fmaRight: '34680',
    fmaLeft: '34681',
  },
  {
    part: 'acromial',
    asiId: 'asi:shoulder.deltoid-acromial-part',
    parentAsiId: 'asi:shoulder.deltoid',
    rightMesh: 'FJ1467',
    leftMesh: 'FJ1467M',
    fmaRight: '34682',
    fmaLeft: '34683',
  },
  {
    part: 'spinal',
    asiId: 'asi:shoulder.deltoid-spinal-part',
    parentAsiId: 'asi:shoulder.deltoid',
    rightMesh: 'FJ1513',
    leftMesh: 'FJ1513M',
    fmaRight: '34684',
    fmaLeft: '34685',
  },
];

/** The canonical ids of the composite's parts, in the source's own order. */
export function deltoidPartIds(): string[] {
  return DELTOID_PARTS.map((p) => p.asiId);
}
/**
 * Which region's mapping to use.
 *
 * Neck is bound here too, and it was written AFTER auditing the archive with
 * `scripts/audit-region.mjs` rather than before, which is the only reason its rows can
 * be trusted. See `anatomy-mapping-neck.ts` for the audit trail and for why seven of its
 * nine concepts are reported as gaps rather than approximated.
 *
 * The other two regions stay absent. An empty table is an honest statement that nothing
 * has been checked; a guessed one is not.
 */
export const MAPPINGS: Readonly<Record<string, readonly MappingEntry[]>> = {
  shoulder: SHOULDER_MAPPING,
  neck: NECK_MAPPING,
};

/**
 * Every reason we know of for a concept having no mesh, across all regions.
 *
 * One list rather than one per region so a caller reporting a gap cannot miss a region.
 */
export const UNMAPPABLE: readonly { asiId: string; reason: string }[] = [
  ...UNMAPPABLE_SHOULDER,
  ...UNMAPPABLE_NECK,
];

export function mappingFor(region: string): readonly MappingEntry[] {
  return MAPPINGS[region] ?? [];
}

/**
 * Source and licence metadata, pinned.
 *
 * `verifiedOn` is the date the licence PAGE was read, and it is the field that
 * makes a stale copy detectable. An earlier draft of
 * docs/research/anatomy-assets.md recorded CC-BY-SA 2.1 JP, which was the licence
 * under which BodyParts3D shipped until early 2025 and is still quoted on the
 * project's own editor site and in most third-party mirrors. Under 2.1 JP,
 * redistributing derivative meshes would have imposed share-alike. Under CC BY
 * 4.0 it does not. If the licence changes again, this date is what tells us the
 * string above is stale.
 */
export const BODYPARTS3D_LICENCE = {
  id: 'CC-BY-4.0',
  name: 'Creative Commons Attribution 4.0 International',
  url: 'https://dbarchive.biosciencedbc.jp/en/bodyparts3d/lic.html',
  attribution:
    'BodyParts3D, (c) The Database Center for Life Science licensed under CC Attribution 4.0 International',
  verifiedOn: '2025-02-27',
} as const;

export const BODYPARTS3D_SOURCE = {
  dataset: 'BodyParts3D',
  /** The bulk mesh archive is release 4.0 (2013/05), 99% polygon-reduced. */
  release: '4.0',
  doi: '10.18908/lsdba.nbdc00837-000',
  /** The maintained concept list is 4.3i; the mesh archive is older. */
  conceptRelease: '4.3i',
  /** The one external file this pipeline needs. */
  archive: 'isa_BP3D_4.0_obj_99.zip',
  /**
   * Vertical extent of the whole source model, measured across all 2234 meshes in
   * the archive rather than read from documentation: the archive ships no unit
   * field, and its README does not state one.
   */
  verticalExtentUnits: 1729.74,
} as const;

/**
 * The coordinate unit of BodyParts3D's meshes: MILLIMETRES.
 *
 * ## How this was established
 *
 * By measurement, not by appearance. BodyParts3D describes its model as a whole-body
 * model of an ADULT HUMAN MALE, and the source meshes span 1729.74 units from the
 * soles of the feet to the top of the head. Read as millimetres that is 1.73 m, which
 * is a human height. Read as centimetres it is 17.3 m, and read as metres it is
 * 1730 m — neither is a person. No other plausible unit produces a body.
 *
 * So the earlier `unitless` was not cautious, it was merely uninformative: it made
 * the manifest refuse to state something that had been established, and left a
 * consumer with no way to know what the numbers meant.
 *
 * ## What this must never become
 *
 * A licence to rescale. The unit is recorded so bounds, pins and measurements can be
 * interpreted correctly. The renderer frames the camera from the MEASURED scene and
 * stays unit-agnostic, because a camera that assumed millimetres would break the day
 * a source arrives in centimetres.
 */
export const BODYPARTS3D_UNITS = 'mm' as const;
import { NECK_MAPPING, UNMAPPABLE_NECK } from './anatomy-mapping-neck.ts';
