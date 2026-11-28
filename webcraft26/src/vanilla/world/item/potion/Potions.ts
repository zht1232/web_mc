// Source: net.minecraft.world.item.alchemy.Potion / Potions / BrewingRecipeRegistry
//
// Potion ids follow the vanilla naming scheme (`swiftness`, `long_swiftness`,
// `strong_swiftness`, ...). The item component `potion` stores the id; effect
// duration/amplifier are derived from the base potion + prefix.

export interface ActivePotionEffect {
  id: string;
  duration: number;
  amplifier: number;
}

interface BasePotion {
  effect: string;
  duration: number;
  longDuration?: number;
  strongDuration?: number;
  strongAmp?: number;
}

const BASE: Record<string, BasePotion> = {
  swiftness: { effect: 'speed', duration: 3600, longDuration: 9600, strongDuration: 1800, strongAmp: 1 },
  leaping: { effect: 'jump_boost', duration: 3600, longDuration: 9600, strongDuration: 1800, strongAmp: 1 },
  healing: { effect: 'instant_health', duration: 1, strongAmp: 1 },
  harming: { effect: 'instant_damage', duration: 1, strongAmp: 1 },
  poison: { effect: 'poison', duration: 900, longDuration: 1800, strongDuration: 432, strongAmp: 1 },
  regeneration: { effect: 'regeneration', duration: 900, longDuration: 1800, strongDuration: 450, strongAmp: 1 },
  fire_resistance: { effect: 'fire_resistance', duration: 3600, longDuration: 9600 },
  water_breathing: { effect: 'water_breathing', duration: 3600, longDuration: 9600 },
  night_vision: { effect: 'night_vision', duration: 3600, longDuration: 9600 },
  strength: { effect: 'strength', duration: 3600, longDuration: 9600, strongDuration: 1800, strongAmp: 1 },
  slowness: { effect: 'slowness', duration: 1800, longDuration: 4800, strongDuration: 400, strongAmp: 3 },
  weakness: { effect: 'weakness', duration: 1800, longDuration: 4800 },
  invisibility: { effect: 'invisibility', duration: 3600, longDuration: 9600 },
  slow_falling: { effect: 'slow_falling', duration: 1800, longDuration: 4800 },
  wind_charged: { effect: 'wind_charged', duration: 3600 },
  weaving: { effect: 'weaving', duration: 3600 },
  oozing: { effect: 'oozing', duration: 3600 },
  infested: { effect: 'infested', duration: 3600 },
  water: { effect: '', duration: 0 },
  awkward: { effect: '', duration: 0 },
  thick: { effect: '', duration: 0 },
  mundane: { effect: '', duration: 0 },
};

export interface PotionSpec {
  base: string;
  variant: 'normal' | 'long' | 'strong';
  splash: boolean;
  lingering: boolean;
}

/** Splits `splash_long_swiftness` into its base id and modifiers. */
export function parsePotion(id: string): PotionSpec {
  let rest = id;
  let splash = false;
  let lingering = false;
  if (rest.startsWith('splash_')) { splash = true; rest = rest.slice(7); }
  else if (rest.startsWith('lingering_')) { lingering = true; rest = rest.slice(10); }
  let variant: PotionSpec['variant'] = 'normal';
  if (rest.startsWith('long_')) { variant = 'long'; rest = rest.slice(5); }
  else if (rest.startsWith('strong_')) { variant = 'strong'; rest = rest.slice(7); }
  return { base: rest, variant, splash, lingering };
}

/** Potion.getEffects(): the active effect list for a potion id. */
export function potionEffects(id: string | undefined): ActivePotionEffect[] {
  if (!id) return [];
  const spec = parsePotion(id);
  // Turtle master is the only vanilla potion that carries two effects
  // (Potions.java: slowness III/IV + resistance II/III).
  if (spec.base === 'turtle_master') {
    const duration = spec.variant === 'long' ? 800 : 400;
    const strong = spec.variant === 'strong';
    return [
      { id: 'slowness', duration, amplifier: strong ? 5 : 3 },
      { id: 'resistance', duration, amplifier: strong ? 3 : 2 },
    ];
  }
  const def = BASE[spec.base];
  if (!def || !def.effect) return [];
  const duration = spec.variant === 'long'
    ? (def.longDuration ?? def.duration)
    : spec.variant === 'strong' ? (def.strongDuration ?? def.duration) : def.duration;
  const amplifier = spec.variant === 'strong' ? (def.strongAmp ?? 0) : 0;
  return [{ id: def.effect, duration, amplifier }];
}

export interface BrewResult { item: 'potion' | 'splash_potion' | 'lingering_potion'; potion: string }

/** Potions used by the Awkward base (PotionBrewing.addMix(AWKWARD, ...)). */
const AWKWARD_INGREDIENTS: Record<string, string> = {
  sugar: 'swiftness',
  rabbit_foot: 'leaping',
  glistering_melon_slice: 'healing',
  spider_eye: 'poison',
  pufferfish: 'water_breathing',
  magma_cream: 'fire_resistance',
  blaze_powder: 'strength',
  golden_carrot: 'night_vision',
  phantom_membrane: 'slow_falling',
};

