/**
 * Port of vanilla's OverworldBiomeBuilder (26.2) to plain JS.
 *
 * WHY THIS EXISTS
 * ---------------
 * Since 1.18 the overworld multi-noise biome parameter list is NOT stored in
 * the data pack: `data/minecraft/worldgen/multi_noise_biome_source_parameter_list/overworld.json`
 * only contains `{"preset": "minecraft:overworld"}` and the actual list is
 * generated in code by `net.minecraft.world.level.biome.OverworldBiomeBuilder`.
 *
 * To let the browser pick the same biomes as vanilla we transcribe that
 * builder here, 1:1, and emit the resulting parameter points as data. Nothing
 * is invented: every threshold, table row and branch mirrors
 *   net/minecraft/world/level/biome/OverworldBiomeBuilder.java  (1124 lines)
 *   net/minecraft/world/level/biome/Climate.java               (quantization)
 *
 * UNITS
 * -----
 * Vanilla quantizes climate coords to `(long)(value * 10000)`. We keep the same
 * integer quantization internally so every comparison (`weirdness.max() < 0`)
 * is bit-identical to the JVM, then emit un-quantized floats (value / 10000).
 */

const QUANT = 10000;

/** Climate.quantizeCoord: (long) (coord * 10000.0F), truncating toward zero. */
const q = (v) => Math.trunc(v * QUANT);

/** Climate.Parameter.span(float, float) */
const spanF = (min, max) => ({ min: Math.min(q(min), q(max)), max: Math.max(q(min), q(max)) });

/** Climate.Parameter.point(float) */
const point = (v) => spanF(v, v);

/** Climate.Parameter.span(Parameter min, Parameter max): takes min of min, max of max. */
const spanP = (a, b) => ({ min: Math.min(a.min, b.min), max: Math.max(a.max, b.max) });

/** String constants of the biomes used by the builder. */
const B = (name) => `minecraft:${name}`;

const FULL_RANGE = spanF(-1, 1);

const TEMPERATURES = [
  spanF(-1, -0.45),
  spanF(-0.45, -0.15),
  spanF(-0.15, 0.2),
  spanF(0.2, 0.55),
  spanF(0.55, 1),
];

const HUMIDITIES = [
  spanF(-1, -0.35),
  spanF(-0.35, -0.1),
  spanF(-0.1, 0.1),
  spanF(0.1, 0.3),
  spanF(0.3, 1),
];

const EROSIONS = [
  spanF(-1, -0.78),
  spanF(-0.78, -0.375),
  spanF(-0.375, -0.2225),
  spanF(-0.2225, 0.05),
  spanF(0.05, 0.45),
  spanF(0.45, 0.55),
  spanF(0.55, 1),
];

const FROZEN_RANGE = TEMPERATURES[0];
const UNFROZEN_RANGE = spanP(TEMPERATURES[1], TEMPERATURES[4]);

const MUSHROOM_FIELDS_CONTINENTALNESS = spanF(-1.2, -1.05);
const DEEP_OCEAN_CONTINENTALNESS = spanF(-1.05, -0.455);
const OCEAN_CONTINENTALNESS = spanF(-0.455, -0.19);
const COAST_CONTINENTALNESS = spanF(-0.19, -0.11);
const INLAND_CONTINENTALNESS = spanF(-0.11, 0.55);
const NEAR_INLAND_CONTINENTALNESS = spanF(-0.11, 0.03);
const MID_INLAND_CONTINENTALNESS = spanF(0.03, 0.3);
const FAR_INLAND_CONTINENTALNESS = spanF(0.3, 1);

// --- vanilla biome tables (row = temperature index, column = humidity index) ---

const OCEANS = [
  [B('deep_frozen_ocean'), B('deep_cold_ocean'), B('deep_ocean'), B('deep_lukewarm_ocean'), B('warm_ocean')],
  [B('frozen_ocean'), B('cold_ocean'), B('ocean'), B('lukewarm_ocean'), B('warm_ocean')],
];

