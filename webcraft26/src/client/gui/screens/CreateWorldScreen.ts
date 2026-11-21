// Port of net.minecraft.client.gui.screens.worldselection.CreateWorldScreen (26.2).
// Sources: CreateWorldScreen.java (TAB_COLUMN_WIDTH 210, WORLD_TAB_WIDTH 310,
// HORIZONTAL_BUTTON_SPACING 10, VERTICAL_BUTTON_SPACING 8,
// Game/World/More tabs, NAME_LABEL, GAME_MODEL_LABEL, SEED_LABEL,
// GENERATE_STRUCTURES, BONUS_CHEST, footer Create/Cancel buttons),
// WorldCreationUiState.java, WorldCreationGameRulesScreen.java.
//
// Save creation goes through WorldListProvider / callbacks.onCreateWorld.

import type { GuiGraphics } from '../GuiGraphics.js';
import type { CreateWorldOptions, Difficulty, GameMode } from '../Types.js';
import { Screen } from './Screen.js';
import { Button } from '../components/Button.js';
import { EditBox } from '../components/EditBox.js';
import { CycleButton } from '../components/CycleButton.js';
import { Checkbox } from '../components/Checkbox.js';
import { TabButton } from '../components/TabButton.js';
import { BUTTON_DEFAULT_HEIGHT } from '../GuiConstants.js';

const TAB_WIDTH = 70;
const TAB_HEIGHT = 24;
const WORLD_TAB_WIDTH = 310;
const NAME_BOX_WIDTH = 200;
const NAME_BOX_HEIGHT = 20;

type TabId = 'game' | 'world' | 'more';

export class CreateWorldScreen extends Screen {
  private tab: TabId = 'game';
  private readonly state: CreateWorldOptions = {
    name: 'New World',
    gameMode: 'survival',
    difficulty: 'normal',
    seed: '',
    generateStructures: true,
    bonusChest: false,
    allowCommands: false,
  };
  private nameBox!: EditBox;
  private seedBox!: EditBox;
  private tabs: TabButton[] = [];
  private readonly labels: { text: string; x: number; y: number }[] = [];

  constructor(env: ConstructorParameters<typeof Screen>[0]) {
    super(env, 'createWorld.title');
  }

