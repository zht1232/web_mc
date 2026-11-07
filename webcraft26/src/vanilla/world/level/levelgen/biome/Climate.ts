// Port of net.minecraft.world.level.biome.Climate (Parameter, ParameterPoint, the RTree
// backed ParameterList, Sampler) and MultiNoiseBiomeSource.
//
// The RTree is ported rather than replaced by a brute force nearest-point scan: the search
// is a branch-and-bound over axis-aligned boxes, which is what makes 1536 climate samples
// per chunk affordable (a linear scan over the 7594 parameter points would be ~12M distance
// computations per chunk). It also reproduces vanilla's tie-breaking, since ties are resolved
// in the same tree order.

import { DensityFunction, SinglePointContext } from '../density/DensityFunction.js';

/** Climate.quantizeCoord: `(long) (coord * 10000.0f)`, i.e. float multiply then truncate. */
export function quantizeCoord(coord: number): number {
  return Math.trunc(Math.fround(Math.fround(coord) * Math.fround(10000)));
}

export function unquantizeCoord(coord: number): number {
  return coord / 10000;
}

/** Port of Climate.Parameter: an inclusive [min, max] interval in quantized space. */
export class Parameter {
  constructor(readonly min: number, readonly max: number) {}

  static point(value: number): Parameter {
    const q = quantizeCoord(value);
    return new Parameter(q, q);
  }

  static span(min: number, max: number): Parameter {
    if (min > max) throw new Error(`min > max: ${min} ${max}`);
    return new Parameter(quantizeCoord(min), quantizeCoord(max));
  }

  /** Climate.Parameter.distance(long) */
  distance(target: number): number {
    const above = target - this.max;
    const below = this.min - target;
    return above > 0 ? above : Math.max(below, 0);
  }

  span(other: Parameter | null): Parameter {
    return other === null ? this : new Parameter(Math.min(this.min, other.min), Math.max(this.max, other.max));
  }
}

/** Port of Climate.ParameterPoint. */
export class ParameterPoint {
  constructor(
    readonly temperature: Parameter,
    readonly humidity: Parameter,
    readonly continentalness: Parameter,
    readonly erosion: Parameter,
    readonly depth: Parameter,
    readonly weirdness: Parameter,
    readonly offset: number,
  ) {}

  parameterSpace(): Parameter[] {
    return [
      this.temperature, this.humidity, this.continentalness, this.erosion,
      this.depth, this.weirdness, new Parameter(this.offset, this.offset),
    ];
  }

  fitness(target: TargetPoint): number {
    return sq(this.temperature.distance(target.temperature))
      + sq(this.humidity.distance(target.humidity))
      + sq(this.continentalness.distance(target.continentalness))
      + sq(this.erosion.distance(target.erosion))
      + sq(this.depth.distance(target.depth))
      + sq(this.weirdness.distance(target.weirdness))
      + sq(this.offset);
  }
}

function sq(v: number): number { return v * v; }

/** Port of Climate.TargetPoint. */
export class TargetPoint {
  constructor(
    public temperature: number,
    public humidity: number,
    public continentalness: number,
    public erosion: number,
    public depth: number,
    public weirdness: number,
  ) {}

  toParameterArray(out: Float64Array): void {
    out[0] = this.temperature;
    out[1] = this.humidity;
    out[2] = this.continentalness;
    out[3] = this.erosion;
    out[4] = this.depth;
    out[5] = this.weirdness;
    out[6] = 0;
  }
}

/** Climate.target(...) */
export function target(
  temperature: number, humidity: number, continentalness: number,
  erosion: number, depth: number, weirdness: number,
): TargetPoint {
  return new TargetPoint(
    quantizeCoord(temperature), quantizeCoord(humidity), quantizeCoord(continentalness),
    quantizeCoord(erosion), quantizeCoord(depth), quantizeCoord(weirdness),
  );
}

// ------------------------------------------------------------------ RTree

const CHILDREN_PER_NODE = 6;

