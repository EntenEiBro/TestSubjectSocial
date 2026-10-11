# Test Subject Social

An original, browser-based collection of short, **lethal party games** for 2–4
local players, built as an homage to the "violent party game" genre
(e.g. *Machine Party*). Everything — models, textures, UI, music and sound
effects — is generated procedurally at runtime; the project contains no
third-party art or audio assets.

> Gather your friends, volunteer as test subjects, and survive fifteen
> simulations where losing is permanent (until the next round).

## Playing (standalone)

Open the **`Test Subject Social`** folder and double-click
**`Test Subject Social.exe`**. That folder contains everything needed to play
(no Python or internet required); copy or zip the whole folder to share it with
another Windows 10/11 PC. The game opens fullscreen in its own window (F11
toggles fullscreen, Alt+F4 quits). It uses Microsoft Edge, which ships with
Windows, as its renderer.

The game's files exist in one place only: `Test Subject Social/game/`. Edit
them there and simply restart the .exe. Rebuilding is only needed if you change
the launcher (`play.py` / `serve.py`); it refreshes the .exe and `_internal`
and never touches `game/`:

```bash
python -m pip install pyinstaller
python build_exe.py
```

From source you can also use `python play.py` (same app window) or the
`Play Test Subject Social.bat` shortcut.

## Android app

The **`Android Version`** folder holds everything needed to install the phone
version: **`Test Subject Social.apk`** plus **`HOW TO INSTALL.txt`**. The app is:
the same game with on-screen touch controls (floating joystick on the left,
Ⓐ/Ⓑ on the right, pause at the top, +BOT/−BOT in the lobby). Bluetooth
gamepads work too. Android 7.0 or newer, landscape, fully offline.

Install: copy the .apk to the phone (USB, cloud drive, messenger…), tap it
and allow "install unknown apps" for that source when Android asks. Or plug
the phone in with USB debugging enabled and run `python build_apk.py --install`.

