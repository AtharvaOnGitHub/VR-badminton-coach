// Shuttle flight. SIMULATED, but not a parabola.
//
// A shuttlecock has an unusually high drag-to-mass ratio: mass 5.19 g, terminal
// velocity about 6.8 m/s. That gives the steep, sharply decelerating arc that makes
// badminton look like badminton, and a plain projectile would read as wrong to any
// player. Quadratic drag: a = g - (k/m)|v|v, with k/m fixed by terminal velocity.

const G = 9.81;
const MASS = 0.00519;          // kg
const V_TERM = 6.8;            // m/s
const KM = G / (V_TERM * V_TERM);   // (k/m), = 0.2121 per metre

/** Integrate a flight to the floor. Returns sampled points and the landing. */
export function simulate(p0, v0, { dt = 1 / 240, maxT = 8 } = {}) {
  const pts = [];
  let p = { ...p0 }, v = { ...v0 }, t = 0;
  while (t < maxT) {
    const sp = Math.hypot(v.x, v.y, v.z);
    const ax = -KM * sp * v.x;
    const ay = -G - KM * sp * v.y;
    const az = -KM * sp * v.z;
    v.x += ax * dt; v.y += ay * dt; v.z += az * dt;
    const prevY = p.y;
    p.x += v.x * dt; p.y += v.y * dt; p.z += v.z * dt;
    t += dt;
    if (pts.length === 0 || t - pts[pts.length - 1].t > 1 / 90) {
      pts.push({ t, x: p.x, y: p.y, z: p.z });
    }
    if (p.y <= 0 && prevY > 0) {
      pts.push({ t, x: p.x, y: 0, z: p.z });
      return { pts, landing: { x: p.x, z: p.z, t }, hitFloor: true };
    }
  }
  return { pts, landing: { x: p.x, z: p.z, t }, hitFloor: false };
}

/** Did the flight cross the net plane (z = 0) above the tape? */
export function clearedNet(pts, netH = 1.524) {
  for (let i = 1; i < pts.length; i++) {
    const a = pts[i - 1], b = pts[i];
    if ((a.z > 0 && b.z <= 0) || (a.z < 0 && b.z >= 0)) {
      const f = Math.abs(a.z) / (Math.abs(a.z) + Math.abs(b.z) || 1e-6);
      const y = a.y + (b.y - a.y) * f;
      return { crossed: true, y, cleared: y > netH };
    }
  }
  return { crossed: false, y: 0, cleared: false };
}

/**
 * The feeder's clear: a high, loopy shuttle from the far court, arriving at the
 * player's rear court at a hittable height. Launch speed is ~45 m/s because a
 * shuttle sheds nearly all of it to drag; at 20 m/s it would not reach the net.
 * Mild variation so reps are not identical.
 */
export function feed(rng = Math.random) {
  const speed = 45 + (rng() - 0.5) * 2.4;
  const pitchDeg = 50 + (rng() - 0.5) * 2.0;
  const yawDeg = (rng() - 0.5) * 5.0;
  const pitch = pitchDeg * Math.PI / 180, yaw = yawDeg * Math.PI / 180;
  return {
    p0: { x: 0, y: 1.0, z: -5.4 },
    v0: { x: Math.sin(yaw) * speed * Math.cos(pitch),
          y: Math.sin(pitch) * speed,
          z: Math.cos(yaw) * speed * Math.cos(pitch) },
    arrivesAt: 1.9,     // approx seconds until it reaches the hitting zone
  };
}

/** Where the player should meet it. Contact in front of the head, high. */
export const IDEAL = { ahead: 0.55, height: 2.85 };

/**
 * Turn a contact into a launch.
 *
 * `ahead`  - metres the shuttle is in front of the player's head at contact.
 *            This is the variable the coaching layer talks about, because it is
 *            the one a player can feel and change.
 * `height` - VIRTUAL contact height, after the reach remap (see remap.js).
 * `power`  - 0..1 swing commitment.
 *
 * Calibrated against the flight model: from a 2.85 m contact at the rear court,
 * meeting it between 0.4 m and 0.8 m in front of the head lands in the target box,
 * later than that sails long, and reaching out past about 0.9 m steepens the shot
 * into the net. The 18 deg-per-metre sensitivity was chosen by sweeping the flight
 * model: 30 moved the landing 25 cm for every centimetre of contact, which makes a
 * drill feel random rather than learnable. Power changes how hard the shuttle
 * arrives far more than where it lands, which is true of a real smash.
 */
export function strike({ ahead, height, power = 0.8, lateral = 0 }) {
  const errAhead = IDEAL.ahead - ahead;            // >0 means late, behind the head
  const errHeight = IDEAL.height - height;         // >0 means contact too low
  const pitchDeg = -12 + errAhead * 18 + errHeight * 6;
  const pitch = pitchDeg * Math.PI / 180;
  const speed = 46 + power * 16;
  const yaw = lateral * 0.10;
  return {
    p0: { x: lateral * 0.3, y: Math.max(0.7, height), z: 4.0 },
    v0: { x: Math.sin(yaw) * speed * Math.cos(pitch),
          y: Math.sin(pitch) * speed,
          z: -Math.cos(yaw) * Math.cos(pitch) * speed },
    pitchDeg,
  };
}
