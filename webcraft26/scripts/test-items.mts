// Verification for the item / inventory / container / crafting / survival port.
//
//   npx tsx scripts/test-items.mts
//
// Loads the real on-disk data (data/items.json, public/mc/blocks.json + blocks.bin,
// recipes.json, tags.json, loot.json, lang/en_us.json) with fs (no fetch), builds
// MinecraftData and SurvivalState, and runs the 8 required checks. Each prints
// PASS/FAIL; any failure exits with code 1. Performance numbers are printed at
// the end.

import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { performance } from 'node:perf_hooks';

import { MinecraftData } from '../src/vanilla/world/level/block/state/BlockState.ts';
import { ItemRegistry } from '../src/vanilla/world/item/Item.ts';
import { ItemStack } from '../src/vanilla/world/item/ItemStack.ts';
import { BlockBreaking } from '../src/vanilla/world/level/block/BlockBreaking.ts';
import { LootTable } from '../src/vanilla/gameplay/loot/LootTable.ts';
import { RecipeManager } from '../src/vanilla/world/item/crafting/RecipeManager.ts';
import { CraftingInput, ShapedRecipe, ShapelessRecipe, CookingRecipe } from '../src/vanilla/world/item/crafting/Recipe.ts';
import { ContainerInput } from '../src/vanilla/world/inventory/ClickAction.ts';
import { SurvivalState, setWorldData, type WorldData } from '../src/vanilla/gameplay/SurvivalState.ts';
import { XoroshiroRandomSource } from '../src/vanilla/core/Random.ts';

const here = path.dirname(fileURLToPath(import.meta.url));
const root = path.resolve(here, '..');
const readJson = (p: string): unknown => JSON.parse(fs.readFileSync(path.join(root, p), 'utf8'));
function readArrayBuffer(file: string): ArrayBuffer {
  const buf = fs.readFileSync(path.join(root, file));
  return buf.buffer.slice(buf.byteOffset, buf.byteOffset + buf.byteLength) as ArrayBuffer;
}

let failures = 0;
let passed = 0;
function check(name: string, fn: () => boolean | string): void {
  let ok: boolean | string;
  try {
    ok = fn();
  } catch (e) {
    ok = `threw ${(e as Error).stack ?? String(e)}`;
  }
  if (ok === true) {
    passed++;
    console.log(`PASS  ${name}`);
  } else {
    failures++;
    console.log(`FAIL  ${name}  ->  ${typeof ok === 'string' ? ok : 'assertion returned false'}`);
  }
}

// ---------------------------------------------------------------- load data

const itemsJson = readJson('data/items.json') as { items: unknown[] };
const blockMeta = readJson('public/mc/blocks.json') as never;
const tags = readJson('public/mc/tags.json');
const recipes = readJson('public/mc/recipes.json');
const lootJson = readJson('public/mc/loot.json');
const lang = readJson('public/mc/lang/en_us.json');

const mc = new MinecraftData();
mc.initMeta(blockMeta);
mc.initBinary(readArrayBuffer('public/mc/blocks.bin'));

const worldData: WorldData = { items: itemsJson, tags, recipes, loot: lootJson, lang };
setWorldData(worldData);

const SEED = 0x2602c0den;
const s = new SurvivalState(mc, SEED, worldData);
const R = s.registry;
const st = (n: string, c = 1): ItemStack => new ItemStack(R.byName(n)!, c);
const S = (n: string): number => mc.stateOf(n);
const fmtDrops = (xs: ItemStack[]): string => xs.map((x) => `${x.item!.name}x${x.count}`).join(',') || '(none)';
const grid = (w: number, h: number, cells: (ItemStack | null)[]) => ({
  getWidth: () => w, getHeight: () => h,
  getItems: () => cells.map((c) => c ?? ItemStack.EMPTY),
});
const E = ItemStack.EMPTY;

console.log('==== items / inventory / crafting / survival test suite ====');
console.log(`items.json=${(itemsJson as { items: unknown[] }).items.length}  blocks=${mc.blocks.length}  recipes=${s.recipeManager.recipeCount()}  loot tables=${s.loot.tableCount()}`);

// ---------------------------------------------------------------- 1. shapeless

