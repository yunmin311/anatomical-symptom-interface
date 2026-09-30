/**
 * Deterministic anatomical grounding from free text.
 *
 * This is NOT the product's main localiser — the orchestrator LLM is. This is
 * the deterministic floor:
 *   - runs with no network and no API key,
 *   - gives the same answer every time, so it is testable and auditable,
 *   - acts as a safety net when the model is unavailable, and
 *   - provides a candidate set the model then confirms or overrides.
 *
 * It never claims certainty. Everything it returns is a CANDIDATE, and the
 * candidate is only promoted to a user-confirmed location when the user
 * actually confirms it on the model.
 */
import type { BodyRegion, ConsideredStructure, Depth, Side, Structure } from './anatomy.ts';
import {
  REGIONS,
  getStructure,
  normalisePhrase,
  resolveStructureByPhrase,
  structureBelongsToRegion,
  structuresForRegion,
} from './anatomy.ts';

export interface GroundingCandidate {
  region: BodyRegion;
  side: Side;
  depth: Depth;
  /** 0..1 heuristic score. Not a clinical probability. */
  score: number;
  /** Human-readable words that triggered the match. Shown to the user. */
  matchedTerms: string[];
  suggestedSubRegionId: string | null;
  consideredStructures: ConsideredStructure[];
  /** Verbatim input, always preserved. */
  userPhrase: string;
  /** Resolved ASI structure ids surfaced as candidates. */
  candidateStructureIds: string[];
}

/**
 * Why an input could not be grounded.
 *
 * `ungrounded` means we could not place it in any region we handle.
 * `out_of_scope` means it looks like a body region this V1 build does not cover
 * — a different workflow, not a failed guess.
 *
 * This is a ROUTER, not a detector. It does not assess whether anything is
 * medically wrong, and it must not grow into a triage engine. See ADR 0003.
 */
export type UnsupportedReason = 'ungrounded' | 'out_of_scope';

export interface GroundingRefusal {
  reason: UnsupportedReason;
  userPhrase: string;
  /** Why we declined, in words safe to show a user. Never a diagnosis. */
  message: string;
  /** Which regions this build can localise, so the UI can say so. */
  supportedRegions: BodyRegion[];
  /**
   * Body regions we recognise but do not handle. This is a coverage statement,
   * not a clinical judgement: "we do not have a workflow for this area".
   */
  outOfScopeRegions: string[];
}

/**
 * Regions this build has no interview for. Matched on explicit body-part terms
 * only. A match routes the user to a neutral "we cannot localise this safely"
 * path — it must never fall through to a musculoskeletal interview, and it must
 * never assert that the user's problem is serious.
 */
const OUT_OF_SCOPE_TERMS: Readonly<Record<string, readonly string[]>> = Object.freeze({
  chest: ['chest', 'chest pain', 'chest tightness', '胸', '胸口', '胸部', '心口', '心前区'],
  breathlessness: [
    'breathless', 'shortness of breath', 'short of breath', 'cannot breathe', "can't breathe",
    'wheezing', '喘息', '气短', '呼吸困难', '喘不上气',
  ],
  abdomen: ['stomach', 'abdomen', 'belly', 'abdominal', 'belly pain', '腹痛', '肚子', '腹部', '胃痛'],
  pelvis_groin: ['pelvis', 'pelvic', 'testicle', 'testicles', 'scrotum', '阴部', '睾丸', '盆腔'],
  skin_rash: ['rash', 'itching', 'itchy', 'hives', 'boils', 'rash', '皮疹', '瘙痒', '起疹', '疹子'],
  urinary: ['urine', 'urinating', 'burning urine', 'urine', '尿', '尿频', '尿痛'],
  neurological: [
    'seizure', 'fit', 'fainting', 'fainted', 'blackout', 'slurred speech', 'face droop',
    '癫痫', '晕倒', '昏厥', '口齿不清', '口角歪斜',
  ],
  eye: ['eye', 'eyes', 'vision', 'blurred vision', 'eye pain', '眼睛', '视力', '看不清', '眼痛'],
  ear: ['ear', 'earache', 'ear pain', 'hearing', '耳朵', '耳痛', '听力'],
  dental: ['tooth', 'teeth', 'toothache', 'gum', '牙', '牙痛', '牙齿'],
  pregnancy: ['pregnant', 'pregnancy', 'miscarriage', '怀孕', '孕期', '流产'],
});

/** Regions this build localises. */
const SUPPORTED_REGIONS: readonly BodyRegion[] = ['shoulder', 'neck', 'lower_back', 'knee'];

/**
 * Detect a region this build cannot localise. Returns null when nothing matches.
 *
 * Deliberately conservative: only unambiguous, explicit body-part terms. A word
 * like "arm" is NOT out of scope, because the shoulder workflow covers it.
 */
