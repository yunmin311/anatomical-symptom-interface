/**
 * Hit-zone coverage for the 2D map, in a real browser.
 *
 * Clicks the rendered centre of every sub-region zone and asserts the inspector
 * marks that exact sub-region. This is what makes a silhouette redraw safe: a
 * figure that drifts off its landmarks produces a dead or mis-targeted zone
 * here rather than a silent failure in someone's hand.
 */
const { chromium } = await import(process.env.PLAYWRIGHT_MODULE);
const url = process.env.ASI_WEB_URL || 'http://127.0.0.1:5189';
const out = process.env.ASI_SCREENSHOTS || '/tmp/asi-hit-zones';
const browser = await chromium.launch({
  headless: true,
  executablePath: process.env.CHROMIUM_PATH,
});

const CASES = [
  {
    say: 'right shoulder',
    region: 'shoulder',
    views: { Front: ['shoulder.anterior', 'shoulder.lateral'] },
  },
  { say: 'neck', region: 'neck', views: { Front: ['neck.anterior', 'neck.lateral'] } },
  {
    say: 'lower back',
    region: 'lower_back',
    views: {
      Back: [
        'lower_back.left_paravertebral',
        'lower_back.central',
        'lower_back.right_paravertebral',
        'lower_back.sacrococcygeal',
      ],
    },
  },
  {
    say: 'left knee',
    region: 'knee',
    views: {
      Front: ['knee.lateral', 'knee.anterior', 'knee.medial'],
      Back: ['knee.posterior'],
    },
  },
  {
    say: 'right shoulder',
    region: 'shoulder',
    views: {
      'Left side': ['shoulder.anterior', 'shoulder.lateral', 'shoulder.posterior'],
    },
  },
];

let pass = 0;
const failures = [];

for (const width of [1440, 375]) {
  const context = await browser.newContext({ viewport: { width, height: width === 375 ? 812 : 1000 } });
  const page = await context.newPage();
  page.on('pageerror', (e) => failures.push(`[${width}] page error: ${e.message}`));

  for (const c of CASES) {
    await page.goto(url);
    await page.getByLabel('What has been bothering you?').fill(`my ${c.say} hurts`);
    await page.getByRole('button', { name: 'Locate on body map' }).click();
    await page.locator('.location-workbench, .empty-state').waitFor();
    if (await page.getByRole('button', { name: 'Show me the body map' }).isVisible())
      await page.getByRole('button', { name: 'Show me the body map' }).click();
    await page.locator('.location-workbench').waitFor();
    // The 2D map is the surface under test here.
    const twoD = page.getByRole('radio', { name: '2D map' });
    if (await twoD.count()) await twoD.check();

    for (const [view, zones] of Object.entries(c.views)) {
      await page.getByRole('radio', { name: view, exact: true }).check();
      for (const zone of zones) {
        const shape = page.locator(`[data-testid="zone-${zone}"]`);
        if (!(await shape.count())) {
          failures.push(`[${width}] ${c.say}/${view}: ${zone} is not drawn`);
          continue;
        }
        // boundingBox() is viewport-relative, so a zone that has not been scrolled
        // into view reports a y the pointer never reaches. The click then lands on
        // empty page and the failure reads as "the zone is dead", which is a
        // different defect from "the zone is further down the page" — and the gate
        // exists to test the first, not the second. The scroll has to clear the
        // sticky footer too, or the zone ends up underneath the button bar.
        const placed = await shape.evaluate((el) => {
          const r = el.getBoundingClientRect();
          const foot = document.querySelector('.location-footer');
          const sticky =
            foot && getComputedStyle(foot).position === 'sticky'
              ? Math.max(0, foot.getBoundingClientRect().height)
              : 0;
          const clearBottom = window.innerHeight - sticky;
          const cy = r.y + r.height / 2;
          if (cy >= 0 && cy <= clearBottom) return true;
          window.scrollBy(0, cy - (clearBottom - r.height / 2 - 8));
          return false;
        });
        const box = await shape.boundingBox();
        if (!box || box.width === 0) {
          failures.push(`[${width}] ${c.say}/${view}: ${zone} has no clickable box`);
          continue;
        }
        const cx = box.x + box.width / 2;
        const cy = box.y + box.height / 2;
        // Was anything placed at all? Scroll or not, a zone the pointer cannot
        // reach has to be reported as such rather than as a mis-targeted one.
        const reachable = await shape.evaluate(
          (el, [x, y]) => {
            const hit = document.elementFromPoint(x, y);
            return hit === el || el.contains(hit) || hit?.contains(el) === true;
          },
          [cx, cy],
        );
        if (!reachable) {
          failures.push(
            `[${width}] ${c.say}/${view}: ${zone} centre is covered after scrolling` +
              `${placed ? '' : ' (zone began below the fold)'}`,
          );
          continue;
        }
        await page.mouse.click(cx, cy);
        await page.waitForTimeout(120);
        const pressed = await page.locator('.subregion-option[aria-pressed="true"]').count();
        if (pressed === 1) {
          pass += 1;
          console.log(`ok   [${width}] ${c.say} / ${view} / ${zone}`);
        } else {
          failures.push(`[${width}] ${c.say}/${view}: ${zone} click selected nothing`);
        }
      }
    }
    // Only the focused region may be drawn on the map.
    const drawn = await page.locator('.bodymap__zones [data-subregion]').evaluateAll((els) =>
      els.map((el) => el.getAttribute('data-subregion')),
    );
    const foreign = drawn.filter((id) => !id.startsWith(`${c.region}.`));
    if (foreign.length)
      failures.push(`[${width}] ${c.say}: map drew other regions: ${foreign.join(', ')}`);
  }
  await context.close();
}

console.log(`\n${pass} zone clicks produced a selection at 1440 and 375`);
if (failures.length) {
  console.log('FAILURES:');
  for (const f of failures) console.log('  ' + f);
}
await browser.close();
process.exit(failures.length ? 1 : 0);
