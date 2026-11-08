// The client glue: owns the canvas, the level, the player, the render loop and input.
// Structure follows Minecraft.runTick / GameRenderer.render.

import { MinecraftData, setMinecraftData } from '../vanilla/world/level/block/state/BlockState.js';
import { ClientLevel, CHUNK_RETAIN_MARGIN, DAY_LENGTH } from '../vanilla/world/level/ClientLevel.js';
import { LevelChunk } from '../vanilla/world/level/chunk/LevelChunk.js';
import { Player, TICK_MS, type PlayerInput } from '../vanilla/world/entity/player/Player.js';
import { ModelSource } from './renderer/model/ModelSource.js';
import { TextureManager } from './renderer/TextureManager.js';
import { BiomeColors } from './renderer/BiomeColors.js';
import { LevelRenderer, type Camera } from './renderer/LevelRenderer.js';
import { LevelChunk as Chunk } from '../vanilla/world/level/chunk/LevelChunk.js';
import { buildLightmap, computeSkyState, DAY_PERIOD, type SkyState } from './EnvironmentLighting.js';
import { FontRenderer } from './gui/FontRenderer.js';
import { DEFAULT_I18N } from './gui/Language.js';
import { calcGuiScale, guiScaledSize } from './gui/GuiScale.js';
import {
  GuiTextures, Hud, HUD_SPRITES, layoutDebugScreen,
  type DebugEntryOutput, type HudItemSlot, type HudState, type HudSurvivalExtensions,
} from './gui/Hud.js';
import { ItemIconAtlas } from './gui/ItemIconAtlas.js';
import { AABB, Vec3 } from '../vanilla/core/Geometry.js';
import { placeBlock, type PlacementContext } from './interaction/Placement.js';
import { NoiseChunkGenerator, loadWorldgenData } from '../vanilla/world/level/levelgen/NoiseChunkGenerator.js';
import { ChunkProvider } from './world/ChunkProvider.js';
import {
  findSpawnSpot as selectSpawnSpot, refineSpawnColumn, isTreeBlock,
} from './world/SpawnSelector.js';
import { EntityManager } from '../vanilla/world/entity/EntityManager.js';
import { setSpawnBlockTags } from '../vanilla/world/entity/SpawnPlacements.js';
import { ExperienceOrb } from '../vanilla/world/entity/ExperienceOrb.js';
import { LivingEntity } from '../vanilla/world/entity/LivingEntity.js';
import { EntityRenderDispatcher } from './renderer/entity/EntityRenderDispatcher.js';
import { ENTITY_TYPES } from '../vanilla/world/entity/EntityType.js';
import { ScreenManager } from './gui/ScreenManager.js';
import { TitleScreen } from './gui/screens/TitleScreen.js';
import { CreativeModeInventoryScreen } from './gui/screens/inventory/CreativeModeInventoryScreen.js';
import type {
  ContainerMenuLike, CreateWorldOptions, GuiOptions, ScreenRef, WorldListProvider,
} from './gui/Types.js';
import { SurvivalState, loadWorldData, type PlayerMoved } from '../vanilla/gameplay/SurvivalState.js';
import { SLOT_OFFHAND } from '../vanilla/world/entity/player/Inventory.js';
import { ItemStack } from '../vanilla/world/item/ItemStack.js';
import { ItemEntity } from '../vanilla/world/entity/item/ItemEntity.js';
import { ContainerInput } from '../vanilla/world/inventory/ClickAction.js';
import type { AbstractContainerMenu } from '../vanilla/world/inventory/AbstractContainerMenu.js';
import { SkyRenderer } from './renderer/environment/SkyRenderer.js';
import { CloudRenderer } from './renderer/environment/CloudRenderer.js';
import { WeatherRenderer } from './renderer/environment/WeatherRenderer.js';
import type { LevelLike } from './renderer/environment/EnvCommon.js';
import { ParticleEngine, spawnBlockBreakParticles } from './particle/ParticleEngine.js';
import { AmbientParticles } from './particle/AmbientParticles.js';
import { SoundEngine } from './audio/SoundEngine.js';
import { MobSounds } from './audio/MobSounds.js';
import { runChatCommand, type CommandHost } from './ChatCommands.js';
import { WorldSaveManager, type LoadedWorld } from './world/save/WorldSaveManager.js';
import { Autosave } from './world/save/Autosave.js';
import {
  ChunkSerializer, MinecraftDataBlockStateCodec, ReversibleBiomeCodec, type ChunkCodecOptions,
} from '../vanilla/world/level/storage/ChunkSerializer.js';
import { PlayerData, type ItemStackData } from '../vanilla/world/level/storage/PlayerData.js';
import { HandRenderer } from './renderer/hand/HandRenderer.js';
import { BreakingOverlay } from './renderer/BreakingOverlay.js';
import { TouchControls } from './touch/TouchControls.js';

export interface GameOptions {
  renderDistance: number;
  guiScale: number;
  fov: number;
  brightness: number;
  gamemode: 'survival' | 'creative';
  /** Complementary-style HDR pipeline (bloom / tonemap / FXAA). F6 toggles it. */
  shaders: boolean;
  /** off / low / medium / high / ultra (TASK-render Phase A.3). */
  shaderQuality: string;
  language: string;
  seed?: number;
  /** worker pool size override (defaults to min(hardwareConcurrency, 4)) */
  workers?: number;
}

