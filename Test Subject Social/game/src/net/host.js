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
 *   video        the host's canvas (captureStream)          host → client
 *   ui           overlay/HUD HTML snapshots + sound events  host → client
 *   input        controller state {s, x, y, a, b, pa, pb}   client → host
 *                (unordered, no retransmits: stale input is dropped, never queued)
 *   sim          round control: build / rebuild / end       both ways, reliable
 *   frames       lockstep input frames                      host → client, unordered
 *
 * Rounds run on every player's own device (see lockstep.js): the host sends
 * the round's seed and then one input frame per tick, and each client
 * simulates and renders the round itself — video is paused for it meanwhile.
 * Menus between rounds are still mirrored from the host: its 3D backdrop as
 * video, menus/HUD as DOM snapshots, sounds as event names.
 *
 * Remote input is written into an InputManager Controller with device id
 * `net<N>` (menus, lobby, briefing) and into the lockstep frames (rounds).
 * N is tied to the client's session token, so a player who drops out and
 * reconnects gets their seat back.
 */
import { Audio } from '../core/audio.js';
import { Signal, makeRoomCode, rtcConfig, INTERNET_RTC } from './signal.js';
import { makeInternetCode, internetPeerId, makeJoinCode, PHONE_PORT } from './joincode.js';
import { t } from '../i18n/i18n.js';
import { PROTOCOL, HISTORY } from './lockstep.js';

const NO_INPUT = Object.freeze({ x: 0, y: 0, a: false, b: false });
const RESEND_MAX = 240;         // frames per resend message (lockstep gap repair)
const UI_SYNC_MS = 33;         // ~30 UI checks per second (only changes are sent)
const VIDEO_FPS = 30;
const GRACE_MS = 20000;         // a dropped player keeps their seat this long
const ICE_LOST_MS = 8000;       // WebRTC 'disconnected' this long = connection lost
const UI_BACKLOG = 64 * 1024;   // skip UI snapshots while this much is still queued
const INPUT_QUEUE = 8;          // max buffered input changes per player (≈8 frames)
const MONITOR_MS = 2000;        // connection quality check interval
// Video budget per player: internet links, and TURN relays even more, are slower than a LAN.
const VIDEO = {
  lan: { bitrate: 6000000, height: 1080 },
  internet: { bitrate: 1500000, height: 720 },
  relay: { bitrate: 800000, height: 540 },
};

export class NetHost {
  /** @param {*} app the main App (needs engine, input, overlay, hud) */
  constructor(app) {
    this.app = app;
    this.code = null;          // LAN room code (relay)
    this.lanJoinCode = null;   // LAN join code for JOIN ONLINE (room + host address)
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
    this._monitor = null;
    this._chip = null;         // corner badge with the join codes (host menus)
    this.lockstepActive = false; // a lockstep round is ticking (LockstepHost)
    this.inSimTick = false;    // currently inside a lockstep tick (its sounds play on every device)
    this.onChange = null;      // UI refresh callback
  }

  // ============================================================ online rounds

  /** True if online players should play the next round on their own devices. */
  get hasRemotePlayers() { return this.status === 'hosting' && this.connectedCount > 0; }

  /**
   * A round begins: every connected client builds the same simulation from
   * `seed` (shown behind the title card and briefing).
   */
  roundStart(G, seed, players, botDifficulty) {
    const roster = players.map((p) => ({ slot: p.slot, device: p.device, look: p.look, lookIndex: p.lookIndex }));
    for (const p of this.players.values()) {
      if (!p.connected || p.simCh.readyState !== 'open') continue;
      p.sim = 'pending';
      p.simCh.send(JSON.stringify({ t: 'round', v: PROTOCOL, id: G.meta.id, seed, bot: botDifficulty, me: p.dev, players: roster }));
    }
  }

  /** After the briefing: everyone rebuilds a fresh copy from `seed` and waits for tick 0. */
  roundPrepare(seed) {
    for (const p of this.players.values()) {
      if ((p.sim === 'pending' || p.sim === 'running') && p.simCh.readyState === 'open') p.simCh.send(JSON.stringify({ t: 'prepare', seed }));
    }
  }

  /** Publish the newest lockstep frames (the last HISTORY of them, in case packets get lost). */
  sendFrames(frames, hash) {
    const n = frames.length;
    const text = JSON.stringify({ t: 'f', n, f: frames.slice(Math.max(0, n - HISTORY)), h: hash });
    for (const p of this.players.values()) {
      if (p.sim === 'running' && p.framesCh.readyState === 'open' && p.framesCh.bufferedAmount < UI_BACKLOG) p.framesCh.send(text);
    }
  }

