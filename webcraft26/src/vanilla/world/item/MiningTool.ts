// Source: net.minecraft.world.item.component.Tool (26.2)
//         net.minecraft.world.item.Item#getDestroySpeed / #isCorrectToolForDrops
//         net.minecraft.tags.BlockTags (mineable/*, incorrect_for_*_tool, needs_*_tool)
//
// In 26.2 the old DiggerItem was replaced by the data-driven Tool component:
//   Tool.getMiningSpeed(state)      -> first rule with a speed whose block-set matches
//   Tool.isCorrectForDrops(state)   -> first rule with correct_for_drops whose block-set matches
// The generated items.json collapses every Tool.Rule into { tag, speed }, where `tag`
// is the rendered HolderSet (NamedSet(TagKey[...]) or DirectSet[[...]]).

/** Strip a leading `minecraft:` (or any namespace) from a registry name. */
export function stripNamespace(name: string): string {
  const i = name.indexOf(':');
  return i >= 0 ? name.slice(i + 1) : name;
}

const EMPTY_SET: ReadonlySet<string> = new Set<string>();

/** Index over tags.json's `block` table. Built once, never scanned linearly. */
export class BlockTagIndex {
  private readonly tags = new Map<string, ReadonlySet<string>>();

  constructor(raw: any) {
    // tags.json is { block: {...}, item: {...}, ... }; accept the sub-table too.
    const table: Record<string, string[]> = (raw && typeof raw === 'object' && raw.block) ? raw.block : raw;
    if (!table || typeof table !== 'object') return;
    for (const key of Object.keys(table)) {
      const arr = table[key];
      if (!Array.isArray(arr)) continue;
      const members = new Set<string>();
      for (let i = 0; i < arr.length; i++) members.add(stripNamespace(arr[i]));
      this.tags.set(key, members);
      const short = stripNamespace(key);
      if (short !== key) this.tags.set(short, members);
    }
  }

  private lookup(tagName: string): ReadonlySet<string> | undefined {
    return this.tags.get(tagName)
      ?? this.tags.get(stripNamespace(tagName))
      ?? this.tags.get(`minecraft:${stripNamespace(tagName)}`);
  }

  contains(tagName: string, blockName: string): boolean {
    const s = this.lookup(tagName);
    return s !== undefined && s.has(stripNamespace(blockName));
  }

  members(tagName: string): ReadonlySet<string> {
    return this.lookup(tagName) ?? EMPTY_SET;
  }

  hasTag(tagName: string): boolean { return this.lookup(tagName) !== undefined; }
}

export interface ToolRule {
  readonly blocks: ReadonlySet<string>; // short block names
  readonly speed: number | undefined;
  readonly correctForDrops: boolean | undefined;
}

/** Port of net.minecraft.world.item.component.Tool. */
export class MiningTool {
  readonly rules: readonly ToolRule[];
  readonly defaultMiningSpeed: number;
  readonly damagePerBlock: number;

  constructor(rules: readonly ToolRule[], defaultMiningSpeed = 1, damagePerBlock = 1) {
    this.rules = rules;
    this.defaultMiningSpeed = defaultMiningSpeed;
    this.damagePerBlock = damagePerBlock;
  }

  /** Tool.getMiningSpeed: first matching rule that carries a speed, else the default. */
  getMiningSpeed(blockName: string): number {
    const name = stripNamespace(blockName);
    const rules = this.rules;
    for (let i = 0; i < rules.length; i++) {
      const r = rules[i];
      if (r.speed !== undefined && r.blocks.has(name)) return r.speed;
    }
    return this.defaultMiningSpeed;
  }

  /** Tool.isCorrectForDrops: first matching rule that carries correct_for_drops, else false. */
  isCorrectForDrops(blockName: string): boolean {
    const name = stripNamespace(blockName);
    const rules = this.rules;
    for (let i = 0; i < rules.length; i++) {
      const r = rules[i];
      if (r.correctForDrops !== undefined && r.blocks.has(name)) return r.correctForDrops;
    }
    return false;
  }
}

const NAMED_TAG = /TagKey\[[^/]*\/\s*([^\]]+)\]/;
const DIRECT_BLOCK = /Block\{([^}]+)\}/g;

/**
 * Resolve one collapsed `{tag, speed}` rule from items.json into a ToolRule.
 * `mineable/*` implies correct_for_drops=true; `incorrect_for_*_tool` implies false;
 * everything else (shears speed overrides, sword tags, direct sets) is speed-only.
 */
export function resolveToolRule(tag: string, speed: number, tags: BlockTagIndex): ToolRule {
  const named = NAMED_TAG.exec(tag);
  if (named) {
    const tagName = named[1];
    let correct: boolean | undefined;
    if (tagName.includes('incorrect_for_')) correct = false;
    else if (tagName.includes('mineable/')) correct = true;
    return { blocks: tags.members(tagName), speed, correctForDrops: correct };
  }
  if (tag.startsWith('DirectSet')) {
    const blocks = new Set<string>();
    DIRECT_BLOCK.lastIndex = 0;
    let m: RegExpExecArray | null;
    while ((m = DIRECT_BLOCK.exec(tag)) !== null) blocks.add(stripNamespace(m[1]));
    return { blocks, speed, correctForDrops: undefined };
  }
  return { blocks: EMPTY_SET, speed, correctForDrops: undefined };
}

/** Build the Tool component for an item's `tool` array, or null when it has none. */
export function createMiningTool(tool: any, tags: BlockTagIndex): MiningTool | null {
  if (!Array.isArray(tool) || tool.length === 0) return null;
  const rules: ToolRule[] = [];
  for (let i = 0; i < tool.length; i++) {
    const r = tool[i];
    rules.push(resolveToolRule(String(r.tag ?? ''), Number(r.speed ?? 1), tags));
  }
  return new MiningTool(rules, 1, 1);
}
