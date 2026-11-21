// Node test for src/client/renderer/BiomeColors.ts against the real vanilla algorithm.
//
//   npx tsx scripts/test-biomecolors.mts
//
// Everything here is compared against an INDEPENDENT transcription of the Java sources in
// src-vanilla/net/minecraft (written out below instead of being imported from the
// implementation), reading the same colormap PNGs the client ships
// (public/mc/textures/colormap/*.png, byte-identical to vanilla/assets/minecraft/textures).
//
// Sources of truth:
//   world/level/ColorMapColorUtil.java:4-10   `rain *= temp; x=(int)((1-temp)*255); y=(int)((1-rain)*255); index=y<<8|x`
//   world/level/biome/Biome.java:207-231      grass/foliage colour + clamp to Java float [0,1]
//   world/level/FoliageColor.java:4-7         FOLIAGE_EVERGREEN / FOLIAGE_BIRCH / FOLIAGE_DEFAULT / FOLIAGE_MANGROVE
//   world/level/biome/BiomeSpecialEffects.java:74-112  grass_color_modifier (dark_forest / swamp)
//   client/Options.java:469-475               biomeBlendRadius default 2 -> 5x5
//   client/multiplayer/ClientLevel.java:1013  calculateBlockTint (integer per-channel average)
//   client/color/block/BlockColors.java        per-block tint table

import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { PNG } from 'pngjs';

import { BiomeColors, colormapCoords } from '../src/client/renderer/BiomeColors.ts';
import { LegacyRandomSource } from '../src/vanilla/core/Random.ts';
import { SimplexNoise } from '../src/vanilla/world/level/levelgen/synth/SimplexNoise.ts';

const here = path.dirname(fileURLToPath(import.meta.url));
const root = path.resolve(here, '..');

interface BiomeJson {
  id: number;
  name: string;
  temperature: number;
  downfall: number;
  effects?: Record<string, string | number>;
}

const worldgen = JSON.parse(fs.readFileSync(path.join(root, 'public/mc/worldgen.json'), 'utf8'));
const biomes: BiomeJson[] = Object.values(worldgen.biomes as Record<string, BiomeJson>);
// The pack ships `biomes` as an OBJECT keyed by name, whose iteration order is alphabetical by
// key - NOT by registry id. The previous code indexed that array with the biome id, so every
// biome got another biome's colour (sparse_jungle id 45 landed on snowy_beach). Keep both views
// here so the "old bug" numbers below are reproducible.
const biomesByArrayIndex = biomes;
const biomeById = new Map<number, BiomeJson>(biomes.map((b) => [b.id, b]));

const grassPng = PNG.sync.read(fs.readFileSync(path.join(root, 'public/mc/textures/colormap/grass.png')));
const foliagePng = PNG.sync.read(fs.readFileSync(path.join(root, 'public/mc/textures/colormap/foliage.png')));
const dryFoliagePng = PNG.sync.read(fs.readFileSync(path.join(root, 'public/mc/textures/colormap/dry_foliage.png')));

const asRgba = (img: { data: Buffer }): Uint8Array => new Uint8Array(img.data);

// ------------------------------------------------------------------ Java reference
// Everything in this block is a direct transcription of the Java source, kept independent of
// the implementation under test (so a mistake in the implementation cannot hide here).

function javaClamp01(value: number): number {
  // Java: `double temp = Mth.clamp(this.climateSettings.temperature, 0.0F, 1.0F);`
  // climateSettings.temperature is a FLOAT, so widen the float value to double afterwards.
  const f = Math.fround(value);
  return f < 0 ? 0 : f > 1 ? 1 : f;
}

/** ColorMapColorUtil.get, returning ARGB (0xFFRRGGBB). */
function javaColormapColor(img: { data: Buffer }, temperature: number, downfall: number, fallback: number): number {
  const temp = javaClamp01(temperature);
  const rain = javaClamp01(downfall);
  const adjustedRain = rain * temp; // `rain *= temp;`
  const x = Math.trunc((1.0 - temp) * 255.0); // (int) cast truncates toward zero
  const y = Math.trunc((1.0 - adjustedRain) * 255.0);
  const index = (y << 8) | x;
  if (index >= 65536 || index * 4 + 3 >= img.data.length) return fallback;
  const o = index * 4;
  return ((0xff << 24) | (img.data[o] << 16) | (img.data[o + 1] << 8) | img.data[o + 2]) >>> 0;
}

