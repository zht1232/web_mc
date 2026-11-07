---
name: feedback-backup-before-changing-env
description: 改动数据库/站点/环境前先备份；同一改造的多次 DDL 合并为 website 层 MILESTONE（永久保留）；清理重复/空目录
metadata:
  type: feedback
---

改动用户的数据库、站点目录或任何已有数据之前，**先做备份，并在动手前说明备份位置**。同一轮改造涉及的多次数据库结构变更，合并成一个 `MILESTONE-` 备份目录，不要留下多个顶层重复目录；备份做完不要忘记清理。

**Why:** 一次 NamelessMC 重装会话里没做备份就清掉了环境，用户明确表达不满（原话：“你把一切都搞乱了，我们应该备份的”）。2026-10-25 多实例/Wiki 改造时，我先把实例迁移和 Wiki 迁移各做了一个全库 dump，分别放在 `D:\backups` 顶层；用户随后明确要求“备份你以后不要忘记删，统一下备份”，并让参照 DeepSeek harness 的运维 skill 和 WorkBuddy 的 agentmd。

**How to apply:**
- 权威规则按 `D:\backups\备份规则.md`；DSH 运维 skill 的 `minecraft-server-ops/playbooks/backup-restore.md` 一致：统一 `D:\backups\<层>\<名字>`，网站库归 `website` 层，`MILESTONE-` 首前缀永久保留，日常备份每层保留最近 8 个。
- 网站库/DDL：先全库 `mysqldump` 到 `D:\backups\website\MILESTONE-...`，写 README（备份什么/为什么/怎么恢复）和 SHA-256；同一改造的多个回滚点用子目录（如 `before-instances/`、`before-wiki/`）保留，不留在顶层。
- 备份后跑 `prune-backups.ps1` 演练（默认不删），清掉 0 字节/重复目录；不要删别人或插件自带的备份，也不要复制活跃的 MariaDB data 目录。
- **MILESTONE 永久保留**：用户说“备份不要忘记删”时，优先清重复/空目录和临时 dump，不要删 milestone。2026-10-25 已将实例/Wiki 两份 dump 合并到 website 层一个 MILESTONE，保留 `before-instances/`、`before-wiki/` 两个回滚点，删 0 字节空 milestone，prune 演练 0；站点 runtime 快照和插件自带备份不动。
- 回滚要精确：只还原自己改过的那几行 + 那一个设置项；涉及结构迁移时先确认目标 dump，不要拿整库回滚顺手吞掉后面已完成的改动。
- 涉及身份/主键类字段的改写，动手前声明“只做 UPDATE，不删任何记录”，改完用只读清单核对。
- **WorkBuddy 的 agentmd 未找到**（只找到 `.openclaw/workspace/AGENTS.md` 和 `.workbuddy/MEMORY.md`）；需要用户给具体路径时再补读，不要假装已经参照过。
- 不要 Windows 服务形式的常驻进程；临时脚本用完即弃。

相关：[[user-profile]]、[[feedback-commit-push-plugin-source]]
