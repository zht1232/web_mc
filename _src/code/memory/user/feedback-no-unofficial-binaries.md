---
name: feedback-no-unofficial-binaries
description: Never fetch server binaries (plugin jars, exes) from random mirrors or unofficial hosts; when the official channel needs an account, offer "you download it yourself" vs "build from official source" and let the user pick
metadata:
  type: feedback
---

需要往用户服务器上放二进制（尤其能拿到 API key / 能执行控制台命令的 Minecraft 插件）时，**只用官方渠道或官方源码自编译**。官方渠道匿名下载不了，就把话说清并给两个选项：① 他自己注册账号下载；② 我从官方仓库源码编译。不要从第三方镜像站/个人网盘抓 jar。

**Why:** 这类 jar 会读网站 API key、能执行命令，来路不明的包风险不成比例。用户对此的反应是接受并选了"下载 GitHub 源码我电脑有 maven"，说明这条界线他认同，直接说明成本比擅自找镜像好。

**How to apply:** 先验证官方渠道（API 查 releases、试匿名下载看状态码），失败就明确报告"我下不到，原因是什么"，不要含糊带过，也不要因为下不到就不做后续准备（clone、配 JDK/Maven 可以照做）。

相关：[[feedback-verify-claims-before-recommending]]、[[user-profile]]
