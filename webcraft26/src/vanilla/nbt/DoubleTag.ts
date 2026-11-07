// Port of net.minecraft.nbt.DoubleTag (IEEE 754 binary64).
import { Tag, type DataInput, type DataOutput, type TagVisitor } from './Tag.js';
import { registerTagType, TAG_DOUBLE, type TagType } from './TagTypes.js';

export class DoubleTag extends Tag {
  readonly value: number;
  private constructor(value: number) { super(); this.value = value; }

  getId(): number { return TAG_DOUBLE; }
  getType(): TagType { return DoubleTag.TYPE; }
  write(out: DataOutput): void { out.writeDouble(this.value); }
  copy(): DoubleTag { return new DoubleTag(this.value); }
  equals(other: Tag): boolean { return other instanceof DoubleTag && other.value === this.value; }
  accept(visitor: TagVisitor): void { visitor.visitDouble(this); }
  override toString(): string {
    let s = `${this.value}`;
    if (!s.includes('.') && !s.includes('e') && !s.includes('E') && !s.includes('NaN') && !s.includes('Infinity')) s += '.0';
    return `${s}d`;
  }

  static readonly TYPE: TagType<DoubleTag> = {
    id: TAG_DOUBLE,
    load(input: DataInput): DoubleTag { return new DoubleTag(input.readDouble()); },
    skip(input: DataInput): void { input.skipBytes(8); },
    getName: () => 'DOUBLE',
    getPrettyName: () => 'TAG_Double',
  };

  static of(value: number): DoubleTag { return new DoubleTag(value); }
  static valueOf(value: number): DoubleTag { return DoubleTag.of(value); }
}

registerTagType(DoubleTag.TYPE);
