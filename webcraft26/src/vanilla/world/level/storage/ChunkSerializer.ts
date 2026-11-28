// Port of net.minecraft.world.level.chunk.storage.SerializableChunkData (the 26.2 successor of
// ChunkSerializer). Produces a chunk NBT tree structurally identical to vanilla 26.2:
//
//   { DataVersion, xPos, yPos, zPos, LastUpdate, InhabitedTime, Status,
//     sections:[ { Y, block_states:{palette,data}, biomes:{palette,data},
//                  BlockLight, SkyLight } ], isLightOn, block_entities }
//
// Palette entries use the BlockStateParser string form  minecraft:<name>[prop=value,...]
// (the task's requested simplification vs vanilla's {Name,Properties} compounds; the READER
// accepts both string and {Name,Properties} forms, so real 26.2 chunks parse too).
// `data` is a LongArrayTag of bit-packed palette indices using vanilla SimpleBitStorage layout
// (valuesPerLong = 64/bits, LSB first, no value crosses a long boundary, bits >= 4).

import { CompoundTag } from '../../../nbt/CompoundTag.js';
import { ListTag } from '../../../nbt/ListTag.js';
import { StringTag } from '../../../nbt/StringTag.js';
import { LongArrayTag } from '../../../nbt/LongArrayTag.js';
import { ByteArrayTag } from '../../../nbt/ByteArrayTag.js';
import { IntTag } from '../../../nbt/IntTag.js';
import { DoubleTag } from '../../../nbt/DoubleTag.js';
import { FloatTag } from '../../../nbt/FloatTag.js';
import { addDataVersion, valueToTag, tagToValue } from '../../../nbt/NbtUtils.js';
import * as NbtIo from '../../../nbt/NbtIo.js';
import { ceilLog2 } from '../../../core/Mth.js';
import {
  LevelChunk, LevelChunkSection, PalettedContainer, DataLayer, SECTION_VOLUME,
} from '../chunk/LevelChunk.js';
import type { MinecraftData } from '../block/state/BlockState.js';

const TWO64 = 1n << 64n;
const TWO63 = 1n << 63n;

// ---- injectable codecs ----------------------------------------------------

/** Maps a numeric runtime block-state id to/from a BlockStateParser string. */
export interface BlockStateCodec {
  toString(state: number): string;
  fromString(s: string): number;
}

/** Maps a numeric biome id to/from a resource-location-shaped string. */
export interface BiomeCodec {
  toString(id: number): string;
  fromString(s: string): number;
}

/**
 * Dependency-free reversible block codec: numeric state ids <-> `minecraft:block_<id>` strings.
 * Used as a safe default when no MinecraftData is injected (Node tests, headless tools).
 */
export class ReversibleBlockStateCodec implements BlockStateCodec {
  toString(state: number): string {
    return state === 0 ? 'minecraft:air' : `minecraft:block_${state >>> 0}`;
  }
  fromString(s: string): number {
    if (s === 'minecraft:air' || s === 'air') return 0;
    const m = /block_(\d+)/.exec(s);
    return m ? Number(m[1]) >>> 0 : 0;
  }
}

/** Production codec backed by the real MinecraftData registry (net.minecraft BlockStateParser). */
export class MinecraftDataBlockStateCodec implements BlockStateCodec {
  constructor(private readonly mc: MinecraftData) {}

  toString(state: number): string {
    const b = this.mc.blockOf(state);
    let s = `minecraft:${b.name}`;
    if (b.props.length) {
      const parts: string[] = [];
      for (const p of b.props) {
        const v = this.mc.getProp(state, p.name);
        if (v !== undefined) parts.push(`${p.name}=${v}`);
      }
      if (parts.length) s += `[${parts.join(',')}]`;
    }
    return s;
  }

  fromString(s: string): number {
    let name = s;
    const props: Record<string, string> = {};
    const bracket = s.indexOf('[');
    if (bracket >= 0 && s.endsWith(']')) {
      name = s.slice(0, bracket);
      const inner = s.slice(bracket + 1, -1);
      if (inner) {
        for (const part of inner.split(',')) {
          const eq = part.indexOf('=');
          if (eq > 0) props[part.slice(0, eq).trim()] = part.slice(eq + 1).trim();
        }
      }
    }
    if (name.startsWith('minecraft:')) name = name.slice('minecraft:'.length);
    try {
      return this.mc.stateOf(name, Object.keys(props).length ? props : undefined);
    } catch {
      return 0; // unknown block -> air (documented fallback)
    }
  }
}

/**
 * Reversible default biome codec: numeric ids are encoded as valid resource locations
 * `minecraft:biome_<id>`. Wire a NamedBiomeCodec for human/vanilla biome names.
 */
