/**
 * eos.js — the game's link to Epic Online Services (EOS).
 *
 * EOS itself is a native library, so each shell provides a small bridge
 * with the same command set:
 *
 *   desktop   play.py / eos_bridge.py (Python + ctypes)  window.pywebview.api.eos_*
 *   android   EosBridge.java + libtss_eos.so (JNI)        window.AndroidEOS.*
 *   dev       serve.py --eos (same Python bridge)          HTTP: /eos/cmd + /eos/events
 *
 * Commands: status, host, join(code), send([[peer, channel, mode, text], …]), stop.
 * Events arrive through window.__eosEvents([...]) (desktop/android) or a
 * long-poll (dev): ready, hosted {code}, joined {host}, peer-open {peer},
 * peer-closed {peer}, msg {peer, ch, data}, error {op, code, message}.
 *
 * Players log in anonymously (EOS Connect device ID: no Epic account).
 * A room is an EOS lobby tagged with a 6-letter code; the joiner looks it up
 * and talks to the lobby owner peer-to-peer (EOS P2P, through Epic's relay
 * servers when a direct route is impossible). Messages of any size are fine:
 * the bridges split them into EOS packets and reassemble them.
 */

/** P2P channels. */
export const CH = { CTRL: 0, INPUT: 1, FRAMES: 2 };
/** Delivery modes (EOS_EPacketReliability). */
export const MODE = { UNRELIABLE: 0, RELIABLE: 1, ORDERED: 2 };

const CODE_ALPHABET = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789'; // no 0/O/1/I

/** Normalise a typed room code; null unless it is 6 valid symbols. */
export function parseRoomCode(text) {
  const clean = String(text || '').toUpperCase().replace(/[^A-Z0-9]/g, '');
  return clean.length === 6 && [...clean].every((ch) => CODE_ALPHABET.includes(ch)) ? clean : null;
}

function pickBackend() {
  if (window.AndroidEOS) {
    const b = window.AndroidEOS;
    return {
      kind: 'android',
      call: async (op, arg) => {
        if (op === 'status') return JSON.parse(b.status());
        if (op === 'send') return b.send(JSON.stringify(arg));
        if (op === 'join') return b.join(arg);
        return b[op]();
      },
    };
  }
  if (window.pywebview && window.pywebview.api && window.pywebview.api.eos_status) {
    const api = window.pywebview.api;
    return {
      kind: 'desktop',
      call: (op, arg) => (op === 'send' ? api.eos_send(JSON.stringify(arg)) : arg !== undefined ? api[`eos_${op}`](arg) : api[`eos_${op}`]()),
    };
  }
  // Development server (python serve.py --eos): same bridge, reached over HTTP.
  // ?eosdev=/eos2 picks the second player's bridge on the side-by-side test page (/__duo.html).
  const prefix = new URLSearchParams(location.search).get('eosdev') === '/eos2' ? '/eos2' : '/eos';
  return {
    kind: 'dev',
    prefix,
    call: async (op, arg) => {
      const r = await fetch(`${prefix}/cmd`, { method: 'POST', body: JSON.stringify({ op, arg }) });
      if (!r.ok) throw new Error('no EOS bridge');
      return r.json();
    },
    poll: true,
  };
}

class EOSLink {
  constructor() {
    this.backend = null;
    this.listeners = new Map();
    this.outbox = [];
    this._flushQueued = false;
    this._polling = false;
    this.recent = [];
    window.__eosLog = this.recent;
    window.__eosEvents = (batch) => this._deliver(typeof batch === 'string' ? JSON.parse(batch) : batch);
  }

  _b() {
    // pywebview may inject its API after the first call: prefer a native bridge once it appears.
    const native = window.AndroidEOS || (window.pywebview && window.pywebview.api && window.pywebview.api.eos_status);
    if (!this.backend || (this.backend.kind === 'dev' && native)) {
      this.backend = pickBackend();
      if (this.backend.poll) this._poll();
    }
    return this.backend;
  }

