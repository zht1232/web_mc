// Port of net.minecraft.world.level.storage.{LevelStorageSource, PrimaryLevelData, LevelVersion}
// for the classic level.dat structure. Vanilla 26.2 writes level.dat as:
//
//   { Data: { LevelName, RandomSeed, GameType, Difficulty, SpawnX/Y/Z, Time, DayTime,
//             Raining, RainTime, Thundering, ThunderTime, LastPlayed, Version,
//             DataVersion, ... } }
//
// 26.2 has migrated a few fields (spawn, difficulty, gamerules) into ValueOutput codecs; we keep
// the classic field names listed in the task (and the Version/DataVersion compounds) so the
// format is both recognisably vanilla and directly usable by our client.

import { CompoundTag } from '../../../nbt/CompoundTag.js';
import { CURRENT_DATA_VERSION, addDataVersion } from '../../../nbt/NbtUtils.js';
import * as NbtIo from '../../../nbt/NbtIo.js';

export const LEVEL_VERSION_NAME = '26.2';
export const LEVEL_VERSION_SERIES = 'main';
export { CURRENT_DATA_VERSION };

export type GameModeName = 'survival' | 'creative' | 'adventure' | 'spectator';
export type DifficultyName = 'peaceful' | 'easy' | 'normal' | 'hard';

export function gameModeToId(m: string): number {
  switch (m) { case 'survival': return 0; case 'creative': return 1; case 'adventure': return 2; case 'spectator': return 3; default: return 0; }
}
export function gameModeFromId(id: number): GameModeName {
  return (['survival', 'creative', 'adventure', 'spectator'] as const)[id] ?? 'survival';
}
export function difficultyToId(d: string): number {
  switch (d) { case 'peaceful': return 0; case 'easy': return 1; case 'normal': return 2; case 'hard': return 3; default: return 2; }
}
export function difficultyFromId(id: number): DifficultyName {
  return (['peaceful', 'easy', 'normal', 'hard'] as const)[id] ?? 'normal';
}

export interface LevelData {
  LevelName: string;
  RandomSeed: bigint;
  GameType: number;
  Difficulty: number;
  DifficultyLocked: boolean;
  hardcore: boolean;
  allowCommands: boolean;
  SpawnX: number; SpawnY: number; SpawnZ: number;
  SpawnAngle: number;
  Time: number;
  DayTime: number;
  LastPlayed: number;
  Raining: boolean;
  RainTime: number;
  Thundering: boolean;
  ThunderTime: number;
  ClearWeatherTime: number;
  initialized: boolean;
  generateStructures: boolean;
  DataVersion: number;
  version: { Id: number; Name: string; Series: string; Snapshot: boolean };
}

export interface CreateLevelOptions {
  name: string;
  seed: bigint;
  gameMode: string;
  difficulty: string;
  hardcore?: boolean;
  allowCommands?: boolean;
  generateStructures?: boolean;
  spawn?: { x: number; y: number; z: number };
}

export class LevelStorage {
  /** Builds a fresh level.dat root ({ Data: {...} }). */
  static createLevelDat(opts: CreateLevelOptions): CompoundTag {
    const now = BigInt(Date.now());
    const data = new CompoundTag();
    addDataVersion(data);

    const version = new CompoundTag();
    version.putInt('Id', CURRENT_DATA_VERSION);
    version.putString('Name', LEVEL_VERSION_NAME);
    version.putString('Series', LEVEL_VERSION_SERIES);
    version.putBoolean('Snapshot', false);
    data.put('Version', version);

    data.putString('LevelName', opts.name);
    data.putLong('RandomSeed', opts.seed);
    data.putInt('GameType', gameModeToId(opts.gameMode));
    data.putInt('Difficulty', difficultyToId(opts.difficulty));
    data.putBoolean('DifficultyLocked', false);
    data.putBoolean('hardcore', opts.hardcore ?? false);
    data.putBoolean('allowCommands', opts.allowCommands ?? false);
    const spawn = opts.spawn ?? { x: 0, y: 64, z: 0 };
    data.putInt('SpawnX', spawn.x);
    data.putInt('SpawnY', spawn.y);
    data.putInt('SpawnZ', spawn.z);
    data.putFloat('SpawnAngle', 0);
    data.putLong('Time', 0n);
    data.putLong('DayTime', 0n);
    data.putLong('LastPlayed', now);
    data.putBoolean('Raining', false);
    data.putInt('RainTime', 0);
    data.putBoolean('Thundering', false);
    data.putInt('ThunderTime', 0);
    data.putInt('ClearWeatherTime', 0);
    data.putBoolean('initialized', true);
    data.putBoolean('generateStructures', opts.generateStructures ?? true);
    data.put('GameRules', new CompoundTag());

    const root = new CompoundTag();
    root.put('Data', data);
    return root;
  }

