// Imports vanilla advancement definitions and the item/block/entity tags they reference.
//
//   MC_DATA=/path/to/client/data/minecraft node scripts/build-advancements.mjs
//
// Writes data/advancements.json and data/tags.json. The output contains definitions only
// (display text keys, icons, parents, criteria and tag membership), no textures or code.
import fs from 'node:fs';
import path from 'node:path';

const DATA = process.env.MC_DATA;
if (!DATA) {
  console.error('Set MC_DATA to the data/minecraft directory extracted from your own Minecraft client.jar.');
  process.exit(1);
}
const OUT = path.resolve(import.meta.dirname, '..', 'data');

const strip = (id) => String(id).replace(/^minecraft:/, '');
const text = (v) => {
  if (typeof v === 'string') return v;
  if (v && typeof v.text === 'string') return v.text;
  if (v && typeof v.translate === 'string') return v.translate;
  return '';
};
const listOf = (v) => {
  if (!v) return [];
  if (typeof v === 'string') return [strip(v)];
  if (Array.isArray(v)) return v.flatMap(listOf);
  if (typeof v === 'object') {
    if (v.items) return listOf(v.items);
    if (v.blocks) return listOf(v.blocks);
    if (v.entity_type) return listOf(v.entity_type);
  }
  return [];
};

function walk(dir, out = []) {
  if (!fs.existsSync(dir)) return out;
  for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
    const p = path.join(dir, e.name);
    if (e.isDirectory()) walk(p, out);
    else if (e.name.endsWith('.json')) out.push(p);
  }
  return out;
}

function itemIds(raw) {
  return listOf(raw);
}

function blockIds(raw) {
  return listOf(raw);
}

function entityIds(conditions) {
  const out = [];
  const entries = conditions?.entity;
  if (!Array.isArray(entries)) return out;
  for (const entry of entries) {
    const predicate = entry?.predicate ?? entry;
    const type = predicate?.['minecraft:entity_type'];
    if (type) out.push(...listOf(type));
    else if (predicate?.entity_type) out.push(...listOf(predicate.entity_type));
    else if (predicate?.type) out.push(...listOf(predicate.type));
  }
  return out;
}

function normalizeCriterion(raw) {
  const trigger = strip(raw?.trigger ?? 'impossible');
  const c = raw?.conditions ?? {};
  const criterion = { trigger };
  switch (trigger) {
    case 'inventory_changed': {
      for (const entry of c.items ?? []) {
        criterion.items = [...(criterion.items ?? []), ...itemIds(entry.items ?? entry)];
      }
      if (c.item) criterion.items = [...(criterion.items ?? []), ...itemIds(c.item)];
      break;
    }
    case 'mine_block':
    case 'enter_block': {
      criterion.blocks = blockIds(c.block);
      break;
    }
    case 'consume_item': {
      criterion.items = itemIds(c.item);
      break;
    }
    case 'player_killed_entity':
    case 'killed_by_entity': {
      criterion.entities = entityIds(c);
      break;
    }
    case 'location': {
      const dim = c.location?.[0]?.dimension ?? c.dimension;
      if (dim) criterion.dimension = strip(dim);
      break;
    }
    default:
      break;
  }
  // entity_properties -> location.position.y predicates (trade at world height, fall from height).
  const players = c.player;
  if (Array.isArray(players)) {
    for (const entry of players) {
      const predicate = entry?.predicate ?? entry;
      const location = predicate?.['minecraft:location'] ?? predicate?.location;
      const y = location?.position?.y;
      if (typeof y?.min === 'number') criterion.minY = y.min;
      if (typeof y?.max === 'number') criterion.maxY = y.max;
    }
  }
  return criterion;
}

const advRoot = path.join(DATA, 'advancement');
const advancements = {};
const roots = new Set();
for (const file of walk(advRoot)) {
  const raw = JSON.parse(fs.readFileSync(file, 'utf8'));
  const id = path.relative(advRoot, file).replace(/\\/g, '/').replace(/\.json$/, '');
  const display = raw.display;
  if (!display) continue; // recipe/root technical advancements
  const criteria = {};
  for (const [name, value] of Object.entries(raw.criteria ?? {})) {
    criteria[name] = normalizeCriterion(value);
  }
  const parent = raw.parent ? strip(raw.parent) : null;
  if (!parent) roots.add(id);
  advancements[id] = {
    parent,
    title: text(display.title),
    description: text(display.description),
    icon: strip(display.icon?.id ?? display.icon?.item ?? 'stone'),
    frame: display.frame ?? 'task',
    background: display.background ? strip(display.background) : undefined,
    hidden: display.hidden === true,
    toast: display.show_toast !== false,
    announce: display.announce_to_chat !== false,
    criteria,
    requirements: Array.isArray(raw.requirements)
      ? raw.requirements.map((group) => group.map(String))
      : Object.keys(criteria).map((name) => [name]),
  };
}

const tags = { item: {}, block: {}, entity_type: {} };
for (const kind of ['item', 'block', 'entity_type']) {
  const dir = path.join(DATA, 'tags', kind);
  for (const file of walk(dir)) {
    const id = path.relative(dir, file).replace(/\\/g, '/').replace(/\.json$/, '');
    const raw = JSON.parse(fs.readFileSync(file, 'utf8'));
    tags[kind][id] = (raw.values ?? []).map((entry) => {
      const value = typeof entry === 'string' ? entry : entry.id;
      return strip(value);
    });
  }
}

fs.mkdirSync(OUT, { recursive: true });
fs.writeFileSync(path.join(OUT, 'advancements.json'), JSON.stringify({
  roots: [...roots].sort(),
  advancements,
}), 'utf8');
fs.writeFileSync(path.join(OUT, 'tags.json'), JSON.stringify(tags), 'utf8');
console.log(`advancements: ${Object.keys(advancements).length}, roots: ${[...roots].sort().join(', ')}`);
console.log(`tags: item=${Object.keys(tags.item).length}, block=${Object.keys(tags.block).length}, entity_type=${Object.keys(tags.entity_type).length}`);
