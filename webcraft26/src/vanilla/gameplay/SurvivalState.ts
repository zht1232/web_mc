// Source: net.minecraft.world.entity.player.Player (health / XP / damage) (26.2)
//         net.minecraft.server.level.ServerPlayer (movement exhaustion)
//         net.minecraft.world.food.FoodData
//         net.minecraft.world.inventory.* (menu wiring)
//
// Unified survival facade for the main agent. All randomness comes from
// XoroshiroRandomSource seeded by `seed` (no Math.random), so a seed reproduces
// exactly the same loot / furnace-rng sequence.

import type { MinecraftData } from '../world/level/block/state/BlockState.js';
import { XoroshiroRandomSource, type RandomSource } from '../core/Random.js';
import { ItemRegistry } from '../world/item/Item.js';
import { ItemStack } from '../world/item/ItemStack.js';
import { ItemCooldowns } from '../world/item/ItemCooldowns.js';
import { RecipeManager } from '../world/item/crafting/RecipeManager.js';
import { BlockBreaking } from '../world/level/block/BlockBreaking.js';
import type { LootTableApi } from './loot/LootTable.js';
import { LootTable } from './loot/LootTable.js';
import { PlayerInventory } from '../world/entity/player/Inventory.js';
import { FoodData, type FoodTickPlayer, type Difficulty } from '../world/food/FoodData.js';
import { AbstractContainerMenu, type MenuPlayer } from '../world/inventory/AbstractContainerMenu.js';
import { InventoryMenu } from '../world/inventory/InventoryMenu.js';
import { CraftingMenu } from '../world/inventory/CraftingMenu.js';
import { FurnaceMenu } from '../world/inventory/FurnaceMenu.js';
import { ChestMenu } from '../world/inventory/ChestMenu.js';
import { CreativeInventory } from '../world/inventory/CreativeInventory.js';

export interface WorldData {
  /** items.json `{items:[...]}` or ItemMeta[]; optional (mc.items is preferred). */
  items?: unknown;
  /** tags.json. */
  tags?: unknown;
  /** recipes.json. */
  recipes?: unknown;
  /** loot.json. */
  loot?: unknown;
  /** en_us.json. */
  lang?: unknown;
}

let WORLD_DATA: WorldData = {};
export function setWorldData(data: WorldData): void { WORLD_DATA = data; }
export function getWorldData(): WorldData { return WORLD_DATA; }

/** Browser loader for the main agent (fetch-based). */
export async function loadWorldData(base = '/mc'): Promise<WorldData> {
  const [tags, recipes, loot] = await Promise.all([
    fetch(`${base}/tags.json`).then((r) => r.json()).catch(() => ({})),
    fetch(`${base}/recipes.json`).then((r) => r.json()).catch(() => ({})),
    fetch(`${base}/loot.json`).then((r) => r.json()).catch(() => ({})),
  ]);
  const lang = await fetch(`${base}/lang/en_us.json`).then((r) => r.json()).catch(() => ({}));
  const data: WorldData = { tags, recipes, loot, lang };
  setWorldData(data);
  return data;
}

export interface PlayerMoved {
  sprint: boolean;
  jumped: boolean;
  swam: boolean;
  /** Player.isEyeInFluid(FluidTags.WATER): drives the 300-tick air supply. */
  underwater?: boolean;
  /** Entity.isInLava(): lava burn damage. */
  inLava?: boolean;
}

export type Gamemode = 'survival' | 'creative';

/**
 * Damage types whose armour absorption is skipped, from
 * data/minecraft/tags/damage_type/bypasses_armor.json (26.2):
 * on_fire, in_wall, cramming, drown, fly_into_wall, generic, wither, dragon_breath,
 * starve, fall, ender_pearl, freeze, stalagmite, magic, indirect_magic, out_of_world,
 * generic_kill, sonic_boom, outside_border.
 */
const BYPASSES_ARMOR: ReadonlySet<string> = new Set([
  'fire', 'on_fire', 'in_wall', 'cramming', 'drown', 'fly_into_wall', 'generic',
  'wither', 'dragon_breath', 'starve', 'fall', 'ender_pearl', 'freeze', 'stalagmite',
  'magic', 'indirect_magic', 'out_of_world', 'generic_kill', 'sonic_boom', 'outside_border',
]);

