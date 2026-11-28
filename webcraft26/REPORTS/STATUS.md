# 项目状态索引（2026-11-28）

这份文件是**唯一的当前状态入口**：先看这里，再按需翻 `REPORTS/HANDOFF*.md` 的历史交接记录。
历史交接里已经过时的数字（世界大小、已修 bug、测试数量）不要当现状。

## 1. 技术路线（已定）

- 客户端保持 **TypeScript + WebGL2 + Canvas2D GUI**，不换 Rust/WASM 引擎。
- `horizon`（Horizon，Rust，LGPL-3.0）是**行为与内容参考**：
  - 可以照抄/移植：GUI 布局与点击规则、物品栏/容器逻辑、光照曲线、实体模型层级与动画、音效事件表。
  - 不移植：WGSL 渲染管线、winit/wgpu 窗口层、Rust 数据结构。
- 原版 26.2 资源（模型/贴图/语言/音效）仍是最终像素与文案的真值：`thirdparty/src-vanilla/assets/minecraft`
  与 `public/mc/**`。

## 2. 代码地图

| 路径 | 职责 | 备注 |
|---|---|---|
| `src/client/Game.ts` | 启动、世界生命周期、输入、渲染循环、菜单接线 | 单文件较大，改前先搜调用点 |
| `src/client/gui/` | 原版 GUI 移植：ScreenManager、Title/SelectWorld/CreateWorld/Options、HUD、物品栏/容器、配方书 | GUI 是 Canvas2D，与 3D 分离 |
| `src/client/renderer/` | WebGL2：区块网格、实体、天空/云/天气、阴影、后处理、第一人称手 | |
| `src/client/renderer/entity/` | 实体批渲染 + 模型/动画（`model/EntityModels.ts`） | 羊毛/弓等层级模型都在这里 |
| `src/client/world/` | 区块流式加载、出生点、IndexedDB 存档、区块 worker | |
| `src/vanilla/` | 26.2 类库的 TS 移植（实体/AI/物品/容器/worldgen/光照/NBT） | 尽量保持 Java 类名与方法名 |
| `scripts/` | `build-*` 资源导入；`test-*` 单测；`smoke/shot/probe-*` 浏览器验证 | |
| `public/mc/` | 官方资源（模型、贴图、语言、音效、字体） | 仅本机私人使用 |
| `bridge/` | Paper WebSocket 插件与协议 | 历史资产，浏览器端未接 |

### 架构图

```text
Game.ts  (rAF 循环 / 输入 / 世界生命周期 / 菜单接线)
 ├─ gui/        Canvas2D：ScreenManager → Screens → GuiGraphics / Hud / ItemIconAtlas
 ├─ renderer/   WebGL2：LevelRenderer → SectionMesher / EntityRenderDispatcher
 │                     ├─ environment/ 天空、云、天气、雾
 │                     ├─ post/        HDR、Bloom、SSAO、TAA、阴影贴图
 │                     └─ hand/       第一人称手臂 / 手持物
 ├─ world/      ChunkProvider（worker 流式生成）/ 存档（IndexedDB + .mca）
 └─ vanilla/    26.2 模拟层：levelgen、实体 AI、物品/容器、LightEngine、NBT
```

`Game.ts` 只做编排；GUI 与 3D 通过 `ScreenDeps` / `window.__mc` 注入，不互相 import。

## 3. 验证入口

```bash
npx tsc --noEmit                              # 类型检查（本轮 0 error）
npx tsx scripts/test-mobs-render.mts          # 实体渲染 20 项
node scripts/test-containers.mjs              # 容器交互 19 项
node scripts/test-menu.mjs                    # 主菜单/世界选择 9 项
node scripts/test-hud-dirty.mjs               # HUD 脏标记 / 菜单隐藏 5 项
node scripts/test-advancements.mjs            # 进度：roots/可见数/触发器/界面/存档 7 项
node scripts/test-villager-trade.mjs          # 村民：职业/报价/交易/等级/补货/存档 14 项
node scripts/test-minecart.mjs                # 矿车：轨道/弯道/坡道/动力轨/检测轨/乘坐/箱子 11 项
node scripts/test-boat.mjs                    # 船/筏：浮力/划桨/转向/摩擦/放置/乘坐/箱船/掉落/像素差分 16 项
node scripts/test-entity-save.mjs             # 区块实体存档：野生生物/矿车/船/掉落物/经验球 保存+重载 11 项
node scripts/test-item-entity.mjs             # 掉落物：3D 方块模型/地面展示变换/5 份堆叠/床 composite 13 项
node scripts/test-hand-reference.mjs          # 第一人称手持石头 vs 原版参考图剪影比对 4 项
node scripts/test-golem-villager.mjs          # 铁傀儡 + 村民繁殖：图案生成/裂纹/治疗/战斗/食物拾取/宝宝 22 项
node scripts/test-village-life.mjs            # 村民农业：食物分享/收割补种/面包烘焙/存档 8 项
node scripts/test-villager-sleep.mjs          # 村民睡眠/昼夜作息 + 村庄铁傀儡生成 13 项
node scripts/test-village-schedule.mjs        # 村民日程：工作站点聚集/钟声会议/农民工作时段 9 项
node scripts/test-wandering-trader.mjs        # 流浪商人：生成周期/9 条报价/交易界面/羊驼跟随与消失 15 项
node scripts/test-tipped-arrow.mjs            # 药箭：imbue 合成/弓发射/1/8 时长药效/制箭师随机药箭交易 10 项
node scripts/test-fps-limit.mjs               # 帧率上限：30/120/240 档实测渲染帧率 + tick 不降频 7 项
node scripts/test-advancements-tree.mjs       # 进度树：五根标签顺序/tree 布局/拖动与滚轮平移 8 项
node scripts/test-review-fixes.mjs            # 审阅修复：亡灵燃烧/植物支撑/创造目标/存档槽位与快照 9 项
node scripts/test-video-toggles.mjs           # TAA/动态分辨率/植被摆动开关并即时生效 3 项
node scripts/test-mob-equipment.mjs           # 怪物装备与稀有掉落：护甲分布/武器/骷髅头/铜锭 13 项
node scripts/test-explosion.mjs               # 爆炸：射线弹坑/抗性/掉落衰减/TNT 归属/遮挡暴露 10 项
node scripts/test-icons.mjs                   # 物品图标
node scripts/test-taa.mjs                     # TAA
npx tsx scripts/test-mesher.mts               # 区块网格 64 项
npx tsx scripts/_test-runjump.mts             # 跑跳物理
node scripts/smoke.mjs                        # 19 场景浏览器冒烟
node scripts/shot-mobs.mjs                    # 生物截图（day/night/hurt/death/shadow）
```

实机调试：`window.__mc` 是 `Game` 实例；`?perf=0` 关性能采样，`?perf=20` 开面板。

## 4. 功能状态

图例：✅ 可用且接近原版；⚠️ 已实现但质量/覆盖不足；❌ 没做或只有占位。

### 渲染 / 光影 / 环境
| 项 | 状态 | 说明 |
|---|---|---|
| 天光/方块光 + 平滑光照 + AO | ✅ | `LightEngine` + `SectionMesher` 按原版 `smoothBlend`/AO 移植 |
| 26.2 光照曲线 / 昼夜 timeline / 雾 | ✅ | `EnvironmentLighting.ts` 逐 keyframe 移植，参考图对照过 |
| 太阳阴影（PCF）| ✅ | 5x5 PCF，近/远级联；阴影贴图分辨率 1024–4096；阴影改为衰减直接光，不再叠加第二太阳 |
| HDR/Bloom/SSAO/TAA/FXAA | ✅ | high/ultra 档；F6 总开关 |
| 水面 | ✅ | 2026-11-28：按 Complementary Reimagined r5.9.3 源码移植——30 步 SSR（6 次细化、边界/亮度衰减）、GetSky 天空反射（三段渐变+日落带+太阳眩光）、GGX 高光、深度差水雾与 Fresnel⁴ alpha；默认档平面镜面水。未含折射/焦散与云/星空反射 |
| 体积光（god rays） | ✅ | 2026-11-28：按 `lib/atmospherics/volumetricLight/volumetricLight.glsl` 移植——半分辨率 10 near + 1 far 采样、fogCurve 0.9/distribution 2.0、双级联阴影遮蔽、COMPOSITE1 的 lightColor 与 Step1/Step5 系数；medium/high/ultra 启用，`test-volumetric-light` 6/6 |
| 体积云 | ✅ | 2026-11-28：按 `lib/atmospherics/clouds/reimaginedClouds.glsl`（CLOUD_STYLE 1 / CLOUD_QUALITY 2）移植——192±4.2 云层 slab 半分辨率射线行进（最多 48 步）、GetRoundedCloudCoord 等值面、双采样朝阳着色、地形深度遮挡与级联阴影；覆盖率噪声场由 256² 可平铺 fBm 按 pack 纹理的 24% 二值分布生成（`TextureManager.cloudNoise`）。shader 云启用时跳过原版 26.2 体素云层，`test-volumetric-clouds` 5/5 |
| 第一人称手/手持物 | ⚠️ | display transform 已按 JSON 移植；物品略偏大/贴边，待逐项对参考图 |
| 粒子 | ⚠️ | 方块破碎/环境粒子已有；粒子表覆盖不完整。2026-11-28：方块破碎粒子按 `BlockTintSource.colorAsTerrainParticle` 上色——草/蕨/树叶用群系草色/叶色，草方块明确不上色（dirt 贴图），红石线按 power 上色；`test-player-motion` 实测草粒子 (0.33,0.79,0.25) |
| 菜单/设置页帧率 | ✅ | 2026-11-21 修：菜单打开时不再绘制被立即擦掉的 HUD；菜单泥土背景改为一次缓存 + 单次 `drawImage`；HUD 改为脏标记重绘。1600x900@1.5 下暂停页 10→56 fps、视频设置 12→60 fps，`screens` 59.5→1.0 ms/帧 |
| HUD 空转重绘 | ✅ | 同一份 HudState 不再每帧重画；静止时 0 次 `hud.render`（`test-hud-dirty`）。聊天/Toast/受伤/切槽/缩放会立即触发一次 |
| 物品图标降级路径 | ✅ | `createImageBitmap` 不可用时不再从 3200² 图集直接 `drawImage`（真实环境曾 90 ms/9 个图标），改为按物品缓存小画布 |
| 帧率上限 | ✅ | 2026-11-28：视频设置「最大帧率」此前是死 UI（一直按刷新率跑满，165Hz 屏约 165fps）。现按 `Options.FRAMERATE_LIMIT` 跳帧，只跳过渲染，20Hz tick/输入/区块流式照常；默认 120，`test-fps-limit` 7 项 |
| 画面抖动开关 | ✅ | 2026-11-28：TAA、动态分辨率、植被摆动拆成独立开关；TAA/摆动默认关（远景闪烁与草叶抖动来源），动态分辨率默认开；切换即时作用到渲染器，`test-video-toggles` 3 项 |

