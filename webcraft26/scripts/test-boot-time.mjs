// Boot-time probe: reports every Game.onStatus stage (__bootTimings), the save restore
// line and the time from navigation start to `window.__mc.running`.
//
//   node scripts/test-boot-time.mjs [--url http://127.0.0.1:5174] [--runs 2]
import { chromium } from 'playwright';
import { launchOptions } from './lib/browser.mjs';

const args = process.argv.slice(2);
const urlArg = args.indexOf('--url');
const base = urlArg >= 0 ? args[urlArg + 1] : 'http://127.0.0.1:5174';
const runsArg = args.indexOf('--runs');
const runs = runsArg >= 0 ? Math.max(1, Number(args[runsArg + 1]) || 1) : 1;

const browser = await chromium.launch(launchOptions());
const results = [];
const check = (name, ok, detail) => {
  results.push({ name, ok });
  console.log(`${ok ? 'PASS' : 'FAIL'} ${name}${detail === undefined ? '' : ' :: ' + JSON.stringify(detail)}`);
};

for (let run = 1; run <= runs; run++) {
  const page = await (await browser.newContext({ viewport: { width: 1280, height: 720 } })).newPage();
  const saveLines = [];
  page.on('console', (m) => { if (m.text().startsWith('[save]')) saveLines.push(m.text()); });
  const t0 = Date.now();
  await page.goto(`${base}/?play&perf=0`, { waitUntil: 'domcontentloaded', timeout: 120000 });
  await page.waitForFunction(() => window.__mc?.running === true, null, { timeout: 180000 });
  const readyMs = Date.now() - t0;
  const timings = await page.evaluate(() => window.__bootTimings ?? []);
  const last = timings[timings.length - 1]?.at ?? 0;
  const restoreLine = saveLines.find((l) => l.includes('saved chunks near the player')) ?? '';
  const m = /restored (\d+)\/(\d+) saved chunks near the player in (\d+) ms/.exec(restoreLine);
  const restore = m ? { decoded: Number(m[1]), saved: Number(m[2]), ms: Number(m[3]) } : null;
  console.log(`[run ${run}] ready ${readyMs} ms | bootTimings ${last} ms | ${restoreLine || 'no saved chunks'}`);
  if (run === 1) {
    console.log(timings.map((t) => `${t.stage} ${t.at}ms`).join(' | '));
    check('boot reaches the world without decoding the whole save', readyMs < 15000, { readyMs });
    check('the synchronous save restore stays small (<=5x5 chunks)',
      restore === null || restore.decoded <= 25, restore);
    check('the save restore itself is fast', restore === null || restore.ms < 1500, restore);
  }
  await page.close();
}

const failed = results.filter((r) => !r.ok).length;
console.log(`\n${results.length - failed}/${results.length} checks passed`);
await browser.close();
if (failed > 0) process.exitCode = 1;
