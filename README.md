# Shadow — badminton drills at home, where the shuttle always flies

**README prose word count: ~1,150** (headings and setup commands excluded)

A home trainer for the evenings you are not on court. You stand in a full virtual
badminton hall with your own furniture fading in through passthrough as you near it.
A drill feeder lifts a high clear; you step, swing, and **the shuttle actually flies** —
on the trajectory your contact produced, clearing the net or not, landing in the target
box or past it. Every rep.

The coaching is the part that waits to be asked.

Assignment 2, Intelligent Interactive Systems, University of Birmingham.
Atharva Waghmare (AXW1008).

---

## Project status

**Implemented and working**

- The drill loop: feeder, step, swing, flight, landing, verdict.
- Shuttle flight under quadratic drag. Terminal velocity 6.8 m/s, so launch is near
  60 m/s and nearly all of it is shed — a parabola reads wrong to anyone who plays.
- **Reach remap.** A jump smash wants ~3.0 m and a 2.4 m ceiling gives 2.1 m, so the
  virtual racket reaches 1.36x further. Shown in the HUD, adjustable on the Room page,
  capped at 1.6x.
- **Freeze mid-flight** (`P`): the shuttle stops, and a dashed line shows the gap
  between where it is and where the stroke wants to meet it. The player triggers it;
  after three misses the system *offers*, and never takes it.
- The policy engine: contracts, hysteresis with hold times, three-step override ladder.
- Player review (pull-only) and a separate coach surface behind an approval gate.
- Furniture fade-in as a collision warning.

**Simulated, and labelled in the interface**

- Head and racket tracking. There is no headset; `←`/`→` step and `Space` swings, and
  the *timing* of that press sets where you meet the shuttle — the same variable the
  coaching layer reads in either case.

**Planned, not built**

- An LLM to phrase observations, sitting beside the loop. Scoped so that if it is late
  or absent, the template sentence stands.
- Progression across sessions. Mutes currently last one session.

**Known limitations**

- Thresholds are defended by argument, not by data from real players.
- No retention measurement, which is the outcome the evidence turns on.
- The swing is reduced to its timing: the system models *when* contact happened, not
  how the arm got there.

## Technology stack

| Piece | What it does | Why |
|---|---|---|
| Three.js r170, vendored | The hall, court, shuttle, racket, trajectories | Vendored into `vendor/` so the repo runs with no build step and no network |
| Vanilla ES modules | Everything else | A reviewer can read the source that actually runs |
| Playwright | `tools/check.mjs` (9 behaviour checks), `tools/shots.mjs` (report figures) | The preview pane I first tested in throttles rAF and timers; a real browser was the only way to trust a result |
| Python `http.server` | Local static server | ES modules need HTTP; `file://` will not load them |

No AI model runs in the built system. The one planned model component is marked
planned in the architecture diagram and is not on any code path.

## Running and inspecting it

```bash
cd vr-badminton-coach
python3 -m http.server 4178
# open http://localhost:4178
```

Fastest way to see it work: press **Feed a shuttle**, then **Space** about 1.5 s later.
Too early finds the net, too late sails out, and the window in between lands in the
target box. Press **P** during a flight to freeze it. Tick **Side view** to see the arc.

To regenerate the report figures:

```bash
npm install
npx playwright install chromium
node tools/shots.mjs        # writes docs/shots/*.png
node tools/check.mjs        # 9 behaviour checks against the running app
```

## Development record

**The first build was wrong, and it was wrong about what a product is.** It showed
nothing during practice and treated that restraint as the design. A restraint is a
constraint on a product, not a product — nobody practises badminton because an app is
quiet. Worse, it conflated two different things: *task* feedback (where the shuttle
went) with *augmented* feedback (a judgement about your technique). Only the second is
what the motor-learning literature warns about. The rebuild gives the shuttle back on
every rep and makes only the coaching wait to be asked.

**The flight model was wrong by a factor of three.** Early launch speeds of 20 m/s could
not reach the net, let alone the back of the court. A shuttle's terminal velocity is
about 6.8 m/s, so it leaves the racket near 60 m/s and sheds nearly all of it; the
drag-to-mass ratio, not the geometry, was what I had mis-set. Sweeping the model fixed it.

**The drill felt random before it felt hard.** At 30 degrees of launch pitch per metre
of contact error, one centimetre of timing moved the landing a quarter of a metre. A
sweep over the flight model settled on 18, which gives a 0.4 m contact window — roughly
220 ms, demanding but learnable.

**Two defects found by running it, not reading it.** `requestAnimationFrame` does not
fire in every embedded context, and the flight clock was built from accumulated frame
deltas, so physics stopped whenever rendering did and every rep reported an identical
contact point. Flight time now comes from the wall clock and the rep state machine also
advances on a timer. Separately, three.js `setFromPoints` reuses an existing position
buffer and iterates its *old* count, so it threw every time a trail got shorter; the
geometry is replaced rather than mutated.

**A design decision left deliberately awkward.** Escalating from dismissed to muted
needs the observation to come back in a *later* block. You cannot double-click your way
to it. That makes mute harder to reach, which is correct: the ladder should escalate
over time, not on an impatient second click.

## AI assistance

Claude Opus 5, via Claude Code, was used throughout: the literature search behind A1,
this codebase, the diagrams and the report drafts.

What was checked and changed rather than accepted:

- **A whole build was rejected and rewritten.** The first version was AI-designed around
  a single literature finding and ended up being about not doing things. That was my
  call to throw out, and the reasoning is in the development record above.
- **Fabrication checks on the literature.** Every A1 source was verified against the
  published paper. Three claims were wrong in the first draft: participants described
  as novices who averaged 6.6 years of experience, a NASA-TLX subscale misread as mental
  effort when it measures self-rated performance, and a retention result that rested on
  difference scores because the ANOVA interaction was not significant.
- **Generated physics was wrong and was caught by testing it.** The 20 m/s launch speed
  and the 30-degree sensitivity both came out of the model looking plausible and were
  both wrong. Sweeping the parameter space, not reading the code, is what found them.
- **An architectural suggestion was cut.** Adding an LLM to generate feedback text was
  proposed and removed; the case against it is in `AGENTS.md` rather than hidden.

## Files

- `src/` — the application. `policy.js` is the one to read.
- `docs/architecture.svg` — the system diagram.
- `docs/shots/` — the eight storyboard frames, regenerable.
- `AGENTS.md` — why this is a fixed workflow and not an agent.
