# Feature Inventory（自动生成）

> 生成时间：2026-11-21T12:09:30.036Z
> 本项目：`webcraft26`
> Horizon：`horizon-main`
> 这个文件只回答“有什么/在哪里”，不证明行为一致；行为对照见 `REPORTS/HORIZON-COVERAGE-2026-11-21.md`。

## 1. 规模对比

| 维度 | webcraft26 | Horizon |
|---|---:|---:|
| crate 数 | — | 75 |
| Rust/TS 源文件 | 54（renderer+screens） | 6218 |
| 实体类型 | 158 | 90（Species） |
| 非 MISC 实体类型 | 86 | — |
| 已实现 mob 工厂 | 35 | 90（Species） |
| 工厂总数（含 item/XP/arrow） | 38 | — |
| 屏幕文件 | 22 | 33（interface 相关） |
| 地形 feature | 26 | 83（worldgen 模块） |
| 结构模块 | 2 | 见 worldgen（2 个相关） |
| 方块 / 物品 | 1196 / 1537 | 由 assets 提供（运行时读取） |
| 音效事件 | 1012 | 由 sounds.json/assets 提供 |
| 音乐/唱片事件 | 31 | 完整 MusicManager |
| 测试文件 | 28 | 995 |

## 2. 我们注册了但还没有 factory 的 mob

- `allay`
- `armadillo`
- `axolotl`
- `bee`
- `blaze`
- `breeze`
- `camel`
- `camel_husk`
- `creaking`
- `dolphin`
- `donkey`
- `elder_guardian`
- `ender_dragon`
- `endermite`
- `evoker`
- `frog`
- `ghast`
- `giant`
- `goat`
- `guardian`
- `happy_ghast`
- `hoglin`
- `horse`
- `illusioner`
- `llama`
- `mule`
- `nautilus`
- `panda`
- `phantom`
- `piglin`
- `piglin_brute`
- `pillager`
- `polar_bear`
- `pufferfish`
- `ravager`
- `shulker`
- `skeleton_horse`
- `sniffer`
- `strider`
- `sulfur_cube`
- `tadpole`
- `trader_llama`
- `tropical_fish`
- `turtle`
- `vex`
- `vindicator`
- `wandering_trader`
- `warden`
- `wither`
- `zoglin`
- `zombie_horse`
- `zombie_nautilus`

## 3. Horizon 有、我们 EntityType 表里没有的物种

- （无）

## 4. 我们的 factory 不在 Horizon Species 里的（非 mob 或命名差异）

- `tnt`

## 5. 我们的屏幕

- `src/client/gui/screens/ChatScreen.ts`
- `src/client/gui/screens/CreateWorldScreen.ts`
- `src/client/gui/screens/DeathScreen.ts`
- `src/client/gui/screens/OptionsScreen.ts`
- `src/client/gui/screens/PauseScreen.ts`
- `src/client/gui/screens/Screen.ts`
- `src/client/gui/screens/SelectWorldScreen.ts`
- `src/client/gui/screens/TitleScreen.ts`
- `src/client/gui/screens/container/AbstractContainerScreen.ts`
- `src/client/gui/screens/inventory/AbstractContainerScreen.ts`
- `src/client/gui/screens/inventory/ChestScreen.ts`
- `src/client/gui/screens/inventory/CraftingScreen.ts`
- `src/client/gui/screens/inventory/CreativeModeInventoryScreen.ts`
- `src/client/gui/screens/inventory/FurnaceScreen.ts`
- `src/client/gui/screens/inventory/InventoryScreen.ts`
- `src/client/gui/screens/inventory/SlotLayout.ts`
- `src/client/gui/screens/options/ControlsScreen.ts`
- `src/client/gui/screens/options/LanguageSelectScreen.ts`
- `src/client/gui/screens/options/OptionsSubScreen.ts`
- `src/client/gui/screens/options/SoundOptionsScreen.ts`
- `src/client/gui/screens/options/VideoSettingsScreen.ts`
- `src/client/gui/screens/recipebook/RecipeBookComponent.ts`

## 6. Horizon 的界面/屏幕相关模块

- `advancements_screen`
- `block_screen_effect_draw_tests`
- `chat`
- `chat_filter`
- `container_layout`
- `creative_screen`
- `guest_advancement_tests`
- `hud_editor`
- `hud_render`
- `hud_room`
- `inventory_changed_tests`
- `inventory_input`
- `inventory_slots`
- `menu_clicks`
- `mount_menu`
- `mount_menu_reach_tests`
- `music`
- `native_client_screens`
- `native_screenshot_request`
- `pad_menu`
- `screen_backgrounds`
- `screen_build`
- `screen_build_fixture`
- `screen_info`
- `screen_render_phase_tests`
- `screen_room`
- `screens`
- `screenshot_writer`
- `startup_menu`
- `stats`
- `stats_screen`
- `subtitle_hud`
- `subtitles`

## 7. Horizon title 模块（世界选择/创建/编辑）

