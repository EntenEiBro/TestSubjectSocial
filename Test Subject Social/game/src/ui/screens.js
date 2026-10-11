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
import { parseRoomCode } from '../net/eos.js';
import { RESOLUTIONS } from '../core/engine.js';
import { Haptics } from '../core/haptics.js';
import { t, tr, LANGUAGES, getLanguage } from '../i18n/i18n.js';
import { tp, pick, keyLabel, fmt } from './prompts.js'; // platform-specific button prompts

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

// ===================================================================== INTRO

/**
 * Startup animation (about 6 s, always plays in full):
 *   1. a facility terminal boots on a black screen,
 *   2. the picture switches on like an old CRT and the intake room's lamps
 *      clank on one by one while subjects drop onto the pedestals,
 *   3. the title is stamped in letter by letter and slammed home.
 */
export function introScreen(app) {
  const ov = app.overlay;
  const status = (label, value, bad = false) => ({ text: `> ${label} ${'.'.repeat(Math.max(3, 24 - label.length))} `, value, bad });
  const lines = [
    { text: t('FACILITY TERMINAL v{v}', { v: '1.0.7' }) },
    status(t('MAINS POWER'), 'OK'),
    status(t('SUBJECT TRACKING'), 'OK'),
    status(t('LETHAL HAZARDS'), t('ARMED')),
    status(t('ETHICS COMMITTEE'), t('NOT FOUND'), true),
    { text: `> ${t('BEGINNING INTAKE')}` },
  ];
  const letters = [...'TEST SUBJECT'].map((ch) => `<span>${ch === ' ' ? '&nbsp;' : ch}</span>`).join('');
  ov.className = 'overlay clear';
  ov.innerHTML = `<div class="intro">
      <div class="intro-black"><div class="intro-term"></div></div>
      <div class="intro-crt"></div>
      <div class="intro-stripe top"></div><div class="intro-stripe bottom"></div>
      <div class="intro-logo"><span class="l1">${letters}</span><span class="l2">SOCIAL</span></div>
      <div class="intro-warn">${t('PARTICIPATION IS MANDATORY')}</div>
    </div>`;
  const root = ov.querySelector('.intro');
  const term = ov.querySelector('.intro-term');
  const $ = (sel) => ov.querySelector(sel);
  // Empty pedestals and a far-away camera: both settle in during the intro.
  app.backdrop.mode = 'title';
  for (let i = 0; i < MAX_PLAYERS; i++) app.backdrop.setSlot(i, null);
  app.backdrop.camera.position.set(0, 7, 21);
  Audio.init(); // the desktop and phone apps may play sound right away; browsers wait for a tap
  Audio.music('none');

  // Terminal typing: total characters typed so far → visible text.
  const CHARS_PER_S = 115;
  const fullLength = lines.reduce((n, l) => n + l.text.length + (l.value ? l.value.length : 0), 0);
  const renderTerm = (count) => {
    let left = count, html = '';
    for (const l of lines) {
      if (left <= 0) break;
      const shown = l.text.slice(0, left); left -= l.text.length;
      let value = '';
      if (l.value && left > 0) { value = l.value.slice(0, left); left -= l.value.length; }
      html += `${esc(shown)}${value ? `<span class="${l.bad ? 'bad' : 'ok'}">${esc(value)}</span>` : ''}\n`;
    }
    term.innerHTML = `${html.replace(/\n$/, '')}<span class="cursor"></span>`;
  };

  const T_CRT = fullLength / CHARS_PER_S + 0.35;
  const cues = [
    [T_CRT, () => { $('.intro-crt').classList.add('on'); $('.intro-black').classList.add('off'); Audio.sfx('whoosh'); Audio.sfx('buzz'); }],
    ...[0, 1, 2, 3].map((i) => [T_CRT + 0.45 + i * 0.26, () => {
      app.backdrop.setSlot(i, new Player(i, 'bot').look, i + 1);
      Audio.sfx('clank');
    }]),
    ...[...'TEST SUBJECT'].map((_, i) => [T_CRT + 1.6 + i * 0.05, () => {
      ov.querySelectorAll('.intro-logo .l1 span')[i].classList.add('in');
      Audio.sfx('chisel', { vol: 0.5 });
    }]),
    [T_CRT + 2.35, () => {
      $('.intro-logo .l2').classList.add('in');
      ov.querySelectorAll('.intro-stripe').forEach((s) => s.classList.add('in'));
      root.classList.add('shake');
      Audio.sfx('sting'); Audio.sfx('explode', { vol: 0.5 });
      app.engine.shake(0.9);
      if (app.touch || app.platform === 'android') Haptics.play('explosion');
    }],
    [T_CRT + 2.7, () => $('.intro-warn').classList.add('in')],
    [T_CRT + 4.3, () => root.classList.add('out')],
  ];
  const END = T_CRT + 4.8;

  return new Promise((resolve) => {
    let time = 0, typed = 0, next = 0;
    ov.onclick = null; // not skippable: taps and buttons do nothing until it ends
    const off = app.onFrame((dt) => {
      time += Math.min(dt, 0.1);
      // Typing, with a soft tick every few characters.
      const count = Math.min(fullLength, Math.floor(time * CHARS_PER_S));
      if (count > typed) {
        if (Math.floor(count / 3) > Math.floor(typed / 3)) Audio.sfx('tick');
        typed = count;
        renderTerm(count);
      }
      while (next < cues.length && time >= cues[next][0]) cues[next++][1]();
      if (time >= END) { off(); resolve(); }
    });
  });
}

