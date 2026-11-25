// The rep loop and the 3D view.
//
// This is a browser stand-in for the headset. In the headset the player's head and
// racket are tracked and they physically step; here, stepping is a key and the swing
// is a keypress whose TIMING sets the contact point. The variable that matters to
// the coaching layer - how far in front of the head the shuttle was met - is the
// same one in both, which is why the interaction can be judged from this build.

import * as THREE from '../vendor/three.module.js';
import { buildHall, buildTarget, COURT } from './court.js';
import { simulate, clearedNet, feed, strike, IDEAL } from './shuttle.js';
import { planRemap, applyRemap, remapLabel } from './remap.js';

export const PLAYER_Z = 4.0;
export const HEAD_Y = 1.70;
const STEP = 0.62;              // metres per step
const TARGET = { x: 0, z: -4.8, w: 2.0, d: 2.8 };

export function createSim(canvas, hooks = {}) {
  // Optional fixed feed, used by tools/check.mjs so a timing sweep is not confounded
  // by the feeder's own variation between reps.
  let feedRng = Math.random;
  /* ---------- renderer / scene ---------- */
  const renderer = new THREE.WebGLRenderer({ canvas, antialias: true });
  renderer.setPixelRatio(Math.min(devicePixelRatio, 2));
  const scene = new THREE.Scene();
  buildHall(scene);
  const targetZone = buildTarget(scene, TARGET);

  const camFP = new THREE.PerspectiveCamera(66, 1, 0.1, 100);
  const camSide = new THREE.PerspectiveCamera(50, 1, 0.1, 100);
  camSide.position.set(9.5, 3.4, 3.0);
  camSide.lookAt(0, 1.6, 0);
  let cam = camFP;

  /* ---------- player ---------- */
  const player = { x: 0, z: PLAYER_Z, stepped: false };
  const racket = new THREE.Group();
  const forearm = new THREE.Mesh(
    new THREE.CylinderGeometry(0.045, 0.055, 0.30, 10),
    new THREE.MeshStandardMaterial({ color: 0xc8926b }));
  forearm.position.y = -0.14;
  const grip = new THREE.Mesh(
    new THREE.CylinderGeometry(0.018, 0.020, 0.16, 8),
    new THREE.MeshStandardMaterial({ color: 0x23282e }));
  grip.position.y = 0.08;
  const shaft = new THREE.Mesh(
    new THREE.CylinderGeometry(0.008, 0.011, 0.30, 8),
    new THREE.MeshStandardMaterial({ color: 0x2b3138 }));
  shaft.position.y = 0.31;
  // head sits in the XY plane so the face looks down the court, not at the sky
  const head = new THREE.Mesh(
    new THREE.TorusGeometry(0.115, 0.010, 8, 26),
    new THREE.MeshStandardMaterial({ color: 0xe8edf2 }));
  head.position.y = 0.575;
  const face = new THREE.Mesh(
    new THREE.CircleGeometry(0.108, 26),
    new THREE.MeshBasicMaterial({ color: 0xdfe9f2, transparent: true, opacity: 0.16,
                                  side: THREE.DoubleSide }));
  face.position.y = 0.575;
  racket.add(forearm, grip, shaft, head, face);
  scene.add(racket);

  const bodyMarker = new THREE.Mesh(
    new THREE.RingGeometry(0.28, 0.34, 28),
    new THREE.MeshBasicMaterial({ color: 0x6fd3ff, transparent: true, opacity: 0.55 }));
  bodyMarker.rotation.x = -Math.PI / 2; bodyMarker.position.y = 0.03;
  scene.add(bodyMarker);

  /* ---------- shuttle + trails ---------- */
  const shuttleMesh = new THREE.Group();
  const cork = new THREE.Mesh(new THREE.SphereGeometry(0.035, 12, 10),
    new THREE.MeshStandardMaterial({ color: 0xffffff }));
  const skirt = new THREE.Mesh(new THREE.ConeGeometry(0.055, 0.10, 12, 1, true),
    new THREE.MeshBasicMaterial({ color: 0xf2f6fa, transparent: true, opacity: 0.55,
                                  side: THREE.DoubleSide }));
  skirt.position.y = 0.07; skirt.rotation.x = Math.PI;
  shuttleMesh.add(cork, skirt);
  scene.add(shuttleMesh);

  const mkLine = col => {
    const l = new THREE.Line(new THREE.BufferGeometry(),
      new THREE.LineBasicMaterial({ color: col, transparent: true, opacity: 0.9 }));
    l.frustumCulled = false; scene.add(l); return l;
  };
  const trailIn = mkLine(0x7f8c99);
  const trailOut = mkLine(0x3fd08a);
  // three.js setFromPoints reuses an existing position buffer and iterates its old
  // count, so handing it a shorter array throws. Replace the geometry instead.
  const setLine = (line, pts) => {
    line.geometry.dispose();
    line.geometry = new THREE.BufferGeometry().setFromPoints(pts);
  };

  const landMark = new THREE.Mesh(
    new THREE.RingGeometry(0.14, 0.2, 20),
    new THREE.MeshBasicMaterial({ color: 0xff9f43 }));
  landMark.rotation.x = -Math.PI / 2; landMark.visible = false;
  scene.add(landMark);

  // where the stroke wants to be met — only shown when the player asks
  const ghost = new THREE.Mesh(
    new THREE.SphereGeometry(0.075, 14, 12),
    new THREE.MeshBasicMaterial({ color: 0x3fd08a, transparent: true, opacity: 0.45 }));
  ghost.visible = false; scene.add(ghost);
  const contactMark = new THREE.Mesh(
    new THREE.SphereGeometry(0.06, 12, 10),
    new THREE.MeshBasicMaterial({ color: 0xff6b6b }));
  contactMark.visible = false; scene.add(contactMark);

  /* ---------- furniture fade-in (passthrough safety) ---------- */
  const furniture = [];
  const addFurniture = (w, h, d, x, z, name) => {
    const m = new THREE.Mesh(new THREE.BoxGeometry(w, h, d),
      new THREE.MeshBasicMaterial({ color: 0x7fd4ff, transparent: true, opacity: 0,
                                    wireframe: true }));
    m.position.set(x, h / 2, z); m.userData = { name };
    scene.add(m); furniture.push(m); return m;
  };
  addFurniture(1.9, 0.85, 0.85, -1.75, 4.5, 'sofa');
  addFurniture(0.45, 1.5, 0.45, 1.65, 3.3, 'lamp');

  /* ---------- remap ---------- */
  let room = { ceiling: 2.4, reach: 2.35 };
  let plan = planRemap({ ...room, wanted: IDEAL.height });
  let remapFactor = plan.factor;

  /* ---------- rep state ---------- */
  const S = { IDLE: 'idle', INCOMING: 'incoming', OUT: 'outgoing', DONE: 'done' };
  let state = S.IDLE;
  let flight = null, frozen = false;
  // Flight time comes from the wall clock, not from accumulated frame deltas, so the
  // physics is identical whether the renderer is running at 120 fps, throttled in a
  // background tab, or not painting at all.
  let repT0 = 0, pausedAt = null, pausedTotal = 0;
  const tNow = () => (performance.now() - repT0 - pausedTotal
                      - (pausedAt !== null ? performance.now() - pausedAt : 0)) / 1000;
  let rep = null;
  const reps = [];
  let offerPause = false;

  const clock = new THREE.Clock();

  function startRep() {
    const f = feed(feedRng);
    flight = simulate(f.p0, f.v0);
    repT0 = performance.now(); pausedTotal = 0; pausedAt = null; frozen = false;
    state = S.INCOMING;
    player.stepped = false;
    landMark.visible = false; contactMark.visible = false; ghost.visible = false;
    setLine(trailOut, []);
    rep = { id: reps.length, swung: false };
    hooks.onState?.({ state, rep: reps.length + 1 });
  }

  function sampleFlight(t) {
    if (!flight || !flight.pts.length) return { x: 0, y: 1.2, z: 0, t: 0 };
    const pts = flight.pts;
    if (t <= pts[0].t) return pts[0];
    for (let i = 1; i < pts.length; i++) {
      if (pts[i].t >= t) {
        const a = pts[i - 1], b = pts[i];
        const f = (t - a.t) / (b.t - a.t || 1e-6);
        return { x: a.x + (b.x - a.x) * f, y: a.y + (b.y - a.y) * f,
                 z: a.z + (b.z - a.z) * f, t };
      }
    }
    return pts[pts.length - 1];
  }

  function swing() {
    if (state !== S.INCOMING || rep.swung) return;
    const s = sampleFlight(tNow());
    const rawAhead = player.z - s.z;              // >0 means met in front of the head
    const lateral = s.x - player.x;
    // Reaching sideways pulls the contact back behind the head. This is why the
    // step matters: without it the player meets the shuttle late by default.
    const stretch = Math.max(0, Math.abs(lateral) - 0.35) * 0.55;
    const ahead = rawAhead - stretch;
    const realHeight = Math.min(s.y, plan.safeReal);
    const vHeight = applyRemap(realHeight, remapFactor);

    const k = strike({ ahead, height: vHeight, power: 0.82, lateral });
    const out = simulate(k.p0, k.v0);
    const net = clearedNet(out.pts);
    const inTarget = net.cleared &&
      Math.abs(out.landing.x - TARGET.x) <= TARGET.w / 2 &&
      Math.abs(out.landing.z - TARGET.z) <= TARGET.d / 2;
    const outcome = !net.cleared ? 'net'
      : inTarget ? 'in'
      : out.landing.z < -(COURT.len / 2) ? 'out'
      : out.landing.z < TARGET.z - TARGET.d / 2 ? 'long'
      : 'short';

    Object.assign(rep, {
      swung: true, ahead: +ahead.toFixed(3), rawAhead: +rawAhead.toFixed(3),
      lateral: +lateral.toFixed(3), stepped: player.stepped,
      realHeight: +realHeight.toFixed(2), vHeight: +vHeight.toFixed(2),
      contact: { x: s.x, y: s.y, z: s.z },
      landing: out.landing, outcome, netY: +net.y.toFixed(2),
      pitchDeg: +k.pitchDeg.toFixed(1), remapFactor,
    });
    reps.push(rep);

    setLine(trailOut, out.pts.map(p => new THREE.Vector3(p.x, p.y, p.z)));
    landMark.position.set(out.landing.x, 0.03, out.landing.z);
    landMark.material.color.set(outcome === 'in' ? 0x3fd08a : 0xff9f43);
    landMark.visible = true;
    contactMark.position.set(s.x, s.y, s.z);

    flight = out; repT0 = performance.now(); pausedTotal = 0; pausedAt = null;
    state = S.OUT;
    hooks.onShot?.(rep, reps);

    // Three misses in a row and the system offers a pause. It offers; it does not take.
    const last3 = reps.slice(-3);
    offerPause = last3.length === 3 && last3.every(r => r.outcome !== 'in');
    hooks.onOfferPause?.(offerPause);
  }

  function step(dir) {
    if (state !== S.INCOMING) return;
    player.x = Math.max(-2.2, Math.min(2.2, player.x + dir * STEP));
    player.stepped = true;
  }

  function togglePause() {
    if (state !== S.INCOMING) return false;
    frozen = !frozen;
    if (frozen) {
      pausedAt = performance.now();
      const s = sampleFlight(tNow());
      ghost.position.set(player.x, applyRemap(plan.safeReal, remapFactor), player.z - IDEAL.ahead);
      ghost.visible = true;
      contactMark.position.set(s.x, s.y, s.z); contactMark.visible = true;
    } else {
      if (pausedAt !== null) { pausedTotal += performance.now() - pausedAt; pausedAt = null; }
      ghost.visible = false; contactMark.visible = false;
    }
    hooks.onFrozen?.(frozen);
    return frozen;
  }

  /** Advance the rep state machine. Safe to call from a frame or a timer. */
  function advance() {
    if (!flight || frozen) return;
    const end = flight.pts[flight.pts.length - 1].t;
    if (state === S.INCOMING && tNow() > end) {
      rep.swung = false; rep.outcome = 'missed'; rep.ahead = null;
      reps.push(rep); state = S.DONE;
      hooks.onShot?.(rep, reps);
    } else if (state === S.OUT && tNow() > end) {
      state = S.DONE;
      hooks.onState?.({ state, rep: reps.length });
    }
  }
  // keeps the rep progressing even if the renderer is throttled or hidden
  setInterval(advance, 60);

  /* ---------- loop ---------- */
  function resize() {
    const w = canvas.clientWidth, h = canvas.clientHeight;
    if (canvas.width !== w || canvas.height !== h) {
      renderer.setSize(w, h, false);
      camFP.aspect = camSide.aspect = w / h;
      camFP.updateProjectionMatrix(); camSide.updateProjectionMatrix();
    }
  }

  function tick() {
    requestAnimationFrame(tick);
    const dt = Math.min(0.05, clock.getDelta());
    resize();
    advance();
    const tF = tNow();
    if (flight && ((state === S.INCOMING) || state === S.OUT)) {
      const s = sampleFlight(tF);
      shuttleMesh.position.set(s.x, s.y, s.z);
      if (state === S.INCOMING) {
        setLine(trailIn, flight.pts.filter(p => p.t <= tF)
          .map(p => new THREE.Vector3(p.x, p.y, p.z)));
      }
    }

    // player + racket pose
    camFP.position.set(player.x, HEAD_Y, player.z);
    camFP.lookAt(player.x * 0.35, 1.75, -3.0);
    bodyMarker.position.set(player.x, 0.03, player.z);
    const sh = sampleFlight(tF);
    const reach = (state === S.INCOMING && flight)
      ? Math.max(0.6, Math.min(1.0, 1.0 - Math.abs(sh.z - player.z) / 6))
      : 0.6;
    const swingUp = state === S.INCOMING ? reach : 0.45;
    racket.position.set(player.x + 0.46 + (sh.x - player.x) * 0.06,
                        1.02 + swingUp * 0.92,
                        player.z - 1.02 - swingUp * 0.20);
    racket.rotation.set(-0.30 + swingUp * 0.34, 0, -0.62 + swingUp * 0.50);

    // furniture fades in as the player nears it
    for (const f of furniture) {
      const d = Math.hypot(f.position.x - player.x, f.position.z - player.z);
      const want = d < 1.9 ? Math.min(0.85, (1.9 - d) / 1.0) : 0;
      f.material.opacity += (want - f.material.opacity) * Math.min(1, dt * 6);
    }

    renderer.render(scene, cam);
  }
  tick();

  return {
    startRep, swing, step, togglePause,
    get reps() { return reps; },
    get state() { return state; },
    get frozen() { return frozen; },
    get tFlight() { return tNow(); },
    get flightEnd() { return flight ? flight.pts.at(-1).t : null; },
    get offerPause() { return offerPause; },
    setView(v) { cam = v === 'side' ? camSide : camFP; },
    get view() { return cam === camSide ? 'side' : 'fp'; },
    get remap() { return { plan, factor: remapFactor, label: remapLabel(plan, remapFactor) }; },
    useFixedFeed(on) { feedRng = on ? () => 0.5 : Math.random; },
    setRemap(f) { remapFactor = Math.max(1, Math.min(plan.factor, f)); },
    setRoom(r) { room = { ...room, ...r }; plan = planRemap({ ...room, wanted: IDEAL.height });
                 remapFactor = plan.factor; },
    showIdeal(on) { if (on) { ghost.position.set(player.x,
        applyRemap(plan.safeReal, remapFactor), player.z - IDEAL.ahead); }
        ghost.visible = on; },
    markContact(r, on) { if (on && r?.contact) {
        contactMark.position.set(r.contact.x, r.contact.y, r.contact.z); }
        contactMark.visible = !!on; },
  };
}
