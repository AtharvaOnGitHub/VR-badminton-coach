// Storyboard capture. Run: node tools/shots.mjs    (needs :4178 and :4179)
//
// Drives the real court, with a fake phone on the real relay for the frames that
// need a racket. Everything here is the shipped code path; nothing is mocked out
// except the phone's sensor, which a laptop does not have.
import { chromium } from 'playwright';
import { WebSocket } from 'ws';
import { mkdirSync } from 'fs';

const OUT = 'docs/shots';
mkdirSync(OUT, { recursive: true });
const sleep = ms => new Promise(r => setTimeout(r, ms));
const REST = { a: 0, b: 0, g: -Math.PI / 2 };   // screen to the leg, top edge forward

const phone = new WebSocket('ws://127.0.0.1:4179');
await new Promise(r => phone.on('open', r));
phone.send(JSON.stringify({ hello: 'racket' }));
let pose = { ...REST, alpha: REST.a, beta: REST.b, gamma: REST.g };
const stream = setInterval(() => phone.send(JSON.stringify({ type: 'frame', w: 1.2,
  rot: { alpha: pose.alpha, beta: pose.beta, gamma: pose.gamma } })), 50);
const arm = (d) => { pose = { alpha: REST.a + (d.a || 0), beta: REST.b + (d.b || 0),
                              gamma: REST.g + (d.g || 0) }; };

const b = await chromium.launch();
const page = await b.newPage({ viewport: { width: 1360, height: 820 },
                               deviceScaleFactor: 2 });
page.on('pageerror', e => console.log('  PAGE ERROR', e.message));
await page.goto('http://localhost:4178/', { waitUntil: 'networkidle' });
await sleep(700);

const shot = async (name, sel = '.stage') => {
  await page.locator(sel).screenshot({ path: `${OUT}/${name}.png` });
  console.log(`  ${name}`);
};

console.log('\nStoryboard 1 — getting the racket on');
await shot('s1-1-lobby');                                   // QR, three steps
phone.send(JSON.stringify({ type: 'hand', hand: 'right' }));
phone.send(JSON.stringify({ type: 'calibration', ref: REST }));
await sleep(600);
arm({ b: 1.15, g: 0.9 });                                   // arm up, face turned over
await sleep(700);
await shot('s1-2-ready');                                   // hall + live racket

console.log('\nStoryboard 2 — a rep that lands');
await page.evaluate(() => { window.shadow.sim.useFixedFeed(true);
                            window.shadow.startSession(); });
await sleep(300);
await page.evaluate(() => window.shadow.sim.startRep());
await sleep(1100);
await shot('s2-1-incoming');                                // shuttle + floor shadow
await page.evaluate(() => window.shadow.sim.swing(
  { pitchDeg: 6, yawDeg: 0, power: 0.62, source: 'phone' }));
await sleep(900);
await shot('s2-2-landed');                                  // verdict + landing ring

console.log('\nStoryboard 3 — a swing at nothing');
await page.evaluate(async () => { const s = window.shadow.sim; s.startRep();
  await new Promise(r => setTimeout(r, 300));
  s.swing({ pitchDeg: -10, yawDeg: 0, power: 0.8, source: 'phone' }); });
await sleep(700);
await shot('s3-1-whiff');                                   // WHIFF + distance + gap

console.log('\nStoryboard 4 — asking why, and the coach surface');
await page.evaluate(async () => {
  const s = window.shadow.sim;
  for (let i = 0; i < 9; i++) {                             // a block worth of reps
    s.startRep();
    await new Promise(r => setTimeout(r, 1400 + (i % 3) * 90));
    s.swing({ pitchDeg: 2 + (i % 4) * 9, yawDeg: 0, power: 0.6 + (i % 3) * 0.1,
              source: 'phone' });
    await new Promise(r => setTimeout(r, 260));
  }
});
await sleep(500);
await page.click('[data-view="review"]');
await page.click('#btn-review');
await sleep(400);
await shot('s4-1-review', '#review');
await page.click('[data-view="setup"]');
await sleep(300);
await shot('s4-2-room', '#setup');

clearInterval(stream); phone.close(); await b.close();
console.log('\n  storyboards written to docs/shots\n');
