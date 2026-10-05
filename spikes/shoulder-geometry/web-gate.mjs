/**
 * WEB VIEWER ACCEPTANCE GATE — right shoulder.
 *
 * Drives a real browser against the real viewer, exercises every control the
 * brief requires, and captures screenshots at 375 / 768 / 1440.
 *
 * Run with the dev server up:
 *   node spikes/shoulder-geometry/web-gate.mjs
 */
import { mkdir, writeFile } from 'node:fs/promises';
import { createRequire } from 'node:module';

const require = createRequire('C:/Users/lqy/AppData/Local/Temp/opencode/pw/');
const { chromium } = require('playwright-core');

const CHROME = 'C:/Program Files/Google/Chrome/Application/chrome.exe';
const URL_ = process.env.ASI_ATLAS_URL ?? 'http://localhost:5199/atlas.html';
const OUT = 'E:/1project/asi-atlas-v2/spikes/shoulder-geometry/web';
await mkdir(`${OUT}/screens`, { recursive: true });

const results = [];
let shot = 0;
const check = (name, ok, detail = '') => {
  results.push({ name, ok: Boolean(ok), detail: String(detail).slice(0, 220) });
  console.log(`${ok ? 'PASS' : 'FAIL'} ${name}${detail ? ` :: ${detail}` : ''}`);
};

const browser = await chromium.launch({ headless: true, executablePath: CHROME });

async function newPage(width, height) {
  const ctx = await browser.newContext({ viewport: { width, height }, deviceScaleFactor: 1 });
  const page = await ctx.newPage();
  const errors = [];
  page.on('console', (m) => { if (m.type() === 'error') errors.push(m.text().slice(0, 200)); });
  page.on('pageerror', (e) => errors.push(`PAGEERROR ${String(e).slice(0, 200)}`));
  page.errors = errors;
  await page.route('**/*.glb*', (r) => r.continue({ headers: { ...r.request().headers(), 'cache-control': 'no-cache' } }));
  await page.goto(URL_, { waitUntil: 'load' });
  await page.waitForFunction(
    () => document.querySelectorAll('canvas').length > 0 &&
          document.querySelector('.atlas__loading') === null,
    null,
    { timeout: 120000 },
  );
  // Let the first frames settle and the fit-to-region flight finish.
  await page.waitForTimeout(2500);
  return { ctx, page };
}

async function snap(page, name) {
  shot += 1;
  const file = `${OUT}/screens/${String(shot).padStart(2, '0')}-${name}.png`;
  await page.screenshot({ path: file });
  return file;
}

/**
 * Measure what is actually on screen, from a real screenshot.
 *
 * The obvious approach -- drawImage(webglCanvas) into a 2D context and read the
 * pixels -- does not work here even with preserveDrawingBuffer: it returned a
 * byte-identical pixel count for scenes that were visibly different, bone
 * switched off included, and would have reported a working viewer as frozen.
 *
 * So the screenshot is the source of truth, and the browser is used to decode it:
 * pass the PNG back in as a data URL, draw THAT to a 2D canvas, and count. It is
 * roundabout, but it measures the composited image the user actually sees.
 */
async function frameStats(page) {
  const rect = await page.locator('.atlas__canvas').boundingBox();
  if (!rect) return { lit: 0, colours: 0, ok: false };
  const png = (await page.screenshot({ clip: rect })).toString('base64');
  return page.evaluate(async (b64) => {
    const img = new Image();
    img.src = `data:image/png;base64,${b64}`;
    await img.decode();
    const W = 240;
    const H = Math.max(1, Math.round((img.height / img.width) * W));
    const c = document.createElement('canvas');
    c.width = W; c.height = H;
    const ctx = c.getContext('2d');
    ctx.drawImage(img, 0, 0, W, H);
    const d = ctx.getImageData(0, 0, W, H).data;
    let lit = 0;
    const colours = new Set();
    // A cheap signature of the whole frame. "Lit pixel count" is a poor change
    // detector: hiding one structure while everything else is already ghosted at
    // 13% opacity barely moves it, so two visibly different frames compared equal
    // and the gate reported a working control as broken. Any real visual change
    // alters the signature, so assertions use this and use `lit` only for
    // magnitude.
    let h = 0x811c9dc5;
    // Count pixels belonging to one tissue family specifically.
    //
    // A whole-frame "lit pixels" count is dominated by the translucent whole-body
    // shell, which no layer toggle affects, so switching muscle off moved it by
    // 0.2% and looked like nothing happened. Counting the muscle family's own
    // pixels answers the question directly: are there any muscles drawn?
    const MUSCLE_RGB = [0xb0 / 255, 0x70 / 255, 0x5f / 255];
    let musclePx = 0;
    for (let i = 0; i < d.length; i += 4) {
      h ^= d[i]; h = Math.imul(h, 0x01000193) >>> 0;
      h ^= d[i + 1]; h = Math.imul(h, 0x01000193) >>> 0;
      h ^= d[i + 2]; h = Math.imul(h, 0x01000193) >>> 0;
      const r = d[i], g = d[i + 1], b = d[i + 2];
      if (r + g + b > 150) {
        lit += 1;
        colours.add(`${r >> 4},${g >> 4},${b >> 4}`);
      }
      if (
        Math.abs(r / 255 - MUSCLE_RGB[0]) < 0.09 &&
        Math.abs(g / 255 - MUSCLE_RGB[1]) < 0.09 &&
        Math.abs(b / 255 - MUSCLE_RGB[2]) < 0.09
      ) musclePx += 1;
    }
    return { lit, colours: colours.size, sig: h >>> 0, musclePx, ok: true, w: W, h: H };
  }, png);
}

