// Builds runtime assets from the user's own official Minecraft 26.2 client jar.
// The generated public/mc tree is gitignored and must never be redistributed.
import fs from 'node:fs/promises';
import path from 'node:path';
import { existsSync } from 'node:fs';
import { PNG } from 'pngjs';

const SRC = process.env.MC_ASSETS;
if (!SRC) {
  console.error('Set MC_ASSETS to the assets/minecraft directory extracted from your own Minecraft 26.2 client.jar.');
  process.exit(1);
}
const OUT = path.resolve('public/mc');

/** Default launcher asset root: %APPDATA%/.minecraft/assets on Windows, ~/.minecraft/assets elsewhere. */
function defaultExternalAssets() {
  const base = process.platform === 'win32' && process.env.APPDATA
    ? process.env.APPDATA
    : (process.env.HOME || process.env.USERPROFILE || '');
  return path.join(base, '.minecraft', 'assets');
}

const DIRS = ['down', 'up', 'north', 'south', 'west', 'east'];
const DIR_INDEX = Object.fromEntries(DIRS.map((d, i) => [d, i]));

const PALETTE = [
  { name: 'stone' },
  { name: 'dirt' },
  { name: 'coarse_dirt' },
  { name: 'rooted_dirt' },
  { name: 'grass_block', state: 'snowy=false', tint: 'grass' },
  { name: 'podzol', state: 'snowy=false' },
  { name: 'sand' },
  { name: 'red_sand' },
  { name: 'gravel' },
  { name: 'clay' },
  { name: 'cobblestone' },
  { name: 'mossy_cobblestone' },
  { name: 'stone_bricks' },
  { name: 'mossy_stone_bricks' },
  { name: 'cracked_stone_bricks' },
  { name: 'bricks' },
  { name: 'deepslate' },
  { name: 'cobbled_deepslate' },
  { name: 'polished_deepslate' },
  { name: 'granite' },
  { name: 'diorite' },
  { name: 'andesite' },
  { name: 'tuff' },
  { name: 'calcite' },
  { name: 'dripstone_block' },
  { name: 'smooth_stone' },
  { name: 'sandstone' },
  { name: 'red_sandstone' },
  { name: 'bedrock' },
  { name: 'obsidian' },
  { name: 'snow_block' },
  { name: 'snow', state: 'layers=1', flags: { opaque: false, solid: true, lightOpacity: 1 } },
  { name: 'ice', flags: { opaque: false, solid: true, render: 'translucent', lightOpacity: 1 } },
  { name: 'glass', flags: { opaque: false, solid: true, render: 'translucent', lightOpacity: 0, cullSelf: false } },
  { name: 'oak_log', state: 'axis=y' },
  { name: 'oak_planks' },
  { name: 'oak_leaves', flags: { opaque: false, solid: true, render: 'cutout', lightOpacity: 1, cullSelf: false, tint: 'foliage' } },
  { name: 'oak_stairs', state: 'facing=east,half=bottom,shape=straight', flags: { opaque: false, solid: true, lightOpacity: 1 } },
  { name: 'oak_slab', state: 'type=bottom', flags: { opaque: false, solid: true, lightOpacity: 1 } },
  { name: 'birch_log', state: 'axis=y' },
  { name: 'birch_planks' },
  { name: 'birch_leaves', flags: { opaque: false, solid: true, render: 'cutout', lightOpacity: 1, cullSelf: false, tint: 'fixed', tintColor: '#80a755' } },
  { name: 'birch_stairs', state: 'facing=east,half=bottom,shape=straight', flags: { opaque: false, solid: true, lightOpacity: 1 } },
  { name: 'birch_slab', state: 'type=bottom', flags: { opaque: false, solid: true, lightOpacity: 1 } },
  { name: 'spruce_log', state: 'axis=y' },
  { name: 'spruce_planks' },
  { name: 'spruce_leaves', flags: { opaque: false, solid: true, render: 'cutout', lightOpacity: 1, cullSelf: false, tint: 'fixed', tintColor: '#619961' } },
  { name: 'spruce_stairs', state: 'facing=east,half=bottom,shape=straight', flags: { opaque: false, solid: true, lightOpacity: 1 } },
  { name: 'spruce_slab', state: 'type=bottom', flags: { opaque: false, solid: true, lightOpacity: 1 } },
  { name: 'moss_block' },
  { name: 'short_grass', flags: { opaque: false, solid: false, render: 'cutout', lightOpacity: 0, noAO: true, tint: 'grass', sound: 'grass' } },
  { name: 'fern', flags: { opaque: false, solid: false, render: 'cutout', lightOpacity: 0, noAO: true, tint: 'grass', sound: 'grass' } },
  { name: 'dead_bush', flags: { opaque: false, solid: false, render: 'cutout', lightOpacity: 0, noAO: true, sound: 'grass' } },
  { name: 'poppy', flags: { opaque: false, solid: false, render: 'cutout', lightOpacity: 0, noAO: true, sound: 'grass' } },
  { name: 'dandelion', flags: { opaque: false, solid: false, render: 'cutout', lightOpacity: 0, noAO: true, sound: 'grass' } },
  { name: 'cornflower', flags: { opaque: false, solid: false, render: 'cutout', lightOpacity: 0, noAO: true, sound: 'grass' } },
  { name: 'azure_bluet', flags: { opaque: false, solid: false, render: 'cutout', lightOpacity: 0, noAO: true, sound: 'grass' } },
  { name: 'oxeye_daisy', flags: { opaque: false, solid: false, render: 'cutout', lightOpacity: 0, noAO: true, sound: 'grass' } },
  { name: 'allium', flags: { opaque: false, solid: false, render: 'cutout', lightOpacity: 0, noAO: true, sound: 'grass' } },
  { name: 'lily_of_the_valley', flags: { opaque: false, solid: false, render: 'cutout', lightOpacity: 0, noAO: true, sound: 'grass' } },
  { name: 'torch', flags: { opaque: false, solid: false, render: 'cutout', lightOpacity: 0, noAO: true, light: 14, sound: 'wood' } },
  { name: 'lantern', state: 'hanging=false', flags: { opaque: false, solid: true, render: 'cutout', lightOpacity: 1, light: 15, sound: 'lantern' } },
  { name: 'glowstone', flags: { light: 15, sound: 'glass' } },
  { name: 'sea_lantern', flags: { light: 15, sound: 'glass' } },
  { name: 'crafting_table' },
  { name: 'bookshelf', flags: { sound: 'wood' } },
  { name: 'cactus', flags: { opaque: false, solid: true, render: 'cutout', lightOpacity: 1, sound: 'wool' } },
  { name: 'coal_ore', flags: { hardness: 3 } },
  { name: 'iron_ore', flags: { hardness: 3 } },
  { name: 'copper_ore', flags: { hardness: 3 } },
  { name: 'gold_ore', flags: { hardness: 3 } },
  { name: 'diamond_ore', flags: { hardness: 3 } },
  { name: 'emerald_ore', flags: { hardness: 3 } },
  // 26.2 Chaos Cubed: sulfur + cinnabar families
  { name: 'sulfur' },
  { name: 'sulfur_bricks' },
  { name: 'polished_sulfur' },
  { name: 'chiseled_sulfur' },
  { name: 'potent_sulfur' },
  { name: 'cinnabar' },
  { name: 'cinnabar_bricks' },
  { name: 'polished_cinnabar' },
  { name: 'chiseled_cinnabar' },
  { name: 'sulfur_spike', state: 'thickness=base,vertical_direction=up', flags: { opaque: false, solid: true, render: 'cutout', lightOpacity: 0 } },
  // Fluids are rendered with dedicated geometry
  { name: 'water', custom: 'water', state: 'level=0', flags: { opaque: false, solid: false, render: 'translucent', lightOpacity: 1, tint: 'water', sound: 'water', liquid: true } },
  { name: 'lava', custom: 'lava', state: 'level=0', flags: { opaque: false, solid: false, render: 'opaque', lightOpacity: 1, light: 15, sound: 'lava', liquid: true, emissive: true } },
];

