/**
 * lockstep.js — online rounds run on every player's own device.
 *
 * Instead of streaming the host's screen, each device simulates the round
 * itself ("deterministic lockstep"):
 *
 *   1. The host picks a random seed and tells every client which simulation
 *      to build (NetHost.roundStart). All devices build it from that seed.
 *   2. After the briefing every device rebuilds a fresh copy from a second
 *      seed (roundPrepare), so the idle preview animation can't make them
 *      differ, and freezes it until tick 0.
 *   3. The host runs the round at a fixed 60 ticks per second. Each tick it
 *      collects one input per human seat — its own devices plus the latest
 *      input received from every online player — and simulates that tick.
 *      These input frames are numbered and sent to all clients.
 *   4. Clients simulate exactly the same frames. Same seed + same inputs +
 *      same code = the same game on every screen, rendered locally at full
 *      quality: no video, and each device draws at its own frame rate.
 *
 * The host never waits for anyone, so a slow connection can't slow down the
 * host's game. A client's own input reaches the simulation one network
 * round-trip later. Every HASH_EVERY ticks the host includes a checksum of
 * the game state; a client that ever disagrees falls back to watching the
 * host's video stream for the rest of the round (see client.js).
 */
import { clamp } from '../core/util.js';

export const TICK = 1 / 60;
export const PROTOCOL = 1;      // bump when the simulation or frame format changes
export const HISTORY = 8;       // frames repeated in every packet (packets may get lost)
export const HASH_EVERY = 30;   // ticks between state checksums
const MAX_TICKS_PER_FRAME = 4;  // host: catch up after a slow frame, but never spiral

/** Quantize one controller state into a compact, exactly reproducible frame entry. */
export function encodeInput(x, y, a, b) {
  return [Math.round(clamp(x, -1, 1) * 100), Math.round(clamp(y, -1, 1) * 100), (a ? 1 : 0) | (b ? 2 : 0)];
}

/** Write a frame entry into a seat controller (raw values; committed by stepGame). */
function applyInput(ctrl, q) {
  ctrl.rawX = q[0] / 100; ctrl.rawY = q[1] / 100;
  ctrl.rawA = (q[2] & 1) !== 0; ctrl.rawB = (q[2] & 2) !== 0;
}

/** Seats driven by frame entries, in frame order (every non-bot seat). */
export const humanSeats = (game) => game.seats.filter((s) => !s.isBot);

/** Simulate one tick with one input frame (identical on host and clients). */
export function stepGame(game, humans, frame) {
  if (game.state === 'preview') game.begin(); // tick 0 starts the round
  humans.forEach((s, i) => applyInput(s.ctrl, frame[i] || [0, 0, 0]));
  for (const s of game.seats) s.ctrl._commit();
  game.tick(TICK);
}

/** Checksum of the simulation state: alive flags, scores and avatar positions. */
export function stateHash(game) {
  let h = 0x811c9dc5;
  const mix = (v) => { h = Math.imul(h ^ (v | 0), 0x01000193); };
  mix(Math.round(game.time * 1000));
  for (const s of game.seats) {
    mix(s.alive ? 1 : 0);
    mix(Math.round((s.score || 0) * 1000));
    const p = s.subject && s.subject.root.position;
    if (p) { mix(Math.round(p.x * 1000)); mix(Math.round(p.y * 1000)); mix(Math.round(p.z * 1000)); }
  }
  return h >>> 0;
}

/**
 * Host side: runs the online round at a fixed tick rate and publishes the
 * input frames. App.frame() calls update() instead of game.tick().
 */
export class LockstepHost {
  constructor(app) {
    this.app = app;
    this.game = null;
  }

  get active() { return !!this.game; }

  /** Begin ticking `game` (built with ctx.lockstep = true) from tick 0. */
  start(game) {
    this.game = game;
    this.humans = humanSeats(game);
    this.frames = [];
    this.acc = 0;
    this.hash = null;
    this.app.net.lockstepActive = true;
  }

  stop() {
    this.game = null;
    this.app.net.lockstepActive = false;
  }

  update(dt) {
    if (!this.game) return;
    this.acc = Math.min(this.acc + dt, TICK * MAX_TICKS_PER_FRAME);
    let ran = 0;
    while (this.acc >= TICK - 1e-9 && ran < MAX_TICKS_PER_FRAME) {
      this.acc -= TICK;
      ran++;
      const frame = this.humans.map((s) => this._sample(s.player.device));
      this.frames.push(frame);
      this.app.net.inSimTick = true;
      try { stepGame(this.game, this.humans, frame); } finally { this.app.net.inSimTick = false; }
      const n = this.frames.length;
      if (n % HASH_EVERY === 0) this.hash = [n, stateHash(this.game)];
    }
    if (ran) this.app.net.sendFrames(this.frames, this.hash);
  }

