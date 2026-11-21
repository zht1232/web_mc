// Source: net.minecraft.client.gui.screens.achievement.StatsScreen (26.2)
//         + StatsScreen.GeneralStatisticsList / ItemStatisticsList / MobsStatisticsList
//         + net.minecraft.stats.StatFormatter / Stats.CUSTOM
//
// Three tabs (General / Items / Mobs) over a 280-pixel scrolling list, with the
// vanilla row heights (14 / 22 / 36), the six item-column sort headers, and the
// Done button. Statistics data is injected through ScreenDeps.stats.

import type { GuiGraphics } from '../GuiGraphics.js';
import { Screen } from './Screen.js';
import { Button } from '../components/Button.js';
import { ScrollPanel, type ScrollPanelConfig } from '../components/ScrollPanel.js';
import type { StatisticsView, StatKind } from '../../../vanilla/world/stats/Statistics.js';

const TAB_H = 24;
const FOOTER = 33;
const LIST_WIDTH = 280;
const ROW_GENERAL = 14;
const ROW_ITEMS = 22;
const ROW_MOBS = 36;
const COLORS = {
  white: 0xffffffff,
  grey: 0xffbababa,
  dark: 0xff808080,
  labelGrey: 0xffa0a0a0,
} as const;

type Format = 'default' | 'tenths' | 'distance' | 'time';

/** Stats.CUSTOM in registration order (Horizon stats_screen.rs). */
const CUSTOM: readonly (readonly [string, Format])[] = [
  ['leave_game', 'default'], ['play_time', 'time'], ['total_world_time', 'time'],
  ['time_since_death', 'time'], ['time_since_rest', 'time'], ['sneak_time', 'time'],
  ['walk_one_cm', 'distance'], ['crouch_one_cm', 'distance'], ['sprint_one_cm', 'distance'],
  ['walk_on_water_one_cm', 'distance'], ['fall_one_cm', 'distance'], ['climb_one_cm', 'distance'],
  ['fly_one_cm', 'distance'], ['walk_under_water_one_cm', 'distance'],
  ['minecart_one_cm', 'distance'], ['boat_one_cm', 'distance'], ['pig_one_cm', 'distance'],
  ['happy_ghast_one_cm', 'distance'], ['horse_one_cm', 'distance'], ['aviate_one_cm', 'distance'],
  ['swim_one_cm', 'distance'], ['strider_one_cm', 'distance'], ['nautilus_one_cm', 'distance'],
  ['jump', 'default'], ['drop', 'default'],
  ['damage_dealt', 'tenths'], ['damage_dealt_absorbed', 'tenths'],
  ['damage_dealt_resisted', 'tenths'], ['damage_taken', 'tenths'],
  ['damage_blocked_by_shield', 'tenths'], ['damage_absorbed', 'tenths'], ['damage_resisted', 'tenths'],
  ['deaths', 'default'], ['mob_kills', 'default'], ['animals_bred', 'default'],
  ['player_kills', 'default'], ['fish_caught', 'default'], ['talked_to_villager', 'default'],
  ['traded_with_villager', 'default'], ['eat_cake_slice', 'default'], ['fill_cauldron', 'default'],
  ['use_cauldron', 'default'], ['clean_armor', 'default'], ['clean_banner', 'default'],
  ['clean_shulker_box', 'default'], ['interact_with_brewingstand', 'default'],
  ['interact_with_beacon', 'default'], ['inspect_dropper', 'default'], ['inspect_hopper', 'default'],
  ['inspect_dispenser', 'default'], ['play_noteblock', 'default'], ['tune_noteblock', 'default'],
  ['pot_flower', 'default'], ['trigger_trapped_chest', 'default'], ['open_enderchest', 'default'],
  ['enchant_item', 'default'], ['play_record', 'default'], ['interact_with_furnace', 'default'],
  ['interact_with_crafting_table', 'default'], ['open_chest', 'default'],
  ['sleep_in_bed', 'default'], ['sleep_in_straw_bed', 'default'], ['open_shulker_box', 'default'],
  ['open_barrel', 'default'], ['interact_with_blast_furnace', 'default'],
  ['interact_with_smoker', 'default'], ['interact_with_lectern', 'default'],
  ['interact_with_campfire', 'default'], ['interact_with_cartography_table', 'default'],
  ['interact_with_loom', 'default'], ['interact_with_stonecutter', 'default'],
  ['bell_ring', 'default'], ['raid_trigger', 'default'], ['raid_win', 'default'],
  ['interact_with_anvil', 'default'], ['interact_with_grindstone', 'default'],
  ['target_hit', 'default'], ['interact_with_smithing_table', 'default'],
];

