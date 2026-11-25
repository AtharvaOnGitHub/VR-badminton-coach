import { createSim } from './sim.js';
import { createRacket } from './racket.js';
import { observe } from './analysis.js';
import { newPolicyState, step as policyStep, dismiss, unmute, setGlobalMute,
         THRESHOLDS } from './policy.js';

const BLOCK = 10;
const $ = s => document.querySelector(s);
const el = (t, c, h) => { const n = document.createElement(t);
  if (c) n.className = c; if (h !== undefined) n.innerHTML = h; return n; };

const ps = newPolicyState();

/* ---------- session gate ----------
 *
 * The drill does not run until four things are true. Three of them are the player
 * telling the system something it cannot work out for itself: which hand they play
 * with, where their arm rests, and whether what they see on the court is actually
 * them. The fourth is the start itself, which is the player's own act rather than
 * the system's. Before that, swings are not counted, because a counter that starts
 * when the app opens records picking the phone up as a stroke.
 *
 * Keyboard mode skips the three phone gates and says so, so the court is still
 * usable with no hardware. */
const gate = { hand: false, cal: false, mirror: false, live: false };
let session = false, keyboardOnly = false;

const racket = createRacket({
  onSwing: (r) => { if (session) sim.swing(r); },
  onHand: (h) => {
    gate.hand = true;
    $('#hand-chip').textContent = h + ' handed'; $('#hand-chip').hidden = false;
    paintLobby();
  },
  onCalibrated: (ok) => {
    gate.cal = ok;
    const c = $('#cal-chip'); c.hidden = !ok; c.textContent = 'rest pose set';
    paintLobby();
  },
  onSession: (on) => { on ? startSession('phone') : stopSession(null, 'phone'); },
  onStatus: (s) => {
    const chip = $('#racket-chip');
    chip.textContent = s === 'racket connected' ? 'racket live' : s;
    chip.className = 'hud hud-tr2 ' + (s === 'racket connected' ? 'live' : 'cold');
    if (s !== 'racket connected') {
      gate.live = gate.mirror = false;
      if (session) stopSession({ title: 'The racket went quiet',
        detail: 'No frames are arriving from your phone, so a swing cannot be read. '
              + 'Reconnect on the phone, then start again.' });
    }
    paintLobby();
  },
});
let blockIndex = 0, shared = false, reviewed = false, notice = null;
let nextTimer = null;
const dismissedThisBlock = new Set();

const sim = createSim($('#c'), {
  racketAttitude: () => (racket.online ? racket.state : null),
  racketHand: () => racket.hand,
  onShot: (rep, reps) => {
    $('#shot-count').textContent = reps.length;
    $('#in-count').textContent = reps.filter(r => r.outcome === 'in').length;
    $('#block-line').textContent =
      `Block ${Math.floor(reps.length / BLOCK) + 1} · ${reps.length % BLOCK || (reps.length ? BLOCK : 0)} of ${BLOCK}`;
    // The one routine haptic: the shuttle met the strings, and how hard.
    // A whiff deliberately sends nothing. The court below says what happened.
    if (rep.swung && rep.outcome !== 'whiff') racket.contact(rep.power ?? 0.6, rep.kind);

    const v = $('#verdict');
    if (rep.outcome === 'whiff') {
      v.className = 'hud hud-bc v-whiff';
      v.innerHTML = `WHIFF<div class="vsub">you swung, but it was ${rep.reason}
        — ${rep.dist} m away, you can reach ${rep.reach} m</div>`;
    } else if (rep.outcome === 'missed') {
      v.className = 'hud hud-bc v-missed';
      v.innerHTML = `LET IT GO<div class="vsub">no swing</div>`;
    } else {
      const word = { in: 'IN', long: 'LONG', out: 'OUT', short: 'SHORT', net: 'NET' }[rep.outcome];
      v.className = 'hud hud-bc v-' + rep.outcome;
      v.innerHTML = `${word}<div class="vsub">${rep.kind}
        · ${rep.pitchDeg}° off the face at ${rep.speed} m/s${
        rep.forcedUp > 4 ? ' · you were under it, so it had to go up' : ''}</div>`;
    }
    v.hidden = false;
    if (reps.length % BLOCK === 0) endBlock(reps);
  },
  onOfferPause: (on) => {
    const o = $('#offer');
    o.hidden = !on || ps.globalMuted;
    if (!o.hidden) o.innerHTML =
      `Three past the target in a row. <strong>Press P</strong> on the next one to stop the
       shuttle in the air and look at where you are. Or carry on.`;
  },
  onState: ({ state }) => {
    if (state === 'incoming') $('#verdict').hidden = true;
    // A drill feeds itself. Standing still to press a key between reps is not
    // badminton, so the next shuttle comes on its own while the session is running.
    if (state === 'done' && session) {
      clearTimeout(nextTimer);
      nextTimer = setTimeout(() => { if (session) feedNext(); }, 1500);
    }
  },
});

