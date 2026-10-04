/**
 * Which on-screen statements are TRUE on each surface?
 *
 * The audit found copy that describes the 2D map while sitting above a real 3D
 * viewer. This asserts each string against what is actually mounted, so the
 * findings are facts rather than impressions.
 */
const { chromium } = await import(process.env.PLAYWRIGHT_MODULE);
const BASE = process.env.ASI_WEB_URL ?? 'http://127.0.0.1:5277';

const browser = await chromium.launch({
  headless: true,
  executablePath: process.env.CHROMIUM_PATH,
  args: ['--use-gl=swiftshader', '--enable-unsafe-swiftshader'],
});

const READ = () => {
  const t = (sel) => document.querySelector(sel)?.textContent?.trim() ?? null;
  const host = document.querySelector('[data-testid="viewer-3d-canvas"]');
  return {
    real3dMounted: Boolean(host?.querySelector('canvas')) && !host.classList.contains('is-hidden'),
    mapVisible: !document.querySelector('[data-testid="bodymap-2d"]')?.classList.contains('is-hidden'),
    toolbarLabel: t('.viewer-toolbar__label'),
    foot: t('.viewer-foot .small') ?? t('.viewer-foot'),
    legend: [...document.querySelectorAll('.map-legend li')].map((li) => li.textContent.trim()),
    legendVisible: Boolean(document.querySelector('.map-legend')),
    captionVisible: (() => {
      const c = document.querySelector('.viewer-caption');
      if (!c) return false;
      const s = getComputedStyle(c);
      return s.display !== 'none' && !c.hidden;
    })(),
    attributionLink: t('[data-testid="anatomy-attribution"] summary, .anatomy-attribution summary'),
  };
};

for (const key of ['shoulder', 'neck', 'lowerBack', 'knee']) {
  const ctx = await browser.newContext({ viewport: { width: 1440, height: 1000 } });
  const page = await ctx.newPage();
  const utterance = {
    shoulder: 'my right shoulder rotator cuff hurts deep inside when I lift my arm',
    neck: 'left neck pain going down into my arm when I turn my head',
    lowerBack: 'lower back ache on both sides in the middle',
    knee: 'my knee hurts on the inside going down stairs',
  }[key];

  await page.goto(BASE, { waitUntil: 'domcontentloaded' });
  await page.getByLabel('What has been bothering you?').fill(utterance);
  await page.getByRole('button', { name: 'Locate on body map' }).click();

  /*
   * THE CLARIFICATION INTERSTITIAL MUST BE HANDLED BEFORE WAITING FOR THE WORKBENCH.
   *
   * An ambiguous description grounds to a `clarify` stage that renders an `EmptyState`
   * offering "Show me the body map" -- not a workbench. So waiting for `.location-workbench`
   * first hangs forever on exactly the region whose description is ambiguous, and this script
   * did that: it waited for the workbench, then looked for the clarify button that would have
   * dismissed the screen it was waiting on. Knee timed out for that reason and nothing else.
   *
   * So the first wait is for EITHER the workbench or the interstitial, the interstitial is
   * dismissed if it appeared, and only then is the workbench awaited. Same order and the same
   * selectors as `user-flow-browser.mjs`, which is the working reference for this path.
   *
   * `unsupported-layout` is deliberately not in the first wait: an unsupported region exits
   * rather than entering an interview, and every utterance here is a supported one, so waiting
   * for a screen that should never appear would convert a real regression into a long timeout.
   */
  await page.locator('.location-workbench, .empty-state').first().waitFor({ timeout: 30_000 });
  const clarify = page.getByRole('button', { name: 'Show me the body map' });
  if (await clarify.isVisible().catch(() => false)) {
    console.log(`(${key}: dismissed the clarification interstitial)`);
    await clarify.click();
  }
  await page.locator('.location-workbench').waitFor({ timeout: 30_000 });
  await page.waitForTimeout(1500);

  console.log(`\n=== ${key} · default surface ===`);
  console.log(JSON.stringify(await page.evaluate(READ), null, 2));

  if (key === 'shoulder') {
    await page.getByRole('radio', { name: '2D map' }).check();
    await page.waitForTimeout(500);
    console.log(`\n=== ${key} · 2D map ===`);
    console.log(JSON.stringify(await page.evaluate(READ), null, 2));
  }
  await ctx.close();
}

await browser.close();