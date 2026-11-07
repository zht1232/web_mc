# work-biome — 群系颜色 / 出生点 / 三群系巡检（TASK-bugs #6）

## 1. 做了什么

| 文件 | 改动 |
|---|---|
| `src/client/renderer/BiomeColors.ts` | 重写（86→约 470 行）：修 2 个真 bug + 按原版补齐 grassland/foliage/water/dry-foliage、grass_color_modifier、5×5 blend、BlockColors 方块 tint 表 |
| `scripts/test-biomecolors.mts` | 新增：pngjs 读真实色图，对 66 群系逐条打印「我们的颜色 vs 独立按 Java 算法重算」，容差 0 |
| `src/client/world/SpawnSelector.ts` | 新增：纯函数 `findSpawnSpot` / `refineSpawnColumn` / `nearestWaterDistance` / `isTreeBlock` / `isWaterBiome` |
| `scripts/test-spawn.mts` | 新增：确定性 / 耗时 / 群系 / 离水 / 真区块落地验证（16 断言） |
| `shots/world/*.png` `shots/world/test-*.log` | 证据（截图 + 测试日志） |

## 2. A. 群系颜色：两个 bug 叠加导致「橄榄黄」

1. **色图坐标算法错**。`world/level/ColorMapColorUtil.java:4-10`：
   `rain *= temp; x=(int)((1-temp)*255); y=(int)((1-rain)*255); index=y<<8|x`
   → x 轴 = 温度（反向），y 轴 = **temp×rain**（反向）。旧代码是 `x=downfall, y=1-temp`，且漏了 `rain*=temp`。
2. **群系用数组下标查、数据是对象**：`worldgen.json.biomes` 按 key 字母序，`Object.values()` 顺序 ≠ registry id，
   旧代码 `this.biomes[biomeId]` 张冠李戴：sparse_jungle(id 45) 取到了 snowy_beach(id 15) 的温湿度。
   叠加后出生点算出 **#A7B867（橄榄黄）**；修正后 sparse_jungle = **#64C73F**（真丛林绿）。
3. 附带：`water_color/grass_color/foliage_color` 在数据里是 `"#rrggbb"` 字符串，旧代码 `c>>16` → 0，
   **水是纯黑**、badlands 草纯黑。现按 `ExtraCodecs.STRING_RGB_COLOR` 解析（水 #3F76E4）。
4. 语义细节均按源码：Java float 语义（0.6f → x=101，double 会得 102）、`biomeBlendRadius` 默认 2（Options.java:472）
   的 5×5 整数平均（ClientLevel.calculateBlockTint:1013）、dark_forest `((c&0xFEFEFE)+0x28340A)>>1` = #507A32、
   swamp 的 BIOME_INFO_NOISE 两值 #4C763C/#6A7039、spruce 叶 0xFF619961 / birch 叶 0xFF80A755 固定色。
5. `BiomeColors` 旧签名全保留（`grassColor/foliageColor/waterColor`）→ 不改 render 代码视觉即变好。

证据：`npx tsx scripts/test-biomecolors.mts` → **ALL PASS（33 条断言 / 0 FAIL）**，日志 `shots/world/test-biomecolors.log`。
锚点：plains #91BD59、forest #79C05A、jungle #59C93C、desert #BFB755、snowy_plains #80B497、taiga #86B783、
dark_forest #507A32 全部与公认值一致；`GrassColor.getDefaultColor()` = grass.png[127,127] = #7CBD6B（自证）。
色图与 `G:/ck-web26/vanilla/assets/...` MD5 一致。

## 3. B. 出生点：新算法 + node 证据

旧算法（螺旋 4 格，只判 `h>=sea+1`）→ **(228,-220) sparse_jungle**，±4 内高差 8（陡），贴水 2 格。
新算法 → **(256,-116) minecraft:plains**，`preferred=true`，噪声法离水估计 24 格，relief **0**；真区块生成后
（Game 已接线）实测 `water<=9`，列顶 grass_block、上方两格空气、非树冠，启动日志见截图运行记录。
`npx tsx scripts/test-spawn.mts` → **ALL PASS（16 条）**：同种子两次结果逐字段相同；换种子 0x0badf00d → (-52,-964) forest
仍满足「偏好群系+离水≤24+relief≤3」；耗时 warm **7.5–65 ms**（机器被 5 个并发浏览器压满时最差 65 ms），
冷启首调 ~330 ms（一次性，loading screen 内）。
接法（Lead 已接）：`const spot = findSpawnSpot(this.generator); return {x:spot.x,z:spot.z,y:spot.y}`；
`refineSpawnColumn` 在区块生成后挪开树冠；`nearestWaterDistance` 用真实方块复测离水。

**关键发现（给 worldgen 包）**：`generator.getSurfaceHeight()` 的 preliminary surface 系统性比真实地形低
6~30 格（289 列：mean +16.9 / min +6 / max +30）。所以「h<seaLevel」单独判水 169/289 假阳性；
改成「h<seaLevel **且** 群系是 ocean/river/swamp」→ 实测 **0 假阳性**（报告值是上界，保守），9 个假阴性（陆地上的池塘生成前不可知）。
原版 `NoiseChunk.computePreliminarySurfaceLevel` 在 chunk 内用**插值后**密度，我们的走未插值密度 → 建议 worldgen 核对。
`noise shot`: `shots/world/_probe-water-verify.mts`（生成 25 区块 features=false 对照真实方块）。

## 4. C. 三群系白天巡检（time=6000）

- `shots/world/plains.png`（256,-116）：草色是正确的平原绿（不再橄榄黄），水是蓝色（不再黑），
  蒲公英/虞美人/滨菊/矢车菊、草簇正常；**右下角有一个巨大的石头材质方块跟随镜头**（疑似第一人称手持模型
  位置/缩放错误，render 包）；水面/岸边有绿色 sprite（疑似 seagrass/kelp 顶面画到水面之上，render 包）；
  天空地平线偏灰白（post/fog，render 包）。
- `shots/world/forest.png` / `shots/world/birch_forest.png`：（见下）
- 每次运行控制台都有大量 `GL_INVALID_OPERATION: Two textures of different types use the same sampler location`
  与 `Mismatch between texture format and sampler type` → 采样器/纹理单元绑定冲突，render 包。

## 5. 没做 / 已知问题 / 对别人的请求

1. **LevelRenderer.tintSource()（render 包独占，我没动）**：把 x,z 传给 `grassColorAt/foliageColorAt/waterColorAt`
   才能启用 5×5 blend；同时 `level.getBiome(x, 64, z)` 的 y=64 是硬编码（原版按方块 y 取群系），且 TintSource
   本身没有 y——要 mesher 一起加，否则山上会把洞穴群系色涂到地表。
2. 叶色：`spruce_leaves`/`birch_leaves` 现在用 biome foliage，原版是固定色；render 包改用
   `biomeColors.blockTintInt(blockName, biomeId, tintIndex, x, z)` 一行即可（已实现并测试）。
3. `Game.ts`：已建议 / Lead 已加 `biomeColors.setBiomeSource((x,y,z)=>generator.getBiome(x,y,z))`（无它则 blend 退化为单群系色）。
4. `Game.spawnPlayer` 里 `nearestWaterDistance` 的 `isWater` 建议改成「取列顶方块判断液体」而不是固定 y=seaLevel
   （现在水顶在 62，固定 y=63 会漏；本次实测 water<=9 说明附近有水面在 63 的河）。
5. 抖动/时序：本机其他员工并发 5 个浏览器时，截图等待与计时波动极大；本报告的耗时区间是多次运行结果。
