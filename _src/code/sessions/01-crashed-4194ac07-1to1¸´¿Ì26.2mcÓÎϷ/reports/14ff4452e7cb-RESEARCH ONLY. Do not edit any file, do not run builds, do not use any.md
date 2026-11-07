# ageneral-purpose-ad0614ff4452e7cb

- 会话：1:1复刻26.2mc游戏（已崩溃）
- 时间：2026-11-01T03:55:17.544Z → 2026-11-01T04:16:59.160Z
- 模型：qfmodel
- 转录行数：177（助手文本 2 条）
- 工具使用：Bash×49 WebSearch×5 Read×4 WebFetch×2

## 派发的任务

RESEARCH ONLY. Do not edit any file, do not run builds, do not use any browser/screenshot tool (the machine is CPU-saturated and the browser is reserved for another task). Your job is to produce an authoritative, cited list of deltas between real Minecraft Java Edition 26.2 ("Chaos Cubed", the 1.21.x-era code line) gameplay/movement constants and this web reimplementation's values.

Project: `C:\Users\zht\Documents\Qoder\2026-11-01\4194ac07\webcraft26`. Read `src/player.ts` (movement, collision, jump, flying, raycast reach), `src/mobs.ts` (mob speeds/AI/damage), `src/main.ts` (FOV handling, step sounds, day cycle tick rate).

Official vanilla assets are available locally at `G:/ck-web26/vanilla/assets/minecraft` (and a served copy under `webcraft26/public/mc/`) — use them for anything data-driven. For code constants, use WebSearch/WebFetch against decompiled Mojang-mapped sources (mcsrc.dev-style mirrors, GitHub mirrors of Mojang mappings, official Minecraft Wiki pages such as "Skeleton key / Hunger / Movement / Reach / Attribute"). Cite the URL for every number you assert.

Verify or correct each of these specifically, and give the exact vanilla value plus how it is computed:
1. Walk 4.317 m/s, sprint 5.612 m/s, sneak 1.3 m/s, fly 10.92 m/s, sprint-fly 21.8 m/s — are these right, and what are the underlying attribute values and per-tick multipliers?
2. Gravity and drag: vanilla applies 0.08 blocks/tick² gravity plus per-tick horizontal drag (0.91 on ground, 0.98 in air) and 0.8 vertical in water. What is the exact order of operations per tick (jump velocity vs gravity vs move), and what jump velocity gives the canonical 1.25-block jump? Our code uses GRAVITY=32 m/s², JUMP=9.216 with the jump applied BEFORE gravity, tuned for 60 Hz.
3. Step height 0.6, and what else gates stepping (flying, sneaking, in-water)?
4. Block interaction reach: survival vs creative vs the `block_interaction_range` / `entity_interaction_range` attributes in 1.20+. Our raycast uses 5.5 blocks for both.
5. First-person FOV effect: the exact `GameRenderer#getFov` multipliers for sprinting, flying, elytra, using items/bow, and the `fovEffectScale` lerp. Our code uses a flat 1.087 for sprint/fly.
6. Day cycle: ticks per day (24000), what tick the sun/moon angle corresponds to, and the day/night light transition curve. Our code does `ticks += dt*20` and `sunY = sin(ticks/24000 * 2π)`, with `day = smoothstep(-0.16, 0.16, sunY)`.
7. Water: swim speed, vertical swim velocity while holding jump, drowning/air supply timings, and the water fog distance.
8. Mob numbers for pig/cow/zombie/skeleton in `src/mobs.ts`: health, damage, movement speed, aggro range, attack cooldown, burn-in-daylight. Report what is wrong.
9. Block break timing: vanilla hardness formula with/without the correct tool, and the crack-overlay stage thresholds.

Deliverable: a compact table — item | our value (file:line) | vanilla value | source URL | one-line note on impact. Then a short list of the highest-impact corrections, ordered. Keep the whole report under 450 words. Do not restate the code back to me.

## 报告（转录末段）

I'll start by reading the source files and checking available assets.



---

Research complete (no files touched, no builds). Verdicts below; `jar` = official `G:/ck-web26/client-26.2.jar` class constant pools (`AbstractClientPlayer`, `Attributes`, `LivingEntity`, `Pig`, `Zombie`, `AbstractSkeleton`, `WaterFogEnvironment`).

