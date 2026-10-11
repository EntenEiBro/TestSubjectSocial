/**
 * client.js — the remote-player side of online play (EOS, see eos.js).
 *
 * JOIN ONLINE reloads the page as `index.html?room=CODE`. The client finds
 * the host's EOS lobby by its code and talks to the host peer-to-peer.
 *
 * Rounds run on this device: the host sends the round's seed and then its
 * lockstep input frames, and remoteround.js simulates and renders the round
 * locally. Between rounds this device draws its own intake-room backdrop
 * (the host says who stands on the pedestals) and mirrors the host's menus
 * as HTML snapshots and sounds as event names for the local synthesizer.
 * This device's controls go to the host about 120 times per second. Any
 * local device works (left keyboard, right keyboard, a gamepad, or the
 * on-screen touch controls on phones); they are merged into one controller.
 *
 * If the connection drops, the client keeps knocking. A session token tells
 * the host it is the same player, so they get their seat back.
 */
import { Audio } from '../core/audio.js';
import { Engine } from '../core/engine.js';
import { FXSettings } from '../core/fx.js';
import { InputManager } from '../core/input.js';
import { Backdrop } from '../ui/backdrop.js';
import { TouchControls, isTouchDevice } from '../ui/touch.js';
import { Haptics } from '../core/haptics.js';
import { t, setLanguage, LANGUAGES } from '../i18n/i18n.js';
import { tp, initInputMode } from '../ui/prompts.js';
import { RemoteRound } from './remoteround.js';
import { PROTOCOL } from './lockstep.js';
import { Net, CH, MODE } from './eos.js';

const SEND_MS = 8;            // controller sampling interval
const HEARTBEAT_MS = 100;     // resend the controller state at least this often
const REPEAT = 2;             // extra copies of every change (input packets may get lost)
const PING_MS = 1000;
const HELLO_RETRY_MS = 3000;  // knock again while the host hasn't answered
const FIRST_CONTACT_MS = 30000;
const SILENT_MS = 4000;       // nothing from the host this long = connection lost
const GIVE_UP_MS = 60000;     // …and this long = give up
const NOT_FOUND = 18;         // EOS_NotFound
const JOIN_TRIES = 5;         // room searches before "does not exist" (new rooms take a moment to appear)

function loadSettings() {
  try { return JSON.parse(localStorage.getItem('tss.settings.v1') || '{}'); } catch (_) { return {}; }
}

/** Use this device's saved language (or its system language) for the client's own messages. */
function initLanguage(settings) {
  let lang = settings.lang;
  if (!lang) lang = (navigator.language || 'en').slice(0, 2).toLowerCase();
  setLanguage(LANGUAGES.some((l) => l.code === lang) ? lang : 'en');
}

/** Stable per-tab player token, so reconnects (and reloads) reclaim the same seat. */
function sessionToken(code) {
  const key = `tss.net.token.${code}`;
  let token = null;
  try { token = sessionStorage.getItem(key); } catch (_) { /* no storage */ }
  if (!token) {
    token = Math.random().toString(36).slice(2) + Date.now().toString(36);
    try { sessionStorage.setItem(key, token); } catch (_) { /* no storage */ }
  }
  return token;
}

