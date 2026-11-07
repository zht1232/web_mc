// Small WebGL2 helpers: shader compilation, uniform lookup, texture creation.
// Kept close to the vanilla names (GlStateManager-ish) so call sites stay readable.

export class GlProgram {
  readonly program: WebGLProgram;
  private readonly uniforms = new Map<string, WebGLUniformLocation | null>();

  constructor(private readonly gl: WebGL2RenderingContext, vertexSrc: string, fragmentSrc: string, name = 'program') {
    const vs = compile(gl, gl.VERTEX_SHADER, vertexSrc, name + '.vert');
    const fs = compile(gl, gl.FRAGMENT_SHADER, fragmentSrc, name + '.frag');
    const p = gl.createProgram()!;
    gl.attachShader(p, vs);
    gl.attachShader(p, fs);
    gl.linkProgram(p);
    if (!gl.getProgramParameter(p, gl.LINK_STATUS)) {
      const log = gl.getProgramInfoLog(p);
      throw new Error(`link ${name} failed: ${log}`);
    }
    gl.deleteShader(vs);
    gl.deleteShader(fs);
    this.program = p;
  }

  use(): void { this.gl.useProgram(this.program); }

  uniform(name: string): WebGLUniformLocation | null {
    let loc = this.uniforms.get(name);
    if (loc === undefined) {
      loc = this.gl.getUniformLocation(this.program, name);
      this.uniforms.set(name, loc);
    }
    return loc;
  }

  setMat4(name: string, m: Float32Array): void {
    const loc = this.uniform(name);
    if (loc) this.gl.uniformMatrix4fv(loc, false, m);
  }

  set1f(name: string, v: number): void {
    const loc = this.uniform(name);
    if (loc) this.gl.uniform1f(loc, v);
  }

  set1i(name: string, v: number): void {
    const loc = this.uniform(name);
    if (loc) this.gl.uniform1i(loc, v);
  }

  set2i(name: string, x: number, y: number): void {
    const loc = this.uniform(name);
    if (loc) this.gl.uniform2i(loc, x, y);
  }

  set2f(name: string, x: number, y: number): void {
    const loc = this.uniform(name);
    if (loc) this.gl.uniform2f(loc, x, y);
  }

  set3f(name: string, x: number, y: number, z: number): void {
    const loc = this.uniform(name);
    if (loc) this.gl.uniform3f(loc, x, y, z);
  }

  set4f(name: string, x: number, y: number, z: number, w: number): void {
    const loc = this.uniform(name);
    if (loc) this.gl.uniform4f(loc, x, y, z, w);
  }
}

function compile(gl: WebGL2RenderingContext, type: number, src: string, label: string): WebGLShader {
  const shader = gl.createShader(type)!;
  gl.shaderSource(shader, src);
  gl.compileShader(shader);
  if (!gl.getShaderParameter(shader, gl.COMPILE_STATUS)) {
    const log = gl.getShaderInfoLog(shader);
    const numbered = src.split('\n').map((l, i) => `${String(i + 1).padStart(3)}| ${l}`).join('\n');
    throw new Error(`compile ${label} failed: ${log}\n${numbered}`);
  }
  return shader;
}

export interface TextureArray {
  texture: WebGLTexture;
  layerCount: number;
  size: number;
}

/** Uploads the packed RGBA blob produced by scripts/build-textures.mjs. */
export function createTextureArray(
  gl: WebGL2RenderingContext, data: Uint8Array, layerCount: number, size: number, mipmaps = true,
): TextureArray {
  const tex = gl.createTexture()!;
  gl.bindTexture(gl.TEXTURE_2D_ARRAY, tex);
  gl.texStorage3D(gl.TEXTURE_2D_ARRAY, mipmaps ? 5 : 1, gl.RGBA8, size, size, layerCount);
  gl.texSubImage3D(gl.TEXTURE_2D_ARRAY, 0, 0, 0, 0, size, size, layerCount, gl.RGBA, gl.UNSIGNED_BYTE, data);
  gl.texParameteri(gl.TEXTURE_2D_ARRAY, gl.TEXTURE_WRAP_S, gl.REPEAT);
  gl.texParameteri(gl.TEXTURE_2D_ARRAY, gl.TEXTURE_WRAP_T, gl.REPEAT);
  gl.texParameteri(gl.TEXTURE_2D_ARRAY, gl.TEXTURE_MIN_FILTER, mipmaps ? gl.NEAREST_MIPMAP_LINEAR : gl.NEAREST);
  gl.texParameteri(gl.TEXTURE_2D_ARRAY, gl.TEXTURE_MAG_FILTER, gl.NEAREST);
  if (mipmaps) {
    gl.generateMipmap(gl.TEXTURE_2D_ARRAY);
    gl.texParameteri(gl.TEXTURE_2D_ARRAY, gl.TEXTURE_MAX_LEVEL, 4);
  }
  return { texture: tex, layerCount, size };
}

/** Uploads one layer of a texture array (used to play animations in place). */
export function updateTextureArrayLayer(
  gl: WebGL2RenderingContext, tex: WebGLTexture, layer: number, size: number, rgba: Uint8Array,
): void {
  gl.bindTexture(gl.TEXTURE_2D_ARRAY, tex);
  gl.texSubImage3D(gl.TEXTURE_2D_ARRAY, 0, 0, 0, layer, size, size, 1, gl.RGBA, gl.UNSIGNED_BYTE, rgba);
}

