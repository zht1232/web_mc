// Source: net.minecraft.world.entity.vehicle.boat.AbstractBoat + Boat + Raft +
//         AbstractChestBoat (26.2)
//
// The boat's own status scan decides how it floats:
//   * getStatus() picks IN_WATER / UNDER_WATER / UNDER_FLOWING_WATER / ON_LAND /
//     IN_AIR from the fluid and collision below the hull,
//   * floatBoat() applies gravity, buoyancy and the per-status friction (and the
//     one-off snap when a boat falls into water),
//   * controlBoat() turns the rider's input into yaw delta and acceleration.
// There is no fluid simulation in this client, so only source/flowing water
// blocks already present in the level are read.
//
// Not ported yet: bubble columns, leash data, boats pushing other entities,
// paddle sounds and chest-boat loot tables.

import { Entity } from '../Entity.js';
import { entityType } from '../EntityType.js';
import { SimpleContainer, type Container } from '../../inventory/Container.js';
import type { ItemStack } from '../../item/ItemStack.js';
import type { ClientLevel } from '../../level/ClientLevel.js';

type Status = 'IN_WATER' | 'UNDER_WATER' | 'UNDER_FLOWING_WATER' | 'ON_LAND' | 'IN_AIR';

const PADDLE_STEP = Math.PI / 8;

/** Block.getFriction (only the blocks that differ from the 0.6 default matter). */
function blockFriction(name: string): number {
  switch (name) {
    case 'ice':
    case 'packed_ice':
    case 'frosted_ice':
      return 0.98;
    case 'blue_ice':
      return 0.989;
    case 'slime_block':
      return 0.8;
    default:
      return 0.6;
  }
}

function strip(name: string): string { return name.replace(/^minecraft:/, ''); }

/** Mth.clampedLerp: clamp the 0..1 progress between two values. */
function clampedLerp(t: number, a: number, b: number): number {
  if (t < 0) return a;
  if (t > 1) return b;
  return a + (b - a) * t;
}

const CHEST_BOAT_SUFFIX = /(_chest_boat|_chest_raft)$/;

export class Boat extends Entity implements Container {
  /** AbstractBoat.status / oldStatus (client-side fluid state of the hull). */
  status: Status = 'IN_AIR';
  oldStatus: Status = 'IN_AIR';
  /** Seconds spent fully underwater; at 60 the rider is ejected. */
  outOfControlTicks = 0;
  /** controlBoat rotation impulse, decayed by floatBoat's friction. */
  deltaRotation = 0;
  private readonly paddlePositions = [0, 0];
  private inputLeft = false;
  private inputRight = false;
  private inputUp = false;
  private inputDown = false;
  private waterLevel = 0;
  private landFriction = 0;
  private lastYd = 0;
  /** VehicleEntity damage accumulator: a hit adds damage*10, destroyed above 40. */
  damage = 0;
  hurtTime = 0;
  hurtDir = 1;
  /** Chest boat inventory (27 slots); empty for a plain boat. */
  readonly inventory: SimpleContainer;
  /** Set by Game while the local player rides this boat. */
  rider: unknown = null;

  constructor(level: ClientLevel, kind = 'oak_boat') {
    super(entityType(kind), level);
    this.inventory = new SimpleContainer(this.isChest() ? 27 : 0);
  }

  get kind(): string { return strip(this.type.name); }
  isChest(): boolean { return CHEST_BOAT_SUFFIX.test(this.kind); }
  isRaft(): boolean { return this.kind.endsWith('_raft'); }
  /** Item dropped when the boat is destroyed (the boat/raft itself). */
  getDropItemName(): string { return this.kind; }

  /** AbstractChestBoat.getMaxPassengers / AbstractBoat.getMaxPassengers. */
  getMaxPassengers(): number { return this.isChest() ? 1 : 2; }

  /** Boat.rideHeight / Raft.rideHeight. */
  getRideHeight(): number {
    return this.isRaft() ? this.getHeight() * 0.8888889 : this.getHeight() / 3;
  }

  /** AbstractChestBoat.getSinglePassengerXOffset. */
  getSinglePassengerXOffset(): number { return this.isChest() ? 0.15 : 0; }

  getRider(): unknown { return this.rider; }

