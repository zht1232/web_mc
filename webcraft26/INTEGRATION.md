# INTEGRATION.md — `Game.ts` 接线施工图

> 状态快照：2026-11-07 17:45，18:07 补第 11 节。写在第一批（features / entities / GUI）已完成、第二批（物品 / 环境粒子 / 存档）仍在跑的时候。
> **这份文档只描述“怎么接”，不含代码改动**。行号会随编辑漂移，改动时请按“函数名 + 附近语句”定位。
> **接口段落是抽样，不是全量记录**——只覆盖主循环必须调用的入口，构造参数默认值、模块的其余导出都没有逐一核对。**代码永远大于本文档。**
> 目标：把已经写完但一次都没被调用过的模块接进主循环，先出一张“有树、有生物、能开背包”的截图。

---

## 0. 一分钟版

1. `Game.init()` 末尾（`this.spawnPlayer()` 之后）创建 `EntityManager` / `EntityRenderDispatcher` / `ScreenManager`。
2. `tick()` 里调 `entityManager.tick()` + `pickupItems()` + `syncChunks()`。
3. `render()` 里在 `this.renderer.render(...)` 之后、`renderHud()` 之前画实体；`renderHud()` 之后调 `screenManager.render()`。
4. `bindInput()` 里把 key/mouse 先交给 `screenManager`。
5. `resize()` 里补一行 `screenManager.resize(w, h)`。

**features 不需要接线**——它已经在 `generateChunk()` 里，worker 构造 `NoiseChunkGenerator` 时第三个参数之后默认 `features = true`，重开页面世界上就该有树。

---

## 1. 文件所有权（并行期间唯一硬规则）

| 角色 | 可以改 | 禁止改 |
|---|---|---|
| 主 agent | `src/client/Game.ts`、`src/main.ts`、`src/client/style.css`、`index.html` | 子模块内部 |
| features | `src/vanilla/world/level/levelgen/**` | `Game.ts` |
| entities | `src/vanilla/world/entity/**`、`src/client/renderer/entity/**` | `Game.ts`、`LevelRenderer.ts` |
| gui | `src/client/gui/**` | `Game.ts`、`Hud.ts` 的既有 API |
| items / inventory | `src/vanilla/world/item/**`、`world/inventory/**`、`world/food/**` | `Game.ts` |
| environment / particle / audio | `src/client/renderer/environment/**`、`src/client/particle/**`、`src/client/audio/**` | `Game.ts`、`LevelRenderer.ts` |
| nbt / storage | `src/vanilla/nbt/**`、`world/level/storage/**` | `Game.ts` |

**不要替别人修类型错误。** 并行期间 `npx tsc --noEmit` 一定会报别人半成品的错，只看自己改过的文件。

---

## 2. 初始化：插在 `Game.init()` 里

锚点：`this.spawnPlayer();`（约 159 行）之后、`this.bindInput();` 之前。

```ts
import { EntityManager } from '../vanilla/world/entity/EntityManager.js';
import { EntityRenderDispatcher } from './renderer/entity/EntityRenderDispatcher.js';
import { ScreenManager } from './gui/ScreenManager.js';

// 1) 实体（必须在 player 之后：构造签名需要 ClientLevel + Player）
this.entityManager = new EntityManager(this.level, this.player as unknown as Player, BigInt(this.options.seed ?? 0x2602c0de), {
  despawnDistance: 128,
});
void this.entityManager.loadSpawnConfig('/mc'); // 可选：读 worldgen.json 的 spawners

// 2) 实体渲染器（构造即可，贴图异步加载）
this.entityRenderer = new EntityRenderDispatcher(this.gl);
this.onStatus?.('Loading entity textures', 0.92);
await this.entityRenderer.init('/mc/textures/entity');

// 3) GUI 屏幕管理（Canvas2D 覆盖层，复用已有 FontRenderer / ItemIconAtlas / GuiTextures）
this.screens = new ScreenManager(this.guiCanvas, this.gl, {
  mc: this.mc,
  models: this.models,
  font: this.font,
  textures: this.guiTextures,
  icons: this.icons,
  options: this.options,           // GameOptions 与 GuiOptions 结构兼容，可直接传
  callbacks: {
    onPlay: () => this.screens.close(),
    onOptionChange: (key, value) => { (this.options as Record<string, unknown>)[key] = value; },
    onRespawn: () => this.spawnPlayer(),
    onChatMessage: (text) => { /* 第三批接 chat */ },
    onClose: () => { /* 重新 requestPointerLock 的时机 */ },
  },
});
```

