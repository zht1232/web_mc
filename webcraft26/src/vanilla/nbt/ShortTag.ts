// Port of net.minecraft.nbt.ShortTag (signed 16-bit).
import { Tag, type DataInput, type DataOutput, type TagVisitor } from './Tag.js';
import { registerTagType, TAG_SHORT, type TagType } from './TagTypes.js';

export class ShortTag extends Tag {
  readonly value: number;
  private constructor(value: number) { super(); this.value = (value << 16) >> 16; }

  getId(): number { return TAG_SHORT; }
  getType(): TagType { return ShortTag.TYPE; }
  write(out: DataOutput): void { out.writeShort(this.value); }
  copy(): ShortTag { return new ShortTag(this.value); }
  equals(other: Tag): boolean { return other instanceof ShortTag && other.value === this.value; }
  accept(visitor: TagVisitor): void { visitor.visitShort(this); }
  override toString(): string { return `${this.value}s`; }

  static readonly TYPE: TagType<ShortTag> = {
    id: TAG_SHORT,
    load(input: DataInput): ShortTag { return new ShortTag(input.readShort()); },
    skip(input: DataInput): void { input.skipBytes(2); },
    getName: () => 'SHORT',
    getPrettyName: () => 'TAG_Short',
  };

  static of(value: number): ShortTag { return new ShortTag(value | 0); }
  static valueOf(value: number): ShortTag { return ShortTag.of(value); }
}

registerTagType(ShortTag.TYPE);
