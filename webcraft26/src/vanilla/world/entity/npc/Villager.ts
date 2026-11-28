// Source: net.minecraft.world.entity.npc.villager.Villager (26.2)
//
// Adult villager with a job site (POI) sensor, profession levels, offers and
// restocking. The brain is simplified to the shared goal selector: stroll,
// look at the player and random look. Trading is exposed through the Merchant
// interface consumed by MerchantMenu.
//
// Vanilla assigns a profession when a villager claims a workstation; this port
// does the same with a 16-block scan (the vanilla POI manager is chunk-based).
//
// Breeding: Villager.canBreed needs 12 food points (bread 4, carrot/potato/
// beetroot 1) and age 0. Food comes from ItemEntities the villager picks up;
// two breeding-ready villagers pair through the shared BreedGoal, consume 12
// points each and spawn a baby with the vanilla biome/50-25-25 type roll. The
// vanilla vacant-bed requirement is skipped (the port has no bed POI owner).
//
// Sleep schedule: the vanilla brain's Sleep activity is simplified to a goal
// that claims a nearby bed at sunset (time 12000..24000), walks to it and lies
// down. Villagers wake at sunrise, when the bed is destroyed or when hurt. The
// renderer draws the sleeping pose (EntityRenderer rootMatrix). `lastSleptGameTime`
// feeds the simplified village golem spawn in Game.tickVillageGolemSpawn.

import { Mob } from '../Mob.js';
import { FloatGoal } from '../ai/goal/FloatGoal.js';
import { BreedGoal } from '../ai/goal/BreedGoal.js';
import { RandomStrollGoal } from '../ai/goal/RandomStrollGoal.js';
import { LookAtPlayerGoal } from '../ai/goal/LookAtPlayerGoal.js';
import { RandomLookAroundGoal } from '../ai/goal/RandomLookAroundGoal.js';
import { FarmerHarvestGoal } from '../ai/goal/FarmerHarvestGoal.js';
import { VillagerSleepGoal } from '../ai/goal/VillagerSleepGoal.js';
import { ItemEntity } from '../item/ItemEntity.js';
import { entityType } from '../EntityType.js';
import type { Targetable } from '../Entity.js';
import type { ClientLevel } from '../../level/ClientLevel.js';
import type { ItemRegistry } from '../../item/Item.js';
import type { ItemStack } from '../../item/ItemStack.js';
import type { Merchant } from '../../item/trading/Merchant.js';
import { MerchantOffer } from '../../item/trading/MerchantOffer.js';
import type { SavedVillager } from '../../level/storage/LevelSummary.js';
import { VillagerTrades } from './VillagerTrades.js';

/** VillagerData.NEXT_LEVEL_XP_THRESHOLDS. */
export const LEVEL_XP: readonly number[] = [0, 10, 70, 150, 250];

/** Villager.FOOD_POINTS. */
const FOOD_POINTS: Readonly<Record<string, number>> = {
  bread: 4, potato: 1, carrot: 1, beetroot: 1,
};

/** Villager.BREEDING_FOOD_THRESHOLD. */
const BREEDING_FOOD_THRESHOLD = 12;
/** Villager.hasExcessFood threshold; also caps the port's single food counter. */
const EXCESS_FOOD = 24;

/** Villager.BABY_DIMENSIONS (scalable 0.49 x 0.98, eye height 0.63). */
const BABY_WIDTH = 0.49;
const BABY_HEIGHT = 0.98;
const BABY_EYE_HEIGHT = 0.63;

/** CropBlock.isMaxAge ages (wheat/carrots/potatoes 0..7, beetroots 0..3). */
const CROP_MAX_AGE: Readonly<Record<string, number>> = {
  wheat: 7, carrots: 7, potatoes: 7, beetroots: 3,
};
/** HarvestFarmland WORK_DURATION-ish cadence for the bread/sharing pass. */
const FARM_TICK_INTERVAL = 20;

/** data/minecraft/tags/point_of_interest_type/acquirable_job_site + profession mapping. */
const WORKSTATION_PROFESSION: Readonly<Record<string, string>> = {
  blast_furnace: 'armorer',
  smoker: 'butcher',
  cartography_table: 'cartographer',
  brewing_stand: 'cleric',
  composter: 'farmer',
  barrel: 'fisherman',
  fletching_table: 'fletcher',
  cauldron: 'leatherworker',
  water_cauldron: 'leatherworker',
  lava_cauldron: 'leatherworker',
  powder_snow_cauldron: 'leatherworker',
  lectern: 'librarian',
  stonecutter: 'mason',
  loom: 'shepherd',
  smithing_table: 'toolsmith',
  grindstone: 'weaponsmith',
};

