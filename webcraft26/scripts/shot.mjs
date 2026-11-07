// Headless screenshot + console capture harness.
// Usage: node scripts/shot.mjs [url] [outFile] [waitMs]

import { chromium } from 'playwright';
import { launchOptions } from './lib/browser.mjs';

const url = process.argv[2] ?? 'http://127.0.0.1:5174/?play';
const out = process.argv[3] ?? 'shots/shot.png';
const waitMs = Number(process.argv[4] ?? 25000);

const browser = await chromium.launch(launchOptions());
const page = await browser.newPage({ viewport: { width: 1280, height: 720 }, deviceScaleFactor: 1 });

const logs = [];
page.on('console', (msg) => logs.push(`[${msg.type()}] ${msg.text()}`));
page.on('pageerror', (err) => logs.push(`[pageerror] ${err.message}\n${err.stack ?? ''}`));

await page.goto(url, { waitUntil: 'domcontentloaded', timeout: 60000 });

// poll for the client to report readiness or failure
const deadline = Date.now() + waitMs;
let state = 'loading';
while (Date.now() < deadline) {
  state = await page.evaluate(() => {
    const w = window;
    if (w.__mc) return 'ready';
    const status = document.getElementById('loading-status');
    if (status && status.textContent?.startsWith('Load failed')) return 'failed';
    return 'loading';
  });
  if (state !== 'loading') break;
  await page.waitForTimeout(500);
}

const pre = process.env.SHOT_EVAL;
if (state === 'ready' && pre) {
  try {
    const r = await page.evaluate(pre);
    console.log('eval:', JSON.stringify(r));
  } catch (e) {
    console.log('eval failed:', e.message);
  }
  await page.waitForTimeout(1500);
}

if (state === 'ready') {
  // let a few frames render and chunks stream in
  await page.waitForTimeout(4000);
}

const statusText = await page.evaluate(() => {
  const mc = window.__mc;
  const info = {
    status: document.getElementById('loading-status')?.textContent ?? '',
    time: mc?.level?.time,
    player: mc?.player?.pos,
    sections: mc?.renderer?.meshStats,
    chunks: mc?.level?.chunks?.size,
    glError: mc?.gl?.getError?.(),
  };
  return JSON.stringify(info);
});
await page.screenshot({ path: out, fullPage: false });

console.log('state:', state);
console.log('status:', statusText);
console.log('--- console ---');
for (const line of logs.slice(-60)) console.log(line);

await browser.close();
