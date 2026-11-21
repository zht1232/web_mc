// Source: net.minecraft.world.entity.Entity
//
// Base class for every entity. Holds position / velocity / rotation / AABB /
// dimensions, onGround, liquid state, fire and fall distance, and implements
// a swept per-axis collision against ClientLevel block shapes (the same
// algorithm used by player/Player.ts, but written against scalar fields and a
// reusable typed-array scratch so the tick hot path allocates nothing).
//
// The vanilla tick order is reproduced as: baseTick -> (AI) -> travel -> move.

import { AABB, Vec3 } from '../../core/Geometry.js';
import type { ClientLevel } from '../level/ClientLevel.js';
import type { EntityType } from './EntityType.js';
import { XoroshiroRandomSource, type RandomSource } from '../../core/Random.js';
import { DEG_TO_RAD } from '../../core/Mth.js';

// ---------------------------------------------------------------------------
// Shared interfaces (defined here to avoid circular imports between the AI
// goals, Mob and LivingEntity).
// ---------------------------------------------------------------------------

/** Anything an AI goal can attack / look at (a LivingEntity or the player proxy). */
export interface Targetable {
  x: number; y: number; z: number;
  getX(): number; getY(): number; getZ(): number;
  getTypeName(): string;
  isAlive(): boolean;
  getWidth(): number; getHeight(): number;
  distanceToSqr(x: number, y: number, z: number): number;
  hurt(amount: number, attacker: Targetable | null): void;
}

/** The subset of the world an entity's AI needs, implemented by EntityManager. */
export interface MobWorld {
  readonly level: ClientLevel;
  getPlayer(): Targetable | null;
  /** Local player game mode (survival / creative / spectator) for targeting conditions. */
  getPlayerGameMode?(): string;
  /** Non-empty main-hand + offhand item short names of the local player (TemptGoal). */
  getPlayerHeldItems?(): readonly string[];
  /** Called once when a living entity dies (loot / XP hook). */
  onMobDeath?(e: Entity): void;
  /** AgeableMob in love: the client spawns heart particles around `e`. */
  onAnimalLove?(e: Entity): void;
  /** Two animals bred successfully (Stats.ANIMALS_BRED). */
  onAnimalBred?(e: Entity): void;
  /** An adult chicken laid an egg (Chicken.eggTime). */
  onChickenLayEgg?(e: Entity): void;
  /** A thrown splash/lingering potion broke at (x,y,z); Game applies the area effects. */
  onPotionSplash?(x: number, y: number, z: number, potionId: string, age: number, lingering: boolean): void;
  getEntities(): readonly Entity[];
  getGameTime(): number;
  isDay(): boolean;
  getBrightness(x: number, y: number, z: number): number;
  getSkyDarken(): number;
  spawnEntity(e: Entity): void;
  removeEntity(e: Entity): void;
  /**
   * Explosion hook (net/minecraft/world/level/Explosion): the main game listens
   * for it to damage the local player, break blocks and drop their loot.
   * `interaction` is Level.ExplosionInteraction: mob explosions respect the
   * mobGriefing gamerule, TNT always breaks blocks.
   */
  explode?(x: number, y: number, z: number, power: number, interaction?: 'mob' | 'tnt'): void;
}

export interface DamageSource {
  type: string;
  attacker: Targetable | null;
}

/** A minimal damage source; kept for API parity even though AI passes the attacker directly. */
export function damageSource(type: string, attacker: Targetable | null): DamageSource {
  return { type, attacker };
}

// ---------------------------------------------------------------------------
// Reusable collision scratch (single-threaded tick loop => module scope is safe)
// ---------------------------------------------------------------------------

let SCRATCH = new Float32Array(6 * 256);
let scratchCount = 0;

function ensureScratch(boxes: number): void {
  if (boxes * 6 <= SCRATCH.length) return;
  let n = SCRATCH.length / 6;
  while (n < boxes) n *= 2;
  SCRATCH = new Float32Array(6 * n);
}

/** Fills SCRATCH with world-space collision boxes overlapping the given volume. */
function collectCollision(level: ClientLevel, minX: number, minY: number, minZ: number, maxX: number, maxY: number, maxZ: number): void {
  const mc = level.mc;
  scratchCount = 0;
  const x0 = Math.floor(minX), x1 = Math.floor(maxX);
  const y0 = Math.floor(minY), y1 = Math.floor(maxY);
  const z0 = Math.floor(minZ), z1 = Math.floor(maxZ);
  for (let y = y0; y <= y1; y++) {
    for (let z = z0; z <= z1; z++) {
      for (let x = x0; x <= x1; x++) {
        const state = level.getBlockState(x, y, z);
        if (state === 0) continue;
        const shape = mc.collision(state);
        const n = shape.length;
        if (n === 0) continue;
        ensureScratch(scratchCount + n);
        for (let i = 0; i < n; i++) {
          const b = shape[i];
          const o = scratchCount * 6;
          SCRATCH[o] = b.minX + x; SCRATCH[o + 1] = b.minY + y; SCRATCH[o + 2] = b.minZ + z;
          SCRATCH[o + 3] = b.maxX + x; SCRATCH[o + 4] = b.maxY + y; SCRATCH[o + 5] = b.maxZ + z;
          scratchCount++;
        }
      }
    }
  }
}

