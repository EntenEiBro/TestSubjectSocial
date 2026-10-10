/**
 * prompts.js — platform-specific button prompts.
 *
 * UI texts refer to buttons with tokens instead of hard-coded keys:
 *
 *   {A} action / confirm     {B} shove / secondary     {MOVE} movement
 *   {BACK} back / cancel     {PAUSE} pause             {ADDBOT} / {REMBOT} lobby bots
 *
 * `fmt(text)` swaps the tokens for the current input mode, rendered as key
 * caps: on a keyboard "F / ENTER", with a gamepad "Ⓐ", on a touch screen the
 * matching on-screen button. The mode follows the last device used (key
 * press, gamepad button / stick, or touch), so plugging in a controller
 * switches the prompts immediately.
 *
 * Tokens survive translation untouched (t() only fills placeholders it is
 * given), so translators keep {A} etc. in place and fmt() runs afterwards.
 */
import { t } from '../i18n/i18n.js';

const LABELS = {
  keyboard: {
    A: 'F / ENTER', B: 'G / R-SHIFT', MOVE: 'W A S D / ARROWS', BACK: 'ESC', PAUSE: 'ESC', ADDBOT: 'T', REMBOT: 'Y',
  },
  gamepad: {
    A: 'Ⓐ', B: 'Ⓑ', MOVE: 'L-STICK', BACK: 'Ⓑ', PAUSE: 'START', ADDBOT: 'Ⓨ', REMBOT: 'Ⓧ',
  },
  touch: {
    A: 'Ⓐ', B: 'Ⓑ', MOVE: 'JOYSTICK', BACK: 'BACK', PAUSE: 'II', ADDBOT: '+ BOT', REMBOT: '− BOT',
  },
};
// Words inside labels that should be translated (the rest are key names / symbols).
const TRANSLATE = new Set(['ARROWS', 'L-STICK', 'JOYSTICK', 'BACK']);

let mode = null;               // 'keyboard' | 'gamepad' | 'touch'
const listeners = new Set();

/** Current input mode. */
export function inputMode() { return mode || 'keyboard'; }

/** Is the player using a touch screen right now? */
export const isTouchMode = () => inputMode() === 'touch';

/** Set the mode (called by the listeners below and by InputManager for gamepads). */
export function setInputMode(next) {
  if (next === mode) return;
  mode = next;
  listeners.forEach((fn) => fn(mode));
}

/** Be notified when the player switches device. Returns an unsubscribe fn. */
export function onInputModeChange(fn) { listeners.add(fn); return () => listeners.delete(fn); }

/** Pick a default mode before the first input arrives. */
export function initInputMode(isTouchDevice) {
  if (!mode) mode = isTouchDevice ? 'touch' : 'keyboard';
  window.addEventListener('keydown', () => setInputMode('keyboard'), true);
  window.addEventListener('pointerdown', (e) => { if (e.pointerType === 'touch') setInputMode('touch'); }, true);
}

/** Key-cap HTML for one button token in the current mode. */
export function keyLabel(token) {
  const raw = (LABELS[inputMode()] || LABELS.keyboard)[token];
  if (!raw) return `{${token}}`;
  const text = raw.split(' / ').map((part) => part.split(' ').map((w) => (TRANSLATE.has(w) ? t(w) : w)).join(' ')).join(' / ');
  return `<kbd>${text}</kbd>`;
}

/** Replace {A}, {B}, {MOVE}... in an (already translated) string with key caps. */
export function fmt(text) {
  if (typeof text !== 'string' || text.indexOf('{') < 0) return text;
  return text.replace(/\{(A|B|MOVE|BACK|PAUSE|ADDBOT|REMBOT)\}/g, (_, token) => keyLabel(token));
}

/** Translate + format in one go: tp('PRESS {A} TO JOIN'). */
export function tp(english, vars) { return fmt(t(english, vars)); }

/**
 * Choose between a touch wording and a button wording, then translate and
 * format it: pick('TAP TO CONTINUE', '{A} CONTINUE').
 */
export function pick(touchText, buttonText, vars) {
  return tp(isTouchMode() ? touchText : buttonText, vars);
}
