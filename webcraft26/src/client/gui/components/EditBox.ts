// Port of net.minecraft.client.gui.components.EditBox (26.2).
// Sources: EditBox.java (value, maxLength, cursorPos, highlightPos, bordered,
// setValue, insertText, deleteChars, keyPressed, charTyped, renderWidget,
// setResponder, setHint, setBordered, setCanLoseFocus), ChatScreen.java
// (new EditBox(..., 4, height - 12, width - 4, 12, ...), bordered = false).

import type { GuiGraphics } from '../GuiGraphics.js';
import { AbstractWidget } from './AbstractWidget.js';
import { isInside } from './geometry.js';
import { truncateToWidth } from './wordWrap.js';

export type Responder = (value: string) => void;
export type CharFilter = (ch: string) => boolean;

const DEFAULT_FILTER: CharFilter = (ch) => ch >= ' ' && ch !== '\u007f';

export class EditBox extends AbstractWidget {
  private value = '';
  private maxLength = 32;
  private cursorPos = 0;
  private highlightPos = 0; // selection anchor
  private scrollPos = 0;
  private frame = 0;
  private bordered = true;
  private editable = true;
  private canLoseFocus = true;
  private hint = '';
  private responder?: Responder;
  private filter: CharFilter = DEFAULT_FILTER;
  private textColor = 0xffe0e0e0;
  private hintColor = 0xff707070;

  constructor(x: number, y: number, width: number, height: number, message: string) {
    super(x, y, width, height, message);
  }

  getValue(): string { return this.value; }

  setValue(value: string): void {
    this.value = value.slice(0, this.maxLength);
    this.cursorPos = Math.min(this.cursorPos, this.value.length);
    this.highlightPos = this.cursorPos;
    this.scrollPos = 0;
    this.responder?.(this.value);
  }

  setMaxLength(n: number): this { this.maxLength = Math.max(0, n); return this; }
  getMaxLength(): number { return this.maxLength; }
  setResponder(fn: Responder | undefined): this { this.responder = fn; return this; }
  setFilter(fn: CharFilter): this { this.filter = fn; return this; }
  setBordered(value: boolean): this { this.bordered = value; return this; }
  setEditable(value: boolean): this { this.editable = value; return this; }
  setCanLoseFocus(value: boolean): this { this.canLoseFocus = value; return this; }
  setHint(hint: string): this { this.hint = hint; return this; }
  setTextColor(color: number): this { this.textColor = color; return this; }

  setFocused(value: boolean): void {
    super.setFocused(value);
    if (value) this.frame = 0;
  }

  setCursorPosition(pos: number): void {
    this.cursorPos = Math.max(0, Math.min(this.value.length, pos));
  }

  setHighlightPos(pos: number): void {
    this.highlightPos = Math.max(0, Math.min(this.value.length, pos));
  }

  isEditable(): boolean { return this.editable && this.active; }
  isBordered(): boolean { return this.bordered; }

  /** EditBox#insertText */
  insertText(text: string): void {
    if (!this.isEditable()) return;
    const cleaned = [...text].filter((c) => this.filter(c)).join('');
    if (!cleaned) return;
    const start = Math.min(this.cursorPos, this.highlightPos);
    const end = Math.max(this.cursorPos, this.highlightPos);
    const room = this.maxLength - (this.value.length - (end - start));
    const insert = cleaned.slice(0, Math.max(0, room));
    this.value = this.value.slice(0, start) + insert + this.value.slice(end);
    this.cursorPos = start + insert.length;
    this.highlightPos = this.cursorPos;
    this.responder?.(this.value);
  }

  /** EditBox#deleteChars(int) */
  deleteChars(count: number): void {
    if (!this.isEditable()) return;
    if (this.cursorPos !== this.highlightPos) {
      this.insertText('');
      return;
    }
    const from = Math.max(0, Math.min(this.value.length, this.cursorPos + Math.min(0, count)));
    const to = Math.max(0, Math.min(this.value.length, this.cursorPos + Math.max(0, count)));
    if (from === to) return;
    this.value = this.value.slice(0, from) + this.value.slice(to);
    this.cursorPos = from;
    this.highlightPos = from;
    this.responder?.(this.value);
  }

  getSelectedText(): string {
    const a = Math.min(this.cursorPos, this.highlightPos);
    const b = Math.max(this.cursorPos, this.highlightPos);
    return this.value.slice(a, b);
  }

  tick(): void { this.frame++; }

