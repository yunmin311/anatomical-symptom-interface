/**
 * Anatomical model layer — the vocabulary the rest of the product speaks.
 *
 * Design decision: we keep our OWN stable structural IDs (`asi:*`) rather than
 * borrowing SNOMED/FMA codes as primary keys. Third-party terminologies change,
 * get re-numbered, and are not available offline. Codes are carried alongside
 * as nullable, unverified hints in `coding` and must be checked against the
 * source before use. See docs/adr/0002-anatomy-model-source.md.
 */
import { z } from 'zod';

export const BodyRegionSchema = z.enum(['shoulder', 'neck', 'lower_back', 'knee']);
export type BodyRegion = z.infer<typeof BodyRegionSchema>;

export const SideSchema = z.enum(['left', 'right', 'midline', 'bilateral', 'unknown']);
export type Side = z.infer<typeof SideSchema>;

export const DepthSchema = z.enum(['superficial', 'intermediate', 'deep', 'unknown']);
export type Depth = z.infer<typeof DepthSchema>;

/** Tissue layers, ordered superficial → deep. Index order is meaningful. */
export const TissueLayerSchema = z.enum([
  'skin',
  'subcutaneous',
  'fascia',
  'muscle',
  'tendon',
  'ligament',
  'joint',
  'bone',
  'nerve',
  'vessel',
  'organ',
]);
export type TissueLayer = z.infer<typeof TissueLayerSchema>;

export const TISSUE_LAYER_ORDER: readonly TissueLayer[] = [
  'skin',
  'subcutaneous',
  'fascia',
  'muscle',
  'tendon',
  'ligament',
  'joint',
  'bone',
  'nerve',
  'vessel',
  'organ',
] as const;

export function layerDepthIndex(layer: TissueLayer): number {
  return TISSUE_LAYER_ORDER.indexOf(layer);
}

/**
 * Terminology bindings. Intentionally nullable and unverified: we will not ship
 * a code we have not personally checked against the issuing authority.
 */
export const CodingSchema = z.object({
  snomedCt: z.string().nullish(),
  fma: z.string().nullish(),
  icd10: z.string().nullish(),
  /** 'unverified' by default; flip to 'verified' only after human checking. */
  status: z.enum(['unverified', 'verified']).default('unverified'),
  /** Where the claim came from, e.g. "fma explorer, checked 2026-01-02". */
  note: z.string().nullish(),
});
export type Coding = z.infer<typeof CodingSchema>;

/**
 * A selectable anatomical structure inside a region. `id` is stable and local.
 * `aliases` powers natural-language matching and user-facing labelling.
 */
export const StructureSchema = z.object({
  id: z.string().regex(/^asi:/),
  label: z.string(),
  aliases: z.array(z.string()).default([]),
  layer: TissueLayerSchema,
  /** Coarse surface position, used by the 2D body map and as a fallback. */
  surface: z.enum(['anterior', 'posterior', 'lateral', 'medial', 'superior', 'inferior', 'deep', 'none']),
  /** Plain-language "what users call it", deliberately not anatomical jargon. */
  layTerm: z.string().nullish(),
  coding: CodingSchema.default({ status: 'unverified' }),
});
export type Structure = z.infer<typeof StructureSchema>;

/** A sub-area the user can be asked to narrow down to. */
export const SubRegionSchema = z.object({
  id: z.string(),
  label: z.string(),
  /** Which viewer region shape this maps to. */
  mapId: z.string(),
  structures: z.array(StructureSchema).default([]),
});
export type SubRegion = z.infer<typeof SubRegionSchema>;

export const RegionDefinitionSchema = z.object({
  id: BodyRegionSchema,
  label: z.string(),
  labelZh: z.string(),
  /** Body parts required for the structural reasoning to make sense. */
  requiresAdjacentRegions: z.array(BodyRegionSchema).default([]),
  subRegions: z.array(SubRegionSchema).min(1),
  /** True when the region is strictly left/right paired; false for midline. */
  isPaired: z.boolean().default(true),
  /** Plain-language orientation landmarks shown on the 2D map. */
  orientationCues: z.array(z.string()).default([]),
  /** Screening questions asked before any anatomy work, cheapest safety first. */
  preScreen: z.array(z.string()).default([]),
});
export type RegionDefinition = z.infer<typeof RegionDefinitionSchema>;