const MIDDLE_BIOMES = [
  [B('snowy_plains'), B('snowy_plains'), B('snowy_plains'), B('snowy_taiga'), B('taiga')],
  [B('plains'), B('plains'), B('forest'), B('taiga'), B('old_growth_spruce_taiga')],
  [B('flower_forest'), B('plains'), B('forest'), B('birch_forest'), B('dark_forest')],
  [B('savanna'), B('savanna'), B('forest'), B('jungle'), B('jungle')],
  [B('desert'), B('desert'), B('desert'), B('desert'), B('desert')],
];

const MIDDLE_BIOMES_VARIANT = [
  [B('ice_spikes'), null, B('snowy_taiga'), null, null],
  [null, null, null, null, B('old_growth_pine_taiga')],
  [B('sunflower_plains'), null, null, B('old_growth_birch_forest'), null],
  [null, null, B('plains'), B('sparse_jungle'), B('bamboo_jungle')],
  [null, null, null, null, null],
];

const PLATEAU_BIOMES = [
  [B('snowy_plains'), B('snowy_plains'), B('snowy_plains'), B('snowy_taiga'), B('snowy_taiga')],
  [B('meadow'), B('meadow'), B('forest'), B('taiga'), B('old_growth_spruce_taiga')],
  [B('meadow'), B('meadow'), B('meadow'), B('meadow'), B('pale_garden')],
  [B('savanna_plateau'), B('savanna_plateau'), B('forest'), B('forest'), B('jungle')],
  [B('badlands'), B('badlands'), B('badlands'), B('wooded_badlands'), B('wooded_badlands')],
];

const PLATEAU_BIOMES_VARIANT = [
  [B('ice_spikes'), null, null, null, null],
  [B('cherry_grove'), null, B('meadow'), B('meadow'), B('old_growth_pine_taiga')],
  [B('cherry_grove'), B('cherry_grove'), B('forest'), B('birch_forest'), null],
  [null, null, null, null, null],
  [B('eroded_badlands'), B('eroded_badlands'), null, null, null],
];

const SHATTERED_BIOMES = [
  [B('windswept_gravelly_hills'), B('windswept_gravelly_hills'), B('windswept_hills'), B('windswept_forest'), B('windswept_forest')],
  [B('windswept_gravelly_hills'), B('windswept_gravelly_hills'), B('windswept_hills'), B('windswept_forest'), B('windswept_forest')],
  [B('windswept_hills'), B('windswept_hills'), B('windswept_hills'), B('windswept_forest'), B('windswept_forest')],
  [null, null, null, null, null],
  [null, null, null, null, null],
];

// --- biome pickers (verbatim branches) ---

const pickMiddleBiome = (t, h, w) =>
  w.max < 0 ? MIDDLE_BIOMES[t][h] : MIDDLE_BIOMES_VARIANT[t][h] ?? MIDDLE_BIOMES[t][h];

const pickBadlandsBiome = (h, w) => {
  if (h < 2) return w.max < 0 ? B('badlands') : B('eroded_badlands');
  return h < 3 ? B('badlands') : B('wooded_badlands');
};

const pickMiddleBiomeOrBadlandsIfHot = (t, h, w) =>
  t === 4 ? pickBadlandsBiome(h, w) : pickMiddleBiome(t, h, w);

const pickSlopeBiome = (t, h, w) =>
  t >= 3 ? pickPlateauBiome(t, h, w) : h <= 1 ? B('snowy_slopes') : B('grove');

const pickMiddleBiomeOrBadlandsIfHotOrSlopeIfCold = (t, h, w) =>
  t === 0 ? pickSlopeBiome(t, h, w) : pickMiddleBiomeOrBadlandsIfHot(t, h, w);

const maybePickWindsweptSavannaBiome = (t, h, w, underlying) =>
  t > 1 && h < 4 && w.max >= 0 ? B('windswept_savanna') : underlying;

