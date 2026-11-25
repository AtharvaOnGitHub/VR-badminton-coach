// Shadow Racket — turns a phone into the racket.
//
// What the phone can actually sense, and what it cannot:
//   orientation      reliable (DeviceMotion.rotation)   -> racket face angle
//   rotation rate    reliable (gyroscope)               -> swing speed, swing plane
//   acceleration     reliable                           -> impact confirmation
//   POSITION         NOT USABLE. Double-integrating accelerometer drift makes a
//                    position estimate worthless in under a second, so the court
//                    position comes from the player's feet, not from this device.
//
// Nothing is counted until the player has armed the session. Four things have to be
// true first: a hand is chosen, the rest pose is set, the court has confirmed it can
// see the racket move, and the player has pressed Start. Before that the sensor still
// streams, so the court can show the player themselves, but no swing is recorded.
//
// Haptics carry exactly one meaning each:
//   impact        the shuttle met the strings. Strength is the shot's power
//   success tick  the rest pose was captured, which happens with the phone out of sight
//   error buzz    something is wrong and the drill has stopped. The court says what
// A whiff is silent. The court shows it, and a buzz for every miss would be noise.

import React, { useEffect, useRef, useState } from 'react';
import { View, Text, TextInput, Pressable, StyleSheet, StatusBar, ScrollView } from 'react-native';
import { DeviceMotion } from 'expo-sensors';
import { useKeepAwake } from 'expo-keep-awake';
import * as Haptics from 'expo-haptics';
import * as Q from './quat';

const HZ = 60;
const MIN_GAP_MS = 350;     // refractory period between swings
const MIN_HOLD_MS = 55;     // a real swing sustains its speed; a flick does not
const CAL_MS = 900;         // how long we average the rest pose over

// A badminton swing is far faster than anything the hand does while holding a phone,
// so the threshold can sit high. These are deliberately adjustable: the right number
// depends on grip and on how hard the player actually swings indoors.
const SENS = {
  light:  { enter: 11, leave: 5, label: 'Light',  hint: 'gentle shadow swings' },
  normal: { enter: 15, leave: 6, label: 'Normal', hint: 'a committed stroke' },
  firm:   { enter: 20, leave: 8, label: 'Firm',   hint: 'full-power only' },
};

const tick  = () => Haptics.selectionAsync().catch(() => {});
const good  = () => Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success).catch(() => {});
const wrong = () => Haptics.notificationAsync(Haptics.NotificationFeedbackType.Error).catch(() => {});
const hit = (power = 0.6) => {
  const style = power < 0.4 ? Haptics.ImpactFeedbackStyle.Light
              : power < 0.72 ? Haptics.ImpactFeedbackStyle.Medium
              : Haptics.ImpactFeedbackStyle.Heavy;
  Haptics.impactAsync(style).catch(() => {});
};

const STEPS = ['Connect', 'Hand', 'Grip', 'Start'];

/** The frame every setup page sits in.
 *
 *  Defined here and NOT inside App. A component declared inside another is a new
 *  function on every render, so React treats it as a different type and throws the
 *  whole subtree away each time. With the sensor re-rendering at 60 Hz that meant
 *  buttons were destroyed between finger-down and finger-up, and the address field
 *  could not hold focus. Nothing in the setup pages was pressable. */
function Chrome({ page, alert, onBack, children }) {
  return (
    <View style={s.page}>
      <StatusBar barStyle="light-content" />
      <View style={s.crumbs}>
        {STEPS.map((label, i) => (
          <View key={label} style={[s.crumb, i === page && s.crumbOn, i < page && s.crumbDone]}>
            <Text style={[s.crumbTxt, i === page && s.crumbTxtOn]}>{label}</Text>
          </View>
        ))}
      </View>
      {alert &&
        <View style={s.alertCard}>
          <Text style={s.alertTitle}>{alert.title}</Text>
          <Text style={s.alertBody}>{alert.detail}</Text>
        </View>}
      <ScrollView contentContainerStyle={s.pageBody} keyboardShouldPersistTaps="handled">
        {children}
      </ScrollView>
      {onBack &&
        <Pressable style={s.backBtn} onPress={onBack}>
          <Text style={s.backTxt}>Back</Text>
        </Pressable>}
    </View>
  );
}

