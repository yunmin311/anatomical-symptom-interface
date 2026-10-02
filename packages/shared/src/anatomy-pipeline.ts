/**
 * Anatomy conversion pipeline.
 *
 * BodyParts3D source -> select the V1 region's structures -> bind them to `asiId`
 * -> reduce geometry -> emit GLB -> emit the manifest with licence metadata.
 *
 * Everything in this file is PURE. It takes meshes in and returns bytes and a
 * manifest out. Reading the archive and writing files is the CLI's job
 * (`scripts/build-anatomy.mjs`), which keeps this testable without a download and
 * keeps the domain package free of I/O.
 *
 * TWO THINGS THIS WILL NOT DO.
 *
 * It will not invent anatomy. If a structure has no mesh in the input it is
 * reported as unmapped and left out of the manifest. A wrong binding is worse
 * than a missing one: a mesh bound to the wrong `asiId` renders as a structure
 * the user never pointed at, and the record would then claim they did.
 *
 * It will not take a source id as an identity. `asiId` comes from our own
 * anatomy.ts and the source `meshName` travels as provenance, so an upstream
 * rename cannot repoint a user's saved visual selection.
 *
 * The reducer is vertex clustering rather than a quadric-error simplifier. That
 * is a deliberate trade: this geometry is a hit-target system for a schematic
 * body, not a thing anyone inspects for surface fidelity, and clustering needs no
 * native dependency, is exactly reproducible, and cannot fail to converge. A
 * production-quality simplifier is a later question, and swapping it must not
 * change the manifest shape.
 */
import { REGIONS, getStructure } from './anatomy.ts';
import type { BodyRegion } from './anatomy.ts';
import {
  BODYPARTS3D_LICENCE,
  BODYPARTS3D_SOURCE,
  BODYPARTS3D_UNITS,
  PIPELINE_SIDES,
  UNMAPPABLE,
  mappingFor,
} from './anatomy-mapping.ts';
import type {
  MappingEntry,
  PipelineSide,
  SourceCandidate,
  SourceSide,
} from './anatomy-mapping.ts';
import type { AssetManifest, AssetManifestEntry } from './anatomy-manifest.ts';

/* ------------------------------------------------------------------ */
/* Geometry                                                            */
/* ------------------------------------------------------------------ */

/** A triangle mesh: flat xyz positions and flat 0-based index triples. */
export interface SourceMesh {
  name: string;
  positions: number[];
  indices: number[];
}

export function meshTriangleCount(m: SourceMesh): number {
  return Math.floor(m.indices.length / 3);
}

export function meshBounds(m: SourceMesh): { min: [number, number, number]; max: [number, number, number] } {
  if (m.positions.length === 0) return { min: [0, 0, 0], max: [0, 0, 0] };
  const min: [number, number, number] = [Infinity, Infinity, Infinity];
  const max: [number, number, number] = [-Infinity, -Infinity, -Infinity];
  for (let i = 0; i < m.positions.length; i += 3) {
    for (let a = 0; a < 3; a++) {
      const v = m.positions[i + a]!;
      if (v < min[a]!) min[a] = v;
      if (v > max[a]!) max[a] = v;
    }
  }
  return { min, max };
}

/**
 * Reduce a mesh by snapping vertices onto a grid and collapsing each cell to one
 * vertex, the mean of its members.
 *
 * Deterministic by construction: a vertex's cell depends only on its position,
 * a cell's representative is the mean of members added in first-seen order, and
 * degenerate triangles are dropped in place rather than reordered. Running the
 * pipeline twice over the same input produces identical bytes, which is what
 * makes a generated manifest reviewable in a diff.
 *
 * `gridDivisions` is the target resolution along the longest axis. Higher means
 * fewer vertices and fewer triangles.
 */