const EPS = 1e-5;
const EPS2 = 1e-7;

/** Clips a 1-D movement against a fixed interval, exactly like Entity.move. */
function clipAxis(eMin: number, eMax: number, bMin: number, bMax: number, delta: number): number {
  if (delta > 0 && eMax <= bMin + EPS2) return Math.max(0, Math.min(delta, bMin - eMax));
  if (delta < 0 && eMin >= bMax - EPS2) return Math.min(0, Math.max(delta, bMax - eMin));
  return delta;
}

// ---------------------------------------------------------------------------

export class Entity {
  readonly type: EntityType;
  readonly level: ClientLevel;

  id = 0;
  world: MobWorld | null = null;
  random: RandomSource = new XoroshiroRandomSource(0n);

  // position (feet) and previous-tick position (for render interpolation)
  x = 0; y = 0; z = 0;
  xo = 0; yo = 0; zo = 0;
  // velocity in blocks / tick
  vx = 0; vy = 0; vz = 0;
  // rotation in degrees (vanilla yRot / xRot)
  yaw = 0; pitch = 0;
  yRotO = 0; xRotO = 0;

  onGround = false;
  wasOnGround = false;
  horizontalCollision = false;
  verticalCollision = false;
  verticalCollisionBelow = false;

  removed = false;
  fireTicks = 0;
  fallDistance = 0;
  tickCount = 0;
  inWater = false;
  inLava = false;
  noGravity = false;
  /** cached ambient light 0..1, set by EntityManager each tick */
  brightness = 1;
  /** render-time model scale (baby mobs) */
  scale = 1;
  /** limb-swing phase for the renderer (-0.5..0.5), set by LivingEntity.aiStep */
  animSwing = 0;

  constructor(type: EntityType, level: ClientLevel) {
    this.type = type;
    this.level = level;
  }

  // ---- dimensions ---------------------------------------------------------

  getWidth(): number { return this.type.width * this.scale; }
  getHeight(): number { return this.type.height * this.scale; }
  getEyeHeight(): number { return this.type.height * 0.85 * this.scale; }
  getEyeY(): number { return this.y + this.getEyeHeight(); }
  getDimensions() { return this.type.dimensions; }
  getType(): EntityType { return this.type; }
  getTypeName(): string { return this.type.name; }
  getCategory() { return this.type.category; }

  // ---- position -----------------------------------------------------------

  getX(): number { return this.x; }
  getY(): number { return this.y; }
  getZ(): number { return this.z; }
  getPos(): Vec3 { return new Vec3(this.x, this.y, this.z); }

  setPos(x: number, y: number, z: number): void {
    this.x = x; this.y = y; this.z = z;
    this.xo = x; this.yo = y; this.zo = z;
  }

  /**
   * Piston displacement (vanilla Entity.move(MoverType.PISTON, ...)).
   * Uses the normal per-axis collision sweep so a pushed entity cannot enter blocks.
   */
  moveByPiston(dx: number, dy: number, dz: number): void {
    this.move(dx, dy, dz);
  }

  getBoundingBox(): AABB {
    const half = this.getWidth() / 2;
    return new AABB(this.x - half, this.y, this.z - half, this.x + half, this.y + this.getHeight(), this.z + half);
  }

  distanceToSqr(x: number, y: number, z: number): number {
    const dx = this.x - x, dy = this.y - y, dz = this.z - z;
    return dx * dx + dy * dy + dz * dz;
  }
  distanceTo(o: { x: number; y: number; z: number }): number {
    return Math.sqrt(this.distanceToSqr(o.x, o.y, o.z));
  }

  // ---- state --------------------------------------------------------------

  isAlive(): boolean { return !this.removed; }
  isRemoved(): boolean { return this.removed; }
  remove(): void { this.removed = true; }
  isOnGround(): boolean { return this.onGround; }
  isFireImmune(): boolean { return this.type.fireImmune; }
  getRandom(): RandomSource { return this.random; }
  isNoGravity(): boolean { return this.noGravity; }
  setNoGravity(v: boolean): void { this.noGravity = v; }

