# survival — 自然刷怪 / 伤害与死亡 / 天气模拟

## 1. 做了什么（文件 + 一句话）

- `src/vanilla/world/entity/SpawnPlacements.ts`（重写）：按 26.2 `SpawnPlacements`/`SpawnPlacementTypes` 实现 ON_GROUND（下方 faceSturdy、上下空块）、IN_WATER、`Monster.isDarkEnoughToSpawn`（overworld：光照 0..7、方块光上限 0）、`Animal.checkAnimalSpawnRules`（亮度>8 + `animals_spawnable_on` 标签）、bat/drowned/water_animal/slime 规则；未实现类型在刷怪表里**直接跳过**。
- `src/vanilla/world/entity/EntityManager.ts`（重写刷怪）：照 `NaturalSpawner.spawnForChunk` —— 随机列 + 全列随机 y、最近玩家 24 格下限、128 格上限、3 组群体生成（每组 ≤4）、每类全局上限 `cap*chunks/289` + 每玩家本地上限（LocalMobCapCalculator）、persistent 类每 400 tick；新增 `spawnMobsForChunkGeneration`（chunk 首次加载生成动物）、`spawnStats{chunkAttempts,spawned,noType,skippedEntries,rulesFail}`、`playerHurt`/`explosion` 钩子、`setPlayer()`（重生后重绑代理）。
- `src/vanilla/world/entity/EntityFactory.ts` + 新类：drowned/husk/zombie_villager/stray/bogged/cave_spider/slime/witch/squid/glow_squid/cod/salmon/fox/cat/ocelot/parrot（21 种可刷怪）；Zombie/Skeleton 构造函数支持变体 type。
- `src/vanilla/gameplay/SurvivalState.ts`：`airSupply`(300→-20 后每 20 tick 2 伤)、`armorValue`/`armorToughness`、`hurtTime`/`invulnerableTime`、`fallDamage`、`tickEnvironment`（岩浆 4/10t、火 1/20t）、`dropAllOnDeath`/`respawn`、创造免伤、`bypasses_armor` 标签（fall/drown/starve/on_fire 不吃护甲）、死亡后停止自然回血。
- 伤害链：`PlayerTarget.onHurt`→Game→SurvivalState（僵尸/蜘蛛近战、骷髅箭、女巫 bolt、箭命中玩家）；`Creeper.explode`→`EntityManager.explosionHandler`→`Game.explode`（玩家伤害 + 破坏方块 + 掉落物）。
- `Mob.ts`：`burn_in_daylight` 白天燃烧（`isSunBurnTick` 逐项照源码）；`LivingEntity.ts`：火/岩浆伤害 + `walkAnimSpeed/Pos`（mobs 包需要）。
- `ClientLevel.ts`：`ServerLevel.advanceWeatherCycle` 完整状态机（RAIN/THUNDER DELAY/DURATION 常量、clearWeatherTime、rainLevel/thunderLevel ±0.01、get/setWeatherState、forceWeather）；**修正 `getTimeOfDay` 相位**（原公式整体偏 0.5：正午天黑、午夜天亮，直接导致夜里刷不出怪）与 `isDay`。
- 存档：`WorldSaveManager.saveLevelData` 写 `Raining/RainTime/Thundering/ThunderTime`，`Game.restoreWorld` 读回；`Game.setRain()` 保留为 `setRainOverride` 手动覆盖。
- `Game.ts` 小改：摔落伤害、岩浆/火、死亡屏/重生（`onRespawn`→`respawnPlayer`）、受击击退、`HUD air:airSupply`、`setSpawnBlockTags(worldData.tags)`。
- 测试：`scripts/test-survival.mts`（新，13 项）；`scripts/test-entities.mts` 扩充 7–10（工厂齐全、白天有动物无怪、夜里有怪且不超上限、刷怪 <5 ms/tick）。

## 2. 证据（本机亲自跑）

