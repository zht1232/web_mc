// Re-export of the LootTable implementation.
// Source: net.minecraft.world.level.storage.loot.LootTable (26.2)
//
// The canonical implementation lives at the Java-matching package path
// src/vanilla/world/level/storage/loot/LootTable.ts; this module gives
// gameplay/** (and the main agent) an import that stays inside the gameplay
// package boundary.

export { LootTable } from '../../world/level/storage/loot/LootTable.js';
export type { LootTableApi, LootContext } from '../../world/level/storage/loot/LootTable.js';