export const LocationSchema = z.object({
  region: BodyRegionSchema,
  side: SideSchema.default('unknown'),
  /** Free text the user used, never discarded. */
  userPhrase: z.string().nullish(),
  /** Sub-region the user actually confirmed. */
  subRegionId: z.string().nullish(),
  /** Normalised 0..1 coordinates on the body map, for heatmaps over time. */
  point: z.object({ x: z.number().min(0).max(1), y: z.number().min(0).max(1) }).nullish(),
  depth: DepthSchema.default('unknown'),
});
export type Location = z.infer<typeof LocationSchema>;

/**
 * A structure the model surfaced, and whether the user went on to point at it.
 *
 * `selectedByUser` is a DERIVED PROJECTION, not an input. It is recomputed from
 * `location.userSelectedStructureIds` — the canonical set — every time a record
 * is rebuilt or projected, so whatever is persisted here is ignored. Two
 * independently writable copies of the same fact could disagree, and a
 * disagreeing record reads as "the user both selected and did not select this
 * structure". See `projectUserSelection` in symptom.ts.
 *
 * What a selection means, once: the user clicked this structure on the anatomy
 * map. It is a statement about a VISUAL LOCATION, not a claim that this
 * structure is the source of the problem. A patient who taps the nearest
 * landmark to their pain has told us where it is, which is the point of the
 * product — but they have not told us what is wrong with it.
 * See docs/adr/0004-visual-selection-is-not-a-finding.md.
 */
export const ConsideredStructureSchema = z.object({
  structureId: z.string(),
  /** How the model arrived at it, so the UI can be honest about it. */
  rationale: z.string().nullish(),
  confidence: z.number().min(0).max(1).nullish(),
  selectedByUser: z.boolean().default(false),
});
export type ConsideredStructure = z.infer<typeof ConsideredStructureSchema>;

const structure = (
  id: string,
  label: string,
  layer: TissueLayer,
  surface: Structure['surface'],
  layTerm: string,
  aliases: string[] = [],
): Structure => ({
  id: `asi:${id}`,
  label,
  aliases,
  layer,
  surface,
  layTerm,
  coding: { status: 'unverified' },
});

/**
 * Canonical anatomical identity is NOT region membership.
 *
 * One structure can belong to several regions and sub-regions, and then it has exactly
 * ONE id and ONE source provenance. The first case this actually bit was the upper
 * trapezius: the shoulder and the neck both declared it, under two different ids, with
 * the same label, and the source audit showed both resolved to the SAME source concept
 * (ascending part of trapezius). Two ids for one structure is not a modelling
 * convenience -- it is two persisted truths about one thing, and a record could name
 * either and be "right".
 *
 * So `shoulder.trapezius-upper` is now listed in the neck sub-regions as well. The
 * `shoulder` prefix records where the user first meets the structure, not exclusive
 * ownership of it. The retired id and the reason are in
 * `anatomy-mapping-neck.ts` (`RETIRED_CANONICAL_IDS`), and `canonicalStructureId`
 * resolves it, so anything holding the old value still lands on the one canonical
 * identity.
 *
 * The consequence for storage: `location.userSelectedStructureIds` holds canonical
 * structure identities, and one structure selected from two regions is still ONE entry.
 *

/* ------------------------------------------------------------------ */
/* Region definitions — V1 scope: shoulder, neck, lower back, knee      */
/* ------------------------------------------------------------------ */

