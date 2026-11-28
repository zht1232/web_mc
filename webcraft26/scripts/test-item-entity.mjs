// Browser probe for dropped-item rendering (ItemEntityRenderer 26.2):
//   * spin = ItemEntity.getSpin(age, bobOffs) = age/20 + bobOffs radians;
//   * bob = sin(age/10 + bobOffs) * 0.1 + 0.1 + ITEM_MIN_HOVER_HEIGHT;
//   * block stacks draw their real 3D block model (GROUND display transform),
//     while flat items keep the icon-sprite cluster path;
//   * a stacked item is submitted renderedAmount(count) times (1/2/3/4/5 copies):
//     3D models use the seeded +-0.15 xyz offsets, flat sprites the Z spread.
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

/** Spawns one dropped stack at the stage centre; other entities are removed first. */
const dropStack = (page, itemName, count) => page.evaluate(async ([name, n]) => {
  const m = window.__mc;
  for (const e of m.entityManager.getEntities()) e.remove();
  const mod = await import('/src/vanilla/world/item/ItemStack.ts');
  const stack = new mod.ItemStack(m.survival.registry.byName(name), n);
  const p = window.__itemPos;
  m.dropItem(stack, p.x, p.y, p.z);
}, [itemName, count]);

/** Per-frame counters for one renderer (restores the original method afterwards). */
const countAppends = (page) => page.evaluate(async () => {
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
  return { perFrame };
});

