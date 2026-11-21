// Unified entry point for the ported net.minecraft.client.gui system.
// Mirrors net.minecraft.client.gui.Gui#setScreen / Minecraft#setScreen and
// net.minecraft.client.gui.render.GuiRenderer (per-frame screen rendering).
//
// Integration contract for the main agent (Game.ts owns the wiring):
//   const manager = new ScreenManager(game.guiCanvas, game.gl, {
//     mc: game.mc, models: game.models, font: game.font,
//     textures: game.guiTextures, icons: game.icons, options: game.options,
//     callbacks: { onPlay, onCreateWorld, onLoadWorld, onOptionChange, ... },
//   });
//   manager.resize(innerWidth, innerHeight);           // on window resize
//   manager.render(partialTick);                       // AFTER 3D scene + HUD
//   manager.onKey(e.code, e.key, mods);                // keydown; true = consumed
//   manager.onMouse(mx, my, btn, 'down'|'up'|'move'|'wheel', wheelDelta);
//   game.onInventoryToggle = () => manager.open('inventory');
//   game.onChatToggle      = () => manager.open('chat');
//
// Mouse coordinates passed to onMouse are CSS pixels relative to the canvas
// (clientX/clientY). The manager divides by guiScale to obtain vanilla GUI
// coordinates. No Game.ts import: all data arrives through ScreenDeps.

import type { ScreenDeps, ScreenEnv, ScreenRef, MouseAction } from './Types.js';
import { GuiGraphics } from './GuiGraphics.js';
import { GuiSpriteAtlas, CORE_SPRITES } from './GuiSpriteAtlas.js';
import { calcGuiScale, guiScaledSize } from './GuiScale.js';
import { I18n, DEFAULT_I18N } from './Language.js';
import { ToastManager } from './components/ToastManager.js';
import { Screen } from './screens/Screen.js';
import { TitleScreen } from './screens/TitleScreen.js';
import { CreateWorldScreen } from './screens/CreateWorldScreen.js';
import { SelectWorldScreen } from './screens/SelectWorldScreen.js';
import { OptionsScreen } from './screens/OptionsScreen.js';
import { VideoSettingsScreen } from './screens/options/VideoSettingsScreen.js';
import { ControlsScreen } from './screens/options/ControlsScreen.js';
import { LanguageSelectScreen } from './screens/options/LanguageSelectScreen.js';
import { SoundOptionsScreen } from './screens/options/SoundOptionsScreen.js';
import { PauseScreen } from './screens/PauseScreen.js';
import { StatisticsScreen } from './screens/StatisticsScreen.js';
import { DeathScreen } from './screens/DeathScreen.js';
import { ChatScreen } from './screens/ChatScreen.js';
import { InventoryScreen } from './screens/inventory/InventoryScreen.js';
import { CreativeModeInventoryScreen } from './screens/inventory/CreativeModeInventoryScreen.js';
import { CraftingScreen } from './screens/inventory/CraftingScreen.js';
import { FurnaceScreen } from './screens/inventory/FurnaceScreen.js';
import { ChestScreen } from './screens/inventory/ChestScreen.js';
import { EnchantingScreen } from './screens/inventory/EnchantingScreen.js';
import { BrewingScreen } from './screens/inventory/BrewingScreen.js';

/** Textures that must be decoded before the first screen is drawn. */
const PRELOAD_TEXTURES = [
  'gui/menu_background', 'gui/inworld_menu_background',
  'gui/header_separator', 'gui/footer_separator',
  'gui/container/inventory', 'gui/container/crafting_table', 'gui/container/furnace',
  'gui/container/generic_54', 'gui/container/enchanting_table', 'gui/container/brewing_stand',
  'gui/recipe_book',
  'gui/container/creative_inventory/tab_items',
  'gui/container/creative_inventory/tab_inventory',
  'gui/container/creative_inventory/tab_item_search',
  'gui/title/minecraft', 'gui/title/minceraft', 'gui/title/edition',
  'gui/title/background/panorama_0', 'gui/title/background/panorama_1',
  'gui/title/background/panorama_2', 'gui/title/background/panorama_3',
  'gui/title/background/panorama_4', 'gui/title/background/panorama_5',
  'gui/title/background/panorama_overlay',
] as const;

export class ScreenManager {
  private readonly ctx: CanvasRenderingContext2D;
  private readonly sprites: GuiSpriteAtlas;
  private readonly i18n: I18n;
  private readonly toasts = new ToastManager();
  private readonly env: ScreenEnv;

  private _current: Screen | null = null;
  private readonly stack: Screen[] = [];
  private readonly registry: Record<string, (...args: unknown[]) => Screen>;

  private cssW = 0;
  private cssH = 0;
  private logicalW = 0;
  private logicalH = 0;
  private mouseX = 0;
  private mouseY = 0;
  private lastMods = 0;
  private lastFrameTime = 0;
  private tickAccum = 0;

