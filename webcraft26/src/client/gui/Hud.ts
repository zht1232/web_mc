// Port of net.minecraft.client.gui.Hud (26.2) — the in-game HUD.
//
// Java sources (decompiled, G:/ck-web26/src-vanilla):
//   net.minecraft.client.gui.Hud                      extractCrosshair() 439,
//                                                     extractHotbarAndDecorations() 534,
//                                                     extractItemHotbar() 564,
//                                                     extractSelectedItemName() 625,
//                                                     extractPlayerHealth() 761,
//                                                     extractArmor() 814,
//                                                     extractHearts() 838, extractHeart() 893,
//                                                     extractAirBubbles() 905, extractFood() 957,
//                                                     extractSlot() 1134, HeartType 1354
//   net.minecraft.client.gui.contextualbar.ExperienceBar   (W-182)/2, H-24-5; progress = (int)(p * 183)
//   net.minecraft.client.gui.contextualbar.ContextualBar    extractExperienceLevel() 35
//   net.minecraft.client.gui.components.GuiGraphicsExtractor itemDecorations/itemBar/itemCount 928
//   net.minecraft.world.item.Item                     getBarWidth()/getBarColor() 223
//   net.minecraft.client.gui.components.DebugScreenOverlay extractLines() 281 + the
//                                                     left/right split of extractRenderState() 111-213
//   net.minecraft.resources.Identifier                compareTo() 145 (path order — debug entry order)
//   java.util.Random                                  the ±1px jitter sequence (nextInt(2), nextInt(3))
//
// Sprite sizes are the real dimensions of public/mc/gui/sprites/hud/*.png (recorded in the task report):
// hotbar 182x22, hotbar_selection 24x23, offhand 29x24, heart/food/air/armor 9x9,
// experience_bar_* 182x5, crosshair 15x15.
//
// GUI coordinate space: `w`/`h` are the CSS size divided by the GUI scale (the project convention also
// used by ScreenManager). Vanilla uses ceil(framebuffer / scale), so we ceil here — identical at dpr 1.

import type { FontRenderer } from './FontRenderer.js';

/** HeartType minus CONTAINER (Hud.HeartType.forPlayer, 1459). */
export type HeartKind = 'normal' | 'poisoned' | 'withered' | 'frozen';

/** Hud.HeartType.getSprite(boolean isHardcore, boolean isHalf, boolean isBlink) */
export type HeartSpriteKind = HeartKind | 'container' | 'absorbing';

/** One hotbar/offhand slot: the projection of net.minecraft.world.item.ItemStack the HUD needs. */
export interface HudItemSlot {
  /** item registry id, < 0 = empty */
  item: number;
  count: number;
  /** ItemStack.getDamageValue() */
  damage: number;
  /** ItemStack.getMaxDamage() (0 = not damageable) */
  maxDamage: number;
  /** ItemStack.getPopTime(); > 0 squeezes the icon (Hud.extractSlot 1144) */
  popTime: number;
}

export interface HudState {
  /** Player.getHealth() rounded up = half-hearts (Hud.extractPlayerHealth 764) */
  hearts: number;
  /** Attributes.MAX_HEALTH in half-hearts */
  maxHearts: number;
  /** Player.getAbsorptionAmount(), half-hearts */
  absorption: number;
  /** MobEffects.POISON / WITHER / isFullyFrozen (Hud.HeartType.forPlayer 1459) */
  heartKind: HeartKind;
  hardcore: boolean;
  /** FoodData.getFoodLevel(), 0..20 */
  hunger: number;
  /** FoodData.getSaturationLevel(), used for the shake */
  saturation: number;
  /** player.hasEffect(MobEffects.HUNGER) -> food_*_hunger sprites */
  hungerEffect: boolean;
  /** Player.getAirSupply() in ticks, 0..airMax */
  air: number;
  /** Player.getMaxAirSupply() — 300 for players */
  airMax: number;
  /** player.isEyeInFluid(WATER) */
  underwater: boolean;
  /** Player.getArmorValue(), 0..20 */
  armor: number;
  /** Player.experienceProgress, 0..1 */
  xpProgress: number;
  /** Player.experienceLevel */
  xpLevel: number;
  hotbar: HudItemSlot[];
  offhand: HudItemSlot | null;
  /** HumanoidArm.LEFT = the vanilla default (`player.getMainArm().getOpposite()`) */
  offhandLeft: boolean;
  selectedSlot: number;
  /** Hud.toolHighlightTimer, ticks */
  itemNameTimer: number;
  itemName: string;
  /** Left/right debug columns, already laid out by layoutDebugScreen() */
  debugLeft: string[];
  debugRight: string[];
  showDebug: boolean;
  gamemode: 'survival' | 'creative';
  /** Hud.tickCount — drives the low-health/empty-bubble jitter and the blink */
  tickCount: number;
}

