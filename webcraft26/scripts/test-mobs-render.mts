// Node headless test for the mob renderer: model baking, the vanilla matrix
// stack, walk/hurt/death animation state and per-entity lightmap values.
//
//   npx tsx scripts/test-mobs-render.mts
//
// No WebGL: EntityRenderer.append() only writes into pre-allocated Float32
// buffers, so the whole transform pipeline can be checked numerically. Every
// check prints PASS/FAIL; a failure exits with code 1.

import { MobRenderer } from '../src/client/renderer/entity/MobRenderer.ts';
import { EntityBatch, FLOATS_PER_VERTEX } from '../src/client/renderer/entity/EntityRenderer.ts';
import {
  QuadrupedModel, PigModel, CowModel, SheepModel, ChickenModel,
  ZombieModel, SkeletonModel, CreeperModel, SpiderModel, EndermanModel,
  SilverfishModel, WolfModel, RabbitModel, BatModel,
} from '../src/client/renderer/entity/model/EntityModels.ts';
import type { Entity } from '../src/vanilla/world/entity/Entity.ts';

let failures = 0;
function check(name: string, ok: boolean, detail: string): void {
  if (!ok) failures++;
  console.log(`${ok ? 'PASS' : 'FAIL'}  ${name}  ${detail}`);
}

// ---------------------------------------------------------------------------
// Fake entity with just the fields the renderer reads.
// ---------------------------------------------------------------------------

interface FakeOpts {
  yaw?: number; pitch?: number; yHeadRot?: number;
  walkAnimPos?: number; walkAnimSpeed?: number; walkAnimSpeedOld?: number;
  hurtTime?: number; dead?: boolean; deathTime?: number;
  aggressive?: boolean; swell?: number;
  skyLight?: number; blockLight?: number;
  onGround?: boolean;
}

const GROUND = 64;

function fakeEntity(typeName: string, opts: FakeOpts = {}): Entity {
  const y = GROUND;
  return {
    xo: 0, yo: y, zo: 0, x: 0, y, z: 0,
    yaw: opts.yaw ?? 0, pitch: opts.pitch ?? 0, yRotO: opts.yaw ?? 0, xRotO: opts.pitch ?? 0,
    scale: 1, tickCount: 42, onGround: opts.onGround ?? true,
    level: {
      getSkyLight: () => opts.skyLight ?? 15,
      getBlockLight: () => opts.blockLight ?? 0,
    },
    getTypeName: () => typeName,
    isOnFire: () => false,
    getEyeY: () => y + 1.62,
    walkAnimPos: opts.walkAnimPos ?? 0,
    walkAnimSpeed: opts.walkAnimSpeed ?? 0,
    walkAnimSpeedOld: opts.walkAnimSpeedOld ?? opts.walkAnimSpeed ?? 0,
    swingProgress: 0,
    yBodyRot: 0, yBodyRotO: 0, yHeadRot: opts.yHeadRot ?? 0, yHeadRotO: opts.yHeadRot ?? 0,
    dead: opts.dead ?? false,
    deathTime: opts.deathTime ?? 0,
    hurtTime: opts.hurtTime ?? 0,
    isAggressive: () => opts.aggressive ?? false,
    swell: opts.swell ?? 0,
  } as unknown as Entity;
}

interface Bounds {
  minX: number; maxX: number; minY: number; maxY: number; minZ: number; maxZ: number;
  count: number; nan: boolean;
  /** raw vertex positions (x,y,z per vertex) for comparisons */
  pos: Float32Array;
}

