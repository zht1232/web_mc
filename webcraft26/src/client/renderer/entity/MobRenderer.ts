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

export class MobRenderer extends EntityRenderer<Entity> {
  private readonly tint: readonly [number, number, number] = [1, 1, 1];
  private readonly entry: ModelEntry;

  constructor(private readonly typeName: string) {
    super();
    this.entry = MODEL_REGISTRY[typeName];
  }

  getModel(): BakedModel { return this.entry.model; }
  getTextureKey(): string { return this.entry.texture; }
  getTint(): readonly [number, number, number] { return this.tint; }

  /** Source: CreeperRenderer.scale — swelling inflates the model. */
  getExtraScale(e: Entity, out: Float64Array): void {
    if (this.typeName !== 'creeper') { out[0] = 1; out[1] = 1; out[2] = 1; return; }
    let g = (e as Mob).swell;
    if (!(g > 0)) { out[0] = 1; out[1] = 1; out[2] = 1; return; }
    const wobble = 1 + Math.sin(g * 100) * g * 0.01;
    g = Math.min(1, g);
    g = g * g;
    g = g * g;
    const s = (1 + g * 0.4) * wobble;
    const hs = (1 + g * 0.1) / wobble;
    out[0] = s; out[1] = hs; out[2] = s;
  }

  /** Source: CreeperRenderer.getWhiteOverlayProgress — flashing white while swelling. */
  getWhiteOverlay(e: Entity): number {
    if (this.typeName !== 'creeper') return 0;
    const step = (e as Mob).swell;
    if (!(step > 0)) return 0;
    return Math.floor(step * 10) % 2 === 0 ? 0 : Math.min(1, Math.max(0.5, step));
  }
}
