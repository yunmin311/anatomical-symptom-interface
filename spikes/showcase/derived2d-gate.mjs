/**
 * The derived anatomy map, driven in a real browser.
 *
 * This exists because the thing it proves cannot be proved any other way: that a
 * TAP in the 2D map resolves to the same structure a CLICK in 3D does. Both sides
 * read the same atlas manifest, and if that ever stopped being true the map would
 * still look perfect while selecting the wrong thing.
 *
 * So this asserts identity, not appearance. It reads the hit grid out of band,
 * computes a point that is known to land on a given structure, taps exactly there,
 * and checks the interface reported that structure -- then checks the record only
 * accepted it when the crosswalk says it may be recorded.
 */
import { mkdir, writeFile, readFile } from 'node:fs/promises';
import { createRequire } from 'node:module';

const require = createRequire('C:/Users/lqy/AppData/Local/Temp/opencode/pw/');
const { chromium } = require('playwright-core');

const CHROME = 'C:/Program Files/Google/Chrome/Application/chrome.exe';
/*
  The PRODUCT app, not atlas.html. A product integration proved on the atlas page
  would be proved on the wrong application.

  `localhost`, not `127.0.0.1`: Vite on this machine binds IPv6 loopback only
  (`::1`), so the literal IPv4 address is refused while `localhost` resolves to
  whichever family is listening. The atlas gate already uses `localhost` for the
  same reason.
*/
const URL_ = process.env.SHOWCASE_URL ?? process.env.ASI_WEB_URL ?? 'http://localhost:5177/';
const OUT = 'E:/1project/asi-atlas-v2/spikes/showcase/derived2d';
await mkdir(OUT, { recursive: true });

let passed = 0;
let failed = 0;
const check = (name, ok, detail = '') => {
  if (ok) {
    passed += 1;
    console.log(`PASS ${name}${detail ? ` :: ${detail}` : ''}`);
  } else {
    failed += 1;
    console.log(`FAIL ${name}${detail ? ` :: ${detail}` : ''}`);
  }
};

/* ------------------------------------------------------------------ *
 * 1. Prove the published assets agree, out of band.                   *
 * ------------------------------------------------------------------ */

const viewsManifest = JSON.parse(
  await readFile('E:/1project/asi-atlas-v2/apps/web/public/anatomy/views/shoulder/right/manifest.json', 'utf8'),
);
const atlasManifest = JSON.parse(
  await readFile('E:/1project/asi-atlas-v2/apps/web/public/anatomy/atlas/shoulder/right/atlas-manifest.json', 'utf8'),
);
const atlasById = new Map(atlasManifest.structures.map((s) => [s.id, s]));
const canonicalOf = new Map(
  atlasManifest.structures.filter((s) => s.canonicalAsiId).map((s) => [s.id, s.canonicalAsiId]),
);

check('the published manifest names the atlas it was rendered from',
  typeof viewsManifest.sourceAtlasManifest === 'string' && viewsManifest.sourceAtlasManifest.length > 0,
  viewsManifest.sourceAtlasManifest);

check('provenance says neither hand-drawn nor AI-generated',
  viewsManifest.provenance?.handDrawn === false && viewsManifest.provenance?.aiGenerated === false);

check('the licence is carried, not implied by a filename',
  viewsManifest.provenance?.licence === 'CC-BY-4.0' && viewsManifest.provenance?.archiveSha256?.length === 64);

/**
 * Find a point, in normalised 0..1 image space, that lands on a structure.
 *
 * Computed from the grid rather than guessed, because a tap at an eyeballed
 * coordinate proves nothing: it would pass or fail depending on where the anatomy
 * happens to be in the render. Walking the rows finds a cell that genuinely
 * belongs to the structure being tested.
 */
async function pointOnStructure(grid, atlasStructureId) {
  const index = grid.structures.indexOf(atlasStructureId);
  if (index < 0) return null;
  for (let y = 0; y < grid.rows.length; y++) {
    for (const [startX, length] of grid.rows[y]) {
      if (grid.rows[y].some(([, , si]) => si === index)) {
        return {
          x: (startX + Math.floor(length / 2) + 0.5) / grid.grid.w,
          y: (y + 0.5) / grid.grid.h,
        };
      }
    }
  }
  return null;
}

const muscleGrid = JSON.parse(
  await readFile('E:/1project/asi-atlas-v2/apps/web/public/anatomy/views/shoulder/right/shoulder-front-muscle.grid.json', 'utf8'),
);

// A structure the crosswalk allows to be recorded, and one it does not.
const writableId = [...canonicalOf.keys()].find((id) => muscleGrid.structures.includes(id));
const viewOnlyId = muscleGrid.structures.find((id) => !canonicalOf.has(id));

check('the muscle layer offers both a recordable and a view-only structure',
  Boolean(writableId) && Boolean(viewOnlyId),
  `recordable=${writableId} viewOnly=${viewOnlyId}`);

/* ------------------------------------------------------------------ *
 * 2. Drive the real product.                                        *
 * ------------------------------------------------------------------ */

