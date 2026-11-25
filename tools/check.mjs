// Behaviour checks. Run: node tools/check.mjs   (static server on :4178)
import { chromium } from 'playwright';
const URL = 'http://localhost:4178/';
const sleep = ms => new Promise(r => setTimeout(r, ms));
let pass = 0, fail = 0;
const ok = (n, c, x = '') => { console.log(`${c ? '  PASS' : '  FAIL'}  ${n}${x ? '  — ' + x : ''}`); c ? pass++ : fail++; };

// drive one rep: move to (dx,dz) steps, swing at `delay` with a given racket
const rep = (page, { delay, dx = 0, dz = 0, racket = null }) => page.evaluate(
  async ({ delay, dx, dz, racket }) => {
    const s = window.shadow.sim;
    s.startRep();
    for (let i = 0; i < Math.abs(dx); i++) s.step(Math.sign(dx), 0);
    for (let i = 0; i < Math.abs(dz); i++) s.step(0, Math.sign(dz));
    await new Promise(r => setTimeout(r, delay));
    s.swing(racket || { pitchDeg: -12, yawDeg: 0, power: 0.75, source: 'test' });
    await new Promise(r => setTimeout(r, 450));
    const r = s.reps.at(-1);
    return { outcome: r.outcome, kind: r.kind, ahead: r.ahead, dist: r.dist,
             reach: r.reach, reason: r.reason, pitch: r.pitchDeg, speed: r.speed,
             forcedUp: r.forcedUp, playerZ: s.player.z };
  }, { delay, dx, dz, racket });

