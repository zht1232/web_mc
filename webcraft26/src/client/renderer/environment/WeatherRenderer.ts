// Port of net.minecraft.client.renderer.WeatherEffectRenderer (26.2) and the
// classic LevelRenderer.renderSnowAndRain rain columns, plus lightning.
//
// A 32x32 billboard table gives each column a camera-facing orientation. All
// columns for the current camera are packed into ONE dynamic VBO and drawn in a
// single call; rain.png / snow.png are selected per vertex. tick() advances the
// lightning timer (deterministic) and fires an onThunder callback for audio.

import { GlProgram } from '../gl/Gl.js';
import { XoroshiroRandomSource } from '../../../vanilla/core/Random.js';
import {
  createFullscreenQuad, loadEnvTexture, rainLevelOf, restoreDefaultState,
  thunderLevelOf, type CameraLike, type LevelLike,
} from './EnvCommon.js';

const TABLE = 32;
const HALF_TABLE = 16;
const FLOATS_PER_VERTEX = 10;   // vec3 + vec2 + vec4 + float
const VERTS_PER_COLUMN = 6;

const WEATHER_VS = `#version 300 es
precision highp float;
layout(location = 0) in vec3 aPos;      // relative to camera
layout(location = 1) in vec2 aUV;
layout(location = 2) in vec4 aColor;    // rgb = 1, a = alpha
layout(location = 3) in float aTexSel;  // 0 = rain, 1 = snow
uniform mat4 uViewProj;
uniform vec3 uCamPos;
out vec2 vUV;
out vec4 vColor;
out float vTexSel;
void main() {
  gl_Position = uViewProj * vec4(uCamPos + aPos, 1.0);
  vUV = aUV; vColor = aColor; vTexSel = aTexSel;
}`;

const WEATHER_FS = `#version 300 es
precision highp float;
in vec2 vUV;
in vec4 vColor;
in float vTexSel;
uniform sampler2D uRain;
uniform sampler2D uSnow;
uniform vec3 uBrightness;
out vec4 fragColor;
void main() {
  vec4 c = mix(texture(uRain, vUV), texture(uSnow, vUV), vTexSel) * vColor;
  if (c.a < 0.02) discard;
  fragColor = vec4(c.rgb * uBrightness, c.a);
}`;

const FLASH_VS = `#version 300 es
layout(location = 0) in vec2 aPos;
void main() { gl_Position = vec4(aPos, 0.0, 1.0); }`;

const FLASH_FS = `#version 300 es
precision highp float;
uniform vec4 uFlash;
out vec4 fragColor;
void main() { fragColor = uFlash; }`;

/** Deterministic integer hash -> [0,1), replaces Math.random for column jitter. */
function hash01(x: number, z: number, k: number): number {
  let h = (Math.imul(x, 3121) + Math.imul(z, 418711) + Math.imul(k, 13761)) | 0;
  h = Math.imul(h ^ (h >>> 13), 1274126177);
  h ^= h >>> 16;
  return (h >>> 0) / 4294967296;
}

export type WeatherType = 'auto' | 'rain' | 'snow';

export interface WeatherOptions {
  radius?: number;        // columns extend +/- radius blocks around the camera
  snowLine?: number;      // auto: columns above this terrain height snow
  weatherType?: WeatherType;
}

export class WeatherRenderer {
  private program: GlProgram | null = null;
  private flashProgram: GlProgram | null = null;
  private vao: WebGLVertexArrayObject | null = null;
  private vbo: WebGLBuffer | null = null;
  private quadVao: WebGLVertexArrayObject | null = null;
  private rainTex: WebGLTexture | null = null;
  private snowTex: WebGLTexture | null = null;
  private readonly columnSizeX = new Float32Array(TABLE * TABLE);
  private readonly columnSizeZ = new Float32Array(TABLE * TABLE);
  private readonly rand = new XoroshiroRandomSource(0x5eedbaddn);
  private readonly vertexData: Float32Array;

  readonly radius: number;
  readonly snowLine: number;
  weatherType: WeatherType;

  /** Full-screen white flash intensity, 0..1 (also readable by post-processing). */
  flashIntensity = 0;
  /** Called when lightning strikes so audio can play a thunder event. */
  onThunder: ((x: number, y: number, z: number) => void) | null = null;

  constructor(private readonly gl: WebGL2RenderingContext, opts: WeatherOptions = {}) {
    this.radius = opts.radius ?? 10;
    this.snowLine = opts.snowLine ?? 128;
    this.weatherType = opts.weatherType ?? 'auto';
    for (let z = 0; z < TABLE; z++) {
      for (let x = 0; x < TABLE; x++) {
        const dx = x - HALF_TABLE, dz = z - HALF_TABLE;
        const d = Math.hypot(dx, dz) || 1;
        this.columnSizeX[z * TABLE + x] = -dz / d;
        this.columnSizeZ[z * TABLE + x] = dx / d;
      }
    }
    const maxColumns = (2 * this.radius + 1) * (2 * this.radius + 1);
    this.vertexData = new Float32Array(maxColumns * VERTS_PER_COLUMN * FLOATS_PER_VERTEX);
  }

