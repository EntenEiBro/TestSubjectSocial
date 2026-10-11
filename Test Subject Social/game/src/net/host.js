/**
 * host.js — online hosting over Epic Online Services (see eos.js).
 *
 * HOST ONLINE opens an EOS lobby with a 6-letter code. Friends choose JOIN
 * ONLINE on their PC or phone, type the code, and talk to this machine
 * peer-to-peer. Three P2P channels per player:
 *
 *   CTRL    reliable, ordered   menus (overlay/HUD/backdrop snapshots), sounds,
 *                               round control (round / prepare / fill / end),
 *                               taps on the mirrored menus (lobby, see app.remoteTap)
 *   INPUT   unreliable          controller state {s, x, y, a, b, pa, pb}, pings
 *   FRAMES  unreliable          lockstep input frames during a round
 *
 * Rounds run on every player's own device (lockstep.js): the host sends the
 * round's seed, then one input frame per tick, and each client simulates and
 * renders the round itself. Between rounds every client draws its own copy
 * of the intake-room backdrop (the host sends what stands on the pedestals)
 * and mirrors the host's menus as HTML snapshots and sounds as event names.
 *
 * Remote input is written into an InputManager Controller with device id
 * `net<N>` (menus, lobby, briefing) and into the lockstep frames (rounds).
 * N is tied to the client's session token, so a player who drops out and
 * reconnects gets their seat back.
 */
import { Audio } from '../core/audio.js';
import { Net, CH, MODE } from './eos.js';
import { t } from '../i18n/i18n.js';
import { PROTOCOL, HISTORY } from './lockstep.js';

const NO_INPUT = Object.freeze({ x: 0, y: 0, a: false, b: false });
const RESEND_MAX = 120;         // frames per resend message (lockstep gap repair)
const UI_SYNC_MS = 50;          // UI checks per second: 20 (only changes are sent)
const GRACE_MS = 20000;         // a dropped player keeps their seat this long
const SILENT_MS = 10000;        // nothing heard from a player this long = connection lost
const INPUT_QUEUE = 8;          // max buffered input changes per player (≈8 frames)
const FRAME_PACKET = 1100;      // a frames message must fit in one EOS packet (unreliable)

