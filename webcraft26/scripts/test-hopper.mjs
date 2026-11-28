// Browser probe for the hopper: five-slot GUI, 8-tick transfer, redstone lock,
// comparator output, block-entity persistence and break drops.
//
//   node scripts/test-hopper.mjs [--url http://127.0.0.1:5174]
import { chromium } from 'playwright';
import { launchOptions } from './lib/browser.mjs';
import { prepareStage, waitTicks, capture, savePng } from './lib/stage.mjs';

const args = process.argv.slice(2);
const urlArg = args.indexOf('--url');
const base = urlArg >= 0 ? args[urlArg + 1] : 'http://127.0.0.1:5174';

const browser = await chromium.launch(launchOptions());
const page = await (await browser.newContext({ viewport: { width: 1000, height: 700 } })).newPage();
const errors = [];
page.on('pageerror', (e) => errors.push(String(e).slice(0, 400)));
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const ev = (fn, arg) => page.evaluate(fn, arg);
const results = [];
const check = (name, ok, detail) => {
  results.push({ name, ok });
  console.log(`${ok ? 'PASS' : 'FAIL'} ${name}${detail === undefined ? '' : ' :: ' + JSON.stringify(detail)}`);
};

async function boot(url) {
  await page.goto(url, { waitUntil: 'domcontentloaded', timeout: 120000 });
  await page.waitForFunction(() => window.__mc?.running === true, null, { timeout: 120000 });
  await sleep(1000);
}

