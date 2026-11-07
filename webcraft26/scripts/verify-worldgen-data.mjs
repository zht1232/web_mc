#!/usr/bin/env node
/**
 * verify-worldgen-data.mjs
 *
 * Sanity-checks the JSON packed by build-worldgen-data.mjs. It does not touch
 * `src/`: it only proves the shipped data is self-consistent and complete
 * enough for the runtime to resolve references at load time.
 *
 * Run with `node scripts/verify-worldgen-data.mjs` (exit code 1 on failure).
 */

import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const OUT = path.resolve(HERE, '..', 'public', 'mc');

let failures = 0;

function check(label, condition, detail = '') {
  if (condition) {
    console.log(`  PASS  ${label}${detail ? `  (${detail})` : ''}`);
  } else {
    failures++;
    console.log(`  FAIL  ${label}${detail ? `  (${detail})` : ''}`);
  }
}

function load(name) {
  return JSON.parse(fs.readFileSync(path.join(OUT, name), 'utf8'));
}

const worldgen = load('worldgen.json');
const tags = load('tags.json');
const recipes = load('recipes.json');
const loot = load('loot.json');

// ---------------------------------------------------------------------------
// 1. density function / noise references
// ---------------------------------------------------------------------------

const densityFunctions = worldgen.densityFunctions ?? {};
const noises = worldgen.noises ?? {};
const densityKeys = new Set(Object.keys(densityFunctions));
const noiseKeys = new Set(Object.keys(noises));

const missingDensity = new Map();
const missingNoise = new Map();
let densityRefs = 0;
let noiseRefs = 0;

const isNoiseNode = (node) => node.type === 'minecraft:noise' || node.type === 'minecraft:shifted_noise';

/**
 * `minecraft:shift_a`/`shift_b` take a *noise* id in `argument`, while
 * `minecraft:noise`/`shifted_noise` take one in `noise`. Everything else that is
 * a bare string is a density function reference.
 */
const noiseRefKey = (node, key) => {
  if (isNoiseNode(node) && key === 'noise') return true;
  return (node.type === 'minecraft:shift_a' || node.type === 'minecraft:shift_b') && key === 'argument';
};

/**
 * Walks a density-function tree. Bare strings are references; noise-typed
 * fields resolve against `noises`, everything else against `densityFunctions`.
 */
function walkDensity(node, kind = 'density') {
  if (typeof node === 'string') {
    if (kind === 'noise') {
      noiseRefs++;
      if (!noiseKeys.has(node)) missingNoise.set(node, (missingNoise.get(node) ?? 0) + 1);
    } else {
      densityRefs++;
      if (!densityKeys.has(node)) missingDensity.set(node, (missingDensity.get(node) ?? 0) + 1);
    }
    return;
  }
  if (Array.isArray(node)) {
    for (const child of node) walkDensity(child, kind);
    return;
  }
  if (!node || typeof node !== 'object') return;

  for (const [key, value] of Object.entries(node)) {
    if (key === 'type') continue; // codec type id, not a reference
    walkDensity(value, noiseRefKey(node, key) ? 'noise' : kind);
  }
}

console.log('\nworldgen: reference resolution');

const routers = Object.entries(worldgen.noiseSettings ?? {})
  .map(([name, settings]) => [name, settings.noise_router]);

check('overworld noise_router exists', Boolean(worldgen.noiseSettings?.overworld?.noise_router));
check('overworld noise_router has final_density', Boolean(worldgen.noiseSettings?.overworld?.noise_router?.final_density));

for (const [name, router] of routers) {
  if (router) walkDensity(router);
}
// every density function body must resolve too, so nothing dangles at runtime
for (const body of Object.values(densityFunctions)) walkDensity(body);

const unresolved = missingDensity.size + missingNoise.size;
check('every density function reference resolves', missingDensity.size === 0, `unresolved: ${missingDensity.size}`);
check('every noise reference resolves', missingNoise.size === 0, `unresolved: ${missingNoise.size}`);
check('unresolved references total is 0', unresolved === 0, `${unresolved} of ${densityRefs + noiseRefs}`);

if (missingDensity.size) console.log('    missing density functions:', [...missingDensity.keys()].join(', '));
if (missingNoise.size) console.log('    missing noises:', [...missingNoise.keys()].join(', '));

console.log(`  info  density function references walked: ${densityRefs}`);
console.log(`  info  noise references walked: ${noiseRefs}`);
console.log(`  info  noise routers checked: ${routers.filter(([, router]) => router).length}`);

