// Browser regression test for data-driven advancements.
//
//   node scripts/test-advancements.mjs [--url http://127.0.0.1:5174]
import { chromium } from 'playwright';
import { launchOptions } from './lib/browser.mjs';

const args = process.argv.slice(2);
const urlArg = args.indexOf('--url');
const base = urlArg >= 0 ? args[urlArg + 1] : 'http://127.0.0.1:5174';

const browser = await chromium.launch(launchOptions());
const page = await (await browser.newContext({ viewport: { width: 1200, height: 800 } })).newPage();
page.on('pageerror', (e) => console.log('PAGEERR', String(e).slice(0, 400)));
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

  const loaded = await ev(() => {
    const m = window.__mc;
    m.options.gamemode = 'creative';
    m.survival.gamemode = 'creative';
    m.advancements.load({ done: [], criteria: {} });
    for (let i = 0; i < 36; i++) {
      const slot = m.survival.inventory.getItem(i);
      slot.item = null;
      slot.count = 0;
    }
    const stack = m.survival.getSelectedStack();
    stack.item = m.survival.registry.byName('crafting_table');
    stack.count = 1;
    return {
      roots: [...m.advancements.rootsList()],
      total: m.advancements.count().total,
      rootDone: m.advancements.isComplete('story/root'),
    };
  });
  check('advancement data loads five roots', loaded.roots.length === 5
    && loaded.roots.some((r) => r.startsWith('story/'))
    && loaded.roots.some((r) => r.startsWith('husbandry/')), loaded);
  check('visible advancement count is complete', loaded.total >= 110, loaded);
  check('story root starts unearned', loaded.rootDone === false, loaded);

  // Inventory trigger: crafting table earns story/root, cobblestone earns story/mine_stone.
  await sleep(900);
  const root = await ev(() => ({
    done: window.__mc.advancements.isComplete('story/root'),
    mine: window.__mc.advancements.isComplete('story/mine_stone'),
  }));
  check('inventory_changed earns story/root', root.done === true && root.mine === false, root);

  await ev(() => {
    const m = window.__mc;
    const stack = m.survival.getSelectedStack();
    stack.item = m.survival.registry.byName('cobblestone');
    stack.count = 1;
  });
  await sleep(900);
  const stone = await ev(() => ({
    mine: window.__mc.advancements.isComplete('story/mine_stone'),
    json: window.__mc.advancements.toJSON(),
  }));
  check('tag criteria earn story/mine_stone', stone.mine === true, stone.json.done);

  // The pause-menu screen opens with the tab list.
  await ev(() => window.__mc.screens.open('advancements'));
  await sleep(500);
  const screen = await ev(() => ({
    name: window.__mc.screens.current?.constructor?.name ?? null,
    open: window.__mc.screens.current !== null,
  }));
  check('AdvancementsScreen opens', screen.open && screen.name === 'AdvancementsScreen', screen);
  await page.screenshot({ path: 'shots/diag/advancements.png' });

  // Save/reload keeps completed advancements.
  const save = await ev(async () => {
    const m = window.__mc;
    m.screens.close();
    if (!m.autosave || !m.currentWorldId) return { ok: false };
    await m.autosave.flushNow('manual');
    return { ok: true, id: m.currentWorldId };
  });
  if (save.ok) {
    await page.goto(`${base}/?play&perf=0&world=${save.id}`, { waitUntil: 'domcontentloaded', timeout: 120000 });
    await page.waitForFunction(() => window.__mc?.running === true, null, { timeout: 120000 });
    await sleep(1200);
    const restored = await ev(() => ({
      root: window.__mc.advancements.isComplete('story/root'),
      mine: window.__mc.advancements.isComplete('story/mine_stone'),
      done: window.__mc.advancements.toJSON().done,
    }));
    check('advancement progress restores from the save', restored.root && restored.mine, restored);
  } else {
    check('world save available for advancement persistence', false, save);
  }
} catch (err) {
  console.log('ERROR', err);
  results.push({ name: 'probe', ok: false });
} finally {
  console.log('');
  console.log(`Total: ${results.filter((x) => x.ok).length}/${results.length} PASS`);
  await browser.close();
  process.exit(results.every((x) => x.ok) ? 0 : 1);
}
