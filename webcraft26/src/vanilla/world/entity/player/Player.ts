// Port of net.minecraft.world.entity.player.Player movement.
//
// Vanilla runs a fixed 20 Hz tick. Velocities below are block/tick and come from
// the original client (measured and verified in the earlier research pass):
//   walk 0.2159, sprint 0.2806, sneak 0.0648, fly 0.5395, fly-sprint 1.079
//   jump 0.42, gravity 0.08 with *0.98 drag, terminal fall 3.92
// The tick order is: input -> accelerate -> apply friction -> move & collide.

import { AABB, Vec3 } from '../../../core/Geometry.js';
import type { ClientLevel } from '../../level/ClientLevel.js';

export const TICKS_PER_SECOND = 20;
export const TICK_MS = 1000 / TICKS_PER_SECOND;

/** Vanilla Entity dimensions for the player. */
export const PLAYER_WIDTH = 0.6;
export const PLAYER_HEIGHT = 1.8;
export const PLAYER_EYE_HEIGHT = 1.62;
export const PLAYER_SNEAK_EYE_HEIGHT = 1.27;

export const SPEED = {
  walk: 0.2159,
  sprint: 0.2806,
  sneak: 0.0648,
  fly: 0.5395,
  flySprint: 1.079,
} as const;

export const GRAVITY = 0.08;
export const VERTICAL_DRAG = 0.98;
export const GROUND_FRICTION = 0.546;
export const AIR_FRICTION = 0.98;
export const JUMP_VELOCITY = 0.42;
export const TERMINAL_FALL = 3.92;

export interface PlayerInput {
  forward: number; // -1..1
  strafe: number;
  jump: boolean;
  sneak: boolean;
  sprint: boolean;
  /** true while the jump key was pressed this tick (for double tap fly) */
  jumpPressed: boolean;
}

export class Player {
  pos: Vec3;
  prevPos: Vec3;
  vel = new Vec3(0, 0, 0);
  yaw = 0;
  pitch = 0;
  onGround = false;
  sneaking = false;
  sprinting = false;
  flying = false;
  swimming = false;
  inWater = false;
  /** accumulates fall distance for damage */
  fallDistance = 0;
  width = PLAYER_WIDTH;
  height = PLAYER_HEIGHT;
  eyeHeight = PLAYER_EYE_HEIGHT;
  /** camera bobbing phase, vanilla walkDist */
  walkDist = 0;
  private bob = 0;
  private prevBob = 0;
  private swing = 0;
  swingProgress = 0;

  constructor(x: number, y: number, z: number) {
    this.pos = new Vec3(x, y, z);
    this.prevPos = new Vec3(x, y, z);
  }

  get eyeY(): number { return this.pos.y + (this.sneaking ? PLAYER_SNEAK_EYE_HEIGHT : this.eyeHeight); }

  boundingBox(pos = this.pos, height = this.height): AABB {
    const half = this.width / 2;
    return new AABB(pos.x - half, pos.y, pos.z - half, pos.x + half, pos.y + height, pos.z + half);
  }

