# 帧率 / 移动流畅度 测试方案（PERF-TEST-PLAN）

> 目的：把「帧率低、移动不流畅」拆成**可测量的三类原因**（GPU 填充率 / 主线程 CPU / 区块流式），
> 用一条命令给出归属，而不是靠感觉改代码。
> 工具：`scripts/perf-audit.mjs`（Playwright + 真 GPU，读 `window.__mc` 与 `__bootTimings`）。
> 最近一次实测见 §5，修复记录见 §6。

---

## 1. 怎么跑

### 1.1 默认开启：自动采样 + 上报到 dev server（手机无需任何操作）

```bash
cd webcraft26
npm run dev
```

手机（同一 Wi-Fi）打开 **`http://<PC 局域网 IP>:5174/?play`**（不带任何参数）：

- 进世界 2.5 秒后自动静默采样 **12 秒**，然后把报告 `POST /__perf-log`；
- dev server 的 `vite.config.ts`（`perf-log-sink` 插件）把它落盘到
  **`webcraft26/logs/perf/perf-<时间戳>.json`**，PC 上直接看，不用碰手机；
- 页面里 `window.__perf` 也能看到同一个对象；控制台会打印 `[perf] 报告已上传`；
- 只采一次（每次刷新页面一次），不显示面板、不降分辨率。

要**手动模式**（面板 + 20 秒 + 50% 分辨率对照 + 可复制/下载）：

```
http://<PC IP>:5174/?play&perf=20
```

完全关掉：`?perf=0`。

> 没有 dev server 时（生产环境）上传失败会被静默忽略，不影响游戏。

### 1.2 桌面命令行

```bash
cd webcraft26
npm run dev                                  # 另开一个终端，5174 端口

node scripts/perf-audit.mjs                  # 基线：启动耗时 + 静止/行走帧分布 + draw call + CPU 分项
node scripts/perf-audit.mjs --full           # 追加 A/B 矩阵（关阴影 / 关 TAA / 关 SSAO / 画质档 / 关光影 / 降分辨率）
node scripts/perf-audit.mjs --sprint         # 按住 W+Ctrl 冲刺，专门看移动时的长帧
node scripts/perf-audit.mjs --json out.json  # 存 JSON，便于改前/改后 diff

# 复现「高分屏掉帧」：viewport 1920x1080 但 devicePixelRatio=2 → 3D 缓冲 3840x2160
W=1920 H=1080 DSF=2 node scripts/perf-audit.mjs --full
```

可调环境变量：`URL`（默认 `http://127.0.0.1:5174/?play`）、`W`/`H`/`DSF`、`GL_MODE=swiftshader`（无 GPU 时）、`CHROME_PATH`。

**要求**：测之前让世界流式加载完毕（脚本已内置 settle：mesh 队列与区块队列连续 4 次为空才开测）。
不 settle 的 p95 测的是「正在加载」，不是渲染。

---

## 2. 测什么（6 项指标）

| 指标 | 来源 | 含义 |
|---|---|---|
| `fps` / `p50` | rAF 间隔 | 平均帧率与中位帧时间 |
| `p95` / `p99` / `max` / `>25ms` | rAF 间隔 | **卡顿**。移动不流畅几乎都体现在 p95，而不是平均帧率 |
| `draws` | 包装 `drawElements/drawArrays` | 每帧 draw call（region 合批正常时 ≈100） |
| `gpu p50/p95` | `EXT_disjoint_timer_query_webgl2` 包住 `beginScene..endScene` | 3D 链（地形+实体+天空+后处理）的 GPU 时间 |
| `CPU per frame` | 包装 mesh/drain/entities/post/hud/sky/clouds/particles | 主线程各阶段耗时 |
| `boot` | `window.__bootTimings` | 每个加载阶段的时间戳，冷启动归属 |

另外脚本会打印 `buffer 3840x2160 (viewport 1920x1080 @2x)` —— **这一行是高分屏掉帧的第一嫌疑人**：
像素数 = 视口 × DPR²，GPU 成本近似线性。

---

## 3. 判读表（核心）

