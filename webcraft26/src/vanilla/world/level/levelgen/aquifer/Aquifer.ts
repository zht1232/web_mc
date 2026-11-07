// Port of net.minecraft.world.level.levelgen.Aquifer (the NoiseBasedAquifer).
//
// Aquifers are what put water into caves and oceans at the right level: the density function
// only says "solid vs not solid", the aquifer decides which fluid fills the non-solid space,
// using a lattice of 16x12x16 cells that each get a random fluid level and type, plus barrier
// noise to break up the transition between neighbouring cells.
//
// This is a full port: lattice, the nearest-four-cell search, the barrier pressure test, the
// randomised fluid surface level and the lava/water type pick are all vanilla's.

import { DensityFunction, FunctionContext, SinglePointContext } from '../density/DensityFunction.js';
import type { PositionalRandomFactory } from '../../../../core/Random.js';

/** DimensionType.WAY_BELOW_MIN_Y */
export const WAY_BELOW_MIN_Y = -10000064;

/** Aquifer.FluidStatus: a fluid level plus the block that fills below it. */
export class FluidStatus {
  constructor(readonly fluidLevel: number, readonly fluidType: number) {}

  /** Block state at `blockY`: the fluid below the level, air above it. */
  at(blockY: number, airState: number): number {
    return blockY < this.fluidLevel ? this.fluidType : airState;
  }
}

/** Aquifer.FluidPicker. */
export interface FluidPicker {
  computeFluid(blockX: number, blockY: number, blockZ: number): FluidStatus;
}

/** Block registry bits the aquifer needs; keeps this file free of MinecraftData. */
export interface FluidLookup {
  /** minecraft:air default state (id 0) */
  readonly air: number;
  /** minecraft:water[level=0] */
  readonly water: number;
  /** minecraft:lava */
  readonly lava: number;
  readonly waterBlock: number;
  readonly lavaBlock: number;
  /** Block.BLOCK_STATE_REGISTRY id -> block id */
  blockIdOf(state: number): number;
}

/** The slice of NoiseChunk the aquifer uses. */
export interface ChunkAccessForAquifer {
  preliminarySurfaceLevel(blockX: number, blockZ: number): number;
  maxPreliminarySurfaceLevel(minBlockX: number, minBlockZ: number, maxBlockX: number, maxBlockZ: number): number;
}

/** Router entries the aquifer samples (already built density functions). */
export interface AquiferRouter {
  readonly barrier: DensityFunction;
  readonly fluidLevelFloodedness: DensityFunction;
  readonly fluidLevelSpread: DensityFunction;
  readonly lava: DensityFunction;
  readonly erosion: DensityFunction;
  readonly depth: DensityFunction;
}

/** Port of the Aquifer interface. */
export interface Aquifer {
  /** null means "no override, use the default block". */
  computeSubstance(ctx: FunctionContext, density: number): number | null;
  readonly shouldScheduleFluidUpdate: boolean;
}

/** Aquifer.createDisabled (aquifers_enabled = false). */
export class DisabledAquifer implements Aquifer {
  constructor(private readonly fluidPicker: FluidPicker, private readonly lookup: FluidLookup) {}

  computeSubstance(ctx: FunctionContext, density: number): number | null {
    if (density > 0) return null;
    return this.fluidPicker.computeFluid(ctx.blockX, ctx.blockY, ctx.blockZ).at(ctx.blockY, this.lookup.air);
  }

  get shouldScheduleFluidUpdate(): boolean { return false; }
}

const Y_SPACING = 12;
const FLOWING_UPDATE_SIMULARITY = similarity(100, 144);

/** The chunk-local block offsets the aquifer samples to find the local surface. */
const SURFACE_SAMPLING_OFFSETS_IN_CHUNKS: readonly (readonly [number, number])[] = [
  [0, 0], [-2, -1], [-1, -1], [0, -1], [1, -1], [-3, 0], [-2, 0], [-1, 0],
  [1, 0], [-2, 1], [-1, 1], [0, 1], [1, 1],
];

function similarity(distanceSqr1: number, distanceSqr2: number): number {
  return 1 - (distanceSqr2 - distanceSqr1) / 25;
}

function clampedMap(value: number, fromMin: number, fromMax: number, toMin: number, toMax: number): number {
  const t = (value - fromMin) / (fromMax - fromMin);
  return t < 0 ? toMin : t > 1 ? toMax : toMin + t * (toMax - toMin);
}