const pickBeachBiome = (t) => (t === 0 ? B('snowy_beach') : t === 4 ? B('desert') : B('beach'));

const pickShatteredCoastBiome = (t, h, w) => {
  const beachOrMiddle = w.max >= 0 ? pickMiddleBiome(t, h, w) : pickBeachBiome(t);
  return maybePickWindsweptSavannaBiome(t, h, w, beachOrMiddle);
};

const pickPlateauBiome = (t, h, w) => {
  if (w.max >= 0) {
    const variant = PLATEAU_BIOMES_VARIANT[t][h];
    if (variant) return variant;
  }
  return PLATEAU_BIOMES[t][h];
};

const pickPeakBiome = (t, h, w) => {
  if (t <= 2) return w.max < 0 ? B('jagged_peaks') : B('frozen_peaks');
  return t === 3 ? B('stony_peaks') : pickBadlandsBiome(h, w);
};

const pickShatteredBiome = (t, h, w) => SHATTERED_BIOMES[t][h] ?? pickMiddleBiome(t, h, w);

// --- point emitters ---

/**
 * Collects Climate.ParameterPoints in vanilla insertion order.
 * `addSurfaceBiome` pushes the same point twice (depth 0.0 and 1.0).
 */
function createCollector() {
  const points = [];
  const add = (temperature, humidity, continentalness, erosion, depth, weirdness, offset, biome) => {
    points.push({ biome, temperature, humidity, continentalness, erosion, depth, weirdness, offset: q(offset) });
  };
  return {
    points,
    /** OverworldBiomeBuilder#addSurfaceBiome */
    surface(t, h, c, e, w, biome) {
      add(t, h, c, e, point(0), w, 0, biome);
      add(t, h, c, e, point(1), w, 0, biome);
    },
    /** OverworldBiomeBuilder#addUndergroundBiome */
    underground(t, h, c, e, w, biome) {
      add(t, h, c, e, spanF(0.2, 0.9), w, 0, biome);
    },
    /** OverworldBiomeBuilder#addBottomBiome */
    bottom(t, h, c, e, w, biome) {
      add(t, h, c, e, point(1.1), w, 0, biome);
    },
  };
}

function addOffCoastBiomes(out) {
  out.surface(FULL_RANGE, FULL_RANGE, MUSHROOM_FIELDS_CONTINENTALNESS, FULL_RANGE, FULL_RANGE, B('mushroom_fields'));
  for (let t = 0; t < TEMPERATURES.length; t++) {
    out.surface(TEMPERATURES[t], FULL_RANGE, DEEP_OCEAN_CONTINENTALNESS, FULL_RANGE, FULL_RANGE, OCEANS[0][t]);
    out.surface(TEMPERATURES[t], FULL_RANGE, OCEAN_CONTINENTALNESS, FULL_RANGE, FULL_RANGE, OCEANS[1][t]);
  }
}

