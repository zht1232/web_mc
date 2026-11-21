// Port of the Minecraft 26.2 chunk section mesher to TypeScript.
//
// Ported vanilla classes:
//   net/minecraft/client/renderer/chunk/SectionCompiler.java      (driver: per block -> fluid, then model)
//   net/minecraft/client/renderer/block/ModelBlockRenderer.java   (cullface, AO/flat dispatch, tint)
//   net/minecraft/client/renderer/block/BlockModelLighter.java    (prepareQuadAmbientOcclusion, prepareQuadFlat,
//                                                                  AdjacencyInfo, AmbientVertexRemap, SizeInfo)
//   net/minecraft/util/LightCoordsUtil.java                       (pack, block, sky, smoothBlend)
//   net/minecraft/world/level/CardinalLighting.java               (DEFAULT per-face shade multipliers)
//   net/minecraft/world/level/block/Block.java                    (shouldRenderFace)
//   net/minecraft/world/level/block/state/BlockBehaviour.java     (skipRendering, isFaceSturdy, getShadeBrightness)
//   net/minecraft/client/renderer/block/FluidRenderer.java        (tesselate, calculateAverageHeight, getHeight)
//   net/minecraft/world/level/material/FlowingFluid.java          (getHeight / getOwnHeight / getLegacyLevel)
//
// Everything is a pure function of MeshInput: no browser API, no globals, no allocation in
// the per-quad path (output buffers grow by doubling, all temporaries are scratch fields).
//
// Vertex format (24 bytes, little endian, interleaved, 4 vertices per quad):
//   offset 0  3 x float32  x, y, z  section relative block space (1 unit = 1 block, 0..16;
//                                   fluid surfaces and fence posts may leave the 0..16 box)
//   offset 12 2 x uint16   u, v     texel space * 256 (16 texels -> 4096)
//   offset 16 uint16       texture  texture array layer (ModelSource.textureIndex)
//   offset 18 uint8, uint8 sky 0..15, block 0..15
//   offset 20 4 x uint8    r, g, b, 255  = tint * faceShade * AO, alpha always 255
//
// Indices are per layer, 6 per quad: (0,1,2) and (0,2,3) with 0..3 in BakedQuad vertex order,
// which is counter clockwise seen from outside (verified against the shipped models).
//
// Layers: TRANSLUCENT for translucent blocks/quad materials, CUTOUT for alpha tested geometry,
// SOLID for everything else - see `layerFor`.

import { DIRS } from '../../../vanilla/core/Direction.js';
import type { MinecraftData } from '../../../vanilla/world/level/block/state/BlockState.js';
import type { DecodedModel, DecodedQuad, ModelSource } from '../model/ModelSource.js';

// ---------------------------------------------------------------------------
// public types
// ---------------------------------------------------------------------------

/** Biome tint provider, called only for quads that carry a tint index (or for water). */
export interface TintSource {
  /** tint index -> rgb multiplier (each 0..1) for a world column, e.g. grass/foliage/water */
  tint(stateId: number, tintIndex: number, x: number, y: number, z: number): [number, number, number];
}

export interface MeshInput {
  mc: MinecraftData;
  models: ModelSource;
  /** reads a block state in WORLD coordinates; the mesher asks for neighbours too */
  getState(x: number, y: number, z: number): number;
  getSkyLight(x: number, y: number, z: number): number; // 0..15
  getBlockLight(x: number, y: number, z: number): number; // 0..15
  /** biome tint for a world column */
  tints: TintSource;
  /** section origin in world coordinates */
  originX: number;
  originY: number;
  originZ: number;
  /** deterministic seed for the weighted/random model variants */
  variantSeed: number;
}

export enum RenderLayer {
  SOLID = 0,
  CUTOUT = 1,
  TRANSLUCENT = 2,
}

export interface SectionMesh {
  /** one interleaved vertex buffer per layer, indices per layer */
  vertices: Uint8Array[];
  indices: Uint32Array[];
  quadCounts: number[];
  /**
   * Debug counter: non air blocks that produced no geometry because they have no model,
   * an empty/`noGeometry` model (block entity renderers: chests, signs, banners, ...).
   */
  skipped: number;
}

// ---------------------------------------------------------------------------
// direction constants (vanilla Direction 3D data values, see core/Direction.ts)
// ---------------------------------------------------------------------------

const DOWN = 0;
const UP = 1;
const NORTH = 2;
const SOUTH = 3;
const WEST = 4;
const EAST = 5;

/**
 * CardinalLighting.DEFAULT (net/minecraft/world/level/CardinalLighting.java:8):
 * `new CardinalLighting(0.5F, 1.0F, 0.8F, 0.8F, 0.6F, 0.6F)`.
 *
 * The mesher always uses DEFAULT: the nether override (NETHER: 0.9/0.9/0.8/0.8/0.6/0.6) is a
 * property of the dimension, which MeshInput does not carry.
 */
const CARDINAL_SHADE = [0.5, 1.0, 0.8, 0.8, 0.6, 0.6];

/**
 * BlockModelLighter.AdjacencyInfo.corners: the four blocks sampled around the face, in the
 * order the vertex weights expect (`vert0Weights` = corners 0+3, `vert1` = 0+2,
 * `vert2` = 1+2, `vert3` = 1+3, see prepareQuadAmbientOcclusion).
 */
const ADJ_CORNERS: readonly (readonly number[])[] = [
  [WEST, EAST, NORTH, SOUTH], // DOWN
  [EAST, WEST, NORTH, SOUTH], // UP
  [UP, DOWN, EAST, WEST], // NORTH
  [WEST, EAST, DOWN, UP], // SOUTH
  [UP, DOWN, NORTH, SOUTH], // WEST
  [DOWN, UP, NORTH, SOUTH], // EAST
];

/**
 * BlockModelLighter.AmbientVertexRemap: `remap[k]` is the quad vertex that receives the k-th
 * computed (shade, light) pair. DOWN(0,1,2,3) UP(2,3,0,1) NORTH(3,0,1,2)
 * SOUTH(0,1,2,3) WEST(3,0,1,2) EAST(1,2,3,0).
 */
const AMBIENT_REMAP: readonly (readonly number[])[] = [
  [0, 1, 2, 3], // DOWN
  [2, 3, 0, 1], // UP
  [3, 0, 1, 2], // NORTH
  [0, 1, 2, 3], // SOUTH
  [3, 0, 1, 2], // WEST
  [1, 2, 3, 0], // EAST
];

/** Corner pairs used for the "diagonal" light sample of each computed vertex, in the order
 *  vanilla computes lightLevel1..4: (3,0), (2,0), (2,1), (3,1). */
const PAIR_A = [3, 2, 2, 3];
const PAIR_B = [0, 0, 1, 1];

// ---------------------------------------------------------------------------
// small helpers
// ---------------------------------------------------------------------------

/** LightCoordsUtil.FULL_BRIGHT (net/minecraft/util/LightCoordsUtil.java:9) */
const FULL_BRIGHT = 15728880;
/** LightCoordsUtil.MAX_SMOOTH_LIGHT_LEVEL - the 4 bit per channel packing keeps values 0..15 */
const LIGHT_MASK = 0x00ff00ff; // see smoothBlend's final `& 16711935`

const MIN_EPS = 1.0e-4; // BlockModelLighter.prepareQuadShape: minEpsilon
const MAX_EPS = 0.9999; // BlockModelLighter.prepareQuadShape: maxEpsilon

const VERTEX_BYTES = 24;
/** 16 texels in the vertex u/v space (texel * 256): a whole sprite */
const TEXEL16 = 16 * 256;
/** 8 texels (half a sprite), used by the fluid side UVs */
const TEXEL8 = 8 * 256;

function clamp255(v: number): number {
  return v < 0 ? 0 : v > 255 ? 255 : v;
}

/** LightCoordsUtil.pack(block, sky) */
function packLight(block: number, sky: number): number {
  return (block << 4) | (sky << 20);
}

