# HANDOFF-2 — 2026-11-08 白天接管记录（菜单/触屏回归 + §8-1 生物模型）

> 接在夜班 `HANDOFF.md` 之后。夜班交付（夜晚 1:1 + 光影）不变，这份只记白天这轮的增量与当前状态。

## 0. 一句话结论

夜班之后 Claude 因额度在 05:53 断掉，本 session 接管。已完成 **HANDOFF §8 的第 1、3 项**：
补全 12 种「有工厂没渲染器」的生物（不再隐形/不再被禁生成）、找回主菜单与世界选择、移植 Bedrock 触屏层。
`tsc` 0 错误、18 套单测全过、菜单回归 9 项 / 触屏回归 15 项全过、浏览器冒烟 19/19。**未 push**。

## 1. 怎么跑

```bash
cd G:\web_mc\webcraft26
npm run dev            # http://127.0.0.1:5174/   默认：26.2 风格主菜单
```

URL 参数：

| 参数 | 作用 |
|---|---|
| `?play`（或 `?preview`） | 跳过主菜单直接进世界（所有截图/测试脚本都用它） |
| `?touch=1` / `?touch=0` | 强制开/关触屏控制层（默认按 `pointer: coarse` 自动判断） |
| `?seed=<字符串>` | 启动种子（任意字符串，按 Java String.hashCode 处理） |
| `?world=<存档 id>` | 打开指定 IndexedDB 存档（世界选择/新建世界后由客户端自己带上） |

主菜单流程与 26.2 一致：Singleplayer → Select World（存档列表）→ Play / Create New World。
暂停菜单的「Save and Quit to Title」会先 flush 存档再回标题；标题屏期间世界 tick 和自动存档都是暂停的。

## 2. 本日做了什么

### 2.1 回归修复：主菜单 + 世界选择（commit `974d4b85`）

- 启动先进 `TitleScreen`（官方 logo / splash / 按钮 / 全景），`?play` 才直接进世界。
- Singleplayer → `SelectWorldScreen`（IndexedDB 存档列表，来自 `WorldSaveManager`）→ Play 进入：
  同一个世界直接 resume（不重新加载），不同世界带 `?world=…&seed=…` 重新加载。
- Create World：`CreateWorldScreen` 创建记录后重新加载并直接进世界（带新种子）。
- 「Save and Quit to Title」→ flush 自动存档 → 标题；标题期间 `worldActive=false`，世界不 tick。
- 修了 `PanoramaRenderer` 的一个致命 bug：六张全景图未解码完时用 `undefined` 颜色建渐变会抛异常，
  直接把 `requestAnimationFrame` 循环打死（标题屏白屏/冻结）——现在先退回面颜色，解码后再采样。
- `vite.config.ts` 的 watcher 忽略 `scripts/`（临时工具脚本被删除时 Windows `fs.watch` 会 EBUSY 崩溃）。
- 新增回归脚本：`scripts/test-menu.mjs`（9 项）。

### 2.2 回归修复：触屏控制（commit `974d4b85`）

- 移植 M2 的 `TouchControls` 到 `src/client/touch/`（摇杆 / 右侧视角 / 跳跃/潜行/挖掘/放置/背包/聊天/暂停 /
  飞行上下降 / 双击跳跃切换飞行 / 点热栏选格 / 安全区适配）。
- 接到当前输入模型：摇杆→`PlayerInput.forward/strafe`，按钮→jump/sneak/sprint，视角→yaw/pitch，
  挖掘按住时 `mining=true`（生存可连续挖），松开停止；触屏下不请求 pointer lock。
- 自动启用条件改成 `pointer: coarse`（触屏 Windows 笔记本的 `maxTouchPoints` 会误报，会挡住半屏）。
- 新增回归脚本：`scripts/test-touch.mjs`（15 项，含桌面 `?play` 不出现触屏层的反例）。

### 2.3 §8-1 生物模型（commit `f83247f1`，由 teammate 完成，Lead 复核）

- 12 种原本「有实体工厂但没渲染器」的生物补齐模型与纹理注册：
  slime、witch、cave_spider、zombie_villager、fox、cat、ocelot、parrot、squid、glow_squid、cod、salmon。
