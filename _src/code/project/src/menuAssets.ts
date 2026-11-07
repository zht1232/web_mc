// Minimal self-contained asset loader for the vanilla menu shell.
// Everything is read from the official local 26.2 files under public/mc;
// it deliberately does not depend on the game's LoadedAssets/manifest.
import { VanillaFont } from './font.js';

export const MENU_BASE = '/mc/';

export const MENU_URLS = {
  panorama: [0, 1, 2, 3, 4, 5].map(i => `${MENU_BASE}gui/title/background/panorama_${i}.png`),
  panoramaFallback: `${MENU_BASE}gui/title/background/panorama_0.png`,
  panoramaOverlay: `${MENU_BASE}gui/title/background/panorama_overlay.png`,
  logo: `${MENU_BASE}gui/title/minecraft.png`,
  splashes: `${MENU_BASE}texts/splashes.txt`,
  dirt: `${MENU_BASE}textures/block/dirt.png`,
  islandIcon: `${MENU_BASE}gui/presets/isles.png`,
  button: `${MENU_BASE}gui/sprites/widget/button.png`,
  buttonHighlighted: `${MENU_BASE}gui/sprites/widget/button_highlighted.png`,
  buttonDisabled: `${MENU_BASE}gui/sprites/widget/button_disabled.png`,
  slider: `${MENU_BASE}gui/sprites/widget/slider.png`,
  sliderHighlighted: `${MENU_BASE}gui/sprites/widget/slider_highlighted.png`,
  sliderHandle: `${MENU_BASE}gui/sprites/widget/slider_handle.png`,
  sliderHandleHighlighted: `${MENU_BASE}gui/sprites/widget/slider_handle_highlighted.png`,
  textField: `${MENU_BASE}gui/sprites/widget/text_field.png`,
  textFieldHighlighted: `${MENU_BASE}gui/sprites/widget/text_field_highlighted.png`,
  language: `${MENU_BASE}gui/sprites/icon/language.png`,
  accessibility: `${MENU_BASE}gui/sprites/icon/accessibility.png`,
  pingUnknown: `${MENU_BASE}gui/sprites/icon/ping_unknown.png`,
  offline: `${MENU_BASE}gui/sprites/server_list/unreachable.png`,
  ping: [1, 2, 3, 4, 5].map(i => `${MENU_BASE}gui/sprites/server_list/ping_${i}.png`),
  listBackground: `${MENU_BASE}gui/menu_list_background.png`,
  buttonClick: `${MENU_BASE}sounds/ui.button.click/click_stereo.ogg`,
} as const;

/** Images that the CSS references and that are worth warming in the cache. */
const PRELOAD_URLS = [
  MENU_URLS.logo,
  MENU_URLS.dirt,
  MENU_URLS.islandIcon,
  MENU_URLS.button,
  MENU_URLS.buttonHighlighted,
  MENU_URLS.buttonDisabled,
  MENU_URLS.slider,
  MENU_URLS.sliderHighlighted,
  MENU_URLS.sliderHandle,
  MENU_URLS.sliderHandleHighlighted,
  MENU_URLS.textField,
  MENU_URLS.textFieldHighlighted,
  MENU_URLS.language,
  MENU_URLS.accessibility,
  MENU_URLS.offline,
  MENU_URLS.pingUnknown,
  ...MENU_URLS.ping,
];

const FALLBACK_SPLASHES = [
  'As seen on TV!',
  'Awesome!',
  '100% pure!',
  'More polygons!',
  'Moderately attractive!',
  'Best in class!',
  'Excitement!',
  'One of a kind!',
  'Spiders everywhere!',
  'Check it out!',
  'Holy cow, man!',
  'It is a game!',
  'Made by Mojang!',
  'Now with 31% more bytes!',
  'Pixels!',
  'Absolutely dragon free!',
  'Erm...',
  'Minecraft!',
  'Haunted!',
  'Touching your face!',
];

export interface MenuAssets {
  font: VanillaFont | null;
  /** Panorama faces in official file order (0..5). Null means that face failed. */
  panorama: (ImageBitmap | null)[];
  splashes: string[];
  errors: string[];
}

export type MenuAssetProgress = (fraction: number, label: string) => void;

function loadBitmap(url: string): Promise<ImageBitmap> {
  return fetch(url).then(async res => {
    if (!res.ok) throw new Error(`fetch ${url}: ${res.status}`);
    const blob = await res.blob();
    return createImageBitmap(blob, { premultiplyAlpha: 'none', colorSpaceConversion: 'none' });
  });
}

function preloadImage(url: string): Promise<void> {
  return new Promise(resolve => {
    const img = new Image();
    img.decoding = 'async';
    img.onload = () => resolve();
    img.onerror = () => resolve();
    img.src = url;
  });
}

async function loadSplashes(): Promise<string[]> {
  try {
    const res = await fetch(MENU_URLS.splashes, { cache: 'no-cache' });
    if (!res.ok) throw new Error(String(res.status));
    const text = await res.text();
    const lines = text.split(/\r?\n/)
      .map(line => line.trim())
      .filter(line => line.length > 0)
      .filter(line => /^[\x20-\x7e]+$/.test(line))
      .filter(line => line.length <= 120);
    if (lines.length) return lines;
    return FALLBACK_SPLASHES;
  } catch {
    return FALLBACK_SPLASHES;
  }
}

/**
 * Loads only what the menu needs: the bitmap font, six panorama faces,
 * official splash lines and a warm cache for the widget sprites.
 * Failures are tolerated so the menu can still render its shell.
 */
export async function loadMenuAssets(progress?: MenuAssetProgress): Promise<MenuAssets> {
  const errors: string[] = [];
  const total = 6 + PRELOAD_URLS.length + 2;
  let done = 0;
  const tick = (label: string) => {
    done++;
    progress?.(Math.min(1, done / total), label);
  };

  const fontPromise = VanillaFont.load({}, MENU_BASE)
    .catch((err: unknown) => {
      errors.push(`font: ${String(err)}`);
      return null;
    })
    .finally(() => tick('Loading font'));

  const splashPromise = loadSplashes().finally(() => tick('Loading splashes'));

  const panoramaPromise = Promise.all(MENU_URLS.panorama.map(async (url, i) => {
    try {
      const bmp = await loadBitmap(url);
      tick('Loading panorama');
      return bmp;
    } catch (err) {
      errors.push(`panorama ${i}: ${String(err)}`);
      tick('Loading panorama');
      return null;
    }
  }));

  const preloadPromise = Promise.all(PRELOAD_URLS.map(async url => {
    await preloadImage(url);
    tick('Loading interface');
  }));

  const [font, splashes, panorama] = await Promise.all([fontPromise, splashPromise, panoramaPromise, preloadPromise])
    .then(([f, s, p]) => [f, s, p] as const);

  return { font, panorama, splashes, errors };
}
