# Minecraft 26.2 原版 blockstate / model 全量盘点（webcraft26 · M1a）

复现方式：`python research/inventory.py`（只读脚本，不写 src/scripts/public）。
产物：`research/blockstate-inventory.json`（机器可读，烘焙校验用）、`research/_inventory_dump.txt`（本报告全部数字的原始输出行）、`research/_multipart_complex.json`（3 个最复杂 multipart 文件的完整 condition 树）。
数据源：`<MC_ASSETS>\{blockstates,models,textures}` + `src-vanilla`。
文法出处（不是 wiki 记忆，是本机反编译源码）：
`net/minecraft/client/renderer/block/dispatch/BlockStateModelDispatcher.java`、`BlockStateModel.java`、`Variant.java`、`VariantSelector.java`、`multipart/{Condition,CombinedCondition,KeyValueCondition,Selector,MultiPartModel}.java`、
`net/minecraft/client/resources/model/{BlockStateModelLoader,ResolvedModel,UnbakedModel}.java`、`sprite/TextureSlots.java`、`cuboid/{CuboidModel,CuboidModelElement,CuboidFace,CuboidRotation,UnbakedCuboidGeometry,FaceBakery}.java`。

## 0. 先验核对（实测 vs 任务给的先验）

| 项 | 先验 | 实测 | 来源 |
|---|---|---|---|
| blockstates 总数 | 1198 | **1198** | `meta.counts.blockstate_files` |
| variant / multipart | 1096 / 102 | **1096 / 102**，两者都不有的文件 0 | `_inventory_dump.txt:2` |
| block models | 2657 | **2657**（另 models/item 1271） | `meta.counts.block_models` / `item_models` |
| items/*.json | 1537 | **1537** | `meta.counts.items_json_files` |
| 贴图 | 1269 | **1269** 张 `textures/block/*.png`（+102 个 `.png.mcmeta`） | `meta.counts.textures_block_png` / `_mcmeta` |
| 元素/面 | ≈1183/4227 | **block 模型 1183 元素 / 4227 面**（先验精确成立；block+item 合计 1185/4238，item 侧只有 1 个模型带 2 元素/11 面） | `meta.counts.declared_geometry_by_class` |
| multipart 用 weight | 假设常用 | **variants 里 weight 出现 0 次**；multipart apply 里仅 6 次、值恒为 2、只在 `chorus_plant.json` | `variant_value_fields.weight_values={}` |
| condition 有 INVERT | 假设存在 | **0 次**；26.2 的 `CombinedCondition.Operation` 枚举只有 AND/OR | `Condition.java` |
| public/mc 贴图 | 103 | **manifest.json 103 条**（磁盘 163 个 .png 是动画拆帧）；闭包需 1230 → **缺 1137** | `texture_closure.project` |

结论：先验基本准确，但 **weight / INVERT 两个假设是错的**，`face.uvlock` / `face.uvscale` 也**在 26.2 不存在**（下文 §4.3）。

## 1. 影响复刻正确性排序的结论（先看这 12 条）

1. **变体键是"谓词"而不是"枚举串"**：`VariantSelector.predicate()` 把键按 `,`/第一个 `=` 拆成 property→value map，再对 `StateDefinition.getPossibleStates()` 全量过滤；同一状态被两个键命中 → `IllegalArgumentException("Overlapping definition on state")`。所以新管线的 blockstate 表必须做成"完全划分"，不能靠 first-match 兜底。实测 1096 个文件的键集 **100% 等于其属性域的笛卡尔积**（`cartesian_incomplete_count = 0`），所以枚举时按域做积即可，无需处理偏键。
2. **blockstate 文件名必须等于方块 registry 名**，否则整文件被忽略（`BlockStateModelLoader`: "Discovered unknown block state definition … ignoring"）。实测 1196 个注册方块 **全部**有 blockstate 文件；只有 `item_frame.json`/`glow_item_frame.json` 反过来没有方块（§6）。
3. **几何是从父链借来的**：只有 **343 个 block 模型自己声明 elements**，其余靠 `ResolvedModel.findTopGeometry()`（第一个非空 elements 的祖先）。`block/cube` 一个元素供 **408 个叶子模型**复用。烘焙器必须实现几何继承，否则 2000+ 模型烘出空网格。
4. **纹理槽继承 + `#引用`不动点解析是唯一的默认纹理规则**：`TextureSlots.Resolver` 先 root 后 child 合并（child 覆盖 parent），`#slot` 迭代解析到不动点；实测 **2883 次面纹理变量由父模型补齐**（`cube_all` 1740 次、`cube_column` 456 次…），**悬空引用 0 例**。合并顺序一旦写反（child 先）就会立刻把 cube_all 的子模型全变 missingno——这是当前 `build-assets.mjs` 最容易踩的坑（它的 merge 顺序正确，但没有做 `#` 的不动点迭代，只支持一层 `#all`）。
5. **59 个被 blockstate 引用的模型整条父链没有 elements**（`blockstate_multipart.models_without_geometry`）：`air / water / lava / banner / skull / chest / ender_chest / trapped_chest / 17 个 shulker_box / conduit / decorated_pot / end_portal / end_gateway / barrier / structure_void / moving_piston / light_00..15 / pitcher_crop_top_stage_* / copper_chest / copper_golem_statue`。这些只有 `textures.particle`，几何由特殊渲染器程序化生成 → 立方体烘焙器对它们**必须显式走特例**，不能当"空模型" silently 生成 0 quad（`block/water` 就是本项目现在靠 `custom` 绕开的那类）。
6. **multipart 不是"可选高级特性"，而是 102 个文件 / 1132 条目的主干**：栅栏 13、玻璃板 17、墙 32、铁栏杆类 bars 9、红石线、火、藤蔓、菌丝、chorus_plant、pale_moss_carpet、bamboo、brewing_stand、composter、shelf 12、chiseled_bookshelf。`apply` 可以是**数组**（fire/soul_fire/chorus_plant/bamboo 共 19 处）→ 语义是"数组内**随机选 1 个**"（走 `WeightedVariants`），不是叠加；当前脚本直接 `throw`。
7. **随机变体不用 weight，靠重复条目加权**：56 个键值是数组（34 个文件），长度 4×55 + 16×1（`netherrack`）。`weight` 在 variants 里 0 次 → 权重 = 数组里条目重复次数。46 个数组是"同 1 模型 × 4 个 y 旋转"，10 个数组用 2 个模型（`bedrock`/`stone`/`deepslate`/`sculk`/`infested_stone`/`infested_deepslate` 的 `_mirrored` 对）。
8. **元素旋转有两个互斥形式 + rescale**：`{axis,angle}` 301 次、`{x,y,z}` 欧拉 2 次（`block/template_hanging_sign_rot_3`：x180/y-67.5/z-180）；`origin` **必填**（303 个全有，59 种取值，`[8,8,8]` 只 66 次），`rescale` 显式写出 114 次（true 97 / false 17，其余 189 个省略=默认 false）。角度集合含 ±22.5/±45/−67.5/−90/`0.0001` → **不能用 90° 群近似**。`CuboidRotation.computeRescale` 会在旋转后按轴放大包围盒，当前烘焙器完全没实现。
9. **零厚度面必须丢弃**：`UnbakedCuboidGeometry.bake` 对 `from.x==to.x` 的轴丢掉 Y/Z 两个面（实测 **429 个元素恰有一轴退化**、756 个是真体积）。cross/torch/植物类模型全靠这条规则，否则会多出零面积 quad 并破坏 AO。
10. **`__comment` 与未知字段必须忽略**：63 个元素带 `__comment`；26.2 已无 `loader`/`compile` 字段（实测 0 次）。新出现字段：`groups`（4 个 `custom_fence_side_*`，且这 4 个模型没被任何 blockstate 引用）、`texture_size`（仅 `block/heavy_core`）、`light_emission`（仅 `cross_emissive`/`flower_pot_cross_emissive`，值恒 15 → 26.2 新增"模型自带方块光"，用户是 firefly_bush / open_eyeblossom / potted_open_eyeblossom，还引入第二层槽 `cross_emissive`）。
11. **面级 `uvlock`/`uvscale` 不存在**：`CuboidFace` 只有 `texture/uv/rotation/cullface/tintindex`；实测 face 键分布 `texture 4238 / uv 3707 / cullface 1041 / rotation 246 / tintindex 122`，`uvlock=0`、`uvscale=0`。uvlock 只存在于 blockstate 变体对象上（2528 次，恒为 `true`），语义是"只转 UV 不转顶点"（`ModelState.inverseFaceTransformation`）。
12. **贴图缺口是 92%**：blockstate 可达面纹理 **1230 张（0 缺失）**，再加 particle 专属 40 张 = 1270 个引用；项目 manifest 只覆盖其中 **93** 张 → **缺 1137**；另有 48 张是动画贴图（水/熔岩/火/kelp/campfire/command_block/lantern…），`textures/block` 的 102 个 mcmeta 里 **54 个带 `animation` 字段（其中 5 个是空对象 `{}`，仍按动画处理）**；全 textures 目录共 63 个带 `animation`（`texture_closure.animation_field_files`）。

## 2. variant 型 blockstate 文法（照抄级）

### 2.1 键的确切格式
实测 7296 个键（`blockstate_variant.key_grammar`）：

* 语法：`^([a-z0-9_]+=[A-Za-z0-9_.\-]+)(,[a-z0-9_]+=[A-Za-z0-9_.\-]+)*$`，**bad_format 例外 0 个**。
* 分隔符：`,` 分属性、`=` 只按**第一个** `=` 切（`Splitter.on('=').limit(2)`），因此值里允许出现 `=`。
* 空键 `""` 表示"无属性约束/单态方块"：**549 个文件**用它（`air`/`water`/`dirt`/`stone` 等）。空键从不与其它键混用（`mixed_specificity_files = 0`）。
* **排序规则：属性名严格字典序**，实测 7296 个键 **0 个例外**（`nonalphabetical_key_count = 0`），且同一键内属性不重复（`duplicate_property_count = 0`）。注意这是数据写法，不是匹配语义（谓词是 map）——烘焙时按键解析、按域枚举。
* 值里**没有** `|`、`!`、`&`（`pipe_in_variant_value = 0`）：`|` 集合与 `!` 否定只在 multipart condition 中出现。

键数量分布（文件数）：`1→549, 2→65, 3→139, 4→81, 6→8, 8→49, 12→24, 16→53, 24→18, 32→35, 40→64, 48→1, 64→1`；每文件属性个数：`0→549, 1→312, 2→95, 3→117, 4→22, 5→1`。键数最多的文件：`repeater.json` 64 键（`delay×facing×locked×powered`）、`crafter.json` 48 键（`crafting×orientation×triggered`）、**40 键 = 全部 64 个楼梯**（`facing×half×shape`）、32 键 = 门/挂牌（35 文件）。

### 2.2 属性域（出现最多的前 12 个，完整 61 个在 JSON `all_properties`）

| property | 文件数 | 取值（实测全集） |
|---|---|---|
| facing | 258 | down, east, north, south, up, west（`facing=up` 仅 41 键 / 23 文件：amethyst_cluster、barrel、dispenser、dropper、end_rod、command_block 系、lightning_rod 系；`facing=down` 42 键 / 24 文件同族） |
| half | 116 | bottom, lower, top, upper（bottom/top=楼梯&活板门，lower/upper=双高植物） |
| axis | 69 | x, y, z |
| type | 69 | bottom, double, normal, sticky, top（slab 三值 bottom/top/double + piston 两值 normal/sticky） |
| shape | 68 | straight, inner_left, inner_right, outer_left, outer_right（楼梯）+ ascending_east/north/south/west, north_south, east_west, north_east, north_west, south_east, south_west（铁轨） |
| open | 55 | false, true |
| powered | 52 | false, true |
| lit | 50 | false, true |
| rotation | 24 | 0..15（16 值） |
| hinge | 21 | left, right |
| candles | 17 | 1, 2, 3, 4 |
| face | 16 | ceiling, floor, wall |
| part | 16 | foot, head |
| age | 14 | 0..7 |
| in_wall / attached / hanging | 12 / 14 / 11 | false, true |
| orientation | 2 | 12 值（up_north…north_up…） |
| thickness | 2 | base, frustum, middle, tip, tip_merge |

注意：`waterlogged` 在 26.2 只剩 **1 个文件**（`sea_pickle.json`）——半砖/栅栏/墙的 waterlog 不再是渲染属性。`snowy` 只 3 个文件（grass_block / mycelium / podzol）。

### 2.3 变体对象字段（7476 个对象）
`model 7476 / y 4440 / uvlock 2528 / x 1913`，**`z` 与 `weight` 各 0 次**（但 `Variant.SimpleModelState` 的 codec 确实接受 `x/y/z/uvlock`，`weight` 只在数组形式的 `ELEMENT_CODEC` 里，默认 1）。
取值：`x ∈ {90:400, 180:1473, 270:40}`、`y ∈ {90:1538, 180:1459, 270:1443}`（0 一律省略，因为默认 `Quadrant.R0`）；`uvlock` **只有 true**（2528 次）。
旋转实现要点（`Variant.java` + `BlockModelRotation.java`）：`x/y/z` 是 **Quadrant（90° 群）**，经 `Quadrant.fromXYZAngles(x,y,z)` 映射到唯一 `OctahedralGroup` 群元素（不是先 y 后 x 的两次独立顶点旋转）；`cullface` 方向要按 `Direction.rotate(state.transformation().getMatrix(), cull)` 重新映射；`uvlock` 只切换 `faceTransformation/inverseFaceTransformation`（UV 是否跟着转）。当前 `build-assets.mjs` 用 `rotatePoint(y)` 再 `rotatePoint(x)`，与原版群语义等价**仅当** z=0 且只做 90° 倍数——建议直接查 24 元素群表而不是两次旋转。

### 2.4 随机变体（同状态多模型）
56 个键 / 34 个文件：`bedrock, black/blue/brown/cyan/gray/green/light_blue/light_gray/lime/magenta/orange/pink/purple/red/white/yellow_concrete_powder, deepslate, dirt, dirt_path, grass_block, infested_deepslate, infested_stone, lily_pad, mycelium, netherrack, podzol, rooted_dirt, red_sand, sand, sculk, sea_pickle, stone, turtle_egg, …`
其中 **46 个列表内模型相同、只有 4 个 y 旋转**（`dirt`/`stone`/`sand`…），**10 个列表含 2 个模型**（`bedrock`+`bedrock_mirrored` 等 mirrored 对），`netherrack` 是 16 项（1 模型 × 4 旋转 × 4 重复）。→ 烘随机变体只需实现"按权重数组抽 1"，权重来自重复次数；`turtle_egg`/`sea_pickle` 的数组出现在带属性的键上。

## 3. multipart 型 blockstate（102 文件 / 1132 条目）

### 3.1 算子集合（数据 + 代码双向核对）
| 形式 | 数据实测 | 代码出处 |
|---|---|---|
| 单个 `when` 对象里多个属性 = 隐式 AND | 1086 个 when 全是 dict；1874 个 plain 字符串叶子 | `KeyValueCondition.instantiate` → `Util.allOf` |
| `"AND": [ ... ]` | **288 次 / 13 文件**（12 个 `*_shelf` + `chiseled_bookshelf`） | `CombinedCondition.Operation.AND` |
| `"OR": [ ... ]` | **5 次 / 2 文件**（`fire.json` 4 次、`redstone_wire.json` 1 次） | 同上 `.OR` |
| `"INVERT"` | **0 次** | 枚举里**不存在**（26.2 已无该算子） |
| 值集合 `"side\|up"`、`"3\|4"` | 32 处 / 4 文件：`redstone_wire, leaf_litter, pink_petals, wildflowers` | `KeyValueCondition.Terms`（`SEPARATOR='|'`） |
| 值否定 `"!true"` | 0 次（代码支持） | `Term.parse`（`NEGATE="!"`） |
| JSON 数组值 `["true","false"]` | 0 次 | 无此形式（数组只出现在 `apply`） |
| int/bool 裸值 | 0 次（codec 有 `LEGACY_REPRESENTATION_CODEC` 兼容） | `Terms.CODEC.withAlternative` |
| 无 `when` 的条目 | **46 条**（如栅栏柱 `oak_fence_post`） | `Selector.condition = optional` → 恒真 |
嵌套深度直方图：`{0:1, 1:86, 2:15}` → **最深 2 层**（OR/AND 里套属性 dict），实现只需递归 dict+list，不需要更复杂的表达式树。
`apply` 字段：`model 1185 / y 718 / uvlock 395 / x 36 / weight 6`；`weight` 全部为 2、仅 `chorus_plant.json`；`apply` 为数组的条目共 19 处，分布在 `fire(6) soul_fire(5) chorus_plant(6) bamboo(2)` —— **数组 = 等权随机取 1 个模型**（`BlockStateModel.Unbaked.CODEC` 的 `HARDCODED_WEIGHTED_CODEC` 分支），不是把数组里所有模型都贴上。
邻居条件属性：82 个文件同时以 `north/east/south/west` 为条件属性（栅栏/板/墙/bars/藤蔓/红石线/火/菌丝…）；属性域：`north/east/south/west ∈ {true,false}`（栅栏、bars、pane）、`{low,tall}`（墙）、`{none,side,up}`（红石线）、`up ∈ {true,false}`（墙/藤/火）、`down ∈ {true,false}`。

### 3.2 三个最复杂文件的 condition 树
完整树见 `research/_multipart_complex.json`。

1) `chiseled_bookshelf.json`（52 条目 / 148 节点；条件属性 `facing` + `slot_0_occupied..slot_5_occupied`）——AND 的典型：
```json
{"apply": {"model": "minecraft:block/chiseled_bookshelf_empty_slot_top_right"},
 "when": {"AND": [{"facing": "north"}, {"slot_2_occupied": "false"}]}}
```
2) `acacia_shelf.json`（80 节点；`facing`×`powered`×`side_chain ∈ {unconnected,left,center,right}`，12 个同类）——同一状态会命中多条 AND 条目并叠加，这就是 shelf 需要"多部件合成"的原因。
3) `redstone_wire.json`（10 条目；唯一大量使用 `|` 与 `OR` 的）：
```json
{"apply": {"model": "minecraft:block/redstone_dust_dot"},
 "when": {"OR": [
   {"east":"none","north":"none","south":"none","west":"none"},
   {"east":"side|up","north":"side|up"},
   {"east":"side|up","south":"side|up"},
   {"south":"side|up","west":"side|up"},
   {"north":"side|up","west":"side|up"}]}}
```
另附最简单的栅栏（`oak_fence.json`，5 条目）：1 条无 `when` 的 post + 4 条 `{"north":"true"}` 等隐式 AND 单属性条件，side 模型带 `uvlock:true` 与 `y ∈ {0,90,180,270}`。

## 4. models/block 全量解析

### 4.1 顶层字段频次（2657 个 block 模型）
`textures 2626 · parent 2369 · elements 343 · ambientocclusion 157 · display 23 · groups 4 · gui_light 2 · texture_size 1`。
`loader 0 · compile 0 · overrides 0`（item 侧才有 overrides/display 43）。`ambientocclusion` 显式值 **151 false / 6 true**；`gui_light` block 侧只有 2 个显式（`side`），默认 `side`（`ResolvedModel.DEFAULT_GUI_LIGHT`）。

### 4.2 parent 继承图（215 个不同 parent）
链长分布 `{1:1149, 2:1865, 3:592, 4:21}`，**最深 4 级**（`block/blast_furnace → block/orientable → block/orientable_with_bottom → block/cube → block/block`，见 JSON `models.inheritance.max_depth.chain`），**环 0 个**，缺失 parent 文件只有 1 个：`builtin/generated`（被 1 个 item 模型引用，运行时内置，磁盘无文件）。
按"继承它的叶子模型数"排序前 20（完整 215 行在 JSON `models.parents.table`）：

| parent | 直接子 | 传递后代 | 叶子数 | 自带 elements | 自带 textures |
|---|---|---|---|---|---|
| block/block | 106 | 1317 | 1234 | 否 | 否 |
| item/generated | 1108 | 1230 | 1220 | 否 | 否 |
| block/cube | 11 | 441 | 431 | **是** | 否 |
| block/cube_all | 291 | 292 | 291 | 否 | 是 |
| block/cross | 76 | 76 | 76 | 是 | 是 |
| block/cube_column | 76 | 76 | 76 | 否 | 是 |
| block/slab / slab_top | 64 / 64 | 64 / 64 | 64 / 64 | 是 | 是 |
| block/stairs / inner_stairs / outer_stairs | 60 ×3 | 60 ×3 | 60 ×3 | 是 | 是 |
| block/thin_block | 6 | 59 | 54 | 否 | 否 |
| block/template_cake_with_candle / _candle / _four/three/two_candles | 34 ×5 | 34 ×5 | 34 ×5 | 是 | 部分 |
| block/template_wall_post / _side / _side_tall / wall_inventory | 32 ×4 | 32 ×4 | 32 ×4 | 是 | 是 |
| block/template_bed | 2 | 34 | 32 | 否 | 否 |
| block/flower_pot_cross | 31 | 31 | 31 | 是 | 是 |
| block/cube_bottom_top | 21 | 27 | 26 | 否 | 是 |
| block/cube_column_horizontal | 25 | 25 | 25 | 是 | 是 |
| block/crop | 23 | 23 | 23 | 是 | 是 |
| block/pointed_dripstone | 20 | 20 | 20 | 是 | 是 |
| block/carpet | 18 | 18 | 18 | 是 | 是 |
| block/door_bottom_left / _left_open / _right / _right_open / door_top_* | 17 ×8 | 17 ×8 | 17 ×8 | 是 | 是 |
| block/template_glass_pane_noside | 17 | 17 | 17 | 是 | 是 |

几何来源统计（`models.geometry_source.leaf_models_per_geometry_source`）：`block/cube` 供 **408** 个叶子、`block/cross` 76、`block/slab`/`slab_top` 各 64、`block/stairs`/`inner_stairs`/`outer_stairs` 各 60、candle 系列各 34、wall 模板各 32、`flower_pot_cross` 31…；**62 个 block 模型整条链无 elements**（59 个被 blockstate 引用，见 §1.5）。

### 4.3 元素/面字段实测（block 模型 1183 元素 / 4227 面；下文的“1185/4238”是含 item 模型的合计）
* 面方向分布：`north 779 · south 752 · up 706 · down 671 · west 665 · east 665`；未知方向名 **0**。
* 元素键（含 item 的 1185 个元素口径，block 侧为 1183）：`from/to/faces 各 1185 · shade 334（其中 false 333）· rotation 303 · name 94 · __comment 63 · light_emission 4`。
* 面键（同上口径，4238 面 = block 4227 + item 11）：`texture 4238 · uv 3707 · cullface 1041 · rotation 246 · tintindex 122`（**uvlock 0、uvscale 0**）。
* `uv` 全是 4 元、**0 例越界**（全部 ∈[0,16]）；`rotation ∈ {90:151, 270:55, 180:39, 0:1}`（Quadrant）；`cullface` 六向都出现（down 291 最多）；`tintindex` 只有 0（90）和 1（32，多槽染色，如 grass_block/bed 的 top/foot 分层）。
* 包围盒分类：**满 0-16 立方 25 个元素**、贴边子盒 6 个、**off-grid 1154 个**（324 个模型）；坐标高频值 `0:978, 16:819, 8:463, 9:345, 2:340, 7:335`，也大量出现 `1.5/3.5/13.61104` 等；**越界(<-16 或 >32) 0 例**（`CuboidModelElement.getPosition` 会抛异常，边界 [-16,32] 必须在加载器里保留）。
* 退化：429 个元素恰有一轴 `from==to`（z 200 / y 144 / x 85），756 个是真体积 → 见 §1.9 的丢面规则。
* 旋转元素 303：`axis y 225 / x 48 / z 28`，`angle {45:131, -45:70, -22.5:49, 22.5:22, 0:19, -67.5:7, -90:2, 0.0001:1}`；`origin` 59 种（`[8,8,8]` 66、`[8,16,8]` 47、`[8,0,8]` 44…，**缺省 0 例**）；`rescale` 写 114 次（true 97 / false 17）；欧拉形式 2 次。

### 4.4 纹理槽与父默认（必须照抄的规则）
面引用形式：`#变量 4232 / 裸槽名 6`。**关键规则**：`CuboidFace.texture` 永远按“槽名”解析，`#` 前缀可选（`TextureSlots.getMaterial` 会 strip 掉 `#` 再查表）；26.2 里唯一的裸名写法是 `block/heavy_core` 的 6 个面 `"texture": "all"` → 命中它自己的 `textures.all`。若把它当贴图路径就会得到不存在的 `all.png`（当前 `build-assets.mjs` 的 `resolveTexture` 正是如此，会 throw “missing texture all”）。`block/air` 的 `textures.particle = minecraft:missingno` 是另一回事：那是槽定义里的**字面路径**（合法），指向运行时生成的缺失贴图。`{"sprite":…, "force_translucent":true}` 的对象形式在 block 侧 0 次（item 侧才有）。
变量名全集 **93 个**，最高频：`texture 795 · all 639 · side 495 · propagule 270 · lit 198 · flowerpot 153 · top 151 · bottom 146 · slab 100 · stem 92 · unlit 90 · wood 87 · inside 58 · torch 48 · log 47 · lock 40 · hook 40 · base 37 · tentacles 36 · lantern 31 · wall 28 · cocoa 24 · edge 24 · bar 21`（JSON `models.textures.variables_used` 全表）。
槽名全集 top：`layer0 1222 · particle 874 · all 724 · top 615 · side 575 · bottom 570 · layer1 332 · texture 281 · wall 128 · end 114 · cross 108 · pane 85`。
**被引用但本地 `textures` 未定义的变量：全部由父链补齐，补齐 2883 次，悬空 0 例。** 补齐来源即"父默认纹理规则"，必须照抄（完整 33 条在 JSON `models.textures.parent_slot_contracts` / `inherited_from_parent`）：

| 父模型 | 它替子模型定义的槽 | 被继承次数 |
|---|---|---|
| block/cube_all | `down,up,north,south,east,west → #all`（外加 `particle → #all`） | 1740 |
| block/cube_column | `down,up,north,south,east,west → #side/#end` 组合 | 456 |
| block/cube_column_horizontal | 同上 | 150 |
| block/cube_bottom_top | 同上 | 120 |
| block/orientable_with_bottom | `bottom → #top` | 96 |
| block/flower_pot_cross | `dirt, flowerpot` | 62 |
| block/template_command_block | 六向 | 36 |
| block/template_bed_head | `down, north` | 32 |
| block/cube_column_uv_locked_{x,y,z} | 六向 | 各 24 |
| block/cube_mirrored_all | 六向 | 18 |

解析算法（`TextureSlots.Resolver`）：按 root→self 顺序合并槽；值是 `#name` 的先进入 `unresolved` 表，再**迭代到不动点**（`#a→#b→literal` 这种链必须支持，例如 `cube_all.particle=#all` → 子给的 `all` 字面量）；解析不出的槽**被删除**，取面时 `resolveSlot` 找不到就返回 missing sprite 并 warn（`MaterialBaker.resolveSlot/reportMissingReference`）。`particle` 槽名是常量 `UnbakedModel.PARTICLE_TEXTURE_REFERENCE = "particle"`。

## 5. 贴图依赖闭包与项目缺口

* blockstates 直接引用 **2380** 个模型（block 模型总数 2657 → 277 个当前无人引用，如 `custom_fence_side_*`）。
* 面纹理 **1230 张，全部存在（0 缺失）**；含 particle 槽的引用集 **1270**（多出 40 张只用于破坏粒子，如 `block/light_blue_shulker_box`、`block/conduit`、`block/bamboo_fence_particle`、`item/…`、以及不存在的 `missingno`）。
* 闭包内动画贴图 **48 张**（`texture_closure.animated_in_closure`）（`lava_still / lava_flow / water_still / water_flow / fire_0 / campfire_fire / kelp / kelp_plant / lantern / copper_lantern / command_block_* / blast_furnace_front_on / firefly_bush_emissive …`）。
* `textures/block` 实际 1269 张 PNG + 102 个 mcmeta（54 个含 `animation`，其中 5 个为 `{}`）→ **未出现在 blockstate 闭包里的 block 贴图 39 张**（被 item/HUD/其它命名空间引用）。
* 项目现状：`public/mc/manifest.json` 103 条（93 条命中闭包 + `block/destroy_stage_0..9` 是烘焙器额外注入的挖掘破坏图）→ **缺 1137 张，缺口 92%**。
* 另需注意 `atlases/blocks.json` 除 `block/*` 目录外还并入 `entity/conduit/*`、`entity/bell/bell_body`、`entity/enchantment/enchanting_table_book`；这些不走 blockstate 面纹理，若要对齐原版图集需单独并入。

## 6. 方块名单对照（Blocks.java ↔ blockstates）

`Blocks.java`：`public static final Block` 字段 **852** 个；注册助手分布 `register 787 / registerLegacyStair 47 / registerSlab 6 / registerStair 6 / registerWall 6`；另有 **14** 个 `ColorCollection<Block>`（BED/WOOL/STAINED_GLASS/DYED_TERRACOTTA/STAINED_GLASS_PANE/CARPET/BANNER/WALL_BANNER/DYED_SHULKER_BOX/GLAZED_TERRACOTTA/CONCRETE/CONCRETE_POWDER/DYED_CANDLE/DYED_CANDLE_CAKE）与 **15** 个 `WeatheringCopperCollection<Block>` 家族。真实 id 名来自 `references/BlockItemIds.java`（743 个 `create("x")` + 26 个染色/铜家族）与 `references/BlockIds.java`（109 + 2 家族）；注意 **字段名 ≠ 注册名**，如 `BEETROOTS = register(BlockItemIds.BEETROOT_CROP)` 而 `BEETROOT_CROP = BlockItemId.create("beetroots","beetroot_seeds")`。

展开后得到 **1196 个方块名**，与 1198 个 blockstate 文件比对：

* **没有任何注册方块缺 blockstate 文件**（`blocks_without_blockstate = []`）。`air / cave_air / void_air / water / lava / fire / soul_fire / moving_piston / piston_head / structure_void / barrier / light / spawner` 都有文件——只是 `air/water/lava/light_*/…` 指向的模型没有几何（§1.5）。所以"哪些方块没有 blockstate 文件"这个问题在 26.2 的答案是**零个**；真正的分类是"有 blockstate 但无可烘焙几何"= **59 个模型 / 覆盖约 80 个方块态文件**（含 16 个 `light_*`、17 个 shulker、8 个铜箱/铜像等）。
* 反向差集只有 2 个文件：`item_frame.json`、`glow_item_frame.json` —— 26.2 的 `Blocks.java` 里已经没有 item_frame 方块，客户端为它们合成 StateDefinition（`BlockStateDefinitions.createItemFrameFakeState()`，属性只有 `map`），因此这两个 blockstate 是"实体渲染的贴图选择表"，不属于方块管线。

## 7. 与项目现状（PALETTE 85 / src/blocks.ts）的对照

`scripts/build-assets.mjs` PALETTE 实测 85 条、14 条显式 `state`、4 条 `DEFAULT_STATE`。**85 条的 blockstate 文件全部存在，且显式 state 100% 能在原版 variant 键里命中（0 mismatch）**；一条 multipart 都没有（这掩盖了 102 个 multipart 文件尚未实现的事实）。分类：

* **76 条现在就能拿到正确模型**（单态或仅 axis/snowy/lit 这类无需邻居推断的）：`stone, dirt, coarse_dirt, rooted_dirt, grass_block, podzol, sand, red_sand, gravel, clay, cobblestone, mossy_cobblestone, stone_bricks, mossy_stone_bricks, cracked_stone_bricks, bricks, deepslate, cobbled_deepslate, polished_deepslate, granite, diorite, andesite, tuff, calcite, dripstone_block, smooth_stone, sandstone, red_sandstone, bedrock, obsidian, snow_block, ice, glass, oak/birch/spruce_log, oak/birch/spruce_planks, oak/birch/spruce_leaves, moss_block, short_grass, fern, dead_bush, poppy, dandelion, cornflower, azure_bluet, oxeye_daisy, allium, lily_of_the_valley, torch, glowstone, sea_lantern, crafting_table, bookshelf, cactus, coal/iron/copper/gold/diamond/emerald_ore, sulfur, sulfur_bricks, polished_sulfur, chiseled_sulfur, potent_sulfur, cinnabar, cinnabar_bricks, polished_cinnabar, chiseled_cinnabar, water, lava`
  —— 其中 **`water`/`lava` 是例外**：它们的 `block/water`、`block/lava` 无 elements（只有 particle 槽），必须继续走程序化流体几何；`deepslate`（axis 三态 + 4 随机列表）与 `bedrock`（2 模型 × 旋转）需要随机变体支持才算 1:1；`stone/grass_block/podzol/sand/red_sand/rooted_dirt/dirt_path…` 若要 1:1 也必须补随机旋转。
* **9 条必须先有 blockstate 系统才能对**：`snow`（`layers=1..8`）、`oak_stairs`/`birch_stairs`/`spruce_stairs`（`facing×half×shape` 40 键，inner/outer 依赖邻居）、`oak_slab`/`birch_slab`/`spruce_slab`（`type=bottom/top/double`，double 依赖上方同种半砖）、`lantern`（`hanging` 依赖上方方块）、`sulfur_spike`（`thickness × vertical_direction`，依赖上下邻居）。
* **新管线应支持的方块总数上限 = 1198 个 blockstate 文件（= 1196 个真实方块 + item_frame/glow_item_frame 两个表外文件）**；对应 7296 个 variant 键 + 102 个 multipart 文件（1132 条目）、2380 个模型、1230 张面纹理。渲染外观（distinct baked model）上界可按 §2/§3 精确枚举：variant 侧 7296（每键 1 个模型，随机列表再 ×权重集），multipart 侧则是"条目子集"的并，理论 `2^1132` 但实际可达子集受属性域约束（栅栏 `2^4=16`、墙 `2^5=32`、红石线 `3^4=81`），需要用条件求值而不是枚举。
* **必须做放置推断（邻居检查）才能摆对的家族**（实测 57 个后缀家族需要推断，列出主力家族 + 属性域）：

| 家族（blockstate 数） | 类型 | 属性域 | 推断依据 |
|---|---|---|---|
| stairs（64） | variant | `facing∈{n,s,e,w}` × `half∈{top,bottom}` × `shape∈{straight,inner_left,inner_right,outer_left,outer_right}` | 朝向=玩家朝向；inner/outer 由同半层两侧邻居与背靠方块决定 |
| slab（68） | variant | `type∈{bottom,top,double}` | 上方同种半砖→double；`half=top` 由放置点决定 |
| fence（13）/ bars（9） | multipart | `n/e/s/w ∈ {true,false}` | 邻居同类或同材质墙 |
| pane（17） | multipart | `n/e/s/w ∈ {true,false}` | 邻居同类 + 自身 axis 材质 |
| wall（32） | multipart | `n/e/s/w ∈ {false,low,tall}` + `up` | 邻居高度（low/tall）与上方遮挡 |
| redstone_wire | multipart | `n/e/s/w ∈ {none,side,up}` + `power` | 信号强度与邻居朝向 |
| fire / soul_fire | multipart | `n/e/s/w/up ∈ {true,false}` | 支撑面 + 无邻居时铺 floor |
| vine / glow_lichen / chorus_plant / mushroom_stem / brown_mushroom_block / vein / clump | multipart | 六向 `{true,false}` | 六个方向邻居 |
| fence_gate（12） | variant | `facing, in_wall, open, powered` | `in_wall` 需检查东西两侧墙 |
| door（21）/ trapdoor（21） | variant | `facing, half(lower/upper/top/bottom), hinge, open, powered` | 上下两格联动，hinge 由点击面决定 |
| bed（16） | variant | `facing, part(head/foot), occupied` | 占两格，part 由放置方向 |
| ladder（1）/ scaffolding（1） | variant | `facing∈{n,s,e,w}`（4 键）/ `bottom∈{true,false}`（2 键） | 依附墙 + 下方连续（26.2 已无 `waterlogged`） |
| shelf（12）/ chiseled_bookshelf | multipart | `facing, powered, side_chain∈{unconnected,left,center,right}` / `slot_0..5_occupied` | 左右相邻同朝向带电块 |
| *_coral_fan / _wall_fan（20）| variant | 平面种 `""`（空键）；墙挂种 `facing`（4 键） | 靠 `wall_fan` 的朝向选择，无邻居计算 |
| candle（17）+ cake（18） | variant | `candles∈1..4`、`bites∈0..6`、`lit` | 叠加计数 |
| piston（2 类 + piston_head/moving_piston） | variant | `facing, extended` | 推拉状态 |
| repeater/comparator | variant | `facing, powered, delay/mode` | 朝向 + 邻接比较 |
| dripstone / sulfur_spike | variant | `thickness∈{base,frustum,middle,tip,tip_merge} × vertical_direction∈{up,down}` | 上下连续 |
| big/small_dripleaf（2）/ bamboo（1）/ cave_vines(+plant)（2）/ crop stems（10）| variant+multipart | `facing×tilt`（16 键）/ `age×leaves`（multipart，4 模型数组 apply）/ `berries` / `age` | 双高植物与生长阶段；bamboo 的 apply 是 4 元数组=随机 1 |

（完整 57 家族及其精确属性域见 `blockstate_variant.suffix_families` / `blockstate_variant.suffix_families_needing_inference`，每条已标 `needs_placement_inference`。）

## 8. 给 M1b 的实现清单（按 P0→P2，均可回溯到上面的数字）

P0（不做就大面积错）
1. blockstate 文件 → 属性域枚举 + **键解析谓词**（`,`/首个 `=`、空键、值集合 `|`、`!` 可选），并检测重叠键（原版会抛错）。证据：§2.1、§1.1。
2. **multipart 求值**：无 when=恒真、dict=隐式 AND、`AND/OR` 递归、`|` 集合；条目命中即全部叠加；`apply` 数组 = 随机 1 个。证据：§3.1（102 文件 / 1132 条目 / 46 恒真 / 19 数组）。
3. **几何父继承**（`findTopGeometry`）+ **纹理槽 root-first child-last 合并 + `#` 不动点解析**，并把 `face.texture` 一律按槽名解析（`#` 可选）。证据：§4.2、§4.4（343 声明 elements、2883 次槽继承、0 悬空；`heavy_core` 裸槽名 6 例）。
4. **随机变体**（等权数组、重复即权重）。证据：§2.4（56 列表 / 46 同模型 / 10 mirrored 对 / netherrack 16）。
5. **零厚度丢面**（from==to 的轴向丢 2 面）。证据：§4.3（429 退化元素）。
6. 变体 `x/y`（可选 `z`）用 **24 群元素查表**，`uvlock` 只改 UV，`cullface` 方向按群重映射。证据：§2.3。
7. 忽略 `__comment`/`name`，保留坐标边界校验 [-16,32]。证据：§1.10、§4.3。

