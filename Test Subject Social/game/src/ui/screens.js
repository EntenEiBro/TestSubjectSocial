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
import { Haptics } from '../core/haptics.js';
import { t, tr, LANGUAGES, getLanguage } from '../i18n/i18n.js';

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
    { id: 'play', label: t('BEGIN TESTING') },
    { id: 'online', label: t('HOST ONLINE') },
    { id: 'options', label: t('SETTINGS') },
    { id: 'manual', label: t('FIELD MANUAL') },
    { id: 'commendations', label: t('COMMENDATIONS') },
    { id: 'credits', label: t('CREDITS') },
  ];
  if (app.platform === 'android') items.splice(2, 0, { id: 'join', label: t('JOIN ONLINE') }); // phone app
  if (app.desktop) items.push({ id: 'quit', label: t('QUIT') }); // desktop / phone app only
  const state = { index: 0 };
  // The game's name stays untranslated (it is the brand); everything else is localised.
  const html = `
    <div class="title-wrap">
      <div class="logo"><span class="l1">TEST SUBJECT</span><span class="l2">SOCIAL</span></div>
      <div class="logo-sub">${t('a collection of lethal party games for 2–4 subjects')}</div>
      <ul class="menu">${items.map((it, i) => `<li data-tap="${i}">${it.label}</li>`).join('')}</ul>
      <div class="hint">${app.touch ? t('Tap an option') : t('W/S or ↑/↓ to choose · F / ENTER / Ⓐ to confirm · or click')}</div>
    </div>
    <div class="gear-btn" data-tap="settings" title="${t('SETTINGS')}">⚙</div>
    <div class="corner-note">${t('FACILITY TERMINAL v{v} · ALL OUTCOMES FINAL', { v: '1.0.2' })}</div>`;
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
    onTap: (action, el, done) => {
      if (action === 'settings') { Audio.sfx('select'); done('options'); return; }
      state.index = +action; paint(); Audio.sfx('select'); done(items[state.index].id);
    },
  });
}

// =================================================================== OPTIONS

