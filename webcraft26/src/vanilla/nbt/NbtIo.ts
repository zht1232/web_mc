// Port of net.minecraft.nbt.NbtIo plus the java.io.DataInput/DataOutput streams it uses.
//
// Root format (NbtIo.write): [typeId:byte=10] [writeUTF("")=0x00 0x00] [compound payload].
// read()/write() are uncompressed and synchronous; readCompressed()/writeCompressed() add gzip.
// A transport-agnostic compression layer (NbtCompression.ts) keeps this module dependency-free.

import { Tag, type DataInput, type DataOutput } from './Tag.js';
import { requireType, TAG_END } from './TagTypes.js';
import { encodeModifiedUtf8, decodeModifiedUtf8 } from './StringTag.js';
import { gzip, gunzip, isGzip } from './NbtCompression.js';
import { CompoundTag } from './CompoundTag.js';
import { EndTag } from './EndTag.js';

// Side-effect imports: guarantee every tag module has called registerTagType before any read.
import './ByteTag.js';
import './ShortTag.js';
import './IntTag.js';
import './LongTag.js';
import './FloatTag.js';
import './DoubleTag.js';
import './ByteArrayTag.js';
import './ListTag.js';
import './IntArrayTag.js';
import './LongArrayTag.js';

/** Growable big-endian DataOutput. */
export class NbtWriter implements DataOutput {
  private buf: Uint8Array;
  private view: DataView;
  private pos = 0;

  constructor(initial = 256) {
    this.buf = new Uint8Array(initial);
    this.view = new DataView(this.buf.buffer);
  }

  private ensure(n: number): void {
    if (this.pos + n <= this.buf.length) return;
    let cap = this.buf.length;
    while (cap < this.pos + n) cap *= 2;
    const next = new Uint8Array(cap);
    next.set(this.buf.subarray(0, this.pos));
    this.buf = next;
    this.view = new DataView(next.buffer);
  }

  writeByte(v: number): void { this.ensure(1); this.view.setUint8(this.pos, v & 0xff); this.pos++; }
  writeShort(v: number): void { this.ensure(2); this.view.setInt16(this.pos, v, false); this.pos += 2; }
  writeInt(v: number): void { this.ensure(4); this.view.setInt32(this.pos, v, false); this.pos += 4; }
  writeLong(v: bigint): void { this.ensure(8); this.view.setBigInt64(this.pos, v, false); this.pos += 8; }
  writeFloat(v: number): void { this.ensure(4); this.view.setFloat32(this.pos, v, false); this.pos += 4; }
  writeDouble(v: number): void { this.ensure(8); this.view.setFloat64(this.pos, v, false); this.pos += 8; }
  writeBytes(bytes: Uint8Array): void { this.ensure(bytes.length); this.buf.set(bytes, this.pos); this.pos += bytes.length; }
  skipString(): void { this.writeUTF(''); }

  writeUTF(s: string): void {
    const bytes = encodeModifiedUtf8(s);
    this.ensure(2 + bytes.length);
    this.view.setUint16(this.pos, bytes.length, false);
    this.pos += 2;
    this.buf.set(bytes, this.pos);
    this.pos += bytes.length;
  }

  get position(): number { return this.pos; }
  toUint8Array(): Uint8Array { return this.buf.slice(0, this.pos); }
}

/** Big-endian DataInput over a Uint8Array. */
export class NbtReader implements DataInput {
  private readonly view: DataView;
  private pos = 0;

  constructor(private readonly bytes: Uint8Array) {
    this.view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  }

  private need(n: number): void {
    if (this.pos + n > this.bytes.length) throw new Error('Unexpected end of NBT data');
  }

  readUnsignedByte(): number { this.need(1); return this.view.getUint8(this.pos++); }
  readByte(): number { this.need(1); return this.view.getInt8(this.pos++); }
  readShort(): number { this.need(2); const v = this.view.getInt16(this.pos, false); this.pos += 2; return v; }
  readInt(): number { this.need(4); const v = this.view.getInt32(this.pos, false); this.pos += 4; return v; }
  readLong(): bigint { this.need(8); const v = this.view.getBigInt64(this.pos, false); this.pos += 8; return v; }
  readFloat(): number { this.need(4); const v = this.view.getFloat32(this.pos, false); this.pos += 4; return v; }
  readDouble(): number { this.need(8); const v = this.view.getFloat64(this.pos, false); this.pos += 8; return v; }
  readBytes(n: number): Uint8Array { this.need(n); const out = this.bytes.slice(this.pos, this.pos + n); this.pos += n; return out; }
  skipBytes(n: number): void { this.need(n); this.pos += n; }
  readUTF(): string {
    const len = (this.readUnsignedByte() << 8) | this.readUnsignedByte();
    this.need(len);
    const s = decodeModifiedUtf8(this.bytes, this.pos, len);
    this.pos += len;
    return s;
  }
  remaining(): number { return this.bytes.length - this.pos; }
  get position(): number { return this.pos; }
}

/** Reads a single root tag: [typeId][optional name][payload]. */
export function readUnnamedTag(reader: DataInput, depth = 0): Tag {
  const typeId = reader.readUnsignedByte();
  if (typeId === TAG_END) return EndTag.INSTANCE;
  reader.readUTF(); // name (empty for the root)
  return requireType(typeId).load(reader, depth + 1);
}

/** Vanilla NbtIo.read: a named compound root. */
export function read(data: Uint8Array): CompoundTag {
  const tag = readUnnamedTag(new NbtReader(data), 0);
  if (!(tag instanceof CompoundTag)) throw new Error('Root tag must be a named compound tag');
  return tag;
}

/** Vanilla NbtIo.write: uncompressed bytes of a compound root. Synchronous, no compression. */
export function write(tag: CompoundTag): Uint8Array {
  const w = new NbtWriter();
  w.writeByte(tag.getId());
  if (tag.getId() !== TAG_END) {
    w.writeUTF('');
    tag.write(w);
  }
  return w.toUint8Array();
}

/** Reads an arbitrary single tag (type id + payload, no name). */
export function readAnyTag(data: Uint8Array): Tag {
  const r = new NbtReader(data);
  const id = r.readUnsignedByte();
  return id === TAG_END ? EndTag.INSTANCE : requireType(id).load(r, 0);
}

/** Writes an arbitrary single tag (type id + payload, no name). */
export function writeAnyTag(tag: Tag): Uint8Array {
  const w = new NbtWriter();
  w.writeByte(tag.getId());
  if (tag.getId() !== TAG_END) tag.write(w);
  return w.toUint8Array();
}

// ---- compressed (gzip) variants -------------------------------------------

export async function writeCompressed(tag: CompoundTag): Promise<Uint8Array> {
  return gzip(write(tag));
}

export async function readCompressed(data: Uint8Array): Promise<CompoundTag> {
  return read(await gunzip(data));
}

/** Reads either a gzipped or an uncompressed root (useful for imports). */
export async function readAuto(data: Uint8Array): Promise<CompoundTag> {
  return isGzip(data) ? readCompressed(data) : read(data);
}
