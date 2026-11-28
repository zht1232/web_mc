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
import { MENU_OFFHAND_SLOT } from './SlotLayout.js';
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

/** CreativeModeInventoryScreen is 195x136 on every tab (ItemPickerMenu, Java 26.2). */
const CREATIVE_IMAGE_WIDTH = 195;
const CREATIVE_IMAGE_HEIGHT = 136;
const DESTROY_X = 173;
const DESTROY_Y = 112;
// CreativeModeTab.createTextureLocation: items / item_search / inventory.
const TAB_BACKGROUND_ITEMS = 'gui/container/creative_inventory/tab_items';
const TAB_BACKGROUND_SEARCH = 'gui/container/creative_inventory/tab_item_search';
const TAB_BACKGROUND_INVENTORY = 'gui/container/creative_inventory/tab_inventory';

/** InventoryMenu armor slots 5..8 and the offhand slot, with their empty-slot sprites. */
const EMPTY_SLOT_SPRITES: Record<number, string> = {
  5: 'container/slot/helmet', 6: 'container/slot/chestplate', 7: 'container/slot/leggings', 8: 'container/slot/boots',
  [MENU_OFFHAND_SLOT]: 'container/slot/shield',
};

export class CreativeModeInventoryScreen extends AbstractContainerScreen {
  /** Authoritative tab list (used by the Node test suite). */
  static readonly TABS: readonly CreativeTabData[] = DEFAULT_CREATIVE_TABS;

  private readonly tabs: CreativeTabData[];
  private selectedTab = 0;
  private searchBox!: EditBox;
  private currentItemIds: number[] = [];
  private allItemNames: string[] = [];
  /** Localized display name per allItemNames entry (creativeNameSearch equivalent). */
  private allItemLabels: string[] = [];
  private scrollOffs = 0;
  private scrolling = false;
  private xMouse = 0;
  private yMouse = 0;
  private previewCache: { yaw: number; pitch: number; canvas: HTMLCanvasElement } | null = null;