check('1. oak_log -> oak_planks x4 (shapeless, recipe exists + result)', () => {
  const def = s.recipeManager.getRecipeById('minecraft:oak_planks');
  if (!def || !(def instanceof ShapelessRecipe)) return `recipe missing or wrong type: ${def?.id}`;
  const result = def.assemble(R);
  if (result.item?.name !== 'oak_planks' || result.count !== 4) return `bad result ${fmtDrops([result])}`;
  const g = grid(3, 3, [st('oak_log'), null, null, null, null, null, null, null, null]);
  const matched = s.recipeManager.getRecipeFor(g);
  if (!matched || matched.id !== 'minecraft:oak_planks') return `grid did not match: ${matched?.id ?? 'none'}`;
  const assembled = matched.assemble(R);
  return assembled.item?.name === 'oak_planks' && assembled.count === 4 ? true : `grid result ${fmtDrops([assembled])}`;
});

// ---------------------------------------------------------------- 2. shaped

check('2. stick + iron_ingot 3x3 -> iron_pickaxe (mirror / offset / invalid)', () => {
  const def = s.recipeManager.getRecipeById('minecraft:iron_pickaxe');
  if (!(def instanceof ShapedRecipe)) return `recipe missing or wrong type: ${def?.id}`;
  const iron = () => st('iron_ingot');
  const stick = () => st('stick');
  // Valid: XXX /  #  /  #
  const valid = grid(3, 3, [iron(), iron(), iron(), null, stick(), null, null, stick(), null]);
  const rValid = s.recipeManager.getRecipeFor(valid);
  if (!rValid || rValid.assemble(R).item?.name !== 'iron_pickaxe') return `valid grid -> ${rValid?.id ?? 'none'}`;
  // Invalid: right items, wrong shape (column of ingots).
  const invalid = grid(3, 3, [iron(), stick(), null, iron(), stick(), null, iron(), null, null]);
  const rInvalid = s.recipeManager.getRecipeFor(invalid);
  if (rInvalid && rInvalid.assemble(R).item?.name === 'iron_pickaxe') return 'invalid grid produced iron_pickaxe';
  // Offset: the 1x2 `stick` recipe placed in the right column of a 3x3 grid.
  const oak = () => st('oak_planks');
  const offset = grid(3, 3, [null, null, oak(), null, null, oak(), null, null, null]);
  const rOffset = s.recipeManager.getRecipeFor(offset);
  if (!rOffset || rOffset.assemble(R).item?.name !== 'stick') return `offset grid -> ${rOffset?.assemble(R).item?.name ?? 'none'}`;
  // Mirror: non-symmetric acacia_stairs pattern, normal and horizontally flipped.
  const acacia = () => st('acacia_planks');
  const normal = grid(3, 3, [acacia(), null, null, acacia(), acacia(), null, acacia(), acacia(), acacia()]);
  const mirrored = grid(3, 3, [null, null, acacia(), null, acacia(), acacia(), acacia(), acacia(), acacia()]);
  const rNormal = s.recipeManager.getRecipeFor(normal);
  const rMirror = s.recipeManager.getRecipeFor(mirrored);
  if (!rNormal || !rMirror) return `stairs grid -> normal ${rNormal?.id ?? 'none'} mirror ${rMirror?.id ?? 'none'}`;
  if (rNormal.assemble(R).item?.name !== rMirror.assemble(R).item?.name) return 'mirror produced a different item';
  if (!rNormal.assemble(R).item!.name.endsWith('_stairs')) return `unexpected stairs result ${rNormal.assemble(R).item?.name}`;
  return true;
});

// ---------------------------------------------------------------- 3. mining

