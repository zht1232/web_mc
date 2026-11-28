// Source: net.minecraft.client.renderer.entity.layers.ItemInHandLayer
//
// Humanoid mobs hold the REAL item model, not a bespoke box shape:
//   pose = translateToHand(right arm)            (HumanoidModel / SkeletonModel)
//        * RX(-90) * RY(180)                     (ItemInHandLayer.submitArmWithItem)
//        * T(1/16, 2/16, -10/16)
//        * ItemTransform.apply(THIRD_PERSON_RIGHT_HAND)  (bow: rot -80/260/-40, scale 0.9)
//        * translate(-0.5, -0.5, -0.5)
//
// The mesh is ItemModelGenerator's extruded sprite (hand/Mesh.ts buildFlatMesh) drawn
// from the item texture array, so a held bow is the vanilla 16x16 sprite with its real
// display pose instead of the old hand-built bow. Entities with a held stack are
// collected by EntityRenderDispatcher from the arm matrix the body model captured.
//
// Position/lighting/fog reuse the world-space item program (EntityShaders.WORLD_ITEM_*),
// the same one dropped block items use.

import { GlProgram } from '../gl/Gl.js';
import { Mat4Stack, normalMatrix, translate, rotateX, rotateY, rotateXYZ, scale } from '../hand/Mat4.js';
import { buildFlatMesh, type MeshData, type SpriteAlpha } from '../hand/Mesh.js';
import { WORLD_ITEM_VERT, WORLD_ITEM_FRAG } from './EntityShaders.js';
import type { WorldItemFog } from './WorldItemRenderer.js';
import type { TextureManager } from '../TextureManager.js';
import type { Entity } from '../../../vanilla/world/entity/Entity.js';

interface ItemLayer {
  texture: string;
  array?: 'block' | 'item';
  tint?: number;
}

interface ItemEntry {
  kind: string;
  modelLoc?: string;
  layers?: ItemLayer[];
}

interface DisplayTransform {
  rotation: number[];
  translation: number[];
  scale: number[];
}

interface GpuPart {
  vao: WebGLVertexArrayObject;
  vbo: WebGLBuffer;
  ibo: WebGLBuffer;
  count: number;
  tint?: readonly [number, number, number];
}

const WHITE: readonly [number, number, number] = [1, 1, 1];

function rgbOfArgb(argb: number): readonly [number, number, number] {
  return [((argb >> 16) & 255) / 255, ((argb >> 8) & 255) / 255, (argb & 255) / 255];
}

/** Writes the captured 3x4 row-major arm matrix into a column-major Mat4. */
function handMatrixToMat4(out: Float32Array, m: Float64Array): void {
  out[0] = m[0]; out[1] = m[4]; out[2] = m[8]; out[3] = 0;
  out[4] = m[1]; out[5] = m[5]; out[6] = m[9]; out[7] = 0;
  out[8] = m[2]; out[9] = m[6]; out[10] = m[10]; out[11] = 0;
  out[12] = m[3]; out[13] = m[7]; out[14] = m[11]; out[15] = 1;
}

export class HeldItemRenderer {
  private readonly program: GlProgram;
  private entries: Record<string, ItemEntry> = {};
  private readonly thirdPerson = new Map<string, DisplayTransform>();
  /** item name ("minecraft:bow") -> uploaded flat mesh (null = not drawable). */
  private readonly meshes = new Map<string, GpuPart | null>();
  private readonly pending = new Set<string>();
  private readonly spriteAlpha = new Map<string, Promise<SpriteAlpha | null>>();
  private readonly stack = new Mat4Stack();
  private readonly normalMat = new Float32Array(9);

  /** Probe counter: held items drawn in the last frame. */
  lastHeldCount = 0;

