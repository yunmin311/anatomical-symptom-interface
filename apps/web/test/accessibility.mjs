import assert from 'node:assert/strict';
const { chromium } = await import(
  process.env.PLAYWRIGHT_MODULE || 'playwright'
);
const { default: AxeBuilder } = await import(
  process.env.AXE_MODULE || '@axe-core/playwright'
);
const browser = await chromium.launch({
  headless: true,
  ...(process.env.CHROMIUM_PATH
    ? { executablePath: process.env.CHROMIUM_PATH }
    : {}),
});
const context = await browser.newContext({
  viewport: { width: 1440, height: 1000 },
});
const page = await context.newPage();
async function scan(name) {
 for (const width of [1440, 768, 375]) {
  await page.setViewportSize({width, height: 1000});
  const result = await new AxeBuilder({ page })
    .withTags(['wcag2a', 'wcag2aa', 'wcag21aa'])
    .analyze();
  const violations = result.violations.map((v) => ({
    id: v.id,
    impact: v.impact,
    nodes: v.nodes.map((n) => ({
      target: n.target,
      summary: n.failureSummary,
    })),
  }));
  console.log(`${name} ${width}`, JSON.stringify(violations));
  assert.deepEqual(violations, [], `${name} ${width}`);
 }
}
try {
  await page.goto(process.env.ASI_WEB_URL || 'http://127.0.0.1:5189');
  await scan('entry');
  await page
    .getByLabel('What has been bothering you?')
    .fill('right shoulder rotator cuff');
  await page.getByRole('button', { name: 'Locate on body map' }).click();
  await page.locator('.location-workbench').waitFor();
  await scan('location');
  await page
    .getByRole('button', { name: /Front of shoulder/ })
    .click();
  await page
    .getByRole('button', { name: 'Use this location & continue' })
    .click();
  await scan('interview');
  await page.getByRole('button', { name: 'Review current details' }).click();
  await scan('review');
  await page.getByRole('button', { name: 'Save & build summary' }).click();
  await page.getByRole('heading', { name: 'Pre-visit summary' }).waitFor();
  await scan('summary');
  await page.getByRole('button', { name: 'Personal health map' }).click();
  await page.locator('.episode').first().waitFor();
  await scan('history');
  console.log('PASS 6 screens at 3 widths (18 accessibility scans)');
} finally {
  await browser.close();
}
