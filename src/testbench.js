// The test bench.
//
// Four movements run back to back in the same court, with the same phone and the
// same calibration the drill uses. There is nothing to press while moving: each
// movement starts its own recording, gates on waypoints the player steers the
// racket through, and stops the recording when the last one is cleared.
//
// A waypoint is a DIRECTION, not a place. The racket's shaft (or its face, for the
// wrist tests) has to point within TOL of it and stay there for HOLD. That is what
// makes the tests independent of where the player is standing.

import { summarise, oneLine } from './takestats.js';

const TOL = 22;        // degrees. Generous: this is a sensor test, not a skill test
const HOLD = 220;      // ms the direction must be held before a waypoint clears
const LIMIT = 25000;   // ms before a movement gives up and moves on
const GAP = 1800;      // ms between movements

const U = (x, y, z) => { const n = Math.hypot(x, y, z) || 1; return [x/n, y/n, z/n]; };
const DOT = (a, b) => a[0]*b[0] + a[1]*b[1] + a[2]*b[2];
const ANG = (a, b) => Math.acos(Math.max(-1, Math.min(1, DOT(a, b)))) * 180 / Math.PI;

/* Court axes: +x to the player's racket side, +y up, -z towards the net.
   At the rest pose the shaft points (0,0,-1) and the strings face (-1,0,0).
   Everything is written for a right-hander and mirrored in x for a left-hander. */
export const TESTS = [
  {
    id: 'wrist-roll',
    name: 'Wrist roll',
    say: 'Arm still, hanging as it was for calibration. Roll your wrist so the face '
       + 'turns up, back to flat, then down, then flat again.',
    track: 'face',
    hold: 'shaft',                       // what should NOT move
    points: [
      { label: 'face up',    dir: U(0, 1, 0) },
      { label: 'flat again', dir: U(-1, 0, 0) },
      { label: 'face down',  dir: U(0, -1, 0) },
      { label: 'back flat',  dir: U(-1, 0, 0) },
    ],
  },
  {
    id: 'wrist-yaw',
    name: 'Wrist yaw',
    say: 'Arm still. Point the racket head left, back to the middle, then right, '
       + 'then back to the middle. Keep it level.',
    track: 'shaft',
    points: [
      { label: 'point left',  dir: U(-0.6, 0, -0.8) },
      { label: 'middle',      dir: U(0, 0, -1) },
      { label: 'point right', dir: U(0.6, 0, -0.8) },
      { label: 'middle',      dir: U(0, 0, -1) },
    ],
  },
  {
    id: 'lateral-raise',
    name: 'Lateral raise',
    say: 'Wrist locked to the arm. Raise your whole arm out to your racket side, up '
       + 'overhead, across to the other side, then let it fall back to rest.',
    track: 'shaft',
    points: [
      { label: 'out to the side', dir: U(0.9, 0.45, 0) },
      { label: 'overhead',        dir: U(0, 1, 0) },
      { label: 'across the body', dir: U(-0.9, 0.45, 0) },
      { label: 'back to rest',    dir: U(0, 0, -1) },
    ],
  },
  {
    id: 'front-raise',
    name: 'Front and back raise',
    say: 'Wrist locked to the arm. Raise your arm straight out in front, up overhead, '
       + 'carry on behind you as far as is comfortable, then return to rest.',
    track: 'shaft',
    points: [
      { label: 'out in front', dir: U(0, 0.5, -0.87) },
      { label: 'overhead',     dir: U(0, 1, 0) },
      { label: 'behind you',   dir: U(0, 0.6, 0.8) },
      { label: 'back to rest', dir: U(0, 0, -1) },
    ],
  },
];

