/**
 * Serverless single-player mob vertical slice.
 *
 * API:
 *   const mobs = new MobManager(world, rocks);
 *   mobs.onPlayerDamage = (amount, source) => { ... };
 *   mobs.tick(dt, player.pos, dayFactor);          // dayFactor 0 = night, 1 = noon
 *   mobs.spawnPassive(player.pos, 4);              // optional initial seeding
 *   mobs.spawnHostile(player.pos, 2, true);        // force=true ignores daylight
 *   mobs.playerAttackRaycast(eye, dir, 4, 4.5);    // or playerAttackFromHit(hit, eye)
 *   mobs.damage(mob, amount, knockbackDir);
 *
 * Mobs use the world as the only source of truth: no server, no networking.
 * Textures are optional at render time; MobRenderer falls back to flat colors.
 */
import type { World } from './world.js';
import type { BlockRegistry } from './blocks.js';

export interface Vec3 { x: number; y: number; z: number }
export interface HitLike { x: number; y: number; z: number; nx?: number; ny?: number; nz?: number }

export type MobType = 'pig' | 'cow' | 'zombie' | 'skeleton';
export type MobState = 'idle' | 'wander' | 'chase' | 'flee' | 'attack';

export interface Mob {
  id: number;
  type: MobType;
  passive: boolean;
  pos: Vec3;
  vel: Vec3;
  yaw: number;
  health: number;
  maxHealth: number;
  hurtTime: number;
  state: MobState;
  attackCooldown: number;
  shootCooldown: number;
  stepCooldown: number;
  fleeTimer: number;
  onGround: boolean;
  width: number;
  height: number;
  speed: number;
  walkPhase: number;
  wanderTimer: number;
  wanderYaw: number;
  dead: boolean;
}

export interface Arrow {
  pos: Vec3;
  vel: Vec3;
  life: number;
  damage: number;
}

interface Def {
  health: number; width: number; height: number; speed: number;
  passive: boolean; damage: number; attackRange: number;
}

const DEFS: Record<MobType, Def> = {
  pig: { health: 10, width: 0.9, height: 1.0, speed: 1.35, passive: true, damage: 0, attackRange: 0 },
  cow: { health: 10, width: 0.9, height: 1.4, speed: 1.1, passive: true, damage: 0, attackRange: 0 },
  zombie: { health: 20, width: 0.6, height: 1.95, speed: 2.2, passive: false, damage: 2.5, attackRange: 1.8 },
  skeleton: { health: 20, width: 0.6, height: 1.95, speed: 2.0, passive: false, damage: 1.5, attackRange: 1.8 },
};

const TAU = Math.PI * 2;
const clamp = (v: number, a: number, b: number) => v < a ? a : v > b ? b : v;
function angleDiff(target: number, current: number): number {
  let d = (target - current) % TAU;
  if (d > Math.PI) d -= TAU;
  if (d < -Math.PI) d += TAU;
  return d;
}

export class MobManager {
  mobs: Mob[] = [];
  arrows: Arrow[] = [];
  onPlayerDamage: ((amount: number, source: string) => void) | null = null;
  onMobDeath: ((mob: Mob, source: string) => void) | null = null;
  readonly maxPassive = 10;
  readonly maxHostile = 8;
  readonly spawnRadius = 48;
  readonly despawnRadius = 64;

  private nextId = 1;
  private spawnTimer = 1.5;
  private light = 1;
  private playerPos: Vec3 = { x: 0, y: 64, z: 0 };

  constructor(private world: World, private rocks: BlockRegistry) {}

  /** dt seconds; light/dayFactor is 0 at night and 1 at noon. */
  tick(dt: number, playerPos: Vec3, light = 1): void {
    dt = clamp(dt, 0, 0.1);
    this.playerPos = playerPos;
    this.light = clamp(light, 0, 1);
    this.spawnTimer -= dt;
    if (this.spawnTimer <= 0) {
      this.spawnTimer = 1.8 + Math.random() * 2.2;
      if (this.countWithin(playerPos, this.spawnRadius, true) < this.maxPassive) {
        this.spawnPassive(playerPos, 1);
      }
      if (this.light < 0.5 && this.countWithin(playerPos, this.spawnRadius, false) < this.maxHostile) {
        this.spawnHostile(playerPos, 1);
      }
    }

    for (let i = this.mobs.length - 1; i >= 0; i--) {
      const mob = this.mobs[i];
      if (mob.dead || Math.hypot(mob.pos.x - playerPos.x, mob.pos.z - playerPos.z) > this.despawnRadius || mob.pos.y < -80) {
        this.mobs.splice(i, 1);
        continue;
      }
      this.updateMob(mob, dt, playerPos);
    }
    this.updateArrows(dt, playerPos);
  }

