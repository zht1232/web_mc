import type { LoadedAssets } from './assets.js';
import type { BlockRegistry, BlockDef } from './blocks.js';
import type { World } from './world.js';
import type { Player } from './player.js';
import type { Renderer } from './renderer.js';
import { BlockIconRenderer } from './blockIcons.js';
import { clamp } from './math.js';

const COLORS = {
  white: '#ffffff',
  gray: '#aaaaaa',
  darkGray: '#555555',
  yellow: '#ffff55',
  green: '#55ff55',
  red: '#ff5555',
  aqua: '#55ffff',
};

function titleCase(s: string): string {
  return s.split('_').map(w => w.charAt(0).toUpperCase() + w.slice(1)).join(' ');
}

export class Hud {
  private ctx: CanvasRenderingContext2D;
  private scale = 3;
  private guiW = 640;
  private guiH = 360;
  private uiDpr = 1;
  private uiScale = 3;
  private iconPx = 48;
  private icons = new Map<string, HTMLCanvasElement>();
  private iconRenderer: BlockIconRenderer;
  private underwaterPattern: CanvasPattern | null = null;
  inventoryOpen = false;
  inventoryPage = 0;
  private invCategory = 0;
  private invScrollRow = 0;
  private survivalView = false;
  private carriedId = 0;
  private hoverTab = -1;
  private noticeText = '';
  private noticeUntil = 0;
  private mouseCss = { x: 0, y: 0 };
  private invBlocks: BlockDef[];
  private categories: { name: string; items: BlockDef[]; top: boolean; index: number; icon: string }[] = [];

  constructor(private canvas: HTMLCanvasElement, private assets: LoadedAssets, private rocks: BlockRegistry, private world: World) {
    const ctx = canvas.getContext('2d')!;
    ctx.imageSmoothingEnabled = false;
    this.ctx = ctx;
    this.invBlocks = rocks.blocks.filter(b => b.id > 0);
    this.iconRenderer = new BlockIconRenderer(assets);
    this.buildCategories();
    try {
      this.underwaterPattern = ctx.createPattern(assets.env.underwater, 'repeat');
    } catch { /* ignore */ }
  }

  resize(cssW: number, cssH: number): void {
    this.scale = clamp(Math.floor(Math.min(cssW / 320, cssH / 240)), 2, 4);
    this.guiW = Math.ceil(cssW / this.scale);
    this.guiH = Math.ceil(cssH / this.scale);
    this.uiDpr = Math.min(window.devicePixelRatio || 1, 1.5);
    this.uiScale = this.scale * this.uiDpr;
    this.iconPx = Math.max(16, Math.min(160, Math.round(16 * this.uiScale)));
    this.canvas.width = Math.max(1, Math.round(cssW * this.uiDpr));
    this.canvas.height = Math.max(1, Math.round(cssH * this.uiDpr));
    this.canvas.style.width = cssW + 'px';
    this.canvas.style.height = cssH + 'px';
    this.ctx.setTransform(this.uiScale, 0, 0, this.uiScale, 0, 0);
    this.ctx.imageSmoothingEnabled = false;
    this.icons.clear();
  }