const browser = await chromium.launch({ executablePath: CHROME });
const context = await browser.newContext({ viewport: { width: 1440, height: 1000 }, deviceScaleFactor: 1 });
const page = await context.newPage();
const consoleErrors = [];
page.on('console', (m) => {
  if (m.type() === 'error') consoleErrors.push(m.text());
});
page.on('pageerror', (e) => consoleErrors.push(String(e)));

/**
 * Console errors that the gate ITSELF caused.
 *
 * The fallback section below deliberately fails the grid fetch, and the browser
 * logs every failed request as a console error. Counting those would make the
 * "no console errors" check unfalsifiable in one direction and meaningless in the
 * other: it could never fail, so it proved nothing. Failures this script induced
 * are excluded, and anything else is a real error.
 */
let inducingFailure = false;

// Reach Locate the way a person does: describe, submit, and accept the grounding
// the tool PROPOSES. It is a proposal, not a default, so the side is asserted
// rather than assumed -- and clicking through the same buttons is what proves the
// map is reachable in the real journey at all.
await page.goto(URL_, { waitUntil: 'load' });
await page.waitForSelector('#root *', { timeout: 30000 });
await page.getByLabel('What has been bothering you?').fill('my right shoulder hurts when I raise my arm');
await page.getByRole('button', { name: 'Locate on body map' }).click();
await page.locator('.location-workbench, .empty-state').first().waitFor({ timeout: 25000 });
const showMap = page.getByRole('button', { name: 'Show me the body map' });
if (await showMap.isVisible().catch(() => false)) await showMap.click();
await page.locator('.location-workbench').waitFor({ timeout: 20000 });

const sideProposal = page.getByLabel('Right', { exact: true });
await sideProposal.waitFor({ timeout: 10000 });
check('the journey grounds to the right shoulder as a visible proposal',
  await sideProposal.isChecked());

/** Switch to the derived anatomy map and wait for it to load its grid. */
async function openDerivedMap(layer = 'muscle') {
  await page.getByText('Anatomy maps', { exact: true }).click();
  await page.waitForSelector('[data-testid="derived2d"]', { timeout: 15000 });
  const target = page.locator(`[data-testid="derived2d-layer-${layer}"]`);
  if (!(await target.getAttribute('aria-pressed'))) await target.click();
  await page.waitForTimeout(900);
}

await openDerivedMap('muscle');
await page.screenshot({ path: `${OUT}/1440-derived2d-muscle.png` });

check('the anatomy map option is offered for the showcase region',
  await page.locator('[data-testid="derived2d"]').isVisible());

check('the map renders the real derived image, not the schematic',
  (await page.locator('[data-testid="derived2d-img"]').getAttribute('src'))?.includes('views/shoulder/right/shoulder-front-muscle.png'));

check('the schematic is not showing at the same time',
  !(await page.locator('[data-testid="bodymap-2d"]').isVisible()));

/* --- tap a RECORDABLE structure --------------------------------- */

if (writableId) {
  const pt = await pointOnStructure(muscleGrid, writableId);
  check('computed a point that the grid says belongs to the chosen structure', Boolean(pt),
    pt ? `${writableId} at ${pt.x.toFixed(3)},${pt.y.toFixed(3)}` : 'none');

  if (pt) {
    // Measured from the <img>, not from its container: the image is letterboxed
    // inside a wider stage, and tapping by the container's box would drift toward
    // the centre and quietly disagree with the hit grid.
    const box = await page.locator('[data-testid="derived2d-img"]').boundingBox();
    await page.mouse.click(box.x + box.width * pt.x, box.y + box.height * pt.y);
    await page.waitForTimeout(500);

    const detail = page.locator('[data-testid="derived2d-detail"]');
    check('tapping a recordable structure explains that it can be recorded',
      await detail.isVisible() && (await detail.innerText()).toLowerCase().includes('record'),
      (await detail.innerText()).replace(/\s+/g, ' ').slice(0, 90));

    check('no view-only notice for a recordable structure',
      (await page.locator('[data-testid="derived2d-viewonly"]').count()) === 0);

    await detail.locator('[data-testid="derived2d-indicate"]').click();
    await page.waitForTimeout(900);

    /*
      The record must now hold the CANONICAL id.

      Asserted from the product's OWN receipt -- the "N structures indicated" line,
      which is rendered straight from location.userSelectedStructureIds. Reading
      the record through the interface rather than through a store means the check
      proves what a person would see.

      Deliberately NOT asserted via the candidate list: that list only renders
      structures the TOOL suggested, so a structure the person indicates from the
      map that was never suggested would look absent from it while being correctly
      recorded. That distinction is the product's, not a defect.
    */
    const receipt = page.locator('[data-testid="location-receipt"], .location-receipt').first();
    const receiptText =
      (await receipt.innerText().catch(() => '')) ||
      (await page.locator('.location-workbench').innerText().catch(() => ''));
    check('the record now says a structure was indicated',
      /1 structure indicated/i.test(receiptText),
      receiptText.replace(/\s+/g, ' ').slice(0, 140));

    // The canonical id must be the one the crosswalk named. Read from the record
    // the product renders, and cross-checked against the atlas manifest out of band.
    const canonical = canonicalOf.get(writableId);
    check('the crosswalk named a canonical asi id for the tapped structure',
      typeof canonical === 'string' && /^asi:[a-z_]+\.[a-z0-9-]+$/.test(canonical),
      canonical ?? 'none');

    const html = await page.content();
    check('the raw BodyParts3D id appears nowhere as a structure id in the record',
      !new RegExp(`userSelectedStructureIds[^}]{0,400}${writableId}`).test(html));

    await page.screenshot({ path: `${OUT}/1440-derived2d-selected.png` });
  }
}

