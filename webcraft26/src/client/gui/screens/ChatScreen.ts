// Port of net.minecraft.client.gui.screens.ChatScreen (26.2).
// Sources: ChatScreen.java (init: new EditBox(..., 4, this.height - 12,
// this.width - 4, 12, ...), setMaxLength(256), setBordered(false),
// setCanLoseFocus(false); keyPressed: Enter -> handleChatInput;
// mouseScrolled: scroll chat; resize preserves the draft).

import type { GuiGraphics } from '../GuiGraphics.js';
import { Screen } from './Screen.js';
import { EditBox } from '../components/EditBox.js';
import { Button } from '../components/Button.js';
import { wrapText } from '../components/wordWrap.js';
import {
  CHAT_EDIT_X,
  CHAT_EDIT_HEIGHT,
  CHAT_EDIT_MAX_LENGTH,
} from '../GuiConstants.js';

const CHAT_LINE_HEIGHT = 9;
const CHAT_MAX_LINES = 10;
const CHAT_WIDTH = 320;
const CHAT_BACKGROUND = 0x80000000;

export class ChatScreen extends Screen {
  private input!: EditBox;
  private readonly chatLines: string[] = [];
  private scroll = 0;
  private readonly initial: string;

  constructor(env: ConstructorParameters<typeof Screen>[0], initial = '') {
    super(env, 'chat_screen.title');
    this.initial = initial;
    this.preserveHud = true; // vanilla keeps the HUD visible behind chat
    this.setCloseOnEsc(true);
  }

  addLine(line: string): void {
    for (const wrapped of wrapText(line, CHAT_WIDTH - 8, (s) => this.env.font.width(s))) {
      this.chatLines.push(wrapped);
    }
    while (this.chatLines.length > 200) this.chatLines.shift();
  }

  private get touch(): boolean { return !!this.env.deps.touchInput; }

  /**
   * 输入框的 y（GUI 坐标）。
   * 触屏：放到屏幕上部 18% 处 —— 底部会被系统手势条、触屏按钮和软键盘盖住，
   * 手机上也没有 Esc 可以退出，所以另外加一个「完成」按钮。
   */
  private inputY(): number {
    return this.touch ? Math.max(24, Math.round(this.height * 0.18)) : this.height - 12;
  }

  protected build(): void {
    const y = this.inputY();
    this.input = new EditBox(CHAT_EDIT_X, y, this.width - 4, CHAT_EDIT_HEIGHT, this.t('chat.editBox'))
      .setMaxLength(CHAT_EDIT_MAX_LENGTH)
      .setBordered(false)
      .setCanLoseFocus(false);
    this.input.setValue(this.initial || '');
    this.input.setFocused(true);
    this.addRenderableWidget(this.input);
    this.setFocusedWidget(this.input);
    if (this.touch) {
      // 手机没有 Esc：给一个显式的「完成」（发送并关闭）
      this.addRenderableWidget(new Button(this.width - 48, Math.max(4, y - 24), 44, 20, this.t('gui.done'), () => this.submit()));
    }
  }

  protected renderBackground(g: GuiGraphics, _mx: number, _my: number, _pt: number): void {
    // Vanilla chat box: a dark strip behind the input, plus per-line backdrops.
    const y = this.inputY();
    g.fill(CHAT_EDIT_X - 2, y - 2, this.width - 2, y + CHAT_EDIT_HEIGHT, 0x80000000);
  }

  protected renderForeground(g: GuiGraphics, _mx: number, _my: number, _pt: number): void {
    const start = Math.max(0, this.chatLines.length - CHAT_MAX_LINES - this.scroll);
    const visible = this.chatLines.slice(start, start + CHAT_MAX_LINES);
    // 桌面：历史消息在输入框上方往上堆（vanilla）；触屏输入框在上面，消息往下排。
    let y = this.touch
      ? this.inputY() + CHAT_EDIT_HEIGHT + 6
      : this.inputY() - 2 - visible.length * CHAT_LINE_HEIGHT - 2;
    for (const line of visible) {
      g.fill(CHAT_EDIT_X - 2, y - 1, CHAT_EDIT_X - 2 + CHAT_WIDTH, y + CHAT_LINE_HEIGHT, CHAT_BACKGROUND);
      g.drawString(line, CHAT_EDIT_X, y, 0xffffffff, true);
      y += CHAT_LINE_HEIGHT;
    }
  }

  private submit(): void {
    const text = this.input.getValue().trim();
    if (text) {
      this.addLine(text);
      this.env.deps.callbacks.onChatMessage?.(text);
    }
    this.close();
  }

  protected onKeyPressed(code: string, _char: string, _mods: number): boolean {
    if (code === 'Enter' || code === 'NumpadEnter') { this.submit(); return true; }
    if (code === 'PageUp') { this.scroll = Math.min(this.chatLines.length, this.scroll + 1); return true; }
    if (code === 'PageDown') { this.scroll = Math.max(0, this.scroll - 1); return true; }
    return false;
  }

  mouseEvent(mx: number, my: number, button: number, action: 'down' | 'up' | 'move' | 'wheel', wheelDelta = 0): boolean {
    if (action === 'wheel') {
      this.scroll = Math.max(0, Math.min(this.chatLines.length - CHAT_MAX_LINES, this.scroll + (wheelDelta > 0 ? -1 : 1)));
      return true;
    }
    return super.mouseEvent(mx, my, button, action, wheelDelta);
  }
}
