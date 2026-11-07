import { ShaderProgram } from './gl.js';

const FS_VS = `#version 300 es
precision highp float;
out vec2 vUv;
void main() {
  vec2 p = vec2(float((gl_VertexID << 1) & 2), float(gl_VertexID & 2));
  vUv = p;
  gl_Position = vec4(p * 2.0 - 1.0, 0.0, 1.0);
}`;

const EXTRACT_FS = `#version 300 es
precision highp float;
uniform sampler2D uScene;
uniform float uThreshold;
in vec2 vUv;
out vec4 outColor;
void main() {
  vec3 c = texture(uScene, vUv).rgb;
  float l = dot(c, vec3(0.2126, 0.7152, 0.0722));
  float k = max(0.0, l - uThreshold) / max(l, 0.0001);
  outColor = vec4(c * k, 1.0);
}`;

const BLUR_FS = `#version 300 es
precision highp float;
uniform sampler2D uTex;
uniform vec2 uStep;
in vec2 vUv;
out vec4 outColor;
void main() {
  vec3 c = texture(uTex, vUv).rgb * 0.2270270270;
  c += texture(uTex, vUv + uStep * 1.3846153846).rgb * 0.3162162162;
  c += texture(uTex, vUv - uStep * 1.3846153846).rgb * 0.3162162162;
  c += texture(uTex, vUv + uStep * 3.2307692308).rgb * 0.0702702703;
  c += texture(uTex, vUv - uStep * 3.2307692308).rgb * 0.0702702703;
  outColor = vec4(c, 1.0);
}`;

const COMPOSITE_FS = `#version 300 es
precision highp float;
uniform sampler2D uScene;
uniform sampler2D uBloom;
uniform vec2 uSunScreen;
uniform float uSunVisibility;
uniform float uBloomStrength;
uniform float uRayStrength;
uniform float uExposure;
uniform float uSaturation;
uniform float uContrast;
uniform float uVignette;
uniform float uUnderwater;
in vec2 vUv;
out vec4 outColor;

void main() {
  vec3 c = texture(uScene, vUv).rgb;
  vec3 bloom = texture(uBloom, vUv).rgb;
  c += bloom * uBloomStrength;

  if (uRayStrength > 0.0001 && uSunVisibility > 0.001) {
    vec2 delta = (uSunScreen - vUv) * (0.42 / 12.0);
    vec2 uv = vUv;
    vec3 rays = vec3(0.0);
    float weight = 1.0;
    for (int i = 0; i < 12; i++) {
      uv += delta;
      rays += texture(uBloom, clamp(uv, 0.0, 1.0)).rgb * weight;
      weight *= 0.84;
    }
    c += rays * (uRayStrength * uSunVisibility * 0.032);
  }

  float lum = dot(c, vec3(0.2126, 0.7152, 0.0722));
  c = mix(vec3(lum), c, uSaturation);
  c *= uExposure;
  c = mix(c, c * c * (3.0 - 2.0 * c), uContrast);
  vec2 q = vUv - 0.5;
  float vig = 1.0 - dot(q, q) * uVignette;
  c *= vig;
  c = mix(c, c * vec3(0.72, 0.86, 1.05) + vec3(0.01, 0.02, 0.05), uUnderwater * 0.35);
  outColor = vec4(clamp(c, 0.0, 1.0), 1.0);
}`;

export interface PostParams {
  sunScreen: [number, number];
  sunVisibility: number;
  underwater: boolean;
  time: number;
}

export class PostFX {
  private gl: WebGL2RenderingContext;
  private vao: WebGLVertexArrayObject;
  private extract: ShaderProgram;
  private blur: ShaderProgram;
  private composite: ShaderProgram;
  private sceneFbo: WebGLFramebuffer | null = null;
  private sceneTex: WebGLTexture | null = null;
  private depthTex: WebGLTexture | null = null;
  private bloomA: { fbo: WebGLFramebuffer; tex: WebGLTexture } | null = null;
  private bloomB: { fbo: WebGLFramebuffer; tex: WebGLTexture } | null = null;
  private width = 0;
  private height = 0;
  private bloomW = 0;
  private bloomH = 0;

