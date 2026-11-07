# TASK sky — 天空物体 / 云 / 天气渲染（夜景重点）

先读 `REPORTS/OVERNIGHT-BRIEF.md`、`REPORTS/session-reports/05-environment-audio.md`。

照 26.2 源码逐项核对 `src/client/renderer/environment/*.ts`（`SkyRenderer`、`CelestialBodies`、`CloudRenderer`、`WeatherRenderer`、`EnvCommon`）并修到一致。Java 在 `G:/ck-web26/src-vanilla/net/minecraft/client/renderer/`：`SkyRenderer.java`、`CloudRenderer.java`、`WeatherEffectRenderer.java`、`LevelRenderer.java`（`addSkyPass/addCloudsPass/addWeatherPass`）、`state/*`（sky/cloud render state）、`environment/*`。

## 任务（重点是夜景）
1. **星星**：原版算法、数量（1500）、大小、亮度（`star_brightness` 作 alpha，不是 GL 点）、随天空旋转。
2. **日月**：尺寸（sun scale 30、moon scale 20 之类——以源码为准）、距离、**8 个月相**（`environment/celestial/moon_phases.png` 4×2 图集，按 `dayTime / 24000 % 8`——查 `getMoonPhase`/attribute）、日出日落光晕（sunrise/sunset 扇形，颜色来自 `SkyState.sunriseColor`）。
3. **天空圆盘与地平线**：顶/底两片平色圆盘（`#78a7ff` / `#282828` 之类以源码为准）+ 地平线靠雾混合；夜晚颜色来自 `SkyState`（light 包在核对其数值）。
4. **云**：26.2 `CloudRenderer.java` 是体素挤出云（每格 12.0 宽、4.0 厚，面光照 顶 1.0 / 侧 0.9·0.8 / 底 0.7，按距离 0→2048 淡出，云色=`SkyState.cloudColor`，高度 192.33，漂移 0.6 格/秒，纹理 `environment/clouds.png`）。现在是贴地平面，是“廉价感”的主要来源——重写。
5. **雨/雪**：`WeatherEffectRenderer`（64×256 动画列，alpha 0.8/0.5/0.25，按群系降水类型区分雨/雪）；雷暴时天空变暗、闪电。天气状态由 survival 包提供 `level.getRainLevel()/getThunderLevel()`；你只负责渲染。
6. **验收**：t=18000，`__mc.player.pitch` 分别朝上 / 朝地平线，拍图到 `shots/sky/`，用 Read 查看；t=12500 日落、t=23500 黎明各一张；开云的视角（从云下往上看）一张。逐张写出和原版预期的差异。

## 约束
- 渲染必须遵守 `05-environment-audio.md` 的 GL 状态契约（不绑 FBO、不改 viewport、不 clear；进入时 DEPTH_TEST 开、`LEQUAL`；返回前恢复 `depthMask(true)` / `CULL_FACE BACK` / `BLEND off`）。render 包会把你的输出画进 HDR FBO。
- 你的 shader 写在 `environment/` 目录自己的文件里。**不要改 `Shaders.ts`、`LevelRenderer.ts`**（render 包独占）。
- 数值全部以源码为准，注释标出处。

## 文件所有权
`src/client/renderer/environment/**`（`FogState.ts` 除外，属 light 包）。`Game.ts` 里天空/云/天气的调用点如需微调，Edit 小改并报告。

## 交付
`REPORTS/overnight/sky.md`。第一版 05:30 前。
