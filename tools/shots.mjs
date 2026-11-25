// Reproducible storyboard frames. Run: node tools/shots.mjs
// Drives the real app in a headless browser and captures each state the
// report refers to, so the figures cannot drift from the code.
import { chromium } from 'playwright';
import { mkdirSync } from 'fs';

const URL = 'http://localhost:4178/';
const OUT = 'docs/shots';
mkdirSync(OUT, { recursive: true });

const sleep = ms => new Promise(r => setTimeout(r, ms));

const run = async () => {
  const b = await chromium.launch();
  const page = await b.newPage({ viewport: { width: 1000, height: 760 },
                                 deviceScaleFactor: 2 });
  page.on('dialog', d => d.accept());
  await page.goto(URL, { waitUntil: 'networkidle' });

  const blocks = async n => {
    for (let i = 0; i < n; i++) {
      await page.click('#btn-block');
      await page.waitForFunction(
        c => +document.querySelector('#swing-count').textContent >= c,
        undefined, { timeout: 8000 }
      ).catch(() => {});
      await sleep(1400);
    }
  };
  const shot = async (name, sel) => {
    const t = sel ? page.locator(sel) : page;
    await t.screenshot({ path: `${OUT}/${name}.png` });
    console.log('·', name);
  };

  // 1 — practising, nothing shown
  await blocks(3);
  await shot('01-practice-quiet');

  // 2 — block boundary, a single offer, still nothing mid-swing
  await blocks(2);
  await shot('02-nudge-at-block-end');

  // 3 — the player pulls the review
  await page.click('[data-view="review"]'); await sleep(200);
  await page.click('#btn-review');          await sleep(400);
  await shot('03-review-pulled');

  // 4 — first dismissal: gone for this block, silently
  await page.click('[data-dismiss="swingPlane"]'); await sleep(300);
  await shot('04-dismissed-once');

  // 5 — plays on, it returns, second dismissal mutes it for the session
  await page.click('[data-view="practice"]'); await sleep(150);
  await blocks(1);
  await page.click('[data-view="review"]'); await sleep(150);
  await page.click('#btn-review');          await sleep(300);
  const again = await page.locator('[data-dismiss="swingPlane"]').count();
  if (again) { await page.click('[data-dismiss="swingPlane"]'); await sleep(400); }
  await shot('05-muted-for-session');

  // 6 — coach view, gated
  await page.click('[data-view="coach"]'); await sleep(250);
  await shot('06-coach-locked');

  // 7 — coach view, shared
  await page.click('#btn-share'); await sleep(500);
  await shot('07-coach-shared');

  // 8 — the trace
  await page.click('[data-view="trace"]'); await sleep(300);
  await shot('08-trace');

  await b.close();
};
run().catch(e => { console.error(e); process.exit(1); });
