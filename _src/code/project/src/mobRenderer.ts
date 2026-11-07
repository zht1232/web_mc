import type { World } from './world.js';
import type { BlockRegistry } from './blocks.js';
import type { Arrow, Mob, MobType } from './mobs.js';
import { loadMobAssets, type MobTextures } from './mobAssets.js';
import { ShaderProgram } from './gl.js';
import { mat4, multiply, rotationX, rotationY, rotationZ, translation } from './math.js';
import type { Mat4 } from './math.js';

const VS = `#version 300 es
layout(location = 0) in vec3 aPos;
layout(location = 1) in vec2 aUV;
layout(location = 2) in vec3 aNormal;
uniform mat4 uViewProj;
uniform mat4 uModel;
out vec2 vUV;
out float vShade;
void main() {
  vUV = aUV;
  vShade = aNormal.y > 0.5 ? 1.0 : (aNormal.y < -0.5 ? 0.5 : (abs(aNormal.z) > 0.5 ? 0.8 : 0.6));
  gl_Position = uViewProj * uModel * vec4(aPos, 1.0);
}`;

const FS = `#version 300 es
precision highp float;
in vec2 vUV;
in float vShade;
uniform sampler2D uTex;
uniform vec2 uTexSize;
uniform vec3 uColor;
uniform float uHurt;
uniform float uHasTex;
uniform float uLight;
out vec4 outColor;
void main() {
  vec4 tex = texture(uTex, vUV / uTexSize);
  if (uHasTex > 0.5 && tex.a < 0.35) discard;
  vec3 base = mix(uColor, tex.rgb, uHasTex);
  vec3 lit = base * vShade * uLight;
  lit = mix(lit, vec3(1.0, 0.22, 0.18), uHurt * 0.6);
  outColor = vec4(lit, 1.0);
}`;

type Anim = 'leg' | 'arm' | 'head';
type Box6 = [number, number, number, number, number, number];
type Vec3Tuple = [number, number, number];

interface PartDef {
  box: Box6;                 // px, relative to pivot
  pivot: Vec3Tuple;          // px
  uv: [number, number, number, number, number]; // u,v,w,h,d in texture px
  rot?: Vec3Tuple;           // static rotation (radians)
  anim?: Anim;
  baseRotX?: number;
  phase?: number;
  amp?: number;
}

interface ModelDef {
  texW: number;
  texH: number;
  fallback: Vec3Tuple;
  parts: PartDef[];
}

interface PartRange { part: PartDef; offset: number; count: number }

const PIG: PartDef[] = [
  { box: [-5, -8, -4, 5, 8, 4], pivot: [0, 10, 0], uv: [28, 8, 10, 16, 8], rot: [Math.PI / 2, 0, 0] },
  { box: [-4, -4, -4, 4, 4, 4], pivot: [0, 12, 10], uv: [0, 0, 8, 8, 8], anim: 'head' },
  { box: [-2, -1.5, 4, 2, 1.5, 5], pivot: [0, 12, 10], uv: [16, 16, 4, 3, 1], anim: 'head' },
  { box: [-2, -6, -2, 2, 0, 2], pivot: [-3, 6, 5], uv: [0, 16, 4, 6, 4], anim: 'leg', phase: 0, amp: 0.55 },
  { box: [-2, -6, -2, 2, 0, 2], pivot: [3, 6, 5], uv: [0, 16, 4, 6, 4], anim: 'leg', phase: Math.PI, amp: 0.55 },
  { box: [-2, -6, -2, 2, 0, 2], pivot: [-3, 6, -5], uv: [0, 16, 4, 6, 4], anim: 'leg', phase: Math.PI, amp: 0.55 },
  { box: [-2, -6, -2, 2, 0, 2], pivot: [3, 6, -5], uv: [0, 16, 4, 6, 4], anim: 'leg', phase: 0, amp: 0.55 },
];

