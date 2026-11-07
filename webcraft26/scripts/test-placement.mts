// Node test for src/client/interaction/Placement.ts
//
//   npx tsx scripts/test-placement.mts
//
// Loads the shipped data pack with fs (no fetch), drives the vanilla block-placement rules against
// an in-memory fake level and asserts the resulting state properties for every block family the
// rules cover: plain blocks, stairs, slabs, logs, fences, walls, panes, doors, torches, beds,
// buttons/levers, trapdoors, carpets, snow layers, vegetation, two-block plants and the
// "cannot replace / cannot survive / obstructed" failure paths.

import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import { MinecraftData } from '../src/vanilla/world/level/block/state/BlockState.ts';
import { ClientLevel } from '../src/vanilla/world/level/ClientLevel.ts';
import { LevelChunk } from '../src/vanilla/world/level/chunk/LevelChunk.ts';
import {
  getPlacement,
  getPlacementState,
  placeBlock,
  orderedByNearest,
  type PlacementContext,
  type PlacementLevel,
} from '../src/client/interaction/Placement.ts';

// ---------------------------------------------------------------------------
// data pack
// ---------------------------------------------------------------------------

const here = path.dirname(fileURLToPath(import.meta.url));
const root = path.resolve(here, '..');

function readArrayBuffer(file: string): ArrayBuffer {
  const buf = fs.readFileSync(file);
  return buf.buffer.slice(buf.byteOffset, buf.byteOffset + buf.byteLength) as ArrayBuffer;
}

const blockMeta = JSON.parse(fs.readFileSync(path.join(root, 'public/mc/blocks.json'), 'utf8'));
const mc = new MinecraftData();
mc.initMeta(blockMeta);
mc.initBinary(readArrayBuffer(path.join(root, 'public/mc/blocks.bin')));

const DOWN = 0, UP = 1, NORTH = 2, SOUTH = 3, WEST = 4, EAST = 5;

// ---------------------------------------------------------------------------
// fake level
// ---------------------------------------------------------------------------

class FakeLevel implements PlacementLevel {
  private readonly map = new Map<string, number>();
  set(x: number, y: number, z: number, blockName: string, props: Record<string, string> = {}): number {
    const state = mc.stateOf(blockName, props);
    this.map.set(`${x},${y},${z}`, state);
    return state;
  }
  get(x: number, y: number, z: number): number { return this.map.get(`${x},${y},${z}`) ?? 0; }
  getBlockState(x: number, y: number, z: number): number { return this.get(x, y, z); }
  setBlockState(x: number, y: number, z: number, state: number): boolean {
    this.map.set(`${x},${y},${z}`, state);
    return true;
  }
  getMaxY(): number { return 320; }
}

/** Default world: a stone floor at y=-1 so right-clicking its top face places at y=0. */
function makeLevel(): FakeLevel {
  const level = new FakeLevel();
  level.set(0, -1, 0, 'stone');
  return level;
}

function clickCtx(level: FakeLevel, opts: Partial<PlacementContext> = {}): PlacementContext {
  const hit = level.get(0, -1, 0);
  return {
    x: 0,
    y: -1,
    z: 0,
    face: UP,
    hitX: 0.5,
    hitY: 0,
    hitZ: 0.5,
    yaw: 0,
    pitch: 0,
    heldBlockName: mc.blockOf(hit).item ?? 'stone',
    ...opts,
  };
}

function props(state: number): Record<string, string> {
  const meta = mc.blockOf(state);
  const out: Record<string, string> = {};
  for (const p of meta.props) out[p.name] = mc.getProp(state, p.name)!;
  return out;
}

// ---------------------------------------------------------------------------
// assertions
// ---------------------------------------------------------------------------

let pass = 0;
const failures: string[] = [];

function check(label: string, ok: boolean, detail = ''): void {
  if (ok) {
    pass++;
    console.log(`PASS ${label}`);
  } else {
    failures.push(detail ? `${label} (${detail})` : label);
    console.log(`FAIL ${label}${detail ? ` — ${detail}` : ''}`);
  }
}

function expectProps(label: string, got: Record<string, string>, want: Record<string, string>): void {
  for (const [k, v] of Object.entries(want)) {
    check(`${label}: ${k}=${v}`, got[k] === v, `got ${got[k]}`);
  }
}

