// Data-driven advancements (net/minecraft/advancements + AdvancementProgress).
//
// Definitions and tag membership are imported from the player's own client data by
// scripts/build-advancements.mjs into data/advancements.json and data/tags.json.
// This manager evaluates the trigger subset wired by Game (inventory_changed, mine_block,
// consume_item, player_killed_entity, location, villager_trade, tick); criteria whose trigger
// is not wired stay incomplete rather than being granted incorrectly.

export interface AdvancementCriterion {
  trigger: string;
  items?: string[];
  blocks?: string[];
  entities?: string[];
  dimension?: string;
  /** entity_properties location.position.y predicate (e.g. trade at y>=319). */
  minY?: number;
  maxY?: number;
}

export interface AdvancementDefinition {
  parent: string | null;
  title: string;
  description: string;
  icon: string;
  frame: 'task' | 'goal' | 'challenge' | string;
  background?: string;
  hidden: boolean;
  toast: boolean;
  announce: boolean;
  criteria: Record<string, AdvancementCriterion>;
  requirements: string[][];
}

export interface AdvancementEvent {
  items?: readonly string[];
  block?: string;
  entity?: string;
  item?: string;
  dimension?: string;
  /** Player Y, used by criteria with an entity_properties position predicate. */
  y?: number;
}

export interface AdvancementRow {
  id: string;
  title: string;
  description: string;
  icon: string;
  frame: string;
  done: boolean;
  started: boolean;
  depth: number;
}

interface AdvancementFile {
  roots: string[];
  advancements: Record<string, AdvancementDefinition>;
}

interface TagFile {
  item: Record<string, string[]>;
  block: Record<string, string[]>;
  entity_type: Record<string, string[]>;
}

const strip = (id: string): string => (id.startsWith('minecraft:') ? id.slice(10) : id);

export class AdvancementManager {
  private readonly defs = new Map<string, AdvancementDefinition>();
  private readonly tags: TagFile = { item: {}, block: {}, entity_type: {} };
  private readonly completed = new Set<string>();
  private readonly criteriaDone = new Map<string, Set<string>>();
  private readonly roots: string[] = [];
  /** Called once per advancement that finishes, with its definition. */
  onComplete?: (adv: AdvancementDefinition, id: string) => void;

  static async load(base = '/data'): Promise<AdvancementManager> {
    const manager = new AdvancementManager();
    try {
      const [defs, tags] = await Promise.all([
        fetch(`${base}/advancements.json`).then((r) => {
          if (!r.ok) throw new Error(`advancements: HTTP ${r.status}`);
          return r.json() as Promise<AdvancementFile>;
        }),
        fetch(`${base}/tags.json`).then((r) => {
          if (!r.ok) throw new Error(`tags: HTTP ${r.status}`);
          return r.json() as Promise<TagFile>;
        }),
      ]);
      for (const [id, adv] of Object.entries(defs.advancements ?? {})) manager.defs.set(id, adv);
      manager.roots.push(...(defs.roots ?? []));
      manager.tags.item = tags.item ?? {};
      manager.tags.block = tags.block ?? {};
      manager.tags.entity_type = tags.entity_type ?? {};
    } catch (err) {
      console.warn('[advancements] disabled:', err);
    }
    return manager;
  }

  rootsList(): readonly string[] { return this.roots; }

  /** Root advancement title key, used as the tab label. */
  rootTitle(root: string): string {
    return this.defs.get(root)?.title ?? `advancements.${root}.root.title`;
  }

  isComplete(id: string): boolean { return this.completed.has(id); }

  count(): { done: number; total: number } {
    let total = 0;
    for (const adv of this.defs.values()) if (!adv.hidden) total++;
    return { done: this.completed.size, total };
  }

  /** Flatten a root's descendants into a deterministic parent-before-child list. */
  rows(root: string): AdvancementRow[] {
    const rows: AdvancementRow[] = [];
    for (const [id, adv] of this.defs) {
      if (adv.hidden || !this.belongsTo(id, root)) continue;
      const done = this.completed.has(id);
      const started = done || (this.criteriaDone.get(id)?.size ?? 0) > 0;
      rows.push({
        id, title: adv.title, description: adv.description, icon: adv.icon,
        frame: adv.frame, done, started, depth: this.depth(id),
      });
    }
    rows.sort((a, b) => a.depth - b.depth || a.title.localeCompare(b.title) || a.id.localeCompare(b.id));
    return rows;
  }

  private belongsTo(id: string, root: string): boolean {
    let cur: string | null = id;
    const seen = new Set<string>();
    while (cur && !seen.has(cur)) {
      if (cur === root) return true;
      seen.add(cur);
      cur = this.defs.get(cur)?.parent ?? null;
    }
    return false;
  }

