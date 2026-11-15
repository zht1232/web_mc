// Port of the 26.2 GUI sprite system.
// Sources: net.minecraft.client.gui.GuiGraphicsExtractor#blitSprite,
//          net.minecraft.client.gui.render.texture.GuiSpriteScaling (nine_slice / stretch),
//          net.minecraft.client.resources.metadata.gui.GuiSpriteScaling,
//          assets/minecraft/atlases/gui.json (NOT present in this checkout).
//
// Verified layout of this resource pack (see public/mc/textures/gui/sprites/**):
//   * each sprite PNG sits next to an optional <name>.png.mcmeta, e.g.
//       widget/button.png.mcmeta:
//         {"gui":{"scaling":{"type":"nine_slice","width":200,"height":20,"border":3}}}
//   * "border" can be a number OR {left,top,right,bottom}
//       (widget/tab.png.mcmeta uses the object form).
//   * sprites without an .mcmeta are fixed-size (drawn at natural size).
//   * there is NO assets/minecraft/atlases/gui.json in this pack, so sprites are
//     decoded individually and cached; a prebuilt atlas is not available.
//
// Batching: a single SpriteBatch collects blits and flushes them grouped by
// texture path so a frame never re-decodes / re-selects the same sprite per widget.
// Canvas2D has no texture bind cost; drawImage from a cached HTMLImageElement is
// the equivalent of a bound atlas tile.

export type Border = { left: number; top: number; right: number; bottom: number };

export interface NineSliceScaling {
  type: 'nine_slice';
  width: number;
  height: number;
  border: Border;
}

export interface StretchScaling {
  type: 'stretch';
  width: number;
  height: number;
}

export interface FixedScaling {
  type: 'fixed';
  width: number;
  height: number;
}

export type SpriteScaling = NineSliceScaling | StretchScaling | FixedScaling;

export interface Sprite {
  name: string;
  image: HTMLImageElement;
  scaling: SpriteScaling;
}

export interface McMeta {
  gui?: {
    scaling?: {
      type?: string;
      width?: number;
      height?: number;
      border?: number | Partial<Border>;
    };
  };
}

/** Pure parser for the .mcmeta "gui.scaling" block. Exported for Node tests. */
export function parseScaling(meta: McMeta | undefined, imgWidth: number, imgHeight: number): SpriteScaling {
  const s = meta?.gui?.scaling;
  if (!s) return { type: 'fixed', width: imgWidth, height: imgHeight };
  const width = s.width ?? imgWidth;
  const height = s.height ?? imgHeight;
  if (s.type === 'stretch') return { type: 'stretch', width, height };
  if (s.type === 'nine_slice') {
    const b = s.border ?? 0;
    let border: Border;
    if (typeof b === 'number') border = { left: b, top: b, right: b, bottom: b };
    else border = { left: b.left ?? 0, top: b.top ?? 0, right: b.right ?? 0, bottom: b.bottom ?? 0 };
    return { type: 'nine_slice', width, height, border };
  }
  return { type: 'fixed', width, height };
}

export interface SlicePatch {
  sx: number; sy: number; sw: number; sh: number; // source rect in texture pixels
  dx: number; dy: number; dw: number; dh: number; // destination rect in GUI pixels
}

/**
 * Pure nine-slice geometry. Vanilla scales border widths by the ratio between
 * the real PNG size and the logical width/height declared in the .mcmeta.
 * Returns the 9 patches in row-major order.
 */
export function computeNineSlicePatches(
  imgWidth: number,
  imgHeight: number,
  dstWidth: number,
  dstHeight: number,
  scaling: NineSliceScaling,
): SlicePatch[] {
  const kx = imgWidth / (scaling.width || imgWidth);
  const ky = imgHeight / (scaling.height || imgHeight);
  const l = Math.max(0, Math.round(scaling.border.left * kx));
  const t = Math.max(0, Math.round(scaling.border.top * ky));
  const r = Math.max(0, Math.round(scaling.border.right * kx));
  const b = Math.max(0, Math.round(scaling.border.bottom * ky));
  const midSrcW = Math.max(1, imgWidth - l - r);
  const midSrcH = Math.max(1, imgHeight - t - b);
  const midDstW = Math.max(0, dstWidth - l - r);
  const midDstH = Math.max(0, dstHeight - t - b);

  const xsSrc = [0, l, imgWidth - r];
  const xsDst = [0, l, dstWidth - r];
  const wsSrc = [l, midSrcW, r];
  const wsDst = [l, midDstW, r];
  const ysSrc = [0, t, imgHeight - b];
  const ysDst = [0, t, dstHeight - b];
  const hsSrc = [t, midSrcH, b];
  const hsDst = [t, midDstH, b];

  const out: SlicePatch[] = [];
  for (let row = 0; row < 3; row++) {
    for (let col = 0; col < 3; col++) {
      if (wsSrc[col] <= 0 || hsSrc[row] <= 0 || wsDst[col] <= 0 || hsDst[row] <= 0) continue;
      out.push({
        sx: xsSrc[col], sy: ysSrc[row], sw: wsSrc[col], sh: hsSrc[row],
        dx: xsDst[col], dy: ysDst[row], dw: wsDst[col], dh: hsDst[row],
      });
    }
  }
  return out;
}