export class SurvivalState implements FoodTickPlayer, MenuPlayer {
  readonly mc: MinecraftData;
  readonly seed: bigint;
  readonly random: RandomSource;
  readonly registry: ItemRegistry;
  readonly recipeManager: RecipeManager;
  readonly loot: LootTable;
  readonly inventory: PlayerInventory;
  readonly food = new FoodData();
  readonly cooldowns = new ItemCooldowns();
  readonly breaking: BlockBreaking;
  readonly creativeInventory: CreativeInventory;
  readonly inventoryMenu: InventoryMenu;
  private readonly worldData: WorldData;

  /** The menu currently shown on screen (E / furnace / chest / crafting table). */
  activeMenu: AbstractContainerMenu | null = null;
  gamemode: Gamemode = 'survival';
  difficulty: Difficulty = 'NORMAL';
  naturalRegen = true;
  /** Set by the main agent to spawn a dropped ItemStack in the world. */
  onDrop?: (stack: ItemStack) => void;

  private hp = 20;
  private maxHp = 20;
  private experienceLevel = 0;
  private experienceProgress = 0;
  private totalXp = 0;

  // ---- P4 survival additions (net/minecraft/world/entity/{Entity,LivingEntity}.java) ----
  /** Entity.getAirSupply / getMaxAirSupply: 300 ticks, -20..300 while swimming. */
  private air = 300;
  /** LivingEntity.hurtTime / hurtDuration: 10 ticks of render-side red flash. */
  private hurtTicks = 0;
  /** LivingEntity.invulnerableTime: 10 ticks of i-frames after a hit. */
  private invulnerableTicks = 0;
  /** DamageSource type of the last hit (death screen cause line). */
  private lastDamageCause = '';
  /** Set once when health reaches 0; cleared by respawn(). */
  private dead = false;

  /** Called by the main game when health first reaches 0 (death screen + loot). */
  onDeath?: () => void;

  constructor(mc: MinecraftData, seed: bigint, data?: WorldData) {
    this.mc = mc;
    this.seed = seed;
    const d = data ?? getWorldData();
    this.worldData = d;
    this.random = new XoroshiroRandomSource(seed);
    this.registry = ItemRegistry.fromMinecraftData(mc, d.tags ?? {});
    this.recipeManager = new RecipeManager(d.recipes ?? {}, this.registry);
    this.loot = new LootTable(d.loot ?? {}, this.registry, this.random);
    this.inventory = new PlayerInventory(mc, this.registry);
    this.breaking = new BlockBreaking(mc);
    this.creativeInventory = new CreativeInventory(this.registry, (d.lang ?? {}) as Record<string, string>);
    this.inventoryMenu = new InventoryMenu(this.inventory, this.recipeManager, this.registry);
    this.activeMenu = this.inventoryMenu;
  }

  // ---- Health / hunger / XP (readonly getters for HUD) --------------------

  get health(): number { return this.hp; }
  get maxHealth(): number { return this.maxHp; }
  get hunger(): number { return this.food.getFoodLevel(); }
  get saturation(): number { return this.food.getSaturationLevel(); }
  get exhaustion(): number { return this.food.getExhaustionLevel(); }
  get level(): number { return this.experienceLevel; }
  /** 0..1 progress toward the next level (Player.experienceProgress). */
  get experience(): number { return this.experienceProgress; }
  get totalExperience(): number { return this.totalXp; }
  /** Entity.getAirSupply: 300 = full, values <= 0 are the drowning bubble countdown. */
  get airSupply(): number { return this.air; }
  get maxAirSupply(): number { return 300; }
  /** Player.getArmorValue(), so the HUD can draw the armor bar without another import. */
  get armorValue(): number { return this.inventory.getArmorValue(); }
  get armorToughness(): number { return this.inventory.getArmorToughness(); }
  /** LivingEntity.hurtTime: 10 down to 0, drives the red damage flash. */
  get hurtTime(): number { return this.hurtTicks; }
  get isDead(): boolean { return this.dead; }
  get lastHurtBy(): string { return this.lastDamageCause; }

  getXpNeededForNextLevel(): number {
    const l = this.experienceLevel;
    if (l >= 30) return 112 + (l - 30) * 9;
    if (l >= 15) return 37 + (l - 15) * 5;
    return 7 + l * 2;
  }

  /** Player.giveExperiencePoints. */
  addExperience(n: number): void {
    if (n === 0) return;
    this.totalXp = Math.max(0, this.totalXp + n);
    this.experienceProgress += n / this.getXpNeededForNextLevel();
    while (this.experienceProgress >= 1) {
      this.experienceProgress -= 1;
      this.experienceLevel++;
    }
    while (this.experienceProgress < 0 && this.experienceLevel > 0) {
      this.experienceLevel--;
      this.experienceProgress += 1;
    }
    if (this.experienceProgress < 0) this.experienceProgress = 0;
  }