  /** Subscribe to an event type ('msg', 'peer-closed', …); returns an unsubscribe function. */
  on(type, fn) {
    if (!this.listeners.has(type)) this.listeners.set(type, new Set());
    this.listeners.get(type).add(fn);
    return () => this.listeners.get(type).delete(fn);
  }

  _deliver(batch) {
    for (const e of batch) {
      // Last few events, for debugging in the console (window.__eosLog).
      this.recent.push([Math.round(performance.now()), e.type, e.ch, e.data ? e.data.slice(0, 48) : '']);
      if (this.recent.length > 100) this.recent.shift();
      const set = this.listeners.get(e.type);
      if (set) for (const fn of [...set]) { try { fn(e); } catch (err) { console.error('[eos]', err); } }
    }
  }

  async _poll() {
    if (this._polling) return;
    this._polling = true;
    let after = -1; // cursor into the server's event log
    for (;;) {
      if (this.backend.kind !== 'dev') { this._polling = false; return; } // a native bridge took over
      try {
        const r = await fetch(`${this.backend.prefix}/events?after=${after}`, { cache: 'no-store' });
        if (!r.ok) throw new Error(String(r.status));
        const res = await r.json();
        after = res.last;
        if (res.events.length) this._deliver(res.events);
      } catch (_) {
        await new Promise((res) => setTimeout(res, 2000)); // no dev bridge (plain serve.py): retry slowly
      }
    }
  }

  /** {state: 'starting'|'ready'|'error'|'unavailable', user, code, message?} */
  async status() {
    try {
      return await this._b().call('status');
    } catch (e) {
      return { state: 'unavailable', message: String(e && e.message || e) };
    }
  }

  /** Resolves once logged in to EOS; rejects with a readable message otherwise. */
  async ready(timeoutMs = 20000) {
    const end = performance.now() + timeoutMs;
    for (;;) {
      const s = await this.status();
      if (s.state === 'ready') return s;
      if (s.state === 'error' || s.state === 'unavailable') throw new Error(s.message || s.state);
      if (performance.now() > end) throw new Error('timeout');
      await new Promise((res) => setTimeout(res, 250));
    }
  }

  /** Wait for one event of `type` (or an 'error' for operation `op`). */
  _await(type, op, timeoutMs) {
    return new Promise((resolve, reject) => {
      const done = () => { offOk(); offErr(); clearTimeout(timer); };
      const offOk = this.on(type, (e) => { done(); resolve(e); });
      const offErr = this.on('error', (e) => { if (e.op === op) { done(); reject(Object.assign(new Error(e.message), { code: e.code })); } });
      const timer = setTimeout(() => { done(); reject(new Error('timeout')); }, timeoutMs);
    });
  }

  /** Open a room; resolves with its 6-letter code. */
  async host() {
    const wait = this._await('hosted', 'host', 20000);
    await this._b().call('host');
    return (await wait).code;
  }

  /** Find a room by code; resolves with the host's user id. */
  async join(code) {
    const wait = this._await('joined', 'join', 20000);
    await this._b().call('join', code);
    return (await wait).host;
  }

  /** Queue a message (sent with everything else queued this frame, in one bridge call). */
  send(peer, channel, mode, msg) {
    this.outbox.push([peer, channel, mode, typeof msg === 'string' ? msg : JSON.stringify(msg)]);
    if (!this._flushQueued) {
      this._flushQueued = true;
      queueMicrotask(() => this.flush());
    }
  }

  flush() {
    this._flushQueued = false;
    if (!this.outbox.length) return;
    const batch = this.outbox;
    this.outbox = [];
    Promise.resolve(this._b().call('send', batch)).catch(() => {});
  }

  /** Leave / close the room and drop every connection. */
  stop() {
    this.flush();
    Promise.resolve(this._b().call('stop')).catch(() => {});
  }
}

export const Net = new EOSLink();