function expectFail(label: string): void {
  check(`${label}: rejected`, plan === null, 'vanilla would place it');
}

let plan: ReturnType<typeof getPlacement> = null;

// ---------------------------------------------------------------------------
// 1. plain block + BlockPlaceContext target selection
// ---------------------------------------------------------------------------

{
  const level = makeLevel();
  plan = getPlacement(mc, level, 'stone', clickCtx(level, { heldBlockName: 'stone' }));
  check('stone: placed', plan !== null);
  if (plan) {
    check('stone: target position', plan.x === 0 && plan.y === 0 && plan.z === 0, `${plan.x},${plan.y},${plan.z}`);
    check('stone: block name', plan.blockName === 'stone', plan.blockName);
    check('stone: default state', plan.state === mc.stateOf('stone'));
    check('stone: no extras', plan.extras.length === 0);
  }
  // getPlacementState is the same primary state
  check('stone: getPlacementState matches', getPlacementState(mc, level, 'stone', clickCtx(level, { heldBlockName: 'stone' })) === (plan?.state ?? -1));
}

{
  // clicking a replaceable plant replaces it in place (BlockPlaceContext.getClickedPos)
  const level = makeLevel();
  level.set(0, 0, 0, 'short_grass');
  plan = getPlacement(mc, level, 'stone', clickCtx(level, {
    x: 0, y: 0, z: 0, face: UP, hitX: 0.5, hitY: 0.2, hitZ: 0.5, heldBlockName: 'stone',
  }));
  check('replaceable short_grass: placed', plan !== null);
  if (plan) check('replaceable short_grass: replaces clicked pos', plan.x === 0 && plan.y === 0 && plan.z === 0);
}

{
  // a flower is not replaceable: the block goes next to it
  const level = makeLevel();
  level.set(0, 0, 0, 'dandelion');
  plan = getPlacement(mc, level, 'stone', clickCtx(level, {
    x: 0, y: 0, z: 0, face: UP, hitX: 0.5, hitY: 0.2, hitZ: 0.5, heldBlockName: 'stone',
  }));
  check('non-replaceable flower: placed adjacent', plan !== null && plan.x === 0 && plan.y === 1 && plan.z === 0,
    plan ? `${plan.x},${plan.y},${plan.z}` : 'null');
}

{
  // occupied target -> reject
  const level = makeLevel();
  level.set(0, 0, 0, 'stone');
  level.set(0, 1, 0, 'stone');
  plan = getPlacement(mc, level, 'stone', clickCtx(level, { heldBlockName: 'stone' }));
  expectFail('stone onto occupied target');
}

{
  // entity obstruction (Level.isUnobstructed) rejects
  const level = makeLevel();
  plan = getPlacement(mc, level, 'stone', clickCtx(level, { heldBlockName: 'stone', isUnobstructed: () => false }));
  expectFail('stone blocked by entity');
}

// ---------------------------------------------------------------------------
// 2. stairs — facing/half/shape/waterlogged (StairBlock.java:97-108)
// ---------------------------------------------------------------------------

{
  const level = makeLevel();
  plan = getPlacement(mc, level, 'oak_stairs', clickCtx(level, { heldBlockName: 'oak_stairs', yaw: 0 }));
  check('stairs: placed', plan !== null);
  if (plan) {
    check('stairs: block', plan.blockName === 'oak_stairs');
    expectProps('stairs yaw=0', props(plan.state), {
      facing: 'south', half: 'bottom', shape: 'straight', waterlogged: 'false',
    });
  }
}

{
  const level = makeLevel();
  plan = getPlacement(mc, level, 'oak_stairs', clickCtx(level, { heldBlockName: 'oak_stairs', yaw: 90 }));
  if (plan) expectProps('stairs yaw=90', props(plan.state), { facing: 'east' });
  else check('stairs yaw=90: placed', false);
}

{
  // horizontal click in the upper half of the target column -> half=top
  const level = makeLevel();
  level.set(0, 0, 0, 'stone');
  plan = getPlacement(mc, level, 'oak_stairs', clickCtx(level, {
    x: 0, y: 0, z: 0, face: EAST, hitX: 1, hitY: 0.75, hitZ: 0.5, yaw: 0, heldBlockName: 'oak_stairs',
  }));
  check('stairs side-click: placed', plan !== null && plan.x === 1, plan ? `${plan.x},${plan.y},${plan.z}` : 'null');
  if (plan) expectProps('stairs side-click upper', props(plan.state), { half: 'top', facing: 'south' });
}