/** Water + these ingredients makes a mundane potion (PotionBrewing.addMix(WATER, ...)). */
const MUNDANE_INGREDIENTS: ReadonlySet<string> = new Set([
  'ghast_tear', 'glistering_melon_slice', 'blaze_powder', 'spider_eye', 'sugar',
  'magma_cream', 'rabbit_foot', 'pufferfish', 'golden_carrot', 'phantom_membrane',
  'redstone',
]);

/** Water + glowstone dust makes a thick potion. */
const THICK_INGREDIENT = 'glowstone_dust';

/** Every item that can be placed in the brewing stand's ingredient slot. */
export const BREWING_INGREDIENTS: ReadonlySet<string> = new Set([
  'nether_wart', 'redstone', 'glowstone_dust', 'fermented_spider_eye',
  'gunpowder', 'dragon_breath',
  ...Object.keys(AWKWARD_INGREDIENTS), ...MUNDANE_INGREDIENTS,
]);

/** Fermented spider eye corruption (PotionBrewing mixes keyed by full potion id). */
const CORRUPT: Readonly<Record<string, string>> = {
  water: 'weakness',
  swiftness: 'slowness',
  long_swiftness: 'long_slowness',
  leaping: 'slowness',
  long_leaping: 'long_slowness',
  healing: 'harming',
  strong_healing: 'strong_harming',
  poison: 'harming',
  long_poison: 'harming',
  strong_poison: 'strong_harming',
  night_vision: 'invisibility',
  long_night_vision: 'long_invisibility',
};

/**
 * BrewingRecipeRegistry: returns the potion produced by `ingredient`, or null.
 * `itemName` is the container being brewed (potion / splash_potion /
 * lingering_potion); the item type is preserved like vanilla, except that
 * gunpowder turns a potion into a splash potion and dragon breath turns a
 * splash potion into a lingering potion.
 */
export function brewResult(
  potionId: string | undefined,
  ingredient: string,
  itemName: BrewResult['item'] = 'potion',
): BrewResult | null {
  const spec = potionId ? parsePotion(potionId) : null;
  const base = spec?.base ?? 'water';
  const fullId = `${spec?.variant === 'long' ? 'long_' : spec?.variant === 'strong' ? 'strong_' : ''}${base}`;
  if (ingredient === 'gunpowder') {
    return itemName === 'potion' ? { item: 'splash_potion', potion: fullId } : null;
  }
  if (ingredient === 'dragon_breath') {
    return itemName === 'splash_potion' ? { item: 'lingering_potion', potion: fullId } : null;
  }
  // A splash / lingering potion can no longer take redstone, glowstone or a
  // fermented spider eye.
  if (itemName !== 'potion') return null;
  const item = itemName;
  if (base === 'water') {
    if (ingredient === 'nether_wart') return { item, potion: 'awkward' };
    if (ingredient === THICK_INGREDIENT) return { item, potion: 'thick' };
    if (ingredient === 'fermented_spider_eye') return { item, potion: 'weakness' };
    if (MUNDANE_INGREDIENTS.has(ingredient)) return { item, potion: 'mundane' };
    return null;
  }
  if (base === 'awkward') {
    const out = AWKWARD_INGREDIENTS[ingredient];
    return out ? { item, potion: out } : null;
  }
  const def = BASE[base];
  if (!def || !def.effect) return null;
  if (ingredient === 'redstone') {
    if (spec?.variant === 'normal' && def.longDuration) return { item, potion: `long_${base}` };
    return null;
  }
  if (ingredient === THICK_INGREDIENT) {
    if (spec?.variant === 'normal' && def.strongAmp !== undefined) return { item, potion: `strong_${base}` };
    return null;
  }
  if (ingredient === 'fermented_spider_eye') {
    const corrupt = CORRUPT[fullId];
    if (corrupt) return { item, potion: corrupt };
    return null;
  }
  return null;
}

/** Potion item ids that carry the `potion` component. */
export const POTION_ITEMS: ReadonlySet<string> = new Set(['potion', 'splash_potion', 'lingering_potion']);

/**
 * #minecraft:tradeable potion ids, rolled by the fletcher's master trade
 * (`set_random_potion`). Same order as data/minecraft/tags/potion/tradeable.json.
 */
export const TRADEABLE_POTIONS: readonly string[] = [
  'wind_charged', 'oozing', 'infested', 'weaving',
  'night_vision', 'long_night_vision',
  'invisibility', 'long_invisibility',
  'fire_resistance', 'long_fire_resistance',
  'leaping', 'long_leaping', 'strong_leaping',
  'slowness', 'long_slowness', 'strong_slowness',
  'turtle_master', 'long_turtle_master', 'strong_turtle_master',
  'swiftness', 'long_swiftness', 'strong_swiftness',
  'water_breathing', 'long_water_breathing',
  'healing', 'strong_healing',
  'harming', 'strong_harming',
  'poison', 'long_poison', 'strong_poison',
  'regeneration', 'long_regeneration', 'strong_regeneration',
  'strength', 'long_strength', 'strong_strength',
  'weakness', 'long_weakness',
  'slow_falling', 'long_slow_falling',
];
