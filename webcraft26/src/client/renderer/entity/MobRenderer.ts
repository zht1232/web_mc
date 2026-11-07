// Source: net.minecraft.client.renderer.entity.MobRenderer / LivingEntityRenderer
//         + net.minecraft.client.renderer.entity.CreeperRenderer
//
// Resolves a mob's baked model + texture from the registry and renders it with
// the shared transform in EntityRenderer. Mob-specific render state that lives
// in the entity class itself (creeper swelling) is read here.

import { EntityRenderer } from './EntityRenderer.js';
import { MODEL_REGISTRY, type ModelEntry } from './model/ModelRegistry.js';
import type { BakedModel } from './model/ModelBox.js';
import type { Entity } from '../../../vanilla/world/entity/Entity.js';
import type { Mob } from '../../../vanilla/world/entity/Mob.js';

/**
 * Per-type render scale on top of entity.scale.
 *
 * The port stores one `scale` field per entity class, applied by EntityRenderer
 * before the model. For most mobs it is 1, so the vanilla baked mesh renders at
 * vanilla size; for the mobs added in HANDOFF 8.1 it holds a vanilla-ish guess
 * (fox/ocelot 0.8, parrot/cod 0.6, squid 0.8, salmon 0.7) that does NOT match
 * the vanilla sizes. The factors below cancel those guesses and add the vanilla
 * model-layer scale that is missing from the baked geometry (MeshTransformer
 * .scaling). VANILLA_SIZE is what each mob should measure relative to an
 * entity.scale of 1: scale_result = extraScale * entity.scale.
 *
 *   fox/ocelot    extra 1.25  * 0.8 = 1.0  (fox model layer is unscaled; ocelot is unscaled)
 *   parrot        extra 5/3   * 0.6 = 1.0
 *   squid/glow    extra 1.25  * 0.8 = 1.0  (SquidRenderer has no scale)
 *   cod           extra 5/3   * 0.6 = 1.0
 *   salmon        extra 10/7  * 0.7 = 1.0  (medium salmon; the port has no size variants)
 *   witch         extra 0.9375* 1.0 = 0.9375 (ModelLayers.WITCH villagerLikeScale)
 *   cat           no entry   * 0.8 = 0.8  (ModelLayers.CAT CAT_TRANSFORMER 0.8)
 *   cave_spider   no entry   * 0.7 = 0.7  (ModelLayers.CAVE_SPIDER scaling 0.7)
 *   slime         no entry   * 2.0 = 2.0  (AbstractCubeMobRenderer size 2)
 */
const EXTRA_SCALE: Readonly<Record<string, number>> = {
  witch: 0.9375,
  fox: 1.25,
  ocelot: 1.25,
  parrot: 5 / 3,
  squid: 1.25,
  glow_squid: 1.25,
  cod: 5 / 3,
  salmon: 10 / 7,
};

/**
 * Shadow radius in blocks per type, pre-divided by the entity scale because
 * EntityRenderDispatcher multiplies getShadowRadius() by entity.scale. The
 * resulting block radius matches the vanilla renderer constructor shadowRadius:
 *   slime 0.5 (size*0.25 * 2), cave_spider 0.56, fox/cat/ocelot 0.4,
 *   parrot/cod 0.3, squid/glow_squid 0.7, salmon 0.4, witch/zombie_villager 0.5.
 */
const SHADOW_RADIUS: Readonly<Record<string, number>> = {
  slime: 0.25,          // 0.5  * scale 2
  cave_spider: 0.8,     // 0.56 * scale 0.7
  fox: 0.5,             // 0.4  * scale 0.8
  cat: 0.5,
  ocelot: 0.5,
  parrot: 0.5,          // 0.3  * scale 0.6
  squid: 0.875,         // 0.7  * scale 0.8
  glow_squid: 0.875,
  cod: 0.5,             // 0.3  * scale 0.6
  salmon: 0.5714286,    // 0.4  * scale 0.7
};

export class MobRenderer extends EntityRenderer<Entity> {
  private readonly tint: readonly [number, number, number] = [1, 1, 1];
  private readonly entry: ModelEntry;
  private readonly extraScale: number;
  private readonly shadowRadius: number;

  constructor(private readonly typeName: string) {
    super();
    this.entry = MODEL_REGISTRY[typeName];
    this.extraScale = EXTRA_SCALE[typeName] ?? 1;
    this.shadowRadius = SHADOW_RADIUS[typeName] ?? 0.5;
  }

  getModel(): BakedModel { return this.entry.model; }
  getTextureKey(): string { return this.entry.texture; }
  getTint(): readonly [number, number, number] { return this.tint; }

  /** Source: MobRenderer constructor shadowRadius (0.5 for the vanilla overworld mobs). */
  getShadowRadius(): number { return this.shadowRadius; }

  /** Source: CreeperRenderer.scale — swelling inflates the model. */
  getExtraScale(e: Entity, out: Float64Array): void {
    if (this.typeName === 'creeper') {
      let g = (e as Mob).swell;
      if (!(g > 0)) { out[0] = 1; out[1] = 1; out[2] = 1; return; }
      const wobble = 1 + Math.sin(g * 100) * g * 0.01;
      g = Math.min(1, g);
      g = g * g;
      g = g * g;
      const s = (1 + g * 0.4) * wobble;
      const hs = (1 + g * 0.1) / wobble;
      out[0] = s; out[1] = hs; out[2] = s;
      return;
    }
    const extra = this.extraScale;
    out[0] = extra; out[1] = extra; out[2] = extra;
  }

  /** Source: CreeperRenderer.getWhiteOverlayProgress — flashing white while swelling. */
  getWhiteOverlay(e: Entity): number {
    if (this.typeName !== 'creeper') return 0;
    const step = (e as Mob).swell;
    if (!(step > 0)) return 0;
    return Math.floor(step * 10) % 2 === 0 ? 0 : Math.min(1, Math.max(0.5, step));
  }
}
