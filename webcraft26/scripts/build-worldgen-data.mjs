#!/usr/bin/env node
/**
 * build-worldgen-data.mjs
 *
 * Packs the vanilla 26.2 game data that the browser client needs into
 * `public/mc`:
 *
 *   worldgen.json  noise settings, density functions, noises, biomes,
 *                  biome parameters, configured/placed features, structures
 *   tags.json      block/item/fluid/entity_type/game_event tags, flattened
 *   recipes.json   every crafting/cooking/stonecutting/smithing recipe
 *   loot.json      flat block drops (+ raw fallback)
 *   lang/en_us.json
 *
 * No resolver, no runtime: references stay as `minecraft:foo` strings that the
 * runtime looks up in the same set of maps. Run with `node scripts/build-worldgen-data.mjs`.
 * Output is deterministic (stable key order, sorted file walks) and idempotent.
 */

import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  buildOverworldParameters,
  toRow,
  ROW_LAYOUT,
} from './lib/overworld-biome-parameters.mjs';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const PROJECT = path.resolve(HERE, '..');

const VANILLA = path.resolve(
  process.env.MC_VANILLA_DIR ??
    path.join(PROJECT, '..', '_src', 'thirdparty', 'thirdparty', 'src-vanilla'),
);
const DATA = path.join(VANILLA, 'data', 'minecraft');
const ASSETS = path.join(VANILLA, 'assets', 'minecraft');
const OUT = path.join(PROJECT, 'public', 'mc');

const NAMESPACE = 'minecraft';
const TAG_CATEGORIES = ['block', 'item', 'fluid', 'entity_type', 'game_event'];

// ---------------------------------------------------------------------------
// small fs helpers
// ---------------------------------------------------------------------------

/** Recursively list `*.json` files below `dir`, as sorted POSIX-ish relative paths. */
function listJsonFiles(dir) {
  if (!fs.existsSync(dir)) return [];
  const out = [];
  const walk = (current, prefix) => {
    for (const entry of fs.readdirSync(current, { withFileTypes: true })) {
      const rel = prefix ? `${prefix}/${entry.name}` : entry.name;
      if (entry.isDirectory()) walk(path.join(current, entry.name), rel);
      else if (entry.name.endsWith('.json')) out.push(rel);
    }
  };
  walk(dir, '');
  return out.sort();
}

function readJson(absPath) {
  return JSON.parse(fs.readFileSync(absPath, 'utf8'));
}

/** `overworld/caves/spaghetti.json` -> `minecraft:overworld/caves/spaghetti` */
function idOf(relPath) {
  return `${NAMESPACE}:${relPath.replace(/\.json$/, '')}`;
}

/** Normalize a possibly un-namespaced id (`stone` / `#oak_logs`) to `minecraft:...`. */
function nsId(raw) {
  const value = String(raw);
  return value.includes(':') ? value : `${NAMESPACE}:${value}`;
}

function ensureDir(dir) {
  fs.mkdirSync(dir, { recursive: true });
}

/** Writes compact JSON (browser payload) and returns its byte size. */
function writeJson(name, value) {
  const abs = path.join(OUT, name);
  ensureDir(path.dirname(abs));
  const body = JSON.stringify(value);
  fs.writeFileSync(abs, body);
  return Buffer.byteLength(body);
}

function statSize(name) {
  const abs = path.join(OUT, name);
  return fs.existsSync(abs) ? fs.statSync(abs).size : 0;
}

/** Sort object keys so repeated runs produce byte-identical output. */
function sortedByKey(obj) {
  const out = {};
  for (const key of Object.keys(obj).sort()) out[key] = obj[key];
  return out;
}

// ---------------------------------------------------------------------------
// 1. worldgen
// ---------------------------------------------------------------------------

/** Load a directory of registry files keyed by `minecraft:<path>`. */
function loadRegistry(subDir) {
  const registry = {};
  for (const rel of listJsonFiles(path.join(DATA, subDir))) {
    registry[idOf(rel)] = readJson(path.join(DATA, subDir, rel));
  }
  return sortedByKey(registry);
}

