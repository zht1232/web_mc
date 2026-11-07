// Vanilla-style world particles: block-break terrain chips with gravity and floor friction.
import type { LoadedAssets } from './assets.js';
import type { BlockRegistry } from './blocks.js';
import type { World } from './world.js';
import { ShaderProgram } from './gl.js';
import type { Mat4 } from './math.js';

const VS = `#version 300 es
layout(location = 0) in vec3 aPos;
layout(location = 1) in vec2 aUV;
layout(location = 2) in float aLayer;
layout(location = 3) in vec3 aColor;
layout(location = 4) in vec2 aLight;
uniform mat4 uViewProj;
out vec2 vUV;
out float vLayer;
out vec3 vColor;
out vec2 vLight;
void main() {
  vUV = aUV;
  vLayer = aLayer;
  vColor = aColor;
  vLight = aLight;
  gl_Position = uViewProj * vec4(aPos, 1.0);
}`;

const FS = `#version 300 es
precision highp float;
in vec2 vUV;
in float vLayer;
in vec3 vColor;
in vec2 vLight;
uniform highp sampler2DArray uTex;
uniform vec3 uSkyColor;
uniform vec3 uBlockColor;
uniform float uSkyFactor;
out vec4 outColor;
void main() {
  vec4 t = texture(uTex, vec3(vUV, vLayer));
  if (t.a < 0.1) discard;
  float sky = vLight.x / (4.0 - 3.0 * vLight.x);
  float blk = vLight.y / (4.0 - 3.0 * vLight.y);
  vec3 light = vec3(0.045) + uSkyColor * sky * uSkyFactor + uBlockColor * blk;
  outColor = vec4(t.rgb * vColor * light, 1.0);
}`;

const STRIDE = 11;
const GRAVITY = 16;
const MAX_PARTICLES = 3000;

interface Particle {
  x: number; y: number; z: number;
  vx: number; vy: number; vz: number;
  life: number; maxLife: number;
  size: number;
  layer: number;
  u0: number; v0: number;
  r: number; g: number; b: number;
}

export class ParticleSystem {
  private particles: Particle[] = [];
  private program: ShaderProgram;
  private vao: WebGLVertexArrayObject;
  private vbo: WebGLBuffer;
  private data = new Float32Array(MAX_PARTICLES * 6 * STRIDE);
  private gl: WebGL2RenderingContext;
  enabled = true;

  constructor(gl: WebGL2RenderingContext, private assets: LoadedAssets, private rocks: BlockRegistry, private world: World) {
    this.gl = gl;
    this.program = new ShaderProgram(gl, VS, FS);
    this.vao = gl.createVertexArray()!;
    this.vbo = gl.createBuffer()!;
    gl.bindVertexArray(this.vao);
    gl.bindBuffer(gl.ARRAY_BUFFER, this.vbo);
    gl.bufferData(gl.ARRAY_BUFFER, this.data.byteLength, gl.DYNAMIC_DRAW);
    const s = STRIDE * 4;
    gl.enableVertexAttribArray(0); gl.vertexAttribPointer(0, 3, gl.FLOAT, false, s, 0);
    gl.enableVertexAttribArray(1); gl.vertexAttribPointer(1, 2, gl.FLOAT, false, s, 12);
    gl.enableVertexAttribArray(2); gl.vertexAttribPointer(2, 1, gl.FLOAT, false, s, 20);
    gl.enableVertexAttribArray(3); gl.vertexAttribPointer(3, 3, gl.FLOAT, false, s, 24);
    gl.enableVertexAttribArray(4); gl.vertexAttribPointer(4, 2, gl.FLOAT, false, s, 36);
    gl.bindVertexArray(null);
  }

  get count(): number { return this.particles.length; }

  clear(): void { this.particles.length = 0; }