/** ExtraCodecs.STRING_RGB_COLOR: the pack stores "#rrggbb". */
function javaParseColor(value: string | number | undefined): number | null {
  if (value === undefined || value === null) return null;
  if (typeof value === 'number') return (0xff000000 | (value & 0xffffff)) >>> 0;
  const m = /^#([0-9a-fA-F]{6})$/.exec(String(value).trim());
  return m ? (0xff000000 | parseInt(m[1], 16)) >>> 0 : null;
}

const GRASS_MISSING = 0xffff00ff; // ColorMapColorUtil fallback -65281
const FOLIAGE_MISSING = 0xff48b518; // FoliageColor.FOLIAGE_DEFAULT -12012264
const DRY_FOLIAGE_MISSING = 0xff5c3c32; // DryFoliageColor default -10732494

function javaBaseGrass(biome: BiomeJson): number {
  const override = javaParseColor(biome.effects?.grass_color);
  if (override !== null) return override;
  return javaColormapColor(grassPng, biome.temperature, biome.downfall, GRASS_MISSING);
}
function javaBaseFoliage(biome: BiomeJson): number {
  const override = javaParseColor(biome.effects?.foliage_color);
  if (override !== null) return override;
  return javaColormapColor(foliagePng, biome.temperature, biome.downfall, FOLIAGE_MISSING);
}
function javaBaseDryFoliage(biome: BiomeJson): number {
  const override = javaParseColor(biome.effects?.dry_foliage_color);
  if (override !== null) return override;
  return javaColormapColor(dryFoliagePng, biome.temperature, biome.downfall, DRY_FOLIAGE_MISSING);
}
function javaWater(biome: BiomeJson): number {
  return javaParseColor(biome.effects?.water_color) ?? 0xff3f76e4;
}

function red(c: number): number { return (c >>> 16) & 0xff; }
function green(c: number): number { return (c >>> 8) & 0xff; }
function blue(c: number): number { return c & 0xff; }
function hex(c: number): string { return '#' + (c >>> 0 & 0xffffff).toString(16).padStart(6, '0').toUpperCase(); }
/** Drop the alpha byte: the ARGB ints carry 0xFF alpha, the literal expectations are 0xRRGGBB. */
function rgb24(c: number): number { return c & 0xffffff; }

/** ClientLevel.calculateBlockTint. */
function javaBlend(
  resolver: (x: number, z: number) => number,
  x: number,
  z: number,
  dist: number,
): number {
  if (dist === 0) return resolver(x, z);
  const count = (dist * 2 + 1) * (dist * 2 + 1);
  let totalRed = 0;
  let totalGreen = 0;
  let totalBlue = 0;
  for (let dz = -dist; dz <= dist; dz++) {
    for (let dx = -dist; dx <= dist; dx++) {
      const color = resolver(x + dx, z + dz);
      totalRed += red(color);
      totalGreen += green(color);
      totalBlue += blue(color);
    }
  }
  // ARGB.color(totalRed / count, totalGreen / count, totalBlue / count) - int division
  return (0xff000000 | (Math.floor(totalRed / count) << 16) | (Math.floor(totalGreen / count) << 8) | Math.floor(totalBlue / count)) >>> 0;
}

/** BiomeSpecialEffects.GrassColorModifier.DARK_FOREST */
function javaDarkForestGrass(base: number): number {
  return ((0xff000000 | (((base & 0xfefefe) + 0x28340a) >> 1) & 0xffffff)) >>> 0;
}

// ------------------------------------------------------------------ harness
let failures = 0;
function check(name: string, fn: () => boolean | string): void {
  let ok: boolean | string;
  try {
    ok = fn();
  } catch (e) {
    ok = `threw ${(e as Error).message}`;
  }
  if (ok === true) {
    console.log(`PASS  ${name}`);
  } else {
    failures++;
    console.log(`FAIL  ${name}${typeof ok === 'string' ? ' - ' + ok : ''}`);
  }
}
function eq(name: string, actual: unknown, expected: unknown): void {
  check(name, () => (Object.is(actual, expected) ? true : `got ${String(actual)}, want ${String(expected)}`));
}

