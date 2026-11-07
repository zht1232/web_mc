#!/usr/bin/env node
/**
 * verify-textures.mjs — sanity checks for the packed texture arrays produced by
 * scripts/build-textures.mjs.
 *
 * Run: node scripts/verify-textures.mjs
 * Exit code 0 = all checks passed, 1 = at least one failure.
 *
 * It re-reads the binaries from disk exactly the way the browser will, so a
 * green run means the files are loadable, correctly sized and self-consistent.
 */

import fs from 'node:fs/promises';
import { existsSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { PNG } from 'pngjs';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(HERE, '..');
const OUT = path.join(ROOT, 'public', 'mc');
const SRC =
  process.env.MC_ASSETS ||
  path.resolve(ROOT, '..', '_src/thirdparty/thirdparty/src-vanilla/assets/minecraft');

const SIZE = 16;
const LAYER_BYTES = SIZE * SIZE * 4;
const MAGIC = 0x57545831;
const VERSION = 1;
const HEADER_BYTES = 16;

let failures = 0;
const ok = (msg) => console.log(`  PASS  ${msg}`);
const bad = (msg) => {
  failures++;
  console.log(`  FAIL  ${msg}`);
};
const check = (cond, msg, detail = '') => (cond ? ok(msg) : bad(`${msg}${detail ? ' — ' + detail : ''}`));

/** Parse and validate the header of a WTX1 array file. */
async function loadArray(file) {
  const buf = await fs.readFile(file);
  const magic = buf.readUInt32LE(0);
  const version = buf.readUInt32LE(4);
  const layerCount = buf.readUInt32LE(8);
  const size = buf.readUInt32LE(12);
  const expected = HEADER_BYTES + layerCount * size * size * 4;
  return { buf, magic, version, layerCount, size, expected, actual: buf.length };
}

function layerSlice(arr, index) {
  const start = HEADER_BYTES + index * arr.size * arr.size * 4;
  return arr.buf.subarray(start, start + arr.size * arr.size * 4);
}

/** Byte-for-byte comparison with a human readable first-difference report. */
function sameBytes(a, b) {
  if (a.length !== b.length) return { equal: false, detail: `length ${a.length} vs ${b.length}` };
  for (let i = 0; i < a.length; i++) {
    if (a[i] !== b[i]) return { equal: false, detail: `first diff at byte ${i}: ${a[i]} vs ${b[i]}` };
  }
  return { equal: true };
}

async function verifySet(label, { binName, jsonName, animName }) {
  console.log(`\n[${label}]`);
  const binPath = path.join(OUT, 'tex', binName);
  const jsonPath = path.join(OUT, 'tex', jsonName);
  const animPath = path.join(OUT, 'tex', animName);

  for (const p of [binPath, jsonPath, animPath]) {
    check(existsSync(p), `${path.basename(p)} exists`);
    if (!existsSync(p)) return null;
  }

  const arr = await loadArray(binPath);
  const json = JSON.parse(await fs.readFile(jsonPath, 'utf8'));
  const anim = await fs.readFile(animPath);

  check(arr.magic === MAGIC, `${binName} magic = WTX1`, `got 0x${arr.magic.toString(16)}`);
  check(arr.version === VERSION, `${binName} version = 1`, `got ${arr.version}`);
  check(arr.size === SIZE, `${binName} layer size = 16`, `got ${arr.size}`);
  check(arr.actual === arr.expected, `${binName} byte length matches header`, `${arr.actual} vs ${arr.expected}`);
  check(json.size === SIZE, `${jsonName} size = 16`);
  check(json.layers === arr.layerCount, `${jsonName} layers === ${binName} layerCount`, `${json.layers} vs ${arr.layerCount}`);
  check(
    Array.isArray(json.names) && json.names.length === arr.layerCount,
    `${jsonName} names[] length === layerCount`,
    `${json.names?.length}`,
  );
  check(arr.layerCount > 0, `${binName} has layers`);

  // Every animated entry must point at a valid, in-range slice of anim.bin.
  let animOk = true;
  for (const [name, a] of Object.entries(json.animated)) {
    const problems = [];
    if (!Number.isInteger(a.layer) || a.layer < 0 || a.layer >= arr.layerCount) problems.push('bad layer');
    if (json.names[a.layer] !== name) problems.push('layer/name mismatch');
    if (a.offset + a.length > anim.length) problems.push('slice past anim.bin');
    if (a.length !== a.frames * LAYER_BYTES) problems.push('length != frames*1024');
    if (a.frames < 2) problems.push('frames < 2');
    if (problems.length) {
      animOk = false;
      bad(`${name}: ${problems.join(', ')}`);
    }
  }
  check(animOk, `${jsonName} animated entries consistent (${Object.keys(json.animated).length})`);
  return { arr, json, anim, binPath, jsonPath, animPath };
}

async function main() {
  console.log(`verifying ${path.join(OUT, 'tex')}`);

  const block = await verifySet('block', { binName: 'block.bin', jsonName: 'block.json', animName: 'anim.bin' });
  const item = await verifySet('item', { binName: 'item.bin', jsonName: 'item.json', animName: 'itemanim.bin' });
  if (!block) {
    console.error('\nblock array missing — run node scripts/build-textures.mjs first');
    process.exit(1);
  }

  // ---- block layer order must mirror models.json.textures -------------------
  console.log('\n[block vs models.json]');
  const models = JSON.parse(await fs.readFile(path.join(OUT, 'models.json'), 'utf8'));
  check(
    block.json.layers === models.textures.length,
    `block layerCount === models.json.textures.length (${block.json.layers})`,
    `${models.textures.length}`,
  );
  let nameMismatch = -1;
  for (let i = 0; i < models.textures.length; i++) {
    if (block.json.names[i] !== models.textures[i]) {
      nameMismatch = i;
      break;
    }
  }
  check(nameMismatch < 0, 'block.json names[] identical to models.json.textures[]', `index ${nameMismatch}`);

  // ---- block/stone must actually contain pixels ----------------------------
  console.log('\n[content checks]');
  const stoneIdx = block.json.names.indexOf('block/stone');
  check(stoneIdx >= 0, 'block/stone present', `index ${stoneIdx}`);
  if (stoneIdx >= 0) {
    const layer = layerSlice(block.arr, stoneIdx);
    let nonZero = 0;
    let opaque = 0;
    for (let i = 0; i < layer.length; i += 4) {
      if (layer[i] | layer[i + 1] | layer[i + 2] | layer[i + 3]) nonZero++;
      if (layer[i + 3] === 255) opaque++;
    }
    check(nonZero > 0, `block/stone layer ${stoneIdx} is not all zero (${nonZero}/${SIZE * SIZE} texels)`, 'all zero');
    check(opaque === SIZE * SIZE, `block/stone is fully opaque (${opaque} texels)`);
  }

  // ---- water_still: array layer === frame 0 of the source PNG, byte for byte
  const waterIdx = block.json.names.indexOf('block/water_still');
  check(waterIdx >= 0, 'block/water_still present', `index ${waterIdx}`);
  if (waterIdx >= 0) {
    const srcPath = path.join(SRC, 'textures', 'block', 'water_still.png');
    const png = PNG.sync.read(await fs.readFile(srcPath));
    const firstFrame = Buffer.alloc(LAYER_BYTES);
    for (let y = 0; y < SIZE; y++) {
      const s = y * png.width * 4;
      png.data.copy(firstFrame, y * SIZE * 4, s, s + SIZE * 4);
    }
    const cmp = sameBytes(layerSlice(block.arr, waterIdx), firstFrame);
    check(cmp.equal, 'block/water_still layer === source PNG frame 0 (byte for byte)', cmp.detail);

    // ...and the same bytes must be the first 1024 bytes of its anim.bin slice.
    const a = block.json.animated['block/water_still'];
    if (a) {
      const cmp2 = sameBytes(block.anim.subarray(a.offset, a.offset + LAYER_BYTES), firstFrame);
      check(cmp2.equal, 'anim.bin water_still frame 0 === array layer', cmp2.detail);
      check(a.frames === 32 && png.height === 16 * 32, `water_still frames = 32`, `json ${a.frames}, png height ${png.height}`);
    } else {
      bad('block.json.animated is missing block/water_still');
    }
  }

  // ---- lava_still frame count ---------------------------------------------
  const lavaIdx = block.json.names.indexOf('block/lava_still');
  check(lavaIdx >= 0, 'block/lava_still present', `index ${lavaIdx}`);
  if (lavaIdx >= 0) {
    const a = block.json.animated['block/lava_still'];
    if (!a) bad('block.json.animated is missing block/lava_still');
    else {
      const src = PNG.sync.read(await fs.readFile(path.join(SRC, 'textures', 'block', 'lava_still.png')));
      check(a.frames === src.height / 16, `lava_still frames = png height/16 (${a.frames})`);
      check(a.frames === 20, 'lava_still frames = 20', String(a.frames));
      check(Array.isArray(a.frameList) && a.frameList.length === 38, 'lava_still frameList = 38 steps', `${a.frameList?.length}`);
      check(a.length === a.frames * LAYER_BYTES, 'lava_still anim slice length = frames*1024');
      check(a.layer === lavaIdx, 'lava_still layer index matches names[]');
      const cmp = sameBytes(
        block.anim.subarray(a.offset, a.offset + LAYER_BYTES),
        layerSlice(block.arr, lavaIdx),
      );
      check(cmp.equal, 'lava_still anim frame 0 === array layer', cmp.detail);
    }
  }

  // ---- alpha handling ------------------------------------------------------
  // glass is a pure cutout (alpha 0 / 255), ice and tinted_glass carry partial
  // alpha. Comparing byte for byte proves we neither premultiplied the colour nor
  // clamped the alpha channel to 0/255 on the way into the array.
  const alphaCases = ['block/glass', 'block/ice', 'block/tinted_glass', 'block/oak_leaves'];
  for (const name of alphaCases) {
    const idx = block.json.names.indexOf(name);
    if (idx < 0) {
      bad(`${name} missing from block.json`);
      continue;
    }
    const src = PNG.sync.read(await fs.readFile(path.join(SRC, 'textures', ...name.split('/')) + '.png'));
    const cmp = sameBytes(layerSlice(block.arr, idx), src.data.subarray(0, LAYER_BYTES));
    check(cmp.equal, `${name} layer === source PNG (alpha preserved, straight)`, cmp.detail);
  }

  // ---- spot check a spread of static 16x16 block textures ------------------
  const sampled = [];
  for (let i = 0; i < block.json.names.length; i += 47) sampled.push(i);
  let sampleBad = 0;
  for (const i of sampled) {
    const name = block.json.names[i];
    if (block.json.animated[name]) continue; // frame 0 of an animation is covered elsewhere
    const p = path.join(SRC, 'textures', ...name.split('/')) + '.png';
    if (!existsSync(p)) continue;
    const src = PNG.sync.read(await fs.readFile(p));
    if (src.width !== 16 || src.height !== 16) continue; // resampled ones cannot match byte for byte
    if (!sameBytes(layerSlice(block.arr, i), src.data.subarray(0, LAYER_BYTES)).equal) {
      sampleBad++;
      bad(`layer ${i} (${name}) differs from source PNG`);
    }
  }
  check(sampleBad === 0, `sampled ${sampled.length} static layers match their source PNGs`);

  // ---- every frame-stacked source must be listed in animated[] -------------
  // (reads only IHDR, so this is cheap)
  const shouldAnimate = [];
  for (const name of block.json.names) {
    const p = path.join(SRC, 'textures', ...name.split('/')) + '.png';
    if (!existsSync(p)) continue;
    const buf = await fs.readFile(p);
    const w = buf.readUInt32BE(16);
    const h = buf.readUInt32BE(20);
    if (w > 0 && h > w && h % w === 0) shouldAnimate.push(name);
  }
  const missedAnim = shouldAnimate.filter((n) => !block.json.animated[n]);
  check(
    missedAnim.length === 0,
    `all ${shouldAnimate.length} frame-stacked sources are in animated[]`,
    missedAnim.slice(0, 5).join(', '),
  );

  // ---- item set shape ------------------------------------------------------
  if (item) {
    const sorted = [...item.json.names].sort((a, b) => a.localeCompare(b, 'en'));
    check(JSON.stringify(sorted) === JSON.stringify(item.json.names), 'item.json names sorted alphabetically');
    check(item.json.names.every((n) => n.startsWith('item/')), 'item.json names all prefixed item/');
    const sword = item.json.names.indexOf('item/diamond_sword');
    check(sword >= 0, 'item/diamond_sword present', `index ${sword}`);
    if (sword >= 0) {
      const layer = layerSlice(item.arr, sword);
      let nonZero = 0;
      for (let i = 0; i < layer.length; i += 4) if (layer[i] | layer[i + 1] | layer[i + 2] | layer[i + 3]) nonZero++;
      check(nonZero > 0, 'item/diamond_sword layer is not all zero');
      const src = PNG.sync.read(await fs.readFile(path.join(SRC, 'textures', 'item', 'diamond_sword.png')));
      const cmp = sameBytes(layer, src.data.subarray(0, LAYER_BYTES));
      check(cmp.equal, 'item/diamond_sword layer === source PNG', cmp.detail);
    }
  }

  // ---- panorama ------------------------------------------------------------
  console.log('\n[panorama]');
  const panoDir = path.join(OUT, 'textures', 'gui', 'title', 'background');
  let panoOk = 0;
  for (let i = 0; i < 6; i++) {
    const p = path.join(panoDir, `panorama_${i}.png`);
    if (!existsSync(p)) {
      bad(`panorama_${i}.png missing`);
      continue;
    }
    const buf = await fs.readFile(p);
    const w = buf.readUInt32BE(16);
    const h = buf.readUInt32BE(20);
    if (w > 0 && h > 0) panoOk++;
    console.log(`  info  panorama_${i}.png ${w}x${h} ${buf.length} B`);
  }
  check(panoOk === 6, 'all 6 panorama faces copied');

  console.log('');
  if (failures) {
    console.log(`RESULT: ${failures} check(s) FAILED`);
    process.exit(1);
  }
  console.log('RESULT: all checks passed');
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
