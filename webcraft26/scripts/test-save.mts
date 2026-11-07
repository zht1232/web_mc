// NBT & save-persistence verification for the Minecraft Java 26.2 browser port.
//
//   npx tsx scripts/test-save.mts
//
// Six required groups + two bonus fidelity checks. Every check prints PASS/FAIL; any failure
// exits with a non-zero code. Node has no IndexedDB, so the save layer is exercised through the
// injectable IKeyValueStore / Map-backed fake (SaveDatabase.memory()) and a Node zlib codec.
//
// The only file-system reads are public/mc/blocks.json + blocks.bin for the real-data codec
// check (identical to scripts/test-features.mts), so the whole suite is headless.

import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { performance } from 'node:perf_hooks';
import zlib from 'node:zlib';

// ---- core NBT -------------------------------------------------------------
import { CompoundTag } from '../src/vanilla/nbt/CompoundTag.ts';
import { ListTag } from '../src/vanilla/nbt/ListTag.ts';
import { ByteArrayTag } from '../src/vanilla/nbt/ByteArrayTag.ts';
import { IntArrayTag } from '../src/vanilla/nbt/IntArrayTag.ts';
import { LongArrayTag } from '../src/vanilla/nbt/LongArrayTag.ts';
import { StringTag } from '../src/vanilla/nbt/StringTag.ts';
import * as NbtIo from '../src/vanilla/nbt/NbtIo.ts';
import { serialize, parse } from '../src/vanilla/nbt/StringTagVisitor.ts';
import { setCompressionCodec, deflate, type CompressionCodec } from '../src/vanilla/nbt/NbtCompression.ts';
import { CURRENT_DATA_VERSION } from '../src/vanilla/nbt/NbtUtils.ts';

// ---- storage --------------------------------------------------------------
import { MinecraftData } from '../src/vanilla/world/level/block/state/BlockState.ts';
import { LevelChunk, DataLayer, SECTION_VOLUME } from '../src/vanilla/world/level/chunk/LevelChunk.ts';
import { chunkKey } from '../src/vanilla/core/Geometry.ts';
import {
  ChunkSerializer, MinecraftDataBlockStateCodec, ReversibleBlockStateCodec, ReversibleBiomeCodec,
  type BlockStateCodec, type BiomeCodec, type ChunkCodecOptions,
} from '../src/vanilla/world/level/storage/ChunkSerializer.ts';
import { RegionFile } from '../src/vanilla/world/level/storage/RegionFile.ts';
import { LevelStorage } from '../src/vanilla/world/level/storage/LevelStorage.ts';
import { PlayerData } from '../src/vanilla/world/level/storage/PlayerData.ts';

// ---- save layer -----------------------------------------------------------
import { SaveDatabase } from '../src/client/world/save/SaveDatabase.ts';
import { WorldSaveManager, MAX_CHUNKS_PER_TRANSACTION } from '../src/client/world/save/WorldSaveManager.ts';
import { AUTOSAVE_INTERVAL } from '../src/client/world/save/Autosave.ts';
import type { ClientLevel } from '../src/vanilla/world/level/ClientLevel.ts';
import { Player } from '../src/vanilla/world/entity/player/Player.ts';

const here = path.dirname(fileURLToPath(import.meta.url));
const root = path.resolve(here, '..');

// Node zlib codec: same gzip / zlib-deflate byte formats as the browser CompressionStream.
const ZLIB_CODEC: CompressionCodec = {
  gzip: (d) => zlib.gzipSync(d),
  gunzip: (d) => zlib.gunzipSync(d),
  deflate: (d) => zlib.deflateSync(d),
  inflate: (d) => zlib.inflateSync(d),
};
setCompressionCodec(ZLIB_CODEC);

// ---------------------------------------------------------------------------
// harness
// ---------------------------------------------------------------------------
let passed = 0;
let failed = 0;
function check(name: string, cond: boolean, detail = ''): void {
  if (cond) { passed++; console.log(`[PASS] ${name}${detail ? ` — ${detail}` : ''}`); }
  else { failed++; console.log(`[FAIL] ${name}${detail ? ` — ${detail}` : ''}`); }
}
function section(title: string): void {
  console.log(`\n==== ${title} ====`);
}
function readArrayBuffer(file: string): ArrayBuffer {
  const b = fs.readFileSync(file);
  return b.buffer.slice(b.byteOffset, b.byteOffset + b.byteLength) as ArrayBuffer;
}

