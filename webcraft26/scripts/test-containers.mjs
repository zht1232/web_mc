// Container interaction regression test (HANDOFF §8-4).
//
//   node scripts/test-containers.mjs [baseUrl]
//
// Drives the real right-click -> GUI path for the three vanilla containers:
//   crafting_table: right click opens CraftingScreen; 2 planks in a vertical column craft 4 sticks;
//   chest: items moved into the chest persist when the GUI is closed and reopened (session cache);
//   furnace: fuel + ingredient start smelting, progress advances while the GUI is open and the
//            result slot eventually receives the smelted item.
// Also checks the FurnaceScreen progress fields are driven by the live menu.
// Screenshots: shots/containers/.

import { chromium } from 'playwright';
import { launchOptions } from './lib/browser.mjs';
import { mkdirSync } from 'node:fs';

const base = (process.argv[2] ?? 'http://127.0.0.1:5174/').replace(/\/$/, '');
const outDir = 'shots/containers';
mkdirSync(outDir, { recursive: true });

let failures = 0;
const check = (name, ok, detail = '') => {
  if (!ok) failures++;
  console.log(`${ok ? 'PASS' : 'FAIL'}  ${name}  ${detail}`);
};

const browser = await chromium.launch(launchOptions());
const page = await browser.newPage({ viewport: { width: 1280, height: 720 }, deviceScaleFactor: 1 });
const errors = [];
page.on('pageerror', (err) => errors.push(`[pageerror] ${err.message}`));
page.on('console', (msg) => { if (msg.type() === 'error') errors.push(`[console] ${msg.text()}`); });
const ev = (fn, arg) => page.evaluate(fn, arg);
const sleep = (ms) => page.waitForTimeout(ms);

async function waitFor(name, fn, timeout = 120000) {
  const deadline = Date.now() + timeout;
  let last;
  while (Date.now() < deadline) {
    try { last = await ev(fn); if (last) return last; } catch { /* booting */ }
    await sleep(250);
  }
  throw new Error(`timeout waiting for ${name} (last=${JSON.stringify(last)})`);
}

/** Sets up a clean air pocket in front of the player and returns the block spot + helpers. */
async function setupScene() {
  await ev(() => {
    const m = window.__mc;
    const p = m.player;
    m.renderer.shadersEnabled = false; // keep the screenshots cheap and deterministic
    m.renderer.shaderQuality = 'low';
    m.level.time = 6000;
    m.options.gamemode = 'creative';
    p.flying = true;
    p.vel.x = 0; p.vel.y = 0; p.vel.z = 0;
    const bx = Math.floor(p.pos.x), by = Math.floor(p.pos.y), bz = Math.floor(p.pos.z);
    p.pos.x = bx + 0.5; p.pos.y = by; p.pos.z = bz + 0.5;
    p.yaw = 180; p.pitch = 2;
    const air = 0;
    for (let dx = -3; dx <= 3; dx++) {
      for (let dy = 0; dy <= 4; dy++) {
        for (let dz = -4; dz <= 2; dz++) m.level.setBlockState(bx + dx, by + dy, bz + dz, air);
      }
    }
    window.__spot = { x: bx, y: by + 1, z: bz - 2 };
  });
  for (let i = 0; i < 120; i++) {
    if (await ev(() => window.__mc.renderer.pendingRebuilds) === 0) break;
    await sleep(250);
  }
  await sleep(300);
}

const placeSpot = (block) => ev((b) => {
  const m = window.__mc;
  const s = window.__spot;
  m.level.setBlockState(s.x, s.y, s.z, m.mc.stateOf(b));
}, block);

/** Calls Game.useItem() with the crosshair on the spot block (returns the raycast target name). */
const rightClickSpot = () => ev(() => {
  const m = window.__mc;
  m.player.yaw = 180;
  m.player.pitch = 2;
  const hit = m.raycast(6);
  const target = hit ? m.mc.blockOf(m.level.getBlockState(hit.x, hit.y, hit.z)).name : null;
  m.useItem();
  return target;
});

const screenName = () => ev(() => {
  const s = window.__mc.screens.current;
  return s ? s.constructor.name : null;
});
const closeScreen = () => ev(() => { window.__mc.closeScreen(); });