/**
 * Survival fields the HUD reads but the survival package may not expose yet
 * (OVERNIGHT-BRIEF §4: P4 adds `airSupply` / `armorValue`). Everything is optional so the HUD keeps
 * working — Game.ts reads them through `??` fallbacks instead of failing to type-check.
 */
export interface HudSurvivalExtensions {
  /** 0..300 ticks */
  airSupply?: number;
  /** Player.getArmorValue() */
  armorValue?: number;
  /** Player.getAbsorptionAmount(), half-hearts */
  absorption?: number;
  heartKind?: HeartKind;
  hardcore?: boolean;
  /** player.hasEffect(MobEffects.HUNGER) */
  hungerEffect?: boolean;
}

export class GuiTextures {
  private readonly cache = new Map<string, HTMLImageElement>();
  private readonly loading = new Map<string, Promise<HTMLImageElement>>();

  constructor(private readonly base = '/mc') {}

  get(path: string): HTMLImageElement | undefined {
    return this.cache.get(path);
  }

  async load(path: string): Promise<HTMLImageElement> {
    const cached = this.cache.get(path);
    if (cached) return cached;
    const pending = this.loading.get(path);
    if (pending) return pending;
    const p = new Promise<HTMLImageElement>((resolve, reject) => {
      const img = new Image();
      img.onload = () => { this.cache.set(path, img); resolve(img); };
      img.onerror = () => reject(new Error('missing gui texture ' + path));
      img.src = `${this.base}/textures/${path}.png`;
    });
    this.loading.set(path, p);
    return p;
  }

  async preload(paths: string[]): Promise<void> {
    await Promise.all(paths.map((p) => this.load(p).catch(() => undefined)));
  }
}

// ---- sprite names -----------------------------------------------------------
const HUD = 'gui/sprites/hud';

/** Every sprite the HUD can draw (Hud.java 86-116 + HeartType 1354-1414). */
export const HUD_SPRITES = [
  `${HUD}/hotbar`,
  `${HUD}/hotbar_selection`,
  `${HUD}/hotbar_offhand_left`,
  `${HUD}/hotbar_offhand_right`,
  `${HUD}/crosshair`,
  `${HUD}/experience_bar_background`,
  `${HUD}/experience_bar_progress`,
  `${HUD}/air`,
  `${HUD}/air_bursting`,
  `${HUD}/air_empty`,
  `${HUD}/armor_empty`,
  `${HUD}/armor_half`,
  `${HUD}/armor_full`,
  `${HUD}/food_empty`,
  `${HUD}/food_half`,
  `${HUD}/food_full`,
  `${HUD}/food_empty_hunger`,
  `${HUD}/food_half_hunger`,
  `${HUD}/food_full_hunger`,
  // Hud.HeartType: container / container_blinking / container_hardcore(_blinking) are the only
  // container variants (the enum reuses the same sprite for half and full).
  ...['container', 'container_hardcore'].flatMap((k) => [`${HUD}/heart/${k}`, `${HUD}/heart/${k}_blinking`]),
  ...['normal', 'poisoned', 'withered', 'frozen', 'absorbing'].flatMap((k) => {
    const prefix = k === 'normal' ? '' : `${k}_`;
    return ['hardcore_', ''].flatMap((hc) =>
      ['full', 'half'].flatMap((half) => {
        const s = `${HUD}/heart/${prefix}${hc}${half}`;
        return [s, `${s}_blinking`];
      }),
    );
  }),
];

