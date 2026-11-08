// Node logic test for the ported net.minecraft.client.gui system.
//
//   npx tsx scripts/test-gui.mts
//
// Node has no DOM, so only pure modules are imported at top level (no browser
// API is touched during import). Widget classes are import-safe too: every
// DOM-dependent dependency is behind `import type` and therefore erased.
//
// Java sources the assertions are transcribed from:
//   net.minecraft.client.gui.screens.TitleScreen#init / #createNormalMenuOptions
//   com.mojang.blaze3d.platform.Window#calculateScale
//   net.minecraft.client.Options (Options.java:911, getMaxGuiScale)
//   net.minecraft.world.inventory.AbstractContainerMenu#addStandardInventorySlots
//   net.minecraft.world.inventory.InventoryMenu
//   net.minecraft.client.gui.components.AbstractWidget#isMouseOver
//   net.minecraft.client.gui.components.Button
//   assets/minecraft/atlases/gui.json equivalent: <sprite>.png.mcmeta

import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import { computeTitleScreenLayout, JAVA_TITLE_CONSTANTS } from '../src/client/gui/layout/TitleLayout.js';
import { calcGuiScale, getMaxGuiScale, autoGuiScale } from '../src/client/gui/GuiScale.js';
import {
  survivalInventorySlotXY,
  inventoryMenuSlotXY,
  menuSlotToInventoryIndex,
  containerOrigin,
  isHotbarSlot,
  isMainInventorySlot,
  playerInventorySlotRects,
  JAVA_SLOT_CONSTANTS,
} from '../src/client/gui/screens/inventory/SlotLayout.js';
import {
  DEFAULT_CREATIVE_TABS,
  loadCreativeTabs,
  countCreativeTabs,
  validateCreativeTabs,
  itemId,
} from '../src/client/gui/CreativeTabs.js';
import { wrapText, wrapTooltipLines, splitLines } from '../src/client/gui/components/wordWrap.js';
import { parseScaling, computeNineSlicePatches, type NineSliceScaling, type McMeta } from '../src/client/gui/GuiSpriteAtlas.js';
import { Button } from '../src/client/gui/components/Button.js';
import { Tooltip } from '../src/client/gui/components/Tooltip.js';
import { TitleScreen } from '../src/client/gui/screens/TitleScreen.js';
import { CreativeModeInventoryScreen } from '../src/client/gui/screens/inventory/CreativeModeInventoryScreen.js';
import { AbstractContainerScreen, MemoryContainerMenu } from '../src/client/gui/screens/inventory/AbstractContainerScreen.js';
import type { ScreenEnv, Rect, ContainerAction, ContainerMenuLike, MouseAction } from '../src/client/gui/Types.js';

const here = path.dirname(fileURLToPath(import.meta.url));
const root = path.resolve(here, '..');
const readJson = (p: string): unknown => JSON.parse(fs.readFileSync(path.resolve(root, p), 'utf8'));

let failures = 0;
let checks = 0;

function check(name: string, condition: boolean, detail = ''): void {
  checks++;
  const ok = !!condition;
  if (!ok) failures++;
  console.log(`${ok ? 'PASS' : 'FAIL'}  ${name}${detail ? `  -- ${detail}` : ''}`);
}

function eqRect(actual: Rect, x: number, y: number, w: number, h: number): boolean {
  return actual.x === x && actual.y === y && actual.width === w && actual.height === h;
}

function rectStr(r: Rect): string {
  return `(${r.x},${r.y},${r.width}x${r.height})`;
}

// ---------------------------------------------------------------------------
// 1. TitleScreen button rectangles vs. Java constants
// ---------------------------------------------------------------------------
console.log('\n[1] TitleScreen button rectangles (TitleScreen.java)');

