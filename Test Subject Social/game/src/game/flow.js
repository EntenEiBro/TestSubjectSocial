/**
 * flow.js — session orchestration: programs (modes) and individual rounds.
 *
 *   playProgram(app, 'original' | 'arcade' | {ids, shuffle})
 *     └ for each simulation: roulette reel picks it → playRound(app, GameClass)
 *          title card → briefing (2 pages + ready) → countdown → play
 *     └ animated points screen after every round, winner ceremony at the end
 */
import { Audio } from '../core/audio.js';
import { shuffle, sleep } from '../core/util.js';
import { seedRandom, makeSeed } from '../core/rng.js';
import { Haptics } from '../core/haptics.js';
import { PLACEMENT_POINTS } from './players.js';
import { REGISTRY } from '../minigames/index.js';
import * as S from '../ui/screens.js';

const BOT_LEVELS = [0.3, 0.6, 0.9];

const INTRO_LINES = [
  'Good evening, subjects. Welcome to the facility.',
  'Tonight you will participate in a series of entertaining simulations.',
  'Each simulation has a winner. Losing is discouraged. Permanently.',
  'Points are awarded for placement. The subject with the most points will be released.',
  'The others will be repurposed. Please enjoy the party.',
];

const OUTRO_LINES = [
  'The program is complete. Your cooperation has been noted.',
  'Results have been tabulated by an impartial machine.',
];

/** How many simulations a program draws from the whole archive. */
export const PROGRAM_SIZE = { original: 15, arcade: 10 };

/**
 * Build the list of minigame classes for a mode, always in random order:
 * FULL PROGRAM draws 15 and QUICK SHIFT 10 random simulations from the whole
 * registry; a custom playlist plays all of its picks. `lastId` (the
 * simulation played most recently) is kept off the first slot so a new
 * program never opens with the game that just ended.
 */
export function programList(mode, lastId = null) {
  const pool = mode === 'original' || mode === 'arcade' ? REGISTRY : REGISTRY.filter((G) => mode.ids.includes(G.meta.id));
  let list = shuffle(pool);
  if (list.length > 1 && list[0].meta.id === lastId) list.push(list.shift());
  if (PROGRAM_SIZE[mode]) list = list.slice(0, PROGRAM_SIZE[mode]);
  return list;
}

/** Run a full program. Returns when the final screen is dismissed or the program aborted. */
export async function playProgram(app, mode) {
  const list = programList(mode, app.lastGameId);
  const ceremony = mode === 'original';
  app.players.forEach((p) => p.resetStats());
  if (ceremony) await S.monologue(app, INTRO_LINES);
  for (let i = 0; i < list.length; i++) {
    // The next simulation is "drawn" on a spinning reel before it starts.
    await S.roulette(app, list[i], i, list.length, REGISTRY);
    const outcome = await playRound(app, list[i], i, list.length);
    if (outcome === 'quit') { app.showBackdrop(); return; }
    // Points are handed out with an animation, then the standings re-sort.
    await S.pointsScreen(app, app.players, app.lastResults, { game: list[i], roundIndex: i, total: list.length });
  }
  if (ceremony) await S.monologue(app, OUTRO_LINES, { title: 'CONCLUSION' });
  app.showBackdrop();
  await S.finalScreen(app, app.players, { ceremony });
}

/**
 * Play a single simulation. Returns 'done', 'skip' or 'quit'.
 * @param {*} app
 * @param {typeof import('../minigames/base.js').Minigame} G
 */
export async function playRound(app, G, index = 0, total = 1) {
  const hud = app.hud;
  hud.clear();
  hud.hide();
  // Online players run the round on their own devices (net/lockstep.js).
  const online = app.net.hasRemotePlayers;
  const botDifficulty = BOT_LEVELS[app.settings.botLevel];
  const build = (seed, lockstep) => {
    seedRandom(seed);
    const g = new G({ engine: app.engine, input: app.input, hud, players: app.players, botDifficulty, lockstep });
    g.build();
    app.engine.setScene(g.scene, g.camera);
    g.state = 'preview';
    app.game = g;
    return g;
  };
  const seed = makeSeed();
  let game = build(seed, false);
  app.lastGameId = G.meta.id;
  if (online) app.net.roundStart(G, seed, app.players, botDifficulty);
  Audio.music('tension');

  if (!app.quick) {
    await S.titleCard(app, G, index, total);
    await S.briefing(app, G, game.seats);
  }
  if (online) {
    // Every device swaps the briefing preview for a fresh, identical copy
    // (the idle preview may have animated differently on each screen).
    const seed2 = makeSeed();
    game.dispose();
    game = build(seed2, true);
    app.net.roundPrepare(seed2);
  }
  hud.setPlayers(game.seats);
  hud.show();
  if (app.touch) app.touch.setContext('play'); // joystick + buttons only during rounds
  await S.countdown(app);
  Haptics.roundActive = true; // from now on only the local player's own events vibrate
  if (online) app.lockstep.start(game); // tick 0 begins the round on every device
  else game.begin();
  Audio.music('none');

  // Wait for the round to finish, or for a pause-menu decision.
  const outcome = await Promise.race([
    game.finished.then((tiers) => ({ kind: 'done', tiers })),
    app.pauseSignal().then((choice) => ({ kind: choice })),
  ]);
  if (app.touch) app.touch.setContext(null); // results / menus are tapped directly
  Haptics.roundActive = false;

  let result = 'done';
  app.lastResults = null; // filled in for finished rounds (shown by pointsScreen)
  if (outcome.kind === 'done') {
    app.lastResults = scoreRound(game, outcome.tiers, G);
    hud.hide();
    await sleep(1400); // let the last moment of the round sink in
  } else {
    result = outcome.kind; // 'skip' | 'quit'
  }
  if (app.touch) app.touch.setContext(null);
  if (online) { app.lockstep.stop(); app.net.roundEnd(); }
  app.game = null;
  game.dispose();
  hud.clear();
  hud.hide();
  app.showBackdrop();
  Audio.music('menu');
  return result;
}

/** Convert placement tiers into points and update player records. */
export function scoreRound(game, tiers, G) {
  const table = PLACEMENT_POINTS[game.seats.length] || PLACEMENT_POINTS[4];
  const results = [];
  let pos = 0;
  for (const tier of tiers) {
    const points = table[pos] ?? 0;
    for (const seat of tier) {
      const died = !seat.alive;
      seat.player.score += points;
      if (died) seat.player.deaths++;
      seat.player.history.push({ game: G.meta.id, place: pos + 1, points, died });
      results.push({ player: seat.player, place: pos + 1, points, died });
    }
    pos += tier.length;
  }
  // Seats missing from tiers (shouldn't happen) get last place with 0.
  for (const seat of game.seats) {
    if (!results.some((r) => r.player === seat.player)) {
      seat.player.history.push({ game: G.meta.id, place: game.seats.length, points: 0, died: !seat.alive });
      results.push({ player: seat.player, place: game.seats.length, points: 0, died: !seat.alive });
    }
  }
  return results;
}
