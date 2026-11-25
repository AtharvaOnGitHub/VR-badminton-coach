// Replay a recorded take through the shipped filter and report where the racket went.
//
// The phone's frames carry the raw rotation rate, so a take can be re-integrated
// here exactly as the phone would. That is what makes a real recording usable as a
// regression test: the sign of the gyroscope was decided from one of these, and
// this is how it stays decided.
import { readFileSync } from 'fs';
import * as Q from '../racket-app/quat.js';

const DEG = 180 / Math.PI;
const court = v => [-v[2], v[0], -v[1]];          // right-hander
export const elevation = s => Math.asin(Math.max(-1, Math.min(1, s[1]))) * DEG;

export function frames(file) {
  return readFileSync(file, 'utf8').trim().split('\n')
    .map(l => { try { return JSON.parse(l); } catch { return null; } })
    .filter(r => r && r.msg && r.msg.type === 'frame');
}

/** @param sign the gyroscope sign the phone applies. Shipping value is -1. */
export function replay(fr, { sign = -1, gain = 0.03 } = {}) {
  let q = [1, 0, 0, 0], gRest = null, prev = null;
  const path = [];
  for (const x of fr) {
    const r = x.msg.rate || {}, a = x.msg.accG;
    // the recording holds what the phone sent, which already carried its own sign
    const om = [sign * (r.x || 0), sign * (r.y || 0), sign * (r.z || 0)];
    const acc = a ? [a.x, a.y, a.z] : null;
    const dt = prev ? Math.min(0.1, Math.max(0.002, (x.at - prev) / 1000)) : 1 / 60;
    prev = x.at;
    if (!gRest && acc) gRest = Q.unit(acc);
    q = Q.step(q, om, dt, acc, gRest, gain);
    path.push(court(Q.rotate(q, [0, 1, 0])));
  }
  return path;
}

if (process.argv[2]) {
  const p = replay(frames(process.argv[2]));
  const e = p.map(elevation);
  console.log(`${p.length} frames   elevation ${Math.min(...e).toFixed(0)} to `
            + `${Math.max(...e).toFixed(0)} deg   sideways reach ${Math.max(...p.map(v => Math.abs(v[0]))).toFixed(2)}`);
}
