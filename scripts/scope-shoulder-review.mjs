#!/usr/bin/env node
/**
 * Scope the RIGHT SHOULDER spike and emit the two anatomy-review queues.
 *
 * ## Why this is name-based and not box-based
 *
 * The first attempt derived the region from the anchor structures' union bounds
 * plus a margin. That box came out as x -301..50, z 939..1445 -- it spanned the
 * midline and most of the trunk, and swept in 802 meshes including liver
 * segments, teeth and the bronchial tree. A box around scapula-to-humerus is
 * simply not a definition of "shoulder": the humerus alone is 307 mm long.
 *
 * Anatomically, the shoulder girdle IS a named set of structures. So it is
 * declared as one, below, and every entry is resolved against the real data and
 * reported as found or missing. No name is assumed to exist.
 *
 * ## The two queues are deliberately different files
 *
 * shoulder-pending-review.tsv  - what the spike is blocked on
 * global-pending-review.tsv     - everything else still pending, not blocking
 *
 * This is ANATOMICAL TAXONOMY review. It is not clinical safety review, shares
 * no queue with it, and must never be merged into it.
 */
import { readFileSync, writeFileSync, mkdirSync } from 'node:fs';

const MAP = 'assets/anatomy/generated/anatomy-system-map.json';
const REVIEW = 'assets/anatomy/generated/anatomy-system-map.review.json';
const OUT_DIR = 'docs/anatomy-review';

/**
 * The right shoulder, declared. Grouped by the role each plays in the spike so
 * that a missing entry is obvious rather than buried in a count.
 */
const VOCABULARY = {
  bone: [
    'Right scapula',
    'Right clavicle',
    'Right humerus',
  ],
  muscle: [
    // rotator cuff
    'Right supraspinatus',
    'Right infraspinatus muscle',
    'Right subscapularis',
    'Right teres minor',
    'Right teres major',
    // deltoid, three parts
    'Acromial part of right deltoid',
    'Clavicular part of right deltoid',
    'Spinal part of right deltoid',
    // trapezius, three parts -- PENDING REVIEW in the source ontology
    'Ascending part of right trapezius',
    'Descending part of right trapezius',
    'Transverse part of right trapezius',
    // scapulothoracic and thoracic wall
    'Right pectoralis minor',
    'Sternocostal part of right pectoralis major',
    'Clavicular part of right pectoralis major',
    'Abdominal part of right pectoralis major',
    'Right serratus anterior',
    'Right serratus posterior superior',
    'Right serratus posterior inferior',
    'Right rhomboid major',
    'Right rhomboid minor',
    'Right levator scapulae',
    'Right subclavius',
    // arm muscles that cross the shoulder
    'Long head of right biceps brachii',
    'Short head of right biceps brachii',
    'Long head of right triceps brachii',
    'Lateral head of right triceps brachii',
    'Medial head of right triceps brachii',
  ],
  artery: [
    'Right axillary artery',
    'Right suprascapular artery',
    'Right circumflex scapular artery',
    'Right dorsal scapular artery',
    'Right subscapular artery',
    'Right thoracodorsal artery',
    'Trunk of right thoraco-acromial artery',
  ],
  vein: [
    'Right axillary vein',
    'Right suprascapular vein',
    'Right circumflex scapular vein',
    'Right subscapular vein',
    'Right thoracodorsal vein',
  ],
  nerve: [
    // Deliberately listed and deliberately expected to be MISSING. BP3D has 42
    // nerve meshes in the whole body and none in the shoulder: no brachial
    // plexus, no axillary nerve, no suprascapular nerve. Recording the absence
    // is the point -- the spike must not imply a nerve layer it cannot show.
    'Right axillary nerve',
    'Suprascapular nerve',
  ],
  skin: ['Skin'],
};

const map = JSON.parse(readFileSync(MAP, 'utf8'));

/**
 * Review decisions OVERRIDE the derived map, and live in their own file so the
 * generated map stays pure and reproducible. An override never rewrites the
 * derivation; it is applied at read time and reported separately, so a reader
 * can always tell a derived class from a reviewed one.
 *
 * Two independent status axes are carried through, because they are genuinely
 * independent and collapsing them overstates the evidence:
 *   presentationSystemClassification -- what tissue family we PRESENT this as
 *   ontologyFmaVerification          -- whether a human checked the source
 *                                       dataset's FMA relations
 * A structure can present as muscle with its ontology verification still
 * pending. That is the expected state for the trapezius parts and must never be
 * reported as "the FMA relations were reviewed".
 */
