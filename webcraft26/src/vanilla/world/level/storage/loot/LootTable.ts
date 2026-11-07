// Source: net.minecraft.world.level.storage.loot.LootTable (26.2)
//         net.minecraft.world.level.block.Block#dropResources / #getDrops
//         net.minecraft.world.level.storage.loot.functions.ApplyBonusCount (ore_drops)
//         net.minecraft.world.level.storage.loot.predicates.* (match_tool / survives_explosion ...)
//
// Loads public/mc/loot.json. The generated `drops[]` is a fast path; when a
// table is marked with a `fallback` (multiple_pools / block_state_property /
// function_conditions / pool_conditions) or has no drops, the `raw` table is
// interpreted by a minimal subset of the vanilla loot engine.

import { ItemStack } from '../../../item/ItemStack.js';
import type { ItemRegistry } from '../../../item/Item.js';
import type { RandomSource } from '../../../../core/Random.js';

function short(name: string): string {
  const i = name.indexOf(':');
  return i >= 0 ? name.slice(i + 1) : name;
}

export interface LootContext {
  /** Short block name, e.g. "stone". */
  blockName: string;
  silkTouch: boolean;
  fortune: number;
  /** Player.hasCorrectToolForDrops(state). */
  hasCorrectTool: boolean;
  /** BlockState.requiresCorrectToolForDrops(). */
  requiresTool: boolean;
  /** True when the drop comes from an explosion (survives_explosion). */
  exploded: boolean;
  /** Short item name of the held tool ("" for bare hand). */
  tool: string;
}

/** The API BlockBreaking.getDrops consumes (main agent / SurvivalState owned). */
export interface LootTableApi {
  getDrops(blockName: string, ctx: LootContext): ItemStack[];
}

interface DropDef {
  item: string;
  min: number;
  max: number;
  chance: number;
  requiresTool: boolean;
  silkTouch: boolean;
  affectedByFortune: boolean;
}

interface LootEntry {
  drops: DropDef[];
  fallback: string | null;
  raw: any;
}

/** ApplyBonusCount.OreDrops.calculateNewCount. */
function oreBonus(count: number, level: number, random: RandomSource): number {
  if (level <= 0) return count;
  let bonus = random.nextInt(level + 2) - 1;
  if (bonus < 0) bonus = 0;
  return count * (bonus + 1);
}

export class LootTable implements LootTableApi {
  private readonly entries = new Map<string, LootEntry>();
  readonly random: RandomSource;
  readonly registry: ItemRegistry;

  constructor(json: any, registry: ItemRegistry, random: RandomSource) {
    this.registry = registry;
    this.random = random;
    if (json && typeof json === 'object') {
      for (const key of Object.keys(json)) {
        const raw = json[key];
        const drops: DropDef[] = [];
        if (Array.isArray(raw?.drops)) {
          for (const d of raw.drops) {
            drops.push({
              item: String(d.item ?? ''),
              min: Number(d.min ?? 1),
              max: Number(d.max ?? 1),
              chance: Number(d.chance ?? 1),
              requiresTool: !!d.requiresTool,
              silkTouch: !!d.silkTouch,
              affectedByFortune: !!d.affectedByFortune,
            });
          }
        }
        const entry: LootEntry = {
          drops,
          fallback: raw?.fallback ? String(raw.fallback) : null,
          raw: raw?.raw ?? null,
        };
        this.entries.set(key, entry);
        this.entries.set(short(key), entry);
      }
    }
  }

  hasTable(blockName: string): boolean { return this.entries.has(blockName) || this.entries.has(short(blockName)); }
  tableCount(): number { return this.entries.size / 2; }

  /** LootTable.getRandomItems for one block state. */
  getDrops(blockName: string, ctx: LootContext): ItemStack[] {
    const entry = this.entries.get(blockName) ?? this.entries.get(short(blockName))
      ?? this.entries.get(`minecraft:${short(blockName)}`);
    if (!entry) return [];
    // BlockState.requiresCorrectToolForDrops: wrong tool yields nothing at all.
    if (ctx.requiresTool && !ctx.hasCorrectTool) return [];
    if (entry.fallback || entry.drops.length === 0) return this.evalRaw(entry.raw, ctx);
    return this.evalFast(entry, ctx);
  }

