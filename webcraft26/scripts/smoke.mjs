// Regression smoke harness + crash bisect for the Minecraft 26.2 browser client.
//
//   node scripts/smoke.mjs                                  full matrix, keeps going after failures
//   node scripts/smoke.mjs --only fly                       one scene only
//   node scripts/smoke.mjs --bisect                         stop at the first failing scene, dump context
//   node scripts/smoke.mjs --url http://127.0.0.1:5174/?play --out shots/smoke
//
// Does not touch src/ or public/. Only playwright + pngjs.

import { chromium } from 'playwright';
import { PNG } from 'pngjs';
import { chromePath, GL_ARGS } from './lib/browser.mjs';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(fileURLToPath(new URL('..', import.meta.url)));

// ---------------------------------------------------------------------- args

function parseArgs(argv) {
  // ?play: the client now boots into the title screen; the smoke scenes need the world directly.
  const out = { url: 'http://127.0.0.1:5174/?play', out: 'shots/smoke', only: null, bisect: false };
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a === '--url') out.url = argv[++i];
    else if (a === '--out') out.out = argv[++i];
    else if (a === '--only') out.only = argv[++i];
    else if (a === '--bisect') out.bisect = true;
    else if (a === '--help' || a === '-h') {
      console.log('usage: node scripts/smoke.mjs [--url <url>] [--out <dir>] [--only <name|NN>] [--bisect]');
      process.exit(0);
    } else console.warn(`[smoke] ignoring unknown arg ${a}`);
  }
  out.outDir = path.resolve(ROOT, out.out);
  return out;
}

const ARGS = parseArgs(process.argv.slice(2));

// ------------------------------------------------------------------- helpers

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const nowIso = () => new Date().toISOString().replace('T', ' ').slice(0, 19);

function withTimeout(promise, ms, label) {
  const p = Promise.resolve(promise);
  p.catch(() => {}); // never let the loser trip an unhandled rejection
  let timer;
  const guard = new Promise((_, rej) => {
    timer = setTimeout(() => rej(new Error(`${label} 超时 (${ms}ms)`)), ms);
  });
  return Promise.race([p, guard]).finally(() => clearTimeout(timer));
}

const rel = (p) => path.relative(ROOT, p).split(path.sep).join('/');

function analyzePng(file) {
  try {
    const png = PNG.sync.read(fs.readFileSync(file));
    const total = png.width * png.height;
    const step = Math.max(1, Math.floor(total / 6000));
    let sum = 0;
    let n = 0;
    for (let i = 0; i < png.data.length; i += 4 * step) {
      sum += 0.2126 * png.data[i] + 0.7152 * png.data[i + 1] + 0.0722 * png.data[i + 2];
      n++;
    }
    return { w: png.width, h: png.height, luma: n ? +(sum / n).toFixed(1) : null };
  } catch {
    return null;
  }
}

// ------------------------------------------------------------------ harness

const startedAt = nowIso();
const startMs = Date.now();

/** @type {Array<{i:number,at:number,kind:string,level:string,text:string,stack?:string,url?:string}>} */
const events = [];
const uaErrors = []; // in-page window.onerror / unhandledrejection (mirrored here for ordering)

let browser = null;
let page = null;
let webglMode = 'swiftshader';
let bootResult = { state: 'unknown', ms: 0 };
let unresponsive = false;

fs.mkdirSync(ARGS.outDir, { recursive: true });
const reportPath = path.join(ARGS.outDir, 'report.json');

function record(kind, level, text, extra = {}) {
  events.push({ i: events.length, at: Date.now() - startMs, kind, level, text: String(text ?? ''), ...extra });
}

function attachPage(p) {
  p.on('console', (msg) => {
    const type = msg.type();
    const text = msg.text();
    if (type !== 'error' && type !== 'warning') return;
    const isResource = /^Failed to load resource/i.test(text);
    record(isResource ? 'network' : 'console', type, text, { loc: msg.location() });
  });
  p.on('pageerror', (err) => {
    record('pageerror', 'error', err.message, { stack: err.stack });
  });
  p.on('requestfailed', (req) => {
    record('requestfailed', 'error', `${req.failure()?.errorText ?? 'failed'} ${req.url()}`, { url: req.url() });
  });
  p.on('response', (res) => {
    if (res.status() >= 400) record('http', 'error', `${res.status()} ${res.url()}`, { url: res.url() });
  });
  p.on('crash', () => record('crash', 'error', 'renderer process crashed'));
}

async function installHooks(p) {
  await p.addInitScript(() => {
    const bucket = { errors: [], rejections: [], glErrors: [], ready: false };
    window.__smoke = bucket;
    window.addEventListener('error', (e) => {
      bucket.errors.push({
        t: performance.now(),
        msg: String(e.message ?? (e.error && e.error.message) ?? 'unknown'),
        stack: e.error && e.error.stack ? String(e.error.stack) : null,
        src: e.filename ? `${e.filename}:${e.lineno}` : null,
      });
    });
    window.addEventListener('unhandledrejection', (e) => {
      const r = e.reason;
      bucket.rejections.push({
        t: performance.now(),
        msg: String((r && r.message) ?? r ?? 'unknown'),
        stack: r && r.stack ? String(r.stack) : null,
      });
    });
  });
}

function startGlPolling() {
  return page
    .evaluate(() => {
      const s = window.__smoke;
      if (!s || s.glPoll) return false;
      s.glPoll = setInterval(() => {
        const gl = window.__mc && window.__mc.gl;
        if (!gl || typeof gl.getError !== 'function') return;
        try {
          const code = gl.getError();
          if (code) s.glErrors.push({ t: Math.round(performance.now()), code });
        } catch (e) {
          s.glErrors.push({ t: Math.round(performance.now()), code: -999, text: String(e && e.message) });
        }
      }, 250);
      return true;
    })
    .catch(() => false);
}

async function launch(mode) {
  const args = [...GL_ARGS, '--enable-precise-memory-info'];
  const b = await chromium.launch({ headless: process.env.SMOKE_HEADED !== '1', args, executablePath: chromePath() });
  const p = await b.newPage({ viewport: { width: 1280, height: 720 }, deviceScaleFactor: 1 });
  return { b, p };
}

/** True when the page can hand out a WebGL2 context at all. */
async function hasWebgl2(p) {
  try {
    return await withTimeout(
      p.evaluate(() => {
        const c = document.createElement('canvas');
        const gl = c.getContext('webgl2');
        return !!gl;
      }),
      15000,
      'webgl2 probe',
    );
  } catch {
    return false;
  }
}

async function waitReady(timeoutMs) {
  const t0 = Date.now();
  while (Date.now() - t0 < timeoutMs) {
    let st;
    try {
      st = await withTimeout(
        page.evaluate(() => {
          if (window.__mc) return 'ready';
          const s = document.getElementById('loading-status');
          const txt = s && s.textContent ? s.textContent : '';
          if (txt.startsWith('Load failed')) return `failed:${txt}`;
          return 'loading';
        }),
        8000,
        'ready probe',
      );
    } catch (e) {
      st = 'eval-timeout';
    }
    if (st === 'ready' || st.startsWith('failed')) return { state: st, ms: Date.now() - t0 };
    await sleep(500);
  }
  return { state: 'timeout', ms: Date.now() - t0 };
}

// --------------------------------------------------------------- page probes

const ev = (fn, arg) => withTimeout(page.evaluate(fn, arg), 10000, 'page.evaluate');

