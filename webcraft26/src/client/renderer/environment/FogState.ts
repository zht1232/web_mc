// Pure port of the Minecraft 26.2 client fog pipeline.
//
// Sources (all paths relative to the decompiled vanilla tree G:/ck-web26):
//   src-vanilla/net/minecraft/client/renderer/fog/FogRenderer.java
//   src-vanilla/net/minecraft/client/renderer/fog/FogData.java
//   src-vanilla/net/minecraft/client/renderer/fog/environment/*.java
//   vanilla/assets/minecraft/shaders/include/fog.glsl
//   src-vanilla/net/minecraft/util/ARGB.java, src-vanilla/net/minecraft/util/Mth.java
//   src-vanilla/data/minecraft/dimension_type/overworld.json
//   src-vanilla/net/minecraft/world/attribute/EnvironmentAttributes.java
//
// Design: no GL, no DOM, no Minecraft singletons, no imports. Everything vanilla
// keeps in mutable fields (AtmosphericFogEnvironment.rainFogMultiplier, the mob
// effect blend states, the camera/world attributes) is passed in through FogInput
// and owned by the caller. `computeFog` is the direct replacement for
// FogRenderer.setupFog(); the four distance helpers are the fog.glsl formulas.

export type FogMedia = 'atmospheric' | 'water' | 'lava' | 'powder_snow';

export interface Vec3Like {
  x: number;
  y: number;
  z: number;
}

/**
 * All inputs are optional; omitted fields fall back to the vanilla overworld
 * defaults in FOG_INPUT_DEFAULTS. Values pulled from ClientLevel / Options /
 * EnvironmentAttributes are expected to be pre-resolved by the caller.
 */
export interface FogInput {
  /** Camera fluid medium; FogRenderer.java:212-215 maps NONE -> ATMOSPHERIC. */
  fogType?: FogMedia;
  /** renderDistanceInChunks * 16 (FogRenderer.java:185). */
  renderDistanceBlocks?: number;
  /** Camera world position; only y is used (void darkness, FogRenderer.java:124). */
  cameraPosition?: Vec3Like;
  /** Camera forward unit vector; only x is used (sun factor, AtmosphericFogEnvironment.java:31-32). */
  cameraForward?: Vec3Like;
  /** Dimension min_y (overworld.json: min_y = -64). */
  minY?: number;
  /** ClientLevel.ClientLevelData.voidDarknessOnsetRange() (ClientLevel.java:1278). */
  voidDarknessOnsetRange?: number;
  /** deltaTracker.getGameTimeDeltaPartialTick(false). */
  partialTicks?: number;
  /** deltaTracker.getGameTimeDeltaTicks(); scales the rain fog easing. */
  deltaTicks?: number;

  // --- resolved EnvironmentAttributes --------------------------------
  /** visual/fog_color (overworld.json: #c0d8ff, timeline-modulated). */
  fogColorArgb?: number;
  /** visual/sky_color (overworld.json: #78a7ff, timeline-modulated). */
  skyColorArgb?: number;
  /** visual/sunrise_sunset_color (ARGB; alpha 0 disables the sunrise mix). */
  sunriseSunsetColorArgb?: number;
  /** visual/sun_angle, degrees (EnvironmentAttributes.java SUN_ANGLE). */
  sunAngleDeg?: number;
  /** visual/fog_start_distance (default 0). */
  fogStartDistance?: number;
  /** visual/fog_end_distance (default 1024). */
  fogEndDistance?: number;
  /** visual/sky_fog_end_distance (default 512). */
  skyFogEndDistance?: number;
  /** visual/cloud_fog_end_distance (default 2048). */
  cloudFogEndDistance?: number;
  /** visual/water_fog_color (default 0xff050533 = -16448205). */
  waterFogColorArgb?: number;
  /** visual/water_fog_start_distance (default -8). */
  waterFogStartDistance?: number;
  /** visual/water_fog_end_distance (default 96). */
  waterFogEndDistance?: number;
  /** options.cloudRange() in chunks (Options.java:192-198, default 128). */
  cloudRangeChunks?: number;

