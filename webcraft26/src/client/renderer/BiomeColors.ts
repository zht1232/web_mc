// Port of net.minecraft.client.renderer.BiomeColors: grass, foliage and water tint
// per biome, using the official colormap textures shipped in the client jar.

export interface BiomeLike {
  id: number;
  name: string;
  temperature: number;
  downfall: number;
  effects?: { water_color?: number; grass_color?: number; foliage_color?: number };
}

export class BiomeColors {
  private grassMap: Uint8Array | null = null;
  private foliageMap: Uint8Array | null = null;
  private biomeTintCache = new Map<number, [number, number, number]>();
  private waterCache = new Map<number, [number, number, number]>();

  constructor(private readonly biomes: BiomeLike[]) {}

  /** Loads grass.png / foliage.png colormaps as raw RGBA. */
  async load(base = '/mc'): Promise<void> {
    const load = async (path: string) => {
      const img = new Image();
      img.src = `${base}/${path}`;
      await img.decode();
      const canvas = document.createElement('canvas');
      canvas.width = img.width;
      canvas.height = img.height;
      const ctx = canvas.getContext('2d')!;
      ctx.drawImage(img, 0, 0);
      return new Uint8Array(ctx.getImageData(0, 0, img.width, img.height).data.buffer.slice(0));
    };
    this.grassMap = await load('textures/colormap/grass.png');
    this.foliageMap = await load('textures/colormap/foliage.png');
  }

  /** Vanilla Colormap.getColorFromTexture: x = humidity, y = 1 - temperature. */
  private sampleColormap(map: Uint8Array, temperature: number, downfall: number): [number, number, number] {
    const d = Math.min(1, Math.max(0, temperature));
    const e = Math.min(1, Math.max(0, downfall));
    const x = Math.floor(e * 255);
    const y = Math.floor((1 - d) * 255);
    const i = (y * 256 + x) * 4;
    return [map[i] / 255, map[i + 1] / 255, map[i + 2] / 255];
  }

  grassColor(biomeId: number): [number, number, number] {
    const cached = this.biomeTintCache.get(biomeId);
    if (cached) return cached;
    const biome = this.biomes[biomeId];
    let color: [number, number, number];
    if (biome?.effects?.grass_color !== undefined && biome.effects.grass_color !== null) {
      const c = biome.effects.grass_color;
      color = [((c >> 16) & 255) / 255, ((c >> 8) & 255) / 255, (c & 255) / 255];
    } else if (this.grassMap && biome) {
      color = this.sampleColormap(this.grassMap, biome.temperature, biome.downfall);
    } else {
      color = [0.568, 0.741, 0.349]; // GrassColor.getDefaultColor() = 0x91BD59
    }
    this.biomeTintCache.set(biomeId, color);
    return color;
  }

  foliageColor(biomeId: number): [number, number, number] {
    const biome = this.biomes[biomeId];
    if (biome?.effects?.foliage_color !== undefined && biome.effects.foliage_color !== null) {
      const c = biome.effects.foliage_color;
      return [((c >> 16) & 255) / 255, ((c >> 8) & 255) / 255, (c & 255) / 255];
    }
    if (this.foliageMap && biome) return this.sampleColormap(this.foliageMap, biome.temperature, biome.downfall);
    return [0.188, 0.463, 0.129]; // FoliageColor.getDefaultColor() = 0x30A70F-ish
  }

  waterColor(biomeId: number): [number, number, number] {
    const cached = this.waterCache.get(biomeId);
    if (cached) return cached;
    const biome = this.biomes[biomeId];
    const c = biome?.effects?.water_color ?? 0x3f76e4;
    const color: [number, number, number] = [((c >> 16) & 255) / 255, ((c >> 8) & 255) / 255, (c & 255) / 255];
    this.waterCache.set(biomeId, color);
    return color;
  }

  /** Vanilla default water fog colour 0x050533 */
  static readonly WATER_FOG = [0.02, 0.02, 0.2] as const;
}
