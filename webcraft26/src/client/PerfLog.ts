// 手机 / 低端设备用的性能采样器（只在 ?perf=1 时创建，正常游玩零开销）。
//
// 为什么需要它：桌面上可以用 DevTools / perf-audit.mjs，手机上没有控制台。这里把同样的数据
// （帧间隔分布、主线程分项、draw call、GPU 帧时间、区块流式吞吐、渲染分辨率、长任务）采样
// 20 秒，生成一份可截图 / 可下载 / 可复制的纯文本报告，直接发回来就能定位。
//
// 用法（同一 Wi-Fi）：
//   PC:   cd webcraft26 && npm run dev
//   手机: http://<PC 局域网 IP>:5174/?play&perf=1     （&perf=30 指定秒数）
//   报告出来点「下载报告」或「复制」，发回 webcraft-perf-*.json / 截图即可。
//
// 关键判读：报告末尾会自动给一句「判定」，把问题归到
//   主线程（drain/mesh/tick 大）｜ GPU 填充率（gpu 大）｜ 呈现/合成（两边都小但帧间隔大）。

/** 记录的阶段名（顺序即报告顺序）。 */
const PHASE_NAMES = [
  'tick', 'drain', 'mesh', 'entities', 'hand',
  'sky', 'clouds', 'weather', 'particles', 'post',
  'hud', 'screens',
] as const;
type PhaseName = typeof PHASE_NAMES[number];

interface PhaseStat { ms: number; n: number; max: number }

/** 只声明采样器真正用到的结构，避免和 Game.ts 形成循环 import。 */
interface PerfGame {
  readonly gl: WebGL2RenderingContext;
  readonly glCanvas: HTMLCanvasElement;
  readonly guiCanvas: HTMLCanvasElement;
  readonly renderer: {
    update: (...a: never[]) => void;
    post: { endScene: () => void; stats: Record<string, unknown>; shadowSize: number };
    meshStats: { ms: number; count: number; sections: number };
    renderDistance: number;
    beginScene: () => void;
    shadersEnabled: boolean;
    directLightState?: { shadowsActive: boolean };
  };
  readonly chunkProvider: { drain: (...a: never[]) => number; queueLength: number; workerCount: number };
  readonly entityRenderer: { render: (...a: never[]) => void };
  readonly handRenderer: { render: (...a: never[]) => void };
  readonly skyRenderer: { render: (...a: never[]) => void };
  readonly cloudRenderer: { render: (...a: never[]) => void };
  readonly weatherRenderer: { render: (...a: never[]) => void };
  readonly particles: { render: (...a: never[]) => void };
  readonly screens: { render: (...a: never[]) => void };
  readonly level: { chunks: Map<number, unknown> };
  readonly survival: { gamemode: string };
  readonly options: { shaders: boolean; shaderQuality: string; renderDistance: number; fov: number };
  readonly pacer: { stats: () => { budget: number; rest: number; backoff: number; refresh: number } };
  readonly entityManager: { getEntities: () => readonly unknown[] };
  readonly touchDevice: boolean;
  readonly renderScale: number;
  readonly maxRenderScale: number;
  readonly guiScale: number;
  /** 世界是否在跑（标题界面为 false），自动模式用它决定何时开始采样。 */
  readonly worldActive: boolean;
  readonly titleMode: boolean;
  /** 用来做「降到 50% 分辨率是否更快」的对照实验。 */
  setRenderScale(scale: number): void;
  /** 可选：Game 侧的相机 / 速度 / 屏幕 / 网格覆盖诊断（旧版本没有这个钩子）。 */
  perfDiagnostics?: () => Record<string, string | number>;
  tick: () => void;
  renderHud: () => void;
}

const pct = (sorted: readonly number[], p: number): number =>
  sorted.length === 0 ? 0 : sorted[Math.min(sorted.length - 1, Math.floor(p * sorted.length))];
const f1 = (v: number): string => (Number.isFinite(v) ? v.toFixed(1) : 'n/a');