  /** Spawns the chips vanilla throws out when a block is destroyed. */
  destroyBlock(x: number, y: number, z: number, id: number): void {
    if (!this.enabled || id === 0) return;
    const def = this.rocks.get(id);
    if (!def || def.custom) return;
    const top = def.quads.find(q => q.d === 1) ?? def.quads[0];
    if (!top) return;
    const tint = this.rocks.tintMode[id] === 0 ? [1, 1, 1] : def.tintColor;
    const solid = this.rocks.solid[id] === 1;
    const n = solid ? 14 : 6;
    for (let i = 0; i < n; i++) {
      const size = 0.07 + Math.random() * 0.055;
      this.push({
        x: x + 0.15 + Math.random() * 0.7,
        y: y + 0.15 + Math.random() * 0.7,
        z: z + 0.15 + Math.random() * 0.7,
        vx: (Math.random() - 0.5) * 2.6,
        vy: Math.random() * 3.4 + 0.6,
        vz: (Math.random() - 0.5) * 2.6,
        life: 0.75 + Math.random() * 0.75,
        maxLife: 1.5,
        size,
        layer: top.layer,
        // A 4x4 pixel window at a random offset, like vanilla's TerrainParticle.
        u0: (3 + Math.floor(Math.random() * 3)) / 16,
        v0: (3 + Math.floor(Math.random() * 3)) / 16,
        r: tint[0], g: tint[1], b: tint[2],
      });
    }
  }

  /** A short puff of the block's own material, used for impacts and landings. */
  hitBlock(x: number, y: number, z: number, id: number, nx: number, ny: number, nz: number, amount = 4): void {
    if (!this.enabled || id === 0) return;
    const def = this.rocks.get(id);
    const quad = def.quads.find(q => q.d === 1) ?? def.quads[0];
    if (!quad) return;
    for (let i = 0; i < amount; i++) {
      this.push({
        x: x + 0.5 + nx * 0.55 + (Math.random() - 0.5) * 0.5,
        y: y + 0.5 + ny * 0.55 + (Math.random() - 0.5) * 0.5,
        z: z + 0.5 + nz * 0.55 + (Math.random() - 0.5) * 0.5,
        vx: nx * 1.4 + (Math.random() - 0.5) * 1.2,
        vy: ny * 1.4 + Math.random() * 1.6,
        vz: nz * 1.4 + (Math.random() - 0.5) * 1.2,
        life: 0.35 + Math.random() * 0.35,
        maxLife: 0.7,
        size: 0.05 + Math.random() * 0.04,
        layer: quad.layer,
        u0: (3 + Math.floor(Math.random() * 3)) / 16,
        v0: (3 + Math.floor(Math.random() * 3)) / 16,
        r: 1, g: 1, b: 1,
      });
    }
  }

  private push(p: Particle): void {
    if (this.particles.length >= MAX_PARTICLES) this.particles.shift();
    this.particles.push(p);
  }

  tick(dt: number): void {
    const list = this.particles;
    for (let i = list.length - 1; i >= 0; i--) {
      const p = list[i];
      p.life -= dt;
      if (p.life <= 0) { list.splice(i, 1); continue; }
      p.vy -= GRAVITY * dt;
      let nx = p.x + p.vx * dt;
      let ny = p.y + p.vy * dt;
      const nz = p.z + p.vz * dt;
      if (this.solidAt(nx, p.y, p.z)) nx = p.x;
      if (!this.solidAt(p.x, p.y, nz)) { p.z = nz; }
      if (this.solidAt(p.x, ny, p.z)) {
        if (p.vy < 0) {
          ny = Math.floor(ny) + 1 + p.size * 0.5;
          p.vx *= 0.62;
          p.vz *= 0.62;
          p.vy = 0;
        } else {
          ny = p.y;
          p.vy = 0;
        }
      }
      p.x = nx; p.y = ny; p.z = nz;
      p.vx *= 1 - 1.1 * dt;
      p.vz *= 1 - 1.1 * dt;
    }
  }

  private solidAt(x: number, y: number, z: number): boolean {
    const id = this.world.getBlock(Math.floor(x), Math.floor(y), Math.floor(z));
    return id !== 0 && this.rocks.solid[id] === 1;
  }

