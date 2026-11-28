// Source: net.minecraft.client.gui.screens.advancements.AdvancementsScreen (26.2)
//
// Vanilla tree view: roots become tabs, every visible advancement is a 26x26
// frame on a 28px grid, and the widget tree is pannable inside the 252x140
// window. Leaves take a row, parents are centred on their children; hovering a
// node shows its title/description tooltip. The frame is drawn with a coloured
// border instead of the vanilla widgets.png sprite (cosmetic gap).

import type { GuiGraphics } from '../GuiGraphics.js';
import { Screen } from './Screen.js';
import { Button } from '../components/Button.js';
import type { MouseAction } from '../Types.js';
import type {
  AdvancementManager, AdvancementNode, AdvancementLayout,
} from '../../../vanilla/world/advancements/AdvancementManager.js';

const TAB_H = 24;
const FOOTER = 32;
const PANEL_W = 252;
const PANEL_H = 140;
const NODE = 26;
const STEP = 28;
const PAD = 12;

const ROOT_TINT: Record<string, number> = {
  story: 0x802b5a2b,
  nether: 0x804a1a1a,
  end: 0x80261636,
  adventure: 0x8020304a,
  husbandry: 0x804a4320,
};

const FRAME_COLOR: Record<string, number> = {
  task: 0xff6a6a6a,
  goal: 0xff3fbf3f,
  challenge: 0xff8a5cd6,
};

interface PanelRect { x: number; y: number; w: number; h: number }

export class AdvancementsScreen extends Screen {
  private tab = 0;
  private layout: AdvancementLayout | null = null;
  private panel: PanelRect = { x: 0, y: 0, w: PANEL_W, h: PANEL_H };
  private panX = 0;
  private panY = 0;
  private panning = false;
  private lastPanX = 0;
  private lastPanY = 0;
  private hover: AdvancementNode | null = null;
  private readonly itemIds = new Map<string, number>();

  constructor(env: ConstructorParameters<typeof Screen>[0]) {
    super(env, 'menu.advancements');
  }

  private get manager(): AdvancementManager | undefined {
    return this.env.deps.advancements;
  }

  private get root(): string | undefined {
    return this.manager?.rootsList()[this.tab];
  }

  protected override renderBackground(g: GuiGraphics): void {
    g.renderMenuBackground(false, true);
    const root = this.root ?? '';
    const tint = ROOT_TINT[root.split('/')[0]] ?? 0x80101010;
    g.fill(this.panel.x, this.panel.y, this.panel.x + this.panel.w, this.panel.y + this.panel.h, tint);
  }

  protected build(): void {
    const manager = this.manager;
    const top = TAB_H + 4;
    const w = Math.min(PANEL_W, this.width - 24);
    const h = Math.max(60, Math.min(PANEL_H, this.height - top - FOOTER - 6));
    this.panel = { x: Math.floor((this.width - w) / 2), y: top, w, h };

    const done = new Button(
      Math.floor(this.width / 2) - 100, this.height - FOOTER + 4, 200, 20,
      this.t('gui.done'), () => this.back(),
    );
    if (!manager) { this.addRenderableWidget(done); return; }

    const mc = this.env.deps.mc as { items?: { name?: string }[] } | undefined;
    mc?.items?.forEach((item, id) => {
      if (typeof item?.name === 'string') this.itemIds.set(item.name.replace(/^minecraft:/, ''), id);
    });

    const roots = manager.rootsList();
    const tabWidth = Math.min(88, Math.floor((this.width - 40) / Math.max(1, roots.length)));
    const total = tabWidth * roots.length;
    roots.forEach((root, i) => {
      const x = Math.floor((this.width - total) / 2) + i * tabWidth;
      this.addRenderableWidget(new Button(x, 5, tabWidth - 2, 20,
        this.t(manager.rootTitle(root)), () => {
          this.tab = i;
          this.refresh();
        }));
    });
    this.tab = Math.min(this.tab, Math.max(0, roots.length - 1));
    this.refresh();
    this.addRenderableWidget(done);
  }

  private refresh(): void {
    const manager = this.manager;
    const root = this.root;
    this.layout = manager && root ? manager.layout(root) : null;
    this.panX = 0;
    this.panY = 0;
    this.hover = null;
  }

  private clampPan(): void {
    if (!this.layout) return;
    const contentW = this.layout.maxDepth * STEP + NODE + PAD * 2;
    const contentH = Math.ceil(this.layout.maxRow + 1) * STEP + PAD * 2;
    const minX = Math.min(0, this.panel.w - contentW);
    const minY = Math.min(0, this.panel.h - contentH);
    this.panX = Math.max(minX, Math.min(0, this.panX));
    this.panY = Math.max(minY, Math.min(0, this.panY));
  }

  /** Node top-left in screen space (already includes the pan offset). */
  private nodeX(node: AdvancementNode): number {
    return this.panel.x + PAD + node.depth * STEP - this.panX;
  }

  private nodeY(node: AdvancementNode): number {
    return this.panel.y + PAD + node.row * STEP - this.panY;
  }

  private insidePanel(mx: number, my: number): boolean {
    return mx >= this.panel.x && mx < this.panel.x + this.panel.w
      && my >= this.panel.y && my < this.panel.y + this.panel.h;
  }