const JOB_SCAN_RADIUS = 16;
const JOB_SCAN_INTERVAL = 40;

/** Villager Sleep activity: beds are claimed from a 32-block POI-style scan. */
const BED_SCAN_RADIUS = 32;
const BED_SUFFIX = '_bed';
/** BedBlock.FACING -> unit vector toward the head (pillow) half. */
const BED_FACING: Readonly<Record<string, readonly [number, number]>> = {
  north: [0, -1], south: [0, 1], west: [-1, 0], east: [1, 0],
};

interface JobSite { x: number; y: number; z: number; profession: string }

/** A claimed bed: head block coordinates + head direction. */
export interface VillagerBed {
  hx: number; hy: number; hz: number;
  fx: number; fz: number;
}

/** One villager per workstation, like the vanilla POI owner. */
const CLAIMED_SITES = new Map<string, Villager>();

/** One villager per bed, keyed by the head block like the vanilla POI owner. */
const CLAIMED_BEDS = new Map<string, Villager>();

function siteKey(x: number, y: number, z: number): string {
  return `${x},${y},${z}`;
}

/** VillagerType.byBiome: the seven village skins. */
export function villagerTypeForBiome(biome: string): string {
  const name = biome.replace(/^minecraft:/, '');
  if (/desert|badlands/.test(name)) return 'desert';
  if (/jungle/.test(name)) return 'jungle';
  if (/savanna/.test(name)) return 'savanna';
  if (/snow|frozen|grove|ice_spikes/.test(name)) return 'snow';
  if (/swamp/.test(name)) return 'swamp';
  if (/taiga|old_growth|windswept|meadow/.test(name)) return 'taiga';
  return 'plains';
}

export class Villager extends Mob implements Merchant {
  profession = 'none';
  professionLevel = 1;
  villagerType = 'plains';
  xp = 0;
  offers: MerchantOffer[] = [];
  jobSite: JobSite | null = null;
  tradingPlayer: unknown = null;
  /** Villager.foodLevel + food points held in the (simplified) inventory. */
  foodPoints = 0;
  /** Wheat held by a farmer, baked into bread 3:1 (WorkAtComposter). */
  wheat = 0;
  /** Wheat seeds held for replanting (HarvestFarmland hasFarmSeeds). */
  seeds = 0;
  lastRestockGameTime = 0;
  restocksToday = 0;
  lastRestockCheckDay = 0;
  /** 40-tick delay before a level-up adds the next tier's offers. */
  private levelUpTimer = 0;
  private nextJobScan = 0;
  private nextRestockCheck = 0;
  private nextFoodScan = 0;
  private nextFarmTick = 0;
  private typeFinalized = false;

  // ---- sleep (brain Sleep activity) ---------------------------------------
  /** True while lying in a bed; the renderer draws the sleeping pose. */
  sleeping = false;
  /** Claimed bed (kept while walking to it and while asleep). */
  bed: VillagerBed | null = null;
  /** Render yaw (radians) of the lying body, aligned with the bed's head. */
  sleepYaw = 0;
  /** level.gameTime of the last time this villager fell asleep (golem memory). */
  lastSleptGameTime = -1;

  constructor(level: ClientLevel) {
    super(entityType('villager'), level);
    this.speed = 0.5;
    this.maxHealth = 20;
    this.health = 20;
  }

  protected registerGoals(): void {
    this.goalSelector.addGoal(0, new VillagerSleepGoal(this));
    this.goalSelector.addGoal(0, new FloatGoal(this));
    this.goalSelector.addGoal(1, new BreedGoal(this, 0.5));
    this.goalSelector.addGoal(2, new FarmerHarvestGoal(this, 0.5));
    this.goalSelector.addGoal(3, new RandomStrollGoal(this, 0.6));
    this.goalSelector.addGoal(4, new LookAtPlayerGoal(this, 8));
    this.goalSelector.addGoal(5, new RandomLookAroundGoal(this));
  }

  // ---- breeding (AgeableMob + Villager food gate) -------------------------

  /** AgeableMob.setAge with the dedicated baby mesh, so no half-size scaling. */
  override setAge(age: number): void {
    super.setAge(age);
    this.scale = 1;
  }

