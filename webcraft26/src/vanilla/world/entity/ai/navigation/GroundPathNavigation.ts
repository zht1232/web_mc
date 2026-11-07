// Source: net.minecraft.world.entity.ai.navigation.GroundPathNavigation
//
// PathNavigation specialised for walking mobs: it installs a WalkNodeEvaluator
// and cannot float/swim.

import { PathNavigation } from './PathNavigation.js';
import { WalkNodeEvaluator } from './WalkNodeEvaluator.js';
import type { NodeEvaluator, PathMob } from './NodeEvaluator.js';
import type { ClientLevel } from '../../../level/ClientLevel.js';

export { PathNavigation } from './PathNavigation.js';

export class GroundPathNavigation extends PathNavigation {
  constructor(mob: PathMob, level: ClientLevel) {
    super(mob, level, new WalkNodeEvaluator());
  }

  getNodeEvaluator(): NodeEvaluator { return this.nodeEvaluator; }
}
