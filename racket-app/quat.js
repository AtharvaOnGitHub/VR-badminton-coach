// Minimal quaternion maths, [w, x, y, z]. No library, because the phone app needs
// four operations and nothing else.

export const mul = (a, b) => [
  a[0]*b[0] - a[1]*b[1] - a[2]*b[2] - a[3]*b[3],
  a[0]*b[1] + a[1]*b[0] + a[2]*b[3] - a[3]*b[2],
  a[0]*b[2] - a[1]*b[3] + a[2]*b[0] + a[3]*b[1],
  a[0]*b[3] + a[1]*b[2] - a[2]*b[1] + a[3]*b[0],
];

export const normalise = (q) => {
  const n = Math.hypot(q[0], q[1], q[2], q[3]) || 1;
  return [q[0]/n, q[1]/n, q[2]/n, q[3]/n];
};

/** Rotation of `angle` radians about `axis`, which need not be a unit vector. */
export const fromAxisAngle = ([x, y, z], angle) => {
  const n = Math.hypot(x, y, z);
  if (n < 1e-9 || !angle) return [1, 0, 0, 0];
  const h = angle / 2, s = Math.sin(h) / n;
  return [Math.cos(h), x*s, y*s, z*s];
};

/** Rotate a vector by a quaternion. */
export const rotate = (q, [x, y, z]) => {
  const [w, a, b, c] = q;
  const tx = 2*(b*z - c*y), ty = 2*(c*x - a*z), tz = 2*(a*y - b*x);
  return [x + w*tx + b*tz - c*ty,
          y + w*ty + c*tx - a*tz,
          z + w*tz + a*ty - b*tx];
};

export const cross = (a, b) => [a[1]*b[2]-a[2]*b[1], a[2]*b[0]-a[0]*b[2], a[0]*b[1]-a[1]*b[0]];

export const unit = (v) => {
  const n = Math.hypot(v[0], v[1], v[2]) || 1;
  return [v[0]/n, v[1]/n, v[2]/n];
};

/**
 * Complementary filter, run entirely in the player's own rest frame.
 *
 * WHY NOT EULER ANGLES. The platform reports attitude as alpha, beta, gamma in
 * the ZXY order. That order is degenerate when the middle angle reaches ninety
 * degrees, and for the grip this app asks for, phone on its long edge with the
 * top edge pointing forward, raising the arm overhead drives it to exactly that
 * point. The reported angles become unusable precisely where the overhead shots
 * are. This is why the racket would not go above the player's head.
 *
 * WHAT THIS DOES INSTEAD. The gyroscope is integrated from the moment of
 * calibration, so `q` is the rotation away from the rest pose and never touches a
 * world frame or a compass. Integration alone drifts, so it is corrected towards
 * gravity: the accelerometer's direction, carried back into the rest frame, should
 * still be the direction it had at rest. The correction compares a measurement with
 * its own earlier value, so no assumption is needed about which way the platform
 * signs its accelerometer.
 *
 * The correction is weighted down when the total acceleration is not close to
 * gravity, because during a swing the accelerometer is measuring the swing.
 *
 * @param q     current rotation, device frame -> rest frame
 * @param omega angular velocity in the device frame, rad/s
 * @param acc   acceleration including gravity, device frame, m/s^2, or null
 * @param gRest the same vector averaged at calibration, normalised, or null
 */
export function step(q, omega, dt, acc, gRest, gain = 0.03) {
  const w = Math.hypot(omega[0], omega[1], omega[2]);
  let out = w > 1e-6 ? mul(q, fromAxisAngle(omega, w * dt)) : q;

  if (acc && gRest) {
    const mag = Math.hypot(acc[0], acc[1], acc[2]);
    const trust = Math.max(0, 1 - Math.abs(mag - 9.81) / 4);
    if (trust > 0 && mag > 1e-3) {
      const seen = rotate(out, unit(acc));          // carried into the rest frame
      const err = cross(seen, gRest);               // small-angle rotation to close it
      const ang = Math.min(0.35, Math.hypot(err[0], err[1], err[2]));
      if (ang > 1e-5) out = mul(fromAxisAngle(err, ang * gain * trust * 60 * dt), out);
    }
  }
  return normalise(out);
}