  private buildCategories(): void {
    const find = (names: string[]) => names
      .map(n => this.rocks.byName.get(n))
      .filter((b): b is BlockDef => !!b);
    const groups: [string, string[]][] = [
      ['Building Blocks', ['stone', 'cobblestone', 'mossy_cobblestone', 'stone_bricks', 'mossy_stone_bricks', 'cracked_stone_bricks',
        'bricks', 'deepslate', 'cobbled_deepslate', 'polished_deepslate', 'granite', 'diorite', 'andesite', 'tuff', 'calcite',
        'smooth_stone', 'sandstone', 'red_sandstone', 'glass', 'oak_planks', 'oak_stairs', 'oak_slab', 'birch_planks', 'birch_stairs',
        'birch_slab', 'spruce_planks', 'spruce_stairs', 'spruce_slab', 'sulfur', 'sulfur_bricks', 'polished_sulfur', 'chiseled_sulfur',
        'snow_block', 'ice', 'obsidian']],
      ['Colored Blocks', ['cinnabar', 'cinnabar_bricks', 'polished_cinnabar', 'chiseled_cinnabar', 'potent_sulfur']],
      ['Natural Blocks', ['grass_block', 'dirt', 'coarse_dirt', 'rooted_dirt', 'podzol', 'sand', 'red_sand', 'gravel', 'clay',
        'oak_log', 'birch_log', 'spruce_log', 'oak_leaves', 'birch_leaves', 'spruce_leaves', 'coal_ore', 'iron_ore', 'copper_ore',
        'gold_ore', 'diamond_ore', 'emerald_ore', 'bedrock', 'snow', 'moss_block', 'cactus', 'short_grass', 'fern', 'dead_bush',
        'poppy', 'dandelion', 'cornflower', 'azure_bluet', 'oxeye_daisy', 'allium', 'lily_of_the_valley', 'sulfur_spike', 'water', 'lava']],
      ['Functional Blocks', ['crafting_table', 'bookshelf', 'torch', 'lantern', 'glowstone', 'sea_lantern']],
      ['Redstone Blocks', []],
      ['Tools & Utilities', []],
      ['Combat', []],
    ];
    this.categories = groups.map(([name, names], index) => ({
      name, items: find(names), top: true, index: index + 1,
      icon: names[0] ?? 'stone',
    }));
    const bottom: [string, string[], string][] = [
      ['Food & Drinks', [], 'poppy'],
      ['Ingredients', ['coal_ore', 'iron_ore', 'copper_ore', 'gold_ore', 'diamond_ore', 'emerald_ore'], 'coal_ore'],
      ['Spawn Eggs', [], 'sulfur_spike'],
      ['Search Items', this.rocks.blocks.filter(b => b.id > 0).map(b => b.name), 'glass'],
      ['Survival Inventory', [], 'crafting_table'],
    ];
    for (let i = 0; i < bottom.length; i++) {
      const [name, names, icon] = bottom[i];
      this.categories.push({ name, items: find(names), top: false, index: i + 1, icon });
    }
  }

  private blockIcon(def: BlockDef): HTMLCanvasElement {
    const key = `${def.id}|${def.tintMode}|${def.tintColor.join(',')}|${this.iconPx}`;
    const cached = this.icons.get(key);
    if (cached) return cached;
    const icon = this.iconRenderer.render(def, this.iconPx);
    this.icons.set(key, icon);
    return icon;
  }

  setInventory(open: boolean, page?: number): void {
    this.inventoryOpen = open;
    if (open && page != null) this.inventoryPage = page;
    if (!open) this.carriedId = 0;
  }

  setCarried(id: number): void {
    this.carriedId = id;
  }

  getCarried(): number {
    return this.carriedId;
  }

  clearCarried(): void {
    this.carriedId = 0;
  }

  inventoryScroll(delta: number): void {
    if (!this.inventoryOpen) return;
    const items = this.activeCategory().items;
    const max = Math.max(0, Math.ceil(items.length / 9) - 5);
    this.invScrollRow = clamp(this.invScrollRow + Math.sign(delta), 0, max);
  }

  cycleCategory(dir: number): void {
    if (!this.categories.length) return;
    this.invCategory = (this.invCategory + dir + this.categories.length) % this.categories.length;
    this.invScrollRow = 0;
    this.survivalView = this.categories[this.invCategory]?.name === 'Survival Inventory';
    this.carriedId = 0;
  }

  private activeCategory() {
    return this.categories[this.invCategory] ?? this.categories[0];
  }

  setMouse(cssX: number, cssY: number): void {
    this.mouseCss.x = cssX;
    this.mouseCss.y = cssY;
  }

