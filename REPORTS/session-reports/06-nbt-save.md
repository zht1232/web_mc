# NBT / 区块序列化 / 存档报告

31 个新文件 + `LevelChunk.ts` 4 处最小增量 + `scripts/test-save.mts`。
`npx tsc --noEmit` 全项目 0 错误；测试 **49 passed / 0 failed**（连跑 5 次稳定）。

## 文件

`src/vanilla/nbt/**`：`Tag`, `EndTag`, `ByteTag`, `ShortTag`, `IntTag`, `LongTag`（BigInt 保真）,
`FloatTag`, `DoubleTag`, `ByteArrayTag`, `StringTag`（modified UTF-8）, `ListTag`,
`CompoundTag`, `IntArrayTag`, `LongArrayTag`, `TagTypes`, `NbtIo`（gzip 与 uncompressed，
浏览器 `CompressionStream` ↔ Node `zlib` 交叉兼容）, `NbtUtils`, `StringTagVisitor`（SNBT）。

`src/vanilla/world/level/storage/**`：`ChunkSerializer`（`Sections` / `block_states:
{palette,data}` / `biomes` / `BlockLight` / `SkyLight` / `y`，palette 用
`minecraft:<name>[prop=value]` 字符串，位压缩对照 `SimpleBitStorage`）、
`RegionFile`（**内存实现** 4096 字节扇区表 + 时间戳表 + zlib chunk payload，可导出真实 `.mca`）、
`LevelStorage` / `LevelSummary`（`level.dat` 的 `Data` 结构）、`PlayerData`。

`src/client/world/save/**`：`SaveDatabase`（IndexedDB，object stores `worlds`/`chunks`/`players`/`regions`，
批量事务 ≤16 chunk）、`WorldSaveManager`、`Autosave`。

## 关键保真点

- BigInt LongTag、modified UTF-8、gzip/zlib 双压缩 + `CompressionStream` ↔ `zlib` 交叉兼容。
- vanilla `SimpleBitStorage` 位压缩逐位对照验证。
- 4096 对齐的真实 `.mca` 扇区表，导出的字节可被原版读取（结构上）。
- `level.dat` / 玩家 NBT 字段与 26.2 一致：`Data.{LevelName, RandomSeed, GameType,
  Difficulty, SpawnX/Y/Z, Time, DayTime, Raining, RainTime}`，玩家 `Pos/Motion/Rotation/
  Health/foodLevel/Inventory/SelectedItemSlot/XpLevel`。

## 测试输出（节选）

```
PASS  1  12 种 tag 的 CompoundTag 写→读→深度相等；LongTag 0x7fffffffffffffff 保真；SNBT 往返
PASS  2  gzip 与 uncompressed 两种 NbtIo 都能往返
PASS  3  ChunkSerializer 200 种随机状态 + 光 + 群系逐格相等  17747 B -> deflate 1784 B
PASS  4  RegionFile 写 4 chunk 重读全部正确，扇区表不重叠，4096 对齐
PASS  5  createWorld -> savePlayer -> flushDirty -> loadWorld 全量恢复；删除后清空
PASS  6  单区块序列化 0.36~0.81 ms (<2 ms)；100 chunk 首帧写 7~12 个、7 帧排空
49 passed / 0 failed  EXIT=0
```

## 集成接口

```ts
const manager = await WorldSaveManager.open();
const id = await manager.createWorld({ name, seed, gamemode, difficulty });
await manager.loadWorld(id);            // {level, chunks, player}
await manager.flushDirty(level, player, budgetMs);
await manager.savePlayer(player, extra);
await manager.exportRegion(worldId, rx, rz);   // 真正 .mca
// Autosave: 每 6000 tick + visibilitychange/pagehide（beforeunload 需主循环另绑）
```

`WorldSaveManager` 实现了 `WorldListProvider`（`list/create/delete/load` + `rename/getSummary`），
直接注入 `ScreenDeps.worlds` 让 `SelectWorldScreen` 列出世界。

## 简化项

palette 用字符串形式而非注册表 id codec；群系用可逆 id codec；
区块 codec 省略部分 26.2 新字段（升降机/结构引用等）；
`RegionFile` 是内存实现（无 mmap）；`LevelChunk.ts` 的 4 处增量是
`dirtySections: Set<number>` / `markDirty(x,y,z)`，供 `flushDirty` 判断脏区块。
