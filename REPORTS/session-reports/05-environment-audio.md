# 环境渲染 / 粒子 / 音效报告

## 文件

`src/client/renderer/environment/`：`EnvCommon.ts`（结构类型、时间/雨量兼容、
`computeViewProj`、`loadEnvTexture`、GL 状态恢复）、`CelestialBodies.ts`（8 月相）、
`SkyRenderer.ts`（天空渐变/日出光晕/天体/1,500 星点 VBO/末地天空）、
`CloudRenderer.ts`（12×12 网格、fast/fancy 3 层）、
`WeatherRenderer.ts`（雨雪柱、闪电闪白 + 雷声回调）。

`src/client/particle/`：`Particle.ts`（19 类型参数表 + 10,000 槽位 SoA 池）、
`ParticleEngine.ts`（instanced 单 draw call、单例、spawn 便捷函数）、
`ParticleSprites.ts`（图集打包算法 + 生成编排）。

`src/client/audio/`：`SoundEvents.ts`（28 事件 + 别名）、`SoundEngine.ts`（WebAudio）、
`MusicManager.ts`。

资源：`public/mc/sounds/**`（112 ogg + `index.json`）、`public/mc/particle_atlas.png`、
`public/mc/particles.json`。

## 移植的 Java 类

26.2 已把天空重构为独立类：`SkyRenderer.java`, `CloudRenderer.java`,
`WeatherEffectRenderer.java`, `LevelRenderer#addSkyPass/addCloudsPass/addWeatherPass`；
另有经典 `renderClouds/renderSnowAndRain`。粒子对照 `Particle.java`、
`ParticleEngine.java`、各 `*Particle.java`、`core/particles/ParticleTypes.java`、
`assets/minecraft/particles/*.json`。音频对照 `SoundManager.java` + `SoundEngine.java`
（`calculateVolume = clamp(vol)*category*master`、LINEAR 衰减
`attenuationDistance = max(vol,1)*16`）、`MusicManager.java`（`STARTING_DELAY=100`）。

## 资源实测

| 项 | 数量 |
|---|---|
| ogg 音效 | **112 个 / 28 事件**（源 `official-assets-mc/sounds/<event>/`；26.2 **无 sounds.json**） |
| 粒子贴图 / 定义 / 引用 | 288 PNG / 112 定义 / 494 处引用，图集 512×512，0 unresolved |
| 月相 PNG | 8 |
| 环境贴图 | 14 |

## 测试输出（`npx tsx scripts/test-audio-particles.mts`）

```
PASS  源 ogg 数量 == 复制数量 — src=112 dst=112
PASS  index.json 每个路径存在 — checked=112 missing=0
PASS  池满后 add 返回 -1，容量保持 10000
PASS  tick 300 帧后无 NaN、槽位未越界
PASS  平均帧耗时 < 2 ms — avg=1.262ms worst=3.943ms total=378.5ms/300f
PASS  同 seed 60 帧指纹完全一致；不同 seed 轨迹不同
PASS  fast 1734 顶点 = 289 gridCells × 6；fancy = fast × 3
PASS  UV 在 0..1；全空 alpha 生成 0 顶点
PASS  图集 512×512 / 288 sprites；494 处引用全部解析
ALL CHECKS PASSED
```

## 集成接口

```ts
const sky = new SkyRenderer(gl); await sky.init();
const clouds = new CloudRenderer(gl, { height: 192.33 }); await clouds.init();
const weather = new WeatherRenderer(gl, { radius: 10 }); await weather.init();
weather.onThunder = (x,y,z) => SoundEngine.get().play('entity.lightning_bolt.thunder', x,y,z, .8);
const pe = ParticleEngine.get(); await pe.init({ blockArray: textures.block.texture });
pe.blockLayerForState = id => /* block/<name> -> texture array layer */;
const sound = SoundEngine.get(); await sound.load('/mc/sounds/index.json');
sound.autoUnlock(); sound.resume();       // 用户手势

sky.render(view, proj, timeOfDay, camera, rain, level);
clouds.render(viewProj, camera, tickTime, level);
weather.tick(camera, level, dtTicks); weather.render(viewProj, camera, tickTime, level);
pe.tick(); pe.render(viewProj, partial);
sound.tick(camera, level);
```

GL 状态契约：所有 `render()` 只画到当前绑定的 framebuffer，不调用
`bindFramebuffer`/`viewport`/`clear`；进入时假定 `DEPTH_TEST` 开、`depthFunc(LEQUAL)`，
返回前恢复 `depthMask(true)` / `CULL_FACE BACK` / `BLEND off`。可与离屏后处理管线共存。

## 接线阶段实测到的偏差（重要）

- `SkyRenderer.render` 真实签名是 `(view, proj, timeOfDay, camera, rainLevel, level?)`，
  **view/proj 要分开传**；文档写的 `(viewProj, ...)` 是错的。
- `skyStateFor(t) = computeSkyState(t*24000)`，0 = 日出；而 `ClientLevel.getTimeOfDay()`
  相位偏移 −0.75（0 = 午夜）。直接传会在午夜画出正午蓝天，已改为 `(level.time % 24000)/24000`。
- `CLOUD_HEIGHT` 默认 128 是 1.17 老值，原版 26.2 是 **192.33**
  （`dimension_type/overworld.json` + `EnvironmentAttributes.java`），用构造参数覆盖。
- 天气必须每 tick 调 `tick()` 才推进闪电/flash。
- `CloudRenderer` 是经典 12×12 平铺 + fancy 3 层；26.2 真实 `CloudRenderer.java`
  是逐像素体素挤出网格（12.0/4.0 挤出，顶 1.0 / 侧 0.9·0.8 / 底 0.7 面光照）——此项为简化，是「廉价感」的主要来源之一。
- 26.2 无 music/*.ogg，`entity.zombie.ambient`、`ambient.cave` 在资源包中不存在，
  用 `SOUND_ALIASES` 映射到最接近的可用音效。
- Safari 不支持 Ogg Vorbis；`decodeAudioData` 失败时静默跳过。
- `ClientLevel` 没有 `getMoonPhase()`/`isRaining()`，模块用 `LevelLike` 鸭子类型兼容。

## 与后处理的兼容

天空/日月/星空不写深度；云/天气/粒子用 `blend(SRC_ALPHA, ONE_MINUS_SRC_ALPHA)` +
`depthMask(false)`。闪电全屏闪白默认叠加在当前 color target，若光影合成阶段需要，
改读 `weather.flashIntensity` 在合成 shader 里加而非画全屏 quad。
