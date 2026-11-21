# WebCraft26

A browser port of **Minecraft 26.2 (Java Edition)** built with TypeScript, WebGL2 and a
Canvas2D GUI. It runs entirely in the browser and imports game assets from your own
local Minecraft installation.

> **Fan project, not affiliated with Mojang or Microsoft.** Minecraft is a trademark of
> Mojang Synergies AB. No Minecraft assets (textures, models, sounds, fonts, language
> files) are distributed with this repository. See [Asset and licence notes](#asset-and-licence-notes).

中文简介：这是用 TypeScript + WebGL2 + Canvas2D 写的 Minecraft 26.2 浏览器复刻，
包含区块流式加载、光影、GUI、实体、红石与存档；仓库不包含官方素材，需要用自己的
正版客户端导入。客户端代码在 [`webcraft26/`](webcraft26)。

## Status

The single-player core loop is playable and covered by automated tests:

- terrain streaming, block breaking/placing, survival and creative mode
- crafting table, chest, furnace, brewing stand, enchanting table, recipe book
- mobs, combat, bows/arrows, potions, farming/breeding, fishing, sleeping
- redstone: wire, levers, buttons, plates, torches (including burnout), repeaters,
  comparators, observers, daylight detectors, tripwires, pistons, lamps, doors,
  trapdoors, fence gates, TNT, rails
- IndexedDB saves plus `.mca` region import/export
- WebGL2 renderer with smooth lighting, sun shadows (PCF), HDR/bloom, SSAO, TAA,
  water, weather, particles and a first-person hand

This is **not** full parity yet. Missing areas include villagers/trading, advancements,
the Nether and the End, vanilla structure templates, minecarts, and several rendering
details. The authoritative gap list is
[`webcraft26/REPORTS/STATUS.md`](webcraft26/REPORTS/STATUS.md).

## Quick start

Requirements: Node.js 20.19+ (or 22.12+), npm, a WebGL2-capable browser, and a legally
owned copy of Minecraft: Java Edition 26.2.

```bash
cd webcraft26

npm install

# Point MC_ASSETS at the `assets/minecraft` folder inside your 26.2 client jar.
# PowerShell:
$env:MC_ASSETS = "C:\path\to\client-26.2\assets\minecraft"
# bash:
# export MC_ASSETS=/path/to/client-26.2/assets/minecraft

# Optional: the launcher asset store with .ogg files and font data.
# Defaults to %APPDATA%/.minecraft/assets on Windows and ~/.minecraft/assets elsewhere.
# $env:MC_EXTERNAL = "$env:APPDATA\.minecraft\assets"

npm run assets   # imports models/textures/states/entity textures into public/mc/
npm run dev      # http://127.0.0.1:5174/
```

`public/mc/` is generated locally and ignored by git. The Windows convenience launcher
`webcraft26/Start-WebCraft.bat` installs dependencies, imports assets when missing,
starts the dev server and opens the browser.

### URL parameters

| Parameter | Effect |
|---|---|
| `?play` / `?preview` | Skip the title screen and enter a world (tests/screenshots) |
| `?touch=1` / `?touch=0` | Force the touch control layer on/off |
| `?seed=<string>` | World seed (number or arbitrary string) |
| `?world=<id>` | Open a saved world directly |
| `?perf=0` / `?perf=20` | Disable performance sampling / open the perf panel |

## Controls

**Desktop:** WASD move, Space jump (double-tap to fly), Shift sneak/descend, Ctrl sprint,
F fly, E inventory, T chat, Esc pause, F3 debug screen, F6 toggle shaders. Left click
mine/attack, right click use/place, middle click pick block, wheel/1-9 hotbar.

**Touch:** left stick to move, drag the right side to look; on-screen buttons for jump,
sneak, mine, place, use, inventory, chat and pause.

**Chat commands:** `/time set …`, `/weather …`, `/gamemode …`, `/tp …`, `/give …`,
`/summon …`, `/kill`, `/gamerule advance_time false`.

`window.__mc` exposes the running `Game` instance for debugging.

## Architecture

```text
webcraft26/src/client/Game.ts       startup, world lifecycle, input, render loop, menu wiring
webcraft26/src/client/gui/          vanilla-style screens (title, world select, options, inventory, containers)
webcraft26/src/client/renderer/     WebGL2 renderer: chunks, entities, sky, shadows, post-processing, hand
webcraft26/src/client/world/        chunk streaming, spawn selection, IndexedDB saves
webcraft26/src/client/audio|particle|interaction/   sound, particles, placement rules
webcraft26/src/vanilla/             26.2 class-library port: world/entity/item/levelgen/lighting/redstone/NBT
webcraft26/bridge/                  historical Paper WebSocket plugin (not wired into the browser client)
webcraft26/scripts/                 asset importers, unit tests, browser probes, screenshot tools
webcraft26/public/mc/               locally imported Minecraft assets (gitignored)
```

The simulation layer keeps vanilla class and method names where practical so behaviour
can be compared against the decompiled 26.2 sources and against
[Horizon](https://github.com/horizon-rust/horizon) (Rust, LGPL-3.0-or-later).

## Verification

```bash
cd webcraft26
npx tsc --noEmit
node scripts/test-redstone.mjs        # redstone long tail + pistons + rails (browser)
node scripts/test-containers.mjs      # container click rules
node scripts/test-menu.mjs            # title/world select screens
node scripts/test-hud-dirty.mjs       # HUD redraw policy
node scripts/test-icons.mjs           # item icon atlas
node scripts/test-taa.mjs             # TAA
npx tsx scripts/test-mobs-render.mts  # entity rendering
npx tsx scripts/test-placement.mts    # block placement rules
npx tsx scripts/test-mesher.mts       # chunk meshing
node scripts/smoke.mjs                # 19-scenario browser smoke test
```

Browser-based scripts need Playwright's Chromium (`npx playwright install chromium`) and
a running dev server on `http://127.0.0.1:5174` (the scripts accept `--url`). Screenshots
are written to `webcraft26/shots/` (gitignored).

## Repository contents

This public repository intentionally excludes:

- `webcraft26/public/mc/` — imported Mojang assets
- `webcraft26/dist/`, `node_modules/`, `generated/`, `shots/`, logs
- `_src/`, `dump/` — local decompiled/reference material used during development
- private development handoffs and session logs

## Asset and licence notes

- **Code:** LGPL-3.0-or-later. See [`LICENSE`](LICENSE) and [`NOTICE`](NOTICE).
  Parts of the simulation layer are ported from Horizon (LGPL-3.0-or-later).
- **Game assets:** textures, models, sounds, fonts, language files and other data are
  Mojang/Microsoft property. They are **not** included in this repository; `public/mc/`
  is generated locally from a legally owned game installation. Do not commit that
  directory or deploy it publicly.
- **No game code:** this project does not distribute Mojang code or a Minecraft client.
  You must own Minecraft: Java Edition to import its assets.