  private evalFast(entry: LootEntry, ctx: LootContext): ItemStack[] {
    const out: ItemStack[] = [];
    for (let i = 0; i < entry.drops.length; i++) {
      const d = entry.drops[i];
      // The generated drops list is an `alternatives` split by silk touch:
      // only the branch matching the tool's silk-touch state is active.
      if (d.silkTouch !== ctx.silkTouch) continue;
      if (d.requiresTool && !ctx.hasCorrectTool) continue;

      let chance = d.chance;
      if (chance < 1 && d.affectedByFortune && ctx.fortune > 0) {
        chance = tableBonusChance(entry.raw, d.item, ctx.fortune, chance);
      }
      if (chance < 1 && this.random.nextFloat() >= Math.max(0, Math.min(chance, 1))) continue;

      const lo = Math.max(0, d.min);
      const hi = Math.max(lo, d.max);
      let count = lo + (hi > lo ? this.random.nextInt(hi - lo + 1) : 0);
      if (d.affectedByFortune && ctx.fortune > 0) count = oreBonus(count, ctx.fortune, this.random);
      if (count <= 0) continue;
      const stack = ItemStack.fromName(this.registry, short(d.item), count);
      if (!stack.isEmpty()) out.push(stack);
    }
    return out;
  }

  // ---- raw fallback interpreter (minimal subset) --------------------------

  private evalRaw(raw: any, ctx: LootContext): ItemStack[] {
    const out: ItemStack[] = [];
    if (!raw || !Array.isArray(raw.pools)) return out;
    for (const pool of raw.pools) {
      if (pool.conditions && !this.evalConditions(pool.conditions, ctx)) continue;
      const rolls = this.rollCount(pool.rolls, 1);
      for (let r = 0; r < rolls; r++) {
        const entries = pool.entries;
        if (!Array.isArray(entries) || entries.length === 0) continue;
        const chosen = this.pickWeighted(entries, ctx);
        if (chosen) this.evalEntry(chosen, ctx, out);
      }
    }
    return out;
  }

  private pickWeighted(entries: any[], ctx: LootContext): any | null {
    let total = 0;
    for (const e of entries) if (!e.conditions || this.evalConditions(e.conditions, ctx)) total += (Number(e.weight ?? 1) || 1);
    if (total <= 0) return null;
    let roll = this.random.nextFloat() * total;
    for (const e of entries) {
      if (e.conditions && !this.evalConditions(e.conditions, ctx)) continue;
      roll -= (Number(e.weight ?? 1) || 1);
      if (roll < 0) return e;
    }
    return entries[entries.length - 1] ?? null;
  }

  private evalEntry(entry: any, ctx: LootContext, out: ItemStack[]): void {
    if (!entry || (entry.conditions && !this.evalConditions(entry.conditions, ctx))) return;
    const type = String(entry.type ?? '');
    if (type === 'minecraft:item') {
      const item = short(String(entry.name ?? ''));
      const stack = ItemStack.fromName(this.registry, item, 1);
      if (stack.isEmpty()) return;
      this.applyFunctions(entry.functions, stack, ctx);
      if (!stack.isEmpty() && stack.getCount() > 0) out.push(stack);
    } else if (type === 'minecraft:alternatives') {
      for (const child of (entry.children ?? [])) {
        if (!child.conditions || this.evalConditions(child.conditions, ctx)) { this.evalEntry(child, ctx, out); break; }
      }
    } else if (type === 'minecraft:group') {
      for (const child of (entry.children ?? [])) this.evalEntry(child, ctx, out);
    } else if (type === 'minecraft:sequence') {
      for (const child of (entry.children ?? [])) {
        if (child.conditions && !this.evalConditions(child.conditions, ctx)) break;
        this.evalEntry(child, ctx, out);
      }
    }
    // minecraft:tag / dynamic / loot_table / empty: intentionally not expanded.
  }

  private applyFunctions(functions: any, stack: ItemStack, ctx: LootContext): void {
    if (!Array.isArray(functions)) return;
    for (const f of functions) {
      if (f.conditions && !this.evalConditions(f.conditions, ctx)) continue;
      const fn = String(f.function ?? '');
      if (fn === 'minecraft:set_count' || fn === 'minecraft:set_item_count') {
        const c = f.count;
        let n = 1;
        if (typeof c === 'number') n = c;
        else if (c && typeof c === 'object') n = this.rollCount(c, 1);
        stack.setCount(f.add ? stack.getCount() + n : n);
      } else if (fn === 'minecraft:apply_bonus') {
        const formula = String(f.formula ?? '');
        const level = ctx.fortune;
        if (level > 0) {
          if (formula === 'minecraft:ore_drops') {
            stack.setCount(oreBonus(stack.getCount(), level, this.random));
          } else if (formula === 'minecraft:uniform_bonus_count') {
            const mult = Number(f.bonusMultiplier ?? 1);
            stack.setCount(stack.getCount() + this.random.nextInt(mult * level + 1));
          } else if (formula === 'minecraft:binomial_with_bonus_count') {
            const extra = Number(f.extraRounds ?? f.extra ?? 0);
            const p = Number(f.probability ?? 0.5);
            let n = stack.getCount();
            for (let i = 0; i < level + extra; i++) if (this.random.nextFloat() < p) n++;
            stack.setCount(n);
          }
        }
      } else if (fn === 'minecraft:limit_count') {
        const lim = f.limit;
        if (lim && typeof lim === 'object') {
          const max = Number(lim.max ?? Number.MAX_SAFE_INTEGER);
          if (stack.getCount() > max) stack.setCount(Math.max(0, Number(lim.min ?? 0)));
        }
      } else if (fn === 'minecraft:explosion_decay' && ctx.exploded) {
        if (this.random.nextFloat() < 0.5) stack.setCount(0);
      }
      // set_damage / enchant / copy_* / set_components / set_name: no-op subset.
    }
    stack.limitSize(stack.getMaxStackSize());
  }