  async init(): Promise<void> {
    const gl = this.gl;
    this.program = new GlProgram(gl, WEATHER_VS, WEATHER_FS, 'env.weather');
    this.flashProgram = new GlProgram(gl, FLASH_VS, FLASH_FS, 'env.flash');
    this.quadVao = createFullscreenQuad(gl);
    [this.rainTex, this.snowTex] = await Promise.all([
      loadEnvTexture(gl, 'environment/rain', gl.REPEAT, gl.LINEAR),
      loadEnvTexture(gl, 'environment/snow', gl.REPEAT, gl.LINEAR),
    ]);
    this.vao = gl.createVertexArray();
    this.vbo = gl.createBuffer();
    gl.bindVertexArray(this.vao);
    gl.bindBuffer(gl.ARRAY_BUFFER, this.vbo);
    gl.bufferData(gl.ARRAY_BUFFER, this.vertexData.byteLength, gl.DYNAMIC_DRAW);
    gl.enableVertexAttribArray(0);
    gl.vertexAttribPointer(0, 3, gl.FLOAT, false, 40, 0);
    gl.enableVertexAttribArray(1);
    gl.vertexAttribPointer(1, 2, gl.FLOAT, false, 40, 12);
    gl.enableVertexAttribArray(2);
    gl.vertexAttribPointer(2, 4, gl.FLOAT, false, 40, 20);
    gl.enableVertexAttribArray(3);
    gl.vertexAttribPointer(3, 1, gl.FLOAT, false, 40, 36);
    gl.bindVertexArray(null);
  }

  private precipitationAt(level: LevelLike | null | undefined, x: number, z: number): 'rain' | 'snow' {
    if (this.weatherType !== 'auto') return this.weatherType;
    const h = level?.getHeight?.(x, z);
    if (h !== undefined && h >= this.snowLine) return 'snow';
    const biome = level?.getBiome?.(x, 64, z) ?? 0;
    return (biome & 3) === 1 ? 'snow' : 'rain';
  }

  /**
   * Advances the lightning timer. dtTicks is in world ticks (20/s).
   * Uses a seeded Xoroshiro source so the same sequence of calls is reproducible.
   */
  tick(camera: CameraLike, level?: LevelLike | null, dtTicks = 1): void {
    const thunder = Math.min(1, Math.max(0, thunderLevelOf(level)));
    if (thunder > 0 && this.rand.nextFloat() < thunder * 0.0015 * dtTicks) {
      this.flashIntensity = 1;
      const dx = (this.rand.nextFloat() - 0.5) * 64;
      const dz = (this.rand.nextFloat() - 0.5) * 64;
      this.onThunder?.(camera.x + dx, camera.y, camera.z + dz);
    }
    this.flashIntensity *= Math.pow(0.72, Math.max(0, dtTicks));
    if (this.flashIntensity < 0.005) this.flashIntensity = 0;
  }

  /** Force a lightning strike (e.g. from a scripted event). */
  strike(x: number, y: number, z: number): void {
    this.flashIntensity = 1;
    this.onThunder?.(x, y, z);
  }