async function probe() {
  return ev(() => {
    const mc = window.__mc;
    if (!mc) return { ready: false };
    const p = mc.player;
    const pos = p && p.pos;
    const fin = (v) => typeof v === 'number' && Number.isFinite(v);
    let glError = null;
    try {
      glError = mc.gl && typeof mc.gl.getError === 'function' ? mc.gl.getError() : null;
    } catch (e) {
      glError = -999;
    }
    const cur = mc.screens && mc.screens.current;
    const mem = performance.memory;
    return {
      ready: true,
      pos: pos ? [pos.x, pos.y, pos.z] : null,
      posNaN: pos ? !(fin(pos.x) && fin(pos.y) && fin(pos.z)) : true,
      vel: p && p.vel ? [p.vel.x, p.vel.y, p.vel.z] : null,
      flying: p ? !!p.flying : null,
      onGround: p ? !!p.onGround : null,
      yaw: p && fin(p.yaw) ? p.yaw : null,
      pitch: p && fin(p.pitch) ? p.pitch : null,
      chunk: pos ? [Math.floor(pos.x) >> 4, Math.floor(pos.z) >> 4] : null,
      chunks: mc.level && mc.level.chunks ? mc.level.chunks.size : null,
      mesh: mc.renderer && mc.renderer.meshStats ? mc.renderer.meshStats : null,
      fps: typeof mc.fps === 'number' ? mc.fps : null,
      glError,
      glErrors: window.__smoke ? window.__smoke.glErrors.length : null,
      queue: mc.chunkProvider ? mc.chunkProvider.queueLength : null,
      inflight: mc.chunkProvider ? mc.chunkProvider.inflight : null,
      workers: mc.chunkProvider ? !!mc.chunkProvider.usingWorkers : null,
      entities: mc.entityManager && mc.entityManager.getEntities ? mc.entityManager.getEntities().length : null,
      screensWired: !!mc.screens,
      screen: cur ? cur.getTitle && cur.getTitle() : null,
      screenClass: cur ? (cur.constructor && cur.constructor.name) || null : null,
      time: mc.level ? mc.level.time : null,
      isDay: mc.level && mc.level.isDay ? mc.level.isDay() : null,
      rain: mc.level && mc.level.getRainLevel ? mc.level.getRainLevel() : null,
      renderDistance: mc.options ? mc.options.renderDistance : null,
      gamemode: mc.options ? mc.options.gamemode : null,
      canvas: mc.glCanvas ? [mc.glCanvas.width, mc.glCanvas.height] : null,
      gui: mc.guiCanvas ? [mc.guiCanvas.width, mc.guiCanvas.height] : null,
      inner: [window.innerWidth, window.innerHeight],
      dpr: window.devicePixelRatio,
      guiScale: typeof mc.guiScale === 'number' ? mc.guiScale : null,
      memory: mem ? { used: mem.usedJSHeapSize, total: mem.totalJSHeapSize, limit: mem.jsHeapSizeLimit } : null,
      sky: mc.sky
        ? {
            skyFactor: mc.sky.skyFactor ?? null,
            brightness: mc.sky.brightness ?? null,
            skyLightLevel: mc.sky.skyLightLevel ?? null,
            skyLightColor: mc.sky.skyLightColor ?? null,
            skyColor: mc.sky.skyColor ?? null,
            fogColor: mc.sky.fogColor ?? null,
            cloudColor: mc.sky.cloudColor ?? null,
          }
        : null,
      saves: { saveManager: !!mc.saveManager, autosave: !!mc.autosave, save: !!mc.save, levelStorage: !!mc.levelStorage },
      envWired: { weather: !!(mc.weatherRenderer || mc.weather), sky: !!(mc.skyRenderer || mc.cloudRenderer), particles: !!(mc.particles || mc.particleEngine) },
    };
  });
}

async function shot(name) {
  const file = path.join(ARGS.outDir, name);
  try {
    await withTimeout(page.screenshot({ path: file }), 20000, 'screenshot');
    const info = analyzePng(file);
    return { file, info };
  } catch (e) {
    record('harness', 'warning', `screenshot failed ${name}: ${e.message}`);
    return { file, info: null };
  }
}

const sceneShotName = (no, name) => `${String(no).padStart(2, '0')}-${name}.png`;

// ------------------------------------------------------------------- scenes

function fmtPos(s) {
  return s && s.pos ? s.pos.map((v) => v.toFixed(2)).join('/') : 'n/a';
}

function posDelta(a, b) {
  if (!a || !b || !a.pos || !b.pos) return null;
  return Math.hypot(b.pos[0] - a.pos[0], b.pos[2] - a.pos[2]);
}

/**
 * Every scene: { no, name, timeout, run(ctx) -> { notes?, warn?, skip?, screenshots? } }
 * ctx = { page, probe, shot, sleep, ev, unresponsive }
 */