  override getWidth(): number { return this.isBaby() ? BABY_WIDTH : this.type.width; }
  override getHeight(): number { return this.isBaby() ? BABY_HEIGHT : this.type.height; }
  override getEyeHeight(): number { return this.isBaby() ? BABY_EYE_HEIGHT : this.type.height * 0.85; }

  /** Villager.canBreed: 12 food points, not sleeping and fully grown. */
  canBreed(): boolean {
    return this.foodPoints >= BREEDING_FOOD_THRESHOLD && this.getAge() === 0;
  }

  /** Villager breeding is gated by food rather than the Animal in-love flag. */
  override isInLove(): boolean { return super.isInLove() || this.canBreed(); }

  /** Villager.eatAndDigestFood: fill the food level to 12, then digest 12. */
  eatAndDigestFood(): void {
    this.foodPoints = Math.max(0, this.foodPoints - BREEDING_FOOD_THRESHOLD);
  }

  /**
   * VillagerMakeLove.breed: consume food, put both parents on the 6000-tick
   * cooldown and spawn a baby with the vanilla 50/25/25 type roll.
   */
  override breedWith(partner: Mob): void {
    if (!(partner instanceof Villager)) return;
    this.eatAndDigestFood();
    partner.eatAndDigestFood();
    this.setInLove(false);
    partner.setInLove(false);
    this.setAge(6000);
    partner.setAge(6000);
    const child = new Villager(this.level);
    const roll = this.random.nextDouble();
    if (roll < 0.5) {
      child.villagerType = villagerTypeForBiome(this.world?.getBiomeName?.(this.x, this.y, this.z) ?? '');
    } else if (roll < 0.75) {
      child.villagerType = this.villagerType;
    } else {
      child.villagerType = partner.villagerType;
    }
    child.typeFinalized = true;
    child.profession = 'none';
    child.setAge(-24000);
    child.setPos(this.x, this.y, this.z);
    this.world?.spawnEntity(child);
    // VillagerMakeLove broadcasts the heart event on both partners and the child.
    this.world?.onAnimalLove?.(this);
    this.world?.onAnimalLove?.(partner);
    this.world?.onAnimalBred?.(this);
  }

  // ---- sleep schedule (Villager brain Sleep activity) ---------------------

  /** Sleep activity window: lie down at sunset (12000) and wake at sunrise (0). */
  isNight(): boolean {
    const t = ((this.level.time % 24000) + 24000) % 24000;
    return t >= 12000;
  }

  /** True while the claimed bed still exists (head or foot half). */
  hasBed(): boolean {
    const bed = this.bed;
    if (!bed) return false;
    const mc = this.level.mc;
    if (mc.blockOf(this.level.getBlockState(bed.hx, bed.hy, bed.hz)).name.endsWith(BED_SUFFIX)) return true;
    const fx = bed.hx - bed.fx, fz = bed.hz - bed.fz;
    return mc.blockOf(this.level.getBlockState(fx, bed.hy, fz)).name.endsWith(BED_SUFFIX);
  }

  /** True while the claim map still points this bed at this villager. */
  ownsBed(): boolean {
    const bed = this.bed;
    return !!bed && CLAIMED_BEDS.get(siteKey(bed.hx, bed.hy, bed.hz)) === this;
  }

  /** True when the bed block still exists and its claim is free (or ours). */
  canClaimBed(bed: VillagerBed): boolean {
    const owner = CLAIMED_BEDS.get(siteKey(bed.hx, bed.hy, bed.hz));
    if (owner && owner !== this && !owner.isRemoved() && !owner.dead) return false;
    const mc = this.level.mc;
    const head = this.level.getBlockState(bed.hx, bed.hy, bed.hz);
    if (head !== 0 && mc.blockOf(head).name.endsWith(BED_SUFFIX)) return true;
    const foot = this.level.getBlockState(bed.hx - bed.fx, bed.hy, bed.hz - bed.fz);
    return foot !== 0 && mc.blockOf(foot).name.endsWith(BED_SUFFIX);
  }

