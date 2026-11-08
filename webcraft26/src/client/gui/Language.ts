// Port of net.minecraft.client.resources.language.I18n / Language (26.2).
// Loads public/mc/lang/en_us.json at runtime and falls back to a small built-in
// table for keys that this pack's en_us.json does not contain (the 26.2 GUI
// uses a few translation keys that are absent from the shipped lang file).
// No DOM at import time; fetch happens inside load().

export class I18n {
  private table: Record<string, string> = {};
  private enTable: Record<string, string> = {};
  code = 'en_us';
  private readonly fallback: Record<string, string> = {
    'createWorld.title': 'Create New World',
    'selectWorld.title': 'Select World',
    'selectWorld.create': 'Create New World',
    'selectWorld.select': 'Play Selected World',
    'selectWorld.delete': 'Delete',
    'selectWorld.recreate': 'Re-Create',
    'selectWorld.edit': 'Edit',
    'selectWorld.enterName': 'World Name',
    'selectWorld.enterSeed': 'Seed for the World Generator',
    'selectWorld.mapFeatures': 'Generate Structures',
    'selectWorld.mapFeatures.info': 'Structures such as villages and temples will be generated.',
    'selectWorld.bonusItems': 'Bonus Chest',
    'selectWorld.gameMode': 'Game Mode',
    'selectWorld.gameMode.survival': 'Survival',
    'selectWorld.gameMode.creative': 'Creative',
    'selectWorld.gameMode.hardcore': 'Hardcore',
    'selectWorld.difficulty': 'Difficulty',
    'selectWorld.allowCommands': 'Allow Cheats',
    'selectWorld.gameRules': 'Game Rules',
    'selectWorld.dataPacks': 'Data Packs',
    'selectWorld.moreWorldOptions': 'More World Options...',
    'createWorld.tab.game.title': 'Game',
    'createWorld.tab.world.title': 'World',
    'createWorld.tab.more.title': 'More',
    'createWorld.create': 'Create New World',
    'options.graphicsQuality': 'Graphics',
    'options.graphics.fancy': 'Fancy',
    'options.graphics.fast': 'Fast',
    'options.shaders': 'Shaders',
    'options.shaderQuality': 'Shader Quality',
    'options.guiScale': 'GUI Scale',
    'options.renderDistance': 'Render Distance',
    'options.fov': 'FOV',
    'options.gamma': 'Brightness',
    'options.framerateLimit': 'Max Framerate',
    'options.vsync': 'Use VSync',
    'options.viewBobbing': 'View Bobbing',
    'options.ao': 'Smooth Lighting',
    'options.skinCustomisation': 'Skin Customization...',
    'options.resourcepack': 'Resource Packs...',
    'options.accessibility': 'Accessibility Settings...',
    'options.telemetry': 'Telemetry...',
    'options.credits_and_attribution': 'Credits & Attribution...',
    'options.online': 'Online Options...',
    'gui.done': 'Done',
    'gui.cancel': 'Cancel',
    'gui.yes': 'Yes',
    'gui.no': 'No',
    'gui.back': 'Back',
    'menu.singleplayer': 'Singleplayer',
    'menu.multiplayer': 'Multiplayer',
    'menu.online': 'Minecraft Realms',
    'menu.options': 'Options...',
    'menu.quit': 'Quit Game',
    'menu.returnToGame': 'Back to Game',
    'menu.paused': 'Game Paused',
    'menu.game': 'Game Menu',
    'menu.disconnect': 'Disconnect',
    'menu.advancements': 'Advancements',
    'menu.stats': 'Statistics',
    'menu.shareToLan': 'Open to LAN',
    'menu.playerReporting': 'Player Reporting',
    'menu.multiplayerOptions.button': 'Multiplayer Options...',
    'menu.mods': 'Mods',
    'title.credits': 'Copyright Mojang AB. Do not distribute!',
    'deathScreen.respawn': 'Respawn',
    'deathScreen.titleScreen': 'Title Screen',
    'deathScreen.title': 'You Died!',
    'deathScreen.score': 'Score',
    'chat_screen.title': 'Chat screen',
    'chat.editBox': 'Chat',
    'container.crafting': 'Crafting',
    'container.inventory': 'Inventory',
    'container.furnace': 'Furnace',
    'container.chest': 'Chest',
    'container.creative': 'Creative Inventory',
    'itemGroup.search': 'Search Items',
    'inventory.binSlot': 'Destroy Item',
    'key.categories.movement': 'Movement',
    'key.categories.gameplay': 'Gameplay',
    'key.categories.inventory': 'Inventory',
    'key.categories.creative': 'Creative',
    'key.categories.multiplayer': 'Multiplayer',
    'key.categories.ui': 'UI',
    'key.categories.misc': 'Miscellaneous',
    'soundCategory.master': 'Master Volume',
    'soundCategory.music': 'Music',
    'soundCategory.record': 'Jukebox/Note Blocks',
    'soundCategory.weather': 'Weather',
    'soundCategory.block': 'Blocks',
    'soundCategory.hostile': 'Hostile Creatures',
    'soundCategory.neutral': 'Friendly Creatures',
    'soundCategory.player': 'Players',
    'soundCategory.ambient': 'Ambient/Environment',
    'soundCategory.voice': 'Voice/Speech',
  };

  /** Loads the en_us fallback table; the active language is chosen via setLanguage(). */
  async load(base = '/mc'): Promise<void> {
    try {
      const res = await fetch(`${base}/lang/en_us.json`);
      if (res.ok) this.enTable = (await res.json()) as Record<string, string>;
    } catch {
      // fall back to the built-in table
    }
  }

  async setLanguage(code: string, base = '/mc'): Promise<void> {
    this.code = code;
    if (code === 'en_us') { this.table = {}; return; }
    try {
      const res = await fetch(`${base}/lang/${code}.json`);
      this.table = res.ok ? ((await res.json()) as Record<string, string>) : {};
    } catch {
      this.table = {};
    }
  }

  get(key: string): string {
    // title.credits is replaced by this project's own attribution: the code belongs to this
    // recreation, the assets belong to Mojang, the original creators keep their rights and
    // redistribution is not allowed. The vanilla string ("Copyright Mojang AB. Do not
    // distribute!") is both wrong for us and unreadable as a licence notice.
    if (key === 'title.credits') return this.copyright();
    return this.table[key] ?? this.enTable[key] ?? this.fallback[key] ?? key;
  }

  private copyright(): string {
    return this.code.startsWith('zh')
      ? '代码 © CrystalKingdom · 材质 © Mojang · 禁止二次分发'
      : 'Code © CrystalKingdom · Assets © Mojang · Original rights reserved · No redistribution';
  }

  /** Bound translator suitable for ScreenEnv.t / ScreenDeps.i18n. */
  readonly t = (key: string): string => this.get(key);
}

export const DEFAULT_I18N = new I18n();
