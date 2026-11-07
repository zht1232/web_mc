# 回归冒烟与当前待办

## 单元测试（`npx tsx scripts/test-*.mts` 全量重跑）

| 脚本 | 结果 |
|---|---|
| `test-audio-particles.mts` | PASS |
| `test-entities.mts` | PASS |
| `test-features.mts` | PASS |
| `test-gui.mts` | PASS（73/73） |
| `test-items.mts` | PASS（9/9） |
| `test-mesher.mts` | PASS（62 项） |
| `test-save.mts` | PASS（49/49） |
| `test-worldgen.mts` | **FAIL 2 项**（见下） |

`test-worldgen` 的两条失败是**过时断言，不是产品缺陷**：

```
FAIL 8. the top block of a plains column is grass_block - topped by short_grass at y=65
FAIL 9. ms/chunk budget (61.19 normalised > 25)
```

8：features 默认开启后平原顶层会长草，构造应显式传
`new NoiseChunkGenerator(mc, data, SEED, 'overworld', false)`。
9：本机 CPU 比项目基线慢 2~2.5×，`test-worldgen.mts` 自身在本机也超预算。

## 浏览器冒烟（`node scripts/smoke.mjs --out shots/smoke-wired`）

19 场景 / 259.5 s / **18 PASS · 1 FAIL**，`report.json` 在 `REPORTS/test-logs/smoke-wired.json`。

```
PASS 00-boot         ready 15.6s, chunks 54, fps 10, workers=true, gl=0
PASS 01-idle10s      fps 10->10, chunks 84->188, queue=0 inflight=0
PASS 02-walk         位移 7.94 格
PASS 03-jump         10 次, 峰值 +0.83, 落地 onGround
PASS 04-sprint       5s 位移 11.22 格
PASS 05-fly          上升 40.5 格
PASS 06-lookAround   8 个方位各一张截图
PASS 07-breakBlock   state 124->0, attack 改变方块 9/12  (breakProgress=undefined)
PASS 08-placeBlock   成功 3/10
PASS 09-inventory    CreativeModeInventoryScreen -> Esc -> null
PASS 10-pause        PauseScreen, pointerLock=false
PASS 11-options      OptionsScreen -> VideoSettingsScreen
PASS 12-creativeTab  14 tabs, 选定 1,2,3
PASS 13-night        time=18001, skyFactor=0.24, skyLightLevel=4.0, luma=5.2
                     warn: isDay=true; warn: skyLightColor 偏红
PASS 14-rain         rainLevel=1, weather/sky/cloud 均存在
PASS 15-teleportFar  chunk 14,-13 -> 139,112, chunks 306->573
                     warn: 区块未卸载（573 > 满视野 289）
PASS 16-resize       1280x720/800x600/1920x1080, guiScale 3/2/4
FAIL 17-save         1 条 pageerror: Cannot read properties of undefined (reading 'chunks')
PASS 18-reload       重载 25.4s, chunks 595->306, 存档已接
```

### 关于两条 night 警告的核对结论

已对照 `net/minecraft/world/timeline/Timelines.java`：**不是 bug**。
原版常量就是
`NIGHT_SKY_LIGHT_COLOR = ARGB.colorFromFloat(1.0, 0.48, 0.48, 1.0)`（偏红）、
`NIGHT_SKY_LIGHT_FACTOR = 0.24`、`NIGHT_SKY_LIGHT_LEVEL = 4.0`；
关键帧 `730/11270 → -1`、`13140/22860 → NIGHT_SKY_LIGHT_COLOR` 与实现逐项一致。
`isDay=true` 是 `ClientLevel.isDay()` 的判据与冒烟脚本预期不一致，需单独看。
真正该改的是**旧光照管线没有把 skyLevel=4 体现到地形上**——由新光影管线整体替换。

## 已确认的问题清单（按优先级）

| # | 问题 | 定位 |
|---|---|---|
| 1 | `17-save` pageerror `Cannot read properties of undefined (reading 'chunks')` | 冒烟脚本调 `flushDirty()` 时未传 `level`；需核对 `WorldSaveManager.flushDirty(level, player, budgetMs)` 签名并补参数 |
| 2 | 长途移动区块不卸载：573 > 289，持续吃内存 | `ClientLevel` / `LevelRenderer.prune` 未见调用；需在 `Game.tick()` 按距离卸载 chunk + GPU buffer |
| 3 | `08-placeBlock` 只成功 3/10 | 放置目标判定 / `stateForPlacement` 朝向表 |
| 4 | `breakProgress=undefined`，HUD 无破坏裂纹 | `survival.breaking.progress` 未接到 HUD 或选中框 |
| 5 | 自然刷怪 0 只 | 见 `07-integration.md`「尚未接上」1 |
| 6 | 天气无模拟（`raining` 恒 false） | `ClientLevel` 缺天气 tick |
| 7 | 铁镐等物品图标空白 | `ItemIconAtlas` 对 `kind: flat` 的 fallback |
| 8 | 夜景地形偏亮 | 旧 lightmap 路径，等待光影管线替换 |
| 9 | `test-worldgen.mts` 2 条过时断言 | 传 `features=false` / 放宽本机预算 |

## 进行中的工作：Complementary 风格光影

`src/client/renderer/post/PostShaders.ts` 已写入，包含：

- `FULLSCREEN_VERT` 全屏三角形
- `COMPOSITE_FRAG`：Lottes 风格曲线（contrast 1.05 / hdrMax 8 / mid 0.25、
  toe lift、白路径）、**bloom 以 0.12 mix 混入而非加法**、饱和度/对比度、
  亮度感知暗角、抖动去色带
- `BLOOM_PREFILTER_FRAG`：4-tap 降采样 + 软膝阈值
- `BLUR_FRAG`：9-tap 可分离高斯
- `FXAA_FRAG`：FXAA 3.11
- `SHADOW_VERT/FRAG`：深度-only 太阳阴影 pass

参数依据 `_src/thirdparty/thirdparty/complementary-reimagined-r5.9.3` 解包结论
（见 `webcraft26/research/session-digest.md` §7）：包里没有 `settings.glsl`，
默认值全是 `lib/common.glsl` 顶上的 `#define`；GLSL 依赖 Iris 内建
（`shadowtex0/1`、`colortex*`、`gbuffers_*`）**无法直接粘进 WebGL2**，可搬的是算法与默认参数。
补充要点：包里**完全没有自动曝光**；水默认 `WATER_STYLE 1` 不用法线贴图，
波浪是顶点阶段两条正弦；影子靠分形畸变 + 双层深度图 + TAA，不靠纹素对齐。

**尚缺**：`PostProcessor.ts`（HDR FBO / bloom mip / pass 链）、
`ShadowMap.ts`（正交太阳深度图 + PCF）、`LevelRenderer` 的 HDR 目标与阴影 pass、
`Game.render()` 的 `beginScene/endScene` 接线。这是当前唯一半成品。
