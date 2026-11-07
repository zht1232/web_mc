// Source: net.minecraft.world.entity.ai.navigation.PathNavigation
//
// A* pathfinder with a typed-array binary open heap (lazy decrease-key) and a
// fixed node pool. Everything is pre-allocated: findPath() only fills/reset
// typed arrays, so a path search allocates zero objects. Node identity uses an
// open-addressed hash table keyed by the exact packed block position.

import { posKey } from '../../../../core/Geometry.js';
import type { ClientLevel } from '../../../level/ClientLevel.js';
import { NodeEvaluator, type PathMob, type PathNode } from './NodeEvaluator.js';

const NODE_CAP = 1024;
const HASH_CAP = 2048;
const HEAP_CAP = 4096;
const MAX_VISITED = 160;

export interface Path { size(): number; }

export class PathNavigation {
  readonly mob: PathMob;
  readonly level: ClientLevel;
  nodeEvaluator: NodeEvaluator;

  protected speedModifier = 1;
  protected targetX = 0; protected targetY = 0; protected targetZ = 0;
  protected hasDirect = false;
  protected pathLen = 0;
  protected pathIndex = 0;
  protected pathX = new Int32Array(NODE_CAP);
  protected pathY = new Int32Array(NODE_CAP);
  protected pathZ = new Int32Array(NODE_CAP);

  // A* node pool
  private readonly nodeX = new Int32Array(NODE_CAP);
  private readonly nodeY = new Int32Array(NODE_CAP);
  private readonly nodeZ = new Int32Array(NODE_CAP);
  private readonly nodeG = new Float32Array(NODE_CAP);
  private readonly nodeH = new Float32Array(NODE_CAP);
  private readonly nodeF = new Float32Array(NODE_CAP);
  private readonly nodeParent = new Int32Array(NODE_CAP);
  private readonly nodeClosed = new Uint8Array(NODE_CAP);
  private readonly nodeKey = new Float64Array(NODE_CAP);
  private readonly hashTable = new Int32Array(HASH_CAP);
  private readonly heap = new Int32Array(HEAP_CAP);
  private heapSize = 0;
  private nodeCount = 0;

  // neighbour scratch
  private readonly nbX = new Int32Array(8);
  private readonly nbY = new Int32Array(8);
  private readonly nbZ = new Int32Array(8);
  private readonly nbCost = new Float32Array(8);

  private goalX = 0; private goalY = 0; private goalZ = 0;

  constructor(mob: PathMob, level: ClientLevel, nodeEvaluator: NodeEvaluator) {
    this.mob = mob;
    this.level = level;
    this.nodeEvaluator = nodeEvaluator;
  }

  // ---- public API ---------------------------------------------------------

  moveTo(x: number, y: number, z: number, speed: number): boolean {
    this.speedModifier = speed;
    this.targetX = x; this.targetY = y; this.targetZ = z;
    this.hasDirect = true;
    this.nodeEvaluator.prepare(this.level, this.mob);
    const start = this.nodeEvaluator.getStart();
    return this.findPath(start.x, start.y, start.z, Math.floor(x), Math.floor(y), Math.floor(z), 1);
  }

  moveToEntity(target: { getX(): number; getY(): number; getZ(): number }, speed: number): boolean {
    return this.moveTo(target.getX(), target.getY(), target.getZ(), speed);
  }

  /** Vanilla PathNavigation.createPath; returns true when a (possibly partial) path exists. */
  createPath(x: number, y: number, z: number, _reachRange = 1): boolean {
    this.nodeEvaluator.prepare(this.level, this.mob);
    const start = this.nodeEvaluator.getStart();
    return this.findPath(start.x, start.y, start.z, Math.floor(x), Math.floor(y), Math.floor(z), 1);
  }

  stop(): void {
    this.hasDirect = false;
    this.pathLen = 0;
    this.pathIndex = 0;
    this.speedModifier = 1;
  }

  isDone(): boolean {
    if (!this.hasDirect) return true;
    return this.distanceToTargetSqr() < 1.44;
  }

  hasActivePath(): boolean { return this.hasDirect && this.pathLen > 0; }

  canFloat(): boolean { return false; }
  getMaxDistanceToWaypoint(): number { return 0.5; }

  /**
   * Vanilla PathNavigation.tick: advance along the path. Steering itself is
   * performed by the active AI goal (which sets the MoveControl), so ticking
   * here only consumes reached waypoints and allocates nothing.
   */
  tick(): void {
    if (!this.hasDirect || this.pathLen === 0) return;
    while (this.pathIndex < this.pathLen - 1) {
      const wx = this.pathX[this.pathIndex] + 0.5;
      const wz = this.pathZ[this.pathIndex] + 0.5;
      const dx = wx - this.mob.getX(), dz = wz - this.mob.getZ();
      if (dx * dx + dz * dz < 0.64) this.pathIndex++;
      else break;
    }
  }

  getSpeedModifier(): number { return this.speedModifier; }
  getTargetX(): number { return this.targetX; }
  getTargetY(): number { return this.targetY; }
  getTargetZ(): number { return this.targetZ; }

  private distanceToTargetSqr(): number {
    const dx = this.mob.getX() - this.targetX;
    const dy = this.mob.getY() - this.targetY;
    const dz = this.mob.getZ() - this.targetZ;
    return dx * dx + dy * dy + dz * dz;
  }

  // ---- A* -----------------------------------------------------------------

