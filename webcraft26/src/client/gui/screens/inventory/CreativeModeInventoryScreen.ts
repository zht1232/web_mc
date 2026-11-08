// Port of net.minecraft.client.gui.screens.inventory.CreativeModeInventoryScreen (26.2).
// Sources: CreativeModeInventoryScreen.java (NUM_ROWS 5, NUM_COLS 9,
// TAB_WIDTH 26, TAB_HEIGHT 32, SCROLLER_WIDTH 12, SCROLLER_HEIGHT 15,
// imageWidth 195, imageHeight 136, searchBox at leftPos+82 / topPos+6 / 80x9,
// tab sprites at topPos-28 and topPos+imageHeight-4,
// tab X = imageWidth - 27*(7-pos) + 1, scroller at leftPos+175 / topPos+18,
// extractTabButton, checkTabClicked, slot grid 9x5 at (9,18)).
//
// Tabs come from data/creative_tabs.json via ScreenDeps.creativeTabs, or from
// the transcribed DEFAULT_CREATIVE_TABS (14 entries) with runtime-populated
// item lists. Geometry is shared with ./SlotLayout.ts.

import type { GuiGraphics } from '../../GuiGraphics.js';
import type { CreativeTabData, ItemStack, MouseAction } from '../../Types.js';
import { AbstractContainerScreen, type SlotDef } from './AbstractContainerScreen.js';
import { EditBox } from '../../components/EditBox.js';
import {
  DEFAULT_CREATIVE_TABS,
  populateCreativeTabs,
  itemId,
  TAB_SEARCH,
  TAB_SURVIVAL,
} from '../../CreativeTabs.js';
import {
  CREATIVE_NUM_ROWS,
  CREATIVE_NUM_COLS,
  CREATIVE_TAB_WIDTH,
  CREATIVE_TAB_HEIGHT,
  CREATIVE_SCROLLER_WIDTH,
  CREATIVE_SCROLLER_HEIGHT,
  CREATIVE_SEARCH_X,
  CREATIVE_SEARCH_Y,
  CREATIVE_SEARCH_WIDTH,
  CREATIVE_SEARCH_HEIGHT,
  SLOT_GRID,
} from '../../GuiConstants.js';

const GRID_LEFT = 9;
const GRID_TOP = 18;
const TAB_X_BASE = 27;
const TAB_TOP_OFFSET = 28;
const SCROLLER_X = 175;
const SCROLLER_Y = 18;
const HOTBAR_TOP = 112;

export class CreativeModeInventoryScreen extends AbstractContainerScreen {
  /** Authoritative tab list (used by the Node test suite). */
  static readonly TABS: readonly CreativeTabData[] = DEFAULT_CREATIVE_TABS;

  private readonly tabs: CreativeTabData[];
  private selectedTab = 0;
  private searchBox!: EditBox;
  private currentItemIds: number[] = [];
  private allItemNames: string[] = [];
  private scrollOffs = 0;
  private scrolling = false;

  constructor(env: ConstructorParameters<typeof AbstractContainerScreen>[0]) {
    super(env, 'container.creative', 195, 136, 'gui/container/creative_inventory/tab_items');
    this.allItemNames = readItemNames(env.deps.mc);
    const supplied = env.deps.creativeTabs;
    this.tabs = supplied && supplied.length
      ? supplied.map((t) => ({ ...t }))
      : populateCreativeTabs(DEFAULT_CREATIVE_TABS, this.allItemNames);
    this.titleLabelX = 8;
  }

  getTabs(): readonly CreativeTabData[] { return this.tabs; }
  getSelectedTab(): number { return this.selectedTab; }

  private itemIndex(name: string): number {
    const mc = this.env.deps.mc as { itemByName?: Map<string, number> } | undefined;
    const v = mc?.itemByName?.get(itemId(name));
    return typeof v === 'number' ? v : -1;
  }

  private setTab(index: number): void {
    if (index < 0 || index >= this.tabs.length) return;
    this.selectedTab = index;
    this.scrollOffs = 0;
    // CreativeModeInventoryScreen: the search box only exists on the Search tab.
    if (this.searchBox) this.searchBox.visible = index === TAB_SEARCH;
    this.refreshItems();
  }

  private refreshItems(): void {
    const tab = this.tabs[this.selectedTab];
    const query = this.searchBox?.getValue().toLowerCase().trim() ?? '';
    let names = tab.items.length ? tab.items : (this.selectedTab === TAB_SEARCH ? this.allItemNames : []);
    if (query) names = this.allItemNames.filter((n) => n.includes(query.replace(/\s+/g, '_')));
    this.currentItemIds = names.map((n) => this.itemIndex(n)).filter((id) => id >= 0);
    this.writeMenuItems();
  }