- `npx tsc --noEmit` → **0 错误**。
- `npx tsx scripts/test-survival.mts` → **ALL CHECKS PASSED**（13/13，空载 1.9 s、满载 6~60 s）。
- `npx tsx scripts/test-entities.mts` → 7/8/9/10 PASS：
  - 8 白天 2400t：`creatures=13 monsters=0 chunkGen=63`
  - 9 夜晚 2400t：`monsters=6 cap=6 skippedEntries=28`（僵尸4/骷髅1/苦力怕1）
  - 10：`1.14 ms/tick`（2400t，19200 chunk attempts）< 5 ms
  - 5（旧性能断言）FAIL：`worst=108.9 ms cold / 34.9 ms warm（0.17~0.54 ms/tick，随负载波动）`；同时刻 CPU 100%（其他包 headless 浏览器 + 参考客户端），08-regression 已记录本机比基线慢 2~2.5×，与本次改动无因果（见已知问题 8）。
- `test-chunkunload` 全 PASS；`test-items` 9/9；`test-save` 49/49 一次通过（另一次 6.1 序列化 4.5 ms 性能断言抖动 FAIL，CPU 满载，代码未动）。
- 浏览器（headless，`?workers=2`，`shots/survival/browser-night2.png`）：
  - 摔落：hp 20→13（12 格摔落，`hurtTime=9`）
  - 夜 t=18000：`isDay=false`，12 s 内 `monsters=15`（creeper6/zombie4/spider4/skeleton1），最近怪 0.82 格；`animals=4`；`chunks=137`
  - 死亡→`DeathScreen`（health 0）→重生 `health=20 air=300 screen=null`
  - 天气：forceWeather 后 `thunderLevel 0→0.56`（状态机在跑）
  - 截图所见：深蓝近黑的夜、星空、红心/饥饿 HUD；实体处于暗部（实体光照未接，见 3.1）。

## 3. 没做 / 已知问题

1. 新实体（drowned/witch/slime/husk/stray/fox/cat/parrot/鱼…）**无 render 条目 → 不可见**：`src/client/renderer/entity/**` 属 mobs 包独占，需其加 `MODEL_REGISTRY`（贴图已有：zombie/drowned、slime/slime、witch/witch、squid/*、fish/*、fox/*、parrot/*）。夜里可见怪仍是 zombie/skeleton/creeper/spider/enderman。
2. 玩家受击红闪只有 `SurvivalState.hurtTime` 数据，第一人称红屏/伤害倾斜需 render/hud 包接。
3. 箭只对玩家判命中，不对生物；爆炸不推动实体、不产生经验。
4. 简化：女巫用 Arrow 当 bolt（无药水实体）、slime 简化跳跃且无分裂、drowned 无三叉戟、僵尸无装备/头盔防晒、无 mob 掉落物/经验。
5. 天气未接闪电与雨声（render/audio 包），`level.getRainLevel()/getThunderLevel()/isRaining()` 已可供其读取。
6. 摔落公式按 26.2 源码 `floor(distance+1e-6-3)`（不是任务书的 ceil）；浏览器 12 格实测掉 7 血（落点前有树冠/多计），公式本身在单测逐值核对。
7. 未做：玩家 `Air` 存盘（PlayerData 固定写 300）、死亡分数精确原版值。
8. `test-entities` 第 5 条（200t<50ms）在满载时 FAIL；空载实测 0.07 ms/tick（基线）→ 0.28 ms/tick。`test-save` 6.1 同类性能抖动。

## 4. 对其他包的改动 / 依赖

- **改共享文件（均 Edit 小改）**：`src/client/Game.ts`（tick 内伤害/天气/死亡小块 + import）、`src/client/world/level/ClientLevel.ts`（weather + getTimeOfDay/isDay 修正，未动 bugs 包的 chunk unload 方法）、`src/client/world/save/WorldSaveManager.ts`（level.dat 天气字段，带 test-double 兼容）。Game.ts 同期被 bugs/hud/ref 包改动，已合并且 tsc 0 错误。
- **给 mobs 包**：`LivingEntity.walkAnimSpeed/walkAnimSpeedOld/walkAnimPos`、`hurtTime/deathTime` 已存在；缺的渲染工作见 3.1/3.2。
- **给 hud 包**：`SurvivalState.airSupply/maxAirSupply/armorValue/hurtTime` 已按 BRIEF 命名提供；`Game.renderHud` 已传 `air: airSupply`。
- **给 light/sky/render 包**：`ClientLevel.getTimeOfDay()` 相位改为旧版 vanilla 语义（0=正午、0.5=午夜），`getSkyDarken()` 夜晚 0.2、白天 1.0（`level.getBrightness()` 夜晚 2~3、白天 15）。若渲染用 `EnvCommon.timeOfDayOf(level)` 请复核（当前无调用点）。
