// Performance audit for the web client: boot time, frame pacing, CPU/GPU attribution.
//
// Why this exists: "25 fps and movement feels rough" can come from three completely different
// places, and they need different fixes:
//   1. GPU-bound   -> frame time scales with resolution / post chain settings.
//   2. CPU-bound   -> frame time is flat when resolution drops, but A/B toggles move it.
//   3. Streaming   -> the average fps looks fine but p95/p99 spikes whenever chunks arrive.
// This script separates those three cases with numbers instead of guesses.
//
// Usage (dev server must be running: `npm run dev`):
//   node scripts/perf-audit.mjs                 # boot + idle + walk + draw calls + CPU passes
//   node scripts/perf-audit.mjs --full          # + feature A/B matrix (shaders/shadows/post/taa)
//   node scripts/perf-audit.mjs --json out.json # machine-readable record for before/after diffs
//   node scripts/perf-audit.mjs --sprint        # hold W+Ctrl and report long frames while moving
//
// Environment:
//   URL=http://127.0.0.1:5174/?play  W=1280 H=720 DSF=1  CHROME_PATH=...  GL_MODE=gpu|swiftshader
//
// What to look at:
//   * `idle p95`   should stay under ~1.5x the refresh interval; higher means periodic hitches
//                  (mesh work, drain, GC, layout) even when nothing moves.
//   * `walk p95`   minus `idle p95` is the cost of streaming; >20 ms extra = chunk apply/mesh spikes.
//   * `gpuFrameMs` vs `cpuFrameMs`: whichever is ~= the real frame interval is the bottleneck.
//   * `draws`      > ~400/frame means batching regressed (regions should keep it near 100).
import { chromium } from 'playwright';
import fs from 'node:fs';
import { launchOptions } from './lib/browser.mjs';

const args = process.argv.slice(2);
const FULL = args.includes('--full');
const SPRINT = args.includes('--sprint');
const jsonAt = args.indexOf('--json');
const jsonOut = jsonAt >= 0 ? args[jsonAt + 1] : null;

const URL = process.env.URL ?? 'http://127.0.0.1:5174/?play';
const W = +(process.env.W ?? 1280);
const H = +(process.env.H ?? 720);
const DSF = +(process.env.DSF ?? 1);

const pad = (s, n) => String(s).padEnd(n);
const num = (v, n = 1) => (typeof v === 'number' ? v.toFixed(n) : String(v));

async function openPage(browser) {
  const ctx = await browser.newContext({ viewport: { width: W, height: H }, deviceScaleFactor: DSF });
  const page = await ctx.newPage();
  const t0 = Date.now();
  await page.goto(URL, { waitUntil: 'load', timeout: 240000 });
  await page.waitForFunction(() => !!window.__mc?.running, null, { timeout: 300000 });
  const bootWallMs = Date.now() - t0;
  return { ctx, page, bootWallMs };
}

/** Installs the in-page instrumentation once; all later calls are cheap. */
async function install(page) {
  await page.evaluate(() => {
    const mc = window.__mc;
    const gl = mc.gl;
    const acc = {};
    const wrap = (obj, name, key) => {
      const orig = obj[name].bind(obj);
      acc[key] = acc[key] ?? { ms: 0, n: 0 };
      obj[name] = (...a) => {
        const t = performance.now();
        const r = orig(...a);
        const a2 = acc[key];
        a2.ms += performance.now() - t;
        a2.n++;
        return r;
      };
    };
    wrap(mc.renderer, 'update', 'mesh');
    wrap(mc.chunkProvider, 'drain', 'drain');
    wrap(mc.renderer.post, 'endScene', 'post');
    wrap(mc.entityRenderer, 'render', 'entities');
    wrap(mc.skyRenderer, 'render', 'sky');
    wrap(mc.cloudRenderer, 'render', 'clouds');
    wrap(mc.weatherRenderer, 'render', 'weather');
    wrap(mc.particles, 'render', 'particles');
    wrap(mc, 'renderHud', 'hud');

    const stats = { frames: 0, draws: 0, cpu: 0 };
    const od = gl.drawElements.bind(gl), oa = gl.drawArrays.bind(gl);
    gl.drawElements = (...a) => { stats.draws++; return od(...a); };
    gl.drawArrays = (...a) => { stats.draws++; return oa(...a); };

    // GPU timer: one EXT_disjoint_timer_query_webgl2 query around beginScene..endScene.
    const ext = gl.getExtension('EXT_disjoint_timer_query_webgl2');
    const gpu = { samples: [], pending: 0, error: null };
    if (ext) {
      let pool = [];
      for (let i = 0; i < 6; i++) pool.push(gl.createQuery());
      const inFlight = [];
      let current = null;
      const beginScene = mc.renderer.beginScene.bind(mc.renderer);
      const endScene = mc.renderer.endScene.bind(mc.renderer);
      mc.renderer.beginScene = (...a) => {
        const r = beginScene(...a);
        try {
          // collect finished queries
          for (let i = inFlight.length - 1; i >= 0; i--) {
            const q = inFlight[i];
            if (gl.getQueryParameter(q, gl.QUERY_RESULT_AVAILABLE)) {
              gpu.samples.push(gl.getQueryParameter(q, gl.QUERY_RESULT) / 1e6);
              inFlight.splice(i, 1);
              pool.push(q);
            }
          }
          if (current === null && pool.length > 0) {
            current = pool.pop();
            gl.beginQuery(ext.TIME_ELAPSED_EXT, current);
          }
        } catch (e) { gpu.error = String(e); }
        return r;
      };
      mc.renderer.endScene = (...a) => {
        const r = endScene(...a);
        try {
          if (current !== null) {
            gl.endQuery(ext.TIME_ELAPSED_EXT);
            inFlight.push(current);
            current = null;
          }
        } catch (e) { gpu.error = String(e); }
        return r;
      };
    }

    window.__audit = {
      acc, stats, gpu,
      reset() {
        for (const k of Object.keys(acc)) { acc[k].ms = 0; acc[k].n = 0; }
        stats.frames = 0; stats.draws = 0; stats.cpu = 0;
        gpu.samples.length = 0;
      },
      get extAvailable() { return !!ext; },
    };
  });
}

