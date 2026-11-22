# 项目状态索引（2026-11-22）

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
| 水面 | ⚠️ | 顶点波 + Fresnel + SSR；反射只对屏幕内不透明场景，无折射/真实反射探针 |
| 体积光/体积云 | ❌ | 当前是 billboard 云与屏幕空间光轴，不是原版 26.2 体积实现 |
| 第一人称手/手持物 | ⚠️ | display transform 已按 JSON 移植；物品略偏大/贴边，待逐项对参考图 |
| 粒子 | ⚠️ | 方块破碎/环境粒子已有；粒子表覆盖不完整 |
| 菜单/设置页帧率 | ✅ | 2026-11-21 修：菜单打开时不再绘制被立即擦掉的 HUD；菜单泥土背景改为一次缓存 + 单次 `drawImage`；HUD 改为脏标记重绘。1600x900@1.5 下暂停页 10→56 fps、视频设置 12→60 fps，`screens` 59.5→1.0 ms/帧 |
| HUD 空转重绘 | ✅ | 同一份 HudState 不再每帧重画；静止时 0 次 `hud.render`（`test-hud-dirty`）。聊天/Toast/受伤/切槽/缩放会立即触发一次 |
| 物品图标降级路径 | ✅ | `createImageBitmap` 不可用时不再从 3200² 图集直接 `drawImage`（真实环境曾 90 ms/9 个图标），改为按物品缓存小画布 |

### 实体
| 项 | 状态 | 说明 |
|---|---|---|
| 25 种可渲染生物 | ✅ | 34 个 mob 工厂 + 数据驱动模型；变体共用基础模型/贴图；`test-mobs-render` 20 项 |
| 羊的羊毛层 | ✅ | 2026-11-21 修：`SheepFurModel` + DyeColor tint + 随机毛色；剪毛后隐藏（测试 [20]） |
| 骷髅弓 | ✅ | 2026-11-21 修：弓弦从瞄准方向正面翻到射手一侧 |
| 生物装备/手持物 | ✅ | 主手物品层（骷髅弓/凋灵骷髅石剑）+ 人形四层护甲（equipment/humanoid 贴图） |
| 剪羊毛 | ✅ | 2026-11-21：剪刀右键羊 → `sheared`、掉落 1–3 个对应颜色羊毛、播放 `entity.sheep.shear`；重复点击不再掉落 |
| 鸡下蛋 / 投蛋 | ✅ | 成年鸡 6000–12000 tick 下蛋（幼鸡不下蛋）；投掷蛋落地/命中生物后 1/8 概率孵化幼鸡 |
| Q 丢弃物品 | ✅ | Q 丢 1 个 / Ctrl+Q 丢整组，40 tick 拾取延迟，`dropped`/`drop` 统计 |
| 繁殖 / 喂养 / 幼年 | ✅ | 牛/猪/羊/鸡/兔/猫/豹猫/蘑菇牛：食物标签、600 tick 恋爱、6000 tick 冷却、幼年 0.5 缩放与成长、繁殖 XP、幼年无掉落；幼年专用几何体未接 |
| 驯服（狼/猫） | ✅ | 骨头（狼）/生鳕鱼或鲑鱼（猫）1/3 驯服并消耗、`owner`、空白点击坐下/站起、坐下时停止 AI、驯服后不再以玩家为目标、`FollowOwnerGoal` 跟随并在 12 格外交互传送；驯服宠物随世界存档持久化；项圈渲染未接 |
| 村民 | ✅ | 2026-11-22：13 种职业工作站点认领（composter→farmer 等，单站点单村民）、职业等级/经验（0/10/70/150/250）、26.2 `trade_set → villager_trade` 数据生成的报价与补货、7 种生物群系皮肤 + 职业/等级叠加层、交易统计 `traded_with_villager`、`adventure/trade` 进度；职业/等级/报价/工作站点随世界存档持久化；`test-villager-trade` 14 项 |
| 更多 AI（铁傀儡、马、船、矿车） | ❌ | 实体工厂里没有这些类型 |