/** LightCoordsUtil.block(packed) */
function lightBlockOf(packed: number): number {
  return (packed >> 4) & 15;
}

/** LightCoordsUtil.sky(packed) */
function lightSkyOf(packed: number): number {
  return (packed >> 20) & 15;
}

/**
 * LightCoordsUtil.smoothBlend (net/minecraft/util/LightCoordsUtil.java:66).
 *
 * Averages four packed light coords. Because block lives at bits 4..7 and sky at bits 20..23,
 * the final `>> 2 & 0x00FF00FF` averages both channels in one go.
 */
function smoothBlend(neighbor1: number, neighbor2: number, neighbor3: number, center: number): number {
  if (lightSkyOf(center) > 2 || lightBlockOf(center) > 2) {
    if (neighbor1 === 0) {
      neighbor1 = center;
    } else if (lightSkyOf(neighbor1) === 0) {
      neighbor1 |= center & 0xff0000;
    }
    if (neighbor2 === 0) {
      neighbor2 = center;
    } else if (lightSkyOf(neighbor2) === 0) {
      neighbor2 |= center & 0xff0000;
    }
    if (neighbor3 === 0) {
      neighbor3 = center;
    } else if (lightSkyOf(neighbor3) === 0) {
      neighbor3 |= center & 0xff0000;
    }
  }
  return ((neighbor1 + neighbor2 + neighbor3 + center) >> 2) & LIGHT_MASK;
}

/**
 * `ARGB.gray(x)` then `QuadInstance.scaleColor(shade)` then `QuadInstance.multiplyColor(tint)`.
 *
 * Vanilla truncates three times (as8BitChannel = Mth.floor, scaleRGB float = (int) cast,
 * multiply = integer division), so we do the same instead of multiplying the floats once.
 * `tintR/G/B` are already 0..255 (255 = untinted); returns 0xAABBGGRR for the LE byte layout.
 */
function packVertexColor(lightLevel: number, shade: number, tintR: number, tintG: number, tintB: number): number {
  const gray = Math.floor((lightLevel < 0 ? 0 : lightLevel > 1 ? 1 : lightLevel) * 255);
  const r0 = clamp255((gray * shade) | 0);
  const g0 = r0;
  const b0 = r0;
  const r = clamp255((r0 * tintR) / 255) | 0;
  const g = clamp255((g0 * tintG) / 255) | 0;
  const b = clamp255((b0 * tintB) / 255) | 0;
  return (r | (g << 8) | (b << 16) | 0xff000000) | 0;
}

// ---------------------------------------------------------------------------
// derived per-state tables (cached per MinecraftData, never mutated after build)
// ---------------------------------------------------------------------------

interface Derived {
  /** single collision/occlusion box covering the full unit cube */
  collisionFull: Uint8Array;
  /** vanilla BlockState.isSolidRender(): canOcclude && full cube */
  solidRender: Uint8Array;
  /**
   * vanilla `!state.isViewBlocking() || getLightDampening() == 0`, the per corner test of
   * BlockModelLighter.prepareQuadAmbientOcclusion. isViewBlocking defaults to
   * `blocksMotion() && isCollisionShapeFullBlock()` (BlockBehaviour.Properties:1007).
   */
  aoTranslucent: Uint8Array;
  /** BlockBehaviour.getShadeBrightness: 0.2 for a full cube, 1.0 otherwise */
  shade: Float32Array;
  /** vanilla skipRendering(state, sameBlock, dir) - only same block pairs, see SAME_BLOCK_SKIP_CLASSES */
  skipSameBlock: Uint8Array;
  /** RenderLayer per state, -1 = not computed yet */
  layer: Int8Array;
  /** 0 unknown, 1 weighted variant list (pick one), 2 multipart (render every part) */
  variantKind: Uint8Array;
  /** model index -> order independent face direction signature */
  modelSig: Map<number, number>;
}

/**
 * Block subclasses that override `skipRendering` to true when the neighbour is the same block
 * (net/minecraft/world/level/block/HalfTransparentBlock.java:21, IceBlock, SlimeBlock,
 * HoneyBlock, PowderSnowBlock:57). Glass (TransparentBlock) does NOT override it, so a glass
 * face next to glass is still drawn - that matches vanilla and is asserted by the tests.
 */
const SAME_BLOCK_SKIP_CLASSES = new Set([
  'HalfTransparentBlock',
  'IceBlock',
  'SlimeBlock',
  'HoneyBlock',
  'PowderSnowBlock',
]);

const derivedCache = new WeakMap<MinecraftData, Derived>();

function derivedOf(mc: MinecraftData): Derived {
  const cached = derivedCache.get(mc);
  if (cached) return cached;

  const n = mc.stateCount;
  const d: Derived = {
    collisionFull: new Uint8Array(n),
    solidRender: new Uint8Array(n),
    aoTranslucent: new Uint8Array(n),
    shade: new Float32Array(n),
    skipSameBlock: new Uint8Array(n),
    layer: new Int8Array(n).fill(-1),
    variantKind: new Uint8Array(n),
    modelSig: new Map(),
  };

  for (let s = 0; s < n; s++) {
    let full = false;
    const boxes = mc.collision(s);
    if (boxes.length === 1) {
      const b = boxes[0];
      full = b.minX <= 0 && b.minY <= 0 && b.minZ <= 0 && b.maxX >= 1 && b.maxY >= 1 && b.maxZ >= 1;
    }
    d.collisionFull[s] = full ? 1 : 0;
    d.solidRender[s] = full && mc.canOcclude(s) ? 1 : 0;
    d.aoTranslucent[s] = !full || mc.isAir(s) || mc.dampOf(s) === 0 ? 1 : 0;
    // TransparentBlock (glass, stained glass) overrides getShadeBrightness to 1.0F
    d.shade[s] = full && mc.blocks[mc.stateBlock[s]].cls !== 'TransparentBlock' ? 0.2 : 1.0;
    d.skipSameBlock[s] = SAME_BLOCK_SKIP_CLASSES.has(mc.blocks[mc.stateBlock[s]].cls) ? 1 : 0;
  }

  derivedCache.set(mc, d);
  return d;
}

// ---------------------------------------------------------------------------
// render layer assignment
// ---------------------------------------------------------------------------

/**
 * Vanilla decides the chunk layer per *baked quad* from the sprite material's `Transparency`
 * (BakedQuad.MaterialInfo.of -> ChunkSectionLayer.byTransparency). The shipped model pack only
 * carries `quad.translucent` (material force_translucent), so the cutout/solid split has to be
 * reconstructed from block data. Mapping:
 *
 *  TRANSLUCENT - anything whose texture needs alpha blending (vanilla RenderType.translucent):
 *                the fluid blocks (water), glass/stained glass/glass panes, tinted glass, ice,
 *                frosted/blue ice, slime, honey, powder snow, portals, bubble columns.
 *                Ice/slime/honey/powder snow are HalfTransparentBlock in vanilla.
 *  CUTOUT      - anything alpha *tested* (vanilla cutout / cutout_mipped): everything with an
 *                empty collision shape that still has geometry (torches, saplings, flowers,
 *                grass, crops, rails, redstone dust, lily pads, vines, ...), plus the block
 *                classes that are hard coded cutout while still having a collision shape
 *                (doors, ladders, bars and panes, cobweb, chains, lanterns) and all leaves
 *                (vanilla cutout_mipped - they belong to the cutout bucket for us).
 *  SOLID       - everything else.
 *
 * Quad level `quad.translucent` still forces TRANSLUCENT at emit time, so a model that declares
 * a translucent material wins over this heuristic.
 */
