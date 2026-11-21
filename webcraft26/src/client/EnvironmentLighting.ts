// Port of net.minecraft.world.timeline.Timelines (OVERWORLD_DAY + MOON), the
// attribute/modifier machinery in net.minecraft.world.attribute.* and the lightmap
// generation of net.minecraft.client.renderer.Lightmap / LightmapRenderStateExtractor
// together with the bundled core/lightmap.fsh.
//
// 26.2 drives sky colour, fog, stars and the lightmap through timed attribute tracks
// instead of hard-coded day/night branches. Everything below is copied from those
// sources (the file:line references point at src-vanilla/...), so the
// lighting matches the original client instead of "looking about right".
//
// Sources:
//   net/minecraft/world/timeline/Timelines.java          (tracks, keyframes, constants)
//   net/minecraft/util/KeyframeTrackSampler.java         (segment baking + sampling)
//   net/minecraft/util/EasingType.java                   (cubic bezier easing)
//   net/minecraft/world/attribute/modifier/*.java        (modifier semantics)
//   net/minecraft/util/ARGB.java                         (integer colour maths)
//   net/minecraft/world/attribute/EnvironmentAttributes.java (defaults)
//   src-vanilla/data/minecraft/dimension_type/overworld.json (dimension overrides)
//   src-vanilla/data/minecraft/worldgen/biome/*.json      (biome overrides)
//   vanilla/assets/minecraft/shaders/core/lightmap.fsh    (lightmap formula)

export type Rgb = [number, number, number];

// ---------------------------------------------------------------------------
// ARGB.java integer colour helpers. All of these operate on signed 32 bit ints
// exactly like the Java code; channels are extracted from the unsigned pattern.
// ---------------------------------------------------------------------------

/** ARGB.as8BitChannel: floor(value * 255), not round. */
function as8BitChannel(value: number): number {
  return Math.floor(value * 255);
}

export function argb(r: number, g: number, b: number, a = 255): number {
  return ((a & 255) << 24 | (r & 255) << 16 | (g & 255) << 8 | (b & 255)) | 0;
}

/** ARGB.colorFromFloat(alpha, red, green, blue) - mind the argument order. */
export function colorFromFloat(a: number, r: number, g: number, b: number): number {
  return argb(as8BitChannel(r), as8BitChannel(g), as8BitChannel(b), as8BitChannel(a));
}

export function alpha8(color: number): number { return (color >>> 24) & 255; }
export function red8(color: number): number { return (color >> 16) & 255; }
export function green8(color: number): number { return (color >> 8) & 255; }
export function blue8(color: number): number { return color & 255; }

export function rgbOf(color: number): Rgb {
  return [red8(color) / 255, green8(color) / 255, blue8(color) / 255];
}

/** Mth.lerpInt: p0 + floor(alpha * (p1 - p0)). */
export function lerpInt(alpha: number, p0: number, p1: number): number {
  return p0 + Math.floor(alpha * (p1 - p0));
}

export function lerp(a: number, b: number, t: number): number { return a + (b - a) * t; }

/** ARGB.srgbLerp: per channel (alpha included) Mth.lerpInt. */
export function srgbLerp(alpha: number, p0: number, p1: number): number {
  return argb(
    lerpInt(alpha, red8(p0), red8(p1)),
    lerpInt(alpha, green8(p0), green8(p1)),
    lerpInt(alpha, blue8(p0), blue8(p1)),
    lerpInt(alpha, alpha8(p0), alpha8(p1)),
  );
}

/** ARGB.multiply: per channel a*b/255, with the -1 short circuits. */
export function multiply(lhs: number, rhs: number): number {
  if (lhs === -1) return rhs;
  if (rhs === -1) return lhs;
  return argb(
    red8(lhs) * red8(rhs) / 255,
    green8(lhs) * green8(rhs) / 255,
    blue8(lhs) * blue8(rhs) / 255,
    alpha8(lhs) * alpha8(rhs) / 255,
  );
}

/** ARGB.scaleRGB(color, scaleR, scaleG, scaleB): (int) truncation, clamped 0..255. */
export function scaleRgb(color: number, sr: number, sg: number, sb: number): number {
  const clamp = (v: number) => Math.min(255, Math.max(0, Math.trunc(v)));
  return argb(clamp(red8(color) * sr), clamp(green8(color) * sg), clamp(blue8(color) * sb), alpha8(color));
}

/** ARGB.greyscale: (int)(r*0.3 + g*0.59 + b*0.11). */
export function greyscale(color: number): number {
  const v = Math.trunc(red8(color) * 0.3 + green8(color) * 0.59 + blue8(color) * 0.11);
  return argb(v, v, v, alpha8(color));
}

/** ARGB.alphaBlend(destination, source). */
export function alphaBlend(destination: number, source: number): number {
  const sourceAlpha = alpha8(source);
  if (sourceAlpha === 255) return source;
  if (sourceAlpha === 0) return destination;
  const destAlpha = alpha8(destination);
  const outAlpha = sourceAlpha + (destAlpha * (255 - sourceAlpha) / 255 | 0);
  const mix = (dst: number, src: number) =>
    ((src * sourceAlpha + dst * (outAlpha - sourceAlpha)) / outAlpha) | 0;
  return argb(
    mix(red8(destination), red8(source)),
    mix(green8(destination), green8(source)),
    mix(blue8(destination), blue8(source)),
    outAlpha,
  );
}

// ---------------------------------------------------------------------------
// EasingType.java - only LINEAR / CONSTANT / cubic-bezier are used by the
// overworld timelines. The bezier solver mirrors the Java implementation
// (4 Newton steps then bisection).
// ---------------------------------------------------------------------------

export type EasingDef = 'linear' | 'constant' | { cubicBezier: [number, number, number, number] };

interface CubicCurve { a: number; b: number; c: number }