export class GuiSpriteAtlas {
  private readonly cache = new Map<string, Sprite>();
  private readonly pending = new Map<string, Promise<Sprite | undefined>>();

  constructor(private readonly base = '/mc') {}

  get(name: string): Sprite | undefined {
    return this.cache.get(name);
  }

  image(name: string): HTMLImageElement | undefined {
    return this.cache.get(name)?.image;
  }

  /** Full URL of a sprite's PNG. */
  url(name: string): string {
    return `${this.base}/textures/gui/sprites/${name}.png`;
  }

  async load(name: string): Promise<Sprite | undefined> {
    const hit = this.cache.get(name);
    if (hit) return hit;
    const pending = this.pending.get(name);
    if (pending) return pending;
    const p = (async (): Promise<Sprite | undefined> => {
      const url = this.url(name);
      let img: HTMLImageElement;
      try {
        img = new Image();
        img.src = url;
        await img.decode();
      } catch {
        return undefined;
      }
      let meta: McMeta | undefined;
      try {
        const res = await fetch(`${url}.mcmeta`);
        if (res.ok) meta = (await res.json()) as McMeta;
      } catch {
        // no metadata -> fixed size sprite
      }
      const sprite: Sprite = {
        name,
        image: img,
        scaling: parseScaling(meta, img.width, img.height),
      };
      this.cache.set(name, sprite);
      return sprite;
    })();
    this.pending.set(name, p);
    try {
      return await p;
    } finally {
      this.pending.delete(name);
    }
  }

  async preload(names: readonly string[]): Promise<void> {
    await Promise.all(names.map((n) => this.load(n).then(() => undefined).catch(() => undefined)));
  }

  /**
   * Draws one sprite honouring its nine-slice / stretch / fixed scaling.
   * This is the single place sprite geometry is applied, so widgets never draw
   * their own gradients (1:1 with the original atlas sprites).
   */
  blit(ctx: CanvasRenderingContext2D, name: string, x: number, y: number, w: number, h: number, alpha = 1): void {
    const sprite = this.cache.get(name);
    if (!sprite) return;
    const prevAlpha = ctx.globalAlpha;
    if (alpha !== 1) ctx.globalAlpha = prevAlpha * alpha;
    const img = sprite.image;
    const s = sprite.scaling;
    if (s.type === 'nine_slice') {
      for (const p of computeNineSlicePatches(img.width, img.height, w, h, s)) {
        ctx.drawImage(img, p.sx, p.sy, p.sw, p.sh, x + p.dx, y + p.dy, p.dw, p.dh);
      }
    } else if (s.type === 'stretch') {
      ctx.drawImage(img, 0, 0, img.width, img.height, x, y, w, h);
    } else {
      ctx.drawImage(img, x, y, w, h);
    }
    ctx.globalAlpha = prevAlpha;
  }

  /** Batch: draw many rects of the SAME sprite with one lookup (texture grouping). */
  blitGrouped(
    ctx: CanvasRenderingContext2D,
    name: string,
    rects: readonly { x: number; y: number; w: number; h: number }[],
    alpha = 1,
  ): void {
    const sprite = this.cache.get(name);
    if (!sprite) return;
    const prevAlpha = ctx.globalAlpha;
    if (alpha !== 1) ctx.globalAlpha = prevAlpha * alpha;
    for (const r of rects) {
      const s = sprite.scaling;
      if (s.type === 'nine_slice') {
        for (const p of computeNineSlicePatches(sprite.image.width, sprite.image.height, r.w, r.h, s)) {
          ctx.drawImage(sprite.image, p.sx, p.sy, p.sw, p.sh, r.x + p.dx, r.y + p.dy, p.dw, p.dh);
        }
      } else {
        ctx.drawImage(sprite.image, r.x, r.y, r.w, r.h);
      }
    }
    ctx.globalAlpha = prevAlpha;
  }
}

