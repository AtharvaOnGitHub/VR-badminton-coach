// The phone, as a racket.
//
// Connects to the relay and exposes the live racket state plus a swing event.
// What arrives is orientation and angular velocity. What does NOT arrive is
// position: integrating accelerometer drift makes a position estimate useless
// within about a second, so the racket's place in the world is derived from the
// player's court position, and only its ATTITUDE comes from the phone.
//
// HOW THE PHONE IS HELD
// Gripped like a racket handle, along its long edge, with the screen facing the
// player's leg. The top edge of the phone points in front of the player and the
// bottom edge points behind, so the top edge is the direction the racket's shaft
// and head extend in. That grip is what the rest-pose calibration records, and
// everything below is measured as a rotation away from it.

import * as THREE from '../vendor/three.module.js';

const SWING_FULL = 16;     // rad/s treated as a full-power swing

const DEG = 180 / Math.PI;
const clamp = (v, lo, hi) => Math.max(lo, Math.min(hi, v));

/* ---------- orientation ----------
 *
 * DeviceMotion reports the phone's attitude the way the web does: alpha about the
 * vertical, then beta about the phone's own x, then gamma about its own y. In
 * three.js that is Euler order ZXY, and it gives the rotation that carries a
 * direction in the phone's frame to a direction in the world.
 *
 * The world it refers to is compass north and gravity, which the court knows
 * nothing about, so an absolute reading is useless here. What is useful is the
 * rotation AWAY FROM the player's own rest pose. Calibration stores the rest
 * attitude, and every frame after is the difference, which makes all of this
 * independent of which way the player happens to be facing in the room.          */
const quatFrom = (rot, out = new THREE.Quaternion()) =>
  out.setFromEuler(new THREE.Euler(rot.beta ?? 0, rot.gamma ?? 0, rot.alpha ?? 0, 'ZXY'));

export const restQuaternion = (ref) =>
  ref ? quatFrom({ alpha: ref.a, beta: ref.b, gamma: ref.g }) : null;

/* The rest pose frame, in court axes.
 *
 * At rest the phone's top edge points down the court, the screen faces the player's
 * leg, and so the phone's own x axis points at the ceiling. Those three facts are
 * the whole mapping. A left-hander holds the mirror image, so the frame mirrors
 * with them.                                                                      */
const toCourt = (v, hand, out) => hand === 'left'
  ? out.set( v.z, -v.x, -v.y)
  : out.set(-v.z,  v.x, -v.y);

/**
 * Phone attitude -> a complete racket orientation in court axes.
 *
 * Returns the direction the shaft points and the direction the strings face. Those
 * two vectors are the whole racket, which is why the wrist now reaches the shot on
 * all three axes instead of the one that a single Euler angle gave.
 *
 * @param rot  this frame's {alpha,beta,gamma}, radians
 * @param refQ the rest pose quaternion from restQuaternion(), or null
 */
export function attitude(rot, refQ, hand = 'right',
                         shaft = new THREE.Vector3(), normal = new THREE.Vector3()) {
  const q = quatFrom(rot);
  const rel = refQ ? refQ.clone().invert().multiply(q) : q;

  toCourt(new THREE.Vector3(0, 1, 0).applyQuaternion(rel), hand, shaft).normalize();
  toCourt(new THREE.Vector3(0, 0, 1).applyQuaternion(rel), hand, normal).normalize();

  // The face angles the shot model wants are just the direction the strings point.
  // Up and forward is a clear, flat is a drive, down and forward is a smash.
  // Deriving them from the face normal rather than from one Euler angle is what
  // makes all three axes of the wrist reach the shot.
  return {
    shaft, normal,
    pitchDeg: clamp(Math.asin(clamp(normal.y, -1, 1)) * DEG, -40, 55),
    yawDeg:   clamp(Math.atan2(normal.x, -normal.z) * DEG, -35, 35),
  };
}

