// The client glue: owns the canvas, the level, the player, the render loop and input.
// Structure follows Minecraft.runTick / GameRenderer.render.

import { MinecraftData, setMinecraftData } from '../vanilla/world/level/block/state/BlockState.js';
import { ClientLevel, DAY_LENGTH } from '../vanilla/world/level/ClientLevel.js';
import { LevelChunk } from '../vanilla/world/level/chunk/LevelChunk.js';
import { Player, TICK_MS, type PlayerInput } from '../vanilla/world/entity/player/Player.js';
import { ModelSource } from './renderer/model/ModelSource.js';
import { TextureManager } from './renderer/TextureManager.js';
import { BiomeColors } from './renderer/BiomeColors.js';
import { LevelRenderer, type Camera } from './renderer/LevelRenderer.js';
import { LevelChunk as Chunk } from '../vanilla/world/level/chunk/LevelChunk.js';
import { buildLightmap, computeSkyState, DAY_PERIOD, type SkyState } from './EnvironmentLighting.js';
import { FontRenderer } from './gui/FontRenderer.js';
import { GuiTextures, Hud, HUD_SPRITES, type HudState } from './gui/Hud.js';
import { ItemIconAtlas } from './gui/ItemIconAtlas.js';
import { AABB, Vec3 } from '../vanilla/core/Geometry.js';
import { NoiseChunkGenerator, loadWorldgenData } from '../vanilla/world/level/levelgen/NoiseChunkGenerator.js';
import { ChunkProvider } from './world/ChunkProvider.js';
import { EntityManager } from '../vanilla/world/entity/EntityManager.js';
import { EntityRenderDispatcher } from './renderer/entity/EntityRenderDispatcher.js';
import { ScreenManager } from './gui/ScreenManager.js';
import type { ContainerMenuLike, GuiOptions, ScreenRef } from './gui/Types.js';
import { SurvivalState, loadWorldData, type PlayerMoved } from '../vanilla/gameplay/SurvivalState.js';
import { ItemStack } from '../vanilla/world/item/ItemStack.js';
import { ItemEntity } from '../vanilla/world/entity/item/ItemEntity.js';
import { ContainerInput } from '../vanilla/world/inventory/ClickAction.js';
import type { AbstractContainerMenu } from '../vanilla/world/inventory/AbstractContainerMenu.js';
import { SkyRenderer } from './renderer/environment/SkyRenderer.js';
import { CloudRenderer } from './renderer/environment/CloudRenderer.js';
import { WeatherRenderer } from './renderer/environment/WeatherRenderer.js';
import type { LevelLike } from './renderer/environment/EnvCommon.js';
import { ParticleEngine, spawnBlockBreakParticles } from './particle/ParticleEngine.js';
import { SoundEngine } from './audio/SoundEngine.js';
import { WorldSaveManager, type LoadedWorld } from './world/save/WorldSaveManager.js';
import { Autosave } from './world/save/Autosave.js';
import {
  ChunkSerializer, MinecraftDataBlockStateCodec, ReversibleBiomeCodec, type ChunkCodecOptions,
} from '../vanilla/world/level/storage/ChunkSerializer.js';
import { PlayerData, type ItemStackData } from '../vanilla/world/level/storage/PlayerData.js';

export interface GameOptions {
  renderDistance: number;
  guiScale: number;
  fov: number;
  brightness: number;
  gamemode: 'survival' | 'creative';
  seed?: number;
  /** worker pool size override (defaults to min(hardwareConcurrency, 4)) */
  workers?: number;
}

const DEFAULT_OPTIONS: GameOptions = {
  renderDistance: 8,
  guiScale: 0,
  fov: 70,
  brightness: 0,
  gamemode: 'creative',
  seed: 0x2602c0de,
};

/** GUI ContainerMenuLike action -> vanilla ContainerInput (SPLIT is PICKUP with button 1). */
const ACTION_TO_INPUT: Record<string, ContainerInput> = {
  PICKUP: ContainerInput.PICKUP,
  QUICK_MOVE: ContainerInput.QUICK_MOVE,
  SPLIT: ContainerInput.PICKUP,
  THROW: ContainerInput.THROW,
  CLONE: ContainerInput.CLONE,
  SWAP: ContainerInput.SWAP,
};

export class Game {
  readonly glCanvas: HTMLCanvasElement;
  readonly guiCanvas: HTMLCanvasElement;
  private readonly gl: WebGL2RenderingContext;
  private readonly guiCtx: CanvasRenderingContext2D;

  mc!: MinecraftData;
  models!: ModelSource;
  textures!: TextureManager;
  biomeColors!: BiomeColors;
  renderer!: LevelRenderer;
  level!: ClientLevel;
  player!: Player;
  generator!: NoiseChunkGenerator;
  chunkProvider!: ChunkProvider;

  font!: FontRenderer;
  guiTextures!: GuiTextures;
  hud!: Hud;
  icons!: ItemIconAtlas;

  entityManager!: EntityManager;
  entityRenderer!: EntityRenderDispatcher;
  screens!: ScreenManager;
  survival!: SurvivalState;
  skyRenderer!: SkyRenderer;
  cloudRenderer!: CloudRenderer;
  weatherRenderer!: WeatherRenderer;
  particles!: ParticleEngine;
  sounds!: SoundEngine;
  /**
   * EnvCommon.LevelLike declares `rainLevel?: number` publicly, but ClientLevel keeps it private,
   * so the level is not structurally assignable. One cast here keeps both modules untouched.
   */
  private levelLike!: LevelLike;
  saveManager?: WorldSaveManager;
  autosave?: Autosave;
  private chunkCodec!: ChunkCodecOptions;

  options: GameOptions = { ...DEFAULT_OPTIONS };

  private running = false;
  private lastFrame = 0;
  private accum = 0;
  private frames = 0;
  private fpsTimer = 0;
  private fps = 0;
  private tickCount = 0;

  /**
   * Hotbar ids are a *projection* of the survival inventory — the PlayerInventory is the only
   * data source (see INTEGRATION.md §11 conflict 1). Writing goes through `survival.inventory`.
   */
  get hotbar(): number[] {
    if (!this.survival) return [];
    return this.survival.hotbarStacks().map((s) => (s.item ? s.item.id : -1));
  }

  /** Index into `survival.inventory`, mirrored so the HUD/GUI agree on the selection. */
  get selectedSlot(): number { return this.survival ? this.survival.inventory.getSelectedSlot() : 0; }
  set selectedSlot(slot: number) { this.survival?.inventory.setSelectedSlot(slot); }
  private itemNameTimer = 0;
  private itemName = '';

  private keys = new Set<string>();
  private mouseLocked = false;
  private lastJumpPress = 0;
  private attackCooldown = 0;
  private useCooldown = 0;
  /** left button held: survival mining advances while this is true */
  private mining = false;
  /** walkDist of the last footstep sound */
  private stepDistance = 0;
  private screenWasOpen = false;

  private sky: SkyState = computeSkyState(1000);
  private lightmapData = new Uint8Array(16 * 16 * 4);
  private lightmapKey = '';
  /** Column chosen by findSpawnSpot() before any terrain is generated. */
  private spawnSpot: { x: number; z: number; y: number } | null = null;
  /** Chunk-set signature last handed to the entity manager (see syncEntityChunks). */
  private entityChunkKey = '';

  onReady?: () => void;
  onStatus?: (text: string, progress: number) => void;

