// Runtime view of the vanilla block state registry.
//
// The numbers come from scripts/build-data.mjs, which runs the real 26.2 code:
//   blocks.bin - per state gameplay values (light, shapes, hardness, model ids)
//   blocks.json- block metadata and property tables
//
// State ids are the vanilla Block.BLOCK_STATE_REGISTRY ids, so a state id means the
// same thing here as it does in the original client.

import { AABB } from '../../../../core/Geometry.js';

export interface PropertyDef {
  name: string;
  values: string[];
}

export interface BlockMeta {
  name: string;
  cls: string;
  item: string | null;
  props: PropertyDef[];
  radix: number[];
  defaultState: number;
  hardness: number;
  resistance: number;
  requiresTool: number;
  randomTicks: number;
  sound: string;
  /** mixed radix local index -> state id */
  localIndex: number[];
  maxStack: number;
}

export interface ItemMeta {
  name: string;
  maxStack: number;
  maxDamage: number;
  rarity: string;
  block: string;
  food: string;
  tool: { tag: string; speed: number }[];
  equip: string;
}

export interface EntityMeta {
  name: string;
  w: number;
  h: number;
  fireImmune: number;
  category: string;
}

/** Flag bits stored per state (see build-data.mjs). */
export const STATE_SOLID = 1;
export const STATE_OCCLUDE = 2;
export const STATE_PROPAGATES_SKY = 4;
export const STATE_AIR = 8;
export const STATE_LIQUID = 16;
export const STATE_HAS_FLUID = 32;
export const STATE_EMISSIVE = 64;
export const STATE_USE_SHAPE_LIGHT = 128;

export class MinecraftData {
  readonly blocks: BlockMeta[] = [];
  readonly blockByName = new Map<string, number>();
  readonly items: ItemMeta[] = [];
  readonly itemByName = new Map<string, number>();
  readonly entities: EntityMeta[] = [];
  readonly entityByName = new Map<string, number>();

  // per state arrays
  stateBlock!: Uint16Array;
  lightEmission!: Uint8Array;
  lightDampening!: Uint8Array;
  stateFlags!: Uint8Array;
  faceMask!: Uint8Array;
  hardness!: Float32Array;
  collisionShapeIdx!: Uint16Array;
  outlineShapeIdx!: Uint16Array;
  modelOffset!: Uint32Array;
  modelCount!: Uint16Array;
  propOffset!: Uint32Array;
  propIndices!: Uint16Array;
  modelIds!: Uint16Array;

  // shape pool, flat: boxes[shapeBoxStart[i] .. +shapeBoxCount[i]]
  shapeBoxStart!: Uint32Array;
  shapeBoxes!: Float32Array;
  shapeCache: (AABB[] | undefined)[] = [];

  stateCount = 0;

  static async load(base = '/mc'): Promise<MinecraftData> {
    const data = new MinecraftData();
    const [metaRes, binRes] = await Promise.all([
      fetch(`${base}/blocks.json`),
      fetch(`${base}/blocks.bin`),
    ]);
    if (!metaRes.ok || !binRes.ok) throw new Error('failed to load block data');
    const meta = await metaRes.json();
    const buf = await binRes.arrayBuffer();
    data.initMeta(meta);
    data.initBinary(buf);
    return data;
  }

  initMeta(meta: { blocks: BlockMeta[]; items: ItemMeta[]; entities: EntityMeta[] }) {
    meta.blocks.forEach((b, i) => {
      this.blocks.push(b);
      this.blockByName.set(b.name, i);
    });
    meta.items.forEach((it, i) => {
      this.items.push(it);
      this.itemByName.set(it.name, i);
    });
    meta.entities.forEach((e, i) => {
      this.entities.push(e);
      this.entityByName.set(e.name, i);
    });
  }

