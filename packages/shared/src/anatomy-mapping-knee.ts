/**
 * The knee, audited against `isa_element_parts.txt` before it was written.
 *
 * This region is where the archive is weakest, and the honest answer is mostly "no".
 *
 * ## THE HEADLINE FINDING: THERE ARE NO KNEE LIGAMENTS IN THIS ARCHIVE
 *
 * Searching the bridge for "ligament" returns 38 concepts. Every one of them is an
 * extraocular muscle -- "check ligament of lateral rectus" and its relatives, the
 * tendinous expansions of the eye's movement muscles. There is no patellar ligament, no
 * medial or lateral collateral ligament, no cruciate, and no ligament of any kind at
 * the knee.
 *
 * Also absent, and each searched for by name:
 *
 *   meniscus            0 concepts. Not one, medial or lateral.
 *   bursa               0 concepts anywhere in the archive, so no prepatellar bursa and
 *                       no collateral bursae.
 *   patellofemoral      0 concepts
 *   patellar tendon     0 concepts ("patellar tendon", "ligamentum patellae" both empty)
 *   quadriceps tendon   0 concepts
 *   tibial nerve        0 concepts
 *
 * BodyParts3D 4.0 is a solid-anatomy dataset of bones and muscles. The knee's
 * functionally most important structures -- its ligaments and its menisci -- are
 * precisely the ones it does not model. This is a limitation of the SOURCE, stated here
 * so nobody reads it as an unfinished mapping.
 *
 * ## THE TRAP: PES ANSERINUS
 *
 * `knee.sartorius-gracilis-semimembranosus` is our name for the PES ANSERINUS
 * TENDONS. The archive has the sartorius (FMA22354/FJ1434), gracilis (FMA43883/FJ1421)
 * and semimembranosus (FMA22448/FJ1435) as three real MUSCLES with real meshes.
 *
 * Binding them would be exactly the substitution this project forbids: a user pointing
 * at the tendon just below their kneecap would get three thigh muscles, which are a
 * different structure at a different place, in front of and above where they pointed.
 * Three concepts, none of them the tendons.
 *
 * The same reasoning rules out `semimembranosus-tendon`. The muscle exists; the tendon
 * does not exist in this archive.
 *
 * ## WHAT THE SOURCE HAS, AND WE BIND
 *
 *   patella             one mesh per side. FJ3381 is RIGHT and FJ3275 is LEFT -- the
 *                       ids are not adjacent, so this could not have been guessed from
 *                       the numbering; the bridge and the centroid (x -82.9 / +83.0)
 *                       agree.
 *   iliotibial-band     the source's name is "iliotibial tract" (FMA51048). Same
 *                       structure, and the naming difference is recorded rather than
 *                       glossed over.
 *   popliteus           one mesh per side
 *   gastrocnemius-head  our concept is the MEDIAL head, and the source models medial
 *                       and lateral heads separately, so this is an exact match:
 *                       medial FJ1397/FJ1397M, lateral FJ1394/FJ1394M. Binding the
 *                       lateral head would be wrong, not merely imprecise.
 *   popliteal-artery    one mesh per side
 *
 * ## AND THE SUFFIX, ONE MORE TIME
 *
 * Everything here follows the base-is-right convention, unlike the neck. The three
 * regions together are why nothing at runtime reads a side off a filename.
 *
 * `fmaConceptId` remains a claim, not a fact: nothing here has been checked against FMA
 * Explorer, so every entry stays 'unverified' until a human verifies it.
 */
import type { MappingEntry } from './anatomy-mapping.ts';

