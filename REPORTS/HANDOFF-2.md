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
for t in scripts/test-*.mts; do npx tsx $t; done   # 18/18 套 exit 0
npx tsx scripts/test-mobs-render.mts     # 19/19 PASS
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


## 4c. §8-4 进度（2026-11-08，容器真实交互已交付）

- **右键打开**：crafting_table / chest / 	rapped_chest / urnace 走原版 useItemOn 优先级
  （潜行时退回放置行为）；打开前先由 SurvivalState 建好对应的原版 Menu（CraftingMenu / ChestMenu / FurnaceMenu）。
- **合成台**：真实 3×3 合成（46 槽），点击/快速移动都走原版 AbstractContainerMenu；测试里把 2 块橡木木板竖着放进网格
  → 结果槽出现 4 根木棍（配方查询、结果槽、取走都验证过）。
- **箱子**：ChestMenu 27 + 36 槽；同一坐标的菜单实例在会话内缓存（Game.blockContainers），
  移入物品 → 关 GUI → 再右键打开，内容还在（测试断言 16 块木板保留）。
- **熔炉**：FurnaceMenu 真实熔炼（FuelValues 燃料表 + smelting 配方 + 烹饪进度），GUI 打开时每 tick 推进；
  FurnaceScreen 的火焰/箭头进度由菜单实时注入。测试里 raw_iron + oak_log 最终产出 iron_ingot。
- **已知限制（诚实）**：客户端没有方块实体系统——熔炉只在 GUI 打开时熔炼；箱子/熔炉内容不写入存档；
  箱子固定 3 行（未按 blockstate 变体）；没有漏斗/发射器等自动化。
- **验证**：scripts/test-containers.mjs（19 项断言，ALL PASS）；证据图
  REPORTS/overnight/evidence/container-{crafting,chest,furnace}.png。

## 5. 并行 session 事故记录

- 05:53 Claude 额度断；之后 06:44–07:10 期间 4~5 个夜班 DSH session 被自动唤醒（`session-01e9597d`、
  `2031c31b`、`77f222da`、`b1577168` 等），各自起 vite / headless Chromium、改同一工作区文件。
- 已由用户归档；本日改动里已剔除它们的产物（见 §2.4）。以后要再启用它们，先看 `G:\tmp\night-sessions-*.patch`。
- 另：5174 端口被它们抢过两次、dev server 被杀过两次；现在 5174 由本 session 的 dev server 占用。

## 6. 仓库状态

- `main` 本地领先 `origin/main` **23 个 commit**（夜班 21 + 本日 2），**未 push**。
- 工作区未提交：`dist/`（构建产物）、`public/mc/particles.json`、`shots/`、`logs/`（后两者为生成物）。
- 仓库仍跟踪 `public/mc/**`（Mojang 素材，仅限本机私用）与 `dist/**`（5000+ 文件）：公开远端前必须先决定是否移出版本库。
