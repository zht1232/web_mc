---
name: feedback-close-decisions-dont-circling
description: When a decision drags on, give a short prioritized list and one clear next action — not another A/B/C table; when asked "可行吗" give one recommended architecture + prerequisites; if he says 我受不了了, stop, roll back, move on
metadata:
  type: feedback
---

一个话题**不要来回开第三轮**。每轮结束时只留一个待答问题；用户说「精简」「按优先级」「我现在到底要决定什么」就是在提示你话太多了；他说「我受不了了，我们不改这个了」就是**终止信号**——立刻回滚、确认恢复、给下一步，不要再补一句"但其实方案 C 更好"。

**Why:** 2026-09-19 在 NamelessMC 离线 UUID / 头像这件事上，我连着几轮都给出 A/B/C 三方案对比表并追问用户拍板，中间还夹了两次我自己搞错结论（把 `user_avatars` 说成头像总开关、拿两个不同玩家的头像做改前改后对比）。用户连续三次要求压缩（「能不能精简下然后按优先级排列」「所以我现在要决定什么，你能解释下吗」「我受不了了…直接先回滚然后下一步」），最后干脆放弃整条改造。他并不是不接受技术结论，而是不接受**决策成本被转嫁给他**。

**How to apply:**
- 自己能查出来的（日志、数据库、配置文件、实测）**先查完再回答**，把它变成结论而不是问题。这次正是因为我拿 LuckPerms/stat 日志自证了"服主也是离线身份"，用户才不再被追问。
- 需要他决定的事，压缩成「一行一个问题 + 我的推荐 + 代价」，不要开菜单。
- 回复默认结构：做了什么 → 证据 → 下一步一句。优先级列表用 P0/P1/P2，每项一行。
- 回滚要真回滚：恢复数据 + 前台核对 + 删掉那个误人误己的脚本，并说明备份文件位置。
- 用户主动收窄范围时（"panel 白名单就算了、授权码就不换了"）照单执行，不要顺手加戏。

- 用户问“可行吗”时，只给**一个推荐架构 + 前提条件**（端口/证书/停机），不要摆 A/B/C 方案；只有真正需要他提供的外部资源才问。

相关：[[feedback-verify-claims-before-recommending]]、[[feedback-backup-before-changing-env]]、[[user-profile]]
