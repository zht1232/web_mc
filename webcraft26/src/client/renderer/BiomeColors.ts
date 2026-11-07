// Port of the vanilla biome-tint pipeline. Sources (G:/ck-web26/src-vanilla/net/minecraft):
//   world/level/ColorMapColorUtil.java        temperature/downfall -> colormap pixel
//   world/level/GrassColor.java               GrassColor.get + getDefaultColor
//   world/level/FoliageColor.java             FoliageColor.get + the fixed leaf colours
//   world/level/DryFoliageColor.java          DryFoliageColor.get
//   world/level/biome/Biome.java              getGrassColor / getFoliageColor / getDryFoliageColor
//   world/level/biome/BiomeSpecialEffects.java grass_color_modifier (none/dark_forest/swamp)
//   client/renderer/BiomeColors.java          the ColorResolvers
//   client/multiplayer/ClientLevel.java       calculateBlockTint (biomeBlendRadius 5x5 average)
//   client/color/block/BlockColors.java       which block uses which resolver
//   client/Options.java:469-475               biomeBlendRadius default = 2
//
// The colormap index is NOT `x = rainfall, y = 1 - temperature` (that was the old bug, it made
// sparse_jungle olive yellow because it picked the cold/dry corner of grass.png). Vanilla is:
//
//   ColorMapColorUtil.get(temp, rain, pixels, default):
//       rain *= temp;                                  // "adjusted rainfall"
//       int x = (int)((1.0 - temp) * 255.0);           // x axis = temperature, inverted
//       int y = (int)((1.0 - rain) * 255.0);           // y axis = temp*rain,   inverted
//       int index = y << 8 | x;                        // row-major, 256 px per row, row 0 = top
//       return index >= pixels.length ? default : pixels[index];
//
// and Biome.getGrassColorFromTexture clamps temperature/downfall to [0,1] *as Java floats*
// before calling it, so the input must be Math.fround()-ed (float 0.6f widens to
// 0.6000000238418579, and (1 - 0.6f) * 255 truncates to 101, while a double 0.6 truncates to
// 102). That one-pixel difference is why every float here goes through Math.fround.

import { LegacyRandomSource } from '../../vanilla/core/Random.js';
import { SimplexNoise } from '../../vanilla/world/level/levelgen/synth/SimplexNoise.js';

export type Rgb = [number, number, number];

/** net/minecraft/util/ARGB. Colours are unsigned 0xFFRRGGBB ints, like the Java ones. */
export const argb = {
  red: (color: number): number => (color >>> 16) & 0xff,
  green: (color: number): number => (color >>> 8) & 0xff,
  blue: (color: number): number => color & 0xff,
  color: (r: number, g: number, b: number): number => (0xff000000 | (r << 16) | (g << 8) | b) >>> 0,
  opaque: (color: number): number => (0xff000000 | (color & 0xffffff)) >>> 0,
};

// FoliageColor.java:4-7 (signed Java ints -7158200 / -10380959 / -8345771 / -12012264)
export const FOLIAGE_MANGROVE = 0xff92c648;
export const FOLIAGE_EVERGREEN = 0xff619961;
export const FOLIAGE_BIRCH = 0xff80a755;
export const FOLIAGE_DEFAULT_COLOR = 0xff48b518;
/** DryFoliageColor.java fallback (-10732494). */
export const DRY_FOLIAGE_DEFAULT_COLOR = 0xff5c3c32;
/** BlockColors.java:15-16 (-14647248 / -9321636) and :42 attached stem (-2046180). */
export const LILY_PAD_IN_WORLD = 0xff208030;
export const LILY_PAD_DEFAULT = 0xff71c35c;
export const ATTACHED_STEM_COLOR = 0xffe0c71c;
/** ColorMapColorUtil fallback for an out-of-range index: -65281, the magenta "missing" colour. */
export const COLORMAP_MISSING_COLOR = 0xffff00ff;
/**
 * GrassColor.getDefaultColor() = GrassColor.get(0.5, 1.0): the "in hand" grass colour, used as
 * the fallback when the colormap is unavailable. The value comes from grass.png[127,127] - the
 * test asserts exactly that, so it is derived rather than guessed.
 */
export const GRASS_DEFAULT_COLOR = 0xff7cbd6b;
/** Vanilla default water fog colour (0x050533). */
export const WATER_FOG: Rgb = [0.02, 0.02, 0.2];

