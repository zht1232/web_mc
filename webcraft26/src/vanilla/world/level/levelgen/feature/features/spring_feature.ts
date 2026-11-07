// Port of net.minecraft.world.level.levelgen.feature.SpringFeature (fluid springs, step
// FLUID_SPRINGS). The full rock/hole-neighbour count is simplified to "block above is a valid
// block and origin is empty"; springs are decorative and rare enough that this is sufficient.

import type { Cfg, FeatureApi, FeatureContext } from '../FeaturePlacer.js';
import type { FeatureRandom } from '../WorldgenRandom.js';
import { blockName, stateOf } from './shared.js';

function bare(name: string): string {
  return name.startsWith('minecraft:') ? name.slice('minecraft:'.length) : name;
}

function isOneOf(ctx: FeatureContext, blocks: Cfg, state: number): boolean {
  const name = blockName(ctx, state);
  if (typeof blocks === 'string') return name === bare(blocks);
  if (Array.isArray(blocks)) for (const b of blocks) if (name === bare(b)) return true;
  return false;
}

export function place(
  ctx: FeatureContext, config: Cfg, _random: FeatureRandom, x: number, y: number, z: number, _api: FeatureApi,
): boolean {
  const valid = config.valid_blocks ?? [];
  if (!isOneOf(ctx, valid, ctx.getBlockState(x, y + 1, z))) return false;
  if (config.requires_block_below !== false && !isOneOf(ctx, valid, ctx.getBlockState(x, y - 1, z))) return false;
  const here = ctx.getBlockState(x, y, z);
  if (!ctx.mc.isAir(here) && !isOneOf(ctx, valid, here)) return false;
  ctx.setBlock(x, y, z, stateOf(ctx, config.state));
  return true;
}
