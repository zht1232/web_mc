#!/usr/bin/env node
/**
 * build-itemmodels.mjs — item model pipeline for the WebCraft26 WebGL2 client.
 *
 *   input : <vanilla>/assets/minecraft/items/*.json      (model selector trees)
 *           <vanilla>/assets/minecraft/models/**\/*.json (cuboid / template models)
 *           public/mc/items.json                      (1537 item names + stats)
 *           public/mc/models.json                     (6816 baked *block* models)
 *           public/mc/blocks.json, public/mc/states.json
 *           public/mc/tex/item.json, public/mc/tex/block.json (texture array layer names)
 *   output: public/mc/itemmodels.json, public/mc/itemmodels_meta.json
 *
 * Run: node scripts/build-itemmodels.mjs
 * Idempotent, Node built-ins only, never writes outside public/mc.
 *
 * ---------------------------------------------------------------------------
 * How a 26.2 item is drawn (verified against src-vanilla 26.2)
 *
 * 1. `assets/minecraft/items/<name>.json` is NOT a model, it is a *model
 *    selector tree*:
 *
 *      { "model": <node> }
 *
 *      node := {type:"minecraft:model",        model:"<loc>", tints:[...]}
 *            | {type:"minecraft:select",       property, cases:[{when,model}], fallback}
 *            | {type:"minecraft:range_dispatch",property, entries:[{threshold,model}], fallback}
 *            | {type:"minecraft:condition",    property, on_true, on_false}
 *            | {type:"minecraft:composite",    models:[node...]}
 *            | {type:"minecraft:empty"}
 *            | {type:"minecraft:special",      base:"<loc>", model:{type:"minecraft:chest",...}}
 *
 *    Every node is a *function of an ItemStack*. For inventory rendering we
 *    need one concrete default, so the tree is resolved statically:
 *
 *      select        -> the GUI case if the property is display_context,
 *                       otherwise the first case; fallback when there is none.
 *                       (Vanilla always lists the "gui" case first for
 *                       display_context, bundles/spyglass/trident rely on it.)
 *      range_dispatch-> fallback (thresholds describe clock/comppass/bow-pull,
 *                       i.e. dynamic states; the fallback is the neutral one)
 *      condition     -> on_false (the "not using / not charged / not cast"
 *                       branch — what the stack looks like at rest)
 *      composite     -> all children, in order
 *      empty         -> nothing
 *
 * 2. A `minecraft:model` node points at a model location. That model is:
 *
 *      a) a *block* model (`block/...`)  -> 3D cuboid geometry. Already baked
 *         into public/mc/models.json; we only store the array index.
 *      b) `item/...` with a parent chain ending in `builtin/generated`
 *         -> flat sprite stack, 1..5 layers (`layer0`..`layer4`), each layer
 *         becomes a 1px-deep extruded quad (ItemModelGenerator.java).
 *      c) `item/...` ending in `builtin/entity` -> not a cuboid model at all,
 *         it is drawn by hand-written code (chest, banner, shulker box, ...).
 *         In 26.2 those go through `minecraft:special` instead; we mark them
 *         `special` and record the renderer type.
 *
 * 3. Tint: `ItemModelGenerator` bakes every layer with
 *    `MaterialInfo.of(..., tintIndex = layerIndex, ...)` — i.e. the tint index
 *    of `layerN` is N. `CuboidItemModelWrapper` turns the node's `tints` list
 *    into `tintLayers[]`, one entry per tint source, so the colour applied to
 *    layer N is tintSources[N]. If N >= tints.length the layer is untinted
 *    (-1). The static default per source is `default` (dye/potion/map_color/
 *    firework/team) or `value` (constant) or, for `grass`, the colormap lookup
 *    at the model's (temperature, downfall) — all six grass tints in 26.2 are
 *    (0.5, 1.0) which is GrassColor.getDefaultColor() = 0x91BD59.
 *
 * 4. guiLight: flat item models are always `front` (ItemModelGenerator.
 *    guiLight() == FRONT), block models default to `side` unless their JSON
 *    says `gui_light: front`. models.json already stores that decision in
 *    `gl` (6808 side / 8 front), so for block items it is copied verbatim.
 *    `front` means "shade like a flat sprite with a fixed front light",
 *    `side` means "shade with the block light model (top brighter)".
 *
 * ---------------------------------------------------------------------------
 * Output shape (public/mc/itemmodels.json)
 *
 *   items["minecraft:diamond_sword"] = {
 *     kind:"flat", guiLight:"front", modelLoc:"minecraft:item/diamond_sword",
 *     layers:[{texture:"item/diamond_sword", array:"item", tint:-1}]
 *   }
 *   items["minecraft:stone"] = {kind:"block", model:2888, modelLoc:"minecraft:block/stone", guiLight:"side"}
 *   items["minecraft:chest"] = {kind:"special", special:"chest", texture:"entity/chest/normal"}
 *   items["minecraft:air"]   = {kind:"none"}
 *
 * `layers[]` is draw order (layer0 first). `texture` is a name from
 * tex/item.json (`array:"item"`) or tex/block.json (`array:"block"`), i.e.
 * without the `textures/` prefix and without `.png`.
 */

