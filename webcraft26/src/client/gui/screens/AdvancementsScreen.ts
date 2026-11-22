// Source: net.minecraft.client.gui.screens.advancements.AdvancementsScreen (26.2)
//
// A compact port: five root tabs, a scrollable parent-before-child list with icons and
// completion colours, and a Done button. The vanilla tree/connector geometry is not drawn
// yet; every visible advancement and its state is still listed.

import type { GuiGraphics } from '../GuiGraphics.js';
import { Screen } from './Screen.js';
import { Button } from '../components/Button.js';
import { ScrollPanel, type ScrollPanelConfig } from '../components/ScrollPanel.js';
import type { AdvancementManager, AdvancementRow } from '../../../vanilla/world/advancements/AdvancementManager.js';

const TAB_H = 24;
const FOOTER = 32;
const PANEL_WIDTH = 360;

const ROOT_TINT: Record<string, number> = {
  story: 0x802b5a2b,
  nether: 0x804a1a1a,
  end: 0x80261636,
  adventure: 0x8020304a,
  husbandry: 0x804a4320,
};

export class AdvancementsScreen extends Screen {
  private tab = 0;
  private list: ScrollPanel<AdvancementRow> | null = null;
  private readonly itemIds = new Map<string, number>();

  constructor(env: ConstructorParameters<typeof Screen>[0]) {
    super(env, 'menu.advancements');
  }

  private get manager(): AdvancementManager | undefined {
    return this.env.deps.advancements;
  }

  protected override renderBackground(g: GuiGraphics): void {
    g.renderMenuBackground(false, true);
    const manager = this.manager;
    const roots = manager?.rootsList() ?? [];
    const tint = ROOT_TINT[(roots[this.tab] ?? '').split('/')[0]] ?? 0x80101010;
    const top = TAB_H + 8;
    const w = Math.min(PANEL_WIDTH, this.width - 24);
    const left = Math.floor((this.width - w) / 2);
    const h = Math.max(30, this.height - FOOTER - top - 4);
    g.fill(left, top, left + w, top + h, tint);
  }

  protected build(): void {
    const manager = this.manager;
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
          this.refresh(root);
        }));
    });

    const top = TAB_H + 8;
    const w = Math.min(PANEL_WIDTH, this.width - 24);
    const h = Math.max(30, this.height - FOOTER - top - 4);
    const left = Math.floor((this.width - w) / 2);
    this.list = new ScrollPanel<AdvancementRow>(left, top, w, h, this.title, {
      itemHeight: 26,
      renderItem: (g, row, _i, x, y, rw, _rh, hovered) => {
        if (hovered) g.fill(x, y, x + rw, y + 26, 0x30ffffff);
        g.fill(x + 4, y + 4, x + 22, y + 22, 0xff101010);
        const icon = this.itemIds.get(row.icon.replace(/^minecraft:/, ''));
        if (icon !== undefined) g.renderItem(icon, x + 5, y + 5, 16);
        const titleColor = row.done ? 0xffe0b43c : row.started ? 0xffffffff : 0xff9a9a9a;
        g.drawString(this.t(row.title), x + 27, y + 4, titleColor, true);
        if (row.frame === 'goal' || row.frame === 'challenge') {
          const label = row.frame === 'goal' ? 'Goal' : 'Challenge';
          g.drawString(label, x + rw - g.textWidth(label) - 6, y + 4,
            row.frame === 'goal' ? 0xff7fd37f : 0xffc36fd3, true);
        }
        g.drawString(this.t(row.description), x + 27, y + 14, 0xff9a9a9a, false);
      },
    } as ScrollPanelConfig<AdvancementRow>);
    this.addRenderableWidget(this.list);
    this.refresh(roots[this.tab] ?? roots[0]);
    this.addRenderableWidget(done);
  }

  private refresh(root: string | undefined): void {
    if (!this.list || !this.manager || !root) return;
    this.list.setItems(this.manager.rows(root));
    this.list.scrollOffset = 0;
  }

  protected renderForeground(g: GuiGraphics, _mx: number, _my: number, _pt: number): void {
    const manager = this.manager;
    const top = TAB_H + 8;
    const w = Math.min(PANEL_WIDTH, this.width - 24);
    const left = Math.floor((this.width - w) / 2);
    g.drawCenteredString(this.title, Math.floor(this.width / 2), 30, 0xffffffff, true);
    if (manager) {
      const { done, total } = manager.count();
      const text = `${done}/${total}`;
      g.drawString(text, left + w - g.textWidth(text) - 4, top + 4, 0xffd0d0d0, true);
    }
  }
}
