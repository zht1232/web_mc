# TASK light — 光照 / 天空状态 / 雾（与原版 26.2 逐项一致）

先读 `REPORTS/OVERNIGHT-BRIEF.md`。

## 背景（主管刚查出的两个真 bug，已修，别改回去）
1. `EnvironmentLighting.ts` 的 `colorFromFloat` 参数顺序和原版 `ARGB.colorFromFloat(alpha, red, green, blue)` 不一致，导致夜晚雾色/天空光色/云色整体错成红色。上一轮报告把“夜里偏红”解释成“原版常量就是这样”——那是错的。
2. 地形着色器采样光照贴图时 x/y 反了（贴图 x=方块光 y=天空光；顶点属性是 (sky, block)），夜里地形和白天一样亮。现在已对调为 `vLight.yx`。

这说明这个文件里**很可能还有别的“看似对、其实错”的地方**。你的工作就是用机器校验把它们全部找出来。

## 任务
1. **自动比对关键帧。** 写 `scripts/verify-timelines.mts`（tsx）：从
   `G:/ck-web26/src-vanilla/net/minecraft/world/timeline/Timelines.java`（及其引用的 `EnvironmentAttributes.java`、`world/attribute/**` 里的 Modifier/Easing、`data/minecraft/dimension_type/overworld.json`、`data/minecraft/timeline/*.json` 若存在）解析出 OVERWORLD_DAY 的所有轨道关键帧（SKY_COLOR、FOG_COLOR、SKY_LIGHT_COLOR、SKY_LIGHT_FACTOR、SKY_LIGHT_LEVEL、CLOUD_COLOR、STAR_BRIGHTNESS、SUNRISE_SUNSET_COLOR、SUN_ANGLE、MOON_ANGLE、MOON_PHASE、…），与 `EnvironmentLighting.ts` 的轨道逐条比对（注意 ARGB 编码、有符号 int、Modifier 的 MULTIPLY/MULTIPLY_RGB/ALPHA_BLEND/MAXIMUM 语义、插值曲线 Easing、周期取模）。所有不一致都改 TS 端，输出对照表和 PASS/FAIL。
2. **`SKY_LIGHT_LEVEL`（夜晚=4）到底被谁消费？** grep `SKY_LIGHT_LEVEL` 在 `net/minecraft/**` 的所有引用：是渲染（lightmap/顶点）还是玩法（刷怪、日光传感器、`isBrightOutside`）。按原版语义实现；若渲染也用到，只能走**光照贴图（CPU 端 `buildLightmap`）**或通过 `SkyState`/`FogState` 暴露给 render 包，**不要改 `Shaders.ts`**。把结论写进报告（带源码行号）。
3. **逐行核对 `buildLightmap` 与 `shaders/core/lightmap.fsh` + `LightmapRenderStateExtractor.java`**（路径：`G:/ck-web26/vanilla/assets/minecraft/shaders/core/lightmap.fsh`）：night vision、darkness、boss 变暗、`BrightnessFactor`（gamma 滑条）。已知嫌疑：`applyGamma` 对每个通道单独算 notGamma，而原版 `notGamma` 用的是 **max(r,g,b)** 分量，不一致；修正并写单测 `scripts/test-lighting.mts`，对若干 (sky, block, 时刻) 采样点手算比对。
4. **新建 `src/client/renderer/environment/FogState.ts`**（纯函数、无 GL）：输入（相机所处介质：空气/水/岩浆/粉雪/失明/黑暗、renderDistance、时间、雨量/雷量、群系、水下停留时间、是否潜行等）→ 输出 `{ color:[r,g,b], start, end, shape }` 等。照 26.2 的 `net/minecraft/client/renderer/fog/**`（`FogRenderer`、`environment/*FogEnvironment`）逐个移植：大气雾（`FogSkyEnd`/环境雾与渲染距离的关系，圆柱 `max(|xz|,|y|)` 与球形包络取大）、水下雾（群系 `water_fog_color`、end 随水下时间渐变）、雨天雾收缩、夜晚雾色。写 `scripts/test-fog.mts`。**render 包会消费这个模块**，接口（导出的函数签名与字段含义）要写进报告。
5. **雨/雷对天空色、雾色、云色、天空光的调制**：原版 26.2 走 attribute/timeline 体系，照源码实现（`SkyState` 增加 `rainLevel/thunderLevel` 输入或新增 `computeSkyState(time, opts)`，旧签名保持兼容）。
6. **群系专属天空/雾/水色**（attributes 注册表）：看 `public/mc/worldgen.json` 与 `data/minecraft/worldgen/biome/*.json`（`attributes`/`effects`），把需要的值通过 `SkyState` 或 `FogState` 暴露（只增不删）。
7. **夜间验收**：写 eval 在 t=13000/14000/18000/22000/23000 打印 `__mc.sky` 与 lightmap 关键像素；用 `shot.mjs` 拍 t=6000/12500/13500/18000/23500 五张到 `shots/light/`，Read 查看并如实描述亮度与色调。原版夜晚的特征：地形偏暗蓝、月光下仍能辨认轮廓；天空近黑；地平线雾为深蓝灰；没有红色。没有 reference 时，以 fsh 手算值为准（reference 员工可能在 05:00 前提供真实截图：`shots/ref/INDEX.md`，出现后拿来对照）。

## 文件所有权
`src/client/EnvironmentLighting.ts`、`src/client/renderer/TextureManager.ts`（仅 lightmap 相关）、新增 `src/client/renderer/environment/FogState.ts`、`scripts/verify-timelines.mts`、`scripts/test-fog.mts`、`scripts/test-lighting.mts`。
`Game.ts` 里 `render()` 开头 lightmap/天空状态相关的几行如需改，用 Edit 小改并在报告里写明。

## 交付
`REPORTS/overnight/light.md`。第一版 05:30 前。
