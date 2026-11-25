import { generateSession, METRICS } from './data.js';
import { observe, baselineOf } from './analysis.js';
import { newPolicyState, step, dismiss, unmute, setGlobalMute,
         ACTION_CONTRACTS, THRESHOLDS } from './policy.js';

const BLOCK = 10;
const session = generateSession();
const ps = newPolicyState();

let played = 0;          // swings played so far
let blockIndex = 0;      // completed blocks
let shared = false;
let lastRaised = [];
let reviewed = false;
let notice = null;   // persists across the re-render that follows an override
const dismissedThisBlock = new Set();

const $ = s => document.querySelector(s);
const el = (t, c, h) => { const n = document.createElement(t);
  if (c) n.className = c; if (h !== undefined) n.innerHTML = h; return n; };

/* ───────────────────────── navigation ───────────────────────── */
$('#nav').addEventListener('click', e => {
  const b = e.target.closest('button'); if (!b) return;
  document.querySelectorAll('#nav button').forEach(x => x.classList.toggle('on', x === b));
  document.querySelectorAll('.view').forEach(v => v.classList.toggle('on', v.id === b.dataset.view));
  if (b.dataset.view === 'coach') renderCoach();
  if (b.dataset.view === 'trace') renderTrace();
});

/* ───────────────────────── practice ───────────────────────── */
function playSwing() {
  if (played >= session.length) return;
  const s = session[played];
  played++;

  $('#swing-count').textContent = played;
  $('#block-no').textContent = blockIndex + 1;
  $('#block-progress').textContent = `${played - blockIndex * BLOCK} of ${BLOCK}`;

  const p = $('#swing-pulse');
  p.classList.remove('go'); void p.offsetWidth; p.classList.add('go');

  // Tracking failure: occlusion. Signal it, do not extrapolate, do not score it.
  if (s.trackingQuality < 0.6) {
    $('#tracking-warn').hidden = false;
    $('#tracking-warn').innerHTML =
      `<strong>Swing ${s.id + 1} not scored.</strong> The controller was hidden behind your
       body at the top of the backswing, so the pose is stale. It is left out rather than
       guessed at.`;
  } else {
    $('#tracking-warn').hidden = true;
  }

  if (played % BLOCK === 0) endOfBlock();
  $('#btn-swing').disabled = played >= session.length;
  $('#btn-block').disabled = played >= session.length;
}

function endOfBlock() {
  const ids = session.slice(blockIndex * BLOCK, (blockIndex + 1) * BLOCK).map(s => s.id);
  const { observations } = observe(session, ids);
  lastRaised = step(ps, observations, blockIndex);
  blockIndex++;
  dismissedThisBlock.clear();

  const nudge = $('#nudge');
  const show = lastRaised.filter(o => !ps.perKey[o.key] || ps.perKey[o.key].state === 'active');
  if (show.length && !ps.globalMuted) {
    const o = show[0];
    nudge.hidden = false;
    nudge.innerHTML =
      `<div>There is something in that block I could show you about your
        <strong>${METRICS[o.key].label.toLowerCase()}</strong>.</div>
       <div class="meta">Offered at the end of a block, never mid-swing. Open Review when
        you want it, or ignore this.</div>`;
  } else {
    nudge.hidden = true;
  }
  $('#practice-quiet').textContent = ps.globalMuted
    ? 'Proposals are off. Nothing will be offered; open Review when you want it.'
    : 'Nothing is shown while you practise. That is deliberate.';
}

$('#btn-swing').addEventListener('click', playSwing);
$('#btn-block').addEventListener('click', () => {
  const target = Math.min(session.length, (blockIndex + 1) * BLOCK);
  const timer = setInterval(() => {
    playSwing();
    if (played >= target) clearInterval(timer);
  }, 110);
});

/* ───────────────────────── review ───────────────────────── */
$('#global-mute').addEventListener('change', e => {
  setGlobalMute(ps, e.target.checked);
  if (e.target.checked) $('#nudge').hidden = true;
  $('#practice-quiet').textContent = e.target.checked
    ? 'Proposals are off. Nothing will be offered; open Review when you want it.'
    : 'Nothing is shown while you practise. That is deliberate.';
});