export class ReversibleBiomeCodec implements BiomeCodec {
  toString(id: number): string { return `minecraft:biome_${id >>> 0}`; }
  fromString(s: string): number {
    const m = /biome_(\d+)$/.exec(s);
    return m ? Number(m[1]) >>> 0 : 0;
  }
}

/** Biome codec using a real id -> name table (e.g. from worldgen.json). */
export class NamedBiomeCodec implements BiomeCodec {
  private readonly byName = new Map<string, number>();
  constructor(private readonly names: string[]) {
    names.forEach((n, i) => this.byName.set(n.includes(':') ? n : `minecraft:${n}`, i));
  }
  toString(id: number): string {
    const n = this.names[id];
    return n ? (n.includes(':') ? n : `minecraft:${n}`) : `minecraft:biome_${id >>> 0}`;
  }
  fromString(s: string): number {
    const n = this.byName.get(s) ?? this.byName.get(`minecraft:${s}`);
    if (n !== undefined) return n;
    const m = /biome_(\d+)$/.exec(s);
    return m ? Number(m[1]) >>> 0 : 0;
  }
}

export interface ChunkCodecOptions {
  blockCodec: BlockStateCodec;
  biomeCodec?: BiomeCodec;
  /** world bottom (default -64) and height (default 384), used by read() */
  minY?: number;
  height?: number;
  recalcHeightmaps?: boolean;
}

// ---- vanilla SimpleBitStorage packing ------------------------------------

function bitsFor(paletteSize: number): number {
  return Math.max(4, ceilLog2(Math.max(1, paletteSize)));
}

function packIndices(indices: number[], bits: number): bigint[] {
  if (indices.length === 0) return [];
  const valuesPerLong = Math.floor(64 / bits);
  const longCount = Math.ceil(indices.length / valuesPerLong);
  const longs = new Array<bigint>(longCount);
  const maskNum = bits >= 32 ? 0xffffffff : (1 << bits) - 1;

  // Pack with plain 32-bit halves (one BigInt construction per long instead of per element).
  // Values never cross a 64-bit long boundary (valuesPerLong = floor(64/bits)), but a value can
  // straddle the 32-bit mid-point; `divs[k]` recovers the overflow into the high half.
  const divs = new Float64Array(valuesPerLong);
  for (let k = 0; k < valuesPerLong; k++) {
    const off = k * bits;
    divs[k] = off < 32 ? Math.pow(2, 32 - off) : 0;
  }

  for (let li = 0; li < longCount; li++) {
    let lo = 0, hi = 0;
    const base = li * valuesPerLong;
    const end = Math.min(base + valuesPerLong, indices.length);
    for (let k = 0; base + k < end; k++) {
      const off = k * bits;
      const v = indices[base + k] & maskNum;
      if (off < 32) {
        lo = (lo | ((v << off) >>> 0)) >>> 0;
        if (off + bits > 32) hi = (hi | Math.floor(v / divs[k])) >>> 0;
      } else {
        hi = (hi | ((v << (off - 32)) >>> 0)) >>> 0;
      }
    }
    let u = (BigInt(hi >>> 0) << 32n) | BigInt(lo >>> 0);
    if (u >= TWO63) u -= TWO64; // LongArrayTag stores signed 64-bit
    longs[li] = u;
  }
  return longs;
}

function unpackIndices(longs: bigint[], count: number, bits: number): number[] {
  const valuesPerLong = Math.floor(64 / bits);
  const mask = (1n << BigInt(bits)) - 1n;
  const out = new Array<number>(count).fill(0);
  if (longs.length === 0) return out; // singleton palette: every index is 0
  for (let i = 0; i < count; i++) {
    const li = Math.floor(i / valuesPerLong);
    let v = longs[li] ?? 0n;
    if (v < 0n) v += TWO64; // signed -> unsigned
    const off = (i % valuesPerLong) * bits;
    out[i] = Number((v >> BigInt(off)) & mask);
  }
  return out;
}

interface PaletteData { palette: string[]; data: bigint[]; }

/** Builds a palette + bit-packed `data` from a runtime PalettedContainer. */
function serializePaletted(container: PalettedContainer, codec: BlockStateCodec | BiomeCodec): PaletteData {
  // Fast path for a uniform section (very common: air / solid stone): vanilla ZeroBitStorage.
  if (container.isSingleValue()) {
    return { palette: [codec.toString(container.singleValue())], data: [] };
  }
  // Single fused pass: read each cell once, dedupe via a sparse array LUT (faster than a Map
  // for the integer state/biome ids), and record the palette index for the bit packer.
  const unique: number[] = [];
  const lut: (number | undefined)[] = [];
  const indices = new Array<number>(SECTION_VOLUME);
  for (let i = 0; i < SECTION_VOLUME; i++) {
    const v = container.get(i);
    let pi = lut[v];
    if (pi === undefined) { pi = unique.length; unique.push(v); lut[v] = pi; }
    indices[i] = pi;
  }
  return {
    palette: unique.map((v) => codec.toString(v)),
    data: packIndices(indices, bitsFor(unique.length)),
  };
}

