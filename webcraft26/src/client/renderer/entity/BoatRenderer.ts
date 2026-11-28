// Source: net.minecraft.client.renderer.entity.AbstractBoatRenderer /
//         BoatRenderer (26.2)
//
// The boat model is anchored 0.375 above the entity position; the transform is
// T(pos) * RY(180 - yaw) * S(-1,-1,1) * RY(90), and the paddles are animated
// from AbstractBoat.getRowingTime (see EntityModels.animateBoat).

import { EntityRenderer, boatRootMatrix } from './EntityRenderer.js';
import { BoatModel, ChestBoatModel } from './model/EntityModels.js';
import type { BakedModel } from './model/ModelBox.js';
import type { Entity } from '../../../vanilla/world/entity/Entity.js';
import type { Boat } from '../../../vanilla/world/entity/vehicle/Boat.js';

const WHITE: readonly [number, number, number] = [1, 1, 1];

/** Mth.rotLerp: shortest-arc interpolation between two yaw angles. */
function rotLerp(partial: number, from: number, to: number): number {
  let delta = (to - from) % 360;
  if (delta >= 180) delta -= 360;
  if (delta < -180) delta += 360;
  return from + delta * partial;
}

export class BoatRenderer extends EntityRenderer<Entity> {
  getModel(e: Entity): BakedModel {
    return (e as Boat).isChest() ? ChestBoatModel : BoatModel;
  }

  getTextureKey(e: Entity): string {
    const kind = (e as Boat).kind;
    const wood = kind.replace(/(_chest_boat|_chest_raft|_boat|_raft)$/, '');
    return kind.includes('chest') ? `chest_boat/${wood}` : `boat/${wood}`;
  }

  getTint(): readonly [number, number, number] { return WHITE; }

  /** AbstractBoatRenderer constructor: shadowRadius 0.8. */
  override getShadowRadius(): number { return 0.8; }

  protected override rootMatrix(e: Entity, partialTick: number, out: Float64Array): void {
    const x = e.xo + (e.x - e.xo) * partialTick;
    const y = e.yo + (e.y - e.yo) * partialTick;
    const z = e.zo + (e.z - e.zo) * partialTick;
    const yaw = rotLerp(partialTick, e.yRotO, e.yaw);
    boatRootMatrix(out, x, y, z, yaw);
  }
}