export function createTexture2D(
  gl: WebGL2RenderingContext, width: number, height: number, rgba: Uint8Array | null,
  filter: number = gl.NEAREST, wrap: number = gl.CLAMP_TO_EDGE,
): WebGLTexture {
  const tex = gl.createTexture()!;
  gl.bindTexture(gl.TEXTURE_2D, tex);
  gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA8, width, height, 0, gl.RGBA, gl.UNSIGNED_BYTE, rgba);
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, wrap);
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, wrap);
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, filter);
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, filter);
  return tex;
}

export function loadImage(url: string): Promise<HTMLImageElement> {
  return new Promise((resolve, reject) => {
    const img = new Image();
    img.onload = () => resolve(img);
    img.onerror = () => reject(new Error('failed to load ' + url));
    img.src = url;
  });
}

// ---------------------------------------------------------------- matrices

export function mat4Identity(out = new Float32Array(16)): Float32Array {
  out.fill(0);
  out[0] = out[5] = out[10] = out[15] = 1;
  return out;
}

export function mat4Perspective(fovYRad: number, aspect: number, near: number, far: number, out = new Float32Array(16)): Float32Array {
  const f = 1 / Math.tan(fovYRad / 2);
  out.fill(0);
  out[0] = f / aspect;
  out[5] = f;
  out[10] = (far + near) / (near - far);
  out[11] = -1;
  out[14] = (2 * far * near) / (near - far);
  return out;
}

export function mat4Mul(a: Float32Array, b: Float32Array, out = new Float32Array(16)): Float32Array {
  for (let c = 0; c < 4; c++) {
    for (let r = 0; r < 4; r++) {
      out[c * 4 + r] =
        a[0 * 4 + r] * b[c * 4 + 0] +
        a[1 * 4 + r] * b[c * 4 + 1] +
        a[2 * 4 + r] * b[c * 4 + 2] +
        a[3 * 4 + r] * b[c * 4 + 3];
    }
  }
  return out;
}

/** Camera basis vectors matching Minecraft's yaw/pitch convention (yaw 0 = +Z). */
export function cameraBasis(yawRad: number, pitchRad: number): { right: number[]; up: number[]; forward: number[] } {
  const cy = Math.cos(yawRad), sy = Math.sin(yawRad);
  const cp = Math.cos(pitchRad), sp = Math.sin(pitchRad);
  const forward = [sy * cp, -sp, cy * cp];
  // right = normalize(cross(forward, worldUp)) -> (-f.z, 0, f.x) normalised
  const rl = Math.hypot(forward[2], forward[0]) || 1;
  const right = [-forward[2] / rl, 0, forward[0] / rl];
  // up = cross(right, forward)
  const up = [
    right[1] * forward[2] - right[2] * forward[1],
    right[2] * forward[0] - right[0] * forward[2],
    right[0] * forward[1] - right[1] * forward[0],
  ];
  return { right, up, forward };
}

/** View matrix from eye position and yaw/pitch in radians (vanilla camera order). */
export function mat4View(eyeX: number, eyeY: number, eyeZ: number, yaw: number, pitch: number, out = new Float32Array(16)): Float32Array {
  const { right, up, forward } = cameraBasis(yaw, pitch);
  out[0] = right[0]; out[4] = right[1]; out[8] = right[2];
  out[1] = up[0]; out[5] = up[1]; out[9] = up[2];
  out[2] = -forward[0]; out[6] = -forward[1]; out[10] = -forward[2];
  out[12] = -(right[0] * eyeX + right[1] * eyeY + right[2] * eyeZ);
  out[13] = -(up[0] * eyeX + up[1] * eyeY + up[2] * eyeZ);
  out[14] = forward[0] * eyeX + forward[1] * eyeY + forward[2] * eyeZ;
  out[3] = 0; out[7] = 0; out[11] = 0; out[15] = 1;
  return out;
}

export interface Frustum {
  planes: Float32Array; // 6 * 4
}

export function extractFrustum(mvp: Float32Array): Frustum {
  const p = new Float32Array(24);
  const m = mvp;
  // rows of the matrix (column major storage)
  const row = (r: number) => [m[r], m[4 + r], m[8 + r], m[12 + r]];
  const r0 = row(0), r1 = row(1), r2 = row(2), r3 = row(3);
  const set = (i: number, a: number[], b: number[], sign: number) => {
    for (let k = 0; k < 4; k++) p[i * 4 + k] = b[k] + sign * a[k];
    const len = Math.hypot(p[i * 4], p[i * 4 + 1], p[i * 4 + 2]);
    for (let k = 0; k < 4; k++) p[i * 4 + k] /= len || 1;
  };
  set(0, r0, r3, 1);   // left
  set(1, r0, r3, -1);  // right
  set(2, r1, r3, 1);   // bottom
  set(3, r1, r3, -1);  // top
  set(4, r2, r3, 1);   // near
  set(5, r2, r3, -1);  // far
  return { planes: p };
}

export function boxInFrustum(f: Frustum, minX: number, minY: number, minZ: number, maxX: number, maxY: number, maxZ: number): boolean {
  const p = f.planes;
  for (let i = 0; i < 6; i++) {
    const a = p[i * 4], b = p[i * 4 + 1], c = p[i * 4 + 2], d = p[i * 4 + 3];
    const x = a > 0 ? maxX : minX;
    const y = b > 0 ? maxY : minY;
    const z = c > 0 ? maxZ : minZ;
    if (a * x + b * y + c * z + d < 0) return false;
  }
  return true;
}
