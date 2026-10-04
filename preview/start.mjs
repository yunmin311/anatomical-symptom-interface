/**
 * Start the whole preview: API, demo seed, then the web+API origin.
 *
 * One command, because a preview that needs three terminals and a specific order is a
 * preview nobody starts. Each stage waits for the previous one to be genuinely ready rather
 * than sleeping a guessed interval -- a fixed sleep is either too slow or flaky, and it
 * fails as a confusing downstream error instead of "the API was not up yet".
 */
import { spawn } from 'node:child_process';
import { mkdirSync, rmSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const HERE = dirname(fileURLToPath(import.meta.url));
const REPO = resolve(HERE, '..');
const SERVER = join(REPO, 'packages', 'server');

const API_PORT = Number(process.env.ASI_API_PORT ?? 8787);
const PREVIEW_PORT = Number(process.env.ASI_PREVIEW_PORT ?? 8080);
const DB_PATH = process.env.ASI_DB_PATH ?? join(REPO, 'preview', '.preview-data', 'preview.sqlite');

// Demo data only, always rebuilt. A preview that accumulates state across runs is a preview
// whose behaviour depends on how many times it was started, and a stale DB could in principle
// carry content from a previous use.
if (process.env.ASI_PREVIEW_KEEP_DATA !== '1') {
  rmSync(dirname(DB_PATH), { recursive: true, force: true });
}
mkdirSync(dirname(DB_PATH), { recursive: true });

const COMMIT = process.env.ASI_BUILD_COMMIT ?? 'unknown';
const children = [];

const shutdown = (code) => {
  for (const child of children) {
    try {
      child.kill('SIGTERM');
    } catch {
      /* already gone */
    }
  }
  process.exit(code);
};
process.on('SIGINT', () => shutdown(0));
process.on('SIGTERM', () => shutdown(0));

/** Poll until `probe` succeeds, or give up with the child's output so the cause is visible. */
async function waitFor(label, probe, child, timeoutMs = 60_000) {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    if (child.exitCode !== null) {
      throw new Error(`${label} exited with code ${child.exitCode} before becoming ready`);
    }
    try {
      if (await probe()) return;
    } catch {
      /* not up yet */
    }
    await new Promise((r) => setTimeout(r, 250));
  }
  throw new Error(`${label} did not become ready within ${timeoutMs / 1000}s`);
}

function run(label, args, extraEnv = {}) {
  const child = spawn(process.execPath, args, {
    cwd: SERVER,
    stdio: ['ignore', 'pipe', 'pipe'],
    env: {
      ...process.env,
      ASI_DB_PATH: DB_PATH,
      ASI_PORT: String(API_PORT),
      // Development profile ON PURPOSE: the release profile refuses to start while safety
      // rules are unreviewed, which is the correct behaviour and is not something a preview
      // gets to bypass. The startup banner and /api/health both say so.
      ASI_RELEASE_PROFILE: 'development',
      ASI_DEPLOY_KIND: 'preview',
      ASI_BUILD_COMMIT: COMMIT,
      // No key: the preview must run the deterministic path, so a flow that passes here
      // does not depend on a model being reachable.
      ANTHROPIC_API_KEY: '',
      ...extraEnv,
    },
  });
  const tag = `[${label}]`;
  child.stdout.on('data', (d) => process.stdout.write(prefix(tag, d)));
  child.stderr.on('data', (d) => process.stderr.write(prefix(tag, d)));
  children.push(child);
  return child;
}

function prefix(tag, chunk) {
  return String(chunk)
    .split('\n')
    .filter((l) => l.length)
    .map((l) => `${tag} ${l}\n`)
    .join('');
}

// --- 1. demo data, through the same validated write path the API uses ---------
const seed = run('seed', ['--experimental-strip-types', '--no-warnings', 'src/db/seed.ts']);
await new Promise((res, rej) => {
  seed.once('exit', (code) => (code === 0 ? res() : rej(new Error(`seed failed (${code})`))));
  seed.once('error', rej);
});
console.log('[preview] demo data seeded (synthetic; personId "local")');

// --- 2. the API --------------------------------------------------------------
const api = run('api', ['--experimental-strip-types', '--no-warnings', 'src/index.ts']);
const health = await waitFor(
  'api',
  async () => {
    const r = await fetch(`http://127.0.0.1:${API_PORT}/api/health`);
    return r.ok;
  },
  api,
).then(() => fetch(`http://127.0.0.1:${API_PORT}/api/health`).then((r) => r.json()));

console.log(
  `[preview] api ready: ${health.unreviewedSafetyRules}/${health.totalSafetyRules} safety rules ` +
    `unreviewed, releaseReady=${health.releaseReady}, deployKind=${health.build?.deployKind}`,
);

// --- 3. the single origin ----------------------------------------------------
const web = run('web', [join(HERE, 'serve.mjs')], {
  ASI_PREVIEW_PORT: String(PREVIEW_PORT),
  ASI_API_ORIGIN: `http://127.0.0.1:${API_PORT}`,
});
await waitFor(
  'preview origin',
  async () => {
    const r = await fetch(`http://127.0.0.1:${PREVIEW_PORT}/`);
    return r.ok;
  },
  web,
);

console.log('');
console.log(`[preview] READY  http://127.0.0.1:${PREVIEW_PORT}`);
console.log('[preview] Synthetic data only. NOT clinically reviewed. NOT for real patients.');
console.log('[preview] Ctrl-C to stop.');

for (const child of [api, web]) {
  child.once('exit', (code) => {
    console.error(`[preview] a child exited (${code}); stopping the rest`);
    shutdown(1);
  });
}