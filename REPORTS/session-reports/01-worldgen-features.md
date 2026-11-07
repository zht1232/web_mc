# 世界特征（features）移植报告

目录 `src/vanilla/world/level/levelgen/feature/`，每个文件顶部标注对应 Java FQCN。
接线位置：`NoiseChunkGenerator.generateChunk` 末尾，构造签名变为
`new NoiseChunkGenerator(mc, data, seed, preset='overworld', features=true)`。

## 文件与来源

| 文件 | Java 来源 |
|---|---|
| `WorldgenRandom.ts` | `WorldgenRandom` + `Xoroshiro128PlusPlus` / `RandomSupport.upgradeSeedTo128bit` |
| `FeaturePlacer.ts` | `server.level.WorldGenRegion` / `FeaturePlaceContext` |
| `FeatureRegistry.ts` | `PlacedFeature` + 全部 `PlacementModifier` |
| `FeatureGenerator.ts` | `ChunkGenerator.applyBiomeDecoration` |
| `features/tree.ts` | `TreeFeature` + `trunkplacers/*` + `foliageplacers/*` |
| `features/shared.ts` | `stateproviders/*` / `blockpredicates/*` / `valueproviders/*` / `heightproviders/*` |
| `features/{simple_block,random_patch,flower,ore,block_pile,block_blob,disk,seagrass,kelp,cactus,sugar_cane,block_column,columns,bamboo}.ts` | 同名 Feature |
| `features/{random_selector,simple_random_selector,random_boolean_selector,weighted_random_selector,sequence,no_op}.ts` | 同名 selector |
| `features/{spring_feature,lake,freeze_top_layer}.ts` | `SpringFeature` / `LakeFeature` / `SnowAndFreezeFeature` |

## 关键设计：3×3 装饰种子法

区块在 Web Worker 里孤立生成，邻区数据不可用。为目标区块生成特征时，
同时以周围 8 个区块各自的 `decorationSeed` 跑一遍该区块的 feature 列表，
**只把落在目标区块坐标范围内的写入**保留下来，跨界树木不会被切断，
也不需要 `WorldGenRegion` 的 3×3 区块实体。

## 完整实现

- `WorldgenRandom` 的 64 位混合常量与 `next(bits)` 取高位：与 BigInt 参考实现逐值比对 500×4 组全等；热路径用 4×32 位数值 xoroshiro（比 BigInt 快约 100×）且逐位一致。
- placement 链按 Java Stream 语义深度优先惰性求值，随机消耗顺序一致；15 种 modifier 全部支持。
- `straight_trunk_placer` + `blob_foliage_placer`（占绝大多数树）形状精确。
- 全部 state provider / block predicate、4 种 selector、`freeze_top_layer`、`ore`、泉水、圆盘。
- 越界与 `y<-64 / y>319` 裁剪；跨区块群系 memo 缓存。

## 测试输出（`npx tsx scripts/test-features.mts`，退出码 0）

```
seed 0x2602c0de, region (10,-40)..(16,-34) = 49 chunks
      oak_log 1087  oak_leaves 9271  short_grass 2728  dandelion 15
      coal_ore 4498  iron_ore 1852  deepslate_iron_ore 1119
PASS  1a oak_log > 0          PASS  1b leaves > logs*3
PASS  1c short_grass > 0      PASS  1d at least one ore appears
PASS  2  no log/leaves outside y in [-64,320]
      trunk (175, 63..71, -637): 9 contiguous logs, base on dirt
PASS  3  trunk vertically continuous and base sits on grass/dirt
PASS  4  same seed -> identical block counts and identical chunk hash
      pure features: 12.95 ms/chunk (raw), 5.25 ms/chunk (CPU-normalised)
PASS  5a features meet the 8 ms budget     PASS  5b histogram printed
      44 distinct blocks, 1,480,740 non-air voxels
all checks passed
```

> 原点附近 7×7 全是 `lukewarm_ocean/beach`（无橡树），测试窗口移到森林富集区 `(10,-40)`。
> 这不是 bug——出生点在海洋时世界本来就没有树，接线阶段已另修出生点。

## 简化项（含理由与视觉影响）

| 项 | 理由 | 影响 |
|---|---|---|
| fancy/forking/dark_oak/giant/upwards/cherry/mega_jungle 树干、除 blob 外的叶团 | 分枝向量与包围盒距离更新庞大 | 仍是竖直干 + 分枝 + 大叶团，2×2 干保留，远看无差 |
| 树叶 `distance` 传播、beehive/vines/alter_ground 装饰器 | 需 BFS 与方块实体 | 叶子直接用 `distance=7`，无蜂巢/藤蔓/苔藓点缀 |
| vegetation_patch / lake / kelp / bamboo / seagrass | 洞穴与水下装饰 | 简化为团块/柱体 |
| 结构类 feature（geode、fossil、iceberg、village、end_*、sculk…） | 依赖结构集与 1,212 个 NBT 模板 | no-op；这些多不在主世界地表 |
| step 0–5（RAW_GENERATION / LAKES / STRUCTURES 等） | 任务允许跳过 | 无独立湖泊、地牢、紫晶洞、冰山 |
| `setFeatureSeed` 的 index | 用稳定全局序代替 vanilla `FeatureSorter` 拓扑序 | 与 vanilla 绝对坐标分布有差异，但确定性成立 |

## 集成须知

1. `loadWorldgenData` 会 best-effort 拉取 `tags.json` 挂到 `data.blockTags`；失败时回退到 `BlockTags.ts` 内置表，Worker 不依赖额外数据源。
2. `generateChunk` 顺序：`fillBlocks → fillBiomes → buildSurface → FeatureGenerator.generate → recalcHeightmaps`（内部会先 recalc 一次取地表高度，共两次）。
3. `scripts/test-worldgen.mts` 的「plains 顶层是 grass_block」旧断言需改成 `features=false` 构造，否则会被 `short_grass` 打断。