/** Stand-in for commons-lang MutableDouble: lets the barrier noise be sampled once per block. */
class MutableDouble {
  value = NaN;
}

/** Port of Aquifer.NoiseBasedAquifer. */
export class NoiseBasedAquifer implements Aquifer {
  private readonly barrierNoise: DensityFunction;
  private readonly fluidLevelFloodednessNoise: DensityFunction;
  private readonly fluidLevelSpreadNoise: DensityFunction;
  private readonly lavaNoise: DensityFunction;
  private readonly erosion: DensityFunction;
  private readonly depth: DensityFunction;

  private readonly aquiferCache: (FluidStatus | null)[];
  private readonly locX: Int32Array;
  private readonly locY: Int32Array;
  private readonly locZ: Int32Array;
  private readonly locSet: Uint8Array;

  private readonly skipSamplingAboveY: number;
  private readonly minGridX: number;
  private readonly minGridY: number;
  private readonly minGridZ: number;
  private readonly gridSizeX: number;
  private readonly gridSizeY: number;
  private readonly gridSizeZ: number;

  private fluidUpdate = false;
  private readonly barrierCache = new MutableDouble();

  constructor(
    private readonly chunk: ChunkAccessForAquifer,
    chunkMinBlockX: number,
    chunkMinBlockZ: number,
    router: AquiferRouter,
    private readonly positionalRandomFactory: PositionalRandomFactory,
    minBlockY: number,
    yBlockSize: number,
    private readonly globalFluidPicker: FluidPicker,
    private readonly lookup: FluidLookup,
  ) {
    this.barrierNoise = router.barrier;
    this.fluidLevelFloodednessNoise = router.fluidLevelFloodedness;
    this.fluidLevelSpreadNoise = router.fluidLevelSpread;
    this.lavaNoise = router.lava;
    this.erosion = router.erosion;
    this.depth = router.depth;

    const maxBlockX = chunkMinBlockX + 15;
    const maxBlockZ = chunkMinBlockZ + 15;

    this.minGridX = gridX(chunkMinBlockX - 5);
    const maxGridX = gridX(maxBlockX - 5) + 1;
    this.gridSizeX = maxGridX - this.minGridX + 1;

    this.minGridY = gridY(minBlockY + 1) - 1;
    const maxGridY = gridY(minBlockY + yBlockSize + 1) + 1;
    this.gridSizeY = maxGridY - this.minGridY + 1;

    this.minGridZ = gridZ(chunkMinBlockZ - 5);
    const maxGridZ = gridZ(maxBlockZ - 5) + 1;
    this.gridSizeZ = maxGridZ - this.minGridZ + 1;

    const total = this.gridSizeX * this.gridSizeY * this.gridSizeZ;
    this.aquiferCache = new Array(total).fill(null);
    this.locX = new Int32Array(total);
    this.locY = new Int32Array(total);
    this.locZ = new Int32Array(total);
    this.locSet = new Uint8Array(total);

    const maxAdjustedSurfaceLevel = this.adjustSurfaceLevel(
      chunk.maxPreliminarySurfaceLevel(
        fromGridX(this.minGridX, 0), fromGridZ(this.minGridZ, 0),
        fromGridX(maxGridX, 9), fromGridZ(maxGridZ, 9),
      ),
    );
    const skipSamplingAboveGridY = gridY(maxAdjustedSurfaceLevel + 12) + 1;
    this.skipSamplingAboveY = fromGridY(skipSamplingAboveGridY, 11) - 1;
  }

  private getIndex(gx: number, gy: number, gz: number): number {
    const x = gx - this.minGridX;
    const y = gy - this.minGridY;
    const z = gz - this.minGridZ;
    return (y * this.gridSizeZ + z) * this.gridSizeX + x;
  }

  get shouldScheduleFluidUpdate(): boolean { return this.fluidUpdate; }

