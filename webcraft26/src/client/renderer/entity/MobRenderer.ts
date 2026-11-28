// Source: net.minecraft.client.renderer.entity.MobRenderer / LivingEntityRenderer
//         + net.minecraft.client.renderer.entity.CreeperRenderer
//
// Resolves a mob's baked model + texture from the registry and renders it with
// the shared transform in EntityRenderer. Mob-specific render state that lives
// in the entity class itself (creeper swelling) is read here.

import { EntityRenderer, stackId, type EntityLayer } from './EntityRenderer.js';
import {
  MODEL_REGISTRY, SHEEP_WOOL_MODEL, SHEEP_WOOL_TEXTURE,
  ARMOR_LAYER1_TEXTURE, ARMOR_LAYER2_TEXTURE, IRON_GOLEM_CRACK_TEXTURES, type ModelEntry,
} from './model/ModelRegistry.js';
import {
  ArmorHelmetModel, ArmorChestModel, ArmorLegsModel, ArmorBootsModel, BabyVillagerModel,
  LlamaDecorModel,
} from './model/EntityModels.js';
import type { BakedModel } from './model/ModelBox.js';
import type { Entity } from '../../../vanilla/world/entity/Entity.js';
import type { Mob } from '../../../vanilla/world/entity/Mob.js';
import type { LivingEntity } from '../../../vanilla/world/entity/LivingEntity.js';
import { EquipmentSlot } from '../../../vanilla/world/entity/EquipmentSlot.js';
import { SHEEP_WOOL_RGB, type Sheep } from '../../../vanilla/world/entity/animal/Sheep.js';
import { LLAMA_VARIANTS, type Llama } from '../../../vanilla/world/entity/animal/Llama.js';
import type { Villager } from '../../../vanilla/world/entity/npc/Villager.js';

/**
 * Per-type render scale on top of entity.scale.
 *
 * The port stores one `scale` field per entity class, applied by EntityRenderer
 * before the model. For most mobs it is 1, so the vanilla baked mesh renders at
 * vanilla size; for the mobs added in HANDOFF 8.1 it holds a vanilla-ish guess
 * (fox/ocelot 0.8, parrot/cod 0.6, squid 0.8, salmon 0.7) that does NOT match
 * the vanilla sizes. The factors below cancel those guesses and add the vanilla
 * model-layer scale that is missing from the baked geometry (MeshTransformer
 * .scaling). VANILLA_SIZE is what each mob should measure relative to an
 * entity.scale of 1: scale_result = extraScale * entity.scale.
 *
 *   fox/ocelot    extra 1.25  * 0.8 = 1.0  (fox model layer is unscaled; ocelot is unscaled)
 *   parrot        extra 5/3   * 0.6 = 1.0
 *   squid/glow    extra 1.25  * 0.8 = 1.0  (SquidRenderer has no scale)
 *   cod           extra 5/3   * 0.6 = 1.0
 *   salmon        extra 10/7  * 0.7 = 1.0  (medium salmon; the port has no size variants)
 *   witch         extra 0.9375* 1.0 = 0.9375 (ModelLayers.WITCH villagerLikeScale)
 *   cat           no entry   * 0.8 = 0.8  (ModelLayers.CAT CAT_TRANSFORMER 0.8)
 *   cave_spider   no entry   * 0.7 = 0.7  (ModelLayers.CAVE_SPIDER scaling 0.7)
 *   slime         no entry   * 2.0 = 2.0  (AbstractCubeMobRenderer size 2)
 */
const EXTRA_SCALE: Readonly<Record<string, number>> = {
  witch: 0.9375,
  wandering_trader: 0.9375, // ModelLayers.WANDERING_TRADER = villagerLayer * 0.9375
  fox: 1.25,
  ocelot: 1.25,
  parrot: 5 / 3,
  squid: 1.25,
  glow_squid: 1.25,
  cod: 5 / 3,
  salmon: 10 / 7,
};

/**
 * Shadow radius in blocks per type, pre-divided by the entity scale because
 * EntityRenderDispatcher multiplies getShadowRadius() by entity.scale. The
 * resulting block radius matches the vanilla renderer constructor shadowRadius:
 *   slime 0.5 (size*0.25 * 2), cave_spider 0.56, fox/cat/ocelot 0.4,
 *   parrot/cod 0.3, squid/glow_squid 0.7, salmon 0.4, witch/zombie_villager 0.5.
 */
