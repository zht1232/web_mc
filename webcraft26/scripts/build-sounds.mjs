// Imports the vanilla 26.2 sound events we use from the local launcher asset index.
//
//   node scripts/build-sounds.mjs [--dry]
//
// 26.2's client jar ships no sounds.json and no ogg files, but the launcher's asset index
// (<.minecraft>/assets/indexes/32.json) has all of them (hash -> objects/<hh>/<hash>). This reads the
// vanilla `minecraft/sounds.json` (event -> sound file list), copies the ogg files of a whitelist of events
// into public/mc/sounds/<event>/<file>.ogg and merges the events into public/mc/sounds/index.json, which is
// what SoundEngine loads. Events already present in index.json (the original 28) are left untouched.
// Music and records are never imported (size). The assets directory is only read.

import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const OUT = path.join(root, 'public', 'mc', 'sounds');
const ASSETS = process.env.MC_EXTERNAL ?? path.join(os.homedir(), 'AppData', 'Roaming', '.minecraft', 'assets');
const DRY = process.argv.includes('--dry');
const MAX_BYTES = 80 * 1024 * 1024;

const objects = JSON.parse(fs.readFileSync(path.join(ASSETS, 'indexes', '32.json'), 'utf8')).objects;
const objectPath = (key) => {
  const o = objects[key];
  return o ? path.join(ASSETS, 'objects', o.hash.slice(0, 2), o.hash) : null;
};
const sounds = JSON.parse(fs.readFileSync(objectPath('minecraft/sounds.json'), 'utf8'));

const BLOCK_TYPES = [
  'grass', 'stone', 'gravel', 'sand', 'wood', 'wool', 'glass', 'snow', 'metal', 'deepslate', 'bamboo', 'cherry_wood',
  'nether_bricks', 'netherrack', 'amethyst_block', 'moss', 'mud', 'soul_sand', 'soul_soil', 'coral_block', 'ladder',
  'chain', 'copper', 'tuff', 'dripstone_block', 'honey_block', 'slime_block', 'lantern', 'candle', 'vine', 'bone_block',
  'calcite', 'basalt', 'nether_wood', 'wart_block', 'powder_snow', 'azalea', 'rooted_dirt', 'sculk', 'hanging_roots',
  'roots', 'fungus', 'stem', 'scaffolding', 'sweet_berry_bush', 'cave_vines', 'big_dripleaf', 'small_dripleaf',
  'decorated_pot', 'froglight', 'packed_mud', 'mud_bricks', 'pale_hanging_moss', 'resin', 'iron', 'anvil', 'cobweb',
];
const MOBS = [
  'zombie', 'skeleton', 'creeper', 'spider', 'cave_spider', 'enderman', 'pig', 'cow', 'sheep', 'chicken', 'bat', 'slime',
  'witch', 'drowned', 'husk', 'stray', 'bogged', 'zombie_villager', 'wolf', 'fox', 'cat', 'ocelot', 'squid', 'glow_squid',
  'parrot', 'rabbit', 'silverfish', 'villager', 'iron_golem', 'horse', 'donkey', 'llama', 'turtle', 'dolphin', 'cod',
  'salmon', 'panda', 'bee', 'goat', 'phantom', 'pillager', 'magma_cube', 'blaze', 'ghast', 'wither_skeleton',
];

// every SoundType used by a block in blocks.json (its `sound` field is the break event, e.g. block.stone.break)
for (const b of JSON.parse(fs.readFileSync(path.join(root, 'public', 'mc', 'blocks.json'), 'utf8')).blocks) {
  const m = /^block.([a-z_]+).break$/.exec(b.sound ?? '');
  if (m && !BLOCK_TYPES.includes(m[1])) BLOCK_TYPES.push(m[1]);
}

