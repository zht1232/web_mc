# ageneral-purpose-0fe9ef31e71ed682

- 会话：1:1复刻26.2mc游戏（已崩溃）
- 时间：2026-11-01T03:39:04.776Z → 2026-11-01T03:51:28.160Z
- 模型：qfmodel
- 转录行数：137（助手文本 2 条）
- 工具使用：Bash×15 WebFetch×14 Read×12 WebSearch×7 Grep×3

## 派发的任务

You are working on a browser WebGL2 recreation of Minecraft Java 26.2 in `C:\Users\zht\Documents\Qoder\2026-11-01\4194ac07\webcraft26` (TypeScript + Vite). A dev server is ALREADY running on http://127.0.0.1:5174 with HMR. Official vanilla assets are served from `public/mc/` (built by `scripts/build-assets.mjs` from `G:/ck-web26/vanilla/assets/minecraft`).

YOU MAY ONLY EDIT THESE FILES: `src/renderer.ts`, `src/assets.ts`, `src/postfx.ts`, `scripts/build-assets.mjs`, and add new files under `public/mc/`. Another agent is concurrently editing `src/mesher.ts` and `src/world.ts`, and the main agent is editing `src/player.ts` and `src/main.ts`. Do NOT touch their files. Do NOT run `npm run build`, do NOT restart the dev server, do NOT run git commands, do NOT commit.

A real user just played the game and reported it "looks like a cheap game", with three specific defects that are YOURS to fix. I have already diagnosed them; implement exactly these:

## 1. Shadow map flickers/crawls while the player moves
`Renderer.renderShadowMap()` in src/renderer.ts (around line 535) builds the light view matrix from `this.eye[0], this.eye[1], this.eye[2]` every frame with `centerX = eye.x`, `centerZ = eye.z`, target y `= this.eye[1]`, ortho radius 86, near 1, far 380. Because the center moves continuously, shadow-map texels slide across world geometry each frame → visible crawling/shimmer on the ground while walking.
Fix it the standard way: keep the light direction and ortho extents fixed for a given sun angle, and snap the light-space texel grid. Concretely: build `lightView` from an unsnapped center, transform the center into light space (`lightView * eye`), round x/y/z to multiples of `texel = (2*radius)/shadowSize`, transform back to world space (inverse of the rotation part — since lookAt's upper 3x3 is orthonormal, the inverse is its transpose), then rebuild `lookAt` with the snapped world center. Also snap the sun direction so it only changes in small discrete steps (e.g. quantize the day angle to ~1/2048 of a day) to avoid sub-texel rotation shimmer. Verify by reasoning about the math; do not leave the old continuous center.

## 2. The lake looks broken: a mosaic of differently-shaded blue tiles and you can see the terraced lake bed
Part of this is another agent's job (per-face light sampling in mesher.ts). YOUR part is the water shading in the chunk fragment shader in src/renderer.ts: water currently uses the same lighting path as solid blocks, and it is too transparent, so the blocky lake floor shows through.
Make deep water fade to an opaque biome-tinted blue the way vanilla's water fog does: in the fragment shader you already have `vLayer == uWaterLayer` special-casing for the animated normals/specular. Add depth-based extinction — compute the vertical distance from the fragment's world Y down to the lake bed is NOT available, so instead use the camera-space distance travelled through water: the cleanest approach that works here is to darken/desaturate toward the water tint using the fragment's sky-light and its world Y relative to sea level (y=63), i.e. `float depth = clamp((63.5 - vWorldPos.y) / 6.0, 0.0, 1.0)` and then `c = mix(c, uWaterDeepColor, depth * 0.72)` plus raising alpha with depth so the bed is not visible through more than ~3 blocks of water. If the vertex format does not already carry world position, you can derive it from the vertex position you already have in the vertex shader — add a `vWorldPos` varying rather than changing the CPU-side vertex layout (the layout is shared with the other agent's file). Expose `uWaterDeepColor` from the existing biome water tint you already pass in. Keep the existing Fresnel/spec/animation behaviour intact.

## 3. The first-person arm and held block look wrong
Current state (src/renderer.ts): `buildHandMesh()` around line 889 emits three hardcoded RGB cuboids (two tan boxes + one cyan box) and `renderViewmodel()` places the held block with an NDC hack (`blockScale = 0.29`, `bx = 0.52 * bz * tanHalf * aspect`). I took a screenshot: the held grass block appears as a giant cube floating in the middle-right of the screen with a tiny cyan sliver under it. That is the single biggest contributor to "cheap game" feel.

