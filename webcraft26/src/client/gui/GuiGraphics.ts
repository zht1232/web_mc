// Port of net.minecraft.client.gui.GuiGraphics / GuiGraphicsExtractor (26.2).
//
// Rendering backend decision: the existing HUD (Hud.ts), FontRenderer and
// ItemIconAtlas all draw through CanvasRenderingContext2D on a dedicated GUI
// overlay canvas. Mixing a WebGL2 ortho batch with those three would require a
// second framebuffer plus read-back for every glyph, so GuiGraphics uses that
// same Canvas2D context. Sprite state is still batched: GuiSpriteAtlas caches
// each decoded PNG + its .mcmeta, blitGrouped() draws many widgets of one
// texture in a single pass, and the 32x32 dirt background is a single tiled
// CanvasPattern (the equivalent of a bound atlas tile / one draw call).
//
// Sources: net.minecraft.client.gui.GuiGraphics (fill / fillGradient / blit /
// blitSprite / drawString / renderTooltip / enableScissor),
//          net.minecraft.client.gui.screens.Screen#extractMenuBackgroundTexture,
//          net.minecraft.client.gui.screens.inventory.tooltip.TooltipRenderUtil.

import type { FontRenderer } from './FontRenderer.js';
import type { GuiTextures } from './Hud.js';
import type { ItemIconAtlas } from './ItemIconAtlas.js';
import type { GuiSpriteAtlas } from './GuiSpriteAtlas.js';
import type { Rect } from './Types.js';
import {
  MENU_BACKGROUND,
  INWORLD_MENU_BACKGROUND,
  MENU_SHADE_COLOR,
  SCREEN_TRANSPARENT_BG_TOP,
  SCREEN_TRANSPARENT_BG_BOTTOM,
  TOOLTIP_MOUSE_OFFSET,
  TOOLTIP_PADDING,
  TOOLTIP_MARGIN,
  TOOLTIP_BACKGROUND,
  TOOLTIP_FRAME,
  TOOLTIP_BG_COLOR,
  TOOLTIP_BORDER_START,
  TOOLTIP_BORDER_END,
  LABEL_COLOR,
  spritePath,
} from './GuiConstants.js';
import { measuredWidth, wrapTooltipLines, stripFormatting } from './components/wordWrap.js';
import { clamp, intersectRect } from './components/geometry.js';

export interface GraphicsEnv {
  font: FontRenderer;
  textures: GuiTextures;
  sprites: GuiSpriteAtlas;
  icons: ItemIconAtlas;
  width: number;
  height: number;
  /** Optional item-id -> display name lookup for tooltips. */
  itemName?: (itemId: number) => string;
}

/** Converts a vanilla 0xAARRGGBB (possibly signed Java int) to a CSS colour. */
export function argbToRgb(color: number): string {
  const c = color >>> 0;
  return `rgb(${(c >>> 16) & 255}, ${(c >>> 8) & 255}, ${c & 255})`;
}

export function argbToAlpha(color: number): number {
  return ((color >>> 0) >>> 24) / 255;
}

export function argbToCss(color: number): string {
  const c = color >>> 0;
  return `rgba(${(c >>> 16) & 255}, ${(c >>> 8) & 255}, ${c & 255}, ${((c >>> 24) & 255) / 255})`;
}

interface Pose {
  x: number;
  y: number;
}

interface ScissorState {
  rect: Rect;
  saved: boolean;
}

export class GuiGraphics {
  private readonly poses: Pose[] = [{ x: 0, y: 0 }];
  private readonly scissors: ScissorState[] = [];
  private activeScissor: Rect | null = null;
  private alpha = 1;
  private fontColor = 0xffffffff;

  constructor(public readonly ctx: CanvasRenderingContext2D, public readonly env: GraphicsEnv) {}

  get width(): number { return this.env.width; }
  get height(): number { return this.env.height; }
  get font(): FontRenderer { return this.env.font; }
  get textures(): GuiTextures { return this.env.textures; }
  get sprites(): GuiSpriteAtlas { return this.env.sprites; }
  get icons(): ItemIconAtlas { return this.env.icons; }

  // ------------------------------------------------------------- pose stack
  pushPose(): void { this.poses.push({ ...this.poses[this.poses.length - 1] }); }
  popPose(): void { if (this.poses.length > 1) this.poses.pop(); }
  translate(dx: number, dy: number): void {
    const p = this.poses[this.poses.length - 1];
    p.x += dx;
    p.y += dy;
  }
  private tx(x: number): number { return x + this.poses[this.poses.length - 1].x; }
  private ty(y: number): number { return y + this.poses[this.poses.length - 1].y; }

  /** Vanilla uses explicit "strata"; Canvas2D draws in call order, so this is a no-op hook. */
  nextStratum(): void { /* no-op: immediate-mode Canvas2D already preserves order */ }

