#!/usr/bin/env node
/**
 * Audit a region's canonical ontology against the REAL BodyParts3D archive.
 *
 * The point is to find out what the source actually offers BEFORE writing a single
 * mapping row. Every earlier failure in this project came from the other order:
 * invent a plausible filename, bind it, and only then discover the mesh was a
 * different structure. So this starts from OUR ontology and reports what the source
 * has for each concept — including "nothing", which is a valid answer.
 *
 * It binds nothing, guesses nothing, and writes nothing.
 *
 * ## WHY IT DOES NOT MATCH ON OUR LABELS
 *
 * First attempt at this resolved concepts by comparing the source's English name
 * against `structure.label` / `structure.layTerm`. It reported `no-source-concept`
 * for all 17 shoulder structures, including the ten we know are correctly bound.
 *
 * That was the tool being wrong, not the source. Our labels are written for a
 * patient: `label` is "Deltoid" but `layTerm` is "the rounded muscle on the
 * outside", and neither is a term in the source's vocabulary — the source says
 * "clavicular part of deltoid muscle". Matching prose against anatomical
 * terminology is guaranteed to fail and would have "found" nothing for every
 * region, which reads exactly like a source that has no neck.
 *
 * So resolution is layered, and every layer is labelled:
 *
 *   1. the BINDING TABLE, for structures already mapped — authoritative, and it is
 *      what makes this script a control: run it on shoulder and it must reproduce the
 *      ten bindings we shipped;
 *   2. the source's English name against `label` alone, which is the closest our
 *      vocabulary gets to the source's;
 *   3. nothing else. No stemming, no fuzzy scoring, no "contains" heuristics
 *      promoted to a match.
 *
 * Anything the table does not cover and a label does not match is reported as
 * UNRESOLVED, with the source's own candidate names printed for a human to read. That
 * is the honest output, and it is where the real work of a new region happens.
 *
 * ## THE IDENTITY BRIDGE
 *
 * `isa_element_parts.txt` is the source's own mapping, three tab-separated columns:
 *
 *     concept id <TAB> name <TAB> element file id
 *     FMA34681    clavicular part of left deltoid    FJ1468M
 *
 * So the concept id is an **FMA** id and the file id is an **`FJ####`/`FJ####M`**
 * mesh name. These are two different namespaces and conflating them is how a mapping
 * ends up with a filename in the FMA column. Both are kept separate below, and a row
 * that cannot be joined across both is reported as unusable rather than guessed.
 *
 * ## SIDE IS READ FROM THE ENGLISH NAME
 *
 * Not from the `M` suffix. BodyParts3D's suffix is an internal id convention; the
 * English name says "left clavicular part of deltoid" in words. Both are reported, so a
 * place where they disagree is visible instead of silently resolving.
 *
 *   node scripts/audit-region.mjs --region neck
 *   node scripts/audit-region.mjs --region neck --json
 */
import { readFileSync, existsSync, readdirSync } from 'node:fs';
import { join, basename } from 'node:path';
import { pathToFileURL } from 'node:url';

const ROOT = new URL('..', import.meta.url).pathname.replace(/^\/([A-Za-z]:)/, '$1');
const SRC = join(ROOT, 'assets/anatomy/source');

const argv = process.argv.slice(2);
const flag = (name, fallback) => {
  const i = argv.indexOf(`--${name}`);
  return i === -1 ? fallback : argv[i + 1];
};
const REGION = flag('region');
const AS_JSON = argv.includes('--json');

if (!REGION) {
  console.error('usage: node scripts/audit-region.mjs --region <shoulder|neck|lower_back|knee> [--json]');
  process.exit(2);
}

/* ------------------------------------------------------------------ */
/* 1. the source identity bridge                                       */
/* ------------------------------------------------------------------ */

const BRIDGE = join(SRC, 'isa_element_parts.txt');
if (!existsSync(BRIDGE)) {
  console.error(`no identity bridge at ${BRIDGE}. See assets/anatomy/README.md.`);
  process.exit(2);
}

