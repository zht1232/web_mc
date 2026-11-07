# TASK hand — 第一人称手臂 / 手持物 / 破坏裂纹 / 选择框

先读 `REPORTS/OVERNIGHT-BRIEF.md`、`REPORTS/session-digest.md` §0 §6、`session-reports/07-integration.md`。

项目的核心验收是“**Steve 的手、手持方块的位置**这类细节必须 1:1”。现在重构后的第一人称**完全没有手**（旧版有，重构时丢了），挖掘也没有裂纹。

## 任务
1. **第一人称渲染**：照 `G:/ck-web26/src-vanilla/net/minecraft/client/renderer/ItemInHandRenderer.java`、`GameRenderer.java`（`renderItemInHand`、手部投影）、`entity/player/PlayerRenderer`（`renderRightHand/renderLeftHand`）、`client/model/**/PlayerModel`：
   - 空手画 Steve 右臂（皮肤贴图在 `G:/ck-web26/vanilla/assets/minecraft/textures/entity/player/**`，26.2 路径先 `find` 一下，宽/细臂选 steve 宽臂）；
   - 手持方块：用该方块模型 `display.firstperson_righthand`（`models/block/block.json` 里的 display 段）；手持平面物品：用 `items/*.json` 的模型 + 物品贴图挤出，display 取 `models/item/generated.json` / `handheld.json` 等；
   - 动画：挥击 `attackAnim`（`swingProgress` 的 sin 曲线）、装备/切格 `equipProgress`（下沉再升起）、走路晃动 `bobView`（及 `bobHurt`）、使用物品/吃东西姿态——有源码依据的都做；
   - 投影：手部用独立投影矩阵（FOV 取源码值，核对是否受疾跑 FOV 影响），绘制前清深度；光照取玩家头部所在格的 lightmap（天空光/方块光），夜里手也要变暗。
   **所有数值（平移、旋转、缩放、曲线）都从 Java 与 json 取，注释标出处。**
2. **手臂纹理**：从官方资源取；`public/mc` 只读——如需新增文件，放进新目录 `public/mc/textures/entity/player/`，并同步补进 `scripts/build-*.mjs`（让 `npm run assets` 可重现），报告里写明。
3. **破坏裂纹**：`destroy_stage_0..9`（`textures/block/destroy_stage_N.png`）叠在被挖方块上（`BlockRenderDispatcher.renderBreakingTexture` / `crumbling` 混合，按 `ModelBlockRenderer` 的方式用方块自己的模型面）。进度来自 `survival` 的挖掘状态（08-regression 问题 4：`survival.breaking.progress` 没有接到画面），阶段 = floor(progress×10)。
4. **选择框**：照 `LevelRenderer.renderHitOutline`（颜色/线宽/使用方块 outline shape 的**全部** box，不止第一个；线宽在 WebGL 里只能是 1，如需粗线用扩展四边形）。
5. **相机效果**（有源码依据且来得及的部分）：受击倾斜 `hurtTime`；水下/岩浆内视角覆盖（`misc/underwater.png`、火焰覆盖 `ScreenEffectRenderer`）。
6. **验收**：`shots/hand/` 里空手 / 持方块（石头）/ 持镐 / 挥击中途 / 挖到一半有裂纹 各一张，Read 后逐张描述；夜里（t=18000）持方块一张，手要偏暗。若 `shots/ref/` 里已有真实客户端的手部截图，按它调。

## 约束与文件所有权
新增 `src/client/renderer/hand/**`、`src/client/renderer/BreakingOverlay.ts`；`Game.ts` 里与第一人称/挖掘/选择框相关的小块（`render()` 中在 `particles.render` 之后加一次调用；`updateMining()`）——Edit 小改，改前重读。
**render 包稍后会把场景画进 HDR FBO**，所以你的绘制不要自己绑 FBO、不要改 viewport、遵守 GL 状态契约（见 `05-environment-audio.md`），手臂同样会进入 HDR。`LevelRenderer.ts`、`Shaders.ts` 不是你的（render 包）；你自己的 shader 写在 `hand/` 里。

## 交付
`REPORTS/overnight/hand.md`。第一版 05:30 前。
