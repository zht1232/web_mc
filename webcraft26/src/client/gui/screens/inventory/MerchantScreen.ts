// Source: net.minecraft.client.gui.screens.inventory.MerchantScreen (26.2)
//
// 276x166 villager trade panel (textures/gui/container/villager.png, 512x256
// sheet). Seven 88x20 offer rows on the left, three trade slots on the right,
// the villager level bar and the player inventory. Selecting a row calls
// MerchantMenu.setSelectionHint + tryMoveItems, exactly like postButtonClick.

import type { GuiGraphics } from '../../GuiGraphics.js';
import type { MerchantInfo, MerchantOfferView, MouseAction } from '../../Types.js';
import { AbstractContainerScreen, type SlotDef } from './AbstractContainerScreen.js';
import { Button } from '../../components/Button.js';
import { LABEL_COLOR } from '../../GuiConstants.js';

const IMAGE_WIDTH = 276;
const IMAGE_HEIGHT = 166;
/** VillagerData.NEXT_LEVEL_XP_THRESHOLDS. */
const LEVEL_XP = [0, 10, 70, 150, 250];
const SCROLL_BAR_TOP = 18;
const SCROLL_BAR_HEIGHT = 139;
const SCROLLER_WIDTH = 6;
const SCROLLER_HEIGHT = 27;
const SCROLL_START_X = 94;

export class MerchantScreen extends AbstractContainerScreen {
  private readonly offerButtons: Button[] = [];
  private scrollOff = 0;
  private draggingScroller = false;

  constructor(env: ConstructorParameters<typeof AbstractContainerScreen>[0]) {
    super(env, 'entity.minecraft.villager', IMAGE_WIDTH, IMAGE_HEIGHT, 'gui/container/villager');
    this.inventoryLabelX = 107;
  }

  protected buildSlots(): SlotDef[] {
    const out: SlotDef[] = [
      { index: 0, x: 136, y: 37 },
      { index: 1, x: 162, y: 37 },
      { index: 2, x: 220, y: 37 },
    ];
    for (let i = 0; i < 27; i++) {
      out.push({ index: 3 + i, x: 108 + (i % 9) * 18, y: 84 + Math.floor(i / 9) * 18 });
    }
    for (let i = 0; i < 9; i++) out.push({ index: 30 + i, x: 108 + i * 18, y: 142 });
    return out;
  }

  protected override build(): void {
    this.relayout();
    this.offerButtons.length = 0;
    for (let i = 0; i < 7; i++) {
      const button = new Button(
        this.leftPos + 5, this.topPos + 16 + 2 + i * 20, 88, 20, '',
        () => this.selectOffer(i),
      );
      this.offerButtons.push(this.addRenderableWidget(button));
    }
    if (this.env.deps.touchInput) {
      this.addRenderableWidget(new Button(this.width - 48, 4, 44, 20, this.t('gui.done'), () => {
        this.onClose();
        this.close();
      }));
    }
    this.updateOfferButtons();
  }

  tick(): void {
    super.tick();
    this.updateOfferButtons();
  }

  private info(): MerchantInfo | null {
    return this.env.deps.container?.merchantInfo?.() ?? null;
  }

  private maxScroll(): number {
    return Math.max(0, (this.info()?.offers.length ?? 0) - 7);
  }

  private updateOfferButtons(): void {
    const offers = this.info()?.offers.length ?? 0;
    for (let i = 0; i < this.offerButtons.length; i++) {
      const button = this.offerButtons[i];
      button.setPosition(this.leftPos + 5, this.topPos + 16 + 2 + i * 20);
      button.visible = i + this.scrollOff < offers;
    }
  }

  private selectOffer(row: number): void {
    const index = row + this.scrollOff;
    this.info()?.select(index);
  }

