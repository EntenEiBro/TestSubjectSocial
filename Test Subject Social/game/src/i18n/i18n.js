/**
 * i18n.js — tiny translation layer.
 *
 * The English source text is the lookup key:
 *
 *   t('BEGIN TESTING')                    → 'TESTS BEGINNEN' (German)
 *   t('NEED AT LEAST {n} SUBJECTS', {n})  → placeholders filled after lookup
 *
 * Anything without a translation falls back to English, so a missing entry
 * never shows a blank. Runtime messages built by minigames ("SUBJECT 2 IS
 * ARMED") are translated by `tr()`, which also tries the regex patterns in
 * catalog.js; the HUD runs every message through it.
 *
 * Language packs live in ./lang/<code>.js and look like:
 *   export default { strings: { 'English text': 'Translation' },
 *                    patterns: { patternId: 'Template with {1} {2}' } }
 */
import { HUD_PATTERNS } from './catalog.js';
import de from './lang/de.js';
import ru from './lang/ru.js';
import zh from './lang/zh.js';
import ja from './lang/ja.js';
import it from './lang/it.js';
import hi from './lang/hi.js';

/** Selectable languages, shown by their own name. */
export const LANGUAGES = [
  { code: 'en', name: 'English' },
  { code: 'de', name: 'Deutsch' },
  { code: 'ru', name: 'Русский' },
  { code: 'zh', name: '中文' },
  { code: 'ja', name: '日本語' },
  { code: 'it', name: 'Italiano' },
  { code: 'hi', name: 'हिन्दी' },
];

const PACKS = { de, ru, zh, ja, it, hi };
let current = 'en';
const listeners = new Set();

/** Current language code. */
export const getLanguage = () => current;

/** Switch language (unknown codes fall back to English). */
export function setLanguage(code) {
  current = PACKS[code] || code === 'en' ? code : 'en';
  if (typeof document !== 'undefined') document.documentElement.lang = current;
  listeners.forEach((fn) => fn(current));
}

/** Be notified after a language change. */
export function onLanguageChange(fn) { listeners.add(fn); return () => listeners.delete(fn); }

/** Fill {name} placeholders. */
function fill(text, vars) {
  if (!vars) return text;
  return text.replace(/\{(\w+)\}/g, (m, k) => (vars[k] !== undefined ? vars[k] : m));
}

/** Translate a known UI string (English text as key). */
export function t(english, vars) {
  const pack = PACKS[current];
  const out = (pack && pack.strings && pack.strings[english]) || english;
  return fill(out, vars);
}

/**
 * Translate a runtime message: exact match first, then the regex patterns
 * from catalog.js (captured groups are themselves translated, so player
 * names and status words inside messages are localised too).
 */
export function tr(text) {
  if (current === 'en' || text === null || text === undefined || text === '') return text;
  const pack = PACKS[current];
  if (!pack) return text;
  // HUD status lines are refreshed every frame: memoise per language.
  let out = cache.get(text);
  if (out !== undefined) return out;
  out = translateMessage(pack, text);
  if (cache.size > 4000) cache.clear();
  cache.set(text, out);
  return out;
}

const cache = new Map();
onLanguageChange(() => cache.clear());

function translateMessage(pack, text) {
  const exact = pack.strings && pack.strings[text];
  if (exact) return exact;
  for (const p of HUD_PATTERNS) {
    const m = p.re.exec(text);
    if (!m) continue;
    const tpl = pack.patterns && pack.patterns[p.id];
    if (!tpl) return text;
    return tpl.replace(/\{(\d)\}/g, (_, i) => tr(m[+i] ?? ''));
  }
  return text;
}
