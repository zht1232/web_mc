# ageneral-purpose-03c26aef710bf7fc

- 会话：1:1复刻26.2mc游戏（已崩溃）
- 时间：2026-11-01T03:55:44.853Z → 2026-11-01T04:21:10.184Z
- 模型：qfmodel
- 转录行数：296（助手文本 1 条）
- 工具使用：Bash×85 Edit×13 Read×7 Write×3

## 派发的任务

RESEARCH ONLY. Do not edit files, do not run builds, do not use any browser/screenshot tool (machine is CPU-saturated, browser reserved). Produce an authoritative, cited delta list between real Minecraft Java 26.2 GUI/HUD layout and this web reimplementation.

Project: `C:\Users\zht\Documents\Qoder\2026-11-01\4194ac07\webcraft26`. Read `src/hud.ts` (hotbar, hearts, creative/survival inventory panels, carried item, toasts, debug overlay), `src/menu.ts` + `src/menu.css` + `src/menuAssets.ts` (title screen, panorama, buttons, sliders), `src/assets.ts` (which GUI sprites are loaded), `src/font.ts` (the vanilla bitmap font).

Ground truth, in priority order:
1. The official sprites actually on disk: `G:/ck-web26/vanilla/assets/minecraft/textures/gui/` — inspect `gui/container/inventory.png`, `gui/container/creative_inventory/*`, `gui/sprites/hud/*` (hotbar.png, hotbar_selection.png, crosshair.png, heart/*, food_*, armor_*, experience_bar_*), `gui/gui.png`, `gui/icons.png`. Report real pixel dimensions and the exact sub-rect coordinates of each element (measure the PNGs; you can use Node or Python via Bash to read PNG sizes and even sample pixels — that is allowed, it is cheap).
2. Decompiled sources via WebSearch/WebFetch for `Gui.renderPlayerHealth`, `Gui.renderHotbar`, `Gui.renderSlot`, `CreativeModeInventoryScreen.init/slotClicked`, `SpriteGuiIcon`, `Font`, and the vanilla widget metrics (button size 200x20, 150x20 for some, the 4px/2px GUI scaling, `BlitOffset`).
3. Minecraft Wiki pages.

Answer with numbers + source for each:
- Hotbar: exact x/y in GUI-space pixels for a 178x-scaled screen, slot size, the selection frame sprite and its geometry, the item sprite size inside a slot, and the "selected item pop" animation curve (vanilla scales the held item briefly when you change slots — confirm the curve and duration).
- Hearts / hunger / armor / air bubbles / XP bar: exact offsets relative to the hotbar, spacing per unit (8px?), the half-icon rules, the right-side (hunger) draw order, and the heart "container" sprite usage.
- Crosshair: the vanilla blend mode used for `crosshair.png` (it is not plain alpha — confirm) and its size.
- Creative inventory: panel size, grid origin, number of columns/rows, tab sprite coordinates for selected/unselected top and bottom tabs, the scroller geometry, the search field, and the hover-tooltip layout (background colour, border, the rarity tint, the "block of X" line, the creative-only grey italic line, and how the item name is drawn for enchantment glint).
- Survival inventory: 3x3 crafting grid slot coordinates, armour slot coordinates, the 27+9+1 slot layout, and the carried-item draw rules (stack count font position/colour/shadow, the 1.5 z-offset trick).
- Item stack count rendering: exact position, colour, shadow, and the "+N" / "xN" rules.
- Title screen: panorama size/scale/rotation speed and parallax, the splash text rotation/amplitude/period, the Realms-style button widths and the "Minecraft" title sprite vs font usage, and the vignette/overlay darkening.

Deliverable: a compact table — element | our value (file:line or function) | vanilla value | source | impact — then the top 6 corrections ranked by visible impact. Under 500 words. Do not restate the code.

## 报告（转录末段）

Research done. Ground truth came from (a) measuring the shipped PNGs and (b) disassembling the Mojang-mapped `G:/ck-web26/client-26.2.jar` (`Hud`, `GuiGraphicsExtractor`, `AbstractContainerScreen`, `CreativeModeInventoryScreen`, `InventoryMenu`, `TooltipRenderUtil`, `LogoRenderer`, `SplashRenderer`, `Panorama`, `Toast`, `RenderPipelines`, `Window`). Wiki was not needed.

| element | our value (file:line) | vanilla 26.2 | source | impact |
|---|---|---|---|---|
| hotbar bg/selection/icon pos | hud.ts:403-411 `(guiW-182)/2`,`H-22`,sel `x-1,y-1` 24×23, item `+3,+3` 16px | `W/2-91`,`H-22` (182×22); sel blitSprite 24×23 at `-1,-1`; item `W/2-90+i*20+2, H-19` | Hud.extractItemHotbar; hotbar.png 182×22 (dark cell x3-18) | ✓ correct |
| held-item pop | none | `f=1+pop/5; scale(1/f,(f+1)/2)` pivot `(x+8,y+12)`, pop=5 ticks | Hud.extractSlot | **high** |
| stack count | none | `x+19-2-width, y+9`, 0xFFFFFF, shadow, only if count>1 (plain digits, no "xN") | GuiGraphicsExtractor.itemCount | **high** |
| hearts | hud.ts:414 `(hotbarX+2+i*8, H-33)` | `(W/2-91+i*8, H-39-rows*rowOffset)`, rowOffset=max(3,12-rows), jitter `+rnd(2)` if hp≤4, blink `((tick-healthBlink)/3)%2`, HeartType full/half/poison/withered/absorb + container | Hud.extractPlayerHealth/Hearts | **high** |
| armor / food / air / XP | absent | armor 9×9 `(left+i*8, H-49)`; food `(W/2+91-i*8-9, H-39)` right→left; air `(same x, H-49)`; XP bg `(W/2-91,H-29)` 182×5, progress `xp*183`, "XP" 4×black+0x80FF00 at `H-35` | Hud.extractArmor/Food/AirBubbles; ContextualBar.left/top | **critical (missing)** |
| crosshair | hud.ts:425 plain alpha | `RenderPipelines.CROSSHAIR` = BlendFunction.INVERT `(ONE_MINUS_DST_COLOR,ONE_MINUS_SRC_COLOR)`, 15×15 at `((W-15)/2,(H-15)/2)`, white 9×9 core | RenderPipelines.<clinit>; crosshair.png | **high** (invisible on light sky) |
| item name popup | hud.ts:429 2200 ms, `H-40`, white | `H-59` (creative `H-45`), alpha `min(255,timer*256/10)` over 60 ticks, rarity colour, italic if renamed, textWithBackdrop | Hud.extractSelectedItemName | medium |
| creative tabs | hud.ts:198/202 `x+7+i*26` / `x+6+i*26`, y `-28` / `h-4` | `left+col*27`; right row `left+195-27*(7-col)+1`; y `top-28` / `top+132`; icon `+5,+9/+7`; sprite 26×32 (unselected content starts y2) | getTabX/Y, extractTabButton | medium (1px/tab drift) |
| scroller | hud.ts:328 `+round(frac*75)` | `left+175, top+18+(int)(95*scroll)`, 12×15, disabled sprite when !canScroll | CreativeModeInventoryScreen.extractBackground | medium |
| search field | absent | EditBox `left+82, top+6, 80×9`, maxlen 50, unbordered, tab_item_search.png panel (bbox 0,0,195,136) | .init | medium |
| hover highlight | hud.ts:301 white 16×16 α.55 | `slot_highlight_back` blitSprite `(x-4,y-4,24×24)`, opaque bbox 4-19 | AbstractContainerScreen | medium |
| tooltip | hud.ts:351 `w+8`,13px, rgba(16,0,16,.94), 1px purple, 1 line, TitleCase | sprite bg `tooltip/background`+3px `tooltip/frame` stretched `(x-3,y-3,w+6,h+6)`, per-rarity sprite path, multi-line, name coloured by rarity, glint overlay | TooltipRenderUtil | **high** |
| survival inventory | hud.ts:271 reuses 195×136 creative panel + hotbar row | 176×166 uv(0,0); armour `(8,8+18i)` + `container/slot/{helmet…}`; craft 2×2 `(98,18)`, result `(154,28)`; 27 @`(8+18c,84+18r)`; hotbar y142; offhand `(77,62)`; player `(26,8)-(75,78)` s30 ×1/16 | InventoryMenu.<init>, InventoryScreen | **critical** |
| title logo/splash/pano | menu.ts:535 logo `min(274,vw-16)`÷4, no edition.png; :560 `rotate(-0.3+sin(t*.0018)*.03)`, size 1; :387 yaw `0.45+t*1.8e-5` (~1°/s) | logo 256×64 `(W/2-128,44)` + edition 128×16 `(W/2-64,51)` (1/10000 minceraft); splash `translate(+123,+69) rotate(-0.349066) scale(1.8-|sin(t/1000·2π)|·0.1)` 0xFFFFFF3F; pano `spin+=0.1°/frame` (~6°/s) + mouse parallax + panorama_overlay.png | LogoRenderer, SplashRenderer, Panorama | high (splash pulses wrong axis; pano 6× slow) |
| toasts | hud.ts:437 centred text y=12, 1600 ms | top-right 160×32, 32px slots, 300 ms slide, 5000 ms, title `(30,7)` gold, body `(30,18)` | Toast/AdvancementToast | medium |
| GUI scale | hud.ts:60 clamp 2-4, may be odd | max s with `fbW/(s+1)≥320 && fbH/(s+1)≥240`, forced even | Window.calculateScale | low |

**Top 6 corrections by visible impact:** 1 XP bar + armor + hunger + air bubbles (entire HUD half is absent); 2 hearts y `H-39`, x `left+i*8`, blink/jitter/state sprites; 3 crosshair INVERT blend; 4 slot-count text (`x+17-w, y+9`, white, shadow) + 5-tick pop squash `(1/f,(f+1)/2)`; 5 sprite-based 3px tooltip with rarity colour/multi-line; 6 real survival inventory (176×166 + menu slot coords) and the 10-arg title/pulse fixes (splash scale-pulse 0.1/1000 ms, logo 256×64@44, pano 0.1°/frame).