  setAlpha(a: number): void { this.alpha = clamp(a, 0, 1); }
  getAlpha(): number { return this.alpha; }
  setColor(color: number): void { this.fontColor = color; }
  getColor(): number { return this.fontColor; }

  private applyAlpha(extra = 1): number {
    const prev = this.ctx.globalAlpha;
    this.ctx.globalAlpha = prev * this.alpha * extra;
    return prev;
  }

  // ------------------------------------------------------------- primitives
  fill(x1: number, y1: number, x2: number, y2: number, color: number): void {
    const x = Math.min(x1, x2), y = Math.min(y1, y2);
    const w = Math.abs(x2 - x1), h = Math.abs(y2 - y1);
    if (w <= 0 || h <= 0) return;
    const prev = this.applyAlpha();
    this.ctx.fillStyle = argbToCss(color);
    this.ctx.fillRect(this.tx(x), this.ty(y), w, h);
    this.ctx.globalAlpha = prev;
  }

  /** Vanilla fillGradient: vertical blend from `from` (top) to `to` (bottom). */
  fillGradient(x1: number, y1: number, x2: number, y2: number, from: number, to: number): void {
    const x = Math.min(x1, x2), y = Math.min(y1, y2);
    const w = Math.abs(x2 - x1), h = Math.abs(y2 - y1);
    if (w <= 0 || h <= 0) return;
    const px = this.tx(x), py = this.ty(y);
    const prev = this.applyAlpha();
    const grad = this.ctx.createLinearGradient(0, py, 0, py + h);
    grad.addColorStop(0, argbToCss(from));
    grad.addColorStop(1, argbToCss(to));
    this.ctx.fillStyle = grad;
    this.ctx.fillRect(px, py, w, h);
    this.ctx.globalAlpha = prev;
  }

  hLine(x1: number, x2: number, y: number, color: number): void { this.fill(x1, y, x2 + 1, y + 1, color); }
  vLine(x: number, y1: number, y2: number, color: number): void { this.fill(x, y1, x + 1, y2 + 1, color); }
  outline(x: number, y: number, w: number, h: number, color: number): void {
    this.hLine(x, x + w - 1, y, color);
    this.hLine(x, x + w - 1, y + h - 1, color);
    this.vLine(x, y, y + h - 1, color);
    this.vLine(x + w - 1, y, y + h - 1, color);
  }

  // ------------------------------------------------------------- text
  textWidth(text: string): number {
    return measuredWidth(text, (s) => this.font.width(s));
  }

  drawString(text: string, x: number, y: number, color = this.fontColor, shadow = true): number {
    const prev = this.ctx.globalAlpha;
    const a = this.alpha * argbToAlpha(color >>> 0);
    // FontRenderer.draw takes the alpha as its last argument and internally
    // sets ctx.globalAlpha to it (for the vanilla drop shadow), so it must be
    // passed here instead of pre-setting globalAlpha (which it would clobber).
    this.font.draw(this.ctx, stripFormatting(text), this.tx(x), this.ty(y), argbToRgb(color), shadow, a);
    this.ctx.globalAlpha = prev;
    return this.textWidth(text);
  }

  drawCenteredString(text: string, cx: number, y: number, color = this.fontColor, shadow = true): number {
    return this.drawString(text, cx - Math.floor(this.textWidth(text) / 2), y, color, shadow);
  }

  /** drawString with the vanilla 0x80000000 backdrop (used by ChatComponent). */
  drawStringWithBackdrop(text: string, x: number, y: number, color = this.fontColor, backgroundColor = 0x80000000): void {
    const w = this.textWidth(text);
    this.fill(x - 1, y - 1, x + w + 1, y + 9, backgroundColor);
    this.drawString(text, x, y, color, true);
  }

  // ------------------------------------------------------------- textures
  /** Draws a region of a vanilla texture (256x256 container sheets, logos, panorama). */
  blit(
    path: string, x: number, y: number,
    width: number, height: number,
    u = 0, v = 0,
    textureWidth = 256, textureHeight = 256,
  ): void {
    const img = this.textures.get(path);
    if (!img) return;
    const prev = this.applyAlpha();
    this.ctx.drawImage(img, u, v, width, height, this.tx(x), this.ty(y), width, height);
    void textureWidth; void textureHeight;
    this.ctx.globalAlpha = prev;
  }

  /**
   * Draws a source region given in LOGICAL sheet coordinates. The shipped
   * title logo (minecraft.png) is a 4x-resolution 1024x256 sheet whose logical
   * size is 256x64, so source rects must be multiplied by img.width/sheetWidth.
   */
  blitScaled(
    path: string, x: number, y: number, destWidth: number, destHeight: number,
    u: number, v: number, srcWidth: number, srcHeight: number,
    sheetWidth = 256, sheetHeight = 256,
  ): void {
    const img = this.textures.get(path);
    if (!img) return;
    const kx = img.width / sheetWidth;
    const ky = img.height / sheetHeight;
    const prev = this.applyAlpha();
    this.ctx.drawImage(img, u * kx, v * ky, srcWidth * kx, srcHeight * ky,
      this.tx(x), this.ty(y), destWidth, destHeight);
    this.ctx.globalAlpha = prev;
  }