// ------------------------------------------------------------------ setup
const colors = new BiomeColors(biomes as never, { blendRadius: 2, biomeSource: null });
colors.setColorMaps({
  grass: asRgba(grassPng),
  foliage: asRgba(foliagePng),
  dryFoliage: asRgba(dryFoliagePng),
});

console.log(`biomes: ${biomes.length}, grass.png ${grassPng.width}x${grassPng.height}, ` +
  `foliage.png ${foliagePng.width}x${foliagePng.height}, blendRadius=${colors.blendRadius}`);
console.log('');
console.log('id  biome                          temp rain   map(x,y)   base grass  java grass  ours   | base foliage java   ours');
console.log('--  -----------------------------  ---- ----  ---------  ----------  ----------  -----  | ------------ -------  -----');

const mismatches: string[] = [];
const sorted = [...biomes].sort((a, b) => a.id - b.id);
for (const biome of sorted) {
  const temp = javaClamp01(biome.temperature);
  const rain = javaClamp01(biome.downfall);
  const x = Math.trunc((1.0 - temp) * 255.0);
  const y = Math.trunc((1.0 - rain * temp) * 255.0);

  const ourGrass = colors.baseGrassColor(biome.id);
  const javaGrass = javaBaseGrass(biome);
  const ourFoliage = colors.foliageColorInt(biome.id);
  const javaFoliage = javaBaseFoliage(biome);
  const ourDry = colors.dryFoliageColorInt(biome.id);
  const javaDry = javaBaseDryFoliage(biome);
  const ourWater = colors.waterColorInt(biome.id);
  const javaWaterColor = javaWater(biome);

  const okGrass = ourGrass === javaGrass;
  const okFoliage = ourFoliage === javaFoliage;
  const okDry = ourDry === javaDry;
  const okWater = ourWater === javaWaterColor;
  if (!okGrass) mismatches.push(`${biome.name}: grass ours ${hex(ourGrass)} java ${hex(javaGrass)}`);
  if (!okFoliage) mismatches.push(`${biome.name}: foliage ours ${hex(ourFoliage)} java ${hex(javaFoliage)}`);
  if (!okDry) mismatches.push(`${biome.name}: dry foliage ours ${hex(ourDry)} java ${hex(javaDry)}`);
  if (!okWater) mismatches.push(`${biome.name}: water ours ${hex(ourWater)} java ${hex(javaWaterColor)}`);

  const name = biome.name.replace('minecraft:', '').padEnd(29);
  const mapCoord = `${x},${y}`.padEnd(9);
  console.log(
    `${String(biome.id).padStart(2)}  ${name}  ${temp.toFixed(2).padStart(4)} ${rain.toFixed(2).padStart(4)}  ` +
    `${mapCoord}  ${hex(javaGrass)}    ${hex(javaGrass)}    ${okGrass ? ' ' : 'X'}${hex(ourGrass).slice(1)}  | ` +
    `${hex(javaFoliage)}    ${okFoliage ? ' ' : 'X'}${hex(ourFoliage).slice(1)}    ${okFoliage ? okDry && okWater ? ' ' : 'X' : ' '}`,
  );
}

console.log('');
eq('1. all 66 biomes: base grass/foliage/dry-foliage/water colours match the Java algorithm (tolerance 0)', mismatches.length, 0);
for (const line of mismatches) console.log('     ' + line);
eq('   biome count is 66', biomes.length, 66);

// ------------------------------------------------------------------ 2. colormap coordinates
check('2. colormap coordinates match ColorMapColorUtil for every biome', () => {
  for (const biome of biomes) {
    const temp = javaClamp01(biome.temperature);
    const rain = javaClamp01(biome.downfall);
    const expected = { x: Math.trunc((1 - temp) * 255), y: Math.trunc((1 - rain * temp) * 255) };
    const got = colormapCoords(biome.temperature, biome.downfall);
    if (got.x !== expected.x || got.y !== expected.y) {
      return `${biome.name}: got (${got.x},${got.y}) want (${expected.x},${expected.y})`;
    }
  }
  return true;
});

