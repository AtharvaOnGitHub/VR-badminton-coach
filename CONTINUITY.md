# CONTINUITY — read this first

Written 25 Nov 2026, ~13:20. Purpose: let a fresh session resume without repeating
the mistakes this one made. Read the whole thing before touching anything.

---

## 0. The single most important thing

**Product first. Rules second.**

This session wasted hours building a system whose identity was *restraint* — it showed
nothing during practice and called that the design. Atharva rejected it, correctly:
"You have somehow convinced yourself that not doing anything is the best course of
action for a system." A restraint is a constraint on a product. It is not a product.

The error underneath it was conflating two different things:

- **Task feedback** — where the shuttle went. This *is* the task. Always on, every rep.
- **Augmented feedback** — a judgement about your technique. Only this is what the
  motor-learning retention literature warns about.

The first build suppressed both. If you ever find yourself designing silence, stop.

Second rule from the same exchange: **do not build to a requirements checklist.** The
lecture "Phase 2" slides are a menu for improving a product that already exists, not a
spec to satisfy. Make it exist, then make it better.

---

## 1. Deadlines and assignment state

| | |
|---|---|
| A1 Literature Review | **SUBMITTED.** `A1_literature_review.pdf`, 762 words |
| A2 Project Report | **DUE 25 Nov 2026, 21:00** (extended from 20 Nov) |

A2 limits: abstract ≤300, main report ≤1100, **combined ≤1300**. Combined is always the
binding constraint. Rubric: design reasoning 30, developed interaction 30, architecture
20, development evidence 20.

**The A2 report in `a2_report/` is STALE.** It describes the previous build (a flat
browser dashboard). It must be rewritten for the current one. Same for
`docs/architecture.svg` and every frame in `docs/shots/`.

---

## 2. How Atharva wants to be worked with

These were all learned the hard way. Violating them wastes a turn.

**Writing**
- **No em dashes.** Ever. He does not use them.
- **Never hedge before making the point.** Caveats go *after* the claim, not in front.
- Explain ELI5: no analogies, build jargon up from plain language, teacher-like, and
  put all hedging and exceptions AFTER the main explanation of that concept.
- Before naming any system, paper or acronym, say in one plain sentence what it is.
  He called this out specifically ("What is ViSTAR for example").

**Working**
- Be decisive. Give one recommendation, not a menu, unless the fork is genuine.
- Do not over-ask. He said explicitly: don't waste time on questions tangential to the
  submission.
- Keep responses short. He complained twice about length.
- When he gives a correction, take it fully rather than defending the old position.

**Environment**
- Python: **conda, env named `iis`**. Not venv. Call binaries by absolute path:
  `/Users/atharvawaghmare/miniconda3/envs/iis/bin/python`
  `/Users/atharvawaghmare/miniconda3/bin/conda`
- `.rtf` course files already have `.txt` twins. Use the txt, do not convert the rtf.
- LaTeX is installed but NOT on PATH: `export PATH="/Library/TeX/texbin:$PATH"`

---

## 3. The product, as agreed

**Shadow** — badminton drills at home, for the evenings you are not on court.

Atharva's framing: "taking your VR headset to a playground seems sad." This is a
*home* tool. That is why it is a drill feeder and not an opponent: an opponent makes it
"how realistically can I play badminton in my living room", which is an e-sports
question, not an e-training one.

Settled, do not re-litigate:

| Decision | Why |
|---|---|
| **Full virtual hall**, not passthrough | A shot needs somewhere to go. Passthrough is used only to fade in real furniture within 1.9 m, as a collision warning |
| **Drill feeder**, not an opponent | Keeps the stroke as the thing being trained |
| **2D movement**, at least one step per shot | "Ravi does not need help hitting stationary shots unless it is receiving smashes" |
| **Reach remap** 1.36x | A jump smash wants ~3.0 m, a 2.4 m ceiling gives 2.1 m. Shown in the HUD and adjustable, because a remap the player cannot see is the system quietly changing the task |
| **Player can freeze; system only offers** | After three misses it offers. It never takes |
| **Phone as the racket** | See section 5 |
| **Calibration to a rest pose** | Arm relaxed, phone just below the hip, held like a handle. 900 ms average. Everything is measured from the player's own rest pose |
| **Handedness asked first** | Mirrors shoulder, racket render, yaw sign, and the cost of reaching across the body. Inclusivity point from L23 |

