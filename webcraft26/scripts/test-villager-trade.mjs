// Browser regression test for villagers: job-site professions, generated offers,
// the merchant screen, trading, XP/level-up, restocking and world persistence.
//
//   node scripts/test-villager-trade.mjs [--url http://127.0.0.1:5174]
import { chromium } from 'playwright';
import { launchOptions } from './lib/browser.mjs';

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

try {
  await page.goto(`${base}/?play&perf=0`, { waitUntil: 'domcontentloaded', timeout: 120000 });
  await page.waitForFunction(() => window.__mc?.running === true, null, { timeout: 120000 });
  await sleep(900);

  const origin = await ev(() => {
    const m = window.__mc;
    m.options.gamemode = 'creative';
    m.survival.gamemode = 'creative';
    const p = m.player;
    p.flying = true;
    p.vel.x = p.vel.y = p.vel.z = 0;
    const bx = Math.floor(p.pos.x), by = Math.floor(p.pos.y), bz = Math.floor(p.pos.z);
    p.pos.x = bx + 0.5; p.pos.y = by; p.pos.z = bz + 0.5;
    p.yaw = 180; p.pitch = 25;
    for (let dx = -5; dx <= 10; dx++) {
      for (let dz = -10; dz <= 4; dz++) {
        m.level.setBlockState(bx + dx, by - 1, bz + dz, m.mc.stateOf('grass_block'));
        for (let dy = 0; dy <= 5; dy++) m.level.setBlockState(bx + dx, by + dy, bz + dz, 0);
      }
    }
    m.level.setBlockState(bx + 1, by, bz - 1, m.mc.stateOf('composter'));
    const villager = m.entityManager.spawn('villager', bx + 0.5, by, bz - 1.4);
    window.__villager = villager;
    // Pay for every farmer level-1 offer: crops -> emerald and emerald -> food.
    ['emerald', 'wheat', 'potato', 'carrot', 'beetroot'].forEach((name, i) => {
      const item = m.survival.registry.byName(name);
      const stack = m.survival.inventory.getItem(i);
      if (item) { stack.item = item; stack.count = 64; }
    });
    return {
      bx, by, bz,
      canRender: m.entityRenderer.canRender('villager'),
      tradeData: !!window.__mc && typeof fetch === 'function',
    };
  });
  const { bx, by, bz } = origin;
  check('villager has a renderer', origin.canRender === true, origin);
  await sleep(500);

  // 1. The composter is claimed and the villager becomes a farmer with level-1 offers.
  let state = null;
  for (let i = 0; i < 10; i++) {
    state = await ev(() => {
      const v = window.__villager;
      return v ? {
        profession: v.profession, level: v.professionLevel, offers: v.offers.length,
        type: v.villagerType, job: v.jobSite,
      } : null;
    });
    if (state?.offers > 0) break;
    await sleep(500);
  }
  check('composter assigns the farmer profession', state?.profession === 'farmer'
    && state?.level === 1 && state?.job !== null, state);
  check('farmer gets its level-1 trade set', state?.offers === 2, state);
  check('villager type follows the biome', state?.type === 'plains', state);

  // 2. Right-click opens MerchantScreen backed by a MerchantMenu.
  await ev(([x, y, z]) => {
    const m = window.__mc;
    const v = window.__villager;
    v.setPos(x + 0.5, y, z - 1.4);
    v.vx = v.vy = v.vz = 0;
    m.player.pos.x = x + 0.5; m.player.pos.y = y; m.player.pos.z = z + 0.5;
    m.player.yaw = 180; m.player.pitch = 25;
    m.useItem();
  }, [bx, by, bz]);
  await sleep(500);
  const screen = await ev(() => ({
    screen: window.__mc.screens.current?.constructor?.name,
    menu: window.__mc.survival.activeMenu?.constructor?.name,
    trading: window.__mc.survival.activeMenu?.getMerchant?.()?.getTradingPlayer?.() != null,
  }));
  check('right-click opens the merchant screen', screen.screen === 'MerchantScreen'
    && screen.menu === 'MerchantMenu', screen);

  // 3. Selecting an offer moves its payment into slot 0 and previews the result.
  const picked = await ev(() => {
    const m = window.__mc;
    const info = m.containerAdapter().merchantInfo();
    let index = 0;
    // Pick the first offer whose payment the inventory can satisfy.
    for (let i = 0; i < info.offers.length; i++) {
      const cost = info.offers[i].costA;
      for (let slot = 0; slot < 36; slot++) {
        const stack = m.survival.inventory.getItem(slot);
        if (!stack.isEmpty() && stack.item.id === cost.itemId && stack.getCount() >= cost.count) { index = i; break; }
      }
    }
    info.select(index);
    const menu = m.survival.activeMenu;
    const pay = menu.slots[0].getItem();
    const result = menu.slots[2].getItem();
    return {
      index,
      pay: pay.isEmpty() ? null : [pay.item.name, pay.getCount()],
      result: result.isEmpty() ? null : [result.item.name, result.getCount()],
    };
  });
  check('selecting an offer fills the payment slot', picked.pay !== null, picked);
  check('selecting an offer previews the result', picked.result !== null, picked);

  // 4. Taking the result consumes the payment, awards xp and records the trade.
  const traded = await ev(() => {
    const m = window.__mc;
    const menu = m.survival.activeMenu;
    const before = m.survival.inventory.getItem(0).getCount();
    menu.clicked(2, 0, 0, m.survival.asMenuPlayer());
    const carried = menu.getCarried();
    const picked = carried.isEmpty() ? null : [carried.item.name, carried.getCount()];
    // Put the result into the inventory so the cursor is empty for the next trade
    // (the result slot only accepts an empty cursor, like vanilla).
    if (!carried.isEmpty()) menu.clicked(3, 0, 0, m.survival.asMenuPlayer());
    return {
      carried: picked,
      cursorEmpty: menu.getCarried().isEmpty(),
      uses: window.__villager.offers.slice(0, 4).map((o) => o.uses),
      xp: window.__villager.xp,
      stats: m.stats.toJSON?.()?.custom?.traded_with_villager ?? 0,
      inventoryDelta: before - m.survival.inventory.getItem(0).getCount(),
      advTrade: m.advancements.isComplete('adventure/trade'),
      advHigh: m.advancements.isComplete('adventure/trade_at_world_height'),
    };
  });
  check('taking the result completes the trade', traded.carried !== null
    && traded.uses.some((u) => u > 0) && traded.xp > 0, traded);
  check('trade increments the villager statistic', traded.stats >= 1, traded);
  check('trading earns adventure/trade but not the y>=319 advancement',
    traded.advTrade === true && traded.advHigh === false, traded);

  // 5. Reaching 10 XP levels the farmer up to 2 and adds the next trade set.
  await ev(() => {
    const m = window.__mc;
    const v = window.__villager;
    v.xp = 9;
    const info = m.containerAdapter().merchantInfo();
    info.select(0);
    m.survival.activeMenu.clicked(2, 0, 0, m.survival.asMenuPlayer());
  });
  await sleep(2600);
  const level = await ev(() => ({
    xp: window.__villager.xp,
    level: window.__villager.professionLevel,
    offers: window.__villager.offers.length,
    screenLevel: window.__mc.containerAdapter().merchantInfo().level,
  }));
  check('10 XP levels the villager up and adds offers', level.level === 2
    && level.offers === 4 && level.screenLevel === 2, level);

  // 6. A day change resets stock usage (catch-up demand + restock).
  await ev(() => {
    const m = window.__mc;
    const v = window.__villager;
    v.restocksToday = 0;
    v.lastRestockGameTime = m.level.gameTime - 13000;
  });
  await sleep(1500);
  const restock = await ev(() => ({
    uses: window.__villager.offers.map((o) => o.uses),
    restocks: window.__villager.restocksToday,
    demand: window.__villager.offers.map((o) => o.demand),
  }));
  check('a new day restocks the villager', restock.uses.every((u) => u === 0), restock);

  // 7. Save the world, reload it and verify the villager state came back.
  const save = await ev(async () => {
    const m = window.__mc;
    if (!m.autosave || !m.currentWorldId) return { ok: false };
    await m.autosave.flushNow('manual');
    return { ok: true, id: m.currentWorldId };
  });
  if (save.ok) {
    await page.goto(`${base}/?play&perf=0&world=${save.id}`, { waitUntil: 'domcontentloaded', timeout: 120000 });
    await page.waitForFunction(() => window.__mc?.running === true, null, { timeout: 120000 });
    await sleep(1600);
    const restored = await ev(() => window.__mc.entityManager.getEntities()
      .filter((e) => e.constructor?.name === 'Villager')
      .map((v) => ({
        type: v.villagerType, profession: v.profession, level: v.professionLevel,
        xp: v.xp, offers: v.offers.length, job: v.jobSite,
      })));
    check('villager profession, level and offers restore from the save',
      restored.some((v) => v.profession === 'farmer' && v.level === 2
        && v.offers === 4 && v.job !== null), restored);
  } else {
    check('world save is available for villager persistence', false, save);
  }

  // 8. Enchanted-book offers roll an enchantment (data wants count 0) and round-trip.
  const enchant = await ev(async () => {
    const mod = await import('/src/vanilla/world/item/trading/MerchantOffer.js');
    const m = window.__mc;
    const spec = {
      wants: { id: 'emerald', count: 0 },
      gives: { id: 'enchanted_book', count: 1 },
      maxUses: 12, xp: 5, priceMultiplier: 0.2,
      enchantRandomly: true, doubleTradePrice: true,
    };
    const offer = new mod.MerchantOffer(spec, m.survival.registry, m.entityManager.random, 3);
    const saved = offer.toJSON();
    const back = mod.MerchantOffer.fromJSON(saved, m.survival.registry);
    return {
      cost: offer.baseCostACount,
      item: offer.result.item?.name,
      rolled: offer.result.components.enchantments ?? null,
      restored: back.result.components.enchantments ?? null,
      restoredCost: back.baseCostACount,
      uses: back.uses,
    };
  });
  check('enchanted-book offers roll and persist an enchantment',
    enchant.item === 'enchanted_book' && enchant.rolled !== null
    && JSON.stringify(enchant.rolled) === JSON.stringify(enchant.restored)
    && enchant.cost >= 1 && enchant.uses === 0, enchant);

  await page.screenshot({ path: 'shots/diag/villager-trade.png' });
} catch (err) {
  console.log('ERROR', err);
  results.push({ name: 'probe', ok: false });
} finally {
  console.log('');
  console.log(`Total: ${results.filter((x) => x.ok).length}/${results.length} PASS`);
  await browser.close();
  process.exit(results.every((x) => x.ok) ? 0 : 1);
}
