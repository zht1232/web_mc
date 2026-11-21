// Source: net.minecraft.world.entity.monster.MagmaCube
//
// Nether cube mob: shares Slime's hopping movement, but hits harder and uses the
// magma texture. Fire immunity / light emission are not simulated in this port.

import { Slime } from './Slime.js';
import { entityType } from '../EntityType.js';
import type { ClientLevel } from '../../level/ClientLevel.js';

export class MagmaCube extends Slime {
  constructor(level: ClientLevel) {
    super(level, entityType('magma_cube'));
    this.maxHealth = 16; this.health = 16;
    this.attackDamage = 6;
  }
}