  /** Reads the classic level.dat fields out of a root tag. */
  static readLevelDat(root: CompoundTag): LevelData {
    const d = root.getCompoundOrEmpty('Data');
    const v = d.getCompoundOrEmpty('Version');
    return {
      LevelName: d.getStringOr('LevelName', 'World'),
      RandomSeed: d.getLongOr('RandomSeed', 0n),
      GameType: d.getIntOr('GameType', 0),
      Difficulty: d.getIntOr('Difficulty', 2),
      DifficultyLocked: d.getBooleanOr('DifficultyLocked', false),
      hardcore: d.getBooleanOr('hardcore', false),
      allowCommands: d.getBooleanOr('allowCommands', false),
      SpawnX: d.getIntOr('SpawnX', 0), SpawnY: d.getIntOr('SpawnY', 64), SpawnZ: d.getIntOr('SpawnZ', 0),
      SpawnAngle: d.getFloatOr('SpawnAngle', 0),
      Time: Number(d.getLongOr('Time', 0n)),
      DayTime: Number(d.getLongOr('DayTime', 0n)),
      LastPlayed: Number(d.getLongOr('LastPlayed', 0n)),
      Raining: d.getBooleanOr('Raining', false),
      RainTime: d.getIntOr('RainTime', 0),
      Thundering: d.getBooleanOr('Thundering', false),
      ThunderTime: d.getIntOr('ThunderTime', 0),
      ClearWeatherTime: d.getIntOr('ClearWeatherTime', 0),
      initialized: d.getBooleanOr('initialized', true),
      generateStructures: d.getBooleanOr('generateStructures', true),
      DataVersion: d.getIntOr('DataVersion', CURRENT_DATA_VERSION),
      version: {
        Id: v.getIntOr('Id', CURRENT_DATA_VERSION),
        Name: v.getStringOr('Name', LEVEL_VERSION_NAME),
        Series: v.getStringOr('Series', LEVEL_VERSION_SERIES),
        Snapshot: v.getBooleanOr('Snapshot', false),
      },
    };
  }

  /** Mutates the `Data` compound of a level.dat root with live values (called by flushDirty). */
  static updateLevelDat(root: CompoundTag, patch: Partial<Pick<LevelData,
    'Time' | 'DayTime' | 'LastPlayed' | 'Raining' | 'RainTime' | 'Thundering' | 'ThunderTime' | 'GameType' | 'Difficulty' | 'LevelName'>>): void {
    const d = root.getCompoundOrEmpty('Data');
    if (patch.Time !== undefined) d.putLong('Time', BigInt(Math.trunc(patch.Time)));
    if (patch.DayTime !== undefined) d.putLong('DayTime', BigInt(Math.trunc(patch.DayTime)));
    if (patch.LastPlayed !== undefined) d.putLong('LastPlayed', BigInt(Math.trunc(patch.LastPlayed)));
    if (patch.Raining !== undefined) d.putBoolean('Raining', patch.Raining);
    if (patch.RainTime !== undefined) d.putInt('RainTime', patch.RainTime);
    if (patch.Thundering !== undefined) d.putBoolean('Thundering', patch.Thundering);
    if (patch.ThunderTime !== undefined) d.putInt('ThunderTime', patch.ThunderTime);
    if (patch.GameType !== undefined) d.putInt('GameType', patch.GameType);
    if (patch.Difficulty !== undefined) d.putInt('Difficulty', patch.Difficulty);
    if (patch.LevelName !== undefined) d.putString('LevelName', patch.LevelName);
  }

  /** gzipped NBT bytes (vanilla level.dat is gzip). */
  static serialize(root: CompoundTag): Promise<Uint8Array> {
    return NbtIo.writeCompressed(root);
  }

  /** Reads gzipped or uncompressed NBT bytes. */
  static deserialize(bytes: Uint8Array): Promise<CompoundTag> {
    return NbtIo.readAuto(bytes);
  }
}
