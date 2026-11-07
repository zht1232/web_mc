// Pure text-wrapping port of net.minecraft.client.gui.font.StringSplitter /
// net.minecraft.client.gui.components.ComponentRenderUtils#wrapText and
// net.minecraft.client.gui.components.MultiLineLabel.
//
// Vanilla behaviour: split on explicit '\n', break at spaces, hard-break any
// single word that is wider than maxWidth, and keep '§x' style codes attached
// to the following text (they contribute 0 width).
// No DOM: the width function is injected, so this module runs unchanged in Node.

export type MeasureFn = (text: string) => number;

/** Removes '§' + one character formatting codes. */
export function stripFormatting(text: string): string {
  return text.replace(/\u00a7./g, '');
}

/** Width of a string ignoring formatting codes. */
export function measuredWidth(text: string, measure: MeasureFn): number {
  return measure(stripFormatting(text));
}

/** Splits a string on '\n', keeping the line order (vanilla Font.split). */
export function splitLines(text: string): string[] {
  return text.split('\n');
}

/** Hard-breaks a single over-long word into chunks that fit maxWidth. */
function hardBreak(word: string, maxWidth: number, measure: MeasureFn): string[] {
  const out: string[] = [];
  let current = '';
  for (const ch of word) {
    const candidate = current + ch;
    if (current && measuredWidth(candidate, measure) > maxWidth) {
      out.push(current);
      current = ch;
    } else {
      current = candidate;
    }
  }
  if (current) out.push(current);
  return out;
}

/**
 * Wraps one line to maxWidth. Words are separated by single spaces; the space
 * itself is dropped at a break (matches vanilla ComponentRenderUtils).
 */
export function wrapLine(line: string, maxWidth: number, measure: MeasureFn): string[] {
  if (line.length === 0) return [''];
  const words = line.split(' ');
  const out: string[] = [];
  let current = '';

  for (const word of words) {
    // A word that can never fit on its own must be hard-broken first.
    if (measuredWidth(word, measure) > maxWidth) {
      if (current) { out.push(current); current = ''; }
      const pieces = hardBreak(word, maxWidth, measure);
      for (let i = 0; i < pieces.length - 1; i++) out.push(pieces[i]);
      current = pieces[pieces.length - 1] ?? '';
      continue;
    }
    const candidate = current ? `${current} ${word}` : word;
    if (current && measuredWidth(candidate, measure) > maxWidth) {
      out.push(current);
      current = word;
    } else {
      current = candidate;
    }
  }
  if (current || out.length === 0) out.push(current);
  return out;
}

/** Wraps a whole (possibly multi-line) string into a flat list of lines. */
export function wrapText(text: string, maxWidth: number, measure: MeasureFn): string[] {
  const out: string[] = [];
  for (const line of splitLines(text)) {
    for (const wrapped of wrapLine(line, maxWidth, measure)) out.push(wrapped);
  }
  return out;
}

/** Wraps an already-split tooltip (keeps explicit line breaks from the item). */
export function wrapTooltipLines(lines: readonly string[], maxWidth: number, measure: MeasureFn): string[] {
  const out: string[] = [];
  for (const line of lines) {
    for (const wrapped of wrapText(line, maxWidth, measure)) out.push(wrapped);
  }
  return out;
}

/** Truncates a string with an ellipsis so it fits maxWidth (vanilla StringSplitter.plainHeadByWidth). */
export function truncateToWidth(text: string, maxWidth: number, measure: MeasureFn, ellipsis = '...'): string {
  if (measuredWidth(text, measure) <= maxWidth) return text;
  let result = '';
  for (const ch of text) {
    if (measuredWidth(result + ch + ellipsis, measure) > maxWidth) break;
    result += ch;
  }
  return result + ellipsis;
}