  /**
   * Finds the nearest unclaimed bed within 32 blocks. Bed blocks come in
   * head/foot pairs; the head block is canonical so two villagers cannot claim
   * the same bed from opposite halves.
   */
  findAvailableBed(): VillagerBed | null {
    const mc = this.level.mc;
    const ox = Math.floor(this.x), oy = Math.floor(this.y), oz = Math.floor(this.z);
    let best: VillagerBed | null = null;
    let bestD = Infinity;
    for (let dy = -4; dy <= 4; dy++) {
      const y = oy + dy;
      for (let dz = -BED_SCAN_RADIUS; dz <= BED_SCAN_RADIUS; dz++) {
        for (let dx = -BED_SCAN_RADIUS; dx <= BED_SCAN_RADIUS; dx++) {
          const x = ox + dx, z = oz + dz;
          const state = this.level.getBlockState(x, y, z);
          if (state === 0) continue;
          if (!mc.blockOf(state).name.endsWith(BED_SUFFIX)) continue;
          const [fx, fz] = BED_FACING[String(mc.getProp(state, 'facing') ?? 'north')] ?? BED_FACING.north;
          const isHead = String(mc.getProp(state, 'part') ?? 'foot') === 'head';
          if (!isHead) {
            // A foot half only counts when its head block is really there.
            const headState = this.level.getBlockState(x + fx, y, z + fz);
            if (headState === 0 || !mc.blockOf(headState).name.endsWith(BED_SUFFIX)) continue;
          }
          const hx = isHead ? x : x + fx;
          const hz = isHead ? z : z + fz;
          const owner = CLAIMED_BEDS.get(siteKey(hx, y, hz));
          if (owner && owner !== this && !owner.isRemoved() && !owner.dead) continue;
          const d = this.distanceToSqr(x + 0.5, y + 0.5, z + 0.5);
          if (d < bestD) { bestD = d; best = { hx, hy: y, hz, fx, fz }; }
        }
      }
    }
    return best;
  }

  claimBed(bed: VillagerBed): void {
    this.releaseBed();
    CLAIMED_BEDS.set(siteKey(bed.hx, bed.hy, bed.hz), this);
    this.bed = bed;
  }

  releaseBed(): void {
    const bed = this.bed;
    if (!bed) return;
    const key = siteKey(bed.hx, bed.hy, bed.hz);
    if (CLAIMED_BEDS.get(key) === this) CLAIMED_BEDS.delete(key);
    this.bed = null;
  }

  /**
   * SleepInBed: lie down on the claimed bed. The entity moves to the centre of
   * the two-block bed, gravity is disabled and the renderer lays the body along
   * the bed's head direction.
   */
  startSleeping(bed: VillagerBed): void {
    this.claimBed(bed);
    this.sleeping = true;
    this.sleepYaw = Math.atan2(bed.fx, bed.fz);
    const footX = bed.hx - bed.fx, footZ = bed.hz - bed.fz;
    this.x = footX + 0.5 + bed.fx * 0.5;
    this.z = footZ + 0.5 + bed.fz * 0.5;
    this.y = bed.hy + 0.8;
    this.xo = this.x; this.yo = this.y; this.zo = this.z;
    this.vx = 0; this.vy = 0; this.vz = 0;
    this.yaw = this.sleepYaw * (180 / Math.PI);
    this.yBodyRot = this.yaw;
    this.yHeadRot = this.yaw;
    this.noGravity = true;
    this.moveControl.reset();
    this.navigation.stop();
    this.lastSleptGameTime = this.level.gameTime;
  }

  /** Sleep.wakeUp: stand back up, restore gravity and release the bed. */
  wakeUp(): void {
    if (!this.sleeping) { this.releaseBed(); return; }
    this.sleeping = false;
    this.noGravity = false;
    this.releaseBed();
    this.moveControl.reset();
    this.navigation.stop();
  }

  private tickSleep(): void {
    if (!this.sleeping) return;
    if (!this.isNight() || !this.hasBed()) this.wakeUp();
  }

  /** LivingEntity wakes sleeping villagers when they take damage. */
  override hurt(amount: number, attacker: Targetable | null): void {
    if (this.sleeping) this.wakeUp();
    super.hurt(amount, attacker);
  }

