/**
 * The neck, audited against `isa_element_parts.txt` before it was written.
 *
 * Every row below was resolved from the archive by `scripts/audit-region.mjs`, and the
 * two facts that shaped this table are recorded with the evidence rather than assumed:
 *
 * ## THE `M` SUFFIX IS NOT A CONVENTION IN THIS REGION
 *
 * In the shoulder, `FJ####` is right and `FJ####M` is left. In the neck,
 * sternocleidomastoid is `FJ1573` = LEFT and `FJ1595` = RIGHT, with no suffix on
 * either. Two independent readings agree:
 *
 *   the source's words   FMA13409 "left sternocleidomastoid"  -> FJ1573
 *                        FMA13408 "right sternocleidomastoid" -> FJ1595
 *   the mesh geometry    centroid x = +38.0 and -39.3, and +x is the figure's left
 *
 * Measured across every side-bearing concept in the bridge, the suffix agrees with the
 * words for 1109 meshes and disagrees for 655. It is a habit that holds in some parts of
 * the dataset and not others, which is exactly why nothing at runtime may infer a side
 * from a filename: the alternative would have rendered left geometry labelled as right
 * and looked completely plausible.
 *
 * ## WHAT THE SOURCE IS FINER THAN WE ARE
 *
 * Three of our concepts cover several source concepts, and one covers a source concept
 * we already bind elsewhere:
 *
 *   `neck.scalenes`       three scalene concepts per side (anterior, medius, posterior)
 *   `neck.suboccipital`   six concepts, and two of them exist ONLY on the left --
 *                         there is no FJ1567M or FJ1568M in the archive at all
 *   `neck.cervical-spine` seven vertebrae meshes: atlas, axis, C3, C4, C5, C6, C7
 *   `neck.upper-trapezius` the SAME source concept as `shoulder.trapezius-upper`
 *                         (ascending part of trapezius, FMA33583/FMA33581)
 *
 * Each is reported as a gap rather than approximated. Binding C1 and calling it "the
 * cervical spine" would show a user who pointed at their whole neck one vertebra under
 * a label claiming seven; binding one scalene and calling it "the scalenes" is the same
 * error. `composite-unsupported` is the honest answer, and it is the same answer the
 * shoulder deltoid already gives.
 *
 * The trapezius case is different in kind: nothing is composite, the mesh is exactly
 * right, and it simply already belongs to the shoulder region because that is where the
 * user meets it. It is reported `covered-by-shoulder-mapping` rather than bound twice,
 * because one source mesh cannot serve two canonical ids -- `indexScene` refuses a
 * duplicate `asiId` for good reason.
 *
 * `fmaConceptId` remains a claim, not a fact: nothing here has been checked against FMA
 * Explorer, so every entry stays 'unverified' until a human verifies it.
 */
import type { MappingEntry } from './anatomy-mapping.ts';