const COLUMNS: readonly (readonly [StatKind, string])[] = [
  ['mined', 'statistics/block_mined'],
  ['broken', 'statistics/item_broken'],
  ['crafted', 'statistics/item_crafted'],
  ['used', 'statistics/item_used'],
  ['picked_up', 'statistics/item_picked_up'],
  ['dropped', 'statistics/item_dropped'],
];

type StatsRow =
  | { kind: 'general'; label: string; value: string }
  | { kind: 'header' }
  | { kind: 'item'; item: string; values: (number | null)[] }
  | { kind: 'mob'; name: string; kills: string; killedBy: string; killColor: number; byColor: number };

const EMPTY_STATS: StatisticsView = {
  get: () => 0,
  entries: () => new Map(),
};

/** ScrollPanel with the six item-column header buttons on its first row. */
class StatsList extends ScrollPanel<StatsRow> {
  onHeaderClick?: (column: number) => void;
  sortColumn = -1;
  sortDir = 0;

  constructor(
    x: number, y: number, w: number, h: number, message: string,
    config: ScrollPanelConfig<StatsRow>,
  ) { super(x, y, w, h, message, config); }

  override mouseClicked(mx: number, my: number, button: number): boolean {
    if (button === 0 && this.onHeaderClick) {
      const headerY = this.y + 4 - this.scrollOffset;
      if (my >= headerY && my < headerY + ROW_ITEMS) {
        for (let c = 0; c < COLUMNS.length; c++) {
          const x = this.x + 75 + 40 * c - 18;
          if (mx >= x && mx < x + 18) { this.onHeaderClick(c); return true; }
        }
      }
    }
    return super.mouseClicked(mx, my, button);
  }
}

export class StatisticsScreen extends Screen {
  private tab = 0;
  private general!: StatsList;
  private items!: StatsList;
  private mobs!: StatsList;
  private sort: { column: number; dir: number } | null = null;
  private itemIdByName = new Map<string, number>();
  private blockItem = new Map<string, string>();
  private blockByItem = new Map<string, string>();
  private entityOrder: string[] = [];

  constructor(env: ConstructorParameters<typeof Screen>[0]) {
    super(env, 'gui.stats');
  }

  private get stats(): StatisticsView {
    return this.env.deps.stats ?? EMPTY_STATS;
  }

  /** StatsScreen is a pause-menu screen: the vanilla dirt menu background, not the world. */
  protected override renderBackground(g: GuiGraphics): void {
    g.renderMenuBackground(false, true);
  }

