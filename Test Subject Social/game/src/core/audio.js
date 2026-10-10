/**
 * audio.js — fully synthesized sound (no audio files needed).
 *
 * `Audio.sfx(name)` plays a short procedural effect; `Audio.music(name)`
 * starts a looping industrial drone/percussion bed. Everything is generated
 * with the Web Audio API so the project ships without binary assets.
 */

class AudioEngine {
  constructor() {
    this.ctx = null;
    this.master = null;
    this.musicGain = null;
    this.sfxGain = null;
    this.volume = { master: 0.8, music: 0.5, sfx: 0.9 };
    this._music = null;
    this._noiseBuf = null;
    /** Optional observer `(kind: 'sfx'|'music', name, opts)` — used by online hosting. */
    this.onEvent = null;
    // Browsers require a user gesture before audio can start.
    const unlock = () => { this.init(); window.removeEventListener('keydown', unlock); window.removeEventListener('pointerdown', unlock); };
    window.addEventListener('keydown', unlock);
    window.addEventListener('pointerdown', unlock);
  }

  init() {
    if (this.ctx) { if (this.ctx.state === 'suspended') this.ctx.resume(); return; }
    const AC = window.AudioContext || window.webkitAudioContext;
    if (!AC) return;
    this.ctx = new AC();
    this.master = this.ctx.createGain();
    this.master.gain.value = this.volume.master;
    this.master.connect(this.ctx.destination);
    this.musicGain = this.ctx.createGain();
    this.musicGain.gain.value = this.volume.music;
    this.musicGain.connect(this.master);
    this.sfxGain = this.ctx.createGain();
    this.sfxGain.gain.value = this.volume.sfx;
    this.sfxGain.connect(this.master);
    // 2 seconds of white noise reused by every noisy effect.
    const len = this.ctx.sampleRate * 2;
    this._noiseBuf = this.ctx.createBuffer(1, len, this.ctx.sampleRate);
    const d = this._noiseBuf.getChannelData(0);
    for (let i = 0; i < len; i++) d[i] = Math.random() * 2 - 1;
    if (this._pendingMusic) { const m = this._pendingMusic; this._pendingMusic = null; this.music(m); }
  }

  setVolume(kind, v) {
    this.volume[kind] = v;
    if (!this.ctx) return;
    ({ master: this.master, music: this.musicGain, sfx: this.sfxGain })[kind].gain.value = v;
  }

  // ---------------------------------------------------------------- primitives

  _env(gainNode, t, attack, peak, decay, sustain = 0) {
    const g = gainNode.gain;
    g.cancelScheduledValues(t);
    g.setValueAtTime(0.0001, t);
    g.linearRampToValueAtTime(peak, t + attack);
    g.exponentialRampToValueAtTime(Math.max(0.0001, sustain), t + attack + decay);
  }

  /** Oscillator burst with optional pitch sweep. */
  tone({ type = 'square', freq = 440, to = null, dur = 0.15, vol = 0.3, attack = 0.005, delay = 0, out = null }) {
    if (!this.ctx) return;
    const t = this.ctx.currentTime + delay;
    const o = this.ctx.createOscillator();
    const g = this.ctx.createGain();
    o.type = type;
    o.frequency.setValueAtTime(freq, t);
    if (to !== null) o.frequency.exponentialRampToValueAtTime(Math.max(1, to), t + dur);
    this._env(g, t, attack, vol, dur);
    o.connect(g).connect(out || this.sfxGain);
    o.start(t);
    o.stop(t + attack + dur + 0.05);
  }

  /** Filtered noise burst. */
  noise({ dur = 0.2, vol = 0.4, filter = 'lowpass', freq = 2000, to = null, q = 1, attack = 0.002, delay = 0, out = null }) {
    if (!this.ctx) return;
    const t = this.ctx.currentTime + delay;
    const src = this.ctx.createBufferSource();
    src.buffer = this._noiseBuf;
    const f = this.ctx.createBiquadFilter();
    f.type = filter;
    f.frequency.setValueAtTime(freq, t);
    if (to !== null) f.frequency.exponentialRampToValueAtTime(Math.max(20, to), t + dur);
    f.Q.value = q;
    const g = this.ctx.createGain();
    this._env(g, t, attack, vol, dur);
    src.connect(f).connect(g).connect(out || this.sfxGain);
    src.start(t, Math.random());
    src.stop(t + attack + dur + 0.05);
  }

