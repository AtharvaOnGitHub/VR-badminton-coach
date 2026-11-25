// What a recorded movement actually did.
//
// One implementation, used by the test bench in the browser and by the command
// line reader. A sample is what the COURT saw on that frame, not what the phone
// sent, because the question is always whether the racket on screen followed the
// arm, and the court's own numbers are the answer to that.

const DEG = 180 / Math.PI;
const dot = (a, b) => a[0]*b[0] + a[1]*b[1] + a[2]*b[2];
const ang = (a, b) => Math.acos(Math.max(-1, Math.min(1, dot(a, b)))) * DEG;
const pct = (sorted, p) => sorted.length
  ? sorted[Math.min(sorted.length - 1, Math.floor(p * sorted.length))] : NaN;
const r2 = x => Number.isFinite(x) ? +x.toFixed(2) : null;

/** Was the racket steadier or wilder than the gyroscope says it should have been? */
export const SHAKE = 1.6;     // moved this many times more than the gyro implies
export const DAMPED = 0.5;    // or this much less

/**
 * @param samples [{ t, shaft:[x,y,z], face:[x,y,z], w, g }]
 *   t  ms, shaft and face are unit vectors in court axes, w is rad/s, g is m/s^2
 * @param track  'shaft' or 'face' — which one this movement was steering
 */
export function summarise(samples, track = 'shaft') {
  if (!samples || samples.length < 8) return { ok: false, reason: 'too few samples' };

  const secs = (samples.at(-1).t - samples[0].t) / 1000;
  const dts = [], moved = [], implied = [];
  for (let i = 1; i < samples.length; i++) {
    const dt = (samples[i].t - samples[i - 1].t) / 1000;
    if (dt <= 0 || dt > 0.5) continue;
    dts.push(dt);
    moved.push(ang(samples[i - 1][track], samples[i][track]));
    implied.push((samples[i].w || 0) * dt * DEG);
  }
  const sortNum = a => [...a].sort((x, y) => x - y);
  const dtS = sortNum(dts), mvS = sortNum(moved), imS = sortNum(implied);
  const wS = sortNum(samples.map(s => s.w || 0));
  const gS = sortNum(samples.map(s => s.g).filter(x => typeof x === 'number'));

  // If the racket barely moved, the ratio is a division of two noise figures and
  // means nothing. Say so rather than printing a number that looks like a finding.
  const enough = pct(imS, 0.95) > 0.15 && pct(mvS, 0.95) > 0.02;
  const ratio = enough ? pct(mvS, 0.95) / pct(imS, 0.95) : null;
  const elev = samples.map(s => Math.asin(Math.max(-1, Math.min(1, s[track][1]))) * DEG);

  // the other direction should sit still during a wrist test, and vice versa
  const other = track === 'shaft' ? 'face' : 'shaft';
  const otherMove = ang(samples[0][other], samples.at(-1)[other]);

  return {
    ok: true, track,
    samples: samples.length,
    seconds: r2(secs),
    hz: r2(samples.length / (secs || 1)),
    gapMedianMs: r2(pct(dtS, 0.5) * 1000),
    gapWorstMs: r2(dtS.at(-1) * 1000),
    gyroMedian: r2(pct(wS, 0.5)),
    gyroPeak: r2(wS.at(-1)),
    gyroPeakDeg: r2(wS.at(-1) * DEG),
    accelMedian: gS.length ? r2(pct(gS, 0.5)) : null,
    movePerFrame: r2(pct(mvS, 0.5)),
    movePerFrameP95: r2(pct(mvS, 0.95)),
    gyroImpliesP95: r2(pct(imS, 0.95)),
    ratio: r2(ratio),
    elevStart: r2(elev[0]),
    elevMax: r2(Math.max(...elev)),
    elevMin: r2(Math.min(...elev)),
    elevEnd: r2(elev.at(-1)),
    returnedToStart: r2(ang(samples[0][track], samples.at(-1)[track])),
    otherAxisMoved: r2(otherMove),
    trace: trace(elev),
    verdict: verdict(ratio, gS.length ? pct(gS, 0.5) : null, enough),
  };
}

function verdict(ratio, accel, enough = true) {
  const out = [];
  if (!enough || !Number.isFinite(ratio))
    out.push(['unknown', 'the racket barely moved, so there is nothing to judge']);
  else if (ratio > SHAKE) out.push(['shaking',
    `the racket moved ${ratio.toFixed(1)}x more than the gyroscope says it should`]);
  else if (ratio < DAMPED) out.push(['damped',
    `the racket moved only ${ratio.toFixed(1)}x what the gyroscope says`]);
  else out.push(['steady', 'the racket tracked the sensor']);
  if (accel !== null && Math.abs(accel - 9.81) > 2.5)
    out.push(['accel', `resting acceleration reads ${accel.toFixed(1)}, not 9.81`]);
  return out.map(([k, s]) => ({ kind: k, say: s }));
}

/** A small text picture of elevation over the movement, for a log or a terminal. */
function trace(elev, N = 48, rows = 7) {
  const grid = Array.from({ length: rows }, () => Array(N).fill(' '));
  for (let i = 0; i < N; i++) {
    const a = Math.floor(i * elev.length / N), b = Math.max(a + 1, Math.floor((i + 1) * elev.length / N));
    const seg = elev.slice(a, b);
    if (!seg.length) continue;
    const v = seg.reduce((x, y) => x + y, 0) / seg.length;
    const row = Math.round((1 - (v + 90) / 180) * (rows - 1));
    grid[Math.max(0, Math.min(rows - 1, row))][i] = '#';
  }
  const label = ['+90', ' +60', '+30', '  0', '-30', '-60', '-90'];
  return grid.map((g, i) => `${label[i].padStart(4)} |${g.join('')}|`);
}

/** One line per movement, for a terminal or a saved summary. */
export function oneLine(name, s) {
  if (!s?.ok) return `${name.padEnd(22)} ${s?.reason || 'no data'}`;
  const v = s.verdict[0];
  return `${name.padEnd(22)} ${String(s.hz).padStart(5)} Hz  `
       + `ratio ${String(s.ratio).padStart(5)}  `
       + `peak ${String(s.gyroPeak).padStart(5)} rad/s  `
       + `back to start ${String(s.returnedToStart).padStart(5)}°  ${v.kind}`;
}