Space requirement assumed: about two arm-spans one way, one the other, normal ceiling.

---

## 4. Repository and services

**Repo** `git@github.com:AtharvaOnGitHub/VR-badminton-coach.git`, branch `main`.
Working dir `/Users/atharvawaghmare/Sem3_UoB/IIS/vr-badminton-coach`.
HEAD at time of writing `1fff7b0`. Tag `a2-submission` exists but points at the OLD
report commit — **re-tag before submitting.**

```
src/court.js     hall, singles court, net, target zone
src/shuttle.js   quadratic-drag flight, the feeder, net-crossing test
src/contact.js   strike volume, behind-the-shuttle geometry, shot production + naming
src/remap.js     ceiling -> reach remap policy (trigger, limit, visible state, override)
src/policy.js    contracts, hysteresis, override ladder   (unchanged from build 1)
src/analysis.js  misses vs the player's own successful reps
src/racket.js    browser side of the phone link, calibration + handedness
src/sim.js       three.js scene, rep loop, cameras, furniture fade
src/app.js       UI wiring.  Exposes window.shadow = { sim, ps, observe }
src/data.js      DEAD from build 1, not imported. Delete it.
relay/server.mjs LAN WebSocket relay, phone <-> browser
racket-app/      Expo Go app (the racket)
tools/check.mjs  9 behaviour checks in a real browser
tools/shots.mjs  storyboard capture. STALE, points at the old UI
```

**Services** (`./start.sh` brings all three up):

| Port | What | Command |
|---|---|---|
| 4178 | static court | `python3 -m http.server 4178 --directory vr-badminton-coach` |
| 4179 | racket relay | `node relay/server.mjs` |
| 8081 | Expo Metro | `cd racket-app && npx expo start --lan` |

LAN IP at time of writing **10.114.198.229**. Phone opens `exp://10.114.198.229:8081`
and types `10.114.198.229` into the app.

---

## 5. The phone, and the Expo blocker (RESOLVED 25 Nov, 12:45)

**Expo Go only ever supports one SDK: the current one.** On 25 Nov 2026 that is
**SDK 58**. The app was pinned to SDK 52, six releases behind, so Expo Go refused the
bundle. Installing an old Expo Go is not available on iOS, so the only fix was to
upgrade the app.

Done, and verified by bundling (`npx expo export --platform ios`: 614 modules, clean)
and `npx expo-doctor` (20/20). Current pins:

```
expo ~58.0.26   react 19.3.0   react-native 0.88.1
expo-sensors ~58.0.5   expo-keep-awake ~58.0.4
```

Three things changed besides the version numbers:

1. **`expo/AppEntry.js` was removed after SDK 52.** There is now an explicit
   `racket-app/index.js` calling `registerRootComponent(App)`, and
   `package.json` has `"main": "index.js"`. Do not put AppEntry back.
2. **`expo-asset`, `expo-constants`, `expo-file-system`, `expo-font` are gone.** They
   were only needed to satisfy the old AppEntry path. The `expo-asset` and `expo-font`
   plugins came out of `app.json` with them.
3. **`expo-sensors` is declared as a config plugin** so iOS gets an
   `NSMotionUsageDescription` string. Expo Go has its own, so this matters only for a
   native build, but the string is also the honest disclosure that L23 asks for.

**Still unverified because it needs a real phone and a real arm:**
- Is the face-angle sign right? Does tilting forward close the face?
- Is 9 rad/s the right "deliberate swing" threshold?
- Is the 0.8 gain on face angle too twitchy or too dead?

All three are one-line changes in `racket-app/App.js` and `src/racket.js`.

