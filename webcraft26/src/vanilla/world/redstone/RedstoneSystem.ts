// Source: net.minecraft.world.level.block RedStoneWireBlock / DiodeBlock (RepeaterBlock) /
//         RedstoneTorchBlock / LeverBlock / ButtonBlock / BasePressurePlateBlock /
//         RedstoneLampBlock / DoorBlock / TrapDoorBlock / FenceGateBlock / TntBlock
//         + net.minecraft.world.level.SignalGetter
//
// Client-side redstone sibling of the vanilla block-update loop. It is event driven:
// Game calls onBlockChanged() after every world edit, the engine updates the affected
// wires/diodes/mechanisms, and pushes further positions onto the same queue until the
// circuit settles. Time-dependent blocks (buttons, torches, repeaters, lamps) use the
// scheduled-tick list advanced by tick().
//
// Signals follow the vanilla queries used by the ported blocks:
//   signal(pos, dir)        weak power emitted by the block at `pos` toward `dir`,
//                           plus strong power conducted through a solid block;
//   directSignal(pos, dir)  strong power only.
// Redstone wire power = max(adjacent weak signal, wireIncoming - 1); a wire does not
// power itself (wireSignalOff / wireSuppressed).

import { AABB } from '../../core/Geometry.js';
import type { ClientLevel } from '../level/ClientLevel.js';
import type { MinecraftData } from '../level/block/state/BlockState.js';

type DirName = 'down' | 'up' | 'north' | 'south' | 'west' | 'east';

const DIRS: Readonly<Record<DirName, readonly [number, number, number]>> = {
  down: [0, -1, 0],
  up: [0, 1, 0],
  north: [0, 0, -1],
  south: [0, 0, 1],
  west: [-1, 0, 0],
  east: [1, 0, 0],
};
const DIR_LIST: readonly DirName[] = ['down', 'up', 'north', 'south', 'west', 'east'];
const HORIZONTAL: readonly DirName[] = ['north', 'south', 'west', 'east'];
const OPPOSITE: Readonly<Record<DirName, DirName>> = {
  down: 'up', up: 'down', north: 'south', south: 'north', west: 'east', east: 'west',
};

const WIRE = 'redstone_wire';
const REPEATER = 'repeater';
const COMPARATOR = 'comparator';
const OBSERVER = 'observer';
const DAYLIGHT_DETECTOR = 'daylight_detector';
const TRIPWIRE = 'tripwire';
const TRIPWIRE_HOOK = 'tripwire_hook';
const PISTON = 'piston';
const STICKY_PISTON = 'sticky_piston';
const PISTON_HEAD = 'piston_head';
const MOVING_PISTON = 'moving_piston';
const REDSTONE_TORCH = 'redstone_torch';
const REDSTONE_WALL_TORCH = 'redstone_wall_torch';
const REDSTONE_LAMP = 'redstone_lamp';
const REDSTONE_BLOCK = 'redstone_block';
const TNT = 'tnt';

const RAIL_BLOCKS = new Set(['rail', 'powered_rail', 'detector_rail', 'activator_rail']);

/**
 * PistonBaseBlock.isPushable, minus the slime/honey branching graph: blocks with a block
 * entity, hardness -1 (bedrock/barrier/command blocks/...) and the immovable tag members
 * seen in this port's block set cannot be moved.
 */
const PISTON_IMMOVABLE = new Set([
  'obsidian', 'crying_obsidian', 'respawn_anchor', 'reinforced_deepslate', 'enchanting_table',
  'end_portal_frame', 'end_portal', 'nether_portal', 'barrier', 'light', 'moving_piston',
  'piston_head', 'chest', 'trapped_chest', 'furnace', 'blast_furnace', 'smoker',
  'brewing_stand', 'hopper', 'dispenser', 'dropper', 'barrel', 'beacon', 'spawner',
  'jukebox', 'lectern', 'comparator', 'daylight_detector', 'beehive', 'bee_nest',
  'campfire', 'soul_campfire', 'chiseled_bookshelf', 'decorated_pot', 'crafter',
]);

/** Block tags/behaviour used by the comparator's analog input (BlockState.hasAnalogOutputSignal). */
const ANALOG_CONTAINERS = new Set([
  'chest', 'trapped_chest', 'furnace', 'blast_furnace', 'smoker', 'brewing_stand', 'hopper',
  'dispenser', 'dropper', 'barrel', 'shulker_box',
]);

const REPLACEABLE_FOR_PISTON = new Set([
  'air', 'cave_air', 'void_air', 'water', 'lava', 'short_grass', 'fern', 'dead_bush', 'bush',
  'short_dry_grass', 'tall_dry_grass', 'tall_grass', 'large_fern', 'seagrass', 'tall_seagrass',
  'fire', 'soul_fire', 'snow', 'vine', 'glow_lichen', 'light', 'structure_void',
]);

export interface RedstoneHooks {
  /** Positional sound; pitch defaults to 1. */
  playSound(name: string, x: number, y: number, z: number, pitch?: number): void;
  /** TntBlock.prime + removeBlock(false): Game removes the block and spawns PrimedTnt. */
  primeTnt(x: number, y: number, z: number): void;
  /** Number of entity boxes intersecting the given box (pressure plates/tripwire). */
  countEntities(box: AABB): number;
  /** Entity feet positions for pressure-plate/tripwire discovery. */
  entityFeet(): readonly { x: number; y: number; z: number }[];
  /** Container.getRedstoneSignalFromContainer for the cached block container at the position. */
  containerSignal(name: string, x: number, y: number, z: number): number;
}

interface BoxPos { x: number; y: number; z: number; }

interface PistonResolve {
  toPush: BoxPos[];
  toDestroy: BoxPos[];
  pushDirection: DirName;
}

interface Scheduled {
  at: number;
  x: number;
  y: number;
  z: number;
  kind: 'button' | 'repeater' | 'comparator' | 'torch' | 'torchBurnout' | 'lamp'
  | 'observer' | 'daylight';
}

export class RedstoneSystem {
  private now = 0;
  private readonly queue: { x: number; y: number; z: number }[] = [];
  private readonly queued = new Set<string>();
  private readonly scheduled = new Map<string, Scheduled>();
  /** Plates that are currently pressed (or were last tick), keyed "x,y,z". */
  private readonly activePlates = new Set<string>();
  /** Tripwires currently pressed, keyed "x,y,z". */
  private readonly activeTripwires = new Set<string>();
  /** ComparatorBlockEntity.outputSignal stand-in, keyed "x,y,z". */
  private readonly comparatorOutput = new Map<string, number>();
  /** RedstoneTorchBlock.RECENT_TOGGLES stand-in: flip times per torch. */
  private readonly torchToggles = new Map<string, number[]>();
  /** While true, redstone wire emits no power (wire_block_signal). */
  private wireSuppressed = false;

  constructor(
    private readonly level: ClientLevel,
    private readonly mc: MinecraftData,
    private readonly hooks: RedstoneHooks,
  ) {}

  // ---------------------------------------------------------------- entry points

  /** Neighbour update after a block edit (Level.setBlock + updateNeighbors). */
  onBlockChanged(x: number, y: number, z: number): void {
    this.enqueue(x, y, z);
    for (const dir of DIR_LIST) this.enqueue(x + DIRS[dir][0], y + DIRS[dir][1], z + DIRS[dir][2]);
    this.notifyObservers(x, y, z);
    this.flush();
  }

  /** Neighbour updates for a batch of edits (explosions); one flush at the end. */
  onBlocksChanged(positions: readonly { x: number; y: number; z: number }[]): void {
    if (positions.length === 0) return;
    for (const p of positions) {
      this.enqueueAround(p.x, p.y, p.z);
      this.notifyObservers(p.x, p.y, p.z);
    }
    this.flush();
  }

  /** One 20 Hz step: scheduled block ticks, pressure plates and tripwires. */
  tick(): void {
    this.now++;
    this.tickScheduled();
    this.tickPressurePlates();
    this.tickTripwires();
    // Scheduled ticks push further updates (comparator output, observer pulse, lamp relight);
    // this client has no Level neighbour queue, so settle them at the end of the same tick.
    this.flush();
  }

