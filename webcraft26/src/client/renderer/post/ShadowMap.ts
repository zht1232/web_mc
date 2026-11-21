// Sun/moon shadow maps for the built-in shader pipeline.
//
// Reference: Complementary Shaders - Reimagined r5.9.3
//   shaders/program/shadow.glsl            depth-only shadow pass
//   shaders/lib/lighting/shadowSampling.glsl  PCF sampling + normal-offset bias
//
// Two cascades (near extent 40, far extent 132) instead of one large map: a single 2048 map
// covering the whole view distance gave ~0.5 block texels, which is what produced the blocky,
// banded shadow edges. The near cascade is ~0.04 block/texel and both are texel-snapped, so
// moving the camera does not make the edges crawl.
//
// The projection is built in world space: the light basis comes from the sun direction, the
// camera position is projected onto that basis and snapped to whole texels, so a sub-texel
// camera move leaves the matrix bit-identical.

import { GlProgram, extractFrustum, type Frustum } from '../gl/Gl.js';
import { SHADOW_FRAG, SHADOW_VERT } from './PostShaders.js';

export interface ShadowCamera {
  x: number; y: number; z: number;
}

interface Cascade {
  fbo: WebGLFramebuffer | null;
  tex: WebGLTexture | null;
  size: number;
  extent: number;
  view: Float32Array;
  proj: Float32Array;
  viewProj: Float32Array;
  frustum: Frustum;
  texel: number;
}

const CASCADE_EXTENTS = [40, 132] as const;
/** Distance from the (snapped) centre to the light, in blocks. */
const LIGHT_DISTANCE = 200;
/** Ortho depth range. Must be > LIGHT_DISTANCE so the centre is inside [near, far]. */
const DEPTH = 420;

export class ShadowMap {
  private readonly program: GlProgram;
  private readonly cascades: Cascade[] = [];
  /** Far cascade is rendered at half resolution: its texels are large anyway. */
  private baseSize = 0;
  /** Wind clock for the swaying plants; set by the renderer before the pass (see SHADOW_VERT). */
  swayTime = 0;

  constructor(private readonly gl: WebGL2RenderingContext, size = 2048) {
    this.program = new GlProgram(gl, SHADOW_VERT, SHADOW_FRAG, 'shadow');
    this.setSize(size);
  }

  get programHandle(): GlProgram { return this.program; }
  get count(): number { return this.cascades.length; }
  get size(): number { return this.baseSize; }

  /** Backwards-compatible aliases for the near cascade. */
  get texture(): WebGLTexture | null { return this.cascades[0]?.tex ?? null; }
  get lightViewProjection(): Float32Array { return this.cascades[0]?.viewProj ?? new Float32Array(16); }

  cascadeTexture(index: number): WebGLTexture | null { return this.cascades[index]?.tex ?? null; }
  cascadeMatrix(index: number): Float32Array { return this.cascades[index]?.viewProj ?? new Float32Array(16); }
  cascadeTexel(index: number): number { return this.cascades[index]?.texel ?? 0.001; }

  setSize(size: number): void {
    const s = Math.max(256, Math.floor(size));
    if (s === this.baseSize && this.cascades.length === CASCADE_EXTENTS.length) return;
    this.baseSize = s;
    const gl = this.gl;
    // (Re)create every cascade; the far one uses half the resolution.
    for (const c of this.cascades) {
      if (c.fbo) gl.deleteFramebuffer(c.fbo);
      if (c.tex) gl.deleteTexture(c.tex);
    }
    this.cascades.length = 0;

    CASCADE_EXTENTS.forEach((extent, i) => {
      const res = i === 0 ? s : Math.max(512, Math.floor(s / 2));
      const tex = gl.createTexture()!;
      gl.bindTexture(gl.TEXTURE_2D, tex);
      gl.texImage2D(gl.TEXTURE_2D, 0, gl.DEPTH_COMPONENT24, res, res, 0, gl.DEPTH_COMPONENT, gl.UNSIGNED_INT, null);
      // Plain sampler2D with a manual compare in the terrain shader: sampler2DShadow would force
      // every other user of TERRAIN_FRAG (gui/ItemIconAtlas) to back that unit with a depth texture.
      gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.NEAREST);
      gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.NEAREST);
      gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
      gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
      gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_COMPARE_MODE, gl.NONE);