  protected findPath(sx: number, sy: number, sz: number, tx: number, ty: number, tz: number, reachRange: number): boolean {
    this.goalX = tx; this.goalY = ty; this.goalZ = tz;
    this.nodeCount = 0;
    this.heapSize = 0;
    this.hashTable.fill(0);
    this.nodeEvaluator.prepare(this.level, this.mob);

    const start = this.getOrCreateNode(sx, sy, sz);
    if (start < 0) { this.pathLen = 0; return false; }
    this.nodeG[start] = 0;
    this.nodeH[start] = this.heuristic(sx, sy, sz);
    this.nodeF[start] = this.nodeH[start];
    this.nodeParent[start] = -1;
    this.heapPush(start);

    let best = start;
    let bestH = this.nodeH[start];
    let visited = 0;

    while (this.heapSize > 0 && visited < MAX_VISITED) {
      const cur = this.heapPop();
      if (this.nodeClosed[cur]) continue;
      this.nodeClosed[cur] = 1;
      visited++;

      const cx = this.nodeX[cur], cy = this.nodeY[cur], cz = this.nodeZ[cur];
      const h = this.nodeH[cur];
      if (h < bestH) { bestH = h; best = cur; }
      if (h <= reachRange) { this.reconstruct(cur); return true; }

      const n = this.nodeEvaluator.getNeighbors({ x: cx, y: cy, z: cz }, this.nbX, this.nbY, this.nbZ, this.nbCost);
      for (let i = 0; i < n; i++) {
        const nx = this.nbX[i], ny = this.nbY[i], nz = this.nbZ[i];
        const ni = this.getOrCreateNode(nx, ny, nz);
        if (ni < 0 || this.nodeClosed[ni]) continue;
        const tentative = this.nodeG[cur] + this.nbCost[i];
        if (tentative < this.nodeG[ni]) {
          this.nodeG[ni] = tentative;
          this.nodeParent[ni] = cur;
          this.nodeH[ni] = this.heuristic(nx, ny, nz);
          this.nodeF[ni] = tentative + this.nodeH[ni];
          this.heapPush(ni);
        }
      }
    }
    this.reconstruct(best);
    return this.pathLen > 1;
  }

  private reconstruct(end: number): void {
    let n = 0, cur = end;
    while (cur >= 0 && n < NODE_CAP) {
      this.pathX[n] = this.nodeX[cur];
      this.pathY[n] = this.nodeY[cur];
      this.pathZ[n] = this.nodeZ[cur];
      n++;
      cur = this.nodeParent[cur];
    }
    // reverse start<->goal
    for (let i = 0; i < (n >> 1); i++) {
      const j = n - 1 - i;
      let t = this.pathX[i]; this.pathX[i] = this.pathX[j]; this.pathX[j] = t;
      t = this.pathY[i]; this.pathY[i] = this.pathY[j]; this.pathY[j] = t;
      t = this.pathZ[i]; this.pathZ[i] = this.pathZ[j]; this.pathZ[j] = t;
    }
    this.pathLen = n;
    this.pathIndex = 0;
  }

  private heuristic(x: number, y: number, z: number): number {
    const dx = x - this.goalX, dy = y - this.goalY, dz = z - this.goalZ;
    // Weighted (slightly greedy) A* so few nodes are expanded on open terrain.
    return (Math.hypot(dx, dz) + Math.abs(dy) * 1.4) * 1.4;
  }

  private hash(x: number, y: number, z: number): number {
    return (Math.imul(x, 73856093) ^ Math.imul(y, 19349663) ^ Math.imul(z, 83492791)) & (HASH_CAP - 1);
  }

  private getOrCreateNode(x: number, y: number, z: number): number {
    const key = posKey(x, y, z);
    let slot = this.hash(x, y, z);
    while (this.hashTable[slot] !== 0) {
      const idx = this.hashTable[slot] - 1;
      if (this.nodeKey[idx] === key) return idx;
      slot = (slot + 1) & (HASH_CAP - 1);
    }
    if (this.nodeCount >= NODE_CAP) return -1;
    const idx = this.nodeCount++;
    this.nodeX[idx] = x; this.nodeY[idx] = y; this.nodeZ[idx] = z;
    this.nodeKey[idx] = key;
    this.nodeG[idx] = Infinity; this.nodeH[idx] = 0; this.nodeF[idx] = Infinity;
    this.nodeParent[idx] = -1; this.nodeClosed[idx] = 0;
    this.hashTable[slot] = idx + 1;
    return idx;
  }

  private heapCmp(a: number, b: number): number {
    const ia = this.heap[a], ib = this.heap[b];
    const fa = this.nodeF[ia], fb = this.nodeF[ib];
    if (fa !== fb) return fa - fb;
    return this.nodeH[ia] - this.nodeH[ib];
  }

  private heapPush(idx: number): void {
    if (this.heapSize >= HEAP_CAP) return;
    let i = this.heapSize++;
    this.heap[i] = idx;
    while (i > 0) {
      const p = (i - 1) >> 1;
      if (this.heapCmp(i, p) >= 0) break;
      const t = this.heap[p]; this.heap[p] = this.heap[i]; this.heap[i] = t;
      i = p;
    }
  }

  private heapPop(): number {
    const top = this.heap[0];
    this.heapSize--;
    if (this.heapSize > 0) {
      this.heap[0] = this.heap[this.heapSize];
      let i = 0;
      for (;;) {
        const l = i * 2 + 1, r = l + 1;
        let s = i;
        if (l < this.heapSize && this.heapCmp(l, s) < 0) s = l;
        if (r < this.heapSize && this.heapCmp(r, s) < 0) s = r;
        if (s === i) break;
        const t = this.heap[s]; this.heap[s] = this.heap[i]; this.heap[i] = t;
        i = s;
      }
    }
    return top;
  }
}

// re-export for convenience
export type { PathNode };
