// Source: net.minecraft.world.level.pathfinder.WalkNodeEvaluator
//
// Generates the walkable neighbours of a node: 4 cardinal + 4 diagonal moves,
// one-block step-ups (jump) and drops of up to 3 blocks. Diagonal moves are
// only allowed when both orthogonal corner blocks are clear.

import { NodeEvaluator, type PathNode } from './NodeEvaluator.js';

const DIRS_X = new Int32Array([1, -1, 0, 0, 1, 1, -1, -1]);
const DIRS_Z = new Int32Array([0, 0, 1, -1, 1, -1, 1, -1]);
const DIAGONAL = new Uint8Array([0, 0, 0, 0, 1, 1, 1, 1]);

export class WalkNodeEvaluator extends NodeEvaluator {
  getStart(): PathNode {
    const x = Math.floor(this.mob.getX());
    const z = Math.floor(this.mob.getZ());
    let y = Math.floor(this.mob.getY());
    // settle onto the nearest standable height
    if (!this.isGround(x, y, z)) {
      for (let d = 1; d <= 3; d++) {
        if (this.isGround(x, y - d, z)) { y -= d; break; }
        if (this.isGround(x, y + d, z)) { y += d; break; }
      }
    }
    return { x, y, z };
  }

  getNeighbors(
    cur: PathNode,
    outX: Int32Array, outY: Int32Array, outZ: Int32Array, outCost: Float32Array,
  ): number {
    let n = 0;
    for (let i = 0; i < 8; i++) {
      const dx = DIRS_X[i], dz = DIRS_Z[i];
      const nx = cur.x + dx, nz = cur.z + dz;
      const cost = DIAGONAL[i] ? 1.414 : 1.0;

      // diagonal corner clipping (vanilla WalkNodeEvaluator)
      if (DIAGONAL[i]) {
        if (this.hasCollision(cur.x + dx, cur.y, cur.z) || this.hasCollision(cur.x, cur.y, cur.z + dz)) continue;
      }

      // same-level step
      if (this.isPassable(nx, cur.y, nz) && this.isGround(nx, cur.y, nz)) {
        outX[n] = nx; outY[n] = cur.y; outZ[n] = nz; outCost[n] = cost; n++;
        continue;
      }
      // one-block step up (mob can jump 1)
      if (this.isPassable(nx, cur.y + 1, nz) && this.isGround(nx, cur.y + 1, nz)) {
        outX[n] = nx; outY[n] = cur.y + 1; outZ[n] = nz; outCost[n] = cost + 0.35; n++;
        continue;
      }
      // drop of 1..3 blocks
      for (let drop = 1; drop <= 3; drop++) {
        const ny = cur.y - drop;
        if (this.isPassable(nx, ny, nz) && this.isGround(nx, ny, nz)) {
          outX[n] = nx; outY[n] = ny; outZ[n] = nz; outCost[n] = cost + drop * 0.12; n++;
          break;
        }
      }
    }
    return n;
  }
}
