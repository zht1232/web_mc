// Port of net.minecraft.client.particle.ParticleEngine rendering, rebuilt as a
// single instanced draw call over a fixed 10000-slot SoA pool.
//
// One static quad VBO + one dynamic instance VBO (14 floats / particle) are
// uploaded once per frame; drawArraysInstanced issues the whole batch. The
// camera right/up vectors are recovered from viewProj's rows so render() needs
// no camera argument, only (viewProj, partialTick).

import { GlProgram } from '../renderer/gl/Gl.js';
import { XoroshiroRandomSource } from '../../vanilla/core/Random.js';
import {
  PARTICLE_TYPES, ParticlePool, ParticleType,
  type ParticleSpec,
} from './Particle.js';
import { ParticleSpriteAtlas, type SpriteUv } from './ParticleSprites.js';

const FLOATS_PER_INSTANCE = 14;   // center3 + size1 + uvRect4 + color4 + misc2
const QUAD_FLOATS = 4;            // corner2 + quadUV2
const FALLBACK_UV: SpriteUv = { u0: 0, v0: 0, u1: 1, v1: 1 };

const PARTICLE_VS = `#version 300 es
precision highp float;
layout(location = 0) in vec2 aCorner;
layout(location = 1) in vec2 aQuadUV;
layout(location = 2) in vec3 aCenter;
layout(location = 3) in float aSize;
layout(location = 4) in vec4 aUvRect;
layout(location = 5) in vec4 aColor;
layout(location = 6) in vec2 aMisc;   // x = texSel, y = block layer
uniform mat4 uViewProj;
uniform vec3 uRight;
uniform vec3 uUp;
out vec2 vUV;
out vec4 vColor;
out float vTexSel;
out float vLayer;
void main() {
  vec3 world = aCenter + uRight * (aCorner.x * aSize) + uUp * (aCorner.y * aSize);
  gl_Position = uViewProj * vec4(world, 1.0);
  vUV = mix(aUvRect.xy, aUvRect.zw, aQuadUV);
  vColor = aColor;
  vTexSel = aMisc.x;
  vLayer = aMisc.y;
}`;

const PARTICLE_FS = `#version 300 es
precision highp float;
precision highp sampler2DArray;
in vec2 vUV;
in vec4 vColor;
in float vTexSel;
in float vLayer;
uniform sampler2D uAtlas;
uniform sampler2DArray uBlock;
uniform float uHasBlock;
out vec4 fragColor;
void main() {
  vec4 c = (vTexSel > 0.5 && uHasBlock > 0.5)
    ? texture(uBlock, vec3(vUV, vLayer))
    : texture(uAtlas, vUV);
  c *= vColor;
  if (c.a < 0.02) discard;
  fragColor = c;
}`;

export interface ParticleEngineInit {
  /** TextureManager.block.texture (sampler2DArray), used by BLOCK particles. */
  blockArray?: WebGLTexture | null;
}

export class ParticleEngine {
  readonly pool: ParticlePool;
  readonly random: XoroshiroRandomSource;
  atlas: ParticleSpriteAtlas | null = null;

  /** Optional callback: stateId -> block texture-array layer. */
  blockLayerForState: ((stateId: number) => number) | null = null;

  /**
   * Optional callback: packed light level (0..15) at a world position. Vanilla multiplies every
   * non-full-bright particle by the lightmap, which is why break particles must darken in caves
   * and at night instead of glowing at full brightness.
   */
  lightAt: ((x: number, y: number, z: number) => number) | null = null;

  private program: GlProgram | null = null;
  private vao: WebGLVertexArrayObject | null = null;
  private quadVbo: WebGLBuffer | null = null;
  private instanceVbo: WebGLBuffer | null = null;
  private blockArray: WebGLTexture | null = null;
  private placeholder2D: WebGLTexture | null = null;
  private placeholderArray: WebGLTexture | null = null;
  private hasBlock = false;
  private readonly instanceData: Float32Array;
  private readonly basisRight = new Float32Array(3);
  private readonly basisUp = new Float32Array(3);

  private static _instance: ParticleEngine | null = null;
  static get(): ParticleEngine { return this._instance ?? (this._instance = new ParticleEngine(null)); }
  static setInstance(engine: ParticleEngine | null): void { this._instance = engine; }

  constructor(
    private readonly gl: WebGL2RenderingContext | null,
    capacity = 10000,
  ) {
    this.pool = new ParticlePool(capacity);
    this.random = new XoroshiroRandomSource(0x9e3779b97f4a7c15n);
    this.instanceData = new Float32Array(capacity * FLOATS_PER_INSTANCE);
  }

