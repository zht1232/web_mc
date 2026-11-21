// Source: net.minecraft.world.entity.AreaEffectCloud (potion cloud half only)
//
// A lingering potion's cloud: radius 3, wait 10 ticks, lifetime 600, shrinking
// by 3/600 per tick and by 0.5 for every entity it affects. Effects are applied
// every 5 ticks, each victim at most once per 20 ticks, at 0.25 duration scale.
//
// Rendering: this port has no cloud model yet (the entity is invisible); the
// gameplay effects are the vanilla ones.

import { Entity } from './Entity.js';
import { entityType } from './EntityType.js';
import type { ClientLevel } from '../level/ClientLevel.js';

export const LINGERING_WAIT = 10;
export const CLOUD_REAPPLICATION_DELAY = 20;
const CLOUD_DURATION = 600;
const INITIAL_RADIUS = 3;

export class AreaEffectCloud extends Entity {
  potionId = 'water';
  radius = INITIAL_RADIUS;
  age = 0;
  /** Callback every 5 ticks once the wait time is over (Game applies the effects). */
  onEffects?: (cloud: AreaEffectCloud) => void;

  private readonly victims = new Map<object, number>();

  constructor(level: ClientLevel, x = 0, y = 0, z = 0) {
    super(entityType('area_effect_cloud'), level);
    this.setPos(x, y, z);
  }

  tick(): void {
    this.baseTick();
    this.age++;
    if (this.age >= LINGERING_WAIT + CLOUD_DURATION) { this.remove(); return; }
    if (this.age < LINGERING_WAIT) return;
    this.radius -= INITIAL_RADIUS / CLOUD_DURATION;
    if (this.radius < 0.5) { this.remove(); return; }
    if (this.age % 5 !== 0) return;
    for (const [victim, until] of this.victims) {
      if (this.age >= until) this.victims.delete(victim);
    }
    this.onEffects?.(this);
  }

  /**
   * AreaEffectCloud.canAffect + the radius/duration change after the dose:
   * returns false while the victim's reapplication delay is still running.
   */
  affect(victim: object): boolean {
    const until = this.victims.get(victim);
    if (until !== undefined && this.age < until) return false;
    this.victims.set(victim, this.age + CLOUD_REAPPLICATION_DELAY);
    this.radius = Math.max(0, this.radius - 0.5);
    if (this.radius < 0.5) this.remove();
    return true;
  }
}
