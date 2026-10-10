/**
 * host.js — online hosting ("remote play" style).
 *
 * The host machine runs the game as usual. Each remote player that joins
 * the room gets one RTCPeerConnection carrying:
 *
 *   video track  the game canvas (captureStream)            host → client
 *   'ui'  chan   overlay/HUD HTML snapshots + sound events  host → client
 *   'input' chan controller state {x, y, a, b}             client → host
 *
 * Remote input is written into an InputManager Controller with device id
 * `net<N>`, so the lobby and every minigame treat online players exactly
 * like local keyboards or gamepads. Menus, HUD and sounds are mirrored as
 * DOM snapshots / audio event names and re-rendered by the client with the
 * same CSS and synthesizer, which keeps bandwidth tiny and text crisp.
 */
import { Audio } from '../core/audio.js';
import { Signal, makeRoomCode, rtcConfig } from './signal.js';

const UI_SYNC_MS = 66;   // ~15 snapshots per second
const VIDEO_FPS = 30;

export class NetHost {
  /** @param {*} app the main App (needs engine, input, overlay, hud) */
  constructor(app) {
    this.app = app;
    this.code = null;
    this.status = 'offline'; // 'offline' | 'connecting' | 'hosting' | 'error'
    this.error = null;
    this.peers = new Map();  // id → { pc, ui, input, connected }
    this.signal = null;
    this.stream = null;
    this._last = {};         // last UI snapshot parts sent
    this._timer = null;
    this.onChange = null;    // UI refresh callback
  }

  /** Number of remote players currently connected. */
  get connectedCount() { return [...this.peers.values()].filter((p) => p.connected).length; }

  /** True if the online device id (e.g. 'net3') still has a live connection. */
  isConnected(device) {
    const p = this.peers.get(parseInt(device.slice(3), 10));
    return !!(p && p.connected);
  }

  /** Open a room on the relay. Resolves once the room is registered. */
  async start() {
    if (this.status === 'hosting' || this.status === 'connecting') return;
    this.status = 'connecting';
    this.code = makeRoomCode();
    this._changed();
    try {
      this.signal = new Signal(this.code, 'host');
      await this.signal.opened;
    } catch (e) {
      this.status = 'error'; this.error = e.message; this._changed();
      return;
    }
    this.signal.onMessage = (m) => this._onSignal(m);
    this.signal.onClose = () => { this.status = 'error'; this.error = 'Relay connection lost'; this._changed(); };
    this.stream = this.app.engine.renderer.domElement.captureStream(VIDEO_FPS);
    Audio.onEvent = (kind, name, opts) => this.broadcast({ t: 'audio', kind, name, opts });
    this._timer = setInterval(() => this._syncUI(), UI_SYNC_MS);
    this.status = 'hosting';
    this._changed();
  }

  /** Close every connection and the room. */
  stop() {
    clearInterval(this._timer);
    for (const id of [...this.peers.keys()]) this._drop(id);
    if (this.signal) this.signal.close();
    Audio.onEvent = null;
    this.status = 'offline';
    this._changed();
  }

  /** Send a message on every open 'ui' channel. */
  broadcast(msg) {
    const text = JSON.stringify(msg);
    for (const p of this.peers.values()) if (p.ui && p.ui.readyState === 'open') p.ui.send(text);
  }

  // ------------------------------------------------------------- signaling

  _onSignal(m) {
    if (m.type === 'join') this._connect(m.id);
    else if (m.type === 'leave') this._drop(m.id);
    else if (m.type === 'msg') this._onPeerMessage(m.from, m.data || {});
    else if (m.type === 'error') { this.status = 'error'; this.error = m.reason; this._changed(); }
  }

  async _connect(id) {
    const pc = new RTCPeerConnection(rtcConfig());
    const peer = { pc, ui: null, input: null, connected: false };
    this.peers.set(id, peer);
    for (const track of this.stream.getTracks()) pc.addTrack(track, this.stream);

    peer.ui = pc.createDataChannel('ui');
    peer.input = pc.createDataChannel('input', { ordered: false, maxRetransmits: 0 });
    peer.ui.onopen = () => {
      peer.connected = true;
      peer.ui.send(JSON.stringify({ t: 'hello', id, ...this._snapshot() }));
      this._changed();
    };
    peer.input.onmessage = (e) => this._onInput(id, e.data);
    pc.onicecandidate = (e) => { if (e.candidate) this.signal.send({ to: id, data: { t: 'ice', c: e.candidate } }); };
    pc.onconnectionstatechange = () => {
      if (['failed', 'closed', 'disconnected'].includes(pc.connectionState)) this._drop(id);
    };

    const offer = await pc.createOffer();
    await pc.setLocalDescription(offer);
    this.signal.send({ to: id, data: { t: 'offer', sdp: pc.localDescription } });
  }

  async _onPeerMessage(id, data) {
    const peer = this.peers.get(id);
    if (!peer) return;
    try {
      if (data.t === 'answer') await peer.pc.setRemoteDescription(data.sdp);
      else if (data.t === 'ice' && data.c) await peer.pc.addIceCandidate(data.c);
    } catch (e) {
      console.warn('[net] signaling error', e);
    }
  }

  _drop(id) {
    const peer = this.peers.get(id);
    if (!peer) return;
    this.peers.delete(id);
    try { peer.pc.close(); } catch (_) { /* already closed */ }
    const ctrl = this.app.input.controllers.get(`net${id}`);
    if (ctrl) { ctrl.rawX = ctrl.rawY = 0; ctrl.rawA = ctrl.rawB = false; }
    this._changed();
  }

  // ----------------------------------------------------------------- input

  /** Apply a remote controller packet {x, y, a, b} to its virtual Controller. */
  _onInput(id, text) {
    let s;
    try { s = JSON.parse(text); } catch (_) { return; }
    const c = this.app.input.controller(`net${id}`);
    const num = (v) => (Number.isFinite(v) ? Math.max(-1, Math.min(1, v)) : 0);
    c.rawX = num(s.x); c.rawY = num(s.y);
    c.rawA = !!s.a; c.rawB = !!s.b;
  }

  // -------------------------------------------------------------- UI mirror

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
