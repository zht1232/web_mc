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
  /** negative => baby, >= 0 => adult (vanilla AgeableMob.age) */
  age = 0;
  parent: Mob | null = null;
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

  // ---- shared AI helpers --------------------------------------------------

  isBaby(): boolean { return this.age < 0; }
  setBaby(baby: boolean): void { this.age = baby ? -24000 : 0; }
  getAge(): number { return this.age; }
  isInLove(): boolean { return this.inLove || this.loveTicks > 0; }
  setInLove(v: boolean, ticks = 0): void { this.inLove = v; this.loveTicks = ticks; }
  getParent(): Mob | null { return this.parent; }
  setParent(p: Mob | null): void { this.parent = p; }

  /** Ranged attackers override to spawn a projectile toward the target. */
  rangedAttack(_target: Targetable): void {}
  /** Creeper explosion hook (overridden by Creeper). */
  explode(): void {}

  /** Shared predicate: "is this the player?" for monster target goals. */
  protected readonly playerPredicate = (e: Targetable): boolean => e.getTypeName() === 'player';

  // ---- AI tick ------------------------------------------------------------

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
    if (this.dead && this.deathTime > 20) this.remove();
  }
}