  constructor(container: HTMLElement, private readonly seedOverride?: number, workers?: number) {
    this.glCanvas = document.createElement('canvas');
    this.glCanvas.className = 'game-canvas';
    this.guiCanvas = document.createElement('canvas');
    this.guiCanvas.className = 'gui-canvas';
    container.appendChild(this.glCanvas);
    container.appendChild(this.guiCanvas);

    const gl = this.glCanvas.getContext('webgl2', { antialias: false, alpha: false, powerPreference: 'high-performance' });
    if (!gl) throw new Error('WebGL2 is required');
    this.gl = gl;
    this.guiCtx = this.guiCanvas.getContext('2d')!;
    if (seedOverride !== undefined) this.options.seed = seedOverride;
    if (workers !== undefined) this.options.workers = workers;
  }

  async init(): Promise<void> {
    this.onStatus?.('Loading block data', 0.05);
    this.mc = await MinecraftData.load('/mc');
    setMinecraftData(this.mc);

    this.onStatus?.('Loading models', 0.15);
    this.models = await ModelSource.load('/mc');

    this.onStatus?.('Loading textures', 0.3);
    this.textures = new TextureManager(this.gl);
    await this.textures.load('/mc');

    this.onStatus?.('Loading fonts', 0.4);
    this.font = new FontRenderer();
    await this.font.load('/mc');
    this.guiTextures = new GuiTextures('/mc');
    await this.guiTextures.preload(HUD_SPRITES);
    this.hud = new Hud(this.font, this.guiTextures);

    this.onStatus?.('Preparing world generator', 0.45);
    const worldgen = await loadWorldgenData('/mc');
    this.generator = new NoiseChunkGenerator(this.mc, worldgen, BigInt(this.options.seed ?? 0x2602c0de));

    // Workers fetch blocks.bin/worldgen.json themselves and do it while the rest of the loading
    // screen runs, so `init` is kicked off here and awaited only right before the first request.
    this.onStatus?.('Starting chunk workers', 0.5);
    this.chunkProvider = new ChunkProvider(this.mc, BigInt(this.options.seed ?? 0x2602c0de), this.options.workers);
    void this.chunkProvider.init('/mc');

    const biomes = Object.values((worldgen as unknown as { biomes: Record<string, { id: number; name: string; temperature: number; downfall: number; effects?: Record<string, number> }> }).biomes);
    this.biomeColors = new BiomeColors(biomes.map((b) => ({ ...b, name: b.name ?? '' })));
    await this.biomeColors.load('/mc');

    this.onStatus?.('Creating world', 0.55);
    this.level = new ClientLevel(this.mc, this.generator, BigInt(this.options.seed ?? 0x2602c0de));

    this.onStatus?.('Building renderer', 0.65);
    this.renderer = new LevelRenderer(this.gl, this.mc, this.models, this.textures, this.biomeColors);
    this.renderer.renderDistance = this.options.renderDistance;
    await this.renderer.init();

    this.onStatus?.('Finding spawn point', 0.68);
    // Pick the spawn column BEFORE generating terrain: the generator can answer "what is the surface
    // height here" without building a chunk, so searching hundreds of blocks costs ~100 ms and the
    // loading screen only ever generates chunks around the real spawn.
    this.spawnSpot = this.findSpawnSpot();

    this.onStatus?.('Generating terrain', 0.7);
    await this.generateSpawnArea();

    this.onStatus?.('Rendering item icons', 0.9);
    this.icons = new ItemIconAtlas(this.gl, this.mc, this.models, this.textures);
    await this.icons.loadModels('/mc');
    this.icons.build();

    // Survival facade: owns health/hunger/XP, the recipe+loot tables and the player inventory.
    this.onStatus?.('Loading survival data', 0.9);
    const worldData = await loadWorldData('/mc');
    this.survival = new SurvivalState(this.mc, BigInt(this.options.seed ?? 0x2602c0de), worldData);
    this.survival.gamemode = this.options.gamemode;
    this.survival.onDrop = (stack) => this.dropItem(stack);

    this.initHotbar();
    this.spawnPlayer();

    // Entities: the manager owns the 20 Hz entity tick + natural spawning, the dispatcher draws
    // them into one batched pass. Both must exist before the first frame.
    this.onStatus?.('Starting entity system', 0.94);
    this.entityManager = new EntityManager(this.level, this.player, BigInt(this.options.seed ?? 0x2602c0de), {
      despawnDistance: 128,
    });
    void this.entityManager.loadSpawnConfig('/mc');

    this.onStatus?.('Loading entity textures', 0.96);
    this.entityRenderer = new EntityRenderDispatcher(this.gl);
    await this.entityRenderer.init('/mc/textures/entity');

    // Environment passes (sky / clouds / weather) + particles + audio.
    this.onStatus?.('Building environment', 0.97);
    this.levelLike = this.level as unknown as LevelLike;
    this.skyRenderer = new SkyRenderer(this.gl);
    // 192.33 = vanilla 26.2 cloud height (dimension_type visual/cloud_height); the module default
    // (128) is the 1.17 value. Passed as an option so the module itself stays untouched.
    this.cloudRenderer = new CloudRenderer(this.gl, { quality: 'fancy', height: 192.33 });
    this.weatherRenderer = new WeatherRenderer(this.gl);
    this.particles = new ParticleEngine(this.gl, 4000);
    ParticleEngine.setInstance(this.particles);
    this.particles.blockLayerForState = (state) => this.blockLayerFor(state);
    await Promise.all([
      this.skyRenderer.init(),
      this.cloudRenderer.init(),
      this.weatherRenderer.init(),
      this.particles.init({ blockArray: this.textures.block.texture }),
    ]);

    this.sounds = new SoundEngine();
    this.sounds.autoUnlock(); // browser autoplay policy: resume on the first gesture
    void this.sounds.load('/mc/sounds/index.json')
      // autoUnlock() binds once, but the one-shot listeners can fire *before* load() has created
      // the AudioContext (in which case resume() is a no-op). Try again once it exists.
      .then(() => (this.sounds.isUnlocked ? undefined : this.sounds.resume()))
      .catch((err) => console.warn('[sound] unavailable', err));

    // Persistence: restore the last world (chunks / player / time) before the GUI is built so the
    // world list on the title screen already has a provider.
    this.onStatus?.('Opening world save', 0.985);
    await this.initSave();

    // GUI: Canvas2D overlay on the shared guiCanvas, drawn after the HUD every frame.    this.onStatus?.('Preparing menus', 0.98);
    this.screens = new ScreenManager(this.guiCanvas, this.gl, {
      mc: this.mc,
      models: this.models,
      font: this.font,
      textures: this.guiTextures,
      icons: this.icons,
      // GameOptions has every field GuiOptions requires; the index signature is the only gap.
      options: this.options as unknown as GuiOptions,
      container: this.containerAdapter(),
      worlds: this.saveManager,
      callbacks: {
        onPlay: () => this.closeScreen(),
        onOptionChange: (key, value) => { (this.options as unknown as Record<string, unknown>)[key] = value; },
        onRespawn: () => this.spawnPlayer(),
        onChatMessage: (text) => { console.log('[chat]', text); },
        onQuit: () => { this.screens.open('title'); },
      },
    });

    this.resize();
    window.addEventListener('resize', () => this.resize());
    this.bindInput();
    this.onStatus?.('Ready', 1);
  }