/**
 * Port of Climate.RTree, flattened for speed.
 *
 * The build produces exactly vanilla's tree (same bucketisation, same sort order, so ties are
 * resolved identically), but the finished tree is serialised into flat typed arrays with
 * children stored contiguously, level by level. The nearest-point query then walks a children
 * range with no virtual calls at all - which matters because this runs 1536 times per chunk.
 */
export class RTree<T> {
  private constructor(
    private readonly bounds: Float64Array,
    private readonly firstChild: Int32Array,
    private readonly childCount: Int32Array,
    private readonly value: Int32Array,
    private readonly values: readonly T[],
  ) {}

  static create<T>(values: readonly (readonly [ParameterPoint, T])[]): RTree<T> {
    if (values.length === 0) throw new Error('Need at least one value to build the search tree.');
    const leaves = values.map((entry, i) => new BuildLeaf(buildPointBounds(entry[0]), i));
    const root = buildTree(7, leaves);

    // Serialise breadth first so every node's children are contiguous.
    const order: BuildNode[] = [];
    const queue: BuildNode[] = [root];
    while (queue.length > 0) {
      const node = queue.shift() as BuildNode;
      order.push(node);
      if (node.children) for (const c of node.children) queue.push(c);
    }
    const index = new Map<BuildNode, number>();
    order.forEach((n, i) => index.set(n, i));

    const bounds = new Float64Array(order.length * 14);
    const firstChild = new Int32Array(order.length);
    const childCount = new Int32Array(order.length);
    const value = new Int32Array(order.length).fill(-1);
    order.forEach((n, i) => {
      bounds.set(n.bounds, i * 14);
      if (n.children) {
        firstChild[i] = index.get(n.children[0]) as number;
        childCount[i] = n.children.length;
      } else {
        value[i] = n.leafValue as number;
      }
    });
    return new RTree<T>(bounds, firstChild, childCount, value, values.map((v) => v[1]));
  }

  private distance(node: number, target: Float64Array): number {
    const b = this.bounds;
    const base = node * 14;
    let d = 0;
    for (let i = 0; i < 7; i++) {
      const v = target[i];
      const lo = b[base + i * 2];
      const hi = b[base + i * 2 + 1];
      const above = v - hi;
      const below = lo - v;
      const delta = above > 0 ? above : below > 0 ? below : 0;
      d += delta * delta;
    }
    return d;
  }

  search(targetPoint: TargetPoint, target: Float64Array): T {
    targetPoint.toParameterArray(target);
    let closestValue = -1;
    let minDistance = Infinity;
    // depth-first with an explicit stack; `children` are contiguous so this is cache friendly
    const stack: number[] = [0];
    while (stack.length > 0) {
      const node = stack.pop() as number;
      if (minDistance <= this.distance(node, target)) continue;
      const count = this.childCount[node];
      if (count === 0) {
        const v = this.distance(node, target);
        if (v < minDistance) { minDistance = v; closestValue = this.value[node]; }
        continue;
      }
      const first = this.firstChild[node];
      for (let i = count - 1; i >= 0; i--) stack.push(first + i);
    }
    return this.values[closestValue];
  }
}

interface BuildNode {
  readonly bounds: Float64Array;
  readonly children: BuildNode[] | null;
  readonly leafValue: number | null;
}

class BuildLeaf implements BuildNode {
  readonly children = null;
  constructor(readonly bounds: Float64Array, readonly leafValue: number) {}
}

class BuildSubTree implements BuildNode {
  readonly leafValue = null;
  constructor(readonly bounds: Float64Array, readonly children: BuildNode[]) {}
}

function buildPointBounds(point: ParameterPoint): Float64Array {
  const space = point.parameterSpace();
  const b = new Float64Array(14);
  for (let i = 0; i < 7; i++) {
    b[i * 2] = space[i].min;
    b[i * 2 + 1] = space[i].max;
  }
  return b;
}