export function reduceMesh(mesh: SourceMesh, gridDivisions: number): SourceMesh {
  if (!Number.isInteger(gridDivisions) || gridDivisions < 1) {
    throw new Error(`gridDivisions must be a positive integer, got ${String(gridDivisions)}`);
  }
  const vertexCount = Math.floor(mesh.positions.length / 3);
  if (vertexCount === 0 || mesh.indices.length === 0) return mesh;

  // Bounds set the cell size so reduction is scale-invariant: the same shape in
  // millimetres and in metres reduces to the same result.
  const { min, max } = meshBounds(mesh);
  const extent = Math.max(max[0] - min[0], max[1] - min[1], max[2] - min[2], 1e-6);
  const step = extent / gridDivisions;

  const cellIndex = new Map<string, number>();
  const accum: number[][] = [];
  const counts: number[] = [];
  const remap = new Int32Array(vertexCount);

  for (let v = 0; v < vertexCount; v++) {
    const x = Math.floor((mesh.positions[v * 3]! - min[0]) / step);
    const y = Math.floor((mesh.positions[v * 3 + 1]! - min[1]) / step);
    const z = Math.floor((mesh.positions[v * 3 + 2]! - min[2]) / step);
    const key = `${x},${y},${z}`;
    let idx = cellIndex.get(key);
    if (idx === undefined) {
      idx = accum.length;
      cellIndex.set(key, idx);
      accum.push([0, 0, 0]);
      counts.push(0);
    }
    // Read the accumulator into a local so noUncheckedIndexedAccess is satisfied
    // without a non-null assertion on every component.
    const cell = accum[idx]!;
    cell[0] = cell[0]! + mesh.positions[v * 3]!;
    cell[1] = cell[1]! + mesh.positions[v * 3 + 1]!;
    cell[2] = cell[2]! + mesh.positions[v * 3 + 2]!;
    counts[idx] = counts[idx]! + 1;
    remap[v] = idx;
  }

  const positions: number[] = [];
  for (let c = 0; c < accum.length; c++) {
    const n = counts[c]!;
    positions.push(accum[c]![0]! / n, accum[c]![1]! / n, accum[c]![2]! / n);
  }

  // First-seen order, degenerates dropped: the output is a function of the input
  // rather than of hash iteration order.
  const indices: number[] = [];
  let previous = -1;
  for (let t = 0; t + 2 < mesh.indices.length; t += 3) {
    const a = remap[mesh.indices[t]!]!;
    const b = remap[mesh.indices[t + 1]!]!;
    const c = remap[mesh.indices[t + 2]!]!;
    if (a === b || b === c || a === c) continue;
    if (a === previous && b === previous && c === previous) continue;
    previous = c;
    indices.push(a, b, c);
  }

  return { name: mesh.name, positions, indices };
}

/* ------------------------------------------------------------------ */
/* GLB encoding                                                        */
/* ------------------------------------------------------------------ */

const GLB_MAGIC = 0x46546c67; // 'glTF'
const CHUNK_JSON = 0x4e4f534a; // 'JSON'
const CHUNK_BIN = 0x004e4942; // 'BIN\0'

const align4 = (n: number): number => (n + 3) & ~3;

/** Read the JSON chunk back out of a GLB. Used by the tests to prove validity. */
export function decodeGlbJson(bytes: Uint8Array): Record<string, unknown> {
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  if (view.getUint32(0, true) !== GLB_MAGIC) throw new Error('not a GLB: bad magic');
  if (view.getUint32(4, true) !== 2) throw new Error('not a GLB: version is not 2');
  const total = view.getUint32(8, true);
  if (total !== bytes.byteLength) throw new Error(`GLB length ${total} != buffer ${bytes.byteLength}`);
  const jsonLength = view.getUint32(12, true);
  const jsonType = view.getUint32(16, true);
  if (jsonType !== CHUNK_JSON) throw new Error('first chunk is not JSON');
  const json = new TextDecoder().decode(bytes.subarray(20, 20 + jsonLength));
  return JSON.parse(json) as Record<string, unknown>;
}

/**
 * Encode one mesh as binary glTF 2.0.
 *
 * Minimal but real: one node, one mesh, one primitive with POSITION and indices,
 * one material. Normals are deliberately omitted -- this is a schematic
 * hit-target body, and shipping smooth normals computed from a clustered mesh
 * would imply a surface fidelity the geometry does not have.
 *
 * Hand-written rather than via a library so the pipeline carries no dependency
 * and the output is byte-reproducible.
 */
