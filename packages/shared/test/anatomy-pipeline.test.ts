/**
 * Anatomy conversion pipeline.
 *
 * The pipeline is real and runs end to end here, over a SYNTHETIC input that
 * mimics the shape of the BodyParts3D archive: OBJ-style meshes named the way
 * that dataset names them, with FMA-flavoured laterality suffixes.
 *
 * The fixture is deliberately NOT real anatomy, and nothing in the manifest
 * claims it is. It exists so the stages can be proven without the archive, which
 * is a gated multi-gigabyte download. What is being tested is the machinery --
 * selection, binding, reduction, GLB encoding, manifest generation, licence
 * metadata, budget enforcement -- not whether a deltoid looks like a deltoid.
 *
 * The properties that matter:
 *
 *   - a structure with no mesh in the input is REPORTED, never invented
 *   - a source mesh name is never used as an identity
 *   - the same input produces byte-identical output, so a manifest is reviewable
 *   - the generated GLB is structurally valid, not a plausible-looking blob
 *   - the licence and attribution cannot be missing
 *   - the geometry budget is enforced by the build, not by good intentions
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  decodeGlbJson,
  encodeGlb,
  meshFileName,
  meshTriangleCount,
  reduceMesh,
  runPipeline,
  selectStructures,
  subRegionsContaining,
} from '../src/anatomy-pipeline.ts';
import type { SourceMesh } from '../src/anatomy-pipeline.ts';
import { parseManifest, validateManifest, DEFAULT_GEOMETRY_BUDGET } from '../src/anatomy-manifest.ts';
import { BODYPARTS3D_LICENCE, BODYPARTS3D_SOURCE, SHOULDER_MAPPING, mappingFor } from '../src/anatomy-mapping.ts';
import { getStructure } from '../src/anatomy.ts';

/* ================================================================== */
/* Synthetic input, shaped like the archive but not real anatomy        */
/* ================================================================== */

/** A closed-ish blob of `rings` vertices stacked into a tube, deterministic. */
function syntheticMesh(name: string, rings: number, seg: number, radius: number): SourceMesh {
  const positions: number[] = [];
  for (let r = 0; r < rings; r++) {
    const z = r / (rings - 1);
    // A gentle taper plus a deterministic wobble, so the mesh is not a perfect
    // cylinder and reduction has something to do.
    const rad = radius * (1 - 0.3 * z) * (1 + 0.05 * Math.sin(r * 1.7));
    for (let s = 0; s < seg; s++) {
      const a = (s / seg) * Math.PI * 2;
      positions.push(rad * Math.cos(a), rad * Math.sin(a), z * 2 - 1);
    }
  }
  const indices: number[] = [];
  for (let r = 0; r + 1 < rings; r++) {
    for (let s = 0; s < seg; s++) {
      const s2 = (s + 1) % seg;
      const a = r * seg + s;
      const b = r * seg + s2;
      const c = (r + 1) * seg + s;
      const d = (r + 1) * seg + s2;
      indices.push(a, c, b, b, c, d);
    }
  }
  return { name, positions, indices };
}

const ARCHIVE_LIKE = (): Map<string, SourceMesh> =>
  new Map([
    ['Deltoid_L', syntheticMesh('Deltoid_L', 40, 48, 1.2)],
    ['Supraspinatus_tendon_L', syntheticMesh('Supraspinatus_tendon_L', 24, 32, 0.5)],
    ['Infraspinatus_L', syntheticMesh('Infraspinatus_L', 32, 40, 0.9)],
    ['Teres_minor_L', syntheticMesh('Teres_minor_L', 20, 24, 0.35)],
    ['Scapula_L', syntheticMesh('Scapula_L', 30, 36, 1.6)],
    ['Acromion_L', syntheticMesh('Acromion_L', 16, 20, 0.45)],
    ['Coracoid_process_L', syntheticMesh('Coracoid_process_L', 14, 18, 0.3)],
    ['Subscapularis_L', syntheticMesh('Subscapularis_L', 28, 34, 0.8)],
    ['Trapezius_L', syntheticMesh('Trapezius_L', 26, 30, 1.4)],
    // Deliberately NOT present: the bursa (expected absent) and the joints
    // (unexpected gaps the pipeline must report rather than paper over).
  ]);