- 模型逐行对照本机反编译源（`G:\ck-web26\src-vanilla`，只读）的 `createBodyLayer()` / `setupAnim()`，
  `MeshTransformer` 的缩放（CAT 0.8 / CAVE_SPIDER 0.7 / WITCH 0.9375）在 `MobRenderer.EXTRA_SCALE` 补上。
- 注册进 `MODEL_REGISTRY` 后 `canRender()` 全 true，`Game.init` 第 315 行的「无渲染器 ⇒ factory=null」自动失效，
  自然生成恢复（Game.ts 一行没改）。
- 验证：`test-mobs-render.mts` 19/19；`shot-newmobs.mjs` 12/12 spawn、drawCalls=12、glError=0；
  证据 `REPORTS/overnight/evidence/mobs2-day.png` / `mobs2-night.png`；报告 `REPORTS/overnight/mobs2.md`（含 10 条近似说明）。

### 2.4 丢弃的并行改动

接管期间有 4 个夜班 session 自动重启并在同一工作区干活（详见 §5）。已归档/停止，改动处理：

- `renderer/environment` 的「太阳/月亮缩小 8 倍」改动**已回退**：它基于 `shots/ref/INDEX.md` 里已知错误
  的 FOV=70 记录（HANDOFF §3 明确：参考客户端实际 FOV=110；出改动前月亮 25×28 vs 原版 24×28 已对上）。
  缩小 8 倍会让太阳/月亮只剩 3~5px。
- `package.json`（assets 加 build-display）与 `public/mc/hand/display.json`（时间戳）**已回退**（未复核的 hand 包半成品）。
- 全部并行改动在工作区有快照：`G:\tmp\night-sessions-*.patch`（需要时可重放）。

## 3. 验证（本日复跑）

```bash
cd G:\web_mc\webcraft26
npx tsc --noEmit                         # 0 errors
for t in scripts/test-*.mts; do npx tsx $t; done   # 19/19 套 exit 0
npx tsx scripts/test-mobs-render.mts     # 19/19 PASS
npx tsx scripts/test-glmath.mts          # 6/6 PASS
node scripts/test-ao.mjs                 # SSAO 6/6 PASS
node scripts/test-taa.mjs                # TAA 8/8 PASS
node scripts/test-containers.mjs         # 容器交互 19/19 PASS
node scripts/test-ambience.mjs           # 洞穴环境音 6/6 PASS
node scripts/test-menu.mjs               # 9/9 PASS
node scripts/test-touch.mjs              # 15/15 PASS
node scripts/smoke.mjs                   # 19/19 PASS（默认 URL 已带 ?play）
```

## 4. 还没做 / 下一步（按价值）

1. **§8-2 光影进阶**：水面反射/折射、SSAO、TAA、体积光/云（现在只有 bloom/光轴/阴影/顶点水波）。
2. §8-4 已完成本轮可交付部分（容器真实交互 + 洞穴环境音，见 §4c）；剩余：漏斗等自动化、方块实体持久化。
3. 生存循环：饥饿效果、药水、附魔、红石；生物幼年变体与更多 §8 近似修正（见 `mobs2.md` 第 5 节）。
4. 夜晚对拍复核（M2 的 `shots/ref/INDEX.md` FOV 记录仍是错的，要么改 INDEX，要么重拍）。
5. Paper 桥接仍未接浏览器（按用户要求没动）。

## 4b. §8-2 进度（2026-11-08 上午，已交付 SSAO + TAA）

**关键根因（之前 SSAO 一直失败的原因）**：原版 GameRenderer.renderLevel 在画第一人称手之前会
gl.clear(DEPTH_BUFFER_BIT)（hand package 照抄了这个行为），所以后处理阶段读到的深度缓冲只剩手。
现在在 **世界渲染完、画手之前** 用 gl.blitFramebuffer(DEPTH_BUFFER_BIT) 把深度快照到独立纹理
（PostProcessor.captureDepth() / LevelRenderer.captureDepthForPost()，由 Game.render 调用），
后处理采样的是这份快照；TAA 因此把手视为 disoccluded（每帧用当前帧，不产生拖影）。

- **SSAO（深度差分）**：不新开 pass，直接在 composite 里做——8 方向 × 2 步采样，邻域线性深度更近即遮挡
  （uAoRadius 4px、uAoStrength 0.3，仅 high/ultra 档），整体轻微变暗约 5%，无矩阵/重建依赖，稳定。
  post.stats.ssao 可查；post.debug = 4 输出 AO 掩码（验证用）；低档位与 F6 关闭时完全不启用。
