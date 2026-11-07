// Geometry builders for the first-person pass: the Steve arm cube, baked block models
// (public/mc/models.bin) and `builtin/generated` flat item sprites.
//
// Sources:
//   net/minecraft/client/model/geom/ModelPart.java        (Cube UV layout + /16 scale)
//   net/minecraft/client/model/player/PlayerModel.java    (wide right arm + sleeve boxes)
//   net/minecraft/client/renderer/FaceInfo.java            (quad vertex order per direction)
//   net/minecraft/client/resources/model/cuboid/FaceBakery.java (UV = f(min/max, direction))
//   net/minecraft/client/resources/model/cuboid/ItemModelGenerator.java (extruded sprite + side faces)
//   net/minecraft/client/resources/model/ModelSource.ts    (baked quad layout used by this project)

import type { DecodedModel } from '../model/ModelSource.js';

/** Interleaved vertex: pos(3) uv(2) layer(1) normal(3) = 9 floats. */
export const VERTEX_FLOATS = 9;
export const VERTEX_BYTES = VERTEX_FLOATS * 4;

export interface MeshData {
  vertices: Float32Array;
  indices: Uint32Array;
}

/** Vanilla Direction unit vectors (Direction.java), indexed by quad.dir / face id. */
const NORMALS: [number, number, number][] = [
  [0, -1, 0], // DOWN 0
  [0, 1, 0],  // UP 1
  [0, 0, -1], // NORTH 2
  [0, 0, 1],  // SOUTH 3
  [-1, 0, 0], // WEST 4
  [1, 0, 0],  // EAST 5
];

export function directionNormal(dir: number): [number, number, number] {
  return NORMALS[dir & 7] ?? NORMALS[1];
}

/**
 * FaceInfo vertex order: for each direction the four corners in the order FaceBakery emits
 * them (recalculateWinding() normalises every non-rotated quad to exactly this order).
 */
const FACE_VERTEX_ORDER: number[][][] = [
  // each entry: 4 vertices as [xSel, ySel, zSel] where 0 = min, 1 = max
  [[0, 0, 1], [0, 0, 0], [1, 0, 0], [1, 0, 1]], // DOWN
  [[0, 1, 0], [0, 1, 1], [1, 1, 1], [1, 1, 0]], // UP
  [[1, 1, 0], [1, 0, 0], [0, 0, 0], [0, 1, 0]], // NORTH
  [[0, 1, 1], [0, 0, 1], [1, 0, 1], [1, 1, 1]], // SOUTH
  [[0, 1, 0], [0, 0, 0], [0, 0, 1], [0, 1, 1]], // WEST
  [[1, 1, 1], [1, 0, 1], [1, 0, 0], [1, 1, 0]], // EAST
];

export class MeshBuilder {
  private readonly verts: number[] = [];
  private readonly idx: number[] = [];

  /** Adds a quad in FaceInfo order. `uvs` is (minU,minV,maxU,maxV) in 0..1 sprite space. */
  addFace(
    from: [number, number, number],
    to: [number, number, number],
    uvs: [number, number, number, number],
    direction: number,
    layer: number,
  ): void {
    const [minU, minV, maxU, maxV] = uvs;
    const order = FACE_VERTEX_ORDER[direction];
    const normal = directionNormal(direction);
    const base = this.verts.length / VERTEX_FLOATS;
    for (let i = 0; i < 4; i++) {
      const s = order[i];
      // CuboidFace.UVs.getVertexU/getVertexV
      const u = i === 0 || i === 1 ? minU : maxU;
      const v = i === 0 || i === 3 ? minV : maxV;
      this.verts.push(
        s[0] ? to[0] : from[0],
        s[1] ? to[1] : from[1],
        s[2] ? to[2] : from[2],
        u, v, layer,
        normal[0], normal[1], normal[2],
      );
    }
    this.idx.push(base, base + 1, base + 2, base, base + 2, base + 3);
  }

  /** Quad in a fixed vertex/uv order (used by the arm cube, which has its own UV layout). */
  addRawQuad(
    positions: number[][],
    uvs: number[][],
    layer: number,
    direction: number,
  ): void {
    const normal = directionNormal(direction);
    const base = this.verts.length / VERTEX_FLOATS;
    for (let i = 0; i < 4; i++) {
      this.verts.push(
        positions[i][0], positions[i][1], positions[i][2],
        uvs[i][0], uvs[i][1], layer,
        normal[0], normal[1], normal[2],
      );
    }
    this.idx.push(base, base + 1, base + 2, base, base + 2, base + 3);
  }

  build(): MeshData {
    return { vertices: new Float32Array(this.verts), indices: new Uint32Array(this.idx) };
  }
}

// ---------------------------------------------------------------- Steve arm

