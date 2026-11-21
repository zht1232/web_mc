// Entry point: boots the client behind the vanilla Mojang Studios loading screen.
//
// Sources (26.2): net.minecraft.client.gui.screens.LoadingOverlay /
// net.minecraft.client.MojangStudiosLogo / net.minecraft.client.gui.screens.TitleScreen.
// The Mojang splash is a flat red (#EF3239) background with the white MOJANG STUDIOS
// wordmark centred, and LoadingOverlay's progress bar at the bottom: a hairline white
// bordered track with a filled portion and a percentage on the right.

import './client/style.css';
import './client/touch/touch.css';
import { Game } from './client/Game.js';

const app = document.getElementById('app')!;

const loading = document.createElement('div');
loading.className = 'loading-screen';
// The packaged mojangstudios.png is the square "interleaved" mark (MOJ / STU / ANG / DIOS
// stacked in four rows). The user wants the horizontal wordmark: four slices of that same
// atlas are laid out on one baseline with CSS (`background-position`), so the pixels stay the
// official asset and nothing is redrawn. Offsets are source-pixel coordinates of the PNG.
loading.innerHTML = `
  <div class="loading-stack">
    <div class="loading-logo" role="img" aria-label="Mojang Studios">
      <i class="wm wm-moj"></i><i class="wm wm-ang"></i><i class="wm wm-stu"></i><i class="wm wm-dios"></i>
    </div>
    <div class="loading-progress">
      <div class="loading-bar"><div class="loading-fill" id="loading-fill"></div></div>
      <div class="loading-row">
        <div class="loading-status" id="loading-status">正在加载…</div>
        <div class="loading-percent" id="loading-percent">0%</div>
      </div>
    </div>
  </div>
`;
app.appendChild(loading);

const fill = loading.querySelector('#loading-fill') as HTMLDivElement;
const status = loading.querySelector('#loading-status') as HTMLDivElement;
const percent = loading.querySelector('#loading-percent') as HTMLDivElement;

/**
 * Cold-boot breakdown, read by `scripts/perf-audit.mjs` (and inspectable in devtools as
 * `__bootTimings`). Every `Game.onStatus` stage gets a timestamp so a slow boot can be
 * attributed to one asset load instead of guessed at.
 */
const bootTimings: { stage: string; at: number; progress: number }[] = [];
(window as unknown as { __bootTimings: unknown }).__bootTimings = bootTimings;
const bootStart = performance.now();

async function boot() {
  const params = new URLSearchParams(location.search);
  const workers = params.has('workers') ? Number(params.get('workers')) : undefined;
  // Seed stays a string: vanilla seeds are 64-bit / arbitrary text, Game parses it as a bigint.
  const seed = params.get('seed') ?? undefined;
  const game = new Game(app, seed, workers);
  game.onStatus = (text, progress) => {
    bootTimings.push({ stage: text, at: +(performance.now() - bootStart).toFixed(1), progress });
    const pct = Math.max(0, Math.min(100, Math.round(progress * 100)));
    fill.style.width = `${pct}%`;
    percent.textContent = `${pct}%`;
    status.textContent = text;
  };

  try {
    await game.init();
    bootTimings.push({ stage: 'ready', at: +(performance.now() - bootStart).toFixed(1), progress: 1 });
    loading.classList.add('hidden');
    setTimeout(() => loading.remove(), 400);
    game.start();
    (window as unknown as { __mc: unknown }).__mc = game;
  } catch (err) {
    console.error(err);
    status.textContent = `加载失败: ${(err as Error).message}`;
    const detail = document.createElement('pre');
    detail.className = 'loading-error';
    detail.textContent = (err as Error).stack ?? '';
    loading.querySelector('.loading-bottom')?.appendChild(detail);
  }
}

void boot();
