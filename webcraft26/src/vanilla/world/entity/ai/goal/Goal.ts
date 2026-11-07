// Source: net.minecraft.world.entity.ai.goal.Goal
//
// A goal is a state machine with control flags (MOVE / LOOK / JUMP / TARGET).
// Goals with overlapping flags are mutually exclusive; the GoalSelector picks
// the highest-priority (lowest number) goal that canUse() each tick.

export enum GoalFlag { MOVE = 0, LOOK = 1, JUMP = 2, TARGET = 3 }

export abstract class Goal {
  static readonly Flag = GoalFlag;
  private flags: GoalFlag[] = [];

  abstract canUse(): boolean;

  canContinueToUse(): boolean { return this.canUse(); }
  isInterruptable(): boolean { return true; }
  start(): void {}
  stop(): void {}
  requiresUpdateEveryTick(): boolean { return false; }
  tick(): void {}

  setFlags(...flags: GoalFlag[]): void { this.flags = flags.slice(); }
  getFlags(): readonly GoalFlag[] { return this.flags; }

  protected adjustedTickDelay(ticks: number): number {
    return this.requiresUpdateEveryTick() ? ticks : Math.max(1, Math.ceil(ticks / 2));
  }

  protected static reducedTickDelay(ticks: number): number {
    return Math.max(1, Math.ceil(ticks / 2));
  }

  toString(): string { return this.constructor.name; }
}

/** Source: net.minecraft.world.entity.ai.goal.WrappedGoal */
export class WrappedGoal {
  running = false;
  /** bitmask of GoalFlag values owned by this goal (set once at registration) */
  readonly flagMask: number;
  constructor(readonly priority: number, readonly goal: Goal) {
    let m = 0;
    for (const f of goal.getFlags()) m |= (1 << f);
    this.flagMask = m;
  }

  isRunning(): boolean { return this.running; }
  getGoal(): Goal { return this.goal; }
  getPriority(): number { return this.priority; }
  getFlags(): readonly GoalFlag[] { return this.goal.getFlags(); }
  isInterruptable(): boolean { return this.goal.isInterruptable(); }
  requiresUpdateEveryTick(): boolean { return this.goal.requiresUpdateEveryTick(); }
  canUse(): boolean { return this.goal.canUse(); }
  canContinueToUse(): boolean { return this.goal.canContinueToUse(); }
  start(): void { this.running = true; this.goal.start(); }
  stop(): void { if (this.running) { this.running = false; this.goal.stop(); } }
  tick(): void { this.goal.tick(); }
  canBeReplacedBy(other: WrappedGoal): boolean {
    return this.isInterruptable() && other.priority < this.priority;
  }
  toString(): string { return `${this.priority}:${this.goal}`; }
}
