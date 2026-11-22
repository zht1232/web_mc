// Source: net.minecraft.world.entity.vehicle.minecart.AbstractMinecart + Minecart +
//         NewMinecartBehavior (26.2, the default "experimental" movement)
//
// The cart follows the rail below it: NewMinecartBehavior.calculateTrackSpeed
// (slope slide, unpowered powered-rail halt, natural slowdown and powered-rail
// boost) and stepAlongTrack (move to the next rail centre, snapping at curves
// and slopes). Off rails it falls with vanilla gravity and air drag.
//
// Not ported yet: cart-to-cart pushing/pickup, damage/hurt animation, activator
// rails, furnace/TNT/hopper carts and the display block on chest carts.

import { Entity } from '../Entity.js';
import { entityType } from '../EntityType.js';
import { SimpleContainer, type Container } from '../../inventory/Container.js';
import type { ItemStack } from '../../item/ItemStack.js';
import type { ClientLevel } from '../../level/ClientLevel.js';

type Exit = readonly [number, number, number];

/** AbstractMinecart.EXITS (slopes include the lower exit). */
const RAIL_EXITS: Readonly<Record<string, readonly [Exit, Exit]>> = {
  north_south: [[0, 0, -1], [0, 0, 1]],
  east_west: [[-1, 0, 0], [1, 0, 0]],
  ascending_east: [[-1, -1, 0], [1, 0, 0]],
  ascending_west: [[-1, 0, 0], [1, -1, 0]],
  ascending_north: [[0, 0, -1], [0, -1, 1]],
  ascending_south: [[0, -1, -1], [0, 0, 1]],
  south_east: [[0, 0, 1], [1, 0, 0]],
  south_west: [[0, 0, 1], [-1, 0, 0]],
  north_west: [[0, 0, -1], [-1, 0, 0]],
  north_east: [[0, 0, -1], [1, 0, 0]],
};

const RAIL_NAMES: ReadonlySet<string> = new Set(['rail', 'powered_rail', 'detector_rail', 'activator_rail']);
const DEG = 180 / Math.PI;

/** Minecart.getMaxSpeed: game rule 8 blocks/s / 20. */
const MAX_SPEED = 8 / 20;
const GRAVITY = 0.04;
const AIR_DRAG = 0.95;

interface TrackIteration {
  first: boolean;
  movementLeft: number;
  hasGainedSlopeSpeed: boolean;
  hasHalted: boolean;
  hasBoosted: boolean;
}

function strip(name: string): string { return name.replace(/^minecraft:/, ''); }

export class Minecart extends Entity implements Container {
  /** AbstractMinecart.onRails. */
  onRails = false;
  /** Minecart flipped rotation (NewMinecartBehavior.setRotation). */
  flipped = false;
  /** Chest minecart inventory (27 slots); empty for the rideable cart. */
  readonly inventory: SimpleContainer;
  /** Set by Game while the local player rides this cart. */
  rider: unknown = null;
  private lastDetector = '';

  constructor(level: ClientLevel, kind = 'minecart') {
    super(entityType(kind), level);
    this.inventory = new SimpleContainer(strip(kind) === 'chest_minecart' ? 27 : 0);
  }

  get kind(): string { return strip(this.type.name); }

  // ---- Container (chest minecart) -----------------------------------------
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

  // ---- rail lookup ---------------------------------------------------------

  /** AbstractMinecart.getCurrentBlockPosOrRailBelow with the new-movement offset. */
  railPos(): { x: number; y: number; z: number } {
    const xt = Math.floor(this.x), zt = Math.floor(this.z);
    let yt = Math.floor(this.y);
    const y = this.y - 0.1 - 1e-5;
    const below = this.level.getBlockState(xt, Math.floor(y), zt);
    if (this.isRail(below)) yt = Math.floor(y);
    return { x: xt, y: yt, z: zt };
  }

  private isRail(state: number): boolean {
    return state !== 0 && RAIL_NAMES.has(this.level.mc.blockOf(state).name);
  }

  private railShape(state: number): string {
    return this.level.mc.getProp(state, 'shape') ?? 'north_south';
  }

  // ---- tick ---------------------------------------------------------------

  override tick(): void {
    this.baseTick();
    if (this.tickCount === 1) {
      const pos = this.railPos();
      const state = this.level.getBlockState(pos.x, pos.y, pos.z);
      this.onRails = this.isRail(state);
      this.adjustToRails(pos, state);
    }
    if (!this.onRails && !this.onGround && !this.noGravity) this.vy -= GRAVITY;
    this.moveAlongTrack();
    this.tickDetectorRail();
  }