  // --- weather / light ------------------------------------------------
  /** level.getRainLevel(partialTicks), 0..1. */
  rainLevel?: number;
  /** level.getThunderLevel(partialTicks), 0..1. */
  thunderLevel?: number;
  /** Sky light level at the camera block, 0..15 (AtmosphericFogEnvironment.java:92). */
  skyLightLevel?: number;
  /** biome.hasPrecipitation() at the camera block (AtmosphericFogEnvironment.java:91). */
  biomeHasPrecipitation?: boolean;
  /** Previous smoothed rain fog multiplier; omit for the steady-state target. */
  rainFogMultiplier?: number;

  // --- player state / effects -----------------------------------------
  /** FogRenderer.setupFog darkenWorldAmount argument, 0..1. */
  darkenWorldAmount?: number;
  isSpectator?: boolean;
  /** LivingEntity.hasEffect(FIRE_RESISTANCE) (LavaFogEnvironment.java:26). */
  fireResistance?: boolean;
  /** LocalPlayer.getWaterVision(), 0..1 (LocalPlayer.java:1149-1164). */
  waterVision?: number;
  /** Camera entity is the LocalPlayer (WaterFogEnvironment.java:19 / FogRenderer.java:148). */
  isLocalPlayer?: boolean;
  hasNightVision?: boolean;
  /** Remaining night vision ticks; -1 / Infinity means infinite (GameRenderer.java:369-372). */
  nightVisionDurationTicks?: number;
  /** Remaining blindness ticks; 0/undefined means the effect is absent (BlindnessFogEnvironment.java). */
  blindnessDurationTicks?: number;
  /** LivingEntity.hasEffect(DARKNESS); presence applies even at blend factor 0. */
  hasDarknessEffect?: boolean;
  /** MobEffectInstance.getBlendFactor() for darkness, 0..1 (DarknessFogEnvironment.java:25). */
  darknessBlendFactor?: number;
  /** BossHealthOverlay.shouldCreateWorldFog() (AtmosphericFogEnvironment.java:78). */
  bossOverlayWorldFog?: boolean;
}

/** Same fields as net.minecraft.client.renderer.fog.FogData (FogData.java:5-13). */
export interface FogData {
  /** Linear fog tint, RGB 0..1 (vanilla stores a Vector4f with alpha 1). */
  color: [number, number, number];
  environmentalStart: number;
  environmentalEnd: number;
  renderDistanceStart: number;
  renderDistanceEnd: number;
  skyEnd: number;
  cloudEnd: number;
}

/** Vanilla overworld defaults (dimension_type/overworld.json + EnvironmentAttributes + Options). */
const DEFAULTS = {
  fogType: 'atmospheric' as FogMedia,
  renderDistanceBlocks: 192,
  cameraPosition: { x: 0, y: 64, z: 0 } as Vec3Like,
  cameraForward: { x: 0, y: 0, z: 1 } as Vec3Like,
  minY: -64,
  voidDarknessOnsetRange: 32,
  partialTicks: 0,
  deltaTicks: 1,
  fogColorArgb: 0xffc0d8ff,
  skyColorArgb: 0xff78a7ff,
  sunriseSunsetColorArgb: 0x00000000,
  sunAngleDeg: 0,
  fogStartDistance: 0,
  fogEndDistance: 1024,
  skyFogEndDistance: 512,
  cloudFogEndDistance: 2048,
  waterFogColorArgb: 0xff050533,
  waterFogStartDistance: -8,
  waterFogEndDistance: 96,
  cloudRangeChunks: 128,
  rainLevel: 0,
  thunderLevel: 0,
  skyLightLevel: 15,
  biomeHasPrecipitation: true,
  darkenWorldAmount: 0,
  isSpectator: false,
  fireResistance: false,
  waterVision: 0,
  isLocalPlayer: true,
  hasNightVision: false,
  nightVisionDurationTicks: -1,
  blindnessDurationTicks: 0,
  hasDarknessEffect: false,
  darknessBlendFactor: 0,
  bossOverlayWorldFog: false,
} satisfies Omit<Required<FogInput>, 'rainFogMultiplier'>;

