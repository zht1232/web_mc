// HDR post-processing chain for the built-in "Complementary style" shaders.
//
// Reference: Complementary Shaders - Reimagined r5.9.3 (unpacked under
// G:/web_mc/_src/thirdparty/thirdparty/complementary-reimagined-r5.9.3). The pack is an
// Iris shader pack and cannot be dropped into WebGL2 (shadowtex0/1, colortex*, gbuffers_*
// are Iris built-ins), so this file re-implements the pass graph with its algorithms and
// default parameters:
//
//   scene FBO (HDR)  -> bloom prefilter -> mip chain -> 9-tap separable blur -> additive
//   upsample -> composite (Lottes 2016 tonemap, bloom MIX 0.12, saturation, vignette,
//   dither) -> FXAA 3.11 -> default framebuffer
//
// The pass order and the composite constants come from:
//   program/composite4.glsl:31-86  bloom tiles (wide gaussian, several LODs)
//   program/composite5.glsl:36-87  Lottes tonemap ("modified for Complementary")
//   program/composite5.glsl:89-104 BSL colour saturation
//   program/composite5.glsl:119-144 bloom reconstruction + BLOOM_STRENGTH mix
//   program/final.glsl:155-162     vignette + dither
//   lib/common.glsl:146,279-284    BLOOM_STRENGTH 0.12, TM_* defaults
//
// Off mode never touches a framebuffer: beginScene()/endScene() return immediately, so the
// frame is drawn straight into the default framebuffer exactly like the pre-shader build.

import { GlProgram, mat4Invert } from '../gl/Gl.js';
import {
  BLUR_FRAG, BLOOM_PREFILTER_FRAG, COMPOSITE_FRAG, FULLSCREEN_VERT, FXAA_FRAG,
  TAA_FRAG, UPSAMPLE_FRAG,
} from './PostShaders.js';

export type PostQuality = 'off' | 'low' | 'medium' | 'high' | 'ultra';
export const POST_QUALITIES: readonly PostQuality[] = ['off', 'low', 'medium', 'high', 'ultra'];

/** Bloom mip count per tier. Low is the "no bloom, no FXAA" tier required by the task. */
const BLOOM_MIPS: Record<PostQuality, number> = { off: 0, low: 0, medium: 4, high: 5, ultra: 6 };
/** Sun shadow map resolution per tier (task: 1024 / 2048 / 4096, 2048 default). */
export const SHADOW_SIZES: Record<PostQuality, number> = { off: 0, low: 1024, medium: 2048, high: 2048, ultra: 4096 };

interface BloomMip {
  tex: WebGLTexture;
  tmp: WebGLTexture;
  w: number;
  h: number;
}

export interface PostStats {
  enabled: boolean;
  quality: PostQuality;
  hdrFormat: string;
  bloomMips: number;
  frames: number;
  lastGlError: number;
  sceneBound: boolean;
  /** Scene depth is a sampleable texture (needed by the depth-based passes: SSAO/TAA). */
  depthTexture: boolean;
  /** Depth-difference SSAO active this frame (high/ultra tiers only). */
  ssao: boolean;
  /** Temporal anti-aliasing active this frame (high/ultra tiers only). */
  taa: boolean;
}

export class PostProcessor {
  private readonly composite: GlProgram;
  private readonly prefilter: GlProgram;
  private readonly blur: GlProgram;
  private readonly fxaa: GlProgram;
  private readonly upsample: GlProgram;
  private readonly taaPass: GlProgram;

  private readonly quadVao: WebGLVertexArrayObject;
  private readonly blackTex: WebGLTexture;

  /** Colours are sampled with LINEAR: the bloom chain downsamples with bilinear taps. */
  private sceneTex: WebGLTexture | null = null;
  private sceneFbo: WebGLFramebuffer | null = null;
  /** Scene depth. A texture when the driver allows it (depth-based post passes sample it). */
  private depthTex: WebGLTexture | null = null;
  private depthTextureOk = false;
  private depthRb: WebGLRenderbuffer | null = null;
  /**
   * Copy of the scene depth taken right after the world pass, BEFORE the first-person hand clears
   * the depth buffer (vanilla GameRenderer.renderLevel -> clearDepthTexture). Post effects must
   * sample this copy, otherwise they only see the hand.
   */
  private depthCopyTex: WebGLTexture | null = null;
  private depthCopyFbo: WebGLFramebuffer | null = null;
  private depthCopied = false;
  private ldrTex: WebGLTexture | null = null;
  private ldrFbo: WebGLFramebuffer | null = null;
  private mips: BloomMip[] = [];
  private mipTextures: WebGLTexture[] = [];

