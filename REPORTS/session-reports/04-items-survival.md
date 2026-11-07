# 物品 / 背包 / 容器 / 合成 / 生存数值报告

30 个文件，全部在写入边界内；`scripts/test-items.mts` 9 项断言全绿。

## 文件与 Java 来源

`world/item/**`：`Item.ts`(`Item`/`Items`/`BuiltInRegistries.ITEM`)、`ItemStack.ts`、
`ItemCooldowns.ts`、`UseOnContext.ts`、`MiningTool.ts`(`Tool`/`isCorrectToolForDrops`/`BlockTags`)、
`ArmorItem.ts`、`FoodItem.ts`、`crafting/Recipe.ts`(`Ingredient`/`ShapedRecipePattern`/
`ShapedRecipe`/`ShapelessRecipe`/`AbstractCookingRecipe`/`StonecutterRecipe`/`SmithingRecipe`)、
`crafting/RecipeManager.ts`。

`world/inventory/**`：`Container`, `Slot`, `ClickAction`, `MenuType`, `ResultContainer`,
`CraftingContainer`, `AbstractContainerMenu`, `AbstractCraftingMenu`, `InventoryMenu`,
`CraftingMenu`, `AbstractFurnaceMenu`(+`FuelValues`), `FurnaceMenu`, `ChestMenu`, `CreativeInventory`。

其余：`world/entity/player/Inventory.ts`、`world/food/FoodData.ts`、
`world/level/block/BlockBreaking.ts`（`BlockBehaviour.getDestroyProgress` /
`Player.getDestroySpeed` / `Block.dropResources`）、
`world/level/storage/loot/LootTable.ts`、`gameplay/SurvivalState.ts`。

## 测试输出

```
items.json=1537  blocks=1196  recipes=1521  loot tables=1113
PASS  1  oak_log -> oak_planks x4 (shapeless)
PASS  2  stick + iron_ingot 3x3 -> iron_pickaxe (mirror / offset / invalid)
PASS  3  diamond_pickaxe mining progress vs bare hand / dirt / tool tier
PASS  4  stone -> cobblestone, grass_block -> dirt, silk_touch -> stone
PASS  5  furnace: raw_iron + coal -> iron_ingot (burn 1600 tick, cook 200)
PASS  6  PlayerInventory add / overflow / quickMove / split / slot numbering
PASS  7  hunger exhaustion over 1000 sprint+jump ticks / starvation damage
PASS  8  same seed twice -> identical loot sequence
PASS  bonus  getRemainingItems returns buckets; raw fallback yields a drop
---- performance ----
RecipeManager build: 24.5 ms (1521 recipes, inverted index 515 keys)
LootTable build:     1.3 ms  (1113 tables)
getRecipeFor:        2.05 us/lookup (20000 calls)
LootTable.getDrops:  0.80 us/lookup
getDestroyProgress:  0.65 us/call
9 passed, 0 failed
```

## 一处与原版常识相反但正确的结论

任务书原以为「镐挖泥土比挖石头快」，**原版并不成立**：26.2 的 `Tool` 组件只对
`mineable/*` 标签内方块给速度加成，镐挖泥土 speed=1，挖石头 speed=8，
所以 `dp/stone=0.1778 > dp/dirt=0.0667`，而徒手挖石头仅 `0.00667`。
`getDestroyProgress` 严格按 `BlockBehaviour`：`speed / hardness / (correctTool ? 30 : 100)`，
并覆盖 underwater×0.2、空中÷5、efficiency。测试断言按原版真实关系修正。

## 集成接口

```ts
await loadWorldData('/mc');                     // tags / recipes / loot / lang
const survival = new SurvivalState(mc, BigInt(seed));
survival.onDrop = stack => /* ItemEntity(level, x,y,z, stack) */;

// 每游戏 tick
survival.tick({ sprint, jumped, swam });
survival.mine(1, state, inWater);              // true 时：
survival.breakBlock(stateAt, x,y,z);           // -> ItemStack[]
survival.inventory.add(...);

// 容器
menu.clicked(slotIndex, button, ContainerInput.PICKUP|QUICK_MOVE|SWAP|CLONE|THROW|QUICK_CRAFT|PICKUP_ALL, survival);
survival.openInventory() / openCraftingTable() / openFurnace() / openChest(rows);

// HUD
survival.hotbarStacks();   // {item,count,damage}[]
survival.health / hunger / saturation / level / experience;
survival.damage(n, source); survival.addExperience(n);
```

## 简化项

1. 64 条 `crafting_special_*` / transmute / bannerduplicate / firework 等未纳入索引。
2. 熔炉 `cookingTime` 直接取 `recipes.json`（全为 200；原版 blasting/smoking=100、campfire=600 未覆盖）；经验取整用 `floor` 保确定性。
3. `LootTable.raw` 回退是最小子集：条目 `item`/`alternatives`/`group`/`sequence`，条件 `survives_explosion`/`match_tool`/`inverted`/`any_of`/`all_of`/`random_chance`/`table_bonus`，函数 `set_count`/`apply_bonus`/`limit_count`/`explosion_decay`；未知条件按「通过」处理。
4. 未实现状态效果系统（Haste / Mining Fatigue）；`hasEfficiency` 视为属性加成。
5. `PlayerInventory.hurtArmor` 简化为 4 槽按 `max(1, floor(dmg/4))` 掉耐久。
6. `AbstractContainerMenu` 省略网络同步器 / RemoteSlot / `PICKUP_ALL` 对 carried 的处理；`ItemStack` 组件仅 damage/customName/enchantments/unbreakable。
7. `public/mc/items.json` 实际不存在；1,537 条物品在 `blocks.json` 的 `.items` 与 `data/items.json`，注册表由 `mc.items` 构建。
