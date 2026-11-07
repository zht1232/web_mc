// Node logic test for the 26.2 HUD port (src/client/gui/Hud.ts).
//
//   npx tsx scripts/test-hud.mts
//
// No DOM at import time: FontRenderer and GuiTextures are only imported as types, so the module is
// import-safe. The renderer test drives Hud.render() with mock Canvas2D / font / sprite objects and
// asserts the draw coordinates against the Java constants.
//
// Java sources the assertions are transcribed from:
//   net.minecraft.client.gui.Hud (extractCrosshair/extractItemHotbar/extractPlayerHealth/extractArmor/
//     extractHearts/extractFood/extractAirBubbles/extractSelectedItemName/extractSlot, HeartType)
//   net.minecraft.client.gui.contextualbar.ExperienceBar + ContextualBar.extractExperienceLevel
//   net.minecraft.client.gui.components.GuiGraphicsExtractor#itemDecorations/itemBar/itemCount
//   net.minecraft.client.gui.components.DebugScreenOverlay#extractLines + the left/right split
//   net.minecraft.world.item.Item#getBarWidth / #getBarColor
//   net.minecraft.resources.Identifier#compareTo (debug entry order is path order)

import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import {
  HUD_SPRITES,
  JavaRandom,
  itemBarColor,
  itemBarWidth,
  heartSprite,
  foodSprite,
  layoutDebugScreen,
  popTransform,
  Hud,
  type HeartKind,
  type HudState,
} from '../src/client/gui/Hud.js';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
let checks = 0;
let failed = 0;

function check(name: string, condition: boolean, detail = ''): void {
  checks++;
  if (condition) {
    console.log(`PASS  ${name}`);
  } else {
    failed++;
    console.log(`FAIL  ${name}${detail ? ` -- ${detail}` : ''}`);
  }
}
function eq(name: string, actual: unknown, expected: unknown): void {
  check(name, JSON.stringify(actual) === JSON.stringify(expected), `got ${JSON.stringify(actual)} want ${JSON.stringify(expected)}`);
}

// ---------------------------------------------------------------- sprite files
const spriteDir = path.join(root, 'public/mc/gui/sprites/hud');
const onDisk = new Set<string>();
(function walk(dir: string) {
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) walk(full);
    else if (entry.name.endsWith('.png')) {
      onDisk.add(`gui/sprites/hud/${path.relative(spriteDir, full).replace(/\\/g, '/').replace(/\.png$/, '')}`);
    }
  }
})(spriteDir);

const kinds: HeartKind[] = ['normal', 'poisoned', 'withered', 'frozen'];
const allHeartSprites: string[] = [];
for (const kind of [...kinds, 'container' as const, 'absorbing' as const]) {
  for (const hardcore of [false, true]) {
    for (const half of [false, true]) {
      for (const blinking of [false, true]) allHeartSprites.push(heartSprite(kind, hardcore, half, blinking));
    }
  }
}
check('every HeartType sprite path resolves to a real hud/*.png', allHeartSprites.every((s) => onDisk.has(s)),
  allHeartSprites.filter((s) => !onDisk.has(s)).join(', '));
check('HUD_SPRITES all exist on disk', HUD_SPRITES.every((s) => onDisk.has(s)),
  HUD_SPRITES.filter((s) => !onDisk.has(s)).join(', '));

// HeartType.getSprite exact names (Hud.java 1354-1457)
eq('heart normal full', heartSprite('normal', false, false, false), 'gui/sprites/hud/heart/full');
eq('heart normal half blinking', heartSprite('normal', false, true, true), 'gui/sprites/hud/heart/half_blinking');
eq('heart hardcore full', heartSprite('normal', true, false, false), 'gui/sprites/hud/heart/hardcore_full');
eq('heart poisoned half', heartSprite('poisoned', false, true, false), 'gui/sprites/hud/heart/poisoned_half');
eq('heart withered hardcore full blinking', heartSprite('withered', true, false, true), 'gui/sprites/hud/heart/withered_hardcore_full_blinking');
eq('heart frozen half blinking', heartSprite('frozen', false, true, true), 'gui/sprites/hud/heart/frozen_half_blinking');
eq('heart absorbing half', heartSprite('absorbing', false, true, false), 'gui/sprites/hud/heart/absorbing_half');
eq('heart container ignores half', heartSprite('container', false, true, false), 'gui/sprites/hud/heart/container');
eq('heart container hardcore blinking', heartSprite('container', true, false, true), 'gui/sprites/hud/heart/container_hardcore_blinking');