  /** NewMinecartBehavior.moveAlongTrack (bounded to 8 rail steps per tick). */
  private moveAlongTrack(): void {
    const iteration: TrackIteration = {
      first: true, movementLeft: 0,
      hasGainedSlopeSpeed: false, hasHalted: false, hasBoosted: false,
    };
    for (let loop = 0; loop < 8; loop++) {
      const startVx = this.vx, startVz = this.vz;
      const oldX = this.x, oldY = this.y, oldZ = this.z;
      const pos = this.railPos();
      const state = this.level.getBlockState(pos.x, pos.y, pos.z);
      const onRails = this.isRail(state);
      if (this.onRails !== onRails) {
        this.onRails = onRails;
        this.adjustToRails(pos, state);
      }
      if (onRails) {
        this.fallDistance = 0;
        const shape = this.railShape(state);
        this.calculateTrackSpeed(state, shape, iteration);
        const newSpeed = Math.hypot(this.vx, this.vz);
        iteration.movementLeft = iteration.first
          ? newSpeed
          : iteration.movementLeft + newSpeed - Math.hypot(startVx, startVz);
        iteration.first = false;
        iteration.movementLeft = this.stepAlongTrack(pos, shape, iteration.movementLeft);
      } else {
        this.comeOffTrack();
        iteration.movementLeft = 0;
      }

      const dx = this.x - oldX, dy = this.y - oldY, dz = this.z - oldZ;
      const stepLength = Math.hypot(dx, dy, dz);
      if (stepLength > 1e-5) {
        const horizontal2 = dx * dx + dz * dz;
        if (horizontal2 > 1e-5) {
          let yaw = 180 - Math.atan2(dz, dx) * DEG;
          let pitch = this.onGround && !this.onRails
            ? 0
            : 90 - Math.atan2(Math.sqrt(horizontal2), dy) * DEG;
          if (this.flipped) { yaw += 180; pitch *= -1; }
          this.setRotation(yaw, pitch);
        }
      }
      if (stepLength <= 1e-5 && !iteration.first) break;
    }
  }

  private calculateTrackSpeed(state: number, shape: string, it: TrackIteration): void {
    const name = this.level.mc.blockOf(state).name;
    // Slope slide (calculateSlopeSpeed).
    if (!it.hasGainedSlopeSpeed) {
      const before = this.vx * this.vx + this.vz * this.vz;
      let slide = Math.max(0.0078125, Math.hypot(this.vx, this.vz) * 0.02);
      if (this.inWater) slide *= 0.2;
      switch (shape) {
        case 'ascending_east': this.vx -= slide; break;
        case 'ascending_west': this.vx += slide; break;
        case 'ascending_north': this.vz += slide; break;
        case 'ascending_south': this.vz -= slide; break;
        default: break;
      }
      if (this.vx * this.vx + this.vz * this.vz !== before) it.hasGainedSlopeSpeed = true;
    }

    // Unpowered powered rail: halt or halve the speed.
    if (!it.hasHalted && name === 'powered_rail' && !this.bool(state, 'powered')) {
      const speed = Math.hypot(this.vx, this.vz);
      if (speed < 0.03) { this.vx = 0; this.vz = 0; } else { this.vx *= 0.5; this.vz *= 0.5; }
      it.hasHalted = true;
    }

    // applyNaturalSlowdown + max speed clamp (only on the first iteration).
    if (it.first) {
      const factor = this.rider ? 0.997 : 0.975;
      this.vx *= factor;
      this.vz *= factor;
      if (this.inWater) { this.vx *= 0.95; this.vz *= 0.95; }
      const speed = Math.hypot(this.vx, this.vy, this.vz);
      if (speed > MAX_SPEED) {
        const scale = MAX_SPEED / speed;
        this.vx *= scale; this.vy *= scale; this.vz *= scale;
      }
    }

    // Powered rail boost.
    if (!it.hasBoosted && name === 'powered_rail' && this.bool(state, 'powered')) {
      const speed = Math.hypot(this.vx, this.vy, this.vz);
      if (speed > 0.01) {
        const scale = (speed + 0.06) / speed;
        this.vx *= scale; this.vy *= scale; this.vz *= scale;
      } else {
        const dir = this.redstoneDirection(state, shape);
        this.vx = dir[0] * (speed + 0.2);
        this.vz = dir[2] * (speed + 0.2);
      }
      it.hasBoosted = true;
    }
  }