### GUI / 物品栏 / 容器
| 项 | 状态 | 说明 |
|---|---|---|
| 标题/世界选择/创建世界/暂停/选项/视频设置 | ✅ | `test-menu` 9 项 |
| 生存背包 / 创造物品栏 | ✅ | 官方 tab 精灵、滚动、搜索、tooltip、3D 预览 |
| 容器点击规则（左右键/Shift/拖拽/数字键/F/Q/双击） | ✅ | `test-containers` 19 项；`AbstractContainerScreen` |
| 合成台/箱子/熔炉/配方书 | ✅ | 真实配方、箱子会话内持久、熔炉 GUI 打开时推进 |
| 村民交易界面 | ✅ | `MerchantScreen` 276x166：7 行报价列表/滚轮与拖动滚动/悬停高亮、3 个交易槽、经验条、等级标题、缺货印章、折扣划线、玩家背包；`test-villager-trade` |
| 中文文案完整性 | ✅ | 2026-11-21 补齐 `menu.advancements`/`menu.stats`/`createWorld.create`/`selectWorld.difficulty` |
| 统计（Statistics）界面 | ✅ | General/Items/Mobs 三页、6 列排序、真实计数器（挖掘/放置/拾取/合成/击杀/死亡/伤害/距离/游玩时间） |
| 进度（Advancements）界面 | ⚠️ | 数据驱动：126 个定义（117 可见，5 个 root）；暂停菜单打开按 root 分页的列表界面（图标/完成色/Goal/Challenge/done-total）；触发器 `inventory_changed`/`mine_block`/`consume_item`/`player_killed_entity`/`killed_by_entity`/`location`（需 dimension）/`villager_trade`/`tick`，支持 entity_properties 的 `position.y` 上下限（trade_at_world_height）；完成弹 toast 并随存档保存。缺树状布局/连接线、完整条件（生物群系/结构/物品谓词/count/components）、配方解锁联动 |
| 统计计数器 | ✅ | `Statistics` 随玩家 `Extra.stats` 保存；挖掘/放置/拾取/合成/熔炉/击杀/死亡/伤害/移动距离/动物繁殖均有埋点 |
| 多人/LAN/资源包/皮肤设置/遥测 | ❌ | 按钮占位或没有入口 |

### 玩法
| 项 | 状态 | 说明 |
|---|---|---|
| 移动/跳跃/疾跑/飞行/游泳/碰撞 | ✅ | 含 step-up、双击飞行、疾跑 FOV |
| 挖掘/放置/生存（血量/饥饿/掉落/重生） | ✅ | |
| 合成/熔炼/箱子 | ✅ | 见上 |
| 剪刀（羊） | ✅ | 见「实体」；其他剪刀用途（树叶、藤蔓）未接 |
| 弓/箭（玩家） | ✅ | 蓄力/释放、箭消耗与弓耐久、命中 mob（含 owner 过滤） |
| 桶 / 打火石 / TNT | ✅ | 水/岩浆桶放置与装取、点火；TNT 点燃/引信/爆炸/连锁/BLOCK 破坏与生物伤害；红石信号点燃已接 |
| 钓鱼 | ✅ | 鱼竿抛竿/浮漂漂浮/5–25s 咬钩/收竿掉落（鱼 85%、垃圾 15%，海洋幸运才出宝藏）、1–6 XP、鱼竿耐久、`fish_caught` 统计 |
| 附魔台 | ✅ | 书架功率 0–15、三档等级花费、青金石消耗、按物品类别随机词条与等级、`enchant_item` 统计与音效 |
| 药水 / 酿造 | ✅ | 14 种药水 + 水/粗制/浓稠/平凡；红石延长、萤石强化、发酵蛛眼腐化；火药→喷溅、龙息→滞留；酿造台 3 瓶 + 原料 + 烈焰粉 20 燃料、400 tick；右键开酿造台；玻璃瓶装水；饮用应用效果并归还玻璃瓶；喷溅/滞留投掷物、距离衰减范围效果、滞留云（半径 3/600 tick/0.25 时长）；效果与 `potion` 组件随存档保存 |
| 状态效果 HUD | ✅ | 右上角一列 24x24 背景 + 18x18 图标、剩余时间、等级罗马数字；剩余 <10s 闪烁；中毒/凋零时心形变绿/黑 |
| 红石 | ✅ | 红石线功率/连接形状、拉杆/按钮/压力板、红石火把（反相 + 2 tick 调度 + 8 次/60 tick burnout）、中继器（1–4 档延迟/单向）、比较器（容器/蛋糕/堆肥桶模拟输入、侧输入、compare/subtract、2 tick）、侦测器（2 tick 脉冲）、日光探测器（天空光 + 太阳角 + 反相）、拌线/拌线钩、红石灯、木/铁门、活板门、栅栏门、TNT 信号点燃、活塞（普通/粘性，推/拉/12 格/不可推方块）、铁轨形状与动力轨供电；缺粘液/蜂蜜牵引链、活塞 moving_piston 动画、矿车物理、物品展示框/讲台/唱片机的比较器模拟输出 |
| 床睡觉 | ✅ | 夜晚/雷暴、8 格内无怪物、床上方无遮挡才能入睡；60 tick 后跳到次日清晨、清雨、设置重生点并持久化；黑屏淡入淡出；睡眠中禁止移动/挖掘/攻击 |
| 村民交易 | ✅ | 成年村民右键打开交易界面；报价成本/结果/使用次数、补货（每天 2 次）、等级提升追加报价；地图交易与流浪商人未接 |
| 成就（Advancements） | ⚠️ | 见「GUI」进度行：列表界面 + 8 类基础触发器（含 `villager_trade`）可用；树状布局与完整条件待补 |
| 经验球/掉落物 | ✅ | |

