# ageneral-purpose-cfe42e8c2426bc99

- 会话：1:1复刻26.2mc游戏（已崩溃）
- 时间：2026-10-31T23:18:37.588Z → 2026-10-31T23:29:19.488Z
- 模型：dfmodel
- 转录行数：356（助手文本 2 条）
- 工具使用：Bash×113 Read×16 WebFetch×2 WebSearch×1

## 派发的任务

I'm building a high-fidelity browser (WebGL2) renderer that reproduces Minecraft Java Edition 26.2 visuals 1:1, using the user's own official 26.2 client assets. This is a research-only task: do NOT modify any files in the repo. I need an engineering spec of vanilla's lighting/rendering math so my renderer matches the game, not an approximation.

Context: MC 26.2 ("Chaos Cubed", released 2026-06-16, protocol 776) is installed on this machine. The extracted resource assets are at G:/ck-web26/vanilla/assets/minecraft (textures/models/blockstates/shaders only; no decompiled classes). You can read those files and use the web (Minecraft Wiki, bug reports, open-source clones like Sodium/Canvas/Iris, yarn/mojmap names). Do not dump large copyrighted source; report formulas/constants and cite sources/class names.

Deliver, in under ~1500 words, a precise table/spec covering:

1. Lightmap: exact modern vanilla formula used to build the 16x16 lightmap from skyLight and blockLight (0-15), including the brightness/gamma curve (Mth / LightTexture equivalents), the day/night sky-light color, block-light color, and how gamma/brightness slider and dimension ambient light enter. Give numeric RGB values if available (day, night, sunset, thunder). Explain how multiple light sources combine (max? sum?) and how directional face shading multiplies in.
2. Ambient occlusion: vanilla's 4-corner AO computation (which 3 neighbor samples per corner), the exact brightness multiplier values for 0/1/2/3 occluders, and how smooth lighting averages light samples (the 4 samples per vertex, opaque sample exclusion).
3. Face shading: vanilla brightness multipliers per face direction (up/down/north/south/east/west), and when shading is disabled.
4. Light propagation: skylight decrement rules (transparent vs. attenuating blocks), block light attenuation, light opacity values for water/leaves/ice/glass/etc., sky exposure/rain-thunder reduction, cross-chunk propagation concerns. State exact opacity/attenuation numbers if known.
5. Fog: overworld fog start/end as a function of render distance / fog settings, sky color blending, underwater fog color+distance, lava fog, blindness/darkness effects (just note them). Give formulas.
6. Sky and celestial: day/night sky colors, sunrise/sunset interpolation, void color, star rendering, sun/moon angles and sizes, cloud layer Y/scale/speed/color/opacity. State values for modern (1.18+) worlds.
7. Biome tinting: how grass/foliage/water colors are derived from the colormap textures (temperature/downfall, triangular interpolation?), swamp/other special cases, default colors, and how tintindex maps to tint layers.
8. Water rendering specifics: water surface height, light attenuation/opacity, tint, animation timing, underwater visibility, culling rules.
9. Anything that changed in 26.2 specifically (new sulfur caves / cinnabar visuals, Vibrant Visuals, Vulkan renderer) that affects vanilla-default appearance — but note whether it's opt-in.
10. A short "recommended M1 constants" list for a WebGL2 implementation, flagged where you're unsure.

Cite sources with URLs for each major item. Be explicit about which version the constant is from; prefer 1.21+/26.x. If a value is unknown, say so instead of inventing it.

## 报告（转录末段）

I'll start by exploring the installed assets and checking what's available, then research each subsystem.

---

I decompiled the installed 26.2 client (`G:/ck-web26/client-26.2.jar`, sha1 `2dc72797…`, Mojang-named classes) and cross-checked against the extracted assets/data. Everything below is code-derived unless marked **[?]**.

# 1. Lightmap (`Lightmap`, `LightmapRenderStateExtractor`, `shaders/core/lightmap.fsh`)

Per-vertex light is packed `block<<4 | sky<<20` (`LightCoordsUtil.pack`); the shader receives it as UV2, computes `u=(block<<4)/256+0.5/16`, `v=(sky<<20)/256+0.5/16`, then `ℓb=floor(16u)/15`, `ℓs=floor(16v)/15` (16 discrete steps; the 16×16 texture content is not actually sampled for terrain).