function computeLayer(stateId: number, mc: MinecraftData): RenderLayer {
  const meta = mc.blocks[mc.stateBlock[stateId]];
  const name = meta.name;

  if (mc.isAir(stateId)) return RenderLayer.SOLID;

  // Liquids are drawn by the fluid path (vanilla RenderShape.INVISIBLE for LiquidBlock).
  if (mc.isLiquid(stateId)) return name === 'lava' ? RenderLayer.SOLID : RenderLayer.TRANSLUCENT;

  if (isTranslucentName(name)) return RenderLayer.TRANSLUCENT;

  // data driven cutout: no collision box, but the state still points at a model -> a cross or
  // flat plant (torch, sapling, flower, grass, rail, redstone dust, vine, lily pad, ...).
  if (mc.collision(stateId).length === 0 && mc.modelCount[stateId] > 0) return RenderLayer.CUTOUT;

  if (CUTOUT_CLASSES.has(meta.cls)) return RenderLayer.CUTOUT;
  if (name.startsWith('potted_')) return RenderLayer.CUTOUT;
  if (name.endsWith('_leaves')) return RenderLayer.CUTOUT;
  return RenderLayer.SOLID;
}

/**
 * Complementary's waving-blocks list, reduced to what we ship: cross/flat plants sway from their
 * root, leaves use a smaller weight so the canopy breathes without detaching from the trunk.
 * The weight ends up in the vertex colour alpha (255 = static), which neither the terrain shader
 * nor the shadow pass reads for anything else.
 */
function swayWeightOf(state: number, mc: MinecraftData): number {
  const meta = mc.blocks[mc.stateBlock[state]];
  const name = meta.name;
  if (name.endsWith('_leaves')) return 0.45;
  switch (meta.cls) {
    case 'FlowerBlock':
    case 'BushBlock':
    case 'SaplingBlock':
    case 'CropBlock':
    case 'DoublePlantBlock':
    case 'SugarCaneBlock':
    case 'StemBlock':
    case 'AttachedStemBlock':
    case 'TallGrassBlock':
      return 1;
    default:
      break;
  }
  if (name === 'grass' || name === 'short_grass' || name === 'fern' || name === 'tall_grass'
    || name === 'large_fern' || name === 'vine' || name === 'glow_lichen') return 1;
  return 0;
}

/** names that vanilla renders with RenderType.translucent */
function isTranslucentName(name: string): boolean {
  switch (name) {
    case 'water':
    case 'lava':
    case 'bubble_column':
    case 'glass':
    case 'glass_pane':
    case 'tinted_glass':
    case 'ice':
    case 'frosted_ice':
    case 'blue_ice':
    case 'slime_block':
    case 'honey_block':
    case 'powder_snow':
      return true;
    default:
      return (
        name.endsWith('_stained_glass') ||
        name.endsWith('_stained_glass_pane') ||
        name.endsWith('_portal')
      );
  }
}

/** vanilla block classes that use RenderType.cutout while still having a collision shape */
const CUTOUT_CLASSES = new Set([
  'DoorBlock',
  'TrapDoorBlock',
  'LadderBlock',
  'IronBarsBlock',
  'WeatheringCopperBarsBlock',
  'WeatheringCopperDoorBlock',
  'WeatheringCopperTrapDoorBlock',
  'StainedGlassPaneBlock',
  'WebBlock',
  'RailBlock',
  'DetectorRailBlock',
  'TorchBlock',
  'WallTorchBlock',
  'RedstoneTorchBlock',
  'RedstoneWallTorchBlock',
  'LanternBlock',
  'ChainBlock',
  'FlowerPotBlock',
  'FlowerBlock',
  'TallGrassBlock',
  'TallFlowerBlock',
  'SaplingBlock',
  'CropBlock',
  'StemBlock',
  'VineBlock',
  'MangrovePropaguleBlock',
  'CocoaBlock',
  'AzaleaBlock',
  'MushroomBlock',
  'CactusFlowerBlock',
  'SeaPickleBlock',
  'CoralPlantBlock',
  'CoralFanBlock',
  'BaseCoralPlantBlock',
  'GlowLichenBlock',
  'MultifaceBlock',
  'ScaffoldingBlock',
  'LilyPadBlock',
  'CarpetBlock',
  'FlowerBedBlock',
  'LeafLitterBlock',
  'FrogspawnBlock',
]);

/**
 * The render layer of a block state. Exported so the renderer/tests can classify without
 * meshing; the mesh itself uses exactly this value (plus per-quad `translucent`).
 */
export function layerFor(stateId: number, mc: MinecraftData): RenderLayer {
  const d = derivedOf(mc);
  const cached = d.layer[stateId];
  if (cached >= 0) return cached as RenderLayer;
  const layer = computeLayer(stateId, mc);
  d.layer[stateId] = layer;
  return layer;
}

// ---------------------------------------------------------------------------
// per-layer quad buffer
// ---------------------------------------------------------------------------

class QuadBuffer {
  buffer: ArrayBuffer;
  u8: Uint8Array;
  u16: Uint16Array;
  f32: Float32Array;
  /** vertices written */
  vcount = 0;
  /** quads written */
  quads = 0;
  indices: Uint32Array;
  icount = 0;

  constructor(quadsCapacity = 256) {
    this.buffer = new ArrayBuffer(quadsCapacity * 4 * VERTEX_BYTES);
    this.u8 = new Uint8Array(this.buffer);
    this.u16 = new Uint16Array(this.buffer);
    this.f32 = new Float32Array(this.buffer);
    this.indices = new Uint32Array(quadsCapacity * 6);
  }

  private growVertices(extraVertices: number): void {
    const needed = (this.vcount + extraVertices) * VERTEX_BYTES;
    if (needed <= this.buffer.byteLength) return;
    let size = this.buffer.byteLength;
    while (size < needed) size *= 2;
    const next = new ArrayBuffer(size);
    new Uint8Array(next).set(this.u8.subarray(0, this.vcount * VERTEX_BYTES));
    this.buffer = next;
    this.u8 = new Uint8Array(next);
    this.u16 = new Uint16Array(next);
    this.f32 = new Float32Array(next);
  }

  private growIndices(extraIndices: number): void {
    const needed = this.icount + extraIndices;
    if (needed <= this.indices.length) return;
    let size = this.indices.length;
    while (size < needed) size *= 2;
    const next = new Uint32Array(size);
    next.set(this.indices.subarray(0, this.icount));
    this.indices = next;
  }

  beginQuad(): number {
    this.growVertices(4);
    this.growIndices(6);
    const base = this.vcount;
    this.vcount += 4;
    return base;
  }

  /**
   * Writes one vertex at `vi`. Offsets (see the header comment):
   *   0/4/8  float32 x,y,z      12/14 uint16 u,v (texel*256)
   *   16     uint16 texture     18/19 uint8 sky, block
   *   20..23 uint8 r,g,b,255
   * The u16 view indexes 12 units per vertex, which lands exactly on bytes 12..23.
   */
  putVertex(
    vi: number,
    x: number,
    y: number,
    z: number,
    u: number,
    v: number,
    tex: number,
    packedLight: number,
    packedColor: number,
  ): void {
    const f = this.f32;
    const o = vi * 6;
    f[o] = x;
    f[o + 1] = y;
    f[o + 2] = z;
    const w = vi * 12;
    const u16 = this.u16;
    u16[w + 6] = u;
    u16[w + 7] = v;
    u16[w + 8] = tex;
    u16[w + 9] = lightSkyOf(packedLight) | (lightBlockOf(packedLight) << 8);
    u16[w + 10] = packedColor & 0xffff;
    u16[w + 11] = (packedColor >>> 16) & 0xffff;
  }

  /** counter clockwise from outside: (0,1,2) and (0,2,3), matching the BakedQuad vertex order */
  putQuadIndices(base: number): void {
    const idx = this.indices;
    let i = this.icount;
    idx[i++] = base;
    idx[i++] = base + 1;
    idx[i++] = base + 2;
    idx[i++] = base;
    idx[i++] = base + 2;
    idx[i++] = base + 3;
    this.icount = i;
    this.quads++;
  }

