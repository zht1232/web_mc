// Port of net.minecraft.client.gui.screens.TitleScreen (26.2).
// Sources: TitleScreen.java (init / createNormalMenuOptions /
// getHorizontalPosition / extractRenderState / shouldCloseOnEsc),
// Screen.java (FADE_IN_TIME 2000), LogoRenderer.java, SplashRenderer.java,
// net.minecraft.client.renderer.Panorama.
//
// All button rectangles come from layout/TitleLayout.computeTitleScreenLayout,
// which transcribes the Java literals (height/4+48, spacing 24, width/2-100,
// 200x20, 98x20, 20x20 icon buttons, copyright at height-10).

import type { GuiGraphics } from '../GuiGraphics.js';
import { Screen } from './Screen.js';
import { Button } from '../components/Button.js';
import { Tooltip } from '../components/Tooltip.js';
import { PanoramaRenderer } from '../components/PanoramaRenderer.js';
import { LogoRenderer } from '../components/LogoRenderer.js';
import { SplashRenderer } from '../components/SplashRenderer.js';
import { computeTitleScreenLayout, type TitleLayout } from '../layout/TitleLayout.js';
import { TITLE_ICON_BUTTON_SIZE } from '../GuiConstants.js';
import { isInside } from '../components/geometry.js';

export class TitleScreen extends Screen {
  private readonly panorama = new PanoramaRenderer();
  private readonly logo = new LogoRenderer();
  private readonly splash = new SplashRenderer();
  private layout: TitleLayout = computeTitleScreenLayout(0, 0);
  private lastTick = 0;
  private copyrightWidth = 0;
  private assetsReady = false;

  constructor(env: ConstructorParameters<typeof Screen>[0]) {
    super(env, 'narrator.screen.title');
    this.setPauseScreen(false);
    this.setCloseOnEsc(false);
    this.panorama.startSpin();
    void Promise.all([
      this.panorama.load(env.textures),
      this.logo.load(env.textures),
      this.splash.load('/mc'),
    ]).then(() => { this.assetsReady = true; }).catch(() => undefined);
  }

  protected build(): void {
    this.copyrightWidth = this.env.font.width(this.t('title.credits'));
    this.layout = computeTitleScreenLayout(this.width, this.height, this.copyrightWidth);
    const L = this.layout;

    this.addRenderableWidget(Button.big(L.singleplayer.x, L.singleplayer.y, this.t('menu.singleplayer'),
      () => this.open('selectWorld')));

    const multiplayer = Button.big(L.multiplayer.x, L.multiplayer.y, this.t('menu.multiplayer'),
      () => this.toast(this.t('menu.multiplayer')));
    multiplayer.setTooltip(Tooltip.create(this.t('menu.multiplayer')));
    this.addRenderableWidget(multiplayer);

    // 26.2's third large button is "menu.online" (Minecraft Realms). There is no
    // dedicated Mods button in vanilla; the label is overridable via deps.i18n.
    this.addRenderableWidget(Button.big(L.online.x, L.online.y, this.t('menu.online'),
      () => this.toast(this.t('menu.online'))));

    // Three 20x20 icon buttons: friends / language / accessibility (CommonButtons in 26.2).
    // They used to be plain "F" / "L" / "A" letter buttons, which read as debug placeholders.
    const iconSpecs = [
      { sprite: 'icon/invite', tooltip: this.t('options.online') },
      { sprite: 'icon/language', tooltip: this.t('options.language') },
      { sprite: 'icon/accessibility', tooltip: this.t('options.accessibility') },
    ];
    const iconActions = [
      () => this.toast(this.t('options.online')),
      () => this.open('language'),
      () => this.toast(this.t('options.accessibility')),
    ];
    for (let i = 0; i < L.iconButtons.length; i++) {
      const r = L.iconButtons[i];
      const spec = iconSpecs[i];
      const b = new Button(r.x, r.y, TITLE_ICON_BUTTON_SIZE, TITLE_ICON_BUTTON_SIZE, '', iconActions[i] ?? (() => undefined));
      if (spec) {
        b.setIcon(spec.sprite);
        b.setTooltip(Tooltip.create(spec.tooltip));
      }
      this.addRenderableWidget(b);
    }

    this.addRenderableWidget(new Button(L.options.x, L.options.y, L.options.width, L.options.height,
      this.t('menu.options'), () => this.open('options')));
    this.addRenderableWidget(new Button(L.quit.x, L.quit.y, L.quit.width, L.quit.height,
      this.t('menu.quit'), () => this.env.deps.callbacks.onQuit?.()));
  }

  protected renderBackground(g: GuiGraphics, _mx: number, _my: number, _pt: number): void {
    // TitleScreen#extractBackground is empty: only the panorama + a dark shade.
    this.panorama.render(g, this.width, this.height, 1);
  }

  protected renderForeground(g: GuiGraphics, _mx: number, _my: number, _pt: number): void {
    const L = this.layout;
    const fade = this.panorama.fadeAlpha();
    const widgetFade = fade < 1 ? Math.max(0, (fade - 0.5) * 2) : 1;

    if (this.assetsReady) {
      this.logo.render(g, this.width, this.logo.keepLogoThroughFade() ? 1 : widgetFade, L.logo.y);
    }
    this.splash.render(g, L.splashX, L.splashY, widgetFade);

    // versionString: "Minecraft 26.2" at (2, height - 10)
    let version = 'Minecraft 26.2';
    if (this.env.deps.options.modedFlag === true) version += ' Modded';
    g.drawString(version, L.versionX, L.versionY, 0xffffffff, true);

    // Copyright (PlainTextButton in vanilla): bottom-right, clickable. Right-align it against
    // the live text width instead of the width cached in build(), otherwise a longer locale
    // string runs off the screen and collides with the version string on the left.
    const copyright = this.t('title.credits');
    const copyrightWidth = this.env.font.width(copyright);
    const copyrightX = this.width - 2 - copyrightWidth;
    const copyrightY = this.height - 10;
    if (this.layout.copyright.x !== copyrightX || this.layout.copyright.width !== copyrightWidth) {
      this.layout.copyright = { x: copyrightX, y: copyrightY, width: copyrightWidth, height: 10 };
    }
    g.drawString(copyright, copyrightX, copyrightY, 0xffffffff, true);
  }

  protected onMouseClicked(mx: number, my: number, button: number): boolean {
    if (button === 0 && isInside(mx, my, this.layout.copyright)) {
      this.toast('Credits & Attribution');
      return true;
    }
    return false;
  }

  tick(): void {
    super.tick();
    const now = typeof performance !== 'undefined' ? performance.now() : Date.now();
    const dt = this.lastTick ? Math.min(100, now - this.lastTick) : 16;
    this.lastTick = now;
    this.panorama.tick(dt);
    this.splash.tick(dt);
    const fade = this.panorama.fadeAlpha();
    this.fadeWidgets(fade < 1 ? Math.max(0, (fade - 0.5) * 2) : 1);
  }

  /** Exposed for the Node test suite: the exact vanilla button rectangles. */
  getLayout(): TitleLayout { return this.layout; }

  /** All widget rectangles in addRenderableWidget() order (Node test suite). */
  getButtonRects(): { x: number; y: number; width: number; height: number }[] {
    return this.children.map((c) => c.getRect());
  }
}