const MESH_RE = /^FJ\d+M?$/;
const norm = (s) =>
  s
    .toLowerCase()
    .replace(/[.,()]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();

const bridgeLines = readFileSync(BRIDGE, 'latin1').split(/\r?\n/).filter((l) => l.trim());
const header = bridgeLines[0].split('\t').map((h) => norm(h));

/**
 * The header is `concept id / name / element file id`. Resolved by name rather than
 * position, because a column-order assumption here would silently map every structure
 * to the wrong mesh -- the exact failure this audit exists to prevent.
 */
const headerIndex = (want) => header.findIndex((h) => h === want);
const COL_CONCEPT = headerIndex('concept id');
const COL_NAME = headerIndex('name');
const COL_FILE = headerIndex('element file id');
if (COL_CONCEPT < 0 || COL_NAME < 0 || COL_FILE < 0) {
  console.error(
    `[audit] unexpected bridge columns: ${JSON.stringify(header)}. ` +
      `Expected 'concept id', 'name', 'element file id'. Refusing to guess.`,
  );
  process.exit(2);
}

/** FMA id -> { fma, english, files: string[] } */
const byFma = new Map();
let unusable = 0;
for (const line of bridgeLines.slice(1)) {
  const cells = line.split('\t');
  const fma = (cells[COL_CONCEPT] ?? '').trim();
  const english = (cells[COL_NAME] ?? '').trim();
  const file = (cells[COL_FILE] ?? '').trim();
  if (!/^FMA\d+$/.test(fma)) continue;
  if (!MESH_RE.test(file)) {
    // A concept whose element file is not a mesh (a picture, a measurement, a region
    // definition) still belongs in the bridge. Counted, kept, and marked.
    unusable += 1;
    continue;
  }
  if (!byFma.has(fma)) byFma.set(fma, { fma, english, files: [] });
  const entry = byFma.get(fma);
  if (!entry.files.includes(file)) entry.files.push(file);
}

/** English name (normalised) -> concepts, for looking our ontology up by name. */
const byEnglish = new Map();
for (const c of byFma.values()) {
  const k = norm(c.english);
  if (!k) continue;
  if (!byEnglish.has(k)) byEnglish.set(k, []);
  byEnglish.get(k).push(c);
}

/* ------------------------------------------------------------------ */
/* 2. what geometry exists                                             */
/* ------------------------------------------------------------------ */

const objDir = [join(SRC, 'obj', 'isa_BP3D_4.0_obj_99'), join(SRC, 'obj'), SRC].find((d) =>
  existsSync(d) && readdirSync(d).some((f) => MESH_RE.test(basename(f, '.obj'))),
);
if (!objDir) {
  console.error(`no extracted .obj files under ${SRC}/obj. Extract the archive first.`);
  process.exit(2);
}

const meshStats = new Map();
for (const f of readdirSync(objDir)) {
  if (!f.endsWith('.obj')) continue;
  const name = basename(f, '.obj');
  if (!MESH_RE.test(name)) continue;
  const text = readFileSync(join(objDir, f), 'latin1');
  meshStats.set(name, {
    faces: (text.match(/^f\s/gm) ?? []).length,
    verts: (text.match(/^v\s/gm) ?? []).length,
    groups: (text.match(/^g\s/gm) ?? []).length,
    namedGroups: (text.match(/^g\s+\S/gm) ?? []).length,
  });
}

/* ------------------------------------------------------------------ */
/* 3. our ontology for the region                                     */
/* ------------------------------------------------------------------ */

const shared = await import(pathToFileURL(join(ROOT, 'packages/shared/src/index.ts')).href);
const { REGIONS, structuresForRegion } = shared;
const region = REGIONS[REGION];
if (!region) {
  console.error(`unknown region ${REGION}. Known: ${Object.keys(REGIONS).join(', ')}`);
  process.exit(2);
}

/* ------------------------------------------------------------------ */
/* 4. audit                                                           */
/* ------------------------------------------------------------------ */

/**
 * The side, from the source's own words.
 *
 * `M` is a filename convention and is reported separately; a concept whose name says
 * "left" while its id has no `M` (or the reverse) is a thing a human should look at,
 * not something to resolve programmatically.
 */
function sideFromWords(english) {
  const e = ` ${norm(english)} `;
  if (/\bleft\b/.test(e)) return 'left';
  if (/\bright\b/.test(e)) return 'right';
  if (/\bbilateral\b|\bboth\b|\bpaired\b/.test(e)) return 'bilateral';
  return null; // midline, or unstated
}

/** Hints to check by hand. Never a decision. */
const NON_SOLID = /\b(space|joint cavity|cav|sinus|canal|foramen|sheath|bursa|compartment|lumen|interspace)\b/;
const COMPOSITE_HINT = /\b(part|portion|segment|division|head|tail|belly|zone|surface|anterior|posterior|superior|inferior|medial|lateral|proximal|distal)\b/;

// Structures live on SUB-REGIONS, and the same structure can appear under more than
// one (the deltoid is reachable from shoulder.anterior and shoulder.lateral). Read
// them through `structuresForRegion`, which de-duplicates -- otherwise the audit would
// report the deltoid twice and any count taken from it would be wrong.
const structures = shared.structuresForRegion(REGION);

/**
 * What is ALREADY bound, by structure id.
 *
 * This is layer 1 of resolution and it is the important one: it makes the audit a
 * control run. On shoulder it must reproduce the ten bindings we shipped, and if it
 * ever stops doing that, the audit is broken rather than the source having changed.
 */
const bindingTable = new Map();
for (const entry of shared.mappingFor(REGION) ?? []) {
  if (!bindingTable.has(entry.asiId)) bindingTable.set(entry.asiId, []);
  bindingTable.get(entry.asiId).push(entry);
}

/**
 * The source's English name for a mesh, read back through the bridge.
 *
 * Used to print what the source actually calls the geometry we bound, so a binding can
 * be eyeballed without cross-referencing files by hand.
 */
const conceptForMesh = new Map();
for (const c of byFma.values()) for (const f of c.files) conceptForMesh.set(f, c);

const report = [];
for (const structure of structures) {
  const bound = bindingTable.get(structure.id) ?? null;

  let exact;
  let resolvedBy;
  if (bound) {
    // Authoritative. Take the concepts the table says, via the mesh names it names.
    exact = [
      ...new Map(
        bound
          .flatMap((b) => b.candidates)
          .map((cand) => {
            const concept = conceptForMesh.get(cand.meshName);
            return concept
              ? [cand.meshName, { fma: concept.fma, english: concept.english, files: concept.files }]
              : null;
          })
          .filter(Boolean),
      ).values(),
    ];
    resolvedBy = 'binding-table';
  } else {
    // Our `label` only. `layTerm` is patient prose and cannot be expected to match an
    // anatomical term -- see the header.
    exact = (byEnglish.get(norm(structure.label)) ?? []).slice();
    resolvedBy = 'label-match';
  }

  // Looser matches, printed for a human and NEVER bound. A fuzzy hit presented as a
  // match is the guessing this script exists to prevent.
  const loose = [];
  for (const [k, concepts] of byEnglish) {
    if (concepts.some((c) => exact.includes(c))) continue;
    const label = norm(structure.label);
    if (k.includes(label) || label.includes(k)) loose.push(...concepts);
  }
  const n = norm(structure.label);

  /** A mesh id the table explicitly did not bind here, with the reason it gave. */
const decisionMarkers = [];
  const meshes = [];
  if (bound) {
    for (const cand of bound.flatMap((b) => b.candidates)) {
      const m = /^(UNAVAILABLE|SHARED):(.*)$/.exec(cand.meshName);
      if (m) {
        decisionMarkers.push({
          kind: m[1] === 'UNAVAILABLE' ? 'unavailable' : 'shared',
          detail: m[2],
          sourceLabel: cand.sourceLabel ?? null,
        });
        continue;
      }
    }
    // The table's own candidates, so a candidate naming a mesh that is absent shows up
    // as absent rather than being quietly dropped.
    for (const cand of bound.flatMap((b) => b.candidates)) {
      // `UNAVAILABLE:<name>` records that we looked and the source does not carry the
      // concept. `SHARED:<asiId>` records that the mesh is real but already bound to
      // another canonical id. Both are decisions, not missing files: counting either as
      // an absent mesh would report data loss where the answer is "correctly not bound
      // here", which is the opposite of what this audit is for.
      if (/^(UNAVAILABLE|SHARED):/.test(cand.meshName)) continue;
      const concept = conceptForMesh.get(cand.meshName);
      meshes.push({
        file: cand.meshName,
        fma: concept?.fma ?? cand.fmaConceptId ?? null,
        declaredSide: cand.side,
        sourceLabel: cand.sourceLabel ?? null,
        faces: meshStats.get(cand.meshName)?.faces ?? null,
        verts: meshStats.get(cand.meshName)?.verts ?? null,
        unnamedGroups: meshStats.has(cand.meshName)
          ? (meshStats.get(cand.meshName)?.namedGroups ?? 0) === 0
          : null,
      });
    }
  } else {
    for (const c of exact)
      for (const file of c.files)
        if (meshStats.has(file))
          meshes.push({
            file,
            fma: c.fma,
            declaredSide: null,
            sourceLabel: null,
            faces: meshStats.get(file)?.faces ?? 0,
            verts: meshStats.get(file)?.verts ?? 0,
            unnamedGroups: (meshStats.get(file)?.namedGroups ?? 0) === 0,
          });
  }

  const presentMeshes = meshes.filter((m) => meshStats.has(m.file));
  // A structure whose only candidates are decision markers has been DELIBERATELY left
  // unbound. Which kind of decision matters, so the verdict distinguishes them.
  const kind = decisionMarkers[0]?.kind ?? null;
  const verdict =
    kind === 'shared'
      ? 'bound-elsewhere'
      : kind === 'unavailable'
        ? 'declared-unavailable'
        : !bound && !exact.length
          ? 'unresolved'
          : !presentMeshes.length
            ? 'source-concept-no-mesh'
            : presentMeshes.length > 1
              ? 'multiple-meshes'
              : 'one-mesh';

  // The side, from three independent places, which is where disagreements surface.
  const wordSides = [...new Set(exact.map((c) => sideFromWords(c.english)).filter(Boolean))];
  const declaredSides = [
    ...new Set((bound ?? []).flatMap((b) => b.candidates).map((c) => c.side).filter(Boolean)),
  ];
  const sides = declaredSides.length ? declaredSides : wordSides;
  // The suffix convention, checked against the words. A disagreement is reported.
  // The suffix check only means anything for a one-sided mesh. A MIDLINE mesh has no
  // suffix and should not, so testing `FJ3157` for "is it M?" always reports a
  // disagreement -- which is how a lumbar vertebra ended up flagged as ambiguous
  // laterality in a region where it is neither left nor right.
  const suffixAgrees =
    sides.length === 1 && (sides[0] === 'left' || sides[0] === 'right')
      ? presentMeshes.every(
          (m) => (m.file.endsWith('M') ? 'left' : 'right') === sides[0],
        )
      : null;

  const totalFaces = presentMeshes.reduce((a, m) => a + (m.faces ?? 0), 0);
  const unnamedGroups = presentMeshes.filter((m) => m.unnamedGroups).length;
  const missingMeshes = meshes.filter((m) => !meshStats.has(m.file)).map((m) => m.file);

  report.push({
    asiId: structure.id,
    label: structure.label,
    layTerm: structure.layTerm ?? null,
    layer: structure.layer,
    surface: structure.surface,
    resolvedBy,
    verdict,
    declaredInTable: Boolean(bound),
    sourceConcepts: exact.map((c) => ({
      fma: c.fma,
      english: c.english,
      sideWords: sideFromWords(c.english),
      files: c.files,
    })),
    meshes,
    decisionMarkers,
    meshesMissingFromArchive: missingMeshes,
    sides,
    sidesFromSourceWords: wordSides,
    sidesDeclaredInTable: declaredSides,
    totalFaces,
    suffixAgreesWithWords: suffixAgrees,
    hints: {
      looksNonSolid: NON_SOLID.test(norm(structure.label)),
      nameSuggestsSubPart: COMPOSITE_HINT.test(norm(structure.label)),
      wholeFileIsOneUnnamedUnit: unnamedGroups > 0,
    },
    looseNameMatches: loose.map((c) => `${c.fma} "${c.english}"`),
  });
}

/* ------------------------------------------------------------------ */
/* 5. output                                                          */
/* ------------------------------------------------------------------ */

const counts = {};
for (const r of report) counts[r.verdict] = (counts[r.verdict] ?? 0) + 1;

const undeclared = report.filter((r) => !r.declaredInTable);
const byLayer = {};
for (const r of report) byLayer[r.layer] = (byLayer[r.layer] ?? 0) + 1;

if (AS_JSON) {
  console.log(
    JSON.stringify(
      { region: REGION, bridge: basename(BRIDGE), conceptsInBridge: byFma.size, bridgeRowsWithoutMesh: unusable, counts, structures: report },
      null,
      2,
    ),
  );
  process.exit(0);
}

const pad = (s, n) => String(s).padEnd(n);
console.log(`\n=== ${REGION}: canonical ontology vs the REAL archive ===`);
console.log(`  bridge      ${basename(BRIDGE)}, ${byFma.size} FMA concepts with meshes, ${unusable} rows with a non-mesh element`);
console.log(`  meshes      ${meshStats.size} .obj files under ${basename(objDir)}`);
console.log(`  ontology    ${report.length} structures in anatomy.ts`);
console.log(
  `  verdicts    ${Object.entries(counts).map(([k, v]) => `${k}=${v}`).join('  ')}`,
);
console.log(`  layers      ${Object.entries(byLayer).map(([k, v]) => `${k}=${v}`).join('  ')}`);
console.log(`  in table    ${report.length - undeclared.length} bound, ${undeclared.length} not yet mapped\n`);

const MARK = {
  'one-mesh': 'OK   ',
  'multiple-meshes': 'MULT ',
  'source-concept-no-mesh': 'NOGEO',
  'declared-unavailable': 'NONE ',
  'bound-elsewhere': 'ELSE ',
  unresolved: 'OPEN ',
};
for (const r of report) {
  console.log(
    `  ${MARK[r.verdict]} ${pad(r.asiId.replace(`asi:${REGION}.`, ''), 30)} ${pad(r.label, 28)} [${pad(r.layer, 8)}] ${pad(`via ${r.resolvedBy}`, 14)}`,
  );
  if (r.verdict === 'unresolved') {
    console.log(
      `          no binding row, and the source has no concept named "${r.label}". ` +
        `${r.looseNameMatches.length ? `Unbound resemblance: ${r.looseNameMatches.join(' | ')}` : 'Nothing in the source resembles it.'}`,
    );
  }
  if (r.verdict === 'declared-unavailable')
    console.log(
      `          recorded UNAVAILABLE: ${r.decisionMarkers.map((d) => d.detail).join(', ')}\n` +
        `          Correct outcome, not a gap. The source does not carry this as one mesh.`,
    );
  if (r.verdict === 'bound-elsewhere')
    console.log(
      `          already bound to ${r.decisionMarkers.map((d) => d.detail).join(', ')}\n` +
        `          One source mesh cannot serve two canonical ids, so it is not bound twice.`,
    );
  for (const m of r.meshes) {
    if (!meshStats.has(m.file)) {
      console.log(`          ${m.file}.obj  NAMED IN THE TABLE BUT ABSENT from the archive`);
      continue;
    }
    console.log(
      `          ${m.file}.obj  ${m.faces} faces ${m.verts} verts${m.unnamedGroups ? '  [one unnamed group: sub-regions NOT addressable]' : ''}` +
        `${m.declaredSide ? `  table side: ${m.declaredSide}` : ''}` +
        `${m.sourceLabel ? `  "${m.sourceLabel}"` : ''}`,
    );
  }
  if (r.sidesFromSourceWords.length)
    console.log(`          source says: ${r.sidesFromSourceWords.join(', ')}`);
  if (r.suffixAgreesWithWords === false)
    console.log(`          WARNING: the M-suffix disagrees with the source's own words`);
  if (r.hints.looksNonSolid) console.log(`          CHECK: the label suggests a space, not a solid`);
  if (r.hints.nameSuggestsSubPart)
    console.log(`          CHECK: the label names a PART; the source may only carry the whole`);
  console.log('');
}
console.log(
  '  OK=one mesh   MULT=several meshes   NOGEO=concept but no geometry in the archive\n' +
    '  NONE=recorded unavailable on purpose   ELSE=the real mesh is bound to another region\n' +
    '  OPEN=no binding row and no matching concept, which needs a human reading the\n' +
    '  source and not a guess\n',
);
process.exit(0);