export const NECK_MAPPING: readonly MappingEntry[] = [
  {
    // The source has a whole-muscle concept (FMA13407) AND per-side concepts
    // (FMA13408/FMA13409). The per-side ones are bound, because one build is one side
    // and each names exactly one mesh.
    asiId: 'asi:neck.sternocleidomastoid',
    candidates: [
      // NO `M` suffix on either. See the header: the convention does not hold here.
      {
        meshName: 'FJ1573',
        fmaConceptId: '13409',
        side: 'left',
        sourceLabel: 'left sternocleidomastoid',
      },
      {
        meshName: 'FJ1595',
        fmaConceptId: '13408',
        side: 'right',
        sourceLabel: 'right sternocleidomastoid',
      },
    ],
  },
  {
    asiId: 'asi:neck.levator-scapulae',
    candidates: [
      { meshName: 'FJ1532M', fmaConceptId: '32541', side: 'left', sourceLabel: 'left levator scapulae' },
      { meshName: 'FJ1532', fmaConceptId: '32540', side: 'right', sourceLabel: 'right levator scapulae' },
    ],
  },
  {
    // THREE source concepts per side, so the canonical concept is a COMPOSITE of three
    // real meshes rather than one muscle wearing a plural label.
    asiId: 'asi:neck.scalenes',
    composite: {
      selectable: false,
      reason:
        'the source models anterior, medius and posterior scalenes as three separate concepts per side, so one canonical id resolves to three sourced meshes',
    },
    candidates: [
      // NO M suffix: like the sternocleidomastoid pair, the source states the side in
      // words and the suffix is absent. Verified against centroid x as well.
      { meshName: 'FJ1570', fmaConceptId: '13393', side: 'left', sourceLabel: 'left scalenus anterior' },
      { meshName: 'FJ1571', fmaConceptId: '13391', side: 'left', sourceLabel: 'left scalenus medius' },
      { meshName: 'FJ1572', fmaConceptId: '13389', side: 'left', sourceLabel: 'left scalenus posterior' },
      { meshName: 'FJ1592', fmaConceptId: '13392', side: 'right', sourceLabel: 'right scalenus anterior' },
      { meshName: 'FJ1593', fmaConceptId: '13390', side: 'right', sourceLabel: 'right scalenus medius' },
      { meshName: 'FJ1594', fmaConceptId: '13388', side: 'right', sourceLabel: 'right scalenus posterior' },
    ],
  },
  {
    // SIX concepts on the left and FOUR on the right. The source has no
    // FJ1567M/FJ1568M, so rectus capitis posterior major and minor are LEFT ONLY --
    // confirmed by the bridge and by centroid x (+19.1 and +11.8, both positive).
    //
    // Declared as a composite anyway, and the pipeline's all-or-nothing rule does the
    // rest: the left build binds all six, the right build binds only four and is
    // reported INCOMPLETE rather than shipped as a whole suboccipital set. Mirroring
    // the left onto the right would be the forbidden substitution, and dropping the two
    // missing muscles silently would claim a completeness the source does not have.
    asiId: 'asi:neck.suboccipital',
    composite: {
      selectable: false,
      reason:
        'the source models six suboccipital concepts separately; the left set is complete and the right set is missing rectus capitis posterior major and minor',
      // Without this the pipeline sees four right-sided concepts come back, finds all
      // four present, and calls the right side COMPLETE. It is complete as a set of
      // right-sided muscles and still an incomplete representation of the concept the
      // user pointed at -- so the right neck scene would ship a "suboccipital muscles"
      // selection quietly missing two of them.
      absentSides: ['right'],
    },
    candidates: [
      { meshName: 'FJ1563', fmaConceptId: '32537', side: 'left', sourceLabel: 'left obliquus capitis inferior' },
      { meshName: 'FJ1564', fmaConceptId: '32535', side: 'left', sourceLabel: 'left obliquus capitis superior' },
      { meshName: 'FJ1567', fmaConceptId: '32531', side: 'left', sourceLabel: 'left rectus capitis posterior major' },
      { meshName: 'FJ1568', fmaConceptId: '32533', side: 'left', sourceLabel: 'left rectus capitis posterior minor' },
      { meshName: 'FJ1566', fmaConceptId: '46314', side: 'left', sourceLabel: 'left rectus capitis anterior' },
      { meshName: 'FJ1569', fmaConceptId: '46318', side: 'left', sourceLabel: 'left rectus capitis lateralis' },
      { meshName: 'FJ1584', fmaConceptId: '32536', side: 'right', sourceLabel: 'right obliquus capitis inferior' },
      { meshName: 'FJ1585', fmaConceptId: '32534', side: 'right', sourceLabel: 'right obliquus capitis superior' },
      { meshName: 'FJ1588', fmaConceptId: '46313', side: 'right', sourceLabel: 'right rectus capitis anterior' },
      { meshName: 'FJ1591', fmaConceptId: '46317', side: 'right', sourceLabel: 'right rectus capitis lateralis' },
    ],
  },
  {
    // SEVEN source meshes, all midline. A user who points at their neck has pointed at
    // the whole cervical spine, which is exactly why this is one canonical selection
    // over seven real components rather than seven concepts or one vertebra.
    asiId: 'asi:neck.cervical-spine',
    composite: {
      selectable: false,
      reason:
        'the source models each cervical vertebra separately (atlas, axis, C3-C7); one canonical selection covers all seven',
    },
    candidates: [
      { meshName: 'FJ3176', fmaConceptId: '12519', side: 'midline', sourceLabel: 'atlas' },
      { meshName: 'FJ3177', fmaConceptId: '12520', side: 'midline', sourceLabel: 'axis' },
      { meshName: 'FJ3161', fmaConceptId: '12521', side: 'midline', sourceLabel: 'third cervical vertebra' },
      { meshName: 'FJ3164', fmaConceptId: '12522', side: 'midline', sourceLabel: 'fourth cervical vertebra' },
      { meshName: 'FJ3167', fmaConceptId: '12523', side: 'midline', sourceLabel: 'fifth cervical vertebra' },
      { meshName: 'FJ3170', fmaConceptId: '12524', side: 'midline', sourceLabel: 'sixth cervical vertebra' },
      { meshName: 'FJ3172', fmaConceptId: '12525', side: 'midline', sourceLabel: 'seventh cervical vertebra' },
    ],
  },
  {
    asiId: 'asi:neck.thyroid',
    candidates: [
      {
        meshName: 'UNAVAILABLE:no-source-concept',
        fmaConceptId: null,
        side: 'midline',
        sourceLabel: null,
      },
    ],
    expectAbsent: true,
  },
  {
    asiId: 'asi:neck.brachial-plexus',
    candidates: [
      {
        meshName: 'UNAVAILABLE:no-source-concept',
        fmaConceptId: null,
        side: 'not_applicable',
        sourceLabel: null,
      },
    ],
    expectAbsent: true,
  },
  {
    asiId: 'asi:neck.nuchal-ligament',
    candidates: [
      {
        meshName: 'UNAVAILABLE:no-source-concept',
        fmaConceptId: null,
        side: 'midline',
        sourceLabel: null,
      },
    ],
    expectAbsent: true,
  },
];

