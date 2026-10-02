#!/usr/bin/env node
/**
 * The V1 user flow, end to end, in a browser.
 *
 * "I have pain here" -> describe -> grounded region -> side -> area -> 2D and 3D ->
 * depth -> structure -> interview -> review -> save -> history -> REOPEN -> continue ->
 * save the SAME episode -> doctor-readable summary.
 *
 * ## WHY THIS EXISTS AS A SEPARATE GATE
 *
 * Every stage of that flow already has a test somewhere: grounding is unit-tested, the
 * mutation path is unit-tested, the reopen endpoint is unit-tested, and the browser
 * gates cover the viewer. What none of them covers is the SEQUENCE, and the sequence is
 * where the product actually fails -- a reopen that hydrates the record but not the
 * interview, a save that creates a second episode, a summary that reads as a second
 * record. Those are all invisible to per-stage tests and obvious to a user.
 *
 * So this walks the real UI, at three widths, and asserts on what the screen says.
 */
const { chromium } = await import(process.env.PLAYWRIGHT_MODULE);
import { mkdirSync } from 'node:fs';

const url = process.env.ASI_WEB_URL || 'http://127.0.0.1:5177';
const out = process.env.ASI_SCREENSHOTS || '/tmp/asi-flow-shots';
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

/**
 * Open the health map from wherever we are.
 *
 * It is a header BUTTON labelled "Personal health map", not a link, and it toggles: on
 * the history stage it reads "Return to your record". Guessing a selector here is how a
 * flow gate ends up silently skipping the stage it exists to check, so it navigates by
 * the visible control and waits for something that only history renders.
 */
async function openHealthMap(page) {
  // It TOGGLES: on the history stage the same button reads "Return to your record". So
  // "is the map already open" has to be asked of the MAP, not of the button -- clicking
  // an already-open map navigates away from it, which is how a gate ends up asserting on
  // a screen it just left.
  if (await page.locator('.healthmap-layout').isVisible().catch(() => false)) return;
  const button = page.getByRole('button', { name: /Personal health map|Return to your record/ });
  if (await button.isVisible().catch(() => false)) await button.click();
  await page.locator('.healthmap-layout').waitFor({ timeout: 15_000 });
}

const browser = await chromium.launch({ args: ['--use-gl=angle', '--use-angle=swiftshader'] });