/** Hud.HeartType.getSprite(isHardcore, isHalf, isBlink) -> fully qualified sprite path. */
export function heartSprite(kind: HeartSpriteKind, hardcore: boolean, half: boolean, blinking: boolean): string {
  if (kind === 'container') {
    return `${HUD}/heart/${hardcore ? 'container_hardcore' : 'container'}${blinking ? '_blinking' : ''}`;
  }
  const prefix = kind === 'normal' ? '' : `${kind}_`;
  return `${HUD}/heart/${prefix}${hardcore ? 'hardcore_' : ''}${half ? 'half' : 'full'}${blinking ? '_blinking' : ''}`;
}

/** Hud.extractFood 963-974. */
export function foodSprite(hungerEffect: boolean, part: 'empty' | 'half' | 'full'): string {
  return `${HUD}/food_${part}${hungerEffect ? '_hunger' : ''}`;
}

// ---- java.util.Random -------------------------------------------------------
const RANDOM_MULTIPLIER = 0x5DEECE66Dn;
const RANDOM_MASK = (1n << 48n) - 1n;

/**
 * java.util.Random (48-bit LCG), used because the vanilla heart/food/air jitter consumes the exact
 * same sequence after `Hud.extractPlayerHealth` does `random.setSeed(tickCount * 312871)` (Hud.java 782).
 */
export class JavaRandom {
  private seed = 0n;

  constructor(seed = 0) { this.setSeed(seed); }

  setSeed(seed: number): void {
    // java.util.Random.setSeed: seed = (seed ^ multiplier) & ((1 << 48) - 1)
    const long = BigInt.asIntN(64, BigInt(Math.trunc(seed)));
    this.seed = (long ^ RANDOM_MULTIPLIER) & RANDOM_MASK;
  }

  next(bits: number): number {
    this.seed = (this.seed * RANDOM_MULTIPLIER + 0xBn) & RANDOM_MASK;
    return Number(this.seed >> BigInt(48 - bits));
  }

  /** java.util.Random.nextInt(bound) verbatim (power-of-two fast path + rejection loop). */
  nextInt(bound: number): number {
    if (bound <= 0) throw new Error('bound must be positive');
    if ((bound & -bound) === bound) return Number((BigInt(bound) * BigInt(this.next(31))) >> 31n);
    let bits: number;
    let val: number;
    do {
      bits = this.next(31);
      val = bits % bound;
    } while (bits - val + (bound - 1) > 0x7fffffff);
    return val;
  }
}

// ---- Item.getBarColor -------------------------------------------------------
function mthHsvToRgb(hue: number, saturation: number, value: number): string {
  // Mth.hsvToRgb(float,float,float) 26.2
  const h = Math.trunc(hue * 6) % 6;
  const f = hue * 6 - h;
  const p = value * (1 - saturation);
  const q = value * (1 - f * saturation);
  const t = value * (1 - (1 - f) * saturation);
  let r = 0, g = 0, b = 0;
  switch (h) {
    case 0: r = value; g = t; b = p; break;
    case 1: r = q; g = value; b = p; break;
    case 2: r = p; g = value; b = t; break;
    case 3: r = p; g = q; b = value; break;
    case 4: r = t; g = p; b = value; break;
    default: r = value; g = p; b = q; break;
  }
  const to8 = (v: number) => Math.round(Math.max(0, Math.min(1, v)) * 255);
  return `rgb(${to8(r)},${to8(g)},${to8(b)})`;
}

/** Item.getBarColor(): Mth.hsvToRgb(healthPercentage / 3, 1, 1) (Item.java 227). */
export function itemBarColor(healthPercentage: number): string {
  return mthHsvToRgb(Math.max(0, healthPercentage) / 3, 1, 1);
}

