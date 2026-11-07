---
name: c-drive-space-inventory
description: C 盘 118GB 分布 + 2026-11-01 实际清掉了哪些（Win11 镜像、全部 ollama 模型、夸克数据已不存在），还剩哪些要他点头/要管理员
metadata:
  type: user
---

2026-11-01 用只读扫描（报告写在 `G:\qoder-tmp\cdrive\`，全程没删任何文件）摸清 C 盘 118GB 的分布。其他盘余量：D 111GB、E 336GB、F 284GB、G 86GB。

**顶层：** `C:\Users` 56.4GB｜`C:\Windows` 31.6GB（WinSxS 17.6GB、System32 8.0GB 含 DriverStore 3.2GB）｜`C:\Program Files (x86)` 7.1GB（Edge 2.8 + WebView2 2.8）｜`C:\Program Files` 3.1GB｜`XboxGames` 2.0GB｜`ProgramData` 1.9GB｜根目录 `hiberfil.sys` **9.58GB** + `pagefile.sys` 分配 8.33GB（实际只用约 0.7GB）+ swapfile 0.02GB。

**`C:\Users\zht` 内部：** AppData 25.2GB｜`.ollama` 9.1GB｜Documents 7.9GB｜Desktop 4.0GB｜WorkBuddy 2.4GB + `.workbuddy` 1.9GB｜`.codex` 1.2GB｜`.vscode` 1.19GB（几乎全是 extensions）｜`.cache` 1.05GB（全在 `codex-runtimes`）｜`.gradle` 0.74GB｜`.qoder` 0.5GB（logs 占 0.3GB）｜`.dsh` 0.41GB。AppData 里的大头：`Local\Programs\Qoder` 2.88GB、`Local\Quark\User Data` 2.86GB、`Local\Programs\Ollama` 2.81GB、`Local\Microsoft\Edge\User Data` 1.03GB、`Roaming\npm\node_modules` 0.96GB、`Local\OpenAI\Codex` 0.70GB、4 个 `*-updater\installer.exe` 合计 1.29GB。

**2026-11-01 已按用户批准删除（下次别再假设它们还在）：** `C:\新建文件夹` 整个 Win11 25H2 解压镜像 + 同名 torrent（8.27GB）｜**`.ollama\models` 全部 5 个模型 9.0GB**（qwen3.5 4b/2b/0.8b、qwen/0.5b、munoz_danilo/deepseek-v4-flash —— 本机已无可用本地模型，要用得重新 `ollama pull`，Ollama 程序和 `.ollama\cache/history/id_ed25519` 保留）｜`Local\Quark` 2.9GB（注册表本来就没有卸载项，只是残留 user-data）｜Qoder `.qoder-versions\0.4.2` + `0.4.11`（当前跑 0.5.1）｜4 个 `*-updater\installer.exe`｜VS Code `CachedExtensionVSIXs`、`uv\cache`、`pnpm-cache`、`npm-cache`、NVIDIA DX/GL、资源管理器缩略图｜`.qoder\logs` 里 7 天前的条目。C 盘从剩 **0.42GB → 25GB**（回收约 24.6GB），执行日志在 `G:\qoder-tmp\cdrive\cleanup_log.txt`。

**用户当时说"其他别动"，所以这些仍未动、下次还要他点头：**
- `Documents\Codex` 6.8GB 旧会话工作副本，集中在 `2026-09-30\g-mc-c-users-zht-desktop`（5.6GB）和 `2026-09-24\bu`（1.15GB），删前要先确认不是某项目唯一副本。
- Desktop 上 `minecraft` 1.76GB + `EM精英怪` 0.96GB + `构建工具` 0.29GB + 一个 `.mrpack` 0.18GB 适合搬 G 盘。
- `.cache\codex-runtimes` 1.05GB、WorkBuddy 2.4GB + `.workbuddy` 1.9GB（当时在运行）。

**明确保留：** `.gradle\caches` 和 `.m2`（Java 编译要用，本机重下很慢）、`ms-playwright` 0.68GB（浏览器验收要用）、Edge/微信/QQ 的 profile 与登录数据、Program Files、`D:\backups` 的 MILESTONE。

**只能提权做的：** `powercfg /h off`（腾 9.58GB，代价是没了休眠和快速启动）、页面文件缩小或迁 D 盘（要重启）、`DISM /Online /Cleanup-Image /StartComponentCleanup`（WinSxS 17.6GB，一般回收 2-6GB、跑 30-60 分钟）、`vssadmin list shadowstorage`。

**Why:** 用户直接说"清一下 C 盘"，但真正值钱的回收项都是他的数据或运行中的应用，纯缓存只有约 4.4GB；下次再处理要能一眼分辨"我自己能清 / 要他点头 / 要管理员"。

**How to apply:** 先按这份清单定位大头，别从头再扫 10 分钟；给方案时按"我能直接清 / 要他点头 / 要管理员"三档分组，一次给一个推荐包，不要开菜单。数字会随他用机变化，动手前重新读一次目标目录大小。**回收量要用 `df -h /c` 复核**：本次自写的 PS1 里 size 辅助函数返回了 0，日志整页 "freed 0.0 MB" 但实际删掉了 24.6GB —— 日志数字不可信。另：PowerShell 里 `-f` 格式化串和 `@{n=...}` 哈希表塞进 bash 单引号必坏，一律先 Write 成 `.ps1` 再 `-File` 跑；脚本里**不要写中文字面量**（PS 5.1 按 GBK 读无 BOM 文件），要匹配 `C:\新建文件夹` 就用 `Where-Object { $_.Name -match '[^\x00-\x7F]' }`。相关：[[windows-local-env-facts]]、[[feedback-backup-before-changing-env]]、[[feedback-close-decisions-dont-circling]]。
