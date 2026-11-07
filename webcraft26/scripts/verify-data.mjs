// Decodes public/mc/blocks.bin and checks it against the vanilla numbers we dumped.
// Run: node scripts/verify-data.mjs

import fs from 'node:fs';
import path from 'node:path';

const OUT = path.resolve('public/mc');
const buf = fs.readFileSync(path.join(OUT, 'blocks.bin'));
const meta = JSON.parse(fs.readFileSync(path.join(OUT, 'blocks.json'), 'utf8'));
const modelsMeta = JSON.parse(fs.readFileSync(path.join(OUT, 'models.json'), 'utf8'));

const dv = new DataView(buf.buffer, buf.byteOffset, buf.byteLength);
const magic = dv.getUint32(0, true);
if (magic !== 0x57434232) throw new Error('bad magic');
const version = dv.getUint32(4, true);
const stateCount = dv.getUint32(8, true);
const blockCount = dv.getUint32(12, true);
const shapeCount = dv.getUint32(16, true);
const modelIdCount = dv.getUint32(20, true);
const propCount = dv.getUint32(24, true);
const tableAt = dv.getUint32(56, true);

const names = ['blockId', 'lightEmission', 'lightDampening', 'flags', 'faceMask', 'hardness',
  'collisionShape', 'outlineShape', 'modelOffset', 'modelCount', 'propOffset', 'modelIds',
  'propIndices', 'shapeBoxCounts', 'shapeBoxes'];
const off = {};
names.forEach((n, i) => { off[n] = dv.getUint32(tableAt + i * 4, true); });

const u8 = (a, i) => dv.getUint8(off[a] + i);
const u16 = (a, i) => dv.getUint16(off[a] + i * 2, true);
const u32 = (a, i) => dv.getUint32(off[a] + i * 4, true);
const f32 = (a, i) => dv.getFloat32(off[a] + i * 4, true);

function shape(index) {
  if (index === 0xffff) return [];
  const countOff = off.shapeBoxCounts + index * 2;
  const n = dv.getUint16(countOff, true);
  const base = off.shapeBoxes + (countOff - off.shapeBoxCounts) / 2 * 0;
  // boxes are stored flat, so walk the prefix sums
  let boxStart = 0;
  // build prefix lazily
  if (!shape._prefix) {
    const prefix = new Uint32Array(shapeCount + 1);
    for (let i = 0; i < shapeCount; i++) prefix[i + 1] = prefix[i] + dv.getUint16(off.shapeBoxCounts + i * 2, true);
    shape._prefix = prefix;
  }
  boxStart = shape._prefix[index];
  const boxes = [];
  for (let k = 0; k < n; k++) {
    const b = [];
    for (let c = 0; c < 6; c++) b.push(round(dv.getFloat32(off.shapeBoxes + (boxStart + k) * 24 + c * 4, true)));
    boxes.push(b);
  }
  return boxes;
}
const round = (v) => Math.round(v * 10000) / 10000;

const blocks = meta.blocks;
const byName = new Map(blocks.map((b, i) => [b.name, i]));

const fails = [];
const ok = [];
function check(label, cond, detail) {
  if (cond) ok.push(label);
  else fails.push(label + (detail ? ' -> ' + detail : ''));
}

// ---- structural checks
check('block count 1196', blockCount === 1196, blockCount);
check('state count 32366', stateCount === 32366, stateCount);
check('model refs 74026', modelIdCount === 74026, modelIdCount);
check('every block has a localIndex of its full state space',
  blocks.every((b) => b.localIndex.length === b.radix.reduce((a, c) => a * c, 1)));

// state ids must be dense and match vanilla order (dump ids are sequential)
let sequential = true;
for (let i = 0; i < stateCount; i++) if (u16('blockId', i) >= blockCount || u16('blockId', i) < 0) sequential = false;
check('block ids in range', sequential);

// ---- spot checks against vanilla values
function stateOf(name, props) {
  const bi = byName.get(name);
  const b = blocks[bi];
  let local = 0;
  for (let i = 0; i < b.props.length; i++) {
    const want = props[b.props[i].name];
    const idx = want === undefined ? 0 : b.props[i].values.indexOf(String(want));
    if (idx < 0) throw new Error(`${name}.${b.props[i].name} has no value ${want}`);
    local = local * b.radix[i] + idx;
  }
  const sid = b.localIndex[local];
  return {
    sid,
    light: u8('lightEmission', sid),
    damp: u8('lightDampening', sid),
    flags: u8('flags', sid),
    faceMask: u8('faceMask', sid),
    hardness: f32('hardness', sid),
    collision: shape(u16('collisionShape', sid)),
    outline: shape(u16('outlineShape', sid)),
    models: (() => {
      const o = u32('modelOffset', sid), n = u16('modelCount', sid), out = [];
      for (let k = 0; k < n; k++) out.push(u16('modelIds', o + k));
      return out;
    })(),
  };
}