  /** Re-seed the deterministic spawn RNG (used by the determinism test). */
  setSeed(seed: bigint | number): void {
    this.random.setSeed(typeof seed === 'bigint' ? seed : BigInt(seed));
  }

  /** Loads the atlas + uv table and creates the GPU buffers. Safe to call once. */
  async init(opts: ParticleEngineInit = {}): Promise<void> {
    const gl = this.gl;
    if (!gl || this.program) return;
    this.program = new GlProgram(gl, PARTICLE_VS, PARTICLE_FS, 'particle.engine');
    try {
      this.atlas = await ParticleSpriteAtlas.load(gl);
    } catch {
      // Missing generated resources: fall back to a single white sprite.
      this.atlas = new ParticleSpriteAtlas({
        version: 1, atlas: 'particle_atlas.png', width: 1, height: 1,
        sprites: {}, events: {}, unresolved: [],
      });
      this.placeholder2D = createPlaceholder2D(gl);
    }
    this.blockArray = opts.blockArray ?? null;
    this.hasBlock = !!opts.blockArray;
    this.placeholderArray = createPlaceholderBlockArray(gl);

    const vao = gl.createVertexArray()!;
    gl.bindVertexArray(vao);
    const quadVbo = gl.createBuffer()!;
    gl.bindBuffer(gl.ARRAY_BUFFER, quadVbo);
    gl.bufferData(gl.ARRAY_BUFFER, new Float32Array([
      -1, -1, 0, 0, 1, -1, 1, 0, 1, 1, 1, 1,
      -1, -1, 0, 0, 1, 1, 1, 1, -1, 1, 0, 1,
    ]), gl.STATIC_DRAW);
    gl.enableVertexAttribArray(0);
    gl.vertexAttribPointer(0, 2, gl.FLOAT, false, QUAD_FLOATS * 4, 0);
    gl.enableVertexAttribArray(1);
    gl.vertexAttribPointer(1, 2, gl.FLOAT, false, QUAD_FLOATS * 4, 8);

    const instanceVbo = gl.createBuffer()!;
    gl.bindBuffer(gl.ARRAY_BUFFER, instanceVbo);
    gl.bufferData(gl.ARRAY_BUFFER, this.instanceData.byteLength, gl.DYNAMIC_DRAW);
    const stride = FLOATS_PER_INSTANCE * 4;
    const attrib = (loc: number, size: number, offsetFloats: number) => {
      gl.enableVertexAttribArray(loc);
      gl.vertexAttribPointer(loc, size, gl.FLOAT, false, stride, offsetFloats * 4);
      gl.vertexAttribDivisor(loc, 1);
    };
    attrib(2, 3, 0);
    attrib(3, 1, 3);
    attrib(4, 4, 4);
    attrib(5, 4, 8);
    attrib(6, 2, 12);
    gl.bindVertexArray(null);
    this.vao = vao;
    this.quadVbo = quadVbo;
    this.instanceVbo = instanceVbo;
  }

  /** Adds a particle; fills frameCount from the atlas when not supplied. */
  add(spec: ParticleSpec): number {
    const info = PARTICLE_TYPES[spec.type] ?? PARTICLE_TYPES[0];
    if (spec.frameCount === undefined && this.atlas) {
      spec.frameCount = Math.min(255, this.atlas.frames(info.spriteKey).length);
    }
    const idx = this.pool.add(spec);
    if (idx >= 0 && this.lightAt && !info.glow) {
      const l = Math.max(0, Math.min(15, this.lightAt(spec.x, spec.y, spec.z))) / 15;
      // Lightmap curve (core/lightmap.fsh): b = l / (4 - 3l), clamped to a small ambient floor.
      const b = Math.max(0.05, l / (4 - 3 * l));
      this.pool.r[idx] *= b;
      this.pool.g[idx] *= b;
      this.pool.b[idx] *= b;
    }
    return idx;
  }

  tick(): void { this.pool.tick(); }

