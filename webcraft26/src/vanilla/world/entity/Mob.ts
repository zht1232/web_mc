// Source: net.minecraft.world.entity.Mob
//
// Adds the AI goal/target selectors, the path navigation, target tracking and
// melee damage. `serverAiStep` reproduces vanilla Mob.serverAiStep: reset the
// move control, follow the current path, run the target selector then the goal
// selector. Concrete mobs populate the selectors in registerGoals().

import { LivingEntity } from './LivingEntity.js';
import type { ClientLevel } from '../level/ClientLevel.js';
import type { EntityType } from './EntityType.js';
import type { Targetable, MobWorld } from './Entity.js';
import { GoalSelector } from './ai/goal/GoalSelector.js';
import { GroundPathNavigation, type PathNavigation } from './ai/navigation/GroundPathNavigation.js';

/**
 * Vanilla entity_type tag `minecraft:burn_in_daylight` (data/minecraft/tags/entity_type/
 * burn_in_daylight.json), restricted to the types this port creates.
 */
const BURN_IN_DAYLIGHT: ReadonlySet<string> = new Set([
  'skeleton', 'stray', 'bogged', 'parched', 'wither_skeleton', 'zombie', 'zombie_horse',
  'zombie_villager', 'drowned', 'zombie_nautilus', 'phantom',
]);

export class Mob extends LivingEntity {
  readonly goalSelector = new GoalSelector();
  readonly targetSelector = new GoalSelector();
  readonly navigation: PathNavigation;

  target: Targetable | null = null;
  aggressive = false;
  attackDamage = 3;
  /** max yaw/pitch degrees a LookAt goal may turn per tick */
  maxHeadRotation = 60;

  // ---- shared AI state (AgeableMob / TameableAnimal / Creeper subsets) ----
  inLove = false;
  loveTicks = 0;
  /** AgeableMob.age: < 0 baby (ticks until adult), 0 adult, > 0 breeding cooldown. */
  age = 0;
  parent: Mob | null = null;
  /** Render/model size before the baby factor is applied (cat 0.8, parrot 0.6 ...). */
  protected baseScale = 1;
  /** Creeper swelling (-1 = deflating, +1 = inflating, 0 = idle) */
  swell = 0;
  swellDir = -1;
  powered = false;

  private goalsRegistered = false;

  constructor(type: EntityType, level: ClientLevel) {
    super(type, level);
    this.navigation = new GroundPathNavigation(this, level);
  }

  /** Overridden by each concrete mob. Registered lazily so subclass fields exist. */
  protected registerGoals(): void {}

  // ---- target -------------------------------------------------------------

  getTarget(): Targetable | null { return this.target; }
  setTarget(target: Targetable | null): void { this.target = target; }
  setAggressive(v: boolean): void { this.aggressive = v; }
  isAggressive(): boolean { return this.aggressive; }
  getMaxHeadRotation(): number { return this.maxHeadRotation; }
  getNavigation(): PathNavigation { return this.navigation; }
  getWorld(): MobWorld | null { return this.world; }
  getPlayerTarget(): Targetable | null { return this.world ? this.world.getPlayer() : null; }

  /** Vanilla Mob.isWithinMeleeAttackRange (approximated with a 2-block reach). */
  isWithinMeleeAttackRange(target: Targetable): boolean {
    const dx = target.getX() - this.x, dz = target.getZ() - this.z;
    const dy = Math.abs(target.getY() - this.y);
    return dx * dx + dz * dz <= 4.0 && dy < 2.0;
  }

  /** Vanilla Mob.doHurtTarget. */
  doHurtTarget(target: Targetable): void {
    target.hurt(this.attackDamage, this);
    this.swingProgress = 1;
  }

  /** Vanilla Mob.getWalkTargetValue / checkSpawnRules (stub for parity). */
  getWalkTargetValue(_x: number, _y: number, _z: number): number { return 0; }

  /** Mob.finalizeSpawn hook; variants override to roll spawn equipment. */
  finalizeSpawn(): void {}

