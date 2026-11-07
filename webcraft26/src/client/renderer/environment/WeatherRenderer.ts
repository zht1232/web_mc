// Port of net.minecraft.client.renderer.WeatherEffectRenderer (26.2).
//
// Vanilla behaviour reproduced here:
//   * a 32x32 direction table gives every rain/snow column its camera facing quad
//     (WeatherEffectRenderer.<init> L46-56), columns cover +/- options.weatherRadius
//     blocks around the camera (default 10, Options.java weatherRadius)
//   * one instance per (x, z) column with y from max(cameraY - radius, terrainHeight)
//     to max(cameraY + radius, terrainHeight) (extractRenderState L59-96)
//   * per column RandomSource.createThreadLocalInstance() + setSeed(
//       x*x*3121 + x*45238971 ^ z*z*418711 + z*13761) drives the scroll speed and the
//     snow uv jitter (createRainColumnInstance/createSnowColumnInstance L228-266).
//     RandomSource.createThreadLocalInstance() is a LegacyRandomSource, *not* xoroshiro.
//   * alpha = Mth.lerp(min(dist^2/radius^2, 1), maxAlpha, 0.5) * intensity, rain 1.0,
//     snow 0.8 (renderInstances L269-317); both layers share one buffer and are drawn
//     with their own texture.
//   * the particle pipeline multiplies the column colour by the lightmap sample at the
//     column's light coords (core/particle.vsh Color * sample_lightmap(Sampler2, UV2)),
//     which is what makes rain at night dark instead of glowing white.
//   * fog = apply_fog with the environmental fog distances (FogEnvironmentalStart/End).
//
// Lightning stays a WebGL approximation: the vanilla client uses a skylight flash
// (WeatherAttributes + ClientLevel sky light); we keep a full screen white quad whose
// intensity is exposed as `flashIntensity` so a post pass can consume it instead.

import { GlProgram } from '../gl/Gl.js';
import { LegacyRandomSource } from '../../../vanilla/core/Random.js';
import {
  createFullscreenQuad,
  loadEnvTexture,
  rainLevelOf,
  restoreDefaultState,
  setTranslucentBlend,
  thunderLevelOf,
  type CameraLike,
  type LevelLike,
} from './EnvCommon.js';

const TABLE = 32;
const HALF_TABLE = 16;
const FLOATS_PER_VERTEX = 12;   // vec3 pos + vec2 uv + vec4 color + vec2 light + float isSnow
const VERTS_PER_COLUMN = 6;

const WEATHER_VS = `#version 300 es
precision highp float;
layout(location = 0) in vec3 aPos;      // relative to the camera
layout(location = 1) in vec2 aUV;
layout(location = 2) in vec4 aColor;    // rgb = 1, a = alpha
layout(location = 3) in vec2 aLight;    // (sky, block) 0..15
uniform mat4 uViewProj;
uniform vec3 uCamPos;
out vec2 vUV;
out vec4 vColor;
out vec2 vLightUV;
out float vSpherical;
out float vCylindrical;
void main() {
  gl_Position = uViewProj * vec4(uCamPos + aPos, 1.0);
  vUV = aUV;
  vColor = aColor;
  // sample_lightmap.glsl: clamp(uv / 256 + 0.5 / 16) with uv = (block, sky), the lightmap
  // is x = block light, y = sky light (same convention as Shaders.ts TERRAIN_FRAG).
  vLightUV = clamp((aLight.yx + 0.5) / 16.0, vec2(0.5 / 16.0), vec2(15.5 / 16.0));
  vSpherical = length(aPos);
  vCylindrical = max(length(aPos.xz), abs(aPos.y));
}`;

const WEATHER_FS = `#version 300 es
precision highp float;
in vec2 vUV;
in vec4 vColor;
in vec2 vLightUV;
in float vSpherical;
in float vCylindrical;
uniform sampler2D uTex;
uniform sampler2D uLightmap;
uniform int uHasLightmap;
uniform vec3 uFogColor;
uniform float uFogStart;
uniform float uFogEnd;
uniform float uFogAlpha;
out vec4 fragColor;
void main() {
  vec4 tex = texture(uTex, vUV);
  vec3 light = uHasLightmap == 1 ? texture(uLightmap, vLightUV).rgb : vec3(1.0);
  vec4 color = vec4(tex.rgb * vColor.rgb * light, tex.a * vColor.a);
  if (color.a < 0.1) discard;
  // particle.fsh: apply_fog(color, spherical, cylindrical, envStart, envEnd, ...)
  float span = max(1.0, uFogEnd - uFogStart);
  float fog = max(
    clamp((vSpherical - uFogStart) / span, 0.0, 1.0),
    clamp((vCylindrical - uFogStart) / span, 0.0, 1.0));
  color.rgb = mix(color.rgb, uFogColor, fog * uFogAlpha);
  fragColor = color;
}`;

const FLASH_VS = `#version 300 es
layout(location = 0) in vec2 aPos;
void main() { gl_Position = vec4(aPos, 0.0, 1.0); }`;

