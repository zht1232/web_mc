import assert from 'node:assert/strict';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { chromium } from 'playwright';
import { launchOptions } from './lib/browser.mjs';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const browser = await chromium.launch(launchOptions());
const errors = [];

async function setup(page, mobile) {
  page.on('pageerror', err => errors.push(err.message));
  await page.goto(`http://127.0.0.1:5174/?play${mobile ? '&touch=1' : ''}`, { waitUntil: 'domcontentloaded', timeout: 120000 });
  await page.waitForFunction(() => window.__mc?.running, null, { timeout: 120000 });
  await page.evaluate(async () => {
    const m = window.__mc;
    m.options.renderDistance = 2;
    m.renderer.renderDistance = 2;
    m.options.gamemode = 'survival';
    m.survival.gamemode = 'survival';
    m.survival.naturalRegen = false;
    await m.autosave?.pause();
    const x = Math.floor(m.player.pos.x / 16) * 16 + 8;
    const z = Math.floor(m.player.pos.z / 16) * 16 + 8;
    const chunk = m.level.getChunk(x >> 4, z >> 4);
    const water = m.mc.stateOf('water');
    const stone = m.mc.stateOf('stone');
    for (let y = 107; y < 151; y++) {
      for (let dz = -4; dz <= 4; dz++) for (let dx = -4; dx <= 4; dx++) {
        chunk.setBlockState((x + dx) & 15, y, (z + dz) & 15, y === 107 ? stone : water);
      }
    }
    m.level.light.lightChunk(chunk);
    window.__fixture = { x, z };
    window.__trace = [];
    const tick = m.player.tick.bind(m.player);
    m.player.tick = (level, input) => {
      tick(level, input);
      window.__trace.push({ y: m.player.pos.y, dy: m.player.pos.y - m.player.prevPos.y,
        z: m.player.pos.z, input: { ...input }, swing: m.player.swingRotation, inWater: m.player.inWater });
      if (window.__trace.length > 500) window.__trace.shift();
    };
    const render = m.hud.render.bind(m.hud);
    const blit = m.hud.blit.bind(m.hud);
    m.hud.render = (...args) => { window.__hudCalls = []; return render(...args); };
    m.hud.blit = (ctx, sprite, x, y, ...args) => {
      window.__hudCalls.push({ sprite, x, y });
      return blit(ctx, sprite, x, y, ...args);
    };
  });
  await reset(page, 130);
}

async function reset(page, y) {
  await page.evaluate(async y => {
    const { Vec3 } = await import('/src/vanilla/core/Geometry.ts');
    const m = window.__mc;
    const { x, z } = window.__fixture;
    m.player.pos = new Vec3(x + 0.5, y, z + 0.5);
    m.player.prevPos = m.player.pos;
    m.player.vel = new Vec3(0, 0, 0);
    m.player.flying = false;
    m.player.sprinting = false;
    m.player.sneaking = false;
    m.player.onGround = false;
    m.player.fallDistance = 0;
    m.player.pitch = 0;
    m.player.yaw = 0;
    m.survival.health = 20;
    m.keys.clear();
    m.sprintTap = false;
    window.__trace = [];
  }, y);
}

async function measure(page, key, expected, mobile) {
  await reset(page, 130);
  let button;
  if (key) {
    if (mobile) {
      button = await page.locator(key === 'Space' ? '.tc-btn-jump' : '.tc-btn-sneak').boundingBox();
      assert.ok(button);
      await page.mouse.move(button.x + button.width / 2, button.y + button.height / 2);
      await page.mouse.down();
    } else await page.keyboard.down(key);
  }
  const inputKey = key === 'Space' ? 'jump' : key ? 'sneak' : null;
  await page.waitForFunction(inputKey => window.__trace.filter(t => !inputKey || t.input[inputKey]).length >= 75,
    inputKey, { timeout: 20000 });
  const samples = await page.evaluate(inputKey => window.__trace.filter(t => !inputKey || t.input[inputKey]).slice(-10), inputKey);
  if (key) {
    if (mobile) await page.mouse.up();
    else await page.keyboard.up(key);
  }
  const speed = samples.reduce((sum, t) => sum + t.dy * 20, 0) / samples.length;
  assert.ok(samples.every(t => t.inWater), 'measurement left water');
  assert.ok(Math.abs(speed - expected) < 0.02, `${key ?? 'idle'} speed ${speed}, expected ${expected}`);
  console.log(`PASS ${mobile ? 'touch' : 'desktop'} ${key ?? 'idle'}: ${speed.toFixed(3)} blocks/s`);
}

