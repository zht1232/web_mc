---
name: feedback-subagents-encouraged
description: 用户明确允许尽情使用同模型 subagent 并行独立调研/前端/规则核对；要给独立文件边界并验收输出；重负载 E2E 不要在生产机跑 headless 软解
metadata:
  type: feedback
---

用户明确说“你可以尽情使用 sub agent”“你可以派出subagent要和你相同模型的”。可以把独立调研、规则核对、公共/后台前端页面等任务交给同模型 subagent 并行做，不必像默认规则那样保守到一次只开一个。

**Why:** 2026-10-25 同时要做多实例、独立 Wiki、奖励/节日调研；用户主动授权并行。实际用 subagent 完成了备份规则核对、公共 Wiki 前端、后台 Wiki 前端，节省了大量串行时间；但后台 subagent 把自定义 `<tr>` 传给只接受数组的 `table()` 助手，集成时页面报 `row.map is not a function`，说明其交付摘要不能直接当验收结果。

**How to apply:**
- 只给 subagent 分配**独立文件**或只读调研；不要让多个 agent 同时改同一个共享/线上文件。
- prompt 里写清数据契约、可修改文件清单、禁止事项（不部署/不 commit/不动数据库）。
- 收回后先跑语法、浏览器和关键接口验收，再合并；不要根据“已完成”摘要直接上线。
- 并行推进时仍按阶段 commit/push，保持备份和部署状态可追溯。
- **重负载 E2E（云电脑/WebCodecs）不要派到生产机跑**：不要同时跑 headless 软件解码 + 真实客户端 + Paper；给 CPU 预算/护栏、限时 60–90 秒、低优先级或独立测试机。2026-10-31 云 E2E 把 4c/8t 打满，停 subagent 也不保证其 Edge/子进程立刻消失，要确认 cleanup。
- 用户允许 subagent 不代表可以停止工作；测试失败/CPU 高时继续定位和修复。
- **用户会主动要求派“调研 agent”做对照，而不是让他自己列清单**：2026-11-01 他说“你还可以派遣调研agent对比原版和你的版本”，我理解成细节保真对照，他立刻纠正“我的意思是要调研我们实现了什么功能，还要实现哪些也要调研”——所以要**两类都派**：(a) 逐项保真对照（常量/像素度量/贴图几何），(b) **功能盘点**（现状 FULL/PARTIAL/STUB/ABSENT + 原版真实规模），后者产出带依赖顺序和工作量的路线图。调研 agent 要写成**只读**（不改文件、不跑构建、不开浏览器）。
- **多个 agent 并发会把机器打满，反而拖慢需要浏览器的验收**：同机 8 个 agent（3 改码 + 5 调研）时，内嵌浏览器加载世界从 10 秒变成几分钟，截图验证只能排队等待。所以：需要浏览器实测的 agent 分批派，或明确禁止它们用浏览器并让它们用纯数据/代码方式验证；主 agent 要验证时先减少并发。

相关：[[feedback-commit-push-plugin-source]]、[[feedback-close-decisions-dont-circling]]、[[feedback-perf-and-liveliness]]、[[project-cloud-gaming-pilot]]、[[feedback-unlimited-effort-autonomy]]、[[user-profile]]。
