export class ShaderProgram {
  program: WebGLProgram;
  uniforms: Record<string, WebGLUniformLocation | null> = {};
  constructor(private gl: WebGL2RenderingContext, vsSource: string, fsSource: string) {
    const vs = compile(gl, gl.VERTEX_SHADER, vsSource);
    const fs = compile(gl, gl.FRAGMENT_SHADER, fsSource);
    const p = gl.createProgram()!;
    gl.attachShader(p, vs);
    gl.attachShader(p, fs);
    gl.linkProgram(p);
    if (!gl.getProgramParameter(p, gl.LINK_STATUS)) {
      throw new Error('program link failed: ' + gl.getProgramInfoLog(p));
    }
    gl.deleteShader(vs);
    gl.deleteShader(fs);
    this.program = p;
    const n = gl.getProgramParameter(p, gl.ACTIVE_UNIFORMS) as number;
    for (let i = 0; i < n; i++) {
      const info = gl.getActiveUniform(p, i)!;
      const name = info.name.replace(/\[0\]$/, '');
      this.uniforms[name] = gl.getUniformLocation(p, info.name);
    }
  }
  use() { this.gl.useProgram(this.program); }
  f(name: string, v: number) { this.gl.uniform1f(this.uniforms[name], v); }
  i(name: string, v: number) { this.gl.uniform1i(this.uniforms[name], v); }
  v2(name: string, x: number, y: number) { this.gl.uniform2f(this.uniforms[name], x, y); }
  v3(name: string, x: number, y: number, z: number) { this.gl.uniform3f(this.uniforms[name], x, y, z); }
  v4(name: string, x: number, y: number, z: number, w: number) { this.gl.uniform4f(this.uniforms[name], x, y, z, w); }
  mat4(name: string, m: Float32Array) { this.gl.uniformMatrix4fv(this.uniforms[name], false, m); }
  intArray(name: string, values: Int32Array) { this.gl.uniform1iv(this.uniforms[name], values); }
  dispose() { this.gl.deleteProgram(this.program); }
}

function compile(gl: WebGL2RenderingContext, type: number, src: string): WebGLShader {
  const s = gl.createShader(type)!;
  gl.shaderSource(s, src);
  gl.compileShader(s);
  if (!gl.getShaderParameter(s, gl.COMPILE_STATUS)) {
    const log = gl.getShaderInfoLog(s);
    gl.deleteShader(s);
    throw new Error('shader compile failed: ' + log + '\n' + src.split('\n').map((l, i) => `${i + 1}: ${l}`).join('\n'));
  }
  return s;
}

export function createTexture(gl: WebGL2RenderingContext, opts: {
  width: number; height: number; data?: ArrayBufferView | null; filter?: number; wrap?: number;
}): WebGLTexture {
  const t = gl.createTexture()!;
  gl.bindTexture(gl.TEXTURE_2D, t);
  gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, opts.width, opts.height, 0, gl.RGBA, gl.UNSIGNED_BYTE, opts.data ?? null);
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, opts.filter ?? gl.NEAREST);
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, opts.filter ?? gl.NEAREST);
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, opts.wrap ?? gl.CLAMP_TO_EDGE);
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, opts.wrap ?? gl.CLAMP_TO_EDGE);
  return t;
}

export function bindTexture(gl: WebGL2RenderingContext, unit: number, tex: WebGLTexture | null) {
  gl.activeTexture(gl.TEXTURE0 + unit);
  gl.bindTexture(gl.TEXTURE_2D, tex);
}

export function loadImage(url: string): Promise<HTMLImageElement> {
  return new Promise((resolve, reject) => {
    const img = new Image();
    img.crossOrigin = 'anonymous';
    img.onload = () => resolve(img);
    img.onerror = () => reject(new Error('image load failed: ' + url));
    img.src = url;
  });
}

export async function loadBitmap(url: string, options?: ImageBitmapOptions): Promise<ImageBitmap> {
  const res = await fetch(url);
  if (!res.ok) throw new Error(`fetch ${url}: ${res.status}`);
  return createImageBitmap(await res.blob(), options);
}

export function nextFrame(): Promise<void> {
  return new Promise(resolve => requestAnimationFrame(() => resolve()));
}