### 实体
| 项 | 状态 | 说明 |
|---|---|---|
| 25 种可渲染生物 | ✅ | 34 个 mob 工厂 + 数据驱动模型；变体共用基础模型/贴图；`test-mobs-render` 20 项 |
| 羊的羊毛层 | ✅ | 2026-11-21 修：`SheepFurModel` + DyeColor tint + 随机毛色；剪毛后隐藏（测试 [20]） |
| 骷髅弓 | ✅ | 2026-11-21 修：弓弦从瞄准方向正面翻到射手一侧 |
| 药箭 | ✅ | 2026-11-28：`crafting_imbue` 配方（3x3 全满、中心滞留药水、其余 8 格箭 → 8 支带 `potion` 组件的药箭，消耗全部 9 格且不返还玻璃瓶）；弓发射 `tipped_arrow` 时箭实体携带药水并按原版 `POTION_DURATION_SCALE=0.125` 缩短时长、命中后施加效果（含立即伤害/治疗的亡灵反转）；`#minecraft:tradeable` 41 种药水（含 turtle_master 双效果）；`test-tipped-arrow` 10 项。缺口：药箭图标/实体未按药水颜色着色（cosmetic） |
| 生物装备/手持物 | ✅ | 主手物品层（骷髅弓/凋灵骷髅石剑）+ 人形四层护甲（equipment/humanoid 贴图）；2026-11-28 起按原版 `Mob.populateDefaultEquipmentSlots` 生成护甲（15% 触发、皮革/铜/金/锁链/铁/钻石六档、头→靴每格 25% 停止），僵尸 1% 铁剑/铁矛/铁锹，骷髅弓，凋灵骷髅石剑且无甲，溺尸 10% 三叉戟/钓竿 + 3% 鹦鹉螺壳副手，僵尸猪灵金剑/金矛；`test-mob-equipment` |
| 亡灵日照燃烧 | ✅ | 2026-11-28 修：`Mob.tick` 覆盖 `LivingEntity.tick` 后漏调 `tickDamageOverTime()`，僵尸/骷髅等会着火但永远不掉血（白天越积越多）。现在火焰/岩浆伤害对 mob 生效，`test-review-fixes` 实测 100 tick 掉 2 血并持续燃烧 |
| 剪羊毛 | ✅ | 2026-11-21：剪刀右键羊 → `sheared`、掉落 1–3 个对应颜色羊毛、播放 `entity.sheep.shear`；重复点击不再掉落 |
| 鸡下蛋 / 投蛋 | ✅ | 成年鸡 6000–12000 tick 下蛋（幼鸡不下蛋）；投掷蛋落地/命中生物后 1/8 概率孵化幼鸡 |
| Q 丢弃物品 | ✅ | Q 丢 1 个 / Ctrl+Q 丢整组，40 tick 拾取延迟，`dropped`/`drop` 统计；方块掉落物用真实 3D 方块模型（GROUND 展示变换、5 份堆叠），扁平物品仍用图标 sprite，`test-item-entity` 12/12 |
| 繁殖 / 喂养 / 幼年 | ✅ | 牛/猪/羊/鸡/兔/猫/豹猫/蘑菇牛：食物标签、600 tick 恋爱、6000 tick 冷却、幼年 0.5 缩放与成长、繁殖 XP、幼年无掉落；幼年专用几何体未接 |
| 驯服（狼/猫） | ✅ | 骨头（狼）/生鳕鱼或鲑鱼（猫）1/3 驯服并消耗、`owner`、空白点击坐下/站起、坐下时停止 AI、驯服后不再以玩家为目标、`FollowOwnerGoal` 跟随并在 12 格外交互传送；驯服宠物随世界存档持久化；项圈渲染未接 |
| 村民 / 宠物离线存档 | ✅ | 2026-11-28：世界级快照按实体 id 维护，区块卸载前由 `persistentCullHandler` 记录，玩家回到该区块时自动重生；保存时合并在线记录与离线快照，已死亡（加载范围内无实体）的条目清除；`test-review-fixes` 覆盖 |
| 村民 | ✅ | 2026-11-22：13 种职业工作站点认领（composter→farmer 等，单站点单村民）、职业等级/经验（0/10/70/150/250）、26.2 `trade_set → villager_trade` 数据生成的报价与补货、7 种生物群系皮肤 + 职业/等级叠加层、交易统计 `traded_with_villager`、`adventure/trade` 进度；职业/等级/报价/工作站点随世界存档持久化。2026-11-28：食物点（面包 4 / 胡萝卜·马铃薯·甜菜根 1）拾取、12 点繁殖门槛、BreedGoal 配对、50/25/25 生物群系皮肤遗传、`BabyVillagerModel` + 宝宝贴图与 0.49×0.98 碰撞箱、年龄/食物点存档；`test-villager-trade` 14 项 + `test-golem-villager`。2026-11-28：农民 `HarvestFarmland` 目标（8 格内成熟作物→走近→收割并补种，小麦种子 0–3、胡萝卜/马铃薯/甜菜根 1–4/1–3）、3 小麦→1 面包（4 食物点）、`TradeWithVillager` 食物分享（≥24 点分给 4 格内 <12 点的村民）、小麦/种子库存存档；`test-village-life`。2026-11-28：昼夜作息——time ≥ 12000 时 `VillagerSleepGoal` 认领 32 格内空闲床（头/脚统一为床头键、一床一人），走近后躺下（`startSleeping`，关重力、`EntityRenderer` 躺姿），日出/床被破坏/受击醒来；最近 24000 tick 内睡过的 5 名村民触发村庄铁傀儡（非玩家创建）并清空睡眠记忆；`test-villager-sleep`。2026-11-28：`VillagerSchedules.VILLAGER_DEFAULT` 日程——wake 0–10 / work 10–3000 / meet 3000–6000 / idle 6000–9000 / work 9000–12000 / sleep 12000–24000；`VillagerWorkGoal` 工作时段走回工作站点并面向它，`VillagerMeetGoal` 会议时段向 32 格内的钟聚集（按实体 id 错开站位），农民 `HarvestFarmland` 只在工作时段运行；生成村庄的房屋加入红床与随机工作站点、广场井边加入钟；`test-village-schedule` 9 项 + `test-worldgen` POI 检查。2026-11-28：制箭师大师交易 `set_random_potion(#minecraft:tradeable)` → 2 绿宝石 + 5 箭换 5 支随机药箭，`test-tipped-arrow` |
| 矿车 | ✅ | 2026-11-22：普通/箱子矿车实体与模型；`NewMinecartBehavior` 轨道跟随（直线/拐弯/坡道/摩擦/动力轨加速/未供能动力轨刹停）、检测铁轨占用供电、物品放置、右键乘坐与潜行下车、箱子矿车 27 格 GUI、生存破坏掉落；`test-minecart` 11 项 |
| 流浪商人 / 商人羊驼 | ✅ | 2026-11-28：`WanderingTraderSpawner` 1200 tick 检查、24000 tick 刷新、25%→75% 概率、1/10 尝试、48 格内以钟（会议 POI）或玩家为参照找 2x3x2 空地，生成 1 商人 + 2 商人羊驼；3 组 26.2 TradeSet（2 买 / 2 稀有 / 5 常见）共 9 条报价，药水成本按组件匹配，交易界面无等级条并显示 `entity.minecraft.wandering_trader`，交易中冻结 AI，48000 tick 未交易后与羊驼一起消失；羊驼沿用 `LlamaModel` + 蓝色交易毯层，跟随商人（无拴绳渲染/物理）；`test-wandering-trader` 15 项 |
| 船 / 筏 | ✅ | 2026-11-23：10 种木材 × 普通/箱船（含竹筏）实体与模型；`AbstractBoat` 状态扫描/浮力/划桨/转向/陆地摩擦、水面吸附、物品放置（方块面或流体表面）、右键乘坐与潜行下船、箱子船 27 格 GUI（潜行右键）、`VehicleEntity` 伤害累计 40 与掉落；`test-boat` 16 项（含受控场景像素差分） |
| 区块实体存档 | ✅ | 2026-11-23：区块 NBT `Entities` 保存野生生物（类型/位置/速度/生命/年龄/羊毛色）、矿车与船（含箱内物品）、掉落物（物品与组件）、经验球；读档按区块激活生成，不重复跑区块初始生物生成；已保存区块卸载后从保留的 NBT 字节恢复（方块与实体一起），不再按种子重生成；区块离开保留带前写回实体；村民/已驯服宠物仍走世界级存档；`test-entity-save` 11 项 |
| 铁傀儡 | ✅ | 2026-11-28：南瓜+4 铁块的 `CarvedPumpkinBlock` 图案生成（真实右键放置路径、清空方块、`PlayerCreated`）、100 生命/15 攻击（随机伤害+上抛）/击退抗性/1 格跨越、怪物目标选择（排除苦力怕与创造玩家）、铁锭治疗 25、裂纹层（低/中/高贴图）、铁锭/虞美人掉落；`test-golem-villager` |
| 更多 AI（马、美西螈等） | ❌ | 实体工厂里没有这些类型 |

### GUI / 物品栏 / 容器
| 项 | 状态 | 说明 |
|---|---|---|
| 标题/世界选择/创建世界/暂停/选项/视频设置 | ✅ | `test-menu` 9 项 |
| 生存背包 / 创造物品栏 | ✅ | 官方 tab 精灵、滚动、搜索、tooltip、3D 预览。2026-11-28：创造背包 Survival Inventory 页按 Java `selectTab(Type.INVENTORY)` 重排——2x2/结果槽移到 -2000 隐藏、盔甲槽 (54|108, 6|33)、副手 (35,20)、主背包 y=54/72/90、热栏 y=112、销毁槽 (173,112)，面板维持 195x136 并切到 `tab_inventory`；搜索页使用 `tab_item_search`，按本地化名称匹配并支持 `#tag`，切页清空；`test-creative-inventory` 13 项。2026-11-28 修：拿着物品左键点创造页物品栏里的其它物品时按原版**销毁手上物品**（不再交换）；(173,112) 销毁槽清空光标/Shift 清空整个背包 |
| 玩家 3D 预览 | ✅ | 2026-11-28：按 `InventoryScreen.extractEntityInInventoryFollowsMouse` 双向鼠标角度（xAngle 转体、yAngle 抬头/压低相机）、bodyRot 180 基准、*O 插值字段同步（此前 partialTick=0 导致预览永远朝 0°）、GUI 全亮光照、盔甲（材质层）随预览渲染；创造背包预览框改到 (73,6)-(105,49) |
| 容器点击规则（左右键/Shift/拖拽/数字键/F/Q/双击） | ✅ | `test-containers` 19 项；`AbstractContainerScreen` |
| 合成台/箱子/熔炉/配方书 | ✅ | 真实配方、箱子会话内持久、熔炉 GUI 打开时推进 |
| 村民交易界面 | ✅ | `MerchantScreen` 276x166：7 行报价列表/滚轮与拖动滚动/悬停高亮、3 个交易槽、经验条、等级标题、缺货印章、折扣划线、玩家背包；`test-villager-trade` |
| 中文文案完整性 | ✅ | 2026-11-21 补齐 `menu.advancements`/`menu.stats`/`createWorld.create`/`selectWorld.difficulty` |
| 统计（Statistics）界面 | ✅ | General/Items/Mobs 三页、6 列排序、真实计数器（挖掘/放置/拾取/合成/击杀/死亡/伤害/距离/游玩时间） |
| 进度（Advancements）界面 | ⚠️ | 数据驱动：126 个定义（117 可见，5 个 root）；2026-11-28 起为原版树状布局——五根标签按 story/nether/end/adventure/husbandry 顺序，28px 网格、叶子占行/父节点居中、L 形连接线、26x26 任务/目标/挑战边框、悬停标题+描述 tooltip、拖动/滚轮平移与溢出滚动条；触发器 `inventory_changed`/`mine_block`/`consume_item`/`player_killed_entity`/`killed_by_entity`/`location`（需 dimension）/`villager_trade`/`tick`，支持 entity_properties 的 `position.y` 上下限；完成弹 toast 并随存档保存。缺完整条件（生物群系/结构/物品谓词/count/components）与配方解锁联动；frame 边框用绘制矩形代替 widgets.png 精灵（cosmetic） |
| 统计计数器 | ✅ | `Statistics` 随玩家 `Extra.stats` 保存；挖掘/放置/拾取/合成/熔炉/击杀/死亡/伤害/移动距离/动物繁殖均有埋点 |
| 多人/LAN/资源包/皮肤设置/遥测 | ❌ | 按钮占位或没有入口 |

