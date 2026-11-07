#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""Read-only inventory of vanilla Minecraft 26.2 blockstate/model data for webcraft26.

    python research/inventory.py

Writes (only inside research/):
    blockstate-inventory.json  machine-readable summary (the deliverable)
    _inventory_dump.txt        console log with every measured number
    _multipart_complex.json    full condition trees of the 3 most complex multipart files
Nothing under src/, scripts/, public/ is read-modified; everything else is read-only.
"""
import json, os, re, glob
from collections import Counter, defaultdict
from fractions import Fraction

ROOT = "G:/ck-web26/vanilla/assets/minecraft"
BS_DIR = os.path.join(ROOT, "blockstates")
MB_DIR = os.path.join(ROOT, "models", "block")
MI_DIR = os.path.join(ROOT, "models", "item")
TX_DIR = os.path.join(ROOT, "textures")
SRCV = "G:/ck-web26/src-vanilla"
PROJ = "C:/Users/zht/Documents/Qoder/2026-11-01/4194ac07/webcraft26"
OUT_DIR = os.path.dirname(os.path.abspath(__file__))

FACE_DIRS = ("down", "up", "north", "south", "west", "east")
DYE = ["white", "orange", "magenta", "light_blue", "yellow", "lime", "pink", "gray",
       "light_gray", "cyan", "purple", "blue", "brown", "green", "red", "black"]
COPPER_PREFIX = ["", "exposed_", "weathered_", "oxidized_",
                 "waxed_", "waxed_exposed_", "waxed_weathered_", "waxed_oxidized_"]

_lines = []


def log(*a):
    s = " ".join(str(x) for x in a)
    _lines.append(s)


def load(path):
    with open(path, "r", encoding="utf-8") as f:
        return json.load(f)


def strip_ns(s):
    return re.sub(r"^minecraft:", "", s)


# ============================================================ 1. BLOCKSTATES
bs_files = sorted(glob.glob(os.path.join(BS_DIR, "*.json")))
bs = {}                      # block name -> parsed json
for fp in bs_files:
    n = os.path.splitext(os.path.basename(fp))[0]
    bs[n] = load(fp)

variant_files, multipart_files, other_files = [], [], []
for n, d in bs.items():
    if "variants" in d and "multipart" not in d:
        variant_files.append(n)
    elif "multipart" in d and "variants" not in d:
        multipart_files.append(n)
    else:
        other_files.append(n)

log("blockstate files total:", len(bs))
log("variant:", len(variant_files), "multipart:", len(multipart_files), "other:", len(other_files), other_files[:5])

prop_files = defaultdict(set)          # prop -> files (variant form)
prop_value = defaultdict(lambda: defaultdict(set))   # prop -> value -> files
prop_value_occ = defaultdict(Counter)  # prop -> value -> occurrences
key_total = 0
key_re_full = re.compile(r"^[a-z0-9_]+=[A-Za-z0-9_.\-]+$")
key_bad_format = []
key_nonalpha = []
key_dup_prop = []
empty_key_files = set()
mixed_specificity_files = []           # files whose keys do not all carry the same prop set
keys_with_pipe = []
propset_files = defaultdict(list)
keycount_hist = Counter()
propcount_hist = Counter()
variant_obj_total = 0
v_fields = Counter()
v_x, v_y, v_z = Counter(), Counter(), Counter()
v_uvlock = Counter()
v_weight = Counter()
weighted_files = []
random_files = defaultdict(list)       # file -> [(key, listlen)]
list_len_hist = Counter()
same_model_list = []
model_refs = set()
model_ref_not_found = []
model_prefix_hist = Counter()

for n in variant_files:
    variants = bs[n]["variants"]
    if not isinstance(variants, dict):
        other_files.append(n + "(variants not object)")
        continue
    key_total += len(variants)
    keycount_hist[len(variants)] += 1
    key_propsets = set()
    for key, val in variants.items():
        if key == "":
            empty_key_files.add(n)
            key_propsets.add(())
            continue
        parts = key.split(",")
        names = []
        for p in parts:
            if "=" not in p or not key_re_full.match(p):
                key_bad_format.append((n, key, p))
            k, _, v = p.partition("=")
            names.append(k)
            prop_files[k].add(n)
            prop_value[k][v].add(n)
            prop_value_occ[k][v] += 1
            if "|" in v:
                keys_with_pipe.append((n, key))
        if names != sorted(names):
            key_nonalpha.append((n, key))
        if len(names) != len(set(names)):
            key_dup_prop.append((n, key))
        key_propsets.add(tuple(sorted(names)))
    if len(key_propsets) > 1:
        mixed_specificity_files.append((n, sorted(key_propsets)))
    ps = tuple(sorted(set(x for ks in key_propsets for x in ks)))
    propset_files[ps].append(n)
    propcount_hist[len(ps)] += 1
    for key, val in variants.items():
        objs = val if isinstance(val, list) else [val]
        if isinstance(val, list):
            random_files[n].append((key, len(val)))
            list_len_hist[len(val)] += 1
            if len(set(o.get("model") for o in objs if isinstance(o, dict))) < len(objs):
                same_model_list.append((n, key, len(objs)))
        for o in objs:
            if not isinstance(o, dict):
                key_bad_format.append((n, key, "value-not-object"))
                continue
            variant_obj_total += 1
            for f in o:
                v_fields[f] += 1
            if "x" in o:
                v_x[o["x"]] += 1
            if "y" in o:
                v_y[o["y"]] += 1
            if "z" in o:
                v_z[o["z"]] += 1
            if "uvlock" in o:
                v_uvlock[str(o["uvlock"])] += 1
            if "weight" in o:
                v_weight[str(o["weight"])] += 1
                weighted_files.append((n, key, o["weight"]))
            m = o.get("model")
            if isinstance(m, str):
                mk = strip_ns(m)
                model_refs.add(mk)
                model_prefix_hist[mk.split("/")[0]] += 1
                if not os.path.exists(os.path.join(ROOT, "models", mk + ".json")):
                    model_ref_not_found.append((n, m))

log("variant keys total:", key_total, " variant objects:", variant_obj_total)
log("keys not alphabetical:", len(key_nonalpha), key_nonalpha[:3])
log("keys bad format:", len(key_bad_format), key_bad_format[:3])
log("keys with duplicated property:", len(key_dup_prop))
log("keys with '|' in value:", len(keys_with_pipe), keys_with_pipe[:3])
log("files with empty key:", len(empty_key_files))
log("files with mixed key specificity:", len(mixed_specificity_files), mixed_specificity_files[:4])
log("variant fields:", dict(v_fields.most_common()))
log("x values:", dict(v_x), "y values:", dict(v_y), "z values:", dict(v_z))
log("uvlock:", dict(v_uvlock), "weight:", dict(v_weight))
log("random(list) variant keys:", sum(len(v) for v in random_files.values()), "in", len(random_files), "files")
log("list length hist:", dict(list_len_hist), "same-model lists:", len(same_model_list))
log("model ref prefixes:", dict(model_prefix_hist), "missing model files:", len(model_ref_not_found))

# ---- multipart
mp_entries_total = 0
mp_ops = Counter()
mp_op_files = defaultdict(set)
mp_depth_hist = Counter()
mp_when_root_type = Counter()
mp_leaf_value_forms = Counter()      # str / str-with-pipe / str-with-bang / list / number
mp_leaf_prop_values = defaultdict(Counter)
mp_apply_is_list = []
mp_apply_fields = Counter()
mp_apply_x, mp_apply_y, mp_apply_weight = Counter(), Counter(), Counter()
mp_uvlock_entries = 0
mp_prop_occ = Counter()
mp_prop_files = defaultdict(set)
mp_no_when = 0
mp_node_counter = Counter()
mp_shapes = defaultdict(list)        # frozenset of condition props -> files
mp_anomaly = []


def walk(cond, depth, acc, fname):
    """Mimic Condition.CODEC: either {AND|OR: [..]} or {prop: terms} dict."""
    acc["nodes"] += 1
    acc["depth"] = max(acc["depth"], depth)
    if isinstance(cond, list):                      # not produced by the codec; record
        mp_anomaly.append((fname, "bare list condition", depth))
        for sub in cond:
            walk(sub, depth + 1, acc, fname)
        return
    if not isinstance(cond, dict):
        mp_anomaly.append((fname, "condition not object: " + type(cond).__name__, depth))
        return
    if len(cond) == 1 and next(iter(cond)) in ("AND", "OR", "INVERT", "condition"):
        op = next(iter(cond))
        if op in ("INVERT", "condition"):
            mp_anomaly.append((fname, "operator " + op, depth))
        mp_ops[op] += 1
        mp_op_files[op].add(fname)
        terms = cond[op]
        if isinstance(terms, list):
            for sub in terms:
                walk(sub, depth + 1, acc, fname)
        else:
            walk(terms, depth + 1, acc, fname)
        return
    if any(k in ("AND", "OR", "INVERT") for k in cond):
        mp_anomaly.append((fname, "mixed combiner+property keys", list(cond)[:4]))
    # KeyValueCondition: implicit AND over its keys
    for k, v in cond.items():
        mp_prop_occ[k] += 1
        mp_prop_files[k].add(fname)
        acc["props"].append(k)
        if isinstance(v, list):
            mp_leaf_value_forms["json-list"] += 1
            for item in v:
                mp_leaf_prop_values[k][str(item)] += 1
        elif isinstance(v, str):
            if "|" in v:
                mp_leaf_value_forms["string-with-|"] += 1
            if v.startswith("!") or "!" in v:
                mp_leaf_value_forms["string-with-!"] += 1
            if not "|" in v and "!" not in v:
                mp_leaf_value_forms["plain string"] += 1
            for tok in v.split("|"):
                mp_leaf_prop_values[k][tok] += 1
        else:
            mp_leaf_value_forms[type(v).__name__] += 1
            mp_leaf_prop_values[k][str(v)] += 1


def collect_apply(apply, fname, acc):
    items = apply if isinstance(apply, list) else [apply]
    if isinstance(apply, list):
        mp_apply_is_list.append((fname, len(items)))
    for it in items:
        if not isinstance(it, dict) or "model" not in it:
            mp_anomaly.append((fname, "bad apply", json.dumps(it)[:60]))
            continue
        mk = strip_ns(it["model"])
        model_refs.add(mk)
        model_prefix_hist[mk.split("/")[0]] += 1
        if not os.path.exists(os.path.join(ROOT, "models", mk + ".json")):
            model_ref_not_found.append((fname, it["model"]))
        for f in it:
            mp_apply_fields[f] += 1
        if "x" in it:
            mp_apply_x[it["x"]] += 1
        if "y" in it:
            mp_apply_y[it["y"]] += 1
        if "weight" in it:
            mp_apply_weight[it["weight"]] += 1
        if "uvlock" in it:
            acc["uvlock"] += 1


for n in multipart_files:
    entries = bs[n]["multipart"]
    mp_entries_total += len(entries)
    acc = {"nodes": 0, "depth": 0, "props": [], "uvlock": 0}
    allprops = set()
    for e in entries:
        if "when" in e:
            w = e["when"]
            mp_when_root_type[type(w).__name__] += 1
            before = list(acc["props"])
            walk(w, 1, acc, n)
            allprops |= set(acc["props"][len(before):])
        else:
            mp_no_when += 1
        if "apply" in e:
            collect_apply(e["apply"], n, acc)
        else:
            mp_anomaly.append((n, "entry without apply", ""))
    mp_depth_hist[acc["depth"]] += 1
    mp_node_counter[n] = acc["nodes"]
    mp_uvlock_entries += acc["uvlock"]
    mp_shapes[tuple(sorted(allprops))].append(n)

log("multipart entries:", mp_entries_total, "entries without 'when':", mp_no_when)
log("operators:", dict(mp_ops), "operator files:", {k: len(v) for k, v in mp_op_files.items()})
log("depth hist:", dict(sorted(mp_depth_hist.items())), "when root types:", dict(mp_when_root_type))
log("leaf value forms:", dict(mp_leaf_value_forms))
log("apply fields:", dict(mp_apply_fields.most_common()))
log("apply x:", dict(mp_apply_x), "apply y:", dict(mp_apply_y), "apply weight:", dict(mp_apply_weight))
log("apply-as-list files:", len(mp_apply_is_list), sorted(mp_apply_is_list)[:6])
log("uvlock entries:", mp_uvlock_entries)
log("anomalies:", len(mp_anomaly), mp_anomaly[:6])
log("distinct multipart condition props:", len(mp_prop_occ))

most_complex = sorted(mp_node_counter.items(), key=lambda kv: -kv[1])
log("most complex multipart:", most_complex[:6])
with open(os.path.join(OUT_DIR, "_multipart_complex.json"), "w", encoding="utf-8") as f:
    json.dump({n: bs[n] for n, _ in most_complex[:3]}, f, ensure_ascii=False, indent=1)

# ============================================================ 2. MODELS
mb_files = sorted(glob.glob(os.path.join(MB_DIR, "*.json")))
mi_files = sorted(glob.glob(os.path.join(MI_DIR, "*.json")))
log("block models:", len(mb_files), "item models:", len(mi_files))

M = {}        # 'block/foo' -> json
BROKEN = []


def add(key, path):
    try:
        M[key] = load(path)
    except Exception as e:
        BROKEN.append((key, str(e)))


for fp in mb_files:
    add("block/" + os.path.splitext(os.path.basename(fp))[0], fp)
for fp in mi_files:
    add("item/" + os.path.splitext(os.path.basename(fp))[0], fp)

parent_edge = {}
for k, m in M.items():
    p = m.get("parent")
    if isinstance(p, str):
        parent_edge[k] = strip_ns(re.sub(r"^models/", "", p))
parent_children = defaultdict(list)
for c, p in parent_edge.items():
    parent_children[p].append(c)


def chain(key, limit=64):
    out, seen, cur = [], {key}, parent_edge.get(key)
    while cur and cur not in seen and len(out) < limit:
        seen.add(cur)
        out.append(cur)
        cur = parent_edge.get(cur)
    return out, (cur in seen if cur else False)


depth_hist = Counter()
cycle_keys = set()
maxd = (0, None)
for k in parent_edge:
    ch, cyc = chain(k)
    if cyc:
        cycle_keys.add(k)
    depth_hist[len(ch)] += 1
    if len(ch) > maxd[0]:
        maxd = (len(ch), k)

parent_missing = defaultdict(int)
for c, p in parent_edge.items():
    if p not in M:
        parent_missing[p] += 1

model_fields_block = Counter()
model_fields_item = Counter()
for k, m in M.items():
    for f in m:
        (model_fields_block if k.startswith("block/") else model_fields_item)[f] += 1


def geom_source(key):
    """vanilla ResolvedModel.findTopGeometry: first non-null elements walking up."""
    if key in M and isinstance(M[key].get("elements"), list):
        return key
    cur = parent_edge.get(key)
    seen = {key}
    while cur and cur not in seen:
        seen.add(cur)
        if cur in M and isinstance(M[cur].get("elements"), list):
            return cur
        cur = parent_edge.get(cur)
    return None


geom_src_of = {k: geom_source(k) for k in M}
leaves_per_geom = Counter()
for k in M:
    if k in parent_children:
        continue                       # not a leaf
    g = geom_src_of[k]
    if g:
        leaves_per_geom[g] += 1
descendant_count = {}
for p in parent_children:
    stack, cnt, leaves = list(parent_children[p]), 0, 0
    while stack:
        c = stack.pop()
        cnt += 1
        if c not in parent_children:
            leaves += 1
        stack.extend(parent_children.get(c, []))
    descendant_count[p] = (cnt, leaves)

models_no_geometry = [k for k in M if geom_src_of[k] is None]
block_no_geometry = [k for k in models_no_geometry if k.startswith("block/")]
log("distinct parents:", len(parent_children), "chain depth hist:", dict(sorted(depth_hist.items())),
    "max:", maxd, "cycles:", len(cycle_keys))
log("missing parents:", dict(parent_missing))
log("models with own elements:", sum(1 for k in M if isinstance(M[k].get('elements'), list)),
    "models with no geometry anywhere:", len(models_no_geometry), "(block:", len(block_no_geometry), ")")
log("block model fields:", dict(model_fields_block.most_common()))
log("item model fields:", dict(model_fields_item.most_common()))

# ---- geometry declared in template models (elements are only declared in a few)
elem_declared = [k for k in M if isinstance(M[k].get("elements"), list)]
decl_by_class = {}
for _cls in ("block", "item"):
    _e = _f = 0
    for k in elem_declared:
        if k.startswith(_cls + "/"):
            for _el in M[k]["elements"]:
                if isinstance(_el, dict):
                    _e += 1
                    _f += len(_el.get("faces") or {})
    decl_by_class[_cls] = {"models": sum(1 for k in elem_declared if k.startswith(_cls + "/")),
                           "elements": _e, "faces": _f}
log("declared geometry by class:", decl_by_class)
declared_elems = sum(len(M[k]["elements"]) for k in elem_declared)
declared_faces = 0
coord_hist = Counter()
elem_keys = Counter()
face_keys = Counter()
face_dirs_hist = Counter()
bad_face_dir = []
rot_present = 0
rot_axis = Counter()
rot_angle = Counter()
rot_euler = []
rot_origin = Counter()
rot_rescale = Counter()
rot_rescale_values = Counter()
rot_missing_origin = 0
uv_len = Counter()
uv_out_of_range = []
uv_negative = 0
face_rot = Counter()
cullface_hist = Counter()
tint_hist = Counter()
shade_elem = Counter()
light_emission = Counter()
face_uvlock = 0
face_uvscale = 0
degenerate_axis = Counter()
box_class = Counter()
noncube_models = set()
face_tex_type = Counter()
tex_var_used = Counter()
tex_var_models = defaultdict(set)
slot_names = Counter()
out_of_bounds = []

for k in elem_declared:
    for el in M[k]["elements"]:
        if not isinstance(el, dict):
            continue
        for ek in el:
            elem_keys[ek] += 1
        fr, to = el.get("from"), el.get("to")
        if not (isinstance(fr, list) and isinstance(to, list) and len(fr) == 3 and len(to) == 3):
            continue
        degenerate = [ax for ax in range(3) if float(fr[ax]) == float(to[ax])]
        for ax in degenerate:
            degenerate_axis[["x", "y", "z"][ax]] += 1
        if len(degenerate) == 1:
            degenerate_axis["__one_axis_flat__"] += 1
        elif len(degenerate) == 0:
            degenerate_axis["__volume__"] += 1
        aligned = all(float(v) in (0.0, 16.0) for v in fr + to)
        full = fr == [0, 0, 0] and to == [16, 16, 16]
        if full:
            box_class["full 0-16 cube"] += 1
        elif aligned:
            box_class["sub-cube with all coords on 0/16"] += 1
        else:
            box_class["off-grid box"] += 1
            noncube_models.add(k)
        for v in list(fr) + list(to):
            coord_hist[str(Fraction(str(v)))] += 1
            if v < -16 or v > 32:
                out_of_bounds.append((k, v))
        r = el.get("rotation")
        if isinstance(r, dict):
            rot_present += 1
            for rk in r:
                rot_rescale[rk] += 1
            if "axis" in r or "angle" in r:
                rot_axis[r.get("axis")] += 1
                rot_angle[str(r.get("angle"))] += 1
            else:
                rot_euler.append((k, {x: r.get(x) for x in ("x", "y", "z") if x in r}))
            if "origin" in r:
                rot_origin[json.dumps(r["origin"])] += 1
            else:
                rot_missing_origin += 1
            rot_rescale_values[str(r.get("rescale"))] += 1
        if "shade" in el:
            shade_elem[str(el["shade"])] += 1
        if "light_emission" in el:
            light_emission[el["light_emission"]] += 1
        for d, fc in (el.get("faces") or {}).items():
            if d not in FACE_DIRS:
                bad_face_dir.append((k, d))
                continue
            declared_faces += 1
            face_dirs_hist[d] += 1
            if not isinstance(fc, dict):
                continue
            for fkd in fc:
                face_keys[fkd] += 1
            if "uv" in fc:
                uv_len[len(fc["uv"])] += 1
                if any(float(v) < 0 or float(v) > 16 for v in fc["uv"]):
                    uv_out_of_range.append((k, d, fc["uv"]))
            if "rotation" in fc:
                face_rot[fc["rotation"]] += 1
            if "cullface" in fc:
                cullface_hist[fc["cullface"]] += 1
            if "tintindex" in fc:
                tint_hist[fc["tintindex"]] += 1
            if "uvlock" in fc:
                face_uvlock += 1
            if "uvscale" in fc:
                face_uvscale += 1
            t = fc.get("texture")
            if isinstance(t, dict):
                face_tex_type["object:" + ",".join(sorted(t))] += 1
                if "sprite" in t:
                    tex_var_used[strip_ns(t["sprite"])] += 1
            elif isinstance(t, str):
                if t.startswith("#"):
                    face_tex_type["#var"] += 1
                    tex_var_used[t[1:]] += 1
                    tex_var_models[t[1:]].add(k)
                else:
                    face_tex_type["literal"] += 1

for k, m in M.items():
    for s in (m.get("textures") or {}):
        slot_names[s] += 1

log("declared elements:", declared_elems, "declared faces:", declared_faces)
log("face dir hist:", dict(face_dirs_hist), "bad dirs:", bad_face_dir[:3])
log("box classes:", dict(box_class), "off-grid models:", len(noncube_models))
log("degenerate axis:", dict(degenerate_axis))
log("coord values:", dict(coord_hist.most_common(30)))
log("out of [-16,32] bounds:", len(out_of_bounds), out_of_bounds[:5])
log("elem keys:", dict(elem_keys.most_common()), "face keys:", dict(face_keys.most_common()))
log("rotations:", rot_present, "axis:", dict(rot_axis), "angle:", dict(rot_angle.most_common()))
log("euler rotations:", len(rot_euler), rot_euler[:3], "missing origin:", rot_missing_origin)
log("rotation subkeys:", dict(rot_rescale.most_common()))
log("origins distinct:", len(rot_origin), rot_origin.most_common(6))
log("uv lengths:", dict(uv_len), "uv outside 0..16:", len(uv_out_of_range), uv_out_of_range[:4])
log("face rotation values:", dict(face_rot), "cullface:", dict(cullface_hist), "tintindex:", dict(tint_hist))
log("element shade:", dict(shade_elem), "light_emission:", dict(light_emission))
log("face uvlock:", face_uvlock, "face uvscale:", face_uvscale)
log("face texture ref kinds:", dict(face_tex_type))
log("texture variables:", len(tex_var_used), tex_var_used.most_common(20))
log("texture slot names:", slot_names.most_common(20))


# ---- texture-slot resolution exactly like TextureSlots.Resolver
def slot_table(key):
    ordered = []
    for anc in list(reversed(chain(key)[0])) + [key]:
        d = M.get(anc, {}).get("textures")
        if d:
            ordered.append(d)
    resolved, unresolved = {}, {}
    for d in ordered:
        for s, v in d.items():
            if isinstance(v, str) and v.startswith("#"):
                resolved.pop(s, None)
                unresolved[s] = strip_ns(v[1:])
            else:
                unresolved.pop(s, None)
                resolved[s] = v
    changed = True
    while changed:
        changed = False
        for s, tgt in list(unresolved.items()):
            if tgt in resolved:
                resolved[s] = resolved[tgt]
                del unresolved[s]
                changed = True
    return resolved, unresolved


unresolved_var_report = []         # (model, slot, var, parent)
var_from_parent = defaultdict(Counter)   # parent -> var -> count
for k in M:
    if not k.startswith("block/"):
        continue
    g = geom_src_of[k]
    if g is None:
        continue
    used = set()
    for el in M[g].get("elements") or []:
        for d, fc in (el.get("faces") or {}).items():
            if isinstance(fc, dict) and isinstance(fc.get("texture"), str) and fc["texture"].startswith("#"):
                used.add(fc["texture"][1:])
    own = set((M[k].get("textures") or {}))
    resolved, unres = slot_table(k)
    for v in sorted(used):
        if v in own:
            continue
        anc = None
        for a in chain(k)[0]:
            if v in (M.get(a, {}).get("textures") or {}):
                anc = a
                break
        if anc:
            var_from_parent[anc][v] += 1
        elif v in unres:
            unresolved_var_report.append((k, v, parent_edge.get(k, None)))
log("models(block) with variables inherited from parent:", sum(len(c) for c in var_from_parent.values()),
    "unresolved:", len(unresolved_var_report))
log("top parents supplying slots:", sorted(var_from_parent.items(), key=lambda kv: -sum(kv[1].values()))[:8])

# ---- parents' slot contracts (the rule the baker must copy)
slot_contract = {}
for p in parent_children:
    m = M.get(p)
    if m is not None and m.get("textures"):
        slot_contract[p] = m["textures"]

# ============================================================ 3. TEXTURE CLOSURE
def closure():
    png_face, png_particle, missing, unresolved = set(), set(), set(), []
    for mk in sorted(model_refs):
        m = M.get(mk)
        if not m:
            missing.add("(model)" + mk)
            continue
        g = geom_src_of[mk]
        resolved, unres = slot_table(mk)
        slots_needed = set()
        if g is not None:
            for el in M[g].get("elements") or []:
                for d, fc in (el.get("faces") or {}).items():
                    if isinstance(fc, dict) and isinstance(fc.get("texture"), str):
                        slots_needed.add(fc["texture"][1:] if fc["texture"].startswith("#") else fc["texture"])
        slots_needed.add("particle")
        for s in slots_needed:
            if s.startswith("#"):
                continue
            v = resolved.get(s)
            if v is None:
                if s in unres:
                    unresolved.append((mk, s, "#" + unres[s]))
                continue
            path, ft = (v, False) if isinstance(v, str) else (v.get("sprite"), bool(v.get("force_translucent")))
            path = strip_ns(path)
            (png_particle if s == "particle" else png_face).add(path)
        for s in unres:
            if s != "particle":
                unresolved.append((mk, s, "#" + unres[s]))
    return png_face, png_particle, missing, unresolved


png_face, png_particle, missing_models, unresolved_tex = closure()
all_closure = png_face | png_particle


def png_ok(p):
    return os.path.exists(os.path.join(TX_DIR, strip_ns(p) + ".png"))


face_existing = sorted(p for p in png_face if png_ok(p))
face_missing = sorted(p for p in png_face if not png_ok(p))
log("closure: models referenced by blockstates:", len(model_refs))
log("closure: face textures:", len(png_face), "existing:", len(face_existing), "missing:", len(face_missing), face_missing[:8])
log("closure: +particle textures:", len(all_closure))
log("closure: unresolved slots:", len(unresolved_tex), unresolved_tex[:5])

# animated detection
BLOCK_TX = os.path.join(TX_DIR, "block") + os.sep
anim_field_total = 0
anim_field_empty = 0
anim_field_block = 0
anim_field_block_empty = 0
anim = {}
for fp in glob.glob(os.path.join(TX_DIR, "**", "*.png.mcmeta"), recursive=True):
    try:
        md = load(fp)
    except Exception:
        continue
    if isinstance(md, dict) and "animation" in md:
        anim_field_total += 1
        if not md["animation"]:
            anim_field_empty += 1
        if fp.startswith(BLOCK_TX):
            anim_field_block += 1
            if not md["animation"]:
                anim_field_block_empty += 1
    if isinstance(md, dict) and md.get("animation"):
        rel = os.path.relpath(fp, TX_DIR).replace("\\", "/")[:-len(".mcmeta")]
        rel = re.sub(r"\.png$", "", rel)
        a = md["animation"]
        anim[rel] = {"frametime": a.get("frametime"), "interpolate": a.get("interpolate"),
                     "frames_list": a.get("frames") is not None}
block_anim = sorted(k for k in anim if k.startswith("block/"))
log("animated textures overall:", len(anim), " in block/:", len(block_anim))
anim_in_closure = sorted(k for k in all_closure if k in anim)
log("animated inside blockstate closure:", len(anim_in_closure))

# project comparison
proj_dir = os.path.join(PROJ, "public/mc/textures/block")
proj_png = sorted(f[:-4] for f in os.listdir(proj_dir) if f.endswith(".png") and "." not in f[:-4]) if os.path.isdir(proj_dir) else []
manifest = load(os.path.join(PROJ, "public/mc/manifest.json"))
manifest_keys = sorted(manifest.get("textures", {}).keys())
log("project manifest textures:", len(manifest_keys), " project block png files:", len(proj_png))
mk = set(manifest_keys)
face_set = set(face_existing)
gap = sorted(face_set - mk)
already = sorted(face_set & mk)
surplus = sorted(mk - face_set - set(all_closure))
log("closure face textures already shipped by the project:", len(already))
log("closure textures missing from project:", len(gap))
log("project textures not reachable from any blockstate:", len(surplus), surplus[:12])

# ============================================================ 4. BLOCKS.java + id references
blocks_java = os.path.join(SRCV, "net/minecraft/world/level/block/Blocks.java")
txt = open(blocks_java, "r", encoding="utf-8").read()
refdir = os.path.join(SRCV, "net/minecraft/references")


def parse_id_file(path):
    """Return {const_name: block_name} for direct ids and expanded colour/copper families."""
    src = open(path, encoding="utf-8").read()
    direct = {}
    for m in re.finditer(r'public static final \w+[\w<>]* ([A-Z0-9_]+) = (?:\w+\.)?create\(\s*"([a-z0-9_]+)"(?:,\s*"[a-z0-9_]+")?\s*\)', src):
        direct[m.group(1)] = m.group(2)
    # BlockItemId.create(Identifier, Identifier) variants: skip (none in vanilla data)
    families = {}
    for m in re.finditer(r'public static final ColorCollection<[\w<>]+> ([A-Z0-9_]+) = createSimpleColored\("([a-z0-9_]+)"\)', src):
        families[m.group(1)] = [c + "_" + m.group(2) for c in DYE]
    for m in re.finditer(r'public static final WeatheringCopperCollection<[\w<>]+> ([A-Z0-9_]+) = createSimpleCopper\("([a-z0-9_]+)"\)', src):
        families[m.group(1)] = [pre + m.group(2) for pre in COPPER_PREFIX]
    return direct, families


item_block_direct, item_block_families = parse_id_file(os.path.join(refdir, "BlockItemIds.java"))
block_direct, block_families = parse_id_file(os.path.join(refdir, "BlockIds.java"))
bid_txt = open(os.path.join(refdir, "BlockItemIds.java"), encoding="utf-8").read()
blockid_to_name = {}
for c, n in item_block_direct.items():
    blockid_to_name["BlockItemIds." + c] = n
for c, n in block_direct.items():
    blockid_to_name.setdefault("BlockIds." + c, n)

registry_names = {}
field_index = {}
# copper_block family uses a hand-written special name table in BlockItemIds.java
# (COPPER_BLOCK_SPECIAL_NAMES = ByState("copper_block","copper","copper","copper")),
# expanded by WeatheringCopperCollection.prefixWithState over the 8 waxed/weathering prefixes.
special = re.search(r'COPPER_BLOCK_SPECIAL_NAMES = new WeatheringCopperCollection\.ByState<>\(\s*(.*?)\s*\)\s*;', bid_txt, re.S)
copper_special = re.findall(r'"([a-z0-9_]+)"', special.group(1)) if special else []
for i, base in enumerate(copper_special):
    for prefixes in (COPPER_PREFIX[:4], COPPER_PREFIX[4:]):
        registry_names[prefixes[i] + base] = {"field": "COPPER_BLOCK", "ids_class": "BlockItemIds",
                                              "id_const": "COPPER_BLOCK", "kind": "family"}
field_index = {}
for cls, direct, families in (("BlockItemIds", item_block_direct, item_block_families),
                             ("BlockIds", block_direct, block_families)):
    for c, n in direct.items():
        registry_names[n] = {"field": c, "ids_class": cls, "id_const": c, "kind": "direct"}
    for c, ns in families.items():
        for n in ns:
            registry_names[n] = {"field": c, "ids_class": cls, "id_const": c, "kind": "family"}

field_pat = re.compile(
    r"public static final (?:Block|ColorCollection<Block>|WeatheringCopperCollection<Block>) ([A-Z0-9_]+) = (\w+)\(\s*(?:Blocks\.)?([A-Za-z]+)\.([A-Z0-9_]+)")
explicit, helpers = [], Counter()
for m in field_pat.finditer(txt):
    field, helper, ids_cls, id_const = m.groups()
    helpers[helper] += 1
    key = ids_cls + "." + id_const
    if key in blockid_to_name:
        name = blockid_to_name[key]
        rec = {"field": field, "helper": helper, "ids_class": ids_cls, "id_const": id_const, "name": name, "kind": "direct"}
    else:
        fam = dict(item_block_families).get(id_const) or dict(block_families).get(id_const)
        rec = {"field": field, "helper": helper, "ids_class": ids_cls, "id_const": id_const,
               "name": fam, "kind": "family"}
    field_index[field] = rec
    if rec["kind"] == "direct":
        registry_names[rec["name"]] = rec
explicit = [v for v in field_index.values() if v["kind"] == "direct"]
all_fields = re.findall(r"public static final Block ([A-Z0-9_]+) =", txt)
color_fields = re.findall(r"public static final ColorCollection<Block> ([A-Z0-9_]+) =", txt)
copper_fields = re.findall(r"public static final WeatheringCopperCollection<Block> ([A-Z0-9_]+) =", txt)
log("Blocks.java: Block fields", len(all_fields), "colour families", len(color_fields),
    "copper families", len(copper_fields), "register helpers:", dict(helpers))
log("BlockItemIds direct ids:", len(item_block_direct), "families:", len(item_block_families),
    "| BlockIds direct:", len(block_direct), "families:", len(block_families))
log("reconstructed registry names:", len(registry_names))

bs_names = set(bs)
no_blockstate = sorted(n for n in registry_names if n not in bs_names)
no_block_field = sorted(n for n in bs_names if n not in registry_names)
log("blocks WITHOUT blockstate file:", len(no_blockstate))
log("  ->", no_blockstate)
log("blockstates NOT matched to a registry name:", len(no_block_field), no_block_field)

# ============================================================ 5. PALETTE / project
ba = open(os.path.join(PROJ, "scripts/build-assets.mjs"), encoding="utf-8").read()
palette_names = re.findall(r"\{ name: '([a-z0-9_]+)'", ba)
declared_state = dict(re.findall(r"\{ name: '([a-z0-9_]+)', state: '([^']+)'", ba))
default_state = dict(re.findall(r"^\s*([a-z0-9_]+): '([^']+)'", ba[ba.index("const DEFAULT_STATE"):ba.index("function normModelName")], re.M))
log("PALETTE entries:", len(palette_names), "explicit state:", len(declared_state), "DEFAULT_STATE:", len(default_state))

pal = []
for n in palette_names:
    d = bs.get(n)
    rec = {"name": n, "declared_state": declared_state.get(n), "default_state": default_state.get(n)}
    if d is None:
        rec["kind"] = "no-blockstate-file"
        pal.append(rec)
        continue
    if "multipart" in d:
        rec["kind"] = "multipart"
        rec["entries"] = len(d["multipart"])
        pal.append(rec)
        continue
    keys = list(d["variants"])
    props = sorted({kv.split("=")[0] for k in keys for kv in k.split(",") if "=" in kv})
    st = declared_state.get(n) or default_state.get(n)
    rec.update({"kind": "variant", "variant_keys": len(keys), "props": props,
                "random_list": any(isinstance(v, list) for v in d["variants"].values()),
                "chosen_state": st, "chosen_state_exists": (st in d["variants"]) if st else None})
    rec["needs_inference"] = bool(set(props) - {"snowy", "axis", "lit"}) or len(keys) > 8
    pal.append(rec)


def collect_when_props(w):
    out = []
    if isinstance(w, dict):
        for k, v in w.items():
            if k in ("AND", "OR"):
                for s in (v if isinstance(v, list) else [v]):
                    out += collect_when_props(s)
            else:
                out.append(k)
    return out


for r in pal:
    if r["kind"] == "multipart":
        props = set()
        for e in bs[r["name"]]["multipart"]:
            if "when" in e:
                props |= set(collect_when_props(e["when"]))
        r["props"] = sorted(props)
        r["needs_inference"] = True

ok_direct = [r["name"] for r in pal if r["kind"] == "variant" and not r.get("needs_inference")]
needs_inf = [r["name"] for r in pal if r.get("needs_inference") and r["kind"] == "variant"]
mp_pal = [r["name"] for r in pal if r["kind"] == "multipart"]
bad_state = [(r["name"], r.get("chosen_state")) for r in pal if r.get("chosen_state_exists") is False]
log("PALETTE directly bakeable (single/ignorable-state):", len(ok_direct), ok_direct)
log("PALETTE needing blockstate system:", len(needs_inf), needs_inf)
log("PALETTE multipart:", mp_pal)
log("PALETTE declared state not present in vanilla variants:", bad_state)

# ============================================================ extra checks
cartesian_incomplete = []
for n in variant_files:
    variants = bs[n]["variants"]
    if "" in variants and len(variants) > 1:
        cartesian_incomplete.append((n, "empty key mixed with keyed"))
        continue
    if "" in variants:
        continue
    domains = defaultdict(set)
    for k in variants:
        for part in k.split(","):
            key, _, val = part.partition("=")
            domains[key].add(val)
    prod = 1
    for v in domains.values():
        prod *= len(v)
    if prod != len(variants):
        cartesian_incomplete.append((n, len(variants), prod, {k: sorted(v) for k, v in domains.items()}))
log("variant files whose key set is NOT the full cartesian product of its observed domains:", len(cartesian_incomplete))
log("  ->", cartesian_incomplete[:12])

bs_models_no_geom = sorted(m for m in model_refs if geom_src_of.get(m) is None)
log("blockstate-referenced models without geometry:", len(bs_models_no_geom), bs_models_no_geom[:20])

closure_prefixes = Counter(p.split("/")[0] for p in png_face)
log("closure texture directories:", dict(closure_prefixes))

mp_neighbor_files = sorted(n for n in multipart_files
                           if mp_prop_files.get("north") and n in mp_prop_files["north"]
                           and n in mp_prop_files.get("west", set()))
log("multipart files keyed on horizontal neighbours (north..west):", len(mp_neighbor_files))

# ============================================================ families
def fam_label(props):
    return ",".join(props) if props else "(no property)"

NEIGHBOR_PROPS = {"north", "south", "east", "west", "up", "down"}
STATEFUL_PROPS = {
    "shape", "type", "part", "half", "faces", "in_wall", "open", "extended", "waterlogged",
    "thickness", "vertical_direction", "bites", "candles", "rotation", "attachment",
    "bottom", "top", "side", "front", "segments", "level", "distance", "branch",
    "flower_amount", "berry", "growth", "hatch", "delay", "mode", "triggered", "eye",
    "slot_state", "tilt", "transitionalsize", "vertical_powered", "horizontal_powered",
}
fam_table = [{"props": list(ps), "files": len(fs), "examples": sorted(fs)[:5]}
             for ps, fs in sorted(propset_files.items(), key=lambda kv: (-len(kv[1]), fam_label(kv[0])))]
mp_fam_table = [{"props": list(ps), "files": len(fs), "examples": sorted(fs)[:5]}
                for ps, fs in sorted(mp_shapes.items(), key=lambda kv: (-len(kv[1]), fam_label(kv[0])))]

# suffix families: last '_' token of the blockstate name
suffix_files = defaultdict(list)
for n in bs:
    suffix_files[n.split("_")[-1]].append(n)
suffix_report = []
for suf, fs in sorted(suffix_files.items(), key=lambda kv: (-len(kv[1]), kv[0])):
    props = set()
    nmp = 0
    for f in fs:
        d = bs[f]
        if "variants" in d:
            for k in d["variants"]:
                for kv_ in k.split(","):
                    if "=" in kv_:
                        props.add(kv_.split("=")[0])
        else:
            nmp += 1
            for e in d["multipart"]:
                if "when" in e:
                    props |= set(collect_when_props(e["when"]))
    stateful = sorted(p for p in props if p in NEIGHBOR_PROPS or p in STATEFUL_PROPS)
    suffix_report.append({"suffix": suf, "files": len(fs), "multipart_files": nmp,
                          "properties": sorted(props), "stateful_properties": stateful,
                          "needs_placement_inference": bool(stateful) or nmp > 0,
                          "examples": sorted(fs)[:5]})
log("suffix families total:", len(suffix_report), "needing placement inference:",
    sum(1 for r in suffix_report if r["needs_placement_inference"]))
log("top suffix families:", [(r["suffix"], r["files"]) for r in suffix_report[:18]])

top_props = []
for p in sorted(prop_files, key=lambda p: -len(prop_files[p]))[:30]:
    top_props.append({"property": p, "files": len(prop_files[p]),
                      "values": sorted(prop_value[p].keys()),
                      "occurrences": dict(prop_value_occ[p].most_common())})

# ============================================================ JSON output
out = {
    "meta": {
        "source_assets": ROOT.replace("/", "\\"),
        "source_jar": "G:\\ck-web26\\client-26.2.jar",
        "generated_by": "research/inventory.py",
        "counts": {
            "blockstate_files": len(bs),
            "variant_blockstates": len(variant_files),
            "multipart_blockstates": len(multipart_files),
            "mixed_or_other_blockstates": len(other_files),
            "variant_keys": key_total,
            "variant_objects": variant_obj_total,
            "multipart_entries": mp_entries_total,
            "block_models": len(mb_files),
            "item_models": len(mi_files),
            "items_json_files": len(glob.glob(os.path.join(ROOT, "items", "*.json"))),
            "textures_block_png": len(glob.glob(os.path.join(TX_DIR, "block", "*.png"))),
            "textures_block_mcmeta": len(glob.glob(os.path.join(TX_DIR, "block", "*.png.mcmeta"))),
            "item_models": len(mi_files),
            "models_referenced_by_blockstates": len(model_refs),
            "models_declaring_elements": len(elem_declared),
            "declared_elements": declared_elems,
            "declared_geometry_by_class": decl_by_class,
            "declared_faces": declared_faces,
            "blockstate_closure_face_textures": len(png_face),
            "blockstate_closure_face_textures_existing": len(face_existing),
            "blockstate_closure_with_particle": len(all_closure),
            "animated_block_textures": len(block_anim),
            "animated_in_closure": len(anim_in_closure),
            "project_manifest_textures": len(manifest_keys),
            "closure_gap_vs_project": len(gap),
            "closure_already_shipped": len(already),
            "blocks_java_fields": len(all_fields),
        "id_direct_counts": {"BlockItemIds": len(item_block_direct), "BlockIds": len(block_direct)},
            "blocks_java_explicit_registrations": len(explicit),
            "reconstructed_registry_names": len(registry_names),
            "palette_entries": len(palette_names),
        },
    },
    "blockstate_variant": {
        "key_grammar": {
            "regex": "^([a-z0-9_]+=[A-Za-z0-9_.-]+)(,[a-z0-9_]+=[A-Za-z0-9_.-]+)*$",
            "empty_key_files": sorted(empty_key_files)[:600],
            "empty_key_file_count": len(empty_key_files),
            "nonalphabetical_key_count": len(key_nonalpha),
            "nonalphabetical_examples": key_nonalpha[:10],
            "duplicate_property_count": len(key_dup_prop),
            "bad_format_count": len(key_bad_format),
            "bad_format_examples": key_bad_format[:10],
            "pipe_in_variant_value": len(keys_with_pipe),
            "keys_with_mixed_specificity_files": len(mixed_specificity_files),
            "mixed_specificity_examples": mixed_specificity_files[:10],
            "keys_per_file_histogram": {str(k): v for k, v in sorted(keycount_hist.items())},
            "properties_per_file_histogram": {str(k): v for k, v in sorted(propcount_hist.items())},
        },
        "top_properties": top_props,
        "all_properties": {p: {"files": len(prop_files[p]), "values": sorted(prop_value[p], key=str),
                               "file_sets": {v: sorted(list(prop_value[p][v]))[:6] for v in prop_value[p]}}
                           for p in sorted(prop_files)},
        "property_sets": fam_table,
        "cartesian_completeness_exceptions": cartesian_incomplete[:60],
        "cartesian_incomplete_count": len(cartesian_incomplete),
        "suffix_families": suffix_report,
        "suffix_families_needing_inference": [r["suffix"] for r in suffix_report if r["needs_placement_inference"]],
        "variant_value_fields": {
            "frequency": dict(v_fields.most_common()),
            "x_values": {str(k): v for k, v in sorted(v_x.items(), key=lambda kv: str(kv[0]))},
            "y_values": {str(k): v for k, v in sorted(v_y.items(), key=lambda kv: str(kv[0]))},
            "z_values": {str(k): v for k, v in v_z.items()},
            "uvlock_values": dict(v_uvlock),
            "weight_values": dict(v_weight),
            "uvlock_false_occurrences": v_uvlock.get("False", 0),
        },
        "random_variants": {
            "files": len(random_files),
            "keys": sum(len(v) for v in random_files.values()),
            "list_length_histogram": {str(k): v for k, v in sorted(list_len_hist.items())},
            "max_length": max(max((l for _, l in v), default=0) for v in random_files.values()),
            "files_with_same_model_only": sorted(set(n for n, _, _ in same_model_list)),
            "same_model_only_count": len(same_model_list),
            "explicit_weight": weighted_files[:20],
            "detail": {n: v for n, v in sorted(random_files.items())},
        },
        "model_references": {
            "distinct_models": len(model_refs),
            "namespace_prefixes": dict(model_prefix_hist),
            "missing_model_files": sorted(set(model_ref_not_found))[:50],
            "missing_count": len(set(model_ref_not_found)),
        },
    },
    "blockstate_multipart": {
        "file_count": len(multipart_files),
        "files": sorted(multipart_files),
        "entries_total": mp_entries_total,
        "entries_without_when": mp_no_when,
        "operators_observed": dict(mp_ops),
        "operator_files": {k: sorted(v) for k, v in mp_op_files.items()},
        "operators_supported_by_loader": ["AND", "OR", "implicit AND inside one when object",
                                         "'|' value set", "'!' negation prefix (KeyValueCondition.Term)",
                                         "json int/bool legacy value (codec alternative)"],
        "operators_not_used_in_vanilla_data": ["INVERT", "list-valued when", "list-valued property terms"],
        "when_root_types": dict(mp_when_root_type),
        "leaf_value_forms": dict(mp_leaf_value_forms),
        "condition_depth_histogram": {str(k): v for k, v in sorted(mp_depth_hist.items())},
        "properties": {p: {"occurrences": mp_prop_occ[p], "files": len(mp_prop_files[p]),
                           "values": dict(mp_leaf_prop_values[p].most_common())}
                       for p in sorted(mp_prop_occ, key=lambda x: -mp_prop_occ[x])},
        "apply_fields": dict(mp_apply_fields.most_common()),
        "apply_x_values": {str(k): v for k, v in mp_apply_x.items()},
        "apply_y_values": {str(k): v for k, v in mp_apply_y.items()},
        "apply_weight_values": {str(k): v for k, v in mp_apply_weight.items()},
        "apply_uvlock_entries": mp_uvlock_entries,
        "apply_as_list_files": sorted(mp_apply_is_list),
        "property_sets": mp_fam_table,
        "anomalies": mp_anomaly[:20],
        "node_count_top": most_complex,
        "neighbor_condition_files": mp_neighbor_files,
        "models_without_geometry": {"count": len(bs_models_no_geom), "list": bs_models_no_geom},
        "closure_texture_directories": dict(closure_prefixes),
    },
    "models": {
        "block_field_frequency": dict(model_fields_block.most_common()),
        "item_field_frequency": dict(model_fields_item.most_common()),
        "parents": {
            "distinct": len(parent_children),
            "table": [{"parent": p, "direct_children": len(parent_children[p]),
                       "transitive_descendants": descendant_count.get(p, (0, 0))[0],
                       "leaf_models": descendant_count.get(p, (0, 0))[1],
                       "declares_elements": p in [k for k in elem_declared],
                       "declares_textures": bool(M.get(p, {}).get("textures")),
                       "file_exists": p in M}
                      for p in sorted(parent_children, key=lambda x: (-descendant_count.get(x, (0, 0))[1], -len(parent_children[x]), x))],
            "missing_files": dict(parent_missing),
        },
        "geometry_source": {
            "models_declaring_elements": len(elem_declared),
            "block_models_declaring_elements": len([k for k in elem_declared if k.startswith("block/")]),
            "models_without_any_geometry": len(models_no_geometry),
            "block_models_without_any_geometry": sorted(block_no_geometry)[:80],
            "leaf_models_per_geometry_source": [{"geometry": g, "leaf_models": c} for g, c in
                                                sorted(leaves_per_geom.items(), key=lambda kv: -kv[1])[:60]],
        },
        "inheritance": {
            "chain_depth_histogram": {str(k): v for k, v in sorted(depth_hist.items())},
            "max_depth": {"depth": maxd[0], "model": maxd[1], "chain": chain(maxd[1])[0]},
            "cycles": sorted(cycle_keys),
            "cycle_count": len(cycle_keys),
            "rules": [
                "geometry: first non-null elements walking up the parent chain (ResolvedModel.findTopGeometry)",
                "texture slots: all parents' textures merged root-first, child wins (TextureSlots.Resolver + Lists.reverse)",
                "reference slots '#name' are resolved to a fixpoint; unresolvable slots are dropped -> MissingTextureAtlasSprite",
                "ambientocclusion: nearest explicit value up the chain, default true",
                "gui_light: nearest explicit value up the chain, default 'side'",
                "display: per-display-context nearest value up the chain",
            ],
        },
        "elements": {
            "declared_total": declared_elems,
            "declared_faces_total": declared_faces,
            "face_direction_histogram": dict(face_dirs_hist),
            "unknown_face_directions": bad_face_dir[:10],
            "element_keys": dict(elem_keys.most_common()),
            "face_keys": dict(face_keys.most_common()),
            "box_classification": dict(box_class),
            "off_grid_models": sorted(noncube_models)[:200],
            "degenerate_axis_elements": dict(degenerate_axis),
            "coordinate_value_histogram": {k: v for k, v in coord_hist.most_common()},
            "coordinates_outside_-16_32": out_of_bounds[:20],
            "uv_length_histogram": {str(k): v for k, v in uv_len.items()},
            "uv_outside_0_16_count": len(uv_out_of_range),
            "uv_outside_0_16_examples": uv_out_of_range[:20],
            "face_rotation_values": {str(k): v for k, v in face_rot.items()},
            "cullface_values": dict(cullface_hist),
            "tintindex_values": {str(k): v for k, v in tint_hist.items()},
            "element_shade_false": shade_elem.get("False", 0),
            "element_shade_values": dict(shade_elem),
            "light_emission_values": {str(k): v for k, v in light_emission.items()},
            "face_uvlock_occurrences": face_uvlock,
            "face_uvscale_occurrences": face_uvscale,
            "face_texture_ref_kinds": dict(face_tex_type),
            "rotated_elements": rot_present,
            "rotation_axis_values": {str(k): v for k, v in rot_axis.items()},
            "rotation_angle_values": {str(k): v for k, v in rot_angle.most_common()},
            "rotation_euler_elements": rot_euler[:10],
            "rotation_subkeys": dict(rot_rescale.most_common()),
            "rotation_rescale_key_occurrences": rot_rescale.get("rescale", 0),
            "rotation_rescale_values": dict(rot_rescale_values),
            "rotation_distinct_origins": len(rot_origin),
            "rotation_origin_top": [{"origin": json.loads(k), "count": v} for k, v in rot_origin.most_common(20)],
            "rotation_origin_default_8_8_8_count": rot_origin.get("[8, 8, 8]", 0),
            "rotation_missing_origin": rot_missing_origin,
        },
        "textures": {
            "slot_names": {k: v for k, v in slot_names.most_common()},
            "variables_used": {k: v for k, v in tex_var_used.most_common()},
            "variable_model_counts": {k: len(v) for k, v in sorted(tex_var_models.items(), key=lambda kv: -len(kv[1]))},
            "inherited_from_parent": {p: dict(c.most_common()) for p, c in
                                      sorted(var_from_parent.items(), key=lambda kv: -sum(kv[1].values()))},
            "unresolved_in_block_models": {"count": len(unresolved_var_report),
                                           "examples": unresolved_var_report[:60],
                                           "by_parent": dict(Counter(str(x[2]) for x in unresolved_var_report).most_common()),
                                           "by_variable": dict(Counter(x[1] for x in unresolved_var_report).most_common())},
            "parent_slot_contracts": slot_contract,
        },
    },
    "texture_closure": {
        "models_reachable": len(model_refs),
        "face_textures": sorted(png_face),
        "face_textures_existing_count": len(face_existing),
        "face_textures_existing": face_existing,
        "face_textures_missing": face_missing,
        "particle_extra_textures": sorted(all_closure - png_face),
        "total_with_particle": len(all_closure),
        "animation_field_files": {"all_textures_with_animation_key": anim_field_total,
                                      "all_textures_empty_animation_object": anim_field_empty,
                                      "block_dir_with_animation_key": anim_field_block,
                                      "block_dir_empty_animation_object": anim_field_block_empty},
        "animated": {k: anim[k] for k in sorted(all_closure) if k in anim},
        "animated_count": len(anim_in_closure),
        "animated_in_closure": anim_in_closure,
        "unresolved_slots": unresolved_tex[:60],
        "project": {
            "manifest_texture_keys": manifest_keys,
            "manifest_texture_count": len(manifest_keys),
            "block_png_files": proj_png,
            "gap_count": len(gap),
            "gap": gap,
            "already_shipped_count": len(already),
            "already_shipped": already,
            "project_surplus_not_in_closure": surplus,
        },
        "all_block_texture_files": len(glob.glob(os.path.join(TX_DIR, "block", "*.png"))),
        "all_block_mcmeta_files": len(glob.glob(os.path.join(TX_DIR, "block", "*.png.mcmeta"))),
        "atlas_sources_note": "atlases/blocks.json pulls directory block/*, entity/conduit/* plus a few singles",
    },
    "blocks_registry": {
        "java_fields": len(all_fields),
        "explicit_registrations": explicit,
        "registration_helpers": dict(helpers),
        "color_families": color_fields,
        "copper_families": copper_fields,
        "reconstructed_name_count": len(registry_names),
        "blocks_without_blockstate": no_blockstate,
        "blockstates_without_registry_name": no_block_field,
        "intersection": sorted(set(registry_names) & bs_names),
        "intersection_count": len(set(registry_names) & bs_names),
    },
    "project_comparison": {
        "palette_count": len(palette_names),
        "palette_names": palette_names,
        "direct_bakeable": ok_direct,
        "needs_blockstate_system": needs_inf,
        "needs_multipart": mp_pal,
        "entries": pal,
        "declared_state_not_in_vanilla": bad_state,
        "custom_rendered": [n for n in palette_names if n in ("water", "lava")],
        "theoretical_block_limit": len(bs),
    },
}
with open(os.path.join(OUT_DIR, "blockstate-inventory.json"), "w", encoding="utf-8") as f:
    json.dump(out, f, ensure_ascii=False, indent=1)
with open(os.path.join(OUT_DIR, "_inventory_dump.txt"), "w", encoding="utf-8") as f:
    f.write("\n".join(_lines) + "\n")
for l in _lines:
    print(l)
