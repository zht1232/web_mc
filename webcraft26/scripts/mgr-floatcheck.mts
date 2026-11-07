// Counts grass/fern blocks that float above air/water in freshly generated chunks.  npx tsx scripts/mgr-floatcheck.mts
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { MinecraftData } from '../src/vanilla/world/level/block/state/BlockState.ts';
import { LevelChunk } from '../src/vanilla/world/level/chunk/LevelChunk.ts';
import { NoiseChunkGenerator, type WorldgenData } from '../src/vanilla/world/level/levelgen/NoiseChunkGenerator.ts';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const ab = (f: string) => { const b = fs.readFileSync(f); return b.buffer.slice(b.byteOffset, b.byteOffset + b.byteLength) as ArrayBuffer; };
const mc = new MinecraftData();
mc.initMeta(JSON.parse(fs.readFileSync(path.join(root, 'public/mc/blocks.json'), 'utf8')));
mc.initBinary(ab(path.join(root, 'public/mc/blocks.bin')));
const data = JSON.parse(fs.readFileSync(path.join(root, 'public/mc/worldgen.json'), 'utf8')) as WorldgenData;
const tags = JSON.parse(fs.readFileSync(path.join(root, 'public/mc/tags.json'), 'utf8'));
(data as { blockTags?: Record<string, string[]> }).blockTags = tags.block ?? {};

const gen = new NoiseChunkGenerator(mc, data, 0x2602c0den, 'overworld', true);
const chunks: LevelChunk[] = [];
for (let dz = 0; dz < 3; dz++) for (let dx = 0; dx < 3; dx++) { const c = new LevelChunk(15 + dx, -9 + dz, -64, 384, mc); gen.generateChunk(c); chunks.push(c); }
const isAir = (n: string) => n === 'air' || n === 'cave_air';
let total = 0, floating = 0; const drops: Record<number, number> = {}; const below: Record<string, number> = {};
for (const c of chunks) for (let lz = 0; lz < 16; lz++) for (let lx = 0; lx < 16; lx++) {
  let top = -999;
  for (let y = 319; y >= -64; y--) { if (!isAir(mc.blockOf(c.getBlockState(lx, y, lz)).name)) { top = y; break; } }
  if (top < -64) continue;
  const n = mc.blockOf(c.getBlockState(lx, top, lz)).name;
  if (n !== 'short_grass' && n !== 'fern' && n !== 'tall_grass') continue;
  total++;
  const b = mc.blockOf(c.getBlockState(lx, top - 1, lz)).name;
  if (isAir(b) || b === 'water') { floating++; below[b] = (below[b] ?? 0) + 1; let d = 0, y = top - 1; while (y > -64 && isAir(mc.blockOf(c.getBlockState(lx, y, lz)).name)) { d++; y--; } drops[d] = (drops[d] ?? 0) + 1; }
}
console.log({ total, floating, below, drops });