  /** Right-click interaction; true when the block consumed the click. */
  use(x: number, y: number, z: number): boolean {
    const state = this.state(x, y, z);
    if (state === 0) return false;
    const name = this.name(state);
    if (name === COMPARATOR) {
      // ComparatorBlock.useWithoutItem: cycle MODE, click sound, refresh output immediately.
      const mode = this.prop(state, 'mode') === 'subtract' ? 'compare' : 'subtract';
      const next = this.mc.withProp(state, 'mode', mode);
      this.hooks.playSound('block.comparator.click', x + 0.5, y + 0.5, z + 0.5,
        mode === 'subtract' ? 0.55 : 0.5);
      this.set(x, y, z, next);
      this.refreshComparator(x, y, z, next);
      this.flush();
      return true;
    }
    if (name === DAYLIGHT_DETECTOR) {
      // DaylightDetectorBlock.useWithoutItem: cycle INVERTED and recompute at once.
      const next = this.mc.withProp(state, 'inverted',
        this.bool(state, 'inverted') ? 'false' : 'true');
      this.set(x, y, z, next);
      this.updateDaylightSignal(x, y, z, next);
      this.flush();
      return true;
    }
    if (name === 'lever') {
      const powered = this.bool(state, 'powered');
      this.set(x, y, z, this.mc.withProp(state, 'powered', powered ? 'false' : 'true'));
      this.hooks.playSound('block.lever.click', x + 0.5, y + 0.5, z + 0.5);
      this.soundEvent(x, y, z, powered ? 'block_deactivate' : 'block_activate');
      this.enqueueAround(x, y, z);
      // LeverBlock.updateNeighbours also notifies the block the lever is mounted on, so a
      // torch standing on that block hears the change.
      const [ax, ay, az] = DIRS[this.attachedDir(state)];
      this.enqueueAround(x + ax, y + ay, z + az);
      this.flush();
      return true;
    }
    if (this.isButton(name)) {
      if (this.bool(state, 'powered')) return true;
      this.set(x, y, z, this.mc.withProp(state, 'powered', 'true'));
      this.hooks.playSound(this.buttonSound(name, true), x + 0.5, y + 0.5, z + 0.5);
      this.soundEvent(x, y, z, 'block_activate');
      this.schedule(x, y, z, 'button', name.includes('stone') ? 20 : 30);
      this.enqueueAround(x, y, z);
      const [ax, ay, az] = DIRS[this.attachedDir(state)];
      this.enqueueAround(x + ax, y + ay, z + az);
      this.flush();
      return true;
    }
    if (name === REPEATER) {
      const delay = Number(this.prop(state, 'delay') ?? 1);
      this.set(x, y, z, this.mc.withProp(state, 'delay', String(delay % 4 + 1)));
      this.hooks.playSound('ui.button.click', x + 0.5, y + 0.5, z + 0.5);
      this.flush();
      return true;
    }
    if (this.isDoor(name)) {
      // Iron doors are redstone-only (DoorBlock.use does nothing when the material is iron).
      if (name.startsWith('iron')) return true;
      this.toggleDoor(x, y, z, state);
      return true;
    }
    if (this.isTrapdoor(name)) {
      if (name.startsWith('iron')) return true;
      const open = !this.bool(state, 'open');
      this.set(x, y, z, this.mc.withProp(state, 'open', open ? 'true' : 'false'));
      this.hooks.playSound(this.trapdoorSound(name, open), x + 0.5, y + 0.5, z + 0.5,
        0.9 + Math.random() * 0.1);
      this.soundEvent(x, y, z, open ? 'block_open' : 'block_close');
      return true;
    }
    if (this.isGate(name)) {
      const open = !this.bool(state, 'open');
      this.set(x, y, z, this.mc.withProp(state, 'open', open ? 'true' : 'false'));
      this.hooks.playSound(open ? 'block.fence_gate.open' : 'block.fence_gate.close',
        x + 0.5, y + 0.5, z + 0.5, 0.9 + Math.random() * 0.1);
      this.soundEvent(x, y, z, open ? 'block_open' : 'block_close');
      return true;
    }
    return false;
  }

  /** SignalGetter.hasNeighborSignal for placement rules and mechanisms. */
  isPoweredAt(x: number, y: number, z: number): boolean {
    return this.hasNeighborSignal(x, y, z);
  }

  /** Current wire power (diagnostics/tests). */
  wirePower(x: number, y: number, z: number): number {
    const state = this.state(x, y, z);
    return state !== 0 && this.name(state) === WIRE ? Number(this.prop(state, 'power') ?? 0) : 0;
  }

  // ---------------------------------------------------------------- queue

  private enqueue(x: number, y: number, z: number): void {
    const key = `${x},${y},${z}`;
    if (this.queued.has(key)) return;
    this.queued.add(key);
    this.queue.push({ x, y, z });
  }

  private enqueueAround(x: number, y: number, z: number): void {
    this.enqueue(x, y, z);
    for (const dir of DIR_LIST) this.enqueue(x + DIRS[dir][0], y + DIRS[dir][1], z + DIRS[dir][2]);
  }

  private flush(): void {
    let guard = 0;
    while (this.queue.length > 0) {
      if (++guard > 20000) break;
      const p = this.queue.shift()!;
      this.queued.delete(`${p.x},${p.y},${p.z}`);
      this.updateBlock(p.x, p.y, p.z);
    }
  }

  private updateBlock(x: number, y: number, z: number): void {
    const state = this.state(x, y, z);
    if (state === 0) return;
    const name = this.name(state);
    if (name === WIRE) {
      this.updateWire(x, y, z, state);
    } else if (name === REPEATER) {
      this.updateDiodeNeighbor(x, y, z, state);
    } else if (name === COMPARATOR) {
      this.updateComparator(x, y, z, state);
    } else if (name === OBSERVER) {
      // Observers are driven by notifyObservers() on the watched block's edit.
    } else if (name === DAYLIGHT_DETECTOR) {
      this.updateDaylight(x, y, z, state);
    } else if (name === TRIPWIRE) {
      this.updateTripWire(x, y, z, state);
    } else if (name === TRIPWIRE_HOOK) {
      this.updateTripWireHook(x, y, z, state);
    } else if (name === PISTON || name === STICKY_PISTON) {
      this.updatePiston(x, y, z, state);
    } else if (name === PISTON_HEAD) {
      this.updatePistonHead(x, y, z, state);
    } else if (RAIL_BLOCKS.has(name)) {
      this.updateRail(x, y, z, state);
    } else if (name === REDSTONE_TORCH || name === REDSTONE_WALL_TORCH) {
      this.updateTorchNeighbor(x, y, z, state);
    } else if (name === REDSTONE_LAMP) {
      this.updateLamp(x, y, z, state);
    } else if (name === TNT) {
      if (this.hasNeighborSignal(x, y, z)) this.hooks.primeTnt(x, y, z);
    } else if (this.isDoor(name)) {
      this.updateDoor(x, y, z);
    } else if (this.isTrapdoor(name)) {
      this.updateTrapdoor(x, y, z, state);
    } else if (this.isGate(name)) {
      this.updateGate(x, y, z, state);
    }
  }

  // ---------------------------------------------------------------- wires

  private updateWire(x: number, y: number, z: number, state: number): void {
    const shape = this.wireShape(state, x, y, z);
    const blockSignal = this.bestNeighborSignal(x, y, z, true);
    const incoming = this.wireIncomingSignal(x, y, z);
    const target = blockSignal >= 15 ? 15 : Math.max(blockSignal, incoming);
    const shaped = this.mc.withProp(shape, 'power', String(target));
    if (shaped !== state) this.set(x, y, z, shaped);
  }

  /** RedStoneWireBlock.getConnectionState + updateShape, limited to flat/stair connections. */
  private wireShape(state: number, x: number, y: number, z: number): number {
    const above = this.state(x, y + 1, z);
    const canGoUp = above === 0 || !this.isConductor(above);
    const connections: Record<string, 'side' | 'up' | 'none'> = {
      north: 'none', south: 'none', west: 'none', east: 'none',
    };
    for (const dir of HORIZONTAL) {
      const [dx, , dz] = DIRS[dir];
      const neighbour = this.state(x + dx, y, z + dz);
      if (neighbour !== 0 && this.shouldWireConnectTo(neighbour, dir)) {
        connections[dir] = 'side';
        continue;
      }
      if (canGoUp) {
        const upNeighbour = this.state(x + dx, y + 1, z + dz);
        if (upNeighbour !== 0 && this.name(upNeighbour) === WIRE) connections[dir] = 'up';
      }
    }
    const sides = HORIZONTAL.filter((d) => connections[d] === 'side');
    const ups = HORIZONTAL.filter((d) => connections[d] === 'up');
    // A wire with one connection is drawn as a straight line (opposite side filled in).
    if (sides.length === 1 && ups.length === 0) connections[OPPOSITE[sides[0]]] = 'side';
    let out = state;
    for (const dir of HORIZONTAL) out = this.mc.withProp(out, dir, connections[dir]);
    return out;
  }

