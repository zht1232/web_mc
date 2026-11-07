// Port of net.minecraft.world.phys.Vec3, net.minecraft.core.Vec3i, BlockPos and AABB.

import { DIRS } from './Direction.js';

export class Vec3i {
  constructor(public x: number, public y: number, public z: number) {}

  static of(x: number, y: number, z: number) { return new Vec3i(x, y, z); }

  offset(dx: number, dy: number, dz: number) { return new Vec3i(this.x + dx, this.y + dy, this.z + dz); }
  offsetDir(dir: number) {
    const s = DIRS[dir];
    return new Vec3i(this.x + s.stepX, this.y + s.stepY, this.z + s.stepZ);
  }
  above(n = 1) { return this.offset(0, n, 0); }
  below(n = 1) { return this.offset(0, -n, 0); }
  north(n = 1) { return this.offset(0, 0, -n); }
  south(n = 1) { return this.offset(0, 0, n); }
  west(n = 1) { return this.offset(-n, 0, 0); }
  east(n = 1) { return this.offset(n, 0, 0); }

  relative(dir: number, n = 1) {
    const s = DIRS[dir];
    return new Vec3i(this.x + s.stepX * n, this.y + s.stepY * n, this.z + s.stepZ * n);
  }

  distSqr(o: Vec3i) { return (this.x - o.x) ** 2 + (this.y - o.y) ** 2 + (this.z - o.z) ** 2; }
  distToCenterSqr(x: number, y: number, z: number) {
    const dx = x - (this.x + 0.5), dy = y - (this.y + 0.5), dz = z - (this.z + 0.5);
    return dx * dx + dy * dy + dz * dz;
  }
  equals(o: Vec3i) { return this.x === o.x && this.y === o.y && this.z === o.z; }
  toImmutable() { return this; }
  mutable() { return new MutableBlockPos(this.x, this.y, this.z); }
  toString() { return `[${this.x}, ${this.y}, ${this.z}]`; }
}

export class BlockPos extends Vec3i {
  static readonly ZERO = new BlockPos(0, 0, 0);
  static of(x: number, y: number, z: number) { return new BlockPos(x, y, z); }
  static containing(x: number, y: number, z: number) { return new BlockPos(Math.floor(x), Math.floor(y), Math.floor(z)); }
  static containingVec(v: Vec3) { return new BlockPos(Math.floor(v.x), Math.floor(v.y), Math.floor(v.z)); }
  static min(a: BlockPos, b: BlockPos) { return new BlockPos(Math.min(a.x, b.x), Math.min(a.y, b.y), Math.min(a.z, b.z)); }
  static max(a: BlockPos, b: BlockPos) { return new BlockPos(Math.max(a.x, b.x), Math.max(a.y, b.y), Math.max(a.z, b.z)); }

  asLong(): number { return posKey(this.x, this.y, this.z); }
  toShortString() { return `${this.x}, ${this.y}, ${this.z}`; }
}

export class MutableBlockPos extends BlockPos {
  set(x: number, y: number, z: number) { this.x = x; this.y = y; this.z = z; return this; }
  setX(x: number) { this.x = x; return this; }
  setY(y: number) { this.y = y; return this; }
  setZ(z: number) { this.z = z; return this; }
  move(dir: number, n: number) {
    const s = DIRS[dir];
    this.x += s.stepX * n; this.y += s.stepY * n; this.z += s.stepZ * n;
    return this;
  }
  setWithOffset(p: Vec3i, o: Vec3i) { this.x = p.x + o.x; this.y = p.y + o.y; this.z = p.z + o.z; return this; }
}

/**
 * Packs a block position into a number usable as a Map key.
 * 19 bits per horizontal axis and 12 bits of height keeps this below 2^53.
 */
export function posKey(x: number, y: number, z: number): number {
  return ((x + 262144) * 524288 + (z + 262144)) * 4096 + (y + 64);
}

export function chunkKey(cx: number, cz: number): number {
  return (cx + 32768) * 65536 + (cz + 32768);
}

export function sectionKey(sx: number, sy: number, sz: number): number {
  return ((sx + 32768) * 65536 + (sz + 32768)) * 128 + (sy + 32);
}

export class Vec3 {
  constructor(public x: number, public y: number, public z: number) {}

  static of(x: number, y: number, z: number) { return new Vec3(x, y, z); }
  static ZERO = new Vec3(0, 0, 0);

