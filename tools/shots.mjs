// Reproducible storyboard frames. Run: node tools/shots.mjs  (server on :4178)
// Drives the real app so the report figures cannot drift from the code.
import { chromium } from 'playwright';
import { mkdirSync } from 'fs';

const URL = 'http://localhost:4178/';
const OUT = 'docs/shots';
mkdirSync(OUT, { recursive: true });
const sleep = ms => new Promise(r => setTimeout(r, ms));

// timings found by tools/check.mjs: in-target window is roughly 1420-1640 ms
const T = { good: 1500, late: 1800, early: 1280 };

const run = async () => {
  const b = await chromium.launch();
  const page = await b.newPage({ viewport: { width: 1180, height: 720 },
                                 deviceScaleFactor: 2 });
  page.on('dialog', d => d.accept());
  await page.goto(URL, { waitUntil: 'networkidle' });
  await sleep(400);
  await page.evaluate(() => window.shadow.sim.useFixedFeed(true));

  const shot = (n, sel) => (sel ? page.locator(sel) : page)
    .screenshot({ path: `${OUT}/${n}.png` }).then(() => console.log('·', n));

  const rep = async (ms, { swing = true } = {}) => {
    await page.evaluate(() => window.shadow.sim.startRep());
    await sleep(ms);
    if (swing) await page.evaluate(() => window.shadow.sim.swing());
    await sleep(850);
  };

  // 1 — the shuttle on its way in, first person, nothing in the way
  await page.evaluate(() => window.shadow.sim.startRep());
  await sleep(1150);
  await shot('01-incoming', '.stage');

  // 2 — a rep that lands in the target
  await page.evaluate(() => window.shadow.sim.swing());
  await sleep(900);
  await shot('02-in-target', '.stage');

  // 3 — the same rep from the side: feed arc, strike, landing
  await page.evaluate(() => window.shadow.sim.setView('side'));
  await sleep(350);
  await shot('03-side-arc', '.stage');
  await page.evaluate(() => window.shadow.sim.setView('fp'));

  // 4 — freeze mid-flight: where the shuttle is vs where the stroke wants it
  await page.evaluate(() => window.shadow.sim.startRep());
  await sleep(1430);
  await page.evaluate(() => window.shadow.sim.togglePause());
  await sleep(250);
  await page.evaluate(() => window.shadow.sim.setView('side'));
  await sleep(300);
  await shot('04-frozen-gap', '.stage');
  await page.evaluate(() => { window.shadow.sim.togglePause();
                              window.shadow.sim.setView('fp'); });
  await sleep(900);

  // build a session with a clear pattern: late contact on the misses
  for (let i = 0; i < 4; i++) await rep(T.good);
  for (let i = 0; i < 5; i++) await rep(T.late);
  for (let i = 0; i < 3; i++) await rep(T.good);

  // 5 — the offer, after three past the target
  await page.evaluate(() => window.shadow.sim.startRep());
  await sleep(300);
  await shot('05-offer', '.stage');
  await page.evaluate(() => window.shadow.sim.swing());
  await sleep(800);

  // 6 — the player asks
  await page.click('[data-view="review"]'); await sleep(200);
  await page.click('#btn-review'); await sleep(450);
  await shot('06-review');

  // 7 — put it away twice, and it is muted for the session
  const d1 = await page.locator('[data-dismiss]').first();
  if (await d1.count()) { await d1.click(); await sleep(300); }
  await page.click('#btn-review'); await sleep(300);
  const d2 = await page.locator('[data-dismiss]').first();
  if (await d2.count()) { await d2.click(); await sleep(400); }
  await shot('07-muted');

  // 8 — the room page: the remap, stated and adjustable
  await page.click('[data-view="setup"]'); await sleep(300);
  await shot('08-room');

  // 9 — coach view, after the player shares
  await page.click('[data-view="coach"]'); await sleep(250);
  await page.click('#btn-share'); await sleep(500);
  await shot('09-coach');

  await b.close();
};
run().catch(e => { console.error(e); process.exit(1); });
