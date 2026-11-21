// Source: net.minecraft.stats.Stats / StatsCounter / ServerStatsCounter
//
// Per-player statistic counters, keyed by vanilla category and short id:
//   custom.<key>      e.g. walk_one_cm / mob_kills / animals_bred
//   mined.<block>     blocks mined (keyed by block, not item)
//   broken.<item>     items that broke from durability
//   crafted.<item>    items crafted (crafting result take / furnace take)
//   used.<item>       items used (placed block, eaten, bow shot ...)
//   picked_up.<item>  items picked up from the ground
//   dropped.<item>    items dropped by the player (Q)
//   killed.<mob>      mobs killed by the player
//   killed_by.<mob>   mobs that killed the player
//
// The shape mirrors the vanilla stats JSON ({"minecraft:mined":{"minecraft:stone":3}})
// so it round-trips through the player save without a custom schema.

export const STAT_KINDS = [
  'custom', 'mined', 'broken', 'crafted', 'used', 'picked_up', 'dropped', 'killed', 'killed_by',
] as const;

export type StatKind = typeof STAT_KINDS[number];

export type StatsJson = Record<string, Record<string, number>>;

/** `minecraft:stone` -> `stone`; vanilla keys are namespaced in the saved JSON. */
export function shortStatId(name: string): string {
  const i = name.indexOf(':');
  return i >= 0 ? name.slice(i + 1) : name;
}

export class Statistics {
  private readonly values = new Map<string, Map<string, number>>();

  get(kind: StatKind, key: string): number {
    return this.values.get(kind)?.get(shortStatId(key)) ?? 0;
  }

  set(kind: StatKind, key: string, value: number): void {
    const id = shortStatId(key);
    if (value === 0) { this.values.get(kind)?.delete(id); return; }
    let map = this.values.get(kind);
    if (!map) { map = new Map(); this.values.set(kind, map); }
    map.set(id, Math.trunc(value));
  }

  /** Stats.increment: add `amount` to a counter and return the new value. */
  award(kind: StatKind, key: string, amount = 1): number {
    if (amount === 0) return this.get(kind, key);
    const next = this.get(kind, key) + amount;
    this.set(kind, key, next);
    return next;
  }

  /** Every `key -> count` pair of one category (empty when the player never triggered it). */
  entries(kind: StatKind): ReadonlyMap<string, number> {
    return this.values.get(kind) ?? EMPTY_MAP;
  }

  clear(): void { this.values.clear(); }

  toJSON(): StatsJson {
    const out: StatsJson = {};
    for (const [kind, map] of this.values) {
      if (map.size === 0) continue;
      const entries: Record<string, number> = {};
      for (const [key, value] of map) if (value !== 0) entries[key] = value;
      if (Object.keys(entries).length > 0) out[kind] = entries;
    }
    return out;
  }

  /** Accepts the saved shape; unknown categories/keys are kept for forward compatibility. */
  load(json: unknown): void {
    this.clear();
    if (!json || typeof json !== 'object') return;
    for (const [rawKind, rawEntries] of Object.entries(json as Record<string, unknown>)) {
      const kind = STAT_KINDS.includes(rawKind as StatKind) ? rawKind as StatKind : null;
      if (!kind || !rawEntries || typeof rawEntries !== 'object') continue;
      for (const [rawKey, rawValue] of Object.entries(rawEntries as Record<string, unknown>)) {
        const value = Number(rawValue);
        if (!Number.isFinite(value) || value === 0) continue;
        this.set(kind, rawKey, value);
      }
    }
  }
}

const EMPTY_MAP: ReadonlyMap<string, number> = new Map();

/** Structural view the GUI reads (no Game import). */
export interface StatisticsView {
  get(kind: StatKind, key: string): number;
  entries(kind: StatKind): ReadonlyMap<string, number>;
}