const SHOULDER: RegionDefinition = {
  id: 'shoulder',
  label: 'Shoulder',
  labelZh: '肩部',
  requiresAdjacentRegions: [],
  isPaired: true,
  orientationCues: [
    'front of the shoulder = the side facing your chest',
    'top of the shoulder = the bit your bag strap sits on',
    'back of the shoulder = the blade-of-the-shoulder-blade side',
    'the crease under the arm is the armpit — below it is the chest, not the shoulder',
  ],
  preScreen: [
    'Did this start right after a fall, a hit, or a car accident?',
    'Is the shoulder visibly deformed, or can you see a lump?',
    'Can you lift the arm at all, even a little?',
    'Is there numbness, or a cold/pale hand on that side?',
  ],
  subRegions: [
    {
      id: 'shoulder.anterior',
      label: 'Front of shoulder',
      mapId: 'shoulder-anterior',
      structures: [
        structure('shoulder.deltoid', 'Deltoid', 'muscle', 'lateral', 'the rounded muscle on the outside'),
        // Part-level deltoid, named after the SOURCE's terminology.
        //
        // BodyParts3D 4.0 has no whole-muscle deltoid: it carries three parts, each a
        // separate FMA concept with its own geometry (FMA34677/8 clavicular, FMA34682/3
        // acromial, FMA34684/5 spinal). Each gets its own `asi:` id because each can
        // independently be mapped, sourced and attributed.
        //
        // The names are the SOURCE's, deliberately. They are not renamed to
        // anterior/middle/posterior to line up with our sub-regions: imposing our
        // vocabulary on its data is exactly what the first version of the mapping
        // table did, and it bound nothing. See anatomy-representation.ts for how the
        // composite deltoid is reported as unavailable in 3D rather than faked.
        structure('shoulder.deltoid-clavicular-part', 'Clavicular part of deltoid', 'muscle', 'superior', 'the front part of the shoulder muscle, near the collarbone'),
        structure('shoulder.deltoid-acromial-part', 'Acromial part of deltoid', 'muscle', 'lateral', 'the middle part of the shoulder muscle, over the shoulder blade'),
        structure('shoulder.deltoid-spinal-part', 'Spinal part of deltoid', 'muscle', 'posterior', 'the back part of the shoulder muscle'),
        structure('shoulder.biceps-long-head-tendon', 'Long head of biceps tendon', 'tendon', 'deep', 'the tendon that runs down the front of the shoulder joint', ['biceps tendon', 'long head of biceps']),
        structure('shoulder.subscapularis', 'Subscapularis', 'muscle', 'anterior', 'a deep muscle right in front of the shoulder joint'),
        structure('shoulder.glenohumeral-joint', 'Glenohumeral joint', 'joint', 'deep', 'the ball-and-socket joint itself', ['shoulder joint', 'GH joint']),
        structure('shoulder.acromioclavicular-joint', 'Acromioclavicular joint', 'joint', 'superior', 'the small joint where the collarbone meets the shoulder blade', ['AC joint', 'acromioclavicular']),
        structure('shoulder.coracoid', 'Coracoid process', 'bone', 'anterior', 'the small bony knob under the front of the shoulder'),
      ],
    },
    {
      id: 'shoulder.lateral',
      label: 'Outside of shoulder',
      mapId: 'shoulder-lateral',
      structures: [
        structure('shoulder.deltoid', 'Deltoid', 'muscle', 'lateral', 'the rounded muscle on the outside'),
        // The acromial part is the middle of the muscle and sits over the shoulder
        // blade, which is what makes it selectable from this view. The parts are NOT
        // mirrored into every sub-region the composite appears in: they are separate
        // concepts with separate identities, and each is offered where it is.
        structure('shoulder.deltoid-acromial-part', 'Acromial part of deltoid', 'muscle', 'lateral', 'the middle part of the shoulder muscle, over the shoulder blade'),
        structure('shoulder.acromion', 'Acromion', 'bone', 'lateral', 'the bony shelf on top of the shoulder', ['shoulder blade top', 'acromial spur']),
        structure('shoulder.subacromial-bursa', 'Subacromial bursa', 'fascia', 'deep', 'the cushion under the bony shelf', ['bursa', 'subacromial space']),
        structure('shoulder.supraspinatus-tendon', 'Supraspinatus tendon', 'tendon', 'superior', 'the tendon that runs over the top of the shoulder joint', ['rotator cuff', 'supraspinatus']),
        structure('shoulder.acromioclavicular-joint', 'Acromioclavicular joint', 'joint', 'superior', 'the small joint on the very top of the shoulder', ['AC joint']),
      ],
    },
    {
      id: 'shoulder.posterior',
      label: 'Back of shoulder',
      mapId: 'shoulder-posterior',
      structures: [
        structure('shoulder.infraspinatus', 'Infraspinatus', 'muscle', 'posterior', 'the muscle on the shoulder blade below the spine of the blade'),
        structure('shoulder.teres-minor', 'Teres minor', 'muscle', 'posterior', 'a small muscle at the outer edge of the shoulder blade'),
        structure('shoulder.trapezius-upper', 'Upper trapezius', 'muscle', 'posterior', 'the muscle from the neck to the top of the shoulder'),
        structure('shoulder.scapula', 'Scapula', 'bone', 'posterior', 'the shoulder blade bone', ['shoulder blade']),
        structure('shoulder.spine-of-scapula', 'Spine of scapula', 'bone', 'posterior', 'the bony ridge you can feel across the shoulder blade'),
      ],
    },
  ],
};

