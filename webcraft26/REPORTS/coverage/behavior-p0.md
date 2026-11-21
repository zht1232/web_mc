# P0 Behaviour Probe（浏览器实测）

> 生成时间：2026-11-21T15:20:07.935Z
> 重新运行：`node scripts/audit-behavior-p0.mjs`（需要 dev server 在 5174）

| ID | 检查 | 状态 | 证据 |
|---|---|---|---|
| B-01 | 空栈残留 item + 手部仍显示 | **PASS** | count=0 isEmpty=true item=false hand= |
| B-02 | 创造格拖到热栏后光标仍持有物品 | **PASS** | pick={"itemId":1,"count":1} drop=null hotbar={"itemId":1,"count":1} |
| B-03 | 创造模式玩家仍是怪物目标 | **PASS** | zombie=null creeper=null swell=0 spawned=true/true |
| B-04 | 页面错误 | **PASS** | none |

`GAP` 表示 review 发现的问题在实机行为中复现，不是测试失败。