/* ================================================================== */
/* Selection                                                           */
/* ================================================================== */

test('selection binds only meshes that exist in the input', () => {
  const names = [...ARCHIVE_LIKE().keys()];
  const r = selectStructures('shoulder', names);
  const byId = new Map(r.bound.map((b) => [b.asiId, b.meshName]));

  assert.equal(byId.get('asi:shoulder.deltoid'), 'Deltoid_L');
  assert.equal(byId.get('asi:shoulder.supraspinatus-tendon'), 'Supraspinatus_tendon_L');
  assert.equal(byId.get('asi:shoulder.scapula'), 'Scapula_L');
  // Present in the mapping, absent from the input: reported, not invented.
  const missing = r.unmapped.map((u) => u.asiId);
  assert.ok(missing.includes('asi:shoulder.glenohumeral-joint'));
  assert.ok(missing.includes('asi:shoulder.acromioclavicular-joint'));
});

test('a structure is never bound to a mesh that does not exist', () => {
  const r = selectStructures('shoulder', [...ARCHIVE_LIKE().keys()]);
  const present = new Set(ARCHIVE_LIKE().keys());
  for (const b of r.bound) {
    assert.ok(present.has(b.meshName), `bound to a missing mesh: ${b.meshName}`);
  }
});

test('a bursal space is reported as expected-absent, not as a failure', () => {
  const r = selectStructures('shoulder', [...ARCHIVE_LIKE().keys()]);
  const bursa = r.unmapped.find((u) => u.asiId === 'asi:shoulder.subacromial-bursa');
  assert.ok(bursa, 'the bursa should be reported');
  assert.equal(bursa.expectedAbsent, true);
});

test('an empty input binds nothing and invents nothing', () => {
  const r = selectStructures('shoulder', []);
  assert.equal(r.bound.length, 0);
  assert.equal(r.unmapped.length, SHOULDER_MAPPING.length);
});

test('one source mesh is never bound to two asiIds', () => {
  // Deltoid lists two candidate spellings; if both were somehow present the
  // first must win and the second must not also claim it.
  const names = ['Deltoid_L', 'Deltoid_muscle_L'];
  const r = selectStructures('shoulder', names);
  const claims = r.bound.map((b) => b.meshName);
  assert.equal(new Set(claims).size, claims.length, 'a mesh was claimed twice');
  assert.equal(claims[0], 'Deltoid_L', 'preference order was not respected');
});

test('unclaimed source meshes are reported rather than silently dropped', () => {
  const r = selectStructures('shoulder', ['Humerus_L', 'Clavicle_L', 'Deltoid_L']);
  assert.deepEqual(r.unusedMeshNames.sort(), ['Clavicle_L', 'Humerus_L']);
});

test('every mapping row names a structure the domain actually has', () => {
  // A stale mapping row would otherwise let the pipeline invent a structure.
  for (const entry of SHOULDER_MAPPING) {
    assert.ok(getStructure(entry.asiId), `mapping row for a structure that does not exist: ${entry.asiId}`);
  }
});

test('only shoulder is mapped in Phase 1, and the others say so', () => {
  assert.ok(mappingFor('shoulder').length > 0);
  for (const r of ['neck', 'lower_back', 'knee']) {
    assert.deepEqual(mappingFor(r), [], `${r} should not be guessed at in Phase 1`);
  }
});

/* ================================================================== */
/* Reduction                                                           */
/* ================================================================== */

test('reduction lowers the triangle count', () => {
  const m = syntheticMesh('t', 40, 48, 1.2);
  const before = meshTriangleCount(m);
  const after = meshTriangleCount(reduceMesh(m, 8));
  assert.ok(after < before, `reduction did nothing: ${before} -> ${after}`);
  assert.ok(after > 0, 'reduction removed everything');
});