> `ScreenManager` 的 `deps.options` 要求 `GuiOptions`；`GameOptions` 的五个必需字段（renderDistance / guiScale / fov / brightness / gamemode）都对得上，`GuiOptions` 还带 `[key: string]: unknown`，所以直接传不会报错。

---

## 3. 每帧：插在 `render()` 里

当前顺序是 `renderer.render(...)` → 选中框 → `renderHud()`（约 627 行起）。

**3.1 先给 `LevelRenderer` 加一个 getter（唯一的越界改动，1 行）**

```ts
// src/client/renderer/LevelRenderer.ts，viewProj 字段旁
get viewProjection(): Float32Array { return this.viewProj; }
```

`EntityRenderDispatcher.render()` 需要 `viewProj: Float32Array`，而 `viewProj` 现在是 `private`。**不要让 entities agent 去改 `LevelRenderer`**，这一行由主 agent 加。

**3.2 在 `this.renderer.render(...)` 之后插入**

```ts
this.entityRenderer.render(
  this.entityManager.getEntities(),
  this.renderer.viewProjection,
  { x: camera.x, y: camera.y, z: camera.z },
  partial,
);
```

**3.3 在 `renderHud()` 之后插入**

```ts
this.screens.render(partial);
```

顺序不能反：`ScreenManager.render()` 会重置 `globalAlpha` / `globalCompositeOperation` 并清空 GUI canvas，HUD 必须先画完。菜单打开时它会隐藏 HUD，这是预期行为。

---

## 4. 每 tick：插在 `tick()` 里

锚点在 `this.chunkProvider.drain(this.level, 6);` 之后：

```ts
this.entityManager.tick();
this.entityManager.pickupItems(this.player.pos.x, this.player.pos.y, this.player.pos.z, 1.5);

// 区块加载同步给实体系统（否则生物只在初始区块里活动）
this.entityManager.syncChunks(
  [...this.level.chunks.keys()].map((k) => [(k >> 32) | 0, (k & 0xffffffff) | 0] as const),
);
```

`syncChunks` 每 tick 全量传会有一点开销；如果掉帧，改成“区块集合变化时才同步”（缓存上一次的 size + 边界）。

---

## 5. 输入改造：`bindInput()`

现状：`keydown` 直接进 `this.keys`，`mousemove` 只在 pointer lock 时转视角，`wheel` 是 `{ passive: true }`。

```ts
// ① 键盘：先问 GUI，被消费就 return
window.addEventListener('keydown', (e) => {
  const mods = (e.shiftKey ? 1 : 0) | (e.ctrlKey ? 2 : 0) | (e.altKey ? 4 : 0);
  if (this.screens.onKey(e.code, e.key, mods)) { e.preventDefault(); return; }
  ...
});

// ② 鼠标：菜单打开时转给 GUI，不要转视角
document.addEventListener('mousemove', (e) => {
  if (this.screens.current) { this.screens.onMouse(e.clientX, e.clientY, -1, 'move', 0); return; }
  if (!this.mouseLocked) return;
  ...
});

// ③ 点击：菜单打开时不要请求 pointer lock
canvas.addEventListener('click', () => {
  if (this.screens.current) return;
  if (!this.mouseLocked) canvas.requestPointerLock();
});

// ④ 滚轮：改成非 passive，并拦住触控板缩放
document.addEventListener('wheel', (e) => {
  if (e.ctrlKey) e.preventDefault();
  if (this.screens.current) { this.screens.onMouse(e.clientX, e.clientY, -1, 'wheel', e.deltaY); return; }
  ...
}, { passive: false });
```

呼出界面（替换现有 `onInventoryToggle` 等钩子）：

```ts
if (e.code === 'KeyE') this.screens.open(this.options.gamemode === 'creative' ? 'creative' : 'inventory');
if (e.code === 'KeyT') this.screens.open('chat');
if (e.code === 'Escape') this.screens.current ? this.screens.close() : this.screens.open('pause');
```

---

## 6. `resize()`

```ts
this.screens.resize(window.innerWidth, window.innerHeight);
```

放在 `this.gl.viewport(...)` 之后即可。

---

## 7. 接口速查（真实签名，抄自代码）

> ⚠️ **这是一份「主循环会用到」的入口清单，不是完整 API 清单。** 每个模块的导出都远多于这里列出的几个（例如 `SurvivalState` 有 20+ 个方法、`ParticleEngine` 还有 render/flush 一类接口）。写接线代码时，**以代码为准**：
>
> ```bash
> grep -nE "^export (class|interface|function|const)|^  (async )?[a-zA-Z]+\\(" src/client/gui/ScreenManager.ts
> ```