// Hud.extractFood 966-974
eq('food empty', foodSprite(false, 'empty'), 'gui/sprites/hud/food_empty');
eq('food full hunger', foodSprite(true, 'full'), 'gui/sprites/hud/food_full_hunger');
check('all 6 food sprites exist', ['empty', 'half', 'full'].every((p) =>
  onDisk.has(foodSprite(false, p as 'empty')) && onDisk.has(foodSprite(true, p as 'empty'))));

// ------------------------------------------------- Item.getBarWidth / getBarColor
eq('barWidth undamaged', itemBarWidth(0, 250), 13);
eq('barWidth half', itemBarWidth(125, 250), 7); // round(13 - 6.5) = round(6.5) = 7 (Java Math.round)
eq('barWidth broken', itemBarWidth(250, 250), 0);
eq('barWidth non-damageable', itemBarWidth(0, 0), 0);
eq('barColor full health is green', itemBarColor(1), 'rgb(0,255,0)');
eq('barColor half health is yellow', itemBarColor(0.5), 'rgb(255,255,0)');
eq('barColor zero health is red', itemBarColor(0), 'rgb(255,0,0)');

// ------------------------------------------------ java.util.Random equivalence
const r = new JavaRandom(0);
const r2 = new JavaRandom(0);
r2.setSeed(0);
check('JavaRandom reproducible', r.nextInt(3) === r2.nextInt(3) && r.nextInt(2) === r2.nextInt(2));
const jitter = new JavaRandom(Math.imul(12345, 312871));
const twos = Array.from({ length: 500 }, () => jitter.nextInt(2));
const threes = Array.from({ length: 500 }, () => jitter.nextInt(3));
check('nextInt(2) in {0,1}', twos.every((v) => v === 0 || v === 1));
check('nextInt(3) in {0,1,2}', threes.every((v) => v >= 0 && v <= 2));
const threeShare = threes.filter((v) => v === 0).length / threes.length;
check('nextInt(3) roughly uniform', threeShare > 0.27 && threeShare < 0.40, `share0=${threeShare.toFixed(3)}`);

// --------------------------------------------------- pop (Hud.extractSlot 1147)
eq('pop 0 -> no squeeze', popTransform(0), { squeeze: 1 });
eq('pop 5 -> squeeze 2', popTransform(5), { squeeze: 2 });

// -------------------------------------------- DebugScreenOverlay left/right split
// priority lines alternate left/right starting on the left; plain lines are split in half.
{
  const { left, right } = layoutDebugScreen([
    { priority: ['fps'] },
    { priority: ['version'] },
    { lines: ['a', 'b'] },
    { groups: [{ id: 'g', lines: ['g1'] }] },
  ]);
  eq('debug priority: fps left / version right', left[0], 'fps');
  eq('debug right column starts with version', right[0], 'version');
  // vanilla adds a spacer after the priority block, after the regular block and after every group
  eq('debug regular lines split, spacers kept', left.slice(1), ['', 'a', '', 'g1', '']);
  eq('debug right column regular remainder', right.slice(1), ['', 'b', '']);
}
{
  const { left, right } = layoutDebugScreen([
    { groups: [{ id: 'p', lines: ['p1'] }, { id: 'q', lines: ['q1'] }, { id: 's', lines: ['s1'] }] },
  ]);
  eq('debug groups: first half left', left, ['p1', '', 'q1', '']);
  eq('debug groups: second half right', right, ['s1', '']);
}

// --------------------------------------------------------- HUD render geometry
interface DrawCall { path: string; x: number; y: number; w?: number; h?: number }
interface RectCall { x: number; y: number; w: number; h: number; style: string }
interface TextCall { text: string; x: number; y: number; color: string }

class MockCtx {
  drawCalls: DrawCall[] = [];
  rects: RectCall[] = [];
  fillStyle = '';
  globalAlpha = 1;
  globalCompositeOperation = 'source-over';
  drawImage(img: { path: string; width?: number; height?: number }, ...rest: number[]): void {
    if (rest.length === 2) {
      this.drawCalls.push({ path: img.path, x: rest[0], y: rest[1], w: img.width, h: img.height });
    } else {
      this.drawCalls.push({ path: img.path, x: rest[4], y: rest[5], w: rest[6], h: rest[7] });
    }
  }
  fillRect(x: number, y: number, w: number, h: number): void {
    this.rects.push({ x, y, w, h, style: this.fillStyle });
  }
  save(): void {}
  restore(): void {}
  translate(): void {}
  scale(): void {}
  find(pathName: string): DrawCall[] { return this.drawCalls.filter((d) => d.path === pathName); }
}