check('3. diamond_pickaxe mining progress vs bare hand / dirt / tool tier', () => {
  const dp = st('diamond_pickaxe');
  const pDpStone = BlockBreaking.getDestroyProgress(S('stone'), dp, mc);
  const pBareStone = BlockBreaking.getDestroyProgress(S('stone'), null, mc);
  const pDpDirt = BlockBreaking.getDestroyProgress(S('dirt'), dp, mc);
  const pWoodDiamond = BlockBreaking.getDestroyProgress(S('diamond_ore'), st('wooden_pickaxe'), mc);
  // Vanilla 26.2: modifier 30 (correct tool) / 100 (wrong tool), tool speed only
  // on mineable/* blocks, so a pickaxe is faster on stone than on dirt.
  if (!(pDpStone > pBareStone)) return `dp/stone ${pDpStone} !> bare/stone ${pBareStone}`;
  if (!(pDpStone > pDpDirt)) return `dp/stone ${pDpStone} !> dp/dirt ${pDpDirt}`;
  if (!(pBareStone > 0 && pWoodDiamond > 0)) return 'non-positive progress';
  if (!BlockBreaking.hasCorrectToolForDrops(S('stone'), dp, mc)) return 'dp not correct for stone';
  if (BlockBreaking.hasCorrectToolForDrops(S('diamond_ore'), st('wooden_pickaxe'), mc)) return 'wooden pickaxe correct for diamond_ore';
  // underwater / airborne / efficiency modifiers from Player.getDestroySpeed.
  const underwater = BlockBreaking.getDestroyProgress(S('stone'), dp, mc, true);
  const airborne = BlockBreaking.getDestroyProgress(S('stone'), dp, mc, false, false);
  const efficiency = BlockBreaking.getDestroyProgress(S('stone'), dp, mc, false, true, 3);
  if (!(underwater < pDpStone && airborne < pDpStone && efficiency > pDpStone)) {
    return `modifiers wrong: uw=${underwater} air=${airborne} eff=${efficiency} base=${pDpStone}`;
  }
  return true;
});

// ---------------------------------------------------------------- 4. drops

check('4. stone -> cobblestone, grass_block -> dirt, silk_touch -> stone', () => {
  const dp = st('diamond_pickaxe');
  const silk = new ItemStack(R.byName('diamond_pickaxe')!, 1, { enchantments: { silk_touch: 1 } });
  const stone = BlockBreaking.getDrops(S('stone'), dp, s.loot, mc);
  if (fmtDrops(stone) !== 'cobblestonex1') return `stone with pickaxe -> ${fmtDrops(stone)}`;
  const grass = BlockBreaking.getDrops(S('grass_block'), null, s.loot, mc);
  if (fmtDrops(grass) !== 'dirtx1') return `grass_block -> ${fmtDrops(grass)}`;
  const silkStone = BlockBreaking.getDrops(S('stone'), silk, s.loot, mc);
  if (fmtDrops(silkStone) !== 'stonex1') return `stone with silk_touch -> ${fmtDrops(silkStone)}`;
  // Tool tier: wooden pickaxe cannot harvest diamond_ore.
  const wrongTier = BlockBreaking.getDrops(S('diamond_ore'), st('wooden_pickaxe'), s.loot, mc);
  if (wrongTier.length !== 0) return `wooden pickaxe on diamond_ore -> ${fmtDrops(wrongTier)}`;
  const rightTier = BlockBreaking.getDrops(S('diamond_ore'), dp, s.loot, mc);
  if (fmtDrops(rightTier) !== 'diamondx1') return `diamond pickaxe on diamond_ore -> ${fmtDrops(rightTier)}`;
  return true;
});

// ---------------------------------------------------------------- 5. furnace

check('5. furnace: raw_iron + coal -> iron_ingot (burn time / cook time)', () => {
  const furnace = s.openFurnace();
  furnace.container.setItem(0, st('raw_iron', 1));
  furnace.container.setItem(1, st('coal', 1));
  const recipe = s.recipeManager.getSmeltingRecipe(st('raw_iron', 1));
  if (!(recipe instanceof CookingRecipe)) return 'no smelting recipe for raw_iron';
  if (recipe.cookingTime !== 200) return `cookingTime ${recipe.cookingTime} (expected 200 from recipes.json)`;
  if (recipe.assemble(R).item?.name !== 'iron_ingot') return `smelting result ${recipe.assemble(R).item?.name}`;
  furnace.tick();
  if (furnace.getLitTotalTime() !== 1600) return `coal burn time ${furnace.getLitTotalTime()} (expected 1600)`;
  if (furnace.getCookingTotalTime() !== recipe.cookingTime) return `cook total ${furnace.getCookingTotalTime()}`;
  for (let i = 1; i < 205; i++) furnace.tick();
  const result = furnace.container.getItem(2);
  if (fmtDrops([result]) !== 'iron_ingotx1') return `furnace output ${fmtDrops([result])}`;
  if (!furnace.container.getItem(1).isEmpty()) return 'coal was not consumed';
  return true;
});