```
curve(ℓ)      = ℓ / (4 − 3ℓ)                     // ℓ∈[0,1]
BlockFactor   = 1.4 + flicker                    // flicker += (r1−r2)*r3*r4*0.1 each tick, *=0.9
SkyFactor     = 1.0 day / 0.24 night (timeline); rain lerp→0.24 @0.3125, thunder @0.527
BlockLightCol = mix(BlockLightTint, white, 0.9*(2ℓb−1)²)
color  = max(AmbientColor, NightVisionColor*NVintensity)
       + SkyLightColor*curve(ℓs)*SkyFactor
       + BlockLightCol*curve(ℓb)*BlockFactor
color  = mix(color, color*(0.7,0.6,0.6), bossDarkening)
color -= DarknessScale; clamp(0,1)
color  = mix(color, notGamma(color), BrightnessFactor)   // gamma option 0..1 (default 0.5)
notGamma(c): m=max(r,g,b); c*(1−(1−m)^4)/m
```
Sources are **max-combined** (light engine stores per-cell max), then **summed** only across the sky/block/ambient channels in linear space. Dimension `ambient_light` (0 / 0.1 / 0.25) survives only in `Lightmap.getBrightness()` = `lerp(ambientLight, curve, 1)` (UI/entity path) **[?]**; terrain ambient comes from `visual/ambient_light_color`.

| Constant (26.2 defaults) | Value |
|---|---|
| SkyLightColor day → night | `#FFFFFF` → `#7A7AFF` (`Timelines.NIGHT_SKY_LIGHT_COLOR` = 0.48,0.48,1.0); nether `#7A7AFF`, end `#AC60CD` |
| BlockLightTint | `#FFD88C` |
| AmbientColor | OW `#0A0A0A`, Nether `#302821`, End `#3F473F` |
| NightVisionColor | `#999999` |
| SkyColor (attribute) | OW `#78A7FF` × timeline (`#FFFFFF` day → `#000000` night); rain gray 0.6@0.75, thunder 0.24@0.94 |
| FogColor (attribute) | OW `#C0D8FF` × timeline `#FFFFFF` day → `#0C0C16`/`#161616` night |
| Sunrise/sunset ARGB | peak `#FEDA6333`≈α0.996 `#DA6333` at t≈12732; 0 during day/night |

# 2. Ambient occlusion (`BlockModelLighter`, `CardinalLighting`)

Per corner: 4 samples = `sideA`, `sideB`, `diagonal`, `center` (block in front of the face). Diagonal is only read if at least one side is translucent (`!isViewBlocking || dampening==0`); otherwise `diagonal := sideA`. Shade brightness `Block.getShadeBrightness` = **0.2** if `isCollisionShapeFullBlock`, else **1.0** (glass/ice override to 1.0). Sum is averaged `*0.25` → effective multiplier **1.0 / 0.8 / 0.6 / 0.4** for 0/1/2/3 occluders (0.2 if the front block is opaque).