async function checkHud(page, name) {
  await reset(page, 130);
  await page.waitForFunction(() => window.__hudCalls?.some(c => c.sprite.includes('/air')));
  const layout = await page.evaluate(() => {
    const m = window.__mc;
    return { air: window.__hudCalls.filter(c => c.sprite.includes('/air')),
      food: window.__hudCalls.filter(c => c.sprite.endsWith('/food_empty')),
      scale: m.guiScale, height: Math.ceil(m.guiCanvas.height / m.guiScale),
      smoothing: m.guiCtx.imageSmoothingEnabled, contextLost: m.gl.isContextLost() };
  });
  assert.ok(layout.air.length > 0 && layout.food.length === 10);
  assert.ok(layout.air.every(c => c.y === layout.height - 49));
  assert.equal(layout.air[0].y, layout.food[0].y - 10);
  assert.equal(layout.air[0].x, layout.food[0].x);
  assert.equal(layout.smoothing, false);
  assert.equal(layout.contextLost, false);
  const overlaps = await page.evaluate(() => {
    const m = window.__mc;
    const pixel = m.guiScale / (m.guiCanvas.width / window.innerWidth);
    const w = Math.ceil(m.guiCanvas.width / m.guiScale);
    const h = Math.ceil(m.guiCanvas.height / m.guiScale);
    const hud = { left: (Math.floor(w / 2) - 91) * pixel, right: (Math.floor(w / 2) + 91) * pixel,
      top: (h - 49) * pixel, bottom: window.innerHeight };
    return [...document.querySelectorAll('.tc-btn, .tc-joy')].filter(el => {
      if (getComputedStyle(el).visibility === 'hidden') return false;
      const r = el.getBoundingClientRect();
      return r.right > hud.left && r.left < hud.right && r.bottom > hud.top && r.top < hud.bottom;
    }).map(el => el.className);
  });
  assert.deepEqual(overlaps, [], 'touch controls overlap survival HUD');
  await page.screenshot({ path: path.join(root, 'shots', `verify-water-${name}.png`) });
  console.log(`PASS ${name} HUD: air=${layout.air[0].y}, food=${layout.food[0].y}, scale=${layout.scale}`);
}

try {
  const desktop = await browser.newContext({ viewport: { width: 1600, height: 900 }, deviceScaleFactor: 1 });
  const page = await desktop.newPage();
  await setup(page, false);
  for (const [key, speed] of [['Space', 3.5], [null, -0.5], ['ShiftLeft', -4.5]]) await measure(page, key, speed, false);
  await checkHud(page, 'desktop');
  await page.evaluate(() => {
    const m = window.__mc;
    const { x, z } = window.__fixture;
    const chunk = m.level.getChunk(x >> 4, z >> 4);
    const stone = m.mc.stateOf('stone');
    for (let dz = -4; dz <= 4; dz++) for (let dx = -4; dx <= 4; dx++) {
      chunk.setBlockState((x + dx) & 15, 180, (z + dz) & 15, stone);
    }
    chunk.setBlockState(x & 15, 181, (z + 1) & 15, stone);
  });
  await reset(page, 181);
  await page.waitForFunction(() => window.__mc.player.onGround);
  await page.keyboard.down('w');
  await page.keyboard.down('Space');
  await page.waitForFunction(() => window.__trace.some(t => t.input.jump));
  await page.keyboard.up('Space');
  await page.waitForFunction(() => window.__trace.filter(t => t.input.forward > 0).length >= 35);
  await page.keyboard.up('w');
  const jump = await page.evaluate(() => ({ rise: Math.max(...window.__trace.map(t => t.y)) - 181,
    crossed: window.__mc.player.pos.z > window.__fixture.z + 1.81 }));
  assert.ok(jump.rise > 1.2 && jump.crossed, JSON.stringify(jump));
  console.log('PASS actual keyboard one-block jump', jump);

  await page.evaluate(() => {
    const m = window.__mc;
    const { x, z } = window.__fixture;
    const chunk = m.level.getChunk(x >> 4, z >> 4);
    chunk.setBlockState(x & 15, 181, (z + 1) & 15, 0);
    chunk.setBlockState(x & 15, 182, (z + 2) & 15, m.mc.stateOf('obsidian'));
    m.survival.inventory.setItem(0, m.survival.inventory.getItem(0).copyWithCount(0));
    m.selectedSlot = 0;
  });
  await reset(page, 181);
  await page.locator('.gui-canvas').click({ position: { x: 800, y: 450 } });
  await page.waitForFunction(() => window.__mc.mouseLocked && document.pointerLockElement !== null);
  await page.mouse.down();
  await page.waitForFunction(() => window.__trace.length >= 45);
  const swings = await page.evaluate(() => ({ target: window.__mc.raycast(), mining: window.__mc.mining,
    cycles: window.__trace.filter((t, i, a) => i > 0 && t.swing > 0.01 && a[i - 1].swing <= 0.01).length }));
  await page.screenshot({ path: path.join(root, 'shots', 'verify-mining-held.png') });
  await page.mouse.up();
  assert.ok(swings.target && swings.mining && swings.cycles >= 4, JSON.stringify(swings));
  console.log('PASS held mining repeatedly swings', swings.cycles);
  await page.keyboard.press('Escape');
  await page.waitForFunction(() => window.__mc.screens.current?.constructor.name === 'PauseScreen');
  console.log('PASS single Escape opens pause');
  await desktop.close();

  const mobile = await browser.newContext({ viewport: { width: 430, height: 900 }, deviceScaleFactor: 2, hasTouch: true, isMobile: true });
  const touchPage = await mobile.newPage();
  await setup(touchPage, true);
  await touchPage.waitForFunction(() => document.querySelector('.tc-root')?.dataset.visible === 'true');
  for (const [key, speed] of [['Space', 3.5], ['ShiftLeft', -4.5]]) await measure(touchPage, key, speed, true);
  await checkHud(touchPage, 'portrait');
  await touchPage.setViewportSize({ width: 900, height: 430 });
  await checkHud(touchPage, 'landscape');
  await mobile.close();
  assert.deepEqual(errors, []);
  console.log('ALL browser checks passed; no page errors');
} finally {
  await browser.close();
}
