import type { Manifest, BlockJson, QuadJson } from './types.js';
import { hexToRgb } from './math.js';

export interface Quad {
  p: number[];
  uv: number[];
  layer: number;
  anim: number;
  d: number;
  c: number;
  ti: number;
  shade: boolean;
  ao: boolean;
}

export interface BlockDef {
  id: number;
  name: string;
  flags: BlockJson['flags'];
  quads: Quad[];
  custom: null | 'water' | 'lava';
  tintMode: number;
  tintColor: [number, number, number];
  iconTop: string | null;
  iconSide: string | null;
  iconFlat: string | null;
  fluidLayer: number;
  fluidAnim: number;
}

const TINT_NONE = 0, TINT_GRASS = 1, TINT_FOLIAGE = 2, TINT_WATER = 3, TINT_FIXED = 4;

export class BlockRegistry {
  blocks: BlockDef[] = [];
  byName = new Map<string, BlockDef>();
  opaque = new Uint8Array(512);
  solid = new Uint8Array(512);
  translucent = new Uint8Array(512);
  lightOpacity = new Uint8Array(512);
  emission = new Uint8Array(512);
  cullSelf = new Uint8Array(512);
  noAO = new Uint8Array(512);
  emissive = new Uint8Array(512);
  liquid = new Uint8Array(512);
  custom = new Uint8Array(512); // 0 none, 1 water, 2 lava
  tintMode = new Uint8Array(512);
  tintFixed = new Float32Array(512 * 3);
  hotbarNames = ['grass_block', 'stone', 'oak_planks', 'oak_log', 'oak_leaves', 'glass', 'torch', 'sulfur', 'cinnabar'];

  constructor(manifest: Manifest) {
    this.blocks.push({
      id: 0, name: 'air', flags: null as any, quads: [], custom: null,
      tintMode: TINT_NONE, tintColor: [1, 1, 1], iconTop: null, iconSide: null, iconFlat: null,
      fluidLayer: -1, fluidAnim: -1,
    });
    for (const b of manifest.blocks) {
      const quads: Quad[] = b.quads.map((q: QuadJson) => {
        const tex = manifest.textures[q.t];
        if (!tex) throw new Error('unknown texture ' + q.t);
        return {
          p: q.p, uv: q.uv, layer: tex.arrayLayer, anim: tex.animId,
          d: q.d, c: q.c, ti: q.ti, shade: q.s, ao: q.ao,
        };
      });
      let tintMode = TINT_NONE;
      if (b.flags.tint === 'grass') tintMode = TINT_GRASS;
      else if (b.flags.tint === 'foliage') tintMode = TINT_FOLIAGE;
      else if (b.flags.tint === 'water') tintMode = TINT_WATER;
      else if (b.flags.tint === 'fixed') tintMode = TINT_FIXED;
      const tintColor: [number, number, number] = b.flags.tintColor ? hexToRgb(b.flags.tintColor) : [1, 1, 1];
      const texByDir = (dir: number) => b.quads.find(q => q.d === dir)?.t ?? null;
      const fluidTex = b.custom ? manifest.textures[`block/${b.name}_still`] : null;
      const def: BlockDef = {
        id: b.id, name: b.name, flags: b.flags, quads, custom: b.custom,
        tintMode, tintColor,
        iconTop: texByDir(1),
        iconSide: texByDir(3) ?? texByDir(2),
        iconFlat: b.custom ? `block/${b.name}_still` : (b.quads[0]?.t ?? null),
        fluidLayer: fluidTex?.arrayLayer ?? -1,
        fluidAnim: fluidTex?.animId ?? -1,
      };
      this.blocks[b.id] = def;
      this.byName.set(b.name, def);
      this.opaque[b.id] = b.flags.opaque ? 1 : 0;
      this.solid[b.id] = b.flags.solid ? 1 : 0;
      this.translucent[b.id] = b.flags.render === 'translucent' ? 1 : 0;
      this.lightOpacity[b.id] = b.flags.lightOpacity;
      this.emission[b.id] = b.flags.light;
      this.cullSelf[b.id] = b.flags.cullSelf ? 1 : 0;
      this.noAO[b.id] = b.flags.noAO ? 1 : 0;
      this.emissive[b.id] = b.flags.emissive ? 1 : 0;
      this.liquid[b.id] = b.flags.liquid ? 1 : 0;
      this.custom[b.id] = b.custom === 'water' ? 1 : b.custom === 'lava' ? 2 : 0;
      this.tintMode[b.id] = tintMode;
      this.tintFixed[b.id * 3] = tintColor[0];
      this.tintFixed[b.id * 3 + 1] = tintColor[1];
      this.tintFixed[b.id * 3 + 2] = tintColor[2];
    }
  }

  id(name: string): number {
    const b = this.byName.get(name);
    if (!b) throw new Error('unknown block ' + name);
    return b.id;
  }

  get(id: number): BlockDef { return this.blocks[id] ?? this.blocks[0]; }

  hotbar(): BlockDef[] {
    return this.hotbarNames.map(n => this.byName.get(n)!).filter(Boolean);
  }
}