export interface PerfLogOptions {
  /** 采样秒数，默认 20。 */
  seconds?: number;
  /** 自动模式：不显示面板、进世界后自动采一次就上传（默认开启，?perf=0 可关）。 */
  auto?: boolean;
  /** 最后 1/3 时间把 3D 分辨率降到 50% 做对照（面板模式默认开，自动模式关，避免打扰）。 */
  abTest?: boolean;
  /** 采样结束后 POST 到 dev server 的 /__perf-log（落盘到 logs/perf/）。 */
  upload?: boolean;
}

export class PerfLog {
  private readonly seconds: number;
  private readonly game: PerfGame;
  private readonly auto: boolean;
  private readonly abTest: boolean;
  private readonly upload: boolean;
  private recording = false;
  /** 是否还允许「进世界后自动开一次」。采过一次就关掉，手动重采只走按钮。 */
  private armed = false;
  /** 卡顿看门狗：连续 dt>40ms 的帧数上限 60（≈3 秒低于 25fps）。 */
  private stallFrames = 0;
  private stallArmed = true;
  private activeMs = 0;
  private elapsedMs = 0;
  private frameDts: number[] = [];
  private perSecond: number[] = [];
  private secondFrames = 0;
  private secondStart = 0;
  private readonly phases = new Map<PhaseName, PhaseStat>();
  private cpuTotalMs = 0;
  private cpuMaxMs = 0;
  private frameDraws = 0;
  private drawsTotal = 0;
  private appliedTotal = 0;
  private meshedTotal = 0;
  private longest: { at: number; ms: number }[] = [];
  private longTasks: number[] = [];
  /** 分辨率对照实验：后 1/3 时间把 3D 渲染降到 50%，看帧率是否明显变快。 */
  private lowResStarted = false;
  private lowResSavedScale = 1;
  private normalMs = 0;
  private normalFrames = 0;
  private lowMs = 0;
  private lowFrames = 0;
  private gpuSamples: number[] = [];
  private gpuActive: WebGLQuery | null = null;
  private gpuPool: WebGLQuery[] = [];
  private gpuInFlight: WebGLQuery[] = [];
  private gpuExt: { TIME_ELAPSED_EXT: number } | null = null;
  private readonly env: Record<string, unknown> = {};
  private panel: HTMLDivElement | null = null;
  private panelBody: HTMLPreElement | null = null;
  private liveLine: HTMLDivElement | null = null;
  private readonly wrapRestore: (() => void)[] = [];

  // The sampler reaches into Game internals (private fields such as `pacer`), so the parameter is
  // typed loosely here and validated by use: this module is debug-only and must not force Game to
  // widen its API.
  constructor(game: object, options: PerfLogOptions = {}) {
    this.game = game as unknown as PerfGame;
    this.seconds = Math.max(3, options.seconds ?? 20);
    this.auto = options.auto ?? false;
    this.abTest = options.abTest ?? !this.auto;
    this.upload = options.upload ?? true;
  }

  // ------------------------------------------------------------------ setup

  /** 挂上钩子并开始采样。可重复调用（第二次只重启采样）。 */
  install(): void {
    if (this.wrapRestore.length === 0) this.hook();
    this.captureEnv();
    if (!this.auto) this.buildPanel();
    // 两种模式都等「世界活跃 2.5 秒」再开始，否则进世界头几帧的建网格会把 p95 拉满
    this.activeMs = 0;
    this.armed = true;
    if (this.liveLine) this.liveLine.textContent = '等待进入世界…';
  }

