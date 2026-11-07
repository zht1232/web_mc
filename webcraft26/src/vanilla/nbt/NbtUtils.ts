// Port of the useful parts of net.minecraft.nbt.NbtUtils:
//   * DataVersion helpers (addDataVersion / getDataVersion), 26.2 = 4903
//   * SNBT helpers (readSnbt / writeSnbt)
//   * generic JS value <-> NBT conversion used by PlayerData for opaque "extra" fields
import { Tag } from './Tag.js';
import { CompoundTag } from './CompoundTag.js';
import { ListTag } from './ListTag.js';
import { ByteTag } from './ByteTag.js';
import { ShortTag } from './ShortTag.js';
import { IntTag } from './IntTag.js';
import { LongTag } from './LongTag.js';
import { FloatTag } from './FloatTag.js';
import { DoubleTag } from './DoubleTag.js';
import { StringTag } from './StringTag.js';
import { ByteArrayTag } from './ByteArrayTag.js';
import { IntArrayTag } from './IntArrayTag.js';
import { LongArrayTag } from './LongArrayTag.js';
import { serialize, parse } from './StringTagVisitor.js';

/** SharedConstants.WORLD_VERSION for Minecraft 26.2 (SharedConstants.java). */
export const CURRENT_DATA_VERSION = 4903;
/** SharedConstants.SNBT_NAG_VERSION. */
export const SNBT_NAG_VERSION = 4882;

/** NbtUtils.addDataVersion / addCurrentDataVersion. */
export function addDataVersion(tag: CompoundTag, version = CURRENT_DATA_VERSION): CompoundTag {
  tag.putInt('DataVersion', version);
  return tag;
}

export function getDataVersion(tag: CompoundTag, fallback = -1): number {
  return tag.getIntOr('DataVersion', fallback);
}

export function readSnbt(snbt: string): Tag { return parse(snbt); }
export function writeSnbt(tag: Tag): string { return serialize(tag); }
export function toPrettyString(tag: Tag): string { return serialize(tag); }

/**
 * Converts an arbitrary structured-cloneable JS value into an NBT tag.
 * Numeric integers that fit int32 become IntTag, everything else numeric becomes DoubleTag;
 * bigint becomes LongTag; boolean becomes ByteTag 0/1; Uint8Array becomes ByteArrayTag.
 * Used to persist opaque `extra` records from the main agent without a schema.
 */
export function valueToTag(value: unknown): Tag {
  if (value === null || value === undefined) return StringTag.of('');
  if (typeof value === 'bigint') return LongTag.of(value);
  if (typeof value === 'boolean') return ByteTag.of(value);
  if (typeof value === 'number') {
    if (Number.isInteger(value) && value >= -2147483648 && value <= 2147483647) return IntTag.of(value);
    return DoubleTag.of(value);
  }
  if (typeof value === 'string') return StringTag.of(value);
  if (value instanceof Uint8Array) return new ByteArrayTag(value);
  if (value instanceof Int32Array) return new IntArrayTag(value);
  if (Array.isArray(value)) {
    const list = new ListTag();
    for (const v of value) list.add(valueToTag(v));
    return list;
  }
  if (value instanceof Float32Array) return new ListTag(Array.from(value, (v) => FloatTag.of(v)));
  if (value instanceof Float64Array) return new ListTag(Array.from(value, (v) => DoubleTag.of(v)));
  if (typeof value === 'object') {
    const c = new CompoundTag();
    for (const [k, v] of Object.entries(value as Record<string, unknown>)) {
      if (v !== undefined) c.put(k, valueToTag(v));
    }
    return c;
  }
  return StringTag.of(String(value));
}

/** Inverse of valueToTag. NBT has no boolean type, so ByteTag becomes 0/1 (documented). */
export function tagToValue(tag: Tag): unknown {
  if (tag instanceof ByteTag) return tag.value;
  if (tag instanceof ShortTag) return tag.value;
  if (tag instanceof IntTag) return tag.value;
  if (tag instanceof LongTag) return tag.value;
  if (tag instanceof FloatTag) return tag.value;
  if (tag instanceof DoubleTag) return tag.value;
  if (tag instanceof StringTag) return tag.value;
  if (tag instanceof ByteArrayTag) return tag.value;
  if (tag instanceof IntArrayTag) return tag.value;
  if (tag instanceof LongArrayTag) return tag.value;
  if (tag instanceof ListTag) return tag.list.map(tagToValue);
  if (tag instanceof CompoundTag) {
    const o: Record<string, unknown> = {};
    for (const [k, v] of tag.tags) o[k] = tagToValue(v);
    return o;
  }
  return undefined;
}

/** Deep equality of two tag trees (the tests use this for round-trip verification). */
export function nbtEquals(a: Tag, b: Tag): boolean { return a.equals(b); }

/** Structurally writes a Record<string, unknown> into an existing CompoundTag. */
export function writeRecord(target: CompoundTag, record: Record<string, unknown>): void {
  for (const [k, v] of Object.entries(record)) {
    if (v !== undefined) target.put(k, valueToTag(v));
  }
}

/** Reads a CompoundTag back into a plain Record<string, unknown>. */
export function readRecord(tag: CompoundTag): Record<string, unknown> {
  return tagToValue(tag) as Record<string, unknown>;
}

export {
  CompoundTag, ListTag, ByteTag, ShortTag, IntTag, LongTag, FloatTag, DoubleTag,
  StringTag, ByteArrayTag, IntArrayTag, LongArrayTag,
};
