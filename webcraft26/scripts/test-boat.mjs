// Browser regression test for boats / rafts: floating, paddling, turning,
// land friction, item placement, mounting, chest boats, damage drops and the
// rendered silhouette.
//
// Everything runs inside a controlled stage (scripts/lib/stage.mjs): a stone
// platform high above the terrain, frozen noon, no mobs. Visual checks diff two
// screenshots of the same fixed camera, so unrelated blocks cannot affect them.
//
//   node scripts/test-boat.mjs [--url http://127.0.0.1:5174]
import { chromium } from 'playwright';
import { launchOptions } from './lib/browser.mjs';
import { prepareStage, capture, diffPng, savePng, waitTicks } from './lib/stage.mjs';

const args = process.argv.slice(2);
const urlArg = args.indexOf('--url');
const base = urlArg >= 0 ? args[urlArg + 1] : 'http://127.0.0.1:5174';

const BOAT_TYPES = [
  'acacia_boat', 'acacia_chest_boat', 'bamboo_raft', 'bamboo_chest_raft',
  'birch_boat', 'birch_chest_boat', 'cherry_boat', 'cherry_chest_boat',
  'dark_oak_boat', 'dark_oak_chest_boat', 'jungle_boat', 'jungle_chest_boat',
  'mangrove_boat', 'mangrove_chest_boat', 'oak_boat', 'oak_chest_boat',
  'pale_oak_boat', 'pale_oak_chest_boat', 'spruce_boat', 'spruce_chest_boat',
];

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

  // -------------------------------------------------------------------------
  // Stage: an 8x8 source-water pool recessed into a stone platform in the sky.
  // -------------------------------------------------------------------------
  const stage = await prepareStage(page, {
    radius: 12,
    water: { dx: -6, dz: -6, w: 12, d: 12 },
    camera: { yaw: 180, pitch: 30 },
  });
  const { x: bx, z: bz, floorY } = stage;
  const waterY = floorY - 1 + 8 / 9;
  check('stage is built above the world', Number.isFinite(floorY) && floorY > 100, stage);

  const renderers = await ev((types) => {
    const m = window.__mc;
    return types.map((t) => [t, m.entityRenderer.canRender(t)]);
  }, BOAT_TYPES);
  check('all 20 boat/raft types have a renderer',
    renderers.every(([, ok]) => ok === true),
    renderers.filter(([, ok]) => !ok));

  // -------------------------------------------------------------------------
  // 1. A boat dropped on the pool floats at the vanilla water line.
  // -------------------------------------------------------------------------
  await ev(([x, y, z]) => {
    const m = window.__mc;
    window.__boat = m.entityManager.spawn('oak_boat', x + 0.5, y + 0.02, z + 0.5);
    window.__boat.yaw = 180;
    window.__boat.yRotO = 180;
  }, [bx, waterY, bz]);
  await waitTicks(page, 6);
  const floating = await ev(() => {
    const b = window.__boat;
    return { status: b.status, y: b.y, onGround: b.onGround, vy: b.vy, inWater: b.inWater };
  });
  check('a boat floats on source water',
    floating.status === 'IN_WATER' && Math.abs(floating.y - (floorY - 0.4615)) < 0.12
    && floating.onGround === false,
  { waterY, expected: floorY - 0.4615, floating });

  // -------------------------------------------------------------------------
  // 2. Right-click mounts; W rowing forward, D turning, sneak dismounts.
  // -------------------------------------------------------------------------
  const mount = await ev(() => {
    const m = window.__mc;
    const b = window.__boat;
    m.player.pos.x = b.x;
    m.player.pos.y = b.y + 1;
    m.player.pos.z = b.z + 1.4;
    m.player.yaw = 180;
    m.player.pitch = 45;
    m.useCooldown = 0;
    m.useItem();
    return { riding: m.ridingBoat === b, rider: b.rider === m.player };
  });
  check('right-click mounts the boat', mount.riding === true && mount.rider === true, mount);

  await ev(() => { window.__mc.keys.add('KeyW'); });
  const rowStart = await ev(() => ({ x: window.__boat.x, z: window.__boat.z }));
  // 12 ticks stay clear of the 12x12 pool rim (20 ticks can reach it and stop).
  await waitTicks(page, 12);
  // Read while W is still held: the paddle state drops as soon as the next input tick
  // sees the key released, which made the paddle assertion timing-dependent.
  const rowed = await ev(([x, z]) => {
    const m = window.__mc;
    const b = window.__boat;
    return {
      dx: b.x - x, dz: b.z - z, speed: Math.hypot(b.vx, b.vz),
      // The player is positioned before the boat's own tick, so the seat lags one
      // tick of travel (vanilla packet ordering has the same one-tick offset).
      following: Math.abs(m.player.pos.x - b.x) < 0.6 && Math.abs(m.player.pos.z - b.z) < 0.6,
      paddle: b.getRowingTime(0, 0.5),
    };
  }, [rowStart.x, rowStart.z]);
  check('W rows the boat forward and the camera follows',
    rowed.dz < -1.0 && Math.abs(rowed.dx) < 0.4 && rowed.speed > 0.05 && rowed.following === true,
    rowed);
  await ev(() => { window.__mc.keys.delete('KeyW'); });

  const yawBefore = await ev(() => window.__boat.yaw);
  await ev(() => { window.__mc.keys.add('KeyD'); });
  await waitTicks(page, 12);
  await ev(() => { window.__mc.keys.delete('KeyD'); });
  const turned = await ev((before) => ({
    yaw: window.__boat.yaw,
    delta: ((window.__boat.yaw - before + 540) % 360) - 180,
    deltaRotation: window.__boat.deltaRotation,
  }), yawBefore);
  check('D turns the boat', Math.abs(turned.delta) > 10, { yawBefore, turned });

  await ev(() => { window.__mc.keys.add('ShiftLeft'); });
  await waitTicks(page, 3);
  const dismounted = await ev(() => {
    const m = window.__mc;
    m.keys.delete('ShiftLeft');
    return { riding: m.ridingBoat, rider: window.__boat.rider, playerZ: m.player.pos.z, boatZ: window.__boat.z };
  });
  check('sneak dismounts beside the boat',
    dismounted.riding === null && dismounted.rider === null
    && Math.abs(dismounted.playerZ - dismounted.boatZ - 0.5) < 1.5, dismounted);
  await ev(() => { window.__boat.remove(); });

  // -------------------------------------------------------------------------
  // 3. Land friction: a boat pushed on stone slows to a stop.
  // -------------------------------------------------------------------------
  const land = await ev(([x, y, z]) => {
    const m = window.__mc;
    const b = m.entityManager.spawn('oak_boat', x - 8.5, y, z + 0.5);
    b.yaw = 0;
    b.vz = 0.3;
    window.__landBoat = b;
    return { z: b.z, y: b.y };
  }, [bx, floorY, bz]);
  await waitTicks(page, 30);
  const landed = await ev(() => {
    const b = window.__landBoat;
    return { status: b.status, speed: Math.abs(b.vz), z: b.z, y: b.y, moved: b.z - 0 };
  });
  check('a boat on stone is slowed by ground friction',
    landed.status === 'ON_LAND' && landed.speed < 0.05, { land, landed });
  await ev(() => { window.__landBoat.remove(); });

  // -------------------------------------------------------------------------
  // 4. BoatItem.use: places on the fluid surface; creative keeps, survival
  //    consumes one. A solid block face also accepts a boat.
  // -------------------------------------------------------------------------
  const placement = await ev(async ([x, y, z, waterLevel]) => {
    const m = window.__mc;
    for (const e of m.entityManager.getEntities()) {
      if (!e.isRemoved() && (e.kind?.endsWith?.('_boat') || e.kind?.endsWith?.('_raft'))) e.remove();
    }
    const stack = m.survival.getSelectedStack();
    stack.item = m.survival.registry.byName('oak_boat');
    stack.count = 3;
    const aimWater = () => {
      m.player.flying = true;
      m.player.pos.x = x + 0.5; m.player.pos.y = y + 1.2; m.player.pos.z = z + 2.5;
      m.player.yaw = 180; m.player.pitch = 50;
      m.player.vel = new m.player.pos.constructor(0, 0, 0);
      m.useCooldown = 0;
    };
    aimWater();
    m.options.gamemode = 'creative'; m.survival.gamemode = 'creative';
    m.useItem();
    const creativeBoats = m.entityManager.getEntities()
      .filter((e) => !e.isRemoved() && e.kind === 'oak_boat');
    const creativeCount = stack.getCount();
    for (const e of creativeBoats) e.remove();
    await new Promise((r) => setTimeout(r, 250));
    aimWater();
    m.options.gamemode = 'survival'; m.survival.gamemode = 'survival';
    m.useItem();
    const boat = m.entityManager.getEntities().find((e) => e.kind === 'oak_boat' && !e.isRemoved());
    const survivalCount = stack.getCount();
    const placedY = boat ? boat.y : NaN;
    if (boat) boat.remove();
    m.options.gamemode = 'creative'; m.survival.gamemode = 'creative';
    return {
      creativeBoats: creativeBoats.length, creativeCount, survivalCount,
      placedY, waterLevel,
    };
  }, [bx, floorY, bz, waterY]);
  check('placement on water: creative keeps the item, survival consumes one',
    placement.creativeBoats === 1 && placement.creativeCount === 3
    && placement.survivalCount === 2
    && Math.abs(placement.placedY - waterY) < 0.15,
  placement);

  const landPlacement = await ev(([x, y, z]) => {
    const m = window.__mc;
    m.options.gamemode = 'creative'; m.survival.gamemode = 'creative';
    const stack = m.survival.getSelectedStack();
    stack.item = m.survival.registry.byName('oak_boat');
    stack.count = 3;
    m.player.flying = true;
    m.player.pos.x = x - 8.5; m.player.pos.y = y + 1.2; m.player.pos.z = z + 2.5;
    m.player.yaw = 180; m.player.pitch = 50;
    m.useCooldown = 0;
    m.useItem();
    const boat = m.entityManager.getEntities().find((e) => e.kind === 'oak_boat' && !e.isRemoved());
    const out = boat ? { y: boat.y, status: boat.status } : null;
    if (boat) boat.remove();
    return out;
  }, [bx, floorY, bz]);
  check('a boat can be placed on a solid block top',
    !!landPlacement && Math.abs(landPlacement.y - floorY) < 0.2, landPlacement);

  // -------------------------------------------------------------------------
  // 5. Chest boat: sneak + right-click opens 27 slots and keeps contents.
  // -------------------------------------------------------------------------
  const chest = await ev(([x, y, z]) => {
    const m = window.__mc;
    const boat = m.entityManager.spawn('oak_chest_boat', x + 0.5, y, z + 0.5);
    window.__chestBoat = boat;
    const item = m.survival.registry.byName('diamond');
    boat.inventory.setItem(0, new (m.survival.inventory.getItem(0).constructor)(item, 5));
    m.player.flying = true;
    m.player.pos.x = boat.x; m.player.pos.y = boat.y; m.player.pos.z = boat.z + 1.4;
    m.player.yaw = 180; m.player.pitch = 45;
    m.player.sneaking = true;
    m.useCooldown = 0;
    m.useItem();
    const menu = m.survival.activeMenu;
    const stack = menu?.slots?.[0]?.getItem();
    const out = {
      screen: m.screens.current?.constructor?.name,
      slots: menu?.slots?.length,
      containerSlots: boat.getContainerSize(),
      stored: stack?.isEmpty?.() ? null : [stack?.item?.name, stack?.getCount()],
    };
    m.screens.close(); m.survival.closeMenu();
    m.player.sneaking = false;
    boat.remove();
    return out;
  }, [bx, floorY, bz]);
  check('a chest boat opens its 27-slot inventory and keeps contents',
    chest.screen === 'ChestScreen' && chest.slots === 63 && chest.containerSlots === 27
    && chest.stored?.[0] === 'diamond' && chest.stored?.[1] === 5, chest);

  // -------------------------------------------------------------------------
  // 6. VehicleEntity damage: five bare-hand hits destroy a survival boat and
  //    drop it; a creative hit discards it without a drop.
  // -------------------------------------------------------------------------
  const damage = await ev(([x, y, z]) => {
    const m = window.__mc;
    m.options.gamemode = 'survival'; m.survival.gamemode = 'survival';
    const b = m.entityManager.spawn('oak_boat', x - 8.5, y, z + 0.5);
    m.player.flying = true;
    m.player.pos.x = b.x; m.player.pos.y = b.y; m.player.pos.z = b.z + 1.4;
    m.player.yaw = 180; m.player.pitch = 45;
    const before = m.entityManager.getEntities().filter((e) => e.constructor.name === 'ItemEntity').length;
    for (let i = 0; i < 5; i++) {
      m.attackCooldown = 0;
      m.attack();
    }
    // Drops are queued (Level.addFreshEntity); flush the queue before inspecting them.
    m.entityManager.flushSpawns();
    const items = m.entityManager.getEntities()
      .filter((e) => !e.isRemoved() && e.constructor.name === 'ItemEntity')
      .map((e) => e.item?.item?.name ?? e.item?.name ?? null);
    return { removed: b.isRemoved(), damage: b.damage, newItems: items.slice(before), items };
  }, [bx, floorY, bz]);
  check('five hits destroy a survival boat and drop the boat item',
    damage.removed === true && damage.newItems.includes('oak_boat'), damage);

  const creativeBreak = await ev(([x, y, z]) => {
    const m = window.__mc;
    m.options.gamemode = 'creative'; m.survival.gamemode = 'creative';
    m.entityManager.flushSpawns();
    for (const e of m.entityManager.getEntities()) if (e.constructor.name === 'ItemEntity') e.remove();
    const b = m.entityManager.spawn('oak_boat', x - 8.5, y, z + 2.5);
    m.player.flying = true;
    m.player.pos.x = b.x; m.player.pos.y = b.y; m.player.pos.z = b.z + 1.4;
    m.player.yaw = 180; m.player.pitch = 45;
    m.attackCooldown = 0;
    m.attack();
    m.entityManager.flushSpawns();
    const items = m.entityManager.getEntities()
      .filter((e) => !e.isRemoved() && e.constructor.name === 'ItemEntity').length;
    return { removed: b.isRemoved(), items };
  }, [bx, floorY, bz]);
  check('a creative hit discards the boat without a drop',
    creativeBreak.removed === true && creativeBreak.items === 0, creativeBreak);

  // -------------------------------------------------------------------------
  // 7. Renderer: fixed studio camera (stone platform + white wall). Two
  //    screenshots differ only by the boat, so the diff is the hull itself.
  // -------------------------------------------------------------------------
  const studio = await prepareStage(page, {
    x: bx, z: bz, radius: 12, floor: 'smooth_stone', backdrop: true,
    camera: { x: bx + 0.5, y: floorY + 1.8, z: bz + 4.5, yaw: 180, pitch: 25 },
    clip: { x: 300, y: 150, width: 500, height: 380 },
  });
  await sleep(2500);
  const before = await capture(page, studio.clip);
  savePng(before, 'shots/diag/boat-stage-before.png');

  await ev(([x, y, z]) => {
    const m = window.__mc;
    window.__renderBoat = m.entityManager.spawn('oak_boat', x + 0.5, y, z + 0.5);
    window.__renderBoat.yaw = 180;
    window.__renderBoat.yRotO = 180;
  }, [bx, floorY, bz]);
  await waitTicks(page, 4);
  const after = await capture(page, studio.clip);
  savePng(after, 'shots/diag/boat-stage-oak.png');
  const oakDiff = diffPng(before, after);
  check('the oak boat draws a stable silhouette against the studio back wall',
    oakDiff.changed > 400 && oakDiff.bbox
    && oakDiff.bbox.w > 50 && oakDiff.bbox.w < 460
    && oakDiff.bbox.h > 15 && oakDiff.bbox.h < 340
    && oakDiff.centroid.x > 150 && oakDiff.centroid.x < 350,
  oakDiff);

  // Chest boat is a different model + texture: a larger silhouette.
  await ev(() => { window.__renderBoat.remove(); });
  await ev(([x, y, z]) => {
    const m = window.__mc;
    window.__renderChestBoat = m.entityManager.spawn('oak_chest_boat', x + 0.5, y, z + 0.5);
    window.__renderChestBoat.yaw = 180;
    window.__renderChestBoat.yRotO = 180;
  }, [bx, floorY, bz]);
  await waitTicks(page, 4);
  const chestShot = await capture(page, studio.clip);
  savePng(chestShot, 'shots/diag/boat-stage-chest.png');
  const chestDiff = diffPng(before, chestShot);
  check('the chest boat draws a larger silhouette than the plain boat',
    chestDiff.changed > oakDiff.changed + 100, { oak: oakDiff.changed, chest: chestDiff.changed, bbox: chestDiff.bbox });

  // Paddles: with a rider and W held the rowing animation reshapes the boat
  // without moving it (move() is frozen for this visual check).
  const paddles = await ev(() => {
    const m = window.__mc;
    const b = window.__renderChestBoat;
    b.remove();
    const boat = m.entityManager.spawn('oak_boat', b.x, b.y, b.z);
    boat.yaw = 180; boat.yRotO = 180;
    const original = boat.move;
    boat.move = () => {};
    boat.rider = m.player;
    window.__paddleBoat = boat;
    window.__paddleRestore = () => { boat.move = original; boat.rider = null; boat.setInput(false, false, false, false); };
    return { y: boat.y };
  });
  await waitTicks(page, 2);
  const idlePaddleShot = await capture(page, studio.clip);
  await ev(() => { window.__paddleBoat.setInput(false, false, true, true); });
  await waitTicks(page, 4);
  const rowingPaddleShot = await capture(page, studio.clip);
  savePng(rowingPaddleShot, 'shots/diag/boat-stage-rowing.png');
  const rowDiff = diffPng(idlePaddleShot, rowingPaddleShot);
  const paddleState = await ev(() => ({
    left: window.__paddleBoat.getRowingTime(0, 0.5),
    right: window.__paddleBoat.getRowingTime(1, 0.5),
  }));
  check('the paddle animation visibly moves the paddles',
    paddleState.left > 0 && paddleState.right > 0
    && rowDiff.changed > 30 && (!rowDiff.bbox || rowDiff.bbox.w < 480),
  { paddleState, rowDiff });
  await ev(() => { window.__paddleRestore(); window.__paddleBoat.remove(); });

  await page.screenshot({ path: 'shots/diag/boat-final.png' });
} catch (err) {
  console.log('ERROR', err);
  results.push({ name: 'probe', ok: false });
} finally {
  console.log('');
  console.log(`Total: ${results.filter((x) => x.ok).length}/${results.length} PASS`);
  await browser.close();
  process.exit(results.every((x) => x.ok) ? 0 : 1);
}