  constructor(env: ConstructorParameters<typeof AbstractContainerScreen>[0]) {
    super(env, 'container.creative', CREATIVE_IMAGE_WIDTH, CREATIVE_IMAGE_HEIGHT, TAB_BACKGROUND_ITEMS);
    this.allItemNames = readItemNames(env.deps.mc);
    this.allItemLabels = this.allItemNames.map((n) => localizedItemName(env.t, n));
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

  private isSurvivalTab(): boolean { return this.selectedTab === TAB_SURVIVAL; }

  /**
   * CreativeModeTab#getBackgroundTexture: every tab uses its own 195x136 sheet (items,
   * item_search, inventory). The panel size never changes (Java: imageWidth 195, imageHeight 136).
   */
  private configureLayout(): void {
    const survival = this.isSurvivalTab();
    this.imageWidth = CREATIVE_IMAGE_WIDTH;
    this.imageHeight = CREATIVE_IMAGE_HEIGHT;
    this.backgroundTexture = survival
      ? TAB_BACKGROUND_INVENTORY
      : this.selectedTab === TAB_SEARCH ? TAB_BACKGROUND_SEARCH : TAB_BACKGROUND_ITEMS;
    this.relayout();
    if (this.searchBox) {
      this.searchBox.setPosition(this.leftPos + CREATIVE_SEARCH_X, this.topPos + CREATIVE_SEARCH_Y);
    }
  }

  private setTab(index: number): void {
    if (index < 0 || index >= this.tabs.length) return;
    const enteringSearch = index === TAB_SEARCH && this.selectedTab !== TAB_SEARCH;
    this.selectedTab = index;
    this.scrollOffs = 0;
    // Java selectTab(): entering Search clears the previous query, every other tab clears the
    // box as well (the field only exists on the Search tab).
    if (this.searchBox) {
      this.searchBox.visible = index === TAB_SEARCH;
      if (index === TAB_SEARCH) {
        if (enteringSearch) this.searchBox.setValue('');
      } else {
        this.searchBox.setValue('');
      }
    }
    this.configureLayout();
    this.refreshItems();
  }

  private refreshItems(): void {
    const tab = this.tabs[this.selectedTab];
    const rawQuery = this.searchBox?.getValue().trim() ?? '';
    const query = rawQuery.toLowerCase();
    let names = tab.items.length ? tab.items : (this.selectedTab === TAB_SEARCH ? this.allItemNames : []);
    if (query) {
      if (query.startsWith('#')) {
        names = this.searchByTag(query.slice(1));
      } else {
        const needle = query.replace(/\s+/g, '_');
        names = this.allItemNames.filter((n, i) =>
          this.allItemLabels[i].toLowerCase().includes(query) || n.includes(needle));
      }
    }
    this.currentItemIds = names.map((n) => this.itemIndex(n)).filter((id) => id >= 0);
    this.writeMenuItems();
  }

  /** Java refreshSearchResults(): "#tag" searches the item tag table by tag location. */
  private searchByTag(term: string): string[] {
    const table = this.env.deps.itemTags ?? {};
    const matched = new Set<string>();
    for (const [tag, entries] of Object.entries(table)) {
      if (!tag.includes(term)) continue;
      for (const id of entries) matched.add(itemId(id));
    }
    return this.allItemNames.filter((n) => matched.has(n));
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
    if (this.isSurvivalTab()) {
      // CreativeModeInventoryScreen.selectTab (Type.INVENTORY): the InventoryMenu 2x2 crafting
      // grid + result are parked off-screen, armor moves to (54|108, 6|33), offhand to (35,20),
      // the main inventory to y=54/72/90 and the hotbar to y=112.
      for (let menuSlot = 0; menuSlot <= MENU_OFFHAND_SLOT; menuSlot++) {
        let x: number;
        let y: number;
        if (menuSlot >= 5 && menuSlot < 9) {
          const pos = menuSlot - 5;
          x = 54 + Math.floor(pos / 2) * 54;
          y = 6 + (pos % 2) * 27;
        } else if (menuSlot < 5) {
          x = -2000;
          y = -2000;
        } else if (menuSlot === MENU_OFFHAND_SLOT) {
          x = 35;
          y = 20;
        } else {
          const pos = menuSlot - 9;
          x = GRID_LEFT + (pos % 9) * SLOT_GRID;
          y = menuSlot >= 36 ? HOTBAR_TOP : 54 + Math.floor(pos / 9) * SLOT_GRID;
        }
        out.push({ index: menuSlot, x, y });
      }
      return out;
    }
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

  protected emptySlotSprite(menuSlot: number): string | undefined {
    return this.isSurvivalTab() ? EMPTY_SLOT_SPRITES[menuSlot] : undefined;
  }

  protected drawLabels(g: GuiGraphics): void {
    if (this.isSurvivalTab()) return; // CreativeModeTabs INVENTORY tab uses hideTitle()
    const tab = this.tabs[this.selectedTab];
    // CreativeModeTab#getDisplayName -> translatable "itemGroup.<name>"; drawing the raw
    // tab.key showed English labels even with a Chinese locale.
    if (tab) g.drawString(this.t(tab.key), 8, 6, -12566464, false);
  }

  protected renderBackground(g: GuiGraphics, mx: number, my: number, pt: number): void {
    this.xMouse = mx;
    this.yMouse = my;
    super.renderBackground(g, mx, my, pt);
    g.pushPose();
    g.translate(this.leftPos, this.topPos);

    // InventoryScreen#extractBackground / CreativeModeInventoryScreen#extractBackground: the
    // player model sits at (73,6)-(105,49) on the Survival Inventory tab.
    if (this.isSurvivalTab()) this.drawEntityPreview(g, 73, 6, 105, 49);

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

    // Scroller: CreativeModeInventoryScreen#extractBackground draws the thumb (or the disabled
    // thumb) when the selected tab can scroll; the well is part of the tab background texture.
    const trackH = 112;
    const maxScroll = this.maxScroll();
    if (!this.isSurvivalTab()) {
      const canScroll = maxScroll > 0;
      const sprite = canScroll
        ? 'container/creative_inventory/scroller'
        : 'container/creative_inventory/scroller_disabled';
      const thumbY = canScroll
        ? SCROLLER_Y + Math.round((trackH - 17) * (this.scrollOffs / maxScroll))
        : SCROLLER_Y;
      if (g.sprites.get(sprite)) g.blitSprite(sprite, SCROLLER_X, thumbY, CREATIVE_SCROLLER_WIDTH, CREATIVE_SCROLLER_HEIGHT);
    }

    // The destroy-item bin is a real Slot at (173,112) that only exists on the Survival
    // Inventory tab, and its frame is part of tab_inventory.png. The old unconditional
    // grey square at (168,111) was the stray button under the scrollbar.
    g.popPose();
  }

  /**
   * InventoryScreen.extractEntityInInventoryFollowsMouse: both mouse axes drive the preview -
   * xAngle = atan((centreX - mouseX) / 40) turns the body/head, yAngle = atan((centreY - mouseY)/40)
   * pitches the camera and the head.
   */
  private drawEntityPreview(g: GuiGraphics, x0: number, y0: number, x1: number, y1: number): void {
    const render = this.env.deps.renderEntityPreview;
    const cx = (x0 + x1) / 2;
    const cy = (y0 + y1) / 2;
    const xAngle = Math.atan((this.leftPos + cx - this.xMouse) / 40);
    const yAngle = Math.atan((this.topPos + cy - this.yMouse) / 40);
    const keyYaw = Math.round(xAngle * 40) / 40;
    const keyPitch = Math.round(yAngle * 40) / 40;
    if (render) {
      if (!this.previewCache || this.previewCache.yaw !== keyYaw || this.previewCache.pitch !== keyPitch) {
        const canvas = render(120, keyYaw, keyPitch);
        if (canvas) this.previewCache = { yaw: keyYaw, pitch: keyPitch, canvas };
      }
      if (this.previewCache) {
        g.drawCanvas(this.previewCache.canvas, x0, y0, x1 - x0, y1 - y0);
        return;
      }
    }
    this.drawFallbackPreview(g, x0, y0, x1, y1);
  }

  private drawFallbackPreview(g: GuiGraphics, x0: number, y0: number, x1: number, y1: number): void {
    const cx = Math.floor((x0 + x1) / 2);
    const lean = Math.max(-3, Math.min(3, Math.round((cx - (this.xMouse - this.leftPos)) / 20)));
    const x = cx + lean;
    const y = y0 + 8;
    g.fill(x - 8, y, x + 8, y + 16, 0xffb57b53);
    g.fill(x - 8, y + 16, x + 8, y + 40, 0xff26a0b5);
    g.fill(x - 16, y + 16, x - 8, y + 40, 0xff1e7f90);
    g.fill(x + 8, y + 16, x + 16, y + 40, 0xff1e7f90);
    g.fill(x - 8, y + 40, x, y + 62, 0xff37378f);
    g.fill(x, y + 40, x + 8, y + 62, 0xff2f2f78);
    g.fill(x - 5, y + 5, x - 3, y + 7, 0xff2b2b2b);
    g.fill(x + 3, y + 5, x + 5, y + 7, 0xff2b2b2b);
    g.outline(x - 8, y, 16, 16, 0xff000000);
    void this.yMouse;
    void y1;
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
      if (!this.isSurvivalTab() && mx >= sx && mx < sx + CREATIVE_SCROLLER_WIDTH &&
        my >= this.topPos + SCROLLER_Y && my < this.topPos + SCROLLER_Y + 112) {
        this.scrolling = true;
        this.applyScrollbar(mx, my);
        return true;
      }
      // Deletes the carried stack: the Survival Inventory tab's destroy slot at (173,112).
      // Shift-click empties every inventory slot (vanilla slotClicked destroyItemSlot branch).
      if (this.selectedTab === TAB_SURVIVAL) {
        const tx = this.leftPos + 173;
        const ty = this.topPos + 112;
        if (mx >= tx && mx < tx + 16 && my >= ty && my < ty + 16) {
          const shift = (this.env.mods & 1) !== 0;
          if (shift) this.menu.clearAll?.();
          else this.menu.setCarried(null);
          this.pressedSlot = -1;
          return true;
        }
      }
    }
    if (action === 'cancel') this.scrolling = false;
    if (action === 'down' && button >= 0 && button <= 2) {
      const idx = this.getHoveredSlot(mx, my);
      if (!this.isSurvivalTab() && idx >= 0 && idx < CREATIVE_NUM_ROWS * CREATIVE_NUM_COLS) {
        this.hoveredSlot = idx;
        const shift = (this.env.mods & 1) !== 0;
        const actionKind = button === 2 ? 'CLONE' : shift ? 'QUICK_MOVE' : 'PICKUP';
        this.menu.click(idx, button, shift, actionKind);
        // A plain PICKUP leaves the stack on the cursor. Remember the source slot so the
        // parent's release handler treats the following click on the hotbar as a real
        // PICKUP instead of leaving the stack glued to the pointer.
        if (actionKind === 'PICKUP') this.pressedSlot = idx;
        return true;
      }
    }
    if (action === 'move' && this.scrolling) { this.applyScrollbar(mx, my); return true; }
    if (action === 'up' && this.scrolling) { this.scrolling = false; return true; }
    if (action === 'wheel' && !this.isSurvivalTab()) {
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

/** Item.getDescriptionId -> localized name (creativeNameSearch indexes the display name). */
function localizedItemName(t: (key: string) => string, name: string): string {
  for (const key of [`block.minecraft.${name}`, `item.minecraft.${name}`]) {
    const translated = t(key);
    if (translated !== key) return translated;
  }
  return name.replace(/_/g, ' ');
}
