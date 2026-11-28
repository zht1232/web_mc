// Vanilla block-placement rules, ported from the 26.2 decompiled sources so the client places
// blocks exactly like the real game. Pure functions: no DOM, no GL, no fetch — the node test
// (scripts/test-placement.mts) drives it with a fake level.
//
// Sources (all under src-vanilla/net/minecraft):
//   world/item/BlockItem.java                    place() >= getPlacementState() >= canPlace()
//   world/item/context/BlockPlaceContext.java    replaceClicked / getClickedPos / canPlace
//   world/item/context/UseOnContext.java         getClickLocation / getHorizontalDirection
//   world/item/StandingAndWallBlockItem.java     torch/skull floor<->wall selection
//   world/level/block/Block.java                 getStateForPlacement default, isExceptionForConnection,
//                                                canSupportCenter
//   world/level/block/state/BlockBehaviour.java  canBeReplaced default / canSurvive default
//   world/level/block/{Stair,Slab,RotatedPillar,Fence,Wall,IronBars,Door,TrapDoor,Bed,Button,Lever,
//                      Torch,WallTorch,Carpet,SnowLayer,Vegetation,Flower,DoublePlant,Bush,
//                      DryVegetation,Ladder,FenceGate}Block.java
//   core/Direction.java                          orderedByNearest / fromYRot / getStep*
//   world/phys/shapes/{VoxelShape,CollisionGetter,EntityGetter,SupportType}.java
//   Block tags: data/minecraft/tags/block/** (mirrored in public/mc/tags.json)
//
// Coordinate conventions used by the caller (Game.ts):
//   ctx.x/y/z        = clicked block position  (BlockHitResult.getBlockPos)
//   ctx.face         = clicked face, Direction 3D data value 0..5 (DOWN,UP,NORTH,SOUTH,WEST,EAST)
//   ctx.hitX/Y/Z     = exact ray hit point in world space (BlockHitResult.getLocation)
//   ctx.yaw          = Game.player.yaw as stored by this project: 0 looks towards +Z (south) and the
//                      camera basis is [sin(yaw), 0, cos(yaw)] (Gl.cameraBasis). Vanilla's getYRot is
//                      the negated value, so vanillaYaw = -ctx.yaw everywhere below.
//   ctx.pitch        = Game.player.pitch (positive looks down, same sign as vanilla getXRot)
//   ctx.heldBlockName= block of the held item (mc.items[...].block), e.g. "torch" or "oak_stairs"

import { MinecraftData, type BlockMeta, type PropertyDef } from '../../vanilla/world/level/block/state/BlockState.js';
import { DIRS, DIR_BY_NAME, fromYRot } from '../../vanilla/core/Direction.js';

// ---------------------------------------------------------------------------------------------
// Direction constants (vanilla 3D data value order)
// ---------------------------------------------------------------------------------------------

const DOWN = 0;
const UP = 1;
const NORTH = 2;
const SOUTH = 3;
const WEST = 4;
const EAST = 5;
const OPPOSITE = [UP, DOWN, SOUTH, NORTH, EAST, WEST];
const AXIS_NAMES = ['x', 'y', 'z'] as const;
const HORIZONTALS = [NORTH, SOUTH, WEST, EAST] as const;
const DEG = Math.PI / 180;

function opposite(d: number): number { return OPPOSITE[d]; }
function axisOf(d: number): number { return DIRS[d].axis; }
function isHorizontal(d: number): boolean { return axisOf(d) !== 1; }
function sideName(d: number): string { return DIRS[d].name; }
function step(d: number): [number, number, number] { const i = DIRS[d]; return [i.stepX, i.stepY, i.stepZ]; }

/** Vanilla Direction.fromYRot(-getYRot) — the horizontal direction a player looks at. */
function horizontalDirection(yaw: number): number { return fromYRot(-yaw); }

/**
 * Vanilla Direction.orderedByNearest(Entity) (Direction.java:86-115).
 * The source computes `yaw = -getViewYRot() * DEG`, so passing this project's yaw
 * (which already equals -getYRot) reproduces it verbatim.
 */
export function orderedByNearest(yaw: number, pitch: number): number[] {
  const p = pitch * DEG;
  const w = yaw * DEG;
  const ps = Math.sin(p);
  const pc = Math.cos(p);
  const ys = Math.sin(w);
  const yc = Math.cos(w);
  const xPos = ys > 0;
  const yPos = ps < 0;
  const zPos = yc > 0;
  const xYaw = xPos ? ys : -ys;
  const yMag = yPos ? -ps : ps;
  const zYaw = zPos ? yc : -yc;
  const xMag = xYaw * pc;
  const zMag = zYaw * pc;
  const axisX = xPos ? EAST : WEST;
  const axisY = yPos ? UP : DOWN;
  const axisZ = zPos ? SOUTH : NORTH;
  if (xYaw > zYaw) {
    if (yMag > xMag) return makeDirectionArray(axisY, axisX, axisZ);
    return zMag > yMag ? makeDirectionArray(axisX, axisZ, axisY) : makeDirectionArray(axisX, axisY, axisZ);
  }
  if (yMag > zMag) return makeDirectionArray(axisY, axisZ, axisX);
  return xMag > yMag ? makeDirectionArray(axisZ, axisX, axisY) : makeDirectionArray(axisZ, axisY, axisX);
}

function makeDirectionArray(a: number, b: number, c: number): number[] {
  return [a, b, c, opposite(c), opposite(b), opposite(a)];
}

// ---------------------------------------------------------------------------------------------
// Public types
// ---------------------------------------------------------------------------------------------

/** Just the block access the rules need; ClientLevel satisfies this structurally. */
export interface PlacementLevel {
  getBlockState(x: number, y: number, z: number): number;
  setBlockState(x: number, y: number, z: number, state: number): boolean | void;
  /** vanilla Level.getMaxY(): ClientLevel exposes minY/height instead. */
  getMaxY?(): number;
  minY?: number;
  height?: number;
  /** vanilla Level.getWorldBorder().isWithinBounds — only beds ask for it. */
  isWithinBounds?(x: number, y: number, z: number): boolean;
}

export interface PlacementContext {
  /** clicked block position (BlockHitResult.getBlockPos) */
  x: number;
  y: number;
  z: number;
  /** clicked face, vanilla Direction.get3DDataValue: 0=down 1=up 2=north 3=south 4=west 5=east */
  face: number;
  /** exact hit point in world space (BlockHitResult.getLocation) */
  hitX: number;
  hitY: number;
  hitZ: number;
  /** Game.player.yaw (0 = looking +Z / south, degrees) */
  yaw: number;
  /** Game.player.pitch (degrees, positive = down) */
  pitch: number;
  /** block id of the held item, e.g. "torch"/"oak_stairs"; used for replace rules */
  heldBlockName: string;
  /**
   * vanilla Level.isUnobstructed(state, pos, CollisionContext.placementContext(player)):
   * false when an entity (including the placing player) overlaps the candidate collision shape.
   * Optional: when omitted the check passes (the node tests have no entities).
   */
  isUnobstructed?(state: number, x: number, y: number, z: number): boolean;
  /** vanilla Level.hasNeighborSignal; client redstone is not simulated, so default false. */
  hasNeighborSignal?(x: number, y: number, z: number): boolean;
}

