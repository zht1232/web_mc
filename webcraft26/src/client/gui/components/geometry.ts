// Pure geometry helpers ported from net.minecraft.client.gui.components.AbstractWidget
// (isMouseOver / getRectangle) and net.minecraft.client.gui.navigation.ScreenRectangle.
// No DOM: safe to import from Node/tsx.

import type { Rect } from '../Types.js';

/** AbstractWidget.isMouseOver: half-open rectangle [x, x+w) x [y, y+h). */
export function isInside(x: number, y: number, rect: Rect): boolean {
  return x >= rect.x && y >= rect.y && x < rect.x + rect.width && y < rect.y + rect.height;
}

/** Alias used by Button click hit-testing. */
export function isPointInRect(x: number, y: number, rect: Rect): boolean {
  return isInside(x, y, rect);
}

export function clamp(value: number, min: number, max: number): number {
  return value < min ? min : value > max ? max : value;
}

/** ScreenRectangle intersection (used for scissor stacking). */
export function intersectRect(a: Rect, b: Rect): Rect {
  const x = Math.max(a.x, b.x);
  const y = Math.max(a.y, b.y);
  const right = Math.min(a.x + a.width, b.x + b.width);
  const bottom = Math.min(a.y + a.height, b.y + b.height);
  return { x, y, width: Math.max(0, right - x), height: Math.max(0, bottom - y) };
}

export function rectEquals(a: Rect, b: Rect): boolean {
  return a.x === b.x && a.y === b.y && a.width === b.width && a.height === b.height;
}

export function containsRect(outer: Rect, inner: Rect): boolean {
  return inner.x >= outer.x && inner.y >= outer.y &&
    inner.x + inner.width <= outer.x + outer.width &&
    inner.y + inner.height <= outer.y + outer.height;
}