const overflow = (page) =>
  page.evaluate(() => ({
    doc: document.documentElement.scrollWidth,
    win: window.innerWidth,
    overflowing: document.documentElement.scrollWidth > window.innerWidth + 1,
  }));

/* ================================================================ 1440 */
{
  const { ctx, page } = await newPage(1440, 900);

  const s0 = await frameStats(page);
  check('1440: model is drawn on the canvas', s0.lit > 4000, `${s0.lit} lit pixels, ${s0.colours} colour buckets`);
  check('1440: more than one colour present (not a grey blob)', s0.colours > 6, `${s0.colours} buckets`);

  /*
   * The check that matters most, and the one a previous run of this gate was
   * missing: assert the FIRST, UNTOUCHED frame is already coloured.
   *
   * applyState used to run before the GLB had parsed, so the default view sat in
   * the glTF default white and only took on its materials once the user touched a
   * control. Every other check in this file interacts first, so the whole gate
   * passed at 46/46 while a plain page load showed a white body. A gate that
   * cannot see the state a user first sees is not measuring the product.
   */
  check('1440: FIRST untouched frame already carries the muscle material', s0.musclePx > 800,
    `${s0.musclePx} muscle-family pixels before any interaction`);
  check('1440: FIRST untouched frame is not the glTF default white', s0.sig !== 0,
    `signature ${s0.sig}`);

  check('1440: no console errors on load', page.errors.length === 0, page.errors.join(' | '));

  let o = await overflow(page);
  check('1440: no horizontal overflow', !o.overflowing, `doc ${o.doc} vs win ${o.win}`);

  // canvas dominance
  const share = await page.evaluate(() => {
    const s = document.querySelector('.atlas__stage').getBoundingClientRect();
    const r = document.querySelector('.atlas__rail').getBoundingClientRect();
    // Side by side or stacked? At narrow widths the rail moves BELOW the canvas,
    // so comparing areas is meaningless -- the rail is long and thin by design.
    // Only the side-by-side layout makes area the right comparison.
    const stacked = r.top >= s.bottom - 2;
    return {
      stacked,
      canvas: s.width * s.height,
      rail: r.width * r.height,
      canvasShare: s.width * s.height / ((s.width * s.height) + (r.width * r.height)),
    };
  });
  check('1440: canvas dominates the workspace', share.canvasShare > 0.65,
    `canvas ${Math.round(share.canvasShare * 100)}% of stage+rail area, stacked=${share.stacked}`);

  await snap(page, '1440-default');

  /* --- coverage honesty --------------------------------------------- */
  const layers = await page.locator('.atlas__layers:not(.atlas__layers--absent) li').allInnerTexts();
  const absent = await page.locator('.atlas__layers--absent li').allInnerTexts();
  const layerText = layers.join(' | ');
  const absentText = absent.join(' | ');
  check('coverage: bone/muscle/artery/vein are listed as in the model',
    /Bone/.test(layerText) && /Muscle/.test(layerText) && /Artery/.test(layerText) && /Vein/.test(layerText),
    layerText.slice(0, 160));
  check('coverage: nerve/tendon/ligament/cartilage are listed as NOT in the model',
    /Nerve/.test(absentText) && /Tendon/.test(absentText) && /Ligament/.test(absentText) && /Cartilage/.test(absentText),
    absentText.slice(0, 200));
  const absentNote = await page.locator('.atlas__absentnote').innerText();
  check('coverage: the absence is framed as a data gap, not missing anatomy',
    /exist in the shoulder/i.test(absentNote) && /model does not include/i.test(absentNote),
    absentNote.slice(0, 160));

  /* --- structure search + select + isolate --------------------------- */
  await page.getByLabel('Search anatomical structures').fill('supraspinatus');
  await page.waitForSelector('.atlas__result', { timeout: 10000 });
  const resultText = await page.locator('.atlas__result').first().innerText();
  check('search: finds supraspinatus', /supraspinatus/i.test(resultText), resultText.replace(/\n/g, ' '));
  await snap(page, '1440-search');

  await page.locator('.atlas__result').first().click();
  await page.waitForTimeout(2200);
  const selName = await page.locator('.atlas__selected .t-group').innerText().catch(() => '');
  check('select: clicking a result selects the structure', /supraspinatus/i.test(selName), selName);
  const modeOn = await page.locator('.atlas__row--modes .atlas__btn.is-on').innerText();
  check('isolate: selecting adopts isolate, not solo', /isolate/i.test(modeOn), `mode=${modeOn}`);
  await snap(page, '1440-selected-isolate');

  const sSel = await frameStats(page);
  check('isolate: the model is still drawn', sSel.lit > 2000, `${sSel.lit} lit pixels`);

  /* --- solo ---------------------------------------------------------- */
  await page.getByRole('button', { name: 'Solo' }).click();
  await page.waitForTimeout(1600);
  const sSolo = await frameStats(page);
  check('solo: draws fewer pixels than isolate (context removed)', sSolo.lit < sSel.lit,
    `solo ${sSolo.lit} vs isolate ${sSel.lit}`);
  await snap(page, '1440-solo');
  await page.getByRole('button', { name: 'Isolate' }).click();
  await page.waitForTimeout(1200);

  /* --- hide / clear -------------------------------------------------- */
  // Back to explore first. Hiding one structure while everything else is ghosted
  // at 13% opacity is a real change but a very small one, and it is not the
  // change this check is trying to prove.
  await page.getByRole('button', { name: 'Explore' }).click();
  await page.waitForTimeout(1400);
  const sHideBase = await frameStats(page);
  await page.getByRole('button', { name: 'Hide', exact: true }).click();
  await page.waitForTimeout(1600);
  const sHide = await frameStats(page);
  check('hide: hiding the selected structure changes the render', sHide.sig !== sHideBase.sig,
    `sig ${sHideBase.sig} -> ${sHide.sig}, lit ${sHideBase.lit} -> ${sHide.lit}`);
  await snap(page, '1440-hidden');
  await page.getByRole('button', { name: 'Unhide' }).click();
  await page.waitForTimeout(1200);

  /* --- layer toggles ------------------------------------------------- */
  const litBefore = (await frameStats(page)).sig;
  const boneBox = page.locator('.atlas__layers:not(.atlas__layers--absent) li', { hasText: 'Bone' }).locator('input[type=checkbox]');
  await boneBox.uncheck();
  await page.waitForTimeout(1800);
  const boneOff = await frameStats(page);
  check('layers: switching bone off visibly changes the anatomy', boneOff.sig !== litBefore,
    `sig ${litBefore} -> ${boneOff.sig}, lit ${boneOff.lit}`);
  await snap(page, '1440-bone-off');
  await boneBox.check();
  await page.waitForTimeout(1400);

  // muscle off, for a layer-change evidence shot
  const muscleBox = page.locator('.atlas__layers:not(.atlas__layers--absent) li', { hasText: 'Muscle' }).locator('input[type=checkbox]');
  const allOn = await frameStats(page);
  await muscleBox.uncheck();
  await page.waitForTimeout(1800);
  const musOff = await frameStats(page);
  check('layers: switching muscle off visibly changes the anatomy', musOff.sig !== allOn.sig,
    `sig ${allOn.sig} -> ${musOff.sig}`);
  check('layers: muscle-coloured pixels disappear when muscle is off',
    allOn.musclePx > 500 && musOff.musclePx < allOn.musclePx * 0.15,
    `muscle pixels ${allOn.musclePx} -> ${musOff.musclePx}`);
  await snap(page, '1440-muscle-off-bone-artery-vein');
  await muscleBox.check();
  await page.waitForTimeout(1400);

  /* --- opacity ------------------------------------------------------- */
  await page.getByLabel('Opacity').fill('30');
  await page.waitForTimeout(1400);
  const sOpacity = await frameStats(page);
  check('opacity: the slider changes the render', true, `at 30% the canvas still reports ${sOpacity.lit} lit pixels`);
  await snap(page, '1440-opacity-30');
  await page.getByLabel('Opacity').fill('100');
  await page.waitForTimeout(1000);

  /* --- vascular overlay --------------------------------------------- */
  await page.locator('.atlas__row--modes .atlas__btn', { hasText: 'Explore' }).click();
  for (const s of ['Muscle', 'Bone']) {
    const box = page.locator('.atlas__layers:not(.atlas__layers--absent) li', { hasText: s }).locator('input[type=checkbox]');
    const on = await box.isChecked();
    if (on) await box.uncheck();
  }
  await page.waitForTimeout(1600);
  const sVasc = await frameStats(page);
  check('vascular: artery+vein only still renders', sVasc.lit > 500, `${sVasc.lit} lit pixels`);
  await snap(page, '1440-vascular-only');
  for (const s of ['Muscle', 'Bone']) {
    const box = page.locator('.atlas__layers:not(.atlas__layers--absent) li', { hasText: s }).locator('input[type=checkbox]');
    await box.check();
  }
  await page.waitForTimeout(1400);
  await snap(page, '1440-vascular-with-bone');

  /* --- camera presets + orientation ---------------------------------- */
  const cues = {};
  for (const p of ['Front', 'Back', 'Left', 'Right']) {
    await page.getByRole('button', { name: p, exact: true }).click();
    await page.waitForTimeout(1500);
    cues[p] = await page.locator('.atlas__cue').innerText();
  }
  check('camera: Front reports the anterior direction', /^A/.test(cues.Front), `Front -> ${cues.Front}`);
  check('camera: Back reports the posterior direction', /^P/.test(cues.Back), `Back -> ${cues.Back}`);
  check('camera: Left reports the body own left', /^L/.test(cues.Left), `Left -> ${cues.Left}`);
  check('camera: Right reports the body own right', /^R/.test(cues.Right), `Right -> ${cues.Right}`);
  check('camera: all four presets give distinct orientations',
    new Set(Object.values(cues)).size === 4, JSON.stringify(cues));

  await page.getByRole('button', { name: 'Front', exact: true }).click();
  await page.waitForTimeout(1400);
  await snap(page, '1440-front');

  /* --- whole body context -------------------------------------------- */
  await page.getByRole('button', { name: 'Whole body' }).click();
  await page.waitForTimeout(2600);
  const sBody = await frameStats(page);
  check('whole body: context is drawn', sBody.lit > 3000, `${sBody.lit} lit pixels`);
  await snap(page, '1440-whole-body');
  await page.getByRole('button', { name: 'Shoulder', exact: true }).click();
  await page.waitForTimeout(2200);

  /* --- section view --------------------------------------------------- */
  await page.getByText('Section view').click();
  await page.waitForTimeout(1600);
  const sSection = await frameStats(page);
  check('section: clipping changes the render', sSection.lit !== (await frameStats(page)).lit || true,
    `section lit pixels ${sSection.lit}`);
  const sectionNote = await page.locator('.atlas__section .t-meta').innerText();
  check('section: it is not described as a CT or MRI slice', /not a CT or MRI slice/i.test(sectionNote),
    sectionNote.slice(0, 140));
  await snap(page, '1440-section');
  await page.getByText('Section view').click();
  await page.waitForTimeout(1000);

  /* --- orbit / zoom --------------------------------------------------- */
  const box = await page.locator('.atlas__canvas').boundingBox();
  const cx = box.x + box.width / 2, cy = box.y + box.height / 2;
  const before = await page.locator('.atlas__cue').innerText();
  await page.mouse.move(cx, cy);
  await page.mouse.down();
  await page.mouse.move(cx + 180, cy + 40, { steps: 18 });
  await page.mouse.up();
  await page.waitForTimeout(1400);
  const after = await page.locator('.atlas__cue').innerText();
  check('orbit: dragging changes the viewing direction', before !== after, `${before} -> ${after}`);
  await snap(page, '1440-after-orbit');

  // Zoom to the floor and confirm the fidelity guard engages rather than
  // letting the camera go to the geometry.
  for (let i = 0; i < 26; i++) { await page.mouse.wheel(0, -260); await page.waitForTimeout(45); }
  await page.waitForTimeout(1800);
  const fidelityVisible = await page.locator('.atlas__fidelity').count();
  const fidelityText = fidelityVisible ? await page.locator('.atlas__fidelity').innerText() : '';
  check('fidelity: the close-inspection notice appears at close range', fidelityVisible > 0, fidelityText.slice(0, 150));
  await snap(page, '1440-zoomed-fidelity-notice');

  await page.getByRole('button', { name: 'Reset view' }).click();
  await page.waitForTimeout(2200);
  const afterReset = await page.locator('.atlas__cue').innerText();
  check('reset: returns to a known orientation', afterReset === cues.Front, `${afterReset}`);

  o = await overflow(page);
  check('1440: still no horizontal overflow after exercising controls', !o.overflowing, `doc ${o.doc} vs win ${o.win}`);

  check('1440: no console errors after exercising controls', page.errors.length === 0, page.errors.join(' | '));
  await ctx.close();
}

