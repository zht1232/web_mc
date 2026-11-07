# TASK survival — 生存循环 / 生物 / 天气模拟

先读 `REPORTS/OVERNIGHT-BRIEF.md`、`session-reports/02-entities.md`、`04-items-survival.md`、`07-integration.md`（“尚未接上”一节）、`08-regression.md`。

## 任务
1. **自然刷怪=0**（07-integration「尚未接上」1，02-entities 末尾）。根因两处：
   (a) 群系 spawner 表指向大量未实现生物（`noType:616`）→ 为表里出现的、主世界常见生物补可用 factory（至少：僵尸、骷髅、苦力怕、蜘蛛、末影人、猪、牛、羊、鸡、蝙蝠、史莱姆、女巫、溺尸；鱿鱼/鳕鱼/鲑鱼、狼、狐狸、兔子若易做也做，鹦鹉/猫放最后），其余类型在刷怪表里**直接跳过**而不是计数失败。
   (b) `checkSpawnRules` 用的 `getHeight` 返回植物顶：改为站在实体地面上，参考 `net/minecraft/world/entity/SpawnPlacements.java`、`world/level/NaturalSpawner.java`（刷怪圈 24–128 格、光照上限、群体生成、周期 `spawnInterval`、按 `MobCategory` 的上限）。
   验收：出生点 120 秒（可循环调用 tick 加速）内，白天有动物、夜晚有怪；数量不超上限；单 tick < 5 ms。
2. **伤害与死亡**：`SurvivalState.damage()` 目前没人调用。接上：摔落（`LivingEntity.causeFallDamage`：distance−3 向上取整）、溺水（空气 300→0 后每秒 2 点；新增 `airSupply` 0..300）、僵尸/骷髅/苦力怕/蜘蛛对玩家近战与远程伤害（normal 难度）、岩浆/火、饥饿；击退与受击红闪（`hurtTime`）；死亡 → `screens.open('death')`；重生（`callbacks.onRespawn`：回出生点、清状态、掉落物品与经验）。创造模式不受伤害。`SurvivalState` 新增 `airSupply`、`armorValue`（hud 包会读，名字别改）。
3. **敌对生物白天燃烧**（僵尸/骷髅）；怪物生成的光照/时间规则按源码；苦力怕爆炸（伤害 + 破坏方块 + 掉落，若来得及）。
4. **天气模拟**（08-regression #6）：实现原版 `ServerLevel.advanceWeatherCycle` 的晴/雨/雷状态机（`clearWeatherTime/rainTime/thunderTime` 的随机区间、`rainLevel/thunderLevel` 每 tick ±0.01 平滑），`getRainLevel()/getThunderLevel()` 对外暴露；`Game.setRain()` 保留作手动覆盖；`level.dat` 的 `Raining/RainTime/Thundering/ThunderTime` 读写接到存档（`WorldSaveManager`/`PlayerData` 已有字段，核对）。
5. 单测：扩充 `scripts/test-entities.mts`、新增 `scripts/test-survival.mts`，**纯数据可跑，不依赖浏览器**。浏览器只在最后实测一次“摔落扣血 + 夜晚刷怪”。

## 文件所有权
`src/vanilla/world/entity/**`、`src/vanilla/gameplay/SurvivalState.ts`、`src/vanilla/world/level/ClientLevel.ts`（天气相关；区块卸载相关方法属 bugs 包，别动）、`scripts/test-entities.mts`、`scripts/test-survival.mts`、`Game.ts` 的 `tick()` 中与伤害/天气/死亡相关的小块（Edit 小改，改前重读）。

## 交付
`REPORTS/overnight/survival.md`。第一版 05:30 前。