function curveFromControls(v1: number, v2: number): CubicCurve {
  return { a: 3 * v1 - 3 * v2 + 1, b: -6 * v1 + 3 * v2, c: 3 * v1 };
}

function curveSample(curve: CubicCurve, t: number): number {
  return ((curve.a * t + curve.b) * t + curve.c) * t;
}

function curveGradient(curve: CubicCurve, t: number): number {
  return (3 * curve.a * t + 2 * curve.b) * t + curve.c;
}

export function easingApply(easing: EasingDef, x: number): number {
  if (easing === 'linear') return x;
  if (easing === 'constant') return 0;
  const [x1, y1, x2, y2] = easing.cubicBezier;
  const xCurve = curveFromControls(x1, x2);
  const yCurve = curveFromControls(y1, y2);
  const solveT = (target: number): number => {
    let t = target;
    for (let i = 0; i < 4; i++) {
      const error = curveSample(xCurve, t) - target;
      if (Math.abs(error) < 1e-5) return t;
      const gradient = curveGradient(xCurve, t);
      if (gradient < 1e-5) break;
      t -= Math.min(0.25, Math.max(-0.25, error / gradient));
    }
    // EasingType.CubicBezier.solveTBisect
    let t0 = 0;
    let t1 = 1;
    for (let t2 = t; t0 < t1; t2 = (t1 + t0) / 2) {
      const error = curveSample(xCurve, t2) - target;
      if (Math.abs(error) < 1e-5) return t2;
      if (error < 0) t0 = t2; else t1 = t2;
    }
    return (t1 + t0) / 2;
  };
  return curveSample(yCurve, solveT(x));
}

// ---------------------------------------------------------------------------
// Timeline data. Values are the exact signed ints / floats from the Java source
// (Timelines.java:44-160) so scripts/verify-timelines.mts can compare them 1:1.
// ---------------------------------------------------------------------------

export type ModifierName =
  | 'override'
  | 'multiply'
  | 'maximum'
  | 'multiply_rgb'
  | 'multiply_argb'
  | 'alpha_blend'
  | 'blend_to_gray';

export type Keyframe = [tick: number, value: number];

export interface TrackDef {
  modifier: ModifierName;
  easing: EasingDef;
  frames: Keyframe[];
}

export interface TimelineDef {
  periodTicks: number;
  tracks: Record<string, TrackDef>;
}

/** Timelines.OVERWORLD_DAY, period 24000 (Timelines.java:44-160). */
export const OVERWORLD_DAY: TimelineDef = {
  periodTicks: 24000,
  tracks: {
    'visual/sun_angle': {
      modifier: 'override',
      easing: { cubicBezier: [0.362, 0.241, 0.638, 0.759] }, // skyAngleEase
      frames: [[6000, 360], [6000, 0]],
    },
    'visual/moon_angle': {
      modifier: 'override',
      easing: { cubicBezier: [0.362, 0.241, 0.638, 0.759] },
      frames: [[6000, 540], [6000, 180]],
    },
    'visual/star_angle': {
      modifier: 'override',
      easing: { cubicBezier: [0.362, 0.241, 0.638, 0.759] },
      frames: [[6000, 360], [6000, 0]],
    },
    'visual/fog_color': {
      modifier: 'multiply_rgb',
      easing: 'linear',
      // NIGHT_FOG_COLOR_MULTIPLIER_START 0xff0c0c16 / END 0xff161616
      frames: [[133, -1], [11867, -1], [13670, -15987690], [22330, -15329770]],
    },
    'visual/sky_color': {
      modifier: 'multiply_rgb',
      easing: 'linear',
      frames: [[133, -1], [11867, -1], [13670, -16777216], [22330, -16777216]],
    },
    'visual/sky_light_color': {
      modifier: 'multiply_rgb',
      easing: 'linear',
      // NIGHT_SKY_LIGHT_COLOR = ARGB.colorFromFloat(1, 0.48, 0.48, 1) = 0xff7a7aff
      frames: [[730, -1], [11270, -1], [13140, -8750337], [22860, -8750337]],
    },
    'visual/sky_light_factor': {
      modifier: 'multiply',
      easing: 'linear',
      frames: [[730, 1], [11270, 1], [13140, 0.24], [22860, 0.24]],
    },
    'gameplay/sky_light_level': {
      modifier: 'multiply',
      easing: 'linear',
      frames: [[133, 1], [11867, 1], [13670, 0.26666668], [22330, 0.26666668]],
    },
    'visual/sunrise_sunset_color': {
      modifier: 'override',
      easing: 'linear',
      frames: [
        [71, 1609540403], [310, 703969843], [565, 117167155], [730, 16770355],
        [11270, 16770355], [11397, 83679283], [11522, 268028723], [11690, 703969843],
        [11929, 1609540403], [12243, -1310226637], [12358, -857440717], [12512, -371166669],
        [12613, -153261261], [12732, -19242189], [12841, -19440589], [13035, -321760973],
        [13252, -1043577037], [13775, 918435635], [13888, 532362547], [14039, 163001139],
        [14192, 11744051], [21807, 11678515], [21961, 163001139], [22112, 532362547],
        [22225, 918435635], [22748, -1043577037], [22965, -321760973], [23159, -19440589],
        [23272, -19242189], [23488, -371166669], [23642, -857440717], [23757, -1310226637],
      ],
    },
    'visual/star_brightness': {
      modifier: 'maximum',
      easing: 'linear',
      frames: [
        [92, 0.037], [627, 0], [11373, 0], [11732, 0.016], [11959, 0.044], [12399, 0.143],
        [12729, 0.258], [13228, 0.5], [22772, 0.5], [23032, 0.364], [23356, 0.225], [23758, 0.101],
      ],
    },
    'visual/cloud_color': {
      modifier: 'multiply_argb',
      easing: 'linear',
      frames: [[133, -1], [11867, -1], [13670, -15132378], [22330, -15132378]],
    },
  },
};

