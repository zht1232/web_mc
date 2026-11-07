// Port of net.minecraft.client.multiplayer.ClientLevel#animateTick / #doAnimateTick plus the block
// animateTick callbacks that spawn the always-on ambient particles (torch flame + smoke, lava pops,
// fire smoke, campfire sparks).
//
// Vanilla does not iterate over the blocks that emit particles. Every client tick it samples 667
// random positions within 16 blocks and 667 within 32 blocks of the player and asks the block at each
// sample to animate itself - so a torch emits particles on average a few times a second, and only
// when it is near the player. This reproduces that sampling exactly (same counts and radii).

import type { MinecraftData } from '../../vanilla/world/level/block/state/BlockState.js';
import type { ClientLevel } from '../../vanilla/world/level/ClientLevel.js';
import { ParticleEngine } from './ParticleEngine.js';
import { ParticleType } from './Particle.js';

const enum Kind { UNKNOWN = 0, NONE, TORCH, WALL_TORCH, SOUL_TORCH, SOUL_WALL_TORCH, FIRE, CAMPFIRE, LAVA }

/** SOUL_FIRE_FLAME has no sprite of its own in our atlas, so the flame is tinted instead. */
const SOUL_FLAME: [number, number, number] = [0.35, 0.8, 1.0];

const STEP: Record<string, [number, number]> = {
  north: [0, -1], south: [0, 1], west: [-1, 0], east: [1, 0],
};

export class AmbientParticles {
  private readonly kinds: Uint8Array;
  /** xorshift32 for the 8000 position samples per tick: the engine RNG is BigInt based and ~13% of the frame. */
  private seed = 0x2545f491;

  constructor(private readonly mc: MinecraftData) {
    this.kinds = new Uint8Array(mc.stateCount);
  }

  private kindOf(state: number): Kind {
    let k = this.kinds[state];
    if (k !== Kind.UNKNOWN) return k;
    const name = this.mc.blockOf(state).name;
    switch (name) {
      case 'torch': k = Kind.TORCH; break;
      case 'wall_torch': k = Kind.WALL_TORCH; break;
      case 'soul_torch': k = Kind.SOUL_TORCH; break;
      case 'soul_wall_torch': k = Kind.SOUL_WALL_TORCH; break;
      case 'fire': case 'soul_fire': k = Kind.FIRE; break;
      case 'campfire': case 'soul_campfire': k = Kind.CAMPFIRE; break;
      case 'lava': k = Kind.LAVA; break;
      default: k = Kind.NONE;
    }
    this.kinds[state] = k;
    return k;
  }

  /** ClientLevel.animateTick(xt, yt, zt): 667 samples at radius 16 and 667 at radius 32. */
  tick(level: ClientLevel, px: number, py: number, pz: number): void {
    const engine = ParticleEngine.get();
    const xt = Math.floor(px), yt = Math.floor(py), zt = Math.floor(pz);
    for (let i = 0; i < 667; i++) {
      this.sample(level, engine, xt, yt, zt, 16);
      this.sample(level, engine, xt, yt, zt, 32);
    }
  }

  private nextInt(bound: number): number {
    let x = this.seed;
    x ^= x << 13; x ^= x >>> 17; x ^= x << 5;
    this.seed = x >>> 0;
    return (this.seed >>> 8) % bound;
  }

