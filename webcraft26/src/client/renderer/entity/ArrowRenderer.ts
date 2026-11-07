// Source: net.minecraft.client.renderer.entity.ArrowRenderer
//
// An arrow is a thin box oriented by its velocity: EntityRenderer applies the
// yaw rotation, and this renderer adds the pitch rotation about X.

import { EntityRenderer } from './EntityRenderer.js';
import { ArrowModel } from './model/EntityModels.js';
import { WHITE_TEXTURE } from './model/ModelRegistry.js';
import type { BakedModel } from './model/ModelBox.js';
import type { Entity } from '../../../vanilla/world/entity/Entity.js';

const DEG = Math.PI / 180;

export class ArrowRenderer extends EntityRenderer<Entity> {
  private readonly tint: readonly [number, number, number] = [0.55, 0.42, 0.22];

  getModel(): BakedModel { return ArrowModel; }
  getTextureKey(): string { return WHITE_TEXTURE; }
  getTint(): readonly [number, number, number] { return this.tint; }

  getRotX(e: Entity): number { return e.pitch * DEG; }
}