// ---------------------------------------------------------------- 6. inventory

check('6. PlayerInventory add / overflow / quickMove / split / slot numbering', () => {
  const s6 = new SurvivalState(mc, 6n, worldData);
  const inv = s6.inventory;
  const menu = s6.inventoryMenu;
  // Slot numbering from Inventory.java / InventoryMenu.java.
  if (menu.getSlot(9).getContainerSlot() !== 9) return 'menu slot 9 != container slot 9';
  if (menu.getSlot(36).getContainerSlot() !== 0) return 'menu slot 36 != hotbar container slot 0';
  if (menu.getSlot(45).getContainerSlot() !== 40) return 'menu slot 45 != offhand container slot 40';
  if (menu.getSlot(5).getContainerSlot() !== 39) return 'menu slot 5 != HEAD container slot 39';
  if (inv.getContainerSize() !== 43) return `container size ${inv.getContainerSize()} (expected 43)`;
  // add + overflow.
  if (!inv.add(st('stone', 40)) || inv.getItem(0).count !== 40) return 'first add(40) failed';
  if (!inv.add(st('stone', 40))) return 'second add(40) returned false';
  if (inv.getItem(0).count !== 64 || inv.getItem(1).count !== 16) {
    return `overflow wrong: slot0=${inv.getItem(0).count} slot1=${inv.getItem(1).count}`;
  }
  // Full inventory: no free slot -> add returns false.
  const inv2 = new SurvivalState(mc, 7n, worldData).inventory;
  for (let i = 0; i < 36; i++) inv2.setItem(i, st('stone', 64));
  if (inv2.add(st('dirt', 1))) return 'add to a full inventory returned true';
  // split (right-click PICKUP): 10 -> carried 5 + slot 5.
  const s6b = new SurvivalState(mc, 8n, worldData);
  const m6b = s6b.inventoryMenu;
  s6b.inventory.setItem(9, st('oak_planks', 10)); // menu slot 9 == container slot 9
  m6b.clicked(9, 1, ContainerInput.PICKUP, s6b);
  if (m6b.getCarried().count !== 5 || s6b.inventory.getItem(9).count !== 5) {
    return `split wrong: carried=${m6b.getCarried().count} slot=${s6b.inventory.getItem(9).count}`;
  }
  // quickMove (shift-click): hotbar slot 0 -> main inventory.
  const s6c = new SurvivalState(mc, 9n, worldData);
  s6c.inventory.setItem(0, st('cobblestone', 7));
  s6c.inventoryMenu.clicked(36, 0, ContainerInput.QUICK_MOVE, s6c);
  if (s6c.inventory.getItem(0).count !== 0) return 'quickMove left items in hotbar slot 0';
  if (s6c.inventory.getItem(9).count !== 7) return `quickMove landed in slot 9 with ${s6c.inventory.getItem(9).count}`;
  return true;
});

// ---------------------------------------------------------------- 7. hunger

check('7. hunger exhaustion over 1000 sprint+jump ticks / starvation damage', () => {
  const s7 = new SurvivalState(mc, 10n, worldData);
  let sawExhaustionConsumed = false;
  for (let i = 0; i < 1000; i++) {
    s7.tick({ sprint: true, jumped: true, swam: false });
    if (s7.hunger < 20) sawExhaustionConsumed = true;
  }
  if (!sawExhaustionConsumed) return 'food level never dropped (exhaustion not consumed)';
  if (!(s7.hunger < 20)) return `hunger still ${s7.hunger}`;
  if (!(s7.hunger === 0)) return `expected foodLevel 0 at 1000 ticks, got ${s7.hunger}`;
  if (!(s7.health < 20)) return `no starvation damage: health ${s7.health}`;
  if (!(s7.health >= 1)) return `starvation overshot the NORMAL floor (1 HP): health ${s7.health}`;
  return true;
});

// ---------------------------------------------------------------- 8. determinism

