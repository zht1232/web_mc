// Packs the vanilla ground truth (blocks.json from the Java dump) plus the baked
// blockstate model table (states.json/bin) into the compact runtime data files the
// browser client loads:
//
//   public/mc/blocks.bin   per-state gameplay numbers, shapes and model ids
//   public/mc/blocks.json  block/property metadata used by the registry
//   public/mc/models.bin   baked quads (copied from data/states.bin)
//   public/mc/models.json  model metadata + texture table (copied from data/states.json)
//
// Everything here is derived from the local 26.2 client; nothing is hand written.

import fs from 'node:fs';
import path from 'node:path';

const ROOT = path.resolve('.');
const DATA = path.join(ROOT, 'data');
const OUT = path.join(ROOT, 'public', 'mc');

const MAGIC = 0x57434232; // "WCB2"
const VERSION = 2;

const dump = JSON.parse(fs.readFileSync(path.join(DATA, 'blocks.json'), 'utf8'));
const states = JSON.parse(fs.readFileSync(path.join(DATA, 'states.json'), 'utf8'));
const items = JSON.parse(fs.readFileSync(path.join(DATA, 'items.json'), 'utf8'));
const entities = JSON.parse(fs.readFileSync(path.join(DATA, 'entities.json'), 'utf8'));

// ---------------------------------------------------------------- properties

/** canonical, order independent key for a set of property values */
function canon(pairs) {
  return pairs.slice().sort((a, b) => (a[0] < b[0] ? -1 : a[0] > b[0] ? 1 : 0)).map(([k, v]) => k + '=' + v).join(',');
}

function parseVariantKey(key) {
  if (!key) return [];
  return key.split(',').map((part) => {
    const i = part.indexOf('=');
    return [part.slice(0, i), part.slice(i + 1).toLowerCase()];
  });
}

function evalCond(node, valueOf) {
  if (!node) return true;
  if (node.leaf) {
    return node.leaf.every((l) => {
      const v = valueOf(l.prop);
      return l.values.some((e) => (e.negate ? e.value !== v : e.value === v));
    });
  }
  if (node.all) return node.all.every((n) => evalCond(n, valueOf));
  if (node.any) return node.any.some((n) => evalCond(n, valueOf));
  return true;
}

// ------------------------------------------------------------------- shapes

const shapePool = [];
const shapeIndex = new Map();
function internShape(boxes) {
  const key = JSON.stringify(boxes);
  let i = shapeIndex.get(key);
  if (i === undefined) {
    i = shapePool.length;
    shapePool.push(boxes);
    shapeIndex.set(key, i);
  }
  return i;
}
internShape([]); // index 0 is always "empty"

// -------------------------------------------------------------------- build

const blocks = [];
const modelIdsFlat = [];
const propIndicesFlat = [];

const stateArrays = {
  blockId: [], lightEmission: [], lightDampening: [], flags: [], faceMask: [],
  hardness: [], collisionShape: [], outlineShape: [], modelOffset: [], modelCount: [],
  propOffset: [],
};

const errors = [];
let stateCount = 0;

const itemsByName = new Map(items.items.map((i) => [i.name, i]));

function propValueOf(stateProps, propNames, name) {
  const i = propNames.indexOf(name);
  if (i < 0) return undefined;
  return stateProps[i];
}