export function optionsScreen(app) {
  const s = app.settings;
  const cycle = (list, cur, d) => list[(list.indexOf(cur) + d + list.length) % list.length];
  // Labels and values are functions so the screen re-renders in a new language at once.
  const rows = [
    {
      key: 'lang', label: () => t('LANGUAGE'),
      get: () => (LANGUAGES.find((l) => l.code === getLanguage()) || LANGUAGES[0]).name,
      step: (d) => { app.setLanguage(cycle(LANGUAGES.map((l) => l.code), getLanguage(), d)); },
    },
    { key: 'master', label: () => t('MASTER VOLUME'), get: () => `${Math.round(s.master * 100)}%`, step: (d) => { s.master = clamp01(s.master + d * 0.1); Audio.setVolume('master', s.master); } },
    { key: 'music', label: () => t('MUSIC VOLUME'), get: () => `${Math.round(s.music * 100)}%`, step: (d) => { s.music = clamp01(s.music + d * 0.1); Audio.setVolume('music', s.music); } },
    { key: 'sfx', label: () => t('EFFECTS VOLUME'), get: () => `${Math.round(s.sfx * 100)}%`, step: (d) => { s.sfx = clamp01(s.sfx + d * 0.1); Audio.setVolume('sfx', s.sfx); } },
    { key: 'bot', label: () => t('BOT SKILL'), get: () => t(['DOCILE', 'COMPETENT', 'RUTHLESS'][s.botLevel]), step: (d) => { s.botLevel = Math.max(0, Math.min(2, s.botLevel + d)); } },
    {
      key: 'res', label: () => t('RESOLUTION'),
      get: () => t((RESOLUTIONS.find((r) => r.h === s.resHeight) || RESOLUTIONS[3]).label),
      step: (d) => {
        const i = Math.max(0, RESOLUTIONS.findIndex((r) => r.h === s.resHeight));
        s.resHeight = RESOLUTIONS[Math.max(0, Math.min(RESOLUTIONS.length - 1, i + d))].h;
        app.applyResolution();
      },
    },
    { key: 'gore', label: () => t('GORE'), get: () => (s.gore ? t('ON') : t('REDUCED')), step: () => { s.gore = !s.gore; } },
    { key: 'back', label: () => t('BACK'), get: () => '', step: () => {} },
  ];
  // Haptic strength only matters on phones / tablets.
  if (app.touch && Haptics.supported) {
    rows.splice(1, 0, {
      key: 'haptics', label: () => t('HAPTIC STRENGTH'),
      get: () => t(HAPTIC_LEVELS[s.hapticLevel] || 'HIGH'),
      step: (d) => {
        s.hapticLevel = Math.max(0, Math.min(HAPTIC_LEVELS.length - 1, (s.hapticLevel ?? 3) + d));
        Haptics.level = s.hapticLevel;
        Haptics.play('click'); // feel the new strength right away
      },
    });
  }
  const state = { index: 0 };
  const render = () => {
    const el = app.overlay.querySelector('.opt-list');
    if (!el) return;
    el.innerHTML = rows.map((r, i) => {
      const val = r.get()
        ? `<span class="tap-arrow" data-tap="dec:${i}">◂</span> ${r.get()} <span class="tap-arrow" data-tap="inc:${i}">▸</span>`
        : '';
      return `<li class="${i === state.index ? 'sel' : ''}" data-tap="row:${i}"><span>${r.label()}</span><b>${val}</b></li>`;
    }).join('');
    // Title + hint follow the language too.
    const h1 = app.overlay.querySelector('.panel-screen h1');
    if (h1) h1.textContent = t('SETTINGS');
    const hint = app.overlay.querySelector('.panel-screen .hint');
    if (hint) hint.textContent = app.touch ? t('Tap ◂ ▸ to adjust') : t('←/→ adjust · Ⓑ / G / ESC back · or click ◂ ▸');
  };
  const html = `<div class="panel-screen"><h1></h1><ul class="opt-list"></ul><div class="hint"></div></div>`;
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
const HAPTIC_LEVELS = ['OFF', 'LOW', 'MEDIUM', 'HIGH'];

// ==================================================================== MANUAL

export function manualScreen(app, registry) {
  const html = `<div class="panel-screen wide"><h1>${t('FIELD MANUAL')}</h1>
    <div class="manual-cols">
      <div><h3>${t('CONTROLS')}</h3>
        <table class="ctl-table">
          <tr><th></th><th>${t('MOVE')}</th><th>${t('ACTION')} Ⓐ</th><th>${t('SHOVE')} Ⓑ</th></tr>
          <tr><td>${t('Keyboard (left)')}</td><td>W A S D</td><td>F</td><td>G</td></tr>
          <tr><td>${t('Keyboard (right)')}</td><td>${t('ARROWS')}</td><td>ENTER</td><td>R-SHIFT</td></tr>
          <tr><td>${t('Gamepad')}</td><td>${t('L-STICK / D-PAD')}</td><td>Ⓐ / ✕</td><td>Ⓑ / ◯</td></tr>
          <tr><td>${t('Touch screen')}</td><td>${t('JOYSTICK')}</td><td>Ⓐ</td><td>Ⓑ</td></tr>
        </table>
        <h3>${t('PROCEDURE')}</h3>
        <p>${t('Every simulation is short and lethal. Placement earns points: 3 / 2 / 1 / 0. The subject with the most points when the program ends is released. The rest are not.')}</p>
        <p>${t('Empty seats are filled by facility units (bots). Read the second briefing page — it tells you how to win.')}</p>
      </div>
      <div><h3>${t('SIMULATIONS')}</h3><ol class="sim-list">${registry.map((G) => `<li><b>${t(G.meta.title)}</b> — ${esc(t(G.meta.tagline))}</li>`).join('')}</ol></div>
    </div><div>${tapBtn('back', t('BACK'), 'primary')}</div><div class="hint">${t('Ⓑ / G / ESC back')}</div></div>`;
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
    if (net.status === 'error') { el.innerHTML = `<p class="small-note">${t('ONLINE UNAVAILABLE')} — ${esc(net.error || '?')}</p><p>${t('Start the game with <b>python serve.py</b> (the relay lives there).')}</p>`; return; }
    if (net.status !== 'hosting') { el.innerHTML = `<p>${t('Opening a room…')}</p>`; return; }
    const port = info ? info.port : location.port;
    const local = `http://localhost:${port}/?join=${net.code}`;
    const lan = info && info.lanEnabled ? `http://${info.lan}:${port}/?join=${net.code}` : null;
    const peers = `<div class="online-peers">${t('{n} REMOTE SUBJECT(S) CONNECTED — they join in the lobby with their Ⓐ button', { n: net.connectedCount })}</div>`;
    // Phones join with a short code (room + host address) via JOIN ONLINE.
    const phoneCode = info && info.lanEnabled && Number(port) === PHONE_PORT ? makeJoinCode(net.code, info.lan) : null;
    if (app.platform === 'android') {
      el.innerHTML = phoneCode
        ? `<div>${t('JOIN CODE')}</div><div class="online-code">${phoneCode}</div>
           <div class="online-urls">${t('Your friend opens the app → <b>JOIN ONLINE</b> → types this code.')}<small>${t("Both phones must be on the same Wi-Fi, or your friend joins this phone's hotspot.")}</small></div>${peers}`
        : `<p class="small-note">${t('NO WI-FI CONNECTION — connect to Wi-Fi or turn on your hotspot.')}</p>`;
      return;
    }
    el.innerHTML = `<div>${t('ROOM CODE')}</div><div class="online-code">${net.code}</div>
      <div class="online-urls">${lan ? `${lan}<small>${t('friends on your network open this address')}</small>` : `<small>${t('Restart with <b>python serve.py {port} --lan</b> to let other machines join.', { port: PHONE_PORT })}</small>`}
      ${phoneCode ? `${t('PHONE CODE')}: <b>${phoneCode}</b><small>${t('phones with the app: JOIN ONLINE → type this code')}</small>` : ''}
      ${local}<small>${t('same machine (another window / browser)')}</small></div>${peers}`;
  };
  net.onChange = render;
  const html = `<div class="panel-screen wide"><h1>${t('HOST ONLINE')}</h1><div class="online-body"></div>
    <div>${tapBtn('play', t('CONTINUE TO INTAKE'), 'primary')}${tapBtn('back', t('BACK'))}</div>
    <div class="hint">${t('Ⓐ continue to intake · Ⓑ back (room stays open)')}</div></div>`;
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
  const html = `<div class="panel-screen"><h1>${t('JOIN ONLINE')}</h1>
    <p>${t("Type the join code shown on your friend's phone (HOST ONLINE).")}</p>
    <input class="join-input" maxlength="9" placeholder="ABCD-EFGH" autocomplete="off" autocapitalize="characters" spellcheck="false">
    <div class="join-err"></div>
    <div><span class="join-btn" data-act="join">${t('JOIN')}</span><span class="join-btn secondary" data-act="back">${t('BACK')}</span></div>
    <div class="hint">${t("Both phones must be on the same Wi-Fi (or use your friend's hotspot).")}</div></div>`;
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
      if (!ownIp) { err.textContent = t('Not connected to Wi-Fi.'); Audio.sfx('wrong'); return; }
      const target = parseJoinCode(input.value, ownIp);
      if (!target) { err.textContent = t('That code is not valid — it looks like ABCD-EFGH.'); Audio.sfx('wrong'); return; }
      Audio.sfx('select');
      err.textContent = t('Connecting to {host}…', { host: target.host });
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
  const titleOf = (id) => t((registry.find((G) => G.meta.id === id) || { meta: { title: id } }).meta.title);
  const rows = Object.entries(COMMENDATIONS).map(([key, d]) => {
    const on = Commendations.isUnlocked(key);
    const prog = d.goal && !on ? ` <i>${Math.min(d.goal, Commendations.count(key))}/${d.goal}</i>` : '';
    return `<li class="${on ? 'on' : ''}"><span class="medal">${on ? '★' : '☆'}</span><div><b>${t(d.title)}</b>${prog}<small>${esc(t(d.desc))} · ${titleOf(d.game)}</small></div></li>`;
  }).join('');
  const html = `<div class="panel-screen wide"><h1>${t('COMMENDATIONS')}</h1><h3 class="sub">${t('{a} / {b} EARNED', { a: unlocked, b: total })}</h3><ul class="comm-list">${rows}</ul><div>${tapBtn('back', t('BACK'), 'primary')}</div><div class="hint">${t('Ⓑ / G / ESC back')}</div></div>`;
  return runScreen(app, html, (dt, done) => {
    if (app.input.backPressed() || app.input.joinPressed()) { Audio.sfx('back'); done(); }
  }, { onTap: (action, el, done) => { Audio.sfx('back'); done(); } });
}

