# work-chunks — 区块卸载 + smoke/单测修复（TASK-bugs #2/#3/#5）

**做了什么**
1. `src/vanilla/world/level/ClientLevel.ts`（只新增方法/字段，未动天气/时间字段，未改 setBlockState 语义）：
   - `CHUNK_RETAIN_MARGIN = 3` ← `ClientChunkCache.calculateStorageRange = max(2, viewRange) + 3`
     （G:/ck-web26/src-vanilla/net/minecraft/client/multiplayer/ClientChunkCache.java:159）
   - 新 API：`removeChunk` / `unloadFarChunks` / `countChunksOutside` / `hasDirtyChunksOutside` /
     `hasUnsavedChanges` / `isChunkModified`
   - 卸载判据：Chebyshev 距离 > retain **且** `dirtySections.size === 0` **且** 不在 `modifiedChunks`；
     进半径=renderDistance、留半径=+3，滞回 3 格防抖动
   - `modifiedChunks`：`setBlockState` 成功即 pin、永不卸载。**有意偏离原版**：本客户端无"存档优先"加载
     路径，卸载后按种子重生成会显示旧地形；代价只是玩家实际改过的区块常驻（飞行/生成不增长）
   - dirty 区块先 flush（`dirtySections` 清空）下一 tick 再删；干净的新生成区块可安全卸载（同种子确定性）
2. `Game.ts`（Lead 接线，已核对）：tick 内 ensureChunksAround → drain → unloadFarChunks
   （`flushDirty(level,player,4)` → removeChunk → renderer.prune → entityManager.unloadChunk）
3. 新增 `scripts/test-chunkunload.mts`：12 项（滞回边界、不抖动、dirty 保护、pinned 保护、removeChunk、
   半径 clamp、传送 289 回落）
4. `scripts/test-worldgen.mts`：#8 平原 chunk 显式 `features=false`；#9 预算 best-of-3 calibrate +
   CPU factor clamp[1,4] + 250 硬上限（依据写在注释）
5. `scripts/smoke.mjs`：08 确定性 10 连放（pitch=50、清目标植物、放完还原、<10 fail）；17
   `await flushDirty(level, player, 50)` 按签名传参；15 marker→2000 格→15s 采样+旧区块卸载断言→传回验证

**证据**（2026-11-08 01:50–02:12，共用机被其它 agent 进程压满）
- `npx tsx scripts/test-chunkunload.mts` → `all checks passed`（12/12）
- `npx tsx scripts/test-worldgen.mts` → `all checks passed`（cold 287.18/warm 270.58 ms/chunk，
  calibrate 24.98，normalised 108.33 < 250）
- `node scripts/smoke.mjs --only placeBlock` → `PASS 08-placeBlock ... 10/10`（10 格全部 air->grass_block）
- `--only save` → `PASS 17-save`，`flushDirty(level, player, 50)`，**wrote=6 chunks**（原 pageerror 消失）
- `--only teleportFar` → `PASS 15-teleportFar`：marker short_grass→gold_block 传回后仍 gold_block；
  chunks 114→170（满视野 289，最后3样本 150/162/170）；旧区块 10,-9 传送后 `hasChunk=false`；
  原点 16,-8 因 marker 编辑 pinned，仍加载=true modified=true（符合设计）
- `npx tsc --noEmit` → 0 错误（全仓）；日志：`shots/chunks/smoke-{08,17,15}.log` + report.json

**没做 / 已知问题**
- 完整 19 场景冒烟未跑（按约定 Lead 最后跑一次）
- `modifiedChunks` 区块常驻内存（仅玩家编辑过的）；上一会话已保存、本会话未编辑的区块卸载后再访问仍按
  种子重生成（DB 副本 reload 后生效），彻底修需 ChunkProvider 存档优先加载，超出本次写作用域
- ChunkProvider 无 cancel API：传送后旧位置在途 job 仍会生成并被同一 tick 卸载（内存有界、浪费 CPU/IDB）
- 高负载下 15 s 内新区域只加载到 ~170/289，故 15 场景用"≤1.4×满视野 + 旧区块直接 hasChunk=false"双断言，
  不依赖满载环；空闲机重跑应看到 ≈289 后稳定
