# TASK mobs — 生物渲染保真（夜里的僵尸必须是暗的、会动的）

先读 `REPORTS/OVERNIGHT-BRIEF.md`、`session-reports/02-entities.md`（“未实现/简化”一节）。

## 现状（问题）
`src/client/renderer/entity/**`：实体着色器**没有接光照贴图、没有雾**（只有烘焙的方向面阴影）→ 夜里生物和白天一样亮；模型无走路四肢摆动、无头部俯仰（只有 yaw）；受击没有红闪；死亡没有倒地动画；14 个模型里 6 个（Wolf/Rabbit/Bat/Silverfish 等）是近似 box。

## 任务（按优先级）
1. **实体光照与雾**：像地形一样用光照贴图（16×16，**x = 方块光、y = 天空光**）：每个实体按其眼睛/中心所在格取 `level.getSkyLight/getBlockLight`（原版 `EntityRenderer.getPackedLightCoords`），用 `__mc.textures.lightmap`（`TextureManager.lightmap`）采样；叠加与地形一致的圆柱雾（雾色/start/end 目前来自 `LevelRenderer.render` 里 `sky.fogColor` 与 `renderDistance`；`renderer/environment/FogState.ts` 由 light 包正在写，出现后改用它）。结果：t=18000 的僵尸应是暗蓝色调，站在火把旁边会变亮。
2. **受击红闪**（`hurtTime`/`deathTime` → 红色叠加，原版 `OverlayTexture`）、死亡倒地（`deathTime` 旋转 90°）。字段可能由 survival 包添加到 `LivingEntity`（`hurtTime`、`deathTime`）；先 grep，缺失时用 Edit 在 `LivingEntity.ts` **加可选字段**并在报告里写明（不要改别的逻辑，survival 包拥有那些文件）。
3. **动画**：照 Java `*Model.setupAnim` 逐个移植：走路摆动（`limbSwing/limbSwingAmount` 的 cos 曲线 ×1.4、0.6662 频率等，以源码为准）、头部 yaw/pitch 跟随、僵尸双臂前举、骷髅持弓姿势与拉弓、苦力怕腿与膨胀闪白（swell）、蜘蛛八腿、四足动物（猪牛羊）四肢与头、鸡的翅膀拍动与腿、蝙蝠挂/飞。需要的状态（`walkAnimation.speed/position`、`yHeadRot`、`xRot`、`attackAnim`、`isAggressive`…）从 `LivingEntity/Mob` 取；缺失则按实体位移计算（原版 `WalkAnimationState.update`：`speed` 随 `distanceMoved*4` 平滑，位置累加）。
4. **近似模型换成源码转录**：Wolf、Rabbit、Bat、Silverfish、（以及你发现的其它近似项）照 `net/minecraft/client/model/**` 的 `createBodyLayer()`（`CubeListBuilder`/`PartPose`）逐 box 转录，贴图 UV 用源码的 `texOffs`。
5. **实体脚下阴影**（`EntityRenderer.renderShadow`，圆形软阴影贴地、按距离与亮度淡出）——来得及再做。
6. **验收**：用 `__mc.entityManager.spawn('zombie', x+3, y, z)` 等生成 zombie/skeleton/creeper/spider/pig/cow/sheep/chicken/wolf；`t=18000` 与 `t=6000` 各拍一张（`shots/mobs/`），再放一个火把（`__mc.level.setBlockState(...)` 放 torch，确认光照更新）在僵尸旁拍一张；连拍两帧间隔 0.3 秒看肢体姿态确实不同。Read 后逐张描述。

## 约束与文件所有权
`src/client/renderer/entity/**`（独占）。`src/vanilla/world/entity/**` 属 survival 包——只允许对 `LivingEntity.ts/Entity.ts` 加**可选字段**，Edit 小改并报告。`LevelRenderer.ts`/`Shaders.ts`/`renderer/post/**` 属 render 包，别碰。
你的绘制必须遵守 `05-environment-audio.md` 的 GL 状态契约（不绑 FBO、不改 viewport）——render 包稍后会把场景画进 HDR FBO。

## 交付
`REPORTS/overnight/mobs.md`。第一版 05:30 前；先做 1（光照/雾）与 3 里的走路摆动。
