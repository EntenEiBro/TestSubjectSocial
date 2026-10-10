/**
 * touch.js — on-screen controls for phones and tablets.
 *
 * Layout (landscape):
 *   left half   floating joystick: it appears wherever the thumb lands
 *   right side  big Ⓐ (action) and smaller Ⓑ (shove / back) buttons
 *   top         pause button
 *
 * The controls only appear during rounds (setContext('play')); menus are
 * operated by tapping their buttons directly (see runScreen in screens.js).
 *
 * The controls drive the InputManager Controller with device id 'touch',
 * so menus, the lobby and every minigame treat a touch player exactly like
 * a keyboard half or a gamepad. Pointer Events are used, so several fingers
 * (stick + buttons) work at the same time.
 */

import { Haptics } from '../core/haptics.js';

const STICK_RADIUS = 0.11; // as a fraction of the stage height

/** Keep receiving a finger's events even if it slides off the element (best effort). */
function capture(el, pointerId) {
  try { el.setPointerCapture(pointerId); } catch (_) { /* pointer already gone */ }
}

/** True on phones / tablets (or when forced with ?touch=1 for testing). */
export function isTouchDevice() {
  if (new URLSearchParams(location.search).get('touch') === '1') return true;
  return (window.matchMedia && matchMedia('(pointer: coarse)').matches) || navigator.maxTouchPoints > 0;
}

export class TouchControls {
  /**
   * @param {import('../core/input.js').InputManager} input
   * @param {{stage?: HTMLElement, alwaysVisible?: boolean}} opts
   */
  constructor(input, { stage = document.getElementById('stage'), alwaysVisible = false } = {}) {
    this.input = input;
    this.ctrl = input.controller('touch');
    this.stickPointer = null;
    this.origin = { x: 0, y: 0 };
    this.buttons = new Map(); // pointerId → 'a' | 'b'

    const root = document.createElement('div');
    root.id = 'touch';
    root.innerHTML = `
      <div class="t-stick-zone"></div>
      <div class="t-stick hidden"><div class="t-knob"></div></div>
      <div class="t-btn t-a" data-btn="a">Ⓐ</div>
      <div class="t-btn t-b" data-btn="b">Ⓑ</div>
      <div class="t-small t-pause" data-action="pause">II</div>`;
    stage.appendChild(root);
    this.root = root;
    this.el = {
      zone: root.querySelector('.t-stick-zone'),
      stick: root.querySelector('.t-stick'),
      knob: root.querySelector('.t-knob'),
    };
    this.alwaysVisible = alwaysVisible;
    this._bind();
    this.setContext(null);
  }

  /**
   * 'play' shows the joystick + buttons (during a round). Anything else hides
   * them so menus can be used by tapping directly. Online clients pass
   * `alwaysVisible` because they navigate the host's menus with the stick.
   */
  setContext(ctx) {
    const show = this.alwaysVisible || ctx === 'play';
    this.root.classList.toggle('hidden', !show);
    if (!show) this._release();
  }

  /** Let go of everything (when the controls are hidden mid-press). */
  _release() {
    this.stickPointer = null;
    this.buttons.clear();
    this.ctrl.rawX = this.ctrl.rawY = 0;
    this.ctrl.rawA = this.ctrl.rawB = false;
    this.el.stick.classList.add('hidden');
    this.root.querySelectorAll('.t-btn.down').forEach((b) => b.classList.remove('down'));
  }

  /** Hide/show the whole overlay (e.g. while a text field is focused). */
  setVisible(v) { this.root.classList.toggle('hidden', !v); }

  _bind() {
    const radiusPx = () => this.root.clientHeight * STICK_RADIUS;

    // --- joystick
    this.el.zone.addEventListener('pointerdown', (e) => {
      if (this.stickPointer !== null) return;
      e.preventDefault();
      this.stickPointer = e.pointerId;
      const r = this.root.getBoundingClientRect();
      this.origin = { x: e.clientX - r.left, y: e.clientY - r.top };
      Object.assign(this.el.stick.style, { left: `${this.origin.x}px`, top: `${this.origin.y}px` });
      this.el.stick.classList.remove('hidden');
      Haptics.play('tick');
      capture(this.el.zone, e.pointerId);
      this._moveStick(e, radiusPx());
    });
    this.el.zone.addEventListener('pointermove', (e) => {
      if (e.pointerId === this.stickPointer) this._moveStick(e, radiusPx());
    });
    const endStick = (e) => {
      if (e.pointerId !== this.stickPointer) return;
      this.stickPointer = null;
      this.ctrl.rawX = this.ctrl.rawY = 0;
      this.el.knob.style.transform = 'translate(-50%, -50%)';
      this.el.stick.classList.add('hidden');
    };
    this.el.zone.addEventListener('pointerup', endStick);
    this.el.zone.addEventListener('pointercancel', endStick);

    // --- A / B buttons (held while pressed)
    for (const btn of this.root.querySelectorAll('.t-btn')) {
      btn.addEventListener('pointerdown', (e) => {
        e.preventDefault();
        capture(btn, e.pointerId);
        this.buttons.set(e.pointerId, btn.dataset.btn);
        btn.classList.add('down');
        Haptics.play('press');
        this._syncButtons();
      });
      const up = (e) => {
        if (!this.buttons.has(e.pointerId)) return;
        this.buttons.delete(e.pointerId);
        if (![...this.buttons.values()].includes(btn.dataset.btn)) btn.classList.remove('down');
        this._syncButtons();
      };
      btn.addEventListener('pointerup', up);
      btn.addEventListener('pointercancel', up);
    }

    // --- one-shot action buttons
    for (const el of this.root.querySelectorAll('[data-action]')) {
      el.addEventListener('pointerdown', (e) => { e.preventDefault(); Haptics.play('click'); this.input.action(el.dataset.action); });
    }

    // Keep the browser from scrolling / zooming / long-press menus.
    this.root.addEventListener('contextmenu', (e) => e.preventDefault());
  }

  _moveStick(e, radius) {
    const r = this.root.getBoundingClientRect();
    let dx = e.clientX - r.left - this.origin.x;
    let dy = e.clientY - r.top - this.origin.y;
    const len = Math.hypot(dx, dy);
    if (len > radius) { dx = (dx / len) * radius; dy = (dy / len) * radius; }
    this.el.knob.style.transform = `translate(calc(-50% + ${dx}px), calc(-50% + ${dy}px))`;
    // Small dead zone, then full analog range.
    const k = len < radius * 0.18 ? 0 : 1 / radius;
    this.ctrl.rawX = dx * k;
    this.ctrl.rawY = dy * k;
  }

  _syncButtons() {
    const held = new Set(this.buttons.values());
    this.ctrl.rawA = held.has('a');
    this.ctrl.rawB = held.has('b');
  }
}