export interface PlacedBlock {
  blockName: string;
  state: number;
  x: number;
  y: number;
  z: number;
}

export interface BlockPlacement {
  /** the block whose state getStateForPlacement returned (primary block, e.g. wall_torch) */
  blockName: string;
  state: number;
  x: number;
  y: number;
  z: number;
  /** extra blocks placed by Block.setPlacedBy (door upper half, bed head, tall plant upper half) */
  extras: PlacedBlock[];
}

// ---------------------------------------------------------------------------------------------
// Data tables copied from the vanilla data pack (public/mc/tags.json, read-only)
// ---------------------------------------------------------------------------------------------

/** Content of data/minecraft/tags/block/replaceable.json — matches Blocks.java `.replaceable()`. */
const REPLACEABLE = new Set([
  'air', 'water', 'lava', 'short_grass', 'fern', 'dead_bush', 'bush', 'short_dry_grass',
  'tall_dry_grass', 'seagrass', 'tall_seagrass', 'fire', 'soul_fire', 'snow', 'vine', 'glow_lichen',
  'resin_clump', 'light', 'tall_grass', 'large_fern', 'structure_void', 'void_air', 'cave_air',
  'bubble_column', 'warped_roots', 'nether_sprouts', 'crimson_roots', 'leaf_litter', 'hanging_roots',
]);

/** data/minecraft/tags/block/supports_vegetation.json (VegetationBlock.mayPlaceOn). */
const SUPPORTS_VEGETATION = new Set([
  'dirt', 'coarse_dirt', 'rooted_dirt', 'mud', 'muddy_mangrove_roots', 'moss_block',
  'pale_moss_block', 'grass_block', 'podzol', 'mycelium', 'farmland',
]);

/** data/minecraft/tags/block/supports_dry_vegetation.json (DryVegetationBlock.mayPlaceOn). */
const SUPPORTS_DRY_VEGETATION = new Set([
  'sand', 'red_sand', 'suspicious_sand', 'terracotta', 'white_terracotta', 'orange_terracotta',
  'magenta_terracotta', 'light_blue_terracotta', 'yellow_terracotta', 'lime_terracotta',
  'pink_terracotta', 'gray_terracotta', 'light_gray_terracotta', 'cyan_terracotta',
  'purple_terracotta', 'blue_terracotta', 'brown_terracotta', 'green_terracotta',
  'red_terracotta', 'black_terracotta', 'dirt', 'coarse_dirt', 'rooted_dirt', 'mud',
  'muddy_mangrove_roots', 'moss_block', 'pale_moss_block', 'grass_block', 'podzol', 'mycelium',
  'farmland',
]);

/** data/minecraft/tags/block/cannot_support_snow_layer.json */
const CANNOT_SUPPORT_SNOW_LAYER = new Set(['ice', 'packed_ice', 'barrier']);
/** data/minecraft/tags/block/support_override_snow_layer.json */
const SUPPORT_OVERRIDE_SNOW_LAYER = new Set(['honey_block', 'soul_sand', 'mud']);
/** data/minecraft/tags/block/shulker_boxes.json (only the tag members that exist as blocks). */
const SHULKER_BOXES = new Set([
  'shulker_box', 'white_shulker_box', 'orange_shulker_box', 'magenta_shulker_box',
  'light_blue_shulker_box', 'yellow_shulker_box', 'lime_shulker_box', 'pink_shulker_box',
  'gray_shulker_box', 'light_gray_shulker_box', 'cyan_shulker_box', 'purple_shulker_box',
  'blue_shulker_box', 'brown_shulker_box', 'green_shulker_box', 'red_shulker_box',
  'black_shulker_box',
]);
/** data/minecraft/tags/block/wall_post_override.json: blocks whose collision lets a wall post rise. */
const WALL_POST_OVERRIDE = new Set([
  'torch', 'soul_torch', 'redstone_torch', 'copper_torch', 'tripwire', 'cactus_flower',
  'light_weighted_pressure_plate', 'heavy_weighted_pressure_plate',
  'stone_pressure_plate', 'polished_blackstone_pressure_plate',
  'oak_pressure_plate', 'spruce_pressure_plate', 'birch_pressure_plate', 'jungle_pressure_plate',
  'acacia_pressure_plate', 'dark_oak_pressure_plate', 'pale_oak_pressure_plate',
  'crimson_pressure_plate', 'warped_pressure_plate', 'mangrove_pressure_plate',
  'bamboo_pressure_plate', 'cherry_pressure_plate',
]);
/** data/minecraft/tags/block/leaves.json + every other LeavesBlock subclass seen in blocks.json. */
function isLeavesBlock(meta: BlockMeta): boolean {
  return meta.cls.endsWith('LeavesBlock');
}
/** Exceptions in Block.isExceptionForConnection (Block.java:251-259). */
const CONNECTION_EXCEPTIONS = new Set(['barrier', 'carved_pumpkin', 'jack_o_lantern', 'melon', 'pumpkin']);

/** Block classes that behave like IronBarsBlock for connection purposes (GlassPaneBlock etc.). */
const PANE_CLASSES = new Set(['IronBarsBlock', 'StainedGlassPaneBlock', 'WeatheringCopperBarsBlock']);

/** Floor-torch items use StandingAndWallBlockItem: item block -> wall variant (Items.java). */
const WALL_VARIANTS: Record<string, string> = {
  torch: 'wall_torch',
  soul_torch: 'soul_wall_torch',
  copper_torch: 'copper_wall_torch',
  redstone_torch: 'redstone_wall_torch',
};

// ---------------------------------------------------------------------------------------------
// Small helpers over MinecraftData
// ---------------------------------------------------------------------------------------------

const EPS = 1e-4;

function metaOf(mc: MinecraftData, name: string): BlockMeta | undefined {
  const id = mc.blockByName.get(name);
  return id === undefined ? undefined : mc.blocks[id];
}

function nameOf(mc: MinecraftData, state: number): string { return mc.blockOf(state).name; }

function blockOfState(mc: MinecraftData, state: number): BlockMeta { return mc.blockOf(state); }

function hasProp(meta: BlockMeta, name: string): boolean { return meta.props.some((p: PropertyDef) => p.name === name); }

function propValue(mc: MinecraftData, state: number, name: string): string | undefined { return mc.getProp(state, name); }

function set(mc: MinecraftData, state: number, name: string, value: string): number {
  return mc.withProp(state, name, value);
}

function setAll(mc: MinecraftData, state: number, values: Record<string, string>): number {
  let out = state;
  for (const [k, v] of Object.entries(values)) out = set(mc, out, k, v);
  return out;
}

function isAirState(mc: MinecraftData, state: number): boolean { return mc.isAir(state); }

function isWaterState(mc: MinecraftData, state: number): boolean {
  const meta = blockOfState(mc, state);
  if (meta.name === 'water') return true;
  return mc.getProp(state, 'waterlogged') === 'true';
}

function isSameBlock(mc: MinecraftData, a: number, b: string): boolean { return blockOfState(mc, a).name === b; }

function soundIsWood(meta: BlockMeta): boolean { return meta.sound.includes('.wood.'); }

