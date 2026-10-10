/**
 * host.js — online hosting ("remote play" style), over LAN and the internet.
 *
 * The host machine runs the game as usual. Remote players can join two ways,
 * at the same time:
 *
 *   LAN       the built-in relay in serve.py / the Android app exchanges
 *             WebRTC offers on the local network (join code "ABCD-EFGH").
 *   Internet  PeerJS Cloud (0.peerjs.com) introduces the devices, so friends
 *             anywhere can join (6-letter internet code). A PeerJS data
 *             connection is used only to exchange the WebRTC offer; PeerJS
 *             also brings public STUN/TURN servers for players behind routers.
 *
 * Both routes then build the same single RTCPeerConnection per player:
 *
 *   video        the game canvas (captureStream)            host → client
 *   ui           overlay/HUD HTML snapshots + sound events  host → client
 *   input        controller state {s, x, y, a, b}           client → host
 *                (unordered, no retransmits: stale input is dropped, never queued)
 *
 * Remote input is written into an InputManager Controller with device id
 * `net<N>`, so the lobby and every minigame treat online players exactly
 * like local keyboards or gamepads. N is tied to the client's session token,
 * so a player who drops out and reconnects gets their seat back. Menus, HUD
 * and sounds are mirrored as DOM snapshots / audio event names and re-rendered
 * by the client with the same CSS and synthesizer.
 */
import { Audio } from '../core/audio.js';
import { Signal, makeRoomCode, rtcConfig, INTERNET_RTC } from './signal.js';
import { makeInternetCode, internetPeerId } from './joincode.js';

const UI_SYNC_MS = 66;          // ~15 snapshots per second
const VIDEO_FPS = 30;
const GRACE_MS = 20000;         // a dropped player keeps their seat this long
const ICE_LOST_MS = 8000;       // WebRTC 'disconnected' this long = connection lost
const UI_BACKLOG = 64 * 1024;   // skip UI snapshots while this much is still queued
// Video budget per player: internet links (and TURN relays) are much slower than a LAN.
const VIDEO = { lan: { bitrate: 6000000, height: 1080 }, internet: { bitrate: 1500000, height: 720 } };

export class NetHost {
  /** @param {*} app the main App (needs engine, input, overlay, hud) */
  constructor(app) {
    this.app = app;
    this.code = null;          // LAN room code (relay)
    this.internetCode = null;  // PeerJS code (6 letters)
    this.status = 'offline';   // 'offline' | 'connecting' | 'hosting' | 'error'
    this.error = null;
    this.lanError = null;
    this.internetError = null;
    this.players = new Map();  // link key → player (one per live connection)
    this.devices = new Map();  // client token → device number N (seat survives reconnects)
    this.lost = new Map();     // device number → time the connection was lost
    this._nextDev = 1;
    this.signal = null;        // LAN relay socket
    this.peer = null;          // PeerJS Peer (signaling only)
    this.stream = null;
    this._timer = null;
    this.onChange = null;      // UI refresh callback
  }

  /** Number of remote players currently connected. */
  get connectedCount() { return [...this.players.values()].filter((p) => p.connected).length; }

  /** True if the online device (e.g. 'net3') is connected right now. */
  isLive(device) {
    const dev = parseInt(device.slice(3), 10);
    return [...this.players.values()].some((p) => p.dev === dev && p.connected);
  }

  /** True if the online device is connected or may still come back (grace period). */
  isConnected(device) {
    if (this.isLive(device)) return true;
    const dev = parseInt(device.slice(3), 10);
    const pending = [...this.players.values()].some((p) => p.dev === dev);
    const t = this.lost.get(dev);
    return pending || (t !== undefined && performance.now() - t < GRACE_MS);
  }

  /** Open the LAN room and the internet room. Resolves when both attempts settle. */
  async start() {
    if (this.status === 'hosting' || this.status === 'connecting') return;
    this.status = 'connecting';
    this._changed();
    this.stream = this.app.engine.renderer.domElement.captureStream(VIDEO_FPS);
    for (const track of this.stream.getVideoTracks()) track.contentHint = 'motion';
    await Promise.all([this._startLan(), this._startInternet()]);
    if (!this.code && !this.internetCode) {
      this.status = 'error';
      this.error = this.internetError || this.lanError || 'Online play unavailable';
      this._changed();
      return;
    }
    Audio.onEvent = (kind, name, opts) => this.broadcast({ t: 'audio', kind, name, opts }, true);
    this._timer = setInterval(() => this._syncUI(), UI_SYNC_MS);
    this.status = 'hosting';
    this._changed();
  }

  /** Close every connection and both rooms. */
  stop() {
    clearInterval(this._timer);
    for (const key of [...this.players.keys()]) this._lost(key);
    if (this.signal) this.signal.close();
    if (this.peer) this.peer.destroy();
    this.signal = this.peer = null;
    this.code = this.internetCode = null;
    Audio.onEvent = null;
    this.status = 'offline';
    this._changed();
  }