  bloomEnabled = true;
  raysEnabled = true;
  bloomStrength = 0.34;
  rayStrength = 0.5;
  exposure = 1.02;
  saturation = 1.14;
  contrast = 0.16;
  vignette = 0.06;

  constructor(gl: WebGL2RenderingContext) {
    this.gl = gl;
    this.extract = new ShaderProgram(gl, FS_VS, EXTRACT_FS);
    this.blur = new ShaderProgram(gl, FS_VS, BLUR_FS);
    this.composite = new ShaderProgram(gl, FS_VS, COMPOSITE_FS);
    this.vao = gl.createVertexArray()!;
  }

  get sceneWidth(): number { return this.width; }
  get sceneHeight(): number { return this.height; }

  resize(width: number, height: number): void {
    const w = Math.max(1, Math.floor(width));
    const h = Math.max(1, Math.floor(height));
    if (w === this.width && h === this.height) return;
    this.width = w;
    this.height = h;
    this.bloomW = Math.max(1, w >> 1);
    this.bloomH = Math.max(1, h >> 1);
    this.disposeTargets();
    const scene = this.colorTarget(w, h, this.gl.NEAREST);
    const depth = this.depthTarget(w, h);
    const fbo = this.gl.createFramebuffer()!;
    this.gl.bindFramebuffer(this.gl.FRAMEBUFFER, fbo);
    this.gl.framebufferTexture2D(this.gl.FRAMEBUFFER, this.gl.COLOR_ATTACHMENT0, this.gl.TEXTURE_2D, scene.tex, 0);
    this.gl.framebufferTexture2D(this.gl.FRAMEBUFFER, this.gl.DEPTH_ATTACHMENT, this.gl.TEXTURE_2D, depth, 0);
    this.gl.bindFramebuffer(this.gl.FRAMEBUFFER, null);
    this.sceneFbo = fbo;
    this.sceneTex = scene.tex;
    this.depthTex = depth;
    this.bloomA = this.colorTarget(this.bloomW, this.bloomH, this.gl.LINEAR);
    this.bloomB = this.colorTarget(this.bloomW, this.bloomH, this.gl.LINEAR);
  }

  begin(): void {
    const gl = this.gl;
    gl.bindFramebuffer(gl.FRAMEBUFFER, this.sceneFbo);
    gl.viewport(0, 0, this.width, this.height);
  }