{
  // water at the target column -> waterlogged (replacedFluidState.is(WATER))
  const level = makeLevel();
  level.set(0, 0, 0, 'water');
  plan = getPlacement(mc, level, 'oak_stairs', clickCtx(level, { heldBlockName: 'oak_stairs' }));
  if (plan) expectProps('stairs waterlogged', props(plan.state), { waterlogged: 'true' });
  else check('stairs waterlogged: placed', false);
}

{
  // stairs next to a rotated stair behind -> outer_left (StairBlock.getStairsShape)
  const level = makeLevel();
  level.set(0, 0, 1, 'oak_stairs', { facing: 'east', half: 'bottom' });
  plan = getPlacement(mc, level, 'oak_stairs', clickCtx(level, { heldBlockName: 'oak_stairs', yaw: 0 }));
  if (plan) expectProps('stairs shape outer_left', props(plan.state), { shape: 'outer_left' });
  else check('stairs shape outer_left: placed', false);
}

{
  // stairs in front of a rotated stair -> inner_left
  const level = makeLevel();
  level.set(0, 0, -1, 'oak_stairs', { facing: 'east', half: 'bottom' });
  plan = getPlacement(mc, level, 'oak_stairs', clickCtx(level, { heldBlockName: 'oak_stairs', yaw: 0 }));
  if (plan) expectProps('stairs shape inner_left', props(plan.state), { shape: 'inner_left' });
  else check('stairs shape inner_left: placed', false);
}

// ---------------------------------------------------------------------------
// 3. slabs — type/double/waterlogged (SlabBlock.java:68-98)
// ---------------------------------------------------------------------------

{
  const level = makeLevel();
  plan = getPlacement(mc, level, 'oak_slab', clickCtx(level, { heldBlockName: 'oak_slab' }));
  if (plan) expectProps('slab top click', props(plan.state), { type: 'bottom', waterlogged: 'false' });
  else check('slab top click: placed', false);
}

{
  // horizontal click above the middle -> type=top
  const level = makeLevel();
  level.set(0, 0, 0, 'stone');
  plan = getPlacement(mc, level, 'oak_slab', clickCtx(level, {
    x: 0, y: 0, z: 0, face: EAST, hitX: 1, hitY: 0.7, hitZ: 0.5, heldBlockName: 'oak_slab',
  }));
  if (plan) expectProps('slab side-click upper', props(plan.state), { type: 'top' });
  else check('slab side-click upper: placed', false);
}

{
  // clicking a bottom slab with a slab -> double slab at the same position
  const level = makeLevel();
  level.set(0, 0, 0, 'oak_slab', { type: 'bottom' });
  plan = getPlacement(mc, level, 'oak_slab', clickCtx(level, { heldBlockName: 'oak_slab' }));
  check('slab double: placed at clicked pos', plan !== null && plan.x === 0 && plan.y === 0 && plan.z === 0);
  if (plan) expectProps('slab double', props(plan.state), { type: 'double', waterlogged: 'false' });
}

{
  const level = makeLevel();
  level.set(0, 0, 0, 'water');
  plan = getPlacement(mc, level, 'oak_slab', clickCtx(level, { heldBlockName: 'oak_slab' }));
  if (plan) expectProps('slab waterlogged', props(plan.state), { type: 'bottom', waterlogged: 'true' });
  else check('slab waterlogged: placed', false);
}

// ---------------------------------------------------------------------------
// 4. logs — axis from clicked face (RotatedPillarBlock.java:54-56)
// ---------------------------------------------------------------------------

{
  const level = makeLevel();
  plan = getPlacement(mc, level, 'oak_log', clickCtx(level, { heldBlockName: 'oak_log' }));
  if (plan) expectProps('log top click', props(plan.state), { axis: 'y' });
  else check('log top click: placed', false);
}

