/**
 * screens.js — every full-screen menu / interstitial as an awaitable function.
 *
 * Each screen renders HTML into the overlay element, subscribes a per-frame
 * input handler with `app.onFrame()`, and resolves a Promise when the player
 * makes a choice. This keeps the top-level game flow linear and readable:
 *
 *   const choice = await titleScreen(app);
 */
import { Audio } from '../core/audio.js';
import { DEVICE_LABELS } from '../core/input.js';
import { Player, MAX_PLAYERS, MIN_PLAYERS } from '../game/players.js';
import { sleep } from '../core/util.js';
import { COMMENDATIONS, Commendations } from '../game/achievements.js';
import { makeJoinCode, parseJoinCode, PHONE_PORT } from '../net/joincode.js';
import { RESOLUTIONS } from '../core/engine.js';

/**
 * Render HTML into the overlay and run `handler(dt, done)` each frame until done(value).
 *
 * Tap / click support: any element with a `data-tap="<action>"` attribute is
 * clickable; `onTap(action, element, done)` receives it. With `tapAnywhere`,
 * a tap on empty space reports the action 'any' (used by "continue" screens).
 */
function runScreen(app, html, handler, { cls = '', onTap = null, tapAnywhere = false } = {}) {
  const ov = app.overlay;
  ov.className = `overlay ${cls}${tapAnywhere ? ' tap-any' : ''}`;
  ov.innerHTML = html;
  return new Promise((resolve) => {
    let finished = false;
    const done = (v) => {
      if (finished) return;
      finished = true; off();
      ov.onclick = null;
      ov.classList.remove('tap-any');
      resolve(v);
    };
    const off = app.onFrame((dt) => handler(dt, done));
    ov.onclick = onTap ? (e) => {
      const el = e.target.closest('[data-tap]');
      if (el && ov.contains(el)) onTap(el.dataset.tap, el, done);
      else if (tapAnywhere) onTap('any', null, done);
    } : null;
  });
}

/** A tappable on-screen button (also clickable with a mouse on PC). */
const tapBtn = (action, label, extra = '') => `<span class="tap-btn ${extra}" data-tap="${action}">${label}</span>`;

/** Vertical list navigation helper shared by simple menus. */
function menuNav(app, items, state, onChange) {
  const dir = app.input.menuDir();
  if (dir === 'up' || dir === 'down') {
    state.index = (state.index + (dir === 'down' ? 1 : -1) + items.length) % items.length;
    Audio.sfx('click');
    onChange();
  }
  return dir;
}