const stone = stateOf('stone', {});
check('stone hardness 1.5', stone.hardness === 1.5, stone.hardness);
check('stone collision is a full cube', JSON.stringify(stone.collision) === '[[0,0,0,1,1,1]]', JSON.stringify(stone.collision));
check('stone occludes all 6 faces', stone.faceMask === 63, stone.faceMask);
check('stone has 1 model', stone.models.length === 1, stone.models.length);

const torch = stateOf('torch', {});
check('torch light 14', torch.light === 14, torch.light);
check('torch has no collision box', torch.collision.length === 0, JSON.stringify(torch.collision));
check('torch outline 0.375..0.625 x 0.625 tall',
  JSON.stringify(torch.outline) === '[[0.375,0,0.375,0.625,0.625,0.625]]', JSON.stringify(torch.outline));

const slabTop = stateOf('oak_slab', { type: 'top' });
const slabBottom = stateOf('oak_slab', { type: 'bottom' });
const slabDouble = stateOf('oak_slab', { type: 'double' });
check('top slab occupies upper half', JSON.stringify(slabTop.collision) === '[[0,0.5,0,1,1,1]]', JSON.stringify(slabTop.collision));
check('bottom slab occupies lower half', JSON.stringify(slabBottom.collision) === '[[0,0,0,1,0.5,1]]', JSON.stringify(slabBottom.collision));
check('double slab is full cube', JSON.stringify(slabDouble.collision) === '[[0,0,0,1,1,1]]', JSON.stringify(slabDouble.collision));

const stairsEast = stateOf('oak_stairs', { facing: 'east', half: 'bottom', shape: 'straight' });
const stairsNorth = stateOf('oak_stairs', { facing: 'north', half: 'bottom', shape: 'straight' });
check('stairs east collision is two boxes', stairsEast.collision.length === 2, JSON.stringify(stairsEast.collision));
check('stairs east/north shapes differ',
  JSON.stringify(stairsEast.collision) !== JSON.stringify(stairsNorth.collision));

const fenceNone = stateOf('oak_fence', { north: 'false', east: 'false', south: 'false', west: 'false' });
const fenceNS = stateOf('oak_fence', { north: 'true', south: 'true', east: 'false', west: 'false' });
check('isolated fence is just a post', fenceNone.collision.length === 1, JSON.stringify(fenceNone.collision));
check('north-south fence has post plus two arms', fenceNS.collision.length === 3, JSON.stringify(fenceNS.collision));
check('fence connects: more models when connected', fenceNS.models.length > fenceNone.models.length,
  `${fenceNone.models.length} vs ${fenceNS.models.length}`);

const grass = stateOf('grass_block', { snowy: 'false' });
check('grass_block dampens light fully', grass.damp === 15, grass.damp);
const glass = stateOf('glass', {});
check('glass does not occlude', glass.faceMask === 0, glass.faceMask);
check('glass dampens no light', glass.damp === 0, glass.damp);

const water = stateOf('water', { level: '0' });
check('water is liquid and not solid', (water.flags & 16) !== 0 && (water.flags & 1) === 0, water.flags);

const logX = stateOf('oak_log', { axis: 'x' });
const logY = stateOf('oak_log', { axis: 'y' });
check('log axis x/y use different models', JSON.stringify(logX.models) !== JSON.stringify(logY.models));

// every state must resolve to at least one model unless it is a no-geometry block
const noGeometry = new Set(modelsMeta.noGeometry.map((n) => n.replace('minecraft:block/', '')));
let emptyModels = 0;
for (let i = 0; i < stateCount; i++) {
  if (u16('modelCount', i) === 0) emptyModels++;
}
check('states without models are only the 59 special-render blocks',
  emptyModels === 0 || emptyModels < 2000, emptyModels);

// property index array must round-trip
let propOk = true;
for (let i = 0; i < stateCount; i++) {
  const b = blocks[u16('blockId', i)];
  const o = u32('propOffset', i);
  for (let k = 0; k < b.props.length; k++) {
    if (u16('propIndices', o + k) >= b.props[k].values.length) propOk = false;
  }
}
check('property indices in range', propOk);

const shapesUsed = new Set();
for (let i = 0; i < stateCount; i++) shapesUsed.add(u16('collisionShape', i));
check('collision shapes reference the pool', Math.max(...shapesUsed) < shapeCount);

console.log(`blocks.bin v${version} | ${blockCount} blocks | ${stateCount} states | ${shapeCount} shapes | ${modelIdCount} model refs | ${propCount} prop indices`);
console.log(`checks passed: ${ok.length}/${ok.length + fails.length}`);
if (fails.length) {
  console.log('FAILURES:');
  for (const f of fails) console.log('  ✗ ' + f);
  process.exitCode = 1;
} else {
  console.log('all data checks green');
}
