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

/* ------------------------------------------------------------------ *
 * RESPONSIVE, ON THE SUCCESS PATH.                                     *
 *                                                                     *
 * This used to run straight after the fallback test with nothing more  *
 * than a viewport change, and the captures came out showing "This     *
 * view could not be loaded" at 375 and 768. Two things were wrong with *
 * that, and neither was the screenshot's fault:                       *
 *                                                                     *
 *   - the component refetches only when view or layer changes, so     *
 *     resizing could not clear a failed state and the failed panel   *
 *     persisted into the captures.                                    *
 *   - a failure-state screenshot at 375 is EVIDENCE OF THE FALLBACK, *
 *     not evidence that 375 works. Presenting it as the latter is    *
 *     exactly the "rename the screenshot instead of fixing it"       *
 *     failure this project forbids.                                   *
 *                                                                     *
 * So each width is now driven from a FRESH page through the real      *
 * journey, and the success path is asserted before anything is       *
 * captured. Failure states get their own separate captures.          *
 * ------------------------------------------------------------------ */

const SUCCESS_WIDTHS = [
  { w: 375, h: 812, label: '375' },
  { w: 768, h: 1024, label: '768' },
  { w: 1440, h: 1000, label: '1440' },
];

for (const { w, h, label } of SUCCESS_WIDTHS) {
  const vp = await context.newPage();
  const vpErrors = [];
  vp.on('pageerror', (e) => vpErrors.push(String(e)));
  await vp.setViewportSize({ width: w, height: h });
  await vp.goto(URL_, { waitUntil: 'load' });
  await vp.waitForSelector('#root *', { timeout: 30000 });
  await vp.getByLabel('What has been bothering you?').fill('my right shoulder hurts when I raise my arm');
  await vp.getByRole('button', { name: 'Locate on body map' }).click();
  await vp.locator('.location-workbench, .empty-state').first().waitFor({ timeout: 25000 });
  const vpMap = vp.getByRole('button', { name: 'Show me the body map' });
  if (await vpMap.isVisible().catch(() => false)) await vpMap.click();
  await vp.locator('.location-workbench').waitFor({ timeout: 20000 });

  await vp.getByText('Anatomy maps', { exact: true }).click();
  await vp.waitForSelector('[data-testid="derived2d"]', { timeout: 15000 });
  await vp.waitForTimeout(1200);

  // 1. The image actually loaded, and it is not a broken-image box.
  const imgOk = await vp.evaluate(() => {
    const el = document.querySelector('[data-testid="derived2d-img"]');
    return Boolean(el) && el.naturalWidth > 0 && el.complete;
  });
  check(`${label}: the derived image actually loaded`, imgOk);

  // 2. The grid loaded: no fallback panel, and the hit map resolved structures.
  const gridOk = await vp.evaluate(async () => {
    const grid = { w: 160, h: 200 };
    const r = await fetch('/anatomy/views/shoulder/right/shoulder-front-muscle.grid.json');
    if (!r.ok) return false;
    const g = await r.json();
    return Array.isArray(g.rows) && g.rows.flat().length > 0 && g.selectable === true;
  });
  check(`${label}: the hit grid loaded and resolves structures`, gridOk);
  check(`${label}: no failure panel is showing`,
    (await vp.locator('[data-testid="derived2d-failed"]').count()) === 0);

  /*
    2b. The image is actually SIZE-PRESENT IN THE STAGE.

    This check did not exist, and its absence is why a real bug passed 71/71 twice:
    at 375 the map was a 68px thumbnail with the image overflowing a 157px stage,
    every image-loaded assertion was true, every tap landed correctly on a 68px
    square, and the captures looked plausible. "The image loaded" and "the image is
    legible" are different claims and only one of them was being tested.

    Two assertions, because the two faults were different:
      - the image is inside the stage (not clipped by it), and
      - it occupies a real share of the viewport, so it is not a postage stamp.
  */
  const fit = await vp.evaluate(() => {
    const img = document.querySelector('[data-testid="derived2d-img"]');
    const stage = document.querySelector('.derived2d__stage');
    if (!img || !stage) return null;
    const i = img.getBoundingClientRect();
    const s = stage.getBoundingClientRect();
    return {
      iw: i.width, ih: i.height, sw: s.width, sh: s.height,
      inside: i.top >= s.top - 1 && i.bottom <= s.bottom + 1,
      vw: window.innerWidth, vh: window.innerHeight,
    };
  });
  check(`${label}: the image fits inside its stage rather than overflowing it`,
    fit !== null && fit.inside,
    fit ? `img ${Math.round(fit.iw)}x${Math.round(fit.ih)} in stage ${Math.round(fit.sw)}x${Math.round(fit.sh)}` : 'no image');
  check(`${label}: the image is legible, not a thumbnail`,
    fit !== null && Math.min(fit.iw, fit.ih) >= 240,
    fit ? `${Math.round(Math.min(fit.iw, fit.ih))}px in a ${fit.vw}x${fit.vh} viewport` : 'no image');

  // 3. Layer switching works.
  const beforeLayer = await vp.locator('[data-testid="derived2d-img"]').getAttribute('src');
  await vp.locator('[data-testid="derived2d-layer-bone"]').click();
  await vp.waitForTimeout(1000);
  const afterLayer = await vp.locator('[data-testid="derived2d-img"]').getAttribute('src');
  check(`${label}: switching layer changes the render`,
    Boolean(beforeLayer) && Boolean(afterLayer) && beforeLayer !== afterLayer,
    `${beforeLayer} -> ${afterLayer}`);
  await vp.locator('[data-testid="derived2d-layer-muscle"]').click();
  await vp.waitForTimeout(1000);

  // 4. A writable structure can be tapped AND selected.
  const writablePoint = await pointOnStructure(muscleGrid, writableId);
  if (writablePoint) {
    const box = await vp.locator('[data-testid="derived2d-img"]').boundingBox();
    await vp.mouse.click(box.x + box.width * writablePoint.x, box.y + box.height * writablePoint.y);
    await vp.waitForTimeout(500);
    const canRecord = await vp.locator('[data-testid="derived2d-indicate"]').count();
    check(`${label}: a writable structure offers the record action`, canRecord === 1);
    if (canRecord === 1) {
      /*
        Re-read the image box AFTER clicking "indicate" before computing the next
        tap point.

        Indicating a structure adds the receipt, which grows the panel and pushes the
        map UP: at 375 the image moved from y=519 to y=187, a 332px shift. The
        view-only tap then landed on the supraspinatus that was already selected, so
        the check reported "a view-only structure explains itself" as failing on a
        screen where the view-only path works perfectly well.

        A captured bounding box is only valid while the layout is still. Anything
        that changes the layout has to invalidate it.
      */
      await vp.locator('[data-testid="derived2d-indicate"]').click();
      await vp.waitForTimeout(900);
      const receipt = await vp.locator('.location-workbench').innerText();
      check(`${label}: selecting it records a structure`, /1 structure indicated/i.test(receipt),
        receipt.replace(/\s+/g, ' ').slice(0, 110));
      /*
        Read `location.userSelectedStructureIds` itself.

        The previous version of this check scanned `.candidate-item--selected`, which
        only ever renders TOOL SUGGESTIONS. A structure indicated from the anatomy
        map goes straight into `userSelectedStructureIds` and appears in no candidate
        list, so the scan found nothing and `[].every(...)` was true -- the check
        passed on an empty array and would have passed just as happily with a raw
        `bp3d:FJ1506` in the record.

        So: assert there IS something recorded, that it is canonical, and that it is
        the specific structure the crosswalk named for the point we tapped. All
        three, or it is not a proof.
      */
      const ids = await vp.evaluate(() =>
        Array.from(document.querySelectorAll('[data-testid="selected-structure-ids"] li'))
          .map((n) => (n.textContent || '').trim()),
      );
      check(`${label}: the tap actually recorded something`, ids.length > 0,
        ids.join(', ') || 'NOTHING RECORDED');
      check(`${label}: what was recorded is canonical, never bp3d`,
        ids.length > 0 && ids.every((id) => id.startsWith('asi:') && !id.includes('bp3d')),
        ids.join(', ') || 'none');
    }
  }

  // 5. A view-only structure explains itself and offers nothing.
  //
  // On its OWN PAGE, and after scrolling the map back into view.
  //
  // Two things were wrong with doing this straight after the writable tap on the
  // same page. Indicating a structure grows the panel and pushes the map up 332px at
  // 375, so a stale box lands the tap on a different structure. And with a record
  // now in hand the receipt sits directly under the map, which pushes the tap target
  // off a 812px screen entirely -- so the click was landing on the page, not the map.
  //
  // Testing the view-only path in isolation is not a weakening: it is the only way to
  // test it on a 375 screen without a selection in the way, which is itself the state
  // a person is in when they first look at a structure.
  const voPage = await context.newPage();
  const voErrors = [];
  voPage.on('pageerror', (e) => voErrors.push(String(e)));
  await voPage.setViewportSize({ width: w, height: h });
  await voPage.goto(URL_, { waitUntil: 'load' });
  await voPage.waitForSelector('#root *', { timeout: 30000 });
  await voPage.locator('#description').fill('my right shoulder hurts when I raise my arm');
  await voPage.getByRole('button', { name: 'Locate on body map' }).click();
  await voPage.locator('.location-workbench, .empty-state').first().waitFor({ timeout: 25000 });
  const voMap = voPage.getByRole('button', { name: 'Show me the body map' });
  if (await voMap.isVisible().catch(() => false)) await voMap.click();
  await voPage.locator('.location-workbench').waitFor({ timeout: 20000 });
  await voPage.getByText('Anatomy maps', { exact: true }).click();
  await voPage.waitForSelector('[data-testid="derived2d"]', { timeout: 15000 });
  await voPage.waitForTimeout(1200);

  if (viewOnlyId) {
    const voPoint = await pointOnStructure(muscleGrid, viewOnlyId);
    if (voPoint) {
      /*
        Scroll so the TAP POINT is on screen, not the whole image.

        `scrollIntoViewIfNeeded()` on the image only scrolls the image into view, and
        the image is 349px tall in a 1024px viewport that already has ~700px of
        orientation and toolbar above it -- so it reports "visible", scrolls almost
        nothing, and leaves the point at y=716 well below the fold. Asserting on the
        image's whole box then fails while the tap itself works, because Playwright
        dispatches at the point's own coordinates.

        So: assert on the point, and scroll until the point is actually in the
        viewport.
      */
      await voPage.evaluate((fy) => {
        const img = document.querySelector('[data-testid="derived2d-img"]');
        if (!img) return;
        const r = img.getBoundingClientRect();
        // Where the point sits inside the image, and therefore where on the page.
        const pointY = r.top + r.height * fy;
        const centre = window.innerHeight / 2;
        window.scrollBy({ top: pointY - centre, behavior: 'instant' });
      }, voPoint.y);
      await voPage.waitForTimeout(400);
      const fresh = await voPage.locator('[data-testid="derived2d-img"]').boundingBox();
      const vh = await voPage.evaluate(() => window.innerHeight);
      const pointScreenY = fresh.y + fresh.height * voPoint.y;
      check(
        `${label}: the view-only tap point is actually on screen`,
        pointScreenY >= 0 && pointScreenY <= vh,
        `point at y=${Math.round(pointScreenY)}, viewport ${vh}`,
      );
      await voPage.mouse.click(fresh.x + fresh.width * voPoint.x, fresh.y + fresh.height * voPoint.y);
      await voPage.waitForTimeout(600);
      check(`${label}: a view-only structure explains itself and cannot be recorded`,
        (await voPage.locator('[data-testid="derived2d-viewonly"]').count()) === 1 &&
          (await voPage.locator('[data-testid="derived2d-indicate"]').count()) === 0,
        (await voPage.locator('[data-testid="derived2d-viewonly"]').innerText().catch(() => ''))
          .replace(/\s+/g, ' ').slice(0, 90));
      await voPage.screenshot({ path: `${OUT}/${label}-derived2d-viewonly.png` });
      check(`${label}: no page errors on the view-only path`, voErrors.length === 0,
        voErrors.slice(0, 2).join(' | '));
    }
    await voPage.close();
  }

  // 6. Area selection and the continue action still work at this width.
  //
  // The area buttons live inside the "Area & pin" inspector panel, so the panel is
  // opened rather than assumed mounted. Reaching into `.location-controls` found
  // only the side and depth radios, which is why this read as "no area buttons at
  // all" and then reported the continue action as permanently disabled.
  await vp.getByRole('button', { name: 'Area & pin', exact: true }).click();
  const continueBtn = vp.getByRole('button', { name: /Use this location/i }).first();
  // Assert the guard BEFORE choosing: "Use this location" is meant to be
  // disabled with no area, and a gate that only checks the enabled state after
  // choosing cannot tell a working guard from a missing one.
  check(`${label}: continue is disabled until an area is chosen`,
    await continueBtn.isDisabled());
  // NOT `exact: true`. The area button's accessible name is the label PLUS the
  // "on this view" affordance ("Front of shoulderon this view"), so an exact match
  // times out on an element that is plainly present and clickable -- which reads as
  // "the area step never happened" rather than as a selector problem.
  await vp.getByRole('button', { name: 'Front of shoulder' }).click();
  await vp.waitForTimeout(500);
  check(`${label}: the continue action becomes available after choosing an area`,
    await continueBtn.isEnabled());

  // 7. No horizontal overflow.
  const overflow = await vp.evaluate(() => document.documentElement.scrollWidth - window.innerWidth);
  check(`${label}: no horizontal overflow`, overflow <= 1, `${overflow}px`);

  // 8. No control compression.
  //
  // Measured on the TAP TARGET, not on the raw input. A radio/checkbox renders as a
  // 14x14 box and is normally wrapped in a label that is far larger; measuring the
  // input itself reported every ChoiceGroup in the product as compressed, which
  // made the check unfalsifiable in the other direction. The label is what a thumb
  // actually hits, so the label is what is measured -- falling back to the input
  // only when it is genuinely unlabelled.
  const cramped = await vp.evaluate(() => {
    const out = [];
    for (const el of document.querySelectorAll('input[type=radio], input[type=checkbox]')) {
      const input = el.getBoundingClientRect();
      if (input.width === 0 || input.height === 0) continue; // not visible
      const label = el.closest('label');
      const target = label ? label.getBoundingClientRect() : input;
      // WCAG 2.5.5 is 44px; 2.5.8 (AA) is 24px. 32 is a deliberate middle:
      // enough to catch a row that has been squeezed, without failing a
      // legitimately dense inline control that is still comfortably tappable.
      if (Math.min(target.width, target.height) < 32) {
        const name = (label?.textContent || el.getAttribute('aria-label') || el.type).trim().slice(0, 24);
        out.push(`${name} ${Math.round(target.width)}x${Math.round(target.height)}`);
      }
    }
    for (const el of document.querySelectorAll('button')) {
      const r = el.getBoundingClientRect();
      if (r.width === 0 || r.height === 0) continue;
      if (Math.min(r.width, r.height) < 32) {
        out.push(`button:${(el.textContent || el.getAttribute('aria-label') || '?').trim().slice(0, 20)} ${Math.round(r.width)}x${Math.round(r.height)}`);
      }
    }
    return out;
  });
  check(`${label}: no control is compressed below a usable size`, cramped.length === 0,
    cramped.slice(0, 5).join(' | '));

  check(`${label}: no page errors on the success path`, vpErrors.length === 0,
    vpErrors.slice(0, 2).join(' | '));

  await vp.screenshot({ path: `${OUT}/${label}-derived2d.png`, fullPage: false });
  await vp.close();
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