type ResolvedFogInput = Omit<Required<FogInput>, 'rainFogMultiplier'> & {
  rainFogMultiplier: number | undefined;
};

function resolveInput(input: FogInput): ResolvedFogInput {
  const out: Record<string, unknown> = { ...DEFAULTS };
  for (const key of Object.keys(input) as (keyof FogInput)[]) {
    const value = input[key];
    if (value !== undefined) out[key] = value;
  }
  return out as unknown as ResolvedFogInput;
}

// --- ARGB helpers (ARGB.java) ------------------------------------------

function alphaOf(color: number): number {
  return (color >>> 24) & 255;
}
function redOf(color: number): number {
  return (color >>> 16) & 255;
}
function greenOf(color: number): number {
  return (color >>> 8) & 255;
}
function blueOf(color: number): number {
  return color & 255;
}
function argb(alpha: number, red: number, green: number, blue: number): number {
  return (((alpha & 255) << 24) | ((red & 255) << 16) | ((green & 255) << 8) | (blue & 255)) >>> 0;
}
/** ARGB.opaque (ARGB.java:170-172). */
function opaque(color: number): number {
  return (color | 0xff000000) >>> 0;
}

/**
 * ARGB.srgbLerp (ARGB.java:153-159): per-channel integer lerp including alpha,
 * using Mth.lerpInt (Mth.java:541-543) => p0 + floor(t * (p1 - p0)).
 */
export function srgbLerp(t: number, from: number, to: number): number {
  const lerpInt = (endpoint0: number, endpoint1: number) =>
    endpoint0 + Math.floor(t * (endpoint1 - endpoint0));
  return argb(
    lerpInt(alphaOf(from), alphaOf(to)),
    lerpInt(redOf(from), redOf(to)),
    lerpInt(greenOf(from), greenOf(to)),
    lerpInt(blueOf(from), blueOf(to)),
  );
}

/**
 * ARGB.scaleRGB(color, scaleR, scaleG, scaleB) (ARGB.java:104-115): each channel
 * is (int)(channel * scale) (truncation toward zero), clamped to 0..255, alpha kept.
 */
export function scaleRgb(color: number, scaleR: number, scaleG: number, scaleB: number): number {
  const scale = (channel: number, factor: number) =>
    Math.max(0, Math.min(255, Math.trunc(channel * factor)));
  return argb(
    alphaOf(color),
    scale(redOf(color), scaleR),
    scale(greenOf(color), scaleG),
    scale(blueOf(color), scaleB),
  );
}

/** Web helper: SkyState.rgb floats (0..1) -> packed ARGB for FogInput. */
export function argbFromRgb(rgb: readonly [number, number, number], alpha = 255): number {
  const channel = (value: number) => Math.max(0, Math.min(255, Math.round(value * 255)));
  return argb(alpha, channel(rgb[0]), channel(rgb[1]), channel(rgb[2]));
}

// --- Mth helpers ------------------------------------------------------

function lerp(t: number, p0: number, p1: number): number {
  return p0 + t * (p1 - p0);
}
/** Mth.clampedLerp (Mth.java:118-124). */
function clampedLerp(t: number, min: number, max: number): number {
  if (t < 0) return min;
  return t > 1 ? max : lerp(t, min, max);
}

// --- fog.glsl distance formulas ---------------------------------------

/** fog.glsl:13-21 linear_fog_value. */
export function linearFogValue(vertexDistance: number, fogStart: number, fogEnd: number): number {
  if (vertexDistance <= fogStart) return 0;
  if (vertexDistance >= fogEnd) return 1;
  return (vertexDistance - fogStart) / (fogEnd - fogStart);
}

/** fog.glsl:32-34 fog_spherical_distance = length(pos). */
export function fogSphericalDistance(pos: Vec3Like): number {
  return Math.sqrt(pos.x * pos.x + pos.y * pos.y + pos.z * pos.z);
}