  private depth(id: string): number {
    let depth = 0;
    let cur = this.defs.get(id)?.parent ?? null;
    const seen = new Set<string>();
    while (cur && !seen.has(cur)) { seen.add(cur); depth++; cur = this.defs.get(cur)?.parent ?? null; }
    return depth;
  }

  /** Fires a trigger and completes every advancement whose requirements are now met. */
  trigger(type: string, event: AdvancementEvent = {}): void {
    if (this.defs.size === 0) return;
    for (const [id, adv] of this.defs) {
      if (this.completed.has(id)) continue;
      let changed = false;
      for (const [name, criterion] of Object.entries(adv.criteria)) {
        if (criterion.trigger !== type) continue;
        if (!this.matches(criterion, type, event)) continue;
        let done = this.criteriaDone.get(id);
        if (!done) { done = new Set(); this.criteriaDone.set(id, done); }
        if (!done.has(name)) { done.add(name); changed = true; }
      }
      if (changed && this.satisfied(id, adv)) {
        this.completed.add(id);
        this.onComplete?.(adv, id);
      }
    }
  }

  private satisfied(id: string, adv: AdvancementDefinition): boolean {
    const done = this.criteriaDone.get(id);
    if (!done) return false;
    const groups = adv.requirements.length > 0
      ? adv.requirements
      : Object.keys(adv.criteria).map((name) => [name]);
    return groups.every((group) => group.some((name) => done.has(name)));
  }

  private matches(criterion: AdvancementCriterion, type: string, event: AdvancementEvent): boolean {
    if (criterion.minY !== undefined || criterion.maxY !== undefined) {
      if (event.y === undefined) return false;
      if (criterion.minY !== undefined && event.y < criterion.minY) return false;
      if (criterion.maxY !== undefined && event.y > criterion.maxY) return false;
    }
    switch (type) {
      case 'inventory_changed':
        return this.matchList(criterion.items, event.items, 'item');
      case 'consume_item':
        return this.matchList(criterion.items, event.item ? [event.item] : [], 'item');
      case 'mine_block':
      case 'enter_block':
        return this.matchList(criterion.blocks, event.block ? [event.block] : [], 'block');
      case 'player_killed_entity':
      case 'killed_by_entity':
        return this.matchList(criterion.entities, event.entity ? [event.entity] : [], 'entity_type');
      case 'location':
        // Conditions we cannot evaluate yet (biomes/structures) must not match "anywhere".
        return !!criterion.dimension && strip(event.dimension ?? 'overworld') === strip(criterion.dimension);
      case 'villager_trade':
        return true;
      case 'tick':
        return true;
      default:
        return false;
    }
  }

  private matchList(wanted: readonly string[] | undefined,
    have: readonly string[] | undefined, kind: 'item' | 'block' | 'entity_type'): boolean {
    if (!have || have.length === 0) return false;
    if (!wanted || wanted.length === 0) return true; // "any item / any block / any kill"
    for (const want of wanted) {
      for (const value of have) {
        if (want.startsWith('#')) {
          if (this.tagContains(kind, want.slice(1), strip(value))) return true;
        } else if (strip(want) === strip(value)) {
          return true;
        }
      }
    }
    return false;
  }

  private tagContains(kind: 'item' | 'block' | 'entity_type', tag: string, value: string, seen = new Set<string>()): boolean {
    const key = strip(tag);
    if (seen.has(key)) return false;
    seen.add(key);
    const entries = this.tags[kind]?.[key];
    if (!entries) return false;
    for (const entry of entries) {
      if (entry.startsWith('#')) {
        if (this.tagContains(kind, entry.slice(1), value, seen)) return true;
      } else if (strip(entry) === value) {
        return true;
      }
    }
    return false;
  }

  toJSON(): { done: string[]; criteria: Record<string, string[]> } {
    const criteria: Record<string, string[]> = {};
    for (const [id, set] of this.criteriaDone) if (set.size > 0) criteria[id] = [...set];
    return { done: [...this.completed], criteria };
  }

  load(data: unknown): void {
    this.completed.clear();
    this.criteriaDone.clear();
    if (!data || typeof data !== 'object') return;
    const raw = data as { done?: unknown; criteria?: unknown };
    if (Array.isArray(raw.done)) {
      for (const id of raw.done) if (typeof id === 'string' && this.defs.has(id)) this.completed.add(id);
    }
    if (raw.criteria && typeof raw.criteria === 'object') {
      for (const [id, names] of Object.entries(raw.criteria as Record<string, unknown>)) {
        if (!this.defs.has(id) || !Array.isArray(names)) continue;
        this.criteriaDone.set(id, new Set(names.filter((n): n is string => typeof n === 'string')));
      }
    }
  }
}
