// Port of net.minecraft.nbt.StringTag.
//
// On disk NBT strings use java.io.DataOutput.writeUTF: "modified UTF-8" (CESU-8). Differences
// from standard UTF-8 that matter here:
//   * U+0000 is encoded as 0xC0 0x80 (never a raw 0x00 byte).
//   * supplementary code points (> U+FFFF) are encoded as two 3-byte surrogate code units,
//     NOT as one 4-byte sequence.
// The 2-byte big-endian length prefix counts ENCODED BYTES, not characters.
//
// encodeModifiedUtf8 / decodeModifiedUtf8 are shared with NbtIo's DataOutput/DataInput.
import { Tag, type DataInput, type DataOutput, type TagVisitor } from './Tag.js';
import { registerTagType, TAG_STRING, type TagType } from './TagTypes.js';

/** Java modified UTF-8 (CESU-8) encoder. Returns the encoded bytes (without length prefix). */
export function encodeModifiedUtf8(s: string): Uint8Array {
  const out: number[] = [];
  for (let i = 0; i < s.length; i++) {
    const c = s.charCodeAt(i);
    if (c >= 0x0001 && c <= 0x007f) {
      out.push(c);
    } else if (c <= 0x07ff) {
      // covers U+0000 (0xC0 0x80) and U+0080..U+07FF
      out.push(0xc0 | (c >> 6), 0x80 | (c & 0x3f));
    } else {
      // U+0800..U+FFFF, including UTF-16 surrogate code units (CESU-8)
      out.push(0xe0 | (c >> 12), 0x80 | ((c >> 6) & 0x3f), 0x80 | (c & 0x3f));
    }
  }
  if (out.length > 0xffff) throw new Error(`NBT string too long after modified UTF-8 encoding: ${out.length} bytes`);
  return Uint8Array.from(out);
}

/** Java modified UTF-8 decoder for exactly `len` bytes starting at `offset`. */
export function decodeModifiedUtf8(bytes: Uint8Array, offset = 0, len = bytes.length - offset): string {
  const end = offset + len;
  let result = '';
  let i = offset;
  while (i < end) {
    const b = bytes[i++];
    if (b < 0x80) {
      result += String.fromCharCode(b);
    } else if ((b & 0xe0) === 0xc0) {
      if (i >= end) throw new Error('Truncated modified UTF-8 (2-byte)');
      const b1 = bytes[i++];
      if ((b1 & 0xc0) !== 0x80) throw new Error('Malformed modified UTF-8 (2-byte)');
      result += String.fromCharCode(((b & 0x1f) << 6) | (b1 & 0x3f));
    } else if ((b & 0xf0) === 0xe0) {
      if (i + 1 >= end) throw new Error('Truncated modified UTF-8 (3-byte)');
      const b1 = bytes[i++];
      const b2 = bytes[i++];
      if ((b1 & 0xc0) !== 0x80 || (b2 & 0xc0) !== 0x80) throw new Error('Malformed modified UTF-8 (3-byte)');
      result += String.fromCharCode(((b & 0x0f) << 12) | ((b1 & 0x3f) << 6) | (b2 & 0x3f));
    } else {
      throw new Error(`Malformed modified UTF-8 lead byte 0x${b.toString(16)}`);
    }
  }
  return result;
}

export class StringTag extends Tag {
  readonly value: string;
  private constructor(value: string) { super(); this.value = value; }

  getId(): number { return TAG_STRING; }
  getType(): TagType { return StringTag.TYPE; }
  write(out: DataOutput): void { out.writeUTF(this.value); }
  copy(): StringTag { return this; } // immutable
  equals(other: Tag): boolean { return other instanceof StringTag && other.value === this.value; }
  accept(visitor: TagVisitor): void { visitor.visitString(this); }
  getAsString(): string { return this.value; }

  static readonly TYPE: TagType<StringTag> = {
    id: TAG_STRING,
    load(input: DataInput): StringTag { return StringTag.valueOf(input.readUTF()); },
    skip(input: DataInput): void {
      const len = (input.readUnsignedByte() << 8) | input.readUnsignedByte();
      input.skipBytes(len);
    },
    getName: () => 'STRING',
    getPrettyName: () => 'TAG_String',
  };

  static readonly EMPTY = new StringTag('');
  static of(value: string): StringTag { return value.length === 0 ? StringTag.EMPTY : new StringTag(value); }
  static valueOf(value: string): StringTag { return StringTag.of(value); }

  /** Vanilla StringTag.quoteAndEscape: choose the quote that needs fewer escapes. */
  static quoteAndEscape(input: string): string {
    let quote = '"';
    if (input.includes('"') && !input.includes("'")) quote = "'";
    let out = quote;
    for (let i = 0; i < input.length; i++) {
      const c = input[i];
      if (c === '\\') out += '\\\\';
      else if (c === quote) out += `\\${c}`;
      else if (c === '\n') out += '\\n';
      else if (c === '\r') out += '\\r';
      else if (c === '\t') out += '\\t';
      else if (c === '\b') out += '\\b';
      else if (c === '\f') out += '\\f';
      else if (c < ' ') out += `\\u${c.charCodeAt(0).toString(16).padStart(4, '0')}`;
      else out += c;
    }
    return out + quote;
  }

  override toString(): string { return StringTag.quoteAndEscape(this.value); }
}

registerTagType(StringTag.TYPE);