  /** AbstractMinecart.getRedstoneDirection: powered rail pushed away from a solid neighbour. */
  private redstoneDirection(state: number, shape: string): readonly [number, number, number] {
    const pos = this.railPos();
    const solid = (x: number, z: number): boolean => {
      const s = this.level.getBlockState(x, pos.y, z);
      return s !== 0 && this.level.mc.collision(s).length > 0;
    };
    if (shape === 'east_west') {
      if (solid(pos.x - 1, pos.z)) return [1, 0, 0];
      if (solid(pos.x + 1, pos.z)) return [-1, 0, 0];
    } else if (shape === 'north_south') {
      if (solid(pos.x, pos.z - 1)) return [0, 0, 1];
      if (solid(pos.x, pos.z + 1)) return [0, 0, -1];
    }
    return [0, 0, 0];
  }

  /** NewMinecartBehavior.stepAlongTrack. */
  private stepAlongTrack(pos: { x: number; y: number; z: number }, shape: string, movementLeft: number): number {
    if (movementLeft < 1e-5) return 0;
    const exits = RAIL_EXITS[shape] ?? RAIL_EXITS.north_south;
    const [e0, e1] = exits;
    const speed = Math.hypot(this.vx, this.vz);
    if (speed < 1e-5) { this.vx = 0; this.vz = 0; return 0; }

    const inHill = e0[1] !== e1[1];
    let outX = e0[0] * 0.5, outZ = e0[2] * 0.5;
    const inX = e1[0] * 0.5, inZ = e1[2] * 0.5;
    if (this.vx * outX + this.vz * outZ < this.vx * inX + this.vz * inZ) {
      outX = inX; outZ = inZ;
    }

    const oldX = this.x, oldY = this.y, oldZ = this.z;
    const outLen = Math.hypot(outX, outZ) || 1;
    let outPX = pos.x + 0.5 + outX + (outX / outLen) * 1e-5;
    let outPY = pos.y + 0.1;
    let outPZ = pos.z + 0.5 + outZ + (outZ / outLen) * 1e-5;
    if (inHill && !this.isDescending(shape)) outPY += 1;

    let towardsX = outPX - oldX, towardsY = outPY - oldY, towardsZ = outPZ - oldZ;
    const towardsLen = Math.hypot(towardsX, towardsY, towardsZ) || 1;
    towardsX /= towardsLen; towardsY /= towardsLen; towardsZ /= towardsLen;
    const horizontal = Math.hypot(towardsX, towardsZ) || 1;
    // NewMinecartBehavior: movement = towardsOut.scale(speed / horizontalDistance),
    // then newPosition = oldPosition + movement.normalize() * movementLeft.
    const speedScale = speed / horizontal;
    const step = movementLeft * (inHill ? Math.SQRT2 : 1);
    let newX = oldX + towardsX * step;
    let newY = oldY + towardsY * step;
    let newZ = oldZ + towardsZ * step;

    const oldToOut = (outPX - oldX) ** 2 + (outPY - oldY) ** 2 + (outPZ - oldZ) ** 2;
    const oldToNew = (newX - oldX) ** 2 + (newY - oldY) ** 2 + (newZ - oldZ) ** 2;
    if (oldToOut <= oldToNew) {
      movementLeft = Math.hypot(outPX - newX, outPZ - newZ);
      newX = outPX; newY = outPY; newZ = outPZ;
    } else {
      movementLeft = 0;
    }

    const mx = newX - oldX, my = newY - oldY, mz = newZ - oldZ;
    this.move(mx, my, mz);
    if (Math.hypot(this.x - oldX, this.y - oldY, this.z - oldZ) < 1e-5
      && Math.hypot(mx, my, mz) > 1e-5) {
      this.vx = 0; this.vy = 0; this.vz = 0;
      return 0;
    }

    if (inHill) {
      // Keep the cart on the slope surface (vanilla projectYPos clamp).
      const horizontalFromOut = Math.hypot(outPX - this.x, outPZ - this.z);
      const projected = outPY + (this.isDescending(shape) ? horizontalFromOut : -horizontalFromOut);
      if (this.y < projected) this.y = projected;
    }
    this.vx = towardsX * speedScale;
    this.vz = towardsZ * speedScale;
    return Math.max(0, movementLeft);
  }

  private isDescending(shape: string): boolean {
    switch (shape) {
      case 'ascending_east': return this.vx < 0;
      case 'ascending_west': return this.vx > 0;
      case 'ascending_north': return this.vz > 0;
      case 'ascending_south': return this.vz < 0;
      default: return false;
    }
  }