/** fog.glsl:36-40 fog_cylindrical_distance = max(length(xz), |y|). */
export function fogCylindricalDistance(pos: Vec3Like): number {
  return Math.max(Math.sqrt(pos.x * pos.x + pos.z * pos.z), Math.abs(pos.y));
}

/** fog.glsl:23-25 total_fog_value = max(environmental, render distance). */
export function totalFogValue(
  sphericalVertexDistance: number,
  cylindricalVertexDistance: number,
  environmentalStart: number,
  environmentalEnd: number,
  renderDistanceStart: number,
  renderDistanceEnd: number,
): number {
  return Math.max(
    linearFogValue(sphericalVertexDistance, environmentalStart, environmentalEnd),
    linearFogValue(cylindricalVertexDistance, renderDistanceStart, renderDistanceEnd),
  );
}

// --- environment selection (FogRenderer.java:36-45, 107-117) ----------

type FogEnvironmentKind =
  | 'lava'
  | 'powder_snow'
  | 'blindness'
  | 'darkness'
  | 'water'
  | 'atmospheric';

/** FogRenderer.java:36-45 FOG_ENVIRONMENTS evaluation order. */
const FOG_ENVIRONMENTS: readonly FogEnvironmentKind[] = [
  'lava',
  'powder_snow',
  'blindness',
  'darkness',
  'water',
  'atmospheric',
];

function isInfiniteDuration(ticks: number): boolean {
  return ticks === -1 || ticks === Number.POSITIVE_INFINITY;
}

function hasBlindness(input: ResolvedFogInput): boolean {
  const duration = input.blindnessDurationTicks;
  return isInfiniteDuration(duration) || duration > 0;
}

function isApplicable(kind: FogEnvironmentKind, input: ResolvedFogInput): boolean {
  switch (kind) {
    case 'lava':
      return input.fogType === 'lava';
    case 'powder_snow':
      return input.fogType === 'powder_snow';
    case 'blindness':
      return hasBlindness(input);
    case 'darkness':
      return input.hasDarknessEffect;
    case 'water':
      return input.fogType === 'water';
    case 'atmospheric':
      return input.fogType === 'atmospheric';
  }
}

/** FogEnvironment.providesColor (FogEnvironment.java:15-17, MobEffectFogEnvironment.java:13-16). */
function providesColor(kind: FogEnvironmentKind): boolean {
  return kind !== 'blindness' && kind !== 'darkness';
}

/** FogEnvironment.modifiesDarkness (MobEffectFogEnvironment.java:18-21). */
function modifiesDarkness(kind: FogEnvironmentKind): boolean {
  return kind === 'blindness' || kind === 'darkness';
}

function firstApplicable(
  input: ResolvedFogInput,
  predicate: (kind: FogEnvironmentKind) => boolean = () => true,
): FogEnvironmentKind | null {
  for (const kind of FOG_ENVIRONMENTS) {
    if (predicate(kind) && isApplicable(kind, input)) return kind;
  }
  return null;
}

// --- rain fog smoothing (AtmosphericFogEnvironment.java:86-95) --------

function rainFogTarget(input: ResolvedFogInput): number {
  const skyLightFactor = Math.max(0, Math.min(1, (input.skyLightLevel - 8) / 7));
  return input.rainLevel * skyLightFactor * (input.biomeHasPrecipitation ? 1 : 0.5);
}

/**
 * Steady-state rain fog target before easing: rain * skyLightFactor * biomeFactor.
 * AtmosphericFogEnvironment.java:92-93.
 */
export function computeRainFogTargetMultiplier(input: FogInput = {}): number {
  return rainFogTarget(resolveInput(input));
}

/**
 * Next frame's smoothed rain fog multiplier (AtmosphericFogEnvironment.java:94):
 *   next = previous + (target - previous) * deltaTicks * 0.2
 * Pass FogInput.rainFogMultiplier = previous frame's result to reproduce the
 * vanilla easing; when omitted the steady-state target is returned instead.
 */