/** Item.getBarWidth(): clamp(round(13 - damage*13/maxDamage), 0, 13) (Item.java 223). */
export function itemBarWidth(damage: number, maxDamage: number): number {
  if (maxDamage <= 0) return 0;
  return Math.max(0, Math.min(13, Math.round(13 - (damage * 13) / maxDamage)));
}

/** Hud.extractSlot 1147-1150: the squeeze factor for a stack whose popTime is `pop` ticks. */
export function popTransform(pop: number): { squeeze: number } {
  return { squeeze: 1 + pop / 5 };
}

// ---- debug screen layout ----------------------------------------------------
export interface DebugEntryOutput {
  /** DebugScreenDisplayer.addPriorityLine */
  priority?: string[];
  /** DebugScreenDisplayer.addLine */
  lines?: string[];
  /** DebugScreenDisplayer.addToGroup — keyed by group id, merged in insertion order */
  groups?: { id: string; lines: string[] }[];
}

/**
 * DebugScreenOverlay.extractRenderState 111-213: priority lines alternate between the columns starting
 * on the left, plain lines are split in half, groups are split in half, and every section ends with a
 * blank spacer. Entries must be passed in Identifier order (DebugScreenEntryList.sorted by path).
 */
export function layoutDebugScreen(entries: DebugEntryOutput[]): { left: string[]; right: string[] } {
  const left: string[] = [];
  const right: string[] = [];
  const regular: string[] = [];
  const groups = new Map<string, string[]>();

  for (const entry of entries) {
    for (const line of entry.priority ?? []) {
      if (left.length > right.length) right.push(line);
      else left.push(line);
    }
    for (const group of entry.groups ?? []) {
      const bucket = groups.get(group.id);
      if (bucket) bucket.push(...group.lines);
      else groups.set(group.id, [...group.lines]);
    }
    regular.push(...(entry.lines ?? []));
  }

  if (left.length) left.push('');
  if (right.length) right.push('');

  if (regular.length) {
    const mid = Math.ceil(regular.length / 2);
    left.push(...regular.slice(0, mid));
    right.push(...regular.slice(mid));
    left.push('');
    if (mid < regular.length) right.push('');
  }

  const allGroups = [...groups.values()];
  if (allGroups.length) {
    const mid = Math.ceil(allGroups.length / 2);
    allGroups.forEach((lines, i) => {
      if (!lines.length) return;
      if (i < mid) {
        left.push(...lines, '');
      } else {
        right.push(...lines, '');
      }
    });
  }

  return { left, right };
}

// ---- HUD --------------------------------------------------------------------
const HEART_SIZE = 9;
const HEART_SEPARATION = 8;
const NUM_HEARTS_PER_ROW = 10;
const NUM_AIR_BUBBLES = 10;
const AIR_BUBBLE_SEPARATION = 8;
/** DebugScreenOverlay.extractLines: text colour -2039584 (0xFFE0E0E0), background -1873784752 (0x90505050) */
const DEBUG_TEXT_COLOR = '#e0e0e0';
const DEBUG_BG_COLOR = 'rgba(80, 80, 80, 0.565)';
const DEBUG_LINE_HEIGHT = 9;

export class Hud {
  // Hud.extractPlayerHealth 767-780: displayHealth lags the real health by up to 1s and blinking lasts
  // 20 ticks after damage (10 after a heal).
  private lastHealth = 20;
  private displayHealth = 20;
  private lastHealthTime = 0;
  private healthBlinkTime = 0;
  private readonly random = new JavaRandom(0);

  constructor(
    private readonly font: FontRenderer,
    private readonly textures: GuiTextures,
  ) {}