// ===================================================================== TITLE

export function titleScreen(app) {
  // Settings entry point depends on the device: phones/tablets get the ⚙ gear
  // in the top-right corner, PCs get a SETTINGS item in the menu.
  const items = [
    { id: 'play', label: t('BEGIN TESTING') },
    { id: 'online', label: t('HOST ONLINE') },
    ...(app.touch ? [] : [{ id: 'options', label: t('SETTINGS') }]),
    { id: 'manual', label: t('FIELD MANUAL') },
    { id: 'commendations', label: t('COMMENDATIONS') },
    { id: 'credits', label: t('CREDITS') },
  ];
  items.splice(2, 0, { id: 'join', label: t('JOIN ONLINE') }); // join a friend's room by code
  if (app.desktop) items.push({ id: 'quit', label: t('QUIT') }); // desktop / phone app only
  const state = { index: 0 };
  // The game's name stays untranslated (it is the brand); everything else is localised.
  const html = `
    <div class="title-wrap">
      <div class="logo"><span class="l1">TEST SUBJECT</span><span class="l2">SOCIAL</span></div>
      <div class="logo-sub">${t('a collection of lethal party games for 2–4 subjects')}</div>
      <ul class="menu">${items.map((it, i) => `<li data-tap="${i}">${it.label}</li>`).join('')}</ul>
      <div class="hint">${pick('Tap an option', '{MOVE} choose · {A} confirm')}</div>
    </div>
    ${app.touch ? `<div class="gear-btn" data-tap="settings" title="${t('SETTINGS')}">⚙</div>` : ''}
    <div class="corner-note">${t('FACILITY TERMINAL v{v} · ALL OUTCOMES FINAL', { v: '1.0.7' })}</div>`;
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
    if (hint) hint.innerHTML = pick('Tap ◂ ▸ to adjust', '{MOVE} adjust · {BACK} back');
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
    </div><div>${tapBtn('back', t('BACK'), 'primary')}</div><div class="hint">${tp('{BACK} back')}</div></div>`;
  return runScreen(app, html, (dt, done) => {
    if (app.input.backPressed() || app.input.joinPressed()) { Audio.sfx('back'); done(); }
  }, { onTap: (action, el, done) => { Audio.sfx('back'); done(); } });
}

/**
 * Online hosting panel: opens an EOS room, shows its code and the connected
 * remote players. Resolves 'play' (go to the lobby) or null.
 */
export function onlineScreen(app) {
  const net = app.net;
  if (net.status === 'offline' || net.status === 'error') net.start();
  const render = () => {
    const el = app.overlay.querySelector('.online-body');
    if (!el) return;
    if (net.status === 'error') { el.innerHTML = `<p class="small-note">${t('ONLINE UNAVAILABLE')} — ${esc(net.error || '?')}</p><p>${t('Check your internet connection and try again.')}</p>`; return; }
    if (net.status !== 'hosting') { el.innerHTML = `<p>${t('Opening a room…')}</p>`; return; }
    const peers = `<div class="online-peers">${t('{n} REMOTE SUBJECT(S) CONNECTED — they join in the lobby with their action button', { n: net.connectedCount })}</div>`;
    el.innerHTML = `<div>${t('ROOM CODE')}</div><div class="online-code">${net.code}</div>
      <div class="online-urls">${t('Friends anywhere choose <b>JOIN ONLINE</b> and type this code (PC or phone).')}</div>${peers}`;
  };
  net.onChange = render;
  const html = `<div class="panel-screen wide"><h1>${t('HOST ONLINE')}</h1><div class="online-body"></div>
    <div>${tapBtn('play', t('CONTINUE TO INTAKE'), 'primary')}${tapBtn('back', t('BACK'))}</div>
    <div class="hint">${tp('{A} continue to intake · {BACK} back (closes the room)')}</div></div>`;
  setTimeout(render, 0);
  const finish = (done, v) => { Audio.sfx(v ? 'select' : 'back'); net.onChange = null; done(v); };
  return runScreen(app, html, (dt, done) => {
    if (app.input.joinPressed() && net.status === 'hosting') finish(done, 'play');
    else if (app.input.backPressed()) finish(done, null);
  }, { onTap: (action, el, done) => { if (action !== 'play' || net.status === 'hosting') finish(done, action === 'play' ? 'play' : null); } });
}

/**
 * JOIN ONLINE: type the host's room code. The page reloads as the online
 * client (?room=CODE, see net/client.js). Resolves null when the player backs out.
 */
export function joinScreen(app) {
  if (app.touch) app.touch.setVisible(false); // free the screen for typing
  const html = `<div class="panel-screen"><h1>${t('JOIN ONLINE')}</h1>
    <p>${t("Type the room code shown on your friend's screen (HOST ONLINE).")}</p>
    <input class="join-input" maxlength="7" placeholder="K7QPXW" autocomplete="off" autocapitalize="characters" spellcheck="false">
    <div class="join-err"></div>
    <div><span class="join-btn" data-act="join">${t('JOIN')}</span><span class="join-btn secondary" data-act="back">${t('BACK')}</span></div>
    <div class="hint">${t('Room codes have 6 letters and digits, e.g. K7QPXW')}</div></div>`;
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
      const code = parseRoomCode(input.value);
      if (!code) { err.textContent = t('That code is not valid — it looks like K7QPXW.'); Audio.sfx('wrong'); return; }
      Audio.sfx('select');
      err.textContent = t('Connecting…');
      location.href = `${location.origin}/?room=${code}`;
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
  const html = `<div class="panel-screen wide"><h1>${t('COMMENDATIONS')}</h1><h3 class="sub">${t('{a} / {b} EARNED', { a: unlocked, b: total })}</h3><ul class="comm-list">${rows}</ul><div>${tapBtn('back', t('BACK'), 'primary')}</div><div class="hint">${tp('{BACK} back')}</div></div>`;
  return runScreen(app, html, (dt, done) => {
    if (app.input.backPressed() || app.input.joinPressed()) { Audio.sfx('back'); done(); }
  }, { onTap: (action, el, done) => { Audio.sfx('back'); done(); } });
}

export function creditsScreen(app) {
  const html = `<div class="panel-screen"><h1>${t('CREDITS')}</h1>
    <p class="credits">${t('An original fan-made homage to the "lethal party game" genre.')}<br><br>
    ${t('Design, code, procedural art & synthesized audio: built from scratch for this project.')}<br>
    ${t('Rendering')}: three.js (MIT). PeerJS (MIT).<br>${t('Fonts')}: Black Ops One, VT323 (SIL OFL), Special Elite (Apache 2.0).<br><br>
    ${t('No subjects were harmed. Officially.')}</p><div>${tapBtn('back', t('BACK'), 'primary')}</div><div class="hint">${tp('{BACK} back')}</div></div>`;
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
        // Always tappable: online players on phones join by tapping a seat too.
        const tapJoin = canTapJoin();
        cards.push(`<div class="slot empty" data-tap="join:${i}"><div class="slot-head">${t('SEAT {n}', { n: i + 1 })}</div>
          <div class="slot-empty">${tapJoin ? t('TAP HERE<br>TO VOLUNTEER') : tp('PRESS {A}<br>TO VOLUNTEER')}</div></div>`);
        continue;
      }
      const ci = cursor.get(p) ?? 0;
      const dev = p.isBot ? t(DEVICE_LABELS.bot.name)
        : p.device.startsWith('pad') ? t('Gamepad {n}', { n: +p.device.slice(3) + 1 })
        : p.device.startsWith('net') ? t('Online player {n}', { n: p.device.slice(3) })
        : t(DEVICE_LABELS[p.device].name);
      const rows = p.isBot ? `<div class="slot-bot">${t('FACILITY UNIT')}<br><small>${t('auto-assigned')}</small></div>` : FIELDS.map((f, fi) => {
        if (f === 'ready') {
          return `<div class="slot-row ${fi === ci ? 'sel' : ''} ${p.ready ? 'ok' : ''}" data-tap="ready:${i}"><span>${t(FIELD_LABEL[f])}</span><b>${p.ready ? `✔ ${t('READY')}` : (p.device === 'touch' ? t('TAP') : keyLabel('A'))}</b></div>`;
        }
        const val = esc(p.lookLabel(f));
        return `<div class="slot-row ${fi === ci ? 'sel' : ''}"><span>${t(FIELD_LABEL[f])}</span><b><span class="tap-arrow" data-tap="dec:${i}:${f}">◂</span> ${val} <span class="tap-arrow" data-tap="inc:${i}:${f}">▸</span></b></div>`;
      }).join('');
      cards.push(`<div class="slot ${p.ready ? 'ready' : ''}" style="--pc:${p.color}"><span class="slot-x" data-tap="leave:${i}">✕</span><div class="slot-head">${p.name}</div><div class="slot-dev">${dev}</div>${rows}</div>`);
    }
    const humans = roster.filter((p) => !p.isBot);
    let status = '';
    if (roster.length < MIN_PLAYERS) status = pick('NEED AT LEAST {n} SUBJECTS — TAP +BOT TO ADD A BOT', 'NEED AT LEAST {n} SUBJECTS — PRESS {ADDBOT} TO ADD A BOT', { n: MIN_PLAYERS });
    else if (humans.some((p) => !p.ready)) status = t('WAITING FOR ALL SUBJECTS TO CONFIRM READY');
    else if (countdown !== null) status = t('PROCEEDING IN {n}', { n: Math.ceil(countdown) });
    const slotsEl = app.overlay.querySelector('.slots');
    if (!slotsEl) return; // overlay was replaced (screen no longer visible)
    slotsEl.innerHTML = cards.join('');
    app.overlay.querySelector('.lobby-status').innerHTML = status; // may contain key caps
  };

  const html = `<div class="lobby"><h1 class="lobby-title">${t('SUBJECT INTAKE')}</h1><div class="slots"></div>
    <div class="lobby-status"></div>
    <div class="lobby-actions">${tapBtn('addbot', t('+ BOT'))}${tapBtn('rembot', t('− BOT'))}${tapBtn('back', t('BACK'))}</div>
    <div class="hint">${tp('JOIN {A} · CUSTOMIZE {MOVE} · LEAVE {B} · ADD BOT {ADDBOT} · REMOVE BOT {REMBOT} · BACK {BACK}')}</div></div>`;
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

  /**
   * Taps forwarded by an online player's phone (net/host.js): join a free
   * seat, or change / ready / leave their own seat — never anyone else's.
   */
  const onRemoteTap = (device, action) => {
    const [kind, slotStr, field] = action.split(':');
    const slot = +slotStr;
    const mine = roster.find((r) => r.device === device);
    if (kind === 'join') {
      if (mine || roster.some((r) => r.slot === slot) || !(slot >= 0 && slot < MAX_PLAYERS)) return;
      const np = new Player(slot, device); roster.push(np); cursor.set(np, 0); Audio.sfx('join');
    } else if (!mine || mine.slot !== slot) {
      return;
    } else if (kind === 'leave') {
      roster.splice(roster.indexOf(mine), 1); app.backdrop.setSlot(mine.slot, null); Audio.sfx('back');
    } else if (kind === 'ready') {
      mine.ready = !mine.ready; cursor.set(mine, FIELDS.length - 1);
      Audio.sfx(mine.ready ? 'select' : 'back'); app.backdrop.setPose(mine.slot, mine.ready ? 'armsUp' : 'idle');
    } else if ((kind === 'dec' || kind === 'inc') && !mine.ready && FIELDS.includes(field) && field !== 'ready') {
      mine.cycle(field, kind === 'inc' ? 1 : -1); cursor.set(mine, FIELDS.indexOf(field)); Audio.sfx('click');
    } else {
      return;
    }
    refreshBackdrop(); render();
  };
  app.remoteTap = onRemoteTap;

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
  }, { onTap }).finally(() => { if (app.remoteTap === onRemoteTap) app.remoteTap = null; });
}

// =============================================================== MODE SELECT

export function modeScreen(app, registryCount = 30) {
  const items = [
    { id: 'original', label: t('FULL PROGRAM'), desc: t('{n} random simulations out of {total}, with orientation and final judgement.', { n: 15, total: registryCount }) },
    { id: 'arcade', label: t('QUICK SHIFT'), desc: t('10 random simulations. No orientation, no ceremony.') },
    { id: 'custom', label: t('CUSTOM PLAYLIST'), desc: t('Pick exactly which simulations to run, in random order.') },
  ];
  const state = { index: 0 };
  const paint = () => app.overlay.querySelectorAll('.mode-card').forEach((el, i) => el.classList.toggle('sel', i === state.index));
  const html = `<div class="panel-screen wide"><h1>${t('SELECT PROGRAM')}</h1><div class="mode-cards">${items.map((it, i) => `<div class="mode-card" data-tap="${i}"><h2>${it.label}</h2><p>${it.desc}</p></div>`).join('')}</div>
    <div>${tapBtn('back', t('BACK'))}</div><div class="hint">${tp('{MOVE} choose · {A} confirm · {BACK} back')}</div></div>`;
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

/** Toggle grid of simulations. Resolves with { ids, shuffle: true } or null (always played in random order). */
export function customScreen(app, registry) {
  const sel = new Set(app.lastCustom || registry.map((G) => G.meta.id));
  const state = { index: 0 };
  const cols = 5;
  const total = registry.length + 1; // + start
  const render = () => {
    const gridEl = app.overlay.querySelector('.pl-grid');
    if (!gridEl) return;
    gridEl.innerHTML = registry.map((G, i) => `<div class="pl-card ${sel.has(G.meta.id) ? 'on' : ''} ${state.index === i ? 'sel' : ''}" data-tap="${i}"><span class="num">${String(i + 1).padStart(2, '0')}</span><b>${t(G.meta.title)}</b><small>${t(G.meta.category)}</small></div>`).join('');
    app.overlay.querySelector('.pl-actions').innerHTML = `<div class="pl-btn ${state.index === registry.length ? 'sel' : ''} ${sel.size ? '' : 'disabled'}" data-tap="${registry.length}">${t('START')} (${sel.size})</div><div class="pl-btn" data-tap="back">${t('BACK')}</div>`;
  };
  const html = `<div class="panel-screen wide"><h1>${t('CUSTOM PLAYLIST')}</h1><div class="pl-grid"></div><div class="pl-actions"></div><div class="hint">${tp('{MOVE} move · {A} toggle · {BACK} back')}</div></div>`;
  setTimeout(render, 0);
  /** Activate grid entry / start at index i. Returns the result when starting. */
  const activate = (i) => {
    if (i < registry.length) { const id = registry[i].meta.id; if (sel.has(id)) sel.delete(id); else sel.add(id); Audio.sfx('click'); }
    else if (sel.size) { Audio.sfx('select'); app.lastCustom = [...sel]; return { ids: registry.map((G) => G.meta.id).filter((id) => sel.has(id)), shuffle: true }; }
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
    <div>${tapBtn('skip', t('SKIP'))}</div><div class="hint">${pick('Tap to continue', '{A} continue · {BACK} skip')}</div></div>`;
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

// Animations on these screens are driven frame by frame from JavaScript
// (inline styles), not CSS transitions: online players see the host's menus
// as HTML snapshots, and only per-frame values survive being re-rendered.
const easeOutCubic = (x) => 1 - (1 - Math.min(1, Math.max(0, x))) ** 3;
const easeOutBack = (x) => { x = Math.min(1, Math.max(0, x)); const c = 1.7; return 1 + (c + 1) * (x - 1) ** 3 + c * (x - 1) ** 2; };

/**
 * NEXT-SIMULATION ROULETTE: a reel of simulation cards spins, slows down and
 * stops on the one that will be played next (decided by the program list).
 */
export function roulette(app, G, index, total, registry) {
  const CARD_W = 30;            // card width in --u units (incl. gap)
  const SPIN_S = 3.0;           // reel spin duration
  const others = registry.filter((R) => R !== G);
  // A long strip of random cards ending with the chosen one (cosmetic randomness).
  const strip = [];
  for (let i = 0; i < 26; i++) strip.push(others[Math.floor(Math.random() * others.length)] || G);
  strip.push(G);
  for (let i = 0; i < 3; i++) strip.push(others[Math.floor(Math.random() * others.length)] || G);
  const target = 26;
  const card = (R, i) => `<div class="rl-card${i === target ? ' rl-target' : ''}"><small>${t(R.meta.category).toUpperCase()}</small><b>${t(R.meta.title)}</b></div>`;
  const html = `<div class="roulette">
      <div class="rl-head">${t('SIMULATION {a} / {b}', { a: String(index + 1).padStart(2, '0'), b: String(total).padStart(2, '0') })}</div>
      <h1 class="rl-title">${t('SELECTING NEXT SIMULATION')}</h1>
      <div class="rl-window"><div class="rl-strip">${strip.map(card).join('')}</div><div class="rl-marker"></div></div>
      <div class="rl-chosen"></div>
    </div>`;
  let time = 0, lastCard = -1, landed = false, stripEl = null, chosenEl = null;
  // Reel offset (in --u) that centres card i in the window.
  const offsetFor = (pos) => -(pos * CARD_W);
  return runScreen(app, html, (dt, done) => {
    time += Math.min(dt, 0.1);
    stripEl = stripEl || app.overlay.querySelector('.rl-strip');
    chosenEl = chosenEl || app.overlay.querySelector('.rl-chosen');
    if (!stripEl) return;
    const k = easeOutCubic(time / SPIN_S);
    const pos = k * target;
    stripEl.style.transform = `translateX(calc(var(--u) * ${offsetFor(pos).toFixed(2)}))`;
    const passing = Math.round(pos);
    if (passing !== lastCard) { lastCard = passing; if (!landed) Audio.sfx('tick'); }
    if (!landed && time >= SPIN_S) {
      landed = true;
      app.overlay.querySelector('.rl-target').classList.add('on');
      chosenEl.innerHTML = `<span>${t('SELECTED')}</span>`;
      Audio.sfx('clank'); Audio.sfx('sting');
      app.engine.shake(0.4);
    }
    if (landed) {
      const s = easeOutBack((time - SPIN_S) / 0.35);
      chosenEl.style.transform = `scale(${(2.2 - 1.2 * s).toFixed(3)})`;
      chosenEl.style.opacity = String(Math.min(1, (time - SPIN_S) / 0.15));
    }
    if (time >= SPIN_S + 1.3) done();
  }, { cls: 'card' });
}

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
  // Controls table: first column names the button, last column shows the
  // key caps for the device the player is using right now.
  const ctlIcon = { move: t('MOVE'), a: 'Ⓐ', b: 'Ⓑ' };
  const ctlKeys = { move: keyLabel('MOVE'), a: keyLabel('A'), b: keyLabel('B') };
  const render = () => {
    const m = G.meta;
    const body = page === 0
      ? `<h2>${t('CONTROLS')}</h2><table class="brief-ctl">${m.controls.map((c) => `<tr><td class="key">${ctlIcon[c.input] || c.input}</td><td>${esc(t(c.label))}</td><td class="keys">${ctlKeys[c.input] || ''}</td></tr>`).join('')}</table>`
      : `<h2>${t('OBJECTIVE')}</h2><p class="objective">${fmt(esc(t(m.objective)))}</p>${(m.rules || []).length ? `<ul class="rules">${m.rules.map((r) => `<li>${fmt(esc(t(r)))}</li>`).join('')}</ul>` : ''}`;
    const chips = seats.map((s) => `<span class="chip ${ready.has(s.player.id) ? 'ok' : ''}" style="--pc:${s.player.color}">${s.player.name}${ready.has(s.player.id) ? ' ✔' : ''}</span>`).join('');
    const buttons = page === 0
      ? tapBtn('next', t('NEXT PAGE'), 'primary')
      : `${tapBtn('back', t('PREVIOUS'))}${tapBtn('ready', t("I'M READY"), 'primary')}`;
    app.overlay.innerHTML = `<div class="brief"><div class="brief-head"><span>${t(m.category).toUpperCase()}</span><h1>${t(m.title)}</h1><span class="page">${t('PAGE {a}/{b}', { a: page + 1, b: 2 })}</span></div><div class="brief-body">${body}</div>
      <div class="brief-foot">${page === 0 ? '' : `<div class="chips">${chips}</div>`}<div>${buttons}</div>
      <div class="hint">${page === 0 ? tp('{A} NEXT PAGE') : tp('EVERY SUBJECT PRESS {A} WHEN READY · {B} PREVIOUS PAGE')}</div></div></div>`;
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
        // An online player whose connection dropped can't press anything: don't wait for them.
        if (s.player.device.startsWith('net') && !app.net.isLive(s.player.device) && !ready.has(s.player.id)) {
          ready.add(s.player.id); dirty = true;
        }
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
  const html = `<div class="panel-screen"><h1>${t(G.meta.title)}</h1><h3 class="sub">${t('SIMULATION REPORT')}</h3><table class="res-table">${rows}</table><div class="hint">${pick('Tap to continue', '{A} continue')}</div></div>`;
  let elapsed = 0;
  return runScreen(app, html, (dt, done) => {
    elapsed += dt;
    if (elapsed > 0.6 && (app.input.joinPressed() || elapsed > 7)) { Audio.sfx('click'); done(); }
  }, { cls: 'dim', tapAnywhere: true, onTap: (a, el, done) => { if (elapsed > 0.6) { Audio.sfx('click'); done(); } } });
}

/**
 * After every round: the round's points are handed out one subject at a time
 * (last place first, winner last), counted onto the standings bars, then the
 * rows slide into the new order and the leader is crowned.
 * `results` = [{player, place, points, died}] or null (skipped round).
 */
export function pointsScreen(app, players, results, { game = null, roundIndex = null, total = null } = {}) {
  const ROW = 9; // row height in --u
  const byPlayer = new Map((results || []).map((r) => [r.player, r]));
  const gained = (p) => (byPlayer.get(p) ? byPlayer.get(p).points : 0);
  const prevScore = (p) => p.score - gained(p);
  // Stable sorts: previous standings first, then the order after this round.
  const before = players.slice().sort((a, b) => prevScore(b) - prevScore(a) || a.slot - b.slot);
  const after = before.slice().sort((a, b) => b.score - a.score);
  const maxScore = Math.max(1, ...players.map((p) => p.score));
  // Hand out points from the worst placement up to the winner (suspense).
  const awards = (results || []).slice().sort((a, b) => b.place - a.place);
  const STEP = 0.8, T_AWARD = 0.6, T_SORT = T_AWARD + awards.length * STEP + 0.3, T_DONE = T_SORT + 0.8;

  const rowHtml = (p, i) => {
    const r = byPlayer.get(p);
    const badge = r ? `<span class="pt-place ${r.died ? 'died' : ''}">${r.died ? '✖ ' : ''}${ordinal(r.place)}</span>` : '<span class="pt-place"></span>';
    return `<div class="pt-row" data-slot="${p.slot}" style="--pc:${p.color};top:calc(var(--u) * ${i * ROW})">
      <span class="rank">${i + 1}</span><span class="nm">${p.name}</span>${badge}
      <div class="bar"><div class="fill" style="width:${(prevScore(p) / maxScore) * 100}%"></div></div>
      <span class="sc">${prevScore(p)}</span><span class="pt-gain">+${gained(p)}</span><span class="pt-crown"></span></div>`;
  };
  const prog = roundIndex !== null ? `<div class="prog">${t('{a} OF {b} SIMULATIONS COMPLETE', { a: roundIndex + 1, b: total })}</div>` : '';
  const html = `<div class="panel-screen wide pt-screen"><h1>${t('SIMULATION REPORT')}</h1>${game ? `<h3 class="sub">${t(game.meta.title)}</h3>` : ''}${prog}
    <div class="pt-board" style="height:calc(var(--u) * ${players.length * ROW})">${before.map(rowHtml).join('')}</div>
    <div class="hint pt-hint" style="opacity:0">${pick('Tap to continue', '{A} continue')}</div></div>`;

  let time = 0, step = -1, crowned = false, sorted = false, els = null, skipped = false;
  const rowOf = (p) => els.rows.get(p.slot);
  const finishAll = () => { skipped = true; time = Math.max(time, T_DONE); };
  const sfx = (name) => { if (!skipped) Audio.sfx(name); }; // no sound burst when skipping ahead
  return runScreen(app, html, (dt, done) => {
    if (!els) {
      const rows = new Map([...app.overlay.querySelectorAll('.pt-row')].map((el) => [+el.dataset.slot, el]));
      if (!rows.size) return;
      els = { rows, hint: app.overlay.querySelector('.pt-hint') };
    }
    time += Math.min(dt, 0.1);
    // Rows slide in.
    before.forEach((p, i) => {
      const k = easeOutCubic((time - i * 0.08) / 0.45);
      rowOf(p).style.opacity = String(k);
      if (!sorted) rowOf(p).style.transform = `translateX(calc(var(--u) * ${((1 - k) * 12).toFixed(2)}))`;
    });
    // Awards, one subject at a time.
    awards.forEach((r, i) => {
      const t0 = T_AWARD + i * STEP, el = rowOf(r.player);
      const local = time - t0;
      const gain = el.querySelector('.pt-gain');
      if (local < 0) { gain.style.opacity = '0'; return; }
      if (i > step) {
        step = i;
        sfx(r.points === 0 ? 'back' : r.place === 1 ? 'select' : 'click');
        el.querySelector('.pt-place').style.opacity = '1';
      }
      // "+N" pops in, then floats toward the score while the score counts up.
      const pop = easeOutBack(local / 0.25);
      const fly = easeOutCubic((local - 0.3) / 0.4);
      gain.style.opacity = String(local < 0.3 ? 1 : 1 - fly);
      gain.style.transform = `translateX(calc(var(--u) * ${(-fly * 6).toFixed(2)})) scale(${(0.4 + 0.6 * pop).toFixed(3)})`;
      const shown = Math.round(prevScore(r.player) + r.points * easeOutCubic((local - 0.25) / 0.45));
      const sc = el.querySelector('.sc');
      if (sc.textContent !== String(shown)) { sc.textContent = String(shown); if (r.points) sfx('tick'); }
      el.querySelector('.fill').style.width = `${(shown / maxScore) * 100}%`;
      el.classList.toggle('pt-hot', local < 0.7 && r.points > 0);
    });
    // Re-sort into the new standings.
    if (time >= T_SORT) {
      sorted = true;
      const k = easeOutCubic((time - T_SORT) / 0.6);
      before.forEach((p, i) => {
        const j = after.indexOf(p);
        rowOf(p).style.transform = `translateY(calc(var(--u) * ${((j - i) * ROW * k).toFixed(2)}))`;
        rowOf(p).querySelector('.rank').textContent = String((k > 0.5 ? j : i) + 1);
        rowOf(p).querySelector('.sc').textContent = String(p.score);
        rowOf(p).querySelector('.fill').style.width = `${(p.score / maxScore) * 100}%`;
      });
    }
    if (time >= T_SORT + 0.6 && !crowned) {
      crowned = true;
      const top = after[0].score;
      if (top > 0) for (const p of after.filter((q) => q.score === top)) { rowOf(p).classList.add('lead'); rowOf(p).querySelector('.pt-crown').textContent = '♛'; }
      sfx('ding');
    }
    els.hint.style.opacity = time >= T_DONE ? '1' : '0';
    // A press during the animation skips to the end; after it, continues.
    if (app.input.joinPressed()) { if (time < T_DONE) finishAll(); else { Audio.sfx('click'); done(); return; } }
    if (time > T_DONE + 6) done();
  }, { cls: 'dim', tapAnywhere: true, onTap: (a, el, done) => { if (time < T_DONE) finishAll(); else { Audio.sfx('click'); done(); } } });
}

/** Cumulative standings with animated bars. */
export function standings(app, players, { title = 'STANDINGS', roundIndex = null, total = null } = {}) {
  const max = Math.max(1, ...players.map((p) => p.score));
  const sorted = players.slice().sort((a, b) => b.score - a.score);
  const rows = sorted.map((p, i) => `<div class="stand-row" style="--pc:${p.color}"><span class="rank">${i + 1}</span><span class="nm">${p.name}</span><div class="bar"><div class="fill" style="width:0%" data-w="${(p.score / max) * 100}"></div></div><span class="sc">${p.score}</span></div>`).join('');
  const prog = roundIndex !== null ? `<div class="prog">${t('{a} OF {b} SIMULATIONS COMPLETE', { a: roundIndex + 1, b: total })}</div>` : '';
  const html = `<div class="panel-screen"><h1>${t(title)}</h1>${prog}<div class="stand">${rows}</div><div class="hint">${pick('Tap to continue', '{A} continue')}</div></div>`;
  let elapsed = 0;
  setTimeout(() => app.overlay.querySelectorAll('.fill').forEach((f) => { f.style.width = `${f.dataset.w}%`; }), 50);
  return runScreen(app, html, (dt, done) => {
    elapsed += dt;
    if (elapsed > 0.8 && (app.input.joinPressed() || elapsed > 6)) { Audio.sfx('click'); done(); }
  }, { cls: 'dim', tapAnywhere: true, onTap: (a, el, done) => { if (elapsed > 0.8) { Audio.sfx('click'); done(); } } });
}

/**
 * End of program — the winner ceremony:
 *   1. lights out, drumroll, a spotlight sweeps across the pedestals…
 *   2. …and stops on the winner: WINNER stamp, confetti, their pedestal rises,
 *   3. everyone else sinks through the floor ("recycled"),
 *   4. the final table appears.
 */
export function finalScreen(app, players, { ceremony = true } = {}) {
  const sorted = players.slice().sort((a, b) => b.score - a.score);
  const top = sorted[0].score;
  const winners = sorted.filter((p) => p.score === top);
  const rows = sorted.map((p, i) => `<tr style="--pc:${p.color}"><td class="place">${ordinal(i + 1)}</td><td class="nm">${p.name}</td><td>${t('{w} wins · {d} deaths', { w: p.history.filter((h) => h.place === 1).length, d: p.deaths })}</td><td class="pts">${p.score}</td></tr>`).join('');
  const verdict = winners.length > 1
    ? t('{names} — TIE. THE FACILITY WILL DECIDE LATER.', { names: winners.map((w) => w.name).join(' & ') })
    : t('{name} HAS PROVEN THEIR WORTH.', { name: winners[0].name });
  const html = `<div class="fin">
      <div class="fin-drum">${t('AND THE SURVIVING SUBJECT IS…')}</div>
      <div class="fin-win" style="--pc:${winners[0].color}"><span class="fin-label">${winners.length > 1 ? t('TIE') : t('WINNER')}</span><span class="fin-name">${winners.map((w) => w.name).join(' & ')}</span></div>
      <div class="panel-screen fin-table" style="opacity:0"><h1>${ceremony ? t('FINAL JUDGEMENT') : t('SHIFT COMPLETE')}</h1><h2 class="verdict" style="color:${winners[0].color}">${verdict}</h2><table class="res-table">${rows}</table>
        ${ceremony ? `<p class="small-note">${t('All other subjects will be recycled.')}</p>` : ''}<div>${tapBtn('done', t('RETURN TO TERMINAL'), 'primary')}</div><div class="hint">${tp('{A} return to terminal')}</div></div>
    </div>`;
  // Stage everyone on the intake pedestals, lights down.
  const bd = app.backdrop;
  bd.mode = 'title';
  bd.resetCeremony();
  const occupied = [];
  for (let i = 0; i < MAX_PLAYERS; i++) {
    const p = players.find((pl) => pl.slot === i);
    bd.setSlot(i, p ? p.look : null, i + 1);
    if (p) { occupied.push(i); bd.setPose(i, 'idle'); }
  }
  const winSlots = winners.map((w) => w.slot);
  bd.setSpotlight([]);
  Audio.music('none');

  const T_REVEAL = 3.2, T_SINK = T_REVEAL + 1.1, T_TABLE = T_REVEAL + 2.6;
  let time = 0, revealed = false, sunk = false, tableShown = false, nextBeat = 0, sweep = 0, els = null;
  return runScreen(app, html, (dt, done) => {
    if (!els) {
      els = { drum: app.overlay.querySelector('.fin-drum'), win: app.overlay.querySelector('.fin-win'), table: app.overlay.querySelector('.fin-table') };
      if (!els.drum) { els = null; return; }
    }
    time += Math.min(dt, 0.1);
    if (!revealed) {
      // Drumroll that speeds up, while the spotlight hops from pedestal to pedestal (slowing down).
      els.drum.style.opacity = String(Math.min(1, time / 0.4));
      if (time >= nextBeat) { Audio.sfx('tick'); nextBeat = time + Math.max(0.045, 0.16 - time * 0.04); }
      const hop = 0.12 + (time / T_REVEAL) ** 2 * 0.5;
      sweep += dt / hop;
      if (occupied.length) bd.setSpotlight([occupied[Math.floor(sweep) % occupied.length]]);
      if (time >= T_REVEAL) {
        revealed = true;
        bd.setSpotlight(winSlots);
        winSlots.forEach((s) => { bd.setPose(s, 'armsUp'); bd.setLift(s, 0.9); bd.burstConfetti(s); });
        occupied.filter((s) => !winSlots.includes(s)).forEach((s) => bd.setPose(s, 'cower'));
        Audio.sfx('sting'); Audio.sfx('win'); Audio.sfx('explode', { vol: 0.4 });
        app.engine.shake(0.7);
        if (app.touch || app.platform === 'android') Haptics.play('win');
      }
    }
    if (revealed) {
      // WINNER stamp: slams in big, settles.
      const k = easeOutBack((time - T_REVEAL) / 0.4);
      els.drum.style.opacity = String(Math.max(0, 1 - (time - T_REVEAL) / 0.3));
      els.win.style.opacity = String(Math.min(1, (time - T_REVEAL) / 0.12));
      const lift = tableShown ? easeOutCubic((time - T_TABLE) / 0.5) : 0;
      // When the table appears the stamp moves up and shrinks to make room.
      els.win.style.transform = `translate(-50%, calc(-50% - var(--u) * ${(lift * 19).toFixed(2)})) scale(${((3 - 2 * k) * (1 - 0.5 * lift)).toFixed(3)}) rotate(-3deg)`;
    }
    if (revealed && !sunk && time >= T_SINK) {
      sunk = true;
      // The rest are recycled: their pedestals sink through the floor.
      occupied.filter((s) => !winSlots.includes(s)).forEach((s) => bd.setLift(s, -3.2));
      if (occupied.length > winSlots.length) Audio.sfx('grind');
    }
    if (time >= T_TABLE) {
      tableShown = true;
      const k = easeOutCubic((time - T_TABLE) / 0.5);
      els.table.style.opacity = String(k);
      els.table.style.transform = `translateY(calc(var(--u) * ${((1 - k) * 8).toFixed(2)}))`;
    }
    if (time > T_TABLE + 0.6 && app.input.joinPressed()) { Audio.sfx('select'); bd.resetCeremony(); done(); }
  }, { cls: 'clear', onTap: (a, el, done) => { if (time > T_TABLE + 0.6) { Audio.sfx('select'); bd.resetCeremony(); done(); } } });
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