  /** Fills instanceData for every live particle; returns the float count. */
  buildInstanceData(viewProj: Float32Array, partialTick: number): number {
    const pool = this.pool;
    const d = this.instanceData;
    // row 0 / row 1 of viewProj are (P00 * right) and (P11 * up).
    let rx = viewProj[0], ry = viewProj[4], rz = viewProj[8];
    let ux = viewProj[1], uy = viewProj[5], uz = viewProj[9];
    const rl = Math.hypot(rx, ry, rz) || 1;
    const ul = Math.hypot(ux, uy, uz) || 1;
    this.basisRight[0] = rx / rl; this.basisRight[1] = ry / rl; this.basisRight[2] = rz / rl;
    this.basisUp[0] = ux / ul; this.basisUp[1] = uy / ul; this.basisUp[2] = uz / ul;

    let n = 0;
    const count = pool.slotCount;
    for (let i = 0; i < count; i++) {
      if (!pool.alive[i]) continue;
      const info = PARTICLE_TYPES[pool.type[i]] ?? PARTICLE_TYPES[0];
      const t = Math.min(1, Math.max(0, partialTick));
      const x = pool.px[i] + (pool.x[i] - pool.px[i]) * t;
      const y = pool.py[i] + (pool.y[i] - pool.py[i]) * t;
      const z = pool.pz[i] + (pool.z[i] - pool.pz[i]) * t;
      const fade = Math.min(1, (1 - pool.age[i] / Math.max(1, pool.lifetime[i])) * 3);
      const uv = this.atlas ? this.atlas.frame(info.spriteKey, pool.frame[i]) : FALLBACK_UV;
      const texSel = info.blockAtlas && this.hasBlock ? 1 : 0;
      const layer = pool.blockLayer[i] < 0 ? 0 : pool.blockLayer[i];
      // TerrainParticle shows a quarter of the block sprite, not the whole texture shrunk to
      // 0.1 blocks (which read as a tiny copy of the block instead of a broken fragment).
      let u0 = uv.u0, v0 = uv.v0, u1 = uv.u1, v1 = uv.v1;
      if (texSel > 0.5) {
        const q = pool.frame[i] & 3;
        u0 = (q & 1) * 0.5; v0 = (q >> 1) * 0.5; u1 = u0 + 0.5; v1 = v0 + 0.5;
      }

      d[n++] = x; d[n++] = y; d[n++] = z;
      d[n++] = pool.size[i];
      d[n++] = u0; d[n++] = v0; d[n++] = u1; d[n++] = v1;
      d[n++] = pool.r[i]; d[n++] = pool.g[i]; d[n++] = pool.b[i]; d[n++] = pool.alpha[i] * fade;
      d[n++] = texSel; d[n++] = layer;
    }
    return n;
  }

  /** Single instanced draw call. */
  render(viewProj: Float32Array, partialTick: number): void {
    const gl = this.gl;
    if (!gl || !this.program || !this.vao || !this.instanceVbo) return;
    const n = this.buildInstanceData(viewProj, partialTick);
    if (n === 0) return;

    gl.enable(gl.BLEND);
    gl.blendFunc(gl.SRC_ALPHA, gl.ONE_MINUS_SRC_ALPHA);
    gl.depthMask(false);
    gl.disable(gl.CULL_FACE);

    this.program.use();
    this.program.setMat4('uViewProj', viewProj);
    this.program.set3f('uRight', this.basisRight[0], this.basisRight[1], this.basisRight[2]);
    this.program.set3f('uUp', this.basisUp[0], this.basisUp[1], this.basisUp[2]);
    this.program.set1f('uHasBlock', this.hasBlock ? 1 : 0);
    gl.activeTexture(gl.TEXTURE0);
    gl.bindTexture(gl.TEXTURE_2D, this.atlas?.texture ?? this.placeholder2D);
    this.program.set1i('uAtlas', 0);
    gl.activeTexture(gl.TEXTURE1);
    gl.bindTexture(gl.TEXTURE_2D_ARRAY, this.blockArray ?? this.placeholderArray);
    this.program.set1i('uBlock', 1);

    gl.bindVertexArray(this.vao);
    gl.bindBuffer(gl.ARRAY_BUFFER, this.instanceVbo);
    gl.bufferData(gl.ARRAY_BUFFER, this.instanceData.subarray(0, n), gl.DYNAMIC_DRAW);
    gl.drawArraysInstanced(gl.TRIANGLES, 0, 6, n / FLOATS_PER_INSTANCE);
    gl.bindVertexArray(null);

    gl.depthMask(true);
    gl.disable(gl.BLEND);
    gl.enable(gl.CULL_FACE);
    gl.cullFace(gl.BACK);
  }

  dispose(): void {
    const gl = this.gl;
    if (!gl) return;
    if (this.vao) gl.deleteVertexArray(this.vao);
    if (this.quadVbo) gl.deleteBuffer(this.quadVbo);
    if (this.instanceVbo) gl.deleteBuffer(this.instanceVbo);
    if (this.placeholder2D) gl.deleteTexture(this.placeholder2D);
    if (this.placeholderArray) gl.deleteTexture(this.placeholderArray);
    if (this.atlas?.texture) gl.deleteTexture(this.atlas.texture);
  }
}

function createPlaceholder2D(gl: WebGL2RenderingContext): WebGLTexture {
  const tex = gl.createTexture()!;
  gl.bindTexture(gl.TEXTURE_2D, tex);
  gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA8, 1, 1, 0, gl.RGBA, gl.UNSIGNED_BYTE, new Uint8Array([255, 255, 255, 255]));
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.NEAREST);
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.NEAREST);
  return tex;
}