export function createRacket({ onSwing, onStatus, onHand, onCalibrated,
                               onSession } = {}) {
  let ws = null;
  let online = false;
  let refQ = null;                // the player's rest pose, as a quaternion
  let hand = 'right';
  const state = {
    pitchDeg: 0, yawDeg: 0, w: 0, lastFrame: 0,
    shaft:  new THREE.Vector3(0, 0, -1),    // racket shaft direction, court axes
    normal: new THREE.Vector3(-1, 0, 0),    // racket face normal, court axes
  };

  const readAttitude = (rot) => {
    const a = attitude(rot, refQ, hand, state.shaft, state.normal);
    state.pitchDeg = a.pitchDeg;
    state.yawDeg = a.yawDeg;
  };

  const connect = (host = location.hostname, port = 4179) => {
    try { ws?.close(); } catch {}
    onStatus?.('connecting');
    ws = new WebSocket(`ws://${host}:${port}`);
    ws.onopen = () => { ws.send(JSON.stringify({ hello: 'court' })); onStatus?.('waiting'); };
    ws.onclose = () => { online = false; onStatus?.('offline'); };
    ws.onerror = () => { online = false; onStatus?.('error'); };
    ws.onmessage = (e) => {
      let m; try { m = JSON.parse(e.data); } catch { return; }
      if (m.type === 'racket-online')  { online = true;  onStatus?.('racket connected'); return; }
      if (m.type === 'hand')        { hand = m.hand === 'left' ? 'left' : 'right';
                                      onHand?.(hand); return; }
      if (m.type === 'calibration') { setRef(m.ref); onCalibrated?.(!!refQ); return; }
      if (m.type === 'racket-offline') { online = false; onStatus?.('waiting'); return; }
      // the player can start or stop the drill from the phone as well as from here
      if (m.type === 'session')     { onSession?.(!!m.on, 'phone'); return; }
      if (m.type === 'frame' || m.type === 'swing') {
        if (m.ref && !refQ) setRef(m.ref);       // phone re-sends its reference
        readAttitude(m.rot || {});
        state.w = m.w ?? 0;
        state.lastFrame = performance.now();
        online = true;
      }
      if (m.type === 'swing') {
        onSwing?.({
          pitchDeg: state.pitchDeg, yawDeg: state.yawDeg,
          power: Math.max(0.15, Math.min(1, (m.w ?? 0) / SWING_FULL)),
          w: m.w ?? 0, source: 'phone',
          // how long ago the peak of the stroke was, measured on the phone so no
          // clock has to agree with any other clock
          ageMs: m.ageMs ?? 0,
        });
      }
    };
  };

  const setRef = (ref) => { refQ = restQuaternion(ref); };

  const tell = (msg) => { if (ws?.readyState === 1) ws.send(JSON.stringify(msg)); };

  /* ---- what the court sends back to the phone ----
   *
   * Each of these is a different haptic on the phone, and each one has exactly one
   * meaning. `contact` is the only routine one: the shuttle met the strings, and the
   * strength of the tap is the power of the shot. A whiff sends nothing, because a
   * buzz on every miss is noise and the court already shows the miss. `alert` is the
   * harsh one, reserved for the drill stopping, and it never travels alone: the court
   * shows the same words at the same moment. */
  const contact = (power = 0.6, kind = '') => tell({ type: 'contact', power, kind });
  const alertPhone = (title, detail) => tell({ type: 'alert', title, detail });
  const confirmMirror = () => tell({ type: 'mirror-ok' });
  const setSession = (on) => tell({ type: 'session', on });

  return {
    connect, contact, alertPhone, confirmMirror, setSession,
    get online() { return online && performance.now() - state.lastFrame < 2000; },
    get state() { return state; },
    get hand() { return hand; },
    get calibrated() { return !!refQ; },
    setHand(h) { hand = h === 'left' ? 'left' : 'right'; },
    /** Used when no phone is connected, so the court is still playable. */
    fallbackSwing: () => ({ pitchDeg: -12, yawDeg: 0, power: 0.75, w: 0, source: 'keyboard' }),
  };
}