Rebuild the viewmodel properly:
- **Real arm geometry**: a Minecraft right arm is a 4×12×4 pixel cuboid (0.25 × 0.75 × 0.25 blocks, 1 block = 16 px). Textured from the official player skin. The skin exists locally at `G:/ck-web26/vanilla/assets/minecraft/textures/entity/player/wide/steve.png`. Copy it into the served asset tree following the existing convention used for `public/mc/entities/{cow,pig,skeleton,zombie}.png` (e.g. `public/mc/entities/steve_wide.png`), and make `scripts/build-assets.mjs` copy it too so the build stays reproducible (read that script first; it may already have a list of entity textures to copy — extend that list).
- **Exact UV unwrap** for a box (w,h,d) at skin uv (u,v) in a 64×64 skin; the right arm is uv (40,10), w=4, h=12, d=4: top (44,10,4,4), bottom (48,10,4,4), right (40,14,4,12), front (44,14,4,12), back (48,14,4,12), left (52,14,4,12). Note the skin PNG has a transparent second layer; use only the base layer (standard alpha-blend of the helmet/overlay layer at those coords is usually empty for the arm — if the overlay is opaque there, ignore it).
- **Placement/animation**: look up the real vanilla constants instead of eyeballing. `ItemInHandRenderer` (Mojang, decompiled sources are mirrored on the web, e.g. mcsrc.dev / Mishiro public mirrors / github search for `renderHandWithItem`) applies roughly: shoulder offset, `Axis.YP.rotationDegrees(35 - viewBobX*20)`, `Axis.ZP.rotationDegrees(-17)`, `Axis.XP.rotationDegrees(-70)`, `scale(0.375, -0.375, 0.375)` for the held item, and the arm is rendered from the player model with `root.xRot ≈ -0.5233`, arm `yRot ≈ 0.6981` for the idle first-person pose. USE THE WebSearch/WebFetch tools to confirm these numbers from an actual decompiled `ItemInHandRenderer` / `HumanoidRenderer` source for a 1.20+ version, and cite in your final report which values you adopted and from where. If the web is unreachable, fall back to calibrating visually: the arm must enter from the bottom-right corner of the screen, angled, hand gripping the bottom of a block that occupies roughly 25–33% of screen height, showing its top face and two side faces.
- The held block must be attached to the hand (same transform chain), not positioned independently. Keep the existing mobile/portrait handling working: on touch devices the viewmodel is smaller and more centred (`viewTouch` flag), preserve that behaviour with the new chain.
- Keep the swing animation (`swing()`), bob (`setViewmodelMotion`) and `setViewmodelVisible` APIs exactly as `src/main.ts` calls them today — the main agent is editing that file concurrently and the call signatures MUST NOT change. Read the current call sites in src/main.ts first and preserve them.
- The arm must be lit by the player's light level (there is already a light uniform used by the viewmodel pass) and must render with NEAREST filtering, no mipmapping, and correct depth (it must not clip into nearby blocks — the existing viewmodel pass presumably uses a separate depth range; keep it).

## Verification
After implementing, run `npx tsc --noEmit` from the project root and fix every error you introduced. Then, if the `browser-use` MCP tools are available to you, navigate the in-app browser to `http://127.0.0.1:5174/?preview&quality=high`, wait for load (poll `window.__mc`), and take a screenshot to confirm the arm/held block look right; you can set the camera with e.g. `window.__mc.player.pos = {x:46.5,y:64.5,z:-20.5}; window.__mc.player.pitch = 0.3;`. Note: `window.__mc.player.locked` is false in the embedded browser, so the game does not tick physics — that is expected and is the main agent's concern. If browser tools are not available to you, say so in your report instead of guessing.

Report back: what you changed (file:line), the vanilla constants you found and their source URL(s), anything you could not verify, and the remaining visual gaps you noticed in your own screenshots. Be concise but specific.

## 报告（转录末段）

I'll start by exploring the project and reading the files I'm allowed to edit.



---

Now let me research the vanilla constants and inspect the player skin in parallel.