export interface BiomeEffectsLike {
  water_color?: number | string;
  grass_color?: number | string;
  foliage_color?: number | string;
  dry_foliage_color?: number | string;
  /** "none" | "dark_forest" | "swamp" (BiomeSpecialEffects.GrassColorModifier.CODEC) */
  grass_color_modifier?: string;
}

export interface BiomeLike {
  id: number;
  name: string;
  temperature: number;
  downfall: number;
  effects?: BiomeEffectsLike | null;
}

/** Java `float` value of a climate field. The data pack stores Java floats. */
function javaFloat(value: number): number {
  return Math.fround(value);
}

/** Mth.clamp(value, 0.0F, 1.0F) */
function clamp01(value: number): number {
  return value < 0 ? 0 : value > 1 ? 1 : value;
}

export interface ColormapCoords {
  x: number;
  y: number;
}

/**
 * ColorMapColorUtil.get coordinates. `temperature`/`downfall` are the raw pack values (any
 * range); Biome.getGrassColorFromTexture clamps them to a float in [0,1] first.
 */
export function colormapCoords(temperature: number, downfall: number): ColormapCoords {
  const temp = clamp01(javaFloat(temperature));
  const rain = clamp01(javaFloat(downfall));
  const adjustedRain = rain * temp; // `rain *= temp;`
  return {
    x: Math.trunc((1.0 - temp) * 255.0),
    y: Math.trunc((1.0 - adjustedRain) * 255.0),
  };
}

/**
 * ColorMapColorUtil.get on an RGBA byte array (the 256x256 grass/foliage colormap, row 0 = top,
 * which is how NativeImage.makePixelArray lays pixels out).
 */
export function sampleColormap(
  map: Uint8Array,
  temperature: number,
  downfall: number,
  fallback = COLORMAP_MISSING_COLOR,
): number {
  const { x, y } = colormapCoords(temperature, downfall);
  const index = (y << 8) | x;
  const offset = index * 4;
  if (offset + 3 >= map.length) return fallback;
  return argb.color(map[offset], map[offset + 1], map[offset + 2]);
}

/** ExtraCodecs.STRING_RGB_COLOR: "#rrggbb" in the data pack, an int in code. */
export function parseRgbColor(value: number | string | null | undefined): number | null {
  if (value === null || value === undefined) return null;
  if (typeof value === 'number') return Number.isFinite(value) ? argb.opaque(value) : null;
  const text = value.trim();
  const hex = /^#?([0-9a-fA-F]{6})$/.exec(text);
  if (hex) return argb.opaque(parseInt(hex[1], 16));
  const asNumber = Number(text);
  return Number.isFinite(asNumber) ? argb.opaque(asNumber) : null;
}

/** rgb 0..255 floats as the mesher's tint multiplier (channel / 255 is exactly what ARGB does). */
export function rgbFloat(color: number): Rgb {
  return [argb.red(color) / 255, argb.green(color) / 255, argb.blue(color) / 255];
}

const WHITE = 0xffffffff;

/**
 * BiomeSpecialEffects.GrassColorModifier.modifyColor. `noise` is Biome.BIOME_INFO_NOISE
 * (`new PerlinSimplexNoise(new WorldgenRandom(new LegacyRandomSource(2345L)), [0])`, i.e. the
 * octave-[0] PerlinSimplexNoise, so PerlinSimplexNoise.getValue(x, z, false) reduces to
 * SimplexNoise.getValue(x, z) with factor/valueFactor 1).
 */
export function applyGrassColorModifier(
  modifier: string,
  x: number,
  z: number,
  baseColor: number,
  noise: SimplexNoise,
): number {
  if (modifier === 'dark_forest') {
    // ARGB.opaque((baseColor & 16711422) + 2634762 >> 1) - shift binds looser than +.
    return argb.opaque(((baseColor & 0xfefefe) + 0x28340a) >> 1);
  }
  if (modifier === 'swamp') {
    // BIOME_INFO_NOISE.getValue(x * 0.0225, z * 0.0225, false) < -0.1 ? -11766212 : -9801671
    return noise.getValue2d(x * 0.0225, z * 0.0225) < -0.1 ? 0xff4c763c : 0xff6a7039;
  }
  return baseColor;
}

