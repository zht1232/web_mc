// Port of net.minecraft.nbt.FloatTag (IEEE 754 binary32).
// The stored value is rounded with Math.fround at construction so a write->read round trip
// compares equal (Java stores an actual 32-bit float).
import { Tag, type DataInput, type DataOutput, type TagVisitor } from './Tag.js';
import { registerTagType, TAG_FLOAT, type TagType } from './TagTypes.js';

export class FloatTag extends Tag {
  readonly value: number;
  private constructor(value: number) { super(); this.value = Math.fround(value); }

  getId(): number { return TAG_FLOAT; }
  getType(): TagType { return FloatTag.TYPE; }
  write(out: DataOutput): void { out.writeFloat(this.value); }
  copy(): FloatTag { return new FloatTag(this.value); }
  equals(other: Tag): boolean { return other instanceof FloatTag && other.value === this.value; }
  accept(visitor: TagVisitor): void { visitor.visitFloat(this); }
  override toString(): string {
    let s = `${this.value}`;
    if (!s.includes('.') && !s.includes('e') && !s.includes('E') && !s.includes('NaN') && !s.includes('Infinity')) s += '.0';
    return `${s}f`;
  }

  static readonly TYPE: TagType<FloatTag> = {
    id: TAG_FLOAT,
    load(input: DataInput): FloatTag { return new FloatTag(input.readFloat()); },
    skip(input: DataInput): void { input.skipBytes(4); },
    getName: () => 'FLOAT',
    getPrettyName: () => 'TAG_Float',
  };

  static of(value: number): FloatTag { return new FloatTag(value); }
  static valueOf(value: number): FloatTag { return FloatTag.of(value); }
}

registerTagType(FloatTag.TYPE);