  setOnFire(ticks: number): void {
    if (!this.type.fireImmune) this.fireTicks = Math.max(this.fireTicks, ticks);
  }
  clearFire(): void { this.fireTicks = 0; }
  isOnFire(): boolean { return this.fireTicks > 0; }

  /** Vanilla Entity.setYRot / setXRot (degrees). */
  setYRot(yaw: number): void { this.yaw = yaw; }
  setXRot(pitch: number): void { this.pitch = pitch; }

  /** Vanilla Entity.getViewVector / getLookAngle (unit vector, radians). */
  getViewVector(): Vec3 {
    const yr = this.yaw * DEG_TO_RAD, pr = this.pitch * DEG_TO_RAD;
    const cp = Math.cos(pr);
    return new Vec3(-Math.sin(yr) * cp, -Math.sin(pr), Math.cos(yr) * cp);
  }
  getLookAngle(): Vec3 { return this.getViewVector(); }

  getBrightness(): number { return this.brightness; }

  // ---- liquid -------------------------------------------------------------

  protected checkLiquid(): void {
    const mc = this.level.mc;
    const half = this.getWidth() / 2;
    const x0 = Math.floor(this.x - half), x1 = Math.floor(this.x + half - 1e-4);
    const y0 = Math.floor(this.y), y1 = Math.floor(this.y + this.getHeight() - 1e-4);
    const z0 = Math.floor(this.z - half), z1 = Math.floor(this.z + half - 1e-4);
    let water = false, lava = false;
    for (let y = y0; y <= y1; y++) {
      for (let z = z0; z <= z1; z++) {
        for (let x = x0; x <= x1; x++) {
          const state = this.level.getBlockState(x, y, z);
          if (state === 0) continue;
          if (mc.isLiquid(state)) {
            water = true;
            if (mc.blockOf(state).name.indexOf('lava') >= 0) lava = true;
          }
        }
      }
    }
    this.inWater = water;
    this.inLava = lava;
  }
  isInWater(): boolean { return this.inWater; }
  isInLava(): boolean { return this.inLava; }

  // ---- damage (overridden by LivingEntity) --------------------------------

  hurt(_amount: number, _attacker: Targetable | null): void { /* base entities are invulnerable */ }

  // ---- tick ---------------------------------------------------------------

  /** Vanilla Entity.baseTick: remembers prev state, ticks fire, clamps to world. */
  baseTick(): void {
    this.xo = this.x; this.yo = this.y; this.zo = this.z;
    this.yRotO = this.yaw; this.xRotO = this.pitch;
    this.wasOnGround = this.onGround;
    this.tickCount++;
    // Liquids rarely change: re-evaluate every 10 ticks instead of every tick.
    if (this.tickCount === 1 || this.tickCount % 10 === 0) this.checkLiquid();

    if (this.fireTicks > 0) {
      if (this.type.fireImmune) { this.fireTicks -= 4; if (this.fireTicks < 0) this.fireTicks = 0; }
      else this.fireTicks--;
    }

    // keep entities inside the (loaded) world vertical bounds
    const min = this.level.minY;
    const max = min + this.level.height;
    if (this.y < min) { this.y = min; this.vy = 0; this.onGround = false; }
    if (this.y > max) { this.y = max; this.vy = 0; }
    if (!Number.isFinite(this.x) || !Number.isFinite(this.y) || !Number.isFinite(this.z)) {
      this.x = this.xo; this.y = this.yo; this.z = this.zo; this.vx = this.vy = this.vz = 0;
    }
  }

  /** Default entity tick: subclasses extend/override. */
  tick(): void { this.baseTick(); }

  // ---- movement -----------------------------------------------------------