function addPeaks(out, w) {
  for (let t = 0; t < TEMPERATURES.length; t++) {
    for (let h = 0; h < HUMIDITIES.length; h++) {
      const temperature = TEMPERATURES[t];
      const humidity = HUMIDITIES[h];
      const middle = pickMiddleBiome(t, h, w);
      const middleOrBadlandsIfHot = pickMiddleBiomeOrBadlandsIfHot(t, h, w);
      const middleOrBadlandsOrSlopeIfCold = pickMiddleBiomeOrBadlandsIfHotOrSlopeIfCold(t, h, w);
      const plateau = pickPlateauBiome(t, h, w);
      const shattered = pickShatteredBiome(t, h, w);
      const shatteredOrWindsweptSavanna = maybePickWindsweptSavannaBiome(t, h, w, shattered);
      const peak = pickPeakBiome(t, h, w);

      out.surface(temperature, humidity, spanP(COAST_CONTINENTALNESS, FAR_INLAND_CONTINENTALNESS), EROSIONS[0], w, peak);
      out.surface(temperature, humidity, spanP(COAST_CONTINENTALNESS, NEAR_INLAND_CONTINENTALNESS), EROSIONS[1], w, middleOrBadlandsOrSlopeIfCold);
      out.surface(temperature, humidity, spanP(MID_INLAND_CONTINENTALNESS, FAR_INLAND_CONTINENTALNESS), EROSIONS[1], w, peak);
      out.surface(temperature, humidity, spanP(COAST_CONTINENTALNESS, NEAR_INLAND_CONTINENTALNESS), spanP(EROSIONS[2], EROSIONS[3]), w, middle);
      out.surface(temperature, humidity, spanP(MID_INLAND_CONTINENTALNESS, FAR_INLAND_CONTINENTALNESS), EROSIONS[2], w, plateau);
      out.surface(temperature, humidity, MID_INLAND_CONTINENTALNESS, EROSIONS[3], w, middleOrBadlandsIfHot);
      out.surface(temperature, humidity, FAR_INLAND_CONTINENTALNESS, EROSIONS[3], w, plateau);
      out.surface(temperature, humidity, spanP(COAST_CONTINENTALNESS, FAR_INLAND_CONTINENTALNESS), EROSIONS[4], w, middle);
      out.surface(temperature, humidity, spanP(COAST_CONTINENTALNESS, NEAR_INLAND_CONTINENTALNESS), EROSIONS[5], w, shatteredOrWindsweptSavanna);
      out.surface(temperature, humidity, spanP(MID_INLAND_CONTINENTALNESS, FAR_INLAND_CONTINENTALNESS), EROSIONS[5], w, shattered);
      out.surface(temperature, humidity, spanP(COAST_CONTINENTALNESS, FAR_INLAND_CONTINENTALNESS), EROSIONS[6], w, middle);
    }
  }
}

function addHighSlice(out, w) {
  for (let t = 0; t < TEMPERATURES.length; t++) {
    for (let h = 0; h < HUMIDITIES.length; h++) {
      const temperature = TEMPERATURES[t];
      const humidity = HUMIDITIES[h];
      const middle = pickMiddleBiome(t, h, w);
      const middleOrBadlandsIfHot = pickMiddleBiomeOrBadlandsIfHot(t, h, w);
      const middleOrBadlandsOrSlopeIfCold = pickMiddleBiomeOrBadlandsIfHotOrSlopeIfCold(t, h, w);
      const plateau = pickPlateauBiome(t, h, w);
      const shattered = pickShatteredBiome(t, h, w);
      const middleOrWindsweptSavanna = maybePickWindsweptSavannaBiome(t, h, w, middle);
      const slope = pickSlopeBiome(t, h, w);
      const peak = pickPeakBiome(t, h, w);

      out.surface(temperature, humidity, COAST_CONTINENTALNESS, spanP(EROSIONS[0], EROSIONS[1]), w, middle);
      out.surface(temperature, humidity, NEAR_INLAND_CONTINENTALNESS, EROSIONS[0], w, slope);
      out.surface(temperature, humidity, spanP(MID_INLAND_CONTINENTALNESS, FAR_INLAND_CONTINENTALNESS), EROSIONS[0], w, peak);
      out.surface(temperature, humidity, NEAR_INLAND_CONTINENTALNESS, EROSIONS[1], w, middleOrBadlandsOrSlopeIfCold);
      out.surface(temperature, humidity, spanP(MID_INLAND_CONTINENTALNESS, FAR_INLAND_CONTINENTALNESS), EROSIONS[1], w, slope);
      out.surface(temperature, humidity, spanP(COAST_CONTINENTALNESS, NEAR_INLAND_CONTINENTALNESS), spanP(EROSIONS[2], EROSIONS[3]), w, middle);
      out.surface(temperature, humidity, spanP(MID_INLAND_CONTINENTALNESS, FAR_INLAND_CONTINENTALNESS), EROSIONS[2], w, plateau);
      out.surface(temperature, humidity, MID_INLAND_CONTINENTALNESS, EROSIONS[3], w, middleOrBadlandsIfHot);
      out.surface(temperature, humidity, FAR_INLAND_CONTINENTALNESS, EROSIONS[3], w, plateau);
      out.surface(temperature, humidity, spanP(COAST_CONTINENTALNESS, FAR_INLAND_CONTINENTALNESS), EROSIONS[4], w, middle);
      out.surface(temperature, humidity, spanP(COAST_CONTINENTALNESS, NEAR_INLAND_CONTINENTALNESS), EROSIONS[5], w, middleOrWindsweptSavanna);
      out.surface(temperature, humidity, spanP(MID_INLAND_CONTINENTALNESS, FAR_INLAND_CONTINENTALNESS), EROSIONS[5], w, shattered);
      out.surface(temperature, humidity, spanP(COAST_CONTINENTALNESS, FAR_INLAND_CONTINENTALNESS), EROSIONS[6], w, middle);
    }
  }
}

