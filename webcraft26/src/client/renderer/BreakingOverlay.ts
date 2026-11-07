// Block breaking decal: the vanilla `destroy_stage_0..9` overlay drawn on the block's own
// model faces while the player mines it.
//
// Sources:
//   net/minecraft/client/resources/model/ModelBakery.java
//     DESTROY_STAGE_COUNT = 10, BREAKING_LOCATIONS = block/destroy_stage_<0..9>.png,
//     DESTROY_TYPES = RenderTypes.crumbling(texture)
//   net/minecraft/client/renderer/SubmitNodeStorage / ModelFeatureRenderer
//     `submitBreakingBlockModel(poseStack, parts, progress)` submits the block model parts with
//     a crumbling render type chosen by progress.
//   com/mojang/blaze3d/vertex/SheetedDecalTextureGenerator.java
//     replaces every model UV with a world-space decal UV derived from the vertex position and
//     the face direction.
//   net/minecraft/client/multiplayer/ClientLevel.java
//     destroyBlockProgress(id, pos, progress) with progress 0..9.
//
// The decal UV below is the planar (per face direction) projection of the world position: the
// same projection SheetedDecalTextureGenerator performs for axis-aligned block faces.
// The stage index is floor(progress * 10) clamped to 0..9 (ClientLevel only accepts < 10).

import { GlProgram } from './gl/Gl.js';
import { HAND_FRAG, HAND_VERT } from './hand/HandShaders.js';
import { directionNormal } from './hand/Mesh.js';
import type { MinecraftData } from '../../vanilla/world/level/block/state/BlockState.js';
import type { ModelSource } from './model/ModelSource.js';
import type { TextureManager } from './TextureManager.js';
import type { ClientLevel } from '../../vanilla/world/level/ClientLevel.js';
import type { Camera } from './LevelRenderer.js';

const STAGE_COUNT = 10;
const VERTEX_FLOATS = 9;
const VERTEX_BYTES = VERTEX_FLOATS * 4;

export interface BreakingHit { x: number; y: number; z: number; }

export class BreakingOverlay {
  private readonly program: GlProgram;
  private destroyTex: WebGLTexture | null = null;
  private vao: WebGLVertexArrayObject | null = null;
  private vbo: WebGLBuffer | null = null;
  private ibo: WebGLBuffer | null = null;
  private capacityQuads = 0;

  constructor(
    private readonly gl: WebGL2RenderingContext,
    private readonly mc: MinecraftData,
    private readonly models: ModelSource,
    private readonly textures: TextureManager,
  ) {
    this.program = new GlProgram(gl, HAND_VERT, HAND_FRAG, 'breaking');
  }

