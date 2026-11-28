// Imports the 26.2 villager trade tables (trade_set -> villager_trade tag -> trade JSON).
//
//   MC_DATA=/path/to/client/data/minecraft node scripts/build-villager-trades.mjs
//
// Writes data/villager_trades.json (professions) and data/wandering_trader_trades.json
// (the buying/uncommon/common TradeSets used by WanderingTrader.updateTrades).
// Trades that need server-side map generation or loot functions this runtime does
// not evaluate are skipped and counted in the output; random enchantment offers
// keep an `enchantRandomly` flag for the runtime to roll.
import fs from 'node:fs';
import path from 'node:path';

const DATA = process.env.MC_DATA;
if (!DATA) {
  console.error('Set MC_DATA to the data/minecraft directory extracted from your own Minecraft client.jar.');
  process.exit(1);
}
const OUT = path.resolve(import.meta.dirname, '..', 'data');
const strip = (id) => String(id).replace(/^minecraft:/, '');
const readJson = (file) => JSON.parse(fs.readFileSync(file, 'utf8'));

/** Resolves `#minecraft:farmer/level_1` through data/minecraft/tags/villager_trade. */
function resolveTradeTag(id, seen = new Set()) {
  if (!id.startsWith('#')) return [id];
  const tagId = strip(id.slice(1));
  if (seen.has(tagId)) return [];
  seen.add(tagId);
  const file = path.join(DATA, 'tags', 'villager_trade', `${tagId}.json`);
  if (!fs.existsSync(file)) {
    console.warn(`missing trade tag ${tagId}`);
    return [];
  }
  const values = readJson(file).values ?? [];
  return values.flatMap((v) => resolveTradeTag(typeof v === 'string' ? v : v.id, seen));
}

function costOf(raw) {
  if (!raw || typeof raw !== 'object' || !raw.id) return null;
  return { id: strip(raw.id), count: raw.count ?? 1 };
}

function resultOf(raw) {
  if (!raw || typeof raw !== 'object' || !raw.id) return null;
  const out = { id: strip(raw.id), count: raw.count ?? 1 };
  const potion = raw.components?.['minecraft:potion_contents']?.potion;
  if (potion) out.potion = strip(potion);
  return out;
}

const PROFESSIONS = [
  'armorer', 'butcher', 'cartographer', 'cleric', 'farmer', 'fisherman', 'fletcher',
  'leatherworker', 'librarian', 'mason', 'shepherd', 'toolsmith', 'weaponsmith',
];

const out = {};
let total = 0;
let skipped = 0;
for (const profession of PROFESSIONS) {
  const levels = [];
  for (let level = 1; level <= 5; level++) {
    const setFile = path.join(DATA, 'trade_set', profession, `level_${level}.json`);
    if (!fs.existsSync(setFile)) continue;
    const set = readJson(setFile);
    const trades = [];
    for (const id of resolveTradeTag(set.trades)) {
      const rel = strip(id);
      const file = path.join(DATA, 'villager_trade', `${rel}.json`);
      if (!fs.existsSync(file)) {
        console.warn(`missing trade ${rel}`);
        continue;
      }
      const raw = readJson(file);
      // Map offers need structure lookup + filled-map generation; predicates are
      // per-variant map offers. Both are outside this batch.
      if (raw.merchant_predicate || !raw.wants || !raw.gives) { skipped++; continue; }
      let enchantRandomly = false;
      let randomPotion = false;
      for (const mod of raw.given_item_modifiers ?? []) {
        if (mod.function === 'minecraft:enchant_randomly') enchantRandomly = true;
        else if (mod.function === 'minecraft:set_random_potion') randomPotion = true;
        else if (mod.function === 'minecraft:set_name') { /* cosmetic name only */ }
        else { enchantRandomly = false; break; }
      }
      const wants = costOf(raw.wants);
      const gives = resultOf(raw.gives);
      if (!wants || !gives) { skipped++; continue; }
      const additional = costOf(raw.additional_wants);
      const trade = {
        wants,
        gives,
        maxUses: Math.trunc(raw.max_uses ?? 4),
        xp: Math.trunc(raw.xp ?? 1),
        priceMultiplier: raw.reputation_discount ?? 0,
      };
      if (additional) trade.additional = additional;
      if (raw.double_trade_price_enchantments) trade.doubleTradePrice = true;
      if (enchantRandomly) trade.enchantRandomly = true;
      if (randomPotion) trade.randomPotion = true;
      trades.push(trade);
      total++;
    }
    levels.push({ amount: Math.trunc(set.amount ?? 2), trades });
  }
  out[profession] = { levels };
}

fs.mkdirSync(OUT, { recursive: true });
fs.writeFileSync(path.join(OUT, 'villager_trades.json'), JSON.stringify(out), 'utf8');
for (const [profession, data] of Object.entries(out)) {
  console.log(profession, data.levels.map((l) => l.trades.length).join('/'));
}
console.log(`villager trades: ${total}, skipped: ${skipped}`);

// --- WanderingTrader.updateTrades: buying -> uncommon -> common -------------
const wandering = { sets: [] };
let wtTotal = 0;
let wtSkipped = 0;
for (const name of ['buying', 'uncommon', 'common']) {
  const setFile = path.join(DATA, 'trade_set', 'wandering_trader', `${name}.json`);
  if (!fs.existsSync(setFile)) continue;
  const set = readJson(setFile);
  const trades = [];
  for (const id of resolveTradeTag(set.trades)) {
    const rel = strip(id);
    const file = path.join(DATA, 'villager_trade', `${rel}.json`);
    if (!fs.existsSync(file)) continue;
    const raw = readJson(file);
    if (raw.merchant_predicate || !raw.wants || !raw.gives) { wtSkipped++; continue; }
    let enchantRandomly = false;
    let potion = null;
    let unsupported = false;
    for (const mod of raw.given_item_modifiers ?? []) {
      if (mod.function === 'minecraft:enchant_randomly') enchantRandomly = true;
      else if (mod.function === 'minecraft:set_name') { /* cosmetic name only */ }
      else if (mod.function === 'minecraft:set_potion') potion = strip(mod.id);
      else { unsupported = true; break; }
    }
    if (unsupported) { wtSkipped++; continue; }
    const wants = costOf(raw.wants);
    const gives = resultOf(raw.gives);
    if (!wants || !gives) { wtSkipped++; continue; }
    const wantPotion = raw.wants.components?.['minecraft:potion_contents']?.potion;
    if (wantPotion) wants.potion = strip(wantPotion);
    if (potion) gives.potion = potion;
    const trade = {
      wants,
      gives,
      maxUses: Math.trunc(raw.max_uses ?? 4),
      xp: Math.trunc(raw.xp ?? 1),
      priceMultiplier: raw.reputation_discount ?? 0,
    };
    const additional = costOf(raw.additional_wants);
    if (additional) trade.additional = additional;
    if (raw.double_trade_price_enchantments) trade.doubleTradePrice = true;
    if (enchantRandomly) trade.enchantRandomly = true;
    trades.push(trade);
    wtTotal++;
  }
  wandering.sets.push({
    name,
    amount: Math.trunc(set.amount ?? 1),
    allowDuplicates: set.allow_duplicates === true,
    trades,
  });
}
fs.writeFileSync(path.join(OUT, 'wandering_trader_trades.json'), JSON.stringify(wandering), 'utf8');
for (const set of wandering.sets) console.log(`wandering ${set.name}: ${set.trades.length} (${set.amount} offers)`);
console.log(`wandering trader trades: ${wtTotal}, skipped: ${wtSkipped}`);