  override mouseEvent(mx: number, my: number, button: number, action: MouseAction, wheelDelta = 0): boolean {
    if (action === 'down') {
      const consumed = super.mouseEvent(mx, my, button, action, wheelDelta);
      if (consumed) return true;
      if (this.insidePanel(mx, my)) {
        this.panning = true;
        this.lastPanX = mx;
        this.lastPanY = my;
        return true;
      }
      return false;
    }
    if (action === 'move' && this.panning) {
      const consumed = super.mouseEvent(mx, my, button, action, wheelDelta);
      this.panX += mx - this.lastPanX;
      this.panY += my - this.lastPanY;
      this.lastPanX = mx;
      this.lastPanY = my;
      this.clampPan();
      return true;
    }
    if (action === 'up' || action === 'cancel') {
      this.panning = false;
      return super.mouseEvent(mx, my, button, action, wheelDelta);
    }
    if (action === 'wheel' && this.insidePanel(mx, my)) {
      this.panY += wheelDelta > 0 ? STEP : -STEP;
      this.clampPan();
      return true;
    }
    return super.mouseEvent(mx, my, button, action, wheelDelta);
  }

  protected renderForeground(g: GuiGraphics, mx: number, my: number, _pt: number): void {
    const manager = this.manager;
    const layout = this.layout;
    if (!manager || !layout) return;

    const { x, y, w, h } = this.panel;
    g.hLine(x, x + w - 1, y, 0xff373737);
    g.hLine(x, x + w - 1, y + h - 1, 0xff373737);
    g.vLine(x, y, y + h - 1, 0xff373737);
    g.vLine(x + w - 1, y, y + h - 1, 0xff373737);

    const byId = new Map<string, AdvancementNode>();
    for (const node of layout.nodes) byId.set(node.id, node);

    g.enableScissor(x + 1, y + 1, x + w - 1, y + h - 1);
    // Connectors first, so frames cover their endpoints. Geometry mirrors
    // AdvancementWidget.extractConnectivity: parent centre -> splitX -> child centre.
    for (const node of layout.nodes) {
      const parent = node.parent ? byId.get(node.parent) : undefined;
      if (!parent) continue;
      const px = Math.floor(this.nodeX(parent) + 13);
      const py = Math.floor(this.nodeY(parent) + 13);
      const splitX = Math.floor(this.nodeX(parent) + 27);
      const cx = Math.floor(this.nodeX(node) + 13);
      const cy = Math.floor(this.nodeY(node) + 13);
      g.hLine(px, splitX, py, 0xff000000);
      g.vLine(splitX, Math.min(py, cy), Math.max(py, cy), 0xff000000);
      g.hLine(splitX, cx, cy, 0xff000000);
    }

    this.hover = null;
    for (const node of layout.nodes) {
      const nx = Math.floor(this.nodeX(node));
      const ny = Math.floor(this.nodeY(node));
      if (mx >= nx && mx < nx + NODE && my >= ny && my < ny + NODE) this.hover = node;
      const border = FRAME_COLOR[node.frame] ?? FRAME_COLOR.task;
      g.fill(nx, ny, nx + NODE, ny + NODE, 0xff101010);
      g.hLine(nx, nx + NODE - 1, ny, border);
      g.hLine(nx, nx + NODE - 1, ny + NODE - 1, border);
      g.vLine(nx, ny, ny + NODE - 1, border);
      g.vLine(nx + NODE - 1, ny, ny + NODE - 1, border);
      const icon = this.itemIds.get(node.icon.replace(/^minecraft:/, ''));
      if (icon !== undefined) g.renderItem(icon, nx + 5, ny + 5, 16);
    }
    g.disableScissor();

    const { done, total } = manager.count();
    const counter = `${done}/${total}`;
    g.drawString(counter, x + w - g.textWidth(counter) - 10, y + 4, 0xffd0d0d0, true);

    // Vanilla scrollbars: only shown when the tree is larger than the window.
    const contentW = layout.maxDepth * STEP + NODE + PAD * 2;
    const contentH = Math.ceil(layout.maxRow + 1) * STEP + PAD * 2;
    if (contentH > h) {
      const top = y + 6, bottom = y + h - 10;
      const track = bottom - top;
      const thumb = Math.max(8, Math.floor(track * (h / contentH)));
      const progress = contentH > h ? -this.panY / (contentH - h) : 0;
      const thumbY = top + Math.floor((track - thumb) * progress);
      g.fill(x + w - 8, top, x + w - 4, bottom, 0x80000000);
      g.fill(x + w - 8, thumbY, x + w - 4, thumbY + thumb, 0xffc0c0c0);
    }
    if (contentW > w) {
      const left = x + 4, right = x + w - 10;
      const track = right - left;
      const thumb = Math.max(8, Math.floor(track * (w / contentW)));
      const progress = contentW > w ? -this.panX / (contentW - w) : 0;
      const thumbX = left + Math.floor((track - thumb) * progress);
      g.fill(left, y + h - 8, right, y + h - 4, 0x80000000);
      g.fill(thumbX, y + h - 8, thumbX + thumb, y + h - 4, 0xffc0c0c0);
    }

    const hover = this.hover;
    if (hover) {
      const lines = [this.t(hover.title)];
      if (hover.frame === 'goal') lines.push('Goal');
      else if (hover.frame === 'challenge') lines.push('Challenge');
      lines.push(this.t(hover.description));
      g.renderTooltip(lines, mx, my);
    }
  }
}