P1（视觉保真）
8. 元素旋转支持 `{axis,angle}` 与 `{x,y,z}` 两种形式 + `rescale`（true 97 例）。证据：§4.3。
9. `tintindex` 0/1 双通道（多槽染色）与 `shade:false`（333 例，关 AO/光照平滑）。
10. `light_emission`（4 元素，值 15）→ 模型自带方块光；`cross_emissive` 第二层贴图槽。
11. 59 个无几何模型走特例（水/熔岩/火把类流体、箱子类块实体、`light_*` 空几何、`air`）。

P2（工程）
12. 图集并入 1230 面纹理 + 40 张 particle 专属 + 48 张动画（mcmeta `animation`，含 5 个空对象需按默认处理）；`missingno` 需运行时程序化生成。
13. `groups` / `texture_size` 字段解析（分别 4 / 1 例）——先"知道并忽略"，不要因此 throw。

已知项目侧偏差（`scripts/build-assets.mjs`）：multipart 直接 `throw`（第 277 行）；`resolveTexture` 对未定义 `#var` 直接 throw（第 180 行，原版是"丢槽→missingno"并 warn）；`loadModel` 的 `elements: raw.elements ?? base.elements` 只在单父递归下正确、需要"最近祖先"语义；只烘一个固定朝向（无随机数组、无群表）；无 `rescale`、无退化面丢弃、无 `light_emission`。

