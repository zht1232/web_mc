// IndexedDB-backed world persistence. Implements the GUI's WorldListProvider and exposes the
// full save API requested by the main agent (createWorld / loadWorld / flushDirty / savePlayer /
// exportRegion / importWorld). All binary formats come from the vanilla ports in
// src/vanilla/nbt + src/vanilla/world/level/storage.

import type { WorldListProvider, WorldSummary, CreateWorldOptions } from '../../gui/Types.js';
import { CompoundTag, type NbtCompound } from '../../../vanilla/nbt/CompoundTag.js';
import { ListTag } from '../../../vanilla/nbt/ListTag.js';
import * as NbtIo from '../../../vanilla/nbt/NbtIo.js';
import {
  LevelStorage, type GameModeName, type DifficultyName,
} from '../../../vanilla/world/level/storage/LevelStorage.js';
import {
  recordToWorldSummary, summaryFromLevelDat, type WorldRecord, type LevelSummary, type SavedPet,
  type SavedVillager,
} from '../../../vanilla/world/level/storage/LevelSummary.js';
import { PlayerData, type PlayerLike, type PlayerExtra } from '../../../vanilla/world/level/storage/PlayerData.js';
import {
  ChunkSerializer, MinecraftDataBlockStateCodec, ReversibleBlockStateCodec, ReversibleBiomeCodec,
  type BlockStateCodec, type BiomeCodec, type ChunkCodecOptions,
} from '../../../vanilla/world/level/storage/ChunkSerializer.js';
import { RegionFile } from '../../../vanilla/world/level/storage/RegionFile.js';
import type { MinecraftData } from '../../../vanilla/world/level/block/state/BlockState.js';
import type { LevelChunk } from '../../../vanilla/world/level/chunk/LevelChunk.js';
import type { ClientLevel } from '../../../vanilla/world/level/ClientLevel.js';
import type { Player } from '../../../vanilla/world/entity/player/Player.js';
import { SaveDatabase } from './SaveDatabase.js';

/** Max chunks written in ONE IndexedDB transaction / one flushDirty call (frame budget). */
export const MAX_CHUNKS_PER_TRANSACTION = 16;
/** level.dat is re-gzipped at most this often when no chunks were written. */
const LEVEL_PERSIST_INTERVAL_MS = 5000;

export interface WorldSaveManagerOptions {
  /** Defaults to MinecraftDataBlockStateCodec(mc) or a reversible numeric codec. */
  blockCodec?: BlockStateCodec;
  biomeCodec?: BiomeCodec;
  /** Real block registry, used to build the default block codec. */
  mc?: MinecraftData;
  minY?: number;
  height?: number;
  /** Chunk key dimension segment. Default "overworld". */
  dimension?: string;
}

export interface LoadedWorld {
  level: NbtCompound;
  chunks: Map<string, Uint8Array>;
  player: NbtCompound | null;
  pets: SavedPet[];
  villagers: SavedVillager[];
}

interface CreateParams {
  name: string;
  seed: bigint;
  gameMode: string;
  difficulty: string;
  hardcore?: boolean;
  allowCommands?: boolean;
  generateStructures?: boolean;
}

const nowMs = (): number => (typeof performance !== 'undefined' ? performance.now() : Date.now());

function parseSeed(s: string): bigint {
  const t = s.trim();
  if (/^[+-]?\d+$/.test(t)) {
    try { return BigInt(t); } catch { /* fall through to hash */ }
  }
  // Vanilla fallback: Java String.hashCode (32-bit signed).
  let h = 0;
  for (let i = 0; i < s.length; i++) h = (Math.imul(31, h) + s.charCodeAt(i)) | 0;
  return BigInt(h);
}

function narrowGameMode(m: string): 'survival' | 'creative' {
  return m === 'survival' ? 'survival' : 'creative';
}
function narrowDifficulty(d: string): 'peaceful' | 'easy' | 'normal' | 'hard' {
  switch (d) {
    case 'peaceful': case 'easy': case 'normal': case 'hard': return d;
    default: return 'normal';
  }
}