function buildTree(dimensions: number, children: BuildNode[]): BuildNode {
  if (children.length === 0) throw new Error('Need at least one child to build a node');
  if (children.length === 1) return children[0];

  if (children.length <= CHILDREN_PER_NODE) {
    children.sort((a, b) => totalMagnitude(a) - totalMagnitude(b));
    return new BuildSubTree(buildSpace(children), children.slice());
  }

  let minCost = Number.MAX_SAFE_INTEGER;
  let minDimension = -1;
  let minBuckets: BuildSubTree[] = [];
  for (let d = 0; d < dimensions; d++) {
    sortNodes(children, dimensions, d, false);
    const buckets = bucketize(children);
    let totalCost = 0;
    for (const bucket of buckets) totalCost += costOf(bucket.bounds);
    if (minCost > totalCost) {
      minCost = totalCost;
      minDimension = d;
      minBuckets = buckets;
    }
  }
  sortNodes(minBuckets, dimensions, minDimension, true);
  return new BuildSubTree(
    buildSpace(minBuckets),
    minBuckets.map((b) => buildTree(dimensions, b.children.slice())),
  );
}

function totalMagnitude(node: BuildNode): number {
  let total = 0;
  for (let d = 0; d < 7; d++) total += Math.abs(Math.trunc((node.bounds[d * 2] + node.bounds[d * 2 + 1]) / 2));
  return total;
}

function sortNodes(nodes: BuildNode[], dimensions: number, dimension: number, absolute: boolean): void {
  const key = (n: BuildNode, d: number): number => {
    const center = Math.trunc((n.bounds[d * 2] + n.bounds[d * 2 + 1]) / 2);
    return absolute ? Math.abs(center) : center;
  };
  const dims: number[] = [dimension];
  for (let d = 1; d < dimensions; d++) dims.push((dimension + d) % dimensions);
  nodes.sort((a, b) => {
    for (const d of dims) {
      const r = key(a, d) - key(b, d);
      if (r !== 0) return r;
    }
    return 0;
  });
}

function bucketize(nodes: BuildNode[]): BuildSubTree[] {
  const buckets: BuildSubTree[] = [];
  let children: BuildNode[] = [];
  const expected = Math.floor(Math.pow(6, Math.floor(Math.log(nodes.length - 0.01) / Math.log(6))));
  for (const child of nodes) {
    children.push(child);
    if (children.length >= expected) {
      buckets.push(new BuildSubTree(buildSpace(children), children));
      children = [];
    }
  }
  if (children.length > 0) buckets.push(new BuildSubTree(buildSpace(children), children));
  return buckets;
}

function buildSpace(children: readonly BuildNode[]): Float64Array {
  const bounds = new Float64Array(14);
  for (let d = 0; d < 7; d++) {
    let lo = Infinity;
    let hi = -Infinity;
    for (const child of children) {
      if (child.bounds[d * 2] < lo) lo = child.bounds[d * 2];
      if (child.bounds[d * 2 + 1] > hi) hi = child.bounds[d * 2 + 1];
    }
    bounds[d * 2] = lo;
    bounds[d * 2 + 1] = hi;
  }
  return bounds;
}

function costOf(bounds: Float64Array): number {
  let result = 0;
  for (let d = 0; d < 7; d++) result += Math.abs(bounds[d * 2 + 1] - bounds[d * 2]);
  return result;
}

// ------------------------------------------------------------------ ParameterList

/** Port of Climate.ParameterList: point list + nearest-neighbour index. */
export class ParameterList<T> {
  private readonly index: RTree<T>;
  private readonly targetArray = new Float64Array(7);

  constructor(readonly values: readonly (readonly [ParameterPoint, T])[]) {
    this.index = RTree.create(values);
  }

  findValue(targetPoint: TargetPoint): T { return this.index.search(targetPoint, this.targetArray); }

  /** Kept for parity with older vanilla names; the 26.2 tree search is the same metric. */
  findValuePositional(targetPoint: TargetPoint): T { return this.index.search(targetPoint, this.targetArray); }
}