for (const block of dump.blocks) {
  // Java enum property values come back upper case ("FLOOR"); blockstate JSON is lower case.
  for (const p of block.props) p.values = p.values.map((v) => v.toLowerCase());
  const bs = states.blocks[block.name];
  const propNames = block.props.map((p) => p.name);
  const radix = block.props.map((p) => p.values.length);
  const product = radix.reduce((a, b) => a * b, 1);

  const blockIndex = blocks.length;

  // model lookup tables
  let variantMap = null;
  let parts = null;
  if (bs && bs.kind === 'variant') {
    // Vanilla allows a variant key to name only a subset of the block's properties;
    // such a key matches every state that agrees on the properties it does name.
    variantMap = [];
    for (const [key, arr] of Object.entries(bs.variants)) {
      variantMap.push({ pairs: parseVariantKey(key), arr });
    }
    variantMap.sort((a, b) => b.pairs.length - a.pairs.length);
  } else if (bs && bs.kind === 'multipart') {
    parts = bs.parts;
  } else if (bs) {
    errors.push(`${block.name}: unknown blockstate kind ${bs.kind}`);
  }

  const localIndex = new Uint16Array(product); // mixed radix -> state id, filled below
  const seenLocal = new Uint8Array(product);

  for (const st of block.states) {
    const [id, indices, lightEmission, lightDampening, solid, occlude, useShape, propagateSky, air, liquid, fluid, emissive, hardness, collision, occlusion, visual, outline, faceMask] = st;

    const props = indices.map((v, i) => block.props[i].values[v]);
    const valueOf = (name) => propValueOf(props, propNames, name);

    let models = null;
    if (variantMap) {
      for (const entry of variantMap) {
        let ok = true;
        for (const [k, v] of entry.pairs) {
          if (valueOf(k) !== v) { ok = false; break; }
        }
        if (ok) { models = entry.arr; break; }
      }
      if (!models) {
        // vanilla falls back to the file's own default entry when a key is missing
        errors.push(`${block.name}: no variant for ${propNames.map((n, i) => n + '=' + props[i]).join(',')}`);
        models = [];
      }
    } else if (parts) {
      const picked = [];
      for (const part of parts) {
        if (evalCond(part.c, valueOf)) picked.push(...part.a);
      }
      // weighted random: keep the first model of each weighted set (weights are
      // only ever >1 for a handful of chorus/flower states)
      models = picked;
    } else {
      models = [];
    }

    // mixed radix index
    let local = 0;
    for (let i = 0; i < indices.length; i++) local = local * radix[i] + indices[i];
    if (local < product && !seenLocal[local]) {
      localIndex[local] = stateCount;
      seenLocal[local] = 1;
    }

    stateArrays.blockId.push(blockIndex);
    stateArrays.lightEmission.push(lightEmission);
    stateArrays.lightDampening.push(lightDampening);
    stateArrays.flags.push(
      (solid ? 1 : 0) | (occlude ? 2 : 0) | (propagateSky ? 4 : 0) | (air ? 8 : 0) |
      (liquid ? 16 : 0) | (fluid ? 32 : 0) | (emissive ? 64 : 0) | (useShape ? 128 : 0),
    );
    stateArrays.faceMask.push(faceMask);
    stateArrays.hardness.push(hardness);
    stateArrays.collisionShape.push(internShape(collision));
    stateArrays.outlineShape.push(internShape(outline));
    stateArrays.modelOffset.push(modelIdsFlat.length);
    stateArrays.modelCount.push(models.length);
    for (const m of models) modelIdsFlat.push(m.m);
    stateArrays.propOffset.push(propIndicesFlat.length);
    for (let i = 0; i < indices.length; i++) propIndicesFlat.push(indices[i]);

    stateCount++;
  }

  const item = itemsByName.get(block.item);
  blocks.push({
    name: block.name,
    cls: block.cls,
    item: block.item || null,
    props: block.props,
    radix,
    defaultState: block.default,
    hardness: block.hardness,
    resistance: block.resistance,
    requiresTool: block.requiresTool,
    randomTicks: block.randomTicks,
    sound: block.sound,
    localIndex: Array.from(localIndex),
    maxStack: item ? item.maxStack : 64,
  });
}

if (stateCount !== dump.stateCount) {
  console.warn(`state count mismatch: packed ${stateCount}, dumped ${dump.stateCount}`);
}

// ------------------------------------------------------------------ binary

const stateCountFinal = stateCount;

