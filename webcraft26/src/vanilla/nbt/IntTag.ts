// Port of net.minecraft.nbt.IntTag (signed 32-bit).
import { Tag, type DataInput, type DataOutput, type TagVisitor } from './Tag.js';
import { registerTagType, TAG_INT, type TagType } from './TagTypes.js';

export class IntTag extends Tag {
  readonly value: number;
  private constructor(value: number) { super(); this.value = value | 0; }

  getId(): number { return TAG_INT; }
  getType(): TagType { return IntTag.TYPE; }
  write(out: DataOutput): void { out.writeInt(this.value); }
  copy(): IntTag { return new IntTag(this.value); }
  equals(other: Tag): boolean { return other instanceof IntTag && other.value === this.value; }
  accept(visitor: TagVisitor): void { visitor.visitInt(this); }
  override toString(): string { return `${this.value}`; }

  static readonly TYPE: TagType<IntTag> = {
    id: TAG_INT,
    load(input: DataInput): IntTag { return new IntTag(input.readInt()); },
    skip(input: DataInput): void { input.skipBytes(4); },
    getName: () => 'INT',
    getPrettyName: () => 'TAG_Int',
  };

  static of(value: number): IntTag { return new IntTag(value | 0); }
  static valueOf(value: number): IntTag { return IntTag.of(value); }
  static readonly ZERO = new IntTag(0);
}

registerTagType(IntTag.TYPE);
