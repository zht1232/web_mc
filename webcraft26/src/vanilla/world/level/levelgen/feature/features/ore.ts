// Port of net.minecraft.world.level.levelgen.feature.OreFeature and ScatteredOreFeature.
// The blob is a compact deterministic ellipsoid (vanilla's shape is a jittered ellipsoid; the
// exact vertex math is simplified). Ore `targets` are tag_match / block_match rules resolved
// against public/mc/tags.json (#minecraft:stone_ore_replaceables, #deepslate_ore_replaceables,
// #base_stone_overworld, ...).

import type { MinecraftData } from '../../../block/state/BlockState.js';
import type { Cfg, FeatureApi, FeatureContext } from '../FeaturePlacer.js';
import type { FeatureRandom } from '../WorldgenRandom.js';
import { blockName, stateOf } from './shared.js';

function bare(name: string): string {
  return name.startsWith('minecraft:') ? name.slice('minecraft:'.length) : name;
}

function targetMatchesRaw(ctx: FeatureContext, target: Cfg, state: number): boolean {
  const name = blockName(ctx, state);
  const type = target.predicate_type ?? target.type ?? '';
  switch (type) {
    case 'minecraft:tag_match':
    case 'minecraft:matching_block_tag':
      return ctx.tags.has(target.tag, name);
    case 'minecraft:block_match':
      return name === bare(target.block);
    case 'minecraft:matching_blocks': {
      const blocks = target.blocks;
      if (typeof blocks === 'string') return name === bare(blocks);
      if (Array.isArray(blocks)) for (const b of blocks) if (name === bare(b)) return true;
      return false;
    }
    case 'minecraft:true':
    case 'minecraft:always_true':
      return true;
    case 'minecraft:solid':
      return ctx.mc.isSolid(state);
    default:
      return false;
  }
}

/**
 * Ore blobs scan thousands of voxels; doing a string tag lookup per voxel is the dominant cost.
 * Precompile, once per (MinecraftData, target rule), a state-id -> matches table.
 */
const MATCH_TABLES = new WeakMap<MinecraftData, Map<string, Uint8Array>>();

function matchTable(ctx: FeatureContext, target: Cfg): Uint8Array {
  let perMc = MATCH_TABLES.get(ctx.mc);
  if (!perMc) { perMc = new Map(); MATCH_TABLES.set(ctx.mc, perMc); }
  const key = JSON.stringify(target);
  let table = perMc.get(key);
  if (!table) {
    table = new Uint8Array(ctx.mc.stateCount);
    for (let s = 0; s < table.length; s++) table[s] = targetMatchesRaw(ctx, target, s) ? 1 : 0;
    perMc.set(key, table);
  }
  return table;
}

export function place(
  ctx: FeatureContext, config: Cfg, random: FeatureRandom, x: number, y: number, z: number, _api: FeatureApi,
): boolean {
  const size = config.size ?? 0;
  if (size <= 0) return false;
  const targets: Cfg[] = config.targets ?? [];
  if (targets.length === 0) return false;
  // Resolve each target's ore state once, and precompile its state-id match table.
  const states: number[] = targets.map((t) => stateOf(ctx, t.state));
  const tables: Uint8Array[] = targets.map((t) => matchTable(ctx, t.target));

  const r = Math.max(1, Math.min(3, Math.round(size / 8)));
  const jitter = random.nextFloat();
  const thresh = r * r * (0.75 + 0.5 * jitter);
  let placed = false;
  for (let ox = -r; ox <= r; ox++) {
    for (let oy = -r; oy <= r; oy++) {
      for (let oz = -r; oz <= r; oz++) {
        if (ox * ox + oy * oy + oz * oz > thresh) continue;
        const px = x + ox, py = y + oy, pz = z + oz;
        const here = ctx.getBlockState(px, py, pz);
        for (let i = 0; i < targets.length; i++) {
          if (tables[i][here]) {
            ctx.setBlock(px, py, pz, states[i]);
            placed = true;
            break;
          }
        }
      }
    }
  }
  return placed;
}
