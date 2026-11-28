// Browser regression test for the shimmer-related video options:
//
//   * TAA and vegetation sway default to off, dynamic resolution defaults to on;
//   * the video settings screen exposes switches for all three and they reach the
//     live renderer immediately.
//
//   node scripts/test-video-toggles.mjs [--url http://127.0.0.1:5174]
import { chromium } from 'playwright';
import { launchOptions } from './lib/browser.mjs';
import { prepareStage } from './lib/stage.mjs';

const args = process.argv.slice(2);
const urlArg = args.indexOf('--url');
const base = urlArg >= 0 ? args[urlArg + 1] : 'http://127.0.0.1:5174';

const browser = await chromium.launch(launchOptions());
const page = await (await browser.newContext({ viewport: { width: 1000, height: 700 } })).newPage();
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
  await sleep(1000);
  await prepareStage(page, { radius: 8, floor: 'stone' });

  const defaults = await ev(() => {
    const m = window.__mc;
    return {
      taa: m.options.taa,
      dynamicResolution: m.options.dynamicResolution,
      vegetationSway: m.options.vegetationSway,
      taaOff: m.renderer.post.taaOff,
      sway: m.renderer.swayEnabled,
    };
  });
  check('TAA and vegetation sway default off, dynamic resolution defaults on',
    defaults.taa === false && defaults.vegetationSway === false
    && defaults.dynamicResolution === true && defaults.taaOff === true && defaults.sway === false,
    defaults);

  const opened = await ev(() => {
    const m = window.__mc;
    m.screens.open('video');
    const s = m.screens.current;
    const labels = s.children
      .filter((c) => c.constructor?.name === 'Checkbox')
      .map((c) => c.message);
    return { screen: s?.constructor?.name, labels };
  });
  const has = (needle) => opened.labels.some((l) => String(l).includes(needle));
  check('the video settings screen exposes TAA / dynamic-resolution / sway switches',
    opened.screen === 'VideoSettingsScreen'
    && has('TAA') && has('动态分辨率') && has('植被摆动'), opened);

  const toggled = await ev(() => {
    const s = window.__mc.screens.current;
    const m = window.__mc;
    const find = (needle) => s.children.find(
      (c) => c.constructor?.name === 'Checkbox' && String(c.message).includes(needle),
    );
    const taa = find('TAA');
    const sway = find('植被摆动');
    const dynamic = find('动态分辨率');
    taa?.setSelected(true);
    sway?.setSelected(true);
    dynamic?.setSelected(false);
    return {
      taaOff: m.renderer.post.taaOff,
      sway: m.renderer.swayEnabled,
      dynamic: m.options.dynamicResolution,
      taaSelected: taa?.selected,
      swaySelected: sway?.selected,
    };
  });
  check('toggling the switches reaches the live renderer',
    toggled.taaOff === false && toggled.sway === true
    && toggled.dynamic === false && toggled.taaSelected === true && toggled.swaySelected === true,
    toggled);

  await ev(() => { window.__mc.screens.close(); });
  await page.screenshot({ path: 'shots/diag/video-options.png' });
} catch (err) {
  console.log('ERROR', err);
  results.push({ name: 'probe', ok: false });
} finally {
  console.log('');
  console.log(`Total: ${results.filter((x) => x.ok).length}/${results.length} PASS`);
  await browser.close();
  process.exit(results.every((x) => x.ok) ? 0 : 1);
}
