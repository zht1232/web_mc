// Main-thread half of the chunk pipeline: a pool of workers plus a priority queue.
//
// Lifecycle
//   request()  -> priority queue (nearest first), deduplicated by chunk key
//   pump()     -> up to workers*2 jobs are in flight; each worker gets at most 2 at a time
//   drain()    -> finished chunks are unpacked into a LevelChunk, heightmapped, added to the
//                 level (which runs the light engine) inside a strict time budget
//
// The budget is the important part: generation is ~45 ms per column but the apply side
// (palette writes + heightmaps + light) is 10-20 ms on the main thread. Applying a whole ring
// in one tick would be a visible freeze, so drain() honours both a millisecond budget and a
// hard cap of 2 chunks per call, and the remaining chunks simply wait for the next tick.
//
// Fallback: if `Worker` is missing, or two workers fail to load, everything switches to
// synchronous generation through ClientLevel.ensureChunk (the same path the client used
// before the pool existed). `usingWorkers` reports which mode is active.

import type { MinecraftData } from '../../vanilla/world/level/block/state/BlockState.js';
import type { ClientLevel } from '../../vanilla/world/level/ClientLevel.js';
import { LevelChunk, SECTION_VOLUME } from '../../vanilla/world/level/chunk/LevelChunk.js';
import { chunkKey } from '../../vanilla/core/Geometry.js';

/** height of the overworld column in sections (16 * 384 * 16 states per chunk) */
const SECTION_COUNT = 24;
/** never unpack more than this per drain(): one chunk is already ~1/3 of a 16 ms frame */
const MAX_APPLY_PER_DRAIN = 2;
/** how long init waits for a worker to fetch its data before declaring it dead */
const READY_TIMEOUT_MS = 30_000;
/** per-worker in-flight cap: keeps a worker busy without a long IPC backlog */
const PER_WORKER_CAP = 2;

interface Job {
  key: number;
  cx: number;
  cz: number;
  /** squared distance to the camera, lower = nearer = dispatched first */
  priority: number;
}

interface FinishedChunk {
  job: Job;
  states: Uint16Array;
  biomes: Uint8Array | null;
  genMs: number;
}

type WorkerOut =
  | { type: 'ready' }
  | { type: 'chunk'; id: number; cx: number; cz: number; states: Uint16Array; biomes?: Uint8Array; genMs?: number }
  | { type: 'error'; id: number; message: string; stack?: string };

/** Binary min-heap on `priority`. Small (a few hundred entries) but hot: every tick pushes. */
class JobQueue {
  private readonly items: Job[] = [];

  get length(): number { return this.items.length; }

  push(job: Job): void {
    const a = this.items;
    a.push(job);
    let i = a.length - 1;
    while (i > 0) {
      const parent = (i - 1) >> 1;
      if (a[parent].priority <= a[i].priority) break;
      const t = a[parent]; a[parent] = a[i]; a[i] = t;
      i = parent;
    }
  }

  pop(): Job | undefined {
    const a = this.items;
    if (a.length === 0) return undefined;
    const top = a[0];
    const last = a.pop()!;
    if (a.length > 0) {
      a[0] = last;
      let i = 0;
      for (;;) {
        const l = i * 2 + 1;
        const r = l + 1;
        let smallest = i;
        if (l < a.length && a[l].priority < a[smallest].priority) smallest = l;
        if (r < a.length && a[r].priority < a[smallest].priority) smallest = r;
        if (smallest === i) break;
        const t = a[smallest]; a[smallest] = a[i]; a[i] = t;
        i = smallest;
      }
    }
    return top;
  }

  clear(): void { this.items.length = 0; }
}

export class ChunkProvider {
  private readonly workers: Worker[] = [];
  private readonly idle = new Set<Worker>();
  /** jobs currently queued inside a worker */
  private readonly perWorker = new Map<Worker, number>();
  private readonly inflightJobs = new Map<number, { job: Job; worker: Worker }>();
  private readonly queue = new JobQueue();
  /** every key that is queued or in flight, so request() can dedupe in O(1) */
  private readonly pending = new Set<number>();
  /** chunks whose generation threw; never retried (the sync path would throw too) */
  private readonly failed = new Set<number>();
  private readonly finished: FinishedChunk[] = [];