/** Measures frame intervals (and the instrumented aggregates) for `ms`. */
async function measure(page, ms) {
  return page.evaluate((ms) => new Promise((res) => {
    const a = window.__audit;
    a.reset();
    const dt = [];
    let last = performance.now();
    const t0 = last;
    function loop() {
      const now = performance.now();
      dt.push(now - last);
      last = now;
      if (now - t0 < ms) { requestAnimationFrame(loop); return; }
      const s = [...dt].sort((x, y) => x - y);
      const q = (p) => s[Math.min(s.length - 1, Math.floor(p * s.length))];
      const frames = s.length;
      const secs = (now - t0) / 1000;
      const cpu = {};
      for (const [k, v] of Object.entries(a.acc)) cpu[k] = +(v.ms / Math.max(1, v.n)).toFixed(2);
      const g = a.gpu.samples.slice().sort((x, y) => x - y);
      res({
        fps: +(frames / secs).toFixed(1),
        p50: +q(0.5).toFixed(1),
        p95: +q(0.95).toFixed(1),
        p99: +q(0.99).toFixed(1),
        max: +Math.max(...dt, 0).toFixed(1),
        longFrames: dt.filter((v) => v > 25).length,
        frames,
        drawsPerFrame: Math.round(a.stats.draws / frames),
        cpu,
        gpuMs: g.length ? +g[Math.floor(g.length / 2)].toFixed(2) : null,
        gpuP95: g.length ? +g[Math.floor(g.length * 0.95)].toFixed(2) : null,
        gpuSamples: g.length,
      });
    }
    requestAnimationFrame(loop);
  }), ms);
}

/** Walks (or sprints) forward for a while so streaming/meshing is active. */
async function walk(page, seconds, sprint) {
  await page.evaluate((sprint) => {
    window.dispatchEvent(new KeyboardEvent('keydown', { code: 'KeyW' }));
    if (sprint) window.dispatchEvent(new KeyboardEvent('keydown', { code: 'ControlLeft' }));
  }, sprint);
  await page.waitForTimeout(seconds * 1000);
  const m = await measure(page, 3000);
  await page.evaluate(() => {
    window.dispatchEvent(new KeyboardEvent('keyup', { code: 'KeyW' }));
    window.dispatchEvent(new KeyboardEvent('keyup', { code: 'ControlLeft' }));
  });
  return m;
}

/** Waits until the chunk stream + mesh backlog are empty (otherwise p95 measures streaming, not the variant). */
async function settle(page, maxSeconds = 60) {
  const t0 = Date.now();
  let quiet = 0;
  while (Date.now() - t0 < maxSeconds * 1000) {
    const busy = await page.evaluate(() => ({
      mesh: window.__mc.renderer.meshStats.count > 0,
      queue: (window.__mc.chunkProvider?.queueLength ?? 0) > 0,
    }));
    quiet = !busy.mesh && !busy.queue ? quiet + 1 : 0;
    if (quiet >= 4) return true;
    await page.waitForTimeout(500);
  }
  return false;
}

const browser = await chromium.launch(launchOptions());
const { page, bootWallMs } = await openPage(browser);

// let the spawn ring finish streaming before the baseline
await settle(page);
await page.waitForTimeout(1200);
await install(page);

