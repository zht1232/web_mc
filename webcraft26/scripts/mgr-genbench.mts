// Per-phase chunk generation timing (what a worker spends per chunk).  npx tsx scripts/mgr-genbench.mts
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

for (const features of [false, true]) {
  const gen = new NoiseChunkGenerator(mc, data, 0x2602c0den, 'overworld', features);
  const times: number[] = [];
  for (let i = 0; i < 10; i++) {
    const c = new LevelChunk(14 + (i % 5), -8 + Math.floor(i / 5), -64, 384, mc);
    const t0 = performance.now();
    gen.generateChunk(c);
    times.push(performance.now() - t0);
  }
  const sorted = [...times].sort((a, b) => a - b);
  console.log(`features=${features}: first ${times[0].toFixed(0)} ms, median ${sorted[5].toFixed(0)} ms, mean ${(times.reduce((a, b) => a + b) / times.length).toFixed(0)} ms`);
}