  /** The round is over (finished, skipped or aborted): clients return to the mirrored menus. */
  roundEnd() {
    for (const p of this.players.values()) {
      if (!p.sim) continue;
      if (p.simCh.readyState === 'open') p.simCh.send(JSON.stringify({ t: 'end' }));
      this._setVideo(p, true);
      p.sim = null;
    }
  }

  /** Next input of an online seat for one lockstep tick (one queued change per tick). */
  takeInput(device) {
    const dev = parseInt(device.slice(3), 10);
    for (const p of this.players.values()) if (p.dev === dev && p.connected) return this._nextInput(p);
    return NO_INPUT;
  }

  _nextInput(p) {
    if (p.queue.length) p.cur = p.queue.shift();
    return p.cur || NO_INPUT;
  }

  /** Round control messages from a client. */
  _onSimMessage(p, text) {
    let m;
    try { m = JSON.parse(text); } catch (_) { return; }
    if (m.t === 'sim') {
      // The client built the round (ok) or can't simulate it (it keeps watching the video).
      if (p.sim !== 'pending') return;
      p.sim = m.ok ? 'running' : 'video';
      this._setVideo(p, !m.ok);
    } else if (m.t === 'need' && p.sim === 'running') {
      // Lockstep gap repair: resend frames the client never received.
      const frames = this.app.lockstep.frames || [];
      const from = Math.max(0, m.from | 0);
      if (from < frames.length) p.simCh.send(JSON.stringify({ t: 'fill', from, f: frames.slice(from, from + RESEND_MAX) }));
    } else if (m.t === 'desync' && p.sim === 'running') {
      console.warn(`[net] player ${p.dev} desynced at tick ${m.tick}; switching them to video`);
      p.sim = 'video';
      this._setVideo(p, true);
    }
  }

  /** Pause / resume the video stream to one player (paused while they simulate the round). */
  _setVideo(p, on) {
    if (!p.videoSender) return;
    const track = on ? (this.stream.getVideoTracks()[0] || null) : null;
    if (p.videoSender.track === track) return;
    p.videoSender.replaceTrack(track).catch((e) => console.warn('[net] replaceTrack', e));
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
    if (this.status !== 'connecting') { this._closeRooms(); return; } // closed again while opening
    if (!this.code && !this.internetCode) {
      this.status = 'error';
      this.error = this.internetError || this.lanError || 'Online play unavailable';
      this._changed();
      return;
    }
    Audio.onEvent = (kind, name, opts) => this.broadcast({ t: 'audio', kind, name, opts }, true);
    this._timer = setInterval(() => { this._syncUI(); this._renderChip(); }, UI_SYNC_MS);
    this._monitor = setInterval(() => this._checkLinks(), MONITOR_MS);
    this.status = 'hosting';
    this._changed();
  }

  /**
   * Close the room: tell every joined player (so they stop reconnecting),
   * then drop all connections and both rooms. Seats are forgotten.
   */
  stop() {
    if (this.status === 'offline') return;
    clearInterval(this._timer);
    clearInterval(this._monitor);
    const keys = [...this.players.keys()];
    for (const p of this.players.values()) if (p.ui.readyState === 'open') p.ui.send(JSON.stringify({ t: 'closed' }));
    // Let the goodbye go out first; closed rooms keep no seats for returning players.
    setTimeout(() => { keys.forEach((k) => this._lost(k)); this.lost.clear(); }, 300);
    this._closeRooms();
    this.devices.clear();
    this.lost.clear();
    Audio.onEvent = null;
    this.status = 'offline';
    this._renderChip();
    this._changed();
  }

  _closeRooms() {
    if (this.signal) { this.signal.onClose = null; this.signal.close(); }
    // Forget the Peer before destroying it, so its 'disconnected' event can't re-register the room.
    const peer = this.peer;
    this.signal = this.peer = null;
    if (peer) peer.destroy();
    this.code = this.lanJoinCode = this.internetCode = null;
    if (this.stream) { this.stream.getTracks().forEach((tr) => tr.stop()); this.stream = null; }
  }

  /**
   * Apply buffered remote input: one change per player per frame, so quick
   * taps that arrive bunched together in one network burst still register.
   * Called by the App right before InputManager.update().
   */
  pump() {
    if (this.lockstepActive) return; // during a round the lockstep driver takes the input per tick
    for (const p of this.players.values()) {
      if (!p.queue.length) continue;
      const s = this._nextInput(p);
      const c = this.app.input.controller(`net${p.dev}`);
      c.rawX = s.x; c.rawY = s.y; c.rawA = s.a; c.rawB = s.b;
    }
  }

