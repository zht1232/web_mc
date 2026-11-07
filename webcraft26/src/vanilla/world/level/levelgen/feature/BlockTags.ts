// Port of the block-tag lookups used by net.minecraft.world.level.levelgen.feature.* and
// net.minecraft.world.level.levelgen.placement.* / blockpredicates.*.
//
// Vanilla reads these from the data pack's tags (BundleableTag). The browser build ships them in
// public/mc/tags.json; FeatureGenerator attaches `blockTags` to the parsed worldgen data (see
// loadWorldgenData). The FALLBACK_BLOCK_TAGS below is a verbatim copy of the tags that are
// actually referenced by the feature/placement data, so the generator also works when no tag
// data was supplied (e.g. a bare WorldgenData loaded with fs in a test).

/** Raw block tag map: { "minecraft:stone_ore_replaceables": ["minecraft:stone", ...] }. */
export type BlockTagData = Record<string, string[]>;

/** Verbatim subset of public/mc/tags.json -> block (only the tags worldgen references). */
export const FALLBACK_BLOCK_TAGS: BlockTagData = {
  "minecraft:stone_ore_replaceables": ["minecraft:stone", "minecraft:granite", "minecraft:diorite", "minecraft:andesite"],
  "minecraft:deepslate_ore_replaceables": ["minecraft:deepslate", "minecraft:tuff"],
  "minecraft:base_stone_overworld": ["minecraft:stone", "minecraft:granite", "minecraft:diorite", "minecraft:andesite", "minecraft:tuff", "minecraft:deepslate"],
  "minecraft:base_stone_nether": ["minecraft:netherrack", "minecraft:basalt", "minecraft:blackstone"],
  "minecraft:replaceable_by_trees": ["minecraft:jungle_leaves", "minecraft:oak_leaves", "minecraft:spruce_leaves", "minecraft:pale_oak_leaves", "minecraft:dark_oak_leaves", "minecraft:acacia_leaves", "minecraft:birch_leaves", "minecraft:azalea_leaves", "minecraft:flowering_azalea_leaves", "minecraft:mangrove_leaves", "minecraft:cherry_leaves", "minecraft:dandelion", "minecraft:open_eyeblossom", "minecraft:poppy", "minecraft:blue_orchid", "minecraft:allium", "minecraft:azure_bluet", "minecraft:red_tulip", "minecraft:orange_tulip", "minecraft:white_tulip", "minecraft:pink_tulip", "minecraft:oxeye_daisy", "minecraft:cornflower", "minecraft:lily_of_the_valley", "minecraft:wither_rose", "minecraft:torchflower", "minecraft:closed_eyeblossom", "minecraft:golden_dandelion", "minecraft:pale_moss_carpet", "minecraft:short_grass", "minecraft:fern", "minecraft:dead_bush", "minecraft:vine", "minecraft:glow_lichen", "minecraft:sunflower", "minecraft:lilac", "minecraft:rose_bush", "minecraft:peony", "minecraft:tall_grass", "minecraft:large_fern", "minecraft:hanging_roots", "minecraft:pitcher_plant", "minecraft:water", "minecraft:seagrass", "minecraft:tall_seagrass", "minecraft:bush", "minecraft:firefly_bush", "minecraft:warped_roots", "minecraft:nether_sprouts", "minecraft:crimson_roots", "minecraft:leaf_litter", "minecraft:short_dry_grass", "minecraft:tall_dry_grass"],
  "minecraft:leaves": ["minecraft:jungle_leaves", "minecraft:oak_leaves", "minecraft:spruce_leaves", "minecraft:pale_oak_leaves", "minecraft:dark_oak_leaves", "minecraft:acacia_leaves", "minecraft:birch_leaves", "minecraft:azalea_leaves", "minecraft:flowering_azalea_leaves", "minecraft:mangrove_leaves", "minecraft:cherry_leaves"],
  "minecraft:logs": ["minecraft:dark_oak_log", "minecraft:dark_oak_wood", "minecraft:stripped_dark_oak_log", "minecraft:stripped_dark_oak_wood", "minecraft:pale_oak_log", "minecraft:pale_oak_wood", "minecraft:stripped_pale_oak_log", "minecraft:stripped_pale_oak_wood", "minecraft:oak_log", "minecraft:oak_wood", "minecraft:stripped_oak_log", "minecraft:stripped_oak_wood", "minecraft:acacia_log", "minecraft:acacia_wood", "minecraft:stripped_acacia_log", "minecraft:stripped_acacia_wood", "minecraft:birch_log", "minecraft:birch_wood", "minecraft:stripped_birch_log", "minecraft:stripped_birch_wood", "minecraft:jungle_log", "minecraft:jungle_wood", "minecraft:stripped_jungle_log", "minecraft:stripped_jungle_wood", "minecraft:spruce_log", "minecraft:spruce_wood", "minecraft:stripped_spruce_log", "minecraft:stripped_spruce_wood", "minecraft:mangrove_log", "minecraft:mangrove_wood", "minecraft:stripped_mangrove_log", "minecraft:stripped_mangrove_wood", "minecraft:cherry_log", "minecraft:cherry_wood", "minecraft:stripped_cherry_log", "minecraft:stripped_cherry_wood", "minecraft:crimson_stem", "minecraft:stripped_crimson_stem", "minecraft:crimson_hyphae", "minecraft:stripped_crimson_hyphae", "minecraft:warped_stem", "minecraft:stripped_warped_stem", "minecraft:warped_hyphae", "minecraft:stripped_warped_hyphae"],
  "minecraft:cannot_replace_below_tree_trunk": ["minecraft:dirt", "minecraft:coarse_dirt", "minecraft:rooted_dirt", "minecraft:mud", "minecraft:muddy_mangrove_roots", "minecraft:moss_block", "minecraft:pale_moss_block", "minecraft:podzol"],
  "minecraft:dirt": ["minecraft:dirt", "minecraft:coarse_dirt", "minecraft:rooted_dirt"],
  "minecraft:air": ["minecraft:air", "minecraft:void_air", "minecraft:cave_air"],
  "minecraft:sand": ["minecraft:sand", "minecraft:red_sand", "minecraft:suspicious_sand"],
  "minecraft:lush_ground_replaceable": ["minecraft:stone", "minecraft:granite", "minecraft:diorite", "minecraft:andesite", "minecraft:tuff", "minecraft:deepslate", "minecraft:cave_vines_plant", "minecraft:cave_vines", "minecraft:dirt", "minecraft:coarse_dirt", "minecraft:rooted_dirt", "minecraft:mud", "minecraft:muddy_mangrove_roots", "minecraft:moss_block", "minecraft:pale_moss_block", "minecraft:grass_block", "minecraft:podzol", "minecraft:mycelium", "minecraft:clay", "minecraft:gravel", "minecraft:sand"],
  "minecraft:moss_replaceable": ["minecraft:stone", "minecraft:granite", "minecraft:diorite", "minecraft:andesite", "minecraft:tuff", "minecraft:deepslate", "minecraft:cave_vines_plant", "minecraft:cave_vines", "minecraft:dirt", "minecraft:coarse_dirt", "minecraft:rooted_dirt", "minecraft:mud", "minecraft:muddy_mangrove_roots", "minecraft:moss_block", "minecraft:pale_moss_block", "minecraft:grass_block", "minecraft:podzol", "minecraft:mycelium"],
  "minecraft:forest_rock_can_place_on": ["minecraft:dirt", "minecraft:coarse_dirt", "minecraft:rooted_dirt", "minecraft:mud", "minecraft:muddy_mangrove_roots", "minecraft:moss_block", "minecraft:pale_moss_block", "minecraft:grass_block", "minecraft:podzol", "minecraft:mycelium", "minecraft:stone", "minecraft:granite", "minecraft:diorite", "minecraft:andesite", "minecraft:tuff", "minecraft:deepslate"],
  "minecraft:features_cannot_replace": ["minecraft:bedrock", "minecraft:spawner", "minecraft:chest", "minecraft:end_portal_frame", "minecraft:reinforced_deepslate", "minecraft:trial_spawner", "minecraft:vault"],
  "minecraft:azalea_grows_on": ["minecraft:dirt", "minecraft:coarse_dirt", "minecraft:rooted_dirt", "minecraft:mud", "minecraft:muddy_mangrove_roots", "minecraft:moss_block", "minecraft:pale_moss_block", "minecraft:grass_block", "minecraft:podzol", "minecraft:mycelium", "minecraft:sand", "minecraft:red_sand", "minecraft:suspicious_sand", "minecraft:terracotta", "minecraft:white_terracotta", "minecraft:orange_terracotta", "minecraft:magenta_terracotta", "minecraft:light_blue_terracotta", "minecraft:yellow_terracotta", "minecraft:lime_terracotta", "minecraft:pink_terracotta", "minecraft:gray_terracotta", "minecraft:light_gray_terracotta", "minecraft:cyan_terracotta", "minecraft:purple_terracotta", "minecraft:blue_terracotta", "minecraft:brown_terracotta", "minecraft:green_terracotta", "minecraft:red_terracotta", "minecraft:black_terracotta", "minecraft:snow_block", "minecraft:powder_snow"],
  "minecraft:beneath_tree_podzol_replaceable": ["minecraft:dirt", "minecraft:coarse_dirt", "minecraft:rooted_dirt", "minecraft:mud", "minecraft:muddy_mangrove_roots", "minecraft:moss_block", "minecraft:pale_moss_block", "minecraft:grass_block", "minecraft:podzol", "minecraft:mycelium"],
};

function stripNamespace(name: string): string {
  if (typeof name !== 'string') return '';
  const s = name.startsWith('#') ? name.slice(1) : name;
  return s.startsWith('minecraft:') ? s.slice('minecraft:'.length) : s;
}

/** Fast read-only view of block tags, keyed by bare tag name. */
export class TagSets {
  private readonly map = new Map<string, ReadonlySet<string>>();

  constructor(data?: BlockTagData) {
    const src = data && Object.keys(data).length > 0 ? data : FALLBACK_BLOCK_TAGS;
    for (const [key, blocks] of Object.entries(src)) {
      const set = new Set<string>();
      for (const b of blocks) set.add(stripNamespace(b));
      this.map.set(stripNamespace(key), set);
    }
  }

  set(tagRef: string): ReadonlySet<string> | undefined {
    return this.map.get(stripNamespace(tagRef));
  }

  /** blockName is a bare name (as returned by MinecraftData.blockOf). */
  has(tagRef: string, blockName: string): boolean {
    const s = this.map.get(stripNamespace(tagRef));
    return s ? s.has(stripNamespace(blockName)) : false;
  }

  hasTag(tagRef: string): boolean { return this.map.has(stripNamespace(tagRef)); }
}
