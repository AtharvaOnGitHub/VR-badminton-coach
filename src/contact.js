// Contact geometry and shot production.
//
// This replaces the first build's model, which had four flaws that all came from
// the same root: there was no racket, only a keypress and a timer.
//
//  1. A swing connected wherever the shuttle was, including nowhere near it.
//  2. Only one shot was producible, because nothing about the racket was an input.
//  3. The court was one-dimensional.
//  4. The geometry rewarded standing underneath the shuttle, which is wrong. For an
//     overhead you get BEHIND the shuttle's descent and meet it in front of you, so
//     the face can come over the top of it. Standing under it means the only shot
//     available is an upward one.

export const BODY = {
  shoulderY: 1.45,
  armReach: 0.68,      // shoulder to grip
  racket:   0.66,      // grip to racket head centre
};

/** Furthest the racket head can be from the shoulder, after the ceiling remap. */
export function reachRadius(remapFactor = 1) {
  return (BODY.armReach + BODY.racket) * remapFactor;
}

export const IDEAL = {
  ahead:   0.62,       // metres in front of the player at contact
  lateral: 0.30,       // comfortably to the racket side
  height:  2.80,       // virtual contact height
};

/**
 * Can the racket reach the shuttle, and if so, how good is the contact?
 * Returns null when the shuttle is out of reach - that is a whiff, not a shot.
 */
export function evaluateContact({ player, shuttle, remapFactor = 1, hand = 'right' }) {
  const side = hand === 'left' ? -1 : 1;
  const dx = shuttle.x - player.x;
  const dz = shuttle.z - player.z;
  const ahead = -dz;                       // +ve means the shuttle is in front
  // the hitting shoulder is on the racket side, which is mirrored for a left-hander
  const shoulder = { x: player.x + side * 0.18, y: BODY.shoulderY, z: player.z };
  const dist = Math.hypot(shuttle.x - shoulder.x,
                          shuttle.y - shoulder.y,
                          shuttle.z - shoulder.z);
  const R = reachRadius(remapFactor);

  if (dist > R) {
    return { reached: false, reason: dist - R > 0.8 ? 'nowhere near it' : 'just out of reach',
             dist: +dist.toFixed(2), reach: +R.toFixed(2), ahead: +ahead.toFixed(2) };
  }
  if (shuttle.y < 0.35) {
    return { reached: false, reason: 'it had already dropped', dist: +dist.toFixed(2),
             reach: +R.toFixed(2), ahead: +ahead.toFixed(2) };
  }

  // Standing underneath removes the option of hitting down: you cannot get the face
  // over the top of a shuttle that is above your head rather than in front of it.
  const underneath = Math.max(0, 0.35 - ahead);        // 0 when properly behind it
  // reaching across the body is harder than reaching to the racket side
  const across = side * dx < 0;
  const stretched = Math.max(0, Math.abs(dx) - (across ? 0.20 : IDEAL.lateral + 0.25));
  const low        = Math.max(0, 2.45 - shuttle.y);

  return {
    reached: true,
    contactZ: shuttle.z,
    ahead: +ahead.toFixed(3),
    lateral: +dx.toFixed(3),
    height: +shuttle.y.toFixed(3),
    dist: +dist.toFixed(2),
    reach: +R.toFixed(2),
    underneath: +underneath.toFixed(3),
    stretched: +stretched.toFixed(3),
    low: +low.toFixed(3),
  };
}

/**
 * Produce a launch from the contact and the racket.
 *
 * `facePitch` degrees: negative means the face is angled downward (a smash),
 *            positive means open to the sky (a clear or a lift).
 * `faceYaw`   degrees: left or right of straight.
 * `power`     0..1 from the swing's peak angular speed.
 */
export function produceShot(c, { facePitch = -10, faceYaw = 0, power = 0.6 }) {
  // You cannot hit down through a shuttle you are standing under, however you
  // angle the racket. The geometry overrides the intent.
  const forcedUp = c.underneath * 95;
  const lowPenalty = c.low * 12;
  const pitchDeg = facePitch + forcedUp + lowPenalty;

  // Stretching for it costs racket speed.
  const quality = Math.max(0.35, 1 - c.stretched * 0.75);
  const speed = (26 + power * 48) * quality;

  const pitch = pitchDeg * Math.PI / 180;
  const yaw = (faceYaw + c.lateral * 4) * Math.PI / 180;
  return {
    p0: { x: c.lateral * 0.3, y: Math.max(0.7, c.height), z: c.contactZ ?? 5.0 },
    v0: { x: Math.sin(yaw) * speed * Math.cos(pitch),
          y: Math.sin(pitch) * speed,
          z: -Math.cos(yaw) * Math.cos(pitch) * speed },
    pitchDeg: +pitchDeg.toFixed(1), speed: +speed.toFixed(1), quality: +quality.toFixed(2),
    forcedUp: +forcedUp.toFixed(1),
  };
}

/** Name the shot the player actually produced, from what left the racket. */
export function classifyShot({ pitchDeg, speed }) {
  if (pitchDeg < -6 && speed > 52) return 'smash';
  if (pitchDeg < -6)               return 'steep push';
  if (pitchDeg < 6 && speed > 45)  return 'drive';
  if (pitchDeg < 6)                return 'flat push';
  if (speed < 34)                  return 'drop';
  return 'clear';
}