// fake MinecraftData: only isAir/isLiquid are needed by LevelChunk bookkeeping
const fakeMc = { isAir: (s: number) => s === 0, isLiquid: () => false } as unknown as MinecraftData;

function makeLevel(chunks: LevelChunk[], time = 1000, gameTime = 0): ClientLevel {
  const map = new Map<number, LevelChunk>();
  for (const c of chunks) map.set(chunkKey(c.x, c.z), c);
  return { chunks: map, time, gameTime, seed: 0n } as unknown as ClientLevel;
}

// 200-value reversible block codec (deterministic, exercises 8-bit palette packing)
const blockCodec: BlockStateCodec = {
  toString: (s) => (s === 0 ? 'minecraft:air' : `minecraft:test_${s}[p=${s % 3}]`),
  fromString: (str) => { const m = /test_(\d+)/.exec(str); return m ? Number(m[1]) : 0; },
};
const biomeCodec: BiomeCodec = new ReversibleBiomeCodec();
const codecOpts: ChunkCodecOptions = { blockCodec, biomeCodec, minY: -64, height: 384, recalcHeightmaps: false };

// ===========================================================================
// 1. NBT: all 12 tags, binary round-trip, BigInt fidelity, SNBT round-trip
// ===========================================================================
section('1. NBT — 12 tags / binary / BigInt / SNBT');

const MAX_LONG = 0x7fffffffffffffffn;
const allTags = new CompoundTag();
allTags.putByte('byte', -42);
allTags.putShort('short', 30000);
allTags.putInt('int', -123456789);
allTags.putLong('long', MAX_LONG);          // BigInt fidelity
allTags.putFloat('float', 3.14);
allTags.putDouble('double', 2.718281828459045);
allTags.putByteArray('byteArray', Uint8Array.from([0, 1, 127, 128, 200, 255]));
allTags.putString('string', 'héllo\u0000 wörld 😀 "quoted"'); // modified UTF-8: NUL + supplementary
allTags.putIntArray('intArray', [1, -2, 3, 2147483647]);
allTags.putLongArray('longArray', [0n, 1n, -2n, MAX_LONG, -MAX_LONG]);
const strList = new ListTag(); strList.addString('alpha'); strList.addString('beta'); strList.addString('');
allTags.put('list', strList);
const nested = new CompoundTag(); nested.putString('n', 'v'); nested.putInt('answer', 42);
allTags.put('compound', nested);

const binBytes = NbtIo.write(allTags);
const binBack = NbtIo.read(binBytes);
check('1.1 binary write->read deep equal (all 12 tags)', allTags.equals(binBack), `${binBytes.length} bytes`);
check('1.2 LongTag 0x7fffffffffffffff preserved', binBack.getLong('long') === MAX_LONG);
check('1.3 LongArray BigInt fidelity',
  binBack.getLongArray('longArray')!.map(String).join(',') === [0n, 1n, -2n, MAX_LONG, -MAX_LONG].map(String).join(','));
check('1.4 modified UTF-8 (NUL + emoji) preserved', binBack.getString('string') === allTags.getString('string'));
check('1.5 ByteArray bytes preserved', JSON.stringify([...binBack.getByteArray('byteArray')!]) === JSON.stringify([0, 1, 127, 128, 200, 255]));

const snbt = serialize(allTags);
const snbtBack = parse(snbt);
check('1.6 SNBT serialize->parse round-trip equal', allTags.equals(snbtBack));
check('1.7 SNBT valid vanilla-style output', snbt.startsWith('{') && snbt.includes('9223372036854775807L') && snbt.includes('[B;'), `len=${snbt.length}`);

// ===========================================================================
// 2. NbtIo: gzip + uncompressed, auto-detect, cross-codec compatibility
// ===========================================================================
section('2. NbtIo — gzip / uncompressed / auto / cross-compat');