function endBlock(reps) {
  const ids = reps.slice(blockIndex * BLOCK, (blockIndex + 1) * BLOCK).map(r => r.id);
  const { observations } = observe(reps, ids);
  policyStep(ps, observations, blockIndex);
  blockIndex++;
  dismissedThisBlock.clear();
}

/* ---------- the lobby, and starting ---------- */
const ready = () => keyboardOnly || (gate.hand && gate.cal && gate.mirror && gate.live);

function paintLobby() {
  const set = (id, on) => $(id).classList.toggle('done', !!on);
  set('#g-hand', keyboardOnly || gate.hand);
  set('#g-cal', keyboardOnly || gate.cal);
  set('#g-mirror', keyboardOnly || gate.mirror);
  set('#g-start', session);
  document.querySelector('.stage').classList.toggle('lobbying', !session);
  $('#btn-start').disabled = !ready();
  $('#btn-start').textContent = keyboardOnly ? 'Start without a phone' : 'Start the drill';
  $('#btn-mirror').disabled = !gate.live || gate.mirror;
  $('#btn-mirror').textContent = gate.mirror ? 'Confirmed' : 'I can see my racket move';
}

function startSession(from = 'court') {
  if (session || !ready()) return;
  session = true;
  $('#lobby').hidden = true;
  for (const b of ['#btn-feed', '#btn-swing', '#btn-freeze', '#btn-stop'])
    $(b).disabled = false;
  if (from !== 'phone') racket.setSession(true);
  showAlert(null);
  paintLobby();
  feedNext();
}

/** `problem` is null for an ordinary end and an object when something went wrong.
 *  A problem is the only thing that reaches the phone as a harsh haptic, and it is
 *  shown here in the same moment, because a buzz with no explanation is an alarm the
 *  player cannot act on. */
function stopSession(problem = null, from = 'court') {
  clearTimeout(nextTimer);
  if (!session) { if (problem) showAlert(problem); return; }
  session = false;
  for (const b of ['#btn-feed', '#btn-swing', '#btn-freeze', '#btn-stop'])
    $(b).disabled = true;
  $('#lobby').hidden = false;
  if (from !== 'phone') racket.setSession(false);
  if (problem) { showAlert(problem); racket.alertPhone(problem.title, problem.detail); }
  paintLobby();
}

function showAlert(a) {
  const box = $('#alert');
  box.hidden = !a;
  if (a) { $('#alert-title').textContent = a.title; $('#alert-detail').textContent = a.detail; }
}
$('#alert-dismiss').addEventListener('click', () => showAlert(null));

$('#btn-start').addEventListener('click', () => startSession('court'));
$('#btn-stop').addEventListener('click', () => stopSession(null, 'court'));
$('#btn-mirror').addEventListener('click', () => {
  gate.mirror = true; racket.confirmMirror(); paintLobby();
});
$('#btn-relink').addEventListener('click', () => racket.connect());
$('#btn-keyboard').addEventListener('click', () => {
  keyboardOnly = true;
  $('#btn-keyboard').textContent = 'Keyboard mode on';
  $('#btn-keyboard').disabled = true;
  paintLobby();
});

