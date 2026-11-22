// Browser regression test for wolf/cat taming, sitting and following.
//
//   node scripts/test-taming.mjs [--url http://127.0.0.1:5174]
import { chromium } from 'playwright';
import { launchOptions } from './lib/browser.mjs';

const args = process.argv.slice(2);
const urlArg = args.indexOf('--url');
const base = urlArg >= 0 ? args[urlArg + 1] : 'http://127.0.0.1:5174';

const browser = await chromium.launch(launchOptions());
const page = await (await browser.newContext({ viewport: { width: 1100, height: 700 } })).newPage();
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
  await sleep(900);

  const origin = await ev(() => {
    const m = window.__mc;
    m.options.gamemode = 'creative';
    m.survival.gamemode = 'creative';
    const p = m.player;
    p.flying = true;
    p.vel.x = p.vel.y = p.vel.z = 0;
    const bx = Math.floor(p.pos.x), by = Math.floor(p.pos.y), bz = Math.floor(p.pos.z);
    p.pos.x = bx + 0.5; p.pos.y = by; p.pos.z = bz + 0.5;
    p.yaw = 180; p.pitch = 25;
    for (let dx = -5; dx <= 10; dx++) {
      for (let dz = -10; dz <= 4; dz++) {
        m.level.setBlockState(bx + dx, by - 1, bz + dz,
          m.mc.stateOf(dx === 0 && dz === 0 ? 'stone' : 'grass_block'));
        for (let dy = 0; dy <= 5; dy++) m.level.setBlockState(bx + dx, by + dy, bz + dz, 0);
      }
    }
    const wolf = m.entityManager.spawn('wolf', bx + 0.5, by, bz - 1.4);
    window.__wolf = wolf;
    const stack = m.survival.getSelectedStack();
    stack.item = m.survival.registry.byName('bone');
    stack.count = 64;
    return { bx, by, bz };
  });
  const { bx, by, bz } = origin;
  await sleep(500);

  // 1. Right-click the wolf with bones until the 1/3 taming roll succeeds.
  let tamed = false;
  for (let i = 0; i < 30 && !tamed; i++) {
    await ev(([x, y, z]) => {
      const m = window.__mc;
      const w = window.__wolf;
      if (w) {
        w.setPos(x + 0.5, y, z - 1.4);
        w.vx = w.vy = w.vz = 0;
      }
      m.player.pos.x = x + 0.5; m.player.pos.y = y; m.player.pos.z = z + 0.5;
      m.player.yaw = 180; m.player.pitch = 25;
      m.useItem();
    }, [bx, by, bz]);
    await sleep(260);
    tamed = await ev(() => window.__wolf?.tamed === true);
  }
  let state = await ev(() => {
    const w = window.__wolf;
    return w ? {
      tamed: w.tamed, sitting: w.sitting, owner: w.owner,
      target: w.getTarget()?.getTypeName?.() ?? null, x: w.x, z: w.z,
    } : null;
  });
  check('bones tame the wolf', tamed && state?.tamed === true, state);
  check('tamed wolf has the owner and no player target', state?.owner === 'player'
    && state?.target !== 'player', state);

  // 2. An empty-hand click toggles sitting.
  await sleep(500);
  await ev(([x, y, z]) => {
    const m = window.__mc;
    const w = window.__wolf;
    w.setPos(x + 0.5, y, z - 1.4);
    w.vx = w.vy = w.vz = 0;
    m.player.pos.x = x + 0.5; m.player.pos.y = y; m.player.pos.z = z + 0.5;
    m.player.yaw = 180; m.player.pitch = 25;
    const stack = m.survival.getSelectedStack();
    stack.item = m.survival.registry.byName('stone');
    stack.count = 64;
    m.useItem();
  }, [bx, by, bz]);
  await sleep(600);
  state = await ev(() => ({ sitting: window.__wolf?.sitting }));
  check('empty click makes the wolf sit', state?.sitting === true, state);

  // 3. Stand up, walk away and let the follow goal close the distance.
  await sleep(500);
  await ev(([x, y, z]) => {
    const m = window.__mc;
    const w = window.__wolf;
    w.setPos(x + 0.5, y, z - 1.4);
    w.vx = w.vy = w.vz = 0;
    m.player.pos.x = x + 0.5; m.player.pos.y = y; m.player.pos.z = z + 0.5;
    m.player.yaw = 180; m.player.pitch = 25;
    m.useItem();
  }, [bx, by, bz]);
  await sleep(600);
  const sitOff = await ev(() => ({ sitting: window.__wolf?.sitting }));
  const before = await ev(([x, y, z]) => {
    const m = window.__mc;
    m.player.pos.x = x + 9.5; m.player.pos.z = z + 0.5;
    const w = window.__wolf;
    return { x: w.x, z: w.z, dist: Math.hypot(w.x - (x + 9.5), w.z - (z + 0.5)) };
  }, [bx, by, bz]);
  await sleep(2200);
  const after = await ev(([x, y, z]) => {
    const w = window.__wolf;
    return { sitting: w.sitting, x: w.x, z: w.z, dist: Math.hypot(w.x - (x + 9.5), w.z - (z + 0.5)) };
  }, [bx, by, bz]);
  check('click stands the wolf up', sitOff?.sitting === false, sitOff);
  check('tamed wolf follows the player', after?.dist < before.dist - 0.5, { before, after });

  // 4. Cat taming uses fish and starts sitting.
  const cat = await ev(([x, y, z]) => {
    const m = window.__mc;
    const c = m.entityManager.spawn('cat', x + 2.5, y, z - 1.4);
    window.__cat = c;
    const stack = m.survival.getSelectedStack();
    stack.item = m.survival.registry.byName('cod');
    stack.count = 64;
    return { ok: !!c };
  }, [bx, by, bz]);
  let catTamed = false;
  for (let i = 0; i < 30 && !catTamed; i++) {
    await ev(([x, y, z]) => {
      const m = window.__mc;
      const c = window.__cat;
      if (c) { c.setPos(x + 2.5, y, z - 1.4); c.vx = c.vy = c.vz = 0; }
      m.player.pos.x = x + 2.5; m.player.pos.y = y; m.player.pos.z = z + 0.5;
      m.player.yaw = 180; m.player.pitch = 25;
      m.useItem();
    }, [bx, by, bz]);
    await sleep(260);
    catTamed = await ev(() => window.__cat?.tamed === true);
  }
  const catState = await ev(() => window.__cat ? {
    tamed: window.__cat.tamed, sitting: window.__cat.sitting, owner: window.__cat.owner,
  } : null);
  check('cod tames the cat and it sits', catTamed && catState?.sitting === true
    && catState?.owner === 'player', catState);

  await page.screenshot({ path: 'shots/diag/taming.png' });
} catch (err) {
  console.log('ERROR', err);
  results.push({ name: 'probe', ok: false });
} finally {
  console.log('');
  console.log(`Total: ${results.filter((x) => x.ok).length}/${results.length} PASS`);
  await browser.close();
  process.exit(results.every((x) => x.ok) ? 0 : 1);
}
