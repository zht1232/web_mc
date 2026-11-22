// Source: net.minecraft.client.renderer.entity.AbstractMinecartRenderer /
//         MinecartRenderer (26.2, new minecart movement)
//
// The cart model is anchored 0.375 blocks above the entity position and drawn
// with the vanilla new-render transform: RY(yaw) * RZ(-pitch).

import { EntityRenderer, vehicleRootMatrix } from './EntityRenderer.js';
import { MinecartModel } from './model/EntityModels.js';
import type { BakedModel } from './model/ModelBox.js';
import type { Entity } from '../../../vanilla/world/entity/Entity.js';

const DEG = Math.PI / 180;
const WHITE: readonly [number, number, number] = [1, 1, 1];

export class MinecartRenderer extends EntityRenderer<Entity> {
  getModel(): BakedModel { return MinecartModel; }
  getTextureKey(): string { return 'minecart/minecart'; }
  getTint(): readonly [number, number, number] { return WHITE; }

  /** AbstractMinecartRenderer: shadow radius 0.7. */
  override getShadowRadius(): number { return 0.7; }

  protected override rootMatrix(e: Entity, partialTick: number, out: Float64Array): void {
    const x = e.xo + (e.x - e.xo) * partialTick;
    const y = e.yo + (e.y - e.yo) * partialTick;
    const z = e.zo + (e.z - e.zo) * partialTick;
    vehicleRootMatrix(out, x, y, z, e.yaw * DEG, e.pitch * DEG, 0.375);
  }
}
