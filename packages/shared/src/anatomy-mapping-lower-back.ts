/**
 * The lower back, audited against `isa_element_parts.txt` before it was written.
 *
 * The audit's findings are recorded here because two of them are traps that a plausible
 * mapping would have walked straight into.
 *
 * ## THE TRAP: `quadratus lumborum`
 *
 * Searching the archive for "quadratus" returns exactly two muscles:
 *
 *   pronator quadratus   FMA38454 / FJ1503   (forearm)
 *   quadratus femoris    FMA22338 / FJ1432   (thigh)
 *
 * Neither is quadratus lumborum, which is a different muscle in a different place.
 * Binding either would put a thigh muscle inside someone's lower back under a label
 * claiming it is the muscle that flexes their spine sideways. So this row records no
 * source concept, and the reason names the two decoys so the next person does not
 * re-derive the temptation from a fresh search.
 *
 * ## THE TRAP: `erector spinae`
 *
 * The source has `iliocostalis lumborum` (FMA22702, FJ1527/FJ1527M) and longissimus
 * and spinalis at the THORACIC and CERVICAL levels -- and no `longissimus lumborum`
 * and no `spinalis lumborum` at all. A lumbar erector spinae is three muscles, and the
 * source models one of them at that level. Binding iliocostalis lumborum would show a
 * third of the structure under a label claiming all of it, which is the same error as
 * binding one deltoid part as the whole deltoid.
 *
 * ## THE TRAP: `sacrotuberous ligament` and `coccyx`
 *
 * Absent. The archive carries the sacrum (FMA16202, FJ3393) and nothing for the
 * coccyx or for sacrotuberous ligaments. "Sacral" appears only in vein names.
 *
 * ## WHAT THE SOURCE HAS, AND WE BIND
 *
 *   lumbar-spine     five lumbar vertebrae, midline, one canonical selection
 *   sacrum           one mesh, midline
 *   iliopsoas        NOT a source concept, but iliacus and psoas major both are, so the
 *                    canonical concept is a composite of two real meshes per side
 *   gluteus-maximus  one mesh per side
 *
 * ## AND THE SUFFIX, AGAIN
 *
 * `FJ1418` is RIGHT gluteus maximus and `FJ1418M` is LEFT, confirmed by the source's own
 * words (FMA22328/FMA22329) and by centroid x (-86.8 and +86.8). That is the OPPOSITE of
 * the neck, where sternocleidomastoid had no suffix at all and the base file was LEFT.
 * Across this dataset the convention holds in some regions and not others, which is the
 * whole reason laterality is read from the source concept and recorded here rather than
 * inferred anywhere at runtime.
 *
 * `fmaConceptId` remains a claim, not a fact: nothing here has been checked against FMA
 * Explorer, so every entry stays 'unverified' until a human verifies it.
 */
import type { MappingEntry } from './anatomy-mapping.ts';

