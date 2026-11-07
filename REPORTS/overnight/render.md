# render 包 — Complementary 风格光影管线（Phase A/B 已完成，Phase C 进行中）

## 1. 做了什么

| 文件 | 一句话 |
|---|---|
| `src/client/renderer/post/PostProcessor.ts`（新） | HDR 场景 FBO（RGBA16F，无 `EXT_color_buffer_float` 回退 RGBA8）+ 深度；bloom（预滤→5 级降采样→9-tap 可分离高斯→加性升采样）；composite（Lottes/Complementary tonemap + 0.12 mix bloom + BSL 饱和 + 亮度感知暗角 + 抖动）；FXAA 3.11；输出默认帧缓冲 |
| `src/client/renderer/post/ShadowMap.ts`（新） | 跟随相机的正交太阳/月光深度图（2048 默认，档位 1024/2048/4096），world-space 纹素吸附 |
| `src/client/renderer/post/PostShaders.ts` | `COMPOSITE_FRAG` 按 `composite5.glsl:36-104 + final.glsl:155-162` 重写（TM_EXPOSURE 1.0 / TM_CONTRAST 1.05 / hdrMax 8 / mid 0.25 / WHITE_PATH 1 / DARK_DESAT 0.25，bloom 是 mix 0.12）；bloom 预滤改线性空间；新增 `UPSAMPLE_FRAG`；`SHADOW_VERT/FRAG` 加 cutout alpha test |
| `src/client/renderer/Shaders.ts` | 地形片元：PCF 阴影（3×3 手写深度比较 + 斜率法线偏移）+ 直射阳光/月光项（`uUseShadows` uniform 开关，Off 时数值路径与原版一致）；雾改为 vanilla `fog.glsl total_fog_value`（环境球距 + 渲染距离柱距） |
| `src/client/renderer/LevelRenderer.ts` | `beginScene()/endScene()/resize()` + `shadow` pass（只画 SOLID+CUTOUT，按*光锥*剔除）；太阳/月光方向改读 `SkyState.sunAngleDeg/moonAngleDeg`（vanilla `SkyRenderer.java:334-360` 的 `(-sin,cos,0)`）；雾改调 `computeFog()`（`environment/FogState.ts`），删掉旧 fogStart/fogEnd 公式 |
| `src/client/Game.ts` | `render()` 在 clear 后 `beginScene()`、HUD 前 `endScene()`（hand/selection 也画进 HDR）；`resize()` 同步 post 目标；`options.shaders`（默认 true）/`options.shaderQuality`；F6 切换；`window.__mc.setShaders(on)` / `setShaderQuality(q)` |
| `src/client/gui/ItemIconAtlas.ts`（跨包 3 行） | 图标 pass 复用 `TERRAIN_FRAG`，必须给新增的 shadow sampler 一个合法 unit（unit 3 + `uUseShadows=0`），否则每次 draw 都 `GL_INVALID_OPERATION` |

档位：Off（直画屏幕，不经 FBO）/ Low（HDR+tonemap，无 bloom 无 FXAA，阴影 1024）/ Medium（bloom 4 级+FXAA，阴影 2048）/ High（默认，bloom 5 级，阴影 2048）/ Ultra（bloom 6 级，阴影 4096）。

## 2. 证据

**Off 与改造前像素一致**：同机位（spawn 228.5/-219.5，time=6000、1280×720）改造前 `readPixels` FNV 哈希 `6ad5e845`，接入管线后 Off 模式实测 `6ad5e845`（同一哈希，见 `shots/render/baseline.log` / `after1.log`）。

**色调映射/bloom 生效（`shots/render/capture.mjs`，1280×720，`gl.readPixels`）**：
```
off/day   luma=99.697 sat=0.4395      on/day   luma=87.485 sat=0.4419
off/night luma=10.286 sat=0.2376      on/night luma=7.153  sat=0.2138
```
截图（白天 on/off）：`shots/render/after1-day-on.png`、`after1-day-off.png`；夜间 `after1-night-on/off.png`；
bloom 拆解图 `shots/render/after2-day-hdr.png`（debug=1 原始 HDR 场景）与 `after2-day-bloom.png`（debug=2 只有 bloom）。
`glError=0`（每次测量后 `gl.getError()`），无 shader 编译警告。

**阴影（`shots/render/shadow-test.mjs`，白天 1500 tick，飞在 spawn 上方俯视）**：
```
shadowStats = {sections:114, draws:146, size:2048}       glError=0
raw HDR on vs off:      mad=5.673, 20.09% 像素变暗, max=89.2
最终画面 on vs off:     mad=5.556, 19.47% 像素差异, max=150
纹素吸附：m[12]/m[13] 均为 2/2048 的精确整数倍，maxDeviation=0（纹素 0.0703 格）
两帧同机位 raw HDR:     mad=0.149（仅剩动画粒子/实体）
fps: 阴影 on 56 / off 56（headless ANGLE D3D11，1280×720）
```
截图：`shots/render/shadow-day-on.png` / `shadow-day-off.png`；
阴影图直出：`shadow-debug-shadowmask.png`（白=受光，黑=阴影，能看到树/花草的影子）、`shadow-debug-ndl.png`。
> 说明：当前 spawn 附近地形较平，视觉差主要是“受光面更亮 20%”，树影在俯视截图里可辨但不夸张；数值为 19.5% 像素有 >12 的差异。

**类型检查**：`npx tsc --noEmit` 对本包文件 0 错误（现有残留错误均在其他包正在改的文件里，见 §3）。

## 3. 没做 / 已知问题

- **Phase C 水波尚未接**（`TERRAIN_VERT` 顶点两条正弦 + 深度透明度），正在做，完成后更新本节。
- Ambient/Direct 的观感：night 经 Lottes 曲线+暗角比原版 Off 暗约 30%（luma 10.3→7.2/11.3→8.0），这是 Complementary 的 filmic 行为；月光直射项已按主管要求压到 0.08。
- `PostProcessor` 的 dither 用每帧时间做噪声，所以同机位两帧会有 ±1 LSB 抖动（raw HDR 对比可绕开）。
- 与其他包无关但实测到的外部问题：entity 包 `EntityRenderDispatcher.ts` 有 4 个 TS2564（同事在改）；运行期偶发 `Cannot read properties of undefined (reading 'toFixed')`（HUD/light 侧，非本包）。
- 本包创建的临时验证脚本在 `shots/render/`（capture/probe*/shadow-test/vite-capture.config），不属于游戏源码。

## 4. 对其他包的依赖 / 共享文件改动

- **依赖**：`SkyState.sunAngleDeg/moonAngleDeg`（light 包，已按 Timelines 校验）、`SkyState.fog*Distance*`、`renderer/environment/FogState.ts` 的 `computeFog/argbFromRgb`。未自行再算太阳角，也未保留第二套雾逻辑。
- **改动别人的文件**：`gui/ItemIconAtlas.ts` 仅加 5 行（绑定 shadow sampler unit 3 + `uUseShadows=0`），原因见上；未改 `Game.ts` 其他包的接线段（render/resize/option/F6 之外未动）。
- **接口**：`renderer.beginScene()/endScene()` 现已接入 `Game.render()`；其他需要画进 HDR 的 pass（hand、breakingOverlay）无需改动，只要在 `beginScene/endScene` 之间画即可。`renderer.shaderQuality` / `renderer.shadersEnabled` 直接给 `gui/OptionsBridge.ts` 用。
- **未做 git 写操作**；开发服务器 5174 多次被别人的 watcher 崩溃带挂，本包验证用私有 5199（`shots/render/vite-capture.config.ts`，忽略临时文件）。