export function creditsScreen(app) {
  const html = `<div class="panel-screen"><h1>${t('CREDITS')}</h1>
    <p class="credits">${t('An original fan-made homage to the "lethal party game" genre.')}<br><br>
    ${t('Design, code, procedural art & synthesized audio: built from scratch for this project.')}<br>
    ${t('Rendering')}: three.js (MIT).<br>${t('Fonts')}: Black Ops One, VT323 (SIL OFL), Special Elite (Apache 2.0).<br><br>
    ${t('No subjects were harmed. Officially.')}</p><div>${tapBtn('back', t('BACK'), 'primary')}</div><div class="hint">${t('Ⓑ / G / ESC back')}</div></div>`;
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
        cards.push(`<div class="slot empty"${tapJoin ? ` data-tap="join:${i}"` : ''}><div class="slot-head">${t('SEAT {n}', { n: i + 1 })}</div>
          <div class="slot-empty">${tapJoin ? t('TAP HERE<br>TO VOLUNTEER') : t('PRESS Ⓐ / F / ENTER<br>TO VOLUNTEER')}</div></div>`);
        continue;
      }
      const ci = cursor.get(p) ?? 0;
      const dev = p.isBot ? t(DEVICE_LABELS.bot.name)
        : p.device.startsWith('pad') ? t('Gamepad {n}', { n: +p.device.slice(3) + 1 })
        : p.device.startsWith('net') ? t('Online player {n}', { n: p.device.slice(3) })
        : t(DEVICE_LABELS[p.device].name);
      const rows = p.isBot ? `<div class="slot-bot">${t('FACILITY UNIT')}<br><small>${t('auto-assigned')}</small></div>` : FIELDS.map((f, fi) => {
        if (f === 'ready') {
          return `<div class="slot-row ${fi === ci ? 'sel' : ''} ${p.ready ? 'ok' : ''}" data-tap="ready:${i}"><span>${t(FIELD_LABEL[f])}</span><b>${p.ready ? `✔ ${t('READY')}` : t('TAP / Ⓐ')}</b></div>`;
        }
        const val = esc(p.lookLabel(f));
        return `<div class="slot-row ${fi === ci ? 'sel' : ''}"><span>${t(FIELD_LABEL[f])}</span><b><span class="tap-arrow" data-tap="dec:${i}:${f}">◂</span> ${val} <span class="tap-arrow" data-tap="inc:${i}:${f}">▸</span></b></div>`;
      }).join('');
      cards.push(`<div class="slot ${p.ready ? 'ready' : ''}" style="--pc:${p.color}"><span class="slot-x" data-tap="leave:${i}">✕</span><div class="slot-head">${p.name}</div><div class="slot-dev">${dev}</div>${rows}</div>`);
    }
    const humans = roster.filter((p) => !p.isBot);
    let status = '';
    if (roster.length < MIN_PLAYERS) status = app.touch ? t('NEED AT LEAST {n} SUBJECTS — TAP +BOT TO ADD A BOT', { n: MIN_PLAYERS }) : t('NEED AT LEAST {n} SUBJECTS — PRESS T / Ⓨ TO ADD A BOT', { n: MIN_PLAYERS });
    else if (humans.some((p) => !p.ready)) status = t('WAITING FOR ALL SUBJECTS TO CONFIRM READY');
    else if (countdown !== null) status = t('PROCEEDING IN {n}', { n: Math.ceil(countdown) });
    const slotsEl = app.overlay.querySelector('.slots');
    if (!slotsEl) return; // overlay was replaced (screen no longer visible)
    slotsEl.innerHTML = cards.join('');
    app.overlay.querySelector('.lobby-status').textContent = status;
  };

  const html = `<div class="lobby"><h1 class="lobby-title">${t('SUBJECT INTAKE')}</h1><div class="slots"></div>
    <div class="lobby-status"></div>
    <div class="lobby-actions">${tapBtn('addbot', t('+ BOT'))}${tapBtn('rembot', t('− BOT'))}${tapBtn('back', t('BACK'))}</div>
    <div class="hint">${t('JOIN Ⓐ/F/ENTER · CUSTOMIZE ↑↓←→ · LEAVE Ⓑ/G/R-SHIFT · ADD BOT T/Ⓨ · REMOVE BOT Y/Ⓧ · BACK ESC · or tap / click')}</div></div>`;
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
    { id: 'original', label: t('FULL PROGRAM'), desc: t('All 15 simulations in random order, with orientation and final judgement.') },
    { id: 'arcade', label: t('QUICK SHIFT'), desc: t('10 random simulations. No orientation, no ceremony.') },
    { id: 'custom', label: t('CUSTOM PLAYLIST'), desc: t('Pick exactly which simulations to run. Optional shuffle.') },
  ];
  const state = { index: 0 };
  const paint = () => app.overlay.querySelectorAll('.mode-card').forEach((el, i) => el.classList.toggle('sel', i === state.index));
  const html = `<div class="panel-screen wide"><h1>${t('SELECT PROGRAM')}</h1><div class="mode-cards">${items.map((it, i) => `<div class="mode-card" data-tap="${i}"><h2>${it.label}</h2><p>${it.desc}</p></div>`).join('')}</div>
    <div>${tapBtn('back', t('BACK'))}</div><div class="hint">${t('←/→ choose · Ⓐ confirm · Ⓑ back · or tap a program')}</div></div>`;
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
    gridEl.innerHTML = registry.map((G, i) => `<div class="pl-card ${sel.has(G.meta.id) ? 'on' : ''} ${state.index === i ? 'sel' : ''}" data-tap="${i}"><span class="num">${String(i + 1).padStart(2, '0')}</span><b>${t(G.meta.title)}</b><small>${t(G.meta.category)}</small></div>`).join('');
    app.overlay.querySelector('.pl-actions').innerHTML = `<div class="pl-btn ${state.index === registry.length ? 'sel' : ''}" data-tap="${registry.length}">${t('SHUFFLE')}: ${shuffle ? t('ON') : t('OFF')}</div><div class="pl-btn ${state.index === registry.length + 1 ? 'sel' : ''} ${sel.size ? '' : 'disabled'}" data-tap="${registry.length + 1}">${t('START')} (${sel.size})</div><div class="pl-btn" data-tap="back">${t('BACK')}</div>`;
  };
  const html = `<div class="panel-screen wide"><h1>${t('CUSTOM PLAYLIST')}</h1><div class="pl-grid"></div><div class="pl-actions"></div><div class="hint">${t('arrows move · Ⓐ toggle · Ⓑ back · or tap')}</div></div>`;
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
  lines = lines.map((l) => t(l));
  const html = `<div class="mono"><div class="mono-title">${t(title)}</div><div class="mono-text"></div>
    <div>${tapBtn('skip', t('SKIP'))}</div><div class="hint">${t('Ⓐ / tap continue · Ⓑ skip')}</div></div>`;
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
  app.overlay.innerHTML = `<div class="tcard"><div class="tc-num">${t('SIMULATION {a} / {b}', { a: String(index + 1).padStart(2, '0'), b: String(total).padStart(2, '0') })}</div><div class="tc-title">${t(G.meta.title)}</div><div class="tc-tag">${esc(t(G.meta.tagline))}</div></div>`;
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
  const ctlIcon = { move: t('MOVE'), a: 'Ⓐ', b: 'Ⓑ' };
  const ctlKeys = { move: t('WASD · ARROWS · STICK'), a: 'F · ENTER · Ⓐ', b: 'G · R-SHIFT · Ⓑ' };
  const render = () => {
    const m = G.meta;
    const body = page === 0
      ? `<h2>${t('CONTROLS')}</h2><table class="brief-ctl">${m.controls.map((c) => `<tr><td class="key">${ctlIcon[c.input] || c.input}</td><td>${esc(t(c.label))}</td><td class="keys">${ctlKeys[c.input] || ''}</td></tr>`).join('')}</table>`
      : `<h2>${t('OBJECTIVE')}</h2><p class="objective">${esc(t(m.objective))}</p>${(m.rules || []).length ? `<ul class="rules">${m.rules.map((r) => `<li>${esc(t(r))}</li>`).join('')}</ul>` : ''}`;
    const chips = seats.map((s) => `<span class="chip ${ready.has(s.player.id) ? 'ok' : ''}" style="--pc:${s.player.color}">${s.player.name}${ready.has(s.player.id) ? ' ✔' : ''}</span>`).join('');
    const buttons = page === 0
      ? tapBtn('next', t('NEXT PAGE'), 'primary')
      : `${tapBtn('back', t('PREVIOUS'))}${tapBtn('ready', t("I'M READY"), 'primary')}`;
    app.overlay.innerHTML = `<div class="brief"><div class="brief-head"><span>${t(m.category).toUpperCase()}</span><h1>${t(m.title)}</h1><span class="page">${t('PAGE {a}/{b}', { a: page + 1, b: 2 })}</span></div><div class="brief-body">${body}</div>
      <div class="brief-foot">${page === 0 ? '' : `<div class="chips">${chips}</div>`}<div>${buttons}</div>
      <div class="hint">${page === 0 ? t('Ⓐ NEXT PAGE') : t('EVERY SUBJECT PRESS Ⓐ WHEN READY · Ⓑ PREVIOUS PAGE')}</div></div></div>`;
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
  app.overlay.innerHTML = `<div class="count go">${t('GO')}</div>`;
  Audio.sfx('go');
  setTimeout(() => { if (app.overlay.querySelector('.count.go')) app.overlay.innerHTML = ''; }, 600);
}

