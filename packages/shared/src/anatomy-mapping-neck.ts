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
    // Recorded explicitly rather than left out, because absence from the table would be
    // a claim that nothing is wrong with it.
    asiId: 'asi:neck.upper-trapezius',
    candidates: [
      {
        meshName: 'SHARED:asi:shoulder.trapezius-upper',
        fmaConceptId: null,
        side: 'not_applicable',
        sourceLabel:
          'already bound to asi:shoulder.trapezius-upper as the ascending part of trapezius (FMA33583 left / FMA33581 right)',
      },
    ],
    expectAbsent: true,
  },
  {
    asiId: 'asi:neck.scalenes',
    candidates: [
      {
        meshName: 'UNAVAILABLE:three-concepts-per-side',
        fmaConceptId: null,
        side: 'not_applicable',
        sourceLabel:
          'scalenus anterior FMA13393/FJ1570 and FMA13392/FJ1592, scalenus medius FMA13391/FJ1571 and FMA13390/FJ1593, scalenus posterior FMA13389/FJ1572 and FMA13388/FJ1594',
      },
    ],
    expectAbsent: true,
  },
  {
    asiId: 'asi:neck.suboccipital',
    candidates: [
      {
        meshName: 'UNAVAILABLE:composite',
        fmaConceptId: null,
        side: 'not_applicable',
        sourceLabel:
          'six concepts: obliquus capitis inferior FMA32537/FJ1563 and FMA32536/FJ1584, obliquus capitis superior FMA32535/FJ1564 and FMA32534/FJ1585, rectus capitis posterior major FMA32531/FJ1567 (left only -- no right mesh exists in the archive), rectus capitis posterior minor FMA32533/FJ1568 (left only), rectus capitis anterior FMA46314/FJ1566 and FMA46313/FJ1588, rectus capitis lateralis FMA46318/FJ1569 and FMA46317/FJ1591',
      },
    ],
    expectAbsent: true,
  },
  {
    asiId: 'asi:neck.cervical-spine',
    candidates: [
      {
        meshName: 'UNAVAILABLE:seven-vertebra-meshes',
        fmaConceptId: null,
        side: 'midline',
        sourceLabel:
          'atlas FMA12519/FJ3176, axis FMA12520/FJ3177, third cervical vertebra FMA12521/FJ3161, fourth FMA12522/FJ3164, fifth FMA12523/FJ3167, sixth FMA12524/FJ3170, seventh FMA12525/FJ3172',
      },
    ],
    expectAbsent: true,
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
    asiId: 'asi:neck.cervical-spine',
    reason:
      'the source carries seven separate vertebrae (atlas, axis, C3-C7), each its own FMA concept; one canonical id cannot take seven meshes, and binding one vertebra would show a fraction of the structure under a label claiming all of it',
  },
  {
    asiId: 'asi:neck.scalenes',
    reason:
      'the source has three scalene concepts per side (anterior, medius, posterior); one canonical id cannot take six meshes, so the composite is reported unsupported rather than approximated by one of them',
  },
  {
    asiId: 'asi:neck.suboccipital',
    reason:
      'the source has six suboccipital concepts, and two of them (rectus capitis posterior major and minor) exist only on the left -- the archive has no FJ1567M or FJ1568M -- so the set cannot even be described as bilateral',
  },
  {
    asiId: 'asi:neck.upper-trapezius',
    reason:
      'not a gap in the source: the ascending part of trapezius is already bound to asi:shoulder.trapezius-upper, and one source mesh cannot serve two canonical ids',
  },
  {
    asiId: 'asi:neck.thyroid',
    reason:
      'no thyroid gland concept exists in isa_element_parts.txt; the archive has the inferior thyroid artery and the cricothyroid ligament, which are different structures and would be a substitution',
  },
  {
    asiId: 'asi:neck.brachial-plexus',
    reason:
      'no brachial plexus concept exists; the only "plexus" in the bridge is the choroid plexus, and BodyParts3D carries nerves as vessels rather than as plexuses',
  },
  {
    asiId: 'asi:neck.nuchal-ligament',
    reason:
      'no nuchal concept exists anywhere in the bridge; no concept name contains "nuchal"',
  },
];