  constructor(
    private readonly canvas: HTMLCanvasElement,
    private readonly gl: WebGL2RenderingContext,
    private readonly deps: ScreenDeps,
  ) {
    this.ctx = canvas.getContext('2d')!;
    this.sprites = deps.sprites ?? new GuiSpriteAtlas('/mc');
    this.i18n = DEFAULT_I18N;
    const translate = (key: string): string => deps.i18n ? deps.i18n(key) : this.i18n.get(key);

    const self = this;
    this.env = {
      get deps(): ScreenDeps { return self.deps; },
      get width(): number { return self.logicalW; },
      get height(): number { return self.logicalH; },
      get mods(): number { return self.lastMods; },
      get font() { return self.deps.font; },
      get textures() { return self.deps.textures; },
      get sprites() { return self.sprites; },
      get icons() { return self.deps.icons; },
      get t() { return translate; },
      open: (screen: ScreenRef, ...args: unknown[]) => self.open(screen, ...args),
      close: () => self.close(),
      back: () => self.back(),
      toast: (message: string) => { if (message) self.toasts.addText(message, ''); },
    };

    this.registry = this.buildRegistry();

    // Preload sprites (PNG + .mcmeta) and vanilla textures asynchronously.
    void this.sprites.preload(CORE_SPRITES);
    void this.deps.textures.preload([...PRELOAD_TEXTURES]);
    if (!deps.i18n) void this.i18n.load('/mc');
    void this.gl; // kept for a future GL-batched backend; Canvas2D is used today.
  }

  private buildRegistry(): Record<string, (...args: unknown[]) => Screen> {
    const e = this.env;
    return {
      title: () => new TitleScreen(e),
      selectWorld: () => new SelectWorldScreen(e),
      createWorld: () => new CreateWorldScreen(e),
      options: () => new OptionsScreen(e),
      video: () => new VideoSettingsScreen(e),
      controls: () => new ControlsScreen(e),
      language: () => new LanguageSelectScreen(e),
      sound: () => new SoundOptionsScreen(e),
      pause: () => new PauseScreen(e),
      stats: () => new StatisticsScreen(e),
      death: (cause?: unknown, score?: unknown) => new DeathScreen(e, String(cause ?? ''), String(score ?? '')),
      chat: (initial?: unknown) => new ChatScreen(e, String(initial ?? '')),
      inventory: () => new InventoryScreen(e),
      creative: () => new CreativeModeInventoryScreen(e),
      crafting: () => new CraftingScreen(e),
      furnace: () => new FurnaceScreen(e),
      chest: (rows?: unknown) => new ChestScreen(e, typeof rows === 'number' ? rows : 3),
      enchanting: () => new EnchantingScreen(e),
      brewing: () => new BrewingScreen(e),
    };
  }

  // ------------------------------------------------------------- screen stack
  open(screen: ScreenRef, ...args: unknown[]): void {
    let instance: Screen;
    if (typeof screen === 'string') {
      const factory = this.registry[screen];
      if (!factory) {
        console.warn(`[ScreenManager] unknown screen "${screen}"`);
        return;
      }
      instance = factory(...args);
    } else {
      instance = screen as Screen;
    }
    if (this._current && this._current !== instance) this.stack.push(this._current);
    this._current = instance;
    this.ensureLogicalSize();
    instance.init(this.logicalW, this.logicalH);
    if (instance instanceof SelectWorldScreen) void instance.refresh();
  }

  close(): void {
    this._current = null;
    this.stack.length = 0;
    this.deps.callbacks.onScreenClosed?.();
  }

  /** Pop to the previous screen; used by option sub-pages / world-selection. */
  back(): void {
    const previous = this.stack.pop();
    if (!previous) { this.close(); return; }
    this.ensureLogicalSize();
    previous.resize(this.logicalW, this.logicalH);
    this._current = previous;
  }

  get current(): Screen | null { return this._current; }

  /** Live language switch: rebuild widget labels on the whole stack. */
  refreshLanguage(): void {
    this.ensureLogicalSize();
    for (const s of this.stack) { s.refreshTexts(); s.resize(this.logicalW, this.logicalH); }
    if (this._current) { this._current.refreshTexts(); this._current.resize(this.logicalW, this.logicalH); }
  }

  get guiSpriteAtlas(): GuiSpriteAtlas { return this.sprites; }
  get toastManager(): ToastManager { return this.toasts; }

  // ------------------------------------------------------------- geometry
  private dpr(): number {
    if (this.cssW > 0 && this.canvas.width > 0) return this.canvas.width / this.cssW;
    if (typeof window !== 'undefined') return Math.min(window.devicePixelRatio || 1, 2);
    return 1;
  }

  /** Window#calculateScale / Options#getMaxGuiScale, using the framebuffer size. */
  get guiScale(): number {
    // Game owns the live scale (it also applies the touch-device minimum). Keep both HUD and
    // screens on the same logical pixel grid instead of computing a second, smaller scale here.
    const live = (globalThis as unknown as { __mc?: { guiScale?: number } }).__mc?.guiScale;
    if (typeof live === 'number' && live >= 1) return live;
    const fw = this.canvas.width || Math.floor(this.cssW * this.dpr());
    const fh = this.canvas.height || Math.floor(this.cssH * this.dpr());
    const forced = typeof this.deps.options?.guiScale === 'number' ? this.deps.options.guiScale : 0;
    return calcGuiScale(fw, fh, forced, false);
  }