const COW: PartDef[] = [
  { box: [-6, -9, -5, 6, 9, 5], pivot: [0, 13, 0], uv: [18, 4, 12, 18, 10], rot: [Math.PI / 2, 0, 0] },
  { box: [-4, -4, -3, 4, 4, 3], pivot: [0, 15, 10], uv: [0, 0, 8, 8, 6], anim: 'head' },
  { box: [-5, 2, -2, -4, 5, -1], pivot: [0, 15, 10], uv: [22, 0, 1, 3, 1], anim: 'head' },
  { box: [4, 2, -2, 5, 5, -1], pivot: [0, 15, 10], uv: [22, 0, 1, 3, 1], anim: 'head' },
  { box: [-2, -12, -2, 2, 0, 2], pivot: [-5, 12, 6], uv: [0, 16, 4, 12, 4], anim: 'leg', phase: 0, amp: 0.5 },
  { box: [-2, -12, -2, 2, 0, 2], pivot: [5, 12, 6], uv: [0, 16, 4, 12, 4], anim: 'leg', phase: Math.PI, amp: 0.5 },
  { box: [-2, -12, -2, 2, 0, 2], pivot: [-5, 12, -6], uv: [0, 16, 4, 12, 4], anim: 'leg', phase: Math.PI, amp: 0.5 },
  { box: [-2, -12, -2, 2, 0, 2], pivot: [5, 12, -6], uv: [0, 16, 4, 12, 4], anim: 'leg', phase: 0, amp: 0.5 },
];

const ZOMBIE: PartDef[] = [
  { box: [-2, -12, -2, 2, 0, 2], pivot: [-2, 12, 0], uv: [0, 16, 4, 12, 4], anim: 'leg', phase: 0, amp: 0.65 },
  { box: [-2, -12, -2, 2, 0, 2], pivot: [2, 12, 0], uv: [0, 16, 4, 12, 4], anim: 'leg', phase: Math.PI, amp: 0.65 },
  { box: [-4, -12, -2, 4, 0, 2], pivot: [0, 24, 0], uv: [16, 16, 8, 12, 4] },
  { box: [-4, -8, -4, 4, 0, 4], pivot: [0, 32, 0], uv: [0, 0, 8, 8, 8], anim: 'head' },
  { box: [-2, -10, -2, 2, 2, 2], pivot: [-6, 22, 0], uv: [40, 16, 4, 12, 4], anim: 'arm', baseRotX: -1.35, phase: 0, amp: 0.12 },
  { box: [-2, -10, -2, 2, 2, 2], pivot: [6, 22, 0], uv: [40, 16, 4, 12, 4], anim: 'arm', baseRotX: -1.35, phase: Math.PI, amp: 0.12 },
];

const SKELETON: PartDef[] = [
  { box: [-1, -12, -1, 1, 0, 1], pivot: [-2, 12, 0], uv: [0, 16, 2, 12, 2], anim: 'leg', phase: 0, amp: 0.7 },
  { box: [-1, -12, -1, 1, 0, 1], pivot: [2, 12, 0], uv: [0, 16, 2, 12, 2], anim: 'leg', phase: Math.PI, amp: 0.7 },
  { box: [-4, -12, -2, 4, 0, 2], pivot: [0, 24, 0], uv: [16, 16, 8, 12, 4] },
  { box: [-4, -8, -4, 4, 0, 4], pivot: [0, 32, 0], uv: [0, 0, 8, 8, 8], anim: 'head' },
  { box: [-1, -10, -1, 1, 2, 1], pivot: [-5, 22, 0], uv: [40, 16, 2, 12, 2], anim: 'arm', baseRotX: -0.25, phase: Math.PI, amp: 0.7 },
  { box: [-1, -10, -1, 1, 2, 1], pivot: [5, 22, 0], uv: [40, 16, 2, 12, 2], anim: 'arm', baseRotX: -0.25, phase: 0, amp: 0.7 },
];

const MODELS: Record<MobType, ModelDef> = {
  pig: { texW: 64, texH: 64, fallback: [0.94, 0.64, 0.63], parts: PIG },
  cow: { texW: 64, texH: 64, fallback: [0.36, 0.27, 0.21], parts: COW },
  zombie: { texW: 64, texH: 64, fallback: [0.31, 0.47, 0.3], parts: ZOMBIE },
  skeleton: { texW: 64, texH: 32, fallback: [0.78, 0.78, 0.74], parts: SKELETON },
};

