// Port of the creative-mode tab data used by
// net.minecraft.client.gui.screens.inventory.CreativeModeInventoryScreen.
//
// The authoritative tab list lives in webcraft26/data/creative_tabs.json
// ({"tabs":[{"key","icon","items"}]}). That file is a build-time asset and is
// NOT served under public/mc, so the 14 tab definitions are transcribed here
// as DEFAULT_CREATIVE_TABS. ScreenDeps.creativeTabs can override them at runtime,
// and loadCreativeTabs() can parse the JSON shape if the main agent serves it.
//
// Pure module: no DOM, safe to import from Node/tsx.

import type { CreativeTabData } from './Types.js';

/** The 14 tabs, transcribed verbatim from data/creative_tabs.json. */
export const DEFAULT_CREATIVE_TABS: CreativeTabData[] = [
  { key: 'Building Blocks', icon: 'minecraft:bricks', items: [] },
  { key: 'Colored Blocks', icon: 'minecraft:cyan_wool', items: [] },
  { key: 'Natural Blocks', icon: 'minecraft:grass_block', items: [] },
  { key: 'Functional Blocks', icon: 'minecraft:oak_sign', items: [] },
  { key: 'Redstone Blocks', icon: 'minecraft:redstone', items: [] },
  { key: 'Saved Hotbars', icon: 'minecraft:bookshelf', items: [] },
  { key: 'Search Items', icon: 'minecraft:compass', items: [] },
  { key: 'Tools & Utilities', icon: 'minecraft:diamond_pickaxe', items: [] },
  { key: 'Combat', icon: 'minecraft:netherite_sword', items: [] },
  { key: 'Food & Drinks', icon: 'minecraft:golden_apple', items: [] },
  { key: 'Ingredients', icon: 'minecraft:iron_ingot', items: [] },
  { key: 'Spawn Eggs', icon: 'minecraft:creeper_spawn_egg', items: [] },
  { key: 'Operator Utilities', icon: 'minecraft:command_block', items: [] },
  { key: 'Survival Inventory', icon: 'minecraft:chest', items: [] },
];

/** Strips the "minecraft:" namespace prefix from an item id. */
export function itemId(id: string): string {
  return id.startsWith('minecraft:') ? id.slice('minecraft:'.length) : id;
}

export interface CreativeTabsFile {
  tabs: { key: string; icon: string; items: string[] }[];
}

/** Parses the data/creative_tabs.json shape. */
export function loadCreativeTabs(json: CreativeTabsFile): CreativeTabData[] {
  return (json.tabs ?? []).map((t) => ({
    key: t.key,
    icon: t.icon,
    items: Array.isArray(t.items) ? t.items.slice() : [],
  }));
}

export function countCreativeTabs(json: CreativeTabsFile): number {
  return (json.tabs ?? []).length;
}

export interface CreativeTabValidation {
  missing: string[];
  checked: number;
}

/**
 * Verifies that every item id referenced by a tab (its icon and its items)
 * exists in the given item-name set. Mirrors the "all tab item ids exist in
 * items.json" invariant from the GUI test suite.
 */
export function validateCreativeTabs(
  tabs: readonly CreativeTabData[],
  itemNames: ReadonlySet<string>,
): CreativeTabValidation {
  const missing: string[] = [];
  let checked = 0;
  for (const tab of tabs) {
    for (const ref of [tab.icon, ...tab.items]) {
      checked++;
      if (!itemNames.has(itemId(ref))) missing.push(`${tab.key}:${ref}`);
    }
  }
  return { missing, checked };
}

/** Vanilla tab indices (CreativeModeTabs) used by the tab bar sprites. */
export const TAB_SEARCH = 6;
export const TAB_SURVIVAL = 13;
export const TAB_SAVED_HOTBARS = 5;

// ---------------------------------------------------------------------------
// Runtime population. data/creative_tabs.json ships with empty items arrays,
// so the item lists are derived from the injected item registry. This is a
// keyword heuristic; the main agent can supply exact lists via ScreenDeps.
// ---------------------------------------------------------------------------