| 观测 | 结论 | 对应动作 |
|---|---|---|
| `gpu p50` ≈ 实际帧间隔（16.7/10/6.9ms），`CPU per frame` 很小 | **GPU 填充率瓶颈** | 降 `renderScale`、关阴影/TAA、降画质档；不要动合批 |
| `gpu` 远小于帧间隔，但某 CPU 分项（mesh/drain/entities）大 | **主线程 CPU 瓶颈** | 看该项：`mesh`→区块重建；`drain`→区块 apply/relight；`entities`→实体数 |
| 平均 fps 正常但 `p95/p99` 高、`>25ms` 有几帧 | **尖峰**（周期性） | 用 `--sprint` + CPU profile（见 §4）定位单帧长任务 |
| `idle` 正常、`walk` 的 p95 明显更高 | **流式卡顿** | 看 mesh 单 section 耗时；区块 apply 单块成本 |
| `--full` 里 `scale 50%` 与 `idle` 差很大 | 填充率瓶颈（同上） | 调 `renderScale` 或 `MAX_RENDER_PIXELS` |
| `--full` 里 `shaders off` 与 `idle` 差很大 | 后处理链成本 | 关 TAA/SSAO/阴影；或降画质档 |
| `draws` > 400 | 合批退化 | 检查 region 合批（4×4 区块）是否被打断 |

**判定阈值（1280×720 / 60Hz）**：`p95 ≤ 25ms` 且 `>25ms` 帧数 ≤ 3 视为流畅；`p99 > 50ms` 说明有 >3 帧的长卡顿，
玩家一定能感觉到。

---

## 4. 定位单帧长任务（p95 高时）

```bash
node -e "..."   # 或直接用 Chrome DevTools Performance 录 10s
```

仓库里已有现成脚本（`scripts/_tmp-prof.mjs` 已删除，可按下述重建）：用 CDP `Profiler.start` 录
6~10 秒，按 **self time** 排序，看排第一的函数。本次就是这样抓到
`BiomeColors.averageColorAt` 占 17.3% CPU + `renderShadowPass` 占 9.1% 的（见 §6）。

要点：`Profiler.setSamplingInterval: 200`，同时用 rAF 记录每帧间隔，把长帧时刻和 profile 对齐。

---

## 5. 本次实测（GTX 1050 Ti / ANGLE D3D11 / dev server / 已 settle）

### 5.1 1280×720 DPR1（案例 A：低分辨率，瓶颈在主线程）

| 用例 | fps | p50 | p95 | p99 | max | >25ms | draws |
|---|---|---|---|---|---|---|---|
| 修复前 idle | 56.0 | 16.5 | **37.7** | 48.9 | 53.4 | — | — |
| 修复前 walk | 47.3 | 17.3 | **50.9** | 79.5 | 83.5 | — | — |
| 修复后 idle | 60.2 | 16.3 | **21.8** | 27.0 | 28.9 | 2 | 112 |
| 修复后 walk | 60.2 | 16.7 | **19.3** | 21.0 | 21.0 | 0 | 112 |

CPU 分项（walk，修复后）：`entities 0.89 | hud 0.19 | mesh 0.10 | sky 0.06 | post 0.04`
GPU（`beginScene..endScene`）：p50 **7.6~8.9ms**，p95 10~18ms → 有 45% 余量，不是 GPU 瓶颈。

### 5.2 1920×1080 DPR2（案例 B：3D 缓冲 3840×2160，瓶颈在 GPU 填充率）

| 用例 | fps | p50 | p95 | p99 | max | draws | gpu p50 |
|---|---|---|---|---|---|---|---|
| 修复前 idle | 38.9 | 20.5 | **69.4** | 105.0 | 136.1 | 93 | **23.3ms** |
| 修复前 walk | 35.3 | 21.1 | **74.1** | 153.4 | 189.1 | 92 | **25.6ms** |
| 修复后 idle | 60.2 | 16.4 | **22.8** | 30.8 | 36.7 | 112 | **10.1ms** |
| 修复后 walk | 60.2 | 16.6 | **19.2** | 20.7 | 20.9 | 112 | **10.5ms** |

修复后 3D 缓冲被 `MAX_RENDER_PIXELS` 限制到 1920×1080，GPU 时间 23→10ms，帧率 39→60，p95 69→23ms。

### 5.3 冷启动

| | 修复前 | 修复后 |
|---|---|---|
| navigate → 第一帧（dev server） | 3000ms | **2050~2320ms**（多次运行） |
| 阶段（修复后） | — | assets 274 / worldgen 264 / renderer 308 / terrain 957（与后者重叠）/ render assets 860 / GUI 137 |