{
  // click the east face of a stone block -> target east, axis=x
  const level = makeLevel();
  level.set(0, 0, 0, 'stone');
  plan = getPlacement(mc, level, 'oak_log', clickCtx(level, {
    x: 0, y: 0, z: 0, face: EAST, hitX: 1, hitY: 0.5, hitZ: 0.5, heldBlockName: 'oak_log',
  }));
  if (plan) expectProps('log side click x', props(plan.state), { axis: 'x' });
  else check('log side click x: placed', false);
}

{
  // click the south face -> axis=z
  const level = makeLevel();
  level.set(0, 0, 0, 'stone');
  plan = getPlacement(mc, level, 'oak_log', clickCtx(level, {
    x: 0, y: 0, z: 0, face: SOUTH, hitX: 0.5, hitY: 0.5, hitZ: 1, heldBlockName: 'oak_log',
  }));
  if (plan) expectProps('log side click z', props(plan.state), { axis: 'z' });
  else check('log side click z: placed', false);
}

// ---------------------------------------------------------------------------
// 5. fences — neighbour connections (FenceBlock.java:78-96)
// ---------------------------------------------------------------------------

{
  const level = makeLevel();
  plan = getPlacement(mc, level, 'oak_fence', clickCtx(level, { heldBlockName: 'oak_fence' }));
  if (plan) expectProps('fence isolated', props(plan.state), {
    north: 'false', south: 'false', west: 'false', east: 'false', waterlogged: 'false',
  });
  else check('fence isolated: placed', false);
}

{
  const level = makeLevel();
  level.set(-1, 0, 0, 'stone');                 // solid west neighbour
  level.set(0, 0, -1, 'oak_fence');             // same wooden fence north
  level.set(1, 0, 0, 'nether_brick_fence');     // non-wooden fence east
  plan = getPlacement(mc, level, 'oak_fence', clickCtx(level, { heldBlockName: 'oak_fence' }));
  if (plan) expectProps('fence connections', props(plan.state), {
    west: 'true', north: 'true', east: 'false', south: 'false', waterlogged: 'false',
  });
  else check('fence connections: placed', false);
}

{
  // water in the target column -> waterlogged
  const level = makeLevel();
  level.set(0, 0, 0, 'water');
  plan = getPlacement(mc, level, 'oak_fence', clickCtx(level, { heldBlockName: 'oak_fence' }));
  if (plan) expectProps('fence waterlogged', props(plan.state), { waterlogged: 'true' });
  else check('fence waterlogged: placed', false);
}

// ---------------------------------------------------------------------------
// 6. walls — sides LOW/TALL + post (WallBlock.java:112-253)
// ---------------------------------------------------------------------------

{
  const level = makeLevel();
  plan = getPlacement(mc, level, 'cobblestone_wall', clickCtx(level, { heldBlockName: 'cobblestone_wall' }));
  if (plan) expectProps('wall isolated', props(plan.state), {
    north: 'none', south: 'none', west: 'none', east: 'none', up: 'true', waterlogged: 'false',
  });
  else check('wall isolated: placed', false);
}

{
  // solid blocks north + south, air above: sides low, no post
  const level = makeLevel();
  level.set(0, 0, -1, 'stone');
  level.set(0, 0, 1, 'stone');
  plan = getPlacement(mc, level, 'cobblestone_wall', clickCtx(level, { heldBlockName: 'cobblestone_wall' }));
  if (plan) expectProps('wall two low sides', props(plan.state), {
    north: 'low', south: 'low', east: 'none', west: 'none', up: 'false',
  });
  else check('wall two low sides: placed', false);
}

{
  // full block above covers the sides -> tall walls + raised post
  const level = makeLevel();
  level.set(0, 0, -1, 'stone');
  level.set(0, 1, 0, 'stone');
  plan = getPlacement(mc, level, 'cobblestone_wall', clickCtx(level, { heldBlockName: 'cobblestone_wall' }));
  if (plan) expectProps('wall tall side + post', props(plan.state), {
    north: 'tall', up: 'true',
  });
  else check('wall tall side + post: placed', false);
}

{
  // iron bars neighbour counts as a connection (WallBlock.connectsTo: block instanceof IronBarsBlock)
  const level = makeLevel();
  level.set(1, 0, 0, 'iron_bars');
  plan = getPlacement(mc, level, 'cobblestone_wall', clickCtx(level, { heldBlockName: 'cobblestone_wall' }));
  if (plan) expectProps('wall connects to bars', props(plan.state), { east: 'low' });
  else check('wall connects to bars: placed', false);
}