const SCENES = [
  {
    no: 0,
    name: 'boot',
    timeout: 60000,
    async run(ctx) {
      await ctx.sleep(3000);
      const s = await ctx.probe();
      return {
        notes: [
          `chunks=${s.chunks}`,
          `meshSections=${s.mesh?.sections}`,
          `fps=${s.fps}`,
          `workers=${s.workers}`,
          `webgl=${webglMode}`,
          `bootMs=${bootResult.ms}`,
        ],
      };
    },
  },
  {
    no: 1,
    name: 'idle10s',
    timeout: 40000,
    async run(ctx) {
      const a = await ctx.probe();
      await ctx.sleep(10000);
      const b = await ctx.probe();
      const dChunks = (b.chunks ?? 0) - (a.chunks ?? 0);
      const rd = b.renderDistance ?? 8;
      const expected = (2 * rd + 1) ** 2; // full streaming disc at this render distance
      const notes = [
        `fps ${a.fps}->${b.fps}`,
        `chunks ${a.chunks}->${b.chunks} (${dChunks >= 0 ? '+' : ''}${dChunks}, 满视野≈${expected})`,
        `queue=${b.queue} inflight=${b.inflight}`,
      ];
      const warn = [];
      if ((b.chunks ?? 0) > expected * 1.5) warn.push(`chunk 数 ${b.chunks} 超过满视野 ${expected} 的 1.5 倍，疑似泄漏`);
      if (a.fps && b.fps && b.fps < a.fps * 0.5) warn.push(`掉帧 ${a.fps}->${b.fps}`);
      return { notes, warn };
    },
  },
  {
    no: 2,
    name: 'walk',
    timeout: 30000,
    async run(ctx) {
      await ctx.ev(() => {
        const mc = window.__mc;
        mc.player.flying = false;
      });
      await ctx.sleep(600);
      const a = await ctx.probe();
      await ctx.page.keyboard.down('w');
      await ctx.sleep(3000);
      await ctx.page.keyboard.up('w');
      await ctx.sleep(200);
      const b = await ctx.probe();
      const d = posDelta(a, b);
      return { notes: [`位移 ${d === null ? 'n/a' : d.toFixed(2)} 格`, `y ${a.pos?.[1].toFixed(1)}->${b.pos?.[1].toFixed(1)}`], warn: d !== null && d < 0.5 ? ['按 W 3 s 几乎没动'] : [] };
    },
  },
  {
    no: 3,
    name: 'jump',
    timeout: 45000,
    async run(ctx) {
      await ctx.ev(() => {
        const mc = window.__mc;
        mc.player.flying = false;
      });
      await ctx.sleep(500);
      const a = await ctx.probe();
      let maxY = a.pos ? a.pos[1] : 0;
      for (let i = 0; i < 10; i++) {
        await ctx.page.keyboard.press('Space');
        await ctx.sleep(140);
        const s = await ctx.probe();
        if (s.pos && s.pos[1] > maxY) maxY = s.pos[1];
        await ctx.sleep(260); // > 280 ms double-tap window: never toggles flying
      }
      const b = await ctx.probe();
      await ctx.ev(() => {
        window.__mc.player.flying = false;
      });
      const rise = a.pos ? maxY - a.pos[1] : 0;
      return { notes: [`10 次跳跃 峰值 y=${maxY.toFixed(2)} (+${rise.toFixed(2)})`, `落地 onGround=${b.onGround}`], warn: rise < 0.4 ? ['跳跃没有抬升，可能没吃到 Space'] : [] };
    },
  },
  {
    no: 4,
    name: 'sprint',
    timeout: 90000,
    async run(ctx) {
      await ctx.ev(() => {
        const mc = window.__mc;
        mc.player.flying = false;
      });
      let sawSprint = false;
      let best = 0;
      let attemptUsed = 0;
      // A spawn point jammed against a tree/hill legitimately yields 0 movement, so try the
      // four cardinal directions before calling the input path broken.
      for (let attempt = 0; attempt < 4; attempt++) {
        if (attempt > 0) {
          await ctx.ev(() => {
            window.__mc.player.yaw = (window.__mc.player.yaw + 90) % 360;
          });
          await ctx.sleep(300);
        }
        const a = await ctx.probe();
        await ctx.page.keyboard.down('Control');
        await ctx.page.keyboard.down('w');
        for (let i = 0; i < 10; i++) {
          await ctx.sleep(500);
          const s = await ctx.probe();
          if (s.screenClass) break;
          if (await ctx.ev(() => !!window.__mc.player.sprinting)) sawSprint = true;
        }
        await ctx.page.keyboard.up('w');
        await ctx.page.keyboard.up('Control');
        await ctx.sleep(250);
        const b = await ctx.probe();
        const d = posDelta(a, b) ?? 0;
        if (d > best) {
          best = d;
          attemptUsed = attempt;
        }
        if (d > 0.5) break;
      }
      return {
        notes: [`最佳 5 s 位移 ${best.toFixed(2)} 格`, `方向尝试 ${attemptUsed + 1}/4`, `sprinting=${sawSprint}`],
        warn: sawSprint ? [] : ['player.sprinting 从未为 true'],
      };
    },
  },
  {
    no: 5,
    name: 'fly',
    timeout: 45000,
    async run(ctx) {
      await ctx.ev(() => {
        const mc = window.__mc;
        mc.options.gamemode = 'creative';
        mc.player.flying = true;
        if (mc.player.vel) mc.player.vel.y = 0;
        mc.keys.add('Space'); // direct set: avoids key auto-repeat toggling flying
      });
      const a = await ctx.probe();
      let maxY = a.pos ? a.pos[1] : 0;
      for (let i = 0; i < 40; i++) {
        await ctx.sleep(250);
        const s = await ctx.probe();
        if (s.pos && s.pos[1] > maxY) maxY = s.pos[1];
        if (a.pos && maxY - a.pos[1] >= 40) break;
      }
      await ctx.ev(() => {
        const mc = window.__mc;
        mc.keys.delete('Space');
        mc.player.flying = false;
        // put the player back on the surface of the current column
        const h = mc.level.getHeight(Math.floor(mc.player.pos.x), Math.floor(mc.player.pos.z));
        mc.player.pos = mc.player.pos.add(0, h + 1.2 - mc.player.pos.y, 0);
      });
      await ctx.sleep(400);
      const rise = a.pos ? maxY - a.pos[1] : 0;
      const b = await ctx.probe();
      return { notes: [`上升 ${rise.toFixed(1)} 格`, `落地 y=${b.pos?.[1].toFixed(1)}`], warn: rise < 5 ? ['flying+Space 没有上升'] : [] };
    },
  },
  {
    no: 6,
    name: 'lookAround',
    timeout: 60000,
    async run(ctx) {
      // Try the real pointer-lock path first, then rotate deterministically.
      let lockNote = 'pointerLock=unavailable';
      try {
        await ctx.page.mouse.click(640, 360);
        await ctx.sleep(200);
        const locked = await ctx.ev(() => document.pointerLockElement !== null);
        if (locked) {
          const before = await ctx.probe();
          await ctx.page.mouse.move(740, 360, { steps: 4 });
          await ctx.sleep(150);
          const after = await ctx.probe();
          const dyaw = before.yaw !== null && after.yaw !== null ? after.yaw - before.yaw : 0;
          lockNote = `pointerLock=on mouseYawDelta=${dyaw.toFixed(1)}`;
        }
      } catch (e) {
        lockNote = `pointerLock=error(${e.message})`;
      }
      const shots = [];
      const yaws = [];
      for (let i = 0; i < 8; i++) {
        const y = await ctx.ev(() => {
          const mc = window.__mc;
          mc.player.yaw = (mc.player.yaw + 45) % 360;
          return mc.player.yaw;
        });
        yaws.push(Math.round(y));
        await ctx.sleep(350);
        const s = await ctx.shot(`06-lookAround-${i + 1}.png`);
        shots.push(s);
      }
      const last = shots[shots.length - 1];
      return {
        notes: [lockNote, `yaw=${yaws.join(',')}`, `${shots.length} 张截图`],
        screenshots: shots,
        screenshotOverride: last?.file,
      };
    },
  },
  {
    no: 7,
    name: 'breakBlock',
    timeout: 45000,
    async run(ctx) {
      const before = await ctx.ev(() => {
        const mc = window.__mc;
        mc.player.flying = false;
        mc.player.pitch = 88;
        const hit = mc.raycast();
        return {
          hit: hit ? { x: hit.x, y: hit.y, z: hit.z, face: hit.face } : null,
          state: hit ? mc.level.getBlockState(hit.x, hit.y, hit.z) : null,
          progress: mc.breakProgress,
        };
      });
      if (!before.hit) return { notes: ['视线内没有可破坏方块（raycast=null）'], warn: ['朝下 5 格内无方块'] };
      let calls = 0;
      for (let i = 0; i < 12; i++) {
        const changed = await ctx.ev(() => {
          const mc = window.__mc;
          const hit = mc.raycast();
          if (!hit) return false;
          const s0 = mc.level.getBlockState(hit.x, hit.y, hit.z);
          mc.attack();
          const s1 = mc.level.getBlockState(hit.x, hit.y, hit.z);
          return s0 !== s1;
        });
        if (changed) calls++;
        await ctx.sleep(250);
      }
      const after = await ctx.ev((t) => {
        const mc = window.__mc;
        return {
          state: mc.level.getBlockState(t.x, t.y, t.z),
          isAir: mc.mc.isAir(mc.level.getBlockState(t.x, t.y, t.z)),
          progress: mc.breakProgress,
        };
      }, before.hit);
      const broken = after.isAir || calls > 0;
      return {
        notes: [
          `目标 ${before.hit.x},${before.hit.y},${before.hit.z} state ${before.state}->${after.state} isAir=${after.isAir}`,
          `attack 改变方块 ${calls}/12`,
          `breakProgress=${after.progress}`,
        ],
        warn: broken ? [] : ['左键 3 s 没有破坏任何方块'],
      };
    },
  },
  {
    no: 8,
    name: 'placeBlock',
    timeout: 60000,
    async run(ctx) {
      // Deterministic placement harness. The old scene looked straight down (pitch=88), so the
      // raycast hit the block under the player's feet, the target cell was the player's own
      // column and after the first block every attempt was rejected by the "target occupied"
      // rule (3/10). Now each of the 10 attempts: aim at the ground ~1.4 blocks ahead
      // (pitch=50), remove whatever plant occupies the target cell (a player would break it
      // first), place, then restore the cell so every attempt starts from the same clean state.
      // 10/10 is the assertion; the per-attempt state names are printed for debugging.
      const res = await ctx.ev(async () => {
        const mc = window.__mc;
        const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
        mc.player.flying = true; // freeze the eye position for the whole scene
        mc.player.pitch = 50;
        // pick any hotbar slot that holds a placeable block instead of assuming slot 1
        const stacks = mc.survival.hotbarStacks();
        let slot = stacks.findIndex((s) => s.item && s.item.block);
        if (slot < 0) slot = 1;
        mc.selectedSlot = slot;
        const out = [];
        for (let i = 0; i < 10; i++) {
          const hit = mc.raycast();
          if (!hit) {
            out.push({ placed: false, reason: 'raycast=null', target: null });
            await sleep(320);
            continue;
          }
          const dx = [0, 0, 0, 0, -1, 1][hit.face];
          const dy = [0, 1, 0, 0, 0, 0][hit.face];
          const dz = [-1, 0, 1, -1, 0, 0][hit.face];
          const target = [hit.x + dx, hit.y + dy, hit.z + dz];
          const original = mc.level.getBlockState(target[0], target[1], target[2]);
          const originalName = mc.mc.blockOf(original).name;
          // target must be air for a vanilla-legal placement: clear the plant if there is one
          if (original !== 0) mc.level.setBlockState(target[0], target[1], target[2], 0);
          mc.useItem();
          const after = mc.level.getBlockState(target[0], target[1], target[2]);
          const placed = after !== 0;
          // restore the probe cell (also stops the test from stacking a pillar into the camera)
          mc.level.setBlockState(target[0], target[1], target[2], original);
          out.push({
            placed,
            target,
            face: hit.face,
            original: originalName,
            placedState: mc.mc.blockOf(after).name,
            restored: mc.level.getBlockState(target[0], target[1], target[2]) === original,
          });
          await sleep(320); // useCooldown is 4 ticks (200 ms)
        }
        const p = mc.player.pos;
        return {
          out,
          slot,
          slotItem: mc.hotbar[slot],
          pos: [p.x, p.y, p.z],
          flying: !!mc.player.flying,
        };
      });
      const ok = res.out.filter((r) => r.placed).length;
      const rows = res.out.map((r, i) => `${i + 1}: ${r.placed ? 'OK' : 'FAIL'} `
        + `${r.target ? r.target.join(',') : '-'} ${r.original}->${r.placedState ?? '-'}`
        + `${r.reason ? ` (${r.reason})` : ''}${r.restored === false ? ' (restore failed)' : ''}`);
      return {
        notes: [
          `放置成功 ${ok}/10`,
          `slot${res.slot} item=${res.slotItem} pos=${res.pos.map((v) => v.toFixed(1)).join('/')} flying=${res.flying}`,
          ...rows,
        ],
        fail: ok < 10,
        warn: ok < 10 ? [`放置只有 ${ok}/10 成功：检查 raycast / stateForPlacement / 目标格占用`] : [],
      };
    },
  },
  {
    no: 9,
    name: 'inventory',
    timeout: 25000,
    async run(ctx) {
      const wired = await ctx.ev(() => !!window.__mc.screens);
      if (!wired) {
        await ctx.page.keyboard.press('e');
        await ctx.sleep(300);
        return { skip: false, fail: true, notes: ['模块未接线：__mc.screens 不存在，按 E 无反应（不是代码 bug）'] };
      }
      await ctx.page.keyboard.press('e');
      await ctx.sleep(500);
      let s = await ctx.probe();
      if (!s.screenClass) return { fail: true, notes: [`按 E 后没有界面 (screenClass=null)`] };
      const opened = s.screenClass;
      await ctx.shot(`09-inventory-open.png`);
      await ctx.page.keyboard.press('Escape');
      await ctx.sleep(400);
      s = await ctx.probe();
      return { notes: [`打开 ${opened}`, `Esc 后 screenClass=${s.screenClass}`], warn: s.screenClass ? ['Esc 没有关闭背包'] : [] };
    },
  },
  {
    no: 10,
    name: 'pause',
    timeout: 25000,
    async run(ctx) {
      const wired = await ctx.ev(() => !!window.__mc.screens);
      if (!wired) {
        await ctx.page.keyboard.press('Escape');
        await ctx.sleep(300);
        return { fail: true, notes: ['模块未接线：__mc.screens 不存在，Esc 打不开暂停菜单（不是代码 bug）'] };
      }
      await ctx.page.keyboard.press('Escape');
      await ctx.sleep(500);
      const s = await ctx.probe();
      return {
        notes: [`screenClass=${s.screenClass}`, `pointerLock=${await ctx.ev(() => document.pointerLockElement !== null)}`],
        warn: !s.screenClass ? ['Esc 后没有暂停界面'] : [],
      };
    },
  },
  {
    no: 11,
    name: 'options',
    timeout: 30000,
    async run(ctx) {
      const wired = await ctx.ev(() => !!window.__mc.screens);
      if (!wired) return { fail: true, notes: ['模块未接线：__mc.screens 不存在，无法进入选项/视频设置（不是代码 bug）'] };
      const r = await ctx.ev(() => {
        const mc = window.__mc;
        const out = {};
        try {
          mc.screens.open('options');
          out.options = mc.screens.current && mc.screens.current.constructor.name;
        } catch (e) {
          out.err1 = String(e && e.message);
        }
        return out;
      });
      await ctx.sleep(400);
      await ctx.shot(`11-options.png`);
      const r2 = await ctx.ev(() => {
        const mc = window.__mc;
        const out = {};
        try {
          mc.screens.open('video');
          out.video = mc.screens.current && mc.screens.current.constructor.name;
        } catch (e) {
          out.err2 = String(e && e.message);
        }
        return out;
      });
      await ctx.sleep(400);
      return {
        notes: [`options=${r.options ?? r.err1}`, `video=${r2.video ?? r2.err2}`],
        warn: !r2.video ? ['没有进入视频设置'] : [],
      };
    },
  },
  {
    no: 12,
    name: 'creativeTab',
    timeout: 30000,
    async run(ctx) {
      const wired = await ctx.ev(() => !!window.__mc.screens);
      if (!wired) return { fail: true, notes: ['模块未接线：__mc.screens 不存在，无法打开创造背包（不是代码 bug）'] };
      const opened = await ctx.ev(() => {
        const mc = window.__mc;
        mc.options.gamemode = 'creative';
        mc.screens.open('creative');
        const cur = mc.screens.current;
        return { cls: cur && cur.constructor.name, tabs: cur && cur.getTabs ? cur.getTabs().length : 0, sel: cur && cur.getSelectedTab ? cur.getSelectedTab() : null };
      });
      await ctx.sleep(400);
      const shots = [];
      const sels = [];
      for (let i = 1; i <= 3; i++) {
        const sel = await ctx.ev((idx) => {
          const cur = window.__mc.screens.current;
          if (cur && typeof cur.setTab === 'function') cur.setTab(idx);
          return cur && cur.getSelectedTab ? cur.getSelectedTab() : null;
        }, i);
        sels.push(sel);
        await ctx.sleep(350);
        shots.push(await ctx.shot(`12-creativeTab-${i}.png`));
      }
      return {
        notes: [`${opened.cls} tabs=${opened.tabs}`, `选定标签 ${sels.join(',')}`],
        screenshots: shots,
        screenshotOverride: shots[shots.length - 1]?.file,
        warn: opened.tabs < 4 ? ['标签数异常'] : [],
      };
    },
  },
  {
    no: 13,
    name: 'night',
    timeout: 25000,
    async run(ctx) {
      await ctx.ev(() => {
        const mc = window.__mc;
        if (mc.screens && mc.screens.close) mc.screens.close();
        mc.level.time = 18000;
      });
      await ctx.sleep(1200);
      const s = await ctx.probe();
      const snap = await ctx.shot('13-night.png');
      const lc = s.sky?.skyLightColor;
      const fc = s.sky?.fogColor;
      const reddish = lc && lc[0] > lc[2] + 0.1;
      // restore noon so the following scenes are readable
      await ctx.ev(() => {
        window.__mc.level.time = 6000;
      });
      return {
        notes: [
          `time=${Math.round(s.time)} isDay=${s.isDay}`,
          `skyFactor=${s.sky?.skyFactor} skyLightLevel=${s.sky?.skyLightLevel}`,
          `skyLightColor=${lc ? lc.map((v) => v.toFixed(2)).join(',') : 'n/a'}`,
          `fogColor=${fc ? fc.map((v) => v.toFixed(2)).join(',') : 'n/a'}`,
          `luma=${snap.info?.luma}`,
        ],
        warn: [
          ...(s.isDay === true ? ['time=18000 仍判定为白天 (isDay=true)'] : []),
          ...(reddish ? ['夜间 skyLightColor 偏红 (R>B)，夜晚应偏蓝'] : []),
          ...(snap.info && snap.info.luma > 70 ? [`夜景色调偏亮 (luma=${snap.info.luma})`] : []),
        ],
        screenshots: [snap],
        screenshotOverride: snap.file,
      };
    },
  },
  {
    no: 14,
    name: 'rain',
    timeout: 25000,
    async run(ctx) {
      const s = await ctx.ev(() => {
        const mc = window.__mc;
        mc.level.rainLevel = 1;
        mc.level.thunderLevel = 0;
        return { rain: mc.level.getRainLevel ? mc.level.getRainLevel() : null };
      });
      await ctx.sleep(1200);
      const p = await ctx.probe();
      const out = await ctx.shot(`14-rain.png`);
      await ctx.ev(() => {
        window.__mc.level.rainLevel = 0;
      });
      return {
        notes: [
          `rainLevel=${s.rain}`,
          `环境渲染对象: weather=${p.envWired?.weather} sky/cloud=${p.envWired?.sky}`,
          `luma=${out.info?.luma}`,
        ],
        warn: [
          ...(s.rain !== 1 ? ['rainLevel 赋值未生效'] : []),
          ...(p.envWired?.weather ? [] : ['天气渲染器未接线：雨只改了 level 状态，画面上不会出现雨']),
        ],
      };
    },
  },
  {
    no: 15,
    name: 'teleportFar',
    timeout: 120000,
    async run(ctx) {
      // Full acceptance for the chunk-unload work (TASK-bugs #2):
      //  1. edit a marker block near spawn (level.setBlockState -> chunk is pinned as modified)
      //  2. teleport 2000 blocks away and sample 15 s: chunk count must settle back to the
      //     (2*renderDistance+1)^2 enter ring, not keep every chunk ever loaded
      //  3. teleport back: the marker block must still be there (in-session edit survives;
      //     the client has no save-first chunk source, so edited chunks are never dropped)
      const a = await ctx.probe();
      const marker = await ctx.ev(() => {
        const mc = window.__mc;
        const p = mc.player.pos;
        const x = Math.floor(p.x) + 2;
        const y = Math.floor(p.y) + 2;
        const z = Math.floor(p.z) + 2;
        const gold = mc.mc.stateOf('gold_block');
        const before = mc.level.getBlockState(x, y, z);
        const changed = mc.level.setBlockState(x, y, z, gold);
        return {
          x, y, z, gold, before, changed,
          beforeName: mc.mc.blockOf(before).name,
          now: mc.level.getBlockState(x, y, z) === gold,
        };
      });
      const origin = await ctx.ev(() => {
        const p = window.__mc.player.pos;
        return [p.x, p.y, p.z];
      });
      // pick a loaded, unmodified chunk ~6-10 chunks away from spawn: after the teleport it must
      // be gone from level.chunks (direct evidence the unload pass ran, independent of how fast
      // the new ring happens to load on a loaded machine)
      const oldChunk = await ctx.ev(() => {
        const mc = window.__mc;
        const pcx = Math.floor(mc.player.pos.x) >> 4;
        const pcz = Math.floor(mc.player.pos.z) >> 4;
        for (let r = 6; r <= 10; r++) {
          for (let dx = -r; dx <= r; dx++) {
            for (let dz = -r; dz <= r; dz++) {
              if (Math.max(Math.abs(dx), Math.abs(dz)) !== r) continue;
              const cx = pcx + dx;
              const cz = pcz + dz;
              if (!mc.level.hasChunk(cx, cz)) continue;
              if (mc.level.isChunkModified && mc.level.isChunkModified(cx, cz)) continue;
              return { cx, cz, dist: r };
            }
          }
        }
        return null;
      });
      await ctx.ev(() => {
        const mc = window.__mc;
        mc.player.flying = true;
        mc.player.pos = mc.player.pos.add(2000, 0, 2000);
        mc.player.pos = mc.player.pos.add(0, 120 - mc.player.pos.y, 0);
        mc.player.vel.x = 0;
        mc.player.vel.y = 0;
        mc.player.vel.z = 0;
      });
      const samples = [];
      for (let i = 0; i < 15; i++) {
        await ctx.sleep(1000);
        const s = await ctx.probe();
        samples.push({ t: i + 1, chunks: s.chunks, queue: s.queue, inflight: s.inflight });
        if (unresponsive) break;
      }
      const b = await ctx.probe();
      const rd = b.renderDistance ?? 8;
      const expected = (2 * rd + 1) ** 2;
      const peak = samples.reduce((m, s) => Math.max(m, s.chunks ?? 0), 0);
      const last3 = samples.slice(-3).map((s) => s.chunks ?? 0);
      const originInfo = await ctx.ev((c) => {
        if (!c || c.length !== 2) return null;
        const level = window.__mc.level;
        const chunk = level.getChunk(c[0], c[1]);
        return {
          loaded: level.hasChunk(c[0], c[1]),
          modified: level.isChunkModified ? level.isChunkModified(c[0], c[1]) : null,
          dirtySections: chunk ? chunk.dirtySections.size : null,
        };
      }, a.chunk);
      const oldChunkAfter = oldChunk
        ? await ctx.ev((c) => window.__mc.level.hasChunk(c.cx, c.cz), oldChunk)
        : null;

      // teleport back to the recorded position, wait for the ring to come back
      await ctx.ev((o) => {
        const mc = window.__mc;
        const p = mc.player.pos;
        mc.player.pos = mc.player.pos.add(o[0] - p.x, o[1] - p.y, o[2] - p.z);
        mc.player.vel.x = 0;
        mc.player.vel.y = 0;
        mc.player.vel.z = 0;
      }, origin);
      let back = null;
      for (let i = 0; i < 20; i++) {
        await ctx.sleep(1000);
        back = await ctx.probe();
        const markerChunk = await ctx.ev((m) => ({
          loaded: window.__mc.level.hasChunk(m.x >> 4, m.z >> 4),
        }), marker);
        if ((back.chunks ?? 0) >= Math.min(expected * 0.5, 40) && markerChunk.loaded) break;
      }
      const markerAfter = await ctx.ev((m) => {
        const level = window.__mc.level;
        const state = level.getBlockState(m.x, m.y, m.z);
        return { state, name: window.__mc.mc.blockOf(state).name };
      }, marker);

      const settled = (b.chunks ?? 0) <= expected * 1.4 && last3.every((c) => c <= expected * 1.4);
      const recovered = (back.chunks ?? 0) >= Math.min(expected * 0.5, 40) && (back.chunks ?? 0) <= expected * 1.4;
      const markerOk = markerAfter.state === marker.gold;
      const oldUnloaded = oldChunkAfter === null ? null : oldChunkAfter === false;
      const unloadOk = oldUnloaded !== false; // null = nothing loadable nearby, cannot verify
      return {
        notes: [
          `marker ${marker.x},${marker.y},${marker.z} ${marker.beforeName} -> gold_block changed=${marker.changed} now=${marker.now}`,
          `chunk ${a.chunk?.join(',')} -> ${b.chunk?.join(',')}`,
          `chunks ${a.chunks} -> 峰值 ${peak} -> ${b.chunks} (满视野≈${expected}, 最后3样本 ${last3.join('/')})`,
          `旧区块 ${oldChunk ? `${oldChunk.cx},${oldChunk.cz} (dist ${oldChunk.dist})` : '无可观测样本'} 传送后仍加载=${oldChunkAfter}`,
          `原位置区块 ${a.chunk?.join(',')} 仍加载=${originInfo?.loaded} modified=${originInfo?.modified} dirtySections=${originInfo?.dirtySections}`,
          `传送回来 chunks=${back?.chunks} (满视野≈${expected}), marker=${markerAfter.name}`,
          `queue=${b.queue} inflight=${b.inflight} mesh=${b.mesh?.sections} sections`,
        ],
        samples,
        fail: !(settled && recovered && markerOk && unloadOk),
        warn: [
          ...(!settled ? [`区块未卸载：chunks ${b.chunks} / 最后3样本 ${last3.join('/')} > 满视野 ${expected} 的 1.4 倍`] : []),
          ...(peak === 0 ? ['采样期间 chunks 一直为 0（页面可能无响应）'] : []),
          ...(oldUnloaded === false ? [`旧区块 ${oldChunk?.cx},${oldChunk?.cz} 传送后仍在 level.chunks 里（卸载未生效）`] : []),
          ...(!recovered ? [`传送回来后区块数异常：${back?.chunks}（满视野≈${expected}）`] : []),
          ...(!markerOk ? [`会话内丢档：标记方块 ${markerAfter.name} != gold_block`] : []),
        ],
      };
    },
  },
  {
    no: 16,
    name: 'resize',
    timeout: 45000,
    async run(ctx) {
      const sizes = [
        [1280, 720],
        [800, 600],
        [1920, 1080],
      ];
      const shots = [];
      const rows = [];
      for (const [w, h] of sizes) {
        await ctx.page.setViewportSize({ width: w, height: h });
        await ctx.sleep(700);
        const s = await ctx.probe();
        const dpr = s.dpr || 1;
        const expect = [Math.floor(w * dpr), Math.floor(h * dpr)];
        const ok = s.canvas && s.canvas[0] === expect[0] && s.canvas[1] === expect[1];
        rows.push(`${w}x${h} canvas=${s.canvas?.join('x')} expect=${expect.join('x')}${ok ? '' : ' MISMATCH'} guiScale=${s.guiScale}`);
        shots.push(await ctx.shot(`16-resize-${w}x${h}.png`));
        if (!ok) rows.push(`!canvas 尺寸不匹配 @${w}x${h}`);
      }
      await ctx.page.setViewportSize({ width: 1280, height: 720 });
      await ctx.sleep(400);
      return { notes: rows, screenshots: shots, screenshotOverride: shots[shots.length - 1]?.file };
    },
  },
  {
    no: 17,
    name: 'save',
    timeout: 40000,
    async run(ctx) {
      const s = await ctx.probe();
      const which = Object.entries(s.saves).filter(([, v]) => v).map(([k]) => k);
      if (!which.length) return { skip: true, notes: ['存档模块未接线（无 saveManager/autosave），跳过'] };
      // WorldSaveManager.flushDirty(level, player, budgetMs) is async and returns
      // Promise<number>. The old scene did `m[fn]()` with no arguments, so flushDirty got
      // `undefined` for `level` and threw "Cannot read properties of undefined (reading
      // 'chunks')". Pass the real signature and await the promise.
      const r = await ctx.ev(async () => {
        const mc = window.__mc;
        const m = mc.saveManager || mc.autosave || mc.save;
        const out = { tried: [], wrote: null, err: null, keys: [] };
        out.keys = m ? Object.keys(m).slice(0, 12) : [];
        try {
          if (m && typeof m.flushDirty === 'function') {
            out.wrote = await m.flushDirty(mc.level, mc.player, 50);
            out.tried.push('flushDirty(level, player, 50)');
          } else if (m && typeof m.flushAll === 'function') {
            out.wrote = await m.flushAll(mc.level, mc.player, {}, 50);
            out.tried.push('flushAll(level, player, {}, 50)');
          } else if (m && typeof m.flushNow === 'function') {
            await m.flushNow('manual');
            out.tried.push("flushNow('manual')");
          } else {
            out.tried.push('no usable flush method');
          }
        } catch (e) {
          out.err = String((e && e.message) || e);
        }
        return out;
      });
      const notes = [
        `存在 ${which.join(',')}`,
        `调用 ${r.tried.join('; ') || '无可用方法'}`,
        r.wrote === null ? 'wrote=未返回' : `wrote=${r.wrote} chunks`,
        `方法: ${r.keys.join(',')}`,
      ];
      if (r.err) return { fail: true, notes: [...notes, `flush threw: ${r.err}`] };
      if (r.wrote === null) {
        return { notes, warn: ['flush 未返回写入数：签名可能又变了（应为 Promise<number>）'] };
      }
      return { notes };
    },
  },
  {
    no: 18,
    name: 'reload',
    timeout: 180000,
    async run(ctx) {
      const before = await ctx.probe();
      await withTimeout(page.reload({ waitUntil: 'domcontentloaded', timeout: 60000 }), 65000, 'reload');
      const r = await waitReady(120000);
      bootResult = r;
      if (r.state !== 'ready') return { fail: true, notes: [`重载后未就绪: ${r.state} (${r.ms}ms)`] };
      await startGlPolling();
      await ctx.sleep(3000);
      const after = await ctx.probe();
      const notes = [
        `重载 ${r.ms}ms`,
        `chunks ${before.chunks} -> ${after.chunks}`,
        `pos ${fmtPos(before)} -> ${fmtPos(after)}`,
        `存档已接=${Object.entries(after.saves).some(([, v]) => v)}`,
      ];
      return { notes, warn: after.chunks < 9 ? ['重载后区块数过少'] : [] };
    },
  },
];