- `buffet`
- `confirm_experiments`
- `create_world`
- `draw`
- `draw_cursor_tests`
- `edit_world`
- `edit_world_tests`
- `experiments`
- `flat`
- `missing_biome_regions`
- `missing_biome_regions_tests`
- `missing_mods`
- `missing_mods_tests`
- `onboarding`
- `preset_buttons`
- `preset_editors`
- `preset_tests`
- `splash`
- `tests`
- `world_folder`
- `world_management`
- `world_request_tests`
- `world_toast`

## 8. 我们的地形 feature 模块

- `bamboo`
- `block_blob`
- `block_column`
- `block_pile`
- `cactus`
- `columns`
- `disk`
- `flower`
- `freeze_top_layer`
- `index`
- `kelp`
- `lake`
- `no_op`
- `ore`
- `random_boolean_selector`
- `random_patch`
- `random_selector`
- `seagrass`
- `sequence`
- `shared`
- `simple_block`
- `simple_random_selector`
- `spring_feature`
- `sugar_cane`
- `tree`
- `weighted_random_selector`

## 9. Horizon worldgen 模块

- `anchor`
- `aquifer`
- `bamboo`
- `biome`
- `biome_chunk`
- `biome_chunks`
- `biome_predicate`
- `biome_source`
- `biome_temperature`
- `biome_weather`
- `blending`
- `block_blob`
- `block_column`
- `block_feature`
- `block_pile`
- `block_predicate`
- `blue_ice`
- `bonus_chest`
- `bulk_section`
- `carver`
- `carving`
- `cave`
- `chorus_plant`
- `climate`
- `decoration`
- `decoration_order`
- `delta`
- `density`
- `disk`
- `dripstone`
- `end_gateway`
- `end_podium`
- `end_spike`
- `feature`
- `feature_catalog`
- `feature_graph`
- `feature_region`
- `feature_sort`
- `fluid_predicate`
- `fungus`
- `generator`
- `generator_blocks`
- `generator_decoration`
- `generator_structures`
- `height_provider`
- `iceberg`
- `live`
- `long_set`
- `material_condition`
- `material_extensions`
- `material_stage`
- `material_surface`
- `mod_biome_sources`
- `mod_density_functions`
- `mod_generators`
- `ore_feature`
- `overrides`
- `placement`
- `projected`
- `replace_blobs`
- `root_system`
- `router`
- `rule_test`
- `sculk`
- `settings`
- `simple_block`
- `snow_freeze`
- `spawn_finder`
- `speleothem`
- `spike`
- `spring`
- `state_provider`
- `structure`
- `tags`
- `terrain`
- `tree`
- `tree_blocks`
- `underwater_magma`
- `value_provider`
- `vegetation`
- `vines`
- `weighted`
- `write_zone`

## 10. 音效

- 事件总数：1012
- music/record 事件：31
- `music.creative`
- `music.credits`
- `music.dragon`
- `music.end`
- `music.game`
- `music.menu`
- `music.nether.basalt_deltas`
- `music.nether.crimson_forest`
- `music.nether.nether_wastes`
- `music.nether.soul_sand_valley`
- `music.overworld.badlands`
- `music.overworld.bamboo_jungle`
- `music.overworld.cherry_grove`
- `music.overworld.deep_dark`
- `music.overworld.desert`
- `music.overworld.dripstone_caves`
- `music.overworld.flower_forest`
- `music.overworld.forest`
- `music.overworld.frozen_peaks`
- `music.overworld.grove`
- `music.overworld.jagged_peaks`
- `music.overworld.jungle`
- `music.overworld.lush_caves`
- `music.overworld.meadow`
- `music.overworld.old_growth_taiga`
- `music.overworld.snowy_slopes`
- `music.overworld.sparse_jungle`
- `music.overworld.stony_peaks`
- `music.overworld.sulfur_caves`
- `music.overworld.swamp`
- `music.under_water`

## 11. 测试入口

- `scripts/test-ambience.mjs`
- `scripts/test-ao.mjs`
- `scripts/test-audio-particles.mts`
- `scripts/test-biomecolors.mts`
- `scripts/test-chunkunload.mts`
- `scripts/test-containers.mjs`
- `scripts/test-entities.mts`
- `scripts/test-features.mts`
- `scripts/test-fog.mts`
- `scripts/test-glmath.mts`
- `scripts/test-gui.mts`
- `scripts/test-hud-dirty.mjs`
- `scripts/test-hud.mts`
- `scripts/test-icons.mjs`
- `scripts/test-items.mts`
- `scripts/test-lightengine.mts`
- `scripts/test-lighting.mts`
- `scripts/test-menu.mjs`
- `scripts/test-mesher.mts`
- `scripts/test-mobs-render.mts`
- `scripts/test-placement.mts`
- `scripts/test-save.mts`
- `scripts/test-spawn.mts`
- `scripts/test-structures.mts`
- `scripts/test-survival.mts`
- `scripts/test-taa.mjs`
- `scripts/test-touch.mjs`
- `scripts/test-worldgen.mts`
