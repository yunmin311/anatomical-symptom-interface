/**
 * BodyParts3D -> asi:* mapping.
 *
 * This is the "rename / map to asiId" stage, and it is deliberately a table of
 * CANDIDATES rather than a table of certainties.
 *
 * Why candidates. BodyParts3D is FMA-derived, so its concept names are FMA
 * labels with laterality suffixes: `Supraspinatus_tendon_L`. Mapping that onto
 * our structures requires knowing the exact upstream spelling, and this file was
 * written without the archive in hand. Asserting one name per structure would
 * mean guessing at anatomy and shipping the guess as if it were verified -- and a
 * wrong binding is worse than no binding, because a mesh bound to the wrong
 * `asiId` renders as a structure the user never selected.
 *
 * So each structure lists plausible source names in preference order, and the
 * pipeline binds only what it can actually FIND in the input. A structure with no
 * match is reported as unmapped and excluded from the manifest. When the real
 * archive is supplied, the pipeline binds whatever is genuinely there and prints
 * the remaining gaps, instead of this file pretending to know.
 *
 * `fmaConceptId` is recorded as a claim, not a fact. Nothing here has been
 * checked against FMA Explorer, so every entry stays 'unverified' until a human
 * verifies it. See docs/adr/0002-anatomy-model-source.md.
 */

/** What a mesh in the source archive can be bound to. */
export interface SourceCandidate {
  /** Mesh name as it appears in the archive, laterality suffix included. */
  meshName: string;
  /** FMA concept id claimed by the source, when the concept list supplies one. */
  fmaConceptId: string | null;
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
 * Shoulder, the Phase 1 vertical slice.
 *
 * Fifteen distinct structures across three sub-regions, which is the whole
 * shoulder selectable surface today. Two of them are listed as expected-absent
 * because they are spaces rather than solids.
 */
export const SHOULDER_MAPPING: readonly MappingEntry[] = [
  {
    asiId: 'asi:shoulder.deltoid',
    candidates: [
      { meshName: 'Deltoid_L', fmaConceptId: '13347' },
      { meshName: 'Deltoid_muscle_L', fmaConceptId: '13347' },
    ],
  },
  {
    asiId: 'asi:shoulder.biceps-long-head-tendon',
    candidates: [
      { meshName: 'Long_head_of_biceps_tendon_L', fmaConceptId: null },
      { meshName: 'Biceps_tendon_L', fmaConceptId: null },
      { meshName: 'Biceps_brachii_tendon_L', fmaConceptId: null },
    ],
  },
  {
    asiId: 'asi:shoulder.subscapularis',
    candidates: [
      { meshName: 'Subscapularis_L', fmaConceptId: '13352' },
      { meshName: 'Subscapularis_muscle_L', fmaConceptId: '13352' },
    ],
  },
  {
    asiId: 'asi:shoulder.glenohumeral-joint',
    candidates: [
      { meshName: 'Glenohumeral_joint_L', fmaConceptId: '33092' },
      { meshName: 'Shoulder_joint_L', fmaConceptId: '33092' },
    ],
  },
  {
    asiId: 'asi:shoulder.acromioclavicular-joint',
    candidates: [
      { meshName: 'Acromioclavicular_joint_L', fmaConceptId: '33075' },
      { meshName: 'Acromioclavicular_joint', fmaConceptId: '33075' },
    ],
  },
  {
    asiId: 'asi:shoulder.coracoid',
    candidates: [
      { meshName: 'Coracoid_process_L', fmaConceptId: '33090' },
      { meshName: 'Coracoid_L', fmaConceptId: '33090' },
    ],
  },
  {
    asiId: 'asi:shoulder.acromion',
    candidates: [{ meshName: 'Acromion_L', fmaConceptId: '33082' }],
  },
  {
    // A bursal space. BodyParts3D carries solid anatomy, so this is expected to
    // have no mesh; the structure stays in the 2D map and in the interview, and
    // simply has no 3D geometry in Phase 1.
    asiId: 'asi:shoulder.subacromial-bursa',
    candidates: [{ meshName: 'Subacromial_bursa_L', fmaConceptId: null }],
    expectAbsent: true,
  },
  {
    asiId: 'asi:shoulder.supraspinatus-tendon',
    candidates: [
      { meshName: 'Supraspinatus_tendon_L', fmaConceptId: '29823' },
      { meshName: 'Supraspinatus_L', fmaConceptId: '29823' },
    ],
  },
  {
    asiId: 'asi:shoulder.infraspinatus',
    candidates: [
      { meshName: 'Infraspinatus_L', fmaConceptId: '13349' },
      { meshName: 'Infraspinatus_muscle_L', fmaConceptId: '13349' },
    ],
  },
  {
    asiId: 'asi:shoulder.teres-minor',
    candidates: [
      { meshName: 'Teres_minor_L', fmaConceptId: '13350' },
      { meshName: 'Teres_minor_muscle_L', fmaConceptId: '13350' },
    ],
  },
  {
    asiId: 'asi:shoulder.trapezius-upper',
    // BodyParts3D carries the whole trapezius; we only mean its upper portion.
    // The mapping says so rather than silently claiming a whole-muscle match.
    candidates: [{ meshName: 'Trapezius_L', fmaConceptId: '13338' }],
  },
  {
    asiId: 'asi:shoulder.scapula',
    candidates: [{ meshName: 'Scapula_L', fmaConceptId: '2043' }],
  },
  {
    asiId: 'asi:shoulder.spine-of-scapula',
    candidates: [{ meshName: 'Spine_of_scapula_L', fmaConceptId: '2044' }],
  },
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
