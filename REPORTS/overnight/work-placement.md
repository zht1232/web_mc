# work-placement — bugs #1 方块放置（放置规则模块 + 100% 单测）

## 做了什么
1. **新增 `src/client/interaction/Placement.ts`**（纯函数，无 DOM/GL，node 可测）：完整移植原版放置流程
   - 上下文：`BlockPlaceContext`（replaceClicked / getClickedPos / canPlace / getNearestLookingDirections，含 not-replaceClicked 时把 opposite(clickedFace) 提到最前）；`BlockItem.place` 的 canPlace→getStateForPlacement→canPlace；`StandingAndWallBlockItem`（火把/红石火把地面↔墙）。
   - `getStateForPlacement` 分派：stairs(facing/half/shape)、slab(type/double)、log/wood(axis)、fence/wall/iron_bars(_pane)(四向连接+初始连接+waterlogged)、door(facing/hinge/upper 一体放置)、torch(floor/wall)、bed(foot+head)、button/lever(face/facing)、trapdoor、carpet、snow_layer(layers 累加)、tall_grass/large_fern 两格、vegetation(SUPPORTS_VEGETATION)、ladder、fence_gate、waterlogged；`canSurvive` 全部照 `BlockState.canSurvive`。
   - 失败判据：目标格 canBeReplaced（replaceable tag 29 项 + Slab/SnowLayer 覆写）、canSurvive（torch 用 SupportType.CENTER、雪层 isFaceFull、植物 tag…）、`Level.isUnobstructed`（可选注入，默认放行）、多格方块第二格不可替换（门上半/床头/高草上半）。
2. **新增 `scripts/test-placement.mts`**：fs 读 `public/mc/blocks.json+blocks.bin`（同 test-mesher）+ 内存 Map 假 level，覆盖 15 类方块 × 各朝向/面/命中高度 + 8 种失败场景。
3. **未改 `Game.ts`**、未改 public/mc/**、无 git 写操作。

## 证据
- `npx tsx scripts/test-placement.mts` → **Total: 131 PASS, 0 FAIL**（stairs 6 组：yaw=0/90、侧面上半、waterlogged、outer_left/inner_left；slab bottom/top/double/waterlogged；log y/x/z；fence 连接 木/非木/实心；wall none/low/tall/UP/bars 连接；iron_bars 四向；door facing+hinge left/right+上半+失败；torch floor/wall/红石墙变体/fence 柱 CENTER 支撑/无支撑失败；bed foot+head+失败；button/lever floor/ceiling/wall/无支撑失败；trapdoor 2 组；carpet+失败；snow 1/layers+1/底台阶失败；short_grass/flower/tall_grass 成功与失败；非替换方块点击位置；实体阻挡；另含真实 `ClientLevel`+`LevelChunk` 集成段：门上下两格写入 + chunk 标脏）。
- `npx tsc --noEmit` → **0 错误**（现在整仓 0；我交付时他人文件曾有 1 个 HandRenderer 错误，已由本人修复）。

## 现有实现为什么冒烟 3/10（静态分析，Game.ts 旧 stateForPlacement 约 1044-1080 行）
- 目标格判定只有 `existing!==0 && !isLiquid`，没有 replaceable（不能替换草/雪/藤）、没有 `canSurvive`、没有实体阻挡，也没有 “不可替换 → target 变为相对格” 的上下文语义；点击可替换方块时应替换点击格，现在是叠到旁边。
- 属性表错：stairs facing 用 yaw 查错表（0→north，实际 south），half 用 pitch 猜而非命中点 y；slab type 恒为 bottom（不可能 double）；axis 面映射用 face 却没写 facing 的 block 也套用；fence/wall/pane 放置时不写初始连接，靠 updateNeighbors 事后补且判据不含木/非木、墙柱 UP；torch 不会生 wall_torch；door/bed 无多格；waterlogged 看上方而不是目标格。
- 另（复现 3/10 的关键）：smoke 08 是 `pitch=88` 垂直向下连续右键。第 1 格放到自己脚下、第 2 格放到头部、第 3 格放到眼位后，射线被新方块挡住，目标格=已占方块，原版同样会失败（最多约 3/10）。冷却不是原因：`useCooldown=4` 走 20 TPS tick（200ms），smoke 间隔 320ms 够用。**要 10/10 需把 smoke 08 改成站在 2–3 格外、pitch≈0 对墙连续右键**（每次命中的面 target 都是空气格），或每轮改变 yaw/位置。

## 没做 / 已知差异（非本任务验收范围）
- furnace/chest 等 HorizontalDirectionalBlock 的 facing、sign/skull、vine/glow_lichen 多面附着、cactus/sugar_cane/lily_pad 未移植，回落到 `Block.getStateForPlacement` 默认态；液体/骨粉等交互不在范围。
- `isUnobstructed`/`hasNeighborSignal` 需调用方注入（默认 true/false）。

## 交接给 Lead
`placeBlock(mc, level, blockName, ctx)` 一步写入主块+extras；ctx 见消息。`ClientLevel` 直接满足 `PlacementLevel`。
