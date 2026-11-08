// Title-screen / world-selection regression test (headless, real click coordinates).
//
//   node scripts/test-menu.mjs [baseUrl]
//
// Covers: boot -> title, Singleplayer -> Select World list populated, Play -> in world,
// Esc -> pause, "Save and Quit to Title" -> title again, Play again -> in world,
// ?play boots straight into the world. Screenshots land in shots/menu/.
//
// Exit code 1 on the first failed assertion.

import { chromium } from 'playwright';
import { launchOptions } from './lib/browser.mjs';
import { mkdirSync } from 'node:fs';

const base = (process.argv[2] ?? 'http://127.0.0.1:5174/').replace(/\/$/, '');
const outDir = 'shots/menu';
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

async function waitFor(name, fn, timeout = 90000) {
  const deadline = Date.now() + timeout;
  let last;
  while (Date.now() < deadline) {
    try { last = await ev(fn); if (last) return last; } catch { /* still booting */ }
    await sleep(250);
  }
  throw new Error(`timeout waiting for ${name} (last=${JSON.stringify(last)})`);
}

/** Click a logical-GUI rect (x/y in GUI px, the manager divides CSS by guiScale). */
async function clickRect(rect) {
  const scale = await ev(() => window.__mc.screens.guiScale);
  await page.mouse.click((rect.x + rect.width / 2) * scale, (rect.y + rect.height / 2) * scale);
  await sleep(120);
}

async function screenName() {
  return ev(() => {
    const s = window.__mc?.screens?.current;
    return s ? (s.constructor?.name ?? '?') : null;
  });
}

async function titleButton(key) {
  return ev((k) => {
    const t = window.__mc.screens.current;
    const r = t.getLayout()[k];
    return { x: r.x, y: r.y, width: r.width, height: r.height };
  }, key);
}

log('=== 1. boot without params shows the title screen ===');
await page.goto(`${base}/`, { waitUntil: 'domcontentloaded', timeout: 90000 });
await waitFor('__mc', () => !!window.__mc);
await waitFor('loading screen gone', () => !document.querySelector('.loading-screen'));
check('title at boot', (await screenName()) === 'TitleScreen', `screen=${await screenName()}`);
// Give the panorama/logo/splash a few frames to fade in.
await sleep(3500);
await page.screenshot({ path: `${outDir}/01-title.png` });

// The client no longer restores/creates a world while booting to the title (vanilla does not
// create a level until you enter one), so a fresh profile has an empty list. Create one through
// the ?play path first, exactly like a returning player's save.
log('=== 1b. warm-up world so the list has an entry ===');
await page.goto(`${base}/?play`, { waitUntil: 'domcontentloaded', timeout: 90000 });
await waitFor('__mc (warmup)', () => !!window.__mc);
await waitFor('world running', () => !!window.__mc.running, 60000);
await sleep(1500);
await page.goto(`${base}/`, { waitUntil: 'domcontentloaded', timeout: 90000 });
await waitFor('__mc (title)', () => !!window.__mc);
await waitFor('loading screen gone (title)', () => !document.querySelector('.loading-screen'));

log('=== 2. Singleplayer -> Select World ===');
await clickRect(await titleButton('singleplayer'));
await waitFor('SelectWorldScreen', () => {
  const s = window.__mc.screens.current;
  return s && s.constructor.name === 'SelectWorldScreen' ? true : null;
});
check('singleplayer opens world list', (await screenName()) === 'SelectWorldScreen');
await waitFor('world list loaded', () => window.__mc.screens.current.isLoaded);
const worldCount = await ev(() => window.__mc.screens.current.worlds.length);
check('world list has at least one world', worldCount >= 1, `worlds=${worldCount}`);
await sleep(600);
await page.screenshot({ path: `${outDir}/02-select-world.png` });

log('=== 3. select first world + Play ===');
const listRect = await ev(() => {
  const s = window.__mc.screens.current;
  const r = s.list.constructor === undefined ? null : s.list.getRect ? s.list.getRect() : null;
  return r ? { x: r.x, y: r.y, width: r.width, height: r.height } : null;
});
if (!listRect) throw new Error('world list has no getRect()');
// first entry: 36px tall, starts at list top
await page.mouse.click((listRect.x + 40) * (await ev(() => window.__mc.screens.guiScale)),
  (listRect.y + 18) * (await ev(() => window.__mc.screens.guiScale)));
