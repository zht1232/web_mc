// Browser probe for container block-entity persistence.
//
// Chest/furnace/brewing contents used to live in a session cache, so a reload lost every stored
// stack and comparators read 0 until the container was reopened. This probe:
//   * fills a chest and a furnace, checks the comparator signal;
//   * saves the world, reloads it;
//   * verifies the comparator still reads the stored fill without opening the chest;
//   * verifies the chest and furnace contents come back when opened;
//   * breaks the chest and checks every stack drops and the record is cleared.
//
//   node scripts/test-container-persistence.mjs [--url http://127.0.0.1:5174]
import { chromium } from 'playwright';
import { launchOptions } from './lib/browser.mjs';
import { prepareStage, waitTicks } from './lib/stage.mjs';

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

  const setup = await ev(async (s) => {
    const m = window.__mc;
    const mod = await import('/src/vanilla/world/item/ItemStack.ts');
    const stack = (name, count) => new mod.ItemStack(m.survival.registry.byName(name), count);
    const x = s.x + 2, y = s.floorY, z = s.z;
    m.level.setBlockState(x, y, z, m.mc.stateOf('chest', { facing: 'north' }));
    m.level.setBlockState(x - 1, y, z, m.mc.stateOf('comparator', { facing: 'east', mode: 'compare', powered: 'false' }));
    m.level.setBlockState(x - 2, y, z, m.mc.stateOf('redstone_wire'));
    m.updateNeighbors(x - 1, y, z);
    m.openBlockContainer('chest', x, y, z);
    const chest = m.blockContainers.get(`chest@${x},${y},${z}`).container;
    chest.setItem(0, stack('diamond', 5));
    chest.setItem(1, stack('stone', 64));
    chest.setItem(2, stack('stone', 64));
    chest.setItem(3, stack('stone', 64));
    chest.setItem(26, stack('emerald', 3));

    const fx = x + 3;
    m.level.setBlockState(fx, y, z, m.mc.stateOf('furnace', { facing: 'north' }));
    m.openBlockContainer('furnace', fx, y, z);
    const furnace = m.blockContainers.get(`furnace@${fx},${y},${z}`).container;
    furnace.setItem(0, stack('raw_iron', 2));
    furnace.setItem(1, stack('dirt', 1));
    m.screens?.close?.();
    // Refresh the comparator after the items exist (it only re-reads on a scheduled update).
    m.updateNeighbors(x - 1, y, z);
    return { x, y, z, fx };
  }, stage);
  await waitTicks(page, 4);
  const signalBefore = await ev((p) => window.__mc.redstone.comparatorOutputAt(p.x - 1, p.y, p.z), setup);
  check('the filled chest drives its comparator before saving', signalBefore > 0, { signalBefore });

  const saved = await ev(async () => {
    const m = window.__mc;
    await m.autosave.flushNow('manual');
    return { worldId: m.saveManager.currentWorldId };
  });
  check('the world saved with a bound id', !!saved.worldId, saved);

  await boot(`${base}/?play&perf=0&world=${encodeURIComponent(saved.worldId)}`);
  await waitTicks(page, 4);
  await sleep(300);
  // The redstone network re-evaluates the restored source on the next neighbour update.
  await ev((p) => { window.__mc.updateNeighbors(p.x - 1, p.y, p.z); }, setup);
  await waitTicks(page, 4);

  const afterReload = await ev((p) => {
    const m = window.__mc;
    const chunk = m.level.getChunk(p.x >> 4, p.z >> 4);
    const rec = chunk?.getBlockEntity(p.x & 15, p.y, p.z & 15);
    return {
      signal: m.redstone.comparatorOutputAt(p.x - 1, p.y, p.z),
      record: rec ? { type: rec.type, slots: (rec.data.items ?? []).length } : null,
    };
  }, setup);
  check('the comparator reads the restored chest without opening it',
    afterReload.signal === signalBefore && afterReload.record?.slots === 5,
    { afterReload, before: signalBefore });

  const opened = await ev((p) => {
    const m = window.__mc;
    m.openBlockContainer('chest', p.x, p.y, p.z);
    const chest = m.blockContainers.get(`chest@${p.x},${p.y},${p.z}`).container;
    const items = [];
    for (let i = 0; i < chest.getContainerSize(); i++) {
      const st = chest.getItem(i);
      if (!st.isEmpty()) items.push({ slot: i, name: st.getItem()?.name, count: st.getCount() });
    }
    m.openBlockContainer('furnace', p.fx, p.y, p.z);
    const furnace = m.blockContainers.get(`furnace@${p.fx},${p.y},${p.z}`).container;
    const furnaceItems = [];
    for (let i = 0; i < furnace.getContainerSize(); i++) {
      const st = furnace.getItem(i);
      if (!st.isEmpty()) furnaceItems.push({ slot: i, name: st.getItem()?.name, count: st.getCount() });
    }
    m.screens?.close?.();
    return { items, furnaceItems };
  }, setup);
  check('the chest contents survive the reload',
    opened.items.length === 5 && opened.items[0].name === 'diamond' && opened.items[0].count === 5
    && opened.items.find((i) => i.slot === 26)?.name === 'emerald',
    opened.items);
  check('the furnace contents survive the reload',
    opened.furnaceItems.length === 2 && opened.furnaceItems[0].name === 'raw_iron'
    && opened.furnaceItems[0].count === 2 && opened.furnaceItems[1].name === 'dirt', opened.furnaceItems);

  // Breaking the chest drops every stored stack and clears the record.
  const broken = await ev((p) => {
    const m = window.__mc;
    const state = m.level.getBlockState(p.x, p.y, p.z);
    const key = `chest@${p.x},${p.y},${p.z}`;
    const menu = m.blockContainers.get(key);
    m.level.setBlockState(p.x, p.y, p.z, 0);
    m.breakEffects(state, p.x, p.y, p.z);
    m.updateNeighbors(p.x - 1, p.y, p.z);
    const chunk = m.level.getChunk(p.x >> 4, p.z >> 4);
    return {
      hadMenu: !!menu,
      record: chunk?.getBlockEntity(p.x & 15, p.y, p.z & 15) ?? null,
    };
  }, setup);
  await waitTicks(page, 2);
  const dropped = await ev(() => window.__mc.entityManager.getEntities()
    .filter((e) => e.getTypeName() === 'item')
    .map((e) => ({ name: e.getItem().item?.name ?? '', count: e.getItem().getCount() })));
  const dropCount = dropped.reduce((sum, i) => sum + i.count, 0);
  check('breaking the chest drops all stored stacks and clears the record',
    broken.record === null && dropCount === 5 + 64 * 3 + 3
    && dropped.some((i) => i.name === 'diamond' && i.count === 5),
    { hadMenu: broken.hadMenu, record: broken.record, dropCount, stacks: dropped.length });

  await waitTicks(page, 3);
  const signalOff = await ev((p) => window.__mc.redstone.comparatorOutputAt(p.x - 1, p.y, p.z), setup);
  check('the comparator falls back to 0 after the chest is broken', signalOff === 0, { signalOff });

  check('no page errors', errors.length === 0, errors.slice(0, 3));
} finally {
  const failed = results.filter((r) => !r.ok).length;
  console.log(`\n${results.length - failed}/${results.length} checks passed`);
  await browser.close();
  if (failed > 0) process.exitCode = 1;
}
