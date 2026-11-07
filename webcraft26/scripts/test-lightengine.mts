// Equivalence + speed test for LightEngine.lightChunk (sky seeding optimisation).
//
//   npx tsx scripts/test-lightengine.mts
//
// Generates the same real terrain twice (forest window at (10,-40) and the hilly spawn area), lights it
// once with the original "enqueue every open-sky cell" seeding (LightEngine.legacySeeding) and once with
// the optimised seeding, and requires every sky-light and block-light value to be identical.

import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import { MinecraftData } from '../src/vanilla/world/level/block/state/BlockState.ts';
import { ClientLevel } from '../src/vanilla/world/level/ClientLevel.ts';
import { LightEngine } from '../src/vanilla/world/level/lighting/LightEngine.ts';
import { NoiseChunkGenerator, type WorldgenData } from '../src/vanilla/world/level/levelgen/NoiseChunkGenerator.ts';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const readArrayBuffer = (file: string): ArrayBuffer => {
  const buf = fs.readFileSync(file);
  return buf.buffer.slice(buf.byteOffset, buf.byteOffset + buf.byteLength) as ArrayBuffer;
};

const mc = new MinecraftData();
mc.initMeta(JSON.parse(fs.readFileSync(path.join(root, 'public/mc/blocks.json'), 'utf8')));
mc.initBinary(readArrayBuffer(path.join(root, 'public/mc/blocks.bin')));
const data = JSON.parse(fs.readFileSync(path.join(root, 'public/mc/worldgen.json'), 'utf8')) as WorldgenData;
const tagsJson = JSON.parse(fs.readFileSync(path.join(root, 'public/mc/tags.json'), 'utf8'));
(data as { blockTags?: Record<string, string[]> }).blockTags = (tagsJson.block as Record<string, string[]>) ?? {};

const SEED = 0x2602c0den;
const WINDOWS = [{ x: 10, z: -40, n: 4 }, { x: 14, z: -8, n: 4 }]; // forest, hills around the old spawn

let failures = 0;
function check(name: string, ok: boolean, detail = ''): void {
  if (ok) console.log(`PASS  ${name}${detail ? '  ' + detail : ''}`);
  else { failures++; console.log(`FAIL  ${name}${detail ? '  ' + detail : ''}`); }
}

// ensureChunk generates + lights in one go; time it as a whole and compare the light arrays afterwards.
function run(legacy: boolean, win: { x: number; z: number; n: number }): { level: ClientLevel; ms: number } {
  LightEngine.legacySeeding = legacy;
  const gen = new NoiseChunkGenerator(mc, data, SEED, 'overworld', true);
  const level = new ClientLevel(mc, gen, SEED);
  const t0 = performance.now();
  for (let dz = 0; dz < win.n; dz++) for (let dx = 0; dx < win.n; dx++) level.ensureChunk(win.x + dx, win.z + dz);
  return { level, ms: performance.now() - t0 };
}

for (const win of WINDOWS) {
  const a = run(true, win);
  const b = run(false, win);
  let cells = 0, diffSky = 0, diffBlock = 0, first = '';
  for (let dz = 0; dz < win.n; dz++) {
    for (let dx = 0; dx < win.n; dx++) {
      const ca = a.level.getChunk(win.x + dx, win.z + dz)!;
      const cb = b.level.getChunk(win.x + dx, win.z + dz)!;
      for (let sy = ca.minSectionY; sy <= ca.maxSectionY; sy++) {
        for (let y = 0; y < 16; y++) for (let z = 0; z < 16; z++) for (let x = 0; x < 16; x++) {
          const wy = sy * 16 + y;
          const sa = a.level.light.getSkyLight((ca.x << 4) + x, wy, (ca.z << 4) + z);
          const sb = b.level.light.getSkyLight((cb.x << 4) + x, wy, (cb.z << 4) + z);
          const ba = a.level.light.getBlockLight((ca.x << 4) + x, wy, (ca.z << 4) + z);
          const bb = b.level.light.getBlockLight((cb.x << 4) + x, wy, (cb.z << 4) + z);
          cells++;
          if (sa !== sb) { diffSky++; if (!first) first = `sky (${(ca.x << 4) + x},${wy},${(ca.z << 4) + z}) legacy=${sa} new=${sb}`; }
          if (ba !== bb) { diffBlock++; if (!first) first = `block (${(ca.x << 4) + x},${wy},${(ca.z << 4) + z}) legacy=${ba} new=${bb}`; }
        }
      }
    }
  }
  check(`window (${win.x},${win.z}) ${win.n}x${win.n}: sky+block light identical to legacy seeding`, diffSky === 0 && diffBlock === 0,
    `cells=${cells} diffSky=${diffSky} diffBlock=${diffBlock} ${first}`);
  console.log(`      generate+light: legacy ${a.ms.toFixed(0)} ms, optimised ${b.ms.toFixed(0)} ms for ${win.n * win.n} chunks`);
}
LightEngine.legacySeeding = false;

console.log(failures ? `\n${failures} check(s) FAILED` : '\nall checks passed');
process.exit(failures ? 1 : 0);