  private rollCount(spec: any, fallback: number): number {
    if (typeof spec === 'number') return Math.max(0, Math.floor(spec));
    if (spec && typeof spec === 'object') {
      const min = Number(spec.min ?? 0);
      const max = Number(spec.max ?? min);
      if (max <= min) return Math.max(0, Math.floor(min));
      return Math.floor(min) + this.random.nextInt(Math.floor(max) - Math.floor(min) + 1);
    }
    return fallback;
  }

  private evalConditions(conditions: any, ctx: LootContext): boolean {
    if (!Array.isArray(conditions)) return true;
    for (const c of conditions) if (!this.evalCondition(c, ctx)) return false;
    return true;
  }

  private evalCondition(c: any, ctx: LootContext): boolean {
    if (!c || typeof c !== 'object') return true;
    const cond = String(c.condition ?? '');
    if (cond === 'minecraft:survives_explosion') return !ctx.exploded;
    if (cond === 'minecraft:inverted') return !this.evalCondition(c.term, ctx);
    if (cond === 'minecraft:any_of' || cond === 'minecraft:all_of') {
      const terms: any[] = c.terms ?? [];
      if (cond === 'minecraft:any_of') { for (const t of terms) if (this.evalCondition(t, ctx)) return true; return terms.length === 0; }
      for (const t of terms) if (!this.evalCondition(t, ctx)) return false;
      return true;
    }
    if (cond === 'minecraft:random_chance' || cond === 'minecraft:random_chance_with_enchanted_bonus') {
      return this.random.nextFloat() < Number(c.chance ?? c.probability ?? 1);
    }
    if (cond === 'minecraft:table_bonus') {
      const chances: number[] = c.chances ?? [];
      if (chances.length === 0) return true;
      return this.random.nextFloat() < chances[Math.min(ctx.fortune, chances.length - 1)];
    }
    if (cond === 'minecraft:match_tool') return this.matchTool(c.predicate, ctx);
    // Unknown conditions (block_state_property, entity_properties, ...) are
    // treated permissively so the fallback still yields the common drop.
    return true;
  }

  private matchTool(predicate: any, ctx: LootContext): boolean {
    if (!predicate || typeof predicate !== 'object') return true;
    if (predicate.items !== undefined) {
      const items = Array.isArray(predicate.items) ? predicate.items : [predicate.items];
      let ok = false;
      for (const it of items) if (short(String(it)) === ctx.tool) ok = true;
      if (!ok) return false;
    }
    const ench = predicate.predicates?.['minecraft:enchantments'];
    if (Array.isArray(ench)) {
      for (const e of ench) {
        const id = short(String(e.enchantments ?? ''));
        const min = Number(e.levels?.min ?? 0);
        if (id === 'silk_touch' && !(ctx.silkTouch && 1 >= min)) return false;
        if (id === 'fortune' && !(ctx.fortune >= min)) return false;
        if (id !== 'silk_touch' && id !== 'fortune' && min > 0) return false;
      }
    }
    return true;
  }
}

/** Scan a raw table for a table_bonus chance table for a given item. */
function tableBonusChance(raw: any, item: string, fortune: number, fallback: number): number {
  if (!raw) return fallback;
  const target = short(item);
  const walk = (node: any): number | null => {
    if (!node || typeof node !== 'object') return null;
    if (Array.isArray(node)) { for (const n of node) { const r = walk(n); if (r !== null) return r; } return null; }
    if (node.condition === 'minecraft:table_bonus' && Array.isArray(node.chances)) {
      return node.chances[Math.min(fortune, node.chances.length - 1)];
    }
    // Only consider table_bonus attached to the same item entry.
    if (node.type === 'minecraft:item' && short(String(node.name ?? '')) !== target) return null;
    for (const k of Object.keys(node)) { const r = walk(node[k]); if (r !== null) return r; }
    return null;
  };
  const found = walk(raw);
  return found === null ? fallback : found;
}