const boot = await page.evaluate(() => {
  const t = window.__bootTimings ?? [];
  let prev = 0;
  const rows = [];
  for (const e of t) {
    if (/^Generating terrain \d/.test(e.stage)) { prev = e.at; continue; }
    rows.push({ stage: e.stage, at: +e.at.toFixed(0), delta: +(e.at - prev).toFixed(0) });
    prev = e.at;
  }
  return rows;
});
const gl = await page.evaluate(() => {
  const g = window.__mc.gl;
  const dbg = g.getExtension('WEBGL_debug_renderer_info');
  return {
    renderer: dbg ? g.getParameter(dbg.UNMASKED_RENDERER_WEBGL) : 'n/a',
    drawingBuffer: [g.drawingBufferWidth, g.drawingBufferHeight],
    gpuTimer: window.__audit.extAvailable,
  };
});

const idle = await measure(page, 3000);
const walking = await walk(page, 4, SPRINT);

const rows = [];
const push = (label, m) => rows.push({ label, ...m });
push('idle', idle);
push(SPRINT ? 'walk+sprint' : 'walk', walking);

if (FULL) {
  const variants = [
    ['shadows off', () => { window.__mc.renderer.post.shadowsEnabled = false; }],
    ['taa off', () => { window.__mc.renderer.post.taaOff = true; }],
    ['ssao off', () => { window.__mc.renderer.post.ssaoStrength = 0; }],
    ['post low', () => { window.__mc.setShaderQuality('low'); }],
    ['post medium', () => { window.__mc.setShaderQuality('medium'); }],
    ['shaders off', () => { window.__mc.setShaders(false); }],
    // Resolution is the only knob whose GPU cost is linear in pixels: if this row is much faster
    // than `idle`, the frame is GPU fill-bound and the fix is the render scale, not a pass.
    ['scale 70%', () => { window.__mc.setRenderScale(0.7); }],
    ['scale 50%', () => { window.__mc.setRenderScale(0.5); }],
  ];
  for (const [label, fn] of variants) {
    // Fresh page per variant: the previous variant must not leak into the next measurement, and
    // the world has to be fully streamed again (a streaming page reports p95 spikes of its own).
    await page.reload({ waitUntil: 'load' });
    await page.waitForFunction(() => !!window.__mc?.running, null, { timeout: 300000 });
    await settle(page);
    await page.waitForTimeout(1000);
    await install(page);
    await page.evaluate(fn);
    await page.waitForTimeout(900);
    push(label, await measure(page, 2500));
  }
}

// ---------------- report ----------------
console.log(`\n=== webcraft26 perf audit ===`);
console.log(`gpu      ${gl.renderer}`);
console.log(`buffer   ${gl.drawingBuffer[0]}x${gl.drawingBuffer[1]} (viewport ${W}x${H} @${DSF}x)  gpu-timer ${gl.gpuTimer ? 'yes' : 'no'}`);
console.log(`boot     ${bootWallMs} ms (navigate -> first frame)`);
const slow = boot.slice().sort((a, b) => b.delta - a.delta).slice(0, 5);
console.log(`boot top ${slow.map((b) => `${b.stage} ${b.delta}ms`).join(' | ')}`);

console.log(`\n${pad('case', 14)}${pad('fps', 7)}${pad('p50', 7)}${pad('p95', 7)}${pad('p99', 7)}${pad('max', 7)}${pad('>25ms', 8)}${pad('draws', 7)}${pad('gpu p50', 9)}gpu p95`);
for (const r of rows) {
  console.log(
    pad(r.label, 14) + pad(num(r.fps), 7) + pad(num(r.p50), 7) + pad(num(r.p95), 7) + pad(num(r.p99), 7)
    + pad(num(r.max), 7) + pad(r.longFrames, 8) + pad(r.drawsPerFrame, 7)
    + pad(num(r.gpuMs, 2), 9) + num(r.gpuP95, 2),
  );
}

const cpu = walking.cpu;
const cpuTotal = Object.entries(cpu).sort((a, b) => b[1] - a[1]);
console.log(`\nCPU per frame while walking (main thread, ms):  ${cpuTotal.map(([k, v]) => `${k} ${v}`).join(' | ')}`);
console.log(`frames: idle ${idle.frames}, walk ${walking.frames}; gpu samples ${walking.gpuSamples}` +
  (walking.gpuSamples === 0 && gl.gpuTimer ? ' (timer extension present but no result: the driver refused queries)' : ''));

if (jsonOut) {
  fs.writeFileSync(jsonOut, JSON.stringify({ when: new Date().toISOString(), gl, bootWallMs, boot, rows, cpu }, null, 2));
  console.log(`\nwrote ${jsonOut}`);
}
await browser.close();