  /** RedStoneWireBlock.shouldConnectTo (the subset used by the ported blocks). */
  private shouldWireConnectTo(neighbour: number, dir: DirName): boolean {
    const name = this.name(neighbour);
    if (name === WIRE) return true;
    if (name === REPEATER || name === COMPARATOR) {
      const facing = this.prop(neighbour, 'facing') ?? 'north';
      const axis = (d: string): string => (d === 'north' || d === 'south' ? 'z' : 'x');
      return axis(facing) === axis(dir);
    }
    if (name === 'observer') return this.prop(neighbour, 'facing') === dir;
    if (name === REDSTONE_BLOCK || name === REDSTONE_TORCH || name === REDSTONE_WALL_TORCH) return true;
    if (name === 'lever' || this.isButton(name) || this.isPressurePlate(name)
      || name === 'daylight_detector') return true;
    return false;
  }

  /** RedStoneWireBlock.getIncomingSignal / DefaultRedstoneWireEvaluator. */
  private wireIncomingSignal(x: number, y: number, z: number): number {
    let signal = 0;
    for (const dir of HORIZONTAL) {
      const [dx, , dz] = DIRS[dir];
      const nx = x + dx, nz = z + dz;
      const neighbour = this.state(nx, y, nz);
      signal = Math.max(signal, this.wirePowerAt(nx, y, nz));
      if (this.isConductor(neighbour) && !this.isConductor(this.state(x, y + 1, z))) {
        signal = Math.max(signal, this.wirePowerAt(nx, y + 1, nz));
      } else if (!this.isConductor(neighbour)) {
        signal = Math.max(signal, this.wirePowerAt(nx, y - 1, nz));
      }
    }
    return Math.max(0, signal - 1);
  }

  private wirePowerAt(x: number, y: number, z: number): number {
    const state = this.state(x, y, z);
    return state !== 0 && this.name(state) === WIRE ? Number(this.prop(state, 'power') ?? 0) : 0;
  }

  // ---------------------------------------------------------------- signal queries

  /** SignalGetter.getSignal(pos, dir) including strong power through conductors. */
  private signal(x: number, y: number, z: number, dir: DirName): number {
    const state = this.state(x, y, z);
    if (state === 0) return 0;
    if (this.name(state) === WIRE) {
      return this.wireSuppressed ? 0 : this.wireSignal(state, x, y, z, dir);
    }
    let signal = this.weakSignal(state, dir, x, y, z);
    if (this.isConductor(state)) signal = Math.max(signal, this.directSignalTo(x, y, z));
    return signal;
  }

  private weakSignal(state: number, dir: DirName, x: number, y: number, z: number): number {
    const name = this.name(state);
    if (name === REDSTONE_BLOCK) return 15;
    if (name === REDSTONE_TORCH || name === REDSTONE_WALL_TORCH) {
      // RedstoneTorchBlock.getSignal: no weak power toward the block above.
      return this.bool(state, 'lit') && dir !== 'up' ? 15 : 0;
    }
    if (name === 'lever' || this.isButton(name) || this.isPressurePlate(name)) {
      return this.bool(state, 'powered') ? 15 : 0;
    }
    if (name === REPEATER) {
      // FACING is the input side; `dir` points from the receiver to the repeater, so the
      // receiver is on the output side when dir === FACING.
      return this.bool(state, 'powered') && dir === this.prop(state, 'facing') ? 15 : 0;
    }
    if (name === COMPARATOR) {
      return this.bool(state, 'powered') && dir === this.prop(state, 'facing')
        ? this.comparatorOutputAt(x, y, z) : 0;
    }
    if (name === OBSERVER) {
      return this.bool(state, 'powered') && dir === this.prop(state, 'facing') ? 15 : 0;
    }
    if (name === DAYLIGHT_DETECTOR) {
      return Number(this.prop(state, 'power') ?? 0);
    }
    if (name === TRIPWIRE_HOOK) {
      return this.bool(state, 'powered') ? 15 : 0;
    }
    return 0;
  }

  /** SignalGetter.getDirectSignal(pos, dir): strong power that passes through blocks. */
  private directSignal(x: number, y: number, z: number, dir: DirName): number {
    const state = this.state(x, y, z);
    if (state === 0) return 0;
    const name = this.name(state);
    if (name === WIRE) return this.wireSuppressed ? 0 : this.wireSignal(state, x, y, z, dir);
    if (name === REDSTONE_BLOCK) return 15;
    if (name === REDSTONE_TORCH || name === REDSTONE_WALL_TORCH) {
      // RedstoneTorchBlock.getDirectSignal: strong power goes to the block above the torch
      // (direction points from that receiver down to the torch), never to its own base.
      return this.bool(state, 'lit') && dir === 'down' ? 15 : 0;
    }
    if (name === 'lever' || this.isButton(name)) {
      // Strong power goes into the block the lever/button is mounted on (SignalGetter
      // direction points from that block back to the lever).
      return this.bool(state, 'powered') && dir === OPPOSITE[this.attachedDir(state)] ? 15 : 0;
    }
    if (this.isPressurePlate(name)) {
      return this.bool(state, 'powered') && dir === 'up' ? 15 : 0;
    }
    if (name === REPEATER) {
      return this.bool(state, 'powered') && dir === this.prop(state, 'facing') ? 15 : 0;
    }
    if (name === COMPARATOR) {
      return this.bool(state, 'powered') && dir === this.prop(state, 'facing')
        ? this.comparatorOutputAt(x, y, z) : 0;
    }
    if (name === OBSERVER) {
      return this.bool(state, 'powered') && dir === this.prop(state, 'facing') ? 15 : 0;
    }
    if (name === TRIPWIRE_HOOK) {
      // TripWireHookBlock.getDirectSignal: strong power toward the attached block.
      return this.bool(state, 'powered') && dir === this.prop(state, 'facing') ? 15 : 0;
    }
    return 0;
  }

  /** SignalGetter.getDirectSignalTo(pos). */
  private directSignalTo(x: number, y: number, z: number): number {
    let best = 0;
    for (const dir of DIR_LIST) {
      best = Math.max(best, this.directSignal(x + DIRS[dir][0], y + DIRS[dir][1], z + DIRS[dir][2], dir));
      if (best >= 15) return 15;
    }
    return best;
  }

  private wireSignal(state: number, x: number, y: number, z: number, dir: DirName): number {
    if (dir === 'down') return 0;
    const power = Number(this.prop(state, 'power') ?? 0);
    if (power === 0) return 0;
    if (dir !== 'up') {
      // `dir` points from the receiver to the wire, so the wire's connection toward the
      // receiver is on the opposite side (SignalGetter semantics).
      const connection = this.prop(state, OPPOSITE[dir]);
      if (connection === 'none') return 0;
    }
    return power;
  }

  /** SignalGetter.hasNeighborSignal. */
  private hasNeighborSignal(x: number, y: number, z: number): boolean {
    for (const dir of DIR_LIST) {
      const [dx, dy, dz] = DIRS[dir];
      if (this.signal(x + dx, y + dy, z + dz, dir) > 0) return true;
    }
    return false;
  }

  /** SignalGetter.getBestNeighborSignal; with `suppressWire` a wire ignores other wires' power. */
  private bestNeighborSignal(x: number, y: number, z: number, suppressWire: boolean): number {
    const previous = this.wireSuppressed;
    if (suppressWire) this.wireSuppressed = true;
    let best = 0;
    for (const dir of DIR_LIST) {
      const [dx, dy, dz] = DIRS[dir];
      best = Math.max(best, this.signal(x + dx, y + dy, z + dz, dir));
      if (best >= 15) break;
    }
    this.wireSuppressed = previous;
    return best;
  }

  // ---------------------------------------------------------------- diodes

  /** DiodeBlock.getInputSignal: the block the FACING side reads from. */
  private diodeInput(x: number, y: number, z: number, state: number): number {
    const facing = (this.prop(state, 'facing') ?? 'north') as DirName;
    const [dx, dy, dz] = DIRS[facing];
    const tx = x + dx, ty = y + dy, tz = z + dz;
    const signal = this.signal(tx, ty, tz, facing);
    if (signal >= 15) return 15;
    return Math.max(signal, this.wirePowerAt(tx, ty, tz));
  }

  private updateDiodeNeighbor(x: number, y: number, z: number, state: number): void {
    const powered = this.bool(state, 'powered');
    const should = this.diodeInput(x, y, z, state) > 0;
    if (powered === should) return;
    if (this.scheduled.has(this.scheduleKey('repeater', x, y, z))) return;
    this.schedule(x, y, z, 'repeater', Number(this.prop(state, 'delay') ?? 1) * 2);
  }

  private tickRepeater(x: number, y: number, z: number): void {
    const state = this.state(x, y, z);
    if (state === 0 || this.name(state) !== REPEATER) return;
    const powered = this.bool(state, 'powered');
    const should = this.diodeInput(x, y, z, state) > 0;
    if (powered === should) return;
    this.set(x, y, z, this.mc.withProp(state, 'powered', should ? 'true' : 'false'));
    this.enqueueAround(x, y, z);
  }