let review = { entries: [] };
try {
  review = JSON.parse(readFileSync(REVIEW, 'utf8'));
} catch {
  console.log('no review file present; using the derived map as-is');
}
const overrideFor = new Map(review.entries.map((e) => [e.meshId, e]));
const applyReview = (m) => {
  const o = overrideFor.get(m.id);
  if (!o) {
    return {
      ...m,
      presentationSystemClassification: m.system === 'UNKNOWN' ? 'unknown' : 'machine_derived',
      ontologyFmaVerification: 'pending_human_review',
      overridden: false,
    };
  }
  return {
    ...m,
    derivedClass: m.system,
    system: o.overrideClass,
    confidence: 'reviewed',
    reviewStatus: 'review_override',
    overridden: true,
    presentationSystemClassification: o.presentationSystemClassification ?? 'proposed_with_evidence',
    ontologyFmaVerification: o.ontologyFmaVerification ?? 'pending_human_review',
    reviewEvidence: o.evidence?.map((e) => `${e.authority}: ${e.asserts}`).join(' | '),
    reviewEvidenceLimit: o.evidenceLimit,
    reviewReviewer: o.reviewer,
    reviewNote: o.rationale,
  };
};

const byName = new Map();
for (const raw of map.meshes) {
  const m = applyReview(raw);
  if (m.anatomicalName) byName.set(m.anatomicalName, m);
}

console.log('--- resolving the declared shoulder vocabulary ---\n');

const resolved = [];
const missing = [];
for (const [role, names] of Object.entries(VOCABULARY)) {
  for (const name of names) {
    const m = byName.get(name);
    if (!m) {
      missing.push({ role, name });
      continue;
    }
    resolved.push({ role, name, mesh: m });
  }
}

for (const role of Object.keys(VOCABULARY)) {
  const got = resolved.filter((r) => r.role === role);
  const miss = missing.filter((m) => m.role === role);
  console.log(`${role.toUpperCase()}  ${got.length} resolved, ${miss.length} absent`);
  for (const r of got) {
    console.log(`   ok      ${r.name.padEnd(44)} ${r.mesh.system.padEnd(9)} ${String(r.mesh.triangles).padStart(6)} tris`);
  }
  for (const m of miss) console.log(`   ABSENT  ${m.name}`);
  console.log('');
}

console.log(`resolved ${resolved.length}, absent ${missing.length}`);

// Mismatches between the role we expected and the class the ontology assigned.
// A bone declared here that the map calls a muscle is a finding, not a nuisance.
const mismatch = resolved.filter((r) => r.mesh.system !== r.role && r.role !== 'skin');
if (mismatch.length) {
  console.log('ROLE / CLASS MISMATCHES (investigate before building):');
  for (const r of mismatch) console.log(`   ${r.name}: declared ${r.role}, ontology says ${r.mesh.system}`);
  console.log('');
}
// The spike's usable set: classified, and either machine-derived at high
// confidence or carrying an explicit review decision. 'agent_proposed' is
// deliberately included so an evidence-backed proposal can be SHOWN, and it is
// reported separately below so it cannot be mistaken for a settled class.
const usable = resolved.filter(
  (r) =>
    r.mesh.system !== 'UNKNOWN' &&
    ['machine-derived', 'review_override', 'needs-review'].includes(r.mesh.reviewStatus) &&
    r.mesh.confidence !== 'low',
);
const pending = resolved.filter((r) => r.mesh.system === 'UNKNOWN' || r.mesh.confidence === 'low');
console.log(`USABLE for the spike : ${usable.length}`);
console.log(`PENDING review       : ${pending.length}`);
console.log('');

