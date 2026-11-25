// Read what the test bench already worked out.
//
//   node tools/analyse.mjs            every movement from the last set
//   node tools/analyse.mjs --raw      also replay the raw frames, for a deeper look
//
// The bench computes its own verdict as each movement finishes and the relay saves
// it, so this is a reader rather than a second implementation. Both sides share
// src/takestats.js, so the numbers here are the numbers that were on screen.
import { readFileSync, readdirSync, existsSync } from 'fs';
import { join } from 'path';
import { summarise, oneLine } from '../src/takestats.js';

const DIR = 'recordings';
if (!existsSync(DIR)) {
  console.log(`\n  No takes yet. Open the Test tab and press "Run the set".\n`);
  process.exit(0);
}

const reports = readdirSync(DIR).filter(f => f.endsWith('.report.json')).sort();
if (!reports.length) {
  console.log(`\n  ${DIR}/ has no reports yet. Run the set from the Test tab.\n`);
  process.exit(0);
}

const show = (name, s) => {
  console.log(`\n${'─'.repeat(74)}\n  ${name}`);
  if (!s?.ok) { console.log(`  ${s?.reason || 'no data'}`); return; }
  console.log(`  ${s.samples} samples over ${s.seconds}s at ${s.hz} Hz`
            + `   gaps ${s.gapMedianMs} ms median, ${s.gapWorstMs} ms worst`);
  console.log(`  gyro   median ${s.gyroMedian} rad/s, peak ${s.gyroPeak} (${s.gyroPeakDeg} deg/s)`);
  console.log(`  accel  median ${s.accelMedian ?? '-'} m/s^2`);
  console.log(`  moved per frame ${s.movePerFrame}° median, ${s.movePerFrameP95}° p95`);
  console.log(`  gyro alone implies ${s.gyroImpliesP95}° p95   ->  ratio ${s.ratio}`);
  console.log(`  ${s.track} elevation  start ${s.elevStart}°  max ${s.elevMax}°  `
            + `min ${s.elevMin}°  end ${s.elevEnd}°`);
  console.log(`  back to where it started: ${s.returnedToStart}°   `
            + `the other axis moved ${s.otherAxisMoved}°`);
  for (const v of s.verdict) console.log(`  >> ${v.kind}: ${v.say}`);
  console.log('');
  for (const row of s.trace) console.log('  ' + row);
};

for (const f of reports) {
  const s = JSON.parse(readFileSync(join(DIR, f), 'utf8'));
  show(f.replace(/\.report\.json$/, '').replace(/^[\d T:-]+_/, ''), s);
}

if (process.argv.includes('--raw')) {
  console.log(`\n${'='.repeat(74)}\n  RAW REPLAY (from the phone's own frames)\n`);
  for (const f of readdirSync(DIR).filter(x => x.endsWith('.jsonl')).sort()) {
    const rows = readFileSync(join(DIR, f), 'utf8').trim().split('\n')
      .map(l => { try { return JSON.parse(l); } catch { return null; } }).filter(Boolean);
    const frames = rows.filter(r => r.msg?.type === 'frame');
    console.log(`  ${f}  ${frames.length} frames`);
  }
}

console.log(`\n${'='.repeat(74)}\n  SUMMARY\n`);
for (const f of reports) {
  const s = JSON.parse(readFileSync(join(DIR, f), 'utf8'));
  console.log('  ' + oneLine(f.replace(/\.report\.json$/, '').replace(/^[\d T:-]+_/, ''), s));
}
console.log('');
