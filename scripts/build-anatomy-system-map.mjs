#!/usr/bin/env node
/**
 * Build `anatomy-system-map`: a tissue-class for every mesh in the BodyParts3D
 * archive, derived from the licensor's own FMA IS-A hierarchy.
 *
 * Why this exists
 * ---------------
 * The archive ships complete anatomical IDENTITY per mesh -- English name, FMA
 * concept id, BP representation id, bounds, volume -- and ships no presentation
 * data at all (2234 files reference a material via `usemtl`, zero ship a
 * `mtllib`). That is why the viewer rendered everything gray: there was nothing
 * to colour by. Identity is the raw material for a layer system, and it is
 * present.
 *
 * Why walk the IS-A tree
 * ---------------------
 * `isa_inclusion_relation_list.txt` is a clean single-parent IS-A tree: 2904
 * edges, 2904 children, zero multi-parent nodes, one root (FMA62955 anatomical
 * entity). So a mesh's tissue class can be read off the licensor's own ontology
 * instead of guessed from a filename or a colour. The node that decides the class
 * is recorded, with its depth, so every mapping is auditable.
 *
 * What this refuses to do
 * ----------------------
 * It never classifies from mesh colour, geometry, bbox shape or filename shape.
 * A mesh whose ancestor chain contains no unambiguous class node is emitted as
 * UNKNOWN for manual review, rather than being forced into a category.
 *
 * Input  <source>/{isa_parts_list.txt,isa_inclusion_relation_list.txt,
 *                    isa_element_parts.txt,obj/isa_BP3D_4.0_obj_99/*.obj}
 * Output assets/anatomy/generated/anatomy-system-map.json  (+ a console report)
 *
 * The source tree is 624 MB of third-party geometry and is gitignored, so it is
 * not present in every worktree. Point at it with ASI_BP3D_SOURCE when it is not
 * at the default location.
 */
import { readFileSync, writeFileSync, readdirSync, mkdirSync, existsSync } from 'node:fs';
import { join, resolve } from 'node:path';

const CANDIDATES = [
  process.env.ASI_BP3D_SOURCE,
  'assets/anatomy/source',
  'E:/1project/anatomical-symptom-interface/assets/anatomy/source',
].filter(Boolean);

const SRC = CANDIDATES.find((c) => existsSync(join(c, 'isa_parts_list.txt')));
if (!SRC) {
  console.error(`Could not find the BodyParts3D source tables. Looked in:\n  ${CANDIDATES.join('\n  ')}`);
  console.error('Set ASI_BP3D_SOURCE to the directory holding isa_parts_list.txt.');
  process.exit(2);
}

const OBJ = join(SRC, 'obj', 'isa_BP3D_4.0_obj_99');
const OUT_DIR = 'assets/anatomy/generated';
const OUT = join(OUT_DIR, 'anatomy-system-map.json');

console.log(`source                ${resolve(SRC)}`);

/* ------------------------------------------------------------------ tables */

const tsv = (path) => {
  const lines = readFileSync(path, 'utf8').split(/\r?\n/).filter((l) => l.length > 0);
  const head = lines[0].split('\t');
  return lines.slice(1).map((l) => {
    const c = l.split('\t');
    return Object.fromEntries(head.map((h, i) => [h, c[i]]));
  });
};

const parts = tsv(join(SRC, 'isa_parts_list.txt'));
const rels = tsv(join(SRC, 'isa_inclusion_relation_list.txt'));
const elems = tsv(join(SRC, 'isa_element_parts.txt'));

/** FMA concept id -> { en, bp } */
const concept = new Map(parts.map((p) => [p['concept id'], { en: p.en, bp: p['representation id'] }]));

/** child FMA -> parent FMA */
const parentOf = new Map(rels.map((r) => [r['child id'], r['parent id']]));
/** parent FMA -> child FMA[] */
const childrenOf = new Map();
for (const r of rels) {
  const list = childrenOf.get(r['parent id']) ?? [];
  list.push(r['child id']);
  childrenOf.set(r['parent id'], list);
}

/** concept FMA -> mesh file stems */
const meshesOf = new Map();
for (const e of elems) {
  const list = meshesOf.get(e['concept id']) ?? [];
  list.push(e['element file id']);
  meshesOf.set(e['concept id'], list);
}

