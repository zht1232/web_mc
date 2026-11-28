// Port of net.minecraft.world.level.chunk.{PalettedContainer, DataLayer, LevelChunkSection, LevelChunk}
// and net.minecraft.util.{SimpleBitStorage, ZeroBitStorage}.
//
// Sections store block state ids; a palette plus packed bits keeps a typical
// section near 2 KB instead of the 8 KB a raw Uint16Array would need.

import { ceilLog2 } from '../../../core/Mth.js';
import type { MinecraftData } from '../block/state/BlockState.js';

export const SECTION_SIZE = 16;
export const SECTION_VOLUME = SECTION_SIZE * SECTION_SIZE * SECTION_SIZE;
export const SECTION_MASK = SECTION_SIZE - 1;

/** Packs values of `bits` bits, vanilla SimpleBitStorage style. */
export class BitStorage {
  readonly bits: number;
  readonly size: number;
  readonly mask: number;
  readonly data: Uint32Array;

  constructor(bits: number, size: number) {
    this.bits = bits;
    this.size = size;
    this.mask = (1 << bits) - 1;
    this.data = new Uint32Array(Math.ceil((bits * size) / 32));
  }

  get(index: number): number {
    const bit = index * this.bits;
    const word = bit >>> 5;
    const off = bit & 31;
    let v = this.data[word] >>> off;
    if (off + this.bits > 32) v |= this.data[word + 1] << (32 - off);
    return v & this.mask;
  }

  set(index: number, value: number): void {
    const bit = index * this.bits;
    const word = bit >>> 5;
    const off = bit & 31;
    const v = value & this.mask;
    this.data[word] = (this.data[word] & ~(this.mask << off)) | (v << off);
    if (off + this.bits > 32) {
      const spill = 32 - off;
      this.data[word + 1] = (this.data[word + 1] & ~(this.mask >>> spill)) | (v >>> spill);
    }
  }

  fill(value: number): void {
    const v = value & this.mask;
    // build one full word worth of repeated values
    let word = 0;
    for (let i = 0; i < Math.floor(32 / this.bits); i++) word |= v << (i * this.bits);
    this.data.fill(word);
  }
}

/** A 16x16x16 paletted container of small non-negative ints. */
export class PalettedContainer {
  palette: number[] = [0];
  private paletteIndex = new Map<number, number>([[0, 0]]);
  private storage: BitStorage | null = null;
  private bits = 0;
  /** when bits exceed the palette limit we store raw values */
  private direct = false;

  constructor(private readonly directBits = 15, private readonly paletteMaxBits = 8) {}

  static filled(value: number): PalettedContainer {
    const c = new PalettedContainer();
    c.palette = [value];
    c.paletteIndex = new Map([[value, 0]]);
    return c;
  }

  get(index: number): number {
    if (!this.storage) return this.palette[0];
    if (this.direct) return this.storage.get(index);
    return this.palette[this.storage.get(index)];
  }

  set(index: number, value: number): void {
    if (!this.storage) {
      if (value === this.palette[0]) return;
      this.grow(this.bitsFor(this.palette.length + 1));
    }
    if (this.direct) {
      this.storage!.set(index, value);
      return;
    }
    let pi = this.paletteIndex.get(value);
    if (pi === undefined) {
      pi = this.palette.length;
      if (this.bitsFor(pi + 1) > this.paletteMaxBits) {
        this.toDirect();
        this.storage!.set(index, value);
        return;
      }
      if (this.bitsFor(pi + 1) > this.bits) {
        this.grow(this.bitsFor(pi + 1));
      }
      this.palette.push(value);
      this.paletteIndex.set(value, pi);
    }
    this.storage!.set(index, pi);
  }

  private bitsFor(paletteSize: number): number {
    return Math.max(4, ceilLog2(Math.max(1, paletteSize)));
  }

  private grow(newBits: number): void {
    const old = this.storage;
    const next = new BitStorage(newBits, SECTION_VOLUME);
    if (old) {
      // old values are palette indices; keep them
      for (let i = 0; i < SECTION_VOLUME; i++) next.set(i, old.get(i));
    }
    this.storage = next;
    this.bits = newBits;
  }

  private toDirect(): void {
    const old = this.storage;
    const next = new BitStorage(this.directBits, SECTION_VOLUME);
    for (let i = 0; i < SECTION_VOLUME; i++) next.set(i, this.palette[old!.get(i)]);
    this.storage = next;
    this.bits = this.directBits;
    this.direct = true;
    this.palette = [];
    this.paletteIndex.clear();
  }

  /** Copies the whole container (used when a chunk is cloned). */
  clone(): PalettedContainer {
    const c = new PalettedContainer(this.directBits, this.paletteMaxBits);
    c.palette = this.palette.slice();
    c.paletteIndex = new Map(this.paletteIndex);
    c.bits = this.bits;
    c.direct = this.direct;
    c.storage = this.storage ? new BitStorage(this.bits, SECTION_VOLUME) : null;
    if (c.storage) c.storage.data.set(this.storage!.data);
    return c;
  }