const spritePaths = [...HUD_SPRITES];
const textures = {
  get(p: string) {
    if (p.includes('crosshair')) return { path: p, width: 15, height: 15 };
    if (p.includes('hotbar_selection')) return { path: p, width: 24, height: 23 };
    if (p.includes('hotbar_offhand')) return { path: p, width: 29, height: 24 };
    if (p.includes('hotbar')) return { path: p, width: 182, height: 22 };
    if (p.includes('experience_bar')) return { path: p, width: 182, height: 5 };
    return spritePaths.includes(p) ? { path: p, width: 9, height: 9 } : undefined;
  },
} as unknown as import('../src/client/gui/Hud.js').GuiTextures;

class MockFont {
  calls: TextCall[] = [];
  width(text: string): number { return text.length * 6 - 1; }
  draw(_ctx: unknown, text: string, x: number, y: number, color: string): void {
    this.calls.push({ text, x, y, color });
  }
}

function baseState(overrides: Partial<HudState> = {}): HudState {
  return {
    hearts: 20, maxHearts: 20, absorption: 0, heartKind: 'normal', hardcore: false,
    hunger: 20, saturation: 5, hungerEffect: false,
    air: 300, airMax: 300, underwater: false, armor: 0,
    xpProgress: 0, xpLevel: 0,
    hotbar: Array.from({ length: 9 }, () => ({ item: -1, count: 0, damage: 0, maxDamage: 0, popTime: 0 })),
    offhand: null, offhandLeft: true, selectedSlot: 0,
    itemNameTimer: 0, itemName: '',
    debugLeft: [], debugRight: [], showDebug: false,
    gamemode: 'survival', tickCount: 0,
    ...overrides,
  };
}

function renderScene(state: HudState, W = 427, H = 240) {
  const ctx = new MockCtx();
  const font = new MockFont();
  const items: { item: number; x: number; y: number; size: number }[] = [];
  const hud = new Hud(font as unknown as import('../src/client/gui/FontRenderer.js').FontRenderer, textures);
  hud.render(ctx as unknown as CanvasRenderingContext2D, state, W, H, (_c, item, x, y, size) => {
    items.push({ item, x, y, size });
  });
  return { ctx, font, items, W, H };
}

// Hud.extractCrosshair 446: 15x15 at ((W-15)/2, (H-15)/2)
{
  const { ctx, W, H } = renderScene(baseState());
  const cross = ctx.find('gui/sprites/hud/crosshair');
  check('crosshair drawn once', cross.length === 1);
  eq('crosshair 15x15 at ((W-15)/2,(H-15)/2)', { x: cross[0].x, y: cross[0].y, w: cross[0].w, h: cross[0].h },
    { x: Math.floor((W - 15) / 2), y: Math.floor((H - 15) / 2), w: 15, h: 15 });
}

// Hud.extractItemHotbar 572-604: hotbar (W/2-91, H-22); selection 24x23 at (-1,-1); items (W/2-88+i*20, H-19)
{
  const hotbar = Array.from({ length: 9 }, (_, i) => ({ item: i, count: 1, damage: 0, maxDamage: 0, popTime: 0 }));
  const { ctx, items, W, H } = renderScene(baseState({ hotbar, selectedSlot: 3 }));
  const bg = ctx.find('gui/sprites/hud/hotbar');
  eq('hotbar at (W/2-91, H-22)', { x: bg[0].x, y: bg[0].y }, { x: Math.floor(W / 2) - 91, y: H - 22 });
  const sel = ctx.find('gui/sprites/hud/hotbar_selection');
  eq('selection 24x23 at (W/2-92+slot*20, H-23)', { x: sel[0].x, y: sel[0].y, w: sel[0].w, h: sel[0].h },
    { x: Math.floor(W / 2) - 91 - 1 + 3 * 20, y: H - 23, w: 24, h: 23 });
  eq('hotbar item 0 at (W/2-88, H-19)', { x: items[0].x, y: items[0].y, size: items[0].size },
    { x: Math.floor(W / 2) - 90 + 2, y: H - 19, size: 16 });
  eq('hotbar item 8 advanced by 20px', items[8].x - items[0].x, 160);
}

