import type { World } from './world.js';
import { WORLD_MIN_Y, WORLD_MAX_Y } from './world.js';
import type { BlockRegistry, Quad } from './blocks.js';

const FACE_SHADE = [0.5, 1.0, 0.8, 0.8, 0.6, 0.6];
const DIRS: [number, number, number][] = [[0, -1, 0], [0, 1, 0], [0, 0, -1], [0, 0, 1], [-1, 0, 0], [1, 0, 0]];
const STRIDE = 17;

export interface MeshGroup {
  vao: WebGLVertexArrayObject;
  vbo: WebGLBuffer;
  ibo: WebGLBuffer;
  count: number;
  verts: number;
}

export interface ChunkMesh {
  solid: MeshGroup | null;
  translucent: MeshGroup | null;
}

class Builder {
  data = new Float32Array(1 << 16);
  len = 0;
  indices = new Uint32Array(1 << 15);
  indexCount = 0;

  ensure(n: number) {
    if (this.len + n <= this.data.length) return;
    let size = this.data.length;
    while (size < this.len + n) size *= 2;
    const next = new Float32Array(size);
    next.set(this.data.subarray(0, this.len));
    this.data = next;
  }

  ensureIndices(n: number) {
    if (this.indexCount + n <= this.indices.length) return;
    let size = this.indices.length;
    while (size < this.indexCount + n) size *= 2;
    const next = new Uint32Array(size);
    next.set(this.indices.subarray(0, this.indexCount));
    this.indices = next;
  }

  vertex(px: number, py: number, pz: number, u: number, v: number, layer: number, anim: number,
    sky: number, block: number, ao: number, tr: number, tg: number, tb: number, shade: number,
    nx: number, ny: number, nz: number) {
    const d = this.data;
    let o = this.len;
    d[o++] = px; d[o++] = py; d[o++] = pz;
    d[o++] = u; d[o++] = v;
    d[o++] = layer; d[o++] = anim;
    d[o++] = sky; d[o++] = block; d[o++] = ao;
    d[o++] = tr; d[o++] = tg; d[o++] = tb;
    d[o++] = shade;
    d[o++] = nx; d[o++] = ny; d[o++] = nz;
    this.len = o;
  }

  quad(): number {
    const base = this.len / STRIDE;
    this.ensureIndices(6);
    const idx = this.indices;
    let o = this.indexCount;
    idx[o++] = base; idx[o++] = base + 1; idx[o++] = base + 2;
    idx[o++] = base; idx[o++] = base + 2; idx[o++] = base + 3;
    this.indexCount = o;
    return base;
  }
}

interface CellSample { sky: number; block: number; opaque: boolean; }

function readCell(world: World, rocks: BlockRegistry, x: number, y: number, z: number): CellSample {
  if (y < WORLD_MIN_Y) return { sky: 0, block: 0, opaque: true };
  if (y >= WORLD_MAX_Y) return { sky: 15, block: 0, opaque: false };
  const id = world.getBlock(x, y, z);
  const def = rocks.get(id);
  return {
    sky: world.getSky(x, y, z),
    block: world.getBlockLight(x, y, z),
    opaque: id !== 0 && def.flags ? def.flags.opaque : false,
  };
}

/**
 * y of the air cell directly above the water body containing (x, y, z), or y
 * itself when that cell is not water. Used to light a face as if it sat at the
 * surface: sky light decays one step per water block, so sampling inside the
 * column paints every lake-bed tile with its own shade and the floor reads as a
 * checkerboard of missing textures.
 */
function aboveWaterSurface(world: World, rocks: BlockRegistry, x: number, y: number, z: number): number {
  if (rocks.custom[world.getBlock(x, y, z)] !== 1) return y;
  let yy = y;
  const maxY = WORLD_MAX_Y - 1;
  while (yy < maxY && rocks.custom[world.getBlock(x, yy + 1, z)] === 1) yy++;
  return yy + 1;
}

