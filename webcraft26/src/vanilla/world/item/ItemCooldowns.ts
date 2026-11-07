// Source: net.minecraft.world.item.ItemCooldowns (26.2)
//
// Cooldowns are keyed by a group id (an item name, or the optional
// UseCooldown.cooldownGroup). getCooldownPercent is the vanilla formula.

import type { ItemStack } from './ItemStack.js';

interface CooldownInstance {
  startTime: number;
  endTime: number;
}

export class ItemCooldowns {
  private readonly cooldowns = new Map<string, CooldownInstance>();
  private tickCount = 0;

  isOnCooldown(item: ItemStack): boolean {
    return this.getCooldownPercent(item, 0) > 0;
  }

  /** ItemCooldowns.getCooldownPercent: remaining / duration, clamped to 0..1. */
  getCooldownPercent(item: ItemStack, partialTick = 0): number {
    const group = this.getCooldownGroup(item);
    const c = this.cooldowns.get(group);
    if (!c) return 0;
    const duration = c.endTime - c.startTime;
    if (duration <= 0) return 0;
    const remaining = c.endTime - (this.tickCount + partialTick);
    return Math.max(0, Math.min(remaining / duration, 1));
  }

  tick(): void {
    this.tickCount++;
    if (this.cooldowns.size === 0) return;
    for (const [group, c] of this.cooldowns) {
      if (c.endTime <= this.tickCount) {
        this.cooldowns.delete(group);
        this.onCooldownEnded(group);
      }
    }
  }

  /** ItemCooldowns.getCooldownGroup (the default is the item's registry name). */
  getCooldownGroup(item: ItemStack): string {
    return item.item ? item.item.namespacedId : 'minecraft:air';
  }

  addCooldown(item: ItemStack | string, time: number): void {
    const group = typeof item === 'string' ? item : this.getCooldownGroup(item);
    if (time <= 0) return;
    this.cooldowns.set(group, { startTime: this.tickCount, endTime: this.tickCount + time });
    this.onCooldownStarted(group, time);
  }

  removeCooldown(group: string): void {
    this.cooldowns.delete(group);
    this.onCooldownEnded(group);
  }

  protected onCooldownStarted(_group: string, _duration: number): void {}
  protected onCooldownEnded(_group: string): void {}
}
