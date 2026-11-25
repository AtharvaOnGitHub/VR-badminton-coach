// Writes the LAN details the phone needs, so the court can show them.
//
// The address changes with the network, and on a hotspot it changes every time, so
// the QR code is generated at startup rather than checked in. Two files land in the
// repo root: lan.json for the text, and qr.svg for the camera.
import { writeFileSync } from 'fs';
import { networkInterfaces } from 'os';
import { fileURLToPath } from 'url';
import { dirname, join } from 'path';
import QRCode from 'qrcode';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');

const ip = process.env.LAN_IP || Object.values(networkInterfaces()).flat()
  .filter(i => i && i.family === 'IPv4' && !i.internal)
  .map(i => i.address)
  .sort((a, b) => (a.startsWith('192.168.') ? -1 : 0) - (b.startsWith('192.168.') ? -1 : 0))
  [0] || '127.0.0.1';

const expo = `exp://${ip}:8081`;
const svg = await QRCode.toString(expo, {
  type: 'svg', margin: 1, width: 220,
  color: { dark: '#0e1418', light: '#ffffff' },
});

writeFileSync(join(root, 'qr.svg'), svg);
writeFileSync(join(root, 'lan.json'),
  JSON.stringify({ ip, expo, relay: `ws://${ip}:4179`, at: new Date().toISOString() }, null, 2));

console.log(`  QR written for ${expo}`);
