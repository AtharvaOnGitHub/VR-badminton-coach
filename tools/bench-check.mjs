// Drives the test bench through its waypoints with a fake phone on the real relay.
//
// This proves the gating works end to end: waypoints clear in order, each movement
// records on its own, and the set advances without anyone pressing anything.
import { chromium } from 'playwright';
import { WebSocket } from 'ws';
import { readdirSync, existsSync, rmSync } from 'fs';

let pass = 0, fail = 0;
const ok = (n, c, x = '') => { console.log(`${c ? '  PASS' : '  FAIL'}  ${n}${x ? '  — ' + x : ''}`); c ? pass++ : fail++; };
const sleep = ms => new Promise(r => setTimeout(r, ms));

// court direction -> the device-frame vector that maps onto it (right-hander)
const fromCourt = ([x, y, z]) => [y, -z, -x];
// shortest rotation taking `a` onto `b`, as [w,x,y,z]
const between = (a, b) => {
  const d = a[0]*b[0] + a[1]*b[1] + a[2]*b[2];
  if (d > 0.99999) return [1, 0, 0, 0];
  if (d < -0.99999) return [0, 1, 0, 0];
  const c = [a[1]*b[2]-a[2]*b[1], a[2]*b[0]-a[0]*b[2], a[0]*b[1]-a[1]*b[0]];
  const q = [1 + d, c[0], c[1], c[2]];
  const n = Math.hypot(...q);
  return q.map(v => v / n);
};
const qForShaft = dir => between([0, 1, 0], fromCourt(dir));
const qForFace  = dir => between([0, 0, 1], fromCourt(dir));

if (existsSync('recordings')) rmSync('recordings', { recursive: true, force: true });

const phone = new WebSocket('ws://127.0.0.1:4179');
await new Promise(r => phone.on('open', r));
phone.send(JSON.stringify({ hello: 'racket' }));

let q = [1, 0, 0, 0];
const stream = setInterval(() => phone.send(JSON.stringify({
  type: 'frame', t: Date.now(), q, w: 1.0,
  rate: { x: 0, y: 0, z: 0 }, acc: { x: 0, y: 0, z: 0 },
})), 40);

const b = await chromium.launch();
const page = await b.newPage({ viewport: { width: 1280, height: 860 } });
const errs = [];
page.on('pageerror', e => errs.push(e.message));
await page.goto('http://localhost:4178/', { waitUntil: 'networkidle' });
await sleep(600);
phone.send(JSON.stringify({ type: 'hand', hand: 'right' }));
phone.send(JSON.stringify({ type: 'calibration', ref: { a: 0, b: 0, g: -Math.PI / 2 } }));
await sleep(500);

console.log('\nTEST BENCH');
await page.click('[data-view="test"]');
await sleep(300);
const visible = await page.evaluate(() => !document.querySelector('#stagewrap').hidden
  && !document.querySelector('#test').hidden);
ok('the bench opens on the same court as the drill', visible);

const TESTS = await page.evaluate(async () => {
  const m = await import('/src/testbench.js');
  return m.TESTS.map(t => ({ id: t.id, track: t.track, points: t.points }));
});
ok('four movements are defined', TESTS.length === 4, String(TESTS.length));

await page.click('#t-start');
await sleep(400);

for (const t of TESTS) {
  const name = await page.textContent('#t-name');
  for (const p of t.points) {
    q = t.track === 'face' ? qForFace(p.dir) : qForShaft(p.dir);
    await sleep(520);                       // longer than HOLD, so it clears
  }
  await sleep(300);
  const cls = await page.getAttribute(`#tl-${t.id}`, 'class');
  ok(`${t.id}: every waypoint cleared`, cls === 'done', `name was "${name}", class "${cls}"`);
  await sleep(1700);                        // the gap before the next movement
}

await sleep(600);
ok('the set reports complete', (await page.textContent('#t-name')) === 'Set complete');

const takes = existsSync('recordings') ? readdirSync('recordings').filter(f => f.endsWith('.jsonl')) : [];
console.log('  takes written: ' + (takes.join(', ') || 'none'));
ok('each movement recorded on its own', takes.length === 4, String(takes.length));
ok('takes are named after the movement',
   TESTS.every(t => takes.some(f => f.includes(t.id))), takes.join(' '));
ok('no runtime errors', errs.length === 0, errs.join(' / '));

console.log(`\n${pass} passed, ${fail} failed\n`);
clearInterval(stream); phone.close(); await b.close();
process.exit(fail ? 1 : 0);