  /** Window#setGuiScale: GUI logical size is ceil(framebuffer / scale). */
  private ensureLogicalSize(): void {
    const scale = this.guiScale || 1;
    const fw = this.canvas.width || Math.floor(this.cssW * this.dpr());
    const fh = this.canvas.height || Math.floor(this.cssH * this.dpr());
    const size = guiScaledSize(fw, fh, scale);
    this.logicalW = this.cssW > 0 ? size.width : GuiScalePlaceholder;
    this.logicalH = this.cssH > 0 ? size.height : GuiScalePlaceholder;
  }

  resize(w: number, h: number): void {
    this.cssW = w;
    this.cssH = h;
    this.ensureLogicalSize();
    if (this._current) this._current.resize(this.logicalW, this.logicalH);
  }

  // ------------------------------------------------------------- frame
  /** Called every frame AFTER the 3D scene and HUD have been drawn. */
  render(partialTick: number): void {
    const now = typeof performance !== 'undefined' ? performance.now() : Date.now();
    const dt = this.lastFrameTime ? Math.min(200, Math.max(0, now - this.lastFrameTime)) : 16;
    this.lastFrameTime = now;

    this.ensureLogicalSize();
    const scale = this.guiScale || 1;
    const W = this.canvas.width;
    const H = this.canvas.height;

    // Reset state the HUD may have left behind (crosshair uses 'difference').
    this.ctx.setTransform(1, 0, 0, 1, 0, 0);
    this.ctx.globalAlpha = 1;
    this.ctx.globalCompositeOperation = 'source-over';
    this.ctx.filter = 'none';
    this.ctx.imageSmoothingEnabled = false;

    // A screen that preserves the HUD (ChatScreen) draws over it; all other
    // menus clear the GUI canvas first (vanilla hides the HUD while a screen is up).
    if (this._current && !this._current.preserveHud) {
      this.ctx.setTransform(1, 0, 0, 1, 0, 0);
      this.ctx.clearRect(0, 0, W, H);
    }
    this.ctx.setTransform(scale, 0, 0, scale, 0, 0);

    const g = new GuiGraphics(this.ctx, {
      font: this.deps.font,
      textures: this.deps.textures,
      sprites: this.sprites,
      icons: this.deps.icons,
      width: this.logicalW,
      height: this.logicalH,
      itemName: makeItemName(this.deps.mc, (k) => this.env.t(k)),
    });

    // 20 Hz widget ticking (EditBox cursor blink, splash rotation, panorama spin).
    this.tickAccum += dt;
    while (this.tickAccum >= 50) {
      this._current?.tick();
      this.toasts.tick(50);
      this.tickAccum -= 50;
    }
    if (!this._current) this.toasts.tick(dt);

    if (this._current) {
      this._current.render(g, this.mouseX, this.mouseY, partialTick);
    }
    this.toasts.render(g, this.logicalW);
    g.flush();
  }

  // ------------------------------------------------------------- input
  /**
   * @returns true when the screen consumed the event (the main loop should not
   *          also move the player / grab the mouse).
   */
  onKey(code: string, char: string, mods: number): boolean {
    this.lastMods = mods;
    if (!this._current) return false;
    if (this._current.keyPressed(code, char, mods)) return true;
    if (char.length === 1) return this._current.charTyped(char, mods);
    return false;
  }

  setModifiers(mods: number): void { this.lastMods = mods; }

  /** mx/my are CSS pixels relative to the GUI canvas. */
  onMouse(mx: number, my: number, button: number, action: MouseAction, wheelDelta = 0, mods = this.lastMods): boolean {
    this.lastMods = mods;
    const scale = this.guiScale || 1;
    const dpr = this.dpr();
    this.mouseX = (mx * dpr) / scale;
    this.mouseY = (my * dpr) / scale;
    if (!this._current) return false;
    // DOM MouseEvent.button (0=left,1=middle,2=right) -> GLFW/vanilla GUI button
    // (0=left,1=right,2=middle). Without this, right-click split / place-one never fired.
    const guiButton = button === 2 ? 1 : button === 1 ? 2 : button;
    return this._current.mouseEvent(this.mouseX, this.mouseY, guiButton, action, wheelDelta);
  }

  /** Registers or replaces a screen factory (for the main agent / other agents). */
  register(name: string, factory: (...args: unknown[]) => Screen): void {
    this.registry[name] = factory;
  }
}

const GuiScalePlaceholder = 320;

function makeItemName(mc: unknown, t: (key: string) => string): (itemId: number) => string {
  return (id: number): string => {
    if (!mc || typeof mc !== 'object') return `item.${id}`;
    const items = (mc as { items?: unknown }).items;
    if (!Array.isArray(items)) return `item.${id}`;
    const item = items[id] as { name?: unknown } | undefined;
    if (!item || typeof item.name !== 'string') return `item.${id}`;
    for (const key of [`block.minecraft.${item.name}`, `item.minecraft.${item.name}`]) {
      const translated = t(key);
      if (translated !== key) return translated;
    }
    return item.name;
  };
}
