# hud — HUD 与界面保真（26.2）

## 1. 做了什么

| 文件 | 改动 |
|---|---|
| `src/client/gui/Hud.ts` | **重写**（~700 行，CRLF）。逐函数移植 26.2 `Hud.java`：hotbar/生命/护甲/饥饿/气泡/经验/物品名/F3；另导出纯函数 `heartSprite` / `foodSprite` / `itemBarWidth` / `itemBarColor` / `JavaRandom` / `layoutDebugScreen` / `popTransform` 供单测直接断言 |
| `src/client/Game.ts` | 只改 `renderHud()`（装配 HudState）+ 新增 `buildDebugColumns()`（F3 文案），import 区加 4 个类型 + `SLOT_OFFHAND`。**其它区域未动**（多人在改此文件，全部用定点 Edit） |
| `scripts/test-hud.mts` | 新增，96 条断言（几何 / 精灵选择 / 算法 / 创造模式隐藏 / F3 分栏） |
| `shots/hud/*.png` | survival / creative / hearts / debug / air 各 1 全图 + 1 HUD 条裁图；`shot-crop.mjs` 是本包私有截图器（加裁图 + 重载守卫） |

## 2. 坐标核对表（W/H = GUI 逻辑尺寸；来源为反编译源码行号）

| 元素 | 位置 / 尺寸 | 来源 |
|---|---|---|
| 准星 | `((W-15)/2, (H-15)/2)` 15×15，INVERT 混合 | Hud.java:446 |
| 快捷栏底图 | `(W/2-91, H-22)` 182×22 | Hud.java:572 |
| 选中框 | `(W/2-92+slot*20, H-23)` 24×23 | Hud.java:576-580 |
| 快捷栏物品 | `(W/2-88+i*20, H-19)` 16×16 | Hud.java:592-593 |
| 副手框 / 物品 | 左 `(W/2-120, H-23)` 29×24 / `(W/2-117, H-19)`；右 `(W/2+91,…)/(W/2+101,…)`；空时不画 | Hud.java:583-604 |
| 数量 | `(x+17-width, y+9)` 带阴影，count==1 不画 | GGE.java:950 |
| 耐久 | 黑 `(x+2,y+13)` 13×2；彩色同点 1px 高，宽 `round(13-13d/m)`，色 `hsv(health/3,1,1)` | GGE:940-943 / Item:223-230 |
| 生命 | 容器 `(W/2-91+col*8, H-39-row*rh)` 9×9；`rh=max(10-(rows-2),3)`，`rows=ceil((max+吸收)/2/10)` | Hud:783-861 |
| 低血量抖动 | `current+吸收<=4` 时 `yo += nextInt(2)`（用 java.util.Random 同序列） | Hud:862 |
| 吸收心 | 容器数 `ceil(吸收/2)` 叠在右侧；凋零+吸收用凋零贴图 | Hud:853-878 |
| 护甲 | `(W/2-91+i*8, H-39-(rows-1)*rh-10)` → 单行时 **H-49**，9×9 | Hud:817-833 |
| 饥饿 | `(W/2+91-i*8-9, H-39)`；饱和=0 且 `tick%(food*3+1)==0` 时 `yo+=nextInt(3)-1` | Hud:957-981 |
| 气泡 | `x=W/2+91-(i-1)*8-9`，**y=H-59**（`H-39-10-10`），9×9；`air>=300` 完全不画 | Hud:790/805/905-931 |
| 经验条 | `((W-182)/2, H-29)` 182×5，进度宽 `trunc(p*183)`（是 183 不是 182） | ExperienceBar:22-30 |
| 等级字 | 居中，`y=H-35`，四向黑描边 + `#80ff20` | ContextualBar:35-44 |
| 物品名 | 居中 `y=H-59`（创造 +14），`alpha=min(255,timer*256/10)`，底 `rgba(0,0,0,0.5*alpha)` | Hud:625-645 |
| F3 | 行高 9，左 `x=2` / 右 `x=W-2-w`，`y=2+9i`，底条 `0x90505050`，字 `#E0E0E0` | DebugScreenOverlay:281-301 |

## 3. 证据

- `cd G:/web_mc/webcraft26 && npx tsc --noEmit` → **0 错误**（02:2x 全仓；期间别包报错已等其修好）。
- `npx tsx scripts/test-hud.mts` → **ALL PASS: 96/96**。含：全部心形/食物精灵路径在 `public/mc/gui/sprites/hud/*.png` 真实存在；护甲 H-49、气泡 H-59、经验 183、副手空不画、创造全隐藏、F3 分栏与底色。
- 截图（已 Read 逐张看过）：
  - `shots/hud/survival-hud.png`：3 红 + 1 半心、护甲 7 全 1 半 2 空（H-49）、饥饿 7 个（H-39）、绿经验条 + 71 级、9 格物品与 64/16/3/32 计数、镐橙耐久条 + 剑绿耐久条、选中第 5 格、物品名 "Iron Sword"、左侧副手框内 cobblestone×5。
  - `shots/hud/creative-hud.png`：生命/护甲/饥饿/气泡/经验全部不画；物品名下移到 H-45（`!canHurtPlayer` +14）。
  - `shots/hud/hearts-hud.png`：hardcore + poison 心 + 3 个吸收心（第二行，行高 10）+ 饥饿效果食物贴图。
  - `shots/hud/air-hud.png`：水下空气条 4 蓝 + 6 空，位于 H-59。
  - `shots/hud/debug.png`：左栏 `fps / Biome / Gen / C / ChunkSource / Light / Targeted Block`，右栏 `Minecraft 26.2 / Day / E / clouds / XYZ / Block / Chunk / Facing / Section-relative / Display / GPU / GL`。