export default function App() {
  try { useKeepAwake(); } catch {}   // a nicety, and not worth a blank screen
  const [host, setHost] = useState('10.114.198.229');
  const [status, setStatus] = useState('idle');
  const [peak, setPeak] = useState(0);
  const [swings, setSwings] = useState(0);
  const [live, setLive] = useState({ a: 0, b: 0, g: 0, w: 0 });
  const [hand, setHand] = useState(null);          // 'right' | 'left'
  const [cal, setCal] = useState(null);            // rest pose, averaged
  const [calibrating, setCalibrating] = useState(false);
  const [sens, setSens] = useState('normal');
  const [armed, setArmed] = useState(false);       // the drill is running
  const [alert, setAlert] = useState(null);        // { title, detail }
  const [page, setPage] = useState(0);             // 0 connect, 1 hand, 2 grip, 3 ready
  const [sensorOk, setSensorOk] = useState(true);  // false where there is no motion sensor

  const ws = useRef(null);
  const inSwing = useRef(false);
  const best = useRef(null);
  const swingStart = useRef(0);
  const lastSwing = useRef(0);
  const sub = useRef(null);
  const calBuf = useRef(null);
  const calRef = useRef(null);   // the listener mounts once, so it cannot read `cal` from state
  const armedRef = useRef(false);
  const sensRef = useRef(SENS.normal);
  const lastUi = useRef(0);
  // orientation, integrated from the gyroscope since calibration. See quat.js for
  // why this does not go through the platform's Euler angles.
  const qRef2 = useRef([1, 0, 0, 0]);
  const gRest = useRef(null);
  const lastT = useRef(0);
  const accBuf = useRef(null);

  const send = (msg) => {
    const sock = ws.current;
    if (sock && sock.readyState === 1) sock.send(JSON.stringify(msg));
  };

  const connect = () => {
    tick();
    try { ws.current?.close(); } catch {}
    setStatus('connecting');
    const sock = new WebSocket(`ws://${host}:4179`);
    ws.current = sock;
    sock.onopen = () => {
      sock.send(JSON.stringify({ hello: 'racket' }));
      if (hand) sock.send(JSON.stringify({ type: 'hand', hand }));
      if (calRef.current) sock.send(JSON.stringify({ type: 'calibration', ref: calRef.current }));
      setStatus('connected');
      setPage((p) => (p === 0 ? 1 : p));
    };
    sock.onclose = () => { setStatus('disconnected'); stopSession('The link to the court dropped.'); };
    sock.onerror = () => { setStatus('error — check the host and the network'); };
    sock.onmessage = (e) => {
      let m; try { m = JSON.parse(e.data); } catch { return; }


      // a shuttle met the strings. This is the only routine haptic
      if (m.type === 'contact') { hit(m.power ?? 0.6); return; }

      // something is wrong and the drill has stopped. The court shows the reason too
      if (m.type === 'alert') {
        setAlert({ title: m.title || 'Stopped', detail: m.detail || '' });
        setArmed(false); armedRef.current = false;
        wrong();
        return;
      }

      if (m.type === 'session') {
        setArmed(!!m.on); armedRef.current = !!m.on;
        if (m.on) { setSwings(0); setAlert(null); tick(); }
        return;
      }
    };
  };

  useEffect(() => { sensRef.current = SENS[sens]; }, [sens]);

  const onFrame = (d) => {
      const r = d.rotation || { alpha: 0, beta: 0, gamma: 0 };
      const rr = d.rotationRate || { alpha: 0, beta: 0, gamma: 0 };
      /* expo-sensors documents rotationRate in DEGREES per second, and maps the
         device axes as alpha = z, beta = y, gamma = x. Both of those were wrong
         here before: the conversion was applied only when a value happened to
         exceed 50, so slow movement was fed to the integrator as radians when it
         was degrees, 57 times too fast; and x and y were swapped. Neither showed
         while the rates were used only for a swing-speed magnitude. */
      const D2R = Math.PI / 180;
      const wx = (rr.gamma || 0) * D2R;
      const wy = (rr.beta  || 0) * D2R;
      const wz = (rr.alpha || 0) * D2R;
      const w = Math.hypot(wx, wy, wz);
      // The readout is for a human to glance at, so it is redrawn about eight times
      // a second. Re-rendering on all sixty sensor frames costs the whole tree and
      // buys nothing the eye can use. Swing detection below still sees every frame.
      const nowMs = Date.now();
      if (nowMs - lastUi.current > 120) {
        lastUi.current = nowMs;
        setLive({ a: r.alpha, b: r.beta, g: r.gamma, w });
      }

      const acc = d.accelerationIncludingGravity || null;
      const accV = acc ? [acc.x || 0, acc.y || 0, acc.z || 0] : null;

      // integrate the gyroscope, corrected towards gravity
      const tSec = d.rotationRate?.timestamp ?? (Date.now() / 1000);
      const dt = lastT.current ? Math.min(0.1, Math.max(0.002, tSec - lastT.current)) : 1 / HZ;
      lastT.current = tSec;
      qRef2.current = Q.step(qRef2.current, [wx, wy, wz], dt, accV, gRest.current);

      if (calBuf.current) {
        calBuf.current.push({ a: r.alpha, b: r.beta, g: r.gamma });
        if (accV) accBuf.current?.push(accV);
      }

      const frame = {
        t: Date.now(),
        ref: calRef.current,
        rot: { alpha: r.alpha, beta: r.beta, gamma: r.gamma },
        q: qRef2.current,
        rate: { x: wx, y: wy, z: wz }, w,
        acc: d.acceleration || { x: 0, y: 0, z: 0 },
        // gravity included, because this is what the filter corrects against and a
        // recorded take has to be replayable through the same filter
        accG: acc ? { x: acc.x, y: acc.y, z: acc.z } : null,
      };

      // Frames always stream, armed or not, because that is how the player sees
      // themselves on the court before they start.
      const sock = ws.current;
      if (sock && sock.readyState === 1) sock.send(JSON.stringify({ type: 'frame', ...frame }));

      // --- swing detection: a sustained peak in angular speed, with hysteresis ---
      if (!armedRef.current) { inSwing.current = false; return; }
      const { enter, leave } = sensRef.current;
      const now = Date.now();
      if (!inSwing.current && w > enter && now - lastSwing.current > MIN_GAP_MS) {
        inSwing.current = true; best.current = frame; swingStart.current = now;
      } else if (inSwing.current) {
        if (w > (best.current?.w ?? 0)) best.current = frame;
        if (w < leave) {
          const held = now - swingStart.current;
          inSwing.current = false;
          lastSwing.current = now;
          if (held < MIN_HOLD_MS) return;      // a flick of the wrist, not a stroke
          const b = best.current;
          setPeak(Math.round(b.w * 10) / 10);
          setSwings((n) => n + 1);
          if (sock && sock.readyState === 1)
            // the peak of the stroke happened before the arm slowed down; the
            // court needs to know how long before, or it reads the shuttle late
            sock.send(JSON.stringify({ type: 'swing', ...b, ageMs: now - b.t }));
        }
      }
  };

  /* The sensor, guarded.
   *
   * Subscribing can throw where there is no motion sensor at all, and an
   * exception here takes the whole screen down with it: that is how a working
   * Connect button turns into a blank page. If there is no sensor the app still
   * runs, says so, and the court can be driven from the keyboard instead. */
  useEffect(() => {
    let cancelled = false;
    (async () => {
      let available = true;
      try { available = await DeviceMotion.isAvailableAsync(); } catch { available = false; }
      if (cancelled) return;
      if (!available) { setSensorOk(false); return; }
      try {
        DeviceMotion.setUpdateInterval(1000 / HZ);
        sub.current = DeviceMotion.addListener(onFrame);
      } catch { setSensorOk(false); }
    })();
    return () => { cancelled = true; sub.current?.remove(); };
  }, []);

  const startCalibration = () => {
    if (calibrating) return;
    tick();
    setCalibrating(true);
    calBuf.current = [];
    accBuf.current = [];
    setTimeout(() => {
      const buf = calBuf.current || [];
      const accs = accBuf.current || [];
      calBuf.current = null; accBuf.current = null;
      setCalibrating(false);
      if (buf.length < 5) { wrong();
        setAlert({ title: 'No motion data', detail: 'The phone sent nothing while measuring. Check that motion access is allowed.' });
        return; }
      const avg = (k) => buf.reduce((s, x) => s + (x[k] ?? 0), 0) / buf.length;
      // The rest pose IS the zero: the integrated rotation restarts at identity, and
      // the gravity direction measured here is what the filter corrects back to.
      qRef2.current = [1, 0, 0, 0];
      lastT.current = 0;
      gRest.current = accs.length
        ? Q.unit(accs.reduce((s, v) => [s[0]+v[0], s[1]+v[1], s[2]+v[2]], [0, 0, 0]))
        : null;
      const ref = { a: avg('a'), b: avg('b'), g: avg('g') };
      calRef.current = ref;
      setCal(ref);
      // The phone is at the player's hip and out of sight here, so this one
      // confirmation has to be felt rather than read.
      good();
      send({ type: 'calibration', ref });
      setPage((p) => (p === 2 ? 3 : p));
    }, CAL_MS);
  };

  const chooseHand = (h) => { tick(); setHand(h); send({ type: 'hand', hand: h }); setPage(2); };

  const ready = !!hand && !!cal && status === 'connected';

  const startSession = () => {
    if (!ready) return;
    tick();
    setSwings(0); setAlert(null);
    setArmed(true); armedRef.current = true;
    send({ type: 'session', on: true });
  };

  const stopSession = (why) => {
    if (!armedRef.current) return;
    setArmed(false); armedRef.current = false;
    send({ type: 'session', on: false });
    if (why) { setAlert({ title: 'Drill stopped', detail: why }); wrong(); }
  };

  const dot = { idle: '#888', connecting: '#e0a040', connected: '#3fd08a' }[status] || '#ff6b6b';
  const S = SENS[sens];

  /* ---------------- playing ---------------- */
  if (armed) {
    return (
      <View style={s.wrap}>
        <StatusBar barStyle="light-content" />
        <View style={s.liveTop}>
          <View style={[s.dot, { backgroundColor: '#3fd08a' }]} />
          <Text style={s.status}>drill running · {hand} handed · {S.label.toLowerCase()}</Text>
        </View>

        {/* The whole screen feeds the next shuttle. The phone is in the player's
            hand at hip height and they are watching the court, so the target has
            to be the size of the phone rather than the size of a button. */}
        <Pressable style={s.liveBody} onPress={() => { tick(); send({ type: 'feed' }); }}>
          <Text style={s.big}>{swings}</Text>
          <Text style={s.cap}>swings this session</Text>
          <Text style={s.metric}>peak {peak} rad/s · counts above {S.enter}</Text>
          <View style={s.barTrack}>
            <View style={[s.barFill,
              { width: `${Math.min(100, (live.w / (S.enter * 1.6)) * 100)}%`,
                backgroundColor: live.w > S.enter ? '#7ff0b4' : '#3fd08a' }]} />
          </View>
          <Text style={s.liveNote}>
            Tap anywhere to feed the next shuttle.
          </Text>
          <Text style={s.liveNote}>
            Watch the court, not the phone. You will feel the strings when the shuttle
            is met. A miss is silent, and the court will tell you why.
          </Text>
        </Pressable>

        <Pressable style={s.stopBtn} onPress={() => { tick(); stopSession(); }}>
          <Text style={s.btnText}>Stop the drill</Text>
        </Pressable>
      </View>
    );
  }

  /* ---------------- setting up ----------------
   *
   * One thing per page, in the order the player has to do them: attach the phone,
   * say which hand, set the grip, then start. The last page is deliberately almost
   * empty, because by then the player is standing up with the phone in their hand
   * and should be looking at the court rather than reading. */
  /* ---- 1. connect ---- */
  if (page === 0) return (
    <Chrome page={page} alert={alert}>
      <Text style={s.h1}>Shadow Racket</Text>
      <Text style={s.sub}>This phone is the racket. First, point it at the court.</Text>

      <View style={s.row}>
        <View style={[s.dot, { backgroundColor: dot }]} />
        <Text style={s.status}>{status}</Text>
      </View>

      <Text style={s.label}>Laptop address</Text>
      <TextInput style={s.input} value={host} onChangeText={setHost}
        autoCapitalize="none" autoCorrect={false} keyboardType="numbers-and-punctuation"
        placeholder="10.0.0.5" placeholderTextColor="#555" />
      <Pressable style={s.btn} onPress={connect}>
        <Text style={s.btnText}>{status === 'connected' ? 'Reconnect' : 'Connect'}</Text>
      </Pressable>
      <Text style={s.note}>
        The court page shows this address next to its QR code. Everything stays on
        your own network; nothing is sent anywhere else.
      </Text>
      {!sensorOk &&
        <Text style={s.warnNote}>
          This device reports no motion sensor, so it cannot act as a racket. The
          court will still play from the keyboard.
        </Text>}
    </Chrome>
  );

  /* ---- 2. hand ---- */
  if (page === 1) return (
    <Chrome page={page} alert={alert} onBack={() => { tick(); setPage(page - 1); }}>
      <Text style={s.h1}>Which hand?</Text>
      <Text style={s.sub}>This mirrors your hitting shoulder, the racket you see on
        court, and what it costs you to reach across your body.</Text>
      <View style={s.handRow}>
        {['left', 'right'].map((h) => (
          <Pressable key={h} onPress={() => chooseHand(h)}
            style={[s.handBig, hand === h && s.handBtnOn]}>
            <Text style={[s.handTxt, hand === h && s.handTxtOn]}>
              {h === 'left' ? 'Left' : 'Right'}
            </Text>
          </Pressable>
        ))}
      </View>
    </Chrome>
  );

  /* ---- 3. grip and rest pose ---- */
  if (page === 2) return (
    <Chrome page={page} alert={alert} onBack={() => { tick(); setPage(page - 1); }}>
      <Text style={s.h1}>Your grip</Text>
      <Text style={s.sub}>Hold the phone the way the picture shows, then stand still
        and tap. Everything the court reads is measured from this one pose.</Text>

      <View style={s.calCard}>
        <PoseFigure hand={hand ?? 'right'} />
        <View style={s.calRight}>
          <Text style={s.calHead}>Along its long edge, like a handle</Text>
          <Text style={s.calBody}>
            In your {hand === 'left' ? 'left' : 'right'} hand, with the screen facing
            your leg. The <Text style={s.em}>top edge</Text> of the phone points
            straight out in front of you and the bottom edge points behind you.
            That top edge is where the racket head goes, so the phone is the handle
            and the racket grows out of the end of it.
          </Text>
          <Text style={s.calBody}>
            Let your arm hang relaxed so the phone sits just below your hip.
          </Text>
        </View>
      </View>

      <Pressable style={[s.calBtn, calibrating && s.calBtnBusy]}
        onPress={startCalibration} disabled={calibrating}>
        <Text style={s.btnText}>
          {calibrating ? 'Hold still…' : cal ? 'Set again' : 'Set my rest position'}
        </Text>
      </Pressable>
      {cal && !calibrating &&
        <Text style={s.calOk}>Rest position set.</Text>}
    </Chrome>
  );

  /* ---- 4. ready ---- */
  return (
    <View style={s.page}>
      <StatusBar barStyle="light-content" />
      <View style={s.readyBody}>
        <Pressable style={[s.goBtn, !ready && s.goBtnOff]}
          onPress={startSession} disabled={!ready}>
          <Text style={[s.goTxt, !ready && s.goTxtOff]}>Start</Text>
        </Pressable>
        <Text style={s.readyNote}>
          {ready
            ? `${hand === 'left' ? 'Left' : 'Right'} handed, rest position set. Watch the court.`
            : 'Reconnect the phone to start.'}
        </Text>
      </View>
      <View style={s.readyActs}>
        <Pressable style={s.backBtnWide} onPress={() => { tick(); setPage(0); }}>
          <Text style={s.backTxt}>Back</Text>
        </Pressable>
        {/* Recalibrating happens here, standing where you are. Sending the player
            back a page to do it means taking the phone out of the rest position
            to press Next again, which is the one thing it must not disturb. */}
        <Pressable style={[s.backBtnWide, calibrating && s.calBtnBusy]}
          onPress={startCalibration} disabled={calibrating}>
          <Text style={s.backTxt}>{calibrating ? 'Hold still…' : 'Recalibrate'}</Text>
        </Pressable>
      </View>
    </View>
  );
}

