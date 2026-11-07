import { loadBitmap } from './gl.js';
import { VanillaFont } from './font.js';
import type { Manifest, TextureInfo } from './types.js';

const BASE = '/mc/';

export interface LoadedAssets {
  manifest: Manifest;
  texArray: WebGLTexture;
  icons: Map<string, ImageBitmap>;
  gui: Record<string, ImageBitmap>;
  env: Record<string, ImageBitmap>;
  font: VanillaFont;
  grassColormap: ImageData;
  foliageColormap: ImageData;
}

export type ProgressFn = (fraction: number, label: string) => void;

async function loadImageData(url: string): Promise<ImageData> {
  const bmp = await loadBitmap(url, { premultiplyAlpha: 'none', colorSpaceConversion: 'none' });
  const c = document.createElement('canvas');
  c.width = bmp.width;
  c.height = bmp.height;
  const ctx = c.getContext('2d', { willReadFrequently: true })!;
  ctx.imageSmoothingEnabled = false;
  ctx.drawImage(bmp, 0, 0);
  return ctx.getImageData(0, 0, c.width, c.height);
}

export async function loadAssets(gl: WebGL2RenderingContext, progress: ProgressFn): Promise<LoadedAssets> {
  progress(0.02, 'Loading manifest');
  const manifest = await (await fetch(BASE + 'manifest.json')).json() as Manifest;

  const texArray = gl.createTexture()!;
  gl.bindTexture(gl.TEXTURE_2D_ARRAY, texArray);
  const levels = 5;
  gl.texStorage3D(gl.TEXTURE_2D_ARRAY, levels, gl.RGBA8, 16, 16, manifest.layerCount);
  gl.texParameteri(gl.TEXTURE_2D_ARRAY, gl.TEXTURE_MIN_FILTER, gl.NEAREST);
  gl.texParameteri(gl.TEXTURE_2D_ARRAY, gl.TEXTURE_MAG_FILTER, gl.NEAREST);
  gl.texParameteri(gl.TEXTURE_2D_ARRAY, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
  gl.texParameteri(gl.TEXTURE_2D_ARRAY, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
  gl.pixelStorei(gl.UNPACK_FLIP_Y_WEBGL, false);
  gl.pixelStorei(gl.UNPACK_PREMULTIPLY_ALPHA_WEBGL, true);

  const icons = new Map<string, ImageBitmap>();
  const arrayTextures = Object.values(manifest.textures)
    .filter(t => t.arrayLayer >= 0 && t.framePaths.length > 0)
    .sort((a, b) => a.arrayLayer - b.arrayLayer);
  let done = 0;
  for (let i = 0; i < arrayTextures.length; i += 8) {
    const batch = arrayTextures.slice(i, i + 8);
    const bitmaps = await Promise.all(batch.map(async (t: TextureInfo) => {
      const frames = await Promise.all(t.framePaths.map(p => loadBitmap(p, { premultiplyAlpha: 'none', colorSpaceConversion: 'none' })));
      return { t, frames };
    }));
    for (const { t, frames } of bitmaps) {
      frames.forEach((bmp, f) => {
        gl.texSubImage3D(gl.TEXTURE_2D_ARRAY, 0, 0, 0, t.arrayLayer + f, 16, 16, 1, gl.RGBA, gl.UNSIGNED_BYTE, bmp);
      });
      icons.set(t.key, frames[0]);
      done++;
    }
    progress(0.05 + 0.55 * (done / arrayTextures.length), `Stitching textures ${done}/${arrayTextures.length}`);
    await new Promise(r => setTimeout(r, 0));
  }
  gl.generateMipmap(gl.TEXTURE_2D_ARRAY);
  progress(0.62, 'Loading interface');

  const guiUrls: Record<string, string> = {
    hotbar: manifest.gui.hotbar,
    hotbarSelection: manifest.gui.hotbarSelection,
    crosshair: manifest.gui.crosshair,
    title: BASE + 'gui/title/minecraft.png',
    button: BASE + 'gui/sprites/widget/button.png',
    buttonHighlighted: BASE + 'gui/sprites/widget/button_highlighted.png',
    inventory: BASE + 'gui/container/inventory.png',
    creativeItems: BASE + 'gui/container/creative_inventory/tab_items.png',
    creativeInventory: BASE + 'gui/container/creative_inventory/tab_inventory.png',
    creativeSearch: BASE + 'gui/container/creative_inventory/tab_item_search.png',
    craftingTable: BASE + 'gui/container/crafting_table.png',
    generic54: BASE + 'gui/container/generic_54.png',
    furnace: BASE + 'gui/container/furnace.png',
    creativeScroller: BASE + 'gui/sprites/container/creative_inventory/scroller.png',
    creativeScrollerDisabled: BASE + 'gui/sprites/container/creative_inventory/scroller_disabled.png',
    heartContainer: BASE + 'gui/sprites/hud/heart/container.png',
    heartFull: BASE + 'gui/sprites/hud/heart/full.png',
    heartHalf: BASE + 'gui/sprites/hud/heart/half.png',
  };
  for (let i = 1; i <= 7; i++) {
    guiUrls[`tabTopSelected${i}`] = `${BASE}gui/sprites/container/creative_inventory/tab_top_selected_${i}.png`;
    guiUrls[`tabTopUnselected${i}`] = `${BASE}gui/sprites/container/creative_inventory/tab_top_unselected_${i}.png`;
    guiUrls[`tabBottomSelected${i}`] = `${BASE}gui/sprites/container/creative_inventory/tab_bottom_selected_${i}.png`;
    guiUrls[`tabBottomUnselected${i}`] = `${BASE}gui/sprites/container/creative_inventory/tab_bottom_unselected_${i}.png`;
  }
  const gui: Record<string, ImageBitmap> = {};
  await Promise.all(Object.entries(guiUrls).map(async ([k, url]) => {
    if (!url) return;
    gui[k] = await loadBitmap(url, { premultiplyAlpha: 'none', colorSpaceConversion: 'none' });
  }));

  const env: Record<string, ImageBitmap> = {};
  const envUrls: Record<string, string | undefined> = {
    sun: manifest.environment.sun,
    moon: BASE + 'environment/celestial/moon/full_moon.png',
    clouds: manifest.environment.clouds,
    underwater: manifest.environment.underwater,
    rain: manifest.environment.rain,
    snow: manifest.environment.snow,
    vignette: manifest.environment.vignette,
  };
  await Promise.all(Object.entries(envUrls).map(async ([k, url]) => {
    if (!url) return;
    env[k] = await loadBitmap(url, { premultiplyAlpha: 'none', colorSpaceConversion: 'none' });
  }));

  progress(0.7, 'Loading font');
  const [grassColormap, foliageColormap, font] = await Promise.all([
    loadImageData(manifest.colormap.grass),
    loadImageData(manifest.colormap.foliage),
    VanillaFont.load(manifest.font, BASE),
  ]);

  return { manifest, texArray, icons, gui, env, font, grassColormap, foliageColormap };
}

export function sampleColormap(map: ImageData, temperature: number, humidity: number): [number, number, number] {
  const rain = humidity * temperature;
  const tx = Math.max(0, Math.min(255, Math.floor((1 - temperature) * 255)));
  const ty = Math.max(0, Math.min(255, Math.floor((1 - rain) * 255)));
  const i = (ty * map.width + tx) * 4;
  return [map.data[i] / 255, map.data[i + 1] / 255, map.data[i + 2] / 255];
}
