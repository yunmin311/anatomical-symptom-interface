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
  /* ---------------------------------------------------------------- */
  /* 2D / keyboard alternative to 3D picking                          */
  /* ---------------------------------------------------------------- */

  // Done EARLY, on the freshly grounded episode. Candidates come from localisation, so a
  // reopened episode legitimately has none, and checking there asserted an empty list was
  // "no keyboard equivalent" -- a false accusation of the product.
  //
  // The 3D raycast is a POINTER affordance. The structure list is the keyboard and
  // screen-reader equivalent. Without it, "structures can only be chosen by clicking the
  // mesh" and the product is unusable for anyone not using a mouse.
  await page.getByRole('button', { name: 'Structures', exact: true }).click();
  const candidateItems = page.locator('[data-testid^="candidate-"]');
  await candidateItems.first().waitFor({ timeout: 10_000 });
  const itemCount = await candidateItems.count();
  assert.ok(itemCount > 0, 'localisation produced no structure suggestions at all');

  // And it must be operable from the keyboard.
  const firstCandidate = candidateItems.first();
  const firstCandidateId = await firstCandidate.getAttribute('data-testid');
  const button = firstCandidate.getByRole('button', { name: 'Indicate this structure' }).first();
  assert.ok(
    (await button.count()) > 0,
    `${firstCandidateId} has no "Indicate this structure" button, so it cannot be chosen without the canvas`,
  );
  await button.focus();
  await page.keyboard.press('Enter');
  await page.waitForTimeout(300);
  const selectedCount = await page
    .locator('[data-testid^="candidate-"].candidate-item--selected')
    .count();
  assert.ok(
    selectedCount > 0,
    'a structure could not be indicated from the list using the keyboard',
  );
  await scan('location-structures');
  console.log(`ok   ${itemCount} structure controls, selectable by keyboard, no 3D canvas needed`);

  await page
    .getByRole('button', { name: 'Use this location & continue' })
    .click();
  await scan('interview');

  // Answer ONE question before reviewing.
  //
  // The review screen's answer corrections only exist for questions that HAVE been
  // answered, and this walk used to go straight from the first question to the review
  // screen. Every correction control was therefore unrendered and unscanable, and the
  // check that followed asserted they were reachable and failed -- having proved nothing
  // about the controls themselves. One answer makes them real.
  const firstForm = page.locator('.interview-panel form');
  await firstForm.waitFor({ timeout: 10_000 });
  const unsureOption = firstForm.getByLabel('I am not sure', { exact: true });
  if (await unsureOption.count()) await unsureOption.check();
  else await firstForm.locator('input').first().check();
  await firstForm.getByRole('button', { name: 'Continue', exact: true }).click();

  await page.getByRole('button', { name: 'Review current details' }).click();
  await scan('review');
  await page.getByRole('button', { name: 'Save & build summary' }).click();
  await page.getByRole('heading', { name: 'Pre-visit summary' }).waitFor();
  await scan('summary');
  await page.getByRole('button', { name: 'Personal health map' }).click();
  await page.locator('.episode').first().waitFor();
  await scan('history');

  /* ------------------------------------------------------------------ */
  /* The controls that only exist on a path the six-screen walk missed   */
  /* ------------------------------------------------------------------ */

  // COLLAPSED history controls. `details.episode` starts closed, so the reopen control,
  // the place panel and every button inside an episode were never scanned -- and an
  // unlabelled control inside a collapsed disclosure is exactly the kind of thing axe
  // never sees until it is open.
  const firstEpisode = page.locator('details.episode').first();
  await firstEpisode.waitFor({ timeout: 15_000 });
  await scan('history-collapsed');
  const episodeSummary = firstEpisode.locator('summary').first();
  if ((await firstEpisode.getAttribute('open')) === null) await episodeSummary.click();
  await firstEpisode.locator('button', { hasText: /Continue this episode|Resume/ }).first()
    .waitFor({ timeout: 10_000 });
  await scan('history-episode-open');

  // The place panel: a map of places with its own controls.
  const marks = page.locator('[data-testid="location-marks"]');
  if (await marks.isVisible().catch(() => false)) {
    await scan('health-map-places');
  }

  /* ------------------------------------------------------------------ */
  /* EDIT-ANSWER controls, and the keyboard path to reach them           */
  /* ------------------------------------------------------------------ */

  // These exist only on an UNSAVED review screen, which the walk above passed through
  // having saved. Reopen the episode so the corrections are real, then scan them.
  await firstEpisode
    .locator('button', { hasText: /Continue this episode|Resume/ })
    .first()
    .click();
  await page
    .locator('.experience-layout, .review-layout, .interview-panel, main')
    .first()
    .waitFor({ timeout: 15_000 });
  const toReview = page.getByRole('button', { name: /Review current details/i }).first();
  if (await toReview.isVisible().catch(() => false)) await toReview.click();
  await page.locator('.review-layout, .summary').first().waitFor({ timeout: 15_000 });

  const editLink = page.locator('[data-testid^="edit-answer-"]').first();
  const editCount = await page.locator('[data-testid^="edit-answer-"]').count();
  if (editCount > 0) {
    await editLink.waitFor({ timeout: 10_000 });
    await scan('review-edit-answers');

    /* ---------------------------------------------------------------- */
    /* KEYBOARD: reach a correction without a mouse                       */
    /* ---------------------------------------------------------------- */

    // A correction control that only responds to a pointer is a correction control the
    // keyboard user does not have. Focus it with the keyboard, activate it with the
    // keyboard, and confirm the correction UI opened.
    await editLink.focus();
    const focused = await page.evaluate(() =>
      document.activeElement?.getAttribute('data-testid') ?? null,
    );
    assert.ok(
      focused && focused.startsWith('edit-answer-'),
      `the correction control cannot take keyboard focus (activeElement was ${focused})`,
    );
    await page.keyboard.press('Enter');
    await page.locator('.interview-edit-banner').waitFor({ timeout: 10_000 });
    await scan('interview-edit-banner');

    // And it can be dismissed from the keyboard, so a correction is not a trap.
    const cancel = page.getByRole('button', { name: 'Cancel' });
    await cancel.focus();
    await page.keyboard.press('Enter');
    await page.locator('.interview-edit-banner').waitFor({ state: 'detached', timeout: 10_000 });
    console.log('ok   the correction path is reachable and dismissible by keyboard');
  } else {
    // NOT a skip-and-pass. An episode with answers must offer corrections; if it does not,
    // that is a failure, not an excuse.
    assert.fail(
      'a reopened episode offered no answer corrections; the edit-answer controls are unreachable',
    );
  }

  console.log(
    'PASS entry, location, structures, interview, edit banner, review, edit answers, summary, ' +
      'collapsed history, open episode and health map, at 3 widths; keyboard paths proven',
  );
} finally {
  await browser.close();
}
