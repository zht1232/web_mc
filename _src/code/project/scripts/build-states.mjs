// Builds public/mc/states.json: every vanilla 26.2 blockstate, baked through
// the ported pipeline in vanmodel.mjs. Run with `npm run states`.
import fs from 'node:fs/promises';
import path from 'node:path';
import { existsSync } from 'node:fs';
import {
  ModelSource, bakeModel, bakeElements, makeModelState, IDENTITY_STATE, quadrant,
  GROUPS, DIRECTIONS, DIR_NORMAL, defaultFaceUV, nearestDirection, transformDirection,
  groupRotateDir,
} from './vanmodel.mjs';
import { packModels, decodeStates, POS_SCALE, UV_SCALE } from './statepack.mjs';

const SRC = process.env.MC_ASSETS || 'G:/ck-web26/vanilla/assets/minecraft';
const OUT = path.resolve('public/mc');

// Expected totals, measured in research/blockstate-inventory.json. If a change
// to the loader moves any of these, a parsing or inheritance rule broke.
const EXPECT = {
  blockstate_files: 1198,
  variant_files: 1096,
  multipart_files: 102,
  variant_keys: 7296,
  variant_objects: 7476,
  multipart_entries: 1132,
  face_texture_closure: 1230,
};

// ---------------------------------------------------------------------------
// self tests for the ported maths (no data files involved)
// ---------------------------------------------------------------------------
function selfTest() {
  const fails = [];
  const check = (name, ok, detail) => { if (!ok) fails.push(name + (detail ? ' — ' + detail : '')); };

  check('group size', GROUPS.length === 48, String(GROUPS.length));
  // closure: composing any two groups must resolve to one of the 48
  let closureOk = true;
  for (const a of GROUPS) {
    for (const b of GROUPS) {
      const perm = [a.p[b.p[0]], a.p[b.p[1]], a.p[b.p[2]]];
      const inv = [0, 1, 2].map(i => (a.invert[i] ? 1 : 0) ^ (a.p[i] === 0 ? b.invert[0] : a.p[i] === 1 ? b.invert[1] : b.invert[2]));
      if (!GROUPS.some(g => g.invert.every((v, i) => v === !!inv[i]) && perm.every((v, i) => g.p[i] === v))) closureOk = false;
    }
  }
  check('cayley closure', closureOk);

  // A pure 90-degree model rotation must map axis normals exactly.
  for (const deg of [90, 180, 270]) {
    const st = makeModelState({ y: quadrant(deg) });
    const south = nearestDirection(transformDirection(st.transformation, [0, 0, 1]));
    check(`y${deg} keeps south horizontal`, south !== 0 && south !== 1, DIRECTIONS[south]);
    const up = nearestDirection(transformDirection(st.transformation, [0, 1, 0]));
    check(`y${deg} keeps up as up`, up === 1, DIRECTIONS[up]);
  }
  // x=90 tips south down or up, never sideways
  const xs = makeModelState({ x: quadrant(90) });
  const southAfterX = nearestDirection(transformDirection(xs.transformation, [0, 0, 1]));
  check('x90 moves south off the z axis', southAfterX === 0 || southAfterX === 1, DIRECTIONS[southAfterX]);

  // Two independent Java paths must agree: OctahedralGroup.rotate(Direction)
  // (permutation table) vs Direction.rotate(Matrix4fc, facing) (matrix path).
  // A transpose/inverse bug in the ported matrices shows up here.
  let crossFails = 0;
  for (const g of GROUPS) {
    for (let d = 0; d < 6; d++) {
      const viaTable = groupRotateDir(g, d);
      const viaMatrix = nearestDirection(transformDirection(g.matrix, [DIR_NORMAL[d][0], DIR_NORMAL[d][1], DIR_NORMAL[d][2]]));
      if (viaTable !== viaMatrix) crossFails++;
    }
  }
  check('group table matches matrices on all 48x6', crossFails === 0, crossFails + ' mismatches');

  // uv rotation is a pure index cycle (CuboidFace.getU/V + Quadrant.shift):
  // vertex 0 of a face rotated 90 must take the (minU, maxV) corner.
  const faceUv = rot => {
    const el = {
      from: [0, 0, 0], to: [16, 16, 16],
      faces: { south: { texture: '#all', uvs: [0, 0, 16, 16], rotation: rot, cullface: null, tintindex: -1 } },
      rotation: null, shade: true, lightEmission: 0,
    };
    const [q] = bakeElements([el], IDENTITY_STATE, () => 'block/dirt');
    return q.uv;
  };
  const r90 = faceUv(quadrant(90));
  check('uv rotation 90 vertex0 = (minU,maxV)', r90[0] === 0 && r90[1] === 16, JSON.stringify(r90));
  const r270 = faceUv(quadrant(270));
  check('uv rotation 270 vertex0 = (maxU,minV)', r270[0] === 16 && r270[1] === 0, JSON.stringify(r270));
  const r0 = faceUv(0);
  check('uv rotation 0 vertex0 = (minU,minV)', r0[0] === 0 && r0[1] === 0, JSON.stringify(r0));

  // uvlock rotates the UVs along with the model; without it only vertices move.
  // Needs an asymmetric face rect: a full [0,16] square is rotation-invariant.
  const cubeFaces = () => {
    const faces = {};
    for (const d of DIRECTIONS) faces[d] = { texture: '#all', uvs: [1, 0, 15, 16], rotation: 0, cullface: d, tintindex: -1 };
    return [{ from: [0, 0, 0], to: [16, 16, 16], faces, rotation: null, shade: true, lightEmission: 0 }];
  };
  const y90 = makeModelState({ y: quadrant(90) });
  const y90Lock = makeModelState({ y: quadrant(90), uvLock: true });
  const plain = bakeElements(cubeFaces(), y90, () => 'block/dirt');
  const locked = bakeElements(cubeFaces(), y90Lock, () => 'block/dirt');
  check('model rotation bakes 6 quads', plain.length === 6, String(plain.length));
  check('cullface follows rotation', plain.every(q => q.c >= 0));
  check('all six final facings present', new Set(plain.map(q => q.d)).size === 6, plain.map(q => DIRECTIONS[q.d]).join(','));
  check('uvlock leaves vertices alone', plain.every((q, i) => q.p.join() === locked[i].p.join()));
  check('uvlock rotates face uvs', plain.some((q, i) => q.uv.join() !== locked[i].uv.join()));
  check('geometry stays in unit block', plain.every(q => q.p.every(v => v >= -1e-6 && v <= 1 + 1e-6)));

  // zero-thickness elements drop the faces perpendicular to that axis
  const thin = bakeElements([{
    from: [8, 0, 0], to: [8, 16, 16],
    faces: Object.fromEntries(DIRECTIONS.map(d => [d, { texture: '#all', uvs: null, rotation: 0, cullface: null, tintindex: -1 }])),
    rotation: null, shade: true, lightEmission: 0,
  }], IDENTITY_STATE, () => 'block/dirt');
  check('zero-thickness keeps only its own axis faces', thin.length === 2, String(thin.length));

  // default UVs are the literal FaceBakery table
  check('down autoUV', defaultFaceUV([0, 0, 0], [16, 16, 16], 0).join() === '0,0,16,16');
  check('north autoUV', defaultFaceUV([0, 0, 0], [16, 16, 16], 2).join() === '0,0,16,16');

  if (fails.length) {
    console.error('SELF TEST FAILED:\n  ' + fails.join('\n  '));
    process.exit(1);
  }
  console.log('selfTest: ok (' + GROUPS.length + ' groups, ' + DIRECTIONS.length + ' facings)');
}