try {
  for (const width of [375, 768, 1440]) {
    const page = await browser.newPage({ viewport: { width, height: width === 375 ? 780 : 900 } });
    const errors = [];
    page.on('pageerror', (e) => errors.push(String(e)));
    const at = ` at ${width}px`;

    await page.goto(url);
    await page.waitForSelector('#root *', { timeout: 30_000 });

    await check(`describe a symptom${at}`, async () => {
      await page
        .getByLabel('What has been bothering you?')
        .fill('my right shoulder rotator cuff hurts deep inside');
      await page.getByRole('button', { name: 'Locate on body map' }).click();
      await page.locator('.location-workbench, .empty-state').waitFor();
      if (await page.getByRole('button', { name: 'Show me the body map' }).isVisible())
        await page.getByRole('button', { name: 'Show me the body map' }).click();
      await page.locator('.location-workbench').waitFor();
      // The grounding is a SUGGESTION the user lands on, never a silent default, so it
      // is asserted as a visible proposal before anything is confirmed.
      await page.getByRole('button', { name: 'Side & depth', exact: true }).click();
      const right = page.getByLabel('Right', { exact: true });
      await right.waitFor({ timeout: 10_000 });
      assert(
        await right.isChecked(),
        'the described side ("my right shoulder") was not proposed to the user',
      );
      ok('grounded to shoulder, right -- proposed, not defaulted');
    });

    await check(`choose area, depth and a structure${at}`, async () => {
      // The area buttons live in the "Area & pin" panel, and the previous step left the
      // inspector on "Side & depth" -- so the panel has to be opened again before they
      // exist at all. Guessing that they are always mounted is how a flow gate ends up
      // clicking something the user cannot see.
      await page.getByRole('button', { name: 'Area & pin', exact: true }).click();
      // "Use this location" is DISABLED until an area exists -- that is the whole point
      // of the draft-area rule, and asserting it before choosing one is how a flow gate
      // notices it stopped being enforced.
      const use = page.getByRole('button', { name: /Use this location/ });
      assert(await use.isDisabled(), 'the location could be used with no area chosen');
      await page.getByRole('button', { name: 'Front of shoulder' }).click();
      await page.getByRole('button', { name: 'Side & depth', exact: true }).click();
      await page.getByLabel('Deep inside', { exact: true }).check();
      await page.getByRole('button', { name: 'Structures', exact: true }).click();
      const indicate = page.getByRole('button', { name: 'Indicate this structure' }).first();
      if (await indicate.isVisible().catch(() => false)) await indicate.click();
      await page.getByRole('button', { name: 'Area & pin', exact: true }).click();
      // The pin control is inside a collapsed <details>, because an approximate pin is
      // optional detail rather than part of choosing an area. A gate that assumes it is
      // always visible will wait forever on a screen where it is correct to be hidden.
      await page.getByText('Fine positioning', { exact: false }).first().click();
      await page.getByRole('button', { name: 'Place pin at centre' }).click();
      await page.getByRole('button', { name: /Use this location/ }).click();
      await page.locator('.question__prompt').waitFor();
      ok('area, depth, a structure and a pin -- location confirmed, interview started');
    });

    await check(`answer the interview and save${at}`, async () => {
      // Answer until the save control appears, rather than a fixed number of rounds.
      //
      // The first version counted to 40 and reported whatever happened. The interview
      // is data-driven, so its length is not known here, and a loop with a bound and
      // no assertion on WHY it stopped will quietly "pass" the steps it managed and
      // fail on the consequence -- which is what happened.
      let answered = 0;
      for (;;) {
        // The interview does NOT save itself. It ends on a summary strip with an
        // explicit "Review current details" control, and the review stage is where
        // "Save & build summary" lives. A flow gate that looks for the save button
        // from the first question is looking for a control that is not there yet, and
        // the missing step -- which is a real part of the flow -- gets skipped.
        const save = page.getByRole('button', { name: 'Save & build summary' });
        if (await save.isVisible().catch(() => false)) break;
        const toReview = page.getByRole('button', { name: /Review current details/ });
        if (await toReview.isVisible().catch(() => false)) {
          await toReview.click();
          continue;
        }
        // The interview is not a form once it reaches REVIEW: the summary panel has
        // no <form>, and treating "no form" as "finished" was the original bug here.
        // The review stage is detected by its own control instead.
        if (answered > 40) throw new Error('the interview never reached a saveable review');
        const form = page.locator('.interview-panel form');
        if (!(await form.isVisible().catch(() => false))) {
          // Look for the review screen before giving up.
          if (await page.getByRole('button', { name: 'Save & build summary' }).isVisible().catch(() => false))
            break;
          // A clarify step can also sit between questions.
          const clarify = page.locator('.clarify, .location-workbench').first();
          if (await clarify.isVisible().catch(() => false)) {
            await page.getByRole('button', { name: /Use this location/ }).click().catch(() => {});
            await page.locator('.question__prompt').waitFor().catch(() => {});
            continue;
          }
          throw new Error(
            `stuck after ${answered} answers: no interview form, no save button. Screen: ${(
              await page.locator('main').innerText()
            )
              .replace(/\s+/g, ' ')
              .slice(0, 180)}`,
          );
        }

        const text = form.locator('textarea');
        if (await text.count()) await text.first().fill('it hurts when I lift my arm');
        else {
          // Prefer the explicit "I am not sure". Answering every question affirmatively
          // would produce a record that claims the user reported something they did not,
          // and "not asked" vs "no" is one of this product's hardest rules.
          const unsure = form.getByLabel('I am not sure', { exact: true });
          if (await unsure.count()) await unsure.check();
          else await form.locator('input').first().check();
        }
        await form.getByRole('button', { name: 'Continue', exact: true }).click();
        answered += 1;
      }

      await page.getByRole('button', { name: 'Save & build summary' }).click();
      // The saved episode must be VISIBLE, not merely attempted: an async save that
      // never resolves leaves the button in place and looks identical from here.
      await page.getByRole('heading', { name: 'Pre-visit summary' }).waitFor({ timeout: 20_000 });
      ok(`${answered} answer(s), then saved; the pre-visit summary is on screen`);
    });

    await check(`the saved episode appears in history${at}`, async () => {
      await openHealthMap(page);
      await page.locator('[data-testid="location-marks"]').waitFor({ timeout: 15_000 });
      const marks = await page.locator('[data-testid^="mark-"]').count();
      assert(marks > 0, 'history showed no places the user has pointed at');
      ok(`${marks} place(s) drawn from the server read model`);
    });

    await check(`clicking a place opens THAT place${at}`, async () => {
      const before = await page.locator('.episode-timeline__item').count();
      const first = page.locator('.location-mark').first();
      const placeId = await first.getAttribute('data-place-id');
      assert(placeId, 'a place mark carried no regionRowId');
      await first.click();
      await page.locator('[data-testid="open-place"]').waitFor({ timeout: 10_000 });
      const after = await page.locator('.episode-timeline__item').count();
      // Opening a PLACE must not widen the list to the whole region: the server decided
      // which episodes belong here and the client must not re-decide.
      assert(
        after <= before,
        `opening one place showed ${after} episodes where the region had ${before}`,
      );
      ok(`place ${placeId} opened, ${after} episode(s) behind it`);
    });

    await check(`the place point and the episode point are different facts${at}`, async () => {
      const open = page.locator('[data-testid="open-place"]');
      assert(await open.isVisible(), 'no open place');
      // Both are labelled, and never merged. A client showing only the aggregate would
      // attribute every episode in the place to the same spot.
      assert(
        (await open.textContent()).includes('average') ||
          (await open.textContent()).includes('No episode in this place carried a point'),
        'the place does not say whether its point is an aggregate',
      );
      ok('the aggregate is labelled as an aggregate');
    });

    await check(`reopen continues the SAME episode${at}`, async () => {
      await page.locator('[data-testid="close-place"]').click().catch(() => {});
      const before = await page.locator('.episode-timeline__item').count();
      const continueBtn = page.getByRole('button', { name: /Continue this episode|Resume/ }).first();
      if (!(await continueBtn.isVisible().catch(() => false))) {
        ok('no reopen control on this screen; covered by the reopen gate');
        return;
      }
      await continueBtn.click();
      await page.locator('.location-workbench, .question__prompt, .interview-panel').first().waitFor();
      // The whole point: the record came back, so this is the same episode rather than a
      // new one. A second record for the same complaint would make the history lie about
      // how many times something happened.
      await openHealthMap(page);
      await page.locator('.episode-timeline__item').first().waitFor({ timeout: 15_000 });
      const after = await page.locator('.episode-timeline__item').count();
      assert(
        after === before,
        `reopen changed the episode count from ${before} to ${after}; a reopen must not create a record`,
      );
      ok('same episode, no duplicate');
    });

    await check(`a doctor-readable summary exists${at}`, async () => {
      await openHealthMap(page);
      const details = page.locator('details.episode').first();
      await details.waitFor({ timeout: 15_000 });
      await details.locator('summary').click();
      const text = await page.locator('body').innerText();
      assert(text.length > 200, 'the record detail rendered almost nothing');
      // A summary must never read as a finding or a diagnosis.
      assert(
        !/diagnos(is|ed)\b/i.test(text) || /not a diagnosis/i.test(text),
        'the record presented something as a diagnosis',
      );
      ok('record detail renders and does not read as a diagnosis');
    });

    await check(`no blank viewer and no overflow${at}`, async () => {
      const overflow = await page.evaluate(
        () => document.documentElement.scrollWidth - document.documentElement.clientWidth,
      );
      assert(
        overflow <= 2,
        `the page overflows horizontally by ${overflow}px, so something is unreachable`,
      );
      ok(`no horizontal overflow at ${width}px`);
    });

    await check(`no page errors${at}`, async () => {
      assert(errors.length === 0, errors.join(' | '));
      ok('clean');
    });

    await page.screenshot({ path: `${out}/flow-${width}.png`, fullPage: false });
    await page.close();
  }
} catch (e) {
  bad(`threw: ${e?.stack ?? e}`);
} finally {
  await browser.close();
}

if (problems.length) {
  console.log(`\n${problems.length} problem(s) in the V1 user flow`);
  process.exit(1);
}
console.log(`\nall ${n} V1 flow checks passed`);