// Hud.extractItemHotbar 581-604: offhand frame + slot only when the stack is not empty
{
  const empty = renderScene(baseState());
  check('no offhand sprite when empty', empty.ctx.find('gui/sprites/hud/hotbar_offhand_left').length === 0);
  const withOff = renderScene(baseState({
    offhand: { item: 1, count: 1, damage: 0, maxDamage: 0, popTime: 0 }, offhandLeft: true,
  }));
  const frame = withOff.ctx.find('gui/sprites/hud/hotbar_offhand_left');
  eq('offhand frame 29x24 at (W/2-91-29, H-23)', { x: frame[0].x, y: frame[0].y, w: frame[0].w, h: frame[0].h },
    { x: Math.floor(withOff.W / 2) - 91 - 29, y: withOff.H - 23, w: 29, h: 24 });
  eq('offhand item at (W/2-91-26, H-19)',
    { x: withOff.items[0].x, y: withOff.items[0].y },
    { x: Math.floor(withOff.W / 2) - 91 - 26, y: withOff.H - 19 });
}

// GuiGraphicsExtractor.itemCount 950: x+17-width, y+9, shadow; skipped when count == 1
{
  const hotbar = Array.from({ length: 9 }, () => ({ item: -1, count: 0, damage: 0, maxDamage: 0, popTime: 0 }));
  hotbar[0] = { item: 1, count: 64, damage: 0, maxDamage: 0, popTime: 0 };
  hotbar[1] = { item: 2, count: 1, damage: 0, maxDamage: 0, popTime: 0 };
  const { font, items, W, H } = renderScene(baseState({ hotbar }));
  const count = font.calls.find((c) => c.text === '64');
  check('count 64 drawn', !!count);
  eq('count at (itemX+17-width, itemY+9)', { x: count!.x, y: count!.y },
    { x: Math.floor(W / 2) - 88 + 19 - 2 - (2 * 6 - 1), y: H - 19 + 6 + 3 });
  check('count 1 is not drawn', font.calls.every((c) => c.text !== '1'));
  check('single item still drawn', items.length === 2);
}

// GuiGraphicsExtractor.itemBar 940-943: black 13x2 at (x+2, y+13), colour bar 1px tall
{
  const hotbar = Array.from({ length: 9 }, () => ({ item: -1, count: 0, damage: 0, maxDamage: 0, popTime: 0 }));
  hotbar[0] = { item: 1, count: 1, damage: 125, maxDamage: 250, popTime: 0 };
  const { ctx, items, W, H } = renderScene(baseState({ hotbar }));
  const itemX = items[0].x;
  const itemY = items[0].y;
  eq('durability black bar at (x+2,y+13) 13x2', { x: ctx.rects[0].x, y: ctx.rects[0].y, w: ctx.rects[0].w, h: ctx.rects[0].h },
    { x: itemX + 2, y: itemY + 13, w: 13, h: 2 });
  eq('durability colour bar 7x1 at (x+2,y+13)', { x: ctx.rects[1].x, y: ctx.rects[1].y, w: ctx.rects[1].w, h: ctx.rects[1].h },
    { x: itemX + 2, y: itemY + 13, w: 7, h: 1 });
  eq('durability colour at half health is yellow', ctx.rects[1].style, 'rgb(255,255,0)');
  eq('item x is W/2-88 (H-19)', { x: itemX, y: itemY }, { x: Math.floor(W / 2) - 88, y: H - 19 });
}

