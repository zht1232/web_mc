// Touch overlay regression test (Bedrock-style controls on a touch-emulated context).
//
//   node scripts/test-touch.mjs [baseUrl]
//
// ?touch=1 force-enables the overlay on a headless desktop browser; pointer events from
// page.mouse are accepted by the overlay (it only rejects non-primary mouse buttons), so the
// joystick / look pad / buttons can be driven deterministically.
//
// Covers: overlay visibility rules (hidden on title, shown in game), joystick movement, look pad
// yaw/pitch, hotbar tap selection, attack (creative instant break), pause button opens the pause
// screen and hides the overlay, Return to Game restores it. Desktop (?play without ?touch) must
// keep the overlay disabled. Screenshots: shots/touch/.

import { chromium } from 'playwright';
import { launchOptions } from './lib/browser.mjs';
import { mkdirSync } from 'node:fs';

const base = (process.argv[2] ?? 'http://127.0.0.1:5174/').replace(/\/$/, '');
const outDir = 'shots/touch';
mkdirSync(outDir, { recursive: true });

let failures = 0;
const check = (name, ok, detail = '') => {
  if (!ok) failures++;
  console.log(`${ok ? 'PASS' : 'FAIL'}  ${name}  ${detail}`);
};

const browser = await chromium.launch(launchOptions());
const context = await browser.newContext({
  viewport: { width: 900, height: 430 },
  deviceScaleFactor: 2,
  hasTouch: true,
  isMobile: true,
});
const page = await context.newPage();
const errors = [];
page.on('pageerror', (err) => errors.push(`[pageerror] ${err.message}`));
page.on('console', (msg) => { if (msg.type() === 'error') errors.push(`[console] ${msg.text()}`); });

const ev = (fn, arg) => page.evaluate(fn, arg);
const sleep = (ms) => page.waitForTimeout(ms);
const rectOf = async (selector) => ev((sel) => {
  const el = document.querySelector(sel);
  if (!el) return null;
  const r = el.getBoundingClientRect();
  return { x: r.x, y: r.y, w: r.width, h: r.height };
}, selector);