function vertexSample(world: World, rocks: BlockRegistry, x: number, y: number, z: number,
  dir: number, px: number, py: number, pz: number, aoEnabled: boolean, liftWater = false) {
  const [nx, ny, nz] = DIRS[dir];
  const sx = px >= 0.5 ? 1 : -1;
  const sy = py >= 0.5 ? 1 : -1;
  const sz = pz >= 0.5 ? 1 : -1;
  let ax = 0, ay = 0, az = 0, bx = 0, by = 0, bz = 0;
  if (dir === 0 || dir === 1) { ax = sx; bz = sz; }
  else if (dir === 2 || dir === 3) { ax = sx; by = sy; }
  else { az = sz; by = sy; }
  const fx = x + nx, fy = y + ny, fz = z + nz;
  const center = readCell(world, rocks, fx, fy, fz);
  if (center.opaque) return { sky: 0, block: 0, ao: aoEnabled ? 0.2 : 1 };

  const a = readCell(world, rocks, fx + ax, fy + ay, fz + az);
  const b = readCell(world, rocks, fx + bx, fy + by, fz + bz);
  const d = readCell(world, rocks, fx + ax + bx, fy + ay + by, fz + az + bz);

  let ao = 1;
  if (aoEnabled) {
    const occ = (a.opaque ? 1 : 0) + (b.opaque ? 1 : 0) + (d.opaque ? 1 : 0);
    ao = Math.max(0.5, 1 - 0.09 * (a.opaque && b.opaque ? 3 : occ));
  }

  // Ambient occlusion above stays on the face's own plane; only the light is
  // lifted, so the steps of the lake floor keep their shape shading.
  let cl = center, al: CellSample | null = a, bl: CellSample | null = b, dl: CellSample | null = d;
  if (liftWater) {
    const ly = aboveWaterSurface(world, rocks, fx, fy, fz);
    if (ly !== fy) {
      const lift = (s: CellSample, ox: number, oy: number, oz: number): CellSample | null =>
        s.opaque ? null : liftLight(world, rocks, fx + ox, ly + oy, fz + oz);
      cl = lift(center, 0, 0, 0) ?? center;
      al = lift(a, ax, ay, az);
      bl = lift(b, bx, by, bz);
      dl = lift(d, ax + bx, ay + by, az + bz);
    }
  }

  const fix = (s: CellSample) => {
    let ss = s.sky, sb = s.block;
    if (ss === 0 && cl.sky > 2) ss = cl.sky;
    if (sb === 0 && cl.block > 2) sb = cl.block;
    return [ss, sb];
  };
  let skySum = cl.sky, blockSum = cl.block, count = 1;
  for (const s of [al, bl, dl]) {
    if (!s) continue;
    const [ss, sb] = fix(s);
    skySum += ss; blockSum += sb; count++;
  }
  return { sky: skySum / count / 15, block: blockSum / count / 15, ao };
}

function liftLight(world: World, rocks: BlockRegistry, x: number, y: number, z: number): CellSample | null {
  const s = readCell(world, rocks, x, y, z);
  return s.opaque ? null : s;
}

function tintFor(world: World, def: ReturnType<BlockRegistry['get']>, ti: number, x: number, z: number): [number, number, number] {
  if (ti < 0 || def.tintMode === 0) return [1, 1, 1];
  if (def.tintMode === 4) return def.tintColor;
  return world.tintAt(x, z, def.tintMode, def.tintColor);
}

function isCulled(world: World, rocks: BlockRegistry, x: number, y: number, z: number, id: number, q: Quad): boolean {
  if (q.c < 0) return false;
  const [dx, dy, dz] = DIRS[q.c];
  const nx = x + dx, ny = y + dy, nz = z + dz;
  const nid = world.getBlock(nx, ny, nz);
  if (nid === 0) return false;
  if (nid === id && rocks.cullSelf[id]) return true;
  const nd = rocks.get(nid);
  return nd.flags ? nd.flags.opaque : false;
}