export class WorldSaveManager implements WorldListProvider {
  private readonly codecOpts: ChunkCodecOptions;
  private readonly dim: string;
  private currentWorldId: string | null = null;
  private savedKeys = new Set<string>();
  private lastLevelPersist = 0;
  /** Called once at the start of a save cycle (Game copies live entities into chunks). */
  private beforeSave: (() => void) | null = null;
  private saveCycleOpen = false;

  private constructor(private readonly db: SaveDatabase, opts: WorldSaveManagerOptions = {}) {
    this.dim = opts.dimension ?? 'overworld';
    const blockCodec: BlockStateCodec = opts.blockCodec
      ?? (opts.mc ? new MinecraftDataBlockStateCodec(opts.mc) : new ReversibleBlockStateCodec());
    this.codecOpts = {
      blockCodec,
      biomeCodec: opts.biomeCodec ?? new ReversibleBiomeCodec(),
      minY: opts.minY ?? -64,
      height: opts.height ?? 384,
    };
  }

  /**
   * Installs the per-cycle entity capture hook. It runs once when a save cycle
   * opens, not on every idle slice: live entities move every tick, and capturing
   * them per slice would keep the sharded flush from ever draining.
   */
  setBeforeSave(fn: () => void): void { this.beforeSave = fn; }

  /** Opens a manager. Pass a fake SaveDatabase in Node tests; omit for the real IndexedDB. */
  static async open(db?: SaveDatabase, opts?: WorldSaveManagerOptions): Promise<WorldSaveManager> {
    const database = db ?? await SaveDatabase.openIDB();
    return new WorldSaveManager(database, opts);
  }

  // ---- WorldListProvider ---------------------------------------------------

  async list(): Promise<WorldSummary[]> {
    const entries = await this.db.worlds.entries();
    return entries
      .map(([, v]) => recordToWorldSummary(v as WorldRecord))
      .sort((a, b) => (b.lastPlayed ?? 0) - (a.lastPlayed ?? 0));
  }

  async create(options: CreateWorldOptions): Promise<WorldSummary> {
    const id = this.newId();
    // CreateWorldScreen offers hardcore as a "gameMode" option; map it to survival + hardcore.
    const hardcore = (options.gameMode as string) === 'hardcore';
    const rec = await this.createRecord(id, {
      name: options.name || 'New World',
      seed: parseSeed(options.seed),
      gameMode: hardcore ? 'survival' : options.gameMode,
      difficulty: options.difficulty,
      hardcore,
      allowCommands: options.allowCommands,
      generateStructures: options.generateStructures,
    });
    this.bind(id, new Set());
    return recordToWorldSummary(rec);
  }

  async delete(id: string): Promise<void> {
    await this.db.worlds.delete(id);
    await this.deletePrefix(this.db.chunks, `${id}:`);
    await this.deletePrefix(this.db.players, `${id}:`);
    await this.deletePrefix(this.db.regions, `${id}:`);
    if (this.currentWorldId === id) { this.currentWorldId = null; this.savedKeys.clear(); }
  }

  /** GUI hook: mark a world as selected/opened (touches lastPlayed, binds it as current). */
  async load(id: string): Promise<void> {
    const rec = await this.db.worlds.get(id) as WorldRecord | undefined;
    if (rec) { rec.lastPlayed = Date.now(); await this.db.worlds.put(id, rec); }
    this.bind(id, await this.chunkKeysFor(id));
  }

  async rename(id: string, name: string): Promise<void> {
    const rec = await this.db.worlds.get(id) as WorldRecord | undefined;
    if (!rec) return;
    rec.name = name;
    const root = await LevelStorage.deserialize(rec.levelDat);
    LevelStorage.updateLevelDat(root, { LevelName: name });
    rec.levelDat = await LevelStorage.serialize(root);
    await this.db.worlds.put(id, rec);
  }

  async getSummary(id: string): Promise<LevelSummary | null> {
    const rec = await this.db.worlds.get(id) as WorldRecord | undefined;
    if (!rec) return null;
    const root = await LevelStorage.deserialize(rec.levelDat);
    return summaryFromLevelDat(id, root, rec.icon);
  }