// Transcribed Java literals:
//   int spacing = 24; int topPos = this.height / 4 + 48;
//   .bounds(this.width / 2 - 100, topPos, 200, 20)             singleplayer
//   .bounds(this.width / 2 - 100, topPos + spacing, 200, 20)   multiplayer
//   .bounds(this.width / 2 - 100, topPos + spacing*2, 200, 20) online
//   topPos += 24;  // icon row, getHorizontalPosition(i, 3, 20)
//   topPos += 24;  // options / quit row
//   .bounds(this.width / 2 - 100, topPos, 98, 20)              options
//   .bounds(this.width / 2 + 2,  topPos, 98, 20)               quit
const W = 480, H = 270; // 1920x1080 at guiScale 4
const javaTop = Math.floor(H / 4) + 48;      // height / 4 + 48  = 115
const javaX = Math.floor(W / 2) - 100;       // width / 2 - 100  = 140
const javaSpacing = 24;
const javaIconRowY = javaTop + javaSpacing * 3;   // +72 then +24 = 187
const javaBottomY = javaIconRowY + javaSpacing;   // 211
const javaIconX0 = Math.floor(W / 2) - (3 * 20 + 2 * 4) / 2; // totalWidth 68 -> 206

check('JAVA_TITLE_CONSTANTS match the decompiled literals',
  JAVA_TITLE_CONSTANTS.SPACING === 24 && JAVA_TITLE_CONSTANTS.TOP_OFFSET === 48 &&
  JAVA_TITLE_CONSTANTS.BIG_BUTTON_WIDTH === 200 && JAVA_TITLE_CONSTANTS.BIG_BUTTON_HEIGHT === 20 &&
  JAVA_TITLE_CONSTANTS.BIG_BUTTON_X_OFFSET === 100 && JAVA_TITLE_CONSTANTS.HALF_BUTTON_WIDTH === 98 &&
  JAVA_TITLE_CONSTANTS.QUIT_X_OFFSET === 2 && JAVA_TITLE_CONSTANTS.ICON_BUTTON_SIZE === 20 &&
  JAVA_TITLE_CONSTANTS.ICON_BUTTON_COUNT === 3 && JAVA_TITLE_CONSTANTS.ICON_BUTTON_GAP === 4,
  'spacing=24, top=height/4+48, 200x20, 98x20, 3x20px icons');

const L = computeTitleScreenLayout(W, H, 0);
check('singleplayer = (width/2-100, height/4+48, 200, 20)',
  eqRect(L.singleplayer, javaX, javaTop, 200, 20), `${rectStr(L.singleplayer)} expected (${javaX},${javaTop},200x20)`);
check('multiplayer = (width/2-100, topPos+24, 200, 20)',
  eqRect(L.multiplayer, javaX, javaTop + 24, 200, 20), rectStr(L.multiplayer));
check('online = (width/2-100, topPos+48, 200, 20)',
  eqRect(L.online, javaX, javaTop + 48, 200, 20), rectStr(L.online));
check('3 icon buttons = 20x20 at getHorizontalPosition(i,3,20)',
  L.iconButtons.length === 3 &&
  eqRect(L.iconButtons[0], javaIconX0, javaIconRowY, 20, 20) &&
  eqRect(L.iconButtons[1], javaIconX0 + 24, javaIconRowY, 20, 20) &&
  eqRect(L.iconButtons[2], javaIconX0 + 48, javaIconRowY, 20, 20),
  L.iconButtons.map(rectStr).join(' '));
check('options = (width/2-100, topPos+96, 98, 20)',
  eqRect(L.options, javaX, javaBottomY, 98, 20), rectStr(L.options));
check('quit = (width/2+2, topPos+96, 98, 20)',
  eqRect(L.quit, Math.floor(W / 2) + 2, javaBottomY, 98, 20), rectStr(L.quit));
check('copyright = (width-copyrightWidth-2, height-10, copyrightWidth, 10)',
  eqRect(L.copyright, W - 0 - 2, H - 10, 0, 10), rectStr(L.copyright));
check('logo = (width/2-128, 30, 256x44) / edition at y=30+44-7',
  eqRect(L.logo, Math.floor(W / 2) - 128, 30, 256, 44) &&
  eqRect(L.edition, Math.floor(W / 2) - 64, 30 + 44 - 7, 128, 14), rectStr(L.logo));

