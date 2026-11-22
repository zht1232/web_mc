// Port of net.minecraft.server.MinecraftServer autosave behaviour:
//   AUTOSAVE_INTERVAL = 6000 ticks (5 minutes at 20 TPS), MIMINUM_AUTOSAVE_TICKS = 100.
// Also saves on pause / quit (pagehide / visibilitychange). The periodic save is sharded with
// requestIdleCallback so a full-world flush never blocks a frame; pause/quit flush immediately.
//
// DOM globals (requestIdleCallback, document, window) are only touched inside methods, never at
// module top level, so this module imports cleanly in Node/tsx.

import type { ClientLevel } from '../../../vanilla/world/level/ClientLevel.js';
import type { Player } from '../../../vanilla/world/entity/player/Player.js';
import type { SavedPet, SavedVillager } from '../../../vanilla/world/level/storage/LevelSummary.js';
import type { WorldSaveManager } from './WorldSaveManager.js';

export const AUTOSAVE_INTERVAL = 6000;
export const MINIMUM_AUTOSAVE_TICKS = 100;
/** Per-idle-slice millisecond budget handed to WorldSaveManager.flushDirty. */
export const IDLE_SLICE_BUDGET_MS = 8;

export type SaveReason = 'autosave' | 'pause' | 'quit' | 'manual';
export interface AutosaveEvent { reason: SaveReason; chunks: number; done: boolean; }

export interface AutosaveOptions {
  getLevel(): ClientLevel;
  getPlayer(): Player;
  getExtra(): Record<string, unknown>;
  /** Tamed pets to persist with the world (optional for headless tests). */
  getPets?(): SavedPet[];
  /** Villagers (profession/level/offers) to persist with the world. */
  getVillagers?(): SavedVillager[];
  onSave?(event: AutosaveEvent): void;
  onError?(err: unknown): void;
}

export class Autosave {
  private tickCount = 0;
  private ticksUntilAutosave = AUTOSAVE_INTERVAL;
  private running = false;
  private paused = false;
  private disposed = false;
  private idleHandle: number | null = null;
  private cycleActive = false;
  private attached = false;

  constructor(private readonly manager: WorldSaveManager, private readonly opts: AutosaveOptions) {}

  start(): void { this.running = true; }
  stop(): void { this.running = false; this.cancelIdle(); }
  get isRunning(): boolean { return this.running && !this.disposed; }
  get tickCounter(): number { return this.tickCount; }
  get ticksUntilNextSave(): number { return this.ticksUntilAutosave; }

  /** Call once per game tick (20 Hz). */
  tick(ticks = 1): void {
    if (!this.running || this.paused || this.disposed) return;
    this.tickCount += ticks;
    this.ticksUntilAutosave -= ticks;
    if (this.ticksUntilAutosave <= MINIMUM_AUTOSAVE_TICKS) {
      this.ticksUntilAutosave = AUTOSAVE_INTERVAL;
      this.startIdleCycle('autosave');
    }
  }

  /** Pause menu: immediate full save, then stop ticking autosave until resume(). */
  pause(): Promise<void> {
    this.paused = true;
    return this.flushNow('pause');
  }
  resume(): void { this.paused = false; }

  /** Quit / unload: immediate full save. Awaitable. */
  quit(): Promise<void> {
    this.running = false;
    this.cancelIdle();
    return this.flushNow('quit');
  }

  /** Force a complete (unsharded) save right now. Resolves when the flush finishes. */
  flushNow(reason: SaveReason): Promise<void> {
    const level = this.opts.getLevel();
    const player = this.opts.getPlayer();
    return this.manager.flushAll(level, player, this.opts.getExtra(), 1000,
      this.opts.getPets?.() ?? [], this.opts.getVillagers?.() ?? [])
      .then((chunks) => { this.opts.onSave?.({ reason, chunks, done: true }); })
      .catch((err) => { this.opts.onError?.(err); });
  }

  /** Manual sharded save (e.g. "Save & Quit to title" from the pause menu). */
  saveNow(): void { this.startIdleCycle('manual'); }

  // ---- requestIdleCallback sharding ---------------------------------------

  private startIdleCycle(reason: SaveReason): void {
    if (this.disposed || this.cycleActive) return;
    this.cycleActive = true;
    // player + level data once at the head of the cycle
    const level = this.opts.getLevel();
    const player = this.opts.getPlayer();
    void this.manager.savePlayer(player, this.opts.getExtra())
      .then(() => this.manager.saveLevelData(level))
      .then(() => this.manager.savePets(this.opts.getPets?.() ?? []))
      .then(() => this.manager.saveVillagers(this.opts.getVillagers?.() ?? []))
      .catch((err) => this.opts.onError?.(err))
      .finally(() => this.runIdleSlice(reason));
  }

  private runIdleSlice(reason: SaveReason): void {
    if (this.disposed) { this.cycleActive = false; return; }
    this.requestIdle(async (budgetMs) => {
      if (this.disposed) { this.cycleActive = false; return; }
      const level = this.opts.getLevel();
      const player = this.opts.getPlayer();
      let chunks = 0;
      try {
        chunks = await this.manager.flushDirty(level, player, budgetMs);
      } catch (err) {
        this.opts.onError?.(err);
      }
      const done = chunks === 0;
      this.opts.onSave?.({ reason, chunks, done });
      if (done) this.cycleActive = false;
      else this.runIdleSlice(reason); // more dirty chunks -> next idle slice
    });
  }

  private requestIdle(cb: (budgetMs: number) => void): void {
    if (typeof requestIdleCallback !== 'undefined') {
      this.idleHandle = requestIdleCallback((deadline) => {
        this.idleHandle = null;
        cb(Math.max(1, Math.min(IDLE_SLICE_BUDGET_MS, deadline.timeRemaining())));
      }, { timeout: 1000 });
    } else {
      // Node / older browsers: fall back to a macrotask with a fixed slice budget.
      this.idleHandle = setTimeout(() => {
        this.idleHandle = null;
        cb(IDLE_SLICE_BUDGET_MS);
      }, 0) as unknown as number;
    }
  }

  private cancelIdle(): void {
    if (this.idleHandle === null) return;
    if (typeof cancelIdleCallback !== 'undefined') cancelIdleCallback(this.idleHandle);
    else clearTimeout(this.idleHandle);
    this.idleHandle = null;
  }

  // ---- optional DOM wiring -------------------------------------------------

  /** Wires visibilitychange (hidden -> pause/save) and pagehide (-> quit/save). */
  attach(): this {
    if (this.attached || typeof document === 'undefined' || typeof window === 'undefined') return this;
    this.onVisibility = () => { if (document.visibilityState === 'hidden') void this.pause(); else this.resume(); };
    this.onPageHide = () => { void this.quit(); };
    document.addEventListener('visibilitychange', this.onVisibility);
    window.addEventListener('pagehide', this.onPageHide);
    this.attached = true;
    return this;
  }

  private onVisibility: (() => void) | null = null;
  private onPageHide: (() => void) | null = null;

  dispose(): void {
    this.disposed = true;
    this.running = false;
    this.cancelIdle();
    if (this.attached && typeof document !== 'undefined') {
      if (this.onVisibility) document.removeEventListener('visibilitychange', this.onVisibility);
      if (this.onPageHide) window.removeEventListener('pagehide', this.onPageHide);
    }
    this.attached = false;
  }
}