const ARROW_PART: PartDef = {
  box: [-0.04, -0.04, -0.3, 0.04, 0.04, 0.3],
  pivot: [0, 0, 0],
  uv: [0, 0, 1, 1, 1],
};

const TYPES: MobType[] = ['pig', 'cow', 'zombie', 'skeleton'];

function addBox(data: number[], indices: number[], part: PartDef): void {
  const [bx0, by0, bz0, bx1, by1, bz1] = part.box.map(v => v / 16);
  const [u, v, w, h, d] = part.uv;
  const top: [number, number, number, number] = [u + d, v, w, d];
  const bottom: [number, number, number, number] = [u + d + w, v, w, d];
  const px: [number, number, number, number] = [u, v + d, d, h];
  const pz: [number, number, number, number] = [u + d, v + d, w, h];
  const nx: [number, number, number, number] = [u + d + w, v + d, d, h];
  const nz: [number, number, number, number] = [u + d + w + d, v + d, w, h];
  const faces: { verts: number[][]; n: Vec3Tuple; rect: [number, number, number, number] }[] = [
    { verts: [[bx1, by0, bz1], [bx1, by0, bz0], [bx1, by1, bz0], [bx1, by1, bz1]], n: [1, 0, 0], rect: px },
    { verts: [[bx0, by0, bz0], [bx0, by0, bz1], [bx0, by1, bz1], [bx0, by1, bz0]], n: [-1, 0, 0], rect: nx },
    { verts: [[bx0, by1, bz1], [bx1, by1, bz1], [bx1, by1, bz0], [bx0, by1, bz0]], n: [0, 1, 0], rect: top },
    { verts: [[bx0, by0, bz0], [bx1, by0, bz0], [bx1, by0, bz1], [bx0, by0, bz1]], n: [0, -1, 0], rect: bottom },
    { verts: [[bx0, by0, bz1], [bx1, by0, bz1], [bx1, by1, bz1], [bx0, by1, bz1]], n: [0, 0, 1], rect: pz },
    { verts: [[bx1, by0, bz0], [bx0, by0, bz0], [bx0, by1, bz0], [bx1, by1, bz0]], n: [0, 0, -1], rect: nz },
  ];
  const base = data.length / 8;
  for (const face of faces) {
    const [ru, rv, rw, rh] = face.rect;
    const uvs = [[ru, rv + rh], [ru + rw, rv + rh], [ru + rw, rv], [ru, rv]];
    for (let i = 0; i < 4; i++) {
      const p = face.verts[i];
      data.push(p[0], p[1], p[2], uvs[i][0], uvs[i][1], face.n[0], face.n[1], face.n[2]);
    }
    const o = base + (faces.indexOf(face) * 4);
    indices.push(o, o + 1, o + 2, o, o + 2, o + 3);
  }
}

export class MobRenderer {
  readonly ready: Promise<void>;
  private prog: ShaderProgram;
  private vao: WebGLVertexArrayObject;
  private vbo: WebGLBuffer;
  private ebo: WebGLBuffer;
  private parts: Record<MobType, PartRange[]>;
  private arrowPart: PartRange;
  private textures: MobTextures = { pig: null, cow: null, zombie: null, skeleton: null };
  private white: WebGLTexture;
  private loaded = false;
  private disposed = false;
  private mobM = mat4();
  private partM = mat4();
  private worldM = mat4();
  private arrowM = mat4();
  private rotM = mat4();