  /**
   * @param w,h logical GUI size (CSS size / GUI scale, ceiled like Window#guiScaledWidth)
   */
  render(
    ctx: CanvasRenderingContext2D,
    state: HudState,
    w: number,
    h: number,
    drawItem: (ctx: CanvasRenderingContext2D, item: number, x: number, y: number, size: number) => void,
  ): void {
    const W = Math.ceil(w);
    const H = Math.ceil(h);

    // Hud.extractRenderState 222: crosshair first, then hotbar/health/xp, then the item name overlay.
    this.renderCrosshair(ctx, W, H);
    this.renderHotbar(ctx, state, W, H, drawItem);
    const hurtable = state.gamemode !== 'creative'; // gameMode.canHurtPlayer()
    if (hurtable) {
      this.renderPlayerHealth(ctx, state, W, H);
      this.renderExperience(ctx, state, W, H); // gameMode.hasExperience()
    }
    this.renderSelectedItemName(ctx, state, W, H);
    if (state.showDebug) this.renderDebug(ctx, state, W, H);
  }

  // ---- crosshair ------------------------------------------------------------
  /** Hud.extractCrosshair 446: 15x15 sprite, INVERT blend (RenderPipelines.CROSSHAIR). */
  private renderCrosshair(ctx: CanvasRenderingContext2D, W: number, H: number): void {
    const sprite = this.textures.get(`${HUD}/crosshair`);
    if (!sprite) return;
    const x = Math.floor((W - 15) / 2);
    const y = Math.floor((H - 15) / 2);
    ctx.save();
    // RenderPipelines.CROSSHAIR uses blend "invert": dst' = 1 - dst for the white glyphs.
    // Canvas 'difference' with a white source is |255 - dst| = 255 - dst on [0,255].
    ctx.globalCompositeOperation = 'difference';
    ctx.globalAlpha = 1;
    ctx.drawImage(sprite, 0, 0, sprite.width, sprite.height, x, y, 15, 15);
    ctx.restore();
  }

  // ---- hotbar ---------------------------------------------------------------
  /** Hud.extractItemHotbar 564-623. */
  private renderHotbar(
    ctx: CanvasRenderingContext2D,
    state: HudState,
    W: number,
    H: number,
    drawItem: (ctx: CanvasRenderingContext2D, item: number, x: number, y: number, size: number) => void,
  ): void {
    const center = Math.floor(W / 2);
    const left = center - 91;

    this.blit(ctx, `${HUD}/hotbar`, left, H - 22);

    // selection: 24x23 drawn one pixel up-left of the slot
    this.blit(ctx, `${HUD}/hotbar_selection`, left - 1 + state.selectedSlot * 20, H - 23);

    if (state.offhand) {
      if (state.offhandLeft) this.blit(ctx, `${HUD}/hotbar_offhand_left`, center - 91 - 29, H - 23);
      else this.blit(ctx, `${HUD}/hotbar_offhand_right`, center + 91, H - 23);
    }

    for (let i = 0; i < 9; i++) {
      const slot = state.hotbar[i];
      if (!slot) continue;
      this.drawSlot(ctx, slot, center - 90 + i * 20 + 2, H - 16 - 3, drawItem);
    }

    if (state.offhand) {
      const x = state.offhandLeft ? center - 91 - 26 : center + 91 + 10;
      this.drawSlot(ctx, state.offhand, x, H - 16 - 3, drawItem);
    }
  }

  /** Hud.extractSlot 1134-1160 + GuiGraphicsExtractor.itemDecorations 928. */
  private drawSlot(
    ctx: CanvasRenderingContext2D,
    slot: HudItemSlot,
    x: number,
    y: number,
    drawItem: (ctx: CanvasRenderingContext2D, item: number, x: number, y: number, size: number) => void,
  ): void {
    if (slot.item < 0 || slot.count <= 0) return;

    const pop = slot.popTime;
    if (pop > 0) {
      // vanilla: translate(x+8, y+12); scale(1/f, (f+1)/2); translate(-(x+8), -(y+12))
      const f = popTransform(pop).squeeze;
      ctx.save();
      ctx.translate(x + 8, y + 12);
      ctx.scale(1 / f, (f + 1) / 2);
      ctx.translate(-(x + 8), -(y + 12));
    }
    drawItem(ctx, slot.item, x, y, 16);
    if (pop > 0) ctx.restore();

    this.drawItemBar(ctx, slot, x, y);
    this.drawItemCount(ctx, slot, x, y);
  }

