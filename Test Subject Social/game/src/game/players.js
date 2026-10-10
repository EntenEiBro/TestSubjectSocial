/**
 * players.js — the session roster: who is playing, how they look, their score.
 */
import { SUIT_COLORS, SKIN_TONES, HATS, FACES, SLOT_COLORS } from '../core/characters.js';
import { pick, randInt } from '../core/util.js';
import { t } from '../i18n/i18n.js';

export const MAX_PLAYERS = 4;
export const MIN_PLAYERS = 2;

/** Points awarded per finishing place, indexed by participant count. */
export const PLACEMENT_POINTS = {
  2: [3, 0],
  3: [3, 1, 0],
  4: [3, 2, 1, 0],
};

/** One participant (human or bot) in the current session. */
export class Player {
  /**
   * @param {number} slot   0..3, fixed seat/colour
   * @param {string} device input device id ('kb1', 'kb2', 'pad0'.., or 'bot')
   */
  constructor(slot, device) {
    this.id = `p${slot}`;
    this.slot = slot;
    this.device = device;
    this.isBot = device === 'bot';
    this.color = SLOT_COLORS[slot];
    this.look = {
      suit: SUIT_COLORS[slot * 2 % SUIT_COLORS.length].hex,
      skin: SKIN_TONES[slot % SKIN_TONES.length],
      hat: this.isBot ? pick(HATS) : HATS[0],
      face: this.isBot ? pick(FACES) : FACES[0],
    };
    this.lookIndex = { suit: slot * 2 % SUIT_COLORS.length, skin: slot % SKIN_TONES.length, hat: HATS.indexOf(this.look.hat), face: FACES.indexOf(this.look.face) };
    if (this.isBot) this.randomizeLook();
    this.ready = this.isBot;
    this.resetStats();
  }

  /** Display name in the current language ("SUBJECT 2", "UNIT-3", "SUBJEKT 2"...). */
  get name() {
    return this.isBot ? t('UNIT-{n}', { n: this.slot + 1 }) : t('SUBJECT {n}', { n: this.slot + 1 });
  }

  resetStats() {
    this.score = 0;
    this.deaths = 0;
    this.wins = 0;
    this.history = []; // per-round {game, place, points, died}
  }

  /** Cycle one customization field by `step` (+1 / -1). */
  cycle(field, step) {
    const lists = { suit: SUIT_COLORS, skin: SKIN_TONES, hat: HATS, face: FACES };
    const list = lists[field];
    const i = (this.lookIndex[field] + step + list.length) % list.length;
    this.lookIndex[field] = i;
    this.look[field] = field === 'suit' ? list[i].hex : list[i];
  }

  randomizeLook() {
    this.lookIndex = {
      suit: randInt(0, SUIT_COLORS.length - 1), skin: randInt(0, SKIN_TONES.length - 1),
      hat: randInt(0, HATS.length - 1), face: randInt(0, FACES.length - 1),
    };
    this.look = {
      suit: SUIT_COLORS[this.lookIndex.suit].hex, skin: SKIN_TONES[this.lookIndex.skin],
      hat: HATS[this.lookIndex.hat], face: FACES[this.lookIndex.face],
    };
  }

  /** Display name of the current value of a field. */
  lookLabel(field) {
    if (field === 'suit') return t(SUIT_COLORS[this.lookIndex.suit].name);
    if (field === 'skin') return t('Tone {n}', { n: this.lookIndex.skin + 1 });
    return t(this.look[field]);
  }
}
