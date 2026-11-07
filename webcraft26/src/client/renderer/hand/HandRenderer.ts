// First-person view: Steve's right arm, the held item / block and the screen effects that
// belong to the hand pass, ported 1:1 from 26.2.
//
// Ported from:
//   net/minecraft/client/renderer/ItemInHandRenderer.java
//     renderPlayerArm / applyItemArmTransform / applyItemArmAttackTransform / swingArm /
//     submitArmWithItem / submitHandsWithItems / tick (equip animation)
//   net/minecraft/client/renderer/GameRenderer.java
//     renderItemInHand (bobHurt + bobView on the hand pose), hudProjection.setupPerspective(
//     0.05, 100, cameraState.hudFov, ...), clearDepthTexture before the hand
//   net/minecraft/client/Camera.java
//     calculateHudFov = modifyFovBasedOnDeathOrFluid(partial, 70) -> sprint FOV does NOT apply
//   net/minecraft/client/renderer/ScreenEffectRenderer.java
//     submitWater (misc/underwater.png, colour alpha 0.1 * brightness, 4x4 UV)
//   net/minecraft/client/resources/model/cuboid/ItemTransform.java
//     translation * 0.0625, rotationXYZ, scale, then translate(-0.5, -0.5, -0.5)
//   net/minecraft/client/renderer/item/ItemStackRenderState.java
//     LayerRenderState.applyTransform (item display transform + selector localTransform)
//
// All numbers below are copied from those files; see the line comments for the source.

import { GlProgram, mat4Perspective } from '../gl/Gl.js';
import {
  Mat4Stack, mat4, normalMatrix,
} from './Mat4.js';
import {
  ARM_PIVOT_BLOCKS, RIGHT_ARM_Z_ROT_DEG, buildBlockMesh, buildFlatMesh, buildPlayerArmMesh,
  type MeshData, type SpriteAlpha,
} from './Mesh.js';
import { HAND_FRAG, HAND_VERT } from './HandShaders.js';
import type { MinecraftData } from '../../../vanilla/world/level/block/state/BlockState.js';
import type { ModelSource } from '../model/ModelSource.js';
import type { TextureManager } from '../TextureManager.js';
import type { Player } from '../../../vanilla/world/entity/player/Player.js';
import type { ClientLevel } from '../../../vanilla/world/level/ClientLevel.js';
import type { SurvivalState } from '../../../vanilla/gameplay/SurvivalState.js';
import type { Camera } from '../LevelRenderer.js';

// ItemInHandRenderer.java constants (verbatim names, values 1:1)
const ITEM_SWING_X_POS_SCALE = -0.4;
const ITEM_SWING_Y_POS_SCALE = 0.2;
const ITEM_SWING_Z_POS_SCALE = -0.2;
const ITEM_HEIGHT_SCALE = -0.6;
const ITEM_POS_X = 0.56;
const ITEM_POS_Y = -0.52;
const ITEM_POS_Z = -0.72;
const ITEM_PRESWING_ROT_Y = 45.0;
const ITEM_SWING_X_ROT_AMOUNT = -80.0;
const ITEM_SWING_Y_ROT_AMOUNT = -20.0;
const ITEM_SWING_Z_ROT_AMOUNT = -20.0;
const ARM_SWING_X_POS_SCALE = -0.3;
const ARM_SWING_Y_POS_SCALE = 0.4;
const ARM_SWING_Z_POS_SCALE = -0.4;
const ARM_SWING_Y_ROT_AMOUNT = 70.0;
const ARM_SWING_Z_ROT_AMOUNT = -20.0;
const ARM_HEIGHT_SCALE = -0.6;
const ARM_POS_X = 0.64; // renderPlayerArm: xSwingPosition + 0.64000005
const ARM_POS_Y = -0.6;
const ARM_POS_Z = -0.72;
const ARM_PREROTATION_X_OFFSET = -1.0;
const ARM_PREROTATION_Y_OFFSET = 3.6;
const ARM_PREROTATION_Z_OFFSET = 3.5;
const ARM_POSTROTATION_X_OFFSET = 5.6;
/** AvatarRenderer.renderHand sets model.rightArm.zRot = 0.1F for the right hand. */
const ARM_ROT_Z = RIGHT_ARM_Z_ROT_DEG;

