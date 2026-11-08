// Port of net.minecraft.client.particle.ParticleEngine + Particle, rebuilt as a
// fixed-capacity Structure-of-Arrays pool of 10000 slots.
//
// Vanilla physics (Particle.tick): yd -= 0.04 * gravity; move(xd,yd,zd);
// xd/yd/zd *= friction; onGround => xd/zd *= 0.7; age >= lifetime => remove.
// We keep the same integration in typed arrays so 10000 particles tick in a
// tight loop with zero allocation.

export enum ParticleType {
  BLOCK = 0,
  SMOKE,
  LARGE_SMOKE,
  FLAME,
  LAVA,
  SPLASH,
  BUBBLE,
  RAIN_SPLASH,
  HEART,
  CRIT,
  ENCHANT,
  PORTAL,
  EXPLOSION,
  FALLING_DUST,
  ITEM_PICKUP,
  NOTE,
  COMPOSTER,
  SNOWFLAKE,
  DRIP,
}

export const PARTICLE_TYPE_COUNT = 19;

export interface ParticleTypeInfo {
  name: string;
  /** key into particles.json (the vanilla particle definition event) */
  spriteKey: string;
  gravity: number;
  friction: number;
  lifetime: number;   // ticks
  size: number;       // world units (0.2 * scale)
  speed: number;      // spawn velocity magnitude
  color: [number, number, number];
  alpha: number;
  animated: boolean;  // advance sprite frames with age
  blockAtlas: boolean;// sample the block texture array instead of the atlas
  glow: boolean;      // render at full brightness (flame, portal, crit...)
}

/**
 * Parameters ported from the individual *Particle.java classes. spriteKey is
 * resolved against the generated atlas at runtime (see ParticleSprites.ts).
 */
export const PARTICLE_TYPES: readonly ParticleTypeInfo[] = [
  { name: 'block',         spriteKey: 'block',           gravity: 1.0,  friction: 0.98, lifetime: 40, size: 0.15, speed: 0.15, color: [1, 1, 1],       alpha: 1,    animated: false, blockAtlas: true,  glow: false }, // TerrainParticle
  { name: 'smoke',         spriteKey: 'smoke',           gravity: -0.05,friction: 0.98, lifetime: 30, size: 0.12, speed: 0.05, color: [0.45, 0.45, 0.45],alpha: 0.8, animated: true,  blockAtlas: false, glow: false }, // SmokeParticle
  { name: 'large_smoke',   spriteKey: 'large_smoke',     gravity: -0.03,friction: 0.98, lifetime: 60, size: 0.30, speed: 0.04, color: [0.35, 0.35, 0.35],alpha: 0.7, animated: true,  blockAtlas: false, glow: false }, // LargeSmokeParticle
  { name: 'flame',         spriteKey: 'flame',           gravity: -0.02,friction: 0.96, lifetime: 20, size: 0.10, speed: 0.05, color: [1, 0.9, 0.5],   alpha: 1,    animated: true,  blockAtlas: false, glow: true  }, // FlameParticle
  { name: 'lava',          spriteKey: 'lava',            gravity: 0.8,  friction: 0.98, lifetime: 20, size: 0.10, speed: 0.10, color: [1, 0.5, 0.15],  alpha: 1,    animated: false, blockAtlas: false, glow: true  }, // LavaParticle
  { name: 'splash',        spriteKey: 'splash',          gravity: 0.5,  friction: 0.98, lifetime: 12, size: 0.10, speed: 0.12, color: [0.6, 0.8, 1],   alpha: 0.9, animated: true,  blockAtlas: false, glow: false }, // WaterSplashParticle
  { name: 'bubble',        spriteKey: 'bubble',          gravity: -0.02,friction: 0.98, lifetime: 22, size: 0.08, speed: 0.04, color: [1, 1, 1],       alpha: 0.8, animated: true,  blockAtlas: false, glow: false }, // BubbleParticle
  { name: 'rain_splash',   spriteKey: 'splash',          gravity: 0.6,  friction: 0.98, lifetime: 6,  size: 0.06, speed: 0.08, color: [0.7, 0.8, 1],   alpha: 0.8, animated: false, blockAtlas: false, glow: false }, // WaterDropParticle
  { name: 'heart',         spriteKey: 'heart',           gravity: 0,    friction: 0.90, lifetime: 25, size: 0.15, speed: 0.02, color: [1, 0.3, 0.4],   alpha: 1,    animated: false, blockAtlas: false, glow: true  }, // HeartParticle
  { name: 'crit',          spriteKey: 'crit',            gravity: 0,    friction: 0.90, lifetime: 8,  size: 0.15, speed: 0.10, color: [1, 1, 0.6],     alpha: 1,    animated: false, blockAtlas: false, glow: true  }, // CritParticle
  { name: 'enchant',       spriteKey: 'enchant',         gravity: -0.02,friction: 0.96, lifetime: 30, size: 0.10, speed: 0.06, color: [0.6, 0.3, 1],   alpha: 1,    animated: true,  blockAtlas: false, glow: true  }, // EnchantmentTableParticle
  { name: 'portal',        spriteKey: 'portal',          gravity: 0,    friction: 0.90, lifetime: 40, size: 0.10, speed: 0.08, color: [0.6, 0.3, 1],   alpha: 0.9, animated: true,  blockAtlas: false, glow: true  }, // PortalParticle
  { name: 'explosion',     spriteKey: 'explosion',       gravity: 0.8,  friction: 0.96, lifetime: 20, size: 0.50, speed: 0.25, color: [1, 1, 1],       alpha: 1,    animated: true,  blockAtlas: false, glow: true  }, // HugeExplosionParticle
  { name: 'falling_dust',  spriteKey: 'falling_dust',    gravity: 1.0,  friction: 0.98, lifetime: 40, size: 0.10, speed: 0.02, color: [0.7, 0.65, 0.6],alpha: 1,    animated: true,  blockAtlas: false, glow: false }, // FallingDustParticle
  { name: 'item_pickup',   spriteKey: 'effect',          gravity: 0.3,  friction: 0.94, lifetime: 14, size: 0.10, speed: 0.06, color: [1, 1, 0.9],     alpha: 1,    animated: true,  blockAtlas: false, glow: true  }, // ItemPickupParticle (sprite fallback)
  { name: 'note',          spriteKey: 'note',            gravity: 0,    friction: 0.90, lifetime: 20, size: 0.20, speed: 0.02, color: [0.4, 1, 0.4],   alpha: 1,    animated: false, blockAtlas: false, glow: true  }, // NoteParticle
  { name: 'composter',     spriteKey: 'composter',       gravity: 0.5,  friction: 0.98, lifetime: 20, size: 0.10, speed: 0.10, color: [0.5, 0.9, 0.3], alpha: 1,    animated: false, blockAtlas: false, glow: true  }, // SuspendedTownParticle
  { name: 'snowflake',     spriteKey: 'snowflake',       gravity: 0.10, friction: 0.98, lifetime: 40, size: 0.08, speed: 0.02, color: [1, 1, 1],       alpha: 0.9, animated: false, blockAtlas: false, glow: true  }, // SnowflakeParticle
  { name: 'drip',          spriteKey: 'dripping_water',  gravity: 1.0,  friction: 0.98, lifetime: 30, size: 0.10, speed: 0.01, color: [0.5, 0.7, 1],   alpha: 1,    animated: false, blockAtlas: false, glow: false }, // DripParticle
];