function addStructuredQuad(builder: Builder, world: World, rocks: BlockRegistry, def: ReturnType<BlockRegistry['get']>,
  x: number, y: number, z: number, dir: number, positions: number[], uvs: number[], layer: number, anim: number,
  tint: [number, number, number], shade: number, aoEnabled: boolean, forceLight: boolean): void {
  builder.ensure(STRIDE * 4);
  for (let i = 0; i < 4; i++) {
    const px = positions[i * 3], py = positions[i * 3 + 1], pz = positions[i * 3 + 2];
    let sky = 1, block = 1, ao = 1;
    if (!forceLight) {
      const sample = vertexSample(world, rocks, x, y, z, dir, px, py, pz, aoEnabled, true);
      sky = sample.sky; block = sample.block; ao = sample.ao;
    }
    const [nx, ny, nz] = DIRS[dir];
    builder.vertex(x + px, y + py, z + pz, uvs[i * 2] / 16, uvs[i * 2 + 1] / 16,
      layer, anim, sky, block, ao, tint[0], tint[1], tint[2], shade, nx, ny, nz);
  }
  builder.quad();
}

function emitFluid(builder: Builder, world: World, rocks: BlockRegistry, x: number, y: number, z: number,
  id: number, def: ReturnType<BlockRegistry['get']>): void {
  const aboveSame = world.getBlock(x, y + 1, z) === id;
  const top = aboveSame ? 1 : 8 / 9;
  const lava = def.custom === 'lava';
  const tint: [number, number, number] = lava ? [1, 1, 1] : world.tintAt(x, z, def.tintMode, def.tintColor);
  const layer = def.fluidLayer;
  const anim = def.fluidAnim;
  const forceLight = lava;
  const shade = (dir: number) => FACE_SHADE[dir];

  const emit = (dir: number, positions: number[], uvs: number[]) => {
    if (forceLight) {
      addStructuredQuad(builder, world, rocks, def, x, y, z, dir, positions, uvs, layer, anim, tint, 1, true, true);
    } else {
      const base = builder.len / STRIDE;
      for (let i = 0; i < 4; i++) {
        const px = positions[i * 3], py = positions[i * 3 + 1], pz = positions[i * 3 + 2];
        const sample = vertexSample(world, rocks, x, y, z, dir, px, py, pz, false);
        const [nx, ny, nz] = DIRS[dir];
        builder.vertex(x + px, y + py, z + pz, uvs[i * 2] / 16, uvs[i * 2 + 1] / 16,
          layer, anim, sample.sky, sample.block, 1, tint[0], tint[1], tint[2], shade(dir), nx, ny, nz);
      }
      builder.quad();
    }
  };

  if (!aboveSame) {
    const below = world.getBlock(x, y + 1, z);
    if (!rocks.get(below).flags?.opaque) {
      emit(1, [0, top, 0, 0, top, 1, 1, top, 1, 1, top, 0], [0, 0, 0, 16, 16, 16, 16, 0]);
    }
  }
  const sideDirs: [number, number][] = [[2, 0], [3, 0], [4, 0], [5, 0]];
  for (const [dir] of sideDirs) {
    const [dx, , dz] = DIRS[dir];
    const nid = world.getBlock(x + dx, y, z + dz);
    if (nid === id) continue;
    if (rocks.get(nid).flags?.opaque) continue;
    let positions: number[];
    if (dir === 2) positions = [1, top, 0, 1, 0, 0, 0, 0, 0, 0, top, 0];
    else if (dir === 3) positions = [0, top, 1, 0, 0, 1, 1, 0, 1, 1, top, 1];
    else if (dir === 4) positions = [0, top, 0, 0, 0, 0, 0, 0, 1, 0, top, 1];
    else positions = [1, top, 1, 1, 0, 1, 1, 0, 0, 1, top, 0];
    emit(dir, positions, [0, 0, 0, 16, 16, 16, 16, 0]);
  }
  const belowId = world.getBlock(x, y - 1, z);
  if (belowId !== id && !rocks.get(belowId).flags?.opaque) {
    emit(0, [0, 0, 1, 0, 0, 0, 1, 0, 0, 1, 0, 1], [0, 0, 0, 16, 16, 16, 16, 0]);
  }
}