### 玩法
| 项 | 状态 | 说明 |
|---|---|---|
| 移动/跳跃/疾跑/飞行/游泳/碰撞 | ✅ | 含 step-up、双击飞行、疾跑 FOV。2026-11-28：创造飞行垂直速度改为 `LocalPlayer.aiStep` 口径——每 tick `delta.y += inputYa * 0.05 * 3`，随后 `Player.travel` 保留 `originalMovementY * 0.6`（此前直接赋固定 ±0.5395，起落瞬移）；`test-player-motion` 实测首 tick 0.09、终速 ±0.225、松键回悬停 |
| 挖掘/放置/生存（血量/饥饿/掉落/重生） | ✅ | |
| 合成/熔炼/箱子 | ✅ | 见上 |
| 剪刀（羊） | ✅ | 见「实体」；其他剪刀用途（树叶、藤蔓）未接 |
| 植物支撑 | ✅ | 2026-11-28：方块变化后按 `BlockState.canSurvive` 重新校验邻居，失去支撑的短草/高草/甘蔗/火把/门等会掉落并连锁移除（甘蔗支撑含 substrate + 相邻水/冰规则） |
| 弓/箭（玩家） | ✅ | 蓄力/释放、箭消耗与弓耐久、命中 mob（含 owner 过滤） |
| 桶 / 打火石 / TNT | ✅ | 水/岩浆桶放置与装取、点火；TNT 点燃/引信/连锁；2026-11-28 起爆炸改用 `ServerExplosion` 的 1352 条边界射线（按方块爆炸抗性逐 0.3 步衰减，泥土弹坑远大于石头）、`ApplyExplosionDecay` 默认掉落衰减（每件物品 1/半径 概率保留）、`getSeenPercent` 16³ AABB 采样遮挡（墙后伤害/击退降至 1）与 `PrimedTnt` owner（玩家点燃的 TNT 把击杀/稀有掉落记给玩家）；红石信号点燃已接 |
| 钓鱼 | ✅ | 鱼竿抛竿/浮漂漂浮/5–25s 咬钩/收竿掉落（鱼 85%、垃圾 15%，海洋幸运才出宝藏）、1–6 XP、鱼竿耐久、`fish_caught` 统计 |
| 附魔台 | ✅ | 书架功率 0–15、三档等级花费、青金石消耗、按物品类别随机词条与等级、`enchant_item` 统计与音效 |
| 药水 / 酿造 | ✅ | 14 种药水 + 水/粗制/浓稠/平凡；红石延长、萤石强化、发酵蛛眼腐化；火药→喷溅、龙息→滞留；酿造台 3 瓶 + 原料 + 烈焰粉 20 燃料、400 tick；右键开酿造台；玻璃瓶装水；饮用应用效果并归还玻璃瓶；喷溅/滞留投掷物、距离衰减范围效果、滞留云（半径 3/600 tick/0.25 时长）；效果与 `potion` 组件随存档保存 |
| 状态效果 HUD | ✅ | 右上角一列 24x24 背景 + 18x18 图标、剩余时间、等级罗马数字；剩余 <10s 闪烁；中毒/凋零时心形变绿/黑 |
| 红石 | ✅ | 红石线功率/连接形状、拉杆/按钮/压力板、红石火把（反相 + 2 tick 调度 + 8 次/60 tick burnout）、中继器（1–4 档延迟/单向）、比较器（容器/蛋糕/堆肥桶模拟输入、侧输入、compare/subtract、2 tick）、侦测器（2 tick 脉冲）、日光探测器（天空光 + 太阳角 + 反相）、拌线/拌线钩、红石灯、木/铁门、活板门、栅栏门、TNT 信号点燃、活塞（普通/粘性，推/拉/12 格/不可推方块）、铁轨形状与动力轨供电、检测铁轨由矿车占用供电；缺粘液/蜂蜜牵引链、活塞 moving_piston 动画、矿车实体碰撞推挤、物品展示框/讲台/唱片机的比较器模拟输出 |
| 床睡觉 | ✅ | 夜晚/雷暴、8 格内无怪物、床上方无遮挡才能入睡；60 tick 后跳到次日清晨、清雨、设置重生点并持久化；黑屏淡入淡出；睡眠中禁止移动/挖掘/攻击 |
| 村民交易 | ✅ | 成年村民右键打开交易界面；报价成本/结果/使用次数、补货（每天 2 次）、等级提升追加报价；地图交易未接（流浪商人见下行） |
| 成就（Advancements） | ⚠️ | 见「GUI」进度行：列表界面 + 8 类基础触发器（含 `villager_trade`）可用；树状布局与完整条件待补 |
| 经验球/掉落物 | ✅ | 掉落物用物品图标 sprite（非 4px 占位），2026-11-28 补齐 26.2 `ItemEntityRenderer`：`spin=age/20+bobOffs` 弧度（此前多乘 2π，20 tick 就转一圈）、`bob` 加 `ITEM_MIN_HOVER_HEIGHT 0.0625`、按 `ItemClusterRenderState.getRenderedAmount` 渲染 1/2/3/4/5 份（≤1→1、≤16→2、≤32→3、≤48→4、其余→5），扁平 sprite 沿局部 Z 0.09375 排开 + ±0.075 随机 X/Y（种子 = 物品 id + damage）；`test-item-entity` 6 项。块状物品的真实 3D 模型仍走图标 sprite（后续批次） |

### 世界生成 / 存档
| 项 | 状态 | 说明 |
|---|---|---|
| 密度噪声地形 / 生物群系 / 含水层 / 地表规则 | ✅ | `NoiseChunkGenerator` |
| 树木/花草/矿/湖/甘蔗等 feature | ✅ | `features/` 22 种 |
| 村庄 | ⚠️ | 程序化近似，不是原版 NBT 模板；无其他结构 |
| 下界/末地/要塞/矿洞 | ❌ | 只有主世界 |
| 存档 | ✅ | IndexedDB 自定义分块存储；支持 `.mca` 区域导入/导出 |
| 存档写入安全 | ✅ | 2026-11-28 修审阅 P1：批量写入成功后才清除脏标记/登记已保存（失败批次下次重试，写入期间新增的 section 保持脏）；未激活区块不再被空实体列表覆盖；玩家存档覆盖 0–42 槽（盔甲/副手/鞍）；流浪商人报价与使用次数写入区块记录；村民/驯服宠物改为世界级快照（卸载前快照、回载时重生、死亡时清除），离开区块再保存不再丢失 |
| 有限/无限世界 | ✅ | 区块流式加载；不是 Anvil 全尺寸世界 |

### 音频 / 多人
| 项 | 状态 | 说明 |
|---|---|---|
| 原版音效事件 | ✅ | 959 个事件、4341 个 ogg；脚步按 SoundType |
| 音乐/唱片 | ✅ | 26.2 music/music_disc 事件与 ogg 资源已接入（`sounds/index.json` 里 `music.game`/`music_disc.cat` 等直连文件），背景音乐按情境选曲；2026-11-28 补唱片机：`useJukebox` 插入唱片→`has_record=true`、播放 `music_disc.<song>`（音量 4）、非创造消耗唱片、`play_record` 统计；空手弹出→`has_record=false`、停止播放并掉回唱片；破坏播放中的唱片机停播并掉出唱片；歌曲与播放进度写入 `minecraft:jukebox` 方块实体，重载后恢复比较器输出并从保存 tick 继续播放。`SoundEngine.play` 现返回 stop 句柄并支持 offset；`test-jukebox` 4 项 + `test-jukebox-persistence` 8 项 |
| 多人 | ❌ | `bridge/` 未接线 |

## 5. 优先级队列

**P0（视觉/功能明显错误，先做）**
1. ~~实体装备层~~ ✅ 已完成：主手武器（骷髅弓/凋灵骷髅石剑）+ 人形四层护甲。
2. ~~第一人称手持物逐项对参考图微调~~ ✅ 2026-11-28 验证：1280x720 / yaw 30 / pitch 22 /
   stone 选中，`scripts/test-hand-reference.mjs` 对手持石头剪影与
   `shots/ref/ref-day-6000-hand-stone.png` 逐项比对——顶部 y=553、左缘 x=1070、
   宽 182、高 62 完全一致，灰色像素数 7729 vs 7713（0.2%）。手持方块与参考图已对齐。
3. 水面远处/加载瞬间偶发灰色平面：本轮未复现，保留观察；复现后查水体层/光照贴图时序。
4. 视觉观感与 BetterMC 整合包差距（用户反馈，持续）：资源/光影综合观感，逐项按下面
   光影清单推进，并对照 `shots/ref/*` 真值图。

**光影 / 视觉清单（Complementary Reimagined r5.9.3 源码为真值，逐项打勾）**
- [x] 水 SSR（30 步、6 次细化、边界/亮度衰减）、GetSky 天空反射、GGX 高光、水雾/菲涅尔 alpha
- [x] 水折射：`lib/materials/materialMethods/refraction.glsl` 的 `DoRefraction`
      已按 `DETAIL_QUALITY>=3` 接到 high/ultra 档（默认 medium 档保持无折射，与原包默认一致）。
      forward 水着色器用 `uSceneColor` 的折射采样替换水下背景、再以水色按 alpha 合成；
      噪声偏移 = `noisetex.rb-0.5 * intensity * gbufferProjection[1][1] / (3+lViewPos) * 0.015
      * clamp(approx(depth1)-approx(depth0))`。包内 `noise.png` 不随仓库分发，
      用同尺寸（256²、REPEAT、LINEAR）的确定性 RG 噪声生成等效场。
      验证：`test-water-refraction` 4/4（high 档开关噪声差 32573 px，medium 档 0 px，
      截图 `shots/diag/water-refraction.png` 可见水下棋盘扭曲）
- [ ] 水下焦散（caustics.glsl 对应效果；当前只做了 `BRIGHT_CAVE_WATER` 颜色补偿）
- [x] 体积光 / God rays：按 `volumetricLight.glsl`（LIGHTSHAFT_QUALI 2）移植为半分辨率
      `VOLUMETRIC_FRAG`——10 near + 1 far 采样、fogCurve 0.9 / distribution 2.0、
      `maxDistance=max(far*0.98,128)`、双级联 2×2 PCF 遮蔽、COMPOSITE1 的
      lightColor（正午 `(0.4,0.75,1.3)`、日落暖色、夜间月光）与 Step1/Step5 系数，
      在 composite 里加法混合（strength 0.3，针对本管线 display-referred 场景标定）。
      验证：`test-volumetric-light` **6/6**（实心屋顶下 debug 亮度 0.001 → 露天 1.0；
      朝太阳的叶墙把光轴压到 0.001；开/关 45.9% 像素改变、GL error 0），
      截图 `shots/diag/volumetric-beams-on/off.png`、`volumetric-on/off.png`
- [x] 体积云：按 `reimaginedClouds.glsl`（CLOUD_STYLE 1 / CLOUD_QUALITY 2）移植为半分辨率
      `CLOUD_FRAG`——192±4.2 云层 slab、`GetRoundedCloudCoord`（narrowness 0.07 / roundness
      0.125）等值面 `noise > pow(|alt-y|/stretch,8)*0.5+0.25`、两次朝阳 2D 采样着色、
      级联阴影压暗（lightMult 0.25）、按水平距离淡出并与天空渐变混合；场景深度截断射线，
      地形可遮挡云层。覆盖率纹理用 256² 可平铺 fBm 按 pack `cloud-water.png` 的 24%
      二值分布生成，避免再分发 pack 资源。shader 云启用时 `CloudRenderer` 的原版体素云层
      不再绘制（`Game` 检查 `renderer.cloudsHandledByShaders`）。
      验证：`test-volumetric-clouds` **5/5**（云层覆盖率 43.4%、开关 41% 像素改变、
      日落与 GL error 0），截图 `shots/diag/clouds-on/off-vanilla.png`、
      `clouds-below-on/off-vanilla.png`、`clouds-sunset.png`
- [ ] 景深（DOF，`program/deferred*/final` 中的手部/近景模糊）
- [ ] 云/星空进入水面反射：zip 的 `SKY_EFFECT_REFLECTION_TRANSLUCENT` 仅在
      DETAIL_QUALITY>=3 定义，当前按默认档 2 关闭；高画质档需要补
- [ ] 阴影/水面远景灰面（见 P0 #3）
- [ ] 与 BetterMC（Iris+Complementary 综合包）并排观感对照：草地/树叶色彩、云层体积感、日/月/星空

**P1（原版核心玩法缺口）**
4. ~~羊繁殖/幼年~~ ✅ 已完成通用动物繁殖（见实体表）；~~狼/猫驯服~~ ✅ 已完成驯服/坐下/跟随与宠物存档；~~野生动物实体存档~~ ✅ 已完成区块级实体存档（见「区块实体持久化」）；~~大型世界的数据库按需区块加载~~ ✅ 2026-11-28：启动只同步 5×5 区块，其余 IndexedDB 按需读取/解码（见「区块实体持久化」）；剩余：幼年专用模型、项圈渲染、马科/更多生物 AI。
5. ~~玩家弓/箭、桶、TNT~~ ✅ 已完成；红石信号点燃 TNT 已接；~~TNT 归属与爆炸掉落衰减~~ ✅ 已按 `ServerExplosion` 射线算法 + `ApplyExplosionDecay` + `PrimedTnt.owner` 重写；~~药箭~~ ✅；~~爆炸可见度（`getSeenPercent` 遮挡）~~ ✅ 16³ AABB 采样 + 碰撞体射线；剩余：比较器/活塞等红石长尾。
6. ~~统计界面~~ ✅ 已完成 General/Items/Mobs 三页与计数器；~~进度（Advancements）界面与基础触发器~~ ✅ 已完成 + 8 类触发器（含 `villager_trade` 与 Y 坐标谓词）；~~树状布局/连接线~~ ✅ 原版 28px 网格、父节点居中、拖动/滚轮/滚动条与悬停 tooltip；剩余：完整 criteria 条件（生物群系/结构/物品谓词/count/components）、配方解锁联动。
7. ~~村民交易~~ ✅ 已完成职业工作站点、等级/经验、26.2 报价数据、补货、交易界面与存档；~~村民繁殖与铁傀儡~~ ✅ 已加入食物点繁殖/宝宝模型与南瓜图案生成的铁傀儡；~~村民农业~~ ✅ 农民收割/补种/烤面包 + 食物分享；~~村民睡眠/工作日程（昼夜作息与床）~~ ✅ 已加入日落入睡/日出醒来、床认领与躺姿、受击/床毁唤醒，~~村庄八卦生成铁傀儡~~ ✅ 简化为 5 名最近 24000 tick 内睡过的村民生成（无 gossip 系统），~~工作/聚集时段~~ ✅ 已按原版日程加入工作站点工作、钟声会议与农民工作时段门控，生成村庄已带床/工作站点/钟，~~流浪商人~~ ✅ 已加入生成周期、9 条 26.2 报价、交易界面与商人羊驼；剩余：地图交易（需已填充地图/结构定位）、袭击。
8. ~~夜间怪物装备/掉落表与自然生成权重对齐~~ ✅ 已完成原版护甲分布/武器/副手与玩家击杀稀有掉落（僵尸铁锭·胡萝卜·马铃薯、溺尸铜锭、凋灵骷髅头）；自然生成权重本就来自 vanilla `worldgen.json` 的 biome spawners。

