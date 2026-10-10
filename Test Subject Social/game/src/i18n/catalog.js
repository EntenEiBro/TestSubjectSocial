/**
 * catalog.js — the in-game (HUD) texts produced by minigames at runtime.
 *
 * Minigames keep writing plain English to the HUD; the HUD translates every
 * message with `tr()` (see i18n.js):
 *
 *   HUD_PHRASES   exact messages (translated through the packs' `strings`)
 *   HUD_PATTERNS  messages containing names / numbers. Each has an id; a pack
 *                 supplies `patterns[id]`, a template where {1}, {2}... are
 *                 the regex captures (themselves translated, so names and
 *                 status words inside messages are localised too).
 *
 * Order matters: more specific patterns come before generic ones.
 */

/**
 * UI words looked up through variables (e.g. t(LEVELS[i])), which the
 * extraction tool cannot see as literals — listed here so they get translated.
 */
export const UI_DYNAMIC = [
  'DOCILE', 'COMPETENT', 'RUTHLESS',           // bot skill
  'OFF', 'LOW', 'MEDIUM', 'HIGH',               // haptic strength
  'JUMPSUIT', 'SKIN', 'HEAD', 'FACE', 'READY',  // lobby fields
];

export const HUD_PHRASES = [
  // shared
  'ALIVE', 'SHIFT OVER', 'ALL SPARED', 'CARRIER', 'CLEAN', 'TIME UP', 'TIME UP — PURGING THE INFECTED',
  // alcove
  'FIND YOUR NOOK', 'TRAIN INCOMING', 'FLATTENED', 'EXPOSED', 'SAFE', 'DOOMED', 'IN NOOK', 'LAST NOOK TAKEN',
  // chisel
  'VERDICT', 'APPRENTICES SURVIVE', 'MASTER MASON', 'EXECUTED', 'PASSED', 'FAILED', 'SUBMITTED', 'CARVING',
  // hot spider
  'CATCH!', 'INCOMING', 'FOLDED', 'SPIDER!', 'IMMUNE',
  // forklift
  'Stick = drive · A = forks · B = horn', 'LOADED', 'EQUAL FAILURE. EQUAL PUNISHMENT.', 'PERFORMANCE REVIEW',
  // incinerator
  'FILTERED', 'FILTERING...', 'BURNED +1', 'WRONG! −1', 'MISSED ART −1',
  // open season
  'RUN', 'SEASON CLOSED', 'RUNNER', 'HUNTER', 'RUNNER · DOWN', 'RUNNER · OUT', 'RUNNER · WOUNDED',
  // escalator
  'OVERDRIVE', 'STUMBLE!', 'MULCHED',
  // piston
  'KEEP IT TIDY', 'PURGE!', 'BRACE!', 'SLAM!', 'ALL CLEAN', 'PRESSED', 'BIGGEST PILE',
  // sawblade
  'BLADE RELEASED', 'SHREDDED',
  // sidearm
  'Grab parts from the belt ▸ build <b>your</b> pistol at <b>your</b> bench ▸ use it',
  'DECEASED', 'ARMED', 'EMPTY — NEED MAGAZINE', 'FRAME', 'SLIDE', 'BARREL', 'MAGAZINE',
  // smoke break
  'BREAK TERMINATED', "BREAK'S OVER", 'UNDER-INHALED', 'GOOD PUFF +1', 'WEAK', 'TOO HARSH', 'COUGHING FIT', 'LIGHTING UP',
  // supper club
  'BON APPÉTIT', 'EXCUSED', 'PLATE CLEAN', 'CAUGHT', 'LAST PLATE', 'DINNER IS OVER', 'CAUGHT EATING', 'SLOWEST EATER',
  // syringe
  'SOMEONE HAS THE SYRINGE', 'Hold A at a container to search it', 'INFECTED', 'SEARCHING', 'TOTAL INFECTION',
  // sonar
  'CROSS', 'STAND STILL TO PING SONAR', 'FIRST OUT', 'HARVEST TIME', 'NO MERCY',
  // symbol floor
  'SYMBOLS REASSIGNED', 'FALLING', 'STANDING', 'FELL', 'STRUCTURAL FAILURE', 'CIRCLE', 'SQUARE', 'TRIANGLE',
];

