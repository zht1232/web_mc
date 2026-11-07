// Port of net.minecraft.client.gui.components.toasts.ToastManager (26.2).
// Source: ToastManager.java (queued toasts, top-right stack, 5s lifetime,
// 300ms slide-in/out, max 5 visible).

import type { GuiGraphics } from '../GuiGraphics.js';
import { Toast, TOAST_WIDTH, TOAST_HEIGHT, TOAST_SLIDE_MS } from './Toast.js';

interface ActiveToast {
  toast: Toast;
  elapsed: number;
}

export class ToastManager {
  private readonly active: ActiveToast[] = [];
  private readonly queue: Toast[] = [];
  private static readonly MAX_VISIBLE = 5;
  private static readonly SPACING = 4;
  private static readonly RIGHT_MARGIN = 4;
  private static readonly TOP_MARGIN = 4;

  add(toast: Toast): void {
    if (this.active.length >= ToastManager.MAX_VISIBLE) this.queue.push(toast);
    else this.active.push({ toast, elapsed: 0 });
  }

  addText(title: string, message?: string): void {
    this.add(new Toast({ title, message }));
  }

  clear(): void {
    this.active.length = 0;
    this.queue.length = 0;
  }

  /** Called once per frame with the elapsed milliseconds. */
  tick(deltaMs: number): void {
    for (let i = this.active.length - 1; i >= 0; i--) {
      const t = this.active[i];
      t.elapsed += deltaMs;
      if (t.elapsed >= t.toast.duration + TOAST_SLIDE_MS * 2) this.active.splice(i, 1);
    }
    while (this.active.length < ToastManager.MAX_VISIBLE && this.queue.length) {
      this.active.push({ toast: this.queue.shift()!, elapsed: 0 });
    }
  }

  render(g: GuiGraphics, screenWidth: number): void {
    const x = screenWidth - ToastManager.RIGHT_MARGIN - TOAST_WIDTH;
    let y = ToastManager.TOP_MARGIN;
    for (const t of this.active) {
      const visibility = Math.min(1, t.elapsed / TOAST_SLIDE_MS,
        (t.toast.duration + TOAST_SLIDE_MS * 2 - t.elapsed) / TOAST_SLIDE_MS);
      t.toast.render(g, x, y, Math.max(0, visibility));
      y += TOAST_HEIGHT + ToastManager.SPACING;
    }
  }
}
