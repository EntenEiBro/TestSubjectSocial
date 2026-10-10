/**
 * achievements.js — local "commendations" (one per simulation).
 *
 * Progress is stored in localStorage and only human players earn them.
 * Minigames call `this.award(seat, key)` (one-shot) or
 * `this.progress(seat, key, amount)` (cumulative counters) from base.js.
 */

const STORE_KEY = 'tss.commendations.v1';

/** Definitions: key → { game, title, desc, goal? } (goal = cumulative target). */
export const COMMENDATIONS = {
  returnFire: { game: 'sidearm', title: 'Return Fire', desc: 'Kill a subject who finished their gun before you did.' },
  cleanShot: { game: 'openseason', title: 'Clean Shot', desc: 'Land a headshot as the hunter.' },
  lastNook: { game: 'alcove', title: 'Last Nook', desc: 'Win Alcove Roulette from the final safe alcove.' },
  buzzerBeater: { game: 'hotspider', title: 'Buzzer Beater', desc: 'Throw the spider with less than one second on its fuse.' },
  specialDelivery: { game: 'piston', title: 'Special Delivery', desc: 'Knock a rival off their platform with thrown junk.' },
  flawlessFilter: { game: 'incinerator', title: 'Flawless Filter', desc: 'Finish The Incinerator with 100% accuracy.' },
  tenTiles: { game: 'symbolfloor', title: 'Ten Tiles Left', desc: 'Still be standing when only ten tiles remain.' },
  expressLane: { game: 'escalator', title: 'Express Lane', desc: 'Reach the top of the escalator without a single misstep.' },
  speedEater: { game: 'supperclub', title: 'Speed Eater', desc: 'Clean your plate in under 20 seconds.' },
  quickJab: { game: 'syringe', title: 'Quick Jab', desc: 'Infect someone within 3 seconds of finding the syringe.' },
  masterMason: { game: 'chisel', title: 'Master Mason', desc: 'Survive every pattern of the Chisel Test.' },
  blindFaith: { game: 'sonar', title: 'Blind Faith', desc: 'Cross the minefield without ever using sonar.' },
  certified: { game: 'forklift', title: 'Certified', desc: 'Hold four crates in your zone at once.' },
  sawFeeder: { game: 'sawblade', title: 'Saw Feeder', desc: 'Shove 15 subjects into the blades (cumulative).', goal: 15 },
  chainSmoker: { game: 'smokebreak', title: 'Chain Smoker', desc: 'Take 20 good puffs in total (cumulative).', goal: 20 },
};

function load() {
  try { return JSON.parse(localStorage.getItem(STORE_KEY) || '{}'); } catch (_) { return {}; }
}
function save(state) {
  try { localStorage.setItem(STORE_KEY, JSON.stringify(state)); } catch (_) { /* storage unavailable */ }
}

/** Singleton tracker. `onUnlock(def)` is set by the app to show a toast. */
export const Commendations = {
  state: load(), // key → { unlocked: bool, count: number }
  onUnlock: null,

  isUnlocked(key) { return !!(this.state[key] && this.state[key].unlocked); },
  count(key) { return (this.state[key] && this.state[key].count) || 0; },

  /** Unlock a one-shot commendation. Returns true if newly unlocked. */
  unlock(key) {
    const def = COMMENDATIONS[key];
    if (!def || this.isUnlocked(key)) return false;
    this.state[key] = { ...(this.state[key] || {}), unlocked: true };
    save(this.state);
    if (this.onUnlock) this.onUnlock(def);
    return true;
  },

  /** Add to a cumulative counter, unlocking when its goal is reached. */
  add(key, amount = 1) {
    const def = COMMENDATIONS[key];
    if (!def) return;
    const cur = this.state[key] || { unlocked: false, count: 0 };
    cur.count = (cur.count || 0) + amount;
    this.state[key] = cur;
    save(this.state);
    if (def.goal && cur.count >= def.goal) this.unlock(key);
  },

  /** Number unlocked / total. */
  summary() {
    const keys = Object.keys(COMMENDATIONS);
    return { unlocked: keys.filter((k) => this.isUnlocked(k)).length, total: keys.length };
  },
};
