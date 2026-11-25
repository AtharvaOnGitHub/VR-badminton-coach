// Relay between the phone (racket) and the browser (court).
//
// The phone cannot talk to the page directly, so this sits between them. It is
// deliberately dumb: it forwards racket frames and keeps nothing. Running it is
// one command and it prints the URL to type into the phone.
import { WebSocketServer } from 'ws';
import { networkInterfaces } from 'os';
import { createWriteStream, mkdirSync, writeFileSync, appendFileSync } from 'fs';
import { join } from 'path';

const PORT = Number(process.env.PORT || 4179);
const wss = new WebSocketServer({ port: PORT });

const rackets = new Set();   // phones
const courts = new Set();    // browsers

/* ---------- recording ----------
 *
 * The relay sees every frame the phone sends, and it is the only part of the
 * system with a filesystem, so takes are written here. One JSON object per line,
 * exactly as the phone sent it plus an arrival time, so a take can be replayed
 * through the same code the live court runs. */
const DIR = 'recordings';
let take = null;   // { label, started, n, stream }

const startTake = (label = 'take') => {
  stopTake();
  mkdirSync(DIR, { recursive: true });
  const slug = String(label).toLowerCase().replace(/[^a-z0-9]+/g, '-').slice(0, 40) || 'take';
  const stamp = new Date().toISOString().replace(/[:.]/g, '-').slice(0, 19);
  const file = join(DIR, `${stamp}_${slug}.jsonl`);
  take = { label, file, started: Date.now(), n: 0, stream: createWriteStream(file) };
  take.stream.write(JSON.stringify({ meta: true, label, started: take.started }) + '\n');
  console.log(`recording  ${file}`);
  return file;
};

let lastFile = null;

const stopTake = () => {
  if (!take) return null;
  const { file, n, label, started } = take;
  take.stream.end();
  const secs = ((Date.now() - started) / 1000).toFixed(1);
  console.log(`saved      ${file}  (${n} frames, ${secs}s, "${label}")`);
  lastFile = file;
  take = null;
  return { file, n };
};

const tellCourts = (msg) => {
  const s = JSON.stringify(msg);
  for (const c of courts) if (c.readyState === 1) c.send(s);
};

const lanIPs = () => Object.values(networkInterfaces()).flat()
  .filter(i => i && i.family === 'IPv4' && !i.internal).map(i => i.address);

wss.on('connection', (ws) => {
  ws.on('message', (raw) => {
    let m; try { m = JSON.parse(raw); } catch { return; }

    if (m.hello === 'racket') {
      rackets.add(ws);
      console.log(`racket connected  (${rackets.size} racket, ${courts.size} court)`);
      for (const c of courts) c.send(JSON.stringify({ type: 'racket-online' }));
      return;
    }
    if (m.hello === 'court') {
      courts.add(ws);
      console.log(`court connected   (${rackets.size} racket, ${courts.size} court)`);
      ws.send(JSON.stringify({ type: rackets.size ? 'racket-online' : 'racket-offline' }));
      return;
    }
    // the court drives recording; these never reach the phone
    if (courts.has(ws) && m.type === 'record') {
      if (m.on) tellCourts({ type: 'recording', on: true, file: startTake(m.label) });
      else { const r = stopTake(); tellCourts({ type: 'recording', on: false, ...(r || {}) }); }
      return;
    }

    // the bench sends its own verdict when a movement finishes; save it next to
    // the take so the numbers are on disk without anyone running a second program
    if (courts.has(ws) && m.type === 'report') {
      mkdirSync(DIR, { recursive: true });
      const base = (m.file || join(DIR, `${Date.now()}_${m.label || 'take'}`))
        .replace(/\.jsonl$/, '');
      writeFileSync(`${base}.report.json`, JSON.stringify(m.stats, null, 2));
      appendFileSync(join(DIR, 'summary.txt'), (m.line || '') + '\n');
      console.log(`report     ${base}.report.json`);
      console.log(`           ${m.line || ''}`);
      return;
    }

    // racket frames and swing events go to every court, and to the take if one is open
    if (rackets.has(ws)) {
      const s = raw.toString();
      for (const c of courts) if (c.readyState === 1) c.send(s);
      if (take) { take.n++; take.stream.write(`{"at":${Date.now()},"msg":${s}}\n`); }
    }
    // the court can talk back to the phone
    if (courts.has(ws)) for (const r of rackets) { if (r.readyState === 1) r.send(raw.toString()); }
  });

  ws.on('close', () => {
    const wasRacket = rackets.delete(ws);
    courts.delete(ws);
    if (wasRacket && rackets.size === 0) {
      for (const c of courts) if (c.readyState === 1)
        c.send(JSON.stringify({ type: 'racket-offline' }));
    }
    console.log(`disconnect        (${rackets.size} racket, ${courts.size} court)`);
  });
});

console.log(`\n  Racket relay listening on :${PORT}\n`);
for (const ip of lanIPs()) console.log(`  phone should connect to:  ws://${ip}:${PORT}`);
console.log(`\n  Takes are written to ./${DIR} when the court asks for one.`);
console.log(`\n  If the phone cannot reach it, the network is probably isolating clients.`);
console.log(`  Fix: turn on the phone's hotspot and join the laptop to it.\n`);