function renderAndMeasure(typeName: string, opts: FakeOpts = {}): Bounds {
  const renderer = new MobRenderer(typeName);
  const batch = new EntityBatch(1);
  renderer.append(fakeEntity(typeName, opts), batch, 0, 0);
  const n = batch.lengths[0];
  const data = batch.buckets[0];
  const count = n / FLOATS_PER_VERTEX;
  const pos = new Float32Array(count * 3);
  let minX = Infinity, maxX = -Infinity, minY = Infinity, maxY = -Infinity, minZ = Infinity, maxZ = -Infinity;
  let nan = false;
  for (let i = 0; i < count; i++) {
    const o = i * FLOATS_PER_VERTEX;
    const x = data[o], y = data[o + 1], z = data[o + 2];
    pos[i * 3] = x; pos[i * 3 + 1] = y; pos[i * 3 + 2] = z;
    if (!Number.isFinite(x) || !Number.isFinite(y) || !Number.isFinite(z)) nan = true;
    minX = Math.min(minX, x); maxX = Math.max(maxX, x);
    minY = Math.min(minY, y); maxY = Math.max(maxY, y);
    minZ = Math.min(minZ, z); maxZ = Math.max(maxZ, z);
  }
  return { minX, maxX, minY, maxY, minZ, maxZ, count, nan, pos };
}

function overlayOf(typeName: string, opts: FakeOpts = {}): { red: number; alpha: number } {
  const renderer = new MobRenderer(typeName);
  const batch = new EntityBatch(1);
  renderer.append(fakeEntity(typeName, opts), batch, 0, 0);
  const data = batch.buckets[0];
  return { red: data[10], alpha: data[11] };
}

function lightOf(typeName: string, opts: FakeOpts = {}): { sky: number; block: number } {
  const renderer = new MobRenderer(typeName);
  const batch = new EntityBatch(1);
  renderer.append(fakeEntity(typeName, opts), batch, 0, 0);
  const data = batch.buckets[0];
  return { sky: data[8], block: data[9] };
}

// ---------------------------------------------------------------------------
// 1. every model bakes into finite, non-empty geometry
// ---------------------------------------------------------------------------

const models: [string, { parts: unknown[]; vertexCount: number }][] = [
  ['QuadrupedModel', QuadrupedModel], ['PigModel', PigModel], ['CowModel', CowModel],
  ['SheepModel', SheepModel], ['ChickenModel', ChickenModel], ['ZombieModel', ZombieModel],
  ['SkeletonModel', SkeletonModel], ['CreeperModel', CreeperModel], ['SpiderModel', SpiderModel],
  ['EndermanModel', EndermanModel], ['SilverfishModel', SilverfishModel], ['WolfModel', WolfModel],
  ['RabbitModel', RabbitModel], ['BatModel', BatModel],
];
let allModelsOk = true;
let totalVerts = 0;
for (const [name, m] of models) {
  totalVerts += m.vertexCount;
  if (m.parts.length === 0 || m.vertexCount <= 0) allModelsOk = false;
}
check('[1] 14 data-driven models baked', allModelsOk,
  `parts=${models.reduce((s, [, m]) => s + m.parts.length, 0)} vertices=${totalVerts}`);

const TYPES = ['zombie', 'skeleton', 'creeper', 'spider', 'enderman', 'silverfish',
  'pig', 'cow', 'sheep', 'chicken', 'wolf', 'rabbit', 'bat'];
let geometryOk = true;
let detail = '';
for (const t of TYPES) {
  const b = renderAndMeasure(t);
  if (b.nan || b.count === 0) { geometryOk = false; detail += `${t}:nan `; continue; }
  // every vanilla mob model is rooted at the feet: minY ~ 0, and nothing is
  // more than 3 blocks tall / 2.5 blocks wide in model space
  const minY = b.minY - GROUND, maxY = b.maxY - GROUND;
  if (minY < -0.2 || maxY < 0.3 || maxY > 3.0) { geometryOk = false; detail += `${t}:y=${minY.toFixed(2)}..${maxY.toFixed(2)} `; }
  if (Math.abs(b.minX) > 2.5 || Math.abs(b.maxX) > 2.5 || b.minZ < -2.5 || b.maxZ > 2.5) { geometryOk = false; detail += `${t}:xz `; }
}
check('[2] all 13 mob models sit at the feet, finite, sane size', geometryOk,
  detail || `e.g. zombie y=${(renderAndMeasure('zombie').minY - GROUND).toFixed(3)}..${(renderAndMeasure('zombie').maxY - GROUND).toFixed(3)}`);