// ------------------------------------------------------------------ execution

function sceneErrorsSince(idx) {
  return events
    .slice(idx)
    .filter((e) => e.kind !== 'network' && e.kind !== 'requestfailed' && e.kind !== 'http' && (e.kind === 'pageerror' || e.kind === 'crash' || (e.kind === 'console' && e.level === 'error')));
}

function netSince(idx) {
  return events.slice(idx).filter((e) => e.kind === 'network' || e.kind === 'requestfailed' || e.kind === 'http');
}

async function runScene(scene) {
  const t0 = Date.now();
  const evIdx = events.length;
  const gl0 = page ? await page.evaluate(() => (window.__smoke ? window.__smoke.glErrors.length : 0)).catch(() => 0) : 0;

  const ctx = {
    page,
    probe,
    shot,
    ev,
    sleep: (ms) => sleep(unresponsive ? Math.min(ms, 800) : ms),
    get unresponsive() {
      return unresponsive;
    },
  };

  let result = { notes: [], warn: [] };
  let status = 'PASS';
  const extraScreens = [];

  try {
    if (unresponsive) throw new Error('页面无响应（上一个场景 evaluate 超时），跳过动作');
    const r = await withTimeout(scene.run(ctx), scene.timeout ?? 45000, `场景 ${scene.name}`);
    result = { notes: [], warn: [], ...(r || {}) };
    if (r?.screenshots) extraScreens.push(...r.screenshots);
    if (r?.fail) status = 'FAIL';
    else if (r?.skip) status = 'SKIP';
  } catch (e) {
    status = 'FAIL';
    result.notes.push(e.message);
    if (/超时/.test(e.message) && /page\.evaluate/.test(e.message)) {
      unresponsive = true;
      result.notes.push('页面不再响应：后续场景以快速失败模式执行');
    }
  }

  // final screenshot for the scene (unless it produced its own series and overrode it)
  let mainShot = null;
  if (page && !unresponsive) {
    if (result.screenshotOverride) {
      mainShot = result.screenshotOverride;
    } else {
      const s = await shot(sceneShotName(scene.no, scene.name));
      mainShot = s.file;
      if (s.info && s.info.luma !== null && (s.info.luma < 2 || s.info.luma > 253)) {
        result.warn.push(`截图近乎${s.info.luma < 2 ? '全黑' : '全白'} (luma=${s.info.luma})`);
      }
    }
  }

  await sleep(300);

  // ---- post checks
  let snap = null;
  if (page && !unresponsive) {
    try {
      snap = await probe();
    } catch (e) {
      snap = null;
      unresponsive = true;
      result.notes.push(`evaluate 超时：页面不再响应 (${e.message})`);
    }
  }

  const errs = sceneErrorsSince(evIdx);
  const nets = netSince(evIdx);
  const gl1 = page && snap ? await page.evaluate(() => (window.__smoke ? window.__smoke.glErrors.length : 0)).catch(() => gl0) : gl0;
  const newGl = Math.max(0, gl1 - gl0);
  const glErrAtEnd = snap ? snap.glError : null;
  const nan = snap ? snap.posNaN : false;

  if (errs.length) status = 'FAIL';
  if (newGl > 0 || (glErrAtEnd !== null && glErrAtEnd !== 0)) status = 'FAIL';
  if (nan) status = 'FAIL';
  if (snap && (snap.chunks === 0 || snap.chunks === null)) status = 'FAIL';

  if (errs.length) result.notes.push(`${errs.length} 条 console/page error`);
  if (newGl > 0) result.notes.push(`gl.getError 新增 ${newGl} 次`);
  if (glErrAtEnd) result.notes.push(`场景末 gl.getError=${glErrAtEnd}`);
  if (nan) result.notes.push('玩家坐标出现 NaN');
  if (nets.length) result.warn.push(`${nets.length} 次网络失败/4xx`);
  if (snap) result.notes.push(`chunks=${snap.chunks} fps=${snap.fps} gl=${glErrAtEnd}`);

  const ms = Date.now() - t0;
  const detail = [...result.notes, ...result.warn.map((w) => `warn: ${w}`)].join(' | ');

  return {
    scene,
    status,
    ms,
    notes: result.notes,
    warn: result.warn,
    samples: result.samples,
    errors: errs.map((e) => `${e.kind}: ${e.text}`).slice(0, 12),
    netErrors: nets.slice(0, 8).map((e) => e.text),
    glError: glErrAtEnd,
    newGlErrors: newGl,
    screenshot: mainShot ? rel(mainShot) : null,
    extraScreenshots: extraScreens.map((s) => (s && s.file ? rel(s.file) : String(s))),
    snapshot: snap
      ? {
          pos: snap.pos,
          chunks: snap.chunks,
          mesh: snap.mesh,
          fps: snap.fps,
          queue: snap.queue,
          inflight: snap.inflight,
          entities: snap.entities,
          screenClass: snap.screenClass,
          memory: snap.memory,
        }
      : null,
    detail,
    _evIdx: evIdx,
  };
}