// Also verify the *actual* TitleScreen widgets (not just the layout helper).
// A stub ScreenEnv keeps this DOM-free: async asset loads are fire-and-forget.
try {
  const noop = () => undefined;
  const stubEnv = {
    deps: {
      options: {}, callbacks: {}, i18n: (k: string) => k,
      font: { width: () => 0 },
      textures: { preload: async () => undefined, get: () => undefined },
      sprites: { get: () => undefined },
      icons: { draw: noop },
    },
    width: W, height: H, mods: 0,
    font: { width: () => 0 },
    textures: { preload: async () => undefined, get: () => undefined },
    sprites: { get: () => undefined },
    icons: { draw: noop },
    t: (k: string) => k,
    open: noop, close: noop, back: noop, toast: noop,
  } as unknown as ScreenEnv;
  const title = new TitleScreen(stubEnv);
  title.init(W, H);
  const rects = title.getButtonRects();
  check('TitleScreen actually creates 8 widgets (3 big + 3 icons + options + quit)',
    rects.length === 8, `got ${rects.length}`);
  check('TitleScreen widget[0] singleplayer rect matches Java',
    rects.length > 0 && eqRect(rects[0], javaX, javaTop, 200, 20), rects[0] ? rectsStr(rects[0]) : 'n/a');
  check('TitleScreen widget[1] multiplayer rect matches Java',
    rects.length > 1 && eqRect(rects[1], javaX, javaTop + 24, 200, 20), rects[1] ? rectsStr(rects[1]) : 'n/a');
  check('TitleScreen options / quit widgets match Java',
    rects.length >= 8 && eqRect(rects[6], javaX, javaBottomY, 98, 20) &&
    eqRect(rects[7], Math.floor(W / 2) + 2, javaBottomY, 98, 20),
    `${rects[6] ? rectsStr(rects[6]) : 'n/a'} ${rects[7] ? rectsStr(rects[7]) : 'n/a'}`);
} catch (e) {
  check('TitleScreen construction in Node', false, String(e));
}

function rectsStr(r: { x: number; y: number; width: number; height: number }): string {
  return `(${r.x},${r.y},${r.width}x${r.height})`;
}

// ---------------------------------------------------------------------------
// 2. guiScale vs. Window#calculateScale / Options#getMaxGuiScale
// ---------------------------------------------------------------------------
console.log('\n[2] guiScale algorithm (Window.java:445-463, Options.java:911)');

/** Independent transcription of the Java while-loop. */
function javaCalculateScale(w: number, h: number, maxScale: number, enforceUnicode: boolean): number {
  let scale = 1;
  while (scale !== maxScale && scale < w && scale < h &&
    Math.floor(w / (scale + 1)) >= 320 && Math.floor(h / (scale + 1)) >= 240) {
    scale++;
  }
  if (enforceUnicode && scale % 2 !== 0) scale++;
  return Math.max(1, scale);
}

const cases: [number, number, number][] = [
  [1920, 1080, 4],
  [1280, 720, 3],
  [800, 600, 2],
];
for (const [w, h, expected] of cases) {
  const got = calcGuiScale(w, h, 0, false);
  check(`guiScale ${w}x${h} = ${expected} (vanilla)`, got === expected, `got ${got}`);
  check(`guiScale ${w}x${h} matches the Java while-loop`, got === javaCalculateScale(w, h, 0, false),
    `java=${javaCalculateScale(w, h, 0, false)}`);
  check(`getMaxGuiScale ${w}x${h} = ${expected}`, getMaxGuiScale(w, h, false) === expected);
  check(`autoGuiScale(css w,h, dpr=1) ${w}x${h} = ${expected}`, autoGuiScale(w, h, 1) === expected);
}
// A broader sweep against the independent Java transcription.
let sweepOk = true;
for (let w = 320; w <= 3840; w += 160) {
  for (let h = 240; h <= 2160; h += 120) {
    for (const forced of [0, 1, 2, 3, 5]) {
      for (const uni of [false, true]) {
        if (calcGuiScale(w, h, forced, uni) !== javaCalculateScale(w, h, forced, uni)) sweepOk = false;
      }
    }
  }
}
check('calcGuiScale matches javaCalculateScale over 320..3840 sweep (incl. forced / unicode)', sweepOk);
check('forced guiScale=2 on 1920x1080 = 2', calcGuiScale(1920, 1080, 2, false) === 2);
check('enforceUnicode bumps odd 3 -> 4 on 1280x720', calcGuiScale(1280, 720, 0, true) === 4);
check('minimum guiScale is 1 on a tiny window', calcGuiScale(200, 150, 0, false) === 1);