### 世界生成 / 存档
| 项 | 状态 | 说明 |
|---|---|---|
| 密度噪声地形 / 生物群系 / 含水层 / 地表规则 | ✅ | `NoiseChunkGenerator` |
| 树木/花草/矿/湖/甘蔗等 feature | ✅ | `features/` 22 种 |
| 村庄 | ⚠️ | 程序化近似，不是原版 NBT 模板；无其他结构 |
| 下界/末地/要塞/矿洞 | ❌ | 只有主世界 |
| 存档 | ✅ | IndexedDB 自定义分块存储；支持 `.mca` 区域导入/导出 |
| 有限/无限世界 | ✅ | 区块流式加载；不是 Anvil 全尺寸世界 |

### 音频 / 多人
| 项 | 状态 | 说明 |
|---|---|---|
| 原版音效事件 | ✅ | 959 个事件、4341 个 ogg；脚步按 SoundType |
| 音乐/唱片 | ✅ | 26.2 music/music_disc 事件与 ogg 资源已接入，按情境/唱片事件解析 |
| 多人 | ❌ | `bridge/` 未接线 |

## 5. 优先级队列

**P0（视觉/功能明显错误，先做）**
1. ~~实体装备层~~ ✅ 已完成：主手武器（骷髅弓/凋灵骷髅石剑）+ 人形四层护甲。
2. 第一人称手持物逐项对参考图微调：尺寸/位置/旋转（`HandRenderer.drawItem` + `public/mc/hand/display.json`）。
3. 水面远处/加载瞬间偶发灰色平面：本轮未复现，保留观察；复现后查水体层/光照贴图时序。

**P1（原版核心玩法缺口）**
4. ~~羊繁殖/幼年~~ ✅ 已完成通用动物繁殖（见实体表）；~~狼/猫驯服~~ ✅ 已完成驯服/坐下/跟随与宠物存档；剩余：幼年专用模型、项圈渲染、野生动物实体存档。
5. ~~玩家弓/箭、桶、TNT~~ ✅ 已完成；红石信号点燃 TNT 已接；剩余：药箭、TNT 归属（owner）与爆炸掉落衰减、比较器/活塞等红石长尾。
6. ~~统计界面~~ ✅ 已完成 General/Items/Mobs 三页与计数器；~~进度（Advancements）界面与基础触发器~~ ✅ 已完成列表界面 + 8 类触发器（含 `villager_trade` 与 Y 坐标谓词）；剩余：树状布局/连接线、完整 criteria 条件（生物群系/结构/物品谓词/count/components）、配方解锁联动。
7. ~~村民交易~~ ✅ 已完成职业工作站点、等级/经验、26.2 报价数据、补货、交易界面与存档；剩余：地图交易（需已填充地图/结构定位）、流浪商人、村民繁殖与铁傀儡、村民工作/睡眠日程。
8. 夜间怪物装备/掉落表与自然生成权重对齐（Looting/熟肉/装备掉落已完成）。

**P2（长尾一致性）**
9. 村庄结构换成原版模板/更接近的拼片；矿洞/要塞。
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
  矿车与探测铁轨实体检测、物品展示框/讲台/唱片机的比较器模拟输出（需要对应方块实体数据）、
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
