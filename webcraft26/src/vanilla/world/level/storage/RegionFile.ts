// In-memory port of net.minecraft.world.level.chunk.storage.RegionFile (.mca).
//
// Layout (identical to vanilla):
//   sector 0 (4096 B) : 1024 big-endian int offsets  = (sectorNumber << 8) | numSectors
//   sector 1 (4096 B) : 1024 big-endian int timestamps
//   sector >=2        : [4-byte length][1-byte compression id][zlib payload][zero padding]
// Chunk payloads are zlib-compressed (RegionFileVersion.VERSION_DEFLATE = 2, the 26.2 default).
// Sector allocation uses a used-sector bitmap; exported bytes are always 4096-aligned, so the
// result is a structurally valid .mca a real Minecraft region loader can read.

import { deflate, inflate } from '../../../nbt/NbtCompression.js';

export const SECTOR_BYTES = 4096;
export const SECTOR_INTS = 1024;
export const CHUNK_HEADER_SIZE = 5;
/** RegionFileVersion ids. */
export const VERSION_GZIP = 1;
export const VERSION_DEFLATE = 2; // DEFAULT in 26.2
export const VERSION_NONE = 3;
export const VERSION_LZ4 = 4;
export const EXTERNAL_STREAM_FLAG = 128;

function readInt32(buf: Uint8Array, off: number): number {
  return (buf[off] << 24) | (buf[off + 1] << 16) | (buf[off + 2] << 8) | buf[off + 3];
}
function writeInt32(buf: Uint8Array, off: number, v: number): void {
  buf[off] = (v >>> 24) & 0xff;
  buf[off + 1] = (v >>> 16) & 0xff;
  buf[off + 2] = (v >>> 8) & 0xff;
  buf[off + 3] = v & 0xff;
}

function offsetIndex(cx: number, cz: number): number {
  return (cx & 31) + (cz & 31) * 32;
}

export interface SectorRange { start: number; count: number; }

export class RegionFile {
  private offsets = new Int32Array(SECTOR_INTS);
  private timestamps = new Int32Array(SECTOR_INTS);
  private file: Uint8Array;
  private used: boolean[];
  private sectorCount = 2; // sectors 0 and 1 are the header
  private closed = false;

  constructor() {
    this.file = new Uint8Array(SECTOR_BYTES * 2);
    this.used = [true, true];
  }

  /** Parses an existing .mca (e.g. an exported region or a downloaded file). */
  static fromBytes(data: Uint8Array): RegionFile {
    const rf = new RegionFile();
    const count = Math.max(2, Math.ceil(data.length / SECTOR_BYTES));
    rf.sectorCount = count;
    rf.file = new Uint8Array(count * SECTOR_BYTES);
    rf.file.set(data.subarray(0, Math.min(data.length, rf.file.length)));
    rf.used = new Array<boolean>(count).fill(false);
    rf.used[0] = true;
    rf.used[1] = true;
    if (data.length >= SECTOR_BYTES * 2) {
      for (let i = 0; i < SECTOR_INTS; i++) {
        rf.offsets[i] = readInt32(data, i * 4);
        rf.timestamps[i] = readInt32(data, SECTOR_BYTES + i * 4);
      }
    }
    for (let i = 0; i < SECTOR_INTS; i++) {
      const off = rf.offsets[i];
      if (off === 0) continue;
      const start = off >>> 8; // getSectorNumber
      const num = off & 0xff; // getNumSectors
      for (let s = start; s < start + num && s < rf.sectorCount; s++) rf.used[s] = true;
    }
    return rf;
  }

  private grow(addSectors: number): void {
    const next = new Uint8Array((this.sectorCount + addSectors) * SECTOR_BYTES);
    next.set(this.file);
    this.file = next;
    for (let i = 0; i < addSectors; i++) this.used.push(false);
    this.sectorCount += addSectors;
  }

  /** Vanilla RegionBitmap.allocate: first run of `count` contiguous free sectors (>= 2). */
  private allocate(count: number): number {
    let start = 2;
    for (;;) {
      if (start + count > this.sectorCount) {
        this.grow(Math.max(count, this.sectorCount));
      }
      let ok = true;
      for (let i = 0; i < count; i++) {
        if (this.used[start + i]) { ok = false; break; }
      }
      if (ok) {
        for (let i = 0; i < count; i++) this.used[start + i] = true;
        return start;
      }
      start++;
    }
  }