/** Join the room `code` and play as a remote subject until the room closes or the player leaves. */
export async function runOnlineClient(code) {
  const settings = loadSettings();
  initLanguage(settings);
  const touch = isTouchDevice();
  initInputMode(touch);
  const stage = document.getElementById('stage');
  const canvas = document.getElementById('view');
  const overlay = document.getElementById('overlay');
  const hudEl = document.getElementById('hud');
  if (touch) stage.classList.add('touch-ui');

  // Sound and graphics follow this device's own settings.
  FXSettings.gore = settings.gore === false ? 0.25 : 1;
  Audio.setVolume('master', settings.master ?? 0.8);
  Audio.setVolume('music', settings.music ?? 0.5);
  Audio.setVolume('sfx', settings.sfx ?? 0.9);
  Haptics.level = settings.hapticLevel ?? 3;
  document.addEventListener('visibilitychange', () => (document.hidden ? Audio.suspend() : Audio.resume()));
  window.__onAppPause = () => Audio.suspend();
  window.__onAppResume = () => Audio.resume();

  // Our own engine: the intake room between rounds, our copy of the round during one.
  const engine = new Engine(canvas, { renderHeight: settings.resHeight || 1080 });
  const backdrop = new Backdrop();
  const showBackdrop = () => engine.setScene(backdrop.scene, backdrop.camera);
  showBackdrop();

  const status = (title, body = '') => {
    overlay.className = 'overlay dim';
    overlay.innerHTML = `<div class="panel-screen"><h1>${title}</h1><p>${body}</p>
      <div><span class="tap-btn primary" data-tap="client:leave">${t('BACK TO MAIN MENU')}</span></div>
      <div class="hint">${t('ROOM CODE')} ${code} · ${tp('{BACK} leave')}</div></div>`;
    hudEl.className = 'hidden';
  };

  const input = new InputManager();
  ['kb1', 'kb2', 'pad0', 'pad1', 'pad2', 'pad3'].forEach((d) => input.controller(d));
  // Phones: in the host's menus only Ⓐ/Ⓑ (join, ready); the joystick appears
  // when a round starts. Vibration follows the host's sound effects.
  let touchCtl = null;
  if (touch) {
    touchCtl = new TouchControls(input, { pause: false }); // pausing is the host's call
    touchCtl.setContext('menu');
    Audio.onHaptic = (name) => Haptics.fromSfx(name);
  }

  let host = null;
  const sendCtrl = (m) => { if (host) Net.send(host, CH.CTRL, MODE.ORDERED, m); };

  // Small status line (top-left): ping, and a warning if our copy of a round went out of sync.
  const netInfo = document.createElement('div');
  netInfo.className = 'net-ping hidden';
  stage.appendChild(netInfo);
  let ping = null, desynced = false;
  const showPing = () => {
    netInfo.classList.toggle('hidden', ping === null);
    netInfo.classList.toggle('bad', desynced || (ping !== null && ping > 150));
    netInfo.textContent = ping === null ? '' : `PING ${ping} ms${desynced ? ` · ${t('OUT OF SYNC')}` : ''}`;
  };

  const round = new RemoteRound({
    engine, input, touch, hudEl,
    onEnd: () => { showBackdrop(); if (touchCtl && !finished) touchCtl.setContext('menu'); },
    onSync: (d) => { desynced = d; showPing(); },
    send: sendCtrl,
  });
  window.__round = round; // handy for debugging in the console
  engine.start((dt) => { if (round.active) round.update(dt); else backdrop.update(dt); });

  // Leaving: BACK / Esc twice (the phone's back button sends Esc) returns to our own game.
  let leaving = false, backArmed = 0;
  const leave = () => {
    if (leaving) return;
    leaving = true;
    sendCtrl({ t: 'bye' });
    Net.stop();
    setTimeout(() => { location.href = `${location.origin}/`; }, 150);
  };
  const leaveHint = document.createElement('div');
  leaveHint.className = 'net-badge hidden';
  stage.appendChild(leaveHint);
  window.addEventListener('keydown', (e) => {
    if (e.code !== 'Escape') return;
    const now = performance.now();
    if (finished || now - backArmed < 2500) { leave(); return; }
    backArmed = now;
    leaveHint.textContent = t('PRESS BACK AGAIN TO LEAVE THE ROOM');
    leaveHint.classList.remove('hidden', 'fade');
    setTimeout(() => leaveHint.classList.add('fade'), 1800);
  });
  window.addEventListener('pagehide', () => { if (!leaving) { sendCtrl({ t: 'bye' }); Net.flush(); } });

  // Taps on the mirrored menus go to the host (lobby: join a seat, customize,
  // ready up, leave the seat); our own status screens have a leave button.
  overlay.addEventListener('click', (e) => {
    const el = e.target.closest('[data-tap]');
    if (!el) return;
    if (el.dataset.tap === 'client:leave') { leave(); return; }
    if (host && welcomed && !finished && !round.active) sendCtrl({ t: 'tap', a: el.dataset.tap });
  });

  // Controller loop: merge every local device into one remote controller and
  // send it on change (plus REPEAT copies) and as a heartbeat. Packets carry a
  // sequence number so the host can ignore ones that arrive late (the channel
  // is unreliable), and A/B press counters so it can recover lost presses.
  let seq = 0, last = '', lastSent = 0, repeat = 0;
  let pressA = 0, pressB = 0, prevA = false, prevB = false;
  let lastPing = 0, welcomed = false, finished = false;
  setInterval(() => {
    input.update();
    let x = 0, y = 0, a = false, b = false;
    for (const c of input.controllers.values()) {
      if (Math.abs(c.moveX) > Math.abs(x)) x = c.moveX;
      if (Math.abs(c.moveY) > Math.abs(y)) y = c.moveY;
      a = a || c.a; b = b || c.b;
    }
    input.endFrame();
    if (a && !prevA) pressA++;
    if (b && !prevB) pressB++;
    prevA = a; prevB = b;
    if (finished && pressA > finishPress) { leave(); return; } // Ⓐ / F / Enter = BACK TO MAIN MENU
    if (!host || !welcomed || finished) return;
    const now = performance.now();
    if (now - lastPing > PING_MS) { lastPing = now; Net.send(host, CH.INPUT, MODE.UNRELIABLE, { t: 'ping', c: now, r: ping }); }
    const state = `${x.toFixed(2)},${y.toFixed(2)},${a},${b}`;
    if (state !== last) repeat = REPEAT + 1;
    else if (repeat <= 0 && now - lastSent < HEARTBEAT_MS) return;
    Net.send(host, CH.INPUT, MODE.UNRELIABLE, { s: ++seq, x: +x.toFixed(2), y: +y.toFixed(2), a, b, pa: pressA, pb: pressB });
    repeat--;
    last = state; lastSent = now;
  }, SEND_MS);

  // ------------------------------------------------------------- connecting
  let finishPress = 0;
  const finish = (title, body) => {
    finished = true;
    finishPress = pressA;
    round.end();
    if (touchCtl) touchCtl.setContext(null); // only the BACK TO MAIN MENU button now
    status(title, body);
    Net.stop();
  };
  status(t('CONNECTING'), t('Contacting the facility…'));
  try {
    await Net.ready();
    // A room that was opened moments ago may not be searchable yet: ask again a few times.
    for (let attempt = 1; !host; attempt++) {
      try {
        host = await Net.join(code);
      } catch (e) {
        if (e.code !== NOT_FOUND || attempt >= JOIN_TRIES || leaving) throw e;
        await new Promise((r) => setTimeout(r, 1500));
      }
    }
  } catch (e) {
    if (e.code === NOT_FOUND) finish(t('NO CONNECTION'), t('Room {code} does not exist.', { code }));
    else finish(t('NO CONNECTION'), e.message === 'timeout' ? t('The online service is not reachable.') : e.message);
    return;
  }
  status(t('CONNECTING'), t('Linking up with the host…'));
  const token = sessionToken(code);
  let helloAt = 0, lastHeard = performance.now(), firstAt = performance.now(), badgeShown = false;
  const hello = () => { helloAt = performance.now(); sendCtrl({ t: 'hello', token, v: PROTOCOL }); };
  hello();

  Net.on('msg', (e) => {
    if (e.peer !== host || finished) return;
    let m;
    try { m = JSON.parse(e.data); } catch (_) { return; }
    lastHeard = performance.now();
    if (e.ch === CH.FRAMES) { round.frames(m); return; }
    if (m.t === 'pong') { ping = Math.round(performance.now() - m.c); showPing(); return; }
    switch (m.t) {
      case 'hello':
        welcomed = true;
        last = ''; // resend our controller state right away
        if (!badgeShown) {
          badgeShown = true;
          const badge = document.createElement('div');
          badge.className = 'net-badge';
          badge.innerHTML = tp('ONLINE · PLAYER {n} · PRESS {A} IN THE LOBBY TO JOIN', { n: m.n ?? m.id });
          stage.appendChild(badge);
          setTimeout(() => badge.classList.add('fade'), 6000);
        }
        applyUI(m);
        break;
      case 'ui': applyUI(m); break;
      case 'audio':
        for (const [kind, name, opts] of m.l) {
          if (kind === 'sfx') Audio.sfx(name, opts || {});
          else if (kind === 'music') Audio.music(name);
        }
        break;
      case 'round': round.start(m); break;
      case 'prepare': // briefing over: the round starts, so the joystick appears
        round.prepare(m);
        if (touchCtl) touchCtl.setContext('play');
        break;
      case 'fill': round.fill(m); break;
      case 'end':
        round.end();
        if (touchCtl) touchCtl.setContext('menu');
        break;
      case 'rehello': welcomed = false; hello(); break;
      case 'refused': finish(t('NO CONNECTION'), t('The host runs a different version of the game.')); break;
      case 'closed': finish(t('ROOM CLOSED'), t('The host closed the room.')); break;
      default: break;
    }
  });

  /** Mirror host UI parts. */
  function applyUI(msg) {
    if (msg.ov) { overlay.className = msg.ov[0]; overlay.innerHTML = msg.ov[1]; }
    // During a round this device draws its own HUD.
    if (msg.hud && !round.active) { hudEl.className = msg.hud[0]; hudEl.innerHTML = msg.hud[1]; }
    if (msg.toasts !== undefined) {
      stage.querySelectorAll(':scope > .toast').forEach((el) => el.remove());
      if (msg.toasts) stage.insertAdjacentHTML('beforeend', msg.toasts);
    }
    if (msg.bd) backdrop.applyState(msg.bd);
  }

  // Watchdog: knock until the host answers; notice when it goes quiet.
  let lostShown = false;
  const watchdog = setInterval(() => {
    if (finished) { clearInterval(watchdog); return; }
    const now = performance.now();
    if (!badgeShown) { // never got in yet
      if (now - firstAt > FIRST_CONTACT_MS) finish(t('NO CONNECTION'), t('The host did not answer.'));
      else if (now - helloAt > HELLO_RETRY_MS) hello();
      return;
    }
    const quiet = now - lastHeard;
    if (quiet > SILENT_MS) {
      if (quiet > GIVE_UP_MS) { finish(t('DISCONNECTED'), t('The connection to the host was lost.')); return; }
      if (!lostShown) { lostShown = true; round.end(); status(t('RECONNECTING…'), t('The connection to the host was lost.')); }
      if (now - helloAt > HELLO_RETRY_MS) { welcomed = false; hello(); }
    } else {
      lostShown = false;
    }
  }, 500);
}