export function detectOutOfScope(text: string): { area: string; term: string } | null {
  const compact = normalisePhrase(text);
  for (const [area, terms] of Object.entries(OUT_OF_SCOPE_TERMS)) {
    for (const term of terms) {
      if (compact.includes(term)) return { area, term };
    }
  }
  return null;
}

/**
 * Build the neutral refusal the UI shows. Says only what we can and cannot do.
 * It must not name a condition, estimate severity, or tell the user whether
 * they need urgent care — that is a validated clinical layer's job, and this
 * build does not have one.
 */
export function groundingRefusal(utterance: string, detected: { area: string; term: string } | null): GroundingRefusal {
  const outOfScopeRegions = detected ? [detected.area] : [];
  return {
    reason: detected ? 'out_of_scope' : 'ungrounded',
    userPhrase: utterance,
    message: detected
      ? 'This tool helps describe shoulder, neck, lower back and knee problems. ' +
        'That description does not fit those areas, so this workflow will stop here rather than ' +
        'send you to the wrong questions. Nothing has been recorded. ' +
        'If you are worried about your symptoms, contact a clinician or your local emergency service directly.'
      : 'I could not work out where on the body you are describing. Rather than guess, ' +
        'this workflow will stop here. Nothing has been recorded. You can pick a region below, ' +
        'or rephrase and try again. If you are worried about your symptoms, contact a clinician ' +
        'or your local emergency service directly.',
    supportedRegions: [...SUPPORTED_REGIONS],
    outOfScopeRegions,
  };
}

/**
 * Localise, or refuse explicitly.
 *
 * There is no third option. A previous version fell back to `shoulder` when
 * nothing matched, which meant any complaint at all — including a chest
 * complaint — silently entered the shoulder questionnaire. That is the exact
 * failure this function now makes impossible.
 */
export function groundOrRefuse(input: string): { ok: true; candidate: GroundingCandidate } | { ok: false; refusal: GroundingRefusal } {
  const raw = input.trim();
  if (!raw) {
    return { ok: false, refusal: groundingRefusal(raw, null) };
  }
  const outOfScope = detectOutOfScope(raw);
  if (outOfScope) {
    return { ok: false, refusal: groundingRefusal(raw, outOfScope) };
  }
  const candidate = groundFromText(raw);
  if (!candidate) {
    return { ok: false, refusal: groundingRefusal(raw, null) };
  }
  return { ok: true, candidate };
}

interface RegionLexicon {
  region: BodyRegion;
  terms: string[];
  sideLex: { left: string[]; right: string[]; midline: string[] };
  depthLex: { superficial: string[]; deep: string[] };
  /** Words that point at a sub-region. */
  subRegionLex: Record<string, string[]>;
}