  private width = 0;
  private height = 0;
  private hdrFormat = 'RGBA8';
  private useHalfFloat = false;

  /** Set by LevelRenderer: false means the whole chain is bypassed (pixel-identical to Off). */
  enabled = true;
  private qualityValue: PostQuality = 'high';

  private sceneBound = false;
  private frameCount = 0;
  private lastGlError = 0;

  /** TM_EXPOSURE = 1.40: the pack assumes an HDR scene; our display-referred albedo is darker. */
  exposure = 1.4;
  /** BLOOM_STRENGTH = 0.12 (lib/common.glsl:146), mixed - not added - in composite5.glsl:142. */
  bloomStrength = 0.12;
  /**
   * The pack's bloom has no threshold (composite4.glsl blurs colortex0 directly). We use a
   * low soft-knee threshold in linear space so only the bright half of the frame glows; the
   * additive mip reconstruction is damped by 0.5 per level so the sum stays ~1x instead of
   * 5x (which would wash the scene out at a 0.12 mix).
   */
  bloomThreshold = 0.6;
  bloomKnee = 0.5;
  bloomUpsampleWeight = 0.5;
  /** Master switch for the sun/moon shadow pass (kept separate for cheap A/B debugging). */
  shadowsEnabled = true;
  /** 0 = normal, 1 = raw HDR scene, 2 = bloom only, 4 = SSAO mask (verification helper). */
  debug = 0;

  // ---- depth-difference SSAO (HANDOFF §8-2) -------------------------------
  /** Camera clip planes; LevelRenderer keeps these in sync with its projection (0.05 / 1024). */
  nearPlane = 0.05;
  farPlane = 1024;
  /** Screen-space sample radius in pixels and master strength (0 disables the term). */
  ssaoRadius = 4;
  ssaoStrength = 0.3;
  /** SSAO is a high/ultra tier feature and needs the sampleable depth texture. */
  get ssaoEnabled(): boolean {
    return this.enabled && this.depthTextureOk && this.ssaoStrength > 0
      && (this.qualityValue === 'high' || this.qualityValue === 'ultra');
  }

  // ---- TAA (HANDOFF §8-2) --------------------------------------------------
  /** History ping-pong (full-res HDR) + camera matrices for reprojection. */
  private historyTex: (WebGLTexture | null)[] = [null, null];
  private historyFbo: (WebGLFramebuffer | null)[] = [null, null];
  private historyIndex = 0;
  private historyValid = false;
  private readonly viewProj = new Float32Array(16);
  private readonly invViewProj = new Float32Array(16);
  private readonly prevViewProj = new Float32Array(16);
  private cameraReady = false;
  private jitterIndex = 0;
  /** Weight of the current frame in the temporal blend (0.1 = 90% history). */
  taaBlend = 0.1;
  /** A/B switch used by the regression test (and debugging): disables jitter + history blend. */
  taaOff = false;
  /** Halton(2,3) sub-pixel offsets; the projection is nudged by these while TAA is active. */
  private static readonly JITTER: ReadonlyArray<readonly [number, number]> = [
    [0.5, 0.333333], [0.25, 0.666667], [0.75, 0.111111], [0.125, 0.444444],
    [0.625, 0.777778], [0.375, 0.222222], [0.875, 0.555556], [0.0625, 0.888889],
  ];

  get taaEnabled(): boolean {
    return this.enabled && this.depthTextureOk && this.cameraReady && this.historyFbo[0] !== null
      && !this.taaOff
      && (this.qualityValue === 'high' || this.qualityValue === 'ultra');
  }

  /** Called by LevelRenderer right after it rebuilds the (possibly jittered) view-projection. */
  setCamera(viewProj: Float32Array, invViewProj: Float32Array): void {
    if (this.cameraReady) this.prevViewProj.set(this.viewProj);
    this.viewProj.set(viewProj);
    this.invViewProj.set(invViewProj);
    this.cameraReady = true;
  }

  /** Sub-pixel projection offset in pixels for this frame ([0,0] when TAA is off). */
  advanceJitter(): readonly [number, number] {
    if (!this.taaEnabled) return [0, 0];
    const j = PostProcessor.JITTER[this.jitterIndex % PostProcessor.JITTER.length];
    this.jitterIndex++;
    // Halton values are in (0,1); centre them around 0.
    return [j[0] - 0.5, j[1] - 0.5];
  }

