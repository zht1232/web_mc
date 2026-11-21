// Compares two parity JSON files sample by sample. Exit 1 on the first mismatch.
//
// Usage: node scripts/parity/compare-parity.mjs expected.json actual.json [--max N]
import fs from 'node:fs';

const [expectedPath, actualPath, ...rest] = process.argv.slice(2);
if (!expectedPath || !actualPath) {
  console.error('usage: node scripts/parity/compare-parity.mjs expected.json actual.json [--max N]');
  process.exit(2);
}
const maxAt = rest.indexOf('--max');
const max = maxAt >= 0 ? Math.max(1, Number(rest[maxAt + 1]) || 10) : 10;

const load = (p) => {
  try { return JSON.parse(fs.readFileSync(p, 'utf8')); }
  catch (e) { console.error(`[parity] cannot read ${p}: ${e.message}`); process.exit(2); }
};

const expected = load(expectedPath);
const actual = load(actualPath);

const fail = (msg) => { console.error(`FAIL  ${msg}`); process.exit(1); };
if (expected.kind !== actual.kind) fail(`kind ${expected.kind} != ${actual.kind}`);
if (String(expected.seed) !== String(actual.seed)) fail(`seed ${expected.seed} != ${actual.seed}`);

const es = expected.samples ?? [];
const as = actual.samples ?? [];
const n = Math.min(es.length, as.length);
let mismatches = 0;
for (let i = 0; i < n; i++) {
  const e = es[i], a = as[i];
  const same = JSON.stringify(e) === JSON.stringify(a);
  if (!same) {
    if (mismatches < max) {
      console.error(`MISMATCH #${i}`);
      console.error(`  expected: ${JSON.stringify(e)}`);
      console.error(`  actual:   ${JSON.stringify(a)}`);
    }
    mismatches++;
  }
}
if (es.length !== as.length) {
  console.error(`LENGTH  expected ${es.length} samples, actual ${as.length}`);
  mismatches++;
}
if (mismatches > 0) {
  console.error(`\n${mismatches} mismatch(es) in ${n} compared samples`);
  process.exit(1);
}
console.log(`PASS  ${n} samples match (kind=${expected.kind}, seed=${expected.seed})`);
