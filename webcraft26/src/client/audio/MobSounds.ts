// Mob voices, hurt/death cries and footsteps, driven by observing the entity list.
//
// The entity classes (src/vanilla/world/entity/**) have no sound hooks, so this watches the same fields
// vanilla's sound code is keyed on and plays the same events:
//   Mob.baseTick:            if (isAlive() && random.nextInt(1000) < ambientSoundTime++) { play ambient; ambientSoundTime = -80 }
//   LivingEntity.hurt:       playHurtSound  -> entity.<type>.hurt      (rising edge of hurtTime)
//   LivingEntity.die:        playDeathSound -> entity.<type>.death     (alive -> dead)
//   Entity.playStepSound:    entity.<type>.step at volume 0.15, once per unit of walkDist
// Pitch is vanilla's LivingEntity.getVoicePitch: (random - random) * 0.2 + 1.

import { LivingEntity } from '../../vanilla/world/entity/LivingEntity.js';
import { Mob } from '../../vanilla/world/entity/Mob.js';
import type { Entity } from '../../vanilla/world/entity/Entity.js';
import type { SoundEngine } from './SoundEngine.js';

/** Mobs further away than this are inaudible anyway (attenuation distance is 16 blocks). */
const AUDIBLE_RADIUS_SQ = 32 * 32;
/** Mob.getAmbientSoundInterval() default. */
const AMBIENT_INTERVAL = 80;

interface State {
  ambient: number;
  hurt: number;
  alive: boolean;
  walk: number;
  /** Creeper.getSwelling(): 0 -> >0 triggers entity.creeper.primed once (fuse hiss). */
  swell: number;
}

export class MobSounds {
  private readonly states = new WeakMap<Entity, State>();
  private seed = 0x1badb002;

  private rand(): number {
    let x = this.seed;
    x ^= x << 13; x ^= x >>> 17; x ^= x << 5;
    this.seed = x >>> 0;
    return this.seed / 4294967296;
  }

  private pitch(): number { return (this.rand() - this.rand()) * 0.2 + 1; }

  tick(entities: readonly Entity[], sounds: SoundEngine, px: number, py: number, pz: number): void {
    if (!sounds.isReady) return;
    for (const e of entities) {
      if (!(e instanceof Mob) || e.isRemoved()) continue;
      const dx = e.x - px, dy = e.y - py, dz = e.z - pz;
      const near = dx * dx + dy * dy + dz * dz <= AUDIBLE_RADIUS_SQ;
      let st = this.states.get(e);
      if (!st) {
        st = {
          ambient: -Math.floor(this.rand() * AMBIENT_INTERVAL), hurt: e.hurtTime,
          alive: e.isAlive(), walk: Math.floor(e.walkDist),
          swell: (e as unknown as { swell?: number }).swell ?? 0,
        };
        this.states.set(e, st);
      }
      const type = e.getTypeName();
      const alive = e.isAlive();

      if (near) {
        if (alive && Math.floor(this.rand() * 1000) < st.ambient++) {
          st.ambient = -AMBIENT_INTERVAL;
          this.play(sounds, `entity.${type}.ambient`, e, 1);
        }
        if (alive && e.hurtTime > st.hurt) this.play(sounds, `entity.${type}.hurt`, e, 1);
        // Creeper.inflate(): the fuse hiss plays once when swelling starts.
        const swell = (e as unknown as { swell?: number }).swell ?? 0;
        if (type === 'creeper' && swell > 0 && st.swell <= 0) {
          this.play(sounds, 'entity.creeper.primed', e, 1);
        }
        st.swell = swell;
        if (st.alive && !alive) this.play(sounds, `entity.${type}.death`, e, 1);
        const walk = Math.floor(e.walkDist);
        if (alive && walk > st.walk && e.onGround) this.play(sounds, `entity.${type}.step`, e, 0.15);
        st.walk = walk;
      } else {
        st.walk = Math.floor(e.walkDist);
      }
      st.hurt = e.hurtTime;
      st.alive = alive;
    }
  }

  private play(sounds: SoundEngine, event: string, e: LivingEntity, volume: number): void {
    // Only real events: SoundEngine would otherwise fall back to an unrelated alias sound.
    if (!sounds.hasRealEvent(event)) return;
    sounds.play(event, e.x, e.y + 0.5, e.z, volume, this.pitch());
  }
}