/* The mirror. Its only job is to let the player confirm that the thing moving on
 * screen is them, which no amount of connection status can establish. */
setInterval(() => {
  const on = racket.online;
  if (on !== gate.live) { gate.live = on; if (!on) gate.mirror = false; paintLobby(); }
  $('#m-link').textContent = on ? 'live' : 'not connected';
  $('#m-link').className = on ? 'ok' : '';
  $('#m-hand').textContent = gate.hand ? racket.hand + ' handed' : 'not chosen';
  const st = racket.state;
  $('#m-pitch').textContent = on ? st.pitchDeg.toFixed(0) + '°' : '—';
  $('#m-w').textContent = on ? st.w.toFixed(1) + ' rad/s' : '—';
  $('#m-fill').style.width = Math.min(100, (on ? st.w : 0) / 20 * 100) + '%';
}, 120);

/* ---------- input ---------- */
const feedNext = () => { sim.startRep(); $('#verdict').hidden = true; $('#offer').hidden = true; };
$('#btn-feed').addEventListener('click', () => { if (session) feedNext(); });
$('#btn-swing').addEventListener('click', () => { if (session) sim.swing(racket.fallbackSwing()); });
$('#btn-freeze').addEventListener('click', () => { if (session) sim.togglePause(); });
$('#view-side').addEventListener('change', e => sim.setView(e.target.checked ? 'side' : 'fp'));

addEventListener('keydown', e => {
  if (e.target.tagName === 'INPUT') return;
  if (!session) return;
  if (e.code === 'Space') { e.preventDefault();
    sim.swing(racket.online ? null : racket.fallbackSwing()); }
  if (e.code === 'ArrowLeft'  || e.code === 'KeyA') { e.preventDefault(); sim.step(-1, 0); }
  if (e.code === 'ArrowRight' || e.code === 'KeyD') { e.preventDefault(); sim.step(1, 0); }
  if (e.code === 'ArrowUp'    || e.code === 'KeyW') { e.preventDefault(); sim.step(0, -1); }
  if (e.code === 'ArrowDown'  || e.code === 'KeyS') { e.preventDefault(); sim.step(0, 1); }
  if (e.code === 'KeyP')       { e.preventDefault(); sim.togglePause(); }
  if (e.code === 'Enter')      { e.preventDefault(); feedNext(); }
});

/* ---------- room / remap ---------- */
function syncRemap() {
  const c = +$('#ceil').value, r = +$('#reach').value;
  sim.setRoom({ ceiling: c, reach: r });
  $('#ceil-out').textContent = c.toFixed(2) + ' m';
  $('#reach-out').textContent = r.toFixed(2) + ' m';
  const { plan, factor } = sim.remap;
  $('#rf').max = plan.factor.toFixed(2);
  $('#rf').value = factor.toFixed(2);
  paintRemap();
}
function paintRemap() {
  const { label } = sim.remap;
  $('#rf-out').textContent = (+$('#rf').value).toFixed(2) + '×';
  $('#remap-expl').textContent = label;
  $('#remap-chip').textContent = (+$('#rf').value) <= 1.001
    ? 'remap off' : `reach ${(+$('#rf').value).toFixed(2)}×`;
}
$('#ceil').addEventListener('input', syncRemap);
$('#reach').addEventListener('input', syncRemap);
$('#rf').addEventListener('input', e => { sim.setRemap(+e.target.value); paintRemap(); });

/* ---------- nav ---------- */
$('#nav').addEventListener('click', e => {
  const b = e.target.closest('button'); if (!b) return;
  document.querySelectorAll('#nav button').forEach(x => x.classList.toggle('on', x === b));
  document.querySelectorAll('.view').forEach(v => v.classList.toggle('on', v.id === b.dataset.view));
  if (b.dataset.view === 'coach') renderCoach();
  if (b.dataset.view === 'review') renderReview();
});