  private async generateSpawnArea(): Promise<void> {
    const provider = this.chunkProvider;
    await provider.init('/mc');

    const centreX = (this.spawnSpot?.x ?? 8) >> 4;
    const centreZ = (this.spawnSpot?.z ?? 8) >> 4;

    // 5x5 chunks around spawn, nearest first. Everything else streams in from the tick loop.
    const radius = 2;
    const total = (radius * 2 + 1) ** 2;
    for (let dz = -radius; dz <= radius; dz++) {
      for (let dx = -radius; dx <= radius; dx++) {
        if (!this.level.hasChunk(centreX + dx, centreZ + dz)) provider.request(centreX + dx, centreZ + dz, dx * dx + dz * dz);
      }
    }

    // While the loading screen is up there is no frame budget to protect, so drain with a big
    // budget (still capped at 2 chunks per call). Poll every 16 ms until the area is complete.
    const started = performance.now();
    const timeout = 60_000;
    let done = 0;
    while (performance.now() - started < timeout) {
      provider.drain(this.level, 60);
      done = 0;
      for (let dz = -radius; dz <= radius; dz++) {
        for (let dx = -radius; dx <= radius; dx++) {
          if (this.level.hasChunk(centreX + dx, centreZ + dz)) done++;
        }
      }
      this.onStatus?.(`Generating terrain ${done}/${total}`, 0.7 + 0.18 * (done / total));
      if (done >= total) break;
      await new Promise((res) => setTimeout(res, 16));
    }
    const mode = provider.usingWorkers ? `${provider.workerCount} workers` : `sync (${provider.fallbackReason || 'no workers'})`;
    console.log(`[chunk] spawn area ${done}/${total} around ${centreX},${centreZ} in ${Math.round(performance.now() - started)} ms, ${mode}`);
  }

  /**
   * Nearest land column above sea level, searched outwards from the origin.
   *
   * Only uses `generator.getSurfaceHeight` (pure noise, no chunk generation), so a 512 block
   * radius costs ~100 ms. The returned column is validated against real block states later in
   * `spawnPlayer()` — the noise surface alone is not enough because features can place
   * non-collidable blocks (grass, seagrass) on top of water.
   */
  private findSpawnSpot(): { x: number; z: number; y: number } {
    const sea = this.level.seaLevel;
    let highest: { x: number; z: number; y: number } = { x: 8, z: 8, y: sea + 1 };
    const maxRadius = 512;
    const step = 4;
    for (let r = 0; r <= maxRadius; r += step) {
      for (let dz = -r; dz <= r; dz += step) {
        for (let dx = -r; dx <= r; dx += step) {
          if (Math.max(Math.abs(dx), Math.abs(dz)) !== r) continue;
          const x = 8 + dx;
          const z = 8 + dz;
          const h = this.generator.getSurfaceHeight(x, z);
          if (h > highest.y) highest = { x, z, y: h };
          // Land: the terrain surface is at or above sea level (ocean columns stop below it).
          if (h >= sea + 1) return { x, z, y: h };
        }
      }
    }
    // Everywhere is ocean: retreat to the highest ground we sampled.
    return highest;
  }

  /**
   * Scans a column top-down for a block the player can stand on: not air, not liquid, with a
   * collision shape, at or above sea level, and two free blocks above it (vanilla spawn rule,
   * extended with the collision/liquid checks the old getHeight-only version was missing).
   */
  private findStandingY(x: number, z: number): number | null {
    const top = Math.min(this.level.minY + this.level.height - 2, this.level.getHeight(x, z) + 4);
    for (let y = top; y >= this.level.minY; y--) {
      const state = this.level.getBlockState(x, y, z);
      if (state === 0 || this.mc.isLiquid(state)) continue;
      if (this.mc.collision(state).length === 0) continue;
      if (y < this.level.seaLevel) return null; // underwater floor: not a valid spawn
      const above1 = this.level.getBlockState(x, y + 1, z);
      const above2 = this.level.getBlockState(x, y + 2, z);
      if (this.mc.isLiquid(above1) || this.mc.isLiquid(above2)) return null;
      if (this.mc.collision(above1).length > 0 || this.mc.collision(above2).length > 0) continue;
      return y;
    }
    return null;
  }

  private spawnPlayer(): void {
    const spot = this.spawnSpot ?? { x: 8, z: 8, y: this.level.seaLevel + 1 };
    // The spawn chunk is loaded by now, so the column can be validated with real block states.
    let x = spot.x;
    let z = spot.z;
    let standing = this.findStandingY(x, z);
    if (standing === null) {
      // Spiral again over the already generated area and take the first column that qualifies.
      outer:
      for (let r = 0; r <= 48; r += 4) {
        for (let dz = -r; dz <= r; dz += 4) {
          for (let dx = -r; dx <= r; dx += 4) {
            if (Math.max(Math.abs(dx), Math.abs(dz)) !== r) continue;
            const cx = (spot.x + dx) >> 4;
            const cz = (spot.z + dz) >> 4;
            if (!this.level.hasChunk(cx, cz)) continue;
            const y = this.findStandingY(spot.x + dx, spot.z + dz);
            if (y !== null) { x = spot.x + dx; z = spot.z + dz; standing = y; break outer; }
          }
        }
      }
    }
    // Last resort: stand on the highest terrain sampled by the spawn search, above the sea.
    const fallbackY = Math.max(spot.y + 1, this.level.seaLevel + 1);
    this.player = new Player(x + 0.5, (standing ?? fallbackY) + 1 + 0.01, z + 0.5);
    this.player.yaw = 0;
    this.player.pitch = 0;
    console.log(`[spawn] ${x + 0.5}, ${(standing ?? fallbackY) + 1}, ${z + 0.5} (sea ${this.level.seaLevel}, standing ${standing ?? 'fallback'})`);
  }

  private initHotbar(): void {
    const defaults = ['grass_block', 'stone', 'oak_planks', 'oak_log', 'glass', 'torch', 'crafting_table', 'oak_stairs', 'water'];
    defaults.forEach((name, i) => {
      const stack = ItemStack.fromName(this.survival.registry, name, 64);
      if (!stack.isEmpty()) this.survival.inventory.setItem(i, stack);
    });
    this.survival.inventory.setSelectedSlot(0);
  }

  /**
   * Adapts vanilla AbstractContainerMenu to the GUI's ContainerMenuLike contract so the inventory
   * screen reads/writes the same PlayerInventory the HUD and the mining code use.
   */
  private containerAdapter(): ContainerMenuLike {
    const menu = (): AbstractContainerMenu => this.survival.activeMenu ?? this.survival.openInventory();
    return {
      getSlotCount: () => menu().slots.length,
      getItem: (index) => {
        const slot = menu().slots[index];
        const stack = slot ? slot.getItem() : ItemStack.EMPTY;
        return { itemId: stack && stack.item ? stack.item.id : -1, count: stack ? stack.getCount() : 0 };
      },
      click: (index, button, _shift, action) => {
        menu().clicked(index, button, ACTION_TO_INPUT[action] ?? ContainerInput.PICKUP, this.survival.asMenuPlayer());
      },
      getCarried: () => {
        const stack = menu().getCarried();
        return stack && stack.item ? { itemId: stack.item.id, count: stack.getCount() } : null;
      },
      setCarried: (stack) => {
        const item = stack && stack.itemId >= 0 ? this.survival.registry.get(stack.itemId) : undefined;
        menu().setCarried(item && stack ? new ItemStack(item, stack.count) : ItemStack.EMPTY);
      },
    };
  }

  // ------------------------------------------------------------------- save