  private sample(level: ClientLevel, engine: ParticleEngine, xt: number, yt: number, zt: number, r: number): void {
    const x = xt + this.nextInt(r) - this.nextInt(r);
    const y = yt + this.nextInt(r) - this.nextInt(r);
    const z = zt + this.nextInt(r) - this.nextInt(r);
    if (y < level.minY || y >= level.minY + level.height) return;
    if (!level.hasChunk(x >> 4, z >> 4)) return;
    const state = level.getBlockState(x, y, z);
    if (!state) return;
    const kind = this.kindOf(state);
    if (kind === Kind.NONE) return;

    switch (kind) {
      case Kind.TORCH:
      case Kind.SOUL_TORCH:
        this.torch(engine, x + 0.5, y + 0.7, z + 0.5, kind === Kind.SOUL_TORCH);
        break;
      case Kind.WALL_TORCH:
      case Kind.SOUL_WALL_TORCH: {
        // WallTorchBlock.animateTick: pushed 0.27 away from the wall, 0.22 lower
        const facing = this.mc.getProp(state, 'facing') ?? 'north';
        const [sx, sz] = STEP[facing] ?? [0, -1]; // the torch faces away from the wall: opposite = wall side
        this.torch(engine, x + 0.5 - 0.27 * sx, y + 0.7 + 0.22, z + 0.5 - 0.27 * sz, kind === Kind.SOUL_WALL_TORCH);
        break;
      }
      case Kind.LAVA: {
        // LavaFluid.animateTick: 1 in 100 pops a lava particle off the surface when the cell above is open air
        if (engine.random.nextInt(100) !== 0) break;
        const above = level.getBlockState(x, y + 1, z);
        if (!this.mc.isAir(above)) break;
        const e = engine.random;
        engine.add({ type: ParticleType.LAVA, x: x + e.nextDouble(), y: y + 1, z: z + e.nextDouble(), vx: 0, vy: 0, vz: 0 });
        break;
      }
      case Kind.FIRE: {
        // BaseFireBlock.animateTick (burning-block branch): three columns of large smoke
        const e = engine.random;
        if (this.mc.getProp(state, 'lit') === 'false') break;
        for (let i = 0; i < 3; i++) {
          engine.add({
            type: ParticleType.LARGE_SMOKE,
            x: x + e.nextDouble(), y: y + e.nextDouble() * 0.5 + 0.5, z: z + e.nextDouble(),
            vx: 0, vy: 0, vz: 0,
          });
        }
        break;
      }
      case Kind.CAMPFIRE: {
        // CampfireBlock.animateTick (lit): occasional sparks + a rising column of smoke
        if (this.mc.getProp(state, 'lit') === 'false') break;
        const e = engine.random;
        if (e.nextInt(5) === 0) {
          engine.add({
            type: ParticleType.LAVA, x: x + 0.5, y: y + 0.5, z: z + 0.5,
            vx: e.nextFloat() / 2, vy: 5e-5, vz: e.nextFloat() / 2,
          });
        }
        if (e.nextInt(6) === 0) {
          engine.add({
            type: ParticleType.LARGE_SMOKE,
            x: x + 0.5 + e.nextDouble() / 3 * (e.nextBoolean() ? 1 : -1), y: y + e.nextDouble() + e.nextDouble(),
            z: z + 0.5 + e.nextDouble() / 3 * (e.nextBoolean() ? 1 : -1),
            vx: 0, vy: 0.07, vz: 0,
          });
        }
        break;
      }
    }
  }

  /** TorchBlock.animateTick: one smoke and one flame particle, both with zero velocity. */
  private torch(engine: ParticleEngine, x: number, y: number, z: number, soul: boolean): void {
    const e = engine.random;
    // Particle constructors add a little jitter of their own (SmokeParticle / FlameParticle).
    engine.add({
      type: ParticleType.SMOKE,
      x: x + (e.nextFloat() * 2 - 1) * 0.02, y, z: z + (e.nextFloat() * 2 - 1) * 0.02,
      vx: (e.nextFloat() * 2 - 1) * 0.002, vy: 0.004, vz: (e.nextFloat() * 2 - 1) * 0.002,
    });
    engine.add({
      type: ParticleType.FLAME,
      x: x + (e.nextFloat() * 2 - 1) * 0.02, y, z: z + (e.nextFloat() * 2 - 1) * 0.02,
      vx: 0, vy: 0, vz: 0,
      ...(soul ? { color: SOUL_FLAME } : {}),
    });
  }
}