  hotbarHit(cssX: number, cssY: number): number {
    const gx = cssX / this.scale;
    const gy = cssY / this.scale;
    const hotbarX = Math.floor((this.guiW - 182) / 2);
    const hotbarY = this.guiH - 22;
    if (gx < hotbarX || gx >= hotbarX + 182 || gy < hotbarY - 2 || gy >= hotbarY + 22) return -1;
    return clamp(Math.floor((gx - hotbarX) / 20), 0, 8);
  }

  toast(text: string): void {
    this.noticeText = text;
    this.noticeUntil = performance.now() + 1600;
  }

  private creativeLayout() {
    const cols = 9, rows = 5, slot = 18, panelW = 195, panelH = 136;
    const x = Math.floor((this.guiW - panelW) / 2);
    const y = Math.floor((this.guiH - panelH) / 2);
    return {
      cols, rows, slot, w: panelW, h: panelH, x, y,
      gridX: x + 9, gridY: y + 18, hotbarY: y + 112,
    };
  }

  private iconForName(name: string | null): HTMLCanvasElement | null {
    if (!name) return null;
    const def = this.rocks.byName.get(name);
    return def ? this.blockIcon(def) : null;
  }

  private tabRects(): { cat: number; x: number; y: number; w: number; h: number; top: boolean; index: number }[] {
    const L = this.creativeLayout();
    const rects: { cat: number; x: number; y: number; w: number; h: number; top: boolean; index: number }[] = [];
    const tops = this.categories.filter(c => c.top);
    for (let i = 0; i < tops.length; i++) {
      rects.push({ cat: this.categories.indexOf(tops[i]), x: L.x + 7 + i * 26, y: L.y - 28, w: 26, h: 32, top: true, index: tops[i].index });
    }
    const bottoms = this.categories.filter(c => !c.top);
    for (let i = 0; i < bottoms.length; i++) {
      rects.push({ cat: this.categories.indexOf(bottoms[i]), x: L.x + 6 + i * 26, y: L.y + L.h - 4, w: 26, h: 32, top: false, index: bottoms[i].index });
    }
    return rects;
  }

  private closeRect() {
    const L = this.creativeLayout();
    return { x: L.x + L.w - 18, y: L.y + L.h + 2, w: 14, h: 14 };
  }

  inventoryHit(cssX: number, cssY: number): { block: number } | { hotbar: number } | { category: number } | { close: true } | { scroll: true } | null {
    if (!this.inventoryOpen) return null;
    const gx = cssX / this.scale, gy = cssY / this.scale;
    const L = this.creativeLayout();
    const touchUi = (navigator.maxTouchPoints || 0) > 0;
    if (touchUi) {
      const c = this.closeRect();
      if (gx >= c.x && gx < c.x + c.w && gy >= c.y && gy < c.y + c.h) return { close: true };
    }
    for (const t of this.tabRects()) {
      if (gx >= t.x && gx < t.x + t.w && gy >= t.y && gy < t.y + t.h) {
        this.invCategory = t.cat;
        this.invScrollRow = 0;
        this.survivalView = this.categories[t.cat]?.name === 'Survival Inventory';
        this.carriedId = 0;
        return { category: t.cat };
      }
    }
    if (gx >= L.x && gx < L.x + L.w && gy >= L.y && gy < L.y + L.h) {
      if (this.survivalView) {
        if (gx >= L.x + 173 && gy >= L.y + 112) return { close: true };
        const slot = Math.floor((gx - (L.x + 9)) / L.slot);
        if (slot >= 0 && slot < 9 && gy >= L.hotbarY && gy < L.hotbarY + 18) return { hotbar: slot };
        return null;
      }
      const col = Math.floor((gx - L.gridX) / L.slot);
      const row = Math.floor((gy - L.gridY) / L.slot);
      if (col >= 0 && col < 9 && row >= 0 && row < 5) {
        const items = this.activeCategory().items;
        const idx = this.invScrollRow * 9 + row * 9 + col;
        if (idx < items.length) {
          this.carriedId = items[idx].id;
          return { block: items[idx].id };
        }
      }
      const slot = Math.floor((gx - (L.x + 9)) / L.slot);
      if (slot >= 0 && slot < 9 && gy >= L.hotbarY && gy < L.hotbarY + 18) return { hotbar: slot };
      if (gx >= L.x + 175 && gx < L.x + 187 && gy >= L.y + 18 && gy < L.y + 108) {
        const max = Math.max(0, Math.ceil(this.activeCategory().items.length / 9) - 5);
        if (max > 0) {
          this.invScrollRow = clamp(Math.round(((gy - (L.y + 18)) / 90) * max), 0, max);
          return { scroll: true };
        }
      }
      return null;
    }
    return null;
  }