/**
 * Timelines.MOON, period 24000 * MoonPhase.COUNT (Timelines.java:161-175). The
 * moon phase is not interpolated (AttributeTypes.MOON_PHASE uses ofNotInterpolated,
 * i.e. LerpFunction.ofStep(1.0)), so the sampled value is the phase whose
 * startTick is <= totalTicks.
 */
export const MOON_TIMELINE: TimelineDef = {
  periodTicks: 24000 * 8,
  tracks: {
    'visual/moon_phase': {
      modifier: 'override',
      easing: 'linear',
      frames: [[0, 0], [24000, 1], [48000, 2], [72000, 3], [96000, 4], [120000, 5], [144000, 6], [168000, 7]],
    },
    'gameplay/surface_slime_spawn_chance': {
      // DimensionType.MOON_BRIGHTNESS_PER_PHASE[phase] * 0.5, CONSTANT easing
      modifier: 'maximum',
      easing: 'constant',
      frames: [[0, 0.5], [24000, 0.375], [48000, 0.25], [72000, 0.125], [96000, 0], [120000, 0.125], [144000, 0.25], [168000, 0.375]],
    },
  },
};

// ---------------------------------------------------------------------------
// Base attribute values: EnvironmentAttributes.java defaults + the overworld
// dimension override (data/minecraft/dimension_type/overworld.json). These are
// the values the timeline modifiers are applied to.
// ---------------------------------------------------------------------------

export type AttributeKind = 'float' | 'angle' | 'rgb' | 'argb';

export const ATTRIBUTE_KINDS: Record<string, AttributeKind> = {
  'gameplay/sky_light_level': 'float',
  'visual/sky_light_factor': 'float',
  'visual/sky_light_color': 'rgb',
  'visual/fog_color': 'rgb',
  'visual/sky_color': 'rgb',
  'visual/cloud_color': 'argb',
  'visual/sunrise_sunset_color': 'argb',
  'visual/star_brightness': 'float',
  'visual/sun_angle': 'angle',
  'visual/moon_angle': 'angle',
  'visual/star_angle': 'angle',
  'visual/block_light_tint': 'rgb',
  'visual/ambient_light_color': 'rgb',
  'visual/night_vision_color': 'rgb',
  'visual/fog_start_distance': 'float',
  'visual/fog_end_distance': 'float',
  'visual/sky_fog_end_distance': 'float',
  'visual/cloud_fog_end_distance': 'float',
  'visual/water_fog_color': 'rgb',
  'visual/water_fog_start_distance': 'float',
  'visual/water_fog_end_distance': 'float',
  'visual/cloud_height': 'float',
  'gameplay/surface_slime_spawn_chance': 'float',
};

/** EnvironmentAttributes.java defaultValue(...) entries used by the environment passes. */
export const ATTRIBUTE_DEFAULTS: Record<string, number> = {
  'visual/fog_color': 0,
  'visual/fog_start_distance': 0,
  'visual/fog_end_distance': 1024,
  'visual/sky_fog_end_distance': 512,
  'visual/cloud_fog_end_distance': 2048,
  'visual/water_fog_color': -16448205, // 0x050533
  'visual/water_fog_start_distance': -8,
  'visual/water_fog_end_distance': 96,
  'visual/sky_color': 0,
  'visual/sunrise_sunset_color': 0,
  'visual/cloud_color': 0,
  'visual/cloud_height': 192.33,
  'visual/sun_angle': 0,
  'visual/moon_angle': 0,
  'visual/star_angle': 0,
  'visual/star_brightness': 0,
  'visual/block_light_tint': -10100, // 0xFFFFD88C, EnvironmentAttributes.java:72
  'visual/sky_light_color': -1, // 0xFFFFFFFF
  'visual/sky_light_factor': 1,
  'visual/night_vision_color': -6710887, // 0xFF999999
  'visual/ambient_light_color': -16777216, // 0xFF000000
  'gameplay/sky_light_level': 15,
};

/** Overworld dimension attribute overrides, dimension_type/overworld.json. */
export const OVERWORLD_ATTRIBUTES: Record<string, number> = {
  ...ATTRIBUTE_DEFAULTS,
  'visual/ambient_light_color': 0xff0a0a0a | 0,
  'visual/cloud_color': 0xccffffff | 0,
  'visual/cloud_height': 192.33,
  'visual/fog_color': 0xffc0d8ff | 0,
  'visual/sky_color': 0xff78a7ff | 0,
};

/** Attribute value ranges (AttributeRange in EnvironmentAttributes.java) used by sanitizeValue. */
const ATTRIBUTE_RANGES: Record<string, [number, number]> = {
  'gameplay/sky_light_level': [0, 15],
  'visual/sky_light_factor': [0, 1],
  'visual/star_brightness': [0, 1],
  'gameplay/surface_slime_spawn_chance': [0, 1],
  'visual/fog_end_distance': [0, Infinity],
  'visual/sky_fog_end_distance': [0, Infinity],
  'visual/cloud_fog_end_distance': [0, Infinity],
  'visual/water_fog_end_distance': [0, Infinity],
};

/**
 * Per-biome attribute overrides parsed from data/minecraft/worldgen/biome/*.json.
 * Only entries that differ from the overworld dimension defaults are listed.
 * biome name -> values; the same attribute override semantics as the vanilla
 * biome attribute layer (EnvironmentAttributeMap.set = override).
 */
export interface BiomeEnvironment {
  skyColor?: number;
  fogColor?: number;
  waterFogColor?: number;
  waterFogEndDistanceMultiplier?: number;
}