  protected build(): void {
    this.setCloseOnEsc(false);
    this.indexRegistries();
    const top = TAB_H + 4;
    const h = Math.max(20, this.height - FOOTER - top);
    const left = Math.floor((this.width - LIST_WIDTH) / 2);
    const title = this.t('gui.stats');

    this.general = new StatsList(left, top, LIST_WIDTH, h, title, {
      itemHeight: ROW_GENERAL,
      headerHeight: 4,
      renderItem: (g, row, i, x, y, w, _h) => {
        if (row.kind !== 'general') return;
        const color = i % 2 === 0 ? COLORS.white : COLORS.grey;
        g.drawString(row.label, x + 2, y + 3, color, true);
        const vw = g.textWidth(row.value);
        g.drawString(row.value, x + w - vw - 4, y + 3, color, true);
      },
    });

    this.items = new StatsList(left, top, LIST_WIDTH, h, title, {
      itemHeight: ROW_ITEMS,
      headerHeight: 4,
      renderItem: (g, row, i, x, y, w) => {
        if (row.kind === 'header') {
          this.drawItemHeader(g, x, y);
          return;
        }
        if (row.kind !== 'item') return;
        g.blitSprite('container/slot', x + 1, y + 1, 18, 18);
        const id = this.itemIdByName.get(row.item);
        if (id !== undefined) g.renderItem(id, x + 2, y + 2, 16);
        const color = i % 2 === 1 ? COLORS.grey : COLORS.white;
        for (let c = 0; c < COLUMNS.length; c++) {
          const v = row.values[c];
          const text = v === null ? '-' : formatDefault(v);
          const cx = x + 75 + 40 * c;
          g.drawString(text, cx - g.textWidth(text), y + 7, color, true);
        }
        void w;
      },
    });
    this.items.onHeaderClick = (c) => {
      if (this.sort && this.sort.column === c) {
        this.sort = this.sort.dir === -1 ? { column: c, dir: 1 } : null;
      } else {
        this.sort = { column: c, dir: -1 };
      }
      this.refresh();
    };

    this.mobs = new StatsList(left, top, LIST_WIDTH, h, title, {
      itemHeight: ROW_MOBS,
      headerHeight: 4,
      renderItem: (g, row, _i, x, y) => {
        if (row.kind !== 'mob') return;
        g.drawString(row.name, x + 2, y + 1, COLORS.white, true);
        g.drawString(row.kills, x + 12, y + 10, row.killColor, true);
        g.drawString(row.killedBy, x + 12, y + 19, row.byColor, true);
      },
    });

    this.addRenderableWidget(this.general);
    this.addRenderableWidget(this.items);
    this.addRenderableWidget(this.mobs);
    this.addRenderableWidget(new Button(
      Math.floor(this.width / 2) - 100, this.height - FOOTER + 6, 200, 20,
      this.t('gui.done'), () => this.back(),
    ));
    this.refresh();
  }

  private indexRegistries(): void {
    this.itemIdByName.clear();
    this.blockItem.clear();
    this.blockByItem.clear();
    this.entityOrder.length = 0;
    const mc = this.env.deps.mc as {
      items?: { name?: string }[];
      blocks?: { name?: string; item?: string }[];
      entities?: { name?: string }[];
    } | undefined;
    if (mc?.items) {
      mc.items.forEach((it, id) => { if (typeof it?.name === 'string') this.itemIdByName.set(it.name, id); });
    }
    if (mc?.blocks) {
      for (const b of mc.blocks) {
        if (typeof b?.name !== 'string' || typeof b.item !== 'string' || b.item === 'air') continue;
        this.blockItem.set(b.name, b.item);
        if (!this.blockByItem.has(b.item)) this.blockByItem.set(b.item, b.name);
      }
    }
    if (mc?.entities) {
      for (const e of mc.entities) {
        if (typeof e?.name === 'string') this.entityOrder.push(shortName(e.name));
      }
    }
  }

  private refresh(): void {
    const stats = this.stats;
    this.general.setItems(this.generalRows(stats));
    this.items.setItems(this.itemRows(stats));
    this.mobs.setItems(this.mobRows(stats));
    this.general.visible = this.tab === 0;
    this.items.visible = this.tab === 1;
    this.mobs.visible = this.tab === 2;
    this.general.active = this.tab === 0;
    this.items.active = this.tab === 1;
    this.mobs.active = this.tab === 2;
    this.items.sortColumn = this.sort?.column ?? -1;
    this.items.sortDir = this.sort?.dir ?? 0;
    const panel = this.tab === 0 ? this.general : this.tab === 1 ? this.items : this.mobs;
    panel.scrollOffset = 0;
  }