**Network risk:** 10.114.x.x is university Wi-Fi, which often isolates clients so the
phone cannot reach the laptop. Fallback is the phone's hotspot with the laptop joined
to it, then re-run `./start.sh`, which re-reads the IP.

---

## 6. Calibrated numbers — do not re-guess these

Every one of these was found by sweeping, not by intuition. Changing one means
re-running `node tools/check.mjs`.

**Shuttle flight** (`src/shuttle.js`)
- Terminal velocity 6.8 m/s, so `KM = g / 6.8^2 = 0.2121`
- A shuttle leaves the racket at **45 to 70 m/s** and sheds nearly all of it.
  An early guess of 20 m/s could not reach the net. This is the single most
  counter-intuitive number in the project.
- Feeder: speed `42 ± 1`, pitch `38 ± 1` degrees, from `(0, 1.0, -5.4)`.
  Lands at z = 5.50 after 1.96 s, peaks about 5.3 m.

**Court and player** (`src/sim.js`)
- `PLAYER_Z = 5.5` — rear court, deliberately *behind* where the feed lands
- `BOUND = { x: 2.4, zMin: 4.0, zMax: 6.4 }`
- `TARGET = { x: 0, z: -4.8, w: 2.0, d: 2.8 }`
- Player resets to base at the start of every rep. Without this they drift across
  the session and no two reps start the same.

**Hitting window**: reachable from t = 1.45 s to 1.85 s, contact going from 0.86 m
in front of the player to 0.14 m. That is about 0.25 s, which is all a shuttle's
drag allows, and it is a realistic badminton timing. Do not try to widen it.

**Contact** (`src/contact.js`)
- Reach = `(0.68 arm + 0.66 racket) * remapFactor` = **1.78 m** at 1.36x
- `IDEAL = { ahead: 0.62, lateral: 0.30, height: 2.80 }`
- `underneath = max(0, 0.35 - ahead)`, and `forcedUp = underneath * 95` degrees.
  This is what makes standing under the shuttle force the shot upward.

**Remap** (`src/remap.js`): `MAX_FACTOR 1.60`, `HEAD_CLEARANCE 0.30`.
2.4 m ceiling + 2.35 m reach gives 1.36x.

**Policy** (`src/policy.js`): enter 0.60 held 2 blocks, leave 0.35 held 3 blocks.

**Phone** (`racket-app/App.js`): swing enter 9.0 rad/s, leave 4.0, refractory 350 ms,
calibration average over 900 ms, DeviceMotion at 60 Hz.

---

## 7. Pitfalls already hit. Do not hit them again.

**Tooling**

1. `pdftoppm` is not installed, so the Read tool cannot open PDFs. Extract text with
   `pypdf` in the `iis` conda env instead. PyMuPDF (`fitz`) is also installed there,
   via conda-forge — `pip install pymupdf` fails because it tries to build from source.
2. **WebFetch has no DNS in this environment.** Use WebSearch, or `curl` from Bash.
   Downloads via `curl` work fine.
3. **The Claude browser preview pane throttles `requestAnimationFrame` AND
   `setTimeout`.** rAF fired *zero* times. Anything timing-dependent cannot be tested
   there. Use Playwright (`tools/check.mjs`) in a real headless Chromium.
4. Python `str.replace()` silently does nothing when the pattern does not match, and
   line-wrapping in heredocs breaks matches constantly. **Always `assert pattern in t`**
   before replacing, or the edit vanishes and you only notice much later. This bit
   three times, including leaving a citation in a reference list but not in the body.
5. `texcount` does **not** count tabularx cell text, but the A2 spec says table text
   counts towards the limit. Count it separately. `a2_report/wc.py` does this.

**Code**

6. **three.js `setFromPoints` reuses the existing position buffer and iterates its OLD
   count**, so it throws the instant a trail gets shorter. Replace the geometry, do not
   mutate it. `setLine()` in `sim.js` does this.
7. **Never build a simulation clock from accumulated frame deltas.** The first version
   did, so physics stopped wherever rendering was throttled and every rep reported an
   identical contact. Flight time comes from `performance.now()`, and the rep state
   machine also advances on a `setInterval`.