export const BIOME_ENVIRONMENTS: Record<string, BiomeEnvironment> = {
  // visual/sky_color overrides (48 biomes differ from #78a7ff)
  'minecraft:badlands': { skyColor: 0xff6eb1ff | 0 },
  'minecraft:desert': { skyColor: 0xff6eb1ff | 0 },
  'minecraft:eroded_badlands': { skyColor: 0xff6eb1ff | 0 },
  'minecraft:savanna': { skyColor: 0xff6eb1ff | 0 },
  'minecraft:savanna_plateau': { skyColor: 0xff6eb1ff | 0 },
  'minecraft:windswept_savanna': { skyColor: 0xff6eb1ff | 0 },
  'minecraft:wooded_badlands': { skyColor: 0xff6eb1ff | 0 },
  'minecraft:stony_peaks': { skyColor: 0xff76a8ff | 0 },
  'minecraft:bamboo_jungle': { skyColor: 0xff77a8ff | 0 },
  'minecraft:jungle': { skyColor: 0xff77a8ff | 0 },
  'minecraft:mushroom_fields': { skyColor: 0xff77a8ff | 0 },
  'minecraft:sparse_jungle': { skyColor: 0xff77a8ff | 0 },
  'minecraft:dark_forest': { skyColor: 0xff79a6ff | 0 },
  'minecraft:flower_forest': { skyColor: 0xff79a6ff | 0 },
  'minecraft:forest': { skyColor: 0xff79a6ff | 0 },
  'minecraft:birch_forest': { skyColor: 0xff7aa5ff | 0 },
  'minecraft:old_growth_birch_forest': { skyColor: 0xff7aa5ff | 0 },
  'minecraft:cherry_grove': { skyColor: 0xff7ba4ff | 0, waterFogColor: 0xff5db7ef | 0 },
  'minecraft:cold_ocean': { skyColor: 0xff7ba4ff | 0 },
  'minecraft:deep_cold_ocean': { skyColor: 0xff7ba4ff | 0 },
  'minecraft:deep_frozen_ocean': { skyColor: 0xff7ba4ff | 0 },
  'minecraft:deep_lukewarm_ocean': { skyColor: 0xff7ba4ff | 0, waterFogColor: 0xff041633 | 0 },
  'minecraft:deep_ocean': { skyColor: 0xff7ba4ff | 0 },
  'minecraft:lukewarm_ocean': { skyColor: 0xff7ba4ff | 0, waterFogColor: 0xff041633 | 0 },
  'minecraft:lush_caves': { skyColor: 0xff7ba4ff | 0 },
  'minecraft:meadow': { skyColor: 0xff7ba4ff | 0 },
  'minecraft:ocean': { skyColor: 0xff7ba4ff | 0 },
  'minecraft:river': { skyColor: 0xff7ba4ff | 0 },
  'minecraft:the_void': { skyColor: 0xff7ba4ff | 0 },
  'minecraft:warm_ocean': { skyColor: 0xff7ba4ff | 0, waterFogColor: 0xff041f33 | 0 },
  'minecraft:old_growth_pine_taiga': { skyColor: 0xff7ca3ff | 0 },
  'minecraft:stony_shore': { skyColor: 0xff7da2ff | 0 },
  'minecraft:windswept_forest': { skyColor: 0xff7da2ff | 0 },
  'minecraft:windswept_gravelly_hills': { skyColor: 0xff7da2ff | 0 },
  'minecraft:windswept_hills': { skyColor: 0xff7da2ff | 0 },
  'minecraft:old_growth_spruce_taiga': { skyColor: 0xff7da3ff | 0 },
  'minecraft:taiga': { skyColor: 0xff7da3ff | 0 },
  'minecraft:frozen_ocean': { skyColor: 0xff7fa1ff | 0 },
  'minecraft:frozen_river': { skyColor: 0xff7fa1ff | 0 },
  'minecraft:ice_spikes': { skyColor: 0xff7fa1ff | 0 },
  'minecraft:snowy_beach': { skyColor: 0xff7fa1ff | 0 },
  'minecraft:snowy_plains': { skyColor: 0xff7fa1ff | 0 },
  'minecraft:grove': { skyColor: 0xff81a0ff | 0 },
  'minecraft:snowy_slopes': { skyColor: 0xff829fff | 0 },
  'minecraft:snowy_taiga': { skyColor: 0xff839eff | 0 },
  'minecraft:frozen_peaks': { skyColor: 0xff859dff | 0 },
  'minecraft:jagged_peaks': { skyColor: 0xff859dff | 0 },
  'minecraft:pale_garden': { skyColor: 0xffb9b9b9 | 0, fogColor: 0xff817770 | 0, waterFogColor: 0xff556980 | 0 },
  // visual/fog_color overrides (nether biomes + swamp/cave variants)
  'minecraft:basalt_deltas': { fogColor: 0xff685f70 | 0 },
  'minecraft:crimson_forest': { fogColor: 0xff330303 | 0 },
  'minecraft:nether_wastes': { fogColor: 0xff330808 | 0 },
  'minecraft:soul_sand_valley': { fogColor: 0xff1b4745 | 0 },
  'minecraft:warped_forest': { fogColor: 0xff1a051a | 0 },
  'minecraft:sulfur_caves': { fogColor: 0xff8cb831 | 0, waterFogColor: 0xff17543c | 0 },
  'minecraft:mangrove_swamp': { waterFogColor: 0xff4d7a60 | 0, waterFogEndDistanceMultiplier: 0.85 },
  'minecraft:swamp': { waterFogColor: 0xff232317 | 0, waterFogEndDistanceMultiplier: 0.85 },
};

export function biomeEnvironment(biomeName?: string): BiomeEnvironment {
  return biomeName ? BIOME_ENVIRONMENTS[biomeName] ?? {} : {};
}

// ---------------------------------------------------------------------------
// KeyframeTrackSampler.java: bake segments once, including the period wrap
// segments (the vanilla sampler prepends a segment from the last keyframe one
// period earlier and appends one to the first keyframe one period later).
// ---------------------------------------------------------------------------

