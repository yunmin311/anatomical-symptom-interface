/**
 * Verify a RUNNING preview. Fails loudly, so "the preview works" is a checked claim.
 *
 * ## WHY THIS IS A SCRIPT AND NOT A MANUAL LOOK
 *
 * Because the first version of the preview proxy had a bug that a manual check would very
 * likely have missed: it passed the request stream straight through as a fetch body, which
 * undici rejects without `duplex: 'half'`. Every GET worked. Every POST returned 502. The page
 * rendered, the read models loaded, the health map drew real data from the server -- and the
 * entire write half of the product was dead, reported to the user as "Location service
 * unavailable".
 *
 * Nothing about looking at the preview shows that. So the checks below are ordered to fail on
 * the things a screenshot cannot show:
 *
 *   1. the deployment identifies ITSELF and says it is not for clinical use
 *   2. a WRITE round-trips through the proxy and is readable afterwards  <- the bug above
 *   3. refusals keep their shape through the proxy, not just successes
 *   4. assets and the traversal guard behave
 *
 * Usage:  node preview/verify-preview.mjs [origin]
 */
import { existsSync, readFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
const ORIGIN = process.argv[2] || process.env.ASI_PREVIEW_URL || 'http://127.0.0.1:8080';

const HERE = dirname(fileURLToPath(import.meta.url));
const REPO = resolve(HERE, '..');

const failures = [];
let passed = 0;

async function check(name, fn) {
  try {
    await fn();
    passed += 1;
    console.log(`ok   ${name}`);
  } catch (e) {
    failures.push(`${name}: ${e?.message ?? e}`);
    console.log(`FAIL ${name}\n       ${e?.message ?? e}`);
  }
}

function assert(condition, message) {
  if (!condition) throw new Error(message);
}

const getJson = async (path) => {
  const r = await fetch(ORIGIN + path);
  return { status: r.status, body: await r.json() };
};

const postJson = async (path, payload) => {
  const r = await fetch(ORIGIN + path, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(payload),
  });
  return { status: r.status, body: await r.json() };
};

/* ---------------------------------------------------------------- 1. identity */

let health;
await check('the preview is reachable and reports itself', async () => {
  const { status, body } = await getJson('/api/health');
  assert(status === 200, `health returned ${status}`);
  health = body;
  assert(body.ok === true, 'health does not report ok');
});

await check('it states it is a PREVIEW, in the API rather than only in a readme', async () => {
  assert(health.build?.deployKind === 'preview', `deployKind is ${health.build?.deployKind}`);
  assert(
    typeof health.previewNotice === 'string' && health.previewNotice.length > 0,
    'no previewNotice: nothing stops a reader treating this as a finished product',
  );
  assert(
    /not clinically reviewed/i.test(health.previewNotice),
    `the notice does not say it is unreviewed: ${health.previewNotice}`,
  );
  assert(
    /not approved for medical release/i.test(health.previewNotice),
    'the notice does not say it is not approved for medical release',
  );
});

await check('it does NOT claim release readiness', async () => {
  assert(health.releaseReady === false, 'releaseReady is true while safety rules are unreviewed');
  assert(
    health.unreviewedSafetyRules > 0,
    'unreviewedSafetyRules is 0: either the rules were reviewed or the count is dishonest',
  );
  assert(
    health.unreviewedSafetyRules <= health.totalSafetyRules,
    'more unreviewed rules than total rules',
  );
});

await check('it names the commit it was built from', async () => {
  assert(typeof health.build?.commit === 'string', 'no build.commit');
  assert(health.build.commit.length > 0, 'build.commit is empty');
});

/* ------------------------------------------------------------ 2. WRITE PATH */

await check('a WRITE round-trips through the proxy', async () => {
  /*
   * The regression this whole script exists for.
   *
   * A read-only check passes against a proxy that cannot forward a body at all, which is how
   * a completely broken write path shipped once. So this creates a real episode, and then
   * reads it back.
   */
  const created = await postJson('/api/episodes', {
    personId: 'preview-verify',
    grounding: { status: 'grounded', region: 'shoulder', side: 'left' },
  });
  assert(created.status === 201, `create episode returned ${created.status}: ${JSON.stringify(created.body)}`);
  assert(typeof created.body.id === 'string', 'no episode id returned');

  const read = await getJson(`/api/episodes/${created.body.id}`);
  assert(read.status === 200, `reading it back returned ${read.status}`);
  assert(read.body.id === created.body.id, 'the episode read back is not the one written');
  assert(read.body.record.location.region === 'shoulder', 'the region did not round-trip');

  // And a mutation on top, because create and update are different proxy paths in practice.
  const mutated = await postJson(`/api/episodes/${created.body.id}/mutations`, {
    mutations: [
      {
        fieldPath: 'location.side',
        value: 'left',
        provenance: {
          sourceType: 'user_statement',
          verificationStatus: 'unverified',
          createdBy: 'preview-verify',
        },
      },
    ],
  });
  assert(mutated.status === 200, `mutation returned ${mutated.status}: ${JSON.stringify(mutated.body)}`);
});