export const DEFAULT_POOL_CAPACITY = 10000;

export interface ParticleSpec {
  type: ParticleType;
  x: number; y: number; z: number;
  vx: number; vy: number; vz: number;
  size?: number;
  lifetime?: number;
  color?: [number, number, number];
  alpha?: number;
  gravity?: number;
  friction?: number;
  /** block texture array layer for BLOCK particles, -1 otherwise */
  blockLayer?: number;
  spriteFrame?: number;
  frameCount?: number;
  /** Pre-computed packed light level (0..15); when set, no world sampling is done. */
  lightOverride?: number;
}

/**
 * Fixed capacity SoA pool. add() never allocates beyond `capacity`; when full
 * it returns -1 (vanilla drops the particle). tick() is allocation free.
 */
export class ParticlePool {
  readonly capacity: number;
  readonly x: Float32Array; readonly y: Float32Array; readonly z: Float32Array;
  readonly vx: Float32Array; readonly vy: Float32Array; readonly vz: Float32Array;
  readonly px: Float32Array; readonly py: Float32Array; readonly pz: Float32Array;
  readonly age: Float32Array; readonly lifetime: Float32Array;
  readonly size: Float32Array; readonly gravity: Float32Array; readonly friction: Float32Array;
  readonly r: Float32Array; readonly g: Float32Array; readonly b: Float32Array; readonly alpha: Float32Array;
  readonly type: Uint8Array; readonly frame: Uint8Array; readonly frameCount: Uint8Array;
  readonly blockLayer: Int16Array;
  readonly alive: Uint8Array;

  private readonly free: Int32Array;
  private freeTop: number;
  private highWater = 0;
  count = 0;

