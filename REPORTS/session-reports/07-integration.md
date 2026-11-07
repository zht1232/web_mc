# 主循环接线报告（按 `INTEGRATION.md` 顺序）

唯一改动的源码文件：`src/client/Game.ts`（714 → 1281 行）。
`renderer/**`、`gui/**`、`vanilla/**` 一行未动。
6 个阶段每阶段结束 `npx tsc --noEmit` 均 0 错误，并留截图。

## 阶段 0：出生点（先修的真 bug）

实测 `(16,-7)` 列 `getHeight` 返回 64，但 64/63 是 `short_grass`，62→53 全是水——
旧判据只看 `getHeight`，玩家被丢进 `lukewarm_ocean` 水下（y=53，海平面 63），
画面全是海带，看不到树。

- `findSpawnSpot()`：从 (8,8) 螺旋外推到 512 格，**只用** `generator.getSurfaceHeight()`
  （纯噪声、不生成区块、全程 93 ms），取第一个 `h >= seaLevel+1` 的列。
- `findStandingY()`：自上而下要求非空气、非液体、`mc.collision(state).length>0`、
  `y>=seaLevel`，上方两格无碰撞无液体。
- `generateSpawnArea()` 改为围绕真实出生区块生成 5×5（原来围着原点生成海洋区块，白花 1.7 s）。
- 结果：出生点 `(228.5, 70, -219.5)`，`sparse_jungle`，站在 `grass_block` 上，5 s 后 y 不变。

## 阶段 1–5 摘要

| 阶段 | 接线 | 验收 |
|---|---|---|
| 1 entities | `init()` 建 `EntityManager`+`EntityRenderDispatcher`；`tick()` 里 tick/pickup/`syncEntityChunks()`；`render()` 在 `renderer.render()` 之后画实体 | `spawn('zombie')` 距离 3.00→1.51 单调下降，draw call 1 |
| 2 GUI | `ScreenManager`；keydown 先 `onKey`、菜单打开吞掉游戏键并 `keys.clear()`；mousemove/wheel/mousedown 转 GUI 且不开 pointer lock；`E`/`T`/`Esc`；`renderHud()` 之后 `screens.render()`；`resize()` 补 `screens.resize()` | E 出创造背包、Esc 出暂停、真实鼠标点击三级跳到视频设置 |
| 3 items | `hotbar` 改 getter、`selectedSlot` 改 setter，两者读写 `survival.inventory`；删掉手写 `breakProgress`，改 `survival.mine()`→`breakBlock()`→`ItemEntity`→`inventory.add()`；HUD 用真实 health/hunger/xp | 铁镐挖石头 150ms 时仍 `stone`(进度 0.53)，之后 `air` + 掉 `cobblestone`，走近进背包 |
| 4 环境 | 顺序 `sky→clouds→terrain→entities→particles→weather→selection→HUD→screens`，关闭旧 `renderer.renderSky()`；云高传 192.33；`ParticleEngine`；`SoundEngine` 解锁 | 云动、入夜星空、雨丝、破坏粒子（池内 20 alive）、`isUnlocked=true` |
| 5 存档 | `WorldSaveManager` + `Autosave`，init 恢复世界，6000 tick 自动保存，pagehide/beforeunload 保存，`ScreenDeps.worlds` 注入 | 改 3 个 gold_block → reload → 方块、玩家位置、时间全部恢复 |

## 16 处「文档 vs 真实代码」偏差（逐条适配）