  /**
   * @param viewProj  proj*view (column major)
   * @param camera    camera position the columns follow
   * @param tickTime  world time in ticks, drives the falling texture offset
   * @param level     read for rain/snow intensity and biome precipitation
   */
  render(viewProj: Float32Array, camera: CameraLike, tickTime: number, level?: LevelLike | null): void {
    const gl = this.gl;
    const intensity = Math.min(1, Math.max(0, rainLevelOf(level)));
    const flash = this.flashIntensity;
    if ((intensity <= 0 && flash <= 0) || !this.program || !this.vao) return;

    const camBX = Math.floor(camera.x), camBY = Math.floor(camera.y), camBZ = Math.floor(camera.z);
    const v = this.vertexData;
    let n = 0;
    const push = (x: number, y: number, z: number, u: number, vv: number, a: number, sel: number) => {
      v[n++] = x; v[n++] = y; v[n++] = z;
      v[n++] = u; v[n++] = vv;
      v[n++] = 1; v[n++] = 1; v[n++] = 1; v[n++] = a;
      v[n++] = sel;
    };

    if (intensity > 0) {
      const radiusSq = this.radius * this.radius;
      const wrappedTicks = tickTime & 131071;
      for (let z = camBZ - this.radius; z <= camBZ + this.radius; z++) {
        for (let x = camBX - this.radius; x <= camBX + this.radius; x++) {
          const terrain = level?.getHeight?.(x, z) ?? camBY - this.radius;
          const y0 = Math.max(camBY - this.radius, terrain);
          const y1 = Math.max(camBY + this.radius, terrain);
          if (y1 - y0 === 0) continue;

          const isSnow = this.precipitationAt(level, x, z) === 'snow';
          const sel = isSnow ? 1 : 0;
          const relX = x + 0.5 - camera.x;
          const relZ = z + 0.5 - camera.z;
          const distSq = relX * relX + relZ * relZ;
          const t = Math.min(distSq / radiusSq, 1);
          const maxAlpha = isSnow ? 0.8 : 1.0;
          const alpha = (maxAlpha * (1 - t) + 0.5 * t) * intensity;

          let ix = (z - camBZ + HALF_TABLE) * TABLE + (x - camBX + HALF_TABLE);
          ix = Math.max(0, Math.min(TABLE * TABLE - 1, ix));
          const hx = this.columnSizeX[ix] / 2;
          const hz = this.columnSizeZ[ix] / 2;
          const x0 = relX - hx, x1 = relX + hx;
          const z0 = relZ - hz, z1 = relZ + hz;
          const topY = y1 - camera.y, botY = y0 - camera.y;

          let uOff = 0, vOff = 0;
          if (isSnow) {
            const time = wrappedTicks;
            uOff = hash01(x, z, 1) + time * 0.01 * (hash01(x, z, 2) - 0.5);
            const vv = hash01(x, z, 3) + time * (hash01(x, z, 4) - 0.5) * 0.001;
            vOff = -((tickTime & 511)) / 512 + vv;
          } else {
            const speed = 3 + hash01(x, z, 5);
            const tickOffset = (Math.imul(x * x, 3121) + Math.imul(x, 45238971)
              + Math.imul(z * z, 418711) + Math.imul(z, 13761)) & 0xff;
            let tex = -(wrappedTicks + tickOffset) / 32 * speed;
            tex = tex % 32;
            vOff = tex;
          }
          const u0 = uOff, u1 = uOff + 1;
          const v0 = y0 * 0.25 + vOff, v1 = y1 * 0.25 + vOff;
          push(x0, topY, z0, u0, v0, alpha, sel);
          push(x1, topY, z1, u1, v0, alpha, sel);
          push(x1, botY, z1, u1, v1, alpha, sel);
          push(x0, topY, z0, u0, v0, alpha, sel);
          push(x1, botY, z1, u1, v1, alpha, sel);
          push(x0, botY, z0, u0, v1, alpha, sel);
        }
      }
    }

    gl.enable(gl.BLEND);
    gl.blendFunc(gl.SRC_ALPHA, gl.ONE_MINUS_SRC_ALPHA);
    gl.depthMask(false);
    gl.disable(gl.CULL_FACE);

    if (n > 0 && this.program && this.rainTex && this.snowTex) {
      gl.bindVertexArray(this.vao);
      gl.bindBuffer(gl.ARRAY_BUFFER, this.vbo);
      gl.bufferData(gl.ARRAY_BUFFER, v.subarray(0, n), gl.DYNAMIC_DRAW);
      this.program.use();
      this.program.setMat4('uViewProj', viewProj);
      this.program.set3f('uCamPos', camera.x, camera.y, camera.z);
      // rain darkens the whole scene slightly (matches getRainLevel sky darken)
      const brightness = 1 - intensity * 0.25;
      this.program.set3f('uBrightness', brightness, brightness, brightness);
      gl.activeTexture(gl.TEXTURE0);
      gl.bindTexture(gl.TEXTURE_2D, this.rainTex);
      this.program.set1i('uRain', 0);
      gl.activeTexture(gl.TEXTURE1);
      gl.bindTexture(gl.TEXTURE_2D, this.snowTex);
      this.program.set1i('uSnow', 1);
      gl.drawArrays(gl.TRIANGLES, 0, n / FLOATS_PER_VERTEX);
      gl.bindVertexArray(null);
    }

    if (flash > 0 && this.flashProgram && this.quadVao) {
      this.flashProgram.use();
      this.flashProgram.set4f('uFlash', 1, 1, 1, flash * 0.55);
      gl.bindVertexArray(this.quadVao);
      gl.drawArrays(gl.TRIANGLES, 0, 6);
      gl.bindVertexArray(null);
    }

    restoreDefaultState(gl);
  }

  dispose(): void {
    const gl = this.gl;
    if (this.vao) gl.deleteVertexArray(this.vao);
    if (this.vbo) gl.deleteBuffer(this.vbo);
    if (this.quadVao) gl.deleteVertexArray(this.quadVao);
    if (this.rainTex) gl.deleteTexture(this.rainTex);
    if (this.snowTex) gl.deleteTexture(this.snowTex);
  }
}