  // ------------------------------------------------------------- background
  protected override drawLabels(g: GuiGraphics): void {
    const info = this.info();
    const level = Math.max(1, Math.min(5, info?.level ?? 1));
    let title = this.title;
    if (info?.showProgress) {
      const format = this.t('merchant.title');
      const levelName = this.t(`merchant.level.${level}`);
      title = format.includes('%s')
        ? format.replace('%s', this.title).replace('%s', levelName)
        : `${this.title} - ${levelName}`;
    }
    g.drawString(title, 49 + Math.floor(IMAGE_WIDTH / 2) - Math.floor(g.textWidth(title) / 2), 6, LABEL_COLOR, false);
    const trades = this.t('merchant.trades');
    g.drawString(trades, 5 - Math.floor(g.textWidth(trades) / 2) + 48, 6, LABEL_COLOR, false);
    g.drawString(this.playerInventoryTitle, this.inventoryLabelX, this.inventoryLabelY, LABEL_COLOR, false);
  }

  // ------------------------------------------------------------- foreground
  protected override renderForeground(g: GuiGraphics, mx: number, my: number, pt: number): void {
    const info = this.info();
    if (!info || info.offers.length === 0) {
      super.renderForeground(g, mx, my, pt);
      return;
    }
    g.pushPose();
    g.translate(this.leftPos, this.topPos);

    const first = this.scrollOff;
    const last = Math.min(info.offers.length, this.scrollOff + 7);
    for (let index = first; index < last; index++) {
      const row = index - first;
      const y = 19 + row * 20;
      const offer = info.offers[index];
      this.drawCostA(g, offer, 10, y);
      if (offer.costB.itemId >= 0) {
        g.renderItem(offer.costB.itemId, 40, y, 16);
        g.renderItemDecorations(offer.costB.itemId, offer.costB.count, 40, y);
      }
      g.blitSprite(
        offer.outOfStock ? 'container/villager/trade_arrow_out_of_stock' : 'container/villager/trade_arrow',
        60, y + 3, 10, 9,
      );
      g.renderItem(offer.result.itemId, 73, y, 16);
      g.renderItemDecorations(offer.result.itemId, offer.result.count, 73, y);
    }

    const selected = info.offers[Math.min(info.offers.length - 1, this.scrollOff)];
    if (selected?.outOfStock) {
      g.blitSprite('container/villager/out_of_stock', 182, 35, 28, 21);
    }
    if (info.showProgress) this.drawProgressBar(g, info);
    this.drawScroller(g, info);
    g.popPose();

    this.drawOfferTooltip(g, info, mx, my);
    super.renderForeground(g, mx, my, pt);
  }

  private drawCostA(g: GuiGraphics, offer: MerchantOfferView, x: number, y: number): void {
    const costA = offer.costA;
    const base = offer.baseCostA;
    g.renderItem(costA.itemId, x, y, 16);
    if (base.count === costA.count) {
      g.renderItemDecorations(costA.itemId, costA.count, x, y);
      return;
    }
    g.renderItemDecorations(base.itemId, base.count, x, y, base.count === 1 ? '1' : undefined);
    g.renderItemDecorations(costA.itemId, costA.count, x + 14, y, costA.count === 1 ? '1' : undefined);
    g.blitSprite('container/villager/discount_strikethrough', x + 7, y + 12, 9, 2);
  }

  private drawProgressBar(g: GuiGraphics, info: MerchantInfo): void {
    if (info.level >= 5) return;
    g.blitSpriteRegion('container/villager/experience_bar_background', 136, 16, 102, 5, 0, 0, 102, 5);
    const minXp = LEVEL_XP[info.level - 1] ?? 0;
    const maxXp = LEVEL_XP[info.level] ?? 0;
    if (info.xp < minXp || maxXp <= minXp) return;
    const multiplier = 102 / (maxXp - minXp);
    const width = Math.min(Math.floor(multiplier * (info.xp - minXp)), 102);
    g.blitSpriteRegion('container/villager/experience_bar_current', 136, 16, width, 5, 0, 0, width, 5);
    if (info.futureXp > 0) {
      const future = Math.min(Math.floor(info.futureXp * multiplier), 102 - width);
      if (future > 0) {
        g.blitSpriteRegion('container/villager/experience_bar_result', 136 + width, 16, future, 5, width, 0, future, 5);
      }
    }
  }