export const HUD_PATTERNS = [
  { id: 'subjectName', re: /^SUBJECT (\d+)$/, example: 'SUBJECT 2' },
  { id: 'unitName', re: /^UNIT-(\d+)$/, example: 'UNIT-3' },
  { id: 'greenNooks', re: /^<b>(\d+)<\/b> GREEN NOOKS? — GET IN$/, example: '<b>2</b> GREEN NOOKS — GET IN' },
  { id: 'evicted', re: /^(.+) evicted (.+)$/, example: 'SUBJECT 1 evicted UNIT-2' },
  { id: 'lastNook', re: /^(.+) took the last nook$/, example: 'SUBJECT 1 took the last nook' },
  { id: 'patternPrompt', re: /^PATTERN (\d+) \/ (\d+) — carve the shape on the monitor$/, example: 'PATTERN 2 / 8 — carve the shape on the monitor' },
  { id: 'patternOf', re: /^PATTERN (\d+)\/(\d+)$/, example: 'PATTERN 2/8' },
  { id: 'pattern', re: /^PATTERN (\d+)$/, example: 'PATTERN 3' },
  { id: 'wearingSpider', re: /^(.+) is wearing the spider$/, example: 'UNIT-2 is wearing the spider' },
  { id: 'buzzerBeater', re: /^(.+) — buzzer beater!$/, example: 'SUBJECT 1 — buzzer beater!' },
  { id: 'crates', re: /^CRATES (\d+)$/, example: 'CRATES 4' },
  { id: 'scoreAcc', re: /^SCORE (-?\d+) · (\d+)%$/, example: 'SCORE 7 · 88%' },
  { id: 'hasRifle', re: /^(.+) HAS THE RIFLE$/, example: 'UNIT-3 HAS THE RIFLE' },
  { id: 'roundHunter', re: /^ROUND (\d+)\/(\d+) — HUNTER: (.+)$/, example: 'ROUND 1/4 — HUNTER: SUBJECT 1' },
  { id: 'escapedPlus2', re: /^(.+) ESCAPED \+2$/, example: 'UNIT-2 ESCAPED +2' },
  { id: 'downOut', re: /^(\d+) DOWN · (\d+) OUT$/, example: '2 DOWN · 1 OUT' },
  { id: 'wounded', re: /^(.+) WOUNDED$/, example: 'UNIT-4 WOUNDED' },
  { id: 'headshot', re: /^(.+) ▸ (.+) — HEADSHOT$/, example: 'SUBJECT 1 ▸ UNIT-2 — HEADSHOT' },
  { id: 'infectedBy', re: /^(.+) ▸ (.+) INFECTED$/, example: 'UNIT-2 ▸ SUBJECT 1 INFECTED' },
  { id: 'hit', re: /^(.+) ▸ (.+)$/, example: 'SUBJECT 1 ▸ UNIT-3' },
  { id: 'points', re: /^PTS (-?\d+)$/, example: 'PTS 3' },
  { id: 'escapedNum', re: /^(.+) — ESCAPED #(\d+)$/, example: 'UNIT-2 — ESCAPED #1' },
  { id: 'escapedHash', re: /^ESCAPED #(\d+)$/, example: 'ESCAPED #2' },
  { id: 'stepStreak', re: /^STEP (\d+)\/(\d+) · x(\d+)$/, example: 'STEP 12/40 · x3' },
  { id: 'junk', re: /^JUNK (\d+)$/, example: 'JUNK 3' },
  { id: 'specialDelivery', re: /^(.+) made a special delivery$/, example: 'UNIT-2 made a special delivery' },
  { id: 'blade', re: /^BLADE (\d+)$/, example: 'BLADE 3' },
  { id: 'fedSaws', re: /^(.+) fed the saws$/, example: 'SUBJECT 1 fed the saws' },
  { id: 'reloaded', re: /^(.+) RELOADED$/, example: 'UNIT-3 RELOADED' },
  { id: 'isArmed', re: /^(.+) IS ARMED$/, example: 'SUBJECT 1 IS ARMED' },
  { id: 'pistolAssembled', re: /^(.+) — PISTOL ASSEMBLED$/, example: 'UNIT-2 — PISTOL ASSEMBLED' },
  { id: 'ammo', re: /^AMMO (\d+)\/(\d+)$/, example: 'AMMO 4/6' },
  { id: 'parts', re: /^PARTS (\d+)\/(\d+)$/, example: 'PARTS 2/4' },
  { id: 'carrying', re: /^CARRYING (.+)$/, example: 'CARRYING BARREL' },
  { id: 'puffsCig', re: /^PUFFS (\d+) · CIG (\d+)$/, example: 'PUFFS 5 · CIG 1' },
  { id: 'puffs', re: /^(\d+) PUFFS$/, example: '5 PUFFS' },
  { id: 'peasFork', re: /^PEAS (\d+) {2}FORK (\d+)$/, example: 'PEAS 14  FORK 2' },
  { id: 'peas', re: /^PEAS (\d+)$/, example: 'PEAS 14' },
  { id: 'finishedNum', re: /^FINISHED #(\d+)$/, example: 'FINISHED #1' },
  { id: 'plateClean', re: /^(.+) — PLATE CLEAN$/, example: 'UNIT-3 — PLATE CLEAN' },
  { id: 'foundSyringe', re: /^(.+) FOUND THE SYRINGE$/, example: 'UNIT-2 FOUND THE SYRINGE' },
  { id: 'jabs', re: /^JABS (\d+)$/, example: 'JABS 2' },
  { id: 'opened', re: /^OPENED (\d+)$/, example: 'OPENED 3' },
  { id: 'placeOut', re: /^#(\d+) OUT$/, example: '#2 OUT' },
  { id: 'escapedLower', re: /^(.+) escaped$/, example: 'UNIT-4 escaped' },
  { id: 'neverListened', re: /^(.+) never listened$/, example: 'SUBJECT 1 never listened' },
  { id: 'metersToGo', re: /^(\d+)m TO GO$/, example: '23m TO GO' },
  { id: 'terminated', re: /^(.+) — TERMINATED$/, example: 'UNIT-2 — TERMINATED' },
  { id: 'nameReason', re: /^(.+) — (.+)$/, example: 'UNIT-2 — CAUGHT EATING' },
];