**P2（长尾一致性）**
9. 村庄结构换成原版模板/更接近的拼片（已补床/工作站点/钟）；矿洞/要塞。
10. 粒子表全量对齐；音乐曲目表。
11. 生物群系/地形边界与 26.2 逐种子对比。

## 6. 本轮改动（2026-11-21）

- 性能（设置页掉帧根治）：真实环境报告 `logs/perf/perf-2026-11-21T09-07-40-130Z.json`
  显示 `renderHud` 236.5 ms/帧（其中 9 个物品图标 89.7 ms），根因是菜单打开时 HUD 仍被完整绘制、
  随后又被 `ScreenManager` 整屏擦掉；另外 HUD、菜单背景和图标图集都在做不必要的每帧重绘。
  - `Game.render`：有菜单（`preserveHud=false`）时完全跳过 `renderHud`；关闭菜单强制重画一次。
  - `Game.renderHud`：增加 HudState 脏标记，静止时 0 次绘制；聊天/Toast 结束时各补画一次。
  - `GuiGraphics.renderMenuBackground`：泥土+遮罩预烘焙成一张不透明画布，每帧只 1 次
    `drawImage`（原为每帧 `createPattern` + 2 次全屏 `fillRect`）。
  - `ItemIconAtlas.draw`：`createImageBitmap` 不可用时按物品缓存小画布，避免从 3200² 图集
    直接上传（真实环境曾 90 ms/9 图标）。
  - 视频设置修改 GUI 缩放时立即重烘焙图标并重排当前屏幕（原实现要等下一次窗口 resize）。
  - 证据：1600x900@1.5 下暂停页 10.3→55.7 fps、视频设置 12.1→60.1 fps，`screens`
    59.5→1.0 ms/帧；新增 `scripts/test-hud-dirty.mjs` 5/5。
- 羊：新增 `SheepFurModel`（`src/client/renderer/entity/model/EntityModels.ts`），
  `MobRenderer` 增加第二层渲染（羊毛按 `SHEEP_WOOL_RGB` 染色，剪毛后跳过），
  `ModelRegistry` 增加 `sheep/sheep_wool` 额外贴图；`Sheep` 构造时随机毛色。
- 骷髅：弓弦 4 段从 bow-local `y=+1.7` 翻到 `-2.1`，弦回到射手一侧。
- 光影颜色：不再在 lightmap 之上叠加 0.55 的第二太阳（这正是“颜色特别鲜艳”的来源），
  改为用阴影贴图衰减直接光（阴影保留 55% 环境光）。
  新增 `uShadowDay`（由**太阳**高度计算，夜晚为 0），避免夜间把月光方向当成太阳而出现月影。
  正午草地平均色 `#85A451` → `#607C37`，原版平面参考 `#5B7541`（`color-on/off` 实测）。
- 剪羊毛：`ShearsItem.useOn` 行为接入 `Game.useItem`（实体射线被方块遮挡、点击先于放置），
  羊掉落 1–3 个对应颜色的羊毛并播放 `entity.sheep.shear`；`Sheep.woolColor` → 羊毛物品映射。
- GUI：生存背包的 3D 预览底色改为黑色（对齐原版 `inventory.png` 的预览窗）；
  暂停菜单底部改为“保存并退回到标题屏幕”；所有占位 toast 改用当前语言的文案。
- 中文：补齐 4 个缺失 key（暂停菜单的“进度/统计信息”等）。
- 测试：`test-mobs-render` 增加 [20] 羊毛层/剪毛断言；`smoke` 的 placeBlock 场景改为
  自适应后撤（之前的固定 2.5 格在起伏地形上会把目标格算进玩家碰撞盒，导致 0/10 的假失败）。
- 验证：`tsc` 0；`test-mobs-render` 20/20；`test-menu` 全过；`test-containers` 全过；TAA 8/8；
  `test-hud-dirty` 5/5；全量 `smoke` 19/19；剪羊毛探针（红羊 → `sheared=true`、掉落
  `minecraft:red_wool` x2、重复右键不再掉落）；截图 `shots/diag/sheep-wool.png`、
  `skeleton-bow.png`、`inventory-new.png`、`pause-new.png`、`shear-before.png`、
  `shear-after.png`、`pause-cached-bg.png`、`video-cached-bg.png`、`hud-after-close.png`。

### 药水 / 酿造（本轮新增）

- 数据层 `src/vanilla/world/item/potion/Potions.ts`：`parsePotion` 处理 `long_`/`strong_`/`splash_`/`lingering_`；
  `potionEffects` 返回时长/等级；`brewResult` 覆盖 水→粗制/浓稠/平凡/虚弱、粗制→14 种、红石→延长、
  萤石→强化、发酵蛛眼→腐化（迅捷/跳跃→缓慢、治疗/剧毒→伤害、夜视→隐身）。
- 酿造台 `BrewingMenu` + `BrewingScreen`：5 个容器槽（3 瓶/原料/燃料）+ 玩家背包；每 tick 消耗 1 燃料、
  400 tick 完成；同时混合 3 个瓶位并消耗 1 个原料；烈焰粉 1 个补 20 燃料；关闭 GUI 后仍持续推进
  （所有已缓存的容器菜单都会 tick）。GUI 绘制 `brew_progress`/`bubbles`/`fuel_length` 裁剪精灵，
  空燃料槽画 `container/slot/brewing_fuel`；酿造完成播放 `block.brewing_stand.brew`
  （资源包内嵌在 `entity.villager.work_cleric/` 目录，`SOUND_FILE_ALIASES` 修正指向）。
- 玩家效果 `SurvivalState.effects`：速度/缓慢/跳跃提升/力量/虚弱/抗火/再生/中毒/凋零/水下呼吸/
  缓降；瞬间治疗/伤害在饮用时结算；抗火拦截熔岩/火/营火伤害；缓降清零坠落距离并限制下降速度；
  速度/缓慢乘移动速度、跳跃提升改跳跃初速、力量/虚弱改近战伤害；HUD 右上角效果图标。
- 交互：玻璃瓶右键水源 → 水瓶；饮用 `potion` → 应用效果、`used/potion` 统计、生存模式归还玻璃瓶
  （创造保留药水并补瓶，对齐 `ItemUtils.createFilledResult`）。
- 喷溅/滞留：`ThrownPotion`（重力 0.05/阻力 0.99，方块或生物命中即碎）+ `AreaEffectCloud`
  （半径 3、等待 10、寿命 600、每 tick 缩 3/600、每命中一个实体再缩 0.5、每 5 tick 结算、
  单个受害者 20 tick 重应用间隔）；喷溅按 `1 - 距离/4` 缩放，瞬间伤害/治疗满强度，亡灵反转；
  滞留按 0.25 时长结算。水瓶喷溅熄灭 3x3x3 内的火；命中播放碎瓶音效并喷出按药水颜色染色的粒子。
  投掷物使用物品图标渲染（`ItemEntityRenderer` 的 sprite 路径），与 ThrownItemRenderer 一致。
- 存档：`playerExtra().effects` 写入玩家 `Extra`，读档恢复；背包 `components`（药水 id、附魔、耐久、
  自定义名）现在随 `Extra.inventory` 保存，之前只存 id+count 会丢附魔/药水种类。
- 验证证据：`tsc` 0；探针右键真实放置的酿造台 → `BrewingScreen`；3 瓶水 + 地狱疣 → 3 瓶粗制、疣 3→2、
  燃料 19；粗制 + 糖 → 迅捷；火药 → `splash_potion`、龙息 → `lingering_potion`；饮用迅捷 →
  `speed` 3600 tick、选中槽变玻璃瓶、`used/potion`=1、`speedMultiplier` 1→1.2；玻璃瓶装水 →
  `potion/potion=water`；毒 60 tick 20→18；喷溅投掷 2.5s 后玩家获得 `speed`、`used/splash_potion`=1；
  喷溅强伤害对牛 20→8、玩家 20→8（创造/无敌帧排除后）、强治疗玩家 8→16、2 格距离迅捷时长 2453<3600；
  滞留毒云 1.8s 后玩家 `poison` 444 tick、云半径 3→1.865；水瓶喷溅清除 9/9 个火方块；存档重载后
  `speed`/`fire_resistance` 与 `long_night_vision`、`sharpness 3` 全部保留。截图
  `shots/diag/brewing-gui.png`、`brewing-block.png`、`hud-effects.png`、`splash-potion.png`、
  `lingering-cloud.png`。
- 剩余：药水图标按效果染色、tooltip 列出效果、夜视亮度/隐身、滞留云的方块级模型（当前用染色粒子表现）、
  药水箭。

### 红石基础（本轮新增）

- 新模块 `src/vanilla/world/redstone/RedstoneSystem.ts`（约 600 行）：实现 `SignalGetter` 的弱/强信号查询
  （含固体方块强充能传导）、红石线 `updatePower`/`updateShape`（含直线补边与上下连接）、
  火把反相与 2 tick 调度、中继器 `DiodeBlock` 输入/输出/延迟、按钮 20/30 tick 自动回弹、
  压力板实体检测与 20 tick 检查、红石灯开/关延迟、门/活板门/栅栏门的 powered/open 同步与音效、
  TNT 信号点燃。事件驱动：`Game.updateNeighbors` 调用 `onBlockChanged`，队列去重后一次 flush；
  爆炸时批量 `onBlocksChanged`；`Game.tick` 推进调度。
- 交互：右键拉杆/按钮/中继器（1–4 档延迟）/木门/活板门/栅栏门；铁门/铁活板门只响应红石。
  摆放时 `hasNeighborSignal` 接入真实红石，门/活板门被充能时直接以 open+powered 状态放置。
- 渲染：`LevelRenderer.tintSource` 按 `RedStoneWireBlock.getColorForPower` 给红石线染色
  （0 档 #4D0000 → 15 档亮红），之前是灰白线；灯亮状态发射 15 光照（实测灯上方方块光 14）。
- 验证证据：`tsc` 0；探针（真实方块放置 + `Game.updateNeighbors`）：
  拉杆→6 格线→灯，关闭时 0/0/0/0/0/0 且灯灭，开启后 15/14/13/12/11/10 且灯亮；
  石按钮点亮灯并在 1.6s 后自动熄灭；中继器输入 15 时立即输出 0、2 tick 后输出 15 并点亮灯；
  拉杆给火把底座强充能后火把 2 tick 熄灭、输出线 15→0；拉杆→木门两半 open=true；
  红石块→TNT 方块变 air 且生成 1 个 PrimedTnt；石压力板站上 powered=true、离开后 false；
  真实右键拉杆（`Game.useItem`）→ powered=true；真实放置中继器 → 方块存在、facing=north（玩家朝南）、
  delay=1。截图 `shots/diag/redstone.png`。

### 红石长尾（2026-11-21 追加）

- `RedstoneSystem.ts` 继续按 26.2 反编译源码移植：
  - **比较器**：`ComparatorBlockEntity.outputSignal` 用 `Map` 代替；后方容器/蛋糕/堆肥桶的模拟输出
    （`Container.getRedstoneSignalFromContainer`、`(7-bites)*2`、堆肥 `level`），导体可把模拟信号再传一格；
    侧输入用 `getControlInputSignal`（红石块 15 / 红石线功率 / 信号源强充能，普通方块 0）；
    `compare`/`subtract` 与 `input==side` 细节按 `calculateOutputSignal`/`shouldTurnOn`；2 tick 调度；
    右键 cycle mode + `block.comparator.click`（0.5/0.55）。
  - **侦测器**：世界编辑后 `notifyObservers()` 只对 FACING 指向被改方块的观测者排 2 tick 脉冲；
    开→关→开的两段 2 tick 节奏、输出只从背面（`FACING` 查询方向）发出；放置时 `FACING=视线方向`。
  - **日光探测器**：每 20 tick 更新；天空光 × 太阳角余弦（夜间 0），反相在昼夜亮度之后取 `15-target`；
    右键切换 `inverted` 并立即刷新。
  - **拌线/拌线钩**：`TripWireBlock.shouldConnectTo` 连接形状、hook 沿 FACING 扫描 42 格判断 attached/powered、
    两端 hook 同时驱动、`click_on/off` 与 `attach/detach` 音效；每 tick 用实体 AABB（attached 时 1/16–2.5/16）
    检测踩线；剪刀解除仍未接（破坏时不产生原版的瞬时脉冲，已记录）。
  - **火把 burnout**：60 tick 内 8 次翻转后熄灭 160 tick，播放 `block.redstone_torch.burnout`。
  - **活塞**（结构解析已改为移植 `horizon-main/crates/horizon-world/src/level/pistons.rs`）：
    `piston_neighbor_signal`（除推面外 + 头顶准连接）、`isPushable`、`addBlockLine`（含粘液回扫与碰撞重排）、
    `addBranchingBlocks`、`canStick`（粘液/蜂蜜互不粘连）、12 格上限、不可推集合（硬度 -1 / 黑曜石家族 /
    方块实体 / 已伸出活塞 / 活塞头）、粘性活塞回拉；`piston_head` 的 `facing/type/short` 与底座
    `extended` 同步，head 失去底座会移除。粘液/蜂蜜横向分支会跟随主推列移动。
  - **活塞推实体**（移植 `horizon-world/src/piston_push.rs` 的 `moveCollidedEntities` /
    `moveStuckEntities` 语义）：被推方块扫过的实体沿推动方向移动（先移实体再落方块，避免碰撞
    扫描从已放置方块内部开始）；蜂蜜方块拖拽站在上面的实体；粘液方块给实体施加沿移动轴的弹跳
    速度；玩家与生物都走各自的碰撞移动。
  - **比较器模拟输入扩展**（`BlockState.getAnalogOutputSignal`）：容器/潜影盒、蛋糕剩余、
    堆肥桶 `level`、炼药锅 `level`（水/熔岩/细雪）、重生锚 `charges`、末地传送门框架 `eye`、
    蜂巢/蜂箱 `honey_level`、幽匿感测体 `power`、雕纹书架最后一个占用槽位。唱片机/讲台/物品展示框
    仍缺（分别需要歌曲 comparatorOutput、页码和展示框旋转数据）。
  - **铁轨**：`RailState.place` 简化版（直线/拐弯/坡道），动力轨/激活铁轨按邻居信号更新 `powered`，
    探测铁轨留给矿车批次。
