# work-icons — bugs #4（flat 物品图标 + 快捷栏第 9 格）

## 做了什么
- `src/client/gui/ItemIconAtlas.ts`（唯一源码改动）：
  1. **根因修复**：flat 物品原先和方块共用等距相机（yaw45/pitch35.26）。方块 1×1×1 转完占 cell 74–86% 没问题；flat 是 z=0 的正对相机 quad，旋转后只剩 **33% 宽 × 57% 高且斜切**，48px cell→GUI 16px 槽后约 5px 斜条，肉眼即"空白"。原版依据 `net/minecraft/client/gui/render/GuiItemAtlas.java:103-108`：对 generated item model **只 translate+scale，不做旋转**（30°/225° 是 block model 的 display.gui），sprite 正对相机铺满整个 slot。现在 flat/special 用 1:1 正交 VP（`ortho(-0.5,0.5)`）+ 0..1 quad 铺满 cell；颜色仍走满亮度白 lightmap，与 ITEMS_FLAT 一致。
  2. `drawModel()` 每次重绑 block 纹理数组（此前 flat 会把 item 数组留在 unit0，后续方块图标可能采样错数组，属潜在 bug）。
- 新增 `scripts/test-icons.mjs`：读 `public/mc/tex/item.bin` 原图逐像素比对 + 真 HUD 热栏验证 + 截图。

## 证据（`node scripts/test-icons.mjs http://127.0.0.1:5174/ shots/bugs/icons.png`，退出码 0）
- `ATLAS`: hasIcon **flat 722/722、block 736/736、composite 16/16**；canvas 非透明 cell（alpha>8）**1471**。block 有 3 个全无墨：brown_mushroom_block / red_mushroom_block / mushroom_stem（贴图本身全透明面，非本次改动）。
- 逐像素：6 个 flat 样本 inkPx **精确等于** 源 texel 数×9（铁镐 68→612、面包 138→1242、麦种 30→270、铁铲 53→477、钻石剑 84→756、苹果 114→1026），**颜色 mismatch 0 / 比较 4383 个不透明 texel 像素**；bbox 铺满（铁镐 39×39、面包 42×45、剑 48×48）。
- 真 HUD：9 格填 `iron_pickaxe/bread/wheat_seeds/iron_shovel/diamond_sword/apple/oak_log/stone/oak_fence` → `icons.draw` **9 次/帧且 cell 全部有效**，热栏图标条 9/9 槽像素均有变化（perSlot 512/1239/270/396/711/1026/1029/1112/188）。glError=0，无 pageerror。
- 截图：`shots/bugs/icons.png`（真实游戏热栏，读图可见：铁镐、面包、绿色麦种、铁铲、青色钻石剑、红苹果、原木、石头、栅栏），`shots/bugs/icons-sheet.png`（同 9 个图标 64px 带标签）。
- tsc：`npx tsc --noEmit` = **0 错误**（02:20 复核）。

## 没做 / 已知问题
- `kind:'special'` 62 个（箱子/潜影盒/旗帜/盾…）依旧无图标：drawSpecial 查的是 block 纹理数组，而 entity 纹理不在数组里（原版是专用渲染器）；不在本任务范围，未动。
- 第 9 格 water：**已不需要改**——`Game.ts:446-455` 现有默认是 `grass_block/stone/oak_planks/oak_log/glass/torch/crafting_table/oak_stairs/oak_fence`（第 9 格 = oak_fence）。
- 提醒：我最初误报"HUD 热栏空白"，实为我测试脚本往 `stack.item` 塞了 `ItemMeta`（无 `.id`）导致 `icons.draw(undefined)`；改用真实 `Item` 后 HUD 完全正常，勿据此怀疑 HUD 包。
