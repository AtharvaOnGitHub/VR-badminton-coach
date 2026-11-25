// Read a recorded take and say what the phone actually did.
//
//   node tools/analyse.mjs                      the newest take
//   node tools/analyse.mjs recordings/x.jsonl   a particular one
//   node tools/analyse.mjs --all                every take, one summary line each
//
// Every number here comes from the raw frames, and the orientation is recomputed by
// running the shipped filter over them, so what this prints is what the court saw.
import { readFileSync, readdirSync, existsSync } from 'fs';
import { join } from 'path';
import * as Q from '../racket-app/quat.js';

const DIR = 'recordings';
const DEG = 180 / Math.PI;
const f = (x, n = 2) => (x === null || Number.isNaN(x) ? '  -  ' : x.toFixed(n));
const pct = (a, p) => a.length ? a[Math.min(a.length - 1, Math.floor(p * a.length))] : NaN;

function load(file) {
  const rows = readFileSync(file, 'utf8').trim().split('\n').map(l => {
    try { return JSON.parse(l); } catch { return null; }
  }).filter(Boolean);
  const meta = rows.find(r => r.meta) || {};
  const frames = rows.filter(r => r.msg && r.msg.type === 'frame').map(r => ({ at: r.at, ...r.msg }));
  const swings = rows.filter(r => r.msg && r.msg.type === 'swing').map(r => ({ at: r.at, ...r.msg }));
  return { meta, frames, swings };
}

/** Re-run the filter over a take, so the orientation here is the court's orientation. */
function replay(frames) {
  let q = [1, 0, 0, 0], gRest = null;
  const out = [];
  let prev = null;
  for (const fr of frames) {
    const rate = fr.rate || {};
    const omega = [rate.x || 0, rate.y || 0, rate.z || 0];
    const a = fr.accG || null;    // gravity included; fr.acc has it removed
    const acc = a ? [a.x || 0, a.y || 0, a.z || 0] : null;
    const dt = prev ? Math.min(0.1, Math.max(0.002, (fr.at - prev) / 1000)) : 1 / 60;
    prev = fr.at;
    if (!gRest && acc) gRest = Q.unit(acc);
    q = Q.step(q, omega, dt, acc, gRest);
    const shaft = Q.rotate(q, [0, 1, 0]);
    out.push({ at: fr.at, dt, omega, acc, q,
               court: [-shaft[2], shaft[0], -shaft[1]],   // right-handed mapping
               w: Math.hypot(...omega),
               g: acc ? Math.hypot(...acc) : null });
  }
  return out;
}

const angleBetween = (a, b) => {
  const d = a[0]*b[0] + a[1]*b[1] + a[2]*b[2];
  return Math.acos(Math.max(-1, Math.min(1, d))) * DEG;
};

function report(file) {
  const { meta, frames, swings } = load(file);
  console.log(`\n${'='.repeat(74)}\n${file}\n  label: ${meta.label || '(none)'}   `
            + `${frames.length} frames, ${swings.length} swings`);
  if (frames.length < 5) { console.log('  too short to say anything'); return; }

  const r = replay(frames);
  const dts = r.slice(1).map(x => x.dt).sort((a, b) => a - b);
  const secs = (frames.at(-1).at - frames[0].at) / 1000;
  console.log(`  ${f(secs, 1)} s at ${f(frames.length / secs, 1)} Hz   `
            + `gap median ${f(pct(dts, .5) * 1000, 1)} ms, worst ${f(dts.at(-1) * 1000, 0)} ms`);

  // --- raw sensor sanity ---
  const ws = r.map(x => x.w).sort((a, b) => a - b);
  const gs = r.map(x => x.g).filter(x => x !== null).sort((a, b) => a - b);
  console.log(`\n  GYRO  |w| rad/s   median ${f(pct(ws, .5))}  p95 ${f(pct(ws, .95))}  max ${f(ws.at(-1))}`);
  console.log(`                     = deg/s  median ${f(pct(ws, .5) * DEG, 0)}  max ${f(ws.at(-1) * DEG, 0)}`);
  if (gs.length)
    console.log(`  ACCEL |a| m/s^2   median ${f(pct(gs, .5))}  min ${f(gs[0])}  max ${f(gs.at(-1))}`
              + `   (rest should sit near 9.81)`);
  else console.log('  ACCEL  absent — the gravity correction cannot run');

  // --- is it shaking? frame-to-frame jump in the shaft direction ---
  const jumps = [];
  for (let i = 1; i < r.length; i++) jumps.push(angleBetween(r[i - 1].court, r[i].court));
  const js = [...jumps].sort((a, b) => a - b);
  const expected = r.slice(1).map((x, i) => x.w * x.dt * DEG).sort((a, b) => a - b);
  console.log(`\n  SHAFT move per frame, deg   median ${f(pct(js, .5))}  p95 ${f(pct(js, .95))}  max ${f(js.at(-1))}`);
  console.log(`  what the gyro alone implies median ${f(pct(expected, .5))}  p95 ${f(pct(expected, .95))}`);
  const ratio = pct(js, .95) / (pct(expected, .95) || 1e-9);
  console.log(`  ratio p95 ${f(ratio)}  ${ratio > 1.6 ? '<-- moving MORE than the gyro says: shaking'
    : ratio < 0.5 ? '<-- moving LESS than the gyro says: over-damped' : 'consistent'}`);

  // --- where did the racket actually go? ---
  const el = r.map(x => Math.asin(Math.max(-1, Math.min(1, x.court[1]))) * DEG);
  console.log(`\n  SHAFT elevation, deg        start ${f(el[0], 0)}  max ${f(Math.max(...el), 0)}`
            + `  min ${f(Math.min(...el), 0)}  end ${f(el.at(-1), 0)}`);
  console.log(`  drift: rest pose to final   ${f(angleBetween(r[0].court, r.at(-1).court), 1)} deg`);

  // --- a coarse trace, so the shape of the movement is visible ---
  console.log('\n  trace (elevation of the racket head over the take)');
  const N = 56, rows = 9;
  const grid = Array.from({ length: rows }, () => Array(N).fill(' '));
  for (let i = 0; i < N; i++) {
    const seg = el.slice(Math.floor(i * el.length / N), Math.max(1, Math.floor((i + 1) * el.length / N)));
    if (!seg.length) continue;
    const v = seg.reduce((a, b) => a + b, 0) / seg.length;
    const row = Math.round((1 - (v + 90) / 180) * (rows - 1));
    grid[Math.max(0, Math.min(rows - 1, row))][i] = '#';
  }
  const labels = ['+90', '  ', '+45', '  ', '  0', '  ', '-45', '  ', '-90'];
  grid.forEach((g, i) => console.log(`   ${labels[i]} |${g.join('')}|`));

  for (const s of swings)
    console.log(`\n  SWING  peak ${f(s.w)} rad/s (${f(s.w * DEG, 0)} deg/s), reported ${s.ageMs ?? '?'} ms late`);
}

const arg = process.argv[2];

// an explicit file is always honoured, whether or not a recordings folder exists
if (arg && arg !== '--all') {
  if (!existsSync(arg)) { console.log(`no such take: ${arg}`); process.exit(1); }
  report(arg);
} else {
  const takes = existsSync(DIR)
    ? readdirSync(DIR).filter(x => x.endsWith('.jsonl')).sort() : [];
  if (!takes.length) {
    console.log(`no takes yet. Press Record on the court page, do one movement, press Stop.`);
    process.exit(0);
  }
  if (arg === '--all') for (const x of takes) report(join(DIR, x));
  else report(join(DIR, takes.at(-1)));
}
console.log('');
