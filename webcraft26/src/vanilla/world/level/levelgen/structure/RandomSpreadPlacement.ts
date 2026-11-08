// Port of net.minecraft.world.level.levelgen.structure.placement.RandomSpreadStructurePlacement
// (the linear spread used by the villages structure set) plus the per-chunk query that
// ChunkGeneratorStructureState performs.
//
// Data: data/minecraft/structure/villages.json -> salt 10387312, spacing 34, separation 8,
// spread_type linear (limit = spacing - separation = 26).

import { WorldgenRandom } from '../feature/WorldgenRandom.js';

function floorDiv(a: number, b: number): number {
  return Math.floor(a / b);
}

export class RandomSpreadPlacement {
  readonly spacing: number;
  readonly separation: number;
  readonly salt: number;

  constructor(spacing: number, separation: number, salt: number) {
    this.spacing = spacing;
    this.separation = separation;
    this.salt = salt;
  }

  /**
   * RandomSpreadStructurePlacement.getPotentialStructureChunk: the one candidate chunk of the
   * spacing cell that contains (sourceX, sourceZ).
   */
  potentialChunk(seed: bigint, sourceX: number, sourceZ: number, random: WorldgenRandom): { x: number; z: number } {
    const gridX = floorDiv(sourceX, this.spacing);
    const gridZ = floorDiv(sourceZ, this.spacing);
    random.setLargeFeatureWithSalt(seed, gridX, gridZ, this.salt);
    const limit = this.spacing - this.separation;
    const spreadX = random.nextInt(limit);
    const spreadZ = random.nextInt(limit);
    return { x: gridX * this.spacing + spreadX, z: gridZ * this.spacing + spreadZ };
  }

  /** StructurePlacement.isPlacementChunk for the linear spread. */
  isPlacementChunk(seed: bigint, chunkX: number, chunkZ: number, random: WorldgenRandom): boolean {
    const p = this.potentialChunk(seed, chunkX, chunkZ, random);
    return p.x === chunkX && p.z === chunkZ;
  }

  /**
   * Every spacing cell whose candidate structure chunk could reach a box of `reach` chunks
   * around (chunkX, chunkZ). A village's pieces span at most ~4 chunks from its origin chunk,
   * so the origin chunk must lie within reach of the target — cells to test = the 3x3 block of
   * spacing cells around the target chunk's own cell (spacing >= 2 * reach + 1 keeps this exact
   * for every reach <= (spacing - separation) / 2 + separation).
   */
  candidateCells(seed: bigint, chunkX: number, chunkZ: number, reach: number, random: WorldgenRandom): { x: number; z: number }[] {
    const out: { x: number; z: number }[] = [];
    const gridX = floorDiv(chunkX - reach, this.spacing);
    const gridZ = floorDiv(chunkZ - reach, this.spacing);
    const gridX2 = floorDiv(chunkX + reach, this.spacing);
    const gridZ2 = floorDiv(chunkZ + reach, this.spacing);
    for (let gx = gridX; gx <= gridX2; gx++) {
      for (let gz = gridZ; gz <= gridZ2; gz++) {
        random.setLargeFeatureWithSalt(seed, gx, gz, this.salt);
        const limit = this.spacing - this.separation;
        const spreadX = random.nextInt(limit);
        const spreadZ = random.nextInt(limit);
        out.push({ x: gx * this.spacing + spreadX, z: gz * this.spacing + spreadZ });
      }
    }
    return out;
  }
}

/** structure_sets/villages.json placement (all four village variants share one set). */
export const VILLAGE_PLACEMENT = new RandomSpreadPlacement(34, 8, 10387312);

/** Shared WorldgenRandom for placement queries (vanilla also allocates per call). */
export function structureRandom(): WorldgenRandom {
  return new WorldgenRandom(0n);
}
