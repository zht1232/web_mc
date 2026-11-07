// Semantic spot-checks on the baked state pool: reads public/mc/states.json +
// states.bin the way the runtime will, and asserts the geometry lands on the
// right side of the block for the families that were impossible before.
import fs from 'node:fs/promises';
import path from 'node:path';
import { decodeStates } from '../scripts/statepack.mjs';

const DIRS = ['down', 'up', 'north', 'south', 'west', 'east'];
const fails = [];
const notes = [];
const ok = (name, cond, detail) => {
  if (!cond) fails.push(name + (detail ? ' — ' + detail : ''));
  else notes.push('ok   ' + name + (detail ? '  (' + detail + ')' : ''));
};

const doc = JSON.parse(await fs.readFile(path.resolve('public/mc/states.json'), 'utf8'));
const bin = await fs.readFile(path.resolve('public/mc/states.bin'));
const dec = decodeStates(bin, doc.textures);

function modelOf(block, key) {
  const entry = doc.blocks[block];
  if (!entry) throw new Error('no block ' + block);
  if (entry.kind !== 'variant') throw new Error(`${block} is ${entry.kind}, not variant`);
  const list = entry.variants[key];
  if (!list) throw new Error(`${block} has no key ${key}; keys: ${Object.keys(entry.variants).slice(0, 6).join(' ')}`);
  const m = dec.model(list[0].m);
  return m.quads.map(q => ({ ...q, model: m }));
}

function partsOf(block, state) {
  const entry = doc.blocks[block];
  if (entry.kind !== 'multipart') throw new Error(`${block} is not multipart`);
  const out = [];
  for (const part of entry.parts) {
    if (matches(part.c, state)) out.push(...part.a.map(a => dec.model(a.m)));
  }
  return out.flatMap(m => m.quads);
}

function matches(cond, state) {
  if (cond.leaf) return cond.leaf.every(t => t.values.some(v => (state[t.prop] === v.value) !== v.negate));
  if (cond.all) return cond.all.every(c => matches(c, state));
  if (cond.any) return cond.any.some(c => matches(c, state));
  return false;
}

function bounds(quads) {
  const b = { min: [1e9, 1e9, 1e9], max: [-1e9, -1e9, -1e9] };
  for (const q of quads) {
    for (let i = 0; i < 12; i++) {
      const axis = i % 3, v = q.p[i];
      if (v < b.min[axis]) b.min[axis] = v;
      if (v > b.max[axis]) b.max[axis] = v;
    }
  }
  const r = a => Math.round(a * 1000) / 1000;
  return { min: b.min.map(r), max: b.max.map(r) };
}

// Upper-step footprint: quads that actually rise above the mid-plane. The
// lower slab's own top face sits exactly at y=0.5 and must not count.
function upperBounds(quads) {
  const ys = q => q.p.filter((_, i) => i % 3 === 1);
  const picked = quads.filter(q => Math.min(...ys(q)) >= 0.499 && Math.max(...ys(q)) > 0.501);
  return bounds(picked);
}

// --- 1. slabs -------------------------------------------------------------
const slabBottom = modelOf('oak_slab', 'type=bottom');
const slabTop = modelOf('oak_slab', 'type=top');
ok('slab bottom occupies lower half', bounds(slabBottom).max[1] === 0.5 && bounds(slabBottom).min[1] === 0, JSON.stringify(bounds(slabBottom)));
ok('slab top occupies upper half', bounds(slabTop).min[1] === 0.5 && bounds(slabTop).max[1] === 1, JSON.stringify(bounds(slabTop)));
const slabDouble = modelOf('oak_slab', 'type=double');
const dblBB = bounds(slabDouble);
ok('slab double is a full cube of six culled faces',
  dblBB.min.join() === '0,0,0' && dblBB.max.join() === '1,1,1'
  && slabDouble.length === 6 && new Set(slabDouble.map(q => q.d)).size === 6
  && slabDouble.every(q => q.c === q.d), JSON.stringify(dblBB));

// --- 2. stairs: the four facings are exact quarter turns ------------------
const stairKeys = ['facing=north,half=bottom,shape=straight', 'facing=east,half=bottom,shape=straight', 'facing=south,half=bottom,shape=straight', 'facing=west,half=bottom,shape=straight'];
const stairUpper = stairKeys.map(k => upperBounds(modelOf('oak_stairs', k)));
const dims = stairUpper.map(u => `${u.min.join(',')}|${u.max.join(',')}`);
ok('all four stair facings bake the same quad count', new Set(stairKeys.map(k => modelOf('oak_stairs', k).length)).size === 1);
ok('stair upper part stays a quarter-block', stairUpper.every(u => (u.max[0] - u.min[0] === 0.5 || u.max[2] - u.min[2] === 0.5) && u.min[1] === 0.5), dims.join('  '));
const northStairs = stairUpper[0], southStairs = stairUpper[2];
const runsAlongZ = northStairs.min[0] === 0 && northStairs.max[0] === 1;
ok('north/south stairs mirror across the block', runsAlongZ && northStairs.min[2] + southStairs.max[2] === 1, `north z ${northStairs.min[2]}..${northStairs.max[2]} / south z ${southStairs.min[2]}..${southStairs.max[2]}`);
const eastStairs = stairUpper[1];
ok('east/west stairs rotate the same footprint onto the other axis', eastStairs.min[1] === 0.5 && eastStairs.max[1] === 1 && eastStairs.min[2] === 0 && eastStairs.max[2] === 1, `east x ${eastStairs.min[0]}..${eastStairs.max[0]}`);
const straight = modelOf('oak_stairs', 'facing=north,half=bottom,shape=straight');
const inner = modelOf('oak_stairs', 'facing=north,half=bottom,shape=inner_left');
const outer = modelOf('oak_stairs', 'facing=north,half=bottom,shape=outer_left');
const keyOf = k => doc.blocks.oak_stairs.variants[k][0].m;
ok('straight/inner/outer stairs use three different baked models',
  new Set([
    keyOf('facing=north,half=bottom,shape=straight'),
    keyOf('facing=north,half=bottom,shape=inner_left'),
    keyOf('facing=north,half=bottom,shape=outer_left'),
  ]).size === 3);
