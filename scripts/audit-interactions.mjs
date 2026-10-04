/**
 * Two interaction probes the screenshot pass cannot answer.
 *
 * 1. SELECTION CONTINUITY. Returning to Locate after committing an area: the 2D
 *    map shows the recorded area, but does the receipt agree, and is the primary
 *    action usable? A screenshot shows one frame; this shows the disagreement.
 *
 * 2. 3D AT MOBILE. `defaultSurface()` returns 2D below 900px. Does choosing 3D
 *    actually work at 375, or is the control a dead end?
 */
import { mkdirSync } from 'node:fs';
import { join } from 'node:path';

const { chromium } = await import(process.env.PLAYWRIGHT_MODULE);
const BASE = process.env.ASI_WEB_URL ?? 'http://127.0.0.1:5277';
const OUT = process.argv[2] ?? '/tmp/asi-audit-shots';
mkdirSync(OUT, { recursive: true });

const browser = await chromium.launch({
  headless: true,
  executablePath: process.env.CHROMIUM_PATH,
  args: ['--use-gl=swiftshader', '--enable-unsafe-swiftshader'],
});

const log = (...args) => console.log(...args);

/* ---------- 1. selection continuity ---------- */
{
  const ctx = await browser.newContext({ viewport: { width: 1440, height: 1000 } });
  const page = await ctx.newPage();
  await page.goto(BASE, { waitUntil: 'networkidle' });
  await page
    .getByLabel('What has been bothering you?')
    .fill('my right shoulder rotator cuff hurts deep inside when I lift my arm');
  await page.getByRole('button', { name: 'Locate on body map' }).click();
  await page.locator('.location-workbench').waitFor();
  const clarify = page.getByRole('button', { name: 'Show me the body map' });
  if (await clarify.isVisible().catch(() => false)) await clarify.click();

  // Select a structure FIRST: it has to happen while the workspace is still on
  // screen, and it must survive the round trip through the interview.
  await page.locator('.inspector-switch button', { hasText: 'Structures' }).click();
  await page.waitForTimeout(300);
  const indicate = page.getByRole('button', { name: 'Indicate this structure' }).first();
  if (await indicate.count()) {
    await indicate.click();
    await page.waitForTimeout(300);
    log('selected a structure');
  } else {
    log('NO structure candidate offered for this description');
  }

  await page.locator('.inspector-switch button', { hasText: 'Area' }).click();
  await page.waitForTimeout(200);
  await page.locator('.subregion-option').first().click();
  await page.waitForTimeout(200);
  await page.getByRole('button', { name: /Use this location/ }).click();
  await page.locator('.interview-panel, .empty-state').first().waitFor();
  log('committed area, now in interview');

  // Answer one question so there is something to come back from.
  const opt = page.locator('.answer-option input').first();
  if (await opt.count()) {
    await opt.check();
    await page.getByRole('button', { name: 'Continue' }).click();
    await page.waitForTimeout(300);
  }

  const before = await page.evaluate(() => ({
    receipt: document.querySelector('[data-testid="selection-receipt"]')?.textContent?.trim(),
  }));
  log('interview sidebar:', JSON.stringify(before));

  await page.getByRole('button', { name: 'Adjust location' }).click();
  await page.locator('.location-workbench').waitFor();
  await page.waitForTimeout(800);

  const returned = await page.evaluate(() => {
    const zone = document.querySelector('.bodymap__zone-shape.is-recorded');
    const activeZone = document.querySelector('.bodymap__zone-shape.is-active');
    const pressed = [...document.querySelectorAll('.subregion-option')]
      .filter((b) => b.getAttribute('aria-pressed') === 'true')
      .map((b) => b.textContent.trim());
    const cont = [...document.querySelectorAll('button')].find((b) =>
      /Use this location/.test(b.textContent ?? ''),
    );
    return {
      recordedZoneInMap: zone ? zone.getAttribute('data-testid') : null,
      activeZoneInMap: activeZone ? activeZone.getAttribute('data-testid') : null,
      pressedSubRegionButtons: pressed,
      receipt: document.querySelector('[data-testid="selection-receipt"]')?.textContent?.trim(),
      footerStatus: document.querySelector('.location-footer [role="status"]')?.textContent?.trim(),
      continueEnabled: cont ? !cont.disabled : null,
      canvasPresent: Boolean(document.querySelector('[data-testid="viewer-3d-canvas"] canvas')),
    };
  });
  log('\n=== SELECTION CONTINUITY on return to Locate ===');
  log(JSON.stringify(returned, null, 2));
  await page.screenshot({ path: join(OUT, '40-return-to-locate-1440.png'), fullPage: true });
  await ctx.close();
}

