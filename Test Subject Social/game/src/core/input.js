/**
 * input.js — unified local-multiplayer input.
 *
 * Every participant (human or bot) is driven through a {@link Controller}:
 * an object exposing an analog move vector plus two buttons (A = action,
 * B = shove / secondary). Minigames only ever read Controllers, so they never
 * care whether the input comes from a keyboard half, a gamepad or the AI.
 *
 * Devices:
 *   kb1  — W A S D to move, F = A, G = B
 *   kb2  — Arrow keys to move, Enter = A, Right Shift = B   (also Numpad 0/1)
 *   pad0..pad3 — standard gamepads (left stick / d-pad, A/Cross, B/Circle)
 *   bot  — values written by an AI routine each frame
 */

import { setInputMode } from '../ui/prompts.js';

const KEYMAPS = {
  kb1: { up: ['KeyW'], down: ['KeyS'], left: ['KeyA'], right: ['KeyD'], a: ['KeyF', 'Space'], b: ['KeyG'] },
  kb2: {
    up: ['ArrowUp'], down: ['ArrowDown'], left: ['ArrowLeft'], right: ['ArrowRight'],
    a: ['Enter', 'Numpad0', 'NumpadEnter'], b: ['ShiftRight', 'Numpad1'],
  },
};

/** Human-readable labels used by briefing screens. */
export const DEVICE_LABELS = {
  kb1: { move: 'W A S D', a: 'F', b: 'G', name: 'Keyboard (left)' },
  kb2: { move: 'ARROWS', a: 'ENTER', b: 'R-SHIFT', name: 'Keyboard (right)' },
  pad: { move: 'L-STICK', a: 'Ⓐ', b: 'Ⓑ', name: 'Gamepad' },
  net: { move: 'REMOTE', a: 'Ⓐ', b: 'Ⓑ', name: 'Online' },
  touch: { move: 'JOYSTICK', a: 'Ⓐ', b: 'Ⓑ', name: 'Touch screen' },
  bot: { move: '—', a: '—', b: '—', name: 'Bot' },
};

/** A virtual controller: the only input surface minigames see. */
export class Controller {
  constructor(device) {
    this.device = device; // 'kb1' | 'kb2' | 'pad0'.. | 'bot'
    this.moveX = 0; // -1 (left) .. 1 (right)
    this.moveY = 0; // -1 (up / forward) .. 1 (down / back)
    this.a = false;
    this.b = false;
    this.aPressed = false; // true only on the frame the button went down
    this.bPressed = false;
    this.aReleased = false;
    this.bReleased = false;
    /** Discrete d-pad style press this frame: 'up' | 'down' | 'left' | 'right' | null */
    this.dirPressed = null;
    this._prevA = false;
    this._prevB = false;
    this._prevDir = null;
    // Bots write into these "raw" fields; humans have them filled by InputManager.
    this.rawX = 0; this.rawY = 0; this.rawA = false; this.rawB = false; this.rawDir = null;
  }

  get isBot() { return this.device === 'bot'; }

  /** Label set for UI prompts. */
  get labels() {
    if (this.device.startsWith('pad')) return DEVICE_LABELS.pad;
    if (this.device.startsWith('net')) return DEVICE_LABELS.net;
    if (this.device === 'touch') return DEVICE_LABELS.touch;
    return DEVICE_LABELS[this.device] || DEVICE_LABELS.bot;
  }

  /** Bot helper: set analog movement. */
  setMove(x, y) { this.rawX = x; this.rawY = y; }
  /** Bot helper: hold or release buttons. */
  setButtons(a, b = false) { this.rawA = a; this.rawB = b; }
  /** Bot helper: tap a discrete direction this frame. */
  tapDir(dir) { this.rawDir = dir; }