/** Round results: placement list + points earned. Auto-advances. */
export function roundResults(app, G, results) {
  const rows = results.map((r) => `<tr style="--pc:${r.player.color}" class="${r.died ? 'died' : ''}"><td class="place">${ordinal(r.place)}</td><td class="nm">${r.player.name}</td><td class="st">${r.died ? `✖ ${t('TERMINATED')}` : t('SURVIVED')}</td><td class="pts">+${r.points}</td></tr>`).join('');
  const html = `<div class="panel-screen"><h1>${t(G.meta.title)}</h1><h3 class="sub">${t('SIMULATION REPORT')}</h3><table class="res-table">${rows}</table><div class="hint">${t('Ⓐ / tap to continue')}</div></div>`;
  let elapsed = 0;
  return runScreen(app, html, (dt, done) => {
    elapsed += dt;
    if (elapsed > 0.6 && (app.input.joinPressed() || elapsed > 7)) { Audio.sfx('click'); done(); }
  }, { cls: 'dim', tapAnywhere: true, onTap: (a, el, done) => { if (elapsed > 0.6) { Audio.sfx('click'); done(); } } });
}

/** Cumulative standings with animated bars. */
export function standings(app, players, { title = 'STANDINGS', roundIndex = null, total = null } = {}) {
  const max = Math.max(1, ...players.map((p) => p.score));
  const sorted = players.slice().sort((a, b) => b.score - a.score);
  const rows = sorted.map((p, i) => `<div class="stand-row" style="--pc:${p.color}"><span class="rank">${i + 1}</span><span class="nm">${p.name}</span><div class="bar"><div class="fill" style="width:0%" data-w="${(p.score / max) * 100}"></div></div><span class="sc">${p.score}</span></div>`).join('');
  const prog = roundIndex !== null ? `<div class="prog">${t('{a} OF {b} SIMULATIONS COMPLETE', { a: roundIndex + 1, b: total })}</div>` : '';
  const html = `<div class="panel-screen"><h1>${t(title)}</h1>${prog}<div class="stand">${rows}</div><div class="hint">${t('Ⓐ / tap to continue')}</div></div>`;
  let elapsed = 0;
  setTimeout(() => app.overlay.querySelectorAll('.fill').forEach((f) => { f.style.width = `${f.dataset.w}%`; }), 50);
  return runScreen(app, html, (dt, done) => {
    elapsed += dt;
    if (elapsed > 0.8 && (app.input.joinPressed() || elapsed > 6)) { Audio.sfx('click'); done(); }
  }, { cls: 'dim', tapAnywhere: true, onTap: (a, el, done) => { if (elapsed > 0.8) { Audio.sfx('click'); done(); } } });
}