/**
 * mesh stem -> every concept that claims it, according to element_parts.
 *
 * Note this is NOT one-concept-per-mesh. element_parts materialises the whole
 * IS-A closure, so `FJ1450` is listed under external anal sphincter, perineal
 * muscle, muscle organ, organ, anatomical structure, anatomical entity and more.
 * The deepest claimant is the mesh's own concept; the rest are its ancestors.
 */
const claimsOf = new Map();
for (const e of elems) {
  const list = claimsOf.get(e['element file id']) ?? [];
  list.push(e['concept id']);
  claimsOf.set(e['element file id'], list);
}

/* ------------------------------------------------------- the classification
 * Ordered rules. Order is load-bearing: the first rule whose pattern matches an
 * ANCESTOR NODE NAME wins, so specific tissue classes must precede the generic
 * `organ` catch-all, and `artery` must precede anything matching `organ`
 * (BodyParts3D has nodes like "segment of arterial tree organ").
 *
 * These patterns are matched against ontology node names supplied by the
 * licensor. They are never matched against a mesh filename or a colour.
 */
const RULES = [
  { system: 'artery', pattern: /\bartery\b|\barterial\b/i },
  { system: 'vein', pattern: /\bvein\b|\bvenous\b/i },
  { system: 'nerve', pattern: /\bnerve\b|\bneural\b|\bplexus\b/i },
  { system: 'bone', pattern: /\bbones?\b|\bskeleton\b/i },
  { system: 'cartilage', pattern: /cartilage/i },
  { system: 'tendon', pattern: /tendon/i },
  { system: 'ligament', pattern: /ligament/i },
  { system: 'fascia', pattern: /fascia|fascial/i },
  { system: 'muscle', pattern: /\bmuscles?\b|myo|tendon organ/i },
  { system: 'skin', pattern: /\bskin\b|integument|cutaneous/i },
  { system: 'gland', pattern: /\bgland\b|aden/i },
  // Everything BP3D models that is not one of the above is, in FMA's own words,
  // an organ. Recorded as its own system rather than silently folded in, and
  // flagged `generic` because a node offering only this is not making a
  // statement about tissue -- see POSITIONAL below.
  { system: 'organ', pattern: /\borgan(s)?\b/i, generic: true },
];

const SPECIFIC = RULES.filter((r) => !r.generic);

/** Deepest-first walk from a concept up to the root, inclusive of the concept. */
function chainFrom(fma) {
  const out = [];
  let cur = fma;
  const guard = new Set();
  while (cur && !guard.has(cur)) {
    guard.add(cur);
    out.push(cur);
    cur = parentOf.get(cur);
  }
  return out;
}

/**
 * FMA nodes that LOOK positional, and the rule for reading them.
 *
 * `organ zone`, `organ region`, `cardinal organ part` and `zone of muscle organ`
 * all appear between a structure and its real class, and all of them contain the
 * word "organ". Taken literally, `cardinal organ part` turns every deltoid and
 * trapezius part into an organ.
 *
 * They are not equally empty, and that is the whole subtlety. `zone of muscle
 * organ` NAMES a tissue, and it is the only thing standing between `spinal part
 * of right deltoid` and a class. `organ zone` names nothing at all. So a
 * positional-looking node is skipped ONLY when the best it can offer is the
 * generic `organ` catch-all; a specific tissue word inside it is honoured.
 *
 * Skipping such nodes unconditionally sends every deltoid and trapezius part to
 * UNKNOWN, because BP3D routes them through three positional layers and then
 * stops. Accepting them unconditionally makes them organs. The distinction above
 * is the only behaviour that gets both right.
 *
 * The pattern is deliberately narrow. An earlier, broader version also skipped
 * `portion of` and `compartment`, which pushed UNKNOWN from 56 to 377 by hiding
 * the class node behind phrases like "portion of gingiva".
 */
const POSITIONAL = /\b(zone|region)\b|\borgan part\b/i;

/**
 * Classify one mesh by walking its concept's ancestors.
 *
 * Confidence is a function of how far up the tree the deciding node sits, and
 * it is a statement about the evidence, not about the anatomy:
 *   high    - a class node at depth <= 6; the ontology commits early
 *   medium  - a class node at depth <= 11
 *   low     - a class node deeper than that
 *   unknown - no tissue-stating node in the chain at all
 */