  countNonZero(): number {
    let n = 0;
    for (let i = 0; i < SECTION_VOLUME; i++) if (this.get(i) !== 0) n++;
    return n;
  }

  /** Iterates every entry; the callback gets a section-local index 0..4095. */
  forEach(fn: (index: number, value: number) => void): void {
    for (let i = 0; i < SECTION_VOLUME; i++) fn(i, this.get(i));
  }

  isSingleValue(): boolean { return this.storage === null && !this.direct; }
  singleValue(): number { return this.palette[0]; }
}

/** Port of net.minecraft.world.level.chunk.DataLayer: 4 bits per entry, 0..15. */
export class DataLayer {
  readonly data: Uint8Array;

  constructor(size = SECTION_VOLUME) {
    this.data = new Uint8Array(size >> 1);
  }

  static from(data: Uint8Array): DataLayer {
    const l = new DataLayer(data.length * 2);
    l.data.set(data);
    return l;
  }

  get(x: number, y: number, z: number): number {
    return this.getIndex(index(x, y, z));
  }

  getIndex(index: number): number {
    const b = this.data[index >> 1];
    return (index & 1) === 0 ? b & 15 : (b >> 4) & 15;
  }

  set(x: number, y: number, z: number, value: number): void {
    this.setIndex(index(x, y, z), value);
  }

  setIndex(index: number, value: number): void {
    const i = index >> 1;
    this.data[i] = (index & 1) === 0
      ? ((this.data[i] & 0xf0) | (value & 15))
      : ((this.data[i] & 0x0f) | ((value & 15) << 4));
  }

  isEmpty(): boolean {
    for (let i = 0; i < this.data.length; i++) if (this.data[i] !== 0) return false;
    return true;
  }

  fill(value: number): void {
    const v = (value & 15) | ((value & 15) << 4);
    this.data.fill(v);
  }

  clone(): DataLayer {
    const l = new DataLayer(this.data.length * 2);
    l.data.set(this.data);
    return l;
  }
}

export function index(x: number, y: number, z: number): number {
  return (y << 8) | (z << 4) | x;
}

export function indexX(i: number): number { return i & 15; }
export function indexY(i: number): number { return (i >> 8) & 15; }
export function indexZ(i: number): number { return (i >> 4) & 15; }

/** Port of LevelChunkSection. */
export class LevelChunkSection {
  states: PalettedContainer;
  biomes: PalettedContainer;
  skyLight: DataLayer | null = null;
  blockLight: DataLayer | null = null;
  nonEmptyBlockCount = 0;
  /** true when the section only holds air */
  private empty = true;

  constructor(public readonly sectionY: number) {
    this.states = PalettedContainer.filled(0);
    this.biomes = PalettedContainer.filled(0);
  }

  get minY(): number { return this.sectionY << 4; }

  getBlockState(x: number, y: number, z: number): number { return this.states.get(index(x, y, z)); }

  setBlockState(x: number, y: number, z: number, state: number): number {
    const i = index(x, y, z);
    const prev = this.states.get(i);
    if (prev === state) return prev;
    this.states.set(i, state);
    if (prev !== 0) this.nonEmptyBlockCount--;
    if (state !== 0) this.nonEmptyBlockCount++;
    this.empty = this.nonEmptyBlockCount === 0;
    return prev;
  }

  /** Reads a state by section-local index. */
  getState(index: number): number { return this.states.get(index); }

  isOnlyAir(): boolean { return this.empty; }

  recalcEmpty(mc: MinecraftData): void {
    let n = 0;
    for (let i = 0; i < SECTION_VOLUME; i++) if (!mc.isAir(this.states.get(i))) n++;
    this.nonEmptyBlockCount = n;
    this.empty = n === 0;
  }

  getSkyLight(): DataLayer {
    if (!this.skyLight) this.skyLight = new DataLayer();
    return this.skyLight;
  }

  getBlockLight(): DataLayer {
    if (!this.blockLight) this.blockLight = new DataLayer();
    return this.blockLight;
  }

  hasSkyLight(): boolean { return this.skyLight !== null; }
  hasBlockLight(): boolean { return this.blockLight !== null; }

  /** Vanilla LevelChunkSection.getLightEngine-facing helper. */
  isEmptySky(): boolean { return !this.skyLight || this.skyLight.isEmpty(); }
}

export interface Heightmap {
  /** packed (z << 4 | x) -> height */
  data: Int16Array;
}

export interface BlockEntityRecord {
  type: string;
  data: Record<string, unknown>;
}