- **TAA（时间抗锯齿）**：世界用 Halton(2,3) 8 帧亚像素抖动投影；resolve pass 用当前深度 + 上一帧 viewProjection
  重投影历史帧，3×3 邻域裁剪防拖影，历史 ping-pong（RGBA16F，全分辨率）。仅 high/ultra 档启用；关闭时抖动为 0，
  Off 路径逐像素不变。实测静态帧收敛、边缘高频能量 -36%；相机转动 1.5s 内收敛；手部不进入历史（无手部拖影）。
  PostProcessor.taaOff 可做 A/B。
- **验证脚本**：scripts/test-ao.mjs（6 项：档位 gating、AO 掩码有真实遮挡、A/B 变暗、Off 关闭、F6 开关、无 GL 错误）；
  scripts/test-taa.mjs（8 项：gating、静态稳定、边缘能量下降、转动后收敛、低档/Off 关闭、恢复、无错误）。
- **仍未做**：水面反射/折射（需要二次场景渲染 + 裁剪面）、体积光/云；TAA 没有 per-object motion vector
  （移动生物靠邻域裁剪抑制拖影，未做完美）。


## 4c. §8-4 进度（容器真实交互 + 洞穴环境音，已交付）

- **右键打开**：`crafting_table` / `chest` / `trapped_chest` / `furnace` 走原版 `useItemOn` 优先级
  （潜行时退回放置行为）；打开前先由 `SurvivalState` 建好对应的原版 Menu（CraftingMenu / ChestMenu / FurnaceMenu）。
- **合成台**：真实 3×3 合成（46 槽），点击/快速移动都走原版 `AbstractContainerMenu`；测试里把 2 块橡木木板
  竖着放进网格 → 结果槽出现 4 根木棍（配方查询、结果槽、取走都验证过）。
- **箱子**：`ChestMenu` 27 + 36 槽；同一坐标的菜单实例在会话内缓存（`Game.blockContainers`），
  移入物品 → 关 GUI → 再右键打开，内容还在（测试断言 16 块木板保留）。
- **熔炉**：`FurnaceMenu` 真实熔炼（FuelValues 燃料表 + smelting 配方 + 烹饪进度），GUI 打开时每 tick 推进；
  `FurnaceScreen` 的火焰/箭头进度由菜单实时注入。测试里 raw_iron + oak_log 最终产出 iron_ingot。
- **洞穴环境音**：简化版 AmbientSoundHandler——玩家在地下（sky light 0 且低于海平面+20）时，
  每 tick 按 1/600 概率触发 `ambient.cave`（60–180 秒冷却、音量/音调随机）；地面上白天不触发。
  测试可调 `game.caveSoundChance` 强制触发验证。
- **已知限制（诚实）**：客户端没有方块实体系统——熔炉只在 GUI 打开时熔炼；箱子/熔炉内容不写入存档；
  箱子固定 3 行（未按 blockstate 变体）；没有漏斗/发射器等自动化。
- **验证**：`scripts/test-containers.mjs`（19 项断言，ALL PASS）、`scripts/test-ambience.mjs`（6 项，ALL PASS）；
  证据图 `REPORTS/overnight/evidence/container-{crafting,chest,furnace}.png` 与 `ambience-cave.png`。

## 5. 并行 session 事故记录

- 05:53 Claude 额度断；之后 06:44–07:10 期间 4~5 个夜班 DSH session 被自动唤醒，各自起 vite / headless Chromium、
  改同一工作区文件。已由用户归档；本日改动里已剔除它们的产物（见 §2.4）。
- **08:40 起又有一个夜班 session（session-b1577168）恢复运行**：它先提交了本 session 未提交的洞穴环境音改动
  （commit `656ac285`），并在 **08:40:16 把整个 fork push 到 `origin/main`**；之后继续改 GUI 缩放 / 创造物品栏
  （`FontRenderer`、`ScreenManager`、`Types`、`SplashRenderer`、`TitleLayout`、`OptionsScreen`、`DeathScreen`、
  `CreativeModeInventoryScreen`、`SectionMesher`、`LevelRenderer`、`Game.ts`），目前**未提交**。
  本 session 没有动它的改动，全部工作区快照在 `G:\tmp\workspace-foreign-*.patch`（含它的 WIP 和本 session 的文档修正前状态）。