function writePalettedCompound(p: PaletteData): CompoundTag {
  const c = new CompoundTag();
  const list = new ListTag();
  for (const s of p.palette) list.add(StringTag.of(s));
  c.put('palette', list);
  c.put('data', new LongArrayTag(p.data));
  return c;
}

/** Reads a palette that may be StringTags (our format) or {Name,Properties} Compounds (vanilla). */
function paletteToStrings(list: ListTag): string[] {
  const out: string[] = [];
  for (const el of list.list) {
    if (el instanceof StringTag) { out.push(el.value); continue; }
    if (el instanceof CompoundTag) {
      let name = el.getStringOr('Name', 'minecraft:air');
      const props = el.getCompound('Properties');
      if (props && props.size() > 0) {
        const parts: string[] = [];
        for (const [k, v] of props.tags) {
          if (v instanceof StringTag) parts.push(`${k}=${v.value}`);
          else parts.push(`${k}=${v.toString()}`);
        }
        name += `[${parts.join(',')}]`;
      }
      out.push(name);
    }
  }
  return out;
}

function readPalettedCompound(c: CompoundTag | undefined, codec: BlockStateCodec | BiomeCodec): number[] {
  if (!c) return new Array<number>(SECTION_VOLUME).fill(0);
  const palette = paletteToStrings(c.getListOrEmpty('palette'));
  if (palette.length === 0) return new Array<number>(SECTION_VOLUME).fill(0);
  const values = palette.map((s) => codec.fromString(s));
  const data = c.getLongArray('data') ?? [];
  const bits = bitsFor(palette.length);
  const indices = unpackIndices(data, SECTION_VOLUME, bits);
  const out = new Array<number>(SECTION_VOLUME);
  for (let i = 0; i < SECTION_VOLUME; i++) out[i] = values[indices[i]] ?? values[0];
  return out;
}

/** Entity NBT uses a homogeneous DoubleList for Pos/Motion. */
function doubleList(values: readonly number[]): ListTag {
  const list = new ListTag();
  for (const v of values) list.add(DoubleTag.of(v));
  return list;
}

/** Entity NBT uses a homogeneous FloatList for Rotation. */
function floatList(values: readonly number[]): ListTag {
  const list = new ListTag();
  for (const v of values) list.add(FloatTag.of(v));
  return list;
}

// ---- chunk read / write ---------------------------------------------------

export class ChunkSerializer {
  /** Serialises a LevelChunk into a vanilla 26.2 chunk NBT tree. */
  static write(chunk: LevelChunk, opts: ChunkCodecOptions): CompoundTag {
    const biomeCodec = opts.biomeCodec ?? new ReversibleBiomeCodec();
    const root = new CompoundTag();
    addDataVersion(root);
    root.putInt('xPos', chunk.x);
    root.putInt('yPos', chunk.minSectionY);
    root.putInt('zPos', chunk.z);
    root.putLong('LastUpdate', 0n);
    root.putLong('InhabitedTime', 0n);
    root.putString('Status', 'minecraft:full');

    const sections = new ListTag();
    for (const section of chunk.sections) {
      if (!section) continue; // vanilla drops never-created (all-air) sections
      const sectionTag = new CompoundTag();
      sectionTag.put('block_states', writePalettedCompound(serializePaletted(section.states, opts.blockCodec)));
      sectionTag.put('biomes', writePalettedCompound(serializePaletted(section.biomes, biomeCodec)));
      if (section.blockLight) sectionTag.putByteArray('BlockLight', section.blockLight.data);
      if (section.skyLight) sectionTag.putByteArray('SkyLight', section.skyLight.data);
      sectionTag.putByte('Y', section.sectionY);
      sections.add(sectionTag);
    }
    root.put('sections', sections);
    root.putBoolean('isLightOn', true);

    const blockEntities = new ListTag();
    for (const [packed, rec] of chunk.blockEntities) {
      const sectionY = packed >> 12;
      const local = packed & 0xfff;
      const lx = local & 15;
      const lz = (local >> 4) & 15;
      const ly = (local >> 8) & 15;
      const wy = sectionY * 16 + ly;
      const be = new CompoundTag();
      be.putInt('x', lx); be.putInt('y', wy); be.putInt('z', lz);
      be.putString('id', rec.type);
      be.put('data', valueToTag(rec.data) as CompoundTag);
      blockEntities.add(be);
    }
    root.put('block_entities', blockEntities);

    // Entity.save() shape: id + Pos/Rotation/Motion lists + Health; the port's
    // type-specific payload lives in `data`.
    const entities = new ListTag();
    for (const rec of chunk.entities) {
      const e = new CompoundTag();
      e.putString('id', rec.type);
      e.put('Pos', doubleList([rec.x, rec.y, rec.z]));
      e.put('Rotation', floatList([rec.yaw, rec.pitch]));
      e.put('Motion', doubleList([rec.vx, rec.vy, rec.vz]));
      if (rec.health !== undefined) e.putFloat('Health', rec.health);
      if (rec.data) e.put('data', valueToTag(rec.data));
      entities.add(e);
    }
    root.put('Entities', entities);
    return root;
  }