  /**
   * Vanilla Entity.move(MoverType.SELF, delta): per-axis sweep against the
   * collected block collision shapes. Zero allocation (uses SCRATCH + scalars).
   */
  protected move(dx: number, dy: number, dz: number): void {
    if (dx === 0 && dy === 0 && dz === 0) { this.onGround = false; return; }

    // Fast path: an already-grounded entity that is not moving horizontally
    // only needs to confirm the block under its feet. This avoids the full 3D
    // sweep for the ~10 resting items and idle mobs every tick (12 lookups -> 1).
    if (this.onGround && dy < 0 && dy > -0.2
      && Math.abs(dx) < 1e-4 && Math.abs(dz) < 1e-4) {
      const state = this.level.getBlockState(Math.floor(this.x), Math.floor(this.y) - 1, Math.floor(this.z));
      if (state !== 0 && this.level.mc.collision(state).length > 0) {
        this.vy = 0;
        this.onGround = true;
        this.verticalCollision = true;
        this.verticalCollisionBelow = true;
        this.horizontalCollision = false;
        this.fallDistance = 0;
        return;
      }
      // ground disappeared: fall through to the full collision sweep
    }

    const half = this.getWidth() / 2;
    let ex0 = this.x - half, ex1 = this.x + half;
    let ey0 = this.y, ey1 = this.y + this.getHeight();
    let ez0 = this.z - half, ez1 = this.z + half;

    // Vanilla inflates the swept volume by 0.5 to allow step-up; this port has
    // no step-up physics, so the exact swept AABB (plus a tiny epsilon) is
    // sufficient and cuts the number of scanned blocks by ~3x.
    const infl = 0.001;
    const aminX = Math.min(ex0, ex0 + dx) - infl, amaxX = Math.max(ex1, ex1 + dx) + infl;
    const aminY = Math.min(ey0, ey0 + dy) - infl, amaxY = Math.max(ey1, ey1 + dy) + infl;
    const aminZ = Math.min(ez0, ez0 + dz) - infl, amaxZ = Math.max(ez1, ez1 + dz) + infl;
    collectCollision(this.level, aminX, aminY, aminZ, amaxX, amaxY, amaxZ);

    let mx = dx, my = dy, mz = dz;

    // Y axis first
    if (my !== 0) {
      for (let i = 0; i < scratchCount; i++) {
        const o = i * 6;
        const bx0 = SCRATCH[o], by0 = SCRATCH[o + 1], bz0 = SCRATCH[o + 2];
        const bx1 = SCRATCH[o + 3], by1 = SCRATCH[o + 4], bz1 = SCRATCH[o + 5];
        if (ex1 <= bx0 + EPS || ex0 >= bx1 - EPS) continue;
        if (ez1 <= bz0 + EPS || ez0 >= bz1 - EPS) continue;
        my = clipAxis(ey0, ey1, by0, by1, my);
      }
      this.y += my; ey0 += my; ey1 += my;
    }

    // X axis
    if (mx !== 0) {
      for (let i = 0; i < scratchCount; i++) {
        const o = i * 6;
        const bx0 = SCRATCH[o], by0 = SCRATCH[o + 1], bz0 = SCRATCH[o + 2];
        const bx1 = SCRATCH[o + 3], by1 = SCRATCH[o + 4], bz1 = SCRATCH[o + 5];
        if (ey1 <= by0 + EPS || ey0 >= by1 - EPS) continue;
        if (ez1 <= bz0 + EPS || ez0 >= bz1 - EPS) continue;
        mx = clipAxis(ex0, ex1, bx0, bx1, mx);
      }
      this.x += mx; ex0 += mx; ex1 += mx;
    }

    // Z axis
    if (mz !== 0) {
      for (let i = 0; i < scratchCount; i++) {
        const o = i * 6;
        const bx0 = SCRATCH[o], by0 = SCRATCH[o + 1], bz0 = SCRATCH[o + 2];
        const bx1 = SCRATCH[o + 3], by1 = SCRATCH[o + 4], bz1 = SCRATCH[o + 5];
        if (ey1 <= by0 + EPS || ey0 >= by1 - EPS) continue;
        if (ex1 <= bx0 + EPS || ex0 >= bx1 - EPS) continue;
        mz = clipAxis(ez0, ez1, bz0, bz1, mz);
      }
      this.z += mz;
    }

    const collidedY = my !== dy;
    this.onGround = dy < 0 && collidedY;
    this.verticalCollisionBelow = collidedY && dy < 0;
    this.verticalCollision = collidedY;
    this.horizontalCollision = (mx !== dx) || (mz !== dz);
    if (collidedY) this.vy = 0;
    if (mx !== dx) this.vx = 0;
    if (mz !== dz) this.vz = 0;

    if (!this.onGround && vyIsFalling(this.vy)) this.fallDistance -= my;
    else if (this.onGround) this.fallDistance = 0;
  }

  /** Vanilla Entity.push: apply an impulse to velocity. */
  push(ix: number, iy: number, iz: number): void {
    this.vx += ix; this.vy += iy; this.vz += iz;
  }

  /** Facing degrees toward a target point (vanilla yRot convention: 0 = +Z). */
  protected yawTowards(tx: number, tz: number): number {
    const dx = tx - this.x, dz = tz - this.z;
    return Math.atan2(-dx, dz) / DEG_TO_RAD;
  }
}

function vyIsFalling(vy: number): boolean { return vy < 0; }

export const GRAVITY = 0.08;
export const VERTICAL_DRAG = 0.98;
export const GROUND_FRICTION = 0.546;
export const AIR_FRICTION = 0.98;
export const JUMP_VELOCITY = 0.42;
export const TERMINAL_FALL = 3.92;
