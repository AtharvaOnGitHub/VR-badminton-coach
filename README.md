# Shadow — badminton drills at home

**README prose: about 1,310 words** (code blocks and commands not counted.)

Shadow is a home badminton drill trainer. You stand in a virtual hall, a feeder lifts a
high clear, you step and swing, and the shuttle leaves your racket on the trajectory
your actual contact produced. The outcome is always shown. The judgement about your
technique is not, until you ask for it.

Submitted for Intelligent Interactive Systems A2 at tag **`a2-submission`**.
Report: `a2_report/A2_project_report.pdf` in the course submission.

---

## Project status

**Works, and is inspectable**

- Virtual hall, singles court, net and target zone, with the player's furniture fading
  in as they approach it (a stand-in for passthrough).
- Shuttle flight under quadratic drag, fitted to a real shuttle's 6.8 m/s terminal
  velocity. A shuttle leaves the strings at 45 to 70 m/s and sheds nearly all of it.
- A strike volume. A swing at thin air is a **whiff**, reported as a distance against
  your own reach, not a silent miss.
- Contact geometry that distinguishes being **behind** the shuttle from being
  **under** it. Under it forces the launch upward; only from behind can you hit down.
- Four distinct shots (smash, drive, clear, drop) produced from racket face and swing
  speed, not chosen from a menu.
- Two-dimensional court movement with recovery to base between reps.
- Reach remapped to fit the ceiling, shown as a figure and adjustable by the player.
- A phone acting as the racket over the local network: full orientation, rest-pose
  calibration, handedness, and one haptic pattern per meaning.
- A four-step gate before any shuttle is fed, so nothing is counted before the player
  is holding the racket and ready.
- Analysis that compares a player's misses against their own successful reps, held
  behind a confidence threshold and shown only on request, with a three-step override
  the system cannot reverse.
- A coach surface behind an explicit approval.

**Simulated, and labelled as such**

- **The headset.** A browser window stands in for the display. The first-person camera
  is the player's head.
- **The controller.** A phone stands in for a tracked racket. It supplies attitude
  only; position is not recoverable from an IMU.
- **The feet.** `W A S D` stand in for physically stepping.
- **Passthrough.** Two wireframe boxes fade in as the player nears them, in place of
  real room geometry.

**Not built**

- Head and foot tracking, a real headset build, session history across days, and any
  multi-sport scope. These are marked *planned* in the report's rationale table.

---

## Technology stack

| Part | What it is | Why |
|---|---|---|
| `src/` | Vanilla ES modules, three.js r170 vendored in `vendor/` | No build step, so the court is inspectable by reading it and runs from any static server |
| `racket-app/` | Expo SDK 58, React Native 0.88, `expo-sensors`, `expo-haptics` | Runs in Expo Go with no native build; `DeviceMotion` at 60 Hz is the only sensor needed |
| `relay/` | Node + `ws` | A phone cannot reach a browser directly. The relay forwards frames and keeps nothing |
| `tools/` | Playwright | Behaviour checks and storyboard capture in a real browser |

No AI model runs inside the system. The "intelligent" behaviour is a statistical
comparison of a player's misses against their own good reps plus a hysteresis policy,
both in `src/analysis.js` and `src/policy.js`. This is deliberate and argued in the
report: the decision that mattered was *when the system may speak*, not what model
produces the sentence. No API keys are needed anywhere.

---

## Running it

```bash
git clone https://github.com/AtharvaOnGitHub/VR-badminton-coach.git
cd VR-badminton-coach
npm install
./start.sh          # court on :4178, relay on :4179, Expo on :8081; opens the court
```

The court works with no phone: press **Play without a phone** and use
`W A S D` to move, `Space` to swing, `P` to freeze, `Enter` for the next shuttle.

With a phone, scan the QR code shown on the court page with Expo Go, type the address
next to it into the app, then work through connect, hand, grip, start.

```bash
./check.sh          # 25 behaviour checks in a real browser
./check-phone.sh    # 8 checks against the phone app's own screens
./stop.sh           # free the ports
```

---

## Development record

The project was **rebuilt once and repaired four times**, each time because using it
showed something was wrong.

**Rebuild: the shuttle must fly** (`f9810ac`). The first version was a flat dashboard
that showed nothing during practice, on the reasoning that constant feedback harms
retention. That was a misreading of my own A1 literature: the evidence is about
*augmented* feedback, a judgement about technique, not *task* feedback, which is where
the shuttle went. Withholding the outcome left the user swinging at nothing. Checked by
rebuilding around a court where the shuttle flies on every rep.