const FLASH_FS = `#version 300 es
precision highp float;
uniform vec4 uFlash;
out vec4 fragColor;
void main() { fragColor = uFlash; }`;

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
  private readonly rand = new LegacyRandomSource(0n);
  private readonly vertexData: Float32Array;
  private rainColumns = 0;
  private snowColumns = 0;

  readonly radius: number;
  readonly snowLine: number;
  weatherType: WeatherType;

  /** Full-screen white flash intensity, 0..1 (also readable by post-processing). */
  flashIntensity = 0;
  /** Called when lightning strikes so audio can play a thunder event. */
  onThunder: ((x: number, y: number, z: number) => void) | null = null;
  /** 16x16 lightmap from TextureManager#lightmap; makes the rain dark at night. */
  lightmap: WebGLTexture | null = null;

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
    const maxColumns = (2 * Math.max(this.radius, 10) + 1) * (2 * Math.max(this.radius, 10) + 1);
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
    const stride = FLOATS_PER_VERTEX * 4;
    gl.enableVertexAttribArray(0);
    gl.vertexAttribPointer(0, 3, gl.FLOAT, false, stride, 0);
    gl.enableVertexAttribArray(1);
    gl.vertexAttribPointer(1, 2, gl.FLOAT, false, stride, 12);
    gl.enableVertexAttribArray(2);
    gl.vertexAttribPointer(2, 4, gl.FLOAT, false, stride, 20);
    gl.enableVertexAttribArray(3);
    gl.vertexAttribPointer(3, 2, gl.FLOAT, false, stride, 36);
    gl.bindVertexArray(null);
  }

  /** Biome precipitation of the 26.2 client: NONE / RAIN / SNOW. */
  private precipitationAt(level: LevelLike | null | undefined, x: number, z: number): 0 | 1 | 2 {
    if (this.weatherType === 'rain') return 1;
    if (this.weatherType === 'snow') return 2;
    // LevelLike has no getPrecipitationAt yet; fall back to the snow line and the
    // biome-id low bits (same heuristic the previous weather pass used).
    const h = level?.getHeight?.(x, z);
    if (h !== undefined && h >= this.snowLine) return 2;
    const biome = level?.getBiome?.(x, 64, z) ?? 0;
    return (biome & 3) === 1 ? 2 : 1;
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

  /** Number of rain / snow columns in the last rendered frame (debug / verification). */
  get columnCounts(): { rain: number; snow: number } {
    return { rain: this.rainColumns, snow: this.snowColumns };
  }

  /**
   * @param viewProj  proj*view (column major)
   * @param camera    camera position the columns follow
   * @param tickTime  world time in ticks (scroll animation); level.gameTime is preferred
   * @param level     read for rain intensity and the column light
   * @param fog       environmental fog (start/end/color) from SkyState; optional
   */
  render(
    viewProj: Float32Array,
    camera: CameraLike,
    tickTime: number,
    level?: LevelLike | null,
    fog?: { start: number; end: number; color: readonly [number, number, number] } | null,
  ): void {
    const gl = this.gl;
    const intensity = Math.min(1, Math.max(0, rainLevelOf(level)));
    const flash = this.flashIntensity;
    if ((intensity <= 0 && flash <= 0) || !this.program || !this.vao) return;

    const camBX = Math.floor(camera.x), camBY = Math.floor(camera.y), camBZ = Math.floor(camera.z);
    const ticks = level && typeof level.gameTime === 'number' ? Math.trunc(level.gameTime) : Math.trunc(tickTime);
    const v = this.vertexData;
    let n = 0;
    let rain = 0;
    let snow = 0;

    const pushColumn = (
      x: number, z: number, bottomY: number, topY: number,
      uOffset: number, vOffset: number, alpha: number, sky: number, block: number,
    ) => {
      const relX = x + 0.5 - camera.x;
      const relZ = z + 0.5 - camera.z;
      let ix = (z - camBZ + HALF_TABLE) * TABLE + (x - camBX + HALF_TABLE);
      ix = Math.max(0, Math.min(TABLE * TABLE - 1, ix));
      const halfX = this.columnSizeX[ix] / 2;
      const halfZ = this.columnSizeZ[ix] / 2;
      const x0 = relX - halfX, x1 = relX + halfX;
      const z0 = relZ - halfZ, z1 = relZ + halfZ;
      const y0 = bottomY - camera.y, y1 = topY - camera.y;
      const u0 = uOffset, u1 = uOffset + 1;
      const v0 = bottomY * 0.25 + vOffset;
      const v1 = topY * 0.25 + vOffset;
      const post = (px: number, py: number, pz: number, uu: number, vv: number) => {
        v[n++] = px; v[n++] = py; v[n++] = pz;
        v[n++] = uu; v[n++] = vv;
        v[n++] = 1; v[n++] = 1; v[n++] = 1; v[n++] = alpha;
        v[n++] = sky; v[n++] = block;
        v[n++] = 0;
      };
      // WeatherEffectRenderer.renderInstances: quad order top-left, top-right, bottom-right, bottom-left
      post(x0, y1, z0, u0, v0);
      post(x1, y1, z1, u1, v0);
      post(x1, y0, z1, u1, v1);
      post(x0, y1, z0, u0, v0);
      post(x1, y0, z1, u1, v1);
      post(x0, y0, z0, u0, v1);
    };

    if (intensity > 0) {
      const radiusSq = this.radius * this.radius;
      const radius = this.radius;
      const wrappedTicks = ticks & 131071;
      for (let z = camBZ - radius; z <= camBZ + radius; z++) {
        for (let x = camBX - radius; x <= camBX + radius; x++) {
          const terrain = level?.getHeight?.(x, z) ?? camBY - radius;
          const y0 = Math.max(camBY - radius, terrain);
          const y1 = Math.max(camBY + radius, terrain);
          if (y1 - y0 === 0) continue;
          const precipitation = this.precipitationAt(level, x, z);
          if (precipitation === 0) continue;

          const relX = x + 0.5 - camera.x;
          const relZ = z + 0.5 - camera.z;
          const distanceSq = relX * relX + relZ * relZ;
          const t = Math.min(distanceSq / radiusSq, 1);

          // Light coords of the column (LightCoordsUtil at max(cameraY, terrainHeight))
          const lightY = Math.max(camBY, terrain);
          const sky = Math.max(0, Math.min(15, level?.getSkyLight?.(x, lightY, z) ?? 15));
          const block = Math.max(0, Math.min(15, level?.getBlockLight?.(x, lightY, z) ?? 0));

          const seed = x * x * 3121 + x * 45238971 ^ z * z * 418711 + z * 13761;
          this.rand.setSeed(BigInt(seed | 0));
          if (precipitation === 1) {
            // createRainColumnInstance
            const tickOffset = (x * x * 3121 + x * 45238971 + z * z * 418711 + z * 13761) & 0xff;
            const speed = 3 + this.rand.nextFloat();
            const offset = -((wrappedTicks + tickOffset) / 32) * speed;
            pushColumn(x, z, y0, y1, 0, offset % 32, t * (0.5 - 1) + 1, sky, block);
            rain++;
          } else {
            // createSnowColumnInstance (uses nextDouble + nextGaussian)
            const time = wrappedTicks;
            const u = this.rand.nextDouble() + time * 0.01 * this.rand.nextGaussian();
            const vv = this.rand.nextDouble() + time * this.rand.nextGaussian() * 0.001;
            const vOffset = -((ticks & 511)) / 512;
            const brightenedSky = Math.trunc((sky * 3 + 15) / 4);
            const brightenedBlock = Math.trunc((block * 3 + 15) / 4);
            pushColumn(x, z, y0, y1, u, vOffset + vv, t * (0.5 - 0.8) + 0.8, brightenedSky, brightenedBlock);
            snow++;
          }
        }
      }
    }
    this.rainColumns = rain;
    this.snowColumns = snow;

    gl.enable(gl.BLEND);
    setTranslucentBlend(gl);
    gl.depthMask(false);
    gl.disable(gl.CULL_FACE);

    if (n > 0 && this.rainTex && this.snowTex) {
      gl.bindVertexArray(this.vao);
      gl.bindBuffer(gl.ARRAY_BUFFER, this.vbo);
      gl.bufferData(gl.ARRAY_BUFFER, v.subarray(0, n), gl.DYNAMIC_DRAW);
      this.program.use();
      this.program.setMat4('uViewProj', viewProj);
      this.program.set3f('uCamPos', camera.x, camera.y, camera.z);
      const fogColor = fog?.color ?? [0, 0, 0];
      this.program.set3f('uFogColor', fogColor[0], fogColor[1], fogColor[2]);
      this.program.set1f('uFogStart', fog?.start ?? 0);
      this.program.set1f('uFogEnd', fog?.end ?? 1024);
      this.program.set1f('uFogAlpha', 1);
      gl.activeTexture(gl.TEXTURE1);
      if (this.lightmap) {
        gl.bindTexture(gl.TEXTURE_2D, this.lightmap);
        this.program.set1i('uLightmap', 1);
        this.program.set1i('uHasLightmap', 1);
      } else {
        this.program.set1i('uHasLightmap', 0);
      }
      // 2 draw calls, rain columns first then snow columns (WeatherEffectRenderer.renderWeather)
      const rainVerts = rain * VERTS_PER_COLUMN;
      const snowVerts = snow * VERTS_PER_COLUMN;
      gl.activeTexture(gl.TEXTURE0);
      if (rainVerts > 0) {
        gl.bindTexture(gl.TEXTURE_2D, this.rainTex);
        this.program.set1i('uTex', 0);
        gl.drawArrays(gl.TRIANGLES, 0, rainVerts);
      }
      if (snowVerts > 0) {
        gl.bindTexture(gl.TEXTURE_2D, this.snowTex);
        gl.drawArrays(gl.TRIANGLES, rainVerts, snowVerts);
      }
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