// ---------------------------------------------------------------------------
// 7. panes — attach rules (IronBarsBlock.java:37-55, 101-103)
// ---------------------------------------------------------------------------

{
  const level = makeLevel();
  plan = getPlacement(mc, level, 'iron_bars', clickCtx(level, { heldBlockName: 'iron_bars' }));
  if (plan) expectProps('pane isolated', props(plan.state), {
    north: 'false', south: 'false', west: 'false', east: 'false',
  });
  else check('pane isolated: placed', false);
}

{
  const level = makeLevel();
  level.set(1, 0, 0, 'stone');                 // solid east
  level.set(-1, 0, 0, 'iron_bars');            // bars west
  level.set(0, 0, 1, 'glass_pane');            // pane south
  level.set(0, 0, -1, 'cobblestone_wall');     // wall north (tags WALLS)
  plan = getPlacement(mc, level, 'iron_bars', clickCtx(level, { heldBlockName: 'iron_bars' }));
  if (plan) expectProps('pane attachments', props(plan.state), {
    east: 'true', west: 'true', south: 'true', north: 'true',
  });
  else check('pane attachments: placed', false);
}

// ---------------------------------------------------------------------------
// 8. doors — facing/hinge + two-block placement (DoorBlock.java:139-159, 160-197)
// ---------------------------------------------------------------------------

{
  const level = makeLevel();
  plan = getPlacement(mc, level, 'oak_door', clickCtx(level, { heldBlockName: 'oak_door', yaw: 0 }));
  check('door: placed', plan !== null);
  if (plan) {
    check('door: primary at target', plan.x === 0 && plan.y === 0 && plan.z === 0);
    expectProps('door lower', props(plan.state), {
      facing: 'south', half: 'lower', hinge: 'left', open: 'false', powered: 'false',
    });
    check('door: upper half extra', plan.extras.length === 1 && plan.extras[0].y === 1);
    if (plan.extras.length === 1) {
      expectProps('door upper', props(plan.extras[0].state), { half: 'upper', facing: 'south' });
    }
  }
}

{
  const level = makeLevel();
  plan = getPlacement(mc, level, 'oak_door', clickCtx(level, { heldBlockName: 'oak_door', yaw: 90 }));
  if (plan) expectProps('door yaw=90', props(plan.state), { facing: 'east' });
  else check('door yaw=90: placed', false);
}

{
  // hinge flips to the right when the solid block is on the right-hand side (DoorBlock.getHinge)
  const level = makeLevel();
  level.set(-1, 0, 0, 'stone'); // facing south -> clockwise/right is west
  plan = getPlacement(mc, level, 'oak_door', clickCtx(level, { heldBlockName: 'oak_door', yaw: 0 }));
  if (plan) expectProps('door hinge right', props(plan.state), { hinge: 'right', facing: 'south' });
  else check('door hinge right: placed', false);
}

{
  // no room for the upper half
  const level = makeLevel();
  level.set(0, 1, 0, 'stone');
  plan = getPlacement(mc, level, 'oak_door', clickCtx(level, { heldBlockName: 'oak_door' }));
  expectFail('door with occupied upper half');
}

{
  // placeBlock writes both halves
  const level = makeLevel();
  const placed = placeBlock(mc, level, 'oak_door', clickCtx(level, { heldBlockName: 'oak_door' }));
  check('door: placeBlock applied', placed !== null && mc.blockOf(level.get(0, 1, 0)).name === 'oak_door', mc.blockOf(level.get(0, 1, 0)).name);
}

// ---------------------------------------------------------------------------
// 9. torches — floor vs wall (TorchBlock/WallTorchBlock + StandingAndWallBlockItem)
// ---------------------------------------------------------------------------

{
  const level = makeLevel();
  plan = getPlacement(mc, level, 'torch', clickCtx(level, { heldBlockName: 'torch' }));
  check('torch floor: placed', plan !== null && plan.blockName === 'torch' && plan.y === 0,
    plan ? `${plan.blockName}@${plan.x},${plan.y},${plan.z}` : 'null');
}