/** Sprite names preloaded by ScreenManager for the whole GUI. */
export const CORE_SPRITES = [
  'widget/button', 'widget/button_disabled', 'widget/button_highlighted',
  'widget/checkbox', 'widget/checkbox_highlighted', 'widget/checkbox_selected',
  'widget/checkbox_selected_highlighted',
  'widget/slider', 'widget/slider_highlighted',
  'widget/slider_handle', 'widget/slider_handle_highlighted',
  'widget/text_field', 'widget/text_field_highlighted',
  'widget/scroller', 'widget/scroller_background',
  'widget/tab', 'widget/tab_highlighted', 'widget/tab_selected', 'widget/tab_selected_highlighted',
  'widget/slot_frame', 'widget/cross_button', 'widget/cross_button_highlighted',
  'tooltip/background', 'tooltip/frame',
  'toast/system', 'toast/advancement', 'toast/recipe', 'toast/tutorial',
  'container/slot_highlight_back', 'container/slot_highlight_front',
  // Every creative tab sprite (columns 1..7, selected/unselected, top/bottom). Only preloading
  // variant 1 left tabs 2..7 with no cached sprite, so they fell back to flat grey rectangles.
  'container/creative_inventory/tab_top_unselected_1',
  'container/creative_inventory/tab_top_unselected_2',
  'container/creative_inventory/tab_top_unselected_3',
  'container/creative_inventory/tab_top_unselected_4',
  'container/creative_inventory/tab_top_unselected_5',
  'container/creative_inventory/tab_top_unselected_6',
  'container/creative_inventory/tab_top_unselected_7',
  'container/creative_inventory/tab_top_selected_1',
  'container/creative_inventory/tab_top_selected_2',
  'container/creative_inventory/tab_top_selected_3',
  'container/creative_inventory/tab_top_selected_4',
  'container/creative_inventory/tab_top_selected_5',
  'container/creative_inventory/tab_top_selected_6',
  'container/creative_inventory/tab_top_selected_7',
  'container/creative_inventory/tab_bottom_unselected_1',
  'container/creative_inventory/tab_bottom_unselected_2',
  'container/creative_inventory/tab_bottom_unselected_3',
  'container/creative_inventory/tab_bottom_unselected_4',
  'container/creative_inventory/tab_bottom_unselected_5',
  'container/creative_inventory/tab_bottom_unselected_6',
  'container/creative_inventory/tab_bottom_unselected_7',
  'container/creative_inventory/tab_bottom_selected_1',
  'container/creative_inventory/tab_bottom_selected_2',
  'container/creative_inventory/tab_bottom_selected_3',
  'container/creative_inventory/tab_bottom_selected_4',
  'container/creative_inventory/tab_bottom_selected_5',
  'container/creative_inventory/tab_bottom_selected_6',
  'container/creative_inventory/tab_bottom_selected_7',
  'container/creative_inventory/scroller',
  'container/creative_inventory/scroller_disabled',
  'container/slot/helmet', 'container/slot/chestplate',
  'container/slot/leggings', 'container/slot/boots', 'container/slot/shield',
  'recipe_book/button', 'recipe_book/button_highlighted',
  'recipe_book/tab', 'recipe_book/tab_selected',
  'recipe_book/slot_craftable', 'recipe_book/slot_uncraftable',
  'recipe_book/slot_many_craftable', 'recipe_book/slot_many_uncraftable',
  'recipe_book/page_forward', 'recipe_book/page_backward',
  'recipe_book/page_forward_highlighted', 'recipe_book/page_backward_highlighted',
  'recipe_book/crafting_overlay', 'recipe_book/furnace_overlay',
  'recipe_book/filter_enabled', 'recipe_book/filter_disabled',
  'recipe_book/furnace_filter_enabled', 'recipe_book/furnace_filter_disabled',
  // Title-screen icon buttons (CommonButtons: language / accessibility / friends).
  'icon/language', 'icon/accessibility', 'icon/invite',
] as const;