/** End of program: winner released, the rest judged. */
export function finalScreen(app, players, { ceremony = true } = {}) {
  const sorted = players.slice().sort((a, b) => b.score - a.score);
  const top = sorted[0].score;
  const winners = sorted.filter((p) => p.score === top);
  const rows = sorted.map((p, i) => `<tr style="--pc:${p.color}"><td class="place">${ordinal(i + 1)}</td><td class="nm">${p.name}</td><td>${t('{w} wins · {d} deaths', { w: p.history.filter((h) => h.place === 1).length, d: p.deaths })}</td><td class="pts">${p.score}</td></tr>`).join('');
  const verdict = winners.length > 1
    ? t('{names} — TIE. THE FACILITY WILL DECIDE LATER.', { names: winners.map((w) => w.name).join(' & ') })
    : t('{name} HAS PROVEN THEIR WORTH.', { name: winners[0].name });
  const html = `<div class="panel-screen"><h1>${ceremony ? t('FINAL JUDGEMENT') : t('SHIFT COMPLETE')}</h1><h2 class="verdict" style="color:${winners[0].color}">${verdict}</h2><table class="res-table">${rows}</table>
    ${ceremony ? `<p class="small-note">${t('All other subjects will be recycled.')}</p>` : ''}<div>${tapBtn('done', t('RETURN TO TERMINAL'), 'primary')}</div><div class="hint">${t('Ⓐ return to terminal')}</div></div>`;
  Audio.sfx('win');
  // Stage the verdict on the intake pedestals: winners celebrate, the rest cower.
  app.backdrop.mode = 'title';
  for (let i = 0; i < MAX_PLAYERS; i++) {
    const p = players.find((pl) => pl.slot === i);
    app.backdrop.setSlot(i, p ? p.look : null, i + 1);
    if (p) app.backdrop.setPose(i, winners.includes(p) ? 'armsUp' : 'cower');
  }
  let elapsed = 0;
  return runScreen(app, html, (dt, done) => {
    elapsed += dt;
    if (elapsed > 1.2 && app.input.joinPressed()) { Audio.sfx('select'); done(); }
  }, { cls: 'dim', onTap: (a, el, done) => { if (elapsed > 1.2) { Audio.sfx('select'); done(); } } });
}

/** Pause menu shown with ESC during a round. Resolves 'resume' | 'skip' | 'quit'. */
export function pauseScreen(app) {
  const items = [{ id: 'resume', label: t('RESUME') }, { id: 'skip', label: t('SKIP SIMULATION') }, { id: 'quit', label: t('ABORT PROGRAM') }];
  const state = { index: 0 };
  const prev = { cls: app.overlay.className, html: app.overlay.innerHTML };
  const paint = () => app.overlay.querySelectorAll('.menu li').forEach((li, i) => li.classList.toggle('sel', i === state.index));
  const html = `<div class="panel-screen"><h1>${t('PAUSED')}</h1><ul class="menu">${items.map((it, i) => `<li data-tap="${i}">${it.label}</li>`).join('')}</ul></div>`;
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
  // Other languages supply their own placement format via the 'ORDINAL {n}' entry.
  if (getLanguage() !== 'en') return t('ORDINAL {n}', { n });
  const s = ['TH', 'ST', 'ND', 'RD'], v = n % 100;
  return `${n}${s[(v - 20) % 10] || s[v] || s[0]}`;
}
