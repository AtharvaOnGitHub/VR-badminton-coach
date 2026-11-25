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

export default function App() {
  useKeepAwake();
  const [host, setHost] = useState('10.114.198.229');
  const [status, setStatus] = useState('idle');
  const [peak, setPeak] = useState(0);
  const [swings, setSwings] = useState(0);
  const [live, setLive] = useState({ a: 0, b: 0, g: 0, w: 0 });
  const [hand, setHand] = useState(null);          // 'right' | 'left'
  const [cal, setCal] = useState(null);            // rest pose, averaged
  const [calibrating, setCalibrating] = useState(false);
  const [sens, setSens] = useState('normal');
  const [mirrorOk, setMirrorOk] = useState(false); // the court can see this racket
  const [armed, setArmed] = useState(false);       // the drill is running
  const [alert, setAlert] = useState(null);        // { title, detail }

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

  const send = (msg) => {
    const sock = ws.current;
    if (sock && sock.readyState === 1) sock.send(JSON.stringify(msg));
  };

  const connect = () => {
    tick();
    try { ws.current?.close(); } catch {}
    setStatus('connecting');
    setMirrorOk(false);
    const sock = new WebSocket(`ws://${host}:4179`);
    ws.current = sock;
    sock.onopen = () => {
      sock.send(JSON.stringify({ hello: 'racket' }));
      if (hand) sock.send(JSON.stringify({ type: 'hand', hand }));
      if (calRef.current) sock.send(JSON.stringify({ type: 'calibration', ref: calRef.current }));
      setStatus('connected');
    };
    sock.onclose = () => { setStatus('disconnected'); stopSession('The link to the court dropped.'); };
    sock.onerror = () => { setStatus('error — check the host and the network'); };
    sock.onmessage = (e) => {
      let m; try { m = JSON.parse(e.data); } catch { return; }

      // the court confirms the player can see their own racket moving on screen
      if (m.type === 'mirror-ok') { setMirrorOk(true); tick(); return; }

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

  useEffect(() => {
    DeviceMotion.setUpdateInterval(1000 / HZ);
    sub.current = DeviceMotion.addListener((d) => {
      const r = d.rotation || { alpha: 0, beta: 0, gamma: 0 };
      const rr = d.rotationRate || { alpha: 0, beta: 0, gamma: 0 };
      // expo reports rotationRate in deg/s on iOS and rad/s on Android; normalise
      const scale = Math.abs(rr.alpha) > 50 || Math.abs(rr.beta) > 50 ? Math.PI / 180 : 1;
      const wx = (rr.beta || 0) * scale, wy = (rr.gamma || 0) * scale, wz = (rr.alpha || 0) * scale;
      const w = Math.hypot(wx, wy, wz);
      setLive({ a: r.alpha, b: r.beta, g: r.gamma, w });

      if (calBuf.current) calBuf.current.push({ a: r.alpha, b: r.beta, g: r.gamma });

      const frame = {
        t: Date.now(),
        ref: calRef.current,
        rot: { alpha: r.alpha, beta: r.beta, gamma: r.gamma },
        rate: { x: wx, y: wy, z: wz }, w,
        acc: d.acceleration || { x: 0, y: 0, z: 0 },
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
            sock.send(JSON.stringify({ type: 'swing', ...b }));
        }
      }
    });
    return () => sub.current?.remove();
  }, []);

  const startCalibration = () => {
    if (calibrating) return;
    tick();
    setCalibrating(true);
    calBuf.current = [];
    setTimeout(() => {
      const buf = calBuf.current || [];
      calBuf.current = null;
      setCalibrating(false);
      if (buf.length < 5) { wrong();
        setAlert({ title: 'No motion data', detail: 'The phone sent nothing while measuring. Check that motion access is allowed.' });
        return; }
      const avg = (k) => buf.reduce((s, x) => s + (x[k] ?? 0), 0) / buf.length;
      const ref = { a: avg('a'), b: avg('b'), g: avg('g') };
      calRef.current = ref;
      setCal(ref);
      // The phone is at the player's hip and out of sight here, so this one
      // confirmation has to be felt rather than read.
      good();
      send({ type: 'calibration', ref });
    }, CAL_MS);
  };

  const chooseHand = (h) => { tick(); setHand(h); send({ type: 'hand', hand: h }); };

  const ready = !!hand && !!cal && status === 'connected' && mirrorOk;

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

        <View style={s.liveBody}>
          <Text style={s.big}>{swings}</Text>
          <Text style={s.cap}>swings this session</Text>
          <Text style={s.metric}>peak {peak} rad/s · counts above {S.enter}</Text>
          <View style={s.barTrack}>
            <View style={[s.barFill,
              { width: `${Math.min(100, (live.w / (S.enter * 1.6)) * 100)}%`,
                backgroundColor: live.w > S.enter ? '#7ff0b4' : '#3fd08a' }]} />
          </View>
          <Text style={s.liveNote}>
            Watch the court, not the phone. You will feel the strings when the shuttle
            is met. A miss is silent, and the court will tell you why.
          </Text>
        </View>

        <Pressable style={s.stopBtn} onPress={() => { tick(); stopSession(); }}>
          <Text style={s.btnText}>Stop the drill</Text>
        </Pressable>
      </View>
    );
  }

  /* ---------------- setting up ---------------- */
  const stepNum = (n, done) => (
    <View style={[s.num, done && s.numOn]}>
      <Text style={[s.numTxt, done && s.numTxtOn]}>{done ? '✓' : n}</Text>
    </View>
  );

  return (
    <ScrollView style={s.wrap} contentContainerStyle={s.scroll}>
      <StatusBar barStyle="light-content" />
      <Text style={s.h1}>Shadow Racket</Text>
      <Text style={s.sub}>Hold the phone like a racket handle. Nothing is counted until you start.</Text>

      <View style={s.row}>
        <View style={[s.dot, { backgroundColor: dot }]} />
        <Text style={s.status}>{status}</Text>
      </View>

      {alert &&
        <View style={s.alertCard}>
          <Text style={s.alertTitle}>{alert.title}</Text>
          <Text style={s.alertBody}>{alert.detail}</Text>
        </View>}

      {/* ---- 1. which hand ---- */}
      <View style={s.stepRow}>{stepNum(1, !!hand)}
        <Text style={s.step}>Which hand do you play with?</Text></View>
      <View style={s.handRow}>
        {['left', 'right'].map((h) => (
          <Pressable key={h} onPress={() => chooseHand(h)}
            style={[s.handBtn, hand === h && s.handBtnOn]}>
            <Text style={[s.handTxt, hand === h && s.handTxtOn]}>
              {h === 'left' ? 'Left' : 'Right'}
            </Text>
          </Pressable>
        ))}
      </View>

      {/* ---- 2. rest pose ---- */}
      <View style={s.stepRow}>{stepNum(2, !!cal)}
        <Text style={s.step}>Set your rest position</Text></View>
      <View style={s.calCard}>
        <PoseFigure hand={hand ?? 'right'} />
        <View style={s.calRight}>
          <Text style={s.calHead}>Hold the phone like a racket handle</Text>
          <Text style={s.calBody}>
            {hand === 'left' ? 'Left' : 'Right'} hand, gripped so the screen faces
            out to your side. Let your arm hang relaxed, so the phone sits just
            below your hip. Stand still and tap.
          </Text>
          <Pressable style={[s.calBtn, calibrating && s.calBtnBusy]}
            onPress={startCalibration} disabled={calibrating}>
            <Text style={s.btnText}>
              {calibrating ? 'Hold still…' : cal ? 'Set again' : 'Set rest position'}
            </Text>
          </Pressable>
          {cal && !calibrating &&
            <Text style={s.calOk}>Rest position set. Everything is measured from here.</Text>}
        </View>
      </View>

      {/* ---- 3. connect, then be seen ---- */}
      <View style={s.stepRow}>{stepNum(3, status === 'connected')}
        <Text style={s.step}>Connect to the court</Text></View>
      <Text style={s.label}>Laptop address</Text>
      <TextInput style={s.input} value={host} onChangeText={setHost}
        autoCapitalize="none" autoCorrect={false} keyboardType="numbers-and-punctuation"
        placeholder="10.0.0.5" placeholderTextColor="#555" />
      <Pressable style={s.btn} onPress={connect}>
        <Text style={s.btnText}>{status === 'connected' ? 'Reconnect' : 'Connect'}</Text>
      </Pressable>

      <View style={s.stepRow}>{stepNum(4, mirrorOk)}
        <Text style={s.step}>Check the court can see you</Text></View>
      <View style={s.panel}>
        <Text style={s.metric}>swing speed now</Text>
        <View style={s.barTrack}>
          <View style={[s.barFill, { width: `${Math.min(100, (live.w / 20) * 100)}%` }]} />
        </View>
        <Text style={s.metric}>
          tilt  {live.b?.toFixed(2)}   roll {live.g?.toFixed(2)}   yaw {live.a?.toFixed(2)}
        </Text>
        <Text style={mirrorOk ? s.calOk : s.panelHint}>
          {mirrorOk
            ? 'The court has you. You can start.'
            : 'Move the phone and watch the racket on the laptop. When it follows you, press "I can see my racket" there.'}
        </Text>
      </View>

      {/* ---- sensitivity ---- */}
      <View style={s.stepRow}><View style={s.numGhost} />
        <Text style={s.step}>Swing sensitivity</Text></View>
      <View style={s.handRow}>
        {Object.keys(SENS).map((k) => (
          <Pressable key={k} onPress={() => { tick(); setSens(k); }}
            style={[s.handBtn, sens === k && s.handBtnOn]}>
            <Text style={[s.handTxt, sens === k && s.handTxtOn]}>{SENS[k].label}</Text>
          </Pressable>
        ))}
      </View>
      <Text style={s.note}>
        {S.hint}. A swing counts when the phone turns faster than {S.enter} rad/s and
        holds it, which handling the phone does not do. Raise this if ordinary movement
        is being counted.
      </Text>

      {/* ---- start ---- */}
      <Pressable style={[s.startBtn, !ready && s.startBtnOff]}
        onPress={startSession} disabled={!ready}>
        <Text style={[s.startTxt, !ready && s.startTxtOff]}>
          {ready ? 'Start the drill' : 'Finish the four steps to start'}
        </Text>
      </Pressable>

      <Text style={s.note}>
        Orientation and swing speed come from this phone. Position does not — an IMU
        drifts past usefulness in about a second, so where you stand on court is still
        your feet.
      </Text>
    </ScrollView>
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
        <View style={s.phone}>
          <View style={s.phoneScreen} />
        </View>
        <View style={s.hipLine} />
      </View>
      <Text style={s.figCap}>just below the hip</Text>
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
  phone: { position: 'absolute', left: 50, top: 72, width: 13, height: 26,
           borderRadius: 3, backgroundColor: '#eef3f7', borderWidth: 1,
           borderColor: '#9fb0bf', alignItems: 'center', justifyContent: 'center' },
  phoneScreen: { width: 8, height: 19, borderRadius: 1.5, backgroundColor: '#3fd08a' },
  hipLine: { position: 'absolute', left: 20, top: 70, width: 56, height: 1,
             backgroundColor: '#3a4650' },
});
