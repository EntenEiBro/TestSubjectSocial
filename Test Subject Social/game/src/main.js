/**
 * main.js — application bootstrap and top-level menu loop.
 *
 * The App owns the long-lived systems (renderer, input, HUD, menu backdrop,
 * settings, roster) and runs the linear menu flow:
 *
 *   title → lobby → program select → program (rounds) → final → title …
 *
 * Debug / quick-launch URL parameters:
 *   ?game=<id>        jump straight into one simulation (see minigames/index.js)
 *   &file=<name>.js   load an unregistered minigame module from src/minigames/
 *   &players=N        number of participants (default 4)
 *   &humans=N         how many of them are keyboard humans (default 0 = all bots)
 *   &quick            skip title card + briefing
 *   &loop             replay the chosen game forever (soak testing)
 *   ?join=CODE        open as an online client of a hosted room (see net/)
 */
import { Engine, RESOLUTIONS } from './core/engine.js';
import { InputManager } from './core/input.js';
import { Audio } from './core/audio.js';
import { FXSettings } from './core/fx.js';
import { queryParams } from './core/util.js';
import { Hud } from './ui/hud.js';
import { Backdrop } from './ui/backdrop.js';
import * as S from './ui/screens.js';
import { Player } from './game/players.js';
import { playProgram, playRound } from './game/flow.js';
import { REGISTRY, findGame } from './minigames/index.js';
import { Commendations } from './game/achievements.js';
import { NetHost } from './net/host.js';
import { runClient } from './net/client.js';
import { TouchControls, isTouchDevice } from './ui/touch.js';

const SETTINGS_KEY = 'tss.settings.v1';

class App {
  constructor() {
    // resHeight replaces the old resLevel setting; everyone starts at 1080p.
    this.settings = { master: 0.8, music: 0.5, sfx: 0.9, botLevel: 1, resHeight: 1080, gore: true };
    try { Object.assign(this.settings, JSON.parse(localStorage.getItem(SETTINGS_KEY) || '{}')); } catch (_) { /* storage unavailable */ }
    delete this.settings.resLevel;
    if (!RESOLUTIONS.some((r) => r.h === this.settings.resHeight)) this.settings.resHeight = 1080;
    this.engine = new Engine(document.getElementById('view'), { renderHeight: this.settings.resHeight });
    this.input = new InputManager();
    this.hud = new Hud(document.getElementById('hud'));
    this.overlay = document.getElementById('overlay');
    this.backdrop = new Backdrop();
    this.net = new NetHost(this); // online hosting (idle until started from the menu)
    this.players = [];
    this.game = null;
    this.quick = false;
    this._frameHandlers = new Set();
    this._pauseWaiters = [];
    this.paused = false;
    Audio.setVolume('master', this.settings.master);
    Audio.setVolume('music', this.settings.music);
    Audio.setVolume('sfx', this.settings.sfx);
    FXSettings.gore = this.settings.gore ? 1 : 0.25;
    // Native shells: desktop (pywebview) or Android app. Both offer QUIT;
    // the desktop one also toggles fullscreen on F11.
    this.platform = window.AndroidBridge ? 'android' : window.pywebview ? 'desktop' : 'web';
    this.desktop = window.pywebview ? window.pywebview.api
      : window.AndroidBridge ? { quit: () => window.AndroidBridge.quit(), toggle_fullscreen: () => {} }
      : null;
    window.addEventListener('keydown', (e) => {
      if (e.code === 'F11' && this.desktop) { e.preventDefault(); this.desktop.toggle_fullscreen(); }
    });
    // On-screen controls on phones and tablets.
    this.touch = isTouchDevice() ? new TouchControls(this.input) : null;
    Commendations.onUnlock = (def) => this.toast(`COMMENDATION — ${def.title}`, def.desc);
    this.showBackdrop();
    this.engine.start((dt) => this.frame(dt));
    window.__app = this; // handy for debugging in the console
  }

  /** Subscribe a per-frame handler; returns an unsubscribe function. */
  onFrame(fn) { this._frameHandlers.add(fn); return () => this._frameHandlers.delete(fn); }

  /** Promise that resolves with the pause-menu choice if the round is aborted/skipped. */
  pauseSignal() { return new Promise((res) => this._pauseWaiters.push(res)); }

  frame(dt) {
    this.input.update();
    for (const fn of [...this._frameHandlers]) fn(dt);
    if (this.game && !this.paused) {
      this.game.tick(dt);
      const pausePressed = this.input.keyPressed('Escape') || this.input.actionPressed('pause')
        || [0, 1, 2, 3].some((i) => this.input.padPressed(i, 9));
      if (this.game && this.game.state === 'play' && pausePressed) this.openPause();
    } else if (!this.game) {
      this.backdrop.update(dt);
    }
    this.input.endFrame();
  }

