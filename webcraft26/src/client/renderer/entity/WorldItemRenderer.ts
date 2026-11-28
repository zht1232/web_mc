// World-space dropped block items — the 3D half of ItemEntityRenderer.
//
// Source (26.2):
//   net/minecraft/client/renderer/entity/ItemEntityRenderer.submit
//     bob = sin(ageInTicks / 10 + bobOffs) * 0.1 + 0.1
//     minOffsetY = -modelBounds.minY + ITEM_MIN_HOVER_HEIGHT
//     pose = T(0, bob + minOffsetY, 0) * RY(ItemEntity.getSpin(age, bobOffs))
//   ...submitMultipleFromCount: modelDepth = bounds.zSize; when > 1/16 the stack
//     draws the full model once, then (amount - 1) copies with a seeded
//     +-0.15 random xyz offset (flat sprites use the Z spread instead).
//   net/minecraft/client/renderer/item/ItemStackRenderState.LayerRenderState
//     applyTransform = ItemTransform.apply(GROUND) * localTransform
//   net/minecraft/client/resources/model/cuboid/ItemTransform.apply
//     translate(translation / 16) * rotationXYZ * scale * translate(-0.5)
//   net/minecraft/client/renderer/ItemRenderer / Lighting.Entry.LEVEL
//     lightAccum = min(1, (max(0,dot(L0,N)) + max(0,dot(L1,N))) * 0.6 + 0.4)
//
// Geometry comes from the same baked block models (models.bin) and block texture
// array the terrain/hand passes use, so a dropped stone block is the real cube
// with its ground pose (0.25 scale), not the GUI icon sprite.
//
// The caller (EntityRenderDispatcher) runs this right after the batched entity
// draw and before entity shadows, so drops share the vanilla render order.

import { GlProgram } from '../gl/Gl.js';
import { Mat4Stack, mat4, normalMatrix, rotateQuat, type Mat4 } from '../hand/Mat4.js';
import { buildBlockMesh, type MeshData } from '../hand/Mesh.js';
import { tintOfSource } from '../hand/HandRenderer.js';
import { WORLD_ITEM_VERT, WORLD_ITEM_FRAG } from './EntityShaders.js';
import { renderedItemAmount } from './ItemEntityRenderer.js';
import type { Entity } from '../../../vanilla/world/entity/Entity.js';
import type { ItemEntity } from '../../../vanilla/world/entity/item/ItemEntity.js';
import type { MinecraftData } from '../../../vanilla/world/level/block/state/BlockState.js';
import type { ModelSource } from '../model/ModelSource.js';
import type { TextureManager } from '../TextureManager.js';
import { LegacyRandomSource } from '../../../vanilla/core/Random.js';

type Rgb = [number, number, number];

interface ItemTintSource { type: string; value?: number; }

/** A `transformation` node from itemmodels.json (com.mojang.math.Transformation). */
interface ItemTransformation {
  translation?: number[];
  left_rotation?: number[];
  scale?: number[];
  right_rotation?: number[];
}

interface ItemLayerEntry {
  kind: string;
  model?: number;
  modelLoc?: string;
  tints?: ItemTintSource[];
  transformation?: ItemTransformation;
}

interface ItemEntry extends ItemLayerEntry {
  parts?: ItemLayerEntry[];
}

/** ItemTransform values are the raw JSON numbers (translation in 1/16 block units). */
interface GroundTransform { rotation: number[]; translation: number[]; scale: number[]; }

/** The fog values the entity pass already computed for this frame. */
export interface WorldItemFog {
  color: readonly [number, number, number];
  envStart: number;
  envEnd: number;
  renderStart: number;
  renderEnd: number;
}

interface GpuPart {
  vao: WebGLVertexArrayObject;
  vbo: WebGLBuffer;
  ibo: WebGLBuffer;
  count: number;
  tint?: Rgb;
  /** per-model GROUND display transform (block/block -> 0.25 scale) */
  ground: GroundTransform | null;
  /** the layer's `transformation` matrix (bed foot translate(0,0,1)) */
  local: Mat4 | null;
}