  /** Rebuilds a LevelChunk from a chunk NBT tree. Accepts `sections`/`Sections` and `Y`/`y`. */
  static read(root: CompoundTag, mc: MinecraftData, opts: ChunkCodecOptions): LevelChunk {
    const biomeCodec = opts.biomeCodec ?? new ReversibleBiomeCodec();
    const xPos = root.getIntOr('xPos', 0);
    const zPos = root.getIntOr('zPos', 0);
    const yPos = root.getIntOr('yPos', -4);
    const minY = opts.minY ?? yPos * 16;
    const height = opts.height ?? 384;
    const chunk = new LevelChunk(xPos, zPos, minY, height, mc);

    const sections = root.getList('sections') ?? root.getList('Sections');
    if (sections) {
      for (const el of sections.list) {
        if (!(el instanceof CompoundTag)) continue;
        const sectionY = el.getByte('Y') ?? el.getByte('y') ?? 0;
        const section = chunk.getOrCreateSection(sectionY);

        const blockStates = readPalettedCompound(el.getCompound('block_states'), opts.blockCodec);
        const biomes = readPalettedCompound(el.getCompound('biomes'), biomeCodec);
        for (let i = 0; i < SECTION_VOLUME; i++) {
          section.states.set(i, blockStates[i]);
          section.biomes.set(i, biomes[i]);
        }

        const blockLight = el.getByteArray('BlockLight');
        const skyLight = el.getByteArray('SkyLight');
        if (blockLight) section.blockLight = DataLayer.from(blockLight);
        if (skyLight) section.skyLight = DataLayer.from(skyLight);
      }
    }

    const blockEntities = root.getList('block_entities');
    if (blockEntities) {
      for (const el of blockEntities.list) {
        if (!(el instanceof CompoundTag)) continue;
        const x = el.getIntOr('x', 0), y = el.getIntOr('y', 0), z = el.getIntOr('z', 0);
        const id = el.getStringOr('id', '');
        const data = el.getCompound('data');
        chunk.addBlockEntity(x, y, z, { type: id, data: data ? (tagToValue(data) as Record<string, unknown>) : {} });
      }
    }

    const entities = root.getList('Entities') ?? root.getList('entities');
    chunk.hadEntities = !!entities && entities.list.length > 0;
    if (entities) {
      for (const el of entities.list) {
        if (!(el instanceof CompoundTag)) continue;
        const type = el.getStringOr('id', '').replace(/^minecraft:/, '');
        if (!type) continue;
        const pos = el.getList('Pos')?.list.map(tagToValue) ?? [];
        const rot = el.getList('Rotation')?.list.map(tagToValue) ?? [];
        const motion = el.getList('Motion')?.list.map(tagToValue) ?? [];
        const dataTag = el.getCompound('data');
        chunk.entities.push({
          type,
          x: Number(pos[0] ?? 0), y: Number(pos[1] ?? 0), z: Number(pos[2] ?? 0),
          yaw: Number(rot[0] ?? 0), pitch: Number(rot[1] ?? 0),
          vx: Number(motion[0] ?? 0), vy: Number(motion[1] ?? 0), vz: Number(motion[2] ?? 0),
          health: el.getFloat('Health'),
          data: dataTag ? tagToValue(dataTag) as Record<string, unknown> : undefined,
        });
      }
    }

    if (opts.recalcHeightmaps !== false && typeof mc.isAir === 'function' && typeof mc.isLiquid === 'function') {
      chunk.recalcHeightmaps();
    }
    return chunk;
  }

  /** Convenience: uncompressed NBT bytes (NbtIo.write) for the IndexedDB `chunks` store. */
  static toBytes(chunk: LevelChunk, opts: ChunkCodecOptions): Uint8Array {
    return NbtIo.write(ChunkSerializer.write(chunk, opts));
  }

  static fromBytes(bytes: Uint8Array, mc: MinecraftData, opts: ChunkCodecOptions): LevelChunk {
    return ChunkSerializer.read(NbtIo.read(bytes), mc, opts);
  }
}