  finishVertices(): Uint8Array {
    return this.u8.slice(0, this.vcount * VERTEX_BYTES);
  }

  finishIndices(): Uint32Array {
    return this.indices.slice(0, this.icount);
  }
}

// ---------------------------------------------------------------------------
// the mesher
// ---------------------------------------------------------------------------

class SectionMesher {
  private readonly mc: MinecraftData;
  private readonly models: ModelSource;
  private readonly input: MeshInput;
  private readonly d: Derived;
  private readonly out: QuadBuffer[] = [new QuadBuffer(), new QuadBuffer(), new QuadBuffer()];

  skipped = 0;

  // scratch --------------------------------------------------------------
  /** 4 sampled corner light coords (packed) */
  private readonly cornerLight = new Int32Array(4);
  /** 4 sampled corner shade brightness */
  private readonly cornerShade = new Float32Array(4);
  /** 4 corner "translucent" flags (vanilla translucent0..3) */
  private readonly cornerTranslucent = new Uint8Array(4);
  /** diagonal corner light/shade, order (3,0),(2,0),(2,1),(3,1) */
  private readonly pairLight = new Int32Array(4);
  private readonly pairShade = new Float32Array(4);
  /** per quad vertex packed light + colour, filled by aoQuad/flatQuad */
  private readonly vLight = new Int32Array(4);
  private readonly vColor = new Int32Array(4);
  /** tint cache for the current block: validity mask + rgb 0..255 */
  private tintMask = 0;
  private readonly tintRgb = new Int32Array(16);

  // face shape scratch (BlockModelLighter.SizeInfo: DOWN 0 UP 1 NORTH 2 SOUTH 3 WEST 4 EAST 5)
  // the FLIP_* entries (6..11) are only needed by the non cubic weight path, see setFaceShape.
  private readonly faceShape = new Float32Array(12);
  private facePartial = false;

  // fluid scratch
  private readonly fh = new Float32Array(8);

  constructor(input: MeshInput) {
    this.input = input;
    this.mc = input.mc;
    this.models = input.models;
    this.d = derivedOf(input.mc);
  }

  // ---- light / shade ---------------------------------------------------

  /** BlockModelLighter.Cache.getLightCoords -> LightCoordsUtil.getLightCoords */
  private lightCoords(state: number, x: number, y: number, z: number): number {
    if (this.mc.isEmissive(state)) return FULL_BRIGHT;
    const emit = this.mc.lightEmission[state];
    const blockRaw = this.input.getBlockLight(x, y, z);
    const skyRaw = this.input.getSkyLight(x, y, z);
    const block = blockRaw > 15 ? 15 : blockRaw < 0 ? 0 : blockRaw;
    const sky = skyRaw > 15 ? 15 : skyRaw < 0 ? 0 : skyRaw;
    // `return block < blockSelfEmission ? withBlock(packed, emission) : packed;`
    return packLight(block < emit ? emit : block, sky);
  }

  /**
   * BlockBehaviour.getShadeBrightness: `isCollisionShapeFullBlock ? 0.2F : 1.0F`.
   * TransparentBlock (glass) overrides it to 1.0F, all other overrides are rare enough to fold
   * into the default here (Barrier/Light/StructureVoid return 1.0 too, but they are invisible).
   */
  private shadeBrightness(state: number): number {
    return this.d.shade[state];
  }

  private isSolidRender(state: number): boolean {
    return this.d.solidRender[state] === 1;
  }

  // ---- tint ------------------------------------------------------------

  private tintComponent(state: number, tintIndex: number, x: number, y: number, z: number, channel: number): number {
    // vanilla ModelBlockRenderer.getTintColor caches per tint index for the current block
    if (tintIndex < 16) {
      const bit = 1 << tintIndex;
      if ((this.tintMask & bit) === 0) {
        const rgb = this.input.tints.tint(state, tintIndex, x, y, z);
        this.tintRgb[tintIndex * 3] = clamp255(Math.round(rgb[0] * 255));
        this.tintRgb[tintIndex * 3 + 1] = clamp255(Math.round(rgb[1] * 255));
        this.tintRgb[tintIndex * 3 + 2] = clamp255(Math.round(rgb[2] * 255));
        this.tintMask |= bit;
      }
      return this.tintRgb[tintIndex * 3 + channel];
    }
    const rgb = this.input.tints.tint(state, tintIndex, x, y, z);
    return clamp255(Math.round(rgb[channel] * 255));
  }

  // ---- model variant selection ----------------------------------------

  /**
   * A blockstate `variants` entry may list several equal weight models (stone has four, one per
   * 90 degree rotation of the same cube). Those are alternatives - vanilla picks one with a
   * seeded random per position (`ModelBlockRenderer` -> `random.setSeed(seed)` +
   * `model.collectParts(random, ...)`), while `multipart` parts are all drawn.
   *
   * The data pack does not record which of the two a model list came from, so we classify:
   * when every model in the list has the same quad count AND the same multiset of face
   * directions, the list is a set of rotated duplicates of one shape -> pick one. Otherwise it
   * is multipart (fences: post 6 quads + 4 sides of 10; bars: post_ends 4 + sides 7/9; ...) and
   * every part is emitted.
   */
  private modelSignature(modelIndex: number): number {
    const cached = this.d.modelSig.get(modelIndex);
    if (cached !== undefined) return cached;
    const model: DecodedModel = this.models.getModel(modelIndex);
    const hist = [0, 0, 0, 0, 0, 0];
    for (let i = 0; i < model.quads.length; i++) hist[model.quads[i].dir]++;
    let sig = model.quads.length;
    for (let i = 0; i < 6; i++) sig = sig * 32 + (hist[i] > 31 ? 31 : hist[i]);
    this.d.modelSig.set(modelIndex, sig);
    return sig;
  }

  private isVariantList(state: number, offset: number, count: number): boolean {
    const known = this.d.variantKind[state];
    if (known !== 0) return known === 1;
    let variant = true;
    const first = this.modelSignature(this.mc.modelIds[offset]);
    for (let i = 1; i < count; i++) {
      if (this.modelSignature(this.mc.modelIds[offset + i]) !== first) {
        variant = false;
        break;
      }
    }
    this.d.variantKind[state] = variant ? 1 : 2;
    return variant;
  }

  /** stable integer hash of (x, y, z, seed); vanilla reseeds its RandomSource per position */
  private variantIndex(x: number, y: number, z: number, count: number): number {
    let h = (x * 374761393 + y * 668265263 + z * 2147483647 + this.input.variantSeed * 1274126177) | 0;
    h = Math.imul(h ^ (h >>> 13), 1274126177);
    h ^= h >>> 16;
    return (h >>> 0) % count;
  }

  // ---- entry point -----------------------------------------------------

  meshSection(): SectionMesh {
    const originX = this.input.originX;
    const originY = this.input.originY;
    const originZ = this.input.originZ;

    for (let y = 0; y < 16; y++) {
      for (let z = 0; z < 16; z++) {
        for (let x = 0; x < 16; x++) {
          const wx = originX + x;
          const wy = originY + y;
          const wz = originZ + z;
          const state = this.input.getState(wx, wy, wz);
          if (this.mc.isAir(state)) continue;

          // SectionCompiler: fluid first, then the block model.
          if (this.mc.isLiquid(state) || this.mc.hasFluid(state)) this.meshFluidAt(wx, wy, wz);

          // LiquidBlock.getRenderShape() == INVISIBLE, everything else is MODEL (barriers and
          // structure voids have a noGeometry model and end up in `skipped`).
          if (this.mc.isLiquid(state)) continue;

          this.meshBlock(state, x, y, z);
        }
      }
    }

    return {
      vertices: [this.out[0].finishVertices(), this.out[1].finishVertices(), this.out[2].finishVertices()],
      indices: [this.out[0].finishIndices(), this.out[1].finishIndices(), this.out[2].finishIndices()],
      quadCounts: [this.out[0].quads, this.out[1].quads, this.out[2].quads],
      skipped: this.skipped,
    };
  }