  /** GuiGraphicsExtractor.itemBar 938-945. */
  private drawItemBar(ctx: CanvasRenderingContext2D, slot: HudItemSlot, x: number, y: number): void {
    if (slot.maxDamage <= 0 || slot.damage <= 0) return; // ItemStack.isBarVisible
    const barWidth = itemBarWidth(slot.damage, slot.maxDamage);
    const health = Math.max(0, (slot.maxDamage - slot.damage) / slot.maxDamage);
    ctx.fillStyle = '#000000';
    ctx.fillRect(x + 2, y + 13, 13, 2);
    if (barWidth > 0) {
      ctx.fillStyle = itemBarColor(health);
      ctx.fillRect(x + 2, y + 13, barWidth, 1);
    }
  }

  /** GuiGraphicsExtractor.itemCount 947-952: x + 19 - 2 - width, y + 6 + 3, with shadow. */
  private drawItemCount(ctx: CanvasRenderingContext2D, slot: HudItemSlot, x: number, y: number): void {
    if (slot.count === 1) return;
    const text = String(slot.count);
    this.font.draw(ctx, text, x + 19 - 2 - this.font.width(text), y + 6 + 3, '#ffffff', true);
  }

  // ---- health / armor / food / air ------------------------------------------
  /** Hud.extractPlayerHealth 761-811. */
  private renderPlayerHealth(ctx: CanvasRenderingContext2D, state: HudState, W: number, H: number): void {
    const currentHealth = state.hearts;
    const now = Date.now();

    // 767-778: 1s health lag + blink timers
    if (currentHealth < this.lastHealth) {
      this.lastHealthTime = now;
      this.healthBlinkTime = state.tickCount + 20;
    } else if (currentHealth > this.lastHealth) {
      this.lastHealthTime = now;
      this.healthBlinkTime = state.tickCount + 10;
    }
    if (now - this.lastHealthTime > 1000) {
      this.displayHealth = currentHealth;
      this.lastHealthTime = now;
    }
    this.lastHealth = currentHealth;
    const oldHealth = this.displayHealth;
    // (healthBlinkTime - tickCount) / 3L % 2L == 1L
    const blink = this.healthBlinkTime > state.tickCount
      && Math.trunc((this.healthBlinkTime - state.tickCount) / 3) % 2 === 1;

    this.random.setSeed(Math.imul(state.tickCount, 312871)); // Hud.java 782

    const xLeft = Math.floor(W / 2) - 91;
    const xRight = Math.floor(W / 2) + 91;
    const yLineBase = H - 39;
    const maxHealth = Math.max(state.maxHearts, Math.max(oldHealth, currentHealth));
    const absorption = Math.max(0, state.absorption);
    const numHealthRows = Math.ceil((maxHealth + absorption) / 2 / 10);
    const healthRowHeight = Math.max(10 - (numHealthRows - 2), 3);
    // no vehicles in the port -> yLineAir = yLineBase - 10 - 10 (Hud.java 790/805)
    const yLineAir = yLineBase - 10 - 10;
    // MobEffects.REGENERATION does not exist yet: heartOffsetIndex stays -1 (Hud.java 791-794)
    const heartOffsetIndex = -1;

    this.renderArmor(ctx, state.armor, xLeft, yLineBase, numHealthRows, healthRowHeight);

    const heartContainers = Math.ceil(maxHealth / 2);
    const absorptionContainers = Math.ceil(absorption / 2);
    const maxHealthHalves = heartContainers * 2;
    for (let i = heartContainers + absorptionContainers - 1; i >= 0; i--) {
      const row = Math.floor(i / NUM_HEARTS_PER_ROW);
      const column = i % NUM_HEARTS_PER_ROW;
      const xo = xLeft + column * HEART_SEPARATION;
      let yo = yLineBase - row * healthRowHeight;
      if (currentHealth + absorption <= 4) yo += this.random.nextInt(2); // Hud.java 862
      if (i < heartContainers && i === heartOffsetIndex) yo -= 2;

      this.blit(ctx, heartSprite('container', state.hardcore, false, blink), xo, yo);

      const halves = i * 2;
      if (i >= heartContainers) {
        const absorptionHalves = halves - maxHealthHalves;
        if (absorptionHalves < absorption) {
          const kind: HeartSpriteKind = state.heartKind === 'withered' ? 'withered' : 'absorbing';
          this.blit(ctx, heartSprite(kind, state.hardcore, absorptionHalves + 1 === absorption, false), xo, yo);
        }
      }
      if (blink && halves < oldHealth) {
        this.blit(ctx, heartSprite(state.heartKind, state.hardcore, halves + 1 === oldHealth, true), xo, yo);
      }
      if (halves < currentHealth) {
        this.blit(ctx, heartSprite(state.heartKind, state.hardcore, halves + 1 === currentHealth, false), xo, yo);
      }
    }

    this.renderFood(ctx, state, xRight, yLineBase);
    this.renderAir(ctx, state, xRight, yLineAir);
  }

