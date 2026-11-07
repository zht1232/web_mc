---
name: feedback-commit-push-plugin-source
description: 每轮开发后 commit+push；游戏侧配套插件源码要入库；汇报部署状态区分已上线/已构建/未部署，并用公网/手机复验
metadata:
  type: feedback
---

完成一轮代码改动后，默认 **commit 并 push**；涉及游戏服的配套插件，把**插件源码**也一起提交到仓库；汇报时明确区分“源码已推送 / 网站已上线 / JAR 已构建但未部署 / 数据库迁移已执行”。

**Why:** 2026-10-25 多实例改造中用户明确提醒：“记得commit和push，记得把那个服务器互联的配套插件源码也上传了”。之后又问“新功能部署上线了没有”——网站目录是部署目录，改文件即上线；但 Wiki 前端当时还没接、CrystalBridge JAR 只构建未部署。如果笼统说“上线了”，用户会按错误状态验收。公网 Wiki 旧页则是因为 `live.js` 的 `?v=` 没升，升版后才恢复；本地验收通过不等于公网缓存已更新。

**How to apply:**
- 按阶段分别提交（实例/桥接/Wiki/后台），提交信息写清目的；只 stage 业务文件，不把 storage 运行日志、构建产物或 `.bak` 混进去。
- 插件源码与网站代码同仓库维护；JAR 可构建在本地，但不要默认算作“已部署”，部署游戏插件要单独说明维护窗口。
- 结束语给三行状态：已推送的 commit、当前线上实际生效的部分、仍未部署的部分。
- 网站静态资源改动后升 `?v=`，用全新浏览器在公网域名确认入口引用新版本/新页面（本地 fresh context 不代表手机已更新）；数据库 DDL 前按备份规则留 milestone。

相关：[[feedback-backup-before-changing-env]]、[[feedback-ui-additive-and-portrait]]、[[user-profile]]
