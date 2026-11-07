// Port of net.minecraft.core.Direction.
// Order is the vanilla 3D data value order: DOWN, UP, NORTH, SOUTH, WEST, EAST.

export const enum Dir {
  DOWN = 0,
  UP = 1,
  NORTH = 2,
  SOUTH = 3,
  WEST = 4,
  EAST = 5,
}

export const enum Axis {
  X = 0,
  Y = 1,
  Z = 2,
}

export const AXIS_NAMES = ['x', 'y', 'z'] as const;

export interface DirInfo {
  /** 3D data value (vanilla Direction.get3DDataValue) */
  id: number;
  name: string;
  /** opposite data value */
  opposite: number;
  axis: Axis;
  /** step along each axis */
  stepX: number;
  stepY: number;
  stepZ: number;
  /** vanilla Direction.getNormal */
  nx: number;
  ny: number;
  nz: number;
  /** counter-clockwise around Y (vanilla Direction.getCounterClockWise) */
  ccw: number;
  /** clockwise around Y */
  cw: number;
  axisDirection: 1 | -1;
  /** horizontal index, -1 for vertical (vanilla Direction.get2DDataValue) */
  hIndex: number;
  /** vanilla Direction.toYRot, in degrees */
  yRot: number;
}

export const DIRS: readonly DirInfo[] = [
  { id: 0, name: 'down', opposite: 1, axis: Axis.Y, stepX: 0, stepY: -1, stepZ: 0, nx: 0, ny: -1, nz: 0, ccw: 0, cw: 0, axisDirection: -1, hIndex: -1, yRot: 0 },
  { id: 1, name: 'up', opposite: 0, axis: Axis.Y, stepX: 0, stepY: 1, stepZ: 0, nx: 0, ny: 1, nz: 0, ccw: 1, cw: 1, axisDirection: 1, hIndex: -1, yRot: 0 },
  { id: 2, name: 'north', opposite: 3, axis: Axis.Z, stepX: 0, stepY: 0, stepZ: -1, nx: 0, ny: 0, nz: -1, ccw: 4, cw: 5, axisDirection: -1, hIndex: 0, yRot: 180 },
  { id: 3, name: 'south', opposite: 2, axis: Axis.Z, stepX: 0, stepY: 0, stepZ: 1, nx: 0, ny: 0, nz: 1, ccw: 5, cw: 4, axisDirection: 1, hIndex: 2, yRot: 0 },
  { id: 4, name: 'west', opposite: 5, axis: Axis.X, stepX: -1, stepY: 0, stepZ: 0, nx: -1, ny: 0, nz: 0, ccw: 2, cw: 3, axisDirection: -1, hIndex: 1, yRot: 90 },
  { id: 5, name: 'east', opposite: 4, axis: Axis.X, stepX: 1, stepY: 0, stepZ: 0, nx: 1, ny: 0, nz: 0, ccw: 3, cw: 2, axisDirection: 1, hIndex: 3, yRot: 270 },
];

/** Vertical directions only, in the order lighting uses them. */
export const HORIZONTALS: readonly number[] = [Dir.NORTH, Dir.SOUTH, Dir.WEST, Dir.EAST];

/** Vanilla Direction.values() order. */
export const ALL_DIRS: readonly number[] = [Dir.DOWN, Dir.UP, Dir.NORTH, Dir.SOUTH, Dir.WEST, Dir.EAST];

export const DIR_BY_NAME: Record<string, number> = {
  down: Dir.DOWN, up: Dir.UP, north: Dir.NORTH, south: Dir.SOUTH, west: Dir.WEST, east: Dir.EAST,
};

export function opposite(dir: number): number { return DIRS[dir].opposite; }
export function axisOf(dir: number): Axis { return DIRS[dir].axis; }
export function stepX(dir: number): number { return DIRS[dir].stepX; }
export function stepY(dir: number): number { return DIRS[dir].stepY; }
export function stepZ(dir: number): number { return DIRS[dir].stepZ; }
export function isHorizontal(dir: number): boolean { return DIRS[dir].axis !== Axis.Y; }

/** Vanilla Direction.from3DDataValue with a wrap. */
export function from3D(d: number): number { return ((d % 6) + 6) % 6; }

/** Vanilla Direction.fromYRot: the horizontal direction a yaw points at. */
export function fromYRot(yaw: number): number {
  const wrapped = ((yaw % 360) + 360) % 360;
  if (wrapped >= 315 || wrapped < 45) return Dir.SOUTH;
  if (wrapped < 135) return Dir.WEST;
  if (wrapped < 225) return Dir.NORTH;
  return Dir.EAST;
}

/** Vanilla Direction.getNearest for a vector. */
export function getNearest(x: number, y: number, z: number): number {
  let best = Dir.DOWN;
  let bestDot = -Infinity;
  for (const d of ALL_DIRS) {
    const info = DIRS[d];
    const dot = info.nx * x + info.ny * y + info.nz * z;
    if (dot > bestDot) { bestDot = dot; best = d; }
  }
  return best;
}

/** Vanilla Axis.choose */
export function axisChoose(axis: Axis, x: number, y: number, z: number): number {
  return axis === Axis.X ? x : axis === Axis.Y ? y : z;
}

/** The two axes perpendicular to `axis`, in vanilla order (Axis.values minus self). */
export function otherAxes(axis: Axis): [Axis, Axis] {
  return axis === Axis.X ? [Axis.Y, Axis.Z] : axis === Axis.Y ? [Axis.X, Axis.Z] : [Axis.X, Axis.Y];
}