  // ---- block model -----------------------------------------------------

  private meshBlock(state: number, x: number, y: number, z: number): void {
    const mc = this.mc;
    // read the arrays directly: mc.modelRange() would allocate a tuple per block
    const offset = mc.modelOffset[state];
    const count = mc.modelCount[state];
    if (count === 0) {
      // no blockstate model at all
      this.skipped++;
      return;
    }

    const baseLayer = layerFor(state, mc);
    let hasGeometry = false;
    this.tintMask = 0; // vanilla resets its tint cache per block (ModelBlockRenderer.resetTintCache)

    if (count > 1 && this.isVariantList(state, offset, count)) {
      const modelIndex = mc.modelIds[
        offset + this.variantIndex(this.input.originX + x, this.input.originY + y, this.input.originZ + z, count)
      ];
      if (this.modelHasGeometry(modelIndex)) {
        hasGeometry = true;
        this.meshModel(modelIndex, state, baseLayer, x, y, z);
      }
    } else {
      for (let i = 0; i < count; i++) {
        const modelIndex = mc.modelIds[offset + i];
        if (!this.modelHasGeometry(modelIndex)) continue;
        hasGeometry = true;
        this.meshModel(modelIndex, state, baseLayer, x, y, z);
      }
    }

    // chests, signs, banners, shulker boxes, barriers, structure voids: the model has no cuboid
    // geometry at all (block entity renderers). Blocks whose faces were merely culled by their
    // neighbours are *not* counted here.
    if (!hasGeometry) this.skipped++;
  }

  private modelHasGeometry(modelIndex: number): boolean {
    const model = this.models.getModel(modelIndex);
    return !model.noGeometry && model.quads.length > 0;
  }

  /** ModelBlockRenderer.tesselateBlock: AO path or flat path for one model part */
  private meshModel(modelIndex: number, state: number, baseLayer: RenderLayer, x: number, y: number, z: number): number {
    const model = this.models.getModel(modelIndex);
    if (model.noGeometry) return 0;

    const quads = model.quads;
    const emissive = this.mc.lightEmission[state] !== 0;
    // `ambientOcclusion && blockState.getLightEmission() == 0 && parts.getFirst().useAmbientOcclusion()`
    const useAo = model.ao && !emissive;
    const sway = swayWeightOf(state, this.mc);

    const ox = this.input.originX + x;
    const oy = this.input.originY + y;
    const oz = this.input.originZ + z;

    // vanilla caches shouldRenderFace per direction across the parts of one block
    let cullValid = 0;
    let cullRender = 0;
    let emitted = 0;

    for (let q = 0; q < quads.length; q++) {
      const quad = quads[q];
      if (quad.cull >= 0) {
        const bit = 1 << quad.cull;
        if ((cullValid & bit) === 0) {
          cullValid |= bit;
          if (this.shouldRenderFace(state, quad.cull, ox, oy, oz)) cullRender |= bit;
        }
        if ((cullRender & bit) === 0) continue;
      }

      const layer: RenderLayer = quad.translucent ? RenderLayer.TRANSLUCENT : baseLayer;
      const buf = this.out[layer];

      let tr = 255;
      let tg = 255;
      let tb = 255;
      if (quad.tint >= 0) {
        tr = this.tintComponent(state, quad.tint, ox, oy, oz, 0);
        tg = this.tintComponent(state, quad.tint, ox, oy, oz, 1);
        tb = this.tintComponent(state, quad.tint, ox, oy, oz, 2);
      }

      // NB: lighting/AO sample the world, while the vertices are section local; the
      // caller converts back when it writes positions (see writeQuad below).
      if (useAo) this.aoQuad(quad, state, ox, oy, oz, tr, tg, tb);
      else this.flatQuad(quad, state, ox, oy, oz, tr, tg, tb);

      this.writeQuad(buf, quad, x, y, z, sway);
      emitted++;
    }

    return emitted;
  }

  /**
   * Block.shouldRenderFace (net/minecraft/world/level/block/Block.java:299).
   *
   *   occluder = neighbour.getFaceOcclusionShape(opposite);  full block -> cull
   *   state.skipRendering(neighbour, dir)                    -> cull
   *   occluder empty                                         -> keep
   *   otherwise                                              -> partial shape join test
   *
   * We have `canOcclude` (occlusion shape non empty) and the precomputed per-face
   * `isFaceSturdy` (face of the support shape is full), which reproduces both the full block
   * case and the partial join test for the shapes we ship.
   */
  private shouldRenderFace(state: number, dir: number, x: number, y: number, z: number): boolean {
    const s = DIRS[dir];
    const nx = x + s.stepX;
    const ny = y + s.stepY;
    const nz = z + s.stepZ;
    const neighbor = this.input.getState(nx, ny, nz);

    if (this.mc.canOcclude(neighbor) && this.mc.isFaceSturdy(neighbor, s.opposite)) return false;

    // skipRendering: same *block* for ice/slime/honey/powder snow (glass deliberately not,
    // TransparentBlock does not override skipRendering in 26.2)
    if (this.d.skipSameBlock[state] === 1 && this.mc.stateBlock[neighbor] === this.mc.stateBlock[state]) return false;
    return true;
  }

  // ---- ambient occlusion ----------------------------------------------

