// Source: net.minecraft.world.food.FoodData (26.2)
//         net.minecraft.world.food.FoodConstants (26.2)
//         net.minecraft.server.level.ServerPlayer#checkMovementStatistics / #jumpFromGround
//         net.minecraft.world.level.block.Block#playerDestroy (0.005 exhaustion)

export const FOOD_CONSTANTS = {
  MAX_FOOD: 20,
  MAX_SATURATION: 20,
  START_SATURATION: 5,
  SATURATION_FLOOR: 2.5,
  EXHAUSTION_DROP: 4,
  HEALTH_TICK_COUNT: 80,
  HEALTH_TICK_COUNT_SATURATED: 10,
  HEAL_LEVEL: 18,
  SPRINT_LEVEL: 6,
  STARVE_LEVEL: 0,
  EXHAUSTION_HEAL: 6,
  EXHAUSTION_JUMP: 0.05,
  EXHAUSTION_SPRINT_JUMP: 0.2,
  EXHAUSTION_MINE: 0.005,
  EXHAUSTION_ATTACK: 0.1,
  EXHAUSTION_WALK: 0,
  EXHAUSTION_CROUCH: 0,
  EXHAUSTION_SPRINT: 0.1,
  EXHAUSTION_SWIM: 0.01,
} as const;

export function saturationByModifier(nutrition: number, modifier: number): number {
  return nutrition * modifier * 2;
}

export type Difficulty = 'PEACEFUL' | 'EASY' | 'NORMAL' | 'HARD';

/** The subset of ServerPlayer that FoodData.tick needs. */
export interface FoodTickPlayer {
  getHealth(): number;
  getMaxHealth(): number;
  isHurt(): boolean;
  heal(amount: number): void;
  hurt(amount: number, source: string): void;
}

export class FoodData {
  private foodLevel = 20;
  private saturationLevel = 5;
  private exhaustionLevel = 0;
  private tickTimer = 0;

  private add(food: number, saturation: number): void {
    this.foodLevel = Math.max(0, Math.min(food + this.foodLevel, 20));
    this.saturationLevel = Math.max(0, Math.min(saturation + this.saturationLevel, this.foodLevel));
  }

  /** FoodData.eat(int nutrition, float saturationModifier). */
  eat(nutrition: number, saturationModifier: number): void {
    this.add(nutrition, saturationByModifier(nutrition, saturationModifier));
  }
  /** FoodData.eat(FoodProperties). */
  eatProperties(nutrition: number, saturation: number): void {
    this.add(nutrition, saturation);
  }

  /** FoodData.tick, verbatim (naturalRegen gamerule + difficulty configurable). */
  tick(player: FoodTickPlayer, difficulty: Difficulty = 'NORMAL', naturalRegen = true): void {
    if (this.exhaustionLevel > FOOD_CONSTANTS.EXHAUSTION_DROP) {
      this.exhaustionLevel -= FOOD_CONSTANTS.EXHAUSTION_DROP;
      if (this.saturationLevel > 0) {
        this.saturationLevel = Math.max(this.saturationLevel - 1, 0);
      } else if (difficulty !== 'PEACEFUL') {
        this.foodLevel = Math.max(this.foodLevel - 1, 0);
      }
    }

    if (naturalRegen && this.saturationLevel > 0 && player.isHurt() && this.foodLevel >= 20) {
      this.tickTimer++;
      if (this.tickTimer >= FOOD_CONSTANTS.HEALTH_TICK_COUNT_SATURATED) {
        const saturationSpent = Math.min(this.saturationLevel, 6);
        player.heal(saturationSpent / 6);
        this.addExhaustion(saturationSpent);
        this.tickTimer = 0;
      }
    } else if (naturalRegen && this.foodLevel >= FOOD_CONSTANTS.HEAL_LEVEL && player.isHurt()) {
      this.tickTimer++;
      if (this.tickTimer >= FOOD_CONSTANTS.HEALTH_TICK_COUNT) {
        player.heal(1);
        this.addExhaustion(FOOD_CONSTANTS.EXHAUSTION_HEAL);
        this.tickTimer = 0;
      }
    } else if (this.foodLevel <= 0) {
      this.tickTimer++;
      if (this.tickTimer >= FOOD_CONSTANTS.HEALTH_TICK_COUNT) {
        const health = player.getHealth();
        if (health > 10 || difficulty === 'HARD' || (health > 1 && difficulty === 'NORMAL')) {
          player.hurt(1, 'starve');
        }
        this.tickTimer = 0;
      }
    } else {
      this.tickTimer = 0;
    }
  }

  // ---- movement exhaustion (ServerPlayer.checkMovementStatistics / jumpFromGround) --

  addExhaustion(amount: number): void {
    this.exhaustionLevel = Math.min(this.exhaustionLevel + amount, 40);
  }
  /** ServerPlayer.jumpFromGround: sprint-jump 0.2, normal jump 0.05. */
  onJump(sprinting: boolean): void {
    this.addExhaustion(sprinting ? FOOD_CONSTANTS.EXHAUSTION_SPRINT_JUMP : FOOD_CONSTANTS.EXHAUSTION_JUMP);
  }
  /** 0.1 * horizontalDistanceCm * 0.01 (sprinting). */
  onSprint(distanceCm: number): void {
    if (distanceCm > 0) this.addExhaustion(FOOD_CONSTANTS.EXHAUSTION_SPRINT * distanceCm * 0.01);
  }
  /** 0.01 * distanceCm * 0.01 (swimming / in water). */
  onSwim(distanceCm: number): void {
    if (distanceCm > 0) this.addExhaustion(FOOD_CONSTANTS.EXHAUSTION_SWIM * distanceCm * 0.01);
  }
  /** Block.playerDestroy: 0.005 per block broken. */
  onBreakBlock(): void { this.addExhaustion(FOOD_CONSTANTS.EXHAUSTION_MINE); }
  /** Player.attack: 0.1 on a successful hit. */
  onAttack(): void { this.addExhaustion(FOOD_CONSTANTS.EXHAUSTION_ATTACK); }

  // ---- state --------------------------------------------------------------

  getFoodLevel(): number { return this.foodLevel; }
  getSaturationLevel(): number { return this.saturationLevel; }
  getExhaustionLevel(): number { return this.exhaustionLevel; }
  getTickTimer(): number { return this.tickTimer; }
  setFoodLevel(food: number): void { this.foodLevel = Math.max(0, Math.min(food, 20)); }
  setSaturation(saturation: number): void { this.saturationLevel = Math.max(0, saturation); }
  setExhaustion(exhaustion: number): void { this.exhaustionLevel = Math.max(0, Math.min(exhaustion, 40)); }
  needsFood(): boolean { return this.foodLevel < 20; }
  hasEnoughFood(): boolean { return this.foodLevel > FOOD_CONSTANTS.SPRINT_LEVEL; }

  /** FoodData.readAdditionalSaveData / addAdditionalSaveData. */
  save(): { foodLevel: number; tickTimer: number; saturationLevel: number; exhaustionLevel: number } {
    return {
      foodLevel: this.foodLevel, tickTimer: this.tickTimer,
      saturationLevel: this.saturationLevel, exhaustionLevel: this.exhaustionLevel,
    };
  }
  load(data: { foodLevel?: number; tickTimer?: number; saturationLevel?: number; exhaustionLevel?: number }): void {
    this.foodLevel = data.foodLevel ?? 20;
    this.tickTimer = data.tickTimer ?? 0;
    this.saturationLevel = data.saturationLevel ?? 5;
    this.exhaustionLevel = data.exhaustionLevel ?? 0;
  }
}
