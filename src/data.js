// Simulated sensing layer.
// Stands in for a Quest headset + controller. Everything here is SIMULATED;
// the real system would read 6DoF pose at the runtime's rate. See README.

const BASE = {
  peakSpeed:   { mean: 31.0, sd: 2.2 },   // m/s, racket-head proxy from controller velocity
  swingPlane:  { mean: 62.0, sd: 3.4 },   // degrees from vertical
  prepTime:    { mean: 430,  sd: 38  },   // ms, start of backswing to peak speed
  contactY:    { mean: 48,   sd: 5.0 },   // cm above head centre
};

function gauss(mean, sd, rng) {
  // Box-Muller
  const u = 1 - rng(), v = rng();
  return mean + sd * Math.sqrt(-2 * Math.log(u)) * Math.cos(2 * Math.PI * v);
}

function mulberry32(a) {
  return function () {
    a |= 0; a = (a + 0x6D2B79F5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/**
 * Generate one practice session.
 * A plane drift is injected from `driftFrom` onward so there is something real
 * to find. This mimics the fatigue pattern a coach would notice late in a session.
 */
export function generateSession({ nSwings = 60, seed = 7, driftFrom = 20, driftRate = 0.5,
                                  occludeAt = [26, 27, 41] } = {}) {
  const rng = mulberry32(seed);
  const swings = [];
  let t = 0;
  for (let i = 0; i < nSwings; i++) {
    t += 2600 + gauss(0, 400, rng);
    const drift = i >= driftFrom ? (i - driftFrom) * driftRate : 0;
    const tired = i >= driftFrom ? (i - driftFrom) * 0.12 : 0;

    const occluded = occludeAt.includes(i);
    swings.push({
      id: i,
      t: Math.round(t),
      peakSpeed:  +gauss(BASE.peakSpeed.mean - tired, BASE.peakSpeed.sd, rng).toFixed(2),
      swingPlane: +gauss(BASE.swingPlane.mean + drift, BASE.swingPlane.sd, rng).toFixed(2),
      prepTime:   Math.round(gauss(BASE.prepTime.mean - tired * 4, BASE.prepTime.sd, rng)),
      contactY:   +gauss(BASE.contactY.mean - tired * 0.5, BASE.contactY.sd, rng).toFixed(1),
      // tracking quality: controller occluded by the body at the top of the backswing
      trackingQuality: occluded ? +(0.28 + rng() * 0.12).toFixed(2) : +(0.93 + rng() * 0.07).toFixed(2),
    });
  }
  return swings;
}

export const METRICS = {
  swingPlane: { label: 'Swing plane',      unit: '°',   better: 'consistent' },
  peakSpeed:  { label: 'Peak racket speed', unit: ' m/s', better: 'higher' },
  prepTime:   { label: 'Preparation time',  unit: ' ms',  better: 'consistent' },
  contactY:   { label: 'Contact height',    unit: ' cm',  better: 'higher' },
};