const DEFAULT_OPTIONS: GameOptions = {
  // 12 chunks (192 blocks) matches the reference screenshots much better than the old 8;
  // touch devices are capped to 10 in the constructor to keep memory in check.
  renderDistance: 12,
  guiScale: 0,
  fov: 70,
  // Vanilla Options.java:883-898 gamma option default is 0.5 ("options.gamma.default").
  // LightmapRenderStateExtractor.java:68 feeds this to core/lightmap.fsh BrightnessFactor.
  brightness: 0.5,
  gamemode: 'creative',
  shaders: true,
  shaderQuality: 'high',
  language: 'zh_cn',
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
  QUICK_CRAFT: ContainerInput.QUICK_CRAFT,
  PICKUP_ALL: ContainerInput.PICKUP_ALL,
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
  /** Torch flames, lava pops, fire smoke: ClientLevel.animateTick sampling around the player. */
  ambientParticles!: AmbientParticles;
  sounds!: SoundEngine;
  private readonly mobSounds = new MobSounds();
  /** Last survival health / hurtTime seen by the damage-sound watcher. */
  private lastHurtTicks = 0;
  private wasDead = false;
  private rainLoopTimer = 0;
  /**
   * Simplified vanilla AmbientSoundHandler: rare 'ambient.cave' while the player stands in darkness
   * underground. Chance per tick and the cooldown are public so the ambience test can force them.
   */
  caveSoundChance = 1 / 600;
  private caveSoundTimer = 0;
  /** First-person arm / held item / screen effects (hand package). */
  handRenderer!: HandRenderer;
  /** Block breaking decal (hand package). */
  breakingOverlay!: BreakingOverlay;
  /** Screenshot harness: force the break overlay progress (0 = use the live mining progress). */
  breakingDemo = 0;
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
  /** Recent chat/system lines, newest last (vanilla keeps 100). */
  private readonly chatLines: { text: string; time: number }[] = [];
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
  private lastWPress = 0;
  private sprintTap = false;
  private attackCooldown = 0;
  private useCooldown = 0;
  /** left button held: survival mining advances while this is true */
  private mining = false;
  /** walkDist of the last footstep sound */
  private stepDistance = 0;
  private screenWasOpen = false;
  /** true while a background `flushDirty` for far chunks is in flight (throttles the save storm). */
  private chunkFlushPending = false;

  // ---- boot / world-selection state (title screen) -------------------------
  /** Seed as a full 64-bit value: `?seed=` accepts arbitrary strings like vanilla (hashed). */
  private readonly seedBig: bigint;
  /** ?play / ?preview / ?world=... : boot straight into the world instead of the title screen. */
  private readonly bootPlay: boolean;
  /** `?world=<id>`: world to open at boot (used after Create World / Select World). */
  private readonly bootWorldId: string | null;
  /** IndexedDB id of the world the level/player/autosave are currently bound to. */
  private currentWorldId: string | null = null;
  /** False while the title screen is up: the level must not tick underneath the menu. */
  private worldActive = true;
  /** True while the title screen owns the game (pauses the world + autosave). */
  private titleMode = false;
  /** Singleplayer pause: the pause screen freezes the world until it is closed. */
  private pausedByMenu = false;
  /** Set by the touch layer: pointer lock must be skipped on touch devices. */
  private touchEnabled = false;
  /** True on touch hardware (coarse pointer / ?touch=1); controls mobile quality + GUI scale. */
  private readonly touchDevice: boolean;
  /** Bedrock-style touch overlay (ported from M2); created on touch hardware or with ?touch=1. */
  private touch?: TouchControls;
  private touchVisible = false;
  /** performance.now() of the previous touch jump tap (double-tap toggles creative flight). */
  private lastTouchJump = -Infinity;

  private sky: SkyState = computeSkyState(1000);
  private lightmapData = new Uint8Array(16 * 16 * 4);
  private lightmapKey = '';
  /** Column chosen by findSpawnSpot() before any terrain is generated. */
  private spawnSpot: { x: number; z: number; y: number } | null = null;
  /** Chunk-set signature last handed to the entity manager (see syncEntityChunks). */
  private entityChunkKey = '';

  onReady?: () => void;
  onStatus?: (text: string, progress: number) => void;

  constructor(container: HTMLElement, seedOverride?: number | string, workers?: number) {
    // Mobile GPUs cannot hold the desktop chunk/SSAO footprint; keep a farther view than the old
    // 8-chunk default but drop the high-tier post chain that was causing WebGL context loss.
    const touchDevice = typeof window !== 'undefined' && (
      window.matchMedia?.('(pointer: coarse)')?.matches
      || new URLSearchParams(window.location.search).get('touch') === '1'
    );
    if (touchDevice) {
      this.options.renderDistance = Math.min(this.options.renderDistance, 10);
      this.options.shaderQuality = 'medium';
    }
    this.touchDevice = touchDevice;
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
    // Pixel-art GUI: bilinear sampling bleeds neighbouring atlas cells into glyph/icon
    // edges (the "gray cracks") and blurs downscaled item icons.
    this.guiCtx.imageSmoothingEnabled = false;

    // Boot URL: ?seed=<any vanilla seed string>, ?world=<save id>, ?play/?preview (skip the title).
    // The seed stays a bigint (vanilla seeds are 64-bit); options.seed is only the human-readable copy.
    const params = typeof location !== 'undefined' ? new URLSearchParams(location.search) : new URLSearchParams();
    const seedParam = seedOverride ?? params.get('seed') ?? undefined;
    this.seedBig = seedParam === undefined ? 0x2602c0den : parseSeedBig(seedParam);
    this.bootWorldId = params.get('world');
    this.bootPlay = params.has('play') || params.has('preview') || this.bootWorldId !== null;
    this.options.seed = Number(this.seedBig);
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
    this.generator = new NoiseChunkGenerator(this.mc, worldgen, this.seedBig);

    // Workers fetch blocks.bin/worldgen.json themselves and do it while the rest of the loading
    // screen runs, so `init` is kicked off here and awaited only right before the first request.
    this.onStatus?.('Starting chunk workers', 0.5);
    this.chunkProvider = new ChunkProvider(this.mc, this.seedBig, this.options.workers);
    void this.chunkProvider.init('/mc');

    const biomes = Object.values((worldgen as unknown as { biomes: Record<string, { id: number; name: string; temperature: number; downfall: number; effects?: Record<string, number> }> }).biomes);
    this.biomeColors = new BiomeColors(biomes.map((b) => ({ ...b, name: b.name ?? '' })));
    await this.biomeColors.load('/mc');

    this.onStatus?.('Creating world', 0.55);
    this.level = new ClientLevel(this.mc, this.generator, this.seedBig);
    // BiomeColors samples the multi-noise biome source for the 5x5 `biomeBlendRadius` average
    // (vanilla ClientLevel.calculateBlockTint); without it the tint falls back to the single biome.
    this.biomeColors.setBiomeSource((x, y, z) => this.generator!.getBiome(x, y, z));

    this.onStatus?.('Building renderer', 0.65);
    this.renderer = new LevelRenderer(this.gl, this.mc, this.models, this.textures, this.biomeColors);
    this.renderer.renderDistance = this.options.renderDistance;
    // Initial shader state; the VideoSettings screen and F6 mutate it live afterwards.
    this.renderer.shadersEnabled = this.options.shaders;
    this.renderer.shaderQuality = this.options.shaderQuality;
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
    // Exact 26.2 block tags for the spawn rules (animals_spawnable_on, bats_spawnable_on, ...).
    setSpawnBlockTags(worldData.tags);
    this.survival = new SurvivalState(this.mc, this.seedBig, worldData);
    this.survival.gamemode = this.options.gamemode;
    this.survival.onDrop = (stack) => this.dropItem(stack);
    this.survival.onDeath = () => this.onPlayerDeath();

    this.initHotbar();
    this.spawnPlayer();

    // Entities: the manager owns the 20 Hz entity tick + natural spawning, the dispatcher draws
    // them into one batched pass. Both must exist before the first frame.
    this.onStatus?.('Starting entity system', 0.94);
    this.entityManager = new EntityManager(this.level, this.player, this.seedBig, {
      despawnDistance: 128,
    });
    // PlayerTarget forwards mob/arrow damage here; the survival facade owns armor, i-frames and death.
    const pt = this.entityManager.getPlayerTarget();
    if (pt) pt.onHurt = (amount, attacker) => {
      this.survival.damage(amount, attacker ? attacker.getTypeName() : 'mob');
      // LivingEntity.hurt knockback: push the player away from the attacker,
      // strength 0.4 horizontal / 0.36 vertical (Player has its own physics).
      if (attacker) {
        const dx = this.player.pos.x - attacker.getX();
        const dz = this.player.pos.z - attacker.getZ();
        const len = Math.hypot(dx, dz) || 1;
        this.player.vel = new Vec3(
          this.player.vel.x + (dx / len) * 0.4,
          Math.max(this.player.vel.y, 0.36),
          this.player.vel.z + (dz / len) * 0.4,
        );
      }
    };
    this.entityManager.explosionHandler = (x, y, z, power) => this.explode(x, y, z, power);
    void this.entityManager.loadSpawnConfig('/mc');

    this.onStatus?.('Loading entity textures', 0.96);
    this.entityRenderer = new EntityRenderDispatcher(this.gl);
    // A type without a renderer would spawn invisible and still attack: take it out of natural spawning and /summon.
    ENTITY_TYPES.forEach((t) => { if (t.factory && !this.entityRenderer.canRender(t.name)) t.factory = null; });
    await this.entityRenderer.init('/mc/textures/entity');

    // Environment passes (sky / clouds / weather) + particles + audio.
    this.onStatus?.('Building environment', 0.97);
    this.levelLike = this.level as unknown as LevelLike;
    this.skyRenderer = new SkyRenderer(this.gl);
    // 192.33 = vanilla 26.2 cloud height (dimension_type visual/cloud_height); the module default
    // (128) is the 1.17 value. Passed as an option so the module itself stays untouched.
    this.cloudRenderer = new CloudRenderer(this.gl, { quality: 'fancy', height: 192.33 });
    this.weatherRenderer = new WeatherRenderer(this.gl);
    // LightningBolt: the impact is heard everywhere at full volume (thunder), a muffled crack follows
    this.weatherRenderer.onThunder = (x, y, z) => {
      // vanilla volume 10000 means "audible at any distance"; SoundEngine clamps the volume, so play it unpositioned
      this.sounds.play('entity.lightning_bolt.thunder', undefined, undefined, undefined, 1, 0.8 + Math.random() * 0.2);
      this.sounds.play('entity.lightning_bolt.impact', x, y, z, 1, 0.5 + Math.random() * 0.2);
    };
    this.particles = new ParticleEngine(this.gl, 4000);
    ParticleEngine.setInstance(this.particles);
    this.particles.blockLayerForState = (state) => this.blockLayerFor(state);
    this.ambientParticles = new AmbientParticles(this.mc);
    await Promise.all([
      this.skyRenderer.init(),
      this.cloudRenderer.init(),
      this.weatherRenderer.init(),
      this.particles.init({ blockArray: this.textures.block.texture }),
    ]);

    // First-person hand + block-breaking decal (hand package). They own their own shaders and
    // draw into whatever framebuffer is current, so they work with the HDR scene target too.
    this.onStatus?.('Preparing first-person view', 0.975);
    this.handRenderer = new HandRenderer(this.gl, this.mc, this.models, this.textures);
    this.breakingOverlay = new BreakingOverlay(this.gl, this.mc, this.models, this.textures);
    await Promise.all([this.handRenderer.init('/mc'), this.breakingOverlay.init()]);

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
    // Await the locale before any screen is built: the screens translate their button labels
    // in init(), so firing setLanguage() and continuing left the whole first title screen in
    // English even though the zh_cn table arrived a moment later.
    await DEFAULT_I18N.setLanguage(this.options.language).catch(() => undefined);
    this.screens = new ScreenManager(this.guiCanvas, this.gl, {
      mc: this.mc,
      models: this.models,
      font: this.font,
      textures: this.guiTextures,
      icons: this.icons,
      // GameOptions has every field GuiOptions requires; the index signature is the only gap.
      options: this.options as unknown as GuiOptions,
      touchInput: this.touchDevice,
      container: this.containerAdapter(),
      worlds: this.worldProvider(),
      callbacks: {
        onPlay: () => this.closeScreen(),
        onLoadWorld: (id) => { void this.enterWorld(String(id)); },
        onCreateWorld: (options) => { void this.createAndEnterWorld(options as CreateWorldOptions); },
        onOptionChange: (key, value) => {
          (this.options as unknown as Record<string, unknown>)[key] = value;
          // VideoSettings changes must reach the live renderer, not just the options object.
          if (key === 'renderDistance') {
            this.renderer.renderDistance = Math.max(2, Math.min(32, Math.round(Number(value) || 12)));
          } else if (key === 'shaderQuality') {
            this.renderer.shaderQuality = String(value);
          } else if (key === 'shadersEnabled' || key === 'shaders') {
            this.renderer.shadersEnabled = Boolean(value);
          } else if (key === 'guiScale') {
            this.touch?.updateMetrics(this.guiScale);
          } else if (key === 'language') {
            void DEFAULT_I18N.setLanguage(String(value)).then(() => this.screens.refreshLanguage());
          }
        },
        onRespawn: () => this.respawnPlayer(),
        onChatMessage: (text) => {
          console.log('[chat]', text);
          const reply = runChatCommand(text, this.commandHost());
          if (reply) this.addChatLine(reply);
          else this.addChatLine(text);
        },
        onQuit: () => {
          // TitleScreen's Quit button: a browser tab cannot quit; PauseScreen's "Save and Quit to
          // Title" lands here as well and must actually go back to the title screen.
          if (this.screens.current instanceof TitleScreen) {
            this.screens.toastManager.addText('Close the browser tab to quit', '');
            return;
          }
          this.openTitle();
        },
        onScreenClosed: () => {
          this.survival.closeMenu();
          this.keys.clear();
          this.sprintTap = false;
          // Singleplayer pause freezes the level (vanilla MinecraftServer.isPaused); the close
          // callback is the only path that also covers Esc / E / Back to Game.
          if (this.pausedByMenu && !this.titleMode) {
            this.pausedByMenu = false;
            this.worldActive = true;
            this.autosave?.resume();
          }
        },
      },
    });

    this.resize();
    window.addEventListener('resize', () => this.resize());
    this.bindInput();
    this.initTouch();
    if (!this.bootPlay) this.openTitle();
    this.onStatus?.('Ready', 1);
  }

  // ------------------------------------------------ title screen / world lifecycle

  /** World-list adapter for the GUI: creating/selecting a world must NOT rebind the autosave
   *  until the new world is actually loaded (otherwise the old level would be flushed into the
   *  new save). `load()` only binds when the id is the world that is already in memory. */
  private worldProvider(): WorldListProvider {
    const save = this.saveManager;
    return {
      list: () => (save ? save.list() : Promise.resolve([])),
      create: (options) => (save ? save.create(options) : Promise.reject(new Error('no persistence'))),
      delete: (id) => (save ? save.delete(id) : Promise.resolve()),
      load: async (id) => {
        if (save && id === this.currentWorldId) await save.load(id);
      },
    };
  }

  /** Shows the title screen: stops the world tick and pauses (flushes) the autosave. */
  private openTitle(): void {
    this.screens.close(); // reset the screen stack (pause -> title must not keep pause beneath)
    this.screens.open('title');
    this.enterMenuMode();
    if (document.pointerLockElement) document.exitPointerLock();
  }

  /** World tick + autosave stop while a title screen owns the client (vanilla: no level on title). */
  private enterMenuMode(): void {
    if (!this.worldActive && this.titleMode) return;
    this.worldActive = false;
    this.titleMode = true;
    this.keys.clear();
    this.mining = false;
    void this.autosave?.pause();
  }

  /** Leaves the title screen and hands control back to the player. */
  private startPlaying(): void {
    // DeathScreen -> Title Screen -> Play leaves the same world at 0 HP (damage() refuses to
    // trigger onDeath again), so a dead player must respawn instead of standing there forever.
    if (this.survival.isDead || this.survival.health <= 0) this.respawnPlayer();
    this.titleMode = false;
    this.worldActive = true;
    this.screens.close();
    this.keys.clear();
    this.autosave?.resume();
    if (!this.touchEnabled) void this.guiCanvas.requestPointerLock();
  }

  /** "Play Selected World": resume this one when it is already loaded, otherwise reload onto it. */
  private async enterWorld(id: string): Promise<void> {
    if (id === this.currentWorldId) { this.startPlaying(); return; }
    const worlds = (await this.saveManager?.list()) ?? [];
    const record = worlds.find((w) => w.id === id);
    await this.quitToTitleForReload();
    this.reloadInto(id, record?.seed);
  }

  /** CreateWorldScreen has already created the record; find the newest one and open it. */
  private async createAndEnterWorld(options: CreateWorldOptions): Promise<void> {
    void options; // the record (name/seed/gamemode/difficulty) is authoritative
    // create() rebound the save manager to the new world; point it back at the live level before the
    // quit flush, or the old chunks would be written into the brand-new save.
    if (this.currentWorldId) await this.saveManager?.load(this.currentWorldId);
    const worlds = (await this.saveManager?.list()) ?? [];
    if (!worlds.length) {
      this.screens.toastManager.addText('Could not create the world (persistence unavailable)', '');
      return;
    }
    const newest = worlds[0];
    await this.quitToTitleForReload();
    this.reloadInto(newest.id, newest.seed);
  }

  /** Flush the current world (awaitable) before a reload; a page reload would otherwise abort it. */
  private async quitToTitleForReload(): Promise<void> {
    this.keys.clear();
    this.mining = false;
    try { await this.autosave?.quit(); } catch { /* best effort */ }
  }

  private reloadInto(worldId: string, seed?: string | number): void {
    const params = new URLSearchParams(location.search);
    params.set('world', worldId);
    params.set('play', '1');
    if (seed !== undefined) params.set('seed', String(seed));
    params.delete('preview');
    location.href = `${location.pathname}?${params.toString()}`;
  }

  /** True while a TitleScreen instance owns the GUI (title / options / select world stack). */
  private isTitleOpen(): boolean { return this.screens.current instanceof TitleScreen; }

  // ---------------------------------------------------------------- touch controls

  /**
   * Mounts the Bedrock-style touch overlay (src/client/touch, ported from M2) on touch hardware or
   * with ?touch=1. It feeds the same PlayerInput fields as the keyboard and the look pad writes
   * yaw/pitch exactly like the mouse does; pointer lock is disabled while it is active.
   */
  private initTouch(): void {
    const touch = new TouchControls(document.body, {
      autoEnable: this.detectTouch(),
      visible: false,
      onInventory: () => {
        if (!this.worldActive || this.screens.current) return;
        this.openScreen(this.options.gamemode === 'creative' ? 'creative' : 'inventory');
      },
      onChat: () => { if (this.worldActive && !this.screens.current) this.openScreen('chat'); },
      onPause: () => { if (this.worldActive && !this.screens.current) this.openScreen('pause'); },
      onUse: () => { if (this.worldActive && !this.screens.current) this.useItem(); },
      onAttackStart: () => {
        if (!this.worldActive || this.screens.current) return;
        this.mining = true;
        this.attack();
      },
      onAttackEnd: () => { this.mining = false; },
    });
    this.touch = touch;
    touch.updateMetrics(this.guiScale);
    this.touchEnabled = touch.isEnabled();
    if (!this.touchEnabled) return;

    // Tap the hotbar to select a slot (vanilla touch HUD). The look pad ends above the hotbar, so
    // these pointer events reach the canvas; touches that start on a control surface are ignored.
    document.addEventListener('pointerdown', (e) => {
      if (!this.touchEnabled || !this.worldActive || this.screens.current) return;
      if (e.pointerType !== 'touch' && e.pointerType !== 'pen') return;
      const target = e.target as HTMLElement | null;
      if (target?.closest?.('.tc-root')) return;
      const slot = this.touchHotbarSlot(e.clientX, e.clientY);
      if (slot < 0) return;
      this.selectedSlot = slot;
      this.showItemName();
      e.preventDefault();
      e.stopPropagation();
    }, true);
  }

  /**
   * Touch mode: ?touch=1 / ?touch=0 force it, otherwise only coarse-pointer (mobile/tablet) devices
   * get the overlay. navigator.maxTouchPoints alone is not enough: touchscreen Windows laptops
   * report it while the player is using the mouse, and the overlay would cover half the screen.
   */
  private detectTouch(): boolean {
    const forced = typeof location !== 'undefined' ? new URLSearchParams(location.search).get('touch') : null;
    if (forced === '1' || forced === 'on' || forced === 'true') return true;
    if (forced === '0' || forced === 'off' || forced === 'false') return false;
    try {
      return typeof window !== 'undefined' && !!window.matchMedia?.('(pointer: coarse)')?.matches;
    } catch {
      return false;
    }
  }

  /** Hit-test the vanilla 182x22 hotbar (Hud.renderHotbar) against a CSS-pixel pointer position. */
  private touchHotbarSlot(clientX: number, clientY: number): number {
    const scale = this.guiScale;
    const dpr = this.glCanvas.width / Math.max(1, window.innerWidth);
    const guiX = (clientX * dpr) / scale;
    const guiY = (clientY * dpr) / scale;
    const size = guiScaledSize(this.glCanvas.width, this.glCanvas.height, scale);
    const w = size.width;
    const h = size.height;
    if (guiY < h - 22 || guiY > h) return -1;
    const left = Math.floor(w / 2) - 91;
    const i = Math.floor((guiX - (left + 1)) / 20);
    if (i < 0 || i > 8) return -1;
    if (guiX > left + 1 + i * 20 + 20) return -1;
    return i;
  }

  /** Shows the overlay only while in the world and mirrors flying/underwater into its buttons. */
  private syncTouchUi(): void {
    const touch = this.touch;
    if (!touch) return;
    const inWorld = this.worldActive && this.screens.current === null
      && !(this.survival?.isDead ?? false);
    const visible = touch.isEnabled() && inWorld;
    if (visible !== this.touchVisible) {
      this.touchVisible = visible;
      touch.setVisible(visible);
    }
    if (!touch.isEnabled() || !this.player) return;
    touch.setFlying(this.player.flying);
    touch.setUnderwater(this.playerEyeInWater());
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
   * Picks the spawn column before any terrain exists, using only noise queries so the loading
   * screen still generates chunks around the real spawn only. The search itself is a pure function
   * in src/client/world/SpawnSelector.ts: it prefers plains/forest/birch_forest, wants water within
   * 24 blocks and flat ground, and is deterministic for a given seed (~20 ms warm).
   */
  private findSpawnSpot(): { x: number; z: number; y: number } {
    const spot = selectSpawnSpot(this.generator!);
    console.log(
      `[spawn] ${spot.x},${spot.z} ${spot.biome} preferred=${spot.preferred}` +
      ` water=${spot.waterDistance === Infinity ? 'none' : spot.waterDistance} relief=${spot.relief}` +
      ` score=${spot.score.toFixed(1)} ${spot.elapsedMs.toFixed(1)}ms` +
      ` (${spot.columnsSampled} columns, ${spot.biomeQueries} biome queries)`,
    );
    return { x: spot.x, z: spot.z, y: spot.y };
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
    // Trees are placed by the feature pass, which the noise-only search cannot see. Move to an
    // *open* column (no leaf/log top within 3 blocks) so the player does not start under a canopy.
    const clearOfTrees = (cx: number, cz: number): boolean => {
      for (let dz = -3; dz <= 3; dz++) {
        for (let dx = -3; dx <= 3; dx++) {
          const top = this.level.getHeight(cx + dx, cz + dz);
          if (isTreeBlock(this.mc.blockOf(this.level.getBlockState(cx + dx, top, cz + dz)).name)) return false;
        }
      }
      return true;
    };
    const refined = refineSpawnColumn(x, z, clearOfTrees, 10);
    if (refined.x !== x || refined.z !== z) console.log(`[spawn] moved to a clearing: ${x},${z} -> ${refined.x},${refined.z}`);
    x = refined.x;
    z = refined.z;
    let standing = this.findStandingY(x, z);
    if (standing === null) {
      // Spiral again over the already generated area and take the first column that qualifies.
      outer:
      for (let r = 0; r <= 48; r += 2) {
        for (let dz = -r; dz <= r; dz += 2) {
          for (let dx = -r; dx <= r; dx += 2) {
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
    // Face inland: looking straight at the nearest sea leaves a large fog-only horizon on the
    // first frame. The water is still behind the player and visible after a short turn.
    const water = this.findNearestWater(x, z, 24);
    const waterYaw = water ? (Math.atan2(water.x - x, water.z - z) * 180) / Math.PI : 0;
    this.player.yaw = water ? waterYaw + 180 : 0;
    this.player.pitch = -3;
    console.log(
      `[spawn] ${x + 0.5}, ${(standing ?? fallbackY) + 1}, ${z + 0.5}` +
      ` (sea ${this.level.seaLevel}, standing ${standing ?? 'fallback'},` +
      ` water=${water ? `${water.dist}b @ ${water.x},${water.z}` : '>24'})`,
    );
  }

  /**
   * Nearest water column, searched ring by ring from the spawn column (the first hit is the
   * Chebyshev-nearest one). Uses the column's top block instead of a fixed y: sea level 63 means
   * ocean source blocks stop at y=62, so probing one fixed layer misses most water (Heightmap
   * WORLD_SURFACE top here is a fluid iff the column is water). Reads real block states, so the
   * spawn chunks must be loaded. Drives the "water within 24 blocks" spawn rule + initial yaw.
   */
  private findNearestWater(x: number, z: number, radius: number): { x: number; z: number; dist: number } | null {
    for (let r = 0; r <= radius; r++) {
      for (let dz = -r; dz <= r; dz++) {
        for (let dx = -r; dx <= r; dx++) {
          if (Math.max(Math.abs(dx), Math.abs(dz)) !== r) continue;
          const wx = x + dx;
          const wz = z + dz;
          const top = this.level.getHeight(wx, wz);
          if (this.mc.isLiquid(this.level.getBlockState(wx, top, wz))) return { x: wx, z: wz, dist: r };
        }
      }
    }
    return null;
  }

  private initHotbar(): void {
    // Slot 8 used to be `water`, which is not an item (blank icon and nothing to place);
    // a fence block is both a real item and a good demo of the multipart connection states.
    const defaults = ['grass_block', 'stone', 'oak_planks', 'oak_log', 'glass', 'torch', 'crafting_table', 'oak_stairs', 'oak_fence'];
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
    // CreativeModeInventoryScreen owns a virtual 9x5 tab grid (indices 0..44) plus the real
    // player hotbar (45..53); it is not backed by an AbstractContainerMenu.
    const creativeGrid: { itemId: number; count: number }[] = Array.from(
      { length: 45 }, () => ({ itemId: -1, count: 0 }),
    );
    const isCreative = (): boolean => this.screens?.current instanceof CreativeModeInventoryScreen;
    const menuIndex = (index: number): number => isCreative() && index >= 45 ? index - 9 : index;
    const plain = (stack: ItemStack): { itemId: number; count: number } =>
      ({ itemId: stack.isEmpty() ? -1 : stack.item!.id, count: stack.getCount() });
    return {
      getSlotCount: () => (isCreative() ? 54 : menu().slots.length),
      getItem: (index) => {
        if (isCreative()) {
          if (index >= 0 && index < 45) return creativeGrid[index];
          if (index >= 45 && index < 54) return plain(this.survival.inventory.getItem(index - 45));
        }
        const slot = menu().slots[index];
        const stack = slot ? slot.getItem() : ItemStack.EMPTY;
        return plain(stack);
      },
      click: (index, button, _shift, action) => {
        const active = menu();
        if (isCreative() && index >= 0 && index < 45) {
          const item = this.survival.registry.get(creativeGrid[index].itemId);
          if (!item) { active.setCarried(ItemStack.EMPTY); return; }
          const stack = new ItemStack(item, 1);
          const max = stack.getMaxStackSize();
          const carried = active.getCarried();
          if (action === 'SWAP') {
            this.survival.inventory.setItem(button, stack.copyWithCount(max));
          } else if (action === 'THROW') {
            this.survival.drop(stack.copyWithCount(button === 1 ? max : 1));
          } else if (action === 'CLONE' || action === 'QUICK_MOVE') {
            active.setCarried(stack.copyWithCount(max));
          } else if (action === 'PICKUP' || action === 'SPLIT') {
            if (carried.isEmpty()) active.setCarried(stack);
            else if (ItemStack.isSameItemSameComponents(carried, stack)) {
              carried.setCount(Math.max(0, Math.min(max, carried.getCount() + (button === 1 ? -1 : 1))));
            } else active.setCarried(ItemStack.EMPTY);
          }
          return;
        }
        if (isCreative() && index >= 45 && index < 54 && action === 'QUICK_MOVE') {
          this.survival.inventory.setItem(index - 45, ItemStack.EMPTY);
          return;
        }
        active.clicked(menuIndex(index), button, ACTION_TO_INPUT[action], this.survival.asMenuPlayer());
      },
      canPlaceItem: (index, stack) => {
        if (isCreative() && index >= 0 && index < 45) return false;
        const active = menu();
        const slot = active.slots[menuIndex(index)];
        const item = this.survival.registry.get(stack.itemId);
        return !!slot && !!item && slot.mayPlace(new ItemStack(item, stack.count)) && active.canDragTo(slot);
      },
      getMaxStackSize: (index, stack) => {
        const item = this.survival.registry.get(stack.itemId);
        if (!item) return 0;
        const value = new ItemStack(item, stack.count);
        if (isCreative() && index >= 0 && index < 45) return value.getMaxStackSize();
        return menu().slots[menuIndex(index)]?.getMaxStackSize(value) ?? value.getMaxStackSize();
      },
      setItem: (index, stack) => {
        if (isCreative() && index >= 0 && index < 45) creativeGrid[index] = { itemId: stack.itemId, count: stack.count };
      },
      getCarried: () => {
        const stack = menu().getCarried();
        return stack.isEmpty() ? null : plain(stack);
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
    // Particles sample the same light as terrain (break particles used to glow in the dark).
    ParticleEngine.get().lightAt = (x, y, z) =>
      this.level.getBrightness(Math.floor(x), Math.floor(y), Math.floor(z));
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
      // ?world=<id> wins (world selection / after Create World); otherwise resume the newest world.
      const wanted = this.bootWorldId ? worlds.find((w) => w.id === this.bootWorldId) : undefined;
      if (this.bootWorldId && !wanted) {
        console.warn(`[save] requested world ${this.bootWorldId} not found; falling back to the newest one`);
      }
      const target = wanted ?? worlds[0];
      if (target) {
        const loaded = await this.saveManager.loadWorld(target.id);
        this.currentWorldId = target.id;
        this.restoreWorld(loaded);
        console.log(`[save] restored "${target.name}" (${target.id}): ${loaded.chunks.size} chunks, player ${loaded.player ? 'yes' : 'no'}`);
      } else {
        this.currentWorldId = await this.saveManager.createWorld({
          name: 'World',
          seed: this.seedBig,
          gamemode: this.options.gamemode,
          difficulty: 'normal',
        });
        console.log(`[save] created new world ${this.currentWorldId}`);
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
      this.survival.restoreFromSave(view);
    }

    const data = loaded.level.getCompoundOrEmpty('Data');
    const dayTime = Number(data.getLongOr('DayTime', BigInt(Math.trunc(this.level.time))));
    const gameTime = Number(data.getLongOr('Time', BigInt(Math.trunc(this.level.gameTime))));
    if (dayTime > 0) this.level.time = dayTime;
    if (gameTime > 0) this.level.gameTime = gameTime;

    // level.dat WeatherData: Raining / RainTime / Thundering / ThunderTime.
    this.level.setWeatherState({
      raining: data.getBooleanOr('Raining', false),
      rainTime: data.getIntOr('RainTime', 0),
      thundering: data.getBooleanOr('Thundering', false),
      thunderTime: data.getIntOr('ThunderTime', 0),
    });

    // GameType: 0 survival, 1 creative, 2 adventure, 3 spectator (LevelStorage.createLevelDat).
    const gameType = data.getIntOr('GameType', -1);
    if (gameType === 0) this.options.gamemode = 'survival';
    else if (gameType === 1) this.options.gamemode = 'creative';

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
    canvas.style.touchAction = 'none';
    const modifiers = (e: MouseEvent | KeyboardEvent): number =>
      (e.shiftKey ? 1 : 0) | (e.ctrlKey ? 2 : 0) | (e.altKey ? 4 : 0);

    canvas.addEventListener('click', () => {
      if (this.screens.current) return;  // a menu is up: the click belongs to the GUI
      if (this.touchEnabled) return;     // touch devices cannot lock the pointer; the touch layer looks
      if (!this.mouseLocked) canvas.requestPointerLock();
    });
    document.addEventListener('pointerlockchange', () => {
      this.mouseLocked = document.pointerLockElement === canvas;
      if (!this.mouseLocked) {
        this.mining = false;
        // The browser consumes the first Esc to exit pointer lock without delivering a
        // keydown; vanilla pauses the game in exactly this situation.
        if (!this.screens.current && !this.titleMode && this.worldActive && !this.touchEnabled) {
          this.openScreen('pause');
        }
      }
    });
    document.addEventListener('pointermove', (e) => {
      if (this.screens.current) {
        this.screens.onMouse(e.clientX, e.clientY, -1, 'move', 0, modifiers(e));
        return;
      }
      if (!this.mouseLocked) return;
      const sens = 0.15 * (this.zooming ? 0.25 : 1);
      this.player.yaw -= e.movementX * sens;
      this.player.pitch = Math.max(-90, Math.min(90, this.player.pitch + e.movementY * sens));
    });
    document.addEventListener('wheel', (e) => {
      if (e.ctrlKey) e.preventDefault();
      if (this.screens.current) { this.screens.onMouse(e.clientX, e.clientY, -1, 'wheel', e.deltaY, modifiers(e)); return; }
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
      if (e.code === 'F6') { this.setShaders(!this.renderer.shadersEnabled); e.preventDefault(); return; }
      if (e.code === 'Escape') { this.openScreen('pause'); e.preventDefault(); return; }
      if (e.code === 'KeyW' && !e.repeat && !this.keys.has('KeyW')) {
        const now = performance.now();
        if (now - this.lastWPress < 300) this.sprintTap = true;
        this.lastWPress = now;
      }
      this.keys.add(e.code);
      if (e.code.startsWith('Digit')) {
        const n = Number(e.code.slice(5));
        if (n >= 1 && n <= 9) { this.selectedSlot = n - 1; this.showItemName(); }
      }
      if (e.code === 'KeyF' && this.options.gamemode === 'creative') {
        this.player.flying = !this.player.flying;
      }
      if (e.code === 'Space' && !e.repeat) {
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
    window.addEventListener('keyup', (e) => {
      this.keys.delete(e.code);
      this.screens.setModifiers(modifiers(e));
      if (e.code === 'KeyW') this.sprintTap = false;
    });
    window.addEventListener('blur', () => {
      this.keys.clear();
      this.sprintTap = false;
      this.mining = false;
      this.screens.setModifiers(0);
      this.screens.onMouse(0, 0, -1, 'cancel', 0, 0);
    });

    canvas.addEventListener('pointerdown', (e) => {
      if (!e.isPrimary) return;
      this.unlockAudio();
      if (this.screens.current) {
        if (e.pointerType !== 'mouse') e.preventDefault();
        canvas.setPointerCapture(e.pointerId);
        this.screens.onMouse(e.clientX, e.clientY, e.button, 'down', 0, modifiers(e));
        return;
      }
      if (!this.mouseLocked) {
        if (!this.touchEnabled) canvas.requestPointerLock();
        return;
      }
      if (e.button === 0) { this.mining = true; this.attack(); }
      if (e.button === 2) this.useItem();
      if (e.button === 1) this.pickBlock();
    });
    document.addEventListener('pointerup', (e) => {
      if (!e.isPrimary) return;
      if (e.button === 0) this.mining = false;
      if (this.screens.current) {
        this.screens.onMouse(e.clientX, e.clientY, e.button, 'up', 0, modifiers(e));
        // A button may have closed the menu: take the pointer back while we still have activation.
        if (!this.screens.current && !this.mouseLocked && !this.touchEnabled) canvas.requestPointerLock();
      }
    });
    canvas.addEventListener('pointercancel', (e) => {
      this.mining = false;
      this.screens.onMouse(e.clientX, e.clientY, -1, 'cancel', 0, modifiers(e));
    });
    canvas.addEventListener('contextmenu', (e) => e.preventDefault());
  }

  /** AudioContext resume must happen inside a user gesture; call from every input handler. */
  private unlockAudio(): void {
    if (this.sounds && !this.sounds.isUnlocked) void this.sounds.resume();
  }

  /** Opens a GUI screen and releases the mouse so the buttons can be clicked. */  private openScreen(screen: ScreenRef): void {
    if (screen === 'inventory' || screen === 'creative') {
      this.survival.closeMenu();
      this.survival.openInventory();
    }
    this.screens.open(screen);
    this.keys.clear();
    if (document.pointerLockElement) document.exitPointerLock();
    // vanilla singleplayer pauses the integrated server while the pause menu is open
    if (screen === 'pause') {
      this.pausedByMenu = true;
      this.worldActive = false;
      void this.autosave?.pause();
    }
  }

  /** Closes the current screen and hands control (and the mouse) back to the player. */
  private closeScreen(): void {
    this.screens.close();
    this.survival?.closeMenu();
    this.keys.clear();
    this.autosave?.resume();
    if (!this.mouseLocked && !this.touchEnabled) void this.guiCanvas.requestPointerLock();
  }

  showDebug = false;
  /** OptiFine-style C zoom (spyglass FOV). */
  private get zooming(): boolean { return this.keys.has('KeyC'); }
  onInventoryToggle?: () => void;
  onChatToggle?: () => void;

  private showItemName(): void {
    const item = this.hotbar[this.selectedSlot];
    if (item >= 0) {
      const name = this.mc.items[item].name;
      let label = name.replace(/_/g, ' ');
      for (const key of [`block.minecraft.${name}`, `item.minecraft.${name}`]) {
        const tr = DEFAULT_I18N.get(key);
        if (tr !== key) { label = tr; break; }
      }
      this.itemName = label;
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

    // Player attack: ray vs entity boxes first (vanilla Player.attack). The block hit is the
    // occlusion limit, so a mob behind a wall cannot be hit.
    const blockHit = this.raycast();
    const eye = this.cameraEye();
    const blockDistance = blockHit
      ? Math.hypot(blockHit.point.x - eye.x, blockHit.point.y - eye.y, blockHit.point.z - eye.z)
      : Infinity;
    const target = this.findEntityTarget(Math.min(3.5, blockDistance + 0.25));
    if (target) {
      const held = this.survival.getSelectedStack();
      const name = held.item?.name ?? '';
      const damage = name.endsWith('_sword') ? 4 : name.endsWith('_axe') ? 6
        : name.endsWith('_pickaxe') ? 3 : name.endsWith('_shovel') ? 2.5 : 1;
      target.hurt(damage, this.entityManager.getPlayerTarget());
      return;
    }

    // Creative breaks instantly and drops nothing; survival only *starts* mining — the progress
    // and the drop are handled by BlockBreaking in tick().
    if (this.options.gamemode !== 'creative') return;
    if (!blockHit) return;
    const hit = blockHit;
    const broken = this.level.getBlockState(hit.x, hit.y, hit.z);
    this.level.setBlockState(hit.x, hit.y, hit.z, 0);
    this.updateNeighbors(hit.x, hit.y, hit.z);
    if (broken !== 0) this.breakEffects(broken, hit.x, hit.y, hit.z);
  }

  /** Slab ray/AABB test for the attack reach; returns the closest living entity. */
  private findEntityTarget(maxDistance: number): LivingEntity | null {
    const eye = this.cameraEye();
    const dir = this.lookVector();
    let best: LivingEntity | null = null;
    let bestT = maxDistance;
    for (const entity of this.entityManager.getEntities()) {
      if (!(entity instanceof LivingEntity) || !entity.isAlive()) continue;
      const box = entity.getBoundingBox().inflateAll(0.1);
      let tmin = 1e-5;
      let tmax = bestT;
      let miss = false;
      for (const [origin, delta, lo, hi] of [
        [eye.x, dir.x, box.minX, box.maxX],
        [eye.y, dir.y, box.minY, box.maxY],
        [eye.z, dir.z, box.minZ, box.maxZ],
      ] as const) {
        if (Math.abs(delta) < 1e-8) {
          if (origin < lo || origin > hi) { miss = true; break; }
          continue;
        }
        let t1 = (lo - origin) / delta;
        let t2 = (hi - origin) / delta;
        if (t1 > t2) [t1, t2] = [t2, t1];
        tmin = Math.max(tmin, t1);
        tmax = Math.min(tmax, t2);
        if (tmin > tmax) { miss = true; break; }
      }
      if (!miss && tmin < bestT) { best = entity; bestT = tmin; }
    }
    return best;
  }

  /** Advances the survival mining progress for the aimed block (vanilla Player.tick loop). */
  private updateMining(): void {
    if (this.options.gamemode === 'creative' || !(this.mouseLocked || this.touchEnabled) || !this.mining) {
      this.survival.breaking.reset();
      return;
    }
    const hit = this.raycast();
    if (!hit) { this.survival.breaking.reset(); return; }
    const state = this.level.getBlockState(hit.x, hit.y, hit.z);
    if (state === 0) { this.survival.breaking.reset(); return; }

    // Vanilla keeps the arm swinging the whole time attack is held, not only on the break tick.
    this.player.swingHand();

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

  /**
   * `block.<type>` for a block state. blocks.json stores each block's SoundType as its break event
   * ("block.stone.break"), so the step/place/hit/fall events share its prefix. Falls back to the
   * coarse name heuristic for sound types that have no imported files.
   */
  private blockSoundBase(state: number): string {
    const sound = this.mc.blockOf(state).sound;
    const m = /^(block\.[a-z_]+)\.break$/.exec(sound ?? '');
    if (m && this.sounds.hasRealEvent(`${m[1]}.step`)) return m[1];
    return `block.${this.blockMaterial(this.mc.blockOf(state).name)}`;
  }

  private playStepSound(): void {
    const p = this.player;
    if (!p.onGround || p.flying) { this.stepDistance = p.walkDist; return; }
    if (p.walkDist - this.stepDistance < 1) return;
    this.stepDistance = p.walkDist;
    const below = this.level.getBlockState(Math.floor(p.pos.x), Math.floor(p.pos.y - 0.2), Math.floor(p.pos.z));
    // Entity.playStepSound: volume 0.15 * SoundType.volume; sneaking is silent
    if (p.sneaking) return;
    this.sounds.play(`${this.blockSoundBase(below)}.step`, p.pos.x, p.pos.y, p.pos.z, 0.15, 1);
  }

  private breakEffects(state: number, x: number, y: number, z: number): void {
    spawnBlockBreakParticles(state, x, y, z, 20);
    // SoundType.getBreakSound at volume (v + 1) / 2 and pitch * 0.8 (BlockBehaviour / LevelEvent 2001)
    this.sounds.play(`${this.blockSoundBase(state)}.break`, x + 0.5, y + 0.5, z + 0.5, 1, 0.8);
  }

  /**
   * ClientLevel has no weather simulation (rainLevel is a private field that is never advanced),
   * so the rain pass can only be driven from outside. Exposed for the console / future commands.
   */
  /** Master shaders toggle (F6); exposed as window.__mc.setShaders(on) for verification. */
  setShaders(on: boolean): void {
    this.options.shaders = on;
    this.renderer.shadersEnabled = on;
  }

  /** Also reachable from the console: __mc.setShaderQuality('low' | ... | 'ultra'). */
  setShaderQuality(quality: string): void {
    this.options.shaderQuality = quality;
    this.renderer.shaderQuality = quality;
  }

  /**
   * Weather is simulated by ClientLevel (ServerLevel.advanceWeatherCycle); this is a manual
   * override for the console / tests. Call setRain(-1) to hand control back to the simulation.
   */
  setRain(amount: number): void {
    this.level.setRainOverride(amount < 0 ? null : amount);
  }

  // ---------------------------------------------------------- survival / damage

  /** Entity.isEyeInFluid(FluidTags.WATER) for the player's eye block. */
  private playerEyeInWater(): boolean {
    return this.player.isEyeInWater(this.level);
  }

  /** Entity.isInLava for the player's feet block. */
  private playerInLava(): boolean {
    const x = Math.floor(this.player.pos.x);
    const y = Math.floor(this.player.pos.y + 0.1);
    const z = Math.floor(this.player.pos.z);
    const state = this.level.getBlockState(x, y, z);
    return state !== 0 && this.mc.blockOf(state).name === 'lava';
  }

  /** Vanilla Entity remainingFireTicks for the player (lava/fire ignite, water extinguishes). */
  private playerFireTicks = 0;

  /**
   * Explosion (net/minecraft/world/level/Explosion): damages the player by distance and
   * breaks the blocks of the blast sphere (dropping their loot through the normal loot tables).
   * Vanilla power 3 leaves a ~3 block radius; resistance/hardness are approximated.
   */
  private explode(x: number, y: number, z: number, power: number): void {
    const f = power * 2;
    const radius = Math.max(1, Math.floor(f));
    for (let dy = -radius; dy <= radius; dy++) {
      for (let dz = -radius; dz <= radius; dz++) {
        for (let dx = -radius; dx <= radius; dx++) {
          const d = Math.hypot(dx, dy, dz);
          if (d > f) continue;
          const bx = x + dx, by = y + dy, bz = z + dz;
          const state = this.level.getBlockState(bx, by, bz);
          if (state === 0) continue;
          const meta = this.mc.blockOf(state);
          if (meta.hardness < 0 || meta.resistance > 100) continue; // bedrock / barrier
          const drops = this.survival.breakBlock((qx, qy, qz) => this.level.getBlockState(qx, qy, qz), bx, by, bz);
          this.level.setBlockState(bx, by, bz, 0);
          for (const stack of drops) this.dropItem(stack, bx, by, bz);
          this.breakEffects(state, bx, by, bz);
        }
      }
    }
    this.updateNeighbors(Math.floor(x), Math.floor(y), Math.floor(z));
    // Player damage: vanilla Explosion.getSeenPercent ~ (1 - d/f) falloff.
    const d = Math.hypot(this.player.pos.x - x, this.player.pos.y - y, this.player.pos.z - z);
    if (d < f) this.survival.damage((1 - d / f) * (power * 7 + 1) * 0.5, 'explosion');
  }

  /** Player death: drop inventory + XP, open the vanilla DeathScreen. */
  private onPlayerDeath(): void {
    const { stacks, experience } = this.survival.dropAllOnDeath();
    for (const stack of stacks) this.dropItem(stack);
    if (experience > 0) {
      const orb = new ExperienceOrb(this.level, this.player.pos.x, this.player.pos.y + 0.5, this.player.pos.z, experience);
      this.entityManager.spawnEntity(orb);
    }
    this.playerFireTicks = 0;
    this.keys.clear();
    this.mining = false;
    if (document.pointerLockElement) document.exitPointerLock();
    this.screens.open('death', this.survival.lastHurtBy, String(experience));
  }

  /**
   * Sounds that vanilla plays from LivingEntity/ClientLevel tick code: mob voices, the player hurt/death cry,
   * the rain loop and thunder.
   */
  private tickAudioEvents(): void {
    const p = this.player.pos;
    this.mobSounds.tick(this.entityManager.getEntities(), this.sounds, p.x, this.player.eyeY, p.z);

    const hurt = this.survival.hurtTime;
    if (hurt > this.lastHurtTicks) this.sounds.play('entity.player.hurt', p.x, p.y, p.z, 1, 1);
    this.lastHurtTicks = hurt;
    const dead = this.survival.health <= 0;
    if (dead && !this.wasDead) this.sounds.play('entity.player.death', p.x, p.y, p.z, 1, 1);
    this.wasDead = dead;

    // weather.rain loops while it rains (WeatherEffectRenderer: 40 tick cadence, volume follows the rain level)
    const rain = this.level.getRainLevel();
    if (rain > 0.01 && --this.rainLoopTimer <= 0) {
      this.rainLoopTimer = 40;
      this.sounds.play('weather.rain', undefined, undefined, undefined, 0.35 * rain, 1);
    }
  }

  /**
   * Cave ambience (HANDOFF §8-4, simplified AmbientSoundHandler): while the player is underground
   * in darkness (sky light 0 below sea level + 20), occasionally play 'ambient.cave' at the player.
   * Vanilla rolls mood once per tick with a long cooldown; the cooldown here is 60-180 s.
   */
  private tickCaveAmbience(): void {
    if (this.caveSoundTimer > 0) { this.caveSoundTimer--; return; }
    const px = Math.floor(this.player.pos.x);
    const py = Math.floor(this.player.eyeY);
    const pz = Math.floor(this.player.pos.z);
    if (py > this.level.seaLevel + 20) return;                 // not underground enough
    if (this.level.getSkyLight(px, py, pz) > 0) return;        // lit by the sky: not a cave
    if (Math.random() > this.caveSoundChance) return;
    this.sounds.play('ambient.cave', this.player.pos.x, this.player.pos.y, this.player.pos.z, 0.7,
      0.8 + Math.random() * 0.4);
    this.caveSoundTimer = 1200 + Math.floor(Math.random() * 2400);
  }

  /** Player.respawn (DeathScreen "Respawn" button / callbacks.onRespawn). */
  private respawnPlayer(): void {
    this.survival.respawn();
    this.spawnPlayer();
    this.playerFireTicks = 0;
    this.keys.clear();
    // The entity manager holds a PlayerTarget proxy that points at the old Player instance.
    this.entityManager.setPlayer(this.player);
    this.screens.close();
    this.autosave?.resume();
  }

  /** Per-block container instances: chest/furnace contents survive closing the GUI this session. */
  private readonly blockContainers = new Map<string, AbstractContainerMenu>();

  /**
   * Opens the vanilla container GUI for a right-clicked block. The menu itself comes from the
   * vanilla menu ports in SurvivalState (CraftingMenu / ChestMenu / FurnaceMenu); chest and furnace
   * instances are cached per block position so their contents are kept while the session lives
   * (this client has no block-entity ticker, so a furnace only cooks while its GUI is open).
   */
  private openBlockContainer(blockName: string, x: number, y: number, z: number): void {
    if (blockName === 'crafting_table') {
      this.survival.openCraftingTable();
      this.openScreen('crafting');
      return;
    }
    const isFurnace = blockName === 'furnace';
    // The cache key includes the block type: the same position may hold a chest at one moment and
    // a furnace later (tests/sandbox both do this), and the menu classes are not interchangeable.
    const key = `${blockName}@${x},${y},${z}`;
    let menu = this.blockContainers.get(key);
    if (!menu) {
      menu = isFurnace ? this.survival.openFurnace() : this.survival.openChest(3);
      this.blockContainers.set(key, menu);
    } else {
      this.survival.activeMenu = menu;
    }
    this.openScreen(isFurnace ? 'furnace' : 'chest');
  }

  /** Furnace menus advance one 20 Hz step per game tick (block-entity tick stand-in). */
  private tickActiveMenu(): void {
    const menu = this.survival.activeMenu as unknown as
      { tick?: () => void; getBurnProgress?: () => number } | null;
    if (menu && typeof menu.tick === 'function' && typeof menu.getBurnProgress === 'function') menu.tick();
  }

  /** Mirrors the active furnace menu's cooking state into the open FurnaceScreen. */
  private syncFurnaceScreen(): void {
    const screen = this.screens.current as unknown as { burnProgress?: number; litProgress?: number } | null;
    const menu = this.survival.activeMenu as unknown as
      { getBurnProgress?: () => number; getLitProgress?: () => number } | null;
    if (!screen || !menu || typeof menu.getBurnProgress !== 'function' || typeof menu.getLitProgress !== 'function') return;
    screen.burnProgress = menu.getBurnProgress();
    screen.litProgress = menu.getLitProgress();
  }

  /**
   * Right-click placement (vanilla PlayerGameMode.useItemOn -> BlockItem.place).
   * The rule table itself lives in interaction/Placement.ts (port of BlockItem.place +
   * Block.getStateForPlacement + BlockState.canSurvive); this method only builds the
   * BlockPlaceContext equivalent from the crosshair hit and the player state.
   */
  private useItem(): void {
    if (this.useCooldown > 0) return;
    // Food / consumables: right click eats without requiring a block target.
    const held = this.survival.getSelectedStack();
    const food = held.item?.food;
    if (food && (this.survival.hunger < 20 || food.canAlwaysEat)) {
      this.survival.food.eatProperties(food.nutrition, food.saturation);
      if (this.options.gamemode !== 'creative') this.survival.inventory.removeFromSelected(false);
      this.player.swingHand();
      this.useCooldown = 32;
      return;
    }
    this.useCooldown = 4;
    this.player.swingHand();
    const hit = this.raycast();
    if (!hit) return;
    // Vanilla PlayerGameMode.useItemOn: an interactive block consumes the right click before item
    // placement (unless the player is sneaking, which keeps the old "place against it" behaviour).
    const targetBlock = this.mc.blockOf(this.level.getBlockState(hit.x, hit.y, hit.z)).name;
    if (!this.player.sneaking && isContainerBlock(targetBlock)) {
      this.openBlockContainer(targetBlock, hit.x, hit.y, hit.z);
      return;
    }
    const heldBlock = this.survival.getSelectedStack();
    if (!heldBlock || heldBlock.isEmpty() || !heldBlock.item || !heldBlock.item.block) return;
    const item = heldBlock.item;
    const ctx: PlacementContext = {
      x: hit.x, y: hit.y, z: hit.z,
      face: hit.face,
      hitX: hit.point.x, hitY: hit.point.y, hitZ: hit.point.z,
      yaw: this.player.yaw,
      pitch: this.player.pitch,
      heldBlockName: item.block,
      // BlockItem.canPlace -> Level.isUnobstructed: entity collision shapes block placement
      isUnobstructed: (state, x, y, z) => this.isUnobstructed(state, x, y, z),
      // client redstone is not simulated (vanilla Level.hasNeighborSignal is a server-side query)
      hasNeighborSignal: () => false,
    };
    const plan = placeBlock(this.mc, this.level, item.block, ctx);
    if (!plan) return;
    this.sounds.play(`${this.blockSoundBase(this.level.getBlockState(plan.x, plan.y, plan.z))}.place`, plan.x + 0.5, plan.y + 0.5, plan.z + 0.5, 1, 0.8);
    this.updateNeighbors(plan.x, plan.y, plan.z);
    for (const extra of plan.extras) this.updateNeighbors(extra.x, extra.y, extra.z);
    if (this.options.gamemode !== 'creative') this.survival.inventory.removeFromSelected(false);
  }

  /**
   * Vanilla Level.isUnobstructed(BlockState, BlockPos, CollisionContext) (EntityGetter.java:33):
   * an entity that blocks building — a LivingEntity (player or mob), not an item entity — inside
   * the collision shape prevents the placement. Only visible with CollisionContext.placementContext
   * from BlockItem.canPlace; that is why the old code could put blocks into the player.
   */
  private isUnobstructed(state: number, x: number, y: number, z: number): boolean {
    const shapes = this.mc.collision(state);
    if (shapes.length === 0) return true;
    const blockedBy = (bb: AABB): boolean => shapes.some((s) => s.move(x, y, z).intersects(bb));
    if (blockedBy(this.player.boundingBox())) return false;
    for (const e of this.entityManager.getEntities()) {
      // Entity.blocksBuilding defaults to false; LivingEntity sets it true (LivingEntity.java:291).
      // Arrows, XP orbs and item entities therefore do not block placement (vanilla behaviour).
      if (!(e instanceof LivingEntity) || e.isRemoved()) continue;
      if (blockedBy(e.getBoundingBox())) return false;
    }
    return true;
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
    if (this.options.gamemode !== 'creative') return;
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

    this.syncTouchUi();
    this.render(this.accum / TICK_MS);
    requestAnimationFrame(this.frame);
  };

  private daylightCycle = true;

  /** Adds one line to the chat HUD (also used by /commands and system messages). */
  addChatLine(text: string): void {
    const parts = text.split(String.fromCharCode(10));
    for (const part of parts) this.chatLines.push({ text: part, time: performance.now() });
    const overflow = this.chatLines.length - 100;
    if (overflow > 0) this.chatLines.splice(0, overflow);
  }

  /** What the chat commands (/time, /weather, /tp ...) are allowed to touch. */
  private commandHost(): CommandHost {
    return {
      getTime: () => this.level.time,
      setTime: (t) => { this.level.time = t; },
      setWeather: (kind) => {
        this.setRain(-1); // hand control back to the weather simulation
        // ServerLevel.setWeatherParameters: the state lasts for the given time, then the normal cycle toggles it
        const raining = kind !== 'clear', thundering = kind === 'thunder';
        this.level.setWeatherState({
          raining, thundering,
          rainTime: raining ? 6000 : 12000, thunderTime: thundering ? 6000 : 12000,
        });
      },
      setGameMode: (m) => { this.options.gamemode = m; this.survival.gamemode = m; },
      teleport: (x, y, z) => { this.player.pos.x = x; this.player.pos.y = y; this.player.pos.z = z; this.player.vel.x = 0; this.player.vel.y = 0; this.player.vel.z = 0; },
      position: () => ({ x: this.player.pos.x, y: this.player.pos.y, z: this.player.pos.z }),
      give: (item, count) => {
        const def = this.survival.registry.byName(item);
        if (!def) return false;
        return this.survival.inventory.add(new ItemStack(def, count));
      },
      summon: (type, x, y, z) => this.entityManager.spawn(type, x, y, z) !== null,
      killMobs: () => {
        let n = 0;
        for (const e of this.entityManager.getEntities()) {
          if (e instanceof LivingEntity && !e.isRemoved() && e.getTypeName() !== 'player') { e.remove(); n++; }
        }
        return n;
      },
      setDaylightCycle: (on) => { this.daylightCycle = on; },
    };
  }

  private tick(): void {
    this.tickCount++;
    // A TitleScreen (however it was opened: boot, pause -> quit, death screen) owns the client;
    // vanilla has no level ticking on the title screen, so stop the world tick and pause autosave.
    if (this.isTitleOpen() && this.worldActive) this.enterMenuMode();
    if (!this.worldActive) return;
    this.level.tick(1, this.daylightCycle); // one game tick (was 1/20, which made a day last 20x too long)

    // Autosave resumes as soon as the last menu closes (E / Esc / a GUI button all go through
    // ScreenManager, so watching the transition is more reliable than hooking every path).
    const screenOpen = this.screens.current !== null;
    if (screenOpen !== this.screenWasOpen) {
      this.screenWasOpen = screenOpen;
      if (!screenOpen) this.autosave?.resume();
    }

    // Touch overlay (Bedrock style): joystick + look pad + held buttons feed the same PlayerInput
    // fields as the keyboard. The look pad writes yaw/pitch exactly like the mouse delta does.
    const touch = this.touchEnabled ? this.touch : undefined;
    let touchForward = 0;
    let touchStrafe = 0;
    let touchJump = false;
    let touchSneak = false;
    let touchSprint = false;
    let touchFlyUp = false;
    let touchFlyDown = false;
    if (touch) {
      const look = touch.consumeLook();
      if (look.dx || look.dy) {
        // Camera right is (-cos(yaw), sin(yaw)): decreasing yaw turns toward screen-right.
        this.player.yaw -= look.dx * 0.15;
        this.player.pitch = Math.max(-90, Math.min(90, this.player.pitch + look.dy * 0.15));
      }
      if (touch.consumeJumpPressed()) {
        const now = performance.now();
        if (now - this.lastTouchJump < 320 && this.options.gamemode === 'creative') {
          this.player.flying = !this.player.flying;
          this.player.vel.y = 0;
        }
        this.lastTouchJump = now;
      }
      const move = touch.getMove();
      touchForward = move.y;
      touchStrafe = move.x;
      touchJump = touch.isJumpHeld();
      touchSneak = touch.isSneakHeld();
      touchSprint = touch.isSprintHeld();
      touchFlyUp = touch.isFlyUpHeld();
      touchFlyDown = touch.isFlyDownHeld();
    }
    const clampAxis = (v: number): number => (v > 1 ? 1 : v < -1 ? -1 : v);
    const input: PlayerInput = {
      forward: clampAxis((this.keys.has('KeyW') ? 1 : 0) - (this.keys.has('KeyS') ? 1 : 0) + touchForward),
      strafe: clampAxis((this.keys.has('KeyD') ? 1 : 0) - (this.keys.has('KeyA') ? 1 : 0) + touchStrafe),
      jump: this.keys.has('Space') || touchJump || (this.player.flying && touchFlyUp),
      sneak: this.keys.has('ShiftLeft') || this.keys.has('ShiftRight') || touchSneak
        || (this.player.flying && touchFlyDown),
      sprint: this.keys.has('ControlLeft') || this.sprintTap || touchSprint,
      jumpPressed: false,
    };
    const wasOnGround = this.player.onGround;
    const fallDistanceBefore = this.player.fallDistance;
    this.player.tick(this.level, input);

    // Fall damage: LivingEntity.causeFallDamage runs when a falling entity lands. Player.tick
    // resets fallDistance on the landing tick, so use the value accumulated before the move.
    if (!this.survival.isDead && !wasOnGround && this.player.onGround && !this.player.flying && !this.player.inWater) {
      const fall = Math.max(fallDistanceBefore, this.player.fallDistance);
      if (fall > 0) this.survival.fallDamage(fall);
    }

    if (this.attackCooldown > 0) this.attackCooldown--;
    if (this.useCooldown > 0) this.useCooldown--;
    if (this.itemNameTimer > 0) this.itemNameTimer--;

    // survival: health/hunger/XP + inventory cooldowns
    this.survival.gamemode = this.options.gamemode;
    const inLava = this.playerInLava();
    if (inLava) this.playerFireTicks = 300;
    else if (this.player.inWater) this.playerFireTicks = Math.max(0, this.playerFireTicks - 4);
    else if (this.playerFireTicks > 0) this.playerFireTicks--;
    const moved: PlayerMoved = {
      sprint: this.player.sprinting,
      jumped: input.jump && this.player.onGround,
      swam: this.player.inWater,
      underwater: this.playerEyeInWater(),
      inLava,
    };
    this.survival.tick(moved);
    this.survival.tickEnvironment(inLava, this.player.inWater, this.playerFireTicks > 0);
    // Container GUIs: open furnace menus cook one tick and mirror their progress into the screen.
    this.tickActiveMenu();
    this.syncFurnaceScreen();

    // mining progress (BlockBreaking); replaces the hand-written breakProgress loop
    this.updateMining();
    // first-person animations (swing / equip / bob) advance on the same 20 Hz clock
    this.handRenderer.tick(this.player, this.survival);
    this.playStepSound();

    this.particles.tick();
    this.ambientParticles.tick(this.level, this.player.pos.x, this.player.eyeY, this.player.pos.z);
    const cam = {
      x: this.player.pos.x, y: this.player.eyeY, z: this.player.pos.z,
      yaw: this.player.yaw, pitch: this.player.pitch,
      fov: this.options.fov, aspect: this.glCanvas.width / this.glCanvas.height,
    };
    this.weatherRenderer.tick(cam, this.levelLike, 1);
    this.sounds.tick(cam, this.levelLike);
    this.tickAudioEvents();
    this.tickCaveAmbience();

    // keep the ring of chunks around the player loaded; generation happens on the workers and
    // finished chunks are applied here under a time budget
    this.ensureChunksAround();
    this.chunkProvider.drain(this.level, 6);
    // ...and drop the chunks that fell out of the retention band behind us (vanilla
    // ClientChunkCache), so a long trip does not keep the whole visited world in memory
    this.unloadFarChunks();

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
      // ItemEntity.playerTouch: ENTITY_ITEM_PICKUP volume 0.2, pitch (random - random) * 1.4 + 2 (clamped by the engine)
      this.sounds.play('entity.item.pickup', p.x, p.y, p.z, 0.2, 1.6 + Math.random() * 0.4);
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

  /**
   * Port of ClientChunkCache.dropOutOfRangeChunks / calculateStorageRange: chunks farther than
   * renderDistance + CHUNK_RETAIN_MARGIN are dropped, the margin being the vanilla hysteresis band
   * that stops walking back and forth over a chunk border from thrashing the cache.
   *
   * Order matters: dirty chunks are handed to the save layer first (flushDirty clears
   * LevelChunk.dirtySections synchronously while it serializes, so a dirty chunk that missed this
   * call's 16-chunk batch is simply kept until the next tick), then the clean far chunks are
   * removed, their sections pruned from the renderer and their mobs unloaded.
   * Chunks the player has edited are pinned inside ClientLevel.unloadFarChunks(): there is no
   * save-first chunk load path yet, so regenerating one from the seed would show stale terrain.
   */
  private unloadFarChunks(): void {
    const pcx = Math.floor(this.player.pos.x) >> 4;
    const pcz = Math.floor(this.player.pos.z) >> 4;
    const retain = this.options.renderDistance + CHUNK_RETAIN_MARGIN;
    if (this.level.countChunksOutside(pcx, pcz, retain) === 0) return; // fast path, no allocation
    if (this.saveManager && this.level.hasDirtyChunksOutside(pcx, pcz, retain)) {
      // One flush in flight at most: flushDirty serializes up to 16 chunks synchronously before its
      // await, so calling it every tick while a teleport leaves hundreds of never-persisted chunks
      // behind would stack that serialization on the main thread and stall the frame.
      if (!this.chunkFlushPending) {
        this.chunkFlushPending = true;
        void this.saveManager.flushDirty(this.level, this.player, 4)
          .catch(() => {})
          .finally(() => { this.chunkFlushPending = false; });
      }
    }
    const removed = this.level.unloadFarChunks(pcx, pcz, retain);
    if (removed.length === 0) return;
    for (const c of removed) this.entityManager.unloadChunk(c.x, c.z);
    this.renderer.prune(this.player.pos.x, this.player.pos.z, this.level);
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
    // resizing the backing store resets 2D context state
    this.guiCtx.imageSmoothingEnabled = false;
    this.gl.viewport(0, 0, this.glCanvas.width, this.glCanvas.height);
    this.renderer?.resize(this.glCanvas.width, this.glCanvas.height);
    this.screens?.resize(w, h);
    this.touch?.updateMetrics(this.guiScale);
  }

  get guiScale(): number {
    const forced = this.options.guiScale > 0 ? this.options.guiScale : 0;
    const auto = calcGuiScale(this.glCanvas.width, this.glCanvas.height, forced, false);
    // OpusMC uses 3x GUI pixels on phones; vanilla's auto scale picks 2 on a 390 px-wide device.
    // Three matches the reference screenshots and makes slot/font lines one CSS pixel, not 1.5.
    return this.touchDevice && auto < 3 ? 3 : auto;
  }

  private render(partial: number): void {
    const gl = this.gl;
    // Time of day timeline (Timelines.OVERWORLD_DAY) + weather attribute layers +
    // per-biome visual attributes. `options.brightness` is the vanilla gamma slider
    // (LightmapRenderStateExtractor.java:68 -> core/lightmap.fsh BrightnessFactor).
    const biomeName = this.generator.biomeName(
      this.level.getBiome(Math.floor(this.player.pos.x), Math.floor(this.player.pos.y), Math.floor(this.player.pos.z)),
    );
    const skyState = computeSkyState(this.level.time + partial, this.options.brightness, {
      rainLevel: this.level.getRainLevel(),
      thunderLevel: this.level.getThunderLevel(),
      biomeName,
    });
    this.sky = skyState;

    const lightmap = buildLightmap(skyState, this.lightmapData);
    // Every SkyState field the lightmap formula reads must be part of the cache key.
    const key = [
      skyState.skyFactor.toFixed(3),
      skyState.skyLightColor.map((v) => v.toFixed(3)).join(','),
      skyState.blockLightTint.map((v) => v.toFixed(3)).join(','),
      skyState.ambientColor.map((v) => v.toFixed(3)).join(','),
      skyState.nightVisionIntensity.toFixed(3),
      skyState.nightVisionColor.map((v) => v.toFixed(3)).join(','),
      skyState.darknessScale.toFixed(3),
      skyState.bossOverlayWorldDarkening.toFixed(3),
      skyState.brightness.toFixed(3),
    ].join('|');
    this.textures.updateLightmap(lightmap, key);
    this.textures.animate(this.level.time);

    // Vanilla renders between ticks: lerp(prevPos, pos, partialTick). Without this the
    // camera steps at 20 Hz and movement judders even at high frame rates.
    const p = this.player.pos;
    const pp = this.player.prevPos;
    const eyeY = this.player.eyeY;
    const camera: Camera = {
      x: pp.x + (p.x - pp.x) * partial,
      y: pp.y + (p.y - pp.y) * partial + (eyeY - p.y),
      z: pp.z + (p.z - pp.z) * partial,
      yaw: this.player.yaw,
      pitch: this.player.pitch,
      fov: this.options.fov * (this.player.sprinting ? 1.1 : 1) * (this.zooming ? 0.25 : 1),
      aspect: this.glCanvas.width / this.glCanvas.height,
    };

    gl.viewport(0, 0, this.glCanvas.width, this.glCanvas.height);
    gl.clearColor(skyState.fogColor[0], skyState.fogColor[1], skyState.fogColor[2], 1);
    gl.clear(gl.COLOR_BUFFER_BIT | gl.DEPTH_BUFFER_BIT);

    // Everything below this line is drawn into the HDR scene target when shaders are on.
    // Off mode binds nothing, so this is the exact pre-shader code path (pixel identical).
    this.renderer.beginScene();

    // chunks are rebuilt lazily; do it before drawing
    this.renderer.update(this.level, camera.x, camera.z, 6);

    // Sky / clouds replace LevelRenderer.renderSky(): the old pass is NOT called any more, so the
    // sky is drawn exactly once. They use the matrices of the previous frame (renderer.render()
    // below is what refreshes them); a 16 ms stale camera basis is invisible at infinite distance.
    // NOTE: SkyRenderer's timeOfDay is `dayTime / 24000` (0 = sunrise, .25 = noon). That is *not*
    // ClientLevel.getTimeOfDay(), which is phase-shifted by -0.75 (0 = midnight), so convert.
    const skyPhase = (((this.level.time % DAY_LENGTH) + DAY_LENGTH) % DAY_LENGTH) / DAY_LENGTH;
    // FogRenderer#setupFog: FogData.skyEnd = min(renderDistanceBlocks, SKY_FOG_END_DISTANCE).
    this.skyRenderer.skyFogEnd = Math.min(skyState.skyFogEndDistance, this.renderer.renderDistance * 16);
    this.skyRenderer.render(
      this.renderer.viewMatrix,
      this.renderer.projection,
      skyPhase,
      camera,
      this.level.getRainLevel(),
      this.levelLike,
    );
    this.cloudRenderer.render(this.renderer.viewProjection, camera, this.level.time, this.levelLike);

    // Vanilla order: solid/cutout terrain -> entities -> particles -> block breaking ->
    // translucent water. Water is drawn last so it tints and hides submerged entities
    // instead of being painted underneath them.
    this.renderer.render(this.level, camera, skyState, partial, () => {

      // entities: viewProjection is refreshed by renderer.render() above
      // (mobs package) hand the entity pass the shared lightmap + fog so mobs are
      // lit/fogged exactly like the terrain they stand on.
      this.entityRenderer.setEnvironment(this.textures.lightmap, skyState, this.renderer.renderDistance);
      this.entityRenderer.render(
        this.entityManager.getEntities(),
        this.renderer.viewProjection,
        { x: camera.x, y: camera.y, z: camera.z },
        partial,
      );

      // particles after the entities, weather over everything (vanilla order)
      this.particles.render(this.renderer.viewProjection, partial);

      // Block breaking decal (net.minecraft.client.renderer.LevelRenderer#submitBlockDestroyAnimation):
      // progress comes from SurvivalState.breaking (08-regression issue 4) and the stage is
      // floor(progress * 10). `breakingDemo` is the screenshot harness override.
      const hit = this.raycast();
      if (hit) {
        const progress = this.breakingDemo > 0
          ? this.breakingDemo
          : (this.mining && (this.mouseLocked || this.touchEnabled) ? this.survival.breaking.progress : 0);
        if (progress > 0) {
          const state = this.level.getBlockState(hit.x, hit.y, hit.z);
          if (state !== 0) {
            this.breakingOverlay.render(this.level, camera, this.renderer.viewProjection, hit, state, progress);
          }
        }
      }
    });

    // Weather uses the particle pipeline: lightmap-sampled light coords + environmental fog.
    this.weatherRenderer.lightmap = this.textures.lightmap;
    this.weatherRenderer.render(this.renderer.viewProjection, camera, this.level.time, this.levelLike, {
      start: skyState.fogStartDistance,
      end: skyState.fogEndDistance,
      color: skyState.fogColor,
    });

    const outlineHit = this.raycast();
    if (outlineHit && (this.mouseLocked || this.touchEnabled)) {
      const state = this.level.getBlockState(outlineHit.x, outlineHit.y, outlineHit.z);
      const hit = outlineHit;
      // LevelRenderer#submitHitOutline: ARGB.black(102) => rgba(0, 0, 0, 0.4), and the *whole*
      // outline VoxelShape is drawn (every box, not just the first one).
      for (const b of this.mc.outline(state)) {
        this.renderer.drawSelection(hit.x + b.minX, hit.y + b.minY, hit.z + b.minZ, hit.x + b.maxX, hit.y + b.maxY, hit.z + b.maxZ);
      }
    }

    // GameRenderer#renderLevel: the hand is drawn last, with its own hud projection (FOV 70) and
    // a cleared depth buffer, then ScreenEffectRenderer's underwater overlay. The depth-based post
    // passes (SSAO/TAA) need the world depth, so snapshot it before the hand pass wipes the buffer:
    // TAA therefore treats the hand as disoccluded (always current frame) and never ghosts it.
    this.renderer.captureDepthForPost();
    if (this.screens.current === null) {
      this.handRenderer.render(partial, camera, this.player, this.level, this.survival);
    }

    // Resolve the HDR frame (SSAO + TAA -> bloom -> tonemap -> FXAA) into the default framebuffer.
    this.renderer.endScene();

    this.renderHud();

    // Screens last: ScreenManager clears the GUI canvas (vanilla hides the HUD while a menu is up).
    this.screens.render(partial);
  }

  /** HudState assembly + canvas setup. Layout itself lives in gui/Hud.ts (Hud.java port). */
  private renderHud(): void {
    const ctx = this.guiCtx;
    const scale = this.guiScale;
    ctx.setTransform(1, 0, 0, 1, 0, 0);
    ctx.clearRect(0, 0, this.guiCanvas.width, this.guiCanvas.height);
    // Window#setGuiScale: logical units are framebuffer pixels / scale, so the transform is
    // exactly `scale` (not dpr * scale).
    ctx.setTransform(scale, 0, 0, scale, 0, 0);
    const size = guiScaledSize(this.guiCanvas.width, this.guiCanvas.height, scale);
    const w = size.width;
    const h = size.height;

    // survival.airSupply / maxAirSupply / armorValue exist since the survival package landed; the
    // optional cast only covers fields that may still be missing (absorption / status effects).
    const ext = this.survival as unknown as HudSurvivalExtensions;
    const toSlot = (s: ItemStack): HudItemSlot => ({
      item: s.item ? s.item.id : -1,
      count: s.getCount(),
      damage: s.getDamageValue(),
      maxDamage: s.getMaxDamage(),
      popTime: s.getPopTime(),
    });
    const offhandStack = this.survival.inventory.getItem(SLOT_OFFHAND);
    const offhand = offhandStack.isEmpty() ? null : toSlot(offhandStack);

    const state: HudState = {
      // Player.getHealth() is in half-hearts (20 = full); HudState keeps the vanilla unit.
      hearts: Math.max(0, Math.ceil(this.survival.health)),
      maxHearts: this.survival.maxHealth,
      absorption: ext.absorption ?? 0,
      heartKind: ext.heartKind ?? 'normal',
      hardcore: ext.hardcore ?? false,
      hunger: this.survival.hunger,
      saturation: this.survival.saturation,
      hungerEffect: ext.hungerEffect ?? false,
      // Entity.getAirSupply() / getMaxAirSupply(): 300 = full, and 300 hides the bubbles.
      air: this.survival.airSupply,
      airMax: this.survival.maxAirSupply,
      underwater: this.playerEyeInWater(),
      armor: this.survival.armorValue,
      xpProgress: this.survival.experience,
      xpLevel: this.survival.level,
      hotbar: this.survival.hotbarStacks().map(toSlot),
      offhand,
      offhandLeft: true, // main arm RIGHT -> offhand arm LEFT (HumanoidArm.getOpposite)
      selectedSlot: this.selectedSlot,
      itemNameTimer: this.itemNameTimer,
      itemName: this.itemName,
      ...this.buildDebugColumns(),
      showDebug: this.showDebug,
      fps: this.fps,
      gamemode: this.options.gamemode,
      tickCount: this.tickCount,
    };

    this.hud.render(ctx, state, w, h, (c, item, x, y, size) => {
      this.icons.draw(c, item, x, y, size);
    });
    this.renderChatLog(ctx, w, h);
  }

  /**
   * ChatHud.render: the last lines sit above the hotbar with a 20% black backdrop and fade out
   * after 10s. Command feedback used to go to a toast in the corner, which is not where vanilla
   * players look.
   */
  private renderChatLog(ctx: CanvasRenderingContext2D, _w: number, h: number): void {
    const now = performance.now();
    const fresh = this.chatLines.filter((l) => now - l.time < 10000);
    if (fresh.length === 0) return;
    const newest = fresh[fresh.length - 1];
    const alpha = Math.min(1, Math.max(0, (10000 - (now - newest.time)) / 500));
    let y = h - 46;
    for (let i = fresh.length - 1; i >= 0 && y > 8; i--) {
      const line = fresh[i];
      const lineAlpha = Math.min(alpha, Math.min(1, Math.max(0, (10000 - (now - line.time)) / 500)));
      const width = this.font.width(line.text);
      ctx.globalAlpha = lineAlpha * 0.35;
      ctx.fillStyle = '#000000';
      ctx.fillRect(1, y - 1, width + 2, 9);
      ctx.globalAlpha = 1;
      this.font.draw(ctx, line.text, 2, y, '#ffffff', true, lineAlpha);
      y -= 9;
    }
  }

  /**
   * The F3 screen. Format strings and the left/right split are copied from
   * net.minecraft.client.gui.components.DebugScreenOverlay + DebugScreenEntries (26.2): entries are
   * visited in Identifier path order, priority lines alternate columns, plain lines and groups are
   * split in half. 26.2's DEFAULT profile only enables 9 entries (all IN_OVERLAY); biome/light/entity
   * stats are enabled here because TASK-hud requires them (vanilla toggles them in the debug options).
   */
  private glInfoCache?: { vendor: string; gpu: string; glVersion: string };

  private buildDebugColumns(): Pick<HudState, 'debugLeft' | 'debugRight'> {
    const pos = this.player.pos;
    const feetX = Math.floor(pos.x);
    const feetY = Math.floor(pos.y);
    const feetZ = Math.floor(pos.z);
    const chunkX = feetX >> 4;
    const chunkZ = feetZ >> 4;
    // Mth.wrapDegrees(float)
    const wrapDegrees = (deg: number): number => {
      let f = deg % 360;
      if (f >= 180) f -= 360;
      if (f < -180) f += 360;
      return f;
    };
    const pad2 = (v: number): string => (v < 10 ? `0${v}` : String(v));
    // The clone's yaw is mirrored vs vanilla (cameraBasis forward = (sin yaw, ., cos yaw)); vanilla
    // displays -yaw so that Direction.fromYRot lines up again.
    const yaw = wrapDegrees(-this.player.yaw);
    const pitch = wrapDegrees(this.player.pitch);
    const facing = ['south', 'west', 'north', 'east'][Math.floor((yaw + 8) / 90) & 3];

    const sky = this.level.getSkyLight(feetX, feetY, feetZ);
    const block = this.level.getBlockLight(feetX, feetY, feetZ);
    const rawBrightness = this.level.getBrightness(feetX, feetY, feetZ);
    const biome = this.generator.biomeName(this.level.getBiome(feetX, feetY, feetZ));
    // DebugEntryBiome prints `biome.unwrapKey().identifier()` — already namespaced.
    const biomeId = biome.includes(':') ? biome : `minecraft:${biome}`;
    const entities = this.entityManager.getEntities();
    const stats = this.renderer.meshStats;
    // gl.getParameter is a synchronous driver call and these strings never change: query once.
    this.glInfoCache ??= {
      vendor: String(this.gl.getParameter(this.gl.VENDOR) ?? ''),
      gpu: String(this.gl.getParameter(this.gl.RENDERER) ?? ''),
      glVersion: String(this.gl.getParameter(this.gl.VERSION) ?? ''),
    };
    const { vendor, gpu, glVersion } = this.glInfoCache;
    const target = this.raycast(20);
    const targetLines: string[] = [];
    if (target) {
      targetLines.push(`准星方块: ${target.x}, ${target.y}, ${target.z}`);
      const blockName = this.mc.blockOf(this.level.getBlockState(target.x, target.y, target.z)).name;
      const blockKey = `block.minecraft.${blockName}`;
      const blockLabel = DEFAULT_I18N.get(blockKey);
      targetLines.push(blockLabel !== blockKey ? blockLabel : `minecraft:${blockName}`);
    }

    const biomeKey = `biome.${biomeId.replace(':', '.')}`;
    const biomeLabel = DEFAULT_I18N.get(biomeKey);
    const facingZh = { south: '南', west: '西', north: '北', east: '东' }[facing] ?? facing;
    const entries: DebugEntryOutput[] = [
      // biome
      { lines: [`生物群系: ${biomeLabel !== biomeKey ? biomeLabel : biomeId}`] },
      // chunk_generation_stats
      { lines: [`生成: ${this.chunkProvider.usingWorkers ? `${this.chunkProvider.workerCount} 线程` : '同步'} 队列 ${this.chunkProvider.queueLength} 进行中 ${this.chunkProvider.inflight}`] },
      // chunk_render_stats (LevelExtractor.sectionStatistics: "C: rendered/total ... D: distance, stats")
      { lines: [`渲染区块: ${stats.sections} 视距: ${this.options.renderDistance}, ${stats.ms.toFixed(1)} ms`] },
      // chunk_source_stats
      { lines: [`区块源: ${this.level.chunks.size} 个区块, 队列 ${this.chunkProvider.queueLength}`] },
      // day_count
      { lines: [`第 ${Math.floor(this.level.time / 24000) + 1} 天`] },
      // entity_render_stats (LevelExtractor.entityStatistics: "E: rendered/total, SD: n")
      { lines: [`实体: ${this.entityRenderer.lastDrawCallCount}/${entities.length}`] },
      // fps (DebugEntryFps: "%d fps T: %s%s"; limit 260 prints "inf", no present mode in a browser)
      { priority: [`${this.fps} 帧/秒`] },
      // game_version (DebugEntryVersion)
      { priority: ['Minecraft 26.2 (网页二创版)'] },
      // light_levels (DebugEntryLight)
      { groups: [{ id: 'light', lines: [`客户端光照: ${rawBrightness} (天空 ${sky}, 方块 ${block})`] }] },
      // looking_at_block_state (DebugEntryLookingAt.BlockStateInfo, pick(20))
      { groups: [{ id: 'looking_at_block', lines: targetLines }] },
      // player_position (DebugEntryPosition)
      {
        groups: [{
          id: 'position',
          lines: [
            `坐标: ${pos.x.toFixed(3)} / ${pos.y.toFixed(5)} / ${pos.z.toFixed(3)}`,
            `方块: ${feetX} ${feetY} ${feetZ}`,
            `区块: ${chunkX} ${feetY >> 4} ${chunkZ} [${chunkX & 31} ${chunkZ & 31} 于 r.${chunkX >> 5}.${chunkZ >> 5}.mca]`,
            `朝向: ${facingZh} (${yaw.toFixed(1)} / ${pitch.toFixed(1)})`,
            'minecraft:overworld FC: 0',
          ],
        }],
      },
      // player_section_position
      {
        groups: [{
          id: 'position',
          lines: [`section 内坐标: ${pad2(feetX & 15)} ${pad2(feetY & 15)} ${pad2(feetZ & 15)}`],
        }],
      },
      // simple_performance_impactors
      { lines: ['华丽云: 关', '过滤: 无'] },
      // system_specs (DebugEntrySystemSpecs)
      {
        groups: [{
          id: 'system',
          lines: [
            `显示: ${this.glCanvas.width}x${this.glCanvas.height} (${vendor})`,
            `GPU: ${gpu}`,
            `GL: ${glVersion}`,
          ],
        }],
      },
    ];

    const { left, right } = layoutDebugScreen(entries);
    return { debugLeft: left, debugRight: right };
  }
}

/** Blocks that open a container GUI on right click (PlayerGameMode.useItemOn). */
function isContainerBlock(blockName: string): boolean {
  return blockName === 'crafting_table' || blockName === 'chest'
    || blockName === 'trapped_chest' || blockName === 'furnace';
}

/**
 * Vanilla seed parsing (WorldOptions): a decimal/hex number when the text is numeric, otherwise
 * Java's String.hashCode. Kept in sync with WorldSaveManager.parseSeed, but as a bigint so a
 * 64-bit seed survives the URL round-trip byte for byte.
 */
function parseSeedBig(value: string | number): bigint {
  const text = typeof value === 'number' ? String(Math.trunc(value)) : value.trim();
  if (/^[+-]?\d+$/.test(text)) {
    try { return BigInt(text); } catch { /* fall through to the hash */ }
  }
  let hash = 0;
  for (let i = 0; i < text.length; i++) hash = (Math.imul(31, hash) + text.charCodeAt(i)) | 0;
  return BigInt(hash);
}
