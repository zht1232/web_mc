// Dumps Named Noise samples (NormalNoise) in the parity JSON format.
//
// This is the second parity layer: after the RNG stream, prove that a named
// noise (e.g. minecraft:aquifer_barrier) returns the same values as Java for
// the same seed and coordinates.
//
// Usage: npx tsx scripts/parity/dump-noise.mts <seed> [noiseId] [out.json]
import fs from 'node:fs';
import path from 'node:path';
import { XoroshiroRandomSource } from '../../src/vanilla/core/Random.js';
import { NormalNoise } from '../../src/vanilla/world/level/levelgen/synth/Noise.js';

const seedArg = process.argv[2];
if (seedArg === undefined) {
  console.error('usage: npx tsx scripts/parity/dump-noise.mts <seed> [noiseId] [out.json]');
  process.exit(2);
}
const noiseId = process.argv[3] ?? 'minecraft:aquifer_barrier';
const outPath = process.argv[4] ?? `REPORTS/coverage/parity/noise-webcraft-seed${seedArg}-${noiseId.replace(/[:/]/g, '_')}.json`;

const worldgen = JSON.parse(fs.readFileSync(path.join(process.cwd(), 'public/mc/worldgen.json'), 'utf8'));
const spec = worldgen.noises?.[noiseId];
if (!spec) {
  console.error(`[noise] ${noiseId} not found in public/mc/worldgen.json (noises: ${Object.keys(worldgen.noises ?? {}).length})`);
  process.exit(2);
}

const seed = BigInt(seedArg);
const random = new XoroshiroRandomSource(seed).forkPositional().fromHashOf(noiseId);
const noise = new NormalNoise(random, spec.firstOctave, spec.amplitudes);

const f64 = new Float64Array(1);
const u64 = new BigUint64Array(f64.buffer);
const bits = (v: number) => {
  f64[0] = v;
  return '0x' + u64[0].toString(16).padStart(16, '0');
};

// Same coordinates as Horizon's noise parity probe, plus a few small ones.
const coords = [
  [0, 0, 0],
  [-17.25, 64.125, 32.5],
  [30e6, -64, -30e6],
  [1.25, -0.5, -3.75],
  [33554432, -2048, -33554433],
  [0.5, 0.5, 0.5],
  [-1.5, 2.25, 7.75],
];

const samples = coords.map(([x, y, z]) => ({
  x, y, z,
  bits: bits(noise.getValue(x, y, z)),
}));

const doc = {
  kind: 'noise',
  noise: noiseId,
  seed: seedArg,
  source: 'webcraft',
  generatedAt: new Date().toISOString(),
  firstOctave: spec.firstOctave,
  amplitudes: spec.amplitudes,
  samples,
};

fs.mkdirSync(path.dirname(outPath), { recursive: true });
fs.writeFileSync(outPath, JSON.stringify(doc, null, 2) + '\n');
console.log(`[noise] wrote ${outPath} (${samples.length} samples, ${noiseId}, seed ${seedArg})`);