export interface Segment {
  fromTicks: number;
  toTicks: number;
  fromValue: number;
  toValue: number;
  easing: EasingDef;
}

export function bakeSegments(track: TrackDef, periodTicks: number): Segment[] {
  const frames = track.frames;
  if (frames.length === 0) throw new Error('track has no keyframes');
  if (frames.length === 1) {
    const [tick, value] = frames[0];
    return [{ fromTicks: tick, toTicks: tick, fromValue: value, toValue: value, easing: 'constant' }];
  }
  const segments: Segment[] = [];
  const first = frames[0];
  const last = frames[frames.length - 1];
  const easing = track.easing;
  // leading wrap segment (last keyframe of the previous period -> first keyframe)
  segments.push({
    fromTicks: last[0] - periodTicks,
    toTicks: first[0],
    fromValue: last[1],
    toValue: first[1],
    easing,
  });
  for (let i = 0; i < frames.length - 1; i++) {
    const a = frames[i];
    const b = frames[i + 1];
    segments.push({ fromTicks: a[0], toTicks: b[0], fromValue: a[1], toValue: b[1], easing });
  }
  // trailing wrap segment (last keyframe -> first keyframe of the next period)
  segments.push({
    fromTicks: last[0],
    toTicks: first[0] + periodTicks,
    fromValue: last[1],
    toValue: first[1],
    easing,
  });
  return segments;
}

export function floorMod(value: number, mod: number): number {
  return ((value % mod) + mod) % mod;
}

/**
 * KeyframeTrackSampler.sample with the vanilla type-aware keyframe lerp
 * (AttributeType.keyframeLerp): colours use ARGB::srgbLerp, floats and angles
 * use Mth::lerp. Angle keyframes are plain floats - ANGLE_DEGREES passes
 * LerpFunction.ofFloat() as its keyframe lerp.
 */
export function sampleTrack(
  track: TrackDef,
  ticks: number,
  kind: AttributeKind = 'float',
  periodTicks: number = OVERWORLD_DAY.periodTicks,
): number {
  const segments = bakeSegments(track, periodTicks);
  const sampleTicks = floorMod(ticks, periodTicks);
  let segment = segments[segments.length - 1];
  for (const candidate of segments) {
    if (sampleTicks < candidate.toTicks) { segment = candidate; break; }
  }
  if (sampleTicks <= segment.fromTicks) return segment.fromValue;
  if (sampleTicks >= segment.toTicks) return segment.toValue;
  const alpha = (sampleTicks - segment.fromTicks) / (segment.toTicks - segment.fromTicks);
  const eased = easingApply(segment.easing, alpha);
  if (kind === 'rgb' || kind === 'argb') return srgbLerp(eased, segment.fromValue, segment.toValue);
  return lerp(segment.fromValue, segment.toValue, eased);
}

export interface WeatherArgumentFloat { value: number; alpha: number }
export interface WeatherArgumentGray { brightness: number; factor: number }
export type WeatherArgument = number | WeatherArgumentFloat | WeatherArgumentGray;

function isFloatWithAlpha(arg: WeatherArgument): arg is WeatherArgumentFloat {
  return typeof arg === 'object' && 'value' in arg;
}
function isGray(arg: WeatherArgument): arg is WeatherArgumentGray {
  return typeof arg === 'object' && 'brightness' in arg;
}

/** AttributeModifier.apply for every modifier the overworld timelines / weather use. */
export function applyModifier(kind: AttributeKind, modifier: ModifierName, subject: number, argument: WeatherArgument): number {
  switch (modifier) {
    case 'override': return argument as number;
    case 'multiply': return subject * (argument as number);
    case 'maximum': return Math.max(subject, argument as number);
    case 'multiply_rgb':
    case 'multiply_argb': return multiply(subject, argument as number);
    case 'alpha_blend':
      if (isFloatWithAlpha(argument)) return lerp(subject, argument.value, argument.alpha);
      return alphaBlend(subject, argument as number);
    case 'blend_to_gray': {
      const gray = argument as WeatherArgumentGray;
      const multipliedGreyscale = scaleRgb(greyscale(subject), gray.brightness, gray.brightness, gray.brightness);
      return srgbLerp(gray.factor, subject, multipliedGreyscale);
    }
  }
}

/** Lerp between two attribute values of the same kind (stateChangeLerp). */
function stateChangeLerp(kind: AttributeKind, alpha: number, from: number, to: number): number {
  if (kind === 'rgb' || kind === 'argb') return srgbLerp(alpha, from, to);
  return lerp(from, to, alpha);
}

function sanitize(attributeId: string, value: number): number {
  const range = ATTRIBUTE_RANGES[attributeId];
  if (!range) return value;
  return Math.min(range[1], Math.max(range[0], value));
}

interface WeatherEntry { modifier: ModifierName; argument: WeatherArgument }

/**
 * WeatherAttributes.java: RAIN / THUNDER attribute layers. They are added after
 * the timeline layers (EnvironmentAttributeSystem.addDefaultLayers order:
 * dimension -> biome -> timelines -> weather), so they modify the already
 * time-adjusted value.
 */
const RAIN_ATTRIBUTES: Record<string, WeatherEntry> = {
  'visual/sky_color': { modifier: 'blend_to_gray', argument: { brightness: 0.6, factor: 0.75 } },
  'visual/fog_color': { modifier: 'multiply_rgb', argument: colorFromFloat(1.0, 0.5, 0.5, 0.6) },
  'visual/cloud_color': { modifier: 'blend_to_gray', argument: { brightness: 0.24, factor: 0.5 } },
  'gameplay/sky_light_level': { modifier: 'alpha_blend', argument: { value: 4.0, alpha: 0.3125 } },
  'visual/sky_light_color': { modifier: 'alpha_blend', argument: argb(0x7a, 0x7a, 0xff, as8BitChannel(0.3125)) },
  'visual/sky_light_factor': { modifier: 'alpha_blend', argument: { value: 0.24, alpha: 0.3125 } },
  'visual/star_brightness': { modifier: 'override', argument: 0 },
  'visual/sunrise_sunset_color': { modifier: 'multiply_argb', argument: colorFromFloat(1.0, 0.5, 0.5, 0.6) },
};