// ------------------------------------------------------------------ Sampler

/** Port of Climate.Sampler. */
export class ClimateSampler {
  private readonly ctx = new SinglePointContext(0, 0, 0);
  /** reused so a chunk's 1536 samples produce no garbage */
  private readonly point = new TargetPoint(0, 0, 0, 0, 0, 0);

  constructor(
    readonly temperature: DensityFunction,
    readonly humidity: DensityFunction,
    readonly continentalness: DensityFunction,
    readonly erosion: DensityFunction,
    readonly depth: DensityFunction,
    readonly weirdness: DensityFunction,
  ) {}

  /** Climate.Sampler.sample(quartX, quartY, quartZ) - quart coords, block coords inside. */
  sample(quartX: number, quartY: number, quartZ: number): TargetPoint {
    const ctx = this.ctx;
    ctx.blockX = quartX << 2;
    ctx.blockY = quartY << 2;
    ctx.blockZ = quartZ << 2;
    const p = this.point;
    p.temperature = quantizeCoord(Math.fround(this.temperature.compute(ctx)));
    p.humidity = quantizeCoord(Math.fround(this.humidity.compute(ctx)));
    p.continentalness = quantizeCoord(Math.fround(this.continentalness.compute(ctx)));
    p.erosion = quantizeCoord(Math.fround(this.erosion.compute(ctx)));
    p.depth = quantizeCoord(Math.fround(this.depth.compute(ctx)));
    p.weirdness = quantizeCoord(Math.fround(this.weirdness.compute(ctx)));
    return p;
  }
}

/** Port of MultiNoiseBiomeSource (the only biome source the overworld preset uses). */
export class MultiNoiseBiomeSource {
  constructor(private readonly parameters: ParameterList<number>) {}

  /** MultiNoiseBiomeSource.getNoiseBiome(quartX, quartY, quartZ, sampler). */
  getNoiseBiome(quartX: number, quartY: number, quartZ: number, sampler: ClimateSampler): number {
    return this.parameters.findValue(sampler.sample(quartX, quartY, quartZ));
  }

  getNoiseBiomeAtTarget(targetPoint: TargetPoint): number {
    return this.parameters.findValue(targetPoint);
  }
}

/** Builds the parameter list from the packed `biomeParameterPoints` rows. */
export function buildParameterList(
  rowLayout: readonly string[],
  points: readonly (readonly number[])[],
): ParameterList<number> {
  const idx = (name: string): number => {
    const i = rowLayout.indexOf(name);
    if (i < 0) throw new Error(`biomeParameterPoints.rowLayout is missing ${name}`);
    return i;
  };
  const biomeAt = idx('biomeIndex');
  const tMin = idx('temperatureMin'), tMax = idx('temperatureMax');
  const hMin = idx('humidityMin'), hMax = idx('humidityMax');
  const cMin = idx('continentalnessMin'), cMax = idx('continentalnessMax');
  const eMin = idx('erosionMin'), eMax = idx('erosionMax');
  const dMin = idx('depthMin'), dMax = idx('depthMax');
  const wMin = idx('weirdnessMin'), wMax = idx('weirdnessMax');
  const off = idx('offset');

  const values: (readonly [ParameterPoint, number])[] = points.map((row) => {
    // The packer already divided by 10000; quantizeCoord brings it back to the exact
    // integer vanilla compares against.
    const point = new ParameterPoint(
      Parameter.span(row[tMin], row[tMax]),
      Parameter.span(row[hMin], row[hMax]),
      Parameter.span(row[cMin], row[cMax]),
      Parameter.span(row[eMin], row[eMax]),
      Parameter.span(row[dMin], row[dMax]),
      Parameter.span(row[wMin], row[wMax]),
      quantizeCoord(row[off]),
    );
    return [point, row[biomeAt]] as const;
  });
  return new ParameterList<number>(values);
}
