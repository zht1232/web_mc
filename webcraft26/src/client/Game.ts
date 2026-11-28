// The client glue: owns the canvas, the level, the player, the render loop and input.
// Structure follows Minecraft.runTick / GameRenderer.render.

import { MinecraftData, setMinecraftData } from '../vanilla/world/level/block/state/BlockState.js';
import { ClientLevel, CHUNK_RETAIN_MARGIN, DAY_LENGTH } from '../vanilla/world/level/ClientLevel.js';
import { LevelChunk } from '../vanilla/world/level/chunk/LevelChunk.js';
import { Player, TICK_MS, JUMP_VELOCITY, type PlayerInput } from '../vanilla/world/entity/player/Player.js';
import { ModelSource } from './renderer/model/ModelSource.js';
import { TextureManager } from './renderer/TextureManager.js';
import { BiomeColors } from './renderer/BiomeColors.js';
import { LevelRenderer, redstoneWireTint, type Camera } from './renderer/LevelRenderer.js';
import { FramePacer } from './FramePacer.js';
import { LevelChunk as Chunk } from '../vanilla/world/level/chunk/LevelChunk.js';
import { buildLightmap, computeSkyState, DAY_PERIOD, type SkyState } from './EnvironmentLighting.js';
import { FontRenderer } from './gui/FontRenderer.js';
import { DEFAULT_I18N } from './gui/Language.js';
import { calcGuiScale, guiScaledSize } from './gui/GuiScale.js';
import {
  GuiTextures, Hud, HUD_SPRITES, MOB_EFFECT_TEXTURES, layoutDebugScreen,
  type DebugEntryOutput, type HudItemSlot, type HudState, type HudSurvivalExtensions,
} from './gui/Hud.js';
import { ItemIconAtlas } from './gui/ItemIconAtlas.js';
import { AABB, Vec3, chunkKey } from '../vanilla/core/Geometry.js';
import { placeBlock, survivesAt, type PlacementContext } from './interaction/Placement.js';
import { NoiseChunkGenerator, loadWorldgenData } from '../vanilla/world/level/levelgen/NoiseChunkGenerator.js';
import { ChunkProvider } from './world/ChunkProvider.js';
import {
  findSpawnSpot as selectSpawnSpot, refineSpawnColumn, isTreeBlock,
} from './world/SpawnSelector.js';
import { EntityManager } from '../vanilla/world/entity/EntityManager.js';
import { setSpawnBlockTags } from '../vanilla/world/entity/SpawnPlacements.js';
import { ExperienceOrb } from '../vanilla/world/entity/ExperienceOrb.js';
import { Arrow } from '../vanilla/world/entity/projectile/Arrow.js';
import { FishingBobber } from '../vanilla/world/entity/projectile/FishingBobber.js';
import { ThrownEgg } from '../vanilla/world/entity/projectile/ThrownEgg.js';
import { ThrownPotion } from '../vanilla/world/entity/projectile/ThrownPotion.js';
import { AreaEffectCloud } from '../vanilla/world/entity/AreaEffectCloud.js';
import { RedstoneSystem } from '../vanilla/world/redstone/RedstoneSystem.js';
import type { Entity, Targetable } from '../vanilla/world/entity/Entity.js';
import { LivingEntity } from '../vanilla/world/entity/LivingEntity.js';
import { Mob } from '../vanilla/world/entity/Mob.js';
import { MobCategory } from '../vanilla/world/entity/MobCategory.js';
import { Sheep } from '../vanilla/world/entity/animal/Sheep.js';
import { Animal } from '../vanilla/world/entity/animal/Animal.js';
import { Wolf } from '../vanilla/world/entity/animal/Wolf.js';
import { Cat } from '../vanilla/world/entity/animal/Cat.js';
import { Villager } from '../vanilla/world/entity/npc/Villager.js';
import { WanderingTrader } from '../vanilla/world/entity/npc/WanderingTrader.js';
import { WanderingTraderSpawner } from '../vanilla/world/entity/npc/WanderingTraderSpawner.js';
import { WanderingTraderTrades } from '../vanilla/world/entity/npc/WanderingTraderTrades.js';
import { Llama } from '../vanilla/world/entity/animal/Llama.js';
import { TraderLlama } from '../vanilla/world/entity/animal/TraderLlama.js';
import { IronGolem } from '../vanilla/world/entity/animal/IronGolem.js';
import { VillagerTrades } from '../vanilla/world/entity/npc/VillagerTrades.js';
import { MerchantOffer, type MerchantOfferJSON } from '../vanilla/world/item/trading/MerchantOffer.js';
import { Minecart } from '../vanilla/world/entity/vehicle/Minecart.js';
import { Boat } from '../vanilla/world/entity/vehicle/Boat.js';
import { EntityRenderDispatcher } from './renderer/entity/EntityRenderDispatcher.js';
import { WorldItemRenderer } from './renderer/entity/WorldItemRenderer.js';
import { cameraBasis } from './renderer/gl/Gl.js';
import { argbFromRgb, computeFogColor } from './renderer/environment/FogState.js';
import { ENTITY_TYPES, isUndeadType } from '../vanilla/world/entity/EntityType.js';
import { ScreenManager } from './gui/ScreenManager.js';
import { TitleScreen } from './gui/screens/TitleScreen.js';
import { CreativeModeInventoryScreen } from './gui/screens/inventory/CreativeModeInventoryScreen.js';
import { TAB_SURVIVAL } from '../vanilla/world/inventory/CreativeInventory.js';
import type {
  ContainerMenuLike, CreateWorldOptions, GuiOptions, ScreenRef, WorldListProvider,
} from './gui/Types.js';
import { SurvivalState, loadWorldData, getWorldData, type PlayerMoved } from '../vanilla/gameplay/SurvivalState.js';
import { SLOT_OFFHAND } from '../vanilla/world/entity/player/Inventory.js';
import { ItemStack, type ItemComponents } from '../vanilla/world/item/ItemStack.js';
import { ItemEntity } from '../vanilla/world/entity/item/ItemEntity.js';
import { PrimedTnt } from '../vanilla/world/entity/item/PrimedTnt.js';
import { ContainerInput } from '../vanilla/world/inventory/ClickAction.js';
import type { AbstractContainerMenu } from '../vanilla/world/inventory/AbstractContainerMenu.js';
import type { Container } from '../vanilla/world/inventory/Container.js';
import { AbstractCraftingMenu } from '../vanilla/world/inventory/AbstractCraftingMenu.js';
import { AbstractFurnaceMenu } from '../vanilla/world/inventory/AbstractFurnaceMenu.js';
import { EnchantingMenu } from '../vanilla/world/inventory/EnchantingMenu.js';
import { BrewingMenu } from '../vanilla/world/inventory/BrewingMenu.js';
import { MerchantMenu } from '../vanilla/world/inventory/MerchantMenu.js';
import { potionEffects } from '../vanilla/world/item/potion/Potions.js';
import { Statistics } from '../vanilla/world/stats/Statistics.js';
import { SkyRenderer } from './renderer/environment/SkyRenderer.js';
import { CloudRenderer } from './renderer/environment/CloudRenderer.js';
import { WeatherRenderer } from './renderer/environment/WeatherRenderer.js';
import type { LevelLike } from './renderer/environment/EnvCommon.js';
import {
  ParticleEngine, spawnBlockBreakParticles, spawnExplosion, spawnHearts, spawnPotionCloudParticles,
} from './particle/ParticleEngine.js';
import { AmbientParticles } from './particle/AmbientParticles.js';
import { SoundEngine } from './audio/SoundEngine.js';
import { MobSounds } from './audio/MobSounds.js';
import { PerfLog } from './PerfLog.js';
import { runChatCommand, type CommandHost } from './ChatCommands.js';
import { WorldSaveManager, type LoadedWorld } from './world/save/WorldSaveManager.js';
import type { SavedPet, SavedVillager } from '../vanilla/world/level/storage/LevelSummary.js';
import type { SavedChunkEntity } from '../vanilla/world/level/storage/SavedChunkEntity.js';
import { AdvancementManager } from '../vanilla/world/advancements/AdvancementManager.js';
import { AdvancementToast } from './gui/components/Toast.js';
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
  /** Vanilla Options.FRAMERATE_LIMIT: upper bound for rendered frames per second. */
  maxFps: number;
  /** Temporal anti-aliasing (off by default: its jitter reads as distant shimmer). */
  taa: boolean;
  /** Adaptive 3D resolution; disable to keep a fixed sharpness. */
  dynamicResolution: boolean;
  /** Complementary-style waving foliage (off by default: constant motion). */
  vegetationSway: boolean;
  language: string;
  seed?: number;
  /** worker pool size override (defaults to min(hardwareConcurrency, 4)) */
  workers?: number;
}

/**
 * Ceiling for the 3D drawing buffer. It used to be 1080p, which forced a 78% upscale (blurry
 * blocks) on any 1.5x/2x DPI window wider than ~1400 CSS px even when the GPU had plenty of
 * headroom (a 3080 renders 3.4 MP at 162 fps). The dynamic-resolution loop still drops the scale
 * when frames are actually late, so a weak GPU pays the same low-res fallback as before.
 */
