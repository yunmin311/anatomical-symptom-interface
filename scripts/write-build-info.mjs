/**
 * Stamp the web build with the commit it was built FROM.
 *
 * Run as the last step of `pnpm --filter @asi/web build`.
 *
 * ## WHY THIS FILE EXISTS
 *
 * The preview reported its commit from `ASI_BUILD_COMMIT`, which `preview.sh`
 * set from `git rev-parse HEAD` **at start time**. Those are different facts:
 *
 *   12:00  edit a file, commit            HEAD becomes b89684e
 *   12:05  pnpm preview                   dist is still built from 9ed1f94
 *   12:05  /api/health says commit=b89684e, and is wrong
 *
 * The bundle being served was the old one, and the one thing a preview is asked
 * most often — "which version am I looking at?" — answered confidently and
 * incorrectly. `verify-preview.mjs` did not catch it either, because all it
 * asserted was that `build.commit` was a non-empty string.
 *
 * The fix is to make the build carry its own provenance, so the number on the
 * health endpoint describes the BYTES being served rather than the checkout that
 * happens to be on disk. A build from before this script existed has no stamp,
 * which `start.mjs` reports as `unstamped` instead of inventing a commit — an
 * honest "unknown" beats a confident wrong answer.
 */
import { execFileSync } from 'node:child_process';
import { existsSync, mkdirSync, writeFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const REPO = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const DIST = join(REPO, 'apps', 'web', 'dist');

if (!existsSync(DIST)) {
  console.error(`[build-info] ${DIST} does not exist — was the build run?`);
  process.exit(1);
}

function git(...args) {
  try {
    return execFileSync('git', ['-C', REPO, ...args], {
      encoding: 'utf8',
      stdio: ['ignore', 'pipe', 'pipe'],
    }).trim();
  } catch {
    return null;
  }
}

const commit = git('rev-parse', 'HEAD');
const branch = git('rev-parse', '--abbrev-ref', 'HEAD');
const dirty = (git('status', '--porcelain') ?? '').length > 0;

const info = {
  commit,
  branch,
  dirty,
  builtAt: new Date().toISOString(),
  // Stamped by this script. A preview reading a build-info.json without this
  // field is reading something another tool wrote, and should not trust it.
  stampedBy: 'scripts/write-build-info.mjs',
};

mkdirSync(DIST, { recursive: true });
writeFileSync(join(DIST, 'build-info.json'), JSON.stringify(info, null, 2) + '\n');

console.log(
  `[build-info] dist stamped: ${(commit ?? 'unknown').slice(0, 12)} ` +
    `on ${branch ?? '?'}${dirty ? ' (uncommitted changes present)' : ''}`,
);