function classify(fma) {
  const chain = chainFrom(fma);
  const skipped = [];

  for (let d = 0; d < chain.length; d++) {
    const node = chain[d];
    const name = concept.get(node)?.en ?? rels.find((r) => r['child id'] === node)?.['child name'] ?? null;
    if (!name) continue;

    const positional = POSITIONAL.test(name);
    const pool = positional ? SPECIFIC : RULES;
    const rule = pool.find((r) => r.pattern.test(name));

    if (!rule) {
      if (positional) skipped.push(`${name} (depth ${d}, positional, names no tissue)`);
      continue;
    }

    const confidence = d <= 6 ? 'high' : d <= 11 ? 'medium' : 'low';
    return {
      system: rule.system,
      confidence,
      reviewStatus: confidence === 'high' ? 'machine-derived' : 'needs-review',
      decidedByConcept: node,
      decidedByName: name,
      decidedAtDepth: d,
      readThroughPositionalNode: positional,
      skippedStructuralNodes: skipped,
      path: chain.slice(0, d + 1).map((c) => concept.get(c)?.en ?? c).reverse().join(' > '),
    };
  }

  const own = concept.get(fma)?.en ?? null;
  return {
    system: 'UNKNOWN',
    confidence: 'unknown',
    reviewStatus: 'needs-review',
    decidedByConcept: null,
    decidedByName: null,
    decidedAtDepth: null,
    readThroughPositionalNode: false,
    skippedStructuralNodes: skipped,
    path: chain.map((c) => concept.get(c)?.en ?? c).reverse().join(' > '),
    note: own
      ? `the IS-A chain for "${own}" contains no tissue-stating node; BP3D types this concept by position, not by tissue`
      : 'concept not in the parts list',
  };
}

/* ------------------------------------------------------------- mesh headers
 * The header patterns use [ \\t]* rather than \\s*: \\s spans newlines, so a
 * header field left EMPTY by the exporter ("# English name :") would otherwise
 * capture the following "# Bounds(mm): ..." line as its value. That produced 73
 * meshes named after their own bounding box before it was caught.
 */
const RE_BOUNDS = /^#\s*Bounds\(mm\):\s*\(([-\d.eE+]+),([-\d.eE+]+),([-\d.eE+]+)\)-\(([-\d.eE+]+),([-\d.eE+]+),([-\d.eE+]+)\)/m;
const RE_NAME = /^#\s*English name\s*:[ \t]*(.+)$/m;
const RE_FMA = /^#\s*Concept ID\s*:[ \t]*(FMA\d+)/m;
const RE_BP = /^#\s*Representation ID\s*:[ \t]*(BP\d+)/m;
const RE_VERTS = /^v\s/gm;
const RE_FACES = /^f\s/gm;

const files = readdirSync(OBJ).filter((f) => f.endsWith('.obj')).sort();
const meshes = [];

/** depth of a concept in the IS-A tree, used to pick the deepest claimant */
function depthOf(fma) {
  let d = 0;
  let cur = fma;
  const guard = new Set();
  while (parentOf.has(cur) && !guard.has(cur)) {
    guard.add(cur);
    cur = parentOf.get(cur);
    d++;
  }
  return d;
}

