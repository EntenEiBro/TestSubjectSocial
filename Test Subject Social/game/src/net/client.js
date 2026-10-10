/**
 * client.js — the remote-player side of online play.
 *
 * Two ways in, same experience:
 *   LAN       `index.html?join=ROOM` loaded from the host's own server; the
 *             built-in relay carries the WebRTC offer (runClient).
 *   Internet  `index.html?peer=CODE` on this device; PeerJS Cloud finds the
 *             host by its 6-letter code and a PeerJS data connection carries
 *             the offer (runInternetClient).
 *
 * Either way the game itself arrives over one RTCPeerConnection built by the
 * host (video + 'ui' channel + unordered 'input' channel). The page does not
 * run the game: it shows the host's video stream, re-renders the mirrored
 * overlay/HUD HTML, replays sound events with the local synthesizer, and
 * sends this device's controls to the host about 60 times per second. Any
 * local device works (left keyboard, right keyboard, a gamepad, or the
 * on-screen touch controls on phones); they are merged into one controller.
 *
 * If the connection drops, the client reconnects by itself. A session token
 * tells the host it is the same player, so they get their seat back.
 */
import { Audio } from '../core/audio.js';
import { InputManager } from '../core/input.js';
import { Signal, rtcConfig, INTERNET_RTC } from './signal.js';
import { internetPeerId } from './joincode.js';
import { TouchControls, isTouchDevice } from '../ui/touch.js';
import { Haptics } from '../core/haptics.js';
import { t, setLanguage, LANGUAGES } from '../i18n/i18n.js';
import { tp, initInputMode } from '../ui/prompts.js';

const SEND_MS = 16;
const HEARTBEAT_MS = 100;     // resend the controller state at least this often
const CONNECT_TIMEOUT = 20000;
const ICE_LOST_MS = 8000;     // WebRTC 'disconnected' this long = connection lost
const MAX_RETRIES = 30;

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

/** Use this device's saved language (or its system language) for the client's own messages. */
function initLanguage() {
  let lang = null;
  try { lang = JSON.parse(localStorage.getItem('tss.settings.v1') || '{}').lang; } catch (_) { /* no storage */ }
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

/** Error that ends the session instead of triggering a reconnect. */
class FatalError extends Error {}

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

  // Controller loop: merge every local device into one remote controller and
  // send it on change plus a heartbeat. Packets carry a sequence number so the
  // host can ignore ones that arrive late (the channel is unordered).
  let channel = null;
  let seq = 0;
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
    if (!channel || channel.readyState !== 'open') return;
    const state = `${x.toFixed(2)},${y.toFixed(2)},${a},${b}`;
    const now = performance.now();
    if (state === last && now - lastSent < HEARTBEAT_MS) return;
    channel.send(JSON.stringify({ s: ++seq, x: +x.toFixed(2), y: +y.toFixed(2), a, b }));
    last = state; lastSent = now;
  }, SEND_MS);

  let badgeShown = false;
  return {
    status,
    setInputChannel(ch) { channel = ch; last = ''; },
    setStream(stream) { video.srcObject = stream; video.play().catch(() => {}); },

    /** Mirror host UI parts and audio. */
    applyUI(msg) {
      if (msg.ov) { overlay.className = msg.ov[0]; overlay.innerHTML = msg.ov[1]; }
      if (msg.hud) { hud.className = msg.hud[0]; hud.innerHTML = msg.hud[1]; }
      if (msg.toasts !== undefined) {
        stage.querySelectorAll(':scope > .toast').forEach((el) => el.remove());
        if (msg.toasts) stage.insertAdjacentHTML('beforeend', msg.toasts);
      }
      if (msg.t === 'hello' && !badgeShown) {
        badgeShown = true;
        const badge = document.createElement('div');
        badge.className = 'net-badge';
        badge.innerHTML = tp('ONLINE · PLAYER {n} · PRESS {A} IN THE LOBBY TO JOIN', { n: msg.n ?? msg.id });
        stage.appendChild(badge);
        setTimeout(() => badge.classList.add('fade'), 6000);
      }
      if (msg.t === 'audio') {
        if (msg.kind === 'sfx') Audio.sfx(msg.name, msg.opts || {});
        else if (msg.kind === 'music') Audio.music(msg.name);
      }
    },
  };
}

/**
 * One connection attempt: open the signaling link, answer the host's offer
 * and run until the game connection ends.
 * @returns {Promise<{connected: boolean}>}
 */