```ts
// EntityManager
new EntityManager(level: ClientLevel, player: Player | null, seed: number | bigint = 0, options?: EntityManagerOptions)
tick(): void
loadChunk(cx: number, cz: number): void
unloadChunk(cx: number, cz: number): void
syncChunks(chunks: Iterable<readonly [number, number]>): void
getEntities(): readonly Entity[]
spawn(name: string, x: number, y: number, z: number): Entity | null
pickupItems(x: number, y: number, z: number, radius = 1.5): number
loadSpawnConfig(base = '/mc'): Promise<void>

// EntityRenderDispatcher
new EntityRenderDispatcher(gl: WebGL2RenderingContext, base = '/mc/textures/entity')
init(base = '/mc/textures/entity'): Promise<void>
render(entities: Iterable<Entity>, viewProj: Float32Array, camera: { x: number; y: number; z: number }, partialTick: number): void
get lastDrawCallCount(): number

// ScreenManager
new ScreenManager(canvas: HTMLCanvasElement, gl: WebGL2RenderingContext, deps: ScreenDeps)
open(screen: ScreenRef, ...args: unknown[]): void   // 'title' | 'selectWorld' | 'createWorld' | 'options' | 'video' | 'controls'
                                                    // | 'language' | 'sound' | 'pause' | 'death' | 'chat' | 'inventory'
                                                    // | 'creative' | 'crafting' | 'furnace' | 'chest'
close(): void
back(): void
resize(w: number, h: number): void
render(partialTick: number): void
onKey(code: string, char: string, mods: number): boolean   // true = 已消费
onMouse(mx: number, my: number, button: number, action: 'down' | 'up' | 'move' | 'wheel', wheelDelta?: number): boolean
get current(): Screen | null

// ScreenDeps（必填：font / textures / icons / options / callbacks）
{ mc?, models?, font, textures, sprites?, icons, options, i18n?, worlds?, creativeTabs?, container?, callbacks, shaderQuality? }
```

---

## 8. 已知坑（今天踩过的，按踩坑概率排序）

1. **`NoiseChunkGenerator` 第 5 个参数是 `features`，默认 `true`**。`scripts/test-worldgen.mts` 里“plains 顶层必须是 grass_block”的旧断言会因为草/花而失败——要么改断言，要么显式传 `false`。
2. **`LevelChunk.ts` 在 17:31 被 NBT agent 改过**（加了区块序列化）。接线前先看一眼 `git diff`（若无 git，对比 `dist` 或手抄一份），确认 `setBlockState` / `getBlockState` 语义没被改动。
3. **`viewProj` 是 private**。实体渲染必须拿到矩阵，要么加 getter，要么在 Game 里重算——别让 entities agent 去改渲染器。
4. **GUI canvas 与 HUD 共用**。`ScreenManager.render()` 会清屏并重置 `globalAlpha`；顺序必须是 HUD → screens，否则 HUD 闪没。
5. **pointer lock 与菜单互斥**。菜单打开时要 `document.exitPointerLock()`，否则鼠标事件仍被锁在 canvas 上，按钮点不到。
6. **`wheel` 现在是 `passive: true`**，无法 `preventDefault`，触控板捏合会缩放整页。改 `false` 后注意别把页面滚动也拦死（游戏是全屏，无影响）。
7. **worker 里也构造了 `NoiseChunkGenerator`**（`chunk.worker.ts:48`，3 个参数），所以地形+特征是 worker 生成的；主线程那个 `this.generator` 只用于 HUD 的 `biomeName()`。调试“没树”时先看 worker console，不要只盯主线程。
8. **实体贴图是异步加载的**。`EntityRenderDispatcher.init()` 不 await 也能跑，但第一帧实体会是白块；建议在 loading 阶段 await（见第 2 节）。

---

## 9. 验收（三条，缺一不可）

```bash
npm run dev            # 或 npx vite --port 5174
node scripts/shot.mjs http://127.0.0.1:5174/ shots/after-integration.png 45000
```

1. **树**：截图里能看到竖直连续的 `oak_log` 树干 + 顶部叶团；F3 里 chunk 数与实体数正常。
2. **生物**：控制台 `__mc.entityManager.spawn('zombie', x+3, y, z)`，僵尸应朝玩家移动（距离单调下降）。
3. **界面**：按 `E` 出现背包/创造栏，按 `Esc` 出现暂停菜单，鼠标能点按钮（pointer lock 已释放）。