- **调度队列修复**：`RedstoneSystem.tick()` 末尾统一 `flush()`。之前 scheduled tick 只入队不结算，
  比较器/观测者/中继器驱动的红石线要等下一次世界编辑才更新（表现为输出慢一拍）。
- 接线：`Game` 新增 `containerSignal` 钩子（从 `blockContainers` 的 `SimpleContainer` 按要求公式算 0–15）；
  `Placement.ts` 新增 `ObserverBlock`（视线方向）、`PistonBaseBlock`（反视线方向）、`TripWireHookBlock`
  （水平点击面 + 背面支撑）三个 `getStateForPlacement`。
- 验证证据：`tsc` 0；永久回归 `node scripts/test-redstone.mjs` 28/28（含比较器/模拟输入扩展/侦测器/日光探测器/
  拌线/火把 burnout/活塞/活塞推实体/蜂蜜拖拽/铁轨，临时探针已改为常驻脚本）；`test-placement` 144/144（新增 observer /
  piston / sticky piston / tripwire hook 放置朝向与无支撑拒绝共 13 项）；截图 `shots/diag/redstone2.png`。
  回归：`test-containers`、`test-mobs-render` 20/20、`test-menu`、`test-hud-dirty`、`test-mesher` 64/64、
  `audit-p0` 13/13、`audit-behavior-p0` 4/4、`smoke` 19/19 全绿。
- **狼/猫驯服**：`Mob` 增加 `tamed/sitting/owner` 与坐下停 AI；`Wolf`/`Cat` 实现 `mobInteract`
  （1/3 驯服、消耗食物、站起/坐下），`FollowOwnerGoal` 跟随并在 12 格外交互传送；
  `Game.useItem` 实体交互分支接入。永久回归 `node scripts/test-taming.mjs` 7/7
  （驯服、owner/目标、坐下/站起、跟随、猫用鱼驯服、存档重载恢复），截图 `shots/diag/taming.png`；
  `test-entities` 与 `test-mobs-render` 全绿。
- **宠物存档**：`WorldRecord.pets` + `SavedPet`（type/位置/生命/坐下/owner），
  `WorldSaveManager.savePets` 随 `flushAll` 与 autosave idle cycle 写入；
  `restoreWorld` 在恢复区块后重生宠物并恢复 `tamed/sitting/owner/health`；
  回归 `test-taming` 扩展到 **7/7**（存档→重载后狼/猫仍在且状态正确），`test-save` 49/49 全绿。
  野生动物仍不存档（需要 chunk entity 记录），属于后续实体持久化批次。
- 修复：火把的强信号方向写反（`getDirectSignal` 应指向火把上方的接收者，`dir==='down'`），
  否则火把会给自己脚下的方块强充能、被自己的底座点亮又熄灭，形成 2 tick 自振荡；由 burnout 回归测试发现。
- 仍未做：活塞 moving_piston 动画与 2 tick 移动过程、`piston_movement.rs` 的每 tick 0.51 位移上限、
  物品展示框/讲台的比较器模拟输出（唱片机已完成，见「唱片机 / 音乐资源」）、
  string 按 StringItem 语义放在点击格（当前放在相邻格）。

### 进度系统（Advancements，2026-11-22）

- 数据：`scripts/build-advancements.mjs` 从 26.2 客户端数据生成 `data/advancements.json`
  （126 个定义，117 个有 display，5 个 root：adventure/end/husbandry/nether/story）与
  `data/tags.json`（item 224 / block 265 / entity_type 48）；`vite.config.ts` 的 `advancementData()`
  在生产构建时把两个 JSON emit 到 `data/`。
- 运行时 `src/vanilla/world/advancements/AdvancementManager.ts`：criteria/requirements（组内 OR、
  组间 AND）、`#tag` 递归解析、hidden 过滤、`rows(root)` 按 parent 链算 depth 排序；
  `toJSON/load` 随玩家 `Extra.advancements` 保存。
- 触发器（只授予可评估条件，未覆盖的 trigger 不误发）：`inventory_changed`（每 10 tick 背包快照）、
  `mine_block`（创造/生存两条破坏路径）、`consume_item`（食物/药水）、`player_killed_entity` /
  `killed_by_entity`、`location`（必须解析出 dimension）、`tick`。
- 界面 `AdvancementsScreen`：暂停菜单 → 进度；5 个 root 分页、列表行（图标/标题/描述、完成金色/
  进行中白色/未开始灰色、Goal/Challenge 标签、滚动条）、底部完成按钮；完成时弹 `AdvancementToast`。
- 验证：`tsc` 0；`node scripts/test-advancements.mjs` 7/7（roots、117 可见、crafting_table → `story/root`、
  cobblestone 经 tag → `story/mine_stone`、界面打开、存档重载保留）；截图
  `shots/diag/advancements-current.png`。
- 剩余：树状布局与连接线、完整 criteria（生物群系/结构/物品谓词/count/components/effects）、
  配方解锁联动、统计页与进度页互跳。

### 村民 / 交易（2026-11-22）

- 数据：`scripts/build-villager-trades.mjs` 解析 26.2 的 `trade_set → tags/villager_trade →
  villager_trade` 三层数据，生成 `data/villager_trades.json`（270 条报价；跳过 27 条需要
  结构定位/地图生成/任意 loot function 的交易）。`vite.config.ts` 在生产构建时一并 emit。
- `Villager`（`src/vanilla/world/entity/npc/Villager.ts`）：原型是 `horizon` 的
  `mobs/villager.rs` 与 26.2 反编译。13 种工作站点认领（composter→farmer、lectern→librarian、
  blast_furnace→armorer……），单站点单村民；工作站点被破坏后失业并清空报价；交易中停止 AI。
  职业等级阈值 0/10/70/150/250，40 tick 升级延迟；`shouldRestock`/`restock` 按每天 2 次补货，
  刷新 `uses` 与 demand；生物群系决定 7 种皮肤。
- `MerchantOffer` / `MerchantMenu`：成本 A/B、结果、`uses/maxUses/xp/priceMultiplier/demand/
  specialPrice`；需求加价与折扣公式按 `MerchantOffer.getModifiedCostCount`；
  `MerchantContainer.updateSellItem` 自动匹配报价；结果槽取出时消耗成本、增加经验与使用次数。
  附魔书报价从 `given_item_modifiers: enchant_randomly` 生成随机附魔并随 `resultComponents` 存档。
- 界面：`MerchantScreen` 276x166，含 7 行报价列表、滚轮/拖动滚动、缺货印章、折扣划线、
  102x5 经验条、等级标题、3 个交易槽 + 玩家背包；价格/结果物品 tooltip。
- 渲染：`VillagerModel`（26.2 `createBodyModel`）+ 基础/幼年/皮肤/职业/职业等级五类叠加贴图；
  `MobRenderer` 按实体状态选择层，`ALL_TEXTURE_KEYS` 收录全部 30 张村民贴图。
- 持久化：`WorldRecord.villagers` + `SavedVillager`（位置/生命/皮肤/职业/等级/经验/工作站点/报价
  的 uses/demand/specialPrice），随 autosave 与手动保存写入；读档时重建并重新认领工作站点。
- 进度：交易触发 `villager_trade`，顺带支持 criteria 的 `position.y` 上下限
  （`adventure/trade` 在任意高度，`adventure/trade_at_world_height` 需要 y≥319）。
- 验证：`tsc` 0；`node scripts/test-villager-trade.mjs` **14/14**（职业认领、等级 1 报价、
  右键开界面、报价选择/付款槽、成交与统计、10 XP 升级、跨日补货、存档重载、附魔书报价
  与序列化）；回归 `test-advancements` 7/7、`test-taming` 7/7、`test-save` 49/49、
  `test-mobs-render` 20/20、`test-entities` 10/10、`test-spawn` 16/16、`test-containers` 全过、
  `smoke` 19/19。截图 `shots/diag/villager-trade.png`、`villager-scroll.png`。
- 剩余：地图交易（需要结构定位与已填充地图）、流浪商人、村民繁殖/铁傀儡/袭击、
  工作与睡眠日程、附魔书 tooltip 显示附魔名与光效、交易音效目前只用 `entity.villager.yes`。

### 矿车 / 铁轨（2026-11-22）

- 实体 `src/vanilla/world/entity/vehicle/Minecart.ts`：普通/箱子矿车，尺寸 0.98x0.7。
  移植 `NewMinecartBehavior` 的核心：`adjustToRails`（吸到轨道中心/拐角投影/坡道抬升与 ±45° 俯仰）、
  `calculateTrackSpeed`（坡道滑落 0.0078125+2%、未供能动力轨刹停、0.975/0.997 摩擦、
  8 格/秒上限、供能动力轨 +0.06/0.2）、`stepAlongTrack`（轨道出口、拐角、坡道 √2 步长、
  方块碰撞后清速）、`comeOffTrack`（重力 0.04、空气阻力 0.95）。
- 检测铁轨：矿车进入/离开时通过 `MobWorld.onMinecartDetector` → `RedstoneSystem.setDetectorRail`
  切换 `powered` 并触发邻居更新；`weakSignal`/`directSignal` 返回 15。
- 交互：`MinecartItem.useOn` 只接受 4 种铁轨（坡道 +0.5 高），同格已有矿车时拒绝；
  右键空矿车乘坐、玩家位置/相机跟随、潜行下车；箱子矿车右键打开 27 格 `ChestScreen`；
  生存破坏掉落矿车本体与箱内物品。
- 渲染：`MinecartModel`（64x32，26.2 `createBodyLayer`）+ 专用 `MinecartRenderer`，
  根矩阵为 `T(pos) * RY(yaw) * RZ(-pitch) * T(0,0.375,0) * S(-1,-1,1)`；影子半径 0.7。
- 验证：`tsc` 0；`node scripts/test-minecart.mjs` **11/11**（渲染器、吸附、摩擦、拐弯、
  坡道、动力轨、检测轨、物品放置/消耗、乘坐/跟随/下车、箱子 GUI/内容、破坏掉落）；
  回归 `test-redstone` 28/28、`test-mobs-render` 20/20、`test-entities`、`test-save`、`smoke`。
  截图 `shots/diag/minecart.png`、`minecart-probe.png`、`minecart-chest.png`。
- 剩余：矿车之间/矿车与生物的推挤拾取、hurt 动画与多段耐久、漏斗/TNT/熔炉矿车、
  铁轨坡道的完整 `RailState.place`、乘坐时第一人称视角偏移微调。

### 船 / 筏（2026-11-23）

- 实体 `src/vanilla/world/entity/vehicle/Boat.ts`：`AbstractBoat` + `Boat` / `Raft` /
  `AbstractChestBoat` 的客户端移植。每 tick 先按船体 AABB 扫描流体得到
  `IN_WATER / UNDER_WATER / UNDER_FLOWING_WATER / ON_LAND / IN_AIR`；`floatBoat` 复刻
  重力 0.04、浮力 `(waterLevel-y)/height * (0.04/0.65) * 0.75`、水 0.9 / 水下流 0.45 /
  陆地摩擦 0.6（有乘客减半）、入水瞬间 `targetY = waterLevelAbove - height + 0.101`
  的吸附；`controlBoat` 复刻 `deltaRotation`（左/右 ±1，0.9 衰减）、加速 0.04/0.005、
  划桨 π/8 步进；`Game` 按 `AbstractBoat.clampRotation` 把玩家头部限制在船体 ±105°。
  箱船单乘客、27 格容器；`VehicleEntity` 伤害累计（每次 `damage*10`，>40 破坏），
  生存掉落本体与箱内物品，创造一击移除。