  /** Send a message to every connected player. `droppable` messages are skipped on congested links. */
  broadcast(msg, droppable = false) {
    const text = JSON.stringify(msg);
    for (const p of this.players.values()) {
      if (!p.connected || p.ui.readyState !== 'open') continue;
      if (droppable && p.ui.bufferedAmount > UI_BACKLOG) continue;
      // Sounds of the simulation itself are made by each client's own copy of the round.
      if (this.inSimTick && p.sim === 'running') continue;
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
    // The short LAN join code needs this machine's network address.
    fetch('/netinfo').then((r) => r.json()).then((info) => {
      if (this.code === code && info.lanEnabled && Number(info.port) === PHONE_PORT) {
        this.lanJoinCode = makeJoinCode(code, info.lan);
        this._changed();
      }
    }).catch(() => {});
    this.signal.onMessage = (m) => {
      const key = `lan:${m.id ?? m.from}`;
      if (m.type === 'leave') this._lost(key); // the client page closed
      else if (m.type === 'msg') this._onSignal(key, m.data || {}, (data) => this.signal.send({ to: m.from, data }), 'lan');
      else if (m.type === 'error') { this.lanError = m.reason; this._changed(); }
    };
    this.signal.onClose = () => { this.code = this.lanJoinCode = null; this.lanError = 'Relay connection lost'; this._changed(); };
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
    // (Only for this Peer while it is the active room: destroy() also fires 'disconnected'.)
    const peer = this.peer;
    peer.on('disconnected', () => { if (this.peer === peer && !peer.destroyed) peer.reconnect(); });
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
    // UI snapshots carry whole parts plus a sequence number, so they can be
    // delivered unordered: one lost packet never holds back newer screens.
    const ui = pc.createDataChannel('ui', { ordered: false });
    const input = pc.createDataChannel('input', { ordered: false, maxRetransmits: 0 });
    // Lockstep rounds: reliable control messages, and frames that repeat the
    // last few ticks (so a lost packet is simply covered by the next one).
    const simCh = pc.createDataChannel('sim', { ordered: true });
    const framesCh = pc.createDataChannel('frames', { ordered: false, maxRetransmits: 0 });
    const p = {
      key, dev, route, pc, ui, input, simCh, framesCh, connected: false, lostTimer: null,
      last: {}, uiSeq: 0,                    // UI parts last sent + their sequence counter
      seq: -1, queue: [], state: null,       // input packets: newest seq, pending changes, last queued state
      cur: null,                             // input state currently applied
      pressA: 0, pressB: 0,                  // A/B presses seen (to recover presses lost in transit)
      rtt: null, relay: false, budget: route,
      sim: null,                             // lockstep round: null | 'pending' | 'running' | 'video'
      videoSender: null,
    };
    this.players.set(key, p);
    for (const track of this.stream.getTracks()) {
      const sender = pc.addTrack(track, this.stream);
      if (track.kind === 'video') p.videoSender = sender;
    }

    ui.onopen = () => this._welcome(p);
    ui.onclose = () => this._lost(key);
    input.onmessage = (e) => this._onInput(p, e.data);
    simCh.onmessage = (e) => this._onSimMessage(p, e.data);
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
    const budget = VIDEO[p.budget];
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

  /**
   * Every few seconds: measure each player's round-trip time and whether the
   * link runs through a TURN relay; relayed links get a lighter video stream.
   */
  async _checkLinks() {
    for (const p of this.players.values()) {
      if (!p.connected) continue;
      let pair = null;
      const kinds = {};
      try {
        const stats = await p.pc.getStats();
        stats.forEach((r) => { if (r.type === 'local-candidate' || r.type === 'remote-candidate') kinds[r.id] = r.candidateType; });
        stats.forEach((r) => { if (r.type === 'candidate-pair' && r.state === 'succeeded' && (r.nominated || r.selected)) pair = r; });
      } catch (_) { continue; }
      if (!pair) continue;
      p.rtt = pair.currentRoundTripTime != null ? Math.round(pair.currentRoundTripTime * 1000) : p.rtt;
      p.relay = kinds[pair.localCandidateId] === 'relay' || kinds[pair.remoteCandidateId] === 'relay';
      const budget = p.relay ? 'relay' : p.route;
      if (budget !== p.budget) { p.budget = budget; this._tuneVideo(p); }
    }
  }

  /** Corner badge on the host's menus: the join codes stay visible after HOST ONLINE. */
  _renderChip() {
    const stage = document.getElementById('stage');
    if (!stage) return;
    // Menus only: not during a round (briefing, play, results) nor on HOST ONLINE itself.
    const inRound = !!this.app.game;
    const onHostScreen = !!this.app.overlay.querySelector('.online-code');
    const show = this.status === 'hosting' && !inRound && !onHostScreen;
    if (!this._chip) {
      if (!show) return;
      this._chip = document.createElement('div');
      this._chip.className = 'net-chip';
      stage.appendChild(this._chip);
    }
    let html = '';
    if (show) {
      const codes = [];
      if (this.internetCode) codes.push(`${t('INTERNET CODE')} <b>${this.internetCode}</b>`);
      if (this.lanJoinCode) codes.push(`LAN <b>${this.lanJoinCode}</b>`);
      const players = [...this.players.values()].filter((p) => p.connected)
        .map((p) => `<span class="net-chip-p">P${p.dev}${p.rtt != null ? ` ${p.rtt} ms` : ''}${p.relay ? ' ⇄' : ''}</span>`).join('');
      html = `<span class="net-chip-dot"></span>${codes.join(' · ')}${players}`;
    }
    if (this._chip.innerHTML !== html) this._chip.innerHTML = html;
    this._chip.classList.toggle('hidden', !show);
  }

  /** First message to a newly connected player: full UI snapshot. */
  _welcome(p) {
    p.connected = true;
    const snap = this._snapshot();
    for (const k of Object.keys(snap)) p.last[k] = JSON.stringify(snap[k]);
    p.ui.send(JSON.stringify({ t: 'hello', s: ++p.uiSeq, id: p.dev, n: p.dev, ...snap }));
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

  /**
   * Remote controller packet {s, x, y, a, b, pa, pb}: s = sequence number,
   * pa/pb = how many times A/B were pressed so far. Changes are queued for
   * pump(); a press whose packets were all lost is re-created from pa/pb.
   * {t:'ping', c} packets are answered right away (the client shows its ping).
   */
  _onInput(p, text) {
    let s;
    try { s = JSON.parse(text); } catch (_) { return; }
    if (s.t === 'ping') { if (p.ui.readyState === 'open') p.ui.send(JSON.stringify({ t: 'pong', c: s.c })); return; }
    // Packets may arrive out of order: never let an older one overwrite a newer one.
    if (!Number.isFinite(s.s) || s.s <= p.seq) return;
    const first = p.seq < 0;
    p.seq = s.s;
    const num = (v) => (Number.isFinite(v) ? Math.max(-1, Math.min(1, v)) : 0);
    const st = { x: num(s.x), y: num(s.y), a: !!s.a, b: !!s.b };
    const pa = s.pa | 0, pb = s.pb | 0;
    if (first) { p.pressA = pa - (st.a ? 1 : 0); p.pressB = pb - (st.b ? 1 : 0); }
    const prev = p.queue.length ? p.queue[p.queue.length - 1] : (p.state || { x: 0, y: 0, a: false, b: false });
    // Lost presses: replay one press + release before the current state.
    if (pa - (st.a && !prev.a ? 1 : 0) > p.pressA && !st.a) { this._queue(p, { ...prev, a: true }); this._queue(p, { ...prev, a: false }); }
    if (pb - (st.b && !prev.b ? 1 : 0) > p.pressB && !st.b) { this._queue(p, { ...prev, b: true }); this._queue(p, { ...prev, b: false }); }
    p.pressA = pa; p.pressB = pb;
    this._queue(p, st);
  }

  /** Queue an input state if it differs from the last one (heartbeats are dropped). */
  _queue(p, st) {
    const prev = p.queue.length ? p.queue[p.queue.length - 1] : p.state;
    if (prev && prev.x === st.x && prev.y === st.y && prev.a === st.a && prev.b === st.b) return;
    p.queue.push(st);
    p.state = st;
    // Never build up lag: if changes pile up, keep only the newest ones.
    if (p.queue.length > INPUT_QUEUE) p.queue.splice(0, p.queue.length - INPUT_QUEUE);
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
      for (const k of Object.keys(parts)) {
        if (k === 'hud' && p.sim === 'running') continue; // the client draws its own HUD for the round
        if (parts[k] !== p.last[k]) { delta[k] = snap[k]; p.last[k] = parts[k]; }
      }
      if (Object.keys(delta).length) p.ui.send(JSON.stringify({ t: 'ui', s: ++p.uiSeq, ...delta }));
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