  /** Hud.extractArmor 814-836. */
  private renderArmor(
    ctx: CanvasRenderingContext2D,
    armor: number,
    xLeft: number,
    yLineBase: number,
    numHealthRows: number,
    healthRowHeight: number,
  ): void {
    if (armor <= 0) return;
    const yLineArmor = yLineBase - (numHealthRows - 1) * healthRowHeight - 10;
    for (let i = 0; i < 10; i++) {
      const xo = xLeft + i * HEART_SEPARATION;
      if (i * 2 + 1 < armor) this.blit(ctx, `${HUD}/armor_full`, xo, yLineArmor);
      if (i * 2 + 1 === armor) this.blit(ctx, `${HUD}/armor_half`, xo, yLineArmor);
      if (i * 2 + 1 > armor) this.blit(ctx, `${HUD}/armor_empty`, xo, yLineArmor);
    }
  }

  /** Hud.extractFood 957-990. */
  private renderFood(ctx: CanvasRenderingContext2D, state: HudState, xRight: number, yLineBase: number): void {
    const food = state.hunger;
    for (let i = 0; i < 10; i++) {
      let yo = yLineBase;
      if (state.saturation <= 0 && state.tickCount % (food * 3 + 1) === 0) {
        yo = yLineBase + (this.random.nextInt(3) - 1);
      }
      const xo = xRight - i * HEART_SEPARATION - 9;
      this.blit(ctx, foodSprite(state.hungerEffect, 'empty'), xo, yo);
      if (i * 2 + 1 < food) this.blit(ctx, foodSprite(state.hungerEffect, 'full'), xo, yo);
      if (i * 2 + 1 === food) this.blit(ctx, foodSprite(state.hungerEffect, 'half'), xo, yo);
    }
  }

  /** Hud.extractAirBubbles 905-933 (no vehicle hearts -> row offset 0). */
  private renderAir(ctx: CanvasRenderingContext2D, state: HudState, xRight: number, yLineAir: number): void {
    const maxAir = state.airMax > 0 ? state.airMax : 300;
    const current = Math.max(0, Math.min(state.air, maxAir));
    if (!state.underwater && current >= maxAir) return;

    const full = Math.ceil(((current - 2) * 10) / maxAir);
    const popping = Math.ceil((current * 10) / maxAir);
    const delay = current !== 0 && state.underwater ? 1 : 0;
    const empty = 10 - Math.ceil(((current + delay) * 10) / maxAir);
    const isPopping = full !== popping;

    for (let bubble = 1; bubble <= NUM_AIR_BUBBLES; bubble++) {
      const x = xRight - (bubble - 1) * AIR_BUBBLE_SEPARATION - 9;
      if (bubble <= full) {
        this.blit(ctx, `${HUD}/air`, x, yLineAir);
      } else if (isPopping && bubble === popping && state.underwater) {
        this.blit(ctx, `${HUD}/air_bursting`, x, yLineAir);
      } else if (bubble > 10 - empty) {
        const wobble = empty === 10 && state.tickCount % 2 === 0 ? this.random.nextInt(2) : 0;
        this.blit(ctx, `${HUD}/air_empty`, x, yLineAir + wobble);
      }
    }
  }

