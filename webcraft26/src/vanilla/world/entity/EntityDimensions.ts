// Source: net.minecraft.world.entity.EntityDimensions
//
// A value object describing the (fixed or scalable) bounding box of an entity.
// The eye height defaults to 85% of the height, exactly as in the Java record.

import { AABB, Vec3 } from '../../core/Geometry.js';

export class EntityDimensions {
  constructor(
    readonly width: number,
    readonly height: number,
    readonly eyeHeight: number = height * 0.85,
    readonly fixed = false,
  ) {}

  static scalable(width: number, height: number): EntityDimensions {
    return new EntityDimensions(width, height, height * 0.85, false);
  }

  static fixed(width: number, height: number): EntityDimensions {
    return new EntityDimensions(width, height, height * 0.85, true);
  }

  makeBoundingBox(pos: Vec3): AABB;
  makeBoundingBox(x: number, y: number, z: number): AABB;
  makeBoundingBox(a: Vec3 | number, y?: number, z?: number): AABB {
    const x = typeof a === 'number' ? a : a.x;
    const py = typeof a === 'number' ? (y as number) : a.y;
    const pz = typeof a === 'number' ? (z as number) : a.z;
    const w = this.width / 2;
    return new AABB(x - w, py, pz - w, x + w, py + this.height, pz + w);
  }

  scale(scaleFactor: number): EntityDimensions;
  scale(widthScale: number, heightScale: number): EntityDimensions;
  scale(ws: number, hs = ws): EntityDimensions {
    if (this.fixed || (ws === 1 && hs === 1)) return this;
    return new EntityDimensions(
      this.width * ws, this.height * hs, this.eyeHeight * hs, false,
    );
  }

  withEyeHeight(eyeHeight: number): EntityDimensions {
    return new EntityDimensions(this.width, this.height, eyeHeight, this.fixed);
  }
}
