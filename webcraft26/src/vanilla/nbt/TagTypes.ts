// Port of net.minecraft.nbt.TagTypes + the id constants from net.minecraft.nbt.Tag.
//
// Vanilla keeps a static array TYPES[id] -> TagType. In ESM that would create an import cycle
// (TagTypes -> every tag -> TagTypes for the id constants). We break it with lazy registration:
// every tag module calls registerTagType(TYPE) at load time, and NbtIo.ts side-effect-imports
// all of them before any binary read happens. getType() is the vanilla TagTypes.getType().

import type { Tag, DataInput } from './Tag.js';

/** Tag.TAG_* / TagTypes id table (values are stable across every NBT version). */
export const TAG_END = 0;
export const TAG_BYTE = 1;
export const TAG_SHORT = 2;
export const TAG_INT = 3;
export const TAG_LONG = 4;
export const TAG_FLOAT = 5;
export const TAG_DOUBLE = 6;
export const TAG_BYTE_ARRAY = 7;
export const TAG_STRING = 8;
export const TAG_LIST = 9;
export const TAG_COMPOUND = 10;
export const TAG_INT_ARRAY = 11;
export const TAG_LONG_ARRAY = 12;

/** Tag.MAX_DEPTH */
export const MAX_DEPTH = 512;

export interface TagType<T extends Tag = Tag> {
  readonly id: number;
  /** Reads the tag payload (the id byte has already been consumed by the caller). */
  load(input: DataInput, depth: number): T;
  /** Skips a payload without materialising it (used by streaming visitors). */
  skip(input: DataInput, depth: number): void;
  getName(): string;
  getPrettyName(): string;
}

const TYPE_NAMES: Record<number, string> = {
  [TAG_END]: 'END',
  [TAG_BYTE]: 'BYTE',
  [TAG_SHORT]: 'SHORT',
  [TAG_INT]: 'INT',
  [TAG_LONG]: 'LONG',
  [TAG_FLOAT]: 'FLOAT',
  [TAG_DOUBLE]: 'DOUBLE',
  [TAG_BYTE_ARRAY]: 'BYTE[]',
  [TAG_STRING]: 'STRING',
  [TAG_LIST]: 'LIST',
  [TAG_COMPOUND]: 'COMPOUND',
  [TAG_INT_ARRAY]: 'INT[]',
  [TAG_LONG_ARRAY]: 'LONG[]',
};

const TYPES: (TagType | undefined)[] = new Array(13);

/** Called by each tag module at evaluation time. */
export function registerTagType(type: TagType): void {
  TYPES[type.id] = type;
}

/** Vanilla TagTypes.getType(int); returns undefined for an unknown id. */
export function getType(id: number): TagType | undefined {
  return id >= 0 && id < TYPES.length ? TYPES[id] : undefined;
}

export function requireType(id: number): TagType {
  const t = getType(id);
  if (!t) throw new Error(`Unknown NBT tag type id ${id}`);
  return t;
}

export function typeName(id: number): string {
  return TYPE_NAMES[id] ?? `UNKNOWN_${id}`;
}

export function typePrettyName(id: number): string {
  const n = TYPE_NAMES[id];
  return n ? `TAG_${n.replace('[]', '_Array')}` : `TAG_Unknown_${id}`;
}
