// Verification for the environment / particle / audio deliverables.
// Run:  npx tsx scripts/test-audio-particles.mts
//
// 1. ogg copy count + sounds/index.json path existence
// 2. 10000-particle pool: 300 ticks, no OOB / NaN / capacity growth, < 2 ms/frame
// 3. same seed => identical particle trajectory
// 4. cloud mesh vertex count + UV range
// 5. every particles/*.json texture resolves to an atlas uv (unresolved listed)
//
// Exits non-zero on any FAIL.

import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { createRequire } from 'node:module';
import { performance } from 'node:perf_hooks';

import {
  buildCloudMesh, FAST_VERTS_PER_CELL, FANCY_LAYERS, CLOUD_CELL_SIZE,
} from '../src/client/renderer/environment/CloudRenderer.ts';
import { ParticleEngine, spawnBlockBreakParticles, spawnExplosion, spawnSplash } from '../src/client/particle/ParticleEngine.ts';
import { ParticleType, PARTICLE_TYPE_COUNT } from '../src/client/particle/Particle.ts';
import {
  generateParticleAtlas, type AtlasIoAdapter, type TextureImage,
} from '../src/client/particle/ParticleSprites.ts';

const require = createRequire(import.meta.url);
const { PNG } = require('pngjs') as { PNG: {
  sync: { read(buf: Buffer): { width: number; height: number; data: Buffer }; write(png: unknown): Buffer };
  new (opts: { width: number; height: number }): { data: Buffer };
} };

const ROOT = fileURLToPath(new URL('..', import.meta.url));       // webcraft26/
const REPO = path.resolve(ROOT, '..');                            // workspace root
const SRC_VANILLA = path.join(REPO, '_src/thirdparty/thirdparty/src-vanilla');
const OFFICIAL_SOUNDS = path.join(REPO, '_src/thirdparty/thirdparty/official-assets-mc/sounds');
const PARTICLE_DEFS = path.join(SRC_VANILLA, 'assets/minecraft/particles');
const PUBLIC = path.join(ROOT, 'public/mc');
const PUBLIC_SOUNDS = path.join(PUBLIC, 'sounds');
const PARTICLE_TEX = path.join(PUBLIC, 'textures/particle');
const ATLAS_PNG = path.join(PUBLIC, 'particle_atlas.png');
const ATLAS_JSON = path.join(PUBLIC, 'particles.json');

let failures = 0;
function check(name: string, cond: boolean, detail = ''): void {
  const line = `${cond ? 'PASS' : 'FAIL'}  ${name}${detail ? ' — ' + detail : ''}`;
  console.log(line);
  if (!cond) failures++;
}
function section(t: string): void { console.log('\n=== ' + t + ' ==='); }

function walk(dir: string, ext: string): string[] {
  const out: string[] = [];
  if (!fs.existsSync(dir)) return out;
  for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
    const p = path.join(dir, e.name);
    if (e.isDirectory()) out.push(...walk(p, ext));
    else if (e.name.endsWith(ext)) out.push(p);
  }
  return out;
}

// ---------------------------------------------------------------- test 1
section('1. ogg 复制与 sounds/index.json');
const srcOgg = walk(OFFICIAL_SOUNDS, '.ogg');
const dstOgg = walk(PUBLIC_SOUNDS, '.ogg');
// build-sounds.mjs adds the rest of the vanilla events on top of the original 112 files, so the copy is a superset
check('源 ogg 全部已复制 (dst >= src)', srcOgg.length > 0 && dstOgg.length >= srcOgg.length,
  `src=${srcOgg.length} dst=${dstOgg.length}`);
const indexPath = path.join(PUBLIC_SOUNDS, 'index.json');
check('sounds/index.json 存在', fs.existsSync(indexPath));
let indexMissing = 0, indexEvents = 0, indexFiles = 0;
if (fs.existsSync(indexPath)) {
  const idx = JSON.parse(fs.readFileSync(indexPath, 'utf8')) as {
    eventCount?: number; fileCount?: number; events: Record<string, string[]>;
  };
  indexEvents = Object.keys(idx.events).length;
  for (const files of Object.values(idx.events)) {
    for (const f of files) {
      indexFiles++;
      if (!fs.existsSync(path.join(PUBLIC_SOUNDS, f))) indexMissing++;
    }
  }
  check('index.json 每个路径在磁盘存在', indexMissing === 0, `checked=${indexFiles} missing=${indexMissing}`);
  check('index.json fileCount 与实际 ogg 一致', idx.fileCount === dstOgg.length,
    `index.fileCount=${idx.fileCount} actual=${dstOgg.length}`);
  check('index.json eventCount 与事件表一致', idx.eventCount === indexEvents, `events=${indexEvents}`);
}

