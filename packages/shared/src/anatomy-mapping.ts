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
 * - `subacromial-bursa`: a space, and BodyParts3D carries solid anatomy.
 * - `deltoid`: present, but ONLY as three parts (acromial, clavicular, spinal),
 *   each with left and right variants. Our id is the whole muscle, so binding one
 *   part to it would misrepresent coverage. The parts are recorded under
 *   `DELTOID_PARTS` for a decision to be made deliberately, not by a build script.
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
    // A bursal space. BodyParts3D carries solid anatomy, so this has no mesh.
    //
    // The candidates are DELIBERATELY impossible names. `expectAbsent` documents an
    // expectation; it does not skip the lookup, so a real-looking name here would
    // be a live claim that the mesh exists. Naming the scapula, say, would bind the
    // acromion to a whole bone the moment the archive contained it -- which is the
    // specific lie this whole table exists to prevent. A name that cannot be in any
    // archive fails closed instead.
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
 * The deltoid exists in this archive ONLY as three parts, each per side.
 *
 * Our `asi:shoulder.deltoid` is the whole muscle, so binding any single part to it
 * would misrepresent coverage: a user selecting the deltoid would get one of three
 * regions rendered as if it were all of it. Recorded here so the choice is made
 * deliberately — bind the parts, extend the domain with part-level ids, or accept a
 * deltoid with no 3D geometry — rather than by a build script picking the first
 * candidate.
 */
export const DELTOID_PARTS: readonly {
  part: string;
  asiId: string | null;
  rightMesh: string;
  leftMesh: string;
  fmaRight: string;
  fmaLeft: string;
}[] = [
  { part: 'clavicular', asiId: null, rightMesh: 'FJ1468', leftMesh: 'FJ1468M', fmaRight: '34680', fmaLeft: '34681' },
  { part: 'acromial', asiId: null, rightMesh: 'FJ1467', leftMesh: 'FJ1467M', fmaRight: '34682', fmaLeft: '34683' },
  { part: 'spinal', asiId: null, rightMesh: 'FJ1513', leftMesh: 'FJ1513M', fmaRight: '34684', fmaLeft: '34685' },
];
/**
 * Which region's mapping to use. Phase 1 ships shoulder; the other three are
 * Phase 1B and are not guessed at here.
 */
export const MAPPINGS: Readonly<Record<string, readonly MappingEntry[]>> = {
  shoulder: SHOULDER_MAPPING,
};

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
} as const;