  /** Finds the nearest mature crop within `radius` blocks (HarvestFarmland.validPos). */
  findHarvestableCrop(radius: number): { x: number; y: number; z: number } | null {
    const mc = this.level.mc;
    const ox = Math.floor(this.x), oy = Math.floor(this.y), oz = Math.floor(this.z);
    let best: { x: number; y: number; z: number } | null = null;
    let bestD = Infinity;
    for (let dy = -1; dy <= 1; dy++) {
      for (let dz = -radius; dz <= radius; dz++) {
        for (let dx = -radius; dx <= radius; dx++) {
          const x = ox + dx, y = oy + dy, z = oz + dz;
          const state = this.level.getBlockState(x, y, z);
          if (state === 0) continue;
          const name = mc.blockOf(state).name;
          const max = CROP_MAX_AGE[name];
          if (max === undefined) continue;
          if (Number(mc.getProp(state, 'age')) !== max) continue;
          const d = this.distanceToSqr(x + 0.5, y + 0.5, z + 0.5);
          if (d < bestD) { bestD = d; best = { x, y, z }; }
        }
      }
    }
    return best;
  }

  /**
   * HarvestFarmland.tick: destroy a mature crop, collect its drops into the
   * food/wheat stock and replant the same crop when a seed is available.
   */
  harvestCrop(x: number, y: number, z: number): void {
    const mc = this.level.mc;
    const state = this.level.getBlockState(x, y, z);
    if (state === 0) return;
    const name = mc.blockOf(state).name;
    const max = CROP_MAX_AGE[name];
    if (max === undefined || Number(mc.getProp(state, 'age')) !== max) return;
    this.level.setBlockState(x, y, z, 0);
    this.world?.onVillagerFarm?.('break', x, y, z);

    let foodGain = 0;
    let replant = false;
    if (name === 'wheat') {
      this.wheat += 1;
      this.seeds += this.random.nextInt(4); // wheat seeds drop 0..3
      if (this.seeds > 0) { this.seeds--; replant = true; }
    } else {
      const count = 1 + this.random.nextInt(name === 'beetroots' ? 3 : 4);
      foodGain = count;
      if (count > 1) { foodGain -= 1; replant = true; } // one item becomes the seed
    }
    if (replant) {
      this.level.setBlockState(x, y, z, mc.stateOf(name, { age: '0' }));
      this.world?.onVillagerFarm?.('plant', x, y, z);
    }
    if (foodGain > 0) this.foodPoints = Math.min(EXCESS_FOOD, this.foodPoints + foodGain);
    this.bakeBread();
  }

  /** WorkAtComposter: 3 wheat bake into 1 bread (4 food points). */
  private bakeBread(): void {
    while (this.wheat >= 3) {
      this.wheat -= 3;
      this.foodPoints = Math.min(EXCESS_FOOD, this.foodPoints + 4);
    }
  }

  /** TradeWithVillager food sharing: excess food moves to a nearby hungry villager. */
  private shareFood(): void {
    if (this.foodPoints < EXCESS_FOOD) return;
    const world = this.world;
    if (!world) return;
    for (const e of world.getEntities()) {
      if (!(e instanceof Villager) || e === this || e.isRemoved() || e.dead) continue;
      if (e.foodPoints >= BREEDING_FOOD_THRESHOLD) continue;
      if (this.distanceToSqr(e.x, e.y, e.z) > 16) continue;
      const units = Math.min(
        Math.floor((this.foodPoints - BREEDING_FOOD_THRESHOLD) / 4),
        Math.ceil((BREEDING_FOOD_THRESHOLD - e.foodPoints) / 4),
      );
      if (units <= 0) continue;
      const amount = units * 4;
      this.foodPoints -= amount;
      e.foodPoints = Math.min(EXCESS_FOOD, e.foodPoints + amount);
      break;
    }
  }

  private tickFarmLife(): void {
    if (this.tickCount < this.nextFarmTick) return;
    this.nextFarmTick = this.tickCount + FARM_TICK_INTERVAL;
    this.bakeBread();
    this.shareFood();
  }

  /** VillagerPickupItem: absorb dropped bread / carrot / potato / beetroot. */
  private tickFoodPickup(): void {
    if (this.tickCount < this.nextFoodScan) return;
    this.nextFoodScan = this.tickCount + 10;
    if (this.foodPoints >= EXCESS_FOOD) return;
    const world = this.world;
    if (!world) return;
    const ents = world.getEntities();
    for (let i = 0; i < ents.length; i++) {
      const e = ents[i];
      if (!(e instanceof ItemEntity) || e.isRemoved()) continue;
      if (this.distanceToSqr(e.x, e.y, e.z) > 2.25) continue;
      const stack = e.getItem();
      const name = stack.getItem()?.name;
      const value = name ? FOOD_POINTS[name] : undefined;
      if (!value) continue;
      this.foodPoints = Math.min(EXCESS_FOOD, this.foodPoints + value * stack.getCount());
      world.removeEntity(e);
      if (this.foodPoints >= EXCESS_FOOD) break;
    }
  }