const gz = await NbtIo.writeCompressed(allTags);
check('2.1 gzip write->read deep equal', allTags.equals(await NbtIo.readCompressed(gz)), `${gz.length} gz bytes`);
check('2.2 uncompressed write->read deep equal', allTags.equals(NbtIo.read(NbtIo.write(allTags))));
check('2.3 readAuto detects gzip', allTags.equals(await NbtIo.readAuto(gz)));
check('2.4 readAuto detects uncompressed', allTags.equals(await NbtIo.readAuto(binBytes)));

// A world gzipped in the browser (CompressionStream) must be readable by the Node zlib codec
// and vice-versa. Temporarily drop the injected codec to exercise the web-stream path.
setCompressionCodec(null);
const webGz = await NbtIo.writeCompressed(allTags); // produced by CompressionStream('gzip')
setCompressionCodec(ZLIB_CODEC);
check('2.5 CompressionStream gzip -> zlib gunzip cross-read', allTags.equals(await NbtIo.readCompressed(webGz)));
check('2.6 zlib gzip -> CompressionStream read', await (async () => {
  setCompressionCodec(null);
  try { return allTags.equals(await NbtIo.readCompressed(gz)); } finally { setCompressionCodec(ZLIB_CODEC); }
})());

// ===========================================================================
// 3. ChunkSerializer: 200 states + light + biomes, per-cell equality, size
// ===========================================================================
section('3. ChunkSerializer — 200 states / biomes / light / per-cell equality');

function buildDenseChunk(): LevelChunk {
  const chunk = new LevelChunk(7, -3, -64, 384, fakeMc);
  const sec = chunk.getOrCreateSection(-4);
  for (let i = 0; i < SECTION_VOLUME; i++) {
    sec.states.set(i, (i % 200) + 1); // 200 distinct states
    sec.biomes.set(i, i % 7);         // 7 biomes
  }
  sec.blockLight = new DataLayer();
  for (let i = 0; i < sec.blockLight.data.length; i++) sec.blockLight.data[i] = (i * 7 + 3) & 0xff;
  sec.skyLight = new DataLayer();
  for (let i = 0; i < sec.skyLight.data.length; i++) sec.skyLight.data[i] = (i * 13) & 0xff;
  // second section with a single edit (exercises multi-section + markDirty)
  chunk.setBlockState(5, 20, 6, 42);
  return chunk;
}

const dense = buildDenseChunk();
const chunkTag = ChunkSerializer.write(dense, codecOpts);
const chunkBytes = NbtIo.write(chunkTag);
const deflated = await deflate(chunkBytes);
check('3.1 chunk NBT has sections list', chunkTag.getListOrEmpty('sections').size() >= 1);
check('3.2 palette uses BlockStateParser strings', (() => {
  const sec0 = chunkTag.getListOrEmpty('sections').getCompound(0);
  const pal = sec0?.getCompound('block_states')?.getListOrEmpty('palette');
  return !!pal && pal.getString(0) !== undefined && pal.getString(0)!.startsWith('minecraft:');
})());
check('3.3 DataVersion = 26.2 (4903)', chunkTag.getIntOr('DataVersion', -1) === CURRENT_DATA_VERSION);

const denseBack = ChunkSerializer.read(chunkTag, fakeMc, codecOpts);
let perCell = true;
for (let si = 0; si < dense.sections.length && perCell; si++) {
  const a = dense.sections[si];
  if (!a) continue;
  const b = denseBack.sections[si];
  if (!b) { perCell = false; break; }
  const baseY = (dense.minSection + si) * 16;
  for (let i = 0; i < SECTION_VOLUME; i++) {
    const x = i & 15, z = (i >> 4) & 15, y = (i >> 8) & 15;
    if (dense.getBlockState(x, baseY + y, z) !== denseBack.getBlockState(x, baseY + y, z)) { perCell = false; break; }
    if (a.biomes.get(i) !== b.biomes.get(i)) { perCell = false; break; }
  }
  if (a.blockLight && b.blockLight) {
    for (let i = 0; i < a.blockLight.data.length; i++) if (a.blockLight.data[i] !== b.blockLight.data[i]) { perCell = false; break; }
  }
  if (a.skyLight && b.skyLight) {
    for (let i = 0; i < a.skyLight.data.length; i++) if (a.skyLight.data[i] !== b.skyLight.data[i]) { perCell = false; break; }
  }
}
check('3.4 serialize->deserialize per-cell equal (states+biomes+light)', perCell);
console.log(`      chunk NBT = ${chunkBytes.length} bytes, zlib-deflated = ${deflated.length} bytes (compression ratio ${(chunkBytes.length / deflated.length).toFixed(1)}x)`);

