// Port of net.minecraft.nbt.CompoundTag.
// Root/named entries are written by NbtIo; write() emits only the payload:
//   repeat { [typeId:byte] [writeUTF name] [payload] } then a TAG_End (0) byte.
import { Tag, type DataInput, type DataOutput, type TagVisitor } from './Tag.js';
import {
  registerTagType, requireType, TAG_COMPOUND, MAX_DEPTH, type TagType,
} from './TagTypes.js';
import { ByteTag } from './ByteTag.js';
import { ShortTag } from './ShortTag.js';
import { IntTag } from './IntTag.js';
import { LongTag } from './LongTag.js';
import { FloatTag } from './FloatTag.js';
import { DoubleTag } from './DoubleTag.js';
import { StringTag } from './StringTag.js';
import { ByteArrayTag, type ByteArrayLike } from './ByteArrayTag.js';
import { IntArrayTag } from './IntArrayTag.js';
import { LongArrayTag } from './LongArrayTag.js';
import { ListTag } from './ListTag.js';

export class CompoundTag extends Tag {
  readonly tags: Map<string, Tag>;
  constructor(tags?: Map<string, Tag> | Record<string, Tag>) {
    super();
    if (tags instanceof Map) this.tags = new Map(tags);
    else if (tags) this.tags = new Map(Object.entries(tags));
    else this.tags = new Map();
  }

  getId(): number { return TAG_COMPOUND; }
  getType(): TagType { return CompoundTag.TYPE; }

  write(out: DataOutput): void {
    for (const [name, tag] of this.tags) {
      out.writeByte(tag.getId());
      if (tag.getId() !== 0) {
        out.writeUTF(name);
        tag.write(out);
      }
    }
    out.writeByte(0);
  }

  copy(): CompoundTag {
    const m = new Map<string, Tag>();
    for (const [k, v] of this.tags) m.set(k, v.copy());
    return new CompoundTag(m);
  }

  equals(other: Tag): boolean {
    if (!(other instanceof CompoundTag) || other.tags.size !== this.tags.size) return false;
    for (const [k, v] of this.tags) {
      const ov = other.tags.get(k);
      if (!ov || !v.equals(ov)) return false;
    }
    return true;
  }

  accept(visitor: TagVisitor): void { visitor.visitCompound(this); }

  // ---- map-like API --------------------------------------------------------
  size(): number { return this.tags.size; }
  isEmpty(): boolean { return this.tags.size === 0; }
  keySet(): string[] { return [...this.tags.keys()]; }
  values(): Tag[] { return [...this.tags.values()]; }
  entrySet(): [string, Tag][] { return [...this.tags.entries()]; }
  contains(name: string): boolean { return this.tags.has(name); }
  get(name: string): Tag | undefined { return this.tags.get(name); }
  put(name: string, tag: Tag): Tag | undefined { const prev = this.tags.get(name); this.tags.set(name, tag); return prev; }
  remove(name: string): Tag | undefined { const prev = this.tags.get(name); this.tags.delete(name); return prev; }
  merge(other: CompoundTag): this {
    for (const [k, v] of other.tags) {
      const self = this.tags.get(k);
      if (self instanceof CompoundTag && v instanceof CompoundTag) self.merge(v);
      else this.tags.set(k, v.copy());
    }
    return this;
  }

  // ---- typed putters (vanilla CompoundTag.putXxx) -------------------------
  putByte(name: string, v: number | boolean): void { this.tags.set(name, ByteTag.of(v)); }
  putShort(name: string, v: number): void { this.tags.set(name, ShortTag.of(v)); }
  putInt(name: string, v: number): void { this.tags.set(name, IntTag.of(v)); }
  putLong(name: string, v: bigint | number): void { this.tags.set(name, LongTag.of(v)); }
  putFloat(name: string, v: number): void { this.tags.set(name, FloatTag.of(v)); }
  putDouble(name: string, v: number): void { this.tags.set(name, DoubleTag.of(v)); }
  putString(name: string, v: string): void { this.tags.set(name, StringTag.of(v)); }
  putByteArray(name: string, v: ByteArrayLike): void { this.tags.set(name, new ByteArrayTag(v)); }
  putIntArray(name: string, v: Int32Array | number[]): void { this.tags.set(name, new IntArrayTag(v)); }
  putLongArray(name: string, v: bigint[] | number[]): void { this.tags.set(name, new LongArrayTag(v)); }
  putBoolean(name: string, v: boolean): void { this.putByte(name, v); }

