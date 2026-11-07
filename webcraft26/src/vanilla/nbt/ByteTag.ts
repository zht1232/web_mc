// Port of net.minecraft.nbt.ByteTag (signed 8-bit). Also used for booleans (0/1).
import { Tag, type DataInput, type DataOutput, type TagVisitor } from './Tag.js';
import { registerTagType, TAG_BYTE, type TagType } from './TagTypes.js';

export class ByteTag extends Tag {
  readonly value: number;
  private constructor(value: number) {
    super();
    const u = value & 0xff;
    this.value = u >= 0x80 ? u - 0x100 : u;
  }

  getId(): number { return TAG_BYTE; }
  getType(): TagType { return ByteTag.TYPE; }
  write(out: DataOutput): void { out.writeByte(this.value); }
  copy(): ByteTag { return new ByteTag(this.value); }
  equals(other: Tag): boolean { return other instanceof ByteTag && other.value === this.value; }
  accept(visitor: TagVisitor): void { visitor.visitByte(this); }
  booleanValue(): boolean { return this.value !== 0; }
  override toString(): string { return `${this.value}b`; }

  static readonly TYPE: TagType<ByteTag> = {
    id: TAG_BYTE,
    load(input: DataInput): ByteTag { return new ByteTag(input.readByte()); },
    skip(input: DataInput): void { input.skipBytes(1); },
    getName: () => 'BYTE',
    getPrettyName: () => 'TAG_Byte',
  };

  static of(value: number | boolean): ByteTag {
    return new ByteTag(typeof value === 'boolean' ? (value ? 1 : 0) : (value | 0));
  }
  static valueOf(value: number | boolean): ByteTag { return ByteTag.of(value); }
  static readonly ZERO = new ByteTag(0);
  static readonly ONE = new ByteTag(1);
}

registerTagType(ByteTag.TYPE);
