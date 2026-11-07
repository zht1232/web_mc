// Port of com.mojang.blaze3d.platform.Window#calculateScale(int, boolean)
// and net.minecraft.client.Options lambda (Options.java:911, getMaxGuiScale).
//
// Vanilla Java (26.2), Window.java:445-463:
//   public int calculateScale(final int maxScale, final boolean enforceUnicode) {
//      int scale = 1;
//      while (scale != maxScale
//         && scale < this.framebufferWidth
//         && scale < this.framebufferHeight
//         && this.framebufferWidth / (scale + 1) >= 320
//         && this.framebufferHeight / (scale + 1) >= 240) {
//         scale++;
//      }
//      if (enforceUnicode && scale % 2 != 0) { scale++; }
//      return scale;
//   }
//
// Minecraft.java:1431 calls it as calculateScale(options.guiScale().get(), isEnforceUnicode()).
// Options.java:911 defines the slider maximum as calculateScale(0, isEnforceUnicode()).
// Pure function: no DOM, safe to import from Node/tsx.

/** Java integer division for non-negative operands. */
function idiv(a: number, b: number): number {
  return Math.floor(a / b);
}

/**
 * @param framebufferWidth  physical framebuffer width (window width * devicePixelRatio)
 * @param framebufferHeight physical framebuffer height
 * @param maxScale          0 = automatic; >0 = forced GUI scale (clamped to what fits)
 * @param enforceUnicode    forceUnicodeFont: odd scales are bumped to the next even value
 */
export function calcGuiScale(
  framebufferWidth: number,
  framebufferHeight: number,
  maxScale = 0,
  enforceUnicode = false,
): number {
  let scale = 1;
  while (
    scale !== maxScale &&
    scale < framebufferWidth &&
    scale < framebufferHeight &&
    idiv(framebufferWidth, scale + 1) >= 320 &&
    idiv(framebufferHeight, scale + 1) >= 240
  ) {
    scale++;
  }
  if (enforceUnicode && scale % 2 !== 0) scale++;
  return Math.max(1, scale);
}

/** Mirrors Options#getMaxGuiScale(): the largest legal automatic GUI scale. */
export function getMaxGuiScale(
  framebufferWidth: number,
  framebufferHeight: number,
  enforceUnicode = false,
): number {
  return calcGuiScale(framebufferWidth, framebufferHeight, 0, enforceUnicode);
}

/**
 * Mirrors Window#setGuiScale: GUI logical dimensions are ceil(framebuffer / scale).
 * Window.java:465-472:
 *   int width = (int)(framebufferWidth / doubleScale);
 *   guiScaledWidth = framebufferWidth / doubleScale > width ? width + 1 : width;
 */
export function guiScaledSize(
  framebufferWidth: number,
  framebufferHeight: number,
  scale: number,
): { width: number; height: number } {
  const w = framebufferWidth / scale;
  const h = framebufferHeight / scale;
  return {
    width: Math.floor(w) === w ? w : Math.floor(w) + 1,
    height: Math.floor(h) === h ? h : Math.floor(h) + 1,
  };
}

/**
 * Convenience for the common dpr=1 case used by the browser clone:
 * returns the GUI scale for a CSS-size window. Game.ts multiplies by dpr before
 * calling calcGuiScale; this helper does the same thing in one step.
 */
export function autoGuiScale(cssWidth: number, cssHeight: number, dpr = 1, forced = 0): number {
  return calcGuiScale(Math.floor(cssWidth * dpr), Math.floor(cssHeight * dpr), forced, false);
}
