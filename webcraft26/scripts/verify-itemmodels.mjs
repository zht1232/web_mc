#!/usr/bin/env node
/**
 * verify-itemmodels.mjs — assertions for public/mc/itemmodels.json.
 *
 * Run: node scripts/verify-itemmodels.mjs
 * Exit code 0 = every check passed, 1 = at least one failure (all are listed).
 *
 * Checks
 *   1. exactly 1,537 entries, all keys unique and matching items.json
 *   2. minecraft:stone is a block pointing at minecraft:block/stone
 *   3. minecraft:diamond_sword is flat, one layer item/diamond_sword, present
 *      in tex/item.json
 *   4. minecraft:chest is special
 *   5. minecraft:air is none
 *   6. every flat layer resolves to a name in tex/item.json or tex/block.json
 *   7. every block model index is a valid index into models.json (< 6816)
 *   8. kind counts add up to the item count and match itemmodels_meta.json
 */

import { readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(HERE, '..');
const MC = path.join(ROOT, 'public', 'mc');

const readJson = (p) => JSON.parse(readFileSync(p, 'utf8'));

const EXPECTED_ITEMS = 1537;
const KNOWN_SPECIALS = new Set([
  'chest',
  'shulker_box',
  'banner',
  'shield',
  'conduit',
  'decorated_pot',
  'trident',
  'head',
  'player_head',
  'copper_golem_statue',
  'bundle/selected_item',
]);
const KINDS = ['block', 'flat', 'special', 'composite', 'none'];

let failures = 0;
const fail = (msg) => {
  failures++;
  console.log('  FAIL ' + msg);
};
const ok = (msg) => console.log('  ok   ' + msg);
const check = (cond, msg) => (cond ? ok(msg) : fail(msg));

// ---------------------------------------------------------------------------

const itemsDoc = (() => {
  try {
    return readJson(path.join(MC, 'items.json'));
  } catch {
    return readJson(path.join(ROOT, 'data', 'items.json'));
  }
})();
const items = itemsDoc.items;
const nameSet = new Set(items.map((i) => i.name));

const doc = readJson(path.join(MC, 'itemmodels.json'));
const meta = readJson(path.join(MC, 'itemmodels_meta.json'));
const models = readJson(path.join(MC, 'models.json'));
const itemTex = readJson(path.join(MC, 'tex', 'item.json'));
const blockTex = readJson(path.join(MC, 'tex', 'block.json'));

const entries = doc.items;
const keys = Object.keys(entries);
const ITEM_TEX = new Set(itemTex.names);
const BLOCK_TEX = new Set(blockTex.names);
const BAKED_COUNT = models.models.length;

console.log(`itemmodels.json: ${keys.length} entries, models.json: ${BAKED_COUNT} baked models`);

// --- 1. entry count / key uniqueness / key coverage -------------------------
console.log('\n[1] entry set');
check(keys.length === EXPECTED_ITEMS, `entry count is ${EXPECTED_ITEMS} (got ${keys.length})`);
check(new Set(keys).size === keys.length, 'all keys unique');
const dupes = keys.length - new Set(keys).size;
if (dupes) fail(`${dupes} duplicate keys`);
check(
  keys.every((k) => k.startsWith('minecraft:') && nameSet.has(k.slice('minecraft:'.length))),
  'every key is minecraft:<items.json name>',
);
const uncovered = [...nameSet].filter((n) => !(('minecraft:' + n) in entries));
check(uncovered.length === 0, `all items covered (${uncovered.length} missing)`);
if (uncovered.length) fail('uncovered: ' + uncovered.slice(0, 10).join(', '));

// --- 2. stone --------------------------------------------------------------
console.log('\n[2] minecraft:stone');
{
  const e = entries['minecraft:stone'];
  check(!!e && e.kind === 'block', 'kind === "block"');
  check(Number.isInteger(e?.model), 'model is an integer');
  check(
    e && models.models[e.model]?.loc === 'minecraft:block/stone',
    `model[${e?.model}] === minecraft:block/stone (got ${models.models[e?.model]?.loc})`,
  );
}

// --- 3. diamond_sword ------------------------------------------------------
console.log('\n[3] minecraft:diamond_sword');
{
  const e = entries['minecraft:diamond_sword'];
  check(e?.kind === 'flat', 'kind === "flat"');
  check(e?.layers?.length === 1, `exactly one layer (got ${e?.layers?.length})`);
  check(e?.layers?.[0]?.texture === 'item/diamond_sword', 'layer0 texture === item/diamond_sword');
  check(ITEM_TEX.has('item/diamond_sword'), 'item/diamond_sword present in tex/item.json');
  check(e?.layers?.[0]?.tint === -1, 'layer0 untinted');
  check(e?.guiLight === 'front', 'guiLight === "front"');
}

// --- 4. chest --------------------------------------------------------------
console.log('\n[4] minecraft:chest');
{
  const e = entries['minecraft:chest'];
  check(e?.kind === 'special', 'kind === "special"');
  check(e?.special === 'chest', `special === "chest" (got ${e?.special})`);
}

// --- 5. air ----------------------------------------------------------------
console.log('\n[5] minecraft:air');
check(entries['minecraft:air']?.kind === 'none', 'kind === "none"');

// --- 6. flat layers resolve ------------------------------------------------
console.log('\n[6] flat layers resolve to a texture array layer');
{
  let layers = 0;
  let untinted = 0;
  const unresolved = [];
  for (const [key, e] of Object.entries(entries)) {
    if (e.kind !== 'flat') continue;
    for (const layer of e.layers || []) {
      layers++;
      const set = layer.array === 'block' ? BLOCK_TEX : ITEM_TEX;
      if (!set.has(layer.texture)) unresolved.push(`${key}:${layer.texture} (${layer.array})`);
      if (typeof layer.tint !== 'number') fail(`${key} layer ${layer.texture} has no numeric tint`);
      if (layer.tint === -1) untinted++;
    }
  }
  check(layers > 0, `checked ${layers} flat layers (${untinted} untinted)`);
  check(unresolved.length === 0, `unresolved flat layers: ${unresolved.length}`);
  if (unresolved.length) fail('unresolved: ' + unresolved.slice(0, 10).join(', '));
}

// --- 7. block model indices ------------------------------------------------
console.log('\n[7] block model indices');
{
  const bad = [];
  let blocks = 0;
  const visit = (key, e) => {
    if (e.kind === 'block') {
      blocks++;
      if (!Number.isInteger(e.model) || e.model < 0 || e.model >= BAKED_COUNT) bad.push(`${key}:${e.model}`);
      if (!['front', 'side'].includes(e.guiLight)) bad.push(`${key}:guiLight=${e.guiLight}`);
      if (!models.models[e.model]) bad.push(`${key}: no models.json entry`);
    }
    for (const part of e.parts || []) visit(key + '{part}', part);
  };
  for (const [key, e] of Object.entries(entries)) visit(key, e);
  check(blocks > 0, `checked ${blocks} block references (incl. composite parts)`);
  check(bad.length === 0, `all indices in [0, ${BAKED_COUNT}) : ${bad.length} bad`);
  if (bad.length) fail('bad: ' + bad.slice(0, 10).join(', '));
}

// --- 8. kind breakdown / meta agreement ------------------------------------
console.log('\n[8] kind breakdown');
{
  const counts = Object.fromEntries(KINDS.map((k) => [k, 0]));
  for (const e of Object.values(entries)) {
    if (!KINDS.includes(e.kind)) fail(`unknown kind "${e.kind}"`);
    else counts[e.kind]++;
  }
  for (const k of KINDS) {
    const line = `${k.padEnd(9)} ${String(counts[k]).padStart(4)}`;
    const metaCount = meta.counts?.[k];
    if (metaCount !== counts[k]) fail(`${line}   (meta says ${metaCount})`);
    else console.log('  ok   ' + line);
  }
  const sum = KINDS.reduce((a, k) => a + counts[k], 0);
  check(sum === EXPECTED_ITEMS, `kinds add up to ${EXPECTED_ITEMS} (got ${sum})`);
}

// --- 9. special renderers --------------------------------------------------
console.log('\n[9] special renderers');
{
  const types = {};
  for (const e of Object.values(entries)) if (e.kind === 'special') types[e.special] = (types[e.special] || 0) + 1;
  const unknown = Object.keys(types).filter((t) => !KNOWN_SPECIALS.has(t));
  check(unknown.length === 0, `all special types known (${Object.keys(types).length} types)`);
  if (unknown.length) fail('unknown specials: ' + unknown.join(', '));
  const total = Object.values(types).reduce((a, b) => a + b, 0);
  console.log('       ' + Object.entries(types).sort((a, b) => b[1] - a[1]).map(([k, v]) => `${k}:${v}`).join('  '));
  check(total === meta.counts?.special, `special count matches meta (${total})`);
}

// --- 10. models table ------------------------------------------------------
console.log('\n[10] models table');
check(Object.keys(doc.models || {}).length > 0, `models table has ${Object.keys(doc.models || {}).length} entries`);

// ---------------------------------------------------------------------------

console.log('');
if (failures) {
  console.log(`FAILED — ${failures} problem(s)`);
  process.exit(1);
}
console.log('OK — all item model checks passed');