export function computeRainFogMultiplier(input: FogInput = {}): number {
  const resolved = resolveInput(input);
  const target = rainFogTarget(resolved);
  if (resolved.rainFogMultiplier === undefined) return target;
  return resolved.rainFogMultiplier + (target - resolved.rainFogMultiplier) * resolved.deltaTicks * 0.2;
}

// --- base colours (each FogEnvironment.getBaseColor) ------------------

/** AtmosphericFogEnvironment.java:25-62. */
function atmosphericBaseColor(input: ResolvedFogInput): number {
  const renderDistanceChunks = input.renderDistanceBlocks / 16;
  let fogColor = input.fogColorArgb;
  if (renderDistanceChunks >= 4) {
    const sunAngle = (input.sunAngleDeg * Math.PI) / 180;
    const sunX = Math.sin(sunAngle) > 0 ? -1 : 1;
    const lookingAtTheSunFactor = input.cameraForward.x * sunX;
    if (lookingAtTheSunFactor > 0) {
      const sunriseColor = input.sunriseSunsetColorArgb;
      const sunriseAlpha = alphaOf(sunriseColor) / 255;
      if (sunriseAlpha > 0) {
        fogColor = srgbLerp(lookingAtTheSunFactor * sunriseAlpha, fogColor, opaque(sunriseColor));
      }
    }
  }

  let skyColor = input.skyColorArgb;
  if (input.rainLevel > 0) {
    const rainColorModifier = 1 - input.rainLevel * 0.5;
    const rainBlueColorModifier = 1 - input.rainLevel * 0.4;
    skyColor = scaleRgb(skyColor, rainColorModifier, rainColorModifier, rainBlueColorModifier);
  }
  if (input.thunderLevel > 0) {
    const thunderModifier = 1 - input.thunderLevel * 0.5;
    skyColor = scaleRgb(skyColor, thunderModifier, thunderModifier, thunderModifier);
  }

  const skyFogEnd = Math.min(input.skyFogEndDistance / 16, renderDistanceChunks);
  let skyColorMixFactor = clampedLerp(skyFogEnd / 32, 0.25, 1);
  skyColorMixFactor = 1 - Math.pow(skyColorMixFactor, 0.25);
  return srgbLerp(skyColorMixFactor, fogColor, skyColor);
}

function baseColorOf(kind: FogEnvironmentKind, input: ResolvedFogInput): number {
  switch (kind) {
    case 'lava':
      return 0xff991900; // LavaFogEnvironment.java:14 COLOR = -6743808
    case 'powder_snow':
      return 0xff9fbbcc; // PowderedSnowFogEnvironment.java:12 COLOR = -6308916
    case 'water':
      return input.waterFogColorArgb;
    case 'atmospheric':
      return atmosphericBaseColor(input);
    case 'blindness':
    case 'darkness':
      // Never a colour source: providesColor() is false (MobEffectFogEnvironment.java:13-16).
      return input.fogColorArgb;
  }
}

// --- void darkness + effect darkness (FogRenderer.java:123-128) -------

function voidDarkness(input: ResolvedFogInput): number {
  const onset = input.voidDarknessOnsetRange;
  if (onset <= 0) return 0;
  return Math.max(0, Math.min(1, (onset + input.minY - input.cameraPosition.y) / onset));
}

/** BlindnessFogEnvironment.getModifiedDarkness (BlindnessFogEnvironment.java:34-46). */
function blindnessDarkness(input: ResolvedFogInput, darkness: number): number {
  const duration = input.blindnessDurationTicks;
  if (isInfiniteDuration(duration) || duration > 19) return 1;
  return Math.max(duration / 20, darkness);
}

/** DarknessFogEnvironment.getModifiedDarkness (DarknessFogEnvironment.java:34-38). */
function effectDarkness(kind: FogEnvironmentKind, input: ResolvedFogInput, darkness: number): number {
  if (kind === 'blindness') return blindnessDarkness(input, darkness);
  return Math.max(input.darknessBlendFactor, darkness);
}

// --- fog colour (FogRenderer.java:99-175) -----------------------------