function isFenceBlock(meta: BlockMeta): boolean { return meta.cls === 'FenceBlock'; }
function isWallBlock(meta: BlockMeta): boolean { return meta.cls === 'WallBlock'; }
function isPaneBlock(meta: BlockMeta): boolean { return PANE_CLASSES.has(meta.cls); }
function isStairsBlock(meta: BlockMeta): boolean { return meta.cls.endsWith('StairBlock') || (hasProp(meta, 'shape') && hasProp(meta, 'half') && hasProp(meta, 'facing')); }
function isDoorBlock(meta: BlockMeta): boolean {
  // NB: "TrapDoorBlock".endsWith("DoorBlock") is true — exclude trapdoors explicitly.
  return meta.cls.endsWith('DoorBlock') && !meta.cls.endsWith('TrapDoorBlock');
}

function levelMaxY(level: PlacementLevel): number {
  if (typeof level.getMaxY === 'function') return level.getMaxY();
  if (typeof level.minY === 'number' && typeof level.height === 'number') return level.minY + level.height;
  return 320; // vanilla overworld top
}

function isExceptionForConnection(mc: MinecraftData, state: number): boolean {
  const meta = blockOfState(mc, state);
  return isLeavesBlock(meta) || CONNECTION_EXCEPTIONS.has(meta.name) || SHULKER_BOXES.has(meta.name);
}

/** BlockState.isCollisionShapeFullBlock: the collision shape is the full unit cube. */
function isFullCollision(mc: MinecraftData, state: number): boolean {
  return shapeCoversCube(mc.collision(state));
}

function shapeCoversCube(boxes: { minX: number; minY: number; minZ: number; maxX: number; maxY: number; maxZ: number }[]): boolean {
  if (boxes.length === 0) return false;
  // Sample the unit cube; a union of boxes counts as full when every sample is covered.
  const N = 4;
  for (let i = 0; i < N; i++) {
    for (let j = 0; j < N; j++) {
      for (let k = 0; k < N; k++) {
        const x = (i + 0.5) / N;
        const y = (j + 0.5) / N;
        const z = (k + 0.5) / N;
        let hit = false;
        for (const b of boxes) {
          if (x >= b.minX - EPS && x <= b.maxX + EPS && y >= b.minY - EPS && y <= b.maxY + EPS && z >= b.minZ - EPS && z <= b.maxZ + EPS) { hit = true; break; }
        }
        if (!hit) return false;
      }
    }
  }
  return true;
}

/**
 * SupportType.CENTER for direction UP (Block.canSupportCenter, used by torches):
 * the block below must have a top-face footprint covering the 2x2 centre column.
 */
function centerSupportsUp(mc: MinecraftData, belowState: number): boolean {
  if (mc.isFaceSturdy(belowState, UP)) return true;
  const sx = 7 / 16;
  const ex = 9 / 16;
  for (const b of mc.collision(belowState)) {
    if (b.maxY >= 1 - EPS && b.minX <= sx + EPS && b.maxX >= ex - EPS && b.minZ <= sx + EPS && b.maxZ >= ex - EPS) return true;
  }
  return false;
}

/**
 * VoxelShape.getFaceShape(Direction.DOWN) coverage test: does the block above cover the given
 * local x/z rectangle with collision boxes that touch its down face? (WallBlock.topUpdate.)
 */
function downFaceCovers(aboveState: number, mc: MinecraftData, rect: [number, number, number, number]): boolean {
  const boxes = mc.collision(aboveState).filter((b) => b.minY <= EPS);
  if (boxes.length === 0) return false;
  const [x0, z0, x1, z1] = rect;
  const N = 5;
  for (let i = 0; i < N; i++) {
    for (let j = 0; j < N; j++) {
      const x = x0 + ((i + 0.5) / N) * (x1 - x0);
      const z = z0 + ((j + 0.5) / N) * (z1 - z0);
      let hit = false;
      for (const b of boxes) {
        if (x >= b.minX - EPS && x <= b.maxX + EPS && z >= b.minZ - EPS && z <= b.maxZ + EPS) { hit = true; break; }
      }
      if (!hit) return false;
    }
  }
  return true;
}

/** WallBlock test shapes (WallBlock.java:46-47, Block.boxZ(2,16,0,9) rotated per side). */
const CENTER = 8 / 16;
const POST_RECT: [number, number, number, number] = [7 / 16, 7 / 16, 9 / 16, 9 / 16];
const WALL_SIDE_RECTS: Record<number, [number, number, number, number]> = {
  [NORTH]: [7 / 16, 0, 9 / 16, 9 / 16],
  [SOUTH]: [7 / 16, 7 / 16, 9 / 16, 1],
  [WEST]: [0, 7 / 16, 9 / 16, 9 / 16],
  [EAST]: [7 / 16, 7 / 16, 1, 9 / 16],
};

// ---------------------------------------------------------------------------------------------
// BlockPlaceContext port
// ---------------------------------------------------------------------------------------------

interface Pos { x: number; y: number; z: number; }

interface PlacementSession {
  mc: MinecraftData;
  level: PlacementLevel;
  /** the block being placed (already resolved from the held item, e.g. torch -> wall_torch for walls) */
  held: string;
  face: number;
  click: Pos;
  clicked: Pos;
  relative: Pos;
  replaceClicked: boolean;
  yaw: number;
  pitch: number;
  isUnobstructed?: (state: number, x: number, y: number, z: number) => boolean;
  hasNeighborSignal?: (x: number, y: number, z: number) => boolean;
}

function sessionPos(s: PlacementSession): Pos { return s.replaceClicked ? s.clicked : s.relative; }

/** Vanilla BlockPlaceContext.canPlace(). */
function contextCanPlace(s: PlacementSession): boolean {
  if (s.replaceClicked) return true;
  const pos = s.relative;
  return stateCanBeReplaced(s, s.level.getBlockState(pos.x, pos.y, pos.z), pos);
}

/** Vanilla BlockPlaceContext.getNearestLookingDirections(). */
function nearestLookingDirections(s: PlacementSession): number[] {
  const dirs = orderedByNearest(s.yaw, s.pitch);
  if (s.replaceClicked) return dirs;
  const front = opposite(s.face);
  const index = dirs.indexOf(front);
  if (index > 0) {
    dirs.splice(index, 1);
    dirs.unshift(front);
  }
  return dirs;
}

/** Vanilla BlockState.canBeReplaced(BlockPlaceContext) with all the block overrides we support. */
function stateCanBeReplaced(s: PlacementSession, state: number, posForSlab: Pos): boolean {
  const mc = s.mc;
  const meta = blockOfState(mc, state);
  if (meta.cls.endsWith('SlabBlock') && hasProp(meta, 'type')) return slabCanBeReplaced(s, state, posForSlab);
  if (meta.cls === 'SnowLayerBlock') return snowLayerCanBeReplaced(s, state);
  // BlockBehaviour.canBeReplaced(state, context): replaceable && (empty hand || held item != this item)
  if (!REPLACEABLE.has(meta.name)) return false;
  return meta.item === null || meta.item !== s.held;
}

