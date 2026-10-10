#!/usr/bin/env node
/**
 * Locate continuity across Body map / Anatomy maps / 3D, in a browser.
 *
 * The three surfaces are three views over ONE record: the canonical selection
 * set, the area, the side and the depth all live in the record, never in a
 * surface. A surface switch that dropped the selection, or a return from the
 * interview that forgot the area, would be invisible to every unit test --
 * the engine is correct in all of them -- and obvious to a user.
 *
 * So this walks the real UI at three widths and asserts on what the screen
 * says: the selection count survives every surface switch, a tap on a
 * writable structure offers recording while a tap on a view-only structure
 * explains why it cannot record, the interview round trip keeps area and
 * selection, and a dead 3D backend falls back to the body map with words.
 */
const { chromium } = await import(process.env.PLAYWRIGHT_MODULE);
import { mkdirSync } from 'node:fs';

const url = process.env.ASI_WEB_URL || 'http://127.0.0.1:5177';
const out = process.env.ASI_SCREENSHOTS || '/tmp/asi-locate-shots';
mkdirSync(out, { recursive: true });

const problems = [];
let n = 0;
const ok = (m) => console.log(`ok   ${m}`);
const bad = (m) => {
  console.log(`FAIL ${m}`);
  problems.push(m);
};
async function check(name, fn) {
  try {
    await fn();
    console.log(`PASS ${++n}: ${name}`);
  } catch (e) {
    bad(`${name}: ${e?.message ?? e}`);
    n += 1;
  }
}
function assert(condition, message) {
  if (!condition) throw new Error(message);
}
assert.equal = (a, b, message) => {
  if (a !== b) throw new Error(`${message ?? 'not equal'} (got ${JSON.stringify(a)}, want ${JSON.stringify(b)})`);
};
assert.match = (text, re, message) => {
  if (!re.test(text ?? '')) throw new Error(message ?? `did not match ${re}`);
};

const browser = await chromium.launch({ args: ['--use-gl=angle', '--use-angle=swiftshader'] });

async function enterLocate(page) {
  await page.goto(url);
  await page.waitForSelector('#root *', { timeout: 30_000 });
  await page
    .getByLabel('What has been bothering you?')
    .fill('my right shoulder rotator cuff hurts deep inside');
  await page.getByRole('button', { name: 'Locate on body map' }).click();
  await page.locator('.location-workbench, .empty-state').first().waitFor({ timeout: 30_000 });
  const clarify = page.getByRole('button', { name: 'Show me the body map' });
  if (await clarify.isVisible().catch(() => false)) await clarify.click();
  await page.locator('.location-workbench').waitFor({ timeout: 30_000 });
  await page.waitForTimeout(1200);
}

const footerText = (page) =>
  page.locator('.location-footer__why').innerText().then((t) => t.replace(/\s+/g, ' '));