// ---------------------------------------------------------------------------
// 3. Survival inventory slot mapping (AbstractContainerMenu / InventoryMenu)
// ---------------------------------------------------------------------------
console.log('\n[3] Survival inventory slot mapping');

check('JAVA_SLOT_CONSTANTS match decompiled literals',
  JAVA_SLOT_CONSTANTS.LEFT === 8 && JAVA_SLOT_CONSTANTS.TOP === 84 &&
  JAVA_SLOT_CONSTANTS.HOTBAR_TOP_OFFSET === 58 && JAVA_SLOT_CONSTANTS.GRID === 18 &&
  JAVA_SLOT_CONSTANTS.IMAGE_WIDTH === 176 && JAVA_SLOT_CONSTANTS.IMAGE_HEIGHT === 166);

let hotbarOk = true, mainOk = true;
for (let i = 0; i < 9; i++) hotbarOk = hotbarOk && isHotbarSlot(i) && !isMainInventorySlot(i);
for (let i = 9; i < 36; i++) mainOk = mainOk && isMainInventorySlot(i) && !isHotbarSlot(i);
check('container slots 0..8 are the hotbar', hotbarOk);
check('container slots 9..35 are the main inventory', mainOk);
check('playerInventorySlotRects has 41 slots (0..40)', playerInventorySlotRects().length === 41);

/** Independent transcription of addInventoryExtendedSlots / addInventoryHotbarSlots. */
function javaInvSlot(inv: number, left = 8, top = 84): Rect {
  if (inv >= 0 && inv < 9) return { x: left + inv * 18, y: top + 58, width: 16, height: 16 };
  if (inv >= 9 && inv < 36) {
    const n = inv - 9;
    return { x: left + (n % 9) * 18, y: top + Math.floor(n / 9) * 18, width: 16, height: 16 };
  }
  if (inv >= 36 && inv < 40) return { x: 8, y: 8 + (39 - inv) * 18, width: 16, height: 16 };
  if (inv === 40) return { x: 77, y: 62, width: 16, height: 16 };
  return { x: -1, y: -1, width: 16, height: 16 };
}

let slotOk = true;
const slotMismatches: string[] = [];
for (let inv = 0; inv <= 40; inv++) {
  const a = survivalInventorySlotXY(inv);
  const e = javaInvSlot(inv);
  if (!eqRect(a, e.x, e.y, e.width, e.height)) {
    slotOk = false;
    slotMismatches.push(`inv${inv}: ${rectStr(a)} vs ${rectStr(e)}`);
  }
}
check('survivalInventorySlotXY(0..40) matches Java for every slot', slotOk,
  slotMismatches.slice(0, 3).join('; '));
check('hotbar slot 0 = (8,142) [top+58]', eqRect(survivalInventorySlotXY(0), 8, 142, 16, 16));
check('hotbar slot 8 = (8+8*18,142)', eqRect(survivalInventorySlotXY(8), 152, 142, 16, 16));
check('main slot 9 = (8,84)', eqRect(survivalInventorySlotXY(9), 8, 84, 16, 16));
check('main slot 35 = (152,120)', eqRect(survivalInventorySlotXY(35), 152, 120, 16, 16));
check('armor slot 39 = (8,8) [39-i, 8+18i]', eqRect(survivalInventorySlotXY(39), 8, 8, 16, 16));
check('offhand slot 40 = (77,62)', eqRect(survivalInventorySlotXY(40), 77, 62, 16, 16));