  spawnPassive(near: Vec3, count = 1): Mob[] {
    return this.spawnGroup(near, count, true, false);
  }

  /** Night/dark spawn. force=true bypasses the daylight check (useful for tests). */
  spawnHostile(near: Vec3, count = 1, force = false): Mob[] {
    if (!force && this.light > 0.55) return [];
    return this.spawnGroup(near, count, false, !force);
  }

  private spawnGroup(near: Vec3, count: number, passive: boolean, needDark: boolean): Mob[] {
    const cap = passive ? this.maxPassive : this.maxHostile;
    const room = cap - this.countWithin(near, this.spawnRadius, passive);
    const out: Mob[] = [];
    for (let i = 0; i < Math.min(count, room); i++) {
      const spot = this.findSpawnSpot(near, passive ? 10 : 20, 44, needDark);
      if (!spot) break;
      const type: MobType = passive
        ? (Math.random() < 0.52 ? 'pig' : 'cow')
        : (Math.random() < 0.62 ? 'zombie' : 'skeleton');
      const mob = this.createMob(type, spot.x, spot.y, spot.z);
      this.mobs.push(mob);
      out.push(mob);
    }
    return out;
  }

  private createMob(type: MobType, x: number, y: number, z: number): Mob {
    const d = DEFS[type];
    return {
      id: this.nextId++, type, passive: d.passive,
      pos: { x, y, z }, vel: { x: 0, y: 0, z: 0 },
      yaw: Math.random() * TAU,
      health: d.health, maxHealth: d.health, hurtTime: 0,
      state: 'idle', attackCooldown: 0, shootCooldown: 1 + Math.random() * 2,
      stepCooldown: 0, fleeTimer: 0, onGround: false,
      width: d.width, height: d.height, speed: d.speed,
      walkPhase: Math.random() * TAU, wanderTimer: 0, wanderYaw: Math.random() * TAU,
      dead: false,
    };
  }

  private countWithin(center: Vec3, radius: number, passive: boolean): number {
    let n = 0;
    for (const m of this.mobs) {
      if (m.dead || m.passive !== passive) continue;
      if (Math.hypot(m.pos.x - center.x, m.pos.z - center.z) <= radius) n++;
    }
    return n;
  }

  private findSpawnSpot(near: Vec3, minR: number, maxR: number, needDark: boolean): Vec3 | null {
    for (let i = 0; i < 12; i++) {
      const ang = Math.random() * TAU;
      const r = minR + Math.random() * (maxR - minR);
      const x = Math.floor(near.x + Math.cos(ang) * r);
      const z = Math.floor(near.z + Math.sin(ang) * r);
      const y = this.findSurface(x, z, Math.floor(near.y));
      if (y === null) continue;
      if (Math.hypot(x + 0.5 - near.x, z + 0.5 - near.z) < minR) continue;
      if (needDark) {
        const sky = this.world.getSky(x, y, z) * this.light;
        const block = this.world.getBlockLight(x, y, z);
        if (sky > 7 && block <= 7) continue;
      }
      return { x: x + 0.5, y, z: z + 0.5 };
    }
    return null;
  }

  private findSurface(x: number, z: number, hintY: number): number | null {
    const top = Math.min(316, hintY + 24);
    const bottom = Math.max(-60, hintY - 32);
    for (let y = top; y >= bottom; y--) {
      const id = this.world.getBlock(x, y, z);
      if (!id || !this.rocks.solid[id] || this.rocks.liquid[id]) continue;
      const a1 = this.world.getBlock(x, y + 1, z);
      const a2 = this.world.getBlock(x, y + 2, z);
      if ((a1 && (this.rocks.solid[a1] || this.rocks.liquid[a1])) ||
          (a2 && (this.rocks.solid[a2] || this.rocks.liquid[a2]))) continue;
      return y + 1;
    }
    return null;
  }