$('#btn-review').addEventListener('click', () => { reviewed = true; renderReview(); });

function sparkline(key, ids) {
  const w = 300, h = 38, pad = 3;
  const xs = session.slice(0, played).filter(s => s.trackingQuality > 0.6);
  const vals = xs.map(s => s[key]);
  const lo = Math.min(...vals), hi = Math.max(...vals), span = (hi - lo) || 1;
  const pts = xs.map((s, i) => {
    const x = pad + (i / (xs.length - 1)) * (w - pad * 2);
    const y = h - pad - ((s[key] - lo) / span) * (h - pad * 2);
    return { x, y, hit: ids.includes(s.id) };
  });
  const d = pts.map((p, i) => `${i ? 'L' : 'M'}${p.x.toFixed(1)},${p.y.toFixed(1)}`).join(' ');
  const dots = pts.filter(p => p.hit)
    .map(p => `<circle cx="${p.x.toFixed(1)}" cy="${p.y.toFixed(1)}" r="2.6" fill="#2c5d8f"/>`).join('');
  return `<svg class="spark" width="${w}" height="${h}" viewBox="0 0 ${w} ${h}">
    <path d="${d}" fill="none" stroke="#c6ccd3" stroke-width="1.4"/>${dots}</svg>`;
}

function renderReview() {
  const box = $('#observations');
  box.innerHTML = '';
  if (!reviewed) return;

  // Review the most recent block against the player's own baseline. Reviewing the
  // whole session would average the recent drift away and make the evidence list
  // meaningless ("swings 1-50" tells a player nothing they can act on).
  const from = Math.max(0, played - BLOCK);
  const ids = session.slice(from, played).map(s => s.id);
  const { observations, dropped } = observe(session, ids);
  $('#review-hint').textContent =
    `Your last ${played - from} swings, against your own first 12 today. Each observation `
    + `names the swings it came from, and you can put any of it away.`;

  const shown = observations.filter(o => {
    const st = ps.perKey[o.key]?.state;
    return st !== 'muted' && !dismissedThisBlock.has(o.key) && o.confidence >= THRESHOLDS.leave;
  });

  if (notice) {
    box.append(el('div', 'toast', notice));
    notice = null;
  }
  if (dropped) {
    box.append(el('div', 'toast',
      `${dropped} swing${dropped > 1 ? 's were' : ' was'} left out because tracking was lost. ` +
      `They are not counted in anything below.`));
  }
  if (!shown.length) {
    box.append(el('div', 'obs', `<p class="said">Nothing stood out in what you have played so far.</p>
      <p class="ev">That is a result, not an empty screen. Your swings sat inside your own
      usual range.</p>`));
  }

  for (const o of shown) {
    const m = METRICS[o.key];
    const dir = o.delta > 0 ? 'higher' : 'lower';
    const state = ps.perKey[o.key]?.state ?? 'dormant';
    const card = el('div', 'obs' + (state === 'active' ? ' raised' : ''));
    card.innerHTML = `
      <h4>${m.label}
        <span class="pill ${state === 'active' ? 'active' : ''}">${state}</span></h4>
      <p class="said">Across these swings your ${m.label.toLowerCase()} ran
        <strong>${Math.abs(o.delta)}${m.unit} ${dir}</strong> than your own first
        ${o.baseline.n} swings today (${o.baseline.mean}${m.unit} → ${o.current}${m.unit}).</p>
      ${sparkline(o.key, o.evidence)}
      <p class="ev">From swings ${o.evidence.slice(0, 12).map(i => i + 1).join(', ')}${o.evidence.length > 12 ? '…' : ''}.
        Compared against you, not against an expert.</p>
      <div class="acts">
        <button data-dismiss="${o.key}">Put this away</button>
      </div>`;
    box.append(card);
  }

  box.querySelectorAll('[data-dismiss]').forEach(b =>
    b.addEventListener('click', () => {
      const key = b.dataset.dismiss;
      const r = dismiss(ps, key);
      dismissedThisBlock.add(key);
      notice = r.message;      // survives the re-render below
      renderReview(); renderMuted();
    }));
  renderMuted();
}