function loadNoiseSettings() {
  const settings = {};
  for (const rel of listJsonFiles(path.join(DATA, 'worldgen', 'noise_settings'))) {
    // keyed by bare preset name: overworld / nether / end / amplified / ...
    settings[rel.replace(/\.json$/, '')] = readJson(path.join(DATA, 'worldgen', 'noise_settings', rel));
  }
  return sortedByKey(settings);
}

/**
 * Biome ids: index into the vanilla overworld parameter list order (first
 * appearance), then any biome the overworld never generates (nether, end,
 * the_void) appended alphabetically so every biome has a stable id.
 */
function buildBiomeOrder() {
  const { points, biomeOrder } = buildOverworldParameters();
  const known = new Set(listJsonFiles(path.join(DATA, 'worldgen', 'biome')).map((rel) => idOf(rel)));
  const unknown = biomeOrder.filter((id) => !known.has(id));
  if (unknown.length) throw new Error(`overworld builder emitted unknown biomes: ${unknown.join(', ')}`);

  const order = [...biomeOrder];
  const seen = new Set(order);
  for (const id of [...known].sort()) {
    if (!seen.has(id)) order.push(id);
  }
  return { points, order };
}

/** Keep only the fields the runtime consumes, everything else verbatim. */
function buildBiomes(order) {
  const biomes = {};
  const ids = new Map(order.map((id, index) => [id, index]));

  for (const rel of listJsonFiles(path.join(DATA, 'worldgen', 'biome'))) {
    const id = idOf(rel);
    const raw = readJson(path.join(DATA, 'worldgen', 'biome', rel));
    const idNumber = ids.get(id);
    if (idNumber === undefined) throw new Error(`biome ${id} has no id`);

    biomes[id] = {
      id: idNumber,
      name: id,
      temperature: raw.temperature,
      downfall: raw.downfall,
      hasPrecipitation: raw.has_precipitation,
      effects: raw.effects ?? {},
      carvers: raw.carvers ?? [],
      features: raw.features ?? [],
      spawners: raw.spawners ?? {},
      spawnCosts: raw.spawn_costs ?? {},
      // 26.2 dropped the per-biome field; vanilla default is 0.1.
      creatureSpawnProbability: raw.creature_spawn_probability ?? 0.1,
    };
  }
  return sortedByKey(biomes);
}

function buildWorldgen() {
  const { points, order } = buildBiomeOrder();

  const biomeParametersSource = readJson(
    path.join(DATA, 'worldgen', 'multi_noise_biome_source_parameter_list', 'overworld.json'),
  );
  const pointsById = new Map(order.map((id, index) => [id, index]));

  return {
    noiseSettings: loadNoiseSettings(),
    densityFunctions: loadRegistry('worldgen/density_function'),
    noises: loadRegistry('worldgen/noise'),
    // verbatim: 26.2 only stores a preset pointer here
    biomeParameters: biomeParametersSource,
    // the actual list, generated from OverworldBiomeBuilder (see lib module)
    biomeParameterPoints: {
      source: 'net/minecraft/world/level/biome/OverworldBiomeBuilder.java',
      note: '26.2 ships only preset="minecraft:overworld"; these rows are that preset, transcribed',
      rowLayout: ROW_LAYOUT,
      points: points.map((p) => toRow(p, pointsById.get(p.biome))),
    },
    biomeOrder: order,
    biomes: buildBiomes(order),
    configuredFeatures: loadRegistry('worldgen/configured_feature'),
    placedFeatures: loadRegistry('worldgen/placed_feature'),
    structureSets: loadRegistry('worldgen/structure_set'),
    structures: loadRegistry('worldgen/structure'),
    templatePools: loadRegistry('worldgen/template_pool'),
    processors: loadRegistry('worldgen/processor_list'),
  };
}

// ---------------------------------------------------------------------------
// 2. tags
// ---------------------------------------------------------------------------

/**
 * Reads one tag category and flattens `#tag` references transitively, so each
 * tag ends up with a plain element list. Cycles are tolerated (skipped).
 */