try {
  for (const width of [375, 768, 1440]) {
    const page = await browser.newPage({ viewport: { width, height: width === 375 ? 812 : 950 } });
    const errors = [];
    page.on('pageerror', (e) => errors.push(String(e)));
    const at = ` at ${width}px`;

    await check(`locate workbench loads without overflow${at}`, async () => {
      await enterLocate(page);
      const overflow = await page.evaluate(
        () => document.documentElement.scrollWidth - document.documentElement.clientWidth,
      );
      assert(overflow <= 2, `horizontal overflow of ${overflow}px`);
      ok('workbench mounted, no sideways scroll');
    });

    await check(`anatomy render has real size${at}`, async () => {
      await page.getByRole('radio', { name: 'Anatomy maps', exact: true }).click();
      await page.locator('[data-testid="derived2d-img"]').waitFor({ timeout: 15_000 });
      const box = await page.locator('[data-testid="derived2d-img"]').boundingBox();
      assert(box, 'the derived render never appeared');
      const short = Math.min(box.width, box.height);
      assert(short >= 240, `the anatomy render is a ${Math.round(box.width)}x${Math.round(box.height)} thumbnail`);
      ok(`anatomy render ${Math.round(box.width)}x${Math.round(box.height)}`);
      await page.screenshot({ path: `${out}/locate-derived-${width}.png` });
    });

    await check(`a tap names writable and view-only structures differently${at}`, async () => {
      // Taps on the front-muscle render, measured fresh against the img box
      // right before each click (the box the hit map itself measures, so the
      // fractions stay exact). The writable target is the interior of a wide
      // clavicular-deltoid run; the view-only candidates are three well-spaced
      // points over view-only anatomy, tried in order until one resolves. The
      // strict part is the end state, not which candidate lands: a view-only
      // tap must explain and must never offer recording.
      const img = page.locator('[data-testid="derived2d-img"]');
      const tapAt = async (fx, fy) => {
        const fresh = await img.boundingBox();
        assert(fresh, 'no render to tap');
        await img.click({ position: { x: fresh.width * fx, y: fresh.height * fy } });
        await page.waitForTimeout(350);
      };
      await tapAt(0.446875, 0.3475);
      await page.locator('[data-testid="derived2d-detail"]').waitFor({ timeout: 10_000 });
      const writableDetail = await page.locator('[data-testid="derived2d-detail"]').innerText();
      assert(
        (await page.getByTestId('derived2d-indicate').count()) === 1,
        `a writable structure did not offer recording (saw: ${writableDetail.replace(/\s+/g, ' ').slice(0, 120)})`,
      );
      ok(`writable tap offers recording (${writableDetail.split('\n')[0]})`);
      let viewOnlyDetail = '<no detail>';
      for (const [fx, fy] of [[0.2414, 0.595], [0.4412, 0.5], [0.4412, 0.3]]) {
        await tapAt(fx, fy);
        if ((await page.getByTestId('derived2d-viewonly').count()) > 0) {
          viewOnlyDetail = await page.locator('[data-testid="derived2d-detail"]').innerText();
          break;
        }
      }
      await page.screenshot({ path: `${out}/locate-tap-${width}.png` });
      assert(
        (await page.getByTestId('derived2d-viewonly').count()) === 1,
        `no view-only tap resolved (last saw: ${viewOnlyDetail.replace(/\s+/g, ' ').slice(0, 120)})`,
      );
      assert(
        (await page.getByTestId('derived2d-indicate').count()) === 0,
        `a view-only structure offered recording (saw: ${viewOnlyDetail.replace(/\s+/g, ' ').slice(0, 120)})`,
      );
      ok(`view-only tap explains instead of recording (${viewOnlyDetail.split('\n')[0]})`);
    });

    await check(`the selection survives every surface switch${at}`, async () => {
      await page.getByRole('button', { name: 'Structures', exact: true }).click();
      await page.getByRole('button', { name: 'Indicate this structure' }).first().click();
      let foot = await footerText(page);
      assert(/1 structure indicated/.test(foot), `indication did not land: ${foot}`);
      for (const surface of ['3D', 'Anatomy maps', 'Body map']) {
        await page.getByRole('radio', { name: surface, exact: true }).click();
        await page.waitForTimeout(900);
        foot = await footerText(page);
        assert(
          /1 structure indicated/.test(foot),
          `switching to ${surface} lost the selection: ${foot}`,
        );
      }
      ok('1 structure indicated on 3D, Anatomy maps and Body map');
      await page.screenshot({ path: `${out}/locate-switched-${width}.png` });
    });

    await check(`interview round trip keeps area and selection${at}`, async () => {
      await page.getByRole('button', { name: 'Area & pin', exact: true }).click().catch(() => {});
      await page.getByRole('button', { name: 'Front of shoulder' }).click();
      const use = page.getByRole('button', { name: /Use this location/ });
      assert(await use.isEnabled(), 'a chosen area did not enable the primary action');
      await use.click();
      await page.locator('.question__prompt').waitFor({ timeout: 15_000 });
      const first = await page.locator('.question__prompt').innerText();
      await page.getByRole('button', { name: 'Adjust location' }).click();
      await page.locator('.location-workbench').waitFor({ timeout: 15_000 });
      const foot = await footerText(page);
      assert(/Front of shoulder/.test(foot), `the area did not survive the return: ${foot}`);
      assert(/1 structure indicated/.test(foot), `the selection did not survive the return: ${foot}`);
      await page.getByRole('button', { name: /Use this location/ }).click();
      await page.locator('.question__prompt').waitFor({ timeout: 15_000 });
      assert.equal(await page.locator('.question__prompt').innerText(), first, 'continuing landed on a different question');
      ok('area + selection survived locate -> interview -> locate -> interview');
      await page.screenshot({ path: `${out}/locate-returned-${width}.png` });
    });

    await check(`no page errors${at}`, async () => {
      assert(errors.length === 0, errors.join(' | '));
      ok('clean');
    });

    await page.close();
  }

  // The error state: a 3D backend that cannot deliver must fall back to the
  // body map with words, never a blank canvas and never a silent substitution.
  {
    const page = await browser.newPage({ viewport: { width: 1440, height: 950 } });
    const errors = [];
    page.on('pageerror', (e) => errors.push(String(e)));
    await check('dead 3D falls back to the body map with words', async () => {
      await page.route('**/*.glb', (r) => r.abort());
      await enterLocate(page);
      await page.getByRole('radio', { name: '3D', exact: true }).click();
      await page.locator('[data-testid="surface-fallback-note"]').waitFor({ timeout: 15_000 });
      const label = await page.locator('[data-testid="surface-label"]').innerText();
      assert(/Body map/.test(label), `fallback landed on ${label}, not the body map`);
      const note = await page.locator('[data-testid="surface-fallback-note"]').innerText();
      assert(/could not start/i.test(note), 'the fallback names no reason');
      assert(/area buttons/i.test(note), 'the fallback names no next action');
      ok('fallback message + body map surface');
      await page.screenshot({ path: `${out}/locate-fallback-1440.png` });
      await page.unroute('**/*.glb');
      assert(errors.length === 0, errors.join(' | '));
    });
    await page.close();
  }

  // The other error state: an anatomy map that cannot load must say so next to
  // the area buttons that still work, never a blank stage and never a dead end.
  {
    const page = await browser.newPage({ viewport: { width: 768, height: 950 } });
    const errors = [];
    page.on('pageerror', (e) => errors.push(String(e)));
    await check('dead anatomy map fails loudly with working area buttons', async () => {
      await page.route('**/*.grid.json', (r) => r.abort());
      await enterLocate(page);
      await page.getByRole('radio', { name: 'Anatomy maps', exact: true }).click();
      await page.locator('[data-testid="derived2d-failed"]').waitFor({ timeout: 15_000 });
      const copy = await page.locator('[data-testid="derived2d-failed"]').innerText();
      assert(/could not be loaded/i.test(copy), 'the failure names no reason');
      assert(/area buttons/i.test(copy), 'the failure names no next action');
      await page.getByRole('button', { name: 'Front of shoulder' }).click();
      assert(
        await page.getByRole('button', { name: /Use this location/ }).isEnabled(),
        'the area decision died with the map',
      );
      ok('failure copy + working area buttons');
      await page.screenshot({ path: `${out}/locate-derived-failed-768.png` });
      await page.unroute('**/*.grid.json');
      assert(errors.length === 0, errors.join(' | '));
    });
    await page.close();
  }
} catch (e) {
  bad(`threw: ${e?.stack ?? e}`);
} finally {
  await browser.close();
}

if (problems.length) {
  console.log(`\n${problems.length} problem(s) in Locate continuity`);
  process.exit(1);
}
console.log(`\nall ${n} Locate continuity checks passed`);
