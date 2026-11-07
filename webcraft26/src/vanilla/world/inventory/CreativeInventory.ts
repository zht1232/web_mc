// Source: net.minecraft.world.item.CreativeModeTabs (26.2)
//         net.minecraft.client.gui.screens.inventory.CreativeModeInventoryScreen
//
// Data source for the creative inventory screen: the 14 vanilla tabs plus a
// searchable flat item list built from items.json. The GUI consumes
// `tabs[i].items` (namespaced ids) exactly like data/creative_tabs.json.

import { ItemStack } from '../item/ItemStack.js';
import type { ItemRegistry } from '../item/Item.js';

export interface CreativeTab {
  key: string;
  icon: string;
  items: string[];
}

export const CREATIVE_TAB_KEYS = [
  'Building Blocks', 'Colored Blocks', 'Natural Blocks', 'Functional Blocks',
  'Redstone Blocks', 'Saved Hotbars', 'Search Items', 'Tools & Utilities',
  'Combat', 'Food & Drinks', 'Ingredients', 'Spawn Eggs',
  'Operator Utilities', 'Survival Inventory',
] as const;

export const TAB_SEARCH = 6;
export const TAB_SURVIVAL = 13;

const TAB_ICONS: Record<string, string> = {
  'Building Blocks': 'minecraft:bricks', 'Colored Blocks': 'minecraft:cyan_wool',
  'Natural Blocks': 'minecraft:grass_block', 'Functional Blocks': 'minecraft:oak_sign',
  'Redstone Blocks': 'minecraft:redstone', 'Saved Hotbars': 'minecraft:bookshelf',
  'Search Items': 'minecraft:compass', 'Tools & Utilities': 'minecraft:diamond_pickaxe',
  'Combat': 'minecraft:netherite_sword', 'Food & Drinks': 'minecraft:golden_apple',
  'Ingredients': 'minecraft:iron_ingot', 'Spawn Eggs': 'minecraft:creeper_spawn_egg',
  'Operator Utilities': 'minecraft:command_block', 'Survival Inventory': 'minecraft:chest',
};

const COLOR_WORDS = /(white|orange|magenta|light_blue|yellow|lime|pink|gray|light_gray|cyan|purple|blue|brown|green|red|black)_/;
const FOOD_HINT = /(bread|apple|carrot|potato|beef|pork|mutton|chicken|cod|salmon|cookie|cake|stew|soup|berry|melon|pumpkin_pie|honey|golden_|meat|fish|stew)/;
const TOOL_HINT = /(pickaxe|axe|shovel|hoe|sword|shears|fishing_rod|flint_and_steel|bucket|compass|clock|map|elytra|Spyglass|spyglass|brush|bucket)/;
const COMBAT_HINT = /(sword|bow|crossbow|arrow|armor|helmet|chestplate|leggings|boots|shield|trident|totem|turtle_helmet)/;
const INGREDIENT_HINT = /(ingot|nugget|dust|stick|string|leather|feather|flint|coal|diamond|emerald|redstone|lapis|quartz|bone|gunpowder|blaze|ender|netherite|slime|paper|book|dye|shard|crystal|scrap|disc_fragment)/;
const NATURAL_HINT = /(log|wood|leaves|sapling|ore|dirt|grass_block|sand|gravel|stone|granite|diorite|andesite|deepslate|cobble|obsidian|ice|snow|clay|moss|vine|lily|seagrass|kelp|bamboo|cactus|netherrack|soul_sand|magma|basalt|amethyst|calcite|tuff|dripstone|root|mud)/;
const FUNCTIONAL_HINT = /(crafting_table|furnace|chest|barrel|hopper|dispenser|dropper|piston|observer|lever|button|door|trapdoor|fence_gate|bed|anvil|enchanting_table|brewing_stand|cauldron|loom|smithing|grindstone|cartography|lectern|composter|beacon|jukebox|note_block|ladder|torch|lantern|sign|banner|shulker_box|end_chest|ender_chest|spawner)/;
const REDSTONE_HINT = /(redstone|repeater|comparator|piston|observer|lever|daylight_detector|tripwire|pressure_plate|rail|torch|lamp|target|bell|note_block|dispenser|dropper|hopper)/;
const OPERATOR_HINT = /(command_block|barrier|structure|light|debug|jigsaw|spawner|bedrock|end_portal|nether_portal)/;

function categorize(name: string): number {
  if (name.endsWith('_spawn_egg')) return 11;
  if (OPERATOR_HINT.test(name)) return 12;
  if (name.includes('redstone') || REDSTONE_HINT.test(name)) return 4;
  if (COMBAT_HINT.test(name)) return 8;
  if (TOOL_HINT.test(name)) return 7;
  if (FOOD_HINT.test(name)) return 9;
  if (INGREDIENT_HINT.test(name)) return 10;
  if (COLOR_WORDS.test(name) && /(wool|concrete|terracotta|glass|stained|carpet|candle|glazed|shulker_box|bed|banner|dye)/.test(name)) return 1;
  if (NATURAL_HINT.test(name)) return 2;
  if (FUNCTIONAL_HINT.test(name)) return 3;
  return 0; // Building Blocks
}

export class CreativeInventory {
  readonly registry: ItemRegistry;
  readonly lang: Record<string, string>;
  readonly tabs: CreativeTab[] = [];
  private readonly allStacks: ItemStack[] = [];
  private readonly searchIndex: Array<{ item: ItemStack; text: string }> = [];

  constructor(registry: ItemRegistry, lang?: Record<string, string>) {
    this.registry = registry;
    this.lang = lang ?? {};
    for (const k of CREATIVE_TAB_KEYS) this.tabs.push({ key: k, icon: TAB_ICONS[k] ?? 'minecraft:stone', items: [] });

    for (const item of registry.items) {
      if (item.name === 'air' || item.id === registry.air.id) continue;
      const stack = new ItemStack(item, Math.min(item.maxStack, 1));
      this.allStacks.push(stack);
      const id = item.namespacedId;
      this.tabs[categorize(item.name)].items.push(id);
      this.tabs[TAB_SEARCH].items.push(id);
      const label = this.displayName(item.name).toLowerCase();
      this.searchIndex.push({ item: stack, text: `${label} ${item.name}` });
    }
  }

  displayName(name: string): string {
    const key = `item.minecraft.${name}`;
    const fromLang = this.lang[key];
    if (fromLang) return fromLang;
    return name.split('_').map((w) => w.charAt(0).toUpperCase() + w.slice(1)).join(' ');
  }

  /** Flat list of every item (one stack each) for the search tab. */
  allItems(): readonly ItemStack[] { return this.allStacks; }
  itemCount(): number { return this.allStacks.length; }

  /** CreativeModeInventoryScreen slot contents for one tab. */
  getTabItems(index: number): ItemStack[] {
    const tab = this.tabs[index];
    if (!tab) return [];
    const out: ItemStack[] = [];
    for (const id of tab.items) {
      const item = this.registry.byName(id);
      if (item) out.push(new ItemStack(item, 1));
    }
    return out;
  }

  /** Search by id or localized display name (case-insensitive substring). */
  search(query: string): ItemStack[] {
    const q = query.trim().toLowerCase();
    if (!q) return this.allStacks.slice();
    const out: ItemStack[] = [];
    for (const entry of this.searchIndex) if (entry.text.includes(q)) out.push(entry.item);
    return out;
  }

  /** Namespaced ids for the GUI (ScreenDeps.creativeTabs shape). */
  tabData(): CreativeTab[] {
    return this.tabs.map((t) => ({ key: t.key, icon: t.icon, items: t.items.slice() }));
  }
}