  private free(start: number, count: number): void {
    for (let i = 0; i < count; i++) this.used[start + i] = false;
  }

  private static timestamp(): number {
    return Math.floor(Date.now() / 1000) | 0;
  }

  hasChunk(cx: number, cz: number): boolean {
    return this.offsets[offsetIndex(cx, cz)] !== 0;
  }

  /** Writes a chunk: compresses `bytes` with zlib and stores it in freshly allocated sectors. */
  async write(cx: number, cz: number, bytes: Uint8Array): Promise<void> {
    if (this.closed) throw new Error('RegionFile is closed');
    const idx = offsetIndex(cx, cz);
    const payload = await deflate(bytes);
    const needed = CHUNK_HEADER_SIZE + payload.length; // 4-byte length + 1-byte version + payload
    const sectorsNeeded = Math.ceil(needed / SECTOR_BYTES);
    if (sectorsNeeded > 255) throw new Error(`chunk too large for a single region (${sectorsNeeded} sectors)`);

    const old = this.offsets[idx];
    const start = this.allocate(sectorsNeeded);

    const sectorData = new Uint8Array(sectorsNeeded * SECTOR_BYTES);
    writeInt32(sectorData, 0, payload.length + 1); // length counts version byte + payload
    sectorData[4] = VERSION_DEFLATE;
    sectorData.set(payload, CHUNK_HEADER_SIZE);
    this.file.set(sectorData, start * SECTOR_BYTES);

    this.offsets[idx] = (start << 8) | sectorsNeeded;
    this.timestamps[idx] = RegionFile.timestamp();

    if (old !== 0) this.free(old >>> 8, old & 0xff);
  }

  /** Reads a chunk back, inflating the zlib payload. Returns null when absent. */
  async read(cx: number, cz: number): Promise<Uint8Array | null> {
    const off = this.offsets[offsetIndex(cx, cz)];
    if (off === 0) return null;
    const start = off >>> 8;
    const num = off & 0xff;
    const base = start * SECTOR_BYTES;
    if (base + CHUNK_HEADER_SIZE > this.file.length) return null;
    const length = readInt32(this.file, base);
    if (length === 0) return null;
    const version = this.file[base + 4];
    if ((version & EXTERNAL_STREAM_FLAG) !== 0) return null; // external .mcc not supported in memory
    const streamLength = length - 1;
    if (streamLength < 0 || base + CHUNK_HEADER_SIZE + streamLength > this.file.length) return null;
    const payload = this.file.subarray(base + CHUNK_HEADER_SIZE, base + CHUNK_HEADER_SIZE + streamLength);
    return inflate(payload);
  }

  /** Reads every present chunk as [regionLocalX, regionLocalZ, bytes] (for imports). */
  async readAll(): Promise<[number, number, Uint8Array][]> {
    const out: [number, number, Uint8Array][] = [];
    for (let i = 0; i < SECTOR_INTS; i++) {
      if (this.offsets[i] === 0) continue;
      const cx = i & 31;
      const cz = i >> 5;
      const bytes = await this.read(cx, cz);
      if (bytes) out.push([cx, cz, bytes]);
    }
    return out;
  }

  /** Allocated sector ranges, exposed for structural verification (no overlap). */
  sectorRanges(): SectorRange[] {
    const out: SectorRange[] = [];
    for (let i = 0; i < SECTOR_INTS; i++) {
      const off = this.offsets[i];
      if (off !== 0) out.push({ start: off >>> 8, count: off & 0xff });
    }
    return out;
  }

  /** Vanilla close(): pad the file to a full sector. Already aligned by construction. */
  close(): void {
    this.closed = true;
  }

  /** Exports the full .mca as a 4096-aligned Uint8Array with a freshly written header. */
  toUint8Array(): Uint8Array {
    const out = new Uint8Array(this.file.length);
    out.set(this.file);
    for (let i = 0; i < SECTOR_INTS; i++) {
      writeInt32(out, i * 4, this.offsets[i]);
      writeInt32(out, SECTOR_BYTES + i * 4, this.timestamps[i]);
    }
    return out;
  }

  get byteLength(): number { return this.file.length; }
}
