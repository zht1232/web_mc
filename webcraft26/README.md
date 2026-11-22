# WebCraft26

A browser port of **Minecraft 26.2 (Java Edition)** built with TypeScript, WebGL2 and a
Canvas2D GUI. It runs entirely in the browser and loads the game assets from your own
local Minecraft installation.

> **Fan project, not affiliated with Mojang or Microsoft.** Minecraft is a trademark of
> Mojang Synergies AB. No Minecraft assets (textures, models, sounds, fonts, language
> files) are distributed with this repository. See [Asset and licence notes](#asset-and-licence-notes).

中文简介：这是用 TypeScript + WebGL2 + Canvas2D 写的 Minecraft 26.2 浏览器复刻，
存档、区块流式加载、光影、GUI、实体与红石都在浏览器里运行；仓库不包含官方素材，
需要用自己的正版客户端导入。

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
details. The authoritative, continuously updated gap list is
[`REPORTS/STATUS.md`](REPORTS/STATUS.md).

## Quick start

Requirements: Node.js 20.19+ (or 22.12+), npm, and a WebGL2-capable browser.
You also need a legally owned copy of Minecraft: Java Edition 26.2.

```bash
npm install

# Point MC_ASSETS at the `assets/minecraft` folder inside your 26.2 client jar.
# PowerShell:
$env:MC_ASSETS = "C:\path\to\client-26.2\assets\minecraft"
# bash:
# export MC_ASSETS=/path/to/client-26.2/assets/minecraft

# Optional: the launcher asset store that contains the .ogg files and font data.
# Defaults to %APPDATA%/.minecraft/assets on Windows and ~/.minecraft/assets elsewhere.
# $env:MC_EXTERNAL = "$env:APPDATA\.minecraft\assets"

npm run assets   # imports models/textures/states/entity textures into public/mc/
npm run dev      # http://127.0.0.1:5174/
```

`public/mc/` is generated locally and is ignored by git. If you want to run the app
without importing assets, place a compatible `public/mc/` tree there yourself.

`Start-WebCraft.bat` is a Windows convenience launcher: it installs dependencies,
imports assets if `public/mc/manifest.json` is missing, starts the dev server and opens
the browser.

### URL parameters

| Parameter | Effect |
|---|---|
| `?play` / `?preview` | Skip the title screen and enter a world (used by tests/screenshots) |
| `?touch=1` / `?touch=0` | Force the touch control layer on/off |
| `?seed=<string>` | World seed (number or arbitrary string) |
| `?world=<id>` | Open a saved world directly |
| `?perf=0` / `?perf=20` | Disable performance sampling / open the perf panel |

## Controls

**Desktop:** WASD move, Space jump (double-tap to fly), Shift sneak/descend, Ctrl sprint,
F fly, E inventory, T chat, Esc pause, F3 debug screen, F6 toggle shaders. Left click
mine/attack, right click use/place, middle click pick block, wheel/1-9 hotbar.

**Touch:** left stick to move, drag the right side to look; on-screen buttons for jump,
sneak, mine, place, use, inventory, chat and pause. Flight adds up/down buttons.

**Chat commands:** `/time set …`, `/weather …`, `/gamemode …`, `/tp …`, `/give …`,
`/summon …`, `/kill`, `/gamerule advance_time false`.

`window.__mc` exposes the running `Game` instance for debugging.

## Architecture

```text
src/client/Game.ts                  startup, world lifecycle, input, render loop, menu wiring
src/client/gui/                     vanilla-style screens (title, world select, options, inventory, containers)
src/client/renderer/                WebGL2 renderer: chunks, entities, sky/clouds/weather, shadows, post-processing, hand
src/client/world/                   chunk streaming, spawn selection, IndexedDB saves
src/client/audio|particle|interaction/  sound, particles, placement rules
src/vanilla/                        26.2 class-library port: world/entity/item/levelgen/lighting/redstone/NBT
bridge/                             historical Paper WebSocket plugin (not wired into the browser client)
scripts/                            asset importers, unit tests, browser probes, screenshot tools
public/mc/                          locally imported Minecraft assets (gitignored)
```

The simulation layer intentionally keeps vanilla class and method names where practical,
so behaviour can be compared against the decompiled 26.2 sources and against
[Horizon](https://github.com/horizon-rust/horizon) (Rust, LGPL-3.0-or-later).

## Verification

```bash
npx tsc --noEmit
node scripts/test-redstone.mjs        # redstone long tail + pistons + rails (browser)
node scripts/test-taming.mjs          # wolf/cat taming, sitting and follow (browser)
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

The browser-based scripts need Playwright's Chromium (`npx playwright install chromium`)
and a running dev server on `http://127.0.0.1:5174` (the test scripts accept `--url`).
`node scripts/smoke.mjs` writes screenshots to `shots/` (gitignored).

## Asset and licence notes

- **Code:** LGPL-3.0-or-later. See [`../LICENSE`](../LICENSE) and [`../NOTICE`](../NOTICE).
  Parts of the simulation layer are ported from Horizon (LGPL-3.0-or-later).
- **Game assets:** textures, models, sounds, fonts, language files and other data are
  Mojang/Microsoft property. They are **not** included in this repository; `public/mc/`
  is generated locally from a legally owned game installation. Do not commit that
  directory or deploy it publicly.
- **No game code:** this project does not distribute Mojang code or a Minecraft client.
  You must own Minecraft: Java Edition to import its assets.