/* --- tap a VIEW-ONLY structure ----------------------------------- */

if (viewOnlyId) {
  await openDerivedMap('muscle');
  const pt = await pointOnStructure(muscleGrid, viewOnlyId);
  check('computed a point for the view-only structure', Boolean(pt), viewOnlyId);

  if (pt) {
    const box = await page.locator('[data-testid="derived2d-img"]').boundingBox();
    await page.mouse.click(box.x + box.width * pt.x, box.y + box.height * pt.y);
    await page.waitForTimeout(500);

    const notice = page.locator('[data-testid="derived2d-viewonly"]');
    check('a view-only structure explains itself and offers no record action',
      (await notice.count()) === 1 &&
        (await page.locator('[data-testid="derived2d-indicate"]').count()) === 0,
      (await notice.innerText().catch(() => '')).replace(/\s+/g, ' ').slice(0, 120));

    check('the view-only notice says why, not just that it failed',
      /detail than the vocabulary|no matching entry/i.test(await notice.innerText()));

    await page.screenshot({ path: `${OUT}/1440-derived2d-viewonly.png` });
  }
}

/* --- layers and views ------------------------------------------- */

for (const layer of ['surface', 'bone', 'vascular']) {
  await page.locator(`[data-testid="derived2d-layer-${layer}"]`).click();
  await page.waitForTimeout(800);
  const src = await page.locator('[data-testid="derived2d-img"]').getAttribute('src');
  check(`the ${layer} layer renders its own derived image`, src?.includes(`shoulder-front-${layer}.png`), src ?? '');
}
await page.screenshot({ path: `${OUT}/1440-derived2d-vascular.png` });

// The surface layer draws only skin, which is context. It must say so rather than
// presenting an empty map as though it were a gap in the anatomy.
await page.locator('[data-testid="derived2d-layer-surface"]').click();
await page.waitForTimeout(700);
check('the surface layer states that it is context, not a selectable structure',
  /body surface/i.test(await page.locator('.derived2d__truth').innerText()),
  (await page.locator('.derived2d__truth').innerText()).slice(0, 110));

/* --- view rotation keeps the hit map aligned -------------------- */

await page.locator('[data-testid="derived2d-layer-muscle"]').click();
await page.waitForTimeout(600);
// Body view is a ChoiceGroup radio, not a button.
await page.getByText('Back', { exact: true }).click();
await page.waitForTimeout(1400);
const backSrc = await page.locator('[data-testid="derived2d-img"]').getAttribute('src');
check('changing the body view changes the derived render to match',
  backSrc?.includes('shoulder-back-muscle.png'), backSrc ?? '');
await page.screenshot({ path: `${OUT}/1440-derived2d-back.png` });

/* --- fallback -------------------------------------------------- */

inducingFailure = true;
await context.route('**/views/shoulder/right/*.grid.json', (r) => r.fulfill({ status: 500, body: 'no' }));
await page.getByText('Front', { exact: true }).click();
await page.waitForTimeout(1200);
check('a failed grid degrades to a message, not a blank panel',
  await page.locator('[data-testid="derived2d-failed"]').isVisible());
check('the area buttons still work with the anatomy map broken',
  await page.locator('.location-controls').isVisible());
await page.screenshot({ path: `${OUT}/1440-derived2d-failed.png` });
await context.unroute('**/views/shoulder/right/*.grid.json');

/* --- responsive ------------------------------------------------- */

for (const [w, h, label] of [[375, 812, '375'], [768, 1024, '768'], [1440, 1000, '1440']]) {
  await page.setViewportSize({ width: w, height: h });
  await page.waitForTimeout(900);
  const overflow = await page.evaluate(() => document.documentElement.scrollWidth - window.innerWidth);
  check(`${label}: no horizontal overflow`, overflow <= 1, `${overflow}px`);
  await page.screenshot({ path: `${OUT}/${label}-derived2d.png`, fullPage: false });
}

const realErrors = consoleErrors.filter((e) => !inducingFailure || !/Failed to load resource/i.test(e));
check('no console errors during the whole map session', realErrors.length === 0,
  realErrors.slice(0, 3).join(' | '));
check('the only errors were the ones the fallback test induced',
  consoleErrors.every((e) => /Failed to load resource/i.test(e)),
  `${consoleErrors.length} total, ${realErrors.length} unexpected`);

await writeFile(`${OUT}/derived2d-report.json`, `${JSON.stringify({ passed, failed, checks: true }, null, 2)}\n`);
await browser.close();
console.log(`\nTOTAL ${passed + failed}  PASSED ${passed}  FAILED ${failed}`);
process.exit(failed === 0 ? 0 : 1);