const THUNDER_ATTRIBUTES: Record<string, WeatherEntry> = {
  'visual/sky_color': { modifier: 'blend_to_gray', argument: { brightness: 0.24, factor: 0.94 } },
  'visual/fog_color': { modifier: 'multiply_rgb', argument: colorFromFloat(1.0, 0.25, 0.25, 0.3) },
  'visual/cloud_color': { modifier: 'blend_to_gray', argument: { brightness: 0.095, factor: 0.94 } },
  'gameplay/sky_light_level': { modifier: 'alpha_blend', argument: { value: 4.0, alpha: 0.52734375 } },
  'visual/sky_light_color': { modifier: 'alpha_blend', argument: argb(0x7a, 0x7a, 0xff, as8BitChannel(0.52734375)) },
  'visual/sky_light_factor': { modifier: 'alpha_blend', argument: { value: 0.24, alpha: 0.52734375 } },
  'visual/star_brightness': { modifier: 'override', argument: 0 },
  'visual/sunrise_sunset_color': { modifier: 'multiply_argb', argument: colorFromFloat(1.0, 0.25, 0.25, 0.3) },
};

function applyWeatherLayer(attributeId: string, base: number, entries: Record<string, WeatherEntry>, level: number): number {
  const entry = entries[attributeId];
  if (!entry || level <= 0) return base;
  const kind = ATTRIBUTE_KINDS[attributeId] ?? 'float';
  const modified = applyModifier(kind, entry.modifier, base, entry.argument);
  return stateChangeLerp(kind, Math.min(1, level), base, modified);
}

// ---------------------------------------------------------------------------
// Attribute evaluation: base value -> timeline modifier -> weather layers.
// ---------------------------------------------------------------------------

export interface SkyOptions {
  /** 0..1 rain strength (ClientLevel.getRainLevel). */
  rainLevel?: number;
  /** 0..1 thunder strength (ClientLevel.getThunderLevel). */
  thunderLevel?: number;
  /** biome id like "minecraft:plains"; enables the per-biome attribute overrides. */
  biomeName?: string;
  /** 0..1 night vision strength (GameRenderer.nightVisionScale). */
  nightVisionIntensity?: number;
  /** ARGB night vision colour, default EnvironmentAttributes.NIGHT_VISION_COLOR. */
  nightVisionColorArgb?: number;
  /** 0..1 darkness effect scale (LightmapRenderStateExtractor.calculateDarknessScale). */
  darknessScale?: number;
  /** 0..1 boss overlay world darkening (GameRenderer.bossOverlayWorldDarkening). */
  bossOverlayWorldDarkening?: number;
}

/** Base value of an attribute for the overworld at the camera position. */
export function attributeBase(attributeId: string, opts: SkyOptions = {}): number {
  const biome = biomeEnvironment(opts.biomeName);
  switch (attributeId) {
    case 'visual/sky_color': return biome.skyColor ?? OVERWORLD_ATTRIBUTES['visual/sky_color'];
    case 'visual/fog_color': return biome.fogColor ?? OVERWORLD_ATTRIBUTES['visual/fog_color'];
    case 'visual/water_fog_color': return biome.waterFogColor ?? OVERWORLD_ATTRIBUTES['visual/water_fog_color'];
    default: return OVERWORLD_ATTRIBUTES[attributeId] ?? ATTRIBUTE_DEFAULTS[attributeId] ?? 0;
  }
}

/** Full attribute value (base + timeline + weather) at `ticks` for the overworld. */
export function evaluateAttribute(attributeId: string, ticks: number, opts: SkyOptions = {}): number {
  const kind = ATTRIBUTE_KINDS[attributeId] ?? 'float';
  let value = attributeBase(attributeId, opts);

  const track = OVERWORLD_DAY.tracks[attributeId];
  if (track) {
    const argument = sampleTrack(track, ticks, kind);
    value = applyModifier(kind, track.modifier, value, argument);
  }

  const thunder = Math.min(1, Math.max(0, opts.thunderLevel ?? 0));
  const rain = Math.max(0, Math.min(1, opts.rainLevel ?? 0) - thunder);
  value = applyWeatherLayer(attributeId, value, RAIN_ATTRIBUTES, rain);
  value = applyWeatherLayer(attributeId, value, THUNDER_ATTRIBUTES, thunder);
  return sanitize(attributeId, value);
}

/**
 * MoonPhase at absolute world tick (`Timelines.MOON`, period 192000). The phase
 * is not interpolated, so it is the last keyframe at or before the current tick.
 */
export function moonPhaseAt(totalTicks: number): number {
  return floorMod(Math.floor(totalTicks / 24000), 8);
}

/** SLIME spawn chance from the MOON timeline (gameplay, DimensionType table). */
export function surfaceSlimeSpawnChanceAt(totalTicks: number): number {
  const track = MOON_TIMELINE.tracks['gameplay/surface_slime_spawn_chance'];
  return Math.max(0, sampleTrack(track, totalTicks, 'float', MOON_TIMELINE.periodTicks));
}

// ---------------------------------------------------------------------------
// SkyState: the single source of truth for sky / fog / lightmap consumers.
// ---------------------------------------------------------------------------

