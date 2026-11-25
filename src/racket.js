// The phone, as a racket.
//
// Connects to the relay and exposes the live racket state plus a swing event.
// What arrives is orientation and angular velocity. What does NOT arrive is
// position: integrating accelerometer drift makes a position estimate useless
// within about a second, so the racket's place in the world is derived from the
// player's court position, and only its ATTITUDE comes from the phone.

const SWING_FULL = 16;     // rad/s treated as a full-power swing

export function createRacket({ onSwing, onStatus, onHand, onCalibrated,
                               onSession } = {}) {
  let ws = null;
  let online = false;
  let ref = null;                 // the player's rest pose, from calibration
  let hand = 'right';
  const state = { pitchDeg: -10, yawDeg: 0, rollDeg: 0, w: 0, lastFrame: 0 };

  /** Phone attitude -> racket face angles, measured FROM THE PLAYER'S REST POSE.
   *
   *  An IMU has no idea where the court is, and every player grips a handle
   *  slightly differently. Calibration fixes both cheaply: the player stands with
   *  the arm relaxed and the phone just below the hip, and that attitude becomes
   *  zero. Everything after is measured as a deviation from their own rest pose
   *  rather than from an absolute frame the phone cannot know.
   *
   *  Without calibration the readings still work, but they are relative to
   *  however the phone happened to be held when the page loaded. */
  const DEG = 180 / Math.PI;
  const fromRotation = (rot) => {
    const beta  = (rot.beta  ?? 0) - (ref?.b ?? 0);
    const gamma = (rot.gamma ?? 0) - (ref?.g ?? 0);
    let alpha   = (rot.alpha ?? 0) - (ref?.a ?? 0);
    // heading wraps; keep it in [-pi, pi]
    while (alpha >  Math.PI) alpha -= 2 * Math.PI;
    while (alpha < -Math.PI) alpha += 2 * Math.PI;
    const mirror = hand === 'left' ? -1 : 1;
    // With a rest pose calibrated, zero deviation means a flat face. Tilting the
    // racket head forward closes it (negative, a smash); tilting back opens it
    // (positive, a clear). The 0.8 gain is a first guess and wants tuning against
    // a real phone in a real swing.
    return {
      pitchDeg: Math.max(-40, Math.min(55, -(beta * DEG) * 0.8)),
      yawDeg:   Math.max(-35, Math.min(35, alpha * DEG * 0.35 * mirror)),
      rollDeg:  gamma * DEG * mirror,
    };
  };

  const connect = (host = location.hostname, port = 4179) => {
    try { ws?.close(); } catch {}
    onStatus?.('connecting');
    ws = new WebSocket(`ws://${host}:${port}`);
    ws.onopen = () => { ws.send(JSON.stringify({ hello: 'court' })); onStatus?.('waiting'); };
    ws.onclose = () => { online = false; onStatus?.('offline'); };
    ws.onerror = () => { online = false; onStatus?.('error'); };
    ws.onmessage = (e) => {
      let m; try { m = JSON.parse(e.data); } catch { return; }
      if (m.type === 'racket-online')  { online = true;  onStatus?.('racket connected'); return; }
      if (m.type === 'hand')        { hand = m.hand === 'left' ? 'left' : 'right';
                                      onHand?.(hand); return; }
      if (m.type === 'calibration') { ref = m.ref || null; onCalibrated?.(!!ref); return; }
      if (m.type === 'racket-offline') { online = false; onStatus?.('waiting'); return; }
      // the player can start or stop the drill from the phone as well as from here
      if (m.type === 'session')     { onSession?.(!!m.on, 'phone'); return; }
      if (m.type === 'frame' || m.type === 'swing') {
        if (m.ref && !ref) ref = m.ref;          // phone re-sends its reference
        Object.assign(state, fromRotation(m.rot || {}),
                      { w: m.w ?? 0, lastFrame: performance.now() });
        online = true;
      }
      if (m.type === 'swing') {
        onSwing?.({
          pitchDeg: state.pitchDeg, yawDeg: state.yawDeg,
          power: Math.max(0.15, Math.min(1, (m.w ?? 0) / SWING_FULL)),
          w: m.w ?? 0, source: 'phone',
        });
      }
    };
  };

  const tell = (msg) => { if (ws?.readyState === 1) ws.send(JSON.stringify(msg)); };

  /* ---- what the court sends back to the phone ----
   *
   * Each of these is a different haptic on the phone, and each one has exactly one
   * meaning. `contact` is the only routine one: the shuttle met the strings, and the
   * strength of the tap is the power of the shot. A whiff sends nothing, because a
   * buzz on every miss is noise and the court already shows the miss. `alert` is the
   * harsh one, reserved for the drill stopping, and it never travels alone: the court
   * shows the same words at the same moment. */
  const contact = (power = 0.6, kind = '') => tell({ type: 'contact', power, kind });
  const alertPhone = (title, detail) => tell({ type: 'alert', title, detail });
  const confirmMirror = () => tell({ type: 'mirror-ok' });
  const setSession = (on) => tell({ type: 'session', on });

  return {
    connect, contact, alertPhone, confirmMirror, setSession,
    get online() { return online && performance.now() - state.lastFrame < 2000; },
    get state() { return state; },
    get hand() { return hand; },
    get calibrated() { return !!ref; },
    setHand(h) { hand = h === 'left' ? 'left' : 'right'; },
    /** Used when no phone is connected, so the court is still playable. */
    fallbackSwing: () => ({ pitchDeg: -12, yawDeg: 0, power: 0.75, w: 0, source: 'keyboard' }),
  };
}
