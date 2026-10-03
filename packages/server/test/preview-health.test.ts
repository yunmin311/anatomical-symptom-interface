/**
 * A deployment must be able to say what it is, and `/api/health` is where it says it.
 *
 * ## WHY THIS IS A SPAWNED SERVER AND NOT A UNIT TEST
 *
 * `env.ts` parses `process.env` once at import time, so the preview fields cannot be toggled
 * inside a running process. A unit test that imported `app.ts` could only ever see the default
 * `local` profile, which is the HALF that matters least: the dangerous direction is a preview
 * that fails to declare itself, and that needs `ASI_DEPLOY_KIND=preview` actually in effect.
 *
 * So this spawns a real server, the same way `api-contract.test.ts` does.
 *
 * ## WHY IT MATTERS
 *
 * `preview/verify-preview.mjs` checks this against a live preview, but nothing in CI runs it —
 * CI has no deployment to point at. So without this test the honesty property is enforced only
 * by someone remembering to run the verifier, and a change that quietly dropped
 * `previewNotice` would pass every gate while making a preview indistinguishable from a
 * finished product.
 */
import { test, describe, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { spawn, type ChildProcess } from 'node:child_process';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const here = fileURLToPath(new URL('.', import.meta.url));
const entry = resolve(here, '..', 'src', 'index.ts');

type Health = {
  ok: boolean;
  releaseReady: boolean;
  unreviewedSafetyRules: number;
  totalSafetyRules: number;
  build?: { commit?: string; deployKind?: string };
  previewNotice?: string;
  clinicalReview?: string;
};

const dir = mkdtempSync(join(tmpdir(), 'asi-preview-health-'));
const running: ChildProcess[] = [];

/** Boot a server with the given env and resolve with its `/api/health` payload. */
async function healthWith(env: Record<string, string>, port: number): Promise<Health> {
  const child = spawn(process.execPath, [entry], {
    env: {
      ...process.env,
      ASI_DB_PATH: join(dir, `${port}.sqlite`),
      ASI_PORT: String(port),
      ANTHROPIC_API_KEY: '',
      ...env,
    },
    stdio: ['ignore', 'pipe', 'pipe'],
  });
  running.push(child);

  let out = '';
  child.stdout.on('data', (d) => (out += String(d)));
  child.stderr.on('data', (d) => (out += String(d)));

  const deadline = Date.now() + 30_000;
  while (Date.now() < deadline) {
    if (child.exitCode !== null) throw new Error(`the server exited early:\n${out}`);
    try {
      const r = await fetch(`http://127.0.0.1:${port}/api/health`);
      if (r.ok) return (await r.json()) as Health;
    } catch {
      /* not up yet */
    }
    await new Promise((r) => setTimeout(r, 250));
  }
  throw new Error(`the server never became healthy:\n${out}`);
}

after(() => {
  for (const child of running) child.kill('SIGKILL');
  rmSync(dir, { recursive: true, force: true });
});

describe('/api/health identifies the deployment', () => {
  let local: Health;

  before(async () => {
    local = await healthWith({}, 8931);
  });

  test('a default deployment does NOT claim to be a preview', () => {
    // The other direction of the same property, and the one that would be a lie: a real
    // deployment must not carry a preview notice, because "this is a preview" is only useful
    // while it is true.
    assert.equal(local.build?.deployKind, 'local');
    assert.equal(local.previewNotice, undefined, 'a local deployment is advertising a preview notice');
    assert.equal(local.clinicalReview, undefined);
  });

  test('every deployment names the commit it was built from', () => {
    assert.equal(typeof local.build?.commit, 'string', 'no build.commit');
    assert.ok((local.build?.commit ?? '').length > 0, 'build.commit is empty');
  });

  test('a PREVIEW says so, in the API rather than only in a readme', async () => {
    const preview = await healthWith({ ASI_DEPLOY_KIND: 'preview' }, 8932);
    assert.equal(preview.build?.deployKind, 'preview');
    assert.equal(preview.clinicalReview, 'not-reviewed');
    assert.ok(
      typeof preview.previewNotice === 'string' && preview.previewNotice.length > 0,
      'a preview carries no notice, so nothing stops a reader treating it as finished',
    );
  });

  test('the preview notice names what is not true of this build', async () => {
    const preview = await healthWith({ ASI_DEPLOY_KIND: 'preview' }, 8933);
    const notice = preview.previewNotice ?? '';
    // Each of these is a specific, currently-true statement about ASI. A notice that dropped
    // one would leave a reader with a more flattering picture than the facts support.
    assert.match(notice, /not clinically reviewed/i);
    assert.match(notice, /not approved for medical release/i);
    assert.match(notice, /synthetic data only/i);
    assert.match(notice, /placeholder/i, 'the notice does not mention the 2D placeholder anatomy');
    assert.match(notice, /FMA/i, 'the notice does not mention the unverified FMA bindings');
  });

  test('a preview still refuses to claim release readiness', async () => {
    const preview = await healthWith({ ASI_DEPLOY_KIND: 'preview' }, 8934);
    // Being a preview must not soften the safety reporting. If this ever reads `true` while
    // rules are unreviewed, something bypassed the review metadata.
    assert.equal(preview.unreviewedSafetyRules, 10);
    assert.equal(preview.releaseReady, false);
  });

  test('the notice travels with the reported commit', async () => {
    // A preview that cannot be identified is the failure this whole mechanism exists to
    // prevent, so the two fields are checked together rather than independently.
    const preview = await healthWith(
      { ASI_DEPLOY_KIND: 'preview', ASI_BUILD_COMMIT: 'deadbeefcafe' },
      8935,
    );
    assert.equal(preview.build?.commit, 'deadbeefcafe', 'build.commit ignored the environment');
    assert.ok(preview.previewNotice, 'a preview with a known commit still carries no notice');
  });
});