try {
  await page.goto(`${base}/?play&perf=0`, { waitUntil: 'domcontentloaded', timeout: 120000 });
  await page.waitForFunction(() => window.__mc?.running === true, null, { timeout: 120000 });
  await sleep(1200);
  const stage = await prepareStage(page, {
    radius: 6, floor: 'stone', camera: { pitch: 12, yaw: 180 },
    // Tight crop around the drop (screen centre-bottom): background/cloud motion must not
    // be able to satisfy the "visible" check.
    clip: { x: 430, y: 450, width: 260, height: 240 },
  });
  await ev((s) => {
    const m = window.__mc;
    m.entityManager.spawnInterval = 1e9;
    for (const e of m.entityManager.getEntities()) e.remove();
    window.__itemPos = { x: s.x + 0.5, y: s.floorY + 0.2, z: s.z };
  }, stage);
  // Let the arena chunks finish meshing before the reference frame.
  await waitTicks(page, 10);
  const empty = await capture(page, stage.clip);

  // ---- block items: 3D model pass ----------------------------------------
  await dropStack(page, 'grass_block', 64);
  await waitTicks(page, 2);
  const itemState = await ev(() => {
    const m = window.__mc;
    const item = m.entityManager.getEntities().find((e) => e.getTypeName() === 'item');
    const grass = m.survival.registry.byName('grass_block');
    const apple = m.survival.registry.byName('apple');
    return {
      spawned: !!item,
      count: item?.getItem().getCount() ?? 0,
      blockId: grass.id,
      appleId: apple.id,
      grassIsBlock: m.worldItemRenderer.isBlockItem(grass.id),
      appleIsBlock: m.worldItemRenderer.isBlockItem(apple.id),
    };
  });
  check('a stack of 64 dropped blocks spawns an item entity', itemState.spawned === true && itemState.count === 64, itemState);
  check('block items use the world item pass, flat items do not',
    itemState.grassIsBlock === true && itemState.appleIsBlock === false, itemState);

  const gpu = await ev((id) => {
    const gpu = window.__mc.worldItemRenderer.items.get(id);
    if (!gpu) return null;
    return {
      parts: gpu.parts.length,
      zSize: gpu.zSize,
      minY: gpu.minY,
      groundScale: gpu.parts[0].ground?.scale ?? null,
      groundTranslation: gpu.parts[0].ground?.translation ?? null,
    };
  }, itemState.blockId);
  check('grass_block bakes the full cube (item-space zSize 0.25, ground pose 0.25 / 3/16)',
    gpu !== null && Math.abs(gpu.zSize - 0.25) < 1e-6 && Math.abs(gpu.minY - 0.0625) < 1e-6
      && JSON.stringify(gpu.groundScale) === JSON.stringify([0.25, 0.25, 0.25])
      && JSON.stringify(gpu.groundTranslation) === JSON.stringify([0, 3, 0]),
    gpu);

  const worldCopies = await ev(() => {
    const m = window.__mc;
    return { items: m.worldItemRenderer.lastItemCount, copies: m.worldItemRenderer.lastCopyCount };
  });
  check('a 64-block stack draws 5 3D copies in the world pass',
    worldCopies.items === 1 && worldCopies.copies === 5, worldCopies);

  const blockSprite = await countAppends(page);
  check('the icon-sprite path emits no copy for block drops', blockSprite.perFrame === 0, blockSprite);

  const blockShot = await capture(page, stage.clip);
  savePng(await page.screenshot(), 'shots/diag/item-entity-block.png');
  const blockDiff = diffPng(empty, blockShot);
  check('the dropped block is visible on screen', blockDiff.changed > 200, blockDiff);

  await waitTicks(page, 10);
  const blockLater = await capture(page, stage.clip);
  const spinDiff = diffPng(blockShot, blockLater);
  check('the dropped block visibly spins/bobs over time', spinDiff.changed > 40, spinDiff);

  const single = await page.evaluate(async () => {
    const m = window.__mc;
    for (const e of m.entityManager.getEntities()) e.remove();
    const mod = await import('/src/vanilla/world/item/ItemStack.ts');
    const stack = new mod.ItemStack(m.survival.registry.byName('grass_block'), 1);
    const p = window.__itemPos;
    m.dropItem(stack, p.x, p.y, p.z);
    const frame = () => new Promise((r) => requestAnimationFrame(() => r()));
    await frame();
    await frame();
    return { items: m.worldItemRenderer.lastItemCount, copies: m.worldItemRenderer.lastCopyCount };
  });
  check('a single block submits exactly one 3D copy per frame',
    single.items === 1 && single.copies === 1, single);

  // ---- composite item models (beds: head + foot + per-layer transformation) --
  const bed = await page.evaluate(async () => {
    const m = window.__mc;
    for (const e of m.entityManager.getEntities()) e.remove();
    const mod = await import('/src/vanilla/world/item/ItemStack.ts');
    const stack = new mod.ItemStack(m.survival.registry.byName('white_bed'), 2);
    const p = window.__itemPos;
    m.dropItem(stack, p.x, p.y, p.z);
    const frame = () => new Promise((r) => requestAnimationFrame(() => r()));
    await frame(); await frame();
    const gpu = m.worldItemRenderer.items.get(stack.item.id);
    return {
      isBlock: m.worldItemRenderer.isBlockItem(stack.item.id),
      parts: gpu?.parts.length ?? 0,
      zSize: gpu?.zSize ?? 0,
      localFoot: !!gpu?.parts[gpu.parts.length - 1].local,
      copies: m.worldItemRenderer.lastCopyCount,
    };
  });
  check('composite beds draw both layers with the foot transformation',
    bed.isBlock === true && bed.parts === 2 && bed.localFoot === true
      && Math.abs(bed.zSize - 0.5) < 1e-6 && bed.copies === 2,
    bed);

  // ---- flat items: sprite cluster path ------------------------------------
  await dropStack(page, 'apple', 64);
  await waitTicks(page, 2);
  const flatSprite = await countAppends(page);
  check('a 64 flat-item stack submits 5 icon sprites per frame', flatSprite.perFrame === 5, flatSprite);

  const flatWorld = await ev(() => window.__mc.worldItemRenderer.lastItemCount);
  check('flat-item stacks do not enter the 3D world pass', flatWorld === 0, { lastItemCount: flatWorld });

  const spin = await ev(() => {
    const item = window.__mc.entityManager.getEntities().find((e) => e.getTypeName() === 'item');
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

  check('no page errors', errors.length === 0, errors.slice(0, 2));
} finally {
  const failed = results.filter((r) => !r.ok).length;
  console.log(`\n${results.length - failed}/${results.length} checks passed`);
  await browser.close();
  if (failed > 0) process.exitCode = 1;
}