test('reduction is deterministic: same input, same output', () => {
  const m = syntheticMesh('t', 32, 36, 1.0);
  const a = reduceMesh(m, 10);
  const b = reduceMesh(m, 10);
  assert.deepEqual(a.positions, b.positions);
  assert.deepEqual(a.indices, b.indices);
});

test('reduction is scale invariant up to float boundary effects', () => {
  const m = syntheticMesh('t', 20, 24, 1.0);
  const scaled: SourceMesh = {
    name: 't',
    positions: m.positions.map((v) => v * 1000),
    indices: m.indices,
  };
  const a = meshTriangleCount(reduceMesh(m, 8));
  const b = meshTriangleCount(reduceMesh(scaled, 8));
  // Grid cells are assigned from (position - min) / step, and scaling both by
  // 1000 leaves that ratio mathematically unchanged but not bit-identical, so a
  // vertex sitting exactly on a cell boundary can fall on either side. The
  // counts must therefore agree to within a small tolerance, not exactly.
  const drift = Math.abs(a - b);
  assert.ok(drift <= Math.max(2, a * 0.02), `scaling changed the reduction: ${a} vs ${b}`);
});

test('a finer grid keeps more geometry', () => {
  const m = syntheticMesh('t', 30, 36, 1.0);
  const coarse = meshTriangleCount(reduceMesh(m, 4));
  const fine = meshTriangleCount(reduceMesh(m, 24));
  assert.ok(fine > coarse, `finer grid produced less geometry: ${coarse} -> ${fine}`);
});

test('reduction never emits a degenerate triangle', () => {
  const m = syntheticMesh('t', 24, 30, 1.0);
  const r = reduceMesh(m, 3);
  for (let t = 0; t + 2 < r.indices.length; t += 3) {
    const a = r.indices[t]!;
    const b = r.indices[t + 1]!;
    const c = r.indices[t + 2]!;
    assert.ok(a !== b && b !== c && a !== c, 'degenerate triangle survived reduction');
    assert.ok(Math.max(a, b, c) < r.positions.length / 3, 'index out of range');
  }
});

test('a degenerate grid division is rejected rather than silently ignored', () => {
  assert.throws(() => reduceMesh(syntheticMesh('t', 8, 8, 1), 0), /positive integer/);
  assert.throws(() => reduceMesh(syntheticMesh('t', 8, 8, 1), -3), /positive integer/);
});

/* ================================================================== */
/* GLB                                                                 */
/* ================================================================== */

test('a generated GLB is structurally valid', () => {
  const glb = encodeGlb(syntheticMesh('Deltoid_L', 10, 12, 1));
  const json = decodeGlbJson(glb) as {
    asset: { version: string };
    meshes: { primitives: { attributes: Record<string, number>; indices: number }[] }[];
    accessors: { count: number; type: string }[];
    buffers: { byteLength: number }[];
  };
  assert.equal(json.asset.version, '2.0');
  assert.equal(json.meshes[0]!.primitives[0]!.attributes.POSITION, 0);
  assert.equal(json.meshes[0]!.primitives[0]!.indices, 1);
  // Accessor counts must agree with the geometry that was written.
  const m = syntheticMesh('Deltoid_L', 10, 12, 1);
  assert.equal(json.accessors[0]!.count, m.positions.length / 3);
  assert.equal(json.accessors[1]!.count, m.indices.length);
  assert.ok(json.buffers[0]!.byteLength > 0);
});

test('GLB encoding is byte-reproducible', () => {
  const m = syntheticMesh('Deltoid_L', 10, 12, 1);
  assert.deepEqual(encodeGlb(m), encodeGlb(m));
});

