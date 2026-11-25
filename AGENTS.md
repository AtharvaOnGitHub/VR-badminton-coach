# AGENTS.md

## There is no agent here, and that is the design decision

Week 5 distinguishes a **workflow**, where code fixes the order of steps, from an
**agent**, where a model chooses the path at run time. Shadow is a workflow. The
order is fixed in code and never chosen by a model:

```
feed → contact extracted (how far in front of the head) → shuttle flight integrated
   → landing and verdict shown IMMEDIATELY, every rep, gated by nothing
                                   │
   block boundary ────────────────▶ misses compared against the player's own
                                    reps that landed → confidence scored
                                    → policy state machine (hysteresis)
                                    → offer one line / stay quiet
                                   │
   player asks, at any time ──────▶ review (never gated by the policy)
```

The two paths are deliberately separate. The task path never waits for anything; only
the coaching path is subject to the policy.

### The case against this choice

An agent would let the system decide *what kind* of thing to look at, rather than
scoring four fixed metrics. It could notice something the four metrics miss, and
could phrase feedback in response to what the player asked rather than from a
template.

That is a real loss, and it is accepted for three reasons.

1. **The path is known in advance.** Lecture 13's rule is to climb only as far as the
   problem forces you. Every step here can be written down, so there is nothing for a
   model to decide.
2. **Predictability is the product.** Lecture 24 argues assistance harms skill when it
   is inconsistent, and that a slightly worse rule applied always beats a cleverer rule
   applied sometimes. A player who cannot predict when the system speaks cannot build a
   model of it, and switches it off.
3. **Accountability.** Every observation must name the swings it came from. A fixed
   pipeline can guarantee that. A generated one would have to be checked for it.

### If a model were added

The place for it is phrasing, not deciding: turning a scored observation into a
sentence. It would sit **beside** the loop, not inside it (Lecture 21), writing
timestamped proposals the interface reads when they arrive and never waits for. The
contract would stay `advise`, and the evidence line would still be built from return
values rather than from the model's own summary.

## Stop conditions

The loop is bounded by the session. It stops when the block ends. It produces no
output at all unless the hysteresis rule fires, so silence is a defined state and
not a failure.

## Trace

`src/policy.js` writes every state transition, suppression and override to
`ps.log`, surfaced in the Trace tab. It records what the policy actually did, not a
summary of it.