/** GameRenderer.nightVisionScale (GameRenderer.java:369-372). */
function nightVisionScale(input: ResolvedFogInput): number {
  const duration = input.nightVisionDurationTicks;
  const endsWithin200 = !isInfiniteDuration(duration) && duration <= 200;
  if (!endsWithin200) return 1;
  return 0.7 + Math.sin((duration - input.partialTicks) * Math.PI * 0.2) * 0.3;
}

/**
 * FogRenderer.computeFogColor, returning the RGB floats FogData.color holds.
 * Colour source = first applicable environment that providesColor(); darkness
 * modifier = first applicable environment that modifiesDarkness().
 */
export function computeFogColor(input: FogInput = {}): [number, number, number] {
  const i = resolveInput(input);
  const colorSource = firstApplicable(i, providesColor) ?? 'atmospheric';
  const darknessSource = firstApplicable(i, modifiesDarkness);

  const color = baseColorOf(colorSource, i);
  let fogRed = redOf(color) / 255;
  let fogGreen = greenOf(color) / 255;
  let fogBlue = blueOf(color) / 255;

  let darkness = voidDarkness(i);
  if (darknessSource !== null) darkness = effectDarkness(darknessSource, i, darkness);

  // FogRenderer.java:133-138: lava and powder snow keep their tint even in the void.
  if (darkness > 0 && i.fogType !== 'lava' && i.fogType !== 'powder_snow') {
    const brightness = (1 - darkness) * (1 - darkness);
    fogRed *= brightness;
    fogGreen *= brightness;
    fogBlue *= brightness;
  }

  // FogRenderer.java:140-144: darkenWorldAmount (credits / end portal).
  if (i.darkenWorldAmount > 0) {
    fogRed = lerp(i.darkenWorldAmount, fogRed, fogRed * 0.7);
    fogGreen = lerp(i.darkenWorldAmount, fogGreen, fogGreen * 0.6);
    fogBlue = lerp(i.darkenWorldAmount, fogBlue, fogBlue * 0.6);
  }

  // FogRenderer.java:146-171: brightenFactor (water vision / night vision), then
  // the channel rescale that pushes the brightest channel to 1 at full strength.
  let brightenFactor: number;
  if (i.fogType === 'water') {
    brightenFactor = i.isLocalPlayer ? i.waterVision : 1;
  } else if (i.hasNightVision && !i.hasDarknessEffect) {
    brightenFactor = nightVisionScale(i);
  } else {
    brightenFactor = 0;
  }

  if (fogRed !== 0 && fogGreen !== 0 && fogBlue !== 0) {
    const maxColor = Math.max(fogRed, Math.max(fogGreen, fogBlue));
    const targetScale = 1 / Math.min(Math.max(maxColor, 0.07), 1);
    const targetScaleMax = 1 / maxColor;
    let scale = maxColor !== fogRed ? targetScale : targetScaleMax;
    fogRed = lerp(brightenFactor, fogRed, fogRed * scale);
    scale = maxColor !== fogGreen ? targetScale : targetScaleMax;
    fogGreen = lerp(brightenFactor, fogGreen, fogGreen * scale);
    scale = maxColor !== fogBlue ? targetScale : targetScaleMax;
    fogBlue = lerp(brightenFactor, fogBlue, fogBlue * scale);
  }

  return [fogRed, fogGreen, fogBlue];
}

// --- per-environment fog distances ------------------------------------

interface FogDistances {
  environmentalStart: number;
  environmentalEnd: number;
  skyEnd: number;
  cloudEnd: number;
}

