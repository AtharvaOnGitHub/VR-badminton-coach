// Drives the test bench through its waypoints with a fake phone on the real relay.
//
// This proves the gating works end to end: waypoints clear in order, each movement
// records on its own, and the set advances without anyone pressing anything.
import { chromium } from 'playwright';
import { WebSocket } from 'ws';
import { readdirSync, existsSync, rmSync, readFileSync } from 'fs';
import { join } from 'path';

let pass = 0, fail = 0;
const ok = (n, c, x = '') => { console.log(`${c ? '  PASS' : '  FAIL'}  ${n}${x ? '  — ' + x : ''}`); c ? pass++ : fail++; };
const sleep = ms => new Promise(r => setTimeout(r, ms));

// court direction -> the device-frame vector that maps onto it. At the calibration
// pose the phone's x axis is straight down, its y is forward and its z is to the
// racket side, so court = (v.z, -v.x, -v.y) for a right-hander.
const fromCourt = ([x, y, z]) => [-y, -z, x];
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

/* A fake arm. It moves between poses over time rather than teleporting, and
   reports the angular speed that movement implies, because a bench that is
   measuring whether the racket matches the gyroscope cannot be tested with a
   driver whose gyroscope says nothing is happening. */
let q = [1, 0, 0, 0], target = [1, 0, 0, 0], w = 0;
const HZ = 50, MOVE_MS = 420;
const qdot = (a, b) => a[0]*b[0] + a[1]*b[1] + a[2]*b[2] + a[3]*b[3];
const nlerp = (a, b, s) => {
  if (qdot(a, b) < 0) b = b.map(v => -v);
  const o = a.map((v, i) => v + (b[i] - v) * s);
  const n = Math.hypot(...o);
  return o.map(v => v / n);
};
const qAngle = (a, b) => 2 * Math.acos(Math.min(1, Math.abs(qdot(a, b))));

let moveLeft = 0;
const stream = setInterval(() => {
  if (moveLeft > 0) {
    const s = Math.min(1, (1000 / HZ) / moveLeft);
    const next = nlerp(q, target, s);
    w = qAngle(q, next) * HZ;                   // rad/s this step implies
    q = next;
    moveLeft -= 1000 / HZ;
  } else { q = target; w = 0; }
  phone.send(JSON.stringify({
    type: 'frame', t: Date.now(), q, w,
    rate: { x: 0, y: 0, z: w }, acc: { x: 0, y: 0, z: 0 },
    accG: { x: -9.81, y: 0, z: 0 },
  }));
}, 1000 / HZ);
const moveTo = (to) => { target = to; moveLeft = MOVE_MS; };

const b = await chromium.launch();
const page = await b.newPage({ viewport: { width: 1280, height: 860 } });
const errs = [];
page.on('pageerror', e => errs.push(e.message));
await page.goto('http://localhost:4178/', { waitUntil: 'networkidle' });
await sleep(600);
phone.send(JSON.stringify({ type: 'hand', hand: 'right' }));
// calibration: racket out in front and level, so gravity reads down the phone's x
phone.send(JSON.stringify({ type: 'calibration', down: [1, 0, 0] }));
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
    moveTo(t.track === 'face' ? qForFace(p.dir) : qForShaft(p.dir));
    await sleep(MOVE_MS + 420);             // move, then hold longer than HOLD
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

// the bench must produce its own numbers, on screen and on disk, with no second program
const shown = await page.evaluate(() => {
  const rows = [...document.querySelectorAll('#t-res-body tr')];
  return { hidden: document.querySelector('#t-res').hidden,
           n: rows.length,
           ratios: rows.map(r => r.children[2]?.textContent) };
});
ok('the verdict is on the page when the set ends',
   !shown.hidden && shown.n === 4, JSON.stringify(shown));
ok('every movement has a ratio', shown.ratios.every(x => x && x !== 'null'),
   shown.ratios.join(' '));
ok('and the racket tracked the sensor, so the ratio sits near 1',
   shown.ratios.every(x => Math.abs(parseFloat(x) - 1) < 0.45), shown.ratios.join(' '));

const saved = readdirSync('recordings');
const reps = saved.filter(f => f.endsWith('.report.json'));
ok('a report is saved beside every take', reps.length === 4, reps.length + ' of 4');
ok('a one-line summary is appended', saved.includes('summary.txt'), saved.join(' '));
if (reps.length) {
  const s = JSON.parse(readFileSync(join('recordings', reps[0]), 'utf8'));
  ok('the saved report carries the numbers, not just raw frames',
     s.ok && typeof s.ratio === 'number' && Array.isArray(s.verdict)
     && Array.isArray(s.trace),
     JSON.stringify(Object.keys(s)).slice(0, 90));
}
ok('no runtime errors', errs.length === 0, errs.join(' / '));

console.log(`\n${pass} passed, ${fail} failed\n`);
clearInterval(stream); phone.close(); await b.close();
process.exit(fail ? 1 : 0);