- 放置：`BoatItem.use`（`Game.placeBoat`）沿视线取方块/流体首个命中点（流体取表面精确
  Y），船朝向玩家 yaw，`Level.noCollision` 不通过时保留物品；甲板/水面都可放置；
  创造不消耗、生存消耗 1。
- 渲染：`BoatModel`（128x64）+ `ChestBoatModel`（128x128，含箱体/箱盖/锁）按 26.2
  `addCommonParts` 逐盒转录；`BoatRenderer` 根矩阵为 `T(pos) * T(0,0.375,0) *
  RY(180-yaw) * S(-1,-1,1) * RY(90)`，影子半径 0.8；`AbstractBoatModel.animatePaddle`
  用 `getRowingTime` 驱动左右桨；20 种实体类型全部注册贴图与渲染器。
- 受控测试场景：新增 `scripts/lib/stage.mjs`（对比 Horizon 的 `World::test_scene` +
  probe 差分思路）——在天空 y=240 生成隔离石台/泳池/白墙摄影棚，清除实体、关闭自然
  刷怪、冻结昼夜与天气、固定相机，再用 `diffPng` 对“无实体/有实体”两张截图做像素
  差分，避免真实地形、其它方块和光照变化混入渲染验证。
- 顺带修光照：`LevelChunk.getOrCreateSection` 为“加载后才创建、且整段位于现有最高
  方块之上”的 section 预填天光 15。此前在高空搭方块会创建全 0 天光的新 section，
  导致新表面全黑（测试场景最初整片发黑）。
- 验证：`tsc` 0；`node scripts/test-boat.mjs` **16/16**（20 类型渲染器、水面漂浮高度、
  上船/前进/转向/下船、陆地摩擦、水面与方块放置/消耗、箱船 27 格与内容、5 次徒手
  破坏掉落、创造无掉落、oak/箱船像素差分轮廓、划桨动画差分）；回归 `test-minecart`
  11/11、`test-villager-trade` 14/14、`test-advancements` 7/7、`test-containers` 全过、
  `test-redstone` 28/28、`test-taming` 7/7、`smoke` 19/19。
- 剩余：气泡柱、划桨音效、船推挤其它实体、箱船战利品表、
  船桨在水面/陆地的粒子与音效、骑马/铁傀儡等后续 AI。

### 区块实体持久化（2026-11-23）

- 存档格式：`SavedChunkEntity`（`type / Pos / Rotation / Motion / Health / data`）写入区块
  NBT 的 `Entities` 列表（与 `block_entities` 并列）；`ChunkSerializer` 按原版实体 NBT
  的 `id + Pos + Rotation + Motion + Health` 读写，类型附加数据放在 `data`。
  `LevelChunk` 新增 `entities / entitiesDirty / hadEntities`。
- 保存：每个保存周期开始时 `Game.captureChunkEntities()` 把玩家保留带内的实体按区块
  分组写回 `chunk.entities` 并标记 `entitiesDirty`；`WorldSaveManager.beforeSave` 保证
  只在周期开头采集一次（否则移动中的实体会让分片 flush 永远写不完）。`flushDirty` 的
  脏条件加入 `entitiesDirty`，写完清空。采集排除村民与已驯服宠物（仍走世界级
  `villagers/pets` 存档，避免重复）。
- 卸载：`Game.unloadFarChunks` 在区块离开保留带前把该区块内的活实体快照写回并通过
  `WorldSaveManager.saveChunk` 立即持久化；`hadEntities` 标记保证“实体全部死亡后走远”
  也会把空列表写回，不会在下次读档复活。
- 加载：`restoreWorld` 把已保存区块标记为 `knownChunk`，阻止区块初始生物生成再刷一波，
  并把序列化字节保存在 `Game.savedChunkBytes`。区块离开保留带后，`ensureChunksAround`
  发现缺失区块时先从该缓存解码恢复（每 tick 最多 2 个，避免传送卡帧），而不是按种子
  重新生成；恢复的区块仍然可以再次卸载/重载。每 tick `activateSavedChunkEntities()` 对
  进入渲染距离的区块生成其 `Entities` 并清空内存列表。恢复内容：生物类型/位置/朝向/
  速度/生命/年龄/羊羊毛色与剪毛状态；矿车与船的 27 格箱内物品；掉落物物品与组件；
  经验球数值。
- 验证：`tsc` 0；`node scripts/test-entity-save.mjs` **11/11**（在天空隔离场地放置牛/羊/
  箱船/箱矿车/掉落钻石/经验球，走完整 `autosave.flushNow` 后用 `?world=` 重载，逐项核对
  数量、生命、坐标、物品与经验值；断言没有重复生成；再传送到 1024 格外并确认区块已卸载，
  返回后从保存字节恢复方块与实体）；回归 `test-minecart` 11/11、`test-boat` 16/16、
  `test-villager-trade` 14/14、`test-taming` 7/7、`smoke` 19/19。
- 剩余：箭/投掷物/TNT 等瞬时实体的存档、实体装备/药水效果等 NBT 长尾待补。
- 2026-11-28 启动提速（大世界）：`WorldSaveManager.loadWorld` 不再把 IndexedDB 里
  全部区块字节读进内存（`LoadedWorld.chunks` → `chunkKeys`），块键用
  `getAllKeys` 只取键（不再反序列化每块字节），新增
  `readChunkBytes(cx,cz)` 按需读取；`restoreWorld` 只同步读取/解码玩家周围 5×5
  区块（从存档玩家坐标出发，先于 `ensureChunk`，避免把存档覆盖成重新生成），
  其余区块由 `ensureChunksAround` 每 tick 最多取 2 个（读取→下 tick 解码），
  失败则删键回退到正常生成。验收：`tsc` 0、`test-save` **49/49**（含新的
  chunkKeys 断言）、`test-entity-save` **11/11**（远行返回时区块确实从
  IndexedDB 按需读取恢复）、`test-boot-time` 3/3（新世界 ~2.6–3.1 s 到
  Ready，同步存档恢复 ≤25 区块）。

### 铁傀儡 + 村民繁殖（2026-11-28）

- 铁傀儡：新增 `IronGolem`（`animal/golem` 对应目录 `animal/IronGolem.ts`）。属性
  100 生命 / 0.25 速度 / 15 攻击 / 1.0 击退抗性；`doHurtTarget` 用原版
  `attackDamage / 2 + rand(attackDamage)` 随机伤害并给目标 0.4 上抛，`attackAnimationTick`
  驱动双臂下砸；目标选择为 `HurtByTarget` + 16 格内 `MONSTER` 类别（排除苦力怕；
  `PlayerCreated` 时不把玩家设为目标）；`mobInteract` 铁锭治疗 25；掉落 3–5 铁锭 +
  0–2 虞美人。
- 生成图案：`CarvedPumpkinBlock.onPlace` 的三行图案（`~^~ / ### / ~#~`）在
  `Game.useItem` 的方块放置成功后检查；校验四周空气与南瓜/南瓜灯，清空 4 个铁块与
  南瓜并在南瓜位置生成 `PlayerCreated` 铁傀儡。
- 渲染：`IronGolemModel`（128x128）逐盒转录 + `setupAnim`（三角波手臂/腿、攻击、
  献花姿势）；`IronGolemCrackinessLayer` 按生命比例绑定低/中/高三张裂纹贴图；
  阴影半径 0.7；`AnimContext` 新增 `attackTicksRemaining` / `offerFlowerTick`。
  `PlayerCreated` 随区块实体存档持久化。
- 村民繁殖：食物点模型（`bread 4 / potato·carrot·beetroot 1`，上限 24），每 10 tick
  扫描 1.5 格内的掉落食物并吸收；`canBreed()` = 12 点 + 成年；`isInLove()` 对
  可繁殖村民返回 true，复用通用 `BreedGoal` 配对；`breedWith` 双方各消耗 12 点、
  进入 6000 tick 冷却，按 50% 当前生物群系 / 25% 父 / 25% 母 决定皮肤，生成
  `age = -24000` 的宝宝并播放爱心/计入 `animals_bred`。
- 宝宝渲染：新增 `BabyVillagerModel`（64x64，原版 `createBodyModel` 逐盒转录），
  `MobRenderer.getModel` 对幼年村民改用宝宝网格，类型叠加层同样用宝宝网格 +
  `villager/baby/<type>` 贴图，基层 `villager/villager_baby`；村民 `setAge` 不再套用
  通用 0.5 缩放，碰撞箱按 `BABY_DIMENSIONS` 覆盖为 0.49×0.98（眼高 0.63）。
- 存档：`SavedVillager` 增加 `age` 与 `foodPoints`，读档恢复宝宝年龄与食物点。
- 验证：`tsc` 0；`node scripts/test-golem-villager.mjs` **22/22**（真实右键放置触发
  图案、清空方块、`PlayerCreated`/100 生命、20% 生命绑定 high 裂纹贴图、铁锭治疗、
  傀儡击杀僵尸且不锁定创造玩家、面包拾取 12 点、两村民繁殖出宝宝、父母扣 12 点并
  进入冷却、宝宝网格/贴图/0.49×0.98 尺寸、傀儡与宝宝受控场景像素差分、存档重载
  食物点与宝宝年龄）；回归 `test-villager-trade` 14/14、`test-entity-save` 11/11、
  `test-boat` 16/16、`smoke` 19/19、`npm run build`。
- 剩余：铁傀儡献花层（虞美人方块层）、村庄八卦/睡眠触发自然生成铁傀儡、繁殖需要
  空床的规则、农民收割与村民分享食物。

### 村民农业与食物共享（2026-11-28）

- 农民工作：新增 `FarmerHarvestGoal`（`HarvestFarmland`）——职业为 farmer 时在 8 格内
  寻找 `CropBlock.isMaxAge` 的作物（小麦/胡萝卜/马铃薯 age 7、甜菜根 age 3），走近到
  1.5 格内收割。收割按原版掉落模拟：小麦 +1 且种子 0–3；胡萝卜 1–4、马铃薯 1–4、
  甜菜根 1–3。可补种时立即以 age 0 放回（小麦消耗 1 种子，其它作物消耗 1 个收获物）。
  收割后 40 tick 冷却。
- 面包：`WorkAtComposter` 的简化——农民每 20 tick 把 3 小麦烤成 1 面包（4 食物点），
  与食物点/繁殖系统共用 `foodPoints`（上限 24）。
- 食物分享：`TradeWithVillager`——食物点 ≥24 的村民每 20 tick 扫描 4 格内的村民，
  把面包单位（4 点）转给食物点 <12 的目标，最多补到 12 点；这让村庄可以在没有玩家
  投喂的情况下自行维持繁殖。
- 存档：`SavedVillager` 增加 `wheat` / `seeds`，读档恢复农民库存。
- 音效/粒子：`MobWorld.onVillagerFarm` 回调，`Game` 播放 `block.crop.break` 与
  `entity.villager.work_farmer`，破碎粒子走 `breakEffects`。
- 验证：`tsc` 0；`node scripts/test-village-life.mjs` **8/8**（24 点村民向饥饿村民
  转移 12 点、9 株成熟作物中 6 株被收割并补种、食物点增长、面包烘焙不积压小麦、
  食物/小麦/种子库存经 `autosave.flushNow` + `?world=` 重载）；回归
  `test-villager-trade` 14/14、`test-golem-villager` 22/22。
- 剩余：昼夜作息/床与睡眠、农民 `UseBonemeal`、堆肥桶产出骨粉、工作站点走路聚集、
  玩家破坏耕地的 AI 反应。

### 怪物装备与稀有掉落（2026-11-28）

- 护甲：`Monster.equipRandomArmor` 逐行移植 `Mob.populateDefaultEquipmentSlots`（普通
  难度 special multiplier 1.0）——15% 触发；材质 `randInt(3)` 后三次 10.87% 进位，
  对应皮革/铜/金/锁链/铁/钻石六档（26.2 新增铜甲）；按头→胸→腿→靴顺序，每个后续槽
  25% 概率停止（原版的“partialChance 停止”语义）。
- 武器：僵尸/尸壳 1% 铁剑(1/6)/铁矛(1/6)/铁锹(4/6)；骷髅/流浪者/沼泽骷髅/焦骸弓 +
  15% 护甲；凋灵骷髅只持石剑、不生成护甲；溺尸 10% 三叉戟(10/16)/钓竿(6/16) +
  3% 鹦鹉螺壳副手；僵尸猪灵 19/20 金剑、1/20 金矛。
