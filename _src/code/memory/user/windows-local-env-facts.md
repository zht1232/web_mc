---
name: windows-local-env-facts
description: Non-obvious facts about this Windows machine — SSL interception breaks TLS downloads, codepage 936/GBK output, cmd.exe blocked, complex PowerShell must go through a .ps1 on G:, portable PHP/Composer, C: near-full so large downloads go to G:, MSLX daemon on 127.0.0.1:1027
metadata:
  type: user
---

本机（Windows, 主机名 DESKTOP-00CLCEE）几个会反复踩坑的环境事实：

- **网络存在 SSL 中间人拦截**：`git` / `composer` / 默认 `curl` 常报 `SSL certificate problem: unable to get local issuer certificate`（curl exit 60）。绕过方式是 `curl.exe -k`，PHP 侧用 `CURLOPT_SSL_VERIFYPEER => false`。
- **系统代码页 = 936**（注册表 OEMCP 和 ACP 都是 936，未开 UTF-8 beta）。因此含中文的 `.bat` 必须存成 **GBK + CRLF**；不要依赖 `chcp 65001` 的兼容性。Write 类工具产出的是 LF，需要额外转成 CRLF（label/goto 在 LF 批处理下有解析风险）。
- **安全策略拦截从 Bash/PowerShell 工具调用 `cmd.exe`**，所以批处理脚本无法自动运行验证，只能静态核验 + 回读解码校验。
- 便携版工具位置：
  - PHP 8.5.10：`C:\Users\zht\Downloads\php-8.5.10-Win32-vs17-x64\php.exe`（php.ini 已开 mysqli / pdo_mysql / gd / intl / exif；同目录有 cacert.pem）
  - Composer：`C:\Users\zht\Desktop\dsh-work\composer.phar`（已全局 `disable-tls true` + `secure-http false`）
  - 有 winget，**无 Docker**
- 国内镜像可用：清华 `mirrors.tuna.tsinghua.edu.cn`、阿里 `mirrors.aliyun.com`。
- **`curl.exe` 的 MSYS 路径陷阱**：在 Git Bash 里写 `-o /g/xxx` 会静默失败（HTTP 200 但落地 0 字节），必须写成 `-o G:/xxx`。
- **Git Bash 里 curl 发含中文的 JSON 会乱码**（代码页 936 转码，实测发给 LLM API 的中文 prompt 变成 Mojibake）：payload 必须写成 UTF-8 文件再 `--data-binary @file`。Python 侧同理，跑脚本前设 `PYTHONIOENCODING=utf-8`。
- **pip 装 cupy 在 Windows 上不够用**：`cupy-cuda12x` 装完仍报 `Failure finding "known nvJitLink DLL"` / `known cusparse DLL`——`nvidia-*-cu12` 这些包只发 Linux `.so`，Windows 必须本机装 NVIDIA CUDA Toolkit（约 3GB）才有对应 DLL。清华源没有 `cupy-cuda12x`，阿里源有。
- **Java / Maven 都是"裸材料"状态**：JDK 在 `G:\Minecraftserver\DaemonData\Tools\Java\{17,21,25}`（MCSManager 面板自带），`java` 不在 PATH；Maven 只有 `C:\Users\zht\Downloads\apache-maven-3.9.16-bin.zip`（没解压、没配 JAVA_HOME）；git 在 `E:\Git\cmd`（Git Bash 本身）。要编译就先自己解压 Maven + 手动 export `JAVA_HOME`/`PATH`。
  - 但 **`java.exe` 确实存在**，只是不在 PATH：除了上面三个 JDK，还有一个可用的 **Java 25** 在 `C:\Users\zht\AppData\Roaming\.minecraft\runtime\java-runtime-epsilon\bin\java.exe`（PCL 启动器管的 `.minecraft`，Minecraft 26.2 的 88/88 库与 5057/5057 资源都在，能直接开原版客户端）。`javap` 同理可用（用绝对路径）。