const NECK: RegionDefinition = {
  id: 'neck',
  label: 'Neck',
  labelZh: '颈部',
  requiresAdjacentRegions: ['shoulder'],
  isPaired: false,
  orientationCues: [
    'the front of the neck is the side with your windpipe',
    'the sides of the neck are where most neck pain lives',
    'the back of the neck connects into the upper back — say so if it feels the same',
  ],
  preScreen: [
    'Did this start right after a fall or whiplash?',
    'Did you feel a click or pop in your neck at the moment it started?',
    'Is there numbness or tingling going into your arm or hand?',
    'Do you have a fever, or feel generally unwell?',
  ],
  subRegions: [
    {
      id: 'neck.anterior',
      label: 'Front of neck',
      mapId: 'neck-anterior',
      structures: [
        structure('neck.sternocleidomastoid', 'Sternocleidomastoid', 'muscle', 'anterior', 'the band running from behind the ear to the collarbone', ['SCM']),
        structure('neck.thyroid', 'Thyroid gland', 'organ', 'anterior', 'the small gland at the front of the neck'),
        structure('neck.cervical-spine', 'Cervical spine', 'bone', 'deep', 'the neck bones'),
      ],
    },
    {
      id: 'neck.lateral',
      label: 'Side of neck',
      mapId: 'neck-lateral',
      structures: [
        structure('neck.scalenes', 'Scalene muscles', 'muscle', 'lateral', 'the muscles along the side of the neck down to the ribs'),
        structure('shoulder.trapezius-upper', 'Upper trapezius', 'muscle', 'lateral', 'the muscle from the neck to the top of the shoulder'),
        structure('neck.brachial-plexus', 'Brachial plexus', 'nerve', 'deep', 'the network of nerves from the neck into the arm', ['nerve root', 'cervical nerve root']),
        structure('neck.cervical-spine', 'Cervical spine', 'bone', 'deep', 'the neck bones'),
        structure('neck.sternocleidomastoid', 'Sternocleidomastoid', 'muscle', 'lateral', 'the band running from behind the ear to the collarbone', ['SCM']),
      ],
    },
    {
      id: 'neck.posterior',
      label: 'Back of neck',
      mapId: 'neck-posterior',
      structures: [
        structure('shoulder.trapezius-upper', 'Upper trapezius', 'muscle', 'posterior', 'the muscle from the neck to the top of the shoulder'),
        structure('neck.levator-scapulae', 'Levator scapulae', 'muscle', 'posterior', 'the muscle from the neck to the shoulder blade'),
        structure('neck.suboccipital', 'Suboccipital muscles', 'muscle', 'posterior', 'the small muscles at the base of the skull'),
        structure('neck.cervical-spine', 'Cervical spine', 'bone', 'deep', 'the neck bones'),
        structure('neck.nuchal-ligament', 'Nuchal ligament', 'ligament', 'posterior', 'the strong band down the middle of the back of the neck'),
      ],
    },
  ],
};

