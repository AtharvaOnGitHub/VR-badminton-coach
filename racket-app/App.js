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
// A swing is detected as a peak in angular speed, which is robust and does not
// need calibration. The frame AT the peak is what the court uses for the shot.

import React, { useEffect, useRef, useState } from 'react';
import { View, Text, TextInput, Pressable, StyleSheet, StatusBar, Vibration } from 'react-native';
import { DeviceMotion } from 'expo-sensors';
import { useKeepAwake } from 'expo-keep-awake';

const HZ = 60;
const SWING_ENTER = 9.0;    // rad/s — a deliberate swing, not a hand wobble
const SWING_LEAVE = 4.0;    // rad/s — hysteresis, so one swing is not counted twice
const MIN_GAP_MS = 350;     // refractory period between swings
const CAL_MS = 900;         // how long we average the rest pose over

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

  const ws = useRef(null);
  const inSwing = useRef(false);
  const best = useRef(null);
  const lastSwing = useRef(0);
  const sub = useRef(null);
  const calBuf = useRef(null);
  const latest = useRef(null);

  const connect = () => {
    try { ws.current?.close(); } catch {}
    setStatus('connecting');
    const sock = new WebSocket(`ws://${host}:4179`);
    ws.current = sock;
    sock.onopen = () => {
      sock.send(JSON.stringify({ hello: 'racket' }));
      if (hand) sock.send(JSON.stringify({ type: 'hand', hand }));
      if (cal) sock.send(JSON.stringify({ type: 'calibration', ref: cal }));
      setStatus('connected');
    };
    sock.onclose = () => setStatus('disconnected');
    sock.onerror = () => setStatus('error — check the host and the network');
    sock.onmessage = (e) => {
      try { const m = JSON.parse(e.data); if (m.type === 'buzz') Vibration.vibrate(m.ms || 25); } catch {}
    };
  };

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

      latest.current = r;
      if (calBuf.current) calBuf.current.push({ a: r.alpha, b: r.beta, g: r.gamma });

      const frame = {
        t: Date.now(),
        ref: cal,
        rot: { alpha: r.alpha, beta: r.beta, gamma: r.gamma },
        rate: { x: wx, y: wy, z: wz }, w,
        acc: d.acceleration || { x: 0, y: 0, z: 0 },
      };

      const sock = ws.current;
      if (sock && sock.readyState === 1) sock.send(JSON.stringify({ type: 'frame', ...frame }));

      // --- swing detection: a peak in angular speed, with hysteresis ---
      if (!inSwing.current && w > SWING_ENTER && Date.now() - lastSwing.current > MIN_GAP_MS) {
        inSwing.current = true; best.current = frame;
      } else if (inSwing.current) {
        if (w > (best.current?.w ?? 0)) best.current = frame;
        if (w < SWING_LEAVE) {
          inSwing.current = false;
          lastSwing.current = Date.now();
          const b = best.current;
          setPeak(Math.round(b.w * 10) / 10);
          setSwings((n) => n + 1);
          Vibration.vibrate(18);
          if (sock && sock.readyState === 1)
            sock.send(JSON.stringify({ type: 'swing', ...b }));
        }
      }
    });
    return () => sub.current?.remove();
  }, []);

  const startCalibration = () => {
    if (calibrating) return;
    setCalibrating(true);
    calBuf.current = [];
    Vibration.vibrate(15);
    setTimeout(() => {
      const buf = calBuf.current || [];
      calBuf.current = null;
      setCalibrating(false);
      if (buf.length < 5) return;
      const avg = (k) => buf.reduce((s, x) => s + (x[k] ?? 0), 0) / buf.length;
      const ref = { a: avg('a'), b: avg('b'), g: avg('g') };
      setCal(ref);
      Vibration.vibrate([0, 30, 60, 30]);
      const sock = ws.current;
      if (sock && sock.readyState === 1)
        sock.send(JSON.stringify({ type: 'calibration', ref }));
    }, CAL_MS);
  };

  const chooseHand = (h) => {
    setHand(h);
    const sock = ws.current;
    if (sock && sock.readyState === 1) sock.send(JSON.stringify({ type: 'hand', hand: h }));
  };

  const dot = { idle: '#888', connecting: '#e0a040', connected: '#3fd08a' }[status] || '#ff6b6b';

  return (
    <View style={s.wrap}>
      <StatusBar barStyle="light-content" />
      <Text style={s.h1}>Shadow Racket</Text>
      <Text style={s.sub}>Hold the phone like a racket handle. Swing as you would on court.</Text>

      <View style={s.row}>
        <View style={[s.dot, { backgroundColor: dot }]} />
        <Text style={s.status}>{status}</Text>
      </View>

      {/* ---- 1. which hand ---- */}
      <Text style={s.step}>1 · Which hand do you play with?</Text>
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
      <Text style={s.step}>2 · Set your rest position</Text>
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

      <Text style={s.step}>3 · Connect</Text>
      <Text style={s.label}>Laptop address</Text>
      <TextInput style={s.input} value={host} onChangeText={setHost}
        autoCapitalize="none" autoCorrect={false} keyboardType="numbers-and-punctuation"
        placeholder="10.0.0.5" placeholderTextColor="#555" />
      <Pressable style={s.btn} onPress={connect}>
        <Text style={s.btnText}>{status === 'connected' ? 'Reconnect' : 'Connect'}</Text>
      </Pressable>

      <View style={s.panel}>
        <Text style={s.big}>{swings}</Text>
        <Text style={s.cap}>swings sent</Text>
        <Text style={s.metric}>peak {peak} rad/s</Text>
        <View style={s.barTrack}>
          <View style={[s.barFill, { width: `${Math.min(100, (live.w / 20) * 100)}%` }]} />
        </View>
        <Text style={s.metric}>
          tilt  {live.b?.toFixed(2)}   roll {live.g?.toFixed(2)}   yaw {live.a?.toFixed(2)}
        </Text>
      </View>

      <Text style={s.note}>
        Orientation and swing speed come from this phone. Position does not — an IMU
        drifts past usefulness in about a second, so where you stand on court is still
        your feet.
      </Text>
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
  wrap: { flex: 1, backgroundColor: '#0e1418', padding: 22, paddingTop: 64 },
  h1: { color: '#eef3f7', fontSize: 26, fontWeight: '700' },
  sub: { color: '#8b96a2', fontSize: 13, marginTop: 4, marginBottom: 18 },
  row: { flexDirection: 'row', alignItems: 'center', marginBottom: 14 },
  dot: { width: 10, height: 10, borderRadius: 5, marginRight: 8 },
  status: { color: '#c3ccd5', fontSize: 13 },
  label: { color: '#8b96a2', fontSize: 12, marginBottom: 5, textTransform: 'uppercase',
           letterSpacing: 1 },
  input: { backgroundColor: '#18222a', color: '#eef3f7', borderRadius: 9, padding: 13,
           fontSize: 16, borderWidth: 1, borderColor: '#243039' },
  btn: { backgroundColor: '#1f6f4a', borderRadius: 9, padding: 14, alignItems: 'center',
         marginTop: 10 },
  btnText: { color: '#fff', fontWeight: '700', fontSize: 15 },
  panel: { backgroundColor: '#141d24', borderRadius: 13, padding: 20, marginTop: 24,
           alignItems: 'center' },
  big: { color: '#fff', fontSize: 56, fontWeight: '800' },
  cap: { color: '#8b96a2', fontSize: 11, letterSpacing: 1.4, textTransform: 'uppercase' },
  metric: { color: '#9fb0bf', fontSize: 13, marginTop: 12, fontVariant: ['tabular-nums'] },
  barTrack: { height: 7, backgroundColor: '#22303a', borderRadius: 4, width: '100%',
              marginTop: 12, overflow: 'hidden' },
  barFill: { height: 7, backgroundColor: '#3fd08a' },
  note: { color: '#6c7883', fontSize: 11.5, lineHeight: 17, marginTop: 18,
          marginBottom: 20 },
  step: { color: '#cfd8e2', fontSize: 13, fontWeight: '700', marginTop: 18, marginBottom: 8 },
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
  calOk: { color: '#7ff0b4', fontSize: 11, marginTop: 8, lineHeight: 15 },

  fig: { width: 96, alignItems: 'center' },
  figInner: { width: 86, height: 148 },
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
  figCap: { color: '#6c7883', fontSize: 9.5, marginTop: 2, textAlign: 'center' },
});