const run = async () => {
  const b = await chromium.launch();
  const page = await b.newPage({ viewport: { width: 1100, height: 700 } });
  page.on('pageerror', e => { console.log('  PAGE ERROR:', e.message); fail++; });
  await page.goto(URL, { waitUntil: 'networkidle' });
  await sleep(400);
  await page.evaluate(() => window.shadow.sim.useFixedFeed(true));

  console.log('\n0. NOTHING RUNS UNTIL THE PLAYER STARTS');
  const before = await page.evaluate(() => ({
    lobby: !document.querySelector('#lobby').hidden,
    session: window.shadow.session,
    reps: window.shadow.sim.reps.length,
    feedDisabled: document.querySelector('#btn-feed').disabled,
    startDisabled: document.querySelector('#btn-start').disabled,
  }));
  console.log(`  on load: lobby ${before.lobby ? 'shown' : 'hidden'}, session ${before.session}, `
    + `${before.reps} reps, feed ${before.feedDisabled ? 'disabled' : 'enabled'}, `
    + `start ${before.startDisabled ? 'disabled' : 'enabled'}`);
  ok('the court waits in the lobby instead of feeding', before.lobby && !before.session);
  ok('start is refused until the phone has reported in', before.startDisabled);
  ok('the drill controls are dead before the session', before.feedDisabled);

  await sleep(1800);
  const idle = await page.evaluate(() => window.shadow.sim.reps.length);
  ok('no shuttle is fed at a player who has not started', idle === 0, `${idle} reps`);

  const after = await page.evaluate(async () => {
    window.shadow.startSession();
    await new Promise(r => setTimeout(r, 120));
    return { lobby: !document.querySelector('#lobby').hidden,
             session: window.shadow.session,
             state: window.shadow.sim.state,
             feedDisabled: document.querySelector('#btn-feed').disabled };
  });
  console.log(`  after start: lobby ${after.lobby ? 'shown' : 'hidden'}, session ${after.session}, `
    + `rep state "${after.state}"`);
  ok('starting clears the lobby and feeds the first shuttle',
     after.session && !after.lobby && after.state === 'incoming' && !after.feedDisabled);

  await page.evaluate(() => { window.shadow.stopSession(); window.shadow.sim.reps.length = 0; });
  const stopped = await page.evaluate(() => ({
    lobby: !document.querySelector('#lobby').hidden, session: window.shadow.session }));
  ok('stopping puts the lobby back', stopped.lobby && !stopped.session);

  console.log('\n1. SWINGING AT NOTHING IS A WHIFF');
  const early = await rep(page, { delay: 250 });
  const late = await rep(page, { delay: 1350, dz: 2 });   // backed off, swung early
  console.log(`  swung far too early      -> ${early.outcome} (${early.reason}, ${early.dist} m away)`);
  console.log(`  too far back to reach it -> ${late.outcome} (${late.reason ?? '-'}, ${late.dist} m away, reach ${late.reach})`);
  ok('a swing with the shuttle metres away is a whiff, not a shot', early.outcome === 'whiff');
  ok('standing out of reach is a whiff', late.outcome === 'whiff', `got ${late.outcome}`);

  console.log('\n2. THE COURT IS TWO-DIMENSIONAL');
  const side = await page.evaluate(() => {
    const s = window.shadow.sim; const a = s.player;
    s.step(1, 0); s.step(0, -1);
    const b2 = s.player;
    return { dx: +(b2.x - a.x).toFixed(2), dz: +(b2.z - a.z).toFixed(2) };
  });
  ok('stepping moves on both axes', side.dx !== 0 && side.dz !== 0, JSON.stringify(side));

  console.log('\n3. STANDING UNDER IT FORCES THE SHOT UP');
  const under  = await rep(page, { delay: 1560, dz: -1 });  // step towards the net
  const behind = await rep(page, { delay: 1500, dz: 0 });   // stay at base, behind it
  console.log(`  stepped forward (z=${under.playerZ.toFixed(2)})  ahead ${under.ahead} -> ${under.kind}, pitch ${under.pitch}, forcedUp ${under.forcedUp}`);
  console.log(`  stayed at base  (z=${behind.playerZ.toFixed(2)})  ahead ${behind.ahead} -> ${behind.kind}, pitch ${behind.pitch}, forcedUp ${behind.forcedUp}`);
  ok('being under the shuttle forces the launch upward', under.forcedUp > behind.forcedUp,
     `${under.forcedUp} vs ${behind.forcedUp}`);
  ok('only the player behind the shuttle can hit down', behind.pitch < under.pitch,
     `${behind.pitch}° vs ${under.pitch}°`);

  console.log('\n4. THE RACKET CHANGES THE SHOT');
  const shots = {};
  for (const [name, r] of Object.entries({
    smash: { pitchDeg: -22, yawDeg: 0, power: 0.95, source: 'test' },
    drive: { pitchDeg: 0,   yawDeg: 0, power: 0.8,  source: 'test' },
    clear: { pitchDeg: 34,  yawDeg: 0, power: 0.8,  source: 'test' },
    drop:  { pitchDeg: 14,  yawDeg: 0, power: 0.18, source: 'test' },
  })) {
    const r2 = await rep(page, { delay: 1520, racket: r });
    shots[name] = r2;
    console.log(`  face ${String(r.pitchDeg).padStart(4)}° power ${r.power} -> ${String(r2.kind).padEnd(11)} launch ${String(r2.pitch).padStart(6)}° at ${r2.speed} m/s`);
  }
  const kinds = new Set(Object.values(shots).map(s => s.kind));
  ok('different racket states produce different shots', kinds.size >= 3,
     [...kinds].join(', '));
  ok('a closed face and a fast swing is a smash', shots.smash.kind === 'smash');
  ok('an open face is not a smash', shots.clear.kind !== 'smash', shots.clear.kind);


  console.log('\n5. HANDEDNESS MIRRORS THE GEOMETRY');
  const across = await page.evaluate(async () => {
    const m = await import('/src/contact.js');
    const sh = { x: 0.7, y: 2.6, z: 4.8 };            // shuttle to the player's RIGHT
    const mk = (hand) => m.evaluateContact({ player: { x: 0, z: 5.5 }, shuttle: sh,
                                             remapFactor: 1.36, hand });
    return { right: mk('right').stretched, left: mk('left').stretched };
  });
  console.log(`  shuttle 0.7 m to the right -> stretch for a right-hander ${across.right}, left-hander ${across.left}`);
  ok('reaching across the body costs more than reaching to the racket side',
     across.left > across.right, `${across.left} vs ${across.right}`);

  console.log('\n6. THE RACKET HAS ALL THREE DEGREES OF FREEDOM');
  const dof = await page.evaluate(async () => {
    const m = await import('/src/racket.js');
    // The real grip: phone on its long edge, screen to the leg, top edge forward.
    // That is a roll of about -90 degrees, and it is what makes beta the axis the
    // arm raises on. A rest pose that is not this one is not a test of anything.
    const rest = { a: 0, b: 0, g: -Math.PI / 2 };
    const refQ = m.restQuaternion(rest);
    const read = (d = {}) => m.attitude(
      { alpha: rest.a + (d.a || 0), beta: rest.b + (d.b || 0), gamma: rest.g + (d.g || 0) },
      refQ, 'right');
    const v = o => ({ x: +o.x.toFixed(3), y: +o.y.toFixed(3), z: +o.z.toFixed(3) });
    const ang = (p, q) => Math.acos(Math.max(-1, Math.min(1,
      p.x * q.x + p.y * q.y + p.z * q.z))) * 180 / Math.PI;

    const base = read();
    const t = 40 * Math.PI / 180;
    const moved = { alpha: read({ a: t }), beta: read({ b: t }), gamma: read({ g: t }) };
    const left = m.attitude({ alpha: rest.a + t, beta: rest.b, gamma: rest.g }, refQ, 'left');

    return {
      restShaft: v(base.shaft), restNormal: v(base.normal),
      swing: Object.fromEntries(Object.entries(moved).map(([k, r]) =>
        [k, { shaft: +ang(base.shaft, r.shaft).toFixed(1),
              face: +ang(base.normal, r.normal).toFixed(1),
              pitch: +r.pitchDeg.toFixed(1) }])),
      mirrored: +left.shaft.x.toFixed(3), righty: +moved.alpha.shaft.x.toFixed(3),
    };
  });
  console.log(`  at the rest pose: shaft ${JSON.stringify(dof.restShaft)}, `
            + `face ${JSON.stringify(dof.restNormal)}`);
  for (const [k, r] of Object.entries(dof.swing))
    console.log(`  turn 40° about ${k.padEnd(5)} -> shaft moves ${String(r.shaft).padStart(5)}°, `
              + `face ${String(r.face).padStart(5)}°, pitch ${r.pitch}°`);

  ok('the rest pose puts the shaft down the court',
     Math.abs(dof.restShaft.z + 1) < 0.02 && Math.abs(dof.restShaft.y) < 0.02,
     JSON.stringify(dof.restShaft));
  ok('the rest pose faces the strings out to the side',
     Math.abs(dof.restNormal.x + 1) < 0.02, JSON.stringify(dof.restNormal));
  const axes = Object.values(dof.swing);
  ok('every axis of the wrist moves the racket', axes.every(a => a.shaft > 15 || a.face > 15),
     JSON.stringify(dof.swing));
  ok('the three axes do not collapse into one motion',
     new Set(axes.map(a => Math.round(a.shaft))).size >= 2
     && new Set(axes.map(a => Math.round(a.face))).size >= 2);
  ok('a left-hander is the mirror image',
     Math.abs(dof.mirrored + dof.righty) < 1e-6 && Math.abs(dof.righty) > 0.3,
     `${dof.mirrored} vs ${dof.righty}`);

  // Each axis should do the physically right thing, not merely something.
  const lift = await page.evaluate(async () => {
    const m = await import('/src/racket.js');
    const rest = { a: 0, b: 0, g: -Math.PI / 2 };
    const refQ = m.restQuaternion(rest);
    const at = (d) => m.attitude({ alpha: rest.a + (d.a || 0), beta: rest.b + (d.b || 0),
                                   gamma: rest.g + (d.g || 0) }, refQ, 'right');
    const r = (o) => ({ x: +o.x.toFixed(2), y: +o.y.toFixed(2), z: +o.z.toFixed(2) });
    const t = 50 * Math.PI / 180;
    return { up: r(at({ b: t }).shaft), round: r(at({ a: t }).shaft),
             twistShaft: r(at({ g: t }).shaft), twistFace: r(at({ g: t }).normal) };
  });
  console.log(`  raise the arm 50°  -> shaft ${JSON.stringify(lift.up)}`);
  console.log(`  swing it across    -> shaft ${JSON.stringify(lift.round)}`);
  console.log(`  twist the handle   -> shaft ${JSON.stringify(lift.twistShaft)}, `
            + `face ${JSON.stringify(lift.twistFace)}`);
  ok('raising the arm lifts the racket head', lift.up.y > 0.7 && lift.up.z < -0.5,
     JSON.stringify(lift.up));
  ok('swinging across sweeps it sideways, not upward',
     Math.abs(lift.round.x) > 0.7 && Math.abs(lift.round.y) < 0.05, JSON.stringify(lift.round));
  ok('twisting the handle turns the face and leaves the shaft alone',
     Math.abs(lift.twistShaft.z + 1) < 0.02 && Math.abs(lift.twistFace.x + 1) > 0.2,
     JSON.stringify(lift.twistShaft));

  console.log('\n7. THE SWING IS READ WHEN IT HAPPENED, NOT WHEN IT ARRIVED');
  // The phone can only report a stroke once the arm has slowed, so the message is
  // a few hundred milliseconds old. Uncompensated, the court reads the shuttle
  // well past the player and calls a reach a miss.
  const lagged  = await rep(page, { delay: 1600, racket: { pitchDeg: -12, yawDeg: 0, power: 0.8, source: 'test' } });
  const rewound = await rep(page, { delay: 1600, racket: { pitchDeg: -12, yawDeg: 0, power: 0.8, source: 'test', ageMs: 300 } });
  const manual  = await rep(page, { delay: 1300, racket: { pitchDeg: -12, yawDeg: 0, power: 0.8, source: 'test' } });
  console.log(`  swung at 1.60 s, no age    -> contact ${lagged.ahead} m ahead`);
  console.log(`  swung at 1.60 s, 300 ms old -> contact ${rewound.ahead} m ahead`);
  console.log(`  swung at 1.30 s, no age    -> contact ${manual.ahead} m ahead`);
  ok('a stale swing is rewound to when the stroke actually peaked',
     Math.abs(rewound.ahead - manual.ahead) < 0.25, `${rewound.ahead} vs ${manual.ahead}`);
  // 0.69 m here. The shuttle has shed most of its speed by the hitting window, so
  // this is the cheap end of the error; earlier in the flight it is metres.
  ok('and ignoring that age moves the contact point most of a metre',
     Math.abs(rewound.ahead - lagged.ahead) > 0.5, `${rewound.ahead} vs ${lagged.ahead}`);

  console.log(`\n${pass} passed, ${fail} failed\n`);
  await b.close();
  process.exit(fail ? 1 : 0);
};
run().catch(e => { console.error(e); process.exit(1); });