/** Port of LevelChunk (client side needs: sections, heightmaps, block entities, light). */
export class LevelChunk {
  readonly sections: (LevelChunkSection | undefined)[];
  readonly minSection: number;
  readonly sectionCount: number;
  /** block entities keyed by section-local packed pos */
  readonly blockEntities = new Map<number, BlockEntityRecord>();
  /** heightmap: highest non-air block per column, minimum y of the world when empty */
  readonly surfaceHeight: Int16Array;
  readonly motionBlockingHeight: Int16Array;
  /** set when the chunk needs a mesh rebuild (consumed/reset by LevelRenderer) */
  dirty = true;
  /** Section-Y values whose contents changed since the last save (save-layer dirty tracking).
   *  Unlike `dirty` this is never cleared by the renderer, so WorldSaveManager can rely on it. */
  readonly dirtySections = new Set<number>();

  constructor(
    public readonly x: number,
    public readonly z: number,
    public readonly minY: number,
    public readonly height: number,
    private readonly mc: MinecraftData,
  ) {
    this.minSection = minY >> 4;
    this.sectionCount = height >> 4;
    this.sections = new Array(this.sectionCount);
    this.surfaceHeight = new Int16Array(256).fill(minY - 1);
    this.motionBlockingHeight = new Int16Array(256).fill(minY - 1);
  }

  get minSectionY(): number { return this.minSection; }
  get maxSectionY(): number { return this.minSection + this.sectionCount - 1; }

  getSection(sy: number): LevelChunkSection | undefined {
    const i = sy - this.minSection;
    if (i < 0 || i >= this.sectionCount) return undefined;
    return this.sections[i];
  }

  getOrCreateSection(sy: number): LevelChunkSection {
    const i = sy - this.minSection;
    if (i < 0 || i >= this.sectionCount) throw new Error(`section ${sy} out of range`);
    let s = this.sections[i];
    if (!s) {
      s = new LevelChunkSection(sy);
      this.sections[i] = s;
      // Chunks are lit when they load, and only the sections up to each column's
      // surface exist then. A section created later (player builds high in the air,
      // a test stage, /setblock) starts as an empty all-zero sky layer; without
      // this seed its open air is sky light 0 and every new face renders black.
      // A section whose bottom is above every existing block is entirely open sky.
      let highest = this.minY - 1;
      for (let c = 0; c < 256; c++) {
        if (this.surfaceHeight[c] > highest) highest = this.surfaceHeight[c];
      }
      if ((sy << 4) > highest) s.getSkyLight().fill(15);
    }
    return s;
  }

  getBlockState(x: number, y: number, z: number): number {
    const sy = y >> 4;
    const s = this.getSection(sy);
    if (!s) return 0;
    return s.getBlockState(x & 15, y & 15, z & 15);
  }

  setBlockState(x: number, y: number, z: number, state: number): number {
    const sy = y >> 4;
    const s = this.getOrCreateSection(sy);
    const prev = s.setBlockState(x & 15, y & 15, z & 15, state);
    const column = ((z & 15) << 4) | (x & 15);
    if (y > this.surfaceHeight[column] && !this.mc.isAir(state)) {
      this.surfaceHeight[column] = y;
    } else if (y === this.surfaceHeight[column] && this.mc.isAir(state)) {
      // walk down to the next non empty block
      let ny = y - 1;
      while (ny >= this.minY && this.mc.isAir(this.getBlockState(x, ny, z))) ny--;
      this.surfaceHeight[column] = ny;
    }
    this.dirty = true;
    this.markDirty(x, y, z);
    return prev;
  }

  /** Records that the section containing (x,y,z) has been modified and needs persisting. */
  markDirty(x: number, y: number, z: number): void {
    this.dirtySections.add(y >> 4);
  }

  /** Clears save-layer dirty state after a successful flush. */
  clearDirty(): void {
    this.dirtySections.clear();
  }

  recalcHeightmaps(): void {
    for (let z = 0; z < 16; z++) {
      for (let x = 0; x < 16; x++) {
        let surface = this.minY - 1;
        let motion = this.minY - 1;
        for (let y = this.minY + this.height - 1; y >= this.minY; y--) {
          const state = this.getBlockState(x, y, z);
          if (this.mc.isAir(state)) continue;
          if (surface === this.minY - 1) surface = y;
          if (motion === this.minY - 1 && !this.mc.isLiquid(state)) motion = y;
          if (surface !== this.minY - 1 && motion !== this.minY - 1) break;
        }
        const col = (z << 4) | x;
        this.surfaceHeight[col] = surface;
        this.motionBlockingHeight[col] = motion;
      }
    }
  }

  getHeight(column: number): number { return this.surfaceHeight[column]; }

  addBlockEntity(localX: number, y: number, localZ: number, record: BlockEntityRecord): void {
    this.blockEntities.set(index(localX & 15, y & 15, localZ & 15) | ((y >> 4) << 12), record);
  }

  getBlockEntity(localX: number, y: number, localZ: number): BlockEntityRecord | undefined {
    return this.blockEntities.get(index(localX & 15, y & 15, localZ & 15) | ((y >> 4) << 12));
  }
}
