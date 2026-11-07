// Decodes public/mc/models.bin: the baked cuboid geometry produced from the 26.2
// blockstate/model JSON by scripts/build-states.mjs (see statepack.mjs for layout).
//
// A "model" is a flat list of quads in block space. Quads are decoded once into
// typed arrays and shared by every block state that references the model.

export interface DecodedQuad {
  /** 4 vertices * (x, y, z) in block space */
  p: Float32Array;
  /** 4 vertices * (u, v) in texel space, 0..16 */
  uv: Float32Array;
  /** face normal direction 0..5 (vanilla BakedQuad.direction) */
  dir: number;
  /** cullface direction, -1 when the face has no cullface */
  cull: number;
  /** tint index, -1 when the face is not tinted */
  tint: number;
  /** block texture array layer */
  tex: number;
  /** vanilla shade flag */
  shade: boolean;
  /** element light emission (0..15) */
  lightEmission: number;
  /** force translucent (vanilla BakedQuad.MaterialFlags) */
  translucent: boolean;
}

export interface DecodedModel {
  quads: DecodedQuad[];
  ao: boolean;
  guiLight: 'front' | 'side';
  /** true for models with no cuboid geometry (chests, banners, shulkers, ...) */
  noGeometry: boolean;
}

const MAGIC = 0x57435331; // "WCS1"
const MODEL_STRIDE = 12;
const META_STRIDE = 6;
const POS_SCALE = 1024;
const UV_SCALE = 256;

export interface ModelMetaEntry {
  loc: string;
  st: { x: number; y: number; z: number; uvLock: boolean };
  ao: boolean;
  gl: 'front' | 'side';
}

export class ModelSource {
  private readonly models: (DecodedModel | undefined)[] = [];
  readonly textureNames: string[];
  readonly textureIndex = new Map<string, number>();
  readonly metaModels: ModelMetaEntry[];
  readonly noGeometry: Set<string>;

  constructor(private readonly view: DataView, textureNames: string[], metaModels: ModelMetaEntry[], noGeometry: string[]) {
    this.textureNames = textureNames;
    textureNames.forEach((n, i) => this.textureIndex.set(n, i));
    this.metaModels = metaModels;
    this.noGeometry = new Set(noGeometry);
  }

  static async load(base = '/mc'): Promise<ModelSource> {
    const [metaRes, binRes] = await Promise.all([
      fetch(`${base}/models.json`),
      fetch(`${base}/models.bin`),
    ]);
    if (!metaRes.ok || !binRes.ok) throw new Error('failed to load model data');
    const meta = await metaRes.json();
    const buf = await binRes.arrayBuffer();
    return new ModelSource(new DataView(buf), meta.textures, meta.models, meta.noGeometry ?? []);
  }

  get modelCount(): number { return this.view.getUint32(8, true); }

  getModel(index: number): DecodedModel {
    const cached = this.models[index];
    if (cached) return cached;
    const dv = this.view;
    const modelCount = dv.getUint32(8, true);
    const quadCount = dv.getUint32(12, true);
    const table = 20;
    const posAt = table + modelCount * MODEL_STRIDE;
    const uvAt = posAt + quadCount * 24;
    const metaAt = uvAt + quadCount * 16;
    const texAt = metaAt + quadCount * META_STRIDE;

    const q0 = dv.getUint32(table + index * MODEL_STRIDE, true);
    const n = dv.getUint16(table + index * MODEL_STRIDE + 4, true);
    const ao = dv.getUint8(table + index * MODEL_STRIDE + 6) === 1;
    const guiLight = dv.getUint8(table + index * MODEL_STRIDE + 7) === 1 ? 'front' : 'side';
    const noGeometry = dv.getUint8(table + index * MODEL_STRIDE + 8) === 1;

    const quads: DecodedQuad[] = new Array(n);
    for (let k = 0; k < n; k++) {
      const q = q0 + k;
      const p = new Float32Array(12);
      for (let c = 0; c < 12; c++) p[c] = dv.getInt16(posAt + q * 24 + c * 2, true) / POS_SCALE;
      const uv = new Float32Array(8);
      for (let c = 0; c < 8; c++) uv[c] = dv.getInt16(uvAt + q * 16 + c * 2, true) / UV_SCALE;
      const m = metaAt + q * META_STRIDE;
      quads[k] = {
        p,
        uv,
        dir: dv.getUint8(m),
        cull: dv.getUint8(m + 1) - 1,
        tint: dv.getUint8(m + 2) - 1,
        tex: dv.getUint16(texAt + q * 2, true),
        lightEmission: dv.getUint8(m + 3),
        shade: dv.getUint8(m + 4) === 1,
        translucent: dv.getUint8(m + 5) === 1,
      };
    }

    const model: DecodedModel = { quads, ao, guiLight, noGeometry };
    this.models[index] = model;
    return model;
  }

  /** Vanilla model location, mostly for debugging/UI. */
  modelLocation(index: number): string {
    return this.metaModels[index]?.loc ?? 'unknown';
  }
}
