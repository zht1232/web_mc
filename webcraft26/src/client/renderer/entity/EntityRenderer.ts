// Source: net.minecraft.client.renderer.entity.EntityRenderer<T>
//
// Base renderer. Subclasses only supply the baked model, the texture key and a
// per-entity tint; append() performs the shared transform (partial-tick
// position interpolation, vanilla yaw rotation, optional limb swing and an
// optional X rotation for projectiles) and writes into the shared batch.
//
// Zero allocation in the render loop: all vertex writes go through
// EntityBatch.push, which reuses pre-allocated typed arrays.

import type { Entity } from '../../../vanilla/world/entity/Entity.js';
import type { BakedModel } from './model/ModelBox.js';

const DEG = Math.PI / 180;
const FLOATS_PER_VERTEX = 8;

/** A set of per-texture growable buffers; concatenated into one VBO at draw time. */
export class EntityBatch {
  readonly buckets: Float32Array[];
  /** float count per bucket (always a multiple of 8) */
  readonly lengths: Int32Array;

  constructor(texCount: number) {
    this.buckets = new Array(texCount);
    for (let i = 0; i < texCount; i++) this.buckets[i] = new Float32Array(256 * FLOATS_PER_VERTEX);
    this.lengths = new Int32Array(texCount);
  }

  reset(): void { this.lengths.fill(0); }

  private ensure(texId: number, extraFloats: number): void {
    const need = this.lengths[texId] + extraFloats;
    const arr = this.buckets[texId];
    if (need <= arr.length) return;
    let cap = arr.length;
    while (cap < need) cap *= 2;
    const grown = new Float32Array(cap);
    grown.set(arr);
    this.buckets[texId] = grown;
  }

  push(texId: number, x: number, y: number, z: number, u: number, v: number, r: number, g: number, b: number): void {
    this.ensure(texId, FLOATS_PER_VERTEX);
    const arr = this.buckets[texId];
    let o = this.lengths[texId];
    arr[o] = x; arr[o + 1] = y; arr[o + 2] = z;
    arr[o + 3] = u; arr[o + 4] = v;
    arr[o + 5] = r; arr[o + 6] = g; arr[o + 7] = b;
    this.lengths[texId] = o + FLOATS_PER_VERTEX;
  }
}

export abstract class EntityRenderer<T extends Entity = Entity> {
  abstract getModel(e: T): BakedModel;
  abstract getTextureKey(e: T): string;
  abstract getTint(e: T): readonly [number, number, number];

  /** Extra rotation about X (radians), e.g. arrow pitch. Default 0. */
  getRotX(_e: T): number { return 0; }

  append(e: T, batch: EntityBatch, texId: number, partialTick: number): void {
    const model = this.getModel(e);
    const tint = this.getTint(e);
    const rx = e.xo + (e.x - e.xo) * partialTick;
    const ry = e.yo + (e.y - e.yo) * partialTick;
    const rz = e.zo + (e.z - e.zo) * partialTick;
    const sc = e.scale;

    // vanilla LivingEntityRenderer.setupRotations: RotY(180 - yRot)
    const yawRad = (180 - e.yaw) * DEG;
    const cy = Math.cos(yawRad), sy = Math.sin(yawRad);
    const rotX = this.getRotX(e);
    const cx = rotX !== 0 ? Math.cos(rotX) : 1;
    const sx = rotX !== 0 ? Math.sin(rotX) : 0;
    const swing = e.animSwing;

    for (let pi = 0; pi < model.parts.length; pi++) {
      const part = model.parts[pi];
      let cs = 1, sn = 0;
      if (part.swing !== 0) {
        const a = swing * part.swing;
        cs = Math.cos(a); sn = Math.sin(a);
      }
      const px = part.pivot[0] * sc, py = part.pivot[1] * sc, pz = part.pivot[2] * sc;
      const verts = part.vertices;
      for (let i = 0; i < verts.length; i += FLOATS_PER_VERTEX) {
        let vx = verts[i] * sc, vy = verts[i + 1] * sc, vz = verts[i + 2] * sc;
        // limb swing about the part pivot (X axis)
        if (part.swing !== 0) {
          const dy = vy - py, dz = vz - pz;
          vy = py + dy * cs - dz * sn;
          vz = pz + dy * sn + dz * cs;
        }
        // projectile pitch about X
        if (rotX !== 0) {
          const ny = vy * cx - vz * sx;
          const nz = vy * sx + vz * cx;
          vy = ny; vz = nz;
        }
        // entity yaw about Y
        const wx = cy * vx + sy * vz;
        const wz = -sy * vx + cy * vz;
        batch.push(
          texId, rx + wx, ry + vy, rz + wz,
          verts[i + 3], verts[i + 4],
          verts[i + 5] * tint[0], verts[i + 6] * tint[1], verts[i + 7] * tint[2],
        );
      }
    }
  }
}