  // ---------------------------------------------------------------- comparator

  private comparatorOutputAt(x: number, y: number, z: number): number {
    return this.comparatorOutput.get(`${x},${y},${z}`) ?? 0;
  }

  /**
   * ComparatorBlock.getInputSignal: the rear signal, unless the block behind has an analog
   * output. A conductor passes the analog signal one further block along, like vanilla.
   */
  private comparatorInput(x: number, y: number, z: number, state: number): number {
    let input = this.diodeInput(x, y, z, state);
    const facing = (this.prop(state, 'facing') ?? 'north') as DirName;
    const [dx, dy, dz] = DIRS[facing];
    const tx = x + dx, ty = y + dy, tz = z + dz;
    const target = this.state(tx, ty, tz);
    if (target !== 0) {
      const analog = this.analogOutput(target, tx, ty, tz);
      if (analog >= 0) {
        input = analog;
      } else if (input < 15 && this.isConductor(target)) {
        const bx = tx + dx, by = ty + dy, bz = tz + dz;
        const beyond = this.state(bx, by, bz);
        if (beyond !== 0) {
          const beyondAnalog = this.analogOutput(beyond, bx, by, bz);
          if (beyondAnalog >= 0) input = beyondAnalog;
        }
      }
    }
    return input;
  }

  /** BlockState.getAnalogOutputSignal for the ported block set; -1 when none. */
  private analogOutput(state: number, x: number, y: number, z: number): number {
    const name = this.name(state);
    if (ANALOG_CONTAINERS.has(name) || name.endsWith('_shulker_box')) {
      return this.hooks.containerSignal(name, x, y, z);
    }
    if (name === 'cake') return (7 - Number(this.prop(state, 'bites') ?? 0)) * 2;
    if (name === 'composter') return Number(this.prop(state, 'level') ?? 0);
    if (name === 'water_cauldron' || name === 'lava_cauldron'
      || name === 'powder_snow_cauldron') return Number(this.prop(state, 'level') ?? 0);
    return -1;
  }

  /** ComparatorBlock.getAlternateSignal: the larger of the two side control inputs. */
  private comparatorSideSignal(x: number, y: number, z: number, state: number): number {
    const facing = this.prop(state, 'facing') ?? 'north';
    const left: DirName = facing === 'north' ? 'west' : facing === 'south' ? 'east'
      : facing === 'west' ? 'south' : 'north';
    const right: DirName = OPPOSITE[left];
    return Math.max(
      this.controlInputSignal(x + DIRS[left][0], y, z + DIRS[left][2], left),
      this.controlInputSignal(x + DIRS[right][0], y, z + DIRS[right][2], right),
    );
  }

  /** SignalGetter.getControlInputSignal (comparator/repeater side inputs). */
  private controlInputSignal(x: number, y: number, z: number, dir: DirName): number {
    const state = this.state(x, y, z);
    if (state === 0) return 0;
    const name = this.name(state);
    if (name === WIRE) return this.wirePowerAt(x, y, z);
    if (name === REDSTONE_BLOCK) return 15;
    if (!this.isSignalSourceName(name)) return 0;
    return this.directSignal(x, y, z, dir);
  }

  private isSignalSourceName(name: string): boolean {
    return name === WIRE || name === REPEATER || name === COMPARATOR || name === OBSERVER
      || name === DAYLIGHT_DETECTOR || name === TRIPWIRE_HOOK || name === REDSTONE_BLOCK
      || name === REDSTONE_TORCH || name === REDSTONE_WALL_TORCH || name === 'lever'
      || this.isButton(name) || this.isPressurePlate(name);
  }

  private comparatorShouldTurnOn(x: number, y: number, z: number, state: number): boolean {
    const input = this.comparatorInput(x, y, z, state);
    if (input === 0) return false;
    const side = this.comparatorSideSignal(x, y, z, state);
    return input > side || (input === side && this.prop(state, 'mode') !== 'subtract');
  }

  private calculateComparatorOutput(x: number, y: number, z: number, state: number): number {
    const input = this.comparatorInput(x, y, z, state);
    if (input === 0) return 0;
    const side = this.comparatorSideSignal(x, y, z, state);
    if (side > input) return 0;
    return this.prop(state, 'mode') === 'subtract' ? input - side : input;
  }

  private updateComparator(x: number, y: number, z: number, state: number): void {
    if (this.scheduled.has(this.scheduleKey('comparator', x, y, z))) return;
    const output = this.calculateComparatorOutput(x, y, z, state);
    const powered = this.bool(state, 'powered');
    if (output !== this.comparatorOutputAt(x, y, z) || powered !== this.comparatorShouldTurnOn(x, y, z, state)) {
      this.schedule(x, y, z, 'comparator', 2);
    }
  }

  private tickComparator(x: number, y: number, z: number): void {
    const state = this.state(x, y, z);
    if (state === 0 || this.name(state) !== COMPARATOR) return;
    this.refreshComparator(x, y, z, state);
  }

  /** ComparatorBlock.refreshOutputState. */
  private refreshComparator(x: number, y: number, z: number, state: number): void {
    const output = this.calculateComparatorOutput(x, y, z, state);
    const key = `${x},${y},${z}`;
    const old = this.comparatorOutput.get(key) ?? 0;
    this.comparatorOutput.set(key, output);
    if (old !== output || this.prop(state, 'mode') !== 'subtract') {
      const should = this.comparatorShouldTurnOn(x, y, z, state);
      if (this.bool(state, 'powered') !== should) {
        this.set(x, y, z, this.mc.withProp(state, 'powered', should ? 'true' : 'false'));
      }
      this.enqueueAround(x, y, z);
    }
  }

  // ---------------------------------------------------------------- observer

  /** ObserverBlock.updateShape: a change in the FACING block starts a 2 tick pulse. */
  private notifyObservers(x: number, y: number, z: number): void {
    for (const dir of DIR_LIST) {
      const ox = x + DIRS[dir][0], oy = y + DIRS[dir][1], oz = z + DIRS[dir][2];
      const state = this.state(ox, oy, oz);
      if (state === 0 || this.name(state) !== OBSERVER) continue;
      const facing = this.prop(state, 'facing');
      // FACING points from the observer toward the watched block.
      if (facing !== OPPOSITE[dir]) continue;
      if (this.bool(state, 'powered')) continue;
      if (this.scheduled.has(this.scheduleKey('observer', ox, oy, oz))) continue;
      this.schedule(ox, oy, oz, 'observer', 2);
    }
  }

  private tickObserver(x: number, y: number, z: number): void {
    const state = this.state(x, y, z);
    if (state === 0 || this.name(state) !== OBSERVER) return;
    if (this.bool(state, 'powered')) {
      this.set(x, y, z, this.mc.withProp(state, 'powered', 'false'));
    } else {
      this.set(x, y, z, this.mc.withProp(state, 'powered', 'true'));
      this.schedule(x, y, z, 'observer', 2);
    }
    this.enqueueAround(x, y, z);
  }

  // ---------------------------------------------------------------- daylight detector

  private updateDaylight(x: number, y: number, z: number, _state: number): void {
    if (this.scheduled.has(this.scheduleKey('daylight', x, y, z))) return;
    this.schedule(x, y, z, 'daylight', 20);
  }

  /** DaylightDetectorBlock.updateSignalStrength (sky light with the sun angle falloff). */
  private updateDaylightSignal(x: number, y: number, z: number, state: number): void {
    let daylight = Math.max(0, Math.min(15, this.level.getSkyLight(x, y, z)));
    if (daylight > 0) {
      const sunAngle = this.level.getTimeOfDay() * Math.PI * 2;
      daylight = Math.round(daylight * Math.max(0, Math.cos(sunAngle)));
    }
    // INVERTED is applied after the day/night brightness, like getEffectiveSkyBrightness.
    const target = this.bool(state, 'inverted') ? 15 - daylight : daylight;
    const next = this.mc.withProp(state, 'power', String(Math.max(0, Math.min(15, target))));
    if (next !== state) this.set(x, y, z, next);
  }

  private tickDaylight(x: number, y: number, z: number): void {
    const state = this.state(x, y, z);
    if (state === 0 || this.name(state) !== DAYLIGHT_DETECTOR) return;
    this.updateDaylightSignal(x, y, z, state);
    this.schedule(x, y, z, 'daylight', 20);
  }

  // ---------------------------------------------------------------- torches