**Four faults found by using it** (`96bdbf2`). A swing connected with the shuttle metres
away, because contact height was clamped to reach instead of requiring the shuttle to
be reachable. Only one shot was producible. The court had one axis. The geometry
rewarded standing under the shuttle, which is backwards. Checked by writing the first
nine behaviour tests, including one that asserts a swing at thin air is a whiff.

**Expo Go could not open the app** (`6267647`). The app pinned SDK 52; Expo Go only ever
ships the current SDK. Upgraded to 58, which also meant an explicit `index.js` because
`expo/AppEntry.js` was removed after 52. Checked with `expo export` and `expo-doctor`.

**The swing counter ran from app launch** (`f6e8f86`). Picking the phone up counted as
strokes, and each one buzzed. Added the four-step gate, raised and made the swing
threshold adjustable, and gave each haptic exactly one meaning. Checked by six new
tests asserting the court feeds nothing for 1.8 s of waiting.

**The racket moved on one axis** (`1cf05aa`). Attitude was being squeezed into two Euler
angles. Replaced with a full orientation: the phone's top edge is the shaft, the screen
normal is the strings. Checked by eight tests of the physics, including that twisting
the handle turns the face and leaves the shaft still.

**The Connect button was dead** (`3de18d5`). I had declared a component inside a
component, so React discarded the subtree on every render, and the sensor was
re-rendering at 60 Hz. Nothing could survive a press. Checked by building the app for
the web so its screens could be driven in a browser; that harness is `check-phone.sh`.

**A shuttle in front of the player read as 5.8 m away** (`c670053`). Two causes. The
camera was locked onto the shuttle, so it sat dead centre for the whole flight and
there was no way to see it approach; and the phone can only report a swing once the arm
slows, so the shuttle was sampled a few hundred milliseconds late. Added a partial head
turn and a floor shadow, and made the swing carry the age of its own peak frame.

**The racket would not go overhead** (`GIMBALFIX`). Raising the phone above the head
left the racket below it. The platform reports attitude as `ZXY` Euler angles, and that
order is degenerate when the middle angle reaches 90°; for this grip, raising the arm
drives it to exactly that point, so the angles stopped describing the phone precisely
where the overhead shots are. Replaced with a complementary filter in `racket-app/quat.js`:
the gyroscope is integrated from the moment of calibration, so the rotation is relative
to the player's own rest pose and never touches a compass or a world frame, and it is
corrected towards gravity by comparing the accelerometer direction with its own value
at rest. Comparing a measurement with its earlier self means no assumption is needed
about how the platform signs its accelerometer. The correction is weighted down when
total acceleration is far from 9.81 m/s², because during a swing the accelerometer is
measuring the swing. Checked by five tests: the racket reaches exactly vertical at 90°,
keeps going to 120° behind the head instead of flipping, climbs monotonically through
the old failure point, and 7°/s of injected gyro bias over 20 seconds drifts 137° with
the correction off and 3.7° with it on.

### Known and unfixed

Heading drift about the vertical axis is not corrected, because gravity gives no
reference for it. It is slow and a recalibration clears it, but a long session will
gradually rotate the racket's yaw. Head and foot tracking remain simulated.

---

## AI assistance

The system and this README were built with **Claude (Claude Code)** in an extended
pair-programming session. I set the direction, judged the output and rejected it
repeatedly; the record above is largely a record of those rejections.

Examples of what I changed:

- It first built a system whose identity was restraint, showing nothing during
  practice. I rejected the premise outright: *"You have somehow convinced yourself that
  not doing anything is the best course of action for a system."* The rebuild followed.
- It proposed starting from an assumed problem and searching for literature to support
  it. I stopped that and required a broad sweep first, which is what surfaced the three
  systems A1 is built on.
- I specified the phone grip, the rest-pose calibration, the handedness question, the
  four-step gate and the haptic rules. It implemented them.
- I caught the design faults listed above by using the build, not by reading the code.

How I checked it: every behavioural claim in the report is backed by a test in
`tools/check.mjs` or `tools/phone-check.mjs` that I can re-run. Literature claims were
verified against the source PDFs; three claims in an A1 draft were wrong and corrected,
and the notes are in `project/LITERATURE.md`.

---

## Additional files

Everything is in this repository. `CONTINUITY.md` is a working handover document with
the calibrated physical constants and the pitfalls hit along the way. `docs/shots/`
holds the storyboard frames used in the report, regenerable with `tools/shots.mjs`.