      const fbo = gl.createFramebuffer()!;
      gl.bindFramebuffer(gl.FRAMEBUFFER, fbo);
      gl.framebufferTexture2D(gl.FRAMEBUFFER, gl.DEPTH_ATTACHMENT, gl.TEXTURE_2D, tex, 0);
      gl.drawBuffers([gl.NONE]);
      gl.readBuffer(gl.NONE);
      const status = gl.checkFramebufferStatus(gl.FRAMEBUFFER);
      if (status !== gl.FRAMEBUFFER_COMPLETE) console.warn('[shadow] framebuffer incomplete', i, status);
      gl.bindFramebuffer(gl.FRAMEBUFFER, null);

      this.cascades.push({
        fbo, tex, size: res, extent,
        view: new Float32Array(16), proj: new Float32Array(16), viewProj: new Float32Array(16),
        frustum: { planes: new Float32Array(24) },
        texel: (2 * extent) / res,
      });
    });
  }

  /** Recomputes every cascade matrix for this frame. */
  update(camera: ShadowCamera, toSun: readonly [number, number, number]): void {
    const len = Math.hypot(toSun[0], toSun[1], toSun[2]) || 1;
    const lx = toSun[0] / len, ly = toSun[1] / len, lz = toSun[2] / len;
    const fx = -lx, fy = -ly, fz = -lz;
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

    for (const c of this.cascades) {
      // Texel snapping on the light basis.
      const texel = (2 * c.extent) / c.size;
      const projX = camera.x * sx + camera.y * sy + camera.z * sz;
      const projY = camera.x * ux + camera.y * uy + camera.z * uz;
      const snapX = Math.floor(projX / texel) * texel;
      const snapY = Math.floor(projY / texel) * texel;
      const cx = camera.x + sx * (snapX - projX) + ux * (snapY - projY);
      const cy = camera.y + sy * (snapX - projX) + uy * (snapY - projY);
      const cz = camera.z + sz * (snapX - projX) + uz * (snapY - projY);

      const eyeX = cx + lx * LIGHT_DISTANCE;
      const eyeY = cy + ly * LIGHT_DISTANCE;
      const eyeZ = cz + lz * LIGHT_DISTANCE;

      c.view[0] = sx; c.view[4] = sy; c.view[8] = sz; c.view[12] = -(sx * eyeX + sy * eyeY + sz * eyeZ);
      c.view[1] = ux; c.view[5] = uy; c.view[9] = uz; c.view[13] = -(ux * eyeX + uy * eyeY + uz * eyeZ);
      c.view[2] = -fx; c.view[6] = -fy; c.view[10] = -fz; c.view[14] = -(-fx * eyeX + -fy * eyeY + -fz * eyeZ);
      c.view[3] = 0; c.view[7] = 0; c.view[11] = 0; c.view[15] = 1;

      const l = -c.extent, r = c.extent, b = -c.extent, t = c.extent;
      const n = 1, f = DEPTH;
      c.proj[0] = 2 / (r - l);
      c.proj[5] = 2 / (t - b);
      c.proj[10] = -2 / (f - n);
      c.proj[12] = -(r + l) / (r - l);
      c.proj[13] = -(t + b) / (t - b);
      c.proj[14] = -(f + n) / (f - n);
      c.proj[15] = 1;

      for (let col = 0; col < 4; col++) {
        for (let row = 0; row < 4; row++) {
          c.viewProj[col * 4 + row] =
            c.proj[0 * 4 + row] * c.view[col * 4 + 0] +
            c.proj[1 * 4 + row] * c.view[col * 4 + 1] +
            c.proj[2 * 4 + row] * c.view[col * 4 + 2] +
            c.proj[3 * 4 + row] * c.view[col * 4 + 3];
        }
      }
      const updated = extractFrustum(c.viewProj);
      c.frustum.planes.set(updated.planes);
    }
  }

  frustumOf(index: number): Frustum { return this.cascades[index].frustum; }
  extentOf(index: number): number { return this.cascades[index].extent; }

  /** Binds cascade `index`'s target, clears depth and sets up the depth-only state. */
  begin(index = 0): void {
    const gl = this.gl;
    const c = this.cascades[index];
    if (!c) return;
    gl.bindFramebuffer(gl.FRAMEBUFFER, c.fbo);
    gl.viewport(0, 0, c.size, c.size);
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
    this.program.setMat4('uLightViewProj', c.viewProj);
    this.program.set1f('uAlphaTest', 0.1);
    this.program.set1f('uSwayTime', this.swayTime);
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
    for (const c of this.cascades) {
      if (c.fbo) gl.deleteFramebuffer(c.fbo);
      if (c.tex) gl.deleteTexture(c.tex);
      c.fbo = null;
      c.tex = null;
    }
  }
}