  /**
   * BlockModelLighter.prepareQuadAmbientOcclusion (cubic path).
   *
   * The faceshape weighted (`doNonCubicWeight`) branch is not implemented: `faceShape[]` is
   * still filled in setFaceShape() and `facePartial` is still computed, so enabling it later
   * only means adding the weighted blend below. Vanilla only takes that branch when the quad
   * is not a full face (torches, panes, ...) and the model uses AO; in practice those models
   * have `ao == false`, so the cubic path is what vanilla takes for them too.
   */
  private aoQuad(
    quad: DecodedQuad,
    state: number,
    x: number,
    y: number,
    z: number,
    tr: number,
    tg: number,
    tb: number,
  ): void {
    const dir = quad.dir;
    const faceCubic = this.setFaceShape(quad, state);

    const dirStep = DIRS[dir];
    const bx = faceCubic ? x + dirStep.stepX : x; // BlockModelLighter: basePosition
    const by = faceCubic ? y + dirStep.stepY : y;
    const bz = faceCubic ? z + dirStep.stepZ : z;

    const corners = ADJ_CORNERS[dir];

    // --- the four corner blocks around the face
    for (let i = 0; i < 4; i++) {
      const c = DIRS[corners[i]];
      const nx = bx + c.stepX;
      const ny = by + c.stepY;
      const nz = bz + c.stepZ;
      const cornerState = this.input.getState(nx, ny, nz);
      this.cornerLight[i] = this.lightCoords(cornerState, nx, ny, nz);
      this.cornerShade[i] = this.shadeBrightness(cornerState);

      // `corner.isViewBlocking(level, pos) || corner.getLightDampening() == 0` sampled one
      // block further along the face normal (basePosition + corners[i] + direction)
      const dx = nx + dirStep.stepX;
      const dy = ny + dirStep.stepY;
      const dz = nz + dirStep.stepZ;
      this.cornerTranslucent[i] = this.d.aoTranslucent[this.input.getState(dx, dy, dz)];
    }

    // --- the four diagonal corners. Note vanilla always falls back to corner 0's sample
    // (shade0/light0), even for the (1,2) and (1,3) pairs - ported as is.
    for (let k = 0; k < 4; k++) {
      const a = corners[PAIR_A[k]];
      const b = corners[PAIR_B[k]];
      if (this.cornerTranslucent[PAIR_A[k]] === 0 && this.cornerTranslucent[PAIR_B[k]] === 0) {
        this.pairShade[k] = this.cornerShade[0];
        this.pairLight[k] = this.cornerLight[0];
      } else {
        const sa = DIRS[a];
        const sb = DIRS[b];
        const nx = bx + sa.stepX + sb.stepX;
        const ny = by + sa.stepY + sb.stepY;
        const nz = bz + sa.stepZ + sb.stepZ;
        const s = this.input.getState(nx, ny, nz);
        this.pairShade[k] = this.shadeBrightness(s);
        this.pairLight[k] = this.lightCoords(s, nx, ny, nz);
      }
    }

    // --- centre light
    let lightCenter = this.lightCoords(state, x, y, z);
    const fx = x + dirStep.stepX;
    const fy = y + dirStep.stepY;
    const fz = z + dirStep.stepZ;
    const nextState = this.input.getState(fx, fy, fz);
    if (faceCubic || !this.isSolidRender(nextState)) {
      lightCenter = this.lightCoords(nextState, fx, fy, fz);
    }
    const shadeCenter = faceCubic ? this.shadeBrightness(nextState) : this.shadeBrightness(state);

    // --- shade (0.2 / 1.0 average) and smooth light per computed vertex, vanilla order:
    //     vertex 0 = (3,0,03), 1 = (2,0,02), 2 = (2,1,12), 3 = (3,1,13)
    const l0 = this.cornerLight[0];
    const l1 = this.cornerLight[1];
    const l2 = this.cornerLight[2];
    const l3 = this.cornerLight[3];
    const s0 = this.cornerShade[0];
    const s1 = this.cornerShade[1];
    const s2 = this.cornerShade[2];
    const s3 = this.cornerShade[3];

    const shadeK0 = (s3 + s0 + this.pairShade[0] + shadeCenter) * 0.25;
    const shadeK1 = (s2 + s0 + this.pairShade[1] + shadeCenter) * 0.25;
    const shadeK2 = (s2 + s1 + this.pairShade[2] + shadeCenter) * 0.25;
    const shadeK3 = (s3 + s1 + this.pairShade[3] + shadeCenter) * 0.25;

    const lightK0 = smoothBlend(l3, l0, this.pairLight[0], lightCenter);
    const lightK1 = smoothBlend(l2, l0, this.pairLight[1], lightCenter);
    const lightK2 = smoothBlend(l2, l1, this.pairLight[2], lightCenter);
    const lightK3 = smoothBlend(l3, l1, this.pairLight[3], lightCenter);

    const remap = AMBIENT_REMAP[dir];
    const cardinal = quad.shade ? CARDINAL_SHADE[dir] : 1.0;

    // if (this.facePartial && info.doNonCubicWeight) { ...weighted blend, see class comment... }
    this.vLight[remap[0]] = lightK0;
    this.vLight[remap[1]] = lightK1;
    this.vLight[remap[2]] = lightK2;
    this.vLight[remap[3]] = lightK3;
    this.vColor[remap[0]] = packVertexColor(shadeK0, cardinal, tr, tg, tb);
    this.vColor[remap[1]] = packVertexColor(shadeK1, cardinal, tr, tg, tb);
    this.vColor[remap[2]] = packVertexColor(shadeK2, cardinal, tr, tg, tb);
    this.vColor[remap[3]] = packVertexColor(shadeK3, cardinal, tr, tg, tb);
  }

  /**
   * BlockModelLighter.prepareQuadFlat (no AO: models with `ao == false`, or emissive blocks).
   * One light coord for the whole quad, colour is the cardinal shade only.
   */
  private flatQuad(
    quad: DecodedQuad,
    state: number,
    x: number,
    y: number,
    z: number,
    tr: number,
    tg: number,
    tb: number,
  ): void {
    const dir = quad.dir;
    const s = DIRS[dir];

    let light: number;
    if (quad.cull >= 0) {
      // ModelBlockRenderer.tesselateFlat passes the neighbour light downstream
      light = this.lightCoords(state, x + s.stepX, y + s.stepY, z + s.stepZ);
    } else {
      const faceCubic = this.setFaceShape(quad, state);
      light = faceCubic
        ? this.lightCoords(state, x + s.stepX, y + s.stepY, z + s.stepZ)
        : this.lightCoords(state, x, y, z);
    }

    const cardinal = quad.shade ? CARDINAL_SHADE[dir] : 1.0;
    const color = packVertexColor(1.0, cardinal, tr, tg, tb);
    this.vLight[0] = light;
    this.vLight[1] = light;
    this.vLight[2] = light;
    this.vLight[3] = light;
    this.vColor[0] = color;
    this.vColor[1] = color;
    this.vColor[2] = color;
    this.vColor[3] = color;
  }

  /**
   * BlockModelLighter.prepareQuadShape. Fills faceShape (SizeInfo order, including FLIP_*) and
   * returns `faceCubic`, the flag that decides whether lighting is sampled at the block itself
   * or at the neighbouring block.
   *
   * `state.isCollisionShapeFullBlock(level, pos)` is approximated by "collision shape is the
   * full unit cube" (derivedOf), which is what vanilla computes for the blocks we ship.
   */
  private setFaceShape(quad: DecodedQuad, state: number): boolean {
    const p = quad.p;
    let minX = 32;
    let minY = 32;
    let minZ = 32;
    let maxX = -32;
    let maxY = -32;
    let maxZ = -32;
    for (let i = 0; i < 4; i++) {
      const vx = p[i * 3];
      const vy = p[i * 3 + 1];
      const vz = p[i * 3 + 2];
      if (vx < minX) minX = vx;
      if (vy < minY) minY = vy;
      if (vz < minZ) minZ = vz;
      if (vx > maxX) maxX = vx;
      if (vy > maxY) maxY = vy;
      if (vz > maxZ) maxZ = vz;
    }

    const fs = this.faceShape;
    fs[WEST] = minX;
    fs[EAST] = maxX;
    fs[DOWN] = minY;
    fs[UP] = maxY;
    fs[NORTH] = minZ;
    fs[SOUTH] = maxZ;
    // SizeInfo.FLIP_DOWN = 6 .. FLIP_EAST = 11, only used by the weighted (non cubic) path
    fs[6] = 1 - minY;
    fs[7] = 1 - maxY;
    fs[8] = 1 - minZ;
    fs[9] = 1 - maxZ;
    fs[10] = 1 - minX;
    fs[11] = 1 - maxX;

    const dir = quad.dir;
    this.facePartial =
      dir === DOWN || dir === UP
        ? minX >= MIN_EPS || minZ >= MIN_EPS || maxX <= MAX_EPS || maxZ <= MAX_EPS
        : dir === NORTH || dir === SOUTH
          ? minX >= MIN_EPS || minY >= MIN_EPS || maxX <= MAX_EPS || maxY <= MAX_EPS
          : minY >= MIN_EPS || minZ >= MIN_EPS || maxY <= MAX_EPS || maxZ <= MAX_EPS;

    const full = this.d.collisionFull[state] === 1;
    switch (dir) {
      case DOWN:
        return minY === maxY && (minY < MIN_EPS || full);
      case UP:
        return minY === maxY && (maxY > MAX_EPS || full);
      case NORTH:
        return minZ === maxZ && (minZ < MIN_EPS || full);
      case SOUTH:
        return minZ === maxZ && (maxZ > MAX_EPS || full);
      case WEST:
        return minX === maxX && (minX < MIN_EPS || full);
      default:
        return minX === maxX && (maxX > MAX_EPS || full);
    }
  }

