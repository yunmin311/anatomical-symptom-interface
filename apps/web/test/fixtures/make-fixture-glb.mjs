/**
 * Builds a tiny, deliberately NON-MEDICAL GLB fixture for the URL geometry path.
 *
 * This is not anatomy and is not derived from any body. It is two flat quads
 * under one Group, which is the minimum that exercises the things a real GLB
 * does that a single primitive does not:
 *
 *   - a Group root with descendant Meshes, so asiId inheritance and raycast
 *     resolution have something to resolve through;
 *   - two separately named nodes, so `nodeName` selection has a real choice;
 *   - a union bounds larger than either child, so camera framing from loaded
 *     geometry can be told apart from framing from hardcoded coordinates.
 *
 * Structure: fixture_root (Group) -> [fixture_lower, fixture_upper]
 *
 * Written by hand rather than exported, so the fixture has no dependency on a
 * browser-only exporter and the bytes are reviewable.
 */

const VEC = [0, 0, 0];

/** Two triangles in the XY plane, unit sized, centred on the origin. */
function quad(halfWidth, halfHeight, z = 0) {
  return [
    -halfWidth, -halfHeight, z,
    halfWidth, -halfHeight, z,
    halfWidth, halfHeight, z,
    -halfWidth, -halfHeight, z,
    halfWidth, halfHeight, z,
    -halfWidth, halfHeight, z,
  ];
}

/** The two quads, in their own local space, before node translation. */
const LOWER = quad(0.5, 0.5, 0);
const UPPER = quad(0.25, 0.25, 0.75);

function boundsOf(values) {
  const min = [Infinity, Infinity, Infinity];
  const max = [-Infinity, -Infinity, -Infinity];
  for (let i = 0; i < values.length; i += 3) {
    for (let axis = 0; axis < 3; axis += 1) {
      min[axis] = Math.min(min[axis], values[i + axis]);
      max[axis] = Math.max(max[axis], values[i + axis]);
    }
  }
  return { min, max };
}

function pad4(n) {
  return (n + 3) & ~3;
}

/** Assemble a valid glTF 2.0 binary (.glb) and return it as an ArrayBuffer. */
export function buildFixtureGlb() {
  const chunks = [];
  for (const values of [LOWER, UPPER]) {
    const buf = new ArrayBuffer(values.length * 4);
    new Float32Array(buf).set(values);
    chunks.push(buf);
  }
  const bin = new Uint8Array(LOWER.length * 4 + UPPER.length * 4);
  bin.set(new Uint8Array(chunks[0]), 0);
  bin.set(new Uint8Array(chunks[1]), LOWER.length * 4);

  const lowerBytes = LOWER.length * 4;
  const json = {
    asset: {
      version: '2.0',
      generator: 'ASI Phase 1A test fixture - NOT anatomy, NOT derived from a body',
    },
    scene: 0,
    scenes: [{ name: 'fixture_scene', nodes: [0] }],
    nodes: [
      // 0: the Group every descendant inherits its asiId from.
      { name: 'fixture_root', children: [1, 2] },
      { name: 'fixture_lower', mesh: 0, translation: [0, 0, 0] },
      { name: 'fixture_upper', mesh: 1, translation: [1.5, 0.75, 0] },
    ],
    meshes: [
      {
        name: 'fixture_lower_mesh',
        primitives: [{ attributes: { POSITION: 0 }, mode: 4 }],
      },
      {
        name: 'fixture_upper_mesh',
        primitives: [{ attributes: { POSITION: 1 }, mode: 4 }],
      },
    ],
    accessors: [
      { bufferView: 0, componentType: 5126, count: 6, type: 'VEC3', ...boundsOf(LOWER) },
      { bufferView: 1, componentType: 5126, count: 6, type: 'VEC3', ...boundsOf(UPPER) },
    ],
    bufferViews: [
      { buffer: 0, byteOffset: 0, byteLength: lowerBytes },
      { buffer: 0, byteOffset: lowerBytes, byteLength: UPPER.length * 4 },
    ],
    buffers: [{ byteLength: bin.length }],
  };
  void VEC;

  const jsonText = JSON.stringify(json);
  const jsonBytes = new TextEncoder().encode(jsonText);
  const jsonPad = pad4(jsonBytes.length);
  const binPad = pad4(bin.length);

  const total = 12 + 8 + jsonPad + 8 + binPad;
  const out = new Uint8Array(total);
  const view = new DataView(out.buffer);

  // header
  out.set(new TextEncoder().encode('glTF'), 0);
  view.setUint32(4, 2, true); // version
  view.setUint32(8, total, true); // total length

  // JSON chunk header: chunkLength first, then chunkType (glTF 2.0 spec order).
  view.setUint32(12, jsonPad, true);
  out.set(new TextEncoder().encode('JSON'), 16);
  out.set(jsonBytes, 20);
  for (let i = 20 + jsonBytes.length; i < 20 + jsonPad; i += 1) out[i] = 0x20; // spaces

  // BIN chunk header, same order.
  const binHeader = 20 + jsonPad;
  view.setUint32(binHeader, binPad, true);
  out.set(new TextEncoder().encode('BIN\0'), binHeader + 4);
  out.set(bin, binHeader + 8);

  return out.buffer;
}

if (process.argv[1] && process.argv[1].endsWith('make-fixture-glb.mjs')) {
  const target = process.argv[2];
  if (!target) {
    console.error('usage: make-fixture-glb.mjs <output.glb>');
    process.exit(2);
  }
  const { writeFileSync, mkdirSync } = await import('node:fs');
  const { dirname } = await import('node:path');
  mkdirSync(dirname(target), { recursive: true });
  const buffer = buildFixtureGlb();
  writeFileSync(target, Buffer.from(buffer));
  console.log(`wrote ${target} (${buffer.byteLength} bytes)`);
}