/** SlabBlock.canBeReplaced (SlabBlock.java:84-98). */
function slabCanBeReplaced(s: PlacementSession, state: number, pos: Pos): boolean {
  const mc = s.mc;
  const type = propValue(mc, state, 'type');
  const sameItem = blockOfState(mc, state).item === s.held;
  if (type === 'double' || !sameItem) return false;
  if (s.replaceClicked) {
    const above = s.click.y - pos.y > 0.5;
    const face = s.face;
    const horizontal = isHorizontal(face);
    return type === 'bottom'
      ? face === UP || (above && horizontal)
      : face === DOWN || (!above && horizontal);
  }
  return true;
}

/** SnowLayerBlock.canBeReplaced (SnowLayerBlock.java:113-120). */
function snowLayerCanBeReplaced(s: PlacementSession, state: number): boolean {
  const mc = s.mc;
  const layers = Number(propValue(mc, state, 'layers') ?? '1');
  const sameItem = blockOfState(mc, state).item === s.held;
  if (!sameItem || layers >= 8) return layers === 1;
  return s.replaceClicked ? s.face === UP : true;
}

/** BlockItem.canPlace -> state.canSurvive + level.isUnobstructed. */
function stateCanPlace(s: PlacementSession, state: number, pos: Pos): boolean {
  if (!canSurvive(s, state, pos)) return false;
  if (s.isUnobstructed && !s.isUnobstructed(state, pos.x, pos.y, pos.z)) return false;
  return true;
}

/**
 * BlockBehaviour.updateShape support check, exposed for neighbour updates:
 * vegetation/torch/doors/etc. return air when their support disappears.
 */
export function survivesAt(
  mc: MinecraftData, level: PlacementLevel, state: number, x: number, y: number, z: number,
): boolean {
  const session: PlacementSession = {
    mc, level, held: '', face: UP,
    click: { x, y, z }, clicked: { x, y, z }, relative: { x, y, z },
    replaceClicked: false, yaw: 0, pitch: 0,
  };
  return canSurvive(session, state, { x, y, z });
}

// ---------------------------------------------------------------------------------------------
// BlockState.canSurvive ports (per block family)
// ---------------------------------------------------------------------------------------------

function posOffset(pos: Pos, dir: number): Pos {
  const [dx, dy, dz] = step(dir);
  return { x: pos.x + dx, y: pos.y + dy, z: pos.z + dz };
}

function stateAt(s: PlacementSession, pos: Pos): number { return s.level.getBlockState(pos.x, pos.y, pos.z); }

function neighborFaceSturdy(s: PlacementSession, pos: Pos, dir: number): boolean {
  const np = posOffset(pos, dir);
  return s.mc.isFaceSturdy(stateAt(s, np), opposite(dir));
}

/** Block.canSupportCenter(level, below, UP) */
function canSupportCenterUp(s: PlacementSession, pos: Pos): boolean {
  return centerSupportsUp(s.mc, stateAt(s, posOffset(pos, DOWN)));
}

function canSurvive(s: PlacementSession, state: number, pos: Pos): boolean {
  const mc = s.mc;
  const meta = blockOfState(mc, state);
  const cls = meta.cls;

  // BaseTorchBlock (TorchBlock): support at the centre of the block below.
  if (cls === 'TorchBlock' || cls === 'RedstoneTorchBlock') return canSupportCenterUp(s, pos);

  // WallTorchBlock.canSurvive(level, pos, facing): the block behind the torch must be sturdy.
  if (cls === 'WallTorchBlock' || cls === 'RedstoneWallTorchBlock') {
    const facing = propValue(mc, state, 'facing');
    const dir = DIR_BY_NAME[facing ?? 'north'];
    return neighborFaceSturdy(s, pos, opposite(dir));
  }

  // DoorBlock.canSurvive: lower half needs a sturdy floor, upper half needs the lower door.
  if (isDoorBlock(meta)) {
    const half = propValue(mc, state, 'half');
    const below = stateAt(s, posOffset(pos, DOWN));
    if (half === 'lower') return mc.isFaceSturdy(below, UP);
    return isSameBlock(mc, below, meta.name) && propValue(mc, below, 'half') === 'lower';
  }

  // FaceAttachedHorizontalDirectionalBlock.canSurvive (buttons, levers).
  if (hasProp(meta, 'face') && hasProp(meta, 'facing')) {
    const face = propValue(mc, state, 'face');
    let connected: number;
    if (face === 'floor') connected = UP;
    else if (face === 'ceiling') connected = DOWN;
    else connected = DIR_BY_NAME[propValue(mc, state, 'facing') ?? 'north'];
    return neighborFaceSturdy(s, pos, opposite(connected));
  }

  // CarpetBlock.canSurvive: the block below must not be empty.
  if (cls === 'CarpetBlock' || cls === 'WoolCarpetBlock') {
    return !isAirState(mc, stateAt(s, posOffset(pos, DOWN)));
  }

  // SnowLayerBlock.canSurvive (SnowLayerBlock.java:77-86).
  if (cls === 'SnowLayerBlock') {
    const below = stateAt(s, posOffset(pos, DOWN));
    const belowMeta = blockOfState(mc, below);
    if (CANNOT_SUPPORT_SNOW_LAYER.has(belowMeta.name)) return false;
    if (SUPPORT_OVERRIDE_SNOW_LAYER.has(belowMeta.name)) return true;
    const belowIsSnow = belowMeta.name === 'snow' && Number(propValue(mc, below, 'layers') ?? '1') === 8;
    return isFullCollision(mc, below) || belowIsSnow;
  }

  // LadderBlock.canSurvive: the face behind the ladder must be sturdy.
  if (cls === 'LadderBlock') {
    const dir = DIR_BY_NAME[propValue(mc, state, 'facing') ?? 'north'];
    return neighborFaceSturdy(s, pos, opposite(dir));
  }

  // TripWireHookBlock.canSurvive: the block behind the hook must be sturdy.
  if (cls === 'TripWireHookBlock') {
    const dir = DIR_BY_NAME[propValue(mc, state, 'facing') ?? 'north'];
    return neighborFaceSturdy(s, pos, opposite(dir));
  }

  // DoublePlantBlock.canSurvive: lower on vegetation, upper on its lower half.
  if (cls === 'DoublePlantBlock') {
    const half = propValue(mc, state, 'half');
    if (half === 'upper') {
      const below = stateAt(s, posOffset(pos, DOWN));
      return isSameBlock(mc, below, meta.name) && propValue(mc, below, 'half') === 'lower';
    }
    return vegetationSupports(s, meta, pos);
  }

  // SugarCaneBlock.canSurvive: another cane below, or a substrate with water
  // (or frosted ice) next to that substrate.
  if (cls === 'SugarCaneBlock') {
    const below = posOffset(pos, DOWN);
    const belowState = stateAt(s, below);
    if (nameOf(mc, belowState) === meta.name) return true;
    if (!SUGAR_CANE_SUBSTRATE.has(nameOf(mc, belowState))) return false;
    for (const dir of HORIZONTALS) {
      const side = nameOf(mc, stateAt(s, posOffset(below, dir)));
      if (side === 'water' || side === 'frosted_ice') return true;
    }
    return false;
  }

  // VegetationBlock.canSurvive (flowers, grass, ferns, saplings, bushes, roots...).
  if (isVegetationBlock(meta)) return vegetationSupports(s, meta, pos);

  return true; // BlockBehaviour.canSurvive default
}

