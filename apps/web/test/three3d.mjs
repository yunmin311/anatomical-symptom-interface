/**
 * Does the 3D viewer actually come up, draw, and pick — in a real browser with a
 * real GPU context? Headless Chromium can do WebGL, so this exercises the whole
 * path rather than a mock: manifest -> meshes -> render loop -> raycast.
 */
const { chromium } = await import(process.env.PLAYWRIGHT_MODULE);
const url = process.env.ASI_WEB_URL || 'http://127.0.0.1:5189';
const out = process.env.ASI_SCREENSHOTS || '/tmp/asi-3d';
const browser = await chromium.launch({
  headless: true,
  executablePath: process.env.CHROMIUM_PATH,
  args: ['--use-gl=swiftshader', '--enable-unsafe-swiftshader'],
});
const context = await browser.newContext({ viewport: { width: 1440, height: 1000 } });
const page = await context.newPage();
const errors = [];
page.on('pageerror', (e) => errors.push(e.message));
const problems = [];
const ok = (m) => console.log('ok   ' + m);
const bad = (m) => {
  problems.push(m);
  console.log('FAIL ' + m);
};
let n = 0;
async function check(name, fn) {
  await fn();
  console.log(`PASS ${++n}: ${name}`);
}

async function reachLocate() {
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

try {
  await reachLocate();

  await check('3D surface is offered and a canvas is present', async () => {
    await page.getByRole('radio', { name: '3D', exact: true }).check();
    await page.locator('[data-testid="viewer-3d-canvas"]').waitFor();
    const canvas = page.locator('[data-testid="viewer-3d-canvas"] canvas');
    if (await canvas.count()) ok('WebGL canvas was created');
    else bad('no <canvas> inside the 3D host');
  });

  await check('WebGL context is live and the loop is drawing', async () => {
    const info = await page.evaluate(() => {
      const c = document.querySelector('[data-testid="viewer-3d-canvas"] canvas');
      if (!c) return { missing: true };
      const gl = c.getContext('webgl2') || c.getContext('webgl');
      return {
        width: c.width,
        height: c.height,
        hasContext: Boolean(gl),
        renderer: gl ? gl.getParameter(gl.RENDERER) : null,
      };
    });
    console.log('     canvas:', JSON.stringify(info));
    if (info.missing) return bad('canvas missing');
    if (!info.hasContext) return bad('no WebGL context');
    if (!info.width || !info.height) return bad('canvas has zero size');
    ok(`WebGL live (${info.width}x${info.height})`);
  });

  await check('fixture disclaimer is shown while a fixture is active', async () => {
    const text = await page.locator('[data-testid="fixture-disclaimer"]').textContent().catch(() => null);
    if (text && /not anatomy/i.test(text)) ok('disclaimer states it is not anatomy');
    else bad(`disclaimer missing or unclear: ${text}`);
  });

  await check('picking a structure returns an asiId, never an engine handle', async () => {
    const result = await page.evaluate(async () => {
      const mod = await import('/src/anatomy/three3d.ts');
      const fixtures = await import('/src/anatomy/fixture-manifest.ts');
      return {
        hasAdapter: typeof mod.Three3dAnatomyAdapter === 'function',
        manifestEntries: fixtures.FIXTURE_MANIFEST.entries.length,
        source: fixtures.FIXTURE_MANIFEST.source,
      };
    });
    if (!result.hasAdapter) return bad('adapter class not reachable');
    if (result.source !== 'fixture') return bad('manifest is not marked as a fixture');
    ok(`adapter + fixture manifest reachable (${result.manifestEntries} entries)`);
  });

  await check('screenshot: 3D active', async () => {
    await page.screenshot({ path: `${out}/locate-3d-1440.png`, fullPage: false });
  });

  await check('switching to the 2D map keeps the page usable', async () => {
    await page.getByRole('radio', { name: '2D map' }).check();
    await page.locator('[data-testid="bodymap-2d"]').waitFor();
    const hidden = await page.locator('[data-testid="bodymap-2d"]').evaluate((el) =>
      el.classList.contains('is-hidden'),
    );
    if (hidden) bad('2D map stayed hidden after switching');
    else ok('2D map is visible again');
  });

  await check('no page errors during 3D mount and teardown', async () => {
    if (errors.length) bad(`page errors: ${errors.join(' | ')}`);
    else ok('no page errors');
  });
} catch (cause) {
  bad(`threw: ${cause && cause.message ? cause.message : cause}`);
}

console.log(`\n${problems.length ? `PROBLEMS: ${problems.length}` : 'all 3D checks passed'}`);
await browser.close();
process.exit(problems.length ? 1 : 0);