三条都过，才算“集成完成”；否则先修通再开下一批。

---

## 10. 分批顺序（不要一次接完六个）

```
① features（0 行改动，重开页面验证有树）
   ↓ 截图
② entities（Game.ts + LevelRenderer getter）
   ↓ 截图
③ GUI（Game.ts 输入/渲染挂载）
   ↓ 截图
④ 第二批回来后再逐个接：items → environment/particle → storage
```

每接一块就留一张同机位截图，出问题能立刻定位到是哪一块引入的。

---

## 11. 第二批落地后的接线入口（18:05 补记）

> 第一批接完再做这一节。接口是从刚写好的代码里读出来的，**接线前请再确认一次**（这批还在收尾，签名可能微调）。
>
> ⚠️ **本节只是抽样，不是全量记录。** 写这份文档时（18:05）第二批三个 agent 都还在跑：
> 存档 agent 停在 `test-save.mts`、物品 agent 刚写 `SurvivalState`、环境 agent 虽已交付但接口可能被后续改动。
> 我只抽取了「接进主循环必须调用的那几个入口」，**没有**逐个模块清点导出、也没有核对它们的构造参数默认值。
> 所以：**代码 > 本文档**。接线时对每个模块先跑一次
> `grep -nE "^export (class|interface|function)" <file>`，确认没有漏掉版本差异。

| 模块 | 入口 | 接到哪 |
|---|---|---|
| 天空 | `SkyRenderer.render(viewProj, camera, tickTime, level)` | `render()` 里替换现有 `renderer.renderSky(...)`；**必须先关掉旧的天空路径**，否则画两遍 |
| 云 | `new CloudRenderer(gl, opts)` / `render(viewProj, camera, tickTime, level)` | 同上，在天空之后、地形之前 |
| 天气 | `new WeatherRenderer(gl, opts)` / `render(...)` 同签名 | 与云同批次（雨/雪需要 `rainLevel`） |
| 粒子 | `new ParticleEngine(gl, ...)`；`await init()`；`add(spec)`；`tick()`；`buildInstanceData(viewProj, partial)` | tick 里 `tick()`；render 里在实体之后、HUD 之前 |
| 音效 | `new SoundEngine()`；`await load('/mc/sounds/index.json')`；**首次点击时 `resume()`/`autoUnlock()`** | 浏览器自动播放策略要求用户手势后才能出声 |
| 破坏 | `new BlockBreaking(mc)`；`tick(dtTicks, state, underwater)` 返回是否破坏 | **替换 `Game.tick()` 里那段 `breakProgress` 手写逻辑** |
| 生存 | `new SurvivalState(mc, seed, worldData)`；`tick(playerMoved)` / `mine(...)` / `damage(...)` | 替换 `HudState` 里写死的 `hearts: 20 / hunger: 20` |
| 存档 | `new WorldSaveManager(...)` + `new Autosave(manager, opts)`；`flushDirty(level, player, budgetMs)` | 在 tick 末尾调 `autosave.tick()`，**用预算版刷新，别整帧阻塞** |

### 这一批新增的三处冲突（接线前先看）

1. **`src/vanilla/world/entity/player/Inventory.ts` 在 17:50 被物品 agent 改过**。它属于 `entity/` 目录，但 entities agent 只承诺“不动 `Player.ts`”，没提 `Inventory.ts`——接线时确认玩家背包只有**一个**数据源，别一边用 `hotbar: number[]` 一边用 `Inventory`。
2. **现在的破坏逻辑有两套**：`Game.tick()` 里手写的 `breakProgress`，和新的 `BlockBreaking`（常量 30/100/0.2/5，照 Java 抄的）。接新的就删旧的，不要并存。
3. **`attack()` 目前直接 `setBlockState(..., 0)`**，没有掉落。接 `LootTable` 时注意：掉落物需要 `ItemEntity` + `EntityManager`，所以这条要等实体那步完成后再做。

### 一个可顺手修的值

`CloudRenderer.ts:19` 的 `CLOUD_HEIGHT = 128` 是 1.17 的老值。原版 26.2 是 **192.33**，来源：

- `data/minecraft/dimension_type/overworld.json:35` → `"minecraft:visual/cloud_height": 192.33`
- `net/minecraft/world/attribute/EnvironmentAttributes.java:53` → `defaultValue(192.33F)`

改一行即可。更长远的做法：凡是 `dimension_type` / `EnvironmentAttributes` 里已有的值都从 JSON 读，不在 TS 里写死。

