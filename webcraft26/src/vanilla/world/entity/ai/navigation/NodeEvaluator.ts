// Source: net.minecraft.world.level.pathfinder.NodeEvaluator
//
// Base class for path node evaluation. A node is an integer block position at
// which the mob's feet can stand: the feet+head blocks must be free and the
// block below must be solid. Neighbours are written into caller-owned typed
// arrays so that pathfinding allocates nothing per tick.

import type { ClientLevel } from '../../../level/ClientLevel.js';

export interface PathNode { x: number; y: number; z: number; }

/** Minimal structural view of the mob that a navigation needs (no import cycle). */
export interface PathMoveControl {
  setWantedPosition(x: number, y: number, z: number, speed: number): void;
  reset(): void;
}
export interface PathMob {
  readonly level: ClientLevel;
  getX(): number; getY(): number; getZ(): number;
  getWidth(): number; getHeight(): number;
  getSpeed(): number;
  setJumping(v: boolean): void;
  getMoveControl(): PathMoveControl;
}

export abstract class NodeEvaluator {
  level!: ClientLevel;
  mob!: PathMob;

  prepare(level: ClientLevel, mob: PathMob): void {
    this.level = level;
    this.mob = mob;
  }

  abstract getStart(): PathNode;

  /** Fills outX/Y/Z/outCost for up to 8 neighbours of `cur`; returns the count. */
  abstract getNeighbors(
    cur: PathNode,
    outX: Int32Array, outY: Int32Array, outZ: Int32Array, outCost: Float32Array,
  ): number;

  /** True when a block has a collision shape (i.e. blocks movement). */
  protected hasCollision(x: number, y: number, z: number): boolean {
    const state = this.level.getBlockState(x, y, z);
    if (state === 0) return false;
    return this.level.mc.collision(state).length > 0;
  }

  /** Feet + head blocks are free of collision. */
  protected isPassable(x: number, y: number, z: number): boolean {
    return !this.hasCollision(x, y, z) && !this.hasCollision(x, y + 1, z);
  }

  /** There is a solid block to stand on directly below. */
  protected isGround(x: number, y: number, z: number): boolean {
    return this.hasCollision(x, y - 1, z);
  }
}
