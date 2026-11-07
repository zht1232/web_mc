// Compression abstraction for NbtIo (gzip, level.dat) and RegionFile (zlib/deflate payloads).
//
// Browser path: the global CompressionStream('gzip'|'deflate') / DecompressionStream('gzip'|'deflate')
// web streams (async, no dependencies).
// Node path: an injectable synchronous zlib codec (registered by the test harness via
// setCompressionCodec) so the exact same byte formats round trip under tsx. Both produce
// identical gzip / zlib-wrapped deflate streams, so a world saved in one can be read in the other.
//
// This module has NO top-level access to window / indexedDB / node builtins: it only reads the
// CompressionStream globals inside functions and accepts an injected codec.

export interface CompressionCodec {
  gzip(data: Uint8Array): Uint8Array | Promise<Uint8Array>;
  gunzip(data: Uint8Array): Uint8Array | Promise<Uint8Array>;
  deflate(data: Uint8Array): Uint8Array | Promise<Uint8Array>;
  inflate(data: Uint8Array): Uint8Array | Promise<Uint8Array>;
}

let injected: CompressionCodec | null = null;

/** Install a codec (e.g. Node zlib). Pass null to restore the browser default. */
export function setCompressionCodec(codec: CompressionCodec | null): void {
  injected = codec;
}

export function getCompressionCodec(): CompressionCodec | null {
  return injected;
}

type Format = 'gzip' | 'deflate';

async function webStream(
  data: Uint8Array,
  format: Format,
  decompress: boolean,
): Promise<Uint8Array> {
  if (typeof CompressionStream === 'undefined' || typeof DecompressionStream === 'undefined') {
    throw new Error('CompressionStream is unavailable and no CompressionCodec was injected');
  }
  const stream = (decompress ? new DecompressionStream(format) : new CompressionStream(format)) as {
    readable: ReadableStream<Uint8Array>;
    writable: WritableStream<Uint8Array>;
  };
  const reader = stream.readable.getReader();
  const chunks: Uint8Array[] = [];
  const draining = (async () => {
    for (;;) {
      const { done, value } = await reader.read();
      if (done) break;
      if (value) chunks.push(value);
    }
  })();
  const writer = stream.writable.getWriter();
  await writer.write(data);
  await writer.close();
  await draining;
  let total = 0;
  for (const c of chunks) total += c.length;
  const out = new Uint8Array(total);
  let o = 0;
  for (const c of chunks) { out.set(c, o); o += c.length; }
  return out;
}

export async function gzip(data: Uint8Array): Promise<Uint8Array> {
  return injected ? injected.gzip(data) : webStream(data, 'gzip', false);
}
export async function gunzip(data: Uint8Array): Promise<Uint8Array> {
  return injected ? injected.gunzip(data) : webStream(data, 'gzip', true);
}
export async function deflate(data: Uint8Array): Promise<Uint8Array> {
  return injected ? injected.deflate(data) : webStream(data, 'deflate', false);
}
export async function inflate(data: Uint8Array): Promise<Uint8Array> {
  return injected ? injected.inflate(data) : webStream(data, 'deflate', true);
}

export function isGzip(data: Uint8Array): boolean {
  return data.length >= 2 && data[0] === 0x1f && data[1] === 0x8b;
}