export interface BiomeColorsOptions {
  /** Options.biomeBlendRadius default is 2 (Options.java:472) -> a 5x5 average. */
  blendRadius?: number;
  /** Biome id at a position. Without it only the per-biome colour is available (no blend). */
  biomeSource?: ((x: number, y: number, z: number) => number) | null;
}

const KIND_GRASS = 0;
const KIND_FOLIAGE = 1;
const KIND_DRY_FOLIAGE = 2;
const KIND_WATER = 3;

export class BiomeColors {
  /** Same default as Options.biomeBlendRadius. */
  readonly blendRadius: number;
  private grassMap: Uint8Array | null = null;
  private foliageMap: Uint8Array | null = null;
  private dryFoliageMap: Uint8Array | null = null;
  /** Biome ids are registry ids (0..65), NOT array indices: the pack ships `biomes` as an object. */
  private readonly byId = new Map<number, BiomeLike>();
  private biomeSource: ((x: number, y: number, z: number) => number) | null;
  /** (biomeId * 4 + kind) -> position independent ARGB colour */
  private readonly baseCache = new Map<number, number>();
  /** Biome.BIOME_INFO_NOISE, only needed by the swamp grass modifier. */
  private readonly biomeInfoNoise: SimplexNoise;

  constructor(biomes: readonly BiomeLike[], options: BiomeColorsOptions = {}) {
    for (let i = 0; i < biomes.length; i++) {
      const biome = biomes[i];
      const id = Number.isInteger(biome?.id) ? biome.id : i;
      if (!this.byId.has(id)) this.byId.set(id, biome);
    }
    const requested = options.blendRadius;
    this.blendRadius = requested === undefined ? 2 : Math.max(0, Math.min(7, Math.trunc(requested)));
    this.biomeSource = options.biomeSource ?? null;
    this.biomeInfoNoise = new SimplexNoise(new LegacyRandomSource(2345));
  }

  /** Loads grass.png / foliage.png / dry_foliage.png colormaps through an Image + canvas. */
  async load(base = '/mc'): Promise<void> {
    const load = async (path: string): Promise<Uint8Array> => {
      const img = new Image();
      img.src = `${base}/${path}`;
      await img.decode();
      const canvas = document.createElement('canvas');
      canvas.width = img.width;
      canvas.height = img.height;
      const ctx = canvas.getContext('2d', { willReadFrequently: true })!;
      ctx.drawImage(img, 0, 0);
      return new Uint8Array(ctx.getImageData(0, 0, img.width, img.height).data.buffer.slice(0));
    };
    this.grassMap = await load('textures/colormap/grass.png');
    this.foliageMap = await load('textures/colormap/foliage.png');
    try {
      this.dryFoliageMap = await load('textures/colormap/dry_foliage.png');
    } catch {
      this.dryFoliageMap = null; // optional: older packs ship without it
    }
    this.baseCache.clear();
  }

  /** Injects already decoded colormaps (used by the node test and by data-driven callers). */
  setColorMaps(maps: { grass: Uint8Array; foliage: Uint8Array; dryFoliage?: Uint8Array | null }): void {
    this.grassMap = maps.grass;
    this.foliageMap = maps.foliage;
    this.dryFoliageMap = maps.dryFoliage ?? null;
    this.baseCache.clear();
  }

  /** Late binding for the level's biome lookup (Game.init runs before ClientLevel exists). */
  setBiomeSource(source: ((x: number, y: number, z: number) => number) | null): void {
    this.biomeSource = source;
  }

  biome(biomeId: number): BiomeLike | undefined {
    return this.byId.get(biomeId);
  }

  private cached(key: number, compute: () => number): number {
    const hit = this.baseCache.get(key);
    if (hit !== undefined) return hit;
    const color = compute();
    this.baseCache.set(key, color);
    return color;
  }

  /** Biome.getBaseGrassColor(): grass_color override, else the grass colormap pixel. */
  baseGrassColor(biomeId: number): number {
    return this.cached(biomeId * 4 + KIND_GRASS, () => {
      const biome = this.byId.get(biomeId);
      const override = parseRgbColor(biome?.effects?.grass_color);
      if (override !== null) return override;
      if (biome && this.grassMap) return sampleColormap(this.grassMap, biome.temperature, biome.downfall);
      return GRASS_DEFAULT_COLOR;
    });
  }