function addMidSlice(out, w) {
  out.surface(FULL_RANGE, FULL_RANGE, COAST_CONTINENTALNESS, spanP(EROSIONS[0], EROSIONS[2]), w, B('stony_shore'));
  out.surface(spanP(TEMPERATURES[1], TEMPERATURES[2]), FULL_RANGE, spanP(NEAR_INLAND_CONTINENTALNESS, FAR_INLAND_CONTINENTALNESS), EROSIONS[6], w, B('swamp'));
  out.surface(spanP(TEMPERATURES[3], TEMPERATURES[4]), FULL_RANGE, spanP(NEAR_INLAND_CONTINENTALNESS, FAR_INLAND_CONTINENTALNESS), EROSIONS[6], w, B('mangrove_swamp'));

  for (let t = 0; t < TEMPERATURES.length; t++) {
    for (let h = 0; h < HUMIDITIES.length; h++) {
      const temperature = TEMPERATURES[t];
      const humidity = HUMIDITIES[h];
      const middle = pickMiddleBiome(t, h, w);
      const middleOrBadlandsIfHot = pickMiddleBiomeOrBadlandsIfHot(t, h, w);
      const middleOrBadlandsOrSlopeIfCold = pickMiddleBiomeOrBadlandsIfHotOrSlopeIfCold(t, h, w);
      const shattered = pickShatteredBiome(t, h, w);
      const plateau = pickPlateauBiome(t, h, w);
      const beach = pickBeachBiome(t);
      const middleOrWindsweptSavanna = maybePickWindsweptSavannaBiome(t, h, w, middle);
      const shatteredCoast = pickShatteredCoastBiome(t, h, w);
      const slope = pickSlopeBiome(t, h, w);

      out.surface(temperature, humidity, spanP(NEAR_INLAND_CONTINENTALNESS, FAR_INLAND_CONTINENTALNESS), EROSIONS[0], w, slope);
      out.surface(temperature, humidity, spanP(NEAR_INLAND_CONTINENTALNESS, MID_INLAND_CONTINENTALNESS), EROSIONS[1], w, middleOrBadlandsOrSlopeIfCold);
      out.surface(temperature, humidity, FAR_INLAND_CONTINENTALNESS, EROSIONS[1], w, t === 0 ? slope : plateau);
      out.surface(temperature, humidity, NEAR_INLAND_CONTINENTALNESS, EROSIONS[2], w, middle);
      out.surface(temperature, humidity, MID_INLAND_CONTINENTALNESS, EROSIONS[2], w, middleOrBadlandsIfHot);
      out.surface(temperature, humidity, FAR_INLAND_CONTINENTALNESS, EROSIONS[2], w, plateau);
      out.surface(temperature, humidity, spanP(COAST_CONTINENTALNESS, NEAR_INLAND_CONTINENTALNESS), EROSIONS[3], w, middle);
      out.surface(temperature, humidity, spanP(MID_INLAND_CONTINENTALNESS, FAR_INLAND_CONTINENTALNESS), EROSIONS[3], w, middleOrBadlandsIfHot);

      if (w.max < 0) {
        out.surface(temperature, humidity, COAST_CONTINENTALNESS, EROSIONS[4], w, beach);
        out.surface(temperature, humidity, spanP(NEAR_INLAND_CONTINENTALNESS, FAR_INLAND_CONTINENTALNESS), EROSIONS[4], w, middle);
      } else {
        out.surface(temperature, humidity, spanP(COAST_CONTINENTALNESS, FAR_INLAND_CONTINENTALNESS), EROSIONS[4], w, middle);
      }

      out.surface(temperature, humidity, COAST_CONTINENTALNESS, EROSIONS[5], w, shatteredCoast);
      out.surface(temperature, humidity, NEAR_INLAND_CONTINENTALNESS, EROSIONS[5], w, middleOrWindsweptSavanna);
      out.surface(temperature, humidity, spanP(MID_INLAND_CONTINENTALNESS, FAR_INLAND_CONTINENTALNESS), EROSIONS[5], w, shattered);

      if (w.max < 0) {
        out.surface(temperature, humidity, COAST_CONTINENTALNESS, EROSIONS[6], w, beach);
      } else {
        out.surface(temperature, humidity, COAST_CONTINENTALNESS, EROSIONS[6], w, middle);
      }

      if (t === 0) {
        out.surface(temperature, humidity, spanP(NEAR_INLAND_CONTINENTALNESS, FAR_INLAND_CONTINENTALNESS), EROSIONS[6], w, middle);
      }
    }
  }
}