  // ---- shared AI helpers --------------------------------------------------

  isBaby(): boolean { return this.age < 0; }
  setBaby(baby: boolean): void { this.setAge(baby ? -24000 : 0); }
  getAge(): number { return this.age; }
  /** AgeableMob.setAge: babies render at half size, adults at their base scale. */
  setAge(age: number): void {
    this.age = age;
    this.scale = this.baseScale * (age < 0 ? 0.5 : 1);
  }
  isInLove(): boolean { return this.inLove || this.loveTicks > 0; }
  setInLove(v: boolean, ticks = 0): void {
    this.inLove = v;
    this.loveTicks = v ? Math.max(1, ticks || 600) : 0;
  }
  getParent(): Mob | null { return this.parent; }
  setParent(p: Mob | null): void { this.parent = p; }

  /** AgeableMob.spawnChildFromBreeding hook; Animal implements baby creation. */
  breedWith(_partner: Mob): void {}

  /** Ranged attackers override to spawn a projectile toward the target. */
  rangedAttack(_target: Targetable): void {}
  /** Creeper explosion hook (overridden by Creeper). */
  explode(): void {}

  /** Shared predicate: "is this the player?" for monster target goals. */
  protected readonly playerPredicate = (e: Targetable): boolean => e.getTypeName() === 'player';

  // ---- AI tick ------------------------------------------------------------

  /**
   * Source: net/minecraft/world/entity/Mob.java#aiStep / #burnUndead / #isSunBurnTick.
   * Undead mobs in the BURN_IN_DAYLIGHT tag ignite for 8 s when the sun is up,
   * their eye position sees the sky and they are not in water/rain. A helmet
   * (sunProtectionSlot) would prevent it in vanilla; the port has no equipment
   * wear simulation for mobs, so it always burns.
   */
  aiStep(): void {
    super.aiStep();
    if (BURN_IN_DAYLIGHT.has(this.type.name) && this.isSunBurnTick()) this.setOnFire(160);
  }

  private isSunBurnTick(): boolean {
    const eyeX = Math.floor(this.x);
    const eyeY = Math.floor(this.getEyeY());
    const eyeZ = Math.floor(this.z);
    const brightness = Math.min(1, this.level.getBrightness(eyeX, eyeY, eyeZ) / 15);
    if (brightness <= 0.5) return false;
    const rain = this.level.getRainLevel() > 0.2 && this.level.canSeeSky(eyeX, eyeY, eyeZ);
    if (this.inWater || rain) return false;
    if (!this.level.canSeeSky(eyeX, eyeY, eyeZ)) return false;
    // Mob.isSunBurnTick: random.nextFloat() * 30 < (br - 0.4) * 2
    return this.random.nextFloat() * 30 < (brightness - 0.4) * 2;
  }

  /** Vanilla Mob.serverAiStep. */
  serverAiStep(): void {
    if (!this.goalsRegistered) { this.goalsRegistered = true; this.registerGoals(); }
    // reset the movement intent each tick; the active movement goal refills it
    this.moveControl.reset();
    this.navigation.tick();
    this.targetSelector.tick();
    this.goalSelector.tick();
  }

  tick(): void {
    this.baseTick();
    this.serverAiStep();
    this.aiStep();
    this.tickAgeable();
    if (this.dead && this.deathTime > 20) this.remove();
  }

  /**
   * AgeableMob.tick: babies grow 1 tick at a time, adults count down the breeding
   * cooldown (setAge(6000) after a successful breeding), and love expires after
   * 600 ticks. Hearts are emitted every 10 ticks while in love.
   */
  private tickAgeable(): void {
    if (this.age > 0) {
      this.age--;
    } else if (this.age < 0) {
      this.age++;
      if (this.age >= 0) this.setAge(0);
    }
    if (this.loveTicks > 0) {
      this.loveTicks--;
      if (this.loveTicks === 0) this.inLove = false;
      else if (this.loveTicks % 10 === 0) this.world?.onAnimalLove?.(this);
    }
  }
}
