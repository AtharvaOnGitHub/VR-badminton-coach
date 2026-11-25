// Analysis layer. Deliberately simple and SIMULATED.
//
// Scope note: this project is about *who controls when an analysis is delivered*,
// not about whether the analysis is accurate. The analysis is therefore kept to
// transparent descriptive statistics against the player's own early-session
// baseline. It never compares the player to an expert model, because a single
// expert reference is the normative assumption the project argues against.

const BASELINE_N = 12;   // first N swings define the player's own baseline

function mean(xs) { return xs.reduce((a, b) => a + b, 0) / xs.length; }
function sd(xs) {
  const m = mean(xs);
  return Math.sqrt(mean(xs.map(x => (x - m) ** 2)));
}

export function baselineOf(swings, key) {
  const usable = swings.filter(s => s.trackingQuality > 0.6).slice(0, BASELINE_N);
  const xs = usable.map(s => s[key]);
  return { mean: mean(xs), sd: sd(xs), n: xs.length };
}

/**
 * Produce candidate observations for a window of swings.
 * Each observation carries its own evidence: the swing ids it came from.
 * Confidence is |z| against the player's own baseline, squashed to 0..1.
 */
export function observe(swings, windowIds) {
  const window = swings.filter(s => windowIds.includes(s.id));
  const usable = window.filter(s => s.trackingQuality > 0.6);
  const dropped = window.length - usable.length;
  if (usable.length < 3) return { observations: [], dropped, usable: usable.length };

  const out = [];
  for (const key of ['swingPlane', 'prepTime', 'contactY', 'peakSpeed']) {
    const base = baselineOf(swings, key);
    if (base.sd === 0) continue;
    const now = mean(usable.map(s => s[key]));
    const z = (now - base.mean) / base.sd;
    const confidence = Math.min(1, Math.abs(z) / 3);
    out.push({
      key,
      z: +z.toFixed(2),
      delta: +(now - base.mean).toFixed(1),
      confidence: +confidence.toFixed(2),
      evidence: usable.map(s => s.id),
      baseline: { mean: +base.mean.toFixed(1), n: base.n },
      current: +now.toFixed(1),
    });
  }
  out.sort((a, b) => b.confidence - a.confidence);
  return { observations: out, dropped, usable: usable.length };
}