export function encodeGlb(mesh: SourceMesh): Uint8Array {
  const positions = Float32Array.from(mesh.positions);
  const indices = Uint32Array.from(mesh.indices);
  const { min, max } = meshBounds(mesh);

  const posBytes = new Uint8Array(positions.buffer, positions.byteOffset, positions.byteLength);
  const idxBytes = new Uint8Array(indices.buffer, indices.byteOffset, indices.byteLength);
  const binLength = posBytes.length + idxBytes.length;
  const binPadded = align4(binLength);

  const gltf = {
    asset: { version: '2.0', generator: 'asi-anatomy-pipeline' },
    scene: 0,
    scenes: [{ nodes: [0] }],
    nodes: [{ mesh: 0, name: mesh.name }],
    meshes: [{
      name: mesh.name,
      primitives: [{ attributes: { POSITION: 0 }, indices: 1, material: 0, mode: 4 }],
    }],
    materials: [{
      name: `${mesh.name}-material`,
      pbrMetallicRoughness: {
        baseColorFactor: [0.78, 0.74, 0.72, 1.0],
        metallicFactor: 0,
        roughnessFactor: 0.85,
      },
      doubleSided: true,
    }],
    accessors: [
      {
        bufferView: 0,
        componentType: 5126, // FLOAT
        count: positions.length / 3,
        type: 'VEC3',
        min: [min[0], min[1], min[2]],
        max: [max[0], max[1], max[2]],
      },
      { bufferView: 1, componentType: 5125, count: indices.length, type: 'SCALAR' },
    ],
    bufferViews: [
      { buffer: 0, byteOffset: 0, byteLength: posBytes.length, target: 34962 },
      { buffer: 0, byteOffset: posBytes.length, byteLength: idxBytes.length, target: 34963 },
    ],
    buffers: [{ byteLength: binPadded }],
  };

  const jsonBytes = new TextEncoder().encode(JSON.stringify(gltf));
  const jsonPadded = align4(jsonBytes.length);
  const jsonPad = new Uint8Array(jsonPadded - jsonBytes.length).fill(0x20); // spec: pad JSON with spaces

  const total = 12 + 8 + jsonPadded + 8 + binPadded;
  const out = new Uint8Array(total);
  const view = new DataView(out.buffer);
  let o = 0;

  view.setUint32(o, GLB_MAGIC, true); o += 4;
  view.setUint32(o, 2, true); o += 4;
  view.setUint32(o, total, true); o += 4;

  view.setUint32(o, jsonPadded, true); o += 4;
  view.setUint32(o, CHUNK_JSON, true); o += 4;
  out.set(jsonBytes, o); o += jsonBytes.length;
  out.set(jsonPad, o); o += jsonPad.length;

  view.setUint32(o, binPadded, true); o += 4;
  view.setUint32(o, CHUNK_BIN, true); o += 4;
  out.set(posBytes, o); o += posBytes.length;
  out.set(idxBytes, o); o += idxBytes.length;

  return out;
}

/* ------------------------------------------------------------------ */
/* Selection and binding                                               */
/* ------------------------------------------------------------------ */

export interface Binding {
  asiId: string;
  meshName: string;
  fmaConceptId: string | null;
  /**
   * The side of THIS mesh, read from the source concept name.
   *
   * On the binding rather than only on the manifest, because it is what tells a
   * human which of the source's two files was chosen, and a binding whose side is
   * unrecorded cannot be audited.
   */
  side: SourceSide;
  /** The source's English concept name, for auditing a binding. */
  sourceLabel: string | null;
}

export interface Unmapped {
  asiId: string;
  /** Candidate names that were looked for, so the gap is actionable. */
  tried: string[];
  expectedAbsent: boolean;
}

export interface SelectionResult {
  bound: Binding[];
  unmapped: Unmapped[];
  /** Source meshes present in the input that no structure claimed. */
  unusedMeshNames: string[];
}

/**
 * Bind a region's structures to meshes that actually exist in the input.
 *
 * Candidate order is preference order, first match wins. Two structures never
 * bind the same mesh: a mesh already claimed is not reused, because binding one
 * source mesh to two `asiId`s would make a visual selection ambiguous.
 *
 * `side` selects which of the source's sides this build represents, because one
 * `asiId` is one structure and BodyParts3D carries two files for it. Passing no side
 * means \"any\", which is only safe when a caller genuinely does not care — the CLI
 * always passes one.
 */