function renderMuted() {
  const muted = Object.entries(ps.perKey).filter(([, v]) => v.state === 'muted');
  $('#muted-box').hidden = !muted.length;
  const list = $('#muted-list'); list.innerHTML = '';
  for (const [key] of muted) {
    const row = el('div', 'obs',
      `<p class="said"><strong>${METRICS[key].label}</strong> is muted for this session.</p>
       <p class="ev">It will not come back on its own, even if it gets stronger.
         Only you can bring it back.</p>
       <div class="acts"><button data-unmute="${key}">Bring it back</button></div>`);
    list.append(row);
  }
  list.querySelectorAll('[data-unmute]').forEach(b =>
    b.addEventListener('click', () => { unmute(ps, b.dataset.unmute); renderReview(); }));
}

/* ───────────────────────── coach ───────────────────────── */
$('#btn-share').addEventListener('click', () => {
  if (shared) return;
  const ok = confirm(
    'Share this session with your coach?\n\n' +
    'They will see every swing, the confidence behind each observation, and anything you muted.\n' +
    'This leaves your headset and cannot be taken back.');
  if (!ok) return;
  shared = true;
  ps.log.push({ at: new Date().toISOString(), event: 'action',
                action: 'share with coach', contract: 'execute with approval', approved: true });
  renderCoach();
});

function renderCoach() {
  $('#coach-locked').hidden = shared;
  $('#coach-body').hidden = !shared;
  $('#btn-share').textContent = shared ? 'Shared' : 'Share this session with a coach';
  $('#btn-share').disabled = shared;
  if (!shared) return;

  const ids = session.slice(0, played).map(s => s.id);
  const { observations, dropped, usable } = observe(session, ids);
  const cards = $('#coach-cards'); cards.innerHTML = '';
  cards.append(el('div', 'card',
    `<div class="k">Swings</div><div class="v">${played}</div>
     <div class="s">${usable} scored · ${dropped} dropped for tracking</div>`));
  for (const o of observations.slice(0, 3)) {
    const st = ps.perKey[o.key]?.state ?? 'dormant';
    cards.append(el('div', 'card',
      `<div class="k">${METRICS[o.key].label}</div>
       <div class="v">${o.delta > 0 ? '+' : ''}${o.delta}${METRICS[o.key].unit}</div>
       <div class="s">confidence ${o.confidence} · z=${o.z} · policy <code>${st}</code>
         ${st === 'muted' ? '<br><strong>player muted this</strong>' : ''}</div>`));
  }

  const t = $('#swing-table');
  t.innerHTML = `<tr><th>#</th><th>Plane °</th><th>Peak m/s</th><th>Prep ms</th>
    <th>Contact cm</th><th>Tracking</th></tr>` +
    session.slice(0, played).map(s => `<tr>
      <td>${s.id + 1}</td><td>${s.swingPlane}</td><td>${s.peakSpeed}</td>
      <td>${s.prepTime}</td><td>${s.contactY}</td>
      <td class="${s.trackingQuality < 0.6 ? 'bad' : ''}">${s.trackingQuality}${s.trackingQuality < 0.6 ? ' — dropped' : ''}</td>
    </tr>`).join('');
}

/* ───────────────────────── trace ───────────────────────── */
function renderTrace() {
  const t = $('#trace-table');
  const rows = ps.log.map(e => `<tr>
     <td>${e.at.slice(11, 19)}</td><td><code>${e.event}</code></td>
     <td>${e.key ? METRICS[e.key]?.label ?? e.key : (e.action ?? '—')}</td>
     <td>${e.from ? `${e.from} → ${e.to}` : (e.effect ?? e.reason ?? (e.on !== undefined ? `on=${e.on}` : (e.contract ?? '—')))}</td>
     <td>${e.confidence ?? '—'}</td><td>${e.block ?? '—'}</td></tr>`).join('');
  t.innerHTML = `<tr><th>Time</th><th>Event</th><th>Subject</th><th>Detail</th>
    <th>Conf</th><th>Block</th></tr>` +
    (rows || `<tr><td colspan="6">Nothing yet. Play a block.</td></tr>`);
}

/* boot */
renderReview();