  // ---- Container (chest boat) ---------------------------------------------
  getContainerSize(): number { return this.inventory.getContainerSize(); }
  isEmpty(): boolean { return this.inventory.isEmpty(); }
  getItem(slot: number): ItemStack { return this.inventory.getItem(slot); }
  setItem(slot: number, stack: ItemStack): void { this.inventory.setItem(slot, stack); }
  removeItem(slot: number, count: number): ItemStack { return this.inventory.removeItem(slot, count); }
  removeItemNoUpdate(slot: number): ItemStack { return this.inventory.removeItemNoUpdate(slot); }
  setChanged(): void { /* chest contents live on the entity */ }
  stillValid(_player: unknown): boolean { return !this.isRemoved(); }
  getMaxStackSize(): number { return 64; }
  clearContent(): void { this.inventory.clearContent(); }

  /** Rides another entity's hits: damage accumulates like VehicleEntity. */
  hitBy(amount: number, creative: boolean): boolean {
    if (this.isRemoved()) return true;
    this.hurtDir = -this.hurtDir;
    this.hurtTime = 10;
    this.damage += amount * 10;
    if (creative) return true;
    return this.damage > 40;
  }

  // ---- fluid helpers -------------------------------------------------------

  /** FlowingFluid.getHeight for water: 1.0 when the block above is water. */
  private waterHeightAt(x: number, y: number, z: number): number {
    const mc = this.level.mc;
    const state = this.level.getBlockState(x, y, z);
    if (state === 0 || !mc.hasFluid(state) || mc.blockOf(state).name !== 'water') return 0;
    const above = this.level.getBlockState(x, y + 1, z);
    if (mc.hasFluid(above) && mc.blockOf(above).name === 'water') return 1;
    const amount = Number(mc.getProp(state, 'level') ?? 0);
    return (amount >= 8 ? 8 : 8 - amount) / 9;
  }

  private isWaterSource(x: number, y: number, z: number): boolean {
    const mc = this.level.mc;
    const state = this.level.getBlockState(x, y, z);
    return state !== 0 && mc.hasFluid(state) && mc.blockOf(state).name === 'water'
      && Number(mc.getProp(state, 'level') ?? 0) === 0;
  }

  /** AbstractBoat.isUnderwater. */
  private isUnderwater(): Status | null {
    const bb = this.getBoundingBox();
    const top = bb.maxY + 0.001;
    const x0 = Math.floor(bb.minX), x1 = Math.ceil(bb.maxX);
    const y0 = Math.floor(bb.maxY), y1 = Math.ceil(top);
    const z0 = Math.floor(bb.minZ), z1 = Math.ceil(bb.maxZ);
    let underWater = false;
    for (let x = x0; x < x1; x++) {
      for (let y = y0; y < y1; y++) {
        for (let z = z0; z < z1; z++) {
          const height = this.waterHeightAt(x, y, z);
          if (height > 0 && top < y + height) {
            if (!this.isWaterSource(x, y, z)) return 'UNDER_FLOWING_WATER';
            underWater = true;
          }
        }
      }
    }
    return underWater ? 'UNDER_WATER' : null;
  }

  /** AbstractBoat.getWaterLevelAbove. */
  private getWaterLevelAbove(): number {
    const bb = this.getBoundingBox();
    const minX = Math.floor(bb.minX), maxX = Math.ceil(bb.maxX);
    const minY = Math.floor(bb.maxY), maxY = Math.ceil(bb.maxY - this.lastYd);
    const minZ = Math.floor(bb.minZ), maxZ = Math.ceil(bb.maxZ);
    for (let y = minY; y < maxY; y++) {
      let blockHeight = 0;
      for (let x = minX; x < maxX; x++) {
        for (let z = minZ; z < maxZ; z++) {
          blockHeight = Math.max(blockHeight, this.waterHeightAt(x, y, z));
        }
      }
      if (blockHeight < 1) return y + blockHeight;
    }
    return maxY + 1;
  }

  /** AbstractBoat.checkInWater. */
  private checkInWater(): boolean {
    const bb = this.getBoundingBox();
    const minX = Math.floor(bb.minX), maxX = Math.ceil(bb.maxX);
    const minY = Math.floor(bb.minY), maxY = Math.ceil(bb.minY + 0.001);
    const minZ = Math.floor(bb.minZ), maxZ = Math.ceil(bb.maxZ);
    let inWater = false;
    this.waterLevel = -Number.MAX_VALUE;
    for (let x = minX; x < maxX; x++) {
      for (let y = minY; y < maxY; y++) {
        for (let z = minZ; z < maxZ; z++) {
          const height = this.waterHeightAt(x, y, z);
          if (height > 0) {
            const level = y + height;
            this.waterLevel = Math.max(level, this.waterLevel);
            inWater = inWater || bb.minY < level;
          }
        }
      }
    }
    return inWater;
  }

