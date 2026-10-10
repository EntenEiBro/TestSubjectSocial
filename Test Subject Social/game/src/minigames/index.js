/**
 * index.js — registry of every simulation, in canonical (manual) order.
 *
 * To add a new round: create a Minigame subclass with a unique `meta.id`
 * and append it here. Menus, playlists and quick-launch pick it up
 * automatically.
 */
import { SidearmAssembly } from './sidearm.js';
import { OpenSeason } from './openseason.js';
import { AlcoveRoulette } from './alcove.js';
import { HotSpider } from './hotspider.js';
import { PistonPress } from './piston.js';
import { Incinerator } from './incinerator.js';
import { SymbolFloor } from './symbolfloor.js';
import { DownEscalator } from './escalator.js';
import { SupperClub } from './supperclub.js';
import { SyringeHunt } from './syringe.js';
import { ChiselTest } from './chisel.js';
import { SonarCrossing } from './sonar.js';
import { ForkliftFrenzy } from './forklift.js';
import { SawbladeRicochet } from './sawblade.js';
import { SmokeBreak } from './smokebreak.js';

export const REGISTRY = [
  SidearmAssembly,
  OpenSeason,
  AlcoveRoulette,
  HotSpider,
  PistonPress,
  Incinerator,
  SymbolFloor,
  DownEscalator,
  SupperClub,
  SyringeHunt,
  ChiselTest,
  SonarCrossing,
  ForkliftFrenzy,
  SawbladeRicochet,
  SmokeBreak,
];

/** Look up a minigame class by id. */
export const findGame = (id) => REGISTRY.find((G) => G.meta.id === id) || null;
