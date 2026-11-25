// The rep loop and the 3D view.
//
// This is a browser stand-in for the headset. In the headset the player's head and
// racket are tracked and they physically step; here, stepping is a key and the swing
// is a keypress whose TIMING sets the contact point. The variable that matters to
// the coaching layer - how far in front of the head the shuttle was met - is the
// same one in both, which is why the interaction can be judged from this build.

import * as THREE from '../vendor/three.module.js';
import { buildHall, buildTarget, COURT } from './court.js';
import { simulate, clearedNet, feed } from './shuttle.js';
import { evaluateContact, produceShot, classifyShot, reachRadius, IDEAL,
         BODY } from './contact.js';
import { planRemap, applyRemap, remapLabel } from './remap.js';

export const PLAYER_Z = 5.5;   // rear court, behind where a clear will drop
export const HEAD_Y = 1.70;
const STEP = 0.62;              // metres per step
const BOUND = { x: 2.4, zMin: 4.0, zMax: 6.4 };   // where the player may stand
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

  // Wide, because in the headset this fills the player's view. On a laptop a
  // narrow field of view makes the hall feel like a window rather than a room.
  const camFP = new THREE.PerspectiveCamera(78, 1, 0.1, 100);
  const camSide = new THREE.PerspectiveCamera(50, 1, 0.1, 100);
  camSide.position.set(9.5, 3.4, 3.0);
  camSide.lookAt(0, 1.6, 0);
  // Over the shoulder, for checking that the racket on screen is yours. Looking
  // down the court is no use for that: an arm raised overhead sits above the
  // field of view, exactly as it does in life.
  const camMirror = new THREE.PerspectiveCamera(55, 1, 0.1, 100);
  let cam = camFP;

  /* ---------- player ---------- */
  const player = { x: 0, z: PLAYER_Z, moved: false };
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
    new THREE.SphereGeometry(0.07, 12, 10),
    new THREE.MeshBasicMaterial({ color: 0xff6b6b }));
  contactMark.visible = false; scene.add(contactMark);
  // the gap between where the shuttle is and where the stroke wants to meet it
  const gapLine = new THREE.Line(new THREE.BufferGeometry(),
    new THREE.LineDashedMaterial({ color: 0xffc46b, dashSize: 0.09, gapSize: 0.06 }));
  gapLine.visible = false; scene.add(gapLine);
  const showGap = (a, b) => {
    gapLine.geometry.dispose();
    gapLine.geometry = new THREE.BufferGeometry().setFromPoints([a, b]);
    gapLine.computeLineDistances();
    gapLine.visible = true;
  };

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
  // scratch objects for the racket pose, so the frame loop allocates nothing
  const shoulderPos = new THREE.Vector3(), armDir = new THREE.Vector3();
  const xAxis = new THREE.Vector3(), yAxis = new THREE.Vector3(), zAxis = new THREE.Vector3();
  const basis = new THREE.Matrix4();

  function startRep() {
    const f = feed(feedRng);
    flight = simulate(f.p0, f.v0);
    repT0 = performance.now(); pausedTotal = 0; pausedAt = null; frozen = false;
    state = S.INCOMING;
    // Recover to base between reps, as you would on court. Without this the
    // player drifts across the session and every rep starts somewhere different.
    player.x = 0; player.z = PLAYER_Z; player.moved = false;
    landMark.visible = false; contactMark.visible = false; ghost.visible = false;
    setLine(trailOut, []);
    rep = { id: reps.length, swung: false, resolved: false };
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

  function swing(racketIn) {
    if (state !== S.INCOMING || rep.swung || rep.resolved) return;
    const s = sampleFlight(tNow());
    const r = racketIn || { pitchDeg: -12, yawDeg: 0, power: 0.75, source: 'keyboard' };

    const c = evaluateContact({ player, shuttle: s, remapFactor,
                                hand: hooks.racketHand?.() ?? 'right' });

    // A swing at thin air is a whiff. The shuttle carries on; nothing is produced.
    if (!c.reached) {
      Object.assign(rep, {
        swung: true, resolved: true, outcome: 'whiff', reason: c.reason,
        ahead: c.ahead, dist: c.dist, reach: c.reach, racket: r.source,
        contact: { x: s.x, y: s.y, z: s.z },
      });
      reps.push(rep);
      contactMark.position.set(s.x, s.y, s.z); contactMark.visible = true;
      ghost.position.set(player.x, Math.min(BODY_REACH_Y(), 2.9), player.z - IDEAL.ahead);
      ghost.visible = true;
      showGap(contactMark.position.clone(), ghost.position.clone());
      hooks.onShot?.(rep, reps);
      return;
    }

    const shot = produceShot(c, { facePitch: r.pitchDeg, faceYaw: r.yawDeg,
                                  power: r.power });
    const kind = classifyShot(shot);
    const out = simulate(shot.p0, shot.v0);
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
      swung: true, resolved: true,
      ahead: c.ahead, lateral: c.lateral, vHeight: c.height,
      underneath: c.underneath, stretched: c.stretched, moved: player.moved,
      facePitch: r.pitchDeg, power: +r.power.toFixed(2), racket: r.source,
      kind, pitchDeg: shot.pitchDeg, speed: shot.speed, forcedUp: shot.forcedUp,
      contact: { x: s.x, y: s.y, z: s.z },
      landing: out.landing, outcome, netY: +net.y.toFixed(2),
      remapFactor,
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

    const last3 = reps.slice(-3);
    offerPause = last3.length === 3 && last3.every(x => x.outcome !== 'in');
    hooks.onOfferPause?.(offerPause);
  }

  const BODY_REACH_Y = () => 1.45 + reachRadius(remapFactor) * 0.92;

  /** Step on the court. dx is sideways, dz is towards or away from the net. */
  function step(dx, dz = 0) {
    player.x = Math.max(-BOUND.x, Math.min(BOUND.x, player.x + dx * STEP));
    player.z = Math.max(BOUND.zMin, Math.min(BOUND.zMax, player.z + dz * STEP));
    player.moved = true;
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
      showGap(contactMark.position.clone(), ghost.position.clone());
    } else {
      if (pausedAt !== null) { pausedTotal += performance.now() - pausedAt; pausedAt = null; }
      ghost.visible = false; contactMark.visible = false; gapLine.visible = false;
    }
    hooks.onFrozen?.(frozen);
    return frozen;
  }

  /** Advance the rep state machine. Safe to call from a frame or a timer. */
  function advance() {
    if (!flight || frozen) return;
    const end = flight.pts[flight.pts.length - 1].t;
    if (state === S.INCOMING && tNow() > end) {
      if (!rep.resolved) {
        rep.swung = false; rep.resolved = true; rep.outcome = 'missed'; rep.ahead = null;
        reps.push(rep);
        hooks.onShot?.(rep, reps);
      }
      state = S.DONE;
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
      camFP.aspect = camSide.aspect = camMirror.aspect = w / h;
      camFP.updateProjectionMatrix(); camSide.updateProjectionMatrix();
      camMirror.updateProjectionMatrix();
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
    // A player watches the shuttle, not the far wall, and that is also what keeps
    // their own racket inside the view at the moment it matters.
    if (flight && (state === S.INCOMING || state === S.OUT)) {
      const look = sampleFlight(tF);
      camFP.lookAt(look.x * 0.6, Math.max(1.2, Math.min(3.2, look.y)), look.z);
    } else {
      camFP.lookAt(player.x * 0.35, 1.75, -3.0);
    }
    bodyMarker.position.set(player.x, 0.03, player.z);
    const sh = sampleFlight(tF);
    const reach = (state === S.INCOMING && flight)
      ? Math.max(0.6, Math.min(1.0, 1.0 - Math.abs(sh.z - player.z) / 6))
      : 0.6;
    const swingUp = state === S.INCOMING ? reach : 0.45;
    const side = (hooks.racketHand?.() === 'left') ? -1 : 1;
    const att = hooks.racketAttitude?.();

    if (att?.shaft) {
      /* With a phone connected the racket has all three degrees of freedom the
         wrist has. The phone gives the direction its top edge points, which is the
         shaft, and the direction its screen faces, which is the face. Those two
         vectors are a complete orientation, so the racket is built from them
         rather than from a pair of Euler angles.

         The arm is not tracked, so the hand is placed along the shaft from the
         shoulder. In an overhead the upper arm does roughly follow the racket, and
         the alternative is a racket that pivots on a point fixed in space, which
         is what it looked like before. */
      shoulderPos.set(player.x + side * 0.18, BODY.shoulderY, player.z);
      racket.scale.setScalar(remapFactor);
      // How much the arm follows the racket. Overhead it follows almost exactly;
      // at rest it hangs, which is why pointing the racket forward at hip height
      // must not put the hand up at the shoulder.
      const follow = Math.max(0, Math.min(1, att.shaft.y + 0.25));
      armDir.set(0, -1, 0).lerp(att.shaft, follow).normalize();
      racket.position.copy(shoulderPos)
        .addScaledVector(armDir, BODY.armReach * remapFactor);

      yAxis.copy(att.shaft).normalize();
      zAxis.copy(att.normal).addScaledVector(yAxis, -att.normal.dot(yAxis));
      if (zAxis.lengthSq() < 1e-6) zAxis.set(0, 1, 0).addScaledVector(yAxis, -yAxis.y);
      zAxis.normalize();
      xAxis.crossVectors(yAxis, zAxis);
      basis.makeBasis(xAxis, yAxis, zAxis);
      racket.quaternion.setFromRotationMatrix(basis);
    } else {
      // No phone. The racket follows a scripted rise so the court still reads.
      racket.scale.setScalar(1);
      racket.position.set(player.x + side * 0.46 + (sh.x - player.x) * 0.06,
                          1.02 + swingUp * 0.92,
                          player.z - 1.02 - swingUp * 0.20);
      racket.rotation.set(-0.30 + swingUp * 0.34, 0, side * (-0.62 + swingUp * 0.50));
    }

    // furniture fades in as the player nears it
    for (const f of furniture) {
      const d = Math.hypot(f.position.x - player.x, f.position.z - player.z);
      const want = d < 1.9 ? Math.min(0.42, (1.9 - d) / 2.2) : 0;
      f.material.opacity += (want - f.material.opacity) * Math.min(1, dt * 6);
    }

    if (cam === camMirror) {
      const sideM = (hooks.racketHand?.() === 'left') ? -1 : 1;
      camMirror.position.set(player.x + sideM * 2.2, 2.05, player.z + 2.4);
      camMirror.lookAt(player.x + sideM * 0.25, 1.40, player.z - 0.25);
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
    get player() { return { ...player }; },
    get reach() { return reachRadius(remapFactor); },
    setView(v) { cam = v === 'side' ? camSide : v === 'mirror' ? camMirror : camFP; },
    get view() { return cam === camSide ? 'side' : cam === camMirror ? 'mirror' : 'fp'; },
    get remap() { return { plan, factor: remapFactor, label: remapLabel(plan, remapFactor) }; },
    useFixedFeed(on) { feedRng = on ? () => 0.5 : Math.random; },
    setRemap(f) { remapFactor = Math.max(1, Math.min(plan.factor, f)); },
    setRoom(r) { room = { ...room, ...r }; plan = planRemap({ ...room, wanted: IDEAL.height });
                 remapFactor = plan.factor; },
    showIdeal(on) { if (on) { ghost.position.set(player.x,
        applyRemap(plan.safeReal, remapFactor), player.z - IDEAL.ahead); }
        ghost.visible = on; },
    markContact(r, on) {
      if (on && r?.contact) {
        contactMark.position.set(r.contact.x, r.contact.y, r.contact.z);
        ghost.position.set(r.contact.x, applyRemap(plan.safeReal, remapFactor),
                           PLAYER_Z - IDEAL.ahead);
        ghost.visible = true;
        showGap(contactMark.position.clone(), ghost.position.clone());
      } else { gapLine.visible = false; }
      contactMark.visible = !!on;
    },
  };
}