function addLowSlice(out, w) {
  out.surface(FULL_RANGE, FULL_RANGE, COAST_CONTINENTALNESS, spanP(EROSIONS[0], EROSIONS[2]), w, B('stony_shore'));
  out.surface(spanP(TEMPERATURES[1], TEMPERATURES[2]), FULL_RANGE, spanP(NEAR_INLAND_CONTINENTALNESS, FAR_INLAND_CONTINENTALNESS), EROSIONS[6], w, B('swamp'));
  out.surface(spanP(TEMPERATURES[3], TEMPERATURES[4]), FULL_RANGE, spanP(NEAR_INLAND_CONTINENTALNESS, FAR_INLAND_CONTINENTALNESS), EROSIONS[6], w, B('mangrove_swamp'));

  for (let t = 0; t < TEMPERATURES.length; t++) {
    for (let h = 0; h < HUMIDITIES.length; h++) {
      const temperature = TEMPERATURES[t];
      const humidity = HUMIDITIES[h];
      const middle = pickMiddleBiome(t, h, w);
      const middleOrBadlandsIfHot = pickMiddleBiomeOrBadlandsIfHot(t, h, w);
      const middleOrBadlandsOrSlopeIfCold = pickMiddleBiomeOrBadlandsIfHotOrSlopeIfCold(t, h, w);
      const beach = pickBeachBiome(t);
      const middleOrWindsweptSavanna = maybePickWindsweptSavannaBiome(t, h, w, middle);
      const shatteredCoast = pickShatteredCoastBiome(t, h, w);

      out.surface(temperature, humidity, NEAR_INLAND_CONTINENTALNESS, spanP(EROSIONS[0], EROSIONS[1]), w, middleOrBadlandsIfHot);
      out.surface(temperature, humidity, spanP(MID_INLAND_CONTINENTALNESS, FAR_INLAND_CONTINENTALNESS), spanP(EROSIONS[0], EROSIONS[1]), w, middleOrBadlandsOrSlopeIfCold);
      out.surface(temperature, humidity, NEAR_INLAND_CONTINENTALNESS, spanP(EROSIONS[2], EROSIONS[3]), w, middle);
      out.surface(temperature, humidity, spanP(MID_INLAND_CONTINENTALNESS, FAR_INLAND_CONTINENTALNESS), spanP(EROSIONS[2], EROSIONS[3]), w, middleOrBadlandsIfHot);
      out.surface(temperature, humidity, COAST_CONTINENTALNESS, spanP(EROSIONS[3], EROSIONS[4]), w, beach);
      out.surface(temperature, humidity, spanP(NEAR_INLAND_CONTINENTALNESS, FAR_INLAND_CONTINENTALNESS), EROSIONS[4], w, middle);
      out.surface(temperature, humidity, COAST_CONTINENTALNESS, EROSIONS[5], w, shatteredCoast);
      out.surface(temperature, humidity, NEAR_INLAND_CONTINENTALNESS, EROSIONS[5], w, middleOrWindsweptSavanna);
      out.surface(temperature, humidity, spanP(MID_INLAND_CONTINENTALNESS, FAR_INLAND_CONTINENTALNESS), EROSIONS[5], w, middle);
      out.surface(temperature, humidity, COAST_CONTINENTALNESS, EROSIONS[6], w, beach);

      if (t === 0) {
        out.surface(temperature, humidity, spanP(NEAR_INLAND_CONTINENTALNESS, FAR_INLAND_CONTINENTALNESS), EROSIONS[6], w, middle);
      }
    }
  }
}

