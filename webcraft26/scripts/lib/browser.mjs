// Shared headless-browser launch options. The pinned playwright (1.50) wants chromium 1155, but the
// machine only has the newer 1228 headless shell installed, so point at it explicitly.
// Override with CHROME_PATH if it moves.
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

export function chromePath() {
  if (process.env.CHROME_PATH) return process.env.CHROME_PATH;
  const root = path.join(process.env.PLAYWRIGHT_BROWSERS_PATH || path.join(os.homedir(), 'AppData', 'Local', 'ms-playwright'));
  if (!fs.existsSync(root)) return undefined;
  const shells = fs.readdirSync(root).filter((d) => d.startsWith('chromium_headless_shell-')).sort().reverse();
  for (const d of shells) {
    const exe = path.join(root, d, 'chrome-headless-shell-win64', 'chrome-headless-shell.exe');
    if (fs.existsSync(exe)) return exe;
  }
  return undefined;
}

// GL_MODE=gpu (default): real GPU through ANGLE/D3D11, ~10x faster than software. GL_MODE=swiftshader: CPU fallback.
export const GL_ARGS = process.env.GL_MODE === 'swiftshader'
  ? ['--use-gl=angle', '--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--disable-gpu-sandbox', '--no-sandbox', '--ignore-gpu-blocklist']
  : ['--use-gl=angle', '--use-angle=d3d11', '--ignore-gpu-blocklist', '--no-sandbox', '--enable-gpu'];

export function launchOptions(extra = {}) {
  const executablePath = chromePath();
  return { headless: true, args: GL_ARGS, ...(executablePath ? { executablePath } : {}), ...extra };
}