  /** Current input of one human seat: local device, or the online player's latest packet. */
  _sample(device) {
    if (device.startsWith('net')) {
      const s = this.app.net.takeInput(device);
      return encodeInput(s.x, s.y, s.a, s.b);
    }
    const c = this.app.input.controller(device);
    return encodeInput(c.rawX, c.rawY, c.rawA, c.rawB);
  }
}

/**
 * Client side: follows the host's frames. Owns no game state of its own
 * beyond the running minigame; client.js builds the game and handles the UI.
 */
export class LockstepFollower {
  /** @param {*} game minigame built with ctx.lockstep = true (frozen at tick 0) */
  constructor(game) {
    this.game = game;
    this.humans = humanSeats(game);
    this.frames = [];           // frames[tick] = input frame
    this.next = 0;              // next tick to simulate
    this.acc = 0;
    this.reserve = 1;           // frames held back to absorb network jitter (grows if delivery is bumpy)
    this.starved = 0;           // seconds of short stalls recently
    this.stallLen = 0;          // length of the current stall
    this.smooth = 0;            // seconds without a stall
    this.hostHashes = new Map(); // tick → host checksum
    this.ownHashes = new Map();
    this.desynced = false;
  }

  /** Frame packet from the host: { n, f: last frames, h: [tick, hash] }. */
  receive(pkt) {
    const first = pkt.n - pkt.f.length;
    pkt.f.forEach((fr, i) => { if (this.frames[first + i] === undefined) this.frames[first + i] = fr; });
    if (pkt.h) { this.hostHashes.set(pkt.h[0], pkt.h[1]); this._checkHash(pkt.h[0]); }
  }

  /** Frames the host resent after a gap (reliable channel). */
  fill(from, frames) {
    frames.forEach((fr, i) => { if (this.frames[from + i] === undefined) this.frames[from + i] = fr; });
  }

  /** Newest frame number received. */
  get latest() { return this.frames.length; }

  /** First missing frame if we are stuck on a gap (for resend requests), else -1. */
  get gap() { return this.frames[this.next] === undefined && this.latest > this.next ? this.next : -1; }

  /**
   * Advance the simulation by real time `dt`, using frames as they arrive.
   * Runs extra ticks when frames pile up, waits when none are available.
   * @returns {boolean} false while stalled waiting for the host
   */
  update(dt) {
    if (this.desynced) return true;
    this.acc = Math.min(this.acc + dt, 0.25);
    const usable = () => this.latest - this.next - this.reserve;
    let budget = Math.floor(this.acc / TICK);
    if (usable() > 4) budget = Math.max(budget, Math.min(usable(), 8)); // fell behind: catch up
    if (budget <= 0) return true;
    let ran = 0;
    while (ran < budget && usable() > 0 && this.frames[this.next] !== undefined) {
      stepGame(this.game, this.humans, this.frames[this.next]);
      this.next++;
      ran++;
      if (this.next % HASH_EVERY === 0) { this.ownHashes.set(this.next, stateHash(this.game)); this._checkHash(this.next); }
    }
    this.acc = Math.max(0, this.acc - ran * TICK);
    if (ran < budget) {
      // Out of frames: wait.
      this.acc = 0;
      this.stallLen += dt;
      return false;
    }
    if (this.stallLen > 0) {
      // Short, repeated waits mean bumpy delivery → hold back one more frame.
      // Long ones (host paused, loading hitch) say nothing about the network.
      if (this.stallLen < 0.5) {
        this.starved += this.stallLen;
        if (this.starved > 0.2 && this.reserve < 6) { this.reserve++; this.starved = 0; }
      }
      this.stallLen = 0;
      this.smooth = 0;
    }
    // Smooth for a while → try a smaller reserve again (less delay).
    this.smooth += dt;
    if (this.smooth > 3) this.starved = 0;
    if (this.smooth > 10 && this.reserve > 1) { this.reserve--; this.smooth = 0; }
    return true;
  }

  _checkHash(tick) {
    const a = this.hostHashes.get(tick), b = this.ownHashes.get(tick);
    if (a === undefined || b === undefined) return;
    if (a !== b) this.desynced = true;
    this.hostHashes.delete(tick); this.ownHashes.delete(tick);
  }
}
