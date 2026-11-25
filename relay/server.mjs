// Relay between the phone (racket) and the browser (court).
//
// The phone cannot talk to the page directly, so this sits between them. It is
// deliberately dumb: it forwards racket frames and keeps nothing. Running it is
// one command and it prints the URL to type into the phone.
import { WebSocketServer } from 'ws';
import { networkInterfaces } from 'os';

const PORT = Number(process.env.PORT || 4179);
const wss = new WebSocketServer({ port: PORT });

const rackets = new Set();   // phones
const courts = new Set();    // browsers

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
    // racket frames and swing events go to every court
    if (rackets.has(ws)) for (const c of courts) { if (c.readyState === 1) c.send(raw.toString()); }
    // the court can ask the phone to buzz
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
console.log(`\n  If the phone cannot reach it, the network is probably isolating clients.`);
console.log(`  Fix: turn on the phone's hotspot and join the laptop to it.\n`);
