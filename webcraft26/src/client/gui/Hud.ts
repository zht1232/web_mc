// Port of net.minecraft.client.gui.Gui (the in-game HUD) with the 26.2 sprite names.
// All coordinates come from the original: hotbar at (W/2-91, H-22), hearts at H-39,
// hunger mirrored from the right, xp bar at H-29, crosshair centred with INVERT blend.

import type { FontRenderer } from './FontRenderer.js';

export interface HudState {
  hearts: number;
  maxHearts: number;
  hunger: number;
  air: number;
  xpProgress: number;
  xpLevel: number;
  hotbar: { item: number; count: number; damage: number }[];
  selectedSlot: number;
  /** ticks remaining of the "selected item name" popup */
  itemNameTimer: number;
  itemName: string;
  debug: string[];
  showDebug: boolean;
  fps: number;
  gamemode: 'survival' | 'creative';
}

export class GuiTextures {
  private readonly cache = new Map<string, HTMLImageElement>();
  private readonly loading = new Map<string, Promise<HTMLImageElement>>();

  constructor(private readonly base = '/mc') {}

  get(path: string): HTMLImageElement | undefined {
    return this.cache.get(path);
  }

  async load(path: string): Promise<HTMLImageElement> {
    const cached = this.cache.get(path);
    if (cached) return cached;
    const pending = this.loading.get(path);
    if (pending) return pending;
    const p = new Promise<HTMLImageElement>((resolve, reject) => {
      const img = new Image();
      img.onload = () => { this.cache.set(path, img); resolve(img); };
      img.onerror = () => reject(new Error('missing gui texture ' + path));
      img.src = `${this.base}/textures/${path}.png`;
    });
    this.loading.set(path, p);
    return p;
  }

  async preload(paths: string[]): Promise<void> {
    await Promise.all(paths.map((p) => this.load(p).catch(() => undefined)));
  }
}

export const HUD_SPRITES = [
  'gui/sprites/hud/hotbar',
  'gui/sprites/hud/hotbar_selection',
  'gui/sprites/hud/heart/container',
  'gui/sprites/hud/heart/full',
  'gui/sprites/hud/heart/half',
  'gui/sprites/hud/heart/container_blinking',
  'gui/sprites/hud/food_empty',
  'gui/sprites/hud/food_full',
  'gui/sprites/hud/food_half',
  'gui/sprites/hud/crosshair',
  'gui/sprites/hud/experience_bar_background',
  'gui/sprites/hud/experience_bar_progress',
  'gui/sprites/hud/air',
  'gui/sprites/hud/armor_empty',
];

export class Hud {
  constructor(
    private readonly font: FontRenderer,
    private readonly textures: GuiTextures,
  ) {}