export function selectStructures(
  region: BodyRegion,
  availableMeshNames: readonly string[],
  side?: SourceSide,
): SelectionResult {
  const mapping: readonly MappingEntry[] = mappingFor(region);
  const present = new Set(availableMeshNames);
  const claimed = new Set<string>();
  const bound: Binding[] = [];
  const unmapped: Unmapped[] = [];

  for (const entry of mapping) {
    // The structure must exist in our own domain. A mapping row naming a
    // structure that has since been renamed in anatomy.ts is a stale row, not a
    // new structure, and must not create one.
    if (!getStructure(entry.asiId)) {
      unmapped.push({
        asiId: entry.asiId,
        tried: entry.candidates.map((c: SourceCandidate) => c.meshName),
        expectedAbsent: false,
      });
      continue;
    }

    const usable = side
      ? entry.candidates.filter((c) => c.side === side)
      : entry.candidates;
    const hit = usable.find((c) => present.has(c.meshName) && !claimed.has(c.meshName));
    if (hit) {
      claimed.add(hit.meshName);
      bound.push({
        asiId: entry.asiId,
        meshName: hit.meshName,
        fmaConceptId: hit.fmaConceptId,
        side: hit.side,
        sourceLabel: hit.sourceLabel,
      });
    } else {
      unmapped.push({
        asiId: entry.asiId,
        tried: entry.candidates.map((c) => c.meshName),
        expectedAbsent: entry.expectAbsent === true,
      });
    }
  }

  return {
    bound,
    unmapped,
    unusedMeshNames: availableMeshNames.filter((n) => !claimed.has(n)),
  };
}

/* ------------------------------------------------------------------ */
/* Manifest generation                                                 */
/* ------------------------------------------------------------------ */

/** `asi:shoulder.supraspinatus-tendon` in region `shoulder` -> `shoulder/asi-shoulder-supraspinatus-tendon.glb` */
export function meshFileName(asiId: string, region: BodyRegion): string {
  const slug = asiId.replace(/^asi:/, '').replace(/[^a-z0-9]+/gi, '-').replace(/^-+|-+$/g, '');
  return `${region}/asi-${slug}.glb`;
}

/**
 * Why a structure has no mesh, when we know.
 *
 * A build log that says only \"no source mesh expected\" leaves a reader unable to
 * tell a deliberate decision from an unfinished mapping. The reason comes from the
 * mapping, so the two cannot drift.
 */
export function unmappableReason(asiId: string): string | null {
  return UNMAPPABLE.find((u) => u.asiId === asiId)?.reason ?? null;
}

/** Sub-regions of `region` that offer `asiId`. Read from the domain, not the source. */
export function subRegionsContaining(region: BodyRegion, asiId: string): string[] {
  return REGIONS[region].subRegions
    .filter((s) => s.structures.some((st) => st.id === asiId))
    .map((s) => s.id);
}

export interface PipelineOptions {
  /** Target vertex-grid resolution per mesh. Higher means smaller output. */
  gridDivisions: number;
  /**
   * Which side this build represents, from `PIPELINE_SIDES`.
   *
   * Required rather than defaulted. It used to default to `'left'`, which meant a
   * build that bound a RIGHT mesh still wrote `laterality: 'left'` into the
   * manifest — the record would then claim a side the geometry does not have, and
   * nothing downstream would notice. Making it required means the CLI has to state
   * what it built.
   */
  side: PipelineSide;
  /** ISO date the source archive was obtained. */
  retrievedAt?: string;
  /** Archive filename, when it differs from the default. */
  archive?: string;
}

export interface PipelineResult {
  manifest: AssetManifest;
  /** Manifest file path -> GLB bytes. The caller decides where to write them. */
  files: Map<string, Uint8Array>;
  selection: SelectionResult;
  /** Human-readable gaps, for the build log. Not manifest errors. */
  notes: string[];
}

/**
 * Run the whole pipeline for one region over the meshes actually present.
 *
 * `meshes` is keyed by source mesh name, which is what the caller read out of the
 * archive. Nothing is assumed about names beyond the mapping table, so a
 * differently-spelled upstream release produces reported gaps rather than wrong
 * bindings.
 */