  private writeMenuItems(): void {
    const menu = this.menu as unknown as { setItem?: (i: number, s: ItemStack) => void };
    if (!menu.setItem) return;
    const start = this.scrollOffs * CREATIVE_NUM_COLS;
    for (let i = 0; i < CREATIVE_NUM_ROWS * CREATIVE_NUM_COLS; i++) {
      const id = this.currentItemIds[start + i];
      menu.setItem(i, id === undefined ? { itemId: -1, count: 0 } : { itemId: id, count: 1 });
    }
  }

  protected buildSlots(): SlotDef[] {
    const out: SlotDef[] = [];
    for (let row = 0; row < CREATIVE_NUM_ROWS; row++) {
      for (let col = 0; col < CREATIVE_NUM_COLS; col++) {
        out.push({ index: row * CREATIVE_NUM_COLS + col, x: GRID_LEFT + col * SLOT_GRID, y: GRID_TOP + row * SLOT_GRID });
      }
    }
    // Survival hotbar row (9 slots) at the bottom of the creative GUI.
    for (let i = 0; i < 9; i++) {
      out.push({ index: CREATIVE_NUM_ROWS * CREATIVE_NUM_COLS + i, x: GRID_LEFT + i * SLOT_GRID, y: HOTBAR_TOP });
    }
    return out;
  }

  protected build(): void {
    super.build();
    this.searchBox = new EditBox(this.leftPos + CREATIVE_SEARCH_X, this.topPos + CREATIVE_SEARCH_Y,
      CREATIVE_SEARCH_WIDTH, CREATIVE_SEARCH_HEIGHT, this.t('itemGroup.search'))
      .setBordered(false)
      .setMaxLength(50);
    this.searchBox.setResponder(() => this.refreshItems());
    this.searchBox.visible = this.selectedTab === TAB_SEARCH;
    this.addRenderableWidget(this.searchBox);
    this.refreshItems();
  }

  protected drawLabels(g: GuiGraphics): void {
    const tab = this.tabs[this.selectedTab];
    // CreativeModeTab#getDisplayName -> translatable "itemGroup.<name>"; drawing the raw
    // tab.key showed English labels even with a Chinese locale.
    if (tab) g.drawString(this.t(tab.key), 8, 6, -12566464, false);
  }

  protected renderBackground(g: GuiGraphics, mx: number, my: number, pt: number): void {
    super.renderBackground(g, mx, my, pt);
    g.pushPose();
    g.translate(this.leftPos, this.topPos);

    // Tab buttons: 7 on top (y = -28), 7 on bottom (y = imageHeight - 4).
    for (let i = 0; i < this.tabs.length; i++) {
      const isTop = i < 7;
      const pos = i % 7;
      // CreativeModeInventoryScreen#getTabX: left tabs start at 27*pos, right-aligned tabs
      // (columns 5/6) hug the panel edge.
      const x = this.tabX(i);
      const y = isTop ? -TAB_TOP_OFFSET : this.imageHeight - 4;
      const selected = i === this.selectedTab;
      const sprite = `container/creative_inventory/tab_${isTop ? 'top' : 'bottom'}_${selected ? 'selected' : 'unselected'}_${pos + 1}`;
      if (g.sprites.get(sprite)) g.blitSprite(sprite, x, y, CREATIVE_TAB_WIDTH, CREATIVE_TAB_HEIGHT);
      else {
        g.fill(x, y, x + CREATIVE_TAB_WIDTH, y + CREATIVE_TAB_HEIGHT, selected ? 0xffc6c6c6 : 0xff8b8b8b);
        g.outline(x, y, CREATIVE_TAB_WIDTH, CREATIVE_TAB_HEIGHT, 0xff000000);
      }
      const icon = this.itemIndex(this.tabs[i].icon);
      if (icon >= 0) g.renderItem(icon, x + 5, y + 8 + (isTop ? 1 : -1), 16);
    }

    // Scroller: CreativeModeInventoryScreen#extractBackground draws only the thumb, over the
    // well that is already painted into the tab background texture. Drawing a
    // scroller_background track here added the black bar the player saw, and the old thumb
    // formula used a 90px track instead of the vanilla 112px one.
    const trackH = 112;
    const maxScroll = this.maxScroll();
    if (maxScroll > 0) {
      const sprite = 'container/creative_inventory/scroller';
      const thumbY = SCROLLER_Y + Math.round((trackH - (CREATIVE_SCROLLER_HEIGHT + 2)) * (maxScroll > 0 ? this.scrollOffs / maxScroll : 0));
      g.blitSprite(sprite, SCROLLER_X, thumbY, CREATIVE_SCROLLER_WIDTH, CREATIVE_SCROLLER_HEIGHT);
    }

    // The destroy-item bin is a real Slot at (173,112) that only exists on the Survival
    // Inventory tab, and its frame is part of tab_inventory.png. The old unconditional
    // grey square at (168,111) was the stray button under the scrollbar.
    g.popPose();
  }