  private drawScroller(g: GuiGraphics, info: MerchantInfo): void {
    const steps = info.offers.length + 1 - 7;
    if (steps > 1) {
      const leftover = SCROLL_BAR_HEIGHT - (SCROLLER_HEIGHT + (steps - 1) * SCROLL_BAR_HEIGHT / steps);
      const stepHeight = 1 + Math.floor(leftover / steps) + Math.floor(SCROLL_BAR_HEIGHT / steps);
      const offset = this.scrollOff === steps - 1
        ? 113
        : Math.min(113, this.scrollOff * stepHeight);
      g.blitSprite('container/villager/scroller', SCROLL_START_X, SCROLL_BAR_TOP + offset, SCROLLER_WIDTH, SCROLLER_HEIGHT);
    } else {
      g.blitSprite('container/villager/scroller_disabled', SCROLL_START_X, SCROLL_BAR_TOP, SCROLLER_WIDTH, SCROLLER_HEIGHT);
    }
  }

  private drawOfferTooltip(g: GuiGraphics, info: MerchantInfo, mx: number, my: number): void {
    if (info.offers.length === 0) return;
    const rowHeight = 20;
    if (my < this.topPos + 18 || my >= this.topPos + 18 + 7 * rowHeight) return;
    if (mx < this.leftPos + 5 || mx >= this.leftPos + 5 + 88) return;
    const row = Math.floor((my - (this.topPos + 18)) / rowHeight);
    const index = row + this.scrollOff;
    const offer = info.offers[index];
    if (!offer) return;
    const buttonX = this.leftPos + 5;
    if (mx < buttonX + 20) {
      if (offer.costA.itemId >= 0) g.renderItemTooltip(offer.costA.itemId, mx, my);
    } else if (mx >= buttonX + 30 && mx <= buttonX + 50) {
      if (offer.costB.itemId >= 0) g.renderItemTooltip(offer.costB.itemId, mx, my);
    } else if (mx > buttonX + 65) {
      if (offer.result.itemId >= 0) g.renderItemTooltip(offer.result.itemId, mx, my);
    }
  }

  // ------------------------------------------------------------- scrolling
  override mouseEvent(mx: number, my: number, button: number, action: MouseAction, wheelDelta = 0): boolean {
    if (action === 'wheel') {
      const max = this.maxScroll();
      if (max > 0) {
        this.scrollOff = Math.max(0, Math.min(max, this.scrollOff - Math.sign(wheelDelta)));
        this.updateOfferButtons();
      }
      return true;
    }
    if (action === 'down' && this.inScroller(mx, my) && this.maxScroll() > 0) {
      this.draggingScroller = true;
      this.dragScroller(my);
      return true;
    }
    if (action === 'move' && this.draggingScroller) {
      this.dragScroller(my);
      return true;
    }
    if (action === 'up' && this.draggingScroller) {
      this.draggingScroller = false;
      return true;
    }
    return super.mouseEvent(mx, my, button, action, wheelDelta);
  }

  private inScroller(mx: number, my: number): boolean {
    return mx > this.leftPos + SCROLL_START_X
      && mx < this.leftPos + SCROLL_START_X + SCROLLER_WIDTH
      && my > this.topPos + SCROLL_BAR_TOP
      && my <= this.topPos + SCROLL_BAR_TOP + SCROLL_BAR_HEIGHT + 1;
  }

  private dragScroller(my: number): void {
    const max = this.maxScroll();
    if (max <= 0) return;
    const top = this.topPos + SCROLL_BAR_TOP;
    const ratio = (my - top - 13.5) / (SCROLL_BAR_HEIGHT - SCROLLER_HEIGHT);
    this.scrollOff = Math.max(0, Math.min(max, Math.round(ratio * max + 0.5)));
    this.updateOfferButtons();
  }
}