export const KNEE_MAPPING: readonly MappingEntry[] = [
  {
    asiId: 'asi:knee.patella',
    candidates: [
      // Not adjacent ids, and not in id order: FJ3381 is RIGHT, FJ3275 is LEFT. A
      // number-based guess would have put them on the wrong sides.
      { meshName: 'FJ3275', fmaConceptId: '24487', side: 'left', sourceLabel: 'left patella' },
      { meshName: 'FJ3381', fmaConceptId: '24486', side: 'right', sourceLabel: 'right patella' },
    ],
  },
  {
    asiId: 'asi:knee.popliteus',
    candidates: [
      { meshName: 'FJ1430M', fmaConceptId: '22592', side: 'left', sourceLabel: 'left popliteus' },
      { meshName: 'FJ1430', fmaConceptId: '22591', side: 'right', sourceLabel: 'right popliteus' },
    ],
  },
  {
    // The source says "tract"; our label says "band". Same structure, and the
    // difference is recorded rather than papered over -- a reader checking the archive
    // will search for "iliotibial band" and find nothing, then need to know why.
    asiId: 'asi:knee.iliotibial-band',
    candidates: [
      { meshName: 'FJ1423M', fmaConceptId: '58777', side: 'left', sourceLabel: 'left iliotibial tract' },
      { meshName: 'FJ1423', fmaConceptId: '58776', side: 'right', sourceLabel: 'right iliotibial tract' },
    ],
  },
  {
    // Our concept is the MEDIAL head specifically, and the source models medial and
    // lateral heads as separate concepts with separate meshes. Binding the lateral head
    // would be a different muscle, not a less precise version of the right one.
    asiId: 'asi:knee.gastrocnemius-head',
    candidates: [
      { meshName: 'FJ1397M', fmaConceptId: '45958', side: 'left', sourceLabel: 'medial head of left gastrocnemius' },
      { meshName: 'FJ1397', fmaConceptId: '45957', side: 'right', sourceLabel: 'medial head of right gastrocnemius' },
    ],
  },
  {
    asiId: 'asi:knee.popliteal-artery',
    candidates: [
      { meshName: 'FJ2086', fmaConceptId: '77381', side: 'left', sourceLabel: 'left popliteal artery' },
      { meshName: 'FJ2170', fmaConceptId: '77380', side: 'right', sourceLabel: 'right popliteal artery' },
    ],
  },

  /* ---- the muscles we deliberately do NOT bind to their tendons ---- */
  {
    asiId: 'asi:knee.sartorius-gracilis-semimembranosus',
    candidates: [
      {
        meshName: 'UNAVAILABLE:muscles-are-not-tendons',
        fmaConceptId: null,
        side: 'not_applicable',
        sourceLabel:
          'the archive has the sartorius (FMA22354/FJ1434), gracilis (FMA43883/FJ1421) and semimembranosus (FMA22448/FJ1435) as three MUSCLES; this concept is the pes anserinus TENDONS, which the archive does not model',
      },
    ],
    expectAbsent: true,
  },
  {
    asiId: 'asi:knee.semimembranosus-tendon',
    candidates: [
      {
        meshName: 'UNAVAILABLE:muscle-is-not-tendon',
        fmaConceptId: null,
        side: 'not_applicable',
        sourceLabel:
          'the semimembranosus MUSCLE exists (FMA22448/FJ1435); its tendon does not exist in this archive',
      },
    ],
    expectAbsent: true,
  },

  /* ---- what the archive simply does not carry at the knee ---- */
  ...(
    [
      ['knee.patellar-tendon', 'no patellar ligament or tendon concept exists'],
      ['knee.quadriceps-tendon', 'no quadriceps tendon concept exists; only the muscle'],
      ['knee.prepatellar-bursa', 'the archive has NO bursal concept of any kind'],
      ['knee.tibial-collateral-bursa', 'the archive has NO bursal concept of any kind'],
      ['knee.lateral-collateral-bursa', 'the archive has NO bursal concept of any kind'],
      ['knee.mcl', 'no medial collateral ligament exists; every "ligament" concept in the archive is an extraocular muscle'],
      ['knee.lcl', 'no lateral collateral ligament exists; every "ligament" concept in the archive is an extraocular muscle'],
      ['knee.meniscus-medial', 'the archive has NO meniscal concept, medial or lateral'],
      ['knee.meniscus-lateral', 'the archive has NO meniscal concept, medial or lateral'],
      ['knee.patellofemoral-joint', 'no patellofemoral concept exists; the archive carries bones and muscles, not joint spaces'],
      ['knee.popliteal-space', 'a space rather than a solid, and the archive models no spaces at the knee'],
      ['knee.tibial-nerve', 'no tibial nerve concept exists; the archive carries nerves only as named vessels'],
    ] as const
  ).map(
    ([asiId, reason]) =>
      ({
        asiId: `asi:${asiId}`,
        candidates: [
          { meshName: 'UNAVAILABLE:no-source-concept', fmaConceptId: null, side: 'not_applicable', sourceLabel: null },
        ],
        expectAbsent: true,
        unmappableReason: reason,
      }) as MappingEntry & { unmappableReason: string },
  ),
];

/** Why a knee concept has no mesh, when we know. */
export const UNMAPPABLE_KNEE: readonly { asiId: string; reason: string }[] = [
  {
    asiId: 'asi:knee.patellar-tendon',
    reason: 'no patellar ligament or tendon concept exists; the archive has no patellar tendon',
  },
  {
    asiId: 'asi:knee.quadriceps-tendon',
    reason:
      'no quadriceps tendon concept exists; the archive has the quadriceps femoris muscle but not its tendon',
  },
  {
    asiId: 'asi:knee.prepatellar-bursa',
    reason: 'the archive has no bursal concept of any kind, at the knee or anywhere else',
  },
  {
    asiId: 'asi:knee.tibial-collateral-bursa',
    reason: 'the archive has no bursal concept of any kind, at the knee or anywhere else',
  },
  {
    asiId: 'asi:knee.lateral-collateral-bursa',
    reason: 'the archive has no bursal concept of any kind, at the knee or anywhere else',
  },
  {
    asiId: 'asi:knee.mcl',
    reason:
      'no medial collateral ligament exists in the archive; all 38 "ligament" concepts are extraocular muscles',
  },
  {
    asiId: 'asi:knee.lcl',
    reason:
      'no lateral collateral ligament exists in the archive; all 38 "ligament" concepts are extraocular muscles',
  },
  {
    asiId: 'asi:knee.meniscus-medial',
    reason:
      'the archive has no meniscal concept at all; BodyParts3D 4.0 models no fibrocartilage',
  },
  {
    asiId: 'asi:knee.meniscus-lateral',
    reason:
      'the archive has no meniscal concept at all; BodyParts3D 4.0 models no fibrocartilage',
  },
  {
    asiId: 'asi:knee.patellofemoral-joint',
    reason:
      'no patellofemoral concept exists; the archive carries bones and muscles, not joint spaces',
  },
  {
    asiId: 'asi:knee.popliteal-space',
    reason: 'a space rather than a solid, and the archive models no spaces at the knee',
  },
  {
    asiId: 'asi:knee.tibial-nerve',
    reason:
      'no tibial nerve concept exists; the archive carries neurovascular structures only as named vessels, and no nerve at the knee',
  },
  {
    asiId: 'asi:knee.sartorius-gracilis-semimembranosus',
    reason:
      'this concept is the pes anserinus TENDONS; the archive has the sartorius, gracilis and semimembranosus as three MUSCLES, which are a different structure in a different place, and binding them would put thigh muscle where the user pointed at tendon',
  },
  {
    asiId: 'asi:knee.semimembranosus-tendon',
    reason:
      'the semimembranosus muscle exists (FMA22448/FJ1435) but its tendon does not exist in this archive; a muscle is not a substitute for the tendon it ends in',
  },
];