// X axis = temperature (inverted), Y axis = temp*rain (inverted). Anchor on the corners of the
// grass map: jungle is the brightest corner, cold/dry the pale one.
check('3. hot+wet (jungle) is the top-left map corner, cold+dry the bottom-right', () => {
  const hotWet = colormapCoords(1, 1);
  const coldDry = colormapCoords(0, 0);
  if (hotWet.x !== 0 || hotWet.y !== 0) return `hot+wet -> (${hotWet.x},${hotWet.y})`;
  if (coldDry.x !== 255 || coldDry.y !== 255) return `cold+dry -> (${coldDry.x},${coldDry.y})`;
  return true;
});

// ------------------------------------------------------------------ 4. known vanilla colours
// These are the values every Minecraft player knows: plains grass #91BD59, forest #79C05A,
// jungle #59C93C, desert #BFB755, snowy plains #80B497, taiga #86B783.
const anchors: [string, number, number][] = [
  ['minecraft:plains', 0x91bd59, 0x77ab2f],
  ['minecraft:forest', 0x79c05a, 0x59ae30],
  ['minecraft:jungle', 0x59c93c, 0x30bb0b],
  ['minecraft:desert', 0xbfb755, 0xaea42a],
  ['minecraft:snowy_plains', 0x80b497, 0x60a17b],
  ['minecraft:taiga', 0x86b783, 0x68a464],
];
for (const [name, grass, foliage] of anchors) {
  const biome = biomes.find((b) => b.name === name)!;
  eq(`4. ${name.replace('minecraft:', '')} grass = ${hex(grass)}`, rgb24(colors.baseGrassColor(biome.id)), grass);
  eq(`4. ${name.replace('minecraft:', '')} foliage = ${hex(foliage)}`, rgb24(colors.foliageColorInt(biome.id)), foliage);
}

// GrassColor.getDefaultColor() = GrassColor.get(0.5, 1.0) must equal the constant the class
// falls back to when the map is missing (and the value is what grass.png[127,127] holds).
eq('5. GrassColor.getDefaultColor() = grass.png[127,127] = 0x7CBD6B',
  javaColormapColor(grassPng, 0.5, 1.0, GRASS_MISSING), 0xff7cbd6b);

// ------------------------------------------------------------------ 6. float rounding
// Java floats, not doubles: 0.6f widens to 0.6000000238418579, so (1 - 0.6f) * 255 truncates to
// 101, while a JS double 0.6 would truncate to 102. birch_forest (temp 0.6) is the witness.
check('6. Java float widening (0.6f -> x=101) is reproduced', () => {
  const got = colormapCoords(0.6, 0.6);
  const viaDouble = { x: Math.trunc((1 - 0.6) * 255), y: Math.trunc((1 - 0.6 * 0.6) * 255) };
  if (got.x !== 101) return `got x=${got.x}`;
  if (viaDouble.x === got.x) return 'double and float agree - test is not sensitive';
  return true;
});

// ------------------------------------------------------------------ 7. grass color modifiers
const darkForestId = biomeById.get(29)!.id;
check('7. dark_forest modifier = ((base & 0xFEFEFE) + 0x28340A) >> 1', () => {
  const base = colors.baseGrassColor(darkForestId);
  const expected = javaDarkForestGrass(base);
  const got = colors.grassColorInt(darkForestId, 0, 0);
  if (got !== expected) return `got ${hex(got)} want ${hex(expected)}`;
  if (rgb24(got) !== 0x507a32) return `vanilla dark forest grass is #507A32, got ${hex(got)}`;
  return true;
});

