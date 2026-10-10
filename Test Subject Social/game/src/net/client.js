/**
 * client.js — the remote-player side of online play.
 *
 * Opened as `index.html?join=CODE`. The page does not run the game: it
 * shows the host's video stream, re-renders the mirrored overlay/HUD HTML,
 * replays sound events with the local synthesizer, and sends this machine's
 * keyboard / gamepad state to the host about 60 times per second.
 *
 * Any local device works (left keyboard, right keyboard, a gamepad, or the
 * on-screen touch controls on phones); they are merged into a single remote
 * controller.
 */
import { Audio } from '../core/audio.js';
import { InputManager } from '../core/input.js';
import { Signal, rtcConfig } from './signal.js';
import { TouchControls, isTouchDevice } from '../ui/touch.js';
import { Haptics } from '../core/haptics.js';
import { t, setLanguage, LANGUAGES } from '../i18n/i18n.js';
import { tp, initInputMode } from '../ui/prompts.js';

/** Use this device's saved language (or its system language) for the client's own messages. */
function initLanguage() {
  let lang = null;
  try { lang = JSON.parse(localStorage.getItem('tss.settings.v1') || '{}').lang; } catch (_) { /* no storage */ }
  if (!lang) lang = (navigator.language || 'en').slice(0, 2).toLowerCase();
  setLanguage(LANGUAGES.some((l) => l.code === lang) ? lang : 'en');
}

const SEND_MS = 16;

export async function runClient(code) {
  initLanguage();
  initInputMode(isTouchDevice());
  const stage = document.getElementById('stage');
  const canvas = document.getElementById('view');
  const overlay = document.getElementById('overlay');
  const hud = document.getElementById('hud');
  canvas.style.display = 'none';

  const video = document.createElement('video');
  video.id = 'remote-view';
  video.autoplay = true;
  video.playsInline = true;
  video.muted = true; // sound is synthesized locally from events
  stage.insertBefore(video, canvas);

  const status = (title, body = '') => {
    overlay.className = 'overlay dim';
    overlay.innerHTML = `<div class="panel-screen"><h1>${title}</h1><p>${body}</p><div class="hint">ROOM ${code}</div></div>`;
  };
  status(t('CONNECTING'), t('Contacting the facility…'));

  // Silence the mirrored sounds while this app is in the background.
  document.addEventListener('visibilitychange', () => (document.hidden ? Audio.suspend() : Audio.resume()));
  window.__onAppPause = () => Audio.suspend();
  window.__onAppResume = () => Audio.resume();

  // Leaving: Esc returns to the player's own game (the phone app's back button does the same).
  const home = new URLSearchParams(location.search).get('home');
  if (home && /^https?:\/\//.test(home)) {
    window.addEventListener('keydown', (e) => { if (e.code === 'Escape') location.href = home; });
  }

  const input = new InputManager();
  ['kb1', 'kb2', 'pad0', 'pad1', 'pad2', 'pad3'].forEach((d) => input.controller(d));
  // Phones: on-screen joystick + buttons, always shown (they also drive the host's lobby),
  // plus vibration that follows the host's sound effects.
  if (isTouchDevice()) {
    new TouchControls(input, { alwaysVisible: true });
    Audio.onHaptic = (name) => Haptics.fromSfx(name);
  }

  let signal;
  try {
    signal = new Signal(code, 'client');
    await signal.opened;
  } catch (e) {
    status(t('NO CONNECTION'), e.message);
    return;
  }

  const pc = new RTCPeerConnection(rtcConfig());
  let inputChan = null;
  let myId = null;

  pc.ontrack = (e) => { video.srcObject = e.streams[0] || new MediaStream([e.track]); video.play().catch(() => {}); };
  pc.onicecandidate = (e) => { if (e.candidate) signal.send({ data: { t: 'ice', c: e.candidate } }); };
  pc.onconnectionstatechange = () => {
    if (['failed', 'disconnected', 'closed'].includes(pc.connectionState)) status(t('DISCONNECTED'), t('The connection to the host was lost.'));
  };
  pc.ondatachannel = (e) => {
    const ch = e.channel;
    if (ch.label === 'input') inputChan = ch;
    if (ch.label === 'ui') ch.onmessage = (m) => applyUI(JSON.parse(m.data));
  };

  signal.onMessage = async (m) => {
    if (m.type === 'welcome') { myId = m.id; status(t('CONNECTING'), t('Negotiating video link…')); }
    else if (m.type === 'error') status(t('NO CONNECTION'), m.reason === 'no such room' ? t('Room {code} does not exist.', { code }) : m.reason);
    else if (m.type === 'msg') {
      const d = m.data || {};
      if (d.t === 'offer') {
        await pc.setRemoteDescription(d.sdp);
        const answer = await pc.createAnswer();
        await pc.setLocalDescription(answer);
        signal.send({ data: { t: 'answer', sdp: pc.localDescription } });
      } else if (d.t === 'ice' && d.c) {
        try { await pc.addIceCandidate(d.c); } catch (_) { /* late candidate */ }
      }
    }
  };

  /** Mirror host UI parts and audio. */
  function applyUI(msg) {
    if (msg.ov) { overlay.className = msg.ov[0]; overlay.innerHTML = msg.ov[1]; }
    if (msg.hud) { hud.className = msg.hud[0]; hud.innerHTML = msg.hud[1]; }
    if (msg.toasts !== undefined) {
      stage.querySelectorAll(':scope > .toast').forEach((t) => t.remove());
      if (msg.toasts) stage.insertAdjacentHTML('beforeend', msg.toasts);
    }
    if (msg.t === 'hello') {
      const badge = document.createElement('div');
      badge.className = 'net-badge';
      badge.innerHTML = tp('ONLINE · PLAYER {n} · PRESS {A} IN THE LOBBY TO JOIN', { n: myId ?? msg.id });
      stage.appendChild(badge);
      setTimeout(() => badge.classList.add('fade'), 6000);
    }
    if (msg.t === 'audio') {
      if (msg.kind === 'sfx') Audio.sfx(msg.name, msg.opts || {});
      else if (msg.kind === 'music') Audio.music(msg.name);
    }
  }

  // Merge every local device into one remote controller and stream it.
  let last = '';
  let lastSent = 0;
  setInterval(() => {
    input.update();
    let x = 0, y = 0, a = false, b = false;
    for (const c of input.controllers.values()) {
      if (Math.abs(c.moveX) > Math.abs(x)) x = c.moveX;
      if (Math.abs(c.moveY) > Math.abs(y)) y = c.moveY;
      a = a || c.a; b = b || c.b;
    }
    input.endFrame();
    const packet = JSON.stringify({ x: +x.toFixed(2), y: +y.toFixed(2), a, b });
    const now = performance.now();
    // Send on change, plus a heartbeat (packets are unreliable by design).
    if (inputChan && inputChan.readyState === 'open' && (packet !== last || now - lastSent > 100)) {
      inputChan.send(packet);
      last = packet; lastSent = now;
    }
  }, SEND_MS);
}