- **Maven 直连 `repo.maven.apache.org` 只有约 9KB/s**（checkerframework 这类 20MB+ 的包要几十分钟）。解法：写一个 `settings.xml` 把 central 镜像到 `https://maven.aliyun.com/repository/public`，用 `mvn -s <该文件>` 跑。注意 Java 的 TLS 在本机的 SSL 拦截下是正常的（中央仓库能连通，只是慢），不需要额外配 truststore 或关校验。
- **便携 PHP 没有 `pdo_sqlite`**（只有 `pdo_mysql`），打不开 `.db`。要读 SQLite（例如 AuthMe 的 `authme.db`）改用 Python 的内置 `sqlite3`，并用 `file:...?mode=ro` URI 强制只读。
- PowerShell 可用且好用：`Get-CimInstance Win32_Process -Filter "Name='java.exe'"` 查命令行能反推服务实例目录；`Start-Process -WindowStyle Minimized` 拉独立进程（用户不要 Windows 服务）。
- `curl.exe` 的 `-w` 不支持 `%{http_num_request}`；偶发 `http_code=000`（连接被中途重置）加 `--retry 2` 就好，别急着判定"站点挂了"。
- **硬件**：8 个逻辑核；显卡 **GTX 1050 Ti 4GB**（Pascal，驱动 582.66）。跑常驻计算进程要留意核数预算——多线程不一定更快（果蝇仿真实测 2 线程 14ms/步，8 线程反而 31ms/步还吃满 4 核）。
- **清华源没有 `cupy-cuda12x`**（`No matching distribution found`）；要装 CUDA 相关轮子得换阿里源或官方源，并注意 Pascal 在新版 cupy/CUDA 13 里已被淘汰。
- **Git Bash 没有 `strings`**；扫 jar 里的字符串改用 `unzip -p … | grep -a`。
- **PowerShell 命令放进 bash 时用单引号**：双引号里 `$_`、`$p` 会被 bash 先展开，导致 PowerShell 语法报错（表现为一大串 ParserError 乱码）。
- **Python 脚本往控制台打中文/emoji 会 GBK 崩**（`UnicodeEncodeError: 'gbk' codec`）：跑之前 `PYTHONIOENCODING=utf-8`，或让脚本只输出 ASCII（把 ✅/❌ 换成 PASS/FAIL）。
- **venv 可以整目录改名搬迁**（同盘 `mv` 秒完成），只要 `pyvenv.cfg` 里的 `home`（基础解释器路径）还在就能继续用。
- **Git Bash 的 PATH 里没有 `pwsh`**（实测 `pwsh: command not found`）：PowerShell 用 `C:/Windows/System32/WindowsPowerShell/v1.0/powershell.exe -NoProfile -Command '...'`；脚本用 `-File`。命令放进 bash 时继续用单引号包住，避免 `$` 展开。
- **Git Bash 会把 `/svc` 之类参数当路径**（`tasklist /svc` 报 `E:/Git/svc`）：查进程改用 PowerShell `Get-CimInstance Win32_Process`，不要依赖 cmd 风格参数。
- **公网经 Cloudflare Tunnel**：cloudflared 以 LocalSystem 服务运行，`sc stop/start` 需要管理员/UAC。公网 1033/530 而本机 `127.0.0.1:10277` 仍 200，通常是隧道没连上；重启 cloudflared 服务后恢复（2026-10-25 实测）。
- **C: 系统盘长期吃紧**（2026-10-31 约 767MB → 2026-11-01 实测 100%、剩 0.16~0.42GB 波动 → 同日按用户批准清理后剩 **25GB，已用 80%**）：任何下载/临时文件/解包/扫描报告仍优先直接写 **G:**（约 86GB 可用）或 `D:\tmp`（约 111GB），否则会 ENOSPC 截断；node/vite 缓存和浏览器缓存也在 C:，接近满盘会让构建和页面加载明显变慢（实测世界生成从 10-25s 拖到几分钟）。发现这个级别的空间问题时提醒用户清理，但不要自作主张删他的盘。C 盘占用明细、本次已删项和剩余候选见 [[c-drive-space-inventory]]。
- **PowerShell 复杂命令别塞进 bash 的 `-Command`**：单引号里再写 `\"` 会被 PowerShell 当成 `\` token（实测 `@{n=\"SizeGB\"}` 和 `\"C:\\\"` 都直接 ParserError/CommandNotFound），而且报错是 GBK 乱码很难读。超过一两行的 PS 一律用 Write 存成 `G:\...\scan.ps1`，再 `powershell.exe -NoProfile -ExecutionPolicy Bypass -File <路径>`，结果 `Set-Content/Add-Content -Encoding UTF8` 写到 G 盘报告文件后用 Read 读——既绕开转义又绕开代码页。
- **PS 里 `ForEach-Object { $arr += ... }` 的累加会丢**（实测整段目录大小统计写成空文件）：要么改用 `foreach ($x in $coll) { }` 语句，要么改成对 hashtable/数组的就地赋值 `$h[$k] += $v`；变量重新赋值在管道脚本块里不可靠。
- **PowerShell 中文输出在 bash 里是乱码**：命令后面接 `2>&1 | iconv -f GBK -t UTF-8`，或把结果写 UTF-8 文件再读。
- **休眠/页面文件/卷影副本改动都要管理员权限**（非提权时 `powercfg -h query`、`vssadmin list shadowstorage` 直接报"需要管理员权限"）；`Get-CimInstance Win32_PageFileUsage` 普通权限可读。
- **MSLX 守护进程/面板监听 `127.0.0.1:1027`**：`/api/status`、`/api/instance/list`、`/api/instance/players/online/1` 可用 `x-api-key` 访问；实例 1 是 Paper 26.2 + Java 25，目录 `G:\Minecraftserver\DaemonData\Servers\1`。API key 和 RCON 密码不要写进记忆。