  /**
   * Player.hurt / getDamageAfterArmorAbsorb (stars bypass armor).
   * Creative mode is invulnerable (Player.abilities.invulnerable); the 10-tick
   * LivingEntity.invulnerableTime applies to every non-starvation source.
   */
  damage(amount: number, source: string): void {
    if (amount <= 0 || this.hp <= 0) return;
    if (this.gamemode === 'creative') return;
    if (this.invulnerableTicks > 0 && source !== 'starve' && source !== 'drown') return;
    let dmg = amount;
    if (!BYPASSES_ARMOR.has(source)) {
      this.inventory.hurtArmor(dmg);
      const armor = this.inventory.getArmorValue();
      const toughness = this.inventory.getArmorToughness();
      // CombatRules.getDamageAfterAbsorb
      const f = 2 + toughness / 4;
      const g = Math.max(0, Math.min(20, armor) - dmg / f);
      dmg = dmg * (1 - g / 25);
      if (dmg < 0) dmg = 0;
      // DamageSource.getFoodExhaustion: 0.1 for player attacks / explosions.
      if (source === 'explosion' || source === 'player') this.food.addExhaustion(0.1);
    }
    this.invulnerableTicks = 10;
    this.hurtTicks = 10;
    this.lastDamageCause = source;
    this.hp = Math.max(0, this.hp - dmg);
    if (this.hp <= 0 && !this.dead) {
      this.dead = true;
      if (this.onDeath) this.onDeath();
    }
  }

  /**
   * LivingEntity.causeFallDamage (26.2):
   *   calculateFallPower = fallDistance + 1e-6 - SAFE_FALL_DISTANCE(3.0)
   *   damage = Mth.floor(power * damageModifier(1) * fallDamageMultiplier(1))
   * NOTE: the task text says "distance-3 向上取整"; the 26.2 source uses floor()
   * with a +1e-6 epsilon (LivingEntity.java:1837-1848), which this follows.
   */
  fallDamage(fallDistance: number): number {
    const dmg = Math.floor(fallDistance + 1e-6 - 3.0);
    if (dmg > 0) this.damage(dmg, 'fall');
    return Math.max(0, dmg);
  }

  /**
   * Entity/LivingEntity fire + lava damage, called once per game tick from the
   * main loop with the player's current block interaction state.
   *   Entity.baseTick: fire ticks -> 1 damage every 20 ticks
   *   Entity.lavaHurt: 4 damage every 10 ticks while in lava, 15 s of fire
   */
  tickEnvironment(inLava: boolean, inWater: boolean, onFire: boolean): void {
    if (this.hp <= 0 || this.gamemode === 'creative') return;
    if (inLava) {
      if (this.envTickCounter++ % 10 === 0) this.damage(4, 'lava');
      return;
    }
    if (onFire && !inWater) {
      if (this.envTickCounter++ % 20 === 0) this.damage(1, 'fire');
    } else {
      this.envTickCounter = 0;
    }
  }
  private envTickCounter = 0;

  // ---- FoodTickPlayer -----------------------------------------------------

  getHealth(): number { return this.hp; }
  getMaxHealth(): number { return this.maxHp; }
  isHurt(): boolean { return this.hp < this.maxHp; }
  heal(amount: number): void { this.hp = Math.max(0, Math.min(this.maxHp, this.hp + amount)); }
  hurt(amount: number, source: string): void { this.damage(amount, source); }

  // ---- MenuPlayer ---------------------------------------------------------

  get infiniteMaterials(): boolean { return this.gamemode === 'creative'; }
  canDropItems(): boolean { return true; }
  drop(stack: ItemStack): void {
    if (stack.isEmpty()) return;
    if (this.onDrop) this.onDrop(stack);
    else this.inventory.add(stack); // fallback: place back in inventory
  }

  // ---- tick ---------------------------------------------------------------