  private torchHasNeighborSignal(x: number, y: number, z: number, state: number): boolean {
    if (this.name(state) === REDSTONE_WALL_TORCH) {
      const facing = (this.prop(state, 'facing') ?? 'north') as DirName;
      const dir = OPPOSITE[facing];
      return this.signal(x + DIRS[dir][0], y + DIRS[dir][1], z + DIRS[dir][2], dir) > 0;
    }
    return this.signal(x, y - 1, z, 'down') > 0;
  }

  private updateTorchNeighbor(x: number, y: number, z: number, state: number): void {
    if (this.bool(state, 'lit') === this.torchHasNeighborSignal(x, y, z, state)) {
      if (!this.scheduled.has(this.scheduleKey('torch', x, y, z))) this.schedule(x, y, z, 'torch', 2);
    }
  }

  private tickTorch(x: number, y: number, z: number): void {
    const state = this.state(x, y, z);
    if (state === 0) return;
    const name = this.name(state);
    if (name !== REDSTONE_TORCH && name !== REDSTONE_WALL_TORCH) return;
    const key = `${x},${y},${z}`;
    this.pruneTorchToggles(key);
    const signal = this.torchHasNeighborSignal(x, y, z, state);
    const lit = this.bool(state, 'lit');
    if (lit && signal) {
      this.set(x, y, z, this.mc.withProp(state, 'lit', 'false'));
      this.enqueueAround(x, y, z);
      // RedstoneTorchBlock.tick: 8 flips inside 60 ticks burn the torch out for 160 ticks.
      const toggles = this.torchToggles.get(key) ?? [];
      toggles.push(this.now);
      this.torchToggles.set(key, toggles);
      if (this.torchToggleCount(key) >= 8) {
        this.hooks.playSound('block.redstone_torch.burnout', x + 0.5, y + 0.5, z + 0.5);
        this.schedule(x, y, z, 'torchBurnout', 160);
      }
    } else if (!lit && !signal && this.torchToggleCount(key) < 8) {
      this.set(x, y, z, this.mc.withProp(state, 'lit', 'true'));
      this.enqueueAround(x, y, z);
    }
  }

  private tickTorchBurnout(x: number, y: number, z: number): void {
    const state = this.state(x, y, z);
    if (state === 0) return;
    const name = this.name(state);
    if (name !== REDSTONE_TORCH && name !== REDSTONE_WALL_TORCH) return;
    if (!this.bool(state, 'lit') && !this.torchHasNeighborSignal(x, y, z, state)) {
      this.set(x, y, z, this.mc.withProp(state, 'lit', 'true'));
      this.enqueueAround(x, y, z);
    }
  }

  private pruneTorchToggles(key: string): void {
    const toggles = this.torchToggles.get(key);
    if (!toggles) return;
    while (toggles.length > 0 && this.now - toggles[0] > 60) toggles.shift();
    if (toggles.length === 0) this.torchToggles.delete(key);
  }

  private torchToggleCount(key: string): number {
    return this.torchToggles.get(key)?.length ?? 0;
  }

  // ---------------------------------------------------------------- mechanisms

  private updateLamp(x: number, y: number, z: number, state: number): void {
    const lit = this.bool(state, 'lit');
    const powered = this.hasNeighborSignal(x, y, z);
    if (lit === powered) return;
    if (lit) {
      if (!this.scheduled.has(this.scheduleKey('lamp', x, y, z))) this.schedule(x, y, z, 'lamp', 4);
    } else {
      this.set(x, y, z, this.mc.withProp(state, 'lit', 'true'));
      this.enqueueAround(x, y, z);
    }
  }

  private tickLamp(x: number, y: number, z: number): void {
    const state = this.state(x, y, z);
    if (state === 0 || this.name(state) !== REDSTONE_LAMP) return;
    if (this.bool(state, 'lit') && !this.hasNeighborSignal(x, y, z)) {
      this.set(x, y, z, this.mc.withProp(state, 'lit', 'false'));
      this.enqueueAround(x, y, z);
    }
  }

  private updateDoor(x: number, y: number, z: number): void {
    const state = this.state(x, y, z);
    if (state === 0) return;
    const lowerY = this.prop(state, 'half') === 'lower' ? y : y - 1;
    const bottom = this.state(x, lowerY, z);
    const top = this.state(x, lowerY + 1, z);
    if (bottom === 0 || this.prop(bottom, 'half') !== 'lower') return;
    const signal = this.hasNeighborSignal(x, lowerY, z) || this.hasNeighborSignal(x, lowerY + 1, z);
    if (this.bool(bottom, 'powered') === signal) return;
    const open = signal;
    this.level.setBlockState(x, lowerY, z,
      this.mc.withProps(bottom, { powered: signal ? 'true' : 'false', open: open ? 'true' : 'false' }));
    if (top !== 0) {
      this.level.setBlockState(x, lowerY + 1, z,
        this.mc.withProps(top, { powered: signal ? 'true' : 'false', open: open ? 'true' : 'false' }));
    }
    const material = this.name(bottom).startsWith('iron') ? 'block.iron_door' : 'block.wooden_door';
    this.hooks.playSound(`${material}.${open ? 'open' : 'close'}`,
      x + 0.5, lowerY + 0.5, z + 0.5, 0.9 + Math.random() * 0.1);
    this.soundEvent(x, lowerY, z, open ? 'block_open' : 'block_close');
    this.enqueueAround(x, lowerY, z);
    this.enqueueAround(x, lowerY + 1, z);
  }

  private toggleDoor(x: number, y: number, z: number, state: number): void {
    const lowerY = this.prop(state, 'half') === 'lower' ? y : y - 1;
    const bottom = this.state(x, lowerY, z);
    const top = this.state(x, lowerY + 1, z);
    if (bottom === 0) return;
    const open = !this.bool(bottom, 'open');
    this.level.setBlockState(x, lowerY, z, this.mc.withProp(bottom, 'open', open ? 'true' : 'false'));
    if (top !== 0) this.level.setBlockState(x, lowerY + 1, z, this.mc.withProp(top, 'open', open ? 'true' : 'false'));
    const material = this.name(bottom).startsWith('iron') ? 'block.iron_door' : 'block.wooden_door';
    this.hooks.playSound(`${material}.${open ? 'open' : 'close'}`,
      x + 0.5, lowerY + 0.5, z + 0.5, 0.9 + Math.random() * 0.1);
    this.soundEvent(x, lowerY, z, open ? 'block_open' : 'block_close');
  }

  private updateTrapdoor(x: number, y: number, z: number, state: number): void {
    const signal = this.hasNeighborSignal(x, y, z);
    if (this.bool(state, 'powered') === signal) return;
    const open = signal;
    const next = this.mc.withProps(state, { powered: signal ? 'true' : 'false', open: open ? 'true' : 'false' });
    this.set(x, y, z, next);
    this.hooks.playSound(this.trapdoorSound(this.name(state), open),
      x + 0.5, y + 0.5, z + 0.5, 0.9 + Math.random() * 0.1);
    this.soundEvent(x, y, z, open ? 'block_open' : 'block_close');
    this.enqueueAround(x, y, z);
  }

  private updateGate(x: number, y: number, z: number, state: number): void {
    const power = this.hasNeighborSignal(x, y, z);
    if (this.bool(state, 'powered') === power) return;
    const next = this.mc.withProps(state, { powered: power ? 'true' : 'false', open: power ? 'true' : 'false' });
    this.set(x, y, z, next);
    this.hooks.playSound(power ? 'block.fence_gate.open' : 'block.fence_gate.close',
      x + 0.5, y + 0.5, z + 0.5, 0.9 + Math.random() * 0.1);
    this.soundEvent(x, y, z, power ? 'block_open' : 'block_close');
    this.enqueueAround(x, y, z);
  }

  // ---------------------------------------------------------------- buttons / plates

  private tickScheduled(): void {
    if (this.scheduled.size === 0) return;
    const due: Scheduled[] = [];
    for (const entry of this.scheduled.values()) {
      if (entry.at <= this.now) due.push(entry);
    }
    for (const entry of due) {
      this.scheduled.delete(this.scheduleKey(entry.kind, entry.x, entry.y, entry.z));
      if (entry.kind === 'button') this.tickButton(entry.x, entry.y, entry.z);
      else if (entry.kind === 'repeater') this.tickRepeater(entry.x, entry.y, entry.z);
      else if (entry.kind === 'comparator') this.tickComparator(entry.x, entry.y, entry.z);
      else if (entry.kind === 'observer') this.tickObserver(entry.x, entry.y, entry.z);
      else if (entry.kind === 'daylight') this.tickDaylight(entry.x, entry.y, entry.z);
      else if (entry.kind === 'torch') this.tickTorch(entry.x, entry.y, entry.z);
      else if (entry.kind === 'torchBurnout') this.tickTorchBurnout(entry.x, entry.y, entry.z);
      else this.tickLamp(entry.x, entry.y, entry.z);
    }
  }