  /** AbstractMinecart.comeOffTrack. */
  private comeOffTrack(): void {
    this.vx = Math.max(-MAX_SPEED, Math.min(MAX_SPEED, this.vx));
    this.vz = Math.max(-MAX_SPEED, Math.min(MAX_SPEED, this.vz));
    if (this.onGround) { this.vx *= 0.5; this.vz *= 0.5; }
    this.move(this.vx, this.vy, this.vz);
    if (!this.onGround) { this.vx *= AIR_DRAG; this.vz *= AIR_DRAG; }
  }

  /** NewMinecartBehavior.adjustToRails. */
  private adjustToRails(pos: { x: number; y: number; z: number }, state: number): void {
    if (!this.isRail(state)) return;
    const exits = RAIL_EXITS[this.railShape(state)] ?? RAIL_EXITS.north_south;
    const [e0, e1] = exits;
    let outX = e0[0] * 0.5, outZ = e0[2] * 0.5;
    const inX = e1[0] * 0.5, inZ = e1[2] * 0.5;
    if ((Math.hypot(this.vx, this.vz) > 1e-5 && this.vx * outX + this.vz * outZ < this.vx * inX + this.vz * inZ)
      || this.isDescending(this.railShape(state))) {
      outX = inX; outZ = inZ;
    }
    let yaw = 180 - Math.atan2(outZ, outX) * DEG;
    if (this.flipped) yaw += 180;

    const oldX = this.x, oldY = this.y, oldZ = this.z;
    const inCorner = e0[0] !== e1[0] && e0[2] !== e1[2];
    let targetX = oldX, targetY = pos.y, targetZ = oldZ;
    if (inCorner) {
      const f1x = e1[0] - e0[0], f1z = e1[2] - e0[2];
      const p0x = oldX - (pos.x + 0.5) - e0[0] * 0.5;
      const p0z = oldZ - (pos.z + 0.5) - e0[2] * 0.5;
      const t = (f1x * p0x + f1z * p0z) / (f1x * f1x + f1z * f1z || 1);
      targetX = pos.x + 0.5 + e0[0] * 0.5 + f1x * t;
      targetZ = pos.z + 0.5 + e0[2] * 0.5 + f1z * t;
      yaw = 180 - Math.atan2(f1z * t, f1x * t) * DEG;
      if (!Number.isFinite(yaw)) yaw = 180 - Math.atan2(f1z, f1x) * DEG;
      if (this.flipped) yaw += 180;
    } else {
      const zSnap = e0[0] !== e1[0];
      const xSnap = e0[2] !== e1[2];
      if (xSnap) targetX = pos.x + 0.5;
      if (zSnap) targetZ = pos.z + 0.5;
    }
    this.setPos(targetX, targetY, targetZ);

    let pitch = 0;
    const inHill = e0[1] !== e1[1];
    if (inHill) {
      const inPX = pos.x + 0.5 + inX, inPZ = pos.z + 0.5 + inZ;
      this.y += Math.hypot(inPX - this.x, inPZ - this.z) + 0.1;
      pitch = this.flipped ? 45 : -45;
    } else {
      this.y += 0.1;
    }
    this.setRotation(yaw, pitch);
  }

  private setRotation(yaw: number, pitch: number): void {
    const diff = Math.abs(yaw - this.yaw);
    if (diff >= 175 && diff <= 185) {
      this.flipped = !this.flipped;
      yaw -= 180;
      pitch *= -1;
    }
    this.yaw = ((yaw % 360) + 360) % 360;
    this.pitch = Math.max(-45, Math.min(45, pitch));
  }

  private bool(state: number, name: string): boolean {
    return this.level.mc.getProp(state, name) === 'true';
  }

  /** Detector rail: notify the redstone system when the cart enters/leaves one. */
  private tickDetectorRail(): void {
    const pos = this.railPos();
    const state = this.level.getBlockState(pos.x, pos.y, pos.z);
    const name = state !== 0 ? this.level.mc.blockOf(state).name : '';
    const key = name === 'detector_rail' ? `${pos.x},${pos.y},${pos.z}` : '';
    if (key === this.lastDetector) return;
    if (this.lastDetector) {
      const [x, y, z] = this.lastDetector.split(',').map(Number);
      this.world?.onMinecartDetector?.(x, y, z, false);
    }
    this.lastDetector = key;
    if (key) this.world?.onMinecartDetector?.(pos.x, pos.y, pos.z, true);
  }

  /** Override so the cart's own box is used by the renderer (no LivingEntity fields). */
  override getEyeY(): number { return this.y + 0.5; }

  getRider(): unknown { return this.rider; }
}
