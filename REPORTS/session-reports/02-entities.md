# 实体与生物系统移植报告

59 个新文件 / 4,571 行：`src/vanilla/world/entity/**`（49）+
`src/client/renderer/entity/**`（9）+ `scripts/test-entities.mts`。
未改动 `player/Player.ts`。

## 移植的 Java 类

`Entity`, `LivingEntity`, `Mob`, `EntityDimensions`, `EntityType`（158 类型注册表，
由 `data/entities.json` 生成）, `EquipmentSlot`, `MobCategory`, `SpawnPlacements`,
`ExperienceOrb`, `ItemEntity`, `Arrow`, 16 个 `Goal` + `WrappedGoal`,
`PathNavigation` / `GroundPathNavigation` / `NodeEvaluator` / `WalkNodeEvaluator` /
`PathFinder`（A*）, `Monster` / `Animal` 基类与 14 种生物类，
以及 `client/renderer/entity/*Renderer`、`client/model/geom/*` 的 box 定义。

## 生物与 AI

- **14 种可生成生物**：僵尸、骷髅、苦力怕、蜘蛛、末影人、蠹虫 / 猪、牛、羊、鸡、狼、兔 / 蝙蝠。
- `GoalSelector` 用 flag 位掩码做 O(n) 优先级调度（含控制标志互斥）。
- A*：`Int32Array` 二叉开放堆 + 定长节点池 + 开放寻址哈希，全部预分配，`findPath` 零对象分配；8 邻域、1 格台阶、最多 3 格下落。
- 确定性：随机来自 `XoroshiroRandomSource`（每实体 `seed ^ id`），零 `Math.random`。
- `EntityManager`：区块加载/卸载剔除、20Hz tick、距离剔除、按 `worldgen.json` 的 spawners 与 `creatureSpawnProbability` 自然生成、昼夜光照决定怪物生成。

## 数据驱动模型

`ModelBox.ts` 把 `CubeListBuilder.addBox` / `PartPose` 转成 `BoxDef` + `PartDef` 数据；
`bakeModel()` 在模块加载时一次性：按 pose 组合 4×4 矩阵 → 烘焙 vanilla 根变换
（`scale(-1,-1,1)` + `translate(0,-1.501,0)` + `/16`）→ 按 `ModelPart.Cube` 的 6 面 UV 生成顶点。
共 **14 模型 / 98 part / 3,816 顶点**；`Quadruped/Pig/Cow/Sheep/Chicken/Zombie/Skeleton/Creeper`
忠实转录自 Java，其余 6 种为区分度较高的近似。

渲染按贴图分桶（≤14 次 draw call），拼成单个 `Float32Array` 一次上传到一个动态 VBO，
几何只构建一次，内循环零分配。

## 测试输出（`npx tsx scripts/test-entities.mts`）

```
PASS  [extra] 14 data-driven models baked  parts=98 vertices=3816
PASS  1. all entities stay above ground & inside world (200 ticks, 15 entities)
PASS  2. zombie moves toward player  start=8.00 end=1.55 maxIncrease=0.000
PASS  3. pig random-walks  maxDisplacement=3.35
PASS  4. dropped items land, come to rest and are pickable  atRest=10/10 picked=10
PASS  5. 200 ticks < 50 ms   cold=35.50 ms warm=13.76 ms (0.0688 ms/tick)
PASS  6. same seed produces identical results  checksums=200 finalFields=135
ALL CHECKS PASSED  EXIT=0
```

## 集成接口

```ts
const manager = new EntityManager(level, player, seed, { despawnDistance: 128 });
void manager.loadSpawnConfig('/mc');
manager.tick();                       // 每 20Hz tick
manager.pickupItems(px, py, pz, 1.5);
manager.spawn('zombie', x, y, z);
manager.syncChunks(chunks);           // Iterable<readonly [cx, cz]>

const dispatcher = new EntityRenderDispatcher(gl);
await dispatcher.init('/mc/textures/entity');
dispatcher.render(manager.getEntities(), renderer.viewProjection, camera, partialTick);
```

## 未实现 / 简化

- 玩家用 `PlayerTarget` 代理，AI 侧不模拟物理。
- 掉落物用 1×1 白贴图 + id 哈希着色立方体（保持单 draw call）。
- 实体 pass 未接 lightmap / 雾 / 每实体动态亮度，仅烘焙方向面阴影；无背面剔除。
- `mirror` 仅做 x 交换；Wolf/Rabbit/Bat/Silverfish 为近似 box；无头/四肢俯仰动画（仅 yaw + 摆动）。
- 苦力怕爆炸为固定半径伤害且不破坏方块；箭命中实体不做伤害；状态效果只维护时长；装备仅简单护甲值。
- 繁殖/诱惑不生成幼体 / 省略手持物品判定。
- 158 种里只有 14 种有工厂，其余保留精确维度与分类元数据。

## 接线阶段发现

自然刷怪在浏览器里长期为 0：158 条 `ENTITY_TYPES` 只有 15 条有 factory，
jungle 的 spawner 表大量指向未实现生物（`noType:616`）；另一半是 `checkSpawnRules`
失败（`rulesFail:400`），因为 `getHeight` 返回 `short_grass`/`fern` 顶部，
生物被要求站在植物顶上。手工 `spawn()` 正常。此项列为待办。
