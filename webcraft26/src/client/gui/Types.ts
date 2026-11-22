// Shared, DOM-free type definitions for the ported net.minecraft.client.gui system.
// Source: net.minecraft.client.gui (screens / components / GuiGraphics contracts).
// Everything here is type-only: importing this module from Node/tsx pulls in no browser API.

import type { FontRenderer } from './FontRenderer.js';
import type { GuiTextures } from './Hud.js';
import type { ItemIconAtlas } from './ItemIconAtlas.js';
import type { GuiSpriteAtlas } from './GuiSpriteAtlas.js';
import type { GuiGraphics } from './GuiGraphics.js';
import type { StatisticsView } from '../../vanilla/world/stats/Statistics.js';

export interface Rect {
  x: number;
  y: number;
  width: number;
  height: number;
}

export type MouseAction = 'down' | 'up' | 'move' | 'wheel' | 'cancel';
export type ContainerAction = 'PICKUP' | 'QUICK_MOVE' | 'SPLIT' | 'THROW' | 'CLONE' | 'SWAP' | 'QUICK_CRAFT' | 'PICKUP_ALL';
export type GameMode = 'survival' | 'creative';
export type Difficulty = 'peaceful' | 'easy' | 'normal' | 'hard';

/** Subset of GameOptions the GUI reads/writes. Kept structural so Game.ts need not be imported. */
export interface GuiOptions {
  renderDistance: number;
  guiScale: number; // 0 = auto, mirrors Options.guiScale
  fov: number;
  brightness: number;
  gamemode: GameMode;
  shaderQuality?: string;
  shadersEnabled?: boolean;
  [key: string]: unknown;
}

export interface WorldSummary {
  id: string;
  name: string;
  seed?: number | string;
  gameMode?: GameMode;
  difficulty?: Difficulty;
  lastPlayed?: number;
  version?: string;
  hardcore?: boolean;
}

/** Implemented by the IndexedDB save-list agent. Screens only depend on this interface. */
export interface WorldListProvider {
  list(): Promise<WorldSummary[]>;
  create(options: CreateWorldOptions): Promise<WorldSummary>;
  delete(id: string): Promise<void>;
  load?(id: string): Promise<void>;
  /** Serialises a world to a downloadable archive (local backup). */
  exportWorld?(id: string): Promise<Uint8Array>;
  /** Imports an archive produced by exportWorld(); resolves with the new world id. */
  importWorld?(data: ArrayBuffer): Promise<string>;
}

export interface CreateWorldOptions {
  name: string;
  gameMode: GameMode;
  difficulty: Difficulty;
  seed: string;
  generateStructures: boolean;
  bonusChest?: boolean;
  allowCommands?: boolean;
}

export interface CreativeTabData {
  key: string;
  icon: string;   // e.g. "minecraft:bricks"
  items: string[]; // item ids (with or without the minecraft: prefix)
}

export interface ScreenCallbacks {
  onPlay?(): void;
  onCreateWorld?(options: CreateWorldOptions): void;
  onLoadWorld?(id: string): void;
  onDeleteWorld?(id: string): void;
  onOptionChange?(key: string, value: unknown): void;
  onQuit?(): void;
  onRespawn?(): void;
  onChatMessage?(text: string): void;
  /** A screen was closed (Esc, E, Back to Game, ...). */
  onScreenClosed?(): void;
  onInventorySlotClick?(slot: number, button: number, shift: boolean): void;
  onClose?(): void;
}

/** A single item stack shown in a container slot. */
export interface ItemStack {
  itemId: number; // -1 = empty
  count: number;
}

/** Container menu contract injected by the main agent (never imported from Game). */
export interface ContainerMenuLike {
  getSlotCount(): number;
  getItem(index: number): ItemStack;
  /** button: 0 = left, 1 = right; shift = QUICK_MOVE; action describes the vanilla ContainerInput. */
  click(index: number, button: number, shift: boolean, action: ContainerAction): void;
  canPlaceItem?(index: number, stack: ItemStack): boolean;
  getMaxStackSize?(index: number, stack: ItemStack): number;
  getCarried(): ItemStack | null;
  setCarried(stack: ItemStack | null): void;
  /** Creative inventory writes its virtual tab grid through this (optional for real menus). */
  setItem?(index: number, stack: ItemStack): void;
  /** Enchanting table: offer costs + affordability for the three buttons. */
  enchantInfo?(playerLevels: number): { costs: number[]; canEnchant: boolean[] };
  /** Enchanting table: apply offer `slot` (0..2); true when it was consumed. */
  enchant?(slot: number): boolean;
  /** Brewing stand: brew timer (0..400) and fuel (0..20) for the progress sprites. */
  brewInfo?(): { progress: number; fuel: number };
}