function buildTagCategory(category) {
  const dir = path.join(DATA, 'tags', category);
  const raw = new Map();
  for (const rel of listJsonFiles(dir)) {
    const json = readJson(path.join(dir, rel));
    raw.set(idOf(rel), (json.values ?? []).map((entry) =>
      typeof entry === 'string' ? entry : entry.id, // older packs use {id, required}
    ));
  }

  const flatCache = new Map();
  const flatten = (tagId, stack) => {
    if (flatCache.has(tagId)) return flatCache.get(tagId);
    if (stack.has(tagId)) return []; // cycle guard
    const entries = raw.get(tagId);
    if (!entries) return []; // reference to a tag that lives in another category

    stack.add(tagId);
    const result = [];
    const seen = new Set();
    const push = (value) => {
      if (!seen.has(value)) {
        seen.add(value);
        result.push(value);
      }
    };
    for (const entry of entries) {
      if (entry.startsWith('#')) for (const child of flatten(nsId(entry.slice(1)), stack)) push(child);
      else push(nsId(entry));
    }
    stack.delete(tagId);
    flatCache.set(tagId, result);
    return result;
  };

  const flat = {};
  for (const tagId of [...raw.keys()].sort()) flat[tagId] = flatten(tagId, new Set());

  let referenced = 0;
  for (const entries of raw.values()) for (const entry of entries) if (entry.startsWith('#')) referenced++;
  return { tags: flat, count: raw.size, references: referenced };
}

function buildTags() {
  const out = {};
  let flattened = 0;
  let references = 0;
  const perCategory = {};
  for (const category of TAG_CATEGORIES) {
    const { tags, count, references: refs } = buildTagCategory(category);
    out[category] = tags;
    perCategory[category] = count;
    flattened += count;
    references += refs;
  }
  return { tags: out, flattened, references, perCategory };
}

// ---------------------------------------------------------------------------
// 3. recipes
// ---------------------------------------------------------------------------

const COOKING_TYPES = new Set([
  'minecraft:smelting',
  'minecraft:blasting',
  'minecraft:smoking',
  'minecraft:campfire_cooking',
]);

/**
 * Normalizes an ingredient to `{ options: [itemId...], count?, raw }`.
 * Accepts the 26.2 string forms (`"minecraft:stone"`, `"#minecraft:logs"`)
 * and the legacy object forms (`{"item": ...}`, `{"tag": ...}`, `{"items": [...]}`).
 */
function makeIngredientNormalizer(itemTags) {
  return function normalizeIngredient(raw) {
    const options = [];
    const seen = new Set();
    const pushIds = (ids) => {
      for (const id of ids) {
        if (!seen.has(id)) {
          seen.add(id);
          options.push(id);
        }
      }
    };

    const fromRaw = (value) => {
      if (value == null) return;
      if (typeof value === 'string') {
        if (value.startsWith('#')) pushIds(itemTags[nsId(value.slice(1))] ?? []);
        else pushIds([nsId(value)]);
        return;
      }
      if (Array.isArray(value)) {
        for (const entry of value) fromRaw(entry);
        return;
      }
      if (typeof value === 'object') {
        if (value.item) pushIds([nsId(value.item)]);
        else if (value.tag) pushIds(itemTags[nsId(value.tag)] ?? []);
        else if (value.items) fromRaw(value.items);
        else if (value.id) pushIds([nsId(value.id)]);
      }
    };
    fromRaw(raw);

    const ingredient = { options };
    if (typeof raw === 'object' && raw !== null && !Array.isArray(raw) && raw.count > 1) {
      ingredient.count = raw.count;
    }
    ingredient.raw = raw;
    return ingredient;
  };
}

/** 26.2 item stacks are `{id, count}`; older data uses `{item, count}`. */
function normalizeResult(raw) {
  if (typeof raw === 'string') return { item: nsId(raw), count: 1 };
  if (!raw || typeof raw !== 'object') return { item: null, count: 1 };
  const result = {
    item: nsId(raw.id ?? raw.item ?? raw.name ?? 'minecraft:air'),
    count: raw.count ?? 1,
  };
  if (raw.components) result.components = raw.components; // keep enchanted book etc. usable
  return result;
}

