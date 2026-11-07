// Port of net.minecraft.client.gui.components.toasts.Toast and its concrete
// implementations (SystemToast / RecipeToast / TutorialToast / AdvancementToast).
// Sources: Toast.java (width 160, height 32, visibility/slide-in),
//          SystemToast.java, RecipeToast.java.

import type { GuiGraphics } from '../GuiGraphics.js';

export const TOAST_WIDTH = 160;
export const TOAST_HEIGHT = 32;
export const TOAST_SLIDE_MS = 300;
export const TOAST_DEFAULT_DURATION_MS = 5000;

export type ToastKind = 'system' | 'recipe' | 'tutorial' | 'advancement';

export interface ToastData {
  title: string;
  message?: string;
  /** Item id rendered as the 16x16 icon at (6, 8). */
  iconItem?: number;
  durationMs?: number;
  kind?: ToastKind;
}

export class Toast {
  readonly width = TOAST_WIDTH;
  readonly height = TOAST_HEIGHT;

  constructor(public readonly data: ToastData) {}

  get duration(): number { return this.data.durationMs ?? TOAST_DEFAULT_DURATION_MS; }
  get kind(): ToastKind { return this.data.kind ?? 'system'; }

  /** Toast#render(GuiGraphics, Font, long) with the visibility slide animation. */
  render(g: GuiGraphics, x: number, y: number, visibility: number): void {
    // visibility: 0..1 slide-in / stay / slide-out envelope applied by the manager.
    const slide = Math.round((1 - visibility) * this.width);
    const rx = x + slide;
    const prevAlpha = g.getAlpha();
    g.setAlpha(prevAlpha * visibility);
    const sprite = this.kind === 'system' ? 'toast/system' : this.kind === 'recipe' ? 'toast/recipe' :
      this.kind === 'tutorial' ? 'toast/tutorial' : 'toast/advancement';
    if (g.sprites.get(sprite)) g.blitSprite(sprite, rx, y, this.width, this.height);
    else g.fill(rx, y, rx + this.width, y + this.height, 0xf0101010);

    let textX = rx + 6;
    if (this.data.iconItem !== undefined && this.data.iconItem >= 0) {
      g.renderItem(this.data.iconItem, rx + 6, y + 8, 16);
      textX = rx + 30;
    }
    g.drawString(this.data.title, textX, y + 7, 0xffffff55, true);
    if (this.data.message) g.drawString(this.data.message, textX, y + 18, 0xffffffff, true);
    g.setAlpha(prevAlpha);
  }
}

/** net.minecraft.client.gui.components.toasts.SystemToast */
export class SystemToast extends Toast {
  constructor(title: string, message?: string, iconItem?: number) {
    super({ title, message, iconItem, kind: 'system' });
  }
}

/** net.minecraft.client.gui.components.toasts.RecipeToast */
export class RecipeToast extends Toast {
  constructor(title: string, iconItem?: number) {
    super({ title, iconItem, kind: 'recipe' });
  }
}