try {
  await boot(`${base}/?play&perf=0`);
  const stage = await prepareStage(page, { radius: 8, floor: 'stone' });

  // Hopper facing down between two chests; comparator on its west side reads it.
  const setup = await ev(async (s) => {
    const m = window.__mc;
    const mod = await import('/src/vanilla/world/item/ItemStack.ts');
    const stack = (name, count) => new mod.ItemStack(m.survival.registry.byName(name), count);
    const x = s.x + 2, y = s.floorY, z = s.z;
    m.level.setBlockState(x, y, z, m.mc.stateOf('hopper', { facing: 'down', enabled: 'true' }));
    m.level.setBlockState(x, y + 1, z, m.mc.stateOf('chest', { facing: 'north' }));
    m.level.setBlockState(x, y - 1, z, m.mc.stateOf('chest', { facing: 'north' }));
    m.level.setBlockState(x - 1, y, z,
      m.mc.stateOf('comparator', { facing: 'east', mode: 'compare', powered: 'false' }));
    m.updateNeighbors(x, y, z);
    m.updateNeighbors(x - 1, y, z);

    m.openBlockContainer('chest', x, y + 1, z);
    const source = m.blockContainers.get(`chest@${x},${y + 1},${z}`).container;
    source.setItem(0, stack('diamond', 10));
    m.screens?.close?.();
    m.survival?.closeMenu?.();
    // Keep the hopper powered while the GUI shot is taken so the counts stay stable.
    m.level.setBlockState(x, y, z + 1, m.mc.stateOf('redstone_block'));
    m.updateNeighbors(x, y, z);

    // Open the hopper through the normal right-click path to seed its live state.
    m.openBlockContainer('hopper', x, y, z);
    const menu = m.survival.activeMenu;
    const screen = m.screens?.current;
    const last = menu && menu.slots.length > 0 ? menu.slots[menu.slots.length - 1] : null;
    return {
      x, y, z,
      gui: {
        screen: screen?.constructor?.name ?? null,
        imageHeight: screen?.imageHeight ?? null,
        menuType: menu?.menuType ?? null,
        slots: menu?.slots?.length ?? 0,
        first: menu?.slots?.[0] ? { x: menu.slots[0].x, y: menu.slots[0].y } : null,
        last: last ? { x: last.x, y: last.y } : null,
        containerSlots: m.hoppers.get(`${x},${y},${z}`)?.container.getContainerSize() ?? 0,
      },
    };
  }, stage);
  await waitTicks(page, 1);
  savePng(await capture(page), 'shots/diag/hopper.png');
  check('the hopper opens the vanilla 5-slot GUI',
    setup.gui.screen === 'HopperScreen' && setup.gui.menuType === 'minecraft:hopper'
    && setup.gui.slots === 41 && setup.gui.containerSlots === 5, setup.gui);
  check('the GUI slots use the vanilla hopper layout',
    setup.gui.first?.x === 44 && setup.gui.first?.y === 20
    && setup.gui.last?.x === 152 && setup.gui.last?.y === 109,
    { first: setup.gui.first, last: setup.gui.last });

  await ev(() => { window.__mc.screens?.close?.(); window.__mc.survival?.closeMenu?.(); });

  // Placement parity: horizontal clicks point at the clicked block, vertical clicks point down.
  const placement = await ev(async (s) => {
    const m = window.__mc;
    const mod = await import('/src/client/interaction/Placement.ts');
    const x = s.x - 4, y = s.floorY, z = s.z;
    m.level.setBlockState(x, y, z, m.mc.stateOf('stone'));
    const base = {
      x, y, z, face: 5, hitX: x + 1, hitY: y + 0.5, hitZ: z + 0.5,
      yaw: 0, pitch: 0, heldBlockName: 'hopper',
      isUnobstructed: () => true,
      hasNeighborSignal: () => false,
    };
    const side = mod.placeBlock(m.mc, m.level, 'hopper', base);
    const x2 = x + 2;
    const top = mod.placeBlock(m.mc, m.level, 'hopper',
      { ...base, x: x2, y: y - 1, z, face: 1, hitX: x2 + 0.5, hitY: y - 1, hitZ: z + 0.5 });
    return {
      side: side ? m.mc.getProp(m.level.getBlockState(side.x, side.y, side.z), 'facing') : null,
      top: top ? m.mc.getProp(m.level.getBlockState(top.x, top.y, top.z), 'facing') : null,
    };
  }, stage);
  check('hopper placement follows HopperBlock.getStateForPlacement',
    placement.side === 'west' && placement.top === 'down', placement);

  const readTotals = () => ev((p) => {
    const m = window.__mc;
    const key = `${p.x},${p.y},${p.z}`;
    const count = (container) => {
      let n = 0;
      for (let i = 0; i < container.getContainerSize(); i++) n += container.getItem(i).getCount();
      return n;
    };
    const record = (x, y, z) => {
      const chunk = m.level.getChunk(x >> 4, z >> 4);
      const rec = chunk?.getBlockEntity(x & 15, y, z & 15);
      const items = Array.isArray(rec?.data?.items) ? rec.data.items : [];
      let n = 0;
      for (const raw of items) n += Number(raw?.count) || 0;
      return { n, type: rec?.type ?? null };
    };
    const source = m.blockContainers.get(`chest@${p.x},${p.y + 1},${p.z}`)?.container;
    const hopper = m.hoppers.get(key)?.container;
    return {
      source: source ? count(source) : record(p.x, p.y + 1, p.z).n,
      hopper: hopper ? count(hopper) : record(p.x, p.y, p.z).n,
      target: record(p.x, p.y - 1, p.z).n,
      signal: m.redstone.comparatorOutputAt(p.x - 1, p.y, p.z),
    };
  }, setup);

  const t0 = await readTotals();
  check('the source chest starts with ten diamonds',
    t0.source === 10 && t0.hopper === 0 && t0.target === 0, t0);
  await ev((p) => {
    const m = window.__mc;
    m.level.setBlockState(p.x, p.y, p.z + 1, 0);
    m.updateNeighbors(p.x, p.y, p.z);
  }, setup);
  await waitTicks(page, 4);

  await waitTicks(page, 17);
  const t1 = await readTotals();
  check('the hopper pulls from above and pushes into the chest below',
    t1.target > t0.target && t1.source + t1.hopper + t1.target === 10
    && t1.source < 10, { t0, t1 });

  await waitTicks(page, 32);
  const t2 = await readTotals();
  const moved = t2.target - t1.target;
  check('the transfer keeps the vanilla 8 tick cadence',
    moved >= 3 && moved <= 6 && t2.source + t2.hopper + t2.target === 10,
    { moved, t1, t2 });

  // Redstone lock: a powered hopper stops moving items but keeps its contents.
  const locked = await ev((p) => {
    const m = window.__mc;
    m.level.setBlockState(p.x, p.y, p.z + 1, m.mc.stateOf('redstone_block'));
    m.updateNeighbors(p.x, p.y, p.z);
    return true;
  }, setup);
  await waitTicks(page, 4);
  const lockState = await ev((p) => {
    const m = window.__mc;
    const state = m.level.getBlockState(p.x, p.y, p.z);
    return {
      enabled: m.mc.getProp(state, 'enabled'),
      signal: m.redstone.comparatorOutputAt(p.x - 1, p.y, p.z),
    };
  }, setup);
  const frozen = await readTotals();
  await waitTicks(page, 20);
  const frozenAfter = await readTotals();
  check('a powered hopper turns enabled=false and freezes transfers',
    locked && lockState.enabled === 'false'
    && frozen.source === frozenAfter.source && frozen.hopper === frozenAfter.hopper
    && frozen.target === frozenAfter.target, { lockState, frozen, frozenAfter });
  check('the comparator reads the hopper contents', lockState.signal >= 1, lockState);

  await ev((p) => {
    const m = window.__mc;
    m.level.setBlockState(p.x, p.y, p.z + 1, 0);
    m.updateNeighbors(p.x, p.y, p.z);
  }, setup);
  await waitTicks(page, 12);
  const resumed = await readTotals();
  check('removing the power resumes the transfer',
    resumed.target > frozenAfter.target || resumed.source < frozenAfter.source,
    { frozenAfter, resumed });

  // Empty the source; the hopper drains and the comparator falls back to 0.
  await ev((p) => {
    const m = window.__mc;
    const source = m.blockContainers.get(`chest@${p.x},${p.y + 1},${p.z}`)?.container;
    if (source) source.clearContent();
  }, setup);
  await waitTicks(page, 30);
  const drained = await readTotals();
  check('the emptied hopper reports a 0 comparator signal',
    drained.source === 0 && drained.hopper === 0 && drained.signal === 0,
    drained);

  // Persistence: freeze the hopper, plant three known items, save and reload.
  const prepared = await ev(async (p) => {
    const m = window.__mc;
    const mod = await import('/src/vanilla/world/item/ItemStack.ts');
    const stack = new mod.ItemStack(m.survival.registry.byName('diamond'), 3);
    m.level.setBlockState(p.x, p.y, p.z + 1, m.mc.stateOf('redstone_block'));
    m.updateNeighbors(p.x, p.y, p.z);
    m.hoppers.get(`${p.x},${p.y},${p.z}`).container.setItem(0, stack);
    // Vanilla updates the comparator on container change; nudge the redstone network here.
    m.updateNeighbors(p.x, p.y, p.z);
    return { hopper: 3 };
  }, setup);
  await waitTicks(page, 4);
  const beforeSave = await readTotals();
  const saved = await ev(async () => {
    const m = window.__mc;
    await m.autosave.flushNow('manual');
    return { worldId: m.saveManager.currentWorldId };
  });
  check('the world saved with a bound id', !!saved.worldId, { saved, prepared, beforeSave });

  await boot(`${base}/?play&perf=0&world=${encodeURIComponent(saved.worldId)}`);
  await waitTicks(page, 20);
  await ev((p) => window.__mc.updateNeighbors(p.x - 1, p.y, p.z), setup);
  await waitTicks(page, 4);

  const restored = await ev((p) => {
    const m = window.__mc;
    const key = `${p.x},${p.y},${p.z}`;
    const chunk = m.level.getChunk(p.x >> 4, p.z >> 4);
    const rec = chunk?.getBlockEntity(p.x & 15, p.y, p.z & 15);
    const state = m.level.getBlockState(p.x, p.y, p.z);
    const hopper = m.hoppers.get(key);
    let stored = 0;
    if (hopper) {
      for (let i = 0; i < hopper.container.getContainerSize(); i++) stored += hopper.container.getItem(i).getCount();
    }
    const recordItems = Array.isArray(rec?.data?.items) ? rec.data.items.length : 0;
    return {
      registered: !!hopper,
      stored,
      recordItems,
      facing: m.mc.getProp(state, 'facing'),
      enabled: m.mc.getProp(state, 'enabled'),
      signal: m.redstone.comparatorOutputAt(p.x - 1, p.y, p.z),
    };
  }, setup);
  check('the hopper contents and orientation survive a reload',
    restored.registered && restored.stored === beforeSave.hopper
    && restored.recordItems > 0 && restored.facing === 'down', { restored, beforeSave });
  check('the reloaded comparator reads the restored hopper',
    restored.signal === beforeSave.signal, { restored, beforeSave });

  // Break: the three stored diamonds drop and the record is cleared.
  const broken = await ev((p) => {
    const m = window.__mc;
    const key = `${p.x},${p.y},${p.z}`;
    const state = m.level.getBlockState(p.x, p.y, p.z);
    m.level.setBlockState(p.x, p.y, p.z, 0);
    m.breakEffects(state, p.x, p.y, p.z);
    m.updateNeighbors(p.x, p.y, p.z);
    const chunk = m.level.getChunk(p.x >> 4, p.z >> 4);
    return {
      state: !!m.hoppers.has(key),
      record: chunk?.getBlockEntity(p.x & 15, p.y, p.z & 15) ?? null,
    };
  }, setup);
  await waitTicks(page, 2);
  const dropped = await ev(() => window.__mc.entityManager.getEntities()
    .filter((e) => e.getTypeName() === 'item')
    .map((e) => ({ name: e.getItem().item?.name ?? '', count: e.getItem().getCount() })));
  const droppedDiamonds = dropped.filter((i) => i.name === 'diamond').reduce((n, i) => n + i.count, 0);
  check('breaking the hopper drops its contents and clears the record',
    broken.record === null && !broken.state && droppedDiamonds === beforeSave.hopper,
    { broken, droppedDiamonds, beforeSave });

  check('no page errors', errors.length === 0, errors.slice(0, 3));
} finally {
  const failed = results.filter((r) => !r.ok).length;
  console.log(`\n${results.length - failed}/${results.length} checks passed`);
  await browser.close();
  if (failed > 0) process.exitCode = 1;
}
