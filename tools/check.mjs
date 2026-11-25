// Behaviour checks. Run: node tools/check.mjs   (server must be on :4178)
//
// Drives the real app in a real browser and asserts the things the design claims.
// Written after a whole afternoon of "all five reps said NET" turned out to be the
// flight clock never advancing, which reading the code had not revealed.
import { chromium } from 'playwright';

const URL = 'http://localhost:4178/';
const sleep = ms => new Promise(r => setTimeout(r, ms));
let pass = 0, fail = 0;
const ok = (name, cond, extra = '') => {
  console.log(`${cond ? '  PASS' : '  FAIL'}  ${name}${extra ? '  — ' + extra : ''}`);
  cond ? pass++ : fail++;
};

const rep = (page, delayMs) => page.evaluate(async (d) => {
  const s = window.shadow.sim;
  s.startRep();
  await new Promise(r => setTimeout(r, d));
  s.swing();
  await new Promise(r => setTimeout(r, 400));
  const r = s.reps.at(-1);
  return r.swung
    ? { ahead: r.ahead, vH: r.vHeight, pitch: r.pitchDeg, netY: r.netY,
        landZ: +r.landing.z.toFixed(2), outcome: r.outcome, stepped: r.stepped }
    : { outcome: 'missed' };
}, delayMs);

const run = async () => {
  const b = await chromium.launch();
  const page = await b.newPage({ viewport: { width: 1100, height: 700 } });
  page.on('pageerror', e => { console.log('  PAGE ERROR:', e.message, '\n', (e.stack||'').split('\n').slice(0,3).join('\n')); fail++; });
  await page.goto(URL, { waitUntil: 'networkidle' });
  await sleep(400);
  await page.evaluate(() => window.shadow.sim.useFixedFeed(true));  // remove feeder jitter

  console.log('\nTIMING SWEEP  (feed reaches the player at about 1.90 s)');
  const sweep = [];
  for (const d of [1200, 1320, 1420, 1520, 1640, 1780, 1950]) {
    const r = await rep(page, d);
    sweep.push({ d, ...r });
    console.log(`  swing at ${d} ms -> ahead ${String(r.ahead).padStart(6)}  `
      + `pitch ${String(r.pitch).padStart(6)}  lands ${String(r.landZ).padStart(6)}  ${r.outcome}`);
  }

  console.log('\nASSERTIONS');
  const swung = sweep.filter(r => r.outcome !== 'missed');
  ok('every rep in the window produced a swing', swung.length === sweep.length);
  ok('ahead decreases as the swing gets later',
     swung.every((r, i) => i === 0 || r.ahead <= swung[i - 1].ahead + 0.02),
     swung.map(r => r.ahead).join(' > '));
  ok('at least one timing lands in the target',
     sweep.some(r => r.outcome === 'in'),
     sweep.map(r => r.outcome).join(', '));
  ok('swinging early (over-reaching) finds the net or lands short',
     ['net', 'short'].includes(sweep[0].outcome), `earliest = ${sweep[0].outcome}`);
  ok('swinging late sails past the target',
     ['long', 'out'].includes(sweep.at(-1).outcome),
     `latest = ${sweep.at(-1).outcome} at z=${sweep.at(-1).landZ}`);

  // the remap must actually change what the stroke can reach
  const remap = await page.evaluate(() => {
    const s = window.shadow.sim;
    const hi = s.remap.factor;
    s.setRemap(1.0);
    const off = s.remap.label;
    s.setRemap(hi);
    return { hi, off, on: s.remap.label };
  });
  console.log('\nREMAP');
  console.log('  ' + remap.on);
  console.log('  ' + remap.off);
  ok('remap is above 1 under a 2.4 m ceiling', remap.hi > 1.2, `factor ${remap.hi}`);
  ok('turning it off is stated plainly', /off/i.test(remap.off));

  // a muted observation must stay muted
  console.log('\nOVERRIDE');
  const mute = await page.evaluate(() => {
    const { ps } = window.shadow;
    const pol = window.shadow;
    return (async () => {
      const mod = await import('/src/policy.js');
      mod.dismiss(ps, 'ahead'); mod.dismiss(ps, 'ahead');
      const raised = mod.step(ps, [{ key: 'ahead', confidence: 1.0 }], 9);
      return { state: ps.perKey.ahead.state, raisedWhileMuted: raised.length };
    })();
  });
  ok('two dismissals mute it', mute.state === 'muted');
  ok('a muted observation is not raised at confidence 1.0', mute.raisedWhileMuted === 0);

  console.log(`\n${pass} passed, ${fail} failed\n`);
  await b.close();
  process.exit(fail ? 1 : 0);
};
run().catch(e => { console.error(e); process.exit(1); });