  protected renderWidget(g: GuiGraphics, _mx: number, _my: number, _pt: number): void {
    const { x, y, width, height } = this;
    if (this.bordered) {
      const sprite = this.focused ? 'widget/text_field_highlighted' : 'widget/text_field';
      g.blitSprite(sprite, x, y, width, height);
    } else {
      // ChatScreen EditBox: 1px light border, black interior.
      g.fill(x - 1, y - 1, x + width + 1, y + height + 1, 0xffa0a0a0);
      g.fill(x, y, x + width, y + height, 0xff000000);
    }

    const inner = width - (this.bordered ? 8 : 4);
    const displayValue = this.value;
    // Recompute the horizontal scroll so the cursor stays visible.
    this.updateScroll(g, displayValue, inner);
    const visible = displayValue.slice(this.scrollPos);
    const trimmed = truncateToWidth(visible, inner, (s) => g.textWidth(s), '');

    const textY = y + Math.floor((height - 8) / 2);
    const textX = x + (this.bordered ? 4 : 2);

    if (trimmed.length) {
      g.drawString(trimmed, textX, textY, this.editable ? this.textColor : this.hintColor, false);
    } else if (this.hint && !this.focused) {
      g.drawString(this.hint, textX, textY, this.hintColor, false);
    }

    // Selection highlight + blinking cursor.
    const selStart = Math.min(this.cursorPos, this.highlightPos);
    const selEnd = Math.max(this.cursorPos, this.highlightPos);
    if (selEnd > selStart && this.focused) {
      const sx = textX + g.textWidth(displayValue.slice(this.scrollPos, selStart));
      const ex = textX + g.textWidth(displayValue.slice(this.scrollPos, selEnd));
      g.fill(sx, textY - 1, ex, textY + 9, 0x800000ff);
      g.drawString(displayValue.slice(selStart, selEnd), sx, textY, 0xffffffff, false);
    }
    if (this.focused && Math.floor(this.frame / 6) % 2 === 0) {
      const before = displayValue.slice(this.scrollPos, this.cursorPos);
      const cx = textX + g.textWidth(before);
      g.vLine(cx, textY - 1, textY + 9, 0xffe0e0e0);
    }
  }

  private updateScroll(g: GuiGraphics, value: string, inner: number): void {
    let cursorX = g.textWidth(value.slice(0, this.cursorPos));
    if (cursorX < this.scrollPos) this.scrollPos = cursorX;
    else if (cursorX - this.scrollPos > inner) this.scrollPos = cursorX - inner;
    this.scrollPos = Math.max(0, this.scrollPos);
    cursorX = g.textWidth(value.slice(0, this.cursorPos));
    void cursorX;
  }

  mouseClicked(mx: number, my: number, button: number): boolean {
    if (!this.visible || !this.active) return false;
    const inside = isInside(mx, my, this.getRect());
    if (this.canLoseFocus) this.setFocused(inside);
    if (!inside || button !== 0 || !this.isEditable()) return inside;
    // Place the caret by measuring from the left.
    const rel = mx - this.x - (this.bordered ? 4 : 2) + this.scrollPos;
    let pos = 0;
    let w = 0;
    for (const ch of this.value) {
      const cw = ch === ' ' ? 4 : 6;
      if (w + cw / 2 > rel) break;
      w += cw;
      pos++;
    }
    this.setCursorPosition(pos);
    this.setHighlightPos(pos);
    return true;
  }

  keyPressed(code: string, _char: string, mods: number): boolean {
    if (!this.focused) return false;
    const shift = (mods & 1) !== 0;
    const ctrl = (mods & 2) !== 0;
    switch (code) {
      case 'Backspace': this.deleteChars(-1); return true;
      case 'Delete': this.deleteChars(1); return true;
      case 'ArrowLeft': this.moveCursor(shift, -1); return true;
      case 'ArrowRight': this.moveCursor(shift, 1); return true;
      case 'Home': this.setCursorPosition(0); if (!shift) this.setHighlightPos(0); return true;
      case 'End': this.setCursorPosition(this.value.length); if (!shift) this.setHighlightPos(this.value.length); return true;
      case 'KeyA':
        if (ctrl) { this.setHighlightPos(0); this.setCursorPosition(this.value.length); return true; }
        return false;
      case 'KeyC':
        if (ctrl && typeof navigator !== 'undefined' && navigator.clipboard) {
          void navigator.clipboard.writeText(this.getSelectedText()).catch(() => undefined);
          return true;
        }
        return false;
      case 'KeyV':
        if (ctrl && typeof navigator !== 'undefined' && navigator.clipboard) {
          void navigator.clipboard.readText().then((t) => this.insertText(t)).catch(() => undefined);
          return true;
        }
        return false;
      case 'KeyX':
        if (ctrl && typeof navigator !== 'undefined' && navigator.clipboard) {
          void navigator.clipboard.writeText(this.getSelectedText()).catch(() => undefined);
          this.deleteChars(0);
          return true;
        }
        return false;
      case 'Escape': this.setFocused(false); return true;
      default: return false;
    }
  }

  private moveCursor(shift: boolean, dir: number): void {
    let next = this.cursorPos + dir;
    if (next < 0) next = 0;
    if (next > this.value.length) next = this.value.length;
    this.setCursorPosition(next);
    if (!shift) this.setHighlightPos(next);
  }

  charTyped(ch: string, _mods: number): boolean {
    if (!this.focused || !this.isEditable()) return false;
    this.insertText(ch);
    return true;
  }
}