// bonus: real 26.2 MinecraftData BlockStateParser codec
section('3b. real MinecraftData codec (26.2 blocks.json + blocks.bin)');
try {
  const meta = JSON.parse(fs.readFileSync(path.join(root, 'public/mc/blocks.json'), 'utf8'));
  const realMc = new MinecraftData();
  realMc.initMeta(meta);
  realMc.initBinary(readArrayBuffer(path.join(root, 'public/mc/blocks.bin')));
  const realCodec = new MinecraftDataBlockStateCodec(realMc);
  const sample = [0, 1, realMc.stateOf('stone'), realMc.stateOf('oak_log', { axis: 'y' }),
    realMc.stateOf('grass_block'), 100, 5000, 30000, realMc.stateCount - 1];
  let realOk = true;
  for (const s of sample) if (realCodec.fromString(realCodec.toString(s)) !== s) realOk = false;
  check('3b.1 real codec round-trips real 26.2 states', realOk, `stateCount=${realMc.stateCount}`);
  check('3b.2 real palette string is BlockStateParser form', realCodec.toString(realMc.stateOf('oak_log', { axis: 'y' })) === 'minecraft:oak_log[axis=y]');
} catch (err) {
  check('3b.1 real MinecraftData load', false, String(err));
}

// ===========================================================================
// 4. RegionFile: 4 chunks, non-overlapping sectors, 4096 alignment, reopen
// ===========================================================================
section('4. RegionFile — 4 chunks / sector table / alignment');

const region = new RegionFile();
const regionPayloads: Uint8Array[] = [];
for (let i = 0; i < 4; i++) {
  const p = Uint8Array.from({ length: 200 + i * 137 }, (_, j) => (j * 3 + i * 7) & 0xff);
  regionPayloads.push(p);
  await region.write(i * 3 - 4, i * 5 + 1, p);
}
const ranges = region.sectorRanges();
let overlap = false;
const occupied = new Set<number>();
for (const r of ranges) { for (let s = r.start; s < r.start + r.count; s++) { if (occupied.has(s)) overlap = true; occupied.add(s); } }
check('4.1 sector table has 4 non-overlapping ranges', ranges.length === 4 && !overlap, JSON.stringify(ranges));
check('4.2 all chunks report hasChunk', region.hasChunk(-4, 1) && region.hasChunk(5, 16) && !region.hasChunk(99, 99));

const mca = region.toUint8Array();
check('4.3 exported .mca is 4096-aligned', mca.length % 4096 === 0 && mca.length >= 8192, `${mca.length} bytes`);

const reopened = RegionFile.fromBytes(mca);
let regionOk = true;
for (let i = 0; i < 4; i++) {
  const got = await reopened.read(i * 3 - 4, i * 5 + 1);
  if (!got || got.length !== regionPayloads[i].length) { regionOk = false; break; }
  for (let j = 0; j < got.length; j++) if (got[j] !== regionPayloads[i][j]) { regionOk = false; break; }
  if (!regionOk) break;
}
check('4.4 reopen(fromBytes) reads all 4 chunks byte-exact', regionOk);

// overwrite one chunk with a larger payload -> old sectors freed, no overlap
const big = Uint8Array.from({ length: 9000 }, (_, j) => j & 0xff);
await region.write(0, 0, big);
const mca2 = region.toUint8Array();
const r2 = RegionFile.fromBytes(mca2);
const bigBack = await r2.read(0, 0);
check('4.5 larger overwrite round-trips (sector reallocation)', !!bigBack && bigBack.length === 9000 && bigBack[500] === big[500]);

// ===========================================================================
// 5. WorldSaveManager: fake store full lifecycle
// ===========================================================================
section('5. WorldSaveManager — create/load/save/flush/delete (fake IKeyValueStore)');

const db = SaveDatabase.memory();
const mgr = await WorldSaveManager.open(db, { blockCodec, biomeCodec, minY: -64, height: 384 });
const SEED = 123456789012345n;
const worldId = await mgr.createWorld({ name: 'Persistence World', seed: SEED, gamemode: 'creative', difficulty: 'normal' });
check('5.1 createWorld returns an id', typeof worldId === 'string' && worldId.length > 0, worldId);

