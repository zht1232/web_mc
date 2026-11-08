// Cave ambience regression test (HANDOFF §8-4).
//
//   node scripts/test-ambience.mjs [baseUrl]
//
// Checks the 'ambient.cave' handler:
//   1) the sound engine can play the event at all (sanity: stats counter increments);
//   2) above ground in daylight nothing is scheduled even with the chance forced to 1;
//   3) underground (sky light 0, below sea level) with chance 1 exactly one cave sound plays,
//      and the cooldown suppresses further ones.
// Screenshots: shots/ambience/.

import { chromium } from 'playwright';
import { launchOptions } from './lib/browser.mjs';
import { mkdirSync } from 'node:fs';

const base = (process.argv[2] ?? 'http://127.0.0.1:5174/').replace(/\/$/, '');
const outDir = 'shots/ambience';
mkdirSync(outDir, { recursive: true });

let failures = 0;
const check = (name, ok, detail = '') => {
  if (!ok) failures++;
  console.log(`${ok ? 'PASS' : 'FAIL'}  ${name}  ${detail}`);
};

const browser = await chromium.launch(launchOptions());
const page = await browser.newPage({ viewport: { width: 1280, height: 720 }, deviceScaleFactor: 1 });
const errors = [];
page.on('pageerror', (err) => errors.push(`[pageerror] ${err.message}`));
page.on('console', (msg) => { if (msg.type() === 'error') errors.push(`[console] ${msg.text()}`); });
const ev = (fn, arg) => page.evaluate(fn, arg);
const sleep = (ms) => page.waitForTimeout(ms);

async function waitFor(name, fn, timeout = 120000) {
  const deadline = Date.now() + timeout;
  let last;
  while (Date.now() < deadline) {
    try { last = await ev(fn); if (last) return last; } catch { /* booting */ }
    await sleep(250);
  }
  throw new Error(`timeout waiting for ${name} (last=${JSON.stringify(last)})`);
}

const caveCount = () => ev(() => window.__mc.sounds.stats['ambient.cave'] ?? 0);

try {
  await page.goto(`${base}/?play`, { waitUntil: 'domcontentloaded', timeout: 120000 });
  await sleep(400);
  await waitFor('__mc', () => !!window.__mc);
  await waitFor('world loaded', () => window.__mc.level && window.__mc.level.chunks.size > 250);
  await ev(() => {
    const m = window.__mc;
    m.renderer.shadersEnabled = false;
    m.level.time = 6000;
    m.options.gamemode = 'creative';
    m.player.flying = true;
    m.player.vel.x = 0; m.player.vel.y = 0; m.player.vel.z = 0;
  });
  // The sound index loads asynchronously; wait until the engine reports itself ready.
  await waitFor('sound engine ready', () => !!window.__mc.sounds.index, 20000);
  await sleep(400);

  console.log('=== 1. sanity: the event can be played ===');
  const before = await caveCount();
  await ev(() => window.__mc.sounds.play('ambient.cave', 0, 0, 0, 0.7, 1));
  await sleep(200);
  const afterSanity = await caveCount();
  check('ambient.cave plays through the sound engine', afterSanity === before + 1, `${before} -> ${afterSanity}`);

  console.log('=== 2. above ground: forced chance still yields nothing ===');
  const groundState = await ev(() => {
    const m = window.__mc;
    const p = m.player;
    const px = Math.floor(p.pos.x), py = Math.floor(p.eyeY), pz = Math.floor(p.pos.z);
    m.caveSoundChance = 1;
    return { py, skyLight: m.level.getSkyLight(px, py, pz), seaLevel: m.level.seaLevel };
  });
  await sleep(700); // ~14 ticks with chance 1
  const aboveCount = await caveCount();
  check('no cave sound above ground in daylight', aboveCount === afterSanity,
    `${JSON.stringify(groundState)} count=${aboveCount}`);

  console.log('=== 3. underground: one cave sound, then cooldown ===');
  const underState = await ev(() => {
    const m = window.__mc;
    const p = m.player;
    const px = Math.floor(p.pos.x), pz = Math.floor(p.pos.z);
    m.level.ensureChunk(px >> 4, pz >> 4);
    const y = m.level.seaLevel - 25;
    p.pos.y = y;
    const eyeY = Math.floor(p.eyeY);
    return { y, eyeY, skyLight: m.level.getSkyLight(px, eyeY, pz), seaLevel: m.level.seaLevel };
  });
  await sleep(500);
  // The teleport itself may have consumed the forced chance; reset the cooldown so the measured
  // window starts clean (chance is still forced to 1 from the previous step).
  await ev(() => { window.__mc.caveSoundTimer = 0; });
  const beforeUnderground = await caveCount();
  await sleep(900); // ~18 ticks at chance 1, cooldown set after the first trigger
  const afterUnderground = await caveCount();
  check('underground position is dark', underState.skyLight === 0, JSON.stringify(underState));
  check('exactly one cave sound plays underground', afterUnderground === beforeUnderground + 1,
    `${beforeUnderground} -> ${afterUnderground}`);
  await sleep(600);
  const afterCooldown = await caveCount();
  check('cooldown suppresses immediate repeats', afterCooldown === afterUnderground, `${afterUnderground} -> ${afterCooldown}`);
  await page.screenshot({ path: `${outDir}/01-underground.png` });
  await ev(() => { window.__mc.caveSoundChance = 1 / 600; });

  check('no page errors', errors.length === 0, errors.slice(0, 4).join(' | '));
  console.log(`screenshot: ${outDir}/01-underground.png`);
} catch (err) {
  failures++;
  console.log('FAIL  exception:', err.message);
  try { await page.screenshot({ path: `${outDir}/99-failure.png` }); } catch { /* ignore */ }
}

console.log(`\n${failures === 0 ? 'ALL PASS' : `${failures} FAILURES`}`);
await browser.close();
process.exit(failures === 0 ? 0 : 1);
