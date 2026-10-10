/**
 * flow.js — session orchestration: programs (modes) and individual rounds.
 *
 *   playProgram(app, 'original' | 'arcade' | {ids, shuffle})
 *     └ for each simulation: playRound(app, GameClass)
 *          title card → briefing (2 pages + ready) → countdown → play → results
 *     └ standings after every round, final judgement at the end
 */
import { Audio } from '../core/audio.js';
import { shuffle } from '../core/util.js';
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

/** Build the ordered list of minigame classes for a mode. */
export function programList(mode) {
  if (mode === 'original') return shuffle(REGISTRY);
  if (mode === 'arcade') return shuffle(REGISTRY).slice(0, 10);
  const chosen = REGISTRY.filter((G) => mode.ids.includes(G.meta.id));
  return mode.shuffle ? shuffle(chosen) : chosen;
}

/** Run a full program. Returns when the final screen is dismissed or the program aborted. */
export async function playProgram(app, mode) {
  const list = programList(mode);
  const ceremony = mode === 'original';
  app.players.forEach((p) => p.resetStats());
  if (ceremony) await S.monologue(app, INTRO_LINES);
  for (let i = 0; i < list.length; i++) {
    const outcome = await playRound(app, list[i], i, list.length);
    if (outcome === 'quit') { app.showBackdrop(); return; }
    await S.standings(app, app.players, { roundIndex: i, total: list.length });
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
  const game = new G({
    engine: app.engine, input: app.input, hud, players: app.players,
    botDifficulty: BOT_LEVELS[app.settings.botLevel],
  });
  game.build();
  app.engine.setScene(game.scene, game.camera);
  game.state = 'preview';
  app.game = game;
  Audio.music('tension');

  if (!app.quick) {
    await S.titleCard(app, G, index, total);
    await S.briefing(app, G, game.seats);
  }
  hud.setPlayers(game.seats);
  hud.show();
  if (app.touch) app.touch.setContext('play'); // joystick + buttons only during rounds
  await S.countdown(app);
  game.begin();
  Audio.music('none');

  // Wait for the round to finish, or for a pause-menu decision.
  const outcome = await Promise.race([
    game.finished.then((tiers) => ({ kind: 'done', tiers })),
    app.pauseSignal().then((choice) => ({ kind: choice })),
  ]);
  if (app.touch) app.touch.setContext(null); // results / menus are tapped directly

  let result = 'done';
  if (outcome.kind === 'done') {
    const results = scoreRound(game, outcome.tiers, G);
    hud.hide();
    await S.roundResults(app, G, results);
  } else {
    result = outcome.kind; // 'skip' | 'quit'
  }
  if (app.touch) app.touch.setContext(null);
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
