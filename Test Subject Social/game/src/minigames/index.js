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
import { HotSeat } from './hotseat.js';
import { LiveOrdnance } from './ordnance.js';
import { DropZone } from './dropzone.js';
import { TurbineHall } from './turbine.js';
import { CableRun } from './cablerun.js';
import { MotionSensor } from './motion.js';
import { SpinCycle } from './spincycle.js';
import { CrumbleFloor } from './crumble.js';
import { QuickDraw } from './quickdraw.js';
import { VentCrawl } from './ventcrawl.js';
import { LaserSweep } from './lasersweep.js';
import { ChairProtocol } from './chairs.js';
import { WinchRace } from './winch.js';
import { PressureTest } from './pressure.js';
import { GlassPanels } from './glassbridge.js';

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
  HotSeat,
  LiveOrdnance,
  DropZone,
  TurbineHall,
  CableRun,
  MotionSensor,
  SpinCycle,
  CrumbleFloor,
  QuickDraw,
  VentCrawl,
  LaserSweep,
  ChairProtocol,
  WinchRace,
  PressureTest,
  GlassPanels,
];

/** Look up a minigame class by id. */
export const findGame = (id) => REGISTRY.find((G) => G.meta.id === id) || null;