  /** AbstractVillager: a trading or sleeping villager holds still. */
  override serverAiStep(): void {
    if (this.tradingPlayer != null || this.sleeping) {
      this.moveControl.reset();
      this.navigation.stop();
      this.setTarget(null);
      return;
    }
    super.serverAiStep();
  }

  tick(): void {
    super.tick();
    if (this.dead) {
      this.releaseJobSite();
      this.releaseBed();
      this.sleeping = false;
      this.noGravity = false;
      return;
    }
    if (!this.typeFinalized) {
      this.typeFinalized = true;
      const biome = this.world?.getBiomeName?.(this.x, this.y, this.z) ?? '';
      this.villagerType = villagerTypeForBiome(biome);
    }
    if (this.levelUpTimer > 0) {
      this.levelUpTimer--;
      if (this.levelUpTimer === 0) this.levelUp();
    }
    this.tickSleep();
    this.tickJobSite();
    this.tickRestock();
    this.tickFoodPickup();
    this.tickFarmLife();
  }

  // ---- job site -----------------------------------------------------------

  private tickJobSite(): void {
    if (this.tickCount < this.nextJobScan) return;
    this.nextJobScan = this.tickCount + JOB_SCAN_INTERVAL;
    if (this.jobSite) {
      const state = this.level.getBlockState(this.jobSite.x, this.jobSite.y, this.jobSite.z);
      const name = this.level.mc.blockOf(state).name;
      if (WORKSTATION_PROFESSION[name] !== this.profession) this.loseJob();
      return;
    }
    if (this.profession !== 'none') return;
    const site = this.findWorkstation();
    if (site) this.claimJobSite(site);
  }

  private findWorkstation(): JobSite | null {
    const ox = Math.floor(this.x), oy = Math.floor(this.y), oz = Math.floor(this.z);
    for (let dy = -4; dy <= 4; dy++) {
      const y = oy + dy;
      for (let dz = -JOB_SCAN_RADIUS; dz <= JOB_SCAN_RADIUS; dz++) {
        const z = oz + dz;
        for (let dx = -JOB_SCAN_RADIUS; dx <= JOB_SCAN_RADIUS; dx++) {
          const x = ox + dx;
          const name = this.level.mc.blockOf(this.level.getBlockState(x, y, z)).name;
          const profession = WORKSTATION_PROFESSION[name];
          if (!profession) continue;
          const key = siteKey(x, y, z);
          const owner = CLAIMED_SITES.get(key);
          if (owner && owner !== this && !owner.isRemoved() && !owner.dead) continue;
          return { x, y, z, profession };
        }
      }
    }
    return null;
  }

  private claimJobSite(site: JobSite): void {
    CLAIMED_SITES.set(siteKey(site.x, site.y, site.z), this);
    this.jobSite = site;
    this.profession = site.profession;
    this.professionLevel = 1;
    this.xp = 0;
    this.offers = [];
    this.addOffersForLevel(1);
  }

  private loseJob(): void {
    this.releaseJobSite();
    this.profession = 'none';
    this.professionLevel = 1;
    this.xp = 0;
    this.offers = [];
  }

  private releaseJobSite(): void {
    if (!this.jobSite) return;
    const key = siteKey(this.jobSite.x, this.jobSite.y, this.jobSite.z);
    if (CLAIMED_SITES.get(key) === this) CLAIMED_SITES.delete(key);
    this.jobSite = null;
  }

  // ---- offers / levels / restock ------------------------------------------

  private addOffersForLevel(level: number): void {
    const trades = VillagerTrades.current;
    const registry: ItemRegistry | null = this.world?.getRegistry?.() ?? null;
    if (!trades || !registry || this.profession === 'none') return;
    this.offers.push(...trades.createOffers(this.profession, level, registry, this.random));
  }

  private shouldIncreaseLevel(): boolean {
    return this.professionLevel >= 1 && this.professionLevel < 5
      && this.xp >= LEVEL_XP[this.professionLevel];
  }

  private levelUp(): void {
    if (this.professionLevel >= 5) return;
    this.professionLevel++;
    this.addOffersForLevel(this.professionLevel);
  }

  private updateDemand(): void {
    for (const offer of this.offers) offer.updateDemand();
  }

