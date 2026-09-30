// Real deterministic service, synthetic records only. Failure routes isolate transport states.
import assert from 'node:assert/strict';
import { mkdir } from 'node:fs/promises';
const { chromium } = await import(
  process.env.PLAYWRIGHT_MODULE || 'playwright'
);
const url = process.env.ASI_WEB_URL || 'http://127.0.0.1:5189';
const output = process.env.ASI_SCREENSHOTS || '/tmp/asi-design-v2-evidence';
await mkdir(output, { recursive: true });
const browser = await chromium.launch({
  headless: true,
  ...(process.env.CHROMIUM_PATH
    ? { executablePath: process.env.CHROMIUM_PATH }
    : {}),
});
let checks = 0;
const errors = [];
async function check(name, fn) {
  await fn();
  console.log(`PASS ${++checks}: ${name}`);
}
async function enter(page) {
  await page.goto(url);
  await page
    .getByLabel('What has been bothering you?')
    .fill('My right shoulder rotator cuff hurts deep inside');
  await page.getByRole('button', { name: 'Locate on body map' }).click();
  await page.locator('.location-workbench,.empty-state').waitFor();
  if (
    await page.getByRole('button', { name: 'Show me the body map' }).isVisible()
  )
    await page.getByRole('button', { name: 'Show me the body map' }).click();
  await page.locator('.location-workbench').waitFor();
}
async function answerCurrent(page) {
  const form = page.locator('.interview-panel form');
  if (!(await form.count())) return false;
  const text = form.locator('textarea');
  if (await text.count()) await text.fill('Synthetic test detail');
  else {
    const unsure = form.getByLabel('I am not sure', { exact: true });
    if (await unsure.count()) await unsure.check();
    else await form.locator('input').first().check();
  }
  await form.getByRole('button', { name: 'Continue', exact: true }).click();
  return true;
}
try {
  for (const width of [1440, 768, 375]) {
    const context = await browser.newContext({
      viewport: { width, height: width === 375 ? 812 : 1000 },
      permissions: ['clipboard-read', 'clipboard-write'],
    });
    const page = await context.newPage();
    page.on('pageerror', (e) => errors.push(e.message));
    const shot = async (name) => {
      await page.screenshot({
        path: `${output}/${name}-${width}.png`,
        fullPage: true,
      });
      assert.equal(
        await page.evaluate(
          () => document.documentElement.scrollWidth <= innerWidth,
        ),
        true,
        `${name} overflow at ${width}`,
      );
    };
    await check(`Entry ${width}`, async () => {
      await page.goto(url);
      assert.equal(await page.locator('.steps').count(), 0);
      assert.equal(
        await page
          .getByRole('button', { name: 'Locate on body map' })
          .isDisabled(),
        true,
      );
      await shot('entry');
    });
    await check(
      `Locate / candidate round trip / side / pin ${width}`,
      async () => {
        await enter(page);
        assert.equal(
          await page
            .getByRole('button', { name: /Use this location/ })
            .isDisabled(),
          true,
        );
        await page.getByRole('button', { name: 'Front of shoulder' }).click();
        await page
          .getByRole('button', { name: 'Side & depth', exact: true })
          .click();
        await page.getByLabel('Left', { exact: true }).check();
        await page.getByLabel('Deep inside', { exact: true }).check();
        await page
          .getByRole('button', { name: 'Structures', exact: true })
          .click();
        await page
          .getByRole('button', { name: 'Indicate this structure' })
          .first()
          .click();
        await page
          .getByRole('button', { name: 'Remove visual selection' })
          .first()
          .click();
        assert.ok(
          await page.getByText('◇ Tool suggestion · not selected').count(),
        );
        await page
          .getByRole('button', { name: 'Indicate this structure' })
          .first()
          .click();
        await page
          .getByRole('button', { name: 'Area & pin', exact: true })
          .click();
        await page
          .getByText('Fine positioning · optional pin', { exact: true })
          .click();
        await page.getByRole('button', { name: 'Place pin at centre' }).click();
        await page
          .getByText('Fine positioning · optional pin', { exact: true })
          .click();
        await shot('locate');
        await page.getByRole('button', { name: /Use this location/ }).click();
      },
    );
    await check(`Details ${width}`, async () => {
      await page.locator('.question__prompt').waitFor();
      await shot('details');
      await answerCurrent(page);
    });
    await check(`Review incomplete ${width}`, async () => {
      await page
        .getByRole('button', { name: /Review current details/ })
        .click();
      await page
        .getByRole('heading', { name: 'Review before saving' })
        .waitFor();
      assert.ok(await page.getByText('Not asked', { exact: true }).count());
      await shot('review');
    });
    await check(`Save failure retains record ${width}`, async () => {
      await page.route('**/api/episodes', (route) =>
        route.request().method() === 'POST'
          ? route.fulfill({
              status: 503,
              contentType: 'application/json',
              body: JSON.stringify({ error: 'Synthetic service failure' }),
            })
          : route.continue(),
      );
      await page.getByRole('button', { name: 'Save & build summary' }).click();
      await page
        .getByRole('heading', { name: 'Your record could not be saved' })
        .waitFor();
      assert.ok(
        await page
          .getByText('My right shoulder rotator cuff hurts deep inside', {
            exact: true,
          })
          .count(),
      );
      await shot('save-failure');
      await page.unroute('**/api/episodes');
    });
    await check(`Saved summary / copy / print ${width}`, async () => {
      await page.getByRole('button', { name: 'Save & build summary' }).click();
      await page.getByRole('heading', { name: 'Pre-visit summary' }).waitFor();
      await page.getByRole('button', { name: 'Copy complete summary' }).click();
      const copied = await page.evaluate(() => navigator.clipboard.readText());
      assert.ok(copied.includes('not asked'));
      assert.ok(copied.includes('not a diagnosis'));
      assert.ok(!copied.includes('confirmed'));
      await shot('summary');
      await page.emulateMedia({ media: 'print' });
      await shot('print');
      await page.emulateMedia({ media: 'screen' });
    });
    await check(`Health map ${width}`, async () => {
      await page.getByRole('button', { name: /Personal health map/ }).click();
      await page.locator('.healthmap-index').waitFor();
      await page
        .locator('.body-index')
        .getByRole('button', { name: /Shoulder/ })
        .click();
      assert.ok(await page.locator('.episode').count());
      await page.locator('.episode summary').first().click();
      await shot('health-map');
    });
    await check(`Empty history ${width}`, async () => {
      await page.goto(url);
      await page.route('**/api/episodes?personId=*', (r) =>
        r.fulfill({ json: [] }),
      );
      await page.getByRole('button', { name: /Personal health map/ }).click();
      await page
        .getByRole('heading', {
          name: 'Your health map starts with one episode.',
        })
        .waitFor();
      await shot('empty-history');
      await page.unroute('**/api/episodes?personId=*');
    });
    await check(`Unsupported ${width}`, async () => {
      await page.goto(url);
      await page.getByLabel('What has been bothering you?').fill('chest pain');
      await page.getByRole('button', { name: 'Locate on body map' }).click();
      await page
        .getByRole('heading', { name: 'No location established' })
        .waitFor();
      assert.equal(await page.locator('.bodymap__svg').count(), 0);
      await shot('unsupported');
    });
    await check(`Service unavailable ${width}`, async () => {
      await page.goto(url);
      await page.route('**/api/localise', (r) => r.abort());
      await page.getByLabel('What has been bothering you?').fill('left knee');
      await page.getByRole('button', { name: 'Locate on body map' }).click();
      await page
        .getByRole('heading', { name: 'Location service unavailable' })
        .waitFor();
      assert.equal(
        await page.getByLabel('What has been bothering you?').inputValue(),
        'left knee',
      );
      await shot('service-unavailable');
      await page.unroute('**/api/localise');
    });
    await context.close();
  }
  const context = await browser.newContext({
    viewport: { width: 1440, height: 1000 },
  });
  const page = await context.newPage();
  page.on('pageerror', (e) => errors.push(e.message));
  await check('Keyboard-only entry → location → details', async () => {
    await page.goto(url);
    await page.keyboard.press('Tab');
    assert.equal(
      await page.evaluate(() => document.activeElement?.textContent?.trim()),
      'Skip to content',
    );
    await page.keyboard.press('Enter');
    async function tabTo(selector) {
      for (let i = 0; i < 60; i++) {
        if (
          await page
            .locator(selector)
            .first()
            .evaluate((el) => el === document.activeElement)
        )
          return;
        await page.keyboard.press('Tab');
      }
      throw Error(`Keyboard target unreachable ${selector}`);
    }
    await tabTo('#description');
    await page.keyboard.type('left knee');
    await tabTo('.describe button');
    await page.keyboard.press('Enter');
    await page.locator('.location-workbench').waitFor();
    await tabTo('.subregion-option');
    await page.keyboard.press('Enter');
    await tabTo('.location-footer button');
    await page.keyboard.press('Enter');
    await page.locator('.question__prompt').waitFor();
    assert.ok(
      await page
        .locator('.question__prompt')
        .evaluate((el) => el === document.activeElement),
    );
  });
  await check(
    'Full interview reaches review; unknown stays distinct',
    async () => {
      await enter(page);
      await page.getByRole('button', { name: 'Front of shoulder' }).click();
      await page.getByRole('button', { name: /Use this location/ }).click();
      let count = 0;
      while (await answerCurrent(page)) {
        if (++count > 40) throw Error('Interview loop');
      }
      assert.ok(count > 3);
      await page
        .getByRole('button', { name: /Review current details/ })
        .click();
      assert.ok(
        await page
          .getByText('Not established — I am not sure', { exact: true })
          .count(),
      );
      await page.screenshot({
        path: `output/full-review.png`.replace('output', output),
        fullPage: true,
      });
    },
  );
  await check('No browser runtime errors', async () =>
    assert.deepEqual(errors, []),
  );
  await context.close();
  console.log(`${checks}/${checks} browser checks passed`);
} finally {
  await browser.close();
}