// ---------------------------------------------------------------- test 2
section('2. 粒子池：10000 粒子 / 300 帧 / < 2ms 每帧');
const CAP = 10000;
const engine = new ParticleEngine(null, CAP);
engine.setSeed(0x1234abcd);
for (let i = 0; i < CAP; i++) {
  engine.add({
    type: (i % PARTICLE_TYPE_COUNT) as ParticleType,
    x: (i % 100) * 0.1, y: 64 + (i % 7), z: (i % 50) * 0.2,
    vx: ((i % 13) - 6) * 0.01, vy: 0.02, vz: ((i % 17) - 8) * 0.01,
    lifetime: 1_000_000,           // keep all 10000 alive for a steady load
  });
}
check('加入 10000 粒子', engine.pool.count === CAP, `count=${engine.pool.count}`);
const overflow = engine.add({
  type: ParticleType.SMOKE, x: 0, y: 0, z: 0, vx: 0, vy: 0, vz: 0,
});
check('池满后 add 返回 -1（不增长）', overflow === -1, `returned=${overflow}`);
check('池容量保持 10000', engine.pool.capacity === CAP, `capacity=${engine.pool.capacity}`);

const viewProj = new Float32Array(16);
viewProj[0] = viewProj[5] = viewProj[10] = viewProj[15] = 1;   // identity-ish
// warm up JIT so the first-frame compilation cost is not attributed to the pool
for (let f = 0; f < 10; f++) { engine.tick(); engine.buildInstanceData(viewProj, 0.5); }
let totalMs = 0, worstMs = 0;
const frames = 300;
for (let f = 0; f < frames; f++) {
  const t0 = performance.now();
  engine.tick();
  engine.buildInstanceData(viewProj, 0.5);
  const dt = performance.now() - t0;
  totalMs += dt;
  if (dt > worstMs) worstMs = dt;
}
const avgMs = totalMs / frames;
check('tick 300 帧后无 NaN', engine.pool.isFinite());
check('槽位未越界', engine.pool.slotCount <= engine.pool.capacity,
  `slotCount=${engine.pool.slotCount} capacity=${engine.pool.capacity}`);
check('池容量未增长', engine.pool.capacity === CAP);
check('平均帧耗时 < 2 ms', avgMs < 2,
  `avg=${avgMs.toFixed(3)}ms worst=${worstMs.toFixed(3)}ms total=${totalMs.toFixed(1)}ms/${frames}f`);
console.log(`  性能实测: avg=${avgMs.toFixed(4)} ms/frame, worst=${worstMs.toFixed(4)} ms, alive=${engine.pool.count}`);

// ---------------------------------------------------------------- test 3
section('3. 同 seed 两次粒子轨迹一致');
function trajectory(seed: number): number[] {
  const e = new ParticleEngine(null, CAP);
  e.setSeed(seed);
  ParticleEngine.setInstance(e);
  spawnBlockBreakParticles(42, 1, 2, 3, 64);
  spawnExplosion(4, 5, 6, 1.5);
  spawnSplash(7, 8, 9, 24);
  for (let i = 0; i < 200; i++) {
    e.add({
      type: (i % PARTICLE_TYPE_COUNT) as ParticleType,
      x: e.random.nextFloat() * 10, y: 64, z: e.random.nextFloat() * 10,
      vx: e.random.nextFloat() - 0.5, vy: e.random.nextFloat() * 0.1, vz: e.random.nextFloat() - 0.5,
    });
  }
  const fp: number[] = [];
  for (let f = 0; f < 60; f++) { e.tick(); fp.push(e.pool.fingerprint()); }
  return fp;
}
const trajA = trajectory(0x5eed);
const trajB = trajectory(0x5eed);
let identical = trajA.length === trajB.length;
for (let i = 0; identical && i < trajA.length; i++) if (trajA[i] !== trajB[i]) identical = false;
check('同 seed 60 帧指纹完全一致', identical,
  `frames=${trajA.length} first=${trajA[0]} last=${trajA[trajA.length - 1]}`);
const trajC = trajectory(0xdead);
let different = false;
for (let i = 0; i < trajA.length; i++) if (trajA[i] !== trajC[i]) { different = true; break; }
check('不同 seed 轨迹不同（随机有效）', different);
ParticleEngine.setInstance(null);

// ---------------------------------------------------------------- test 4
section('4. 云网格（fast/fancy）顶点数与 UV');
const W = 32, H = 32, R = 8;
const solidAlpha = new Uint8Array(W * H).fill(255);
const fast = buildCloudMesh(W, H, solidAlpha, 'fast', R);
const gridCells = (2 * R + 1) * (2 * R + 1);
check('fast 顶点数 = 候选格子数 × 6', fast.vertexCount === gridCells * FAST_VERTS_PER_CELL,
  `vertices=${fast.vertexCount} gridCells=${gridCells} cell=${CLOUD_CELL_SIZE} blocks`);