function connectOnce(view, transport, rtc, token) {
  return new Promise((resolve, reject) => {
    let finished = false, connected = false, pc = null, link = null, lostTimer = null;
    const finish = (err) => {
      if (finished) return;
      finished = true;
      clearTimeout(timeout); clearTimeout(lostTimer);
      view.setInputChannel(null);
      try { if (pc) pc.close(); } catch (_) { /* closed */ }
      try { if (link) link.close(); } catch (_) { /* closed */ }
      window.removeEventListener('pagehide', onLeave);
      if (err instanceof FatalError) reject(err); else resolve({ connected });
    };
    const timeout = setTimeout(() => finish(), CONNECT_TIMEOUT);
    // Close the game link properly when leaving, so the host frees the seat right away.
    const onLeave = () => finish();
    window.addEventListener('pagehide', onLeave);

    pc = new RTCPeerConnection(rtc);
    pc.ontrack = (e) => {
      // Show frames as soon as they arrive: latency matters more than smoothness here.
      try { e.receiver.jitterBufferTarget = 0; } catch (_) { /* unsupported */ }
      try { e.receiver.playoutDelayHint = 0; } catch (_) { /* unsupported */ }
      view.setStream(e.streams[0] || new MediaStream([e.track]));
    };
    pc.ondatachannel = (e) => {
      const ch = e.channel;
      if (ch.label === 'input') { ch.onopen = () => view.setInputChannel(ch); if (ch.readyState === 'open') view.setInputChannel(ch); }
      if (ch.label === 'ui') {
        ch.onmessage = (m) => view.applyUI(JSON.parse(m.data));
        ch.onopen = () => { connected = true; clearTimeout(timeout); };
        ch.onclose = () => finish();
      }
    };
    pc.onconnectionstatechange = () => {
      const s = pc.connectionState;
      clearTimeout(lostTimer);
      if (s === 'failed' || s === 'closed') finish();
      else if (s === 'disconnected') lostTimer = setTimeout(() => finish(), ICE_LOST_MS);
    };
    pc.onicecandidate = (e) => { if (e.candidate && link) link.send({ t: 'ice', c: e.candidate }); };

    const onSignal = async (d) => {
      try {
        if (d.t === 'offer') {
          await pc.setRemoteDescription(d.sdp);
          const answer = await pc.createAnswer();
          await pc.setLocalDescription(answer);
          link.send({ t: 'answer', sdp: pc.localDescription });
        } else if (d.t === 'ice' && d.c) {
          await pc.addIceCandidate(d.c);
        }
      } catch (e) {
        console.warn('[net] signaling error', e);
      }
    };

    transport.open({
      onData: onSignal,
      // Losing the signaling link only matters while the game link is being set up.
      onClose: () => { if (!connected) finish(); },
    }).then((l) => {
      if (finished) { l.close(); return; }
      link = l;
      view.status(t('CONNECTING'), t('Negotiating video link…'));
      link.send({ t: 'hello', token });
    }).catch((e) => finish(e));
  });
}

/** Connect, and reconnect after every drop, until the room is gone. */
async function runSession(view, code, transport, rtc) {
  const token = sessionToken(code);
  view.status(t('CONNECTING'), t('Contacting the facility…'));
  let everConnected = false;
  for (let failures = 0; failures < MAX_RETRIES;) {
    try {
      const { connected } = await connectOnce(view, transport, rtc, token);
      if (connected) { everConnected = true; failures = 0; } else failures++;
    } catch (e) {
      // "Room does not exist" right away is final; after a drop the host may just be reconnecting.
      if (!everConnected) { view.status(t('NO CONNECTION'), e.message); return; }
      failures++;
    }
    view.status(t('RECONNECTING…'), t('The connection to the host was lost.'));
    await sleep(Math.min(5000, 1000 * Math.max(1, failures)));
  }
  view.status(t('DISCONNECTED'), t('The connection to the host was lost.'));
}

// ============================================================ LAN (relay)

/** Signaling over the host's built-in relay (serve.py / the Android app). */
function lanTransport(code) {
  return {
    open(handlers) {
      return new Promise((resolve, reject) => {
        const signal = new Signal(code, 'client');
        let ready = false;
        const link = { send: (data) => signal.send({ data }), close: () => signal.close() };
        signal.opened.catch((e) => reject(e));
        signal.onMessage = (m) => {
          if (m.type === 'welcome') { ready = true; resolve(link); }
          else if (m.type === 'error') {
            signal.close();
            reject(m.reason === 'no such room' ? new FatalError(t('Room {code} does not exist.', { code })) : new Error(m.reason));
          } else if (m.type === 'msg') handlers.onData(m.data || {});
        };
        signal.onClose = () => { if (ready) handlers.onClose(); else reject(new Error(t('The connection to the host was lost.'))); };
      });
    },
  };
}

export async function runClient(code) {
  await runSession(createClientView(code), code, lanTransport(code), rtcConfig());
}

// ===================================================== Internet (PeerJS)

/** Signaling over a PeerJS data connection to the host's public id. */
function internetTransport(code) {
  let peer = null;
  let pending = null; // reject() of the connection attempt in progress

  const ensurePeer = () => new Promise((resolve, reject) => {
    if (peer && !peer.destroyed && peer.open) { resolve(peer); return; }
    if (peer && !peer.destroyed && peer.disconnected) {
      peer.reconnect();
    } else {
      peer = new window.Peer(undefined, { debug: 0, config: INTERNET_RTC });
      // Say goodbye to the PeerJS server when leaving.
      window.addEventListener('pagehide', () => peer && peer.destroy(), { once: true });
      peer.on('error', (e) => {
        if (!pending) return;
        pending(e && e.type === 'peer-unavailable'
          ? new FatalError(t('Room {code} does not exist.', { code }))
          : new Error((e && (e.message || e.type)) || t('The online service is not reachable.')));
      });
    }
    const timer = setTimeout(() => reject(new Error(t('The online service is not reachable.'))), 10000);
    peer.once('open', () => { clearTimeout(timer); resolve(peer); });
  });

  return {
    async open(handlers) {
      if (typeof window.Peer !== 'function') throw new FatalError('PeerJS not loaded');
      const p = await ensurePeer();
      return new Promise((resolve, reject) => {
        const conn = p.connect(internetPeerId(code), { reliable: true, serialization: 'json' });
        const timer = setTimeout(() => { pending = null; conn.close(); reject(new Error(t('The online service is not reachable.'))); }, 15000);
        pending = (err) => { clearTimeout(timer); pending = null; reject(err); };
        conn.on('open', () => {
          clearTimeout(timer); pending = null;
          resolve({ send: (data) => { if (conn.open) conn.send(data); }, close: () => conn.close() });
        });
        conn.on('data', (d) => handlers.onData(d || {}));
        conn.on('close', () => handlers.onClose());
      });
    },
  };
}

/** Join a host anywhere on the internet by its 6-letter code via PeerJS Cloud. */
export async function runInternetClient(code) {
  await runSession(createClientView(code), code, internetTransport(code), INTERNET_RTC);
}
