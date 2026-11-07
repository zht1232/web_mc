// Port of net.minecraft.nbt.IntArrayTag (signed 32-bit array).
import { Tag, type DataInput, type DataOutput, type TagVisitor } from './Tag.js';
import { registerTagType, TAG_INT_ARRAY, type TagType } from './TagTypes.js';

export class IntArrayTag extends Tag {
  readonly value: Int32Array;
  constructor(value: Int32Array | number[]) {
    super();
    this.value = value instanceof Int32Array ? value.slice() : Int32Array.from(value, (v) => v | 0);
  }

  getId(): number { return TAG_INT_ARRAY; }
  getType(): TagType { return IntArrayTag.TYPE; }
  write(out: DataOutput): void {
    out.writeInt(this.value.length);
    for (let i = 0; i < this.value.length; i++) out.writeInt(this.value[i]);
  }
  copy(): IntArrayTag { return new IntArrayTag(this.value); }
  equals(other: Tag): boolean {
    if (!(other instanceof IntArrayTag) || other.value.length !== this.value.length) return false;
    for (let i = 0; i < this.value.length; i++) if (other.value[i] !== this.value[i]) return false;
    return true;
  }
  accept(visitor: TagVisitor): void { visitor.visitIntArray(this); }
  getAsIntArray(): Int32Array { return this.value; }
  size(): number { return this.value.length; }
  override toString(): string { return `[I;${Array.from(this.value).join(',')}]`; }

  static readonly TYPE: TagType<IntArrayTag> = {
    id: TAG_INT_ARRAY,
    load(input: DataInput): IntArrayTag {
      const n = input.readInt();
      if (n < 0) throw new Error('Negative IntArrayTag length');
      const arr = new Int32Array(n);
      for (let i = 0; i < n; i++) arr[i] = input.readInt();
      return new IntArrayTag(arr);
    },
    skip(input: DataInput): void { input.skipBytes(input.readInt() * 4); },
    getName: () => 'INT[]',
    getPrettyName: () => 'TAG_Int_Array',
  };

  static of(value: Int32Array | number[]): IntArrayTag { return new IntArrayTag(value); }
}

registerTagType(IntArrayTag.TYPE);