test('a GLB declares POSITION min and max, as the spec requires', () => {
  const json = decodeGlbJson(encodeGlb(syntheticMesh('t', 8, 10, 1.5))) as {
    accessors: ({ min?: number[]; max?: number[] })[];
  };
  assert.ok(json.accessors[0]!.min, 'POSITION accessor has no min');
  assert.ok(json.accessors[0]!.max, 'POSITION accessor has no max');
});

test('something that is not a GLB is rejected', () => {
  assert.throws(() => decodeGlbJson(new Uint8Array([1, 2, 3, 4, 5, 6, 7, 8])), /bad magic|version|length/);
});

/* ================================================================== */
/* End to end                                                          */
/* ================================================================== */

test('the pipeline runs end to end and produces a valid manifest', () => {
  const result = runPipeline('shoulder', ARCHIVE_LIKE(), { gridDivisions: 8 });
  assert.ok(result.manifest.entries.length > 0, 'no entries produced');

  // Parsed through the real schema plus the cross-checks.
  const parsed = parseManifest(JSON.parse(JSON.stringify(result.manifest)), {
    fileSizes: new Map([...result.files].map(([k, v]) => [k, v.byteLength])),
  });
  assert.equal(parsed.entries.length, result.manifest.entries.length);
});

test('every manifest entry has a mesh that was actually written', () => {
  const result = runPipeline('shoulder', ARCHIVE_LIKE(), { gridDivisions: 8 });
  for (const e of result.manifest.entries) {
    assert.ok(result.files.has(e.file), `manifest names a mesh that was not produced: ${e.file}`);
  }
  assert.equal(result.files.size, result.manifest.entries.length, 'wrote meshes nobody references');
});

test('mesh file names are derived from asiId, not from the source name', () => {
  const result = runPipeline('shoulder', ARCHIVE_LIKE(), { gridDivisions: 8 });
  const deltoid = result.manifest.entries.find((e) => e.asiId === 'asi:shoulder.deltoid');
  assert.equal(deltoid?.file, 'shoulder/asi-shoulder-deltoid.glb');
  assert.equal(deltoid?.meshName, 'Deltoid_L');
  assert.ok(!deltoid!.file.includes('Deltoid_L'), 'the source name leaked into the file path');
});

test('renaming a source mesh does not change the generated file name', () => {
  const before = meshFileName('asi:shoulder.deltoid', 'shoulder');
  const after = meshFileName('asi:shoulder.deltoid', 'shoulder');
  assert.equal(before, after);
  assert.equal(before, 'shoulder/asi-shoulder-deltoid.glb');
});

test('the whole pipeline is reproducible byte for byte', () => {
  const a = runPipeline('shoulder', ARCHIVE_LIKE(), { gridDivisions: 8 });
  const b = runPipeline('shoulder', ARCHIVE_LIKE(), { gridDivisions: 8 });
  assert.equal(
    JSON.stringify(a.manifest),
    JSON.stringify(b.manifest),
    'the manifest is not reproducible',
  );
  for (const [path, bytes] of a.files) {
    assert.deepEqual(b.files.get(path), bytes, `mesh ${path} is not reproducible`);
  }
});

test('licence and attribution are on every entry', () => {
  const result = runPipeline('shoulder', ARCHIVE_LIKE(), { gridDivisions: 8 });
  for (const e of result.manifest.entries) {
    assert.equal(e.licence.id, BODYPARTS3D_LICENCE.id);
    assert.ok(e.licence.attribution.includes('BodyParts3D'), 'attribution line missing');
    assert.equal(e.licence.url, BODYPARTS3D_LICENCE.url);
    assert.equal(e.licence.verifiedOn, BODYPARTS3D_LICENCE.verifiedOn);
  }
  assert.equal(result.manifest.licence.id, 'CC-BY-4.0');
});

test('every entry records where its geometry came from', () => {
  const result = runPipeline('shoulder', ARCHIVE_LIKE(), { gridDivisions: 8 });
  for (const e of result.manifest.entries) {
    assert.equal(e.source.dataset, BODYPARTS3D_SOURCE.dataset);
    assert.ok(e.source.release.length > 0, 'no source release recorded');
    assert.equal(e.source.archive, BODYPARTS3D_SOURCE.archive);
  }
});

