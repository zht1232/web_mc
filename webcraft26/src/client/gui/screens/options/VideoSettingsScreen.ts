// Port of net.minecraft.client.gui.screens.options.VideoSettingsScreen (26.2).
// Sources: VideoSettingsScreen.java (OptionsList with renderDistance, FOV,
// gamma, guiScale, graphicsMode, smoothLighting, vsync, viewBobbing,
// framerateLimit), Options.java (Option instances / value ranges).
// Browser additions: a "画质档位" (shader quality) cycle and a shaders on/off
// toggle, both bridged to window.__mc.renderer.shaderQuality by the main agent.

import { OptionsSubScreen, OPTIONS_BUTTON_WIDTH } from './OptionsSubScreen.js';
import {
  getOptionNumber, getOptionBoolean, setOption,
  getShaderQuality, setShaderQuality,
  getShadersEnabled, setShadersEnabled,
  SHADER_QUALITY_LEVELS,
} from '../../OptionsBridge.js';

const GUI_SCALES = [0, 1, 2, 3, 4] as const;
const GRAPHICS = ['Fast', 'Fancy'] as const;
const ON_OFF = ['OFF', 'ON'] as const;
const FPS_LIMITS = [30, 60, 120, 144, 240] as const;

export class VideoSettingsScreen extends OptionsSubScreen {
  constructor(env: ConstructorParameters<typeof OptionsSubScreen>[0]) {
    super(env, 'options.video');
  }

  protected addOptions(): void {
    const deps = this.env.deps;
    const col0 = this.gridColX(0);
    const col1 = this.gridColX(1);
    const w = OPTIONS_BUTTON_WIDTH;

    // Render Distance (2..32) and FOV (30..110).
    const rd = getOptionNumber(deps, 'renderDistance', 8);
    this.addSlider(col0, this.gridRowY(0), w, this.t('options.renderDistance'), (rd - 2) / 30,
      (v) => this.t('options.chunks').replace('%s', String(Math.round(2 + v * 30))),
      (v) => setOption(deps, 'renderDistance', Math.round(2 + v * 30)));

    const fov = getOptionNumber(deps, 'fov', 70);
    this.addSlider(col1, this.gridRowY(0), w, this.t('options.fov'), (fov - 30) / 80,
      (v) => `${Math.round(30 + v * 80)}`,
      (v) => setOption(deps, 'fov', Math.round(30 + v * 80)));

    // Brightness and GUI scale.
    const gamma = getOptionNumber(deps, 'brightness', 0);
    this.addSlider(col0, this.gridRowY(1), w, this.t('options.gamma'), gamma,
      (v) => `${Math.round(v * 100)}%`,
      (v) => setOption(deps, 'brightness', v));

    const gs = getOptionNumber(deps, 'guiScale', 0);
    this.addCycle(col1, this.gridRowY(1), w, this.t('options.guiScale'), GUI_SCALES,
      (GUI_SCALES as readonly number[]).includes(gs) ? gs : 0,
      (v) => (v === 0 ? this.t('options.guiScale.auto') : `${v}x`),
      (v) => setOption(deps, 'guiScale', v));

    // Graphics quality and smooth lighting.
    const fancy = getOptionBoolean(deps, 'fancyGraphics', true);
    this.addCycle(col0, this.gridRowY(2), w, this.t('options.graphics'), GRAPHICS, fancy ? 'Fancy' : 'Fast',
      (v) => this.t(`options.graphics.${v.toLowerCase()}`), (v) => setOption(deps, 'fancyGraphics', v === 'Fancy'));
    this.addToggle(col1, this.gridRowY(2), this.t('options.ao'), getOptionBoolean(deps, 'smoothLighting', true),
      (v) => setOption(deps, 'smoothLighting', v));

    // 画质档位 + 光影开关 (browser-specific, wired to window.__mc.renderer).
    const quality = getShaderQuality(deps);
    this.addCycle(col0, this.gridRowY(3), w, this.t('options.shaderQuality'), SHADER_QUALITY_LEVELS,
      (SHADER_QUALITY_LEVELS as readonly string[]).includes(quality) ? quality : 'high',
      (v) => this.t(`options.shaderQuality.${v}`), (v) => setShaderQuality(deps, v));
    this.addToggle(col1, this.gridRowY(3), this.t('options.shaders'), getShadersEnabled(deps),
      (v) => setShadersEnabled(deps, v));

    // VSync, view bobbing, framerate limit.
    this.addToggle(col0, this.gridRowY(4), this.t('options.vsync'), getOptionBoolean(deps, 'vsync', true),
      (v) => setOption(deps, 'vsync', v));
    this.addToggle(col1, this.gridRowY(4), this.t('options.viewBobbing'), getOptionBoolean(deps, 'viewBobbing', true),
      (v) => setOption(deps, 'viewBobbing', v));

    this.addCycle(col0, this.gridRowY(5), w, this.t('options.framerateLimit'), FPS_LIMITS,
      (FPS_LIMITS as readonly number[]).includes(getOptionNumber(deps, 'maxFps', 120)) ? getOptionNumber(deps, 'maxFps', 120) : 120,
      (v) => `${v}`, (v) => setOption(deps, 'maxFps', v));

    // Browser-specific image-quality switches: TAA jitter and waving foliage are the
    // two sources of distant "shimmer"; both default off.
    this.addToggle(col1, this.gridRowY(5), this.t('options.taa'),
      getOptionBoolean(deps, 'taa', false), (v) => setOption(deps, 'taa', v));
    this.addToggle(col0, this.gridRowY(6), this.t('options.dynamicResolution'),
      getOptionBoolean(deps, 'dynamicResolution', true), (v) => setOption(deps, 'dynamicResolution', v));
    this.addToggle(col1, this.gridRowY(6), this.t('options.vegetationSway'),
      getOptionBoolean(deps, 'vegetationSway', false), (v) => setOption(deps, 'vegetationSway', v));
  }
}