| # | item | ours (file:line) | vanilla 26.2 | source | impact |
|---|---|---|---|---|---|
|1|walk/sprint|`player.ts:11-12` 4.317 / 5.612|**exact ✓** (attr 0.1; +0.098/tick accel ×0.546 friction → 0.2159 b/t; sprint ×1.3)|wiki Player/Transportation|none|
|1|sneak / fly / fly-sprint|`:15-14` 1.3 / 10.92 / 21.8|1.295 (`sneaking_speed` 0.3), 10.79 (250 %), 21.58 (500 %)|wiki Attribute, Player|~1 % fast|
|2|gravity|`:16` 32 m/s²|**✓** `gravity` attr 0.08 b/t² (jar `Attributes` 0.08)|wiki Attribute|none|
|2|jump|`:18` 9.216, jump-before-gravity ✓, no vertical drag|`jump_strength` 0.42 b/t = 8.4 m/s; per tick v←0.98(v−0.08) → 1.2522 blocks; order = accel→move→friction|wiki Transportation/Player, jar|height 1.165 m@30 Hz → 1.295@144 Hz (±6 %, fps-dependent; vanilla is fixed 20 Hz)|
|3|step|`:22` 0.6, gated on `!flying && onGround` (`:253`)|`step_height` attr 0.6; flying/spectator raise `maxUpStep` (1.0/0); sneaking does *not* block stepping|wiki Attribute, jar `Player#maxUpStep/maxDownStep`|minor; no auto-step-down|
|4|reach|`:339` 5.5 blocks; mobs 4.5 (`main.ts:245`) |`player.block_interaction_range` 4.5 (creative 5), `player.entity_interaction_range` 3.0 (creative 5); hand damage 1, not 4|wiki Interaction range, zh Attribute, jar `Attributes` 4.5/3.0|interaction from too far|
|5|FOV|`main.ts:462` flat 1.087 sprint+fly|sprint 1.1 only (`AbstractClientPlayer#getFieldOfViewModifier`, jar floats 1.1/0.1/0.15), speed term, scoping/bow/elytra states; lerped per tick in `Camera#tickFov` by `fovEffectScale`|wiki, jar|wrong magnitude, wrongly boosts flight|
|6|day cycle|`main.ts:411-413` dt·20 ✓, `sin(linear)`, `smoothstep(±0.16)`|24000 t ✓; angle α=(1−cos(π·mod₁((t−6000)/24000))+mod₄((t−6000)/6000))·60°; sky-light drops 12040 → floor **4** at 13670, rises 22331; mob night 13188–23031|wiki Daylight cycle|ramp too fast/linear, hits 0, hostiles spawn ~1200 t early|
|7|water|`:194` ×0.55 (2.37 m/s), `:208` vy 3.2, no air|surface 2.20 / submerged 1.97, sprint-swim 3.918 (5.305 Depth Strider III); air 300 t (15 s) then 2 HP/s; fog eases to biome distance over 30 s, default colour #050533 (`WaterFogEnvironment` uses `WATER_FOG_START/END_DISTANCE` attributes — no numeric default ships in the jar)|wiki Swimming/Transportation/Water, jar|drowning missing entirely|
|8|mobs|`mobs.ts:63-66`|pig 10 HP ✓, **height 0.9** not 1.0, attr 0.25 (jar); cow 10 HP ✓ 1.4×0.9 ✓ attr 0.2; zombie 20 ✓, damage **3** normal (2.5 easy/4.5 hard), armor 2, aggro **35**, melee ~1 s, **burns** in sunlight ≥15; skeleton 20 ✓, **height 1.99**, attr 0.25, arrow **3–5**, fires every **3 s** (2 s hard) within **15 blocks**, follow 16, burns ≤11 suppressed|mobs.ts values vs wiki Zombie/Skeleton/Pig/Cow, wiki Attribute, jar|damage/aggro/burn all wrong; our speed m/s are untied to `movement_speed`|
|9|break|`player.ts:361` instant|dmg/tick = toolSpeed ÷ hardness ÷30 (harvestable) or ÷100; ticks = ceil(1/dmg); ×1.5/×5 s base; ÷5 airborne; ×0.2 submerged; 6-t delay; instant if dmg≥1; 10 crack stages `destroy_stage_0..9` = floor(progress·10)|wiki Breaking, local assets|manifest already ships `hardness` (85 blocks) but nothing reads it (`types.ts:54`)|

**Highest-impact fixes, in order:** (1) reach → 4.5 block / 3.0 entity + creative modifier; (2) hardness-driven breaking with crack stages (data already local); (3) jump to 0.42 b/t with 0.98 vertical drag and a fixed 20 Hz physics step; (4) mob damage/aggro/daylight-burn (zombie 3 dmg/35 t/burns, skeleton 3–5 dmg/15 t/3 s, pig h 0.9, skeleton h 1.99); (5) FOV 1.1 sprint-only + `fovEffectScale` lerp; (6) air supply 300 t → 2 HP/s; (7) skylight floor 4 and 13188–23031 hostile window; (8) 1.295/10.79/21.58 speeds.

Sources: [Player](https://minecraft.wiki/w/Player), [Transportation](https://minecraft.wiki/w/Transportation), [Attribute](https://minecraft.wiki/w/Attribute), [屬性 (defaults)](https://zh.minecraft.wiki/w/Module:Attribute_default_value_values), [Interaction range](https://minecraft.wiki/w/Interaction_range), [Daylight cycle](https://minecraft.wiki/w/Daylight_cycle), [Swimming](https://minecraft.wiki/w/Swimming), [Water](https://minecraft.wiki/w/Water), [Breaking](https://minecraft.wiki/w/Breaking), [Zombie](https://minecraft.wiki/w/Zombie), [Skeleton](https://minecraft.wiki/w/Skeleton), [Pig](https://minecraft.wiki/w/Pig), [Cow](https://minecraft.wiki/w/Cow)