try {
  await page.goto(`${base}/?play`, { waitUntil: 'domcontentloaded', timeout: 120000 });
  await sleep(400);
  await waitFor('__mc', () => !!window.__mc);
  await waitFor('world loaded', () => window.__mc.level && window.__mc.level.chunks.size > 250);
  await setupScene();

  // Give the items the three containers need.
  const gave = await ev(() => {
    const m = window.__mc;
    const host = m.commandHost();
    return {
      planks: host.give('oak_planks', 16),
      rawIron: host.give('raw_iron', 4),
      logs: host.give('oak_log', 8),
    };
  });
  check('items given', gave.planks && gave.rawIron && gave.logs, JSON.stringify(gave));
  await sleep(300);

  console.log('=== 1. crafting table: right click opens the GUI, 2 planks -> 4 sticks ===');
  await placeSpot('crafting_table');
  await sleep(500);
  const craftedTarget = await rightClickSpot();
  await sleep(400);
  check('right click targets the crafting table', craftedTarget === 'crafting_table', String(craftedTarget));
  check('CraftingScreen opened', (await screenName()) === 'CraftingScreen', String(await screenName()));
  const craftState = await ev(() => {
    const m = window.__mc;
    const menu = m.survival.activeMenu;
    const player = m.survival.asMenuPlayer();
    const invSlot = (name) => {
      for (let i = 0; i < 36; i++) {
        const stack = m.survival.inventory.getItem(i);
        const item = stack.getItem();
        if (item && (item.name === name || item.namespacedId.endsWith(':' + name))) return i;
      }
      return -1;
    };
    const menuSlotOf = (invIdx) => menu.slots.findIndex((s) => s.container === m.survival.inventory && s.slot === invIdx);
    const planksInv = invSlot('oak_planks');
    const planksMenu = menuSlotOf(planksInv);
    // pick the whole plank stack, then right-click one plank into grid slots 1 and 2 (vertical pair)
    menu.clicked(planksMenu, 0, 0, player);
    menu.clicked(1, 1, 0, player);   // grid (0,0)
    menu.clicked(4, 1, 0, player);   // grid (0,1): vertical pair -> sticks
    const result = menu.slots[0].getItem();
    return {
      slots: menu.slots.length,
      grid: [menu.slots[1].getItem().getCount(), menu.slots[4].getItem().getCount()],
      resultName: result.isEmpty() ? '' : result.getItem().name,
      resultCount: result.isEmpty() ? 0 : result.getCount(),
      carried: menu.getCarried().getCount(),
    };
  });
  await sleep(300);
  await page.screenshot({ path: `${outDir}/01-crafting.png` });
  check('crafting menu has 46 slots', craftState.slots === 46, `slots=${craftState.slots}`);
  check('two planks placed in the grid', craftState.grid[0] === 1 && craftState.grid[1] === 1, JSON.stringify(craftState.grid));
  check('result slot shows 4 sticks', craftState.resultName === 'stick' && craftState.resultCount === 4,
    `${craftState.resultName} x${craftState.resultCount}`);
  await closeScreen();
  await sleep(300);

  console.log('=== 2. chest: contents survive closing and reopening ===');
  await placeSpot('chest');
  await sleep(500);
  const chestTarget = await rightClickSpot();
  await sleep(400);
  check('right click targets the chest', chestTarget === 'chest', String(chestTarget));
  check('ChestScreen opened', (await screenName()) === 'ChestScreen', String(await screenName()));
  const chestPut = await ev(() => {
    const m = window.__mc;
    const menu = m.survival.activeMenu;
    const player = m.survival.asMenuPlayer();
    let invIdx = -1;
    for (let i = 0; i < 36; i++) {
      const it = m.survival.inventory.getItem(i).getItem();
      if (it && it.name === 'oak_planks') { invIdx = i; break; }
    }
    const menuSlot = menu.slots.findIndex((s) => s.container === m.survival.inventory && s.slot === invIdx);
    menu.clicked(menuSlot, 0, 0, player);   // pick up planks
    menu.clicked(0, 0, 0, player);          // put them into the first chest slot
    const inChest = menu.slots[0].getItem();
    return { slots: menu.slots.length, chestCount: inChest.isEmpty() ? 0 : inChest.getCount() };
  });
  await sleep(300);
  await page.screenshot({ path: `${outDir}/02-chest.png` });
  check('chest has 63 slots (27 + 36)', chestPut.slots === 63, `slots=${chestPut.slots}`);
  check('planks moved into the chest', chestPut.chestCount > 0, `count=${chestPut.chestCount}`);
  await closeScreen();
  await sleep(300);
  await rightClickSpot();
  await sleep(400);
  const reopened = await ev(() => {
    const m = window.__mc;
    const menu = m.survival.activeMenu;
    const stack = menu.slots[0].getItem();
    return {
      screen: m.screens.current ? m.screens.current.constructor.name : null,
      chestCount: stack.isEmpty() ? 0 : stack.getCount(),
    };
  });
  check('chest reopened with the same contents', reopened.screen === 'ChestScreen' && reopened.chestCount === chestPut.chestCount,
    JSON.stringify(reopened));
  await closeScreen();
  await sleep(300);

  console.log('=== 3. furnace: fuel + ingredient start smelting and the result appears ===');
  await placeSpot('furnace');
  await sleep(500);
  const furnaceTarget = await rightClickSpot();
  await sleep(400);
  check('right click targets the furnace', furnaceTarget === 'furnace', String(furnaceTarget));
  check('FurnaceScreen opened', (await screenName()) === 'FurnaceScreen', String(await screenName()));
  const load = await ev(() => {
    const m = window.__mc;
    const menu = m.survival.activeMenu;
    const player = m.survival.asMenuPlayer();
    const findInv = (name) => {
      for (let i = 0; i < 36; i++) {
        const it = m.survival.inventory.getItem(i).getItem();
        if (it && it.name === name) return i;
      }
      return -1;
    };
    const menuSlotOf = (invIdx) => menu.slots.findIndex((s) => s.container === m.survival.inventory && s.slot === invIdx);
    // ingredient -> slot 0, fuel -> slot 1
    menu.clicked(menuSlotOf(findInv('raw_iron')), 0, 0, player);
    menu.clicked(0, 0, 0, player);
    menu.clicked(menuSlotOf(findInv('oak_log')), 0, 0, player);
    menu.clicked(1, 0, 0, player);
    return {
      ingredient: menu.slots[0].getItem().isEmpty() ? '' : menu.slots[0].getItem().getItem().name,
      fuel: menu.slots[1].getItem().isEmpty() ? '' : menu.slots[1].getItem().getItem().name,
    };
  });
  check('furnace loaded with ingredient + fuel', load.ingredient === 'raw_iron' && load.fuel === 'oak_log',
    JSON.stringify(load));
  await sleep(1200);
  const litState = await ev(() => {
    const m = window.__mc;
    const menu = m.survival.activeMenu;
    const screen = m.screens.current;
    return {
      ctor: menu?.constructor?.name ?? null,
      isLit: typeof menu.isLit === 'function' ? menu.isLit() : null,
      burn: typeof menu.getBurnProgress === 'function' ? menu.getBurnProgress() : null,
      lit: typeof menu.getLitProgress === 'function' ? menu.getLitProgress() : null,
      screenBurn: screen?.burnProgress ?? null,
    };
  });
  await page.screenshot({ path: `${outDir}/03-furnace.png` });
  check('furnace menu is the live FurnaceMenu', litState.ctor === 'FurnaceMenu', String(litState.ctor));
  check('furnace is lit after fuelling', litState.isLit === true, JSON.stringify(litState));
  check('cooking progress advances', litState.burn > 0, `burn=${litState.burn}`);
  check('FurnaceScreen progress mirrors the menu', litState.screenBurn > 0, `screenBurn=${litState.screenBurn}`);
  // Wait for the 10s cook to finish and land in the result slot.
  let smelted = null;
  for (let i = 0; i < 40; i++) {
    smelted = await ev(() => {
      const m = window.__mc;
      const stack = m.survival.activeMenu.slots[2].getItem();
      return stack.isEmpty() ? '' : `${stack.getItem().name}x${stack.getCount()}`;
    });
    if (smelted) break;
    await sleep(400);
  }
  check('furnace produced an item in the result slot', smelted === 'iron_ingotx1' || smelted === 'iron_ingot', String(smelted));
  await closeScreen();
  await sleep(300);

  check('no page errors', errors.length === 0, errors.slice(0, 4).join(' | '));
  const glErr = await ev(() => window.__mc.gl.getError());
  check('no GL errors', glErr === 0, `glError=${glErr}`);
  console.log(`screenshots: ${outDir}/01-crafting.png, 02-chest.png, 03-furnace.png`);
} catch (err) {
  failures++;
  console.log('FAIL  exception:', err.message);
  try { await page.screenshot({ path: `${outDir}/99-failure.png` }); } catch { /* ignore */ }
}

console.log(`\n${failures === 0 ? 'ALL PASS' : `${failures} FAILURES`}`);
await browser.close();
process.exit(failures === 0 ? 0 : 1);