export interface SkyState {
  /** 0..15 gameplay sky light level attribute (15 day, 4 night; WeatherAttributes can lower it). */
  skyLightLevel: number;
  /** Level.getSkyDarken(): (int)(15 - skyLightLevel). Gameplay only, not the render lightmap. */
  skyDarken: number;
  /** Lightmap SkyFactor (1 day, 0.24 night). */
  skyFactor: number;
  skyLightColor: Rgb;
  blockFactor: number;
  blockLightTint: Rgb;
  ambientColor: Rgb;
  /** base sky colour after the day modifier (0,0,0 at night). */
  skyColor: Rgb;
  /** FOG_COLOR attribute after the day modifier (night ~ #090916). */
  fogColor: Rgb;
  cloudColor: Rgb;
  /** ARGB cloud colour including the alpha channel. */
  cloudColorArgb: number;
  sunriseColor: Rgb;
  /** SUNRISE_SUNSET_COLOR as ARGB (alpha is the glow strength). */
  sunriseColorArgb: number;
  /** 0..1 star brightness (timeline attribute). */
  starBrightness: number;
  sunAngleDeg: number;
  moonAngleDeg: number;
  starAngleDeg: number;
  /** 0..7 (0 = full moon), from the MOON timeline. */
  moonPhase: number;
  /** gamma (brightness option), 0 by default. */
  brightness: number;
  // --- extra environment attributes the fog / sky / render passes need ---
  cloudHeight: number;
  fogStartDistance: number;
  fogEndDistance: number;
  skyFogEndDistance: number;
  cloudFogEndDistance: number;
  waterFogColor: Rgb;
  waterFogStartDistance: number;
  waterFogEndDistance: number;
  // --- lightmap inputs that are not simple attributes ---
  nightVisionIntensity: number;
  nightVisionColor: Rgb;
  darknessScale: number;
  bossOverlayWorldDarkening: number;
  rainLevel: number;
  thunderLevel: number;
}

export const DAY_PERIOD = 24000;

export const DEFAULT_SKY: SkyState = {
  skyLightLevel: 15,
  skyDarken: 0,
  skyFactor: 1,
  skyLightColor: [1, 1, 1],
  blockFactor: 1.4,
  blockLightTint: rgbOf(-10100),
  ambientColor: rgbOf(0xff0a0a0a | 0),
  skyColor: rgbOf(0xff78a7ff | 0),
  fogColor: rgbOf(0xffc0d8ff | 0),
  cloudColor: [1, 1, 1],
  cloudColorArgb: 0xccffffff | 0,
  sunriseColor: [1, 1, 1],
  sunriseColorArgb: 0,
  starBrightness: 0,
  sunAngleDeg: 0,
  moonAngleDeg: 0,
  starAngleDeg: 0,
  moonPhase: 0,
  brightness: 0,
  cloudHeight: 192.33,
  fogStartDistance: 0,
  fogEndDistance: 1024,
  skyFogEndDistance: 512,
  cloudFogEndDistance: 2048,
  waterFogColor: rgbOf(-16448205),
  waterFogStartDistance: -8,
  waterFogEndDistance: 96,
  nightVisionIntensity: 0,
  nightVisionColor: rgbOf(-6710887),
  darknessScale: 0,
  bossOverlayWorldDarkening: 0,
  rainLevel: 0,
  thunderLevel: 0,
};

/**
 * Evaluates the overworld day timeline (Timelines.OVERWORLD_DAY) plus the weather
 * attribute layers. `worldTime` is in ticks; the value is sampled continuously
 * (vanilla samples at integer ticks and partial-lerps in the probe, which differs
 * by at most one tick's worth of curve).
 */
export function computeSkyState(worldTime: number, brightnessOption = 0, opts: SkyOptions = {}): SkyState {
  const value = (id: string) => evaluateAttribute(id, worldTime, opts);

  const skyLightLevel = value('gameplay/sky_light_level');
  const skyFactor = value('visual/sky_light_factor');
  const skyLightColorArgb = value('visual/sky_light_color');
  const skyColorArgb = value('visual/sky_color');
  const fogColorArgb = value('visual/fog_color');
  const cloudColorArgb = value('visual/cloud_color');
  const sunriseColorArgb = value('visual/sunrise_sunset_color');

  const nightVisionIntensity = Math.min(1, Math.max(0, opts.nightVisionIntensity ?? 0));
  const darkMult = opts.biomeName ? BIOME_ENVIRONMENTS[opts.biomeName]?.waterFogEndDistanceMultiplier ?? 1 : 1;

  return {
    skyLightLevel,
    skyDarken: Math.trunc(15 - skyLightLevel),
    skyFactor,
    skyLightColor: rgbOf(skyLightColorArgb),
    blockFactor: 1.4,
    blockLightTint: rgbOf(value('visual/block_light_tint')),
    ambientColor: rgbOf(value('visual/ambient_light_color')),
    skyColor: rgbOf(skyColorArgb),
    fogColor: rgbOf(fogColorArgb),
    cloudColor: rgbOf(cloudColorArgb),
    cloudColorArgb,
    sunriseColor: rgbOf(sunriseColorArgb),
    sunriseColorArgb,
    starBrightness: value('visual/star_brightness'),
    sunAngleDeg: value('visual/sun_angle'),
    moonAngleDeg: value('visual/moon_angle'),
    starAngleDeg: value('visual/star_angle'),
    moonPhase: moonPhaseAt(worldTime),
    brightness: brightnessOption,
    cloudHeight: value('visual/cloud_height'),
    fogStartDistance: value('visual/fog_start_distance'),
    fogEndDistance: value('visual/fog_end_distance'),
    skyFogEndDistance: value('visual/sky_fog_end_distance'),
    cloudFogEndDistance: value('visual/cloud_fog_end_distance'),
    waterFogColor: rgbOf(attributeBase('visual/water_fog_color', opts)),
    waterFogStartDistance: value('visual/water_fog_start_distance'),
    waterFogEndDistance: value('visual/water_fog_end_distance') * darkMult,
    nightVisionIntensity,
    nightVisionColor: opts.nightVisionColorArgb !== undefined ? rgbOf(opts.nightVisionColorArgb) : rgbOf(value('visual/night_vision_color')),
    darknessScale: opts.darknessScale ?? 0,
    bossOverlayWorldDarkening: opts.bossOverlayWorldDarkening ?? 0,
    rainLevel: Math.min(1, Math.max(0, opts.rainLevel ?? 0)),
    thunderLevel: Math.min(1, Math.max(0, opts.thunderLevel ?? 0)),
  };
}