  private hook(): void {
    const g = this.game;
    const phases: [PhaseName, object, string][] = [
      ['tick', g, 'tick'],
      ['drain', g.chunkProvider, 'drain'],
      ['mesh', g.renderer, 'update'],
      ['entities', g.entityRenderer, 'render'],
      ['hand', g.handRenderer, 'render'],
      ['sky', g.skyRenderer, 'render'],
      ['clouds', g.cloudRenderer, 'render'],
      ['weather', g.weatherRenderer, 'render'],
      ['particles', g.particles, 'render'],
      ['post', g.renderer.post, 'endScene'],
      ['hud', g, 'renderHud'],
      ['screens', g.screens, 'render'],
    ];
    for (const [name, obj, method] of phases) {
      const target = obj as Record<string, unknown>;
      const original = target[method];
      if (typeof original !== 'function') continue;
      const self = this;
      target[method] = function patched(this: unknown, ...args: unknown[]): unknown {
        if (!self.recording) return (original as (...a: unknown[]) => unknown).apply(this, args);
        const t0 = performance.now();
        const result = (original as (...a: unknown[]) => unknown).apply(this, args);
        self.addPhase(name, performance.now() - t0);
        // drain() returns how many chunks it applied this frame (0..2); the report uses it to show
        // whether the client is stuck streaming instead of rendering.
        if (name === 'drain' && typeof result === 'number') self.appliedTotal += result;
        return result;
      };
      this.wrapRestore.push(() => { target[method] = original; });
    }

    // draw call 计数
    const gl = g.gl;
    const de = gl.drawElements.bind(gl);
    const da = gl.drawArrays.bind(gl);
    gl.drawElements = (...a: Parameters<WebGL2RenderingContext['drawElements']>) => { this.frameDraws++; return de(...a); };
    gl.drawArrays = (...a: Parameters<WebGL2RenderingContext['drawArrays']>) => { this.frameDraws++; return da(...a); };
    this.wrapRestore.push(() => {
      gl.drawElements = de;
      gl.drawArrays = da;
    });

    // GPU 帧计时：beginScene..endScene。手机浏览器多数不暴露该扩展，取不到就留空。
    const ext = gl.getExtension('EXT_disjoint_timer_query_webgl2') as unknown as
      { TIME_ELAPSED_EXT: number } | null;
    this.gpuExt = ext;
    if (ext) {
      this.gpuPool = Array.from({ length: 4 }, () => gl.createQuery()!).filter(Boolean);
      const begin = g.renderer.beginScene.bind(g.renderer);
      g.renderer.beginScene = () => {
        begin();
        if (!this.recording || this.gpuActive || this.gpuPool.length === 0) return;
        try {
          // 回收已完成的 query
          for (let i = this.gpuInFlight.length - 1; i >= 0; i--) {
            const q = this.gpuInFlight[i];
            if (gl.getQueryParameter(q, gl.QUERY_RESULT_AVAILABLE)) {
              this.gpuSamples.push(gl.getQueryParameter(q, gl.QUERY_RESULT) / 1e6);
              this.gpuInFlight.splice(i, 1);
              this.gpuPool.push(q);
            }
          }
          this.gpuActive = this.gpuPool.pop() ?? null;
          if (this.gpuActive) gl.beginQuery(ext.TIME_ELAPSED_EXT, this.gpuActive);
        } catch { this.gpuActive = null; }
      };
      const end = g.renderer.post.endScene.bind(g.renderer.post);
      g.renderer.post.endScene = () => {
        const r = end();
        try {
          if (this.gpuActive) {
            gl.endQuery(ext.TIME_ELAPSED_EXT);
            this.gpuInFlight.push(this.gpuActive);
            this.gpuActive = null;
          }
        } catch { /* ignore */ }
        return r;
      };
      this.wrapRestore.push(() => {
        g.renderer.beginScene = begin;
        g.renderer.post.endScene = end;
      });
    }

    // 长任务（Chrome/Safari 15+）：单帧里看不到的阻塞（GC、样式布局、IndexedDB 回调）
    if (typeof PerformanceObserver !== 'undefined') {
      try {
        const obs = new PerformanceObserver((list) => {
          for (const e of list.getEntries()) if (this.recording) this.longTasks.push(e.duration);
        });
        obs.observe({ entryTypes: ['longtask'] });
        this.wrapRestore.push(() => obs.disconnect());
      } catch { /* not supported */ }
    }
  }