const player = new Player(12.5, 70.25, -8.75);
player.yaw = 33.5; player.pitch = -12.25; player.onGround = true; player.fallDistance = 1.5;
const inventory = [
  { slot: 0, id: 'stone', count: 64 },
  { slot: 4, id: 'oak_log', count: 12, components: { axis: 'y' } },
  { slot: 8, id: 'glass', count: 32 },
];
const hotbar = [1, 2, 3, -1, 5, 6, 7, 8, 9];
const extra = { health: 17.5, foodLevel: 13, inventory, selectedItemSlot: 4, xpLevel: 9, hotbar };
await mgr.savePlayer(player, extra);

const c1 = new LevelChunk(0, 0, -64, 384, fakeMc);
const s1 = c1.getOrCreateSection(-4);
for (let i = 0; i < 256; i++) s1.states.set(i, (i % 20) + 1);
c1.setBlockState(3, 30, 4, 77);
const c2 = new LevelChunk(1, 0, -64, 384, fakeMc);
c2.getOrCreateSection(-4).states.set(10, 123);
const level = makeLevel([c1, c2], 12345, 98765);
const flushed = await mgr.flushDirty(level, player, 1000);
check('5.2 flushDirty wrote dirty chunks', flushed >= 2, `wrote ${flushed}`);

const loaded = await mgr.loadWorld(worldId);
check('5.3 loadWorld returns level NBT', loaded.level instanceof CompoundTag);
check('5.4 loadWorld returns chunk map', loaded.chunks instanceof Map && loaded.chunks.size >= 2, `chunks=${loaded.chunks.size}`);

const data = loaded.level.getCompound('Data')!;
check('5.5 seed fully restored', data.getLong('RandomSeed') === SEED, `seed=${data.getLong('RandomSeed')}`);
check('5.6 time fully restored (Time/DayTime)', Number(data.getLong('Time')) === 98765 && Number(data.getLong('DayTime')) === 12345,
  `Time=${data.getLong('Time')} DayTime=${data.getLong('DayTime')}`);

check('5.7 player NBT returned', loaded.player !== null && loaded.player instanceof CompoundTag);
const pv = PlayerData.fromNbt(loaded.player!);
check('5.8 player position fully restored', pv.pos.x === 12.5 && pv.pos.y === 70.25 && pv.pos.z === -8.75,
  `pos=(${pv.pos.x},${pv.pos.y},${pv.pos.z})`);
check('5.9 player rotation fully restored', pv.rotation.yaw === 33.5 && pv.rotation.pitch === -12.25);
check('5.10 inventory fully restored', JSON.stringify(pv.extra.inventory) === JSON.stringify(inventory));
check('5.11 hotbar / xp / food fully restored',
  JSON.stringify(pv.extra.hotbar) === JSON.stringify(hotbar) && pv.extra.xpLevel === 9 && pv.extra.foodLevel === 13);

const live = new Player(0, 0, 0);
PlayerData.applyToPlayer(loaded.player!, live);
check('5.12 applyToPlayer restores live player pos', live.pos.x === 12.5 && live.pos.y === 70.25 && live.pos.z === -8.75);

check('5.13 WorldListProvider.list() works', (await mgr.list()).some((w) => w.id === worldId));
const summary = await mgr.getSummary(worldId);
check('5.14 getSummary() parses level.dat', !!summary && summary.seed === SEED && summary.name === 'Persistence World');
await mgr.rename(worldId, 'Renamed World');
check('5.15 rename() updates metadata + level.dat', (await mgr.list()).find((w) => w.id === worldId)!.name === 'Renamed World');

// export/import round-trip
const bundle = await mgr.exportWorld(worldId);
const importedId = await mgr.importWorld(bundle.buffer.slice(bundle.byteOffset, bundle.byteOffset + bundle.byteLength) as ArrayBuffer);
const imported = await mgr.loadWorld(importedId);
check('5.16 exportWorld/importWorld round-trips chunks + player',
  imported.chunks.size === loaded.chunks.size && imported.player !== null,
  `chunks=${imported.chunks.size}`);
