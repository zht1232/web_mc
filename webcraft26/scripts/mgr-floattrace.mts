import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { MinecraftData } from '../src/vanilla/world/level/block/state/BlockState.ts';
import { LevelChunk } from '../src/vanilla/world/level/chunk/LevelChunk.ts';
import { NoiseChunkGenerator, type WorldgenData } from '../src/vanilla/world/level/levelgen/NoiseChunkGenerator.ts';
import { FeaturePlacer } from '../src/vanilla/world/level/levelgen/feature/FeaturePlacer.ts';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const ab = (f: string) => { const b = fs.readFileSync(f); return b.buffer.slice(b.byteOffset, b.byteOffset + b.byteLength) as ArrayBuffer; };
const mc = new MinecraftData();
mc.initMeta(JSON.parse(fs.readFileSync(path.join(root, 'public/mc/blocks.json'), 'utf8')));
mc.initBinary(ab(path.join(root, 'public/mc/blocks.bin')));
const data = JSON.parse(fs.readFileSync(path.join(root, 'public/mc/worldgen.json'), 'utf8')) as WorldgenData;
const tags = JSON.parse(fs.readFileSync(path.join(root, 'public/mc/tags.json'), 'utf8'));
(data as { blockTags?: Record<string, string[]> }).blockTags = tags.block ?? {};

const grassWrites: { x: number; y: number; z: number; belowAtWrite: string; step: number }[] = [];
const laterWritesBelow = new Map<string, string[]>();
let step = 0;
const proto = FeaturePlacer.prototype as unknown as { setBlock(x: number, y: number, z: number, s: number): void; getBlockState(x: number, y: number, z: number): number; minBlockX: number; minBlockZ: number };
const orig = proto.setBlock;
proto.setBlock = function (this: typeof proto, x: number, y: number, z: number, s: number): void {
  step++;
  const inT = x >= this.minBlockX && x < this.minBlockX + 16 && z >= this.minBlockZ && z < this.minBlockZ + 16;
  const name = mc.blockOf(s).name;
  if (inT && (name === 'short_grass' || name === 'fern')) {
    grassWrites.push({ x, y, z, belowAtWrite: mc.blockOf(this.getBlockState(x, y - 1, z)).name, step });
  }
  if (inT) { const k = `${x},${y},${z}`; const a = laterWritesBelow.get(k) ?? []; a.push(`${name}@${step}`); laterWritesBelow.set(k, a); }
  orig.call(this, x, y, z, s);
};

const gen = new NoiseChunkGenerator(mc, data, 0x2602c0den, 'overworld', true);
const c = new LevelChunk(16, -8, -64, 384, mc);
gen.generateChunk(c);
const isAir = (n: string) => n === 'air' || n === 'cave_air';
let fl = 0, shown = 0; const byBelowAtWrite: Record<string, number> = {};
for (const w of grassWrites) {
  const lx = w.x & 15, lz = w.z & 15;
  if (c.getBlockState(lx, w.y, lz) === 0) continue; // overwritten later
  const nowBelow = mc.blockOf(c.getBlockState(lx, w.y - 1, lz)).name;
  if (!isAir(nowBelow)) continue;
  fl++;
  byBelowAtWrite[w.belowAtWrite] = (byBelowAtWrite[w.belowAtWrite] ?? 0) + 1;
  if (shown++ < 6) console.log('floating', w, 'now below:', nowBelow, 'writes at below pos:', laterWritesBelow.get(`${w.x},${w.y - 1},${w.z}`));
}
console.log({ grassWrites: grassWrites.length, floating: fl, byBelowAtWrite });