// Overrides must be visible, never silent. A structure whose class came from a
// review decision rather than the derivation is reported separately, and says
// whether a human has actually signed it off.
const overridden = usable.filter((r) => r.mesh.overridden);
if (overridden.length) {
  console.log(`CLASS OVERRIDDEN BY REVIEW (${overridden.length}) — the derived map is NOT edited:`);
  for (const r of overridden) {
    console.log(`   ${r.name}`);
    console.log(`       derived (unchanged) ${r.mesh.derivedClass}   ->   presented as ${r.mesh.system}`);
    console.log(`       presentation / system classification : ${r.mesh.presentationSystemClassification}`);
    console.log(`       ontology / FMA verification         : ${r.mesh.ontologyFmaVerification}`);
    console.log(`       decided by: ${r.mesh.reviewReviewer}`);
    console.log(`       evidence: ${r.mesh.reviewEvidence}`);
    console.log(`       limit:    ${r.mesh.reviewEvidenceLimit}`);
  }
  const unverified = overridden.filter((r) => r.mesh.ontologyFmaVerification !== 'verified');
  if (unverified.length) {
    console.log(`   !! ${unverified.length} present on external nomenclature evidence, but their ONTOLOGY`);
    console.log('      relations are still pending human review. That is a supported PRESENTATION');
    console.log('      decision. It is NOT a claim that the FMA relationships were reviewed by a human');
    console.log('      expert, and the two must never be reported as one thing.');
  }
  console.log('');
}

// Framing bounds: the union of everything usable, which is what a camera needs.
// Skin is excluded on purpose. BP3D's `Skin` mesh is the WHOLE BODY -- it spans
// x -334..333 and z -78..1641 -- so including it would frame the entire figure
// instead of the shoulder. It is kept in `structures` because skin on/off is a
// real viewer control, but it must not drive the camera.
const FRAMING = usable.filter((r) => r.role !== 'skin');
const box = { min: [Infinity, Infinity, Infinity], max: [-Infinity, -Infinity, -Infinity] };
for (const r of FRAMING) {
  for (let i = 0; i < 3; i++) {
    box.min[i] = Math.min(box.min[i], r.mesh.boundsMm.min[i]);
    box.max[i] = Math.max(box.max[i], r.mesh.boundsMm.max[i]);
  }
}
const centre = [0, 1, 2].map((i) => (box.min[i] + box.max[i]) / 2);
const extent = [0, 1, 2].map((i) => box.max[i] - box.min[i]);
console.log('shoulder framing box (mm, skin excluded)');
console.log(`  x ${box.min[0].toFixed(0)} .. ${box.max[0].toFixed(0)}`);
console.log(`  y ${box.min[1].toFixed(0)} .. ${box.max[1].toFixed(0)}`);
console.log(`  z ${box.min[2].toFixed(0)} .. ${box.max[2].toFixed(0)}`);
console.log(`  centre ${centre.map((v) => v.toFixed(0)).join(', ')}   extent ${extent.map((v) => v.toFixed(0)).join(', ')}`);
console.log(`  diagonal ${Math.hypot(...extent).toFixed(0)} mm`);
console.log(`  triangles, framing set ${FRAMING.reduce((a, r) => a + r.mesh.triangles, 0).toLocaleString()}`);
console.log(`  triangles, all usable  ${usable.reduce((a, r) => a + r.mesh.triangles, 0).toLocaleString()} (incl. whole-body skin)`);

/* --------------------------------------------------------------- emit TSVs */

const COLUMNS = [
  'meshId', 'sourceLabel', 'FMA', 'currentClass', 'ontologyPath', 'whyPending',
  'proposedClass', 'externalEvidence', 'reviewStatus', 'reviewer', 'reviewedAt',
];

const whyPending = (m) =>
  m.system === 'UNKNOWN'
    ? 'no tissue-stating node anywhere in the IS-A chain; BP3D types this concept by position only'
    : `classification "${m.system}" rests on a distant ontology node: "${m.decidedByName}" at depth ${m.decidedAtDepth}`;

const toRow = (m) => ({
  meshId: m.id,
  sourceLabel: m.anatomicalName ?? '',
  FMA: m.fmaConceptId ?? '',
  currentClass: m.system,
  ontologyPath: m.path,
  whyPending: whyPending(m),
  proposedClass: '',
  externalEvidence: '',
  reviewStatus: 'pending_review',
  reviewer: '',
  reviewedAt: '',
});

const shoulderPending = pending.map((r) => r.mesh);
const shoulderIds = new Set(resolved.map((r) => r.mesh.id));
const globalPending = map.meshes.filter(
  (m) => m.reviewStatus === 'needs-review' && !shoulderIds.has(m.id),
);