  computeSubstance(ctx: FunctionContext, density: number): number | null {
    const air = this.lookup.air;
    if (density > 0) {
      this.fluidUpdate = false;
      return null;
    }

    const posX = ctx.blockX;
    const posY = ctx.blockY;
    const posZ = ctx.blockZ;
    const globalFluid = this.globalFluidPicker.computeFluid(posX, posY, posZ);
    if (posY > this.skipSamplingAboveY) {
      this.fluidUpdate = false;
      return globalFluid.at(posY, air);
    }
    if (this.lookup.blockIdOf(globalFluid.at(posY, air)) === this.lookup.lavaBlock) {
      this.fluidUpdate = false;
      return this.lookup.lava;
    }

    const xAnchor = gridX(posX - 5);
    const yAnchor = gridY(posY + 1);
    const zAnchor = gridZ(posZ - 5);

    let d1 = Number.MAX_SAFE_INTEGER;
    let d2 = Number.MAX_SAFE_INTEGER;
    let d3 = Number.MAX_SAFE_INTEGER;
    let d4 = Number.MAX_SAFE_INTEGER;
    let i1 = 0, i2 = 0, i3 = 0, i4 = 0;

    for (let x1 = 0; x1 <= 1; x1++) {
      for (let y1 = -1; y1 <= 1; y1++) {
        for (let z1 = 0; z1 <= 1; z1++) {
          const gx = xAnchor + x1;
          const gy = yAnchor + y1;
          const gz = zAnchor + z1;
          const index = this.getIndex(gx, gy, gz);
          if (!this.locSet[index]) {
            const random = this.positionalRandomFactory.at(gx, gy, gz);
            this.locX[index] = fromGridX(gx, random.nextInt(10));
            this.locY[index] = fromGridY(gy, random.nextInt(9));
            this.locZ[index] = fromGridZ(gz, random.nextInt(10));
            this.locSet[index] = 1;
          }
          const dx = this.locX[index] - posX;
          const dy = this.locY[index] - posY;
          const dz = this.locZ[index] - posZ;
          const distance = dx * dx + dy * dy + dz * dz;
          if (d1 >= distance) {
            i4 = i3; i3 = i2; i2 = i1; i1 = index;
            d4 = d3; d3 = d2; d2 = d1; d1 = distance;
          } else if (d2 >= distance) {
            i4 = i3; i3 = i2; i2 = index;
            d4 = d3; d3 = d2; d2 = distance;
          } else if (d3 >= distance) {
            i4 = i3; i3 = index;
            d4 = d3; d3 = distance;
          } else if (d4 >= distance) {
            i4 = index; d4 = distance;
          }
        }
      }
    }

    this.barrierCache.value = NaN;
    const closest1 = this.getAquiferStatus(i1);
    const sim12 = similarity(d1, d2);
    const fluidState = closest1.at(posY, air);
    if (sim12 <= 0) {
      this.fluidUpdate = sim12 >= FLOWING_UPDATE_SIMULARITY
        ? !this.sameFluid(closest1, this.getAquiferStatus(i2))
        : false;
      return fluidState;
    }
    if (this.lookup.blockIdOf(fluidState) === this.lookup.waterBlock
      && this.lookup.blockIdOf(this.globalFluidPicker.computeFluid(posX, posY - 1, posZ).at(posY - 1, air)) === this.lookup.lavaBlock) {
      this.fluidUpdate = true;
      return fluidState;
    }

    const closest2 = this.getAquiferStatus(i2);
    const barrier12 = sim12 * this.calculatePressure(ctx, closest1, closest2);
    if (density + barrier12 > 0) {
      this.fluidUpdate = false;
      return null;
    }

    const closest3 = this.getAquiferStatus(i3);
    const sim13 = similarity(d1, d3);
    if (sim13 > 0) {
      const barrier13 = sim12 * sim13 * this.calculatePressure(ctx, closest1, closest3);
      if (density + barrier13 > 0) {
        this.fluidUpdate = false;
        return null;
      }
    }

    const sim23 = similarity(d2, d3);
    if (sim23 > 0) {
      const barrier23 = sim12 * sim23 * this.calculatePressure(ctx, closest2, closest3);
      if (density + barrier23 > 0) {
        this.fluidUpdate = false;
        return null;
      }
    }

    const mayFlow12 = !this.sameFluid(closest1, closest2);
    const mayFlow23 = sim23 >= FLOWING_UPDATE_SIMULARITY && !this.sameFluid(closest2, closest3);
    const mayFlow13 = sim13 >= FLOWING_UPDATE_SIMULARITY && !this.sameFluid(closest1, closest3);
    if (!mayFlow12 && !mayFlow23 && !mayFlow13) {
      this.fluidUpdate = sim13 >= FLOWING_UPDATE_SIMULARITY
        && similarity(d1, d4) >= FLOWING_UPDATE_SIMULARITY
        && !this.sameFluid(closest1, this.getAquiferStatus(i4));
    } else {
      this.fluidUpdate = true;
    }
    return fluidState;
  }