  constructor(private readonly gl: WebGL2RenderingContext) {
    this.composite = new GlProgram(gl, FULLSCREEN_VERT, COMPOSITE_FRAG, 'post.composite');
    this.prefilter = new GlProgram(gl, FULLSCREEN_VERT, BLOOM_PREFILTER_FRAG, 'post.prefilter');
    this.blur = new GlProgram(gl, FULLSCREEN_VERT, BLUR_FRAG, 'post.blur');
    this.fxaa = new GlProgram(gl, FULLSCREEN_VERT, FXAA_FRAG, 'post.fxaa');
    this.upsample = new GlProgram(gl, FULLSCREEN_VERT, UPSAMPLE_FRAG, 'post.upsample');
    this.taaPass = new GlProgram(gl, FULLSCREEN_VERT, TAA_FRAG, 'post.taa');

    // Fullscreen triangle: (-1,-1) (3,-1) (-1,3) covers the whole clip space with one
    // primitive, so no diagonal seam and one fewer vertex than a quad.
    const vao = gl.createVertexArray()!;
    gl.bindVertexArray(vao);
    const vbo = gl.createBuffer()!;
    gl.bindBuffer(gl.ARRAY_BUFFER, vbo);
    gl.bufferData(gl.ARRAY_BUFFER, new Float32Array([-1, -1, 3, -1, -1, 3]), gl.STATIC_DRAW);
    gl.enableVertexAttribArray(0);
    gl.vertexAttribPointer(0, 2, gl.FLOAT, false, 8, 0);
    gl.bindVertexArray(null);
    this.quadVao = vao;

    this.blackTex = gl.createTexture()!;
    gl.bindTexture(gl.TEXTURE_2D, this.blackTex);
    gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA8, 1, 1, 0, gl.RGBA, gl.UNSIGNED_BYTE, new Uint8Array([0, 0, 0, 255]));
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.NEAREST);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.NEAREST);

    this.qualityValue = 'high';
  }

  get quality(): PostQuality { return this.qualityValue; }

  /** `renderer.shadersEnabled` and the VideoSettings toggle land here. */
  setEnabled(value: boolean): void {
    this.enabled = value;
    // The camera moved while the chain was bypassed: never blend with that stale history.
    if (!value) this.historyValid = false;
  }

  setQuality(value: string): void {
    const q = (POST_QUALITIES as readonly string[]).includes(value) ? (value as PostQuality) : 'high';
    if (q === this.qualityValue) return;
    this.qualityValue = q;
    // Bloom / shadow resources are re-created lazily on the next beginScene().
    this.releaseTargets();
  }

  get shadowSize(): number { return SHADOW_SIZES[this.qualityValue] || 2048; }

  get stats(): PostStats {
    return {
      enabled: this.enabled,
      quality: this.qualityValue,
      hdrFormat: this.hdrFormat,
      bloomMips: this.mips.length,
      frames: this.frameCount,
      lastGlError: this.gl.getError(),
      sceneBound: this.sceneBound,
      depthTexture: this.depthTextureOk,
      ssao: this.ssaoEnabled,
      taa: this.taaEnabled,
    };
  }

  /** True when the scene depth attachment is a texture that post passes can sample. */
  get depthTextureAvailable(): boolean { return this.depthTextureOk; }

  /** Called by LevelRenderer after it rebuilds the projection so the SSAO linearisation matches. */
  setDepthRange(near: number, far: number): void {
    this.nearPlane = near;
    this.farPlane = far;
  }

  // ------------------------------------------------------------------ targets

  /**
   * Allocates the HDR scene target, the LDR intermediate (for FXAA) and the bloom mips.
   * RGBA16F needs EXT_color_buffer_float; without it the scene falls back to RGBA8 and the
   * chain still works (highlight headroom is simply clipped at 1.0).
   */
  resize(width: number, height: number): void {
    const w = Math.max(1, Math.floor(width));
    const h = Math.max(1, Math.floor(height));
    if (w === this.width && h === this.height && this.sceneFbo) return;
    this.width = w;
    this.height = h;
    this.releaseTargets();
  }

  private releaseTargets(): void {
    const gl = this.gl;
    for (const f of [...this.mipFbos, ...this.tmpFbos]) if (f) gl.deleteFramebuffer(f);
    this.mipFbos = [];
    this.tmpFbos = [];
    if (this.sceneFbo) gl.deleteFramebuffer(this.sceneFbo);
    if (this.depthRb) gl.deleteRenderbuffer(this.depthRb);
    if (this.sceneTex) gl.deleteTexture(this.sceneTex);
    if (this.depthTex) gl.deleteTexture(this.depthTex);
    if (this.depthCopyFbo) gl.deleteFramebuffer(this.depthCopyFbo);
    if (this.depthCopyTex) gl.deleteTexture(this.depthCopyTex);
    for (const f of this.historyFbo) if (f) gl.deleteFramebuffer(f);
    for (const t of this.historyTex) if (t) gl.deleteTexture(t);
    this.historyFbo = [null, null];
    this.historyTex = [null, null];
    this.historyValid = false;
    this.jitterIndex = 0;
    if (this.ldrFbo) gl.deleteFramebuffer(this.ldrFbo);
    if (this.ldrTex) gl.deleteTexture(this.ldrTex);
    for (const t of this.mipTextures) gl.deleteTexture(t);
    this.sceneFbo = null;
    this.depthRb = null;
    this.sceneTex = null;
    this.depthTex = null;
    this.depthTextureOk = false;
    this.depthCopyTex = null;
    this.depthCopyFbo = null;
    this.depthCopied = false;
    this.ldrFbo = null;
    this.ldrTex = null;
    this.mips = [];
    this.mipTextures = [];
  }

  private ensureTargets(): void {
    if (this.sceneFbo && this.width > 0 && this.height > 0) return;
    if (this.width <= 0 || this.height <= 0) return;
    const gl = this.gl;

    this.useHalfFloat = !!gl.getExtension('EXT_color_buffer_float');
    const internalFormat = this.useHalfFloat ? gl.RGBA16F : gl.RGBA8;
    const type = this.useHalfFloat ? gl.HALF_FLOAT : gl.UNSIGNED_BYTE;
    this.hdrFormat = this.useHalfFloat ? 'RGBA16F' : 'RGBA8';

    // --- scene colour + depth
    this.sceneTex = gl.createTexture()!;
    gl.bindTexture(gl.TEXTURE_2D, this.sceneTex);
    gl.texImage2D(gl.TEXTURE_2D, 0, internalFormat, this.width, this.height, 0, gl.RGBA, type, null);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.LINEAR);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);

    this.sceneFbo = gl.createFramebuffer()!;
    gl.bindFramebuffer(gl.FRAMEBUFFER, this.sceneFbo);
    gl.framebufferTexture2D(gl.FRAMEBUFFER, gl.COLOR_ATTACHMENT0, gl.TEXTURE_2D, this.sceneTex, 0);
    // Depth as a texture so depth-based post passes (SSAO/TAA) can read it. WebGL2 depth textures
    // are sampleable; a renderbuffer fallback keeps the scene working if the driver rejects it.
    this.depthTextureOk = false;
    if (this.depthTex) { gl.deleteTexture(this.depthTex); this.depthTex = null; }
    this.depthTex = gl.createTexture()!;
    gl.bindTexture(gl.TEXTURE_2D, this.depthTex);
    gl.texImage2D(gl.TEXTURE_2D, 0, gl.DEPTH_COMPONENT24, this.width, this.height, 0,
      gl.DEPTH_COMPONENT, gl.UNSIGNED_INT, null);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.NEAREST);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.NEAREST);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
    gl.framebufferTexture2D(gl.FRAMEBUFFER, gl.DEPTH_ATTACHMENT, gl.TEXTURE_2D, this.depthTex, 0);
    gl.drawBuffers([gl.COLOR_ATTACHMENT0]);

    let complete = gl.checkFramebufferStatus(gl.FRAMEBUFFER) === gl.FRAMEBUFFER_COMPLETE;
    if (!complete && this.useHalfFloat) {
      // The driver exposes the extension but cannot render to RGBA16F: redo as RGBA8.
      gl.framebufferTexture2D(gl.FRAMEBUFFER, gl.COLOR_ATTACHMENT0, gl.TEXTURE_2D, null, 0);
      gl.deleteTexture(this.sceneTex);
      gl.bindTexture(gl.TEXTURE_2D, this.sceneTex = gl.createTexture()!);
      gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA8, this.width, this.height, 0, gl.RGBA, gl.UNSIGNED_BYTE, null);
      gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR);
      gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.LINEAR);
      gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
      gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
      gl.framebufferTexture2D(gl.FRAMEBUFFER, gl.COLOR_ATTACHMENT0, gl.TEXTURE_2D, this.sceneTex, 0);
      this.useHalfFloat = false;
      this.hdrFormat = 'RGBA8';
      complete = gl.checkFramebufferStatus(gl.FRAMEBUFFER) === gl.FRAMEBUFFER_COMPLETE;
      if (!complete) console.warn('[post] HDR framebuffer incomplete, shaders disabled');
    }

    // Depth texture rejected together with the colour format: fall back to a plain renderbuffer and
    // disable the depth-based passes instead of failing the whole shader path.
    if (complete) {
      this.depthTextureOk = true;
    } else {
      gl.framebufferTexture2D(gl.FRAMEBUFFER, gl.DEPTH_ATTACHMENT, gl.TEXTURE_2D, null, 0);
      if (this.depthTex) { gl.deleteTexture(this.depthTex); this.depthTex = null; }
      this.depthRb = gl.createRenderbuffer()!;
      gl.bindRenderbuffer(gl.RENDERBUFFER, this.depthRb);
      gl.renderbufferStorage(gl.RENDERBUFFER, gl.DEPTH_COMPONENT24, this.width, this.height);
      gl.framebufferRenderbuffer(gl.FRAMEBUFFER, gl.DEPTH_ATTACHMENT, gl.RENDERBUFFER, this.depthRb);
      complete = gl.checkFramebufferStatus(gl.FRAMEBUFFER) === gl.FRAMEBUFFER_COMPLETE;
      if (!complete) console.warn('[post] scene framebuffer incomplete, shaders disabled');
    }

    // Depth-only target for the pre-hand snapshot (blitFramebuffer DEPTH_BUFFER_BIT).
    if (this.depthTextureOk) {
      if (this.depthCopyTex) gl.deleteTexture(this.depthCopyTex);
      if (this.depthCopyFbo) gl.deleteFramebuffer(this.depthCopyFbo);
      this.depthCopyTex = gl.createTexture()!;
      gl.bindTexture(gl.TEXTURE_2D, this.depthCopyTex);
      gl.texImage2D(gl.TEXTURE_2D, 0, gl.DEPTH_COMPONENT24, this.width, this.height, 0,
        gl.DEPTH_COMPONENT, gl.UNSIGNED_INT, null);
      gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.NEAREST);
      gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.NEAREST);
      gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
      gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
      this.depthCopyFbo = gl.createFramebuffer()!;
      gl.bindFramebuffer(gl.FRAMEBUFFER, this.depthCopyFbo);
      gl.framebufferTexture2D(gl.FRAMEBUFFER, gl.DEPTH_ATTACHMENT, gl.TEXTURE_2D, this.depthCopyTex, 0);
      gl.drawBuffers([gl.NONE]);
      if (gl.checkFramebufferStatus(gl.FRAMEBUFFER) !== gl.FRAMEBUFFER_COMPLETE) {
        console.warn('[post] depth-copy framebuffer incomplete; depth post effects disabled');
        gl.deleteFramebuffer(this.depthCopyFbo);
        gl.deleteTexture(this.depthCopyTex);
        this.depthCopyFbo = null;
        this.depthCopyTex = null;
      }
    }

    // --- LDR intermediate for the FXAA pass
    this.ldrTex = gl.createTexture()!;
    gl.bindTexture(gl.TEXTURE_2D, this.ldrTex);
    gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA8, this.width, this.height, 0, gl.RGBA, gl.UNSIGNED_BYTE, null);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.LINEAR);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
    this.ldrFbo = gl.createFramebuffer()!;
    gl.bindFramebuffer(gl.FRAMEBUFFER, this.ldrFbo);
    gl.framebufferTexture2D(gl.FRAMEBUFFER, gl.COLOR_ATTACHMENT0, gl.TEXTURE_2D, this.ldrTex, 0);
    gl.drawBuffers([gl.COLOR_ATTACHMENT0]);

    // --- bloom mip chain (half resolution, each level half of the previous)
    const mipCount = BLOOM_MIPS[this.qualityValue];
    let mw = Math.max(1, this.width >> 1);
    let mh = Math.max(1, this.height >> 1);
    for (let i = 0; i < mipCount; i++) {
      const pair = [this.createMipTexture(mw, mh), this.createMipTexture(mw, mh)];
      this.mipTextures.push(...pair);
      this.mips.push({ tex: pair[0], tmp: pair[1], w: mw, h: mh });
      mw = Math.max(1, mw >> 1);
      mh = Math.max(1, mh >> 1);
    }

    // --- TAA history ping-pong (full resolution, same HDR format as the scene target)
    for (let i = 0; i < 2; i++) {
      this.historyTex[i] = this.createMipTexture(this.width, this.height);
      const fbo = gl.createFramebuffer()!;
      gl.bindFramebuffer(gl.FRAMEBUFFER, fbo);
      gl.framebufferTexture2D(gl.FRAMEBUFFER, gl.COLOR_ATTACHMENT0, gl.TEXTURE_2D, this.historyTex[i], 0);
      gl.drawBuffers([gl.COLOR_ATTACHMENT0]);
      this.historyFbo[i] = fbo;
    }
    this.historyValid = false;

    gl.bindFramebuffer(gl.FRAMEBUFFER, null);
    gl.bindTexture(gl.TEXTURE_2D, null);
    gl.bindRenderbuffer(gl.RENDERBUFFER, null);
  }

  private createMipTexture(w: number, h: number): WebGLTexture {
    const gl = this.gl;
    const tex = gl.createTexture()!;
    gl.bindTexture(gl.TEXTURE_2D, tex);
    if (this.useHalfFloat) {
      gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA16F, w, h, 0, gl.RGBA, gl.HALF_FLOAT, null);
    } else {
      gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA8, w, h, 0, gl.RGBA, gl.UNSIGNED_BYTE, null);
    }
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.LINEAR);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
    return tex;
  }

  // ------------------------------------------------------------------ passes

  /**
   * Binds the HDR scene target and clears it with the current clear colour (Game.render sets
   * clearColor right before calling this). Returns false when shaders are off, in which case
   * the caller keeps drawing into the default framebuffer.
   */
  beginScene(): boolean {
    if (!this.enabled) return false;
    this.ensureTargets();
    if (!this.sceneFbo) { this.enabled = false; return false; }
    const gl = this.gl;
    gl.bindFramebuffer(gl.FRAMEBUFFER, this.sceneFbo);
    gl.viewport(0, 0, this.width, this.height);
    gl.clear(gl.COLOR_BUFFER_BIT | gl.DEPTH_BUFFER_BIT);
    this.sceneBound = true;
    this.depthCopied = false;
    return true;
  }

  /**
   * Snapshots the world depth before the first-person hand pass clears it (vanilla
   * GameRenderer.renderLevel -> clearDepthTexture). Depth-based post effects sample the copy.
   */
  captureDepth(): void {
    if (!this.enabled || !this.depthTextureOk || !this.sceneFbo || !this.depthCopyFbo || !this.depthCopyTex) return;
    const gl = this.gl;
    gl.bindFramebuffer(gl.READ_FRAMEBUFFER, this.sceneFbo);
    gl.bindFramebuffer(gl.DRAW_FRAMEBUFFER, this.depthCopyFbo);
    gl.blitFramebuffer(0, 0, this.width, this.height, 0, 0, this.width, this.height,
      gl.DEPTH_BUFFER_BIT, gl.NEAREST);
    gl.bindFramebuffer(gl.FRAMEBUFFER, this.sceneFbo);
    this.depthCopied = true;
  }

  /** True once captureDepth() ran this frame (the composite pass samples the copy). */
  get hasDepthCopy(): boolean { return this.depthCopied && this.depthCopyTex !== null; }

  /**
   * Re-binds the HDR scene target after a pass that had to render into its own framebuffer
   * (the shadow map). Keeps the viewport in sync so the scene keeps rendering at full size.
   */
  bindSceneTarget(): void {
    if (!this.enabled || !this.sceneFbo) return;
    const gl = this.gl;
    gl.bindFramebuffer(gl.FRAMEBUFFER, this.sceneFbo);
    gl.viewport(0, 0, this.width, this.height);
    gl.drawBuffers([gl.COLOR_ATTACHMENT0]);
    this.sceneBound = true;
  }

  /** Resolves the scene: bloom chain + composite/tonemap + FXAA, then restores GL state. */
  endScene(): void {
    if (!this.enabled || !this.sceneBound) return;
    this.sceneBound = false;
    const gl = this.gl;
    if (!this.sceneFbo || !this.sceneTex) return;

    gl.bindVertexArray(this.quadVao);
    gl.disable(gl.DEPTH_TEST);
    gl.disable(gl.CULL_FACE);
    gl.disable(gl.BLEND);
    gl.depthMask(false);

    // TAA resolve first (the hand is drawn after endScene, so the history stays world-only), then
    // everything downstream (bloom prefilter + composite) reads the resolved colour.
    const colorTex = (this.taaEnabled && this.sceneTex) ? (this.runTaa() ?? this.sceneTex) : this.sceneTex;
    const bloom = this.mips.length > 0 ? this.runBloomChain(colorTex) : this.blackTex;
    const useFxaa = this.qualityValue !== 'low';

    // Composite -> LDR intermediate (so FXAA can read it), or straight to the screen.
    gl.bindFramebuffer(gl.FRAMEBUFFER, useFxaa ? this.ldrFbo : null);
    gl.viewport(0, 0, this.width, this.height);
    this.composite.use();
    gl.activeTexture(gl.TEXTURE0);
    gl.bindTexture(gl.TEXTURE_2D, colorTex);
    this.composite.set1i('uColor', 0);
    gl.activeTexture(gl.TEXTURE1);
    gl.bindTexture(gl.TEXTURE_2D, bloom);
    this.composite.set1i('uBloom', 1);
    gl.activeTexture(gl.TEXTURE2);
    gl.bindTexture(gl.TEXTURE_2D, this.hasDepthCopy ? this.depthCopyTex : (this.depthTex ?? this.blackTex));
    this.composite.set1i('uDepth', 2);
    this.composite.set1f('uNear', this.nearPlane);
    this.composite.set1f('uFar', this.farPlane);
    this.composite.set1f('uAoRadius', this.ssaoRadius);
    this.composite.set1f('uAoStrength', this.ssaoEnabled ? this.ssaoStrength : 0);
    this.composite.set2f('uResolution', this.width, this.height);
    this.composite.set1f('uExposure', this.exposure);
    this.composite.set1f('uBloomStrength', this.mips.length > 0 ? this.bloomStrength : 0);
    this.composite.set1f('uTime', (performance.now() / 1000) % 1000);
    this.composite.set1i('uDebug', this.debug);
    gl.drawArrays(gl.TRIANGLES, 0, 3);

    if (useFxaa) {
      gl.bindFramebuffer(gl.FRAMEBUFFER, null);
      gl.viewport(0, 0, this.width, this.height);
      this.fxaa.use();
      gl.activeTexture(gl.TEXTURE0);
      gl.bindTexture(gl.TEXTURE_2D, this.ldrTex);
      this.fxaa.set1i('uColor', 0);
      this.fxaa.set2f('uTexel', 1 / this.width, 1 / this.height);
      gl.drawArrays(gl.TRIANGLES, 0, 3);
    }

    // Back to the contract the environment/entity passes assume on entry.
    gl.bindVertexArray(null);
    gl.activeTexture(gl.TEXTURE0);
    gl.disable(gl.BLEND);
    gl.depthMask(true);
    gl.enable(gl.DEPTH_TEST);
    gl.enable(gl.CULL_FACE);
    gl.cullFace(gl.BACK);
    gl.viewport(0, 0, this.width, this.height);

    this.frameCount++;
    // gl.getError() forces a CPU/GPU sync (~25% of the frame on the main thread), so it is only queried
    // on demand from the stats getter instead of once per frame.
  }

  /**
   * Temporal resolve: reproject the previous resolved colour through the depth copy and blend it
   * with the current jittered frame. Returns the freshly written history texture.
   */
  private runTaa(): WebGLTexture | null {
    const gl = this.gl;
    const read = this.historyIndex;
    const write = 1 - read;
    const readTex = this.historyTex[read];
    const writeFbo = this.historyFbo[write];
    if (!readTex || !writeFbo || !this.depthCopyTex || !this.sceneTex) return null;

    gl.bindFramebuffer(gl.FRAMEBUFFER, writeFbo);
    gl.viewport(0, 0, this.width, this.height);
    this.taaPass.use();
    gl.activeTexture(gl.TEXTURE0);
    gl.bindTexture(gl.TEXTURE_2D, this.sceneTex);
    this.taaPass.set1i('uColor', 0);
    gl.activeTexture(gl.TEXTURE1);
    gl.bindTexture(gl.TEXTURE_2D, readTex);
    this.taaPass.set1i('uHistory', 1);
    gl.activeTexture(gl.TEXTURE2);
    gl.bindTexture(gl.TEXTURE_2D, this.depthCopyTex);
    this.taaPass.set1i('uDepth', 2);
    this.taaPass.setMat4('uInvViewProj', this.invViewProj);
    this.taaPass.setMat4('uPrevViewProj', this.prevViewProj);
    this.taaPass.set2f('uResolution', this.width, this.height);
    this.taaPass.set1f('uBlend', this.taaBlend);
    this.taaPass.set1f('uReset', this.historyValid ? 0 : 1);
    gl.drawArrays(gl.TRIANGLES, 0, 3);
    gl.activeTexture(gl.TEXTURE0);
    this.historyIndex = write;
    this.historyValid = true;
    return this.historyTex[write];
  }

  /** Prefilter -> downsample chain -> separable gaussian per mip -> additive upsample. */
  private runBloomChain(colorTex: WebGLTexture): WebGLTexture {
    const gl = this.gl;
    const mips = this.mips;

    // 1. prefilter from the HDR scene into mip 0 (soft-knee threshold in linear space)
    gl.bindFramebuffer(gl.FRAMEBUFFER, this.mipFbo(0));
    gl.viewport(0, 0, mips[0].w, mips[0].h);
    gl.activeTexture(gl.TEXTURE0);
    gl.bindTexture(gl.TEXTURE_2D, colorTex);
    this.prefilter.use();
    this.prefilter.set1i('uColor', 0);
    this.prefilter.set2f('uTexel', 1 / this.width, 1 / this.height);
    this.prefilter.set1f('uThreshold', this.bloomThreshold);
    this.prefilter.set1f('uSoftKnee', this.bloomKnee);
    this.prefilter.set1f('uLinearize', 1);
    gl.drawArrays(gl.TRIANGLES, 0, 3);

    // 2. downsample: every following mip is a 4-tap box of the previous one
    for (let i = 1; i < mips.length; i++) {
      gl.bindFramebuffer(gl.FRAMEBUFFER, this.mipFbo(i));
      gl.viewport(0, 0, mips[i].w, mips[i].h);
      gl.bindTexture(gl.TEXTURE_2D, mips[i - 1].tex);
      this.prefilter.set2f('uTexel', 1 / mips[i - 1].w, 1 / mips[i - 1].h);
      this.prefilter.set1f('uThreshold', 0);
      this.prefilter.set1f('uSoftKnee', 1);
      this.prefilter.set1f('uLinearize', 0);
      gl.drawArrays(gl.TRIANGLES, 0, 3);
    }

    // 3. 9-tap separable gaussian per mip (BLUR_FRAG, sigma ~= 2.2)
    this.blur.use();
    this.blur.set1i('uColor', 0);
    for (const mip of mips) {
      gl.bindFramebuffer(gl.FRAMEBUFFER, this.tmpFbo(mip));
      gl.viewport(0, 0, mip.w, mip.h);
      gl.bindTexture(gl.TEXTURE_2D, mip.tex);
      this.blur.set2f('uDirection', 1 / mip.w, 0);
      gl.drawArrays(gl.TRIANGLES, 0, 3);

      gl.bindFramebuffer(gl.FRAMEBUFFER, this.mipFboOf(mip));
      gl.viewport(0, 0, mip.w, mip.h);
      gl.bindTexture(gl.TEXTURE_2D, mip.tmp);
      this.blur.set2f('uDirection', 0, 1 / mip.h);
      gl.drawArrays(gl.TRIANGLES, 0, 3);
    }
    this.blur.set2f('uDirection', 0, 0);

    // 4. additive upsample: mip[i] += mip[i+1] (bilinear), smallest to largest
    this.upsample.use();
    this.upsample.set1i('uColor', 0);
    gl.enable(gl.BLEND);
    gl.blendFunc(gl.ONE, gl.ONE);
    for (let i = mips.length - 2; i >= 0; i--) {
      gl.bindFramebuffer(gl.FRAMEBUFFER, this.mipFbo(i));
      gl.viewport(0, 0, mips[i].w, mips[i].h);
      gl.bindTexture(gl.TEXTURE_2D, mips[i + 1].tex);
      this.upsample.set1f('uWeight', this.bloomUpsampleWeight);
      gl.drawArrays(gl.TRIANGLES, 0, 3);
    }
    gl.disable(gl.BLEND);
    return mips[0].tex;
  }

  // Bloom passes need transient framebuffers for the mip/temp textures. They are created the
  // first time the chain runs (a few objects, so it does not matter that they are not pooled).
  private mipFbos: (WebGLFramebuffer | null)[] = [];
  private tmpFbos: (WebGLFramebuffer | null)[] = [];

  private mipFbo(index: number): WebGLFramebuffer {
    this.ensureBloomFbos();
    return this.mipFbos[index]!;
  }

  private mipFboOf(mip: BloomMip): WebGLFramebuffer {
    const index = this.mips.indexOf(mip);
    return this.mipFbo(index);
  }

  private tmpFbo(mip: BloomMip): WebGLFramebuffer {
    this.ensureBloomFbos();
    const index = this.mips.indexOf(mip);
    return this.tmpFbos[index]!;
  }

  private ensureBloomFbos(): void {
    if (this.mipFbos.length === this.mips.length && this.mipFbos.length) return;
    const gl = this.gl;
    for (const f of [...this.mipFbos, ...this.tmpFbos]) if (f) gl.deleteFramebuffer(f);
    this.mipFbos = [];
    this.tmpFbos = [];
    for (const mip of this.mips) {
      const make = (tex: WebGLTexture) => {
        const fbo = gl.createFramebuffer()!;
        gl.bindFramebuffer(gl.FRAMEBUFFER, fbo);
        gl.framebufferTexture2D(gl.FRAMEBUFFER, gl.COLOR_ATTACHMENT0, gl.TEXTURE_2D, tex, 0);
        gl.drawBuffers([gl.COLOR_ATTACHMENT0]);
        return fbo;
      };
      this.mipFbos.push(make(mip.tex));
      this.tmpFbos.push(make(mip.tmp));
    }
    gl.bindFramebuffer(gl.FRAMEBUFFER, null);
  }

  dispose(): void {
    this.releaseTargets();
    const gl = this.gl;
    gl.deleteVertexArray(this.quadVao);
    gl.deleteTexture(this.blackTex);
    for (const f of [...this.mipFbos, ...this.tmpFbos]) if (f) gl.deleteFramebuffer(f);
    this.mipFbos = [];
    this.tmpFbos = [];
  }
}