  private generalRows(stats: StatisticsView): StatsRow[] {
    const rows = CUSTOM.map(([key, format]) => ({
      kind: 'general' as const,
      label: this.t(`stat.minecraft.${key}`),
      value: formatValue(format, stats.get('custom', key)),
    }));
    rows.sort((a, b) => (a.label < b.label ? -1 : a.label > b.label ? 1 : 0));
    return rows;
  }

  private itemRows(stats: StatisticsView): StatsRow[] {
    const seen = new Set<string>();
    const rows: string[] = [];
    for (const [kind] of COLUMNS) {
      for (const [key, value] of stats.entries(kind)) {
        if (value <= 0) continue;
        const item = kind === 'mined' ? (this.blockItem.get(key) ?? '') : key;
        if (!item || item === 'air' || seen.has(item)) continue;
        seen.add(item);
        rows.push(item);
      }
    }
    const valueOf = (item: string, kind: StatKind): number | null => {
      if (kind === 'mined') {
        const block = this.blockByItem.get(item);
        return block === undefined ? null : stats.get('mined', block);
      }
      return stats.get(kind, item);
    };
    const idOf = (item: string): number => this.itemIdByName.get(item) ?? Number.MAX_SAFE_INTEGER;
    const sort = this.sort;
    rows.sort((a, b) => {
      if (sort) {
        const va = valueOf(a, COLUMNS[sort.column][0]) ?? -1;
        const vb = valueOf(b, COLUMNS[sort.column][0]) ?? -1;
        if (va !== vb) return (va - vb) * sort.dir;
      }
      return idOf(a) - idOf(b);
    });
    const out: StatsRow[] = [{ kind: 'header' }];
    for (const item of rows) {
      out.push({
        kind: 'item',
        item,
        values: COLUMNS.map(([kind]) => valueOf(item, kind)),
      });
    }
    return out;
  }

  private mobRows(stats: StatisticsView): StatsRow[] {
    const present = new Set<string>();
    for (const kind of ['killed', 'killed_by'] as const) {
      for (const [key, value] of stats.entries(kind)) if (value > 0) present.add(key);
    }
    const ordered: string[] = [];
    for (const id of this.entityOrder) if (present.has(id)) { ordered.push(id); present.delete(id); }
    for (const id of present) ordered.push(id);
    return ordered.map((mob) => {
      const name = this.t(`entity.minecraft.${mob}`);
      const kills = stats.get('killed', mob);
      const by = stats.get('killed_by', mob);
      return {
        kind: 'mob' as const,
        name,
        kills: kills > 0
          ? fill(this.t('stat_type.minecraft.killed'), String(kills), name)
          : fill(this.t('stat_type.minecraft.killed.none'), name),
        killedBy: by > 0
          ? fill(this.t('stat_type.minecraft.killed_by'), name, String(by))
          : fill(this.t('stat_type.minecraft.killed_by.none'), name),
        killColor: kills > 0 ? COLORS.grey : COLORS.dark,
        byColor: by > 0 ? COLORS.grey : COLORS.dark,
      };
    });
  }

  private drawItemHeader(g: GuiGraphics, x: number, y: number): void {
    for (let c = 0; c < COLUMNS.length; c++) {
      const hx = x + 75 + 40 * c - 18;
      g.blitSprite('container/slot', hx, y + 1, 18, 18);
      g.blitSprite(COLUMNS[c][1], hx, y + 1, 18, 18);
      if (this.sort?.column === c) {
        g.blitSprite(this.sort.dir < 0 ? 'statistics/sort_down' : 'statistics/sort_up', hx, y + 1, 18, 18);
      }
    }
  }