  /** writes the 4 vertices collected in vLight/vColor plus the 6 indices */
  private writeQuad(
    buf: QuadBuffer, quad: DecodedQuad, ox: number, oy: number, oz: number, sway: number,
  ): void {
    const base = buf.beginQuad();
    const p = quad.p;
    const uv = quad.uv;
    const tex = quad.tex;
    for (let i = 0; i < 4; i++) {
      // Wind weight in the colour alpha: 255 (opaque) means static, lower means the vertex follows
      // the wind. The weight is the vertex height inside the block (root = 0, tip = 1), so a plant
      // stays planted; leaves get a smaller scale from swayWeightOf().
      let color = this.vColor[i];
      if (sway > 0) {
        const w = Math.max(0, Math.min(1, p[i * 3 + 1])) * sway;
        const a = 255 - Math.round(254 * w);
        color = ((color & 0x00ffffff) | (a << 24)) >>> 0;
      }
      buf.putVertex(
        base + i,
        ox + p[i * 3],
        oy + p[i * 3 + 1],
        oz + p[i * 3 + 2],
        Math.round(uv[i * 2] * 256),
        Math.round(uv[i * 2 + 1] * 256),
        tex,
        this.vLight[i],
        color,
      );
    }
    buf.putQuadIndices(base);
  }

  // ---- fluids ----------------------------------------------------------

  /** FlowingFluid.getOwnHeight: `fluidState.getAmount() / 9.0F`, derived from the legacy level */
  private fluidOwnHeight(state: number): number {
    const meta = this.mc.blocks[this.mc.stateBlock[state]];
    if (meta.name !== 'water' && meta.name !== 'lava') return 8 / 9; // waterlogged block: a source
    // FluidState.getAmount(): LiquidBlock stores the legacy level (0 = source, 8..15 = falling).
    //   getLegacyLevel: isSource ? 0 : 8 - min(amount, 8) + (falling ? 8 : 0)
    //   -> level 0..7  : amount = 8 - level
    //   -> level 8..15 : amount = 16 - level
    const raw = this.mc.getProp(state, 'level');
    const level = raw === undefined ? 0 : parseInt(raw, 10) || 0;
    const amount = level <= 7 ? 8 - level : 16 - level;
    return (amount < 1 ? 1 : amount > 8 ? 8 : amount) / 9;
  }

  /** 0 = none, 1 = water, 2 = lava (FluidState.getType for waterlogged blocks is water) */
  private fluidKind(state: number): number {
    const meta = this.mc.blocks[this.mc.stateBlock[state]];
    if (meta.name === 'lava') return 2;
    if (meta.name === 'water' || meta.name === 'bubble_column') return 1;
    return this.mc.hasFluid(state) ? 1 : 0;
  }

  /** FlowingFluid.getHeight(level, pos, state, fluidState) */
  private fluidHeightAt(kind: number, x: number, y: number, z: number): number {
    const state = this.input.getState(x, y, z);
    if (this.fluidKind(state) === kind) {
      const above = this.input.getState(x, y + 1, z);
      return this.fluidKind(above) === kind ? 1.0 : this.fluidOwnHeight(state);
    }
    // `return !state.isSolid() ? 0.0F : -1.0F;` - -1 means "not a fluid, ignore this height"
    return this.mc.isSolid(state) ? -1 : 0;
  }

  /** FluidRenderer.addWeightedHeight */
  private static addWeightedHeight(out: Float32Array, height: number): void {
    if (height >= 0.8) {
      out[0] += height * 10.0;
      out[1] += 10.0;
    } else if (height >= 0.0) {
      out[0] += height;
      out[1] += 1.0;
    }
  }

  /** FluidRenderer.calculateAverageHeight */
  private averageHeight(kind: number, heightSelf: number, height2: number, height1: number, cx: number, cy: number, cz: number): number {
    if (!(height1 >= 1.0) && !(height2 >= 1.0)) {
      const w = this.fh;
      w[0] = 0;
      w[1] = 0;
      if (height1 > 0.0 || height2 > 0.0) {
        const corner = this.fluidHeightAt(kind, cx, cy, cz);
        if (corner >= 1.0) return 1.0;
        SectionMesher.addWeightedHeight(w, corner);
      }
      SectionMesher.addWeightedHeight(w, heightSelf);
      SectionMesher.addWeightedHeight(w, height1);
      SectionMesher.addWeightedHeight(w, height2);
      return w[1] === 0 ? 0 : w[0] / w[1];
    }
    return 1.0;
  }

  /**
   * FluidRenderer.isFaceOccludedByState(direction, height, state): does `state` (a neighbour or
   * the fluid's own block) fully hide the face `direction` of the fluid?
   *
   * Reduced to the full-face case: vanilla culls when the occluder is `Shapes.block()`, i.e. the
   * neighbour's face occlusion shape is the whole face, and then only for `direction != UP`
   * unless the fluid is a full cube. Partial occluders keep the face (conservative).
   */
  private fluidFaceOccludedByState(dir: number, height: number, state: number): boolean {
    const faceOfState = DIRS[dir].opposite;
    if (!this.mc.canOcclude(state) || !this.mc.isFaceSturdy(state, faceOfState)) return false;
    return dir !== UP || height === 1.0;
  }

  /** FluidRenderer.isFaceOccludedBySelf(state, dir) = isFaceOccludedByState(dir.opposite, 1, state) */
  private fluidSelfOccluded(state: number, dir: number): boolean {
    return this.fluidFaceOccludedByState(DIRS[dir].opposite, 1.0, state);
  }