  // ---- world lifecycle -----------------------------------------------------

  /** Creates a world from explicit parameters, returns its id, and binds it as current. */
  async createWorld(opts: { name: string; seed: bigint; gamemode: string; difficulty: string }): Promise<string> {
    const id = this.newId();
    await this.createRecord(id, {
      name: opts.name,
      seed: opts.seed,
      gameMode: opts.gamemode,
      difficulty: opts.difficulty,
    });
    this.bind(id, new Set());
    return id;
  }

  /** Full load: level.dat NBT, all chunk NBT bytes, and the player NBT. Binds as current. */
  async loadWorld(id: string): Promise<LoadedWorld> {
    const rec = await this.db.worlds.get(id) as WorldRecord | undefined;
    const level: NbtCompound = rec
      ? await LevelStorage.deserialize(rec.levelDat)
      : new CompoundTag();

    const chunkEntries = await this.db.chunks.entries(`${id}:`);
    const chunks = new Map<string, Uint8Array>();
    for (const [k, v] of chunkEntries) chunks.set(k, v as Uint8Array);

    const pbytes = await this.db.players.get(`${id}:${this.dim}:player`);
    const player: NbtCompound | null = pbytes instanceof Uint8Array ? NbtIo.read(pbytes) : null;

    if (rec) { rec.lastPlayed = Date.now(); await this.db.worlds.put(id, rec); }
    this.bind(id, new Set(chunks.keys()));
    return { level, chunks, player, pets: rec?.pets ?? [], villagers: rec?.villagers ?? [] };
  }

  // ---- per-frame dirty chunk persistence ----------------------------------

  /**
   * Saves dirty chunks within a per-frame budget. One transaction (<= 16 chunks) per call:
   * never writes the whole world at once. A chunk is dirty when LevelChunk.dirtySections is
   * non-empty OR it has never been persisted in this session (covers freshly generated terrain,
   * which the generator writes without going through markDirty).
   * Returns the number of chunks written this frame.
   */
  async flushDirty(level: ClientLevel, player: Player, budgetMs: number): Promise<number> {
    void player; // reserved for future per-frame player-position persistence
    const id = this.currentWorldId;
    if (!id) return 0;
    // One capture per save cycle: opens lazily on the first slice and closes when a
    // slice writes nothing. flushAll resets it so an immediate save always re-captures.
    if (!this.saveCycleOpen) {
      this.saveCycleOpen = true;
      this.beforeSave?.();
    }
    const started = nowMs();
    const batch: [string, unknown][] = [];
    let written = 0;

    for (const chunk of level.chunks.values()) {
      if (written > 0 && nowMs() - started >= budgetMs) break;
      if (batch.length >= MAX_CHUNKS_PER_TRANSACTION) break;
      const key = this.chunkKey(id, chunk.x, chunk.z);
      const dirty = (chunk.dirtySections?.size ?? 0) > 0 || chunk.entitiesDirty || !this.savedKeys.has(key);
      if (!dirty) continue;
      batch.push([key, ChunkSerializer.toBytes(chunk, this.codecOpts)]);
      chunk.dirtySections?.clear();
      chunk.dirty = false;
      chunk.entitiesDirty = false;
      chunk.hadEntities = chunk.entities.length > 0;
      this.savedKeys.add(key);
      written++;
    }

    if (written === 0) this.saveCycleOpen = false;
    if (batch.length) await this.db.chunks.putBatch(batch);

    const wall = Date.now();
    if (written > 0 || wall - this.lastLevelPersist > LEVEL_PERSIST_INTERVAL_MS) {
      await this.saveLevelData(level);
    }
    return written;
  }