  private maxScroll(): number {
    const rows = Math.ceil(this.currentItemIds.length / CREATIVE_NUM_COLS);
    return Math.max(0, rows - CREATIVE_NUM_ROWS);
  }

  private tabX(index: number): number {
    const pos = index % 7;
    return pos >= 5 ? this.imageWidth - TAB_X_BASE * (7 - pos) + 1 : TAB_X_BASE * pos;
  }

  private tabHit(mx: number, my: number): number {
    for (let i = 0; i < this.tabs.length; i++) {
      const isTop = i < 7;
      const x = this.leftPos + this.tabX(i);
      const y = this.topPos + (isTop ? -TAB_TOP_OFFSET : this.imageHeight - 4);
      if (mx >= x && mx < x + CREATIVE_TAB_WIDTH && my >= y && my < y + CREATIVE_TAB_HEIGHT) return i;
    }
    return -1;
  }

  mouseEvent(mx: number, my: number, button: number, action: MouseAction, wheelDelta = 0): boolean {
    if (action === 'down' && button === 0) {
      const tab = this.tabHit(mx, my);
      if (tab >= 0) { this.setTab(tab); return true; }
      const sx = this.leftPos + SCROLLER_X;
      if (mx >= sx && mx < sx + CREATIVE_SCROLLER_WIDTH && my >= this.topPos + SCROLLER_Y &&
        my < this.topPos + SCROLLER_Y + 112) {
        this.scrolling = true;
        this.applyScrollbar(mx, my);
        return true;
      }
      // Deletes the carried stack: the Survival Inventory tab's destroy slot at (173,112).
      if (this.selectedTab === TAB_SURVIVAL) {
        const tx = this.leftPos + 173;
        const ty = this.topPos + 112;
        if (mx >= tx && mx < tx + 16 && my >= ty && my < ty + 16) {
          this.menu.setCarried(null);
          return true;
        }
      }
    }
    if (action === 'cancel') this.scrolling = false;
    if (action === 'down' && button >= 0 && button <= 2) {
      const idx = this.getHoveredSlot(mx, my);
      if (idx >= 0 && idx < CREATIVE_NUM_ROWS * CREATIVE_NUM_COLS) {
        this.hoveredSlot = idx;
        const shift = (this.env.mods & 1) !== 0;
        this.menu.click(idx, button, shift, button === 2 ? 'CLONE' : shift ? 'QUICK_MOVE' : 'PICKUP');
        return true;
      }
    }
    if (action === 'move' && this.scrolling) { this.applyScrollbar(mx, my); return true; }
    if (action === 'up' && this.scrolling) { this.scrolling = false; return true; }
    if (action === 'wheel') {
      this.scrollOffs = Math.max(0, Math.min(this.maxScroll(), this.scrollOffs + (wheelDelta > 0 ? 1 : -1)));
      this.writeMenuItems();
      return true;
    }
    return super.mouseEvent(mx, my, button, action, wheelDelta);
  }

  private applyScrollbar(_mx: number, my: number): void {
    const trackH = 112;
    const rel = (my - this.topPos - SCROLLER_Y) / Math.max(1, trackH - (CREATIVE_SCROLLER_HEIGHT + 2));
    this.scrollOffs = Math.max(0, Math.min(this.maxScroll(), Math.round(rel * this.maxScroll())));
    this.writeMenuItems();
  }

  keyPressed(code: string, char: string, mods: number): boolean {
    if (this.searchBox?.focused && this.searchBox.keyPressed(code, char, mods)) return true;
    return super.keyPressed(code, char, mods);
  }

  charTyped(ch: string, mods: number): boolean {
    if (this.searchBox?.focused && this.searchBox.charTyped(ch, mods)) return true;
    return super.charTyped(ch, mods);
  }

  tick(): void {
    super.tick();
    this.searchBox?.tick();
  }
}

/** Safely extracts item names from the injected MinecraftData-like registry. */
function readItemNames(mc: unknown): string[] {
  if (!mc || typeof mc !== 'object') return [];
  const items = (mc as { items?: unknown }).items;
  if (!Array.isArray(items)) return [];
  return items
    .map((i) => (i && typeof i === 'object' && 'name' in i ? String((i as { name: unknown }).name) : ''))
    .filter((n) => n.length > 0);
}
