/**
 * Is the module the dev server is SERVING the module on disk?
 *
 * Needed because /mnt/e does not emit inotify events: Vite keeps serving a stale
 * transform cache after an edit, so an audit happily screenshots yesterday's
 * build — reporting defects that were already fixed and missing new ones.
 *
 * Bytes cannot answer it. Vite serves esbuild output, not the file, so a hash
 * comparison differs even when nothing is stale. STRING LITERALS do survive the
 * transform, and a stale cache is precisely a module missing the literals an edit
 * just added. So every quoted literal in the source has to be present in what the
 * browser would receive.
 *
 * Three things have to be taken out first, or the check cries wolf and gets
 * ignored:
 *
 *   - COMMENTS. A design decision is argued at length in a comment here, and
 *     esbuild strips comments, so every one of those sentences would read as a
 *     missing literal.
 *   - IMPORT SPECIFIERS. Vite rewrites `../state/session.ts` to a resolved URL.
 *   - QUOTES. `'Left'` in the source is `"Left"` in the output, so literals are
 *     compared by CONTENT, never with their delimiters.
 *
 * The check is one-directional. The transform also ADDS literals — JSX text
 * becomes a string — and those must not read as staleness.
 *
 *   node scripts/audit-freshness.mjs <url> <file-on-disk>
 */
import { readFileSync } from 'node:fs';

const url = process.argv[2];
const file = process.argv[3];
if (!url || !file) {
  console.error('usage: audit-freshness.mjs <served-url> <file-on-disk>');
  process.exit(2);
}

/**
 * Remove comments while respecting string and template literals, so a `//` inside
 * a URL is not mistaken for the start of a comment.
 */
function stripComments(text) {
  let out = '';
  let i = 0;
  let quote = null;
  while (i < text.length) {
    const ch = text[i];
    const next = text[i + 1];
    if (quote) {
      out += ch;
      if (ch === '\\') {
        out += next ?? '';
        i += 2;
        continue;
      }
      if (ch === quote) quote = null;
      i += 1;
      continue;
    }
    if (ch === '"' || ch === "'" || ch === '`') {
      quote = ch;
      out += ch;
      i += 1;
      continue;
    }
    if (ch === '/' && next === '/') {
      while (i < text.length && text[i] !== '\n') i += 1;
      continue;
    }
    if (ch === '/' && next === '*') {
      i += 2;
      while (i < text.length && !(text[i] === '*' && text[i + 1] === '/')) i += 1;
      i += 2;
      continue;
    }
    out += ch;
    i += 1;
  }
  return out;
}

/** Drop the specifier from every import/export so a rewritten path is not a diff. */
function stripImports(text) {
  return text.replace(/((?:^|[\s;])(?:import|export)[\s\S]*?from\s*)["'][^"']*["']/g, '$1""');
}

/** Literal CONTENT, long enough to be worth matching on. */
function literals(text) {
  const found = new Set();
  for (const m of stripImports(stripComments(text)).matchAll(/"([^"\n]{4,})"|'([^'\n]{4,})'/g)) {
    const value = (m[1] ?? m[2] ?? '').trim();
    if (value) found.add(value);
  }
  return [...found].sort();
}

const disk = readFileSync(file, 'utf8');
const served = await (await fetch(url)).text();
const wanted = literals(disk);

if (wanted.length === 0) {
  // An empty needle set is the exact failure this exercise exists to avoid: a
  // check that cannot fail. Say so rather than reporting OK.
  console.error(`freshness: CANNOT CHECK — no string literals found in ${file}`);
  process.exit(1);
}

const missing = wanted.filter((value) => !served.includes(value));
if (missing.length === 0) {
  console.log(
    `freshness: OK — served ${file} carries all ${wanted.length} string literals from disk`,
  );
  process.exit(0);
}

console.error(
  `freshness: STALE — ${file} has ${wanted.length} literals on disk, ` +
    `${wanted.length - missing.length} reach the browser`,
);
for (const value of missing.slice(0, 10)) console.error(`  missing: ${value}`);
process.exit(1);