// Port of net.minecraft.client.renderer.Panorama / CubeMap (26.2).
//
// Vanilla renders the six 1024x1024 faces as a rotating cube map. The old flat
// composite strip produced a visible seam at every face boundary and was
// reprocessed on resize. This version uploads the six faces into a real
// TEXTURE_CUBE_MAP in a private WebGL2 context, samples it with the same
// yaw-only camera the vanilla panorama uses, and blits the result into the
// Canvas2D GUI. The title screen keeps its 2s fade-in and dark overlay.

import type { GuiGraphics } from '../GuiGraphics.js';
import type { GuiTextures } from '../Hud.js';
import { cameraBasis } from '../../renderer/gl/Gl.js';

const FACE_COUNT = 6;
const PANORAMA_SPIN_SPEED = 0.035; // rad/s (~2 deg/s, vanilla Panorama#tick)

const PANORAMA_VS = `#version 300 es
precision highp float;
layout(location = 0) in vec2 aPos;
out vec2 vNdc;
void main() { vNdc = aPos; gl_Position = vec4(aPos, 0.0, 1.0); }`;

const PANORAMA_FS = `#version 300 es
precision highp float;
in vec2 vNdc;
uniform samplerCube uCube;
uniform vec3 uRight;
uniform vec3 uUp;
uniform vec3 uForward;
uniform float uTanHalfFov;
uniform float uAspect;
out vec4 fragColor;
void main() {
  vec3 dir = normalize(uForward
    + uRight * (vNdc.x * uTanHalfFov * uAspect)
    + uUp * (vNdc.y * uTanHalfFov));
  fragColor = vec4(texture(uCube, dir).rgb, 1.0);
}`;

export class PanoramaRenderer {
  private faces: HTMLImageElement[] = [];
  private overlay?: HTMLImageElement;
  private angle = 0;
  private elapsed = 0;
  private fadingStart = 0;
  private fading = false;

  private glCanvas: HTMLCanvasElement | null = null;
  private gl: WebGL2RenderingContext | null = null;
  private program: WebGLProgram | null = null;
  private vao: WebGLVertexArrayObject | null = null;
  private cubeTex: WebGLTexture | null = null;
  private cubeReady = false;

  async load(textures: GuiTextures): Promise<void> {
    const paths: string[] = [];
    for (let i = 0; i < FACE_COUNT; i++) paths.push(`gui/title/background/panorama_${i}`);
    paths.push('gui/title/background/panorama_overlay');
    await textures.preload(paths);
    this.faces = paths.slice(0, FACE_COUNT).map((p) => textures.get(p)).filter((x): x is HTMLImageElement => !!x);
    this.overlay = textures.get(paths[FACE_COUNT]);
    if (this.faces.length === FACE_COUNT) this.initCubeMap();
  }

  /** TitleScreen calls panorama.startSpin() on construction. */
  startSpin(): void {
    this.fading = true;
    this.fadingStart = this.elapsed;
  }

  tick(deltaMs: number): void {
    this.elapsed += deltaMs;
    this.angle += (deltaMs / 1000) * PANORAMA_SPIN_SPEED;
  }

  /** Fade-in envelope from Screen.FADE_IN_TIME = 2000 ms. */
  fadeAlpha(): number {
    if (!this.fading) return 1;
    const t = (this.elapsed - this.fadingStart) / 2000;
    if (t >= 1) { this.fading = false; return 1; }
    return Math.max(0, Math.min(1, t));
  }