  protected override renderForeground(g: GuiGraphics, _mx: number, _my: number, _pt: number): void {
    g.blitSprite('header_separator', 0, TAB_H, this.width, 2);
    g.blitSprite('footer_separator', 0, this.height - FOOTER, this.width, 2);
    const [x0, tw] = tabs(this.width);
    const labels = ['stat.generalButton', 'stat.itemsButton', 'stat.mobsButton'];
    const active = this.tabActive();
    for (let i = 0; i < 3; i++) {
      const x = x0 + tw * i;
      const selected = this.tab === i;
      const enabled = active[i];
      const sprite = selected
        ? 'widget/tab_selected'
        : enabled ? 'widget/tab' : 'widget/tab';
      g.blitSprite(sprite, x, 0, tw, TAB_H);
      if (selected) g.fill(x + 2, TAB_H - 3, x + tw - 2, TAB_H - 2, COLORS.white);
      g.drawCenteredString(
        this.t(labels[i]), Math.floor(x + tw / 2), 6,
        selected ? COLORS.white : (enabled ? COLORS.labelGrey : 0xff606060), true,
      );
    }
  }

  private tabActive(): boolean[] {
    return [true, this.stats.entries('mined').size + this.stats.entries('broken').size
      + this.stats.entries('crafted').size + this.stats.entries('used').size
      + this.stats.entries('picked_up').size + this.stats.entries('dropped').size > 0,
    this.stats.entries('killed').size + this.stats.entries('killed_by').size > 0];
  }

  protected override onMouseClicked(mx: number, my: number, button: number): boolean {
    if (button !== 0) return false;
    const [x0, tw] = tabs(this.width);
    if (my >= 0 && my < TAB_H) {
      for (let i = 0; i < 3; i++) {
        if (mx >= x0 + tw * i && mx < x0 + tw * (i + 1) && this.tabActive()[i] && this.tab !== i) {
          this.tab = i;
          this.refresh();
          return true;
        }
      }
    }
    return false;
  }

  protected override onKeyPressed(code: string): boolean {
    if (code === 'Escape') { this.back(); return true; }
    return false;
  }
}

/** MenuTabBar geometry: three tabs over at most 400 pixels. */
function tabs(w: number): [number, number] {
  const total = Math.min(w, 400) - 28;
  const tab = Math.round((total / 3) / 2) * 2;
  const x0 = Math.floor((w - tab * 3) / 2);
  return [x0, tab];
}

function shortName(name: string): string {
  const i = name.indexOf(':');
  return i >= 0 ? name.slice(i + 1) : name;
}

/** StatFormatter.default/Format.Default: en-US integer grouping (1,234). */
function formatDefault(value: number): string {
  const digits = Math.abs(value).toString();
  let out = '';
  for (let i = 0; i < digits.length; i++) {
    if (i > 0 && (digits.length - i) % 3 === 0) out += ',';
    out += digits[i];
  }
  return value < 0 ? `-${out}` : out;
}

function two(v: number): string { return v.toFixed(2); }

function formatValue(format: Format, value: number): string {
  switch (format) {
    case 'default': return formatDefault(value);
    case 'tenths': return two(value * 0.1);
    case 'distance': {
      const m = value / 100;
      const km = m / 1000;
      if (km > 0.5) return `${two(km)} km`;
      if (m > 0.5) return `${two(m)} m`;
      return `${value} cm`;
    }
    case 'time': {
      const s = value / 20;
      const min = s / 60, hours = s / 3600, days = hours / 24, years = hours / 24 / 365;
      if (years > 0.5) return `${two(years)} y`;
      if (days > 0.5) return `${two(days)} d`;
      if (hours > 0.5) return `${two(hours)} h`;
      if (min > 0.5) return `${two(min)} min`;
      return `${s} s`;
    }
  }
}

/** Translation with positional (%1$s) then sequential (%s) substitution. */
function fill(template: string, ...args: string[]): string {
  let next = 0;
  return template
    .replace(/%(\d+)\$s/g, (_m, n: string) => args[Number(n) - 1] ?? `%${n}$s`)
    .replace(/%s/g, () => args[next++] ?? '%s');
}