const SHADOW_RADIUS: Readonly<Record<string, number>> = {
  slime: 0.25,          // 0.5  * scale 2
  cave_spider: 0.8,     // 0.56 * scale 0.7
  fox: 0.5,             // 0.4  * scale 0.8
  cat: 0.5,
  ocelot: 0.5,
  parrot: 0.5,          // 0.3  * scale 0.6
  squid: 0.875,         // 0.7  * scale 0.8
  glow_squid: 0.875,
  cod: 0.5,             // 0.3  * scale 0.6
  salmon: 0.5714286,    // 0.4  * scale 0.7
  iron_golem: 0.7,      // IronGolemRenderer super(..., 0.7F)
  llama: 0.7,           // LlamaRenderer super(..., 0.7F)
  trader_llama: 0.7,
  wandering_trader: 0.5, // WanderingTraderRenderer super(..., 0.5F)
};

const HUMAN_ARMOR_TYPES: ReadonlySet<string> = new Set([
  'zombie', 'husk', 'drowned', 'zombie_villager',
  'skeleton', 'stray', 'bogged', 'parched', 'wither_skeleton',
  'zombified_piglin',
  // InventoryScreen preview: the local player is rendered through this renderer too.
  'player',
]);
const WHITE: readonly [number, number, number] = [1, 1, 1];
/** VillagerProfessionLayer.LEVEL_LOCATIONS. */
const VILLAGER_LEVEL_TEXTURES = ['stone', 'iron', 'gold', 'emerald', 'diamond'] as const;

/** `minecraft:iron_helmet` -> `iron`; turtle helmet -> turtle_scute. */
function armorMaterial(id: string): string | null {
  const name = id.startsWith('minecraft:') ? id.slice('minecraft:'.length) : id;
  if (name === 'turtle_helmet') return 'turtle_scute';
  if (!/_(helmet|chestplate|leggings|boots)$/.test(name)) return null;
  const prefix = name.slice(0, name.indexOf('_'));
  if (prefix === 'golden') return 'gold';
  return ['leather', 'chainmail', 'iron', 'diamond', 'netherite', 'copper'].includes(prefix)
    ? prefix : null;
}

export class MobRenderer extends EntityRenderer<Entity> {
  private readonly tint: readonly [number, number, number] = [1, 1, 1];
  private readonly entry: ModelEntry;
  private readonly extraScale: number;
  private readonly shadowRadius: number;
  /** SheepRenderer: one wool layer per DyeColor, reused per frame (no allocation). */
  private readonly woolLayers: readonly EntityLayer[] | null;
  private readonly layerScratch: EntityLayer[] = [];
  private readonly armorLayers: EntityLayer[] = [];
  private readonly villagerLayers: EntityLayer[] = [];

  constructor(private readonly typeName: string) {
    super();
    this.entry = MODEL_REGISTRY[typeName];
    this.extraScale = EXTRA_SCALE[typeName] ?? 1;
    this.shadowRadius = SHADOW_RADIUS[typeName] ?? 0.5;
    this.woolLayers = typeName === 'sheep'
      ? SHEEP_WOOL_RGB.map((tint) => ({ model: SHEEP_WOOL_MODEL, texture: SHEEP_WOOL_TEXTURE, tint }))
      : null;
  }

  getModel(e: Entity): BakedModel {
    // AgeableMobRenderer: babies render the dedicated baby mesh (villager).
    if (this.typeName === 'villager' && (e as Villager).isBaby()) return BabyVillagerModel;
    return this.entry.model;
  }
  getTextureKey(e: Entity): string {
    if (this.typeName === 'villager' && (e as Villager).isBaby()) return 'villager/villager_baby';
    // LlamaRenderer.getTextureLocation: one skin per coat variant.
    if (this.typeName === 'llama' || this.typeName === 'trader_llama') {
      const variant = LLAMA_VARIANTS[(e as Llama).variant] ?? 'creamy';
      return `llama/llama_${variant}`;
    }
    return this.entry.texture;
  }
  getTint(): readonly [number, number, number] { return this.tint; }

  /** Source: VillagerRenderer + VillagerProfessionLayer (type/profession/badge overlays). */
  private villagerProfessionLayers(e: Entity): readonly EntityLayer[] {
    const villager = e as Villager;
    const baby = villager.isBaby();
    const model = baby ? BabyVillagerModel : this.entry.model;
    let n = 0;
    this.villagerLayers[n++] = {
      model,
      texture: `villager/${baby ? 'baby' : 'type'}/${villager.villagerType}`,
      tint: WHITE,
    };
    if (!baby && villager.profession !== 'none') {
      this.villagerLayers[n++] = {
        model,
        texture: `villager/profession/${villager.profession}`,
        tint: WHITE,
      };
      if (villager.profession !== 'nitwit') {
        const level = Math.max(1, Math.min(5, villager.professionLevel));
        this.villagerLayers[n++] = {
          model,
          texture: `villager/profession_level/${VILLAGER_LEVEL_TEXTURES[level - 1]}`,
          tint: WHITE,
        };
      }
    }
    this.villagerLayers.length = n;
    return this.villagerLayers;
  }