  end(params: PostParams): void {
    const gl = this.gl;
    if (!this.sceneFbo || !this.sceneTex || !this.bloomA || !this.bloomB) return;
    gl.bindFramebuffer(gl.FRAMEBUFFER, null);
    gl.viewport(0, 0, gl.drawingBufferWidth, gl.drawingBufferHeight);
    gl.disable(gl.BLEND);
    gl.disable(gl.DEPTH_TEST);
    gl.disable(gl.CULL_FACE);
    gl.bindVertexArray(this.vao);

    if (this.bloomEnabled) {
      gl.bindFramebuffer(gl.FRAMEBUFFER, this.bloomA.fbo);
      gl.viewport(0, 0, this.bloomW, this.bloomH);
      this.extract.use();
      gl.activeTexture(gl.TEXTURE0);
      gl.bindTexture(gl.TEXTURE_2D, this.sceneTex);
      this.extract.i('uScene', 0);
      this.extract.f('uThreshold', 0.82);
      gl.drawArrays(gl.TRIANGLES, 0, 3);

      gl.bindFramebuffer(gl.FRAMEBUFFER, this.bloomB.fbo);
      this.blur.use();
      gl.activeTexture(gl.TEXTURE0);
      gl.bindTexture(gl.TEXTURE_2D, this.bloomA.tex);
      this.blur.i('uTex', 0);
      this.blur.v2('uStep', 1 / this.bloomW, 0);
      gl.drawArrays(gl.TRIANGLES, 0, 3);

      gl.bindFramebuffer(gl.FRAMEBUFFER, this.bloomA.fbo);
      gl.activeTexture(gl.TEXTURE0);
      gl.bindTexture(gl.TEXTURE_2D, this.bloomB.tex);
      this.blur.i('uTex', 0);
      this.blur.v2('uStep', 0, 1 / this.bloomH);
      gl.drawArrays(gl.TRIANGLES, 0, 3);
    }

    gl.bindFramebuffer(gl.FRAMEBUFFER, null);
    gl.viewport(0, 0, gl.drawingBufferWidth, gl.drawingBufferHeight);
    this.composite.use();
    gl.activeTexture(gl.TEXTURE0);
    gl.bindTexture(gl.TEXTURE_2D, this.sceneTex);
    this.composite.i('uScene', 0);
    gl.activeTexture(gl.TEXTURE1);
    gl.bindTexture(gl.TEXTURE_2D, this.bloomA.tex);
    this.composite.i('uBloom', 1);
    this.composite.v2('uSunScreen', params.sunScreen[0], params.sunScreen[1]);
    this.composite.f('uSunVisibility', this.raysEnabled ? params.sunVisibility : 0);
    this.composite.f('uBloomStrength', this.bloomEnabled ? this.bloomStrength : 0);
    this.composite.f('uRayStrength', this.raysEnabled ? this.rayStrength : 0);
    this.composite.f('uExposure', this.exposure);
    this.composite.f('uSaturation', this.saturation);
    this.composite.f('uContrast', this.contrast);
    this.composite.f('uVignette', this.vignette);
    this.composite.f('uUnderwater', params.underwater ? 1 : 0);
    gl.drawArrays(gl.TRIANGLES, 0, 3);
    gl.activeTexture(gl.TEXTURE0);
    gl.bindVertexArray(null);
    gl.enable(gl.DEPTH_TEST);
    gl.enable(gl.CULL_FACE);
  }

  private colorTarget(w: number, h: number, filter: number): { fbo: WebGLFramebuffer; tex: WebGLTexture } {
    const gl = this.gl;
    const tex = gl.createTexture()!;
    gl.bindTexture(gl.TEXTURE_2D, tex);
    gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA8, w, h, 0, gl.RGBA, gl.UNSIGNED_BYTE, null);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, filter);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, filter);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
    const fbo = gl.createFramebuffer()!;
    gl.bindFramebuffer(gl.FRAMEBUFFER, fbo);
    gl.framebufferTexture2D(gl.FRAMEBUFFER, gl.COLOR_ATTACHMENT0, gl.TEXTURE_2D, tex, 0);
    gl.bindFramebuffer(gl.FRAMEBUFFER, null);
    return { fbo, tex };
  }

  private depthTarget(w: number, h: number): WebGLTexture {
    const gl = this.gl;
    const tex = gl.createTexture()!;
    gl.bindTexture(gl.TEXTURE_2D, tex);
    gl.texImage2D(gl.TEXTURE_2D, 0, gl.DEPTH_COMPONENT24, w, h, 0, gl.DEPTH_COMPONENT, gl.UNSIGNED_INT, null);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.NEAREST);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.NEAREST);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
    return tex;
  }

  private disposeTargets(): void {
    const gl = this.gl;
    if (this.sceneFbo) gl.deleteFramebuffer(this.sceneFbo);
    if (this.sceneTex) gl.deleteTexture(this.sceneTex);
    if (this.depthTex) gl.deleteTexture(this.depthTex);
    if (this.bloomA) { gl.deleteFramebuffer(this.bloomA.fbo); gl.deleteTexture(this.bloomA.tex); }
    if (this.bloomB) { gl.deleteFramebuffer(this.bloomB.fbo); gl.deleteTexture(this.bloomB.tex); }
    this.sceneFbo = null;
    this.sceneTex = null;
    this.depthTex = null;
    this.bloomA = null;
    this.bloomB = null;
  }

  dispose(): void {
    this.disposeTargets();
    this.extract.dispose();
    this.blur.dispose();
    this.composite.dispose();
    this.gl.deleteVertexArray(this.vao);
  }
}
