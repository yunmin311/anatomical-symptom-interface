import { readFileSync } from 'node:fs';

const p = 'E:/1project/asi-atlas-v2/apps/web/public/anatomy/atlas/shoulder/right/shoulder-atlas.glb';
const buf = readFileSync(p);
if (buf.subarray(0, 4).toString() !== 'glTF') {
  console.log('not a glb');
  process.exit(1);
}
let off = 12;
let json = null;
while (off < buf.length) {
  const len = buf.readUInt32LE(off);
  const type = buf.subarray(off + 4, off + 8).toString('ascii');
  if (type === 'JSON') json = JSON.parse(buf.subarray(off + 8, off + 8 + len).toString('utf8'));
  off += 8 + len + ((4 - (len % 4)) % 4);
  if (type === 'JSON' && json) break;
}

const nodes = json.nodes ?? [];
console.log(`nodes: ${nodes.length}`);
console.log(`meshes: ${(json.meshes ?? []).length}`);
console.log(`materials: ${(json.materials ?? []).length}`);
console.log('first 8 node names:');
for (const n of nodes.slice(0, 8)) console.log(`   ${JSON.stringify(n.name)}  children=${(n.children ?? []).length}`);

const withColon = nodes.filter((n) => (n.name ?? '').includes(':')).length;
const bp = nodes.filter((n) => (n.name ?? '').startsWith('bp3d')).length;
const fj = nodes.filter((n) => /^FJ\d+M?$/.test(n.name ?? '')).length;
console.log(`names containing ':'   ${withColon}`);
console.log(`names starting bp3d    ${bp}`);
console.log(`bare FJ#### names      ${fj}`);
console.log('sample of any name containing bp3d or FJ:');
for (const n of nodes.filter((n) => /bp3d|^FJ\d/.test(n.name ?? '')).slice(0, 6)) {
  console.log(`   ${JSON.stringify(n.name)}`);
}
// nesting: a node whose name has no colon but whose child chain does
const parents = nodes.filter((n) => (n.children ?? []).length > 0).length;
console.log(`nodes with children (nested): ${parents}`);