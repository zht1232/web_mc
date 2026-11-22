// Source: net.minecraft.world.entity.npc.villager.Villager (26.2)
//
// Adult villager with a job site (POI) sensor, profession levels, offers and
// restocking. The brain is simplified to the shared goal selector: stroll,
// look at the player and random look. Trading is exposed through the Merchant
// interface consumed by MerchantMenu.
//
// Vanilla assigns a profession when a villager claims a workstation; this port
// does the same with a 16-block scan (the vanilla POI manager is chunk-based).

import { Mob } from '../Mob.js';
import { FloatGoal } from '../ai/goal/FloatGoal.js';
import { RandomStrollGoal } from '../ai/goal/RandomStrollGoal.js';
import { LookAtPlayerGoal } from '../ai/goal/LookAtPlayerGoal.js';
import { RandomLookAroundGoal } from '../ai/goal/RandomLookAroundGoal.js';
import { entityType } from '../EntityType.js';
import type { ClientLevel } from '../../level/ClientLevel.js';
import type { ItemRegistry } from '../../item/Item.js';
import type { ItemStack } from '../../item/ItemStack.js';
import type { Merchant } from '../../item/trading/Merchant.js';
import { MerchantOffer } from '../../item/trading/MerchantOffer.js';
import type { SavedVillager } from '../../level/storage/LevelSummary.js';
import { VillagerTrades } from './VillagerTrades.js';

/** VillagerData.NEXT_LEVEL_XP_THRESHOLDS. */
export const LEVEL_XP: readonly number[] = [0, 10, 70, 150, 250];

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

interface JobSite { x: number; y: number; z: number; profession: string }

/** One villager per workstation, like the vanilla POI owner. */
const CLAIMED_SITES = new Map<string, Villager>();

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
  lastRestockGameTime = 0;
  restocksToday = 0;
  lastRestockCheckDay = 0;
  /** 40-tick delay before a level-up adds the next tier's offers. */
  private levelUpTimer = 0;
  private nextJobScan = 0;
  private nextRestockCheck = 0;
  private typeFinalized = false;

  constructor(level: ClientLevel) {
    super(entityType('villager'), level);
    this.speed = 0.5;
    this.maxHealth = 20;
    this.health = 20;
  }

  protected registerGoals(): void {
    this.goalSelector.addGoal(0, new FloatGoal(this));
    this.goalSelector.addGoal(1, new RandomStrollGoal(this, 0.6));
    this.goalSelector.addGoal(2, new LookAtPlayerGoal(this, 8));
    this.goalSelector.addGoal(3, new RandomLookAroundGoal(this));
  }

  /** AbstractVillager: a trading villager holds still until the screen closes. */
  override serverAiStep(): void {
    if (this.tradingPlayer != null) {
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
    this.tickJobSite();
    this.tickRestock();
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
    };
  }

  restore(data: SavedVillager, registry: ItemRegistry): void {
    this.health = Math.max(1, Math.min(this.maxHealth, data.health));
    this.villagerType = data.villagerType || 'plains';
    this.profession = data.profession || 'none';
    this.professionLevel = Math.max(1, Math.min(5, data.professionLevel || 1));
    this.xp = data.xp || 0;
    this.jobSite = data.jobSite ? { ...data.jobSite, profession: this.profession } : null;
    if (this.jobSite) CLAIMED_SITES.set(siteKey(this.jobSite.x, this.jobSite.y, this.jobSite.z), this);
    this.offers = (data.offers ?? []).map((offer) => MerchantOffer.fromJSON(offer, registry));
  }
}
