// Browser regression test for chunk-level entity persistence: wild animals,
// vehicles (with contents), dropped items and XP orbs survive a world save and
// reload with their position, health and inventories.
//
// The entities live in the isolated sky stage (scripts/lib/stage.mjs), so the
// reload has to restore both the stage blocks and the entity records.
//
//   node scripts/test-entity-save.mjs [--url http://127.0.0.1:5174]
import { chromium } from 'playwright';
import { launchOptions } from './lib/browser.mjs';
import { prepareStage, waitTicks } from './lib/stage.mjs';

const args = process.argv.slice(2);
const urlArg = args.indexOf('--url');
const base = urlArg >= 0 ? args[urlArg + 1] : 'http://127.0.0.1:5174';

const browser = await chromium.launch(launchOptions());
const context = await browser.newContext({ viewport: { width: 1000, height: 700 } });
const page = await context.newPage();
page.on('pageerror', (e) => console.log('PAGEERR', String(e).slice(0, 300)));
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const results = [];
const check = (name, ok, detail) => {
  results.push({ name, ok });
  console.log(`${ok ? 'PASS' : 'FAIL'} ${name}${detail === undefined ? '' : ' :: ' + JSON.stringify(detail)}`);
};

async function boot(url) {
  await page.goto(url, { waitUntil: 'domcontentloaded', timeout: 120000 });
  await page.waitForFunction(() => window.__mc?.running === true, null, { timeout: 120000 });
  await sleep(1200);
}

