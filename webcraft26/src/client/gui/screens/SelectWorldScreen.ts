// Port of net.minecraft.client.gui.screens.worldselection.SelectWorldScreen (26.2).
// Sources: SelectWorldScreen.java (init: WorldSelectionList, footer buttons
// "Play Selected World" / "Create New World" / "Delete" / "Edit" / "Re-Create",
// title at y=8), WorldSelectionList.java (entry height 36, name + description).
//
// Save data comes from WorldListProvider (IndexedDB agent) via ScreenDeps.worlds;
// this file only depends on the interface, never on IndexedDB or Game.ts.

import type { GuiGraphics } from '../GuiGraphics.js';
import type { WorldSummary } from '../Types.js';
import { Screen } from './Screen.js';
import { Button } from '../components/Button.js';
import { ScrollPanel } from '../components/ScrollPanel.js';
import { MemoryWorldListProvider } from '../WorldListProvider.js';
import { BUTTON_DEFAULT_HEIGHT } from '../GuiConstants.js';

const LIST_TOP = 32;
const LIST_BOTTOM_MARGIN = 98;
const ENTRY_HEIGHT = 36;
const BUTTON_WIDTH = 150;
const SMALL_BUTTON_WIDTH = 72;

export class SelectWorldScreen extends Screen {
  private list!: ScrollPanel<WorldSummary>;
  private worlds: WorldSummary[] = [];
  private readonly fallbackProvider = new MemoryWorldListProvider();
  private loaded = false;
  private playButton!: Button;
  private deleteButton!: Button;
  private exportButton!: Button;

  constructor(env: ConstructorParameters<typeof Screen>[0]) {
    super(env, 'selectWorld.title');
  }

  private get provider() {
    return this.env.deps.worlds ?? this.fallbackProvider;
  }

  protected build(): void {
    const cx = Math.floor(this.width / 2);
    const left = cx - 155;
    const width = 310;
    const height = Math.max(40, this.height - LIST_TOP - LIST_BOTTOM_MARGIN);

    this.list = new ScrollPanel<WorldSummary>(left, LIST_TOP, width, height, this.t('selectWorld.title'), {
      itemHeight: ENTRY_HEIGHT,
      renderItem: (g, w, _i, x, y, ww, hh, hovered, selected) => {
        g.fill(x, y, x + ww, y + hh, selected ? 0x80ffffff : hovered ? 0x40ffffff : 0x20000000);
        // plainSubstrByWidth: long world names must not run over the icon / scrollbar.
        const fit = (text: string, maxWidth: number): string => {
          if (g.textWidth(text) <= maxWidth) return text;
          let cut = text;
          while (cut.length > 0 && g.textWidth(`${cut}...`) > maxWidth) cut = cut.slice(0, -1);
          return `${cut}...`;
        };
        g.drawString(fit(w.name, ww - 38), x + 30, y + 7, 0xffffffff, true);
        const mode = w.gameMode ?? 'survival';
        const detail = `${this.t('selectWorld.gameMode')}: ${mode}  ${w.version ?? '26.2'}`;
        g.drawString(fit(detail, ww - 38), x + 30, y + 19, 0xffa0a0a0, false);
        // A 24x24 world icon placeholder (the save-list agent can supply one).
        g.fill(x + 3, y + 3, x + 27, y + 27, 0xff3b5f2b);
        g.outline(x + 3, y + 3, 24, 24, 0xff000000);
      },
      onSelect: (w) => {
        this.playButton.active = true;
        this.deleteButton.active = true;
        if (this.exportButton) this.exportButton.active = true;
        void w;
      },
    });
    this.list.setItems(this.worlds);
    this.addRenderableWidget(this.list);

    const by = this.height - 38;
    this.playButton = new Button(cx - 154, by, BUTTON_WIDTH, BUTTON_DEFAULT_HEIGHT,
      this.t('selectWorld.select'), () => this.play());
    this.playButton.active = false;
    this.addRenderableWidget(this.playButton);

    this.addRenderableWidget(new Button(cx + 4, by, BUTTON_WIDTH, BUTTON_DEFAULT_HEIGHT,
      this.t('selectWorld.create'), () => this.open('createWorld')));

    this.deleteButton = new Button(cx - 154, by - 24, SMALL_BUTTON_WIDTH, BUTTON_DEFAULT_HEIGHT,
      this.t('selectWorld.delete'), () => this.remove());
    this.deleteButton.active = false;
    this.addRenderableWidget(this.deleteButton);
    this.addRenderableWidget(new Button(cx - 154 + SMALL_BUTTON_WIDTH + 4, by - 24, SMALL_BUTTON_WIDTH, BUTTON_DEFAULT_HEIGHT,
      this.t('selectWorld.edit'), () => this.toast(this.t('selectWorld.edit'))));
    this.addRenderableWidget(new Button(cx + 4, by - 24, BUTTON_WIDTH, BUTTON_DEFAULT_HEIGHT,
      this.t('gui.cancel'), () => this.goBack()));

    // Local save files: vanilla stores worlds on disk, a browser build only has IndexedDB, so
    // export/import is the equivalent of the .minecraft/saves folder.
    this.exportButton = new Button(cx - 154, by - 48, BUTTON_WIDTH, BUTTON_DEFAULT_HEIGHT,
      '导出存档', () => { void this.exportSelected(); });
    this.exportButton.active = false;
    this.addRenderableWidget(this.exportButton);
    this.addRenderableWidget(new Button(cx + 4, by - 48, BUTTON_WIDTH, BUTTON_DEFAULT_HEIGHT,
      '导入存档', () => this.importArchive()));
  }

