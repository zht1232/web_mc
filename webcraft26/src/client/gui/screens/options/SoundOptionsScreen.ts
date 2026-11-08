// Port of net.minecraft.client.gui.screens.options.SoundOptionsScreen (26.2).
// Sources: SoundOptionsScreen.java (OptionsList of SoundSource volume sliders,
// "Show Subtitles" toggle, "Done" button), SoundOptions / Options.java.

import { OptionsSubScreen, OPTIONS_BUTTON_WIDTH } from './OptionsSubScreen.js';
import { getOptionNumber, getOptionBoolean, setOption } from '../../OptionsBridge.js';

const SOUND_CATEGORIES = [
  'soundCategory.master',
  'soundCategory.music',
  'soundCategory.record',
  'soundCategory.weather',
  'soundCategory.block',
  'soundCategory.hostile',
  'soundCategory.neutral',
  'soundCategory.player',
  'soundCategory.ambient',
  'soundCategory.voice',
] as const;

export class SoundOptionsScreen extends OptionsSubScreen {
  constructor(env: ConstructorParameters<typeof OptionsSubScreen>[0]) {
    super(env, 'options.sounds.title');
  }

  protected addOptions(): void {
    const deps = this.env.deps;
    const col0 = this.gridColX(0);
    const col1 = this.gridColX(1);
    const w = OPTIONS_BUTTON_WIDTH;

    for (let i = 0; i < SOUND_CATEGORIES.length; i++) {
      const key = SOUND_CATEGORIES[i];
      const col = i % 2;
      const row = Math.floor(i / 2);
      const optionKey = `sound.${key}`;
      const value = getOptionNumber(deps, optionKey, 1);
      this.addSlider(col === 0 ? col0 : col1, this.gridRowY(row), w, this.t(key), value,
        (v) => (v <= 0 ? 'OFF' : `${Math.round(v * 100)}%`),
        (v) => setOption(deps, optionKey, v));
    }

    this.addToggle(col0, this.gridRowY(5), 'Show Subtitles',
      getOptionBoolean(deps, 'showSubtitles', false),
      (v) => setOption(deps, 'showSubtitles', v));
  }
}
