---
name: reference-mc262-authoritative-data
description: Ground truth for Minecraft Java 26.2 on this machine — the Mojang-mapped client jar and what is inside it, how to read it, the working vanilla client for reference screenshots, and the unpacked Complementary pack
metadata:
  type: reference
---

**`G:/ck-web26/client-26.2.jar`** — the user's own official 26.2 client jar (31,709 entries: `assets/minecraft/**` 10,967 files, `data/minecraft/**` 8,525, `net/minecraft/*.class` 10,372). Contains **both** the assets and the bundled vanilla data pack.

**The jar is Mojang-mapped**, so class names are readable (`Hud`, `GuiGraphicsExtractor`, `ItemInHandRenderer`, `LightmapTextureManager`, `Panorama`, `RenderPipelines`, `Window`, `Attributes`, `LivingEntity`…) and **engine constants really are recoverable from the class files** — disassembling it is how we got the authoritative HUD geometry, lightmap maths, FOV multipliers and mob attributes. A usable `java.exe`/JDK set exists (see [[windows-local-env-facts]]); `python` + `zipfile` is the fast path for listing/counting/reading JSON entries.

**`G:/ck-web26/src-vanilla/`** — the full client jar decompiled to **Java source with Vineflower 1.11.2** (7,055 files, Mojang-mapped, 2026-11-01). Regenerate with `G:/ck-web26/tools/vineflower.jar` + the Mojang Java 25 runtime: `"C:/Users/zht/AppData/Roaming/.minecraft/runtime/java-runtime-epsilon/bin/java.exe" -Xmx4G -jar vineflower.jar -ae G:/ck-web26/client-26.2.jar G:/ck-web26/src-vanilla` (that runtime is a full JDK — it has javac/javap too). This supersedes javap constant-hunting: read the class directly. 26.2's model system lives in `client/resources/model/{ModelBakery,BlockStateModelLoader,cuboid/*}.java`, dispatch in `client/renderer/block/dispatch/*`, blockstate codecs in `data/models/blockstates/*`, and `com/mojang/math/{OctahedralGroup,Quadrant,SymmetricGroup3,Transformation}.java` for the rotation maths (joml names elements `m<col><row>`, which bites you in `SymmetricGroup3.transformation()`).

**`G:/ck-web26/vanilla/assets/minecraft/`** — already-extracted assets (source for the project's served copy under `webcraft26/public/mc/`, built by `scripts/build-assets.mjs`, env var `MC_ASSETS`).

What to look for, by question:
- Rendering/geometry constants → `models/block/block.json` (`display`: `gui` rotation `[30,225,0]` scale `0.625`, `firstperson_righthand` `[0,45,0]` scale `0.40`, plus `gui_light: "side"`), `models/item/*.json` for per-item transforms.
- Block appearance/states → `blockstates/*.json` (1,198: 1,096 variant-keyed, only 102 multipart) and `models/block/*.json` (2,657).
- Item appearance/tints → `items/*.json` (1,537 component-selector definitions) — **not** `builtin/generated`.
- Gameplay/world data → `data/minecraft/recipe/` (1,585 across 21 types), `worldgen/biome/` (66, with the newer `attributes` registry for sky/fog/music), `worldgen/structure*` + `template_pool`, `loot_table/` (1,355), `enchantment/` (43), `tags/` (794), `advancement/` (1,688).
- Structure geometry → **1,212 `.nbt` templates ship inside the client jar** (~3.7 MB; village 483, trial_chambers 191, bastion 167, trail_ruins 84, mansion 73, ancient_city 58 …), so 1:1 vanilla structures are possible from local data alone.
- Text → `lang/en_us.json` (8,123 keys), `texts/splashes.txt` (454). **Audio is NOT in the jar** (0 `.ogg`, no `sounds.json`) — the full sound registry needs the remote Mojang assets index.
- Player skins **are** local: `textures/entity/player/wide/steve.png` (+ `alex`, `slim/*`) — right-arm UV region `(40,10)` for a 4×12×4 box.
- Vanilla's own GLSL is in the jar too: `assets/minecraft/shaders/core/*` (62) and `include/fog.glsl` — `core/lightmap.fsh` and `core/sky.fsh` are the source of the real light curve and sky model.

**Real vanilla client for reference screenshots (verified launchable, not yet run):** root `C:\Users\zht\AppData\Roaming\.minecraft` (PCL-managed), version `versions/26.2/26.2.json`, Java 25 runtime `runtime\java-runtime-epsilon\bin\java.exe`, 88/88 Windows libraries and 5057/5057 assets present. A launch harness was generated: `G:/ck-web26/make_launch.py` → `G:/ck-web26/launch.args` (88 libs + the G: jar on `-cp`), with pinned `G:/ck-web26/shotdir/options.txt` (ao true, fancy, mipmaps 4, RD 12, fov 1.0, guiScale 4, entityShadows, minimal particles, clouds on, 60 fps, en_us) and F2 writing to `shotdir/screenshots`. **Always launch with a clean `--gameDir`** — the installed instance carries Fabric + Sodium/Iris/Voxy/Xaero/REI, which all change rendering.

**Complementary Shaders – Reimagined** r5.9.3 unpacked at **`D:/tmp/shaderport/pack`** (426 files). Modrinth slug is **`complementary-reimagined`** (`complementary-shaders` 404s). There is **no `settings.glsl`** — every default is a `#define` at the top of `shaders/lib/common.glsl` (lines 14-300, derived defines 361-660); functions live in `lib/**`, one stage per `program/**` file.

**Constraints:** everything under `public/mc/` is Mojang/Microsoft property, extracted from the user's own client for **local private use only** — never commit, never deploy publicly; same rule for reference-derived shader material. The user has ruled that third-party license terms are **not** a constraint on this private project, so do not spend effort analysing them (note that Iris-dependent GLSL cannot be pasted into a WebGL2 renderer anyway — what transfers is algorithms and default constants). Also do not modify, start, stop or install plugins into his live Paper server at `G:/Minecraftserver/DaemonData/Servers/1` without explicit approval; use a separate copy for bridge testing.