- 稀有掉落：`Game.MOB_LOOT` 支持 `chance / 每级抢夺加成 / 仅玩家击杀` 三个新维度：
  僵尸与尸壳 2.5% 铁锭·胡萝卜·马铃薯（每级抢夺 +1%），溺尸 11% 铜锭 1–3（每级 +2%），
  凋灵骷髅 2.5% 骷髅头（每级 +1%）；环境死亡不掉落玩家专属稀有物；着火时马铃薯
  熔炼为烤马铃薯。
- 验证：`tsc` 0；`node scripts/test-mob-equipment.mjs` **13/13**（400 只僵尸的护甲
  头/胸/腿/靴分布与材质集合、1% 武器池、200 骷髅弓、120 凋灵骷髅石剑无甲、300 溺尸
  武器/鹦鹉螺壳、100 僵尸猪灵金剑/金矛；300 僵尸玩家击杀稀有掉落、100 环境死亡无稀有、
  300 凋灵骷髅头、200 溺尸铜锭）；`npx tsx scripts/test-entities.mts` 全过。
- 剩余：非骷髅类人形生物的通用主手物品渲染（僵尸剑/溺尸三叉戟/猪灵金剑目前只影响
  掉落，不显示在手）、附魔装备生成、僵尸增援/敲门、溺尸三叉戟投掷与鹦鹉螺坐骑。

### 爆炸模型重写（2026-11-28）

- 方块破坏：`Game.explode` 不再使用 `power * 2` 球体，而是逐行移植
  `ServerExplosion.calculateExplodedPositions`——16³ 边界 1352 条射线，每条初始
  `radius * (0.7 + rand * 0.6)`，每 0.3 格扣 `(爆炸抗性 + 0.3) * 0.3` 再扣固定
  0.225；只有仍有余量的方块被破坏。TNT（power 4）在泥土里形成约 4 格半径的弹坑，
  在石头里只炸掉紧贴中心的少量方块；同时按 `ServerLevel.explode` 的 block interaction
  区分 TNT / mob（mobGriefing）两类爆炸。
- 伤害：生物/玩家伤害与击退仍用 `radius * 2` 的衰减距离（与原版 `getEntityDamageAmount`
  一致），现在与方块破坏半径分开。
- 掉落衰减：新增 `GameRules.tnt/mob_explosion_drop_decay` 默认值（true）与
  `ApplyExplosionDecay`——每个掉落物品以 `1 / radius` 概率保留（TNT 25%、苦力怕
  33%），再走 `ItemEntity` 掉落。
- 归属：`PrimedTnt.owner` / `setOwner`；打火石点燃的 TNT 记录玩家，爆炸伤害用 owner
  作为攻击者，因此 `lastHurtBy`、击杀统计与玩家专属稀有掉落都能正确记到玩家；连锁
  TNT 继承爆炸的间接来源。
- 验证：`tsc` 0；`node scripts/test-explosion.mjs` **6/6**（15×7×15 泥土立方 222 块
  被毁、最远 4.12 格、54 个掉落；同尺寸石头立方仅 25 块；玩家点燃的 TNT 把 100 血
  铁傀儡打到 72.6 且 `lastHurtBy` 为玩家）；回归 `test-redstone` 28/28、`smoke` 19/19。
- 剩余：`getSeenPercent` 方块遮挡对伤害/击退的削减、爆炸掉落堆叠合并、TNT 矿车、
  爆炸击退对玩家的 `hurtMarked` 处理。

### 村民睡眠与村庄铁傀儡（2026-11-28）

- 睡眠日程：新增 `VillagerSleepGoal`——time 12000–24000（`Villager.isNight`）时在 32 格内
  扫描 `*_bed`，把 head/foot 两半统一成床头坐标并登记 `CLAIMED_BEDS`（一床一人），
  以 0.5 速度走到两格床中心，距离 <1.5 后 `Villager.startSleeping`：位置吸附到两格床中心、
  关闭重力、清空速度、停止 AI，并记录 `lastSleptGameTime`。
- 醒来：日出（time 回到 0–12000）、床方块被破坏或受到伤害时 `wakeUp`，恢复重力并释放
  床的认领；睡眠期间 `serverAiStep` 冻结移动与目标。
- 躺姿：`EntityRenderer.rootMatrix` 增加睡眠分支
  `T(pos)·S·RY(sleepYaw)·RX(-90°)·T(0,-h/2,0)·ROOT`，身体沿床头方向水平躺在两格床上；
  `Villager.sleepYaw` 由床的 `facing` 计算。
- 村庄铁傀儡：`Game.tickVillageGolemSpawn` 每 20 tick 统计 `lastSleptGameTime` 在最近
  24000 tick 内的村民；≥5 人且 32 格内没有存活铁傀儡时，在村民质心 ±10 格随机尝试
  10 个 `getHeight+1` 的 3 格空气落点，生成非 `playerCreated` 的铁傀儡并清空这些村民
  的睡眠记忆（下一次需要重新睡一觉）。
- 验证：`tsc` 0；`npm run build`；`node scripts/test-villager-sleep.mjs` **13/13**
  （白天站立为高瘦剪影、夜里走到床边入睡且 y=床+0.8/无重力、躺姿像素包围盒横向
  174×66、单床只容一人、日出唤醒并释放床、5 个睡眠记忆村民生成非玩家铁傀儡且
  记忆清零）；回归 `test-village-life` 8/8、`test-golem-villager` 22/22、
  `test-villager-trade` 14/14、`smoke` 19/19。
- 剩余：工作/聚集时段（白天工作站点聚集、钟声会议）、袭击/流浪商人、床的 `occupied`
  状态与 POI 全量、睡眠状态跨存档（当前读档后夜里会重新入睡）。

### 村民日程与村庄 POI（2026-11-28）

- 日程：`VillagerSchedules.VILLAGER_DEFAULT` 的时钟窗口落地为 `Villager.getSchedulePhase()`：
  wake 0–10 / work 10–3000 / meet 3000–6000 / idle 6000–9000 / work 9000–12000 /
  sleep 12000–24000；睡觉判定复用该阶段。
- 工作：`VillagerWorkGoal`（优先级 3，MOVE+LOOK）在工作时段把有职业的村民带回
  16 格内已认领的工作站点，走到 1.5 格内停下并面向站点；农民 `FarmerHarvestGoal`
  仍是更高优先级（2），没有成熟作物时才回站点站立。`HarvestFarmland` 现在只在
  work 阶段运行（原版 Activity.WORK）。
- 会议：`VillagerMeetGoal`（优先级 3）在 meet 时段扫描 32 格内的钟方块（每 100 tick
  节流），村民走向钟并按实体 id 在半径 2.2 格上错开站位；钟被破坏或进入其它阶段时退出。
- 村庄 POI：`VillageGenerator` 的房屋在门对面墙边放红床（头/脚朝向按门方向计算），
  并在室内角落随机放 12 种工作站点之一（composter/lectern/barrel/blast_furnace/
  smoker/cartography_table/fletching_table/cauldron/grindstone/loom/smithing_table/
  stonecutter）；井边广场加一个石台 + 钟，作为会议聚集点。
- 验证：`tsc` 0；`npm run build`；`node scripts/test-village-schedule.mjs` **9/9**
  （工作时段两村民认领职业并站到各自站点 1.1 格内、时钟→阶段映射、会议时段聚集到
  钟 0.7/1.6 格、会议时段不收割、切回工作时段收割并返回站点）；`test-worldgen` 新增
  检查 10——真实种子生成的平原村庄含 1 个钟、8 个床方块、4 个工作站点；回归
  `test-village-life` 8/8（改为工作时段）、`test-villager-sleep` 13/13、
  `test-golem-villager` 22/22、`test-villager-trade` 14/14、`smoke` 19/19。
- 剩余：工作动画/音效与 POI 全量（床 `occupied`、工作站点头部朝向）、地图交易、
  流浪商人、袭击、钟的交互与村庄英雄。

### 流浪商人与商人羊驼（2026-11-28）

- 生成：`WanderingTraderSpawner` 按 26.2 `CustomSpawner` 移植——每 1200 tick 结算一次，
  `spawnDelay` 每次 -1200，归零后重置 24000、概率 +25（25→75）；`rand(100) <= chance`
  通过后执行 1/10 尝试。参照点取玩家 48 格内最近的钟（会议 POI），没有则用玩家位置；
  10 次随机列 + `ON_GROUND` 校验 + 2x3x2 空间检查；成功后生成 1 个流浪商人，并在
  4 格内生成 2 只商人羊驼。
- 商人：9 条报价＝`wandering_trader/buying` 2 条 + `uncommon` 2 条 + `common` 5 条
  （26.2 TradeSet 数据由 `scripts/build-villager-trades.mjs` 生成到
  `data/wandering_trader_trades.json`，集合内不重复；附魔铁镐那种需要战利品函数过滤的
  报价暂跳过）；药水成本按 `potion` 组件匹配；没有等级条/补货；交易时冻结 AI；
  48000 tick 内未交易则消失（DespawnDelay 随存档）。
- 羊驼：`Llama` / `TraderLlama` 实体（4 种毛色、30 生命），`LlamaModel` + 0.5 膨胀的
  `LlamaDecorModel`（`equipment/llama_body/trader_llama` 蓝色毯层）；本移植没有拴绳
  渲染/物理，改用 16 格内跟随商人的 FollowTraderGoal；DespawnDelay 跟随商人一起消失。
- 资源：`build-sounds.mjs` 增加 wandering_trader 事件（ambient/yes/no/hurt/death/trade/
  disappeared/reappeared/drink_milk/drink_potion）；vite 构建复制新的交易 JSON。
- 验证：`tsc` 0；`npm run build`（dist 含 `data/wandering_trader_trades.json`）；
  `node scripts/test-wandering-trader.mjs` **15/15**（延迟周期、1 商人+2 羊驼、9 报价、
  48000 延迟、贴图/毯层、渲染像素、界面标题/无等级条、翡翠报价购买、羊驼跟随、同步
  消失）；回归 `test-villager-trade` 14/14、`test-villager-sleep` 13/13、
  `test-village-schedule` 9/9、`test-mobs-render` 20 项全过、`smoke` 19/19。
- 剩余：夜间隐身/白天喝牛奶现身、拴绳渲染与物理、商人羊驼吐口水/箱子/骑乘、袭击与
  不祥之兆。

### 帧率上限真正生效（2026-11-28）

- 视频设置的「最大帧率」此前只是 UI，实际一直按显示器刷新率无上限渲染（165Hz 屏约
  165fps）。现在按 `Options.FRAMERATE_LIMIT` 在主循环里用累计时间跳帧：只有到期的帧才
  执行完整 `render()`，输入、20Hz tick 与区块流式仍每个 rAF 推进。
- 默认值改为原版 120；30/60/120/144/240 档位现在都会真实生效；显示器刷新率仍是无上限
  帧率的天花板（rAF + vsync）。
- 性能采样器的卡顿看门狗阈值随帧率上限缩放，避免用户主动设 30fps 时误报「卡顿采样」；
  报告头会记录当前帧率上限。
- 验证：`tsc` 0；`node scripts/test-fps-limit.mjs` **7/7**（60Hz headless 下 30 档实测
  29.9fps、tick 仍 61/3s；120/240 档被 60Hz 屏幕限制在 59-60fps；HUD fps 显示同步）。

### 爆炸遮挡（2026-11-28）

- 移植 `ServerExplosion.getSeenPercent`：对每个受爆炸影响的生物 AABB 按原版网格采样
  （步长 `1/(2*尺寸+1)`），每条采样线段用 DDA 与方块碰撞体求交；未遮挡比例同时缩放
  伤害与击退。
- 伤害改为原版口径：距离用实体脚部到爆炸中心 `/(power*2)`，`pow=(1-dist)*exposure`，
  `((pow²+pow)/2)*7*(power*2)+1`；玩家使用同一套曝光与击退。
- 验证：`tsc` 0；`node scripts/test-explosion.mjs` **10/10**（新增：墙后 exposure=0、
  开阔=1；墙后僵尸/玩家仅 1 伤害，开阔僵尸/玩家 10.38；原有弹坑/抗性/掉落衰减/归属
  全过）。

### 进度树（2026-11-28）

- `AdvancementManager.layout(root)`：按 `AdvancementTree` 的网格布局生成节点——深度即
  列，叶子领取下一行，父节点取首/末子节点行的中点；隐藏的中间父节点被跳过，子节点挂到
  最近的可见祖先；根标签固定为原版顺序 story/nether/end/adventure/husbandry。
- `AdvancementsScreen` 从分页列表改为 252x140 树窗口：26x26 任务/目标/挑战边框、
  L 形连接线（`extractConnectivity` 的 parent centre → splitX → child centre）、
  图标、悬停标题/描述 tooltip、拖动与滚轮平移、内容溢出时绘制横向/纵向滚动条。
  仅图标入树，标题不再常驻绘制（与原版一致，避免长中文标题互相压字）。