  /**
   * Opens the IndexedDB world store, restores the most recent world and starts the 6000-tick
   * autosave (Autosave owns the timer; `attach()` wires visibilitychange/pagehide, and the
   * explicit beforeunload listener below covers a plain reload).
   */
  private async initSave(): Promise<void> {
    this.chunkCodec = {
      blockCodec: new MinecraftDataBlockStateCodec(this.mc),
      biomeCodec: new ReversibleBiomeCodec(),
      minY: this.level.minY,
      height: this.level.height,
    };

    try {
      this.saveManager = await WorldSaveManager.open(undefined, {
        mc: this.mc,
        minY: this.level.minY,
        height: this.level.height,
      });

      const worlds = await this.saveManager.list();
      if (worlds.length > 0) {
        const loaded = await this.saveManager.loadWorld(worlds[0].id);
        this.restoreWorld(loaded);
        console.log(`[save] restored "${worlds[0].name}": ${loaded.chunks.size} chunks, player ${loaded.player ? 'yes' : 'no'}`);
      } else {
        await this.saveManager.createWorld({
          name: 'World',
          seed: BigInt(this.options.seed ?? 0x2602c0de),
          gamemode: this.options.gamemode,
          difficulty: 'normal',
        });
        console.log('[save] created new world');
      }

      this.autosave = new Autosave(this.saveManager, {
        getLevel: () => this.level,
        getPlayer: () => this.player,
        getExtra: () => this.playerExtra(),
        onSave: (e) => { if (e.done) console.log(`[save] ${e.reason}: ${e.chunks} chunks`); },
        onError: (err) => console.warn('[save] failed', err),
      });
      this.autosave.attach();
      this.autosave.start();

      window.addEventListener('beforeunload', () => { void this.autosave?.quit(); });
    } catch (err) {
      // Private mode / no IndexedDB: play without persistence instead of failing the boot.
      console.warn('[save] persistence disabled:', err);
    }
  }

  /** Replaces generated chunks with the saved ones and restores player/level state. */
  private restoreWorld(loaded: LoadedWorld): void {
    for (const bytes of loaded.chunks.values()) {
      try {
        this.level.addChunk(ChunkSerializer.fromBytes(bytes, this.mc, this.chunkCodec));
      } catch (err) {
        console.warn('[save] unreadable chunk:', err);
      }
    }

    if (loaded.player) {
      PlayerData.applyToPlayer(loaded.player, this.player);
      const view = PlayerData.fromNbt(loaded.player);
      if (view.inventory.length > 0) {
        for (let i = 0; i < 36; i++) this.survival.inventory.setItem(i, ItemStack.EMPTY);
        for (const saved of view.inventory) {
          const item = this.survival.registry.byName(String(saved.id))
            ?? (saved.numericId !== undefined ? this.survival.registry.get(saved.numericId) : undefined);
          if (!item || saved.count <= 0) continue;
          this.survival.inventory.setItem(saved.slot & 0xff, new ItemStack(item, saved.count));
        }
      }
      this.survival.inventory.setSelectedSlot(view.selectedItemSlot);
    }

    const data = loaded.level.getCompoundOrEmpty('Data');
    const dayTime = Number(data.getLongOr('DayTime', BigInt(Math.trunc(this.level.time))));
    const gameTime = Number(data.getLongOr('Time', BigInt(Math.trunc(this.level.gameTime))));
    if (dayTime > 0) this.level.time = dayTime;
    if (gameTime > 0) this.level.gameTime = gameTime;

    // The restored position is usually outside the 5x5 spawn area: build its column synchronously
    // so the player does not fall through unloaded chunks on the first tick.
    const px = Math.floor(this.player.pos.x) >> 4;
    const pz = Math.floor(this.player.pos.z) >> 4;
    for (let dz = -1; dz <= 1; dz++) {
      for (let dx = -1; dx <= 1; dx++) this.level.ensureChunk(px + dx, pz + dz);
    }
    if (!this.level.hasChunk(px, pz)) this.spawnPlayer();
  }

  /** Extra player state persisted next to the vanilla NBT fields. */
  private playerExtra(): Record<string, unknown> {
    const s = this.survival;
    const inventory: ItemStackData[] = [];
    for (let i = 0; i < 36; i++) {
      const stack = s.inventory.getItem(i);
      const item = stack.getItem();
      if (!item || stack.isEmpty()) continue;
      inventory.push({ slot: i, id: item.namespacedId, count: stack.getCount(), numericId: item.id });
    }
    return {
      health: s.health,
      foodLevel: s.hunger,
      foodSaturationLevel: s.saturation,
      selectedItemSlot: this.selectedSlot,
      xpLevel: s.level,
      xpP: s.experience,
      xpTotal: s.totalExperience,
      inventory,
    };
  }

  // ------------------------------------------------------------------ input

  private bindInput(): void {
    const canvas = this.guiCanvas;

    canvas.addEventListener('click', () => {
      if (this.screens.current) return;  // a menu is up: the click belongs to the GUI
      if (!this.mouseLocked) canvas.requestPointerLock();
    });
    document.addEventListener('pointerlockchange', () => {
      this.mouseLocked = document.pointerLockElement === canvas;
      if (!this.mouseLocked) this.mining = false;
    });
    document.addEventListener('mousemove', (e) => {
      if (this.screens.current) {
        this.screens.onMouse(e.clientX, e.clientY, -1, 'move', 0);
        return;
      }
      if (!this.mouseLocked) return;
      this.player.yaw += e.movementX * 0.15;
      this.player.pitch = Math.max(-90, Math.min(90, this.player.pitch + e.movementY * 0.15));
    });
    document.addEventListener('wheel', (e) => {
      if (e.ctrlKey) e.preventDefault();
      if (this.screens.current) { this.screens.onMouse(e.clientX, e.clientY, -1, 'wheel', e.deltaY); return; }
      if (!this.mouseLocked) return;
      const dir = Math.sign(e.deltaY);
      this.selectedSlot = (this.selectedSlot + dir + 9) % 9;
      this.showItemName();
    }, { passive: false });

    window.addEventListener('keydown', (e) => {
      const mods = (e.shiftKey ? 1 : 0) | (e.ctrlKey ? 2 : 0) | (e.altKey ? 4 : 0);
      this.unlockAudio();
      if (this.screens.onKey(e.code, e.key, mods)) { e.preventDefault(); return; }
      if (this.screens.current) {
        // Menu is open and did not consume the key: it must not move the player.
        e.preventDefault();
        this.keys.clear();
        return;
      }
      if (e.code === 'F3') { this.showDebug = !this.showDebug; e.preventDefault(); return; }
      if (e.code === 'Escape') { this.openScreen('pause'); e.preventDefault(); return; }
      this.keys.add(e.code);
      if (e.code.startsWith('Digit')) {
        const n = Number(e.code.slice(5));
        if (n >= 1 && n <= 9) { this.selectedSlot = n - 1; this.showItemName(); }
      }
      if (e.code === 'KeyF' && this.options.gamemode === 'creative') {
        this.player.flying = !this.player.flying;
      }
      if (e.code === 'Space') {
        const now = performance.now();
        if (now - this.lastJumpPress < 280 && this.options.gamemode === 'creative') {
          this.player.flying = !this.player.flying;
        }
        this.lastJumpPress = now;
      }
      if (e.code === 'KeyE') {
        this.openScreen(this.options.gamemode === 'creative' ? 'creative' : 'inventory');
        e.preventDefault();
      }
      if (e.code === 'KeyT') { this.openScreen('chat'); e.preventDefault(); }
    });
    window.addEventListener('keyup', (e) => this.keys.delete(e.code));

    canvas.addEventListener('mousedown', (e) => {
      this.unlockAudio();
      if (this.screens.current) {
        this.screens.onMouse(e.clientX, e.clientY, e.button, 'down');
        return;
      }
      if (!this.mouseLocked) { canvas.requestPointerLock(); return; }
      if (e.button === 0) { this.mining = true; this.attack(); }
      if (e.button === 2) this.useItem();
      if (e.button === 1) this.pickBlock();
    });
    canvas.addEventListener('mouseup', (e) => {
      if (e.button === 0) this.mining = false;
      if (this.screens.current) {
        this.screens.onMouse(e.clientX, e.clientY, e.button, 'up');
        // A button may have closed the menu: take the pointer back while we still have activation.
        if (!this.screens.current && !this.mouseLocked) canvas.requestPointerLock();
      }
    });
    canvas.addEventListener('contextmenu', (e) => e.preventDefault());
  }