  /** AbstractBoat.getGroundFriction: average friction of the blocks under the hull. */
  getGroundFriction(): number {
    const bb = this.getBoundingBox();
    const minX = bb.minX, maxX = bb.maxX;
    const minZ = bb.minZ, maxZ = bb.maxZ;
    const bottom = bb.minY - 0.001;
    const x0 = Math.floor(minX) - 1, x1 = Math.ceil(maxX) + 1;
    const y0 = Math.floor(bottom) - 1, y1 = Math.ceil(bb.minY) + 1;
    const z0 = Math.floor(minZ) - 1, z1 = Math.ceil(maxZ) + 1;
    let friction = 0;
    let count = 0;
    for (let x = x0; x < x1; x++) {
      for (let z = z0; z < z1; z++) {
        const edges = (x !== x0 && x !== x1 - 1 ? 0 : 1) + (z !== z0 && z !== z1 - 1 ? 0 : 1);
        if (edges === 2) continue;
        for (let y = y0; y < y1; y++) {
          if (edges > 0 && (y === y0 || y === y1 - 1)) continue;
          const state = this.level.getBlockState(x, y, z);
          if (state === 0) continue;
          const name = this.level.mc.blockOf(state).name;
          if (name === 'lily_pad') continue;
          const shape = this.level.mc.collision(state);
          for (let i = 0; i < shape.length; i++) {
            const b = shape[i];
            if (b.minX + x < maxX && b.maxX + x > minX
              && b.minY + y < bb.minY && b.maxY + y > bottom
              && b.minZ + z < maxZ && b.maxZ + z > minZ) {
              friction += blockFriction(name);
              count++;
              break;
            }
          }
        }
      }
    }
    return count > 0 ? friction / count : 0;
  }

  /** AbstractBoat.getStatus. */
  private getStatus(): Status {
    const waterStatus = this.isUnderwater();
    if (waterStatus) {
      this.waterLevel = this.getBoundingBox().maxY;
      return waterStatus;
    }
    if (this.checkInWater()) return 'IN_WATER';
    const friction = this.getGroundFriction();
    if (friction > 0) {
      this.landFriction = friction;
      return 'ON_LAND';
    }
    return 'IN_AIR';
  }

  // ---- tick ---------------------------------------------------------------

  override tick(): void {
    this.oldStatus = this.status;
    this.status = this.getStatus();
    if (this.status !== 'UNDER_WATER' && this.status !== 'UNDER_FLOWING_WATER') {
      this.outOfControlTicks = 0;
    } else {
      this.outOfControlTicks++;
    }
    if (this.hurtTime > 0) this.hurtTime--;
    if (this.damage > 0) this.damage = Math.max(0, this.damage - 1);

    this.baseTick();

    if (!this.rider) this.setPaddleState(false, false);
    this.floatBoat();
    // Local player drives the boat (single player: always authoritative).
    this.controlBoat();
    this.lastYd = this.vy;
    this.move(this.vx, this.vy, this.vz);
    this.tickPaddles();
  }

  /** AbstractBoat.floatBoat. */
  private floatBoat(): void {
    const gravity = 0.04;
    let vspeed = -gravity;
    let buoyancy = 0;
    let invFriction = 0.05;
    if (this.oldStatus === 'IN_AIR' && this.status !== 'IN_AIR' && this.status !== 'ON_LAND') {
      this.waterLevel = this.y + this.getHeight();
      const targetY = this.getWaterLevelAbove() - this.getHeight() + 0.101;
      if (this.noCollisionAt(this.x, targetY, this.z)) {
        this.setPos(this.x, targetY, this.z);
        this.vy = 0;
        this.lastYd = 0;
      }
      this.status = 'IN_WATER';
    } else {
      switch (this.status) {
        case 'IN_WATER':
          buoyancy = (this.waterLevel - this.y) / this.getHeight();
          invFriction = 0.9;
          break;
        case 'UNDER_FLOWING_WATER':
          vspeed = -7.0e-4;
          invFriction = 0.9;
          break;
        case 'UNDER_WATER':
          buoyancy = 0.01;
          invFriction = 0.45;
          break;
        case 'IN_AIR':
          invFriction = 0.9;
          break;
        case 'ON_LAND':
          invFriction = this.landFriction;
          if (this.rider) this.landFriction /= 2;
          break;
      }
      this.vx *= invFriction;
      this.vy += vspeed;
      this.vz *= invFriction;
      this.deltaRotation *= invFriction;
      if (buoyancy > 0) {
        this.vy = (this.vy + buoyancy * (gravity / 0.65)) * 0.75;
      }
    }
  }

