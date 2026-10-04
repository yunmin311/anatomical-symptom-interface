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
      const right = page.getByLabel('Right', { exact: true });
      await right.waitFor({ timeout: 10_000 });
      assert(
        await right.isChecked(),
        'the described side ("my right shoulder") was not proposed to the user',
      );
      ok('grounded to shoulder, right -- proposed, not defaulted');
    });

    await check(`choose area, depth and a structure${at}`, async () => {
      // The area buttons live in the "Area & pin" panel, so the gate opens it
      // rather than assuming they are mounted — "the step did not happen" and
      // "the step passed" have to stay distinguishable. Side and depth no longer
      // share the inspector, so opening this panel no longer has to undo whatever
      // tab the previous step left behind.
      await page.getByRole('button', { name: 'Area & pin', exact: true }).click();
      // "Use this location" is DISABLED until an area exists -- that is the whole point
      // of the draft-area rule, and asserting it before choosing one is how a flow gate
      // notices it stopped being enforced.
      const use = page.getByRole('button', { name: /Use this location/ });
      assert(await use.isDisabled(), 'the location could be used with no area chosen');
      await page.getByRole('button', { name: 'Front of shoulder' }).click();
      await page.getByLabel('Deep inside', { exact: true }).check();
      await page.getByRole('button', { name: 'Structures', exact: true }).click();
      // NOT conditional. This used to be `if (visible) click`, which made "the structure
      // step did not happen" indistinguishable from "the structure step passed" -- and the
      // check is named "area, depth, a structure and a pin", so a run that pointed at
      // nothing while a structure was available reported success. Structure selection is
      // the one step in this flow that only exists in 3D, so skipping it silently is
      // exactly the substitution this project forbids.
      const indicate = page.getByRole('button', { name: 'Indicate this structure' }).first();
      await indicate.waitFor({ timeout: 10_000 });
      await indicate.click();
      await page
        .locator('[data-testid^="candidate-"].candidate-item--selected')
        .first()
        .waitFor({ timeout: 10_000 });
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
      //
      // The second version tested "Review current details" BEFORE testing the interview
      // form. That button is rendered unconditionally in the interview stage, so the loop
      // left the interview on its first iteration and saved an episode with ZERO answers
      // -- at every width, reported as "0 answer(s), then saved; the summary is on
      // screen". The gate had been asserting the end of the flow and never its middle.
      // The form is now tested FIRST: leaving the interview is only offered once there is
      // no question left to answer.
      let answered = 0;
      for (;;) {
        if (answered > 60)
          throw new Error('the interview never reached a saveable review');
        const save = page.getByRole('button', { name: 'Save & build summary' });
        if (await save.isVisible().catch(() => false)) break;

        const form = page.locator('.interview-panel form');
        if (await form.isVisible().catch(() => false)) {
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
          continue;
        }

        // No question form. Either the interview has finished, or a clarify/location step
        // sits between questions -- and neither can be told apart from here alone.
        if (await save.isVisible().catch(() => false)) break;
        const clarify = page.locator('.clarify, .location-workbench').first();
        if (await clarify.isVisible().catch(() => false)) {
          await page.getByRole('button', { name: /Use this location/ }).click().catch(() => {});
          await page.locator('.question__prompt').waitFor().catch(() => {});
          continue;
        }
        // The interview panel showed its end state, so reviewing is the way out. Only NOW
        // is clicking this the same thing a user does.
        const toReview = page.getByRole('button', { name: /Review current details/ }).first();
        if (await toReview.isVisible().catch(() => false)) {
          await toReview.click();
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

      assert(
        answered > 0,
        'the episode was saved with no answers at all; the interview was skipped, not completed',
      );
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
      await openHealthMap(page);
      await page.locator('.episode-timeline__item').first().waitFor({ timeout: 15_000 });
      const before = await page.locator('.episode-timeline__item').count();

      // The control lives inside the episode's collapsed <details>, so the panel must be
      // EXPANDED before looking for it.
      //
      // This check used to report "no reopen control on this screen; covered by the reopen
      // gate" and PASS. It was checking a collapsed panel for a control that only exists
      // once expanded -- so the gate asserted nothing at all, on the one behaviour that
      // makes longitudinal history work. A gate that passes when the feature is missing
      // is worse than no gate: it reports the feature as covered.
      const details = page.locator('details.episode').first();
      await details.waitFor({ timeout: 15_000 });
      const summary = details.locator('summary').first();
      if ((await details.getAttribute('open')) === null)
        await summary.click();

      const continueBtn = page
        .locator('details.episode')
        .first()
        .getByRole('button', { name: /Continue this episode|Resume/ })
        .first();
      await continueBtn.waitFor({ timeout: 10_000 });

      await continueBtn.click();
      // Wait for the RECORD screen, not for an interview form. A reopened episode is
      // fully answered, so InterviewPanel returns its end state and renders no form at
      // all -- waiting for `.question__prompt` here waits for a control that will never
      // appear and reports a timeout that reads like a broken reopen.
      await page
        .locator('.experience-layout, .review-layout, .interview-panel, main')
        .first()
        .waitFor({ timeout: 15_000 });

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

    await check(`a correction replaces the answer it corrects${at}`, async () => {
      // The correction path, end to end in the browser: reach a question that was already
      // answered, correct it, and confirm the correction is both marked and effective.
      await page.locator('[data-testid="close-place"]').click().catch(() => {});

      // The previous check left the app ON THE HEALTH MAP, so the record screens do not
      // exist yet. Come back to the record first -- the same route a user takes.
      if (!(await page.locator('.review-layout, .experience-layout').first().isVisible().catch(() => false))) {
        const back = page.getByRole('button', { name: /Return to your record/ }).first();
        if (await back.isVisible().catch(() => false)) await back.click();
      }

      // A reopened, fully answered episode shows a bare EmptyState -- InterviewPanel
      // returns early when no question is next, so there is no `.interview-panel` to
      // wait for. Wait for any of the three screens this can be, then take the ordinary
      // "Review current details" route to the one that carries the correction controls.
      await page
        .locator('.experience-layout, .review-layout, main')
        .first()
        .waitFor({ timeout: 15_000 });

      const toReview = page
        .getByRole('button', { name: /Review current details/i })
        .first();
      if (await toReview.isVisible().catch(() => false)) await toReview.click();
      await page.locator('.review-layout, .summary').first().waitFor({ timeout: 15_000 });

      // Answer until the review panel offers a correction, or until the interview ends.
      let editLink = page.locator('[data-testid^="edit-answer-"]').first();
      for (let round = 0; round < 40; round++) {
        if (await editLink.isVisible().catch(() => false)) break;
        const option = page.locator('.answer-option input').first();
        if (!(await option.isVisible().catch(() => false))) break;
        await option.check().catch(() => {});
        const cont = page.getByRole('button', { name: 'Continue' });
        if (await cont.isVisible().catch(() => false)) await cont.click();
        await page.waitForTimeout(120);
      }

      await editLink.waitFor({ timeout: 10_000 });
      const questionId = (await editLink.getAttribute('data-testid')).replace(
        'edit-answer-',
        '',
      );
      await editLink.click();

      // The banner is the whole point: the user must be told they are REPLACING something.
      const banner = page.locator('.interview-edit-banner');
      await banner.waitFor({ timeout: 10_000 });
      assert(
        /replace/i.test(await banner.innerText()),
        'the correction banner does not say the previous answer is replaced',
      );

      // Answer differently from whatever is currently recorded.
      const options = page.locator('.answer-options .answer-option input');
      const count = await options.count();
      assert(count > 0, 'the correction did not re-present the question');
      await options.nth(count > 1 ? 1 : 0).check();
      await page.getByRole('button', { name: 'Continue' }).click();

      // Answering an edit target returns to the INTERVIEW, because that is where the
      // correction was made -- the confirmation lives on the review screen, so go back
      // the way a user would.
      const backToReview = page
        .getByRole('button', { name: /Review current details/i })
        .first();
      await backToReview.waitFor({ timeout: 10_000 });
      await backToReview.click();

      // Back in review, the corrected answer must be labelled as corrected.
      const corrected = page.locator(`[data-testid="edit-answer-${questionId}"]`);
      await corrected.waitFor({ timeout: 10_000 });
      const row = corrected.locator('xpath=..');
      assert(
        /changed this answer/i.test(await row.innerText()),
        'a corrected answer is not labelled as corrected on screen',
      );
      ok(`corrected ${questionId} and it is labelled as a change`);
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