  private drawInventory(player: Player): void {
    const { ctx, assets } = this;
    const L = this.creativeLayout();
    const gx = this.mouseCss.x / this.scale;
    const gy = this.mouseCss.y / this.scale;
    const category = this.activeCategory();
    const items = category.items;
    const maxScroll = Math.max(0, Math.ceil(items.length / 9) - 5);
    this.invScrollRow = clamp(this.invScrollRow, 0, maxScroll);

    const panel = this.survivalView ? assets.gui.creativeInventory : assets.gui.creativeItems;
    if (panel) ctx.drawImage(panel, 0, 0, 195, 136, L.x, L.y, 195, 136);
    else {
      ctx.fillStyle = '#c6c6c6';
      ctx.fillRect(L.x, L.y, L.w, L.h);
    }

    // Official tab sprites sit around the panel; the active tab is drawn last.
    this.hoverTab = -1;
    const tabList = this.tabRects().sort((a, b) => Number(a.cat === this.invCategory) - Number(b.cat === this.invCategory));
    for (const t of tabList) {
      const selected = t.cat === this.invCategory;
      const key = `${t.top ? 'tabTop' : 'tabBottom'}${selected ? 'Selected' : 'Unselected'}${t.index}`;
      const tab = assets.gui[key];
      if (tab) ctx.drawImage(tab, t.x, t.y, 26, 32);
      const icon = this.iconForName(this.categories[t.cat]?.icon ?? null);
      if (icon) ctx.drawImage(icon, t.x + 5, t.y + 8, 16, 16);
      if (gx >= t.x && gx < t.x + t.w && gy >= t.y && gy < t.y + t.h) this.hoverTab = t.cat;
    }

    const first = this.invScrollRow * 9;
    let hovered: BlockDef | null = null;
    if (!this.survivalView) {
      for (let i = 0; i < 45; i++) {
        const idx = first + i;
        if (idx >= items.length) break;
        const col = i % 9, row = (i / 9) | 0;
        const sx = L.gridX + col * 18, sy = L.gridY + row * 18;
        const hov = gx >= sx && gx < sx + 18 && gy >= sy && gy < sy + 18;
        if (hov) {
          ctx.fillStyle = 'rgba(255,255,255,0.55)';
          ctx.fillRect(sx + 1, sy + 1, 16, 16);
          hovered = items[idx];
        }
        const icon = this.blockIcon(items[idx]);
        ctx.drawImage(icon, sx + 1, sy + 1, 16, 16);
      }
    }

    // Player hotbar row in the creative panel.
    for (let i = 0; i < 9; i++) {
      const def = player.hotbar[i];
      if (!def) continue;
      const sx = L.x + 9 + i * 18, sy = L.hotbarY;
      const icon = this.blockIcon(def);
      ctx.drawImage(icon, sx + 1, sy + 1, 16, 16);
      if (gx >= sx && gx < sx + 18 && gy >= sy && gy < sy + 18) hovered = def;
    }
    const selX = L.x + 9 + player.selected * 18;
    ctx.strokeStyle = 'rgba(255,255,255,0.9)';
    ctx.lineWidth = 1;
    ctx.strokeRect(selX + 0.5, L.hotbarY + 0.5, 17, 17);

    // Scrollbar.
    if (!this.survivalView && maxScroll > 0) {
      const frac = this.invScrollRow / maxScroll;
      const scroller = assets.gui.creativeScroller;
      if (scroller) ctx.drawImage(scroller, L.x + 175, L.y + 18 + Math.round(frac * 75), 12, 15);
    }

    if (!this.survivalView && (navigator.maxTouchPoints || 0) > 0) {
      const c = this.closeRect();
      ctx.fillStyle = '#c6c6c6';
      ctx.fillRect(c.x, c.y, c.w, c.h);
      ctx.fillStyle = '#ffffff';
      ctx.fillRect(c.x, c.y, c.w, 1);
      ctx.fillStyle = '#555555';
      ctx.fillRect(c.x, c.y + c.h - 1, c.w, 1);
      assets.font.drawCentered(ctx, 'x', c.x + c.w / 2, c.y + 3, '#3f3f3f', false);
    }

    const carried = this.carriedId ? this.rocks.get(this.carriedId) : null;
    if (carried) {
      const icon = this.blockIcon(carried);
      ctx.drawImage(icon, gx - 8, gy - 8, 16, 16);
    }

    let tip = this.survivalView ? '' : (hovered ? titleCase(hovered.name) : '');
    if (!tip && this.hoverTab >= 0) tip = this.categories[this.hoverTab]?.name ?? '';
    if ((navigator.maxTouchPoints || 0) > 0) tip = '';
    if (tip) {
      const w = assets.font.width(tip) + 8;
      const x = clamp(gx + 10, 0, this.guiW - w);
      const y = clamp(gy - 14, 0, this.guiH - 14);
      ctx.fillStyle = 'rgba(16,0,16,0.94)';
      ctx.fillRect(x, y, w, 13);
      ctx.strokeStyle = 'rgba(80,0,255,0.9)';
      ctx.lineWidth = 1;
      ctx.strokeRect(x + 0.5, y + 0.5, w - 1, 12);
      assets.font.draw(ctx, tip, x + 4, y + 3, COLORS.white, false);
    }
  }