启动 profile 里剩下的大头：`GlProgram` 构造 + 驱动 `(program)` ≈ **420ms**（同步编译/链接着色器）、
`SoundEngine.load` 390ms（已从关键路径移到 `start()` 之后）、worldgen 数据解析 ≈ 260ms。

---

## 6. 已经定位到的根因与修法（本轮）

1. **生物群系染色每 quad 跑 25 次气候噪声**（`BiomeColors.biomeIdAt` → `generator.getBiome`）。
   叶子方块一个方块 6 个面 × 25 次采样，单 section 建网格峰值 **30ms+**，静止时也占 **17.3%** 主线程。
   → 改成读区块自带 biome palette（`ClientLevel.getBiome`，O(1)）。`averageColorAt` 从 17.3% → 0.4%。
2. **阴影 pass 每帧重算 region 最低地表**（16 chunk × 256 列 × 2 级级联），约 **2.4ms/帧**，占 9.1%。
   → `RegionGpu.minSurface` 缓存 + `surfaceDirty`，只在 region 重建时失效。
3. **高分屏 3D 缓冲过大**：DPR2 的 1080p = 3840×2160，GPU 23~25ms/帧 → 35~39fps。
   → `MAX_RENDER_PIXELS = 1920×1080` 上限 + 3D canvas CSS 放大（GUI canvas 仍按设备像素，HUD 不变形），
   外加自适应分辨率（`adaptRenderScale`，只在「主线程不忙但帧超时」时降档，避免 CPU 瓶颈时白降）。
4. **冷启动**：25 个出生区块串行等待 + worker 启动太晚 + 各资源串行加载 + 声音索引阻塞主线程。
   → worker 提前到 `MinecraftData` 之后立刻启动；只强制等待 3×3 区块（其余交给 tick 流式）；
   出生生成与渲染器/资源初始化重叠；models/worldgen/生存数据/字体/贴图 `Promise.all`；声音延后到 `start()`。

> 注意：**不要**把这些 GPU/资源 init 放进 `Promise.all`。它们共享同一个 WebGL context，
> 在 `await` 之间互相改 FBO/viewport/program 会稳定产生 `GL_INVALID_VALUE`（已踩过，`test-containers` 会抓到）。

---

## 7. 还没验证 / 需要你提供的信息

- **物品栏方块色调**：把我们的烘焙图标和贴图原值做了采样（石头顶面 121 vs 贴图 ~124，
  `faceShade` 常量与 vanilla `0.5/1.0/0.8/0.6` 一致），**没能复现出色差**。需要一张你看到问题的截图
  （哪个物品、背包还是手持、是不是创造模式栏），否则改了也是猜。
- 雾边界白幕（`HANDOFF-2 §10.3`，默认种子 `(-9579,-6694)`）未修。
- 长时间行走的 `p99`（区块 apply 尖峰）本轮只做了单次 4s 步行采样，建议用 `--sprint` 跑 30s 再确认。
- 动态分辨率的观感（3D 轻微变软）是否可接受；不接受可把 `MAX_RENDER_PIXELS` 调大或关掉 `adaptRenderScale`。

---

## 8. 附：smoke 08-placeBlock 的场景修正（不是渲染问题）

`node scripts/smoke.mjs` 的 `placeBlock` 场景长期只能到 3/10（`fail: ok < 10`，所以是红的）。根因不在放置代码：

1. pitch=50 时准星指向的格子就是玩家**自己站的**格子，vanilla `Level.isUnobstructed`
   （`BlockItem.canPlace` 的 `CollisionContext.placementContext`）会拒绝与玩家碰撞体重叠的放置 —— 这是正确行为。
   → 场景先沿视线反方向后退 2.5 格，并丢掉第 0 次（传送后的预热尝试）。
2. `isUnobstructed` 也包含 `LivingEntity`：附近游荡的动物会让某一次随机失败。
   → 场景开始时清掉非玩家实体（等价 `/kill @e[type=!player]`）。

修正后连续两次 10/10。`08-placeBlock` 之外，`12-creativeTab` 在 SwiftShader 下会因满视野（675 区块）只有
3~10 fps 而超时；用真 GPU 跑 `node scripts/smoke.mjs` 不受影响（HEAD 上同样如此，与渲染改动无关）。
