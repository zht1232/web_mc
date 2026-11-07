---
name: feedback-verify-claims-before-recommending
description: Before describing what a setting/tool/third-party project does, read its implementation or test it; read crash logs/stacks before blaming integration — the user catches wrong claims with real-world evidence and trust collapses fast
metadata:
  type: feedback
---

断言某个配置开关、报错原因、第三方项目"是什么、会怎样"之前，**先读实现代码或实测一次**，并在结论里带上证据（文件:行号、真实响应）。说错了要**明确更正**，不要悄悄改口。

**Why:** 在一次 NamelessMC 会话里我把 `user_avatars` 说成"头像总开关"，实际它是"允许玩家上传**自定义**头像"，MC 皮肤头像由 `avatar_site`/`avatar_type`/`default_avatar_type` 控制且一直开着。用户立刻用自己的观察反证（"为啥之前导入的那几个玩家有头像，你不是说那啥没开吗"）。同一次里还有几处想当然被实测推翻：以为注册页文案由 `t_and_c` 设置项控制（其实是语言串 `user/agree_t_and_c`）、以为条款模板里的 `<h2>`/`<table>` 能渲染（HTMLPurifier 白名单里没有，会被吃掉）、以为用户是"离线玩家"（他确实有正版账号，只是服务器不认）。还有一次**做"改前/改后"效果对比时把两个不同玩家的两张图当成同一人比较**，据此下了"头像反而被修好了"的结论，被用户当场抓出（"等下，你这是谁的头像，kessx 的头像本来就是黑白斜块"）——那张黑白块其实是他的**真皮肤**。

**How to apply:**
- 给"开哪个开关"的建议前，grep 该 key 的消费代码，看它到底 gate 什么；面板页面上的措辞 ≠ 实际作用。
- 涉及外部仓库/项目能力，先抓 README、配置文件、license、提交记录再评价，不要靠名字猜。
- 能实测就别推理：curl 一下页面、跑一次连接、打印真实值，比三段分析更有说服力。
- 发现自己前面说错，直接在回复里单列"我上一条写错了，纠正如下"，用户接受这种坦率。
- **A/B 对比必须同对象同条件**：改前 vs 改后、方案 X vs 方案 Y，要锁定同一个玩家/同一条记录/同一个尺寸再取两份数据；跨对象比较得出的"变好了"是幻觉。
- 用户陈述自身事实（"我是正版账号"、"这头像本来就是那样"）时，先当成真去解释机制，而不是当成误解去反驳——机制解释往往同时保住两边（例：账号是正版，但 `online-mode=false` 让服务器发离线 UUID）。

- 用户发崩溃日志/截图时先读栈和字段再归因；2026-10-31 的 crash JSON 明确是客户端 WASM（`TeaVMWebSocketClient` illegal cast + `RangeError`），不是中继，不要先归咎网络。
- **要权威数值时优先读本地打包的数据文件，而不是记忆或网络搜索**：2026-11-01 复刻 MC 26.2 时，WebSearch 查“GUI 方块图标变换常数”返回的全是无关结果，扫 jar 里的 `.class` 也搜不到（常数不在代码里），真正的答案就在 `models/block/block.json` 的 `display` 段里（`gui: rotation [30,225,0] scale 0.625`、`firstperson_righthand: [0,45,0] scale 0.40`）。同一轮实测还推翻了我两个“记得很清楚”的判断：以为楼梯/半砖/栅栏是 multipart（其实 1,198 个 blockstate 里只有 102 个 multipart，占 8.5%）、以为物品还是 `builtin/generated` 平面贴图（1,271 个物品模型里只剩 1 个）。**引擎常数、贴图语义、格式版本这类记忆会随版本腐烂，一律用当版本的实测值覆盖。**

相关：[[user-profile]]、[[feedback-no-unofficial-binaries]]、[[project-eaglercraft-client-limits]]
