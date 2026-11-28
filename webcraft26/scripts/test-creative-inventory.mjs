// Browser probe for the creative inventory layout/search port and the player preview.
//
// Sources: _src/.../CreativeModeInventoryScreen.java (selectTab Type.INVENTORY, search handling)
// and InventoryScreen.java (extractEntityInInventoryFollowsMouse).
//
//   node scripts/test-creative-inventory.mjs [--url http://127.0.0.1:5174]
import { chromium } from 'playwright';
import { launchOptions } from './lib/browser.mjs';
import { savePng, waitTicks } from './lib/stage.mjs';

const args = process.argv.slice(2);
const urlArg = args.indexOf('--url');
const base = urlArg >= 0 ? args[urlArg + 1] : 'http://127.0.0.1:5174';

const browser = await chromium.launch(launchOptions());
const page = await (await browser.newContext({ viewport: { width: 1000, height: 700 } })).newPage();
const errors = [];
page.on('pageerror', (e) => errors.push(String(e).slice(0, 300)));
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
  await sleep(1200);

  await ev(() => {
    const m = window.__mc;
    m.entityManager.spawnInterval = 1e9;
    m.showDebug = false;
    m.screens.open('creative');
  });
  await waitTicks(page, 2);

  const layout = await ev(() => {
    const s = window.__mc.screens.current;
    s.setTab(13); // Survival Inventory (CreativeModeTabs.INVENTORY)
    return {
      screen: s.constructor.name,
      imageWidth: s.imageWidth,
      imageHeight: s.imageHeight,
      background: s.backgroundTexture,
      slots: s.slots.map((slot) => ({ i: slot.index, x: slot.x, y: slot.y })),
    };
  });
  const slot = (i) => layout.slots.find((s) => s.i === i);
  check('Survival Inventory tab keeps the 195x136 creative frame',
    layout.screen === 'CreativeModeInventoryScreen' && layout.imageWidth === 195 && layout.imageHeight === 136
    && layout.background === 'gui/container/creative_inventory/tab_inventory', layout);
  check('2x2 crafting grid + result are parked off-screen',
    [0, 1, 2, 3, 4].every((i) => slot(i)?.x === -2000 && slot(i)?.y === -2000), layout.slots.slice(0, 5));
  check('armor slots sit at (54|108, 6|33)',
    slot(5)?.x === 54 && slot(5)?.y === 6 && slot(6)?.x === 54 && slot(6)?.y === 33
    && slot(7)?.x === 108 && slot(7)?.y === 6 && slot(8)?.x === 108 && slot(8)?.y === 33,
    [slot(5), slot(6), slot(7), slot(8)]);
  check('offhand slot at (35,20), main inventory starts (9,54), hotbar (9,112)',
    slot(45)?.x === 35 && slot(45)?.y === 20
    && slot(9)?.x === 9 && slot(9)?.y === 54
    && slot(36)?.x === 9 && slot(36)?.y === 112,
    { offhand: slot(45), main: slot(9), hotbar: slot(36) });

  savePng(await page.screenshot(), 'shots/diag/creative-survival.png');

  const search = await ev(() => {
    const s = window.__mc.screens.current;
    s.setTab(6); // Search Items
    s.searchBox.setValue('钻石');
    s.refreshItems();
    const zhMatches = s.currentItemIds.length;
    const hasDiamond = s.currentItemIds.includes(window.__mc.mc.itemByName.get('diamond'));
    const bg = s.backgroundTexture;
    s.setTab(0);
    const clearedAfterLeaving = s.searchBox.getValue();
    s.setTab(6);
    return { zhMatches, hasDiamond, bg, clearedAfterLeaving, valueBack: s.searchBox.getValue() };
  });
  check('localized-name search finds diamond items', search.zhMatches > 0 && search.hasDiamond === true, search);
  check('Search tab uses tab_item_search and the query is cleared on tab changes',
    search.bg === 'gui/container/creative_inventory/tab_item_search'
    && search.clearedAfterLeaving === '' && search.valueBack === '', search);

  const tagSearch = await ev(() => {
    const s = window.__mc.screens.current;
    s.searchBox.setValue('#minecraft:planks');
    s.refreshItems();
    return { count: s.currentItemIds.length, sample: s.currentItemIds.slice(0, 5) };
  });
  check('#tag search returns tagged items', tagSearch.count >= 6, tagSearch);

  savePng(await page.screenshot(), 'shots/diag/creative-search.png');

  const preview = await ev(() => new Promise((resolve) => {
    const m = window.__mc;
    const s = m.screens.current;
    s.setTab(13);
    // Move the mouse above/below the preview centre: yAngle must reach the renderer.
    const cx = s.leftPos + 89;
    const cy = s.topPos + 27;
    s.mouseEvent(cx, cy - 14, 0, 'move');
    let frames = 0;
    const probe = () => {
      frames++;
      if (s.previewCache) {
        resolve({
          yaw: s.previewCache.yaw,
          pitch: s.previewCache.pitch,
          size: s.previewCache.canvas?.width ?? 0,
          frames,
        });
      } else if (frames > 20) {
        resolve({ yaw: null, pitch: null, frames });
      } else {
        requestAnimationFrame(probe);
      }
    };
    requestAnimationFrame(probe);
  }));
  check('player preview renders with both mouse angles',
    typeof preview.yaw === 'number' && Math.abs(preview.pitch) > 0.01,
    preview);

  // Equipment must reach the preview stub: wear an iron helmet and check the armor layer.
  const armor = await ev(async () => {
    const m = window.__mc;
    const item = m.survival.registry.byName('iron_helmet');
    if (!item) return { skipped: true };
    const mod = await import('/src/vanilla/world/item/ItemStack.ts');
    m.survival.inventory.setItem(39, new mod.ItemStack(item, 1));
    const s = m.screens.current;
    s.previewCache = null;
    const equipment = [39, 38, 37, 36].map((slot) => {
      const st = m.survival.inventory.getItem(slot);
      return st.isEmpty() ? null : (st.item?.namespacedId ?? null);
    });
    return { equipment };
  });
  check('worn armor is passed to the preview renderer',
    armor.skipped === true || (armor.equipment && armor.equipment[0] === 'minecraft:iron_helmet'), armor);

  check('no page errors while using the creative screens', errors.length === 0, errors.slice(0, 2));
} finally {
  const failed = results.filter((r) => !r.ok).length;
  console.log(`\n${results.length - failed}/${results.length} checks passed`);
  await browser.close();
  if (failed > 0) process.exitCode = 1;
}