  // ------------------------------------------------------------------- effects

  /** Play a named sound effect. Unknown names are ignored. */
  sfx(name, opts = {}) {
    if (this.onEvent) this.onEvent('sfx', name, opts); // mirrored to online players
    if (!this.ctx) return;
    const v = opts.vol ?? 1;
    const fx = {
      click: () => this.tone({ type: 'square', freq: 900, dur: 0.03, vol: 0.12 * v }),
      select: () => { this.tone({ type: 'square', freq: 520, dur: 0.06, vol: 0.15 * v }); this.tone({ type: 'square', freq: 780, dur: 0.08, vol: 0.12 * v, delay: 0.05 }); },
      back: () => this.tone({ type: 'square', freq: 400, to: 200, dur: 0.1, vol: 0.12 * v }),
      join: () => { this.tone({ type: 'sawtooth', freq: 220, to: 660, dur: 0.18, vol: 0.15 * v }); this.noise({ dur: 0.1, vol: 0.1 * v, freq: 4000 }); },
      tick: () => this.tone({ type: 'square', freq: 1200, dur: 0.02, vol: 0.08 * v }),
      beep: () => this.tone({ type: 'square', freq: 880, dur: 0.12, vol: 0.18 * v }),
      go: () => { this.tone({ type: 'sawtooth', freq: 440, dur: 0.4, vol: 0.2 * v }); this.tone({ type: 'sawtooth', freq: 660, dur: 0.4, vol: 0.15 * v }); },
      horn: () => { this.tone({ type: 'sawtooth', freq: 110, dur: 0.9, vol: 0.3 * v, attack: 0.05 }); this.tone({ type: 'sawtooth', freq: 138, dur: 0.9, vol: 0.25 * v, attack: 0.05 }); },
      buzz: () => this.tone({ type: 'sawtooth', freq: 90, dur: 0.35, vol: 0.25 * v }),
      ding: () => { this.tone({ type: 'sine', freq: 1320, dur: 0.5, vol: 0.2 * v }); this.tone({ type: 'sine', freq: 1980, dur: 0.4, vol: 0.08 * v }); },
      wrong: () => { this.tone({ type: 'square', freq: 200, dur: 0.12, vol: 0.18 * v }); this.tone({ type: 'square', freq: 150, dur: 0.2, vol: 0.18 * v, delay: 0.1 }); },
      shot: () => { this.noise({ dur: 0.25, vol: 0.8 * v, freq: 3000, to: 300 }); this.tone({ type: 'square', freq: 160, to: 40, dur: 0.15, vol: 0.4 * v }); },
      reload: () => { this.noise({ dur: 0.04, vol: 0.3 * v, filter: 'bandpass', freq: 3000, q: 5 }); this.noise({ dur: 0.05, vol: 0.3 * v, filter: 'bandpass', freq: 2000, q: 5, delay: 0.15 }); },
      explode: () => { this.noise({ dur: 1.0, vol: 0.9 * v, freq: 1200, to: 60 }); this.tone({ type: 'sine', freq: 80, to: 25, dur: 0.8, vol: 0.6 * v }); },
      crunch: () => { this.noise({ dur: 0.18, vol: 0.6 * v, filter: 'bandpass', freq: 900, q: 2 }); this.noise({ dur: 0.12, vol: 0.4 * v, filter: 'bandpass', freq: 1800, q: 3, delay: 0.06 }); },
      splat: () => { this.noise({ dur: 0.3, vol: 0.5 * v, freq: 600, to: 120 }); this.tone({ type: 'sine', freq: 120, to: 50, dur: 0.2, vol: 0.3 * v }); },
      snap: () => { this.noise({ dur: 0.05, vol: 0.7 * v, filter: 'highpass', freq: 2500 }); this.noise({ dur: 0.08, vol: 0.5 * v, filter: 'bandpass', freq: 1200, q: 4, delay: 0.04 }); },
      thud: () => { this.tone({ type: 'sine', freq: 110, to: 40, dur: 0.18, vol: 0.5 * v }); this.noise({ dur: 0.08, vol: 0.2 * v, freq: 500 }); },
      shove: () => { this.noise({ dur: 0.12, vol: 0.35 * v, freq: 1500, to: 400 }); this.tone({ type: 'sine', freq: 180, to: 90, dur: 0.1, vol: 0.25 * v }); },
      whoosh: () => this.noise({ dur: 0.35, vol: 0.3 * v, filter: 'bandpass', freq: 400, to: 2500, q: 2 }),
      metal: () => { this.tone({ type: 'triangle', freq: 640, dur: 0.4, vol: 0.18 * v }); this.tone({ type: 'triangle', freq: 1013, dur: 0.3, vol: 0.12 * v }); this.noise({ dur: 0.05, vol: 0.3 * v, filter: 'highpass', freq: 3000 }); },
      clank: () => { this.tone({ type: 'square', freq: 300, to: 180, dur: 0.12, vol: 0.2 * v }); this.noise({ dur: 0.08, vol: 0.3 * v, filter: 'bandpass', freq: 2500, q: 3 }); },
      saw: () => this.tone({ type: 'sawtooth', freq: 900, to: 1400, dur: 0.25, vol: 0.12 * v }),
      grind: () => { this.noise({ dur: 0.6, vol: 0.4 * v, filter: 'bandpass', freq: 300, q: 3 }); this.tone({ type: 'sawtooth', freq: 55, dur: 0.6, vol: 0.3 * v }); },
      train: () => { this.noise({ dur: 2.2, vol: 0.7 * v, freq: 400, to: 2000, attack: 0.6 }); this.tone({ type: 'sawtooth', freq: 70, dur: 2.0, vol: 0.3 * v, attack: 0.5 }); },
      trainHorn: () => { this.tone({ type: 'sawtooth', freq: 311, dur: 1.0, vol: 0.2 * v, attack: 0.05 }); this.tone({ type: 'sawtooth', freq: 370, dur: 1.0, vol: 0.2 * v, attack: 0.05 }); },
      sonar: () => { this.tone({ type: 'sine', freq: 1500, to: 900, dur: 0.6, vol: 0.18 * v }); },
      burn: () => this.noise({ dur: 0.6, vol: 0.35 * v, filter: 'bandpass', freq: 800, to: 300, q: 1 }),
      puff: () => this.noise({ dur: 0.5, vol: 0.18 * v, filter: 'bandpass', freq: 600, to: 1600, q: 1, attack: 0.15 }),
      inhale: () => this.noise({ dur: 0.3, vol: 0.1 * v, filter: 'bandpass', freq: 1200, q: 2, attack: 0.1 }),
      cough: () => { for (let i = 0; i < 3; i++) this.noise({ dur: 0.12, vol: 0.4 * v, filter: 'bandpass', freq: 500, q: 1.5, delay: i * 0.18 }); },
      chew: () => this.noise({ dur: 0.07, vol: 0.2 * v, filter: 'bandpass', freq: 700, q: 3 }),
      fork: () => this.tone({ type: 'triangle', freq: 2400, dur: 0.06, vol: 0.08 * v }),
      chisel: () => { this.noise({ dur: 0.07, vol: 0.4 * v, filter: 'bandpass', freq: 2200, q: 4 }); this.tone({ type: 'triangle', freq: 1700, dur: 0.06, vol: 0.1 * v }); },
      engine: () => this.tone({ type: 'sawtooth', freq: 60, to: 80, dur: 0.3, vol: 0.12 * v }),
      step: () => this.noise({ dur: 0.04, vol: 0.12 * v, freq: 900 }),
      spider: () => { for (let i = 0; i < 4; i++) this.tone({ type: 'square', freq: 2200 + i * 80, dur: 0.02, vol: 0.06 * v, delay: i * 0.03 }); },
      inject: () => { this.noise({ dur: 0.1, vol: 0.3 * v, filter: 'highpass', freq: 3000 }); this.tone({ type: 'sine', freq: 300, to: 900, dur: 0.3, vol: 0.15 * v }); },
      search: () => { this.noise({ dur: 0.15, vol: 0.2 * v, filter: 'bandpass', freq: 1200, q: 2 }); this.tone({ type: 'square', freq: 200, dur: 0.05, vol: 0.06 * v, delay: 0.08 }); },
      win: () => { [523, 659, 784, 1046].forEach((f, i) => this.tone({ type: 'square', freq: f, dur: 0.18, vol: 0.12 * v, delay: i * 0.12 })); },
      sting: () => { this.tone({ type: 'sawtooth', freq: 60, dur: 1.6, vol: 0.4 * v, attack: 0.01 }); this.noise({ dur: 1.4, vol: 0.4 * v, freq: 500, to: 80 }); this.tone({ type: 'sawtooth', freq: 63, dur: 1.6, vol: 0.3 * v }); },
    }[name];
    if (fx) fx();
  }