/* ---------- 2. 3D at mobile ---------- */
for (const size of [
  { name: '375', width: 375, height: 812 },
  { name: '768', width: 768, height: 1024 },
]) {
  const ctx = await browser.newContext({
    viewport: { width: size.width, height: size.height },
    isMobile: true,
    hasTouch: true,
  });
  const page = await ctx.newPage();
  await page.goto(BASE, { waitUntil: 'networkidle' });
  await page
    .getByLabel('What has been bothering you?')
    .fill('my right shoulder rotator cuff hurts deep inside when I lift my arm');
  await page.getByRole('button', { name: 'Locate on body map' }).click();
  await page.locator('.location-workbench').waitFor();
  const clarify = page.getByRole('button', { name: 'Show me the body map' });
  if (await clarify.isVisible().catch(() => false)) await clarify.click();

  await page.getByRole('radio', { name: '3D', exact: true }).check();
  log(`\n=== 3D requested at ${size.name} ===`);
  const start = Date.now();
  let state = null;
  // Wait for the SURFACE to actually become visible, not merely for a canvas to
  // exist. A canvas exists the instant the renderer is constructed, which is
  // during mount and while the host is still hidden — probing on that alone
  // reports "live" for a viewer the user cannot see.
  while (Date.now() - start < 45_000) {
    state = await page.evaluate(() => {
      const host = document.querySelector('[data-testid="viewer-3d-canvas"]');
      const canvas = host?.querySelector('canvas') ?? null;
      let gl = false;
      if (canvas) {
        const g = canvas.getContext('webgl2') || canvas.getContext('webgl');
        gl = Boolean(g);
      }
      const box = canvas?.getBoundingClientRect();
      const mapHidden = document
        .querySelector('[data-testid="bodymap-2d"]')
        ?.classList.contains('is-hidden');
      return {
        canvas: Boolean(canvas),
        gl,
        canvasBox: box ? [Math.round(box.width), Math.round(box.height)] : null,
        hostHidden: host ? getComputedStyle(host).display === 'none' : null,
        mapHidden: mapHidden ?? null,
        fallback: document.querySelector('[data-testid="viewer-fallback"]')?.textContent?.trim() ?? null,
        sideRequired: document.querySelector('[data-testid="side-required"]')?.textContent?.trim() ?? null,
        toolbarLabel: document.querySelector('.viewer-toolbar__label')?.textContent?.trim(),
      };
    });
    const showing = state.gl && state.hostHidden === false && state.canvasBox?.[1] > 40;
    if (showing || state.fallback || state.sideRequired) break;
    await page.waitForTimeout(500);
  }
  log(JSON.stringify(state, null, 2));
  log(`waited ${Date.now() - start}ms`);

  // Is there any instruction on screen about how to interact with a 3D canvas?
  const help = await page.evaluate(() => {
    const t = document.querySelector('.canvas-instruction');
    const style = t ? getComputedStyle(t) : null;
    return {
      text: t?.textContent?.trim() ?? null,
      visible: style ? style.display !== 'none' && style.visibility !== 'hidden' : false,
    };
  });
  log('canvas instruction:', JSON.stringify(help));
  await page.screenshot({ path: join(OUT, `41-3d-mobile-${size.name}.png`), fullPage: true });

  // Can the user still reach the area buttons without scrolling past a canvas?
  const reach = await page.evaluate(() => {
    const first = document.querySelector('.subregion-option');
    if (!first) return null;
    const r = first.getBoundingClientRect();
    return { top: Math.round(r.top), inViewport: r.top < window.innerHeight && r.bottom > 0 };
  });
  log('first area button:', JSON.stringify(reach));
  await ctx.close();
}

await browser.close();