/** Lighting.java LEVEL entry (used while the level + hand are drawn). */
const LEVEL_LIGHT_0 = normalize3(0.2, 1.0, -0.7);
const LEVEL_LIGHT_1 = normalize3(-0.2, 1.0, 0.7);

const DEG = Math.PI / 180;

function normalize3(x: number, y: number, z: number): [number, number, number] {
  const len = Math.hypot(x, y, z) || 1;
  return [x / len, y / len, z / len];
}

function lerp(a: number, b: number, t: number): number { return a + (b - a) * t; }
function clamp(v: number, lo: number, hi: number): number { return v < lo ? lo : v > hi ? hi : v; }

interface ItemLayer { texture: string; array?: string; tint?: number; }
interface ItemEntry {
  kind: 'block' | 'flat' | 'special' | 'composite' | 'none';
  model?: number;
  modelLoc?: string;
  layers?: ItemLayer[];
  guiLight?: 'front' | 'side';
  parts?: ItemEntry[];
  /** items/*.json tint sources, index = the model's tintindex (grass_block, leaves, ...) */
  tints?: { type: string; value?: number }[];
}

type Rgb = [number, number, number];

function rgbOfArgb(argb: number): Rgb {
  return [((argb >> 16) & 255) / 255, ((argb >> 8) & 255) / 255, (argb & 255) / 255];
}

/**
 * Static colour of one item tint source (ItemTintSource): `constant` is the stored ARGB value; `grass` is
 * GrassColor.get(0.5, 1.0), the same 0x91BD59 build-itemmodels bakes into the flat layers.
 */
function tintOfSource(src: { type: string; value?: number } | undefined): Rgb | undefined {
  if (!src) return undefined;
  if (src.type === 'constant' && typeof src.value === 'number') return rgbOfArgb(src.value | 0);
  if (src.type === 'grass') return rgbOfArgb(0x91bd59);
  return undefined;
}

interface DisplayTransform { rotation: number[]; translation: number[]; scale: number[]; }

interface GpuMesh {
  vao: WebGLVertexArrayObject;
  vbo: WebGLBuffer;
  ibo: WebGLBuffer;
  count: number;
  array: 'block' | 'item' | 'skin';
  /** multiplied into the texture colour (grass / foliage tinted items) */
  tint?: Rgb;
}

interface GpuItem { parts: GpuMesh[]; }

/**
 * First-person hand renderer. One instance per Game, created before the first frame.
 *
 * `debugHeldItem` / `debugAttack` are screenshot-harness overrides (the headless browser cannot
 * pointer-lock, so `attackAnim` and the selected stack cannot be driven through real input).
 */
export class HandRenderer {
  private readonly program: GlProgram;
  private readonly proj = mat4();
  private readonly mvp = mat4();
  private readonly normalMat = new Float32Array(9);
  private readonly stack = new Mat4Stack();

  private armMesh: GpuMesh | null = null;
  private itemModels: Record<string, ItemEntry> = {};
  private display = new Map<string, DisplayTransform>();
  private readonly itemCache = new Map<string, GpuItem | null>();
  private readonly pendingItems = new Set<string>();
  private readonly spriteAlpha = new Map<string, Promise<SpriteAlpha | null>>();
  private readonly gpuMeshes: GpuMesh[] = [];

  private skinTex: WebGLTexture | null = null;
  private underwaterTex: WebGLTexture | null = null;
  private screenVao: WebGLVertexArrayObject | null = null;
  private screenVbo: WebGLBuffer | null = null;
  private screenIbo: WebGLBuffer | null = null;

  /** animation state, advanced by tick() (20 Hz, like ItemInHandRenderer.tick) */
  private attack = 0;
  private oAttack = 0;
  private bob = 0;
  private oBob = 0;
  private xBob = 0;
  private oXBob = 0;
  private yBob = 0;
  private oYBob = 0;
  private walkDist = 0;
  private oWalkDist = 0;
  private mainHandHeight = 0;
  private visibleItemId = '\u0000';

  /** Screenshot harness: force the held item ("minecraft:iron_pickaxe", '' = empty hand). */
  debugHeldItem: string | undefined = undefined;
  /** Screenshot harness: force attackAnim 0..1 (negative = use the live value). */
  debugAttack = -1;

