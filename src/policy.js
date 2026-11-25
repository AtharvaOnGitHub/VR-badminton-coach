// POLICY ENGINE - the implemented contribution of this project.
//
// The literature review behind this project found that in XR motor-training
// systems, control over feedback delivery sits with the system, the coach, or a
// model, but never with the learner. This module puts it with the learner.
//
// Three mechanisms:
//   1. CONTRACTS   - every action the system can take has a stated contract.
//   2. HYSTERESIS  - an observation needs sustained evidence to be raised and
//                    sustained absence to be dropped, so it cannot flicker.
//   3. OVERRIDE    - a ladder, not a switch. Escalates, and never self-reverses.

export const CONTRACTS = {
  ADVISE:            'advise',
  ASSIST:            'assist',
  APPROVE:           'execute with approval',
  REPORT:            'execute and report',
  ESCALATE:          'autonomous with escalation',
};

// One contract per ACTION, not per system. Chosen by stakes, reversibility, volume.
export const ACTION_CONTRACTS = [
  { action: 'Record a swing',
    contract: CONTRACTS.REPORT,
    why: 'High volume and fully reversible. Per-swing approval would collapse into reflex clicking. The session counter is the report; deleting the session is the undo.' },
  { action: 'Compute an observation',
    contract: CONTRACTS.ESCALATE,
    why: 'Runs continuously and shows nothing. Escalates only when the raise rule fires, so silence genuinely means nothing crossed the threshold.' },
  { action: 'Show observations on request',
    contract: CONTRACTS.ADVISE,
    why: 'The player pulled it. The system supplies information and the player decides what to do, so the decision never leaves them.' },
  { action: 'Offer an unprompted nudge',
    contract: CONTRACTS.ADVISE,
    why: 'Offered only at a block boundary, never mid-swing. It is a sentence on a surface the player can ignore, with no action attached.' },
  { action: 'Share the session with a coach',
    contract: CONTRACTS.APPROVE,
    why: 'The only action with a consequence outside the headset and the only one that is not freely undoable, so it needs a deliberate act.' },
];

// --- Thresholds -------------------------------------------------------------
// Deliberately asymmetric. Hard to raise: an observation the player did not ask
// about must earn its interruption. Harder to drop: an observation that appears
// and vanishes between blocks makes the system unmodellable, and a player who
// cannot model it switches it off.
export const THRESHOLDS = {
  enter:      0.60,   // confidence required to raise
  enterHold:  2,      // consecutive blocks at or above `enter`
  leave:      0.35,   // confidence below which it starts to release
  leaveHold:  3,      // consecutive blocks at or below `leave`
};

export const STATES = ['dormant', 'arming', 'active', 'releasing', 'muted'];

export function newPolicyState() {
  return {
    perKey: {},             // key -> { state, armCount, releaseCount, dismissals }
    globalMuted: false,     // player said "don't propose, I'll ask"
    log: [],
  };
}

function keyState(ps, key) {
  if (!ps.perKey[key]) {
    ps.perKey[key] = { state: 'dormant', armCount: 0, releaseCount: 0, dismissals: 0 };
  }
  return ps.perKey[key];
}

function log(ps, entry) {
  ps.log.push({ at: new Date().toISOString(), ...entry });
}

/**
 * Advance the state machine for one block of observations.
 * Returns the keys the system would RAISE unprompted (subject to contracts).
 * Observations the player pulls are never gated by this - pulling is `advise`.
 */
export function step(ps, observations, blockIndex) {
  const raised = [];
  for (const obs of observations) {
    const ks = keyState(ps, obs.key);
    if (ks.state === 'muted') continue;

    const prev = ks.state;
    if (obs.confidence >= THRESHOLDS.enter) {
      ks.armCount += 1;
      ks.releaseCount = 0;
      if (ks.state === 'dormant') ks.state = 'arming';
      if (ks.armCount >= THRESHOLDS.enterHold) ks.state = 'active';
    } else if (obs.confidence <= THRESHOLDS.leave) {
      ks.releaseCount += 1;
      ks.armCount = 0;
      if (ks.state === 'active') ks.state = 'releasing';
      if (ks.releaseCount >= THRESHOLDS.leaveHold) ks.state = 'dormant';
    } else {
      // middle band: hold position, change nothing. This is the third option
      // between acting and doing nothing.
      ks.armCount = 0;
      ks.releaseCount = 0;
    }

    if (prev !== ks.state) {
      log(ps, { event: 'state', key: obs.key, from: prev, to: ks.state,
                confidence: obs.confidence, block: blockIndex });
    }
    if (ks.state === 'active') raised.push(obs);
  }

  if (ps.globalMuted && raised.length) {
    log(ps, { event: 'suppressed', reason: 'global override', count: raised.length, block: blockIndex });
    return [];
  }
  return raised;
}

/**
 * The override ladder. Escalates with repetition and never reverses itself.
 *   1st dismissal - accepted silently, not shown again this block
 *   2nd dismissal - muted for the session, and the system says so
 *   global        - the player turns off all unprompted proposals
 * Confidence rising again NEVER re-enables a muted observation.
 */
export function dismiss(ps, key) {
  const ks = keyState(ps, key);
  ks.dismissals += 1;
  if (ks.dismissals === 1) {
    ks.state = 'dormant';
    ks.armCount = 0;
    log(ps, { event: 'override', key, level: 1, effect: 'dismissed for this block, silently' });
    return { level: 1, message: null };
  }
  ks.state = 'muted';
  log(ps, { event: 'override', key, level: 2, effect: 'muted for the session' });
  return {
    level: 2,
    message: 'Muted for this session. You dismissed this twice, so it will not come back on its own.',
  };
}

export function unmute(ps, key) {
  const ks = keyState(ps, key);
  ks.state = 'dormant';
  ks.dismissals = 0;
  log(ps, { event: 'override', key, level: 0, effect: 'un-muted by the player' });
}

export function setGlobalMute(ps, on) {
  ps.globalMuted = on;
  log(ps, { event: 'global-override', on });
}
