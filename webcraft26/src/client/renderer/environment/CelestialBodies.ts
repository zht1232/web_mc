// Port of the celestial texture management in net.minecraft.client.renderer.SkyRenderer.
//
// 26.2 ships the moon phases as eight loose PNGs under
//   textures/environment/celestial/moon/*.png
// instead of a single 4x2 atlas. SkyRenderer.renderMoon picks a phase by index;
// here we load all eight and expose moonTexture(phase) following the same order.

import { loadEnvTextureRGBA, moonPhaseOf, type LevelLike } from './EnvCommon.js';

/** Vanilla MoonPhase index order (0 = full moon). */
export const MOON_PHASES = [
  'full_moon',
  'waning_gibbous',
  'third_quarter',
  'waning_crescent',
  'new_moon',
  'waxing_crescent',
  'first_quarter',
  'waxing_gibbous',
] as const;

export type EclipseKind = 'none' | 'solar' | 'lunar';

export interface CelestialTint {
  r: number; g: number; b: number; a: number;
}

export class CelestialBodies {
  sun: WebGLTexture | null = null;
  readonly moons: (WebGLTexture | null)[] = [];

  /** Optional eclipse effect (see eclipseTint). */
  solarEclipse = false;
  lunarEclipse = false;

  get moonPhaseCount(): number {
    let n = 0;
    for (const t of this.moons) if (t) n++;
    return n;
  }

  async load(gl: WebGL2RenderingContext): Promise<void> {
    if (this.sun) return;
    const loaded = await Promise.all([
      loadEnvTextureRGBA(gl, 'environment/celestial/sun'),
      ...MOON_PHASES.map((p) => loadEnvTextureRGBA(gl, `environment/celestial/moon/${p}`)),
    ]);
    this.sun = loaded[0];
    this.moons.length = 0;
    this.moons.push(...loaded.slice(1));
  }

  /** Uses level.getMoonPhase() when available, otherwise full moon. */
  moonTextureFor(level?: LevelLike | null): WebGLTexture | null {
    return this.moonTexture(moonPhaseOf(level));
  }

  moonTexture(phase: number): WebGLTexture | null {
    if (!this.moons.length) return null;
    const i = ((Math.trunc(phase) % 8) + 8) % 8;
    return this.moons[i] ?? this.moons[0];
  }

  /**
   * Eclipse support (optional): a solar eclipse dims the sun to a dark disc with
   * a faint corona; a lunar eclipse tints the moon blood-red. Vanilla has no
   * such state, so this is a self-contained approximation switched by flags.
   */
  sunTint(rainBrightness: number): CelestialTint {
    const base: CelestialTint = { r: 1, g: 1, b: 1, a: rainBrightness };
    if (this.solarEclipse) {
      base.r = 0.12; base.g = 0.12; base.b = 0.16;
    }
    return base;
  }

  moonTint(rainBrightness: number): CelestialTint {
    const base: CelestialTint = { r: 1, g: 1, b: 1, a: rainBrightness };
    if (this.lunarEclipse) {
      base.r = 0.75; base.g = 0.2; base.b = 0.16;
    }
    return base;
  }

  dispose(gl: WebGL2RenderingContext): void {
    if (this.sun) gl.deleteTexture(this.sun);
    for (const m of this.moons) if (m) gl.deleteTexture(m);
    this.sun = null;
    this.moons.length = 0;
  }
}
