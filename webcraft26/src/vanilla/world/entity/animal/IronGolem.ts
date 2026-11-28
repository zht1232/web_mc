// Source: net.minecraft.world.entity.animal.golem.IronGolem (26.2)
//
// Village protector. 100 health, 15 attack damage with the vanilla randomized
// roll, 1.0 knockback resistance and a 1-block step height. Target selectors
// are simplified to the shared HurtByTarget goal plus a nearest-monster scan
// (IronGolem.registerGoals targets Enemy mobs but never creepers). Player-built
// golems (carved pumpkin pattern) never attack players.
//
// Feeding an iron ingot heals 25 health (IronGolem.mobInteract); the crackiness
// overlay is derived from the health fraction by the renderer.

import { Mob } from '../Mob.js';
import { FloatGoal } from '../ai/goal/FloatGoal.js';
import { MeleeAttackGoal } from '../ai/goal/MeleeAttackGoal.js';
import { RandomStrollGoal } from '../ai/goal/RandomStrollGoal.js';
import { LookAtPlayerGoal } from '../ai/goal/LookAtPlayerGoal.js';
import { RandomLookAroundGoal } from '../ai/goal/RandomLookAroundGoal.js';
import { HurtByTargetGoal } from '../ai/goal/HurtByTargetGoal.js';
import { NearestAttackableTargetGoal } from '../ai/goal/NearestAttackableTargetGoal.js';
import { entityType } from '../EntityType.js';
import type { ClientLevel } from '../../level/ClientLevel.js';
import type { Targetable } from '../Entity.js';

/** Crackiness.GOLEM thresholds (low < 0.75, medium < 0.5, high < 0.25). */
export type GolemCrackiness = 'none' | 'low' | 'medium' | 'high';

export function golemCrackiness(fraction: number): GolemCrackiness {
  if (fraction < 0.25) return 'high';
  if (fraction < 0.5) return 'medium';
  if (fraction < 0.75) return 'low';
  return 'none';
}

export class IronGolem extends Mob {
  /** IronGolem.attackAnimationTick (10 on a hit, decremented every aiStep). */
  attackAnimationTick = 0;
  /** IronGolem.offerFlowerTick: 400 while holding a poppy out to a baby villager. */
  offerFlowerTick = 0;
  /** IronGolem DATA_FLAGS_ID & 1 (set by the carved-pumpkin pattern). */
  playerCreated = false;

  constructor(level: ClientLevel) {
    super(entityType('iron_golem'), level);
    this.speed = 0.25;
    this.maxHealth = 100;
    this.health = 100;
    this.attackDamage = 15;
  }

  protected registerGoals(): void {
    this.goalSelector.addGoal(0, new FloatGoal(this));
    this.goalSelector.addGoal(1, new MeleeAttackGoal(this, 1.0));
    this.goalSelector.addGoal(4, new RandomStrollGoal(this, 0.6));
    this.goalSelector.addGoal(7, new LookAtPlayerGoal(this, 6));
    this.goalSelector.addGoal(8, new RandomLookAroundGoal(this));
    this.targetSelector.addGoal(2, new HurtByTargetGoal(this));
    // IronGolem.registerGoals: nearest Enemy (never a Creeper). The port has no
    // Enemy marker, so the mob category stands in for `instanceof Enemy`.
    this.targetSelector.addGoal(3, new NearestAttackableTargetGoal(this, 16, (e) => this.isEnemy(e)));
  }

  /** Creeper is deliberately excluded by IronGolem.registerGoals. */
  private isEnemy(e: Targetable): boolean {
    return e.getTypeName() !== 'creeper' && e.getTypeName() !== 'player'
      && e.getTypeName() !== 'iron_golem'
      && (e as unknown as { getCategory?: () => { name: string } }).getCategory?.().name === 'MONSTER';
  }

  /** IronGolem.canAttack: player-created golems never hurt players, and never creepers. */
  override setTarget(target: Targetable | null): void {
    if (target && target.getTypeName() === 'creeper') return;
    if (target && target.getTypeName() === 'player' && this.playerCreated) return;
    super.setTarget(target);
  }

  aiStep(): void {
    super.aiStep();
    if (this.attackAnimationTick > 0) this.attackAnimationTick--;
    if (this.offerFlowerTick > 0) this.offerFlowerTick--;
  }

  /** IronGolem.doHurtTarget: randomized damage, upward knockback and the arm slam. */
  override doHurtTarget(target: Targetable): void {
    this.attackAnimationTick = 10;
    const dmg = this.attackDamage;
    // damage = (int)attackDamage > 0 ? attackDamage / 2 + rand(attackDamage) : attackDamage
    const damage = dmg / 2 + this.random.nextInt(Math.floor(dmg));
    target.hurt(damage, this);
    const push = (target as unknown as { push?: (x: number, y: number, z: number) => void }).push;
    if (typeof push === 'function') push.call(target, 0, 0.4, 0);
    this.swingProgress = 1;
  }

  /** IronGolem.mobInteract: an iron ingot repairs 25 health. */
  tryRepair(itemName: string): boolean {
    if (itemName !== 'iron_ingot') return false;
    if (this.health >= this.maxHealth) return false;
    this.heal(25);
    return true;
  }

  getCrackiness(): GolemCrackiness {
    return golemCrackiness(this.health / this.maxHealth);
  }
}