  private tickButton(x: number, y: number, z: number): void {
    const state = this.state(x, y, z);
    if (state === 0 || !this.isButton(this.name(state))) return;
    if (!this.bool(state, 'powered')) return;
    this.set(x, y, z, this.mc.withProp(state, 'powered', 'false'));
    this.hooks.playSound(this.buttonSound(this.name(state), false),
      x + 0.5, y + 0.5, z + 0.5);
    this.soundEvent(x, y, z, 'block_deactivate');
    this.enqueueAround(x, y, z);
  }

  private tickPressurePlates(): void {
    const feet = this.hooks.entityFeet();
    const candidates = new Set<string>(this.activePlates);
    for (const foot of feet) {
      const x = Math.floor(foot.x);
      const y = Math.floor(foot.y - 0.01);
      const z = Math.floor(foot.z);
      const state = this.state(x, y, z);
      if (state !== 0 && this.isPressurePlate(this.name(state))) candidates.add(`${x},${y},${z}`);
    }
    if (candidates.size === 0) return;
    for (const key of candidates) {
      const [x, y, z] = key.split(',').map(Number);
      const state = this.state(x, y, z);
      if (state === 0 || !this.isPressurePlate(this.name(state))) {
        this.activePlates.delete(key);
        continue;
      }
      const box = new AABB(x + 0.0625, y, z + 0.0625, x + 0.9375, y + 0.25, z + 0.9375);
      const pressed = this.hooks.countEntities(box) > 0;
      const powered = this.bool(state, 'powered');
      if (pressed === powered) {
        if (pressed) this.activePlates.add(key);
        else this.activePlates.delete(key);
        continue;
      }
      this.set(x, y, z, this.mc.withProp(state, 'powered', pressed ? 'true' : 'false'));
      const material = this.name(state).includes('stone') ? 'block.stone_pressure_plate' : 'block.wooden_pressure_plate';
      this.hooks.playSound(`${material}.click_${pressed ? 'on' : 'off'}`, x + 0.5, y + 0.5, z + 0.5);
      this.soundEvent(x, y, z, pressed ? 'block_activate' : 'block_deactivate');
      this.enqueueAround(x, y, z);
      if (pressed) this.activePlates.add(key);
      else this.activePlates.delete(key);
    }
    this.flush();
  }

  // ---------------------------------------------------------------- tripwire

  /** TripWireBlock.updateShape: connect to adjacent tripwire or an aligned hook. */
  private updateTripWire(x: number, y: number, z: number, state: number): void {
    let next = state;
    for (const dir of HORIZONTAL) {
      const [dx, , dz] = DIRS[dir];
      const neighbour = this.state(x + dx, y, z + dz);
      const connected = this.tripwireConnectsTo(neighbour, dir);
      next = this.mc.withProp(next, dir, connected ? 'true' : 'false');
    }
    if (next !== state) this.set(x, y, z, next);
  }

  private tripwireConnectsTo(neighbour: number, dir: DirName): boolean {
    if (neighbour === 0) return false;
    const name = this.name(neighbour);
    if (name === TRIPWIRE) return true;
    if (name === TRIPWIRE_HOOK) return this.prop(neighbour, 'facing') === OPPOSITE[dir];
    return false;
  }

  /** TripWireHookBlock.calculateState: scan the line, mark ATTACHED/POWERED, drive both hooks. */
  private updateTripWireHook(x: number, y: number, z: number, state: number): void {
    const facing = (this.prop(state, 'facing') ?? 'north') as DirName;
    const wasAttached = this.bool(state, 'attached');
    const wasPowered = this.bool(state, 'powered');
    let attached = true;
    let powered = false;
    let receiver = 0;
    const wires: { x: number; y: number; z: number }[] = [];
    const [dx, dy, dz] = DIRS[facing];
    for (let i = 1; i < 42; i++) {
      const px = x + dx * i, py = y + dy * i, pz = z + dz * i;
      const neighbour = this.state(px, py, pz);
      if (neighbour === 0) {
        attached = false;
        break;
      }
      const name = this.name(neighbour);
      if (name === TRIPWIRE_HOOK) {
        if (this.prop(neighbour, 'facing') === OPPOSITE[facing]) receiver = i;
        break;
      }
      if (name !== TRIPWIRE) {
        attached = false;
        break;
      }
      if (this.bool(neighbour, 'disarmed')) attached = false;
      else if (this.bool(neighbour, 'powered')) powered = true;
      wires.push({ x: px, y: py, z: pz });
    }
    attached = attached && receiver > 1;
    powered = powered && attached;

    const next = this.mc.withProps(state, {
      attached: attached ? 'true' : 'false',
      powered: powered ? 'true' : 'false',
    });
    if (next !== state) this.set(x, y, z, next);

    if (receiver > 0) {
      const rx = x + dx * receiver, ry = y + dy * receiver, rz = z + dz * receiver;
      const far = this.state(rx, ry, rz);
      if (far !== 0 && this.name(far) === TRIPWIRE_HOOK) {
        const farNext = this.mc.withProps(far, {
          facing: OPPOSITE[facing],
          attached: attached ? 'true' : 'false',
          powered: powered ? 'true' : 'false',
        });
        if (farNext !== far) this.set(rx, ry, rz, farNext);
      }
    }

    if (attached !== wasAttached) {
      for (const wire of wires) {
        const cur = this.state(wire.x, wire.y, wire.z);
        if (cur !== 0 && this.name(cur) === TRIPWIRE) {
          const wireNext = this.mc.withProp(cur, 'attached', attached ? 'true' : 'false');
          if (wireNext !== cur) this.set(wire.x, wire.y, wire.z, wireNext);
        }
      }
    }

    if (powered !== wasPowered) {
      this.hooks.playSound(powered ? 'block.tripwire.click_on' : 'block.tripwire.click_off',
        x + 0.5, y + 0.5, z + 0.5, powered ? 0.6 : 0.5);
      this.soundEvent(x, y, z, powered ? 'block_activate' : 'block_deactivate');
    } else if (attached !== wasAttached) {
      this.hooks.playSound(attached ? 'block.tripwire.attach' : 'block.tripwire.detach',
        x + 0.5, y + 0.5, z + 0.5, attached ? 0.7 : 1.0);
    }
  }

  /** TripWireBlock.updateSource: refresh the hooks at both ends of the pressed wire. */
  private updateTripWireSources(x: number, y: number, z: number): void {
    for (const dir of ['south', 'west'] as const) {
      const [dx, , dz] = DIRS[dir];
      for (let i = 1; i < 42; i++) {
        const px = x + dx * i, py = y, pz = z + dz * i;
        const neighbour = this.state(px, py, pz);
        if (neighbour === 0) break;
        const name = this.name(neighbour);
        if (name === TRIPWIRE_HOOK) {
          if (this.prop(neighbour, 'facing') === OPPOSITE[dir]) {
            this.updateTripWireHook(px, py, pz, neighbour);
          }
          break;
        }
        if (name !== TRIPWIRE) break;
      }
    }
  }

  /** TripWireBlock.checkPressed, polled every tick with entity feet like pressure plates. */
  private tickTripwires(): void {
    const candidates = new Set<string>(this.activeTripwires);
    for (const foot of this.hooks.entityFeet()) {
      const x = Math.floor(foot.x);
      const z = Math.floor(foot.z);
      for (const y of [Math.floor(foot.y), Math.floor(foot.y) - 1]) {
        const state = this.state(x, y, z);
        if (state !== 0 && this.name(state) === TRIPWIRE) candidates.add(`${x},${y},${z}`);
      }
    }
    if (candidates.size === 0) return;
    for (const key of candidates) {
      const [x, y, z] = key.split(',').map(Number);
      const state = this.state(x, y, z);
      if (state === 0 || this.name(state) !== TRIPWIRE) {
        this.activeTripwires.delete(key);
        continue;
      }
      const attached = this.bool(state, 'attached');
      const box = attached
        ? new AABB(x, y + 0.0625, z, x + 1, y + 0.15625, z + 1)
        : new AABB(x, y, z, x + 1, y + 0.5, z + 1);
      const pressed = !this.bool(state, 'disarmed') && this.hooks.countEntities(box) > 0;
      if (pressed === this.bool(state, 'powered')) {
        if (pressed) this.activeTripwires.add(key);
        else this.activeTripwires.delete(key);
        continue;
      }
      this.set(x, y, z, this.mc.withProp(state, 'powered', pressed ? 'true' : 'false'));
      this.updateTripWireSources(x, y, z);
      if (pressed) this.activeTripwires.add(key);
      else this.activeTripwires.delete(key);
    }
    this.flush();
  }