  /** AudioContext resume must happen inside a user gesture; call from every input handler. */
  private unlockAudio(): void {
    if (this.sounds && !this.sounds.isUnlocked) void this.sounds.resume();
  }

  /** Opens a GUI screen and releases the mouse so the buttons can be clicked. */  private openScreen(screen: ScreenRef): void {
    this.screens.open(screen);
    this.keys.clear();
    if (document.pointerLockElement) document.exitPointerLock();
    // vanilla pauses autosave on the pause menu and flushes immediately
    if (screen === 'pause') void this.autosave?.pause();
  }

  /** Closes the current screen and hands control (and the mouse) back to the player. */
  private closeScreen(): void {
    this.screens.close();
    this.keys.clear();
    this.autosave?.resume();
    if (!this.mouseLocked) void this.guiCanvas.requestPointerLock();
  }

  showDebug = false;
  onInventoryToggle?: () => void;
  onChatToggle?: () => void;

  private showItemName(): void {
    const item = this.hotbar[this.selectedSlot];
    if (item >= 0) {
      this.itemName = this.mc.items[item].name.replace(/_/g, ' ');
      this.itemNameTimer = 40;
    }
  }

  // ------------------------------------------------------------- interaction

  private cameraEye(): Vec3 {
    return new Vec3(this.player.pos.x, this.player.eyeY, this.player.pos.z);
  }

  private lookVector(): Vec3 {
    const yaw = (this.player.yaw * Math.PI) / 180;
    const pitch = (this.player.pitch * Math.PI) / 180;
    const cp = Math.cos(pitch);
    return new Vec3(Math.sin(yaw) * cp, -Math.sin(pitch), Math.cos(yaw) * cp).normalize();
  }

  /** Vanilla Level.clip against block outline shapes. */
  raycast(maxDistance = 5): { x: number; y: number; z: number; face: number; point: Vec3 } | null {
    const eye = this.cameraEye();
    const dir = this.lookVector();
    const end = eye.add(dir.x * maxDistance, dir.y * maxDistance, dir.z * maxDistance);

    let bx = Math.floor(eye.x), by = Math.floor(eye.y), bz = Math.floor(eye.z);
    const stepX = Math.sign(dir.x), stepY = Math.sign(dir.y), stepZ = Math.sign(dir.z);
    const tDeltaX = stepX !== 0 ? Math.abs(1 / dir.x) : Infinity;
    const tDeltaY = stepY !== 0 ? Math.abs(1 / dir.y) : Infinity;
    const tDeltaZ = stepZ !== 0 ? Math.abs(1 / dir.z) : Infinity;
    let tMaxX = stepX > 0 ? (Math.floor(eye.x) + 1 - eye.x) * tDeltaX : stepX < 0 ? (eye.x - Math.floor(eye.x)) * tDeltaX : Infinity;
    let tMaxY = stepY > 0 ? (Math.floor(eye.y) + 1 - eye.y) * tDeltaY : stepY < 0 ? (eye.y - Math.floor(eye.y)) * tDeltaY : Infinity;
    let tMaxZ = stepZ > 0 ? (Math.floor(eye.z) + 1 - eye.z) * tDeltaZ : stepZ < 0 ? (eye.z - Math.floor(eye.z)) * tDeltaZ : Infinity;

    let face = 1;
    for (let i = 0; i < 128; i++) {
      const state = this.level.getBlockState(bx, by, bz);
      if (state !== 0) {
        const shapes = this.mc.outline(state);
        for (const box of shapes) {
          const moved = box.move(bx, by, bz);
          const hit = moved.clip(eye, end);
          if (hit) {
            // determine the face from the hit point
            const eps = 1e-4;
            let f = 1;
            if (Math.abs(hit.y - moved.minY) < eps) f = 0;
            else if (Math.abs(hit.y - moved.maxY) < eps) f = 1;
            else if (Math.abs(hit.z - moved.minZ) < eps) f = 2;
            else if (Math.abs(hit.z - moved.maxZ) < eps) f = 3;
            else if (Math.abs(hit.x - moved.minX) < eps) f = 4;
            else if (Math.abs(hit.x - moved.maxX) < eps) f = 5;
            return { x: bx, y: by, z: bz, face: f, point: hit };
          }
        }
      }
      if (tMaxX < tMaxY && tMaxX < tMaxZ) {
        if (tMaxX > maxDistance) break;
        bx += stepX; tMaxX += tDeltaX; face = stepX > 0 ? 4 : 5;
      } else if (tMaxY < tMaxZ) {
        if (tMaxY > maxDistance) break;
        by += stepY; tMaxY += tDeltaY; face = stepY > 0 ? 0 : 1;
      } else {
        if (tMaxZ > maxDistance) break;
        bz += stepZ; tMaxZ += tDeltaZ; face = stepZ > 0 ? 2 : 3;
      }
    }
    return null;
  }

  private attack(): void {
    if (this.attackCooldown > 0) return;
    this.attackCooldown = 4;
    this.player.swingHand();
    // Creative breaks instantly and drops nothing; survival only *starts* mining — the progress
    // and the drop are handled by BlockBreaking in tick().
    if (this.options.gamemode !== 'creative') return;
    const hit = this.raycast();
    if (!hit) return;
    const broken = this.level.getBlockState(hit.x, hit.y, hit.z);
    this.level.setBlockState(hit.x, hit.y, hit.z, 0);
    this.updateNeighbors(hit.x, hit.y, hit.z);
    if (broken !== 0) this.breakEffects(broken, hit.x, hit.y, hit.z);
  }

  /** Advances the survival mining progress for the aimed block (vanilla Player.tick loop). */
  private updateMining(): void {
    if (this.options.gamemode === 'creative' || !this.mouseLocked || !this.mining) {
      this.survival.breaking.reset();
      return;
    }
    const hit = this.raycast();
    if (!hit) { this.survival.breaking.reset(); return; }
    const state = this.level.getBlockState(hit.x, hit.y, hit.z);
    if (state === 0) { this.survival.breaking.reset(); return; }

    const underwater = this.player.inWater;
    if (!this.survival.mine(1, state, underwater)) return;

    const drops = this.survival.breakBlock((x, y, z) => this.level.getBlockState(x, y, z), hit.x, hit.y, hit.z);
    this.level.setBlockState(hit.x, hit.y, hit.z, 0);
    this.updateNeighbors(hit.x, hit.y, hit.z);
    this.breakEffects(state, hit.x, hit.y, hit.z);
    for (const stack of drops) this.dropItem(stack, hit.x, hit.y, hit.z);
    this.attackCooldown = 4;
    this.player.swingHand();
  }