  private readonly maxWorkers: number;
  private base = '/mc';
  private nextId = 1;
  private workerFailures = 0;
  private disposed = false;
  private initPromise: Promise<void> | null = null;
  private _usingWorkers = false;
  private _fallbackReason = '';

  /** counters used by the HUD and by the throughput benchmark */
  generatedCount = 0;
  appliedCount = 0;
  lastGenMs = 0;

  constructor(private readonly mc: MinecraftData, readonly seed: bigint, workers?: number) {
    const hc = typeof navigator !== 'undefined' ? navigator.hardwareConcurrency : 0;
    const wanted = workers ?? Math.min(hc || 4, 4);
    this.maxWorkers = Math.max(1, Math.min(wanted, 8));
  }

  // ------------------------------------------------------------------ setup

  async init(base = '/mc'): Promise<void> {
    if (this.initPromise) return this.initPromise;
    this.base = base;
    this.initPromise = this.spawnPool(base);
    return this.initPromise;
  }

  /** true when generation happens on worker threads */
  get usingWorkers(): boolean { return this._usingWorkers && !this.disposed; }
  get workerCount(): number { return this.workers.length; }
  get fallbackReason(): string { return this._fallbackReason; }

  private async spawnPool(base: string): Promise<void> {
    if (typeof Worker === 'undefined') {
      this._fallbackReason = 'Worker is not available';
      this._usingWorkers = false;
      return;
    }
    const attempts: Promise<boolean>[] = [];
    for (let i = 0; i < this.maxWorkers; i++) attempts.push(this.spawnWorker(base));
    const results = await Promise.all(attempts);
    if (this.disposed) return;
    if (!results.some(Boolean)) {
      this._fallbackReason = this._fallbackReason || 'no worker became ready';
      this._usingWorkers = false;
      return;
    }
    this._usingWorkers = true;
    this.pump();
  }

  /** Spawns one worker and resolves true once it reports 'ready'. */
  private spawnWorker(base: string): Promise<boolean> {
    return new Promise<boolean>((resolve) => {
      let worker: Worker;
      try {
        // Vite statically rewrites this to an emitted worker chunk (see verification #2).
        worker = new Worker(new URL('./chunk.worker.ts', import.meta.url), { type: 'module' });
      } catch (err) {
        this.workerFailures++;
        this._fallbackReason = `worker constructor failed: ${(err as Error).message}`;
        resolve(false);
        return;
      }

      let settled = false;
      const finish = (ok: boolean): void => {
        if (settled) return;
        settled = true;
        clearTimeout(timer);
        resolve(ok);
      };

      const timer = setTimeout(() => {
        this.failWorker(worker, 'init timeout');
        finish(false);
      }, READY_TIMEOUT_MS);

      worker.onmessage = (ev: MessageEvent<WorkerOut>) => {
        this.onMessage(worker, ev.data, finish);
      };
      worker.onerror = (ev: ErrorEvent) => {
        ev.preventDefault?.();
        this.failWorker(worker, ev.message || 'worker error event');
        finish(false);
      };

      this.workers.push(worker);
      worker.postMessage({ type: 'init', seed: this.seed.toString(), base });
    });
  }

