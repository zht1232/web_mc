// Packs and reads public/mc/states.bin: baked quads shipped as quantised typed arrays.
// 67k quads as JSON objects would cost the browser a hundred-plus MB of graph.

export const BIN_MAGIC = 0x57435331; // "WCS1"
export const BIN_VERSION = 1;
export const POS_SCALE = 1024; // block space is [-1, 2]
export const UV_SCALE = 256;   // texel space is [0, 16]
export const MODEL_STRIDE = 12;
export const META_STRIDE = 6;

export function q16(value, scale, what) {
  const v = Math.round(value * scale);
  if (!(v >= -32768 && v <= 32767)) throw new Error(`quantised ${what} out of int16 range: ${value} -> ${v}`);
  return v;
}

export function packModels(models, textures, texIndex) {
  let quadCount = 0;
  for (const m of models) quadCount += m.quads.length;
  const texTableBytes = textures.reduce((n, t) => {
    const len = Buffer.byteLength(t, 'utf8');
    if (len > 65535) throw new Error('texture name too long: ' + t);
    return n + 2 + len;
  }, 0);
  const size = 20 + models.length * MODEL_STRIDE
    + quadCount * 12 * 2 + quadCount * 8 * 2 + quadCount * META_STRIDE + quadCount * 2
    + texTableBytes;
  const buf = Buffer.alloc(size);
  const view = new DataView(buf.buffer, buf.byteOffset, size);
  let o = 0;
  view.setUint32(o, BIN_MAGIC, true); o += 4;
  view.setUint32(o, BIN_VERSION, true); o += 4;
  view.setUint32(o, models.length, true); o += 4;
  view.setUint32(o, quadCount, true); o += 4;
  view.setUint32(o, textures.length, true); o += 4;

  const modelTableEnd = o + models.length * MODEL_STRIDE;
  const posAt = modelTableEnd;
  const uvAt = posAt + quadCount * 24;
  const metaAt = uvAt + quadCount * 16;
  const texAt = metaAt + quadCount * META_STRIDE;
  const namesAt = texAt + quadCount * 2;

  let p = posAt, u = uvAt, me = metaAt, te = texAt;
  models.forEach((m, i) => {
    view.setUint32(o, (p - posAt) / 24, true);
    view.setUint16(o + 4, m.quads.length, true);
    view.setUint8(o + 6, m.ao ? 1 : 0);
    view.setUint8(o + 7, m.guiLight === 'front' ? 1 : 0);
    view.setUint8(o + 8, m.noGeometry ? 1 : 0);
    o += MODEL_STRIDE;
    for (const q of m.quads) {
      for (const v of q.p) view.setInt16(p, q16(v, POS_SCALE, 'position'), true), p += 2;
      for (const v of q.uv) view.setInt16(u, q16(v, UV_SCALE, 'uv'), true), u += 2;
      view.setUint8(me, q.d);
      view.setUint8(me + 1, q.c + 1);
      view.setUint8(me + 2, q.ti + 1);
      view.setUint8(me + 3, q.le);
      view.setUint8(me + 4, q.s ? 1 : 0);
      view.setUint8(me + 5, q.tr ? 1 : 0);
      me += META_STRIDE;
      const ti = texIndex.get(q.t);
      if (ti === undefined) throw new Error('texture not interned: ' + q.t);
      view.setUint16(te, ti, true);
      te += 2;
    }
  });

  let no = namesAt;
  for (const t of textures) {
    const len = Buffer.byteLength(t, 'utf8');
    view.setUint16(no, len, true);
    no += 2;
    no += buf.write(t, no, 'utf8');
  }
  if (no !== size) throw new Error(`packed size drift: wrote ${no}, allocated ${size}`);
  return { buffer: buf, quadCount };
}

export function decodeStates(buffer, textures) {
  const view = new DataView(buffer.buffer, buffer.byteOffset, buffer.byteLength);
  if (view.getUint32(0, true) !== BIN_MAGIC) throw new Error('bad states.bin magic');
  const version = view.getUint32(4, true);
  if (version !== BIN_VERSION) throw new Error('states.bin version ' + version);
  const modelCount = view.getUint32(8, true);
  const quadCount = view.getUint32(12, true);
  const texCount = view.getUint32(16, true);
  if (texCount !== textures.length) throw new Error(`texture table mismatch: ${texCount} vs ${textures.length}`);
  const table = 20;
  const posAt = table + modelCount * MODEL_STRIDE;
  const uvAt = posAt + quadCount * 24;
  const metaAt = uvAt + quadCount * 16;
  const texAt = metaAt + quadCount * META_STRIDE;
  return {
    modelCount, quadCount,
    model(i) {
      const q0 = view.getUint32(table + i * MODEL_STRIDE, true);
      const n = view.getUint16(table + i * MODEL_STRIDE + 4, true);
      const flags = [view.getUint8(table + i * MODEL_STRIDE + 6), view.getUint8(table + i * MODEL_STRIDE + 7), view.getUint8(table + i * MODEL_STRIDE + 8)];
      const quads = [];
      for (let k = 0; k < n; k++) {
        const pos = [];
        for (let c = 0; c < 12; c++) pos.push(view.getInt16(posAt + (q0 + k) * 24 + c * 2, true) / POS_SCALE);
        const uv = [];
        for (let c = 0; c < 8; c++) uv.push(view.getInt16(uvAt + (q0 + k) * 16 + c * 2, true) / UV_SCALE);
        const m = metaAt + (q0 + k) * META_STRIDE;
        quads.push({
          p: pos, uv,
          d: view.getUint8(m), c: view.getUint8(m + 1) - 1, ti: view.getUint8(m + 2) - 1,
          le: view.getUint8(m + 3), s: view.getUint8(m + 4) === 1, tr: view.getUint8(m + 5) === 1,
          t: textures[view.getUint16(texAt + (q0 + k) * 2, true)],
        });
      }
      return { quads, ao: flags[0] === 1, guiLight: flags[1] === 1 ? 'front' : 'side', noGeometry: flags[2] === 1 };
    },
  };
}
