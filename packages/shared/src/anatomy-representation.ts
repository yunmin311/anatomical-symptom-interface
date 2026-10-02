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
import { LateralitySchema } from './anatomy-manifest.ts';

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

/**
 * One side's worth of 3D capability.
 *
 * `available: false` with a reason is the case that matters, and the reason the old
 * `sides: ['left','right']` array could not express. Real anatomy is not always
 * symmetric: BodyParts3D carries six suboccipital concepts on the left and four on the
 * right -- rectus capitis posterior major and minor simply have no right-side mesh. An
 * all-or-nothing `sides` array has two dishonest answers available for that, and both
 * were reachable: omit 'right' and the reader cannot tell "unavailable" from "not
 * audited"; include 'right' and we claim a completeness the source does not have.
 *
 * So availability is per LATERALITY, and an unavailable side carries its own reason.
 */
export const SideCapabilitySchema = z.discriminatedUnion('available', [
  z.object({
    available: z.literal(true),
    /** How many external elements this side resolves to. Never assumed to be one. */
    componentCount: z.number().int().positive(),
  }),
  z.object({
    available: z.literal(false),
    /** Why this side is not represented, when it is not represented. */
    reason: z.string().min(1).nullish(),
  }),
]);
export type SideCapability = z.infer<typeof SideCapabilitySchema>;

export const Representation3DSchema = z.union([
  z.object({
    status: z.literal('available'),
    /**
     * Capability per laterality, keyed by the SAME vocabulary the canonical manifest
     * uses. Deliberately not a second enum: a structure whose geometry is midline says
     * `midline`, and one that is a single whole-body concept says `not_applicable`.
     *
     * At least one side must be available, or `status` should be `unavailable` and say
     * why -- "available" with nothing available is a contradiction a reader would have
     * to notice.
     */
    sides: z.record(LateralitySchema, SideCapabilitySchema),
  }),
  z.object({
    status: z.literal('unavailable'),
    reason: RepresentationGapReasonSchema,
    /** Why, in words. The reason code is the checkable part; this is for a human. */
    detail: z.string(),
  }),
]).superRefine((value, ctx) => {
  // "available" with no laterality available is a contradiction, and a reader would
  // have to notice it. Checked here because a union member cannot carry its own
  // refinement: `discriminatedUnion` rejects a refined member, and the alternative --
  // leaving it unchecked -- is how a declaration ends up claiming 3D and rendering
  // nothing.
  if (value.status !== 'available') return;
  if (!Object.values(value.sides).some((capability) => capability.available))
    ctx.addIssue({
      code: z.ZodIssueCode.custom,
      message: 'a 3D representation is marked available but no laterality is available',
    });
});
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
/**
 * Exported so the gates can check every declaration against what was actually
 * built, rather than trusting a list that only this module can see.
 */