  /** Source: IronGolemCrackinessLayer + Crackiness.GOLEM. */
  private ironGolemCrackLayer(e: Entity): readonly EntityLayer[] {
    const golem = e as unknown as { getCrackiness?: () => string };
    const level = typeof golem.getCrackiness === 'function' ? golem.getCrackiness() : 'none';
    if (level === 'low' || level === 'medium' || level === 'high') {
      const index = level === 'low' ? 0 : level === 'medium' ? 1 : 2;
      this.layerScratch[0] = {
        model: this.entry.model,
        texture: IRON_GOLEM_CRACK_TEXTURES[index],
        tint: WHITE,
      };
      return this.layerScratch;
    }
    return super.getLayers(e);
  }

  /** Source: SheepRenderer.render — the wool layer is skipped while sheared. */
  getLayers(e: Entity): readonly EntityLayer[] {
    if (this.typeName === 'villager') return this.villagerProfessionLayers(e);
    if (this.typeName === 'iron_golem') return this.ironGolemCrackLayer(e);
    // LlamaDecorLayer: trader llamas always wear the blue trader carpet.
    if (this.typeName === 'trader_llama') {
      this.layerScratch[0] = {
        model: LlamaDecorModel,
        texture: 'equipment/llama_body/trader_llama',
        tint: WHITE,
      };
      return this.layerScratch;
    }
    if (this.woolLayers) {
      const sheep = e as Sheep;
      if (sheep.sheared) return super.getLayers(e);
      this.layerScratch[0] = this.woolLayers[sheep.woolColor] ?? this.woolLayers[0];
      return this.layerScratch;
    }
    if (HUMAN_ARMOR_TYPES.has(this.typeName)) {
      const living = e as LivingEntity;
      let n = 0;
      const head = living.getItemBySlot(EquipmentSlot.HEAD);
      const headMat = head ? armorMaterial(stackId(head)) : null;
      if (headMat) {
        this.armorLayers[n++] = { model: ArmorHelmetModel, texture: ARMOR_LAYER1_TEXTURE(headMat), tint: WHITE };
      }
      const chest = living.getItemBySlot(EquipmentSlot.CHEST);
      const chestMat = chest ? armorMaterial(stackId(chest)) : null;
      if (chestMat) {
        this.armorLayers[n++] = { model: ArmorChestModel, texture: ARMOR_LAYER1_TEXTURE(chestMat), tint: WHITE };
      }
      const legs = living.getItemBySlot(EquipmentSlot.LEGS);
      const legsMat = legs ? armorMaterial(stackId(legs)) : null;
      if (legsMat) {
        this.armorLayers[n++] = { model: ArmorLegsModel, texture: ARMOR_LAYER2_TEXTURE(legsMat), tint: WHITE };
      }
      const feet = living.getItemBySlot(EquipmentSlot.FEET);
      const feetMat = feet ? armorMaterial(stackId(feet)) : null;
      if (feetMat) {
        this.armorLayers[n++] = { model: ArmorBootsModel, texture: ARMOR_LAYER1_TEXTURE(feetMat), tint: WHITE };
      }
      if (n > 0) {
        this.armorLayers.length = n;
        return this.armorLayers;
      }
    }
    return super.getLayers(e);
  }

  /** Source: MobRenderer constructor shadowRadius (0.5 for the vanilla overworld mobs). */
  getShadowRadius(): number { return this.shadowRadius; }

  /** Source: CreeperRenderer.scale — swelling inflates the model. */
  getExtraScale(e: Entity, out: Float64Array): void {
    if (this.typeName === 'creeper') {
      let g = (e as Mob).swell;
      if (!(g > 0)) { out[0] = 1; out[1] = 1; out[2] = 1; return; }
      const wobble = 1 + Math.sin(g * 100) * g * 0.01;
      g = Math.min(1, g);
      g = g * g;
      g = g * g;
      const s = (1 + g * 0.4) * wobble;
      const hs = (1 + g * 0.1) / wobble;
      out[0] = s; out[1] = hs; out[2] = s;
      return;
    }
    const extra = this.extraScale;
    out[0] = extra; out[1] = extra; out[2] = extra;
  }

  /** Source: CreeperRenderer.getWhiteOverlayProgress — flashing white while swelling. */
  getWhiteOverlay(e: Entity): number {
    if (this.typeName !== 'creeper') return 0;
    const step = (e as Mob).swell;
    if (!(step > 0)) return 0;
    return Math.floor(step * 10) % 2 === 0 ? 0 : Math.min(1, Math.max(0.5, step));
  }
}