// Hud.extractPlayerHealth 783-809: hearts (W/2-91+i*8, H-39), armor H-49, food (W/2+91-i*8-9, H-39), air H-59
function countAt(calls: DrawCall[], pred: (c: DrawCall) => boolean): number { return calls.filter(pred).length; }
{
  const { ctx, W, H } = renderScene(baseState({ hearts: 20, maxHearts: 20 }));
  const containers = ctx.find('gui/sprites/hud/heart/container');
  const fulls = ctx.find('gui/sprites/hud/heart/full');
  check('10 heart containers', containers.length === 10);
  check('10 full hearts', fulls.length === 10);
  // Hud.extractHearts 857 walks containerIndex downwards, so the last call is heart 0 (leftmost).
  const leftmost = containers[containers.length - 1];
  eq('heart 0 at (W/2-91, H-39)', { x: leftmost.x, y: leftmost.y }, { x: Math.floor(W / 2) - 91, y: H - 39 });
  eq('heart 9 (rightmost) advanced 8px each', leftmost.x - containers[0].x, -72);
  check('hearts are 9x9', containers.every((c) => c.w === 9 && c.h === 9));
}
{
  const { ctx } = renderScene(baseState({ hearts: 7 }));
  check('7 half-hearts -> 3 full + 1 half', countAt(ctx.drawCalls, (c) => c.path.endsWith('/full')) === 3
    && countAt(ctx.drawCalls, (c) => c.path.endsWith('/half')) === 1);
}
{
  const { ctx, W, H } = renderScene(baseState({ armor: 15 }));
  const armor = ctx.drawCalls.filter((c) => c.path.includes('/armor_'));
  eq('armor row at H-49 (single health row)', armor[0].y, H - 49);
  eq('armor x = W/2-91+i*8', armor[0].x, Math.floor(W / 2) - 91);
  check('15 armor -> 7 full + 1 half + 2 empty',
    countAt(armor, (c) => c.path.endsWith('_full')) === 7
    && countAt(armor, (c) => c.path.endsWith('_half')) === 1
    && countAt(armor, (c) => c.path.endsWith('_empty')) === 2);
}
{
  const { ctx, W, H } = renderScene(baseState({ hunger: 17 }));
  const empties = ctx.drawCalls.filter((c) => c.path.endsWith('/food_empty'));
  check('10 food slots (food_empty under every icon)', empties.length === 10);
  eq('food 0 at (W/2+91-9, H-39)', { x: empties[0].x, y: empties[0].y }, { x: Math.floor(W / 2) + 91 - 9, y: H - 39 });
  eq('food 9 advances 8px leftwards', empties[0].x - empties[9].x, 72);
  check('17 hunger -> 8 full + 1 half',
    ctx.drawCalls.filter((c) => c.path.endsWith('/food_full')).length === 8
    && ctx.drawCalls.filter((c) => c.path.endsWith('/food_half')).length === 1);
}
{
  const { ctx } = renderScene(baseState({ hunger: 17, hungerEffect: true }));
  check('hunger effect uses *_hunger sprites', ctx.drawCalls.some((c) => c.path.includes('food_full_hunger')));
}
{
  const { ctx, W, H } = renderScene(baseState({ air: 120 }));
  const air = ctx.drawCalls.filter((c) => c.path.includes('/air'));
  check('air bubbles drawn when air < max', air.length > 0);
  eq('bubble 1 at (W/2+91-9, H-59)', { x: air[0].x, y: air[0].y }, { x: Math.floor(W / 2) + 91 - 9, y: H - 59 });
  check('120/300 ticks -> 4 full bubbles', air.filter((c) => c.path.endsWith('/air')).length === 4);
  check('6 empty bubbles', air.filter((c) => c.path.endsWith('/air_empty')).length === 6);
}
{
  const { ctx } = renderScene(baseState({ air: 300 }));
  check('air 300 hides the bubbles entirely', ctx.drawCalls.every((c) => !c.path.includes('/air')));
}
{
  const { ctx } = renderScene(baseState({ absorption: 6, hearts: 20 }));
  check('absorption hearts use absorbing sprites', ctx.drawCalls.some((c) => c.path.includes('absorbing_full')));
  const again = renderScene(baseState({ absorption: 6, hearts: 20, heartKind: 'withered' }));
  check('withered + absorption uses withered sprite (Hud.java 877)',
    again.ctx.drawCalls.some((c) => c.path.includes('withered_full')));
}
for (const [kind, needle] of [['poisoned', 'poisoned_full'], ['withered', 'withered_full'], ['frozen', 'frozen_full']] as const) {
  const { ctx } = renderScene(baseState({ heartKind: kind, hearts: 20 }));
  check(`heartKind ${kind} uses ${needle}`, ctx.drawCalls.some((c) => c.path.includes(needle)));
}
{
  const { ctx } = renderScene(baseState({ hearts: 20, hardcore: true }));
  check('hardcore uses hardcore heart sprites', ctx.drawCalls.some((c) => c.path.includes('hardcore_full')));
}
{
  const { ctx, H } = renderScene(baseState({ hearts: 3, maxHearts: 20 }));
  const containers = ctx.find('gui/sprites/hud/heart/container');
  const ys = new Set(containers.map((c) => c.y));
  check('low health jitter offsets hearts by 0..1px (Hud.java 862)', [...ys].every((y) => y === H - 39 || y === H - 38),
    [...ys].join(','));
  check('low health jitter changes the row between containers (seeded random)', ys.size === 2);
}