  /** Draws a whole texture at its natural size. */
  blitFull(path: string, x: number, y: number, w?: number, h?: number): void {
    const img = this.textures.get(path);
    if (!img) return;
    const prev = this.applyAlpha();
    this.ctx.drawImage(img, this.tx(x), this.ty(y), w ?? img.width, h ?? img.height);
    this.ctx.globalAlpha = prev;
  }

  /** Draws a nine-slice GUI sprite (widget/button, tooltip/background, ...). */
  blitSprite(name: string, x: number, y: number, w: number, h: number): void {
    const tx = this.tx(x), ty = this.ty(y);
    this.sprites.blit(this.ctx, name, tx, ty, w, h, this.alpha);
  }

  /** Batched variant: many rects of the same sprite in one grouped pass. */
  blitSpriteGrouped(name: string, rects: readonly { x: number; y: number; w: number; h: number }[]): void {
    const p = this.poses[this.poses.length - 1];
    const shifted = rects.map((r) => ({ x: r.x + p.x, y: r.y + p.y, w: r.w, h: r.h }));
    this.sprites.blitGrouped(this.ctx, name, shifted, this.alpha);
  }

  // ------------------------------------------------------------- items
  renderItem(itemId: number, x: number, y: number, size = 16): void {
    const prev = this.applyAlpha();
    this.icons.draw(this.ctx, itemId, this.tx(x), this.ty(y), size);
    this.ctx.globalAlpha = prev;
  }

  /** Vanilla itemDecorations: stack count in white with shadow at bottom-right. */
  renderItemDecorations(itemId: number, count: number, x: number, y: number, forcedText?: string): void {
    const text = forcedText ?? (count > 1 ? String(count) : '');
    if (!text) return;
    const tx = this.tx(x) + 17 - this.textWidth(text);
    const ty = this.ty(y) + 9;
    const prev = this.ctx.globalAlpha;
    // Pass alpha through FontRenderer (see drawString): it owns globalAlpha.
    this.font.draw(this.ctx, text, tx, ty, '#ffffff', true, this.alpha);
    this.ctx.globalAlpha = prev;
    void itemId;
  }

  /** Floating item following the cursor (AbstractContainerScreen#extractCarriedItem). */
  renderFloatingItem(itemId: number, count: number, mouseX: number, mouseY: number): void {
    this.renderItem(itemId, mouseX - 8, mouseY - 8, 16);
    this.renderItemDecorations(itemId, count, mouseX - 8, mouseY - 8);
  }

  /** Builds a vanilla-style tooltip for an item id. */
  itemTooltipLines(itemId: number): string[] {
    const name = this.env.itemName?.(itemId) ?? `item.${itemId}`;
    const label = name.replace(/_/g, ' ').replace(/\b\w/g, (c) => c.toUpperCase());
    return [label];
  }

  // ------------------------------------------------------------- tooltips
  /**
   * Vanilla TooltipRenderUtil: MOUSE_OFFSET 12, PADDING 3, MARGIN 9.
   * The text box is (x+12, y-12) and the sprites are inflated by padding+margin.
   */
  renderTooltip(lines: readonly string[], mouseX: number, mouseY: number, maxWidth = 170): void {
    const wrapped = wrapTooltipLines(lines, maxWidth, (s) => this.font.width(s));
    if (wrapped.length === 0) return;
    let w = 0;
    for (const l of wrapped) w = Math.max(w, this.textWidth(l));
    const h = wrapped.length * 10 + (wrapped.length - 1) + 2;

    let x = mouseX + TOOLTIP_MOUSE_OFFSET;
    let y = mouseY - TOOLTIP_MOUSE_OFFSET;
    if (x + w + TOOLTIP_PADDING + TOOLTIP_MARGIN > this.width) x = Math.max(0, this.width - w - TOOLTIP_PADDING * 2 - TOOLTIP_MARGIN);
    if (y + h + TOOLTIP_PADDING + TOOLTIP_MARGIN > this.height) y = Math.max(0, this.height - h - TOOLTIP_PADDING * 2 - TOOLTIP_MARGIN);
    if (x < 0) x = 0;
    if (y < 0) y = 0;

    this.pushPose();
    this.nextStratum();
    const x0 = x - TOOLTIP_PADDING - TOOLTIP_MARGIN;
    const y0 = y - TOOLTIP_PADDING - TOOLTIP_MARGIN;
    const pw = w + TOOLTIP_PADDING * 2 + TOOLTIP_MARGIN * 2;
    const ph = h + TOOLTIP_PADDING * 2 + TOOLTIP_MARGIN * 2;

    // Background + frame sprites, with a plain fill fallback if they are not loaded yet.
    if (this.sprites.get(TOOLTIP_BACKGROUND)) this.blitSprite(TOOLTIP_BACKGROUND, x0, y0, pw, ph);
    else this.fill(x0, y0, x0 + pw, y0 + ph, TOOLTIP_BG_COLOR);
    if (this.sprites.get(TOOLTIP_FRAME)) this.blitSprite(TOOLTIP_FRAME, x0, y0, pw, ph);
    else {
      this.hLine(x0, x0 + pw - 1, y0, TOOLTIP_BORDER_START);
      this.hLine(x0, x0 + pw - 1, y0 + ph - 1, TOOLTIP_BORDER_END);
      this.vLine(x0, y0, y0 + ph - 1, TOOLTIP_BORDER_START);
      this.vLine(x0 + pw - 1, y0, y0 + ph - 1, TOOLTIP_BORDER_END);
    }

    let ty = y;
    for (const line of wrapped) {
      this.drawString(line, x, ty, 0xffffffff, true);
      ty += 10;
    }
    this.popPose();
  }