await sleep(300);
const playRect = await ev(() => {
  const b = window.__mc.screens.current.playButton.getRect();
  return { x: b.x, y: b.y, width: b.width, height: b.height };
});
check('play button enabled after selecting', await ev(() => window.__mc.screens.current.playButton.active));
await clickRect(playRect);
await waitFor('back in world', () => window.__mc.screens.current === null, 15000);
check('Play enters the world', (await screenName()) === null);
await sleep(2500);
await page.screenshot({ path: `${outDir}/03-in-world.png` });

log('=== 4. Esc -> pause -> Save and Quit to Title ===');
await page.keyboard.press('Escape');
await waitFor('PauseScreen', () => {
  const s = window.__mc.screens.current;
  return s && s.constructor.name === 'PauseScreen' ? true : null;
});
check('Escape opens the pause menu', (await screenName()) === 'PauseScreen');
await sleep(400);
await page.screenshot({ path: `${outDir}/04-pause.png` });
const quitRect = await ev(() => {
  const s = window.__mc.screens.current;
  const buttons = s.children
    .filter((c) => typeof c.getRect === 'function')
    .map((c) => c.getRect())
    .filter((r) => r.width > 190 && r.y > 120);
  const last = buttons.sort((a, b) => b.y - a.y)[0];
  return last ? { x: last.x, y: last.y, width: last.width, height: last.height } : null;
});
if (!quitRect) throw new Error('could not find the Save and Quit to Title button');
await clickRect(quitRect);
await waitFor('title after quit', () => {
  const s = window.__mc.screens.current;
  return s && s.constructor.name === 'TitleScreen' ? true : null;
});
check('quit to title works', (await screenName()) === 'TitleScreen');
await sleep(1500);
await page.screenshot({ path: `${outDir}/05-title-after-quit.png` });

log('=== 5. Play the same world again (no reload) ===');
await clickRect(await titleButton('singleplayer'));
await waitFor('SelectWorldScreen 2', () => {
  const s = window.__mc.screens.current;
  return s && s.constructor.name === 'SelectWorldScreen' ? true : null;
});
await waitFor('world list 2', () => window.__mc.screens.current.isLoaded);
await sleep(400);
const again = await ev(() => {
  const s = window.__mc.screens.current;
  const r = s.list.getRect();
  return { x: r.x, y: r.y };
});
const scale2 = await ev(() => window.__mc.screens.guiScale);
await page.mouse.click((again.x + 40) * scale2, (again.y + 18) * scale2);
await sleep(250);
await clickRect(await ev(() => {
  const b = window.__mc.screens.current.playButton.getRect();
  return { x: b.x, y: b.y, width: b.width, height: b.height };
}));
await waitFor('in world again', () => window.__mc.screens.current === null, 15000);
check('re-entering the in-memory world is instant', (await screenName()) === null);

log('=== 6. ?play boots straight into the world ===');
await page.goto(`${base}/?play`, { waitUntil: 'domcontentloaded', timeout: 90000 });
await waitFor('__mc 2', () => !!window.__mc);
await waitFor('in world with ?play', () => {
  const m = window.__mc;
  if (!m || !m.level) return null;
  return m.screens.current === null && m.level.chunks.size > 0 ? true : null;
});
check('?play skips the title screen', (await screenName()) === null);
await sleep(1500);
await page.screenshot({ path: `${outDir}/06-play-direct.png` });

const state = await page.evaluate(() => ({
  chunks: window.__mc.level.chunks.size,
  gamemode: window.__mc.options.gamemode,
  worldId: window.__mc.currentWorldId ?? null,
  errors: window.__mc.screens.current,
}));
console.log('state:', JSON.stringify(state));
check('no page errors', errors.length === 0, errors.slice(0, 4).join(' | '));

console.log(`\n${failures === 0 ? 'ALL PASS' : `${failures} FAILURES`}`);
await browser.close();
process.exit(failures === 0 ? 0 : 1);

function log(msg) { console.log(msg); }
