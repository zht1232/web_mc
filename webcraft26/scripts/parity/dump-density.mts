// Dumps overworld final_density / preliminary_surface_level samples in the
// parity JSON format. This is the third parity layer: same seed and coordinate
// must produce the same doubles as Java's NoiseRouter.
//
// Usage: npx tsx scripts/parity/dump-density.mts <seed> [final_density|preliminary_surface_level] [out.json]
import fs from 'node:fs';
import path from 'node:path';
import { XoroshiroRandomSource, LegacyRandomSource, mixStafford13 } from '../../src/vanilla/core/Random.js';
import { NormalNoise } from '../../src/vanilla/world/level/levelgen/synth/Noise.js';
import { BlendedNoise } from '../../src/vanilla/world/level/levelgen/synth/BlendedNoise.js';
import { SimplexNoise } from '../../src/vanilla/world/level/levelgen/synth/SimplexNoise.js';
import {
  DensityFunctionFactory,
  EndIslands,
  SinglePointContext,
} from '../../src/vanilla/world/level/levelgen/density/DensityFunction.js';

const seedArg = process.argv[2];
if (seedArg === undefined) {
  console.error('usage: npx tsx scripts/parity/dump-density.mts <seed> [routerField] [out.json]');
  process.exit(2);
}
const field = process.argv[3] ?? 'final_density';
const outPath = process.argv[4] ?? `REPORTS/coverage/parity/density-webcraft-seed${seedArg}-${field}.json`;

const worldgen = JSON.parse(fs.readFileSync(path.join(process.cwd(), 'public/mc/worldgen.json'), 'utf8'));
const router = worldgen.noiseSettings?.overworld?.noise_router;
if (!router?.[field]) {
  console.error(`[density] overworld noise_router has no ${field}`);
  process.exit(2);
}

const seed = BigInt(seedArg);
const MASK64 = (1n << 64n) - 1n;
// Same 128-bit seed upgrade as NoiseChunkGenerator (RandomSupport.upgradeSeedTo128bit).
const lowBits = (seed ^ 0x6a09e667f3bcc909n) & MASK64;
const highBits = (lowBits + 0x9e3779b97f4a7c15n) & MASK64;
const rootRandom = new XoroshiroRandomSource(mixStafford13(lowBits), mixStafford13(highBits));
const positional = rootRandom.forkPositional();
const terrainRandom = positional.fromHashOf('minecraft:terrain');

const noises = worldgen.noises ?? {};
const noiseFactory = (id: string): NormalNoise => {
  const params = noises[id];
  if (!params) throw new Error(`missing noise ${id}`);
  return new NormalNoise(positional.fromHashOf(id), params.firstOctave, params.amplitudes);
};
const blendedFactory = (node: {
  xz_scale: number; y_scale: number; xz_factor: number; y_factor: number; smear_scale_multiplier: number;
}) => new BlendedNoise(terrainRandom, node.xz_scale, node.y_scale, node.xz_factor, node.y_factor, node.smear_scale_multiplier);
const endFactory = () => {
  const random = new LegacyRandomSource(seed);
  random.consumeCount(17292);
  return new EndIslands(new SimplexNoise(random));
};

const factory = new DensityFunctionFactory(worldgen.densityFunctions ?? {}, noiseFactory, blendedFactory, endFactory);
const fn = factory.parse(router[field]);

const f64 = new Float64Array(1);
const u64 = new BigUint64Array(f64.buffer);
const bits = (v: number) => {
  f64[0] = v;
  return '0x' + u64[0].toString(16).padStart(16, '0');
};

const coords = [
  [0, 0, 0],
  [0, 64, 0],
  [-17, 64, 32],
  [30e6, -64, -30e6],
  [1.25, -0.5, -3.75],
  [33554432, -2048, -33554433],
  [256, 80, -128],
  [-128, 120, 512],
];

const samples = coords.map(([x, y, z]) => ({
  x, y, z,
  bits: bits(fn.compute(new SinglePointContext(x, y, z))),
}));

const doc = {
  kind: 'density',
  field,
  seed: seedArg,
  source: 'webcraft',
  generatedAt: new Date().toISOString(),
  samples,
};

fs.mkdirSync(path.dirname(outPath), { recursive: true });
fs.writeFileSync(outPath, JSON.stringify(doc, null, 2) + '\n');
console.log(`[density] wrote ${outPath} (${samples.length} samples, ${field}, seed ${seedArg})`);