// ---------------------------------------------------------------------------
// 2. biomes and their ids
// ---------------------------------------------------------------------------

console.log('\nworldgen: biomes');

const biomeEntries = Object.entries(worldgen.biomes ?? {});
const ids = biomeEntries.map(([, biome]) => biome.id);
const idsAreIntegers = ids.every((id) => Number.isInteger(id));
const idsUnique = new Set(ids).size === ids.length;
const idsInRange = ids.every((id) => id >= 0 && id < biomeEntries.length);

check('biome count is 66', biomeEntries.length === 66, `got ${biomeEntries.length}`);
check('every biome id is an integer', idsAreIntegers);
check('every biome id is unique', idsUnique, `${new Set(ids).size} unique`);
check('every biome id is within 0..65', idsInRange);

// ids must be a permutation of 0..65 (dense, so a Uint8 store works)
const dense = [...ids].sort((a, b) => a - b).every((id, index) => id === index);
check('biome ids form a dense 0..65 permutation', dense);

const order = worldgen.biomeOrder ?? [];
check('biomeOrder has 66 entries', order.length === 66, `got ${order.length}`);
check('biomeOrder index matches biome id', order.every((id, index) => worldgen.biomes[id]?.id === index));

const points = worldgen.biomeParameterPoints?.points ?? [];
const badPoint = points.find((row) => !Number.isInteger(row[0]) || row[0] < 0 || row[0] >= order.length);
check('every biome parameter point maps to a biome', points.length > 0 && !badPoint, `${points.length} points`);
check('biome parameters are the overworld preset', worldgen.biomeParameters?.preset === 'minecraft:overworld');

// ---------------------------------------------------------------------------
// 3. tags
// ---------------------------------------------------------------------------

console.log('\ntags');

const pickaxe = tags.block?.['minecraft:mineable/pickaxe'] ?? [];
check('mineable/pickaxe contains minecraft:stone', pickaxe.includes('minecraft:stone'));
check('mineable/pickaxe contains minecraft:deepslate', pickaxe.includes('minecraft:deepslate'));

const dangling = [];
for (const category of Object.keys(tags)) {
  for (const [tagId, values] of Object.entries(tags[category])) {
    if (values.some((value) => value.startsWith('#'))) dangling.push(tagId);
  }
}
check('no tag still references another tag', dangling.length === 0, `tags flattening left ${dangling.length}`);
check('tags declare all five requested categories',
  ['block', 'item', 'fluid', 'entity_type', 'game_event'].every((category) => tags[category]));

// ---------------------------------------------------------------------------
// 4. recipes
// ---------------------------------------------------------------------------

console.log('\nrecipes');

const planks = recipes['minecraft:oak_planks'];
check('minecraft:oak_planks recipe exists', Boolean(planks));
check('oak_planks has one ingredient', planks?.ingredients?.length === 1, `got ${planks?.ingredients?.length}`);
check('oak_planks yields 4', planks?.result?.count === 4, `got ${planks?.result?.count}`);
check('oak_planks resolves the oak_logs tag', Array.isArray(planks?.ingredients?.[0]?.options)
  && planks.ingredients[0].options.includes('minecraft:oak_log'), `${planks?.ingredients?.[0]?.options?.length ?? 0} options`);

const recipeCount = Object.keys(recipes).length;
check('recipe table is populated', recipeCount > 1500, `${recipeCount} recipes`);

// ---------------------------------------------------------------------------
// 5. loot
// ---------------------------------------------------------------------------

console.log('\nloot');

const stone = loot['minecraft:stone'];
check('minecraft:stone loot table exists', Boolean(stone));
check('stone drops cobblestone first', stone?.drops?.[0]?.item === 'minecraft:cobblestone', stone?.drops?.[0]?.item);
check('stone requires a tool', stone?.drops?.[0]?.requiresTool === true);
check('stone has a silk-touch alternative', stone?.drops?.some((drop) => drop.silkTouch && drop.item === 'minecraft:stone'));
check('every loot table keeps raw json for fallback',
  Object.keys(loot).length > 1000 && Object.values(loot).every((table) => table.raw));

const flattened = Object.values(loot).filter((table) => !table.fallback && table.drops.length).length;
const fellBack = Object.values(loot).filter((table) => table.fallback).length;
console.log(`  info  loot tables: ${Object.keys(loot).length}, flattened: ${flattened}, fell back: ${fellBack}`);

// ---------------------------------------------------------------------------

console.log(`\n${failures === 0 ? 'OK' : 'FAILED'} - ${failures} failed check(s)\n`);
process.exit(failures === 0 ? 0 : 1);