  // ---- experience -----------------------------------------------------------
  /** contextualbar/ExperienceBar + ContextualBar.extractExperienceLevel 35-44. */
  private renderExperience(ctx: CanvasRenderingContext2D, state: HudState, W: number, H: number): void {
    const left = Math.floor((W - 182) / 2);
    const top = H - 24 - 5;
    this.blit(ctx, `${HUD}/experience_bar_background`, left, top);

    // ExperienceBar: int progress = (int)(player.experienceProgress * 183.0F)  <- 183, not 182
    const progress = Math.trunc(state.xpProgress * 183);
    const sprite = this.textures.get(`${HUD}/experience_bar_progress`);
    if (progress > 0 && sprite) {
      ctx.drawImage(sprite, 0, 0, progress, 5, left, top, progress, 5);
    }

    if (state.xpLevel <= 0) return;
    const text = String(state.xpLevel);
    const x = Math.floor((W - this.font.width(text)) / 2);
    const y = H - 24 - 9 - 2;
    // ContextualBar.extractExperienceLevel: four black offsets, then the green face.
    for (const [dx, dy] of [[1, 0], [-1, 0], [0, 1], [0, -1]]) {
      this.font.draw(ctx, text, x + dx, y + dy, '#000000', false);
    }
    this.font.draw(ctx, text, x, y, '#80ff20', false);
  }

  // ---- selected item name ---------------------------------------------------
  /** Hud.extractSelectedItemName 625-648. */
  private renderSelectedItemName(ctx: CanvasRenderingContext2D, state: HudState, W: number, H: number): void {
    if (state.itemNameTimer <= 0 || !state.itemName) return;
    const width = this.font.width(state.itemName);
    const x = Math.floor((W - width) / 2);
    let y = H - 59;
    if (state.gamemode === 'creative') y += 14; // !gameMode.canHurtPlayer()
    const alpha = Math.min(255, Math.trunc((state.itemNameTimer * 256) / 10));
    if (alpha <= 0) return;

    // textWithBackdrop 291-299: fill(x-2, y-2, x+width+2, y+9+2, ARGB.multiply(bg, color));
    // getBackgroundColor(0.0F) = black at 50% (textBackgroundOpacity default 0.5).
    ctx.fillStyle = `rgba(0, 0, 0, ${0.5 * (alpha / 255)})`;
    ctx.fillRect(x - 2, y - 2, width + 4, 13);
    this.font.draw(ctx, state.itemName, x, y, '#ffffff', true, alpha / 255);
  }

  // ---- F3 debug screen ------------------------------------------------------
  /** DebugScreenOverlay.extractLines 281-303: per-line background strip + 9px lines. */
  private renderDebug(ctx: CanvasRenderingContext2D, state: HudState, W: number, _H: number): void {
    const columns: [string[], boolean][] = [[state.debugLeft, true], [state.debugRight, false]];
    for (const [lines, alignLeft] of columns) {
      for (let i = 0; i < lines.length; i++) {
        const line = lines[i];
        if (!line) continue;
        const width = this.font.width(line);
        const x = alignLeft ? 2 : W - 2 - width;
        const y = 2 + DEBUG_LINE_HEIGHT * i;
        ctx.fillStyle = DEBUG_BG_COLOR;
        ctx.fillRect(x - 1, y - 1, width + 2, DEBUG_LINE_HEIGHT);
        this.font.draw(ctx, line, x, y, DEBUG_TEXT_COLOR, false);
      }
    }
  }

  private blit(ctx: CanvasRenderingContext2D, path: string, x: number, y: number): void {
    const img = this.textures.get(path);
    if (img) ctx.drawImage(img, x, y);
  }
}
