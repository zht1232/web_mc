// Source: net.minecraft.world.entity.LivingEntity
//
// Adds health, damage/knockback, status effects, equipment, head/body rotation
// and `aiStep` (movement input -> travel -> swept collision). Movement uses the
// same friction/acceleration equilibrium as player/Player.ts so that a goal's
// desired speed is reached smoothly and deterministically.

import {
  Entity, GRAVITY, VERTICAL_DRAG, GROUND_FRICTION, AIR_FRICTION, JUMP_VELOCITY, TERMINAL_FALL,
  type Targetable,
} from './Entity.js';
import type { ClientLevel } from '../level/ClientLevel.js';
import type { EntityType } from './EntityType.js';
import { EquipmentSlot } from './EquipmentSlot.js';
import { wrapDegrees, approachDegrees, clamp } from '../../core/Mth.js';

export interface ItemStack { id: string; count: number; }

export interface MobEffectInstance {
  readonly type: string;
  amplifier: number;
  duration: number;
}

/** Port of net.minecraft.world.entity.ai.control.MoveControl (simplified). */
export class MoveControl {
  wantedX = 0; wantedY = 0; wantedZ = 0; speed = 0;
  private active = false;

  setWantedPosition(x: number, y: number, z: number, speed: number): void {
    this.wantedX = x; this.wantedY = y; this.wantedZ = z;
    this.speed = speed; this.active = true;
  }
  hasWanted(): boolean { return this.active; }
  getWantedX(): number { return this.wantedX; }
  getWantedY(): number { return this.wantedY; }
  getWantedZ(): number { return this.wantedZ; }
  getSpeedModifier(): number { return this.speed; }
  reset(): void { this.active = false; this.speed = 0; }
}

export class LivingEntity extends Entity implements Targetable {
  health = 20;
  maxHealth = 20;
  hurtTime = 0;
  hurtDuration = 0;
  dead = false;
  deathTime = 0;

  /** base movement speed in blocks/tick (vanilla movement_speed attribute) */
  speed = 0.25;
  /** normalized horizontal input for this tick (-1..1 each axis) */
  protected moveX = 0;
  protected moveZ = 0;
  protected targetSpeed = 0;
  jumping = false;

  yHeadRot = 0; yHeadRotO = 0;
  yBodyRot = 0; yBodyRotO = 0;
  walkDist = 0; walkDistO = 0;
  swingProgress = 0;
  attackStrengthScale = 1;

  /**
   * Port of net/minecraft/world/entity/WalkAnimationState (vanilla fields
   * speedOld / speed / position), consumed by the entity renderers:
   *   speed  = smoothed distance moved this tick * 4, clamped to 1
   *   pos    = running sum of speed (limb swing phase)
   * Source: LivingEntity#aiStep -> this.walkAnimation.update(distance * 4, 0.4F).
   */
  walkAnimSpeed = 0;
  walkAnimSpeedOld = 0;
  walkAnimPos = 0;

  readonly moveControl = new MoveControl();
  /** indexed by EquipmentSlot.index / armorIndex+? ; 0..5 humanoid, 6 body */
  readonly equipment: (ItemStack | null)[] = new Array(7).fill(null);
  readonly activeEffects = new Map<string, MobEffectInstance>();

  lastHurtBy: Targetable | null = null;
  lastHurtByMobTime = 0;

  constructor(type: EntityType, level: ClientLevel) {
    super(type, level);
    this.health = this.maxHealth;
    this.yHeadRot = this.yaw;
    this.yBodyRot = this.yaw;
  }

  // ---- health / damage ----------------------------------------------------

  getMaxHealth(): number { return this.maxHealth; }
  getHealth(): number { return this.health; }
  setHealth(h: number): void { this.health = clamp(h, 0, this.maxHealth); }
  heal(amount: number): void { if (this.health > 0) this.setHealth(this.health + amount); }
  isDead(): boolean { return this.dead; }
  isAlive(): boolean { return !this.removed && !this.dead; }

