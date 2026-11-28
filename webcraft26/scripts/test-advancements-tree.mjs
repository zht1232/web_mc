// Browser regression test for the vanilla advancement tree:
//
//   * AdvancementManager.layout builds a per-root tree (depth columns, leaf rows,
//     parents centred on their children);
//   * the advancements screen renders the tree inside the 252x140 panel, with
//     root tabs and a draggable/scrollable viewport;
//   * switching root tabs rebuilds the layout from that root.
//
//   node scripts/test-advancements-tree.mjs [--url http://127.0.0.1:5174]
import { chromium } from 'playwright';
import { launchOptions } from './lib/browser.mjs';
import { prepareStage } from './lib/stage.mjs';

const args = process.argv.slice(2);
const urlArg = args.indexOf('--url');
const base = urlArg >= 0 ? args[urlArg + 1] : 'http://127.0.0.1:5174';

const browser = await chromium.launch(launchOptions());
const page = await (await browser.newContext({ viewport: { width: 1000, height: 700 } })).newPage();
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
  await sleep(1000);
  await prepareStage(page, { radius: 8, floor: 'stone' });

  // -------------------------------------------------------------------------
  // 1. Layout: per-root tree with finite coordinates and parent centring.
  // -------------------------------------------------------------------------
  const layout = await ev(() => {
    const m = window.__mc;
    const manager = m.advancements;
    const roots = manager.rootsList();
    const tree = manager.layout('story/root');
    const byId = new Map(tree.nodes.map((n) => [n.id, n]));
    const root = byId.get('story/root') ?? tree.nodes.find((n) => n.depth === 0);
    let centred = 0;
    let checked = 0;
    for (const node of tree.nodes) {
      const parent = node.parent ? byId.get(node.parent) : null;
      if (!parent) continue;
      const siblings = tree.nodes.filter((n) => n.parent === parent.id);
      if (siblings.length > 1) {
        const ys = siblings.map((n) => n.row);
        const mid = (Math.min(...ys) + Math.max(...ys)) / 2;
        checked++;
        if (Math.abs(parent.row - mid) < 1e-6) centred++;
      }
    }
    return {
      roots,
      nodes: tree.nodes.length,
      maxDepth: tree.maxDepth,
      maxRow: tree.maxRow,
      root: root ? { id: root.id, depth: root.depth, row: root.row } : null,
      finite: tree.nodes.every((n) => Number.isFinite(n.row) && Number.isFinite(n.depth)),
      negativeRows: tree.nodes.filter((n) => n.row < 0).length,
      centred,
      checked,
      done: tree.nodes.filter((n) => n.done).length,
    };
  });
  check('the manager exposes the five vanilla root tabs',
    layout.roots.length === 5 && layout.roots.includes('story/root'), layout.roots);
  check('the story tree lays out with depth columns and finite rows',
    layout.nodes > 8 && layout.maxDepth >= 3 && layout.maxRow >= 3
    && layout.finite && layout.negativeRows === 0, layout);
  check('the root node sits at depth 0',
    layout.root !== null && layout.root.depth === 0 && layout.root.row >= 0, layout.root);
  check('parents are centred on their children',
    layout.checked === 0 || layout.centred === layout.checked, { centred: layout.centred, checked: layout.checked });

  // -------------------------------------------------------------------------
  // 2. Screen: tree panel, tabs, drag pan and wheel pan.
  // -------------------------------------------------------------------------
  const opened = await ev(() => {
    const m = window.__mc;
    m.screens.open('advancements');
    const s = m.screens.current;
    return {
      screen: s?.constructor?.name ?? null,
      panel: s?.panel ?? null,
      tabCount: s?.children?.filter?.((c) => c.constructor?.name === 'Button').length ?? 0,
      nodes: s?.layout?.nodes?.length ?? 0,
      title: s?.getTitle?.() ?? null,
    };
  });
  check('the advancements screen opens with the tree layout',
    opened.screen === 'AdvancementsScreen' && opened.nodes > 8
    && opened.panel.w >= 200 && opened.panel.h >= 100 && opened.tabCount >= 6, opened);

  const panned = await ev(() => {
    const s = window.__mc.screens.current;
    const cx = s.panel.x + Math.floor(s.panel.w / 2);
    const cy = s.panel.y + Math.floor(s.panel.h / 2);
    const before = { x: s.panX, y: s.panY };
    s.mouseEvent(cx, cy, 0, 'down');
    s.mouseEvent(cx, cy - 70, 0, 'move');
    s.mouseEvent(cx, cy - 70, 0, 'up');
    const after = { x: s.panX, y: s.panY };
    s.mouseEvent(cx, cy, 0, 'wheel', 1);
    const wheeled = { x: s.panX, y: s.panY };
    return { before, after, wheeled, panning: s.panning };
  });
  check('dragging the tree pans the viewport and clamps it',
    panned.after.y < panned.before.y && panned.after.y >= -1000 && panned.panning === false, panned);
  check('the wheel pans the tree', panned.wheeled.y !== panned.after.y, panned);

  // -------------------------------------------------------------------------
  // 3. Root tab switch rebuilds the layout.
  // -------------------------------------------------------------------------
  const switched = await ev(() => {
    const s = window.__mc.screens.current;
    const first = s.layout.nodes.map((n) => n.id);
    s.tab = 1;
    s.refresh();
    const second = s.layout.nodes.map((n) => n.id);
    return {
      tab: s.tab,
      firstCount: first.length,
      secondCount: second.length,
      changed: second.length > 0 && second[0] !== first[0],
      pan: { x: s.panX, y: s.panY },
    };
  });
  check('switching the root tab rebuilds the tree and resets the pan',
    switched.changed && switched.pan.x === 0 && switched.pan.y === 0, switched);

  await ev(() => { const s = window.__mc.screens.current; s.tab = 0; s.refresh(); });
  await sleep(300);
  await page.screenshot({ path: 'shots/diag/advancements-tree.png' });
} catch (err) {
  console.log('ERROR', err);
  results.push({ name: 'probe', ok: false });
} finally {
  console.log('');
  console.log(`Total: ${results.filter((x) => x.ok).length}/${results.length} PASS`);
  await browser.close();
  process.exit(results.every((x) => x.ok) ? 0 : 1);
}