function writeBin() {
  const chunks = [];
  let size = 0;
  const push = (buf) => { chunks.push(buf); size += buf.length; };

  const header = Buffer.alloc(64);
  header.writeUInt32LE(MAGIC, 0);
  header.writeUInt32LE(VERSION, 4);
  header.writeUInt32LE(stateCountFinal, 8);
  header.writeUInt32LE(blocks.length, 12);
  header.writeUInt32LE(shapePool.length, 16);
  header.writeUInt32LE(modelIdsFlat.length, 20);
  header.writeUInt32LE(propIndicesFlat.length, 24);
  push(header);

  const u8 = (arr) => Buffer.from(new Uint8Array(arr));
  const u16 = (arr) => { const b = Buffer.alloc(arr.length * 2); arr.forEach((v, i) => b.writeUInt16LE(v, i * 2)); return b; };
  const u32 = (arr) => { const b = Buffer.alloc(arr.length * 4); arr.forEach((v, i) => b.writeUInt32LE(v, i * 4)); return b; };
  const f32 = (arr) => { const b = Buffer.alloc(arr.length * 4); arr.forEach((v, i) => b.writeFloatLE(v, i * 4)); return b; };

  const offsets = {};
  const order = [
    ['blockId', () => u16(stateArrays.blockId)],
    ['lightEmission', () => u8(stateArrays.lightEmission)],
    ['lightDampening', () => u8(stateArrays.lightDampening)],
    ['flags', () => u8(stateArrays.flags)],
    ['faceMask', () => u8(stateArrays.faceMask)],
    ['hardness', () => f32(stateArrays.hardness)],
    ['collisionShape', () => u16(stateArrays.collisionShape)],
    ['outlineShape', () => u16(stateArrays.outlineShape)],
    ['modelOffset', () => u32(stateArrays.modelOffset)],
    ['modelCount', () => u16(stateArrays.modelCount)],
    ['propOffset', () => u32(stateArrays.propOffset)],
    ['modelIds', () => u16(modelIdsFlat)],
    ['propIndices', () => u16(propIndicesFlat)],
    ['shapeBoxCounts', () => u16(shapePool.map((s) => s.length))],
    ['shapeBoxes', () => f32(shapePool.flat(2))],
  ];
  for (const [name, make] of order) {
    offsets[name] = size;
    push(make());
  }

  // section offset table lives at the tail of the file; the header points at it
  const tablePos = size;
  const tableBuf = Buffer.alloc(64 * 4);
  Object.entries(offsets).forEach(([k, v], i) => {
    if (i < 32) tableBuf.writeUInt32LE(v, i * 4);
  });
  push(tableBuf);
  header.writeUInt32LE(tablePos, 56);

  const total = size;
  const out = Buffer.concat(chunks, total);
  fs.writeFileSync(path.join(OUT, 'blocks.bin'), out);
  return { bytes: out.length, offsets };
}

fs.mkdirSync(OUT, { recursive: true });
const meta = writeBin();

// metadata (human readable + registry input)
const metaOut = {
  generatedAt: new Date().toISOString(),
  blocks: blocks.map((b) => ({
    name: b.name, cls: b.cls, item: b.item, props: b.props, radix: b.radix,
    defaultState: b.defaultState, hardness: b.hardness, resistance: b.resistance,
    requiresTool: b.requiresTool ? 1 : 0, randomTicks: b.randomTicks ? 1 : 0,
    sound: b.sound, localIndex: b.localIndex, maxStack: b.maxStack,
  })),
  items: items.items,
  entities: entities.entities,
};
fs.writeFileSync(path.join(OUT, 'blocks.json'), JSON.stringify(metaOut));

// model data is shipped as-is
fs.copyFileSync(path.join(DATA, 'states.bin'), path.join(OUT, 'models.bin'));
fs.writeFileSync(path.join(OUT, 'models.json'), JSON.stringify({
  counts: states.counts,
  bin: states.bin,
  textures: states.textures,
  models: states.models,
  noGeometry: states.noGeometry,
}));

console.log(`blocks: ${blocks.length} | states: ${stateCount} | shapes: ${shapePool.length} | model refs: ${modelIdsFlat.length}`);
console.log(`blocks.bin ${(meta.bytes / 1048576).toFixed(2)} MB`);
if (errors.length) {
  console.log(`warnings ${errors.length}, first 10:`);
  for (const e of errors.slice(0, 10)) console.log('  ' + e);
}