  private captureEnv(): void {
    const g = this.game;
    const gl = g.gl;
    const dbg = gl.getExtension('WEBGL_debug_renderer_info');
    const nav = navigator as Navigator & { deviceMemory?: number; hardwareConcurrency?: number };
    const mem = (performance as Performance & { memory?: { usedJSHeapSize: number } }).memory;
    this.env.ua = navigator.userAgent;
    this.env.viewport = `${innerWidth}x${innerHeight} @${devicePixelRatio}x`;
    this.env.canvas3d = `${g.glCanvas.width}x${g.glCanvas.height}`;
    this.env.canvasGui = `${g.guiCanvas.width}x${g.guiCanvas.height}`;
    this.env.renderScale = `${(g.renderScale * 100).toFixed(0)}% (max ${(g.maxRenderScale * 100).toFixed(0)}%)`;
    this.env.guiScale = g.guiScale;
    this.env.gpu = dbg ? gl.getParameter(dbg.UNMASKED_RENDERER_WEBGL) : gl.getParameter(gl.RENDERER);
    this.env.gpuVendor = dbg ? gl.getParameter(dbg.UNMASKED_VENDOR_WEBGL) : gl.getParameter(gl.VENDOR);
    this.env.gpuTimer = this.gpuExt ? 'yes' : 'no';
    this.env.maxTexture = gl.getParameter(gl.MAX_TEXTURE_SIZE);
    this.env.cores = nav.hardwareConcurrency ?? 'n/a';
    this.env.deviceMemory = nav.deviceMemory ? `${nav.deviceMemory}GB` : 'n/a';
    this.env.heap = mem ? `${(mem.usedJSHeapSize / 1048576).toFixed(0)}MB` : 'n/a';
    this.env.touch = g.touchDevice;
    this.env.workers = g.chunkProvider.workerCount;
    this.env.settings = `光影 ${g.options.shaders ? '开' : '关'} / 画质 ${g.options.shaderQuality} / 视距 ${g.options.renderDistance}`;
    this.env.mode = g.survival.gamemode;
  }

  // -------------------------------------------------------------- recording

  private start(): void {
    this.recording = true;
    this.elapsedMs = 0;
    this.frameDts = [];
    this.perSecond = [];
    this.secondFrames = 0;
    this.secondStart = 0;
    this.phases.clear();
    this.cpuTotalMs = 0;
    this.cpuMaxMs = 0;
    this.drawsTotal = 0;
    this.appliedTotal = 0;
    this.meshedTotal = 0;
    this.longest = [];
    this.longTasks = [];
    this.lowResStarted = false;
    this.normalMs = 0;
    this.normalFrames = 0;
    this.lowMs = 0;
    this.lowFrames = 0;
    this.gpuSamples = [];
    if (this.panelBody) this.panelBody.textContent = '';
    if (this.liveLine) this.liveLine.textContent = '采样中…';
  }

  private addPhase(name: PhaseName, ms: number): void {
    let p = this.phases.get(name);
    if (!p) { p = { ms: 0, n: 0, max: 0 }; this.phases.set(name, p); }
    p.ms += ms;
    p.n++;
    if (ms > p.max) p.max = ms;
  }

