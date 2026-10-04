/**
 * Every `data-testid` the GATE SUITES rely on must still exist in the app.
 *
 * A redesign is exactly when a hook quietly disappears — the panel is renamed,
 * the testid moves into a wrapper, the control is replaced by a native element —
 * and the symptom is a gate that fails for a reason that has nothing to do with
 * what it was written to prove. This turns that into a named, cheap check.
 *
 * DYNAMIC HOOKS. Some ids are built from a value, not written literally:
 * `data-testid={`visible-layer-${l}`}` produces `visible-layer-skin`. Reading
 * only the literal ids reported every one of those as MISSING, which is a check
 * that cries wolf and therefore a check nobody runs. So a prefix declared by a
 * template literal counts as covering any id that starts with it — and is
 * printed as its own line, so a broad prefix cannot quietly excuse a typo.
 *
 * Run: node scripts/audit-testhooks.mjs
 */
import { readdirSync, readFileSync, statSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');

function walk(dir, out = []) {
  let entries;
  try {
    entries = readdirSync(dir);
  } catch {
    return out;
  }
  for (const name of entries) {
    const p = join(dir, name);
    if (statSync(p).isDirectory()) walk(p, out);
    else if (/\.(tsx?|mjs)$/.test(p)) out.push(p);
  }
  return out;
}

const APP = new Set();
const DYNAMIC = new Set();
for (const file of walk(join(ROOT, 'apps/web/src'))) {
  const text = readFileSync(file, 'utf8');
  for (const m of text.matchAll(/data-testid=\{?["'`]([^"'`}]+)/g)) {
    if (m[1].includes('${')) DYNAMIC.add(m[1].split('${')[0]);
    else APP.add(m[1]);
  }
}

const used = new Map();
for (const file of [...walk(join(ROOT, 'apps/web/test')), ...walk(join(ROOT, 'scripts'))]) {
  const text = readFileSync(file, 'utf8');
  for (const m of text.matchAll(/data-testid=\{?["'`]([^"'`]+)/g)) {
    if (m[1].includes('${')) continue;
    if (!used.has(m[1])) used.set(m[1], new Set());
    used.get(m[1]).add(file.slice(ROOT.length + 1));
  }
}

const coveredBy = (hook) => {
  if (APP.has(hook)) return 'literal';
  for (const prefix of DYNAMIC) {
    if (hook.startsWith(prefix)) return `prefix ${prefix}\`…`;
  }
  return null;
};

let missing = 0;
const width = Math.max(24, ...[...used.keys()].map((k) => k.length));
console.log(`hook${' '.repeat(width - 4)}  status    covered by`);
for (const [hook, files] of [...used].sort()) {
  const how = coveredBy(hook);
  if (!how) missing += 1;
  const where = how ?? [...files].join(', ');
  console.log(`${hook.padEnd(width)}  ${(how ? 'present' : 'MISSING').padEnd(9)} ${where}`);
}
console.log();
console.log(`app: ${APP.size} literal hooks, ${DYNAMIC.size} generated prefixes`);
for (const p of [...DYNAMIC].sort()) console.log(`  generated: ${p}\`…\``);
console.log();
console.log(missing === 0 ? 'all gate hooks present' : `${missing} GATE HOOK(S) MISSING`);
process.exit(missing === 0 ? 0 : 1);