| # | 文档说法 | 真实代码 / 后果 | 适配 |
|---|---|---|---|
| 1 | `syncChunks([...keys].map(k => [(k>>32)\|0, k&0xffffffff]))` | `Geometry.chunkKey = (cx+32768)*65536+(cz+32768)`。**致命**：解码全是垃圾，生物第一次 tick 就被剔除（实测 spawn 后 4s `count:0`） | 改 `[...level.chunks.values()].map(c => [c.x,c.z])` |
| 2 | `pickupItems` 用来拾取 | 只 `count += e.getItem().count; e.remove()`，**不入背包** | 自己遍历 `ItemEntity` → `fromEntityStack` → `inventory.add()` → `remove()` |
| 3 | `SkyRenderer.render(viewProj, camera, tickTime, level)` | 真实 `(view, proj, timeOfDay, camera, rainLevel, level?)`，view/proj 分开 | 传 `renderer.viewMatrix / projection` |
| 4 | `timeOfDay` 未说明 | `skyStateFor(t)=computeSkyState(t*24000)` 0=日出；`getTimeOfDay()` 0=午夜 | 传 `(level.time % 24000)/24000`，否则午夜画正午蓝天 |
| 5 | 云默认高度 | `CLOUD_HEIGHT=128`（1.17 值） | `new CloudRenderer(gl,{height:192.33})` |
| 6 | 天气只列 `render()` | 还需 `tick()` 才推进闪电 | tick 里每帧调用 |
| 7 | `deps.options` 直接传不报错 | `GuiOptions` 有索引签名，`GameOptions` 无 | `as unknown as GuiOptions` |
| 8 | — | `LevelLike.rainLevel` public，`ClientLevel.rainLevel` private | `private levelLike = this.level as unknown as LevelLike` |
| 9 | — | 两套 `ItemStack`：`world/item/ItemStack` vs `LivingEntity.ItemStack{id,count}`；`ItemEntityRenderer` 读 `.id` | `toEntityStack()/fromEntityStack()` 边界转换，否则崩在 `id.length` |
| 10 | `BlockBreaking.tick(dt,state,underwater)` 4 参 | 真实 5 参 `(dt,state,held,underwater,efficiency)` | 走 `SurvivalState.mine()` |
| 11 | 粒子用 `buildInstanceData()` 画 | 公开绘制入口是 `render(viewProj, partial)` | 用 `render()` |
| 12 | — | `blockLayerForState` 收 state id，`blockTextureLayer()` 要纹理名 `block/<name>` | 加 `blockLayerFor(state)`：试 `block/`、`_top`、`_side`、`_still`，兜底 `state % 1230` |
| 13 | 首次点击 `autoUnlock()` | `autoUnlock()` 是 `{once:true}`，手势早于 `load()` 时 `resume()` 空操作 → 永不解锁 | `load()` 后补 `resume()`，keydown/mousedown 里 `if(!isUnlocked) resume()` |
| 14 | keydown 只「先给 `onKey`」 | `onKey` 对未消费键返回 false | 追加 `if(screens.current){preventDefault;keys.clear();return}`，否则背包开着还能走动 |
| 15 | `Autosave` | `attach()` 不绑 `beforeunload` | 额外绑 `beforeunload → autosave.quit()` |
| 16 | 建 `ScreenManager` 时传 worlds | `deps` 构造时被捕获 | 存档管理器必须在 `ScreenManager` 之前建好 |

## 尚未接上

1. **自然刷怪 0 只**（BLOCKED，非接线问题）：66 群系配置已加载，但 158 条 `ENTITY_TYPES` 只有 15 条有 factory（`noType:616`），另一半 `checkSpawnRules` 失败（`rulesFail:400`，`getHeight` 返回植物顶）。手工 `spawn()` 正常。`spawnInterval` 默认 400 tick。
2. **天气无模拟**：`ClientLevel.rainLevel` private、`raining` readonly false，加 `Game.setRain(0..1)` 手动驱动。
3. **死亡界面未接**：`SurvivalState.damage()` 无人调用（无摔落/生物伤害）。
4. `SelectWorldScreen` 的「进入世界」只绑 IndexedDB，不重建当前 level（需整页 reload）。
5. 聊天只 `console.log`；`creativeTabs` 未注入。
6. 铁镐图标空白（`ItemIconAtlas` 缺该模型）；快捷栏第 9 格空（water 不是物品）。

## 实测性能（headless SwiftShader 1280×720，软件光栅）

fps 10~12（接线前也是 10，无回退）；chunks 56→289（跑满 RD 8）；
mesh sections 峰值 1204，mesh 6.5~16 ms/帧（预算 6ms）；
entity draw 1~2；`4w queue 66~139 inflight 8`；
289 chunks 的 `flushNow` 一次完成，正常 `flushDirty` 每帧 ≤16 chunk / 8ms。

## 结论

**能**：走（W 1.2s 位移 2.12 格，菜单打开时 0）、挖（生存需时间、掉 cobblestone）、
捡（进背包、HUD 计数变）、开背包（E 开合、鼠标可点、生存/创造两套）、
存档（改方块→刷新→改动和玩家位置都在）。
