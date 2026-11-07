// Source: net.minecraft.world.entity.ai.goal.GoalSelector
//
// Runs the registered goals. Vanilla keeps a set of available goals and a map
// of "locked" flags; here the same behaviour is reproduced with a priority
// sorted array and a disabled-flag set. No per-tick allocation (arrays reused).

import { Goal, GoalFlag, WrappedGoal } from './Goal.js';

export class GoalSelector {
  private readonly goals: WrappedGoal[] = [];
  private readonly disabledFlags = new Set<GoalFlag>();

  addGoal(priority: number, goal: Goal): void {
    this.goals.push(new WrappedGoal(priority, goal));
    this.goals.sort((a, b) => a.priority - b.priority);
  }

  removeGoal(goal: Goal): void { this.removeAllGoals(g => g === goal); }

  removeAllGoals(predicate: (g: Goal) => boolean): void {
    for (let i = this.goals.length - 1; i >= 0; i--) {
      if (predicate(this.goals[i].goal)) {
        if (this.goals[i].isRunning()) this.goals[i].stop();
        this.goals.splice(i, 1);
      }
    }
  }

  getAvailableGoals(): readonly WrappedGoal[] { return this.goals; }

  disableControlFlag(flag: GoalFlag): void { this.disabledFlags.add(flag); }
  enableControlFlag(flag: GoalFlag): void { this.disabledFlags.delete(flag); }
  setControlFlag(flag: GoalFlag, enabled: boolean): void {
    if (enabled) this.enableControlFlag(flag); else this.disableControlFlag(flag);
  }

  private hasDisabledFlag(w: WrappedGoal): boolean {
    for (const f of w.getFlags()) if (this.disabledFlags.has(f)) return true;
    return false;
  }

  /** Vanilla GoalSelector.tick: cleanup -> start -> tick running goals.
   *  Uses a running-flag bitmask so starting goals is O(n), not O(n^2). */
  tick(): void {
    const goals = this.goals;
    // 1. stop goals that cannot continue or whose flags were disabled
    for (let i = 0; i < goals.length; i++) {
      const g = goals[i];
      if (g.isRunning() && (this.hasDisabledFlag(g) || !g.canContinueToUse())) g.stop();
    }
    // 2. start goals in priority order. `lockedMask` accumulates flags owned
    //    by higher-priority running goals; a candidate is blocked only if one
    //    of those owns one of its flags. Lower-priority running goals sharing
    //    a flag are stopped (replaced) when a higher-priority goal starts.
    let lockedMask = 0;
    for (let i = 0; i < goals.length; i++) {
      const g = goals[i];
      if (g.isRunning()) { lockedMask |= g.flagMask; continue; }
      if (this.hasDisabledFlag(g)) continue;
      if ((g.flagMask & lockedMask) !== 0) continue;
      if (!g.canUse()) continue;
      for (let j = 0; j < goals.length; j++) {
        const r = goals[j];
        if (r.isRunning() && (r.flagMask & g.flagMask) !== 0) r.stop();
      }
      g.start();
      lockedMask |= g.flagMask;
    }
    // 3. tick every running goal once per tick
    this.tickRunningGoals(true);
  }

  /** Vanilla GoalSelector.tickRunningGoals. */
  tickRunningGoals(forceTickAll: boolean): void {
    for (let i = 0; i < this.goals.length; i++) {
      const g = this.goals[i];
      if (g.isRunning() && (forceTickAll || g.requiresUpdateEveryTick())) g.tick();
    }
  }
}
