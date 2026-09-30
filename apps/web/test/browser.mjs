// Run against an isolated deterministic server/database. No clinical assertions are tested here.
// PLAYWRIGHT_MODULE may be an absolute installed Playwright index.mjs; no production dependency.
import assert from 'node:assert/strict';
import { mkdir } from 'node:fs/promises';
const { chromium } = await import(
  process.env.PLAYWRIGHT_MODULE || 'playwright'
);
const url = process.env.ASI_WEB_URL || 'http://127.0.0.1:5187';
const output = process.env.ASI_SCREENSHOTS || '/tmp/asi-design-evidence';
await mkdir(output, { recursive: true });
const browser = await chromium.launch({
  headless: true,
  ...(process.env.CHROMIUM_PATH
    ? { executablePath: process.env.CHROMIUM_PATH }
    : {}),
});
const context = await browser.newContext({
  viewport: { width: 1440, height: 1000 },
  permissions: ['clipboard-read', 'clipboard-write'],
});
const page = await context.newPage();
const errors = [];
page.on('pageerror', (error) => errors.push(error.message));
let count = 0;
async function pass(name, fn) {
  await fn();
  console.log(`PASS ${++count}: ${name}`);
}
async function screenshot(name) {
  await page.screenshot({ path: `${output}/${name}.png`, fullPage: true });
}
async function noOverflow() {
  assert.equal(
    await page.evaluate(
      () => document.documentElement.scrollWidth <= innerWidth,
    ),
    true,
  );
}
async function enter(phrase) {
  await page.goto(url);
  await page.getByLabel('What has been bothering you?').fill(phrase);
  await page.getByRole('button', { name: 'Locate on body map' }).click();
  await page.locator('.location-workbench, .empty-state').waitFor();
}
try {
  await pass(
    'Entry has no inferred default location; keyboard focus and descriptive input work',
    async () => {
      await page.goto(url);
      assert.equal(
        await page
          .locator('.context-rail')
          .getByText('Current location')
          .count(),
        0,
      );
      assert.equal(
        await page
          .getByRole('button', { name: 'Locate on body map' })
          .isDisabled(),
        true,
      );
      await page.keyboard.press('Tab');
      assert.equal(
        await page.evaluate(() => document.activeElement?.textContent),
        'Skip to content',
      );
      await page.keyboard.press('Enter');
      await page.keyboard.press('Tab');
      assert.equal(
        await page.evaluate(() => document.activeElement?.tagName),
        'TEXTAREA',
      );
      await screenshot('entry-desktop');
    },
  );
  await pass(
    'Vague description does not show the default shoulder or a continue action',
    async () => {
      await enter('I feel unwell');
      assert.equal(await page.locator('.bodymap__svg').count(), 0);
      assert.ok(
        await page
          .getByRole('heading', { name: 'No location to show yet' })
          .isVisible(),
      );
      await screenshot('unsupported');
      await page
        .getByRole('button', { name: 'Return to your description' })
        .click();
      assert.equal(
        await page.getByLabel('What has been bothering you?').inputValue(),
        'I feel unwell',
      );
      assert.equal(
        await page
          .locator('.context-rail')
          .getByText('Current location')
          .count(),
        0,
      );
    },
  );
  await pass(
    'Real candidates remain unconfirmed until explicit selection; pin and area stay on locate',
    async () => {
      await enter('right shoulder rotator cuff deep inside');
      assert.ok((await page.locator('.candidate-card').count()) > 0);
      assert.equal(
        await page
          .getByRole('button', { name: 'Use this location & continue' })
          .isDisabled(),
        true,
      );
      assert.equal(await page.locator('.candidate-card--selected').count(), 0);
      await page
        .getByRole('button', { name: 'Select this structure' })
        .first()
        .click();
      assert.equal(await page.locator('.candidate-card--selected').count(), 1);
      await page
        .getByRole('button', { name: 'Front of shoulder', exact: true })
        .click();
      assert.ok(
        await page
          .getByRole('heading', { name: 'Find the place you mean.' })
          .isVisible(),
      );
      await page
        .getByText('Place or adjust a pin with the keyboard', { exact: true })
        .click();
      await page.getByRole('button', { name: 'Place pin at centre' }).click();
      await page.getByLabel('Horizontal position').focus();
      await page.keyboard.press('ArrowRight');
      assert.equal(
        await page.getByLabel('Horizontal position').inputValue(),
        '51',
      );
      await screenshot('location-desktop');
    },
  );
  await pass(
    'Tablet and mobile location/entry have no horizontal overflow',
    async () => {
      for (const width of [768, 375]) {
        await page.setViewportSize({ width, height: 1000 });
        await noOverflow();
        await screenshot(`location-${width}`);
      }
      await page.setViewportSize({ width: 1440, height: 1000 });
    },
  );
  await pass(
    'Shoulder flow supports single, boolean, text and multi input with explicit Continue',
    async () => {
      await page
        .getByRole('button', { name: 'Use this location & continue' })
        .click();
      let questions = 0,
        multiChecked = false;
      while ((await page.locator('.question').count()) && questions < 15) {
        const prompt = await page.locator('.question__prompt').textContent();
        assert.equal(
          await page
            .getByRole('button', { name: 'Continue', exact: true })
            .isDisabled(),
          true,
        );
        if (await page.locator('.question textarea').count())
          await page
            .getByLabel('Your answer', { exact: true })
            .fill('lifting the arm above my head');
        else if (await page.getByRole('checkbox').count()) {
          await page.getByRole('checkbox').nth(0).check();
          await page.getByRole('checkbox').nth(1).check();
          assert.equal(
            await page.locator('.question__prompt').textContent(),
            prompt,
          );
          assert.equal(
            await page.locator('input[type=checkbox]:checked').count(),
            2,
          );
          multiChecked = true;
          await screenshot('interview-multi');
        } else {
          const no = page.getByRole('radio', { name: 'No', exact: true });
          if (await no.count()) await no.check();
          else await page.getByRole('radio').first().check();
        }
        await page
          .getByRole('button', { name: 'Continue', exact: true })
          .click();
        questions++;
      }
      assert.ok(multiChecked);
      assert.equal(questions, 8);
    },
  );
  await pass(
    'Review precedes save; generated summary, copy and history use real persisted data',
    async () => {
      await page
        .getByRole('button', { name: 'Review current details' })
        .click();
      await page
        .getByRole('heading', { name: 'Review before saving' })
        .waitFor();
      await screenshot('review-desktop');
      await page.getByRole('button', { name: 'Save & build summary' }).click();
      await page.getByRole('heading', { name: 'Pre-visit summary' }).waitFor();
      await page.getByRole('button', { name: 'Copy complete summary' }).click();
      const copied = await page.evaluate(() => navigator.clipboard.readText());
      assert.ok(copied.includes('Data sources'));
      assert.ok(copied.includes('not a diagnosis'));
      await screenshot('summary-desktop');
      for (const width of [768, 375]) {
        await page.setViewportSize({ width, height: 1000 });
        await noOverflow();
        await screenshot(`summary-${width}`);
      }
      await page.getByRole('button', { name: 'Personal health map' }).click();
      await page.locator('.episode').first().waitFor();
      await noOverflow();
      await page.locator('.episode > summary').first().click();
      assert.ok(
        await page.locator('.episode__detail .own-words').first().isVisible(),
      );
      await screenshot('history-375');
      await page.setViewportSize({ width: 1440, height: 1000 });
      await screenshot('history-desktop');
    },
  );
  await pass(
    'Clipboard rejection provides a manual copy path; new episode dialog can cancel',
    async () => {
      await page.getByRole('button', { name: 'Return to your record' }).click();
      await page.evaluate(() => {
        navigator.clipboard.writeText = async () => {
          throw new Error('Permission denied');
        };
      });
      await page
        .getByRole('button', {
          name: /Copy complete summary|Copied to clipboard/,
        })
        .click();
      await page
        .getByText(
          'Clipboard unavailable. Open the text below and copy it manually.',
        )
        .waitFor();
      await page
        .getByText('View summary as plain text', { exact: true })
        .click();
      assert.ok(
        (await page.getByLabel('Complete summary text').inputValue()).includes(
          'Data sources',
        ),
      );
      await page
        .getByRole('button', { name: 'Start a new episode', exact: true })
        .click();
      await page.getByRole('dialog').waitFor();
      await page.keyboard.press('Escape');
      assert.equal(await page.getByRole('dialog').count(), 0);
      assert.ok(
        await page
          .getByRole('heading', { name: 'Pre-visit summary' })
          .isVisible(),
      );
    },
  );
  await pass(
    'A failed save leaves draft details visible and can be retried',
    async () => {
      await enter('right knee pain');
      await page.locator('.subregion-option').first().click();
      await page
        .getByRole('button', { name: 'Use this location & continue' })
        .click();
      await page
        .getByRole('button', { name: 'Review current details' })
        .click();
      await page.route('**/api/episodes', (route) => route.abort());
      await page.getByRole('button', { name: 'Save & build summary' }).click();
      await page
        .getByRole('heading', { name: 'Your record could not be saved.' })
        .waitFor();
      assert.ok(
        await page.getByText('right knee pain', { exact: true }).isVisible(),
      );
      assert.equal(
        await page
          .getByRole('button', { name: 'Save & build summary' })
          .isEnabled(),
        true,
      );
      await screenshot('save-error');
      await page.unroute('**/api/episodes');
    },
  );
  await pass(
    'Other supported regions and Chinese input complete actual questionnaires and save',
    async () => {
      for (const phrase of ['neck pain', 'lower back pain', '右膝疼痛']) {
        await enter(phrase);
        if (phrase === 'lower back pain')
          assert.equal(
            await page
              .getByRole('radio', { name: 'Back', exact: true })
              .isChecked(),
            true,
          );
        await page.locator('.subregion-option').first().click();
        await page
          .getByRole('button', { name: 'Use this location & continue' })
          .click();
        let attempts = 0;
        while ((await page.locator('.question').count()) && attempts++ < 15) {
          if (await page.locator('.question textarea').count())
            await page
              .getByLabel('Your answer', { exact: true })
              .fill('moving after sitting');
          else if (await page.getByRole('checkbox').count()) {
            await page.getByRole('checkbox').first().check();
            await page.getByRole('checkbox').nth(1).check();
          } else {
            const no = page.getByRole('radio', { name: 'No', exact: true });
            if (await no.count()) await no.check();
            else await page.getByRole('radio').first().check();
          }
          await page
            .getByRole('button', { name: 'Continue', exact: true })
            .click();
        }
        assert.ok(attempts < 15);
        await page
          .getByRole('button', { name: 'Review current details' })
          .click();
        await page
          .getByRole('button', { name: 'Save & build summary' })
          .click();
        await page
          .getByRole('heading', { name: 'Pre-visit summary' })
          .waitFor();
      }
    },
  );
  await pass(
    'Unavailable localisation preserves input and shows an actionable error',
    async () => {
      await page.goto(url);
      await page.route('**/api/localise', (route) => route.abort());
      await page
        .getByLabel('What has been bothering you?')
        .fill('right shoulder pain');
      await page.getByRole('button', { name: 'Locate on body map' }).click();
      await page.getByRole('alert').waitFor();
      assert.equal(
        await page.getByLabel('What has been bothering you?').inputValue(),
        'right shoulder pain',
      );
      await screenshot('network-error');
      await page.unroute('**/api/localise');
    },
  );
  await pass(
    'History loading, empty and failure states are distinct (transport fixtures)',
    async () => {
      await page.route('**/api/episodes?*', async (route) => {
        await new Promise((resolve) => setTimeout(resolve, 500));
        await route.fulfill({ json: [] });
      });
      await page.getByRole('button', { name: 'Personal health map' }).click();
      await page
        .getByRole('heading', { name: 'Loading your health map…' })
        .waitFor();
      await page
        .getByRole('heading', {
          name: 'Your health map starts with one episode.',
        })
        .waitFor();
      await screenshot('empty-history');
      await page.unroute('**/api/episodes?*');
      await page.route('**/api/episodes?*', (route) => route.abort());
      await page.getByRole('button', { name: 'Refresh records' }).click();
      await page.getByRole('alert').waitFor();
      await screenshot('history-error');
      await page.unroute('**/api/episodes?*');
    },
  );
  await pass(
    'All frontend interactions have no uncaught browser exceptions',
    async () => {
      assert.deepEqual(errors, []);
    },
  );
  console.log(`PASS ${count}/${count} browser scenarios`);
} finally {
  await browser.close();
}