  private needsToRestock(): boolean {
    return this.offers.some((offer) => offer.needsRestock());
  }

  private allowedToRestock(): boolean {
    return this.restocksToday === 0
      || (this.restocksToday < 2 && this.level.gameTime > this.lastRestockGameTime + 2400);
  }

  /** Villager.shouldRestock with the overworld day clock. */
  shouldRestock(gameTime: number, day: number): boolean {
    let newDay = gameTime > this.lastRestockGameTime + 12000;
    newDay = newDay || (this.lastRestockCheckDay > 0 && day > this.lastRestockCheckDay);
    this.lastRestockCheckDay = day;
    if (newDay) {
      this.lastRestockGameTime = gameTime;
      const missed = 2 - this.restocksToday;
      if (missed > 0) for (const offer of this.offers) offer.resetUses();
      for (let i = 0; i < missed; i++) this.updateDemand();
      this.restocksToday = 0;
    }
    return this.allowedToRestock() && this.needsToRestock();
  }

  restock(): void {
    this.updateDemand();
    for (const offer of this.offers) offer.resetUses();
    this.lastRestockGameTime = this.level.gameTime;
    this.restocksToday++;
  }

  private tickRestock(): void {
    if (this.tickCount < this.nextRestockCheck) return;
    this.nextRestockCheck = this.tickCount + 20;
    if (this.profession === 'none') return;
    const day = Math.floor(this.level.time / 24000);
    if (this.shouldRestock(this.level.gameTime, day)) this.restock();
  }

  // ---- Merchant -----------------------------------------------------------

  getOffers(): MerchantOffer[] { return this.offers; }
  overrideOffers(offers: MerchantOffer[]): void { this.offers = offers; }
  getVillagerXp(): number { return this.xp; }
  /** Villager does not override overrideXp; XP is added by notifyTrade only. */
  overrideXp(_xp: number): void { /* no-op, matches Villager */ }
  notifyTrade(offer: MerchantOffer): void {
    offer.increaseUses();
    this.xp += offer.xp;
    if (this.shouldIncreaseLevel() && this.levelUpTimer === 0) this.levelUpTimer = 40;
  }
  notifyTradeUpdated(_stack: ItemStack): void { /* sound is played by the game layer */ }
  isClientSide(): boolean { return true; }
  getTradingPlayer(): unknown { return this.tradingPlayer; }
  setTradingPlayer(player: unknown): void {
    const wasTrading = this.tradingPlayer != null && player == null;
    this.tradingPlayer = player;
    if (wasTrading) for (const offer of this.offers) offer.resetSpecialPriceDiff();
  }
  getNotifyTradeSound(): string { return 'entity.villager.yes'; }
  stillValid(_player: unknown): boolean { return !this.isRemoved() && !this.dead; }
  canRestock(): boolean { return true; }

  /** Persistence (WorldRecord.villagers). */
  toJSON(): SavedVillager {
    return {
      x: this.x, y: this.y, z: this.z,
      health: this.health,
      villagerType: this.villagerType,
      profession: this.profession,
      professionLevel: this.professionLevel,
      xp: this.xp,
      jobSite: this.jobSite ? { x: this.jobSite.x, y: this.jobSite.y, z: this.jobSite.z } : null,
      offers: this.offers.map((offer) => offer.toJSON()),
      age: this.age,
      foodPoints: this.foodPoints,
      wheat: this.wheat,
      seeds: this.seeds,
    };
  }

  restore(data: SavedVillager, registry: ItemRegistry): void {
    this.health = Math.max(1, Math.min(this.maxHealth, data.health));
    this.villagerType = data.villagerType || 'plains';
    this.setAge(data.age ?? 0);
    this.foodPoints = data.foodPoints ?? 0;
    this.wheat = data.wheat ?? 0;
    this.seeds = data.seeds ?? 0;
    this.profession = data.profession || 'none';
    this.professionLevel = Math.max(1, Math.min(5, data.professionLevel || 1));
    this.xp = data.xp || 0;
    this.jobSite = data.jobSite ? { ...data.jobSite, profession: this.profession } : null;
    if (this.jobSite) CLAIMED_SITES.set(siteKey(this.jobSite.x, this.jobSite.y, this.jobSite.z), this);
    this.offers = (data.offers ?? []).map((offer) => MerchantOffer.fromJSON(offer, registry));
  }
}