/**
 * Why a neck concept has no mesh, when we know.
 *
 * These read as claims and are kept next to the mapping so a build log and this file
 * cannot disagree.
 */
export const UNMAPPABLE_NECK: readonly { asiId: string; reason: string }[] = [
  {
    asiId: 'asi:neck.suboccipital',
    reason:
      'the left set is complete (six concepts) and the RIGHT side is not: rectus capitis posterior major and minor have no right-side mesh in the archive at all (no FJ1567M or FJ1568M), so the right build is reported incomplete rather than mirrored or quietly short',
  },
  {
    asiId: 'asi:neck.thyroid',
    reason:
      'no thyroid gland concept exists in isa_element_parts.txt; the archive has the inferior thyroid artery and the cricothyroid ligament, which are different structures and would be a substitution',
  },
  {
    asiId: 'asi:neck.brachial-plexus',
    reason:
      'no brachial plexus concept exists; the only plexus in the bridge is the choroid plexus, and BodyParts3D carries nerves as vessels rather than as plexuses',
  },
  {
    asiId: 'asi:neck.nuchal-ligament',
    reason:
      'no nuchal concept exists anywhere in the bridge; no concept name contains "nuchal"',
  },
];

/**
 * Retired canonical ids, and the ONE canonical identity that replaces them.
 *
 * ## WHY THIS EXISTS
 *
 * The neck audit found `asi:shoulder.trapezius-upper` and `asi:neck.upper-trapezius`:
 * two canonical ids, the same label "Upper trapezius", and -- from the source audit --
 * the SAME source concept (ascending part of trapezius, FMA33583 left / FMA33581 right).
 * Two ids for one anatomical structure is not a modelling convenience, it is two
 * persisted truths about one thing, and a record could name either.
 *
 * ## THE RULE BEHIND IT
 *
 *   canonical anatomical identity  !=  region / sub-region membership
 *
 * A structure belongs to as many regions and sub-regions as it does, and has exactly
 * ONE id and ONE source provenance. `asi:shoulder.trapezius-upper` is now listed in the
 * neck sub-regions too, so a user pointing at the top of their shoulder OR the back of
 * their neck reaches the same structure, the same mesh and the same provenance.
 *
 * ## WHY THE SURVIVING ID KEEPS THE `shoulder` PREFIX
 *
 * The prefix records where the user first meets the structure, not exclusive
 * ownership of it. Renaming it to something region-neutral would be tidier, but
 * `asi:shoulder.trapezius-upper` already appears in SHIPPED production manifests and
 * changing it now would migrate a real id for a cosmetic gain. The alternative -- an
 * alias layer -- is kept anyway, and asserted, because an alias that is never checked
 * is just a comment.
 *
 * `neck.upper-trapezius` has never been bound to geometry and appears in no stored
 * record, so retiring it costs nothing.
 */
export const RETIRED_CANONICAL_IDS: Readonly<Record<string, { canonical: string; why: string }>> = {
  'asi:neck.upper-trapezius': {
    canonical: 'asi:shoulder.trapezius-upper',
    why:
      'the same anatomical structure as the shoulder id, from the same verified source concept; keeping two ids would have made one structure into two persisted truths',
  },
};

/** Resolve a possibly-retired id to the one canonical identity that now holds it. */
export function canonicalStructureId(asiId: string): string {
  return RETIRED_CANONICAL_IDS[asiId]?.canonical ?? asiId;
}
