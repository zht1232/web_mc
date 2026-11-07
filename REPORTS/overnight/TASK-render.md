# TASK render — Complementary 风格光影管线（HDR / bloom / 色调映射 / FXAA / 太阳阴影 / 水）

先读 `REPORTS/OVERNIGHT-BRIEF.md`，再读：`REPORTS/session-digest.md` §7、`REPORTS/session-reports/05-environment-audio.md`（GL 状态契约）、`08-regression.md`（“进行中的工作”一节）。

## 现状
`src/client/renderer/post/PostShaders.ts`（235 行）已有 Complementary 风格 GLSL（`FULLSCREEN_VERT`、`COMPOSITE_FRAG`、`BLOOM_PREFILTER_FRAG`、`BLUR_FRAG`、`FXAA_FRAG`、`SHADOW_VERT/FRAG`），**但没有任何调用代码**。`LevelRenderer.render()` 直接画到默认帧缓冲；`Game.render()` 依次画 sky→clouds→terrain→entities→particles→weather→选择框，然后 HUD（HUD 在独立的 2D canvas 上，不受 GL 管线影响）。

参数必须以 Complementary 解包为准：`G:/web_mc/_src/thirdparty/thirdparty/complementary-reimagined-r5.9.3`（默认值在 `shaders/lib/common.glsl` 顶部 `#define`，函数在 `shaders/lib/**`，各阶段在 `shaders/program/**`）。凡是写进 GLSL 的常数，注释里写明来源文件与行。

## Phase A —— 最高优先（目标 03:15 前能在浏览器里看到效果）
1. `renderer/post/PostProcessor.ts`：HDR 场景 FBO（`RGBA16F`；无 `EXT_color_buffer_float` 回退 `RGBA8`）+ 深度；`resize(w,h)`；`beginScene()`/`endScene()`；bloom = 预滤 → 降采样链 → 9-tap 可分离高斯 → 升采样；composite（Lottes 色调映射、**bloom 以 0.12 mix**、饱和/对比/亮度感知暗角、抖动去色带）；FXAA 3.11；输出到默认帧缓冲。
2. `Game.render()` 接线：`gl.clear` 后 `beginScene`；sky/clouds/terrain/entities/particles/weather/选择框全部画进 HDR；HUD 前 `endScene`。各子渲染器不绑 FBO、不改 viewport（见 05 报告的契约）。**`hand` 包会在你之后再加第一人称手臂的调用，同样画进 HDR。**
3. 开关与档位：`options.shaders: boolean`（默认 true），`F6` 切换，`window.__mc.setShaders(on)`；档位 Off / Low（无 bloom 无 FXAA）/ Medium / High / Ultra，接已有的 `shaderQuality`（`gui/screens/options/VideoSettingsScreen` 的 `OptionsBridge` 读写 `window.__mc.renderer.shaderQuality`，先核对用法）。**Off 必须与现状画面像素级一致**（直接画屏幕，不经 FBO）。
4. 验收：白天/夜晚各一张 on/off 对比（`shots/render/`）；用 `gl.readPixels` 或 PNG 算平均亮度/饱和度证明管线生效；记录 on vs off 的 fps（`__mc.fps`）；窗口 resize 到 800×600 与 1920×1080 不崩、不糊；`glError` 为 0。

## Phase B（04:30 前）—— 太阳/月光阴影
1. `renderer/post/ShadowMap.ts`：跟随相机的正交深度图（texel snapping 防闪烁，默认 2048，画质档位 1024/2048/4096）；阴影 pass 复用 `SHADOW_VERT/FRAG`（树叶/植物 alpha test，水不投影）；`LevelRenderer` 增加 `renderShadow(...)`（只画 SOLID+CUTOUT，沿光线方向做视锥剔除）。
2. 地形片元：采样阴影（PCF 软阴影 + 斜率偏移，`sampler2DShadow` 或手写比较）；光影模式下加“直射太阳项”：强度随 `SkyState.sunAngleDeg`（太阳高度）与天空光；夜晚用月光（弱、偏蓝）；法线用 `dFdx/dFdy(vWorldPos)` 求。**光影 Off 时着色器路径必须等价于现在的原版光照**（用 uniform 开关，不要两套着色器漂移）。
3. 太阳方向必须与 `SkyRenderer`/`CelestialBodies` 画出的太阳位置一致（核对 `SkyState.sunAngleDeg` 与 sky 包渲染的方向，不一致在报告里指出并协调）。
4. 验收：同一机位阴影 on/off，白天树影/方块影可见、不随相机移动闪烁（连拍两帧 + 平移 0.3 格的差分）。

## Phase C（余下时间，择优）
1. 水面（digest §7）：顶点阶段两条正弦波（`worldPos.xz*14`，`sin(t*0.7−z*0.14+x*0.07)+sin(t*0.5−z*0.10+x*0.05)`）、按水深透明度 `1−exp(Δ·0.075)`、Fresnel 与天空反射；水下色调。
2. 雾：消费 `renderer/environment/FogState.ts`（light 包正在写，出现前保持现有雾逻辑，**不要自己写第二套**）。
3. SSAO、TAA 只在 A/B 完全稳定后再碰。

## 文件所有权
`src/client/renderer/post/**`、`LevelRenderer.ts`、`Shaders.ts`、`Game.ts` 里的 `render()`/`resize()`/option 接线部分（Edit 小改，改前重读）。
注意：`Shaders.ts` 刚修了 `vLight.yx`（光照贴图轴向），别改回去。

## 交付
`REPORTS/overnight/render.md`。Phase A 完成后立刻在最终回复前先写一版报告（方便主管中途检查），Phase B/C 完成后更新。
