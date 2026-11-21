# P0 行为/结构审计（自动生成）

> 生成时间：2026-11-21T15:19:54.802Z
> 这不是单元测试；`GAP` 表示“review 发现的问题在源码里仍然存在”，用作 burn-down 清单。
> 重新生成：`node scripts/audit-p0.mjs`

共 13 项，GAP 0 项。

| ID | 域 | 检查 | 状态 | 证据 |
|---|---|---|---|---|
| P0-01 | entities | 掉落物渲染使用占位 cube，而不是物品模型/图标 | **PASS** | 已使用真实物品模型 |
| P0-02 | inventory | 创造物品栏没有盔甲/副手/合成/预览槽位 | **PASS** | 创造屏包含装备/副手/合成/预览槽位 |
| P0-03 | inventory | 创造格点击绕过父类拖放状态机，抬起不会 PICKUP | **PASS** | 创造格点击复用父类状态机 |
| P0-04 | inventory | 空栈（count=0 但 item 非空）仍被手部和 HUD 当成有物品 | **PASS** | 空栈已统一按 isEmpty() 处理 |
| P0-05 | mobs | TemptGoal 不检查玩家手持食物，动物无条件跟随 | **PASS** | TemptGoal 检查食物 |
| P0-06 | mobs | NearestAttackableTargetGoal 没有创造/旁观/Peaceful 过滤 | **PASS** | 目标选择过滤创造/旁观 |
| P0-07 | mobs | 苦力怕膨胀/爆炸没有创造模式、难度、mobGriefing 判定 | **PASS** | 爆炸有模式/规则判定 |
| P1-08 | models | 羊毛层 body 膨胀 0.6，原版 1.75 | **PASS** | 羊毛 body 尺寸已修正 |
| P0-09 | models | 骷髅弓是模型内置件，isHoldingBow 永远为 true | **PASS** | 没有生物手持物 layer |
| P1-10 | audio | 没有 music/record 资源，music.* 被别名到水/水下音效 | **PASS** | music/record 目录=true，索引事件=31，music 别名=true |
| P1-11 | render | 天空/地形同期，但 GL clear 与天空 disc 边缘可能在日落露底 | **PASS** | terrainForward=true，skyForward=true，clear 用原始 fog=false，skyDisc 512 裁边=false |
| P1-12 | render | 阴影乘子作用在整张 lightmap，火把光被硬切 | **PASS** | 阴影只影响天光项 |
| P1-13 | gui | 主界面全景是 2D strip，不是 cube map | **PASS** | 已使用 cube map |

## GAP 清单

- 无