- 另：5174 端口被它们抢过多次、dev server 被杀过多次；现在 5174 由并行 session 的 vite 占用（`--host 0.0.0.0`）。

## 6. 仓库状态

- ⚠️ `main` 已在 **2026-11-08 08:40:16 被并行 session push 到 `origin/main`（github.com/zht1232/web_mc）**：
  夜班 21 个 commit + 本日 7 个 commit（菜单/触屏、§8-1 生物、SSAO/TAA、容器、洞穴环境音）都已在远端。
  这个 push 不是本 session 做的（本 session 的约束是「不 push」），且仓库历史里跟踪着 `public/mc/**` 官方素材
  （9412 个文件）与 `dist/**`（5000+ 文件）；若要公开仓库，务必先确认素材授权并决定是否清理历史。
- 本 session 之后的文档修正 commit 只留在本地（不 push）。
- 工作区未提交：并行 session 的 GUI 缩放 / 创造物品栏改动（见 §5）、`dist/`、`public/mc/particles.json`、`shots/`、`logs/`。
- 公开远端前必须先决定是否把 `public/mc/**` 与 `dist/**` 移出版本库。

---

# 7. 第二轮接手（2026-11-08 下午，WorkBuddy）

## 7.1 读了什么

- Qoder 最新 session `9db94ea3`（11 MB JSONL）：7 条直接用户消息 + 4 段压缩摘要 + 21 个任务项的
  `~/.qoder/tasks/9db94ea3…/*.json`（41 条反馈的权威清单）。
- `REPORTS/HANDOFF.md` / `HANDOFF-2.md` / `overnight/*.md` / `session-reports/**`。
- 结论：上一轮把「地形 x/z 转置、字体 advance、dpr/guiScale、tint/alpha」修了，但 #10–#18、#21 的绝大多数
  反馈仍是 pending/in_progress；Qoder 额度在 04:43 断在「容器 UI 交互测试」子 agent 上。

## 7.2 本轮修复（按用户反馈归组）

| 用户反馈 | 根因 | 修法 |
|---|---|---|
| 所有界面 English、语言调节不可选 | `zh_cn.json` 是 11:19 才创建的，**vite 启动时的静态文件表已固定**，请求被 SPA fallback 成 index.html（HTTP 200 + text/html），`setLanguage` 解析失败退化成 en；且 `setLanguage` 是 fire-and-forget，标题屏早已用英文构建 | 重启 dev server；`await setLanguage` 后才建 ScreenManager；语言列表只列真正带 lang 文件的语言 |
| 选项里仍混英文（Music & Sounds/Controls/Language/Chat） | 用了自造的 `options.*Title` 键，zh_cn 里没有 | 改用 26.2 真键 `options.sounds/video/controls/language/chat`；删掉自造键 |
| 视频设置 "Graphics: Fancy / Shader Quality: HIGH / Auto / chunks" 中英混杂 | 值文本硬编码英文 | 走 `options.graphics.*`、`options.guiScale.auto`、`options.chunks`，并给自造的 shader 选项补中英词条 |
| 创造栏「黑色线条而非原版按钮」、滑块下多一个错位按钮 | 只预载了 `tab_*_1` 精灵，2..7 取不到 → 退化成灰矩形；滚动条自己画了 track；右下角无条件画了一个销毁槽 | 预载全部 28 个 tab 精灵；只画滑块（vanilla 112px 轨道）；销毁槽只在「生存物品栏」页签且坐标 (173,112) |
| 物品栏方块有灰色裂痕、上下底像反了、草方块顶发白 | 图标以 48×48 烘焙后用 nearest 缩到 16（丢掉 2/3 像素）；`quad.tint` 完全没用 | 图标改为 16×16 烘焙（和 vanilla GuiItemAtlas 一致）；tintIndex≥0 的面上草/树叶默认色 |
| 字体之间有分割裂痕/错位 | `drawFormatted` 里 advance 多加 1px（`width()` 没加），量宽度和画字不一致 | 去掉多余 +1 |
| 物品栏格子交互几乎不能用 | Shift+左键在「手上有物品」时先走了 PICKUP（把手上物品塞进格子/互换），双击收集的条件写反了 | Shift 优先走 QUICK_MOVE；双击改为 PICKUP_ALL（手上有同种物品时） |
| 破坏方块粒子不遵循光照、和方块不统一 | 粒子着色器完全没有光照项；BLOCK 粒子用的是整张方块贴图缩小 | 粒子接入 `level.getBrightness` + lightmap 曲线；BLOCK 粒子改用贴图 1/4 象限（TerrainParticle） |
| 水面下实体像浮在空中 | 渲染顺序是 水 → 实体，实体画在水面之上 | `renderer.render(..., beforeTranslucent)`：实体/粒子/破坏裂纹插到水面之前，水面最后画 |
| 仙人掌旁边不能有方块 | `cactus` 特性只查了下面是不是沙子，直接往上长 | 按 `CactusBlock#canSurvive`：逐层校验自身是空气 + 四邻无碰撞方块，不行就降高度 |
| 常驻 "N FPS" 不是原版 | HUD 右上角常驻帧数 | 只在 F3 里显示（vanilla 行为） |
| 聊天栏没有实际功能 | 指令反馈走 toast（右上角），聊天栏没有常驻记录 | 新增 100 行聊天记录 + 底部 10 秒淡出 HUD；指令反馈进聊天栏；指令文案汉化 |
| 帧率低/卡顿 | 实测 **~1500 drawElements/帧**（每 16³ section 1–3 次），JS 侧 render 只占 1 ms → 瓶颈是绘制调用 | SOLID+CUTOUT 合并为一次绘制（1332/帧）；shadow pass 只画合并后的 solid |