  constructor(private gl: WebGL2RenderingContext, private world: World, private rocks: BlockRegistry) {
    this.prog = new ShaderProgram(gl, VS, FS);
    this.vao = gl.createVertexArray()!;
    this.vbo = gl.createBuffer()!;
    this.ebo = gl.createBuffer()!;

    const data: number[] = [];
    const indices: number[] = [];
    const parts = {} as Record<MobType, PartRange[]>;
    for (const type of TYPES) {
      parts[type] = MODELS[type].parts.map(part => {
        const offset = indices.length;
        addBox(data, indices, part);
        return { part, offset, count: 36 };
      });
    }
    const arrowOffset = indices.length;
    addBox(data, indices, ARROW_PART);
    this.parts = parts;
    this.arrowPart = { part: ARROW_PART, offset: arrowOffset, count: 36 };

    gl.bindVertexArray(this.vao);
    gl.bindBuffer(gl.ARRAY_BUFFER, this.vbo);
    gl.bufferData(gl.ARRAY_BUFFER, new Float32Array(data), gl.STATIC_DRAW);
    gl.bindBuffer(gl.ELEMENT_ARRAY_BUFFER, this.ebo);
    gl.bufferData(gl.ELEMENT_ARRAY_BUFFER, new Uint16Array(indices), gl.STATIC_DRAW);
    gl.enableVertexAttribArray(0);
    gl.vertexAttribPointer(0, 3, gl.FLOAT, false, 32, 0);
    gl.enableVertexAttribArray(1);
    gl.vertexAttribPointer(1, 2, gl.FLOAT, false, 32, 12);
    gl.enableVertexAttribArray(2);
    gl.vertexAttribPointer(2, 3, gl.FLOAT, false, 32, 20);
    gl.bindVertexArray(null);

    this.white = gl.createTexture()!;
    gl.bindTexture(gl.TEXTURE_2D, this.white);
    gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, 1, 1, 0, gl.RGBA, gl.UNSIGNED_BYTE, new Uint8Array([255, 255, 255, 255]));
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.NEAREST);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.NEAREST);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
    this.ready = this.load();
  }

  async load(): Promise<void> {
    const textures = await loadMobAssets(this.gl);
    if (this.disposed) {
      for (const tex of Object.values(textures)) if (tex) this.gl.deleteTexture(tex);
      return;
    }
    this.textures = textures;
    this.loaded = true;
  }

  /** Draws into the currently bound framebuffer (the Renderer's scene target). */
  render(gl: WebGL2RenderingContext, viewProj: Mat4, cameraEye: { x: number; y: number; z: number },
    mobs: Mob[], elapsed: number, day = 1, arrows: Arrow[] = []): void {
    if (this.disposed) return;
    gl.useProgram(this.prog.program);
    this.prog.mat4('uViewProj', viewProj);
    this.prog.i('uTex', 0);
    gl.activeTexture(gl.TEXTURE0);
    gl.enable(gl.DEPTH_TEST);
    gl.depthFunc(gl.LEQUAL);
    gl.depthMask(true);
    gl.enable(gl.CULL_FACE);
    gl.cullFace(gl.BACK);
    gl.frontFace(gl.CCW);
    gl.disable(gl.BLEND);
    gl.bindVertexArray(this.vao);

    let bound: WebGLTexture | null = null;
    for (const mob of mobs) {
      if (mob.dead) continue;
      const dx = mob.pos.x - cameraEye.x, dz = mob.pos.z - cameraEye.z;
      if (dx * dx + dz * dz > 64 * 64) continue;
      const cx = mob.pos.x, cy = mob.pos.y + mob.height * 0.5, cz = mob.pos.z;
      const radius = Math.max(mob.width, mob.height) * 0.75 + 0.25;
      if (!this.visible(viewProj, cx, cy, cz, radius)) continue;

      const def = MODELS[mob.type];
      const tex = this.textures[mob.type] ?? this.white;
      if (tex !== bound) {
        gl.bindTexture(gl.TEXTURE_2D, tex);
        bound = tex;
      }
      this.prog.v2('uTexSize', this.textures[mob.type] ? def.texW : 1, this.textures[mob.type] ? def.texH : 1);
      this.prog.f('uHasTex', this.textures[mob.type] ? 1 : 0);
      this.prog.v3('uColor', def.fallback[0], def.fallback[1], def.fallback[2]);
      this.prog.f('uHurt', Math.min(1, mob.hurtTime / 0.28));
      this.prog.f('uLight', this.mobLight(mob, day));

      translation(this.mobM, mob.pos.x, mob.pos.y, mob.pos.z);
      rotationY(this.rotM, mob.yaw);
      multiply(this.mobM, this.mobM, this.rotM);

      const swing = Math.min(1, Math.hypot(mob.vel.x, mob.vel.z) / 1.1);
      for (const range of this.parts[mob.type]) {
        const part = range.part;
        const p = part.pivot;
        translation(this.partM, p[0] / 16, p[1] / 16, p[2] / 16);
        if (part.rot) {
          if (part.rot[0]) { rotationX(this.rotM, part.rot[0]); multiply(this.partM, this.partM, this.rotM); }
          if (part.rot[1]) { rotationY(this.rotM, part.rot[1]); multiply(this.partM, this.partM, this.rotM); }
          if (part.rot[2]) { rotationZ(this.rotM, part.rot[2]); multiply(this.partM, this.partM, this.rotM); }
        }
        let anim = part.baseRotX ?? 0;
        if (part.anim === 'leg' || part.anim === 'arm') {
          anim += Math.sin(mob.walkPhase + (part.phase ?? 0)) * (part.amp ?? 0.5) * swing;
        } else if (part.anim === 'head') {
          anim += Math.sin(mob.walkPhase * 0.5 + elapsed * 1.2 + mob.id) * 0.035;
        }
        if (anim) { rotationX(this.rotM, anim); multiply(this.partM, this.partM, this.rotM); }
        multiply(this.worldM, this.mobM, this.partM);
        this.prog.mat4('uModel', this.worldM);
        gl.drawElements(gl.TRIANGLES, range.count, gl.UNSIGNED_SHORT, range.offset * 2);
      }
    }

    if (arrows.length) {
      gl.bindTexture(gl.TEXTURE_2D, this.white);
      this.prog.v2('uTexSize', 1, 1);
      this.prog.f('uHasTex', 0);
      this.prog.v3('uColor', 0.5, 0.4, 0.27);
      this.prog.f('uHurt', 0);
      this.prog.f('uLight', 0.95);
      for (const a of arrows) {
        const h = Math.hypot(a.vel.x, a.vel.z);
        translation(this.arrowM, a.pos.x, a.pos.y, a.pos.z);
        rotationY(this.rotM, Math.atan2(a.vel.x, a.vel.z));
        multiply(this.arrowM, this.arrowM, this.rotM);
        rotationX(this.rotM, -Math.atan2(a.vel.y, h));
        multiply(this.arrowM, this.arrowM, this.rotM);
        this.prog.mat4('uModel', this.arrowM);
        gl.drawElements(gl.TRIANGLES, this.arrowPart.count, gl.UNSIGNED_SHORT, this.arrowPart.offset * 2);
      }
    }
    gl.bindVertexArray(null);
  }

  private mobLight(mob: Mob, day: number): number {
    const x = Math.floor(mob.pos.x);
    const y = Math.floor(mob.pos.y + mob.height * 0.6);
    const z = Math.floor(mob.pos.z);
    const sky = this.world.getSky(x, y, z) / 15;
    const block = this.world.getBlockLight(x, y, z) / 15;
    const curve = (v: number) => v / (4 - 3 * v);
    const skyTerm = curve(sky) * (0.24 + 0.76 * Math.max(0, Math.min(1, day)));
    const blockTerm = curve(block) * 1.1;
    return Math.min(1.15, 0.14 + Math.max(skyTerm, blockTerm) * 0.9);
  }

  private visible(m: Mat4, x: number, y: number, z: number, r: number): boolean {
    const cx = m[0] * x + m[4] * y + m[8] * z + m[12];
    const cy = m[1] * x + m[5] * y + m[9] * z + m[13];
    const cz = m[2] * x + m[6] * y + m[10] * z + m[14];
    const cw = m[3] * x + m[7] * y + m[11] * z + m[15];
    if (cw < -r) return false;
    const s = Math.abs(cw) + r;
    if (Math.abs(cx) > s || Math.abs(cy) > s) return false;
    return cz >= -s && cz <= s;
  }

  dispose(): void {
    if (this.disposed) return;
    this.disposed = true;
    this.prog.dispose();
    this.gl.deleteBuffer(this.vbo);
    this.gl.deleteBuffer(this.ebo);
    this.gl.deleteVertexArray(this.vao);
    for (const tex of Object.values(this.textures)) if (tex) this.gl.deleteTexture(tex);
    this.gl.deleteTexture(this.white);
  }
}