8. A naming mismatch cost an hour: `racket.js` emits `pitchDeg`, `produceShot()` expects
   `facePitch`. Everything looked like a smash because the default was used. If shots
   stop varying, check that wiring first.
9. Expo needs `expo-asset`, `expo-constants`, `expo-file-system`, `expo-font` installed
   explicitly or Metro refuses to start with "The required package cannot be found".
10. `xcrun simctl help exited with non-zero code: 72` in the Expo log is harmless. It is
    just the iOS simulator probe. Metro still starts.

**Design**

11. The old model clamped contact height to the player's reach rather than requiring
    the shuttle to actually be reachable. That is what let a swing "hit" a shuttle
    4.95 m in the air. If a whiff ever stops working, look there.
12. Contact sensitivity of 30 degrees of launch pitch per metre of contact error moved
    the landing 25 cm for every centimetre of timing. The drill felt random. 18 is the
    calibrated value.

---

## 8. What is done, and what is left

**Done and verified (9/9 checks passing)**
- Whiff when the shuttle is out of the strike volume, with the distance stated
- Four distinct shots from racket face and swing speed
- 2D court movement with recovery to base
- Behind-the-shuttle geometry: under it forces the launch up, behind it can hit down
- Reach remap, shown and adjustable
- Freeze mid-flight with a dashed gap cue to the ideal contact point
- Policy engine, override ladder, coach surface behind approval
- Phone relay end to end, including handedness and calibration chips

**Left to do**
1. ~~Fix the Expo Go SDK mismatch~~ done. Real-phone test still pending
2. Tune face-angle sign, swing threshold, face gain against a real arm
3. **Rewrite the A2 report** for the current build. The existing one is stale
4. Rebuild `docs/architecture.svg` — it describes the old pipeline
5. Recapture `docs/shots/*` — `tools/shots.mjs` drives UI that no longer exists
6. Update README and AGENTS.md for the phone/racket architecture
8. Re-tag `a2-submission` at the final commit

**Suggested order given the deadline:** 3, 4, 5, 6 are the graded artefacts and depend
only on the code as it already stands. 1 and 2 improve the demo but the build is
submittable without a working phone, because the keyboard fallback plays and the
hardware is a labelled placeholder, which A2 explicitly permits.

---

## 9. Useful commands

```bash
# everything up; Ctrl-C stops all three cleanly
./start.sh

# free the ports if something was left holding them
./stop.sh

# behaviour checks; brings up its own static server if needed
./check.sh

# extract any course PDF to text
/Users/atharvawaghmare/miniconda3/envs/iis/bin/python -c "
from pypdf import PdfReader; r=PdfReader('FILE.pdf')
print('\n'.join(p.extract_text() or '' for p in r.pages))"

# build the report
export PATH="/Library/TeX/texbin:$PATH"
cd /Users/atharvawaghmare/Sem3_UoB/IIS/a2_report && pdflatex -interaction=nonstopmode A2_project_report.tex
/Users/atharvawaghmare/miniconda3/envs/iis/bin/python wc.py   # counts table cells too
```

---

## 10. A1, for reference

Submitted. Title: *Everyone but the learner: control of feedback in extended reality
motor training*. The gap it argued: across the three recent XR motor-training systems,
control of feedback sits with the system (Ghost Instructors), the coach (FenceXR) or a
model (ViSTAR), but never with the learner, even though learner-controlled timing is
what the retention evidence favours.

Sources are in `papers/` with verified metadata in `project/LITERATURE.md`. Three
claims were wrong in an early draft and were corrected: participants described as
novices who averaged 6.6 years of experience, a NASA-TLX subscale misread as mental
effort when it measures self-rated performance, and a retention result resting on
difference scores because the ANOVA interaction was not significant. **Verify any
literature claim against the PDF before repeating it.**

A2 must follow from that gap, but note the refinement this session made: the gap is
about *augmented* feedback. Task feedback was never the thing to withhold.