  /**
   * One 20 Hz tick. Movement exhaustion follows ServerPlayer.checkMovementStatistics.
   * Also ticks hurt/invulnerability timers and the air supply
   * (LivingEntity.baseTick: eye in water -> air-1; air <= -20 -> 2 drown damage and
   * air reset to 0; not underwater -> air +4 clamped to 300).
   */
  tick(playerMoved: PlayerMoved): void {
    if (this.hurtTicks > 0) this.hurtTicks--;
    if (this.invulnerableTicks > 0) this.invulnerableTicks--;

    if (this.hp > 0 && this.gamemode !== 'creative') {
      if (playerMoved.underwater) {
        this.air--;
        if (this.air <= -20) {
          this.air = 0;
          this.damage(2, 'drown');
        }
      } else if (this.air < this.maxAirSupply) {
        this.air = Math.min(this.maxAirSupply, this.air + 4);
      }
    }

    if (playerMoved.jumped) this.food.onJump(playerMoved.sprint);
    if (playerMoved.sprint) this.food.onSprint(28); // 0.2806 blocks/tick ~ 28 cm
    if (playerMoved.swam) this.food.onSwim(20);
    this.food.tick(this, this.difficulty, this.naturalRegen);
    this.inventory.tick();
    this.cooldowns.tick();
  }

  /** Player.dropEquipment / Inventory.dropAllItems: everything on death. */
  dropAllOnDeath(): { stacks: ItemStack[]; experience: number } {
    const stacks: ItemStack[] = [];
    for (let i = 0; i < 36; i++) {
      const stack = this.inventory.getItem(i);
      if (stack && !stack.isEmpty()) {
        stacks.push(stack.copy());
        this.inventory.setItem(i, ItemStack.EMPTY);
      }
    }
    this.inventory.setItem(this.inventory.getSelectedSlot(), ItemStack.EMPTY);
    const experience = this.totalXp;
    return { stacks, experience };
  }

  /** Player.respawn: health/food/air/XP reset, inventory already dropped. */
  respawn(): void {
    this.hp = this.maxHp;
    this.air = this.maxAirSupply;
    this.hurtTicks = 0;
    this.invulnerableTicks = 0;
    this.dead = false;
    this.lastDamageCause = '';
    this.food.setFoodLevel(20);
    this.food.setSaturation(5);
    this.food.setExhaustion(0);
    this.experienceLevel = 0;
    this.experienceProgress = 0;
    this.totalXp = 0;
    this.breaking.reset();
  }

  /** Convenience for the main agent: Game.ts currently renders the hotbar as number[]. */
  hotbarStacks(): ItemStack[] {
    const out: ItemStack[] = new Array(9);
    for (let i = 0; i < 9; i++) out[i] = this.inventory.getItem(i);
    return out;
  }
  getSelectedStack(): ItemStack { return this.inventory.getSelectedItem(); }

  /**
   * Advance mining progress for the held item; returns true when the block is
   * broken. The main agent calls this every tick while the left button is held,
   * then calls breakBlock() with the same coordinates.
   */
  mine(dtTicks: number, state: number, underwater: boolean): boolean {
    return this.breaking.tick(dtTicks, state, this.inventory.getSelectedItem(), underwater, 0);
  }

  /** Block.playerDestroy + Block.dropResources. Returns the drops to spawn. */
  breakBlock(stateAt: (x: number, y: number, z: number) => number, x: number, y: number, z: number): ItemStack[] {
    const state = stateAt(x, y, z);
    const held = this.inventory.getSelectedItem();
    const drops = BlockBreaking.getDrops(state, held, this.loot as LootTableApi, this.mc);
    this.food.onBreakBlock();
    if (held && !held.isEmpty() && held.item?.tool) held.hurtAndBreak(1);
    this.breaking.reset();
    return drops;
  }

  // ---- menu factory / wiring (E key, right-click on blocks) ---------------

  openInventory(): InventoryMenu { this.activeMenu = this.inventoryMenu; return this.inventoryMenu; }
  openCraftingTable(): CraftingMenu {
    const menu = new CraftingMenu(this.inventory, this.recipeManager, this.registry);
    this.activeMenu = menu;
    return menu;
  }
  openFurnace(): FurnaceMenu {
    const menu = new FurnaceMenu(0, this.inventory, this.recipeManager, this.registry, this.worldData.tags ?? {});
    menu.onExperience = (points) => this.addExperience(points);
    this.activeMenu = menu;
    return menu;
  }
  openChest(rows = 3): ChestMenu {
    const menu = new ChestMenu(0, this.inventory, rows);
    this.activeMenu = menu;
    return menu;
  }
  closeMenu(): void { this.activeMenu = null; }
  getActiveMenu(): AbstractContainerMenu | null { return this.activeMenu; }

  /** Convenience for the GUI: the player inventory as a MenuPlayer adapter. */
  asMenuPlayer(): MenuPlayer { return this; }
}