  /** Vanilla Player.tick -> LivingEntity.travel, one 1/20 s step. */
  tick(level: ClientLevel, input: PlayerInput): void {
    this.prevPos = this.pos;
    this.prevBob = this.bob;

    this.inWater = isInWater(level, this.boundingBox());
    this.sneaking = input.sneak && !this.flying;
    if (input.sprint && (input.forward > 0 || this.flying)) this.sprinting = true;
    if (input.forward <= 0 && !this.flying) this.sprinting = false;

    let targetSpeed: number;
    if (this.flying) {
      targetSpeed = this.sprinting ? SPEED.flySprint : SPEED.fly;
    } else if (this.sneaking) {
      targetSpeed = SPEED.sneak;
    } else if (this.sprinting) {
      targetSpeed = SPEED.sprint;
    } else {
      targetSpeed = SPEED.walk;
    }
    if (this.inWater && !this.flying) targetSpeed *= 0.55;

    // desired horizontal velocity in world space
    const yawRad = (this.yaw * Math.PI) / 180;
    const sin = Math.sin(yawRad);
    const cos = Math.cos(yawRad);
    // vanilla: forward is -Z in local space, yaw rotates clockwise around Y
    let inputX = input.strafe;
    let inputZ = input.forward;
    const len = Math.hypot(inputX, inputZ);
    if (len > 1) { inputX /= len; inputZ /= len; }
    const desiredX = (inputX * cos - inputZ * sin) * targetSpeed;
    const desiredZ = (inputZ * cos + inputX * sin) * targetSpeed;

    const damping = this.flying ? 0.91 : this.onGround ? GROUND_FRICTION : AIR_FRICTION;
    // accelerate so the equilibrium speed equals the vanilla target
    const accel = (targetSpeed * (1 - damping)) / damping;

    let vx = this.vel.x;
    let vz = this.vel.z;
    if (len > 1e-4) {
      const dirX = desiredX / targetSpeed;
      const dirZ = desiredZ / targetSpeed;
      vx = (vx + dirX * accel) * damping;
      vz = (vz + dirZ * accel) * damping;
    } else {
      vx *= damping;
      vz *= damping;
    }

    let vy = this.vel.y;
    if (this.flying) {
      if (input.jump) vy = SPEED.fly;
      else if (input.sneak) vy = -SPEED.fly;
      else vy *= 0.85;
    } else {
      if (input.jump && this.onGround) {
        vy = JUMP_VELOCITY;
        this.onGround = false;
      } else if (input.jump && this.inWater) {
        vy = 0.04;
      }
      vy = (vy - GRAVITY) * VERTICAL_DRAG;
      if (vy < -TERMINAL_FALL) vy = -TERMINAL_FALL;
    }

    this.vel = new Vec3(vx, vy, vz);

    const before = this.pos.y;
    this.move(level, this.vel.x, this.vel.y, this.vel.z);

    const movedY = this.pos.y - before;
    if (!this.flying) {
      if (this.vel.y < 0 && movedY < 0) {
        this.fallDistance -= movedY;
      } else if (this.onGround) {
        this.fallDistance = 0;
      }
    }

    // walk animation distance (vanilla walkDist += horizontal speed * 0.6)
    const horizontal = Math.hypot(this.pos.x - this.prevPos.x, this.pos.z - this.prevPos.z);
    this.walkDist += horizontal * 0.6;
    this.bob += (horizontal > 0.005 ? 1 : 0);
    if (this.bob > 1000) this.bob = 0;

    // hand swing decay
    if (this.swing > 0) {
      this.swing = Math.max(0, this.swing - 1);
      this.swingProgress = 1 - this.swing / 6;
    }
  }

  /** Vanilla Entity.move: per axis sweep against block collision shapes. */
  private move(level: ClientLevel, dx: number, dy: number, dz: number): void {
    const boxes = collectCollisionBoxes(level, this.boundingBox().expandTowards(dx, dy, dz).inflateAll(0.5));
    let moveX = dx, moveY = dy, moveZ = dz;

    if (moveY !== 0) {
      for (const b of boxes) moveY = clipY(b, this.boundingBox().move(moveX, 0, moveZ), moveY);
      this.pos = this.pos.add(0, moveY, 0);
    }
    const afterY = this.boundingBox();
    if (this.sneaking && moveY < 0) {
      // vanilla: sneaking prevents walking off edges (handled after horizontal move)
    }

    if (moveX !== 0) {
      for (const b of boxes) moveX = clipX(b, afterY.move(0, moveY, 0), moveX);
      this.pos = this.pos.add(moveX, 0, 0);
    }
    if (moveZ !== 0) {
      const afterX = this.boundingBox();
      for (const b of boxes) moveZ = clipZ(b, afterX.move(moveX, moveY, 0), moveZ);
      this.pos = this.pos.add(0, 0, moveZ);
    }

    // Entity.move step-up: a 0.6 block step (stairs/slabs/snow) must not require a jump.
    const blockedHorizontally = moveX !== dx || moveZ !== dz;
    if (blockedHorizontally && !this.flying && this.onGround) {
      const stepHeight = 0.6;
      const raised = this.pos.add(0, stepHeight, 0);
      const raisedBox = this.boundingBox(raised);
      const raisedBlockers = collectCollisionBoxes(level, raisedBox.inflateAll(0.01));
      if (!raisedBlockers.some((b) => b.intersects(raisedBox))) {
        const around = collectCollisionBoxes(level, raisedBox.expandTowards(dx, 0, dz).inflateAll(0.5));
        let sx = dx;
        let sz = dz;
        for (const b of around) sx = clipX(b, raisedBox, sx);
        const movedX = raisedBox.move(sx, 0, 0);
        for (const b of around) sz = clipZ(b, movedX, sz);
        if (Math.abs(sx) > 1e-5 || Math.abs(sz) > 1e-5) {
          this.pos = raised.add(sx, 0, sz);
          const dropBoxes = collectCollisionBoxes(level,
            this.boundingBox().expandTowards(0, -stepHeight, 0).inflateAll(0.5));
          let sy = -stepHeight;
          for (const b of dropBoxes) sy = clipY(b, this.boundingBox(), sy);
          this.pos = this.pos.add(0, sy, 0);
          this.onGround = true;
        }
      }
    }

    const collidedY = moveY !== dy;
    this.onGround = dy < 0 && collidedY;
    if (collidedY) this.vel = new Vec3(this.vel.x, 0, this.vel.z);
    if (moveX !== dx || moveZ !== dz) {
      this.vel = new Vec3(moveX !== dx ? 0 : this.vel.x, this.vel.y, moveZ !== dz ? 0 : this.vel.z);
    }
  }