  // ---- typed getters -------------------------------------------------------
  getByte(name: string): number | undefined { const t = this.get(name); return t instanceof ByteTag ? t.value : undefined; }
  getByteOr(name: string, d: number): number { return this.getByte(name) ?? d; }
  getShort(name: string): number | undefined { const t = this.get(name); return t instanceof ShortTag ? t.value : undefined; }
  getShortOr(name: string, d: number): number { return this.getShort(name) ?? d; }
  getInt(name: string): number | undefined { const t = this.get(name); return t instanceof IntTag ? t.value : undefined; }
  getIntOr(name: string, d: number): number { return this.getInt(name) ?? d; }
  getLong(name: string): bigint | undefined { const t = this.get(name); return t instanceof LongTag ? t.value : undefined; }
  getLongOr(name: string, d: bigint | number): bigint { return this.getLong(name) ?? BigInt(d); }
  getFloat(name: string): number | undefined { const t = this.get(name); return t instanceof FloatTag ? t.value : undefined; }
  getFloatOr(name: string, d: number): number { return this.getFloat(name) ?? d; }
  getDouble(name: string): number | undefined { const t = this.get(name); return t instanceof DoubleTag ? t.value : undefined; }
  getDoubleOr(name: string, d: number): number { return this.getDouble(name) ?? d; }
  getString(name: string): string | undefined { const t = this.get(name); return t instanceof StringTag ? t.value : undefined; }
  getStringOr(name: string, d: string): string { return this.getString(name) ?? d; }
  getBoolean(name: string): boolean | undefined { const b = this.getByte(name); return b === undefined ? undefined : b !== 0; }
  getBooleanOr(name: string, d: boolean): boolean { return this.getBoolean(name) ?? d; }
  getByteArray(name: string): Uint8Array | undefined { const t = this.get(name); return t instanceof ByteArrayTag ? t.value : undefined; }
  getIntArray(name: string): Int32Array | undefined { const t = this.get(name); return t instanceof IntArrayTag ? t.value : undefined; }
  getLongArray(name: string): bigint[] | undefined { const t = this.get(name); return t instanceof LongArrayTag ? t.value : undefined; }
  getCompound(name: string): CompoundTag | undefined { const t = this.get(name); return t instanceof CompoundTag ? t : undefined; }
  getCompoundOrEmpty(name: string): CompoundTag { return this.getCompound(name) ?? new CompoundTag(); }
  getList(name: string): ListTag | undefined { const t = this.get(name); return t instanceof ListTag ? t : undefined; }
  getListOrEmpty(name: string): ListTag { return this.getList(name) ?? new ListTag(); }

  static readonly TYPE: TagType<CompoundTag> = {
    id: TAG_COMPOUND,
    load(input: DataInput, depth: number): CompoundTag {
      if (depth > MAX_DEPTH) throw new Error('NBT depth exceeds MAX_DEPTH');
      const tag = new CompoundTag();
      for (;;) {
        const typeId = input.readUnsignedByte();
        if (typeId === 0) break;
        const name = input.readUTF();
        tag.tags.set(name, requireType(typeId).load(input, depth + 1));
      }
      return tag;
    },
    skip(input: DataInput, depth: number): void { CompoundTag.TYPE.load(input, depth + 1); },
    getName: () => 'COMPOUND',
    getPrettyName: () => 'TAG_Compound',
  };
}

registerTagType(CompoundTag.TYPE);

/** Canonical alias used by the save layer's public signatures. */
export type NbtCompound = CompoundTag;
