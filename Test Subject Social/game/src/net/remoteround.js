/**
 * remoteround.js — an online client's own copy of the current round.
 *
 * When the host starts a round, the client builds the same minigame from the
 * same seed and roster, renders it on its own canvas (instead of the host's
 * video) and simulates it from the host's lockstep input frames (lockstep.js).
 * Menus, the briefing text, the countdown and results stay mirrored from the
 * host; the in-round HUD is drawn locally (in this device's language, with
 * this device's button prompts).
 *
 * If the local copy ever disagrees with the host's checksum, or the round
 * can't be built here, the client reports it and simply keeps watching the
 * host's video for the rest of the round.
 */
import { Engine } from '../core/engine.js';
import { FXSettings } from '../core/fx.js';
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
   * @param {HTMLCanvasElement} o.canvas  local render target
   * @param {HTMLVideoElement} o.video    the host's stream (hidden while the round runs here)
   * @param {HTMLElement} o.hudEl         HUD root (local HUD during rounds, mirrored otherwise)
   * @param {*} o.input                   the client's InputManager (only for the game ctx)
   * @param {boolean} o.touch             this device plays with the on-screen controls
   * @param {(msg: object) => void} o.send  control message to the host ('sim' channel)
   */
  constructor({ canvas, video, hudEl, input, touch, send }) {
    Object.assign(this, { canvas, video, hudEl, input, touch, send });
    this.engine = null;
    this.game = null;
    this.follower = null;
    this.hud = null;
    this.round = null;     // the host's 'round' message (seed, roster…)
    this.needT = 0;
  }

  /** True while this device draws the round itself (mirrored HUD/video are ignored). */
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
      console.warn('[net] cannot run this round locally, watching the video instead', e);
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
      this._fallback(-1);
    }
  }

  /** Lockstep frames from the host. */
  frames(pkt) { if (this.follower) this.follower.receive(pkt); }

  /** Frames resent by the host after a gap. */
  fill(msg) { if (this.follower) this.follower.fill(msg.from, msg.f); }

  /** Host: round over (or this client fell back to video) — back to the mirrored view. */
  end() {
    Haptics.roundActive = false;
    if (this.game) this.game.dispose();
    this.game = this.follower = this.round = null;
    if (this.engine) this.engine.idle = true;
    this.canvas.style.display = 'none';
    this.video.style.display = '';
    if (this.hud) { this.hud.hide(); this.hud = null; }
  }

  // ------------------------------------------------------------------ internals

  _build(seed) {
    if (!this.engine) this._createEngine();
    const G = findGame(this.round.id);
    if (!G) throw new Error(`unknown simulation ${this.round.id}`);
    if (this.game) this.game.dispose();
    // A fresh HUD each time (between rounds the HUD element shows the host's mirrored HUD).
    this.hud = new Hud(this.hudEl);
    this.hudEl.className = 'hidden';
    seedRandom(seed);
    const game = new G({
      engine: this.engine, input: this.input, hud: this.hud,
      players: this._roster(), botDifficulty: this.round.bot, lockstep: true,
    });
    game.build();
    game.state = 'preview';
    this.engine.setScene(game.scene, game.camera);
    this.game = game;
    this.follower = null;
    this.engine.idle = false;
    this.canvas.style.display = '';
    this.video.style.display = 'none';
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

  _createEngine() {
    let settings = {};
    try { settings = JSON.parse(localStorage.getItem('tss.settings.v1') || '{}'); } catch (_) { /* no storage */ }
    FXSettings.gore = settings.gore === false ? 0.25 : 1;
    this.engine = new Engine(this.canvas, { renderHeight: settings.resHeight || 1080 });
    this.engine.start((dt, raw) => this._frame(raw));
  }

  /** Per rendered frame: preview animation, or lockstep ticks from the host's frames. */
  _frame(dt) {
    const game = this.game;
    if (!game) return;
    if (!this.follower) {
      game.tick(dt); // briefing preview (cosmetic; rebuilt before the round starts)
      return;
    }
    this.follower.update(dt);
    if (this.follower.desynced) { this._fallback(this.follower.next); return; }
    // Stuck on a missing frame while newer ones exist → ask for a resend.
    this.needT -= dt;
    const gap = this.follower.gap;
    if (gap >= 0 && this.needT <= 0) { this.needT = NEED_RETRY_S; this.send({ t: 'need', from: gap }); }
  }

  /** Our copy went out of sync: tell the host and watch its video for the rest of the round. */
  _fallback(tick) {
    this.send({ t: 'desync', tick });
    this.end();
  }
}