  protected build(): void {
    const cx = Math.floor(this.width / 2);
    const left = cx - Math.floor(WORLD_TAB_WIDTH / 2);
    this.labels.length = 0;

    // Three tab headers (TabNavigationBar / TabButton).
    const tabKeys: { id: TabId; label: string }[] = [
      { id: 'game', label: 'createWorld.tab.game.title' },
      { id: 'world', label: 'createWorld.tab.world.title' },
      { id: 'more', label: 'createWorld.tab.more.title' },
    ];
    this.tabs = tabKeys.map((t, i) => {
      const b = new TabButton(left + i * (TAB_WIDTH + 4), 32, TAB_WIDTH, TAB_HEIGHT, this.t(t.label),
        this.tab === t.id, () => { this.tab = t.id; this.resize(this.width, this.height); });
      this.addRenderableWidget(b);
      return b;
    });

    // World name (always visible, Game tab).
    this.labels.push({ text: this.t('selectWorld.enterName'), x: left, y: 64 });
    this.nameBox = new EditBox(left, 76, NAME_BOX_WIDTH, NAME_BOX_HEIGHT, this.t('selectWorld.enterName'));
    this.nameBox.setValue(this.state.name);
    this.nameBox.setMaxLength(32);
    this.nameBox.setResponder((v) => { this.state.name = v; });
    this.addRenderableWidget(this.nameBox);

    const y0 = 108;
    if (this.tab === 'game') {
      this.addRenderableWidget(new CycleButton<GameMode>(left, y0, NAME_BOX_WIDTH, BUTTON_DEFAULT_HEIGHT,
        this.t('selectWorld.gameMode'), ['survival', 'creative', 'hardcore'] as GameMode[], this.state.gameMode,
        (v) => v === 'survival' ? 'Survival' : v === 'creative' ? 'Creative' : 'Hardcore',
        (v) => { this.state.gameMode = v; }));
      this.addRenderableWidget(new CycleButton<Difficulty>(left, y0 + 28, NAME_BOX_WIDTH, BUTTON_DEFAULT_HEIGHT,
        this.t('selectWorld.difficulty'), ['peaceful', 'easy', 'normal', 'hard'] as Difficulty[], this.state.difficulty,
        (v) => v.charAt(0).toUpperCase() + v.slice(1),
        (v) => { this.state.difficulty = v; }));
      this.addRenderableWidget(new Checkbox(left, y0 + 56, NAME_BOX_WIDTH, 20,
        this.t('selectWorld.allowCommands'), this.state.allowCommands ?? false,
        (v) => { this.state.allowCommands = v; }));
    } else if (this.tab === 'world') {
      this.labels.push({ text: this.t('selectWorld.enterSeed'), x: left, y: y0 });
      this.seedBox = new EditBox(left, y0 + 12, NAME_BOX_WIDTH, NAME_BOX_HEIGHT, this.t('selectWorld.enterSeed'));
      this.seedBox.setValue(this.state.seed);
      this.seedBox.setResponder((v) => { this.state.seed = v; });
      this.addRenderableWidget(this.seedBox);
      this.addRenderableWidget(new Checkbox(left, y0 + 44, NAME_BOX_WIDTH, 20,
        this.t('selectWorld.mapFeatures'), this.state.generateStructures,
        (v) => { this.state.generateStructures = v; }));
      this.addRenderableWidget(new Checkbox(left, y0 + 68, NAME_BOX_WIDTH, 20,
        this.t('selectWorld.bonusItems'), this.state.bonusChest ?? false,
        (v) => { this.state.bonusChest = v; }));
    } else {
      this.addRenderableWidget(new Button(left, y0, NAME_BOX_WIDTH, BUTTON_DEFAULT_HEIGHT,
        this.t('selectWorld.gameRules'), () => this.toast(this.t('selectWorld.gameRules'))));
      this.addRenderableWidget(new Button(left, y0 + 28, NAME_BOX_WIDTH, BUTTON_DEFAULT_HEIGHT,
        this.t('selectWorld.dataPacks'), () => this.toast(this.t('selectWorld.dataPacks'))));
      this.addRenderableWidget(new Button(left, y0 + 56, NAME_BOX_WIDTH, BUTTON_DEFAULT_HEIGHT,
        this.t('selectWorld.moreWorldOptions'), () => this.toast(this.t('selectWorld.moreWorldOptions'))));
    }

    // Footer: Create (w/2 - 155) / Cancel (w/2 + 5).
    const by = this.height - 28;
    this.addRenderableWidget(new Button(cx - 155, by, 150, BUTTON_DEFAULT_HEIGHT,
      this.t('createWorld.create'), () => void this.create()));
    this.addRenderableWidget(new Button(cx + 5, by, 150, BUTTON_DEFAULT_HEIGHT,
      this.t('gui.cancel'), () => this.env.back()));
  }

  private async create(): Promise<void> {
    this.state.name = this.nameBox?.getValue() || this.state.name;
    this.state.seed = this.seedBox?.getValue() ?? this.state.seed;
    const options: CreateWorldOptions = { ...this.state };
    try {
      await this.env.deps.worlds?.create(options);
    } catch {
      // The callback below is authoritative; a missing provider is not fatal.
    }
    this.env.deps.callbacks.onCreateWorld?.(options);
    this.close();
  }

  getOptions(): CreateWorldOptions { return { ...this.state }; }

  protected renderForeground(g: GuiGraphics, _mx: number, _my: number, _pt: number): void {
    g.drawCenteredString(this.title, Math.floor(this.width / 2), 8, 0xffffffff, true);
    for (const l of this.labels) g.drawString(l.text, l.x, l.y, 0xffa0a0a0, true);
    void this.tabs;
  }

  keyPressed(code: string, char: string, mods: number): boolean {
    if (code === 'Escape') { this.env.back(); return true; }
    return super.keyPressed(code, char, mods);
  }
}