const LOWER_BACK: RegionDefinition = {
  id: 'lower_back',
  label: 'Lower back',
  labelZh: '腰部',
  requiresAdjacentRegions: [],
  isPaired: false,
  orientationCues: [
    'low back means the area from the bottom of the ribs down to the crease of the buttocks',
    'if the pain is mainly in one buttock or goes down the leg, that is a different story — say so',
    'the tailbone sits right at the very bottom centre',
  ],
  preScreen: [
    'Did this start after lifting, bending, or a fall?',
    'Is the pain going down either leg, or into the groin?',
    'Have you noticed numbness around the saddle area, or changes in bladder or bowel control?',
    'Have you had unexplained weight loss, fever, or night sweats?',
  ],
  subRegions: [
    {
      id: 'lower_back.central',
      label: 'Centre of lower back',
      mapId: 'lower-back-central',
      structures: [
        structure('lower-back.erector-spinae', 'Erector spinae', 'muscle', 'posterior', 'the long muscles running down either side of the spine', ['paraspinal muscles']),
        structure('lower-back.multifidus', 'Multifidus', 'muscle', 'deep', 'the small deep muscles right beside the spine'),
        structure('lower-back.lumbar-spine', 'Lumbar spine', 'bone', 'deep', 'the lower back bones', ['lumbar vertebrae', 'L4', 'L5']),
        structure('lower-back.thoracolumbar-fascia', 'Thoracolumbar fascia', 'fascia', 'posterior', 'the tough sheet of tissue over the lower back muscles'),
      ],
    },
    {
      id: 'lower_back.left_paravertebral',
      label: 'Left side of lower back',
      mapId: 'lower-back-left',
      structures: [
        structure('lower-back.quadratus-lumborum', 'Quadratus lumborum', 'muscle', 'lateral', 'the deep muscle from the spine to the top of the hip', ['QL']),
        structure('lower-back.iliopsoas', 'Iliopsoas', 'muscle', 'lateral', 'the deep hip flexor muscle, feels deep near the spine'),
        structure('lower-back.erector-spinae', 'Erector spinae', 'muscle', 'lateral', 'the long muscles running down either side of the spine'),
        structure('lower-back.lumbar-spine', 'Lumbar spine', 'bone', 'deep', 'the lower back bones'),
      ],
    },
    {
      id: 'lower_back.right_paravertebral',
      label: 'Right side of lower back',
      mapId: 'lower-back-right',
      structures: [
        structure('lower-back.quadratus-lumborum', 'Quadratus lumborum', 'muscle', 'lateral', 'the deep muscle from the spine to the top of the hip', ['QL']),
        structure('lower-back.iliopsoas', 'Iliopsoas', 'muscle', 'lateral', 'the deep hip flexor muscle, feels deep near the spine'),
        structure('lower-back.erector-spinae', 'Erector spinae', 'muscle', 'lateral', 'the long muscles running down either side of the spine'),
        structure('lower-back.lumbar-spine', 'Lumbar spine', 'bone', 'deep', 'the lower back bones'),
      ],
    },
    {
      id: 'lower_back.sacrococcygeal',
      label: 'Bottom / tailbone',
      mapId: 'lower-back-sacral',
      structures: [
        structure('lower-back.sacrum', 'Sacrum', 'bone', 'deep', 'the triangular bone at the base of the spine', ['sacral spine']),
        structure('lower-back.coccyx', 'Coccyx', 'bone', 'posterior', 'the tailbone'),
        structure('lower-back.sacrotuberous-ligament', 'Sacrotuberous ligament', 'ligament', 'posterior', 'the ligament from the tailbone area to the sit bones'),
        structure('lower-back.gluteus-maximus', 'Gluteus maximus', 'muscle', 'posterior', 'the big buttock muscle'),
      ],
    },
  ],
};

const KNEE: RegionDefinition = {
  id: 'knee',
  label: 'Knee',
  labelZh: '膝部',
  requiresAdjacentRegions: [],
  isPaired: true,
  orientationCues: [
    'front of the knee = the kneecap and the tendon below it',
    'inside vs outside is the harder one — if you are not sure, say "inside" meaning towards the other knee',
    'above the knee is the thigh, below is the shin',
  ],
  preScreen: [
    'Did you hear or feel a pop at the moment it started?',
    'Can you put weight on the leg at all?',
    'Is the knee hot and swollen compared with the other one?',
    'Is it locking — catching, or suddenly giving way?',
  ],
  subRegions: [
    {
      id: 'knee.anterior',
      label: 'Front of knee',
      mapId: 'knee-anterior',
      structures: [
        structure('knee.patella', 'Patella', 'bone', 'anterior', 'the kneecap', ['kneecap']),
        structure('knee.patellar-tendon', 'Patellar tendon', 'tendon', 'anterior', 'the tendon from the kneecap down to the shin bone', ['quadriceps tendon', 'patellar ligament']),
        structure('knee.quadriceps-tendon', 'Quadriceps tendon', 'tendon', 'anterior', 'the tendon above the kneecap'),
        structure('knee.prepatellar-bursa', 'Prepatellar bursa', 'fascia', 'anterior', 'the cushion over the kneecap', ["housemaid's knee"]),
        structure('knee.patellofemoral-joint', 'Patellofemoral joint', 'joint', 'deep', 'where the kneecap slides on the thigh bone'),
      ],
    },
    {
      id: 'knee.medial',
      label: 'Inside of knee',
      mapId: 'knee-medial',
      structures: [
        structure('knee.mcl', 'Medial collateral ligament', 'ligament', 'medial', 'the ligament on the inside of the knee', ['MCL']),
        structure('knee.meniscus-medial', 'Medial meniscus', 'bone', 'deep', 'the cartilage pad on the inside of the knee', ['medial meniscus']),
        structure('knee.sartorius-gracilis-semimembranosus', 'Pes anserinus tendons', 'tendon', 'medial', 'the tendons on the inside of the knee below the joint line'),
        structure('knee.tibial-collateral-bursa', 'Medial tibial collateral bursa', 'fascia', 'medial', 'a small cushion on the inside of the knee'),
      ],
    },
    {
      id: 'knee.lateral',
      label: 'Outside of knee',
      mapId: 'knee-lateral',
      structures: [
        structure('knee.lcl', 'Lateral collateral ligament', 'ligament', 'lateral', 'the ligament on the outside of the knee', ['LCL']),
        structure('knee.meniscus-lateral', 'Lateral meniscus', 'bone', 'deep', 'the cartilage pad on the outside of the knee', ['lateral meniscus']),
        structure('knee.iliotibial-band', 'Iliotibial band', 'fascia', 'lateral', 'the thick band down the outside of the thigh to the shin', ['IT band', 'ITB']),
        structure('knee.popliteus', 'Popliteus', 'muscle', 'lateral', 'the muscle at the back of the knee that unlocks it'),
        structure('knee.lateral-collateral-bursa', 'Lateral collateral bursa', 'fascia', 'lateral', 'a small cushion on the outside of the knee'),
      ],
    },
    {
      id: 'knee.posterior',
      label: 'Back of knee',
      mapId: 'knee-posterior',
      structures: [
        structure('knee.popliteal-space', 'Popliteal space', 'fascia', 'posterior', 'the hollow at the back of the knee', ['behind the knee']),
        structure('knee.semimembranosus-tendon', 'Semimembranosus tendon', 'tendon', 'posterior', 'the tendon at the back inside corner of the knee'),
        structure('knee.gastrocnemius-head', 'Gastrocnemius (inner head)', 'muscle', 'posterior', 'the calf muscle just above the back of the knee'),
        structure('knee.popliteal-artery', 'Popliteal artery', 'vessel', 'deep', 'the main artery at the back of the knee'),
        structure('knee.tibial-nerve', 'Tibial nerve', 'nerve', 'deep', 'the nerve running down the back of the knee into the calf'),
      ],
    },
  ],
};