/** #minecraft:substrate_overworld + #minecraft:sand (SugarCaneBlock.SUPPORTS_SUGAR_CANE). */
const SUGAR_CANE_SUBSTRATE: ReadonlySet<string> = new Set([
  'dirt', 'coarse_dirt', 'rooted_dirt', 'grass_block', 'podzol', 'mycelium',
  'moss_block', 'pale_moss_block', 'mud', 'muddy_mangrove_roots',
  'sand', 'red_sand',
]);

function isVegetationBlock(meta: BlockMeta): boolean {
  return VEGETATION_CLASSES.has(meta.cls) || meta.cls.endsWith('RootsBlock') || meta.cls.endsWith('SaplingBlock');
}

const VEGETATION_CLASSES = new Set([
  'FlowerBlock', 'TallGrassBlock', 'BushBlock', 'DryVegetationBlock', 'DoublePlantBlock',
  'NetherRootsBlock', 'ShortDryGrassBlock', 'TallDryGrassBlock', 'SaplingBlock',
]);

function vegetationSupports(s: PlacementSession, meta: BlockMeta, pos: Pos): boolean {
  const belowState = stateAt(s, posOffset(pos, DOWN));
  const belowName = nameOf(s.mc, belowState);
  const allowed = meta.cls === 'DryVegetationBlock' ? SUPPORTS_DRY_VEGETATION : SUPPORTS_VEGETATION;
  return allowed.has(belowName);
}

// ---------------------------------------------------------------------------------------------
// Block.getStateForPlacement ports (per block family)
// ---------------------------------------------------------------------------------------------

function isWaterAt(s: PlacementSession, pos: Pos): boolean { return isWaterState(s.mc, stateAt(s, pos)); }

function getStairsShape(s: PlacementSession, state: number, pos: Pos): string {
  const mc = s.mc;
  const facing = DIR_BY_NAME[propValue(mc, state, 'facing') ?? 'north'];
  const half = propValue(mc, state, 'half');
  const behind = stateAt(s, posOffset(pos, facing));
  const behindMeta = blockOfState(mc, behind);
  if (isStairsBlock(behindMeta) && propValue(mc, behind, 'half') === half) {
    const behindFacing = DIR_BY_NAME[propValue(mc, behind, 'facing') ?? 'north'];
    if (axisOf(behindFacing) !== axisOf(facing) && canTakeShape(s, state, pos, opposite(behindFacing))) {
      return behindFacing === DIRS[facing].ccw ? 'outer_left' : 'outer_right';
    }
  }
  const front = stateAt(s, posOffset(pos, opposite(facing)));
  const frontMeta = blockOfState(mc, front);
  if (isStairsBlock(frontMeta) && propValue(mc, front, 'half') === half) {
    const frontFacing = DIR_BY_NAME[propValue(mc, front, 'facing') ?? 'north'];
    if (axisOf(frontFacing) !== axisOf(facing) && canTakeShape(s, state, pos, frontFacing)) {
      return frontFacing === DIRS[facing].ccw ? 'inner_left' : 'inner_right';
    }
  }
  return 'straight';
}

function canTakeShape(s: PlacementSession, state: number, pos: Pos, neighbourDir: number): boolean {
  const mc = s.mc;
  const neighbour = stateAt(s, posOffset(pos, neighbourDir));
  const neighbourMeta = blockOfState(mc, neighbour);
  if (!isStairsBlock(neighbourMeta)) return true;
  return propValue(mc, neighbour, 'facing') !== propValue(mc, state, 'facing')
    || propValue(mc, neighbour, 'half') !== propValue(mc, state, 'half');
}

function halfFromClick(s: PlacementSession, pos: Pos): 'bottom' | 'top' {
  const below = s.face !== DOWN && (s.face === UP || !(s.click.y - pos.y > 0.5));
  return below ? 'bottom' : 'top';
}

function doorPlacementState(s: PlacementSession, blockName: string): number | null {
  const mc = s.mc;
  const pos = sessionPos(s);
  const above = posOffset(pos, UP);
  const aboveState = stateAt(s, above);
  if (pos.y >= levelMaxY(s.level)) return null;
  if (!stateCanBeReplaced(s, aboveState, above)) return null;
  const powered = hasSignal(s, pos) || hasSignal(s, above);
  const facing = horizontalDirection(s.yaw);
  const hinge = doorHinge(s, pos, above, facing);
  let state = mc.stateOf(blockName);
  state = setAll(mc, state, {
    facing: sideName(facing),
    hinge,
    powered: powered ? 'true' : 'false',
    open: powered ? 'true' : 'false',
    half: 'lower',
  });
  return state;
}

/** DoorBlock.getHinge (DoorBlock.java:160-197). */
function doorHinge(s: PlacementSession, pos: Pos, above: Pos, facing: number): 'left' | 'right' {
  const mc = s.mc;
  const leftDir = DIRS[facing].ccw;
  const rightDir = DIRS[facing].cw;
  const left = posOffset(pos, leftDir);
  const leftAbove = posOffset(above, leftDir);
  const right = posOffset(pos, rightDir);
  const rightAbove = posOffset(above, rightDir);
  const balance =
    (isFullCollision(mc, stateAt(s, left)) ? -1 : 0)
    + (isFullCollision(mc, stateAt(s, leftAbove)) ? -1 : 0)
    + (isFullCollision(mc, stateAt(s, right)) ? 1 : 0)
    + (isFullCollision(mc, stateAt(s, rightAbove)) ? 1 : 0);
  const leftState = stateAt(s, left);
  const rightState = stateAt(s, right);
  const doorLeft = isDoorBlock(blockOfState(mc, leftState)) && propValue(mc, leftState, 'half') === 'lower';
  const doorRight = isDoorBlock(blockOfState(mc, rightState)) && propValue(mc, rightState, 'half') === 'lower';
  if ((!doorLeft || doorRight) && balance <= 0) {
    if ((!doorRight || doorLeft) && balance >= 0) {
      const [sx, , sz] = step(facing);
      const clickX = s.click.x - pos.x;
      const clickZ = s.click.z - pos.z;
      const leftSide = (sx >= 0 || !(clickZ < 0.5)) && (sx <= 0 || !(clickZ > 0.5))
        && (sz >= 0 || !(clickX > 0.5)) && (sz <= 0 || !(clickX < 0.5));
      return leftSide ? 'left' : 'right';
    }
    return 'left';
  }
  return 'right';
}

function slabPlacementState(s: PlacementSession, blockName: string): number {
  const mc = s.mc;
  const pos = sessionPos(s);
  const current = stateAt(s, pos);
  if (isSameBlock(mc, current, blockName)) {
    return setAll(mc, current, { type: 'double', waterlogged: 'false' });
  }
  let state = mc.stateOf(blockName);
  state = set(mc, state, 'type', 'bottom');
  state = set(mc, state, 'waterlogged', isWaterAt(s, pos) ? 'true' : 'false');
  return halfFromClick(s, pos) === 'bottom' ? state : set(mc, state, 'type', 'top');
}

function stairsPlacementStateFor(s: PlacementSession, blockName: string): number {
  const mc = s.mc;
  const pos = sessionPos(s);
  let state = mc.stateOf(blockName);
  const facing = horizontalDirection(s.yaw);
  state = set(mc, state, 'facing', sideName(facing));
  state = set(mc, state, 'half', halfFromClick(s, pos));
  state = set(mc, state, 'waterlogged', isWaterAt(s, pos) ? 'true' : 'false');
  return set(mc, state, 'shape', getStairsShape(s, state, pos));
}

