// Port of net.minecraft.nbt.LongTag (signed 64-bit).
// Java's long is 64-bit; JS numbers lose precision above 2^53, so the value is stored as a
// BigInt. NbtIo writes it with DataView.setBigInt64 (no precision loss).
import { Tag, type DataInput, type DataOutput, type TagVisitor } from './Tag.js';
import { registerTagType, TAG_LONG, type TagType } from './TagTypes.js';

const MIN_LONG = -(1n << 63n);
const MAX_LONG = (1n << 63n) - 1n;

export class LongTag extends Tag {
  readonly value: bigint;
  private constructor(value: bigint) {
    super();
    // Normalise into signed 64-bit range (mirrors a Java long cast).
    let v = BigInt(value) & ((1n << 64n) - 1n);
    if (v > MAX_LONG) v -= 1n << 64n;
    this.value = v;
    if (this.value < MIN_LONG || this.value > MAX_LONG) throw new Error('LongTag out of 64-bit range');
  }

  getId(): number { return TAG_LONG; }
  getType(): TagType { return LongTag.TYPE; }
  write(out: DataOutput): void { out.writeLong(this.value); }
  copy(): LongTag { return new LongTag(this.value); }
  equals(other: Tag): boolean { return other instanceof LongTag && other.value === this.value; }
  accept(visitor: TagVisitor): void { visitor.visitLong(this); }
  override toString(): string { return `${this.value}L`; }

  static readonly TYPE: TagType<LongTag> = {
    id: TAG_LONG,
    load(input: DataInput): LongTag { return new LongTag(input.readLong()); },
    skip(input: DataInput): void { input.skipBytes(8); },
    getName: () => 'LONG',
    getPrettyName: () => 'TAG_Long',
  };

  static of(value: bigint | number): LongTag { return new LongTag(BigInt(value)); }
  static valueOf(value: bigint | number): LongTag { return LongTag.of(value); }
  static readonly ZERO = new LongTag(0n);
}

registerTagType(LongTag.TYPE);
