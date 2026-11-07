// Chunk generation worker.
//
// The generator (NoiseChunkGenerator + MinecraftData + LevelChunk) is pure JS with no DOM
// access, so a whole column can be produced off the main thread. The worker loads its own
// copy of the data once, keeps one NoiseChunkGenerator for its lifetime, and ships back a
// flat state array that the main thread can unpack without any further worldgen work.
//
// Protocol (see ChunkProvider for the main thread half):
//   in : {type:'init', seed:string, base?:string}
//   in : {type:'generate', id:number, cx:number, cz:number}
//   out: {type:'ready'}
//   out: {type:'chunk', id, cx, cz, states, biomes, genMs}
//   out: {type:'error', id, message, stack}
//
// Indexing: `((y + 64) << 8) | (z << 4) | x` with y in world coordinates and 384 sections of
// height, i.e. section s occupies [s * 4096, s * 4096 + 4096) and inside a section the entry is
// (y & 15) << 8 | (z << 4) | x - exactly LevelChunk's index(). Flat arrays are used because
// they can be transferred (zero copy) instead of structured-cloned.

import { MinecraftData } from '../../vanilla/world/level/block/state/BlockState.js';
import { loadWorldgenData, NoiseChunkGenerator } from '../../vanilla/world/level/levelgen/NoiseChunkGenerator.js';
import { LevelChunk, SECTION_VOLUME } from '../../vanilla/world/level/chunk/LevelChunk.js';

const MIN_Y = -64;
const HEIGHT = 384;
const SECTION_COUNT = HEIGHT / 16; // 24
/** 16 * 384 * 16 */
const VOLUME = SECTION_COUNT * SECTION_VOLUME;

// DOM and WebWorker libs are both in tsconfig's "lib", so `self` is typed as Window here.
const ctx = self as unknown as DedicatedWorkerGlobalScope;

let mc: MinecraftData | null = null;
let generator: NoiseChunkGenerator | null = null;
/** single-flight guard: every generate request may race the lazy load */
let loading: Promise<void> | null = null;

function ensureLoaded(base: string, seed: bigint): Promise<void> {
  if (!loading) {
    loading = (async () => {
      // fetch inside the worker: /mc/blocks.json + /mc/blocks.bin + /mc/worldgen.json.
      // Both requests hit the HTTP cache the main thread already warmed up.
      const [blocks, worldgen] = await Promise.all([
        MinecraftData.load(base),
        loadWorldgenData(base),
      ]);
      mc = blocks;
      generator = new NoiseChunkGenerator(blocks, worldgen, seed);
    })();
    // a failed load must not poison the worker forever
    loading.catch(() => { loading = null; });
  }
  return loading;
}

interface GenerateRequest {
  type: 'generate';
  id: number;
  cx: number;
  cz: number;
}

interface InitRequest {
  type: 'init';
  seed: string;
  base?: string;
}

function generate(id: number, cx: number, cz: number): void {
  const data = mc;
  const gen = generator;
  if (!data || !gen) throw new Error('chunk.worker: generate before init');

  const started = performance.now();

  // Same call sequence the main thread used to make inline.
  const chunk = new LevelChunk(cx, cz, MIN_Y, HEIGHT, data);
  gen.generateChunk(chunk);

  const states = new Uint16Array(VOLUME);
  const biomes = new Uint8Array(VOLUME);

  for (let s = 0; s < SECTION_COUNT; s++) {
    const section = chunk.sections[s];
    if (!section) continue; // never created == all air
    const base = s * SECTION_VOLUME;
    // Copy non-zero entries only: air is 0 and a fresh array is already 0, so this skips
    // roughly half of the volume (everything above the surface) for free.
    section.states.forEach((i, value) => {
      if (value !== 0) states[base + i] = value;
    });
    // Biomes are stored per block (the generator expands the 4x4x4 quart cells itself), which
    // costs ~98k reads. It is a few ms next to the ~45 ms fill and keeps grass/water tints
    // identical to the synchronous path, so it is worth shipping.
    section.biomes.forEach((i, value) => {
      if (value !== 0) biomes[base + i] = value;
    });
  }

  const genMs = performance.now() - started;

  // Transfer both buffers: the structured clone would copy ~200 KB per chunk, which at
  // several chunks per frame is exactly the kind of GC churn we are trying to avoid.
  // The arrays are freshly allocated per chunk, so detaching them here is harmless.
  ctx.postMessage({ type: 'chunk', id, cx, cz, states, biomes, genMs }, [
    states.buffer,
    biomes.buffer,
  ]);
}

async function handle(msg: InitRequest | GenerateRequest): Promise<void> {
  if (msg.type === 'init') {
    const seed = BigInt(msg.seed); // seed travels as a decimal string: no 64 bit number loss
    try {
      await ensureLoaded(msg.base ?? '/mc', seed);
      ctx.postMessage({ type: 'ready' });
    } catch (err) {
      ctx.postMessage({
        type: 'error',
        id: -1,
        message: (err as Error).message,
        stack: (err as Error).stack ?? '',
      });
    }
    return;
  }

  if (msg.type === 'generate') {
    try {
      // the provider only dispatches after 'ready', so this is a plain guard and must not
      // silently build a generator with the wrong seed
      if (!loading) throw new Error('chunk.worker: generate before init');
      await loading;
      generate(msg.id, msg.cx, msg.cz);
    } catch (err) {
      // never die silently: the provider turns this into a dropped request (and, after
      // repeated failures, into the synchronous fallback)
      ctx.postMessage({
        type: 'error',
        id: msg.id,
        message: (err as Error).message,
        stack: (err as Error).stack ?? '',
      });
    }
    return;
  }
}

ctx.onmessage = (ev: MessageEvent<InitRequest | GenerateRequest>) => {
  void handle(ev.data);
};
