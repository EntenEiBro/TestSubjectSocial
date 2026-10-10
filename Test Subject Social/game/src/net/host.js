/**
 * host.js — online hosting ("remote play" style), over LAN and the internet.
 *
 * The host machine runs the game as usual. Remote players can join two ways,
 * at the same time:
 *
 *   LAN       the built-in relay in serve.py / the Android app exchanges
 *             WebRTC offers on the local network (join code "ABCD-EFGH").
 *   Internet  PeerJS Cloud (0.peerjs.com) brokers the connection, so friends
 *             anywhere can join (6-letter internet code). PeerJS also brings
 *             public STUN/TURN servers for players behind routers.
 *
 * Whatever the route, each remote player gets:
 *
 *   video        the game canvas (captureStream)            host → client
 *   ui           overlay/HUD HTML snapshots + sound events  host → client
 *   input        controller state {x, y, a, b}             client → host
 *
 * Remote input is written into an InputManager Controller with device id
 * `net<N>`, so the lobby and every minigame treat online players exactly
 * like local keyboards or gamepads. Menus, HUD and sounds are mirrored as
 * DOM snapshots / audio event names and re-rendered by the client with the
 * same CSS and synthesizer, which keeps bandwidth tiny and text crisp.
 */
import { Audio } from '../core/audio.js';
import { Signal, makeRoomCode, rtcConfig } from './signal.js';
import { makeInternetCode, internetPeerId } from './joincode.js';