function trapdoorPlacementState(s: PlacementSession, blockName: string): number {
  const mc = s.mc;
  const pos = sessionPos(s);
  let state = mc.stateOf(blockName);
  if (!s.replaceClicked && isHorizontal(s.face)) {
    state = setAll(mc, state, {
      facing: sideName(s.face),
      half: s.click.y - pos.y > 0.5 ? 'top' : 'bottom',
    });
  } else {
    state = setAll(mc, state, {
      facing: sideName(opposite(horizontalDirection(s.yaw))),
      half: s.face === UP ? 'bottom' : 'top',
    });
  }
  if (hasSignal(s, pos)) state = setAll(mc, state, { open: 'true', powered: 'true' });
  return set(mc, state, 'waterlogged', isWaterAt(s, pos) ? 'true' : 'false');
}

function bedPlacementState(s: PlacementSession, blockName: string): number | null {
  const mc = s.mc;
  const pos = sessionPos(s);
  const facing = horizontalDirection(s.yaw);
  const head = posOffset(pos, facing);
  if (!stateCanBeReplaced(s, stateAt(s, head), head)) return null;
  if (s.level.isWithinBounds && !s.level.isWithinBounds(head.x, head.y, head.z)) return null;
  return set(mc, mc.stateOf(blockName), 'facing', sideName(facing));
}

function faceAttachedPlacementState(s: PlacementSession, blockName: string): number | null {
  const mc = s.mc;
  const pos = sessionPos(s);
  const base = mc.stateOf(blockName);
  const horizontal = horizontalDirection(s.yaw);
  for (const dir of nearestLookingDirections(s)) {
    let state: number;
    if (axisOf(dir) === 1) {
      state = setAll(mc, base, { face: dir === UP ? 'ceiling' : 'floor', facing: sideName(horizontal) });
    } else {
      state = setAll(mc, base, { face: 'wall', facing: sideName(opposite(dir)) });
    }
    if (canSurvive(s, state, pos)) return state;
  }
  return null;
}

function fenceConnectsTo(s: PlacementSession, neighbourState: number, faceSolid: boolean, direction: number): boolean {
  const mc = s.mc;
  const nMeta = blockOfState(mc, neighbourState);
  const heldMeta = metaOf(mc, s.held);
  const sameFence = isFenceBlock(nMeta) && !!heldMeta && soundIsWood(nMeta) === soundIsWood(heldMeta);
  const gate = nMeta.cls === 'FenceGateBlock' && gateConnectsToDirection(mc, neighbourState, direction);
  return (!isExceptionForConnection(mc, neighbourState) && faceSolid) || sameFence || gate;
}

/** FenceGateBlock.connectsToDirection (FenceGateBlock.java:209-211). */
function gateConnectsToDirection(mc: MinecraftData, state: number, direction: number): boolean {
  const facing = DIR_BY_NAME[propValue(mc, state, 'facing') ?? 'north'];
  return axisOf(facing) === axisOf(DIRS[direction].cw);
}

function fencePlacementState(s: PlacementSession, blockName: string): number {
  const mc = s.mc;
  const pos = sessionPos(s);
  let state = mc.stateOf(blockName);
  state = set(mc, state, 'waterlogged', isWaterAt(s, pos) ? 'true' : 'false');
  for (const dir of HORIZONTALS) {
    const neighbour = stateAt(s, posOffset(pos, dir));
    const solid = mc.isFaceSturdy(neighbour, opposite(dir));
    state = set(mc, state, sideName(dir), fenceConnectsTo(s, neighbour, solid, dir) ? 'true' : 'false');
  }
  return state;
}

function wallConnectsTo(s: PlacementSession, neighbourState: number, faceSolid: boolean, direction: number): boolean {
  const mc = s.mc;
  const nMeta = blockOfState(mc, neighbourState);
  if (isWallBlock(nMeta)) return true; // state.is(BlockTags.WALLS)
  if (!isExceptionForConnection(mc, neighbourState) && faceSolid) return true;
  if (isPaneBlock(nMeta)) return true; // block instanceof IronBarsBlock
  return nMeta.cls === 'FenceGateBlock' && gateConnectsToDirection(mc, neighbourState, direction);
}

function wallPlacementState(s: PlacementSession, blockName: string): number {
  const mc = s.mc;
  const pos = sessionPos(s);
  const abovePos = posOffset(pos, UP);
  const above = stateAt(s, abovePos);
  let state = mc.stateOf(blockName);
  state = set(mc, state, 'waterlogged', isWaterAt(s, pos) ? 'true' : 'false');
  const connects: Record<number, boolean> = {};
  for (const dir of HORIZONTALS) {
    const np = posOffset(pos, dir);
    const neighbour = stateAt(s, np);
    const faceSolid = mc.isFaceSturdy(neighbour, opposite(dir));
    connects[dir] = wallConnectsTo(s, neighbour, faceSolid, dir);
  }
  // WallBlock.updateSides + makeWallState: LOW/TALL depends on the block above covering the side.
  for (const dir of HORIZONTALS) {
    const side = !connects[dir] ? 'none' : (downFaceCovers(above, mc, WALL_SIDE_RECTS[dir]) ? 'tall' : 'low');
    state = set(mc, state, sideName(dir), side);
  }
  return set(mc, state, 'up', shouldRaisePost(s, state, above) ? 'true' : 'false');
}

/** WallBlock.shouldRaisePost (WallBlock.java:210-231). */
function shouldRaisePost(s: PlacementSession, state: number, above: number): boolean {
  const mc = s.mc;
  const aboveMeta = blockOfState(mc, above);
  if (isWallBlock(aboveMeta) && propValue(mc, above, 'up') === 'true') return true;
  const north = propValue(mc, state, 'north') ?? 'none';
  const south = propValue(mc, state, 'south') ?? 'none';
  const east = propValue(mc, state, 'east') ?? 'none';
  const west = propValue(mc, state, 'west') ?? 'none';
  const southNone = south === 'none';
  const westNone = west === 'none';
  const eastNone = east === 'none';
  const northNone = north === 'none';
  const hasCorner = (northNone && southNone && westNone && eastNone)
    || northNone !== southNone || westNone !== eastNone;
  if (hasCorner) return true;
  const hasHighWall = (north === 'tall' && south === 'tall') || (east === 'tall' && west === 'tall');
  if (hasHighWall) return false;
  return WALL_POST_OVERRIDE.has(aboveMeta.name) || downFaceCovers(above, mc, POST_RECT);
}

function paneAttachesTo(s: PlacementSession, neighbourState: number, faceSolid: boolean): boolean {
  const mc = s.mc;
  const nMeta = blockOfState(mc, neighbourState);
  return (!isExceptionForConnection(mc, neighbourState) && faceSolid) || isPaneBlock(nMeta) || isWallBlock(nMeta);
}

