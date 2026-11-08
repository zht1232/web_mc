// Port of net.minecraft.client.gui.screens.options.LanguageSelectScreen (26.2).
// Sources: LanguageSelectScreen.java (LanguageSelectionList with a 2-column
// grid of 80x20 language entries, "Done" / "Force Unicode Font" buttons),
// LanguageManager.java. The browser clone ships only en_us, but the tab list
// exposes the standard language codes so the main agent can swap lang files.

import { OptionsSubScreen, OPTIONS_BUTTON_WIDTH } from './OptionsSubScreen.js';
import { ScrollPanel } from '../../components/ScrollPanel.js';
import { setOption } from '../../OptionsBridge.js';

interface LangEntry {
  code: string;
  name: string;
  region: string;
  bilingual: boolean;
}

// Only the locales this build actually ships (public/mc/lang). Listing the full vanilla set
// let the player pick a language with no lang file, which then rendered raw keys.
const LANGUAGES: LangEntry[] = [
  { code: 'en_us', name: 'English', region: 'United States', bilingual: false },
  { code: 'zh_cn', name: '简体中文', region: 'China', bilingual: false },
];

export class LanguageSelectScreen extends OptionsSubScreen {
  private list!: ScrollPanel<LangEntry>;
  private selected = 'en_us';
  private forceUnicode = false;

  constructor(env: ConstructorParameters<typeof OptionsSubScreen>[0]) {
    // 'options.languageTitle' is not a vanilla key; the real translation is options.language.
    super(env, 'options.language');
  }

  protected addOptions(): void {
    this.selected = String((this.env.deps.options as { language?: string } | undefined)?.language ?? this.selected);
    const left = Math.floor(this.width / 2) - 155;
    const top = 32;
    const width = 310;
    const height = this.height - 88;
    this.list = new ScrollPanel<LangEntry>(left, top, width, height, this.t('options.language'), {
      itemHeight: 24,
      renderItem: (g, item, _index, x, y, w, h, hovered, selected) => {
        g.fill(x + 2, y + 1, x + w / 2 - 2, y + h - 1, selected ? 0x8000ff00 : hovered ? 0x60ffffff : 0x40000000);
        g.drawString(item.name, x + 8, y + 4, 0xffffffff, true);
        g.drawString(item.region, x + 12, y + 15, 0xffa0a0a0, false);
        g.fill(x + w / 2 + 2, y + 1, x + w - 2, y + h - 1, selected ? 0x8000ff00 : hovered ? 0x60ffffff : 0x40000000);
        g.drawString(item.code, x + w / 2 + 8, y + 4, 0xffffffff, true);
        g.drawString(item.bilingual ? 'Bilingual' : '', x + w / 2 + 12, y + 15, 0xffa0a0a0, false);
      },
      onSelect: (item) => {
        this.selected = item.code;
        setOption(this.env.deps, 'language', item.code);
      },
    });
    this.list.setItems(LANGUAGES);
    const i = LANGUAGES.findIndex((l) => l.code === this.selected);
    if (i >= 0) this.list.selectedIndex = i;
    this.addRenderableWidget(this.list);

    const unicodeLabel = (): string =>
      `${this.t('options.forceUnicodeFont')}: ${this.t(this.forceUnicode ? 'options.on' : 'options.off')}`;
    this.addButton(Math.floor(this.width / 2) - OPTIONS_BUTTON_WIDTH - 4, this.height - 52,
      OPTIONS_BUTTON_WIDTH, unicodeLabel(), () => {
        this.forceUnicode = !this.forceUnicode;
        setOption(this.env.deps, 'forceUnicodeFont', this.forceUnicode);
        // The widget caches its label, so rebuild this screen's children.
        this.resize(this.width, this.height);
      });
  }
}