  constructor(
    private readonly gl: WebGL2RenderingContext,
    private readonly textures: TextureManager,
  ) {
    this.program = new GlProgram(gl, WORLD_ITEM_VERT, WORLD_ITEM_FRAG, 'heldItem');
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
      const json = (await displayRes.json()) as {
        thirdPerson?: Record<string, DisplayTransform>;
      };
      for (const [loc, t] of Object.entries(json.thirdPerson ?? {})) this.thirdPerson.set(loc, t);
    }
  }

  /**
   * Draws one item model per collected hand.
   * `matrices` holds 12 floats (the right-arm pivot, row-major 3x4) per entity.
   */
  render(
    entities: readonly Entity[],
    matrices: Float64Array,
    count: number,
    viewProj: Float32Array,
    camera: { x: number; y: number; z: number },
    partialTick: number,
    fog: WorldItemFog,
    renderDistance = 96,
  ): void {
    this.lastHeldCount = 0;
    if (count <= 0) return;
    const gl = this.gl;
    const program = this.program;
    const maxDist2 = renderDistance * renderDistance;
    let any = false;

    for (let i = 0; i < count; i++) {
      const e = entities[i];
      if (!e || e.isRemoved()) continue;
      const dx = e.x - camera.x, dy = e.y - camera.y, dz = e.z - camera.z;
      if (dx * dx + dy * dy + dz * dz > maxDist2) continue;
      const name = heldItemName(e);
      if (!name) continue;
      const part = this.ensureMesh(name);
      if (!part) continue;

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
        gl.activeTexture(gl.TEXTURE0);
        gl.bindTexture(gl.TEXTURE_2D_ARRAY, this.textures.item.texture);
        gl.activeTexture(gl.TEXTURE1);
        gl.bindTexture(gl.TEXTURE_2D, this.textures.lightmap);
        gl.activeTexture(gl.TEXTURE0);
      }

      // Light: EntityRenderer.getPackedLightCoords at the entity's eye position.
      const eyeX = Math.floor(e.x), eyeY = Math.floor(e.getEyeY()), eyeZ = Math.floor(e.z);
      let sky = e.level.getSkyLight(eyeX, eyeY, eyeZ);
      let block = e.level.getBlockLight(eyeX, eyeY, eyeZ);
      if (e.isOnFire()) block = 15;
      program.set2f('uLightLevel', sky, block);

      // ItemInHandLayer.submitArmWithItem: translateToHand -> RX(-90) -> RY(180) -> hand offset.
      const m = this.stack.reset().top;
      handMatrixToMat4(m, matrices.subarray(i * 12, i * 12 + 12));
      rotateX(m, -90);
      rotateY(m, 180);
      translate(m, 1 / 16, 2 / 16, -10 / 16);
      // ItemTransform.apply(THIRD_PERSON_RIGHT_HAND) then translate(-0.5, -0.5, -0.5).
      const entry = this.entries[name];
      const t = entry?.modelLoc ? this.thirdPerson.get(entry.modelLoc) : undefined;
      if (t) {
        translate(m, t.translation[0] * 0.0625, t.translation[1] * 0.0625, t.translation[2] * 0.0625);
        rotateXYZ(m, t.rotation[0], t.rotation[1], t.rotation[2]);
        scale(m, t.scale[0], t.scale[1], t.scale[2]);
      }
      translate(m, -0.5, -0.5, -0.5);

      program.setMat4('uModel', m);
      normalMatrix(this.normalMat, m);
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
      this.lastHeldCount++;
    }

    if (!any) return;
    // Restore the GL state contract the entity pass expects after an extra pass.
    gl.activeTexture(gl.TEXTURE0);
    gl.bindVertexArray(null);
    gl.disable(gl.BLEND);
    gl.enable(gl.CULL_FACE);
    gl.cullFace(gl.BACK);
    gl.depthMask(true);
  }

  /** Resolves and caches the flat item mesh; returns null until the sprite alpha loads. */
  private ensureMesh(name: string): GpuPart | null {
    if (this.meshes.has(name)) return this.meshes.get(name) ?? null;
    if (this.pending.has(name)) return null;
    const entry = this.entries[name];
    const layer = entry?.layers?.[0];
    if (!entry || entry.kind !== 'flat' || !layer) {
      this.meshes.set(name, null);
      return null;
    }
    this.pending.add(name);
    void this.buildFlat(name, entry, layer).then((part) => {
      this.meshes.set(name, part);
      this.pending.delete(name);
    }).catch(() => {
      this.meshes.set(name, null);
      this.pending.delete(name);
    });
    return null;
  }

  private async buildFlat(name: string, entry: ItemEntry, layer: ItemLayer): Promise<GpuPart | null> {
    const array = (layer.array ?? 'item') === 'block' ? 'block' : 'item';
    const layerIndex = array === 'block'
      ? this.textures.blockTextureLayer(layer.texture)
      : this.textures.itemTextureLayer(layer.texture);
    if (layerIndex < 0) return null;
    const alpha = await this.spriteAlphaOf(layer.texture);
    const part = this.upload(buildFlatMesh(layerIndex, alpha));
    if (layer.tint !== undefined && layer.tint !== -1) part.tint = rgbOfArgb(layer.tint | 0);
    return part;
  }

  /** Alpha plane of a flat sprite, used by ItemModelGenerator's extruded side faces. */
  private spriteAlphaOf(texture: string): Promise<SpriteAlpha | null> {
    const cached = this.spriteAlpha.get(texture);
    if (cached) return cached;
    const promise = (async () => {
      try {
        const img = await this.textures.image(texture);
        const canvas = document.createElement('canvas');
        canvas.width = img.width;
        canvas.height = img.height;
        const ctx = canvas.getContext('2d', { willReadFrequently: true })!;
        ctx.drawImage(img, 0, 0);
        const data = ctx.getImageData(0, 0, img.width, img.height).data;
        const alpha = new Uint8Array(img.width * img.height);
        for (let i = 0; i < alpha.length; i++) alpha[i] = data[i * 4 + 3];
        return { width: img.width, height: img.height, alpha };
      } catch {
        return null;
      }
    })();
    this.spriteAlpha.set(texture, promise);
    return promise;
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
    return { vao, vbo, ibo, count: mesh.indices.length };
  }
}

/** Main-hand item name ("minecraft:bow") of a mob, or "" when empty (plain or ItemStack). */
function heldItemName(e: Entity): string {
  const stack = (e as unknown as {
    getMainHandItem?: () => { id?: string; item?: { namespacedId?: string } | null } | null;
  }).getMainHandItem?.();
  if (!stack) return '';
  if (stack.item) return stack.item.namespacedId ?? '';
  return stack.id ?? '';
}

// Lighting.java LEVEL entry, shared with the dropped-item pass.
const LEVEL_LIGHT_0 = normalize3(0.2, 1.0, -0.7);
const LEVEL_LIGHT_1 = normalize3(-0.2, 1.0, 0.7);

function normalize3(x: number, y: number, z: number): readonly [number, number, number] {
  const len = Math.hypot(x, y, z) || 1;
  return [x / len, y / len, z / len];
}
