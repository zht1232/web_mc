# Minecraft 26.2 浏览器复刻

用本机官方 **Minecraft Java Edition 26.2（Chaos Cubed）** 客户端资源，在浏览器里运行的复刻客户端：
TypeScript + WebGL2 + Canvas2D GUI，可走动、建造、带光影和移动端触控。

> 这是粉丝复刻，不是 Mojang 官方产品。`public/mc/` 下的官方贴图/模型/字体/音效只允许在本机私人使用，
> **不要提交公开仓库或公开部署**（详见文末「资源授权」）。

## 运行

需要 Node.js 24+、支持 WebGL2 的浏览器。

```bash
npm install
npm run assets   # 首次/更新官方 26.2 资源后：build-assets + build-states + build-mobs
npm run dev      # http://127.0.0.1:5174/  （或双击 Start-WebCraft.bat）
```

启动后是 **26.2 风格主菜单**（官方 logo / splash / 全景 / 按钮）：

- **Singleplayer**：选择世界（IndexedDB 存档列表）→ Play；或 Create New World 新建。
- **Options / Language / Accessibility** 等子界面来自原版 GUI 移植。
- 暂停菜单的「Save and Quit to Title」会先存档再回标题。

URL 参数：

| 参数 | 作用 |
|---|---|
| `?play` / `?preview` | 跳过主菜单直接进世界（截图/测试脚本用） |
| `?touch=1` / `?touch=0` | 强制开/关触屏层（默认按 `pointer: coarse`） |
| `?seed=<字符串>` | 启动种子（数字或任意字符串） |
| `?world=<id>` | 打开指定存档（世界选择/新建后自动带） |
| `?workers=N` | 区块生成 worker 数 |

资源读取路径：模型/贴图 `G:/ck-web26/vanilla/assets/minecraft`（官方 26.2 `client.jar` 解包），
音效/字体外部资源 `C:/Users/zht/AppData/Roaming/.minecraft/assets`，可用 `MC_ASSETS` / `MC_EXTERNAL` 覆盖。

## 操作

**桌面**：WASD 移动，Space 跳跃/双击飞行，Shift 潜行/下降，Ctrl 疾跑，F 飞行，E 背包，T 聊天，
Esc 暂停，F3 调试屏，**F6 光影开关**；左键挖/攻击、右键放/使用、中键取方块；滚轮/1-9 热栏。

**触屏**（自动或 `?touch=1`）：左侧摇杆移动，右侧拖动视角；右下按钮 跳跃/潜行/挖掘/放置/使用/背包/聊天/暂停，
飞行时出现上/下按钮，双击跳跃切换飞行，底部热栏点按选格。

**聊天命令**（T）：

```
/time set midnight|night|day|18000   /weather rain|thunder|clear
/gamemode survival|creative          /tp ~ ~50 ~     /give torch 16
/summon zombie ~4 ~ ~                /kill          /gamerule advance_time false
```

调试：`window.__mc` 是 `Game` 实例（`level.time`、`player`、`setShaders(bool)`、`setShaderQuality(...)`、`sounds.stats`）。

## 当前实现（2026-11-08）

- **渲染/光影**：官方 16×16 材质、模型、GUI、字体、音效；原版光照曲线 + 平滑光照 + 天光/方块光；
  日月星云、雾、水下色调；太阳阴影（1024–4096）+ PCF；HDR + Bloom + 色调映射 + FXAA + 太阳光轴（F6 开关）；**SSAO + TAA**（high/ultra 档，深度快照驱动）；
  水面顶点波（Fresnel/反射/高光）；第一人称手臂/手持方块/破坏裂纹；原生 GUI 分辨率渲染。
- **夜景 1:1**：与真实 26.2 客户端参考截图逐区域平均色差约 ±3/255（光影关），月亮 25×28 px vs 原版 24×28。
- **世界/玩法**：程序化湖岸世界（13×13 区块）、村庄/遗迹/营地、完整昼夜与天气状态机、
  挖掘/放置/生存（血量/饥饿/掉落/重生）、自然刷怪、25 种可渲染生物（含 12 种本轮补齐的模型）。