export const REGIONS: Record<BodyRegion, RegionDefinition> = {
  shoulder: SHOULDER,
  neck: NECK,
  lower_back: LOWER_BACK,
  knee: KNEE,
};

export const ALL_STRUCTURES: readonly Structure[] = Object.values(REGIONS).flatMap((r) =>
  r.subRegions.flatMap((s) => s.structures),
);

const STRUCTURE_INDEX = new Map(ALL_STRUCTURES.map((s) => [s.id, s] as const));
/** Alias/layTerm → canonical structure id, for natural-language grounding. */
const ALIAS_INDEX = new Map<string, string>();
for (const s of ALL_STRUCTURES) {
  for (const key of [s.layTerm, ...s.aliases, s.label].filter((x): x is string => Boolean(x))) {
    ALIAS_INDEX.set(normalisePhrase(key), s.id);
  }
}

export function normalisePhrase(input: string): string {
  return input
    .toLowerCase()
    .replace(/[’']/g, "'")
    .replace(/[^a-z0-9一-鿿\s]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

export function getStructure(id: string): Structure | undefined {
  return STRUCTURE_INDEX.get(id);
}

export function resolveStructureByPhrase(phrase: string): Structure | undefined {
  const id = ALIAS_INDEX.get(normalisePhrase(phrase));
  return id ? STRUCTURE_INDEX.get(id) : undefined;
}

export function structuresForRegion(region: BodyRegion, subRegionId?: string): Structure[] {
  const def = REGIONS[region];
  if (!subRegionId) {
    const seen = new Map<string, Structure>();
    for (const s of def.subRegions.flatMap((x) => x.structures)) seen.set(s.id, s);
    return [...seen.values()];
  }
  return def.subRegions.find((s) => s.id === subRegionId)?.structures ?? [];
}

export function getSubRegion(region: BodyRegion, subRegionId: string): SubRegion | undefined {
  return REGIONS[region].subRegions.find((s) => s.id === subRegionId);
}

/** Id prefix used by this region's structures, e.g. shoulder → `asi:shoulder.`. */
const STRUCTURE_PREFIX: Record<BodyRegion, string> = {
  shoulder: 'asi:shoulder.',
  neck: 'asi:neck.',
  lower_back: 'asi:lower-back.',
  knee: 'asi:knee.',
};

export function structureIdPrefix(region: BodyRegion): string {
  return STRUCTURE_PREFIX[region];
}

export function structureBelongsToRegion(id: string, region: BodyRegion): boolean {
  return id.startsWith(STRUCTURE_PREFIX[region]);
}