## 9. 交付物与烘焙校验点

产物：
* `research/blockstate-inventory.md`（本报告）
* `research/blockstate-inventory.json`（595 KB，机器可读：`blockstate_variant.all_properties` 全属性域表、`blockstate_variant.property_sets`/`suffix_families`、`blockstate_multipart.files`（102 个文件全清单）与 `properties` 域、`models.parents.table`（215 行）、`models.geometry_source`、`models.textures.parent_slot_contracts`（33 条父默认）、`texture_closure.face_textures`（1230 张全清单）与 `animated`、`blocks_registry.*`、`project_comparison.entries`）
* `research/inventory.py`（只读复现脚本）、`research/_inventory_dump.txt`（每行一个实测数字）、`research/_multipart_complex.json`（3 个最复杂 condition 树全文）

新烘焙管线应直接对这些数做断言（取自 `meta.counts`）：
`blockstate_files=1198 / variant=1096 / multipart=102 / variant_keys=7296 / variant_objects=7476 / multipart_entries=1132 / block_models=2657 / models_referenced_by_blockstates=2380 / declared_geometry_by_class.block={343 模型,1183 元素,4227 面} / closure 面纹理=1230（0 缺失）/ particle 追加=40 / 闭包动画=48 / 无几何被引用模型=59`。
若某次改动后这些数变了，说明解析或继承规则被改坏了。