- 截图数据由 `window.__mc` 注入（`survival.damage(13)`、`food.setFoodLevel(14)`、`addExperience(500)`、`inventory.setItem`、`level.setBlockState` 水、`itemNameTimer`），命令见报告末行。

## 4. 没做 / 已知问题

1. **攻击指示器**（hotbar 进度条、准星下方）未做；`crosshair_attack_indicator_*` 精灵已存在但未用。
2. **换格弹跳**：核对结论是原版 `ItemStack.popTime` 由「物品进入背包」驱动（Inventory.java:219/265、ClientPacketListener:1419），**换格不会弹**；已照此实现（Game 传 `getPopTime()`）。
3. 状态效果没有接线：`absorption / heartKind / hardcore / hungerEffect` 从 survival 上的**可选字段**读取，缺失回退 0/'normal'/false。P4 接上效果系统即生效，HUD 无需再改。
4. 物品名没有 rarity 颜色与自定义名斜体（无组件系统）。
5. 副手精灵只有 shield 类 special 图标在 `ItemIconAtlas` 里是空白（cell 存在、alpha 像素 0）——**图标包**的 special 模型问题，不是副手槽；副手槽已用 cobblestone 验证能画。
6. F3 两处与原版**有意不同**：①26.2 默认 profile 只有 9 个 entry（全 IN_OVERLAY），本任务要求坐标/朝向/群系/光照/实体统计，故一并启用；②26.2 的 `addPriorityLine` 在两列间交替，而 entry 按 `Identifier` path 排序（`fps` < `game_version`），所以 **fps 在左上、版本在右上**——这是照抄源码的结果，不是笔误。
7. 世界坐标 yaw 与 vanilla 镜像（cameraBasis forward=(sin,·,cos)），F3 的 `Facing` 由 look 向量算、显示 `-yaw` 以对齐 `Direction.fromYRot`；若以后修 yaw 符号，此处要同步。
8. GUI 逻辑尺寸沿用项目约定（`ctx.scale(dpr*scale)` + `CSS/scale`，再 ceil），与 `ScreenManager` 一致；dpr=2 时整体偏大 2×，属全局约定，本包不单独修。
9. 观察：02:0x–02:2x 期间 `ItemIconAtlas` 的 atlas 全空（`atlasTotal=0`，控制台刷 `Two textures of different types use the same sampler location`），所有快捷栏/创造物品图标不显示；02:2x 后其它包修好，截图已恢复。

## 5. 已有项核对（任务 4）

- **准星 INVERT**：`difference` 混合可用；位置原来是 `floor(W/2-7.5)`，比原版 `(W-15)/2` 偏 1px，已改（Hud.ts `renderCrosshair`）。
- **tooltip**：已有（`src/client/gui/components/Tooltip.ts`，`test-gui.mts` PASS wrapTooltipLines/Tooltip），本包未改。
- **GUI scale**：`GuiScale.ts` 已按 `Window#calculateScale` + `enforceUnicode` 偶数规则实现，`test-gui.mts` 有 320..3840 全量 sweep。我另核对了 `Game.ts guiScale` 的内联公式：`floor(min(fbW/320, fbH/240))` 与 `calcGuiScale(fb,0,false)` 在 36,952 组尺寸上 **0 处不一致**（`shots/hud/check-guiscale.mts`）；差异只在 `options.guiScale>0` 时不做"装不下就降级"的 clamp（原版 while 条件会 clamp），属既有行为，未改。

## 6. 对共享文件的改动 / 依赖

- `Game.ts` 仅 `renderHud()` 与新增 `buildDebugColumns()`；未碰 `LevelRenderer.ts`、`Shaders.ts`、`renderer/post/**`。
- 依赖 P4（survival）已提供的 `airSupply/maxAirSupply/armorValue`（02:0x 已就位）；本包只读数，不改其文件。
- 02:1x 时 5174 无监听，我在后台起了 `npx vite --port 5174`（现仍在跑），可能与其他包的重启互踢——若 5174 白屏/超时，重试即可。

复现命令：`SHOT_EVAL="<见 shots/hud 同名 eval>" node shots/hud/shot-crop.mjs "http://127.0.0.1:5174/?workers=2" shots/hud/survival 60000`
