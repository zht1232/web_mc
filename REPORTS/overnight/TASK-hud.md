# TASK hud — HUD 与界面保真

先读 `REPORTS/OVERNIGHT-BRIEF.md`、`REPORTS/session-digest.md` §6、`session-reports/03-gui.md`。

对照 `G:/ck-web26/src-vanilla/net/minecraft/client/gui/Gui.java`（26.2 可能已拆到 `gui/contextualbar/*`、`gui/hud/*`、`gui/screens/*`，先 grep `renderHearts|renderFood|renderArmor|renderExperience|renderHotbar`）逐项核对并补全 `src/client/gui/Hud.ts` 与 `Game.renderHud()`（含 `HudState` 组装）。

## 任务
1. **生存 HUD 补全**：
   - 生命（含吸收、中毒/凋零/冻结/硬核心形、低血量 ±1px 抖动、闪烁）；护甲（`left + i*8, H-49`）；饥饿（右向左 `W/2+91-i*8-9, H-39`，饥饿效果与饱和抖动）；气泡（用 `survival.airSupply`，0..300，缺失时回退 300 = 不显示）；经验条（`W/2-91, H-29`，182×5）+ 等级绿字。
   - **创造模式隐藏生命/饥饿/护甲/经验/气泡**（原版）。
   - 数值读取 `survival.health/hunger/saturation/level/experience`，以及 survival 包新增的 `airSupply`、`armorValue`（可能还没出现，用 `??` 回退 300/0，不要因为字段缺失报类型错——用可选属性访问或局部类型扩展）。
2. **快捷栏**：数量文字与阴影、耐久条（`ItemDecorations` 的颜色算法）、选中框 24×23、换格弹跳（已做，核对）、物品名提示淡出（`H-59`、`min(255, timer*256/10)`）、副手槽（空时不画）。
3. **F3 调试屏**：照原版布局（左右两栏、字号、半透明背景条、坐标/朝向/群系/光照/实体统计的文案顺序）。
4. 已有且只需核对的：准星 INVERT 混合；tooltip；GUI scale 取值规则（原版 `calculateScale`，偶数规则）。受击红边/晕影、水下/南瓜覆盖**不在本包**。
5. **核对表**：所有位置/尺寸以 `sprites/hud/*.png` 的实际大小和 Java 源码坐标为准；把核对出的坐标写成表放进报告。
6. **验收**：生存模式与创造模式各一张截图（`__mc.options.gamemode`、`__mc.survival.health = 7`、`hunger`、`level` 等设置后截图）到 `shots/hud/`，Read 后描述；若 `shots/ref/` 已有真实客户端 HUD 截图，做逐像素位置对照。

## 文件所有权
`src/client/gui/Hud.ts`、`gui/GuiConstants.ts` 与 HUD 相关 sprite 加载、`Game.ts` 的 `renderHud()`（Edit 小改）。其余 `gui/**` 屏幕（背包、菜单）如发现明显错误可修，但先写进报告。

## 交付
`REPORTS/overnight/hud.md`。第一版 05:30 前。