// ---------------------------------------------------------------------------
// blockstate parsing
// ---------------------------------------------------------------------------
function parseVariantObj(obj, where) {
  if (typeof obj === 'string') obj = { model: obj };
  const state = {
    x: obj.x === undefined ? 0 : quadrant(Number(obj.x)),
    y: obj.y === undefined ? 0 : quadrant(Number(obj.y)),
    z: obj.z === undefined ? 0 : quadrant(Number(obj.z)),
    uvLock: obj.uvlock === true,
  };
  if (!obj.model) throw new Error('variant without model: ' + where);
  return {
    model: obj.model,
    state,
    weight: obj.weight === undefined ? 1 : Number(obj.weight),
  };
}

// client/renderer/block/dispatch/multipart/Condition.java
// Shape: {leaf:[{prop,values:[{value,negate}]}]} | {all:[...]} | {any:[...]}
function normalizeCondition(node, where) {
  if (node === undefined || node === null) return { leaf: [] };
  if (Array.isArray(node)) throw new Error('unexpected condition array at top of ' + where);
  const keys = Object.keys(node);
  if (keys.length === 1 && (keys[0] === 'AND' || keys[0] === 'OR')) {
    const items = node[keys[0]].map(x => normalizeCondition(x, where));
    return keys[0] === 'AND' ? { all: items } : { any: items };
  }
  const leaf = [];
  for (const [key, value] of Object.entries(node)) {
    if (value && typeof value === 'object') throw new Error(`nested condition under property ${key} in ${where}`);
    leaf.push({
      prop: key,
      values: String(value).split('|').map(p => ({
        value: p.startsWith('!') ? p.slice(1) : p,
        negate: p.startsWith('!'),
      })),
    });
  }
  return { leaf };
}

