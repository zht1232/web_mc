// Port of net.minecraft.nbt.Tag (sealed interface) and the DataInput/DataOutput contracts it
// writes against. Java's java.io.DataOutput/DataInput are big-endian; our streams live in NbtIo.ts
// and implement these structural interfaces so tags never import NbtIo (no cycle).

import type { TagType } from './TagTypes.js';

/** java.io.DataOutput subset used by NBT tags. All multi-byte values are big-endian. */
export interface DataOutput {
  writeByte(v: number): void;
  writeShort(v: number): void;
  writeInt(v: number): void;
  writeLong(v: bigint): void;
  writeFloat(v: number): void;
  writeDouble(v: number): void;
  writeBytes(bytes: Uint8Array): void;
  /** Java modified UTF-8: 2-byte length prefix followed by the encoded bytes. */
  writeUTF(s: string): void;
  skipString(): void; // writes an empty UTF name
}

/** java.io.DataInput subset used by NBT tags. */
export interface DataInput {
  readByte(): number;          // signed
  readUnsignedByte(): number;  // 0..255
  readShort(): number;
  readInt(): number;
  readLong(): bigint;
  readFloat(): number;
  readDouble(): number;
  readBytes(n: number): Uint8Array;
  readUTF(): string;
  skipBytes(n: number): void;
  remaining(): number;
}

/** net.minecraft.nbt.TagVisitor (loose: params typed as base Tag to avoid importing every tag). */
export interface TagVisitor {
  visitEnd(tag: Tag): void;
  visitByte(tag: Tag): void;
  visitShort(tag: Tag): void;
  visitInt(tag: Tag): void;
  visitLong(tag: Tag): void;
  visitFloat(tag: Tag): void;
  visitDouble(tag: Tag): void;
  visitByteArray(tag: Tag): void;
  visitString(tag: Tag): void;
  visitList(tag: Tag): void;
  visitCompound(tag: Tag): void;
  visitIntArray(tag: Tag): void;
  visitLongArray(tag: Tag): void;
}

/**
 * Serializer installed by StringTagVisitor.ts at load time. Tags' toString() delegates here so
 * we do not need a runtime import from every tag back into StringTagVisitor (avoids a cycle).
 */
let snbtSerializer: ((tag: Tag) => string) | null = null;
export function setSnbtSerializer(fn: (tag: Tag) => string): void {
  snbtSerializer = fn;
}

export abstract class Tag {
  abstract getId(): number;
  abstract getType(): TagType;
  /** Writes only the payload (id + name are written by the parent / NbtIo). */
  abstract write(out: DataOutput): void;
  abstract copy(): Tag;
  abstract equals(other: Tag): boolean;
  abstract accept(visitor: TagVisitor): void;

  /** Vanilla Tag.toString(): SNBT via StringTagVisitor. */
  toString(): string {
    return snbtSerializer ? snbtSerializer(this) : `[Tag#${this.getId()}]`;
  }
}