  private updateMob(mob: Mob, dt: number, player: Vec3): void {
    mob.hurtTime = Math.max(0, mob.hurtTime - dt);
    mob.attackCooldown = Math.max(0, mob.attackCooldown - dt);
    mob.shootCooldown = Math.max(0, mob.shootCooldown - dt);
    mob.stepCooldown = Math.max(0, mob.stepCooldown - dt);
    mob.fleeTimer = Math.max(0, mob.fleeTimer - dt);

    const dx = player.x - mob.pos.x;
    const dz = player.z - mob.pos.z;
    const dist = Math.hypot(dx, dz);
    const def = DEFS[mob.type];
    let mx = 0, mz = 0, speed = 0;

    if (mob.passive) {
      if (mob.fleeTimer > 0 && dist < 20) {
        mob.state = 'flee';
        mx = -dx; mz = -dz; speed = mob.speed * 1.7;
      } else {
        this.updateWander(mob, dt);
        if (mob.state === 'wander') {
          mx = Math.sin(mob.wanderYaw); mz = Math.cos(mob.wanderYaw);
          speed = mob.speed * 0.5;
        }
      }
    } else if (dist < 16) {
      mob.state = 'chase';
      if (mob.type === 'skeleton') {
        if (dist > 9) { mx = dx; mz = dz; speed = mob.speed; }
        else if (dist < 4) { mx = -dx; mz = -dz; speed = mob.speed * 0.9; }
        else this.turnToward(mob, dx, dz, dt);

        if (dist < 14 && dist > 2.6 && mob.shootCooldown <= 0 &&
            this.canSee(mob.pos.x, mob.pos.y + mob.height * 0.8, mob.pos.z, player.x, player.y + 1.1, player.z)) {
          this.shootArrow(mob, player);
          mob.shootCooldown = 2.0 + Math.random() * 0.9;
        }
      } else if (dist > 1.05) {
        mx = dx; mz = dz; speed = mob.speed;
      }

      if (dist < def.attackRange && mob.attackCooldown <= 0) {
        mob.state = 'attack';
        mob.attackCooldown = mob.type === 'zombie' ? 1.1 : 1.4;
        this.onPlayerDamage?.(def.damage, mob.type);
        if (dist > 0.01) {
          mob.vel.x += (dx / dist) * 3.2;
          mob.vel.z += (dz / dist) * 3.2;
        }
      }
    } else {
      this.updateWander(mob, dt);
      if (mob.state === 'wander') {
        mx = Math.sin(mob.wanderYaw); mz = Math.cos(mob.wanderYaw);
        speed = mob.speed * 0.35;
      }
    }

    if (speed > 0 && (mx !== 0 || mz !== 0)) {
      const len = Math.hypot(mx, mz) || 1;
      mx /= len; mz /= len;
      const targetYaw = Math.atan2(mx, mz);
      const diff = angleDiff(targetYaw, mob.yaw);
      mob.yaw += clamp(diff, -7 * dt, 7 * dt);
      const facing = 0.35 + 0.65 * Math.cos(diff);
      const accel = mob.onGround ? 12 : 5;
      mob.vel.x += (mx * speed * facing - mob.vel.x) * Math.min(1, accel * dt);
      mob.vel.z += (mz * speed * facing - mob.vel.z) * Math.min(1, accel * dt);
    } else {
      const damp = Math.min(1, 10 * dt);
      mob.vel.x -= mob.vel.x * damp;
      mob.vel.z -= mob.vel.z * damp;
    }

    // Never walk into water or lava (look a little ahead of the feet).
    const hSpeed = Math.hypot(mob.vel.x, mob.vel.z);
    if (hSpeed > 0.05) {
      const ax = mob.pos.x + (mob.vel.x / hSpeed) * 0.45;
      const az = mob.pos.z + (mob.vel.z / hSpeed) * 0.45;
      if (this.liquidAt(ax, mob.pos.y + 0.25, az) || this.liquidAt(ax, mob.pos.y + 0.9, az)) {
        mob.vel.x = 0; mob.vel.z = 0;
        mob.wanderYaw += Math.PI;
      }
    }

    this.stepMob(mob, dt);
    const moved = Math.hypot(mob.vel.x, mob.vel.z);
    if (moved > 0.05) mob.walkPhase += moved * dt * 4.5;
  }

  private updateWander(mob: Mob, dt: number): void {
    mob.wanderTimer -= dt;
    if (mob.wanderTimer > 0) return;
    mob.wanderTimer = 1.5 + Math.random() * 4;
    mob.wanderYaw += (Math.random() - 0.5) * 2.6;
    mob.state = Math.random() < 0.28 ? 'idle' : 'wander';
  }

  private turnToward(mob: Mob, dx: number, dz: number, dt: number): void {
    const len = Math.hypot(dx, dz);
    if (len < 0.0001) return;
    const target = Math.atan2(dx / len, dz / len);
    mob.yaw += clamp(angleDiff(target, mob.yaw), -6 * dt, 6 * dt);
  }