{
  // clicking the south face of a block puts a wall torch attached to it, facing south
  const level = makeLevel();
  level.set(0, 0, 0, 'stone');
  plan = getPlacement(mc, level, 'torch', clickCtx(level, {
    x: 0, y: 0, z: 0, face: SOUTH, hitX: 0.5, hitY: 0.5, hitZ: 1, heldBlockName: 'torch',
  }));
  check('torch wall: placed', plan !== null && plan.blockName === 'wall_torch' && plan.z === 1,
    plan ? `${plan.blockName}@${plan.x},${plan.y},${plan.z}` : 'null');
  if (plan) expectProps('torch wall facing', props(plan.state), { facing: 'south' });
}

{
  // CENTER support: torches sit on fence posts (SupportType.CENTER, not FULL face)
  const level = makeLevel();
  level.set(0, -1, 0, 'oak_fence');
  plan = getPlacement(mc, level, 'torch', clickCtx(level, { heldBlockName: 'torch' }));
  check('torch on fence post: placed', plan !== null && plan.blockName === 'torch',
    plan ? plan.blockName : 'null');
}

{
  // no support: top of a bottom slab has no CENTER support and there is no wall to attach to
  const level = makeLevel();
  level.set(0, -1, 0, 'oak_slab', { type: 'bottom' });
  plan = getPlacement(mc, level, 'torch', clickCtx(level, { heldBlockName: 'torch' }));
  expectFail('torch on bottom slab');
}

{
  // redstone torch uses the same standing/wall item logic
  const level = makeLevel();
  level.set(0, 0, 0, 'stone');
  plan = getPlacement(mc, level, 'redstone_torch', clickCtx(level, {
    x: 0, y: 0, z: 0, face: WEST, hitX: 0, hitY: 0.5, hitZ: 0.5, heldBlockName: 'redstone_torch',
  }));
  check('redstone torch wall variant', plan !== null && plan.blockName === 'redstone_wall_torch',
    plan ? plan.blockName : 'null');
}

// ---------------------------------------------------------------------------
// 10. beds — facing + two-block placement (BedBlock.java:177-185, 272-276)
// ---------------------------------------------------------------------------

{
  const level = makeLevel();
  plan = getPlacement(mc, level, 'red_bed', clickCtx(level, { heldBlockName: 'red_bed', yaw: 0 }));
  check('bed: placed', plan !== null);
  if (plan) {
    expectProps('bed foot', props(plan.state), { facing: 'south', part: 'foot' });
    check('bed: head extra', plan.extras.length === 1 && plan.extras[0].y === 0 && plan.extras[0].z === 1,
      plan.extras.length === 1 ? `${plan.extras[0].x},${plan.extras[0].y},${plan.extras[0].z}` : 'no extras');
    if (plan.extras.length === 1) expectProps('bed head', props(plan.extras[0].state), { part: 'head', facing: 'south' });
  }
}

{
  // head position occupied
  const level = makeLevel();
  level.set(0, 0, 1, 'stone');
  plan = getPlacement(mc, level, 'red_bed', clickCtx(level, { heldBlockName: 'red_bed' }));
  expectFail('bed with occupied head position');
}

// ---------------------------------------------------------------------------
// 11. buttons / levers — face/facing (FaceAttachedHorizontalDirectionalBlock.java:38-55)
// ---------------------------------------------------------------------------

{
  const level = makeLevel();
  plan = getPlacement(mc, level, 'stone_button', clickCtx(level, { heldBlockName: 'stone_button' }));
  if (plan) expectProps('button floor', props(plan.state), { face: 'floor', facing: 'south', powered: 'false' });
  else check('button floor: placed', false);
}

{
  // ceiling: click the down face of a block above
  const level = makeLevel();
  level.set(0, 1, 0, 'stone');
  level.set(0, -1, 0, 'air');
  plan = getPlacement(mc, level, 'lever', clickCtx(level, {
    x: 0, y: 1, z: 0, face: DOWN, hitX: 0.5, hitY: 1, hitZ: 0.5, heldBlockName: 'lever',
  }));
  if (plan) expectProps('lever ceiling', props(plan.state), { face: 'ceiling', facing: 'south' });
  else check('lever ceiling: placed', false);
}

