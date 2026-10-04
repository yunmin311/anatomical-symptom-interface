/**
 * The design audit: drive the REAL product at three widths and capture every
 * screen in the flow.
 *
 * Nothing here stubs geometry. Each region runs through the real localisation and
 * the real BodyParts3D scenes, so "what the user sees" is what ships.
 *
 * Usage: bash scripts/audit-capture.sh [outDir]
 */
import { mkdirSync, rmSync } from 'node:fs';
import { join } from 'node:path';

const { chromium } = await import(process.env.PLAYWRIGHT_MODULE);

const BASE = process.env.ASI_WEB_URL ?? 'http://127.0.0.1:5277';
const OUT = process.argv[2] ?? '/tmp/asi-audit-shots';
const WIDTHS = [
  { name: '375', width: 375, height: 812, mobile: true },
  { name: '768', width: 768, height: 1024, mobile: true },
  { name: '1440', width: 1440, height: 1000, mobile: false },
];

rmSync(OUT, { recursive: true, force: true });
mkdirSync(OUT, { recursive: true });

const browser = await chromium.launch({
  headless: true,
  executablePath: process.env.CHROMIUM_PATH,
  args: ['--use-gl=swiftshader', '--enable-unsafe-swiftshader'],
});

const UTTERANCES = {
  shoulder: 'my right shoulder rotator cuff hurts deep inside when I lift my arm',
  neck: 'left neck pain going down into my arm when I turn my head',
  lowerBack: 'lower back ache on both sides in the middle',
  knee: 'my knee hurts on the inside going down stairs',
  unsupported: 'my chest feels tight and heavy',
};

const findings = [];
const note = (where, text) => findings.push({ where, text });

async function shoot(page, name, full = true) {
  await page.screenshot({ path: join(OUT, `${name}.png`), fullPage: full });
}

/** Everything the harness needs to know about the 3D panel, in one read. */
async function probe3d(page) {
  return page.evaluate(() => {
    const host = document.querySelector('[data-testid="viewer-3d-canvas"]');
    const panel = document.querySelector('[data-testid="viewer-3d"]');
    const canvas = host?.querySelector('canvas') ?? null;
    let glLive = false;
    let renderer = null;
    if (canvas) {
      const gl = canvas.getContext('webgl2') || canvas.getContext('webgl');
      glLive = Boolean(gl);
      if (gl) renderer = gl.getParameter(gl.RENDERER);
    }
    const hidden = (el) => Boolean(el && (el.hidden || getComputedStyle(el).display === 'none'));
    return {
      panelPresent: Boolean(panel),
      panelHidden: hidden(panel),
      hostPresent: Boolean(host),
      hostHidden: hidden(host),
      canvas: Boolean(canvas),
      canvasSize: canvas ? [canvas.width, canvas.height] : null,
      glLive,
      renderer,
      sideLabel: document.querySelector('[data-testid="viewer-side"]')?.textContent?.trim() ?? null,
      sideRequired: document.querySelector('[data-testid="side-required"]')?.textContent?.trim() ?? null,
      fallback: document.querySelector('[data-testid="viewer-fallback"]')?.textContent?.trim() ?? null,
      status: document.querySelector('[data-testid="viewer-status"]')?.textContent?.trim() ?? null,
      toolbarLabel: document.querySelector('.viewer-toolbar__label')?.textContent?.trim() ?? null,
    };
  });
}

/** Poll until 3D is genuinely live, or give up. Distinguishes the three cases. */
async function waitFor3d(page, budgetMs = 40_000) {
  const start = Date.now();
  let last = null;
  while (Date.now() - start < budgetMs) {
    last = await probe3d(page);
    if (last.glLive && last.hostHidden === false) break;
    if (last.sideRequired) break;
    await page.waitForTimeout(400);
  }
  return { ...last, waitedMs: Date.now() - start };
}

async function overflow(page, label) {
  const over = await page.evaluate(() => {
    const docWidth = document.documentElement.clientWidth;
    const scrollWidth = document.documentElement.scrollWidth;
    const offenders = [];
    for (const el of document.querySelectorAll('main *')) {
      const r = el.getBoundingClientRect();
      if (r.width === 0 || r.height === 0) continue;
      if (r.right > docWidth + 1 || r.left < -1) {
        offenders.push({
          tag: el.tagName.toLowerCase(),
          cls: el.className?.toString().slice(0, 48),
          right: Math.round(r.right),
        });
      }
    }
    return { docWidth, scrollWidth, offenders: offenders.slice(0, 6) };
  });
  if (over.scrollWidth > over.docWidth + 1) {
    note(
      `overflow/${label}`,
      `document scrolls ${over.scrollWidth}px in a ${over.docWidth}px viewport; offenders ${JSON.stringify(over.offenders)}`,
    );
  }
  return over;
}

