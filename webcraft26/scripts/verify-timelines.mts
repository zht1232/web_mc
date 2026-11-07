// Machine check of src/client/EnvironmentLighting.ts against the decompiled 26.2
// client. This is the authoritative comparison for the light package: every
// OVERWORLD_DAY keyframe, modifier, easing curve and sampled value is re-derived
// from the Java source (and cross-checked against the shipped datapack JSON), then
// compared with the TypeScript port.
//
//   cd G:\web_mc\webcraft26 && npx tsx scripts/verify-timelines.mts
//
// Sources parsed here (never trusted from typeScript):
//   G:/ck-web26/src-vanilla/net/minecraft/world/timeline/Timelines.java
//   G:/ck-web26/src-vanilla/net/minecraft/world/attribute/EnvironmentAttributes.java
//   G:/ck-web26/src-vanilla/net/minecraft/util/EasingType.java        (semantics copied)
//   G:/ck-web26/src-vanilla/net/minecraft/util/KeyframeTrackSampler.java (semantics copied)
//   G:/ck-web26/src-vanilla/data/minecraft/timeline/day.json + moon.json
//   G:/ck-web26/src-vanilla/data/minecraft/dimension_type/overworld.json

import fs from 'node:fs';
import {
  OVERWORLD_DAY, MOON_TIMELINE, ATTRIBUTE_KINDS,
  attributeBase, computeSkyState, evaluateAttribute, sampleTrack,
  argb, alpha8, red8, green8, blue8, srgbLerp,
} from '../src/client/EnvironmentLighting.ts';

const ROOT = 'G:/ck-web26';
const SRC = `${ROOT}/src-vanilla/net/minecraft`;
const read = (p: string) => fs.readFileSync(p, 'utf8');

let failures = 0;
let passes = 0;
const skipped: string[] = [];

function check(ok: boolean, label: string, detail = ''): void {
  if (ok) { passes++; console.log(`[PASS] ${label}${detail ? '  ' + detail : ''}`); }
  else { failures++; console.log(`[FAIL] ${label}${detail ? '  ' + detail : ''}`); }
}

// ---------------------------------------------------------------------------
// Independent reference implementation (transcribed from the Java, not imported)
// ---------------------------------------------------------------------------

function refAs8Bit(v: number): number { return Math.floor(v * 255); }
function refColorFromFloat(a: number, r: number, g: number, b: number): number {
  return argb(refAs8Bit(r), refAs8Bit(g), refAs8Bit(b), refAs8Bit(a));
}
function refCurve(v1: number, v2: number) {
  return { a: 3 * v1 - 3 * v2 + 1, b: -6 * v1 + 3 * v2, c: 3 * v1 };
}
function refCurveSample(curve: { a: number; b: number; c: number }, t: number): number {
  return ((curve.a * t + curve.b) * t + curve.c) * t;
}
function refCurveGradient(curve: { a: number; b: number; c: number }, t: number): number {
  return (3 * curve.a * t + 2 * curve.b) * t + curve.c;
}
function refEase(easing: RefEasing, x: number): number {
  if (easing === 'linear') return x;
  if (easing === 'constant') return 0;
  const [x1, y1, x2, y2] = easing.cubic;
  const xc = refCurve(x1, x2);
  const yc = refCurve(y1, y2);
  let t = x;
  for (let i = 0; i < 4; i++) {
    const err = refCurveSample(xc, t) - x;
    if (Math.abs(err) < 1e-5) return refCurveSample(yc, t);
    const g = refCurveGradient(xc, t);
    if (g < 1e-5) break;
    t -= Math.min(0.25, Math.max(-0.25, err / g));
  }
  let lo = 0;
  let hi = 1;
  let mid = t;
  for (; lo < hi; mid = (hi + lo) / 2) {
    const err = refCurveSample(xc, mid) - x;
    if (Math.abs(err) < 1e-5) return refCurveSample(yc, mid);
    if (err < 0) lo = mid; else hi = mid;
  }
  return refCurveSample(yc, (hi + lo) / 2);
}

