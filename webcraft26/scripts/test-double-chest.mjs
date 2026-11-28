// Browser probe for double chests (54-slot inventory, persistence, comparator, drops).
//
// Two same-type/same-facing chests on the perpendicular axis open as one 6-row menu; the
// persisted halves keep slots 0..26 / 27..53, comparators read the combined fill before the
// chest is opened, and breaking either half drops the whole inventory.
//
//   node scripts/test-double-chest.mjs [--url http://127.0.0.1:5174]
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
  const stage = await prepareStage(page, { radius: 10, floor: 'stone' });

  const setup = await ev(async (s) => {
    const m = window.__mc;
    const mod = await import('/src/vanilla/world/item/ItemStack.ts');
    const stack = (name, count) => new mod.ItemStack(m.survival.registry.byName(name), count);
    const x = s.x + 2, y = s.floorY, z = s.z;
    const chest = m.mc.stateOf('chest', { facing: 'north' });
    m.level.setBlockState(x, y, z, chest);
    m.level.setBlockState(x + 1, y, z, chest);
    m.level.setBlockState(x - 1, y, z, m.mc.stateOf('comparator', { facing: 'east', mode: 'compare', powered: 'false' }));
    m.level.setBlockState(x - 2, y, z, m.mc.stateOf('redstone_wire'));
    m.updateNeighbors(x - 1, y, z);
    m.openBlockContainer('chest', x, y, z);
    const menu = m.blockContainers.get(`chest@${x},${y},${z}`);
    const c = menu.container;
    c.setItem(0, stack('diamond', 64));
    c.setItem(1, stack('stone', 64));
    c.setItem(26, stack('emerald', 64));
    c.setItem(27, stack('gold_ingot', 64));
    c.setItem(53, stack('redstone', 64));
    m.screens?.close?.();
    m.updateNeighbors(x - 1, y, z);
    return { x, y, z, size: c.getContainerSize() };
  }, stage);
  check('adjacent chests open as one 54-slot inventory', setup.size === 54, setup);
  await waitTicks(page, 4);
  const signalBefore = await ev((p) => window.__mc.redstone.comparatorOutputAt(p.x - 1, p.y, p.z), setup);
  check('the double chest drives its comparator', signalBefore > 0, { signalBefore });

  const saved = await ev(async () => {
    const m = window.__mc;
    await m.autosave.flushNow('manual');
    return { worldId: m.saveManager.currentWorldId };
  });
  check('the world saved with a bound id', !!saved.worldId, saved);

  await boot(`${base}/?play&perf=0&world=${encodeURIComponent(saved.worldId)}`);
  await waitTicks(page, 4);
  await sleep(300);
  await ev((p) => { window.__mc.updateNeighbors(p.x - 1, p.y, p.z); }, setup);
  await waitTicks(page, 4);

  const restored = await ev((p) => {
    const m = window.__mc;
    const halves = [p.x, p.x + 1].map((x) => {
      const chunk = m.level.getChunk(x >> 4, p.z >> 4);
      const rec = chunk?.getBlockEntity(x & 15, p.y, p.z & 15);
      return rec ? (rec.data.items ?? []).length : -1;
    });
    m.openBlockContainer('chest', p.x + 1, p.y, p.z);
    const menu = m.blockContainers.get(`chest@${p.x + 1},${p.y},${p.z}`);
    const c = menu.container;
    const items = [];
    for (let i = 0; i < c.getContainerSize(); i++) {
      const st = c.getItem(i);
      if (!st.isEmpty()) items.push({ slot: i, name: st.getItem()?.name, count: st.getCount() });
    }
    m.screens?.close?.();
    return {
      signal: m.redstone.comparatorOutputAt(p.x - 1, p.y, p.z),
      halves,
      size: c.getContainerSize(),
      items,
    };
  }, setup);
  check('both halves persisted and the comparator reads the combined fill',
    restored.signal === signalBefore && restored.halves[0] === 3 && restored.halves[1] === 2,
    { signal: restored.signal, before: signalBefore, halves: restored.halves });
  check('opening the other half restores all 54 slots',
    restored.size === 54 && restored.items.length === 5
    && restored.items.some((i) => i.slot === 53 && i.name === 'redstone')
    && restored.items.some((i) => i.slot === 27 && i.name === 'gold_ingot'),
    restored.items);

  const broken = await ev((p) => {
    const m = window.__mc;
    const state = m.level.getBlockState(p.x, p.y, p.z);
    m.level.setBlockState(p.x, p.y, p.z, 0);
    m.breakEffects(state, p.x, p.y, p.z);
    m.updateNeighbors(p.x - 1, p.y, p.z);
    const records = [p.x, p.x + 1].map((x) => {
      const chunk = m.level.getChunk(x >> 4, p.z >> 4);
      return chunk?.getBlockEntity(x & 15, p.y, p.z & 15) ?? null;
    });
    return { records };
  }, setup);
  await waitTicks(page, 2);
  const dropped = await ev(() => window.__mc.entityManager.getEntities()
    .filter((e) => e.getTypeName() === 'item')
    .map((e) => ({ name: e.getItem().item?.name ?? '', count: e.getItem().getCount() })));
  const dropCount = dropped.reduce((sum, i) => sum + i.count, 0);
  check('breaking one half drops the whole inventory and clears both records',
    broken.records[0] === null && broken.records[1] === null && dropCount === 64 * 5
    && dropped.some((i) => i.name === 'redstone' && i.count === 64),
    { records: broken.records, dropCount, stacks: dropped.length });

  await waitTicks(page, 2);
  const left = await ev((p) => {
    const m = window.__mc;
    m.openBlockContainer('chest', p.x + 1, p.y, p.z);
    const menu = m.blockContainers.get(`chest@${p.x + 1},${p.y},${p.z}`);
    const c = menu.container;
    let filled = 0;
    for (let i = 0; i < c.getContainerSize(); i++) if (!c.getItem(i).isEmpty()) filled++;
    m.screens?.close?.();
    return { size: c.getContainerSize(), filled };
  }, setup);
  check('the surviving chest is a single empty 27-slot chest', left.size === 27 && left.filled === 0, left);

  check('no page errors', errors.length === 0, errors.slice(0, 3));
} finally {
  const failed = results.filter((r) => !r.ok).length;
  console.log(`\n${results.length - failed}/${results.length} checks passed`);
  await browser.close();
  if (failed > 0) process.exitCode = 1;
}