export function buildChunkMesh(gl: WebGL2RenderingContext, world: World, rocks: BlockRegistry, cx: number, cz: number): ChunkMesh {
  const chunk = world.chunkAt(cx, cz);
  if (!chunk) return { solid: null, translucent: null };
  const solid = new Builder();
  const trans = new Builder();
  const baseX = cx * 16, baseZ = cz * 16;

  for (let y = WORLD_MIN_Y; y < WORLD_MAX_Y; y++) {
    for (let lz = 0; lz < 16; lz++) {
      for (let lx = 0; lx < 16; lx++) {
        const x = baseX + lx, z = baseZ + lz;
        const id = chunk.blocks[world.idx(x, y, z)];
        if (id === 0) continue;
        const def = rocks.get(id);
        if (!def.flags) continue;
        const target = rocks.translucent[id] ? trans : solid;
        if (def.custom) {
          emitFluid(target, world, rocks, x, y, z, id, def);
          continue;
        }
        for (const q of def.quads) {
          if (isCulled(world, rocks, x, y, z, id, q)) continue;
          const tint = tintFor(world, def, q.ti, x, z);
          const positions = [q.p[0], q.p[1], q.p[2], q.p[3], q.p[4], q.p[5], q.p[6], q.p[7], q.p[8], q.p[9], q.p[10], q.p[11]];
          const aoEnabled = q.ao && !def.flags.noAO;
          const shade = def.flags.emissive ? 1 : q.shade ? FACE_SHADE[q.d] : 1;
          addStructuredQuad(target, world, rocks, def, x, y, z, q.d, positions, q.uv, q.layer, q.anim,
            tint, shade, aoEnabled, def.flags.emissive);
        }
      }
    }
  }

  const make = (b: Builder): MeshGroup | null => {
    if (b.indexCount === 0) return null;
    const vbo = gl.createBuffer()!;
    gl.bindBuffer(gl.ARRAY_BUFFER, vbo);
    gl.bufferData(gl.ARRAY_BUFFER, b.data.subarray(0, b.len), gl.STATIC_DRAW);
    const ibo = gl.createBuffer()!;
    gl.bindBuffer(gl.ELEMENT_ARRAY_BUFFER, ibo);
    gl.bufferData(gl.ELEMENT_ARRAY_BUFFER, b.indices.subarray(0, b.indexCount), gl.STATIC_DRAW);
    const vao = gl.createVertexArray()!;
    gl.bindVertexArray(vao);
    gl.bindBuffer(gl.ARRAY_BUFFER, vbo);
    gl.enableVertexAttribArray(0); gl.vertexAttribPointer(0, 3, gl.FLOAT, false, STRIDE * 4, 0);
    gl.enableVertexAttribArray(1); gl.vertexAttribPointer(1, 2, gl.FLOAT, false, STRIDE * 4, 12);
    gl.enableVertexAttribArray(2); gl.vertexAttribPointer(2, 1, gl.FLOAT, false, STRIDE * 4, 20);
    gl.enableVertexAttribArray(3); gl.vertexAttribPointer(3, 1, gl.FLOAT, false, STRIDE * 4, 24);
    gl.enableVertexAttribArray(4); gl.vertexAttribPointer(4, 2, gl.FLOAT, false, STRIDE * 4, 28);
    gl.enableVertexAttribArray(5); gl.vertexAttribPointer(5, 1, gl.FLOAT, false, STRIDE * 4, 36);
    gl.enableVertexAttribArray(6); gl.vertexAttribPointer(6, 3, gl.FLOAT, false, STRIDE * 4, 40);
    gl.enableVertexAttribArray(7); gl.vertexAttribPointer(7, 1, gl.FLOAT, false, STRIDE * 4, 52);
    gl.enableVertexAttribArray(8); gl.vertexAttribPointer(8, 3, gl.FLOAT, false, STRIDE * 4, 56);
    gl.bindBuffer(gl.ELEMENT_ARRAY_BUFFER, ibo);
    gl.bindVertexArray(null);
    return { vao, vbo, ibo, count: b.indexCount, verts: b.len / STRIDE };
  };

  return { solid: make(solid), translucent: make(trans) };
}

export function disposeMesh(gl: WebGL2RenderingContext, mesh: ChunkMesh | null): void {
  if (!mesh) return;
  for (const g of [mesh.solid, mesh.translucent]) {
    if (!g) continue;
    gl.deleteVertexArray(g.vao);
    gl.deleteBuffer(g.vbo);
    gl.deleteBuffer(g.ibo);
  }
}
