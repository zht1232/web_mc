#!/usr/bin/env node
/**
 * build-textures.mjs — texture asset pipeline for the WebCraft26 WebGL2 client.
 *
 *   input : <vanilla>/assets/minecraft   (extracted official 26.2 client jar)
 *   output: public/mc/**                 (nothing is ever written outside public/mc)
 *
 * Run: node scripts/build-textures.mjs
 * Idempotent — every output is rewritten from scratch, no incremental state.
 *
 * The script does five things:
 *
 *   1. Mirrors the whole `textures/**` tree, `font/**`, `lang/en_us.json` and
 *      `texts/splashes.txt` into public/mc. GUI / entity / particle / environment
 *      / painting / map / mob_effect PNGs are consumed straight from there, they
 *      are not packed.
 *
 *   2. Packs every block texture referenced by public/mc/models.json into a 2D
 *      texture array: public/mc/tex/block.bin + block.json. Layer i is exactly
 *      models.json.textures[i] (that array is the model binary's reference order,
 *      so a baked quad's texture index *is* its array layer).
 *
 *   3. Writes the animation frames of the animated block textures to
 *      public/mc/tex/anim.bin; block.json entries carry { offset, length }.
 *
 *   4. Same treatment for textures/item/*.png -> item.bin / item.json / itemanim.bin.
 *
 *   5. Prints a summary (file sizes, layer counts, animated textures, warnings).
 *
 * ---------------------------------------------------------------------------
 * Binary format of block.bin / item.bin (little-endian)
 *
 *   u32 magic      0x57545831  ("WTX1")
 *   u32 version    1
 *   u32 layerCount
 *   u32 size       16                       (square layers)
 *   layerCount * size * size * 4 bytes, RGBA8, layer-major (layer 0 first),
 *   rows top to bottom, straight (non-premultiplied) alpha.
 *
 * anim.bin / itemanim.bin are the raw frame data, concatenated in block.json /
 * item.json order, each texture contributing frames * 16 * 16 * 4 bytes with
 * frame 0 first (RGBA8, same orientation as the array layers). A texture whose
 * { offset, length } is absent is simply not animated.
 *
 * ---------------------------------------------------------------------------
 * Things the renderer author must know
 *
 *   * Row 0 of every layer is the TOP row of the PNG. Upload the arrays with
 *     gl.pixelStorei(UNPACK_FLIP_Y_WEBGL, false) and flip V when you build the
 *     mesh UVs (vanilla model UVs are top-left origin, v down), i.e. a quad's
 *     uv (0,0) addresses the top-left texel of the layer.
 *   * Alpha is straight, not premultiplied -> blendFunc(SRC_ALPHA, ONE_MINUS_SRC_ALPHA).
 *     Do not premultiply when uploading RGBA8 data to WebGL, it will double-darken
 *     the cutout edges.
 *   * The array layer of an animated texture holds PNG frame 0 (a still). When
 *     `frameList` is present, the first frame vanilla actually plays is
 *     frameList[0].index, so animate from anim.bin and use the array layer only
 *     as a static fallback / for mipmap generation.
 *   * `frames` is the number of frames stacked in the PNG. `frameList.length` is
 *     the playback length and may differ (e.g. block/lava_still has 20 source
 *     frames but 38 playback entries). When frameList is null, playback order is
 *     0..frames-1, one step every `frametime` ticks (20 ticks = 1 second).
 *   * Textures that were not 16x16 got resampled to 16x16 with a premultiplied
 *     box filter (integer downscale) or nearest neighbour; the script warns about
 *     each one. Signs / shelves / hanging signs are authored at 32x32 in 26.2.
 */