export const LOWER_BACK_MAPPING: readonly MappingEntry[] = [
  {
    // FIVE vertebrae, midline, one canonical selection. A person who points at their
    // lower back has pointed at their whole lumbar spine, which is why this is one
    // structure over five sourced meshes rather than five concepts.
    asiId: 'asi:lower-back.lumbar-spine',
    composite: {
      selectable: false,
      reason:
        'the source models each lumbar vertebra separately (L1-L5); one canonical selection covers all five',
    },
    candidates: [
      { meshName: 'FJ3157', fmaConceptId: '13072', side: 'midline', sourceLabel: 'first lumbar vertebra' },
      { meshName: 'FJ3159', fmaConceptId: '13073', side: 'midline', sourceLabel: 'second lumbar vertebra' },
      { meshName: 'FJ3162', fmaConceptId: '13074', side: 'midline', sourceLabel: 'third lumbar vertebra' },
      { meshName: 'FJ3165', fmaConceptId: '13075', side: 'midline', sourceLabel: 'fourth lumbar vertebra' },
      { meshName: 'FJ3168', fmaConceptId: '13076', side: 'midline', sourceLabel: 'fifth lumbar vertebra' },
    ],
  },
  {
    asiId: 'asi:lower-back.sacrum',
    candidates: [
      { meshName: 'FJ3393', fmaConceptId: '16202', side: 'midline', sourceLabel: 'sacrum' },
    ],
  },
  {
    // NOT a source concept, but both halves of it are, which is what makes this a
    // composite rather than a gap. Iliacus and psoas major are separate FMA concepts
    // with separate meshes per side; the name "iliopsoas" is the clinical shorthand for
    // the pair, and one canonical selection over two real meshes is exactly what it is.
    asiId: 'asi:lower-back.iliopsoas',
    composite: {
      selectable: false,
      reason:
        'the source has no iliopsoas concept but models iliacus and psoas major separately, each per side',
    },
    candidates: [
      { meshName: 'FJ1422M', fmaConceptId: '22323', side: 'left', sourceLabel: 'left iliacus' },
      { meshName: 'FJ1431M', fmaConceptId: '22343', side: 'left', sourceLabel: 'left psoas major' },
      { meshName: 'FJ1422', fmaConceptId: '22322', side: 'right', sourceLabel: 'right iliacus' },
      { meshName: 'FJ1431', fmaConceptId: '22342', side: 'right', sourceLabel: 'right psoas major' },
    ],
  },
  {
    asiId: 'asi:lower-back.gluteus-maximus',
    candidates: [
      { meshName: 'FJ1418M', fmaConceptId: '22329', side: 'left', sourceLabel: 'left gluteus maximus' },
      { meshName: 'FJ1418', fmaConceptId: '22328', side: 'right', sourceLabel: 'right gluteus maximus' },
    ],
  },
  {
    asiId: 'asi:lower-back.erector-spinae',
    candidates: [
      {
        meshName: 'UNAVAILABLE:one-of-three-lumbar-components',
        fmaConceptId: null,
        side: 'not_applicable',
        sourceLabel:
          'iliocostalis lumborum FMA22702/FJ1527 and FMA22741/FJ1527M exist, but there is no longissimus lumborum and no spinalis lumborum in the archive',
      },
    ],
    expectAbsent: true,
  },
  {
    asiId: 'asi:lower-back.multifidus',
    candidates: [
      { meshName: 'UNAVAILABLE:no-source-concept', fmaConceptId: null, side: 'bilateral', sourceLabel: null },
    ],
    expectAbsent: true,
  },
  {
    asiId: 'asi:lower-back.quadratus-lumborum',
    candidates: [
      {
        meshName: 'UNAVAILABLE:no-source-concept',
        fmaConceptId: null,
        side: 'not_applicable',
        // The decoys, named so a fresh search does not re-derive the temptation.
        sourceLabel:
          'the only "quadratus" concepts in the archive are pronator quadratus (FMA38454, forearm) and quadratus femoris (FMA22338, thigh); neither is quadratus lumborum',
      },
    ],
    expectAbsent: true,
  },
  {
    asiId: 'asi:lower-back.thoracolumbar-fascia',
    candidates: [
      { meshName: 'UNAVAILABLE:no-source-concept', fmaConceptId: null, side: 'not_applicable', sourceLabel: null },
    ],
    expectAbsent: true,
  },
  {
    asiId: 'asi:lower-back.coccyx',
    candidates: [
      { meshName: 'UNAVAILABLE:no-source-concept', fmaConceptId: null, side: 'midline', sourceLabel: null },
    ],
    expectAbsent: true,
  },
  {
    asiId: 'asi:lower-back.sacrotuberous-ligament',
    candidates: [
      { meshName: 'UNAVAILABLE:no-source-concept', fmaConceptId: null, side: 'not_applicable', sourceLabel: null },
    ],
    expectAbsent: true,
  },
];

/** Why a lower-back concept has no mesh, when we know. */
export const UNMAPPABLE_LOWER_BACK: readonly { asiId: string; reason: string }[] = [
  {
    asiId: 'asi:lower-back.erector-spinae',
    reason:
      'a lumbar erector spinae is three muscles (iliocostalis, longissimus, spinalis) and the archive models only iliocostalis lumborum at the lumbar level -- there is no longissimus lumborum or spinalis lumborum concept; binding the one would show a third of the structure under a label claiming all of it',
  },
  {
    asiId: 'asi:lower-back.multifidus',
    reason: 'no multifidus concept exists anywhere in isa_element_parts.txt',
  },
  {
    asiId: 'asi:lower-back.quadratus-lumborum',
    reason:
      'no quadratus lumborum concept exists; the archive has pronator quadratus (forearm) and quadratus femoris (thigh), which are different muscles and would be a substitution',
  },
  {
    asiId: 'asi:lower-back.thoracolumbar-fascia',
    reason:
      'no lumbar or thoracolumbar fascia concept exists; the archive carries no fascia of the trunk wall',
  },
  {
    asiId: 'asi:lower-back.coccyx',
    reason:
      'the archive has the sacrum (FMA16202) but no coccyx bone; "sacral" appears only in vein names',
  },
  {
    asiId: 'asi:lower-back.sacrotuberous-ligament',
    reason: 'no sacrotuberous ligament concept exists; the archive carries no pelvic ligaments',
  },
];