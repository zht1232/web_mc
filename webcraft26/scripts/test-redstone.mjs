// Browser regression test for the redstone long tail and the Rust-ported piston resolver.
//
//   node scripts/test-redstone.mjs [--url http://127.0.0.1:5174]
//
// Boots the real game, builds a flat test platform next to the player and drives the blocks
// through their public behaviour (updateNeighbors/redstone.tick/use), asserting block states.
// Covers: comparator analog input/subtract, observer pulse, daylight detector, tripwire,
// torch burnout, piston push/pull/12-block limit, slime branching and powered rails.
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
  await sleep(1000);

  const origin = await ev(() => {
    const m = window.__mc;
    m.options.gamemode = 'creative';
    m.survival.gamemode = 'creative';
    m.level.time = 6000;
    const p = m.player;
    p.flying = true;
    p.vel.x = p.vel.y = p.vel.z = 0;
    const bx = Math.floor(p.pos.x), by = Math.floor(p.pos.y), bz = Math.floor(p.pos.z);
    p.pos.x = bx + 0.5; p.pos.y = by; p.pos.z = bz + 0.5;
    for (let dx = -4; dx <= 18; dx++) {
      for (let dz = -13; dz <= 3; dz++) {
        m.level.setBlockState(bx + dx, by - 1, bz + dz, m.mc.stateOf('stone'));
        for (let dy = 0; dy <= 5; dy++) m.level.setBlockState(bx + dx, by + dy, bz + dz, 0);
      }
    }
    window.__h = {
      S: (x, y, z) => window.__mc.level.getBlockState(x, y, z),
      N: (x, y, z) => window.__mc.mc.blockOf(window.__mc.level.getBlockState(x, y, z)).name,
      P: (x, y, z, k) => window.__mc.mc.getProp(window.__mc.level.getBlockState(x, y, z), k),
      set: (x, y, z, b, props) => {
        const m = window.__mc;
        m.level.setBlockState(x, y, z, m.mc.stateOf(b, props));
        m.updateNeighbors(x, y, z);
      },
      air: (x, y, z) => {
        const m = window.__mc;
        m.level.setBlockState(x, y, z, 0);
        m.updateNeighbors(x, y, z);
      },
    };
    return { bx, by, bz };
  });
  const { bx, by, bz } = origin;
  await sleep(600);

  // ---------------------------------------------------------------- comparator
  await ev(([x, y, z]) => {
    const m = window.__mc;
    const h = window.__h;
    h.set(x + 1, y, z, 'chest');
    h.set(x + 2, y, z, 'comparator', { facing: 'west', mode: 'compare', powered: 'false' });
    h.set(x + 3, y, z, 'redstone_wire');
    h.set(x + 4, y, z, 'redstone_lamp');
    const menu = m.survival.openChest(3);
    const stack = m.survival.inventory.getItem(0).copy();
    stack.setCount(64);
    menu.container.setItem(0, stack);
    m.blockContainers.set(`chest@${x + 1},${y},${z}`, menu);
    m.updateNeighbors(x + 1, y, z);
  }, [bx, by, bz - 2]);
  await sleep(400);
  let r = await ev(([x, y, z]) => ({
    output: window.__mc.redstone.comparatorOutputAt(x + 2, y, z),
    powered: window.__h.P(x + 2, y, z, 'powered'),
    wire: window.__h.P(x + 3, y, z, 'power'),
    lamp: window.__h.P(x + 4, y, z, 'lit'),
  }), [bx, by, bz - 2]);
  check('comparator 1/27 -> 1, wire 1, lamp lit', r.output === 1 && r.powered === 'true'
    && r.wire === '1' && r.lamp === 'true', r);

  await ev(([x, y, z]) => {
    const m = window.__mc;
    const menu = m.blockContainers.get(`chest@${x + 1},${y},${z}`);
    const stack = m.survival.inventory.getItem(0).copy();
    stack.setCount(64);
    for (let i = 0; i < 14; i++) menu.container.setItem(i, stack.copy());
    m.updateNeighbors(x + 1, y, z);
  }, [bx, by, bz - 2]);
  await sleep(400);
  r = await ev(([x, y, z]) => ({
    output: window.__mc.redstone.comparatorOutputAt(x + 2, y, z),
    wire: window.__h.P(x + 3, y, z, 'power'),
  }), [bx, by, bz - 2]);
  check('comparator 14/27 -> 8', r.output === 8 && r.wire === '8', r);

  await ev(([x, y, z]) => {
    const m = window.__mc;
    const menu = m.blockContainers.get(`chest@${x + 1},${y},${z}`);
    const stack = m.survival.inventory.getItem(0).copy();
    stack.setCount(64);
    for (let i = 0; i < 27; i++) menu.container.setItem(i, stack.copy());
    m.updateNeighbors(x + 1, y, z);
  }, [bx, by, bz - 2]);
  await sleep(400);
  r = await ev(([x, y, z]) => ({
    output: window.__mc.redstone.comparatorOutputAt(x + 2, y, z),
    wire: window.__h.P(x + 3, y, z, 'power'),
  }), [bx, by, bz - 2]);
  check('comparator 27/27 -> 15', r.output === 15 && r.wire === '15', r);

  await ev(([x, y, z]) => {
    window.__h.set(x + 2, y, z - 1, 'redstone_block');
    window.__mc.redstone.use(x + 2, y, z);
  }, [bx, by, bz - 2]);
  await sleep(500);
  r = await ev(([x, y, z]) => ({
    mode: window.__h.P(x + 2, y, z, 'mode'),
    output: window.__mc.redstone.comparatorOutputAt(x + 2, y, z),
    powered: window.__h.P(x + 2, y, z, 'powered'),
    wire: window.__h.P(x + 3, y, z, 'power'),
  }), [bx, by, bz - 2]);
  check('comparator subtract 15-15 -> 0', r.mode === 'subtract' && r.output === 0
    && r.powered === 'false' && r.wire === '0', r);

  // ---------------------------------------------------------------- observer
  await ev(([x, y, z]) => {
    const h = window.__h;
    h.air(x + 2, y, z - 1);
    h.set(x + 2, y, z, 'comparator', { facing: 'west', mode: 'compare', powered: 'false' });
    h.set(x + 7, y, z, 'observer', { facing: 'north', powered: 'false' });
    h.set(x + 7, y, z + 1, 'redstone_lamp');
    h.set(x + 7, y, z - 1, 'stone');
  }, [bx, by, bz - 2]);
  let pulse = false;
  let pulseLamp = false;
  let pulseOff = false;
  for (let i = 0; i < 30; i++) {
    await sleep(50);
    const o = await ev(([x, y, z]) => ({
      powered: window.__h.P(x + 7, y, z, 'powered'),
      lamp: window.__h.P(x + 7, y, z + 1, 'lit'),
    }), [bx, by, bz - 2]);
    if (o.powered === 'true') {
      pulse = true;
      if (o.lamp === 'true') pulseLamp = true;
    } else if (pulse) {
      pulseOff = true;
      break;
    }
  }
  check('observer pulses on a watched block change', pulse && pulseLamp, { pulse, pulseLamp });
  check('observer pulse ends after 2 ticks', pulseOff, { pulseOff });

  // ---------------------------------------------------------------- daylight detector
  await ev(([x, y, z]) => {
    window.__h.set(x + 10, y, z, 'daylight_detector', { inverted: 'false', power: '0' });
    window.__mc.level.time = 6000;
  }, [bx, by, bz - 2]);
  await sleep(1300);
  let day = await ev(([x, y, z]) => ({
    power: window.__h.P(x + 10, y, z, 'power'),
    sky: window.__mc.level.getSkyLight(x + 10, y, z),
  }), [bx, by, bz - 2]);
  check('daylight detector noon -> 15', day.power === '15', day);
  await ev(([x, y, z]) => { window.__mc.level.time = 18000; }, [bx, by, bz - 2]);
  await sleep(1300);
  day = await ev(([x, y, z]) => ({ power: window.__h.P(x + 10, y, z, 'power') }), [bx, by, bz - 2]);
  check('daylight detector midnight -> 0', day.power === '0', day);
  await ev(([x, y, z]) => { window.__mc.redstone.use(x + 10, y, z); }, [bx, by, bz - 2]);
  await sleep(150);
  day = await ev(([x, y, z]) => ({
    inverted: window.__h.P(x + 10, y, z, 'inverted'),
    power: window.__h.P(x + 10, y, z, 'power'),
  }), [bx, by, bz - 2]);
  check('daylight detector inverted at midnight -> 15', day.inverted === 'true' && day.power === '15', day);

  // ---------------------------------------------------------------- tripwire
  await ev(([x, y, z]) => {
    const h = window.__h;
    h.set(x, y, z, 'stone');
    h.set(x + 6, y, z, 'stone');
    h.set(x + 1, y, z, 'tripwire_hook', { facing: 'east', powered: 'false', attached: 'false' });
    h.set(x + 5, y, z, 'tripwire_hook', { facing: 'west', powered: 'false', attached: 'false' });
    for (let i = 2; i <= 4; i++) h.set(x + i, y, z, 'tripwire');
  }, [bx, by, bz - 6]);
  await sleep(300);
  let trip = await ev(([x, y, z]) => ({
    hookA: window.__h.P(x + 1, y, z, 'attached'),
    hookB: window.__h.P(x + 5, y, z, 'attached'),
    wire: window.__h.P(x + 3, y, z, 'attached'),
    west: window.__h.P(x + 3, y, z, 'west'),
    powered: window.__h.P(x + 1, y, z, 'powered'),
  }), [bx, by, bz - 6]);
  check('tripwire line attaches both hooks', trip.hookA === 'true' && trip.hookB === 'true'
    && trip.wire === 'true' && trip.west === 'true' && trip.powered === 'false', trip);

  await ev(([x, y, z]) => {
    const p = window.__mc.player;
    p.pos.x = x + 3.5; p.pos.y = y; p.pos.z = z + 0.5;
    p.vel.x = p.vel.y = p.vel.z = 0;
  }, [bx, by, bz - 6]);
  await sleep(300);
  trip = await ev(([x, y, z]) => ({
    wire: window.__h.P(x + 3, y, z, 'powered'),
    a: window.__h.P(x + 1, y, z, 'powered'),
    b: window.__h.P(x + 5, y, z, 'powered'),
  }), [bx, by, bz - 6]);
  check('tripwire player on wire -> both hooks powered', trip.wire === 'true'
    && trip.a === 'true' && trip.b === 'true', trip);

  await ev(([x, y, z]) => {
    const p = window.__mc.player;
    p.pos.x = x + 10.5; p.pos.z = z + 0.5;
  }, [bx, by, bz - 6]);
  await sleep(300);
  trip = await ev(([x, y, z]) => ({
    wire: window.__h.P(x + 3, y, z, 'powered'),
    hook: window.__h.P(x + 1, y, z, 'powered'),
  }), [bx, by, bz - 6]);
  check('tripwire release -> hooks unpowered', trip.wire === 'false' && trip.hook === 'false', trip);

  // ---------------------------------------------------------------- torch burnout
  const torch = await ev(([x, y, z]) => {
    const m = window.__mc;
    const h = window.__h;
    h.set(x + 1, y, z, 'stone');
    h.set(x + 1, y + 1, z, 'redstone_torch', { lit: 'true' });
    for (let i = 0; i < 8; i++) {
      h.set(x + 1, y, z, 'redstone_block');
      for (let t = 0; t < 3; t++) m.redstone.tick();
      h.set(x + 1, y, z, 'stone');
      for (let t = 0; t < 3; t++) m.redstone.tick();
    }
    const lit = h.P(x + 1, y + 1, z, 'lit');
    for (let t = 0; t < 170; t++) m.redstone.tick();
    return { lit, relit: h.P(x + 1, y + 1, z, 'lit') };
  }, [bx, by, bz - 9]);
  check('torch burns out after 8 flips', torch.lit === 'false', torch);
  check('torch relights after 160 ticks', torch.relit === 'true', torch);

  // ---------------------------------------------------------------- pistons
  await ev(([x, y, z]) => {
    const h = window.__h;
    h.set(x + 7, y, z, 'piston', { facing: 'up', extended: 'false' });
    h.set(x + 7, y + 1, z, 'stone');
    h.set(x + 8, y, z, 'redstone_block');
  }, [bx, by, bz - 9]);
  await sleep(300);
  let p = await ev(([x, y, z]) => ({
    base: window.__h.P(x + 7, y, z, 'extended'),
    head: window.__h.N(x + 7, y + 1, z),
    moved: window.__h.N(x + 7, y + 2, z),
  }), [bx, by, bz - 9]);
  check('piston extends and pushes stone', p.base === 'true'
    && p.head === 'piston_head' && p.moved === 'stone', p);

  await ev(([x, y, z]) => { window.__h.air(x + 8, y, z); }, [bx, by, bz - 9]);
  await sleep(300);
  p = await ev(([x, y, z]) => ({
    base: window.__h.P(x + 7, y, z, 'extended'),
    head: window.__h.N(x + 7, y + 1, z),
    moved: window.__h.N(x + 7, y + 2, z),
  }), [bx, by, bz - 9]);
  check('piston retracts leaving the pushed stone', p.base === 'false'
    && p.head === 'air' && p.moved === 'stone', p);

  await ev(([x, y, z]) => {
    const h = window.__h;
    h.set(x + 11, y, z, 'sticky_piston', { facing: 'up', extended: 'false' });
    h.set(x + 11, y + 1, z, 'stone');
    h.set(x + 12, y, z, 'redstone_block');
  }, [bx, by, bz - 9]);
  await sleep(300);
  await ev(([x, y, z]) => { window.__h.air(x + 12, y, z); }, [bx, by, bz - 9]);
  await sleep(300);
  p = await ev(([x, y, z]) => ({
    base: window.__h.P(x + 11, y, z, 'extended'),
    head: window.__h.N(x + 11, y + 1, z),
    above: window.__h.N(x + 11, y + 2, z),
  }), [bx, by, bz - 9]);
  check('sticky piston pulls the stone back', p.base === 'false'
    && p.head === 'stone' && p.above === 'air', p);

  await ev(([x, y, z]) => {
    const h = window.__h;
    h.set(x + 14, y, z, 'piston', { facing: 'up', extended: 'false' });
    h.set(x + 14, y + 1, z, 'slime_block');
    h.set(x + 15, y + 1, z, 'stone');
    h.set(x + 14, y, z + 1, 'redstone_block');
  }, [bx, by, bz - 9]);
  await sleep(300);
  p = await ev(([x, y, z]) => ({
    base: window.__h.P(x + 14, y, z, 'extended'),
    slime: window.__h.N(x + 14, y + 2, z),
    branch: window.__h.N(x + 15, y + 2, z),
  }), [bx, by, bz - 9]);
  check('slime branch follows the push', p.base === 'true' && p.slime === 'slime_block'
    && p.branch === 'stone', p);

  await ev(([x, y, z]) => {
    const h = window.__h;
    h.set(x + 16, y, z - 6, 'piston', { facing: 'up', extended: 'false' });
    for (let i = 1; i <= 13; i++) h.set(x + 16, y + i, z - 6, 'stone');
    h.set(x + 17, y, z - 6, 'redstone_block');
  }, [bx, by, bz]);
  await sleep(300);
  p = await ev(([x, y, z]) => ({
    base: window.__h.P(x + 16, y, z - 6, 'extended'),
    bottom: window.__h.N(x + 16, y + 1, z - 6),
  }), [bx, by, bz]);
  check('piston refuses 13 blocks', p.base === 'false' && p.bottom === 'stone', p);

  // ---------------------------------------------------------------- rails
  await ev(([x, y, z]) => {
    const h = window.__h;
    h.set(x + 1, y, z, 'powered_rail', { powered: 'false', shape: 'north_south' });
    h.set(x + 2, y, z, 'rail', { shape: 'north_south' });
    h.set(x + 1, y, z - 1, 'lever', { face: 'floor', facing: 'north', powered: 'true' });
  }, [bx, by, bz - 12]);
  await sleep(300);
  const rail = await ev(([x, y, z]) => ({
    powered: window.__h.P(x + 1, y, z, 'powered'),
    shape: window.__h.P(x + 1, y, z, 'shape'),
    shape2: window.__h.P(x + 2, y, z, 'shape'),
  }), [bx, by, bz - 12]);
  check('powered rail powers and shapes', rail.powered === 'true'
    && rail.shape === 'east_west' && rail.shape2 === 'east_west', rail);

  await page.screenshot({ path: 'shots/diag/redstone2.png' });
} catch (err) {
  console.log('ERROR', err);
  results.push({ name: 'probe', ok: false });
} finally {
  console.log('');
  console.log(`Total: ${results.filter((x) => x.ok).length}/${results.length} PASS`);
  await browser.close();
  process.exit(results.every((x) => x.ok) ? 0 : 1);
}