  private stepMob(mob: Mob, dt: number): void {
    const oldY = mob.pos.y;
    mob.vel.y = Math.max(-60, mob.vel.y - 28 * dt);
    mob.pos.y += mob.vel.y * dt;
    let grounded = false;
    if (this.mobCollides(mob)) {
      mob.pos.y = oldY;
      if (mob.vel.y < 0) grounded = true;
      mob.vel.y = 0;
    }
    mob.onGround = grounded;

    const sx = mob.pos.x, sz = mob.pos.z;
    const mx = mob.vel.x * dt, mz = mob.vel.z * dt;
    let blocked = false;
    mob.pos.x += mx;
    if (this.mobCollides(mob)) { mob.pos.x = sx; blocked = true; }
    mob.pos.z += mz;
    if (this.mobCollides(mob)) { mob.pos.z = sz; blocked = true; }

    if (blocked && mob.onGround) {
      // 1-block auto-step, then a small jump for taller ledges.
      mob.pos.x = sx; mob.pos.z = sz;
      mob.pos.y += 1.02;
      mob.pos.x += mx; mob.pos.z += mz;
      if (!this.mobCollides(mob)) {
        mob.onGround = false;
      } else {
        mob.pos.x = sx; mob.pos.z = sz; mob.pos.y -= 1.02;
        mob.vel.x = 0; mob.vel.z = 0;
        if (mob.stepCooldown <= 0) {
          mob.vel.y = 7.4;
          mob.onGround = false;
          mob.stepCooldown = 0.8;
        }
      }
    }
  }

  private mobCollides(mob: Mob): boolean {
    const r = mob.width * 0.49;
    const x0 = Math.floor(mob.pos.x - r), x1 = Math.floor(mob.pos.x + r);
    const y0 = Math.floor(mob.pos.y + 0.001), y1 = Math.floor(mob.pos.y + mob.height - 0.001);
    const z0 = Math.floor(mob.pos.z - r), z1 = Math.floor(mob.pos.z + r);
    for (let y = y0; y <= y1; y++) {
      for (let z = z0; z <= z1; z++) {
        for (let x = x0; x <= x1; x++) {
          const id = this.world.getBlock(x, y, z);
          if (id && this.rocks.solid[id]) return true;
        }
      }
    }
    return false;
  }

  private liquidAt(x: number, y: number, z: number): boolean {
    const id = this.world.getBlock(Math.floor(x), Math.floor(y), Math.floor(z));
    return id !== 0 && this.rocks.liquid[id] === 1;
  }

  private canSee(ax: number, ay: number, az: number, bx: number, by: number, bz: number): boolean {
    const dx = bx - ax, dy = by - ay, dz = bz - az;
    const dist = Math.hypot(dx, dy, dz);
    const steps = Math.max(1, Math.ceil(dist / 0.7));
    for (let i = 1; i < steps; i++) {
      const t = i / steps;
      const id = this.world.getBlock(Math.floor(ax + dx * t), Math.floor(ay + dy * t), Math.floor(az + dz * t));
      if (id && this.rocks.solid[id]) return false;
    }
    return true;
  }

  private shootArrow(mob: Mob, player: Vec3): void {
    const sx = mob.pos.x, sy = mob.pos.y + mob.height * 0.8, sz = mob.pos.z;
    const tx = player.x, ty = player.y + 1.1, tz = player.z;
    const dx = tx - sx, dy = ty - sy, dz = tz - sz;
    const len = Math.hypot(dx, dy, dz) || 1;
    const speed = 16;
    const spread = 0.025;
    this.arrows.push({
      pos: { x: sx, y: sy, z: sz },
      vel: {
        x: (dx / len) * speed + (Math.random() - 0.5) * spread,
        y: (dy / len) * speed + 1.2 + (Math.random() - 0.5) * spread,
        z: (dz / len) * speed + (Math.random() - 0.5) * spread,
      },
      life: 4,
      damage: 1.5,
    });
  }

  private updateArrows(dt: number, player: Vec3): void {
    for (let i = this.arrows.length - 1; i >= 0; i--) {
      const a = this.arrows[i];
      a.life -= dt;
      a.vel.y -= 3 * dt;
      a.pos.x += a.vel.x * dt;
      a.pos.y += a.vel.y * dt;
      a.pos.z += a.vel.z * dt;
      if (a.life <= 0) { this.arrows.splice(i, 1); continue; }
      const id = this.world.getBlock(Math.floor(a.pos.x), Math.floor(a.pos.y), Math.floor(a.pos.z));
      if (id && this.rocks.solid[id]) { this.arrows.splice(i, 1); continue; }
      if (Math.abs(a.pos.x - player.x) < 0.4 && Math.abs(a.pos.z - player.z) < 0.4 &&
          a.pos.y > player.y - 0.1 && a.pos.y < player.y + 1.85) {
        this.onPlayerDamage?.(a.damage, 'skeleton_arrow');
        this.arrows.splice(i, 1);
      }
    }
  }

