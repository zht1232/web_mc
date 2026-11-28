#!/usr/bin/env node
/**
 * build-display.mjs — bake the item display transforms used by the 3D item passes.
 *
 *   input : public/mc/itemmodels.json            (item -> model location, built by build-itemmodels.mjs)
 *           <vanilla>/assets/minecraft/models/**  (model JSON, parent chains + "display")
 *   output: public/mc/hand/display.json          (model location -> firstperson_righthand + ground)
 *
 * Run: node scripts/build-display.mjs
 * Idempotent, Node built-ins only, never writes outside public/mc/hand.
 *
 * Source of truth (26.2):
 *   net/minecraft/client/resources/model/ResolvedModel.findTopTransform
 *     -> walks the parent chain from the item model upwards and returns the first
 *        ItemTransforms that defines the requested ItemDisplayContext.
 *   net/minecraft/client/resources/model/cuboid/ItemTransform.apply
 *     -> pose.translate(translation); rotate(rotationXYZ); scale(scale); translate(-0.5F, -0.5F, -0.5F)
 *   net/minecraft/client/resources/model/cuboid/ItemTransform.Deserializer
 *     -> translation is multiplied by 0.0625 (1/16 block) when the JSON is parsed.
 *
 * The stored numbers are the raw JSON values (translation still in 1/16 block units), so the
 * renderer applies the same 0.0625 scaling and can be checked 1:1 against the JSON.
 */

import fs from 'node:fs/promises';
import { existsSync, readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(HERE, '..');
const OUT_DIR = path.join(ROOT, 'public', 'mc', 'hand');
const OUT = path.join(OUT_DIR, 'display.json');

// Same vanilla source tree build-itemmodels.mjs reads.
const VANILLA = path.resolve(ROOT, '..', '_src', 'thirdparty', 'thirdparty', 'src-vanilla', 'assets', 'minecraft');
const MODELS_DIR = path.join(VANILLA, 'models');

const unNs = (s) => String(s).replace(/^minecraft:/, '');
const modelLoc = (s) => 'minecraft:' + unNs(s);

const modelsDoc = JSON.parse(readFileSync(path.join(ROOT, 'public', 'mc', 'itemmodels.json'), 'utf8'));

/** Every model location an item can draw, in item order (blocks + flat sprites). */
const wanted = new Set();
const addEntry = (e) => {
  if (!e || typeof e !== 'object') return;
  if (e.modelLoc) wanted.add(e.modelLoc);
  for (const part of e.parts || []) addEntry(part);
};
for (const entry of Object.values(modelsDoc.items)) addEntry(entry);

const cache = new Map(); // loc -> json|null
function load(loc) {
  if (cache.has(loc)) return cache.get(loc);
  const p = path.join(MODELS_DIR, unNs(loc) + '.json');
  const json = existsSync(p) ? JSON.parse(readFileSync(p, 'utf8')) : null;
  cache.set(loc, json);
  return json;
}

/** ResolvedModel.findTopTransform for one display context. */
function findTopTransform(loc, context) {
  const seen = new Set();
  let cur = loc;
  while (cur && !seen.has(cur)) {
    seen.add(cur);
    const json = load(cur);
    if (!json) return null;
    const t = json.display && json.display[context];
    if (t) {
      return {
        rotation: Array.isArray(t.rotation) ? t.rotation : [0, 0, 0],
        translation: Array.isArray(t.translation) ? t.translation : [0, 0, 0],
        scale: Array.isArray(t.scale) ? t.scale : [1, 1, 1],
        from: cur,
      };
    }
    if (!json.parent) return null;
    const parent = unNs(json.parent);
    if (parent.startsWith('builtin/')) return null;
    cur = modelLoc(parent);
  }
  return null;
}

const firstPersonRightHand = (loc) => findTopTransform(loc, 'firstperson_righthand');
const groundTransform = (loc) => findTopTransform(loc, 'ground');

const out = {};
const grounds = {};
let missing = 0;
let inherited = 0;
for (const loc of [...wanted].sort()) {
  const t = firstPersonRightHand(loc);
  if (!t) { missing++; } else {
    if (t.from !== loc) inherited++;
    out[loc] = { rotation: t.rotation, translation: t.translation, scale: t.scale };
  }
  // GROUND context: ItemEntityRenderer / EntityRenderDispatcher.drawItem uses it for drops.
  // Models with no ground transform in the chain fall back to ItemTransform.NO_TRANSFORM,
  // which the renderer applies as the bare translate(-0.5, -0.5, -0.5).
  const g = groundTransform(loc);
  if (g) grounds[loc] = { rotation: g.rotation, translation: g.translation, scale: g.scale };
}

// build-itemmodels.mjs substitutes unbaked "<block>_inventory" item models with a blockstate
// model (walls / fences / ...). That substituted model has its own parent chain and usually no
// display, while vanilla draws the *inventory* model (which inherits block/block's pose).
// Recover the correct pose from the original model location and key it by the substituted one.
const metaPath = path.join(ROOT, 'public', 'mc', 'itemmodels_meta.json');
let recovered = 0;
if (existsSync(metaPath)) {
  const meta = JSON.parse(readFileSync(metaPath, 'utf8'));
  for (const fb of meta.fallbacks || []) {
    if (!fb.from || !fb.to || out[fb.to]) continue;
    const t = firstPersonRightHand(fb.from);
    if (!t) continue;
    out[fb.to] = { rotation: t.rotation, translation: t.translation, scale: t.scale };
    recovered++;
  }
}

// The literal ItemTransform.NO_TRANSFORM branch: translate(-0.5,-0.5,-0.5) only.
// Models with no display chain at all still draw (rendered at the item origin).
await fs.mkdir(OUT_DIR, { recursive: true });
const doc = {
  generatedAt: new Date().toISOString(),
  source: 'net/minecraft/client/resources/model/cuboid/ItemTransform.java',
  context: 'firstperson_righthand',
  note: 'translation is the raw JSON value, in 1/16 block units (ItemTransform.Deserializer * 0.0625)',
  count: Object.keys(out).length,
  transforms: out,
  groundCount: Object.keys(grounds).length,
  grounds,
};
await fs.writeFile(OUT, JSON.stringify(doc, null, 1) + '\n');

console.log(`model locations: ${wanted.size}  resolved: ${Object.keys(out).length}  from parent: ${inherited}  none: ${missing}`);
console.log(`ground transforms: ${Object.keys(grounds).length}`);
console.log(`wrote ${path.relative(ROOT, OUT)} (${(await fs.stat(OUT)).size} bytes)`);
