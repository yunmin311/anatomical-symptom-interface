import { createRequire } from 'node:module';
const require = createRequire('C:/Users/lqy/AppData/Local/Temp/opencode/pw/');
const { chromium } = require('playwright-core');

const CHROME = 'C:/Program Files/Google/Chrome/Application/chrome.exe';
const browser = await chromium.launch({ headless: true, executablePath: CHROME });
const page = await browser.newPage({ viewport: { width: 1440, height: 900 } });

const errors = [];
const logs = [];
page.on('console', (m) => {
  const t = `[${m.type()}] ${m.text().slice(0, 220)}`;
  logs.push(t);
  if (m.type() === 'error') errors.push(t);
});
page.on('pageerror', (e) => errors.push('PAGEERROR ' + String(e).slice(0, 300)));
page.on('response', (r) => { if (r.status() >= 400) errors.push(`HTTP${r.status()} ${r.url().slice(0, 140)}`); });

// Cache-bust the GLB: Vite serves public/ directly, and a 4 MB asset that has
// just been re-exported is exactly what a browser will happily serve from cache.
await page.route('**/shoulder-atlas.glb*', (route) => route.continue({ headers: { ...route.request().headers(), 'cache-control': 'no-cache' } }));
await page.goto(`http://localhost:5199/atlas.html?cb=${Date.now()}`, { waitUntil: 'load' });
await page.waitForFunction(
  () => document.querySelectorAll('canvas').length > 0 && document.querySelector('.atlas__loading') === null,
  null, { timeout: 120000 },
);
await page.waitForTimeout(2500);

const snapshot = () => page.evaluate(() => {
  const cs = document.querySelectorAll('canvas');
  const out = [];
  for (const c of cs) {
    const tmp = document.createElement('canvas');
    tmp.width = 200; tmp.height = 200;
    const ctx = tmp.getContext('2d');
    ctx.drawImage(c, 0, 0, 200, 200);
    const d = ctx.getImageData(0, 0, 200, 200).data;
    let lit = 0;
    for (let i = 0; i < d.length; i += 4) if (d[i] + d[i + 1] + d[i + 2] > 120) lit++;
    out.push({ w: c.width, h: c.height, lit, cw: c.clientWidth, ch: c.clientHeight, connected: c.isConnected });
  }
  return out;
});

const frames = await page.evaluate(() => new Promise((resolve) => {
  let n = 0;
  const t0 = performance.now();
  const step = () => { n++; if (performance.now() - t0 < 1000) requestAnimationFrame(step); else resolve(n); };
  requestAnimationFrame(step);
}));

const before = await snapshot();
await page.screenshot({ path: 'E:/1project/asi-atlas-v2/spikes/shoulder-geometry/web/screens/diag-a-before.png' });

const boneBox = page.locator('.atlas__layers:not(.atlas__layers--absent) li', { hasText: 'Bone' }).locator('input[type=checkbox]');
const boneBefore = await boneBox.isChecked();
await boneBox.uncheck();
await page.waitForTimeout(2500);
const after = await snapshot();
await page.screenshot({ path: 'E:/1project/asi-atlas-v2/spikes/shoulder-geometry/web/screens/diag-b-bone-off.png' });

const state = await page.evaluate(() => {
  const boxes = [...document.querySelectorAll('.atlas__layers:not(.atlas__layers--absent) li')];
  return boxes.map((li) => ({
    name: li.querySelector('.atlas__layername')?.textContent,
    checked: li.querySelector('input')?.checked,
  }));
});

console.log(JSON.stringify({
  canvasCount: before.length,
  framesInOneSecond: frames,
  boneWasChecked: boneBefore,
  before: before[0]?.lit,
  after: after[0]?.lit,
  layerState: state,
  logs: logs.slice(0, 14),
  errors: errors.slice(0, 8),
}, null, 2));
await browser.close();