const MAX_RENDER_PIXELS = 2560 * 1440;

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
  // Options.java framerate limit default is 120; without this the browser renders
  // at the full refresh rate (165+ fps), which overheats laptops for no visible gain.
  maxFps: 120,
  taa: false,
  dynamicResolution: true,
  vegetationSway: false,
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
  wanderingTraderSpawner!: WanderingTraderSpawner;
  entityRenderer!: EntityRenderDispatcher;
  /** Dropped block items drawn with real 3D block models (GROUND display transform). */
  worldItemRenderer!: WorldItemRenderer;
  screens!: ScreenManager;
  survival!: SurvivalState;
  /** Vanilla player statistics (StatsCounter): mined/crafted/killed + custom counters. */
  readonly stats = new Statistics();
  /** Previous tick position for the distance statistics (walk/sprint/fly/swim/crouch). */
  private lastStatX = 0;
  private lastStatZ = 0;
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
  advancements!: AdvancementManager;
  autosave?: Autosave;
  private chunkCodec!: ChunkCodecOptions;

  options: GameOptions = { ...DEFAULT_OPTIONS };

  private running = false;
  private lastFrame = 0;
  /** Time accumulated since the last rendered frame (Options.FRAMERATE_LIMIT). */
  private renderAccum = 0;
  private lastRenderAt = 0;
  private accum = 0;
  private frames = 0;
  /** Recent chat/system lines, newest last (vanilla keeps 100). */
  private readonly chatLines: { text: string; time: number }[] = [];
  private fpsTimer = 0;
  private chunksAppliedThisFrame = 0;
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
  /** OpusMC-style frame pacer: measured, adaptive chunk/mesh budget. */
  private readonly pacer = new FramePacer();
  private frameChunkBudget = 6;
  private frameChunkMs = 0;
  /** Adaptive 3D resolution (1 = native, capped by MAX_RENDER_PIXELS). See adaptRenderScale. */
  private renderScale = 1;
  private maxRenderScale = 1;
  /**
   * 3D scene drawing size (viewport + projection aspect). With shaders on this is the HDR target
   * size, which is the only thing dynamic resolution may change; `glCanvas` itself is allocated
   * once per window size so the compositor never gets a reallocated (black) frame.
   */
  private targetW = 1;
  private targetH = 1;
  /** window.resize 事件计数（诊断：全屏切换会连续触发 resize）。 */
  resizeCount = 0;
  private resizeTimer = 0;
  private lastResizeKey = '';
  /** 上一帧的帧间隔（ms），用于 FOV 平滑。 */
  private lastDt = 16.7;
  /** 平滑后的 FOV：疾跑 / 缩放切换时投影不能一帧跳过去（表现为"视角抽动"）。 */
  private fovSmooth = -1;
  /** 最近 40 tick 的水平速度采样：跑跳时出现非碰撞原因的骤降会直接体现在 min/paused 上。 */
  private readonly hSpeedTrace = new Float32Array(40);
  private hSpeedIndex = 0;
  /** HUD 分项耗时（诊断 10fps：hotbar 图标 drawImage 曾出现 180ms/帧）。 */
  private hudMs = 0;
  /** HUD dirty tracking: the overlay only repaints when something visible actually changed. */
  private hudSignature = '';
  private hudValid = false;
  /** True while chat lines were visible last frame, so the first frame after they expire repaints. */
  private chatWasLive = false;
  /** Same handshake for toasts: one repaint is needed after the last one disappears. */
  private toastsWereActive = false;
  private chatMs = 0;
  /** 实测过撑不住的档位上限（随每次降档下移），用来给升档封顶、避免来回抖。 */
  private scaleCeiling = 1;
  private scaleQuiet = 0;
  private scaleProbeMs = 0;
  private scaleProbeFrames = 0;
  private scaleProbeMax = 0;
  /** 手机端性能采样器（仅在 URL 带 ?perf= 时创建，平时为 null，零开销）。 */
  perfLog: PerfLog | null = null;
  /** MouseHandler.accumulatedDX/DY: applied once per frame, not per pointermove event. */
  private pendingLookX = 0;
  private pendingLookY = 0;
  private lastJumpPress = 0;
  private lastWPress = 0;
  private sprintTap = false;
  private attackCooldown = 0;
  private useCooldown = 0;
  private bowCharging = false;
  private bowCharge = 0;
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
  /** Terrain generation kicked off early in init() and awaited just before the player is placed. */
  private spawnAreaPromise: Promise<void> | null = null;
  /** Chunk-set signature last handed to the entity manager (see syncEntityChunks). */
  private entityChunkKey = '';
  /** Serialized saved chunks (chunkKey -> NBT bytes) used to restore unloaded chunks. */
  private readonly savedChunkBytes = new Map<number, Uint8Array>();
  /** Every chunk the save holds (coords), including ones not read into memory yet. */
  private readonly savedChunkCoords = new Set<number>();
  /** Chunk keys with an IndexedDB read in flight (no duplicate fetches / generation). */
  private readonly pendingSavedChunks = new Set<number>();
  /**
   * World-level snapshots for entities deliberately excluded from chunk records
   * (villagers, tamed pets). Live entries are keyed by entity id; after a chunk
   * unload the entry stays with its last id and is respawned when the chunk
   * becomes active again, so saving while away no longer erases them.
   */
  private readonly villagerSnapshots = new Map<number, SavedVillager>();
  private readonly petSnapshots = new Map<number, SavedPet>();

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

    // Chunk workers fetch + parse their own copy of the block registry and worldgen data, which
    // takes ~400 ms on a cold HTTP cache. Starting the pool before the client assets means that
    // warm-up runs in parallel with everything below instead of stalling the first chunk request
    // (the loading screen used to sit at 0/25 for a third of a second for exactly this reason).
    this.onStatus?.('Starting chunk workers', 0.07);
    this.chunkProvider = new ChunkProvider(this.mc, this.seedBig, this.options.workers);
    void this.chunkProvider.init('/mc');

    this.onStatus?.('Loading models', 0.15);
    this.textures = new TextureManager(this.gl);
    this.font = new FontRenderer();
    this.guiTextures = new GuiTextures('/mc');
    // Models, textures, fonts, GUI sprites, worldgen tables and survival data are seven
    // independent fetches + parses. Loaded one after another they cost ~900 ms of the cold boot;
    // in one Promise.all the wall time is the slowest single load (~300 ms).
    this.onStatus?.('Loading client assets', 0.15);
    const [modelsRes, worldgen, worldData, advancements, , , jukeboxSongs] = await Promise.all([
      ModelSource.load('/mc'),
      loadWorldgenData('/mc'),
      loadWorldData('/mc'),
      AdvancementManager.load('/data'),
      VillagerTrades.load('/data'),
      WanderingTraderTrades.load('/data'),
      // JukeboxBlockEntity.getComparatorOutput reads JukeboxSong.comparatorOutput.
      fetch('/data/jukebox_songs.json').then((r) => (r.ok ? r.json() : { songs: {} }))
        .catch(() => ({ songs: {} })),
      this.textures.load('/mc'),
      this.font.load('/mc'),
      this.guiTextures.preload([...HUD_SPRITES, ...MOB_EFFECT_TEXTURES]),
    ]);
    this.jukeboxSongData = jukeboxSongs;
    this.advancements = advancements;
    this.advancements.onComplete = (adv) => {
      if (!adv.toast || !this.screens) return;
      const iconId = this.survival?.registry.byName(adv.icon)?.id;
      this.screens.toastManager.add(new AdvancementToast(DEFAULT_I18N.get(adv.title), iconId));
    };
    this.models = modelsRes;
    this.hud = new Hud(this.font, this.guiTextures);

    this.onStatus?.('Preparing world generator', 0.45);
    this.generator = new NoiseChunkGenerator(this.mc, worldgen, this.seedBig);

    const biomes = Object.values((worldgen as unknown as { biomes: Record<string, { id: number; name: string; temperature: number; downfall: number; effects?: Record<string, number> }> }).biomes);
    this.biomeColors = new BiomeColors(biomes.map((b) => ({ ...b, name: b.name ?? '' })));
    await this.biomeColors.load('/mc');

    this.onStatus?.('Creating world', 0.55);
    this.level = new ClientLevel(this.mc, this.generator, this.seedBig);
    // BiomeColors samples the multi-noise biome source for the 5x5 `biomeBlendRadius` average
    // (vanilla ClientLevel.calculateBlockTint); without it the tint falls back to the single biome.
    // Read the biome from the loaded chunk palette, NOT from the generator: getBiome() runs the
    // whole climate noise stack, and the mesher calls this 25 times per tinted quad (~150x per
    // leaves block). That alone was 17% of the main thread and the 30 ms single-section mesh
    // spikes while walking.
    this.biomeColors.setBiomeSource((x, y, z) => this.level.getBiome(x, y, z));

    // Vanilla does not create a level for the title screen: the world is generated only once the
    // player enters one. `?play` / `?world=` boots straight into a world (tests, world selection).
    //
    // The spawn area is kicked off BEFORE the renderer is built and is not awaited here: terrain
    // generation (~1.4 s for a 5x5 area) is the biggest cold-boot cost and does not need shaders.
    // Awaiting the promise right before the player is placed overlaps it with renderer init and
    // every remaining asset load.
    if (this.bootPlay) {
      this.onStatus?.('Finding spawn point', 0.58);
      // Pick the spawn column BEFORE generating terrain: the generator can answer "what is the
      // surface height here" without building a chunk, so searching hundreds of blocks costs
      // ~100 ms and the loading screen only ever generates chunks around the real spawn.
      this.spawnSpot = this.findSpawnSpot();

      this.onStatus?.('Generating terrain', 0.62);
      this.spawnAreaPromise = this.generateSpawnArea();
    }

    this.onStatus?.('Building renderer', 0.65);
    this.renderer = new LevelRenderer(this.gl, this.mc, this.models, this.textures, this.biomeColors);
    this.renderer.renderDistance = this.options.renderDistance;
    // Initial shader state; the VideoSettings screen and F6 mutate it live afterwards.
    this.renderer.shadersEnabled = this.options.shaders;
    this.renderer.post.taaOff = !this.options.taa;
    this.renderer.swayEnabled = this.options.vegetationSway;
    this.renderer.shaderQuality = this.options.shaderQuality;
    await this.renderer.init();

    // Survival facade: owns health/hunger/XP, the recipe+loot tables and the player inventory.
    // It is pure data (no GPU), so it can be built while the texture loads below are in flight.
    this.onStatus?.('Rendering item icons', 0.9);
    setSpawnBlockTags(worldData.tags);
    this.survival = new SurvivalState(this.mc, this.seedBig, worldData);
    this.survival.gamemode = this.options.gamemode;
    this.survival.onDrop = (stack) => this.dropItem(stack);
    this.survival.onDeath = () => this.onPlayerDeath();

    this.icons = new ItemIconAtlas(this.gl, this.mc, this.models, this.textures);
    this.entityRenderer = new EntityRenderDispatcher(this.gl);
    // Dropped items draw the same baked item icons as the GUI (real model, not a tint cube).
    this.entityRenderer.setItemIconAtlas(this.icons);
    // Block stacks drop as 3D models: the world item pass draws the baked block model with the
    // GROUND display transform, so the icon sprite path skips them.
    this.worldItemRenderer = new WorldItemRenderer(this.gl, this.mc, this.models, this.textures);
    this.entityRenderer.setWorldItems(this.worldItemRenderer);
    // A type without a renderer would spawn invisible and still attack: take it out of natural spawning and /summon.
    ENTITY_TYPES.forEach((t) => { if (t.factory && !this.entityRenderer.canRender(t.name)) t.factory = null; });

    // Environment passes (sky / clouds / weather) + particles + audio.
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
    this.particles.blockTintForState = (state, x, y, z) => this.particleBlockTint(state, x, y, z);
    this.ambientParticles = new AmbientParticles(this.mc);
    // First-person hand + block-breaking decal (hand package). They own their own shaders and
    // draw into whatever framebuffer is current, so they work with the HDR scene target too.
    this.handRenderer = new HandRenderer(this.gl, this.mc, this.models, this.textures);
    this.breakingOverlay = new BreakingOverlay(this.gl, this.mc, this.models, this.textures);
    this.sounds = new SoundEngine();
    this.sounds.autoUnlock(); // browser autoplay policy: resume on the first gesture

    // Each init below owns the single WebGL context while it runs (FBOs, viewport, bound program),
    // so they must stay sequential: running them in one Promise.all interleaves GL state between
    // an init's awaits and produced GL_INVALID_VALUE. The parallel batch saved ~0 ms anyway —
    // these are shader compiles and uploads, not I/O waits.
    this.onStatus?.('Loading render assets', 0.94);
    await this.icons.loadModels('/mc');
    // Bake at the device's GUI scale so a 3x HUD gets 48x48 icons instead of a 16x16
    // texture stretched into chunky blocks.
    this.icons.build(this.guiScale);
    await this.entityRenderer.init('/mc/textures/entity');
    await this.worldItemRenderer.init('/mc');
    await this.skyRenderer.init();
    await this.cloudRenderer.init();
    await this.weatherRenderer.init();
    await this.particles.init({ blockArray: this.textures.block.texture });
    await this.handRenderer.init('/mc');
    await this.breakingOverlay.init();

    // The spawn area has been generating in the background since `Generating terrain`; from here
    // on the player (and therefore the entity system) needs real terrain under their feet.
    if (this.spawnAreaPromise) {
      await this.spawnAreaPromise;
      this.spawnAreaPromise = null;
    }
    this.initHotbar();
    this.spawnPlayer();

    // Entities: the manager owns the 20 Hz entity tick + natural spawning, the dispatcher draws
    // them into one batched pass. Both must exist before the first frame.
    this.onStatus?.('Starting entity system', 0.94);
    this.entityManager = new EntityManager(this.level, this.player, this.seedBig, {
      despawnDistance: 128,
      registry: this.survival.registry,
    });
    // ServerLevel's custom spawner: the wandering trader's 1200-tick/24000-tick cycle.
    this.wanderingTraderSpawner = new WanderingTraderSpawner({
      level: this.level,
      random: this.entityManager.random,
      getPlayer: () => this.entityManager.getPlayer(),
      spawn: (e) => this.entityManager.spawnEntity(e),
    });
    // Client-side redstone: signal queries, wire power, diodes, buttons/plates and the
    // mechanisms they drive (lamp/door/trapdoor/gate/TNT). Hooks use the entity manager.
    this.redstone = new RedstoneSystem(this.level, this.mc, {
      playSound: (name, x, y, z, pitch = 1) => this.sounds.play(name, x, y, z, 1, pitch),
      primeTnt: (x, y, z) => {
        this.level.setBlockState(x, y, z, 0);
        this.primeTnt(x + 0.5, y, z + 0.5, 80);
      },
      countEntities: (box) => {
        let count = this.player.boundingBox().intersects(box) ? 1 : 0;
        for (const e of this.entityManager.getEntities()) {
          if (e.isRemoved() || !e.isAlive() || !(e instanceof LivingEntity)) continue;
          if (e.getBoundingBox().intersects(box)) count++;
        }
        return count;
      },
      entityFeet: () => {
        const feet: { x: number; y: number; z: number }[] = [
          { x: this.player.pos.x, y: this.player.pos.y, z: this.player.pos.z },
        ];
        for (const e of this.entityManager.getEntities()) {
          if (e.isRemoved() || !e.isAlive() || !(e instanceof LivingEntity)) continue;
          feet.push({ x: e.x, y: e.y, z: e.z });
        }
        return feet;
      },
      // PistonMovingBlockEntity.moveCollidedEntities/moveStuckEntities: entities in the
      // path of a pushed block are displaced with it; honey drags standing entities and
      // slime blocks bounce along the movement axis.
      pushPistonEntities: (boxes, direction, amount, sticky, slime) => {
        const [dx, dy, dz] = direction === 'east' ? [1, 0, 0]
          : direction === 'west' ? [-1, 0, 0]
          : direction === 'up' ? [0, 1, 0]
          : direction === 'down' ? [0, -1, 0]
          : direction === 'south' ? [0, 0, 1] : [0, 0, -1];
        const areas = boxes.map((box) => {
          const swept = box.expandTowards(dx * amount, dy * amount, dz * amount);
          return sticky
            ? new AABB(swept.minX, swept.minY, swept.minZ, swept.maxX, swept.maxY + 1.5, swept.maxZ)
            : swept;
        });
        const hit = (box: AABB) => areas.some((area) => area.intersects(box));
        const move = (e: Entity) => {
          if (e.isRemoved() || !e.isAlive() || !hit(e.getBoundingBox())) return;
          e.moveByPiston(dx * amount, dy * amount, dz * amount);
          if (slime) {
            if (dx !== 0) e.vx = dx;
            else if (dy !== 0) e.vy = dy;
            else e.vz = dz;
          }
        };
        if (hit(this.player.boundingBox())) {
          this.player.moveByPiston(this.level, dx * amount, dy * amount, dz * amount);
          if (slime) {
            const v = this.player.vel;
            this.player.vel = dx !== 0 ? new Vec3(dx, v.y, v.z)
              : dy !== 0 ? new Vec3(v.x, dy, v.z) : new Vec3(v.x, v.y, dz);
          }
        }
        for (const e of this.entityManager.getEntities()) move(e);
      },
      // Container.getRedstoneSignalFromContainer: full slots raise the signal, each stack's
      // fill fraction adds up to 14, and any item at all adds the final point.
      containerSignal: (name, x, y, z) => {
        const menu = this.blockContainers.get(`${name}@${x},${y},${z}`) as
          { container?: Container } | undefined;
        // Without a live menu (fresh reload) the persisted block entity is the source.
        const container = menu?.container ?? this.containerViewFromRecord(name, x, y, z);
        if (!container) return 0;
        const slots = container.getContainerSize();
        if (slots <= 0) return 0;
        let filled = 0;
        let fraction = 0;
        for (let i = 0; i < slots; i++) {
          const stack = container.getItem(i);
          if (stack.isEmpty()) continue;
          filled++;
          fraction += stack.getCount() / Math.min(container.getMaxStackSize(), stack.getMaxStackSize());
        }
        fraction /= slots;
        return Math.floor(fraction * 14) + (filled > 0 ? 1 : 0);
      },
      // JukeboxBlockEntity.getComparatorOutput: JukeboxSong.fromStack(...).comparatorOutput.
      jukeboxSignal: (x, y, z) => {
        const state = this.level.getBlockState(x, y, z);
        if (this.mc.getProp(state, 'has_record') !== 'true') return 0;
        const song = this.jukeboxSongs.get(`${x},${y},${z}`);
        return song ? (this.jukeboxSongData.songs[song]?.comparatorOutput ?? 0) : 0;
      },
    });
    // Detector rails are powered by a minecart standing on them (Minecart.tickDetectorRail).
    this.entityManager.minecartDetectorHandler = (x, y, z, occupied) =>
      this.redstone.setDetectorRail(x, y, z, occupied);
    // PlayerTarget forwards mob/arrow damage here; the survival facade owns armor, i-frames and death.
    const pt = this.entityManager.getPlayerTarget();
    if (pt) pt.onHurt = (amount, attacker) => {
      this.wakeUp(false);
      this.survival.damage(amount, attacker ? attacker.getTypeName() : 'mob');
      this.stats.award('custom', 'damage_taken', Math.round(amount * 10));
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
    this.entityManager.explosionHandler = (x, y, z, power, interaction, owner) => this.explode(x, y, z, power, interaction, owner);
    // TargetingConditions.forCombat().ignoreCreative() and TemptGoal's hand check need the
    // player's live game mode / held items; the vanilla entity layer has no direct Game ref.
    this.entityManager.playerGameModeProvider = () => this.options.gamemode;
    this.entityManager.mobDeathHandler = (e) => {
      this.dropMobLoot(e);
      // A dead villager/pet must not be respawned from its persistence snapshot.
      this.villagerSnapshots.delete(e.id);
      this.petSnapshots.delete(e.id);
    };
    this.entityManager.persistentCullHandler = (e) => this.snapshotPersistentEntity(e);
    // AgeableMob in love: hearts every 10 ticks (Animal.aiStep particle path).
    this.entityManager.animalLoveHandler = (e) => {
      spawnHearts(e.x, e.y + e.getHeight() * 0.8, e.z, 2);
    };
    this.entityManager.animalBredHandler = () => {
      this.stats.award('custom', 'animals_bred');
    };
    this.entityManager.chickenEggHandler = (e) => {
      const item = this.survival.registry.byName('egg');
      if (item) this.dropItem(new ItemStack(item, 1), e.x, e.y + 0.2, e.z);
      this.sounds.play('entity.chicken.egg', e.x, e.y, e.z, 1, 1);
    };
    // HarvestFarmland: crop break particles/sound, then the replant sound.
    this.entityManager.villagerFarmHandler = (action, x, y, z) => {
      if (action === 'break') {
        const state = this.level.getBlockState(x, y, z);
        if (state !== 0) this.breakEffects(state, x, y, z);
        this.sounds.play('block.crop.break', x + 0.5, y + 0.5, z + 0.5, 1, 0.8 + Math.random() * 0.4);
      } else {
        this.sounds.play('entity.villager.work_farmer', x + 0.5, y + 0.5, z + 0.5, 0.4, 0.9);
      }
    };
    this.entityManager.potionSplashHandler = (x, y, z, potionId, age, lingering) => {
      if (lingering) this.spawnPotionCloud(x, y, z, potionId);
      else this.applyPotionSplash(x, y, z, potionId, age);
    };
    this.entityManager.playerHeldItemsProvider = () => {
      const held: string[] = [];
      const main = this.survival.getSelectedStack();
      if (!main.isEmpty() && main.item) held.push(main.item.name);
      const off = this.survival.inventory.getItem(SLOT_OFFHAND);
      if (!off.isEmpty() && off.item) held.push(off.item.name);
      return held;
    };
    void this.entityManager.loadSpawnConfig('/mc');

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
      stats: this.stats,
      advancements: this.advancements,
      itemTags: ((getWorldData().tags as { item?: Record<string, string[]> } | undefined)?.item) ?? {},
      playerLevel: () => this.survival.level,
      touchInput: this.touchDevice,
      container: this.containerAdapter(),
      // 3D player preview for the inventory screens (FBO render + readback in the dispatcher).
      // Armor slots 39..36 are passed in head/chest/legs/feet order, like the render state's
      // equipment (vanilla InventoryScreen draws the worn armor on the preview model).
      renderEntityPreview: (size, yawRad, pitchRad) => {
        const inv = this.survival.inventory;
        const equipment = [39, 38, 37, 36].map((slot) => {
          const stack = inv.getItem(slot);
          return stack.isEmpty() ? null : (stack.item?.namespacedId ?? null);
        });
        return this.entityRenderer.renderPreview(
          this.player.pos, this.level, size, yawRad, pitchRad, equipment,
        );
      },
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
            this.applyRenderScale();
          } else if (key === 'taa') {
            this.renderer.post.taaOff = !Boolean(value);
          } else if (key === 'vegetationSway') {
            this.renderer.swayEnabled = Boolean(value);
          } else if (key === 'dynamicResolution') {
            if (!value) this.setRenderScale(this.maxRenderScale);
          } else if (key === 'guiScale') {
            // Window#setGuiScale: rebake the item icons at the new physical slot size and re-lay out
            // the open screen. Without this the HUD kept drawing an atlas baked for the old scale
            // and the settings page stayed at the previous logical size until the next window resize.
            this.icons?.build(this.guiScale);
            this.screens?.resize(window.innerWidth, window.innerHeight);
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
    window.addEventListener('resize', () => this.scheduleResize());
    this.bindInput();
    this.initTouch();
    this.initPerfLog();
    if (!this.bootPlay) this.openTitle();
    this.onStatus?.('Ready', 1);
  }

  /**
   * 性能采样默认开启：进世界 2.5 秒后静默采 12 秒，然后把报告 POST 给 dev server
   * （vite.config.ts 的 perf-log-sink 落盘到 logs/perf/perf-*.json），手机上也无需任何操作。
   *
   *   ?play&perf=20   手动模式：显示面板、20 秒、带 50% 分辨率对照，可复制/下载
   *   ?play&perf=0    完全关掉
   */
  private initPerfLog(): void {
    if (typeof location === 'undefined') return;
    const raw = new URLSearchParams(location.search).get('perf');
    if (raw === '0' || raw === 'off') return;
    const manual = raw !== null;
    const seconds = manual && Number(raw) > 0 ? Number(raw) : 12;
    const log = new PerfLog(this, { seconds, auto: !manual, abTest: manual, upload: true });
    this.perfLog = log;
    (window as unknown as { __perf: PerfLog }).__perf = log;
    log.install();
  }

  // ------------------------------------------------ title screen / world lifecycle

  /** World-list adapter for the GUI: creating/selecting a world must NOT rebind the autosave
   *  until the new world is actually loaded (otherwise the old level would be flushed into the
   *  new save). `load()` only binds when the id is the world that is already in memory. */
  private worldProvider(): WorldListProvider {
    const save = this.saveManager;
    return {
      list: () => (save ? save.list() : Promise.resolve([])),
      exportWorld: (id) => (save ? save.exportWorld(id) : Promise.reject(new Error('no persistence'))),
      importWorld: (data) => (save ? save.importWorld(data) : Promise.reject(new Error('no persistence'))),
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
    // CSS -> physical GUI pixels. glCanvas can be capped by the 3D render scale, so map against
    // the GUI canvas (which is always full device pixels).
    const dpr = this.guiCanvas.width / Math.max(1, window.innerWidth);
    const guiX = (clientX * dpr) / scale;
    const guiY = (clientY * dpr) / scale;
    const size = guiScaledSize(this.guiCanvas.width, this.guiCanvas.height, scale);
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

    // 3x3 chunks around spawn: enough terrain for the camera to open on. The rest of the view
    // distance is requested by the normal tick loop (ensureChunksAround) once the game runs, so
    // the workers are not competing with shader compilation during the boot.
    const radius = 1;
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
    this.lastStatX = this.player.pos.x;
    this.lastStatZ = this.player.pos.z;
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
    const menu = (): AbstractContainerMenu => {
      const active = this.survival.activeMenu ?? this.survival.openInventory();
      // Stats.ITEM_CRAFTED: wired lazily here so every InventoryMenu/CraftingMenu/FurnaceMenu
      // created by SurvivalState reports takes without importing the statistics layer.
      if (active instanceof AbstractCraftingMenu || active instanceof AbstractFurnaceMenu) {
        if (!active.onCrafted) {
          active.onCrafted = (name, count) => this.stats.award('crafted', name, count);
        }
      }
      if (active instanceof EnchantingMenu) {
        if (!active.onSpendLevels) active.onSpendLevels = (levels) => this.survival.removeExperienceLevels(levels);
        if (!active.onEnchanted) {
          active.onEnchanted = () => {
            this.stats.award('custom', 'enchant_item');
            this.sounds.play(
              'block.enchantment_table.use',
              this.player.pos.x, this.player.pos.y, this.player.pos.z, 1, 1,
            );
          };
        }
      }
      return active;
    };
    // CreativeModeInventoryScreen owns a virtual 9x5 tab grid (indices 0..44) plus the real
    // player hotbar (45..53); it is not backed by an AbstractContainerMenu. Its Survival
    // Inventory tab is backed by the real InventoryMenu (46 slots), so indices are used as-is.
    const creativeGrid: { itemId: number; count: number }[] = Array.from(
      { length: 45 }, () => ({ itemId: -1, count: 0 }),
    );
    const creativeScreen = (): CreativeModeInventoryScreen | null =>
      this.screens?.current instanceof CreativeModeInventoryScreen ? this.screens.current : null;
    const isCreative = (): boolean => creativeScreen() !== null;
    const isCreativeSurvival = (): boolean => creativeScreen()?.getSelectedTab() === TAB_SURVIVAL;
    const isCreativeItemTab = (): boolean => isCreative() && !isCreativeSurvival();
    const menuIndex = (index: number): number => isCreativeItemTab() && index >= 45 ? index - 9 : index;
    const plain = (stack: ItemStack): { itemId: number; count: number } =>
      ({ itemId: stack.isEmpty() ? -1 : stack.item!.id, count: stack.getCount() });
    return {
      getSlotCount: () => (isCreativeItemTab() ? 54 : menu().slots.length),
      getItem: (index) => {
        if (isCreativeSurvival()) {
          const slot = menu().slots[index];
          return plain(slot ? slot.getItem() : ItemStack.EMPTY);
        }
        if (isCreativeItemTab()) {
          if (index >= 0 && index < 45) return creativeGrid[index];
          if (index >= 45 && index < 54) return plain(this.survival.inventory.getItem(index - 45));
        }
        const slot = menu().slots[index];
        const stack = slot ? slot.getItem() : ItemStack.EMPTY;
        return plain(stack);
      },
      click: (index, button, shift, action) => {
        const active = menu();
        if (isCreativeItemTab() && index >= 0 && index < 45) {
          // CreativeModeInventoryScreen.slotClicked (slot.container == CONTAINER):
          //   SWAP -> max copy into the hotbar slot, CLONE -> max copy onto the cursor,
          //   THROW -> drop, quickKey -> max stack, otherwise grow/shrink by one.
          // A left click on a *different* item while carrying a stack empties the
          // cursor (the carried stack is destroyed), it never swaps back.
          const item = this.survival.registry.get(creativeGrid[index].itemId);
          if (!item) { active.setCarried(ItemStack.EMPTY); return; }
          const stack = new ItemStack(item, 1);
          const max = stack.getMaxStackSize();
          const carried = active.getCarried();
          if (action === 'SWAP') {
            this.survival.inventory.setItem(button, stack.copyWithCount(max));
            return;
          }
          if (action === 'THROW') {
            this.survival.drop(stack.copyWithCount(button === 1 ? max : 1));
            return;
          }
          if (action === 'CLONE') {
            if (carried.isEmpty()) active.setCarried(stack.copyWithCount(max));
            return;
          }
          const quickKey = action === 'QUICK_MOVE' || shift;
          if (!carried.isEmpty() && ItemStack.isSameItemSameComponents(carried, stack)) {
            if (button === 0) {
              if (quickKey) carried.setCount(max);
              else if (carried.getCount() < max) carried.setCount(carried.getCount() + 1);
            } else {
              carried.setCount(carried.getCount() - 1);
              if (carried.getCount() <= 0) active.setCarried(ItemStack.EMPTY);
            }
            return;
          }
          if (carried.isEmpty()) {
            active.setCarried(quickKey ? stack.copyWithCount(max) : stack);
          } else if (button === 0) {
            active.setCarried(ItemStack.EMPTY);
          } else {
            carried.setCount(carried.getCount() - 1);
            if (carried.getCount() <= 0) active.setCarried(ItemStack.EMPTY);
          }
          return;
        }
        if (isCreativeItemTab() && index >= 45 && index < 54 && action === 'QUICK_MOVE') {
          this.survival.inventory.setItem(index - 45, ItemStack.EMPTY);
          return;
        }
        active.clicked(menuIndex(index), button, ACTION_TO_INPUT[action], this.survival.asMenuPlayer());
      },
      canPlaceItem: (index, stack) => {
        if (isCreativeItemTab() && index >= 0 && index < 45) return false;
        const active = menu();
        const slot = active.slots[menuIndex(index)];
        const item = this.survival.registry.get(stack.itemId);
        return !!slot && !!item && slot.mayPlace(new ItemStack(item, stack.count)) && active.canDragTo(slot);
      },
      getMaxStackSize: (index, stack) => {
        const item = this.survival.registry.get(stack.itemId);
        if (!item) return 0;
        const value = new ItemStack(item, stack.count);
        if (isCreativeItemTab() && index >= 0 && index < 45) return value.getMaxStackSize();
        return menu().slots[menuIndex(index)]?.getMaxStackSize(value) ?? value.getMaxStackSize();
      },
      setItem: (index, stack) => {
        if (isCreativeItemTab() && index >= 0 && index < 45) creativeGrid[index] = { itemId: stack.itemId, count: stack.count };
      },
      // CreativeModeInventoryScreen.slotClicked: shift-clicking the destroy slot empties
      // every slot of the inventory menu (main inventory, hotbar, armor, offhand).
      clearAll: () => {
        const active = menu();
        for (let i = 0; i < active.slots.length; i++) active.slots[i].set(ItemStack.EMPTY);
      },
      enchantInfo: (levels) => {
        const active = menu();
        return active instanceof EnchantingMenu
          ? active.info(levels)
          : { costs: [0, 0, 0], canEnchant: [false, false, false] };
      },
      enchant: (slot) => {
        const active = menu();
        if (!(active instanceof EnchantingMenu)) return false;
        return active.enchant(slot, this.survival.level);
      },
      brewInfo: () => {
        const active = menu();
        return active instanceof BrewingMenu
          ? active.brewInfo()
          : { progress: 0, fuel: 0 };
      },
      merchantInfo: () => {
        const active = menu();
        if (!(active instanceof MerchantMenu)) return undefined;
        return {
          offers: active.getOffers().map((offer) => ({
            costA: plain(offer.getCostA()),
            baseCostA: plain(offer.getBaseCostA()),
            costB: plain(offer.getCostB()),
            result: plain(offer.getResult()),
            outOfStock: offer.isOutOfStock(),
            uses: offer.getUses(),
            maxUses: offer.getMaxUses(),
            xp: offer.getXp(),
          })),
          level: active.getTraderLevel(),
          xp: active.getTraderXp(),
          futureXp: active.getFutureTraderXp(),
          canRestock: active.canRestock(),
          showProgress: active.showProgressBar(),
          titleKey: active.getMerchant() instanceof WanderingTrader
            ? 'entity.minecraft.wandering_trader'
            : 'entity.minecraft.villager',
          select: (index: number) => {
            active.setSelectionHint(index);
            active.tryMoveItems(index);
          },
        };
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

      // Title-screen boot: open the store so the world list has a provider, but do not touch any
      // save. The previous version restored the newest world (and created one on first run)
      // before the player had chosen anything, which also meant the list always showed a world
      // the player never created.
      if (!this.bootPlay) return;

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
        await this.restoreWorld(loaded);
        console.log(`[save] restored "${target.name}" (${target.id}): ${loaded.chunkKeys.size} saved chunks, player ${loaded.player ? 'yes' : 'no'}`);
      } else {
        this.currentWorldId = await this.saveManager.createWorld({
          name: 'World',
          seed: this.seedBig,
          gamemode: this.options.gamemode,
          difficulty: 'normal',
        });
        console.log(`[save] created new world ${this.currentWorldId}`);
      }

      // Each save cycle starts by copying the live entities near the player into
      // their chunks; flushDirty then writes entity-dirty chunks even when no
      // block changed.
      this.saveManager.setBeforeSave(() => this.captureChunkEntities());
      this.autosave = new Autosave(this.saveManager, {
        getLevel: () => this.level,
        getPlayer: () => this.player,
        getExtra: () => this.playerExtra(),
        getPets: () => this.petData(),
        getVillagers: () => this.villagerData(),
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
  private async restoreWorld(loaded: LoadedWorld): Promise<void> {
    const started = performance.now();
    // Keep the key set of every serialized chunk; bytes are read from IndexedDB on
    // demand and decode when the player first reaches them (ensureChunksAround,
    // max 2/tick). Reading/decoding the whole save here froze the main thread for
    // seconds on long-played worlds ("Opening world save 99%" / page not responding).
    this.savedChunkBytes.clear();
    this.savedChunkCoords.clear();
    this.pendingSavedChunks.clear();
    for (const key of loaded.chunkKeys) {
      const m = /(-?\d+),(-?\d+)$/.exec(key);
      if (m) this.savedChunkCoords.add(chunkKey(Number(m[1]), Number(m[2])));
    }
    // World-level villager/pet snapshots from a previous world must not leak into this one.
    this.villagerSnapshots.clear();
    this.petSnapshots.clear();

    // Read + decode only the 5x5 saved chunks around the saved player synchronously;
    // the rest stream in with the normal chunk pipeline as the player moves.
    const savedPos = loaded.player ? PlayerData.fromNbt(loaded.player).pos : null;
    const pcx = Math.floor((savedPos ?? this.player.pos).x) >> 4;
    const pcz = Math.floor((savedPos ?? this.player.pos).z) >> 4;
    const decoded: LevelChunk[] = [];
    for (let dz = -2; dz <= 2; dz++) {
      for (let dx = -2; dx <= 2; dx++) {
        const cx = pcx + dx, cz = pcz + dz;
        const k = chunkKey(cx, cz);
        if (!this.savedChunkCoords.has(k)) continue;
        const bytes = await this.saveManager?.readChunkBytes(cx, cz) ?? null;
        if (!bytes) continue;
        this.savedChunkBytes.set(k, bytes);
        try {
          decoded.push(ChunkSerializer.fromBytes(bytes, this.mc, this.chunkCodec));
        } catch (err) {
          console.warn('[save] unreadable chunk:', err);
        }
      }
    }
    // Saved chunks already carry their light data; skip the per-chunk full relight.
    for (const chunk of decoded) this.restoreJukeboxRecords(chunk);
    const count = this.level.addChunksBulk(decoded);
    // These chunks were generated (and their passive animals spawned) before the save;
    // mark them known so the chunk-generation spawn pass does not add a second wave.
    for (const chunk of decoded) this.entityManager.markChunkKnown(chunk.x, chunk.z);
    console.log(`[save] restored ${count}/${loaded.chunkKeys.size} saved chunks near the player in ${Math.round(performance.now() - started)} ms`);

    if (loaded.player) {
      PlayerData.applyToPlayer(loaded.player, this.player);
      const view = PlayerData.fromNbt(loaded.player);
      if (view.inventory.length > 0) {
        const slots = this.survival.inventory.getContainerSize();
        for (let i = 0; i < slots; i++) this.survival.inventory.setItem(i, ItemStack.EMPTY);
        for (const saved of view.inventory) {
          const item = this.survival.registry.byName(String(saved.id))
            ?? (saved.numericId !== undefined ? this.survival.registry.get(saved.numericId) : undefined);
          const slot = saved.slot & 0xff;
          if (!item || saved.count <= 0 || slot >= slots) continue;
          this.survival.inventory.setItem(slot, new ItemStack(
            item, saved.count,
            saved.components as ItemComponents | undefined,
          ));
        }
      }
      this.survival.inventory.setSelectedSlot(view.selectedItemSlot);
      this.survival.restoreFromSave(view);
      // Active potion effects are part of the player save (active_effects component).
      this.survival.clearEffects();
      const savedEffects = (view.extra as { effects?: unknown } | undefined)?.effects;
      if (Array.isArray(savedEffects)) {
        for (const raw of savedEffects) {
          if (!raw || typeof raw !== 'object') continue;
          const e = raw as { id?: unknown; duration?: unknown; amplifier?: unknown };
          const id = typeof e.id === 'string' ? e.id : '';
          const duration = Number(e.duration);
          const amplifier = Number(e.amplifier);
          if (id && Number.isFinite(duration) && duration > 0) {
            this.survival.applyEffect(id, duration, Number.isFinite(amplifier) && amplifier > 0 ? amplifier : 0);
          }
        }
      }
      this.stats.load((view.extra as { stats?: unknown } | undefined)?.stats);
      this.advancements.load((view.extra as { advancements?: unknown } | undefined)?.advancements);
      const bed = (view.extra as { bedSpawn?: unknown } | undefined)?.bedSpawn;
      if (bed && typeof bed === 'object') {
        const b = bed as { x?: unknown; y?: unknown; z?: unknown };
        if (Number.isFinite(b.x) && Number.isFinite(b.y) && Number.isFinite(b.z)) {
          this.bedSpawn = { x: Number(b.x), y: Number(b.y), z: Number(b.z) };
        }
      }
      this.lastStatX = this.player.pos.x;
      this.lastStatZ = this.player.pos.z;
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

    let restoredPets = 0;
    for (const pet of loaded.pets) {
      const e = this.entityManager.spawn(pet.type, pet.x, pet.y, pet.z);
      if (!(e instanceof Mob)) continue;
      e.tamed = true;
      e.sitting = !!pet.sitting;
      e.owner = pet.owner || 'player';
      if (Number.isFinite(pet.health)) e.health = Math.max(1, Math.min(e.maxHealth, pet.health));
      restoredPets++;
    }
    if (restoredPets > 0) console.log(`[save] restored ${restoredPets} pets`);

    let restoredVillagers = 0;
    for (const saved of loaded.villagers ?? []) {
      const e = this.entityManager.spawn('villager', saved.x, saved.y, saved.z);
      if (!(e instanceof Villager)) continue;
      e.restore(saved, this.survival.registry);
      restoredVillagers++;
    }
    if (restoredVillagers > 0) console.log(`[save] restored ${restoredVillagers} villagers`);

    // JukeboxBlockEntity: the disc's song and song position are saved per block entity, so a
    // record that was playing before the reload starts again from the saved tick.
    this.resumeJukeboxPlayback();
  }

  /** Writes the JukeboxBlockEntity record (disc song + ticks_since_song_started) into the chunk. */
  private writeJukeboxRecord(x: number, y: number, z: number, song: string, ticks: number): void {
    const chunk = this.level.getChunk(x >> 4, z >> 4);
    if (!chunk) return;
    chunk.addBlockEntity(x & 15, y, z & 15, { type: 'minecraft:jukebox', data: { record: song, ticks } });
    chunk.dirtySections.add(y >> 4);
  }

  private clearJukeboxRecord(x: number, y: number, z: number): void {
    const chunk = this.level.getChunk(x >> 4, z >> 4);
    if (!chunk) return;
    chunk.removeBlockEntity(x & 15, y, z & 15);
    chunk.dirtySections.add(y >> 4);
  }

  /** Called once per save cycle: stores how far the audible record has played. */
  private persistJukeboxProgress(): void {
    const key = this.playingJukeboxKey;
    if (!key) return;
    const song = this.jukeboxSongs.get(key);
    if (!song) return;
    const [x, y, z] = key.split(',').map(Number);
    const ticks = Math.max(0, Math.floor((performance.now() - this.recordStartMs) / 50));
    this.writeJukeboxRecord(x, y, z, song, ticks);
  }

  /** Restores song/comparator state for every jukebox block entity in a decoded chunk. */
  private restoreJukeboxRecords(chunk: LevelChunk): void {
    for (const [packed, rec] of chunk.blockEntities) {
      if (rec.type.replace(/^minecraft:/, '') !== 'jukebox') continue;
      const song = (rec.data as { record?: unknown }).record;
      if (typeof song !== 'string' || !song) continue;
      const wx = chunk.x * 16 + (packed & 15);
      const wz = chunk.z * 16 + ((packed >> 4) & 15);
      const wy = ((packed >> 12) << 4) + ((packed >> 8) & 15);
      this.jukeboxSongs.set(`${wx},${wy},${wz}`, song);
    }
  }

  /**
   * Resumes the nearest restored jukebox that still has playing time left (the engine keeps a
   * single audible record handle; vanilla mixes every jukebox in range).
   */
  private resumeJukeboxPlayback(): void {
    if (!this.sounds.isReady) {
      // World restore can finish before the sound index/context: retry from the frame tick.
      this.pendingJukeboxResume = true;
      return;
    }
    this.pendingJukeboxResume = false;
    let best: { x: number; y: number; z: number; song: string; ticks: number } | null = null;
    let bestDist = Infinity;
    const px = this.player.pos.x, py = this.player.pos.y, pz = this.player.pos.z;
    for (const chunk of this.level.chunks.values()) {
      for (const [packed, rec] of chunk.blockEntities) {
        if (rec.type.replace(/^minecraft:/, '') !== 'jukebox') continue;
        const data = rec.data as { record?: unknown; ticks?: unknown };
        if (typeof data.record !== 'string' || !data.record) continue;
        const info = this.jukeboxSongData.songs[data.record];
        if (!info) continue;
        const ticks = Math.max(0, Math.floor(Number(data.ticks) || 0));
        if (ticks >= info.lengthSeconds * 20) continue;
        const wx = chunk.x * 16 + (packed & 15);
        const wz = chunk.z * 16 + ((packed >> 4) & 15);
        const wy = ((packed >> 12) << 4) + ((packed >> 8) & 15);
        const d = (wx + 0.5 - px) ** 2 + (wy + 0.5 - py) ** 2 + (wz + 0.5 - pz) ** 2;
        if (d < bestDist) { bestDist = d; best = { x: wx, y: wy, z: wz, song: data.record, ticks }; }
      }
    }
    if (!best) return;
    const key = `${best.x},${best.y},${best.z}`;
    this.jukeboxSongs.set(key, best.song);
    this.recordHandle?.stop();
    this.recordHandle = this.sounds.play(
      `music_disc.${best.song}`, best.x + 0.5, best.y + 0.5, best.z + 0.5, 4, 1, best.ticks * 0.05,
    );
    this.playingJukeboxKey = key;
    this.recordStartMs = performance.now() - best.ticks * 50;
  }

  /** Extra player state persisted next to the vanilla NBT fields. */
  private playerExtra(): Record<string, unknown> {
    const s = this.survival;
    const inventory: ItemStackData[] = [];
    // 0..35 main inventory, 36..39 armor, 40 offhand, 41 body armor, 42 saddle.
    for (let i = 0; i < s.inventory.getContainerSize(); i++) {
      const stack = s.inventory.getItem(i);
      const item = stack.getItem();
      if (!item || stack.isEmpty()) continue;
      inventory.push({
        slot: i, id: item.namespacedId, count: stack.getCount(), numericId: item.id,
        // Data components (potion id, enchantments, damage, custom name) must survive:
        // item id + count alone turns every potion into a water bottle / strips enchants.
        components: Object.keys(stack.components).length > 0
          ? stack.components as unknown as Record<string, unknown>
          : undefined,
      });
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
      stats: this.stats.toJSON(),
      advancements: this.advancements.toJSON(),
      bedSpawn: this.bedSpawn,
      effects: [...s.effects.entries()].map(([id, e]) => ({
        id, duration: e.duration, amplifier: e.amplifier,
      })),
    };
  }

  /** Event-driven triggers that need no per-event hook (roots and inventory). */
  private tickAdvancements(): void {
    if (!this.advancements) return;
    this.advancements.trigger('tick');
    const items: string[] = [];
    for (let i = 0; i < this.survival.inventory.getContainerSize(); i++) {
      const stack = this.survival.inventory.getItem(i);
      if (!stack.isEmpty() && stack.item) items.push(stack.item.name);
    }
    this.advancements.trigger('inventory_changed', { items });
  }

  /** Tamed pets saved with the world (vanilla does not despawn tamed animals). */
  private petRecord(e: Mob): SavedPet {
    return {
      type: e.type.name,
      x: e.x, y: e.y, z: e.z,
      health: e.health,
      sitting: e.sitting,
      owner: e.owner,
    };
  }

  /** Snapshots one persistent entity before its chunk is culled. */
  private snapshotPersistentEntity(e: Entity): void {
    if (!(e instanceof Mob) || !e.isAlive()) return;
    if (e instanceof Villager) this.villagerSnapshots.set(e.id, e.toJSON());
    else if (e.tamed) this.petSnapshots.set(e.id, this.petRecord(e));
  }

  /** Refreshes snapshots for every live persistent entity (once per save cycle). */
  private snapshotPersistentEntities(): void {
    for (const e of this.entityManager.getEntities()) {
      if (!e.isRemoved()) this.snapshotPersistentEntity(e);
    }
  }

  private withinLoadDistance(x: number, z: number): boolean {
    const pcx = Math.floor(this.player.pos.x) >> 4;
    const pcz = Math.floor(this.player.pos.z) >> 4;
    const r = this.options.renderDistance;
    return Math.abs((Math.floor(x) >> 4) - pcx) <= r
      && Math.abs((Math.floor(z) >> 4) - pcz) <= r;
  }

  private petData(): SavedPet[] {
    this.snapshotPersistentEntities();
    const live = new Set<number>();
    const pets: SavedPet[] = [];
    for (const e of this.entityManager.getEntities()) {
      if (!(e instanceof Mob) || !e.tamed || e.isRemoved()) continue;
      live.add(e.id);
      pets.push(this.petRecord(e));
    }
    for (const [id, rec] of [...this.petSnapshots]) {
      if (live.has(id)) continue;
      // A snapshot with no live entity inside the loaded area means it died; an
      // unloaded chunk is farther out and keeps its snapshot for the next visit.
      if (this.withinLoadDistance(rec.x, rec.z)) this.petSnapshots.delete(id);
      else pets.push(rec);
    }
    return pets;
  }

  private villagerData(): SavedVillager[] {
    this.snapshotPersistentEntities();
    const live = new Set<number>();
    const villagers: SavedVillager[] = [];
    for (const e of this.entityManager.getEntities()) {
      if (!(e instanceof Villager) || e.isRemoved()) continue;
      live.add(e.id);
      villagers.push(e.toJSON());
    }
    for (const [id, rec] of [...this.villagerSnapshots]) {
      if (live.has(id)) continue;
      if (this.withinLoadDistance(rec.x, rec.z)) this.villagerSnapshots.delete(id);
      else villagers.push(rec);
    }
    return villagers;
  }

  // ---- chunk entity persistence -------------------------------------------

  /** ItemStack -> plain record, shared by chunk entities (same shape as the player save). */
  private stackData(stack: ItemStack, slot = 0): ItemStackData {
    const item = stack.getItem();
    return {
      slot, id: item?.namespacedId ?? 'minecraft:air', count: stack.getCount(),
      numericId: item?.id,
      components: Object.keys(stack.components).length > 0
        ? stack.components as unknown as Record<string, unknown>
        : undefined,
    };
  }

  private stackFromData(raw: unknown): ItemStack {
    if (!raw || typeof raw !== 'object') return ItemStack.EMPTY;
    const d = raw as ItemStackData;
    const item = this.survival.registry.byName(String(d.id))
      ?? (d.numericId !== undefined ? this.survival.registry.get(d.numericId) : undefined);
    if (!item || d.count <= 0) return ItemStack.EMPTY;
    return new ItemStack(item, d.count, d.components as ItemComponents | undefined);
  }

  /**
   * Builds the chunk-save record for one entity. Villagers and tamed pets keep
   * their richer world-level serializers; projectiles/particles are transient.
   */
  private saveEntityRecord(e: Entity): SavedChunkEntity | null {
    if (e instanceof Villager) return null;
    if (e instanceof Mob && e.tamed) return null;
    const base: SavedChunkEntity = {
      type: e.type.name.replace(/^minecraft:/, ''),
      x: e.x, y: e.y, z: e.z,
      yaw: e.yaw, pitch: e.pitch,
      vx: e.vx, vy: e.vy, vz: e.vz,
    };
    if (e instanceof ItemEntity) {
      const stack = e.getItem();
      if (stack.isEmpty()) return null;
      return {
        ...base,
        data: { stack: this.stackData(stack), age: e.age, pickupDelay: e.pickupDelay },
      };
    }
    if (e instanceof ExperienceOrb) {
      return { ...base, data: { value: e.value } };
    }
    if (e instanceof Minecart || e instanceof Boat) {
      const size = e.inventory.getContainerSize();
      if (size === 0) return base;
      const items: ItemStackData[] = [];
      for (let i = 0; i < size; i++) {
        const stack = e.inventory.getItem(i);
        if (!stack.isEmpty()) items.push(this.stackData(stack, i));
      }
      return { ...base, data: { items } };
    }
    if (e instanceof Mob) {
      const data: Record<string, unknown> = { age: e.age };
      if (e instanceof Sheep) {
        data.woolColor = e.woolColor;
        data.sheared = e.sheared;
      }
      if (e instanceof IronGolem) data.playerCreated = e.playerCreated;
      if (e instanceof Llama) data.variant = e.variant;
      if (e instanceof WanderingTrader) {
        data.despawnDelay = e.despawnDelay;
        // The trader's generated offers and their use counts survive a reload;
        // otherwise reloading resets every sold-out trade.
        data.offers = e.offers.map((offer) => offer.toJSON());
      }
      if (e instanceof TraderLlama) data.despawnDelay = e.despawnDelay;
      return { ...base, health: e.health, data };
    }
    return null;
  }

  /**
   * Copies every live entity within the chunk-retention band into its chunk's
   * `entities` list and marks the chunk for the next flush. Runs once per save
   * cycle (WorldSaveManager.beforeSave), never per idle slice, so moving
   * entities cannot keep the sharded save alive forever.
   */
  private captureChunkEntities(): void {
    // Refresh world-level records first: villagers/pets are not in chunk records,
    // but saving while they are unloaded must still see their last snapshot.
    this.snapshotPersistentEntities();
    this.persistJukeboxProgress();
    this.persistBlockContainers();
    const pcx = Math.floor(this.player.pos.x) >> 4;
    const pcz = Math.floor(this.player.pos.z) >> 4;
    const radius = this.options.renderDistance + CHUNK_RETAIN_MARGIN;
    const grouped = new Map<string, SavedChunkEntity[]>();
    for (const e of this.entityManager.getEntities()) {
      if (e.isRemoved()) continue;
      const cx = Math.floor(e.x) >> 4;
      const cz = Math.floor(e.z) >> 4;
      if (Math.max(Math.abs(cx - pcx), Math.abs(cz - pcz)) > radius) continue;
      const rec = this.saveEntityRecord(e);
      if (!rec) continue;
      const key = `${cx},${cz}`;
      let list = grouped.get(key);
      if (!list) { list = []; grouped.set(key, list); }
      list.push(rec);
    }
    for (const chunk of this.level.chunks.values()) {
      if (Math.max(Math.abs(chunk.x - pcx), Math.abs(chunk.z - pcz)) > radius) continue;
      // Chunks between render and retention distance were never activated: their live
      // entity list is empty by construction, so writing it would erase the stored records.
      if (!chunk.entitiesActive) continue;
      const next = grouped.get(`${chunk.x},${chunk.z}`) ?? [];
      const same = JSON.stringify(next) === JSON.stringify(chunk.entities);
      // A chunk whose stored entities all died while loaded must be written empty
      // even though both in-memory lists are [] (hadEntities still reflects disk).
      if (same && !(chunk.hadEntities && next.length === 0)) continue;
      chunk.entities = next;
      chunk.hadEntities = next.length > 0;
      chunk.entitiesDirty = true;
    }
  }

  /** Groups live entities by chunk (used when chunks leave the retention band). */
  private liveEntitiesByChunk(): Map<string, SavedChunkEntity[]> {
    const grouped = new Map<string, SavedChunkEntity[]>();
    for (const e of this.entityManager.getEntities()) {
      if (e.isRemoved()) continue;
      const rec = this.saveEntityRecord(e);
      if (!rec) continue;
      const key = `${Math.floor(e.x) >> 4},${Math.floor(e.z) >> 4}`;
      let list = grouped.get(key);
      if (!list) { list = []; grouped.set(key, list); }
      list.push(rec);
    }
    return grouped;
  }

  /** Spawns the entities stored in chunks that just came within render distance. */
  private activateSavedChunkEntities(): void {
    const pcx = Math.floor(this.player.pos.x) >> 4;
    const pcz = Math.floor(this.player.pos.z) >> 4;
    const r = this.options.renderDistance;
    const liveIds = new Set<number>();
    for (const e of this.entityManager.getEntities()) if (!e.isRemoved()) liveIds.add(e.id);
    // Villagers/pets are excluded from chunk records; their world-level snapshots
    // are respawned when their chunk becomes active again.
    const offlineVillagers = new Map<string, Array<[number, SavedVillager]>>();
    for (const [id, rec] of this.villagerSnapshots) {
      if (liveIds.has(id)) continue;
      const key = `${Math.floor(rec.x) >> 4},${Math.floor(rec.z) >> 4}`;
      let list = offlineVillagers.get(key);
      if (!list) { list = []; offlineVillagers.set(key, list); }
      list.push([id, rec]);
    }
    const offlinePets = new Map<string, Array<[number, SavedPet]>>();
    for (const [id, rec] of this.petSnapshots) {
      if (liveIds.has(id)) continue;
      const key = `${Math.floor(rec.x) >> 4},${Math.floor(rec.z) >> 4}`;
      let list = offlinePets.get(key);
      if (!list) { list = []; offlinePets.set(key, list); }
      list.push([id, rec]);
    }

    for (let dz = -r; dz <= r; dz++) {
      for (let dx = -r; dx <= r; dx++) {
        const chunk = this.level.getChunk(pcx + dx, pcz + dz);
        if (!chunk) continue;
        chunk.entitiesActive = true;
        const key = `${chunk.x},${chunk.z}`;
        for (const [oldId, rec] of offlineVillagers.get(key) ?? []) {
          if (liveIds.has(oldId)) continue;
          const e = this.entityManager.spawn('villager', rec.x, rec.y, rec.z);
          if (!(e instanceof Villager)) continue;
          e.restore(rec, this.survival.registry);
          this.villagerSnapshots.delete(oldId);
          this.villagerSnapshots.set(e.id, rec);
          liveIds.add(e.id);
        }
        for (const [oldId, rec] of offlinePets.get(key) ?? []) {
          if (liveIds.has(oldId)) continue;
          const e = this.entityManager.spawn(rec.type, rec.x, rec.y, rec.z);
          if (!(e instanceof Mob)) continue;
          e.tamed = true;
          e.sitting = rec.sitting;
          e.owner = rec.owner;
          e.health = Math.max(1, Math.min(e.maxHealth, rec.health));
          this.petSnapshots.delete(oldId);
          this.petSnapshots.set(e.id, rec);
          liveIds.add(e.id);
        }
        if (chunk.entities.length === 0) continue;
        const records = chunk.entities;
        chunk.hadEntities = true;
        chunk.entities = [];
        for (const rec of records) this.spawnSavedEntity(rec);
      }
    }
  }

  /** Recreates one chunk-stored entity with its transform, health and type payload. */
  private spawnSavedEntity(rec: SavedChunkEntity): void {
    const e = this.entityManager.spawn(rec.type, rec.x, rec.y, rec.z);
    if (!e) return;
    e.x = rec.x; e.y = rec.y; e.z = rec.z;
    e.xo = rec.x; e.yo = rec.y; e.zo = rec.z;
    e.yaw = rec.yaw; e.yRotO = rec.yaw;
    e.pitch = rec.pitch; e.xRotO = rec.pitch;
    e.vx = rec.vx; e.vy = rec.vy; e.vz = rec.vz;
    if (rec.health !== undefined && e instanceof LivingEntity) e.setHealth(rec.health);
    const data = rec.data ?? {};
    if (e instanceof Mob) {
      if (typeof data.age === 'number') e.setAge(data.age);
      if (e instanceof Sheep) {
        if (typeof data.woolColor === 'number') e.woolColor = data.woolColor;
        if (data.sheared === true || data.sheared === 1) e.sheared = true;
      }
      if (e instanceof IronGolem && (data.playerCreated === true || data.playerCreated === 1)) {
        e.playerCreated = true;
      }
      if (e instanceof Llama && typeof data.variant === 'number') e.variant = data.variant;
      if (e instanceof WanderingTrader) {
        if (typeof data.despawnDelay === 'number') e.setDespawnDelay(data.despawnDelay);
        if (Array.isArray(data.offers)) {
          e.offers = data.offers.map((raw) =>
            MerchantOffer.fromJSON(raw as MerchantOfferJSON, this.survival.registry));
        }
      }
      if (e instanceof TraderLlama && typeof data.despawnDelay === 'number') {
        e.despawnDelay = data.despawnDelay;
      }
    } else if (e instanceof ItemEntity) {
      const stack = this.stackFromData(data.stack);
      if (!stack.isEmpty()) e.item = stack;
      if (typeof data.age === 'number') e.age = data.age;
      if (typeof data.pickupDelay === 'number') e.pickupDelay = data.pickupDelay;
    } else if (e instanceof Minecart || e instanceof Boat) {
      const slots = Array.isArray(data.items) ? data.items : [];
      const size = e.inventory.getContainerSize();
      for (const raw of slots) {
        const saved = raw as ItemStackData;
        const slot = Number(saved.slot);
        if (!Number.isInteger(slot) || slot < 0 || slot >= size) continue;
        const stack = this.stackFromData(saved);
        if (!stack.isEmpty()) e.inventory.setItem(slot, stack);
      }
    } else if (e instanceof ExperienceOrb) {
      if (typeof data.value === 'number') e.value = data.value;
    }
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
      // Vanilla MouseHandler accumulates deltas; turnPlayer() applies them once per frame.
      this.pendingLookX += e.movementX;
      this.pendingLookY += e.movementY;
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
      if (e.code === 'KeyQ' && !e.repeat) {
        this.dropSelectedItem(e.ctrlKey);
        e.preventDefault();
        return;
      }
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
      // Bow release is handled in pointerup (hold to charge).
      if (e.button === 1) this.pickBlock();
    });
    document.addEventListener('pointerup', (e) => {
      if (!e.isPrimary) return;
      if (e.button === 0) this.mining = false;
      if (e.button === 2 && !this.screens.current) this.releaseBow();
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
    if (this.sleeping) return;
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
    // VehicleEntity.hurt: a cart is destroyed by a hit (survival drops it, creative
    // does not); a boat accumulates damage and breaks after 40 (five bare-hand hits).
    const vehicle = this.findVehicleTarget(Math.min(3.5, blockDistance + 0.25));
    if (vehicle instanceof Minecart) {
      this.breakMinecart(vehicle);
      return;
    }
    if (vehicle instanceof Boat) {
      this.hitBoat(vehicle);
      return;
    }
    const target = this.findEntityTarget(Math.min(3.5, blockDistance + 0.25));
    if (target) {
      const damage = this.meleeDamage(this.survival.getSelectedStack().item?.name ?? '');
      target.hurt(damage, this.entityManager.getPlayerTarget());
      this.stats.award('custom', 'damage_dealt', Math.round(damage * 10));
      return;
    }

    // Creative breaks instantly and drops nothing; survival only *starts* mining — the progress
    // and the drop are handled by BlockBreaking in tick().
    if (this.options.gamemode !== 'creative') return;
    if (!blockHit) return;
    const hit = blockHit;
    const broken = this.level.getBlockState(hit.x, hit.y, hit.z);
    if (broken !== 0) this.stats.award('mined', this.mc.blockOf(broken).name);
    if (broken !== 0) this.advancements.trigger('mine_block', { block: this.mc.blockOf(broken).name });
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

  /** Same slab ray as findEntityTarget, but for vehicles (minecarts and boats). */
  private findVehicleTarget(maxDistance: number): Minecart | Boat | null {
    const eye = this.cameraEye();
    const dir = this.lookVector();
    let best: Minecart | Boat | null = null;
    let bestT = maxDistance;
    for (const entity of this.entityManager.getEntities()) {
      if (!(entity instanceof Minecart) && !(entity instanceof Boat)) continue;
      if (entity.isRemoved()) continue;
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
    if (this.sleeping) { this.survival.breaking.reset(); return; }
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
    this.stats.award('mined', this.mc.blockOf(state).name);
    this.advancements.trigger('mine_block', { block: this.mc.blockOf(state).name });
    this.level.setBlockState(hit.x, hit.y, hit.z, 0);
    this.updateNeighbors(hit.x, hit.y, hit.z);
    this.breakEffects(state, hit.x, hit.y, hit.z);
    for (const stack of drops) this.dropItem(stack, hit.x, hit.y, hit.z);
    this.attackCooldown = 4;
    this.player.swingHand();
  }

  /**
   * Source: Sheep.shear (ShearsItem.useOn). Drops 1..3 wool of the sheep's DyeColor
   * (creative also drops; vanilla only skips the shears durability in creative).
   */
  private shearSheep(sheep: Sheep): void {
    if (sheep.sheared) return;
    sheep.sheared = true;
    const count = 1 + Math.floor(Math.random() * 3);
    const item = this.survival.registry.byName(`minecraft:${sheep.woolItem}`);
    if (item) this.dropItem(new ItemStack(item, count), sheep.x, sheep.y + 0.6, sheep.z);
    this.sounds.play('entity.sheep.shear', sheep.x, sheep.y + 0.5, sheep.z, 1, 1);
  }

  /** LivingEntity.die -> Entity loot table + mob XP. */
  private dropMobLoot(entity: Entity): void {
    const type = entity.getTypeName();
    const playerKill = entity instanceof LivingEntity
      && entity.getLastHurtBy() === this.entityManager.getPlayerTarget();
    if (playerKill) {
      this.stats.award('killed', type);
      this.stats.award('custom', 'mob_kills');
      this.advancements.trigger('player_killed_entity', { entity: type });
    }
    // Baby animals drop neither loot nor experience (no loot table for babies).
    if (entity instanceof Mob && entity.isBaby()) return;
    const rng = this.survival.random;
    const looting = playerKill ? this.survival.getSelectedStack().getEnchantmentLevel('looting') : 0;
    for (const drop of Game.MOB_LOOT[type] ?? []) {
      const [name, min, max, chance, lootingBonus, playerOnly] = drop;
      if (playerOnly && !playerKill) continue;
      const dropChance = chance === undefined
        ? 1
        : chance + (lootingBonus ?? 0) * looting;
      if (dropChance < 1 && rng.nextFloat() > dropChance) continue;
      let count = min + rng.nextInt(max - min + 1);
      if (count > 0 && looting > 0) count += rng.nextInt(looting + 1);
      if (count <= 0) continue;
      const dropName = entity.isOnFire() ? (Game.COOKED_MEAT[name] ?? name) : name;
      const item = this.survival.registry.byName(dropName);
      if (item) this.dropItem(new ItemStack(item, count), entity.x, entity.y + 0.5, entity.z);
    }
    if (entity instanceof Sheep && !entity.sheared) {
      const wool = this.survival.registry.byName(entity.woolItem);
      if (wool) this.dropItem(new ItemStack(wool, 1), entity.x, entity.y + 0.5, entity.z);
    }
    // Vanilla Mob.dropEquipment: 8.5% base chance, +1% per Looting level.
    if (entity instanceof LivingEntity) {
      const chance = 0.085 + looting * 0.01;
      for (const stack of entity.equipment) {
        if (!stack || rng.nextFloat() >= chance) continue;
        const item = this.survival.registry.byName(stack.id);
        if (item) this.dropItem(new ItemStack(item, stack.count), entity.x, entity.y + 0.5, entity.z);
      }
    }
    const base = Game.MOB_XP[type] ?? 0;
    if (base > 0) {
      const xp = base + rng.nextInt(3);
      this.entityManager.spawnEntity(new ExperienceOrb(this.level, entity.x, entity.y + 0.5, entity.z, xp));
    }
  }

  /** Spawns a dropped ItemStack as an ItemEntity. Coordinates default to the player's feet. */
  private dropItem(stack: ItemStack, x?: number, y?: number, z?: number): void {
    if (!stack || stack.isEmpty()) return;
    const px = x === undefined ? this.player.pos.x : x + 0.5;
    const py = y === undefined ? this.player.pos.y + 1.2 : y + 0.25;
    const pz = z === undefined ? this.player.pos.z : z + 0.5;
    const entity = new ItemEntity(this.level, px, py, pz, stack.copy());
    entity.setPickupDelay(10);
    this.entityManager.spawnEntity(entity);
  }

  // ------------------------------------------------------- environment / fx

  /** Texture-array layer for a block state, used by the BLOCK particle sprite. */
  private blockLayerFor(state: number): number {
    const name = this.mc.blockOf(state).name;
    // Vanilla picks the blockstate's `particle` texture, which for these blocks is dirt. Their
    // own top texture is a grayscale mask that needs the biome tint, and the particle shader has
    // no tint - it rendered as grey gravel chunks instead of brown dirt.
    if (name === 'grass_block' || name === 'mycelium' || name === 'podzol'
      || name === 'dirt_path' || name === 'farmland') {
      const dirt = this.textures.blockTextureLayer('block/dirt');
      if (dirt >= 0) return dirt;
    }
    for (const candidate of [`block/${name}`, `block/${name}_top`, `block/${name}_side`, `block/${name}_still`]) {
      const layer = this.textures.blockTextureLayer(candidate);
      if (layer >= 0) return layer;
    }
    return state % 1230;
  }

  /**
   * BlockTintSource#colorAsTerrainParticle for the terrain break burst. Grass block explicitly
   * opts out ("return -1") because its particle sprite is dirt; plant/leaf sprites are greyscale
   * and do need the biome colour.
   */
  private particleBlockTint(state: number, x: number, y: number, z: number): [number, number, number] {
    const name = this.mc.blockOf(state).name;
    if (name === 'grass_block') return [1, 1, 1];
    if (name === 'redstone_wire') return redstoneWireTint(this.mc.getProp(state, 'power'));
    const bx = Math.floor(x), by = Math.floor(y), bz = Math.floor(z);
    const biome = this.level.getBiome(bx, by, bz);
    return this.biomeColors.blockTint(name, biome, 0, bx, bz, by);
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
    // JukeboxBlock.onRemove: breaking the playing jukebox stops the record and pops the disc.
    if (this.mc.blockOf(state).name === 'jukebox') {
      const key = `${x},${y},${z}`;
      const song = this.jukeboxSongs.get(key);
      this.jukeboxSongs.delete(key);
      this.clearJukeboxRecord(x, y, z);
      if (this.playingJukeboxKey === key) {
        this.recordHandle?.stop();
        this.recordHandle = null;
        this.playingJukeboxKey = null;
        this.recordStartMs = 0;
      }
      if (song) {
        this.dropItem(ItemStack.fromName(this.survival.registry, `music_disc_${song}`, 1), x, y, z);
      }
    }
    // Vanilla container blocks drop every stored stack when broken.
    const brokenName = this.mc.blockOf(state).name;
    if (this.isContainerBlock(brokenName)) this.dropBlockContainer(brokenName, x, y, z);
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
    // Post off draws straight into the canvas, so the viewport/target must switch back to the full
    // drawing buffer (and back to the scaled HDR target when it is re-enabled).
    this.applyRenderScale();
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
  /** Vanilla mobGriefing gamerule: MOB explosions break blocks while true. */
  private mobGriefing = true;
  /** GameRules.TNT_EXPLOSION_DROP_DECAY / MOB_EXPLOSION_DROP_DECAY (both default true). */
  private tntExplosionDropDecay = true;
  private mobExplosionDropDecay = true;

  // ---- bed sleeping (ServerPlayer.startSleepInBed / stopSleepInBed) ----
  private sleeping = false;
  /** Local player's active minecart ride (null when on foot). */
  private ridingMinecart: Minecart | null = null;
  /** Local player's active boat ride (null when on foot). */
  private ridingBoat: Boat | null = null;
  private sleepTicks = 0;
  /** 0..1 black overlay while falling asleep / waking up. */
  private sleepFade = 0;
  /** Spawn point set by the last bed the player slept in. */
  private bedSpawn: { x: number; y: number; z: number } | null = null;

  /** DamageSource types that are not entities (Stats.ENTITY_KILLED_BY needs an entity type). */
  private static readonly ENVIRONMENTAL_DEATHS: ReadonlySet<string> = new Set([
    'explosion', 'fall', 'void', 'lava', 'fire', 'drown', 'starve', 'magic', 'mob',
    'generic', 'out_of_world', 'lightning', 'cactus', 'sweet_berry_bush', 'stalagmite',
    'in_wall', 'cramming', 'fly_into_wall', 'hot_floor', 'on_fire', 'in_fire', 'campfire',
  ]);

  /** Vanilla fishing loot pools (FishingHook + BuiltInLootTables.FISHING). */
  private static readonly FISHING_FISH: readonly (readonly [string, number])[] = [
    ['cod', 60], ['salmon', 25], ['tropical_fish', 2], ['pufferfish', 13],
  ];
  private static readonly FISHING_JUNK: readonly (readonly [string, number])[] = [
    ['lily_pad', 17], ['leather', 10], ['leather_boots', 10], ['rotten_flesh', 10],
    ['stick', 5], ['string', 5], ['water_bottle', 10], ['bone', 10], ['ink_sac', 1],
    ['tripwire_hook', 10], ['bamboo', 10],
  ];
  private static readonly FISHING_TREASURE: readonly (readonly [string, number])[] = [
    ['bow', 1], ['enchanted_book', 1], ['fishing_rod', 1], ['name_tag', 1],
    ['nautilus_shell', 1], ['saddle', 1],
  ];

  /** Vanilla entity loot tables, simplified to item/min/max/(chance, looting bonus, player-only). */
  private static readonly MOB_LOOT: Readonly<Record<string, readonly (readonly [string, number, number, number?, number?, boolean?])[]>> = {
    zombie: [
      ['rotten_flesh', 0, 2],
      ['iron_ingot', 1, 1, 0.025, 0.01, true],
      ['carrot', 1, 1, 0.025, 0.01, true],
      ['potato', 1, 1, 0.025, 0.01, true],
    ],
    husk: [
      ['rotten_flesh', 0, 2],
      ['iron_ingot', 1, 1, 0.025, 0.01, true],
      ['carrot', 1, 1, 0.025, 0.01, true],
      ['potato', 1, 1, 0.025, 0.01, true],
    ],
    drowned: [
      ['rotten_flesh', 0, 2],
      ['copper_ingot', 1, 3, 0.11, 0.02, true],
    ],
    skeleton: [['bone', 0, 2], ['arrow', 0, 2]],
    stray: [['bone', 0, 2], ['arrow', 0, 2]],
    bogged: [['bone', 0, 2], ['arrow', 0, 2]],
    parched: [['bone', 0, 2], ['arrow', 0, 2]],
    wither_skeleton: [
      ['coal', 0, 1], ['bone', 0, 2], ['wither_skeleton_skull', 1, 1, 0.025, 0.01, true],
    ],
    creeper: [['gunpowder', 0, 2]],
    spider: [['string', 0, 2], ['spider_eye', 0, 1]],
    cave_spider: [['string', 0, 2], ['spider_eye', 0, 1]],
    enderman: [['ender_pearl', 0, 1]],
    slime: [['slime_ball', 0, 2]],
    magma_cube: [['magma_cream', 0, 1]],
    witch: [
      ['glowstone_dust', 0, 2], ['redstone', 0, 2], ['sugar', 0, 2],
      ['spider_eye', 0, 2], ['glass_bottle', 0, 2], ['stick', 0, 2],
    ],
    pig: [['porkchop', 1, 3]],
    cow: [['beef', 1, 3], ['leather', 0, 2]],
    mooshroom: [['beef', 1, 3], ['leather', 0, 2]],
    sheep: [['mutton', 1, 2]],
    chicken: [['chicken', 1, 1], ['feather', 0, 2]],
    rabbit: [['rabbit', 0, 1], ['rabbit_hide', 0, 1], ['rabbit_foot', 0, 1, 0.1]],
    parrot: [['feather', 0, 2]],
    squid: [['ink_sac', 1, 3]],
    glow_squid: [['glow_ink_sac', 1, 3]],
    cod: [['cod', 1, 1], ['bone_meal', 0, 1]],
    salmon: [['salmon', 1, 1], ['bone_meal', 0, 1]],
    zombified_piglin: [['rotten_flesh', 0, 1], ['gold_nugget', 0, 1]],
    iron_golem: [['iron_ingot', 3, 5], ['poppy', 0, 2]],
  };

  /** On-fire meat drops use the cooked variant (LootTable smelt function). */
  private static readonly COOKED_MEAT: Readonly<Record<string, string>> = {
    porkchop: 'cooked_porkchop', beef: 'cooked_beef', mutton: 'cooked_mutton',
    chicken: 'cooked_chicken', rabbit: 'cooked_rabbit', cod: 'cooked_cod', salmon: 'cooked_salmon',
    potato: 'baked_potato',
  };

  /** Base XP per mob; the final orb is base + random(0..2). */
  private static readonly MOB_XP: Readonly<Record<string, number>> = {
    zombie: 5, husk: 5, drowned: 5, skeleton: 5, stray: 5, bogged: 5, parched: 5,
    wither_skeleton: 5, creeper: 5, spider: 5, cave_spider: 5, enderman: 5,
    slime: 4, magma_cube: 4, witch: 5, zombified_piglin: 5,
    pig: 1, cow: 1, mooshroom: 1, sheep: 1, chicken: 1, rabbit: 1, parrot: 1,
    squid: 1, glow_squid: 1, cod: 1, salmon: 1,
  };

  /**
   * Explosion (net/minecraft/world/level/ServerExplosion): damages entities by distance and
   * breaks blocks via the vanilla 1352 boundary rays. Block destruction uses the blast
   * radius (power), while damage/knockback use radius * 2; TNT/mob explosions apply the
   * default explosionDropDecay gamerules (each dropped item survives with chance 1/radius).
   * `interaction` is Level.ExplosionInteraction: TNT always breaks blocks, mob
   * explosions (creeper) only while the mobGriefing gamerule is on.
   */
  private explode(x: number, y: number, z: number, power: number,
    interaction: 'mob' | 'tnt' = 'mob', owner: Targetable | null = null): void {
    // Explosion.java: playSound(EntityType.GENERIC_EXPLODE, 4.0F, (1 + (random - random) * 0.2))
    this.sounds.play('entity.generic.explode', x, y, z, 4, 0.9 + Math.random() * 0.2);
    spawnExplosion(x, y, z, power / 2);
    const radius = Math.max(1e-5, power);
    const damageRange = power * 2;
    // Level.ExplosionInteraction.MOB destroys blocks only while the mobGriefing gamerule is on.
    if (interaction === 'tnt' || this.mobGriefing) {
      const destroyed = this.collectExplosionBlocks(x, y, z, radius);
      const decay = interaction === 'tnt' ? this.tntExplosionDropDecay : this.mobExplosionDropDecay;
      const rng = this.survival.random;
      for (const pos of destroyed) {
        const state = this.level.getBlockState(pos.x, pos.y, pos.z);
        if (state === 0) continue;
        const meta = this.mc.blockOf(state);
        // TntBlock.wasExploded: a nearby TNT block is primed, not destroyed.
        if (meta.name === 'tnt') {
          this.level.setBlockState(pos.x, pos.y, pos.z, 0);
          this.primeTnt(pos.x + 0.5, pos.y, pos.z + 0.5, 10 + Math.floor(Math.random() * 10), owner);
          continue;
        }
        const drops = this.survival.breakBlock((qx, qy, qz) => this.level.getBlockState(qx, qy, qz), pos.x, pos.y, pos.z, true);
        this.level.setBlockState(pos.x, pos.y, pos.z, 0);
        for (const stack of drops) {
          // ApplyExplosionDecay: every item survives with probability 1/radius.
          if (decay) {
            let kept = 0;
            for (let i = 0; i < stack.getCount(); i++) if (rng.nextFloat() <= 1 / radius) kept++;
            if (kept <= 0) continue;
            stack.setCount(kept);
          }
          this.dropItem(stack, pos.x, pos.y, pos.z);
        }
        this.breakEffects(state, pos.x, pos.y, pos.z);
      }
      for (const pos of destroyed) this.updateNeighbors(pos.x, pos.y, pos.z);
      this.redstone.onBlocksChanged(destroyed);
    }

    // ServerExplosion.hurtEntities: distance from the entity position, exposure from
    // the vanilla 16^3 AABB samples; blocks between the entity and the centre reduce
    // both damage and knockback.
    for (const e of this.entityManager.getEntities()) {
      if (e.isRemoved() || !(e instanceof LivingEntity) || !e.isAlive()) continue;
      const dist = Math.hypot(e.x - x, e.y - y, e.z - z) / damageRange;
      if (dist > 1) continue;
      const exposure = this.explosionSeenPercent(x, y, z, e.getBoundingBox());
      const q = (1 - dist) * exposure;
      const eyeY = e.getEyeY();
      const nx = e.x - x, ny = eyeY - y, nz = e.z - z;
      const len = Math.hypot(nx, ny, nz) || 1;
      e.push((nx / len) * q, (ny / len) * q, (nz / len) * q);
      e.hurt(((q * q + q) / 2) * 7 * damageRange + 1, owner);
    }

    // Player damage: creative players are invulnerable (spectator is not a supported mode yet).
    if (this.options.gamemode !== 'creative') {
      const px = this.player.pos.x, py = this.player.pos.y, pz = this.player.pos.z;
      const dist = Math.hypot(px - x, py - y, pz - z) / damageRange;
      if (dist <= 1) {
        const exposure = this.explosionSeenPercent(x, y, z, this.player.boundingBox());
        const q = (1 - dist) * exposure;
        this.survival.damage(((q * q + q) / 2) * 7 * damageRange + 1, 'explosion');
        const eyeY = this.player.eyeY;
        const nx = px - x, ny = eyeY - y, nz = pz - z;
        const len = Math.hypot(nx, ny, nz) || 1;
        this.player.vel = new Vec3(
          this.player.vel.x + (nx / len) * q,
          Math.max(this.player.vel.y, (ny / len) * q + 0.1),
          this.player.vel.z + (nz / len) * q,
        );
      }
    }
  }

  /**
   * ServerExplosion.getSeenPercent: sample the entity AABB on the vanilla grid and
   * count the samples whose segment to the explosion centre is not blocked by a
   * collidable block. The fraction scales damage and knockback.
   */
  private explosionSeenPercent(x: number, y: number, z: number,
    box: { minX: number; minY: number; minZ: number; maxX: number; maxY: number; maxZ: number }): number {
    const xs = 1 / ((box.maxX - box.minX) * 2 + 1);
    const ys = 1 / ((box.maxY - box.minY) * 2 + 1);
    const zs = 1 / ((box.maxZ - box.minZ) * 2 + 1);
    const xOffset = (1 - Math.floor(1 / xs) * xs) / 2;
    const zOffset = (1 - Math.floor(1 / zs) * zs) / 2;
    let hits = 0;
    let count = 0;
    for (let xx = 0; xx <= 1; xx += xs) {
      for (let yy = 0; yy <= 1; yy += ys) {
        for (let zz = 0; zz <= 1; zz += zs) {
          count++;
          const sx = box.minX + (box.maxX - box.minX) * xx + xOffset;
          const sy = box.minY + (box.maxY - box.minY) * yy;
          const sz = box.minZ + (box.maxZ - box.minZ) * zz + zOffset;
          if (!this.segmentBlocked(sx, sy, sz, x, y, z)) hits++;
        }
      }
    }
    return count > 0 ? hits / count : 0;
  }

  /** ClipContext.Block.COLLIDER equivalent: does any collision shape cross the segment? */
  private segmentBlocked(fx: number, fy: number, fz: number, tx: number, ty: number, tz: number): boolean {
    const dx = tx - fx, dy = ty - fy, dz = tz - fz;
    const len = Math.hypot(dx, dy, dz);
    if (len < 1e-6) return false;
    const nx = dx / len, ny = dy / len, nz = dz / len;
    const from = new Vec3(fx, fy, fz);
    const to = new Vec3(tx, ty, tz);
    let bx = Math.floor(fx), by = Math.floor(fy), bz = Math.floor(fz);
    const stepX = Math.sign(nx), stepY = Math.sign(ny), stepZ = Math.sign(nz);
    const tDeltaX = stepX !== 0 ? Math.abs(1 / nx) : Infinity;
    const tDeltaY = stepY !== 0 ? Math.abs(1 / ny) : Infinity;
    const tDeltaZ = stepZ !== 0 ? Math.abs(1 / nz) : Infinity;
    let tMaxX = stepX > 0 ? (Math.floor(fx) + 1 - fx) * tDeltaX
      : stepX < 0 ? (fx - Math.floor(fx)) * tDeltaX : Infinity;
    let tMaxY = stepY > 0 ? (Math.floor(fy) + 1 - fy) * tDeltaY
      : stepY < 0 ? (fy - Math.floor(fy)) * tDeltaY : Infinity;
    let tMaxZ = stepZ > 0 ? (Math.floor(fz) + 1 - fz) * tDeltaZ
      : stepZ < 0 ? (fz - Math.floor(fz)) * tDeltaZ : Infinity;
    for (let i = 0; i < 128; i++) {
      const state = this.level.getBlockState(bx, by, bz);
      if (state !== 0) {
        for (const shape of this.mc.collision(state)) {
          if (shape.move(bx, by, bz).clip(from, to)) return true;
        }
      }
      if (tMaxX < tMaxY && tMaxX < tMaxZ) {
        if (tMaxX > len) break;
        bx += stepX; tMaxX += tDeltaX;
      } else if (tMaxY < tMaxZ) {
        if (tMaxY > len) break;
        by += stepY; tMaxY += tDeltaY;
      } else {
        if (tMaxZ > len) break;
        bz += stepZ; tMaxZ += tDeltaZ;
      }
    }
    return false;
  }

  /**
   * ServerExplosion.calculateExplodedPositions: 1352 rays from the 16x16x16 cube boundary,
   * each starting with radius * (0.7 .. 1.3) and losing (resistance + 0.3) * 0.3 per 0.3
   * step, plus the constant 0.225 decay. Only blocks still reached are returned.
   */
  private collectExplosionBlocks(x: number, y: number, z: number, radius: number): { x: number; y: number; z: number }[] {
    const rng = this.survival.random;
    const found = new Map<string, { x: number; y: number; z: number }>();
    const minY = this.level.minY;
    const maxY = this.level.minY + this.level.height - 1;
    for (let xx = 0; xx < 16; xx++) {
      for (let yy = 0; yy < 16; yy++) {
        for (let zz = 0; zz < 16; zz++) {
          if (xx !== 0 && xx !== 15 && yy !== 0 && yy !== 15 && zz !== 0 && zz !== 15) continue;
          let xd = (xx / 15) * 2 - 1;
          let yd = (yy / 15) * 2 - 1;
          let zd = (zz / 15) * 2 - 1;
          const len = Math.hypot(xd, yd, zd);
          if (len === 0) continue;
          xd /= len; yd /= len; zd /= len;
          let remaining = radius * (0.7 + rng.nextFloat() * 0.6);
          let px = x, py = y, pz = z;
          while (remaining > 0) {
            const bx = Math.floor(px), by = Math.floor(py), bz = Math.floor(pz);
            if (by < minY || by > maxY) break;
            const state = this.level.getBlockState(bx, by, bz);
            if (state !== 0) {
              // BlockBehaviour.getExplosionResistance: fluids/blocks use their blast resistance.
              const resistance = this.mc.blockOf(state).resistance;
              remaining -= (resistance + 0.3) * 0.3;
            }
            if (remaining > 0 && state !== 0) {
              found.set(`${bx},${by},${bz}`, { x: bx, y: by, z: bz });
            }
            px += xd * 0.3; py += yd * 0.3; pz += zd * 0.3;
            remaining -= 0.22500001;
          }
        }
      }
    }
    return [...found.values()];
  }

  /** PrimedTnt: create the entity and play TNT_PRIMED (TntBlock.prime). */
  private primeTnt(x: number, y: number, z: number, fuse: number, owner: Targetable | null = null): void {
    const tnt = this.entityManager.spawn('tnt', x, y, z);
    if (!(tnt instanceof PrimedTnt)) return;
    tnt.setFuse(fuse);
    tnt.setOwner(owner);
    this.sounds.play('entity.tnt.primed', x, y, z, 1, 1);
  }

  /** Player death: drop inventory + XP, open the vanilla DeathScreen. */
  private onPlayerDeath(): void {
    this.sleeping = false;
    this.sleepTicks = 0;
    this.sleepFade = 0;
    this.stats.award('custom', 'deaths');
    // Stats.ENTITY_KILLED_BY: the damage source is the attacker's entity type name (PlayerTarget
    // forwards getTypeName()); environmental causes are not entity types.
    const cause = this.survival.lastHurtBy;
    if (cause && !Game.ENVIRONMENTAL_DEATHS.has(cause)) this.stats.award('killed_by', cause);
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
    this.sleeping = false;
    this.sleepTicks = 0;
    this.sleepFade = 0;
    // ServerPlayer.setRespawnPosition -> respawn at the last bed when it still exists.
    if (this.bedSpawn) {
      const b = this.bedSpawn;
      const bedState = this.level.getBlockState(b.x, b.y - 1, b.z);
      if (bedState !== 0 && this.mc.blockOf(bedState).name.endsWith('_bed')) {
        const cx = b.x >> 4, cz = b.z >> 4;
        for (let dz = -1; dz <= 1; dz++) {
          for (let dx = -1; dx <= 1; dx++) this.level.ensureChunk(cx + dx, cz + dz);
        }
        this.player.pos.x = b.x + 0.5;
        this.player.pos.y = b.y;
        this.player.pos.z = b.z + 0.5;
        this.player.prevPos.x = this.player.pos.x;
        this.player.prevPos.y = this.player.pos.y;
        this.player.prevPos.z = this.player.pos.z;
        this.lastStatX = this.player.pos.x;
        this.lastStatZ = this.player.pos.z;
      } else {
        this.bedSpawn = null;
      }
    }
    // A respawn is a teleport: the previous frame's depth/colour history would smear.
    this.renderer.post.invalidateHistory();
    this.playerFireTicks = 0;
    this.keys.clear();
    // The entity manager holds a PlayerTarget proxy that points at the old Player instance.
    this.entityManager.setPlayer(this.player);
    this.screens.close();
    this.autosave?.resume();
  }

  /** Per-block container instances: chest/furnace contents survive closing the GUI this session. */
  private readonly blockContainers = new Map<string, AbstractContainerMenu>();
  /** JukeboxBlockEntity song per position, restored from the persisted block entity records. */
  private readonly jukeboxSongs = new Map<string, string>();
  /** data/jukebox_songs.json: JukeboxSong.comparatorOutput / length / sound event per song. */
  private jukeboxSongData: {
    songs: Record<string, { comparatorOutput: number; lengthSeconds: number; soundEvent: string }>;
  } = { songs: {} };
  private recordHandle: { stop(): void } | null = null;
  private playingJukeboxKey: string | null = null;
  /** performance.now() when the audible record started (for ticks_since_song_started). */
  private recordStartMs = 0;
  /** A restored jukebox is waiting for the sound assets/context before it can play. */
  private pendingJukeboxResume = false;
  /** Client-side redstone simulation (wire power, diodes, buttons, plates, mechanisms). */
  private redstone!: RedstoneSystem;

  /**
   * Opens the vanilla container GUI for a right-clicked block. The menu itself comes from the
   * vanilla menu ports in SurvivalState (CraftingMenu / ChestMenu / FurnaceMenu); chest and furnace
   * instances are cached per block position so their contents are kept while the session lives
   * (this client has no block-entity ticker, so a furnace only cooks while its GUI is open).
   */
  private openBlockContainer(blockName: string, x: number, y: number, z: number): void {
    if (blockName === 'enchanting_table') {
      // EnchantmentTableBlock.getEnchantmentPower: bookshelves within ±2 blocks and two layers.
      let power = 0;
      for (let dz = -2; dz <= 2; dz++) {
        for (let dx = -2; dx <= 2; dx++) {
          for (let dy = 0; dy <= 1; dy++) {
            if (this.mc.blockOf(this.level.getBlockState(x + dx, y + dy, z + dz)).name === 'bookshelf') power++;
          }
        }
      }
      power = Math.min(15, power);
      const key = `enchanting_table@${x},${y},${z}`;
      let menu = this.blockContainers.get(key);
      if (!menu) {
        menu = this.survival.openEnchantingTable(power);
        this.blockContainers.set(key, menu);
      } else {
        this.survival.activeMenu = menu;
      }
      this.openScreen('enchanting');
      return;
    }
    if (blockName === 'brewing_stand') {
      // Brewing stand contents + timer/fuel live in the cached menu instance; the menu
      // advances while its GUI is open (tickActiveMenu), like the furnace output.
      const key = `brewing_stand@${x},${y},${z}`;
      let menu = this.blockContainers.get(key);
      if (!menu) {
        const brewing = this.survival.openBrewingStand();
        brewing.onBrew = () => this.sounds.play(
          'block.brewing_stand.brew',
          this.player.pos.x, this.player.pos.y, this.player.pos.z, 1, 1,
        );
        menu = brewing;
        this.blockContainers.set(key, menu);
        this.restoreBlockContainer('brewing_stand', x, y, z, brewing.container);
      } else {
        this.survival.activeMenu = menu;
      }
      this.openScreen('brewing');
      return;
    }
    if (blockName === 'crafting_table') {
      this.stats.award('custom', 'interact_with_crafting_table');
      this.survival.openCraftingTable();
      this.openScreen('crafting');
      return;
    }
    const isFurnace = blockName === 'furnace';
    if (isFurnace) this.stats.award('custom', 'interact_with_furnace');
    else this.stats.award('custom', 'open_chest');
    // The cache key includes the block type: the same position may hold a chest at one moment and
    // a furnace later (tests/sandbox both do this), and the menu classes are not interchangeable.
    const key = `${blockName}@${x},${y},${z}`;
    let menu = this.blockContainers.get(key);
    if (!menu) {
      menu = isFurnace ? this.survival.openFurnace() : this.survival.openChest(3);
      this.blockContainers.set(key, menu);
      const container = (menu as unknown as { container?: Container }).container;
      if (container) this.restoreBlockContainer(blockName, x, y, z, container);
    } else {
      this.survival.activeMenu = menu;
    }
    this.openScreen(isFurnace ? 'furnace' : 'chest');
  }

  // ------------------------------------------------------------ container records

  /** Blocks whose contents live in a block entity record (chest/furnace/brewing/...). */
  private isContainerBlock(name: string): boolean {
    return name === 'chest' || name === 'trapped_chest' || name === 'barrel'
      || name === 'furnace' || name === 'blast_furnace' || name === 'smoker'
      || name === 'brewing_stand' || name === 'hopper' || name === 'dispenser'
      || name === 'dropper' || name.includes('shulker_box');
  }

  /** Seeds a freshly opened menu from the persisted block entity record. */
  private restoreBlockContainer(name: string, x: number, y: number, z: number, container: Container): void {
    const chunk = this.level.getChunk(x >> 4, z >> 4);
    const rec = chunk?.getBlockEntity(x & 15, y, z & 15);
    if (!rec || rec.type.replace(/^minecraft:/, '') !== name) return;
    const items = (rec.data as { items?: unknown }).items;
    if (!Array.isArray(items)) return;
    const size = container.getContainerSize();
    for (const raw of items) {
      const slot = Number((raw as { slot?: unknown } | null)?.slot);
      if (!Number.isInteger(slot) || slot < 0 || slot >= size) continue;
      const stack = this.stackFromData(raw);
      if (!stack.isEmpty()) container.setItem(slot, stack);
    }
  }

  /** Writes a container's slots into its chunk block entity (same shape as the player save). */
  private writeBlockContainer(name: string, x: number, y: number, z: number, container: Container): void {
    const chunk = this.level.getChunk(x >> 4, z >> 4);
    if (!chunk) return;
    const items: ItemStackData[] = [];
    for (let i = 0; i < container.getContainerSize(); i++) {
      const stack = container.getItem(i);
      if (!stack.isEmpty()) items.push(this.stackData(stack, i));
    }
    chunk.addBlockEntity(x & 15, y, z & 15, { type: `minecraft:${name}`, data: { items } });
    chunk.dirtySections.add(y >> 4);
  }

  /** Called once per save cycle: freeze every open container into its block entity. */
  private persistBlockContainers(): void {
    for (const [key, menu] of this.blockContainers) {
      const m = /^([a-z_]+)@(-?\d+),(-?\d+),(-?\d+)$/.exec(key);
      if (!m || !this.isContainerBlock(m[1])) continue;
      const container = (menu as unknown as { container?: Container }).container;
      if (!container) continue;
      this.writeBlockContainer(m[1], Number(m[2]), Number(m[3]), Number(m[4]), container);
    }
  }

  /**
   * Container.getRedstoneSignalFromContainer computed from the persisted record, used by
   * comparators before the player has opened the container in this session.
   */
  private containerViewFromRecord(
    name: string, x: number, y: number, z: number,
  ): Container | null {
    const chunk = this.level.getChunk(x >> 4, z >> 4);
    const rec = chunk?.getBlockEntity(x & 15, y, z & 15);
    if (!rec || rec.type.replace(/^minecraft:/, '') !== name) return null;
    const items = Array.isArray((rec.data as { items?: unknown }).items)
      ? (rec.data as { items: unknown[] }).items : [];
    const size = name === 'brewing_stand' ? 5
      : name === 'furnace' || name === 'blast_furnace' || name === 'smoker' ? 3 : 27;
    return {
      getContainerSize: () => size,
      getMaxStackSize: () => 64,
      getItem: (i: number) => this.stackFromData(
        items.find((s) => Number((s as { slot?: unknown } | null)?.slot) === i),
      ),
      setItem: () => undefined,
      isEmpty: () => items.length === 0,
      clearContent: () => undefined,
    } as unknown as Container;
  }

  /** Breaking a container drops every stored stack and clears its record. */
  private dropBlockContainer(name: string, x: number, y: number, z: number): void {
    const key = `${name}@${x},${y},${z}`;
    const menu = this.blockContainers.get(key);
    const dropped: ItemStack[] = [];
    if (menu) {
      const container = (menu as unknown as { container?: Container }).container;
      if (container) {
        for (let i = 0; i < container.getContainerSize(); i++) {
          const stack = container.getItem(i);
          if (stack.isEmpty()) continue;
          dropped.push(stack.copy());
          container.setItem(i, ItemStack.EMPTY);
        }
      }
      this.blockContainers.delete(key);
    } else {
      const chunk = this.level.getChunk(x >> 4, z >> 4);
      const rec = chunk?.getBlockEntity(x & 15, y, z & 15);
      const items = rec && Array.isArray((rec.data as { items?: unknown }).items)
        ? (rec.data as { items: unknown[] }).items : [];
      for (const raw of items) {
        const stack = this.stackFromData(raw);
        if (!stack.isEmpty()) dropped.push(stack);
      }
    }
    const chunk = this.level.getChunk(x >> 4, z >> 4);
    if (chunk) {
      chunk.removeBlockEntity(x & 15, y, z & 15);
      chunk.dirtySections.add(y >> 4);
    }
    for (const stack of dropped) this.dropItem(stack, x, y, z);
  }

  /**
   * JukeboxBlock.useItemOn: insert a music disc (sets has_record and plays the record event at
   * volume 4), or pop the disc back out when the jukebox is playing and the hand is empty.
   * Returns false when the click should fall through to normal item placement.
   */
  private useJukebox(hit: { x: number; y: number; z: number }): boolean {
    const state = this.level.getBlockState(hit.x, hit.y, hit.z);
    const playing = this.mc.getProp(state, 'has_record') === 'true';
    const held = this.survival.getSelectedStack();
    const name = held.item?.name ?? '';
    const key = `${hit.x},${hit.y},${hit.z}`;
    if (!playing && name.startsWith('music_disc_')) {
      const song = name.slice('music_disc_'.length);
      const event = `music_disc.${song}`;
      if (!this.sounds.hasEvent(event)) return false;
      this.level.setBlockState(hit.x, hit.y, hit.z, this.mc.withProp(state, 'has_record', 'true'));
      this.jukeboxSongs.set(key, song);
      this.writeJukeboxRecord(hit.x, hit.y, hit.z, song, 0);
      this.updateNeighbors(hit.x, hit.y, hit.z);
      this.recordHandle?.stop();
      this.recordHandle = this.sounds.play(event, hit.x + 0.5, hit.y + 0.5, hit.z + 0.5, 4, 1);
      this.playingJukeboxKey = key;
      this.recordStartMs = performance.now();
      this.stats.award('custom', 'play_record');
      if (this.options.gamemode !== 'creative') this.survival.inventory.removeFromSelected(false);
      this.useCooldown = 8;
      return true;
    }
    if (playing && held.isEmpty()) {
      this.level.setBlockState(hit.x, hit.y, hit.z, this.mc.withProp(state, 'has_record', 'false'));
      this.clearJukeboxRecord(hit.x, hit.y, hit.z);
      this.updateNeighbors(hit.x, hit.y, hit.z);
      this.recordHandle?.stop();
      this.recordHandle = null;
      this.playingJukeboxKey = null;
      this.recordStartMs = 0;
      const song = this.jukeboxSongs.get(key);
      this.jukeboxSongs.delete(key);
      if (song) {
        this.dropItem(ItemStack.fromName(this.survival.registry, `music_disc_${song}`, 1),
          hit.x, hit.y + 1, hit.z);
      }
      this.useCooldown = 8;
      return true;
    }
    return false;
  }

  /** Player.attack damage for the held item + Strength/Weakness (LivingEntity hurt). */
  private meleeDamage(name: string): number {
    let damage = name.endsWith('_sword') ? 4 : name.endsWith('_axe') ? 6
      : name.endsWith('_pickaxe') ? 3 : name.endsWith('_shovel') ? 2.5 : 1;
    // MobEffects.DAMAGE_BOOST (+3/level) / MobEffects.WEAKNESS (-4/level).
    if (this.survival.hasEffect('strength')) {
      damage += 3 * (this.survival.getEffectLevel('strength') + 1);
    }
    if (this.survival.hasEffect('weakness')) {
      damage = Math.max(0, damage - 4 * (this.survival.getEffectLevel('weakness') + 1));
    }
    return damage;
  }

  /** VehicleEntity.hurtServer for boats: damage accumulates, 40 destroys. */
  private hitBoat(boat: Boat): void {
    const damage = this.meleeDamage(this.survival.getSelectedStack().item?.name ?? '');
    if (boat.hitBy(damage, this.options.gamemode === 'creative')) this.breakBoat(boat);
  }

  /** Destroy a boat: drop the boat item and (for chest boats) the 27 slots. */
  private breakBoat(boat: Boat): void {
    if (this.ridingBoat === boat) this.dismountBoat();
    if (this.options.gamemode !== 'creative') {
      const item = this.survival.registry.byName(boat.getDropItemName());
      if (item) this.dropItem(new ItemStack(item, 1), boat.x - 0.5, boat.y, boat.z - 0.5);
      const slots = boat.inventory.getContainerSize();
      for (let i = 0; i < slots; i++) {
        const stack = boat.inventory.removeItemNoUpdate(i);
        if (!stack.isEmpty()) this.dropItem(stack, boat.x - 0.5, boat.y + 0.2, boat.z - 0.5);
      }
    }
    boat.remove();
    this.player.swingHand();
  }

  /** Destroy a cart: drop the cart item (survival) and any chest contents. */
  private breakMinecart(cart: Minecart): void {
    if (this.ridingMinecart === cart) this.dismountMinecart();
    if (this.options.gamemode !== 'creative') {
      const item = this.survival.registry.byName(cart.kind === 'chest_minecart' ? 'chest_minecart' : 'minecart');
      if (item) this.dropItem(new ItemStack(item, 1), cart.x - 0.5, cart.y, cart.z - 0.5);
      const slots = cart.inventory.getContainerSize();
      for (let i = 0; i < slots; i++) {
        const stack = cart.inventory.removeItemNoUpdate(i);
        if (!stack.isEmpty()) this.dropItem(stack, cart.x - 0.5, cart.y + 0.2, cart.z - 0.5);
      }
    }
    cart.remove();
    this.player.swingHand();
  }

  /** MinecartItem.useOn: only rails accept a cart; a slope spawns it half a block higher. */
  private placeMinecart(hit: { x: number; y: number; z: number }, kind: string): void {
    const state = this.level.getBlockState(hit.x, hit.y, hit.z);
    if (state === 0) return;
    const name = this.mc.blockOf(state).name;
    if (name !== 'rail' && name !== 'powered_rail' && name !== 'detector_rail' && name !== 'activator_rail') {
      return;
    }
    const shape = this.mc.getProp(state, 'shape') ?? 'north_south';
    const offset = shape.startsWith('ascending_') ? 0.5 : 0;
    const x = hit.x + 0.5, y = hit.y + 0.0625 + offset, z = hit.z + 0.5;
    for (const e of this.entityManager.getEntities()) {
      if (e instanceof Minecart && !e.isRemoved()
        && Math.abs(e.x - x) < 0.9 && Math.abs(e.z - z) < 0.9 && Math.abs(e.y - y) < 1) return;
    }
    if (!this.entityManager.spawn(kind, x, y, z)) return;
    if (this.options.gamemode !== 'creative') this.survival.inventory.removeFromSelected(false);
    this.useCooldown = 8;
  }

  /** Minecart.interact: seat the player; the camera follows the cart's position. */
  private mountMinecart(cart: Minecart): void {
    this.ridingMinecart = cart;
    cart.rider = this.player;
    this.player.flying = false;
    this.player.sneaking = false;
    this.player.vel = new Vec3(0, 0, 0);
    this.player.pos.x = cart.x;
    this.player.pos.y = cart.y + 0.35;
    this.player.pos.z = cart.z;
  }

  /** Sneak while riding: step off beside the cart (vanilla DismountHelper). */
  private dismountMinecart(): void {
    const cart = this.ridingMinecart;
    if (!cart) return;
    cart.rider = null;
    this.ridingMinecart = null;
    this.player.pos.x = cart.x + 1.1;
    this.player.pos.y = cart.y + 0.2;
    this.player.pos.z = cart.z;
    this.player.vel = new Vec3(0, 0, 0);
    this.player.onGround = false;
    this.useCooldown = 8;
  }

  /** MinecartChest.interact: a chest menu bound to the cart's 27 slots. */
  private openMinecartChest(cart: Minecart): void {
    this.stats.award('custom', 'open_chest');
    this.survival.openStorageContainer(cart);
    this.openScreen('chest');
    this.sounds.play('block.chest.open', cart.x, cart.y, cart.z, 1, 1);
  }

  // ---- boats ---------------------------------------------------------------

  /** A boat item is any `<wood>_boat` / `<wood>_raft` (plus their chest variants). */
  private isBoatItem(name: string): boolean {
    return name.endsWith('_boat') || name.endsWith('_raft');
  }

  /** FlowingFluid.getHeight for the water/lava cell at (x,y,z); 0 for anything else. */
  private fluidHeightAt(x: number, y: number, z: number): number {
    const state = this.level.getBlockState(x, y, z);
    if (state === 0 || !this.mc.hasFluid(state)) return 0;
    const name = this.mc.blockOf(state).name;
    if (name !== 'water' && name !== 'lava') return 0;
    const above = this.level.getBlockState(x, y + 1, z);
    if (this.mc.hasFluid(above) && this.mc.blockOf(above).name === name) return 1;
    const amount = Number(this.mc.getProp(state, 'level') ?? 0);
    return (amount >= 8 ? 8 : 8 - amount) / 9;
  }

  /**
   * BoatItem.use's `getPlayerPOVHitResult(ClipContext.Fluid.ANY)`: the first fluid
   * surface along the look ray, with the exact Y where the ray crosses it.
   */
  private fluidSurfaceRay(maxDistance: number): { point: Vec3; dist: number } | null {
    const eye = this.cameraEye();
    const dir = this.lookVector();
    for (let dist = 0; dist <= maxDistance; dist += 0.05) {
      const px = eye.x + dir.x * dist;
      const py = eye.y + dir.y * dist;
      const pz = eye.z + dir.z * dist;
      const x = Math.floor(px), y = Math.floor(py), z = Math.floor(pz);
      const height = this.fluidHeightAt(x, y, z);
      if (height <= 0) continue;
      const planeY = y + height;
      let t = dir.y !== 0 ? (planeY - eye.y) / dir.y : dist;
      if (!(t >= 0 && t <= maxDistance)) t = dist;
      const qx = eye.x + dir.x * t;
      const qz = eye.z + dir.z * t;
      if (Math.floor(qx) === x && Math.floor(qz) === z) {
        return { point: new Vec3(qx, planeY, qz), dist: t };
      }
      return { point: new Vec3(px, py, pz), dist };
    }
    return null;
  }

  /** BoatItem.use: place the boat at the first block-or-fluid hit, facing the player. */
  private placeBoat(kind: string, hit: { point: Vec3 } | null): void {
    const eye = this.cameraEye();
    const fluid = this.fluidSurfaceRay(5);
    let point: Vec3 | null = null;
    if (hit) {
      const solidDist = Math.hypot(hit.point.x - eye.x, hit.point.y - eye.y, hit.point.z - eye.z);
      point = fluid && fluid.dist < solidDist ? fluid.point : hit.point;
    } else if (fluid) {
      point = fluid.point;
    }
    if (!point) return;
    const spawned = this.entityManager.spawn(kind, point.x, point.y, point.z);
    if (!(spawned instanceof Boat)) return;
    const boat = spawned;
    boat.yaw = this.player.yaw;
    boat.yRotO = boat.yaw;
    // BoatItem.use: fail (keep the item) when the hull would intersect a block.
    if (!this.boatFits(boat)) {
      boat.remove();
      return;
    }
    if (this.options.gamemode !== 'creative') this.survival.inventory.removeFromSelected(false);
    this.useCooldown = 8;
  }

  /** Level.noCollision(boat, boat.getBoundingBox()). */
  private boatFits(boat: Boat): boolean {
    const bb = boat.getBoundingBox();
    const x0 = Math.floor(bb.minX), x1 = Math.ceil(bb.maxX);
    const y0 = Math.floor(bb.minY), y1 = Math.ceil(bb.maxY);
    const z0 = Math.floor(bb.minZ), z1 = Math.ceil(bb.maxZ);
    for (let y = y0; y < y1; y++) {
      for (let x = x0; x < x1; x++) {
        for (let z = z0; z < z1; z++) {
          const state = this.level.getBlockState(x, y, z);
          if (state === 0) continue;
          const shape = this.mc.collision(state);
          for (let i = 0; i < shape.length; i++) {
            const b = shape[i];
            if (b.maxX + x > bb.minX && b.minX + x < bb.maxX
              && b.maxY + y > bb.minY && b.minY + y < bb.maxY
              && b.maxZ + z > bb.minZ && b.minZ + z < bb.maxZ) return false;
          }
        }
      }
    }
    return true;
  }

  /** AbstractBoat.interact: seat the player (chest boat keeps one seat). */
  private mountBoat(boat: Boat): void {
    this.ridingBoat = boat;
    boat.rider = this.player;
    boat.setInput(false, false, false, false);
    this.player.flying = false;
    this.player.sneaking = false;
    this.player.vel = new Vec3(0, 0, 0);
    this.player.pos.x = boat.x;
    this.player.pos.y = boat.y + boat.getRideHeight();
    this.player.pos.z = boat.z;
  }

  /** Sneak while riding: step off beside the boat. */
  private dismountBoat(): void {
    const boat = this.ridingBoat;
    if (!boat) return;
    boat.rider = null;
    boat.setInput(false, false, false, false);
    this.ridingBoat = null;
    this.player.pos.x = boat.x + 1.1;
    this.player.pos.y = boat.y + 0.2;
    this.player.pos.z = boat.z;
    this.player.vel = new Vec3(0, 0, 0);
    this.player.onGround = false;
    this.useCooldown = 8;
  }

  /** AbstractChestBoat.interactWithContainerVehicle: the chest-boat's 27 slots. */
  private openBoatChest(boat: Boat): void {
    this.stats.award('custom', 'open_chest');
    this.survival.openStorageContainer(boat);
    this.openScreen('chest');
    this.sounds.play('block.chest.open', boat.x, boat.y, boat.z, 1, 1);
  }

  /** Villager/AbstractVillager.startTrading: open the merchant menu and bind the trade callback. */
  private openMerchant(merchant: Villager | WanderingTrader): void {
    const menu = this.survival.openMerchant(merchant);
    // Wandering traders have no profession level bar (WanderingTrader.showProgressBar false).
    menu.setMerchantLevel(merchant instanceof Villager ? merchant.professionLevel : 1);
    menu.setShowProgressBar(merchant instanceof Villager);
    menu.onTrade = (offer) => {
      this.stats.award('custom', 'traded_with_villager');
      this.advancements.trigger('villager_trade', {
        item: offer.getResult().item?.name,
        y: this.player.pos.y,
      });
      this.sounds.play(merchant.getNotifyTradeSound(), merchant.x, merchant.y, merchant.z, 1, 1);
    };
    merchant.setTradingPlayer(this.player);
    this.openScreen('merchant');
  }

  /**
   * Furnace/brewing menus advance one 20 Hz step per game tick. Vanilla block entities
   * tick even while their GUI is closed, so every cached container advances too (the
   * cache is created the first time a block is opened; unvisited blocks still have no
   * block entity in this client).
   */
  private tickActiveMenu(): void {
    const ticked = new Set<object>();
    const menus: unknown[] = [this.survival.activeMenu, ...this.blockContainers.values()];
    for (const menu of menus) {
      if (!menu || ticked.has(menu)) continue;
      ticked.add(menu);
      const m = menu as { tick?: () => void };
      if (typeof m.tick === 'function') m.tick();
    }
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
    if (this.sleeping) return;
    if (this.useCooldown > 0) return;
    // Food / consumables: right click eats without requiring a block target.
    const held = this.survival.getSelectedStack();
    // BowItem.use: start charging; the shot happens on pointerup.
    if (held.item?.name === 'bow') {
      this.bowCharging = true;
      this.bowCharge = 0;
      return;
    }
    // FishingRodItem.use: cast a bobber, or reel the active one in.
    if (held.item?.name === 'fishing_rod') {
      this.useFishingRod(held);
      return;
    }
    // EggItem.use: throw the egg (ThrownEgg), 1/8 chance of a baby chicken on impact.
    if (held.item?.name === 'egg') {
      this.throwEgg(held);
      return;
    }
    // PotionItem.use: drink a potion, apply its effects, return the glass bottle.
    if (held.item?.name === 'potion') {
      this.drinkPotion(held);
      this.advancements.trigger('consume_item', { item: held.item.name });
      return;
    }
    // ThrownPotion: splash / lingering potions break on impact.
    if (held.item?.name === 'splash_potion' || held.item?.name === 'lingering_potion') {
      this.throwPotion(held);
      return;
    }
    const food = held.item?.food;
    if (food && (this.survival.hunger < 20 || food.canAlwaysEat)) {
      this.survival.food.eatProperties(food.nutrition, food.saturation);
      if (held.item) this.advancements.trigger('consume_item', { item: held.item.name });
      if (this.options.gamemode !== 'creative') this.survival.inventory.removeFromSelected(false);
      this.player.swingHand();
      this.useCooldown = 32;
      return;
    }
    this.useCooldown = 4;
    this.player.swingHand();
    const hit = this.raycast();
    // Empty bucket: fluids have no outline, so raycast() passes through them. Pick the first
    // fluid along the look ray if it is in front of the solid block that raycast() found.
    if (held.item?.name === 'bucket') {
      const fluid = this.fluidRay(5);
      if (fluid) {
        const eye = this.cameraEye();
        const solidDist = hit
          ? Math.hypot(hit.point.x - eye.x, hit.point.y - eye.y, hit.point.z - eye.z)
          : Infinity;
        if (fluid.dist < solidDist) {
          this.pickUpFluid(fluid);
          return;
        }
      }
    }
    // BottleItem.use: fill a glass bottle from a water source block.
    if (held.item?.name === 'glass_bottle') {
      const fluid = this.fluidRay(5);
      if (fluid && fluid.name === 'water') {
        const eye = this.cameraEye();
        const solidDist = hit
          ? Math.hypot(hit.point.x - eye.x, hit.point.y - eye.y, hit.point.z - eye.z)
          : Infinity;
        if (fluid.dist < solidDist) {
          this.fillGlassBottle(held);
          return;
        }
      }
    }
    // Entity interaction (ShearsItem.useOn / Animal.mobInteract): the block hit is the
    // occlusion limit (a sheep behind a wall cannot be fed or sheared), and the click
    // is consumed before block placement.
    const eye = this.cameraEye();
    const blockDistance = hit
      ? Math.hypot(hit.point.x - eye.x, hit.point.y - eye.y, hit.point.z - eye.z)
      : Infinity;
    const entityTarget = this.findEntityTarget(Math.min(3.0, blockDistance + 0.25));
    if (held.item?.name?.endsWith('shears') && entityTarget instanceof Sheep) {
      this.shearSheep(entityTarget);
      return;
    }
    // Minecart.interact / MinecartChest.interact: mount an empty cart, open a chest cart.
    // AbstractBoat.interact / AbstractChestBoat.interact: boats seat the player; a
    // chest boat opens its 27 slots only while sneaking (the seat is still free).
    const vehicleTarget = this.findVehicleTarget(Math.min(3.0, blockDistance + 0.25));
    if (vehicleTarget instanceof Minecart) {
      if (vehicleTarget.kind === 'chest_minecart' && !this.player.sneaking) {
        this.openMinecartChest(vehicleTarget);
      } else if (!this.player.sneaking && !this.ridingMinecart && !this.ridingBoat) {
        this.mountMinecart(vehicleTarget);
      }
      this.useCooldown = 8;
      return;
    }
    if (vehicleTarget instanceof Boat) {
      if (this.player.sneaking) {
        if (vehicleTarget.isChest()) this.openBoatChest(vehicleTarget);
      } else if (!this.ridingMinecart && !this.ridingBoat && !vehicleTarget.rider) {
        this.mountBoat(vehicleTarget);
      }
      this.useCooldown = 8;
      return;
    }
    // Villager/WanderingTrader.mobInteract: babies refuse, offerless merchants
    // shake their head, otherwise the merchant screen opens.
    if (entityTarget instanceof Villager || entityTarget instanceof WanderingTrader) {
      const merchant = entityTarget;
      this.stats.award('custom', 'talked_to_villager');
      if ((merchant instanceof Villager && merchant.isBaby()) || merchant.getOffers().length === 0) {
        const sound = merchant instanceof WanderingTrader ? 'entity.wandering_trader.no' : 'entity.villager.no';
        this.sounds.play(sound, merchant.x, merchant.y, merchant.z, 1, 1);
        this.useCooldown = 8;
        return;
      }
      this.openMerchant(merchant);
      this.useCooldown = 8;
      return;
    }
    // IronGolem.mobInteract: an iron ingot repairs 25 health (no-op at full health).
    if (entityTarget instanceof IronGolem && held.item?.name === 'iron_ingot') {
      if (entityTarget.tryRepair('iron_ingot')) {
        this.sounds.play('entity.iron_golem.repair', entityTarget.x, entityTarget.y, entityTarget.z, 1, 1);
        this.player.swingHand();
        if (this.options.gamemode !== 'creative') this.survival.inventory.removeFromSelected(false);
        this.useCooldown = 10;
        return;
      }
    }
    // TameableAnimal.mobInteract: bones tame wolves, fish tame cats, and a later
    // click toggles sitting. The item is consumed only for a taming attempt.
    if ((entityTarget instanceof Wolf || entityTarget instanceof Cat) && held.item) {
      const result = entityTarget.interact(held);
      if (result) {
        if ((result === 'tame' || result === 'fail') && this.options.gamemode !== 'creative') {
          this.survival.inventory.removeFromSelected(false);
        }
        if (result === 'tame') {
          spawnHearts(entityTarget.x, entityTarget.y + entityTarget.getHeight() * 0.8, entityTarget.z, 3);
          this.sounds.play(entityTarget instanceof Cat ? 'entity.cat.ambient' : 'entity.wolf.ambient',
            entityTarget.x, entityTarget.y, entityTarget.z, 1, 1);
        } else if (result === 'toggle') {
          this.sounds.play(entityTarget instanceof Cat ? 'entity.cat.ambient' : 'entity.wolf.ambient',
            entityTarget.x, entityTarget.y, entityTarget.z, 1, 1);
        } else {
          this.sounds.play(entityTarget instanceof Cat ? 'entity.cat.ambient' : 'entity.wolf.growl',
            entityTarget.x, entityTarget.y, entityTarget.z, 1, 0.8);
        }
        this.player.swingHand();
        this.useCooldown = 8;
        return;
      }
    }
    if (held.item && entityTarget instanceof Animal && entityTarget.isFood(held.item.name)) {
      this.feedAnimal(entityTarget);
      return;
    }
    if (!hit) {
      // BoatItem.use has no block target when the player looks at open water.
      const heldName = this.survival.getSelectedStack().item?.name ?? '';
      if (this.isBoatItem(heldName)) this.placeBoat(heldName, null);
      return;
    }
    // Vanilla PlayerGameMode.useItemOn: an interactive block consumes the right click before item
    // placement (unless the player is sneaking, which keeps the old "place against it" behaviour).
    const targetBlock = this.mc.blockOf(this.level.getBlockState(hit.x, hit.y, hit.z)).name;
    if (!this.player.sneaking && targetBlock.endsWith('_bed')) {
      this.trySleep(hit.x, hit.y, hit.z, targetBlock);
      return;
    }
    // Lever / button / repeater / door / trapdoor / fence gate interaction
    // (PlayerGameMode.useItemOn -> Block.use) consumes the click before placement.
    if (!this.player.sneaking && this.redstone.use(hit.x, hit.y, hit.z)) return;
    if (!this.player.sneaking && targetBlock === 'jukebox' && this.useJukebox(hit)) return;
    if (!this.player.sneaking && isContainerBlock(targetBlock)) {
      this.openBlockContainer(targetBlock, hit.x, hit.y, hit.z);
      return;
    }
    // ItemBucket / FlintAndSteel useOn: consume the click before block placement.
    const heldUse = this.survival.getSelectedStack();
    const heldUseName = heldUse.item?.name ?? '';
    if (heldUseName === 'minecart' || heldUseName === 'chest_minecart') {
      this.placeMinecart(hit, heldUseName);
      return;
    }
    if (this.isBoatItem(heldUseName)) {
      this.placeBoat(heldUseName, hit);
      return;
    }
    if (heldUseName === 'water_bucket' || heldUseName === 'lava_bucket') {
      this.placeFluidBucket(hit, heldUseName === 'water_bucket' ? 'water' : 'lava');
      return;
    }
    if (heldUseName === 'flint_and_steel') {
      this.igniteBlock(hit);
      return;
    }
    // SpawnEggItem.useOn: spawn at the clicked face (0 down, 1 up, 2 north, 3 south, 4 west, 5 east).
    const heldStack = this.survival.getSelectedStack();
    const eggType = heldStack.item ? this.spawnEggType(heldStack.item.name) : null;
    if (eggType) {
      const nx = hit.face === 4 ? -1 : hit.face === 5 ? 1 : 0;
      const ny = hit.face === 0 ? -1 : hit.face === 1 ? 1 : 0;
      const nz = hit.face === 2 ? -1 : hit.face === 3 ? 1 : 0;
      const spawned = this.entityManager.spawn(
        eggType,
        hit.point.x + nx * 0.5,
        hit.point.y + ny * 0.5,
        hit.point.z + nz * 0.5,
      );
      if (spawned) {
        if (this.options.gamemode !== 'creative') this.survival.inventory.removeFromSelected(false);
        this.useCooldown = 10;
      }
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
      // Level.hasNeighborSignal: doors/trapdoors/gates placed while powered open immediately.
      hasNeighborSignal: (x, y, z) => this.redstone.isPoweredAt(x, y, z),
    };
    const plan = placeBlock(this.mc, this.level, item.block, ctx);
    if (!plan) return;
    // PlayerGameMode.useItemOn: a successful placement is Stats.ITEM_USED for the block item.
    this.stats.award('used', item.name);
    this.sounds.play(`${this.blockSoundBase(this.level.getBlockState(plan.x, plan.y, plan.z))}.place`, plan.x + 0.5, plan.y + 0.5, plan.z + 0.5, 1, 0.8);
    this.updateNeighbors(plan.x, plan.y, plan.z);
    for (const extra of plan.extras) this.updateNeighbors(extra.x, extra.y, extra.z);
    // CarvedPumpkinBlock.onPlace: the four-iron-block pattern creates a golem.
    this.trySpawnIronGolem(plan.x, plan.y, plan.z);
    if (this.options.gamemode !== 'creative') this.survival.inventory.removeFromSelected(false);
  }

  /**
   * CarvedPumpkinBlock.onPlace -> trySpawnGolem (iron pattern):
   *
   *     ~^~      ^ carved pumpkin / jack o'lantern
   *     ###      # iron block
   *     ~#~      ~ air
   *
   * Clears the four blocks and spawns a player-created iron golem at the
   * pumpkin's position (snapTo(x + 0.5, y + 0.05, z + 0.5)).
   */
  private trySpawnIronGolem(x: number, y: number, z: number): void {
    const name = this.mc.blockOf(this.level.getBlockState(x, y, z)).name;
    if (name !== 'carved_pumpkin' && name !== 'jack_o_lantern') return;
    const isIron = (bx: number, by: number, bz: number): boolean =>
      this.mc.blockOf(this.level.getBlockState(bx, by, bz)).name === 'iron_block';
    const isAir = (bx: number, by: number, bz: number): boolean =>
      this.level.getBlockState(bx, by, bz) === 0;
    if (!isAir(x - 1, y, z) || !isAir(x + 1, y, z)) return;
    if (!isAir(x - 1, y - 2, z) || !isAir(x + 1, y - 2, z)) return;
    if (!isIron(x, y - 2, z)) return;
    if (!isIron(x - 1, y - 1, z) || !isIron(x, y - 1, z) || !isIron(x + 1, y - 1, z)) return;
    const cleared = [
      [x, y, z], [x - 1, y - 1, z], [x, y - 1, z], [x + 1, y - 1, z], [x, y - 2, z],
    ];
    for (const [bx, by, bz] of cleared) {
      this.level.setBlockState(bx, by, bz, 0);
      this.updateNeighbors(bx, by, bz);
    }
    const golem = this.entityManager.spawn('iron_golem', x + 0.5, y + 0.05, z + 0.5);
    if (golem instanceof IronGolem) golem.playerCreated = true;
  }

  private nextVillageGolemCheck = 0;

  /**
   * Simplified village golem spawn (vanilla: villagers' sleep gossip). Five
   * villagers that slept within the last 24000 ticks summon one iron golem on a
   * free three-block column within 10 blocks of their average position. The
   * sleep memory is cleared after a successful spawn, so a new golem needs a
   * fresh night's sleep.
   */
  private tickVillageGolemSpawn(): void {
    if (this.tickCount < this.nextVillageGolemCheck) return;
    this.nextVillageGolemCheck = this.tickCount + 20;
    const gameTime = this.level.gameTime;
    let sleepers = 0;
    let cx = 0, cz = 0;
    for (const e of this.entityManager.getEntities()) {
      if (!(e instanceof Villager) || e.isRemoved() || e.dead) continue;
      if (e.lastSleptGameTime < 0 || gameTime - e.lastSleptGameTime > 24000) continue;
      sleepers++;
      cx += e.x; cz += e.z;
    }
    if (sleepers < 5) return;
    cx /= sleepers; cz /= sleepers;
    // One village protector at a time.
    for (const e of this.entityManager.getEntities()) {
      if (!(e instanceof IronGolem) || e.isRemoved()) continue;
      if ((e.x - cx) ** 2 + (e.z - cz) ** 2 <= 32 * 32) return;
    }
    const r = this.entityManager.random;
    for (let i = 0; i < 10; i++) {
      const x = Math.floor(cx) + r.nextInt(21) - 10;
      const z = Math.floor(cz) + r.nextInt(21) - 10;
      const y = this.level.getHeight(x, z) + 1;
      if (y <= this.level.minY || y + 2 >= this.level.minY + this.level.height) continue;
      if (this.level.getBlockState(x, y, z) !== 0) continue;
      if (this.level.getBlockState(x, y + 1, z) !== 0) continue;
      if (this.level.getBlockState(x, y + 2, z) !== 0) continue;
      if (this.level.getBlockState(x, y - 1, z) === 0) continue;
      this.entityManager.spawn('iron_golem', x + 0.5, y, z + 0.5);
      for (const e of this.entityManager.getEntities()) {
        if (!(e instanceof Villager) || e.isRemoved() || e.dead) continue;
        if (e.lastSleptGameTime >= 0 && gameTime - e.lastSleptGameTime <= 24000) e.lastSleptGameTime = -1;
      }
      return;
    }
  }

  /** EggItem.use: throw a ThrownEgg toward the crosshair. */
  private throwEgg(held: ItemStack): void {
    const dir = this.lookVector();
    const eye = this.cameraEye();
    const egg = new ThrownEgg(
      this.level,
      eye.x + dir.x * 0.3,
      eye.y - 0.1,
      eye.z + dir.z * 0.3,
    );
    egg.owner = this.entityManager.getPlayerTarget();
    egg.shoot(dir.x * 1.2, dir.y * 1.2 + 0.15, dir.z * 1.2);
    this.entityManager.spawnEntity(egg);
    this.player.swingHand();
    this.stats.award('used', 'egg');
    if (this.options.gamemode !== 'creative') this.survival.inventory.removeFromSelected(false);
    this.useCooldown = 10;
    void held;
  }

  /** ThrownSplashPotion / ThrownLingeringPotion: throw the potion toward the crosshair. */
  private throwPotion(held: ItemStack): void {
    const dir = this.lookVector();
    const eye = this.cameraEye();
    const lingering = held.item?.name === 'lingering_potion';
    const potion = new ThrownPotion(
      this.level,
      eye.x + dir.x * 0.3,
      eye.y - 0.1,
      eye.z + dir.z * 0.3,
      lingering,
    );
    potion.owner = this.entityManager.getPlayerTarget();
    potion.item = held.copy();
    // ThrowableItemProjectile.shootFromRotation(player, xRot, yRot, -20, 0.5, 1).
    potion.shoot(dir.x * 0.6, dir.y * 0.6 + 0.1, dir.z * 0.6);
    this.entityManager.spawnEntity(potion);
    this.player.swingHand();
    this.stats.award('used', held.item?.name ?? 'splash_potion');
    if (this.options.gamemode !== 'creative') this.survival.inventory.removeFromSelected(false);
    this.useCooldown = 10;
  }

  /**
   * ThrownSplashPotion.onHitAsPotion: every living entity in the potion box grown
   * by (4,2,4) whose box is closer than 4 blocks takes the effects scaled by
   * `1 - distance/4`. Undead invert instant health/harm.
   */
  private applyPotionSplash(x: number, y: number, z: number, potionId: string, age: number): void {
    const effects = potionEffects(potionId);
    const base = potionId.replace(/^(splash_|lingering_|long_|strong_)/, '');
    const color = POTION_CLOUD_COLORS[base] ?? [0.7, 0.4, 1];
    this.sounds.play('entity.splash_potion.break', x, y, z, 1, 1);
    spawnPotionCloudParticles(x, y + 0.1, z, 1.5, color, 12);
    // AbstractThrownPotion: a water potion douses fire around where it broke.
    if (base === 'water') this.douseFireAround(x, y, z);
    if (effects.length === 0) return;
    const potionBox = new AABB(x - 0.125, y, z - 0.125, x + 0.125, y + 0.25, z + 0.125);
    const search = potionBox.inflate(4, 2, 4);
    const margin = Math.max(0, Math.min(0.3, (age - 2) / 20));
    const apply = (
      box: AABB,
      undead: boolean,
      heal: (n: number) => void,
      damage: (n: number) => void,
      effect: (id: string, duration: number, amplifier: number) => void,
    ): void => {
      if (!search.intersects(box)) return;
      const d2 = boxDistanceSqr(potionBox, box.inflateAll(margin));
      if (d2 >= 16) return;
      const intensity = 1 - Math.sqrt(d2) / 4;
      for (const e of effects) {
        if (e.id === 'instant_health') {
          const amount = Math.floor(intensity * (4 << e.amplifier) + 0.5);
          if (amount > 0) (undead ? damage : heal)(amount);
        } else if (e.id === 'instant_damage') {
          const amount = Math.floor(intensity * (6 << e.amplifier) + 0.5);
          if (amount > 0) (undead ? heal : damage)(amount);
        } else {
          // Splash potions keep POTION_DURATION_SCALE 1; the distance is the only reducer.
          const duration = Math.floor(intensity * e.duration + 0.5);
          if (duration > 20) effect(e.id, duration, e.amplifier);
        }
      }
    };
    const playerTarget = this.entityManager.getPlayerTarget();
    for (const e of this.entityManager.getEntities()) {
      if (!(e instanceof LivingEntity) || e.isRemoved() || !e.isAlive()) continue;
      apply(
        e.getBoundingBox(), isUndeadType(e.getTypeName()),
        (n) => e.heal(n),
        (n) => e.hurt(n, playerTarget),
        (id, duration, amplifier) => e.addEffect(id, duration, amplifier),
      );
    }
    apply(
      this.player.boundingBox(), false,
      (n) => this.survival.heal(n),
      (n) => this.survival.damage(n, 'magic'),
      (id, duration, amplifier) => this.survival.applyEffect(id, duration, amplifier),
    );
  }

  /**
   * ThrownLingeringPotion.onHitAsPotion: the cloud sits at the impact (radius 3,
   * wait 10, lifetime 600). AreaEffectCloud drives the timing; Game applies the
   * effects at 0.25 duration scale with a 20-tick reapplication delay.
   */
  private spawnPotionCloud(x: number, y: number, z: number, potionId: string): void {
    if (potionEffects(potionId).length === 0) return;
    const base = potionId.replace(/^(splash_|lingering_|long_|strong_)/, '');
    if (base === 'water') this.douseFireAround(x, y, z);
    const cloud = new AreaEffectCloud(this.level, x, y, z);
    cloud.potionId = potionId;
    cloud.onEffects = (c) => this.applyPotionCloudEffects(c);
    this.entityManager.spawnEntity(cloud);
  }

  /** AreaEffectCloud.serverTick's five-tick dose for every entity inside the radius. */
  private applyPotionCloudEffects(cloud: AreaEffectCloud): void {
    const effects = potionEffects(cloud.potionId);
    if (effects.length === 0) return;
    const base = cloud.potionId.replace(/^(splash_|lingering_|long_|strong_)/, '');
    spawnPotionCloudParticles(
      cloud.x, cloud.y, cloud.z, cloud.radius,
      POTION_CLOUD_COLORS[base] ?? [0.7, 0.4, 1],
    );
    const r = cloud.radius;
    const area = new AABB(
      cloud.x - r, cloud.y, cloud.z - r,
      cloud.x + r, cloud.y + 0.5, cloud.z + r,
    );
    const inside = (box: AABB, x: number, z: number): boolean => {
      if (!area.intersects(box)) return false;
      const dx = x - cloud.x, dz = z - cloud.z;
      return dx * dx + dz * dz <= r * r;
    };
    const apply = (
      box: AABB, x: number, z: number,
      undead: boolean, victim: object,
      heal: (n: number) => void,
      damage: (n: number) => void,
      effect: (id: string, duration: number, amplifier: number) => void,
    ): void => {
      if (!inside(box, x, z) || !cloud.affect(victim)) return;
      for (const e of effects) {
        if (e.id === 'instant_health') {
          const amount = 4 << e.amplifier;
          (undead ? damage : heal)(amount);
        } else if (e.id === 'instant_damage') {
          const amount = 6 << e.amplifier;
          (undead ? heal : damage)(amount);
        } else {
          // Lingering potions carry POTION_DURATION_SCALE 0.25.
          const duration = Math.floor(e.duration * 0.25 + 0.5);
          if (duration > 20) effect(e.id, duration, e.amplifier);
        }
      }
    };
    const playerTarget = this.entityManager.getPlayerTarget();
    for (const e of this.entityManager.getEntities()) {
      if (!(e instanceof LivingEntity) || e.isRemoved() || !e.isAlive()) continue;
      apply(
        e.getBoundingBox(), e.x, e.z,
        isUndeadType(e.getTypeName()), e,
        (n) => e.heal(n),
        (n) => e.hurt(n, playerTarget),
        (id, duration, amplifier) => e.addEffect(id, duration, amplifier),
      );
    }
    apply(
      this.player.boundingBox(), this.player.pos.x, this.player.pos.z,
      false, this.player,
      (n) => this.survival.heal(n),
      (n) => this.survival.damage(n, 'magic'),
      (id, duration, amplifier) => this.survival.applyEffect(id, duration, amplifier),
    );
  }

  /** AbstractThrownPotion.douseFire: fire blocks in the 3x3 column are destroyed. */
  private douseFireAround(x: number, y: number, z: number): void {
    const bx = Math.floor(x), by = Math.floor(y), bz = Math.floor(z);
    for (let dx = -1; dx <= 1; dx++) {
      for (let dz = -1; dz <= 1; dz++) {
        for (let dy = -1; dy <= 1; dy++) {
          const state = this.level.getBlockState(bx + dx, by + dy, bz + dz);
          if (state === 0) continue;
          const name = this.mc.blockOf(state).name;
          if (name === 'fire' || name === 'soul_fire') {
            this.level.setBlockState(bx + dx, by + dy, bz + dz, 0);
            this.updateNeighbors(bx + dx, by + dy, bz + dz);
          }
        }
      }
    }
  }

  /** PotionItem.use: apply the potion's effects, then hand back a glass bottle. */
  private drinkPotion(held: ItemStack): void {
    const potionId = held.components.potion ?? 'water';
    this.player.swingHand();
    this.sounds.play(
      'entity.generic.drink',
      this.player.pos.x, this.player.pos.y, this.player.pos.z, 1, 1,
    );
    for (const effect of potionEffects(potionId)) {
      if (effect.id === 'instant_health') this.survival.heal(4 << effect.amplifier);
      else if (effect.id === 'instant_damage') this.survival.damage(6 << effect.amplifier, 'magic');
      else this.survival.applyEffect(effect.id, effect.duration, effect.amplifier);
    }
    this.stats.award('used', 'potion');
    // ItemUtils.createFilledResult: creative keeps the potion (adds one bottle if missing);
    // survival consumes it and returns the empty bottle.
    const bottle = this.survival.registry.byName('glass_bottle');
    const bottleStack = bottle ? new ItemStack(bottle, 1) : ItemStack.EMPTY;
    if (this.options.gamemode === 'creative') {
      if (bottle && !this.survival.inventory.containsItem(bottleStack)) {
        this.survival.inventory.add(bottleStack);
      }
    } else if (held.getCount() > 1) {
      this.survival.inventory.removeFromSelected(false);
      if (bottle) this.survival.inventory.add(bottleStack);
    } else {
      this.survival.inventory.setItem(this.survival.inventory.getSelectedSlot(), bottleStack);
    }
    this.useCooldown = 32;
  }

  /**
   * LivingEntity speed/jump attribute modifiers for the local player: Speed +20% and
   * Slowness -15% per level (multiplicative), Jump Boost +0.1 jump power per level.
   */
  private syncPotionMovement(): void {
    let speed = 1;
    if (this.survival.hasEffect('speed')) {
      speed *= 1 + 0.2 * (this.survival.getEffectLevel('speed') + 1);
    }
    if (this.survival.hasEffect('slowness')) {
      speed *= 1 - 0.15 * (this.survival.getEffectLevel('slowness') + 1);
    }
    this.player.speedMultiplier = Math.max(0.05, speed);
    this.player.jumpMultiplier = this.survival.hasEffect('jump_boost')
      ? (JUMP_VELOCITY + 0.1 * (this.survival.getEffectLevel('jump_boost') + 1)) / JUMP_VELOCITY
      : 1;
    this.player.slowFalling = this.survival.hasEffect('slow_falling');
  }

  /** BottleItem.use: fill a glass bottle from the targeted water source. */
  private fillGlassBottle(held: ItemStack): void {
    const potion = this.survival.registry.byName('potion');
    if (!potion) return;
    const water = new ItemStack(potion, 1, { potion: 'water' });
    if (this.options.gamemode === 'creative') {
      if (!this.survival.inventory.containsItem(water)) this.survival.inventory.add(water);
    } else if (held.getCount() > 1) {
      this.survival.inventory.removeFromSelected(false);
      this.survival.inventory.add(water);
    } else {
      this.survival.inventory.setItem(this.survival.inventory.getSelectedSlot(), water);
    }
    this.player.swingHand();
    const eye = this.cameraEye();
    this.sounds.play('item.bottle.fill', eye.x, eye.y, eye.z, 1, 1);
    this.useCooldown = 10;
  }

  /** Player.drop (Q / Ctrl+Q): throw the selected stack forward with a pickup delay. */
  private dropSelectedItem(all: boolean): void {
    if (this.sleeping) return;
    const removed = this.survival.inventory.removeFromSelected(all);
    if (removed.isEmpty() || !removed.item) return;
    const dir = this.lookVector();
    const eye = this.cameraEye();
    const entity = new ItemEntity(
      this.level,
      eye.x + dir.x * 0.3,
      eye.y - 0.3,
      eye.z + dir.z * 0.3,
      removed.copy(),
    );
    entity.setPickupDelay(40);
    entity.push(dir.x * 0.3, 0.1, dir.z * 0.3);
    this.entityManager.spawnEntity(entity);
    this.stats.award('dropped', removed.item.name, removed.getCount());
    this.stats.award('custom', 'drop');
  }

  /** FishingRodItem.use: cast toward the first water block, or reel the active bobber in. */
  private useFishingRod(held: ItemStack): void {
    const active = this.entityManager.getEntities().find(
      (e): e is FishingBobber => e instanceof FishingBobber && !e.isRemoved(),
    );
    if (active) { this.reelFishing(active, held); return; }
    const water = this.fluidRay(32);
    if (!water || water.name !== 'water') return;
    const eye = this.cameraEye();
    const dx = water.x + 0.5 - eye.x;
    const dy = water.y + 0.5 - eye.y;
    const dz = water.z + 0.5 - eye.z;
    const dist = Math.hypot(dx, dy, dz) || 1;
    const speed = 1.35;
    const bobber = new FishingBobber(this.level, eye.x, eye.y - 0.1, eye.z);
    bobber.owner = this.entityManager.getPlayerTarget();
    bobber.lureLevel = held.getEnchantmentLevel('lure');
    bobber.shoot((dx / dist) * speed, (dy / dist) * speed + 0.08, (dz / dist) * speed);
    this.entityManager.spawnEntity(bobber);
    this.stats.award('used', 'fishing_rod');
    if (this.options.gamemode !== 'creative') held.hurtAndBreak(1);
    this.useCooldown = 10;
  }

  /** FishingHook.retrieve: only a bitten bobber yields loot (fish 85%, junk, treasure with LotS). */
  private reelFishing(bobber: FishingBobber, held: ItemStack): void {
    const x = bobber.x, y = bobber.y, z = bobber.z;
    const caught = bobber.reel();
    this.useCooldown = 10;
    const rng = this.survival.random;
    if (!caught) return;
    const luck = held.getEnchantmentLevel('luck_of_the_sea');
    const roll = rng.nextFloat();
    const table = roll < 0.85 ? Game.FISHING_FISH
      : luck > 0 && roll >= 0.95 ? Game.FISHING_TREASURE
      : Game.FISHING_JUNK;
    const item = this.survival.registry.byName(Game.pickWeighted(table, rng));
    if (item) this.dropItem(new ItemStack(item, 1), x, y, z);
    this.stats.award('custom', 'fish_caught');
    this.survival.addExperience(1 + rng.nextInt(6));
    if (this.options.gamemode !== 'creative') held.hurtAndBreak(1);
    this.sounds.play('entity.fishing_bobber.splash', x, y, z, 0.4, 1.4);
  }

  private static pickWeighted(
    table: readonly (readonly [string, number])[],
    rng: { nextInt(bound: number): number },
  ): string {
    let total = 0;
    for (const [, weight] of table) total += weight;
    let roll = rng.nextInt(Math.max(1, total));
    for (const [name, weight] of table) {
      if (roll < weight) return name;
      roll -= weight;
    }
    return table[0]?.[0] ?? 'cod';
  }

  /**
   * ServerPlayer.startSleepInBed: night/thunder only, no monsters within 8 blocks,
   * and the bed must not be obstructed. Sleeping advances to the next sunrise.
   */
  private trySleep(x: number, y: number, z: number, blockName: string): void {
    if (this.level.isDay() && !this.level.isThundering()) {
      this.addChatLine('你现在不能睡觉，只能夜晚或雷暴时睡觉');
      return;
    }
    for (const e of this.entityManager.getEntities()) {
      if (!(e instanceof Mob) || e.isRemoved() || !e.isAlive()) continue;
      if (e.getCategory() !== MobCategory.MONSTER) continue;
      if (e.distanceToSqr(x + 0.5, y, z + 0.5) < 64) {
        this.addChatLine('你现在不能休息，周围有怪物在游荡');
        return;
      }
    }
    const above = this.level.getBlockState(x, y + 1, z);
    if (above !== 0 && this.mc.isSolid(above)) {
      this.addChatLine('这张床被阻挡了');
      return;
    }
    this.sleeping = true;
    this.sleepTicks = 0;
    this.bedSpawn = { x, y: y + 1, z };
    this.stats.award('custom', 'sleep_in_bed');
    this.player.vel.x = 0; this.player.vel.y = 0; this.player.vel.z = 0;
    // Lie on the clicked bed (the black fade covers the transition; no sleeping pose model yet).
    this.player.pos.x = x + 0.5;
    this.player.pos.y = y + 0.5625;
    this.player.pos.z = z + 0.5;
    this.player.prevPos.x = this.player.pos.x;
    this.player.prevPos.y = this.player.pos.y;
    this.player.prevPos.z = this.player.pos.z;
    void blockName;
  }

  /** ServerPlayer.stopSleepInBed: `advanceTime` skips to sunrise and clears the weather. */
  private wakeUp(advanceTime: boolean): void {
    if (!this.sleeping) return;
    this.sleeping = false;
    this.sleepTicks = 0;
    this.sleepFade = 1;
    if (advanceTime) {
      // Level.sleep: jump to the next day boundary (sunrise) and clear rain/thunder.
      this.level.time = (Math.floor(this.level.time / 24000) + 1) * 24000;
      if (this.level.getRainLevel() > 0.01) {
        this.level.setWeatherState({ raining: false, thundering: false, rainTime: 6000, thunderTime: 12000 });
      }
    }
  }

  private tickSleep(): void {
    if (!this.sleeping) {
      if (this.sleepFade > 0) this.sleepFade = Math.max(0, this.sleepFade - 0.05);
      return;
    }
    this.sleepTicks++;
    this.sleepFade = Math.min(1, this.sleepTicks / 20);
    // Damage or lava interrupts the sleep without advancing the clock.
    if (this.survival.hurtTime > 0 || this.playerInLava()) { this.wakeUp(false); return; }
    if (this.sleepTicks >= 60) this.wakeUp(true);
  }

  /**
   * Animal.mobInteract: feeding a baby skips 10% of its remaining growth time;
   * feeding an adult that can fall in love starts the 600-tick love timer and
   * shows hearts. Adults still on the 6000-tick cooldown ignore the click
   * (vanilla does not consume the item).
   */
  private feedAnimal(animal: Animal): void {
    const creative = this.options.gamemode === 'creative';
    if (animal.isBaby()) {
      animal.feedBaby();
      if (!creative) this.survival.inventory.removeFromSelected(false);
      return;
    }
    if (!animal.canFallInLove()) return;
    animal.setInLove(true, 600);
    spawnHearts(animal.x, animal.y + animal.getHeight() * 0.8, animal.z, 3);
    if (!creative) this.survival.inventory.removeFromSelected(false);
  }

  /** BowItem.releaseUsing: fire an arrow scaled by the hold time. */
  private releaseBow(): void {
    if (!this.bowCharging) return;
    this.bowCharging = false;
    const charge = Math.min(1, this.bowCharge / 20);
    this.bowCharge = 0;
    if (this.screens.current || !this.mouseLocked || charge < 0.1) return;
    const held = this.survival.getSelectedStack();
    if (!held.item || held.item.name !== 'bow') return;

    let arrowSlot = -1;
    let arrowPotion: string | null = null;
    for (let i = 0; i < 36; i++) {
      const st = this.survival.inventory.getItem(i);
      if (st.isEmpty() || !st.item) continue;
      if (st.item.name === 'arrow' || st.item.name === 'tipped_arrow') {
        arrowSlot = i;
        if (st.item.name === 'tipped_arrow') arrowPotion = st.components.potion ?? null;
        break;
      }
    }
    if (arrowSlot < 0 && this.options.gamemode !== 'creative') return;
    if (arrowSlot >= 0 && this.options.gamemode !== 'creative') this.survival.inventory.removeItem(arrowSlot, 1);

    const eye = this.cameraEye();
    const dir = this.lookVector();
    const arrow = new Arrow(this.level, eye.x + dir.x * 0.5, eye.y - 0.1, eye.z + dir.z * 0.5);
    arrow.owner = this.entityManager.getPlayerTarget();
    // Arrow.getPotionContents/getPotionDurationScale from the pickup item stack.
    arrow.potion = arrowPotion;
    arrow.potionDurationScale = arrowPotion ? 0.125 : 1;
    const speed = 1.0 + charge * 2.0;
    arrow.shoot(dir.x * speed, dir.y * speed, dir.z * speed);
    arrow.critical = charge >= 1;
    arrow.damage = Math.max(1, Math.round(charge * 6 * (arrow.critical ? 1.5 : 1)));
    this.entityManager.spawnEntity(arrow);
    if (this.options.gamemode !== 'creative') held.hurtAndBreak(1);
    this.sounds.play('entity.arrow.shoot', eye.x, eye.y, eye.z, 1, 1);
    this.useCooldown = 4;
  }

  /** Block adjacent to the clicked face (0 down, 1 up, 2 north, 3 south, 4 west, 5 east). */
  private adjacentBlock(hit: { x: number; y: number; z: number; face: number }): { x: number; y: number; z: number } {
    switch (hit.face) {
      case 0: return { x: hit.x, y: hit.y - 1, z: hit.z };
      case 2: return { x: hit.x, y: hit.y, z: hit.z - 1 };
      case 3: return { x: hit.x, y: hit.y, z: hit.z + 1 };
      case 4: return { x: hit.x - 1, y: hit.y, z: hit.z };
      case 5: return { x: hit.x + 1, y: hit.y, z: hit.z };
      default: return { x: hit.x, y: hit.y + 1, z: hit.z };
    }
  }

  /** First water/lava block along the look ray (fluids are not part of raycast's outline test). */
  private fluidRay(maxDistance: number): { x: number; y: number; z: number; name: string; dist: number } | null {
    const eye = this.cameraEye();
    const dir = this.lookVector();
    for (let dist = 0.1; dist <= maxDistance; dist += 0.1) {
      const x = Math.floor(eye.x + dir.x * dist);
      const y = Math.floor(eye.y + dir.y * dist);
      const z = Math.floor(eye.z + dir.z * dist);
      const name = this.mc.blockOf(this.level.getBlockState(x, y, z)).name;
      if (name === 'water' || name === 'lava') return { x, y, z, name, dist };
    }
    return null;
  }

  /** ItemBucket useOn: place a source block at the clicked face, return an empty bucket. */
  private placeFluidBucket(hit: { x: number; y: number; z: number; face: number }, fluid: 'water' | 'lava'): void {
    const t = this.adjacentBlock(hit);
    if (this.level.getBlockState(t.x, t.y, t.z) !== 0) return;
    const state = this.mc.stateOf(fluid);
    if (!state) return;
    this.level.setBlockState(t.x, t.y, t.z, state);
    this.updateNeighbors(t.x, t.y, t.z);
    if (this.options.gamemode !== 'creative') {
      this.survival.inventory.removeFromSelected(false);
      const bucket = this.survival.registry.byName('bucket');
      if (bucket) this.survival.inventory.add(new ItemStack(bucket, 1));
    }
    this.sounds.play('item.bucket.empty', t.x + 0.5, t.y + 0.5, t.z + 0.5, 1, 1);
    this.useCooldown = 10;
  }

  /** Empty bucket use: remove the source block and put the filled bucket back in the inventory. */
  private pickUpFluid(fluid: { x: number; y: number; z: number; name: string; dist: number }): void {
    this.level.setBlockState(fluid.x, fluid.y, fluid.z, 0);
    this.updateNeighbors(fluid.x, fluid.y, fluid.z);
    this.survival.inventory.removeFromSelected(false);
    const item = this.survival.registry.byName(fluid.name === 'water' ? 'water_bucket' : 'lava_bucket');
    if (item) this.survival.inventory.add(new ItemStack(item, 1));
    this.sounds.play('item.bucket.fill', fluid.x + 0.5, fluid.y + 0.5, fluid.z + 0.5, 1, 1);
    this.useCooldown = 10;
  }

  /**
   * FlintAndSteel useOn: TntBlock.useItemOn primes TNT directly; otherwise ignite
   * the adjacent air block (fire spread is not simulated yet).
   */
  private igniteBlock(hit: { x: number; y: number; z: number; face: number }): void {
    const clicked = this.level.getBlockState(hit.x, hit.y, hit.z);
    if (clicked !== 0 && this.mc.blockOf(clicked).name === 'tnt') {
      this.level.setBlockState(hit.x, hit.y, hit.z, 0);
      this.updateNeighbors(hit.x, hit.y, hit.z);
      this.primeTnt(hit.x + 0.5, hit.y, hit.z + 0.5, 80, this.entityManager.getPlayerTarget());
      if (this.options.gamemode !== 'creative') this.survival.getSelectedStack().hurtAndBreak(1);
      this.useCooldown = 10;
      return;
    }
    const t = this.adjacentBlock(hit);
    if (this.level.getBlockState(t.x, t.y, t.z) !== 0) return;
    const fire = this.mc.stateOf('fire');
    if (!fire) return;
    this.level.setBlockState(t.x, t.y, t.z, fire);
    this.updateNeighbors(t.x, t.y, t.z);
    if (this.options.gamemode !== 'creative') this.survival.getSelectedStack().hurtAndBreak(1);
    this.sounds.play('item.flintandsteel.use', t.x + 0.5, t.y + 0.5, t.z + 0.5, 1, 1);
    this.useCooldown = 10;
  }

  /** `minecraft:zombie_spawn_egg` -> `zombie`; null for non-spawn-egg items. */
  private spawnEggType(itemName: string): string | null {
    const suffix = '_spawn_egg';
    if (!itemName.endsWith(suffix)) return null;
    return itemName.slice(0, -suffix.length);
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

  /** Recomputes connections/shapes next to a change and drops unsupported plants. */
  private updateNeighbors(x: number, y: number, z: number): void {
    for (let dy = -1; dy <= 1; dy++) {
      for (let dz = -1; dz <= 1; dz++) {
        for (let dx = -1; dx <= 1; dx++) {
          this.updateBlockShape(x + dx, y + dy, z + dz);
        }
      }
    }
    this.redstone?.onBlockChanged(x, y, z);
    this.removeUnsupportedAround(x, y, z, 0);
  }

  /**
   * BlockState.updateNeighbourShapes: a change can invalidate a plant, torch, door
   * or snow layer next to/above it. Remove it with its loot, then propagate so a
   * tall grass column or a double plant collapses completely.
   */
  private removeUnsupportedAround(x: number, y: number, z: number, depth: number): void {
    if (depth > 6) return;
    const offsets: readonly (readonly [number, number, number])[] = [
      [0, 0, 0], [1, 0, 0], [-1, 0, 0], [0, 1, 0], [0, -1, 0], [0, 0, 1], [0, 0, -1],
    ];
    for (const [dx, dy, dz] of offsets) {
      const px = x + dx, py = y + dy, pz = z + dz;
      const state = this.level.getBlockState(px, py, pz);
      if (state === 0) continue;
      if (survivesAt(this.mc, this.level, state, px, py, pz)) continue;
      const drops = this.survival.breakBlock(
        (qx, qy, qz) => this.level.getBlockState(qx, qy, qz), px, py, pz, true,
      );
      this.level.setBlockState(px, py, pz, 0);
      for (const stack of drops) this.dropItem(stack, px, py, pz);
      this.breakEffects(state, px, py, pz);
      this.removeUnsupportedAround(px, py, pz, depth + 1);
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
    // Sound is not needed for the first frame and parsing+decoding the index cost ~390 ms of the
    // main thread. Kick it off once the loop is running so it cannot delay the loading screen.
    setTimeout(() => {
      void this.sounds.load('/mc/sounds/index.json')
        // autoUnlock() binds once, but the one-shot listeners can fire *before* load() has created
        // the AudioContext (in which case resume() is a no-op). Try again once it exists.
        .then(() => (this.sounds.isUnlocked ? undefined : this.sounds.resume()))
        .catch((err) => console.warn('[sound] unavailable', err));
    }, 0);
  }

  stop(): void { this.running = false; }

  private frame = (now: number): void => {
    if (!this.running) return;
    const dt = Math.min(100, now - this.lastFrame);
    this.lastFrame = now;
    this.lastDt = dt;

    // Vanilla Options.FRAMERATE_LIMIT: only run the expensive render pass when a
    // frame is due. Input, ticks and chunk streaming still advance every rAF, so
    // capping the frame rate never slows the 20 Hz simulation.
    this.renderAccum += dt;
    const maxFps = Math.max(1, Number(this.options.maxFps) || 120);
    const frameInterval = 1000 / maxFps;
    const renderDue = this.renderAccum >= frameInterval - 1;
    const renderDt = this.lastRenderAt > 0 ? now - this.lastRenderAt : dt;

    const frameStart = performance.now();
    if (renderDue) {
      this.lastRenderAt = now;
      this.perfLog?.beginFrame(renderDt);
    }
    // OpusMC FramePacer: budget this frame's chunk/mesh work from the measured cost of the
    // previous frame instead of a constant. This is the single biggest lever on movement
    // smoothness (a hard-coded 6 ms budget could push a busy frame past the 16.7 ms deadline).
    const chunkBudget = this.pacer.beginFrame(dt);
    this.frameChunkBudget = chunkBudget;
    this.frameChunkMs = 0;

    if (renderDue) {
      this.frames++;
      this.fpsTimer += renderDt;
      if (this.fpsTimer >= 500) {
        this.fps = Math.round((this.frames * 1000) / this.fpsTimer);
        this.frames = 0;
        this.fpsTimer = 0;
      }
    }

    // Vanilla MouseHandler accumulates movementX/Y and MouseHandler#turnPlayer applies it
    // ONCE per rendered frame. Writing yaw/pitch from every pointermove event (which can fire
    // at 500-1000 Hz under pointer lock) made the camera race the rAF loop: some frames saw
    // several deltas, some none, which reads as stutter while turning.
    this.applyPendingLook();

    // A paused/title world must not advance the fixed-step accumulator. Previously tick() bailed
    // out but `accum` kept draining, so partial still cycled 0->1->0 while prevPos/pos were
    // frozen: the camera oscillated between the last two positions (the "pause twitch" bug) and
    // sky/lightmap were re-derived every frame from time+partial, making the whole scene shimmer.
    const worldTicking = this.worldActive;
    if (worldTicking) {
      this.accum += dt;
      let ticks = 0;
      while (this.accum >= TICK_MS && ticks < 5) {
        this.tick();
        this.accum -= TICK_MS;
        ticks++;
      }
      // If we hit the catch-up cap, drop the backlog instead of letting partial drift > 1.
      if (this.accum >= TICK_MS) this.accum = TICK_MS - 0.001;
    } else {
      this.accum = 0;
    }

    this.syncTouchUi();
    if (renderDue) this.render(worldTicking ? this.accum / TICK_MS : 1);
    const cpuMs = performance.now() - frameStart;
    this.pacer.endFrame(cpuMs, this.frameChunkMs);
    if (renderDue) {
      // Keep the fractional remainder so the average matches maxFps even when the
      // display refresh is not a multiple of it (e.g. 120 fps on a 165 Hz panel).
      this.renderAccum = Math.min(frameInterval, Math.max(0, this.renderAccum - frameInterval));
      this.perfLog?.endFrame(cpuMs);
      this.adaptRenderScale(cpuMs, renderDt);
    }
    requestAnimationFrame(this.frame);
  };

  /**
   * Dynamic resolution, the same lever OpusMC uses: the 3D buffer is the only setting whose GPU
   * cost scales linearly with pixels, so when frames come in late for reasons that are NOT the
   * main thread, drop the render scale; raise it again when there is headroom.
   *
   * Guarded by `cpuMs` so a CPU-bound frame (chunk relight, GC) never makes the picture blurry
   * without gaining anything. Steps are one per ~45 frames because reallocating the HDR/TAA
   * targets costs a frame.
   */
  private adaptRenderScale(cpuMs: number, dt: number): void {
    if (this.titleMode || !this.worldActive || !this.options.dynamicResolution) return;
    this.scaleProbeMs += dt;
    this.scaleProbeFrames++;
    if (dt > this.scaleProbeMax) this.scaleProbeMax = dt;
    if (this.scaleProbeFrames < 45) return;
    const avg = this.scaleProbeMs / this.scaleProbeFrames;
    const worst = this.scaleProbeMax;
    this.scaleProbeMs = 0;
    this.scaleProbeFrames = 0;
    this.scaleProbeMax = 0;
    const target = this.pacer.target();
    // 区块流式加载期间帧间隔必然抖（一个 chunk 就是一次长任务），这时候降分辨率既救不了
    // 主线程又会把画面永久调糊 —— 只在「世界基本稳定」的窗口里做决定。
    if (worst > target * 3) { this.scaleQuiet = 0; return; }
    const gpuBound = cpuMs < target * 0.6;
    if (avg > target * 1.12 && gpuBound && this.renderScale > 0.55) {
      // 降档前先记住「上一档撑不住」，上限随每次失败下移，避免在两档之间来回抖
      this.scaleCeiling = Math.min(this.scaleCeiling, this.renderScale);
      this.renderScale = Math.max(0.55, this.renderScale * 0.85);
      this.scaleQuiet = 0;
      this.applyRenderScale();
      console.log(`[perf] render scale ${(this.renderScale * 100).toFixed(0)}% (frame ${avg.toFixed(1)} ms)`);
    } else if (avg <= target * 1.05) {
      // 只有连续几个窗口都贴着刷新率，才认为有富余可以升档（60Hz 下 avg 恒为 16.7ms，
      // 用「明显小于 16.7」判断会永远升不回去）
      this.scaleQuiet++;
      if (this.scaleQuiet >= 2 && this.renderScale < this.scaleCeiling - 0.01) {
        const next = Math.min(this.scaleCeiling, this.renderScale * 1.08);
        // 离上限只差一步时直接吸附上去，否则 1.08 的步长会永远停在 99% 而不是 100%
        this.renderScale = next > this.scaleCeiling * 0.98 ? this.scaleCeiling : next;
        this.scaleQuiet = 0;
        this.applyRenderScale();
      }
    } else {
      this.scaleQuiet = 0;
    }
  }

  /** Test hook (scripts/perf-audit.mjs): force the 3D render scale; 1 = native at MAX_RENDER_PIXELS. */
  setRenderScale(scale: number): void {
    this.renderScale = Math.max(0.4, Math.min(this.maxRenderScale, scale));
    this.applyRenderScale();
  }

  /**
   * Perf report diagnostics (debug-only, called from PerfLog). Camera/motion/screen state plus the
   * number of sections near the camera that still have no mesh - the "can see through the ground"
   * holes - so one report is enough to tell a physics bug from a streaming bug.
   */
  perfDiagnostics(): Record<string, string | number> {
    const p = this.player;
    const missing = this.renderer.nearMissingStats(this.level, p.pos.x, p.pos.y, p.pos.z, 2);
    const n = Math.max(1, Math.min(this.hSpeedIndex, this.hSpeedTrace.length));
    const speeds = Array.from(this.hSpeedTrace.subarray(0, n));
    return {
      playerPos: `${p.pos.x.toFixed(2)}, ${p.pos.y.toFixed(2)}, ${p.pos.z.toFixed(2)}`,
      playerLook: `yaw ${p.yaw.toFixed(1)} / pitch ${p.pitch.toFixed(1)}`,
      playerVel: `${p.vel.x.toFixed(3)}, ${p.vel.y.toFixed(3)}, ${p.vel.z.toFixed(3)}`
        + ` (h ${Math.hypot(p.vel.x, p.vel.z).toFixed(3)}, ${p.onGround ? 'ground' : 'air'}`
        + `${p.flying ? ', fly' : ''}${p.sprinting ? ', sprint' : ''}${p.inWater ? ', water' : ''})`,
      hSpeedTrace: `min ${Math.min(...speeds).toFixed(3)} / max ${Math.max(...speeds).toFixed(3)}`
        + ` / near-zero ${speeds.filter((v) => v < 0.02).length}/${speeds.length}`,
      sectionsMissing: `${missing.missing} (below ${missing.below}, queued ${missing.queued})`,
      hudBreakdown: `hud ${this.hudMs.toFixed(2)}ms / chat ${this.chatMs.toFixed(2)}ms`
        + ` / icons ${this.icons.drawStats.ms.toFixed(2)}ms (${this.icons.drawStats.n} draws, cell ${this.icons.cellSizePx}px)`,
      eyeSky: this.level.getSkyLight(Math.floor(p.pos.x), Math.floor(p.eyeY), Math.floor(p.pos.z)),
      screen: `${window.innerWidth}x${window.innerHeight} css @${(window.devicePixelRatio || 1).toFixed(2)}dpr`
        + `${document.fullscreenElement ? ' fullscreen' : ''}`,
      renderTargets: `3d ${this.targetW}x${this.targetH} / canvas ${this.glCanvas.width}x${this.glCanvas.height}`
        + ` / gui ${this.guiCanvas.width}x${this.guiCanvas.height}`
        + ` / scale ${(this.renderScale * 100).toFixed(0)}% (max ${(this.maxRenderScale * 100).toFixed(0)}%)`,
      resizeEvents: this.resizeCount,
    };
  }

  /** MouseHandler#turnPlayer: consume the accumulated pointer delta once per frame. */
  private applyPendingLook(): void {
    if (this.pendingLookX === 0 && this.pendingLookY === 0) return;
    const dx = this.pendingLookX;
    const dy = this.pendingLookY;
    this.pendingLookX = 0;
    this.pendingLookY = 0;
    if (this.screens.current || !this.worldActive) return;
    const sens = 0.15 * (this.zooming ? 0.25 : 1);
    this.player.yaw -= dx * sens;
    this.player.pitch = Math.max(-90, Math.min(90, this.player.pitch + dy * sens));
  }

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
    if (this.tickCount % 10 === 0) this.tickAdvancements();

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
    // ServerPlayer.startSleepInBed freezes travel input while asleep.
    if (this.sleeping) {
      input.forward = 0; input.strafe = 0; input.jump = false; input.sprint = false; input.sneak = false;
    }
    // Riding a minecart locks the player to the cart; sneaking dismounts. The cart's
    // own tick (EntityManager) drives the rail movement.
    if (this.ridingMinecart) {
      const cart = this.ridingMinecart;
      if (cart.isRemoved()) {
        this.ridingMinecart = null;
        cart.rider = null;
      } else if (input.sneak) {
        this.dismountMinecart();
      } else {
        this.player.pos.x = cart.x;
        this.player.pos.y = cart.y + 0.35;
        this.player.pos.z = cart.z;
        this.player.vel = new Vec3(0, 0, 0);
        this.player.onGround = true;
        this.player.fallDistance = 0;
        this.player.flying = false;
      }
    }
    // Riding a boat: A/D turn the boat, W/S accelerate/reverse, the head may turn
    // up to 105 degrees off the hull (AbstractBoat.controlBoat + clampRotation).
    else if (this.ridingBoat) {
      const boat = this.ridingBoat;
      if (boat.isRemoved() || boat.shouldEjectRider() || input.sneak) {
        this.dismountBoat();
      } else {
        boat.setInput(input.strafe < 0, input.strafe > 0, input.forward > 0, input.forward < 0);
        this.player.pos.x = boat.x;
        this.player.pos.y = boat.y + boat.getRideHeight();
        this.player.pos.z = boat.z;
        this.player.vel = new Vec3(0, 0, 0);
        this.player.onGround = true;
        this.player.fallDistance = 0;
        this.player.flying = false;
        let delta = ((this.player.yaw - boat.yaw + 540) % 360) - 180;
        delta = Math.max(-105, Math.min(105, delta));
        this.player.yaw = boat.yaw + delta;
      }
    }
    if (!this.ridingMinecart && !this.ridingBoat) this.player.tick(this.level, input);
    this.hSpeedTrace[this.hSpeedIndex % this.hSpeedTrace.length] =
      Math.hypot(this.player.vel.x, this.player.vel.z);
    this.hSpeedIndex++;

    // Fall damage: LivingEntity.causeFallDamage runs when a falling entity lands. Player.tick
    // resets fallDistance on the landing tick, so use the value accumulated before the move.
    if (!this.survival.isDead && !wasOnGround && this.player.onGround && !this.player.flying
      && !this.player.inWater && !this.survival.hasEffect('slow_falling')) {
      const fall = Math.max(fallDistanceBefore, this.player.fallDistance);
      if (fall > 0) this.survival.fallDamage(fall);
    }

    if (this.attackCooldown > 0) this.attackCooldown--;
    if (this.useCooldown > 0) this.useCooldown--;
    if (this.bowCharging) {
      const held = this.survival.getSelectedStack();
      if (held.item?.name === 'bow') this.bowCharge = Math.min(20, this.bowCharge + 1);
      else { this.bowCharging = false; this.bowCharge = 0; }
    }
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
    this.syncPotionMovement();
    this.redstone.tick();
    this.tickStatistics(moved.jumped);
    this.tickSleep();
    this.tickVillageGolemSpawn();
    this.wanderingTraderSpawner.tick();
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
      fov: this.options.fov, aspect: this.targetW / this.targetH,
    };
    this.weatherRenderer.tick(cam, this.levelLike, 1);
    if (this.pendingJukeboxResume && this.sounds.isReady) this.resumeJukeboxPlayback();
    this.sounds.tick(cam, this.levelLike);
    this.tickAudioEvents();
    this.tickCaveAmbience();

    // keep the ring of chunks around the player loaded; generation happens on the workers and
    // finished chunks are applied here under a time budget
    this.ensureChunksAround();
    // Applying a generated chunk (palette decode + full relight) is ~6-10 ms of main thread.
    // Measure it and charge it to the pacer; the mesh budget below is whatever is LEFT.
    const drainStart = performance.now();
    this.chunksAppliedThisFrame = this.chunkProvider.drain(this.level, 1);
    this.frameChunkMs += performance.now() - drainStart;
    // ...and drop the chunks that fell out of the retention band behind us (vanilla
    // ClientChunkCache), so a long trip does not keep the whole visited world in memory
    this.unloadFarChunks();

    // entities last so they see the chunks that were just applied
    this.entityManager.tick();
    for (const e of this.entityManager.getEntities()) {
      if (e instanceof FishingBobber && e.biting && !e.splashPlayed) {
        e.splashPlayed = true;
        this.sounds.play('entity.fishing_bobber.splash', e.x, e.y, e.z, 0.6, 1.2);
      }
    }
    this.pickupNearbyItems();
    this.syncEntityChunks();
    // Saved chunk entities spawn as their chunk enters the view (also right after a load).
    this.activateSavedChunkEntities();

    this.autosave?.tick();
  }

  /** StatsCustom counters that advance every tick (ServerPlayer.checkMovementStatistics). */
  private tickStatistics(jumped: boolean): void {
    this.stats.award('custom', 'play_time');
    this.stats.award('custom', 'total_world_time');
    const dx = this.player.pos.x - this.lastStatX;
    const dz = this.player.pos.z - this.lastStatZ;
    const cm = Math.round(Math.hypot(dx, dz) * 100);
    if (cm > 0) {
      const key = this.player.flying ? 'fly_one_cm'
        : this.player.swimming ? 'swim_one_cm'
        : this.player.sneaking ? 'crouch_one_cm'
        : this.player.sprinting ? 'sprint_one_cm'
        : 'walk_one_cm';
      this.stats.award('custom', key, cm);
    }
    this.lastStatX = this.player.pos.x;
    this.lastStatZ = this.player.pos.z;
    if (jumped) this.stats.award('custom', 'jump');
  }

  /** Adds every pickable ItemEntity in reach to the inventory (vanilla Player.take). */
  private pickupNearbyItems(): void {
    const p = this.player.pos;
    for (const e of this.entityManager.getEntities()) {
      if (!(e instanceof ItemEntity) || e.isRemoved() || !e.isPickable()) continue;
      if (e.distanceToSqr(p.x, p.y, p.z) > 2.25) continue; // 1.5 blocks
      const stack = e.getItem();
      if (stack.isEmpty()) { e.remove(); continue; }
      const pickedItem = stack.item?.name;
      const pickedUp = stack.getCount();
      if (!this.survival.inventory.add(stack)) continue; // inventory full: leave it on the ground
      if (pickedItem) this.stats.award('picked_up', pickedItem, pickedUp);
      e.remove();
      // ItemEntity.playerTouch: ENTITY_ITEM_PICKUP volume 0.2, pitch (random - random) * 1.4 + 2 (clamped by the engine)
      this.sounds.play('entity.item.pickup', p.x, p.y, p.z, 0.2, 1.6 + Math.random() * 0.4);
    }
    for (const e of this.entityManager.getEntities()) {
      if (!(e instanceof ExperienceOrb) || e.isRemoved()) continue;
      if (e.distanceToSqr(p.x, p.y, p.z) > 2.25) continue;
      this.survival.addExperience(e.getValue());
      e.remove();
      this.sounds.play('entity.experience_orb.pickup', p.x, p.y, p.z, 0.3, 1.6 + Math.random() * 0.4);
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
    // Saved chunks are decoded from their retained NBT instead of being generated
    // from the seed. At most two per tick, so a teleport back into explored terrain
    // cannot stall a frame.
    let savedLoads = 0;
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
          const key = chunkKey(cx, cz);
          const saved = savedLoads < 2 ? this.savedChunkBytes.get(key) : undefined;
          if (saved) {
            try {
              const chunk = ChunkSerializer.fromBytes(saved, this.mc, this.chunkCodec);
              this.level.addChunksBulk([chunk]);
              this.restoreJukeboxRecords(chunk);
              this.level.markDirtyAround(cx << 4, this.level.minY, cz << 4);
              this.entityManager.markChunkKnown(cx, cz);
              savedLoads++;
              continue;
            } catch (err) {
              console.warn('[save] unreadable saved chunk:', err);
            }
          }
          // Saved but not read yet: fetch its bytes (one read per chunk), decode on the
          // next tick. Falling through to request() would generate over the save.
          if (savedLoads < 2 && this.savedChunkCoords.has(key) && !this.pendingSavedChunks.has(key)) {
            this.pendingSavedChunks.add(key);
            savedLoads++;
            void this.saveManager?.readChunkBytes(cx, cz).then((bytes) => {
              if (bytes) this.savedChunkBytes.set(key, bytes);
              else this.savedChunkCoords.delete(key); // missing record: allow generation
            }).catch(() => this.savedChunkCoords.delete(key))
              .finally(() => this.pendingSavedChunks.delete(key));
            continue;
          }
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
    // Entities die with their chunk in this client, so snapshot every live entity
    // before the removal and write the chunks that carry one straight back to the
    // save store and the in-memory saved-byte cache. Vanilla does the same in
    // ChunkMap.save; the cache is what lets a returning player reload the chunk.
    const live = this.liveEntitiesByChunk();
    const removed = this.level.unloadFarChunks(pcx, pcz, retain);
    if (removed.length === 0) return;
    for (const c of removed) {
      const records = live.get(`${c.x},${c.z}`) ?? [];
      if (records.length > 0 || c.hadEntities) {
        c.entities = records;
        c.hadEntities = records.length > 0;
        c.entitiesDirty = false;
        c.dirtySections.clear();
        const bytes = ChunkSerializer.toBytes(c, this.chunkCodec);
        this.savedChunkBytes.set(chunkKey(c.x, c.z), bytes);
        void this.saveManager?.saveChunkData(c.x, c.z, bytes).catch(() => {});
      }
      this.entityManager.unloadChunk(c.x, c.z);
    }
    this.renderer.prune(this.player.pos.x, this.player.pos.z, this.level);
  }

  /**
   * Fullscreen (and the mobile URL bar) fires resize dozens of times while the transition is
   * running. Every one of those used to realloc both canvases, release every post target and
   * rebake the 1600 item icons, which is exactly the 20-30 fps + black flash the user hit when
   * playing fullscreen. Coalesce them into one resize at the final size.
   */
  private scheduleResize(): void {
    this.resizeCount++;
    // Keep the CSS size in sync immediately (the browser stretches the existing backing store for
    // the length of the transition); only the costly canvas/target reallocation is deferred.
    const cssW = `${window.innerWidth}px`;
    const cssH = `${window.innerHeight}px`;
    this.guiCanvas.style.width = cssW;
    this.guiCanvas.style.height = cssH;
    this.glCanvas.style.width = cssW;
    this.glCanvas.style.height = cssH;
    if (this.resizeTimer !== 0) window.clearTimeout(this.resizeTimer);
    this.resizeTimer = window.setTimeout(() => {
      this.resizeTimer = 0;
      this.resize();
    }, 120);
  }

  private resize(): void {
    const dpr = Math.min(window.devicePixelRatio || 1, 2);
    const w = window.innerWidth;
    const h = window.innerHeight;
    const physW = Math.floor(w * dpr);
    const physH = Math.floor(h * dpr);
    const key = `${physW}x${physH}`;
    if (key === this.lastResizeKey) return;
    this.lastResizeKey = key;
    // The GUI canvas stays at full device pixels (text and item icons must stay crisp), but the
    // 3D buffer is capped and upscaled by the compositor. Measured on a GTX 1050: the scene pass
    // costs ~8 ms/MP, so a 3840x2160 buffer (8.3 MP, i.e. 1080p at devicePixelRatio 2 — the
    // default on most Windows laptops) needs 23 ms and pins the client at ~39 fps. The same
    // scene at 2.1 MP runs at 7 ms and holds the refresh rate.
    this.guiCanvas.width = physW;
    this.guiCanvas.height = physH;
    this.guiCanvas.style.width = `${w}px`;
    this.guiCanvas.style.height = `${h}px`;
    this.maxRenderScale = Math.min(1, Math.sqrt(MAX_RENDER_PIXELS / Math.max(1, physW * physH)));
    this.renderScale = Math.min(this.renderScale, this.maxRenderScale);
    // 窗口/DPR 变了，之前测出的「撑不住的档位」不再适用，重置上限重新爬
    this.scaleCeiling = this.maxRenderScale;
    this.scaleQuiet = 0;
    this.applyCanvasSize();
    this.applyRenderScale();
    this.glCanvas.style.width = `${w}px`;
    this.glCanvas.style.height = `${h}px`;
    // resizing the backing store resets 2D context state
    this.guiCtx.imageSmoothingEnabled = false;
    // GUI scale can change with the viewport (or when moving between DPI screens): re-bake
    // item icons at the new physical slot size so they are never pixelated blobs.
    this.icons?.build(this.guiScale);
    this.screens?.resize(w, h);
    this.touch?.updateMetrics(this.guiScale);
  }

  /** Allocates the GL drawing buffer once per window size. Dynamic resolution never calls this. */
  private applyCanvasSize(): void {
    const w = Math.max(320, Math.floor(this.guiCanvas.width * this.maxRenderScale));
    const h = Math.max(180, Math.floor(this.guiCanvas.height * this.maxRenderScale));
    if (this.glCanvas.width !== w || this.glCanvas.height !== h) {
      this.glCanvas.width = w;
      this.glCanvas.height = h;
    }
  }

  /**
   * Sizes the 3D drawing target from the CSS size, the device pixel ratio and `renderScale`.
   * Called on resize and whenever the adaptive resolution decides to step.
   *
   * With shaders on, only the HDR/TAA/bloom targets change size; the GL canvas keeps its fixed
   * backing store and the final composite upscales into it. Reallocating the canvas (the old
   * behaviour) dropped one frame's targets and produced the short black flash while playing.
   */
  private applyRenderScale(): void {
    const scale = Math.max(0.4, Math.min(this.maxRenderScale, this.renderScale));
    const usePost = this.renderer?.shadersEnabled ?? false;
    const w = usePost ? Math.max(320, Math.floor(this.guiCanvas.width * scale)) : this.glCanvas.width;
    const h = usePost ? Math.max(180, Math.floor(this.guiCanvas.height * scale)) : this.glCanvas.height;
    this.targetW = w;
    this.targetH = h;
    this.renderer?.resize(w, h);
  }

  get guiScale(): number {
    const forced = this.options.guiScale > 0 ? this.options.guiScale : 0;
    // GUI layout follows the DISPLAY resolution, not the (possibly reduced) 3D buffer, otherwise
    // dropping render scale would silently shrink the HUD.
    const auto = calcGuiScale(this.guiCanvas.width, this.guiCanvas.height, forced, false);
    // OpusMC uses 3x GUI pixels on phones; vanilla's auto scale picks 2 on a 390 px-wide device.
    // Three matches the reference screenshots and makes slot/font lines one CSS pixel, not 1.5.
    return this.touchDevice && auto < 3 ? 3 : auto;
  }

  private render(partial: number): void {
    const gl = this.gl;
    // Vanilla has NO level while the title screen owns the client: the panorama is drawn over
    // a solid colour, not over a live 3D scene. Rendering the world behind a semi-transparent
    // title overlay produced a one-frame black line on quit (stale HDR/TAA history) and made
    // the menu background shimmer. Skip the whole 3D chain but keep clearing the GL canvas.
    if (this.titleMode) {
      gl.bindFramebuffer(gl.FRAMEBUFFER, null);
      gl.viewport(0, 0, this.glCanvas.width, this.glCanvas.height);
      gl.disable(gl.SCISSOR_TEST);
      gl.clearColor(0.08, 0.09, 0.12, 1);
      gl.clear(gl.COLOR_BUFFER_BIT | gl.DEPTH_BUFFER_BIT);
      this.renderer.post.invalidateHistory();
      // The title screen paints over the shared GUI canvas; the next in-world frame must repaint
      // the HUD even if its cached signature would still match.
      this.hudValid = false;
      this.screens.render(partial);
      return;
    }
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
    // GameRenderer interpolates the FOV modifier; snapping it made a double-tap-to-sprint (or a
    // zoom toggle) jump the whole projection 10%/75% in a single frame - the "camera twitches
    // while flying" report, because flight speed doubles at the same moment.
    const targetFov = this.options.fov * (this.player.sprinting ? 1.1 : 1) * (this.zooming ? 0.25 : 1);
    if (this.fovSmooth < 0) this.fovSmooth = targetFov;
    // GameRenderer.tick lerps the FOV modifier by 50% per frame (≈2 frames at 60 fps); a slower
    // time constant made double-tap sprint feel sluggish compared to vanilla.
    const fovK = 1 - Math.exp(-Math.max(1, this.lastDt) / 30);
    this.fovSmooth += (targetFov - this.fovSmooth) * fovK;
    const camera: Camera = {
      x: pp.x + (p.x - pp.x) * partial,
      y: pp.y + (p.y - pp.y) * partial + (eyeY - p.y),
      z: pp.z + (p.z - pp.z) * partial,
      yaw: this.player.yaw,
      pitch: this.player.pitch,
      fov: this.fovSmooth,
      aspect: this.targetW / this.targetH,
    };

    gl.viewport(0, 0, this.targetW, this.targetH);
    // Sky access at the eye. With sky light 0 the camera is fully covered: in a correct world no
    // part of the sky can be seen, so a bright sky/fog background only shows through a missing
    // chunk section - the "white seam at the horizon while underground" report. Clear to the void
    // colour and skip the sky/cloud passes in that case instead.
    const eyeSky = this.level.getSkyLight(
      Math.floor(camera.x), Math.floor(camera.y), Math.floor(camera.z),
    );
    const skyVisible = eyeSky > 0;
    if (skyVisible) {
      // Use the same sun-aware fog colour the sky pass paints at the horizon, not the raw
      // level fog colour: at sunrise/sunset the two differ and the GL clear showed through
      // the sky disc's edge as a hard band.
      const basis = cameraBasis((camera.yaw * Math.PI) / 180, (camera.pitch * Math.PI) / 180);
      const clearFog = computeFogColor({
        fogColorArgb: argbFromRgb(skyState.fogColor),
        skyColorArgb: argbFromRgb(skyState.skyColor),
        sunriseSunsetColorArgb: skyState.sunriseColorArgb,
        sunAngleDeg: skyState.sunAngleDeg,
        cameraForward: { x: basis.forward[0], y: basis.forward[1], z: basis.forward[2] },
        skyFogEndDistance: skyState.skyFogEndDistance,
        renderDistanceBlocks: this.renderer.renderDistance * 16,
        rainLevel: this.level.getRainLevel(),
        thunderLevel: 0,
      });
      gl.clearColor(clearFog[0], clearFog[1], clearFog[2], 1);
    } else {
      gl.clearColor(0.015, 0.015, 0.02, 1);
    }
    gl.clear(gl.COLOR_BUFFER_BIT | gl.DEPTH_BUFFER_BIT);

    // Everything below this line is drawn into the HDR scene target when shaders are on.
    // Off mode binds nothing, so this is the exact pre-shader code path (pixel identical).
    this.renderer.beginScene();

    // chunks are rebuilt lazily; do it before drawing
    // OpusMC frame pacing: spend only the measured spare time on meshing. When a chunk was just
    // applied, drain() already consumed part of the budget, so subtract it instead of guessing.
    const meshBudget = Math.max(0.6, this.frameChunkBudget - this.frameChunkMs);
    const meshStart = performance.now();
    this.renderer.update(this.level, camera.x, camera.z, meshBudget, camera.y);
    this.frameChunkMs += performance.now() - meshStart;

    // Sky / clouds replace LevelRenderer.renderSky(): the old pass is NOT called any more, so the
    // sky is drawn exactly once. They use the matrices of the previous frame (renderer.render()
    // below is what refreshes them); a 16 ms stale camera basis is invisible at infinite distance.
    // NOTE: SkyRenderer's timeOfDay is `dayTime / 24000` (0 = sunrise, .25 = noon). That is *not*
    // ClientLevel.getTimeOfDay(), which is phase-shifted by -0.75 (0 = midnight), so convert.
    const skyPhase = (((this.level.time % DAY_LENGTH) + DAY_LENGTH) % DAY_LENGTH) / DAY_LENGTH;
    // FogRenderer#setupFog: FogData.skyEnd = min(renderDistanceBlocks, SKY_FOG_END_DISTANCE).
    this.skyRenderer.skyFogEnd = Math.min(skyState.skyFogEndDistance, this.renderer.renderDistance * 16);
    if (skyVisible) {
      this.skyRenderer.render(
        this.renderer.viewMatrix,
        this.renderer.projection,
        skyPhase,
        camera,
        this.level.getRainLevel(),
        this.levelLike,
      );
      // The shader path draws its own raymarched cloud layer; drawing the vanilla voxel
      // clouds too would double the cloud cover.
      if (!this.renderer.cloudsHandledByShaders) {
        this.cloudRenderer.render(this.renderer.viewProjection, camera, this.level.time, this.levelLike);
      }
    }

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
    // Rain/snow columns are placed on the surface, so with the camera fully covered they can only
    // be seen through a hole in the terrain: their lightmap brightness made them read as white
    // specks floating in the dark cave. Vanilla hides them with the terrain; skipping the pass
    // has the same visible result without drawing them at all.
    this.weatherRenderer.lightmap = this.textures.lightmap;
    if (skyVisible) {
      this.weatherRenderer.render(this.renderer.viewProjection, camera, this.level.time, this.levelLike, {
        start: skyState.fogStartDistance,
        end: skyState.fogEndDistance,
        color: skyState.fogColor,
      });
    }

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

    // Vanilla hides the HUD behind every menu (ChatScreen is the one exception). Rendering it first
    // and letting ScreenManager clear it again costs a full HUD pass per frame - measured at 236 ms
    // on a machine whose 2D canvas had fallen back to software, which made the settings screen run
    // at 10 fps while it was open.
    const screen = this.screens.current;
    if (!screen || screen.preserveHud) this.renderHud();
    // A menu clears (or draws over) the GUI canvas, so the cached HUD pixels are gone; force the
    // next in-game frame to repaint even if nothing in HudState changed.
    if (screen) this.hudValid = false;

    // Screens last: ScreenManager clears the GUI canvas (vanilla hides the HUD while a menu is up).
    this.screens.render(partial);
  }

  /** HudState assembly + canvas setup. Layout itself lives in gui/Hud.ts (Hud.java port). */
  private renderHud(): void {
    const ctx = this.guiCtx;
    const scale = this.guiScale;
    const size = guiScaledSize(this.guiCanvas.width, this.guiCanvas.height, scale);
    const w = size.width;
    const h = size.height;
    this.icons.drawStats.ms = 0;
    this.icons.drawStats.n = 0;

    // survival.airSupply / maxAirSupply / armorValue exist since the survival package landed; the
    // optional cast only covers fields that may still be missing (absorption / status effects).
    const ext = this.survival as unknown as HudSurvivalExtensions;
    const toSlot = (s: ItemStack): HudItemSlot => ({
      item: s.isEmpty() ? -1 : s.item!.id,
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
      heartKind: this.survival.hasEffect('poison') ? 'poisoned'
        : this.survival.hasEffect('wither') ? 'withered' : 'normal',
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
      // F3 text is ~0.3 ms of string building + a raycast + biome lookups per frame; do not pay
      // for it while the overlay is hidden.
      ...(this.showDebug ? this.buildDebugColumns() : { debugLeft: [], debugRight: [] }),
      showDebug: this.showDebug,
      fps: this.fps,
      gamemode: this.options.gamemode,
      tickCount: this.tickCount,
      effects: [...this.survival.effects.entries()].map(([id, e]) => ({
        id, duration: e.duration, amplifier: e.amplifier,
      })),
    };

    // Dirty check: with the debug overlay off the HUD is a pure function of HudState. Repainting it
    // every frame is wasted work - on a software 2D canvas it cost 236 ms/frame. Only repaint while
    // something is actually animating: chat fade, damage/blink/jitter, stack pop, item name, resize.
    const chatLive = this.chatLines.some((l) => performance.now() - l.time < 10_000);
    // One extra repaint after the last line expires, otherwise the old chat text stays on the canvas.
    const chatExpired = !chatLive && this.chatWasLive;
    this.chatWasLive = chatLive;
    // Toasts are composited on top of the HUD by ScreenManager; repaint so they do not smear,
    // and repaint once more after the last one expires to erase it.
    const toastsActive = this.screens.toastManager.activeCount > 0;
    const toastsExpired = !toastsActive && this.toastsWereActive;
    this.toastsWereActive = toastsActive;
    const pulsing = state.hearts < state.maxHearts
      || (state.hunger < 20 && state.saturation <= 0)
      || state.air < state.airMax || state.absorption > 0;
    const slotSig = (s: HudItemSlot | null): string => (s
      ? `${s.item},${s.count},${s.damage},${s.maxDamage},${s.popTime}`
      : '-');
    const sig = `${this.guiCanvas.width}x${this.guiCanvas.height}@${scale}`
      + `|${state.hearts},${state.maxHearts},${state.absorption},${state.heartKind},${state.hardcore}`
      + `|${state.hunger},${state.saturation},${state.hungerEffect},${state.air},${state.airMax},${state.underwater}`
      + `|${state.armor},${state.xpProgress.toFixed(3)},${state.xpLevel},${state.selectedSlot}`
      + `|${state.itemNameTimer},${state.itemName},${state.gamemode}`
      + `|fx:${(state.effects ?? []).map((e) => `${e.id}/${e.duration}/${e.amplifier}`).join(';')}`
      + `|${state.hotbar.map(slotSig).join(';')}|${slotSig(state.offhand)}`
      + `|${pulsing ? state.tickCount : 0}`
      + `|${this.sleeping ? 1 : 0},${this.sleepFade.toFixed(2)}`;
    if (!chatLive && !chatExpired && !toastsActive && !toastsExpired && !state.showDebug
      && this.hudValid && sig === this.hudSignature) {
      this.hudMs = 0;
      return;
    }
    this.hudSignature = sig;
    this.hudValid = true;

    ctx.setTransform(1, 0, 0, 1, 0, 0);
    // The HUD shares one 2D context with the screens; a screen that turns smoothing on must not
    // leave the hotbar's item icons (and font sprites) bilinear for the rest of the session.
    ctx.imageSmoothingEnabled = false;
    ctx.clearRect(0, 0, this.guiCanvas.width, this.guiCanvas.height);
    // Window#setGuiScale: logical units are framebuffer pixels / scale, so the transform is
    // exactly `scale` (not dpr * scale).
    ctx.setTransform(scale, 0, 0, scale, 0, 0);

    const hudStart = performance.now();
    this.hud.render(ctx, state, w, h, (c, item, x, y, size) => {
      this.icons.draw(c, item, x, y, size);
    });
    this.hudMs = performance.now() - hudStart;
    const chatStart = performance.now();
    this.renderChatLog(ctx, w, h);
    this.chatMs = performance.now() - chatStart;
    // Sleeping fade (Gui.ScreenEffectRenderer SLEEP / black overlay).
    if (this.sleepFade > 0) {
      ctx.setTransform(1, 0, 0, 1, 0, 0);
      ctx.globalAlpha = Math.min(1, this.sleepFade);
      ctx.fillStyle = '#000000';
      ctx.fillRect(0, 0, this.guiCanvas.width, this.guiCanvas.height);
      ctx.globalAlpha = 1;
    }
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
            `显示: ${this.glCanvas.width}x${this.glCanvas.height} (scale ${(this.renderScale * 100).toFixed(0)}%, max ${(this.maxRenderScale * 100).toFixed(0)}%) (${vendor})`,
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
    || blockName === 'trapped_chest' || blockName === 'furnace' || blockName === 'enchanting_table'
    || blockName === 'brewing_stand';
}

/** Approximate PotionContents.getColor for the lingering cloud particles. */
const POTION_CLOUD_COLORS: Readonly<Record<string, readonly [number, number, number]>> = {
  poison: [0.3, 0.8, 0.2],
  harming: [0.5, 0.1, 0.1],
  healing: [1, 0.4, 0.6],
  swiftness: [0.3, 0.7, 1],
  slowness: [0.4, 0.4, 0.6],
  regeneration: [1, 0.5, 0.7],
  strength: [0.9, 0.3, 0.2],
  weakness: [0.4, 0.5, 0.3],
  fire_resistance: [1, 0.6, 0.2],
  water_breathing: [0.3, 0.5, 1],
  night_vision: [0.2, 0.4, 0.7],
  invisibility: [0.6, 0.6, 0.8],
  slow_falling: [0.9, 0.9, 0.7],
  jump_boost: [0.4, 0.9, 0.4],
  water: [0.3, 0.5, 1],
};

/** Squared distance between two axis-aligned boxes (0 when they overlap). */
function boxDistanceSqr(a: AABB, b: AABB): number {
  const dx = Math.max(0, Math.max(a.minX - b.maxX, b.minX - a.maxX));
  const dy = Math.max(0, Math.max(a.minY - b.maxY, b.minY - a.maxY));
  const dz = Math.max(0, Math.max(a.minZ - b.maxZ, b.minZ - a.maxZ));
  return dx * dx + dy * dy + dz * dz;
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