const LEXICON: RegionLexicon[] = [
  {
    region: 'shoulder',
    terms: ['shoulder', 'shoulders', '肩', '肩膀', '肩关节', '肩部', '上方肩膀', 'nape of the shoulder'],
    sideLex: {
      left: ['left shoulder', 'left arm', 'left side', '左肩', '左臂', '左边肩膀'],
      right: ['right shoulder', 'right arm', 'right side', '右肩', '右臂', '右边肩膀'],
      midline: [],
    },
    depthLex: {
      superficial: ['on the skin', 'surface', '表层', '皮肤上', 'on top of the muscle'],
      deep: ['deep', 'inside', 'deep inside', '里面', '深处', '内部', 'bone deep', 'underneath'],
    },
    subRegionLex: {
      'shoulder.anterior': ['front of the shoulder', 'anterior', '前面', '肩前', 'chest side of the shoulder'],
      'shoulder.lateral': ['outside of the shoulder', 'side of the shoulder', 'outer shoulder', '外侧', '肩膀外侧', 'top of the shoulder', 'shoulder top'],
      'shoulder.posterior': ['back of the shoulder', 'posterior', '后面', '肩后', 'shoulder blade area', '肩胛'],
    },
  },
  {
    region: 'neck',
    terms: ['neck', 'neck pain', 'neck ache', '颈', '脖子', '颈部', '脖子痛', 'cervical', 'nape of the neck', 'stiff neck'],
    sideLex: {
      left: ['left neck', 'left side of the neck', '左颈', '脖子左侧'],
      right: ['right neck', 'right side of the neck', '右颈', '脖子右侧'],
      midline: ['neck', 'neck pain', 'back of the neck', '脖子', '颈部', 'nape'],
    },
    depthLex: {
      superficial: ['on the skin', 'surface', '表层', '皮肤上'],
      deep: ['deep', 'at the base of the skull', '里面', '深处', 'back of the neck deep'],
    },
    subRegionLex: {
      'neck.anterior': ['front of the neck', 'throat', '脖子前面', '颈前', 'windpipe'],
      'neck.lateral': ['side of the neck', '侧面', '脖子侧面', 'lateral neck', 'neck muscle'],
      'neck.posterior': ['back of the neck', 'nape', '脖子后面', '颈后', 'posterior neck', 'base of the skull'],
    },
  },
  {
    region: 'lower_back',
    terms: [
      'lower back', 'low back', 'back pain', 'backache', 'lumbar', '腰', '腰部', '腰痛', '后背', '后腰',
      'back of the waist', 'flank', 'loin',
    ],
    sideLex: {
      left: ['left lower back', 'left side of the back', 'left leg', 'left buttock', '左腰', '腰左侧', '左腿'],
      right: ['right lower back', 'right side of the back', 'right leg', 'right buttock', '右腰', '腰右侧', '右腿'],
      midline: ['lower back', 'low back', 'back', '腰', '腰部', 'spine'],
    },
    depthLex: {
      superficial: ['on the surface', 'muscle feels sore on the surface', '表层', '肌肉表面'],
      deep: ['deep', 'in the spine', '里面', '深处', 'deep in the back', 'bone pain'],
    },
    subRegionLex: {
      'lower_back.central': ['middle of the back', 'centre of the lower back', '腰中间', '后背正中', 'spine'],
      'lower_back.left_paravertebral': ['left side of the lower back', 'left side of my back', '腰左侧'],
      'lower_back.right_paravertebral': ['right side of the lower back', 'right side of my back', '腰右侧'],
      'lower_back.sacrococcygeal': ['tailbone', 'lower back bottom', 'bottom of the back', '骶骨', '尾椎', '尾骨', 'sacrum', 'buttock', 'gluteal'],
    },
  },
  {
    region: 'knee',
    terms: ['knee', 'knees', 'knee pain', 'kneecap', '膝', '膝盖', '膝关节', '髌'],
    sideLex: {
      left: ['left knee', '左膝', '左腿膝盖'],
      right: ['right knee', '右膝', '右腿膝盖'],
      midline: [],
    },
    depthLex: {
      superficial: ['on the surface', 'around the kneecap', '表层', '膝盖表面'],
      deep: ['deep', 'inside the knee', 'inside', '里面', '深处', 'behind the knee'],
    },
    subRegionLex: {
      'knee.anterior': ['front of the knee', 'kneecap', '膝盖前面', '膝盖正中', 'patella', 'shin bump'],
      'knee.medial': ['inside of the knee', 'inner knee', 'medial', '膝盖内侧', '内侧'],
      'knee.lateral': ['outside of the knee', 'outer knee', 'lateral', '膝盖外侧', '外侧', 'it band'],
      'knee.posterior': ['behind the knee', 'back of the knee', '膝盖后面', '膝后', 'hamstring'],
    },
  },
];

function containsAny(haystack: string, needles: string[]): string[] {
  return needles.filter((n) => n.length > 0 && haystack.includes(n));
}

/** Surface words that map to structure aliases — cheap but surprisingly effective. */
const SURFACE_HINTS: string[] = [
  'rotator cuff', 'rotator', 'ac joint', 'acromioclavicular', 'frozen shoulder', 'adhesive capsulitis',
  'impingement', 'tendonitis', 'tendinitis', 'bursitis', 'frozen', 'labral', 'tear',
  'disc', 'herniated', 'slipped disc', 'sciatica', 'pinched nerve',
  'meniscus', 'mcl', 'lcl', 'acl', 'pcl', 'runners knee', 'runner\'s knee', 'housemaid',
  'subacromial', 'deltoid', 'trapezius', 'levator', 'scalene', 'brachial plexus', 'sciatic',
  'cervical', 'lumbar', 'sacroiliac', 'si joint', 'it band', 'iliotibial', 'rotator',
  'whiplash', 'torticolis', 'stiff neck', 'frozen shoulder', 'impingement syndrome',
];