// InventoryMenu menu-slot -> container-slot mapping.
let menuMapOk = true;
for (let m = 36; m <= 44; m++) menuMapOk = menuMapOk && menuSlotToInventoryIndex(m) === m - 36;
for (let m = 9; m <= 35; m++) menuMapOk = menuMapOk && menuSlotToInventoryIndex(m) === m;
check('InventoryMenu slots 36..44 -> hotbar 0..8, 9..35 -> main 9..35', menuMapOk);
check('InventoryMenu result slot 0 = (154,28)', eqRect(inventoryMenuSlotXY(0), 154, 28, 16, 16));
check('InventoryMenu craft grid 1..4 = (98,18),(116,18),(98,36),(116,36)',
  eqRect(inventoryMenuSlotXY(1), 98, 18, 16, 16) && eqRect(inventoryMenuSlotXY(2), 116, 18, 16, 16) &&
  eqRect(inventoryMenuSlotXY(3), 98, 36, 16, 16) && eqRect(inventoryMenuSlotXY(4), 116, 36, 16, 16));
check('AbstractContainerScreen origin = ((480-176)/2,(270-166)/2) = (152,52)',
  containerOrigin(480, 270, 176, 166).leftPos === 152 && containerOrigin(480, 270, 176, 166).topPos === 52);

// ---------------------------------------------------------------------------
// 4. Creative tabs == data/creative_tabs.json, item ids exist in items.json
// ---------------------------------------------------------------------------
console.log('\n[4] Creative tabs / item registry');

const tabsFile = readJson('data/creative_tabs.json') as { tabs: { key: string; icon: string; items: string[] }[] };
const itemsFile = readJson('data/items.json') as { items: { name: string }[] };
const javaTabCount = countCreativeTabs(tabsFile);
const itemNames = new Set(itemsFile.items.map((i) => i.name));

check('data/creative_tabs.json parsed', Array.isArray(tabsFile.tabs) && javaTabCount > 0, `${javaTabCount} tabs`);
check('DEFAULT_CREATIVE_TABS.length == data/creative_tabs.json tab count',
  DEFAULT_CREATIVE_TABS.length === javaTabCount, `${DEFAULT_CREATIVE_TABS.length} vs ${javaTabCount}`);
check('CreativeModeInventoryScreen.TABS.length == data/creative_tabs.json tab count',
  CreativeModeInventoryScreen.TABS.length === javaTabCount, `${CreativeModeInventoryScreen.TABS.length}`);
check('loadCreativeTabs() parses the shipped JSON shape',
  loadCreativeTabs(tabsFile).length === javaTabCount);
check('tab keys match the JSON exactly',
  DEFAULT_CREATIVE_TABS.every((t, i) => t.key === tabsFile.tabs[i].key), 'order + keys');
check('tab icons match the JSON exactly',
  DEFAULT_CREATIVE_TABS.every((t, i) => t.icon === tabsFile.tabs[i].icon));

const validation = validateCreativeTabs(DEFAULT_CREATIVE_TABS, itemNames);
check('every tab icon / item id exists in data/items.json',
  validation.missing.length === 0,
  `checked ${validation.checked} refs, missing: ${validation.missing.slice(0, 5).join(', ') || 'none'}`);

// Explicitly check the JSON's own items arrays too (currently empty in this pack).
const jsonMissing: string[] = [];
for (const tab of tabsFile.tabs) {
  for (const ref of [tab.icon, ...(tab.items ?? [])]) {
    if (!itemNames.has(itemId(ref))) jsonMissing.push(`${tab.key}:${ref}`);
  }
}
check('every item id referenced BY THE JSON exists in items.json', jsonMissing.length === 0,
  jsonMissing.slice(0, 5).join(', ') || 'none');