{
  // wall-mounted button on the east face of a block
  const level = makeLevel();
  level.set(0, 0, 0, 'stone');
  plan = getPlacement(mc, level, 'stone_button', clickCtx(level, {
    x: 0, y: 0, z: 0, face: EAST, hitX: 1, hitY: 0.5, hitZ: 0.5, heldBlockName: 'stone_button',
  }));
  if (plan) expectProps('button wall', props(plan.state), { face: 'wall', facing: 'east' });
  else check('button wall: placed', false);
}

{
  // nothing sturdy to attach to: the clicked block is a bottom slab, whose top face is not
  // a full sturdy face (SupportType.FULL), and the surrounding air is no help either
  const level = makeLevel();
  level.set(0, 0, 0, 'oak_slab', { type: 'bottom' });
  plan = getPlacement(mc, level, 'lever', clickCtx(level, {
    x: 0, y: 0, z: 0, face: UP, hitX: 0.5, hitY: 0.5, hitZ: 0.5, heldBlockName: 'lever',
  }));
  expectFail('lever without sturdy support');
}

// ---------------------------------------------------------------------------
// 12. trapdoors — facing/half/waterlogged (TrapDoorBlock.java:146-162)
// ---------------------------------------------------------------------------

{
  const level = makeLevel();
  plan = getPlacement(mc, level, 'oak_trapdoor', clickCtx(level, { heldBlockName: 'oak_trapdoor', yaw: 0 }));
  if (plan) expectProps('trapdoor top click', props(plan.state), {
    facing: 'north', half: 'bottom', open: 'false', waterlogged: 'false',
  });
  else check('trapdoor top click: placed', false);
}

{
  const level = makeLevel();
  level.set(0, 0, 0, 'stone');
  plan = getPlacement(mc, level, 'oak_trapdoor', clickCtx(level, {
    x: 0, y: 0, z: 0, face: EAST, hitX: 1, hitY: 0.7, hitZ: 0.5, heldBlockName: 'oak_trapdoor',
  }));
  if (plan) expectProps('trapdoor side click', props(plan.state), { facing: 'east', half: 'top' });
  else check('trapdoor side click: placed', false);
}

// ---------------------------------------------------------------------------
// 13. carpet + snow layer
// ---------------------------------------------------------------------------

{
  const level = makeLevel();
  plan = getPlacement(mc, level, 'white_carpet', clickCtx(level, { heldBlockName: 'white_carpet' }));
  check('carpet: placed', plan !== null, 'null');
}

{
  const level = makeLevel();
  level.set(0, 1, 0, 'stone');
  level.set(0, -1, 0, 'air'); // nothing below the target -> carpet cannot survive
  plan = getPlacement(mc, level, 'white_carpet', clickCtx(level, {
    x: 0, y: 1, z: 0, face: DOWN, hitX: 0.5, hitY: 1, hitZ: 0.5, heldBlockName: 'white_carpet',
  }));
  expectFail('carpet without support below');
}

{
  const level = makeLevel();
  plan = getPlacement(mc, level, 'snow', clickCtx(level, { heldBlockName: 'snow' }));
  if (plan) expectProps('snow layer 1', props(plan.state), { layers: '1' });
  else check('snow layer 1: placed', false);
}

{
  // adding snow onto an existing layer increments LAYERS (SnowLayerBlock.java:123-131)
  const level = makeLevel();
  level.set(0, 0, 0, 'snow', { layers: '1' });
  plan = getPlacement(mc, level, 'snow', clickCtx(level, { heldBlockName: 'snow' }));
  if (plan) {
    check('snow increment: same pos', plan.x === 0 && plan.y === 0 && plan.z === 0);
    expectProps('snow increment', props(plan.state), { layers: '2' });
  } else check('snow increment: placed', false);
}

{
  // snow cannot sit on a bottom slab (Block.isFaceFull(belowShape, UP) fails)
  const level = makeLevel();
  level.set(0, -1, 0, 'oak_slab', { type: 'bottom' });
  plan = getPlacement(mc, level, 'snow', clickCtx(level, { heldBlockName: 'snow' }));
  expectFail('snow on bottom slab');
}

// ---------------------------------------------------------------------------
// 14. vegetation — supports_vegetation tag, two-block plants
// ---------------------------------------------------------------------------

