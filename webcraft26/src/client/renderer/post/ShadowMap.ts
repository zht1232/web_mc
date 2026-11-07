// Sun/moon shadow map for the built-in shader pipeline (TASK-render Phase B.1).
//
// Reference: Complementary Shaders - Reimagined r5.9.3
//   shaders/program/shadow.glsl            depth-only shadow pass
//   shaders/lib/lighting/shadowSampling.glsl  PCF sampling + normal-offset bias
// The Iris pack renders two cascaded maps into shadowtex0/1 through the Iris pipeline;
// a WebGL2 back end only has one depth target, so this is a single orthographic map that
// follows the camera, texel-snapped (no shimmer while walking) with the size driven by the
// shader quality tier (1024 / 2048 / 4096, default 2048).
//
// The projection is deliberately built in world space (not from a translation matrix):
// the light basis is derived from the sun direction, the camera position is projected onto
// that basis and snapped to whole texels, so moving the camera by less than one texel leaves
// the matrix bit-identical.

import { GlProgram, extractFrustum, type Frustum } from '../gl/Gl.js';
import { SHADOW_FRAG, SHADOW_VERT } from './PostShaders.js';

export interface ShadowCamera {
  x: number; y: number; z: number;
}

export interface ShadowRenderItem {
  cx: number; cz: number; sy: number;
}

export class ShadowMap {
  private readonly program: GlProgram;
  private fbo: WebGLFramebuffer | null = null;
  private tex: WebGLTexture | null = null;
  private sizeValue = 0;

  private readonly view = new Float32Array(16);
  private readonly proj = new Float32Array(16);
  private readonly viewProj = new Float32Array(16);
  readonly frustum: Frustum = { planes: new Float32Array(24) };

  /** Extent of the square ortho box around the camera, in blocks. */
  extent = 72;
  /** Distance from the (snapped) centre to the light, in blocks. */
  lightDistance = 140;
  /** Ortho depth range. Must be > lightDistance so the centre is inside [near, far]. */
  depth = 320;

  constructor(private readonly gl: WebGL2RenderingContext, size = 2048) {
    this.program = new GlProgram(gl, SHADOW_VERT, SHADOW_FRAG, 'shadow');
    this.setSize(size);
  }

  get programHandle(): GlProgram { return this.program; }
  get size(): number { return this.sizeValue; }
  get texture(): WebGLTexture | null { return this.tex; }
  get lightViewProjection(): Float32Array { return this.viewProj; }