type RefEasing = 'linear' | 'constant' | { cubic: [number, number, number, number] };
interface RefKeyframe { tick: number; value: number }
interface RefTrack { id: string; field: string; modifier: string; easing: RefEasing; frames: RefKeyframe[] }

/** KeyframeTrackSampler.bakeSegments + sample, transcribed. */
function refSample(track: RefTrack, ticks: number, period: number, kind: string): number {
  const kf = track.frames;
  const segs: { fromTicks: number; toTicks: number; fromValue: number; toValue: number }[] = [];
  const eslint = (a: number, b: number, alpha: number) => {
    if (kind === 'color') return srgbLerp(alpha, a, b);
    return a + alpha * (b - a);
  };
  if (kf.length === 1) return kf[0].value;
  const first = kf[0];
  const last = kf[kf.length - 1];
  segs.push({ fromTicks: last.tick - period, toTicks: first.tick, fromValue: last.value, toValue: first.value });
  for (let i = 0; i < kf.length - 1; i++) {
    segs.push({ fromTicks: kf[i].tick, toTicks: kf[i + 1].tick, fromValue: kf[i].value, toValue: kf[i + 1].value });
  }
  segs.push({ fromTicks: last.tick, toTicks: first.tick + period, fromValue: last.value, toValue: first.value });
  const t = ((ticks % period) + period) % period;
  let seg = segs[segs.length - 1];
  for (const s of segs) if (t < s.toTicks) { seg = s; break; }
  if (t <= seg.fromTicks) return seg.fromValue;
  if (t >= seg.toTicks) return seg.toValue;
  const alpha = (t - seg.fromTicks) / (seg.toTicks - seg.fromTicks);
  return eslint(seg.fromValue, seg.toValue, refEase(track.easing, alpha));
}

function refModifier(modifier: string, kind: string, subject: number, argument: number): number {
  switch (modifier) {
    case 'override': return argument;
    case 'multiply': return subject * argument;
    case 'maximum': return Math.max(subject, argument);
    case 'multiply_rgb':
    case 'multiply_argb':
      if (subject === -1) return argument;
      if (argument === -1) return subject;
      return argb(
        red8(subject) * red8(argument) / 255 | 0,
        green8(subject) * green8(argument) / 255 | 0,
        blue8(subject) * blue8(argument) / 255 | 0,
        alpha8(subject) * alpha8(argument) / 255 | 0,
      );
    default: return argument;
  }
}

function easingKey(e: unknown): string {
  if (e === 'linear' || e === 'constant') return e;
  const c = (e as { cubic?: number[] }).cubic ?? (e as { cubicBezier?: number[] }).cubicBezier;
  return 'bezier:' + c!.map((v) => v.toFixed(3)).join(',');
}

// ---------------------------------------------------------------------------
// Parse EnvironmentAttributes.java: field name -> id, id -> type / default
// ---------------------------------------------------------------------------

const envAttrSrc = read(`${SRC}/world/attribute/EnvironmentAttributes.java`);
const fieldToId = new Map<string, string>();
for (const m of envAttrSrc.matchAll(/EnvironmentAttribute<[^>]+>\s+(\w+)\s*=\s*register\(\s*\n?\s*"([^"]+)"/g)) {
  fieldToId.set(m[1], m[2]);
}
const attrType = new Map<string, string>();
const attrDefault = new Map<string, number>();
for (const m of envAttrSrc.matchAll(/register\(\s*"([^"]+)",([\s\S]*?)\n\s*\);/g)) {
  const body = m[2];
  const type = /AttributeTypes\.(\w+)/.exec(body)?.[1];
  if (type) attrType.set(m[1], type);
  const def = /defaultValue\(([^)]*)\)/.exec(body)?.[1];
  if (def !== undefined) {
    const numeric = /^(-?\d+(?:\.\d+)?)[fF]?$/.exec(def.trim());
    if (numeric) attrDefault.set(m[1], Number(numeric[1]));
  }
}

function kindOf(id: string): string {
  const type = attrType.get(id);
  if (type === 'RGB_COLOR' || type === 'ARGB_COLOR') return 'color';
  return 'float';
}