  async init(): Promise<void> {
    const gl = this.gl;
    const tex = gl.createTexture()!;
    gl.bindTexture(gl.TEXTURE_2D_ARRAY, tex);
    gl.texStorage3D(gl.TEXTURE_2D_ARRAY, 1, gl.RGBA8, 16, 16, STAGE_COUNT);
    for (let i = 0; i < STAGE_COUNT; i++) {
      const img = await this.textures.image(`block/destroy_stage_${i}`);
      gl.texSubImage3D(gl.TEXTURE_2D_ARRAY, 0, 0, 0, i, 16, 16, 1, gl.RGBA, gl.UNSIGNED_BYTE, img);
    }
    gl.texParameteri(gl.TEXTURE_2D_ARRAY, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
    gl.texParameteri(gl.TEXTURE_2D_ARRAY, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
    gl.texParameteri(gl.TEXTURE_2D_ARRAY, gl.TEXTURE_MIN_FILTER, gl.NEAREST);
    gl.texParameteri(gl.TEXTURE_2D_ARRAY, gl.TEXTURE_MAG_FILTER, gl.NEAREST);
    this.destroyTex = tex;

    this.vao = gl.createVertexArray()!;
    gl.bindVertexArray(this.vao);
    this.vbo = gl.createBuffer()!;
    gl.bindBuffer(gl.ARRAY_BUFFER, this.vbo);
    this.ibo = gl.createBuffer()!;
    gl.bindBuffer(gl.ELEMENT_ARRAY_BUFFER, this.ibo);
    gl.enableVertexAttribArray(0);
    gl.vertexAttribPointer(0, 3, gl.FLOAT, false, VERTEX_BYTES, 0);
    gl.enableVertexAttribArray(1);
    gl.vertexAttribPointer(1, 2, gl.FLOAT, false, VERTEX_BYTES, 12);
    gl.enableVertexAttribArray(2);
    gl.vertexAttribPointer(2, 1, gl.FLOAT, false, VERTEX_BYTES, 20);
    gl.enableVertexAttribArray(3);
    gl.vertexAttribPointer(3, 3, gl.FLOAT, false, VERTEX_BYTES, 24);
    gl.bindVertexArray(null);
  }

  /**
   * Draws the crack overlay for `state` at `hit` (block coordinates). `progress` is
   * SurvivalState.breaking.progress (0..1). Called before the hand pass, with the world
   * view-projection matrix from LevelRenderer.
   */
  render(
    level: ClientLevel,
    camera: Camera,
    viewProj: Float32Array,
    hit: BreakingHit,
    state: number,
    progress: number,
  ): void {
    if (!this.destroyTex || !this.vao || progress <= 0) return;
    const gl = this.gl;

    const stage = Math.min(STAGE_COUNT - 1, Math.floor(progress * STAGE_COUNT));
    const modelCount = this.mc.modelCount[state];
    if (!modelCount) return;
    const modelOffset = this.mc.modelOffset[state];

    const verts: number[] = [];
    const indices: number[] = [];
    let base = 0;
    for (let k = 0; k < modelCount; k++) {
      const modelId = this.mc.modelIds[modelOffset + k];
      if (modelId === undefined) continue;
      const model = this.models.getModel(modelId);
      for (const q of model.quads) {
        const normal = directionNormal(q.dir);
        for (let v = 0; v < 4; v++) {
          const px = q.p[v * 3], py = q.p[v * 3 + 1], pz = q.p[v * 3 + 2];
          // Push the decal 0.002 blocks out of the block face to avoid z-fighting.
          verts.push(
            hit.x + px + normal[0] * 0.002,
            hit.y + py + normal[1] * 0.002,
            hit.z + pz + normal[2] * 0.002,
            decalU(px, py, pz, q.dir),
            decalV(px, py, pz, q.dir),
            stage,
            normal[0], normal[1], normal[2],
          );
        }
        indices.push(base, base + 1, base + 2, base, base + 2, base + 3);
        base += 4;
      }
    }
    if (!indices.length) return;

    gl.bindVertexArray(this.vao);
    gl.bindBuffer(gl.ARRAY_BUFFER, this.vbo);
    gl.bufferData(gl.ARRAY_BUFFER, new Float32Array(verts), gl.DYNAMIC_DRAW);
    gl.bindBuffer(gl.ELEMENT_ARRAY_BUFFER, this.ibo);
    gl.bufferData(gl.ELEMENT_ARRAY_BUFFER, new Uint32Array(indices), gl.DYNAMIC_DRAW);

    this.program.use();
    this.program.setMat4('uProjModel', viewProj);
    this.program.set1i('uMode', 3);
    this.program.set1f('uAlphaTest', 0.1);
    this.program.set4f('uColor', 1, 1, 1, 1);
    // Unused by mode 3 but keep the samplers bound to something valid.
    gl.activeTexture(gl.TEXTURE0);
    gl.bindTexture(gl.TEXTURE_2D, this.textures.lightmap);
    this.program.set1i('uTex2D', 0);
    gl.activeTexture(gl.TEXTURE1);
    gl.bindTexture(gl.TEXTURE_2D_ARRAY, this.destroyTex);
    this.program.set1i('uAtlas', 1);
    gl.activeTexture(gl.TEXTURE2);
    gl.bindTexture(gl.TEXTURE_2D, this.textures.lightmap);
    this.program.set1i('uLightmap', 2);
    this.program.set2f('uLightLevel', 15, 15);
    const normalLoc = this.program.uniform('uNormalMat');
    if (normalLoc) gl.uniformMatrix3fv(normalLoc, false, IDENTITY3);
    this.program.set3f('uLight0', 0, 0, 0);
    this.program.set3f('uLight1', 0, 0, 0);

    gl.enable(gl.DEPTH_TEST);
    gl.depthFunc(gl.LEQUAL);
    gl.depthMask(true);
    gl.enable(gl.CULL_FACE);
    gl.cullFace(gl.BACK);
    gl.enable(gl.BLEND);
    gl.blendFunc(gl.SRC_ALPHA, gl.ONE_MINUS_SRC_ALPHA);

    gl.drawElements(gl.TRIANGLES, indices.length, gl.UNSIGNED_INT, 0);

    gl.disable(gl.BLEND);
    gl.depthMask(true);
    void level;
    void camera;
  }
}

const IDENTITY3 = new Float32Array([1, 0, 0, 0, 1, 0, 0, 0, 1]);

/** Planar decal U for a face direction (see SheetedDecalTextureGenerator). */
function decalU(px: number, py: number, pz: number, dir: number): number {
  switch (dir) {
    case 0: return px;                    // DOWN
    case 1: return px;                    // UP
    case 2: return 1 - px;                // NORTH
    case 3: return px;                    // SOUTH
    case 4: return pz;                    // WEST
    default: return 1 - pz;               // EAST
  }
}

/** Planar decal V for a face direction; side faces use 1 - y so the cracks read upright. */
function decalV(px: number, py: number, pz: number, dir: number): number {
  switch (dir) {
    case 0: return pz;                    // DOWN
    case 1: return 1 - pz;                // UP
    default: return 1 - py;               // NORTH/SOUTH/WEST/EAST
  }
}