  setSize(size: number): void {
    const s = Math.max(256, Math.floor(size));
    if (s === this.sizeValue) return;
    const gl = this.gl;
    if (this.fbo) gl.deleteFramebuffer(this.fbo);
    if (this.tex) gl.deleteTexture(this.tex);
    this.sizeValue = s;

    this.tex = gl.createTexture()!;
    gl.bindTexture(gl.TEXTURE_2D, this.tex);
    gl.texImage2D(gl.TEXTURE_2D, 0, gl.DEPTH_COMPONENT24, s, s, 0, gl.DEPTH_COMPONENT, gl.UNSIGNED_INT, null);
    // Sampled as a plain sampler2D (manual compare in the terrain shader): that keeps the
    // terrain program free of a sampler2DShadow sampler, which other passes that reuse
    // TERRAIN_FRAG (gui/ItemIconAtlas) would otherwise have to back with a depth texture.
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.NEAREST);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.NEAREST);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_COMPARE_MODE, gl.NONE);

    this.fbo = gl.createFramebuffer()!;
    gl.bindFramebuffer(gl.FRAMEBUFFER, this.fbo);
    gl.framebufferTexture2D(gl.FRAMEBUFFER, gl.DEPTH_ATTACHMENT, gl.TEXTURE_2D, this.tex, 0);
    gl.drawBuffers([gl.NONE]);
    gl.readBuffer(gl.NONE);
    const status = gl.checkFramebufferStatus(gl.FRAMEBUFFER);
    if (status !== gl.FRAMEBUFFER_COMPLETE) console.warn('[shadow] framebuffer incomplete', status);
    gl.bindFramebuffer(gl.FRAMEBUFFER, null);
  }

  /** Recomputes the light matrix for this frame and returns the sun direction used. */
  update(camera: ShadowCamera, toSun: readonly [number, number, number]): void {
    const len = Math.hypot(toSun[0], toSun[1], toSun[2]) || 1;
    const lx = toSun[0] / len, ly = toSun[1] / len, lz = toSun[2] / len;
    // Light view direction = from the sun towards the scene.
    const fx = -lx, fy = -ly, fz = -lz;
    // right = normalize(cross(forward, worldUp)); fall back to +Z when the sun is overhead.
    const upX = Math.abs(fy) > 0.99 ? 0 : 0;
    const upY = Math.abs(fy) > 0.99 ? 0 : 1;
    const upZ = Math.abs(fy) > 0.99 ? 1 : 0;
    let sx = fy * upZ - fz * upY;
    let sy = fz * upX - fx * upZ;
    let sz = fx * upY - fy * upX;
    const sl = Math.hypot(sx, sy, sz) || 1;
    sx /= sl; sy /= sl; sz /= sl;
    const ux = sy * fz - sz * fy;
    const uy = sz * fx - sx * fz;
    const uz = sx * fy - sy * fx;

    // Texel snapping: project the camera centre on the light basis, quantise, then use the
    // quantised centre. A sub-texel camera move therefore produces the same matrix.
    const texel = (2 * this.extent) / this.sizeValue;
    const projX = camera.x * sx + camera.y * sy + camera.z * sz;
    const projY = camera.x * ux + camera.y * uy + camera.z * uz;
    const snapX = Math.floor(projX / texel) * texel;
    const snapY = Math.floor(projY / texel) * texel;
    const cx = camera.x + sx * (snapX - projX) + ux * (snapY - projY);
    const cy = camera.y + sy * (snapX - projX) + uy * (snapY - projY);
    const cz = camera.z + sz * (snapX - projX) + uz * (snapY - projY);

    const eyeX = cx + lx * this.lightDistance;
    const eyeY = cy + ly * this.lightDistance;
    const eyeZ = cz + lz * this.lightDistance;

    // look-at view matrix, columns = (right, up, -forward)
    this.view[0] = sx; this.view[4] = sy; this.view[8] = sz; this.view[12] = -(sx * eyeX + sy * eyeY + sz * eyeZ);
    this.view[1] = ux; this.view[5] = uy; this.view[9] = uz; this.view[13] = -(ux * eyeX + uy * eyeY + uz * eyeZ);
    this.view[2] = -fx; this.view[6] = -fy; this.view[10] = -fz; this.view[14] = -(-fx * eyeX + -fy * eyeY + -fz * eyeZ);
    this.view[3] = 0; this.view[7] = 0; this.view[11] = 0; this.view[15] = 1;

    // Orthographic projection, z mapped to [-1, 1] (the shader converts to [0, 1] for compare).
    const l = -this.extent, r = this.extent, b = -this.extent, t = this.extent;
    const n = 1, f = this.depth;
    this.proj[0] = 2 / (r - l);
    this.proj[5] = 2 / (t - b);
    this.proj[10] = -2 / (f - n);
    this.proj[12] = -(r + l) / (r - l);
    this.proj[13] = -(t + b) / (t - b);
    this.proj[14] = -(f + n) / (f - n);
    this.proj[15] = 1;

    // viewProj = proj * view
    for (let c = 0; c < 4; c++) {
      for (let row = 0; row < 4; row++) {
        this.viewProj[c * 4 + row] =
          this.proj[0 * 4 + row] * this.view[c * 4 + 0] +
          this.proj[1 * 4 + row] * this.view[c * 4 + 1] +
          this.proj[2 * 4 + row] * this.view[c * 4 + 2] +
          this.proj[3 * 4 + row] * this.view[c * 4 + 3];
      }
    }
    const updated = extractFrustum(this.viewProj);
    this.frustum.planes.set(updated.planes);
  }

  /** Binds the shadow target, clears depth and sets up the depth-only state. */
  begin(): void {
    const gl = this.gl;
    gl.bindFramebuffer(gl.FRAMEBUFFER, this.fbo);
    gl.viewport(0, 0, this.sizeValue, this.sizeValue);
    gl.drawBuffers([gl.NONE]);
    gl.readBuffer(gl.NONE);
    gl.depthMask(true);
    gl.clear(gl.DEPTH_BUFFER_BIT);
    gl.enable(gl.DEPTH_TEST);
    gl.depthFunc(gl.LEQUAL);
    gl.enable(gl.CULL_FACE);
    gl.cullFace(gl.BACK);
    gl.disable(gl.BLEND);
    this.program.use();
    this.program.setMat4('uLightViewProj', this.viewProj);
    this.program.set1f('uAlphaTest', 0.1);
  }

  end(): void {
    const gl = this.gl;
    gl.bindFramebuffer(gl.FRAMEBUFFER, null);
    gl.depthMask(true);
    gl.enable(gl.DEPTH_TEST);
    gl.depthFunc(gl.LEQUAL);
    gl.enable(gl.CULL_FACE);
    gl.cullFace(gl.BACK);
    gl.disable(gl.BLEND);
  }

  dispose(): void {
    const gl = this.gl;
    if (this.fbo) gl.deleteFramebuffer(this.fbo);
    if (this.tex) gl.deleteTexture(this.tex);
    this.fbo = null;
    this.tex = null;
  }
}