interface GpuItem {
  parts: GpuPart[];
  /** model bounding box (ItemStackRenderState.getModelBoundingBox) */
  minY: number;
  zSize: number;
}

const WHITE: Rgb = [1, 1, 1];
const ITEM_MIN_HOVER_HEIGHT = 0.0625;   // ItemEntityRenderer.ITEM_MIN_HOVER_HEIGHT
const FLAT_DEPTH_THRESHOLD = 0.0625;    // ItemEntityRenderer.FLAT_ITEM_DEPTH_THRESHOLD
const ITEM_BUNDLE_OFFSET_SCALE = 0.15;  // ItemEntityRenderer.ITEM_BUNDLE_OFFSET_SCALE
const LEVEL_LIGHT_0 = normalize3(0.2, 1.0, -0.7);
const LEVEL_LIGHT_1 = normalize3(-0.2, 1.0, 0.7);
/**
 * block/block display ground (assets/minecraft/models/block/block.json, 26.2):
 * rotation 0, translation 3/16, scale 0.25. Used only when display.json predates the
 * `grounds` bake, so a stale generated asset still draws drops at the right size.
 */
const BLOCK_GROUND_FALLBACK: GroundTransform = {
  rotation: [0, 0, 0], translation: [0, 3, 0], scale: [0.25, 0.25, 0.25],
};

function normalize3(x: number, y: number, z: number): [number, number, number] {
  const len = Math.hypot(x, y, z) || 1;
  return [x / len, y / len, z / len];
}

/** Transformation.compose: translate * leftRotation * scale * rightRotation. */
function transformationMatrix(t: ItemTransformation): Mat4 {
  const m = mat4();
  const tr = t.translation ?? [0, 0, 0];
  m[12] = tr[0]; m[13] = tr[1]; m[14] = tr[2];
  const lq = t.left_rotation;
  if (lq && !isIdentityQuat(lq)) rotateQuat(m, lq[0], lq[1], lq[2], lq[3]);
  const s = t.scale ?? [1, 1, 1];
  m[0] *= s[0]; m[1] *= s[0]; m[2] *= s[0]; m[3] *= s[0];
  m[4] *= s[1]; m[5] *= s[1]; m[6] *= s[1]; m[7] *= s[1];
  m[8] *= s[2]; m[9] *= s[2]; m[10] *= s[2]; m[11] *= s[2];
  const rq = t.right_rotation;
  if (rq && !isIdentityQuat(rq)) rotateQuat(m, rq[0], rq[1], rq[2], rq[3]);
  return m;
}

function isIdentityQuat(q: number[]): boolean {
  return q[0] === 0 && q[1] === 0 && q[2] === 0 && q[3] === 1;
}

/** ItemTransform.apply + localTransform, exactly the order drawItem uses. */
function applyLayerPose(stack: Mat4Stack, ground: GroundTransform | null, local: Mat4 | null): void {
  if (ground) {
    stack.translate(
      ground.translation[0] * 0.0625,
      ground.translation[1] * 0.0625,
      ground.translation[2] * 0.0625,
    );
    stack.rotateXYZ(ground.rotation[0], ground.rotation[1], ground.rotation[2]);
    stack.scale(ground.scale[0], ground.scale[1], ground.scale[2]);
  }
  stack.translate(-0.5, -0.5, -0.5);
  if (local) stack.mul(local);
}

export class WorldItemRenderer {
  private readonly program: GlProgram;
  private readonly stack = new Mat4Stack();
  private readonly boundsStack = new Mat4Stack();
  private readonly normalMat = new Float32Array(9);
  private readonly items = new Map<number, GpuItem | null>();
  private entries: Record<string, ItemEntry> = {};
  private readonly grounds = new Map<string, GroundTransform>();

  /** Probe counters for scripts/test-item-entity.mjs (drops drawn this frame). */
  lastItemCount = 0;
  lastCopyCount = 0;

  constructor(
    private readonly gl: WebGL2RenderingContext,
    private readonly mc: MinecraftData,
    private readonly models: ModelSource,
    private readonly textures: TextureManager,
  ) {
    this.program = new GlProgram(gl, WORLD_ITEM_VERT, WORLD_ITEM_FRAG, 'worldItem');
  }