try {
  console.log('=== 1. ?touch=1&play boots into the world with the overlay visible ===');
  await page.goto(`${base}/?touch=1&play`, { waitUntil: 'domcontentloaded', timeout: 120000 });
  await sleep(500);
  await waitFor('__mc', () => !!window.__mc);
  await waitFor('in world', () => {
    const m = window.__mc;
    return m.screens.current === null && m.level.chunks.size > 0 ? true : null;
  });
  await waitFor('overlay visible', () => {
    const el = document.querySelector('.tc-root');
    return el && el.dataset.visible === 'true' ? true : null;
  }, 20000);
  check('overlay is visible in world', (await ev(() => document.querySelector('.tc-root').dataset.visible)) === 'true');
  check('touchEnabled flag is set', await ev(() => window.__mc.touchEnabled === true));
  const look = await rectOf('.tc-look');
  const joy = await rectOf('.tc-joy');
  check('look pad exists', !!look && look.w > 100, look ? `${Math.round(look.w)}x${Math.round(look.h)}` : 'missing');
  check('joystick exists', !!joy && joy.w > 40, joy ? `${Math.round(joy.w)}x${Math.round(joy.h)}` : 'missing');
  await sleep(1200);
  await page.screenshot({ path: `${outDir}/01-ingame.png` });

  console.log('=== 2. joystick moves the player ===');
  // Pin the player on solid ground facing +Z and clear velocities.
  const before = await ev(() => {
    const m = window.__mc;
    m.options.gamemode = 'creative';
    m.player.flying = false;
    m.level.time = 6000;
    m.player.yaw = 0;
    m.player.pitch = 0;
    const p = m.player.pos;
    return { x: p.x, y: p.y, z: p.z };
  });
  const jx = joy.x + joy.w / 2;
  const jy = joy.y + joy.h / 2;
  await page.mouse.move(jx, jy);
  await page.mouse.down();
  await page.mouse.move(jx, jy - joy.h * 0.45, { steps: 8 });
  await sleep(1200);
  const after = await ev(() => {
    const p = window.__mc.player.pos;
    return { x: p.x, y: p.y, z: p.z };
  });
  await page.mouse.up();
  const moved = Math.hypot(after.x - before.x, after.z - before.z);
  check('joystick drives forward movement', moved > 0.5, `moved ${moved.toFixed(2)} blocks`);

  console.log('=== 3. look pad turns the camera ===');
  const yawBefore = await ev(() => window.__mc.player.yaw);
  const lx = look.x + look.w / 2;
  const ly = look.y + look.h / 2;
  await page.mouse.move(lx, ly);
  await page.mouse.down();
  await page.mouse.move(lx + 140, ly + 30, { steps: 10 });
  await sleep(400);
  await page.mouse.up();
  await sleep(200);
  const yawAfter = await ev(() => window.__mc.player.yaw);
  check('look pad changes yaw', Math.abs(yawAfter - yawBefore) > 8, `${yawBefore.toFixed(1)} -> ${yawAfter.toFixed(1)}`);

  console.log('=== 4. hotbar tap selects a slot ===');
  await ev(() => { window.__mc.player.yaw = 0; window.__mc.player.pitch = 0; });
  const slotTarget = 4;
  const hotbarPoint = await ev((slot) => {
    const m = window.__mc;
    const scale = m.guiScale;
    const w = window.innerWidth / scale;
    const h = window.innerHeight / scale;
    const left = Math.floor(w / 2) - 91;
    return { x: (left + 1 + slot * 20 + 10) * scale, y: (h - 11) * scale };
  }, slotTarget);
  // Real touch event: the hotbar selector only reacts to pointerType touch/pen.
  await page.touchscreen.tap(hotbarPoint.x, hotbarPoint.y);
  await sleep(300);
  check('hotbar tap selects the slot', (await ev(() => window.__mc.selectedSlot)) === slotTarget);

  console.log('=== 5. attack button breaks a block in creative ===');
  // Stand above the surface and look straight down at the block below.
  const target = await ev(() => {
    const m = window.__mc;
    m.options.gamemode = 'creative';
    m.player.flying = true;
    m.player.pos.y += 2;
    m.player.yaw = 0;
    m.player.pitch = 88;
    m.player.vel.x = 0;
    m.player.vel.y = 0;
    m.player.vel.z = 0;
    return null;
  });
  await sleep(600);
  const hit = await ev(() => {
    const m = window.__mc;
    const h = m.raycast(5);
    if (!h) return null;
    return { x: h.x, y: h.y, z: h.z, state: m.level.getBlockState(h.x, h.y, h.z) };
  });
  if (!hit) {
    check('found a break target', false, 'raycast returned null');
  } else {
    const attack = await rectOf('[data-action="attack"]');
    if (!attack) {
      check('attack button exists', false);
    } else {
      await page.mouse.click(attack.x + attack.w / 2, attack.y + attack.h / 2);
      await sleep(500);
      const now = await ev((h) => window.__mc.level.getBlockState(h.x, h.y, h.z), hit);
      check('attack button breaks the aimed block', hit.state !== 0 && now === 0,
        `state ${hit.state} -> ${now}`);
    }
  }

  console.log('=== 6. pause button opens the pause menu and hides the overlay ===');
  const pauseBtn = await rectOf('[data-action="pause"]');
  check('pause button exists', !!pauseBtn);
  await page.mouse.click(pauseBtn.x + pauseBtn.w / 2, pauseBtn.y + pauseBtn.h / 2);
  await waitFor('PauseScreen', () => {
    const s = window.__mc.screens.current;
    return s && s.constructor.name === 'PauseScreen' ? true : null;
  }, 10000);
  check('pause opens PauseScreen', (await ev(() => window.__mc.screens.current?.constructor?.name)) === 'PauseScreen');
  await waitFor('overlay hidden under menu', () => document.querySelector('.tc-root')?.dataset.visible === 'false' ? true : null, 5000);
  check('overlay hidden while a menu is open', (await ev(() => document.querySelector('.tc-root').dataset.visible)) === 'false');
  await sleep(500);
  await page.screenshot({ path: `${outDir}/02-pause.png` });

  console.log('=== 7. Return to Game restores the overlay ===');
  const returnRect = await ev(() => {
    const s = window.__mc.screens.current;
    const r = s.children.find((c) => typeof c.getRect === 'function' && c.getRect().y < 80)?.getRect();
    return r ? { x: r.x, y: r.y, w: r.width, h: r.height } : null;
  });
  if (!returnRect) {
    check('found the Return to Game button', false);
  } else {
    const scale = await ev(() => window.__mc.screens.guiScale);
    await page.mouse.click((returnRect.x + returnRect.w / 2) * scale, (returnRect.y + returnRect.h / 2) * scale);
    await waitFor('back in game', () => window.__mc.screens.current === null, 10000);
    await sleep(400);
    check('overlay returns after closing the menu', (await ev(() => document.querySelector('.tc-root').dataset.visible)) === 'true');
  }

  console.log('=== 8. desktop ?play keeps the touch overlay disabled ===');
  const desktop = await browser.newContext({ viewport: { width: 1280, height: 720 }, deviceScaleFactor: 1 });
  const deskPage = await desktop.newPage();
  deskPage.on('pageerror', (err) => errors.push(`[desktop pageerror] ${err.message}`));
  await deskPage.goto(`${base}/?play`, { waitUntil: 'domcontentloaded', timeout: 120000 });
  await deskPage.waitForFunction(() => !!window.__mc, null, { timeout: 120000 });
  await deskPage.waitForFunction(() => window.__mc.level && window.__mc.level.chunks.size > 0, null, { timeout: 120000 });
  await deskPage.waitForTimeout(1200);
  const deskState = await deskPage.evaluate(() => ({
    touchEnabled: window.__mc.touchEnabled === true,
    visible: document.querySelector('.tc-root')?.dataset.visible ?? 'missing',
  }));
  check('desktop overlay stays disabled', !deskState.touchEnabled && deskState.visible !== 'true',
    JSON.stringify(deskState));
  await desktop.close();

  check('no page errors', errors.length === 0, errors.slice(0, 4).join(' | '));
} catch (err) {
  failures++;
  console.log('FAIL  exception:', err.message);
  try { await page.screenshot({ path: `${outDir}/99-failure.png` }); } catch { /* ignore */ }
}

console.log(`\n${failures === 0 ? 'ALL PASS' : `${failures} FAILURES`}`);
await browser.close();
process.exit(failures === 0 ? 0 : 1);

async function waitFor(name, fn, timeout = 90000) {
  const deadline = Date.now() + timeout;
  let last;
  while (Date.now() < deadline) {
    try { last = await ev(fn); if (last) return last; } catch { /* booting */ }
    await sleep(200);
  }
  throw new Error(`timeout waiting for ${name} (last=${JSON.stringify(last)})`);
}