/**
 * net.minecraft.client.model.player.PlayerModel#createMesh (wide/classic arm):
 *   right_arm  CubeListBuilder.create().texOffs(40, 16).addBox(-3, -2, -2, 4, 12, 4)  PartPose.offset(-5, 2, 0)
 *   right_sleeve (wide) texOffs(40, 32).addBox(-3, -2, -2, 4, 12, 4, grow 0.25)      PartPose.ZERO
 * The arm is rendered by AvatarRenderer#renderHand with `arm.zRot = 0.1F` for the right hand.
 * ModelPart.Cube stores every coordinate in 1/16 block (ModelPart.Vertex.SCALE_FACTOR = 16).
 */
const ARM_PIVOT = { x: -5, y: 2, z: 0 };
/** AvatarRenderer#renderHand: right arm gets +0.1 rad. */
export const RIGHT_ARM_Z_ROT_DEG = 0.1 * (180 / Math.PI);

interface BoxSpec {
  texOffsX: number;
  texOffsY: number;
  minX: number; minY: number; minZ: number;
  width: number; height: number; depth: number;
  grow: number;
}

/** Port of ModelPart.Cube (two boxes: arm + sleeve). Returns one interleaved mesh. */
function addCube(mb: MeshBuilder, spec: BoxSpec, texSize: number, layer: number): void {
  const { texOffsX: xTexOffs, texOffsY: yTexOffs, grow } = spec;
  const w = spec.width, h = spec.height, d = spec.depth;
  const minX = (spec.minX - grow) / 16;
  const minY = (spec.minY - grow) / 16;
  const minZ = (spec.minZ - grow) / 16;
  const maxX = (spec.minX + w + grow) / 16;
  const maxY = (spec.minY + h + grow) / 16;
  const maxZ = (spec.minZ + d + grow) / 16;

  const t0 = [minX, minY, minZ];
  const t1 = [maxX, minY, minZ];
  const t2 = [maxX, maxY, minZ];
  const t3 = [minX, maxY, minZ];
  const l0 = [minX, minY, maxZ];
  const l1 = [maxX, minY, maxZ];
  const l2 = [maxX, maxY, maxZ];
  const l3 = [minX, maxY, maxZ];

  const u0 = xTexOffs, u1 = xTexOffs + d, u2 = xTexOffs + d + w;
  const u22 = xTexOffs + d + w + w, u3 = xTexOffs + d + w + d, u4 = xTexOffs + d + w + d + w;
  const v0 = yTexOffs, v1 = yTexOffs + d, v2 = yTexOffs + d + h;
  const S = texSize;

  // ModelPart.Polygon(vertices, u0, v0, u1, v1): vertices[0]=(u1,v0), [1]=(u0,v0),
  // [2]=(u0,v1), [3]=(u1,v1); mirrored=false so no reordering.
  const poly = (p: number[][], a: number, b: number, c: number, dd: number, dir: number) => {
    mb.addRawQuad(
      p,
      [[c / S, b / S], [a / S, b / S], [a / S, dd / S], [c / S, dd / S]],
      layer, dir,
    );
  };

  poly([l1, l0, t0, t1], u1, v0, u2, v1, 0); // DOWN
  poly([t2, t3, l3, l2], u2, v1, u22, v0, 1); // UP
  poly([t0, l0, l3, t3], u0, v1, u1, v2, 4); // WEST
  poly([t1, t0, t3, t2], u1, v1, u2, v2, 2); // NORTH
  poly([l1, t1, t2, l2], u2, v1, u3, v2, 5); // EAST
  poly([l0, l1, l2, l3], u3, v1, u4, v2, 3); // SOUTH
}

/**
 * Builds the wide Steve right arm + sleeve mesh. Vertex positions are in *model* units
 * (pivot/16 is applied separately from the renderer, like ModelPart.translateAndRotate).
 */
export function buildPlayerArmMesh(): MeshData {
  const mb = new MeshBuilder();
  // ModelPart.Cube vertices are already /16 in addCube; the pivot is also /16 and applied by
  // the renderer, so the cubes here are relative to the pivot.
  addCube(mb, { texOffsX: 40, texOffsY: 16, minX: -3, minY: -2, minZ: -2, width: 4, height: 12, depth: 4, grow: 0 }, 64, 0);
  addCube(mb, { texOffsX: 40, texOffsY: 32, minX: -3, minY: -2, minZ: -2, width: 4, height: 12, depth: 4, grow: 0.25 }, 64, 0);
  return mb.build();
}

export const ARM_PIVOT_BLOCKS = [ARM_PIVOT.x / 16, ARM_PIVOT.y / 16, ARM_PIVOT.z / 16] as const;

// ---------------------------------------------------------------- baked block model

