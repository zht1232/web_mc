// Behaviour probe for the P0 findings that cannot be proved by source alone:
//   1. a zero-count stack keeps its `item` reference (empty-stack zombie);
//   2. creative-grid drag leaves the stack on the cursor;
//   3. a creative player is still targeted by hostile mobs.
//
// This is an audit, not a pass/fail suite: known gaps are reported as GAP.
// Usage: node scripts/audit-behavior-p0.mjs
import fs from 'node:fs';
import path from 'node:path';
import { chromium } from 'playwright';
import { launchOptions } from './lib/browser.mjs';

const ROOT = process.cwd();
const OUT = path.join(ROOT, 'REPORTS', 'coverage');
const results = [];
const record = (id, title, status, detail) => {
  results.push({ id, title, status, detail });
  console.log(`${status.padEnd(5)} ${id}  ${title}  ${detail ?? ''}`);
};

const browser = await chromium.launch(launchOptions());
const page = await (await browser.newContext({ viewport: { width: 1280, height: 720 } })).newPage();
const errors = [];
page.on('pageerror', (e) => errors.push(String(e)));
await page.goto('http://127.0.0.1:5174/?play&perf=0', { waitUntil: 'load', timeout: 240000 });
await page.waitForFunction(() => !!window.__mc?.running, null, { timeout: 300000 });
await page.waitForTimeout(4000);

// ---- 1. zero-count stack ---------------------------------------------------
const empty = await page.evaluate(async () => {
  const mc = window.__mc;
  mc.options.gamemode = 'survival';
  mc.survival.gamemode = 'survival';
  const inv = mc.survival.inventory;
  mc.selectedSlot = 0;
  const stack = inv.getItem(0);
  if (!stack || stack.isEmpty()) return { skipped: true, reason: 'slot 0 empty' };
  stack.setCount(1);
  inv.removeFromSelected(false);
  await new Promise((r) => setTimeout(r, 400));
  return {
    skipped: false,
    count: stack.getCount(),
    isEmpty: stack.isEmpty(),
    itemStillSet: !!stack.item,
    itemName: stack.item?.name ?? null,
    handVisible: mc.handRenderer?.visibleItemId ?? null,
  };
});
if (empty.skipped) record('B-01', '空栈判定', 'SKIP', empty.reason);
else record('B-01', '空栈残留 item + 手部仍显示', empty.isEmpty && empty.itemStillSet ? 'GAP' : 'PASS',
  `count=${empty.count} isEmpty=${empty.isEmpty} item=${empty.itemStillSet} hand=${empty.handVisible}`);

// ---- 2. creative grid drag -------------------------------------------------
const drag = await page.evaluate(() => {
  const mc = window.__mc;
  mc.options.gamemode = 'creative';
  mc.survival.gamemode = 'creative';
  mc.openScreen('creative');
  const s = mc.screens.current;
  if (!s) return { error: 'no creative screen' };
  const left = s.leftPos;
  const top = s.topPos;
  const gridX = left + 9 + 8;
  const gridY = top + 18 + 8;
  const hotX = left + 9 + 8;
  const hotY = top + 112 + 8;
  s.mouseEvent(gridX, gridY, 0, 'down');
  const carriedAfterPick = s.menu.getCarried();
  s.mouseEvent(hotX, hotY, 0, 'up');
  const carriedAfterDrop = s.menu.getCarried();
  const hot = s.menu.getItem(45);
  mc.screens.close();
  return {
    afterPick: carriedAfterPick,
    afterDrop: carriedAfterDrop,
    hotbar: { itemId: hot.itemId, count: hot.count },
  };
});
if (drag.error) record('B-02', '创造格拖到热栏', 'ERROR', drag.error);
else record('B-02', '创造格拖到热栏后光标仍持有物品', drag.afterDrop ? 'GAP' : 'PASS',
  `pick=${JSON.stringify(drag.afterPick)} drop=${JSON.stringify(drag.afterDrop)} hotbar=${JSON.stringify(drag.hotbar)}`);

// ---- 3. creative targeting -------------------------------------------------
const ai = await page.evaluate(async () => {
  const mc = window.__mc;
  mc.options.gamemode = 'creative';
  mc.survival.gamemode = 'creative';
  mc.player.flying = false;
  const p = mc.player.pos;
  const okZombie = mc.commandHost().summon('zombie', p.x + 4, p.y, p.z);
  const okCreeper = mc.commandHost().summon('creeper', p.x - 4, p.y, p.z);
  const wait = (ms) => new Promise((r) => setTimeout(r, ms));
  await wait(2200);
  const find = (name) => mc.entityManager.getEntities().find((e) => e.getTypeName() === name && !e.isRemoved());
  const z = find('zombie');
  const c = find('creeper');
  return {
    okZombie, okCreeper,
    zombieTarget: z?.getTarget?.()?.getTypeName?.() ?? null,
    creeperTarget: c?.getTarget?.()?.getTypeName?.() ?? null,
    creeperSwell: c?.swell ?? null,
  };
});
record('B-03', '创造模式玩家仍是怪物目标', ai.zombieTarget || ai.creeperTarget ? 'GAP' : 'PASS',
  `zombie=${ai.zombieTarget} creeper=${ai.creeperTarget} swell=${ai.creeperSwell} spawned=${ai.okZombie}/${ai.okCreeper}`);

record('B-04', '页面错误', errors.length ? 'GAP' : 'PASS', errors[0] ?? 'none');

const json = { generatedAt: new Date().toISOString(), results };
fs.mkdirSync(OUT, { recursive: true });
fs.writeFileSync(path.join(OUT, 'behavior-p0.json'), JSON.stringify(json, null, 2) + '\n');
const md = `# P0 Behaviour Probe（浏览器实测）

> 生成时间：${json.generatedAt}
> 重新运行：\`node scripts/audit-behavior-p0.mjs\`（需要 dev server 在 5174）

| ID | 检查 | 状态 | 证据 |
|---|---|---|---|
${results.map((r) => `| ${r.id} | ${r.title} | **${r.status}** | ${r.detail ?? ''} |`).join('\n')}

\`GAP\` 表示 review 发现的问题在实机行为中复现，不是测试失败。
`;
fs.writeFileSync(path.join(OUT, 'behavior-p0.md'), md + '\n');

const gaps = results.filter((r) => r.status === 'GAP').length;
console.log(`\n${results.length} probes, ${gaps} gaps`);
await browser.close();
