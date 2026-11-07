// Port of net.minecraft.nbt.ByteArrayTag.
// Java stores a signed byte[]; we keep an unsigned Uint8Array (bit-identical on disk, and much
// more convenient for light arrays / block light data which are nibble packed 0..255).
import { Tag, type DataInput, type DataOutput, type TagVisitor } from './Tag.js';
import { registerTagType, TAG_BYTE_ARRAY, type TagType } from './TagTypes.js';

export type ByteArrayLike = Uint8Array | Int8Array | number[];

export class ByteArrayTag extends Tag {
  readonly value: Uint8Array;
  constructor(value: ByteArrayLike) {
    super();
    if (value instanceof Uint8Array) this.value = value.slice();
    else if (value instanceof Int8Array) this.value = new Uint8Array(value.buffer.slice(value.byteOffset, value.byteOffset + value.byteLength));
    else this.value = Uint8Array.from(value, (v) => v & 0xff);
  }

  getId(): number { return TAG_BYTE_ARRAY; }
  getType(): TagType { return ByteArrayTag.TYPE; }
  write(out: DataOutput): void { out.writeInt(this.value.length); out.writeBytes(this.value); }
  copy(): ByteArrayTag { return new ByteArrayTag(this.value); }
  equals(other: Tag): boolean {
    if (!(other instanceof ByteArrayTag) || other.value.length !== this.value.length) return false;
    for (let i = 0; i < this.value.length; i++) if (other.value[i] !== this.value[i]) return false;
    return true;
  }
  accept(visitor: TagVisitor): void { visitor.visitByteArray(this); }
  getAsByteArray(): Uint8Array { return this.value; }
  size(): number { return this.value.length; }
  override toString(): string {
    const parts: string[] = [];
    for (let i = 0; i < this.value.length; i++) parts.push(`${this.value[i] << 24 >> 24}B`);
    return `[B;${parts.join(',')}]`;
  }

  static readonly TYPE: TagType<ByteArrayTag> = {
    id: TAG_BYTE_ARRAY,
    load(input: DataInput): ByteArrayTag {
      const n = input.readInt();
      if (n < 0) throw new Error('Negative ByteArrayTag length');
      return new ByteArrayTag(input.readBytes(n));
    },
    skip(input: DataInput): void { input.skipBytes(input.readInt()); },
    getName: () => 'BYTE[]',
    getPrettyName: () => 'TAG_Byte_Array',
  };

  static of(value: ByteArrayLike): ByteArrayTag { return new ByteArrayTag(value); }
}

registerTagType(ByteArrayTag.TYPE);