  /** Send a message to every connected player. `droppable` messages are skipped on congested links. */
  broadcast(msg, droppable = false) {
    const text = JSON.stringify(msg);
    for (const p of this.players.values()) {
      if (!p.connected || p.ui.readyState !== 'open') continue;
      if (droppable && p.ui.bufferedAmount > UI_BACKLOG) continue;
      p.ui.send(text);
    }
  }

  // ============================================================== LAN (relay)

  async _startLan() {
    const code = makeRoomCode();
    try {
      this.signal = new Signal(code, 'host');
      await this.signal.opened;
    } catch (e) {
      this.signal = null;
      this.lanError = e.message;
      return;
    }
    this.code = code;
    this.signal.onMessage = (m) => {
      const key = `lan:${m.id ?? m.from}`;
      if (m.type === 'leave') this._lost(key); // the client page closed
      else if (m.type === 'msg') this._onSignal(key, m.data || {}, (data) => this.signal.send({ to: m.from, data }), 'lan');
      else if (m.type === 'error') { this.lanError = m.reason; this._changed(); }
    };
    this.signal.onClose = () => { this.code = null; this.lanError = 'Relay connection lost'; this._changed(); };
  }

  // ========================================================= Internet (PeerJS)

  /**
   * Register a public PeerJS id derived from a fresh 6-letter code. Retries
   * with a new code if that id happens to be taken.
   */
  async _startInternet() {
    if (typeof window.Peer !== 'function') { this.internetError = 'PeerJS not loaded'; return; }
    for (let attempt = 0; attempt < 3; attempt++) {
      const code = makeInternetCode();
      try {
        this.peer = await openPeer(internetPeerId(code));
        this.internetCode = code;
        break;
      } catch (e) {
        if (e && e.type === 'unavailable-id') continue; // collision: try another code
        this.internetError = (e && (e.type || e.message)) || 'PeerJS unavailable';
        return;
      }
    }
    if (!this.peer) return;
    // Each joining client opens one data connection, used only for signaling.
    this.peer.on('connection', (conn) => {
      const key = `p2p:${conn.connectionId}`;
      conn.on('data', (d) => this._onSignal(key, d || {}, (data) => { if (conn.open) conn.send(data); }, 'internet'));
      // The game link is separate: only a player who never finished connecting is lost here.
      conn.on('close', () => { const p = this.players.get(key); if (p && !p.connected) this._lost(key); });
    });
    // Keep the room reachable if the link to the PeerJS server blips.
    this.peer.on('disconnected', () => { if (this.peer && !this.peer.destroyed) this.peer.reconnect(); });
    this.peer.on('error', (e) => console.warn('[net] PeerJS', e && e.type));
  }

  // ================================================================= players

  /** Signaling message from a client (same protocol on both routes). */
  async _onSignal(key, data, sendSignal, route) {
    if (data.t === 'hello') { this._connect(key, String(data.token || key), sendSignal, route); return; }
    const p = this.players.get(key);
    if (!p) return;
    try {
      if (data.t === 'answer') { await p.pc.setRemoteDescription(data.sdp); this._tuneVideo(p); }
      else if (data.t === 'ice' && data.c) await p.pc.addIceCandidate(data.c);
    } catch (e) {
      console.warn('[net] signaling error', e);
    }
  }

  /** Build the game connection for a client and send it the offer. */
  async _connect(key, token, sendSignal, route) {
    if (this.players.has(key)) this._close(key);
    let dev = this.devices.get(token);
    if (dev === undefined) { dev = this._nextDev++; this.devices.set(token, dev); }
    // A reconnecting player replaces their old, dead link.
    for (const [k, other] of this.players) if (other.dev === dev) this._close(k);
    this.lost.delete(dev);

    const pc = new RTCPeerConnection(route === 'internet' ? INTERNET_RTC : rtcConfig());
    const ui = pc.createDataChannel('ui', { ordered: true });
    const input = pc.createDataChannel('input', { ordered: false, maxRetransmits: 0 });
    const p = { key, dev, route, pc, ui, input, connected: false, last: {}, seq: -1, lostTimer: null };
    this.players.set(key, p);
    for (const track of this.stream.getTracks()) pc.addTrack(track, this.stream);

    ui.onopen = () => this._welcome(p);
    ui.onclose = () => this._lost(key);
    input.onmessage = (e) => this._onInput(p, e.data);
    pc.onicecandidate = (e) => { if (e.candidate) sendSignal({ t: 'ice', c: e.candidate }); };
    pc.onconnectionstatechange = () => {
      const s = pc.connectionState;
      clearTimeout(p.lostTimer);
      if (s === 'failed' || s === 'closed') this._lost(key);
      // 'disconnected' often heals by itself (Wi-Fi hiccup, mobile handover): wait a bit.
      else if (s === 'disconnected') p.lostTimer = setTimeout(() => this._lost(key), ICE_LOST_MS);
    };
    const offer = await pc.createOffer();
    await pc.setLocalDescription(offer);
    sendSignal({ t: 'offer', sdp: pc.localDescription });
    this._changed();
  }