const swampId = biomeById.get(11)!.id;
check('8. swamp modifier picks 0x4C763C / 0x6A7039 from BIOME_INFO_NOISE', () => {
  const javaNoise = new SimplexNoise(new LegacyRandomSource(2345));
  const seen = new Set<number>();
  for (let z = -64; z <= 64; z += 7) {
    for (let x = -64; x <= 64; x += 7) {
      const expected = javaNoise.getValue2d(x * 0.0225, z * 0.0225) < -0.1 ? 0xff4c763c : 0xff6a7039;
      const got = colors.grassColorInt(swampId, x, z);
      if (got !== expected) return `(${x},${z}) got ${hex(got)} want ${hex(expected)}`;
      seen.add(got);
    }
  }
  if (seen.size !== 2) return `only saw ${[...seen].map(hex).join(' ')} (noise may be dead)`;
  return true;
});

// ------------------------------------------------------------------ 9. 5x5 blend
const PLAINS = biomeById.get(22)!.id;
const JUNGLE = biomeById.get(33)!.id;
const blendColors = new BiomeColors(biomes as never, {
  blendRadius: 2,
  biomeSource: (x, _y, z) => (x >= 0 ? JUNGLE : PLAINS + 0 * z),
});
blendColors.setColorMaps({ grass: asRgba(grassPng), foliage: asRgba(foliagePng), dryFoliage: asRgba(dryFoliagePng) });
const javaPlains = javaBaseGrass(biomeById.get(PLAINS)!);
const javaJungle = javaBaseGrass(biomeById.get(JUNGLE)!);

check('9. 5x5 blend on a biome border matches ClientLevel.calculateBlockTint', () => {
  // 25 samples: x = -2..2 with jungle at x >= 0 -> 3 jungle columns * 5 rows = 15 jungle,
  // 2 plains columns * 5 rows = 10 plains.
  const expected = javaBlend((x) => (x >= 0 ? javaJungle : javaPlains), 0, 0, 2);
  const got = blendColors.averageGrassColorInt(0, 64, 0);
  if (got !== expected) return `got ${hex(got)} want ${hex(expected)}`;
  const manual = (0xff000000 |
    (Math.floor((red(javaJungle) * 15 + red(javaPlains) * 10) / 25) << 16) |
    (Math.floor((green(javaJungle) * 15 + green(javaPlains) * 10) / 25) << 8) |
    Math.floor((blue(javaJungle) * 15 + blue(javaPlains) * 10) / 25)) >>> 0;
  if (got !== manual) return `sample split wrong: got ${hex(got)} want ${hex(manual)}`;
  return true;
});

check('10. blending only reaches biomeBlendRadius=2 blocks', () => {
  const inside = blendColors.averageGrassColorInt(3, 64, 0); // all 25 samples x=1..5 -> jungle
  if (inside !== javaJungle) return `x=3 got ${hex(inside)} want pure jungle ${hex(javaJungle)}`;
  const farInside = blendColors.averageGrassColorInt(40, 64, 0);
  if (farInside !== javaJungle) return `x=40 got ${hex(farInside)}`;
  return true;
});

check('11. blendRadius=0 samples one biome (dist == 0 branch)', () => {
  const none = new BiomeColors(biomes as never, { blendRadius: 0, biomeSource: (x) => (x >= 0 ? JUNGLE : PLAINS) });
  none.setColorMaps({ grass: asRgba(grassPng), foliage: asRgba(foliagePng), dryFoliage: asRgba(dryFoliagePng) });
  if (none.averageGrassColorInt(-1, 64, 0) !== javaPlains) return 'x=-1 not plains';
  if (none.averageGrassColorInt(0, 64, 0) !== javaJungle) return 'x=0 not jungle';
  return true;
});

check('12. blend passes the block Y to the biome source (3D biomes)', () => {
  const ys: number[] = [];
  const probe = new BiomeColors(biomes as never, {
    blendRadius: 2,
    biomeSource: (_x, y) => { ys.push(y); return PLAINS; },
  });
  probe.setColorMaps({ grass: asRgba(grassPng), foliage: asRgba(foliagePng), dryFoliage: asRgba(dryFoliagePng) });
  probe.averageGrassColorInt(10, 70, 10);
  if (ys.length !== 25) return `biome source called ${ys.length} times, want 25`;
  return ys.every((y) => y === 70) ? true : `y values ${[...new Set(ys)].join(',')}`;
});