function addValleys(out, w) {
  const riverOrShore = (river) => (w.max < 0 ? B('stony_shore') : river);

  out.surface(FROZEN_RANGE, FULL_RANGE, COAST_CONTINENTALNESS, spanP(EROSIONS[0], EROSIONS[1]), w, riverOrShore(B('frozen_river')));
  out.surface(UNFROZEN_RANGE, FULL_RANGE, COAST_CONTINENTALNESS, spanP(EROSIONS[0], EROSIONS[1]), w, riverOrShore(B('river')));
  out.surface(FROZEN_RANGE, FULL_RANGE, NEAR_INLAND_CONTINENTALNESS, spanP(EROSIONS[0], EROSIONS[1]), w, B('frozen_river'));
  out.surface(UNFROZEN_RANGE, FULL_RANGE, NEAR_INLAND_CONTINENTALNESS, spanP(EROSIONS[0], EROSIONS[1]), w, B('river'));
  out.surface(FROZEN_RANGE, FULL_RANGE, spanP(COAST_CONTINENTALNESS, FAR_INLAND_CONTINENTALNESS), spanP(EROSIONS[2], EROSIONS[5]), w, B('frozen_river'));
  out.surface(UNFROZEN_RANGE, FULL_RANGE, spanP(COAST_CONTINENTALNESS, FAR_INLAND_CONTINENTALNESS), spanP(EROSIONS[2], EROSIONS[5]), w, B('river'));
  out.surface(FROZEN_RANGE, FULL_RANGE, COAST_CONTINENTALNESS, EROSIONS[6], w, B('frozen_river'));
  out.surface(UNFROZEN_RANGE, FULL_RANGE, COAST_CONTINENTALNESS, EROSIONS[6], w, B('river'));
  out.surface(spanP(TEMPERATURES[1], TEMPERATURES[2]), FULL_RANGE, spanP(INLAND_CONTINENTALNESS, FAR_INLAND_CONTINENTALNESS), EROSIONS[6], w, B('swamp'));
  out.surface(spanP(TEMPERATURES[3], TEMPERATURES[4]), FULL_RANGE, spanP(INLAND_CONTINENTALNESS, FAR_INLAND_CONTINENTALNESS), EROSIONS[6], w, B('mangrove_swamp'));
  out.surface(FROZEN_RANGE, FULL_RANGE, spanP(INLAND_CONTINENTALNESS, FAR_INLAND_CONTINENTALNESS), EROSIONS[6], w, B('frozen_river'));

  for (let t = 0; t < TEMPERATURES.length; t++) {
    for (let h = 0; h < HUMIDITIES.length; h++) {
      const middleOrBadlandsIfHot = pickMiddleBiomeOrBadlandsIfHot(t, h, w);
      out.surface(TEMPERATURES[t], HUMIDITIES[h], spanP(MID_INLAND_CONTINENTALNESS, FAR_INLAND_CONTINENTALNESS), spanP(EROSIONS[0], EROSIONS[1]), w, middleOrBadlandsIfHot);
    }
  }
}