  /** 每帧开头调用（dt = 上一帧到这一帧的间隔）。 */
  beginFrame(dt: number): void {
    this.frameDraws = 0;
    if (!this.recording) {
      // 卡顿看门狗：进世界后如果连续 ~3 秒都低于 ~42fps（例如打开背包时的 35fps 掉帧），
      // 自动采一次并上传，省得用户还得手动复现。每次加载只触发一次。
      if (this.stallArmed && this.game.worldActive && !this.game.titleMode) {
        if (dt > 24) {
          this.stallFrames++;
          if (this.stallFrames >= 90) {
            this.stallArmed = false;
            this.stallFrames = 0;
            this.armed = false;
            this.start();
            return;
          }
        } else if (this.stallFrames > 0) {
          this.stallFrames--;
        }
      }
      // 进世界后自动开一次；采完就解除（自动模式不再重来，手动模式靠面板按钮）
      if (!this.armed) return;
      if (this.game.worldActive && !this.game.titleMode) {
        this.activeMs += dt;
        if (this.activeMs >= 2500) { this.armed = false; this.start(); }
      }
      return;
    }
    this.elapsedMs += dt;
    this.frameDts.push(dt);
    this.secondFrames++;
    if (this.frameDts.length > 20000) this.frameDts.shift();
    if (this.secondStart === 0) this.secondStart = this.elapsedMs;
    if (this.elapsedMs - this.secondStart >= 1000) {
      this.perSecond.push(this.secondFrames);
      this.secondFrames = 0;
      this.secondStart = this.elapsedMs;
      this.updateLive();
    }
    if (dt > 34 && this.longest.length < 8) this.longest.push({ at: Math.round(this.elapsedMs), ms: +dt.toFixed(1) });
    if (dt > 34 && this.longest.length >= 8 && dt > this.longest[this.longest.length - 1].ms) {
      this.longest[this.longest.length - 1] = { at: Math.round(this.elapsedMs), ms: +dt.toFixed(1) };
      this.longest.sort((a, b) => b.ms - a.ms);
    }
    // 后 1/3 时间做分辨率对照：同一场景同一操作下，只把 3D 像素减到 1/4。
    // 帧率明显上升 = GPU 填充率瓶颈；几乎不变 = 主线程/合成瓶颈。手机拿不到 GPU 计时器时，
    // 这是唯一能区分「该降分辨率」还是「该降主线程负载」的硬证据。
    if (!this.lowResStarted && this.abTest && this.elapsedMs >= this.seconds * 1000 * (2 / 3)) {
      this.lowResStarted = true;
      this.lowResSavedScale = this.game.renderScale;
      try { this.game.setRenderScale(0.5); } catch { /* 忽略：老版本没有这个钩子 */ }
      if (this.liveLine) this.liveLine.textContent = '分辨率对照中（降到 50%）…';
    }
    if (this.lowResStarted) { this.lowMs += dt; this.lowFrames++; }
    else { this.normalMs += dt; this.normalFrames++; }
    if (this.elapsedMs >= this.seconds * 1000) this.finish();
  }

  /** 每帧结尾调用（cpuMs = 这一帧主线程总耗时）。 */
  endFrame(cpuMs: number): void {
    if (!this.recording) return;
    this.drawsTotal += this.frameDraws;
    this.cpuTotalMs += cpuMs;
    if (cpuMs > this.cpuMaxMs) this.cpuMaxMs = cpuMs;
    this.meshedTotal += this.game.renderer.meshStats.count;
  }

  private updateLive(): void {
    if (!this.liveLine) return;
    const sorted = [...this.frameDts].sort((a, b) => a - b) as number[];
    const fps = this.perSecond.length ? this.perSecond[this.perSecond.length - 1] : 0;
    const top = [...this.phases.entries()].sort((a, b) => b[1].ms / b[1].n - a[1].ms / a[1].n)[0];
    this.liveLine.textContent = `${fps} fps · p50 ${f1(pct(sorted, 0.5))}ms · 最重 ${top ? `${top[0]} ${f1(top[1].ms / top[1].n)}ms` : '—'}`;
  }

  private finish(): void {
    this.recording = false;
    if (this.lowResStarted) {
      try { this.game.setRenderScale(this.lowResSavedScale); } catch { /* ignore */ }
    }
    const text = this.buildReport();
    if (this.liveLine) this.liveLine.textContent = '采样完成';
    if (this.panelBody) this.panelBody.textContent = text;
    this.lastReport = text;
    console.log(text);
    if (this.upload) void this.uploadReport(text);
  }