- 验证：`tsc` 0；`node scripts/test-advancements-tree.mjs` **8/8**（五标签顺序、story
  16 节点/深度 8、7 个多子父节点全部居中、拖动与滚轮平移及越界钳制、切标签重建）；
  回归 `test-advancements` 7/7。

### 审阅修复与画质开关（2026-11-28）

- 存档安全：`flushDirty` 改为事务成功后才清除脏标记并登记 `savedKeys`（失败批次会重试，
  写入期间新增 section 保持脏）；`entitiesActive` 门控避免未激活区块被空实体列表覆盖；
  玩家快照覆盖 0–42 槽（盔甲/副手/鞍）；流浪商人报价与使用次数随区块记录保存；村民与
  驯服宠物使用世界级快照（卸载前记录、回载重生、死亡清除）。
- 玩法：`Mob.tick` 补调 `tickDamageOverTime()`，亡灵在日照下真正燃烧掉血；方块变化后
  按 `canSurvive` 移除失去支撑的短草/高草/甘蔗/火把等并掉落；创造/旁观玩家在受击后也
  不会被反击或近战续追。
- 画质：视频设置新增 TAA / 动态分辨率 / 植被摆动开关，默认 TAA 与摆动关闭；甘蔗、
  竹子、仙人掌的摆动权重改为按"世界高度 − 列基"连续计算，整列一起弯折，不再在方块
  接缝处撕裂。
- 验证：`tsc` 0；`test-review-fixes` **9/9**、`test-video-toggles` **3/3**、
  `test-entity-save` 11/11、`test-villager-trade` 14/14、`test-wandering-trader` 15/15、
  `test-mesher` 64/64。

### Complementary Reimagined r5.9.3 水面反射 / 天空移植（2026-11-28）

按用户上传的 `ComplementaryReimagined_r5.9.3.zip` 源码逐段移植（默认档
`SHADER_STYLE 1` / `WATER_STYLE 1` / `WATER_REFLECT_QUALITY 2` / `DETAIL_QUALITY 2` /
`RAIN_PUDDLES 0`，不再凭记忆）：

- `lib/materials/materialMethods/reflections.glsl` Method 1：30 步屏幕空间光追 + 6 次
  细化（`err*0.33333 < |vector|` 时步长回退 ×0.1 再 ×2 增长）、`rEdge` 0.6/0.55 边界、
  `border=1-max(cdist)^50`、`edgeFactor` 八次方衰减与按亮度取幂的 `refFactor`、
  `lViewPosRT-lViewPos+3` 的距离淡出；命中颜色直接取水前场景快照。
- `reflectionBackground.glsl` + `lib/atmospherics/sky.glsl GetSky()`：反射光线未被深度
  缓冲命中时，用完整天空模型求值——up/middle/down 三段渐变、日落色带、太阳眩光
  （`glareScatter`/`visfactor`/`shadowTime`）、地面散射、Bayer64 抖动；乘
  `GetSkyLightFactor`（`max(lmY-0.7,0)*3.3333` 平方，水面下限 1/3）。
- `water.glsl` + `gbuffers_water.glsl`：`fresnel=clamp(1+dot(normal,nViewPos),0,1)`、
  `fresnelM=(fresnel³*0.85+0.15)*reflectMult`；水体 alpha 先 `sqrt1(tex.a)`、按水面到
  水下不透明面的深度差 `1-exp(d*0.075)` 做水雾不透明度、再 `mix(alpha,1,fresnel⁴)`；
  默认档无波法线（`RAIN_PUDDLES 0`），即平面镜面水。
- `lib/lighting/ggx.glsl`：GetNoHSquared + GGX 高光，`highlightColor`、
  `highlightMult=(16-15*fresnel²)*(日/夜 0.85/0.425)`、`invRainFactor` 全部按 pack 取值。
- 天空 pass（`SkyRenderer`）：用同一个 `GetSky()` 替换原版平面天穹色；白天/黄昏
  渐变与眩光由 pack 公式给出，原先固定白色的日出扇形光晕（只用了 alpha）已删除。
- `ComplementSky.ts` 在 TS 侧逐行翻译 `skyColors.glsl` /
  `lightAndAmbientColors.glsl`（`sunFactor`/`sunVisibility`/`noonFactor`/`nightFactor`
  由 `visual/sun_angle` 驱动），GLSL 侧共用同一段 `COMPLEMENT_SKY_GLSL`。
- 验证：`tsc` 0；`node scripts/test-water-reflect.mjs` **7/7**（着色器编译、水面掩码
  38.1%、SSR 命中 99.9%、开关光影水面像素 99% 改变 meanDiff 41.4、GL error 0、
  黄昏路径无错）；回归 `test-review-fixes` 9/9、`test-video-toggles` 3/3。
- 2026-11-28 补：水折射（refraction.glsl `DoRefraction`，仅 high/ultra 档，
  对应 `DETAIL_QUALITY>=3`）——`uSceneColor` 折射采样替换水下背景再按 alpha
  合成，噪声/深度差公式逐行照抄；`test-water-refraction` **4/4**
  （high 档噪声开关差 32573 px、medium 档 0 px）。`LevelRenderer.waveTimeOverride`
  是探针用的水波时钟冻结钩子（默认 null = 实时）。
- 仍未完成：水下焦散、天空的云与星空进入反射（pack 默认
  `DETAIL_QUALITY>=3` 才开 `SKY_EFFECT_REFLECTION_TRANSLUCENT`）、景深、
  完整 gbuffer 管线。

### 创造背包 / 玩家预览 / 创造飞行 / 粒子染色（2026-11-28）

均以仓库内 `_src/thirdparty/.../src-vanilla` 的 26.2 Java 源码为准（不再按记忆）：

- 创造背包 Survival Inventory 页（`CreativeModeInventoryScreen.selectTab(Type.INVENTORY)`）：
  2x2 合成格与结果槽移到 (-2000,-2000) 隐藏；盔甲槽 `(54 + col*54, 6 + row*27)`；
  副手 `(35,20)`；主背包 `y=54/72/90`、热栏 `y=112`；面板保持 195x136，
  背景切到 `tab_inventory`；搜索页用 `tab_item_search`，其余页 `tab_items`；
  搜索按本地化显示名（`item.minecraft.*`/`block.minecraft.*`）匹配并支持 `#tag`
  （`tags.json.item`），进入/离开搜索页都会清空输入；`Search Items` 页无物品时画
  `scroller_disabled`。
- 玩家 3D 预览：`InventoryScreen.extractEntityInInventoryFollowsMouse` 的
  `xAngle=atan((cx-mx)/40)`、`yAngle=atan((cy-my)/40)`、`bodyRot=180+xAngle*20`、
  头相对转角 `xAngle*20`、抬头 `-yAngle*20`；同步 `yRotO/yBodyRotO/yHeadRotO/xRotO`
  （此前 partialTick=0 从 0 插值，预览根本不随鼠标转）；GUI 用全亮光照
  （`Lighting.Entry.ENTITY_IN_UI`）；盔甲槽内容随预览渲染；创造背包预览框改到
  `(73,6)-(105,49)`。
- 创造飞行：`delta.y += inputYa * 0.05 * 3` 后乘 0.6（`LocalPlayer.aiStep` +
  `Player.travel`），不再直接赋 ±0.5395；首 tick 0.09、终速 ±0.225。
- 方块破碎粒子：按 `BlockTintSource.colorAsTerrainParticle` 取群系草色/叶色，
  草方块按 Java 返回 -1（保持 dirt 原色），红石线按 power；`BRIGHT_CAVE_WATER`
  等 pack 光照补偿仍待完整 gbuffer。
- 验证：`tsc` 0；`test-creative-inventory` **10/10**、
  `test-player-motion` **6/6**（飞行三速 + 草/草方块粒子色）、
  `test-water-reflect` 7/7、`test-mob-equipment` 13/13。

### 掉落物渲染（2026-11-28）

- `ItemEntity.getSpin(age, bobOffs)` 是 `age/20 + bobOffs` 弧度；旧代码
  `(age/20)*2π` 让掉落物 20 tick 转一整圈，现按 `ItemEntity.java:429` 修正。
- bob 高度补 `ItemEntityRenderer.ITEM_MIN_HOVER_HEIGHT = 0.0625`。
- 堆叠数量按 `ItemClusterRenderState.getRenderedAmount` 渲染 1–5 份：
  扁平模型沿局部 Z 以 0.09375 排开，后续份再叠加 ±0.075 的随机 X/Y
  （`RandomSource.setSeed(itemId + damage)`；`EntityRenderer.appendModel`
  增加世界偏移参数）。
- 验证：`tsc` 0；`node scripts/test-item-entity.mjs` **13/13**
  （block/flat 分流、地面展示变换、5 份/1 份、床 composite 双层、紧裁切截图可见 + 旋转）。
- 块状掉落物 3D 模型（2026-11-28）：`WorldItemRenderer` 世界空间 pass，用
  `models.bin` 烘焙方块几何 + 方块纹理数组绘制，姿势逐项对
  `ItemEntityRenderer.submit`/`ItemStackRenderState.LayerRenderState.applyTransform`：
  `T(0, bob + (-bounds.minY + 0.0625), 0) * RY(getSpin)`，随后
  `ItemTransform.apply(GROUND)`（`block/block` = 平移 3/16、缩放 0.25；
  `item/generated` = 2/16、0.5）与床 composite 的逐层 `transformation`
  （`T * Rleft * S * Rright`）；包围盒按变换后的模型顶点计算，`zSize > 1/16`
  走 ±0.15 随机 XYZ 的 3D 堆叠分支、更薄的模型走局部 Z 排开分支。
  图标 sprite 路径对 block 物品跳过（不再画第二份平面图标）。
  展示变换由 `scripts/build-display.mjs` 从 26.2 模型 JSON 的父链烘焙
  （`public/mc/hand/display.json` 的 `grounds`，1366 条）。
  物品/经验球阴影强度按原版补 0.75。
  验证：`tsc` 0；`test-item-entity` **13/13**（grass_block zSize 0.25 /
  minY 0.0625 / ground 0.25,3/16；64 堆叠 5 份 3D；sprite 0 份；
  白床 composite 两层 + foot transformation；紧裁切 260x240 截图改动 2854 px、
  10 tick 后 3360 px 全部落在物品 bbox 内）。
  截图：`shots/diag/item-entity-block.png`（草地上可见立体草方块）。
- 未完成：个别方块模型仍走图标 sprite（chest 等 `special` 条目）；

### 唱片机 / 音乐资源（2026-11-28）

- 音频资源已确认在库：`public/mc/sounds/index.json` 有 53 个 `music*` 事件，
  `music.game`、`music.menu`、全部 `music_disc.*` 都指向真实 ogg（此前注释
  “pack ships NO music” 已过期，改为直连）。
- `JukeboxBlock.useItemOn`：右键插入唱片 → `has_record=true`、播放
  `music_disc.<song>`（音量 4，RECORDS 分类）、非创造消耗唱片、`play_record`
  统计；空手右键播放中的唱片机 → `has_record=false`、停播并掉回唱片；
  破坏播放中的唱片机停播并掉出唱片。`SoundEngine.play` 返回可 `stop()` 的句柄。
- 比较器输出（2026-11-28）：`JukeboxBlockEntity.getComparatorOutput` =
  `JukeboxSong.comparatorOutput`，数据从 26.2 的
  `data/minecraft/jukebox_song/*.json` 逐条读入 `data/jukebox_songs.json`
  （22 首，含 length/sound event）。`RedstoneHooks.jukeboxSignal` 按
  `has_record` + 该位置歌曲返回值；空唱片机按原版返回 0（`hasAnalogOutputSignal`
  恒为 true）。插入/弹出唱片已调用 `updateNeighbors`，比较器按 2 tick 计划
  刷新输出；`test-jukebox` 实测 cat=2 → 线 2/灯亮，弹出后回 0。
- 验证：`tsc` 0；`node scripts/test-jukebox.mjs` **6/6**、`test-redstone`
  **28/28**（真实事件存在、插入消耗/播放、cat 比较器输出 2、弹出掉落并回 0）。
- 方块实体持久化（2026-11-28）：插入唱片时写入
  `minecraft:jukebox` 记录（`record` 歌曲 + `ticks_since_song_started`），
  `beforeSave` 把当前播放进度写回；区块解码时 `restoreJukeboxRecords` 恢复
  `jukeboxSongs`（比较器输出），`resumeJukeboxPlayback` 用
  `AudioBufferSourceNode.start(0, offset)` 从保存的 tick 继续播放（等音频资源
  就绪后重试）。弹出/破坏唱片机时删除记录。验证：
  `test-jukebox-persistence` **8/8**（保存后 ticks=35、重载后 has_record/song/
  comparator=2 全恢复、offset≈70 tick、弹出后记录清空），回归
  `test-jukebox` 6/6、`test-entity-save` 11/11。
- 未完成：多台唱片机同时发声（引擎当前只保留一个可听句柄，重载时恢复最近的
  一台）。