  initBinary(buffer: ArrayBuffer) {
    const dv = new DataView(buffer);
    if (dv.getUint32(0, true) !== 0x57434232) throw new Error('bad blocks.bin magic');
    const version = dv.getUint32(4, true);
    if (version !== 2) throw new Error(`unsupported blocks.bin version ${version}`);
    this.stateCount = dv.getUint32(8, true);
    const shapeCount = dv.getUint32(16, true);
    const modelIdCount = dv.getUint32(20, true);
    const propCount = dv.getUint32(24, true);
    const tableAt = dv.getUint32(56, true);

    const names = ['blockId', 'lightEmission', 'lightDampening', 'flags', 'faceMask', 'hardness',
      'collisionShape', 'outlineShape', 'modelOffset', 'modelCount', 'propOffset', 'modelIds',
      'propIndices', 'shapeBoxCounts', 'shapeBoxes'];
    const off: Record<string, number> = {};
    names.forEach((n, i) => { off[n] = dv.getUint32(tableAt + i * 4, true); });

    const n = this.stateCount;
    this.stateBlock = new Uint16Array(buffer, off.blockId, n);
    this.lightEmission = new Uint8Array(buffer, off.lightEmission, n);
    this.lightDampening = new Uint8Array(buffer, off.lightDampening, n);
    this.stateFlags = new Uint8Array(buffer, off.flags, n);
    this.faceMask = new Uint8Array(buffer, off.faceMask, n);
    this.hardness = new Float32Array(buffer, off.hardness, n);
    this.collisionShapeIdx = new Uint16Array(buffer, off.collisionShape, n);
    this.outlineShapeIdx = new Uint16Array(buffer, off.outlineShape, n);
    this.modelOffset = new Uint32Array(buffer, off.modelOffset, n);
    this.modelCount = new Uint16Array(buffer, off.modelCount, n);
    this.propOffset = new Uint32Array(buffer, off.propOffset, n);
    this.modelIds = new Uint16Array(buffer, off.modelIds, modelIdCount);
    this.propIndices = new Uint16Array(buffer, off.propIndices, propCount);

    const counts = new Uint16Array(buffer, off.shapeBoxCounts, shapeCount);
    const start = new Uint32Array(shapeCount + 1);
    for (let i = 0; i < shapeCount; i++) start[i + 1] = start[i] + counts[i];
    this.shapeBoxStart = start;
    this.shapeBoxes = new Float32Array(buffer, off.shapeBoxes, start[shapeCount] * 6);
    this.shapeCache = new Array(shapeCount);
  }

  // ---- state helpers -------------------------------------------------------

  blockOf(state: number): BlockMeta { return this.blocks[this.stateBlock[state]]; }
  blockIdOf(state: number): number { return this.stateBlock[state]; }

  isAir(state: number): boolean { return (this.stateFlags[state] & STATE_AIR) !== 0; }
  isSolid(state: number): boolean { return (this.stateFlags[state] & STATE_SOLID) !== 0; }
  canOcclude(state: number): boolean { return (this.stateFlags[state] & STATE_OCCLUDE) !== 0; }
  isLiquid(state: number): boolean { return (this.stateFlags[state] & STATE_LIQUID) !== 0; }
  hasFluid(state: number): boolean { return (this.stateFlags[state] & STATE_HAS_FLUID) !== 0; }
  propagatesSky(state: number): boolean { return (this.stateFlags[state] & STATE_PROPAGATES_SKY) !== 0; }
  isEmissive(state: number): boolean { return (this.stateFlags[state] & STATE_EMISSIVE) !== 0; }
  usesShapeForLight(state: number): boolean { return (this.stateFlags[state] & STATE_USE_SHAPE_LIGHT) !== 0; }

  lightOf(state: number): number { return this.lightEmission[state]; }
  dampOf(state: number): number { return this.lightDampening[state]; }

  /** The selected-box shape (vanilla getShape). */
  outline(state: number): AABB[] { return this.shapeAt(this.outlineShapeIdx[state]); }
  /** The collision shape (vanilla getCollisionShape). */
  collision(state: number): AABB[] { return this.shapeAt(this.collisionShapeIdx[state]); }

