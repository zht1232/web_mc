// Browser regression test for the iron golem + villager breeding batch:
//
//   * carving the 4-iron-block + pumpkin pattern through the real right-click
//     placement path spawns a player-created iron golem and clears the blocks;
//   * the golem model is drawn (silhouette diff), the crackiness overlay
//     switches to the high-damage texture and the iron ingot repair heals;
//   * the golem hunts hostile mobs and ignores the (creative) player;
//   * villagers pick up dropped bread, two fed villagers breed, the baby uses
//     the dedicated baby mesh + baby textures and the vanilla baby hitbox;
//   * dropped food points / age survive the world save.
//
//   node scripts/test-golem-villager.mjs [--url http://127.0.0.1:5174]
import { chromium } from 'playwright';
import { launchOptions } from './lib/browser.mjs';
import { prepareStage, capture, diffPng, readPng, savePng, waitTicks } from './lib/stage.mjs';

/**
 * Pixel diff restricted to a rectangle, so the static floor's temporal
 * anti-aliasing shimmer (the scene renders with TAA) cannot drown the entity.
 */
function diffRegion(before, after, rect, threshold = 8) {
  const a = Buffer.isBuffer(before) ? readPng(before) : before;
  const b = Buffer.isBuffer(after) ? readPng(after) : after;
  let changed = 0;
  for (let y = rect.y; y < rect.y + rect.h; y++) {
    for (let x = rect.x; x < rect.x + rect.w; x++) {
      const i = (y * a.width + x) * 4;
      if (Math.abs(a.data[i] - b.data[i]) > threshold
        || Math.abs(a.data[i + 1] - b.data[i + 1]) > threshold
        || Math.abs(a.data[i + 2] - b.data[i + 2]) > threshold) changed++;
    }
  }
  return changed;
}

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

  const stage = await prepareStage(page, {
    radius: 12, floor: 'stone', backdrop: true,
    camera: { yaw: 180, pitch: 20 },
  });
  const { x: bx, z: bz, floorY } = stage;
  check('stage is built above the world', Number.isFinite(floorY) && floorY > 100, stage);

  await ev(() => { window.__mc.survival.gamemode = 'creative'; window.__mc.options.gamemode = 'creative'; });

  // -------------------------------------------------------------------------
  // 1. Real placement path: build the 4 iron blocks, aim at the middle block
  //    from above with a carved pumpkin selected and right-click.
  // -------------------------------------------------------------------------
  const px = bx - 5, pz = bz;
  const placed = await ev(([x, y, z]) => {
    const m = window.__mc;
    const iron = m.mc.stateOf('iron_block');
    m.level.setBlockState(x, y, z, iron);          // bottom centre
    m.level.setBlockState(x - 1, y + 1, z, iron);  // middle row
    m.level.setBlockState(x, y + 1, z, iron);
    m.level.setBlockState(x + 1, y + 1, z, iron);
    m.updateNeighbors(x, y + 1, z);
    // Give the player a carved pumpkin in the selected slot.
    const item = m.survival.registry.byName('carved_pumpkin');
    const stack = m.survival.inventory.getItem(0);
    stack.item = item; stack.count = 1;
    m.survival.inventory.setSelectedSlot(0);
    // Stand above the middle iron block, looking straight down.
    const p = m.player;
    p.flying = true;
    p.pos.x = x + 0.5; p.pos.y = y + 4; p.pos.z = z + 0.5;
    p.prevPos.x = p.pos.x; p.prevPos.y = p.pos.y; p.prevPos.z = p.pos.z;
    p.yaw = 0; p.pitch = 90;
    p.vel = new p.pos.constructor(0, 0, 0);
    m.useCooldown = 0;
    m.useItem();
    return {
      pumpkin: m.mc.blockOf(m.level.getBlockState(x, y + 2, z)).name,
      ironLeft: [m.level.getBlockState(x, y, z), m.level.getBlockState(x - 1, y + 1, z),
        m.level.getBlockState(x, y + 1, z), m.level.getBlockState(x + 1, y + 1, z)],
      golems: m.entityManager.getEntities().filter((e) => e.getTypeName() === 'iron_golem')
        .map((e) => ({ x: e.x, y: e.y, z: e.z, health: e.health, playerCreated: e.playerCreated })),
    };
  }, [px, floorY, pz]);
  check('the carved pumpkin placement path triggers the golem pattern',
    placed.golems.length === 1 && placed.ironLeft.every((s) => s === 0), placed);
  await waitTicks(page, 10);
  const golemState = await ev(() => {
    const m = window.__mc;
    const g = m.entityManager.getEntities().find((e) => e.getTypeName() === 'iron_golem');
    if (!g) return null;
    window.__golem = g;
    return {
      pos: [g.x, g.y, g.z], health: g.health, maxHealth: g.maxHealth,
      attackDamage: g.attackDamage, playerCreated: g.playerCreated,
    };
  });
  check('the pattern spawns exactly one iron golem',
    !!golemState && placed.golems.length === 1, placed.golems);
  check('the golem is player-created with 100 health',
    !!golemState && golemState.playerCreated === true
    && golemState.maxHealth === 100 && golemState.health === 100, golemState);
  check('the pattern blocks are cleared',
    placed.ironLeft.every((s) => s === 0), placed.ironLeft);

  // -------------------------------------------------------------------------
  // 2. Crackiness + repair.
  // -------------------------------------------------------------------------
  const crack = await ev(() => {
    const m = window.__mc;
    const g = window.__golem;
    g.health = 20;
    const layer = m.entityRenderer.renderers.get('iron_golem').getLayers(g);
    return { level: g.getCrackiness(), textures: layer.map((l) => l.texture) };
  });
  check('a 20% health golem reports high crackiness and binds the high texture',
    crack.level === 'high' && crack.textures.includes('iron_golem/iron_golem_crackiness_high'), crack);
  const repair = await ev(() => {
    const g = window.__golem;
    const before = g.health;
    const wrong = g.tryRepair('stick');
    const ok = g.tryRepair('iron_ingot');
    const afterOne = g.health;
    g.health = g.maxHealth;
    const full = g.tryRepair('iron_ingot');
    return { before, wrong, ok, afterOne, full };
  });
  check('an iron ingot repairs 25 health but not at full health',
    repair.wrong === false && repair.ok === true
    && Math.abs(repair.afterOne - repair.before - 25) < 1e-6 && repair.full === false, repair);

  // -------------------------------------------------------------------------
  // 3. The golem acquires and kills a hostile mob while ignoring the player.
  // -------------------------------------------------------------------------
  await ev(([x, y, z]) => {
    const m = window.__mc;
    const zed = m.entityManager.spawn('zombie', x + 4.5, y, z);
    zed.speed = 0; // hold still so the golem must do the work
    window.__zombie = zed;
    window.__golem.health = 100;
  }, [px, floorY, pz]);
  await waitTicks(page, 240);
  const combat = await ev(() => {
    const g = window.__golem;
    const z = window.__zombie;
    return {
      zombieAlive: z && !z.isRemoved() && !z.dead,
      zombieHealth: z ? z.health : null,
      golemTarget: g.getTarget()?.getTypeName() ?? null,
      golemHealth: g.health,
    };
  });
  check('the golem kills the hostile zombie it acquires',
    combat.zombieAlive === false || combat.zombieHealth <= 0,
    combat);
  check('the golem never targets the creative player',
    combat.golemTarget !== 'player', combat);
  check('the golem takes damage from the fight but survives',
    combat.golemHealth > 0, combat);

  // -------------------------------------------------------------------------
  // 4. Villagers: dropped bread is picked up, two fed villagers breed, the
  //    baby uses the baby mesh/texture and the vanilla baby dimensions.
  // -------------------------------------------------------------------------
  const villagers = await ev(([x, y, z]) => {
    const m = window.__mc;
    const spawn = (dx, dz) => {
      const v = m.entityManager.spawn('villager', x + dx, y, z + dz);
      v.profession = 'none';
      v.foodPoints = 0;
      v.setAge(0);
      return v;
    };
    // Pen the hungry villager so the dropped bread stays within reach.
    const hungry = spawn(-4.5, 4.5);
    const stone = m.mc.stateOf('stone');
    const hx = Math.floor(hungry.x), hz = Math.floor(hungry.z);
    for (let dy = 0; dy < 3; dy++) {
      for (let dx = -1; dx <= 1; dx++) {
        for (let dz = -1; dz <= 1; dz++) {
          if (dx === 0 && dz === 0) continue;
          m.level.setBlockState(hx + dx, y + dy, hz + dz, stone);
        }
      }
    }
    const bread = m.survival.registry.byName('bread');
    m.dropItem(new (m.survival.inventory.getItem(0).constructor)(bread, 3), hungry.x, y, hungry.z);
    const father = spawn(2.5, 2.5);
    const mother = spawn(2.5, 5.5);
    father.foodPoints = 12;
    mother.foodPoints = 12;
    window.__father = father;
    window.__mother = mother;
    window.__hungry = hungry;
    return { hungry: [hungry.x, hungry.y, hungry.z], father: [father.x, father.y, father.z] };
  }, [bx, floorY, bz]);
  check('three villagers were spawned', !!villagers.father, villagers);

  // Food pickup (10-tick scans).
  await waitTicks(page, 40);
  const fed = await ev(() => {
    const h = window.__hungry;
    const items = window.__mc.entityManager.getEntities()
      .filter((e) => e.getTypeName() === 'item' && Math.abs(e.x - h.x) < 3 && Math.abs(e.z - h.z) < 3);
    return { foodPoints: h.foodPoints, items: items.length };
  });
  check('the villager picks up the dropped bread (3 x 4 points)',
    fed.foodPoints === 12 && fed.items === 0, fed);

  // Breeding: the two fed villagers walk together and a baby appears.
  let baby = null;
  for (let i = 0; i < 20 && !baby; i++) {
    await waitTicks(page, 20);
    baby = await ev(() => {
      const m = window.__mc;
      const b = m.entityManager.getEntities()
        .find((e) => e.getTypeName() === 'villager' && e.age < 0 && !e.isRemoved());
      return b ? { x: b.x, y: b.y, z: b.z, age: b.age } : null;
    });
  }
  const bred = await ev(() => {
    const m = window.__mc;
    const b = m.entityManager.getEntities().find((e) => e.getTypeName() === 'villager' && e.age < 0);
    window.__baby = b;
    if (!b) return null;
    const renderer = m.entityRenderer.renderers.get('villager');
    const parentModel = renderer.getModel(window.__father);
    const babyModel = renderer.getModel(b);
    const layers = renderer.getLayers(b);
    return {
      fatherFood: window.__father.foodPoints, motherFood: window.__mother.foodPoints,
      fatherAge: window.__father.age, motherAge: window.__mother.age,
      type: b.villagerType, profession: b.profession,
      distinctModel: parentModel !== babyModel,
      texture: renderer.getTextureKey(b),
      layerTexture: layers[0]?.texture ?? null,
      width: b.getWidth(), height: b.getHeight(),
    };
  });
  check('two fed villagers breed a baby', !!bred, bred);
  check('both parents spend 12 food points and enter the breeding cooldown',
    !!bred && bred.fatherFood === 0 && bred.motherFood === 0
    && bred.fatherAge > 0 && bred.motherAge > 0, bred);
  check('the baby gets a villager type and no profession',
    !!bred && !!bred.type && bred.profession === 'none', bred);
  check('the baby uses the dedicated baby mesh and baby texture',
    !!bred && bred.distinctModel === true
    && bred.texture === 'villager/villager_baby'
    && (bred.layerTexture ?? '').startsWith('villager/baby/'), bred);
  check('the baby uses the vanilla 0.49 x 0.98 dimensions',
    !!bred && Math.abs(bred.width - 0.49) < 1e-6 && Math.abs(bred.height - 0.98) < 1e-6, bred);

  // -------------------------------------------------------------------------
  // 5. Render probe: golem silhouette + crack overlay diff, then the baby.
  // -------------------------------------------------------------------------
  // Portrait spot away from the villager pen; leftover loot is removed so the
  // two screenshots differ only by the entity under test.
  const sx = bx + 7, sz = bz - 6;
  await ev(() => {
    for (const e of window.__mc.entityManager.getEntities()) {
      if (e.getTypeName() === 'item') e.remove();
    }
  });
  // Freeze the golem so the two screenshots only differ by the crack layer.
  await ev(([x, y, z]) => {
    const m = window.__mc;
    const g = window.__golem;
    g.tick = function () {}; // no AI/walk animation while the probe renders
    g.health = g.maxHealth;
    // Park the golem off-camera first so an empty stage baseline exists.
    g.x = x - 30; g.y = y - 30; g.z = z - 30;
    g.xo = g.x; g.yo = g.y; g.zo = g.z;
    m.level.time = 6000;
    const p = m.player;
    p.flying = true;
    p.pos.x = x + 0.5; p.pos.y = y + 2.2; p.pos.z = z + 7;
    p.prevPos.x = p.pos.x; p.prevPos.y = p.pos.y; p.prevPos.z = p.pos.z;
    p.yaw = 180; p.pitch = 8;
    p.vel = new p.pos.constructor(0, 0, 0);
  }, [sx, floorY, sz]);
  await waitTicks(page, 2);
  const golemEmpty = await capture(page, stage.clip);
  await ev(([x, y, z]) => {
    const m = window.__mc;
    const g = window.__golem;
    g.x = x + 0.5; g.y = y; g.z = z + 0.5;
    g.xo = g.x; g.yo = g.y; g.zo = g.z;
    g.yaw = 200; g.yRotO = 200;
    // Re-apply the camera so residual player drift cannot shift the diff.
    m.level.time = 6000;
    const p = m.player;
    p.pos.x = x + 0.5; p.pos.y = y + 2.2; p.pos.z = z + 7;
    p.prevPos.x = p.pos.x; p.prevPos.y = p.pos.y; p.prevPos.z = p.pos.z;
    p.yaw = 180; p.pitch = 8;
    p.vel = new p.pos.constructor(0, 0, 0);
  }, [sx, floorY, sz]);
  await waitTicks(page, 2);
  const fullShot = await capture(page, stage.clip);
  await ev(() => { window.__mc.level.time = 6000; window.__golem.health = 20; });
  await waitTicks(page, 2);
  const crackShot = await capture(page, stage.clip);
  const golemDiff = diffPng(golemEmpty, fullShot);
  const crackDiff = diffPng(fullShot, crackShot);
  // The golem occupies the centre of the clip; ignore the floor's AA shimmer.
  const golemCore = { x: 100, y: 100, w: 220, h: 220 };
  const golemChanged = diffRegion(golemEmpty, fullShot, golemCore);
  const crackChanged = diffRegion(fullShot, crackShot, golemCore);
  savePng(fullShot, 'shots/diag/golem-full.png');
  savePng(crackShot, 'shots/diag/golem-cracked.png');
  check('the iron golem renders in the stage', golemChanged > 2500,
    { changed: golemChanged, frame: golemDiff });
  check('the crackiness overlay changes the golem pixels', crackChanged > 100,
    { changed: crackChanged, frame: crackDiff });

  // Baby villager portrait: move the parents away, keep the baby under the crosshair.
  await ev(([x, y, z]) => {
    const m = window.__mc;
    for (const v of [window.__father, window.__mother, window.__hungry, window.__baby]) {
      if (!v) continue;
      v.tick = function () {};
      v.x = x - 20; v.y = y - 20; v.z = z - 20;
      v.xo = v.x; v.yo = v.y; v.zo = v.z;
    }
    // Hide the golem so the portrait only contains the baby.
    const g = window.__golem;
    g.x = x - 20; g.y = y - 30; g.z = z - 20;
    g.xo = g.x; g.yo = g.y; g.zo = g.z;
    const p = m.player;
    p.pos.x = x + 0.5; p.pos.y = y + 1.8; p.pos.z = z + 6.5;
    p.prevPos.x = p.pos.x; p.prevPos.y = p.pos.y; p.prevPos.z = p.pos.z;
    p.yaw = 180; p.pitch = 18;
    p.vel = new p.pos.constructor(0, 0, 0);
  }, [sx, floorY, sz]);
  await waitTicks(page, 2);
  const babyEmpty = await capture(page, stage.clip);
  await ev(([x, y, z]) => {
    const m = window.__mc;
    const b = window.__baby;
    b.x = x + 0.5; b.y = y; b.z = z + 0.5;
    b.xo = b.x; b.yo = b.y; b.zo = b.z;
    b.yaw = 200; b.yRotO = 200;
    m.level.time = 6000;
    const p = m.player;
    p.pos.x = x + 0.5; p.pos.y = y + 1.8; p.pos.z = z + 6.5;
    p.prevPos.x = p.pos.x; p.prevPos.y = p.pos.y; p.prevPos.z = p.pos.z;
    p.yaw = 180; p.pitch = 18;
    p.vel = new p.pos.constructor(0, 0, 0);
  }, [sx, floorY, sz]);
  await waitTicks(page, 2);
  const babyShot = await capture(page, stage.clip);
  savePng(babyShot, 'shots/diag/villager-baby.png');
  const babyDiff = diffPng(babyEmpty, babyShot);
  const babyChanged = diffRegion(babyEmpty, babyShot, { x: 100, y: 60, w: 220, h: 240 });
  check('the baby villager renders with the baby mesh', babyChanged > 500,
    { changed: babyChanged, frame: babyDiff });

  // -------------------------------------------------------------------------
  // 6. Persistence: villager age + food points survive a save/reload.
  // -------------------------------------------------------------------------
  const saved = await ev(async () => {
    const m = window.__mc;
    const f = window.__father;
    delete f.tick; // restore normal ticking
    f.foodPoints = 9;
    f.setAge(-1200);
    f.x = m.player.pos.x + 2; f.y = m.player.pos.y; f.z = m.player.pos.z;
    await m.autosave.flushNow('manual');
    return { worldId: m.saveManager.currentWorldId, food: f.foodPoints, age: f.age };
  });
  check('the world saved', !!saved.worldId, saved);
  await page.goto(`${base}/?play&perf=0&world=${encodeURIComponent(saved.worldId)}`,
    { waitUntil: 'domcontentloaded', timeout: 120000 });
  await page.waitForFunction(() => window.__mc?.running === true, null, { timeout: 120000 });
  await waitTicks(page, 30);
  await sleep(600);
  const restored = await ev(() => {
    const m = window.__mc;
    const vs = m.entityManager.getEntities().filter((e) => e.getTypeName() === 'villager');
    return vs.map((v) => ({ food: v.foodPoints, age: v.age, baby: v.isBaby() }));
  });
  check('the villager food points and baby age reload',
    restored.some((v) => v.food === 9 && v.age < 0 && v.baby === true), restored);

  await page.screenshot({ path: 'shots/diag/golem-villager.png' });
} catch (err) {
  console.log('ERROR', err);
  results.push({ name: 'probe', ok: false });
} finally {
  console.log('');
  console.log(`Total: ${results.filter((x) => x.ok).length}/${results.length} PASS`);
  await browser.close();
  process.exit(results.every((x) => x.ok) ? 0 : 1);
}