const esc = (s) => String(s).replace(/[&<>]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;' }[c]));

// ===================================================================== TITLE

export function titleScreen(app) {
  const items = [
    { id: 'play', label: 'BEGIN TESTING' },
    { id: 'online', label: 'HOST ONLINE' },
    { id: 'options', label: 'CALIBRATION' },
    { id: 'manual', label: 'FIELD MANUAL' },
    { id: 'commendations', label: 'COMMENDATIONS' },
    { id: 'credits', label: 'CREDITS' },
  ];
  if (app.platform === 'android') items.splice(2, 0, { id: 'join', label: 'JOIN ONLINE' }); // phone app
  if (app.desktop) items.push({ id: 'quit', label: 'QUIT' }); // desktop / phone app only
  const state = { index: 0 };
  const html = `
    <div class="title-wrap">
      <div class="logo"><span class="l1">TEST SUBJECT</span><span class="l2">SOCIAL</span></div>
      <div class="logo-sub">a collection of lethal party games for 2–4 subjects</div>
      <ul class="menu">${items.map((it, i) => `<li data-tap="${i}">${it.label}</li>`).join('')}</ul>
      <div class="hint">${app.touch ? 'Tap an option' : 'W/S or ↑/↓ to choose · F / ENTER / Ⓐ to confirm · or click'}</div>
    </div>
    <div class="corner-note">FACILITY TERMINAL v1.0 · ALL OUTCOMES FINAL</div>`;
  app.backdrop.mode = 'title';
  // Populate the pedestals with random volunteers for atmosphere.
  for (let i = 0; i < MAX_PLAYERS; i++) app.backdrop.setSlot(i, new Player(i, 'bot').look, i + 1);
  Audio.music('menu');
  const paint = () => app.overlay.querySelectorAll('.menu li').forEach((li, i) => li.classList.toggle('sel', i === state.index));
  setTimeout(paint, 0);
  return runScreen(app, html, (dt, done) => {
    menuNav(app, items, state, paint);
    if (app.input.joinPressed()) { Audio.sfx('select'); done(items[state.index].id); }
  }, {
    cls: 'title',
    onTap: (action, el, done) => { state.index = +action; paint(); Audio.sfx('select'); done(items[state.index].id); },
  });
}

// =================================================================== OPTIONS

export function optionsScreen(app) {
  const s = app.settings;
  const rows = [
    { key: 'master', label: 'MASTER VOLUME', get: () => `${Math.round(s.master * 100)}%`, step: (d) => { s.master = clamp01(s.master + d * 0.1); Audio.setVolume('master', s.master); } },
    { key: 'music', label: 'MUSIC VOLUME', get: () => `${Math.round(s.music * 100)}%`, step: (d) => { s.music = clamp01(s.music + d * 0.1); Audio.setVolume('music', s.music); } },
    { key: 'sfx', label: 'EFFECTS VOLUME', get: () => `${Math.round(s.sfx * 100)}%`, step: (d) => { s.sfx = clamp01(s.sfx + d * 0.1); Audio.setVolume('sfx', s.sfx); } },
    { key: 'bot', label: 'BOT SKILL', get: () => ['DOCILE', 'COMPETENT', 'RUTHLESS'][s.botLevel], step: (d) => { s.botLevel = Math.max(0, Math.min(2, s.botLevel + d)); } },
    {
      key: 'res', label: 'RESOLUTION',
      get: () => (RESOLUTIONS.find((r) => r.h === s.resHeight) || RESOLUTIONS[3]).label,
      step: (d) => {
        const i = Math.max(0, RESOLUTIONS.findIndex((r) => r.h === s.resHeight));
        s.resHeight = RESOLUTIONS[Math.max(0, Math.min(RESOLUTIONS.length - 1, i + d))].h;
        app.applyResolution();
      },
    },
    { key: 'gore', label: 'GORE', get: () => (s.gore ? 'ON' : 'REDUCED'), step: () => { s.gore = !s.gore; } },
    { key: 'back', label: 'BACK', get: () => '', step: () => {} },
  ];
  const state = { index: 0 };
  const render = () => {
    const el = app.overlay.querySelector('.opt-list');
    if (!el) return;
    el.innerHTML = rows.map((r, i) => {
      const val = r.get()
        ? `<span class="tap-arrow" data-tap="dec:${i}">◂</span> ${r.get()} <span class="tap-arrow" data-tap="inc:${i}">▸</span>`
        : '';
      return `<li class="${i === state.index ? 'sel' : ''}" data-tap="row:${i}"><span>${r.label}</span><b>${val}</b></li>`;
    }).join('');
  };
  const html = `<div class="panel-screen"><h1>CALIBRATION</h1><ul class="opt-list"></ul><div class="hint">${app.touch ? 'Tap ◂ ▸ to adjust' : '←/→ adjust · Ⓑ / G / ESC back · or click ◂ ▸'}</div></div>`;
  setTimeout(render, 0);
  const change = (i, d) => { state.index = i; rows[i].step(d); Audio.sfx('click'); render(); app.saveSettings(); };
  return runScreen(app, html, (dt, done) => {
    const dir = menuNav(app, rows, state, render);
    if (dir === 'left' || dir === 'right') change(state.index, dir === 'right' ? 1 : -1);
    if (app.input.joinPressed()) { if (rows[state.index].key === 'back') { Audio.sfx('back'); done(); } else change(state.index, 1); }
    if (app.input.backPressed()) { Audio.sfx('back'); done(); }
  }, {
    onTap: (action, el, done) => {
      const [kind, n] = action.split(':'); const i = +n;
      if (rows[i].key === 'back') { Audio.sfx('back'); done(); return; }
      change(i, kind === 'dec' ? -1 : 1);
    },
  });
}
const clamp01 = (v) => Math.round(Math.max(0, Math.min(1, v)) * 10) / 10;

// ==================================================================== MANUAL

export function manualScreen(app, registry) {
  const html = `<div class="panel-screen wide"><h1>FIELD MANUAL</h1>
    <div class="manual-cols">
      <div><h3>CONTROLS</h3>
        <table class="ctl-table">
          <tr><th></th><th>MOVE</th><th>ACTION Ⓐ</th><th>SHOVE Ⓑ</th></tr>
          <tr><td>Keyboard left</td><td>W A S D</td><td>F</td><td>G</td></tr>
          <tr><td>Keyboard right</td><td>ARROWS</td><td>ENTER</td><td>R-SHIFT</td></tr>
          <tr><td>Gamepad</td><td>L-STICK / D-PAD</td><td>Ⓐ / ✕</td><td>Ⓑ / ◯</td></tr>
        </table>
        <h3>PROCEDURE</h3>
        <p>Every simulation is short and lethal. Placement earns points: 3 / 2 / 1 / 0.
        The subject with the most points when the program ends is released. The rest are not.</p>
        <p>Empty seats are filled by facility units (bots). Read the second briefing page — it tells you how to win.</p>
      </div>
      <div><h3>SIMULATIONS</h3><ol class="sim-list">${registry.map((G) => `<li><b>${G.meta.title}</b> — ${esc(G.meta.tagline)}</li>`).join('')}</ol></div>
    </div><div>${tapBtn('back', 'BACK', 'primary')}</div><div class="hint">Ⓑ / G / ESC back</div></div>`;
  return runScreen(app, html, (dt, done) => {
    if (app.input.backPressed() || app.input.joinPressed()) { Audio.sfx('back'); done(); }
  }, { onTap: (action, el, done) => { Audio.sfx('back'); done(); } });
}

/**
 * Online hosting panel: opens a room, shows the join code/URLs and the
 * connected remote players. Resolves 'play' (go to the lobby) or null.
 */
export function onlineScreen(app) {
  const net = app.net;
  let info = null;
  fetch('/netinfo').then((r) => r.json()).then((j) => { info = j; render(); }).catch(() => {});
  if (net.status === 'offline' || net.status === 'error') net.start();
  const render = () => {
    const el = app.overlay.querySelector('.online-body');
    if (!el) return;
    if (net.status === 'error') { el.innerHTML = `<p class="small-note">ONLINE UNAVAILABLE — ${esc(net.error || 'unknown error')}</p><p>Start the game with <b>python serve.py</b> (the relay lives there).</p>`; return; }
    if (net.status !== 'hosting') { el.innerHTML = '<p>Opening a room…</p>'; return; }
    const port = info ? info.port : location.port;
    const local = `http://localhost:${port}/?join=${net.code}`;
    const lan = info && info.lanEnabled ? `http://${info.lan}:${port}/?join=${net.code}` : null;
    const peers = `<div class="online-peers">${net.connectedCount} REMOTE SUBJECT${net.connectedCount === 1 ? '' : 'S'} CONNECTED — they join in the lobby with their Ⓐ button</div>`;
    // Phones join with a short code (room + host address) via JOIN ONLINE.
    const phoneCode = info && info.lanEnabled && Number(port) === PHONE_PORT ? makeJoinCode(net.code, info.lan) : null;
    if (app.platform === 'android') {
      el.innerHTML = phoneCode
        ? `<div>JOIN CODE</div><div class="online-code">${phoneCode}</div>
           <div class="online-urls">Your friend opens the app → <b>JOIN ONLINE</b> → types this code.<small>Both phones must be on the same Wi-Fi, or your friend joins this phone's hotspot.</small></div>${peers}`
        : '<p class="small-note">NO WI-FI CONNECTION — connect to Wi-Fi or turn on your hotspot.</p>';
      return;
    }
    el.innerHTML = `<div>ROOM CODE</div><div class="online-code">${net.code}</div>
      <div class="online-urls">${lan ? `${lan}<small>friends on your network open this address</small>` : `<small>Restart with <b>python serve.py ${PHONE_PORT} --lan</b> to let other machines join.</small>`}
      ${phoneCode ? `PHONE CODE: <b>${phoneCode}</b><small>phones with the app: JOIN ONLINE → type this code</small>` : ''}
      ${local}<small>same machine (another window / browser)</small></div>${peers}`;
  };
  net.onChange = render;
  const html = `<div class="panel-screen wide"><h1>HOST ONLINE</h1><div class="online-body"></div>
    <div>${tapBtn('play', 'CONTINUE TO INTAKE', 'primary')}${tapBtn('back', 'BACK')}</div>
    <div class="hint">Ⓐ continue to intake · Ⓑ back (room stays open)</div></div>`;
  setTimeout(render, 0);
  const finish = (done, v) => { Audio.sfx(v ? 'select' : 'back'); net.onChange = null; done(v); };
  return runScreen(app, html, (dt, done) => {
    if (app.input.joinPressed()) finish(done, 'play');
    else if (app.input.backPressed()) finish(done, null);
  }, { onTap: (action, el, done) => finish(done, action === 'play' ? 'play' : null) });
}

/**
 * JOIN ONLINE (phone app): type the host's join code and connect. The page
 * then navigates to the host's built-in server, which serves the remote-
 * player client (?join=ROOM). Resolves null when the player backs out.
 */
export function joinScreen(app) {
  const ownIp = window.AndroidBridge ? window.AndroidBridge.getLanIp() : null;
  if (app.touch) app.touch.setVisible(false); // free the screen for typing
  const html = `<div class="panel-screen"><h1>JOIN ONLINE</h1>
    <p>Type the join code shown on your friend's phone (HOST ONLINE).</p>
    <input class="join-input" maxlength="9" placeholder="ABCD-EFGH" autocomplete="off" autocapitalize="characters" spellcheck="false">
    <div class="join-err"></div>
    <div><span class="join-btn" data-act="join">JOIN</span><span class="join-btn secondary" data-act="back">BACK</span></div>
    <div class="hint">Both phones must be on the same Wi-Fi (or use your friend's hotspot).</div></div>`;
  return new Promise((resolve) => {
    let finished = false;
    const finish = (v) => {
      if (finished) return;
      finished = true; off();
      if (app.touch) app.touch.setVisible(true);
      resolve(v);
    };
    const tryJoin = () => {
      const input = app.overlay.querySelector('.join-input');
      const err = app.overlay.querySelector('.join-err');
      if (!ownIp) { err.textContent = 'Not connected to Wi-Fi.'; Audio.sfx('wrong'); return; }
      const target = parseJoinCode(input.value, ownIp);
      if (!target) { err.textContent = 'That code is not valid — it looks like ABCD-EFGH.'; Audio.sfx('wrong'); return; }
      Audio.sfx('select');
      err.textContent = `Connecting to ${target.host}…`;
      location.href = `http://${target.host}:${PHONE_PORT}/?join=${target.room}`;
    };
    app.overlay.className = 'overlay dim';
    app.overlay.innerHTML = html;
    const input = app.overlay.querySelector('.join-input');
    input.addEventListener('keydown', (e) => { e.stopPropagation(); if (e.key === 'Enter') tryJoin(); });
    app.overlay.querySelector('[data-act="join"]').addEventListener('click', tryJoin);
    app.overlay.querySelector('[data-act="back"]').addEventListener('click', () => { Audio.sfx('back'); finish(null); });
    setTimeout(() => input.focus(), 50);
    const off = app.onFrame(() => { if (app.input.keyPressed('Escape')) finish(null); });
  });
}

/** Commendation list with unlock state and cumulative progress. */
export function commendationsScreen(app, registry) {
  const { unlocked, total } = Commendations.summary();
  const titleOf = (id) => (registry.find((G) => G.meta.id === id) || { meta: { title: id } }).meta.title;
  const rows = Object.entries(COMMENDATIONS).map(([key, d]) => {
    const on = Commendations.isUnlocked(key);
    const prog = d.goal && !on ? ` <i>${Math.min(d.goal, Commendations.count(key))}/${d.goal}</i>` : '';
    return `<li class="${on ? 'on' : ''}"><span class="medal">${on ? '★' : '☆'}</span><div><b>${d.title}</b>${prog}<small>${esc(d.desc)} · ${titleOf(d.game)}</small></div></li>`;
  }).join('');
  const html = `<div class="panel-screen wide"><h1>COMMENDATIONS</h1><h3 class="sub">${unlocked} / ${total} EARNED</h3><ul class="comm-list">${rows}</ul><div>${tapBtn('back', 'BACK', 'primary')}</div><div class="hint">Ⓑ / G / ESC back</div></div>`;
  return runScreen(app, html, (dt, done) => {
    if (app.input.backPressed() || app.input.joinPressed()) { Audio.sfx('back'); done(); }
  }, { onTap: (action, el, done) => { Audio.sfx('back'); done(); } });
}

export function creditsScreen(app) {
  const html = `<div class="panel-screen"><h1>CREDITS</h1>
    <p class="credits">An original fan-made homage to the "lethal party game" genre.<br><br>
    Design, code, procedural art &amp; synthesized audio: built from scratch for this project.<br>
    Rendering: three.js (MIT).<br>Fonts: Black Ops One, Special Elite, VT323 (SIL OFL).<br><br>
    No subjects were harmed. Officially.</p><div>${tapBtn('back', 'BACK', 'primary')}</div><div class="hint">Ⓑ / G / ESC back</div></div>`;
  return runScreen(app, html, (dt, done) => {
    if (app.input.backPressed() || app.input.joinPressed()) { Audio.sfx('back'); done(); }
  }, { onTap: (action, el, done) => { Audio.sfx('back'); done(); } });
}

// ===================================================================== LOBBY

const FIELDS = ['suit', 'skin', 'hat', 'face', 'ready'];
const FIELD_LABEL = { suit: 'JUMPSUIT', skin: 'SKIN', hat: 'HEAD', face: 'FACE', ready: 'READY' };

/**
 * Join + customize. Humans join with their A button; Y/T adds a bot,
 * X/R removes the last bot. Resolves with the Player[] roster, or null on back.
 */
export function lobbyScreen(app) {
  app.backdrop.mode = 'lobby';
  const roster = app.players.length ? app.players : [];
  roster.forEach((p) => { p.ready = p.isBot; });
  const cursor = new Map(); // player -> field index
  let countdown = null;

  const refreshBackdrop = () => {
    for (let i = 0; i < MAX_PLAYERS; i++) {
      const p = roster.find((r) => r.slot === i);
      app.backdrop.setSlot(i, p ? p.look : null, i + 1);
      if (p && p.ready) app.backdrop.setPose(i, 'armsUp');
    }
  };
  const freeSlot = () => { for (let i = 0; i < MAX_PLAYERS; i++) if (!roster.some((p) => p.slot === i)) return i; return -1; };

  // Touch screens join by tapping a seat (one touch player per device).
  const canTapJoin = () => !!app.touch && !roster.some((p) => p.device === 'touch');

  const render = () => {
    const cards = [];
    for (let i = 0; i < MAX_PLAYERS; i++) {
      const p = roster.find((r) => r.slot === i);
      if (!p) {
        const tapJoin = canTapJoin();
        cards.push(`<div class="slot empty"${tapJoin ? ` data-tap="join:${i}"` : ''}><div class="slot-head">SEAT ${i + 1}</div>
          <div class="slot-empty">${tapJoin ? 'TAP HERE<br>TO VOLUNTEER' : 'PRESS Ⓐ / F / ENTER<br>TO VOLUNTEER'}</div></div>`);
        continue;
      }
      const ci = cursor.get(p) ?? 0;
      const dev = p.isBot ? DEVICE_LABELS.bot.name
        : p.device.startsWith('pad') ? `Gamepad ${+p.device.slice(3) + 1}`
        : p.device.startsWith('net') ? `Online player ${p.device.slice(3)}`
        : DEVICE_LABELS[p.device].name;
      const rows = p.isBot ? `<div class="slot-bot">FACILITY UNIT<br><small>auto-assigned</small></div>` : FIELDS.map((f, fi) => {
        if (f === 'ready') {
          return `<div class="slot-row ${fi === ci ? 'sel' : ''} ${p.ready ? 'ok' : ''}" data-tap="ready:${i}"><span>${FIELD_LABEL[f]}</span><b>${p.ready ? '✔ READY' : 'TAP / Ⓐ'}</b></div>`;
        }
        const val = esc(p.lookLabel(f));
        return `<div class="slot-row ${fi === ci ? 'sel' : ''}"><span>${FIELD_LABEL[f]}</span><b><span class="tap-arrow" data-tap="dec:${i}:${f}">◂</span> ${val} <span class="tap-arrow" data-tap="inc:${i}:${f}">▸</span></b></div>`;
      }).join('');
      cards.push(`<div class="slot ${p.ready ? 'ready' : ''}" style="--pc:${p.color}"><span class="slot-x" data-tap="leave:${i}">✕</span><div class="slot-head">${p.name}</div><div class="slot-dev">${dev}</div>${rows}</div>`);
    }
    const humans = roster.filter((p) => !p.isBot);
    let status = '';
    if (roster.length < MIN_PLAYERS) status = `NEED AT LEAST ${MIN_PLAYERS} SUBJECTS — ${app.touch ? 'TAP +BOT' : 'PRESS T / Ⓨ'} TO ADD A BOT`;
    else if (humans.some((p) => !p.ready)) status = 'WAITING FOR ALL SUBJECTS TO CONFIRM READY';
    else if (countdown !== null) status = `PROCEEDING IN ${Math.ceil(countdown)}`;
    const slotsEl = app.overlay.querySelector('.slots');
    if (!slotsEl) return; // overlay was replaced (screen no longer visible)
    slotsEl.innerHTML = cards.join('');
    app.overlay.querySelector('.lobby-status').textContent = status;
  };

  const html = `<div class="lobby"><h1 class="lobby-title">SUBJECT INTAKE</h1><div class="slots"></div>
    <div class="lobby-status"></div>
    <div class="lobby-actions">${tapBtn('addbot', '+ BOT')}${tapBtn('rembot', '− BOT')}${tapBtn('back', 'BACK')}</div>
    <div class="hint">JOIN Ⓐ/F/ENTER · CUSTOMIZE ↑↓←→ · LEAVE Ⓑ/G/R-SHIFT · ADD BOT T/Ⓨ · REMOVE BOT Y/Ⓧ · BACK ESC · or tap / click</div></div>`;
  setTimeout(() => { refreshBackdrop(); render(); }, 0);

  const addBot = () => { const slot = freeSlot(); if (slot >= 0) { roster.push(new Player(slot, 'bot')); Audio.sfx('join'); } else Audio.sfx('wrong'); };
  const removeBot = () => { const bots = roster.filter((p) => p.isBot); if (bots.length) { roster.splice(roster.indexOf(bots[bots.length - 1]), 1); Audio.sfx('back'); } };
  let leaveRequested = false;

  /** Tap / click actions (see data-tap attributes in render()). */
  const onTap = (action) => {
    const [kind, slotStr, field] = action.split(':');
    const p = roster.find((r) => r.slot === +slotStr);
    if (kind === 'addbot') addBot();
    else if (kind === 'rembot') removeBot();
    else if (kind === 'back') leaveRequested = true;
    else if (kind === 'join' && canTapJoin() && !p) {
      const np = new Player(+slotStr, 'touch'); roster.push(np); cursor.set(np, 0); Audio.sfx('join');
    } else if (kind === 'leave' && p) {
      roster.splice(roster.indexOf(p), 1); app.backdrop.setSlot(p.slot, null); Audio.sfx('back');
    } else if (kind === 'ready' && p) {
      p.ready = !p.ready; cursor.set(p, FIELDS.length - 1);
      Audio.sfx(p.ready ? 'select' : 'back'); app.backdrop.setPose(p.slot, p.ready ? 'armsUp' : 'idle');
    } else if ((kind === 'dec' || kind === 'inc') && p && !p.ready) {
      p.cycle(field, kind === 'inc' ? 1 : -1); cursor.set(p, FIELDS.indexOf(field)); Audio.sfx('click');
    }
    refreshBackdrop(); render();
  };

  return runScreen(app, html, (dt, done) => {
    const inp = app.input;
    let dirty = false;
    // Join with A from an unused device
    const j = inp.joinPressed(true);
    let justJoined = null;
    if (j && !roster.some((p) => p.device === j)) {
      const slot = freeSlot();
      if (slot >= 0) { const p = new Player(slot, j); roster.push(p); cursor.set(p, 0); justJoined = j; Audio.sfx('join'); dirty = true; }
    }
    // Bots (keys / gamepad; the on-screen buttons go through onTap)
    if (inp.keyPressed('KeyT') || [0, 1, 2, 3].some((i) => inp.padPressed(i, 3))) { addBot(); dirty = true; }
    if (inp.keyPressed('KeyY') || [0, 1, 2, 3].some((i) => inp.padPressed(i, 2))) { removeBot(); dirty = true; }
    // Online players whose connection dropped give up their seat.
    for (const p of roster.filter((r) => r.device.startsWith('net') && !app.net.isConnected(r.device))) {
      roster.splice(roster.indexOf(p), 1); app.backdrop.setSlot(p.slot, null); dirty = true;
    }
    // Per-player customization using their own controller
    for (const p of roster.filter((r) => !r.isBot)) {
      const c = inp.controller(p.device);
      let ci = cursor.get(p) ?? 0;
      if (c.dirPressed === 'down' || c.dirPressed === 'up') { ci = (ci + (c.dirPressed === 'down' ? 1 : -1) + FIELDS.length) % FIELDS.length; cursor.set(p, ci); Audio.sfx('click'); dirty = true; }
      const field = FIELDS[ci];
      if ((c.dirPressed === 'left' || c.dirPressed === 'right') && field !== 'ready' && !p.ready) { p.cycle(field, c.dirPressed === 'right' ? 1 : -1); Audio.sfx('click'); app.backdrop.setSlot(p.slot, p.look, p.slot + 1); dirty = true; }
      if (c.aPressed && justJoined !== p.device) { // A on an existing player toggles ready (or jumps to ready row)
        if (field === 'ready' || p.ready) { p.ready = !p.ready; Audio.sfx(p.ready ? 'select' : 'back'); app.backdrop.setPose(p.slot, p.ready ? 'armsUp' : 'idle'); }
        else { cursor.set(p, FIELDS.length - 1); Audio.sfx('click'); }
        dirty = true;
      }
      if (c.bPressed) {
        if (p.ready) { p.ready = false; app.backdrop.setPose(p.slot, 'idle'); }
        else { roster.splice(roster.indexOf(p), 1); app.backdrop.setSlot(p.slot, null); Audio.sfx('back'); }
        dirty = true;
      }
    }
    // Esc (or the BACK button) leaves the lobby.
    if (inp.keyPressed('Escape') || leaveRequested) { app.players = roster; done(null); return; }
    // Auto-start countdown
    const allReady = roster.length >= MIN_PLAYERS && roster.every((p) => p.ready);
    if (allReady) {
      if (countdown === null) { countdown = 3; dirty = true; }
      const before = Math.ceil(countdown);
      countdown -= dt;
      if (Math.ceil(countdown) !== before) { Audio.sfx('beep'); dirty = true; }
      if (countdown <= 0) { Audio.sfx('go'); app.players = roster.sort((a, b) => a.slot - b.slot); done(app.players); return; }
    } else if (countdown !== null) { countdown = null; dirty = true; }
    if (dirty) { refreshBackdrop(); render(); }
  }, { onTap });
}

// =============================================================== MODE SELECT

export function modeScreen(app) {
  const items = [
    { id: 'original', label: 'FULL PROGRAM', desc: 'All 15 simulations in random order, with orientation and final judgement.' },
    { id: 'arcade', label: 'QUICK SHIFT', desc: '10 random simulations. No orientation, no ceremony.' },
    { id: 'custom', label: 'CUSTOM PLAYLIST', desc: 'Pick exactly which simulations to run. Optional shuffle.' },
  ];
  const state = { index: 0 };
  const paint = () => app.overlay.querySelectorAll('.mode-card').forEach((el, i) => el.classList.toggle('sel', i === state.index));
  const html = `<div class="panel-screen wide"><h1>SELECT PROGRAM</h1><div class="mode-cards">${items.map((it, i) => `<div class="mode-card" data-tap="${i}"><h2>${it.label}</h2><p>${it.desc}</p></div>`).join('')}</div>
    <div>${tapBtn('back', 'BACK')}</div><div class="hint">←/→ choose · Ⓐ confirm · Ⓑ back · or tap a program</div></div>`;
  setTimeout(paint, 0);
  return runScreen(app, html, (dt, done) => {
    const d = app.input.menuDir();
    if (d === 'left' || d === 'right' || d === 'up' || d === 'down') { state.index = (state.index + (d === 'right' || d === 'down' ? 1 : -1) + items.length) % items.length; Audio.sfx('click'); paint(); }
    if (app.input.joinPressed()) { Audio.sfx('select'); done(items[state.index].id); }
    if (app.input.backPressed()) { Audio.sfx('back'); done(null); }
  }, {
    onTap: (action, el, done) => {
      if (action === 'back') { Audio.sfx('back'); done(null); return; }
      state.index = +action; paint(); Audio.sfx('select'); done(items[state.index].id);
    },
  });
}

/** Toggle grid of simulations. Resolves with { ids, shuffle } or null. */
export function customScreen(app, registry) {
  const sel = new Set(app.lastCustom || registry.map((G) => G.meta.id));
  let shuffle = app.lastShuffle ?? true;
  const state = { index: 0 };
  const cols = 5;
  const total = registry.length + 2; // + shuffle + start
  const render = () => {
    const gridEl = app.overlay.querySelector('.pl-grid');
    if (!gridEl) return;
    gridEl.innerHTML = registry.map((G, i) => `<div class="pl-card ${sel.has(G.meta.id) ? 'on' : ''} ${state.index === i ? 'sel' : ''}" data-tap="${i}"><span class="num">${String(i + 1).padStart(2, '0')}</span><b>${G.meta.title}</b><small>${G.meta.category}</small></div>`).join('');
    app.overlay.querySelector('.pl-actions').innerHTML = `<div class="pl-btn ${state.index === registry.length ? 'sel' : ''}" data-tap="${registry.length}">SHUFFLE: ${shuffle ? 'ON' : 'OFF'}</div><div class="pl-btn ${state.index === registry.length + 1 ? 'sel' : ''} ${sel.size ? '' : 'disabled'}" data-tap="${registry.length + 1}">START (${sel.size})</div><div class="pl-btn" data-tap="back">BACK</div>`;
  };
  const html = `<div class="panel-screen wide"><h1>CUSTOM PLAYLIST</h1><div class="pl-grid"></div><div class="pl-actions"></div><div class="hint">arrows move · Ⓐ toggle · Ⓑ back · or tap</div></div>`;
  setTimeout(render, 0);
  /** Activate grid entry / shuffle / start at index i. Returns the result when starting. */
  const activate = (i) => {
    if (i < registry.length) { const id = registry[i].meta.id; if (sel.has(id)) sel.delete(id); else sel.add(id); Audio.sfx('click'); }
    else if (i === registry.length) { shuffle = !shuffle; Audio.sfx('click'); }
    else if (sel.size) { Audio.sfx('select'); app.lastCustom = [...sel]; app.lastShuffle = shuffle; return { ids: registry.map((G) => G.meta.id).filter((id) => sel.has(id)), shuffle }; }
    render();
    return null;
  };
  return runScreen(app, html, (dt, done) => {
    const d = app.input.menuDir();
    if (d) {
      let i = state.index;
      if (i < registry.length) {
        if (d === 'left') i = Math.max(0, i - 1);
        if (d === 'right') i = Math.min(total - 1, i + 1);
        if (d === 'up') i = Math.max(0, i - cols);
        if (d === 'down') i = i + cols < registry.length ? i + cols : registry.length;
      } else {
        if (d === 'left') i = Math.max(registry.length, i - 1) === i ? i - 1 : Math.max(registry.length, i - 1);
        if (d === 'right') i = Math.min(total - 1, i + 1);
        if (d === 'up') i = registry.length - 1;
      }
      state.index = Math.max(0, Math.min(total - 1, i)); Audio.sfx('click'); render();
    }
    if (app.input.joinPressed()) { const r = activate(state.index); if (r) { done(r); return; } }
    if (app.input.backPressed()) { Audio.sfx('back'); done(null); }
  }, {
    onTap: (action, el, done) => {
      if (action === 'back') { Audio.sfx('back'); done(null); return; }
      state.index = +action;
      const r = activate(state.index);
      if (r) done(r);
    },
  });
}

// ============================================================ ORIENTATION

/** Typewriter monologue from the facility. Any A press skips a line. */
export async function monologue(app, lines, { title = 'ORIENTATION' } = {}) {
  const html = `<div class="mono"><div class="mono-title">${title}</div><div class="mono-text"></div>
    <div>${tapBtn('skip', 'SKIP')}</div><div class="hint">Ⓐ / tap continue · Ⓑ skip</div></div>`;
  let lineIdx = 0, chars = 0, acc = 0, hold = 0, tapped = false, skip = false;
  const unattended = app.players.length > 0 && app.players.every((p) => p.isBot);
  return runScreen(app, html, (dt, done) => {
    if (skip) { done(); return; }
    const el = app.overlay.querySelector('.mono-text');
    const line = lines[lineIdx];
    acc += dt;
    while (acc > 0.028 && chars < line.length) { acc -= 0.028; chars++; if (line[chars - 1] !== ' ') Audio.sfx('tick', { vol: 0.6 }); }
    el.textContent = line.slice(0, chars);
    if (app.input.backPressed()) { done(); return; }
    // Bot-only (demo) programs advance on their own.
    hold = chars >= line.length ? hold + dt : 0;
    const autoNext = unattended && hold > 1.8;
    if (app.input.joinPressed() || autoNext || tapped) {
      hold = 0; tapped = false;
      if (chars < line.length) chars = line.length;
      else if (++lineIdx >= lines.length) done(); else { chars = 0; Audio.sfx('click'); }
    }
  }, {
    cls: 'dim',
    tapAnywhere: true,
    onTap: (action) => { if (action === 'skip') skip = true; else tapped = true; },
  });
}

// ============================================================ ROUND SCREENS

/** Big stencilled title card for a simulation. */
export async function titleCard(app, G, index, total) {
  Audio.sfx('sting');
  app.overlay.className = 'overlay card';
  app.overlay.innerHTML = `<div class="tcard"><div class="tc-num">SIMULATION ${String(index + 1).padStart(2, '0')} / ${String(total).padStart(2, '0')}</div><div class="tc-title">${G.meta.title}</div><div class="tc-tag">${esc(G.meta.tagline)}</div></div>`;
  await sleep(2300);
}

/**
 * Two-page briefing (controls, then objective) with per-player ready-up.
 * Bots are always ready. Resolves when every human has pressed A on page 2.
 */
export function briefing(app, G, seats) {
  let page = 0;
  const ready = new Set(seats.filter((s) => s.isBot).map((s) => s.player.id));
  const humans = seats.filter((s) => !s.isBot);
  const ctlIcon = { move: 'MOVE', a: 'Ⓐ', b: 'Ⓑ' };
  const render = () => {
    const m = G.meta;
    const body = page === 0
      ? `<h2>CONTROLS</h2><table class="brief-ctl">${m.controls.map((c) => `<tr><td class="key">${ctlIcon[c.input] || c.input}</td><td>${esc(c.label)}</td><td class="keys">${c.input === 'move' ? 'WASD · ARROWS · STICK' : c.input === 'a' ? 'F · ENTER · Ⓐ' : c.input === 'b' ? 'G · R-SHIFT · Ⓑ' : ''}</td></tr>`).join('')}</table>`
      : `<h2>OBJECTIVE</h2><p class="objective">${esc(m.objective)}</p>${(m.rules || []).length ? `<ul class="rules">${m.rules.map((r) => `<li>${esc(r)}</li>`).join('')}</ul>` : ''}`;
    const chips = seats.map((s) => `<span class="chip ${ready.has(s.player.id) ? 'ok' : ''}" style="--pc:${s.player.color}">${s.player.name}${ready.has(s.player.id) ? ' ✔' : ''}</span>`).join('');
    const buttons = page === 0
      ? tapBtn('next', 'NEXT PAGE', 'primary')
      : `${tapBtn('back', 'PREVIOUS')}${tapBtn('ready', "I'M READY", 'primary')}`;
    app.overlay.innerHTML = `<div class="brief"><div class="brief-head"><span>${m.category.toUpperCase()}</span><h1>${m.title}</h1><span class="page">PAGE ${page + 1}/2</span></div><div class="brief-body">${body}</div>
      <div class="brief-foot">${page === 0 ? '' : `<div class="chips">${chips}</div>`}<div>${buttons}</div>
      <div class="hint">${page === 0 ? 'Ⓐ NEXT PAGE' : 'EVERY SUBJECT PRESS Ⓐ WHEN READY · Ⓑ PREVIOUS PAGE'}</div></div></div>`;
  };
  app.overlay.className = 'overlay dim';
  render();
  // Taps / clicks: a touch player readies their own seat; on a PC (no touch
  // player) the READY button readies every local human at once.
  const tapSeats = () => {
    const touch = humans.filter((s) => s.player.device === 'touch');
    return touch.length ? touch : humans.filter((s) => !s.player.device.startsWith('net'));
  };
  app.overlay.onclick = (e) => {
    const el = e.target.closest('[data-tap]');
    if (!el) return;
    const a = el.dataset.tap;
    if (a === 'next') { page = 1; Audio.sfx('select'); }
    else if (a === 'back') { page = 0; Audio.sfx('back'); }
    else if (a === 'ready') { tapSeats().forEach((s) => ready.add(s.player.id)); Audio.sfx('beep'); }
    render();
  };
  return new Promise((resolve) => {
    const off = app.onFrame(() => {
      let dirty = false;
      for (const s of humans) {
        const c = s.ctrl;
        if (c.aPressed) {
          if (page === 0) { page = 1; Audio.sfx('select'); dirty = true; break; }
          if (!ready.has(s.player.id)) { ready.add(s.player.id); Audio.sfx('beep'); dirty = true; }
        }
        if (c.bPressed && page === 1) { if (ready.has(s.player.id)) ready.delete(s.player.id); else page = 0; Audio.sfx('back'); dirty = true; }
      }
      if (!humans.length && page === 0) { page = 1; dirty = true; }
      if (dirty) render();
      if (page === 1 && ready.size === seats.length) { off(); app.overlay.onclick = null; setTimeout(resolve, humans.length ? 300 : 900); }
    });
  });
}

/** 3-2-1-GO overlay. */
export async function countdown(app) {
  app.overlay.className = 'overlay clear';
  for (const n of ['3', '2', '1']) {
    app.overlay.innerHTML = `<div class="count">${n}</div>`;
    Audio.sfx('beep');
    await sleep(650);
  }
  app.overlay.innerHTML = '<div class="count go">GO</div>';
  Audio.sfx('go');
  setTimeout(() => { if (app.overlay.querySelector('.count.go')) app.overlay.innerHTML = ''; }, 600);
}

/** Round results: placement list + points earned. Auto-advances. */
export function roundResults(app, G, results) {
  const rows = results.map((r) => `<tr style="--pc:${r.player.color}" class="${r.died ? 'died' : ''}"><td class="place">${ordinal(r.place)}</td><td class="nm">${r.player.name}</td><td class="st">${r.died ? '✖ TERMINATED' : 'SURVIVED'}</td><td class="pts">+${r.points}</td></tr>`).join('');
  const html = `<div class="panel-screen"><h1>${G.meta.title}</h1><h3 class="sub">SIMULATION REPORT</h3><table class="res-table">${rows}</table><div class="hint">Ⓐ / tap to continue</div></div>`;
  let t = 0;
  return runScreen(app, html, (dt, done) => {
    t += dt;
    if (t > 0.6 && (app.input.joinPressed() || t > 7)) { Audio.sfx('click'); done(); }
  }, { cls: 'dim', tapAnywhere: true, onTap: (a, el, done) => { if (t > 0.6) { Audio.sfx('click'); done(); } } });
}

/** Cumulative standings with animated bars. */
export function standings(app, players, { title = 'STANDINGS', roundIndex = null, total = null } = {}) {
  const max = Math.max(1, ...players.map((p) => p.score));
  const sorted = players.slice().sort((a, b) => b.score - a.score);
  const rows = sorted.map((p, i) => `<div class="stand-row" style="--pc:${p.color}"><span class="rank">${i + 1}</span><span class="nm">${p.name}</span><div class="bar"><div class="fill" style="width:0%" data-w="${(p.score / max) * 100}"></div></div><span class="sc">${p.score}</span></div>`).join('');
  const prog = roundIndex !== null ? `<div class="prog">${roundIndex + 1} OF ${total} SIMULATIONS COMPLETE</div>` : '';
  const html = `<div class="panel-screen"><h1>${title}</h1>${prog}<div class="stand">${rows}</div><div class="hint">Ⓐ / tap to continue</div></div>`;
  let t = 0;
  setTimeout(() => app.overlay.querySelectorAll('.fill').forEach((f) => { f.style.width = `${f.dataset.w}%`; }), 50);
  return runScreen(app, html, (dt, done) => {
    t += dt;
    if (t > 0.8 && (app.input.joinPressed() || t > 6)) { Audio.sfx('click'); done(); }
  }, { cls: 'dim', tapAnywhere: true, onTap: (a, el, done) => { if (t > 0.8) { Audio.sfx('click'); done(); } } });
}

/** End of program: winner released, the rest judged. */
export function finalScreen(app, players, { ceremony = true } = {}) {
  const sorted = players.slice().sort((a, b) => b.score - a.score);
  const top = sorted[0].score;
  const winners = sorted.filter((p) => p.score === top);
  const rows = sorted.map((p, i) => `<tr style="--pc:${p.color}"><td class="place">${ordinal(i + 1)}</td><td class="nm">${p.name}</td><td>${p.history.filter((h) => h.place === 1).length} wins · ${p.deaths} deaths</td><td class="pts">${p.score}</td></tr>`).join('');
  const verdict = winners.length > 1 ? `${winners.map((w) => w.name).join(' & ')} — TIE. THE FACILITY WILL DECIDE LATER.` : `${winners[0].name} HAS PROVEN THEIR WORTH.`;
  const html = `<div class="panel-screen"><h1>${ceremony ? 'FINAL JUDGEMENT' : 'SHIFT COMPLETE'}</h1><h2 class="verdict" style="color:${winners[0].color}">${verdict}</h2><table class="res-table">${rows}</table>
    ${ceremony ? '<p class="small-note">All other subjects will be recycled.</p>' : ''}<div>${tapBtn('done', 'RETURN TO TERMINAL', 'primary')}</div><div class="hint">Ⓐ return to terminal</div></div>`;
  Audio.sfx('win');
  // Stage the verdict on the intake pedestals: winners celebrate, the rest cower.
  app.backdrop.mode = 'title';
  for (let i = 0; i < MAX_PLAYERS; i++) {
    const p = players.find((pl) => pl.slot === i);
    app.backdrop.setSlot(i, p ? p.look : null, i + 1);
    if (p) app.backdrop.setPose(i, winners.includes(p) ? 'armsUp' : 'cower');
  }
  let t = 0;
  return runScreen(app, html, (dt, done) => {
    t += dt;
    if (t > 1.2 && app.input.joinPressed()) { Audio.sfx('select'); done(); }
  }, { cls: 'dim', onTap: (a, el, done) => { if (t > 1.2) { Audio.sfx('select'); done(); } } });
}

/** Pause menu shown with ESC during a round. Resolves 'resume' | 'skip' | 'quit'. */
export function pauseScreen(app) {
  const items = [{ id: 'resume', label: 'RESUME' }, { id: 'skip', label: 'SKIP SIMULATION' }, { id: 'quit', label: 'ABORT PROGRAM' }];
  const state = { index: 0 };
  const prev = { cls: app.overlay.className, html: app.overlay.innerHTML };
  const paint = () => app.overlay.querySelectorAll('.menu li').forEach((li, i) => li.classList.toggle('sel', i === state.index));
  const html = `<div class="panel-screen"><h1>PAUSED</h1><ul class="menu">${items.map((it, i) => `<li data-tap="${i}">${it.label}</li>`).join('')}</ul></div>`;
  setTimeout(paint, 0);
  const choose = (done, id) => { app.overlay.className = prev.cls; app.overlay.innerHTML = prev.html; done(id); };
  return runScreen(app, html, (dt, done) => {
    menuNav(app, items, state, paint);
    if (app.input.joinPressed()) { Audio.sfx('select'); choose(done, items[state.index].id); }
    if (app.input.keyPressed('Escape')) choose(done, 'resume');
  }, { cls: 'dim', onTap: (a, el, done) => { Audio.sfx('select'); choose(done, items[+a].id); } });
}

/** 1 → "1ST", 2 → "2ND", 11 → "11TH" ... */
export function ordinal(n) {
  const s = ['TH', 'ST', 'ND', 'RD'], v = n % 100;
  return `${n}${s[(v - 20) % 10] || s[v] || s[0]}`;
}