  shapeAt(index: number): AABB[] {
    let cached = this.shapeCache[index];
    if (cached) return cached;
    const start = this.shapeBoxStart[index];
    const end = this.shapeBoxStart[index + 1];
    cached = [];
    for (let i = start; i < end; i++) {
      const o = i * 6;
      cached.push(new AABB(
        this.shapeBoxes[o], this.shapeBoxes[o + 1], this.shapeBoxes[o + 2],
        this.shapeBoxes[o + 3], this.shapeBoxes[o + 4], this.shapeBoxes[o + 5],
      ));
    }
    this.shapeCache[index] = cached;
    return cached;
  }

  /** Vanilla BlockState.isFaceSturdy, precomputed in the dump. */
  isFaceSturdy(state: number, dir: number): boolean {
    return (this.faceMask[state] & (1 << dir)) !== 0;
  }

  // ---- property helpers ----------------------------------------------------

  propertyIndex(blockId: number, name: string): number {
    const props = this.blocks[blockId].props;
    for (let i = 0; i < props.length; i++) if (props[i].name === name) return i;
    return -1;
  }

  propertyValueIndex(blockId: number, propIndex: number, value: string): number {
    return this.blocks[blockId].props[propIndex].values.indexOf(value);
  }

  /** Reads a property value name for a state. */
  getProp(state: number, name: string): string | undefined {
    const blockId = this.stateBlock[state];
    const meta = this.blocks[blockId];
    const pi = this.propertyIndex(blockId, name);
    if (pi < 0) return undefined;
    const vi = this.propIndices[this.propOffset[state] + pi];
    return meta.props[pi].values[vi];
  }

  /** Reads a property value index for a state. */
  getPropIndex(state: number, propIndex: number): number {
    return this.propIndices[this.propOffset[state] + propIndex];
  }

  /**
   * Vanilla BlockState.setValue: rebuild the mixed radix local index from the
   * state's property values, then look the state id up.
   */
  withProp(state: number, name: string, value: string): number {
    const blockId = this.stateBlock[state];
    const meta = this.blocks[blockId];
    const pi = this.propertyIndex(blockId, name);
    if (pi < 0) return state;
    const vi = meta.props[pi].values.indexOf(value);
    if (vi < 0) return state;
    let local = 0;
    for (let i = 0; i < meta.radix.length; i++) {
      const cur = i === pi ? vi : this.propIndices[this.propOffset[state] + i];
      local = local * meta.radix[i] + cur;
    }
    const id = meta.localIndex[local];
    return id === undefined ? state : id;
  }

  withProps(state: number, values: Record<string, string>): number {
    let out = state;
    for (const [k, v] of Object.entries(values)) out = this.withProp(out, k, v);
    return out;
  }

  /** Builds a state from a block name and a property map. Missing props use the default. */
  stateOf(blockName: string, values?: Record<string, string>): number {
    const blockId = this.blockByName.get(blockName);
    if (blockId === undefined) throw new Error(`unknown block ${blockName}`);
    let state = this.blocks[blockId].defaultState;
    if (values) state = this.withProps(state, values);
    return state;
  }

  /** Same block, same properties except the ones given. */
  cycle(state: number, name: string): number {
    const blockId = this.stateBlock[state];
    const pi = this.propertyIndex(blockId, name);
    if (pi < 0) return state;
    const values = this.blocks[blockId].props[pi].values;
    const cur = this.propIndices[this.propOffset[state] + pi];
    return this.withProp(state, name, values[(cur + 1) % values.length]);
  }

  modelRange(state: number): [number, number] {
    return [this.modelOffset[state], this.modelCount[state]];
  }
}

/** Convenience singleton, populated before the world starts. */
export let MC: MinecraftData;

export function setMinecraftData(data: MinecraftData) { MC = data; }