  /** Spawns a dropped ItemStack as an ItemEntity. Coordinates default to the player's feet. */
  private dropItem(stack: ItemStack, x?: number, y?: number, z?: number): void {
    if (!stack || stack.isEmpty()) return;
    const px = x === undefined ? this.player.pos.x : x + 0.5;
    const py = y === undefined ? this.player.pos.y + 1.2 : y + 0.25;
    const pz = z === undefined ? this.player.pos.z : z + 0.5;
    const entity = new ItemEntity(this.level, px, py, pz, this.toEntityStack(stack));
    entity.setPickupDelay(10);
    this.entityManager.spawnEntity(entity);
  }

  /**
   * ItemEntity / LivingEntity use their own stub stack (`{ id: string; count: number }`) instead of
   * world/item/ItemStack, and ItemEntityRenderer reads `.id` off it. Convert at the boundary.
   */
  private toEntityStack(stack: ItemStack): { id: string; count: number } {
    const item = stack.getItem();
    return { id: item ? item.namespacedId : 'minecraft:air', count: stack.getCount() };
  }

  private fromEntityStack(stack: { id: string; count: number }): ItemStack {
    const item = this.survival.registry.byName(stack.id);
    return item ? new ItemStack(item, stack.count) : ItemStack.EMPTY;
  }

  // ------------------------------------------------------- environment / fx

  /** Texture-array layer for a block state, used by the BLOCK particle sprite. */
  private blockLayerFor(state: number): number {
    const name = this.mc.blockOf(state).name;
    for (const candidate of [`block/${name}`, `block/${name}_top`, `block/${name}_side`, `block/${name}_still`]) {
      const layer = this.textures.blockTextureLayer(candidate);
      if (layer >= 0) return layer;
    }
    return state % 1230;
  }

  /** Vanilla SoundType grouping: block.grass/stone/wood/... step + break events. */
  private blockMaterial(name: string): string {
    if (/glass/.test(name)) return 'glass';
    if (/wool|carpet/.test(name)) return 'wool';
    if (/gravel/.test(name)) return 'gravel';
    if (/snow|powder_snow/.test(name)) return 'snow';
    if (/sand/.test(name)) return 'sand';
    if (/grass|leaves|vine|fern|bush|moss|flower|sapling|short_grass|tall_grass/.test(name)) return 'grass';
    if (/log|wood|plank|fence|door|stairs|slab|table|chest|barrel/.test(name)) return 'wood';
    return 'stone';
  }

  private playStepSound(): void {
    const p = this.player;
    if (!p.onGround || p.flying) { this.stepDistance = p.walkDist; return; }
    if (p.walkDist - this.stepDistance < 1) return;
    this.stepDistance = p.walkDist;
    const below = this.level.getBlockState(Math.floor(p.pos.x), Math.floor(p.pos.y - 0.2), Math.floor(p.pos.z));
    const material = this.blockMaterial(this.mc.blockOf(below).name);
    this.sounds.play(`block.${material}.step`, p.pos.x, p.pos.y, p.pos.z, 0.15, 1);
  }

  private breakEffects(state: number, x: number, y: number, z: number): void {
    spawnBlockBreakParticles(state, x, y, z, 20);
    const material = this.blockMaterial(this.mc.blockOf(state).name);
    this.sounds.play(`block.${material}.break`, x + 0.5, y + 0.5, z + 0.5, 1, 1);
  }

  /**
   * ClientLevel has no weather simulation (rainLevel is a private field that is never advanced),
   * so the rain pass can only be driven from outside. Exposed for the console / future commands.
   */
  setRain(amount: number): void {
    (this.level as unknown as { rainLevel: number }).rainLevel = Math.max(0, Math.min(1, amount));
  }

  private useItem(): void {
    if (this.useCooldown > 0) return;
    this.useCooldown = 4;
    this.player.swingHand();
    const hit = this.raycast();
    if (!hit) return;
    const held = this.survival.getSelectedStack();
    if (!held || held.isEmpty() || !held.item || !held.item.block) return;
    const item = held.item;
    const targetX = hit.x + [0, 0, 0, 0, -1, 1][hit.face];
    const targetY = hit.y + [0, 1, 0, 0, 0, 0][hit.face];
    const targetZ = hit.z + [-1, 0, 1, -1, 0, 0][hit.face];
    const existing = this.level.getBlockState(targetX, targetY, targetZ);
    if (existing !== 0 && !this.mc.isLiquid(existing)) return;

    const state = this.stateForPlacement(item.block, hit.face, targetX, targetY, targetZ);
    this.level.setBlockState(targetX, targetY, targetZ, state);
    this.updateNeighbors(targetX, targetY, targetZ);
    if (this.options.gamemode !== 'creative') this.survival.inventory.removeFromSelected(false);
  }

  /** Simplified Block.getStateForPlacement for the shapes that matter in play. */
  private stateForPlacement(blockName: string, face: number, x: number, y: number, z: number): number {
    let state = this.mc.stateOf(blockName);
    const props = this.mc.blocks[this.mc.blockByName.get(blockName)!].props.map((p) => p.name);

    if (props.includes('axis')) {
      const axis = face === 0 || face === 1 ? 'y' : face === 2 || face === 3 ? 'z' : 'x';
      state = this.mc.withProp(state, 'axis', axis);
    }
    if (props.includes('facing')) {
      const horizontal = [2, 3, 4, 5].includes(face) ? face : (Math.round(this.player.yaw / 90) % 4 + 4) % 4;
      const name = ['down', 'up', 'north', 'south', 'west', 'east'][horizontal === 0 ? 2 : horizontal === 1 ? 5 : horizontal === 2 ? 3 : 4];
      state = this.mc.withProp(state, 'facing', name);
    }
    if (props.includes('half')) {
      const half = face === 0 ? 'top' : face === 1 ? 'bottom'
        : (this.player.pitch > 0 ? 'top' : 'bottom');
      state = this.mc.withProp(state, 'half', half);
    }
    if (props.includes('type') && blockName.endsWith('slab')) {
      const below = this.level.getBlockState(x, y, z);
      state = this.mc.withProp(state, 'type', face === 1 ? 'bottom' : 'bottom');
    }
    if (props.includes('face')) {
      const faceName = face === 1 ? 'floor' : face === 0 ? 'ceiling' : 'wall';
      state = this.mc.withProp(state, 'face', faceName);
    }
    if (props.includes('waterlogged')) {
      const above = this.level.getBlockState(x, y + 1, z);
      state = this.mc.withProp(state, 'waterlogged', this.mc.blockOf(above).name === 'water' ? 'true' : 'false');
    }
    return state;
  }

  /** Recomputes fence/wall/pane connections and stair shapes next to a change. */
  private updateNeighbors(x: number, y: number, z: number): void {
    for (let dy = -1; dy <= 1; dy++) {
      for (let dz = -1; dz <= 1; dz++) {
        for (let dx = -1; dx <= 1; dx++) {
          this.updateBlockShape(x + dx, y + dy, z + dz);
        }
      }
    }
  }