function addInlandBiomes(out) {
  // The 13 weirdness slices, in vanilla order.
  const slices = [
    [addMidSlice, spanF(-1, -0.93333334)],
    [addHighSlice, spanF(-0.93333334, -0.7666667)],
    [addPeaks, spanF(-0.7666667, -0.56666666)],
    [addHighSlice, spanF(-0.56666666, -0.4)],
    [addMidSlice, spanF(-0.4, -0.26666668)],
    [addLowSlice, spanF(-0.26666668, -0.05)],
    [addValleys, spanF(-0.05, 0.05)],
    [addLowSlice, spanF(0.05, 0.26666668)],
    [addMidSlice, spanF(0.26666668, 0.4)],
    [addHighSlice, spanF(0.4, 0.56666666)],
    [addPeaks, spanF(0.56666666, 0.7666667)],
    [addHighSlice, spanF(0.7666667, 0.93333334)],
    [addMidSlice, spanF(0.93333334, 1)],
  ];
  for (const [addSlice, weirdness] of slices) addSlice(out, weirdness);
}

function addUndergroundBiomes(out) {
  out.underground(FULL_RANGE, FULL_RANGE, spanF(0.8, 1), FULL_RANGE, FULL_RANGE, B('dripstone_caves'));
  out.underground(FULL_RANGE, spanF(0.7, 1), FULL_RANGE, FULL_RANGE, FULL_RANGE, B('lush_caves'));
  out.underground(
    FULL_RANGE,
    FULL_RANGE,
    spanP(COAST_CONTINENTALNESS, INLAND_CONTINENTALNESS),
    spanP(EROSIONS[5], EROSIONS[6]),
    spanF(-1.1, -0.85),
    B('sulfur_caves'),
  );
  out.bottom(FULL_RANGE, FULL_RANGE, FULL_RANGE, spanP(EROSIONS[0], EROSIONS[1]), FULL_RANGE, B('deep_dark'));
}

/** Un-quantize a single coordinate (value / 10000) without float noise. */
const unq = (v) => Math.round(v) / QUANT;

/**
 * Builds the vanilla overworld multi-noise parameter list.
 * @returns {{points: Array<object>, biomeOrder: string[]}} points in vanilla
 *   insertion order, biomeOrder = distinct biomes in first-appearance order.
 */
export function buildOverworldParameters() {
  const out = createCollector();
  addOffCoastBiomes(out);
  addInlandBiomes(out);
  addUndergroundBiomes(out);

  const biomeOrder = [];
  const seen = new Set();
  for (const p of out.points) {
    if (!seen.has(p.biome)) {
      seen.add(p.biome);
      biomeOrder.push(p.biome);
    }
  }

  return { points: out.points, biomeOrder };
}

/** Serialize one point to the compact numeric row used in worldgen.json. */
export function toRow(pointData, biomeIndex) {
  return [
    biomeIndex,
    unq(pointData.temperature.min), unq(pointData.temperature.max),
    unq(pointData.humidity.min), unq(pointData.humidity.max),
    unq(pointData.continentalness.min), unq(pointData.continentalness.max),
    unq(pointData.erosion.min), unq(pointData.erosion.max),
    unq(pointData.depth.min), unq(pointData.depth.max),
    unq(pointData.weirdness.min), unq(pointData.weirdness.max),
    unq(pointData.offset),
  ];
}

/** Documented column order of a `toRow` row. */
export const ROW_LAYOUT = [
  'biomeIndex',
  'temperatureMin', 'temperatureMax',
  'humidityMin', 'humidityMax',
  'continentalnessMin', 'continentalnessMax',
  'erosionMin', 'erosionMax',
  'depthMin', 'depthMax',
  'weirdnessMin', 'weirdnessMax',
  'offset',
];