  /** Biome.getFoliageColor(): foliage_color override, else the foliage colormap pixel. */
  foliageColorInt(biomeId: number): number {
    return this.cached(biomeId * 4 + KIND_FOLIAGE, () => {
      const biome = this.byId.get(biomeId);
      const override = parseRgbColor(biome?.effects?.foliage_color);
      if (override !== null) return override;
      if (biome && this.foliageMap) {
        return sampleColormap(this.foliageMap, biome.temperature, biome.downfall, FOLIAGE_DEFAULT_COLOR);
      }
      return FOLIAGE_DEFAULT_COLOR;
    });
  }

  /** Biome.getDryFoliageColor(): dry_foliage_color override, else dry_foliage.png. */
  dryFoliageColorInt(biomeId: number): number {
    return this.cached(biomeId * 4 + KIND_DRY_FOLIAGE, () => {
      const biome = this.byId.get(biomeId);
      const override = parseRgbColor(biome?.effects?.dry_foliage_color);
      if (override !== null) return override;
      if (biome && this.dryFoliageMap) {
        return sampleColormap(this.dryFoliageMap, biome.temperature, biome.downfall, DRY_FOLIAGE_DEFAULT_COLOR);
      }
      return DRY_FOLIAGE_DEFAULT_COLOR;
    });
  }

  /** Biome.getWaterColor() = BiomeSpecialEffects.waterColor (the pack always sets it). */
  waterColorInt(biomeId: number): number {
    return this.cached(biomeId * 4 + KIND_WATER, () => {
      const water = parseRgbColor(this.byId.get(biomeId)?.effects?.water_color);
      return water ?? 0xff3f76e4; // vanilla default water colour
    });
  }

  /** Biome.getGrassColor(x, z): base colour with the grass_color_modifier applied. */
  grassColorInt(biomeId: number, x = 0, z = 0): number {
    const base = this.baseGrassColor(biomeId);
    const modifier = this.byId.get(biomeId)?.effects?.grass_color_modifier ?? 'none';
    return applyGrassColorModifier(modifier, x, z, base, this.biomeInfoNoise);
  }

  private biomeIdAt(x: number, y: number, z: number): number {
    return this.biomeSource ? this.biomeSource(x, y, z) : 0;
  }

  /** ClientLevel.calculateBlockTint: the biomeBlendRadius 5x5 average. */
  private averageColorAt(
    x: number,
    y: number,
    z: number,
    resolver: (biomeId: number, px: number, pz: number) => number,
  ): number {
    const dist = this.blendRadius;
    if (dist <= 0) {
      const biomeId = this.biomeIdAt(x, y, z);
      return resolver(biomeId, x, z);
    }
    const count = (dist * 2 + 1) * (dist * 2 + 1);
    let red = 0;
    let green = 0;
    let blue = 0;
    for (let dz = -dist; dz <= dist; dz++) {
      for (let dx = -dist; dx <= dist; dx++) {
        const px = x + dx;
        const pz = z + dz;
        const color = resolver(this.biomeIdAt(px, y, pz), px, pz);
        red += argb.red(color);
        green += argb.green(color);
        blue += argb.blue(color);
      }
    }
    // `return ARGB.color(totalRed / count, ...)` - Java int division truncates.
    return argb.color(Math.floor(red / count), Math.floor(green / count), Math.floor(blue / count));
  }

  /** BiomeColors.getAverageGrassColor(level, pos). */
  averageGrassColorInt(x: number, y: number, z: number): number {
    return this.averageColorAt(x, y, z, (biomeId, px, pz) => this.grassColorInt(biomeId, px, pz));
  }

  /** BiomeColors.getAverageFoliageColor(level, pos). */
  averageFoliageColorInt(x: number, y: number, z: number): number {
    return this.averageColorAt(x, y, z, (biomeId) => this.foliageColorInt(biomeId));
  }

  /** BiomeColors.getAverageDryFoliageColor(level, pos). */
  averageDryFoliageColorInt(x: number, y: number, z: number): number {
    return this.averageColorAt(x, y, z, (biomeId) => this.dryFoliageColorInt(biomeId));
  }

  /** BiomeColors.getAverageWaterColor(level, pos). */
  averageWaterColorInt(x: number, y: number, z: number): number {
    return this.averageColorAt(x, y, z, (biomeId) => this.waterColorInt(biomeId));
  }

  // ---- mesher-facing float API (values are channel / 255, exactly ARGB's scale) ----------

