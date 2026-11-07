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
2. §8-4 洞穴环境音、合成台/熔炉/箱子真实交互（目前只有布局）。
3. 生存循环：饥饿效果、药水、附魔、红石；生物幼年变体与更多 §8 近似修正（见 `mobs2.md` 第 5 节）。
4. 夜晚对拍复核（M2 的 `shots/ref/INDEX.md` FOV 记录仍是错的，要么改 INDEX，要么重拍）。
5. Paper 桥接仍未接浏览器（按用户要求没动）。

## 4b. §8-2 进度（2026-11-08 上午，第一轮）

- **已提交的基础设施**：HDR 场景目标的深度缓冲从 renderbuffer 换成 **可采样 depth texture**（驱动不支持时自动回退并关闭依赖深度的 pass），
  `PostProcessor.stats.depthTexture` 可查；新增 `mat4Invert`（gl-matrix 算法）与 6 断言单测 `scripts/test-glmath.mts`；
  `LevelRenderer.pendingRebuilds` 暴露网格重建队列长度（测试等它归零再截图，否则会拍到旧网格——排查时踩过）。
- **SSAO 尝试（已回退）**：写了半分辨率 SSAO pass（深度重建 view pos + 屏幕空间法线 + 半球采样 + 深度感知模糊，接入 bloom/合成），
  但浏览器里 AO 输出恒为 1（全白）。已核对：深度纹理读回有正确几何、投影/逆投影矩阵 uniform 正确、运行时 GL 状态正确、
  uniform 值正确、重建数学在 Node 单测里往返一致——仍未能定位。为避免提交未验证代码，**实现已回退**，只保留上述基础设施。
- **下一轮计划**：改用更简单的「合成 pass 内深度差分 AO」（直接采样 scene depth，比较邻域线性深度，不新增 FBO/矩阵依赖），
  用自然地形 + 可等待 `pendingRebuilds` 的封闭凹角场景做 A/B 验证；通过后再考虑 TAA。


## 5. 并行 session 事故记录

- 05:53 Claude 额度断；之后 06:44–07:10 期间 4~5 个夜班 DSH session 被自动唤醒（`session-01e9597d`、
  `2031c31b`、`77f222da`、`b1577168` 等），各自起 vite / headless Chromium、改同一工作区文件。
- 已由用户归档；本日改动里已剔除它们的产物（见 §2.4）。以后要再启用它们，先看 `G:\tmp\night-sessions-*.patch`。
- 另：5174 端口被它们抢过两次、dev server 被杀过两次；现在 5174 由本 session 的 dev server 占用。

## 6. 仓库状态

- `main` 本地领先 `origin/main` **23 个 commit**（夜班 21 + 本日 2），**未 push**。
- 工作区未提交：`dist/`（构建产物）、`public/mc/particles.json`、`shots/`、`logs/`（后两者为生成物）。
- 仓库仍跟踪 `public/mc/**`（Mojang 素材，仅限本机私用）与 `dist/**`（5000+ 文件）：公开远端前必须先决定是否移出版本库。