Light: each vertex uses `smoothBlend(a,b,diag,center)` = `(a+b+diag+center)>>2` per byte lane, with the fix-up: if center sky>2 or block>2, any zero neighbor is replaced by center (or gets center's sky bits). Partial (non-cube) faces use `smoothWeightedBlend` with shape-derived bilinear weights instead of a plain average. With AO off, one sample: `max(light at face neighbor)`.

# 3. Face shading (`CardinalLighting`)

`DEFAULT = (down .5, up 1.0, north .8, south .8, west .6, east .6)`; `NETHER = (.9,.9,.8,.8,.6,.6)` (from `"cardinal_light":"nether"`). Baked into vertex colour as `tint × shade × AO`; faces with `"shade": false` use `up()` (1.0, or 0.9 in the Nether). Clouds use their own (bottom .7, top 1.0, N/S .8, E/W .9). Entities use `light.glsl`: `clamp((max(0,dot(L0,n))+max(0,dot(L1,n)))*0.6 + 0.4, 0,1)`.

# 4. Light propagation (`LightEngine`, `SkyLightEngine`, `BlockLightEngine`)

- `newLevel = fromLevel − max(1, lightDampening)`; propagation blocked (level→0) if merged face-occlusion shapes overlap (`Shapes.mergedFaceOccludes`).
- `lightDampening`: **15** if occlusion shape is a full cube; **0** if `propagatesSkylightDown`; else **1**. Overrides: leaves **1**, water/lava (LiquidBlock) **1**, ice/frosted ice **1**, glass/beacon etc. (TransparentBlock) **0**, tinted glass **15**.
- Skylight: cells at/above per-column `ChunkSkyLightSources` lowest-source Y are **15**; below that it decrements like block light. So water/leaves/ice cost 1 sky level per block (matches [Wiki: Light-filtering blocks](https://minecraft.wiki/w/Light)), glass costs 0, block light is unaffected relative to air.
- Weather reduces the *lightmap*, not per-block values: SKY_LIGHT_FACTOR lerps to 0.24 (rain 0.3125, thunder 0.527); SKY_LIGHT_LEVEL 15→4 (gameplay only).
- Cross-chunk: light lives in 16³ nibble sections; light only propagates into loaded sections (`storingLightForSection`), unloaded → `BEDROCK` fallback. Sample a 1-voxel border from neighbour sections.
- `emissiveRendering` blocks (lava, fire, magma…) return full bright (block 15, sky 15).

# 5. Fog (`FogRenderer`, `fog/environment/*`, `fog.glsl`)

`total = max(linear(sphericalDist, envStart, envEnd), linear(cylindricalDist, rdStart, rdEnd))`, `cylDist = max(|xz|, |y|)`, `mix(color, fogColor, total*fogColor.a)`.
Render-distance fog: `D = chunks*16`, `span = clamp(D/10, 4, 64)`, `rdStart = D − span`, `rdEnd = D`.
Atmospheric: `envStart = attr + (−160*rainFog)`, `envEnd = max(min(96, attrEnd), attrEnd − 256*rainFog)`; overworld attrs default `0 … 1024`; `rainFog = rain * clamp((skyLight−8)/7,0,1) * (precip?1:0.5)`, smoothed `*0.2*Δticks`. `skyEnd = min(D, 512)`, `cloudEnd = min(cloudRange*16, 2048)`.
Color = `srgbLerp(skyMix, fogColor, skyColor)` where `skyMix = 1 − clampedLerp(min(32,D)/32, 0.25, 1)^0.25` (0 at D≥32); then sunrise tint when looking sunward (`dot(forward, ±X) * sunriseAlpha`), void darkening `*(1−clamp((32+minY−camY)/32))²`, and boss darkening `*(0.7,0.6,0.6)`.
Water: **−8 … 96**, color **#050533** (end × `max(0.25, waterVision)`). Lava: **#991900**, 0.25…1 (Fire Resistance 0…5). Powder snow **#9FBBCC**, 0…2. Blindness `0.25d…d`, Darkness `0.75d…d`, d = lerp(renderDistance, 5 / 15).

# 6. Sky / celestial (`SkyRenderer`, `timeline/day.json`)

Sky dome: fan radius **512** at y=+16, flat SkyColor, fogged to `skyEnd` (so horizon fades to fog); black disc at y=12 below horizon. Sun: 30×30 quad at y=100; moon 20×20 at y=100, 8 phases. Sun angle 0→360° over 24000 ticks from noon, eased cubic-Bézier (0.362,0.241,0.638,0.759); moon 540→180; star angle 0→360. Rotation `YP(−90)·XP(angle)`. Stars: 1500 quads at r=100, size 0.15–0.25, additive `OVERLAY` (src·srcα+dst), brightness 0…0.5 from timeline. Sunrise fan: r=120, z=−cos·40, colour `#DA6333`-ish, z-scaled by alpha.
Clouds (`CloudRenderer`): cell **12×12×4**, height **192.33**, 256×256 mask, drift **0.6 b/s** east + 3.96 z offset, colour `#CCFFFFFF` day / `#CC191926` night, distance fade to `cloudEnd`.

# 7. Biome tint (`GrassColor`, `ColorMapColorUtil`, `Biome`, `ClientLevel.calculateBlockTint`)

`rain *= temp; x=(1−temp)*255; y=(1−rain)*255; color = pixels[y<<8|x]` — **nearest texel, no interpolation** in the 256×256 colormap ([Biome §Colors](https://minecraft.wiki/w/Biome)). Biome blend option r (default 2) averages `(2r+1)²` biome colours with uniform weights.
Defaults: water `#3F76E4`; plains grass (t=.8,d=.4) `#91BD59`, default `get(0.5,1.0)` `#7CBD6B`. Swamp: `BIOME_INFO_NOISE(x*.0225,z*.0225) < −0.1 ? #4C763C : #6A7039`. Dark forest: `((base & 0xFEFEFE)+0x28340A)>>1`. `tintindex` selects the *n*-th `BlockTintSource` registered for that block (`BlockColors`/`BlockTintSources`).

# 8. Water (`FluidRenderer`, `WaterFogEnvironment`)

Surface **8/9** (`MAX_FLUID_HEIGHT=0.8888889`, top −0.001); corner heights averaged over the 4 diagonal neighbours; 1.0 if same fluid above. Tint = biome water colour × texture (grayscale palette, **α=180/255**), multiplied by face shade (top 1.0, sides 0.8/0.6). Light = `max(light(pos), light(pos.above))`. Texture: 32 frames, `frametime 2` (still, 3.2 s); flow 32×32, frametime 1. Culling: skip faces against the same fluid or occluding neighbour; overlay sprite next to half-transparent/leaves. Rendered in `TRANSLUCENT` layer (sorted per section). Underwater: fog 0…96 scaled by water vision; opacity 1 per block.

# 9. 26.2-specific

Sulfur caves biome adds `visual/fog_color #8CB831`, `water_fog_color #17543C`, `water_color #34BF89`, `grass_color #ABA64F` — **vanilla default, not opt-in** (`data/minecraft/worldgen/biome/sulfur_caves.json`). Sulfur/cinnabar are ordinary opaque blocks (dampening 15); sulfur spikes are speleothems (dampening 0). No per-block light emission found **[?]**. `Chaos_Cubed` adds an **experimental, opt-in** Vulkan backend (Video Settings → Graphics API: Default / Prefer Vulkan / Prefer OpenGL; [26.2 changelog](https://minecraft.wiki/w/Java_Edition_26.2)). **Vibrant Visuals is still Bedrock-only** in 26.2 ([Vibrant Visuals](https://minecraft.wiki/w/Vibrant_Visuals)); the Java attribute/timeline lightmap system shipped in **26.1** ([26.1 changelog](https://minecraft.wiki/w/Java_Edition_26.1)) and changes the lightmap API, not the look.

# 10. Recommended M1 constants (WebGL2)

| Item | Value | Note |
|---|---|---|
| Light curve | `ℓ/(4−3ℓ)` | exact |
| BlockFactor | 1.4 (no flicker) | flicker optional |
| SkyFactor | 1.0 / 0.24 | rain 0.24@0.3125 |
| SkyLightColor | #FFFFFF / #7A7AFF | sRGB blend |
| BlockLightTint | #FFD88C | |
| Ambient | #0A0A0A | OW |
| Gamma mix | `mix(c, notGamma(c), gamma)` | gamma 0…1, default .5 |
| AO | 0.2 per occluder, 4-sample avg | 1/.8/.6/.4 |
| Face shade | .5/1/.8/.8/.6/.6 | |
| Fog | `D−clamp(D/10,4,64) … D`, skyEnd 512, clouds 2048 | |
| Water fog | #050533, −8…96 | |
| Water top | 8/9, α .706 | |
| Clouds | y=192.33, 12×12×4, 0.6 b/s, #CCFFFFFF | |
| Sun/moon | 30 / 20 @100, r=512 dome, 1500 stars | |

**[?]** Items I could not fully confirm: exact callers of `Lightmap.getBrightness`; whether the legacy `ambient_light` scalar affects terrain at all; star blend factor naming; no light-emission flag on sulfur blocks.

**Sources:** 26.2 client jar (`G:/ck-web26/client-26.2.jar`) + `data/minecraft/{dimension_type,timeline,worldgen/biome}`, `assets/minecraft/shaders/**`, `textures/colormap/*`; [Java Edition 26.2](https://minecraft.wiki/w/Java_Edition_26.2), [Chaos Cubed](https://minecraft.wiki/w/Chaos_Cubed), [Java Edition 26.1](https://minecraft.wiki/w/Java_Edition_26.1), [Light](https://minecraft.wiki/w/Light), [Sky](https://minecraft.wiki/w/Sky), [Fog](https://minecraft.wiki/w/Fog), [Water](https://minecraft.wiki/w/Water), [Biome](https://minecraft.wiki/w/Biome), [Vibrant Visuals](https://minecraft.wiki/w/Vibrant_Visuals).