  /** Applies damage and optional knockback. Passive mobs flee, hostiles retaliate. */
  damage(mob: Mob, amount: number, knockbackDir?: Vec3, source = 'player'): void {
    if (mob.dead || amount <= 0) return;
    mob.health -= amount;
    mob.hurtTime = 0.35;
    if (mob.health <= 0) {
      mob.health = 0;
      mob.dead = true;
      this.onMobDeath?.(mob, source);
      return;
    }
    let kx = 0, kz = 0;
    if (knockbackDir) { kx = knockbackDir.x; kz = knockbackDir.z; }
    else {
      kx = mob.pos.x - this.playerPos.x;
      kz = mob.pos.z - this.playerPos.z;
    }
    const len = Math.hypot(kx, kz) || 1;
    mob.vel.x += (kx / len) * 3.5;
    mob.vel.z += (kz / len) * 3.5;
    mob.vel.y = Math.max(mob.vel.y, 2.8);
    if (mob.passive) {
      mob.fleeTimer = 3.5;
      mob.state = 'flee';
    } else {
      mob.state = 'chase';
    }
  }

  /** Ray vs mob AABBs (reach in blocks). Returns the nearest mob hit. */
  playerAttackRaycast(origin: Vec3, dir: Vec3, damage = 4, reach = 4.5): Mob | null {
    const len = Math.hypot(dir.x, dir.y, dir.z);
    if (len < 0.0001) return null;
    const dx = dir.x / len, dy = dir.y / len, dz = dir.z / len;
    let best: Mob | null = null;
    let bestT = reach;
    for (const mob of this.mobs) {
      if (mob.dead) continue;
      const t = this.rayBox(origin.x, origin.y, origin.z, dx, dy, dz, mob, bestT);
      if (t !== null && t < bestT) { bestT = t; best = mob; }
    }
    if (best) this.damage(best, damage, { x: dx, y: dy, z: dz });
    return best;
  }

  /** Convenience for Player.target: cast from the eye through the block hit point. */
  playerAttackFromHit(hit: HitLike | null, eye: Vec3, damage = 4, reach = 4.5): Mob | null {
    if (!hit) return null;
    const tx = hit.x + 0.5 + (hit.nx ?? 0) * 0.51;
    const ty = hit.y + 0.5 + (hit.ny ?? 0) * 0.51;
    const tz = hit.z + 0.5 + (hit.nz ?? 0) * 0.51;
    const dx = tx - eye.x, dy = ty - eye.y, dz = tz - eye.z;
    if (Math.hypot(dx, dy, dz) > reach + 0.6) return null;
    return this.playerAttackRaycast(eye, { x: dx, y: dy, z: dz }, damage, reach);
  }

  /** Casts along the player camera basis (same convention as Player/eye). */
  playerAttackFromLook(eye: Vec3, yaw: number, pitch: number, damage = 4, reach = 4.5): Mob | null {
    const cp = Math.cos(pitch);
    return this.playerAttackRaycast(eye, {
      x: -Math.sin(yaw) * cp, y: -Math.sin(pitch), z: Math.cos(yaw) * cp,
    }, damage, reach);
  }

  private rayBox(ox: number, oy: number, oz: number, dx: number, dy: number, dz: number, mob: Mob, maxT: number): number | null {
    const r = mob.width * 0.5;
    const min = [mob.pos.x - r, mob.pos.y, mob.pos.z - r];
    const max = [mob.pos.x + r, mob.pos.y + mob.height, mob.pos.z + r];
    const o = [ox, oy, oz], d = [dx, dy, dz];
    let tmin = 0, tmax = maxT;
    for (let i = 0; i < 3; i++) {
      if (Math.abs(d[i]) < 1e-6) {
        if (o[i] < min[i] || o[i] > max[i]) return null;
      } else {
        let t1 = (min[i] - o[i]) / d[i];
        let t2 = (max[i] - o[i]) / d[i];
        if (t1 > t2) { const tmp = t1; t1 = t2; t2 = tmp; }
        if (t1 > tmin) tmin = t1;
        if (t2 < tmax) tmax = t2;
        if (tmin > tmax) return null;
      }
    }
    return tmin;
  }

  clear(): void {
    this.mobs.length = 0;
    this.arrows.length = 0;
  }
}
