// Port of net.minecraft.client.gui.screens.options.controls.KeyBindsScreen /
// ControlsScreen (26.2).
// Sources: KeyBindsScreen.java (KeyBindsList with categories, "Reset" button),
// KeyBindsList.java (entry height 20, key name at the right), Options.java
// (KeyMapping). Browser clone exposes the bindings read by Game.ts.

import type { GuiGraphics } from '../../GuiGraphics.js';
import { OptionsSubScreen, OPTIONS_BUTTON_WIDTH } from './OptionsSubScreen.js';
import { ScrollPanel } from '../../components/ScrollPanel.js';
import { setOption } from '../../OptionsBridge.js';

interface KeyBind {
  category: string;
  name: string;
  key: string;
}

const DEFAULT_BINDS: KeyBind[] = [
  { category: 'key.categories.movement', name: 'key.forward', key: 'W' },
  { category: 'key.categories.movement', name: 'key.left', key: 'A' },
  { category: 'key.categories.movement', name: 'key.back', key: 'S' },
  { category: 'key.categories.movement', name: 'key.right', key: 'D' },
  { category: 'key.categories.movement', name: 'key.jump', key: 'SPACE' },
  { category: 'key.categories.movement', name: 'key.sneak', key: 'SHIFT' },
  { category: 'key.categories.movement', name: 'key.sprint', key: 'CTRL' },
  { category: 'key.categories.gameplay', name: 'key.attack', key: 'MOUSE 1' },
  { category: 'key.categories.gameplay', name: 'key.use', key: 'MOUSE 3' },
  { category: 'key.categories.gameplay', name: 'key.pickItem', key: 'MOUSE 2' },
  { category: 'key.categories.inventory', name: 'key.inventory', key: 'E' },
  { category: 'key.categories.inventory', name: 'key.swapOffhand', key: 'F' },
  { category: 'key.categories.inventory', name: 'key.hotbar.1', key: '1' },
  { category: 'key.categories.inventory', name: 'key.hotbar.2', key: '2' },
  { category: 'key.categories.inventory', name: 'key.hotbar.3', key: '3' },
  { category: 'key.categories.inventory', name: 'key.hotbar.4', key: '4' },
  { category: 'key.categories.inventory', name: 'key.hotbar.5', key: '5' },
  { category: 'key.categories.inventory', name: 'key.hotbar.6', key: '6' },
  { category: 'key.categories.inventory', name: 'key.hotbar.7', key: '7' },
  { category: 'key.categories.inventory', name: 'key.hotbar.8', key: '8' },
  { category: 'key.categories.inventory', name: 'key.hotbar.9', key: '9' },
  { category: 'key.categories.ui', name: 'key.chat', key: 'T' },
  { category: 'key.categories.ui', name: 'key.fullscreen', key: 'F11' },
  { category: 'key.categories.ui', name: 'key.togglePerspective', key: 'F5' },
  { category: 'key.categories.misc', name: 'key.debug', key: 'F3' },
];

export class ControlsScreen extends OptionsSubScreen {
  private binds: KeyBind[] = DEFAULT_BINDS.map((b) => ({ ...b }));
  private list!: ScrollPanel<KeyBind>;

  constructor(env: ConstructorParameters<typeof OptionsSubScreen>[0]) {
    super(env, 'options.controlsTitle');
  }

  protected addOptions(): void {
    const left = Math.floor(this.width / 2) - 155;
    const top = 32;
    const width = 310;
    const height = this.height - 88;
    this.list = new ScrollPanel<KeyBind>(left, top, width, height, this.t('options.controlsTitle'), {
      itemHeight: 20,
      renderItem: (g, item, index, x, y, w, h, hovered, selected) => {
        if (index === 0 || this.binds[index - 1].category !== item.category) {
          g.drawString(this.t(item.category), x + 4, y - 10, 0xffa0a0a0, true);
        }
        g.fill(x, y, x + w, y + h, hovered ? 0x40ffffff : selected ? 0x40ffffff : 0x00000000);
        g.drawString(this.t(item.name), x + 6, y + 6, 0xffffffff, true);
        const kx = x + w - g.textWidth(item.key) - 8;
        g.fill(kx - 4, y + 1, x + w - 2, y + h - 1, hovered ? 0x80ffffff : 0x40000000);
        g.drawString(item.key, kx, y + 6, hovered ? 0xffffffa0 : 0xffffffff, true);
      },
      onSelect: (item) => this.toast(`${item.name}: ${item.key}`),
    });
    this.list.setItems(this.binds);
    this.addRenderableWidget(this.list);

    this.addButton(Math.floor(this.width / 2) - OPTIONS_BUTTON_WIDTH / 2, this.height - 52,
      OPTIONS_BUTTON_WIDTH, 'Reset Keys', () => {
        this.binds = DEFAULT_BINDS.map((b) => ({ ...b }));
        this.list.setItems(this.binds);
        setOption(this.env.deps, 'keyBindsReset', true);
      });
  }
}