  /**
   * FluidRenderer.tesselate. Called for every block whose fluid state is not empty, i.e. water,
   * lava, bubble columns and waterlogged blocks.
   *
   * Simplifications (documented in the report too):
   *  - still sprite only: the model pack has no `block/water_flow` layer, so the flowing texture
   *    and the flow-direction UV rotation are skipped and the still sprite is used everywhere.
   *  - the `addBackFace` pass (two sided fluid sides) is disabled: it would double every side
   *    quad; the renderer can enable it if the camera ever ends up inside a fluid.
   */
  meshFluidAt(x: number, y: number, z: number): boolean {
    const state = this.input.getState(x, y, z);
    const kind = this.fluidKind(state);
    if (kind === 0) return false;

    const lava = kind === 2;
    const layer: RenderLayer = lava ? RenderLayer.SOLID : RenderLayer.TRANSLUCENT;
    const buf = this.out[layer];

    const aboveState = this.input.getState(x, y + 1, z);
    const belowState = this.input.getState(x, y - 1, z);
    const northState = this.input.getState(x, y, z - 1);
    const southState = this.input.getState(x, y, z + 1);
    const westState = this.input.getState(x - 1, y, z);
    const eastState = this.input.getState(x + 1, y, z);

    const renderUp = this.fluidKind(aboveState) !== kind;

    // FluidRenderer.shouldRenderFace(fluidState, blockState, dir, neighborFluidState)
    //   = !sameFluid && !isFaceOccludedBySelf
    const renderDown =
      this.fluidKind(belowState) !== kind &&
      !this.fluidSelfOccluded(state, DOWN) &&
      !this.fluidFaceOccludedByState(DOWN, 8 / 9, belowState);
    const renderNorth = this.fluidKind(northState) !== kind && !this.fluidSelfOccluded(state, NORTH);
    const renderSouth = this.fluidKind(southState) !== kind && !this.fluidSelfOccluded(state, SOUTH);
    const renderWest = this.fluidKind(westState) !== kind && !this.fluidSelfOccluded(state, WEST);
    const renderEast = this.fluidKind(eastState) !== kind && !this.fluidSelfOccluded(state, EAST);

    if (!renderUp && !renderDown && !renderNorth && !renderSouth && !renderWest && !renderEast) return false;

    // ---- corner heights (FluidRenderer.tesselate + calculateAverageHeight)
    const heightSelf = this.fluidHeightAt(kind, x, y, z);
    let hNE: number;
    let hNW: number;
    let hSE: number;
    let hSW: number;
    if (heightSelf >= 1.0) {
      hNE = hNW = hSE = hSW = 1.0;
    } else {
      const hN = this.fluidHeightAt(kind, x, y, z - 1);
      const hS = this.fluidHeightAt(kind, x, y, z + 1);
      const hE = this.fluidHeightAt(kind, x + 1, y, z);
      const hW = this.fluidHeightAt(kind, x - 1, y, z);
      hNE = this.averageHeight(kind, heightSelf, hN, hE, x + 1, y, z - 1);
      hNW = this.averageHeight(kind, heightSelf, hN, hW, x - 1, y, z - 1);
      hSE = this.averageHeight(kind, heightSelf, hS, hE, x + 1, y, z + 1);
      hSW = this.averageHeight(kind, heightSelf, hS, hW, x - 1, y, z + 1);
    }

    // section local block origin of the fluid
    const lx = x - this.input.originX;
    const ly = y - this.input.originY;
    const lz = z - this.input.originZ;

    const tex = this.models.textureIndex.get(lava ? 'block/lava_still' : 'block/water_still') ?? 0;

    // tint: water uses the biome water colour (tint index 0), lava has no tint source
    let tr = 255;
    let tg = 255;
    let tb = 255;
    if (!lava) {
      const rgb = this.input.tints.tint(state, 0, x, this.input.originY + y, z);
      tr = clamp255(Math.round(rgb[0] * 255));
      tg = clamp255(Math.round(rgb[1] * 255));
      tb = clamp255(Math.round(rgb[2] * 255));
    }

    const offs = 0.001; // FluidRenderer: `float offs = 0.001F`
    const bottomOffs = renderDown ? offs : 0.0;
    const light = this.fluidLight(state, lava, x, y, z);

    // ---- top face (still sprite, full 0..16 texel square)
    if (renderUp) {
      const minCorner = Math.min(Math.min(hNW, hSW), Math.min(hSE, hNE));
      if (!this.fluidFaceOccludedByState(UP, minCorner, aboveState)) {
        hNW -= offs;
        hSW -= offs;
        hSE -= offs;
        hNE -= offs;
        const color = packVertexColor(1.0, CARDINAL_SHADE[UP], tr, tg, tb);
        const base = buf.beginQuad();
        buf.putVertex(base + 0, lx, ly + hNW, lz, 0, 0, tex, light, color);
        buf.putVertex(base + 1, lx, ly + hSW, lz + 1, 0, TEXEL16, tex, light, color);
        buf.putVertex(base + 2, lx + 1, ly + hSE, lz + 1, TEXEL16, TEXEL16, tex, light, color);
        buf.putVertex(base + 3, lx + 1, ly + hNE, lz, TEXEL16, 0, tex, light, color);
        buf.putQuadIndices(base);
      }
    }

    // ---- bottom face
    if (renderDown) {
      const belowLight = this.fluidLight(state, lava, x, y - 1, z);
      const color = packVertexColor(1.0, CARDINAL_SHADE[DOWN], tr, tg, tb);
      const base = buf.beginQuad();
      buf.putVertex(base + 0, lx, ly + bottomOffs, lz, 0, 0, tex, belowLight, color);
      buf.putVertex(base + 1, lx + 1, ly + bottomOffs, lz, TEXEL16, 0, tex, belowLight, color);
      buf.putVertex(base + 2, lx + 1, ly + bottomOffs, lz + 1, TEXEL16, TEXEL16, tex, belowLight, color);
      buf.putVertex(base + 3, lx, ly + bottomOffs, lz + 1, 0, TEXEL16, tex, belowLight, color);
      buf.putQuadIndices(base);
    }

    // ---- side faces, quarter sprite UVs like vanilla's flowing sprite sampling
    if (renderNorth) this.fluidSide(buf, NORTH, northState, hNW, hNE, lx, lz + offs, lx + 1, lz + offs, ly, tex, light, tr, tg, tb, bottomOffs);
    if (renderSouth) this.fluidSide(buf, SOUTH, southState, hSE, hSW, lx + 1, lz + 1 - offs, lx, lz + 1 - offs, ly, tex, light, tr, tg, tb, bottomOffs);
    if (renderWest) this.fluidSide(buf, WEST, westState, hSW, hNW, lx + offs, lz + 1, lx + offs, lz, ly, tex, light, tr, tg, tb, bottomOffs);
    if (renderEast) this.fluidSide(buf, EAST, eastState, hNE, hSE, lx + 1 - offs, lz, lx + 1 - offs, lz + 1, ly, tex, light, tr, tg, tb, bottomOffs);

    return true;
  }

  /**
   * One vertical fluid side, from (x0,z0)@h0 to (x1,z1)@h1 down to the cell bottom.
   * All coordinates are section local; vanilla insets the face by 0.001 so it does not z-fight
   * a neighbouring block.
   */
  private fluidSide(
    buf: QuadBuffer,
    dir: number,
    neighborState: number,
    h0: number,
    h1: number,
    x0: number,
    z0: number,
    x1: number,
    z1: number,
    ly: number,
    tex: number,
    light: number,
    tr: number,
    tg: number,
    tb: number,
    bottomOffs: number,
  ): void {
    if (this.fluidFaceOccludedByState(dir, Math.max(h0, h1), neighborState)) return;

    // `faceDir.getAxis() == Axis.Z ? cardinalLighting.north() : cardinalLighting.west()`
    const axisShade = DIRS[dir].axis === 2 ? CARDINAL_SHADE[NORTH] : CARDINAL_SHADE[WEST];
    const color = packVertexColor(1.0, CARDINAL_SHADE[UP] * axisShade, tr, tg, tb);
    const v0 = Math.round((1 - h0) * TEXEL8);
    const v1 = Math.round((1 - h1) * TEXEL8);

    const base = buf.beginQuad();
    buf.putVertex(base + 0, x0, ly + h0, z0, 0, v0, tex, light, color);
    buf.putVertex(base + 1, x1, ly + h1, z1, TEXEL8, v1, tex, light, color);
    buf.putVertex(base + 2, x1, ly + bottomOffs, z1, TEXEL8, TEXEL8, tex, light, color);
    buf.putVertex(base + 3, x0, ly + bottomOffs, z0, 0, TEXEL8, tex, light, color);
    buf.putQuadIndices(base);
  }

  /** layer the fluid at these world coordinates goes to (used by the standalone meshFluid) */
  fluidLayerOf(x: number, y: number, z: number): RenderLayer {
    return this.fluidKind(this.input.getState(x, y, z)) === 2 ? RenderLayer.SOLID : RenderLayer.TRANSLUCENT;
  }

  bufferFor(layer: RenderLayer): QuadBuffer {
    return this.out[layer];
  }

  /**
   * FluidRenderer.getLightCoords: the light of the fluid's own block position (no smoothing).
   * Lava is emissive: sky 0 / block 15 as required by the renderer contract.
   */
  private fluidLight(state: number, lava: boolean, x: number, y: number, z: number): number {
    if (lava) return packLight(15, 0);
    if (this.mc.isEmissive(state)) return FULL_BRIGHT;
    const block = this.input.getBlockLight(x, y, z);
    const sky = this.input.getSkyLight(x, y, z);
    return packLight(block > 15 ? 15 : block < 0 ? 0 : block, sky > 15 ? 15 : sky < 0 ? 0 : sky);
  }
}

// ---------------------------------------------------------------------------
// exported entry points
// ---------------------------------------------------------------------------

/** Meshes all 4096 blocks of a 16x16x16 section. */
export function meshSection(input: MeshInput): SectionMesh {
  return new SectionMesher(input).meshSection();
}

export interface FluidMesh {
  layer: RenderLayer;
  vertices: Uint8Array;
  indices: Uint32Array;
  quads: number;
}

/**
 * Meshes a single fluid block (water, lava, bubble column or a waterlogged block).
 * Returns null when the block holds no fluid or when every face is hidden.
 * `meshSection` calls the same code path internally.
 */
export function meshFluid(input: MeshInput, x: number, y: number, z: number): FluidMesh | null {
  const mesher = new SectionMesher(input);
  if (!mesher.meshFluidAt(x, y, z)) return null;
  const layer = mesher.fluidLayerOf(x, y, z);
  const buf = mesher.bufferFor(layer);
  return { layer, vertices: buf.finishVertices(), indices: buf.finishIndices(), quads: buf.quads };
}

export default meshSection;