check('items.json actually contains ~1537 items', itemsFile.items.length > 1000, `${itemsFile.items.length} items`);

// ---------------------------------------------------------------------------
// 5. Tooltip wrapping, Button hit-test, nine-slice metadata
// ---------------------------------------------------------------------------
console.log('\n[5] Tooltip wrapping / Button hit test / nine-slice mcmeta');

const measure = (s: string): number => s.length * 6;
const wrapped = wrapText('one two three four five', 42, measure);
check('wrapText produces no line wider than maxWidth',
  wrapped.every((l) => measure(l) <= 42), wrapped.map((l) => `[${l}:${measure(l)}]`).join(' '));
check('wrapText keeps all words (no data loss)',
  wrapped.join(' ').replace(/\s+/g, ' ').trim() === 'one two three four five', wrapped.join('|'));
check('wrapText respects explicit newlines',
  JSON.stringify(splitLines('a\nb')) === JSON.stringify(['a', 'b']) &&
  JSON.stringify(wrapText('a\nb', 1000, measure)) === JSON.stringify(['a', 'b']));
const hard = wrapText('abcdefghij', 30, measure);
check('wrapText hard-breaks a single over-long word',
  hard.length > 1 && hard.join('') === 'abcdefghij' && hard.every((l) => measure(l) <= 30), hard.join('|'));
check('wrapTooltipLines flattens multiple source lines',
  wrapTooltipLines(['alpha', 'beta gamma'], 1000, measure).length === 2);

let presses = 0;
const btn = new Button(10, 20, 200, 20, 'OK', () => { presses++; });
btn.setTooltip(Tooltip.create('line1\nline2'));
check('Button tooltip holds both lines', btn.tooltip?.lines.length === 2);
check('Button hit: inside top-left (10,20)', btn.hitTest(10, 20));
check('Button hit: inside bottom-right (209,39)', btn.hitTest(209, 39));
check('Button hit: half-open rect rejects (210,40)', !btn.hitTest(210, 40));
check('Button hit: rejects left of rect (9,20)', !btn.hitTest(9, 20));
check('Button.mouseClicked inside -> true + onPress fired', btn.mouseClicked(50, 30, 0) && presses === 1);
check('Button.mouseClicked outside -> false, no press', !btn.mouseClicked(300, 300, 0) && presses === 1);
btn.active = false;
check('disabled Button ignores clicks', !btn.mouseClicked(50, 30, 0) && presses === 1);
btn.active = true;
const built = Button.builder('X', () => undefined).bounds(0, 0, 200, 20).build();
check('Button.builder().bounds(...,200,20) produces 200x20', built.width === 200 && built.height === 20);
check('Button.big() is 200x20 (vanilla BIG_WIDTH / DEFAULT_HEIGHT)',
  Button.big(0, 0, 'X', () => undefined).width === 200 && Button.big(0, 0, 'X', () => undefined).height === 20);

// .mcmeta nine-slice support (verified location: sprites/**/<name>.png.mcmeta,
// no assets/minecraft/atlases/gui.json in this pack).
const buttonMeta = readJson('public/mc/textures/gui/sprites/widget/button.png.mcmeta') as McMeta;
const buttonScaling = parseScaling(buttonMeta, 200, 20);
check('button.png.mcmeta is nine_slice 200x20 border 3',
  buttonScaling.type === 'nine_slice' && buttonScaling.width === 200 && buttonScaling.height === 20 &&
  (buttonScaling as NineSliceScaling).border.left === 3 &&
  (buttonScaling as NineSliceScaling).border.top === 3 &&
  (buttonScaling as NineSliceScaling).border.right === 3 &&
  (buttonScaling as NineSliceScaling).border.bottom === 3);
check('nine-slice of a 200x20 button yields 9 patches',
  computeNineSlicePatches(200, 20, 200, 20, buttonScaling as NineSliceScaling).length === 9);