  /**
   * Writes one chunk immediately (chunk unload path). LevelChunk.entities must
   * already hold the snapshot to keep; this is what preserves entities in a
   * chunk that leaves the retention band before the next autosave slice.
   */
  async saveChunk(chunk: LevelChunk): Promise<void> {
    const id = this.currentWorldId;
    if (!id) return;
    const key = this.chunkKey(id, chunk.x, chunk.z);
    const bytes = ChunkSerializer.toBytes(chunk, this.codecOpts);
    chunk.dirtySections?.clear();
    chunk.entitiesDirty = false;
    chunk.hadEntities = chunk.entities.length > 0;
    this.savedKeys.add(key);
    await this.db.chunks.put(key, bytes);
  }

  /** Persists live level time/weather into level.dat. */
  async saveLevelData(level: ClientLevel): Promise<void> {
    const id = this.currentWorldId;
    if (!id) return;
    const rec = await this.db.worlds.get(id) as WorldRecord | undefined;
    if (!rec) return;
    const root = await LevelStorage.deserialize(rec.levelDat);
    // WeatherData (PrimaryLevelData): Raining / RainTime / Thundering / ThunderTime.
    // The cast keeps headless test doubles (chunks/time only) working without weather state.
    const levelLike = level as ClientLevel & {
      getWeatherState?: () => { raining: boolean; rainTime: number; thundering: boolean; thunderTime: number };
    };
    const weather = typeof levelLike.getWeatherState === 'function'
      ? levelLike.getWeatherState()
      : { raining: false, rainTime: 0, thundering: false, thunderTime: 0 };
    LevelStorage.updateLevelDat(root, {
      Time: level.gameTime,
      DayTime: level.time,
      LastPlayed: Date.now(),
      Raining: weather.raining,
      RainTime: weather.rainTime,
      Thundering: weather.thundering,
      ThunderTime: weather.thunderTime,
    });
    rec.levelDat = await LevelStorage.serialize(root);
    rec.lastPlayed = Date.now();
    await this.db.worlds.put(id, rec);
    this.lastLevelPersist = Date.now();
  }

  /** Saves the player NBT (opaque extras round-trip losslessly). */
  async savePlayer(player: Player, extra: Record<string, unknown>): Promise<void> {
    const id = this.currentWorldId;
    if (!id) return;
    const root = PlayerData.toNbt(player as PlayerLike, extra as PlayerExtra);
    await this.db.players.put(`${id}:${this.dim}:player`, NbtIo.write(root));
  }

  /** Persists tamed pets; wild mobs remain chunk-derived (no chunk entity records yet). */
  async savePets(pets: SavedPet[]): Promise<void> {
    const id = this.currentWorldId;
    if (!id) return;
    const rec = await this.db.worlds.get(id) as WorldRecord | undefined;
    if (!rec) return;
    rec.pets = pets;
    rec.lastPlayed = Date.now();
    await this.db.worlds.put(id, rec);
  }

  /** Persists villagers (profession/level/offers) at the world level. */
  async saveVillagers(villagers: SavedVillager[]): Promise<void> {
    const id = this.currentWorldId;
    if (!id) return;
    const rec = await this.db.worlds.get(id) as WorldRecord | undefined;
    if (!rec) return;
    rec.villagers = villagers;
    rec.lastPlayed = Date.now();
    await this.db.worlds.put(id, rec);
  }

  /** Saves everything (used by autosave / pause / quit). Loops flushDirty until drained. */
  async flushAll(level: ClientLevel, player: Player, extra: Record<string, unknown>,
    budgetMs = 1000, pets?: SavedPet[], villagers?: SavedVillager[]): Promise<number> {
    await this.savePlayer(player, extra);
    // Force a fresh entity capture even if an idle cycle is still open.
    this.saveCycleOpen = false;
    let total = 0;
    for (;;) {
      const n = await this.flushDirty(level, player, budgetMs);
      total += n;
      if (n === 0) break;
    }
    await this.saveLevelData(level);
    if (pets) await this.savePets(pets);
    if (villagers) await this.saveVillagers(villagers);
    return total;
  }

  // ---- icons ---------------------------------------------------------------