function panePlacementState(s: PlacementSession, blockName: string): number {
  const mc = s.mc;
  const pos = sessionPos(s);
  let state = mc.stateOf(blockName);
  for (const dir of HORIZONTALS) {
    const np = posOffset(pos, dir);
    const neighbour = stateAt(s, np);
    const solid = mc.isFaceSturdy(neighbour, opposite(dir));
    state = set(mc, state, sideName(dir), paneAttachesTo(s, neighbour, solid) ? 'true' : 'false');
  }
  return set(mc, state, 'waterlogged', isWaterAt(s, pos) ? 'true' : 'false');
}

function snowLayerPlacementState(s: PlacementSession, blockName: string): number {
  const mc = s.mc;
  const pos = sessionPos(s);
  const current = stateAt(s, pos);
  if (isSameBlock(mc, current, blockName)) {
    const layers = Number(propValue(mc, current, 'layers') ?? '1');
    return set(mc, current, 'layers', String(Math.min(8, layers + 1)));
  }
  return mc.stateOf(blockName);
}

function ladderPlacementState(s: PlacementSession, blockName: string): number | null {
  const mc = s.mc;
  const pos = sessionPos(s);
  if (!s.replaceClicked) {
    const behindPos = posOffset(pos, opposite(s.face));
    const behind = stateAt(s, behindPos);
    if (isSameBlock(mc, behind, blockName) && propValue(mc, behind, 'facing') === sideName(s.face)) return null;
  }
  let state = mc.stateOf(blockName);
  for (const dir of nearestLookingDirections(s)) {
    if (!isHorizontal(dir)) continue;
    state = set(mc, state, 'facing', sideName(opposite(dir)));
    if (canSurvive(s, state, pos)) {
      return set(mc, state, 'waterlogged', isWaterAt(s, pos) ? 'true' : 'false');
    }
  }
  return null;
}

/** TripWireHookBlock.getStateForPlacement: FACING points away from the clicked wall. */
function tripwireHookPlacementState(s: PlacementSession, blockName: string): number | null {
  const mc = s.mc;
  const pos = sessionPos(s);
  let state = mc.stateOf(blockName);
  for (const dir of nearestLookingDirections(s)) {
    if (!isHorizontal(dir)) continue;
    state = set(mc, state, 'facing', sideName(opposite(dir)));
    if (canSurvive(s, state, pos)) return state;
  }
  return null;
}

function fenceGatePlacementState(s: PlacementSession, blockName: string): number {
  const mc = s.mc;
  const pos = sessionPos(s);
  const dir = horizontalDirection(s.yaw);
  const axis = AXIS_NAMES[axisOf(dir)];
  const isOpen = hasSignal(s, pos);
  let inWall = false;
  if (axis === 'z') {
    inWall = isWallBlock(blockOfState(mc, stateAt(s, posOffset(pos, WEST))))
      || isWallBlock(blockOfState(mc, stateAt(s, posOffset(pos, EAST))));
  } else {
    inWall = isWallBlock(blockOfState(mc, stateAt(s, posOffset(pos, NORTH))))
      || isWallBlock(blockOfState(mc, stateAt(s, posOffset(pos, SOUTH))));
  }
  return setAll(mc, mc.stateOf(blockName), {
    facing: sideName(dir),
    in_wall: inWall ? 'true' : 'false',
    open: isOpen ? 'true' : 'false',
    powered: isOpen ? 'true' : 'false',
  });
}

function pillarPlacementState(s: PlacementSession, blockName: string): number {
  const mc = s.mc;
  return set(mc, mc.stateOf(blockName), 'axis', AXIS_NAMES[axisOf(s.face)]);
}

function doublePlantPlacementState(s: PlacementSession, blockName: string): number | null {
  const mc = s.mc;
  const pos = sessionPos(s);
  if (pos.y >= levelMaxY(s.level)) return null;
  const above = posOffset(pos, UP);
  if (!stateCanBeReplaced(s, stateAt(s, above), above)) return null;
  return mc.stateOf(blockName); // default: lower half
}

/** Mounted/side blocks: generic getStateForPlacement = default state, waterlogged filled in. */
function genericPlacementState(s: PlacementSession, blockName: string): number {
  const mc = s.mc;
  let state = mc.stateOf(blockName);
  if (hasProp(blockOfState(mc, state), 'waterlogged')) {
    state = set(mc, state, 'waterlogged', isWaterAt(s, sessionPos(s)) ? 'true' : 'false');
  }
  return state;
}

function hasSignal(s: PlacementSession, pos: Pos): boolean {
  return s.hasNeighborSignal ? s.hasNeighborSignal(pos.x, pos.y, pos.z) : false;
}

/** Dispatch on the block class/properties; every rule above cites its Java source. */
function stateForBlock(s: PlacementSession, blockName: string): number | null {
  const mc = s.mc;
  const meta = metaOf(mc, blockName);
  if (!meta) return null;
  const cls = meta.cls;
  if (cls.endsWith('DoorBlock') && !cls.endsWith('TrapDoorBlock')) return doorPlacementState(s, blockName);
  if (cls.endsWith('TrapDoorBlock')) return trapdoorPlacementState(s, blockName);
  if (cls.endsWith('SlabBlock')) return slabPlacementState(s, blockName);
  if (cls.endsWith('StairBlock')) return stairsPlacementStateFor(s, blockName);
  if (cls === 'BedBlock') return bedPlacementState(s, blockName);
  if (cls === 'ButtonBlock' || cls === 'LeverBlock') return faceAttachedPlacementState(s, blockName);
  if (cls === 'RepeaterBlock' || cls === 'ComparatorBlock') {
    // HorizontalDirectionalBlock.getStateForPlacement: FACING is the input side, so the
    // repeater points (outputs) away from the player who placed it.
    const state = mc.stateOf(blockName);
    return set(mc, state, 'facing', sideName(opposite(horizontalDirection(s.yaw))));
  }
  if (cls === 'ObserverBlock') {
    // ObserverBlock.getStateForPlacement: FACING = getNearestLookingDirection().
    const state = mc.stateOf(blockName);
    return set(mc, state, 'facing', sideName(orderedByNearest(s.yaw, s.pitch)[0]));
  }
  if (cls === 'PistonBaseBlock') {
    // PistonBaseBlock.getStateForPlacement: push side = opposite of the nearest look direction.
    return setAll(mc, mc.stateOf(blockName), {
      facing: sideName(opposite(orderedByNearest(s.yaw, s.pitch)[0])),
      extended: 'false',
    });
  }
  if (cls === 'TripWireHookBlock') return tripwireHookPlacementState(s, blockName);
  if (cls === 'SnowLayerBlock') return snowLayerPlacementState(s, blockName);
  if (cls === 'CarpetBlock' || cls === 'WoolCarpetBlock') return mc.stateOf(blockName);
  if (cls === 'DoublePlantBlock') return doublePlantPlacementState(s, blockName);
  if (cls === 'LadderBlock') return ladderPlacementState(s, blockName);
  if (cls === 'FenceBlock') return fencePlacementState(s, blockName);
  if (cls === 'WallBlock') return wallPlacementState(s, blockName);
  if (isPaneBlock(meta)) return panePlacementState(s, blockName);
  if (cls === 'FenceGateBlock') return fenceGatePlacementState(s, blockName);
  if (isVegetationBlock(meta)) return mc.stateOf(blockName);
  if (hasProp(meta, 'axis') && !hasProp(meta, 'facing') && !hasProp(meta, 'half') && !hasProp(meta, 'type')) {
    return pillarPlacementState(s, blockName);
  }
  return genericPlacementState(s, blockName);
}