  private sameFluid(a: FluidStatus, b: FluidStatus): boolean {
    return a.fluidLevel === b.fluidLevel && a.fluidType === b.fluidType;
  }

  private calculatePressure(ctx: FunctionContext, status1: FluidStatus, status2: FluidStatus): number {
    const air = this.lookup.air;
    const posY = ctx.blockY;
    const block1 = this.lookup.blockIdOf(status1.at(posY, air));
    const block2 = this.lookup.blockIdOf(status2.at(posY, air));
    const lava = this.lookup.lavaBlock;
    const water = this.lookup.waterBlock;
    const isLava1 = block1 === lava, isLava2 = block2 === lava;
    const isWater1 = block1 === water, isWater2 = block2 === water;
    if ((!isLava1 || !isWater2) && (!isWater1 || !isLava2)) {
      const fluidYDiff = Math.abs(status1.fluidLevel - status2.fluidLevel);
      if (fluidYDiff === 0) return 0;

      const averageFluidY = 0.5 * (status1.fluidLevel + status2.fluidLevel);
      const howFarAboveAverageFluidPoint = posY + 0.5 - averageFluidY;
      const baseValue = fluidYDiff / 2;
      const distanceFromBarrierEdgeTowardsMiddle = baseValue - Math.abs(howFarAboveAverageFluidPoint);
      let gradient: number;
      if (howFarAboveAverageFluidPoint > 0) {
        gradient = distanceFromBarrierEdgeTowardsMiddle > 0
          ? distanceFromBarrierEdgeTowardsMiddle / 1.5
          : distanceFromBarrierEdgeTowardsMiddle / 2.5;
      } else {
        const centerPoint = 3 + distanceFromBarrierEdgeTowardsMiddle;
        gradient = centerPoint > 0 ? centerPoint / 3 : centerPoint / 10;
      }

      let noiseValue: number;
      if (!(gradient < -2) && !(gradient > 2)) {
        noiseValue = Number.isNaN(this.barrierCache.value)
          ? (this.barrierCache.value = this.barrierNoise.compute(ctx))
          : this.barrierCache.value;
      } else {
        noiseValue = 0;
      }
      return 2 * (noiseValue + gradient);
    }
    return 2;
  }

  private getAquiferStatus(index: number): FluidStatus {
    const old = this.aquiferCache[index];
    if (old) return old;
    const status = this.computeFluid(this.locX[index], this.locY[index], this.locZ[index]);
    this.aquiferCache[index] = status;
    return status;
  }

  private computeFluid(x: number, y: number, z: number): FluidStatus {
    const air = this.lookup.air;
    const globalFluid = this.globalFluidPicker.computeFluid(x, y, z);
    let lowestPreliminarySurface = Number.MAX_SAFE_INTEGER;
    const topOfAquiferCell = y + 12;
    const bottomOfAquiferCell = y - 12;
    let surfaceAtCenterIsUnderGlobalFluidLevel = false;

    for (const offset of SURFACE_SAMPLING_OFFSETS_IN_CHUNKS) {
      const sampleX = x + offset[0] * 16;
      const sampleZ = z + offset[1] * 16;
      const preliminarySurfaceLevel = this.chunk.preliminarySurfaceLevel(sampleX, sampleZ);
      const adjustedSurfaceLevel = this.adjustSurfaceLevel(preliminarySurfaceLevel);
      const isStart = offset[0] === 0 && offset[1] === 0;
      if (isStart && bottomOfAquiferCell > adjustedSurfaceLevel) return globalFluid;

      const topPokesAboveSurface = topOfAquiferCell > adjustedSurfaceLevel;
      if (topPokesAboveSurface || isStart) {
        const globalFluidAtSurface = this.globalFluidPicker.computeFluid(sampleX, adjustedSurfaceLevel, sampleZ);
        if (globalFluidAtSurface.at(adjustedSurfaceLevel, air) !== air) {
          if (isStart) surfaceAtCenterIsUnderGlobalFluidLevel = true;
          if (topPokesAboveSurface) return globalFluidAtSurface;
        }
      }
      lowestPreliminarySurface = Math.min(lowestPreliminarySurface, preliminarySurfaceLevel);
    }

    const fluidSurfaceLevel = this.computeSurfaceLevel(x, y, z, globalFluid, lowestPreliminarySurface, surfaceAtCenterIsUnderGlobalFluidLevel);
    return new FluidStatus(fluidSurfaceLevel, this.computeFluidType(x, y, z, globalFluid, fluidSurfaceLevel));
  }

