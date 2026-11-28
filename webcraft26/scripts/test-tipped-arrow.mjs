// Browser regression test for the tipped-arrow batch:
//
//   * minecraft:crafting_imbue is loaded as a real recipe (3x3, lingering
//     potion in the centre, eight arrows around it -> 8 tipped arrows);
//   * the crafting menu previews and consumes the grid (8 arrows + potion);
//   * releasing a bow with tipped arrows spawns an Arrow carrying the potion
//     contents and the 0.125 duration scale;
//   * hitting a zombie applies the poison effect at 1/8 duration;
//   * the fletcher master trade rolls a random #minecraft:tradeable potion.
//
//   node scripts/test-tipped-arrow.mjs [--url http://127.0.0.1:5174]
import { chromium } from 'playwright';
import { launchOptions } from './lib/browser.mjs';
import { prepareStage, waitTicks } from './lib/stage.mjs';

const args = process.argv.slice(2);
const urlArg = args.indexOf('--url');
const base = urlArg >= 0 ? args[urlArg + 1] : 'http://127.0.0.1:5174';

const browser = await chromium.launch(launchOptions());
const page = await (await browser.newContext({ viewport: { width: 1100, height: 700 } })).newPage();
page.on('pageerror', (e) => console.log('PAGEERR', String(e).slice(0, 300)));
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const ev = (fn, arg) => page.evaluate(fn, arg);
const results = [];
const check = (name, ok, detail) => {
  results.push({ name, ok });
  console.log(`${ok ? 'PASS' : 'FAIL'} ${name}${detail === undefined ? '' : ' :: ' + JSON.stringify(detail)}`);
};

// #minecraft:tradeable (data/minecraft/tags/potion/tradeable.json).
const TRADEABLE_POTIONS = new Set([
  'wind_charged', 'oozing', 'infested', 'weaving',
  'night_vision', 'long_night_vision',
  'invisibility', 'long_invisibility',
  'fire_resistance', 'long_fire_resistance',
  'leaping', 'long_leaping', 'strong_leaping',
  'slowness', 'long_slowness', 'strong_slowness',
  'turtle_master', 'long_turtle_master', 'strong_turtle_master',
  'swiftness', 'long_swiftness', 'strong_swiftness',
  'water_breathing', 'long_water_breathing',
  'healing', 'strong_healing',
  'harming', 'strong_harming',
  'poison', 'long_poison', 'strong_poison',
  'regeneration', 'long_regeneration', 'strong_regeneration',
  'strength', 'long_strength', 'strong_strength',
  'weakness', 'long_weakness',
  'slow_falling', 'long_slow_falling',
]);