  // ---------------------------------------------------------------- pistons
  // Ported from horizon-world `level/pistons.rs` (PistonBaseBlock/PistonStructureResolver):
  // isPushable, addBlockLine with the sticky back-scan, collision reorder, branching
  // blocks, and moveBlocks over the resolved lists. Movement itself is instantaneous
  // here (no moving_piston block entity/animation).

  /** PistonBaseBlock.getNeighborSignal (including quasi-connectivity one block above). */
  private pistonHasSignal(x: number, y: number, z: number, pushDir: DirName): boolean {
    for (const dir of DIR_LIST) {
      if (dir === pushDir) continue;
      const [dx, dy, dz] = DIRS[dir];
      if (this.signal(x + dx, y + dy, z + dz, dir) > 0) return true;
    }
    if (this.signal(x, y, z, 'down') > 0) return true;
    for (const dir of DIR_LIST) {
      if (dir === 'down') continue;
      const [dx, dy, dz] = DIRS[dir];
      if (this.signal(x + dx, y + 1 + dy, z + dz, dir) > 0) return true;
    }
    return false;
  }

  private updatePiston(x: number, y: number, z: number, state: number): void {
    const facing = (this.prop(state, 'facing') ?? 'north') as DirName;
    const powered = this.pistonHasSignal(x, y, z, facing);
    const extended = this.bool(state, 'extended');
    if (powered && !extended) {
      if (this.movePistonBlocks(x, y, z, facing, true)) {
        this.set(x, y, z, this.mc.withProp(state, 'extended', 'true'));
        this.hooks.playSound('block.piston.extend', x + 0.5, y + 0.5, z + 0.5);
      }
    } else if (!powered && extended) {
      if (this.name(state) === STICKY_PISTON) {
        this.movePistonBlocks(x, y, z, facing, false);
      } else {
        const [dx, dy, dz] = DIRS[facing];
        const headX = x + dx, headY = y + dy, headZ = z + dz;
        const head = this.state(headX, headY, headZ);
        if (head !== 0 && this.name(head) === PISTON_HEAD) {
          this.level.setBlockState(headX, headY, headZ, 0);
          this.notifyObservers(headX, headY, headZ);
          this.enqueueAround(headX, headY, headZ);
        }
      }
      this.set(x, y, z, this.mc.withProp(state, 'extended', 'false'));
      this.hooks.playSound('block.piston.contract', x + 0.5, y + 0.5, z + 0.5);
    }
  }

  private box(x: number, y: number, z: number): BoxPos { return { x, y, z }; }

  private relBox(pos: BoxPos, dir: DirName, n = 1): BoxPos {
    const [dx, dy, dz] = DIRS[dir];
    return { x: pos.x + dx * n, y: pos.y + dy * n, z: pos.z + dz * n };
  }

  private samePos(a: BoxPos, b: BoxPos): boolean {
    return a.x === b.x && a.y === b.y && a.z === b.z;
  }

  private containsPos(list: BoxPos[], pos: BoxPos): boolean {
    return list.some((p) => this.samePos(p, pos));
  }

  /** PistonBaseBlock.isPushable. */
  private pistonPushable(state: number, pos: BoxPos, direction: DirName,
    allowDestroyable: boolean, _connection: DirName): boolean {
    const minY = this.level.minY;
    const maxY = this.level.minY + this.level.height - 1;
    if (pos.y < minY || pos.y > maxY) return false;
    if (direction === 'down' && pos.y === minY) return false;
    if (direction === 'up' && pos.y === maxY) return false;
    const name = this.name(state);
    if (state === 0 || this.mc.isAir(state)) return true;
    if (PISTON_IMMOVABLE.has(name)) return false;
    if (this.mc.hardness[state] < 0) return false;
    const piston = name === PISTON || name === STICKY_PISTON;
    if (piston) {
      if (this.bool(state, 'extended')) return false;
    } else if (REPLACEABLE_FOR_PISTON.has(name)) {
      // PushReaction.DESTROY / POP: destroyed only while extending.
      return allowDestroyable;
    }
    return true;
  }

  private isStickyBlock(state: number): boolean {
    const name = this.name(state);
    return name === 'slime_block' || name === 'honey_block';
  }

  /** PistonStructureResolver.canStickToEachOther: slime and honey never stick to each other. */
  private canStick(first: number, second: number): boolean {
    const a = this.name(first);
    const b = this.name(second);
    if (a === 'honey_block' && b === 'slime_block') return false;
    if (a === 'slime_block' && b === 'honey_block') return false;
    return this.isStickyBlock(first) || this.isStickyBlock(second);
  }

  private axisOfDir(dir: DirName): string {
    if (dir === 'down' || dir === 'up') return 'y';
    if (dir === 'north' || dir === 'south') return 'z';
    return 'x';
  }

  /** PistonStructureResolver.resolve. */
  private resolvePiston(x: number, y: number, z: number, direction: DirName,
    extending: boolean): PistonResolve | null {
    const pistonPos = this.box(x, y, z);
    const pushDirection: DirName = extending ? direction : OPPOSITE[direction];
    const start = extending ? this.relBox(pistonPos, direction) : this.relBox(pistonPos, direction, 2);
    const resolved: PistonResolve = { toPush: [], toDestroy: [], pushDirection };
    const next = this.state(start.x, start.y, start.z);
    if (!this.pistonPushable(next, start, pushDirection, false, direction)) {
      if (extending && REPLACEABLE_FOR_PISTON.has(this.name(next))
        && this.pistonPushable(next, start, pushDirection, true, direction)) {
        resolved.toDestroy.push(start);
        return resolved;
      }
      return null;
    }
    if (!this.addBlockLine(resolved, pistonPos, start, pushDirection)) return null;
    for (let i = 0; i < resolved.toPush.length; i++) {
      const pos = resolved.toPush[i];
      if (this.isStickyBlock(this.state(pos.x, pos.y, pos.z))
        && !this.addBranchingBlocks(resolved, pistonPos, pos)) return null;
    }
    return resolved;
  }

  /** PistonStructureResolver.addBlockLine. */
  private addBlockLine(r: PistonResolve, pistonPos: BoxPos, start: BoxPos,
    direction: DirName): boolean {
    let next = this.state(start.x, start.y, start.z);
    if (next === 0 || this.mc.isAir(next)) return true;
    if (!this.pistonPushable(next, start, r.pushDirection, false, direction)
      || this.samePos(start, pistonPos) || this.containsPos(r.toPush, start)) return true;
    let count = 1;
    if (count + r.toPush.length > 12) return false;
    while (this.isStickyBlock(next)) {
      const pos = this.relBox(start, OPPOSITE[r.pushDirection], count);
      const previous = next;
      next = this.state(pos.x, pos.y, pos.z);
      if (next === 0 || this.mc.isAir(next) || !this.canStick(previous, next)
        || !this.pistonPushable(next, pos, r.pushDirection, false, OPPOSITE[r.pushDirection])
        || this.samePos(pos, pistonPos)) break;
      count++;
      if (count + r.toPush.length > 12) return false;
    }
    let added = 0;
    for (let i = count - 1; i >= 0; i--) {
      r.toPush.push(this.relBox(start, OPPOSITE[r.pushDirection], i));
      added++;
    }
    let i = 1;
    for (;;) {
      const pos = this.relBox(start, r.pushDirection, i);
      const collision = r.toPush.findIndex((p) => this.samePos(p, pos));
      if (collision >= 0) {
        this.reorderAtCollision(r, added, collision);
        for (let j = 0; j <= collision + added; j++) {
          const blockPos = r.toPush[j];
          if (this.isStickyBlock(this.state(blockPos.x, blockPos.y, blockPos.z))
            && !this.addBranchingBlocks(r, pistonPos, blockPos)) return false;
        }
        return true;
      }
      next = this.state(pos.x, pos.y, pos.z);
      if (next === 0 || this.mc.isAir(next)) return true;
      if (!this.pistonPushable(next, pos, r.pushDirection, true, r.pushDirection)
        || this.samePos(pos, pistonPos)) return false;
      if (REPLACEABLE_FOR_PISTON.has(this.name(next))) {
        r.toDestroy.push(pos);
        return true;
      }
      if (r.toPush.length >= 12) return false;
      r.toPush.push(pos);
      added++;
      i++;
    }
  }

  private reorderAtCollision(r: PistonResolve, added: number, collision: number): void {
    const len = r.toPush.length;
    const head = r.toPush.slice(0, collision);
    const lastLine = r.toPush.slice(len - added);
    const middle = r.toPush.slice(collision, len - added);
    r.toPush = [...head, ...lastLine, ...middle];
  }