  async init(base = '/mc'): Promise<void> {
    const [itemsRes, displayRes] = await Promise.all([
      fetch(`${base}/itemmodels.json`),
      fetch(`${base}/hand/display.json`),
    ]);
    if (itemsRes.ok) {
      const json = (await itemsRes.json()) as { items: Record<string, ItemEntry> };
      this.entries = json.items;
    }
    if (displayRes.ok) {
      const json = (await displayRes.json()) as { grounds?: Record<string, GroundTransform> };
      for (const [loc, t] of Object.entries(json.grounds ?? {})) this.grounds.set(loc, t);
    }
  }

  private entryOf(itemId: number): ItemEntry | null {
    const name = this.mc.items[itemId]?.name;
    if (!name) return null;
    return this.entries[`minecraft:${name}`] ?? null;
  }

  /**
   * True when the item is drawn from baked block geometry here, so the icon
   * sprite path in ItemEntityRenderer must skip it (blocks + composite beds).
   */
  isBlockItem(itemId: number): boolean {
    const entry = this.entryOf(itemId);
    if (!entry) return false;
    if (entry.kind === 'block') return entry.model !== undefined;
    if (entry.kind === 'composite') {
      return (entry.parts ?? []).some((p) => p.kind === 'block' && p.model !== undefined);
    }
    return false;
  }

  private ensureItem(itemId: number): GpuItem | null {
    if (this.items.has(itemId)) return this.items.get(itemId) ?? null;
    const entry = this.entryOf(itemId);
    const layers = entry
      ? (entry.kind === 'composite' ? (entry.parts ?? []) : [entry])
      : [];
    const parts: GpuPart[] = [];
    let minY = Infinity, maxY = -Infinity, minZ = Infinity, maxZ = -Infinity;

    for (const layer of layers) {
      if (layer.kind !== 'block' || layer.model === undefined) continue;
      const model = this.models.getModel(layer.model);
      if (model.quads.length === 0) continue;
      const ground = layer.modelLoc ? this.grounds.get(layer.modelLoc) ?? null : null;
      const groundPose = ground ?? (this.grounds.size === 0 ? BLOCK_GROUND_FALLBACK : null);
      const local = layer.transformation ? transformationMatrix(layer.transformation) : null;

      // Bounds = the layer's model AABB transformed by GROUND * localTransform
      // (ItemStackRenderState.submit: extents.mulPosition(poseTransform)).
      const pose = this.boundsStack.reset();
      applyLayerPose(pose, groundPose, local);
      const pm = pose.top;
      for (let q = 0; q < model.quads.length; q++) {
        const p = model.quads[q].p;
        for (let v = 0; v < 12; v += 3) {
          const tx = pm[0] * p[v] + pm[4] * p[v + 1] + pm[8] * p[v + 2] + pm[12];
          const ty = pm[1] * p[v] + pm[5] * p[v + 1] + pm[9] * p[v + 2] + pm[13];
          const tz = pm[2] * p[v] + pm[6] * p[v + 1] + pm[10] * p[v + 2] + pm[14];
          if (ty < minY) minY = ty;
          if (ty > maxY) maxY = ty;
          if (tz < minZ) minZ = tz;
          if (tz > maxZ) maxZ = tz;
        }
      }

      // One mesh per tint index so grass_block's overlay keeps its colour.
      const indices = [...new Set(model.quads.map((q) => q.tint))];
      for (const idx of indices) {
        const sub = { ...model, quads: model.quads.filter((q) => q.tint === idx) };
        const part = this.upload(buildBlockMesh(sub));
        if (idx >= 0) part.tint = tintOfSource(layer.tints?.[idx]) ?? WHITE;
        part.ground = groundPose;
        part.local = local;
        parts.push(part);
      }
    }

    if (parts.length === 0) {
      this.items.set(itemId, null);
      return null;
    }
    const gpu: GpuItem = {
      parts,
      minY: minY === Infinity ? 0 : minY,
      zSize: maxZ === Infinity ? 0 : maxZ - minZ,
    };
    this.items.set(itemId, gpu);
    return gpu;
  }