try {
  await page.goto(`${base}/?play&perf=0`, { waitUntil: 'domcontentloaded', timeout: 120000 });
  await page.waitForFunction(() => window.__mc?.running === true, null, { timeout: 120000 });
  await sleep(1500);

  const stage = await prepareStage(page, { radius: 20, floor: 'stone', time: 6000 });
  const { x: bx, floorY, z: bz } = stage;

  // -------------------------------------------------------------------------
  // 1. Recipe loading: the normalized crafting_imbue recipe is registered.
  // -------------------------------------------------------------------------
  const recipe = await ev(() => {
    const m = window.__mc;
    const reg = m.survival.registry;
    const S = m.survival.inventory.getItem(0).constructor;
    window.__S = S;
    const r = m.survival.recipeManager.getRecipeById('minecraft:tipped_arrow');
    return r ? {
      type: r.type,
      source: r.source ? r.source.options : null,
      material: r.material ? r.material.options : null,
      item: r.result?.item,
      count: r.result?.count,
      known: r.type === 'minecraft:crafting_imbue',
      itemExists: !!reg.byName('tipped_arrow'),
    } : null;
  });
  check('crafting_imbue is loaded with its normalized ingredients',
    recipe?.type === 'minecraft:crafting_imbue'
    && recipe?.source?.includes('lingering_potion')
    && recipe?.material?.includes('arrow')
    && recipe?.item === 'tipped_arrow' && recipe?.count === 8
    && recipe?.itemExists === true, recipe);

  // -------------------------------------------------------------------------
  // 2. 3x3 imbue crafting: preview, wrong input, consume.
  // -------------------------------------------------------------------------
  const craft = await ev(() => {
    const m = window.__mc;
    const reg = m.survival.registry;
    const S = window.__S;
    const menu = m.survival.openCraftingTable();
    window.__craftMenu = menu;
    for (let i = 0; i < 9; i++) menu.craftSlots.setItem(i, S.EMPTY);
    for (let i = 0; i < 9; i++) {
      if (i === 4) {
        const potion = S.fromName(reg, 'lingering_potion', 1);
        potion.components.potion = 'poison';
        menu.craftSlots.setItem(4, potion);
      } else {
        menu.craftSlots.setItem(i, S.fromName(reg, 'arrow', 1));
      }
    }
    menu.recomputeResult();
    const result = menu.getResultSlot().getItem();
    return {
      item: result.item?.name ?? null,
      count: result.getCount(),
      potion: result.components.potion ?? null,
    };
  });
  check('the 3x3 imbue grid previews 8 tipped arrows with the potion component',
    craft.item === 'tipped_arrow' && craft.count === 8 && craft.potion === 'poison', craft);

  const wrong = await ev(() => {
    const m = window.__mc;
    const reg = m.survival.registry;
    const S = window.__S;
    const menu = window.__craftMenu;
    menu.craftSlots.setItem(4, S.fromName(reg, 'arrow', 1));
    menu.recomputeResult();
    return { resultEmpty: menu.getResultSlot().getItem().isEmpty() };
  });
  check('an arrow in the centre cell does not match the imbue recipe', wrong.resultEmpty, wrong);

  const consumed = await ev(() => {
    const m = window.__mc;
    const reg = m.survival.registry;
    const S = window.__S;
    const menu = window.__craftMenu;
    const potion = S.fromName(reg, 'lingering_potion', 1);
    potion.components.potion = 'poison';
    menu.craftSlots.setItem(4, potion);
    menu.recomputeResult();
    const preview = menu.getResultSlot().getItem();
    menu.consumeCraftingIngredients(null);
    const cells = [];
    for (let i = 0; i < 9; i++) cells.push(menu.craftSlots.getItem(i).isEmpty());
    const out = {
      previewPotion: preview.components.potion ?? null,
      allEmpty: cells.every(Boolean),
      resultEmpty: menu.getResultSlot().getItem().isEmpty(),
    };
    m.survival.closeMenu?.();
    return out;
  });
  check('taking the result consumes all nine cells and clears the preview',
    consumed.previewPotion === 'poison' && consumed.allEmpty && consumed.resultEmpty, consumed);

  // -------------------------------------------------------------------------
  // 3. Bow release with tipped arrows: potion payload + zombie hit.
  // -------------------------------------------------------------------------
  const shot = await ev(([x, y, z]) => {
    const m = window.__mc;
    const reg = m.survival.registry;
    const S = window.__S;
    for (let i = 0; i < 36; i++) m.survival.inventory.setItem(i, S.EMPTY);
    m.survival.inventory.setItem(0, S.fromName(reg, 'bow', 1));
    const tipped = S.fromName(reg, 'tipped_arrow', 5);
    tipped.components.potion = 'poison';
    m.survival.inventory.setItem(1, tipped);
    m.survival.inventory.setSelectedSlot(0);
    m.survival.gamemode = 'survival';
    m.options.gamemode = 'survival';
    m.mouseLocked = true;
    m.bowCharging = true;
    m.bowCharge = 20;
    const before = m.entityManager.getEntities().filter((e) => e.getTypeName() === 'arrow').length;
    m.releaseBow();
    m.entityManager.flushSpawns();
    const arrows = m.entityManager.getEntities()
      .filter((e) => e.getTypeName() === 'arrow' && !e.isRemoved());
    const arrow = arrows[arrows.length - 1];
    const rest = m.survival.inventory.getItem(1);
    // Put the target right in front of the next tick's sweep.
    const zombie = arrow ? m.entityManager.spawn('zombie',
      arrow.x + arrow.vx, arrow.y + arrow.vy, arrow.z + arrow.vz) : null;
    window.__probeArrow = arrow;
    window.__probeZombie = zombie;
    return {
      spawned: arrows.length - before,
      potion: arrow?.potion ?? null,
      scale: arrow?.potionDurationScale ?? null,
      tippedLeft: rest.isEmpty() ? 0 : rest.getCount(),
      zombie: !!zombie,
      origin: { x, y, z },
    };
  }, [bx, floorY, bz]);
  check('the bow consumes one tipped arrow and spawns a potion-carrying arrow',
    shot.spawned === 1 && shot.potion === 'poison' && shot.scale === 0.125 && shot.tippedLeft === 4,
    shot);

  await waitTicks(page, 2);
  const hit = await ev(() => {
    const m = window.__mc;
    const z = window.__probeZombie;
    const a = window.__probeArrow;
    const effect = z?.getEffect ? z.getEffect('poison') : undefined;
    return {
      poison: effect ? { duration: effect.duration, amplifier: effect.amplifier } : null,
      health: z?.health ?? null,
      arrowGone: !!a && (a.isRemoved() || !m.entityManager.getEntities().includes(a)),
    };
  });
  check('a tipped arrow hit applies poison at 1/8 duration and damages the zombie',
    !!hit.poison && hit.poison.amplifier === 0
    && hit.poison.duration >= 108 && hit.poison.duration <= 112
    && hit.health !== null && hit.health <= 12, hit);

  // Control: a plain arrow must not carry or apply any potion.
  const plain = await ev(() => {
    const m = window.__mc;
    const reg = m.survival.registry;
    const S = window.__S;
    for (const e of m.entityManager.getEntities()) e.remove();
    for (let i = 0; i < 36; i++) m.survival.inventory.setItem(i, S.EMPTY);
    m.survival.inventory.setItem(0, S.fromName(reg, 'bow', 1));
    m.survival.inventory.setItem(1, S.fromName(reg, 'arrow', 5));
    m.survival.inventory.setSelectedSlot(0);
    m.mouseLocked = true;
    m.bowCharging = true;
    m.bowCharge = 20;
    m.releaseBow();
    m.entityManager.flushSpawns();
    const arrows = m.entityManager.getEntities()
      .filter((e) => e.getTypeName() === 'arrow' && !e.isRemoved());
    const arrow = arrows[arrows.length - 1];
    const zombie = arrow ? m.entityManager.spawn('zombie',
      arrow.x + arrow.vx, arrow.y + arrow.vy, arrow.z + arrow.vz) : null;
    window.__probeArrow = arrow;
    window.__probeZombie = zombie;
    return {
      potion: arrow?.potion ?? null,
      scale: arrow?.potionDurationScale ?? null,
      arrowLeft: m.survival.inventory.getItem(1).getCount(),
    };
  });
  await waitTicks(page, 2);
  const plainHit = await ev(() => {
    const z = window.__probeZombie;
    return { poison: z?.getEffect ? !!z.getEffect('poison') : false, health: z?.health ?? null };
  });
  check('a plain arrow has no potion and applies no effect',
    plain.potion === null && plain.scale === 1 && plain.arrowLeft === 4 && !plainHit.poison, { ...plain, ...plainHit });

  // -------------------------------------------------------------------------
  // 4. Fletcher master trade data + rolled random potion.
  // -------------------------------------------------------------------------
  const tradeData = await ev(async () => {
    const data = await (await fetch('/data/villager_trades.json')).json();
    const flagged = [];
    for (const [profession, p] of Object.entries(data)) {
      for (const level of p.levels) {
        for (const t of level.trades) if (t.randomPotion) flagged.push({ profession, trade: t });
      }
    }
    return {
      flagged: flagged.length,
      entries: flagged.map((f) => ({
        profession: f.profession,
        gives: f.trade.gives,
        wants: f.trade.wants,
        additional: f.trade.additional,
      })),
      fletcherCounts: data.fletcher?.levels.map((l) => l.trades.length) ?? null,
    };
  });
  const flaggedEntry = tradeData.entries[0];
  check('only the fletcher master trade rolls a random potion',
    tradeData.flagged === 1 && flaggedEntry?.profession === 'fletcher'
    && flaggedEntry?.gives?.id === 'tipped_arrow' && flaggedEntry?.gives?.count === 5
    && flaggedEntry?.wants?.id === 'emerald' && flaggedEntry?.wants?.count === 2
    && flaggedEntry?.additional?.id === 'arrow' && flaggedEntry?.additional?.count === 5,
    tradeData);

  const offers = await ev(([x, y, z]) => {
    const m = window.__mc;
    const list = [];
    for (let i = 0; i < 12; i++) {
      const v = m.entityManager.spawn('villager', x + 2 + i, y, z + 2);
      if (!v) continue;
      v.profession = 'fletcher';
      v.professionLevel = 5;
      v.offers = [];
      v.addOffersForLevel(5);
      const offer = v.offers.find((o) => o.result?.item?.name === 'tipped_arrow');
      list.push(offer ? {
        potion: offer.result.components.potion ?? null,
        count: offer.result.getCount(),
        costA: [offer.baseCostAId, offer.baseCostACount],
        costB: offer.costB ? [offer.costB.id, offer.costB.count] : null,
        offers: v.offers.length,
      } : { missing: true, offers: v.offers.length });
      v.remove();
    }
    return list;
  }, [bx, floorY, bz]);
  // A level-5 fletcher draws 2 of the 3 master rows, so the tipped-arrow row
  // shows up on most but not necessarily every villager.
  const tippedOffers = offers.filter((o) => !o.missing);
  const allOffersValid = tippedOffers.length >= 6 && tippedOffers.every((o) =>
    o.potion && TRADEABLE_POTIONS.has(o.potion)
    && o.count === 5 && o.costA[0] === 'emerald' && o.costA[1] === 2
    && o.costB && o.costB[0] === 'arrow' && o.costB[1] === 5 && o.offers === 2);
  const distinct = new Set(tippedOffers.map((o) => o.potion).filter(Boolean));
  check('fletcher master offers carry a random #minecraft:tradeable potion',
    allOffersValid, offers);
  check('the random potion differs between villagers',
    distinct.size >= 2, [...distinct]);
} catch (err) {
  console.log('ERROR', err);
  results.push({ name: 'probe', ok: false });
} finally {
  console.log('');
  console.log(`Total: ${results.filter((x) => x.ok).length}/${results.length} PASS`);
  await browser.close();
  process.exit(results.every((x) => x.ok) ? 0 : 1);
}
