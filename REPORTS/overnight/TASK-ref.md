# TASK ref — 真实原版客户端参考截图

先读 `REPORTS/OVERNIGHT-BRIEF.md`。

## 目的
让主管和其他员工能拿**真实 26.2 客户端的画面**做并排对比（尤其夜景、天空、HUD、手）。用户已明确批准本机运行真实客户端抓参考截图。

## 已知条件
- 本机能跑：Java 25 = `C:\Users\zht\AppData\Roaming\.minecraft\runtime\java-runtime-epsilon\bin\java.exe`；客户端 jar `G:/ck-web26/client-26.2.jar`；启动参数 `G:/ck-web26/launch.args`（由 `G:/ck-web26/make_launch.py` 生成，88 个库 + 5057 个资源已校验，包含 `-Djava.library.path=G:/ck-web26/nat`、`--gameDir G:/ck-web26/shotdir`、`--assetsDir C:/Users/zht/AppData/Roaming/.minecraft/assets`、`--assetIndex 32`、`--username QoderRef`、`--accessToken 0`）。启动方式：`java.exe @G:/ck-web26/launch.args`（参数文件每行一个，注意其中的引号）。
- **必须使用干净的 gameDir `G:/ck-web26/shotdir`**（已有钉好的 `options.txt`）。用户日常 `.minecraft` 实例装了 Fabric+Sodium/Iris 等模组，会污染画面——**不要碰用户的 `.minecraft`**，不要联网下载任何 jar，不要动其它目录。允许写：`G:/ck-web26/shotdir/**`、`G:/web_mc/webcraft26/shots/ref/**`、`G:/web_mc/webcraft26/scripts/ref-capture.mjs` 及其 ps1。
- 反编译源码：`G:/ck-web26/src-vanilla`。

## 思路（可调整；时间盒 2 小时；**05:00 前必须交出至少第一批图**）
1. 读 `net/minecraft/client/main/Main.java`、`client/quickplay/QuickPlay.java`，确认 `--quickPlaySingleplayer <世界名>` 对不存在的世界会不会自动创建；否则用别的办法生成存档（项目里有 NBT 库 `src/vanilla/nbt/**`，可用 tsx 脚本读写 `level.dat`）。**优先超平坦/固定种子**，地面开阔、地形稳定。
2. 首次启动创建世界并正常退出（或 `level.dat` 出现后按 PID 结束 java），然后用 NBT 脚本改 `level.dat`：`DayTime`（正午 6000 / 黄昏 12500 / 午夜 18000 / 黎明 23000）、关闭 `doDaylightCycle` 冻结时间、`Player.Pos`/`Rotation`（站在平地、朝向可控）、gamemode（生存/创造）。**改之前备份 `level.dat`。**
3. 启动 → 等待世界加载完（轮询 `shotdir/logs/latest.log` 里玩家加入信息，或固定等待 40–60 秒）→ 窗口置前 → 按 **F2** 截图（落在 `shotdir/screenshots/`）。按键用 PowerShell（`Add-Type` + `SetForegroundWindow` + `keybd_event`/SendKeys）。**PowerShell 逻辑写成 `.ps1` 文件，用 `powershell.exe -NoProfile -File <路径>` 运行**（本机 CurrentUser 执行策略是 RemoteSigned，本地脚本可直接运行；**不要**加 `-ExecutionPolicy` 之类参数，也不要用别的手段绕过执行策略）。在 bash 里写 PowerShell 单行转义必坏，所以一律写文件；脚本里不要写中文字面量；输出用 `iconv -f GBK -t UTF-8` 转码或写入 UTF-8 文件再读。`options.txt` 设 `pauseOnLostFocus:false`、固定 `guiScale`。
4. 目标镜头（按优先级）：① 午夜野外平视地平线（地形 + 天空 + 月亮 + HUD）；② 午夜仰视天空（月相/星星）；③ 正午平视；④ 黄昏日落；⑤ 生存模式第一人称空手 / 手持石头（能看到 HUD 与手）；⑥ 打开背包（E）；⑦ 手持火把的夜景。每张图文件名写清条件（如 `ref-night-18000-level.png`），记录世界时间/位置/视角/选项到 `shots/ref/INDEX.md`，并用 Read 看图确认确实是游戏画面（不是桌面/黑屏），写 1–2 句描述（颜色、亮度、能看到什么）——这会成为其他员工调参的真值。
5. 做成可重复脚本 `scripts/ref-capture.mjs`（node，内部调 ps1；参数 = 场景名）。
6. **清理**：每次拍完确认你启动的 `java.exe`（按 PID）已退出；不要同时跑多个客户端；机器 GPU 是 GTX 1050 Ti 4GB，且还有别的员工在用浏览器——速度优先、拍完即关。**只结束你自己启动的进程，不要按进程名批量 kill。**

## 降级方案
如果真客户端怎么也跑不起来：写清失败步骤与日志片段，然后改为从 `G:/ck-web26/src-vanilla` 与 `vanilla/assets` 整理**数值真值表**到 `shots/ref/NUMERIC-TRUTH.md`：午夜/黄昏/正午的天空色、雾色、云色、星星参数、光照贴图 16×16 色值（直接按 `shaders/core/lightmap.fsh` 算）、手臂 display 变换。

## 交付
`REPORTS/overnight/ref.md` + `shots/ref/INDEX.md`。每拍出一批图就更新 INDEX（其他员工会读）。