  private updateBlockShape(x: number, y: number, z: number): void {
    let state = this.level.getBlockState(x, y, z);
    if (state === 0) return;
    const block = this.mc.blockOf(state);
    const name = block.name;
    const isConnector = /fence$|_wall$|_pane$|iron_bars$|cobblestone_wall$/.test(name);
    if (!isConnector) return;

    const dirs: [string, number, number, number][] = [
      ['north', 0, 0, -1], ['south', 0, 0, 1], ['west', -1, 0, 0], ['east', 1, 0, 0],
    ];
    for (const [prop, dx, dy, dz] of dirs) {
      if (!block.props.some((p) => p.name === prop)) continue;
      const neighbor = this.level.getBlockState(x + dx, y + dy, z + dz);
      const neighborBlock = this.mc.blockOf(neighbor);
      const connects = neighbor !== 0 && (
        this.mc.isSolid(neighbor) && this.mc.collision(neighbor).length > 0
        || neighborBlock.name.endsWith('fence')
        || neighborBlock.name.endsWith('_wall')
        || neighborBlock.name.endsWith('_pane')
      );
      const next = this.mc.withProp(state, prop, connects ? 'true' : 'false');
      if (next !== state) {
        this.level.setBlockState(x, y, z, next);
        state = next;
      }
    }
  }

  private pickBlock(): void {
    const hit = this.raycast();
    if (!hit) return;
    const state = this.level.getBlockState(hit.x, hit.y, hit.z);
    if (state === 0) return;
    const name = this.mc.blockOf(state).item;
    if (!name) return;
    const stack = ItemStack.fromName(this.survival.registry, name, 1);
    if (stack.isEmpty()) return;
    this.survival.inventory.setItem(this.survival.inventory.getSelectedSlot(), stack);
    this.showItemName();
  }

  // ------------------------------------------------------------------- loop

  start(): void {
    if (this.running) return;
    this.running = true;
    this.lastFrame = performance.now();
    requestAnimationFrame(this.frame);
  }

  stop(): void { this.running = false; }

  private frame = (now: number): void => {
    if (!this.running) return;
    const dt = Math.min(100, now - this.lastFrame);
    this.lastFrame = now;

    this.frames++;
    this.fpsTimer += dt;
    if (this.fpsTimer >= 500) {
      this.fps = Math.round((this.frames * 1000) / this.fpsTimer);
      this.frames = 0;
      this.fpsTimer = 0;
    }

    this.accum += dt;
    let ticks = 0;
    while (this.accum >= TICK_MS && ticks < 5) {
      this.tick();
      this.accum -= TICK_MS;
      ticks++;
    }

    this.render(this.accum / TICK_MS);
    requestAnimationFrame(this.frame);
  };

  private tick(): void {
    this.tickCount++;
    this.level.tick(1 / 20);

    // Autosave resumes as soon as the last menu closes (E / Esc / a GUI button all go through
    // ScreenManager, so watching the transition is more reliable than hooking every path).
    const screenOpen = this.screens.current !== null;
    if (screenOpen !== this.screenWasOpen) {
      this.screenWasOpen = screenOpen;
      if (!screenOpen) this.autosave?.resume();
    }

    const input: PlayerInput = {
      forward: (this.keys.has('KeyW') ? 1 : 0) - (this.keys.has('KeyS') ? 1 : 0),
      strafe: (this.keys.has('KeyD') ? 1 : 0) - (this.keys.has('KeyA') ? 1 : 0),
      jump: this.keys.has('Space'),
      sneak: this.keys.has('ShiftLeft') || this.keys.has('ShiftRight'),
      sprint: this.keys.has('ControlLeft'),
      jumpPressed: false,
    };
    this.player.tick(this.level, input);

    if (this.attackCooldown > 0) this.attackCooldown--;
    if (this.useCooldown > 0) this.useCooldown--;
    if (this.itemNameTimer > 0) this.itemNameTimer--;

    // survival: health/hunger/XP + inventory cooldowns
    this.survival.gamemode = this.options.gamemode;
    const moved: PlayerMoved = {
      sprint: this.player.sprinting,
      jumped: input.jump && this.player.onGround,
      swam: this.player.inWater,
    };
    this.survival.tick(moved);

    // mining progress (BlockBreaking); replaces the hand-written breakProgress loop
    this.updateMining();
    this.playStepSound();

    this.particles.tick();
    const cam = {
      x: this.player.pos.x, y: this.player.eyeY, z: this.player.pos.z,
      yaw: this.player.yaw, pitch: this.player.pitch,
      fov: this.options.fov, aspect: this.glCanvas.width / this.glCanvas.height,
    };
    this.weatherRenderer.tick(cam, this.levelLike, 1);
    this.sounds.tick(cam, this.levelLike);

    // keep the ring of chunks around the player loaded; generation happens on the workers and
    // finished chunks are applied here under a time budget
    this.ensureChunksAround();
    this.chunkProvider.drain(this.level, 6);

    // entities last so they see the chunks that were just applied
    this.entityManager.tick();
    this.pickupNearbyItems();
    this.syncEntityChunks();

    this.autosave?.tick();
  }

  /**
   * Adds every pickable ItemEntity in reach to the inventory (vanilla Player.take).
   * EntityManager.pickupItems() only counts and removes the entity, so it cannot be used here:
   * the stack has to be merged into the PlayerInventory before the entity is discarded.
   */
  private pickupNearbyItems(): void {
    const p = this.player.pos;
    for (const e of this.entityManager.getEntities()) {
      if (!(e instanceof ItemEntity) || e.isRemoved() || !e.isPickable()) continue;
      if (e.distanceToSqr(p.x, p.y, p.z) > 2.25) continue; // 1.5 blocks
      const stack = this.fromEntityStack(e.getItem());
      if (stack.isEmpty()) { e.remove(); continue; }
      if (!this.survival.inventory.add(stack)) continue; // inventory full: leave it on the ground
      e.remove();
    }
  }

  /**
   * Full chunk-set sync is O(n); only re-send when the set actually changed.
   * NOTE: the chunk keys in `level.chunks` are packed by Geometry.chunkKey (offset 32768 per axis),
   * not by `cx << 32 | cz` as the integration doc suggests — decoding them that way puts every
   * chunk in the wrong cell and the manager culls every mob on its first tick. Use LevelChunk.x/z.
   */
  private syncEntityChunks(): void {
    let sum = 0;
    for (const k of this.level.chunks.keys()) sum = (sum + k) | 0;
    const key = `${this.level.chunks.size}|${sum}`;
    if (key === this.entityChunkKey) return;
    this.entityChunkKey = key;
    this.entityManager.syncChunks(
      [...this.level.chunks.values()].map((c) => [c.x, c.z] as const),
    );
  }

  private ensureChunksAround(): void {
    const pcx = Math.floor(this.player.pos.x) >> 4;
    const pcz = Math.floor(this.player.pos.z) >> 4;
    const r = this.options.renderDistance;
    // Ring order is kept (nearest ring first) and the squared distance becomes the queue
    // priority; request() is idempotent, so re-asking every tick is cheap and self-healing
    // when the player walks.
    for (let ring = 0; ring <= r; ring++) {
      for (let dz = -ring; dz <= ring; dz++) {
        for (let dx = -ring; dx <= ring; dx++) {
          if (Math.max(Math.abs(dx), Math.abs(dz)) !== ring) continue;
          const cx = pcx + dx;
          const cz = pcz + dz;
          if (this.level.hasChunk(cx, cz)) continue;
          this.chunkProvider.request(cx, cz, dx * dx + dz * dz);
        }
      }
    }
  }