- **原版 GUI**：创造物品栏（官方 tab 精灵/滚动/悬停 tooltip）、Survival Inventory、暂停/选项/视频设置、
  世界选择/创建世界、聊天屏、死亡屏、Toast。
- **音频**：959 个原版音效事件（4341 个 ogg，`scripts/build-sounds.mjs` 可重现）、按 SoundType 的脚步/破坏/放置、
  生物叫声/受伤/死亡、雨声循环/雷声。
- **触屏**：Bedrock 风格整套控制层（本日从 M2 找回并适配新输入模型）。
- **Paper 桥接**（`bridge/`）：服务端 WebSocket 插件与协议是历史资产，浏览器端**未接**（按用户要求没动）。

## 验证脚本

```bash
npx tsc --noEmit                                  # 类型检查
for t in scripts/test-*.mts; do npx tsx $t; done  # 18 套单测
npx tsx scripts/test-mobs-render.mts              # 生物渲染 19 项
npx tsx scripts/test-glmath.mts                   # 矩阵工具 6 项
node scripts/test-ao.mjs                          # SSAO 6 项
node scripts/test-taa.mjs                         # TAA 8 项
node scripts/test-menu.mjs                        # 主菜单/世界选择 9 项
node scripts/test-touch.mjs                       # 触屏 15 项
node scripts/smoke.mjs                            # 浏览器冒烟 19 场景（默认 ?play）
node scripts/mgr-shots.mjs <outDir> <steps.json>  # 多步骤截图
node scripts/verify-timelines.mts                 # 原版昼夜时间线逐帧比对
node scripts/build-sounds.mjs                     # 从启动器资源重新导入声音
node scripts/ref-capture.mjs                      # 真实 26.2 客户端参考图
```

## 还不是 1:1

- 光影没有水面反射/折射、体积光/云（SSAO 与 TAA 已在 high/ultra 档提供）。
- 合成台/熔炉/箱子只有界面布局，没有真实交互；饥饿效果、药水、附魔、红石、幼年生物变体未做。
- 生物模型有已知近似（见 `REPORTS/overnight/mobs2.md` 第 5 节）；结构是程序化近似，不是原版 NBT 模板。
- 世界为有限程序化世界，不是真实 Anvil 世界；Paper 联机未接。
- 参考截图 `shots/ref/INDEX.md` 里的 FOV=70 记录是错的（实际 FOV=110，见 `REPORTS/HANDOFF.md` §3）。

## 目录

```
src/client/Game.ts            启动、世界生命周期、输入、渲染循环、菜单接线
src/client/gui/               原版 GUI 移植（ScreenManager、Title/SelectWorld/CreateWorld/Options/库存…）
src/client/renderer/          WebGL2 渲染器：区块/实体/天空/云/天气/阴影/后处理/手持
src/client/touch/             Bedrock 风格触屏层（TouchControls.ts + touch.css）
src/client/world/             区块流式加载、出生点、存档（IndexedDB）
src/client/audio|particle|interaction/  音效、粒子、放置交互
src/vanilla/                  Minecraft 26.2 类库的 TypeScript 移植（world/entity/item/levelgen…)
bridge/                       Paper 26.2 WebSocket 插件 + 协议 + 测试客户端（历史，未接）
scripts/                      build-*（资源导入）、test-*（单测/回归）、smoke/shot/mgr-*（截图）
REPORTS/HANDOFF.md            夜班（夜晚 1:1 + 光影）交付说明
REPORTS/HANDOFF-2.md          本日接管记录（菜单/触屏回归 + 生物模型）
```

## 资源授权

`public/mc/` 属于 Mojang/Microsoft。仅本机私人运行。公网发布时必须让访问者提供自己的官方客户端资源，
或替换为授权/自制素材；不要提交该目录或部署到公网。