  render(state: {
    started: boolean;
    paused: boolean;
    player: Player;
    fps: number;
    ticks: number;
    debug: boolean;
    underwater: boolean;
    renderer: Renderer;
    elapsed: number;
    inventoryOpen: boolean;
  }): void {
    const { ctx, guiW, guiH } = this;
    ctx.setTransform(this.uiScale, 0, 0, this.uiScale, 0, 0);
    ctx.imageSmoothingEnabled = false;
    ctx.clearRect(0, 0, guiW, guiH);
    const player = state.player;
    if (player.hurtTime > 0) {
      ctx.fillStyle = `rgba(190,20,20,${Math.min(0.28, player.hurtTime * 0.55)})`;
      ctx.fillRect(0, 0, guiW, guiH);
    }

    if (state.underwater) {
      if (this.underwaterPattern) {
        ctx.save();
        ctx.globalAlpha = 0.35;
        ctx.fillStyle = this.underwaterPattern;
        ctx.fillRect(0, 0, guiW, guiH);
        ctx.restore();
      }
      ctx.fillStyle = 'rgba(20,60,140,0.18)';
      ctx.fillRect(0, 0, guiW, guiH);
    }

    if (!state.started) {
      this.drawTitle(false);
      return;
    }

    const hotbarX = Math.floor((guiW - 182) / 2);
    const hotbarY = guiH - 22;
    ctx.drawImage(this.assets.gui.hotbar, hotbarX, hotbarY);
    ctx.drawImage(this.assets.gui.hotbarSelection, hotbarX - 1 + player.selected * 20, hotbarY - 1);
    const now = performance.now();
    const pop = Math.max(0, 5 - (now - player.selectedSince) / 50);
    for (let i = 0; i < 9; i++) {
      const def = player.hotbar[i];
      if (!def) continue;
      const icon = this.blockIcon(def);
      const ix = hotbarX + 3 + i * 20;
      const iy = hotbarY + 3;
      if (i === player.selected && pop > 0) {
        // Vanilla squashes the newly selected item about its bottom edge for 5 ticks.
        const f = 1 + pop / 5;
        ctx.save();
        ctx.translate(ix + 8, iy + 12);
        ctx.scale(1 / f, (f + 1) / 2);
        ctx.drawImage(icon, -8, -12, 16, 16);
        ctx.restore();
      } else {
        ctx.drawImage(icon, ix, iy, 16, 16);
      }
    }

    const heartY = guiH - 39;
    for (let i = 0; i < 10; i++) {
      const h = this.assets.gui;
      const hp = player.health - i * 2;
      let hx = hotbarX + i * 8;
      if (player.health <= 4) hx += (i * 7 + 3) % 2;
      if (h.heartContainer) ctx.drawImage(h.heartContainer, hx, heartY, 9, 9);
      if (hp >= 2 && h.heartFull) ctx.drawImage(h.heartFull, hx, heartY, 9, 9);
      else if (hp >= 1 && h.heartHalf) ctx.drawImage(h.heartHalf, hx, heartY, 9, 9);
    }

    if (!state.inventoryOpen) {
      ctx.save();
      // Vanilla draws the crosshair with an inverting blend so it stays visible on snow and in a cave.
      ctx.globalCompositeOperation = 'difference';
      ctx.drawImage(this.assets.gui.crosshair, Math.floor((guiW - 15) / 2), Math.floor((guiH - 15) / 2));
      ctx.restore();
    }

    if (now - player.selectedSince < 2000) {
      const def = player.currentBlock();
      if (def) {
        const name = titleCase(def.name);
        const remain = 1 - (now - player.selectedSince) / 2000;
        ctx.save();
        ctx.globalAlpha = Math.min(1, remain * 2.56);
        this.assets.font.drawCentered(ctx, name, guiW / 2, guiH - 59, COLORS.white, true);
        ctx.restore();
      }
    }

    if (performance.now() < this.noticeUntil && !state.inventoryOpen) {
      this.assets.font.drawCentered(ctx, this.noticeText, guiW / 2, 12, COLORS.white, true);
    }
    if (state.inventoryOpen) this.drawInventory(player);
    if (state.debug) this.drawDebug(state);
    if (state.paused && !state.inventoryOpen) this.drawTitle(true);
  }