  /** 把报告 POST 给 dev server（vite.config.ts 的 perf-log-sink 落盘到 logs/perf/）。 */
  private async uploadReport(text: string): Promise<void> {
    try {
      const res = await fetch('/__perf-log', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ when: new Date().toISOString(), ua: navigator.userAgent, report: text }),
      });
      if (res.ok || res.status === 204) console.log(`[perf] 报告已上传 (${(text.length / 1024).toFixed(0)} KB)`);
    } catch {
      // 没有 dev server / 生产环境：静默失败，不影响游戏
    }
  }

  private lastReport = '';

  // ---------------------------------------------------------------- report

  private buildReport(): string {
    const dts = [...this.frameDts].sort((a, b) => a - b);
    const n = dts.length;
    const totalMs = this.frameDts.reduce((a, b) => a + b, 0);
    const fps = n > 0 ? (n * 1000) / totalMs : 0;
    const bucket = (lo: number, hi: number): number => dts.filter((d) => d >= lo && d < hi).length;
    const frames = this.frameDts.length;
    // 按「每帧」而不是「每次调用」统计：tick 是 20Hz 固定步长，一帧可能跑 0~5 次，
    // 进世界时还会有一次超长 tick；用「每次调用」会得出比整帧还大的数字（误导）。
    const perFrame = (name: PhaseName): number => {
      const p = this.phases.get(name);
      return p && frames > 0 ? p.ms / frames : 0;
    };
    const phaseRows = PHASE_NAMES
      .map((name) => ({ name, p: this.phases.get(name), pf: perFrame(name) }))
      .filter((r) => r.p && r.p.n > 0)
      .sort((a, b) => b.pf - a.pf);
    const gpu = [...this.gpuSamples].sort((a, b) => a - b);
    const gpuP50 = gpu.length ? pct(gpu, 0.5) : null;
    const p50 = pct(dts, 0.5);
    const cpuAvg = frames > 0 ? this.cpuTotalMs / frames : 0;

    // 分辨率对照（后 1/3 时间 renderScale=0.5 → 像素 1/4）
    const normalFps = this.normalMs > 0 ? (this.normalFrames * 1000) / this.normalMs : 0;
    const lowFps = this.lowMs > 0 ? (this.lowFrames * 1000) / this.lowMs : 0;
    const gain = normalFps > 0 && lowFps > 0 ? lowFps / normalFps : 0;

    // 判定
    let verdict: string;
    const tickMs = perFrame('tick');
    const drainMs = perFrame('drain');
    const meshMs = perFrame('mesh');
    const top = phaseRows.find((r) => r.name !== 'tick') ?? phaseRows[0];
    if (frames === 0) verdict = '没有采到帧';
    else if (gain > 1.2) {
      verdict = `GPU 填充率瓶颈：降到 50% 分辨率后 ${f1(lowFps)} fps（正常 ${f1(normalFps)} fps，+${f1((gain - 1) * 100)}%）`
        + ` → 降分辨率 / 关后处理直接有效`;
    } else if (tickMs > cpuAvg * 0.45 && tickMs > 3) {
      verdict = `主线程瓶颈在 tick：${f1(tickMs)}ms/帧（占整帧 ${f1((tickMs / cpuAvg) * 100)}%），`
        + `其中区块 apply ${f1(drainMs)}ms、建网格 ${f1(meshMs)}ms；降分辨率无效`;
    } else if (top && top.pf > cpuAvg * 0.3 && top.pf > 3) {
      verdict = `主线程瓶颈：${top.name} ${f1(top.pf)}ms/帧（占整帧 ${f1((top.pf / cpuAvg) * 100)}%）`;
    } else if (gpuP50 !== null && gpuP50 > p50 * 0.7) {
      verdict = `GPU 瓶颈：场景 pass ${f1(gpuP50)}ms/帧（帧间隔 ${f1(p50)}ms），降分辨率/关后处理有效`;
    } else if (cpuAvg < p50 * 0.6) {
      verdict = `不是 CPU 也不是 3D GPU：主线程每帧只有 ${f1(cpuAvg)}ms、降分辨率也只从 ${f1(normalFps)} 到 ${f1(lowFps)} fps`
        + ` → 呈现/合成（canvas 尺寸、DPR、GUI 2D 绘制、浏览器 vsync）`;
    } else {
      verdict = `混合：主线程每帧 ${f1(cpuAvg)}ms，帧间隔 ${f1(p50)}ms`;
    }

    const lines: string[] = [];
    lines.push('=== webcraft26 性能报告 ===');
    lines.push(`时间 ${new Date().toISOString()}`);
    for (const [k, v] of Object.entries(this.env)) lines.push(`${k}: ${typeof v === 'object' ? JSON.stringify(v) : String(v)}`);
    lines.push('');
    lines.push(`采样 ${f1(totalMs / 1000)}s / ${frames} 帧 → ${f1(fps)} fps`);
    lines.push(`帧间隔 p50 ${f1(p50)}ms | p95 ${f1(pct(dts, 0.95))}ms | p99 ${f1(pct(dts, 0.99))}ms | max ${f1(dts[n - 1] ?? 0)}ms`);
    lines.push(`分布 <8ms ${bucket(0, 8)} | 8-16 ${bucket(8, 16)} | 16-24 ${bucket(16, 24)} | 24-33 ${bucket(24, 33)} | 33-50 ${bucket(33, 50)} | 50-100 ${bucket(50, 100)} | >100 ${bucket(100, 1e9)}`);
    lines.push(`每秒帧数 ${this.perSecond.join(' ')}`);
    const refresh = this.game.pacer.stats().refresh;
    lines.push(`刷新率估计 ${f1(1000 / refresh)}Hz${fps >= 0.9 * (1000 / refresh) ? '（已跑满刷新率：想要更高 fps 需要 120/144Hz 屏幕，浏览器 rAF 不会超过它）' : ''}`);
    lines.push(`长任务 ${this.longTasks.length} 个${this.longTasks.length ? `，最长 ${f1(Math.max(...this.longTasks))}ms` : ''}`);
    lines.push(`最长帧 ${this.longest.map((l) => `${f1(l.ms)}ms@${l.at}ms`).join(' | ') || '—'}`);
    // 渲染配置用「报告时刻」的实时值：install() 时后处理目标还没分配，读到的会是默认值。
    const post = this.game.renderer.post.stats as {
      hdrFormat?: string; bloomMips?: number; ssao?: boolean; taa?: boolean; depthTexture?: boolean;
    };
    const shadowsOn = this.game.renderer.directLightState?.shadowsActive ?? false;
    lines.push(`渲染配置: 光影 ${this.game.renderer.shadersEnabled ? '开' : '关'} | HDR ${post.hdrFormat ?? '?'} | bloom ${post.bloomMips ?? 0} 级`
      + ` | SSAO ${post.ssao ? '开' : '关'} | TAA ${post.taa ? '开' : '关'}`
      + ` | 阴影 ${this.game.renderer.post.shadowSize}px ${shadowsOn ? '绘制中' : '关闭'}`);
    // 相机姿态 / 各方向速度 / 屏幕尺寸 / 未建网格 section：一份报告就能区分物理、流式加载和呈现问题。
    const diag = this.game.perfDiagnostics?.();
    if (diag) {
      lines.push('');
      lines.push('玩家与屏幕诊断:');
      for (const [k, v] of Object.entries(diag)) lines.push(`  ${k}: ${v}`);
    }
    lines.push('');
    lines.push('主线程分项（每帧 ms / 单次最大 ms / 调用次数；tick 内含 drain+mesh）:');
    for (const r of phaseRows) {
      lines.push(`  ${r.name.padEnd(10)} ${f1(r.pf).padStart(7)} / ${f1(r.p!.max).padStart(7)} / ${r.p!.n}`);
    }
    lines.push(`  整帧主线程 ${f1(cpuAvg).padStart(7)} / ${f1(this.cpuMaxMs).padStart(7)} / ${frames}  (rAF 回调总耗时，含框架代码)`);
    lines.push('');
    lines.push(`GPU 场景 pass: ${gpuP50 === null ? '无数据（手机浏览器通常不给这个扩展，可忽略）' : `p50 ${f1(gpuP50)}ms / p95 ${f1(pct(gpu, 0.95))}ms`}`);
    lines.push(`分辨率对照: 正常 ${f1(normalFps)} fps (${f1(this.normalMs / 1000)}s) → 3D 降到 50% ${f1(lowFps)} fps (${f1(this.lowMs / 1000)}s)  = ${gain > 0 ? `x${gain.toFixed(2)}` : 'n/a'}`);
    lines.push(`draw call: ${f1(this.drawsTotal / Math.max(1, frames))}/帧`);
    lines.push(`区块: 已加载 ${this.game.level.chunks.size} | section ${this.game.renderer.meshStats.sections} | 队列 ${this.game.chunkProvider.queueLength}`);
    lines.push(`每帧应用区块 ${f1(this.appliedTotal / Math.max(1, frames))} 个 | 每帧建网格 ${f1(this.meshedTotal / Math.max(1, frames))} 个 section | 实体 ${this.game.entityManager.getEntities().length}`);
    lines.push(`FramePacer: ${JSON.stringify(this.game.pacer.stats())}`);
    lines.push('');
    lines.push(`判定: ${verdict}`);
    return lines.join('\n');
  }

  // ------------------------------------------------------------------- UI

  private buildPanel(): void {
    if (this.panel) return;
    const panel = document.createElement('div');
    panel.id = 'perf-log-panel';
    panel.style.cssText = [
      'position:fixed', 'left:8px', 'top:8px', 'z-index:9999', 'max-width:min(92vw,560px)',
      'max-height:76vh', 'display:flex', 'flex-direction:column', 'gap:6px',
      'background:rgba(0,0,0,.82)', 'color:#e8e8e8', 'border:1px solid #666',
      'border-radius:6px', 'padding:8px', 'font:11px/1.35 ui-monospace,Consolas,monospace',
      'pointer-events:auto', 'user-select:text',
    ].join(';');
    const head = document.createElement('div');
    head.textContent = `性能采样 ${this.seconds}s`;
    head.style.cssText = 'font-weight:700;font-size:12px';
    const live = document.createElement('div');
    live.textContent = '采样中…';
    live.style.cssText = 'color:#9fd0ff';
    const body = document.createElement('pre');
    body.style.cssText = 'margin:0;white-space:pre-wrap;overflow:auto;max-height:52vh;color:#cfcfcf';
    const bar = document.createElement('div');
    bar.style.cssText = 'display:flex;gap:6px;flex-wrap:wrap';
    const btn = (label: string, fn: () => void): HTMLButtonElement => {
      const b = document.createElement('button');
      b.textContent = label;
      b.style.cssText = 'font:inherit;padding:5px 9px;border-radius:4px;border:1px solid #777;background:#2a2a2a;color:#eee';
      b.onclick = fn;
      return b;
    };
    bar.append(
      btn('重新采样', () => this.start()),
      btn('复制报告', () => { void this.copyReport(); }),
      btn('下载报告', () => this.downloadReport()),
      btn('收起', () => { panel.style.display = 'none'; }),
    );
    panel.append(head, live, body, bar);
    document.body.appendChild(panel);
    this.panel = panel;
    this.panelBody = body;
    this.liveLine = live;
  }

  private getReport(): string {
    return this.recording ? '采样还没结束，等它跑完（或点「重新采样」后再等）' : this.lastReport;
  }

  private async copyReport(): Promise<void> {
    const text = this.getReport();
    try {
      await navigator.clipboard.writeText(text);
      if (this.liveLine) this.liveLine.textContent = '已复制到剪贴板';
    } catch {
      if (this.liveLine) this.liveLine.textContent = '复制失败，请用「下载报告」';
    }
  }

  private downloadReport(): void {
    const text = this.getReport();
    const blob = new Blob([text], { type: 'text/plain;charset=utf-8' });
    const a = document.createElement('a');
    a.href = URL.createObjectURL(blob);
    a.download = `webcraft-perf-${new Date().toISOString().replace(/[:.]/g, '-')}.txt`;
    a.click();
    setTimeout(() => URL.revokeObjectURL(a.href), 4000);
  }

  /** 关掉采样和所有钩子（正常游玩不需要调用，留作调试）。 */
  dispose(): void {
    this.recording = false;
    for (const restore of this.wrapRestore) restore();
    this.wrapRestore.length = 0;
    this.panel?.remove();
    this.panel = null;
  }
}

