/**
 * Phase 1A evidence capture: the states this phase is actually about, at every
 * width, so the anatomy workspace can be reviewed without re-running anything.
 * The 3D and fallback captures are the reason this file exists separately from
 * browser.mjs: those states only exist in a real browser with a real GPU.
 */
const { chromium } = await import(process.env.PLAYWRIGHT_MODULE);
const url = process.env.ASI_WEB_URL || 'http://127.0.0.1:5189';
const out = process.env.ASI_SCREENSHOTS || '/tmp/asi-phase1';
const browser = await chromium.launch({
  headless: true,
  executablePath: process.env.CHROMIUM_PATH,
  args: ['--use-gl=swiftshader', '--enable-unsafe-swiftshader'],
});

let n = 0;
const problems = [];

async function reachLocate(page) {
  await page.goto(url);
  await page
    .getByLabel('What has been bothering you?')
    .fill('my right shoulder rotator cuff hurts deep inside');
  await page.getByRole('button', { name: 'Locate on body map' }).click();
  await page.locator('.location-workbench, .empty-state').waitFor();
  if (await page.getByRole('button', { name: 'Show me the body map' }).isVisible())
    await page.getByRole('button', { name: 'Show me the body map' }).click();
  await page.locator('.location-workbench').waitFor();
}

async function shot(page, name) {
  await page.screenshot({ path: `${out}/${name}.png`, fullPage: true });
  const overflow = await page.evaluate(
    () => document.documentElement.scrollWidth > window.innerWidth,
  );
  if (overflow) problems.push(`${name}: horizontal overflow`);
  n += 1;
  console.log(`shot ${name}`);
}

for (const width of [1440, 768, 375]) {
  const context = await browser.newContext({
    viewport: { width, height: width === 375 ? 812 : 1000 },
  });
  const page = await context.newPage();
  page.on('pageerror', (e) => problems.push(`[${width}] page error: ${e.message}`));

  // 2D map, the default on a phone and the fallback everywhere.
  await reachLocate(page);
  await page.locator('.subregion-option', { hasText: 'Front of shoulder' }).first().click();
  await shot(page, `p1-locate-2d-${width}`);

  // Every view, so the per-view silhouettes are reviewable.
  for (const view of ['Back', 'Left side', 'Right side']) {
    const radio = page.getByRole('radio', { name: view, exact: true });
    if (await radio.count()) {
      await radio.check();
      await page.waitForTimeout(250);
      await shot(page, `p1-view-${view.toLowerCase().replace(' ', '-')}-${width}`);
    }
  }
  await page.getByRole('radio', { name: 'Front', exact: true }).check();

  // Depth driving the viewer's layer visibility.
  //
  // Checked BEFORE touching the control: localisation can carry a depth out of
  // the user's own words ("hurts deep inside"), and the viewer must already
  // agree with the record rather than waiting for the control to be used.
  await page.getByRole('button', { name: 'Side & depth' }).click();
  const group = page.getByRole('group', { name: 'Where does it feel?' });
  const layersNow = () =>
    page
      .locator('[data-testid^="visible-layer-"]')
      .evaluateAll((els) => els.map((e) => e.getAttribute('data-testid').replace('visible-layer-', '')));
  const fromLocalisation = await layersNow();
  const depthChecked = await group
    .locator('input[type=radio]:checked')
    .evaluate((el) => el.parentElement?.textContent?.trim() ?? '');
  if (depthChecked === 'Deep inside' && fromLocalisation.includes('skin'))
    problems.push(
      `[${width}] localisation said "deep inside" but the viewer still showed every layer: ${fromLocalisation.join(',')}`,
    );
  if (depthChecked === 'Deep inside' && !fromLocalisation.includes('bone'))
    problems.push(`[${width}] deep depth did not expose a deep layer: ${fromLocalisation.join(',')}`);

  const deep = group.getByLabel('Deep inside');
  if (await deep.count()) {
    if (!(await deep.isChecked())) await deep.check();
    try {
      await page
        .locator('[data-testid="visible-layer-skin"]')
        .waitFor({ state: 'detached', timeout: 5000 });
    } catch {
      problems.push(`[${width}] deep depth still showed the skin layer`);
    }
    await shot(page, `p1-depth-deep-${width}`);
  }
  await page.getByRole('button', { name: 'Area & pin' }).click();

  // The 3D surface, where the device can run it.
  const threeD = page.getByRole('radio', { name: '3D', exact: true });
  if (await threeD.count()) {
    if (!(await threeD.isChecked())) await threeD.check();
    const canvas = page.locator('[data-testid="viewer-3d-canvas"] canvas').first();
    if (await canvas.count()) {
      await page.waitForTimeout(900);
      await shot(page, `p1-locate-3d-${width}`);
    } else {
      problems.push(`[${width}] 3D offered but no canvas`);
    }
  }

  await context.close();
}

// The fallback state, at desktop width, with WebGL removed.
{
  const context = await browser.newContext({ viewport: { width: 1440, height: 1000 } });
  await context.addInitScript(() => {
    const original = HTMLCanvasElement.prototype.getContext;
    HTMLCanvasElement.prototype.getContext = function patched(type, ...rest) {
      if (type === 'webgl' || type === 'webgl2' || type === 'experimental-webgl')
        return null;
      return original.call(this, type, ...rest);
    };
  });
  const page = await context.newPage();
  await reachLocate(page);
  await page.waitForTimeout(2200);
  const banner = await page.locator('[data-testid="viewer-fallback"]').textContent().catch(() => null);
  if (!banner) problems.push('fallback: no explanation shown');
  if (!(await page.locator('[data-testid="bodymap-2d"]').isVisible()))
    problems.push('fallback: 2D map not visible');
  await shot(page, 'p1-fallback-no-webgl-1440');
  await context.close();
}

// The health map with its location marks.
{
  const context = await browser.newContext({ viewport: { width: 1440, height: 1000 } });
  const page = await context.newPage();
  await page.goto(url);
  await page.getByRole('button', { name: /Personal health map/ }).click();
  await page.locator('.healthmap-index').waitFor();
  const marks = await page.locator('.location-mark').count();
  if (marks === 0) problems.push('health map: no location marks');
  else console.log(`health map: ${marks} location marks`);
  await shot(page, 'p1-healthmap-marks-1440');
  await context.close();
}

console.log(`\n${n} screenshots captured`);
if (problems.length) {
  console.log('PROBLEMS:');
  for (const p of problems) console.log('  ' + p);
}
await browser.close();
process.exit(problems.length ? 1 : 0);