try {
  await boot(`${base}/?play&perf=0`);

  const stage = await prepareStage(page, {
    radius: 10, floor: 'stone',
    camera: { yaw: 180, pitch: 25 },
  });
  const { x: bx, z: bz, floorY } = stage;

  // -------------------------------------------------------------------------
  // Scene: one of each persisted entity shape, spread over the platform.
  // -------------------------------------------------------------------------
  const scene = await page.evaluate(([x, y, z]) => {
    const m = window.__mc;
    const spawn = (type, dx, dz) => {
      const e = m.entityManager.spawn(type, x + dx, y, z + dz);
      if (!e) throw new Error(`no factory for ${type}`);
      e.xo = e.x; e.yo = e.y; e.zo = e.z;
      return e;
    };
    // A 1x1 stone pen keeps wandering animals on their saved spot, so the probe
    // checks the restored coordinates instead of wherever AI walked afterwards.
    const pen = (e) => {
      const cx = Math.floor(e.x), cz = Math.floor(e.z);
      const stone = m.mc.stateOf('stone');
      for (let dy = 0; dy < 3; dy++) {
        for (let dx = -1; dx <= 1; dx++) {
          for (let dz = -1; dz <= 1; dz++) {
            if (dx === 0 && dz === 0) continue;
            m.level.setBlockState(cx + dx, y + dy, cz + dz, stone);
          }
        }
      }
    };
    const cow = spawn('cow', -4.5, 0.5);
    cow.yaw = 90; cow.yRotO = 90;
    cow.setHealth(7);
    pen(cow);
    const sheep = spawn('sheep', -2.5, 3.5);
    sheep.woolColor = 14; // red
    sheep.sheared = false;
    pen(sheep);

    const chestBoat = spawn('oak_chest_boat', 2.5, 0.5);
    chestBoat.yaw = 180; chestBoat.yRotO = 180;
    const diamond = m.survival.registry.byName('diamond');
    chestBoat.inventory.setItem(0, new (m.survival.inventory.getItem(0).constructor)(diamond, 5));

    const chestCart = spawn('chest_minecart', 4.5, 0.5);
    chestCart.yaw = 90; chestCart.yRotO = 90;
    const emerald = m.survival.registry.byName('emerald');
    chestCart.inventory.setItem(1, new (m.survival.inventory.getItem(0).constructor)(emerald, 3));

    // A dropped stack far enough from the camera that the player cannot pick it up.
    m.dropItem(new (m.survival.inventory.getItem(0).constructor)(diamond, 7), x + 0.5, y, z - 3.5);
    const orb = m.entityManager.spawn('experience_orb', x - 4.5, y + 0.2, z - 2.5);
    orb.value = 13;

    return {
      cowPos: [cow.x, cow.y, cow.z],
      sheepPos: [sheep.x, sheep.y, sheep.z],
      boatPos: [chestBoat.x, chestBoat.y, chestBoat.z],
      cartPos: [chestCart.x, chestCart.y, chestCart.z],
      orbPos: [orb.x, orb.y, orb.z],
    };
  }, [bx, floorY, bz]);
  await waitTicks(page, 8);

  // The save cycle copies live entities into their chunks (beforeSave) and writes
  // the entity-dirty chunks through the normal sharded flush.
  const saved = await page.evaluate(async () => {
    const m = window.__mc;
    await m.autosave.flushNow('manual');
    return { worldId: m.saveManager.currentWorldId, entities: m.entityManager.getEntities().length };
  });
  check('the world saved with a bound world id', !!saved.worldId && saved.entities > 0, saved);

  // -------------------------------------------------------------------------
  // Reload the same world: saved chunks are decoded and nearby chunk entities spawn.
  // -------------------------------------------------------------------------
  await boot(`${base}/?play&perf=0&world=${encodeURIComponent(saved.worldId)}`);
  await waitTicks(page, 30);
  await sleep(800);

  const restored = await page.evaluate(([x, y, z]) => {
    const m = window.__mc;
    const near = (e) => Math.abs(e.x - x) < 14 && Math.abs(e.z - z) < 14 && e.y > y - 2;
    const list = m.entityManager.getEntities().filter((e) => near(e) && !e.isRemoved());
    const name = (e) => e.getTypeName();
    const inv = (e, slot) => {
      const s = e.inventory?.getItem(slot);
      return s && !s.isEmpty() ? [s.item?.name ?? null, s.getCount()] : null;
    };
    const cows = list.filter((e) => name(e) === 'cow');
    const sheep = list.find((e) => name(e) === 'sheep');
    const boat = list.find((e) => name(e) === 'oak_chest_boat');
    const cart = list.find((e) => name(e) === 'chest_minecart');
    const items = list.filter((e) => name(e) === 'item');
    const diamond = items.find((e) => (e.item?.item?.name ?? null) === 'diamond');
    const orb = list.find((e) => name(e) === 'experience_orb');
    const block = m.level.getBlockState(x, y - 1, z);
    return {
      total: list.length,
      names: list.map(name),
      cow: cows[0] ? { count: cows.length, health: cows[0].health, pos: [cows[0].x, cows[0].y, cows[0].z] } : { count: 0 },
      sheep: sheep ? { woolColor: sheep.woolColor, sheared: sheep.sheared, pos: [sheep.x, sheep.y, sheep.z] } : null,
      boat: boat ? { slot0: inv(boat, 0), pos: [boat.x, boat.y, boat.z] } : null,
      cart: cart ? { slot1: inv(cart, 1), pos: [cart.x, cart.y, cart.z] } : null,
      item: diamond ? { stack: [diamond.item?.item?.name ?? null, diamond.item?.getCount?.() ?? null], pos: [diamond.x, diamond.y, diamond.z] } : null,
      orb: orb ? { value: orb.value, pos: [orb.x, orb.y, orb.z] } : null,
      block: m.mc.blockOf(block).name,
    };
  }, [bx, floorY, bz]);

  const close = (a, b, tol = 1.6) => Array.isArray(a) && Array.isArray(b)
    && Math.abs(a[0] - b[0]) < tol && Math.abs(a[1] - b[1]) < tol && Math.abs(a[2] - b[2]) < tol;

  check('the saved chunk still holds the stage floor', restored.block === 'stone', restored.block);
  check('the wild cow reloads exactly once with its health and position',
    restored.cow.count === 1 && Math.abs(restored.cow.health - 7) < 0.001
    && close(restored.cow.pos, scene.cowPos, 1.0),
  restored.cow);
  check('the sheep reloads with its wool colour and position',
    !!restored.sheep && restored.sheep.woolColor === 14 && restored.sheep.sheared === false
    && close(restored.sheep.pos, scene.sheepPos, 1.0),
  restored.sheep);
  check('the chest boat reloads with its inventory',
    !!restored.boat && restored.boat.slot0?.[0] === 'diamond' && restored.boat.slot0?.[1] === 5
    && close(restored.boat.pos, scene.boatPos, 2.2),
  restored.boat);
  check('the chest minecart reloads with its inventory',
    !!restored.cart && restored.cart.slot1?.[0] === 'emerald' && restored.cart.slot1?.[1] === 3
    && close(restored.cart.pos, scene.cartPos, 2.2),
  restored.cart);
  check('the dropped diamond stack reloads',
    !!restored.item && restored.item.stack[0] === 'diamond' && restored.item.stack[1] === 7
    && close(restored.item.pos, [bx + 1, floorY + 0.25, bz - 3], 2.0),
  restored.item);
  check('the experience orb reloads with its value',
    !!restored.orb && restored.orb.value === 13 && close(restored.orb.pos, scene.orbPos, 2.0),
  restored.orb);

  check('no duplicate wild animals were spawned from the restored chunk',
    restored.names.filter((n) => n === 'cow').length === 1
    && restored.names.filter((n) => n === 'oak_chest_boat').length === 1,
  restored.names);

  await page.screenshot({ path: 'shots/diag/entity-save.png' });
} catch (err) {
  console.log('ERROR', err);
  results.push({ name: 'probe', ok: false });
} finally {
  console.log('');
  console.log(`Total: ${results.filter((x) => x.ok).length}/${results.length} PASS`);
  await browser.close();
  process.exit(results.every((x) => x.ok) ? 0 : 1);
}