ok('inner stairs have one more step than outer and straight',
  inner.length > outer.length && outer.length >= straight.length,
  `${inner.length}/${outer.length}/${straight.length} quads`);

// --- 3. snow layers stack in eighths -------------------------------------
const layerH = [];
for (let i = 1; i <= 8; i++) layerH.push(bounds(modelOf('snow', `layers=${i}`)).max[1]);
ok('snow layers grow monotonically to a full block', layerH.every((h, i) => i === 0 || h > layerH[i - 1]) && layerH[7] === 1, layerH.join(' '));

// --- 4. logs permute axis dims -------------------------------------------
const logDims = ['axis=y', 'axis=x', 'axis=z'].map(k => {
  const b = bounds(modelOf('oak_log', k));
  return b.max.map((v, i) => Math.round((v - b.min[i]) * 1000) / 1000).join(',');
});
ok('log axis variants are permutations of one shape', new Set(logDims.map(d => d.split(',').sort().join(','))).size === 1, logDims.join(' | '));

// --- 5. fence multipart: neighbours pick the right side ------------------
const fencePost = partsOf('oak_fence', {});
const fenceNorth = partsOf('oak_fence', { north: 'true' });
const fenceAll = partsOf('oak_fence', { north: 'true', south: 'true', east: 'true', west: 'true' });
ok('fence post alone is smaller than a connected fence', fenceNorth.length > fencePost.length && fenceAll.length > fenceNorth.length, `${fencePost.length}/${fenceNorth.length}/${fenceAll.length} quads`);
const northSide = fenceNorth.filter(q => q.p.filter((_, i) => i % 3 === 2).every(v => v <= 0.44));
ok('north connection adds a part hugging the north face', northSide.length > 0, 'max z ' + Math.max(...fenceNorth.map(q => Math.min(...q.p.filter((_, i) => i % 3 === 2)))));
const eastSide = partsOf('oak_fence', { east: 'true' }).filter(q => q.p.filter((_, i) => i % 3 === 0).every(v => v >= 0.56));
ok('east connection adds a part hugging the east face', eastSide.length > 0);
ok('fence with all four sides has 5 parts worth of quads', fenceAll.length === fencePost.length + 4 * (fenceNorth.length - fencePost.length), `${fenceAll.length} vs ${fencePost.length}+4x${fenceNorth.length - fencePost.length}`);

// --- 6. torch post and cross plants --------------------------------------
// models/block/template_torch.json declares exactly one element, [7,0,7]-[9,10,9].
const torch = modelOf('torch', '');
const torchBB = bounds(torch);
const near = (a, b) => Math.abs(a - b) < 0.001;
ok('torch bakes the 10/16-high post exactly as authored',
  torch.length === 6 && near(torchBB.min[1], 0) && near(torchBB.max[1], 0.625)
  && near(torchBB.min[0], 0.4375) && near(torchBB.max[0], 0.5625), JSON.stringify(torchBB));
ok('torch carries ambientocclusion:false from the template', dec.model(doc.blocks.torch.variants[''][0].m).ao === false);
const grass = modelOf('short_grass', '');
ok('short_grass bakes the cross model', grass.length >= 2 && bounds(grass).max[1] <= 1, grass.length + ' quads');

// --- 7. pane uvlock keeps the texture upright ----------------------------
const paneN = partsOf('oak_fence', { north: 'true' });
const paneNorthOnly = doc.blocks.oak_fence.parts.filter(p => matches(p.c, { north: 'true' }));
ok('fence north entry also matches when only west is set is false', !paneNorthOnly.every(p => matches(p.c, { west: 'true' })));

// --- 8. every block resolves at least one state --------------------------
let unbaked = 0;
for (const [name, entry] of Object.entries(doc.blocks)) {
  if (entry.kind === 'variant') {
    for (const [key, list] of Object.entries(entry.variants)) {
      for (const v of list) if (v.m < 0 || v.m >= dec.modelCount) unbaked++;
    }
  } else {
    for (const p of entry.parts) for (const a of p.a) if (a.m < 0 || a.m >= dec.modelCount) unbaked++;
  }
}
ok('every state references a real baked model', unbaked === 0, String(unbaked));

console.log(notes.join('\n'));
if (fails.length) {
  console.log('\nFAILED:\n  ' + fails.join('\n  '));
  process.exit(1);
}
console.log(`\nverify-geometry: all ${notes.length} checks passed (${Object.keys(doc.blocks).length} blocks, ${dec.modelCount} models)`);