// contextualbar/ExperienceBar 22-30: (W-182)/2, H-29, 182x5, progress = (int)(p*183)
{
  const { ctx, font, W, H } = renderScene(baseState({ xpProgress: 0.5, xpLevel: 7 }));
  const bg = ctx.find('gui/sprites/hud/experience_bar_background');
  eq('xp background 182x5 at ((W-182)/2, H-29)', { x: bg[0].x, y: bg[0].y, w: bg[0].w, h: bg[0].h },
    { x: Math.floor((W - 182) / 2), y: H - 29, w: 182, h: 5 });
  const progress = ctx.drawCalls.find((c) => c.path.endsWith('experience_bar_progress'));
  eq('xp progress width = (int)(0.5*183) = 91', progress!.w, 91);
  const level = font.calls.find((c) => c.text === '7' && c.color === '#80ff20');
  check('xp level drawn in vanilla green #80ff20', !!level);
  eq('xp level y = H-24-9-2', level!.y, H - 35);
  check('xp level has the four black shadow offsets',
    font.calls.filter((c) => c.text === '7' && c.color === '#000000').length === 4);
}

// Hud.extractSelectedItemName 632-645
{
  const { font, H } = renderScene(baseState({ itemName: 'Stone', itemNameTimer: 10 }));
  const name = font.calls.find((c) => c.text === 'Stone');
  check('item name drawn', !!name);
  eq('item name y = H-59 in survival', name!.y, H - 59);
  const creative = renderScene(baseState({ itemName: 'Stone', itemNameTimer: 10, gamemode: 'creative' }));
  const creativeName = creative.font.calls.find((c) => c.text === 'Stone');
  eq('item name y = H-59+14 in creative (!canHurtPlayer)', creativeName!.y, creative.H - 59 + 14);
}

// gameMode.canHurtPlayer()/hasExperience(): creative hides health/armor/food/air/xp
{
  const { ctx } = renderScene(baseState({ hearts: 10, armor: 10, hunger: 10, air: 100, xpLevel: 5, xpProgress: 0.5, gamemode: 'creative' }));
  check('creative hides hearts', ctx.drawCalls.every((c) => !c.path.includes('/heart/')));
  check('creative hides armor', ctx.drawCalls.every((c) => !c.path.includes('/armor_')));
  check('creative hides food', ctx.drawCalls.every((c) => !c.path.includes('/food_')));
  check('creative hides air bubbles', ctx.drawCalls.every((c) => !c.path.includes('/air')));
  check('creative hides the xp bar', !ctx.drawCalls.some((c) => c.path.includes('experience_bar')));
  check('creative still draws the hotbar', ctx.drawCalls.some((c) => c.path.endsWith('/hotbar')));
}

// DebugScreenOverlay.extractLines 284-301: 9px lines, left x=2, right x=W-2-width, per-line background
{
  const { ctx, font, W } = renderScene(baseState({ showDebug: true, debugLeft: ['Minecraft 26.2 (web/vanilla)'], debugRight: ['60 fps T: inf'] }));
  const left = font.calls.find((c) => c.text === 'Minecraft 26.2 (web/vanilla)');
  const right = font.calls.find((c) => c.text === '60 fps T: inf');
  eq('debug left column x = 2, y = 2', { x: left!.x, y: left!.y }, { x: 2, y: 2 });
  eq('debug right column right-aligned at W-2-width', right!.x, W - 2 - (right!.text.length * 6 - 1));
  eq('debug line height is 9', font.calls.filter((c) => c.text === '60 fps T: inf')[0].y, 2);
  check('debug background strips drawn', ctx.rects.length >= 2);
  eq('debug background colour 0x90505050', ctx.rects[0].style, 'rgba(80, 80, 80, 0.565)');
}

// ---------------------------------------------------------------- summary
console.log('');
if (failed === 0) {
  console.log(`ALL PASS: ${checks}/${checks} checks passed`);
} else {
  console.log(`FAILED: ${failed}/${checks} checks failed`);
  process.exitCode = 1;
}
