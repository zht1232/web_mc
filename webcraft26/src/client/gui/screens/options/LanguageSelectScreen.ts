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

const LANGUAGES: LangEntry[] = [
  { code: 'en_us', name: 'English', region: 'United States', bilingual: false },
  { code: 'en_gb', name: 'English', region: 'United Kingdom', bilingual: false },
  { code: 'zh_cn', name: '简体中文', region: 'China', bilingual: false },
  { code: 'zh_tw', name: '繁體中文', region: 'Taiwan', bilingual: false },
  { code: 'ja_jp', name: '日本語', region: 'Japan', bilingual: false },
  { code: 'ko_kr', name: '한국어', region: 'Korea', bilingual: false },
  { code: 'de_de', name: 'Deutsch', region: 'Germany', bilingual: false },
  { code: 'fr_fr', name: 'Français', region: 'France', bilingual: false },
  { code: 'es_es', name: 'Español', region: 'Spain', bilingual: false },
  { code: 'pt_br', name: 'Português', region: 'Brazil', bilingual: false },
  { code: 'ru_ru', name: 'Русский', region: 'Russia', bilingual: false },
  { code: 'it_it', name: 'Italiano', region: 'Italy', bilingual: false },
];

export class LanguageSelectScreen extends OptionsSubScreen {
  private list!: ScrollPanel<LangEntry>;
  private selected = 'en_us';
  private forceUnicode = false;

  constructor(env: ConstructorParameters<typeof OptionsSubScreen>[0]) {
    super(env, 'options.languageTitle');
  }

  protected addOptions(): void {
    const left = Math.floor(this.width / 2) - 155;
    const top = 32;
    const width = 310;
    const height = this.height - 88;
    this.list = new ScrollPanel<LangEntry>(left, top, width, height, this.t('options.languageTitle'), {
      itemHeight: 22,
      renderItem: (g, item, _index, x, y, w, h, hovered, selected) => {
        g.fill(x + 2, y + 1, x + w / 2 - 2, y + h - 1, selected ? 0x8000ff00 : hovered ? 0x60ffffff : 0x40000000);
        g.drawString(item.name, x + 8, y + 7, 0xffffffff, true);
        g.drawString(item.region, x + 12, y + 15, 0xffa0a0a0, false);
        g.fill(x + w / 2 + 2, y + 1, x + w - 2, y + h - 1, selected ? 0x8000ff00 : hovered ? 0x60ffffff : 0x40000000);
        g.drawString(item.code, x + w / 2 + 8, y + 7, 0xffffffff, true);
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

    this.addButton(Math.floor(this.width / 2) - OPTIONS_BUTTON_WIDTH - 4, this.height - 52,
      OPTIONS_BUTTON_WIDTH, 'Force Unicode Font: OFF', () => {
        this.forceUnicode = !this.forceUnicode;
        setOption(this.env.deps, 'forceUnicodeFont', this.forceUnicode);
      });
  }
}