import fs from 'node:fs/promises';
import { existsSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { PNG } from 'pngjs';

// ---------------------------------------------------------------------------
// Paths
// ---------------------------------------------------------------------------

const HERE = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(HERE, '..');
const OUT = path.join(ROOT, 'public', 'mc'); // hard boundary: never write outside

// Vanilla assets. Override with MC_ASSETS=/path/to/assets/minecraft if needed.
const SRC =
  process.env.MC_ASSETS ||
  path.resolve(ROOT, '..', '_src/thirdparty/thirdparty/src-vanilla/assets/minecraft');

const SRC_TEX = path.join(SRC, 'textures');
const TEX_OUT = path.join(OUT, 'tex');

// ---------------------------------------------------------------------------
// Format constants
// ---------------------------------------------------------------------------

const SIZE = 16; // array layer edge, in texels
const LAYER_BYTES = SIZE * SIZE * 4; // RGBA8
const MAGIC = 0x57545831; // "WTX1"
const VERSION = 1;
const HEADER_BYTES = 16; // magic + version + layerCount + size

// ---------------------------------------------------------------------------
// Small helpers
// ---------------------------------------------------------------------------

/** Warnings are collected and printed once, after the run. */
const warnings = [];
const warn = (msg) => warnings.push(msg);

/** All writes must stay inside public/mc. */
function outPath(...parts) {
  const p = path.join(OUT, ...parts);
  if (!p.startsWith(OUT + path.sep) && p !== OUT) throw new Error(`refusing to write outside public/mc: ${p}`);
  return p;
}

const rel = (abs) => path.relative(SRC, abs).split(path.sep).join('/');

/** Recursively list files below `dir` (absolute paths). */
async function walk(dir) {
  const out = [];
  const stack = [dir];
  while (stack.length) {
    const cur = stack.pop();
    for (const ent of await fs.readdir(cur, { withFileTypes: true })) {
      const abs = path.join(cur, ent.name);
      if (ent.isDirectory()) stack.push(abs);
      else out.push(abs);
    }
  }
  return out;
}

/**
 * Mirror `srcDir` into `dstDir`, preserving the relative layout, and return
 * { files, bytes }. Uses a small pool of concurrent copyFile calls: on Windows
 * fs.cp() walks the tree sequentially and can take minutes for a few thousand
 * tiny PNGs, while 12 parallel copies finish in about a second.
 */
async function mirrorTree(srcDir, dstDir, concurrency = 12) {
  if (!existsSync(srcDir)) throw new Error(`missing source directory ${srcDir}`);
  const files = await walk(srcDir);
  let bytes = 0;
  for (const f of files) bytes += (await fs.stat(f)).size;

  let next = 0;
  const worker = async () => {
    while (next < files.length) {
      const src = files[next++];
      const dst = path.join(dstDir, path.relative(srcDir, src));
      await fs.mkdir(path.dirname(dst), { recursive: true });
      await fs.copyFile(src, dst); // overwrite -> idempotent
    }
  };
  await Promise.all(Array.from({ length: Math.min(concurrency, files.length) }, worker));
  return { files: files.length, bytes };
}

const fmtBytes = (n) => `${n.toLocaleString('en-US')} B (${(n / 1024).toFixed(1)} KiB)`;

/** Read only the IHDR dimensions of a PNG without inflating it (used for panorama). */
async function pngDims(file) {
  const fh = await fs.open(file, 'r');
  try {
    const buf = Buffer.alloc(24);
    await fh.read(buf, 0, 24, 0);
    if (buf.readUInt32BE(0) !== 0x89504e47) throw new Error('not a PNG: ' + file);
    return { w: buf.readUInt32BE(16), h: buf.readUInt32BE(20) };
  } finally {
    await fh.close();
  }
}

// ---------------------------------------------------------------------------
// Frame extraction / resampling
//
// Every source texture is either exactly 16x16 (copy straight through) or has
// to be brought to 16x16: vanilla stacks animation frames as square tiles
// (frame height == texture width), so a 16x512 sheet is 32 frames of 16x16 and
// a 32x32 sign is a single static 32x32 image that must be downscaled.
// ---------------------------------------------------------------------------

/**
 * Copy one sw x sh region of `png` (top-left at sx,sy) into a 16x16 RGBA8
 * buffer. Downscaling by an integer factor uses a premultiplied box filter so
 * semi-transparent cutout edges do not pick up dark fringes; other ratios fall
 * back to nearest neighbour.
 */
function resampleRect(png, sx, sy, sw, sh, out) {
  const data = png.data;
  const stride = png.width;

  // Fast path: the overwhelmingly common case.
  if (sw === SIZE && sh === SIZE) {
    for (let y = 0; y < SIZE; y++) {
      const s = ((sy + y) * stride + sx) * 4;
      data.copy(out, y * SIZE * 4, s, s + SIZE * 4);
    }
    return;
  }

  if (sw % SIZE === 0 && sh % SIZE === 0) {
    // Integer box downsample (2x2 for the 32x32 sign textures).
    const bx = sw / SIZE;
    const by = sh / SIZE;
    const n = bx * by;
    for (let y = 0; y < SIZE; y++) {
      for (let x = 0; x < SIZE; x++) {
        let rp = 0, gp = 0, bp = 0, asum = 0;
        for (let j = 0; j < by; j++) {
          for (let i = 0; i < bx; i++) {
            const si = ((sy + y * by + j) * stride + sx + x * bx + i) * 4;
            const a = data[si + 3];
            const f = a / 255;
            rp += data[si] * f;
            gp += data[si + 1] * f;
            bp += data[si + 2] * f;
            asum += a;
          }
        }
        const di = (y * SIZE + x) * 4;
        if (asum === 0) {
          out[di] = out[di + 1] = out[di + 2] = out[di + 3] = 0;
        } else {
          out[di] = Math.min(255, Math.round((rp * 255) / asum));
          out[di + 1] = Math.min(255, Math.round((gp * 255) / asum));
          out[di + 2] = Math.min(255, Math.round((bp * 255) / asum));
          out[di + 3] = Math.round(asum / n);
        }
      }
    }
    return;
  }

  // Nearest neighbour for odd sizes.
  for (let y = 0; y < SIZE; y++) {
    const syy = Math.min(sh - 1, Math.floor((y * sh) / SIZE));
    for (let x = 0; x < SIZE; x++) {
      const sxx = Math.min(sw - 1, Math.floor((x * sw) / SIZE));
      const si = ((sy + syy) * stride + sx + sxx) * 4;
      const di = (y * SIZE + x) * 4;
      out[di] = data[si];
      out[di + 1] = data[si + 1];
      out[di + 2] = data[si + 2];
      out[di + 3] = data[si + 3];
    }
  }
}

/** Extract stacked frame `index` (0-based, frame height == png.width) into `out`. */
function extractFrame(png, index, out) {
  const w = png.width;
  resampleRect(png, 0, index * w, w, w, out);
}

/** Magenta / black checkerboard used when a texture referenced by models.json is missing. */
function placeholderLayer() {
  const buf = Buffer.alloc(LAYER_BYTES);
  for (let y = 0; y < SIZE; y++) {
    for (let x = 0; x < SIZE; x++) {
      const magenta = ((x >> 2) + (y >> 2)) % 2 === 0;
      const o = (y * SIZE + x) * 4;
      buf[o] = magenta ? 255 : 0;
      buf[o + 1] = 0;
      buf[o + 2] = magenta ? 255 : 0;
      buf[o + 3] = 255;
    }
  }
  return buf;
}

// ---------------------------------------------------------------------------
// .mcmeta animation parsing
// ---------------------------------------------------------------------------

/**
 * Resolve animation metadata for one PNG.
 * Returns null for static textures, otherwise
 *   { frames, frametime, interpolate, frameList }
 * where `frames` is the number of tiles stacked in the PNG and `frameList` is
 * the optional playback order ([{ index, time }]) or null.
 */
async function readAnim(pngPath, w, h) {
  const metaPath = pngPath + '.mcmeta';
  let meta = null;
  if (existsSync(metaPath)) {
    try {
      meta = JSON.parse(await fs.readFile(metaPath, 'utf8'));
    } catch {
      warn(`unreadable mcmeta, ignored: ${rel(metaPath)}`);
    }
  }

  const anim = meta && typeof meta === 'object' ? meta.animation : null;

  // Vanilla stacks square frames: a 16x512 sheet is 32 frames of 16x16.
  const frameCount = h % w === 0 ? h / w : 0;

  if (frameCount <= 1) {
    if (anim) warn(`mcmeta declares an animation but ${rel(pngPath)} is ${w}x${h}; treated as static`);
    return null;
  }

  if (!anim) {
    // No mcmeta at all: height being a multiple of width is the only hint we have.
    warn(`animated by aspect ratio, no mcmeta: ${rel(pngPath)} (${w}x${h}, ${frameCount} frames)`);
  }

  // Vanilla's default frametime is 1 tick.
  const frametime =
    anim && Number.isFinite(anim.frametime) && anim.frametime > 0 ? Math.max(1, Math.round(anim.frametime)) : 1;
  const interpolate = !!(anim && anim.interpolate === true);

  let frameList = null;
  if (anim && Array.isArray(anim.frames) && anim.frames.length > 0) {
    frameList = [];
    for (const f of anim.frames) {
      const index = typeof f === 'number' ? f : f && typeof f === 'object' ? f.index : undefined;
      const time =
        f && typeof f === 'object' && Number.isFinite(f.time) ? Math.max(1, Math.round(f.time)) : frametime;
      if (!Number.isInteger(index) || index < 0 || index >= frameCount) {
        warn(`frame index ${index} out of range in ${rel(metaPath)} (${frameCount} frames); skipped`);
        continue;
      }
      frameList.push({ index, time });
    }
    if (frameList.length === 0) frameList = null;
  }

  return { frames: frameCount, frametime, interpolate, frameList };
}

// ---------------------------------------------------------------------------
// Packing one texture set (blocks or items)
// ---------------------------------------------------------------------------

/**
 * @param {object}   opts
 * @param {string}   opts.label      human readable set name for logging
 * @param {string}   opts.srcDir     directory that holds the PNGs
 * @param {{name:string,file:string}[]} opts.entries  name -> file, order preserved
 * @param {string}   opts.binName    file name inside public/mc/tex
 * @param {string}   opts.jsonName
 * @param {string}   opts.animName
 */
async function packSet({ label, srcDir, entries, binName, jsonName, animName }) {
  /** @type {Buffer[]} one 16x16 RGBA8 layer per entry, in `entries` order */
  const layers = [];
  const names = [];
  /** name -> animation record */
  const animated = {};
  /** @type {Buffer[]} */
  const animChunks = [];
  let animCursor = 0; // byte offset inside anim.bin

  const missing = [];
  const resized = [];

  for (const { name, file } of entries) {
    const pngPath = path.join(srcDir, file);
    names.push(name);

    let png = null;
    if (existsSync(pngPath)) {
      try {
        png = PNG.sync.read(await fs.readFile(pngPath));
      } catch (err) {
        warn(`cannot decode ${rel(pngPath)}: ${err.message}`);
      }
    } else {
      missing.push(name);
    }

    if (!png) {
      // Keep the layer indices stable: a placeholder still occupies its slot.
      layers.push(placeholderLayer());
      continue;
    }

    const anim = await readAnim(pngPath, png.width, png.height);
    const layerIndex = layers.length;
    const layer = Buffer.alloc(LAYER_BYTES);
    extractFrame(png, 0, layer); // frame 0 always goes into the array layer
    layers.push(layer);

    if (png.width !== SIZE || png.height !== SIZE * (anim ? anim.frames : 1)) {
      resized.push(`${name} (${png.width}x${png.height})`);
    }

    if (!anim) continue;

    // Animation present: append every stacked frame to anim.bin.
    const offset = animCursor;
    for (let f = 0; f < anim.frames; f++) {
      const frame = Buffer.alloc(LAYER_BYTES);
      extractFrame(png, f, frame);
      animChunks.push(frame);
      animCursor += LAYER_BYTES;
    }
    animated[name] = {
      layer: layerIndex,
      frames: anim.frames,
      frametime: anim.frametime,
      interpolate: anim.interpolate,
      frameList: anim.frameList,
      offset,
      length: anim.frames * LAYER_BYTES,
    };
  }

  // ---- block.bin / item.bin -------------------------------------------------
  const header = Buffer.alloc(HEADER_BYTES);
  header.writeUInt32LE(MAGIC >>> 0, 0);
  header.writeUInt32LE(VERSION, 4);
  header.writeUInt32LE(layers.length, 8);
  header.writeUInt32LE(SIZE, 12);
  const bin = Buffer.concat([header, ...layers], HEADER_BYTES + layers.length * LAYER_BYTES);
  await fs.writeFile(outPath('tex', binName), bin);

  // ---- anim.bin / itemanim.bin ---------------------------------------------
  const animBuf = animChunks.length ? Buffer.concat(animChunks) : Buffer.alloc(0);
  await fs.writeFile(outPath('tex', animName), animBuf);

  // ---- block.json / item.json ----------------------------------------------
  const json = { size: SIZE, layers: layers.length, names, animated };
  await fs.writeFile(outPath('tex', jsonName), JSON.stringify(json, null, 0) + '\n');

  return {
    label,
    layerCount: layers.length,
    binBytes: bin.length,
    animBytes: animBuf.length,
    animCount: Object.keys(animated).length,
    animated,
    missing,
    resized,
    files: { binName, jsonName, animName },
  };
}

// ---------------------------------------------------------------------------
// Main
// ---------------------------------------------------------------------------

async function main() {
  const t0 = Date.now();
  if (!existsSync(SRC_TEX)) {
    throw new Error(
      `vanilla assets not found at ${SRC}\n` +
        `  set MC_ASSETS=/path/to/assets/minecraft if they live elsewhere`,
    );
  }

  await fs.mkdir(OUT, { recursive: true });
  await fs.mkdir(TEX_OUT, { recursive: true });

  // Phase timing, handy when a future change makes one of the passes slow.
  let last = Date.now();
  const phase = (name) => {
    const now = Date.now();
    console.log(`  [${name}: ${((now - last) / 1000).toFixed(2)}s]`);
    last = now;
  };

  // =========================================================================
  // 1. Mirror the raw asset tree (PNGs are used as-is by GUI / entity code)
  // =========================================================================
  console.log(`src : ${SRC}`);
  console.log(`out : ${OUT}`);

  const texStats = await mirrorTree(SRC_TEX, path.join(OUT, 'textures'));
  const fontStats = await mirrorTree(path.join(SRC, 'font'), path.join(OUT, 'font'));
  await fs.mkdir(path.join(OUT, 'lang'), { recursive: true });
  await fs.copyFile(path.join(SRC, 'lang', 'en_us.json'), path.join(OUT, 'lang', 'en_us.json'));
  await fs.copyFile(path.join(SRC, 'texts', 'splashes.txt'), path.join(OUT, 'splashes.txt'));
  console.log(`copied textures/** : ${texStats.files} files, ${fmtBytes(texStats.bytes)}`);
  console.log(`copied font/**     : ${fontStats.files} files, ${fmtBytes(fontStats.bytes)}`);
  phase('copy assets');

  // =========================================================================
  // 2./3. Block texture array — order comes from models.json
  // =========================================================================
  const modelsJsonPath = path.join(OUT, 'models.json');
  if (!existsSync(modelsJsonPath)) throw new Error(`missing ${modelsJsonPath} (run the model bake first)`);
  const models = JSON.parse(await fs.readFile(modelsJsonPath, 'utf8'));
  const blockNames = models.textures;
  if (!Array.isArray(blockNames) || blockNames.length === 0) throw new Error('models.json has no textures[]');

  const blockEntries = blockNames.map((name) => ({
    name,
    // models.json stores "block/stone"; assets store textures/block/stone.png
    file: (name.startsWith('block/') ? name.slice('block/'.length) : name) + '.png',
  }));

  const blockSet = await packSet({
    label: 'block',
    srcDir: path.join(SRC_TEX, 'block'),
    entries: blockEntries,
    binName: 'block.bin',
    jsonName: 'block.json',
    animName: 'anim.bin',
  });
  phase('block array');

  // =========================================================================
  // 4. Item texture array — every PNG directly under textures/item/
  // =========================================================================
  const itemDir = path.join(SRC_TEX, 'item');
  // Sort on the final texture name (`item/foo`), not on the file name: collation
  // ignores the ".png" extension, so the two orders differ around names that are
  // a prefix of another (`bamboo` vs `bamboo_chest_raft`).
  const itemNames = (await fs.readdir(itemDir, { withFileTypes: true }))
    .filter((e) => e.isFile() && e.name.endsWith('.png'))
    .map((e) => 'item/' + e.name.slice(0, -4))
    .sort((a, b) => a.localeCompare(b, 'en'));

  const itemSet = await packSet({
    label: 'item',
    srcDir: itemDir,
    entries: itemNames.map((name) => ({ name, file: name.slice('item/'.length) + '.png' })),
    binName: 'item.bin',
    jsonName: 'item.json',
    animName: 'itemanim.bin',
  });
  phase('item array');

  // =========================================================================
  // 5. Panorama sanity check (used by the title screen)
  // =========================================================================
  const panoDir = path.join(OUT, 'textures', 'gui', 'title', 'background');
  const panorama = [];
  for (let i = 0; i < 6; i++) {
    const p = path.join(panoDir, `panorama_${i}.png`);
    if (!existsSync(p)) {
      warn(`missing panorama_${i}.png`);
      continue;
    }
    const { w, h } = await pngDims(p);
    panorama.push({ name: `panorama_${i}.png`, w, h, bytes: (await fs.stat(p)).size });
  }
  // The 26.2 asset extraction used here ships 1x1 stubs for the panorama faces.
  // Report it loudly instead of silently producing a black title screen.
  const tinyPano = panorama.find((p) => p.w < 256 || p.h < 256);
  if (tinyPano) {
    const dims = [...new Set(panorama.map((p) => `${p.w}x${p.h}`))].join(', ');
    warn(
      `panorama faces are placeholder images (${dims}); drop real panorama_0..5.png into ` +
        `public/mc/textures/gui/title/background/ for the title screen`,
    );
  }

  // =========================================================================
  // Summary
  // =========================================================================
  const panoBytes = panorama.reduce((a, b) => a + b.bytes, 0);
  const langBytes = (await fs.stat(path.join(OUT, 'lang', 'en_us.json'))).size;
  const splashBytes = (await fs.stat(path.join(OUT, 'splashes.txt'))).size;

  console.log('');
  console.log('=== packed arrays ===');
  for (const s of [blockSet, itemSet]) {
    console.log(
      `${s.label}: ${s.layerCount} layers | ${s.files.binName} ${fmtBytes(s.binBytes)} | ` +
        `${s.files.animName} ${fmtBytes(s.animBytes)} | ${s.animCount} animated`,
    );
  }
  console.log(`lang/en_us.json    : ${fmtBytes(langBytes)}`);
  console.log(`splashes.txt       : ${fmtBytes(splashBytes)}`);
  console.log(`panorama           : ${panorama.length}/6 files, ${fmtBytes(panoBytes)}`);
  for (const p of panorama) console.log(`  ${p.name} ${p.w}x${p.h} ${fmtBytes(p.bytes)}`);

  console.log('');
  console.log('=== animated textures ===');
  for (const set of [blockSet, itemSet]) {
    const list = Object.entries(set.animated).map(
      ([n, a]) =>
        `${n} ${a.frames}f/t=${a.frametime}${a.interpolate ? '/interp' : ''}` +
        `${a.frameList ? `/[${a.frameList.length} steps]` : ''} -> layer ${a.layer}`,
    );
    console.log(`${set.label}: ${list.length ? '' : 'none'}`);
    for (const l of list) console.log('  ' + l);
  }

  const missing = [...blockSet.missing, ...itemSet.missing];
  const resized = [...blockSet.resized, ...itemSet.resized];
  console.log('');
  console.log('=== notes ===');
  console.log(`missing textures / placeholders: ${missing.length}`);
  for (const m of missing) console.log('  ' + m);
  console.log(`resampled to 16x16: ${resized.length}`);
  for (const r of resized) console.log('  ' + r);
  console.log(`warnings: ${warnings.length}`);
  for (const w of warnings) console.log('  ' + w);

  console.log('');
  console.log(`done in ${((Date.now() - t0) / 1000).toFixed(2)}s`);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
