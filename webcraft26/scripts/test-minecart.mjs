// Browser regression test for minecarts: rail following, friction, curves,
// slopes, powered/detector rails, item placement, riding, chest carts and drops.
//
//   node scripts/test-minecart.mjs [--url http://127.0.0.1:5174]
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
    p.vel = new p.pos.constructor(0, 0, 0);
    const bx = Math.floor(p.pos.x), by = Math.floor(p.pos.y), bz = Math.floor(p.pos.z);
    p.pos.x = bx + 0.5; p.pos.y = by; p.pos.z = bz + 4.5; p.yaw = 180; p.pitch = 25;
    for (let dx = -8; dx <= 14; dx++) {
      for (let dz = -10; dz <= 12; dz++) {
        m.level.setBlockState(bx + dx, by - 1, bz + dz, m.mc.stateOf('grass_block'));
        for (let dy = 0; dy <= 6; dy++) m.level.setBlockState(bx + dx, by + dy, bz + dz, 0);
      }
    }
    const rail = (x, z, name = 'rail', shape = 'north_south') =>
      m.level.setBlockState(x, by, z, m.mc.stateOf(name, { shape }));
    for (let i = -6; i <= 8; i++) rail(bx, bz + i);
    return { bx, by, bz, canRender: m.entityRenderer.canRender('minecart') };
  });
  const { bx, by, bz } = origin;
  check('minecart has a renderer', origin.canRender === true, origin);

  // 1. Spawning on a rail snaps the cart onto the track.
  await ev(([x, y, z]) => {
    const m = window.__mc;
    window.__cart = m.entityManager.spawn('minecart', x + 0.5, y + 0.1, z + 0.5);
  }, [bx, by, bz]);
  await sleep(350);
  const snapped = await ev(() => {
    const c = window.__cart;
    return { y: c.y, onRails: c.onRails, yaw: c.yaw };
  });
  check('minecart snaps onto the rail', snapped.onRails === true
    && Math.abs(snapped.y - (origin.by + 0.1)) < 0.06, snapped);

  // 2. Natural slowdown on a straight flat rail.
  const friction = await ev(() => {
    const c = window.__cart;
    c.vz = -0.2;
    return { start: c.z, speed: c.vz };
  });
  await sleep(500);
  const slowed = await ev(() => {
    const c = window.__cart;
    return { speed: Math.abs(c.vz), z: c.z };
  });
  check('flat rails slow the cart down', slowed.speed < Math.abs(friction.speed) - 0.005
    && slowed.z < friction.start - 0.5, { friction, slowed });

  // 3. A south_east corner turns a southbound cart east.
  const curve = await ev(([x, y, z]) => {
    const m = window.__mc;
    const rail = (rx, rz, shape) => m.level.setBlockState(rx, y, rz, m.mc.stateOf('rail', { shape }));
    rail(x, z - 6, 'south_east');
    for (let i = 1; i <= 5; i++) rail(x + i, z - 6, 'east_west');
    const c = m.entityManager.spawn('minecart', x + 0.5, y + 0.1, z - 3.5);
    c.vz = -0.2;
    window.__curveCart = c;
    return { z: c.z };
  }, [bx, by, bz]);
  await sleep(1600);
  const turned = await ev(([x, z]) => {
    const c = window.__curveCart;
    return { x: c.x, z: c.z, vx: c.vx, vz: c.vz };
  }, [bx, bz]);
  check('a corner turns the cart east', turned.x > bx + 1.5
    && Math.abs(turned.z - (bz - 5.5)) < 0.3 && turned.vx > 0.03,
  { start: curve, turned });

  // 4. ascending_north lifts the cart one block.
  const slope = await ev(([x, y, z]) => {
    const m = window.__mc;
    const sx = x + 6;
    const rail = (rx, ry, rz, shape) => m.level.setBlockState(rx, ry, rz, m.mc.stateOf('rail', { shape }));
    rail(sx, y, z + 2, 'north_south');
    rail(sx, y, z + 1, 'north_south');
    rail(sx, y, z, 'ascending_north');
    rail(sx, y + 1, z - 1, 'north_south');
    rail(sx, y + 1, z - 2, 'north_south');
    const c = m.entityManager.spawn('minecart', sx + 0.5, y + 0.1, z + 1.5);
    c.vz = -0.25;
    window.__slopeCart = c;
    return { x: sx };
  }, [bx, by, bz]);
  await sleep(700);
  const climbed = await ev(([x, y]) => {
    const c = window.__slopeCart;
    return { x: c.x, y: c.y, z: c.z, onRails: c.onRails };
  }, [slope.x, by]);
  check('an ascending rail lifts the cart one block', climbed.y > by + 0.9, { slope, climbed });

  // 5. A powered rail adds speed.
  const boost = await ev(([x, y, z]) => {
    const m = window.__mc;
    const px = x + 10;
    const rail = (rz, name) => m.level.setBlockState(px, y, rz, m.mc.stateOf(name, { shape: 'north_south' }));
    for (let i = -3; i <= 5; i++) rail(z + i, 'rail');
    rail(z + 2, 'powered_rail');
    m.level.setBlockState(px + 1, y, z + 2, m.mc.stateOf('redstone_block'));
    m.updateNeighbors(px + 1, y, z + 2);
    const c = m.entityManager.spawn('minecart', px + 0.5, y + 0.1, z + 1.5);
    c.vz = 0.1;
    window.__boostCart = c;
    return { powered: m.mc.getProp(m.level.getBlockState(px, y, z + 2), 'powered') };
  }, [bx, by, bz]);
  await sleep(700);
  const boosted = await ev(() => ({ speed: window.__boostCart.vz, z: window.__boostCart.z }));
  check('a powered rail accelerates the cart', boost.powered === 'true'
    && boosted.speed > 0.11, { boost, boosted });

  // 6. A detector rail powers while occupied and releases afterwards.
  const detector = await ev(([x, y, z]) => {
    const m = window.__mc;
    m.level.setBlockState(x, y, z - 2, m.mc.stateOf('detector_rail', { shape: 'north_south' }));
    const c = m.entityManager.spawn('minecart', x + 0.5, y + 0.1, z - 1.5);
    window.__detectorCart = c;
    return { charge: m.mc.getProp(m.level.getBlockState(x, y, z - 2), 'powered') };
  }, [bx, by, bz]);
  await sleep(400);
  const onDetector = await ev(([x, y, z]) => ({
    charge: window.__mc.mc.getProp(window.__mc.level.getBlockState(x, y, z - 2), 'powered'),
    z: window.__detectorCart.z,
  }), [bx, by, bz]);
  await ev(() => { window.__detectorCart.setPos(window.__detectorCart.x, window.__detectorCart.y, window.__detectorCart.z + 5); });
  await sleep(400);
  const offDetector = await ev(([x, y, z]) => ({
    charge: window.__mc.mc.getProp(window.__mc.level.getBlockState(x, y, z - 2), 'powered'),
    z: window.__detectorCart.z,
  }), [bx, by, bz]);
  check('a detector rail charges under a cart and releases it',
    detector.charge === 'false' && onDetector.charge === 'true' && offDetector.charge === 'false',
    { detector, onDetector, offDetector });

  // 7. MinecartItem.useOn: rails accept the item; creative keeps it, survival consumes one.
  const placement = await ev(async ([x, y, z]) => {
    const m = window.__mc;
    const railZ = z + 8;
    m.level.setBlockState(x, y, railZ, m.mc.stateOf('rail', { shape: 'north_south' }));
    m.player.pos.x = x + 0.5; m.player.pos.y = y; m.player.pos.z = railZ + 1.5;
    m.player.yaw = 180; m.player.pitch = 55;
    m.useCooldown = 0;
    const stack = m.survival.getSelectedStack();
    stack.item = m.survival.registry.byName('minecart');
    stack.count = 5;
    const before = m.entityManager.getEntities().filter((e) => e.constructor.name === 'Minecart').length;
    m.useItem();
    const afterCreative = m.entityManager.getEntities().filter((e) => e.constructor.name === 'Minecart').length;
    const creativeCount = stack.getCount();
    for (const e of m.entityManager.getEntities()) if (e.constructor.name === 'Minecart') e.remove();
    await new Promise((r) => setTimeout(r, 250));
    m.options.gamemode = 'survival'; m.survival.gamemode = 'survival';
    m.player.pos.x = x + 0.5; m.player.pos.y = y; m.player.pos.z = railZ + 1.5;
    m.player.yaw = 180; m.player.pitch = 55;
    m.useCooldown = 0;
    m.useItem();
    const afterSurvival = m.entityManager.getEntities().filter((e) => e.constructor.name === 'Minecart').length;
    const survivalCount = stack.getCount();
    m.options.gamemode = 'creative'; m.survival.gamemode = 'creative';
    for (const e of m.entityManager.getEntities()) if (e.constructor.name === 'Minecart') e.remove();
    return { before, afterCreative, creativeCount, afterSurvival, survivalCount };
  }, [bx, by, bz]);
  check('rails accept carts; creative keeps the item, survival consumes one',
    placement.afterCreative === placement.before + 1 && placement.creativeCount === 5
    && placement.afterSurvival === 1 && placement.survivalCount === 4,
    placement);

  // 8. Right-click mounts; the player follows the cart; sneak dismounts.
  await sleep(250);
  const ride = await ev(([x, y, z]) => {
    const m = window.__mc;
    const c = m.entityManager.spawn('minecart', x + 0.5, y + 0.1, z + 0.5);
    c.vz = 0;
    window.__rideCart = c;
    m.player.pos.x = c.x; m.player.pos.y = c.y; m.player.pos.z = c.z + 1.3;
    m.player.yaw = 180; m.player.pitch = 40;
    m.useCooldown = 0;
    m.useItem();
    return { riding: !!m.ridingMinecart, rider: c.rider === m.player };
  }, [bx, by, bz]);
  await sleep(350);
  const following = await ev(() => {
    const m = window.__mc;
    const c = window.__rideCart;
    c.vz = -0.15;
    return {
      riding: !!m.ridingMinecart,
      dx: Math.abs(m.player.pos.x - c.x),
      dz: Math.abs(m.player.pos.z - c.z),
      py: m.player.pos.y,
      cy: c.y,
    };
  });
  await sleep(600);
  const following2 = await ev(() => {
    const m = window.__mc;
    const c = window.__rideCart;
    return {
      riding: !!m.ridingMinecart,
      dx: Math.abs(m.player.pos.x - c.x),
      dz: Math.abs(m.player.pos.z - c.z),
      py: m.player.pos.y,
      cy: c.y,
    };
  });
  await ev(() => { window.__mc.keys.add('ShiftLeft'); });
  await sleep(350);
  const dismounted = await ev(() => {
    const m = window.__mc;
    m.keys.delete('ShiftLeft');
    return { riding: !!m.ridingMinecart, rider: window.__rideCart.rider };
  });
  check('right-click mounts, the ride follows the cart and sneak dismounts',
    ride.riding === true && following2.riding === true && following2.dx < 0.1
    && Math.abs(following2.dz) < 0.3 && dismounted.riding === false && dismounted.rider === null,
    { ride, following, following2, dismounted });

  // 9. Chest minecart opens a 27-slot container and keeps its contents.
  const chest = await ev(async ([x, y, z]) => {
    const m = window.__mc;
    const cart = m.entityManager.spawn('chest_minecart', x + 0.5, y + 0.1, z + 0.5);
    window.__chestCart = cart;
    const item = m.survival.registry.byName('diamond');
    cart.inventory.setItem(0, new (m.survival.inventory.getItem(0).constructor)(item, 7));
    m.player.pos.x = cart.x; m.player.pos.y = cart.y; m.player.pos.z = cart.z + 1.3;
    m.player.yaw = 180; m.player.pitch = 35;
    m.useCooldown = 0;
    m.useItem();
    m.screens.close();
    m.survival.closeMenu();
    await new Promise((r) => setTimeout(r, 300));
    m.player.pos.x = cart.x; m.player.pos.y = cart.y; m.player.pos.z = cart.z + 1.3;
    m.player.yaw = 180; m.player.pitch = 35;
    m.useCooldown = 0;
    m.useItem();
    const menu = m.survival.activeMenu;
    const stack = menu?.slots?.[0]?.getItem();
    return {
      screen: m.screens.current?.constructor?.name,
      slots: menu?.slots?.length,
      containerSlots: cart.getContainerSize(),
      stored: stack?.isEmpty?.() ? null : [stack?.item?.name, stack?.getCount()],
    };
  }, [bx, by, bz]);
  check('a chest minecart opens its 27-slot inventory and keeps contents',
    chest.screen === 'ChestScreen' && chest.slots === 63 && chest.containerSlots === 27
    && chest.stored?.[0] === 'diamond' && chest.stored?.[1] === 7, chest);
  await ev(() => { window.__mc.screens.close(); window.__mc.survival.closeMenu(); });

  // 10. Breaking a cart in survival drops the cart item.
  await ev(([x, y, z]) => {
    const m = window.__mc;
    for (const e of m.entityManager.getEntities()) if (e.constructor.name === 'Minecart') e.remove();
    m.options.gamemode = 'survival'; m.survival.gamemode = 'survival';
    const c = m.entityManager.spawn('minecart', x + 0.5, y + 0.1, z + 0.5);
    window.__breakCart = c;
    m.player.pos.x = c.x; m.player.pos.y = c.y; m.player.pos.z = c.z + 1.5;
    m.player.yaw = 180; m.player.pitch = 30;
    m.attackCooldown = 0;
    m.attack();
  }, [bx, by, bz]);
  await sleep(250);
  const drop = await ev(() => {
    const m = window.__mc;
    const items = m.entityManager.getEntities()
      .filter((e) => e.constructor.name === 'ItemEntity')
      .map((e) => e.item?.item?.name ?? e.item?.name ?? null);
    m.options.gamemode = 'creative'; m.survival.gamemode = 'creative';
    return { removed: window.__breakCart.isRemoved(), items: items.slice(-3) };
  });
  check('breaking a cart in survival drops its item', drop.removed === true
    && drop.items.includes('minecart'), drop);

  await page.screenshot({ path: 'shots/diag/minecart.png' });
} catch (err) {
  console.log('ERROR', err);
  results.push({ name: 'probe', ok: false });
} finally {
  console.log('');
  console.log(`Total: ${results.filter((x) => x.ok).length}/${results.length} PASS`);
  await browser.close();
  process.exit(results.every((x) => x.ok) ? 0 : 1);
}