// ------------------------------------------------------------------ 13. fixed leaf / block tints
const leaves = new BiomeColors(biomes as never, { blendRadius: 0, biomeSource: () => PLAINS });
leaves.setColorMaps({ grass: asRgba(grassPng), foliage: asRgba(foliagePng), dryFoliage: asRgba(dryFoliagePng) });
eq('13. BlockColors: spruce_leaves = FOLIAGE_EVERGREEN 0xFF619961', leaves.blockTintInt('spruce_leaves', PLAINS, 0) ?? 0, (-10380959 >>> 0));
eq('13. BlockColors: birch_leaves = FOLIAGE_BIRCH 0xFF80A755', leaves.blockTintInt('birch_leaves', PLAINS, 0) ?? 0, (-8345771 >>> 0));
eq('13. BlockColors: oak_leaves = biome foliage colour', leaves.blockTintInt('oak_leaves', PLAINS, 0) ?? 0, leaves.foliageColorInt(PLAINS));
eq('13. BlockColors: lily_pad in world = 0xFF208030', leaves.blockTintInt('lily_pad', PLAINS, 0) ?? 0, (-14647248 >>> 0));
eq('13. BlockColors: grass_block = biome grass colour', leaves.blockTintInt('grass_block', PLAINS, 0) ?? 0, leaves.grassColorInt(PLAINS, 0, 0));
eq('13. untinted block -> null (renderer must use white)', leaves.blockTintInt('stone', PLAINS, 0), null);
check('13. pink_petals layer 0 is blank (white), layer 1 is grass', () => {
  if (leaves.blockTintInt('pink_petals', PLAINS, 0) !== 0xffffffff) return 'layer 0 not white';
  return leaves.blockTintInt('pink_petals', PLAINS, 1) === leaves.grassColorInt(PLAINS, 0, 0);
});

// ------------------------------------------------------------------ 14. water
check('14. water colour is the biome water_color and is never black', () => {
  for (const biome of biomes) {
    const got = colors.waterColorInt(biome.id);
    const want = javaWater(biome);
    if (got !== want) return `${biome.name}: ${hex(got)} != ${hex(want)}`;
    if (red(got) + green(got) + blue(got) === 0) return `${biome.name} water is black`;
  }
  return true;
});

// ------------------------------------------------------------------ 15. the old bug, for the record
// Old code: (a) biome looked up by ARRAY index instead of registry id, (b) colormap axes swapped
// and `rain *= temp` missing. At the old spawn (sparse_jungle, id 45) it sampled snowy_beach's
// climate with the wrong axes -> #A7B867, the olive-yellow grass from the report.
const oldBiome = biomesByArrayIndex[45];
const oldX = Math.floor(javaClamp01(oldBiome.downfall) * 255);
const oldY = Math.floor((1 - javaClamp01(oldBiome.temperature)) * 255);
const oldColor = javaColormapColor(grassPng, oldBiome.temperature, oldBiome.downfall, GRASS_MISSING);
const oldPixelO = ((oldY * 256) + oldX) * 4;
const oldColor2 = ((0xff << 24) | (grassPng.data[oldPixelO] << 16) | (grassPng.data[oldPixelO + 1] << 8) | grassPng.data[oldPixelO + 2]) >>> 0;
console.log('');
console.log(`old-spawn bug: biomes[45] = ${oldBiome.name} (id ${oldBiome.id}), old axes -> ` +
  `(${oldX},${oldY}) = ${hex(oldColor2)}; correct sparse_jungle = ` +
  `${hex(colors.baseGrassColor(45))} (id 45 = ${biomeById.get(45)!.name})`);
check('15. the old colour really was the olive-yellow #A7B867 (and the fix differs)', () => {
  if (rgb24(oldColor2) !== 0xa7b867) return `old colour ${hex(oldColor2)}`;
  if (rgb24(colors.baseGrassColor(45)) === rgb24(oldColor2)) return 'fix did not change the colour';
  if (rgb24(colors.baseGrassColor(45)) !== 0x64c73f) return `fixed colour ${hex(colors.baseGrassColor(45))}`;
  return true;
});

// ------------------------------------------------------------------ summary
console.log('');
if (failures === 0) {
  console.log('ALL PASS');
} else {
  console.log(`${failures} FAIL`);
  process.exitCode = 1;
}