check('5.17 imported seed preserved', imported.level.getCompound('Data')!.getLong('RandomSeed') === SEED);

// exportRegion produces a real .mca
const mcaFromWorld = await mgr.exportRegion(worldId, 0, 0);
check('5.18 exportRegion() returns a valid aligned .mca', mcaFromWorld.length % 4096 === 0 && mcaFromWorld.length >= 8192, `${mcaFromWorld.length} bytes`);

await mgr.delete(worldId);
check('5.19 delete() clears world metadata', !(await mgr.list()).some((w) => w.id === worldId));
check('5.20 delete() clears chunks/player/regions', (await mgr.getSummary(worldId)) === null && (await mgr.loadWorld(worldId)).chunks.size === 0);

// ===========================================================================
// 6. Performance: single chunk < 2ms, 100-chunk flush respects budget
// ===========================================================================
section('6. Performance — <2ms/chunk + budgeted 100-chunk flush');

// Warm up thoroughly, then take the MEDIAN of several batches. A single long batch can be
// skewed by GC pauses / sibling processes on a shared CI box; the median reflects the true
// steady-state cost of the code. All raw batch numbers are printed for transparency.
for (let i = 0; i < 40; i++) ChunkSerializer.toBytes(dense, codecOpts);
const BATCHES = 7;
const ITER = 40;
const batchAvgs: number[] = [];
for (let b = 0; b < BATCHES; b++) {
  const t0 = performance.now();
  for (let i = 0; i < ITER; i++) ChunkSerializer.toBytes(dense, codecOpts);
  batchAvgs.push((performance.now() - t0) / ITER);
}
const sorted = [...batchAvgs].sort((a, b) => a - b);
const perChunkMs = sorted[Math.floor(BATCHES / 2)]; // median
check('6.1 single chunk serialization < 2 ms', perChunkMs < 2,
  `median ${perChunkMs.toFixed(3)} ms, min ${sorted[0].toFixed(3)} ms (${BATCHES}x${ITER} iters)`);
console.log(`      measured single-chunk serialize (median) = ${perChunkMs.toFixed(3)} ms`);
console.log(`      batches(ms): ${batchAvgs.map((v) => v.toFixed(2)).join(', ')}`);

const perfDb = SaveDatabase.memory();
const perfMgr = await WorldSaveManager.open(perfDb, { blockCodec, biomeCodec, minY: -64, height: 384 });
const perfWorldId = await perfMgr.createWorld({ name: 'Perf', seed: 1n, gamemode: 'survival', difficulty: 'easy' });
const perfChunks: LevelChunk[] = [];
for (let i = 0; i < 100; i++) {
  const c = new LevelChunk(i % 10, Math.floor(i / 10), -64, 384, fakeMc);
  const s = c.getOrCreateSection(-4);
  for (let k = 0; k < 64; k++) s.states.set(k, (k % 16) + 1);
  perfChunks.push(c);
}
const perfLevel = makeLevel(perfChunks, 6000, 6000);
const perfPlayer = new Player(0, 64, 0);

const firstFlush = await perfMgr.flushDirty(perfLevel, perfPlayer, 4);
check('6.2 one flush never writes the whole world', firstFlush > 0 && firstFlush < 100, `wrote ${firstFlush}/100 in frame 1`);
check('6.3 flush respects <=16 chunks/transaction', firstFlush <= MAX_CHUNKS_PER_TRANSACTION, `cap=${MAX_CHUNKS_PER_TRANSACTION}`);

let total = firstFlush;
let frames = 1;
for (;;) {
  const n = await perfMgr.flushDirty(perfLevel, perfPlayer, 1000);
  total += n;
  if (n === 0) break;
  frames++;
  if (frames > 200) break; // safety
}
check('6.4 all 100 chunks eventually flushed', total === 100, `total=${total} over ${frames} frames`);
check('6.5 AUTOSAVE_INTERVAL = 6000 ticks', AUTOSAVE_INTERVAL === 6000);

// ===========================================================================
section('SUMMARY');
console.log(`  ${passed} passed, ${failed} failed`);
if (failed > 0) { console.error(`\n${failed} CHECK(S) FAILED`); process.exit(1); }
console.log('  ALL CHECKS PASSED');
process.exit(0);