  private onMessage(worker: Worker, msg: WorkerOut, markReady: (ok: boolean) => void): void {
    switch (msg.type) {
      case 'ready':
        this.idle.add(worker);
        if (!this.perWorker.has(worker)) this.perWorker.set(worker, 0);
        markReady(true);
        this.pump();
        return;

      case 'chunk': {
        this.generatedCount++;
        this.lastGenMs = msg.genMs ?? 0;
        const entry = this.inflightJobs.get(msg.id);
        this.inflightJobs.delete(msg.id);
        if (entry) {
          this.perWorker.set(worker, Math.max(0, (this.perWorker.get(worker) ?? 1) - 1));
          // keep the priority so drain() can still apply nearest-first
          this.finished.push({
            job: entry.job,
            states: msg.states,
            biomes: msg.biomes ?? null,
            genMs: msg.genMs ?? 0,
          });
        }
        this.pump();
        return;
      }

      case 'error':
        console.warn(`[chunk.worker] ${msg.message}`);
        if (msg.id < 0) {
          // init failed: the worker is useless
          this.failWorker(worker, msg.message);
          markReady(false);
          return;
        }
        // a single chunk blew up: drop it, otherwise ensureChunksAround would retry forever
        this.dropJob(worker, msg.id);
        this.pump();
        return;
    }
  }

  // -------------------------------------------------------------- scheduling

  request(cx: number, cz: number, priority: number): void {
    if (this.disposed) return;
    const key = chunkKey(cx, cz);
    if (this.pending.has(key) || this.failed.has(key)) return;
    this.pending.add(key);
    this.queue.push({ key, cx, cz, priority });
    this.pump();
  }

  get queueLength(): number { return this.queue.length; }
  get inflight(): number { return this.inflightJobs.size; }

  isPending(cx: number, cz: number): boolean {
    return this.pending.has(chunkKey(cx, cz));
  }

  /** Hands queued jobs to idle workers until the in-flight caps are hit. */
  private pump(): void {
    if (!this._usingWorkers || this.disposed) return;
    const cap = this.maxWorkers * 2;
    while (this.inflightJobs.size < cap && this.queue.length > 0) {
      const worker = this.pickWorker();
      if (!worker) return;
      const job = this.queue.pop()!;
      const id = this.nextId++;
      this.inflightJobs.set(id, { job, worker });
      this.perWorker.set(worker, (this.perWorker.get(worker) ?? 0) + 1);
      // transferables go the other way (worker -> main), so this message is tiny
      worker.postMessage({ type: 'generate', id, cx: job.cx, cz: job.cz });
    }
  }

  private pickWorker(): Worker | null {
    let best: Worker | null = null;
    let bestLoad = PER_WORKER_CAP;
    for (const worker of this.idle) {
      const load = this.perWorker.get(worker) ?? 0;
      if (load < bestLoad) { best = worker; bestLoad = load; }
    }
    return best;
  }

  private dropJob(worker: Worker, id: number): void {
    const entry = this.inflightJobs.get(id);
    this.inflightJobs.delete(id);
    if (!entry) return;
    this.perWorker.set(worker, Math.max(0, (this.perWorker.get(worker) ?? 1) - 1));
    this.pending.delete(entry.job.key);
    this.failed.add(entry.job.key);
  }

  // ------------------------------------------------------------------- apply

  /**
   * Applies up to `budgetMs` of finished chunks (hard cap 2) and returns how many were added
   * to the level. With workers disabled it generates from the queue synchronously instead.
   */
  drain(level: ClientLevel, budgetMs = 6): number {
    if (this.disposed) return 0;
    const started = performance.now();
    let applied = 0;

    while (applied < MAX_APPLY_PER_DRAIN) {
      // check the clock *before* starting a chunk: a chunk is atomic, we cannot half-apply it
      if (applied > 0 && performance.now() - started >= budgetMs) break;

      if (this._usingWorkers) {
        const item = this.takeFinished();
        if (!item) break;
        if (this.applyFinished(level, item)) applied++;
      } else {
        const job = this.queue.pop();
        if (!job) break;
        this.pending.delete(job.key);
        // synchronous fallback: generate + light in one go (45 ms + 15 ms, hence the cap)
        if (!level.hasChunk(job.cx, job.cz)) {
          level.ensureChunk(job.cx, job.cz);
          this.appliedCount++;
          applied++;
        }
      }
    }
    return applied;
  }