  /**
   * @param w,h logical GUI size (already divided by the GUI scale)
   * @param scale the GUI scale factor
   */
  render(ctx: CanvasRenderingContext2D, state: HudState, w: number, h: number, drawItem: (ctx: CanvasRenderingContext2D, item: number, x: number, y: number, size: number) => void): void {
    const left = Math.floor(w / 2) - 91;
    const top = h - 22;

    // hotbar background
    this.blit(ctx, 'gui/sprites/hud/hotbar', left, top);

    // selection frame (24x23 drawn one pixel up-left of the slot)
    const sel = left - 1 + state.selectedSlot * 20;
    this.blit(ctx, 'gui/sprites/hud/hotbar_selection', sel, top - 1);

    // items
    for (let i = 0; i < 9; i++) {
      const stack = state.hotbar[i];
      if (!stack || stack.item < 0) continue;
      drawItem(ctx, stack.item, left + 3 + i * 20, top + 3, 16);
      if (stack.count > 1) {
        const text = String(stack.count);
        this.font.draw(ctx, text, left + 3 + i * 20 + 17 - this.font.width(text), top + 3 + 9, '#ffffff');
      }
      if (stack.damage > 0) {
        const ratio = Math.max(0, 1 - stack.damage);
        ctx.fillStyle = '#000000';
        ctx.fillRect(left + 5 + i * 20, top + 15, 13, 2);
        ctx.fillStyle = `hsl(${ratio * 120}, 100%, 50%)`;
        ctx.fillRect(left + 5 + i * 20, top + 15, Math.round(13 * ratio), 1);
      }
    }

    // hearts (survival only)
    if (state.gamemode === 'survival') {
      for (let i = 0; i < 10; i++) {
        const x = left + i * 8;
        const y = h - 39;
        this.blit(ctx, 'gui/sprites/hud/heart/container', x, y);
        const value = state.hearts - i * 2;
        if (value >= 2) this.blit(ctx, 'gui/sprites/hud/heart/full', x, y);
        else if (value === 1) this.blit(ctx, 'gui/sprites/hud/heart/half', x, y);
      }
      // hunger, right to left
      for (let i = 0; i < 10; i++) {
        const x = Math.floor(w / 2) + 91 - i * 8 - 9;
        const y = h - 39;
        this.blit(ctx, 'gui/sprites/hud/food_empty', x, y);
        const value = state.hunger - i * 2;
        if (value >= 2) this.blit(ctx, 'gui/sprites/hud/food_full', x, y);
        else if (value === 1) this.blit(ctx, 'gui/sprites/hud/food_half', x, y);
      }
      // air bubbles when underwater
      if (state.air < 300) {
        for (let i = 0; i < 10; i++) {
          const x = Math.floor(w / 2) + 91 - i * 8 - 9;
          const y = h - 49;
          if (state.air - i * 30 > 0) this.blit(ctx, 'gui/sprites/hud/air', x, y);
        }
      }
      // xp bar
      this.blit(ctx, 'gui/sprites/hud/experience_bar_background', left, h - 29);
      const progress = this.textures.get('gui/sprites/hud/experience_bar_progress');
      if (progress) {
        const width = Math.round(state.xpProgress * 182);
        if (width > 0) ctx.drawImage(progress, 0, 0, width, progress.height, left, h - 29, width, progress.height);
      }
      if (state.xpLevel > 0) {
        const text = String(state.xpLevel);
        const tx = Math.floor(w / 2) - Math.floor(this.font.width(text) / 2);
        this.font.draw(ctx, text, tx, h - 35, '#80ff20');
      }
    }

    // selected item name popup, vanilla: H-59 with the alpha fade
    if (state.itemNameTimer > 0 && state.itemName) {
      const alpha = Math.min(1, state.itemNameTimer / 10);
      const tw = this.font.width(state.itemName);
      ctx.globalAlpha = alpha;
      this.font.draw(ctx, state.itemName, Math.floor((w - tw) / 2), h - 59, '#ffffff');
      ctx.globalAlpha = 1;
    }

    // crosshair uses the vanilla INVERT blend so it stays visible on any background
    const crosshair = this.textures.get('gui/sprites/hud/crosshair');
    if (crosshair) {
      ctx.save();
      ctx.globalCompositeOperation = 'difference';
      ctx.globalAlpha = 1;
      const cx = Math.floor(w / 2 - crosshair.width / 2);
      const cy = Math.floor(h / 2 - crosshair.height / 2);
      ctx.drawImage(crosshair, cx, cy);
      ctx.restore();
    }

    if (state.showDebug) this.renderDebug(ctx, state, w, h);
  }

  private renderDebug(ctx: CanvasRenderingContext2D, state: HudState, w: number, h: number): void {
    ctx.fillStyle = 'rgba(16, 16, 16, 0.5)';
    const lineHeight = 10;
    ctx.fillRect(2, 2, 320, state.debug.length * lineHeight + 4);
    let y = 4;
    for (const line of state.debug) {
      this.font.draw(ctx, line, 4, y, '#ffffff');
      y += lineHeight;
    }
    const fpsText = `${state.fps} fps`;
    this.font.draw(ctx, fpsText, w - this.font.width(fpsText) - 4, 4, '#ffffff');
  }

  private blit(ctx: CanvasRenderingContext2D, path: string, x: number, y: number): void {
    const img = this.textures.get(path);
    if (img) ctx.drawImage(img, x, y);
  }
}