/** Constructor dependency bundle. All main-loop data is injected here, never imported from Game. */
export interface ScreenDeps {
  /** MinecraftData-like item registry (opaque to the GUI except through helpers). */
  mc?: unknown;
  models?: unknown;
  font: FontRenderer;
  textures: GuiTextures;
  /** Optional: ScreenManager creates a default GuiSpriteAtlas if omitted. */
  sprites?: GuiSpriteAtlas;
  icons: ItemIconAtlas;
  options: GuiOptions;
  /** Live player statistics for the Statistics screen (StatsScreen). */
  stats?: StatisticsView;
  /** Data-driven advancement definitions/progress for AdvancementsScreen. */
  advancements?: import('../../vanilla/world/advancements/AdvancementManager.js').AdvancementManager;
  /** Live XP level (EnchantingScreen affordability). */
  playerLevel?: () => number;
  touchInput?: boolean;
  /** Optional: ScreenManager falls back to the built-in I18n if omitted. */
  i18n?: (key: string) => string;
  worlds?: WorldListProvider;
  creativeTabs?: CreativeTabData[];
  /**
   * Renders the local player into an offscreen canvas for the survival-inventory preview.
   * `size` is the GUI-pixel height of the box, `yawRad` the orbit angle from the mouse.
   */
  renderEntityPreview?(size: number, yawRad: number): HTMLCanvasElement | null;
  /** Active container menu for inventory/chest/furnace/crafting screens. */
  container?: ContainerMenuLike;
  callbacks: ScreenCallbacks;
  /** Optional live hook to window.__mc.renderer.shaderQuality (wired by the main agent). */
  shaderQuality?: { get(): string; set(value: string): void };
}

/** Structural contract every screen satisfies (the concrete class is screens/Screen.ts). */
export interface ScreenLike {
  readonly width: number;
  readonly height: number;
  /** When true the manager does NOT clear the HUD before drawing (ChatScreen). */
  readonly preserveHud: boolean;
  init(width: number, height: number): void;
  resize(width: number, height: number): void;
  tick(): void;
  render(g: GuiGraphics, mouseX: number, mouseY: number, partialTick: number): void;
  keyPressed(code: string, char: string, mods: number): boolean;
  charTyped(ch: string, mods: number): boolean;
  mouseEvent(mx: number, my: number, button: number, action: MouseAction, wheelDelta?: number): boolean;
  onClose(): void;
  shouldCloseOnEsc(): boolean;
  isPauseScreen(): boolean;
}

export type ScreenRef = string | ScreenLike;

/** Structural contract for renderable + focusable widgets (components/*). */
export interface WidgetLike {
  x: number;
  y: number;
  width: number;
  height: number;
  active: boolean;
  visible: boolean;
  readonly focused: boolean;
  getRect(): Rect;
  setPosition(x: number, y: number): void;
  isMouseOver(mx: number, my: number): boolean;
  setFocused(value: boolean): void;
  render(g: GuiGraphics, mouseX: number, mouseY: number, partialTick: number): void;
  mouseClicked(mx: number, my: number, button: number): boolean;
  mouseReleased(mx: number, my: number, button: number): boolean;
  mouseDragged(mx: number, my: number, button: number, dx: number, dy: number): boolean;
  mouseScrolled(mx: number, my: number, delta: number): boolean;
  keyPressed(code: string, char: string, mods: number): boolean;
  charTyped(ch: string, mods: number): boolean;
  tick(): void;
}

/** The environment the manager hands to every Screen instance. */
export interface ScreenEnv {
  readonly deps: ScreenDeps;
  readonly width: number;
  readonly height: number;
  /** Live keyboard modifier bitmask: 1 = shift, 2 = ctrl, 4 = alt. */
  readonly mods: number;
  readonly font: FontRenderer;
  readonly textures: GuiTextures;
  readonly sprites: GuiSpriteAtlas;
  readonly icons: ItemIconAtlas;
  readonly t: (key: string) => string;
  open(screen: ScreenRef, ...args: unknown[]): void;
  close(): void;
  /** Return to the previous screen, or to the title menu if the stack is empty. */
  back(): void;
  toast(message: string): void;
}
