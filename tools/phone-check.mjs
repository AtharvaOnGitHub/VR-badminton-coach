// Drives the phone app's setup pages in a browser, through the real relay.
//
// The app is React Native, so it cannot be clicked on a laptop as it stands. Expo
// builds the same source for the web, which gives a DOM the same presses can be
// made against. It does not prove anything about the sensor, which the web build
// has no access to, but it does prove the buttons are pressable and the wizard
// advances, which is exactly what broke when a component was declared inside
// another one and the tree was being thrown away sixty times a second.
import { chromium } from 'playwright';
import { spawn } from 'child_process';

const WEB = process.argv[2];
const PORT = 4188;
let pass = 0, fail = 0;
const ok = (n, c, x = '') => { console.log(`${c ? '  PASS' : '  FAIL'}  ${n}${x ? '  — ' + x : ''}`); c ? pass++ : fail++; };
const sleep = ms => new Promise(r => setTimeout(r, ms));

const srv = spawn('python3', ['-m', 'http.server', String(PORT), '--directory', WEB],
                  { stdio: 'ignore' });
const relay = spawn('node', ['relay/server.mjs'], { stdio: 'ignore' });
await sleep(1200);

const b = await chromium.launch();
const page = await b.newPage({ viewport: { width: 420, height: 880 } });
const errs = [];
page.on('pageerror', e => errs.push(e.message));
await page.goto(`http://localhost:${PORT}/`, { waitUntil: 'networkidle' });
await sleep(1200);

const seen = async (text) => (await page.getByText(text, { exact: false }).count()) > 0;
// the step crumbs along the top carry the same words as some of the buttons, and
// they come first in the DOM, so always press the last match
const tap = async (text) => {
  await page.getByText(text, { exact: true }).last().click();
  await sleep(450);
};

console.log('\nPHONE APP: THE SETUP PAGES RESPOND');
ok('the app renders at all', await seen('This phone is the racket'), errs.join(' / '));

// A tree that is thrown away on every sensor frame cannot hold focus or finish a
// press. Both of the next two were broken by exactly that.
await page.locator('input').first().fill('127.0.0.1');
await sleep(300);
const typed = await page.locator('input').first().inputValue();
ok('the address field keeps what is typed', typed === '127.0.0.1', typed);

await tap('Connect');
await sleep(1200);
ok('Connect is pressable, reaches the relay, and advances', await seen('Which hand?'),
   (await page.locator('body').innerText()).replace(/\n/g, ' | ').slice(0, 110));

await tap('Right');
ok('choosing a hand advances to the grip page', await seen('Your grip'));

await tap('Back');
ok('Back goes one page, not to the start', await seen('Which hand?'));
await tap('Right');

// There is no motion sensor in a browser. The app has to say so rather than
// appear to work, and it must not take the screen down on the way.
await tap('Set my rest position');
await sleep(1600);
ok('with no sensor, calibration reports the problem',
   await seen('No motion data') || await seen('no motion sensor'),
   (await page.locator('body').innerText()).replace(/\n/g, ' | ').slice(0, 140));
ok('and the app is still alive after it', await seen('Your grip'));

ok('no runtime errors anywhere in the flow', errs.length === 0, errs.join(' / '));

console.log(`\n${pass} passed, ${fail} failed\n`);
await b.close(); srv.kill(); relay.kill();
process.exit(fail ? 1 : 0);