  private resize(): void {
    const dpr = Math.min(window.devicePixelRatio || 1, 2);
    const w = window.innerWidth;
    const h = window.innerHeight;
    this.glCanvas.width = Math.floor(w * dpr);
    this.glCanvas.height = Math.floor(h * dpr);
    this.glCanvas.style.width = `${w}px`;
    this.glCanvas.style.height = `${h}px`;
    this.guiCanvas.width = Math.floor(w * dpr);
    this.guiCanvas.height = Math.floor(h * dpr);
    this.guiCanvas.style.width = `${w}px`;
    this.guiCanvas.style.height = `${h}px`;
    this.gl.viewport(0, 0, this.glCanvas.width, this.glCanvas.height);
    this.screens?.resize(w, h);
  }

  get guiScale(): number {
    if (this.options.guiScale > 0) return this.options.guiScale;
    const dpr = Math.min(window.devicePixelRatio || 1, 2);
    const w = window.innerWidth * dpr;
    const h = window.innerHeight * dpr;
    return Math.max(1, Math.floor(Math.min(w / 320, h / 240)));
  }

  private render(partial: number): void {
    const gl = this.gl;
    const skyState = computeSkyState(this.level.time + partial);
    this.sky = skyState;

    const lightmap = buildLightmap(skyState, this.lightmapData);
    const key = `${skyState.skyFactor.toFixed(3)}|${skyState.skyLightColor.join(',')}|${skyState.brightness}`;
    this.textures.updateLightmap(lightmap, key);
    this.textures.animate(this.level.time);

    const eyeY = this.player.eyeY;
    const camera: Camera = {
      x: this.player.pos.x,
      y: eyeY,
      z: this.player.pos.z,
      yaw: this.player.yaw,
      pitch: this.player.pitch,
      fov: this.options.fov * (this.player.sprinting ? 1.1 : 1),
      aspect: this.glCanvas.width / this.glCanvas.height,
    };

    gl.viewport(0, 0, this.glCanvas.width, this.glCanvas.height);
    gl.clearColor(skyState.fogColor[0], skyState.fogColor[1], skyState.fogColor[2], 1);
    gl.clear(gl.COLOR_BUFFER_BIT | gl.DEPTH_BUFFER_BIT);

    // chunks are rebuilt lazily; do it before drawing
    this.renderer.update(this.level, camera.x, camera.z, 6);

    // Sky / clouds replace LevelRenderer.renderSky(): the old pass is NOT called any more, so the
    // sky is drawn exactly once. They use the matrices of the previous frame (renderer.render()
    // below is what refreshes them); a 16 ms stale camera basis is invisible at infinite distance.
    // NOTE: SkyRenderer's timeOfDay is `dayTime / 24000` (0 = sunrise, .25 = noon). That is *not*
    // ClientLevel.getTimeOfDay(), which is phase-shifted by -0.75 (0 = midnight), so convert.
    const skyPhase = (((this.level.time % DAY_LENGTH) + DAY_LENGTH) % DAY_LENGTH) / DAY_LENGTH;
    this.skyRenderer.render(
      this.renderer.viewMatrix,
      this.renderer.projection,
      skyPhase,
      camera,
      this.level.getRainLevel(),
      this.levelLike,
    );
    this.cloudRenderer.render(this.renderer.viewProjection, camera, this.level.time, this.levelLike);

    this.renderer.render(this.level, camera, skyState, partial);

    // entities: viewProjection is refreshed by renderer.render() above
    this.entityRenderer.render(
      this.entityManager.getEntities(),
      this.renderer.viewProjection,
      { x: camera.x, y: camera.y, z: camera.z },
      partial,
    );

    // particles after the entities, weather over everything (vanilla order)
    this.particles.render(this.renderer.viewProjection, partial);
    this.weatherRenderer.render(this.renderer.viewProjection, camera, this.level.time, this.levelLike);

    const hit = this.raycast();
    if (hit && this.mouseLocked) {
      const state = this.level.getBlockState(hit.x, hit.y, hit.z);
      const boxes = this.mc.outline(state);
      if (boxes.length) {
        const b = boxes[0];
        this.renderer.drawSelection(hit.x + b.minX, hit.y + b.minY, hit.z + b.minZ, hit.x + b.maxX, hit.y + b.maxY, hit.z + b.maxZ);
      }
    }

    this.renderHud();

    // Screens last: ScreenManager clears the GUI canvas (vanilla hides the HUD while a menu is up).
    this.screens.render(partial);
  }

  private renderHud(): void {
    const ctx = this.guiCtx;
    const scale = this.guiScale;
    const dpr = this.glCanvas.width / window.innerWidth;
    ctx.setTransform(1, 0, 0, 1, 0, 0);
    ctx.clearRect(0, 0, this.guiCanvas.width, this.guiCanvas.height);
    ctx.scale(dpr * scale, dpr * scale);
    const w = window.innerWidth / scale;
    const h = window.innerHeight / scale;

    const debug = [
      `Minecraft 26.2 (web) ${this.fps} fps`,
      `XYZ: ${this.player.pos.x.toFixed(3)} / ${this.player.pos.y.toFixed(3)} / ${this.player.pos.z.toFixed(3)}`,
      `Chunk: ${Math.floor(this.player.pos.x) >> 4} ${Math.floor(this.player.pos.z) >> 4}`,
      `Biome: ${this.generator.biomeName(this.level.getBiome(Math.floor(this.player.pos.x), Math.floor(this.player.pos.y), Math.floor(this.player.pos.z)))}`,
      `Light: ${this.level.getBlockLight(Math.floor(this.player.pos.x), Math.floor(this.player.pos.y), Math.floor(this.player.pos.z))} sky ${this.level.getSkyLight(Math.floor(this.player.pos.x), Math.floor(this.player.pos.y), Math.floor(this.player.pos.z))}`,
      `Time: ${Math.floor(this.level.time)} (${this.level.isDay() ? 'day' : 'night'})`,
      `Chunks: ${this.level.chunks.size} meshed ${this.renderer.meshStats.sections}`,
      `Entities: ${this.entityManager.getEntities().length} draw ${this.entityRenderer.lastDrawCallCount}`,
      `Gen: ${this.chunkProvider.usingWorkers ? `${this.chunkProvider.workerCount}w` : 'sync'} queue ${this.chunkProvider.queueLength} inflight ${this.chunkProvider.inflight}`,
      `Mesh: ${this.renderer.meshStats.ms.toFixed(1)} ms / ${this.renderer.meshStats.count} sections`,
    ];

    const state: HudState = {
      // survival.health is in half-hearts (20 = full), which is what HudState expects
      hearts: Math.max(0, Math.ceil(this.survival.health)),
      maxHearts: this.survival.maxHealth,
      hunger: this.survival.hunger,
      air: 300,
      xpProgress: this.survival.experience,
      xpLevel: this.survival.level,
      hotbar: this.survival.hotbarStacks().map((s) => ({
        item: s.item ? s.item.id : -1,
        count: s.getCount(),
        damage: s.getDamageValue(),
      })),
      selectedSlot: this.selectedSlot,
      itemNameTimer: this.itemNameTimer,
      itemName: this.itemName,
      debug,
      showDebug: this.showDebug,
      fps: this.fps,
      gamemode: this.options.gamemode,
    };

    this.hud.render(ctx, state, w, h, (c, item, x, y, size) => {
      this.icons.draw(c, item, x, y, size);
    });
  }
}
