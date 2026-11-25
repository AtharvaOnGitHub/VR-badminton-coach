// What separates the reps that landed from the reps that did not.
//
// Deliberately simple and transparent. The project's question is when this is
// delivered and who may refuse it, not whether it is a clever model. It compares
// the player against themselves - the reps that worked - and never against an
// expert recording, which is the normative assumption A1 argued against.

const LABEL = {
  ahead:   { name: 'Contact point',  unit: ' m', say: (d) => d < 0
               ? `you met the shuttle ${Math.abs(d).toFixed(2)} m further back`
               : `you met the shuttle ${d.toFixed(2)} m further in front` },
  vHeight: { name: 'Contact height', unit: ' m', say: (d) => d < 0
               ? `you hit it ${Math.abs(d).toFixed(2)} m lower`
               : `you hit it ${d.toFixed(2)} m higher` },
  lateral: { name: 'Stepping across', unit: ' m', say: (d) =>
               `the shuttle was ${Math.abs(d).toFixed(2)} m further to your side` },
};

const mean = xs => xs.reduce((a, b) => a + b, 0) / xs.length;
const sd = xs => { const m = mean(xs); return Math.sqrt(mean(xs.map(x => (x - m) ** 2))); };

/**
 * Compare the misses in a window against the reps that landed in the target.
 * Returns one observation per variable, strongest first.
 */
export function observe(reps, windowIds) {
  const win = reps.filter(r => windowIds.includes(r.id) && r.swung);
  const good = reps.filter(r => r.swung && r.outcome === 'in');
  const bad = win.filter(r => r.outcome !== 'in');
  const missed = reps.filter(r => windowIds.includes(r.id) && !r.swung).length;
  if (bad.length < 2 || good.length < 2) {
    return { observations: [], bad: bad.length, good: good.length, missed };
  }

  const out = [];
  for (const key of ['ahead', 'vHeight', 'lateral']) {
    const g = good.map(r => r[key]), b = bad.map(r => r[key]);
    const spread = sd(g) || 0.01;
    const delta = mean(b) - mean(g);
    const z = delta / spread;
    if (!isFinite(z)) continue;
    out.push({
      key, delta: +delta.toFixed(3), z: +z.toFixed(2),
      confidence: +Math.min(1, Math.abs(z) / 2.5).toFixed(2),
      evidence: bad.map(r => r.id),
      against: good.map(r => r.id),
      label: LABEL[key].name,
      sentence: `On the reps that missed, ${LABEL[key].say(delta)} than on the `
              + `${good.length} that landed in the target.`,
    });
  }
  out.sort((a, b2) => b2.confidence - a.confidence);
  return { observations: out, bad: bad.length, good: good.length, missed };
}
