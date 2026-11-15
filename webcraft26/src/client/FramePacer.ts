// Port of the frame-pacing core from OpusMC (js/perf.js: FramePacer.budget),
// adapted to our fixed-step client loop.
//
// Why this exists: a hard-coded mesh budget (3 ms when a chunk was applied, 6 ms otherwise)
// ignores how expensive the REST of the frame actually was. On a busy frame (entity tick,
// relight, post chain, GC) spending another 6 ms on meshing pushes the frame past the display
// deadline, and the player sees a stutter exactly while moving. Vanilla/OpusMC instead measure
// the frame's non-chunk cost with an EMA and give chunk work only what is left:
//
//     budget = clamp((target - rest - max(1, target * 0.15)) * backoff, min, max)
//
// `backoff` shrinks the allowance for a short while after a late frame (so a single hitch does
// not turn into a multi-frame spiral), and `lastInput` lets a genuinely idle client relax.
// This is API-independent: it works identically on WebGL2 and WebGPU.

const clamp = (v: number, lo: number, hi: number): number => (v < lo ? lo : v > hi ? hi : v);

export class FramePacer {
  /** Measured display refresh interval, ms (updated from real rAF deltas). */
  private refresh = 1000 / 60;
  /** EMA of the frame's main-thread cost EXCLUDING chunk/mesh work. */
  private restMs = 2;
  /** < 1 for a while after frames that came in late. */
  private backoff = 1;
  private lastDelta = 1000 / 60;
  private lastInputAt = 0;
  private initialized = false;

  /** Called once per rendered frame before tick/render. Returns this frame's chunk budget (ms). */
  beginFrame(deltaMs: number): number {
    this.lastDelta = deltaMs;
    if (deltaMs > 4 && deltaMs < 100) {
      // Snap to the nearest common refresh and smooth it; rAF deltas are noisy by 1-2 ms.
      const nearest = deltaMs > 22 ? 33.333 : deltaMs > 12 ? 16.667 : 8.333;
      this.refresh += (nearest - this.refresh) * 0.05;
    }
    return this.budget();
  }

  /**
   * Called at the END of a frame with the total main-thread time and how much of it was
   * chunk/mesh work (chunk apply + section rebuild). Feeds the EMA and the late-frame backoff.
   */
  endFrame(cpuMs: number, chunkMs: number): void {
    const other = Math.max(0, cpuMs - chunkMs);
    if (!this.initialized) { this.restMs = other; this.initialized = true; }
    else this.restMs += (other - this.restMs) * 0.1;

    const target = this.target();
    if (this.lastDelta > target * 1.25) {
      // Came in late: give chunk work less room for the next several frames.
      this.backoff = Math.max(0.35, this.backoff - 0.18);
    } else {
      this.backoff = Math.min(1, this.backoff + 0.04);
    }
  }

  /** Frame interval we are aiming for (ms). */
  target(): number {
    return Math.max(this.refresh, 1000 / 240);
  }

  /** Milliseconds chunk/mesh work may use this frame. */
  budget(): number {
    const t = this.target();
    // 15% margin for the browser (compositing, input, GC), same as OpusMC.
    return clamp((t - this.restMs - Math.max(1, t * 0.15)) * this.backoff, 0.6, 9);
  }

  /** No input for a while: less mesh work is fine, the world is static. */
  noteInput(): void { this.lastInputAt = performance.now(); }
  get idle(): boolean { return performance.now() - this.lastInputAt > 60000; }

  /** Debug readout for the F3 overlay. */
  stats(): { budget: number; rest: number; backoff: number; refresh: number } {
    return { budget: this.budget(), rest: this.restMs, backoff: this.backoff, refresh: this.refresh };
  }
}
