// Port of net.minecraft.nbt.LongArrayTag (signed 64-bit array).
// BigInt[] keeps every bit; NbtIo serialises each element with DataView.setBigInt64.
import { Tag, type DataInput, type DataOutput, type TagVisitor } from './Tag.js';
import { registerTagType, TAG_LONG_ARRAY, type TagType } from './TagTypes.js';

const TWO64 = 1n << 64n;
const MAX_LONG = (1n << 63n) - 1n;

export class LongArrayTag extends Tag {
  readonly value: bigint[];
  constructor(value: bigint[] | number[]) {
    super();
    this.value = value.map((v) => {
      let x = BigInt(v) & (TWO64 - 1n);
      if (x > MAX_LONG) x -= TWO64;
      return x;
    });
  }

  getId(): number { return TAG_LONG_ARRAY; }
  getType(): TagType { return LongArrayTag.TYPE; }
  write(out: DataOutput): void {
    out.writeInt(this.value.length);
    for (let i = 0; i < this.value.length; i++) out.writeLong(this.value[i]);
  }
  copy(): LongArrayTag { return new LongArrayTag(this.value); }
  equals(other: Tag): boolean {
    if (!(other instanceof LongArrayTag) || other.value.length !== this.value.length) return false;
    for (let i = 0; i < this.value.length; i++) if (other.value[i] !== this.value[i]) return false;
    return true;
  }
  accept(visitor: TagVisitor): void { visitor.visitLongArray(this); }
  getAsLongArray(): bigint[] { return this.value; }
  size(): number { return this.value.length; }
  override toString(): string { return `[L;${this.value.map((v) => `${v}L`).join(',')}]`; }

  static readonly TYPE: TagType<LongArrayTag> = {
    id: TAG_LONG_ARRAY,
    load(input: DataInput): LongArrayTag {
      const n = input.readInt();
      if (n < 0) throw new Error('Negative LongArrayTag length');
      const arr: bigint[] = new Array(n);
      for (let i = 0; i < n; i++) arr[i] = input.readLong();
      return new LongArrayTag(arr);
    },
    skip(input: DataInput): void { input.skipBytes(input.readInt() * 8); },
    getName: () => 'LONG[]',
    getPrettyName: () => 'TAG_Long_Array',
  };

  static of(value: bigint[] | number[]): LongArrayTag { return new LongArrayTag(value); }
}

registerTagType(LongArrayTag.TYPE);
