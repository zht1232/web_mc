// Dumps the WorldgenRandom stream in the parity JSON format.
//
// This is the first layer of worldgen parity: before comparing terrain, prove
// that the RNG stream itself matches Java's XoroshiroRandomSource.
//
// Usage: npx tsx scripts/parity/dump-rng.mts <seed> [out.json]
import fs from 'node:fs';
import path from 'node:path';
import { WorldgenRandom } from '../../src/vanilla/world/level/levelgen/feature/WorldgenRandom.js';

const seedArg = process.argv[2];
if (seedArg === undefined) {
  console.error('usage: npx tsx scripts/parity/dump-rng.mts <seed> [out.json]');
  process.exit(2);
}
const outPath = process.argv[3] ?? `REPORTS/coverage/parity/rng-webcraft-seed${seedArg}.json`;

const seed = BigInt(seedArg);
const rng = new WorldgenRandom(seed);

const f32 = new Float32Array(1);
const u32 = new Uint32Array(f32.buffer);
const f64 = new Float64Array(1);
const u64 = new BigUint64Array(f64.buffer);

const samples = [];
const longHex = (v: bigint) => '0x' + (v & 0xffffffffffffffffn).toString(16).padStart(16, '0');

for (let i = 0; i < 16; i++) {
  samples.push({ op: 'nextLong', i, bits: longHex(rng.nextLong()) });
}
for (let i = 0; i < 16; i++) {
  samples.push({ op: 'nextInt', i, bound: 1000, value: rng.nextInt(1000) });
}
for (let i = 0; i < 8; i++) {
  f32[0] = rng.nextFloat();
  samples.push({ op: 'nextFloat', i, bits: '0x' + u32[0].toString(16).padStart(8, '0') });
}
for (let i = 0; i < 8; i++) {
  f64[0] = rng.nextDouble();
  samples.push({ op: 'nextDouble', i, bits: '0x' + u64[0].toString(16).padStart(16, '0') });
}

const doc = {
  kind: 'rng',
  seed: seedArg,
  source: 'webcraft',
  generatedAt: new Date().toISOString(),
  samples,
};

fs.mkdirSync(path.dirname(outPath), { recursive: true });
fs.writeFileSync(outPath, JSON.stringify(doc, null, 2) + '\n');
console.log(`[parity] wrote ${outPath} (${samples.length} samples, seed ${seedArg})`);