export function createBench({ sim, racket, $ }) {
  let run = null;      // { ti, pi, since, t0, samples, file }
  let raf = 0;
  const results = [];  // one summary per movement, kept for the page

  const el = {
    start: $('#t-start'), stop: $('#t-stop'), name: $('#t-name'), say: $('#t-say'),
    dots: $('#t-dots'), live: $('#t-live'), list: $('#t-list'), done: $('#t-done'),
    now: $('#t-now'), res: $('#t-res'), resBody: $('#t-res-body'),
  };

  el.list.innerHTML = TESTS.map(t => `<li id="tl-${t.id}">${t.name}</li>`).join('');

  const paintDots = () => {
    if (!run) { el.dots.innerHTML = ''; return; }
    const pts = TESTS[run.ti].points;
    el.dots.innerHTML = pts.map((p, i) =>
      `<span class="dot ${i < run.pi ? 'done' : i === run.pi ? 'live' : ''}">${p.label}</span>`
    ).join('');
  };

  const showTest = () => {
    const t = TESTS[run.ti];
    el.now.querySelector('.k').textContent = `Movement ${run.ti + 1} of ${TESTS.length}`;
    el.name.textContent = t.name;
    el.say.textContent = t.say;
    for (const x of TESTS) $(`#tl-${x.id}`).className = '';
    $(`#tl-${t.id}`).className = 'live';
    sim.setCheckpoints(t.points.map(p => ({ dir: p.dir })));
    t.points.forEach((_, i) => sim.setCheckpointState(i, i === 0 ? 'live' : 'todo'));
    paintDots();
  };

  const startTest = (ti) => {
    run = { ti, pi: 0, since: 0, t0: performance.now(), samples: [], file: null };
    showTest();
    racket.record(true, `${ti + 1} ${TESTS[ti].id}`);
  };

  const finishTest = (why) => {
    if (!run) return;
    const t = TESTS[run.ti];

    // The bench works out its own verdict and saves it. The numbers are the whole
    // point of running the set, so they should not need a second program.
    const stats = summarise(run.samples, t.track);
    const line = oneLine(`${run.ti + 1} ${t.id}`, stats);
    results[run.ti] = { id: t.id, name: t.name, why, stats, line };
    racket.record(false);
    racket.report({ label: `${run.ti + 1} ${t.id}`, file: run.file, stats, line });
    renderResults();

    $(`#tl-${t.id}`).className = why === 'done' ? 'done' : 'gaveup';
    const next = run.ti + 1;
    run = null;
    sim.setCheckpoints([]);
    if (next < TESTS.length) {
      el.name.textContent = 'Next movement in a moment';
      el.say.textContent = TESTS[next].say;
      el.dots.innerHTML = '';
      setTimeout(() => { if (el.start.disabled) startTest(next); }, GAP);
    } else {
      stop(true);
    }
  };

  function tick() {
    raf = requestAnimationFrame(tick);
    if (!racket.online) { el.live.textContent = 'phone offline'; return; }
    const st = racket.state;
    const shaft = [st.shaft.x, st.shaft.y, st.shaft.z];
    const face = [st.normal.x, st.normal.y, st.normal.z];
    if (run) run.samples.push({ t: performance.now(), shaft, face, w: st.w, g: st.g ?? null });
    el.live.textContent =
      `shaft ${shaft.map(v => v.toFixed(2)).join(', ')}   `
    + `face ${face.map(v => v.toFixed(2)).join(', ')}   ${st.w.toFixed(1)} rad/s`;
    if (!run) return;

    const t = TESTS[run.ti];
    const pt = t.points[run.pi];
    const live = t.track === 'face' ? face : shaft;
    const want = sim.checkpointDir(pt.dir);
    const off = ANG(live, want);

    const now = performance.now();
    if (off < TOL) {
      if (!run.since) run.since = now;
      if (now - run.since >= HOLD) {
        sim.setCheckpointState(run.pi, 'done');
        run.pi++; run.since = 0; run.t0 = now;
        if (run.pi >= t.points.length) return finishTest('done');
        sim.setCheckpointState(run.pi, 'live');
        paintDots();
      }
    } else {
      run.since = 0;
    }

    const held = t.hold === 'shaft' ? ANG(shaft, sim.checkpointDir([0, 0, -1])) : null;
    el.say.textContent = `${t.say}\n\nNow: ${pt.label} — ${off.toFixed(0)}° away`
      + (held !== null && held > 45 ? `  (your arm has moved ${held.toFixed(0)}°, keep it still)` : '');

    if (now - run.t0 > LIMIT) finishTest('timeout');
  }

  function start() {
    if (!racket.online) {
      el.say.textContent = 'No phone is connected. Set it up on the Drill tab first, '
                         + 'then come back; the test bench uses the same racket.';
      return;
    }
    el.done.hidden = true;
    el.start.disabled = true;
    sim.setView('mirror');
    startTest(0);
    if (!raf) raf = requestAnimationFrame(tick);
  }

  function stop(completed = false) {
    if (run) racket.record(false);
    run = null;
    sim.setCheckpoints([]);
    el.start.disabled = false;
    el.dots.innerHTML = '';
    el.name.textContent = completed ? 'Set complete' : 'Stopped';
    el.now.querySelector('.k').textContent = 'Not running';
    el.say.textContent = completed
      ? 'Every movement was recorded separately.'
      : 'Stopped. Nothing after this point was recorded.';
    el.done.hidden = !completed;
    el.done.innerHTML = 'Numbers are in the table above and saved to '
      + '<code>recordings/summary.txt</code> with a full report beside each take.';
  }

  /** The verdict, on the page, as each movement finishes. */
  function renderResults() {
    const rows = results.filter(Boolean).map(r => {
      const s = r.stats, v = s.ok ? s.verdict[0] : { kind: 'nodata', say: s.reason };
      if (!s.ok) return `<tr><td>${r.name}</td><td colspan="5">${v.say}</td></tr>`;
      return `<tr class="v-${v.kind}">
        <td>${r.name}${r.why === 'done' ? '' : ' <em>(timed out)</em>'}</td>
        <td>${s.hz} Hz</td>
        <td><strong>${s.ratio}</strong></td>
        <td>${s.gyroPeak} rad/s</td>
        <td>${s.returnedToStart}&deg;</td>
        <td>${v.say}</td></tr>`;
    }).join('');
    el.res.hidden = !rows;
    el.resBody.innerHTML = rows;
  }

  el.start.addEventListener('click', start);
  el.stop.addEventListener('click', () => stop(false));

  return {
    get results() { return results.filter(Boolean); },
    /** The relay answers a record request with the file it opened. */
    noteRecording(m) { if (run && m.on && m.file) run.file = m.file; },
    /** The bench only draws and listens while its tab is open. */
    setActive(on) {
      if (on) { if (!raf) raf = requestAnimationFrame(tick); }
      else { cancelAnimationFrame(raf); raf = 0; if (run) stop(false); }
    },
  };
}