// --------------------------------------------------------------- diagnostics

const GUESS = {
  boot: '启动阶段失败：资源加载 / WebGL2 上下文创建 / chunk worker 初始化',
  idle10s: '空转期异常：可能是定时器泄漏、chunk 缓冲无限增长',
  walk: '走动崩溃：区块流式加载跟不上移动（drain 预算太小或 worker 阻塞）',
  jump: '跳跃崩溃：碰撞/着地逻辑，或 Space 双击切换 flying',
  sprint: '冲刺崩溃：视野位移加速导致网格重建堆积',
  fly: '上升崩溃：可能是 chunk 上传超时 / 显存压力（flying 后大量新区块进视野）',
  lookAround: '视角旋转崩溃：视锥剔除或矩阵计算出现 NaN',
  breakBlock: '破坏方块崩溃：setBlockState 邻居重建 / 光照更新越界',
  placeBlock: '放置方块崩溃：stateForPlacement 或邻居形状更新异常',
  inventory: 'GUI 模块未接线（__mc.screens 不存在），预期失败，不是代码 bug',
  pause: 'GUI 模块未接线（__mc.screens 不存在），预期失败，不是代码 bug',
  options: 'GUI 模块未接线，预期失败；接线后重点看 OptionsBridge 读写 __mc.renderer',
  creativeTab: 'GUI 模块未接线，预期失败；接线后重点看 CreativeTabs 数据与图标图集',
  night: '时间/光照路径：128 级光照贴图或天空颜色越界',
  rain: '天气渲染路径：WeatherRenderer 未接线或雨纹理缺失',
  teleportFar: '远距传送崩溃：区块队列暴涨 / 网格重建风暴 / 显存 OOM',
  resize: 'resize 崩溃：canvas 重分配后 viewport/framebuffer 未同步',
  save: '存档写入异常：NBT 序列化或 IndexedDB/OPFS 配额',
  reload: '重载崩溃：缓存损坏 / worker 复用旧状态',
};