for (const file of files) {
  const text = readFileSync(join(OBJ, file), 'utf8');
  const head = text.slice(0, 1600);
  const stem = file.replace(/\.obj$/, '');

  const b = RE_BOUNDS.exec(head);
  const headerFma = (RE_FMA.exec(head) ?? [])[1] ?? null;

  // Identity: the per-mesh header is authoritative. 17 of 2234 files leave the
  // Concept ID field empty, and for those the deepest concept claiming the mesh
  // in element_parts is used instead -- the generic claimants in that table are
  // the IS-A closure, so depth is what separates the real concept from
  // "anatomical entity". Which route was taken is recorded per mesh, because an
  // inferred identity deserves less trust than a stated one.
  let fma = headerFma;
  let conceptSource = 'obj-header';
  let claimants = [];
  if (!fma) {
    claimants = (claimsOf.get(stem) ?? [])
      .slice()
      .sort((a, c) => depthOf(c) - depthOf(a));
    fma = claimants[0] ?? null;
    conceptSource = fma ? 'element-parts-inferred' : 'unresolved';
  }

  const cls = fma
    ? classify(fma)
    : {
        system: 'UNKNOWN',
        confidence: 'unknown',
        reviewStatus: 'needs-review',
        decidedByConcept: null,
        decidedByName: null,
        decidedAtDepth: null,
        path: '',
        note: 'mesh identity unresolved: no Concept ID header and no element_parts claim',
      };

  const name = (RE_NAME.exec(head) ?? [])[1]?.trim() ?? null;
  const mirrored = /M$/.test(stem);
  let laterality = 'midline';
  if (mirrored) laterality = 'left';
  else if (/^Right\b/.test(name ?? '')) laterality = 'right';
  else if (/^Left\b/.test(name ?? '')) laterality = 'left';

  meshes.push({
    id: `bp3d:${stem}`,
    meshFile: file,
    anatomicalName: name,
    fmaConceptId: fma,
    conceptSource,
    conceptClaimCount: claimants.length,
    bpRepresentationId: (RE_BP.exec(head) ?? [])[1] ?? null,
    laterality,
    mirroredSource: mirrored,
    boundsMm: b ? { min: [+b[1], +b[2], +b[3]], max: [+b[4], +b[5], +b[6]] } : null,
    vertices: (text.match(RE_VERTS) ?? []).length,
    triangles: (text.match(RE_FACES) ?? []).length,
    ...cls,
  });
}

/* ------------------------------------------------------------------- report */

const bySystem = new Map();
const byConfidence = new Map();
for (const m of meshes) {
  bySystem.set(m.system, (bySystem.get(m.system) ?? 0) + 1);
  byConfidence.set(m.confidence, (byConfidence.get(m.confidence) ?? 0) + 1);
}

const total = meshes.length;
const totalTris = meshes.reduce((a, m) => a + m.triangles, 0);

console.log(`meshes parsed        ${total}`);
console.log(`triangles            ${totalTris.toLocaleString()}`);
console.log(`concepts in parts    ${parts.length}`);
console.log(`edges in IS-A tree   ${rels.length}  (single-parent: ${parentOf.size === rels.length})`);
console.log('');
console.log('by system:');
for (const [k, v] of [...bySystem].sort((a, b) => b[1] - a[1])) {
  console.log(`  ${k.padEnd(12)} ${String(v).padStart(5)}  ${((v / total) * 100).toFixed(1)}%`);
}
console.log('');
console.log('by confidence:');
for (const [k, v] of [...byConfidence].sort((a, b) => b[1] - a[1])) {
  console.log(`  ${k.padEnd(12)} ${String(v).padStart(5)}`);
}

const unknown = meshes.filter((m) => m.system === 'UNKNOWN');
// Two different failures need different fixes, so they are counted apart.
const unknownNoIdentity = unknown.filter((m) => m.fmaConceptId === null);
const unknownNoClass = unknown.filter((m) => m.fmaConceptId !== null);

console.log('');
console.log(`UNKNOWN total: ${unknown.length}`);
console.log(`  identity unresolved (no concept anywhere)  ${unknownNoIdentity.length}`);
console.log(`  concept known, but no tissue-class node     ${unknownNoClass.length}`);
if (unknownNoClass.length) {
  console.log('  the latter are genuinely unclassifiable by tissue type and want a human decision:');
  for (const m of unknownNoClass.slice(0, 12)) {
    console.log(`    ${m.id.padEnd(16)} ${(m.anatomicalName ?? '(unnamed)').padEnd(40)} chain ends: ${m.path.split(' > ').slice(-2).join(' > ')}`);
  }
}

const byConceptSource = new Map();
for (const m of meshes) byConceptSource.set(m.conceptSource, (byConceptSource.get(m.conceptSource) ?? 0) + 1);
console.log('');
console.log('mesh identity source:');
for (const [k, v] of [...byConceptSource].sort((a, b) => b[1] - a[1])) {
  console.log(`  ${k.padEnd(24)} ${String(v).padStart(5)}`);
}

const needsReview = meshes.filter((m) => m.reviewStatus === 'needs-review');
console.log('');
console.log(`needs-review total: ${needsReview.length} (${((needsReview.length / total) * 100).toFixed(1)}%)`);

/* ------------------------------------------------- consistency audit
 * NOT a classifier. The classification above never looks at a mesh's anatomical
 * name. This is the opposite: it takes the name's obvious tissue word and
 * compares it against what the ontology walk decided, so that DISAGREEMENTS
 * surface as review candidates. A name saying "muscle" while the class says
 * "organ" is either a mapping bug or an ontology quirk, and either way a human
 * should look. Agreement is not proof -- plenty of correctly-classed meshes have
 * uninformative names -- but disagreement is a real defect signal.
 */