  async setIcon(worldId: string, png: Uint8Array): Promise<void> {
    const rec = await this.db.worlds.get(worldId) as WorldRecord | undefined;
    if (!rec) return;
    rec.icon = new Uint8Array(png);
    await this.db.worlds.put(worldId, rec);
  }
  async getIcon(worldId: string): Promise<Uint8Array | undefined> {
    const rec = await this.db.worlds.get(worldId) as WorldRecord | undefined;
    return rec?.icon;
  }

  // ---- region export / world import ---------------------------------------

  /** Builds a real, 4096-aligned .mca for region (rx,rz) from stored chunk NBT bytes. */
  async exportRegion(worldId: string, rx: number, rz: number): Promise<Uint8Array> {
    const entries = await this.db.chunks.entries(`${worldId}:`);
    const region = new RegionFile();
    for (const [key, value] of entries) {
      const { cx, cz } = this.parseChunkKey(key);
      if (Math.floor(cx / 32) !== rx || Math.floor(cz / 32) !== rz) continue;
      await region.write(cx, cz, value as Uint8Array);
    }
    region.close();
    const mca = region.toUint8Array();
    await this.db.regions.put(`${worldId}:${this.dim}:${rx},${rz}`, mca);
    return mca;
  }

  /** Bundles a whole world into one gzipped NBT file (inverse of importWorld). */
  async exportWorld(worldId: string): Promise<Uint8Array> {
    const rec = await this.db.worlds.get(worldId) as WorldRecord | undefined;
    if (!rec) throw new Error(`unknown world ${worldId}`);
    const root = new CompoundTag();
    root.putString('Format', 'webcraft26.world');
    root.putInt('Version', 1);
    root.putString('Name', rec.name);
    root.putString('Seed', rec.seed);
    root.putString('GameMode', rec.gameMode);
    root.putString('Difficulty', rec.difficulty);
    root.putBoolean('Hardcore', rec.hardcore);
    root.putByteArray('LevelDat', rec.levelDat);
    if (rec.icon) root.putByteArray('Icon', rec.icon);

    const chunks = new ListTag();
    for (const [key, value] of await this.db.chunks.entries(`${worldId}:`)) {
      const { cx, cz, dim } = this.parseChunkKey(key);
      const ct = new CompoundTag();
      ct.putInt('cx', cx); ct.putInt('cz', cz); ct.putString('dim', dim);
      ct.putByteArray('data', value as Uint8Array);
      chunks.add(ct);
    }
    root.put('Chunks', chunks);
    const pbytes = await this.db.players.get(`${worldId}:${this.dim}:player`);
    root.putByteArray('Player', pbytes instanceof Uint8Array ? pbytes : new Uint8Array(0));
    return NbtIo.writeCompressed(root);
  }

  /**
   * Imports a world. Accepts:
   *   * a webcraft26.world bundle (from exportWorld),
   *   * a raw level.dat (gzipped or not),
   *   * a real .mca region file (chunks imported with region-local coords).
   * Returns the new world id.
   */
  async importWorld(file: ArrayBuffer): Promise<string> {
    const bytes = new Uint8Array(file);
    let root: CompoundTag | null = null;
    try { root = await NbtIo.readAuto(bytes); } catch { root = null; }

    if (root && root.getStringOr('Format', '') === 'webcraft26.world') return this.importBundle(root);
    if (root && root.getCompound('Data')) return this.importLevelDat(root);

    // Fall back to a region file.
    try {
      const region = RegionFile.fromBytes(bytes);
      const entries = await region.readAll();
      if (entries.length) return this.importRegion(entries);
    } catch { /* not a region either */ }
    throw new Error('importWorld: unrecognised file format');
  }