// ---------------------------------------------------------------------------------------------
// StandingAndWallBlockItem (torch / soul torch / copper torch / redstone torch / skulls)
// ---------------------------------------------------------------------------------------------

function wallTorchPlacementState(s: PlacementSession, wallName: string): number | null {
  const mc = s.mc;
  const pos = sessionPos(s);
  let state = mc.stateOf(wallName);
  for (const dir of nearestLookingDirections(s)) {
    if (!isHorizontal(dir)) continue;
    state = set(mc, state, 'facing', sideName(opposite(dir)));
    if (canSurvive(s, state, pos)) return state;
  }
  return null;
}

/** StandingAndWallBlockItem.getPlacementState (StandingAndWallBlockItem.java:28-45). */
function standingAndWallPlacement(s: PlacementSession, floorName: string, wallName: string): { blockName: string; state: number } | null {
  const pos = sessionPos(s);
  let chosen: { blockName: string; state: number } | null = null;
  // attachmentDirection is Direction.DOWN for torches/skulls; skip its opposite (UP).
  for (const dir of nearestLookingDirections(s)) {
    if (dir === UP) continue;
    const candidate = dir === DOWN
      ? (stateForBlock(s, floorName))
      : wallTorchPlacementState(s, wallName);
    if (candidate !== null && canSurvive(s, candidate, pos)) {
      chosen = { blockName: dir === DOWN ? floorName : wallName, state: candidate };
      break;
    }
  }
  return chosen;
}

// ---------------------------------------------------------------------------------------------
// Public API
// ---------------------------------------------------------------------------------------------

function buildSession(
  mc: MinecraftData,
  level: PlacementLevel,
  blockName: string,
  ctx: PlacementContext,
): { s: PlacementSession; floorName: string; wallName: string | null } {
  const floorName = blockName;
  const wallName = WALL_VARIANTS[blockName] ?? null;
  const clicked: Pos = { x: ctx.x, y: ctx.y, z: ctx.z };
  const relative = posOffset(clicked, ctx.face);
  const s: PlacementSession = {
    mc,
    level,
    held: floorName,
    face: ctx.face,
    click: { x: ctx.hitX, y: ctx.hitY, z: ctx.hitZ },
    clicked,
    relative,
    replaceClicked: true,
    yaw: ctx.yaw,
    pitch: ctx.pitch,
    isUnobstructed: ctx.isUnobstructed,
    hasNeighborSignal: ctx.hasNeighborSignal,
  };
  // BlockPlaceContext constructor: replaceClicked = clicked state canBeReplaced(this). While that
  // call runs, getClickedPos() still returns the clicked position (the field defaults to true).
  const clickedState = level.getBlockState(clicked.x, clicked.y, clicked.z);
  s.replaceClicked = stateCanBeReplaced(s, clickedState, clicked);
  return { s, floorName, wallName };
}

/**
 * Full placement plan for one right-click, or null when vanilla would not place anything.
 * Mirrors BlockItem.place(): context.canPlace() -> getPlacementState() -> canPlace().
 */
export function getPlacement(
  mc: MinecraftData,
  level: PlacementLevel,
  blockName: string,
  ctx: PlacementContext,
): BlockPlacement | null {
  const { s, floorName, wallName } = buildSession(mc, level, blockName, ctx);
  if (!contextCanPlace(s)) return null;
  const pos = sessionPos(s);

  let block: { blockName: string; state: number } | null;
  if (wallName) {
    block = standingAndWallPlacement(s, floorName, wallName);
  } else {
    const state = stateForBlock(s, floorName);
    block = state === null ? null : { blockName: floorName, state };
  }
  if (!block) return null;
  if (!stateCanPlace(s, block.state, pos)) return null;

  // Block.setPlacedBy copies that the shared helpers do: door upper half, bed head, double plant top.
  const extras: PlacedBlock[] = [];
  const meta = metaOf(mc, block.blockName);
  if (meta && isDoorBlock(meta)) {
    extras.push({
      blockName: block.blockName,
      state: set(mc, block.state, 'half', 'upper'),
      x: pos.x, y: pos.y + 1, z: pos.z,
    });
  } else if (meta && meta.cls === 'BedBlock') {
    const dir = DIR_BY_NAME[propValue(mc, block.state, 'facing') ?? 'north'];
    const head = posOffset(pos, dir);
    extras.push({
      blockName: block.blockName,
      state: set(mc, block.state, 'part', 'head'),
      x: head.x, y: head.y, z: head.z,
    });
  } else if (meta && meta.cls === 'DoublePlantBlock') {
    extras.push({
      blockName: block.blockName,
      state: set(mc, block.state, 'half', 'upper'),
      x: pos.x, y: pos.y + 1, z: pos.z,
    });
  }

  return { blockName: block.blockName, state: block.state, x: pos.x, y: pos.y, z: pos.z, extras };
}

/** BlockItem.getPlacementState(): the primary state only, or null when the placement would fail. */
export function getPlacementState(
  mc: MinecraftData,
  level: PlacementLevel,
  blockName: string,
  ctx: PlacementContext,
): number | null {
  const plan = getPlacement(mc, level, blockName, ctx);
  return plan ? plan.state : null;
}

/**
 * Placement plus the block writes that BlockItem.place() performs: setBlock(pos, state, 11)
 * followed by Block.setPlacedBy's extra blocks. Returns the plan, or null when nothing is placed.
 */
export function placeBlock(
  mc: MinecraftData,
  level: PlacementLevel,
  blockName: string,
  ctx: PlacementContext,
): BlockPlacement | null {
  const plan = getPlacement(mc, level, blockName, ctx);
  if (!plan) return null;
  level.setBlockState(plan.x, plan.y, plan.z, plan.state);
  for (const extra of plan.extras) level.setBlockState(extra.x, extra.y, extra.z, extra.state);
  return plan;
}

/**
 * BlockState.canSurvive for one block, exposed for the caller's neighbour/update bookkeeping.
 * `state` must belong to a block this module supports; unknown blocks return true (vanilla default).
 */
export function canPlaceAt(
  mc: MinecraftData,
  level: PlacementLevel,
  state: number,
  x: number,
  y: number,
  z: number,
  opts: { yaw?: number; pitch?: number; face?: number; hitX?: number; hitY?: number; hitZ?: number } = {},
): boolean {
  const s: PlacementSession = {
    mc,
    level,
    held: nameOf(mc, state),
    face: opts.face ?? UP,
    click: { x: opts.hitX ?? x + 0.5, y: opts.hitY ?? y + 0.5, z: opts.hitZ ?? z + 0.5 },
    clicked: { x, y, z },
    relative: { x, y: y + 1, z },
    replaceClicked: false,
    yaw: opts.yaw ?? 0,
    pitch: opts.pitch ?? 0,
  };
  return canSurvive(s, state, { x, y, z });
}

/** Helper used by callers that only need the block id of a held item. */
export function placementBlockForItem(mc: MinecraftData, blockName: string): string {
  const meta = metaOf(mc, blockName);
  return meta ? meta.name : blockName;
}