Online with a friend's phone (no PC needed): Host: **HOST ONLINE** → an
**internet code** like `K7QPXW` appears — it works from anywhere with mobile
data or any Wi-Fi. Friend: **JOIN ONLINE** → type the code → press Ⓐ in the
lobby to take a seat. On the same Wi-Fi (or the host phone's hotspot) the LAN
code like `QAYC-7K2P` also works without internet. The phone's back button
leaves a friend's game (or pauses your own).

Rebuild after changing the game: `python build_apk.py` (needs JDK 17, the
Android SDK and Gradle 8.7 under `D:\AndroidDev`). The Android shell lives in
`android/` (`MainActivity` = full-screen WebView, `GameServer` = built-in
file server + online relay, the Java twin of `serve.py`); the game files are
copied in from `Test Subject Social/game` at build time.

## Running from source

Requirements: any modern desktop browser with WebGL. All third-party assets
(three.js, fonts, PeerJS) are bundled in `game/vendor/`, so no internet is
needed (except for internet online play).
Python 3 is only used as a static file server (it serves `Test Subject Social/game`).

```bash
python serve.py
```

Then open <http://localhost:8765>. The server listens on your local network
by default (LAN play); add `--local` to restrict it to this computer.

## Online play (internet + LAN)

Every round runs **on each player's own device**: the host sends the round's
random seed and then everyone's inputs, 60 times per second, and every device
simulates and renders the round itself ("deterministic lockstep"). No video
during rounds, full local graphics, and the host's game never waits for a slow
connection. Menus between rounds are mirrored from the host. PCs and phones
mix freely. HOST ONLINE opens two rooms at once:

- **Internet code** (6 letters, e.g. `K7QPXW`) — friends anywhere can join.
  [PeerJS Cloud](https://peerjs.com) (free public broker at `0.peerjs.com`)
  introduces the two devices; the game itself then flows directly between them.
- **LAN code** (e.g. `QAYC-7K2P`) — same Wi-Fi / LAN or the host phone's
  hotspot, works without internet. Every copy of the game listens on port 8765.

1. The host chooses **HOST ONLINE** and shares one of the codes.
2. Friends choose **JOIN ONLINE** — on a PC or a phone — and type the code.
   (Esc on a PC, or the phone's back button, leaves the friend's game.)
3. In **Subject Intake** each joining player presses their action button to take
   a seat and customizes their subject like a local player. Mix and match
   local players, online players and bots in the same session.

On Windows, the first launch shows a **Windows Firewall** prompt — allow access
on private networks, otherwise other devices on your LAN cannot reach your game.

While hosting, the codes stay visible in a corner badge on every menu
(with each online player's ping). When a program ends or is aborted, everyone
returns to **Subject Intake** with their seats kept. Joining players see their
ping in the top-left corner (`RELAY` means the link runs through a relay
server, which is slower). If a connection drops, the joining player
reconnects automatically and gets their seat back; while they are away their
subject stands idle and the game does not wait for them.

Technical notes: internet rooms use the bundled PeerJS library
(`game/vendor/peerjs`, MIT) for signaling only — the host registers the id
`test-subject-social-<code>`, and a PeerJS data connection carries the WebRTC
offer. LAN rooms carry it over the tiny WebSocket relay in `serve.py`
(standard library only) / the Android app's `GameServer`. Both then use one
RTCPeerConnection per player with these channels: `input` (controller state,
unordered, no retransmits), `sim` (round control: seed, rebuild, end) and
`frames` (numbered input frames; each packet repeats the last 8 ticks, gaps
are resent), plus `ui` (menu/HUD snapshots) and video for the menus.
Lockstep details are in `src/net/lockstep.js`: simulation code takes its
randomness from the seeded `core/rng.js` and its time from the game clock, so
the same seed and inputs give the same round on every device; the host sends a
state checksum every half second, and a client that ever disagrees falls back
to the host's video for the rest of that round. A joining player's own input
shows up after one network round-trip. Very strict networks (some corporate or
mobile carriers) force traffic through PeerJS's free TURN relay, which is
slower; then prefer the LAN code or a hotspot.

## Controls

| Device          | Move              | Action Ⓐ  | Shove / Secondary Ⓑ |
|-----------------|-------------------|-----------|---------------------|
| Keyboard (left) | W A S D           | F         | G                   |
| Keyboard (right)| Arrow keys        | Enter     | Right Shift         |
| Gamepad (×4)    | Left stick / D-pad| A / Cross | B / Circle          |

Lobby extras: **T** / gamepad **Y** adds a bot, **Y** / gamepad **X**
removes one, **Esc** goes back. **Esc** during a round opens the pause menu
(resume / skip simulation / abort program).

## Game flow

1. **Intro** (every launch, ~6 s): a facility terminal boots, the picture
   switches on like an old CRT, the intake room lights up and the title is
   stamped in. Then the **title terminal** — Begin Testing, Calibration
   (volume, bot skill, render resolution, gore), Field Manual, Credits.
2. **Subject intake (lobby)** — up to four seats. Each human joins with
   their own device and customizes a jumpsuit colour, skin tone, headwear
   and face accessory, then confirms READY. Empty seats can be filled
   with facility bots (minimum two participants).
3. **Select program** (always in random order; a program never opens with
   the simulation that was just played)
   * **Full Program** — 15 random simulations out of all 30, with an
     orientation monologue and the winner ceremony.
   * **Quick Shift** — 10 random simulations, no monologue.
   * **Custom Playlist** — pick any simulations; they are shuffled.
4. **Each simulation**: a roulette reel spins and lands on the next
   simulation → title card → two-page briefing (controls, then the win
   condition) → every subject readies up → 3-2-1 → play → animated
   **simulation report** (each subject's placement and points are counted
   onto the standings bars, the rows re-sort, the leader is crowned).
5. Placement points per round: **3 / 2 / 1 / 0** (4 players), 3 / 1 / 0
   (3 players), 3 / 0 (2 players). Highest total is released.
6. **Winner ceremony**: drumroll and a sweeping spotlight, then the winner's
   pedestal rises in a burst of confetti while everyone else sinks through
   the floor; the final table follows. Afterwards everyone returns to
   Subject Intake.

## The simulations

| # | Simulation | Type | Summary |
|---|------------|------|---------|
| 1 | Sidearm Assembly | Assembly | Grab pistol parts off a conveyor, build your gun at your own bench, then shoot everyone else. |
| 2 | Open Season | Roles | Rotating hunter with a scoped rifle vs. runners crossing a courtyard; headshots kill instantly. |
| 3 | Alcove Roulette | Survival | A train is coming. There is one fewer safe alcove than subjects. Shove someone out. |
| 4 | Hot Spider | Survival | A mechanical spider bomb latches onto your back. Throw it onto someone else before it snaps your spine. |
| 5 | Piston Press | Survival | Junk rains onto your platform; throw it onto rivals. The fullest platform gets pressed. |
| 6 | The Incinerator | Precision | Burn the art, let the machine parts pass. Lowest score is fed to the furnace. |
| 7 | Symbol Floor | Survival | Monitors announce a symbol; those floor tiles drop into the pit. |
| 8 | Down Escalator | Reflex | Enter the arrow sequence to climb a down escalator before the crusher eats you. |
| 9 | Supper Club | Stealth | Eat your peas only while the host isn't watching. He is armed. |
| 10 | Syringe Hunt | Deception | Search the cabinets; whoever finds the syringe starts infecting everyone else. |
| 11 | Chisel Test | Precision | Carve the target pattern out of your 3×3 block before the timer — or face the firing squad. |
| 12 | Sonar Crossing | Hazard | Cross a minefield; stand still to ping sonar. A harvester is coming. |
| 13 | Forklift Frenzy | Competitive | Stack crates in your zone (and steal others'). Fewest crates is crushed. |
| 14 | Sawblade Ricochet | Survival | Dodge ricocheting saw blades in a pen lined with hacksaws. Shove rivals into them. |
| 15 | Smoke Break | Timing | Release your drag inside the sweet zone. Cough and you fall behind; fewest puffs is executed. |

## Project structure

Project root (tooling):

```
serve.py              no-cache static server + WebSocket signaling relay (stdlib only)
play.py               desktop launcher: server + Edge/Chrome app window, quits with it
build_exe.py          rebuilds the launcher (.exe + _internal) in "Test Subject Social/"
tools/make_icon.py    generates game/icon.png and icon.ico (stdlib only)
icon.ico              .exe icon used by the build
```

`Test Subject Social/` (the playable game — copy this folder to share it):

```
Test Subject Social.exe   launcher
_internal/                Python runtime for the launcher
README.txt                how to play
game/                     ALL game files (single copy — edit here)
```

Inside `game/` (paths below are relative to it):

```
index.html            entry point (import map for three.js)
icon.png              favicon / window icon
css/style.css         all UI styling (stencil/terminal theme, HUD, letterbox, grain)
vendor/               bundled three.js (MIT) and fonts (OFL / Apache-2.0) with licenses
src/main.js           App bootstrap + top-level menu loop + debug quick-launch
src/core/             engine-level, game-agnostic modules
  engine.js           renderer (low-res pixelated), main loop, camera shake, lamps
  input.js            keyboard halves + gamepads + bots behind one Controller API
  audio.js            Web Audio synthesizer: effects + procedural music beds
  textures.js         procedural grungy canvas textures, materials, text textures
  characters.js       customizable low-poly "test subject" rig + procedural animation
  fx.js               debris physics, blood, decals, smoke, sparks, death styles
  physics.js          top-down arena movement, collisions, shove
  environment.js      reusable set dressing (rooms, pipes, monitors, stencils, fans)
  ai.js               bot steering helpers
  rng.js              seeded random generator for simulation code (lockstep-safe)
  util.js             math/random/timer helpers (Math.random: cosmetic use only)
src/game/
  players.js          roster, customization, placement points table
  flow.js             programs (modes) and the per-round lifecycle + scoring
src/ui/
  screens.js          every menu/interstitial as an awaitable function
  hud.js              in-round HUD (timer, panels, banners, kill feed, name tags)
  backdrop.js         3D intake room behind the menus
src/net/
  signal.js           LAN relay WebSocket wrapper, room codes, WebRTC config
  joincode.js         LAN join codes (room + host address) and internet codes
  host.js             NetHost: LAN + PeerJS rooms, menu mirroring, remote input, round control
  lockstep.js         deterministic lockstep: host tick driver, client follower, checksums
  remoteround.js      a client's own copy of the current round (build, simulate, render, HUD)
  client.js           remote-player page (?join=ROOM LAN / ?peer=CODE internet)
src/minigames/
  base.js             Minigame base class (the contract every round implements)
  index.js            registry (add new rounds here)
  *.js                one file per simulation
```

### Writing a new simulation

```js
import { Minigame } from './base.js';

export class MyGame extends Minigame {
  static meta = { id: 'mygame', title: 'MY GAME', tagline: '…', category: 'Survival',
    controls: [{ input: 'move', label: 'Move' }], objective: 'Survive.', rules: [] };
  build()          { this.makeScene(); this.makeCamera([0, 12, 10], [0, 0, 0]);
                     this.seats.forEach((s, i) => this.spawnSubject(s, { x: i * 2 })); }
  update(dt)       { /* game logic; call this.kill(seat, 'gib') and this.end() */ }
  botThink(seat)   { seat.ctrl.setMove(1, 0); }
}
```

Online rounds are simulated on every device in lockstep, so game logic must be
deterministic: take randomness from `core/rng.js` (`rand`, `pick`, `random`…)
and time from `this.time` / `this.clock`, never `Math.random()`,
`performance.now()` or timers. Cosmetic-only effects (texture noise, particles)
may still use `Math.random()`.

Register it in `game/src/minigames/index.js`. For quick iteration launch it
directly with bots: `http://localhost:8765/?game=mygame&quick`
(`&players=2`, `&humans=1` to take seat 1 yourself with WASD, `&loop` to repeat).

## Credits

Original code and procedural content. Rendering: [three.js](https://threejs.org) (MIT).
Internet play: [PeerJS](https://peerjs.com) (MIT).
Fonts: Black Ops One and VT323 (SIL Open Font License 1.1), Special Elite
(Apache License 2.0), bundled from Google Fonts — license texts in `game/vendor/`.