  /** Async load of the IndexedDB world list (kicked off after init). */
  async refresh(): Promise<void> {
    try {
      this.worlds = await this.provider.list();
      this.loaded = true;
      if (this.list) this.list.setItems(this.worlds);
    } catch {
      this.worlds = [];
      this.loaded = true;
    }
  }

  get isLoaded(): boolean { return this.loaded; }

  private play(): void {
    const w = this.list.getSelected();
    if (!w) return;
    this.provider.load?.(w.id);
    this.env.deps.callbacks.onLoadWorld?.(w.id);
    this.close();
  }

  private async remove(): Promise<void> {
    const w = this.list.getSelected();
    if (!w) return;
    await this.provider.delete(w.id);
    await this.refresh();
    this.playButton.active = false;
    this.deleteButton.active = false;
  }

  /** Downloads the selected world as a .mcworld archive (local backup / transfer). */
  private async exportSelected(): Promise<void> {
    const w = this.list.getSelected();
    if (!w || !this.provider.exportWorld) { this.toast('无法导出存档'); return; }
    try {
      const bytes = await this.provider.exportWorld(w.id);
      const blob = new Blob([bytes.slice().buffer as ArrayBuffer], { type: 'application/octet-stream' });
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = `${(w.name || 'world').replace(/[\\/:*?"<>|]/g, '_')}.mcworld`;
      document.body.appendChild(a);
      a.click();
      a.remove();
      setTimeout(() => URL.revokeObjectURL(url), 1000);
      this.toast('已导出存档');
    } catch (err) {
      console.warn('[save] export failed', err);
      this.toast('导出失败');
    }
  }

  /** Reads a .mcworld archive from disk and adds it to the world list. */
  private importArchive(): void {
    if (!this.provider.importWorld) { this.toast('无法导入存档'); return; }
    const input = document.createElement('input');
    input.type = 'file';
    input.accept = '.mcworld,.zip,.dat,application/octet-stream';
    input.style.display = 'none';
    input.onchange = async () => {
      const file = input.files?.[0];
      input.remove();
      if (!file) return;
      try {
        await this.provider.importWorld!(await file.arrayBuffer());
        await this.refresh();
        this.toast('已导入存档');
      } catch (err) {
        console.warn('[save] import failed', err);
        this.toast('导入失败：文件格式不正确');
      }
    };
    document.body.appendChild(input);
    input.click();
  }

  private goBack(): void { this.env.back(); }

  protected renderForeground(g: GuiGraphics, _mx: number, _my: number, _pt: number): void {
    g.drawCenteredString(this.title, Math.floor(this.width / 2), 8, 0xffffffff, true);
    if (!this.loaded) g.drawCenteredString('Loading worlds...', Math.floor(this.width / 2), Math.floor(this.height / 2), 0xffffffff, true);
  }

  keyPressed(code: string, char: string, mods: number): boolean {
    if (code === 'Escape') { this.goBack(); return true; }
    return super.keyPressed(code, char, mods);
  }
}