/** Text of a selector, or null. */
const textOf = (page, sel) =>
  page.evaluate((s) => document.querySelector(s)?.textContent?.trim() ?? null, sel);

async function toLocate(page, key) {
  await page.goto(BASE, { waitUntil: 'domcontentloaded' });
  await page.waitForSelector('#root');
  await page
    .getByLabel('What has been bothering you?')
    .fill(UTTERANCES[key] ?? key);
  await page.getByRole('button', { name: 'Locate on body map' }).click();
  await page
    .locator('.location-workbench, .unsupported-layout, .empty-state')
    .first()
    .waitFor({ timeout: 20_000 });
}

/** Click through the clarify interstitial when present. Returns true if it was. */
async function pastClarify(page) {
  const clarify = page.getByRole('button', { name: 'Show me the body map' });
  if (await clarify.isVisible().catch(() => false)) {
    await clarify.click();
    await page.locator('.location-workbench').waitFor({ timeout: 20_000 });
    return true;
  }
  return false;
}

/** Chrome copy the audit cares about: what the user is told, and where. */
async function readChrome(page) {
  return page.evaluate(() => {
    const t = (sel) => document.querySelector(sel)?.textContent?.trim() ?? null;
    const groupButtons = (label) => {
      const g = [...document.querySelectorAll('fieldset, [role="group"]')].find((el) =>
        el.getAttribute('aria-label')?.toLowerCase().includes(label),
      );
      if (!g) return null;
      return [...g.querySelectorAll('button')].map(
        (b) =>
          `${b.textContent.trim()}${b.getAttribute('aria-pressed') === 'true' || b.getAttribute('aria-checked') === 'true' ? '*' : ''}`,
      );
    };
    return {
      toolbarLabel: t('.viewer-toolbar__label'),
      caption: t('.viewer-caption'),
      receipt: t('[data-testid="selection-receipt"]'),
      inspectorReceipt: t('.inspector-receipt'),
      legend: [...document.querySelectorAll('.map-legend li')].map((li) => li.textContent.trim()),
      foot: t('.viewer-foot'),
      contextHead: t('.location-context'),
      footerStatus: t('.location-footer [role="status"]'),
      bodyView: groupButtons('body view'),
      viewerChoice: groupButtons('viewer'),
      inspectorTabs: [...document.querySelectorAll('.inspector-switch button')].map(
        (b) => `${b.textContent.trim()}${b.getAttribute('aria-pressed') === 'true' ? '*' : ''}`,
      ),
      heading: t('#page-title'),
    };
  });
}