export function runPipeline(
  region: BodyRegion,
  meshes: ReadonlyMap<string, SourceMesh>,
  options: PipelineOptions,
): PipelineResult {
  const notes: string[] = [];

  if (!PIPELINE_SIDES.includes(options.side))
    throw new Error(
      `pipeline side must be one of ${PIPELINE_SIDES.join(', ')}, got ${String(options.side)}`,
    );

  // The side matters for BINDING and for the manifest's `laterality`, so it goes
  // into selection rather than being applied afterwards -- filtering after the fact
  // would already have let the wrong side's file be chosen.
  const selection = selectStructures(region, [...meshes.keys()], options.side);

  for (const u of selection.unmapped) {
    notes.push(
      u.expectedAbsent
        ? `${u.asiId}: no source mesh expected -- ${unmappableReason(u.asiId) ?? 'no counterpart in the source dataset'}`
        : `${u.asiId}: no source mesh found; tried ${u.tried.join(', ')}`,
    );
  }

  const entries: AssetManifestEntry[] = [];
  const files = new Map<string, Uint8Array>();

  for (const b of selection.bound) {
    const source = meshes.get(b.meshName);
    if (!source) continue;
    const structure = getStructure(b.asiId);
    if (!structure) continue;

    const sourceTriangles = meshTriangleCount(source);
    const reduced = reduceMesh(source, options.gridDivisions);
    const file = meshFileName(b.asiId, region);
    files.set(file, encodeGlb(reduced));
    const triangles = meshTriangleCount(reduced);

    entries.push({
      asiId: b.asiId,
      meshName: b.meshName,
      region,
      subRegionIds: subRegionsContaining(region, b.asiId),
      layer: structure.layer,
      anatomicalLabel: structure.label,
      layTerm: structure.layTerm ?? null,
      // The side of the mesh that was actually loaded, not an assumption about the
      // build: this is read off the source concept the binding recorded.
      laterality: b.side,
      fma: {
        conceptId: b.fmaConceptId,
        // Nothing here has been checked against FMA Explorer. It stays
        // 'unverified' until a human verifies it, which is the same rule the
        // domain's CodingSchema follows.
        status: 'unverified',
        note: `BodyParts3D ${BODYPARTS3D_SOURCE.conceptRelease} concept list; not yet checked against FMA Explorer`,
      },
      source: {
        dataset: BODYPARTS3D_SOURCE.dataset,
        release: BODYPARTS3D_SOURCE.release,
        conceptId: b.fmaConceptId ? `FMA:${b.fmaConceptId}` : null,
        archive: options.archive ?? BODYPARTS3D_SOURCE.archive,
        doi: BODYPARTS3D_SOURCE.doi,
        retrievedAt: options.retrievedAt ?? null,
      },
      licence: { ...BODYPARTS3D_LICENCE },
      geometry: {
        triangles,
        sourceTriangles,
        reduction: sourceTriangles > 0 ? Number((1 - triangles / sourceTriangles).toFixed(4)) : null,
        // MILLIMETRES, from a measurement of the archive rather than from how the
        // numbers look.
        //
        // The archive carries no unit field and its README never states one, so
        // `unitless` was honest and unhelpful at the same time. What settles it is
        // extent: across all 2234 source meshes the body spans 1729.74 units
        // vertically, and BodyParts3D is documented as an adult human male model.
        // 1729.74 units reads as 1.73 m if the unit is the millimetre; the same
        // number would be a 17.3 m or 1730 m figure for cm or m, which is not a
        // human being. Recorded as a constant with that reasoning attached, because
        // the claim has to stay auditable and the next person to touch this should
        // be able to check it rather than trust it.
        units: BODYPARTS3D_UNITS,
      },
      bounds: meshBounds(reduced),
      file,
    });
  }

  const manifest: AssetManifest = {
    schemaVersion: 1,
    regions: [region],
    licence: { ...BODYPARTS3D_LICENCE },
    generator: { name: 'asi-anatomy-pipeline', version: '1.0.0' },
    entries,
  };

  return { manifest, files, selection, notes };
}
