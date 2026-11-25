// Reach remapping — the feature that makes a smash trainable in a living room.
//
// A jump smash puts the racket head at roughly 3.0-3.4 m. A normal ceiling is
// about 2.4 m. Without intervention the hero stroke is simply impossible indoors.
//
// LaValle's universal simulation principle says any real interaction mechanism can
// be simulated in VR, and remapping maps a real movement onto a different virtual
// one, exactly as a mouse does. Here the virtual racket reaches further than the
// one in the player's hand, so a ceiling-safe swing produces a full-height contact.
//
// Lecture 24 is the reason this is a POLICY and not just a multiplier. Bounded
// assistance needs a trigger the user can state, a limit, a visible state, and a
// manual override the system cannot undo by itself. All four are here.

export const MAX_FACTOR = 1.60;      // beyond this the motor pattern diverges too far
export const HEAD_CLEARANCE = 0.30;  // metres kept between racket and ceiling

/**
 * @param ceiling  room height in metres
 * @param reach    player's standing racket reach in metres
 * @param wanted   virtual contact height the stroke needs
 */
export function planRemap({ ceiling, reach, wanted }) {
  const safeReal = Math.min(reach, ceiling - HEAD_CLEARANCE);
  const needed = wanted / safeReal;
  const factor = Math.min(MAX_FACTOR, Math.max(1, needed));
  return {
    safeReal: +safeReal.toFixed(2),
    factor: +factor.toFixed(2),
    capped: needed > MAX_FACTOR,
    // what the stroke actually gets after capping
    achievable: +(safeReal * factor).toFixed(2),
    shortfall: +Math.max(0, wanted - safeReal * factor).toFixed(2),
    trigger: `ceiling ${ceiling} m leaves ${safeReal.toFixed(2)} m of safe reach, `
           + `and this stroke wants ${wanted} m`,
  };
}

/** Apply the remap to one contact. Returns the virtual height. */
export function applyRemap(realHeight, factor) {
  return realHeight * factor;
}

/**
 * The honest version of the state line shown in the headset. A remap the player
 * cannot see is not assistance, it is the system quietly changing the task.
 */
export function remapLabel(plan, factor) {
  if (factor <= 1.001) return 'Reach remap off — your real swing height is used.';
  const s = `Reach remap ${factor.toFixed(2)}x — a ${plan.safeReal} m swing `
          + `reaches ${(plan.safeReal * factor).toFixed(2)} m in here.`;
  return plan.capped && factor >= MAX_FACTOR
    ? s + ` Capped at ${MAX_FACTOR}x; the full stroke wants more room than this.`
    : s;
}
