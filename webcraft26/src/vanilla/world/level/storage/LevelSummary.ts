// Port of net.minecraft.world.level.storage.LevelSummary (world-list metadata + icon.png).
// The GUI's WorldListProvider works with WorldSummary; this module adds the extra persisted
// fields (gzipped level.dat bytes + PNG icon) kept in the `worlds` object store.

import type { WorldSummary } from '../../../../client/gui/Types.js';
import type { CompoundTag } from '../../../nbt/CompoundTag.js';
import { LevelStorage, gameModeFromId, difficultyFromId, type GameModeName, type DifficultyName } from './LevelStorage.js';

/** Full metadata row persisted in the IndexedDB `worlds` store. */
export interface WorldRecord {
  id: string;
  name: string;
  seed: string; // decimal string (WorldSummary.seed accepts string; bigint in level.dat)
  gameMode: 'survival' | 'creative';
  difficulty: 'peaceful' | 'easy' | 'normal' | 'hard';
  hardcore: boolean;
  lastPlayed: number;
  version: string;
  levelDat: Uint8Array; // gzipped level.dat NBT
  icon?: Uint8Array;    // PNG bytes of icon.png
}

/** Structured summary used by WorldSaveManager.getSummary(). */
export interface LevelSummary {
  id: string;
  name: string;
  seed: bigint;
  gameMode: GameModeName;
  difficulty: DifficultyName;
  hardcore: boolean;
  lastPlayed: number;
  time: number;
  dayTime: number;
  version: string;
  icon?: Uint8Array;
}

export function recordToWorldSummary(r: WorldRecord): WorldSummary {
  return {
    id: r.id,
    name: r.name,
    seed: r.seed,
    gameMode: r.gameMode,
    difficulty: r.difficulty,
    lastPlayed: r.lastPlayed,
    version: r.version,
    hardcore: r.hardcore,
  };
}

export function worldSummaryToRecord(s: WorldSummary, levelDat: Uint8Array, icon?: Uint8Array): WorldRecord {
  return {
    id: s.id,
    name: s.name,
    seed: String(s.seed ?? '0'),
    gameMode: s.gameMode === 'survival' ? 'survival' : 'creative',
    difficulty: s.difficulty ?? 'normal',
    hardcore: s.hardcore ?? false,
    lastPlayed: s.lastPlayed ?? Date.now(),
    version: s.version ?? '26.2',
    levelDat,
    icon,
  };
}

/** Builds a LevelSummary by parsing a level.dat root (used by getSummary). */
export function summaryFromLevelDat(id: string, root: CompoundTag, icon?: Uint8Array): LevelSummary {
  const d = LevelStorage.readLevelDat(root);
  return {
    id,
    name: d.LevelName,
    seed: d.RandomSeed,
    gameMode: gameModeFromId(d.GameType),
    difficulty: difficultyFromId(d.Difficulty),
    hardcore: d.hardcore,
    lastPlayed: d.LastPlayed,
    time: d.Time,
    dayTime: d.DayTime,
    version: d.version.Name || '26.2',
    icon,
  };
}

export function levelSummaryToWorldSummary(s: LevelSummary): WorldSummary {
  return {
    id: s.id,
    name: s.name,
    seed: s.seed.toString(),
    gameMode: s.gameMode === 'creative' ? 'creative' : 'survival',
    difficulty: s.difficulty,
    lastPlayed: s.lastPlayed,
    version: s.version,
    hardcore: s.hardcore,
  };
}
