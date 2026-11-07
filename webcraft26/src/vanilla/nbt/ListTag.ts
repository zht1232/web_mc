// Port of net.minecraft.nbt.ListTag (homogeneous list; mixed lists use the vanilla
// CompoundTag-with-empty-key wrapper so the binary format stays valid).
import { Tag, type DataInput, type DataOutput, type TagVisitor } from './Tag.js';
import {
  registerTagType, requireType, TAG_LIST, TAG_COMPOUND, MAX_DEPTH, type TagType,
} from './TagTypes.js';
import { ByteTag } from './ByteTag.js';
import { ShortTag } from './ShortTag.js';
import { IntTag } from './IntTag.js';
import { LongTag } from './LongTag.js';
import { FloatTag } from './FloatTag.js';
import { DoubleTag } from './DoubleTag.js';
import { StringTag } from './StringTag.js';
import { CompoundTag } from './CompoundTag.js';

const WRAPPER_MARKER = '';

export class ListTag extends Tag {
  readonly list: Tag[];
  constructor(list: Tag[] = []) { super(); this.list = list; }

  getId(): number { return TAG_LIST; }
  getType(): TagType { return ListTag.TYPE; }

  // ---- java.util.List-like API ---------------------------------------------
  size(): number { return this.list.length; }
  isEmpty(): boolean { return this.list.length === 0; }
  get(index: number): Tag { return this.list[index]; }
  set(index: number, tag: Tag): Tag { const prev = this.list[index]; this.list[index] = tag; return prev; }
  add(tag: Tag): boolean { this.list.push(tag); return true; }
  addAll(tags: Tag[]): boolean { for (const t of tags) this.list.push(t); return true; }
  remove(index: number): Tag { return this.list.splice(index, 1)[0]; }
  clear(): void { this.list.length = 0; }
  [Symbol.iterator](): IterableIterator<Tag> { return this.list[Symbol.iterator](); }

  addByte(v: number | boolean): void { this.list.push(ByteTag.of(v)); }
  addShort(v: number): void { this.list.push(ShortTag.of(v)); }
  addInt(v: number): void { this.list.push(IntTag.of(v)); }
  addLong(v: bigint | number): void { this.list.push(LongTag.of(v)); }
  addFloat(v: number): void { this.list.push(FloatTag.of(v)); }
  addDouble(v: number): void { this.list.push(DoubleTag.of(v)); }
  addString(v: string): void { this.list.push(StringTag.of(v)); }

  getCompound(index: number): CompoundTag | undefined { const t = this.list[index]; return t instanceof CompoundTag ? t : undefined; }
  getString(index: number): string | undefined { const t = this.list[index]; return t instanceof StringTag ? t.value : undefined; }
  getInt(index: number): number | undefined { const t = this.list[index]; return t instanceof IntTag ? t.value : undefined; }

  copy(): ListTag { return new ListTag(this.list.map((t) => t.copy())); }
  equals(other: Tag): boolean {
    if (!(other instanceof ListTag) || other.list.length !== this.list.length) return false;
    for (let i = 0; i < this.list.length; i++) if (!this.list[i].equals(other.list[i])) return false;
    return true;
  }
  accept(visitor: TagVisitor): void { visitor.visitList(this); }

  // ---- binary format -------------------------------------------------------
  /** Vanilla ListTag.identifyRawElementType: 0 (empty), the common id, or 10 (compound wrapper). */
  identifyRawElementType(): number {
    let t = 0;
    for (const el of this.list) {
      const id = el.getId();
      if (t === 0) t = id;
      else if (t !== id) return TAG_COMPOUND;
    }
    return t;
  }

  private static isWrapper(c: CompoundTag): boolean {
    return c.size() === 1 && c.contains(WRAPPER_MARKER);
  }

  private static wrapElement(tag: Tag): CompoundTag {
    const c = new CompoundTag();
    c.put(WRAPPER_MARKER, tag);
    return c;
  }

  private static wrapIfNeeded(elementType: number, tag: Tag): Tag {
    if (elementType !== TAG_COMPOUND) return tag;
    return tag instanceof CompoundTag && !ListTag.isWrapper(tag) ? tag : ListTag.wrapElement(tag);
  }

  private static tryUnwrap(tag: Tag): Tag {
    if (tag instanceof CompoundTag && ListTag.isWrapper(tag)) return tag.tags.get(WRAPPER_MARKER) ?? tag;
    return tag;
  }

  /** Vanilla addAndUnwrap, used while loading. */
  addAndUnwrap(tag: Tag): void { this.list.push(ListTag.tryUnwrap(tag)); }

  write(out: DataOutput): void {
    const elementType = this.identifyRawElementType();
    out.writeByte(elementType);
    out.writeInt(this.list.length);
    for (const el of this.list) ListTag.wrapIfNeeded(elementType, el).write(out);
  }

  static readonly TYPE: TagType<ListTag> = {
    id: TAG_LIST,
    load(input: DataInput, depth: number): ListTag {
      if (depth > MAX_DEPTH) throw new Error('NBT depth exceeds MAX_DEPTH');
      const typeId = input.readUnsignedByte();
      const count = input.readInt();
      if (typeId === 0 && count > 0) throw new Error('Missing type on ListTag');
      if (count < 0) throw new Error('ListTag length cannot be negative');
      const list = new ListTag();
      const type = requireType(typeId);
      for (let i = 0; i < count; i++) list.addAndUnwrap(type.load(input, depth + 1));
      return list;
    },
    skip(input: DataInput, depth: number): void { ListTag.TYPE.load(input, depth + 1); },
    getName: () => 'LIST',
    getPrettyName: () => 'TAG_List',
  };
}

registerTagType(ListTag.TYPE);