  /** Biome.getGrassColor(biome, x, z); callers with a world position should pass x/z. */
  grassColor(biomeId: number, x = 0, z = 0): Rgb {
    return rgbFloat(this.grassColorInt(biomeId, x, z));
  }

  foliageColor(biomeId: number): Rgb {
    return rgbFloat(this.foliageColorInt(biomeId));
  }

  waterColor(biomeId: number): Rgb {
    return rgbFloat(this.waterColorInt(biomeId));
  }

  /** Blended variants: pass the block position; `y` defaults to 64 to match the old call site. */
  grassColorAt(x: number, z: number, y = 64): Rgb {
    return rgbFloat(this.averageGrassColorInt(x, y, z));
  }

  foliageColorAt(x: number, z: number, y = 64): Rgb {
    return rgbFloat(this.averageFoliageColorInt(x, y, z));
  }

  dryFoliageColorAt(x: number, z: number, y = 64): Rgb {
    return rgbFloat(this.averageDryFoliageColorInt(x, y, z));
  }

  waterColorAt(x: number, z: number, y = 64): Rgb {
    return rgbFloat(this.averageWaterColorInt(x, y, z));
  }

  /** BlockColors: SPRUCE_LEAVES -> constant(FoliageColor.FOLIAGE_EVERGREEN). */
  spruceLeavesColor(): Rgb {
    return rgbFloat(FOLIAGE_EVERGREEN);
  }

  /** BlockColors: BIRCH_LEAVES -> constant(FoliageColor.FOLIAGE_BIRCH). */
  birchLeavesColor(): Rgb {
    return rgbFloat(FOLIAGE_BIRCH);
  }

  /**
   * BlockColors.createDefault() rolled into one lookup: the ARGB tint a block uses in world,
   * or null when the block has no tint source (the renderer must then use white).
   * `tintIndex` is the model's tintindex. Blocks whose colour depends on a block state property
   * (redstone_wire power, melon/pumpkin stem age) are left to the caller.
   */
  blockTintInt(blockName: string, biomeId: number, tintIndex: number, x = 0, z = 0, y = 64): number | null {
    switch (blockName) {
      // BlockTintSources.doubleTallGrass() (LARGE_FERN, TALL_GRASS): grass colour of the LOWER
      // half's position. The mesher only hands over the block position, so the upper half is
      // tinted with its own column - same colour unless the column straddles a biome border.
      case 'tall_grass':
      case 'large_fern':
      case 'fern':
      case 'short_grass':
      case 'potted_fern':
      case 'bush':
      case 'grass_block':
      case 'sugar_cane':
        return this.averageGrassColorInt(x, y, z);

      // BlockColors: PINK_PETALS / WILDFLOWERS = [BLANK_LAYER, grass()] -> layer 1 is grass.
      case 'pink_petals':
      case 'wildflowers':
        return tintIndex === 0 ? WHITE : this.averageGrassColorInt(x, y, z);

      case 'spruce_leaves':
        return FOLIAGE_EVERGREEN;
      case 'birch_leaves':
        return FOLIAGE_BIRCH;

      case 'oak_leaves':
      case 'jungle_leaves':
      case 'acacia_leaves':
      case 'dark_oak_leaves':
      case 'vine':
      case 'mangrove_leaves':
        return this.averageFoliageColorInt(x, y, z);

      case 'leaf_litter':
        return this.averageDryFoliageColorInt(x, y, z);

      // Blocks.WATER is registered as waterParticles() (biome colour only for terrain particles)
      // but FluidStateModelSet gives the water *fluid* model BlockTintSources.water(), which is
      // BiomeColors.getAverageWaterColor - and that is the colour the terrain water is drawn
      // with (FluidRenderer:87). Our mesher draws water through the block path, so use it here.
      case 'water':
      case 'bubble_column':
      case 'water_cauldron':
        return this.averageWaterColorInt(x, y, z);

      case 'attached_melon_stem':
      case 'attached_pumpkin_stem':
        return ATTACHED_STEM_COLOR;

      case 'lily_pad':
        return LILY_PAD_IN_WORLD;

      default:
        return null;
    }
  }

  /** Same as blockTintInt but as a 0..1 multiplier, white when untinted. */
  blockTint(blockName: string, biomeId: number, tintIndex: number, x = 0, z = 0, y = 64): Rgb {
    const color = this.blockTintInt(blockName, biomeId, tintIndex, x, z, y);
    return color === null ? [1, 1, 1] : rgbFloat(color);
  }
}