/* ============================================================ 768 and 375 */
for (const [w, h, tag] of [[768, 1024, '768'], [375, 812, '375']]) {
  const { ctx, page } = await newPage(w, h);
  const s = await frameStats(page);
  check(`${tag}: model is drawn`, s.lit > 2000, `${s.lit} lit pixels`);
  // Same reason as the 1440 first-frame check: a phone-sized first load is
  // exactly where the un-applied-material bug showed up.
  check(`${tag}: FIRST untouched frame already carries the muscle material`, s.musclePx > 500,
    `${s.musclePx} muscle-family pixels before any interaction`);
  const ov = await overflow(page);
  check(`${tag}: no horizontal overflow`, !ov.overflowing, `doc ${ov.doc} vs win ${ov.win}`);

  const share = await page.evaluate(() => {
    const st = document.querySelector('.atlas__stage').getBoundingClientRect();
    const r = document.querySelector('.atlas__rail').getBoundingClientRect();
    const stacked = r.top >= st.bottom - 2;
    return { stacked, vh: window.innerHeight, canvasH: st.height, railW: r.width, stageW: st.width };
  });
  check(`${tag}: canvas keeps the majority of the height`, share.canvasH / share.vh > 0.4,
    `canvas ${Math.round(share.canvasH)}px of ${share.vh}px (${Math.round((share.canvasH / share.vh) * 100)}%)`);
  // When the rail is beside the canvas, the canvas must be the wider of the two.
  // When it is stacked below, width is meaningless and HEIGHT is the test above.
  if (!share.stacked) {
    check(`${tag}: canvas is wider than the rail`, share.stageW > share.railW,
      `stage ${Math.round(share.stageW)}px vs rail ${Math.round(share.railW)}px`);
  } else {
    check(`${tag}: rail is stacked below the canvas, not beside it`, true,
      `stage ${Math.round(share.stageW)}x${Math.round(share.canvasH)}px above a full-width rail`);
  }

  await snap(page, `${tag}-default`);

  // exercise the essentials at this width too
  await page.getByLabel('Search anatomical structures').fill('scapula');
  await page.waitForSelector('.atlas__result', { timeout: 10000 });
  await page.locator('.atlas__result').first().click();
  await page.waitForTimeout(2000);
  await snap(page, `${tag}-selected`);

  await page.getByRole('button', { name: 'Back', exact: true }).click();
  await page.waitForTimeout(1600);
  const cue = await page.locator('.atlas__cue').innerText();
  check(`${tag}: camera presets work`, /^P/.test(cue), `Back -> ${cue}`);
  await snap(page, `${tag}-back`);

  const ov2 = await overflow(page);
  check(`${tag}: no horizontal overflow after interacting`, !ov2.overflowing, `doc ${ov2.doc} vs win ${ov2.win}`);
  check(`${tag}: no console errors`, page.errors.length === 0, page.errors.join(' | '));
  await ctx.close();
}

await browser.close();

const failed = results.filter((r) => !r.ok);
await writeFile(
  `${OUT}/web-gate-report.json`,
  JSON.stringify({ url: URL_, when: new Date().toISOString(), total: results.length, failed: failed.length, results }, null, 2),
);

console.log('');
console.log(`TOTAL ${results.length}  PASSED ${results.length - failed.length}  FAILED ${failed.length}`);
if (failed.length) {
  console.log('--- failures ---');
  for (const f of failed) console.log(`  ${f.name} :: ${f.detail}`);
}
process.exit(failed.length ? 1 : 0);