const blockMetaDefaults = {
  opaque: true,
  solid: true,
  render: 'opaque',
  lightOpacity: 15,
  light: 0,
  tint: 'none',
  tintColor: null,
  noAO: false,
  cullSelf: true,
  liquid: false,
  emissive: false,
  hardness: 1.5,
  sound: 'stone',
};


function defaultSound(name) {
  if (name === 'grass_block' || name === 'moss_block' || name.includes('leaves') || name === 'short_grass' || name === 'fern' ||
    name === 'dead_bush' || /^(poppy|dandelion|cornflower|azure_bluet|oxeye_daisy|allium|lily_of_the_valley)$/.test(name)) return 'grass';
  if (name.includes('log') || name.includes('planks') || name.includes('stairs') || name.includes('slab') ||
    name === 'bookshelf' || name === 'crafting_table' || name === 'torch') return 'wood';
  if (name === 'sand' || name === 'red_sand' || name === 'sandstone' || name === 'red_sandstone') return 'sand';
  if (name === 'dirt' || name === 'coarse_dirt' || name === 'rooted_dirt' || name === 'podzol' || name === 'gravel' || name === 'clay') return 'gravel';
  if (name === 'snow' || name === 'snow_block') return 'snow';
  if (name === 'glass' || name === 'ice' || name === 'glowstone' || name === 'sea_lantern') return 'glass';
  if (name === 'cactus' || name === 'wool') return 'wool';
  if (name === 'lantern') return 'lantern';
  if (name === 'water') return 'water';
  if (name === 'lava') return 'lava';
  return 'stone';
}