  /** Creates the private GL context, fullscreen quad and the six-face cube texture. */
  private initCubeMap(): void {
    const canvas = document.createElement('canvas');
    const gl = canvas.getContext('webgl2', {
      alpha: false, antialias: false, depth: false, premultipliedAlpha: false,
    });
    if (!gl) return;
    this.glCanvas = canvas;
    this.gl = gl;

    const vs = compile(gl, gl.VERTEX_SHADER, PANORAMA_VS);
    const fs = compile(gl, gl.FRAGMENT_SHADER, PANORAMA_FS);
    if (!vs || !fs) return;
    const prog = gl.createProgram()!;
    gl.attachShader(prog, vs);
    gl.attachShader(prog, fs);
    gl.linkProgram(prog);
    if (!gl.getProgramParameter(prog, gl.LINK_STATUS)) {
      console.warn('[panorama] program link failed', gl.getProgramInfoLog(prog));
      return;
    }
    this.program = prog;

    const vao = gl.createVertexArray()!;
    gl.bindVertexArray(vao);
    const vbo = gl.createBuffer()!;
    gl.bindBuffer(gl.ARRAY_BUFFER, vbo);
    gl.bufferData(gl.ARRAY_BUFFER, new Float32Array([-1, -1, 3, -1, -1, 3]), gl.STATIC_DRAW);
    gl.enableVertexAttribArray(0);
    gl.vertexAttribPointer(0, 2, gl.FLOAT, false, 8, 0);
    gl.bindVertexArray(null);
    this.vao = vao;

    const tex = gl.createTexture()!;
    gl.bindTexture(gl.TEXTURE_CUBE_MAP, tex);
    gl.pixelStorei(gl.UNPACK_FLIP_Y_WEBGL, 0);
    // panorama_0 front, 1 right, 2 back, 3 left, 4 top, 5 bottom.
    const targets = [
      gl.TEXTURE_CUBE_MAP_POSITIVE_Z,
      gl.TEXTURE_CUBE_MAP_POSITIVE_X,
      gl.TEXTURE_CUBE_MAP_NEGATIVE_Z,
      gl.TEXTURE_CUBE_MAP_NEGATIVE_X,
      gl.TEXTURE_CUBE_MAP_POSITIVE_Y,
      gl.TEXTURE_CUBE_MAP_NEGATIVE_Y,
    ];
    for (let i = 0; i < FACE_COUNT; i++) {
      gl.texImage2D(targets[i], 0, gl.RGBA, gl.RGBA, gl.UNSIGNED_BYTE, this.faces[i]);
    }
    gl.texParameteri(gl.TEXTURE_CUBE_MAP, gl.TEXTURE_MIN_FILTER, gl.LINEAR);
    gl.texParameteri(gl.TEXTURE_CUBE_MAP, gl.TEXTURE_MAG_FILTER, gl.LINEAR);
    gl.texParameteri(gl.TEXTURE_CUBE_MAP, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
    gl.texParameteri(gl.TEXTURE_CUBE_MAP, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
    // WebGL2 defines seamlessness as a core enum, but lib.dom types it as an extension constant.
    const seamless = (gl as unknown as { TEXTURE_CUBE_MAP_SEAMLESS?: number }).TEXTURE_CUBE_MAP_SEAMLESS;
    if (seamless !== undefined) gl.enable(seamless);
    this.cubeTex = tex;
    this.cubeReady = true;
    this.faces = []; // textures own the image data after upload
  }

  private renderCube(width: number, height: number): boolean {
    const gl = this.gl;
    const canvas = this.glCanvas;
    if (!gl || !canvas || !this.program || !this.vao || !this.cubeTex || !this.cubeReady) return false;
    // Render at the GUI canvas' physical resolution (capped) so the panorama is sharp on high-DPI
    // windows without paying for a 4K cubemap on huge displays.
    const w = Math.max(320, Math.min(2048, Math.round(width)));
    const h = Math.max(180, Math.min(2048, Math.round(height)));
    if (canvas.width !== w || canvas.height !== h) {
      canvas.width = w;
      canvas.height = h;
    }
    gl.viewport(0, 0, w, h);
    gl.disable(gl.DEPTH_TEST);
    gl.disable(gl.BLEND);
    gl.useProgram(this.program);
    const { right, up, forward } = cameraBasis(this.angle, 0);
    gl.uniform3f(gl.getUniformLocation(this.program, 'uRight')!, right[0], right[1], right[2]);
    gl.uniform3f(gl.getUniformLocation(this.program, 'uUp')!, up[0], up[1], up[2]);
    gl.uniform3f(gl.getUniformLocation(this.program, 'uForward')!, forward[0], forward[1], forward[2]);
    gl.uniform1f(gl.getUniformLocation(this.program, 'uTanHalfFov')!, Math.tan((70 * Math.PI) / 360));
    gl.uniform1f(gl.getUniformLocation(this.program, 'uAspect')!, w / h);
    gl.activeTexture(gl.TEXTURE0);
    gl.bindTexture(gl.TEXTURE_CUBE_MAP, this.cubeTex);
    gl.uniform1i(gl.getUniformLocation(this.program, 'uCube')!, 0);
    gl.bindVertexArray(this.vao);
    gl.drawArrays(gl.TRIANGLES, 0, 3);
    gl.bindVertexArray(null);
    return true;
  }

  render(g: GuiGraphics, width: number, height: number, alpha = 1): void {
    const ctx = g.ctx;
    const prevAlpha = ctx.globalAlpha;
    const prevSmoothing = ctx.imageSmoothingEnabled;
    const prevFilter = ctx.filter;
    ctx.filter = 'none';
    const fade = this.fadeAlpha();

    if (this.renderCube(width, height) && this.glCanvas) {
      ctx.globalAlpha = alpha * fade;
      ctx.imageSmoothingEnabled = true;
      ctx.drawImage(this.glCanvas, 0, 0, width, height);
    } else {
      ctx.globalAlpha = alpha * fade;
      ctx.fillStyle = '#3a5a7a';
      ctx.fillRect(0, 0, width, height);
    }
    ctx.globalAlpha = prevAlpha;
    ctx.imageSmoothingEnabled = prevSmoothing;
    ctx.filter = prevFilter;

    // Vanilla darkens the panorama under the menu (GuiGraphics#drawTitleBackground).
    g.fill(0, 0, width, height, 0x2a000000);
    if (this.overlay && this.overlay.width > 8) {
      const a = g.getAlpha();
      g.setAlpha(a * 0.5);
      g.blitFull('gui/title/background/panorama_overlay', 0, 0, width, height);
      g.setAlpha(a);
    }
  }
}

function compile(gl: WebGL2RenderingContext, type: number, src: string): WebGLShader | null {
  const sh = gl.createShader(type);
  if (!sh) return null;
  gl.shaderSource(sh, src);
  gl.compileShader(sh);
  if (!gl.getShaderParameter(sh, gl.COMPILE_STATUS)) {
    console.warn('[panorama] shader compile failed', gl.getShaderInfoLog(sh));
    gl.deleteShader(sh);
    return null;
  }
  return sh;
}