  /**
   * Test hook: advance the simulation `seconds` in fixed 1/60 s steps and
   * render once. Works even when the tab is hidden (rAF paused).
   * Note: screen transitions that use real-time timers still need real time.
   */
  step(seconds = 1) {
    const n = Math.round(seconds * 60);
    for (let i = 0; i < n; i++) this.frame(1 / 60);
    this.engine.renderer.render(this.engine.scene, this.engine.camera);
    return this.game ? { game: this.game.meta.id, state: this.game.state, time: +this.game.time.toFixed(1) } : null;
  }

  async openPause() {
    this.paused = true;
    this.engine.timeScale = 0;
    this.input.endFrame(); // consume the ESC press
    if (this.touch) this.touch.setContext(null); // let the pause menu be tapped
    const choice = await S.pauseScreen(this);
    this.paused = false;
    this.engine.timeScale = 1;
    if (this.touch && choice === 'resume') this.touch.setContext('play');
    if (choice !== 'resume') { const w = this._pauseWaiters; this._pauseWaiters = []; w.forEach((r) => r(choice)); }
  }

  /** Slide-in notification (commendations). */
  toast(title, body = '') {
    const el = document.createElement('div');
    el.className = 'toast';
    el.innerHTML = `<b>${title}</b><span>${body}</span>`;
    document.getElementById('stage').appendChild(el);
    Audio.sfx('ding');
    setTimeout(() => el.classList.add('out'), 3800);
    setTimeout(() => el.remove(), 4500);
  }

  showBackdrop() { this.engine.setScene(this.backdrop.scene, this.backdrop.camera); }

  applyResolution() { this.engine.setRenderHeight(this.settings.resHeight); }

  saveSettings() {
    FXSettings.gore = this.settings.gore ? 1 : 0.25;
    try { localStorage.setItem(SETTINGS_KEY, JSON.stringify(this.settings)); } catch (_) { /* ignore */ }
  }

  // ------------------------------------------------------------------- flows

  async run() {
    const q = queryParams();
    if (q.has('game')) return this.quickLaunch(q);
    for (;;) {
      const choice = await S.titleScreen(this);
      if (choice === 'options') { await S.optionsScreen(this); continue; }
      if (choice === 'manual') { await S.manualScreen(this, REGISTRY); continue; }
      if (choice === 'credits') { await S.creditsScreen(this); continue; }
      if (choice === 'commendations') { await S.commendationsScreen(this, REGISTRY); continue; }
      if (choice === 'online' && (await S.onlineScreen(this)) !== 'play') continue;
      if (choice === 'quit') { this.desktop.quit(); return; }
      if (choice === 'join') { await S.joinScreen(this); continue; }
      // play
      for (;;) {
        const roster = await S.lobbyScreen(this);
        if (!roster) break;
        let mode = null;
        for (;;) {
          const m = await S.modeScreen(this);
          if (!m) break;
          if (m === 'custom') { const c = await S.customScreen(this, REGISTRY); if (!c) continue; mode = c; } else mode = m;
          break;
        }
        if (!mode) continue;
        await playProgram(this, mode);
        break;
      }
    }
  }

  /** Debug path: jump straight into a simulation with bots. */
  async quickLaunch(q) {
    let G = findGame(q.get('game'));
    if (!G && q.has('file')) {
      // Load an unregistered minigame module directly (development aid).
      const mod = await import(`./minigames/${q.get('file')}`);
      G = Object.values(mod).find((v) => v && v.meta && v.meta.id === q.get('game')) || null;
    }
    if (!G) { this.overlay.innerHTML = `<div class="panel-screen"><h1>UNKNOWN GAME</h1><p>${REGISTRY.map((g) => g.meta.id).join(', ')}</p></div>`; return; }
    const n = q.int('players', 4), humans = q.int('humans', 0);
    const devices = ['kb1', 'kb2', 'pad0', 'pad1'];
    this.players = Array.from({ length: n }, (_, i) => new Player(i, i < humans ? devices[i] : 'bot'));
    this.quick = q.has('quick');
    do {
      this.players.forEach((p) => p.resetStats());
      await playRound(this, G, 0, 1);
    } while (q.has('loop'));
    await S.standings(this, this.players);
  }
}

// Wait (briefly) for the web fonts so canvas-painted stencils use them.
const fontsReady = document.fonts ? document.fonts.load('80px "Black Ops One"').catch(() => {}) : Promise.resolve();
// `?join=CODE` turns this page into a remote controller/viewer for an online host.
const joinCode = new URLSearchParams(location.search).get('join');
// In the desktop build pywebview injects its API shortly after load.
const desktopReady = window.pywebview ? Promise.resolve()
  : new Promise((r) => { window.addEventListener('pywebviewready', r, { once: true }); setTimeout(r, 600); });
Promise.all([Promise.race([fontsReady, new Promise((r) => setTimeout(r, 2500))]), desktopReady])
  .then(() => (joinCode ? runClient(joinCode.toUpperCase()) : new App().run()));
