#!/usr/bin/env node
// Copies the official 26.2 entity textures used by the mob slice into
// public/mc/entities. These assets are Mojang property: local use only.
import { access, copyFile, mkdir } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const here = path.dirname(fileURLToPath(import.meta.url));
const root = path.resolve(here, '..');
const MC = process.env.MC_ASSETS;
if (!MC) {
  console.error('Set MC_ASSETS to the assets/minecraft directory extracted from your own Minecraft 26.2 client.jar.');
  process.exit(1);
}
const SRC = path.join(MC, 'textures', 'entity');
const OUT = path.join(root, 'public', 'mc', 'entities');

// 26.2 stores variants in subfolders; older layouts used entity/<mob>.png.
const MOBS = {
  pig: ['pig/pig_temperate.png', 'pig/pig.png', 'pig.png'],
  cow: ['cow/cow_temperate.png', 'cow/cow.png', 'cow.png'],
  zombie: ['zombie/zombie.png', 'zombie.png'],
  skeleton: ['skeleton/skeleton.png', 'skeleton.png'],
};

async function exists(p) {
  try { await access(p); return true; } catch { return false; }
}

await mkdir(OUT, { recursive: true });
let copied = 0;
for (const [name, candidates] of Object.entries(MOBS)) {
  let from = null;
  for (const rel of candidates) {
    const p = path.join(SRC, rel);
    if (await exists(p)) { from = p; break; }
  }
  if (!from) {
    console.warn(`[mobs] missing ${name}; keep existing ${path.join(OUT, name + '.png')}`);
    continue;
  }
  await copyFile(from, path.join(OUT, `${name}.png`));
  copied++;
  console.log(`[mobs] ${name}.png <- ${path.relative(MC, from)}`);
}
console.log(`[mobs] ${copied}/${Object.keys(MOBS).length} textures copied to public/mc/entities`);