const tsv = (rows) =>
  [
    COLUMNS.join('\t'),
    ...rows.map((r) => COLUMNS.map((c) => String(r[c] ?? '').replace(/[\t\n]/g, ' ')).join('\t')),
  ].join('\n') + '\n';

mkdirSync(OUT_DIR, { recursive: true });
writeFileSync(`${OUT_DIR}/shoulder-pending-review.tsv`, tsv(shoulderPending.map(toRow)), 'utf8');
writeFileSync(`${OUT_DIR}/global-pending-review.tsv`, tsv(globalPending.map(toRow)), 'utf8');

console.log('');
console.log(`wrote ${OUT_DIR}/shoulder-pending-review.tsv  (${shoulderPending.length} rows)`);
console.log(`wrote ${OUT_DIR}/global-pending-review.tsv     (${globalPending.length} rows)`);

// Proposals are not approvals. They get their own file so a human can sign them
// off without hunting through the pending queue, and so nothing proposed can be
// mistaken for settled by someone reading only the TSVs.
if (overridden.length) {
  // Route through toRow, then override the presentation columns. Passing the raw
  // mesh object straight to tsv() wrote a file whose meshId, sourceLabel, FMA and
  // ontologyPath columns were all empty, because the mesh uses `id` and
  // `anatomicalName` while the columns are named meshId and sourceLabel.
  writeFileSync(
    `${OUT_DIR}/shoulder-review-overrides.tsv`,
    tsv(
      overridden.map((r) => ({
        ...toRow(r.mesh),
        currentClass: r.mesh.derivedClass,
        proposedClass: r.mesh.system,
        whyPending: r.mesh.reviewNote,
        externalEvidence: r.mesh.reviewEvidence,
        reviewStatus: `${r.mesh.presentationSystemClassification} / ontology:${r.mesh.ontologyFmaVerification}`,
        reviewer: r.mesh.reviewReviewer,
        reviewedAt: '',
      })),
    ),
    'utf8',
  );
  console.log(`wrote ${OUT_DIR}/shoulder-review-overrides.tsv (${overridden.length} rows; presentation decided, ontology verification outstanding)`);
}
console.log('');
console.log('shoulder pending detail:');
for (const r of pending) {
  console.log(`  ${r.name}`);
  console.log(`      ${r.mesh.system}  chain tail: ${r.mesh.path.split(' > ').slice(-3).join(' > ')}`);
}

/* A machine-readable spine for the Blender pass, so the scene builder reads the
 * same reviewed set this script resolved rather than re-deciding membership. */
writeFileSync(
  'assets/anatomy/generated/shoulder-scene.json',
  `${JSON.stringify(
    {
      schemaVersion: 1,
      region: 'shoulder',
      side: 'right',
      units: 'mm',
      lateralityConvention: "the model's own Right occupies negative x",
      framing: { min: box.min, max: box.max, centre, extent },
      totals: {
        structures: usable.length,
        triangles: usable.reduce((a, r) => a + r.mesh.triangles, 0),
        pending: pending.length,
        declaredAbsent: missing.length,
      },
      structures: usable.map((r) => ({
        id: r.mesh.id,
        label: r.name,
        role: r.role,
        system: r.mesh.system,
        derivedClass: r.mesh.derivedClass ?? r.mesh.system,
        reviewStatus: r.mesh.reviewStatus ?? 'machine-derived',
        presentationSystemClassification: r.mesh.presentationSystemClassification,
        ontologyFmaVerification: r.mesh.ontologyFmaVerification,
        reviewReviewer: r.mesh.reviewReviewer ?? null,
        fma: r.mesh.fmaConceptId,
        bp: r.mesh.bpRepresentationId,
        meshFile: r.mesh.meshFile,
        triangles: r.mesh.triangles,
        boundsMm: r.mesh.boundsMm,
      })),
      excludedPending: pending.map((r) => ({ id: r.mesh.id, label: r.name, system: r.mesh.system })),
      declaredAbsent: missing,
    },
    null,
    2,
  )}\n`,
  'utf8',
);
console.log('\nwrote assets/anatomy/generated/shoulder-scene.json');