  private upload(mesh: MeshData): GpuPart {
    const gl = this.gl;
    const vao = gl.createVertexArray()!;
    gl.bindVertexArray(vao);
    const vbo = gl.createBuffer()!;
    gl.bindBuffer(gl.ARRAY_BUFFER, vbo);
    gl.bufferData(gl.ARRAY_BUFFER, mesh.vertices, gl.STATIC_DRAW);
    const ibo = gl.createBuffer()!;
    gl.bindBuffer(gl.ELEMENT_ARRAY_BUFFER, ibo);
    gl.bufferData(gl.ELEMENT_ARRAY_BUFFER, mesh.indices, gl.STATIC_DRAW);
    gl.enableVertexAttribArray(0);
    gl.vertexAttribPointer(0, 3, gl.FLOAT, false, 36, 0);
    gl.enableVertexAttribArray(1);
    gl.vertexAttribPointer(1, 2, gl.FLOAT, false, 36, 12);
    gl.enableVertexAttribArray(2);
    gl.vertexAttribPointer(2, 1, gl.FLOAT, false, 36, 20);
    gl.enableVertexAttribArray(3);
    gl.vertexAttribPointer(3, 3, gl.FLOAT, false, 36, 24);
    gl.bindVertexArray(null);
    return { vao, vbo, ibo, count: mesh.indices.length, ground: null, local: null };
  }

  /** Draws every dropped block item in `entities` (call after the entity pass). */
  render(
    entities: Iterable<Entity>,
    viewProj: Float32Array,
    camera: { x: number; y: number; z: number },
    partialTick: number,
    fog: WorldItemFog,
    renderDistance = 96,
  ): void {
    this.lastItemCount = 0;
    this.lastCopyCount = 0;
    const gl = this.gl;
    const maxDist2 = renderDistance * renderDistance;

    let any = false;
    const program = this.program;
    for (const e of entities) {
      if (e.isRemoved() || e.getTypeName() !== 'item') continue;
      const dx = e.x - camera.x, dy = e.y - camera.y, dz = e.z - camera.z;
      if (dx * dx + dy * dy + dz * dz > maxDist2) continue;
      const item = e as ItemEntity;
      const stack = item.getItem();
      if (!stack || stack.isEmpty() || !stack.item) continue;
      const gpu = this.ensureItem(stack.item.id);
      if (!gpu) continue;
      if (!any) {
        any = true;
        program.use();
        program.setMat4('uViewProj', viewProj);
        program.set1i('uAtlas', 0);
        program.set1i('uLightmap', 1);
        program.set3f('uLight0', LEVEL_LIGHT_0[0], LEVEL_LIGHT_0[1], LEVEL_LIGHT_0[2]);
        program.set3f('uLight1', LEVEL_LIGHT_1[0], LEVEL_LIGHT_1[1], LEVEL_LIGHT_1[2]);
        program.set1f('uAlphaTest', 0.1);
        program.set3f('uFogColor', fog.color[0], fog.color[1], fog.color[2]);
        program.set1f('uFogEnvStart', fog.envStart);
        program.set1f('uFogEnvEnd', fog.envEnd);
        program.set1f('uFogRenderStart', fog.renderStart);
        program.set1f('uFogRenderEnd', fog.renderEnd);
        program.set3f('uCameraPos', camera.x, camera.y, camera.z);
        // Every sampler must have a texture of its type bound at draw time.
        gl.activeTexture(gl.TEXTURE0);
        gl.bindTexture(gl.TEXTURE_2D_ARRAY, this.textures.block.texture);
        gl.activeTexture(gl.TEXTURE1);
        gl.bindTexture(gl.TEXTURE_2D, this.textures.lightmap);
        gl.activeTexture(gl.TEXTURE0);
      }
      this.drawItem(item, gpu, partialTick);
    }
    if (!any) return;

    // GL state contract of the entity pass: leave depthMask/cull/blend restored.
    gl.activeTexture(gl.TEXTURE0);
    gl.bindVertexArray(null);
    gl.disable(gl.BLEND);
    gl.enable(gl.CULL_FACE);
    gl.cullFace(gl.BACK);
    gl.depthMask(true);
  }