const DEFAULT_STATE = {
  grass_block: 'snowy=false', podzol: 'snowy=false', oak_log: 'axis=y', birch_log: 'axis=y', spruce_log: 'axis=y',
  snow: 'layers=1', oak_stairs: 'facing=east,half=bottom,shape=straight', birch_stairs: 'facing=east,half=bottom,shape=straight',
  spruce_stairs: 'facing=east,half=bottom,shape=straight', oak_slab: 'type=bottom', birch_slab: 'type=bottom', spruce_slab: 'type=bottom',
  lantern: 'hanging=false', sulfur_spike: 'thickness=base,vertical_direction=up', water: 'level=0', lava: 'level=0',
};

function normModelName(name) {
  return name.replace(/^minecraft:/, '').replace(/^models\//, '');
}
function normTextureName(name) {
  return name.replace(/^minecraft:/, '').replace(/^textures\//, '');
}

const modelCache = new Map();
async function loadModel(name) {
  name = normModelName(name);
  if (modelCache.has(name)) return modelCache.get(name);
  const p = path.join(SRC, 'models', name + '.json');
  if (!existsSync(p)) throw new Error('missing model ' + name);
  const raw = JSON.parse(await fs.readFile(p, 'utf8'));
  const base = raw.parent ? await loadModel(raw.parent) : { textures: {}, elements: [], ao: true, guiLight: 'side' };
  const merged = {
    textures: { ...base.textures, ...(raw.textures || {}) },
    elements: raw.elements ?? base.elements,
    ao: raw.ambientocclusion ?? base.ao,
    guiLight: raw.gui_light ?? base.guiLight,
    display: raw.display ?? base.display,
  };
  modelCache.set(name, merged);
  return merged;
}

function resolveTexture(ref, textures, depth = 0) {
  if (depth > 16) throw new Error('texture reference loop: ' + JSON.stringify(ref));
  if (ref && typeof ref === 'object') {
    if (typeof ref.sprite !== 'string') throw new Error('bad sprite reference: ' + JSON.stringify(ref));
    const inner = resolveTexture(ref.sprite, textures, depth + 1);
    return { key: inner.key, tr: inner.tr || ref.force_translucent === true };
  }
  if (typeof ref !== 'string') throw new Error('bad texture reference: ' + JSON.stringify(ref));
  if (ref.startsWith('#')) {
    const key = ref.slice(1);
    if (!(key in textures)) throw new Error('unknown texture variable ' + ref);
    return resolveTexture(textures[key], textures, depth + 1);
  }
  return { key: normTextureName(ref), tr: false };
}

function rotatePoint(p, axis, degrees, origin) {
  if (!degrees) return p;
  const a = (degrees * Math.PI) / 180;
  const c = Math.cos(a), s = Math.sin(a);
  let [x, y, z] = p;
  const [ox, oy, oz] = origin;
  x -= ox; y -= oy; z -= oz;
  if (axis === 'x') { const ny = y * c - z * s; const nz = y * s + z * c; y = ny; z = nz; }
  else if (axis === 'y') { const nx = x * c + z * s; const nz = -x * s + z * c; x = nx; z = nz; }
  else { const nx = x * c - y * s; const ny = x * s + y * c; x = nx; y = ny; }
  return [x + ox, y + oy, z + oz];
}

function autoUV(dir, from, to) {
  const [x1, y1, z1] = from, [x2, y2, z2] = to;
  switch (dir) {
    case 'down': return [x1, 16 - z2, x2, 16 - z1];
    case 'up': return [x1, z1, x2, z2];
    case 'north': return [16 - x2, 16 - y2, 16 - x1, 16 - y1];
    case 'south': return [x1, 16 - y2, x2, 16 - y1];
    case 'west': return [z1, 16 - y2, z2, 16 - y1];
    case 'east': return [16 - z2, 16 - y2, 16 - z1, 16 - y1];
  }
  return [0, 0, 16, 16];
}

// World-space corners, ordered top-left, bottom-left, bottom-right, top-right
// as seen from outside the face. Returns corners plus UV corner flags.
function faceCorners(dir, from, to) {
  const [x1, y1, z1] = from, [x2, y2, z2] = to;
  switch (dir) {
    case 'south': return [[x1, y2, z2], [x1, y1, z2], [x2, y1, z2], [x2, y2, z2]];
    case 'north': return [[x2, y2, z1], [x2, y1, z1], [x1, y1, z1], [x1, y2, z1]];
    case 'east': return [[x2, y2, z2], [x2, y1, z2], [x2, y1, z1], [x2, y2, z1]];
    case 'west': return [[x1, y2, z1], [x1, y1, z1], [x1, y1, z2], [x1, y2, z2]];
    case 'up': return [[x1, y2, z1], [x1, y2, z2], [x2, y2, z2], [x2, y2, z1]];
    case 'down': return [[x1, y1, z2], [x1, y1, z1], [x2, y1, z1], [x2, y1, z2]];
  }
  throw new Error('bad dir ' + dir);
}

function rotateUv([u1, v1, u2, v2], rot) {
  rot = ((rot % 360) + 360) % 360;
  if (rot === 90) return [u2, v1, u2, v2, u1, v2, u1, v1];
  if (rot === 180) return [u2, v2, u1, v2, u1, v1, u2, v1];
  if (rot === 270) return [u1, v2, u1, v1, u2, v1, u2, v2];
  return [u1, v1, u1, v2, u2, v2, u2, v1];
}

function bakeModel(model, variantRot) {
  const quads = [];
  for (const el of model.elements) {
    const from = el.from.map(Number);
    const to = el.to.map(Number);
    const elRot = el.rotation;
    for (const dir of DIRS) {
      const face = el.faces?.[dir];
      if (!face || !face.texture) continue;
      let corners = faceCorners(dir, from, to);
      if (elRot) {
        corners = corners.map(c => rotatePoint(c, elRot.axis, Number(elRot.angle) || 0, elRot.origin || [8, 8, 8]));
      }
      if (variantRot) {
        corners = corners.map(c => {
          let p = rotatePoint(c, 'y', variantRot.y || 0, [8, 8, 8]);
          p = rotatePoint(p, 'x', variantRot.x || 0, [8, 8, 8]);
          return p;
        });
      }
      const uv = Array.isArray(face.uv) ? face.uv.map(Number) : autoUV(dir, from, to);
      const uvOrdered = rotateUv(uv, Number(face.rotation) || 0);
      const tex = resolveTexture(face.texture, model.textures);
      quads.push({
        p: corners.flat().map(v => Math.round((v / 16) * 10000) / 10000),
        uv: uvOrdered,
        t: tex.key,
        tr: tex.tr || undefined,
        d: DIR_INDEX[dir],
        c: face.cullface ? DIR_INDEX[face.cullface] : -1,
        ti: face.tintindex ?? -1,
        s: face.shade !== false && el.shade !== false,
        ao: model.ao !== false,
      });
    }
  }
  return quads;
}

async function resolveBlockState(entry) {
  const bsPath = path.join(SRC, 'blockstates', entry.name + '.json');
  const bs = JSON.parse(await fs.readFile(bsPath, 'utf8'));
  if (!bs.variants) throw new Error(`${entry.name}: multipart blockstates are not supported yet`);
  const wanted = entry.state ?? DEFAULT_STATE[entry.name];
  let key = wanted;
  if (key == null || !(key in bs.variants)) key = Object.keys(bs.variants)[0];
  if (!(key in bs.variants)) throw new Error(`${entry.name}: no variants`);
  let variant = bs.variants[key];
  if (Array.isArray(variant)) variant = variant[0];
  if (!variant || !variant.model) throw new Error(`${entry.name}: bad variant ${key}`);
  const model = await loadModel(variant.model);
  const variantRot = (variant.x || variant.y) ? { x: Number(variant.x) || 0, y: Number(variant.y) || 0 } : null;
  return { key, quads: bakeModel(model, variantRot), guiLight: model.guiLight };
}

async function pngSize(file) {
  const fd = await fs.open(file, 'r');
  const buf = Buffer.alloc(24);
  await fd.read(buf, 0, 24, 0);
  await fd.close();
  if (buf.readUInt32BE(0) !== 0x89504e47) throw new Error('not a png: ' + file);
  return { w: buf.readUInt32BE(16), h: buf.readUInt32BE(20) };
}

async function readAnim(file) {
  const metaPath = file + '.mcmeta';
  if (!existsSync(metaPath)) return null;
  const meta = JSON.parse(await fs.readFile(metaPath, 'utf8'));
  if (!meta.animation) return null;
  const a = meta.animation;
  const size = await pngSize(file);
  const frames = Math.max(1, Math.floor(size.h / size.w));
  return {
    frametime: a.frametime ?? 1,
    frames,
    frameList: a.frames ?? null,
    interpolate: !!a.interpolate,
    width: size.w,
  };
}


const SOUND_EVENTS = [
  'block.stone.step', 'block.stone.break', 'block.stone.place',
  'block.grass.step', 'block.grass.break', 'block.grass.place',
  'block.wood.step', 'block.wood.break', 'block.wood.place',
  'block.sand.step', 'block.sand.break', 'block.sand.place',
  'block.gravel.step', 'block.gravel.break', 'block.gravel.place',
  'block.glass.step', 'block.glass.break', 'block.glass.place',
  'block.snow.step', 'block.snow.break', 'block.snow.place',
  'block.wool.step', 'block.wool.break', 'block.wool.place',
  'ui.button.click', 'block.water.ambient', 'ambient.underwater.enter', 'ambient.underwater.exit',
];

async function buildSounds() {
  const ext = process.env.MC_EXTERNAL || defaultExternalAssets();
  const idxPath = path.join(ext, 'indexes', '32.json');
  if (!existsSync(idxPath)) { console.warn('sound index not found:', idxPath); return { events: {} }; }
  const index = JSON.parse(await fs.readFile(idxPath, 'utf8')).objects;
  const soundsObj = index['minecraft/sounds.json'];
  if (!soundsObj) return { events: {} };
  const soundsJsonPath = path.join(ext, 'objects', soundsObj.hash.slice(0, 2), soundsObj.hash);
  const soundsData = JSON.parse(await fs.readFile(soundsJsonPath, 'utf8'));
  const events = {};
  let copied = 0;
  for (const event of SOUND_EVENTS) {
    const entry = soundsData[event];
    if (!entry) continue;
    const list = Array.isArray(entry.sounds) ? entry.sounds : [entry.sounds];
    const recs = [];
    for (const raw of list) {
      const name = typeof raw === 'string' ? raw : raw?.name;
      if (!name) continue;
      const objectKey = 'minecraft/sounds/' + (name.endsWith('.ogg') ? name : name + '.ogg');
      const obj = index[objectKey];
      if (!obj) continue;
      const src = path.join(ext, 'objects', obj.hash.slice(0, 2), obj.hash);
      if (!existsSync(src)) continue;
      const base = path.basename(objectKey);
      const destRel = path.posix.join('sounds', event, base);
      await fs.mkdir(path.dirname(path.join(OUT, destRel)), { recursive: true });
      await fs.copyFile(src, path.join(OUT, destRel));
      copied++;
      const rec = { path: '/mc/' + destRel, volume: 1, pitch: 1, weight: 1 };
      if (raw && typeof raw === 'object') {
        if (raw.volume != null) rec.volume = Number(raw.volume);
        if (raw.pitch != null) rec.pitch = Number(raw.pitch);
        if (raw.weight != null) rec.weight = Number(raw.weight);
      }
      if (entry.volume != null) rec.volume *= Number(entry.volume);
      if (entry.pitch != null) rec.pitch *= Number(entry.pitch);
      recs.push(rec);
    }
    if (recs.length) events[event] = recs;
  }
  console.log('sounds:', Object.keys(events).length, 'events,', copied, 'files');
  return { events };
}

async function copyTree(src, dst) {
  if (!existsSync(src)) { console.warn('skip missing', src); return; }
  await fs.cp(src, dst, { recursive: true });
}

// The extracted vanilla asset tree ships 1x1 placeholders for the title panorama.
// A real 26.2 client stores the six 1024x1024 faces in the assets object store;
// copy those official faces (never from the network) when they are available.
async function copyMenuAssets() {
  const ext = process.env.MC_EXTERNAL || defaultExternalAssets();
  const idxDir = path.join(ext, 'indexes');
  const objDir = path.join(ext, 'objects');
  const faces = [];
  if (existsSync(idxDir) && existsSync(objDir)) {
    let index = null;
    let indexName = null;
    for (const file of (await fs.readdir(idxDir)).filter(f => f.endsWith('.json')).sort().reverse()) {
      try {
        const data = JSON.parse(await fs.readFile(path.join(idxDir, file), 'utf8'));
        if (data?.objects?.['minecraft/textures/gui/title/background/panorama_0.png']) {
          index = data;
          indexName = file;
          break;
        }
      } catch { /* ignore broken indexes */ }
    }
    if (index) {
      for (let i = 0; i < 6; i++) {
        const rel = `minecraft/textures/gui/title/background/panorama_${i}.png`;
        const rec = index.objects[rel];
        if (!rec) break;
        const src = path.join(objDir, rec.hash.slice(0, 2), rec.hash);
        if (!existsSync(src)) break;
        const size = await pngSize(src);
        if (size.w < 16 || size.h < 16) break;
        const outRel = path.posix.join('gui/title/background', `panorama_${i}.png`);
        await fs.mkdir(path.dirname(path.join(OUT, outRel)), { recursive: true });
        await fs.copyFile(src, path.join(OUT, outRel));
        faces.push(`${size.w}x${size.h}`);
      }
      if (faces.length === 6) console.log('menu panorama: 6 official faces from assets index', indexName, faces.join(', '));
      else console.warn('menu panorama: only found', faces.length, 'usable faces in assets index');
    } else {
      console.warn('menu panorama: assets index with panorama not found');
    }
  } else {
    console.warn('menu panorama: official assets store not found at', ext);
  }

  // Official splash lines for the main menu.
  const splashSrc = path.join(SRC, 'texts/splashes.txt');
  if (existsSync(splashSrc)) {
    await fs.mkdir(path.join(OUT, 'texts'), { recursive: true });
    await fs.copyFile(splashSrc, path.join(OUT, 'texts/splashes.txt'));
  } else {
    console.warn('menu splashes: missing', splashSrc);
  }
}

async function main() {
  if (!existsSync(SRC)) throw new Error('MC assets not found: ' + SRC);
  await fs.rm(OUT, { recursive: true, force: true });
  await fs.mkdir(OUT, { recursive: true });

  const blocks = [];
  const textureRefs = new Map(); // key -> {src}
  let id = 1;
  for (const entry of PALETTE) {
    const flags = { ...blockMetaDefaults, ...(entry.flags || {}) };
    if (!(entry.flags && entry.flags.sound)) flags.sound = defaultSound(entry.name);
    if (entry.tint) flags.tint = entry.tint;
    if (entry.tintColor) flags.tintColor = entry.tintColor;
    let stateKey = entry.state ?? DEFAULT_STATE[entry.name] ?? '';
    let quads = [];
    let guiLight = 'side';
    if (!entry.custom) {
      const resolved = await resolveBlockState(entry).catch(err => { throw new Error(`${entry.name}: ${err.message}`); });
      stateKey = resolved.key;
      quads = resolved.quads;
      guiLight = resolved.guiLight;
      for (const q of quads) textureRefs.set(q.t, { src: path.join(SRC, 'textures', q.t + '.png') });
      if (quads.some(q => q.tr)) flags.render = 'translucent';
      if (!quads.length) throw new Error('no geometry: ' + entry.name);
    } else if (entry.custom === 'water' || entry.custom === 'lava') {
      textureRefs.set(`block/${entry.name}_still`, { src: path.join(SRC, 'textures', `block/${entry.name}_still.png`) });
    }
    blocks.push({
      id: id++,
      name: entry.name,
      state: stateKey,
      guiLight,
      custom: entry.custom || null,
      flags,
      quads,
    });
  }

  // Extra textures the renderer needs directly.
  for (let i = 0; i < 10; i++) textureRefs.set(`block/destroy_stage_${i}`, { src: path.join(SRC, `textures/block/destroy_stage_${i}.png`) });

  const textures = {};
  const animTextures = [];
  let layerCount = 0;
  for (const [key, info] of [...textureRefs.entries()].sort(([a], [b]) => a.localeCompare(b))) {
    if (!existsSync(info.src)) throw new Error('missing texture ' + key + ' -> ' + info.src);
    const size = await pngSize(info.src);
    const anim = await readAnim(info.src);
    const frames = anim ? Math.max(1, Math.floor(size.h / size.w)) : 1;
    const outRel = path.posix.join('textures', key + '.png');
    await fs.mkdir(path.dirname(path.join(OUT, outRel)), { recursive: true });
    await fs.copyFile(info.src, path.join(OUT, outRel));
    const metaSrc = info.src + '.mcmeta';
    if (existsSync(metaSrc)) await fs.copyFile(metaSrc, path.join(OUT, outRel + '.mcmeta'));
    const arrayable = size.w === 16 && size.h === 16 * frames;
    const framePaths = [];
    if (arrayable && anim && frames > 1) {
      const full = PNG.sync.read(await fs.readFile(info.src));
      for (let f = 0; f < frames; f++) {
        const frame = new PNG({ width: 16, height: 16 });
        for (let y = 0; y < 16; y++) {
          const srcStart = ((f * 16 + y) * full.width) * 4;
          const dstStart = (y * 16) * 4;
          full.data.copy(frame.data, dstStart, srcStart, srcStart + 16 * 4);
        }
        const frameRel = path.posix.join('textures', `${key}.${f}.png`);
        await fs.writeFile(path.join(OUT, frameRel), PNG.sync.write(frame));
        framePaths.push('/' + path.posix.join(path.basename(OUT), frameRel));
      }
    } else {
      framePaths.push('/' + path.posix.join(path.basename(OUT), outRel));
    }
    const rec = {
      key,
      path: '/' + path.posix.join(path.basename(OUT), outRel),
      framePaths,
      w: size.w, h: size.h,
      animated: !!anim,
      animation: anim,
      frames,
      animId: -1,
      arrayLayer: arrayable ? layerCount : -1,
    };
    if (arrayable) {
      if (anim) {
        rec.animId = animTextures.length;
        animTextures.push({ id: rec.animId, key, layer: layerCount, frames, frametime: anim.frametime, frameList: anim.frameList, interpolate: anim.interpolate });
      }
      layerCount += frames;
    }
    textures[key] = rec;
  }

  // Environment, GUI, font, misc, colormap, particles.
  await copyTree(path.join(SRC, 'textures/gui'), path.join(OUT, 'gui'));
  await copyTree(path.join(SRC, 'textures/environment'), path.join(OUT, 'environment'));
  await copyTree(path.join(SRC, 'textures/misc'), path.join(OUT, 'misc'));
  await copyTree(path.join(SRC, 'textures/colormap'), path.join(OUT, 'colormap'));
  await copyTree(path.join(SRC, 'textures/particle'), path.join(OUT, 'particle'));
  await copyTree(path.join(SRC, 'textures/font'), path.join(OUT, 'font/textures'));
  await copyTree(path.join(SRC, 'font'), path.join(OUT, 'font/meta'));
  await copyMenuAssets();

  const audio = await buildSounds();

  const manifest = {
    generatedAt: new Date().toISOString(),
    audio,
    version: '26.2',
    textures,
    layerCount,
    animTextures,
    blocks,
    gui: {
      hotbar: '/mc/gui/sprites/hud/hotbar.png',
      hotbarSelection: '/mc/gui/sprites/hud/hotbar_selection.png',
      crosshair: '/mc/gui/sprites/hud/crosshair.png',
      hotbarOffhandLeft: '/mc/gui/sprites/hud/hotbar_offhand_left.png',
      hotbarOffhandRight: '/mc/gui/sprites/hud/hotbar_offhand_right.png',
      experienceBar: '/mc/gui/sprites/hud/experience_bar_background.png',
      experienceProgress: '/mc/gui/sprites/hud/experience_bar_progress.png',
    },
    environment: {
      sun: '/mc/environment/celestial/sun.png',
      moon: '/mc/environment/celestial/moon',
      clouds: '/mc/environment/clouds.png',
      rain: '/mc/environment/rain.png',
      snow: '/mc/environment/snow.png',
      underwater: '/mc/misc/underwater.png',
      vignette: '/mc/misc/vignette.png',
    },
    colormap: {
      grass: '/mc/colormap/grass.png',
      foliage: '/mc/colormap/foliage.png',
    },
    font: {
      defaultJson: '/mc/font/meta/default.json',
      ascii: '/mc/font/textures/ascii.png',
      accented: '/mc/font/textures/accented.png',
      nonlatin: '/mc/font/textures/nonlatin_european.png',
    },
  };
  await fs.writeFile(path.join(OUT, 'manifest.json'), JSON.stringify(manifest));
  const animated = animTextures.map(t => `${t.key}(${t.frames}f/${t.frametime}t)`);
  console.log(`blocks=${blocks.length} textures=${Object.keys(textures).length} arrayLayers=${layerCount}`);
  console.log('animated:', animated.join(', ') || 'none');
  const bad = Object.values(textures).filter(t => t.arrayLayer < 0);
  console.log('non-arrayable:', bad.map(t => `${t.key} ${t.w}x${t.h}`).join(', ') || 'none');
}

main().catch(err => { console.error(err); process.exit(1); });