GL 注意点：合并后水面 pass 重设 uniform 时，`uDebug`/`uUseShadows` 是 **int**，用 `set1f` 会触发
GL_INVALID_OPERATION（容器测试的 "no GL errors" 抓到过）。已改 `set1i`。

## 7.3 验证

```
npx tsc --noEmit                         0 errors
test-gui.mts 90/90 · test-hud.mts 123/123 · test-survival.mts PASS · test-mobs-render PASS · test-glmath PASS
test-containers.mjs ALL PASS · test-ambience.mjs ALL PASS · test-menu.mjs ALL PASS · test-touch.mjs ALL PASS
```

截图：`shots/screens/*.png`（标题/选项/视频/语言/暂停/背包/创造/工作台/箱子/熔炉/聊天/F3）、
`shots/diag/`（图标放大、热栏、世界、手机竖屏）。

## 7.4 还没做（诚实清单）

1. **帧率**：合并后仍是 ~1330 draws/帧。根治要把 section 几何合批到 region/vertex arena（OpusMC 做法），
   本轮没做；p90 仍有 ~36 ms 卡顿。
2. **地形观感**：阶梯状台地、树冠形状（细高柱）、浮空树、群系过渡都还没按原版重做。
3. **实体**：骷髅不持弓、箭只是木棍、背朝射箭；苦力怕爆炸音效；物品栏 2D Steve（需要离屏 3D 渲染）。
4. **光照**：红石粉亮度、破坏后光照更新延迟、阴影闪烁/带状光、黄昏过渡、雾边界闪烁未逐项验证。
5. **创造栏/生存栏**：物品计数是原版全尺寸（26.2 源码如此），但截图观感偏大，未再调；生存栏配方书、
   触屏容器拖拽未实测。
6. **标题屏**：全景仍是均值渐变（不是真的立方体贴图）；多人/Friends/无障碍按钮只弹 toast。
7. **存档**：仍会在用户选存档前预加载最近一个世界；创建世界仍用 location reload。
8. 素材授权：`public/mc/**`（含 `lang/zh_cn.json`）是 Mojang 资源，**不要提交/公开**；本轮 commit 只含 `src/`。

---

# 8. 第三轮（2026-11-08 晚，WorkBuddy，按用户 15:10 反馈）

## 8.1 修了什么（每条都有复现/测量）