export class NetHost {
  /** @param {*} app the main App (needs engine, input, overlay, hud, backdrop) */
  constructor(app) {
    this.app = app;
    this.code = null;          // room code (6 letters)
    this.status = 'offline';   // 'offline' | 'connecting' | 'hosting' | 'error'
    this.error = null;
    this.players = new Map();  // EOS user id → player (one per live connection)
    this.devices = new Map();  // client token → device number N (seat survives reconnects)
    this.lost = new Map();     // device number → time the connection was lost
    this._nextDev = 1;
    this._timer = null;
    this._chip = null;         // corner badge with the join code (host menus)
    this._audio = [];          // sound events queued for the next send
    this._off = [];
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
      if (!p.connected) continue;
      p.sim = 'pending';
      this._ctrl(p, { t: 'round', v: PROTOCOL, id: G.meta.id, seed, bot: botDifficulty, me: p.dev, players: roster });
    }
  }

  /** After the briefing: everyone rebuilds a fresh copy from `seed` and waits for tick 0. */
  roundPrepare(seed) {
    for (const p of this.players.values()) {
      if (p.sim === 'pending' || p.sim === 'running') this._ctrl(p, { t: 'prepare', seed });
    }
  }

  /** Publish the newest lockstep frames (the last HISTORY of them, in case packets get lost). */
  sendFrames(frames, hash) {
    const n = frames.length;
    let text;
    for (let keep = HISTORY; keep >= 1; keep--) {
      text = JSON.stringify({ n, f: frames.slice(Math.max(0, n - keep)), h: hash });
      if (text.length <= FRAME_PACKET) break;
    }
    for (const p of this.players.values()) {
      if (p.sim === 'running' && p.connected) Net.send(p.peer, CH.FRAMES, MODE.UNRELIABLE, text);
    }
  }

  /** The round is over (finished, skipped or aborted): clients return to the mirrored menus. */
  roundEnd() {
    for (const p of this.players.values()) {
      if (!p.sim) continue;
      this._ctrl(p, { t: 'end' });
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
    const t0 = this.lost.get(dev);
    return t0 !== undefined && performance.now() - t0 < GRACE_MS;
  }

  // ================================================================ the room

  /** Log in (if needed) and open the room. */
  async start() {
    if (this.status === 'hosting' || this.status === 'connecting') return;
    this.status = 'connecting';
    this.error = null;
    this._changed();
    try {
      await Net.ready();
      const code = await Net.host();
      if (this.status !== 'connecting') { Net.stop(); return; } // closed again while opening
      this.code = code;
    } catch (e) {
      if (this.status !== 'connecting') return;
      this.status = 'error';
      this.error = e.message === 'timeout' ? t('The online service is not reachable.') : e.message;
      this._changed();
      return;
    }
    this._off = [
      Net.on('msg', (e) => this._onMessage(e)),
      Net.on('peer-closed', (e) => this._lost(e.peer)),
    ];
    Audio.onEvent = (kind, name, opts) => { if (this.connectedCount) this._audio.push([kind, name, opts, this.inSimTick]); };
    this._timer = setInterval(() => { this._syncUI(); this._renderChip(); this._checkSilence(); }, UI_SYNC_MS);
    this.status = 'hosting';
    this._changed();
  }

  /**
   * Close the room: tell every joined player (so they stop reconnecting),
   * then drop all connections and the lobby. Seats are forgotten.
   */
  stop() {
    if (this.status === 'offline') return;
    clearInterval(this._timer);
    this._off.forEach((off) => off());
    this._off = [];
    for (const p of this.players.values()) this._ctrl(p, { t: 'closed' });
    Net.flush();
    // Let the goodbye go out before the connections close.
    setTimeout(() => Net.stop(), 300);
    for (const key of [...this.players.keys()]) this._lost(key);
    this.players.clear();
    this.devices.clear();
    this.lost.clear();
    Audio.onEvent = null;
    this._audio = [];
    this.code = null;
    this.status = 'offline';
    this._renderChip();
    this._changed();
  }

  /**
   * Once per frame, right before InputManager.update(): apply buffered remote
   * input (one change per player per frame, so quick taps that arrive bunched
   * in one network burst still register) and send queued sounds.
   */
  pump() {
    if (this._audio.length) {
      const all = this._audio;
      this._audio = [];
      for (const p of this.players.values()) {
        if (!p.connected) continue;
        // Sounds of the simulation itself are made by each client's own copy of the round.
        const list = p.sim === 'running' ? all.filter((a) => !a[3]) : all;
        if (list.length) this._ctrl(p, { t: 'audio', l: list.map((a) => [a[0], a[1], a[2]]) });
      }
    }
    if (this.lockstepActive) return; // during a round the lockstep driver takes the input per tick
    for (const p of this.players.values()) {
      if (!p.queue.length) continue;
      const s = this._nextInput(p);
      const c = this.app.input.controller(`net${p.dev}`);
      c.rawX = s.x; c.rawY = s.y; c.rawA = s.a; c.rawB = s.b;
    }
  }

  // ================================================================= players

  _ctrl(p, msg) { Net.send(p.peer, CH.CTRL, MODE.ORDERED, msg); }

  _onMessage(e) {
    let m;
    try { m = JSON.parse(e.data); } catch (_) { return; }
    let p = this.players.get(e.peer);
    if (e.ch === CH.CTRL && m.t === 'hello') { this._hello(e.peer, m); return; }
    if (!p) {
      // Someone we don't know (or forgot after a drop) is still sending: ask them to say hello again.
      if (e.ch === CH.INPUT && m.t !== 'ping') Net.send(e.peer, CH.CTRL, MODE.ORDERED, { t: 'rehello' });
      return;
    }
    p.heard = performance.now();
    if (e.ch === CH.INPUT) this._onInput(p, m);
    else if (e.ch === CH.CTRL) this._onSimMessage(p, m);
  }

  /** A client introduces itself (first contact, or again after a reconnect). */
  _hello(peer, m) {
    if (m.v !== PROTOCOL) {
      Net.send(peer, CH.CTRL, MODE.ORDERED, { t: 'refused', why: 'version' });
      return;
    }
    const token = String(m.token || peer);
    let dev = this.devices.get(token);
    if (dev === undefined) { dev = this._nextDev++; this.devices.set(token, dev); }
    // A reconnecting player replaces their old, dead link.
    for (const [k, other] of this.players) if (other.dev === dev && k !== peer) this.players.delete(k);
    this.lost.delete(dev);
    const p = {
      peer, dev, connected: true, heard: performance.now(),
      last: {}, uiSeq: 0,                    // UI parts last sent + their sequence counter
      seq: -1, queue: [], state: null,       // input packets: newest seq, pending changes, last queued state
      cur: null,                             // input state currently applied
      pressA: 0, pressB: 0,                  // A/B presses seen (to recover presses lost in transit)
      rtt: null,
      sim: null,                             // lockstep round: null | 'pending' | 'running' | 'off'
    };
    this.players.set(peer, p);
    const snap = this._snapshot();
    for (const k of Object.keys(snap)) p.last[k] = JSON.stringify(snap[k]);
    this._ctrl(p, { t: 'hello', s: ++p.uiSeq, id: dev, n: dev, ...snap });
    this._changed();
  }

  /** Round control messages from a client. */
  _onSimMessage(p, m) {
    if (m.t === 'sim') {
      // The client built the round (ok) or can't simulate it (it sits this round out).
      if (p.sim === 'pending') p.sim = m.ok ? 'running' : 'off';
    } else if (m.t === 'need' && p.sim === 'running') {
      // Lockstep gap repair: resend frames the client never received.
      const frames = this.app.lockstep.frames || [];
      const from = Math.max(0, m.from | 0);
      if (from < frames.length) this._ctrl(p, { t: 'fill', from, f: frames.slice(from, from + RESEND_MAX) });
    } else if (m.t === 'tap') {
      // A tap on the mirrored menu (phones): the current screen decides what it means.
      if (this.app.remoteTap) this.app.remoteTap(`net${p.dev}`, String(m.a || ''));
    } else if (m.t === 'desync') {
      console.warn(`[net] player ${p.dev} desynced at tick ${m.tick}`);
    } else if (m.t === 'bye') {
      this._lost(p.peer);
    }
  }

  /** No packets for a while (the client sends input heartbeats): treat the link as lost. */
  _checkSilence() {
    const now = performance.now();
    for (const p of [...this.players.values()]) if (now - p.heard > SILENT_MS) this._lost(p.peer);
  }

  /** A link died: free its input and start the seat's grace period. */
  _lost(key) {
    const p = this.players.get(key);
    if (!p) return;
    this.players.delete(key);
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
  _onInput(p, s) {
    if (s.t === 'ping') { Net.send(p.peer, CH.INPUT, MODE.UNRELIABLE, { t: 'pong', c: s.c }); if (s.r) p.rtt = s.r; return; }
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

  // ================================================================ UI mirror

  /** Corner badge on the host's menus: the join code stays visible after HOST ONLINE. */
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
      const players = [...this.players.values()].filter((p) => p.connected)
        .map((p) => `<span class="net-chip-p">P${p.dev}${p.rtt != null ? ` ${p.rtt} ms` : ''}</span>`).join('');
      html = `<span class="net-chip-dot"></span>${t('ROOM CODE')} <b>${this.code}</b>${players}`;
    }
    if (this._chip.innerHTML !== html) this._chip.innerHTML = html;
    this._chip.classList.toggle('hidden', !show);
  }

  /** Current overlay / HUD / toast markup and what stands in the intake room. */
  _snapshot() {
    const ov = this.app.overlay, hud = this.app.hud.root;
    const toasts = [...document.querySelectorAll('#stage > .toast')].map((el) => el.outerHTML).join('');
    return { ov: [ov.className, ov.innerHTML], hud: [hud.className, hud.innerHTML], toasts, bd: this.app.backdrop.state() };
  }

  /**
   * Send each player only the UI parts that changed since what they last
   * received (reliable + ordered, so nothing is lost or arrives stale).
   */
  _syncUI() {
    if (!this.connectedCount) return;
    const snap = this._snapshot();
    const parts = Object.fromEntries(Object.keys(snap).map((k) => [k, JSON.stringify(snap[k])]));
    for (const p of this.players.values()) {
      if (!p.connected) continue;
      const delta = {};
      for (const k of Object.keys(parts)) {
        if (k === 'hud' && p.sim === 'running') continue; // the client draws its own HUD for the round
        if (parts[k] !== p.last[k]) { delta[k] = snap[k]; p.last[k] = parts[k]; }
      }
      if (Object.keys(delta).length) this._ctrl(p, { t: 'ui', s: ++p.uiSeq, ...delta });
    }
  }

  _changed() { if (this.onChange) this.onChange(); }
}
