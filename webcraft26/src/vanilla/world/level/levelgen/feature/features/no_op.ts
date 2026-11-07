// Port of net.minecraft.world.level.levelgen.feature.NoOpFeature (and the fallback for any
// configured feature type that is not ported - nether/end/structure features, fossils, geodes,
// icebergs, etc.). Returning false means "placed nothing", which is deterministic and safe.

import type { Cfg, FeatureApi, FeatureContext } from '../FeaturePlacer.js';
import type { FeatureRandom } from '../WorldgenRandom.js';

export function place(
  _ctx: FeatureContext, _config: Cfg, _random: FeatureRandom,
  _x: number, _y: number, _z: number, _api: FeatureApi,
): boolean { return false; }