export function groundFromText(input: string): GroundingCandidate | null {
  const raw = input.trim();
  if (!raw) return null;
  const text = normalisePhrase(raw);
  const compact = text.replace(/\s+/g, ' ');

  let best: { lex: RegionLexicon; score: number; matched: string[] } | null = null;

  for (const lex of LEXICON) {
    const regionTermHits = containsAny(compact, lex.terms);
    if (!regionTermHits.length) continue;
    // Longer matches are stronger evidence: "lower back" beats "back".
    const score = regionTermHits.reduce((s, t) => s + Math.min(t.length, 12) / 12, 0);
    if (!best || score > best.score) best = { lex, score, matched: regionTermHits };
  }

  if (!best) return null;
  const { lex, matched } = best;
  const matchedTerms = [...matched];

  // --- side ------------------------------------------------------------
  let side: Side = 'unknown';
  const leftHits = containsAny(compact, lex.sideLex.left);
  const rightHits = containsAny(compact, lex.sideLex.right);
  const midlineHits = containsAny(compact, lex.sideLex.midline);
  if (leftHits.length && rightHits.length) side = 'bilateral';
  else if (leftHits.length) {
    side = 'left';
    matchedTerms.push(...leftHits);
  } else if (rightHits.length) {
    side = 'right';
    matchedTerms.push(...rightHits);
  } else if (midlineHits.length && !REGIONS[lex.region].isPaired) {
    side = 'midline';
    matchedTerms.push(...midlineHits);
  } else if (midlineHits.length) {
    // Paired region with a midline word ("my knee hurts" is usually the user's
    // dominant or most-affected side). Ask rather than guess.
    matchedTerms.push(...midlineHits);
  }

  // Chinese side words appear as free-floating characters, often separated from
  // the body part by 的 / 边 / 侧, so phrase lists miss them. Once the region is
  // known, scan for the bare characters.
  if (side === 'unknown' && /[\u4e00-\u9fff]/.test(compact)) {
    const hasLeft = compact.includes('左');
    const hasRight = compact.includes('右');
    if (hasLeft && hasRight) {
      side = 'bilateral';
      matchedTerms.push('左', '右');
    } else if (hasLeft) {
      side = 'left';
      matchedTerms.push('左');
    } else if (hasRight) {
      side = 'right';
      matchedTerms.push('右');
    }
  }


  // --- depth -----------------------------------------------------------
  let depth: Depth = 'unknown';
  const deepHits = containsAny(compact, lex.depthLex.deep);
  const supHits = containsAny(compact, lex.depthLex.superficial);
  if (deepHits.length > supHits.length) {
    depth = 'deep';
    matchedTerms.push(...deepHits);
  } else if (supHits.length) {
    depth = 'superficial';
    matchedTerms.push(...supHits);
  } else if (/中间|intermediate/.test(compact)) {
    depth = 'intermediate';
  }

  // --- sub-region ------------------------------------------------------
  let suggestedSubRegionId: string | null = null;
  let bestSub = 0;
  for (const [id, words] of Object.entries(lex.subRegionLex)) {
    const hits = containsAny(compact, words);
    const score = hits.reduce((s, t) => s + t.length, 0);
    if (score > bestSub) {
      bestSub = score;
      suggestedSubRegionId = id;
      matchedTerms.push(...hits);
    }
  }
  // A side word plus a paired region also implies the side-specific sub-region.
  if (!suggestedSubRegionId && (side === 'left' || side === 'right') && REGIONS[lex.region].isPaired) {
    const sideSuffix = side === 'left' ? 'left_paravertebral' : 'right_paravertebral';
    suggestedSubRegionId = `${lex.region}.${sideSuffix}`;
  }

  // --- structure candidates -------------------------------------------
  const consideredStructures: ConsideredStructure[] = [];
  const seen = new Set<string>();

  for (const structure of structuresForRegion(lex.region, suggestedSubRegionId ?? undefined)) {
    const names = [structure.label, structure.layTerm, ...structure.aliases].filter((x): x is string => Boolean(x));
    const hit = names.find((n) => compact.includes(normalisePhrase(n)) && normalisePhrase(n).length >= 4);
    if (hit && !seen.has(structure.id)) {
      seen.add(structure.id);
      consideredStructures.push({
        structureId: structure.id,
        rationale: `You mentioned “${hit}”.`,
        confidence: 0.6,
        selectedByUser: false,
      });
    }
  }

  const hintHits = SURFACE_HINTS.filter((h) => compact.includes(h));
  for (const hint of hintHits) {
    const s = resolveStructureByPhrase(hint);
    if (s && structureBelongsToRegion(s.id, lex.region) && !seen.has(s.id)) {
      seen.add(s.id);
      consideredStructures.push({
        structureId: s.id,
        rationale: `“${hint}” is a term people use for this area.`,
        confidence: 0.45,
        selectedByUser: false,
      });
    }
  }

  const totalConsidered = consideredStructures.length;
  const score = Math.min(0.95, 0.5 + matchedTerms.length * 0.08 + totalConsidered * 0.05);

  return {
    region: lex.region,
    side,
    depth,
    score,
    matchedTerms: [...new Set(matchedTerms)],
    suggestedSubRegionId,
    consideredStructures,
    candidateStructureIds: [...seen],
    userPhrase: raw,
  };
}

export function describeCandidate(c: GroundingCandidate): string {
  const region = REGIONS[c.region];
  const side = c.side === 'unknown' ? '' : `${c.side} `;
  const depth = c.depth === 'unknown' ? '' : `, felt as ${c.depth}`;
  return `${side}${region.label}${depth}`;
}