await check('an invalid WRITE is refused with its shape intact, not as a proxy error', async () => {
  // A proxy that answers 502 for everything would also "refuse" this. So the check is on the
  // envelope: a stable code from the API, not a transport failure.
  const r = await postJson('/api/episodes', { personId: 'preview-verify', grounding: { status: 'nonsense' } });
  assert(r.status >= 400, `an invalid request was accepted (${r.status})`);
  assert(r.status !== 502, 'a client error became a bad gateway: the proxy is masking the API');
  assert(typeof r.body?.error === 'string', `no error code in the refusal: ${JSON.stringify(r.body)}`);
});

await check('localisation works through the proxy', async () => {
  const r = await postJson('/api/localise', { utterance: 'my left shoulder aches at night' });
  assert(r.status === 200, `localise returned ${r.status}: ${JSON.stringify(r.body)}`);
  assert(r.body.region === 'shoulder', `expected shoulder, got ${r.body.region}`);
});

/* --------------------------------------------------------- 3. demo data only */

await check('the seeded demo data is synthetic', async () => {
  const r = await getJson('/api/episodes?personId=local');
  assert(r.status === 200, `listing episodes returned ${r.status}`);
  const episodes = Array.isArray(r.body) ? r.body : (r.body.episodes ?? []);
  assert(Array.isArray(episodes), 'could not read the episode list');
  for (const e of episodes) {
    const name = (e.displayName ?? '').trim();
    assert(
      name === '' || name === 'Me',
      `a demo record is named "${name}"; the preview must ship with synthetic data only`,
    );
  }
});

/* ------------------------------------------------------- 4. assets and guard */

await check('a real anatomy mesh is served with a usable content type', async () => {
  const cap = await getJson('/api/anatomy/capability');
  assert(cap.status === 200, `capability returned ${cap.status}`);

  // `regions` is an ARRAY of reports, each with its own `sides` array.
  const shoulder = (cap.body.regions ?? []).find((r) => r.region === 'shoulder');
  assert(shoulder, 'the capability report has no shoulder entry');
  const left = (shoulder.sides ?? []).find((s) => s.side === 'left');
  assert(left?.threeD?.available === true, 'the shoulder left side reports no 3D');
  assert(
    (left.threeD.licence ?? '').length > 0,
    'the mesh entry declares no licence; an unattributed mesh cannot be redistributed',
  );

  /*
   * The filename comes from the generated manifest in the repo, which is the source of truth
   * for what exists. There is no manifest API route -- the manifests are compiled into the
   * build -- so reading the generated file is the only way to name a real mesh, and it means
   * this checks a mesh the product actually claims rather than one invented here.
   *
   * `file` is relative to the `/anatomy/` root, which is what the web's asset adapter
   * resolves against, so the URL below is the same one the browser requests.
   */
  const manifestPath = resolve(REPO, 'assets', 'anatomy', 'generated', 'shoulder', 'left', 'manifest.json');
  assert(existsSync(manifestPath), `no generated manifest at ${manifestPath}`);
  const manifest = JSON.parse(readFileSync(manifestPath, 'utf8'));
  const entry = (manifest.entries ?? []).find((e) => e?.file);
  assert(entry?.file, 'the generated manifest names no mesh file');
  assert(
    (entry.licence?.id ?? '').length > 0,
    'a mesh with no licence cannot be redistributed, and this preview serves it',
  );
  assert(
    entry.fma?.status === 'unverified' || entry.fma?.status === 'verified',
    `unexpected FMA status ${entry.fma?.status}`,
  );

  const url = `${ORIGIN}/anatomy/shoulder/left/${String(entry.file).replace(/^\/+/, '')}`;
  const mesh = await fetch(url);
  assert(mesh.status === 200, `mesh ${entry.file} returned ${mesh.status} from ${url}`);
  assert(
    (mesh.headers.get('content-type') ?? '').includes('model/gltf-binary'),
    `mesh served as ${mesh.headers.get('content-type')}, which a GLTFLoader will not parse`,
  );
  const bytes = Buffer.from(await mesh.arrayBuffer());
  assert(bytes.length > 0, 'the mesh is empty');
  assert(
    bytes.subarray(0, 4).toString('ascii') === 'glTF',
    'the mesh bytes are not glTF: a 200 with the wrong content is worse than a 404',
  );
});

await check('the app shell answers a deep link', async () => {
  const r = await fetch(`${ORIGIN}/some/client/route`);
  assert(r.status === 200, `deep link returned ${r.status}`);
  assert((r.headers.get('content-type') ?? '').includes('text/html'), 'deep link did not serve HTML');
});

await check('a missing asset 404s instead of returning HTML', async () => {
  // Answering a missing .glb with a page of HTML turns a broken mesh into a baffling parse
  // error inside the viewer instead of an honest failed request.
  const r = await fetch(`${ORIGIN}/definitely-not-here.glb`);
  assert(r.status === 404, `missing asset returned ${r.status}`);
  assert(!(r.headers.get('content-type') ?? '').includes('text/html'), 'missing asset served HTML');
});

await check('path traversal is refused', async () => {
  for (const path of ['/../package.json', '/..%2f..%2fpackage.json', '/assets/../../package.json']) {
    const r = await fetch(ORIGIN + path);
    assert(r.status === 404, `${path} returned ${r.status} instead of 404`);
  }
});

/* ----------------------------------------------------------------- verdict */

console.log(`\n${passed} passed, ${failures.length} failed  (${ORIGIN})`);
if (failures.length) {
  console.error('\npreview verification FAILED:');
  for (const f of failures) console.error(`  - ${f}`);
  process.exit(1);
}
console.log('preview verification PASS');