  private adjustSurfaceLevel(preliminarySurfaceLevel: number): number {
    return preliminarySurfaceLevel + 8;
  }

  private computeSurfaceLevel(
    x: number, y: number, z: number,
    globalFluid: FluidStatus,
    lowestPreliminarySurface: number,
    surfaceAtCenterIsUnderGlobalFluidLevel: boolean,
  ): number {
    const ctx = new SinglePointContext(x, y, z);
    let partiallyFloodedness: number;
    let fullyFloodedness: number;
    if (this.erosion.compute(ctx) < -0.225 && this.depth.compute(ctx) > 0.9) {
      // OverworldBiomeBuilder.isDeepDarkRegion
      partiallyFloodedness = -1;
      fullyFloodedness = -1;
    } else {
      const distanceBelowSurface = lowestPreliminarySurface + 8 - y;
      const floodednessFactor = surfaceAtCenterIsUnderGlobalFluidLevel ? clampedMap(distanceBelowSurface, 0, 64, 1, 0) : 0;
      const floodednessNoiseValue = Math.max(-1, Math.min(1, this.fluidLevelFloodednessNoise.compute(ctx)));
      const fullyFloodedThreshold = clampedMap(floodednessFactor, 1, 0, -0.3, 0.8);
      const partiallyFloodedThreshold = clampedMap(floodednessFactor, 1, 0, -0.8, 0.4);
      partiallyFloodedness = floodednessNoiseValue - partiallyFloodedThreshold;
      fullyFloodedness = floodednessNoiseValue - fullyFloodedThreshold;
    }

    if (fullyFloodedness > 0) return globalFluid.fluidLevel;
    if (partiallyFloodedness > 0) return this.computeRandomizedFluidSurfaceLevel(x, y, z, lowestPreliminarySurface);
    return WAY_BELOW_MIN_Y;
  }

  private computeRandomizedFluidSurfaceLevel(x: number, y: number, z: number, lowestPreliminarySurface: number): number {
    const fluidLevelCellX = Math.floor(x / 16);
    const fluidLevelCellY = Math.floor(y / 40);
    const fluidLevelCellZ = Math.floor(z / 16);
    const fluidCellMiddleY = fluidLevelCellY * 40 + 20;
    const spread = this.fluidLevelSpreadNoise.compute(new SinglePointContext(fluidLevelCellX, fluidLevelCellY, fluidLevelCellZ)) * 10;
    const quantized = Math.floor(spread / 3) * 3;
    return Math.min(lowestPreliminarySurface, fluidCellMiddleY + quantized);
  }

  private computeFluidType(x: number, y: number, z: number, globalFluid: FluidStatus, fluidSurfaceLevel: number): number {
    let fluidType = globalFluid.fluidType;
    if (fluidSurfaceLevel <= -10 && fluidSurfaceLevel !== WAY_BELOW_MIN_Y
      && this.lookup.blockIdOf(fluidType) !== this.lookup.lavaBlock) {
      const lavaNoiseValue = this.lavaNoise.compute(new SinglePointContext(Math.floor(x / 64), Math.floor(y / 40), Math.floor(z / 64)));
      if (Math.abs(lavaNoiseValue) > 0.3) fluidType = this.lookup.lava;
    }
    return fluidType;
  }
}

function gridX(blockCoord: number): number { return blockCoord >> 4; }
function fromGridX(gridCoord: number, blockOffset: number): number { return (gridCoord << 4) + blockOffset; }
function gridY(blockCoord: number): number { return Math.floor(blockCoord / Y_SPACING); }
function fromGridY(gridCoord: number, blockOffset: number): number { return gridCoord * Y_SPACING + blockOffset; }
function gridZ(blockCoord: number): number { return blockCoord >> 4; }
function fromGridZ(gridCoord: number, blockOffset: number): number { return (gridCoord << 4) + blockOffset; }
