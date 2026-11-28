// Browser regression test for Options.FRAMERATE_LIMIT:
//
//   * the video-setting maxFps value really caps rendered frames (it used to be
//     a dead UI option, so the game always ran at the display refresh rate);
//   * the 20 Hz simulation keeps running on skipped render frames;
//   * a cap above the display refresh is still bounded by vsync.
//
//   node scripts/test-fps-limit.mjs [--url http://127.0.0.1:5174]
import { chromium } from 'playwright';
import { launchOptions } from './lib/browser.mjs';
import { prepareStage } from './lib/stage.mjs';

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

/** Counts actual 3D render passes (Game.render is skipped on throttled frames). */
async function sample(page, seconds) {
  return page.evaluate(async (sec) => {
    const m = window.__mc;
    if (!window.__renderProbe) {
      window.__renderProbe = { count: 0 };
      const orig = m.renderer.render.bind(m.renderer);
      m.renderer.render = (...a) => {
        window.__renderProbe.count++;
        return orig(...a);
      };
    }
    window.__renderProbe.count = 0;
    const start = performance.now();
    const tickStart = m.entityManager.getGameTime();
    await new Promise((resolve) => setTimeout(resolve, sec * 1000));
    const elapsed = performance.now() - start;
    return {
      renders: window.__renderProbe.count,
      renderFps: window.__renderProbe.count / (elapsed / 1000),
      ticks: m.entityManager.getGameTime() - tickStart,
      hudFps: m.fps,
    };
  }, seconds);
}

try {
  await page.goto(`${base}/?play&perf=0`, { waitUntil: 'domcontentloaded', timeout: 120000 });
  await page.waitForFunction(() => window.__mc?.running === true, null, { timeout: 120000 });
  await sleep(1200);
  await prepareStage(page, { radius: 12, floor: 'stone', time: 6000 });
  await sleep(500);

  const refresh = await sample(page, 2);
  check('an uncapped window is bounded by the display refresh',
    refresh.renderFps > 40 && refresh.renderFps <= 75, refresh);

  const capped30 = await ev(() => { window.__mc.options.maxFps = 30; return window.__mc.options.maxFps; });
  const at30 = await sample(page, 3);
  check('maxFps=30 caps rendered frames near 30',
    at30.renderFps >= 24 && at30.renderFps <= 36, { capped30, ...at30 });
  check('the 20 Hz simulation still runs while renders are skipped',
    at30.ticks >= 54 && at30.ticks <= 66, at30);
  check('the HUD fps counter reports the capped render rate',
    at30.hudFps >= 24 && at30.hudFps <= 36, { hudFps: at30.hudFps });

  await ev(() => { window.__mc.options.maxFps = 120; });
  const at120 = await sample(page, 3);
  check('maxFps=120 is capped by the 60 Hz headless display, not by the option',
    at120.renderFps >= 50 && at120.renderFps <= 70, at120);
  check('the simulation keeps ticking at maxFps=120',
    at120.ticks >= 54 && at120.ticks <= 66, at120);

  await ev(() => { window.__mc.options.maxFps = 240; });
  const at240 = await sample(page, 2);
  check('maxFps above the refresh rate does not uncap rendering',
    at240.renderFps >= 45 && at240.renderFps <= 75, at240);
} catch (err) {
  console.log('ERROR', err);
  results.push({ name: 'probe', ok: false });
} finally {
  console.log('');
  console.log(`Total: ${results.filter((x) => x.ok).length}/${results.length} PASS`);
  await browser.close();
  process.exit(results.every((x) => x.ok) ? 0 : 1);
}