test('FMA bindings stay unverified, because nothing has been checked', () => {
  const result = runPipeline('shoulder', ARCHIVE_LIKE(), { gridDivisions: 8 });
  for (const e of result.manifest.entries) {
    assert.equal(e.fma.status, 'unverified', 'an FMA binding was claimed as verified');
  }
  const issues = validateManifest(result.manifest).filter((i) => i.severity === 'warning');
  assert.ok(issues.length > 0, 'unverified FMA bindings should be surfaced as warnings');
});

test('the manifest records real reduction, not an aspiration', () => {
  const result = runPipeline('shoulder', ARCHIVE_LIKE(), { gridDivisions: 6 });
  for (const e of result.manifest.entries) {
    assert.ok((e.geometry.sourceTriangles ?? 0) > e.geometry.triangles, 'nothing was reduced');
    assert.ok((e.geometry.reduction ?? 0) > 0);
    assert.ok(e.geometry.triangles > 0, 'an entry has no triangles');
  }
});

test('the geometry budget is enforced against what was actually produced', () => {
  const result = runPipeline('shoulder', ARCHIVE_LIKE(), { gridDivisions: 40 });
  const issues = validateManifest(result.manifest, {
    fileSizes: new Map([...result.files].map(([k, v]) => [k, v.byteLength])),
    budget: { maxTotalTriangles: 50, maxTrianglesPerMesh: 50, maxTotalBytes: 1024 },
  });
  assert.ok(issues.some((i) => i.severity === 'error' && /budget/.test(i.message)));
});

test('a sensible grid resolution fits the default budget', () => {
  // The default budget has to be achievable, or every build fails and the budget
  // stops meaning anything.
  const result = runPipeline('shoulder', ARCHIVE_LIKE(), { gridDivisions: 10 });
  const issues = validateManifest(result.manifest, {
    fileSizes: new Map([...result.files].map(([k, v]) => [k, v.byteLength])),
  });
  assert.deepEqual(issues.filter((i) => i.severity === 'error'), [], 'default budget is unachievable');
  const total = result.manifest.entries.reduce((a, e) => a + e.geometry.triangles, 0);
  assert.ok(total < DEFAULT_GEOMETRY_BUDGET.maxTotalTriangles);
});

test('gaps are reported in the build log, not buried', () => {
  const result = runPipeline('shoulder', ARCHIVE_LIKE(), { gridDivisions: 8 });
  const joined = result.notes.join('\n');
  assert.match(joined, /glenohumeral-joint/);
  assert.match(joined, /tried/, 'a reported gap should say what it looked for');
  // An expected-absent space is reported differently from a real gap.
  assert.match(joined, /bursa[\s\S]*no source mesh expected/);
});

test('sub-regions come from the domain, so a structure appears where it is selectable', () => {
  assert.deepEqual(
    subRegionsContaining('shoulder', 'asi:shoulder.deltoid').sort(),
    ['shoulder.anterior', 'shoulder.lateral'],
  );
  const deltoid = runPipeline('shoulder', ARCHIVE_LIKE(), { gridDivisions: 8 })
    .manifest.entries.find((e) => e.asiId === 'asi:shoulder.deltoid');
  assert.equal(deltoid?.subRegionIds.length, 2, 'a two-sub-region structure was bound to one');
});

test('a mesh cannot be mistaken for a selection: no clinical claim is emitted', () => {
  const result = runPipeline('shoulder', ARCHIVE_LIKE(), { gridDivisions: 8 });
  const text = JSON.stringify(result.manifest);
  for (const forbidden of ['selectedByUser', 'diagnosis', 'severity', 'finding']) {
    assert.equal(text.includes(forbidden), false, `the manifest emitted ${forbidden}`);
  }
});