const UI_SYNC_MS = 66;   // ~15 snapshots per second
const VIDEO_FPS = 30;
const INTERNET_ID_BASE = 1000; // internet players get net1000+, LAN players net1+

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
    this.peers = new Map();    // id → { connected, send(text), close() }
    this.signal = null;        // LAN relay socket
    this.peer = null;          // PeerJS Peer
    this.stream = null;
    this._last = {};           // last UI snapshot parts sent
    this._timer = null;
    this._nextInternetId = INTERNET_ID_BASE;
    this.onChange = null;      // UI refresh callback
  }

  /** Number of remote players currently connected. */
  get connectedCount() { return [...this.peers.values()].filter((p) => p.connected).length; }

  /** True if the online device id (e.g. 'net3') still has a live connection. */
  isConnected(device) {
    const p = this.peers.get(parseInt(device.slice(3), 10));
    return !!(p && p.connected);
  }

  /** Open the LAN room and the internet room. Resolves when both attempts settle. */
  async start() {
    if (this.status === 'hosting' || this.status === 'connecting') return;
    this.status = 'connecting';
    this._changed();
    this.stream = this.app.engine.renderer.domElement.captureStream(VIDEO_FPS);
    await Promise.all([this._startLan(), this._startInternet()]);
    if (!this.code && !this.internetCode) {
      this.status = 'error';
      this.error = this.internetError || this.lanError || 'Online play unavailable';
      this._changed();
      return;
    }
    Audio.onEvent = (kind, name, opts) => this.broadcast({ t: 'audio', kind, name, opts });
    this._timer = setInterval(() => this._syncUI(), UI_SYNC_MS);
    this.status = 'hosting';
    this._changed();
  }

  /** Close every connection and both rooms. */
  stop() {
    clearInterval(this._timer);
    for (const id of [...this.peers.keys()]) this._drop(id);
    if (this.signal) this.signal.close();
    if (this.peer) this.peer.destroy();
    this.signal = this.peer = null;
    this.code = this.internetCode = null;
    Audio.onEvent = null;
    this.status = 'offline';
    this._changed();
  }

  /** Send a message to every connected player. */
  broadcast(msg) {
    const text = JSON.stringify(msg);
    for (const p of this.peers.values()) if (p.connected) p.send(text);
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
    this.signal.onMessage = (m) => this._onSignal(m);
    this.signal.onClose = () => { this.code = null; this.lanError = 'Relay connection lost'; this._changed(); };
  }

  _onSignal(m) {
    if (m.type === 'join') this._connectLan(m.id);
    else if (m.type === 'leave') this._drop(m.id);
    else if (m.type === 'msg') this._onLanSignal(m.from, m.data || {});
    else if (m.type === 'error') { this.lanError = m.reason; this._changed(); }
  }

  async _connectLan(id) {
    const pc = new RTCPeerConnection(rtcConfig());
    const ui = pc.createDataChannel('ui');
    const input = pc.createDataChannel('input', { ordered: false, maxRetransmits: 0 });
    const peer = {
      pc, connected: false,
      send: (text) => { if (ui.readyState === 'open') ui.send(text); },
      close: () => { try { pc.close(); } catch (_) { /* already closed */ } },
    };
    this.peers.set(id, peer);
    for (const track of this.stream.getTracks()) pc.addTrack(track, this.stream);
    ui.onopen = () => this._welcome(id, peer);
    input.onmessage = (e) => this._onInput(id, e.data);
    pc.onicecandidate = (e) => { if (e.candidate) this.signal.send({ to: id, data: { t: 'ice', c: e.candidate } }); };
    pc.onconnectionstatechange = () => {
      if (['failed', 'closed', 'disconnected'].includes(pc.connectionState)) this._drop(id);
    };
    const offer = await pc.createOffer();
    await pc.setLocalDescription(offer);
    this.signal.send({ to: id, data: { t: 'offer', sdp: pc.localDescription } });
  }

  async _onLanSignal(id, data) {
    const peer = this.peers.get(id);
    if (!peer || !peer.pc) return;
    try {
      if (data.t === 'answer') await peer.pc.setRemoteDescription(data.sdp);
      else if (data.t === 'ice' && data.c) await peer.pc.addIceCandidate(data.c);
    } catch (e) {
      console.warn('[net] signaling error', e);
    }
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
    this.peer.on('connection', (conn) => this._onPeerConnection(conn));
    // Keep the room reachable if the link to the PeerJS server blips.
    this.peer.on('disconnected', () => { if (this.peer && !this.peer.destroyed) this.peer.reconnect(); });
    this.peer.on('error', (e) => console.warn('[net] PeerJS', e && e.type));
  }

  /**
   * Clients open two data connections ('ui' reliable, 'input' fast) and the
   * host then calls them with the video stream.
   */
  _onPeerConnection(conn) {
    let entry = [...this.peers.entries()].find(([, p]) => p.remote === conn.peer);
    if (!entry) {
      const id = this._nextInternetId++;
      const peer = {
        remote: conn.peer, connected: false, ui: null, call: null,
        send: (text) => { if (peer.ui && peer.ui.open) peer.ui.send(text); },
        close: () => {
          try { if (peer.ui) peer.ui.close(); } catch (_) { /* gone */ }
          try { if (peer.input) peer.input.close(); } catch (_) { /* gone */ }
          try { if (peer.call) peer.call.close(); } catch (_) { /* gone */ }
        },
      };
      this.peers.set(id, peer);
      entry = [id, peer];
    }
    const [id, peer] = entry;
    if (conn.label === 'input') {
      peer.input = conn;
      conn.on('data', (d) => this._onInput(id, typeof d === 'string' ? d : JSON.stringify(d)));
    } else {
      peer.ui = conn;
      conn.on('open', () => {
        peer.call = this.peer.call(conn.peer, this.stream); // send the game video
        this._welcome(id, peer);
        // PeerJS misses abrupt exits (closed tab, app killed): watch the WebRTC link too.
        const pc = conn.peerConnection;
        if (pc) pc.addEventListener('connectionstatechange', () => {
          if (['failed', 'closed', 'disconnected'].includes(pc.connectionState)) this._drop(id);
        });
      });
    }
    conn.on('close', () => this._drop(id));
    conn.on('error', () => this._drop(id));
  }

  // ================================================================= shared

  /** First message to a newly connected player: full UI snapshot. */
  _welcome(id, peer) {
    peer.connected = true;
    // `n` is a friendly player number for the badge (ids are internal: LAN 1+, internet 1000+).
    peer.send(JSON.stringify({ t: 'hello', id, n: this.connectedCount, ...this._snapshot() }));
    this._changed();
  }

  _drop(id) {
    const peer = this.peers.get(id);
    if (!peer) return;
    this.peers.delete(id);
    peer.close();
    const ctrl = this.app.input.controllers.get(`net${id}`);
    if (ctrl) { ctrl.rawX = ctrl.rawY = 0; ctrl.rawA = ctrl.rawB = false; }
    this._changed();
  }

  /** Apply a remote controller packet {x, y, a, b} to its virtual Controller. */
  _onInput(id, text) {
    let s;
    try { s = JSON.parse(text); } catch (_) { return; }
    const c = this.app.input.controller(`net${id}`);
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

  /** Send only the parts of the UI that changed since the last sync. */
  _syncUI() {
    if (!this.connectedCount) return;
    const snap = this._snapshot();
    const delta = {};
    for (const k of Object.keys(snap)) {
      const v = JSON.stringify(snap[k]);
      if (v !== this._last[k]) { delta[k] = snap[k]; this._last[k] = v; }
    }
    if (Object.keys(delta).length) this.broadcast({ t: 'ui', ...delta });
  }

  _changed() { if (this.onChange) this.onChange(); }
}

/** Create a PeerJS Peer with a fixed id; resolves once registered with the cloud server. */
function openPeer(id) {
  return new Promise((resolve, reject) => {
    const peer = new window.Peer(id, { debug: 0 });
    const timeout = setTimeout(() => { peer.destroy(); reject(new Error('PeerJS server not reachable')); }, 10000);
    peer.once('open', () => { clearTimeout(timeout); resolve(peer); });
    peer.once('error', (e) => { clearTimeout(timeout); peer.destroy(); reject(e); });
  });
}