const NAME_HINT = [
  // Only unambiguous terms. "deltoid" is excluded because "deltoid branch of the
  // thoraco-acromial artery" is an artery, and "vertebra" because "intervertebral
  // disk" is cartilage. Both were audit noise, not signal.
  ['muscle', /\bmuscle\b|\btrapezius\b|\bpectoralis\b|\bgluteus\b|\bserratus\b|\brhomboid\b/i],
  ['bone', /\bbone\b|\bscapula\b|\bclavicle\b|\bhumerus\b|\bfemur\b|\btibia\b|\bmandible\b/i],
  ['artery', /\bartery\b/i],
  ['vein', /\bvein\b/i],
  ['nerve', /\bnerve\b/i],
  ['ligament', /\bligament\b/i],
  ['tendon', /\btendon\b/i],
  ['cartilage', /\bcartilage\b/i],
];

const suspects = [];
for (const m of meshes) {
  if (m.system === 'UNKNOWN' || !m.anatomicalName) continue;
  for (const [system, re] of NAME_HINT) {
    if (re.test(m.anatomicalName) && m.system !== system) {
      suspects.push({ m, implied: system });
      break;
    }
  }
}

console.log('');
console.log(`CONSISTENCY AUDIT: ${suspects.length} mesh(es) where the anatomical name and the`);
console.log('ontology-derived class disagree. These are review candidates, not errors on their own.');
const byPair = new Map();
for (const s of suspects) {
  const k = `${s.implied} -> ${s.m.system}`;
  byPair.set(k, (byPair.get(k) ?? 0) + 1);
}
for (const [k, v] of [...byPair].sort((a, b) => b[1] - a[1])) {
  console.log(`  ${k.padEnd(28)} ${String(v).padStart(4)}`);
}
for (const s of suspects.slice(0, 12)) {
  console.log(`    e.g. "${s.m.anatomicalName}" name implies ${s.implied}, classified ${s.m.system} via "${s.m.decidedByName}"`);
}

/* -------------------------------------------------------------------- write */

mkdirSync(OUT_DIR, { recursive: true });
writeFileSync(
  OUT,
  `${JSON.stringify(
    {
      schemaVersion: 1,
      generator: { name: 'build-anatomy-system-map', version: '1.0.0' },
      source: {
        dataset: 'BodyParts3D',
        release: '4.0',
        archive: 'isa_BP3D_4.0_obj_99.zip',
        archiveSha256: '40665852c49f218326590e204db91064a1ecfc3c6f8cbd7bbbcaac62c7cd409e',
        doi: '10.18908/lsdba.nbdc00837-000',
        licence: 'CC-BY-4.0',
        licenceUrl: 'https://dbarchive.biosciencedb.jp/en/bodyparts3d/lic.html',
        attribution:
          'BodyParts3D, (c) The Database Center for Life Science licensed under CC Attribution 4.0 International',
        retrievedAt: '2026-10-01',
        modified: true,
        modificationNote: 'geometry unmodified; classification and GLB re-encoding are ours',
      },
      derivation: {
        method: 'FMA IS-A ancestor walk',
        table: 'isa_inclusion_relation_list.txt',
        root: 'FMA62955',
        note:
          'Classification comes from the licensor ontology node that decides the class. No mesh is classified from colour, geometry, bbox shape or filename shape. A mesh with no class node in its chain is UNKNOWN.',
        rules: RULES.map((r) => ({ system: r.system, pattern: String(r.pattern) })),
      },
      counts: {
        meshes: total,
        triangles: totalTris,
        bySystem: Object.fromEntries([...bySystem].sort()),
        byConfidence: Object.fromEntries([...byConfidence].sort()),
        byConceptSource: Object.fromEntries([...byConceptSource].sort()),
        needsReview: needsReview.length,
        unknown: unknown.length,
        unknownNoIdentity: unknownNoIdentity.length,
        unknownNoClassNode: unknownNoClass.length,
        consistencySuspects: suspects.length,
      },
      meshes,
    },
    null,
    2,
  )}\n`,
  'utf8',
);

console.log('');
console.log(`wrote ${OUT}`);