  /** PistonStructureResolver.addBranchingBlocks. */
  private addBranchingBlocks(r: PistonResolve, pistonPos: BoxPos, from: BoxPos): boolean {
    const fromState = this.state(from.x, from.y, from.z);
    for (const dir of DIR_LIST) {
      if (this.axisOfDir(dir) === this.axisOfDir(r.pushDirection)) continue;
      const neighbour = this.relBox(from, dir);
      const neighbourState = this.state(neighbour.x, neighbour.y, neighbour.z);
      if (this.canStick(neighbourState, fromState)
        && !this.addBlockLine(r, pistonPos, neighbour, dir)) return false;
    }
    return true;
  }

  /** PistonBaseBlock.moveBlocks: mutate the world for the resolved structure. */
  private movePistonBlocks(x: number, y: number, z: number, direction: DirName,
    extending: boolean): boolean {
    const [dx, dy, dz] = DIRS[direction];
    if (!extending) {
      const headX = x + dx, headY = y + dy, headZ = z + dz;
      const head = this.state(headX, headY, headZ);
      if (head !== 0 && this.name(head) === PISTON_HEAD) {
        this.level.setBlockState(headX, headY, headZ, 0);
        this.notifyObservers(headX, headY, headZ);
      }
    }
    const resolved = this.resolvePiston(x, y, z, direction, extending);
    if (!resolved) return false;
    const { toPush, toDestroy, pushDirection } = resolved;
    const [px, py, pz] = DIRS[pushDirection];

    for (const pos of toDestroy) {
      this.level.setBlockState(pos.x, pos.y, pos.z, 0);
      this.notifyObservers(pos.x, pos.y, pos.z);
      this.enqueueAround(pos.x, pos.y, pos.z);
    }

    const saved = toPush.map((pos) => ({
      pos, state: this.state(pos.x, pos.y, pos.z),
    }));
    for (let i = saved.length - 1; i >= 0; i--) {
      const block = saved[i];
      const dest = { x: block.pos.x + px, y: block.pos.y + py, z: block.pos.z + pz };
      this.level.setBlockState(block.pos.x, block.pos.y, block.pos.z, 0);
      this.level.setBlockState(dest.x, dest.y, dest.z, block.state);
      this.notifyObservers(block.pos.x, block.pos.y, block.pos.z);
      this.notifyObservers(dest.x, dest.y, dest.z);
      this.enqueueAround(block.pos.x, block.pos.y, block.pos.z);
      this.enqueueAround(dest.x, dest.y, dest.z);
    }

    if (extending) {
      const headX = x + dx, headY = y + dy, headZ = z + dz;
      this.level.setBlockState(headX, headY, headZ, this.mc.stateOf(PISTON_HEAD, {
        facing: direction,
        short: 'false',
        type: this.name(this.state(x, y, z)) === STICKY_PISTON ? 'sticky' : 'normal',
      }));
      this.notifyObservers(headX, headY, headZ);
      this.enqueueAround(headX, headY, headZ);
    }
    return true;
  }

  /** PistonHeadBlock: the head only exists in front of an extended matching piston. */
  private updatePistonHead(x: number, y: number, z: number, state: number): void {
    const facing = (this.prop(state, 'facing') ?? 'north') as DirName;
    const [dx, dy, dz] = DIRS[facing];
    const base = this.state(x - dx, y - dy, z - dz);
    const name = base === 0 ? '' : this.name(base);
    const valid = (name === PISTON || name === STICKY_PISTON)
      && this.bool(base, 'extended') && this.prop(base, 'facing') === facing;
    if (!valid) {
      this.level.setBlockState(x, y, z, 0);
      this.notifyObservers(x, y, z);
    }
  }

  // ---------------------------------------------------------------- rails

  private updateRail(x: number, y: number, z: number, state: number): void {
    const name = this.name(state);
    if (name === 'powered_rail' || name === 'activator_rail') {
      const powered = this.hasNeighborSignal(x, y, z);
      if (this.bool(state, 'powered') !== powered) {
        state = this.mc.withProp(state, 'powered', powered ? 'true' : 'false');
        this.set(x, y, z, state);
      }
    }
    const shape = this.railShape(x, y, z, state);
    if (this.prop(state, 'shape') !== shape) this.set(x, y, z, this.mc.withProp(state, 'shape', shape));
  }

  /** RailState.place simplified to same-level neighbors (slope detection included). */
  private railShape(x: number, y: number, z: number, state: number): string {
    const hasRail = (nx: number, ny: number, nz: number): boolean => {
      const s = this.state(nx, ny, nz);
      return s !== 0 && RAIL_BLOCKS.has(this.name(s));
    };
    const n = hasRail(x, y, z - 1) || hasRail(x, y + 1, z - 1) || hasRail(x, y - 1, z - 1);
    const s = hasRail(x, y, z + 1) || hasRail(x, y + 1, z + 1) || hasRail(x, y - 1, z + 1);
    const w = hasRail(x - 1, y, z) || hasRail(x - 1, y + 1, z) || hasRail(x - 1, y - 1, z);
    const e = hasRail(x + 1, y, z) || hasRail(x + 1, y + 1, z) || hasRail(x + 1, y - 1, z);
    let shape = '';
    if ((n || s) && !(w || e)) shape = 'north_south';
    else if ((w || e) && !(n || s)) shape = 'east_west';
    else if (n && s && !w && !e) shape = 'north_south';
    else if (w && e && !n && !s) shape = 'east_west';
    else if (s && e && !n && !w) shape = 'south_east';
    else if (s && w && !n && !e) shape = 'south_west';
    else if (n && w && !s && !e) shape = 'north_west';
    else if (n && e && !s && !w) shape = 'north_east';
    else shape = this.prop(state, 'shape') ?? 'north_south';

    if (shape === 'north_south') {
      if (hasRail(x, y + 1, z - 1)) shape = 'ascending_north';
      else if (hasRail(x, y + 1, z + 1)) shape = 'ascending_south';
    } else if (shape === 'east_west') {
      if (hasRail(x + 1, y + 1, z)) shape = 'ascending_east';
      else if (hasRail(x - 1, y + 1, z)) shape = 'ascending_west';
    }
    return shape;
  }

  // ---------------------------------------------------------------- helpers

  private schedule(x: number, y: number, z: number, kind: Scheduled['kind'], delay: number): void {
    const key = this.scheduleKey(kind, x, y, z);
    if (this.scheduled.has(key)) return;
    this.scheduled.set(key, { at: this.now + Math.max(1, delay), x, y, z, kind });
  }

  private scheduleKey(kind: string, x: number, y: number, z: number): string {
    return `${kind}@${x},${y},${z}`;
  }

  private set(x: number, y: number, z: number, state: number): void {
    if (this.state(x, y, z) === state) return;
    this.level.setBlockState(x, y, z, state);
    this.enqueueAround(x, y, z);
    this.notifyObservers(x, y, z);
  }

  private state(x: number, y: number, z: number): number {
    return this.level.getBlockState(x, y, z);
  }

  private name(state: number): string {
    return this.mc.blockOf(state).name;
  }

  private prop(state: number, name: string): string | undefined {
    return this.mc.getProp(state, name);
  }

  private bool(state: number, name: string): boolean {
    return this.mc.getProp(state, name) === 'true';
  }

  private isConductor(state: number): boolean {
    return this.mc.isSolid(state);
  }

  private attachedDir(state: number): DirName {
    const face = this.prop(state, 'face');
    if (face === 'floor') return 'down';
    if (face === 'ceiling') return 'up';
    const facing = (this.prop(state, 'facing') ?? 'north') as DirName;
    return OPPOSITE[facing];
  }

  private isButton(name: string): boolean { return name.endsWith('_button'); }
  private isPressurePlate(name: string): boolean { return name.endsWith('_pressure_plate'); }
  private isDoor(name: string): boolean { return name.endsWith('_door') && !name.endsWith('_trapdoor'); }
  private isTrapdoor(name: string): boolean { return name.endsWith('_trapdoor'); }
  private isGate(name: string): boolean { return name.endsWith('_fence_gate'); }

  private buttonSound(name: string, on: boolean): string {
    const wood = !name.includes('stone') && !name.includes('polished_blackstone');
    return wood
      ? `block.wooden_button.click_${on ? 'on' : 'off'}`
      : `block.stone_button.click_${on ? 'on' : 'off'}`;
  }

  private trapdoorSound(name: string, open: boolean): string {
    const material = name.startsWith('iron') ? 'block.iron_trapdoor' : 'block.wooden_trapdoor';
    return `${material}.${open ? 'open' : 'close'}`;
  }

  /** Vanilla block game events; the client has no listener, kept as a call site. */
  private soundEvent(_x: number, _y: number, _z: number, _event: string): void {}
}