export const REPRESENTATION_DECLARATIONS: Readonly<Record<string, Representation>> = {
  // --- Bound to real BodyParts3D 4.0 elements, verified against the archive ---
  'asi:shoulder.supraspinatus-tendon': {
    twoD: { available: true, placeholder: true },
    threeD: { status: 'available', sides: { left: { available: true, componentCount: 1 }, right: { available: true, componentCount: 1 } } },
  },
  'asi:shoulder.infraspinatus': {
    twoD: { available: true, placeholder: true },
    threeD: { status: 'available', sides: { left: { available: true, componentCount: 1 }, right: { available: true, componentCount: 1 } } },
  },
  'asi:shoulder.teres-minor': {
    twoD: { available: true, placeholder: true },
    threeD: { status: 'available', sides: { left: { available: true, componentCount: 1 }, right: { available: true, componentCount: 1 } } },
  },
  'asi:shoulder.subscapularis': {
    twoD: { available: true, placeholder: true },
    threeD: { status: 'available', sides: { left: { available: true, componentCount: 1 }, right: { available: true, componentCount: 1 } } },
  },
  'asi:shoulder.trapezius-upper': {
    twoD: { available: true, placeholder: true },
    threeD: { status: 'available', sides: { left: { available: true, componentCount: 1 }, right: { available: true, componentCount: 1 } } },
  },
  'asi:shoulder.scapula': {
    twoD: { available: true, placeholder: true },
    threeD: { status: 'available', sides: { left: { available: true, componentCount: 1 }, right: { available: true, componentCount: 1 } } },
  },
  'asi:shoulder.biceps-long-head-tendon': {
    twoD: { available: true, placeholder: true },
    threeD: { status: 'available', sides: { left: { available: true, componentCount: 1 }, right: { available: true, componentCount: 1 } } },
  },

  // --- neck ---
  //
  // Nine concepts, five of them available and four not, and the gaps are the point of
  // the exercise rather than an embarrassment. Each reason says what the archive
  // actually contains, so a reader can check it rather than take the gap on trust.
  //
  // Three are COMPOSITES -- one canonical concept over several sourced meshes -- and
  // the per-laterality shape is what makes the suboccipital asymmetry expressible: six
  // concepts on the left, four on the right, because rectus capitis posterior major and
  // minor have no right-side mesh in the archive. The old `sides: ['left','right']`
  // array could only have said "both" (a lie) or "neither" (also a lie).
  'asi:neck.sternocleidomastoid': {
    twoD: { available: true, placeholder: true },
    threeD: {
      status: 'available',
      sides: {
        left: { available: true, componentCount: 1 },
        right: { available: true, componentCount: 1 },
      },
    },
  },
  'asi:neck.levator-scapulae': {
    twoD: { available: true, placeholder: true },
    threeD: {
      status: 'available',
      sides: {
        left: { available: true, componentCount: 1 },
        right: { available: true, componentCount: 1 },
      },
    },
  },
  'asi:neck.cervical-spine': {
    twoD: { available: true, placeholder: true },
    threeD: {
      status: 'available',
      // MIDLINE, and one structure rather than a left copy and a right copy. Seven
      // source vertebrae, seven separate FMA claims, one canonical selection.
      sides: { midline: { available: true, componentCount: 7 } },
    },
  },
  'asi:neck.scalenes': {
    twoD: { available: true, placeholder: true },
    threeD: {
      status: 'available',
      sides: {
        left: { available: true, componentCount: 3 },
        right: { available: true, componentCount: 3 },
      },
    },
  },
  'asi:neck.suboccipital': {
    twoD: { available: true, placeholder: true },
    threeD: {
      status: 'available',
      sides: {
        left: { available: true, componentCount: 6 },
        // NOT AVAILABLE, and said so per side. The source has four of the six on the
        // right; mirroring the left or shipping a short set are both forbidden, so the
        // honest answer is that the right side is not represented.
        right: {
          available: false,
          reason:
            'rectus capitis posterior major and minor have no right-side mesh in the archive (no FJ1567M or FJ1568M), so the right set is four of six concepts',
        },
      },
    },
  },
  'asi:neck.nuchal-ligament': {
    twoD: { available: true, placeholder: true },
    threeD: {
      status: 'unavailable',
      reason: 'no-source-concept',
      detail: 'no concept name in the archive contains "nuchal"',
    },
  },
// --- lower back ---
  //
  // Four of ten available. The gaps are the point: two of them are traps a plausible
  // mapping would have walked into, and both are recorded where the next person will
  // see them rather than in a commit message.
  'asi:lower-back.lumbar-spine': {
    twoD: { available: true, placeholder: true },
    threeD: {
      status: 'available',
      // FIVE lumbar vertebrae, midline, one canonical selection over five sourced
      // meshes. A person pointing at their lower back has pointed at their whole lumbar
      // spine, which is exactly why this is one structure and not five concepts.
      sides: { midline: { available: true, componentCount: 5 } },
    },
  },
  'asi:lower-back.sacrum': {
    twoD: { available: true, placeholder: true },
    threeD: { status: 'available', sides: { midline: { available: true, componentCount: 1 } } },
  },
  'asi:lower-back.iliopsoas': {
    twoD: { available: true, placeholder: true },
    threeD: {
      status: 'available',
      // NOT a source concept, but iliacus and psoas major both are, each with its own
      // mesh per side. The clinical name for the pair is a composite of two real things,
      // and that is what this is.
      sides: {
        left: { available: true, componentCount: 2 },
        right: { available: true, componentCount: 2 },
      },
    },
  },
  'asi:lower-back.gluteus-maximus': {
    twoD: { available: true, placeholder: true },
    threeD: {
      status: 'available',
      sides: {
        left: { available: true, componentCount: 1 },
        right: { available: true, componentCount: 1 },
      },
    },
  },
  'asi:lower-back.erector-spinae': {
    twoD: { available: true, placeholder: true },
    threeD: {
      status: 'unavailable',
      reason: 'composite-unsupported',
      detail:
        'a lumbar erector spinae is three muscles and the archive models only iliocostalis lumborum at the lumbar level -- there is no longissimus lumborum or spinalis lumborum concept. Binding the one would show a third of the structure under a label claiming all of it.',
    },
  },
  'asi:lower-back.multifidus': {
    twoD: { available: true, placeholder: true },
    threeD: {
      status: 'unavailable',
      reason: 'no-source-concept',
      detail: 'no multifidus concept exists anywhere in the archive',
    },
  },
  'asi:lower-back.quadratus-lumborum': {
    twoD: { available: true, placeholder: true },
    threeD: {
      status: 'unavailable',
      reason: 'no-source-concept',
      detail:
        'no quadratus lumborum concept exists. The archive has pronator quadratus (forearm) and quadratus femoris (thigh); both are different muscles, and binding either would put a thigh muscle inside a lower back.',
    },
  },
  'asi:lower-back.thoracolumbar-fascia': {
    twoD: { available: true, placeholder: true },
    threeD: {
      status: 'unavailable',
      reason: 'no-source-concept',
      detail: 'no lumbar or thoracolumbar fascia concept exists; the archive carries no fascia of the trunk wall',
    },
  },
  'asi:lower-back.coccyx': {
    twoD: { available: true, placeholder: true },
    threeD: {
      status: 'unavailable',
      reason: 'no-source-concept',
      detail: 'the archive has the sacrum but no coccyx bone; "sacral" appears only in vein names',
    },
  },
  'asi:lower-back.sacrotuberous-ligament': {
    twoD: { available: true, placeholder: true },
    threeD: {
      status: 'unavailable',
      reason: 'no-source-concept',
      detail: 'no sacrotuberous ligament concept exists; the archive carries no pelvic ligaments',
    },
  },

  // --- knee ---
  //
  // Five of nineteen. This is the weakest region in the archive by a wide margin, and
  // the reason is structural rather than a mapping failure: BodyParts3D 4.0 is a solid
  // bone-and-muscle dataset, and the knee's functionally most important structures --
  // its ligaments, its menisci, its bursae -- are exactly the ones it does not model.
  'asi:knee.patella': {
    twoD: { available: true, placeholder: true },
    threeD: {
      status: 'available',
      // FJ3275 is LEFT and FJ3381 is RIGHT. The ids are not adjacent and not in side
      // order, so nothing about the numbering could have told you that.
      sides: {
        left: { available: true, componentCount: 1 },
        right: { available: true, componentCount: 1 },
      },
    },
  },
  'asi:knee.popliteus': {
    twoD: { available: true, placeholder: true },
    threeD: {
      status: 'available',
      sides: {
        left: { available: true, componentCount: 1 },
        right: { available: true, componentCount: 1 },
      },
    },
  },
  'asi:knee.iliotibial-band': {
    twoD: { available: true, placeholder: true },
    threeD: {
      status: 'available',
      // The source's name is "iliotibial tract" (FMA51048). Same structure; the naming
      // difference is recorded because a reader searching the archive for "band" will
      // find nothing and needs to know why.
      sides: {
        left: { available: true, componentCount: 1 },
        right: { available: true, componentCount: 1 },
      },
    },
  },
  'asi:knee.gastrocnemius-head': {
    twoD: { available: true, placeholder: true },
    threeD: {
      status: 'available',
      // Our concept is the MEDIAL head and the source models medial and lateral heads
      // as separate concepts, so this is an exact match. The lateral head is a different
      // muscle, not a less precise version of the right one.
      sides: {
        left: { available: true, componentCount: 1 },
        right: { available: true, componentCount: 1 },
      },
    },
  },
  'asi:knee.popliteal-artery': {
    twoD: { available: true, placeholder: true },
    threeD: {
      status: 'available',
      sides: {
        left: { available: true, componentCount: 1 },
        right: { available: true, componentCount: 1 },
      },
    },
  },
  'asi:knee.sartorius-gracilis-semimembranosus': {
    twoD: { available: true, placeholder: true },
    threeD: {
      status: 'unavailable',
      reason: 'no-source-concept',
      detail:
        'this concept is the pes anserinus TENDONS. The archive has the sartorius, gracilis and semimembranosus as three real MUSCLES with real meshes -- but a muscle is a different structure in a different place, and binding them would put thigh muscle where the user pointed at tendon.',
    },
  },
  'asi:knee.semimembranosus-tendon': {
    twoD: { available: true, placeholder: true },
    threeD: {
      status: 'unavailable',
      reason: 'no-source-concept',
      detail:
        'the semimembranosus MUSCLE exists (FMA22448/FJ1435) but its tendon does not exist in this archive',
    },
  },
  'asi:knee.patellar-tendon': {
    twoD: { available: true, placeholder: true },
    threeD: {
      status: 'unavailable',
      reason: 'no-source-concept',
      detail: 'no patellar ligament or tendon concept exists in the archive',
    },
  },
  'asi:knee.quadriceps-tendon': {
    twoD: { available: true, placeholder: true },
    threeD: {
      status: 'unavailable',
      reason: 'no-source-concept',
      detail: 'no quadriceps tendon concept exists; the archive has the muscle but not its tendon',
    },
  },
  'asi:knee.mcl': {
    twoD: { available: true, placeholder: true },
    threeD: {
      status: 'unavailable',
      reason: 'no-source-concept',
      detail:
        'no medial collateral ligament exists. All 38 "ligament" concepts in the archive are extraocular muscles -- check ligaments of the eye movement muscles.',
    },
  },
  'asi:knee.lcl': {
    twoD: { available: true, placeholder: true },
    threeD: {
      status: 'unavailable',
      reason: 'no-source-concept',
      detail: 'no lateral collateral ligament exists; all 38 "ligament" concepts are extraocular muscles',
    },
  },
  'asi:knee.meniscus-medial': {
    twoD: { available: true, placeholder: true },
    threeD: {
      status: 'unavailable',
      reason: 'no-source-concept',
      detail: 'the archive has no meniscal concept at all; BodyParts3D 4.0 models no fibrocartilage',
    },
  },
  'asi:knee.meniscus-lateral': {
    twoD: { available: true, placeholder: true },
    threeD: {
      status: 'unavailable',
      reason: 'no-source-concept',
      detail: 'the archive has no meniscal concept at all; BodyParts3D 4.0 models no fibrocartilage',
    },
  },
  'asi:knee.prepatellar-bursa': {
    twoD: { available: true, placeholder: true },
    threeD: {
      status: 'unavailable',
      reason: 'non-solid-space',
      detail: 'the archive has no bursal concept of any kind, at the knee or anywhere else',
    },
  },
  'asi:knee.tibial-collateral-bursa': {
    twoD: { available: true, placeholder: true },
    threeD: {
      status: 'unavailable',
      reason: 'non-solid-space',
      detail: 'the archive has no bursal concept of any kind',
    },
  },
  'asi:knee.lateral-collateral-bursa': {
    twoD: { available: true, placeholder: true },
    threeD: {
      status: 'unavailable',
      reason: 'non-solid-space',
      detail: 'the archive has no bursal concept of any kind',
    },
  },
  'asi:knee.patellofemoral-joint': {
    twoD: { available: true, placeholder: true },
    threeD: {
      status: 'unavailable',
      reason: 'non-solid-space',
      detail: 'no patellofemoral concept exists; the archive carries bones and muscles, not joint spaces',
    },
  },
  'asi:knee.popliteal-space': {
    twoD: { available: true, placeholder: true },
    threeD: {
      status: 'unavailable',
      reason: 'non-solid-space',
      detail: 'a space rather than a solid, and the archive models no spaces at the knee',
    },
  },
  'asi:knee.tibial-nerve': {
    twoD: { available: true, placeholder: true },
    threeD: {
      status: 'unavailable',
      reason: 'no-source-concept',
      detail:
        'no tibial nerve concept exists; the archive carries neurovascular structures only as named vessels, and no nerve at the knee',
    },
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
    threeD: { status: 'available', sides: { left: { available: true, componentCount: 1 }, right: { available: true, componentCount: 1 } } },
  },
  'asi:shoulder.deltoid-acromial-part': {
    twoD: { available: false, placeholder: false },
    threeD: { status: 'available', sides: { left: { available: true, componentCount: 1 }, right: { available: true, componentCount: 1 } } },
  },
  'asi:shoulder.deltoid-spinal-part': {
    twoD: { available: false, placeholder: false },
    threeD: { status: 'available', sides: { left: { available: true, componentCount: 1 }, right: { available: true, componentCount: 1 } } },
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
 * Guard: a structure may not claim 3D without saying which sides it covers, and may
 * not claim a side it did not produce.
 *
 * A build that reports `available` with `sides: ['left']` while the manifest contains
 * geometry for the right is claiming something false, and the failure is invisible
 * until a user looks at the wrong shoulder. `sides` is therefore non-empty by schema,
 * and callers compare it against the geometry they produced.
 *
 * ## Why this now also rejects the OVER-claim
 *
 * Checking only `declared.sides ⊆ produced` stops a structure from promising a side
 * that is missing, but it happily allows promising `['left']` when both sides exist.
 * That is the failure this project is most likely to make: the declarations were
 * written when only the left build existed, so widening them to `['left', 'right']` is
 * the tempting one-line fix, and it is also how an untested claim gets shipped.
 *
 * So both directions are checked. A side the source produced but the declaration omits
 * is reported as well, because the honest declaration for a structure with real
 * geometry on both sides is `['left', 'right']`, and leaving it at `['left']` tells a
 * reader the right shoulder is unavailable when it is not.
 */
export function assertSidesMatch(
  asiId: string,
  declared: Representation3D,
  produced: readonly { laterality: string; componentCount: number }[],
): void {
  if (declared.status !== 'available') return;
  const producedBySide = new Map(produced.map((p) => [p.laterality, p.componentCount]));

  // A side declared available must actually have been built, with the component count
  // the declaration claims. Checking the COUNT matters as soon as a structure is a
  // composite: "left is available" would pass for a left build that lost two of its
  // seven components, which is the exact failure the composite rules exist to stop.
  for (const [side, capability] of Object.entries(declared.sides) as [string, SideCapability][]) {
    if (!capability.available) continue;
    const count = producedBySide.get(side);
    if (count === undefined)
      throw new Error(
        `${asiId} declares 3D available for ${side} but no ${side} build contains it.`,
      );
    if (count !== capability.componentCount)
      throw new Error(
        `${asiId} declares ${capability.componentCount} ${side} component(s) but the ${side} build ` +
          `produced ${count}. A partial composite is a different structure from a complete one.`,
      );
  }

  // And a side that WAS built must be declared, available or not. This is the direction
  // that catches a real omission: the source has four right suboccipital meshes and the
  // declaration says nothing about the right at all, so a reader cannot tell whether
  // that was audited or overlooked.
  for (const side of producedBySide.keys()) {
    if (!(side in declared.sides))
      throw new Error(
        `${asiId} has real ${side} geometry but the declaration does not mention ${side}. ` +
          `Declare it available, or unavailable with a reason.`,
      );
  }
}

/**
/**
 * The sides a declaration may claim, derived from what the pipeline actually built.
 *
 * Takes the manifests rather than a list of sides, because the manifests are the
 * evidence: a side is only real if an entry with that `laterality` exists for the
 * structure. Passing `['left', 'right']` by hand is exactly the shortcut this exists
 * to close, so the caller cannot do it.
 *
 * This is what makes the declarations provable rather than aspirational: the test
 * asserts `declared.sides` equals what these manifests contain, so widening a
 * declaration to both sides without a right build fails the suite instead of
 * shipping.
 */
export function producedSides(
  asiId: string,
  manifests: readonly {
    entries: readonly { asiId: string; laterality: string; composite?: { components: unknown[] } | null }[];
  }[],
): { laterality: string; componentCount: number }[] {
  const out = new Map<string, number>();
  for (const manifest of manifests) {
    const match = manifest.entries.find((e) => e.asiId === asiId);
    if (!match) continue;
    const count = match.composite?.components.length ?? 1;
    const existing = out.get(match.laterality);
    if (existing !== undefined) continue;
    out.set(match.laterality, count);
  }
  return [...out.entries()]
    .map(([laterality, componentCount]) => ({ laterality, componentCount }))
    .sort((a, b) => a.laterality.localeCompare(b.laterality));
}

/** The tissue layer a structure belongs to. */
export function layerOf(structure: Structure): TissueLayer {
  return structure.layer;
}