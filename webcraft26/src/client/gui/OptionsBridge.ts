// Bridge between GUI option widgets and the running game. The main agent wires
// window.__mc.renderer.shaderQuality (and the rest of Game.options) through
// ScreenDeps; this module never imports Game.ts.
// Sources: net.minecraft.client.Options, VideoSettingsScreen,
//          net.minecraft.client.gui.screens.options.OptionsSubScreen.

import type { GuiOptions, ScreenDeps } from './Types.js';

interface McGlobal {
  __mc?: {
    renderer?: { shaderQuality?: string; shadersEnabled?: boolean };
    options?: Partial<GuiOptions>;
  };
}

function globalMc(): McGlobal {
  return globalThis as unknown as McGlobal;
}

/** Writes an option through deps.options and notifies the main agent. */
export function setOption<K extends keyof GuiOptions>(deps: ScreenDeps, key: K, value: GuiOptions[K]): void {
  deps.options[key] = value;
  const live = globalMc().__mc?.options;
  if (live) (live as Record<string, unknown>)[key as string] = value;
  deps.callbacks.onOptionChange?.(key as string, value);
}

export function getOptionNumber(deps: ScreenDeps, key: string, fallback: number): number {
  const v = deps.options[key];
  return typeof v === 'number' ? v : fallback;
}

export function getOptionBoolean(deps: ScreenDeps, key: string, fallback: boolean): boolean {
  const v = deps.options[key];
  return typeof v === 'boolean' ? v : fallback;
}

/** Quality tiers exposed by the browser renderer (main agent owns the shader). */
export const SHADER_QUALITY_LEVELS = ['low', 'medium', 'high', 'ultra'] as const;

export function getShaderQuality(deps: ScreenDeps): string {
  const hook = deps.shaderQuality?.get();
  if (hook) return hook;
  return globalMc().__mc?.renderer?.shaderQuality ?? deps.options.shaderQuality ?? 'high';
}

export function setShaderQuality(deps: ScreenDeps, value: string): void {
  deps.shaderQuality?.set(value);
  deps.options.shaderQuality = value;
  const renderer = globalMc().__mc?.renderer;
  if (renderer) renderer.shaderQuality = value;
  deps.callbacks.onOptionChange?.('shaderQuality', value);
}

export function getShadersEnabled(deps: ScreenDeps): boolean {
  return globalMc().__mc?.renderer?.shadersEnabled ?? deps.options.shadersEnabled ?? false;
}

export function setShadersEnabled(deps: ScreenDeps, value: boolean): void {
  deps.options.shadersEnabled = value;
  const renderer = globalMc().__mc?.renderer;
  if (renderer) renderer.shadersEnabled = value;
  deps.callbacks.onOptionChange?.('shadersEnabled', value);
}