const stretched = computeNineSlicePatches(200, 20, 400, 40, buttonScaling as NineSliceScaling);
check('nine-slice stretching keeps the 3px corner borders',
  stretched.length === 9 && stretched.some((p) => p.dx === 0 && p.dy === 0 && p.dw === 3 && p.dh === 3) &&
  stretched.some((p) => p.dw === 400 - 6 || p.dh === 40 - 6));
const tabMeta = readJson('public/mc/textures/gui/sprites/widget/tab.png.mcmeta') as McMeta;
const tabScaling = parseScaling(tabMeta, 130, 24) as NineSliceScaling;
check('tab.png.mcmeta object-form border {2,2,2,0} is parsed',
  tabScaling.type === 'nine_slice' && tabScaling.border.left === 2 && tabScaling.border.top === 2 &&
  tabScaling.border.right === 2 && tabScaling.border.bottom === 0);
check('sprite without .mcmeta falls back to fixed scaling',
  parseScaling(undefined, 16, 16).type === 'fixed');

// ---------------------------------------------------------------------------
console.log('\n[6] Container screen input protocol');

class InputTestScreen extends AbstractContainerScreen {
  protected buildSlots() {
    return Array.from({ length: 5 }, (_, i) => ({ index: i + 9, x: 8 + i * 18, y: 84 }));
  }
  point(index: number) { return { x: this.leftPos + 16 + (index - 9) * 18, y: this.topPos + 92 }; }
}

function inputFixture(touch = false) {
  const menu = new MemoryContainerMenu();
  const calls: { index: number; button: number; action: ContainerAction }[] = [];
  let closed = false;
  let mods = 0;
  const adapter: ContainerMenuLike = {
    getSlotCount: () => menu.getSlotCount(),
    getItem: i => menu.getItem(i),
    getCarried: () => menu.getCarried(),
    setCarried: s => menu.setCarried(s),
    canPlaceItem: i => i !== 13,
    getMaxStackSize: () => 64,
    click: (index, button, shift, action) => {
      calls.push({ index, button, action });
      menu.click(index, button, shift, action);
    },
  };
  const env = {
    deps: { options: { gamemode: 'survival' }, container: adapter, touchInput: touch },
    t: (key: string) => key, get mods() { return mods; },
    close: () => { closed = true; },
  } as unknown as ScreenEnv;
  const screen = new InputTestScreen(env, 'test');
  screen.init(480, 270);
  const fire = (index: number, action: MouseAction, button = 0) => {
    const p = screen.point(index);
    return screen.mouseEvent(p.x, p.y, button, action);
  };
  return { screen, menu, calls, fire, setMods: (value: number) => { mods = value; }, isClosed: () => closed };
}