  private drawItem(item: ItemEntity, gpu: GpuItem, partialTick: number): void {
    const gl = this.gl;
    const program = this.program;
    const stack = item.getItem();
    if (!stack.item) return;
    const amount = renderedItemAmount(stack.getCount());
    const seed = stack.item.id + (stack.components.damage ?? 0);
    const random = new LegacyRandomSource(seed);

    const x = item.xo + (item.x - item.xo) * partialTick;
    const y = item.yo + (item.y - item.yo) * partialTick;
    const z = item.zo + (item.z - item.zo) * partialTick;
    const age = item.age + partialTick;
    const bob = Math.sin(age / 10 + item.bobOffs) * 0.1 + 0.1;
    const minOffsetY = -gpu.minY + ITEM_MIN_HOVER_HEIGHT;
    const spinDeg = ((age / 20 + item.bobOffs) * 180) / Math.PI;

    // EntityRenderer.getPackedLightCoords at getLightProbePosition (= eye position).
    const eyeHeight = item.getEyeY() - item.y;
    const lx = Math.floor(x);
    const ly = Math.floor(y + eyeHeight);
    const lz = Math.floor(z);
    let sky = item.level.getSkyLight(lx, ly, lz);
    let block = item.level.getBlockLight(lx, ly, lz);
    if (item.isOnFire()) block = 15;
    program.set2f('uLightLevel', sky, block);

    // 3D models: one model at the base pose + (amount-1) copies with random xyz offsets.
    // Models thinner than 1/16 (chain, ...) use the vanilla flat branch: copies spread
    // along the model's local Z by zSize*1.5 with +-0.075 x/y jitter instead.
    const flatCluster = gpu.zSize <= FLAT_DEPTH_THRESHOLD;
    const offsetZ = gpu.zSize * 1.5;
    const copies = amount;
    this.lastItemCount++;
    this.lastCopyCount += copies;

    for (let i = 0; i < copies; i++) {
      let ox = 0, oy = 0, oz = 0;
      if (i > 0) {
        if (flatCluster) {
          ox = (random.nextFloat() * 2 - 1) * ITEM_BUNDLE_OFFSET_SCALE * 0.5;
          oy = (random.nextFloat() * 2 - 1) * ITEM_BUNDLE_OFFSET_SCALE * 0.5;
        } else {
          ox = (random.nextFloat() * 2 - 1) * ITEM_BUNDLE_OFFSET_SCALE;
          oy = (random.nextFloat() * 2 - 1) * ITEM_BUNDLE_OFFSET_SCALE;
          oz = (random.nextFloat() * 2 - 1) * ITEM_BUNDLE_OFFSET_SCALE;
        }
      }
      const clusterZ = flatCluster ? offsetZ * (i - (copies - 1) / 2) : 0;
      for (const part of gpu.parts) {
        this.stack.reset();
        this.stack.translate(x + ox, y + bob + minOffsetY + oy, z + oz);
        this.stack.rotateY(spinDeg);
        if (clusterZ !== 0) this.stack.translate(0, 0, clusterZ);
        applyLayerPose(this.stack, part.ground, part.local);

        program.setMat4('uModel', this.stack.top);
        normalMatrix(this.normalMat, this.stack.top);
        const loc = program.uniform('uNormalMat');
        if (loc) gl.uniformMatrix3fv(loc, false, this.normalMat);
        const tint = part.tint ?? WHITE;
        program.set3f('uColor', tint[0], tint[1], tint[2]);

        gl.enable(gl.DEPTH_TEST);
        gl.depthFunc(gl.LEQUAL);
        gl.depthMask(true);
        gl.enable(gl.CULL_FACE);
        gl.cullFace(gl.BACK);
        gl.enable(gl.BLEND);
        gl.blendFunc(gl.SRC_ALPHA, gl.ONE_MINUS_SRC_ALPHA);
        gl.bindVertexArray(part.vao);
        gl.drawElements(gl.TRIANGLES, part.count, gl.UNSIGNED_INT, 0);
      }
    }
  }
}
