# light 包报告 — 光照 / 天空状态 / 雾（26.2 逐项）

## 1. 做了什么
- `src/client/EnvironmentLighting.ts`（重写，我拥有）：
  - 完整移植 `Timelines.OVERWORLD_DAY` + `Timelines.MOON` 全部关键帧（11 条被消费的轨道 + 月相/史莱姆表），
    `Modifier` 语义（override/multiply/maximum/multiply_rgb/multiply_argb/alpha_blend/blend_to_gray）、
    `KeyframeTrackSampler` 的**周期前后包夹段**采样（原实现把 t<首帧 一律取末帧值，清晨/黎明全错）、
    `EasingType.CubicBezier`（sun/moon/star_angle 用 symmetricCubicBezier(0.362,0.241)，原实现是线性+90° 相位错误）。
  - ARGB 整数运算逐条对齐（`as8BitChannel` 是 floor 不是 round；`multiply`/`srgbLerp`/`greyscale`/`scaleRGB`/`alphaBlend`）。
  - 修正常量：`BLOCK_LIGHT_TINT` #FFFF8C6C→**#FFFFD88C**（-10100）、`AMBIENT_LIGHT_COLOR` #000000→**#0A0A0A**、
    夜间雾色 #0C0C16→#161616、云色 0xFF191926、天空光色 #7A7AFF。
  - `buildLightmap` 对齐 `core/lightmap.fsh`：**notGamma 用 max(r,g,b)**（原来逐通道算，gamma 滑条错）、
    ambient 走 `max(ambient, nightVision)` 后相加、boss overlay `mix(×0.7,0.6,0.6)`、darkness 减法、night vision。
  - 新增 `SkyOptions`：rainLevel/thunderLevel（WeatherAttributes RAIN/THUNDER 全部 8 条属性调制）、biomeName
    （`BIOME_ENVIRONMENTS` 从 66 个 biome JSON 生成：48 条 sky_color + 7 条 fog_color + 8 条 water_fog_color + 2 条 water_fog_end 倍数）。
  - `SkyState` 只增不删：+skyDarken/starAngleDeg/moonPhase/cloudColorArgb/sunriseColorArgb/cloudHeight/
    fog*Distance/skyFogEndDistance/cloudFogEndDistance/waterFog*/nightVision*/darknessScale/bossOverlayWorldDarkening/rain/thunder。
- `src/client/renderer/environment/FogState.ts`（新增，子代理 fog 完成）：纯函数移植 FogRenderer + 6 个 FogEnvironment + fog.glsl，
  导出 `computeFog/computeFogColor/linearFogValue/totalFogValue/fogSpherical[Cylindrical]Distance/computeRainFogMultiplier/argbFromRgb`；
  接口详见 `REPORTS/overnight/light-fog.md`。
  FogState API（render 包消费）：`computeFog(input?: FogInput): FogData{color:[r,g,b], environmentalStart/End, renderDistanceStart/End, skyEnd, cloudEnd}`、
  `computeFogColor(input?)`、`linearFogValue(v,start,end)`、`totalFogValue(sph,cyl,envStart,envEnd,rdStart,rdEnd)`、
  `fogSphericalDistance(pos)/fogCylindricalDistance(pos)`、`computeRainFogMultiplier(input?)`、`argbFromRgb(rgb)`；FogInput 全可选、默认 overworld。
- `Game.ts` render() 开头小改（仅 lightmap/天空几行）：传入 `options.brightness`（gamma）、rain/thunder、biomeName；
  lightmap 缓存 key 补全所有影响像素的字段。未改 Shaders.ts / LevelRenderer.ts。

## 2. 证据
- `npx tsx scripts/verify-timelines.mts` → **42 PASS / 0 FAIL / 7 skipped**（跳过=布尔/音频轨道）。
  Java 源码↔datapack day.json 13 条数值轨道逐帧一致；TS 轨道表 vs Java 帧/修饰符/缓动全等；
  3429 个采样点（步长 7）与脚本内独立重写的采样器 maxDelta=0；computeSkyState 全字段比对 delta=0/颜色 0 字节差。
- `npx tsx scripts/test-lighting.mts` → **22 PASS / 0 FAIL**：手算 lightmap 字节（t=6000/18000 的 (15,0)/(7,0)/(7,7)/(0,7)/(0,0)）、
  notGamma max 通道 (103,103,186)、darkness/nightvision、雨/雷 8 条属性调制、colorFromFloat 参数序回归、月相周期、
  `skyDarken/isBrightOutside/effectiveSkyBrightness` 玩法语义（午夜 darken=10、t=12500 darken=3 仍算白天）。