// ---------------------------------------------------------------------------
// Parse Timelines.java: constants + OVERWORLD_DAY / MOON numeric tracks
// ---------------------------------------------------------------------------

const timelinesSrc = read(`${SRC}/world/timeline/Timelines.java`);
const consts = new Map<string, number>();
function evalValue(expr: string): number | null {
  expr = expr.trim();
  const num = /^(-?\d+(?:\.\d+)?)[fF]?$/.exec(expr);
  if (num) return Number(num[1]);
  if (consts.has(expr)) return consts.get(expr)!;
  const cf = /^ARGB\.colorFromFloat\(([^)]*)\)$/.exec(expr);
  if (cf) {
    const p = cf[1].split(',').map((s) => parseFloat(s));
    if (p.length === 4 && p.every((v) => Number.isFinite(v))) return refColorFromFloat(p[0], p[1], p[2], p[3]);
  }
  return null;
}
// constants first (they are declared before bootstrap())
for (const m of timelinesSrc.matchAll(/^\s*(?:float|int)\s+(\w+)\s*=\s*([^;]+);/gm)) {
  const v = evalValue(m[2].trim());
  if (v !== null) consts.set(m[1], v);
}
// named easing constants, e.g. `EasingType skyAngleEase = EasingType.symmetricCubicBezier(0.362F, 0.241F);`
const easingConsts = new Map<string, RefEasing>();
for (const m of timelinesSrc.matchAll(/EasingType\s+(\w+)\s*=\s*EasingType\.symmetricCubicBezier\(([\d.]+)F?,\s*([\d.]+)F?\)/g)) {
  const x1 = Number(m[2]);
  const y1 = Number(m[3]);
  easingConsts.set(m[1], { cubic: [x1, y1, 1 - x1, 1 - y1] });
}