  add(x: number, y: number, z: number) { return new Vec3(this.x + x, this.y + y, this.z + z); }
  addVec(v: Vec3) { return new Vec3(this.x + v.x, this.y + v.y, this.z + v.z); }
  subtract(x: number, y: number, z: number) { return new Vec3(this.x - x, this.y - y, this.z - z); }
  subtractVec(v: Vec3) { return new Vec3(this.x - v.x, this.y - v.y, this.z - v.z); }
  scale(s: number) { return new Vec3(this.x * s, this.y * s, this.z * s); }
  reverse() { return new Vec3(-this.x, -this.y, -this.z); }
  normalize() {
    const l = Math.sqrt(this.x * this.x + this.y * this.y + this.z * this.z);
    return l < 1e-4 ? Vec3.ZERO : new Vec3(this.x / l, this.y / l, this.z / l);
  }
  length() { return Math.sqrt(this.x * this.x + this.y * this.y + this.z * this.z); }
  lengthSqr() { return this.x * this.x + this.y * this.y + this.z * this.z; }
  distanceToSqr(v: Vec3) { const dx = this.x - v.x, dy = this.y - v.y, dz = this.z - v.z; return dx * dx + dy * dy + dz * dz; }
  dot(v: Vec3) { return this.x * v.x + this.y * v.y + this.z * v.z; }
  cross(v: Vec3) { return new Vec3(this.y * v.z - this.z * v.y, this.z * v.x - this.x * v.z, this.x * v.y - this.y * v.x); }
  horizontalDistance() { return Math.sqrt(this.x * this.x + this.z * this.z); }
  horizontalDistanceSqr() { return this.x * this.x + this.z * this.z; }
  lerp(v: Vec3, t: number) { return new Vec3(this.x + (v.x - this.x) * t, this.y + (v.y - this.y) * t, this.z + (v.z - this.z) * t); }
  xRot(pitch: number) {
    const c = Math.cos(pitch), s = Math.sin(pitch);
    return new Vec3(this.x, this.y * c - this.z * s, this.y * s + this.z * c);
  }
  yRot(yaw: number) {
    const c = Math.cos(yaw), s = Math.sin(yaw);
    return new Vec3(this.x * c + this.z * s, this.y, this.z * c - this.x * s);
  }
  zRot(roll: number) {
    const c = Math.cos(roll), s = Math.sin(roll);
    return new Vec3(this.x * c + this.y * s, this.y * c - this.x * s, this.z);
  }
  /** vanilla Vec3.closerThan */
  closerThan(v: Vec3, dist: number) { return this.distanceToSqr(v) < dist * dist; }
  align(axis: number) { return new Vec3(axis === 0 ? Math.floor(this.x) : this.x, axis === 1 ? Math.floor(this.y) : this.y, axis === 2 ? Math.floor(this.z) : this.z); }
  toString() { return `(${this.x}, ${this.y}, ${this.z})`; }
}

/** Port of net.minecraft.world.phys.AABB. */
export class AABB {
  constructor(
    public minX: number, public minY: number, public minZ: number,
    public maxX: number, public maxY: number, public maxZ: number,
  ) {}

  static of(minX: number, minY: number, minZ: number, maxX: number, maxY: number, maxZ: number) {
    return new AABB(minX, minY, minZ, maxX, maxY, maxZ);
  }
  static fromCorners(a: Vec3, b: Vec3) {
    return new AABB(Math.min(a.x, b.x), Math.min(a.y, b.y), Math.min(a.z, b.z), Math.max(a.x, b.x), Math.max(a.y, b.y), Math.max(a.z, b.z));
  }
  static unitCubeAt(x: number, y: number, z: number) { return new AABB(x, y, z, x + 1, y + 1, z + 1); }
  static INFINITE = new AABB(-Infinity, -Infinity, -Infinity, Infinity, Infinity, Infinity);

  set(minX: number, minY: number, minZ: number, maxX: number, maxY: number, maxZ: number) {
    this.minX = minX; this.minY = minY; this.minZ = minZ;
    this.maxX = maxX; this.maxY = maxY; this.maxZ = maxZ;
    return this;
  }
  setFrom(o: AABB) { return this.set(o.minX, o.minY, o.minZ, o.maxX, o.maxY, o.maxZ); }

  expandTowards(x: number, y: number, z: number) {
    let { minX, minY, minZ, maxX, maxY, maxZ } = this;
    if (x < 0) minX += x; else if (x > 0) maxX += x;
    if (y < 0) minY += y; else if (y > 0) maxY += y;
    if (z < 0) minZ += z; else if (z > 0) maxZ += z;
    return new AABB(minX, minY, minZ, maxX, maxY, maxZ);
  }
  inflate(x: number, y: number, z: number) {
    return new AABB(this.minX - x, this.minY - y, this.minZ - z, this.maxX + x, this.maxY + y, this.maxZ + z);
  }
  inflateAll(v: number) { return this.inflate(v, v, v); }
  deflate(v: number) { return this.inflate(-v, -v, -v); }
  contract(x: number, y: number, z: number) { return this.inflate(-x, -y, -z); }