async function dumpBisect(failed) {
  const line = (s = '') => console.log(s);
  line();
  line('='.repeat(78));
  line(`BISECT: 第一个失败场景 = ${String(failed.scene.no).padStart(2, '0')}-${failed.scene.name} (${failed.status})`);
  line('='.repeat(78));

  // console context: ±20 messages around the first error of this scene
  const consoleKinds = new Set(['console', 'pageerror', 'crash', 'network', 'requestfailed', 'http']);
  const allConsole = events.filter((e) => consoleKinds.has(e.kind));
  const firstErr = failed._evIdx >= 0 ? events.slice(failed._evIdx).find((e) => consoleKinds.has(e.kind)) : null;
  const anchor = firstErr ? allConsole.indexOf(firstErr) : allConsole.length - 1;
  const from = Math.max(0, anchor - 20);
  const to = Math.min(allConsole.length, anchor + 21);
  line(`--- console 上下文 [${from}..${to}) 共 ${allConsole.length} 条，锚点=${firstErr ? firstErr.kind : 'scene-end'} ---`);
  for (let i = from; i < to; i++) {
    const e = allConsole[i];
    const mark = i === anchor ? '>>' : '  ';
    const extra = e.stack ? `\n      ${String(e.stack).split('\n').slice(0, 4).join('\n      ')}` : '';
    line(`${mark} [${e.kind}/${e.level}] +${(e.at / 1000).toFixed(1)}s ${e.text}${extra}`);
  }
  if (!allConsole.length) line('  (整个会话没有 console 输出)');

  line();
  line('--- 失败场景截图 ---');
  line(`  ${failed.screenshot ?? '(无)'}`);
  for (const s of failed.extraScreenshots.slice(0, 6)) line(`  ${s}`);

  line();
  line('--- 探针 (page.evaluate) ---');
  try {
    const p = await page.evaluate(() => {
      const mc = window.__mc;
      if (!mc) return { ready: false };
      const em = mc.entityManager;
      let entityCount = null;
      try {
        entityCount = em && em.getEntities ? em.getEntities().length : null;
      } catch (e) {
        entityCount = `err:${e && e.message}`;
      }
      const mem = performance.memory;
      return {
        ready: true,
        meshStats: mc.renderer && mc.renderer.meshStats ? mc.renderer.meshStats : null,
        queueLength: mc.chunkProvider ? mc.chunkProvider.queueLength : null,
        inflight: mc.chunkProvider ? mc.chunkProvider.inflight : null,
        usingWorkers: mc.chunkProvider ? !!mc.chunkProvider.usingWorkers : null,
        chunks: mc.level && mc.level.chunks ? mc.level.chunks.size : null,
        entityManager: !!em,
        entityCount,
        fps: mc.fps ?? null,
        playerPos: mc.player && mc.player.pos ? [mc.player.pos.x, mc.player.pos.y, mc.player.pos.z] : null,
        time: mc.level ? mc.level.time : null,
        memory: mem ? { usedMB: +(mem.usedJSHeapSize / 1048576).toFixed(1), totalMB: +(mem.totalJSHeapSize / 1048576).toFixed(1), limitMB: +(mem.jsHeapSizeLimit / 1048576).toFixed(1) } : null,
        glError: (() => {
          try {
            return mc.gl.getError();
          } catch (e) {
            return `err:${e && e.message}`;
          }
        })(),
        glErrors: window.__smoke ? window.__smoke.glErrors.slice(-10) : null,
        pageErrors: window.__smoke ? window.__smoke.errors.slice(-5) : null,
        unhandledRejections: window.__smoke ? window.__smoke.rejections.slice(-5) : null,
      };
    });
    console.log(JSON.stringify(p, null, 2));
  } catch (e) {
    console.log(`探针失败（页面无响应）：${e.message}`);
  }

  line();
  line('--- 推测归因（仅推测，需人工确认） ---');
  line(`  ${GUESS[failed.scene.name] ?? '未知：请结合上面的栈定位'}`);
  if (failed.errors.length) {
    line('  直接错误：');
    for (const e of failed.errors) line(`    - ${e}`);
  }
  line();
  line(`  完整报告：${rel(reportPath)}`);
}