/**
 * Level.isBrightOutside(): `!dimensionType().hasFixedTime() && skyDarken < 4`
 * (Level.java:384). The overworld has a fixed time = false, so the flag only
 * matters for dimensions with a fixed clock (nether/end); callers can pass it.
 * Gameplay only - the renderer never reads this.
 */
export function isBrightOutside(state: SkyState, hasFixedTime = false): boolean {
  return !hasFixedTime && state.skyDarken < 4;
}

/**
 * LevelReader.getEffectiveSkyBrightness(pos) = raw sky light - skyDarken
 * (LevelReader.java:173-175), and getRawBrightness uses the same subtraction.
 * This is the gameplay light level used by mob spawning / daylight sensors.
 */
export function effectiveSkyBrightness(rawSkyLight: number, state: SkyState): number {
  return rawSkyLight - state.skyDarken;
}

// ---------------------------------------------------------------------------
// Lightmap: core/lightmap.fsh evaluated on the CPU for the 16x16 RGBA texture.
// x = block light level, y = sky light level, both 0..15.
// ---------------------------------------------------------------------------

/** lightmap.fsh get_brightness: level / (4 - 3 * level). */
export function getBrightness(level: number): number {
  return level / (4 - 3 * level);
}

/** lightmap.fsh notGamma: the scaling factor uses the largest channel. */
function notGamma(color: Rgb): Rgb {
  const maxComponent = Math.max(color[0], Math.max(color[1], color[2]));
  if (maxComponent <= 0) return [0, 0, 0];
  const maxInverted = 1 - maxComponent;
  const maxScaled = 1 - maxInverted * maxInverted * maxInverted * maxInverted;
  const scale = maxScaled / maxComponent;
  return [color[0] * scale, color[1] * scale, color[2] * scale];
}

/**
 * Builds the 16x16 RGBA lightmap exactly like core/lightmap.fsh. The texture is
 * uploaded with NEAREST and the terrain shader samples it at ((level + 0.5) / 16),
 * so texel (block, sky) is evaluated at texCoord ((block + 0.5) / 16, (sky + 0.5) / 16).
 */
export function buildLightmap(state: SkyState, out = new Uint8Array(16 * 16 * 4)): Uint8Array {
  const nightVision: Rgb = [
    state.nightVisionColor[0] * state.nightVisionIntensity,
    state.nightVisionColor[1] * state.nightVisionIntensity,
    state.nightVisionColor[2] * state.nightVisionIntensity,
  ];
  const boss = Math.min(1, Math.max(0, state.bossOverlayWorldDarkening));
  const darkness = state.darknessScale;
  const brightness = Math.min(1, Math.max(0, state.brightness));

  for (let sky = 0; sky < 16; sky++) {
    const skyLevel = sky / 15;
    const skyBrightness = getBrightness(skyLevel) * state.skyFactor;
    for (let block = 0; block < 16; block++) {
      const blockLevel = block / 15;
      const blockBrightness = getBrightness(blockLevel) * state.blockFactor;
      const parabolic = (2 * blockLevel - 1) * (2 * blockLevel - 1);
      const mixT = 0.9 * parabolic;

      // mix(BlockLightTint, vec3(1), 0.9 * parabolicMixFactor(block_level))
      const blockColor: Rgb = [
        state.blockLightTint[0] * (1 - mixT) + mixT,
        state.blockLightTint[1] * (1 - mixT) + mixT,
        state.blockLightTint[2] * (1 - mixT) + mixT,
      ];

      // vec3 color = max(AmbientColor, nightVisionColor) + sky + block
      let color: Rgb = [
        Math.max(state.ambientColor[0], nightVision[0]) + state.skyLightColor[0] * skyBrightness + blockColor[0] * blockBrightness,
        Math.max(state.ambientColor[1], nightVision[1]) + state.skyLightColor[1] * skyBrightness + blockColor[1] * blockBrightness,
        Math.max(state.ambientColor[2], nightVision[2]) + state.skyLightColor[2] * skyBrightness + blockColor[2] * blockBrightness,
      ];

      // boss overlay world darkening: mix(color, color * vec3(0.7, 0.6, 0.6), factor)
      if (boss > 0) {
        color = [
          lerp(color[0], color[0] * 0.7, boss),
          lerp(color[1], color[1] * 0.6, boss),
          lerp(color[2], color[2] * 0.6, boss),
        ];
      }

      // darkness effect: color - vec3(DarknessScale)
      if (darkness > 0) {
        color = [color[0] - darkness, color[1] - darkness, color[2] - darkness];
      }

      color = [Math.min(1, Math.max(0, color[0])), Math.min(1, Math.max(0, color[1])), Math.min(1, Math.max(0, color[2]))];

      const gammaColor = notGamma(color);
      color = [
        lerp(color[0], gammaColor[0], brightness),
        lerp(color[1], gammaColor[1], brightness),
        lerp(color[2], gammaColor[2], brightness),
      ];

      const index = (sky * 16 + block) * 4;
      out[index] = Math.round(Math.min(1, Math.max(0, color[0])) * 255);
      out[index + 1] = Math.round(Math.min(1, Math.max(0, color[1])) * 255);
      out[index + 2] = Math.round(Math.min(1, Math.max(0, color[2])) * 255);
      out[index + 3] = 255;
    }
  }
  return out;
}