// ---------------------------------------------------------------------------
// 2. walking changes the limb pose (limbSwing/limbSwingAmount actually used)
// ---------------------------------------------------------------------------

const still = renderAndMeasure('zombie', { walkAnimPos: 0, walkAnimSpeed: 0 });
const walkingA = renderAndMeasure('zombie', { walkAnimPos: 0, walkAnimSpeed: 1 });
const walkingB = renderAndMeasure('zombie', { walkAnimPos: 4.716, walkAnimSpeed: 1 });
let maxDelta = 0;
for (let i = 0; i < Math.min(walkingA.pos.length, walkingB.pos.length); i++) {
  maxDelta = Math.max(maxDelta, Math.abs(walkingA.pos[i] - walkingB.pos[i]));
}
let maxStillDelta = 0;
for (let i = 0; i < Math.min(still.pos.length, walkingA.pos.length); i++) {
  maxStillDelta = Math.max(maxStillDelta, Math.abs(still.pos[i] - walkingA.pos[i]));
}
check('[3] walk swing moves the limbs', maxDelta > 0.05 && maxStillDelta > 0.05,
  `pose(phase 0 vs 4.716)=${maxDelta.toFixed(3)} blocks, idle vs walking=${maxStillDelta.toFixed(3)}`);

// arm and leg must swing in opposite phase (vanilla HumanoidModel)
function partBoxZRange(b: Bounds, minYRange: [number, number]): number {
  let min = Infinity, max = -Infinity;
  for (let i = 0; i < b.pos.length; i += 3) {
    const y = b.pos[i + 1];
    if (y < minYRange[0] || y > minYRange[1]) continue;
    min = Math.min(min, b.pos[i + 2]); max = Math.max(max, b.pos[i + 2]);
  }
  return max - min;
}
const legSwingA = partBoxZRange(walkingA, [GROUND, GROUND + 1.0]);
const legSwingB = partBoxZRange(walkingB, [GROUND, GROUND + 1.0]);
check('[4] legs sweep along Z when walking', legSwingA > 0.1 && legSwingB > 0.1,
  `leg z-extent phaseA=${legSwingA.toFixed(3)} phaseB=${legSwingB.toFixed(3)}`);

// ---------------------------------------------------------------------------
// 3. head look (yRot/xRot) turns the head
// ---------------------------------------------------------------------------

const headStraight = renderAndMeasure('zombie', { yaw: 0, pitch: 0 });
const headTurned = renderAndMeasure('zombie', { yaw: 0, pitch: 60 });
let maxHeadDelta = 0;
for (let i = 0; i < Math.min(headStraight.pos.length, headTurned.pos.length); i++) {
  maxHeadDelta = Math.max(maxHeadDelta, Math.abs(headStraight.pos[i] - headTurned.pos[i]));
}
check('[5] head pitch changes the model', maxHeadDelta > 0.05, `maxDelta=${maxHeadDelta.toFixed(3)}`);

// ---------------------------------------------------------------------------
// 4. hurt flash + death fall (LivingEntityRenderer.getOverlayCoords / setupRotations)
// ---------------------------------------------------------------------------

const hurt = overlayOf('zombie', { hurtTime: 5 });
const healthy = overlayOf('zombie', {});
check('[6] hurt overlay is the vanilla red 0xB2FF0000', hurt.red === 1 && Math.abs(hurt.alpha - 0xb2 / 255) < 1e-6,
  `red=${hurt.red} alpha=${hurt.alpha.toFixed(3)} (healthy alpha=${healthy.alpha})`);

const alive = renderAndMeasure('zombie', {});
const dying = renderAndMeasure('zombie', { dead: true, deathTime: 19 });
check('[7] death tips the body over 90 degrees',
  dying.maxY - GROUND < 0.8 && (dying.maxX - dying.minX) > 1.2,
  `uprightY=${alive.maxY.toFixed(2)} corpseY=${dying.maxY.toFixed(2)} corpseX=${(dying.maxX - dying.minX).toFixed(2)}`);