  render(gl: WebGL2RenderingContext, viewProj: Mat4, eye: [number, number, number],
    skyColor: [number, number, number], blockColor: [number, number, number], skyFactor: number): void {
    if (!this.particles.length) return;
    // Camera basis rows from the view-projection matrix give a billboard aligned to the screen.
    let rx = viewProj[0], ry = viewProj[4], rz = viewProj[8];
    let rlen = Math.hypot(rx, ry, rz) || 1;
    rx /= rlen; ry /= rlen; rz /= rlen;
    let ux = viewProj[1], uy = viewProj[5], uz = viewProj[9];
    const ulen = Math.hypot(ux, uy, uz) || 1;
    ux /= ulen; uy /= ulen; uz /= ulen;
    // Right must stay orthogonal to up so quads never shear at steep pitch.
    const dx = rx * ux + ry * uy + rz * uz;
    rx -= dx * ux; ry -= dx * uy; rz -= dx * uz;
    rlen = Math.hypot(rx, ry, rz) || 1;
    rx /= rlen; ry /= rlen; rz /= rlen;

    const data = this.data;
    let o = 0;
    for (const p of this.particles) {
      const hs = p.size * 0.5;
      const light = this.lightAt(p.x, p.y, p.z);
      const u1 = p.u0, v1 = p.v0, u2 = p.u0 + 0.25, v2 = p.v0 + 0.25;
      const corners: [number, number, number, number][] = [
        [p.x - rx * hs - ux * hs, p.y - ry * hs - uy * hs, p.z - rz * hs - uz * hs, 0],
        [p.x + rx * hs - ux * hs, p.y + ry * hs - uy * hs, p.z + rz * hs - uz * hs, 1],
        [p.x + rx * hs + ux * hs, p.y + ry * hs + uy * hs, p.z + rz * hs + uz * hs, 2],
        [p.x - rx * hs + ux * hs, p.y - ry * hs + uy * hs, p.z - rz * hs + uz * hs, 3],
      ];
      const us = [u1, u2, u2, u1];
      const vs = [v1, v1, v2, v2];
      // WebGL2 has no GL_QUADS, so emit two triangles per billboard.
      for (const i of [0, 1, 2, 0, 2, 3]) {
        const c = corners[i];
        data[o++] = c[0]; data[o++] = c[1]; data[o++] = c[2];
        data[o++] = us[c[3]]; data[o++] = vs[c[3]];
        data[o++] = p.layer;
        data[o++] = p.r; data[o++] = p.g; data[o++] = p.b;
        data[o++] = light[0]; data[o++] = light[1];
      }
    }
    const quads = this.particles.length;
    gl.useProgram(this.program.program);
    gl.bindVertexArray(this.vao);
    gl.bindBuffer(gl.ARRAY_BUFFER, this.vbo);
    gl.bufferSubData(gl.ARRAY_BUFFER, 0, data.subarray(0, quads * 6 * STRIDE));
    this.program.mat4('uViewProj', viewProj);
    this.program.v3('uSkyColor', skyColor[0], skyColor[1], skyColor[2]);
    this.program.v3('uBlockColor', blockColor[0], blockColor[1], blockColor[2]);
    this.program.f('uSkyFactor', skyFactor);
    gl.activeTexture(gl.TEXTURE0);
    gl.bindTexture(gl.TEXTURE_2D_ARRAY, this.assets.texArray);
    this.program.i('uTex', 0);
    gl.enable(gl.DEPTH_TEST);
    gl.depthMask(true);
    gl.disable(gl.BLEND);
    gl.disable(gl.CULL_FACE);
    gl.drawArrays(gl.TRIANGLES, 0, quads * 6);
    gl.enable(gl.CULL_FACE);
    gl.bindVertexArray(null);
  }

  private lightAt(x: number, y: number, z: number): [number, number] {
    const bx = Math.floor(x), by = Math.floor(y), bz = Math.floor(z);
    let sky = this.world.getSky(bx, by, bz);
    let blk = this.world.getBlockLight(bx, by, bz);
    if (sky <= 0 && blk <= 0) {
      sky = this.world.getSky(bx, by + 1, bz);
      blk = this.world.getBlockLight(bx, by + 1, bz);
    }
    return [sky / 15, blk / 15];
  }

  dispose(): void {
    this.program.dispose();
    this.gl.deleteBuffer(this.vbo);
    this.gl.deleteVertexArray(this.vao);
  }
}
