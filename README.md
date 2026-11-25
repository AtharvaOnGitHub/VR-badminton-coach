# Shadow — badminton shadow practice that waits to be asked

**README prose word count: ~720** (setup commands and code excluded)

An XR practice tool for badminton shadow swings in which **the player decides when
the system speaks**. It shows nothing while you swing. It will offer one line at the
end of a block. Everything else, you pull.

Built for Assignment 2, Intelligent Interactive Systems, University of Birmingham.
Atharva Waghmare (AXW1008).

---

## Project status

**Implemented and working**

- The policy engine (`src/policy.js`) — interaction contracts, hysteresis with hold
  times, and the three-step override ladder. This is the contribution.
- Four surfaces: Practice, Review, Coach, Trace.
- Evidence binding — every observation names the swings it came from and draws them
  on the session trace.
- The tracking-quality gate: swings with a stale pose are dropped, never guessed at,
  and are visibly excluded from every number.
- The decision trace, built from the engine's own return values.

**Simulated, and labelled as such in the interface**

- Sensing. There is no headset. `src/data.js` generates a 60-swing session with a
  swing-plane drift injected from swing 20 and three occluded swings. A1 scoped the
  project to *when* an analysis appears rather than whether it is accurate, so the
  sensing being simulated does not weaken the claim being tested.
- The analysis. Descriptive statistics against the player's own first twelve swings.
  Deliberately simple, for the same reason.

**Planned, not built**

- An LLM that turns a scored observation into a sentence, sitting beside the loop
  rather than inside it. Scoped so that if it is late or never returns, the template
  sentence stands and shows its age.
- Longitudinal state. Mutes last one session; nothing is remembered across sessions.
- The pain-mapping feature from the original concept. It needs pain reports across
  many sessions, which this build has no way to collect.

**Known limitations**

- Hysteresis is tuned against one generated fixture. The thresholds are defended by
  argument, not by data from real players.
- There is no retention measurement. That is the outcome the underlying evidence
  turns on, and it cannot be established inside the module.
- The coach surface has one coach and no identity model.

## Technology stack

| Piece | What it does | Why |
|---|---|---|
| Vanilla ES modules, no framework | The whole application | No build step, so a reviewer can read the source that actually runs |
| SVG, inline | Session sparklines | The evidence has to be visible next to the claim |
| Playwright | `tools/shots.mjs` captures the report figures | Figures are regenerated from the running app, so they cannot drift from the code |
| Python `http.server` | Local static server | ES modules need HTTP; `file://` will not load them |

No AI model runs in the built system. The one planned model component is marked
planned in the architecture diagram and is not on any code path.

## Running and inspecting it

```bash
cd vr-badminton-coach
python3 -m http.server 4178
# open http://localhost:4178
```

Fastest way to see the argument: press **Play the rest of this block** five times,
watch that nothing appears until the fifth, then open **Review**.

To regenerate the report figures:

```bash
npm install
npx playwright install chromium
node tools/shots.mjs        # writes docs/shots/*.png
```

## Development record

**The policy came first, the interface second.** The engine was written and tested
headlessly before any screen existed, because the project's claim is about the policy
and not about the visuals.

**The fixture was too short, and that looked like a policy bug.** On a 40-swing
session the raise rule never fired. The first instinct was that the hysteresis was
wrong. Printing the per-block confidence trajectory showed the policy was correct and
the session was too short to ever produce two consecutive blocks above threshold.
Lengthened to 60 swings. The trajectory now reads 0.04 → 0.05 → 0.49 → 1.0 → 1.0,
which puts a full-confidence block at `arming` and silent, and only raises on the
block after. That is the anti-flicker rule doing visible work, and it is the single
clearest demonstration in the build.

**Three defects were found by driving the interface, not by reading it.** The review
window was the whole session, so recent drift averaged away and the evidence line read
"from swings 1, 2, 3 … 50", which tells a player nothing they can act on; it now reviews
the most recent block and reads "10.8° higher, swings 41–50". The sparkline plotted
swings that had not been played yet. The level-two override message was written into
the observations container and then destroyed by the re-render on the next line, so
muting silently said nothing — it is now held in state across the render.

**One behaviour was left deliberately awkward.** Escalating from dismissed to muted
requires the observation to return in a *later* block. It cannot be done by clicking
twice. That makes the mute harder to reach, and it is correct: the ladder is meant to
escalate over time rather than on a double-click.

## AI assistance

Claude Opus 5, via Claude Code, was used throughout: for the literature search behind
A1, for writing this codebase, and for drafting the report.

What was checked and changed rather than accepted:

- **Fabrication checks on the literature.** Every source behind A1 was verified
  against the published paper. Three claims were wrong in the first draft and were
  corrected: a study's participants were described as novices when they averaged 6.6
  years of experience; a NASA-TLX subscale was misread as mental effort when it
  measures self-rated performance; and a retention result rested on difference scores
  because the ANOVA interaction was not significant, which the draft had not said.
- **An architectural suggestion was rejected.** Adding an LLM to generate feedback
  text was proposed and cut from the build. The case against it is written up in
  `AGENTS.md` rather than hidden.
- **Generated code was tested, not trusted.** The three interface defects above were
  all in AI-written code and were found by running it.

## Files

- `src/` — the application. `policy.js` is the one to read.
- `docs/architecture.svg` — the system diagram.
- `docs/shots/` — the eight storyboard frames, regenerable.
- `AGENTS.md` — why this is a fixed workflow and not an agent.