function normalizeRecipe(json, normIngredient) {
  const type = json.type;
  const base = { type };
  if (json.category) base.category = json.category;
  if (json.group) base.group = json.group;

  if (type === 'minecraft:crafting_shaped') {
    const key = {};
    for (const [symbol, value] of Object.entries(json.key ?? {})) key[symbol] = normIngredient(value);
    // unique ingredients in first-use order, for runtimes that ignore the grid
    const used = new Set();
    for (const row of json.pattern ?? []) for (const symbol of row) if (symbol !== ' ') used.add(symbol);
    const ingredients = [...used].filter((s) => key[s]).map((s) => key[s]);
    return { ...base, pattern: json.pattern ?? [], key, ingredients, result: normalizeResult(json.result) };
  }

  if (type === 'minecraft:crafting_shapeless') {
    return {
      ...base,
      ingredients: (json.ingredients ?? []).map(normIngredient),
      result: normalizeResult(json.result),
    };
  }

  if (COOKING_TYPES.has(type)) {
    return {
      ...base,
      ingredient: normIngredient(json.ingredient),
      result: normalizeResult(json.result),
      experience: json.experience ?? 0,
      cookingTime: json.cooking_time ?? 200,
    };
  }

  if (type === 'minecraft:stonecutting') {
    return {
      ...base,
      ingredient: normIngredient(json.ingredient),
      result: normalizeResult(json.result),
    };
  }

  if (type === 'minecraft:smithing_transform') {
    return {
      ...base,
      template: json.template ? normIngredient(json.template) : null,
      base: normIngredient(json.base),
      addition: normIngredient(json.addition),
      result: normalizeResult(json.result),
    };
  }

  if (type === 'minecraft:smithing_trim') {
    return {
      ...base,
      template: json.template ? normIngredient(json.template) : null,
      base: normIngredient(json.base),
      addition: normIngredient(json.addition),
      pattern: json.pattern ?? null,
    };
  }

  // hand-written special recipes (banner duplicate, firework, dye, ...)
  return { type, raw: json };
}

function buildRecipes(itemTags) {
  const normalize = makeIngredientNormalizer(itemTags);
  const recipes = {};
  const byType = {};
  let fallbacks = 0;

  for (const rel of listJsonFiles(path.join(DATA, 'recipe'))) {
    const json = readJson(path.join(DATA, 'recipe', rel));
    const id = idOf(rel);
    recipes[id] = normalizeRecipe(json, normalize);
    byType[json.type] = (byType[json.type] ?? 0) + 1;
    if (recipes[id].raw) fallbacks++;
  }

  return { recipes: sortedByKey(recipes), byType, fallbacks };
}

// ---------------------------------------------------------------------------
// 4. loot tables
// ---------------------------------------------------------------------------

/** Does this condition list ask for silk touch? */
function asksSilkTouch(conditions = []) {
  return conditions.some((condition) => {
    if (condition.condition !== 'minecraft:match_tool') return false;
    const enchantments = condition.predicate?.predicates?.['minecraft:enchantments'];
    return Array.isArray(enchantments)
      && enchantments.some((entry) => entry.enchantments === 'minecraft:silk_touch');
  });
}

function isFortuneBonus(functionJson) {
  return functionJson.enchantment === 'minecraft:fortune';
}

/** Reads the `set_count` function payload: number, or `{min,max}` uniforms. */
function readCount(functionJson) {
  const count = functionJson.count ?? 1;
  if (typeof count === 'number') return { min: count, max: count };
  if (count?.type === 'minecraft:uniform') return { min: count.min ?? 1, max: count.max ?? 1 };
  if (count?.type === 'minecraft:binomial') return { min: 0, max: count.n ?? 1 };
  return { min: 1, max: 1 };
}

/** Conditions that need live world state (block properties, position, entity). */
const STATEFUL_CONDITIONS = [
  'minecraft:block_state_property',
  'minecraft:any_of',
  'minecraft:inverted',
  'minecraft:location_check',
  'minecraft:entity_properties',
];

const hasStatefulCondition = (conditions) =>
  (conditions ?? []).some((condition) => STATEFUL_CONDITIONS.includes(condition.condition));

/**
 * Turns a vanilla block loot table into a flat drop list.
 * Returns `{ drops, fallback }`; `fallback` is a reason string when the table
 * is too stateful/complex to flatten and the runtime must use `raw`.
 */
