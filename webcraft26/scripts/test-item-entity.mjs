// Browser probe for dropped-item rendering (ItemEntityRenderer 26.2):
//   * spin = ItemEntity.getSpin(age, bobOffs) = age/20 + bobOffs radians;
//   * bob = sin(age/10 + bobOffs) * 0.1 + 0.1 + ITEM_MIN_HOVER_HEIGHT;
//   * a stacked item is submitted renderedAmount(count) times (1/2/3/4/5 copies).
//
//   node scripts/test-item-entity.mjs [--url http://127.0.0.1:5174]
import { chromium } from 'playwright';
import { launchOptions } from './lib/browser.mjs';
import { prepareStage, capture, diffPng, savePng, waitTicks } from './lib/stage.mjs';

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
  const stage = await prepareStage(page, {
    radius: 6, floor: 'stone', camera: { pitch: 12, yaw: 180 },
  });
  await ev((s) => {
    const m = window.__mc;
    m.entityManager.spawnInterval = 1e9;
    for (const e of m.entityManager.getEntities()) e.remove();
    window.__itemPos = { x: s.x + 0.5, y: s.floorY + 0.2, z: s.z };
  }, stage);

  await ev(async () => {
    const m = window.__mc;
    const mod = await import('/src/vanilla/world/item/ItemStack.ts');
    const stack = new mod.ItemStack(m.survival.registry.byName('grass_block'), 64);
    const p = window.__itemPos;
    m.dropItem(stack, p.x, p.y, p.z);
  });
  await waitTicks(page, 1);
  const itemState = await ev(() => {
    const m = window.__mc;
    const item = m.entityManager.getEntities().find((e) => e.getTypeName() === 'item');
    window.__item = item;
    return { spawned: !!item, count: item?.getItem().getCount() ?? 0 };
  });
  check('a stack of 64 dropped blocks spawns an item entity', itemState.spawned === true && itemState.count === 64, itemState);
  await waitTicks(page, 2);

  const spin = await ev(() => {
    const item = window.__item;
    const renderer = window.__mc.entityRenderer.renderers.get('item');
    return {
      age: item.age,
      bobOffs: item.bobOffs,
      spin: item.spin,
      expected: item.age / 20 + item.bobOffs,
      yOffset: renderer.getRenderYOffset(item, 0),
      expectedY: Math.sin(item.age / 10 + item.bobOffs) * 0.1 + 0.1 + 0.0625,
    };
  });
  check('spin and bob use ItemEntity.getSpin / ITEM_MIN_HOVER_HEIGHT',
    Math.abs(spin.spin - spin.expected) < 1e-6 && Math.abs(spin.yOffset - spin.expectedY) < 1e-6,
    spin);

  const copies = await ev(async () => {
    const m = window.__mc;
    const renderer = m.entityRenderer.renderers.get('item');
    const original = renderer.appendModel.bind(renderer);
    let calls = 0;
    renderer.appendModel = (...a) => { calls++; return original(...a); };
    const frame = () => new Promise((r) => requestAnimationFrame(() => r()));
    await frame();
    const start = calls;
    await frame();
    const perFrame = calls - start;
    renderer.appendModel = original;
    return { calls, perFrame };
  });
  check('a 64-stack submits 5 model copies per frame (renderedAmount)', copies.perFrame === 5, copies);

  const before = await capture(page, stage.clip);
  savePng(await page.screenshot(), 'shots/diag/item-entity-stack.png');
  await waitTicks(page, 10);
  const after = await capture(page, stage.clip);
  const diff = diffPng(before, after);
  check('the dropped item visibly spins/bobs over time', diff.changed > 40, diff);

  const single = await ev(async () => {
    const m = window.__mc;
    for (const e of m.entityManager.getEntities()) e.remove();
    const mod = await import('/src/vanilla/world/item/ItemStack.ts');
    const stack = new mod.ItemStack(m.survival.registry.byName('grass_block'), 1);
    const p = window.__itemPos;
    m.dropItem(stack, p.x, p.y, p.z);
    const frame = () => new Promise((r) => requestAnimationFrame(() => r()));
    await frame();
    await frame();
    const renderer = m.entityRenderer.renderers.get('item');
    const original = renderer.appendModel.bind(renderer);
    let calls = 0;
    renderer.appendModel = (...a) => { calls++; return original(...a); };
    await frame();
    const start = calls;
    await frame();
    const perFrame = calls - start;
    renderer.appendModel = original;
    return { perFrame };
  });
  check('a single item submits exactly one model copy per frame', single.perFrame === 1, single);

  check('no page errors', errors.length === 0, errors.slice(0, 2));
} finally {
  const failed = results.filter((r) => !r.ok).length;
  console.log(`\n${results.length - failed}/${results.length} checks passed`);
  await browser.close();
  if (failed > 0) process.exitCode = 1;
}