import fs from 'node:fs/promises';
import { existsSync, readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

// ---------------------------------------------------------------------------
// Paths — hard boundary: outputs go to public/mc and nowhere else.
// ---------------------------------------------------------------------------

const HERE = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(HERE, '..');
const OUT = path.join(ROOT, 'public', 'mc');

const VANILLA = path.resolve(
  ROOT,
  '..',
  '_src',
  'thirdparty',
  'thirdparty',
  'src-vanilla',
  'assets',
  'minecraft',
);
const ITEMS_DIR = path.join(VANILLA, 'items');
const MODELS_DIR = path.join(VANILLA, 'models');

const EXPECTED_ITEM_COUNT = 1537;

// ---------------------------------------------------------------------------
// Small helpers
// ---------------------------------------------------------------------------

const unNs = (s) => String(s).replace(/^minecraft:/, '');

/**
 * Canonical model location. Item selectors write "minecraft:block/stone" while
 * model parents may write "block/stone" or "builtin/generated", and
 * models.json keys are fully qualified — normalise everything to
 * "minecraft:<path>" before comparing.
 */
const modelLoc = (s) => 'minecraft:' + unNs(s);

/** "minecraft:textures/entity/chest/normal.png" -> "entity/chest/normal" */
const texName = (s) => unNs(s).replace(/^textures\//, '').replace(/\.png$/, '');

/** Slots tried, in draw order, by ItemModelGenerator. */
const LAYERS = ['layer0', 'layer1', 'layer2', 'layer3', 'layer4'];

const readJson = (p) => JSON.parse(readFileSync(p, 'utf8'));
const jsonOrNull = (p) => (existsSync(p) ? readJson(p) : null);

// GrassColor.getDefaultColor() == GrassColor.get(0.5, 1.0); the colormap at
// that point in vanilla assets/minecraft/textures/colormap/grass.png.
const GRASS_DEFAULT = 0x91bd59;

// ---------------------------------------------------------------------------
// Load the already-built data we must reuse
// ---------------------------------------------------------------------------

// items.json lives in data/ in this checkout (public/mc/items.json is the
// documented location but is not produced yet) — accept either.
const ITEMS_FILE = existsSync(path.join(OUT, 'items.json'))
  ? path.join(OUT, 'items.json')
  : path.join(ROOT, 'data', 'items.json');
const itemsDoc = readJson(ITEMS_FILE);
const ITEMS = itemsDoc.items;
if (!Array.isArray(ITEMS) || ITEMS.length !== EXPECTED_ITEM_COUNT) {
  throw new Error(`items.json: expected ${EXPECTED_ITEM_COUNT} items, got ${ITEMS?.length}`);
}

const modelsDoc = readJson(path.join(OUT, 'models.json'));
const BAKED = modelsDoc.models; // 6816 entries: {loc, st, ao, gl}
const BAKED_COUNT = BAKED.length;

/** model location -> index into models.json.models (keys are "minecraft:block/…") */
const bakedIndex = new Map();
for (let i = 0; i < BAKED.length; i++) if (!bakedIndex.has(BAKED[i].loc)) bakedIndex.set(BAKED[i].loc, i);

const blocksDoc = readJson(path.join(OUT, 'blocks.json'));
const BLOCKS = new Map(blocksDoc.blocks.map((b) => [b.name, b]));

// states.json maps each block to its baked variants:
//   {kind:"variant",   props:{...}, variants:{"<prop=val,…>":[{m:idx,w:1}]}}
//   {kind:"multipart", props:{...}, parts:[{c:condition, a:[{m:idx,w:1}]}]}
// It is used only for the block-item fallback (see blockStateFallback).
const statesDoc = readJson(path.join(OUT, 'states.json'));

const itemTex = readJson(path.join(OUT, 'tex', 'item.json')); // {size, layers, names[], animated{}}
const blockTex = readJson(path.join(OUT, 'tex', 'block.json'));
const ITEM_TEX = new Set(itemTex.names);
const BLOCK_TEX = new Set(blockTex.names);

// ---------------------------------------------------------------------------
// Model JSON source + parent-chain flattening
// ---------------------------------------------------------------------------

const modelJsonCache = new Map(); // loc -> json|null
const chainCache = new Map(); // loc -> flattened description

function loadModelJson(loc) {
  if (modelJsonCache.has(loc)) return modelJsonCache.get(loc);
  const json = jsonOrNull(path.join(MODELS_DIR, unNs(loc) + '.json'));
  modelJsonCache.set(loc, json);
  return json;
}

/**
 * Flatten a model location through its `parent` chain.
 *
 * Child values win over the parent (vanilla resolves from the leaf upwards),
 * so while walking up we only fill a slot the first time we see it.
 *
 * Returns:
 *   textures   merged slot -> texture reference (still may be "#otherSlot")
 *   guiLight   "front" | "side" | null   (first definition in the chain)
 *   elements   inline cuboid list, or null
 *   builtin    "generated" | "entity" | "<other builtin>" | null
 *   missing    location whose JSON does not exist (chain truncated)
 */
function resolveChain(loc) {
  if (chainCache.has(loc)) return chainCache.get(loc);

  const textures = {};
  let guiLight = null;
  let elements = null;
  let builtin = null;
  let missing = null;

  const seen = new Set();
  let cur = loc;
  while (cur) {
    if (seen.has(cur)) {
      missing = cur; // parent cycle, should not happen but do not hang
      break;
    }
    seen.add(cur);

    const json = loadModelJson(cur);
    if (!json) {
      missing = cur;
      break;
    }

    if (guiLight === null && json.gui_light) guiLight = json.gui_light;
    if (elements === null && Array.isArray(json.elements) && json.elements.length) elements = json.elements;
    for (const [slot, ref] of Object.entries(json.textures || {})) {
      if (!(slot in textures)) textures[slot] = ref;
    }

    const parent = json.parent;
    if (!parent) break;
    const p = unNs(parent);
    if (p.startsWith('builtin/')) {
      builtin = p.slice('builtin/'.length);
      break;
    }
    cur = modelLoc(p);
  }

  const result = { loc, textures, guiLight, elements, builtin, missing };
  chainCache.set(loc, result);
  return result;
}

/**
 * Follow "#slot" indirections inside a texture map.
 * Returns the resolved raw reference (e.g. "minecraft:item/diamond_sword")
 * or null when the reference is dangling.
 */
function resolveTextureRef(ref, textures) {
  let cur = ref;
  for (let hops = 0; hops < 8 && typeof cur === 'string'; hops++) {
    if (!cur.startsWith('#')) return cur;
    const next = textures[cur.slice(1)];
    if (next === undefined) return null;
    cur = next;
  }
  return null;
}

// ---------------------------------------------------------------------------
// Statically resolve a model selector tree to a default render description
// ---------------------------------------------------------------------------

const whenList = (w) => (Array.isArray(w) ? w.map(unNs) : [unNs(w)]);

/**
 * Walk the selector tree and collect the leaves of the *default* branch.
 *
 * A leaf is one of
 *   {kind:"model",   loc, tints, transformation}
 *   {kind:"special", special, base, params}
 *   {kind:"unknown", type, node}     // e.g. minecraft:bundle/selected_item
 *   {kind:"empty"}
 */
function resolveSelector(node, out = [], depth = 0) {
  if (!node || typeof node !== 'object' || depth > 32) return out;
  const type = unNs(node.type || '');

  switch (type) {
    case 'model':
      out.push({
        kind: 'model',
        loc: modelLoc(node.model),
        tints: Array.isArray(node.tints) ? node.tints : [],
        transformation: node.transformation || null,
      });
      break;

    case 'composite':
      // "keep all children in order" — e.g. bundle_open_back + contents + front
      for (const child of node.models || []) resolveSelector(child, out, depth + 1);
      break;

    case 'select': {
      // `select` picks a case by an item property. The cases are the *special
      // states* of the item and the fallback is the plain one:
      //
      //   display_context  -> cases list the hand/ground/fixed poses, the
      //                       "gui" case (or fallback) is what the inventory
      //                       draws. Vanilla always lists gui first.
      //   trim_material    -> cases are the 11 armour-trim materials; a stack
      //                       with no `trim` component takes the fallback
      //                       (untrimmed). Trim overlays live in
      //                       textures/trims/items/** which is *not* part of
      //                       tex/item.json, so cases[0] would produce an
      //                       unresolvable layer for every armour piece.
      //   charge_type      -> arrow / rocket / fallback (crossbow bolt state)
      //   block_state      -> note block instrument, leaves decay, ...
      //   local_time       -> christmas chest, ...
      //
      // Rule used here: prefer the case vanilla marks as the *inventory* one
      // (gui) when the property distinguishes display contexts; for every
      // other property the neutral state is the fallback, and cases[0] is only
      // a last resort when no fallback exists.
      const cases = node.cases || [];
      let chosen = null;
      if (node.property === 'minecraft:display_context') {
        chosen = cases.find((c) => whenList(c.when).includes('gui')) || null;
      }
      if (!chosen && !node.fallback && cases.length) chosen = cases[0];
      if (chosen) resolveSelector(chosen.model, out, depth + 1);
      else if (node.fallback) resolveSelector(node.fallback, out, depth + 1);
      break;
    }

    case 'range_dispatch':
      // Thresholds are dynamic (clock angle, compass angle, bow pull). The
      // idle/neutral model is the fallback; entries[0] is only a safety net.
      if (node.fallback) resolveSelector(node.fallback, out, depth + 1);
      else if (node.entries?.length) resolveSelector(node.entries[0].model, out, depth + 1);
      break;

    case 'condition':
      // on_true is "using / cast / charged / has selected item"; at rest the
      // stack shows on_false.
      if (node.on_false) resolveSelector(node.on_false, out, depth + 1);
      else if (node.on_true) resolveSelector(node.on_true, out, depth + 1);
      break;

    case 'special':
      // Hand-rendered entity-style model (chest, banner, shulker box, ...).
      // NOTE: `node.model` here is the *renderer* descriptor, not a selector
      // node, so we must not recurse into it.
      out.push({
        kind: 'special',
        special: unNs(node.model?.type || 'unknown'),
        base: node.base ? modelLoc(node.base) : null,
        params: node.model || {},
      });
      break;

    case 'empty':
      out.push({ kind: 'empty' });
      break;

    case '':
      break;

    default:
      // minecraft:bundle/selected_item and friends: a plug-in renderer that
      // draws another stack. Not a cuboid model.
      out.push({ kind: 'unknown', type, node });
      break;
  }
  return out;
}

// ---------------------------------------------------------------------------
// Leaf classification: model location -> flat / block / special / none
// ---------------------------------------------------------------------------

/** Static default colour for one tint source (index i of the node's tints). */
function tintDefault(source) {
  if (!source || typeof source !== 'object') return -1;
  if (typeof source.value === 'number') return source.value; // minecraft:constant
  if (typeof source.default === 'number') return source.default; // dye/potion/map_color/firework/team
  if (unNs(source.type || '') === 'grass') {
    // GrassColorSource -> GrassColor.get(temperature, downfall); every 26.2
    // item model that uses it passes (0.5, 1.0), the default colormap point.
    const t = source.temperature ?? 0.5;
    const d = source.downfall ?? 1.0;
    if (Math.abs(t - 0.5) < 1e-6 && Math.abs(d - 1.0) < 1e-6) return GRASS_DEFAULT;
    return GRASS_DEFAULT; // only (0.5,1.0) occurs; keep one value rather than fake a colormap
  }
  return -1;
}

/** The tint sources that the runtime may have to recompute from the stack. */
function tintSources(tints) {
  return tints.map((t) => ({
    type: unNs(t.type || 'unknown'),
    ...(typeof t.default === 'number' ? { default: t.default } : {}),
    ...(typeof t.value === 'number' ? { value: t.value } : {}),
    ...(typeof t.temperature === 'number' ? { temperature: t.temperature } : {}),
    ...(typeof t.downfall === 'number' ? { downfall: t.downfall } : {}),
    ...(typeof t.index === 'number' ? { index: t.index } : {}),
  }));
}

/** Flat sprite stack: layer0..layer4 -> texture array names, in draw order. */
function describeFlat(loc, tints) {
  const chain = resolveChain(loc);
  const layers = [];
  for (let i = 0; i < LAYERS.length; i++) {
    const ref = chain.textures[LAYERS[i]];
    if (ref === undefined) break; // ItemModelGenerator stops at the first hole
    const resolved = resolveTextureRef(ref, chain.textures);
    if (!resolved) break;
    const name = texName(resolved);
    const isBlock = name.startsWith('block/');
    layers.push({
      texture: name,
      array: isBlock ? 'block' : 'item',
      tint: i < tints.length ? tintDefault(tints[i]) : -1,
    });
  }
  return {
    entry: {
      kind: 'flat',
      // flat models are always lit from the front (ItemModelGenerator.guiLight)
      guiLight: chain.guiLight || 'front',
      modelLoc: loc,
      layers,
      ...(tints.length ? { tints: tintSources(tints) } : {}),
    },
    chain,
  };
}

const HEAD_TEXTURE = {
  skeleton: 'entity/skeleton/skeleton',
  wither_skeleton: 'entity/skeleton/wither_skeleton',
  zombie: 'entity/zombie/zombie',
  creeper: 'entity/creeper/creeper',
  piglin: 'entity/piglin/piglin',
  dragon: 'entity/enderdragon/dragon',
};

/**
 * Special model -> which hand-written renderer the client needs, plus the
 * sprite/parameters that renderer expects (paths are vanilla sprite paths,
 * i.e. relative to the referenced atlas, e.g. "entity/chest/normal").
 */
function describeSpecial(leaf) {
  const p = leaf.params || {};
  const entry = { kind: 'special', special: leaf.special };
  if (leaf.base) entry.base = leaf.base;

  switch (leaf.special) {
    case 'chest': {
      // ChestSpecialRenderer + Sheets.CHEST_MAPPER ("entity/chest" prefix);
      // the renderer also probes "<name>_left"/"<name>_right"/"<name>_open".
      const tex = p.texture ? unNs(p.texture) : 'normal';
      entry.texture = 'entity/chest/' + tex;
      entry.params = { openness: 0 };
      break;
    }
    case 'shulker_box':
      // Sheets.SHULKER_MAPPER ("entity/shulker" prefix), texture already "shulker_<color>"
      entry.texture = 'entity/shulker/' + (p.texture ? unNs(p.texture) : 'shulker');
      entry.params = { openness: p.openness ?? 0 };
      break;
    case 'banner':
      // Sheets.BANNER_MAPPER ("entity/banner"); base sprite + "<color>" pattern layer
      entry.texture = 'entity/banner/banner_base';
      entry.params = { color: p.color ? unNs(p.color) : 'white', patterns: [] };
      break;
    case 'shield':
      entry.texture = 'entity/shield/shield_base';
      entry.params = { patterns: [], baseColor: 0xffffff };
      break;
    case 'conduit':
      // ConduitRenderer.SHELL_TEXTURE = "entity/conduit/base"
      entry.texture = 'entity/conduit/base';
      break;
    case 'decorated_pot':
      entry.texture = 'entity/decorated_pot/decorated_pot_base';
      entry.params = { side: 'entity/decorated_pot/decorated_pot_side', sherds: [] };
      break;
    case 'trident':
      // TridentSpecialRenderer: TridentModel.TEXTURE = entity/trident/trident
      entry.texture = 'entity/trident/trident';
      entry.params = { mode: p.mode ? unNs(p.mode) : 'in_hand' };
      break;
    case 'head':
      entry.texture = HEAD_TEXTURE[p.kind] || 'entity/skeleton/skeleton';
      entry.params = { kind: p.kind ? unNs(p.kind) : 'skeleton' };
      break;
    case 'player_head':
      // DefaultPlayerSkin.getDefaultTexture(); real skins come from the profile
      // component, so the runtime must upload that skin as its own texture.
      entry.texture = 'entity/player/wide/steve';
      entry.params = { skin: 'profile' };
      break;
    case 'copper_golem_statue':
      // texture field in the JSON is a full texture path, e.g.
      // "minecraft:textures/entity/copper_golem/copper_golem.png"
      entry.texture = p.texture ? texName(p.texture) : null;
      entry.params = { pose: p.pose ? unNs(p.pose) : 'standing' };
      break;
    case 'bundle/selected_item':
      // BundleSelectedItemSpecialRenderer: draws the *content* stack in the
      // bundle opening. Nothing to bake.
      entry.params = { item: 'content' };
      break;
    default:
      entry.params = p;
      break;
  }
  return entry;
}

/** Block item: model location already exists in models.json. */
function describeBlock(loc, idx, extra = {}) {
  return {
    kind: 'block',
    model: idx,
    modelLoc: loc,
    // models.json.gl is the already-resolved gui_light ("side" unless the JSON
    // asked for "front", e.g. the few flat-on-a-block models)
    guiLight: BAKED[idx].gl || 'side',
    ...extra,
  };
}

/**
 * Resolve one `minecraft:model` location to a concrete entry, plus a
 * `problem` string when something had to be guessed or substituted.
 */
function describeModelLoc(loc, tints) {
  // 3D: the exact location is a baked block model. This is the common case
  // for block items (`minecraft:block/stone` and friends).
  const idx = bakedIndex.get(loc);
  if (idx !== undefined) {
    // Leaves / vines / lily pads are 3D block models whose *item* model adds a
    // constant (or biome) tint that the block model itself does not carry.
    // Keep the tint sources so the runtime can pass a uniform colour.
    return {
      entry: describeBlock(loc, idx, tints.length ? { tints: tintSources(tints) } : {}),
      problem: null,
    };
  }

  const chain = resolveChain(loc);

  // `item/...` models are never in models.json (that file only holds blocks).
  // Whatever geometry they have is either the builtin flat generator or an
  // inline cuboid list (only item/spyglass_in_hand in 26.2).
  const hasLayer0 = chain.textures.layer0 !== undefined;
  const isGenerated = chain.builtin === 'generated' || (hasLayer0 && !chain.elements);

  if (isGenerated) {
    const { entry } = describeFlat(loc, tints);
    return { entry, problem: entry.layers.length ? null : 'empty-flat-model' };
  }

  if (chain.elements) {
    // Inline cuboid geometry in a `block/...` model that models.json never
    // baked. models.json only contains models reachable from a blockstate, and
    // a handful of "inventory" models (walls, shelves, moss carpet, spyglass
    // in hand) are referenced *only* by item selectors. Not representable as a
    // model index -> caller substitutes the block's default-state model.
    return {
      entry: { kind: 'none', reason: 'inline-model-not-baked', modelLoc: loc },
      problem: 'inline-model-not-baked',
    };
  }

  if (chain.builtin === 'entity') {
    // builtin/entity => drawn by code. 26.2 reaches these through
    // minecraft:special, so if we land here the selector lost the type.
    return {
      entry: { kind: 'special', special: 'unknown', base: loc },
      problem: 'builtin-entity-without-special-descriptor',
    };
  }

  // Nothing to draw: e.g. item/air (only a "particle" texture, no layers).
  return { entry: { kind: 'none' }, problem: chain.missing ? 'missing-model-json' : null };
}

/**
 * Fallback for block items whose exact model location was never baked.
 *
 * models.json only contains models reachable from a *blockstate*, so the
 * `block/<name>_inventory` models that item selectors use for walls, fences,
 * buttons, shelves, pistons, logs … are absent. Per the pipeline rules we
 * substitute the model of the block's **default state**:
 *
 *   blocks.json.defaultState  global state id
 *   blocks.json.localIndex[0] first global id owned by this block
 *   blocks.json.props[]       property names + ordered value lists
 *   -> offset = defaultState - localIndex[0] is the mixed-radix index into the
 *      state list (last property varies fastest); decode it back to a value
 *      per property, then build the "<prop>=<value>,…" key that states.json
 *      uses (states.json lists states in the same order, keyed that way).
 *
 * For multipart blocks there is no single state model, so part[0] — the
 * unconditional post/base part — is used.
 */
function blockStateFallback(blockName) {
  const st = statesDoc.blocks?.[blockName];
  if (!st) return null;

  if (st.kind === 'multipart') {
    const first = st.parts?.[0]?.a?.[0];
    return first ? first.m : null;
  }

  const variants = st.variants || {};
  const block = BLOCKS.get(blockName);
  let key = null;

  if (block && Array.isArray(block.props) && block.props.length) {
    // decode the mixed-radix default state index
    const offset = block.defaultState - block.localIndex[0];
    const values = {};
    let rem = offset;
    for (let i = block.props.length - 1; i >= 0; i--) {
      const prop = block.props[i];
      const n = prop.values.length;
      values[prop.name] = prop.values[rem % n];
      rem = Math.floor(rem / n);
    }
    // states.json may omit properties the blockstate file does not vary on
    // (e.g. waterlogged): only key on the properties it actually knows.
    key = Object.keys(st.props || {})
      .map((p) => `${p}=${values[p]}`)
      .join(',');
  } else {
    key = '';
  }

  if (key !== null && variants[key]) {
    const first = Array.isArray(variants[key]) ? variants[key][0] : variants[key];
    if (first) return first.m;
  }

  // Unknown key layout: take the first variant (states.json is sorted, so this
  // is the lexicographically smallest state) as a last resort.
  const firstKey = Object.keys(variants)[0];
  const list = firstKey === undefined ? null : variants[firstKey];
  const first = Array.isArray(list) ? list[0] : list;
  return first ? first.m : null;
}

// ---------------------------------------------------------------------------
// Main pass over all 1,537 items
// ---------------------------------------------------------------------------

const itemNames = new Set(ITEMS.map((i) => i.name));
const assetItemFiles = new Set(
  (await fs.readdir(ITEMS_DIR)).filter((f) => f.endsWith('.json')).map((f) => f.slice(0, -5)),
);

const out = {}; // "minecraft:<name>" -> entry
const modelTable = {}; // model location -> entry (debug / reuse)
const fallbacks = []; // items that had to be substituted
const missing = []; // items with kind:"none"
const unresolvedLayers = []; // flat layers not present in a texture array
const warnings = [];
const specialCounts = {};
const kindCounts = { block: 0, flat: 0, special: 0, composite: 0, none: 0 };

function rememberModel(loc, entry) {
  if (!modelTable[loc]) modelTable[loc] = entry;
}

for (const item of ITEMS) {
  const name = item.name;
  const key = 'minecraft:' + name;

  // ---- 1. read the selector tree -----------------------------------------
  const selectorDoc = jsonOrNull(path.join(ITEMS_DIR, name + '.json'));
  let leaves;
  if (selectorDoc && selectorDoc.model) {
    leaves = resolveSelector(selectorDoc.model);
  } else {
    // No selector file at all: fall back to the legacy convention of a single
    // flat model named after the item, if such a texture exists.
    leaves = [{ kind: 'model', loc: 'minecraft:item/' + name, tints: [], synthetic: true }];
    if (ITEM_TEX.has('item/' + name)) {
      fallbacks.push({ item: key, reason: 'missing-item-selector', used: 'item/' + name });
    } else {
      out[key] = { kind: 'none', reason: 'missing-item-selector' };
      kindCounts.none++;
      missing.push({ item: key, reason: 'missing-item-selector' });
      continue;
    }
  }

  // ---- 2. drop empty leaves, keep order ----------------------------------
  const real = leaves.filter((l) => l.kind !== 'empty');

  if (real.length === 0) {
    out[key] = { kind: 'none', reason: 'empty-model' };
    kindCounts.none++;
    missing.push({ item: key, reason: 'empty-model' });
    continue;
  }

  // ---- 3. single leaf: the normal case -----------------------------------
  if (real.length === 1) {
    const leaf = real[0];

    if (leaf.kind === 'special') {
      const entry = describeSpecial(leaf);
      out[key] = entry;
      kindCounts.special++;
      specialCounts[entry.special] = (specialCounts[entry.special] || 0) + 1;
      continue;
    }

    if (leaf.kind === 'unknown') {
      // e.g. minecraft:bundle/selected_item reached directly — a renderer that
      // needs a stack; treat as special so the runtime knows to delegate.
      const entry = { kind: 'special', special: leaf.type, params: {} };
      out[key] = entry;
      kindCounts.special++;
      specialCounts[entry.special] = (specialCounts[entry.special] || 0) + 1;
      continue;
    }

    if (leaf.kind === 'model') {
      let { entry, problem } = describeModelLoc(leaf.loc, leaf.tints);
      if (problem) warnings.push({ item: key, model: leaf.loc, problem });
      const ownEntry = entry; // what the requested location alone resolves to

      // Block item whose model location was not baked: substitute the
      // default-state model of the block (blocks.json -> states.json -> models.json).
      if (entry.kind === 'none' && item.block) {
        const fallbackIdx = blockStateFallback(item.block);
        if (fallbackIdx !== null && fallbackIdx < BAKED_COUNT) {
          entry = describeBlock(BAKED[fallbackIdx].loc, fallbackIdx, {
            fallback: true,
            ...(leaf.tints.length ? { tints: tintSources(leaf.tints) } : {}),
          });
          rememberModel(BAKED[fallbackIdx].loc, entry);
          fallbacks.push({
            item: key,
            reason: 'model-not-baked',
            from: leaf.loc,
            to: BAKED[fallbackIdx].loc,
            model: fallbackIdx,
          });
        }
      }

      if (entry.kind === 'flat') {
        if (!entry.layers.length) {
          entry = { kind: 'none', reason: 'no-layer0' };
          kindCounts.none++;
          missing.push({ item: key, reason: 'no-layer0', model: leaf.loc });
          out[key] = entry;
          continue;
        }
        for (const layer of entry.layers) {
          const set = layer.array === 'block' ? BLOCK_TEX : ITEM_TEX;
          if (!set.has(layer.texture)) {
            unresolvedLayers.push({ item: key, texture: layer.texture, array: layer.array });
          }
        }
      }

      // The models table keeps both the requested location (which resolved to
      // nothing / a missing bake) and the substituted one.
      rememberModel(leaf.loc, ownEntry);
      if (entry.kind === 'none') {
        kindCounts.none++;
        missing.push({ item: key, reason: entry.reason || 'no-geometry', model: leaf.loc });
      } else {
        kindCounts[entry.kind]++;
        rememberModel(leaf.loc, entry);
      }
      // `modelLoc` on a none entry is debug only, keep the payload minimal
      if (entry.kind === 'none') delete entry.modelLoc;
      out[key] = entry;
      continue;
    }
  }

  // ---- 4. composite: several leaves drawn on top of each other -----------
  // The selector tree kept more than one leaf, so the item is assembled from
  // several models. Bundles use this only when the bundle is open (their gui
  // case resolves to the closed model), so in practice this is the 16 beds:
  //   block/<color>_bed_head + block/<color>_bed_foot (translated by 1 block)
  // Two model indices cannot be expressed as `kind:"block"`, so the parts are
  // kept in draw order with their transformation and classified individually.
  const parts = real.map((leaf) => {
    let entry;
    if (leaf.kind === 'special') entry = describeSpecial(leaf);
    else if (leaf.kind === 'unknown') entry = { kind: 'special', special: leaf.type, params: {} };
    else entry = describeModelLoc(leaf.loc, leaf.tints).entry;
    // `transformation` on a selector node is a per-part model matrix (the bed
    // foot is translated 1 block). Keep it so a composite can be assembled.
    if (leaf.transformation) entry = { ...entry, transformation: leaf.transformation };
    return entry;
  });

  if (parts.every((p) => p.kind === 'none')) {
    out[key] = { kind: 'none', reason: 'composite-without-geometry' };
    kindCounts.none++;
    missing.push({ item: key, reason: 'composite-without-geometry' });
  } else {
    // Several parts. One model index cannot describe this, so the parts are
    // kept individually (in draw order) and the runtime draws them one by one.
    // In 26.2 this is only the 16 beds (head + foot, the foot translated).
    out[key] = {
      kind: 'composite',
      guiLight: parts.find((p) => p.guiLight)?.guiLight || 'front',
      parts,
    };
    kindCounts.composite++;
    warnings.push({ item: key, problem: 'composite-multi-part' });
  }
}

// ---------------------------------------------------------------------------
// Sanity pass on the finished table
// ---------------------------------------------------------------------------

const itemCount = Object.keys(out).length;
if (itemCount !== EXPECTED_ITEM_COUNT) {
  throw new Error(`built ${itemCount} entries, expected ${EXPECTED_ITEM_COUNT}`);
}
for (const name of assetItemFiles) {
  if (!itemNames.has(name)) warnings.push({ item: 'minecraft:' + name, problem: 'selector-without-item' });
}

// ---------------------------------------------------------------------------
// Write outputs
// ---------------------------------------------------------------------------

const itemmodels = { items: out, models: modelTable };
await fs.writeFile(path.join(OUT, 'itemmodels.json'), JSON.stringify(itemmodels) + '\n');

// --- statistics the renderer author will want ------------------------------
const stats = {
  flatLayers: { total: 0, item: 0, block: 0, tinted: 0, histogram: {} },
  guiLight: { front: 0, side: 0 },
  blockRefs: 0,
  compositeParts: 0,
  animatedLayers: [],
};
const animatedNames = new Set();
for (const [key, e] of Object.entries(out)) {
  if (e.kind === 'flat') {
    const hist = e.layers.length;
    stats.flatLayers.histogram[hist] = (stats.flatLayers.histogram[hist] || 0) + 1;
    for (const layer of e.layers) {
      stats.flatLayers.total++;
      stats.flatLayers[layer.array] = (stats.flatLayers[layer.array] || 0) + 1;
      if (layer.tint !== -1) stats.flatLayers.tinted++;
      // animated textures: block array -> tex/block.json.animated, item array -> tex/item.json.animated
      if (layer.array === 'block' && blockTex.animated?.[layer.texture]) animatedNames.add('block:' + layer.texture);
      if (layer.array === 'item' && itemTex.animated?.[layer.texture]) animatedNames.add('item:' + layer.texture);
    }
  }
  if (e.guiLight) stats.guiLight[e.guiLight] = (stats.guiLight[e.guiLight] || 0) + 1;
  if (e.kind === 'block') stats.blockRefs++;
  for (const part of e.parts || []) if (part.kind === 'block') stats.blockRefs++;
  if (e.kind === 'composite') stats.compositeParts += e.parts.length;
}
stats.animatedLayers = [...animatedNames].sort();

const meta = {
  generatedAt: new Date().toISOString(),
  counts: {
    items: itemCount,
    ...kindCounts,
    bakedModels: BAKED_COUNT,
    itemTexLayers: itemTex.layers,
    blockTexLayers: blockTex.layers,
    modelTableEntries: Object.keys(modelTable).length,
  },
  stats,
  specials: Object.fromEntries(Object.entries(specialCounts).sort((a, b) => b[1] - a[1])),
  // Every item that needed a substitute model (or a synthetic selector).
  fallbacks,
  // Every item that draws nothing at all.
  missing,
  // Flat layers whose texture name is not in the corresponding array.
  unresolvedLayers,
  warnings,
};
await fs.writeFile(path.join(OUT, 'itemmodels_meta.json'), JSON.stringify(meta, null, 1) + '\n');

// ---------------------------------------------------------------------------
// Summary
// ---------------------------------------------------------------------------

const stat = async (f) => (await fs.stat(path.join(OUT, f))).size;
const kb = (n) => (n / 1024).toFixed(1) + ' KiB';

console.log('itemmodels.json      ', kb(await stat('itemmodels.json')));
console.log('itemmodels_meta.json ', kb(await stat('itemmodels_meta.json')));
console.log('');
console.log(
  `items: ${itemCount}  (block ${kindCounts.block}, flat ${kindCounts.flat}, special ${kindCounts.special}, ` +
    `composite ${kindCounts.composite}, none ${kindCounts.none})`,
);
console.log('specials:', JSON.stringify(meta.specials));
console.log('guiLight:', JSON.stringify(stats.guiLight), ' flat layers:', JSON.stringify(stats.flatLayers));
console.log('animated layers in use:', stats.animatedLayers.join(', ') || '(none)');
console.log(`fallbacks: ${fallbacks.length}   missing: ${missing.length}   unresolved layers: ${unresolvedLayers.length}   warnings: ${warnings.length}`);