  /** Derive edge-triggered states from raw values. Called once per frame. */
  _commit() {
    let x = this.rawX, y = this.rawY;
    const len = Math.hypot(x, y);
    if (len > 1) { x /= len; y /= len; }
    this.moveX = x; this.moveY = y;
    this.a = this.rawA; this.b = this.rawB;
    this.aPressed = this.a && !this._prevA;
    this.bPressed = this.b && !this._prevB;
    this.aReleased = !this.a && this._prevA;
    this.bReleased = !this.b && this._prevB;
    this._prevA = this.a; this._prevB = this.b;

    // Discrete direction: humans derive it from the stick, bots tap explicitly.
    let dir = this.rawDir;
    if (!this.isBot) {
      dir = null;
      if (Math.abs(x) > 0.6 || Math.abs(y) > 0.6) {
        dir = Math.abs(x) > Math.abs(y) ? (x > 0 ? 'right' : 'left') : (y > 0 ? 'down' : 'up');
      }
      this.dirPressed = dir && dir !== this._prevDir ? dir : null;
      this._prevDir = dir;
    } else {
      this.dirPressed = dir;
      this.rawDir = null;
    }
  }

  /** Clear transient states (e.g. between screens). */
  reset() {
    this.rawX = this.rawY = 0; this.rawA = this.rawB = false; this.rawDir = null;
    this._commit();
  }
}

/**
 * Polls keyboard + gamepads each frame and pushes values into Controllers.
 * Also offers "any device" helpers for menus and join screens.
 */
export class InputManager {
  constructor() {
    this.keys = new Set();
    this.pressedThisFrame = new Set();
    this.controllers = new Map(); // device -> Controller
    this.padState = [];
    this._prevPadButtons = [];
    this._prevStick = [];
    // One-shot named actions from on-screen buttons (e.g. 'pause' from the touch controls).
    this._pendingActions = new Set();
    this.actionsThisFrame = new Set();
    window.addEventListener('keydown', (e) => {
      if (['ArrowUp', 'ArrowDown', 'ArrowLeft', 'ArrowRight', 'Space'].includes(e.code)) e.preventDefault();
      if (!this.keys.has(e.code)) this.pressedThisFrame.add(e.code);
      this.keys.add(e.code);
    });
    window.addEventListener('keyup', (e) => this.keys.delete(e.code));
    window.addEventListener('blur', () => this.keys.clear());
  }

  /** Get (or lazily create) the Controller bound to a device id. */
  controller(device) {
    if (device === 'bot') return new Controller('bot'); // bots get private instances
    if (!this.controllers.has(device)) this.controllers.set(device, new Controller(device));
    return this.controllers.get(device);
  }

  /** Register an externally created controller (bots) so it gets committed each frame. */
  track(ctrl) { this._tracked = this._tracked || new Set(); this._tracked.add(ctrl); }
  untrackAll() { this._tracked = new Set(); }

  /** Queue a one-shot action (from touch buttons); visible for exactly one frame. */
  action(name) { this._pendingActions.add(name); }

  /** True if the named action fired this frame. */
  actionPressed(name) { return this.actionsThisFrame.has(name); }

  /** Called once at the start of every frame. */
  update() {
    const pads = navigator.getGamepads ? [...navigator.getGamepads()] : [];
    this.padState = pads;
    // Any gamepad activity switches on-screen prompts to controller buttons.
    for (const gp of pads) {
      if (gp && (gp.buttons.some((b) => b.pressed) || gp.axes.some((a) => Math.abs(a) > 0.5))) { setInputMode('gamepad'); break; }
    }
    this.actionsThisFrame = this._pendingActions;
    this._pendingActions = new Set();

    for (const [device, c] of this.controllers) {
      if (device.startsWith('kb')) {
        const m = KEYMAPS[device];
        // A key tapped and released within one frame still counts as held for that frame.
        const held = (list) => list.some((k) => this.keys.has(k) || this.pressedThisFrame.has(k));
        c.rawX = (held(m.right) ? 1 : 0) - (held(m.left) ? 1 : 0);
        c.rawY = (held(m.down) ? 1 : 0) - (held(m.up) ? 1 : 0);
        c.rawA = held(m.a);
        c.rawB = held(m.b);
      } else if (device.startsWith('pad')) {
        const gp = pads[parseInt(device.slice(3), 10)];
        if (gp) {
          let x = gp.axes[0] || 0, y = gp.axes[1] || 0;
          if (Math.hypot(x, y) < 0.22) { x = 0; y = 0; }
          const btn = (i) => !!(gp.buttons[i] && gp.buttons[i].pressed);
          if (btn(14)) x = -1; if (btn(15)) x = 1; if (btn(12)) y = -1; if (btn(13)) y = 1;
          c.rawX = x; c.rawY = y; c.rawA = btn(0); c.rawB = btn(1) || btn(2);
        } else { c.rawX = c.rawY = 0; c.rawA = c.rawB = false; }
      }
      // 'netN' (online players) and 'touch' (on-screen controls) have their
      // raw values written by NetHost / TouchControls respectively.
      c._commit();
    }
    if (this._tracked) for (const c of this._tracked) c._commit();
  }

