/**
 * client.js — the remote-player side of online play.
 *
 * Two ways in, same experience:
 *   LAN       `index.html?join=ROOM` loaded from the host's own server; the
 *             built-in relay exchanges the WebRTC offer (runClient).
 *   Internet  `index.html?peer=CODE` on this device; PeerJS Cloud finds the
 *             host by its 6-letter code (runInternetClient).
 *
 * The page does not run the game: it shows the host's video stream,
 * re-renders the mirrored overlay/HUD HTML, replays sound events with the
 * local synthesizer, and sends this device's controls to the host about 60
 * times per second. Any local device works (left keyboard, right keyboard, a
 * gamepad, or the on-screen touch controls on phones); they are merged into a
 * single remote controller.
 */
import { Audio } from '../core/audio.js';
import { InputManager } from '../core/input.js';
import { Signal, rtcConfig } from './signal.js';
import { internetPeerId } from './joincode.js';
import { TouchControls, isTouchDevice } from '../ui/touch.js';
import { Haptics } from '../core/haptics.js';
import { t, setLanguage, LANGUAGES } from '../i18n/i18n.js';
import { tp, initInputMode } from '../ui/prompts.js';

const SEND_MS = 16;

/** Use this device's saved language (or its system language) for the client's own messages. */
function initLanguage() {
  let lang = null;
  try { lang = JSON.parse(localStorage.getItem('tss.settings.v1') || '{}').lang; } catch (_) { /* no storage */ }
  if (!lang) lang = (navigator.language || 'en').slice(0, 2).toLowerCase();
  setLanguage(LANGUAGES.some((l) => l.code === lang) ? lang : 'en');
}

/**
 * Build the remote-player view shared by both transports: the video element,
 * status panel, UI/audio mirroring and the input loop.
 */
function createClientView(code) {
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
    overlay.innerHTML = `<div class="panel-screen"><h1>${title}</h1><p>${body}</p><div class="hint">${code}</div></div>`;
  };

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

  let myId = null;
  return {
    status,
    setId(id) { myId = id; },
    setStream(stream) { video.srcObject = stream; video.play().catch(() => {}); },

    /** Mirror host UI parts and audio. */
    applyUI(msg) {
      if (msg.ov) { overlay.className = msg.ov[0]; overlay.innerHTML = msg.ov[1]; }
      if (msg.hud) { hud.className = msg.hud[0]; hud.innerHTML = msg.hud[1]; }
      if (msg.toasts !== undefined) {
        stage.querySelectorAll(':scope > .toast').forEach((el) => el.remove());
        if (msg.toasts) stage.insertAdjacentHTML('beforeend', msg.toasts);
      }
      if (msg.t === 'hello') {
        const badge = document.createElement('div');
        badge.className = 'net-badge';
        badge.innerHTML = tp('ONLINE · PLAYER {n} · PRESS {A} IN THE LOBBY TO JOIN', { n: msg.n ?? myId ?? msg.id });
        stage.appendChild(badge);
        setTimeout(() => badge.classList.add('fade'), 6000);
      }
      if (msg.t === 'audio') {
        if (msg.kind === 'sfx') Audio.sfx(msg.name, msg.opts || {});
        else if (msg.kind === 'music') Audio.music(msg.name);
      }
    },

    /**
     * Merge every local device into one remote controller and stream it via
     * `send(packet)` (returns false while the channel is not open yet).
     */
    startInput(send) {
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
        if ((packet !== last || now - lastSent > 100) && send(packet)) { last = packet; lastSent = now; }
      }, SEND_MS);
    },
  };
}

// ============================================================ LAN (relay)

export async function runClient(code) {
  const view = createClientView(code);
  view.status(t('CONNECTING'), t('Contacting the facility…'));

  let signal;
  try {
    signal = new Signal(code, 'client');
    await signal.opened;
  } catch (e) {
    view.status(t('NO CONNECTION'), e.message);
    return;
  }

  const pc = new RTCPeerConnection(rtcConfig());
  let inputChan = null;

  pc.ontrack = (e) => view.setStream(e.streams[0] || new MediaStream([e.track]));
  pc.onicecandidate = (e) => { if (e.candidate) signal.send({ data: { t: 'ice', c: e.candidate } }); };
  pc.onconnectionstatechange = () => {
    if (['failed', 'disconnected', 'closed'].includes(pc.connectionState)) view.status(t('DISCONNECTED'), t('The connection to the host was lost.'));
  };
  pc.ondatachannel = (e) => {
    const ch = e.channel;
    if (ch.label === 'input') inputChan = ch;
    if (ch.label === 'ui') ch.onmessage = (m) => view.applyUI(JSON.parse(m.data));
  };

  signal.onMessage = async (m) => {
    if (m.type === 'welcome') { view.setId(m.id); view.status(t('CONNECTING'), t('Negotiating video link…')); }
    else if (m.type === 'error') view.status(t('NO CONNECTION'), m.reason === 'no such room' ? t('Room {code} does not exist.', { code }) : m.reason);
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

  view.startInput((packet) => {
    if (!inputChan || inputChan.readyState !== 'open') return false;
    inputChan.send(packet);
    return true;
  });
}

// ===================================================== Internet (PeerJS)

/** Join a host anywhere on the internet by its 6-letter code via PeerJS Cloud. */
export async function runInternetClient(code) {
  const view = createClientView(code);
  view.status(t('CONNECTING'), t('Contacting the facility…'));
  if (typeof window.Peer !== 'function') { view.status(t('NO CONNECTION'), 'PeerJS not loaded'); return; }

  const peer = new window.Peer(undefined, { debug: 0 });
  // Say goodbye properly when leaving, so the host frees the seat right away.
  window.addEventListener('pagehide', () => peer.destroy());
  try {
    await new Promise((resolve, reject) => {
      const timeout = setTimeout(() => reject(new Error(t('The online service is not reachable.'))), 10000);
      peer.once('open', () => { clearTimeout(timeout); resolve(); });
      peer.once('error', (e) => { clearTimeout(timeout); reject(e); });
    });
  } catch (e) {
    view.status(t('NO CONNECTION'), (e && e.message) || t('The online service is not reachable.'));
    return;
  }

  peer.on('error', (e) => {
    if (e && e.type === 'peer-unavailable') view.status(t('NO CONNECTION'), t('Room {code} does not exist.', { code }));
    else view.status(t('NO CONNECTION'), (e && (e.message || e.type)) || '');
  });
  // The host calls us with the game video once our UI channel is open.
  peer.on('call', (call) => {
    call.answer();
    call.on('stream', (stream) => view.setStream(stream));
  });

  const hostId = internetPeerId(code);
  const ui = peer.connect(hostId, { label: 'ui', reliable: true });
  const input = peer.connect(hostId, { label: 'input', reliable: false });
  ui.on('open', () => view.status(t('CONNECTING'), t('Negotiating video link…')));
  ui.on('data', (d) => view.applyUI(JSON.parse(typeof d === 'string' ? d : String(d))));
  ui.on('close', () => view.status(t('DISCONNECTED'), t('The connection to the host was lost.')));

  view.startInput((packet) => {
    if (!input.open) return false;
    input.send(packet);
    return true;
  });
}
