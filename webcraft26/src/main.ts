// Entry point: boots the client, shows the loading screen, then hands over to the game.

import './client/style.css';
import { Game } from './client/Game.js';

const app = document.getElementById('app')!;

const loading = document.createElement('div');
loading.className = 'loading-screen';
loading.innerHTML = `
  <div class="loading-title">Minecraft</div>
  <div class="loading-sub">26.2 · browser client</div>
  <div class="loading-bar"><div class="loading-fill" id="loading-fill"></div></div>
  <div class="loading-status" id="loading-status">Starting</div>
`;
app.appendChild(loading);

const fill = loading.querySelector('#loading-fill') as HTMLDivElement;
const status = loading.querySelector('#loading-status') as HTMLDivElement;

async function boot() {
  const params = new URLSearchParams(location.search);
  const workers = params.has('workers') ? Number(params.get('workers')) : undefined;
  const game = new Game(app, params.has('seed') ? Number(params.get('seed')) : undefined, workers);
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
    loading.appendChild(detail);
  }
}

void boot();