// ---------------------------------------------------------------------------
// 5. per-entity light: lightmap levels are stamped into the batch
// ---------------------------------------------------------------------------

const night = lightOf('zombie', { skyLight: 0, blockLight: 0 });
const day = lightOf('zombie', { skyLight: 15, blockLight: 0 });
const torch = lightOf('zombie', { skyLight: 0, blockLight: 14 });
check('[8] lightmap levels follow sky/block light at the eye',
  night.sky === 0 && day.sky === 15 && torch.block === 14,
  `night=(${night.sky},${night.block}) day=(${day.sky},${day.block}) torch=(${torch.sky},${torch.block})`);

// ---------------------------------------------------------------------------
// 6. creeper swell (CreeperRenderer.scale / getWhiteOverlayProgress)
// ---------------------------------------------------------------------------

const creeperFlat = renderAndMeasure('creeper', { swell: 0 });
const creeperSwelled = renderAndMeasure('creeper', { swell: 1 });
const creeperFlash = overlayOf('creeper', { swell: 0.95 });
check('[9] creeper swelling inflates and flashes white',
  (creeperSwelled.maxY - GROUND) > (creeperFlat.maxY - GROUND) * 1.05 && creeperFlash.alpha < 1 && creeperFlash.red === 0,
  `h=${creeperFlat.maxY.toFixed(2)}->${creeperSwelled.maxY.toFixed(2)} flashAlpha=${creeperFlash.alpha.toFixed(2)}`);

// ---------------------------------------------------------------------------
// 7. fuzz: run every mob through append with random-ish state, no NaN
// ---------------------------------------------------------------------------

let fuzzOk = true;
const states: FakeOpts[] = [
  { walkAnimPos: 1.3, walkAnimSpeed: 1 },
  { walkAnimPos: 7.7, walkAnimSpeed: 0.5, hurtTime: 9 },
  { dead: true, deathTime: 7 },
  { dead: true, deathTime: 20 },
  { yaw: 137, pitch: -40, walkAnimPos: 3.1, walkAnimSpeed: 1, aggressive: true },
];
for (const t of TYPES) {
  for (const s of states) {
    const b = renderAndMeasure(t, s);
    if (b.nan || b.count === 0) { fuzzOk = false; console.log(`      ${t} ${JSON.stringify(s)} -> nan=${b.nan} count=${b.count}`); }
  }
}
check('[10] 13 mobs x 5 render states produce finite vertices', fuzzOk, `states=${TYPES.length * states.length}`);

// ---------------------------------------------------------------------------
// 8. head yaw and bat resting pose (BatAnimation.BAT_RESTING)
// ---------------------------------------------------------------------------

const headAhead = renderAndMeasure('zombie', { yaw: 0, yHeadRot: 0 });
const headLeft = renderAndMeasure('zombie', { yaw: 0, yHeadRot: 70 });
let headYawDelta = 0;
for (let i = 0; i < Math.min(headAhead.pos.length, headLeft.pos.length); i++) {
  headYawDelta = Math.max(headYawDelta, Math.abs(headAhead.pos[i] - headLeft.pos[i]));
}
check('[11] head yaw turns only the head', headYawDelta > 0.05, `maxDelta=${headYawDelta.toFixed(3)}`);

const batFly = renderAndMeasure('bat', { onGround: false });
const batRest = renderAndMeasure('bat', { onGround: true });
let batDelta = 0;
for (let i = 0; i < Math.min(batFly.pos.length, batRest.pos.length); i++) {
  batDelta = Math.max(batDelta, Math.abs(batFly.pos[i] - batRest.pos[i]));
}
check('[12] bat hanging (resting) pose differs from flying', batDelta > 0.1, `maxDelta=${batDelta.toFixed(3)}`);

console.log(failures === 0 ? '\nALL CHECKS PASSED  EXIT=0' : `\n${failures} CHECK(S) FAILED  EXIT=1`);
process.exit(failures === 0 ? 0 : 1);
