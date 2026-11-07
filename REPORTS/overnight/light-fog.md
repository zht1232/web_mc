# light 包 · fog 模块报告

## 交付
- `webcraft26/src/client/renderer/environment/FogState.ts`：26.2 雾体系纯函数移植（无 GL/DOM/import 副作用，CRLF，英文注释带 Java 行号）
- `webcraft26/scripts/test-fog.mts`：57 项断言，`npx tsx scripts/test-fog.mts`
- 本报告

## 导出 API（render 包直接消费）
```ts
type FogMedia = 'atmospheric' | 'water' | 'lava' | 'powder_snow';
computeFog(input?: FogInput): FogData              // = FogRenderer.setupFog
computeFogColor(input?: FogInput): [r,g,b]         // = FogRenderer.computeFogColor
linearFogValue(vertexDistance, start, end)         // fog.glsl:13
totalFogValue(spherical, cylindrical, envStart, envEnd, rdStart, rdEnd) // fog.glsl:23
fogSphericalDistance(pos:{x,y,z}) / fogCylindricalDistance(pos)        // fog.glsl:32/36
computeRainFogTargetMultiplier(input?) / computeRainFogMultiplier(input?) // 雨雾目标/缓动
argbFromRgb(rgb0..1, alpha=255)                    // SkyState.fogColor → FogInput
srgbLerp(t, from, to) / scaleRgb(color, sr, sg, sb) // ARGB.java 整数通道运算
```
`FogData` 字段同 `FogData.java:5-13`：`color:[r,g,b]`、`environmentalStart/End`、`renderDistanceStart/End`、`skyEnd`、`cloudEnd`。
`FogInput` 全可选，默认 overworld 值：fog #c0d8ff、sky #78a7ff、FOG_END 1024、SKY_FOG_END 512、CLOUD_FOG_END 2048、cloudRange 128、water #050533(-8/96)、void onset 32、minY -64；其余（rain/thunder/skyLight/biome、失明/黑暗/夜视、旁观者/抗火/waterVision、darkenWorldAmount、boss overlay）均为输入字段。

## 分支与来源行号
- 大气 AtmosphericFogEnvironment.java:25-95：天空色混入 `skyFogEnd/32 → clampedLerp(0.25,1) → pow(,0.25)`；雨/雷 `scaleRGB`；雨雾 `-160/-256`、`minRainFogEnd=min(96,end)`、`0.2/tick` 缓动；boss overlay `10/96`
- 水下 WaterFogEnvironment.java:14-35：waterVision `max(0.25,·)` 缩放 end，`skyEnd=cloudEnd=end`
- 岩浆 LavaFogEnvironment.java:13-36：`-6743808`；旁观者 `-8/rd*0.5`；抗火 `0/5`；普通 `0.25/1`
- 粉雪 PowderedSnowFogEnvironment.java:11-35：`-6308916`；`0/2`；旁观者 `-8/rd*0.5`
- 失明 BlindnessFogEnvironment.java:20-46：`distance=lerp(min(1,dur/20),rd,5)`；darkness=`dur/20`（endsWithin(19)）或 1
- 黑暗 DarknessFogEnvironment.java:20-38：`distance=lerp(blend,rd,15)`；darkness=`max(blend,void)`
- 颜色链 FogRenderer.java:99-175：void darkness、darkenWorldAmount（0.7/0.6）、waterVision/nightVision 的 `1/clamp(max,0.07,1)` 提亮；LAVA/POWDER_SNOW 不乘 darkness
- 渲染距离 FogRenderer.java:198-200：`span=clamp(rd/10,4,64)`；颜色源=首个 providesColor，雾形=首个 applicable（FogRenderer.java:36-45 顺序）

## 测试证据
`npx tsx scripts/test-fog.mts` → `PASS: 57   FAIL: 0   TOTAL: 57` / `RESULT: PASS`
20+ 手算采样点：白天/夜晚/雨天/雷/雨雾缓动(0.2、0.46)/日出朝向/水下(vision 0、0.4、1、非本地)/岩浆(普通、旁观、抗火、+失明)/粉雪/失明(5、19、20、∞、水下)/黑暗(blend 0、0.5、1)/夜视(∞、150t、被黑暗压制)/darken/虚空(y=-32、-48、-80)/boss/云距/自定义属性；期望值注释均给出算式。
`npx tsc --noEmit`：FogState/test-fog 0 错误；项目当前 12 行错误全部位于 entity 包（EntityRenderer/EntityRenderDispatcher/EntityModels，他人正在改）。

## 已知未做 / 偏离
- 纯函数不保存状态：`rainFogMultiplier`、失明/黑暗 blend、夜视剩余时长、rain/thunder/skyLight/群系降水、void 参数需 render 侧传入；省略 `rainFogMultiplier` 时用稳态目标（原版从 0 缓动，传上一帧 `computeRainFogMultiplier` 结果即可复现）。
- 着色器 UBO/GL 状态不在本模块；`EntityRenderDispatcher.ts:131` 已在调用 `computeFog`/`argbFromRgb`，接口已对齐。
- 未做：panoramic 相机 forwards、其它维度属性解析（吃 EnvironmentAttributes 解析后的值）、非 overworld 的 fog 属性默认值。
- 未做任何 git 写操作。