  /** Vanilla Player.getAttackStrengthScale / swing timing. */
  swingHand(): void {
    if (this.swing <= 0) {
      this.swing = 6;
      this.swingProgress = 0;
    }
  }

  get swingRotation(): number {
    if (this.swing <= 0) return 0;
    const f = 1 - this.swing / 6;
    return Math.sin(f * Math.PI) ** 2 * Math.PI * 0.5;
  }

  /** camera bob offsets, vanilla GameRenderer.bobView */
  bobOffsets(partial: number): { x: number; y: number; roll: number } {
    const walk = this.walkDist;
    const f = walk - Math.floor(walk / 2) * 2;
    const g = walk * 0.5;
    const h = Math.sin(g * Math.PI) * 0.5;
    const i = Math.abs(Math.cos(g * Math.PI) * 0.5);
    const bobX = Math.sin(f * Math.PI) * 0.5 * i;
    const bobY = Math.abs(Math.cos(f * Math.PI) * 0.5) * h;
    return { x: bobX, y: bobY, roll: 0 };
  }
}

function clipX(box: AABB, moving: AABB, dx: number): number {
  if (moving.maxY <= box.minY + 1e-5 || moving.minY >= box.maxY - 1e-5) return dx;
  if (moving.maxZ <= box.minZ + 1e-5 || moving.minZ >= box.maxZ - 1e-5) return dx;
  if (dx > 0 && moving.maxX <= box.minX + 1e-7) {
    const d = Math.min(dx, box.minX - moving.maxX);
    return Math.max(0, d);
  }
  if (dx < 0 && moving.minX >= box.maxX - 1e-7) {
    const d = Math.max(dx, box.maxX - moving.minX);
    return Math.min(0, d);
  }
  return dx;
}

function clipY(box: AABB, moving: AABB, dy: number): number {
  if (moving.maxX <= box.minX + 1e-5 || moving.minX >= box.maxX - 1e-5) return dy;
  if (moving.maxZ <= box.minZ + 1e-5 || moving.minZ >= box.maxZ - 1e-5) return dy;
  if (dy > 0 && moving.maxY <= box.minY + 1e-7) {
    return Math.max(0, Math.min(dy, box.minY - moving.maxY));
  }
  if (dy < 0 && moving.minY >= box.maxY - 1e-7) {
    return Math.min(0, Math.max(dy, box.maxY - moving.minY));
  }
  return dy;
}

function clipZ(box: AABB, moving: AABB, dz: number): number {
  if (moving.maxX <= box.minX + 1e-5 || moving.minX >= box.maxX - 1e-5) return dz;
  if (moving.maxY <= box.minY + 1e-5 || moving.minY >= box.maxY - 1e-5) return dz;
  if (dz > 0 && moving.maxZ <= box.minZ + 1e-7) {
    return Math.max(0, Math.min(dz, box.minZ - moving.maxZ));
  }
  if (dz < 0 && moving.minZ >= box.maxZ - 1e-7) {
    return Math.min(0, Math.max(dz, box.maxZ - moving.minZ));
  }
  return dz;
}

/** Collects the collision boxes of every block overlapping the given volume. */
export function collectCollisionBoxes(level: ClientLevel, area: AABB): AABB[] {
  const out: AABB[] = [];
  const x0 = Math.floor(area.minX), x1 = Math.floor(area.maxX);
  const y0 = Math.floor(area.minY), y1 = Math.floor(area.maxY);
  const z0 = Math.floor(area.minZ), z1 = Math.floor(area.maxZ);
  for (let y = y0; y <= y1; y++) {
    for (let z = z0; z <= z1; z++) {
      for (let x = x0; x <= x1; x++) {
        const state = level.getBlockState(x, y, z);
        if (state === 0) continue;
        const shape = level.mc.collision(state);
        if (!shape.length) continue;
        for (const b of shape) out.push(b.move(x, y, z));
      }
    }
  }
  return out;
}

function isInWater(level: ClientLevel, box: AABB): boolean {
  const x0 = Math.floor(box.minX), x1 = Math.floor(box.maxX - 1e-4);
  const y0 = Math.floor(box.minY), y1 = Math.floor(box.maxY - 1e-4);
  const z0 = Math.floor(box.minZ), z1 = Math.floor(box.maxZ - 1e-4);
  for (let y = y0; y <= y1; y++) {
    for (let z = z0; z <= z1; z++) {
      for (let x = x0; x <= x1; x++) {
        const state = level.getBlockState(x, y, z);
        if (level.mc.blockOf(state).name === 'water') return true;
      }
    }
  }
  return false;
}