{
  const level = makeLevel();
  level.set(0, -1, 0, 'dirt');
  plan = getPlacement(mc, level, 'short_grass', clickCtx(level, { heldBlockName: 'short_grass' }));
  check('short_grass on dirt: placed', plan !== null);
}
{
  const level = makeLevel(); // stone floor
  plan = getPlacement(mc, level, 'short_grass', clickCtx(level, { heldBlockName: 'short_grass' }));
  expectFail('short_grass on stone');
}
{
  const level = makeLevel();
  level.set(0, -1, 0, 'dirt');
  plan = getPlacement(mc, level, 'dandelion', clickCtx(level, { heldBlockName: 'dandelion' }));
  check('flower on dirt: placed', plan !== null);
}
{
  const level = makeLevel();
  level.set(0, -1, 0, 'snow'); // not a vegetation support block
  plan = getPlacement(mc, level, 'dandelion', clickCtx(level, { heldBlockName: 'dandelion' }));
  expectFail('flower on snow');
}
{
  const level = makeLevel();
  level.set(0, -1, 0, 'dirt');
  plan = getPlacement(mc, level, 'tall_grass', clickCtx(level, { heldBlockName: 'tall_grass' }));
  check('tall_grass: placed with upper half', plan !== null && plan.extras.length === 1 && plan.extras[0].y === 1,
    plan ? `extras=${plan.extras.length}` : 'null');
  if (plan && plan.extras.length === 1) expectProps('tall_grass upper', props(plan.extras[0].state), { half: 'upper' });
}
{
  const level = makeLevel();
  level.set(0, -1, 0, 'dirt');
  level.set(0, 1, 0, 'stone');
  plan = getPlacement(mc, level, 'tall_grass', clickCtx(level, { heldBlockName: 'tall_grass' }));
  expectFail('tall_grass with occupied upper half');
}

// ---------------------------------------------------------------------------
// 15. canPlaceAt + orderedByNearest
// ---------------------------------------------------------------------------

{
  check('orderedByNearest yaw=0 pitch=0 -> south',
    orderedByNearest(0, 0)[0] === SOUTH, String(orderedByNearest(0, 0)[0]));
  check('orderedByNearest yaw=90 -> east', orderedByNearest(90, 0)[0] === EAST, String(orderedByNearest(90, 0)[0]));
  check('orderedByNearest yaw=270 -> west', orderedByNearest(270, 0)[0] === WEST, String(orderedByNearest(270, 0)[0]));
  check('orderedByNearest look down -> down', orderedByNearest(0, 90)[0] === DOWN, String(orderedByNearest(0, 90)[0]));
}

// ---------------------------------------------------------------------------
// 16. integration with the real ClientLevel (the class Game passes as placement level)
// ---------------------------------------------------------------------------

{
  // The fake level above proves the rules; this proves the structural contract with ClientLevel
  // (getBlockState/setBlockState/minY/height) that Game.useItem now passes in.
  const level = new ClientLevel(mc, null, 1n);
  level.addChunk(new LevelChunk(0, 0, level.minY, level.height, mc));
  const floorY = 63;
  level.setBlockState(0, floorY, 0, mc.stateOf('stone'));
  const ctx: PlacementContext = {
    x: 0, y: floorY, z: 0, face: UP, hitX: 0.5, hitY: floorY + 1, hitZ: 0.5,
    yaw: 0, pitch: 0, heldBlockName: 'oak_door',
  };
  const plan = placeBlock(mc, level, 'oak_door', ctx);
  check('ClientLevel: door plan', plan !== null);
  if (plan) {
    check('ClientLevel: lower half written', level.getBlockState(0, floorY + 1, 0) === plan.state,
      `${level.getBlockState(0, floorY + 1, 0)} != ${plan.state}`);
    check('ClientLevel: upper half written',
      mc.blockOf(level.getBlockState(0, floorY + 2, 0)).name === 'oak_door',
      mc.blockOf(level.getBlockState(0, floorY + 2, 0)).name);
    check('ClientLevel: chunk dirtied', level.hasUnsavedChanges(0, 0));
  }
}

// ---------------------------------------------------------------------------
// summary
// ---------------------------------------------------------------------------

console.log('');
console.log(`Total: ${pass} PASS, ${failures.length} FAIL`);
if (failures.length > 0) {
  console.log('Failed:');
  for (const f of failures) console.log('  - ' + f);
  process.exitCode = 1;
}