  private takeFinished(): FinishedChunk | null {
    if (this.finished.length === 0) return null;
    let best = 0;
    for (let i = 1; i < this.finished.length; i++) {
      if (this.finished[i].job.priority < this.finished[best].job.priority) best = i;
    }
    return this.finished.splice(best, 1)[0];
  }

  private applyFinished(level: ClientLevel, item: FinishedChunk): boolean {
    const { cx, cz, key } = item.job;
    this.pending.delete(key);
    if (level.hasChunk(cx, cz)) return false;

    const chunk = new LevelChunk(cx, cz, level.minY, level.height, this.mc);
    const states = item.states;
    const biomes = item.biomes;

    for (let s = 0; s < SECTION_COUNT; s++) {
      const offset = s * SECTION_VOLUME;

      // all-air section: leave chunk.sections[i] undefined (vanilla drops empty sections too)
      let any = false;
      for (let i = 0; i < SECTION_VOLUME; i++) {
        if (states[offset + i] !== 0) { any = true; break; }
      }
      if (!any) continue;

      const section = chunk.getOrCreateSection(chunk.minSection + s);
      for (let i = 0; i < SECTION_VOLUME; i++) {
        const value = states[offset + i];
        // A fresh PalettedContainer is filled with 0, so air needs no write at all.
        // setBlockState (not states.set) keeps nonEmptyBlockCount/empty in sync, which the
        // light engine relies on to skip sections.
        if (value !== 0) section.setBlockState(i & 15, (i >> 8) & 15, (i >> 4) & 15, value);
      }

      if (biomes) {
        for (let i = 0; i < SECTION_VOLUME; i++) {
          const biome = biomes[offset + i];
          if (biome !== 0) section.biomes.set(i, biome); // palette[0] is 0 already
        }
      }
    }

    chunk.recalcHeightmaps();

    // addChunk runs the light engine; that (not the palette copy) is most of the apply cost
    level.addChunk(chunk);
    this.appliedCount++;
    return true;
  }

  // ----------------------------------------------------------------- teardown

  private failWorker(worker: Worker, reason: string): void {
    this.idle.delete(worker);
    this.perWorker.delete(worker);
    const idx = this.workers.indexOf(worker);
    if (idx >= 0) this.workers.splice(idx, 1);
    try { worker.terminate(); } catch { /* already gone */ }
    this.requeueInflight(worker);
    this.workerFailures++;
    if (this.workerFailures >= 2) {
      this.disableWorkers(`worker failed twice (${reason})`);
      return;
    }
    console.warn(`[chunk] worker failed: ${reason}`);
    if (this._usingWorkers && !this.disposed) {
      void this.spawnWorker(this.base).then((ok) => {
        if (ok) this.pump();
      });
    }
  }

  /** Puts in-flight jobs from `only` (or all workers) back at the head of the queue. */
  private requeueInflight(only?: Worker): void {
    for (const [id, entry] of [...this.inflightJobs]) {
      if (only && entry.worker !== only) continue;
      this.inflightJobs.delete(id);
      this.perWorker.set(entry.worker, Math.max(0, (this.perWorker.get(entry.worker) ?? 1) - 1));
      if (!this.disposed) this.queue.push(entry.job);
    }
  }

  private disableWorkers(reason: string): void {
    this._fallbackReason = reason;
    this._usingWorkers = false;
    console.warn(`[chunk] falling back to synchronous generation: ${reason}`);
    for (const worker of [...this.workers]) {
      try { worker.terminate(); } catch { /* ignore */ }
    }
    this.workers.length = 0;
    this.idle.clear();
    this.perWorker.clear();
    this.requeueInflight();
  }

  dispose(): void {
    this.disposed = true;
    this._usingWorkers = false;
    for (const worker of this.workers) {
      try { worker.terminate(); } catch { /* ignore */ }
    }
    this.workers.length = 0;
    this.idle.clear();
    this.perWorker.clear();
    this.inflightJobs.clear();
    this.queue.clear();
    this.pending.clear();
    this.finished.length = 0;
  }
}
