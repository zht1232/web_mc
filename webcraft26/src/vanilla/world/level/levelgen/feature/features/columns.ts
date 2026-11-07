// Shared column builder for BlockColumnFeature (26.2's `block_column`: cactus, sugar_cane,
// cave_vine) and the classic CactusFeature / SugarCaneFeature.

import type { Cfg, FeatureContext } from '../FeaturePlacer.js';
import type { FeatureRandom } from '../WorldgenRandom.js';
import { safeState, sampleInt, sampleStateProvider, testPredicate } from './shared.js';

export function growColumn(
  ctx: FeatureContext, random: FeatureRandom, x: number, y: number, z: number,
  dirY: number, layers: Cfg[], allowed: Cfg,
): boolean {
  let cy = y;
  let placed = false;
  for (const layer of layers) {
    const n = sampleInt(layer.height ?? 1, random);
    const state = sampleStateProvider(ctx, layer.provider, random, x, cy, z) ?? safeState(ctx, 'air');
    for (let i = 0; i < n; i++) {
      const py = cy;
      cy += dirY;
      if (allowed && !testPredicate(ctx, allowed, x, py, z)) return placed;
      if (!ctx.mc.isAir(ctx.getBlockState(x, py, z))) return placed;
      ctx.setBlock(x, py, z, state);
      placed = true;
    }
  }
  return placed;
}

export function growSimple(
  ctx: FeatureContext, random: FeatureRandom, x: number, y: number, z: number,
  blockName: string, maxHeight: number,
): boolean {
  const state = safeState(ctx, blockName);
  const h = 1 + random.nextInt(maxHeight);
  let placed = false;
  for (let i = 0; i < h; i++) {
    const py = y + i;
    if (!ctx.mc.isAir(ctx.getBlockState(x, py, z))) break;
    ctx.setBlock(x, py, z, state);
    placed = true;
  }
  return placed;
}