| 反馈 | 根因 | 修法 / 证据 |
|---|---|---|
| 放下物品后指针上还悬浮物品 | `mouseEvent` 只在 `down` 时按 PICKUP 拿起，松开在**另一个**格子时既不放下也不取消（`containerDragButton` 仍是 -1），栈一直挂在指针上 | 记录 `pressedSlot`，`up` 时若落在别的格子就执行一次 PICKUP；`cancelDrag()` 一并清 pressedSlot（GUI 单测 90/90 覆盖） |
| 主界面背景没了 / 后面背景一直闪 | `PanoramaRenderer` 把 6 张 1024² 全景图当"1×1 占位图"，只采样一个颜色做**移动的渐变**再加 blur(4px)；渐变 stop 每帧移动 → 抖动；整体又压了 31% 黑 → 看起来是空的 | 真图按 4 个侧面画成缓慢平移（2°/s）的横条，去掉 blur，压暗降到 16% |
| 启动时不要预加载存档 | `initSave()` 无条件 restore 最近存档/首次还 create 一个 "World"，所以列表里总有玩家没建过的世界，且启动要预生成 25 区块 | 仅 `?play`/`?world=` 才加载；标题启动只打开 IndexedDB 给列表提供 provider。**启动 2s、0 区块** |
| 启动界面要 Mojang 的 | 自绘渐变 + "Minecraft 26.2 browser client" | `main.ts` 改成 `mojangstudios.png` 居中 + 底部 3px 进度条 |
| 帧率太低（~1500 draws/帧） | 每 16³ section 1–3 次 draw；更致命的是**网格队列**：每次进世界会排 ~10000 个 section，每个 1.5–2ms，主线程 15 秒都在建网格（`update()` 13.1ms/帧） | ① 4×4 区块 region 合批：顶点上传时一次性 rebase 到 region 原点，之后 region 重建只是 memcpy；draw calls **1332 → 43**。② 队列裁剪：跳过「比相机和区块地表都低 32 格」的 section + 每帧最多 3 个；`update()` 空闲 **0.1ms**、行走 6ms。③ region 暂存缓冲复用（GC 抖动）、区块应用与建网格错帧。稳定后 **60 FPS / p50 16.7ms / p90 18.4ms**（之前 p50 25ms / p90 54ms） |
| 移动/视角卡顿 | 同上（每帧 13ms 主线程建网格 + 11ms 区块应用） | 由上面两项解决；另把 TAA 历史在重生/传送时清掉（原来会拖影） |
| 破坏粒子没光照、和方块不匹配 | ① 粒子在方块**内部**采样光照，方块格存的是 0 → 全黑；② BLOCK 粒子用整张贴图缩小 | 采样 6 个邻居取最亮（暴露面），lightmap 曲线 `l/(4-3l)`；贴图改用 1/4 象限 |
| 存档要求能本地化 | 只有 IndexedDB，清缓存就没了 | 世界列表加「导出存档 / 导入存档」（WorldSaveManager 本来就有 archive codec），导出 `.mcworld` 文件 |
| 阴影闪烁 | 阴影图缓存只按「相机移动 2 格」失效，但矩阵是 texel 对齐的 → 矩阵新、深度图旧，边缘爬行 | 缓存改按**对齐后的光矩阵**失效 |

## 8.2 没做完（按用户优先级）

1. **光影系统按 OpusMC 重做**：级联阴影（现在 1 张 2048、extent 72）、SSR 水面、体积光/云都没做。
   本轮只修了阴影缓存的闪烁；带状光/黄昏过渡仍是旧实现。
2. **群系/植被/建筑按原版生成**：地形仍是阶梯台地，树冠是细高柱，浮空树没修。这块要重写
   `SurfaceRules` 的插值 + feature 的 heightmap 对齐 + 树冠层数，工作量最大。
3. 实体：骷髅持弓/箭模型、苦力怕音效、3D Steve 未做。
4. 行走时仍有 p90≈30ms 的尖峰：区块 apply（palette + 全量 relight）单块 ~10ms，下一步应把它
   移进 worker 或改成增量光照。

## 8.3 验证

```
npx tsc --noEmit                    0 errors
test-gui 90/90 · test-hud 123/123 · test-containers ALL PASS · test-menu ALL PASS · smoke 19/19 gl=0
```
帧时间实测（1280×720，rd12）：稳定后 p50 16.7ms / p90 18.4ms / 60FPS；draws 43/帧。

---

# 9. 第四轮（2026-11-08 傍晚，goal：光影先行）

## 9.1 级联阴影（commit 4dba7773）

