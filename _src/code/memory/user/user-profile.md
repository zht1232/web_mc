---
name: user-profile
description: 用户运营 crystalkingdom 并维护 CrystalKingdomWeb 官网；中文；重原设计与增量改造、手机/公网验收、网页游玩/低延迟/云电脑 CPU 稳定、commit/push 与配套插件源码；允许大量同模型 subagent，愿用受限 Cloudflare token
metadata:
  type: user
---

用户运营 Minecraft 生存服 **crystalkingdom**（`play.crystalkingdom.top`），并维护其官网 **CrystalKingdomWeb**（PHP/MariaDB；NamelessMC 是历史档案）。

- 交流语言：**中文**（回答和文档都用中文）。
- 平台：Windows 单机自管环境，非企业/CI 场景。见 [[windows-local-env-facts]]。
- 审美有要求：整体偏好**原设计/从零自研**，否定模板式移植；但对**既有线上页面**要求只做增量，**不重画、不乱改现有 CSS/布局**。新增卡片要复用现有组件（如液态玻璃卡）。见 [[feedback-ui-additive-and-portrait]]。
- 会用真实页面和手机验收：**竖屏必须保留完整动效**（3D、液态玻璃、背板），不接受阉割成平铺列表；UI 预览要拿现状截图对比，不要拿抽象方案让他想象。
- 喜欢 saga 这类 3D 滚动叙事；对视觉效果有明确好评/差评，会直接说“太帅了/看起来好傻”。
- 会在公网域名和手机上验收部署结果，也会直接指出缓存旧版；阶段完成后要求继续下一步，不要停在总结（2026-10-25：“弄完后开始下一步”）。见 [[feedback-ui-additive-and-portrait]]、[[feedback-commit-push-plugin-source]]。
- 在意操作可逆性：明确要求改动前先备份。见 [[feedback-backup-before-changing-env]]。
- 不要 Windows 服务化的后台常驻进程，偏好一个手动双击的启动脚本。
- 喜欢把前沿/实验性的东西落到自己服务器上玩（例：把果蝇全脑连接组做成 MC 插件，见 [[flybrain-mc-project]]）；对“假人/真玩家/训练它说话”这类玩法有持续兴趣。
- 推进风格偏“先验证再投入”：大方案要先看到现状/小步跑通才拍板（原话：“我先把现在的启动看看再考虑混合方案”）。
- **回答要短、要按优先级排**：反复要求过（“简单地告诉我现在到底要改哪些，优先级咋样”、“能不能精简下然后按优先级排列”）。长报告会被要求重排。有效格式：P0/P1/P2 表格 + 每项一句“要我现在做吗”，并明确标出哪些需要他决策、哪些需要停服。
- MC 服务端老手、动手能力强：单服装有大量插件、自己用 PlugMan 热重载、朋友给他写 Bukkit 插件、为了装一个插件愿意现装 Maven 编源码。技术细节可以直接讲深，但**结论必须收敛成清单**。
- 会自己拿现实反证我的说法（例：“为啥之前导入的那几个玩家有头像，你不是说那啥没开吗”、“kessx 的头像本来就是黑白斜块”）。见 [[feedback-verify-claims-before-recommending]]。
- **给选项时必须把“唯一需要你拍板的是什么 + 各选项后果”写成一行**，否则会被反问“所以我现在要决定什么，你能解释下吗”。信息量大时先收敛成一个问题，别让他自己在一段段表格里找决策点。见 [[feedback-close-decisions-dont-circling]]。
- Web 运维/基础设施概念上不熟：SMTP vs POP3/IMAP 的区别、伪静态是什么、`hostname` 影响哪些链接、各设置项语义，都要**用类比讲一遍“为什么这会影响你”**；讲不清就会连锁追问。MC 服务端侧（插件、LuckPerms、PlugMan、离线模式机制）则很熟，不用铺垫。
- 部署边界（2026-09-19 确认）：cloudflared 他已配好开机自启；网站那几个进程（MariaDB/PHP）他重启后**手动启动**；后台不加 Cloudflare Access / IP 白名单（他明确“就算了”）。
- **交付偏好：开箱即用 + 双版本**。要两份 jar——本地版把私密配置（API key 等）**预填好**，社区版剔除敏感信息但**资源要全内嵌**（原话：“社区版要把所有资源打包进去免得重新下载，注意不要打包我的敏感信息”）。别把“社区版=瘦身版”当默认。
- **当前网站交付还要求 commit + push，并把游戏侧配套插件源码一起入库**；汇报部署状态要分清网站已上线、JAR 已构建未部署、数据库迁移已执行。见 [[feedback-commit-push-plugin-source]]。
- **权限走 LuckPerms 组**：面向玩家的功能不要默认开放，要能在 LP 里按权限组授权（管理员保留全部）。
- 会亲自进游戏验收，也会盯资源占用；不合格会直说（“看起来好傻”、“cpu 直接跑满了”）。见 [[feedback-perf-and-liveliness]]。
- **网页游玩（Eaglercraft 26.2）是当前面向同学/手机的主推功能**：低延迟、手机下载稳定、崩溃可恢复是硬要求；Cloudflare Tunnel 的高 ping/73MB 卡死不能当“能跑”验收；客户端 WASM 崩溃时会拿 crash log 追问根因。见 [[feedback-perf-and-liveliness]]、[[project-eaglercraft-client-limits]]。
- 2026-10-31 云电脑/真实客户端串流：会亲自试；CPU 打满或浏览器崩会立即否，要求先说**根因、下次如何避免**，不要反射性把会话/子 agent/工作停掉（原话“我不是让你停，我是要为什么，下次怎么避免，没让你停工作”）。见 [[feedback-perf-and-liveliness]]、[[project-cloud-gaming-pilot]]。
- 愿意把 Cloudflare 运维以**受限 API token**交给 agent（DNS/Zone Read/Cache Purge/Tunnel Edit 等；不用账号密码/2FA），token 存 `storage/private/cloudflare.token`；用于直连 8443/证书。见 [[project-web-play-architecture]]。
- 明确允许“尽情使用 subagent”，并要求同模型；独立调研、前端页面、规则核对可并行。见 [[feedback-subagents-encouraged]]。
- 另有一个独立项目 **webcraft26**（浏览器里 1:1 复刻 Minecraft Java 26.2，用他自己解包的官方客户端资源）。对这个项目的要求是**逐细节对齐原版**，不接受“看起来差不多”。见 [[project-webcraft26-1to1-roadmap]]、[[reference-mc262-authoritative-data]]。
- 会直说“token 是免费的、给你无限时间、使劲工作”——意思是**不要替他省算力/省轮次/省上下文**，也不要中途停下来等确认；同时要求“不懂就去解包或上网搜索”，即**别猜，去查权威数据**。见 [[feedback-unlimited-effort-autonomy]]。