// ---------------------------------------------------------------------- main

function printSummary(results, summary) {
  console.log('');
  console.log('=== smoke summary ===');
  for (const r of results) {
    const name = `${String(r.scene.no).padStart(2, '0')}-${r.scene.name}`.padEnd(16);
    const ms = `${r.ms}ms`.padStart(9);
    console.log(`${r.status.padEnd(4)} ${name}${ms}  ${r.detail}`);
  }
  console.log('');
  console.log(`pass=${summary.pass} fail=${summary.fail} skip=${summary.skip}  firstFailure=${summary.firstFailure ?? 'none'}  total=${((Date.now() - startMs) / 1000).toFixed(1)}s`);
}

async function main() {
  // 1) browser + WebGL2, with fallback from SwiftShader to the default GL stack
  let launched = await launch('swiftshader');
  browser = launched.b;
  page = launched.p;
  if (!(await hasWebgl2(page))) {
    console.warn('[smoke] SwiftShader 未提供 WebGL2，回退默认 GL 参数');
    await browser.close().catch(() => {});
    launched = await launch('default');
    browser = launched.b;
    page = launched.p;
    webglMode = 'default';
    if (!(await hasWebgl2(page))) {
      webglMode = 'none';
      console.error('[smoke] 没有 WebGL2：所有渲染相关场景都会失败');
    }
  }
  console.log(`[smoke] chromium ${browser.version()} webgl=${webglMode} headless=${process.env.SMOKE_HEADED !== '1'}`);

  attachPage(page);
  await installHooks(page);

  // 2) boot
  console.log(`[smoke] loading ${ARGS.url}`);
  const navT0 = Date.now();
  await page.goto(ARGS.url, { waitUntil: 'domcontentloaded', timeout: 60000 });
  bootResult = await waitReady(120000);
  const bootMs = Date.now() - navT0;
  console.log(`[smoke] boot: ${bootResult.state} in ${bootMs}ms`);
  if (bootResult.state === 'ready') await startGlPolling();

  // 3) pick scenes
  let scenes = SCENES;
  if (ARGS.only) {
    const key = String(ARGS.only).toLowerCase();
    const hit = SCENES.find((s) => s.name.toLowerCase() === key || String(s.no) === key || `${s.no}-${s.name}`.toLowerCase() === key);
    if (!hit) {
      console.error(`[smoke] --only ${ARGS.only} 不匹配任何场景。可选：${SCENES.map((s) => `${s.no}-${s.name}`).join(', ')}`);
      await browser.close();
      process.exit(2);
    }
    scenes = hit.no === 0 ? [hit] : [SCENES[0], hit];
  }

  const results = [];

  // boot failure short-circuits everything: there is no page to drive
  if (bootResult.state !== 'ready') {
    const bootScene = SCENES[0];
    const status = bootResult.state === 'timeout' ? 'BOOT_TIMEOUT' : 'BOOT_FAILED';
    const r = {
      scene: bootScene,
      status: 'FAIL',
      ms: bootMs,
      notes: [`${status}: ${bootResult.state}`],
      warn: [],
      errors: events.filter((e) => e.kind === 'pageerror' || e.kind === 'console').map((e) => `${e.kind}: ${e.text}`).slice(0, 20),
      netErrors: events.filter((e) => e.kind === 'http' || e.kind === 'requestfailed').map((e) => e.text).slice(0, 10),
      glError: null,
      newGlErrors: 0,
      screenshot: null,
      extraScreenshots: [],
      snapshot: null,
      detail: `${status} ${ARGS.url} — 页面没有进入 ready`,
      _evIdx: 0,
      _bootCode: status,
    };
    try {
      const s = await shot('00-boot-failure.png');
      r.screenshot = rel(s.file);
    } catch {}
    results.push(r);
    console.log(`FAIL 00-boot  ${status}`);
    console.log('--- 最近的 console ---');
    for (const e of events.slice(-30)) console.log(`  [${e.kind}/${e.level}] ${e.text}`);
  } else {
    for (const scene of scenes) {
      const r = await runScene(scene);
      results.push(r);
      console.log(`${r.status.padEnd(4)} ${String(scene.no).padStart(2, '0')}-${scene.name} ${r.ms}ms  ${r.detail}`);
      for (const e of r.errors.slice(0, 4)) console.log(`       ! ${e}`);
      if (ARGS.bisect && r.status === 'FAIL') {
        await dumpBisect(r);
        break;
      }
    }
  }

  // 4) report
  const failCount = results.filter((r) => r.status !== 'PASS' && r.status !== 'SKIP').length;
  const summary = {
    pass: results.filter((r) => r.status === 'PASS').length,
    fail: failCount,
    skip: results.filter((r) => r.status === 'SKIP').length,
    firstFailure: results.find((r) => r.status !== 'PASS' && r.status !== 'SKIP')?.scene?.name ?? null,
    boot: bootResult.state,
    webgl: webglMode,
    notWired: results.some((r) => r.notes.some((n) => n.includes('未接线'))) ? results.filter((r) => r.notes.some((n) => n.includes('未接线'))).map((r) => r.scene.name) : [],
  };

  const report = {
    url: ARGS.url,
    startedAt,
    finishedAt: nowIso(),
    bisect: ARGS.bisect,
    only: ARGS.only,
    browser: { chromium: browser ? browser.version() : null, webglMode, headless: process.env.SMOKE_HEADED !== '1' },
    boot: { state: bootResult.state, ms: bootResult.ms },
    scenes: results.map((r) => ({
      name: r.scene.name,
      no: r.scene.no,
      status: r.status,
      ms: r.ms,
      errors: r.errors,
      netErrors: r.netErrors,
      glError: r.glError,
      newGlErrors: r.newGlErrors,
      notes: r.notes,
      warn: r.warn,
      samples: r.samples ?? undefined,
      screenshot: r.screenshot,
      screenshots: r.extraScreenshots.length ? r.extraScreenshots : undefined,
      snapshot: r.snapshot ?? undefined,
    })),
    summary,
    events: events.map((e) => ({ at: e.at, kind: e.kind, level: e.level, text: e.text })),
  };
  fs.writeFileSync(reportPath, JSON.stringify(report, null, 2));
  printSummary(results, summary);
  console.log(`report: ${rel(reportPath)}`);

  await browser.close().catch(() => {});
  process.exit(failCount === 0 && bootResult.state === 'ready' ? 0 : 1);
}

process.on('SIGINT', async () => {
  if (browser) await browser.close().catch(() => {});
  process.exit(130);
});

main().catch(async (e) => {
  console.error('[smoke] fatal:', e && e.stack ? e.stack : e);
  try {
    if (browser) await browser.close();
  } catch {}
  process.exit(2);
});