  /** AbstractBoat.controlBoat. */
  private controlBoat(): void {
    if (!this.rider) return;
    let acceleration = 0;
    if (this.inputLeft) this.deltaRotation--;
    if (this.inputRight) this.deltaRotation++;
    if (this.inputRight !== this.inputLeft && !this.inputUp && !this.inputDown) {
      acceleration += 0.005;
    }
    this.yaw += this.deltaRotation;
    if (this.inputUp) acceleration += 0.04;
    if (this.inputDown) acceleration -= 0.005;
    const rad = this.yaw * Math.PI / 180;
    this.vx += Math.sin(-rad) * acceleration;
    this.vz += Math.cos(rad) * acceleration;
    this.setPaddleState(
      (this.inputRight && !this.inputLeft) || this.inputUp,
      (this.inputLeft && !this.inputRight) || this.inputUp,
    );
  }

  /** AbstractBoat.tick paddle animation (sounds omitted until audio parity). */
  private tickPaddles(): void {
    for (let side = 0; side < 2; side++) {
      if (this.getPaddleState(side)) this.paddlePositions[side] += PADDLE_STEP;
      else this.paddlePositions[side] = 0;
    }
  }

  setInput(left: boolean, right: boolean, up: boolean, down: boolean): void {
    this.inputLeft = left;
    this.inputRight = right;
    this.inputUp = up;
    this.inputDown = down;
  }

  private setPaddleState(left: boolean, right: boolean): void {
    this.paddleState[0] = left;
    this.paddleState[1] = right;
  }

  private readonly paddleState = [false, false];

  getPaddleState(side: number): boolean {
    return this.paddleState[side] && this.rider != null;
  }

  /** AbstractBoat.getRowingTime (renderer paddle swing). */
  getRowingTime(side: number, partialTick: number): number {
    if (!this.getPaddleState(side)) return 0;
    return clampedLerp(partialTick, this.paddlePositions[side] - PADDLE_STEP, this.paddlePositions[side]);
  }

  /** Collision test of the hull at an arbitrary Y (floatBoat's water snap). */
  private noCollisionAt(x: number, y: number, z: number): boolean {
    const half = this.getWidth() / 2;
    const height = this.getHeight();
    const minX = x - half, maxX = x + half, minZ = z - half, maxZ = z + half;
    const y0 = Math.floor(y), y1 = Math.ceil(y + height);
    const x0 = Math.floor(minX), x1 = Math.ceil(maxX);
    const z0 = Math.floor(minZ), z1 = Math.ceil(maxZ);
    for (let by = y0; by < y1; by++) {
      for (let bx = x0; bx < x1; bx++) {
        for (let bz = z0; bz < z1; bz++) {
          const state = this.level.getBlockState(bx, by, bz);
          if (state === 0) continue;
          const shape = this.level.mc.collision(state);
          for (let i = 0; i < shape.length; i++) {
            const b = shape[i];
            if (b.maxX + bx > minX && b.minX + bx < maxX
              && b.maxY + by > y && b.minY + by < y + height
              && b.maxZ + bz > minZ && b.minZ + bz < maxZ) return false;
          }
        }
      }
    }
    return true;
  }

  isUnderWater(): boolean {
    return this.status === 'UNDER_WATER' || this.status === 'UNDER_FLOWING_WATER';
  }

  /** AbstractBoat: 60 ticks of full submersion eject the passenger. */
  shouldEjectRider(): boolean { return this.outOfControlTicks >= 60; }

  /** Override so the renderer uses the hull box (no LivingEntity fields). */
  override getEyeY(): number { return this.y + this.getHeight() * 0.5; }
}