  constructor(
    private readonly gl: WebGL2RenderingContext,
    private readonly mc: MinecraftData,
    private readonly models: ModelSource,
    private readonly textures: TextureManager,
  ) {
    this.program = new GlProgram(gl, HAND_VERT, HAND_FRAG, 'hand');
  }

  async init(base = '/mc'): Promise<void> {
    const [skin, itemRes, displayRes] = await Promise.all([
      this.textures.imageTexture('entity/player/wide/steve'),
      fetch(`${base}/itemmodels.json`),
      fetch(`${base}/hand/display.json`),
    ]);
    this.skinTex = skin;
    if (itemRes.ok) {
      const json = (await itemRes.json()) as { items: Record<string, ItemEntry> };
      this.itemModels = json.items;
    }
    if (displayRes.ok) {
      const json = (await displayRes.json()) as { transforms: Record<string, DisplayTransform> };
      for (const [loc, t] of Object.entries(json.transforms)) this.display.set(loc, t);
    }

    this.armMesh = this.upload(buildPlayerArmMesh(), 'skin');

    // Water overlay texture: ScreenEffectRenderer uses misc/underwater.png, wrapped (UV 0..4).
    const gl = this.gl;
    const img = await this.textures.image('misc/underwater');
    const tex = gl.createTexture()!;
    gl.bindTexture(gl.TEXTURE_2D, tex);
    gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA8, gl.RGBA, gl.UNSIGNED_BYTE, img);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.REPEAT);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.REPEAT);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.NEAREST);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.NEAREST);
    this.underwaterTex = tex;

    // Screen-effect quad: positions in camera space, UVs written every frame.
    this.screenVao = gl.createVertexArray()!;
    gl.bindVertexArray(this.screenVao);
    this.screenVbo = gl.createBuffer()!;
    gl.bindBuffer(gl.ARRAY_BUFFER, this.screenVbo);
    gl.bufferData(gl.ARRAY_BUFFER, new Float32Array(36), gl.DYNAMIC_DRAW);
    this.screenIbo = gl.createBuffer()!;
    gl.bindBuffer(gl.ELEMENT_ARRAY_BUFFER, this.screenIbo);
    gl.bufferData(gl.ELEMENT_ARRAY_BUFFER, new Uint32Array([0, 1, 2, 0, 2, 3]), gl.STATIC_DRAW);
    gl.enableVertexAttribArray(0);
    gl.vertexAttribPointer(0, 3, gl.FLOAT, false, 36, 0);
    gl.enableVertexAttribArray(1);
    gl.vertexAttribPointer(1, 2, gl.FLOAT, false, 36, 12);
    gl.enableVertexAttribArray(2);
    gl.vertexAttribPointer(2, 1, gl.FLOAT, false, 36, 20);
    gl.enableVertexAttribArray(3);
    gl.vertexAttribPointer(3, 3, gl.FLOAT, false, 36, 24);
    gl.bindVertexArray(null);

    // Preload the items a player realistically holds right after spawning (hotbar defaults +
    // the tools in the acceptance screenshots). Everything else loads lazily on first use.
    for (const name of [
      'stone', 'oak_log', 'oak_planks', 'grass_block', 'glass', 'torch', 'crafting_table',
      'oak_stairs', 'coal_ore', 'cobblestone', 'dirt', 'iron_pickaxe', 'diamond_sword', 'apple',
    ]) {
      void this.ensureItem(`minecraft:${name}`);
    }
  }

  // ------------------------------------------------------------------ meshes

  private upload(mesh: MeshData, array: GpuMesh['array']): GpuMesh {
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
    const out: GpuMesh = { vao, vbo, ibo, count: mesh.indices.length, array };
    this.gpuMeshes.push(out);
    return out;
  }

  /** Resolves (and caches) the renderable mesh of an item, loading flat sprite PNGs lazily. */
  private ensureItem(name: string): GpuItem | null {
    const key = name.includes(':') ? name : `minecraft:${name}`;
    if (this.itemCache.has(key)) return this.itemCache.get(key) ?? null;
    if (this.pendingItems.has(key)) return null;
    const entry = this.itemModels[key];
    if (!entry || entry.kind === 'none' || entry.kind === 'special' || entry.kind === 'composite') {
      this.itemCache.set(key, null);
      return null;
    }

    if (entry.kind === 'block' && entry.model !== undefined) {
      // Faces carry a tintindex (grass_block top + side overlay, leaves, ...): one mesh per tint source so each
      // part can be drawn with its own colour; untinted faces keep a white multiplier.
      const model = this.models.getModel(entry.model);
      const indices = [...new Set(model.quads.map((q) => q.tint))];
      const parts: GpuMesh[] = [];
      for (const idx of indices) {
        const sub = { ...model, quads: model.quads.filter((q) => q.tint === idx) };
        const part = this.upload(buildBlockMesh(sub), 'block');
        if (idx >= 0) part.tint = tintOfSource(entry.tints?.[idx]);
        parts.push(part);
      }
      const gpu: GpuItem = { parts };
      this.itemCache.set(key, gpu);
      return gpu;
    }

    if (entry.kind === 'flat' && entry.layers && entry.layers.length) {
      this.pendingItems.add(key);
      void this.buildFlatItem(key, entry).then((gpu) => {
        this.itemCache.set(key, gpu);
        this.pendingItems.delete(key);
      }).catch((err) => {
        console.warn('[hand] flat item mesh failed', key, err);
        this.itemCache.set(key, null);
        this.pendingItems.delete(key);
      });
      return null;
    }

    this.itemCache.set(key, null);
    return null;
  }

  private async buildFlatItem(key: string, entry: ItemEntry): Promise<GpuItem> {
    const parts: GpuMesh[] = [];
    for (const layer of entry.layers ?? []) {
      const alpha = await this.spriteAlphaOf(layer);
      const array: GpuMesh['array'] = (layer.array ?? 'item') === 'block' ? 'block' : 'item';
      const layerIndex = array === 'block'
        ? this.textures.blockTextureLayer(layer.texture)
        : this.textures.itemTextureLayer(layer.texture);
      if (layerIndex < 0) continue;
      const part = this.upload(buildFlatMesh(layerIndex, alpha), array);
      if (layer.tint !== undefined && layer.tint !== -1) part.tint = rgbOfArgb(layer.tint | 0);
      parts.push(part);
    }
    if (!parts.length) throw new Error(`no resolvable layers for ${key}`);
    return { parts };
  }

  private spriteAlphaOf(layer: ItemLayer): Promise<SpriteAlpha | null> {
    const cached = this.spriteAlpha.get(layer.texture);
    if (cached) return cached;
    const promise = (async (): Promise<SpriteAlpha | null> => {
      try {
        const img = await this.textures.image(layer.texture);
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
    this.spriteAlpha.set(layer.texture, promise);
    return promise;
  }

  // -------------------------------------------------------------------- tick

  /** ItemInHandRenderer.tick() + the bob values GameRenderer.bobView reads (20 Hz). */
  tick(player: Player, survival: SurvivalState): void {
    this.oAttack = this.attack;
    this.attack = clamp(player.swingProgress, 0, 1);

    const nextId = survival.getSelectedStack().item?.namespacedId ?? '';
    if (this.debugHeldItem !== undefined) {
      this.visibleItemId = this.debugHeldItem === '' ? '' : (this.debugHeldItem.includes(':') ? this.debugHeldItem : `minecraft:${this.debugHeldItem}`);
      this.mainHandHeight = 1;
    } else {
      // ItemInHandRenderer.tick: target height 0 while the slot changed, otherwise 1; the pose
      // height moves by at most 0.4/tick and the visible stack is swapped below 0.1.
      if (nextId !== this.visibleItemId) {
        this.mainHandHeight = Math.max(0, this.mainHandHeight - 0.4);
        if (this.mainHandHeight < 0.1) {
          this.visibleItemId = nextId;
          this.mainHandHeight = 0;
        }
      } else {
        this.mainHandHeight = Math.min(1, this.mainHandHeight + 0.4);
      }
    }

    // AbstractClientPlayer.updateBob: tBob = min(0.1, horizontalSpeed) while on the ground.
    this.oBob = this.bob;
    const speed = Math.hypot(player.vel.x, player.vel.z);
    const tBob = player.onGround && !player.inWater ? Math.min(0.1, speed) : 0;
    this.bob += (tBob - this.bob) * 0.4;

    // LocalPlayer.tick: xBob/yBob smooth the view rotation by *0.5 per tick.
    this.oXBob = this.xBob;
    this.xBob += (player.pitch - this.xBob) * 0.5;
    this.oYBob = this.yBob;
    this.yBob += (player.yaw - this.yBob) * 0.5;

    this.oWalkDist = this.walkDist;
    this.walkDist = player.walkDist;
  }

  // ------------------------------------------------------------------ render

  /**
   * Draws the hand + held item, then the screen effects (ScreenEffectRenderer order).
   * Call after the world passes and after the breaking overlay; the depth buffer is cleared
   * first exactly like GameRenderer.renderLevel (clearDepthTexture).
   */
  render(
    partial: number,
    camera: Camera,
    player: Player,
    level: ClientLevel,
    survival: SurvivalState,
  ): void {
    if (!this.skinTex) return;
    const gl = this.gl;

    // GameRenderer.renderLevel: clear the depth buffer, then hudProjection.setupPerspective(
    // 0.05, 100, hudFov, width, height).
    gl.depthMask(true);
    gl.colorMask(true, true, true, true);
    gl.clear(gl.DEPTH_BUFFER_BIT);

    const hudFov = this.hudFov(player, level) * DEG;
    mat4Perspective(hudFov, camera.aspect, 0.05, 100, this.proj);

    const light = this.lightAt(level, player);
    const attack = this.debugAttack >= 0 ? this.debugAttack : this.attackValue(partial);

    // GameRenderer.renderItemInHand: bobHurt then bobView on the hand pose stack.
    this.stack.reset();
    this.applyHurtTilt(survival);
    this.applyViewBob(partial, player);

    this.program.use();
    this.program.set1i('uTex2D', 0);
    this.program.set1i('uAtlas', 1);
    this.program.set1i('uLightmap', 2);
    this.program.set3f('uLight0', LEVEL_LIGHT_0[0], LEVEL_LIGHT_0[1], LEVEL_LIGHT_0[2]);
    this.program.set3f('uLight1', LEVEL_LIGHT_1[0], LEVEL_LIGHT_1[1], LEVEL_LIGHT_1[2]);
    this.program.set2f('uLightLevel', light[0], light[1]);
    // Every sampler unit must hold a texture of the declared type at draw time, even when the
    // current mode does not sample it (WebGL validates all active samplers per draw).
    gl.activeTexture(gl.TEXTURE0);
    gl.bindTexture(gl.TEXTURE_2D, this.skinTex);
    gl.activeTexture(gl.TEXTURE1);
    gl.bindTexture(gl.TEXTURE_2D_ARRAY, this.textures.block.texture);
    gl.activeTexture(gl.TEXTURE2);
    gl.bindTexture(gl.TEXTURE_2D, this.textures.lightmap);
    gl.activeTexture(gl.TEXTURE0);

    gl.enable(gl.DEPTH_TEST);
    gl.depthFunc(gl.LEQUAL);
    gl.depthMask(true);
    gl.enable(gl.CULL_FACE);
    gl.cullFace(gl.BACK);
    gl.enable(gl.BLEND);
    gl.blendFunc(gl.SRC_ALPHA, gl.ONE_MINUS_SRC_ALPHA);

    const holding = this.debugHeldItem !== undefined
      ? (this.debugHeldItem === '' ? '' : (this.debugHeldItem.includes(':') ? this.debugHeldItem : `minecraft:${this.debugHeldItem}`))
      : this.visibleItemId;
    const item = holding ? this.ensureItem(holding) : null;
    this.currentItemLoc = holding ? (this.itemModels[holding]?.modelLoc ?? null) : null;

    if (!holding) {
      this.drawArm(attack);
    } else if (item) {
      this.drawItem(item, attack);
    }

    this.drawScreenEffects(player, level);

    // Restore the GL state contract (05-environment-audio.md): depth test on, depthMask true,
    // cull back, blend off. The current framebuffer / viewport are never touched here.
    gl.disable(gl.BLEND);
    gl.enable(gl.CULL_FACE);
    gl.cullFace(gl.BACK);
    gl.enable(gl.DEPTH_TEST);
    gl.depthFunc(gl.LEQUAL);
    gl.depthMask(true);
  }

  /** Camera.calculateHudFov: 70 degrees, only death / eye-in-fluid modify it (not sprint). */
  private hudFov(player: Player, level: ClientLevel): number {
    let fov = 70.0;
    const eye = this.eyeBlock(level, player);
    if (eye === 'water' || eye === 'lava') fov *= 0.85714287; // Mth.lerp(fovEffectScale=1, 1, 0.85714287)
    return fov;
  }

  private eyeBlock(level: ClientLevel, player: Player): string {
    const state = level.getBlockState(Math.floor(player.pos.x), Math.floor(player.eyeY), Math.floor(player.pos.z));
    if (!state) return '';
    const name = this.mc.blockOf(state).name;
    return name === 'water' ? 'water' : name === 'lava' ? 'lava' : name;
  }

  /** lightmap levels at the player's head block (EntityRenderDispatcher.getPackedLightCoords). */
  private lightAt(level: ClientLevel, player: Player): [number, number] {
    const x = Math.floor(player.pos.x);
    const y = Math.floor(player.eyeY);
    const z = Math.floor(player.pos.z);
    return [level.getSkyLight(x, y, z), level.getBlockLight(x, y, z)];
  }

  /**
   * GameRenderer.bobHurt (26.2): hurtTime / hurtDuration (10), sin(h^4 * PI) * -14 degrees Z.
   * hurtDir is not tracked by SurvivalState, so only the pure tilt is applied.
   */
  private applyHurtTilt(survival: SurvivalState): void {
    const hurtTime = survival.hurtTime;
    if (hurtTime < 0) return;
    const hurt = hurtTime / 10;
    const tilt = Math.sin(hurt * hurt * hurt * hurt * Math.PI);
    this.stack.rotateZ(-tilt * 14.0);
  }

  /** GameRenderer.bobView (26.2): hand-space walking sway. */
  private applyViewBob(partial: number, player: Player): void {
    const bwd = -(this.oWalkDist + (this.walkDist - this.oWalkDist) * partial);
    const bob = lerp(this.oBob, this.bob, partial);
    this.stack.translate(
      Math.sin(bwd * Math.PI) * bob * 0.5,
      -Math.abs(Math.cos(bwd * Math.PI) * bob),
      0,
    );
    this.stack.rotateZ(Math.sin(bwd * Math.PI) * bob * 3.0);
    this.stack.rotateX(Math.abs(Math.cos(bwd * Math.PI - 0.2) * bob) * 5.0);
    // ItemInHandRenderer.submitHandsWithItems: the hand lags the view rotation slightly.
    this.stack.rotateX((player.pitch - lerp(this.oXBob, this.xBob, partial)) * 0.1);
    this.stack.rotateY((player.yaw - lerp(this.oYBob, this.yBob, partial)) * 0.1);
  }

  /** Player.getAttackAnim(partialTicks): the swing wraps 1 -> 0, hence the +1 on a negative delta. */
  private attackValue(partial: number): number {
    let f = this.attack - this.oAttack;
    if (f < 0) f += 1;
    return this.oAttack + f * partial;
  }

  // -------------------------------------------------------------------- arm

  private drawArm(attack: number): void {
    if (!this.armMesh) return;
    const gl = this.gl;
    const invert = 1.0; // right hand
    const sqrtAttack = Math.sqrt(attack);
    const xSwingPosition = ARM_SWING_X_POS_SCALE * Math.sin(sqrtAttack * Math.PI);
    const ySwingPosition = ARM_SWING_Y_POS_SCALE * Math.sin(sqrtAttack * Math.PI * 2);
    const zSwingPosition = ARM_SWING_Z_POS_SCALE * Math.sin(attack * Math.PI);
    const inverseArmHeight = 1.0 - this.mainHandHeight;

    this.stack.push();
    this.stack.translate(
      invert * (xSwingPosition + ARM_POS_X),
      ySwingPosition + ARM_POS_Y + inverseArmHeight * ARM_HEIGHT_SCALE,
      zSwingPosition + ARM_POS_Z,
    );
    this.stack.rotateY(invert * ITEM_PRESWING_ROT_Y);
    const zSwingRotation = Math.sin(attack * attack * Math.PI);
    const ySwingRotation = Math.sin(sqrtAttack * Math.PI);
    this.stack.rotateY(invert * ySwingRotation * ARM_SWING_Y_ROT_AMOUNT);
    this.stack.rotateZ(invert * zSwingRotation * ARM_SWING_Z_ROT_AMOUNT);
    this.stack.translate(
      invert * ARM_PREROTATION_X_OFFSET,
      ARM_PREROTATION_Y_OFFSET,
      ARM_PREROTATION_Z_OFFSET,
    );
    this.stack.rotateZ(invert * 120.0);
    this.stack.rotateX(200.0);
    this.stack.rotateY(invert * -135.0);
    this.stack.translate(invert * ARM_POSTROTATION_X_OFFSET, 0, 0);

    // ModelPart.translateAndRotate of right_arm: pivot (-5,2,0)/16, rotationZYX(0.1,0,0).
    this.stack.translate(ARM_PIVOT_BLOCKS[0], ARM_PIVOT_BLOCKS[1], ARM_PIVOT_BLOCKS[2]);
    this.stack.rotateZ(ARM_ROT_Z);

    gl.activeTexture(gl.TEXTURE0);
    gl.bindTexture(gl.TEXTURE_2D, this.skinTex);
    this.drawGpu(this.armMesh, 0, 0.0, [1, 1, 1, 1]);
    this.stack.pop();
  }

  // -------------------------------------------------------------------- item

  private drawItem(item: GpuItem, attack: number): void {
    const gl = this.gl;
    const invert = 1.0; // right hand
    const inverseArmHeight = 1.0 - this.mainHandHeight;
    const sqrtAttack = Math.sqrt(attack);
    const xSwingPosition = ITEM_SWING_X_POS_SCALE * Math.sin(sqrtAttack * Math.PI);
    const ySwingPosition = ITEM_SWING_Y_POS_SCALE * Math.sin(sqrtAttack * Math.PI * 2);
    const zSwingPosition = ITEM_SWING_Z_POS_SCALE * Math.sin(attack * Math.PI);

    this.stack.push();
    // applyItemArmTransform
    this.stack.translate(
      invert * ITEM_POS_X,
      ITEM_POS_Y + inverseArmHeight * ITEM_HEIGHT_SCALE,
      ITEM_POS_Z,
    );
    // swingArm: translation then applyItemArmAttackTransform
    this.stack.translate(invert * xSwingPosition, ySwingPosition, zSwingPosition);
    const ySwingRotation = Math.sin(attack * attack * Math.PI);
    this.stack.rotateY(invert * (ITEM_PRESWING_ROT_Y + ySwingRotation * ITEM_SWING_Y_ROT_AMOUNT));
    const xzSwingRotation = Math.sin(sqrtAttack * Math.PI);
    this.stack.rotateZ(invert * xzSwingRotation * ITEM_SWING_Z_ROT_AMOUNT);
    this.stack.rotateX(xzSwingRotation * ITEM_SWING_X_ROT_AMOUNT);
    this.stack.rotateY(invert * -ITEM_PRESWING_ROT_Y);

    // ItemStackRenderState.LayerRenderState.applyTransform: ItemTransform.apply + localTransform.
    const t = this.display.get(this.currentItemLoc ?? '');
    this.stack.push();
    if (t) {
      this.stack.translate(t.translation[0] * 0.0625, t.translation[1] * 0.0625, t.translation[2] * 0.0625);
      this.stack.rotateXYZ(t.rotation[0], t.rotation[1], t.rotation[2]);
      this.stack.scale(t.scale[0], t.scale[1], t.scale[2]);
    }
    this.stack.translate(-0.5, -0.5, -0.5);

    for (const part of item.parts) {
      const atlas = part.array === 'block' ? this.textures.block.texture : this.textures.item.texture;
      gl.activeTexture(gl.TEXTURE1);
      gl.bindTexture(gl.TEXTURE_2D_ARRAY, atlas);
      this.drawGpu(part, 1, 0.1, part.tint ? [part.tint[0], part.tint[1], part.tint[2], 1] : [1, 1, 1, 1]);
    }
    this.stack.pop();
    this.stack.pop();
  }

  /** Item model location of the item currently in the hand (for the display transform lookup). */
  private currentItemLoc: string | null = null;

  // ------------------------------------------------------------------ draws

  private drawGpu(mesh: GpuMesh, mode: number, alphaTest: number, color: number[]): void {
    const gl = this.gl;
    this.program.set1i('uMode', mode);
    this.program.set1f('uAlphaTest', alphaTest);
    this.program.set4f('uColor', color[0], color[1], color[2], color[3]);
    this.uploadMatrices();
    gl.bindVertexArray(mesh.vao);
    gl.drawElements(gl.TRIANGLES, mesh.count, gl.UNSIGNED_INT, 0);
  }

  private uploadMatrices(): void {
    // proj * model; the hand pose lives directly in camera space (GameRenderer.renderItemInHand
    // multiplies the pose by the inverse view rotation, so no view matrix is involved).
    this.mvp.set(this.proj);
    for (let c = 0; c < 4; c++) {
      for (let r = 0; r < 4; r++) {
        this.mvp[c * 4 + r] =
          this.proj[0 * 4 + r] * this.stack.top[c * 4 + 0] +
          this.proj[1 * 4 + r] * this.stack.top[c * 4 + 1] +
          this.proj[2 * 4 + r] * this.stack.top[c * 4 + 2] +
          this.proj[3 * 4 + r] * this.stack.top[c * 4 + 3];
      }
    }
    normalMatrix(this.normalMat, this.stack.top);
    this.program.setMat4('uProjModel', this.mvp);
    const loc = this.program.uniform('uNormalMat');
    if (loc) this.gl.uniformMatrix3fv(loc, false, this.normalMat);
  }

  // ------------------------------------------------------------ screen effects

  /** ScreenEffectRenderer.submitWater / submitBlockSprite. */
  private drawScreenEffects(player: Player, level: ClientLevel): void {
    if (!player.inWater || !this.underwaterTex || !this.screenVao) return;
    const gl = this.gl;

    // Underwater: ARGB.colorFromFloat(0.1, brightness, brightness, brightness)
    const x = Math.floor(player.pos.x);
    const y = Math.floor(player.eyeY);
    const z = Math.floor(player.pos.z);
    const raw = clamp(level.getBrightness(x, y, z) / 15, 0, 1);
    const brightness = raw / (4 - 3 * raw);
    // UV: u0 = -yRot/64, v0 = xRot/64, quad UV size 4.
    const u0 = -player.yaw / 64;
    const v0 = player.pitch / 64;

    // Quad in camera space (ScreenEffectRenderer.submitWater builds -1..1 at z = -0.5).
    const verts = new Float32Array(36);
    const quad = [
      [-1, -1, u0 + 4, v0 + 4],
      [1, -1, u0, v0 + 4],
      [1, 1, u0, v0],
      [-1, 1, u0 + 4, v0],
    ];
    for (let i = 0; i < 4; i++) {
      const o = i * 9;
      verts[o] = quad[i][0];
      verts[o + 1] = quad[i][1];
      verts[o + 2] = -0.5;
      verts[o + 3] = quad[i][2];
      verts[o + 4] = quad[i][3];
      verts[o + 5] = 0;
      verts[o + 6] = 0;
      verts[o + 7] = 0;
      verts[o + 8] = -1;
    }
    gl.bindVertexArray(this.screenVao);
    gl.bindBuffer(gl.ARRAY_BUFFER, this.screenVbo);
    gl.bufferData(gl.ARRAY_BUFFER, verts, gl.DYNAMIC_DRAW);

    this.stack.reset();
    this.program.use();
    this.program.set1i('uMode', 2);
    this.program.set1f('uAlphaTest', 0);
    this.program.set4f('uColor', brightness, brightness, brightness, 0.1);
    gl.activeTexture(gl.TEXTURE0);
    gl.bindTexture(gl.TEXTURE_2D, this.underwaterTex);
    this.uploadMatrices();

    gl.disable(gl.DEPTH_TEST);
    gl.disable(gl.CULL_FACE);
    gl.enable(gl.BLEND);
    gl.blendFunc(gl.SRC_ALPHA, gl.ONE_MINUS_SRC_ALPHA);
    gl.drawElements(gl.TRIANGLES, 6, gl.UNSIGNED_INT, 0);
  }
}
