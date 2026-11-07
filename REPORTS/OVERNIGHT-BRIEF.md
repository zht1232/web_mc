# OVERNIGHT-BRIEF — 所有员工必读（2026-11-08 夜间作业须知）

项目：`G:\web_mc\webcraft26`，Minecraft Java **26.2** 的 WebGL2 + TypeScript 浏览器复刻。
**终极验收目标（07:00 交付）：在浏览器里玩到「晚上几乎 1:1 的原版 MC」，并带 Complementary 风格光影。** Paper 联机不做。

先读（各 5 分钟以内）：`REPORTS/session-digest.md`（权威结论，§4/§5/§6/§7 最重要）、`REPORTS/session-reports/07-integration.md`、`08-regression.md`。

## 0. 铁律

1. **抄原版，不要自己编。** 任何常量/公式/布局/颜色，先去权威来源找真值，再写代码，并在代码注释里标出来源（Java 全限定名 / 文件路径）。凭记忆写的数值一律视为错误。
2. **没跑过 = 没做完。** 每个结论必须有你亲自跑出来的证据（命令输出 / 截图路径 / 断言结果）。不要把"应该可以"写进报告。
3. **工作区是多人共用的。** 你只拥有任务书里列出的「文件所有权」。要改别人的文件时：只用 Edit 做小范围定点替换，改前重新读文件，**绝不整文件重写**（尤其 `Game.ts`、`LevelRenderer.ts`、`Shaders.ts`），并在报告里写明改了哪里。
4. **禁止任何 git 写操作**（add/commit/checkout/stash/reset/restore/clean…）。提交只由主管做。禁止 push。
5. **不要动**：`node_modules/`、`public/mc/**`（官方素材，只读）、`dist/`、`bridge/`、`G:/ck-web26` 里除任务书明确允许外的内容、线上任何服务器。
6. **不许留下编译错误。** 报告前必须 `cd G:\web_mc\webcraft26 && npx tsc --noEmit` 对你改过的文件 0 错误。别人的半成品文件报错：不要替他修，等 2 分钟重试；持续 10 分钟以上就在报告里说明。
7. 代码风格：沿用周围风格（英文注释、文件头标 Java 来源、`.js` 后缀的 ESM import）。文件是 **CRLF** 行尾：用 Edit 工具，不要用 sed 做多行替换。
8. 本机坑：**没有可用的 python（会卡死）**，脚本一律用 node；不要调用 cmd.exe；路径用 `G:/...` 或 `/g/...`；临时文件放 `G:\web_mc\webcraft26\shots\<你的包名>\` 或 `G:\tmp`，不要写 C 盘。

## 1. 权威来源（按优先级）

| 要什么 | 去哪 |
|---|---|
| 原版 Java 源码（反编译，6,707 个） | `G:/ck-web26/src-vanilla/net/minecraft/**` |
| 原版着色器 / post 效果 / 资源 | `G:/ck-web26/vanilla/assets/minecraft/shaders/**`、`.../post_effect`、`textures`、`models`… |
| 原版数据（datapack） | `G:/ck-web26/src-vanilla/data/minecraft/**` |
| Complementary Reimagined r5.9.3 解包 | `G:/web_mc/_src/thirdparty/thirdparty/complementary-reimagined-r5.9.3`（默认参数在 `shaders/lib/common.glsl` 顶部 `#define`） |
| 项目内已烘焙数据 | `webcraft26/public/mc/*`（只读） |
| 真实 26.2 客户端 | Java 25：`C:\Users\zht\AppData\Roaming\.minecraft\runtime\java-runtime-epsilon\bin\java.exe`；启动参数 `G:/ck-web26/launch.args`（仅 reference 员工使用） |

在 Git Bash 里 grep 反编译源码很快：`grep -rn "SKY_LIGHT_LEVEL" /g/ck-web26/src-vanilla/net/minecraft | head`。

## 2. 怎么跑 / 怎么验证

- 开发服务器**已经在** `http://127.0.0.1:5174/` 运行。先 `curl -s -o /dev/null -w "%{http_code}" http://127.0.0.1:5174/` 确认；确实挂了才在后台 `cd G:/web_mc/webcraft26 && npx vite --port 5174`（别重复启动，端口被占用就是已经在跑）。
- 类型检查：`npx tsc --noEmit`（约 10 秒）。
- 单测：`npx tsx scripts/test-<名>.mts`（audio-particles / entities / features / gui / items / mesher / save / worldgen）。
- 截图：`SHOT_EVAL="<页面里执行的 JS>" node scripts/shot.mjs http://127.0.0.1:5174/ shots/<包名>/<名>.png 60000`
  例：夜景 `SHOT_EVAL="(()=>{const m=window.__mc; m.level.time=18000; return 'ok'})()"`。
  可在 URL 后加 `?workers=2` 减少世界生成线程。脚本默认用真 GPU；`GL_MODE=swiftshader` 才走软件光栅。
- 调试入口：`window.__mc` 就是 `Game` 实例（`level`、`player`、`renderer`、`survival`、`entityManager`、`screens`、`sky`、`textures`…）。时间 `level.time`（0 日出、6000 正午、12000 日落、18000 午夜）；玩家 `player.pos/yaw/pitch`；`options.gamemode`。
- 完整冒烟：`node scripts/smoke.mjs --out shots/<包名>/smoke`（约 4–5 分钟，**很重，只在最后跑一次**）。
- **浏览器礼仪**（机器只有 8 线程，同时有多名员工在验收）：同一时刻你最多开 **1** 个浏览器；用完立即关闭；单次等待不超过 90 秒；能用纯数据/单测/readPixels 数值验证的，就别截图。
- 截图自检：你可以用 Read 工具直接看 PNG；描述你看到了什么，不要只说"截图已生成"。

## 3. 汇报格式

完成后写 `G:\web_mc\REPORTS\overnight\<包名>.md`（≤ 70 行，中文）：
1. **做了什么**（文件清单 + 一句话）；2. **证据**（命令与结果、截图路径）；3. **没做 / 已知问题**（诚实列出）；4. **对其他包的依赖或对共享文件的改动**。
最后一条回复写简短摘要（≤ 15 行）。若中途被阻塞超过 20 分钟，把阻塞点写进报告并先交付已完成部分，不要空等。

**时间盒：除非任务书另有说明，所有包 05:30 前必须交付第一版，随后只做修补。** 先做影响最大的，再做细节。

## 4. 包之间的接口约定

- `SkyState`（`src/client/EnvironmentLighting.ts`）是天空/雾/光照的单一事实来源；新增字段只增不删。
- 光照贴图：16×16 RGBA，**x = 方块光、y = 天空光**；顶点属性 `aLight = (sky, block)`，着色器里要 `vLight.yx`（刚修过，别改回去）。
- 生存数据：`SurvivalState` 提供 `health/hunger/saturation/level/experience`，P4 会新增 `airSupply`（0..300）、`armorValue`；HUD 包按这些名字读取，不存在时回退默认值。
- 着色器/GL 管线、`LevelRenderer.ts`、`Shaders.ts`、`renderer/post/**` 由 **render 包**独占；其他包需要新 uniform 或 pass 时，在报告里写明需求，由 render 包接。