  private drawTitle(paused: boolean): void {
    const { ctx, guiW, guiH, assets } = this;
    ctx.fillStyle = 'rgba(0,0,0,0.62)';
    ctx.fillRect(0, 0, guiW, guiH);
    const logo = assets.gui.title;
    if (logo) {
      const w = 256, h = 64;
      ctx.drawImage(logo, Math.floor((guiW - w) / 2), 28, w, h);
    }
    assets.font.drawCentered(ctx, 'Java Edition 26.2 · Vanilla assets · WebGL2', guiW / 2, 100, COLORS.gray, true);
    const bw = 200, bh = 20;
    const bx = Math.floor((guiW - bw) / 2), by = 126;
    const btn = paused ? (assets.gui.buttonHighlighted ?? assets.gui.button) : assets.gui.button;
    if (btn) ctx.drawImage(btn, bx, by, bw, bh);
    else { ctx.fillStyle = '#6f6f6f'; ctx.fillRect(bx, by, bw, bh); }
    assets.font.drawCentered(ctx, paused ? 'Resume' : 'Play', guiW / 2, by + 6, COLORS.white, true);

    const lines = [
      'WASD Move    Space Jump / double-tap to Fly    Shift Descend / Sneak',
      'Ctrl Sprint    F Toggle flight    F3 Debug    N Noon    M Midnight',
      'Left click Break    Right click Place    Middle click Pick    Wheel/1-9 Hotbar',
      'E Creative blocks    V Mipmap    T Freeze time',
      '',
      'Click to lock the mouse. ESC releases it.',
      'Textures, models, sounds and font come from your own Minecraft 26.2 client.',
    ];
    let y = 164;
    for (const line of lines) {
      assets.font.drawCentered(ctx, line, guiW / 2, y, y > 210 ? COLORS.darkGray : COLORS.gray, true);
      y += 10;
    }
    assets.font.drawCentered(ctx, 'Chaos Cubed · sulfur & cinnabar included', guiW / 2, guiH - 18, COLORS.darkGray, false);
  }