const WANTED = [
  new RegExp(`^block\\.(${BLOCK_TYPES.join('|')})\\.(step|break|place|hit|fall)$`),
  new RegExp(`^entity\\.(${MOBS.join('|')})\\.[a-z_]+$`),
  /^entity\.player\.(hurt|death|burp|levelup|splash|swim|small_fall|big_fall|hurt_on_fire|hurt_drown|hurt_freeze|attack\.[a-z_]+)$/,
  /^entity\.generic\.(explode|eat|drink|burn|extinguish_fire|splash|swim|small_fall|big_fall|hurt)$/,
  /^entity\.(item\.(pickup|break)|experience_orb\.pickup|arrow\.(hit|hit_player|shoot)|tnt\.primed|lightning_bolt\.(thunder|impact)|fishing_bobber\.splash)$/,
  /^(weather\.rain(\.above)?|ambient\.(cave|underwater\.[a-z_.]+|nether_wastes\.[a-z_]+))$/,
  /^block\.(fire\.(ambient|extinguish)|lava\.(ambient|pop|extinguish)|campfire\.crackle|water\.ambient|chest\.(open|close)|barrel\.(open|close)|wooden_door\.(open|close)|iron_door\.(open|close)|fence_gate\.(open|close)|wooden_trapdoor\.(open|close)|iron_trapdoor\.(open|close)|furnace\.fire_crackle|enchantment_table\.use|lever\.click|wooden_button\.(click_on|click_off)|stone_button\.(click_on|click_off)|wooden_pressure_plate\.(click_on|click_off)|stone_pressure_plate\.(click_on|click_off)|bubble_column\.[a-z_]+|portal\.ambient|grass\.hit)$/,
  /^(ui\.button\.click|random\.(click|pop|explode|bow|break|splash|burp|levelup|orb|fizz))$/,
];

function resolveFiles(event, seen = new Set()) {
  if (seen.has(event)) return [];
  seen.add(event);
  const def = sounds[event];
  if (!def || !Array.isArray(def.sounds)) return [];
  const files = [];
  for (const s of def.sounds) {
    const name = typeof s === 'string' ? s : s.name;
    if (!name) continue;
    if (typeof s === 'object' && s.type === 'event') { files.push(...resolveFiles(name.replace(/^minecraft:/, ''), seen)); continue; }
    files.push(name.replace(/^minecraft:/, ''));
  }
  return files;
}

const indexFile = path.join(OUT, 'index.json');
const index = JSON.parse(fs.readFileSync(indexFile, 'utf8'));
const existing = new Set(Object.keys(index.events));

let bytes = 0, copied = 0, events = 0, missing = 0;
const names = Object.keys(sounds).sort();
for (const event of names) {
  if (existing.has(event)) continue;
  if (!WANTED.some((re) => re.test(event))) continue;
  const rels = [];
  const files = [...new Set(resolveFiles(event))];
  for (const f of files) {
    const src = objectPath(`minecraft/sounds/${f}.ogg`);
    if (!src || !fs.existsSync(src)) { missing++; continue; }
    const size = fs.statSync(src).size;
    if (bytes + size > MAX_BYTES) { console.warn('size cap reached, stopping at', event); break; }
    const rel = `${event}/${f.replace(/\//g, '_')}.ogg`;
    if (!DRY) {
      fs.mkdirSync(path.join(OUT, event), { recursive: true });
      fs.copyFileSync(src, path.join(OUT, rel));
    }
    rels.push(rel);
    bytes += size;
    copied++;
  }
  if (rels.length) { index.events[event] = rels; events++; }
}

index.eventCount = Object.keys(index.events).length;
index.fileCount = Object.values(index.events).reduce((n, f) => n + f.length, 0);
index.source = 'official-assets-mc/sounds + launcher asset index minecraft/sounds.json (scripts/build-sounds.mjs)';
if (!DRY) fs.writeFileSync(indexFile, JSON.stringify(index, null, 2));
console.log(`${DRY ? '[dry] ' : ''}events added ${events}, files ${copied}, missing ${missing}, ${(bytes / 1048576).toFixed(1)} MB; index now ${index.eventCount} events / ${index.fileCount} files`);
