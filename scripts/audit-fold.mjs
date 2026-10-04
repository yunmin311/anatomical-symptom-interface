/**
 * Fold and overflow, measured on the real screen.
 *
 * Two questions only:
 *
 *   1. Does the document scroll sideways at a phone width? If it does, every
 *      screenshot and every "zone is reachable" claim is about a page the user
 *      has to pan, which is a defect on its own.
 *   2. Where does each region's zone land against the fold and against the
 *      sticky action bar? A zone the user must scroll to reach, or that sits
 *      under the bar, is not a zone they can use.
 *
 * It reports; it does not judge. The thresholds are the viewport itself.
 *
 * Usage: bash scripts/audit-fold.sh
 */
const { chromium } = await import(process.env.PLAYWRIGHT_MODULE);

const BASE = process.env.ASI_WEB_URL ?? 'http://127.0.0.1:5277';

const UTTERANCES = {
  shoulder: 'my right shoulder rotator cuff hurts deep inside when I lift my arm',
  neck: 'left neck pain going down into my arm when I turn my head',
  lowerBack: 'lower back ache on both sides in the middle',
  knee: 'my knee hurts on the inside going down stairs',
};

const WIDTHS = [
  { name: '375', width: 375, height: 812 },
  { name: '1440', width: 1440, height: 1000 },
];

const browser = await chromium.launch({
  headless: true,
  executablePath: process.env.CHROMIUM_PATH,
  args: ['--use-gl=swiftshader', '--enable-unsafe-swiftshader'],
});

async function toLocate(page, key) {
  await page.goto(BASE, { waitUntil: 'domcontentloaded' });
  await page.waitForSelector('#root');
  await page.getByLabel('What has been bothering you?').fill(UTTERANCES[key]);
  await page.getByRole('button', { name: 'Locate on body map' }).click();
  await page
    .locator('.location-workbench, .unsupported-layout, .empty-state')
    .first()
    .waitFor({ timeout: 20_000 });
  const clarify = page.getByRole('button', { name: 'Show me the body map' });
  if (await clarify.isVisible().catch(() => false)) {
    await clarify.click();
    await page.locator('.location-workbench').waitFor({ timeout: 20_000 });
  }
}

for (const size of WIDTHS) {
  const page = await browser.newPage({ viewport: { width: size.width, height: size.height } });
  for (const key of Object.keys(UTTERANCES)) {
    await toLocate(page, key);
    const m = await page.evaluate(() => {
      const doc = document.documentElement;
      const box = (el) => {
        const r = el.getBoundingClientRect();
        return [Math.round(r.top), Math.round(r.bottom), Math.round(r.width), Math.round(r.height)];
      };
      const one = (sel) => {
        const el = document.querySelector(sel);
        return el ? box(el) : null;
      };
      const offenders = [];
      if (doc.scrollWidth > doc.clientWidth + 1) {
        for (const el of document.querySelectorAll('main *')) {
          const r = el.getBoundingClientRect();
          if (r.width === 0 || r.height === 0) continue;
          if (r.right > doc.clientWidth + 1 || r.left < -1) {
            const chain = [];
            let p = el;
            while (p && p !== document.body && chain.length < 4) {
              chain.push(
                p.tagName.toLowerCase() + (p.className ? '.' + String(p.className).trim().split(/\s+/).join('.') : ''),
              );
              p = p.parentElement;
            }
            offenders.push({
              right: Math.round(r.right),
              w: Math.round(r.width),
              chain: chain.join(' < '),
            });
          }
        }
      }
      return {
        clientW: doc.clientWidth,
        scrollW: doc.scrollWidth,
        toolbar: one('.viewer-toolbar'),
        groups: [...document.querySelectorAll('.viewer-toolbar__views > .choice-group')].map(box),
        views: one('.viewer-toolbar__views'),
        footer: one('.location-footer'),
        zones: [...document.querySelectorAll('.bodymap__zones [data-subregion]')].map((el) => [
          el.getAttribute('data-subregion'),
          ...box(el),
        ]),
        offenders: offenders.slice(0, 6),
      };
    });

    const [ft, fb] = m.footer ? [m.footer[0], m.footer[1]] : [null, null];
    console.log(`\n[${size.name}] ${key}`);
    console.log(
      `  doc ${m.scrollW}/${m.clientW}${m.scrollW > m.clientW + 1 ? '  OVERFLOW' : '  ok'}`,
    );
    if (m.offenders.length) {
      for (const o of m.offenders) {
        console.log(`    over: right=${o.right} w=${o.w}  ${o.chain}`);
      }
    }
    console.log(
      `  toolbar h=${m.toolbar ? m.toolbar[3] : '-'} views w=${m.views ? m.views[2] : '-'} groups=${JSON.stringify(m.groups)}`,
    );
    console.log(`  footer top=${ft} bottom=${fb}`);
    for (const [id, top, bottom] of m.zones) {
      const under = ft != null && bottom > ft ? '  UNDER-FOOTER' : '';
      const below = top > (size.height * 0.92) ? '  BELOW-FOLD' : '';
      console.log(`  zone ${id} top=${top} bottom=${bottom}${under}${below}`);
    }
  }
  await page.close();
}

await browser.close();