check('fast 顶点数是 6 的倍数', fast.vertexCount % FAST_VERTS_PER_CELL === 0);
check('fast 层数 = 1', fast.layers === 1);
const fancy = buildCloudMesh(W, H, solidAlpha, 'fancy', R);
check('fancy 顶点数 = fast × 3 层', fancy.vertexCount === fast.vertexCount * FANCY_LAYERS,
  `fancy=${fancy.vertexCount} fast=${fast.vertexCount}`);
check('fancy 层数 = 3', fancy.layers === FANCY_LAYERS);
const uvOk = (m: typeof fast) => m.uvMin >= 0 && m.uvMax <= 1 && m.uvMax >= m.uvMin;
check('fast UV 在 0..1', uvOk(fast), `uvMin=${fast.uvMin.toFixed(4)} uvMax=${fast.uvMax.toFixed(4)}`);
check('fancy UV 在 0..1', uvOk(fancy), `uvMin=${fancy.uvMin.toFixed(4)} uvMax=${fancy.uvMax.toFixed(4)}`);
const empty = buildCloudMesh(W, H, new Uint8Array(W * H), 'fast', R);
check('全空 alpha 生成 0 顶点', empty.vertexCount === 0);

// ---------------------------------------------------------------- test 5
section('5. 粒子精灵图集：particles/*.json 引用解析');
const io: AtlasIoAdapter = {
  listTextures: () => fs.readdirSync(PARTICLE_TEX)
    .filter((f) => f.endsWith('.png')).map((f) => f.replace(/\.png$/, '')).sort(),
  readPng: (name): TextureImage => {
    const p = PNG.sync.read(fs.readFileSync(path.join(PARTICLE_TEX, name + '.png')));
    return { name, width: p.width, height: p.height, rgba: new Uint8Array(p.data) };
  },
  readDefinitions: () => {
    const raw: Record<string, unknown> = {};
    for (const f of fs.readdirSync(PARTICLE_DEFS)) {
      if (f.endsWith('.json')) raw[f] = JSON.parse(fs.readFileSync(path.join(PARTICLE_DEFS, f), 'utf8'));
    }
    return raw;
  },
  writePng: (width, height, rgba) => {
    const out = new PNG({ width, height });
    out.data = Buffer.from(rgba);
    fs.writeFileSync(ATLAS_PNG, PNG.sync.write(out));
  },
  writeJson: (json) => {
    fs.writeFileSync(ATLAS_JSON, JSON.stringify(json, null, 2) + '\n');
  },
};
const gen = await generateParticleAtlas(io);
check('图集 PNG 已写出', fs.existsSync(ATLAS_PNG),
  `${gen.width}x${gen.height} sprites=${gen.spriteCount} textures=${gen.textureCount}`);
check('particles.json 已写出', fs.existsSync(ATLAS_JSON), `events=${gen.eventCount}`);

const atlasJson = JSON.parse(fs.readFileSync(ATLAS_JSON, 'utf8')) as {
  sprites: Record<string, { u0: number; v0: number; u1: number; v1: number }>;
  events: Record<string, string[]>;
  unresolved: string[];
};
const unresolved: string[] = [];
let checkedRefs = 0;
for (const [event, textures] of Object.entries(atlasJson.events)) {
  for (const tex of textures) {
    checkedRefs++;
    if (!atlasJson.sprites[tex]) unresolved.push(`${event} -> ${tex}`);
  }
}
let uvRangeOk = true;
for (const uv of Object.values(atlasJson.sprites)) {
  if (uv.u0 < 0 || uv.v0 < 0 || uv.u1 > 1 || uv.v1 > 1 || uv.u1 < uv.u0 || uv.v1 < uv.v0) {
    uvRangeOk = false; break;
  }
}
check('每个定义引用的贴图都有 uv', unresolved.length === 0,
  `checked=${checkedRefs} unresolved=${unresolved.length}`);
check('生成结果的 unresolved 为空', gen.unresolved.length === 0 && atlasJson.unresolved.length === 0);
check('所有 sprite uv 在 0..1 且合法', uvRangeOk);
console.log(`  未解析贴图: ${unresolved.length ? unresolved.join(', ') : '(无)'}`);

// ---------------------------------------------------------------- result
section('结果');
if (failures > 0) {
  console.error(`${failures} CHECK(S) FAILED`);
  process.exit(1);
} else {
  console.log('ALL CHECKS PASSED');
}