/** Converts a ModelSource model (block space 0..1, texel UVs) into the hand vertex format. */
export function buildBlockMesh(model: DecodedModel): MeshData {
  const mb = new MeshBuilder();
  for (const q of model.quads) {
    const positions: number[][] = [];
    const uvs: number[][] = [];
    for (let v = 0; v < 4; v++) {
      positions.push([q.p[v * 3], q.p[v * 3 + 1], q.p[v * 3 + 2]]);
      uvs.push([q.uv[v * 2] / 16, q.uv[v * 2 + 1] / 16]);
    }
    // Baked quads already use the FaceInfo vertex order (and UVs are packed per vertex), so
    // keep the raw order and derive the normal from the baked face direction.
    mb.addRawQuad(positions, uvs, q.tex, q.dir);
  }
  return mb.build();
}

// ---------------------------------------------------------------- flat item sprite

export interface SpriteAlpha {
  width: number;
  height: number;
  /** alpha per pixel, row-major with y = 0 at the top of the sprite (vanilla UV v=0 = top). */
  alpha: Uint8Array;
}

/**
 * Port of ItemModelGenerator: front/back quads at z=7.5..8.5 (in 1/16 block units) plus one
 * extruded side quad per opaque/transparent edge transition of the sprite.
 */
export function buildFlatMesh(layer: number, sprite: SpriteAlpha | null): MeshData {
  const mb = new MeshBuilder();
  // Front (SOUTH) and back (NORTH) at z = 7.5/16 .. 8.5/16.
  // ItemModelGenerator: from=(0,0,7.5) to=(16,16,8.5); UVs come from CuboidFace.UVs in texel space.
  const z0 = 7.5 / 16, z1 = 8.5 / 16;
  mb.addFace([0, 0, z0], [1, 1, z1], [0, 0, 1, 1], 3, layer);
  mb.addFace([0, 0, z0], [1, 1, z1], [1, 0, 0, 1], 2, layer);

  if (!sprite) return mb.build();
  const { width, height, alpha } = sprite;
  const xScale = 16 / width;
  const yScale = 16 / height;
  const opaque = (x: number, y: number): boolean =>
    x >= 0 && y >= 0 && x < width && y < height ? alpha[y * width + x] > 0 : false;

  // SideDirection: UP/DOWN have horizontal UVs, LEFT(RIGHT?)/RIGHT use the vertical variant.
  const faces: { dir: number; horizontal: boolean; dx: number; dy: number }[] = [
    { dir: 1, horizontal: true, dx: 0, dy: -1 }, // UP: neighbour above (y-1, top)
    { dir: 0, horizontal: true, dx: 0, dy: 1 },  // DOWN
    { dir: 5, horizontal: false, dx: 1, dy: 0 }, // EAST (LEFT)
    { dir: 4, horizontal: false, dx: -1, dy: 0 }, // WEST (RIGHT)
  ];

  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      if (!opaque(x, y)) continue;
      for (const face of faces) {
        if (opaque(x - face.dx, y - face.dy)) continue;

        const u0 = x + 0.1;
        const u1 = x + 0.9;
        const v0 = face.horizontal ? y + 0.1 : y + 0.9;
        const v1 = face.horizontal ? y + 0.9 : y + 0.1;
        let startX = x, startY = y, endX = x, endY = y;
        switch (face.dir) {
          case 1: endX = x + 1; break;                       // UP
          case 0: endX = x + 1; startY = y + 1; endY = y + 1; break; // DOWN
          case 5: endY = y + 1; break;                       // EAST (sideDirection LEFT)
          case 4: startX = x + 1; endX = x + 1; endY = y + 1; break; // WEST (RIGHT)
        }
        startX *= xScale; endX *= xScale;
        startY *= yScale; endY *= yScale;
        startY = 16 - startY;
        endY = 16 - endY;

        let from: [number, number, number];
        let to: [number, number, number];
        switch (face.dir) {
          case 1: from = [startX, startY, 7.5]; to = [endX, startY, 8.5]; break;
          case 0: from = [startX, endY, 7.5]; to = [endX, endY, 8.5]; break;
          case 5: from = [startX, startY, 7.5]; to = [startX, endY, 8.5]; break;
          default: from = [endX, startY, 7.5]; to = [endX, endY, 8.5]; break;
        }
        // UVs are in texel space (0..16); addFace expects 0..1.
        mb.addFace(
          [from[0] / 16, from[1] / 16, from[2] / 16],
          [to[0] / 16, to[1] / 16, to[2] / 16],
          [u0 * xScale / 16, v0 * yScale / 16, u1 * xScale / 16, v1 * yScale / 16],
          face.dir, layer,
        );
      }
    }
  }
  return mb.build();
}