  private drawDebug(state: {
    player: Player; fps: number; ticks: number; renderer: Renderer;
  }): void {
    const { ctx, assets } = this;
    const p = state.player;
    const eye = p.eye();
    const bx = Math.floor(eye.x), by = Math.floor(eye.y), bz = Math.floor(eye.z);
    const total = ((state.ticks % 24000) + 24000) % 24000;
    const hours = ((total / 1000 + 6) % 24);
    const hh = Math.floor(hours).toString().padStart(2, '0');
    const mm = Math.floor((hours % 1) * 60).toString().padStart(2, '0');
    const yawDeg = ((p.yaw * 180 / Math.PI) % 360 + 360) % 360;
    const dirs = [[0, 'south (+Z)'], [90, 'west (-X)'], [180, 'north (-Z)'], [270, 'east (+X)']];
    let facing = dirs[0][1] as string;
    for (let i = 0; i < 4; i++) {
      const a = dirs[i][0] as number;
      const b = (dirs[(i + 1) % 4][0] as number) + (i === 3 ? 360 : 0);
      if (yawDeg >= a && yawDeg < b) facing = dirs[i][1] as string;
    }
    const target = p.target;
    const targetId = target ? this.world.getBlock(target.x, target.y, target.z) : 0;
    const targetDef = this.rocks.get(targetId);
    const lightS = this.world.getSky(bx, by, bz);
    const lightB = this.world.getBlockLight(bx, by, bz);
    const stats = state.renderer.drawStats;
    const lines = [
      ['Minecraft 26.2 · WebGL2 fan renderer', COLORS.white],
      [`FPS ${state.fps.toFixed(0)}   draw calls ${stats.chunks + stats.translucent}   tris ${(stats.triangles / 1000).toFixed(1)}k`, COLORS.gray],
      [`XYZ ${p.pos.x.toFixed(3)} / ${p.pos.y.toFixed(3)} / ${p.pos.z.toFixed(3)}`, COLORS.white],
      [`Block ${bx} ${by} ${bz}   Chunk ${bx >> 4} ${bz >> 4}`, COLORS.gray],
      [`Facing ${facing}  (yaw ${yawDeg.toFixed(1)}°)`, COLORS.white],
      [`Biome ${this.world.biomeNameAt(bx, bz)}   Light sky ${lightS} block ${lightB}`, COLORS.gray],
      [`Time ${hh}:${mm} (${total} ticks)   ${p.flying ? 'flying' : 'walking'}`, COLORS.white],
      [`Target ${target ? targetDef.name : 'none'}`, COLORS.gray],
      [`Seed ${this.world.seed}   Dist 6   ${p.locked ? 'mouse locked' : 'mouse free'}`, COLORS.darkGray],
    ];
    let w = 0;
    for (const [line] of lines) w = Math.max(w, assets.font.width(line as string));
    ctx.fillStyle = 'rgba(0,0,0,0.38)';
    ctx.fillRect(1, 1, w + 5, lines.length * 9 + 5);
    let y = 4;
    for (const [line, color] of lines) {
      assets.font.draw(ctx, line as string, 4, y, color as string, true);
      y += 9;
    }
  }
}
