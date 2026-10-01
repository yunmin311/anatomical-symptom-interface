/**
 * The 3D viewer must never be a precondition for using Locate.
 *
 * Every failure path has to land on the 2D map with the record intact and a
 * sentence explaining why. These cases force the failures rather than hoping for
 * them: no WebGL, a mount that throws, and a GPU context lost after the viewer
 * is already up.
 */
const { chromium } = await import(process.env.PLAYWRIGHT_MODULE);
const url = process.env.ASI_WEB_URL || 'http://127.0.0.1:5189';
const browser = await chromium.launch({
  headless: true,
  executablePath: process.env.CHROMIUM_PATH,
  args: ['--use-gl=swiftshader', '--enable-unsafe-swiftshader'],
});
const problems = [];
const ok = (m) => console.log('ok   ' + m);
const bad = (m) => {
  problems.push(m);
  console.log('FAIL ' + m);
};

async function open(context) {
  const page = await context.newPage();
  page.on('pageerror', (e) => bad(`page error: ${e.message}`));
  await page.goto(url);
  await page
    .getByLabel('What has been bothering you?')
    .fill('my right shoulder rotator cuff hurts deep inside');
  await page.getByRole('button', { name: 'Locate on body map' }).click();
  await page.locator('.location-workbench, .empty-state').waitFor();
  if (await page.getByRole('button', { name: 'Show me the body map' }).isVisible())
    await page.getByRole('button', { name: 'Show me the body map' }).click();
  await page.locator('.location-workbench').waitFor();
  return page;
}

/** Switch surface only if it is not already selected; the radios re-render. */
async function ensureSurface(page, name) {
  const radio = page.getByRole('radio', { name, exact: true });
  if ((await radio.count()) === 0) return;
  if (await radio.isChecked().catch(() => false)) return;
  await radio.check({ timeout: 10000 });
}

/** The Locate flow must still be completable on the 2D map alone. */
async function canCompleteLocate(page, label) {
  await ensureSurface(page, '2D map');
  const option = page.locator('.subregion-option', { hasText: 'Front of shoulder' });
  if (!(await option.count())) return bad(`${label}: no area buttons to fall back to`);
  await option.first().click();
  const continueBtn = page.getByRole('button', { name: /Use this location/ });
  if (await continueBtn.isDisabled()) return bad(`${label}: continue stayed disabled`);
  await continueBtn.click();
  try {
    await page.locator('.interview-panel form').waitFor({ timeout: 8000 });
    ok(`${label}: Locate completed on the 2D map`);
  } catch {
    bad(`${label}: could not reach the interview from the 2D map`);
  }
}

// ---- 1. the 3D viewer is offered and works when the GPU is fine -----------
{
  const context = await browser.newContext({ viewport: { width: 1440, height: 1000 } });
  const page = await open(context);
  // On a wide viewport 3D is the default, so wait for the canvas rather than
  // clicking a radio that is already selected and re-rendering underneath us.
  await page.locator('[data-testid="viewer-3d-canvas"] canvas').first().waitFor({ timeout: 15000 });
  const status = await page.locator('[data-testid="viewer-status"]').textContent();
  if (/3D viewer active/i.test(status || '')) ok('3D mounts and reports active');
  else bad(`3D status unexpected: ${status}`);
  const canvases = await page.locator('[data-testid="viewer-3d-canvas"] canvas').count();
  if (canvases === 1) ok('exactly one canvas, so no leaked viewer');
  else bad(`${canvases} canvases: a viewer was leaked`);
  await context.close();
}

// ---- 2. mount failure falls back ------------------------------------------
{
  const context = await browser.newContext({ viewport: { width: 1440, height: 1000 } });
  // Force the renderer factory to fail, which is the same code path a missing
  // GPU takes. Registered on the context so it is in place before navigation.
  await context.addInitScript(() => {
    const original = HTMLCanvasElement.prototype.getContext;
    HTMLCanvasElement.prototype.getContext = function patched(type, ...rest) {
      if (type === 'webgl' || type === 'webgl2' || type === 'experimental-webgl')
        return null;
      return original.call(this, type, ...rest);
    };
  });
  const page = await open(context);
  await page.waitForTimeout(2500);
  const banner = await page.locator('[data-testid="viewer-fallback"]').textContent().catch(() => null);
  if (banner && /body map/i.test(banner)) ok(`fallback explained: "${banner.trim()}"`);
  else bad(`no fallback explanation shown (got ${banner})`);
  const mapVisible = await page.locator('[data-testid="bodymap-2d"]').isVisible();
  if (mapVisible) ok('the 2D map is visible after a 3D failure');
  else bad('2D map is not visible after a 3D failure: blank screen');
  await canCompleteLocate(page, 'no-webgl');
  await context.close();
}

// ---- 3. context lost after the viewer is up -------------------------------
{
  const context = await browser.newContext({ viewport: { width: 1440, height: 1000 } });
  const page = await open(context);
  await page.locator('[data-testid="viewer-3d-canvas"] canvas').first().waitFor({ timeout: 15000 });
  await page.evaluate(() => {
    const canvas = document.querySelector('[data-testid="viewer-3d-canvas"] canvas');
    canvas.dispatchEvent(new Event('webglcontextlost', { cancelable: true }));
  });
  await page.waitForTimeout(800);
  const banner = await page.locator('[data-testid="viewer-fallback"]').textContent().catch(() => null);
  if (banner && /body map/i.test(banner)) ok(`context loss explained: "${banner.trim()}"`);
  else bad(`context loss not explained (got ${banner})`);
  const mapVisible = await page.locator('[data-testid="bodymap-2d"]').isVisible();
  if (mapVisible) ok('the 2D map takes over after a context loss');
  else bad('2D map did not take over after a context loss');
  await canCompleteLocate(page, 'context-lost');
  await context.close();
}

// ---- 4. an explicit user choice of 2D is honoured -------------------------
{
  const context = await browser.newContext({ viewport: { width: 1440, height: 1000 } });
  const page = await open(context);
  await ensureSurface(page, '2D map');
  await page.waitForTimeout(600);
  const canvases = await page.locator('[data-testid="viewer-3d-canvas"] canvas').count();
  if (canvases === 0) ok('choosing the 2D map does not spin up a GPU context');
  else bad(`${canvases} canvases created despite choosing 2D`);
  await context.close();
}

console.log(`\n${problems.length ? `PROBLEMS: ${problems.length}` : 'all fallback checks passed'}`);
await browser.close();
process.exit(problems.length ? 1 : 0);