  private async importBundle(root: CompoundTag): Promise<string> {
    const id = this.newId();
    const levelDat = root.getByteArray('LevelDat');
    const rec = await this.createRecord(id, {
      name: root.getStringOr('Name', 'Imported World'),
      seed: parseSeed(root.getStringOr('Seed', '0')),
      gameMode: root.getStringOr('GameMode', 'creative'),
      difficulty: root.getStringOr('Difficulty', 'normal'),
      hardcore: root.getBooleanOr('Hardcore', false),
    }, levelDat ? new Uint8Array(levelDat) : undefined, root.getByteArray('Icon') ? new Uint8Array(root.getByteArray('Icon')!) : undefined);

    for (const el of root.getListOrEmpty('Chunks').list) {
      if (!(el instanceof CompoundTag)) continue;
      const cx = el.getIntOr('cx', 0), cz = el.getIntOr('cz', 0);
      const dim = el.getStringOr('dim', this.dim);
      const data = el.getByteArray('data');
      if (data) await this.db.chunks.put(`${id}:${dim}:${cx},${cz}`, new Uint8Array(data));
    }
    const player = root.getByteArray('Player');
    if (player && player.length) await this.db.players.put(`${id}:${this.dim}:player`, new Uint8Array(player));
    return rec.id;
  }

  private async importLevelDat(root: CompoundTag): Promise<string> {
    const d = LevelStorage.readLevelDat(root);
    const id = this.newId();
    await this.createRecord(id, {
      name: d.LevelName,
      seed: d.RandomSeed,
      gameMode: (['survival', 'creative', 'adventure', 'spectator'] as GameModeName[])[d.GameType] ?? 'survival',
      difficulty: (['peaceful', 'easy', 'normal', 'hard'] as DifficultyName[])[d.Difficulty] ?? 'normal',
      hardcore: d.hardcore,
    }, await LevelStorage.serialize(root));
    return id;
  }

  private async importRegion(entries: [number, number, Uint8Array][]): Promise<string> {
    const id = this.newId();
    await this.createRecord(id, { name: 'Imported Region', seed: 0n, gameMode: 'creative', difficulty: 'normal' });
    for (const [cx, cz, data] of entries) {
      await this.db.chunks.put(`${id}:${this.dim}:${cx},${cz}`, data);
    }
    return id;
  }

  // ---- internals -----------------------------------------------------------

  private newId(): string {
    return `world-${Date.now().toString(36)}-${Math.floor(Math.random() * 1e6).toString(36)}`;
  }

  private bind(id: string, savedKeys: Set<string>): void {
    this.currentWorldId = id;
    this.savedKeys = savedKeys;
  }

  private chunkKey(worldId: string, cx: number, cz: number): string {
    return `${worldId}:${this.dim}:${cx},${cz}`;
  }

  private parseChunkKey(key: string): { cx: number; cz: number; dim: string } {
    const rest = key.slice(key.indexOf(':') + 1); // drop worldId
    const lastColon = rest.lastIndexOf(':');
    const dim = rest.slice(0, lastColon);
    const [cx, cz] = rest.slice(lastColon + 1).split(',').map(Number);
    return { cx, cz, dim };
  }

  private async chunkKeysFor(id: string): Promise<Set<string>> {
    const entries = await this.db.chunks.entries(`${id}:`);
    return new Set(entries.map(([k]) => k));
  }

  private async createRecord(id: string, p: CreateParams, levelDat?: Uint8Array, icon?: Uint8Array): Promise<WorldRecord> {
    const dat = levelDat ?? await LevelStorage.serialize(LevelStorage.createLevelDat({
      name: p.name,
      seed: p.seed,
      gameMode: p.gameMode,
      difficulty: p.difficulty,
      hardcore: p.hardcore,
      allowCommands: p.allowCommands,
      generateStructures: p.generateStructures,
    }));
    const rec: WorldRecord = {
      id,
      name: p.name,
      seed: p.seed.toString(),
      gameMode: narrowGameMode(p.gameMode),
      difficulty: narrowDifficulty(p.difficulty),
      hardcore: p.hardcore ?? false,
      lastPlayed: Date.now(),
      version: '26.2',
      levelDat: dat,
      icon,
    };
    await this.db.worlds.put(id, rec);
    return rec;
  }

  private async deletePrefix(store: { entries(prefix?: string): Promise<[string, unknown][]>; delete(k: string): Promise<void> }, prefix: string): Promise<void> {
    for (const [k] of await store.entries(prefix)) await store.delete(k);
  }
}
