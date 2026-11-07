// Source: net.minecraft.world.item.context.UseOnContext (26.2)
//
// Lightweight value object: everything BlockItem/Item.useOn needs to decide
// placement. Kept DOM-free so it is usable from gameplay code and tests.

import type { ItemStack } from './ItemStack.js';

/** Minimal BlockHitResult replacement (net.minecraft.world.phys.BlockHitResult). */
export interface BlockHitResult {
  x: number; y: number; z: number;
  face: number;                 // Direction index
  location: { x: number; y: number; z: number };
  inside: boolean;
  miss: boolean;
}

export type InteractionHand = 'MAIN_HAND' | 'OFF_HAND';

export class UseOnContext {
  readonly hand: InteractionHand;
  readonly hitResult: BlockHitResult;
  readonly itemStack: ItemStack;
  readonly playerRef: unknown | null;
  readonly levelRef: unknown;
  readonly yaw: number;
  readonly secondaryUse: boolean;

  constructor(
    level: unknown,
    player: unknown | null,
    hand: InteractionHand,
    itemStack: ItemStack,
    hitResult: BlockHitResult,
    yaw = 0,
    secondaryUse = false,
  ) {
    this.levelRef = level;
    this.playerRef = player;
    this.hand = hand;
    this.itemStack = itemStack;
    this.hitResult = hitResult;
    this.yaw = yaw;
    this.secondaryUse = secondaryUse;
  }

  getClickedPos(): { x: number; y: number; z: number } {
    return { x: this.hitResult.x, y: this.hitResult.y, z: this.hitResult.z };
  }
  getClickedFace(): number { return this.hitResult.face; }
  getClickLocation(): { x: number; y: number; z: number } { return this.hitResult.location; }
  isInside(): boolean { return this.hitResult.inside; }
  getItemInHand(): ItemStack { return this.itemStack; }
  getPlayer(): unknown | null { return this.playerRef; }
  getHand(): InteractionHand { return this.hand; }
  getLevel(): unknown { return this.levelRef; }
  getHorizontalDirection(): number { return Math.floor(((this.yaw / 90) + 0.5) % 4 + 4) % 4; }
  isSecondaryUseActive(): boolean { return this.playerRef !== null && this.secondaryUse; }
  getRotation(): number { return this.playerRef === null ? 0 : this.yaw; }
}