{
  const f = inputFixture();
  f.menu.setItem(9, { itemId: 1, count: 11 });
  f.fire(9, 'down', 1); f.fire(9, 'up', 1);
  check('right pickup happens once, release does not place it back',
    f.menu.getCarried()?.count === 6 && f.menu.getItem(9).count === 5 && f.calls.length === 1);
  f.fire(10, 'down', 1);
  check('carried placement waits for release, allowing drag selection', f.menu.getItem(10).count === 0);
  f.fire(10, 'up', 1);
  f.fire(10, 'down', 1); f.fire(10, 'up', 1);
  check('right click merges one item into a matching stack', f.menu.getItem(10).count === 2 && f.menu.getCarried()?.count === 4);
}
for (const button of [0, 1]) {
  const f = inputFixture();
  f.menu.setCarried({ itemId: 1, count: 10 });
  f.fire(9, 'down', button); f.fire(10, 'move'); f.fire(11, 'move'); f.fire(11, 'up', button);
  check(`drag button=${button} sends START / each SLOT / END, not PICKUP`,
    f.calls.length === 5 && f.calls.every(c => c.action === 'QUICK_CRAFT') &&
    JSON.stringify(f.calls.map(c => c.button)) === JSON.stringify([button << 2, button << 2 | 1, button << 2 | 1, button << 2 | 1, button << 2 | 2]));
  const each = button === 0 ? 3 : 1;
  check(`drag button=${button} distributes and preserves remainder`,
    [9, 10, 11].every(i => f.menu.getItem(i).count === each) && f.menu.getCarried()?.count === 10 - each * 3);
}
{
  const f = inputFixture();
  f.menu.setCarried({ itemId: 1, count: 10 });
  f.menu.setItem(9, { itemId: 1, count: 63 });
  f.menu.setItem(10, { itemId: 2, count: 2 });
  f.menu.setItem(12, { itemId: 1, count: 64 });
  f.fire(9, 'down'); f.fire(10, 'move'); f.fire(11, 'move'); f.fire(12, 'move'); f.fire(13, 'move'); f.fire(11, 'up');
  check('drag excludes incompatible/full/restricted slots before dividing',
    JSON.stringify(f.calls.filter(c => (c.button & 3) === 1).map(c => c.index)) === '[9,11]' &&
    f.menu.getItem(9).count === 64 && f.menu.getItem(11).count === 5 && f.menu.getCarried()?.count === 4);
}
for (const cancel of ['cancel', 'resize', 'wrong-button'] as const) {
  const f = inputFixture();
  f.menu.setCarried({ itemId: 1, count: 10 });
  f.fire(9, 'down'); f.fire(10, 'move');
  if (cancel === 'resize') f.screen.resize(480, 270);
  else f.fire(10, cancel === 'cancel' ? 'cancel' : 'up', 1);
  f.fire(10, 'up');
  check(`${cancel} cancels pending drag without depositing or losing items`,
    f.menu.getCarried()?.count === 10 && f.menu.getItem(9).count === 0 && f.menu.getItem(10).count === 0 && f.calls.length === 0);
}
{
  const f = inputFixture();
  f.menu.setItem(9, { itemId: 1, count: 12 });
  f.menu.setItem(10, { itemId: 1, count: 60 });
  f.fire(9, 'down'); f.fire(9, 'up'); f.fire(9, 'down'); f.fire(9, 'up');
  check('double click collects matching items to max without deleting overflow',
    f.calls[1]?.action === 'PICKUP_ALL' && f.menu.getCarried()?.count === 64 && f.menu.getItem(10).count === 8);
}
{
  const f = inputFixture();
  f.menu.setCarried({ itemId: 1, count: 6 });
  f.screen.mouseEvent(1, 1, 1, 'down'); f.screen.mouseEvent(1, 1, 1, 'up');
  check('outside right click drops one using PICKUP, not slot THROW',
    f.calls[0]?.index === -999 && f.calls[0]?.action === 'PICKUP' && f.menu.getCarried()?.count === 5);
  f.screen.mouseEvent(1, 1, 0, 'down'); f.screen.mouseEvent(1, 1, 0, 'up');
  check('outside left click drops remaining carried stack', f.menu.getCarried() === null);
}
{
  const f = inputFixture();
  f.menu.setItem(9, { itemId: 1, count: 8 });
  f.menu.setItem(36, { itemId: 2, count: 3 });
  f.fire(9, 'move'); f.screen.keyPressed('Digit1', '1', 0);
  check('number swap uses current hover without waiting for a render',
    f.menu.getItem(36).itemId === 1 && f.menu.getItem(9).itemId === 2);
  f.screen.keyPressed('KeyQ', 'q', 2);
  check('Ctrl-Q sends whole-slot THROW', f.calls[1]?.action === 'THROW' && f.calls[1]?.button === 1);
}
{
  const f = inputFixture(true);
  f.menu.setCarried({ itemId: 1, count: 5 });
  f.screen.mouseEvent(450, 12, 0, 'down'); f.screen.mouseEvent(450, 12, 0, 'up');
  check('touch Done button consumes click instead of dropping carried stack',
    f.isClosed() && f.calls.length === 0 && f.menu.getCarried()?.count === 5);
}

console.log(`\n${failures === 0 ? 'ALL PASS' : 'FAILURES'}: ${checks - failures}/${checks} checks passed`);
if (failures > 0) process.exitCode = 1;
