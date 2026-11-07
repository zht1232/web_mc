# work-chunks — 区块卸载 + smoke/单测修复（TASK-bugs #2/#3/#5）

## 做了什么

1. `src/vanilla/world/level/ClientLevel.ts`（只新增方法/字段，未动天气/时间字段，未改 setBlockState 语义）：
   - `CHUNK_RETAIN_MARGIN = 3`，来源 `ClientChunkCache.calculateStorageRange = max(2, viewRange) + 3`
     （G:/ck-web26/src-vanilla/net/minecraft/client/multiplayer/ClientChunkCache.java:159）。
   - 新 API：`removeChunk(cx,cz)` / `unloadFarChunks(centerCx,centerCz,retainRadius)` /
     `countChunksOutside` / `hasDirtyChunksOutside` / `hasUnsavedChanges` / `isChunkModified`。
   - 卸载判据（Chebyshev 距离，同原版 `Storage.inRange`）：超出 retain 半径 **且** `dirtySections.size === 0`
     **且** 不在 `modifiedChunks`。进=renderDistance，留=renderDistance+3，滞回 3 格防抖动。
   - `modifiedChunks`：`setBlockState` 成功修改时 pin，该区块永不卸载。**有意偏离原版**：原版靠服务端重发
     存档副本，本客户端没有"存档优先"加载路径，卸载后按种子重生成会显示旧地形；代价只是"玩家实际动过的
     区块"常驻（飞行/生成不涨）。dirty 先 flush（`dirtySections` 清空）下一 tick 再删，兜住落盘。
   - 干净的新生成区块可安全卸载：NoiseChunkGenerator 同种子确定性重生成。
2. `Game.ts`（Lead 接线，已核对顺序）：tick 内 ensureChunksAround → drain → unloadFarChunks
   （先 `flushDirty(level, player, 4)` → `unloadFarChunks` → `entityManager.unloadChunk` ×N → `renderer.prune`）。
3. 新增 `scripts/test-chunkunload.mts`：12 项（滞回精确边界、跨边界不抖动、dirty 保护、pinned 保护、
   removeChunk 语义、半径 clamp≥2、传送后回落到 289 环）。
4. `scripts/test-worldgen.mts`：#8 平原 chunk 用 `features=false` 生成（features 默认开启会顶草）；
   #9 预算改 best-of-3 calibrate + CPU factor clamp[1,4] + 250 硬上限（依据写在注释）。
5. `scripts/smoke.mjs`：08 确定性 10 连放（pitch=50、清目标植物、每放完还原、断言 10/10 fail）；
   17 `await flushDirty(level, player, 50)` 按签名传参；15 扩成 marker→2000 格→15s 采样→传回验证。

## 证据（2026-11-08 01:5x，共用机被其它 agent 进程压满）

- `npx tsx scripts/test-chunkunload.mts` → `all checks passed`（12/12）
- `npx tsx scripts/test-worldgen.mts` → `all checks passed`（cold 287.18 / warm 270.58 ms/chunk，
  calibrate 24.98，normalised 108.33 = 4.33x 参考预算，< 250 硬上限）
- `node scripts/smoke.mjs --only placeBlock` → `PASS 08-placeBlock ... 10/10`（10 格全部 air->grass_block）
- `node scripts/smoke.mjs --only save` → `PASS 17-save`，`flushDirty(level, player, 50)`，**wrote=6 chunks**
  （原 pageerror "reading 'chunks'" 消失）
- `node scripts/smoke.mjs --only teleportFar` → 第 1 次 BOOT_TIMEOUT（本机 boot 105–129 s > 120 s 阈值，
  非场景问题，日志见 shots/chunks/smoke-15.log）；重跑结果见文末/给 Lead 的消息
- 日志与报告：`shots/chunks/smoke-08.log|smoke-17.log|smoke-15.log` + 各自 `report.json`
- tsc：本包文件 0 错误；同一时刻全仓其他文件有 Game.ts(HudItemSlot)/EntityRenderer.ts/FogState.ts 报错（非本包）

## 没做 / 已知问题

- 完整 19 场景冒烟未跑（按约定 Lead 最后跑一次）。
- `modifiedChunks` 区块常驻内存（仅玩家实际编辑过的 chunk；长途飞行不增长）。
- 上一会话已保存、本会话未编辑的区块被卸载后再访问仍按种子重生成（IndexedDB 副本要 reload 才生效）；
  彻底修需要 ChunkProvider 走"存档优先"加载路径，超出本次写作用域。
- ChunkProvider 无 cancel API：传送后旧位置在途 job 仍会生成并被同一 tick 卸载（内存有界，浪费 CPU/IDB）。
- 共用工作区 Vite watcher 会被别人写文件留下的 `.tmpdir` 触发 EBUSY 整站崩溃；自测改用轮询配置
  `shots/chunks/vite-poll.config.mjs`（临时文件，未改项目配置）。