function createPlaceholderBlockArray(gl: WebGL2RenderingContext): WebGLTexture {
  const tex = gl.createTexture()!;
  gl.bindTexture(gl.TEXTURE_2D_ARRAY, tex);
  gl.texStorage3D(gl.TEXTURE_2D_ARRAY, 1, gl.RGBA8, 1, 1, 1);
  gl.texSubImage3D(gl.TEXTURE_2D_ARRAY, 0, 0, 0, 0, 1, 1, 1, gl.RGBA, gl.UNSIGNED_BYTE, new Uint8Array([255, 255, 255, 255]));
  gl.texParameteri(gl.TEXTURE_2D_ARRAY, gl.TEXTURE_MIN_FILTER, gl.NEAREST);
  gl.texParameteri(gl.TEXTURE_2D_ARRAY, gl.TEXTURE_MAG_FILTER, gl.NEAREST);
  return tex;
}

// ---------------------------------------------------------------- spawn API

/** Deterministic helper: (rng.nextFloat()*2-1) * scale. */
function spread(rng: XoroshiroRandomSource, scale: number): number {
  return (rng.nextFloat() * 2 - 1) * scale;
}

/**
 * Block break burst (TerrainParticle). stateId is resolved to a block-atlas
 * layer through engine.blockLayerForState if the main agent supplied it.
 */
export function spawnBlockBreakParticles(
  stateId: number, x: number, y: number, z: number, count = 20,
): number {
  const e = ParticleEngine.get();
  const rng = e.random;
  const layer = e.blockLayerForState?.(stateId) ?? (stateId % 1230);
  let made = 0;
  for (let i = 0; i < count; i++) {
    const idx = e.add({
      type: ParticleType.BLOCK,
      x: x + 0.5 + spread(rng, 0.4),
      y: y + 0.5 + spread(rng, 0.4),
      z: z + 0.5 + spread(rng, 0.4),
      vx: spread(rng, 0.12), vy: rng.nextFloat() * 0.1 + 0.05, vz: spread(rng, 0.12),
      blockLayer: layer,
      // Deterministic quadrant selector; block particles are not sprite-animated.
      spriteFrame: Math.floor(rng.nextFloat() * 4),
      size: 0.1 + rng.nextFloat() * 0.08,
    });
    if (idx >= 0) made++;
  }
  return made;
}

/** Explosion burst: one big explosion sprite plus smoke and flame. */
export function spawnExplosion(x: number, y: number, z: number, radius = 1): number {
  const e = ParticleEngine.get();
  const rng = e.random;
  let made = 0;
  const add = (spec: ParticleSpec) => { if (e.add(spec) >= 0) made++; };
  add({
    type: ParticleType.EXPLOSION, x, y, z,
    vx: 0, vy: 0, vz: 0, size: radius * 1.2, lifetime: 12,
  });
  for (let i = 0; i < 12; i++) {
    const a = rng.nextFloat() * Math.PI * 2;
    const s = (0.2 + rng.nextFloat() * 0.3) * radius;
    add({
      type: ParticleType.SMOKE, x: x + spread(rng, 0.3), y: y + spread(rng, 0.3), z: z + spread(rng, 0.3),
      vx: Math.cos(a) * s, vy: rng.nextFloat() * 0.1, vz: Math.sin(a) * s,
      size: 0.2 + rng.nextFloat() * 0.2, lifetime: 30 + Math.floor(rng.nextFloat() * 20),
    });
  }
  for (let i = 0; i < 8; i++) {
    add({
      type: ParticleType.FLAME, x: x + spread(rng, 0.4), y: y + spread(rng, 0.4), z: z + spread(rng, 0.4),
      vx: spread(rng, 0.15), vy: rng.nextFloat() * 0.15, vz: spread(rng, 0.15),
      lifetime: 10 + Math.floor(rng.nextFloat() * 10),
    });
  }
  return made;
}

/** Water splash: splash droplets + a few bubbles. */
export function spawnSplash(x: number, y: number, z: number, count = 12): number {
  const e = ParticleEngine.get();
  const rng = e.random;
  let made = 0;
  for (let i = 0; i < count; i++) {
    const spec: ParticleSpec = {
      type: i % 4 === 0 ? ParticleType.BUBBLE : ParticleType.SPLASH,
      x: x + spread(rng, 0.3), y: y + 0.05, z: z + spread(rng, 0.3),
      vx: spread(rng, 0.12), vy: 0.1 + rng.nextFloat() * 0.2, vz: spread(rng, 0.12),
    };
    if (e.add(spec) >= 0) made++;
  }
  return made;
}
