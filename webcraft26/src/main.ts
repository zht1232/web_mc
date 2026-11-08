// Entry point: boots the client, shows the vanilla-style loading overlay, then hands over to the game.
//
// The overlay mirrors LoadingOverlay in 26.2: a black screen, the Mojang Studios logo centred, and
// a thin progress bar at the bottom with a percentage on the right.

import './client/style.css';
import './client/touch/touch.css';
import { Game } from './client/Game.js';

const app = document.getElementById('app')!;

const loading = document.createElement('div');
loading.className = 'loading-screen';
loading.innerHTML = `
  <div class="loading-center">
    <img class="loading-logo" src="/mc/textures/gui/title/mojangstudios.png" alt="Mojang Studios" />
  </div>
  <div class="loading-bottom">
    <div class="loading-bar"><div class="loading-fill" id="loading-fill"></div></div>
    <div class="loading-status" id="loading-status">正在启动…</div>
  </div>
`;
app.appendChild(loading);

const fill = loading.querySelector('#loading-fill') as HTMLDivElement;
const status = loading.querySelector('#loading-status') as HTMLDivElement;

async function boot() {
  const params = new URLSearchParams(location.search);
  const workers = params.has('workers') ? Number(params.get('workers')) : undefined;
  // Seed stays a string: vanilla seeds are 64-bit / arbitrary text, Game parses it as a bigint.
  const seed = params.get('seed') ?? undefined;
  const game = new Game(app, seed, workers);
  game.onStatus = (text, progress) => {
    fill.style.width = `${Math.round(progress * 100)}%`;
    status.textContent = text;
  };

  try {
    await game.init();
    loading.classList.add('hidden');
    setTimeout(() => loading.remove(), 400);
    game.start();
    (window as unknown as { __mc: unknown }).__mc = game;
  } catch (err) {
    console.error(err);
    status.textContent = `Load failed: ${(err as Error).message}`;
    const detail = document.createElement('pre');
    detail.className = 'loading-error';
    detail.textContent = (err as Error).stack ?? '';
    loading.querySelector('.loading-bottom')?.appendChild(detail);
  }
}

void boot();
