// Port of the player NBT written by net.minecraft.world.level.storage.PlayerDataStorage /
// ServerPlayer.saveWithoutId (addAdditionalSaveData). Standard fields: Pos, Motion, Rotation,
// OnGround, FallDistance, Health, foodLevel, Inventory, SelectedItemSlot, XpLevel, ...
// The main agent's opaque `extra` record is stored losslessly under `Extra` (generic value<->
// NBT conversion in NbtUtils), so inventory/hotbar/xp survive with no schema coupling.

import { CompoundTag } from '../../../nbt/CompoundTag.js';
import { ListTag } from '../../../nbt/ListTag.js';
import { DoubleTag } from '../../../nbt/DoubleTag.js';
import { FloatTag } from '../../../nbt/FloatTag.js';
import { IntTag } from '../../../nbt/IntTag.js';
import { writeRecord, readRecord } from '../../../nbt/NbtUtils.js';

/** Structural view of the runtime Player (avoids importing the full class). */
export interface PlayerLike {
  pos: { x: number; y: number; z: number };
  vel?: { x: number; y: number; z: number };
  yaw: number;
  pitch: number;
  onGround?: boolean;
  fallDistance?: number;
}

export interface ItemStackData {
  slot: number;
  id: string | number;
  count: number;
  numericId?: number;
  components?: Record<string, unknown>;
  [key: string]: unknown;
}

/** Opaque extras supplied by the main agent. */
export type PlayerExtra = Record<string, unknown>;

export interface PlayerSaveView {
  pos: { x: number; y: number; z: number };
  motion: { x: number; y: number; z: number };
  rotation: { yaw: number; pitch: number };
  onGround: boolean;
  fallDistance: number;
  health: number;
  foodLevel: number;
  foodSaturationLevel: number;
  inventory: ItemStackData[];
  selectedItemSlot: number;
  xpLevel: number;
  xpP: number;
  xpTotal: number;
  extra: PlayerExtra;
}

function vecList(x: number, y: number, z: number, Ctor: typeof DoubleTag | typeof FloatTag): ListTag {
  const l = new ListTag();
  l.add(Ctor.of(x)); l.add(Ctor.of(y)); l.add(Ctor.of(z));
  return l;
}

function itemToTag(stack: ItemStackData): CompoundTag {
  const c = new CompoundTag();
  c.putByte('Slot', stack.slot);
  c.putString('id', typeof stack.id === 'number' ? String(stack.id) : stack.id);
  c.putByte('Count', stack.count);
  if (stack.numericId !== undefined) c.putInt('NumericId', stack.numericId);
  if (stack.components) writeRecord(c, { components: stack.components });
  return c;
}

function tagToItem(c: CompoundTag): ItemStackData {
  const components = c.getCompound('components');
  return {
    slot: c.getByteOr('Slot', 0),
    id: c.getStringOr('id', 'air'),
    count: c.getByteOr('Count', 0),
    numericId: c.getInt('NumericId'),
    components: components ? (readRecord(components) as Record<string, unknown>) : undefined,
  };
}

export class PlayerData {
  /** Builds the player NBT tree from a Player-like object + opaque extras. */
  static toNbt(player: PlayerLike, extra: PlayerExtra = {}): CompoundTag {
    const root = new CompoundTag();
    const pos = player.pos;
    const vel = player.vel ?? { x: 0, y: 0, z: 0 };
    root.put('Pos', vecList(pos.x, pos.y, pos.z, DoubleTag));
    root.put('Motion', vecList(vel.x, vel.y, vel.z, DoubleTag));
    const rot = new ListTag();
    rot.add(FloatTag.of(player.yaw));
    rot.add(FloatTag.of(player.pitch));
    root.put('Rotation', rot);
    root.putBoolean('OnGround', player.onGround ?? false);
    root.putFloat('FallDistance', player.fallDistance ?? 0);
    root.putFloat('Health', num(extra.health, 20));
    root.putInt('foodLevel', num(extra.foodLevel, 20));
    root.putFloat('foodSaturationLevel', num(extra.foodSaturationLevel, 5));
    root.putInt('foodTickTimer', num(extra.foodTickTimer, 0));
    root.putInt('SelectedItemSlot', num(extra.selectedItemSlot, 0));
    root.putInt('XpLevel', num(extra.xpLevel, 0));
    root.putFloat('XpP', num(extra.xpP, 0));
    root.putInt('XpTotal', num(extra.xpTotal, 0));
    root.putInt('XpSeed', num(extra.xpSeed, 0));
    root.putInt('playerGameType', num(extra.playerGameType, 0));
    root.putShort('Air', 300);
    root.putShort('Fire', 0);
    root.putShort('HurtTime', 0);
    root.putShort('DeathTime', 0);
    root.putBoolean('Sleeping', false);
    root.putShort('SleepTimer', 0);

    const inventory = new ListTag();
    const items = Array.isArray(extra.inventory) ? (extra.inventory as ItemStackData[]) : [];
    for (const stack of items) inventory.add(itemToTag(stack));
    root.put('Inventory', inventory);

    const ender = new ListTag();
    const enderItems = Array.isArray(extra.enderItems) ? (extra.enderItems as ItemStackData[]) : [];
    for (const stack of enderItems) ender.add(itemToTag(stack));
    root.put('EnderItems', ender);

    const abilities = new CompoundTag();
    if (extra.abilities && typeof extra.abilities === 'object') writeRecord(abilities, extra.abilities as Record<string, unknown>);
    root.put('abilities', abilities);

    // Lossless opaque extras (survives arbitrary inventory/hotbar shapes).
    const extraTag = new CompoundTag();
    writeRecord(extraTag, extra);
    root.put('Extra', extraTag);
    return root;
  }

