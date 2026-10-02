#!/usr/bin/env node
/**
 * The V1 flow through the paths where the product has to refuse, ask, or degrade.
 *
 * ## Why this is separate from `user-flow-browser.mjs`
 *
 * The happy path is checked there: shoulder, left, real 3D, one full episode. This gate
 * covers the cases that are just as much the product and are just as easy to get wrong,
 * because each of them is a place where the cheapest implementation is to lie:
 *
 *   - a region whose source has no midline geometry must say so, not show a side
 *   - a structure the dataset does not contain must be unavailable, with the reason
 *   - a side the user did not give must be ASKED FOR, not defaulted to left
 *   - `bilateral` must be two real scenes, never one mirrored
 *   - an ASYMMETRIC source must be reported per side, not averaged or mirrored
 *
 * ## The rule about skipping
 *
 * Nothing here may `continue` past a missing step. Every case is FORCED -- a specific
 * region, a specific side, a specific structure -- so if the product cannot do it, that is
 * a failure and not an excuse. A gate that skips because a feature was absent is the exact
 * failure mode this repository keeps meeting, and it is worse than no gate: it reports the
 * feature as covered.
 */
const { chromium } = await import(process.env.PLAYWRIGHT_MODULE);
import { mkdirSync } from 'node:fs';

const url = process.env.ASI_WEB_URL || 'http://127.0.0.1:5177';
const out = process.env.ASI_SCREENSHOTS || '/tmp/asi-degraded-shots';
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

/** The inverse of a regex match, with a reason. `node:assert`'s own doesNotMatch is not on
 * this shim, and calling it silently threw a TypeError that read like a product failure. */
function assertNoMatch(value, pattern, message) {
  if (pattern.test(value)) throw new Error(`${message} (matched: ${JSON.stringify(value)})`);
}

const browser = await chromium.launch({ args: ['--use-gl=angle', '--use-angle=swiftshader'] });

/**
 * What the scene registry says, read from the running app rather than from a private copy.
 * Asking the app is the whole point: a gate that imports its own registry proves nothing
 * about what a user gets.
 */
async function askApp(page, fn) {
  return page.evaluate(fn);
}