  /** Vanilla LivingEntity.hurt: i-frames, armor reduction, knockback, death. */
  hurt(amount: number, attacker: Targetable | null): void {
    if (this.dead || this.removed || amount <= 0) return;
    if (this.hurtTime > 0) return; // invulnerability frames
    const armor = this.getArmorValue();
    const actual = Math.max(0, amount * (1 - Math.min(armor, 20) * 0.04));
    this.health -= actual;
    this.hurtTime = this.hurtDuration = 10;

    if (attacker) {
      const dx = this.x - attacker.getX(), dz = this.z - attacker.getZ();
      const len = Math.hypot(dx, dz) || 1;
      this.push((dx / len) * 0.4, 0.36, (dz / len) * 0.4);
      this.lastHurtBy = attacker;
      this.lastHurtByMobTime = this.tickCount;
    }
    if (this.health <= 0) this.die(attacker);
  }

  protected die(_attacker: Targetable | null): void {
    if (this.dead) return;
    this.dead = true;
    this.deathTime = 0;
    this.moveControl.reset();
    // Mob.deathTime path: drop loot / XP once, before the corpse is removed.
    this.world?.onMobDeath?.(this);
  }

  /** Vanilla LivingEntity.knockback. */
  knockback(strength: number, dx: number, dz: number): void {
    const len = Math.hypot(dx, dz) || 1;
    this.push((dx / len) * strength, strength * 0.9, (dz / len) * strength);
  }

  // ---- equipment ----------------------------------------------------------

  getArmorValue(): number {
    let v = 0;
    for (const slot of EquipmentSlot.HUMAN_ARMOR_SLOTS) {
      if (this.getItemBySlot(slot)) v += 2;
    }
    return v;
  }
  getItemBySlot(slot: EquipmentSlot): ItemStack | null {
    const i = slot.isArmor() ? 2 + slot.armorIndex : slot.index;
    return this.equipment[i] ?? null;
  }
  setItemSlot(slot: EquipmentSlot, stack: ItemStack | null): void {
    const i = slot.isArmor() ? 2 + slot.armorIndex : slot.index;
    this.equipment[i] = stack;
  }
  getMainHandItem(): ItemStack | null { return this.getItemBySlot(EquipmentSlot.MAINHAND); }

  // ---- effects ------------------------------------------------------------

  addEffect(type: string, duration: number, amplifier = 0): void {
    this.activeEffects.set(type, { type, duration, amplifier });
  }
  removeEffect(type: string): void { this.activeEffects.delete(type); }
  hasEffect(type: string): boolean { return this.activeEffects.has(type); }
  getEffect(type: string): MobEffectInstance | undefined { return this.activeEffects.get(type); }
  private tickEffects(): void {
    for (const [k, e] of this.activeEffects) {
      e.duration--;
      if (e.duration <= 0) this.activeEffects.delete(k);
    }
  }

  // ---- movement -----------------------------------------------------------

  getSpeed(): number { return this.speed; }
  setSpeed(s: number): void { this.speed = s; }
  setJumping(v: boolean): void { this.jumping = v; }
  getMoveControl(): MoveControl { return this.moveControl; }
  getLastHurtBy(): Targetable | null { return this.lastHurtBy; }
  getLastHurtByMobTime(): number { return this.lastHurtByMobTime; }

  /** Vanilla LivingEntity.aiStep (client-side subset) + travel. */
  aiStep(): void {
    if (this.hurtTime > 0) this.hurtTime--;
    this.deathTime++;
    if (this.activeEffects.size > 0) this.tickEffects();

    this.yBodyRotO = this.yBodyRot; this.yHeadRotO = this.yHeadRot;
    this.walkDistO = this.walkDist;

    this.updateMovementInput();
    this.travel();

    const dx = this.x - this.xo, dz = this.z - this.zo;
    this.walkDist += Math.hypot(dx, dz) * 0.6;
    this.animSwing = Math.sin(this.walkDist * 0.6662) * 0.5;

    // WalkAnimationState.update(horizontalMovement * 4, 0.4)
    this.walkAnimSpeedOld = this.walkAnimSpeed;
    const moved = Math.hypot(dx, dz) * 4;
    this.walkAnimSpeed += (moved - this.walkAnimSpeed) * 0.4;
    if (this.walkAnimSpeed > 1) this.walkAnimSpeed = 1;
    this.walkAnimPos += this.walkAnimSpeed;

    // head/body rotation follows the entity yaw (vanilla clamps head to body)
    this.yBodyRot = this.yaw;
    const diff = wrapDegrees(this.yaw - this.yBodyRot);
    this.yHeadRot = approachDegrees(this.yHeadRot, this.yBodyRot + diff, 75);
    this.swingProgress *= 0.9;
  }