for (const size of WIDTHS) {
  const context = await browser.newContext({
    viewport: { width: size.width, height: size.height },
    isMobile: size.mobile,
    hasTouch: size.mobile,
    deviceScaleFactor: 1,
  });
  const page = await context.newPage();
  const errors = [];
  page.on('pageerror', (e) => errors.push(e.message));

  console.log(`\n=== ${size.name}px ===`);

  await toLocate(page, 'shoulder');
  await shoot(page, `01-describe-${size.name}`);
  await overflow(page, `${size.name}-describe`);

  const clarified = await pastClarify(page);
  if (clarified) await shoot(page, `02-clarify-${size.name}`);

  await shoot(page, `03-locate-${size.name}`);
  await overflow(page, `${size.name}-locate`);
  console.log('  chrome:', JSON.stringify(await readChrome(page), null, 2).replace(/\n/g, '\n  '));

  const threeD = await waitFor3d(page);
  console.log(
    `  3D: canvas=${threeD.canvas} live=${threeD.glLive} panelHidden=${threeD.panelHidden} waited=${threeD.waitedMs}ms`,
  );
  if (threeD.sideRequired) console.log(`  side required: ${threeD.sideRequired}`);
  if (threeD.fallback) console.log(`  fallback: ${threeD.fallback}`);
  await shoot(page, `03b-locate-loaded-${size.name}`);

  /* ---------- Inspector tabs ---------- */
  const tabs = page.locator('.inspector-switch button');
  const tabCount = await tabs.count();
  for (let i = 0; i < tabCount; i += 1) {
    const label = (await tabs.nth(i).textContent())?.trim() ?? `tab${i}`;
    await tabs.nth(i).click();
    await page.waitForTimeout(200);
    await shoot(page, `04-inspector-${i}-${label.replace(/\W+/g, '_')}-${size.name}`);
    await overflow(page, `${size.name}-inspector-${i}`);
  }

  /* ---------- Choose an area and try to continue ---------- */
  await tabs.nth(0).click();
  const sub = page.locator('.subregion-option').first();
  if (await sub.count()) {
    await sub.click();
    await page.waitForTimeout(300);
  }
  const continueBtn = page.getByRole('button', { name: /Use this location/ });
  const enabled = await continueBtn.isEnabled();
  console.log(`  continue enabled after area click: ${enabled}`);
  console.log('  receipt:', await textOf(page, '[data-testid="selection-receipt"]'));
  await shoot(page, `05-area-chosen-${size.name}`);

  if (enabled) {
    await continueBtn.click();
    await page.locator('.interview-panel, .empty-state').first().waitFor({ timeout: 15_000 });
    await page.waitForTimeout(300);
    await shoot(page, `06-interview-${size.name}`);
    await overflow(page, `${size.name}-interview`);

    const opt = page.locator('.answer-option input').first();
    if (await opt.count()) {
      await opt.check();
      await page.waitForTimeout(150);
      await shoot(page, `07-interview-answered-${size.name}`);
      await page.getByRole('button', { name: 'Continue' }).click();
      await page.waitForTimeout(400);
      await shoot(page, `08-interview-next-${size.name}`);
    }

    const reviewLink = page.getByRole('button', { name: /Review current details/ });
    if (await reviewLink.count()) {
      await reviewLink.click();
      await page.locator('.review-layout').waitFor({ timeout: 15_000 });
      await page.waitForTimeout(300);
      await shoot(page, `09-review-${size.name}`);
      await overflow(page, `${size.name}-review`);

      const save = page.getByRole('button', { name: /Save & build summary/ });
      if (await save.isEnabled()) {
        await save.click();
        await page.waitForTimeout(3000);
        await shoot(page, `10-summary-${size.name}`);
        await overflow(page, `${size.name}-summary`);
      }
    }
  } else {
    note(`continue/${size.name}`, 'the primary action is disabled and the reason is not adjacent to it');
  }

  /* ---------- Health map ---------- */
  const healthmap = page.getByRole('button', { name: /Personal health map/ });
  if (await healthmap.count()) {
    await healthmap.click();
    await page.locator('.healthmap-layout, .empty-state').first().waitFor({ timeout: 15_000 });
    await page.waitForTimeout(500);
    await shoot(page, `11-healthmap-${size.name}`);
    await overflow(page, `${size.name}-healthmap`);
    const detail = page.locator('.episode summary').first();
    if (await detail.count()) {
      await detail.click();
      await page.waitForTimeout(400);
      await shoot(page, `12-healthmap-open-${size.name}`);
    }
  }

  if (errors.length) note(`errors/${size.name}`, errors.join(' | '));
  await context.close();
}

/* ---------- Every region, desktop, with a real 3D diagnosis ---------- */
{
  const context = await browser.newContext({ viewport: { width: 1440, height: 1000 } });
  const page = await context.newPage();
  for (const key of ['shoulder', 'neck', 'lowerBack', 'knee']) {
    console.log(`\n=== region ${key} / 1440 ===`);
    await toLocate(page, key);
    await pastClarify(page);
    const threeD = await waitFor3d(page, 50_000);
    console.log(
      `  3D: canvas=${threeD.canvas} live=${threeD.glLive} panelHidden=${threeD.panelHidden} sideRequired=${threeD.sideRequired ?? '-'} fallback=${threeD.fallback ?? '-'} waited=${threeD.waitedMs}ms`,
    );
    // A region whose side is unknown cannot be mounted from real geometry, and
    // refusing to guess is the correct behaviour. Flagging it as a defect would
    // train the audit to ignore real ones.
    if (threeD.sideRequired) {
      console.log('  (no 3D expected: the record has no side, and the viewer will not guess one)');
    } else if (!threeD.glLive) {
      note(`3d/${key}`, `no live WebGL: ${JSON.stringify(threeD)}`);
    }
    await page.waitForTimeout(1500);
    await shoot(page, `20-region-${key}-1440`);
    await overflow(page, `${key}-locate`);
  }
  await context.close();
}

/* ---------- Refusal path ---------- */
{
  const context = await browser.newContext({ viewport: { width: 1440, height: 1000 } });
  const page = await context.newPage();
  console.log('\n=== refusal / 1440 ===');
  await toLocate(page, 'unsupported');
  await page.waitForTimeout(500);
  await shoot(page, `30-refusal-1440`);
  const refusal = await page.evaluate(() => ({
    text: document.querySelector('.unsupported-layout')?.textContent?.trim() ?? null,
  }));
  console.log('  refusal:', JSON.stringify(refusal));
  await context.close();
}

console.log('\n=== FINDINGS ===');
for (const f of findings) console.log(`- [${f.where}] ${f.text}`);
console.log(`\nscreenshots in ${OUT}`);

await browser.close();