/* ---------- review ---------- */
$('#global-mute').addEventListener('change', e => {
  setGlobalMute(ps, e.target.checked);
  if (e.target.checked) $('#offer').hidden = true;
});
$('#btn-review').addEventListener('click', () => { reviewed = true; renderReview(); });

function miniChart(obs, reps) {
  const w = 310, h = 54, pad = 8;
  const all = reps.filter(r => r.swung);
  if (!all.length) return '';
  const vals = all.map(r => r[obs.key]);
  const lo = Math.min(...vals), hi = Math.max(...vals), span = (hi - lo) || 1;
  const dots = all.map((r, i) => {
    const x = pad + (i / Math.max(1, all.length - 1)) * (w - pad * 2);
    const y = h - pad - ((r[obs.key] - lo) / span) * (h - pad * 2);
    const good = r.outcome === 'in';
    return `<circle cx="${x.toFixed(1)}" cy="${y.toFixed(1)}" r="${good ? 3.4 : 3.8}"
      fill="${good ? '#3fd08a' : '#ff8a5b'}" opacity="${good ? 0.95 : 0.95}"/>`;
  }).join('');
  return `<svg class="spark" width="${w}" height="${h}" viewBox="0 0 ${w} ${h}">
    ${dots}</svg>
    <div class="legend"><span class="sw g"></span>landed in target
      <span class="sw b"></span>missed</div>`;
}

function renderReview() {
  const box = $('#observations'); box.innerHTML = '';
  const reps = sim.reps;
  if (!reviewed) {
    $('#review-hint').textContent =
      'The shuttle tells you where it went on every rep. This is the other thing — why. It waits until you ask for it.';
    return;
  }
  const from = Math.max(0, reps.length - BLOCK);
  const ids = reps.slice(from).map(r => r.id);
  const { observations, good, bad, missed } = observe(reps, ids);
  $('#review-hint').textContent =
    `Your last ${reps.length - from} reps: ${good} in the target across the session, ${bad} that missed in this block.`;

  if (notice) { box.append(el('div', 'toast', notice)); notice = null; }
  if (missed) box.append(el('div', 'toast',
    `${missed} shuttle${missed > 1 ? 's' : ''} went past without a swing. Not counted.`));

  const shown = observations.filter(o =>
    ps.perKey[o.key]?.state !== 'muted' && !dismissedThisBlock.has(o.key)
    && o.confidence >= THRESHOLDS.leave);

  if (!shown.length) {
    box.append(el('div', 'obs',
      `<p class="said">Nothing separates your misses from your good reps yet.</p>
       <p class="ev">Either they are landing, or there is no single thing to point at.
       Play another block.</p>`));
  }
  for (const o of shown) {
    const st = ps.perKey[o.key]?.state ?? 'dormant';
    const card = el('div', 'obs' + (st === 'active' ? ' raised' : ''));
    card.innerHTML = `
      <h4>${o.label} <span class="pill ${st === 'active' ? 'active' : ''}">${st}</span></h4>
      <p class="said">${o.sentence}</p>
      ${miniChart(o, reps)}
      <p class="ev">Reps ${o.evidence.map(i => i + 1).join(', ')}, against your own
        ${o.against.length} that landed. Not against an expert.</p>
      <div class="acts">
        <button data-see="${o.key}">Show me on the court</button>
        <button data-dismiss="${o.key}">Put this away</button>
      </div>`;
    box.append(card);
  }
  box.querySelectorAll('[data-dismiss]').forEach(b => b.addEventListener('click', () => {
    const r = dismiss(ps, b.dataset.dismiss);
    dismissedThisBlock.add(b.dataset.dismiss);
    notice = r.message; renderReview(); renderMuted();
  }));
  box.querySelectorAll('[data-see]').forEach(b => b.addEventListener('click', () => {
    const worst = sim.reps.filter(r => r.swung && r.outcome !== 'in').pop();
    sim.setView('side'); $('#view-side').checked = true;
    sim.showIdeal(true); sim.markContact(worst, true);
    document.querySelector('[data-view="play"]').click();
  }));
  renderMuted();
}