  /** Turns the move control's wanted position into a normalized input + facing. */
  protected updateMovementInput(): void {
    const mc = this.moveControl;
    if (mc.hasWanted()) {
      const dx = mc.getWantedX() - this.x, dz = mc.getWantedZ() - this.z;
      const len = Math.hypot(dx, dz);
      if (len > 0.02) {
        this.moveX = dx / len; this.moveZ = dz / len;
        // goals pass a multiplier of the movement_speed attribute
        this.targetSpeed = mc.getSpeedModifier() * this.speed;
        this.yaw = this.yawTowards(mc.getWantedX(), mc.getWantedZ());
      } else {
        this.moveX = 0; this.moveZ = 0; this.targetSpeed = 0;
      }
    } else {
      this.moveX = 0; this.moveZ = 0; this.targetSpeed = 0;
    }
  }

  /** Vanilla LivingEntity.travel: friction/accel + gravity, then Entity.move. */
  protected travel(): void {
    const damping = this.onGround ? GROUND_FRICTION : AIR_FRICTION;
    if (this.targetSpeed > 0) {
      const accel = (this.targetSpeed * (1 - damping)) / damping;
      this.vx = (this.vx + this.moveX * accel) * damping;
      this.vz = (this.vz + this.moveZ * accel) * damping;
    } else {
      this.vx *= damping;
      this.vz *= damping;
    }

    if (!this.noGravity) {
      if (this.jumping && this.onGround) { this.vy = JUMP_VELOCITY; this.onGround = false; }
      else if (this.jumping && this.inWater) this.vy = 0.04;
      this.vy = (this.vy - GRAVITY) * VERTICAL_DRAG;
      if (this.vy < -TERMINAL_FALL) this.vy = -TERMINAL_FALL;
      if (this.inWater) { this.vy *= 0.8; }
    } else {
      // flying mobs (bat): steer vertically toward the wanted Y
      const mc = this.moveControl;
      if (mc.hasWanted()) {
        const dy = mc.getWantedY() - this.y;
        this.vy = clamp(dy * 0.12, -0.18, 0.18);
      } else {
        this.vy *= 0.9;
      }
    }
    this.jumping = false;
    this.move(this.vx, this.vy, this.vz);
  }

  /** Vanilla LivingEntity.lookAt / getMaxHeadRotation helpers. */
  lookAt(target: Targetable, maxYaw: number, maxPitch: number): void {
    const dx = target.getX() - this.x;
    const dz = target.getZ() - this.z;
    const dy = (target.getY() + target.getHeight() * 0.85) - this.getEyeY();
    const horiz = Math.hypot(dx, dz);
    const wantYaw = Math.atan2(-dx, dz) / (Math.PI / 180);
    const wantPitch = -Math.atan2(dy, horiz) / (Math.PI / 180);
    this.yaw = approachDegrees(this.yaw, wantYaw, maxYaw);
    this.pitch = approachDegrees(this.pitch, wantPitch, maxPitch);
  }

  /** Vanilla Entity.getEyeHeight(Pose) exposed for goals. */
  getStandingEyeHeight(): number { return this.getEyeHeight(); }

  tick(): void {
    this.baseTick();
    this.aiStep();
    this.tickDamageOverTime();
  }

  /**
   * Port of the server-side fire/lava damage that Entity.baseTick and
   * LivingEntity.baseTick apply (net/minecraft/world/entity/Entity.java:
   * remainingFireTicks % 20 == 0 -> onFire damage 1; lavaHurt -> 4 damage).
   */
  protected tickDamageOverTime(): void {
    if (this.inLava) {
      this.fireTicks = Math.max(this.fireTicks, 300); // lavaIgnite: 15 s
      if (this.tickCount % 10 === 0) this.hurt(4, null);
      return;
    }
    if (this.fireTicks > 0) {
      if (this.inWater) {
        this.fireTicks = Math.max(0, this.fireTicks - 4);
      } else if (this.tickCount % 20 === 0) {
        this.hurt(1, null);
      }
    }
  }
}