function flattenLootTable(json, itemTags) {
  const pools = json.pools ?? [];
  if (pools.length === 0) return { drops: [], fallback: null }; // e.g. air
  if (pools.length > 1) return { drops: [], fallback: 'multiple_pools' };
  if (pools[0].rolls !== undefined && pools[0].rolls !== 1) return { drops: [], fallback: 'rolls' };
  if (hasStatefulCondition(pools[0].conditions)) return { drops: [], fallback: 'pool_conditions' };

  // a silk-touch-only pool (e.g. ice) makes every drop in it a silk drop
  const poolSilk = asksSilkTouch(pools[0].conditions);

  const drops = [];
  let fallback = null;

  const walk = (entry, silkTouch) => {
    if (!entry || fallback) return;

    if (hasStatefulCondition(entry.conditions)) {
      fallback = 'block_state_property';
      return;
    }
    const entrySilk = silkTouch || asksSilkTouch(entry.conditions);

    switch (entry.type) {
      case 'minecraft:alternatives':
        for (const child of entry.children ?? []) walk(child, entrySilk);
        return;

      case 'minecraft:group':
      case 'minecraft:sequence':
        for (const child of entry.entries ?? []) walk(child, entrySilk);
        return;

      case 'minecraft:tag': {
        // one random element of the tag; approximate with equal shares
        const tagItems = itemTags[nsId(entry.name)] ?? [];
        const share = tagItems.length ? 1 / tagItems.length : 1;
        for (const item of tagItems) {
          drops.push({ item, min: 1, max: 1, chance: share, requiresTool: false, silkTouch: entrySilk, affectedByFortune: false, fromTag: entry.name });
        }
        return;
      }

      case 'minecraft:item':
        break;

      default:
        fallback = `entry:${entry.type ?? 'unknown'}`;
        return;
    }

    let min = 1;
    let max = 1;
    let affectedByFortune = false;
    let chance = 1;

    for (const fn of entry.functions ?? []) {
      // e.g. slabs: set_count only applies when type=double -> state dependent
      if (hasStatefulCondition(fn.conditions)) {
        fallback = 'function_conditions';
        return;
      }
      switch (fn.function) {
        case 'minecraft:set_count': {
          const range = readCount(fn);
          min = range.min;
          max = range.max;
          break;
        }
        case 'minecraft:limit_count':
          if (fn.limit?.max !== undefined) max = Math.min(max, fn.limit.max);
          break;
        case 'minecraft:apply_bonus':
          if (isFortuneBonus(fn)) affectedByFortune = true;
          break;
        case 'minecraft:copy_components':
        case 'minecraft:copy_state':
        case 'minecraft:explosion_decay':
        case 'minecraft:set_name':
        case 'minecraft:set_components':
          break; // cosmetic / data only, the item id is unchanged
        default:
          break;
      }
    }

    for (const condition of entry.conditions ?? []) {
      if (condition.condition === 'minecraft:random_chance') chance *= condition.chance ?? 1;
      if (condition.condition === 'minecraft:table_bonus' && condition.enchantment === 'minecraft:fortune') {
        chance *= condition.chances?.[0] ?? 1;
        affectedByFortune = true;
      }
    }

    drops.push({
      item: nsId(entry.name),
      min,
      max,
      chance,
      requiresTool: false,
      silkTouch: entrySilk,
      affectedByFortune,
    });
  };

  for (const entry of pools[0].entries ?? []) walk(entry, poolSilk);
  if (fallback) return { drops: [], fallback };

  // Vanilla emits the "normal" alternative first in the JSON; put silk-touch
  // variants last so drops[0] is the ordinary drop.
  drops.sort((a, b) => Number(a.silkTouch) - Number(b.silkTouch));
  return { drops, fallback: null };
}

/** Blocks in `#minecraft:needs_*_tool` require the right tool to drop anything. */
function buildRequiresToolSet(blockTags) {
  const set = new Set();
  for (const [tagId, values] of Object.entries(blockTags)) {
    if (/^minecraft:needs_[a-z]+_tool$/.test(tagId)) for (const value of values) set.add(value);
  }
  return set;
}

/**
 * "Requires the correct tool" is a code property, not an id list:
 * `BlockBehaviour.Properties.of().requiresCorrectToolForDrops()`. The tags only
 * encode *tier* gating (`needs_stone_tool`, ...), so on their own they would
 * report `requiresTool:false` for e.g. stone. We therefore read `Blocks.java`
 * (shipped with the client sources) and resolve the copy helpers too
 * (`ofLegacyCopy`, `ofFullCopy`, `wallVariant`, `registerLegacyStair`).
 */
