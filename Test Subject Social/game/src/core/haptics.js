/**
 * haptics.js — vibration feedback on phones.
 *
 * `Haptics.play(kind)` triggers a named feel. In the Android app it uses the
 * native bridge (system "tick/click/heavy" effects + shaped waveforms with
 * strength control); in mobile browsers it falls back to navigator.vibrate.
 * On PCs it does nothing.
 *
 * Most haptics come for free: `Haptics.fromSfx(name)` is hooked into the
 * audio engine, so impacts, shoves, explosions and countdown beeps in every
 * minigame vibrate without per-game code. A few personal events (your own
 * death, pressing the touch buttons) are triggered explicitly.
 */

/**
 * Feels: native = system effect name, or [timings ms, amplitudes 0-255]
 * (timings alternate off/on starting with an initial delay of 0).
 * prio decides which feel wins when several fire within a few frames.
 */
const FEELS = {
  tick:      { native: 'tick', prio: 0 },
  click:     { native: 'click', prio: 1 },
  press:     { wave: [[0, 14], [0, 90]], prio: 1 },
  countdown: { wave: [[0, 22], [0, 120]], prio: 2 },
  hit:       { wave: [[0, 35], [0, 180]], prio: 3 },
  error:     { wave: [[0, 30, 50, 30], [0, 160, 0, 160]], prio: 3 },
  go:        { wave: [[0, 60], [0, 220]], prio: 4 },
  heavy:     { native: 'heavy', wave: [[0, 70], [0, 255]], prio: 5 },
  explosion: { wave: [[0, 90, 30, 70], [0, 255, 0, 150]], prio: 6 },
  win:       { wave: [[0, 40, 60, 40, 60, 110], [0, 170, 0, 170, 0, 255]], prio: 6 },
  death:     { wave: [[0, 200, 70, 280], [0, 255, 0, 210]], prio: 9 },
};

/** Sound effect name → feel. Unlisted effects (ambience, ticks) stay silent. */
const SFX_FEELS = {
  select: 'click', join: 'click', back: 'tick', ding: 'click',
  beep: 'countdown', go: 'go', wrong: 'error', buzz: 'error',
  shove: 'hit', thud: 'hit', clank: 'press', metal: 'press', chisel: 'press', reload: 'tick',
  shot: 'heavy', crunch: 'heavy', splat: 'heavy', snap: 'heavy', horn: 'heavy', grind: 'heavy',
  explode: 'explosion', win: 'win',
};

const WINDOW_MS = 45; // feels closer together than this are merged (highest priority wins)

export const Haptics = {
  enabled: true,
  _lastAt: 0,
  _lastPrio: -1,
  _busyUntil: 0,

  /** True when this device can vibrate at all. */
  get supported() {
    return !!(window.AndroidBridge && window.AndroidBridge.vibrate) || typeof navigator.vibrate === 'function';
  },

  /** Play a named feel (see FEELS). */
  play(kind) {
    if (!this.enabled) return;
    const feel = FEELS[kind];
    if (!feel) return;
    const now = performance.now();
    if (now - this._lastAt < WINDOW_MS && feel.prio <= this._lastPrio) return;
    // A new vibration replaces the running one, so don't let small feels cut
    // off a longer, more important one (e.g. your death) that is still playing.
    if (now < this._busyUntil && feel.prio < this._lastPrio) return;
    this._lastAt = now;
    this._lastPrio = feel.prio;
    this._busyUntil = now + (feel.wave ? feel.wave[0].reduce((a, b) => a + b, 0) : 20);
    try {
      const bridge = window.AndroidBridge;
      if (bridge && bridge.vibrate) {
        if (feel.native && !(feel.prio >= 5 && feel.wave)) bridge.haptic(feel.native);
        else bridge.vibrate(feel.wave[0].join(','), feel.wave[1].join(','));
      } else if (typeof navigator.vibrate === 'function') {
        const timings = feel.wave ? feel.wave[0].slice(1) : [feel.native === 'heavy' ? 40 : feel.native === 'click' ? 18 : 8];
        navigator.vibrate(timings);
      }
    } catch (_) { /* vibration unavailable: ignore */ }
  },

  /** Hook for the audio engine: vibrate along with matching sound effects. */
  fromSfx(name) {
    const kind = SFX_FEELS[name];
    if (kind) this.play(kind);
  },
};