function collectProps(node, props) {
  for (const t of node.leaf || []) {
    if (!props[t.prop]) props[t.prop] = new Set();
    for (const v of t.values) props[t.prop].add(v.value);
  }
  for (const child of node.all || []) collectProps(child, props);
  for (const child of node.any || []) collectProps(child, props);
}

async function verifyPacked(models, textures) {
  const buffer = await fs.readFile(path.join(OUT, 'states.bin'));
  const dec = decodeStates(buffer, textures);
  const fails = [];
  if (dec.modelCount !== models.length) fails.push(`modelCount ${dec.modelCount} != ${models.length}`);
  let checked = 0;
  for (let i = 0; i < models.length && fails.length < 8; i++) {
    const src = models[i];
    const got = dec.model(i);
    if (got.quads.length !== src.quads.length) { fails.push(`model ${i} quad count`); continue; }
    if (got.ao !== !!src.ao || got.guiLight !== src.guiLight || got.noGeometry !== !!src.noGeometry) {
      fails.push(`model ${i} (${src.location}) flags`);
      continue;
    }
    for (let k = 0; k < src.quads.length; k++) {
      const a = src.quads[k], b = got.quads[k];
      const tol = 1 / POS_SCALE + 1e-9, uvTol = 1 / UV_SCALE + 1e-9;
      for (let c = 0; c < 12; c++) if (Math.abs(a.p[c] - b.p[c]) > tol) fails.push(`model ${i} quad ${k} pos[${c}]`);
      for (let c = 0; c < 8; c++) if (Math.abs(a.uv[c] - b.uv[c]) > uvTol) fails.push(`model ${i} quad ${k} uv[${c}]`);
      if (a.d !== b.d || a.c !== b.c || a.ti !== b.ti || a.le !== b.le || a.s !== b.s || a.tr !== b.tr || a.t !== b.t) {
        fails.push(`model ${i} quad ${k} meta`);
      }
      checked++;
      if (fails.length > 8) break;
    }
  }
  if (fails.length) {
    console.error('PACK VERIFY FAILED:\n  ' + fails.slice(0, 10).join('\n  '));
    process.exit(1);
  }
  console.log(`pack verify: ok (${dec.modelCount} models, ${checked} quads round-tripped)`);
}
async function main() {
  selfTest();
  if (!existsSync(SRC)) throw new Error('MC assets not found: ' + SRC);

  const source = new ModelSource(SRC);
  const bsDir = path.join(SRC, 'blockstates');
  const files = [];
  const walk = async dir => {
    for (const entry of await fs.readdir(dir, { withFileTypes: true })) {
      const full = path.join(dir, entry.name);
      if (entry.isDirectory()) await walk(full);
      else if (entry.name.endsWith('.json')) files.push(full);
    }
  };
  await walk(bsDir);
  files.sort();

  const modelPool = new Map(); // dedupe key -> baked model index
  const models = [];
  const stats = {
    blockstate_files: files.length, variant_files: 0, multipart_files: 0,
    variant_keys: 0, variant_objects: 0, multipart_entries: 0,
  };
  const blocks = {};
  const textureUse = new Map();

  async function modelIndex(entry) {
    const key = `${entry.model}|${entry.state.x}|${entry.state.y}|${entry.state.z}|${entry.state.uvLock ? 1 : 0}`;
    const cached = modelPool.get(key);
    if (cached !== undefined) return cached;
    const state = makeModelState(entry.state);
    const baked = await bakeModel(source, entry.model, state);
    baked.location = entry.model;
    baked.state = entry.state;
    for (const q of baked.quads) {
      textureUse.set(q.t, (textureUse.get(q.t) || 0) + 1);
    }
    const idx = models.length;
    models.push(baked);
    modelPool.set(key, idx);
    return idx;
  }

  for (const file of files) {
    const name = path.basename(file, '.json');
    const bs = JSON.parse(await fs.readFile(file, 'utf8'));
    const props = {};

    if (bs.variants) {
      stats.variant_files++;
      const variants = {};
      for (const [key, raw] of Object.entries(bs.variants)) {
        stats.variant_keys++;
        const list = (Array.isArray(raw) ? raw : [raw]).map(o => parseVariantObj(o, name + '/' + key));
        stats.variant_objects += list.length;
        const entries = [];
        for (const v of list) {
          entries.push({ m: await modelIndex(v), w: v.weight });
        }
        variants[key] = entries;
        if (key) {
          for (const part of key.split(',')) {
            const eq = part.indexOf('=');
            const p = part.slice(0, eq), val = part.slice(eq + 1);
            if (!props[p]) props[p] = new Set();
            props[p].add(val);
          }
        }
      }
      blocks[name] = { kind: 'variant', props: propTable(props), variants };
    } else if (bs.multipart) {
      stats.multipart_files++;
      const parts = [];
      for (const sel of bs.multipart) {
        stats.multipart_entries++;
        const cond = normalizeCondition(sel.when, name);
        collectProps(cond, props);
        const list = (Array.isArray(sel.apply) ? sel.apply : [sel.apply]);
        const entries = [];
        for (const a of list) entries.push({ m: await modelIndex(parseVariantObj(a, name + '/multipart')), w: a.weight ?? 1 });
        parts.push({ c: cond, a: entries });
      }
      blocks[name] = { kind: 'multipart', props: propTable(props), parts };
    } else {
      throw new Error(`${name}: neither variants nor multipart`);
    }
  }

  function propTable(props) {
    const out = {};
    for (const [k, v] of Object.entries(props)) out[k] = [...v].sort();
    return out;
  }

  // ---- assertions against the measured inventory ----
  const faceTextures = [...textureUse.keys()].filter(t => t !== 'missingno');
  const got = { ...stats, face_texture_closure: faceTextures.length };
  const mismatches = Object.entries(EXPECT).filter(([k, v]) => got[k] !== v).map(([k, v]) => `${k}: expected ${v}, got ${got[k]}`);
  if (mismatches.length) {
    console.error('ASSERTION FAILED\n  ' + mismatches.join('\n  '));
    process.exit(1);
  }

  const noGeometry = models.filter(m => m.noGeometry).map(m => m.location);
  const unresolved = source.warnings.length;

  await fs.mkdir(OUT, { recursive: true });
  const textures = faceTextures.sort();
  const texIndex = new Map(textures.map((t, i) => [t, i]));
  const packed = packModels(models, textures, texIndex);
  await fs.writeFile(path.join(OUT, 'states.bin'), packed.buffer);

  const outDoc = {
    generatedAt: new Date().toISOString(),
    counts: { ...got, total_quads: packed.quadCount, baked_models: models.length },
    bin: { file: 'states.bin', bytes: packed.buffer.byteLength, posScale: POS_SCALE, uvScale: UV_SCALE },
    textures,
    noGeometry: [...new Set(noGeometry)].sort(),
    models: models.map(m => ({
      loc: m.location,
      st: m.state,
      ao: m.ao,
      gl: m.guiLight,
      ng: m.noGeometry || undefined,
    })),
    blocks,
  };
  const json = JSON.stringify(outDoc);
  await fs.writeFile(path.join(OUT, 'states.json'), json);

  await verifyPacked(models, textures);

  console.log('blockstates:', got.blockstate_files, '(variant', got.variant_files, '+ multipart', got.multipart_files + ')');
  console.log('variant keys:', got.variant_keys, 'objects:', got.variant_objects, 'multipart entries:', got.multipart_entries);
  console.log('baked model pool:', models.length, '| total quads:', packed.quadCount,
    '| no-geometry models:', outDoc.noGeometry.length);
  console.log('states.bin:', (packed.buffer.byteLength / 1048576).toFixed(2), 'MB | states.json:', (json.length / 1048576).toFixed(2), 'MB');
  console.log('face textures:', textures.length, '| missing-texture slots:', source.missingTextures.size, '| unresolved refs:', unresolved);
  console.log('states.json:', (JSON.stringify(outDoc).length / 1048576).toFixed(2), 'MB');
  if (source.missingTextures.size) {
    console.log('sample missing slots:', [...source.missingTextures].slice(0, 12).join(', '));
  }
}

main().catch(err => { console.error(err); process.exit(1); });