function readToolRequiredBlocks() {
  const file = path.join(VANILLA, 'net', 'minecraft', 'world', 'level', 'block', 'Blocks.java');
  if (!fs.existsSync(file)) return new Set();

  const src = fs.readFileSync(file, 'utf8');
  const statements = new Map(); // block name (lowercase) -> source slice
  const explicitBase = new Map(); // name -> base block name, for registerLegacyStair

  const registerRe = /=\s*register\(\s*Block(?:Item)?Ids\.([A-Z0-9_]+)\s*,/g;
  for (let match = registerRe.exec(src); match; match = registerRe.exec(src)) {
    const open = src.indexOf('(', match.index);
    let depth = 0;
    let end = open;
    for (; end < src.length; end++) {
      if (src[end] === '(') depth++;
      else if (src[end] === ')' && --depth === 0) break;
    }
    statements.set(match[1].toLowerCase(), src.slice(match.index, end));
  }

  const stairRe = /=\s*registerLegacyStair\(\s*BlockItemIds\.([A-Z0-9_]+)\s*,\s*([A-Z0-9_]+)\s*\)/g;
  for (let match = stairRe.exec(src); match; match = stairRe.exec(src)) {
    explicitBase.set(match[1].toLowerCase(), match[2].toLowerCase());
  }

  const INHERIT = /(?:ofLegacyCopy|ofFullCopy|wallVariant)\(\s*([A-Z][A-Z0-9_]*)/;
  const memo = new Map();
  const requiresTool = (name, depth = 0) => {
    if (memo.has(name)) return memo.get(name);
    if (depth > 8) return false;

    const base = explicitBase.get(name);
    const statement = statements.get(name);
    let flag = false;
    if (base) flag = requiresTool(base, depth + 1);
    else if (statement) {
      flag = statement.includes('requiresCorrectToolForDrops');
      const inherit = INHERIT.exec(statement);
      if (!flag && inherit) flag = requiresTool(inherit[1].toLowerCase(), depth + 1);
    }
    memo.set(name, flag);
    return flag;
  };

  const set = new Set();
  for (const name of new Set([...statements.keys(), ...explicitBase.keys()])) {
    if (requiresTool(name)) set.add(`minecraft:${name}`);
  }
  return set;
}

function buildLoot(blockTags, itemTags) {
  const codeRequiresTool = readToolRequiredBlocks();
  const requiresTool = buildRequiresToolSet(blockTags);
  for (const id of codeRequiresTool) requiresTool.add(id);

  const loot = {};
  const reasons = {};
  let fallbacks = 0;

  for (const rel of listJsonFiles(path.join(DATA, 'loot_table', 'blocks'))) {
    const json = readJson(path.join(DATA, 'loot_table', 'blocks', rel));
    const blockId = idOf(rel);
    const { drops, fallback } = flattenLootTable(json, itemTags);
    if (fallback) {
      fallbacks++;
      reasons[fallback] = (reasons[fallback] ?? 0) + 1;
    } else if (requiresTool.has(blockId)) {
      for (const drop of drops) drop.requiresTool = !drop.silkTouch;
    }
    loot[blockId] = fallback ? { drops: [], fallback, raw: json } : { drops, raw: json };
  }

  return { loot: sortedByKey(loot), fallbacks, reasons, toolRequired: requiresTool.size, fromCode: codeRequiresTool.size };
}

// ---------------------------------------------------------------------------
// 5. lang
// ---------------------------------------------------------------------------

function copyLang() {
  const candidates = [
    path.join(DATA, '..', '..', 'assets', 'minecraft', 'lang', 'en_us.json'),
    path.join(ASSETS, 'lang', 'en_us.json'),
  ];
  const source = candidates.find((candidate) => fs.existsSync(candidate));
  if (!source) return { copied: false, bytes: 0 };

  const target = path.join(OUT, 'lang', 'en_us.json');
  ensureDir(path.dirname(target));
  fs.copyFileSync(source, target);
  return { copied: true, bytes: fs.statSync(target).size, source };
}

// ---------------------------------------------------------------------------
// summary
// ---------------------------------------------------------------------------

function formatBytes(bytes) {
  if (bytes > 1024 * 1024) return `${(bytes / (1024 * 1024)).toFixed(2)} MB`;
  if (bytes > 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${bytes} B`;
}

function printSummary(rows, sections) {
  const labelWidth = Math.max(...rows.map((r) => r[0].length));
  console.log(`\n${'file'.padEnd(labelWidth)}  ${'size'.padStart(10)}`);
  console.log(`${'-'.repeat(labelWidth)}  ${'-'.repeat(10)}`);
  for (const [label, bytes] of rows) {
    console.log(`${label.padEnd(labelWidth)}  ${formatBytes(bytes).padStart(10)}`);
  }
  for (const [title, lines] of sections) {
    const width = Math.max(28, ...lines.map(([label]) => label.length + 2));
    console.log(`\n${title}`);
    for (const [label, value] of lines) console.log(`  ${label.padEnd(width)} ${String(value).padStart(7)}`);
  }
}

// ---------------------------------------------------------------------------
// main
// ---------------------------------------------------------------------------

function main() {
  if (!fs.existsSync(DATA)) {
    console.error(`[build-worldgen-data] vanilla data not found: ${DATA}`);
    process.exit(1);
  }
  ensureDir(OUT);

  const worldgen = buildWorldgen();
  const tags = buildTags();
  const recipes = buildRecipes(tags.tags.item ?? {});
  const loot = buildLoot(tags.tags.block ?? {}, tags.tags.item ?? {});
  const lang = copyLang();

  const sizes = [
    ['public/mc/worldgen.json', writeJson('worldgen.json', worldgen)],
    ['public/mc/tags.json', writeJson('tags.json', tags.tags)],
    ['public/mc/recipes.json', writeJson('recipes.json', recipes.recipes)],
    ['public/mc/loot.json', writeJson('loot.json', loot.loot)],
    ['public/mc/lang/en_us.json', lang.copied ? statSize('lang/en_us.json') : 0],
  ];

  const recipeTypes = Object.entries(recipes.byType).sort((a, b) => b[1] - a[1]);
  const totalRecipes = recipeTypes.reduce((sum, [, count]) => sum + count, 0);

  const lootTables = Object.keys(loot.loot).length;
  const emptyTables = Object.values(loot.loot).filter((table) => !table.fallback && table.drops.length === 0).length;

  printSummary(sizes, [
    ['worldgen', [
      ['noise settings', Object.keys(worldgen.noiseSettings).length],
      ['density functions', Object.keys(worldgen.densityFunctions).length],
      ['noises', Object.keys(worldgen.noises).length],
      ['biomes', Object.keys(worldgen.biomes).length],
      ['biome parameter points', worldgen.biomeParameterPoints.points.length],
      ['configured features', Object.keys(worldgen.configuredFeatures).length],
      ['placed features', Object.keys(worldgen.placedFeatures).length],
      ['structure sets', Object.keys(worldgen.structureSets).length],
      ['structures', Object.keys(worldgen.structures).length],
      ['template pools', Object.keys(worldgen.templatePools).length],
      ['processor lists', Object.keys(worldgen.processors).length],
    ]],
    ['tags', [
      ...Object.entries(tags.perCategory),
      ['tags flattened', tags.flattened],
      ['tag references resolved', tags.references],
    ]],
    ['recipes', [
      ['total', totalRecipes],
      ...recipeTypes,
      ['unknown types kept as raw', recipes.fallbacks],
    ]],
    ['loot', [
      ['block tables', lootTables],
      ['flattened to drops', lootTables - loot.fallbacks - emptyTables],
      ['empty (no drops, e.g. air)', emptyTables],
      ['fell back to raw', loot.fallbacks],
      ['blocks requiring a tool', loot.toolRequired],
      ...Object.entries(loot.reasons),
    ]],
    ['audio', [
      ['sounds.json', 'unavailable (26.2 ships none)'],
      ['lang copied', lang.copied ? 'yes' : 'NO'],
    ]],
  ]);

  console.log('\nDone. Output in public/mc');
}

main();
