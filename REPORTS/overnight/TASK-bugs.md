# TASK bugs — 交互缺陷 + 世界观感

先读 `REPORTS/OVERNIGHT-BRIEF.md`、`session-reports/08-regression.md`、`07-integration.md`。每项：先复现 → 定位 → 修 → 给证据。

1. **放置成功率只有 3/10**（08 #3）：`Game.useItem()/stateForPlacement()`。写脚本场景 N 次放置各类方块（含朝向方块：楼梯 facing+half、台阶 type、原木 axis、栅栏/玻璃板连接、门、火把、床…），断言 100% 成功；朝向规则照 `Block.getStateForPlacement`/`BlockItem.getPlacementState`。放不下的（目标格被占/实体挡住）要有原版一致的判据。
2. **远处区块不卸载**（08 #2）：teleportFar 后 chunks 573 > 289。实现原版 `ClientChunkCache` 式卸载（超出 renderDistance+某滞回距离的区块从 `level.chunks` 移除，同时 `LevelRenderer.prune`、`entityManager.unloadChunk`；有改动的区块先 flush 保存；避免来回抖动）。在 `Game.ts` 的 `ensureChunksAround`/`tick` 里做，`ClientLevel.ts` 里加移除方法。验收：传送到 1000 格外再回来，chunk 数稳定在满视野附近，内存不持续增长，存档改动不丢。
3. **冒烟 `17-save` pageerror**：`flushDirty(level, player, budgetMs)` 的调用问题（脚本侧）。修 `scripts/smoke.mjs`，目标 19 场景全 PASS（跑一次完整冒烟放在最后，重，别提前跑）。
4. **扁平物品图标空白**（08 #7）：`gui/ItemIconAtlas.ts` 对 `items/*.json` 里 `generated`/`minecraft:model` 的 flat 物品，用 `textures/item/<name>.png` 绘制；铁镐、食物、种子、工具都要有图标。快捷栏第 9 格是水（不是物品）：改成合理默认。
5. **`scripts/test-worldgen.mts` 两条过时断言**（08 #9）：按 08 报告的建议修（构造时显式传 `features=false`；CPU 预算按本机标定或放宽）。
6. **世界观感**：
   - 出生点在 sparse_jungle，草色发“橄榄黄”。核对 `renderer/BiomeColors.ts` 与原版 `GrassColor/FoliageColor`、`colormap/grass.png|foliage.png`（温度/降水 → 色图坐标）、`biomeBlendRadius=2` 的 5×5 混合；水色（群系 `water_color`）；橡木叶用 foliage 色图，桦木/云杉叶固定色。逐群系打印我们的颜色与按 Java 算法算出的值，必须一致（写成 `scripts/test-biomecolors.mts`）。
   - 把出生点改到更适合出片的地方：优先 plains / forest / birch_forest，24 格内有水，不在树冠里；保持 `findSpawnSpot` 的快速（~100ms）和确定性（同种子同结果）。
   - 视觉巡检：3 个不同群系各拍一张白天图到 `shots/world/`，Read 后列出明显错误（叶子渲染、草/花的 XZ 随机偏移 `OffsetType`、半透明水面排序、植物朝向、方块面剔除等），修掉其中**源码依据明确**的。

## 文件所有权
`Game.ts` 里交互/区块加载/出生点相关函数（`useItem`、`stateForPlacement`、`ensureChunksAround`、`findSpawnSpot`、`findStandingY`…；Edit 小改，改前重读）、`renderer/BiomeColors.ts`、`gui/ItemIconAtlas.ts`、`scripts/smoke.mjs`、`scripts/test-worldgen.mts`、新增 `scripts/test-biomecolors.mts`、`ClientLevel.ts` 里区块卸载相关方法（天气部分属 survival 包，别动）。

## 交付
`REPORTS/overnight/bugs.md`。第一版 05:30 前。