const KEYWORDS: Record<string, string[]> = {
  'Building Blocks': ['planks', 'bricks', 'stone_bricks', 'deepslate_bricks', 'quartz_block', 'purpur_block', 'prismarine', 'smooth_stone', 'cut_', '_stairs', '_slab', '_wall', 'chiseled', 'cracked', 'mossy', 'infested'],
  'Colored Blocks': ['wool', 'carpet', 'concrete', 'terracotta', 'stained_glass', 'glazed', 'candle', 'banner', 'shulker_box', 'bed_', '_bed', 'dye'],
  'Natural Blocks': ['_ore', 'dirt', 'grass_block', 'sand', 'gravel', 'clay', 'ice', 'snow', 'log', 'leaves', 'sapling', 'vine', 'moss', 'mushroom', 'flower', 'coral', 'seagrass', 'kelp', 'podzol', 'mycelium', 'netherrack', 'end_stone', 'obsidian', 'bedrock', 'water', 'lava', 'sponge', 'cobblestone'],
  'Functional Blocks': ['chest', 'furnace', 'crafting_table', 'anvil', 'enchanting_table', 'lectern', 'loom', 'smithing_table', 'grindstone', 'stonecutter', 'cartography', 'beacon', 'conduit', 'hopper', 'dispenser', 'dropper', 'piston', 'observer', 'note_block', 'jukebox', 'brewing_stand', 'cauldron', 'composter', 'barrel', 'bell', 'campfire', 'lantern', 'torch', 'ladder', 'fence', 'door', 'trapdoor', 'gate', 'sign', 'bedrock'],
  'Redstone Blocks': ['redstone', 'repeater', 'comparator', 'piston', 'lever', 'button', 'pressure_plate', 'tripwire', 'daylight_detector', 'hopper', 'dispenser', 'dropper', 'observer', 'target', 'note_block', 'lamp', 'rail'],
  'Tools & Utilities': ['pickaxe', 'axe', 'shovel', 'hoe', 'shears', 'fishing_rod', 'flint_and_steel', 'bucket', 'compass', 'clock', 'map', 'spyglass', 'elytra', 'minecart', 'boat', 'lead', 'name_tag', 'saddle', 'brush', 'bundle'],
  'Combat': ['sword', 'bow', 'crossbow', 'arrow', 'trident', 'shield', 'helmet', 'chestplate', 'leggings', 'boots', 'armor', 'totem', 'tnt', 'end_crystal', 'firework'],
  'Food & Drinks': ['apple', 'bread', 'beef', 'porkchop', 'chicken', 'mutton', 'rabbit', 'cod', 'salmon', 'tropical_fish', 'potato', 'carrot', 'beetroot', 'melon', 'pumpkin_pie', 'cookie', 'cake', 'stew', 'soup', 'honey', 'berry', 'chorus_fruit', 'golden_', 'milk', 'potion'],
  'Ingredients': ['ingot', 'nugget', 'dust', 'diamond', 'emerald', 'lapis', 'quartz', 'netherite', 'stick', 'flint', 'feather', 'leather', 'bone', 'string', 'gunpowder', 'blaze', 'ender_pearl', 'slime', 'ghast', 'spider_eye', 'rotten_flesh', 'wheat', 'sugar', 'paper', 'book', 'dye', 'shard', 'crystal', 'obsidian', 'clay_ball', 'brick', 'nether_brick'],
  'Spawn Eggs': ['_spawn_egg'],
  'Operator Utilities': ['command_block', 'barrier', 'structure_block', 'structure_void', 'light', 'debug_stick', 'jigsaw', 'spawner', 'bedrock', 'knowledge_book'],
};

function tabForItem(name: string): string {
  for (const [tab, words] of Object.entries(KEYWORDS)) {
    for (const w of words) if (name.includes(w)) return tab;
  }
  return 'Building Blocks';
}

/**
 * Builds a populated copy of the tab list from the item registry.
 * "Search Items" always receives every item; "Survival Inventory" receives the
 * 36-slot subset; "Saved Hotbars" stays empty (it is a hotbar preset view).
 */
export function populateCreativeTabs(
  tabs: readonly CreativeTabData[],
  itemNames: readonly string[],
): CreativeTabData[] {
  const buckets = new Map<string, string[]>();
  for (const t of tabs) buckets.set(t.key, t.items.length ? t.items.slice() : []);
  for (const name of itemNames) {
    if (name === 'air') continue;
    buckets.get(tabForItem(name))?.push(name);
  }
  const all = itemNames.filter((n) => n !== 'air');
  if (buckets.has('Search Items')) buckets.set('Search Items', all.slice());
  if (buckets.has('Survival Inventory')) buckets.set('Survival Inventory', all.slice(0, 36));
  return tabs.map((t) => ({ ...t, items: buckets.get(t.key) ?? [] }));
}