/** Side profile showing the rest pose we are asking for. Drawn with plain views so
 *  the app needs no drawing library and runs in Expo Go unmodified. */
function PoseFigure({ hand }) {
  const flip = hand === 'left' ? -1 : 1;
  return (
    <View style={s.fig}>
      <View style={[s.figInner, { transform: [{ scaleX: flip }] }]}>
        <View style={s.head} />
        <View style={s.torso} />
        <View style={s.hip} />
        <View style={s.legF} />
        <View style={s.legB} />
        <View style={s.arm} />
        {/* the phone lies along its long edge, top edge pointing forward */}
        <View style={s.phone}>
          <View style={s.phoneScreen} />
          <View style={s.phoneTop} />
        </View>
        <View style={s.fwdArrow} />
        <View style={s.hipLine} />
      </View>
      <Text style={s.figCap}>top edge points forward</Text>
    </View>
  );
}

const s = StyleSheet.create({
  wrap: { flex: 1, backgroundColor: '#0e1418' },
  scroll: { padding: 22, paddingTop: 64, paddingBottom: 48 },
  h1: { color: '#eef3f7', fontSize: 26, fontWeight: '700' },
  sub: { color: '#8b96a2', fontSize: 13, marginTop: 4, marginBottom: 18 },
  row: { flexDirection: 'row', alignItems: 'center', marginBottom: 6 },
  dot: { width: 10, height: 10, borderRadius: 5, marginRight: 8 },
  status: { color: '#c3ccd5', fontSize: 13 },
  label: { color: '#8b96a2', fontSize: 12, marginBottom: 5, textTransform: 'uppercase',
           letterSpacing: 1 },
  input: { backgroundColor: '#18222a', color: '#eef3f7', borderRadius: 9, padding: 13,
           fontSize: 16, borderWidth: 1, borderColor: '#243039' },
  btn: { backgroundColor: '#1f6f4a', borderRadius: 9, padding: 14, alignItems: 'center',
         marginTop: 10 },
  btnText: { color: '#fff', fontWeight: '700', fontSize: 15 },
  panel: { backgroundColor: '#141d24', borderRadius: 13, padding: 18 },
  panelHint: { color: '#8b96a2', fontSize: 11.5, lineHeight: 16.5, marginTop: 12 },
  big: { color: '#fff', fontSize: 84, fontWeight: '800' },
  cap: { color: '#8b96a2', fontSize: 11, letterSpacing: 1.4, textTransform: 'uppercase' },
  metric: { color: '#9fb0bf', fontSize: 13, marginTop: 12, fontVariant: ['tabular-nums'] },
  barTrack: { height: 7, backgroundColor: '#22303a', borderRadius: 4, width: '100%',
              marginTop: 12, overflow: 'hidden' },
  barFill: { height: 7, backgroundColor: '#3fd08a' },
  note: { color: '#6c7883', fontSize: 11.5, lineHeight: 17, marginTop: 14 },
  stepRow: { flexDirection: 'row', alignItems: 'center', marginTop: 22, marginBottom: 9 },
  step: { color: '#cfd8e2', fontSize: 13.5, fontWeight: '700' },
  num: { width: 21, height: 21, borderRadius: 11, backgroundColor: '#22303a',
         alignItems: 'center', justifyContent: 'center', marginRight: 9 },
  numOn: { backgroundColor: '#1f6f4a' },
  numGhost: { width: 21, marginRight: 9 },
  numTxt: { color: '#8b96a2', fontSize: 11, fontWeight: '700' },
  numTxtOn: { color: '#fff' },
  handRow: { flexDirection: 'row', gap: 10 },
  handBtn: { flex: 1, paddingVertical: 13, borderRadius: 9, backgroundColor: '#18222a',
             borderWidth: 1, borderColor: '#243039', alignItems: 'center' },
  handBtnOn: { backgroundColor: '#15392a', borderColor: '#3fd08a' },
  handTxt: { color: '#9fb0bf', fontSize: 15, fontWeight: '600' },
  handTxtOn: { color: '#7ff0b4' },
  calCard: { flexDirection: 'row', backgroundColor: '#141d24', borderRadius: 13,
             padding: 14, gap: 14 },
  calRight: { flex: 1 },
  calHead: { color: '#eef3f7', fontSize: 13.5, fontWeight: '700', marginBottom: 5 },
  calBody: { color: '#8b96a2', fontSize: 11.5, lineHeight: 16.5 },
  calBtn: { backgroundColor: '#1f6f4a', borderRadius: 8, paddingVertical: 11,
            alignItems: 'center', marginTop: 11 },
  calBtnBusy: { backgroundColor: '#2d4a3c' },
  calOk: { color: '#7ff0b4', fontSize: 11.5, marginTop: 10, lineHeight: 16 },

  startBtn: { backgroundColor: '#2f8f5f', borderRadius: 11, paddingVertical: 18,
              alignItems: 'center', marginTop: 26 },
  startBtnOff: { backgroundColor: '#17222a', borderWidth: 1, borderColor: '#243039' },
  startTxt: { color: '#fff', fontWeight: '800', fontSize: 17 },
  startTxtOff: { color: '#5f6b76', fontWeight: '600', fontSize: 14 },

  alertCard: { backgroundColor: '#2a1618', borderRadius: 11, padding: 14, marginTop: 10,
               borderWidth: 1, borderColor: '#5e2a2e' },
  alertTitle: { color: '#ff9b9b', fontSize: 14, fontWeight: '700' },
  alertBody: { color: '#c7a3a6', fontSize: 12, lineHeight: 17, marginTop: 4 },

  liveTop: { flexDirection: 'row', alignItems: 'center', paddingTop: 64, paddingHorizontal: 22 },
  liveBody: { flex: 1, alignItems: 'center', justifyContent: 'center', paddingHorizontal: 30 },
  liveNote: { color: '#6c7883', fontSize: 12, lineHeight: 18, marginTop: 26,
              textAlign: 'center' },
  stopBtn: { backgroundColor: '#3a1f22', borderRadius: 11, paddingVertical: 16,
             alignItems: 'center', marginHorizontal: 22, marginBottom: 40,
             borderWidth: 1, borderColor: '#5e2a2e' },

  fig: { width: 96, alignItems: 'center' },
  figInner: { width: 86, height: 148 },
  figCap: { color: '#6c7883', fontSize: 10, marginTop: 2 },
  head:  { position: 'absolute', left: 34, top: 2, width: 17, height: 17,
           borderRadius: 9, backgroundColor: '#5d6b78' },
  torso: { position: 'absolute', left: 41, top: 20, width: 4, height: 48,
           backgroundColor: '#5d6b78', borderRadius: 2 },
  hip:   { position: 'absolute', left: 33, top: 66, width: 20, height: 4,
           backgroundColor: '#5d6b78', borderRadius: 2 },
  legF:  { position: 'absolute', left: 36, top: 68, width: 4, height: 50,
           backgroundColor: '#48545f', borderRadius: 2,
           transform: [{ rotate: '7deg' }] },
  legB:  { position: 'absolute', left: 47, top: 68, width: 4, height: 50,
           backgroundColor: '#48545f', borderRadius: 2,
           transform: [{ rotate: '-7deg' }] },
  arm:   { position: 'absolute', left: 54, top: 24, width: 4, height: 50,
           backgroundColor: '#8a97a4', borderRadius: 2,
           transform: [{ rotate: '-9deg' }] },
  phone: { position: 'absolute', left: 44, top: 78, width: 30, height: 13,
           borderRadius: 3, backgroundColor: '#eef3f7', borderWidth: 1,
           borderColor: '#9fb0bf', flexDirection: 'row', alignItems: 'center',
           justifyContent: 'center' },
  phoneScreen: { width: 21, height: 8, borderRadius: 1.5, backgroundColor: '#3fd08a' },
  phoneTop: { position: 'absolute', right: 1, top: 1, bottom: 1, width: 3,
              borderRadius: 2, backgroundColor: '#1f6f4a' },
  fwdArrow: { position: 'absolute', left: 76, top: 82, width: 7, height: 5,
              borderTopWidth: 4, borderBottomWidth: 4, borderLeftWidth: 7,
              borderTopColor: 'transparent', borderBottomColor: 'transparent',
              borderLeftColor: '#3fd08a', borderRightWidth: 0 },
  hipLine: { position: 'absolute', left: 20, top: 74, width: 60, height: 1,
             backgroundColor: '#3a4650' },

  /* the wizard */
  page: { flex: 1, backgroundColor: '#0e1418', paddingTop: 58 },
  pageBody: { padding: 22, paddingBottom: 30 },
  crumbs: { flexDirection: 'row', gap: 6, paddingHorizontal: 22, marginBottom: 6 },
  crumb: { flex: 1, paddingVertical: 6, borderRadius: 6, backgroundColor: '#161f27',
           alignItems: 'center' },
  crumbDone: { backgroundColor: '#15392a' },
  crumbOn: { backgroundColor: '#1f6f4a' },
  crumbTxt: { color: '#6c7883', fontSize: 10.5, fontWeight: '700',
              letterSpacing: .6, textTransform: 'uppercase' },
  crumbTxtOn: { color: '#fff' },
  backBtn: { paddingVertical: 15, alignItems: 'center', marginBottom: 26 },
  backBtnWide: { flex: 1, paddingVertical: 15, alignItems: 'center', borderRadius: 10,
                 borderWidth: 1, borderColor: '#243039' },
  backTxt: { color: '#8b96a2', fontSize: 14, fontWeight: '600' },
  handBig: { flex: 1, paddingVertical: 34, borderRadius: 12, backgroundColor: '#18222a',
             borderWidth: 1, borderColor: '#243039', alignItems: 'center' },
  em: { color: '#cfd8e2', fontWeight: '700' },
  warnNote: { color: '#e0a040', fontSize: 12, lineHeight: 18, marginTop: 14 },

  /* the start page: one thing on it */
  readyBody: { flex: 1, alignItems: 'center', justifyContent: 'center', paddingHorizontal: 30 },
  goBtn: { width: 210, height: 210, borderRadius: 105, backgroundColor: '#2f8f5f',
           alignItems: 'center', justifyContent: 'center' },
  goBtnOff: { backgroundColor: '#17222a', borderWidth: 1, borderColor: '#243039' },
  goTxt: { color: '#fff', fontSize: 38, fontWeight: '800', letterSpacing: .5 },
  goTxtOff: { color: '#4d5964' },
  readyNote: { color: '#8b96a2', fontSize: 13, lineHeight: 19, marginTop: 30,
               textAlign: 'center' },
  readyActs: { flexDirection: 'row', gap: 12, paddingHorizontal: 22, marginBottom: 40 },
});