  /** Must be called at the very end of a frame. */
  endFrame() {
    this.pressedThisFrame.clear();
    this._prevPadButtons = this.padState.map((gp) => (gp ? gp.buttons.map((b) => b.pressed) : []));
    this._prevStick = this.padState.map((_, i) => this._stickDir(i));
  }

  /** True if the given key code went down this frame. */
  keyPressed(code) { return this.pressedThisFrame.has(code); }

  /** Gamepad button edge detection (for join screens / menus). */
  padPressed(index, button) {
    const gp = this.padState[index];
    if (!gp || !gp.buttons[button]) return false;
    const prev = this._prevPadButtons[index] || [];
    return gp.buttons[button].pressed && !prev[button];
  }

  /**
   * Which device pressed its "A" (join/confirm) button this frame, if any.
   * Returns a device id like 'kb1' or 'pad2'. Online devices ('netN') are
   * only considered when `includeNet` is set (the lobby), so remote players
   * cannot drive the host's menus.
   */
  joinPressed(includeNet = false) {
    if (KEYMAPS.kb1.a.some((k) => this.keyPressed(k))) return 'kb1';
    if (KEYMAPS.kb2.a.some((k) => this.keyPressed(k))) return 'kb2';
    for (let i = 0; i < this.padState.length; i++) if (this.padPressed(i, 0)) return `pad${i}`;
    const touch = this.controllers.get('touch');
    if (touch && touch.aPressed) return 'touch';
    if (includeNet) for (const [device, c] of this.controllers) if (device.startsWith('net') && c.aPressed) return device;
    return null;
  }

  /** Which device pressed its "B" (back/leave) button this frame. */
  backPressed() {
    if (KEYMAPS.kb1.b.some((k) => this.keyPressed(k))) return 'kb1';
    if (KEYMAPS.kb2.b.some((k) => this.keyPressed(k)) || this.keyPressed('Escape') || this.keyPressed('Backspace')) return 'kb2';
    for (let i = 0; i < this.padState.length; i++) if (this.padPressed(i, 1)) return `pad${i}`;
    const touch = this.controllers.get('touch');
    if ((touch && touch.bPressed) || this.actionPressed('back')) return 'touch';
    return null;
  }

  /** Menu navigation from any device: returns 'up' | 'down' | 'left' | 'right' | null. */
  menuDir() {
    const k = (codes) => codes.some((c) => this.keyPressed(c));
    if (k(['KeyW', 'ArrowUp'])) return 'up';
    if (k(['KeyS', 'ArrowDown'])) return 'down';
    if (k(['KeyA', 'ArrowLeft'])) return 'left';
    if (k(['KeyD', 'ArrowRight'])) return 'right';
    for (let i = 0; i < this.padState.length; i++) {
      if (this.padPressed(i, 12)) return 'up';
      if (this.padPressed(i, 13)) return 'down';
      if (this.padPressed(i, 14)) return 'left';
      if (this.padPressed(i, 15)) return 'right';
      const stick = this._stickDir(i);
      if (stick && stick !== (this._prevStick[i] || null)) return stick;
    }
    const touch = this.controllers.get('touch');
    if (touch && touch.dirPressed) return touch.dirPressed;
    return null;
  }

  /** Current left-stick direction of pad `i` (thresholded), or null. */
  _stickDir(i) {
    const gp = this.padState[i];
    if (!gp) return null;
    const x = gp.axes[0] || 0, y = gp.axes[1] || 0;
    if (Math.abs(x) < 0.6 && Math.abs(y) < 0.6) return null;
    return Math.abs(x) > Math.abs(y) ? (x > 0 ? 'right' : 'left') : (y > 0 ? 'down' : 'up');
  }
}
