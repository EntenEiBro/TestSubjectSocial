/**
 * remoteround.js — an online client's own copy of the current round.
 *
 * When the host starts a round, the client builds the same minigame from the
 * same seed and roster, renders it with its own engine (instead of the
 * intake-room backdrop) and simulates it from the host's lockstep input
 * frames (lockstep.js). Menus, the briefing text, the countdown and results
 * stay mirrored from the host; the in-round HUD is drawn locally (in this
 * device's language, with this device's button prompts).
 *
 * If the local copy ever disagrees with the host's checksum, the client
 * tells the host and keeps playing: the host's copy decides the results.
 */
import { Haptics } from '../core/haptics.js';
import { seedRandom } from '../core/rng.js';
import { Hud } from '../ui/hud.js';
import { Player } from '../game/players.js';
import { findGame } from '../minigames/index.js';
import { LockstepFollower, PROTOCOL } from './lockstep.js';

const NEED_RETRY_S = 0.3; // ask the host to resend missing frames at most this often

export class RemoteRound {
  /**
   * @param {object} o
   * @param {*} o.engine                  the client's engine (shared with the backdrop)
   * @param {() => void} o.onEnd          show the backdrop again
   * @param {(desynced: boolean) => void} o.onSync  sync state changed (badge)
   * @param {HTMLElement} o.hudEl         HUD root (local HUD during rounds, mirrored otherwise)
   * @param {*} o.input                   the client's InputManager (only for the game ctx)
   * @param {boolean} o.touch             this device plays with the on-screen controls
   * @param {(msg: object) => void} o.send  control message to the host
   */
  constructor({ engine, onEnd, onSync, hudEl, input, touch, send }) {
    Object.assign(this, { engine, onEnd, onSync, hudEl, input, touch, send });
    this.game = null;
    this.follower = null;
    this.hud = null;
    this.round = null;     // the host's 'round' message (seed, roster…)
    this.needT = 0;
    this.desyncSent = false;
  }

  /** True while this device draws the round itself (mirrored HUD is ignored). */
  get active() { return !!this.game; }

  /** Host: a round begins — build it here from the same seed (shown behind the briefing). */
  start(msg) {
    this.end();
    try {
      if (msg.v !== PROTOCOL) throw new Error(`protocol ${msg.v} ≠ ${PROTOCOL}`);
      this.round = msg;
      this._build(msg.seed);
      this.send({ t: 'sim', ok: true });
    } catch (e) {
      console.warn('[net] cannot run this round locally', e);
      this.end();
      this.send({ t: 'sim', ok: false });
    }
  }

  /** Host: briefing over — rebuild a fresh copy and wait for tick 0. */
  prepare(msg) {
    if (!this.round) return;
    try {
      this._build(msg.seed);
      this.hud.setPlayers(this.game.seats);
      this.hud.show();
      this.follower = new LockstepFollower(this.game);
      Haptics.roundActive = true; // only our own subject's events vibrate now
    } catch (e) {
      console.warn('[net] rebuild failed', e);
      this.end();
    }
  }

  /** Lockstep frames from the host. */
  frames(pkt) { if (this.follower) this.follower.receive(pkt); }

  /** Frames resent by the host after a gap. */
  fill(msg) { if (this.follower) this.follower.fill(msg.from, msg.f); }

  /** Host: round over — back to the mirrored menus. */
  end() {
    Haptics.roundActive = false;
    const had = !!this.game;
    if (this.game) this.game.dispose();
    this.game = this.follower = this.round = null;
    if (this.hud) { this.hud.hide(); this.hud = null; }
    if (this.desyncSent) { this.desyncSent = false; this.onSync(false); }
    if (had) this.onEnd();
  }

  /** Per rendered frame: preview animation, or lockstep ticks from the host's frames. */
  update(dt) {
    const game = this.game;
    if (!game) return;
    if (!this.follower) {
      game.tick(dt); // briefing preview (cosmetic; rebuilt before the round starts)
      return;
    }
    this.follower.update(dt);
    if (this.follower.desynced && !this.desyncSent) {
      this.desyncSent = true;
      this.send({ t: 'desync', tick: this.follower.next });
      this.onSync(true);
    }
    // Stuck on a missing frame while newer ones exist → ask for a resend.
    this.needT -= dt;
    const gap = this.follower.gap;
    if (gap >= 0 && this.needT <= 0) { this.needT = NEED_RETRY_S; this.send({ t: 'need', from: gap }); }
  }

  // ------------------------------------------------------------------ internals

  _build(seed) {
    const G = findGame(this.round.id);
    if (!G) throw new Error(`unknown simulation ${this.round.id}`);
    if (this.game) this.game.dispose();
    this.game = null;
    // A fresh HUD each time (between rounds the HUD element shows the host's mirrored HUD).
    this.hud = new Hud(this.hudEl);
    this.hudEl.className = 'hidden';
    seedRandom(seed);
    const game = new G({
      engine: this.engine, input: this.input, hud: this.hud,
      players: this._roster(), botDifficulty: this.round.bot, lockstep: true,
    });
    game.build();
    game.prewarm();
    game.state = 'preview';
    this.engine.setScene(game.scene, game.camera);
    this.game = game;
    this.follower = null;
  }

  /** The host's roster as local Players: our seat is played here, the others are remote. */
  _roster() {
    const me = `net${this.round.me}`;
    return this.round.players.map((d) => {
      const mine = d.device === me;
      const device = d.device === 'bot' ? 'bot' : mine ? (this.touch ? 'touch' : 'kb1') : 'remote';
      const p = new Player(d.slot, device);
      p.look = { ...d.look };
      p.lookIndex = { ...d.lookIndex };
      p.remote = !mine && device !== 'bot'; // no commendations / haptics for other people's seats
      return p;
    });
  }
}