function renderMuted() {
  const muted = Object.entries(ps.perKey).filter(([, v]) => v.state === 'muted');
  $('#muted-box').hidden = !muted.length;
  const list = $('#muted-list'); list.innerHTML = '';
  for (const [key] of muted) {
    list.append(el('div', 'obs',
      `<p class="said"><strong>${key === 'ahead' ? 'Contact point'
        : key === 'vHeight' ? 'Contact height' : 'Stepping across'}</strong> is muted.</p>
       <p class="ev">It will not come back on its own, however strong it gets.
         Only you can bring it back.</p>
       <div class="acts"><button data-unmute="${key}">Bring it back</button></div>`));
  }
  list.querySelectorAll('[data-unmute]').forEach(b =>
    b.addEventListener('click', () => { unmute(ps, b.dataset.unmute); renderReview(); }));
}

/* ---------- coach ---------- */
$('#btn-share').addEventListener('click', () => {
  if (shared) return;
  if (!confirm('Share this session with your coach?\n\nThey will see every rep, the '
    + 'confidence behind each observation, and anything you muted.\nThis leaves your '
    + 'headset and cannot be taken back.')) return;
  shared = true;
  ps.log.push({ at: new Date().toISOString(), event: 'action',
                action: 'share with coach', contract: 'execute with approval' });
  renderCoach();
});

function renderCoach() {
  $('#coach-locked').hidden = shared;
  $('#coach-body').hidden = !shared;
  $('#btn-share').disabled = shared;
  $('#btn-share').textContent = shared ? 'Shared' : 'Share this session';
  if (!shared) return;
  const reps = sim.reps;
  const { observations, good, bad } = observe(reps, reps.map(r => r.id));
  const cards = $('#coach-cards'); cards.innerHTML = '';
  cards.append(el('div', 'card', `<div class="k">Reps</div><div class="v">${reps.length}</div>
    <div class="s">${good} in target · ${bad} missed</div>`));
  for (const o of observations.slice(0, 3)) {
    const st = ps.perKey[o.key]?.state ?? 'dormant';
    cards.append(el('div', 'card', `<div class="k">${o.label}</div>
      <div class="v">${o.delta > 0 ? '+' : ''}${o.delta} m</div>
      <div class="s">confidence ${o.confidence} · z=${o.z} · <code>${st}</code>
      ${st === 'muted' ? '<br><strong>player muted this</strong>' : ''}</div>`));
  }
  $('#rep-table').innerHTML =
    `<tr><th>#</th><th>Outcome</th><th>Contact ahead</th><th>Height (virt)</th>
      <th>Sideways</th><th>Stepped</th><th>Launch °</th></tr>` +
    reps.map(r => `<tr>
      <td>${r.id + 1}</td>
      <td class="${r.outcome === 'in' ? 'ok' : 'bad'}">${r.outcome}</td>
      <td>${r.swung ? r.ahead.toFixed(2) + ' m' : '—'}</td>
      <td>${r.swung ? r.vHeight.toFixed(2) + ' m' : '—'}</td>
      <td>${r.swung ? r.lateral.toFixed(2) + ' m' : '—'}</td>
      <td>${r.swung ? (r.stepped ? 'yes' : 'no') : '—'}</td>
      <td>${r.swung ? r.pitchDeg.toFixed(0) + '°' : '—'}</td></tr>`).join('');
}

// exposed so the behaviour can be inspected from the console and by tools/shots.mjs.
// startSession is here so the behaviour checks can arm the drill without a phone.
window.shadow = { sim, ps, observe,
                  startSession: () => { keyboardOnly = true; paintLobby(); startSession('court'); },
                  stopSession: () => stopSession(null, 'court'),
                  get session() { return session; } };

/* boot. The court shows the lobby and waits; it does not feed a shuttle at a player
   who has not said they are ready. */
racket.connect();
syncRemap();
paintLobby();
