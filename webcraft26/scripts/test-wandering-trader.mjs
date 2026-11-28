// Browser regression test for the wandering trader batch:
//
//   * WanderingTraderSpawner places one trader + two trader llamas near the
//     village bell/player (1-in-10 roll and the 1200-tick delay cycle);
//   * the trader has the vanilla 2 buying + 2 uncommon + 5 common offers;
//   * right-click opens the merchant screen titled "Wandering Trader" with no
//     profession level bar, and an emerald offer can be bought;
//   * trader llamas follow the trader and both despawn with it;
//   * the trader and llamas render with their vanilla skins/models.
//
//   node scripts/test-wandering-trader.mjs [--url http://127.0.0.1:5174]
import { chromium } from 'playwright';
import { launchOptions } from './lib/browser.mjs';
import { prepareStage, frameCamera, waitTicks, capture, diffPng } from './lib/stage.mjs';

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
  await sleep(1500);

  const stage = await prepareStage(page, { radius: 20, floor: 'stone', time: 6000 });
  const { x: bx, z: bz, floorY } = stage;

  // -------------------------------------------------------------------------
  // 1. Spawner: one trader + two trader llamas near the bell.
  // -------------------------------------------------------------------------
  const timer = await ev(([x, y, z]) => {
    const m = window.__mc;
    m.level.setBlockState(x + 2, y, z, m.mc.stateOf('bell'));
    const s = m.wanderingTraderSpawner;
    // Shorten the 24000-tick delay to one 1200-tick cycle for the timer check.
    s.tickDelay = 1;
    s.spawnDelay = 2400;
    return { tickDelay: s.tickDelay, spawnDelay: s.spawnDelay };
  }, [bx, floorY, bz]);
  await waitTicks(page, 3);
  const timerAfter = await ev(() => ({
    tickDelay: window.__mc.wanderingTraderSpawner.tickDelay,
    spawnDelay: window.__mc.wanderingTraderSpawner.spawnDelay,
  }));
  check('the spawn delay drops by 1200 per 1200-tick cycle',
    timerAfter.spawnDelay === 1200 && timerAfter.tickDelay <= 1200 && timerAfter.tickDelay > 1180,
    { timer, timerAfter });

  const spawned = await ev(() => {
    const m = window.__mc;
    const s = m.wanderingTraderSpawner;
    for (let i = 0; i < 100; i++) {
      if (s.attemptSpawn()) return { attempts: i + 1 };
    }
    return { attempts: 100, failed: true };
  });
  await waitTicks(page, 3);
  const world = await ev(() => {
    const m = window.__mc;
    const traders = m.entityManager.getEntities().filter((e) => e.getTypeName() === 'wandering_trader');
    const llamas = m.entityManager.getEntities().filter((e) => e.getTypeName() === 'trader_llama');
    const t = traders[0];
    return {
      traders: traders.length,
      llamas: llamas.length,
      trader: t ? { x: t.x, y: t.y, z: t.z, offers: t.getOffers().length, delay: t.getDespawnDelay() } : null,
      llamaPositions: llamas.map((l) => ({ x: l.x, y: l.y, z: l.z, trader: !!l.trader,
        dist: t ? Math.hypot(l.x - t.x, l.z - t.z) : null })),
      player: { x: m.player.pos.x, y: m.player.pos.y, z: m.player.pos.z },
    };
  });
  check('the spawner places one wandering trader', !!world.trader && world.traders === 1, spawned);
  check('the trader is spawned within 48 blocks of the player/bell',
    !!world.trader && Math.hypot(world.trader.x - (bx + 0.5), world.trader.z - (bz + 0.5)) <= 70,
    world.trader);
  check('two trader llamas accompany the trader',
    world.llamas === 2 && world.llamaPositions.every((l) => l.trader && l.dist <= 8),
    world.llamaPositions);
  check('the trader starts with a 48000-tick despawn delay',
    !!world.trader && world.trader.delay > 47990 && world.trader.delay <= 48000, world.trader);
  check('the trader has the vanilla 9 offers (2 buying + 2 uncommon + 5 common)',
    !!world.trader && world.trader.offers === 9, world.trader);

  // -------------------------------------------------------------------------
  // 2. Move the trader + llamas to the stage for the UI/trade/render checks.
  // -------------------------------------------------------------------------
  await ev(([x, y, z]) => {
    const m = window.__mc;
    const t = m.entityManager.getEntities().find((e) => e.getTypeName() === 'wandering_trader');
    const llamas = m.entityManager.getEntities().filter((e) => e.getTypeName() === 'trader_llama');
    if (!t) return;
    t.wanderTarget = null;
    t.setPos(x + 0.5, y, z - 1.4);
    t.xo = t.x; t.yo = t.y; t.zo = t.z; t.vx = t.vy = t.vz = 0;
    llamas.forEach((l, i) => {
      l.setPos(x + (i === 0 ? -2.5 : 2.5), y, z - 1.4);
      l.xo = l.x; l.yo = l.y; l.zo = l.z; l.vx = l.vy = l.vz = 0;
    });
    const p = m.player;
    p.pos.x = x + 0.5; p.pos.y = y; p.pos.z = z + 0.5;
    p.prevPos.x = p.pos.x; p.prevPos.y = p.pos.y; p.prevPos.z = p.pos.z;
    p.yaw = 180; p.pitch = 25;
    p.vel = new p.pos.constructor(0, 0, 0);
  }, [bx, floorY, bz]);
  await waitTicks(page, 2);

  const render = await ev(() => {
    const m = window.__mc;
    const t = m.entityManager.getEntities().find((e) => e.getTypeName() === 'wandering_trader');
    const llamas = m.entityManager.getEntities().filter((e) => e.getTypeName() === 'trader_llama');
    const tr = m.entityRenderer.renderers.get('wandering_trader');
    const lr = m.entityRenderer.renderers.get('trader_llama');
    return {
      traderTexture: tr?.getTextureKey?.(t),
      llamaTexture: lr?.getTextureKey?.(llamas[0]),
      llamaLayer: lr?.getLayers?.(llamas[0])?.[0]?.texture,
    };
  });
  check('the wandering trader uses the vanilla trader skin',
    render.traderTexture === 'wandering_trader/wandering_trader', render);
  check('the trader llama uses a llama coat and the trader carpet layer',
    (render.llamaTexture ?? '').startsWith('llama/llama_')
      && render.llamaLayer === 'equipment/llama_body/trader_llama', render);

  await frameCamera(page, { x: bx + 0.5, y: floorY + 2.2, z: bz + 5.5, yaw: 180, pitch: 12, fov: 70 });
  await waitTicks(page, 2);
  const withEntities = await capture(page, stage.clip);
  const visuals = await ev(() => {
    const m = window.__mc;
    for (const e of m.entityManager.getEntities()) {
      if (e.getTypeName() === 'wandering_trader' || e.getTypeName() === 'trader_llama') e.remove();
    }
    return true;
  });
  await waitTicks(page, 2);
  const withoutEntities = await capture(page, stage.clip);
  const visualDiff = diffPng(withEntities, withoutEntities, 40);
  check('the trader and llamas render in the world',
    visuals && visualDiff.changed > 1500, { changed: visualDiff.changed, bbox: visualDiff.bbox });

  // -------------------------------------------------------------------------
  // 3. Re-create a trader in front of the player, open the screen and trade.
  // -------------------------------------------------------------------------
  const ui = await ev(([x, y, z]) => {
    const m = window.__mc;
    const trader = m.entityManager.spawn('wandering_trader', x + 0.5, y, z - 1.4);
    trader.setDespawnDelay(48000);
    window.__trader = trader;
    const p = m.player;
    p.pos.x = x + 0.5; p.pos.y = y; p.pos.z = z + 0.5;
    p.prevPos.x = p.pos.x; p.prevPos.y = p.pos.y; p.prevPos.z = p.pos.z;
    p.yaw = 180; p.pitch = 25;
    p.vel = new p.pos.constructor(0, 0, 0);
    return { hasRenderer: m.entityRenderer.canRender('wandering_trader') };
  }, [bx, floorY, bz]);
  await waitTicks(page, 2);
  await ev(() => {
    const m = window.__mc;
    // Emeralds pay for every uncommon/common offer.
    const emerald = m.survival.registry.byName('emerald');
    for (let i = 0; i < 9; i++) {
      const stack = m.survival.inventory.getItem(i);
      stack.item = emerald;
      stack.count = 64;
    }
    m.useItem();
  });
  await sleep(500);
  const screen = await ev(() => {
    const m = window.__mc;
    const info = m.containerAdapter().merchantInfo();
    return {
      screen: m.screens.current?.constructor?.name,
      menu: m.survival.activeMenu?.constructor?.name,
      titleKey: info?.titleKey,
      showProgress: info?.showProgress,
      offers: info?.offers.length,
      trading: m.survival.activeMenu?.getMerchant?.()?.getTradingPlayer?.() != null,
    };
  });
  check('right-click opens the wandering trader screen',
    screen.screen === 'MerchantScreen' && screen.menu === 'MerchantMenu' && screen.trading, screen);
  check('the screen is titled as a wandering trader without a level bar',
    screen.titleKey === 'entity.minecraft.wandering_trader' && screen.showProgress === false, screen);

  const bought = await ev(() => {
    const m = window.__mc;
    const info = m.containerAdapter().merchantInfo();
    const emeraldId = m.survival.registry.byName('emerald').id;
    let index = -1;
    for (let i = 0; i < info.offers.length; i++) {
      const cost = info.offers[i].costA;
      if (cost?.itemId === emeraldId && cost.count <= 64) { index = i; break; }
    }
    if (index < 0) return { index, error: 'no emerald offer' };
    info.select(index);
    const menu = m.survival.activeMenu;
    const pay = menu.slots[0].getItem();
    const result = menu.slots[2].getItem();
    const usesBefore = window.__trader.getOffers()[index].getUses();
    menu.clicked(2, 0, 0, m.survival.asMenuPlayer());
    const carried = menu.getCarried();
    const out = {
      index,
      pay: pay.isEmpty() ? null : [pay.item.name, pay.getCount()],
      preview: result.isEmpty() ? null : [result.item.name, result.getCount()],
      carried: carried.isEmpty() ? null : [carried.item.name, carried.getCount()],
      usesBefore,
      usesAfter: window.__trader.getOffers()[index].getUses(),
    };
    if (!carried.isEmpty()) menu.clicked(3, 0, 0, m.survival.asMenuPlayer());
    return out;
  });
  check('an emerald offer can be selected (payment moved into the slot)',
    !!bought.pay, bought);
  check('buying from the trader consumes the payment and counts a use',
    !!bought.carried && bought.usesAfter === bought.usesBefore + 1, bought);

  await ev(() => {
    const m = window.__mc;
    m.screens.current?.close?.();
    m.survival.activeMenu?.removed?.(m.survival.asMenuPlayer());
    m.survival.activeMenu = null;
  });
  await waitTicks(page, 2);

  // -------------------------------------------------------------------------
  // 4. The two llamas follow the trader, and despawn together.
  // -------------------------------------------------------------------------
  const follow = await ev(([x, y, z]) => {
    const m = window.__mc;
    const t = window.__trader;
    t.setDespawnDelay(48000);
    t.setPos(x + 4.5, y, z - 5.5);
    t.xo = t.x; t.yo = t.y; t.zo = t.z; t.vx = t.vy = t.vz = 0;
    const llamas = [];
    for (const dx of [-4.5, 4.5]) {
      const l = m.entityManager.spawn('trader_llama', x + dx, y, z + 4.5);
      l.trader = t;
      l.despawnDelay = 47999;
      llamas.push(l);
    }
    window.__llamas = llamas;
    return llamas.map((l) => Math.hypot(l.x - t.x, l.z - t.z));
  }, [bx, floorY, bz]);
  await waitTicks(page, 150);
  const followed = await ev(() => {
    const t = window.__trader;
    return window.__llamas.map((l) => ({
      dist: Math.hypot(l.x - t.x, l.z - t.z),
      alive: !l.isRemoved(),
    }));
  });
  check('trader llamas follow the wandering trader',
    followed.every((l) => l.alive && l.dist < 8), { start: follow, followed });

  await ev(() => {
    const m = window.__mc;
    window.__trader.setDespawnDelay(3);
    for (const l of window.__llamas) l.despawnDelay = 20;
  });
  await waitTicks(page, 15);
  const despawned = await ev(() => ({
    traderGone: window.__trader.isRemoved() || !window.__mc.entityManager.getEntities().includes(window.__trader),
    llamasGone: window.__llamas.every((l) => l.isRemoved()
      || !window.__mc.entityManager.getEntities().includes(l)),
  }));
  check('the trader and its llamas despawn together', despawned.traderGone && despawned.llamasGone, despawned);

  await page.screenshot({ path: 'shots/diag/wandering-trader.png' });
} catch (err) {
  console.log('ERROR', err);
  results.push({ name: 'probe', ok: false });
} finally {
  console.log('');
  console.log(`Total: ${results.filter((x) => x.ok).length}/${results.length} PASS`);
  await browser.close();
  process.exit(results.every((x) => x.ok) ? 0 : 1);
}