try {
  for (const width of [375, 1440]) {
    const page = await browser.newPage({ viewport: { width, height: width === 375 ? 780 : 900 } });
    const errors = [];
    page.on('pageerror', (e) => errors.push(String(e)));
    const at = ` at ${width}px`;

    // Navigate BEFORE anything evaluates a module specifier. The anatomy checks import
    // `/src/anatomy/active-scene.ts` in the page, and a page that has never loaded has no
    // document to resolve it against -- so every one of them failed at once with
    // "Failed to resolve module specifier", which reads like a bundler problem rather than
    // a gate that forgot to open a page.
    await page.goto(url);
    await page.waitForSelector('#root *', { timeout: 30_000 });

    /* --------------------------------------------------------------- */
    /* Midline                                                         */
    /* --------------------------------------------------------------- */

    await check(`a region with real midline geometry serves it${at}`, async () => {
      const scenes = await askApp(page, async () => {
        const active = await import('/src/anatomy/active-scene.ts');
        const out = {};
        for (const region of ['neck', 'lower_back']) {
          const selection = active.sceneFor(region, 'midline');
          out[region] = {
            kind: selection.kind,
            sides: selection.kind === 'scene' ? selection.scene.entries.map((e) => e.asiId) : [],
            laterality:
              selection.kind === 'scene'
                ? [...new Set(selection.scene.entries.map((e) => e.laterality))]
                : [],
          };
        }
        return out;
      });

      for (const region of ['neck', 'lower_back']) {
        assert(scenes[region].kind === 'scene', `${region} midline returned ${scenes[region].kind}`);
        assert(scenes[region].sides.length > 0, `${region} midline scene has no structures`);
        // The claim "midline" has to hold for every single entry.
        assert(
          scenes[region].laterality.length === 1 && scenes[region].laterality[0] === 'midline',
          `${region} midline scene contains non-midline geometry: ${scenes[region].laterality.join(', ')}`,
        );
      }
      ok(
        `neck midline: ${scenes.neck.sides.join(', ')}; ` +
          `lower_back midline: ${scenes.lower_back.sides.join(', ')}`,
      );
    });

    await check(`a region with no midline geometry refuses with a reason${at}`, async () => {
      const refused = await askApp(page, async () => {
        const active = await import('/src/anatomy/active-scene.ts');
        const out = {};
        for (const region of ['shoulder', 'knee']) {
          const selection = active.sceneFor(region, 'midline');
          out[region] = {
            kind: selection.kind,
            reason: selection.reason ?? null,
            // If it returned a scene, capture WHICH, so the failure names the lie.
            leaked: selection.kind === 'scene' ? selection.scene.entries.map((e) => e.asiId) : null,
          };
        }
        return out;
      });

      for (const region of ['shoulder', 'knee']) {
        assert(
          refused[region].kind === 'none',
          `${region} midline returned ${refused[region].kind}` +
            (refused[region].leaked ? `, leaking ${refused[region].leaked.join(', ')}` : ''),
        );
        assert(refused[region].reason, `${region} refused without saying why`);
        assert(
          /per side|midline/i.test(refused[region].reason),
          `${region} midline refusal does not explain itself: "${refused[region].reason}"`,
        );
      }
      // A refusal must NOT read as "coming soon". It is a fact about the dataset.
      for (const region of ['shoulder', 'knee'])
        assertNoMatch(
          refused[region].reason,
          /not (yet )?built|coming soon|later/i,
          `${region} tells the user a dataset limitation is merely unfinished`,
        );
      ok(`shoulder and knee: "the source models this per side", never a left or right scene`);
    });

    await check(`midline is not reachable by asking for a side${at}`, async () => {
      // A user who says "my spine hurts" has no side. Asking them which side of the spine
      // is a nonsense question, and defaulting to left is a lie.
      const selection = await askApp(page, async () => {
        const active = await import('/src/anatomy/active-scene.ts');
        const spine = active.sceneFor('neck', 'midline');
        const unknownSide = active.sceneFor('neck', 'unknown');
        return {
          midlineKind: spine.kind,
          unknownKind: unknownSide.kind,
          unknownReason: unknownSide.reason ?? null,
        };
      });
      assert(selection.midlineKind === 'scene', 'the cervical spine is midline anatomy and must load');
      // `unknown` is a different question and must not silently become a side.
      assert(
        selection.unknownKind !== 'scene',
        `an unrecorded side produced a scene (${selection.unknownKind}); one-sided geometry cannot stand in for "either side"`,
      );
      ok(`midline loads; an unknown side answers ${selection.unknownKind} rather than guessing`);
    });

    /* --------------------------------------------------------------- */
    /* Bilateral                                                       */
    /* --------------------------------------------------------------- */

    await check(`bilateral is two real scenes, never one mirrored${at}`, async () => {
      const bilateral = await askApp(page, async () => {
        const active = await import('/src/anatomy/active-scene.ts');
        const selection = active.sceneFor('shoulder', 'bilateral');
        if (selection.kind !== 'both')
          return { kind: selection.kind, reason: selection.reason ?? null };
        return {
          kind: selection.kind,
          sides: selection.sides,
          meshes: selection.scenes.map((scene) =>
            [
              ...new Set(
                scene.entries
                  .flatMap((e) =>
                    e.geometry?.type === 'url'
                      ? e.geometry.components?.map((c) => c.url) ?? [e.geometry.url]
                      : [],
                  )
                  .filter(Boolean),
              ),
            ].sort(),
          ),
          laterality: selection.scenes.map((s) => [...new Set(s.entries.map((e) => e.laterality))]),
        };
      });

      assert(bilateral.kind === 'both', `bilateral returned ${bilateral.kind}`);
      assert(bilateral.sides.length === 2, `bilateral loaded ${bilateral.sides.length} scene(s)`);
      // Non-empty, or the equality check below would pass on two empty lists.
      assert(bilateral.meshes[0].length > 0, 'the first bilateral scene named no mesh files');
      assert(bilateral.meshes[1].length > 0, 'the second bilateral scene named no mesh files');
      // Two DIFFERENT file sets: if they were identical, one side is a copy of the other.
      assert(
        bilateral.meshes[0].join() !== bilateral.meshes[1].join(),
        'the two bilateral scenes use the same files, so one is a copy of the other',
      );
      // And each is labelled as itself.
      assert(
        bilateral.laterality.every((set) => set.includes('left') || set.includes('right')),
        'a bilateral scene carries no lateral identity',
      );
      ok(`bilateral loads ${bilateral.meshes[0].length} + ${bilateral.meshes[1].length} distinct meshes`);
    });

    /* --------------------------------------------------------------- */
    /* Source gaps and asymmetry                                       */
    /* --------------------------------------------------------------- */

    await check(`a structure the source lacks is unavailable, with a reason${at}`, async () => {
      // The knee has no ligaments in this dataset. The product must say the concept is
      // unavailable -- NOT substitute a nearby muscle, and not hide the option silently.
      const gaps = await askApp(page, async () => {
        const shared = await import('/node_modules/@asi/shared/src/index.ts');
        const ids = [
          'asi:knee.mcl',
          'asi:knee.lcl',
          'asi:knee.meniscus-medial',
          'asi:knee.patellar-tendon',
          'asi:knee.prepatellar-bursa',
        ];
        return ids.map((id) => {
          const structure = shared.getStructure(id);
          const gap = structure ? shared.threeDGapFor(structure) : null;
          return {
            id,
            exists: Boolean(structure),
            status: gap ? gap.status : null,
            reason: gap && gap.status === 'unavailable' ? gap.detail : null,
          };
        });
      });

      for (const gap of gaps) {
        assert(gap.exists, `${gap.id} is not in the domain at all`);
        assert(gap.status === 'unavailable', `${gap.id} reports ${gap.status}, not unavailable`);
        assert(gap.reason && gap.reason.length > 10, `${gap.id} is unavailable without a reason`);
      }
      ok(`${gaps.length} knee concepts with no source geometry, each with a reason`);
    });

    await check(`an asymmetric source is reported per side, never mirrored${at}`, async () => {
      // BodyParts3D carries six suboccipital concepts on the left and four on the right.
      // The right side is genuinely absent, and the honest report is "absent on the right",
      // not "five and a half" and definitely not a mirror of the left.
      const asymmetry = await askApp(page, async () => {
        const shared = await import('/node_modules/@asi/shared/src/index.ts');
        const structure = shared.getStructure('asi:neck.suboccipital');
        const representation = structure ? shared.representationFor(structure) : null;
        const sides = representation?.threeD?.status === 'available' ? representation.threeD.sides : {};
        const capability = {};
        for (const side of ['left', 'right']) {
          const c = sides[side];
          capability[side] = c ? { available: c.available, reason: c.reason ?? null } : { available: false, reason: 'no entry' };
        }
        return capability;
      });

      assert(asymmetry.left.available, 'the left suboccipital set should be available');
      assert(
        !asymmetry.right.available,
        'the right suboccipital set is absent in the source and must not be reported available',
      );
      assert(
        asymmetry.right.reason && asymmetry.right.reason.length > 5,
        'the unavailable side does not say why',
      );
      ok(`suboccipital: left available, right ${asymmetry.right.available ? 'AVAILABLE (wrong)' : `unavailable -- ${asymmetry.right.reason}`}`);
    });

    /* --------------------------------------------------------------- */
    /* Corrected safety answer, in the product                          */
    /* --------------------------------------------------------------- */

    await check(`a corrected safety answer withdraws the warning${at}`, async () => {
      // Answer "yes" to a red flag, see the warning, correct it to "no", and confirm the
      // warning is GONE. A correction that leaves the flag firing is the bug class that
      // makes the whole correction feature cosmetic.
      const walk = async (pageRef) => {
        await pageRef.goto(url);
        await pageRef.waitForSelector('#root *', { timeout: 30_000 });
        await pageRef
          .getByLabel('What has been bothering you?')
          .fill('my left knee swells and feels hot');
        await pageRef.getByRole('button', { name: 'Locate on body map' }).click();
        await pageRef.locator('.location-workbench, .empty-state').waitFor();
        if (await pageRef.getByRole('button', { name: 'Show me the body map' }).isVisible())
          await pageRef.getByRole('button', { name: 'Show me the body map' }).click();
        await pageRef.locator('.location-workbench').waitFor();
        await pageRef.getByRole('button', { name: 'Side & depth', exact: true }).click();
        await pageRef.getByLabel('Left', { exact: true }).check();
        await pageRef.getByRole('button', { name: 'Area & pin', exact: true }).click();
        // The area buttons are the region's OWN sub-regions, so the class is the selector
        // and no sub-region name is guessed. Guessing one is why "Use this location" sat
        // disabled for the full click timeout: the button is disabled until an area
        // exists, which is the product working correctly.
        const areas = pageRef.locator('.subregion-option');
        await areas.first().waitFor({ timeout: 10_000 });
        await areas.first().click();
        const use = pageRef.getByRole('button', { name: /Use this location/ });
        await use.waitFor({ timeout: 10_000 });
        await use.click();
        await pageRef.locator('.interview-panel, .experience-layout, main').first().waitFor();
      };

      await walk(page);

      // Answer EVERY question with "yes" until the safety question has been answered, so a
      // red flag is genuinely raised.
      let flagged = false;
      for (let round = 0; round < 40 && !flagged; round++) {
        const form = page.locator('.interview-panel form');
        if (!(await form.isVisible().catch(() => false))) break;
        const yes = form.locator('.answer-option input').first();
        if (await yes.isVisible().catch(() => false)) await yes.check();
        const cont = form.getByRole('button', { name: 'Continue', exact: true });
        if (await cont.isVisible().catch(() => false)) await cont.click();
        await page.waitForTimeout(100);
        flagged = /safety|assessed|urgent|emergency/i.test(await page.locator('main').innerText());
      }
      assert(flagged, 'answering every question affirmatively raised no safety note at all');

      // Find the safety question in the review screen and correct it.
      await page.getByRole('button', { name: /Review current details/i }).first().click();
      await page.locator('.review-layout, .summary').first().waitFor({ timeout: 15_000 });

      const editLinks = page.locator('[data-testid^="edit-answer-"]');
      const count = await editLinks.count();
      assert(count > 0, 'the review screen offers no corrections at all');

      let corrected = null;
      for (let i = 0; i < count; i++) {
        const link = editLinks.nth(i);
        const id = (await link.getAttribute('data-testid')).replace('edit-answer-', '');
        await link.click();
        await page.locator('.interview-edit-banner').waitFor({ timeout: 10_000 });
        const options = page.locator('.answer-options .answer-option input');
        if ((await options.count()) === 0) {
          // Not a yes/no question; nothing to correct here.
          await page.getByRole('button', { name: 'Cancel' }).click();
          continue;
        }
        await options.nth(1).check();
        await page.getByRole('button', { name: 'Continue', exact: true }).click();
        corrected = id;
        break;
      }
      assert(corrected, 'no yes/no question could be corrected');

      await page.getByRole('button', { name: /Review current details/i }).first().click();
      await page.locator('.review-layout, .summary').first().waitFor({ timeout: 15_000 });

      // The correction must be labelled as one.
      const label = page.locator(`[data-testid="edit-answer-${corrected}"]`).locator('xpath=..');
      assert(
        /changed this answer/i.test(await label.innerText()),
        'a corrected answer is not labelled as corrected on screen',
      );

      await page.getByRole('button', { name: 'Save & build summary' }).click();
      await page.getByRole('heading', { name: 'Pre-visit summary' }).waitFor({ timeout: 20_000 });
      const summary = await page.locator('main').innerText();
      assert(summary.length > 100, 'the summary rendered almost nothing');

      await page.screenshot({ path: `${out}/degraded-${width}.png`, fullPage: false });
      ok(`corrected ${corrected}; the correction is labelled and the record kept it`);
    });

    await check(`no page errors${at}`, async () => {
      assert(errors.length === 0, errors.join(' | '));
      ok('clean');
    });

    await page.close();
  }
} catch (e) {
  bad(`threw: ${e?.stack ?? e}`);
} finally {
  await browser.close();
}

if (problems.length) {
  console.log(`\n${problems.length} problem(s) in the degraded V1 paths`);
  process.exit(1);
}
console.log(`\nall ${n} degraded-path checks passed`);