  // --------------------------------------------------------------------- music

  /**
   * Start a looping procedural music bed. Styles: 'menu' (slow industrial
   * drone + clanks), 'tension' (pulsing low synth for minigames), 'none'.
   */
  music(style) {
    if (this.onEvent) this.onEvent('music', style);
    if (!this.ctx) { this._pendingMusic = style; return; }
    if (this._music && this._music.style === style) return;
    this.stopMusic();
    if (style === 'none') return;
    const ctx = this.ctx;
    const bus = ctx.createGain();
    bus.gain.value = 0;
    bus.gain.linearRampToValueAtTime(1, ctx.currentTime + 1.5);
    bus.connect(this.musicGain);
    const nodes = [];

    // Drone: two detuned saws through a slowly sweeping low-pass filter.
    const lp = ctx.createBiquadFilter();
    lp.type = 'lowpass'; lp.frequency.value = style === 'menu' ? 260 : 380; lp.Q.value = 6;
    const lfo = ctx.createOscillator(); lfo.frequency.value = style === 'menu' ? 0.07 : 0.25;
    const lfoGain = ctx.createGain(); lfoGain.gain.value = style === 'menu' ? 160 : 120;
    lfo.connect(lfoGain).connect(lp.frequency); lfo.start();
    const droneGain = ctx.createGain(); droneGain.gain.value = 0.12;
    const root = style === 'menu' ? 41.2 : 49;
    for (const det of [0, 7, -5]) {
      const o = ctx.createOscillator(); o.type = 'sawtooth'; o.frequency.value = root; o.detune.value = det;
      o.connect(lp); o.start(); nodes.push(o);
    }
    lp.connect(droneGain).connect(bus);
    nodes.push(lfo);

    // Percussion: a scheduler that fires metallic hits on a grid.
    const bpm = style === 'menu' ? 84 : 112;
    const step = 60 / bpm / 2;
    const pattern = style === 'menu'
      ? ['k', '', '', 'm', '', '', 'k', '', 'k', '', 'n', '', '', 'm', '', 'n']
      : ['k', '', 'n', '', 'k', 'k', 'n', '', 'k', '', 'n', 'm', 'k', '', 'n', 'n'];
    let next = ctx.currentTime + 0.1, i = 0;
    const sched = setInterval(() => {
      while (next < ctx.currentTime + 0.25) {
        const hit = pattern[i % pattern.length];
        const dt = next - ctx.currentTime;
        if (hit === 'k') this.tone({ type: 'sine', freq: 90, to: 35, dur: 0.25, vol: 0.5, delay: dt, out: bus });
        if (hit === 'n') this.noise({ dur: 0.08, vol: 0.18, filter: 'highpass', freq: 5000, delay: dt, out: bus });
        if (hit === 'm') { this.tone({ type: 'triangle', freq: 330, dur: 0.5, vol: 0.08, delay: dt, out: bus }); this.noise({ dur: 0.15, vol: 0.12, filter: 'bandpass', freq: 2500, q: 8, delay: dt, out: bus }); }
        next += step; i++;
      }
    }, 50);
    this._music = { style, bus, nodes, sched };
  }

  stopMusic() {
    if (!this._music) return;
    const { bus, nodes, sched } = this._music;
    clearInterval(sched);
    const t = this.ctx.currentTime;
    bus.gain.cancelScheduledValues(t);
    bus.gain.setValueAtTime(bus.gain.value, t);
    bus.gain.linearRampToValueAtTime(0, t + 0.6);
    setTimeout(() => { nodes.forEach((n) => { try { n.stop(); } catch (_) { /* already stopped */ } }); bus.disconnect(); }, 800);
    this._music = null;
  }
}

/** Singleton shared by the whole game. */
export const Audio = new AudioEngine();