function fingerprint(seed: bigint): string {
  const state = new SurvivalState(mc, seed, worldData);
  const fortune = new ItemStack(R.byName('diamond_pickaxe')!, 1, { enchantments: { fortune: 3 } });
  const parts: string[] = [];
  for (const block of ['coal_ore', 'diamond_ore', 'gravel', 'stone', 'grass_block', 'oak_leaves']) {
    for (let i = 0; i < 6; i++) parts.push(fmtDrops(BlockBreaking.getDrops(S(block), fortune, state.loot, mc)));
  }
  // Also exercise the raw-fallback interpreter (oak_leaves has multiple_pools).
  return parts.join('|');
}

check('8. same seed twice -> identical loot sequence (deterministic)', () => {
  const a = fingerprint(SEED);
  const b = fingerprint(SEED);
  if (a !== b) return `mismatch:\n A=${a.slice(0, 200)}\n B=${b.slice(0, 200)}`;
  // A different seed should (very likely) diverge on the random tables.
  const c = fingerprint(SEED + 1n);
  if (a === c) return 'different seed produced the same sequence (random not wired to seed)';
  return true;
});

// ---------------------------------------------------------------- bonus: remaining items / raw fallback

check('bonus. getRemainingItems returns buckets; raw fallback yields a drop', () => {
  const input = new CraftingInput(3, 3, [
    st('water_bucket'), E, E,
    st('milk_bucket'), E, E,
    E, E, E,
  ]);
  const remaining = s.recipeManager.getRemainingItems(input);
  const names = remaining.filter((x) => !x.isEmpty()).map((x) => x.item!.name);
  if (names.length !== 2 || names.some((n) => n !== 'bucket')) return `remaining items: ${names.join(',')}`;
  // raw fallback (oak_leaves: multiple_pools) still yields something with shears/silk.
  const shears = st('shears');
  const leaves = BlockBreaking.getDrops(S('oak_leaves'), shears, s.loot, mc);
  if (leaves.length === 0) return 'raw fallback produced no drops';
  return true;
});

// ---------------------------------------------------------------- performance

function bench(): void {
  const t0 = performance.now();
  const rm = new RecipeManager(recipes, R);
  const t1 = performance.now();
  const lt = new LootTable(lootJson, R, new XoroshiroRandomSource(SEED));
  const t2 = performance.now();

  // Recipe lookups: valid iron_pickaxe grid + invalid grid, alternating.
  const iron = () => st('iron_ingot');
  const stick = () => st('stick');
  const gValid = grid(3, 3, [iron(), iron(), iron(), null, stick(), null, null, stick(), null]);
  const gBad = grid(3, 3, [stick(), stick(), stick(), null, iron(), null, null, iron(), null]);
  const N = 20000;
  const r0 = performance.now();
  for (let i = 0; i < N; i++) rm.getRecipeFor(i & 1 ? gBad : gValid);
  const r1 = performance.now();

  // Loot lookups.
  const dp = st('diamond_pickaxe');
  const ctx = {
    blockName: 'stone', silkTouch: false, fortune: 0,
    hasCorrectTool: true, requiresTool: true, exploded: false, tool: 'diamond_pickaxe',
  };
  const l0 = performance.now();
  for (let i = 0; i < N; i++) lt.getDrops('stone', ctx);
  const l1 = performance.now();
  const p0 = performance.now();
  for (let i = 0; i < N; i++) BlockBreaking.getDestroyProgress(S('stone'), dp, mc);
  const p1 = performance.now();

  console.log('---- performance ----');
  console.log(`RecipeManager build: ${(t1 - t0).toFixed(1)} ms (${rm.recipeCount()} recipes, inverted index ${rm.craftingIndexSize()} keys)`);
  console.log(`LootTable build:     ${(t2 - t1).toFixed(1)} ms (${lt.tableCount()} tables)`);
  console.log(`getRecipeFor:        ${((r1 - r0) * 1000 / N).toFixed(2)} us/lookup over ${N} calls, cache=${rm.cacheSize()} entries`);
  console.log(`LootTable.getDrops:  ${((l1 - l0) * 1000 / N).toFixed(2)} us/lookup over ${N} calls`);
  console.log(`getDestroyProgress:  ${((p1 - p0) * 1000 / N).toFixed(2)} us/call over ${N} calls`);
}

bench();

console.log('--------------------------------------------------------');
console.log(`${passed} passed, ${failures} failed`);
if (failures > 0) process.exit(1);