  /** Cap the video for this player's route: smooth frame rate beats sharpness. */
  async _tuneVideo(p) {
    const budget = VIDEO[p.route];
    const height = this.app.engine.renderer.domElement.height || budget.height;
    for (const sender of p.pc.getSenders()) {
      if (!sender.track || sender.track.kind !== 'video') continue;
      const params = sender.getParameters();
      if (!params.encodings || !params.encodings.length) params.encodings = [{}];
      Object.assign(params.encodings[0], {
        maxBitrate: budget.bitrate,
        maxFramerate: VIDEO_FPS,
        scaleResolutionDownBy: Math.max(1, height / budget.height),
      });
      params.degradationPreference = 'maintain-framerate';
      try { await sender.setParameters(params); } catch (e) { console.warn('[net] video tuning', e); }
    }
  }

  /** First message to a newly connected player: full UI snapshot. */
  _welcome(p) {
    p.connected = true;
    const snap = this._snapshot();
    for (const k of Object.keys(snap)) p.last[k] = JSON.stringify(snap[k]);
    p.ui.send(JSON.stringify({ t: 'hello', id: p.dev, n: p.dev, ...snap }));
    this._changed();
  }

  /** Close a link without treating its seat as lost (it is being replaced). */
  _close(key) {
    const p = this.players.get(key);
    if (!p) return;
    this.players.delete(key);
    clearTimeout(p.lostTimer);
    p.ui.onclose = null;
    p.pc.onconnectionstatechange = null;
    try { p.pc.close(); } catch (_) { /* already closed */ }
  }

  /** A link died: free its input and start the seat's grace period. */
  _lost(key) {
    const p = this.players.get(key);
    if (!p) return;
    this._close(key);
    if (![...this.players.values()].some((o) => o.dev === p.dev)) {
      this.lost.set(p.dev, performance.now());
      const ctrl = this.app.input.controllers.get(`net${p.dev}`);
      if (ctrl) { ctrl.rawX = ctrl.rawY = 0; ctrl.rawA = ctrl.rawB = false; }
    }
    this._changed();
  }

  /** Apply a remote controller packet {s, x, y, a, b} to its virtual Controller. */
  _onInput(p, text) {
    let s;
    try { s = JSON.parse(text); } catch (_) { return; }
    // Packets may arrive out of order: never let an older one overwrite a newer one.
    if (Number.isFinite(s.s)) { if (s.s <= p.seq) return; p.seq = s.s; }
    const c = this.app.input.controller(`net${p.dev}`);
    const num = (v) => (Number.isFinite(v) ? Math.max(-1, Math.min(1, v)) : 0);
    c.rawX = num(s.x); c.rawY = num(s.y);
    c.rawA = !!s.a; c.rawB = !!s.b;
  }

  /** Current overlay / HUD / toast markup. */
  _snapshot() {
    const ov = this.app.overlay, hud = this.app.hud.root;
    const toasts = [...document.querySelectorAll('#stage > .toast')].map((t) => t.outerHTML).join('');
    return { ov: [ov.className, ov.innerHTML], hud: [hud.className, hud.innerHTML], toasts };
  }

  /**
   * Send each player only the UI parts that changed since what they last
   * received. A congested link simply skips ticks and then gets the latest
   * state, so slow connections never build up a backlog of old menus.
   */
  _syncUI() {
    if (!this.connectedCount) return;
    const snap = this._snapshot();
    const parts = Object.fromEntries(Object.keys(snap).map((k) => [k, JSON.stringify(snap[k])]));
    for (const p of this.players.values()) {
      if (!p.connected || p.ui.readyState !== 'open' || p.ui.bufferedAmount > UI_BACKLOG) continue;
      const delta = {};
      for (const k of Object.keys(parts)) if (parts[k] !== p.last[k]) { delta[k] = snap[k]; p.last[k] = parts[k]; }
      if (Object.keys(delta).length) p.ui.send(JSON.stringify({ t: 'ui', ...delta }));
    }
  }

  _changed() { if (this.onChange) this.onChange(); }
}

/** Create a PeerJS Peer with a fixed id; resolves once registered with the cloud server. */
function openPeer(id) {
  return new Promise((resolve, reject) => {
    const peer = new window.Peer(id, { debug: 0, config: INTERNET_RTC });
    const timeout = setTimeout(() => { peer.destroy(); reject(new Error('PeerJS server not reachable')); }, 10000);
    peer.once('open', () => { clearTimeout(timeout); resolve(peer); });
    peer.once('error', (e) => { clearTimeout(timeout); peer.destroy(); reject(e); });
  });
}