之前只有一张 2048 阴影图覆盖整个视距：texel ≈ 0.35 格，边缘是可见的阶梯/带状。

- `ShadowMap` 改成 **2 级级联**：近 40 格（2048²，≈0.04 格/texel）+ 远 132 格（1024²），
  两级都做 texel 对齐（相机亚像素移动矩阵不变，不会爬行），shader 在近级 85%~100% 处平滑混到远级。
- PCF 从 3×3@1.5texel 改成 **5×5@1.0texel**，法线偏移略加强（0.06 + 0.40·(1-N·L)），
  深度 bias 从 0.0006 降到 0.00035（世界深度 420，约 0.15 格）。
- 阴影 pass 改成按 region 画两次（每级一次），仍是每个 4×4 区块 1 次 draw。
- `ItemIconAtlas` 也要绑第二个级联采样器，否则图标 pass 会非法（已处理）。

验证：
- 屋顶遮挡测试：玩家头顶 5 格放 11×11 石台，`debugMode=11`（lit 掩码）读中心像素 = `[0,0,0]`（全遮挡），
  周边 = 亮 → 阴影生效。
- `smoke.mjs` 19/19、gl=0；`test-gui 90/90`、`test-hud 123/123`、`test-containers` ALL PASS。

## 9.2 天空时间轴（核对，未改）

用 `computeSkyState` 直接采样 8 个时间点，确认走的是原版 timeline：

| time | skyColor | fogColor | sunrise alpha | sunAngle |
|---|---|---|---|---|
| 6000（正午） | 0.47,0.65,1 | 0.75,0.85,1 | 0 | 0° |
| 11800 | 0.47,0.65,1 | 0.75,0.85,1 | 0.25 | 74.5° |
| 12300 | 0.35,0.49,0.76 | 0.58,0.65,0.78 | 0.75 | 82.3° |
| 12800 | 0.22,0.31,0.48 | 0.38,0.43,0.53 | 1.00 | 90.3° |
| 13000（夜） | 0.17,0.24,0.37 | 0.30,0.34,0.42 | 0.94 | 93.5° |
| 18000（午夜） | 0,0,0 | 0.04,0.04,0.09 | 0 | 180° |

即黄昏不是硬切，而是 sunrise 权重 0→1 的连续 ramp。**如果仍然觉得黄昏不对，需要一张你实际看到的截图定位**
（是"没有橙色/紫色"还是"过渡有两段跳变"）。

## 9.3 这轮没做的

- 雾边界物体闪烁、带状光（需要你指出具体场景/截图）。
- 世界生成（地表/树/结构）：本轮只做了核对——高度剖面是平滑的（48 格内 delta 以 0/±1 为主），
  树下没有浮空（`placeBelow` 会铺土），树冠近看是正常橡树；"阶梯台地"的观感主要来自
  1 格台阶 + 均匀光照，不是高度量化 bug。
- 实体（骷髅弓/箭、3D Steve）、区块 apply 尖峰。

## 9.4 苦力怕音效（commit 693d14c4）

- `Creeper.inflate()` 在 vanilla port 里没有音效钩子：`MobSounds` 现在观察 `swell`，在 0 → >0 的边沿
  播 `entity.creeper.primed`（原版就是点火瞬间一声嘶响）。
- `Game.explode()` 之前**完全没有声音**：补 `entity.generic.explode`，音量 4.0、音调 1±0.1（Explosion.java）。

## 9.5 下一步（按价值排序，可直接接）

1. **3D Steve 物品栏预览**：需要 `EntityRenderDispatcher` 加一个离屏 FBO 渲染 + readPixels → Canvas，
   通过 `ScreenDeps.renderEntityPreview` 注入给 `InventoryScreen`（当前是 2D 色块）。
2. **骷髅持弓**：模型系统是盒模型 + 单张贴图，弓需要单独的 item 模型与手部挂点；
   建议在 `EntityRenderer` 里给 `isHoldingBow` 的生物额外画一个弓箭模型（brown tint 的薄盒 + 弦）。
3. **区块 apply 尖峰**（行走 p90≈30ms）：单块 relight ~10ms，搬到 worker 或改增量光照。
4. **地形/植被观感**：需要具体参照（截图）才能定"哪里不像原版"；当前高度剖面平滑、无浮空树。
