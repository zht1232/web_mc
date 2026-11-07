# webcraft26 交付包（2026-11-07）

Minecraft Java 26.2 的浏览器 1:1 复刻工程 + 全部会话调研记录 + 本机工具。

## 内容

| 目录 | 内容 |
|---|---|
| project/ | 95 文件 2.93 MB — src/ scripts/ research/ bridge/ README 等，排除 node_modules、dist、public（官方素材） |
| generated/ | 3 文件 4.70 MB — states.json / states.bin / manifest.json（由官方资源导出的索引与几何，非官方 PNG） |
| sessions/ | 152 文件 29.48 MB — 两个会话的完整 transcript、子 agent 转录、任务列表、会话记忆 |
| sessions/*/reports/ | 22 份可读报告 + 各自 INDEX.md — 从子 agent JSONL 转录抽出的任务原文与最终报告 |
| memory/user/ | 14 文件 — 跨项目的用户偏好与协作反馈 |
| tools/ | 3 项 1.78 MB — Vineflower、反编译命令、原版客户端截图启动器 |
| thirdparty/src-vanilla/ | 26556 文件 54.17 MB — 第三方/官方派生物，仅限本机 |
| thirdparty/complementary-reimagined-r5.9.3/ | 436 文件 1.20 MB — 第三方/官方派生物，仅限本机 |
| thirdparty/official-assets-mc/ | 1243 文件 9.21 MB — Mojang 官方素材，禁止公开分发 |

## 恢复步骤

```
cd project
npm install                 # 只依赖 pngjs / typescript / vite
npm run assets              # 从你自己的 26.2 客户端重建 public/mc（官方素材不随包分发）
npm run verify:states       # 20 项几何语义抽查
npm run dev                 # http://127.0.0.1:5174/?preview
```

`generated/` 里的 states.json/states.bin 已经和 `npm run states` 的产出做过全量往返校验，
直接复制进 `public/mc/` 也能立即使用（前提：贴图闭包已补齐，见 README 的 M1c 待办）。

## 校验和

- `1e6b413e3ee80e645f41ba57407237832cc1d69201cab7790cf008f928040878`  project/scripts/vanmodel.mjs
- `2df40d7698703785174c14e16a1b372983a0c2c3cc1618f05e1219e9a1f072a6`  project/scripts/build-states.mjs
- `e63e56fc770d98455dca65cdfbc1f3c106db5bf73c9fed2126ffed44cf7ab6fb`  project/scripts/statepack.mjs
- `998f247079f4bad8a5358d10147ee5313c12ae528348ab89efd413ea5bc0f350`  generated/states.json
- `b25dd72a876d00ef963a7b57416f311fc0557fbcfe9fce890154390f6975dd5c`  generated/states.bin
- `f2b4e9597b51bb5e37cf6b1276fffb0687f501c9a1553e5472ea0ec5b838e495`  project/package.json

## 分发拆分

- 代码包（可直接分享/备份）：project/ generated/ sessions/ memory/ tools/ 本文件。
- 第三方包（仅本机）：thirdparty/ 里的 Mojang 反编译源码、官方贴图导出、Complementary 解包。
- 两个包分别压缩为 `webcraft26-code-*.zip` 与 `webcraft26-thirdparty-local-only-*.zip`。
- 本目录已包含 thirdparty/。

## 授权边界

- `public/mc`、`thirdparty/official-assets-mc`、`thirdparty/src-vanilla` 属 Mojang/Microsoft；
- `thirdparty/complementary-reimagined-r5.9.3` 属其作者；
- 以上仅限本机私人游玩，不得提交仓库、不得公开部署。用户已明确：本项目不分析第三方许可条款。


## 总纲

- `sessions/00-DIGEST-两次会话调研总纲.md`（同 `project/research/session-digest.md`）= 两次会话全部调研结论的单文档汇总，先看它。
- 子 agent 报告索引：`sessions/01-crashed-4194ac07-1to1复刻26.2mc游戏/reports/INDEX.md`（20 份）与 `sessions/02-current-fff2a91d-抽离子agent并逐源码复刻/reports/INDEX.md`（2 份）。
