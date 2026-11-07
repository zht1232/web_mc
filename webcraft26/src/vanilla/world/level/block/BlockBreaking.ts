// Source: net.minecraft.world.level.block.state.BlockBehaviour#getDestroyProgress (26.2)
//         net.minecraft.world.entity.player.Player#getDestroySpeed / #hasCorrectToolForDrops
//         net.minecraft.world.level.block.Block#dropResources / #getDrops
//         net.minecraft.world.item.ItemStack#getDestroySpeed / #isCorrectToolForDrops
//
// getDestroyProgress = player.getDestroySpeed(state) / destroySpeed / modifier,
// where modifier = 30 when hasCorrectToolForDrops, else 100 (vanilla).
// player.getDestroySpeed adds MINING_EFFICIENCY, multiplies by 1/5 when the eye
// is in water (SUBMERGED_MINING_SPEED = 0.2) and divides by 5 when airborne.

import type { MinecraftData } from './state/BlockState.js';
import type { ItemStack } from '../../item/ItemStack.js';
import type { LootTableApi, LootContext } from '../storage/loot/LootTable.js';

export const CORRECT_TOOL_MODIFIER = 30;
export const INCORRECT_TOOL_MODIFIER = 100;
export const SUBMERGED_MINING_SPEED = 0.2; // 1/5, vanilla default
export const AIRBORNE_MINING_PENALTY = 5;

export class BlockBreaking {
  private currentState = -1;
  private accumulated = 0;
  private readonly mc: MinecraftData;

  constructor(mc: MinecraftData) {
    this.mc = mc;
  }

  /** 0..1, for the HUD destruction-crack overlay. */
  get progress(): number { return Math.max(0, Math.min(this.accumulated, 1)); }

  /** Reset when the raycast target changes or the player stops mining. */
  reset(): void {
    this.currentState = -1;
    this.accumulated = 0;
  }

  /**
   * Advance one tick. Returns true when the block is broken.
   * `hasEfficiency` is the Attributes.MINING_EFFICIENCY bonus (Efficiency).
   */
  tick(
    dtTicks: number,
    state: number,
    held: ItemStack | null,
    underwater: boolean,
    hasEfficiency: number,
  ): boolean {
    if (state !== this.currentState) {
      this.currentState = state;
      this.accumulated = 0;
    }
    const perTick = BlockBreaking.getDestroyProgress(state, held, this.mc, underwater, true, hasEfficiency);
    this.accumulated += dtTicks * perTick;
    if (this.accumulated >= 1) {
      this.accumulated = 0;
      return true;
    }
    return false;
  }

  /**
   * BlockBehaviour.getDestroyProgress. Optional trailing args expose the full
   * Player.getDestroySpeed modifiers (kept off the static signature for the
   * 3-arg form used by the HUD / tests).
   */
  static getDestroyProgress(
    state: number,
    held: ItemStack | null,
    mc: MinecraftData,
    underwater = false,
    onGround = true,
    efficiency = 0,
  ): number {
    const hardness = mc.hardness[state];
    if (hardness < 0) return 0; // bedrock / barrier (destroySpeed == -1)
    if (hardness === 0) return 1; // instant-break blocks (torch, air, flowers)
    const speed = BlockBreaking.playerDestroySpeed(state, held, mc, underwater, onGround, efficiency);
    const modifier = BlockBreaking.hasCorrectToolForDrops(state, held, mc)
      ? CORRECT_TOOL_MODIFIER : INCORRECT_TOOL_MODIFIER;
    return speed / hardness / modifier;
  }

  /** Player.getDestroySpeed, with MINING_EFFICIENCY / water / onGround modifiers. */
  static playerDestroySpeed(
    state: number,
    held: ItemStack | null,
    mc: MinecraftData,
    underwater: boolean,
    onGround: boolean,
    efficiency: number,
  ): number {
    let speed = held && !held.isEmpty() ? held.getDestroySpeed(state, mc) : 1;
    if (speed > 1) speed += efficiency; // Attributes.MINING_EFFICIENCY
    // MobEffectUtil.hasDigSpeed (Haste) / MINING_FATIGUE: no status-effect system
    // in this port, intentionally omitted.
    // Attributes.BLOCK_BREAK_SPEED defaults to 1.
    if (underwater) speed *= SUBMERGED_MINING_SPEED;
    if (!onGround) speed /= AIRBORNE_MINING_PENALTY;
    return speed;
  }

  /**
   * Player.hasCorrectToolForDrops:
   *   !state.requiresCorrectToolForDrops() || selectedItem.isCorrectToolForDrops(state)
   */
  static hasCorrectToolForDrops(state: number, held: ItemStack | null, mc: MinecraftData): boolean {
    const block = mc.blockOf(state);
    if (!block.requiresTool) return true;
    return held !== null && !held.isEmpty() && held.isCorrectToolForDrops(state, mc);
  }

  /** Block.dropResources(state, level, pos, blockEntity, breaker, tool). */
  static getDrops(state: number, held: ItemStack | null, loot: LootTableApi, mc: MinecraftData): ItemStack[] {
    const block = mc.blockOf(state);
    const ctx: LootContext = {
      blockName: block.name,
      silkTouch: held ? held.hasSilkTouch() : false,
      fortune: held ? held.getFortuneLevel() : 0,
      hasCorrectTool: BlockBreaking.hasCorrectToolForDrops(state, held, mc),
      requiresTool: block.requiresTool !== 0,
      exploded: false,
      tool: held && !held.isEmpty() && held.item ? held.item.name : '',
    };
    return loot.getDrops(block.name, ctx);
  }
}