const owStart = timelinesSrc.search(/context\.register\(\s*\n?\s*OVERWORLD_DAY,/);
const owEnd = timelinesSrc.search(/Timeline\.Builder moonPhases/);
if (owStart < 0 || owEnd < 0) {
  console.error('could not locate OVERWORLD_DAY registration in Timelines.java');
  process.exit(1);
}
const owBlock = timelinesSrc.slice(owStart, owEnd);

interface ParsedTrack extends RefTrack { type?: string }

function parseTracks(block: string): ParsedTrack[] {
  const starts = [...block.matchAll(/\.add(?:Modifier)?Track\(/g)].map((m) => m.index ?? 0);
  const out: ParsedTrack[] = [];
  for (let i = 0; i < starts.length; i++) {
    const chunk = block.slice(starts[i], i + 1 < starts.length ? starts[i + 1] : block.length);
    const field = /EnvironmentAttributes\.(\w+)/.exec(chunk)?.[1];
    if (!field) continue;
    const id = fieldToId.get(field) ?? field;
    const mod = /(?:FloatModifier|ColorModifier)\.(\w+)/.exec(chunk)?.[1];
    const typeName = attrType.get(id) ?? '';
    let modifier = 'override';
    if (mod === 'MULTIPLY') {
      modifier = typeName === 'RGB_COLOR' ? 'multiply_rgb' : typeName === 'ARGB_COLOR' ? 'multiply_argb' : 'multiply';
    } else if (mod === 'MULTIPLY_RGB') modifier = 'multiply_rgb';
    else if (mod === 'MULTIPLY_ARGB') modifier = 'multiply_argb';
    else if (mod === 'MAXIMUM') modifier = 'maximum';
    else if (mod === 'ALPHA_BLEND') modifier = 'alpha_blend';
    else if (mod === 'BLEND_TO_GRAY') modifier = 'blend_to_gray';
    else if (mod !== undefined) modifier = mod.toLowerCase();

    let easing: RefEasing = 'linear';
    const bez = /\.setEasing\(EasingType\.symmetricCubicBezier\(([\d.]+)F?,\s*([\d.]+)F?\)\)/.exec(chunk);
    const named = /\.setEasing\((\w+)\)/.exec(chunk);
    if (bez) {
      const x1 = Number(bez[1]);
      const y1 = Number(bez[2]);
      easing = { cubic: [x1, y1, 1 - x1, 1 - y1] };
    } else if (named && easingConsts.has(named[1])) {
      easing = easingConsts.get(named[1])!;
    } else if (/\.setEasing\(EasingType\.CONSTANT\)/.test(chunk)) {
      easing = 'constant';
    }

    const frames: RefKeyframe[] = [];
    let parseable = true;
    for (const kf of chunk.matchAll(/\.addKeyframe\((-?\d+),\s*([^)]*?)\)/g)) {
      const value = evalValue(kf[2]);
      if (value === null) { parseable = false; break; }
      frames.push({ tick: Number(kf[1]), value });
    }
    if (!parseable || frames.length === 0) continue;
    out.push({ id, field, modifier, easing, frames, type: attrType.get(id) });
  }
  return out;
}

const javaTracks = parseTracks(owBlock);
const javaById = new Map(javaTracks.map((t) => [t.id, t]));

// ---------------------------------------------------------------------------
// 0) Java <-> shipped datapack JSON cross check (day.json)
// ---------------------------------------------------------------------------

const dayJson = JSON.parse(read(`${ROOT}/src-vanilla/data/minecraft/timeline/day.json`));
const moonJson = JSON.parse(read(`${ROOT}/src-vanilla/data/minecraft/timeline/moon.json`));
const dimensionJson = JSON.parse(read(`${ROOT}/src-vanilla/data/minecraft/dimension_type/overworld.json`));

function normalizeJsonValue(value: unknown, id: string): number | null {
  if (typeof value === 'number') return value;
  if (typeof value === 'string' && value.startsWith('#')) {
    const hex = value.slice(1);
    if (hex.length === 8) return parseInt(hex, 16) | 0; // ARGB
    if (hex.length === 6) return (0xff000000 | parseInt(hex, 16)) | 0; // RGB -> opaque
  }
  return null;
}

/** datapack JSON uses the operation id ("multiply"); map it to the typed modifier. */
function jsonModifier(id: string, raw: string | undefined): string {
  if (raw === undefined) return 'override';
  if (raw === 'multiply') {
    const typeName = attrType.get(id) ?? '';
    if (typeName === 'RGB_COLOR') return 'multiply_rgb';
    if (typeName === 'ARGB_COLOR') return 'multiply_argb';
    return 'multiply';
  }
  return raw;
}

/** Tracks the light package actually consumes (Timelines and WeatherAttributes). */
const CONSUMED = new Set([
  'visual/fog_color',
  'visual/sky_color',
  'visual/sky_light_color',
  'visual/sky_light_factor',
  'gameplay/sky_light_level',
  'visual/sunrise_sunset_color',
  'visual/star_brightness',
  'visual/cloud_color',
  'visual/sun_angle',
  'visual/moon_angle',
  'visual/star_angle',
]);

console.log('== Java source vs shipped datapack (timeline/day.json) ==');
let jsonChecked = 0;
for (const [jsonId, raw] of Object.entries(dayJson.tracks as Record<string, any>)) {
  const id = jsonId.replace('minecraft:', '');
  const java = javaById.get(id);
  if (!java) { skipped.push(`day.json ${id} (no numeric Java parse)`); continue; }
  const frames: RefKeyframe[] = [];
  let ok = true;
  for (const k of raw.keyframes as { ticks: number; value: unknown }[]) {
    const v = normalizeJsonValue(k.value, id);
    if (v === null) { ok = false; break; }
    frames.push({ tick: k.ticks, value: v });
  }
  const jsonEasing = raw.ease === undefined ? 'linear'
    : (typeof raw.ease === 'string' ? raw.ease
      : { cubic: raw.ease.cubic_bezier as [number, number, number, number] });
  const same = ok
    && frames.length === java.frames.length
    && frames.every((f, i) => f.tick === java.frames[i].tick && (kindOf(id) === 'color' ? (f.value | 0) === (java.frames[i].value | 0) : Math.abs(f.value - java.frames[i].value) < 1e-6))
    && jsonModifier(id, raw.modifier) === java.modifier
    && easingKey(jsonEasing as RefEasing) === easingKey(java.easing);
  check(same, `day.json vs Java ${id}`, `${frames.length} keyframes`);
  jsonChecked++;
}
console.log(`  (${jsonChecked} numeric tracks cross-checked)`);

// ---------------------------------------------------------------------------
// 1) EnvironmentLighting.ts track table vs Java keyframes / modifier / easing
// ---------------------------------------------------------------------------

console.log('\n== EnvironmentLighting.ts OVERWORLD_DAY vs Timelines.java ==');
const tsTracks = OVERWORLD_DAY.tracks as Record<string, { modifier: string; easing: unknown; frames: [number, number][] }>;
const allIds = new Set([...Object.keys(tsTracks), ...javaById.keys()]);
for (const id of [...allIds].sort()) {
  const ts = tsTracks[id];
  const java = javaById.get(id);
  if (!java) { skipped.push(`${id} (not a numeric Java track)`); continue; }
  if (!CONSUMED.has(id)) { skipped.push(`${id} (gameplay/audio track, not consumed by the light package)`); continue; }
  if (!ts) { check(false, `${id} missing from EnvironmentLighting.ts`); continue; }
  const kind = kindOf(id);
  const framesSame = ts.frames.length === java.frames.length
    && ts.frames.every((f, i) => f[0] === java.frames[i].tick
      && (kind === 'color' ? (f[1] | 0) === (java.frames[i].value | 0) : Math.abs(f[1] - java.frames[i].value) < 1e-6));
  const modSame = ts.modifier === java.modifier;
  const easeSame = easingKey(ts.easing as RefEasing) === easingKey(java.easing);
  const tsKindOk = (ATTRIBUTE_KINDS[id] ?? 'float') === (kind === 'color' ? (id === 'visual/cloud_color' || id === 'visual/sunrise_sunset_color' ? 'argb' : 'rgb') : (attrType.get(id) === 'ANGLE_DEGREES' ? 'angle' : 'float'));

  // dense sampling comparison against the independent reference sampler
  let maxDelta = 0;
  let badTick = -1;
  for (let tick = 0; tick < OVERWORLD_DAY.periodTicks; tick += 7) {
    const ref = refSample(java, tick, OVERWORLD_DAY.periodTicks, kind);
    const got = sampleTrack(ts as never, tick, (ATTRIBUTE_KINDS[id] ?? 'float'));
    const delta = kind === 'color'
      ? Math.max(Math.abs(red8(ref) - red8(got)), Math.abs(green8(ref) - green8(got)), Math.abs(blue8(ref) - blue8(got)), Math.abs(alpha8(ref) - alpha8(got)))
      : Math.abs(ref - got);
    if (delta > maxDelta) { maxDelta = delta; badTick = tick; }
  }
  const samplingOk = kind === 'color' ? maxDelta <= 1 : maxDelta <= 1e-6;
  check(framesSame && modSame && easeSame && tsKindOk && samplingOk,
    `${id}`,
    `frames=${java.frames.length} modifier=${java.modifier} easing=${easingKey(java.easing)} maxDelta=${maxDelta.toExponential(2)}${badTick >= 0 && !samplingOk ? ` at t=${badTick}` : ''}${tsKindOk ? '' : ' KIND-MISMATCH'}`);
}

// ---------------------------------------------------------------------------
// 2) MOON timeline (period 192000) vs moon.json
// ---------------------------------------------------------------------------

console.log('\n== EnvironmentLighting.ts MOON_TIMELINE vs timeline/moon.json ==');
{
  const tsMoon = MOON_TIMELINE.tracks as Record<string, { modifier: string; easing: unknown; frames: [number, number][] }>;
  const slime = moonJson.tracks['minecraft:gameplay/surface_slime_spawn_chance'];
  const tsSlime = tsMoon['gameplay/surface_slime_spawn_chance'];
  const slimeOk = tsSlime.frames.length === slime.keyframes.length
    && tsSlime.frames.every((f, i) => f[0] === slime.keyframes[i].ticks && Math.abs(f[1] - slime.keyframes[i].value) < 1e-6)
    && tsSlime.modifier === slime.modifier && easingKey(tsSlime.easing as RefEasing) === slime.ease;
  check(MOON_TIMELINE.periodTicks === moonJson.period_ticks, 'moon period_ticks', `${MOON_TIMELINE.periodTicks}`);
  check(slimeOk, 'gameplay/surface_slime_spawn_chance', `${tsSlime.frames.length} keyframes modifier=${slime.modifier}`);

  const phaseNames = ['full_moon', 'waning_gibbous', 'third_quarter', 'waning_crescent', 'new_moon', 'waxing_crescent', 'first_quarter', 'waxing_gibbous'];
  const tsPhase = tsMoon['visual/moon_phase'];
  const jsonPhase = moonJson.tracks['minecraft:visual/moon_phase'];
  const phaseOk = tsPhase.frames.length === jsonPhase.keyframes.length
    && tsPhase.frames.every((f, i) => f[0] === jsonPhase.keyframes[i].ticks && f[1] === phaseNames.indexOf(jsonPhase.keyframes[i].value));
  check(phaseOk, 'visual/moon_phase', `${tsPhase.frames.length} phases`);
}

// ---------------------------------------------------------------------------
// 3) Base attribute values vs overworld.json + EnvironmentAttributes.java
// ---------------------------------------------------------------------------

console.log('\n== base attribute values vs dimension_type/overworld.json ==');
const dimensionAttributes: Record<string, number> = {};
for (const [jsonId, raw] of Object.entries(dimensionJson.attributes as Record<string, unknown>)) {
  const id = jsonId.replace('minecraft:', '');
  const v = normalizeJsonValue(raw, id);
  if (v !== null) dimensionAttributes[id] = v;
}
for (const id of ['visual/fog_color', 'visual/sky_color', 'visual/cloud_color', 'visual/ambient_light_color', 'visual/cloud_height']) {
  const ref = dimensionAttributes[id] ?? attrDefault.get(id) ?? 0;
  const got = attributeBase(id);
  const ok = kindOf(id) === 'color' ? (ref | 0) === (got | 0) : Math.abs(ref - got) < 1e-6;
  check(ok, `base ${id}`, `ref=0x${(ref >>> 0).toString(16)} ts=0x${(got >>> 0).toString(16)}`);
}

// ---------------------------------------------------------------------------
// 4) End-to-end: evaluateAttribute and computeSkyState vs reference (no weather)
// ---------------------------------------------------------------------------

console.log('\n== evaluateAttribute / computeSkyState vs reference (dry, rain=0) ==');
{
  let colorDelta = 0;
  let floatDelta = 0;
  let bad = '';
  for (const [id, java] of javaById) {
    if (!CONSUMED.has(id)) continue;
    const kind = kindOf(id);
    const base = dimensionAttributes[id] ?? attrDefault.get(id) ?? 0;
    for (let tick = 0; tick < 24000; tick += 13) {
      const argument = refSample(java, tick, 24000, kind);
      const ref = refModifier(java.modifier, kind, base, argument);
      const got = evaluateAttribute(id, tick);
      if (kind === 'color') {
        const delta = Math.max(Math.abs(red8(ref) - red8(got)), Math.abs(green8(ref) - green8(got)), Math.abs(blue8(ref) - blue8(got)));
        if (delta > colorDelta) { colorDelta = delta; bad = `${id}@${tick}`; }
      } else {
        const delta = Math.abs(ref - got);
        if (delta > floatDelta) { floatDelta = delta; bad = `${id}@${tick}`; }
      }
    }
  }
  check(colorDelta <= 1 && floatDelta <= 1e-6, 'evaluateAttribute(all consumed tracks)',
    `colorDelta<=${colorDelta} floatDelta=${floatDelta.toExponential(2)}${bad ? ` worst=${bad}` : ''}`);

  // SkyState field checks: rebuild the expected ARGB from the reference and
  // compare per channel with what computeSkyState returns.
  let stateColorDelta = 0;
  let stateFloatDelta = 0;
  let stateBad = '';
  for (let tick = 0; tick < 24000; tick += 17) {
    const state = computeSkyState(tick);
    const refOf = (id: string): number => {
      const java = javaById.get(id)!;
      const kind = kindOf(id);
      const base = dimensionAttributes[id] ?? attrDefault.get(id) ?? 0;
      return refModifier(java.modifier, kind, base, refSample(java, tick, 24000, kind));
    };
    const colorPairs: [string, number, [number, number, number]][] = [
      ['visual/sky_light_color', refOf('visual/sky_light_color'), state.skyLightColor],
      ['visual/sky_color', refOf('visual/sky_color'), state.skyColor],
      ['visual/fog_color', refOf('visual/fog_color'), state.fogColor],
      ['visual/cloud_color', refOf('visual/cloud_color'), state.cloudColor],
    ];
    for (const [id, ref, got] of colorPairs) {
      const delta = Math.max(
        Math.abs(red8(ref) - Math.round(got[0] * 255)),
        Math.abs(green8(ref) - Math.round(got[1] * 255)),
        Math.abs(blue8(ref) - Math.round(got[2] * 255)),
      );
      if (delta > stateColorDelta) { stateColorDelta = delta; stateBad = `${id}@${tick}`; }
    }
    const floatPairs: [string, number, number][] = [
      ['gameplay/sky_light_level', refOf('gameplay/sky_light_level'), state.skyLightLevel],
      ['visual/sky_light_factor', refOf('visual/sky_light_factor'), state.skyFactor],
      ['visual/star_brightness', refOf('visual/star_brightness'), state.starBrightness],
      ['visual/sun_angle', refOf('visual/sun_angle'), state.sunAngleDeg],
      ['visual/moon_angle', refOf('visual/moon_angle'), state.moonAngleDeg],
      ['visual/star_angle', refOf('visual/star_angle'), state.starAngleDeg],
    ];
    for (const [id, ref, got] of floatPairs) {
      const delta = Math.abs(ref - got);
      if (delta > stateFloatDelta) { stateFloatDelta = delta; stateBad = `${id}@${tick}`; }
    }
  }
  check(stateColorDelta <= 1 && stateFloatDelta <= 1e-6, 'computeSkyState fields',
    `colorDelta<=${stateColorDelta} floatDelta=${stateFloatDelta.toExponential(2)}${stateBad ? ` worst=${stateBad}` : ''}`);
}

// ---------------------------------------------------------------------------
// 5) Constants (Timelines.java) sanity: the values the light code embeds
// ---------------------------------------------------------------------------

console.log('\n== Timelines.java constants ==');
for (const [name, expected] of Object.entries({
  DAY_SKY_LIGHT_LEVEL: 15,
  NIGHT_SKY_LIGHT_LEVEL: 4,
  NIGHT_SKY_LIGHT_FACTOR: 0.24,
  NIGHT_SKY_LIGHT_COLOR: refColorFromFloat(1, 0.48, 0.48, 1),
  NIGHT_SKY_COLOR_MULTIPLIER: -16777216,
  NIGHT_FOG_COLOR_MULTIPLIER_START: refColorFromFloat(1, 0.05, 0.05, 0.09),
  NIGHT_FOG_COLOR_MULTIPLIER_END: refColorFromFloat(1, 0.09, 0.09, 0.09),
  NIGHT_CLOUD_COLOR_MULTIPLIER: refColorFromFloat(1, 0.1, 0.1, 0.15),
})) {
  const parsed = consts.get(name);
  check(parsed === expected, name, `java=${parsed} ref=${expected}`);
}

// ---------------------------------------------------------------------------

console.log(`\nSUMMARY: ${passes} PASS, ${failures} FAIL, ${skipped.length} skipped`);
for (const s of skipped) console.log(`  skipped: ${s}`);
if (failures > 0) { console.error('\nFAIL'); process.exit(1); }
console.log('\nOK');