  move(x: number, y: number, z: number) {
    return new AABB(this.minX + x, this.minY + y, this.minZ + z, this.maxX + x, this.maxY + y, this.maxZ + z);
  }
  moveVec(v: Vec3) { return this.move(v.x, v.y, v.z); }

  intersects(o: AABB) {
    return this.maxX > o.minX && this.minX < o.maxX && this.maxY > o.minY && this.minY < o.maxY && this.maxZ > o.minZ && this.minZ < o.maxZ;
  }
  intersectsXYZ(x0: number, y0: number, z0: number, x1: number, y1: number, z1: number) {
    return this.maxX > x0 && this.minX < x1 && this.maxY > y0 && this.minY < y1 && this.maxZ > z0 && this.minZ < z1;
  }

  /** vanilla AABB.clip: slab test, returns the hit point or null. */
  clip(from: Vec3, to: Vec3): Vec3 | null {
    const dx = to.x - from.x, dy = to.y - from.y, dz = to.z - from.z;
    let tmin = 0, tmax = 1;

    const clipAxis = (start: number, dir: number, min: number, max: number): number | null => {
      if (Math.abs(dir) < 1e-7) return start >= min && start <= max ? Infinity : null;
      let t1 = (min - start) / dir;
      let t2 = (max - start) / dir;
      if (t1 > t2) { const tmp = t1; t1 = t2; t2 = tmp; }
      if (t1 > tmin) tmin = t1;
      if (t2 < tmax) tmax = t2;
      return tmax >= tmin ? Infinity : null;
    };

    if (clipAxis(from.x, dx, this.minX, this.maxX) === null) return null;
    if (clipAxis(from.y, dy, this.minY, this.maxY) === null) return null;
    if (clipAxis(from.z, dz, this.minZ, this.maxZ) === null) return null;
    if (tmin === Infinity) return null;
    return new Vec3(from.x + dx * tmin, from.y + dy * tmin, from.z + dz * tmin);
  }

  contains(p: Vec3 | Vec3i) {
    return p.x >= this.minX && p.x < this.maxX && p.y >= this.minY && p.y < this.maxY && p.z >= this.minZ && p.z < this.maxZ;
  }
  containsXYZ(x: number, y: number, z: number) {
    return x >= this.minX && x < this.maxX && y >= this.minY && y < this.maxY && z >= this.minZ && z < this.maxZ;
  }
  containsY(y: number) { return y >= this.minY && y < this.maxY; }

  getXSize() { return this.maxX - this.minX; }
  getYSize() { return this.maxY - this.minY; }
  getZSize() { return this.maxZ - this.minZ; }
  getCenter() { return new Vec3((this.minX + this.maxX) / 2, (this.minY + this.maxY) / 2, (this.minZ + this.maxZ) / 2); }
  getMinPosition() { return new Vec3(this.minX, this.minY, this.minZ); }
  getMaxPosition() { return new Vec3(this.maxX, this.maxY, this.maxZ); }

  shrink(x: number, y: number, z: number) {
    const dx = x < 0 ? x : 0, dy = y < 0 ? y : 0, dz = z < 0 ? z : 0;
    const ex = x > 0 ? x : 0, ey = y > 0 ? y : 0, ez = z > 0 ? z : 0;
    return new AABB(this.minX - dx, this.minY - dy, this.minZ - dz, this.maxX - ex, this.maxY - ey, this.maxZ - ez);
  }

  /** vanilla AABB.getDirection(BlockPos, double) - the face the entity would collide with */
  getDirection(pos: BlockPos, maxDist: number): number {
    const cx = pos.x + 0.5, cy = pos.y + 0.5, cz = pos.z + 0.5;
    const dx = cx - nearest(cx, this.minX, this.maxX);
    const dy = cy - nearest(cy, this.minY, this.maxY);
    const dz = cz - nearest(cz, this.minZ, this.maxZ);
    if (Math.abs(dx) < maxDist && Math.abs(dy) < maxDist && Math.abs(dz) < maxDist) {
      if (Math.abs(dx) > Math.abs(dy) && Math.abs(dx) > Math.abs(dz)) return dx > 0 ? 5 : 4;
      if (Math.abs(dz) > Math.abs(dy)) return dz > 0 ? 3 : 2;
      return dy > 0 ? 1 : 0;
    }
    return 0;
  }

  toString() { return `AABB[${this.minX}, ${this.minY}, ${this.minZ}] -> [${this.maxX}, ${this.maxY}, ${this.maxZ}]`; }
}

/**
 * vanilla nearest, but returning the projection of v onto [min, max]:
 * AABB.getDirection relies on the distance to the closest point of the interval.
 */
function nearest(v: number, min: number, max: number): number {
  return v < min ? min : v > max ? max : v;
}