  /** Reads a player NBT tree into a structured view. */
  static fromNbt(root: CompoundTag): PlayerSaveView {
    const pos = root.getListOrEmpty('Pos');
    const motion = root.getListOrEmpty('Motion');
    const rotation = root.getListOrEmpty('Rotation');
    const inventory: ItemStackData[] = [];
    for (const el of root.getListOrEmpty('Inventory').list) {
      if (el instanceof CompoundTag) inventory.push(tagToItem(el));
    }
    const extra = root.getCompound('Extra');
    return {
      pos: {
        x: pos.get(0) instanceof DoubleTag ? (pos.get(0) as DoubleTag).value : 0,
        y: pos.get(1) instanceof DoubleTag ? (pos.get(1) as DoubleTag).value : 0,
        z: pos.get(2) instanceof DoubleTag ? (pos.get(2) as DoubleTag).value : 0,
      },
      motion: {
        x: motion.get(0) instanceof DoubleTag ? (motion.get(0) as DoubleTag).value : 0,
        y: motion.get(1) instanceof DoubleTag ? (motion.get(1) as DoubleTag).value : 0,
        z: motion.get(2) instanceof DoubleTag ? (motion.get(2) as DoubleTag).value : 0,
      },
      rotation: {
        yaw: rotation.get(0) instanceof FloatTag ? (rotation.get(0) as FloatTag).value : 0,
        pitch: rotation.get(1) instanceof FloatTag ? (rotation.get(1) as FloatTag).value : 0,
      },
      onGround: root.getBooleanOr('OnGround', false),
      fallDistance: root.getFloatOr('FallDistance', 0),
      health: root.getFloatOr('Health', 20),
      foodLevel: root.getIntOr('foodLevel', 20),
      foodSaturationLevel: root.getFloatOr('foodSaturationLevel', 5),
      inventory,
      selectedItemSlot: root.getIntOr('SelectedItemSlot', 0),
      xpLevel: root.getIntOr('XpLevel', 0),
      xpP: root.getFloatOr('XpP', 0),
      xpTotal: root.getIntOr('XpTotal', 0),
      extra: extra ? readRecord(extra) : {},
    };
  }

  /** Applies position/velocity/rotation from NBT back onto a live Player. */
  static applyToPlayer(root: CompoundTag, player: PlayerLike & { pos: { x: number; y: number; z: number }; vel?: { x: number; y: number; z: number } }): void {
    const view = PlayerData.fromNbt(root);
    player.pos.x = view.pos.x;
    player.pos.y = view.pos.y;
    player.pos.z = view.pos.z;
    if (player.vel) {
      player.vel.x = view.motion.x;
      player.vel.y = view.motion.y;
      player.vel.z = view.motion.z;
    }
    player.yaw = view.rotation.yaw;
    player.pitch = view.rotation.pitch;
    (player as { onGround?: boolean }).onGround = view.onGround;
    (player as { fallDistance?: number }).fallDistance = view.fallDistance;
  }
}

function num(v: unknown, d: number): number {
  return typeof v === 'number' && Number.isFinite(v) ? v : d;
}

// keep IntTag referenced (used via putInt); re-export for consumers that build inventories.
export { IntTag };