  constructor(capacity = DEFAULT_POOL_CAPACITY) {
    this.capacity = capacity;
    const f32 = () => new Float32Array(capacity);
    this.x = f32(); this.y = f32(); this.z = f32();
    this.vx = f32(); this.vy = f32(); this.vz = f32();
    this.px = f32(); this.py = f32(); this.pz = f32();
    this.age = f32(); this.lifetime = f32();
    this.size = f32(); this.gravity = f32(); this.friction = f32();
    this.r = f32(); this.g = f32(); this.b = f32(); this.alpha = f32();
    this.type = new Uint8Array(capacity);
    this.frame = new Uint8Array(capacity);
    this.frameCount = new Uint8Array(capacity);
    this.blockLayer = new Int16Array(capacity);
    this.alive = new Uint8Array(capacity);
    this.free = new Int32Array(capacity);
    for (let i = 0; i < capacity; i++) this.free[i] = i;
    this.freeTop = capacity;
  }

  /** Returns the slot index, or -1 when the pool is full. */
  add(spec: ParticleSpec): number {
    if (this.freeTop === 0) return -1;
    const i = this.free[--this.freeTop];
    if (i + 1 > this.highWater) this.highWater = i + 1;
    const info = PARTICLE_TYPES[spec.type] ?? PARTICLE_TYPES[0];
    this.type[i] = spec.type;
    this.x[i] = this.px[i] = spec.x;
    this.y[i] = this.py[i] = spec.y;
    this.z[i] = this.pz[i] = spec.z;
    this.vx[i] = spec.vx; this.vy[i] = spec.vy; this.vz[i] = spec.vz;
    this.age[i] = 0;
    this.lifetime[i] = spec.lifetime ?? info.lifetime;
    this.size[i] = spec.size ?? info.size;
    this.gravity[i] = spec.gravity ?? info.gravity;
    this.friction[i] = spec.friction ?? info.friction;
    const c = spec.color ?? info.color;
    this.r[i] = c[0]; this.g[i] = c[1]; this.b[i] = c[2];
    this.alpha[i] = spec.alpha ?? info.alpha;
    this.frame[i] = spec.spriteFrame ?? 0;
    this.frameCount[i] = spec.frameCount ?? (info.animated ? 8 : 1);
    this.blockLayer[i] = spec.blockLayer ?? -1;
    this.alive[i] = 1;
    this.count++;
    return i;
  }

  /** Highest slot index ever used + 1; renderers iterate [0, slotCount). */
  get slotCount(): number { return this.highWater; }

  /** Vanilla Particle.tick integration, allocation free. */
  tick(): void {
    for (let i = 0; i < this.highWater; i++) {
      if (!this.alive[i]) continue;
      const age = this.age[i] + 1;
      if (age >= this.lifetime[i]) {
        this.alive[i] = 0;
        this.free[this.freeTop++] = i;
        this.count--;
        continue;
      }
      this.age[i] = age;
      this.px[i] = this.x[i]; this.py[i] = this.y[i]; this.pz[i] = this.z[i];
      let vy = this.vy[i] - 0.04 * this.gravity[i];
      this.x[i] += this.vx[i];
      this.y[i] += vy;
      this.z[i] += this.vz[i];
      const fr = this.friction[i];
      this.vx[i] *= fr;
      this.vz[i] *= fr;
      this.vy[i] = vy * fr;
      const fc = this.frameCount[i];
      if (fc > 1) {
        const f = Math.min(fc - 1, Math.floor((age / this.lifetime[i]) * fc));
        this.frame[i] = f;
      }
    }
  }

  clear(): void {
    this.alive.fill(0);
    for (let i = 0; i < this.capacity; i++) this.free[i] = i;
    this.freeTop = this.capacity;
    this.highWater = 0;
    this.count = 0;
  }

  /** Stable checksum of the live particle state, used by the determinism test. */
  fingerprint(): number {
    let h = 2166136261 >>> 0;
    for (let i = 0; i < this.highWater; i++) {
      if (!this.alive[i]) continue;
      const mix = (v: number) => {
        h ^= Math.round(v * 1000) | 0;
        h = Math.imul(h, 16777619) >>> 0;
      };
      mix(this.x[i]); mix(this.y[i]); mix(this.z[i]);
      mix(this.vx[i]); mix(this.vy[i]); mix(this.vz[i]); mix(this.age[i]);
    }
    return h >>> 0;
  }

  /** True when every live particle has finite position/velocity. */
  isFinite(): boolean {
    for (let i = 0; i < this.highWater; i++) {
      if (!this.alive[i]) continue;
      if (!Number.isFinite(this.x[i]) || !Number.isFinite(this.y[i]) || !Number.isFinite(this.z[i])
        || !Number.isFinite(this.vx[i]) || !Number.isFinite(this.vy[i]) || !Number.isFinite(this.vz[i])
        || !Number.isFinite(this.age[i])) return false;
    }
    return true;
  }
}