- `npx tsx scripts/test-fog.mts` → **57 PASS / 0 FAIL**（子代理，含水下/岩浆/粉雪/失明/黑暗/雨雾缓动/boss/虚空）。
- 夜间验收（一次无头浏览器会话，`shots/light/accept.mjs`，glError=0）：
  - eval `__mc.sky` + lightmap 像素（完整 JSON 见 `shots/light/accept.log` / `eval-light.json`）：
    t=13000 sky=(0.17,0.24,0.37) fog=(0.298,0.337,0.424) factor=0.297 lm(15,0)=(49,49,86)；
    t=14000/18000/22000 sky=(0,0,0) fog=(0.035..0.086) factor=0.24 **lvl=4 darken=10** lm(15,0)=(39,39,71)；
    t=23000 镜像 13000。夜间无任何红色分量。
  - 截图（`Read` 逐张看过）：`shots/light/t6000-noon.png`（正常明亮）、`t12500-sunset.png`（深蓝黄昏、轮廓可见）、
    `t13500-dusk.png`、`t18000-midnight.png`（天空近黑、地形深蓝剪影、月光/星星 19 个亮点、地平线深蓝灰）、`t23500-dawn.png`。
    数值（`shots/light/analyze.mjs`）：平均亮度 noon 94.8 → midnight **13.0**（7.3×）；"红>蓝"像素占比
    midnight 1.95% ≈ sunset 2.06%（无红色偏置）；夜景天空区亮度 6.7/9.9/7.9（蓝青，非红）。

## 3. `SKY_LIGHT_LEVEL`（夜晚=4）到底被谁消费 —— 结论：**纯玩法，不进渲染**
- 唯一消费：`Level.updateSkyBrightness()` `Level.java:738-740` → `skyDarken = (int)(15 - 环境值)`；
  然后 `LevelReader.java:164/170` `getMaxLocalRawBrightness`→`getRawBrightness(pos, skyDarken)`、
  `LevelReader.java:173-175` `getEffectiveSkyBrightness = 天空光 - skyDarken`；`Level.java:384` `isBrightOutside = skyDarken < 4`；
  `PhantomSpawner.java:32` 用 `getSkyDarken() >= 5`。刷怪/日光传感器/睡觉判定走这条链。
- 渲染**不用**它：`LightmapRenderStateExtractor.java:55` 取的是 **`SKY_LIGHT_FACTOR`**（昼夜曲线 1→0.24），
  渲染进 lightmap 的天空光坐标仍是世界里的 0..15 天空光等级（顶点 aLight），由 `lightmap.fsh` 的 SkyFactor 压暗。
  所以夜晚"变暗"的是 factor 0.24，不是等级 4。TS 侧 `SkyState.skyLightLevel`(=15→4，float 精度 4.0000002) 与
  `skyDarken=(int)(15-值)=10` 只供玩法包读；**没有改 Shaders.ts**。
  已导出 `isBrightOutside(state)` / `effectiveSkyBrightness(rawSkyLight, state)` 给玩法包直接用（Level.java:384 / LevelReader.java:173）。
- 附带：`Level.java` 的 float 精度让午夜 skyDarken 真值是 **10**（不是 11），单测已锁。

## 4. 没做 / 已知问题（诚实）
1. `npx tsc --noEmit`：02:10 复查 **0 错误**（01:55 前曾有 1 条 sky 包 `CloudRenderer.ts:392 skyStateOf` 半成品错误，已由对方修好）。
2. **`Game.tick()` 调 `level.tick(1/20)`**（`Game.ts:1021`）：`ClientLevel.tick` 里 `time += dt`，20 tick/s × 0.05 → 一天 480000 秒。
   即浏览器里昼夜 20 倍慢（vanilla 20 分钟）。不属本包文件，未改，**请主管/主循环包修**。
3. 雨/雷：属性调制已实现并单测，但 `ClientLevel.rainLevel/thunderLevel` 目前没有写入路径（survival 包负责），实机未出现天气。
4. `blockLightFlicker`（火把闪烁，+1.4 抖动）未实现；night vision/darkness/boss 已在 buildLightmap 支持但调用方（效果系统）未接线。
5. 太阳/月亮方向：`SkyState.sunAngleDeg/moonAngleDeg` 已按时间线修正（正午 0°/午夜 180°、12600/23400 过地平线），
   但 **sky 包 `environment/SkyRenderer.ts:305-306` 仍用自己的 `timeOfDay*2π` 公式**、render 包阴影也要同一方向 —— 需它们改读 SkyState（本包未改别人的文件）。
6. 采样是"连续时间"求值；vanilla 是整数 tick 求值后 partialTickLerp（≤1 tick 差，角度的 ofDegrees(90) 回绕已按语义实现）。
7. 没有 `shots/ref/INDEX.md`（reference 包 02:00 时尚未产出），夜景以 `lightmap.fsh` 手算值为准。
8. 对共享文件：`EnvironmentLighting.ts`（我拥有）+ `Game.ts` render() 开头约 15 行（已在上文说明）。
   其他包可直接消费：`SkyState`（只增字段）、`computeSkyState(time, brightness, opts)`、`FogState.computeFog(...)`。