/** FogEnvironment.setupFog for one environment (see the per-class line refs below). */
function setupFogDistances(kind: FogEnvironmentKind, i: ResolvedFogInput): FogDistances {
  const renderDistanceBlocks = i.renderDistanceBlocks;
  switch (kind) {
    case 'lava': {
      // LavaFogEnvironment.java:22-36.
      let environmentalStart: number;
      let environmentalEnd: number;
      if (i.isSpectator) {
        environmentalStart = -8;
        environmentalEnd = renderDistanceBlocks * 0.5;
      } else if (i.fireResistance) {
        environmentalStart = 0;
        environmentalEnd = 5;
      } else {
        environmentalStart = 0.25;
        environmentalEnd = 1;
      }
      return { environmentalStart, environmentalEnd, skyEnd: environmentalEnd, cloudEnd: environmentalEnd };
    }
    case 'powder_snow': {
      // PowderedSnowFogEnvironment.java:20-31.
      const environmentalStart = i.isSpectator ? -8 : 0;
      const environmentalEnd = i.isSpectator ? renderDistanceBlocks * 0.5 : 2;
      return { environmentalStart, environmentalEnd, skyEnd: environmentalEnd, cloudEnd: environmentalEnd };
    }
    case 'blindness': {
      // BlindnessFogEnvironment.java:20-32.
      const duration = i.blindnessDurationTicks;
      const distance = isInfiniteDuration(duration)
        ? 5
        : lerp(Math.min(1, duration / 20), renderDistanceBlocks, 5);
      return {
        environmentalStart: distance * 0.25,
        environmentalEnd: distance,
        skyEnd: distance * 0.8,
        cloudEnd: distance * 0.8,
      };
    }
    case 'darkness': {
      // DarknessFogEnvironment.java:20-32.
      const distance = lerp(i.darknessBlendFactor, renderDistanceBlocks, 15);
      return {
        environmentalStart: distance * 0.75,
        environmentalEnd: distance,
        skyEnd: distance,
        cloudEnd: distance,
      };
    }
    case 'water': {
      // WaterFogEnvironment.java:14-25.
      let environmentalEnd = i.waterFogEndDistance;
      if (i.isLocalPlayer) environmentalEnd *= Math.max(0.25, i.waterVision);
      return {
        environmentalStart: i.waterFogStartDistance,
        environmentalEnd,
        skyEnd: environmentalEnd,
        cloudEnd: environmentalEnd,
      };
    }
    case 'atmospheric': {
      // AtmosphericFogEnvironment.java:64-84.
      const rainFogMultiplier = computeRainFogMultiplier(i);
      let environmentalStart = i.fogStartDistance + -160 * rainFogMultiplier;
      const minRainFogEnd = Math.min(96, i.fogEndDistance);
      let environmentalEnd = Math.max(minRainFogEnd, i.fogEndDistance + -256 * rainFogMultiplier);
      let skyEnd = Math.min(renderDistanceBlocks, i.skyFogEndDistance);
      let cloudEnd = Math.min(i.cloudRangeChunks * 16, i.cloudFogEndDistance);
      if (i.bossOverlayWorldFog) {
        environmentalStart = Math.min(environmentalStart, 10);
        environmentalEnd = Math.min(environmentalEnd, 96);
        skyEnd = environmentalEnd;
        cloudEnd = environmentalEnd;
      }
      return { environmentalStart, environmentalEnd, skyEnd, cloudEnd };
    }
  }
}

/**
 * FogRenderer.setupFog (FogRenderer.java:181-202).
 *
 * Colour: first environment that providesColor(); fog shape: first applicable
 * environment in FOG_ENVIRONMENTS order; then the render-distance span
 * clamp(blocks / 10, 4, 64) is appended (FogRenderer.java:198-200).
 */
export function computeFog(input: FogInput = {}): FogData {
  const i = resolveInput(input);
  const color = computeFogColor(i);
  const kind = firstApplicable(i) ?? 'atmospheric';
  const distances = setupFogDistances(kind, i);
  const renderDistanceFogSpan = Math.max(4, Math.min(64, i.renderDistanceBlocks / 10));
  return {
    color,
    environmentalStart: distances.environmentalStart,
    environmentalEnd: distances.environmentalEnd,
    renderDistanceStart: i.renderDistanceBlocks - renderDistanceFogSpan,
    renderDistanceEnd: i.renderDistanceBlocks,
    skyEnd: distances.skyEnd,
    cloudEnd: distances.cloudEnd,
  };
}