  renderItemTooltip(itemId: number, mouseX: number, mouseY: number): void {
    this.renderTooltip(this.itemTooltipLines(itemId), mouseX, mouseY);
  }

  // ------------------------------------------------------------- scissor
  enableScissor(x1: number, y1: number, x2: number, y2: number): void {
    const p = this.poses[this.poses.length - 1];
    const rect: Rect = {
      x: Math.min(x1, x2) + p.x, y: Math.min(y1, y2) + p.y,
      width: Math.abs(x2 - x1), height: Math.abs(y2 - y1),
    };
    const previous = this.activeScissor;
    const combined = previous ? intersectRect(previous, rect) : rect;
    this.ctx.save();
    this.ctx.beginPath();
    this.ctx.rect(combined.x, combined.y, combined.width, combined.height);
    this.ctx.clip();
    this.scissors.push({ rect: previous ?? combined, saved: true });
    this.activeScissor = combined;
  }

  disableScissor(): void {
    const state = this.scissors.pop();
    if (!state) return;
    this.ctx.restore();
    this.activeScissor = this.scissors.length ? state.rect : null;
  }

  containsPointInScissor(x: number, y: number): boolean {
    if (!this.activeScissor) return true;
    const r = this.activeScissor;
    return x >= r.x && y >= r.y && x < r.x + r.width && y < r.y + r.height;
  }

  // ------------------------------------------------------------- backgrounds
  /** Screen#extractTransparentBackground for in-game GUIs (inventory, chest...). */
  renderTransparentBackground(): void {
    this.fillGradient(0, 0, this.width, this.height, SCREEN_TRANSPARENT_BG_TOP, SCREEN_TRANSPARENT_BG_BOTTOM);
  }

  /**
   * Screen#extractMenuBackgroundTexture: a 32x32 tiled dirt texture.
   * Uses one CanvasPattern (single fill) instead of hundreds of blits, which is
   * the Canvas2D equivalent of a bound atlas tile / one batched draw.
   */
  renderMenuBackground(inWorld: boolean, tint = true): void {
    const path = inWorld ? INWORLD_MENU_BACKGROUND : MENU_BACKGROUND;
    const img = this.textures.get(path);
    const prev = this.applyAlpha();
    if (img) {
      const pattern = this.ctx.createPattern(img, 'repeat');
      if (pattern) {
        this.ctx.fillStyle = pattern;
        this.ctx.fillRect(0, 0, this.width, this.height);
      }
    }
    if (tint) {
      this.ctx.fillStyle = argbToCss(MENU_SHADE_COLOR);
      this.ctx.fillRect(0, 0, this.width, this.height);
    }
    this.ctx.globalAlpha = prev;
  }

  /** Legacy dark gradient overlay (used by DeathScreen/PauseScreen variants). */
  renderDirtBackground(): void {
    this.renderMenuBackground(false, true);
  }

  /** Default Screen background dispatcher. */
  renderBackground(inWorld: boolean): void {
    if (inWorld) this.renderTransparentBackground();
    else this.renderMenuBackground(false, true);
  }

  /** Draws the vanilla label colour used by container screens. */
  drawLabel(text: string, x: number, y: number): void {
    this.drawString(text, x, y, LABEL_COLOR, false);
  }

  /** Convenience: sprite path helper (widgets pass names relative to gui/sprites). */
  static sprite(name: string): string { return spritePath(name); }

  /** Flush hook for API parity with a batched GL backend. */
  flush(): void { /* no-op: Canvas2D draws immediately */ }
}
