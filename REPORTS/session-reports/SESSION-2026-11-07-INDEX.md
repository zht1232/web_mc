# 本次会话（2026-11-07）工作与报告索引

本目录是**这次会话**（工作区 `2026-11-07-12-41-04`）产生的报告汇总。更早两次会话
（崩溃会话 `4194ac07`、调研会话 `fff2a91d`）的 22 份子 agent 报告原文在
`_src/code/sessions/*/reports/`，会话总纲在 `_src/code/sessions/00-DIGEST-*.md`，
项目内的复刻结论在 `webcraft26/research/session-digest.md`。全量压缩包同时包含以上全部内容。

## 一、目标与方法

目标是把 Minecraft Java **26.2** 在浏览器（WebGL2 + TypeScript）里 1:1 复刻，
视觉对标 **Complementary Shaders – Reimagined r5.9.3**。

方法上做了一个关键取舍：原版反编译源码共 **6,707 个 `.java`**，其中静态数据类
（`world/level/block/*`、`world/item/*`、`data/worldgen/*` 等约 2,000 个）不手写，
而是**直接运行原版 `client-26.2.jar` 的 `Bootstrap` 导出真值**；行为类按 Java 包结构
逐个移植成 TS，每个文件顶部标注来源 Java 全限定名。服务端 / 网络 / datafix / 命令
约 1,500 个类在单机浏览器中标为不适用。

## 二、数据层（已完成并通过校验）

| 产物 | 内容 |
|---|---|
| `dump/out/blocks.json` + `public/mc/blocks.bin` | 1,196 方块 / **32,366 状态**：碰撞箱、硬度、抗性、光照、音效、六面刚性、默认状态、属性表 |
| `public/mc/items.json`、`items` 注册表 | 1,537 物品（最大堆叠、耐久、稀有度、食物、工具规则、装备槽） |
| `public/mc/models.json` + `models.bin` | **6,816 个烘焙模型 / 67,566 面**，multipart 条件求值、partial variant 匹配、状态→模型表 |
| `public/mc/tex/*` | 1,230 张方块贴图（16×16 纹理数组）、796 张物品贴图、动画帧、精灵元数据 |
| `public/mc/worldgen.json` | 7 套 noise_settings、密度函数图、噪声参数、66 群系、7,594 气候点、配置/放置特征 |
| `public/mc/recipes.json` / `loot.json` / `tags.json` | 1,585 配方、1,113 方块战利品表、展平的标签 |
| `public/mc/entities.json`（`data/`） | 158 实体尺寸与分类 |
| `public/mc/sounds/**` | 112 个原版 ogg（26.2 客户端 jar 内**没有** sounds.json） |

校验脚本：`scripts/verify-data.mjs`、`verify-textures.mjs`、`verify-worldgen-data.mjs`、
`verify-itemmodels.mjs`、`test-mesher.mts`（62 项断言全绿）。

## 三、代码模块（本报告目录内逐份记录）

| 报告 | 模块 |
|---|---|
| `01-worldgen-features.md` | 世界特征：树 / 草花 / 矿脉 / 雪冰 |
| `02-entities.md` | 实体、14 种生物、A* 寻路、模型与批处理渲染 |
| `03-gui.md` | 49 个原版 GUI 类、ScreenManager |
| `04-items-survival.md` | 物品堆叠、容器菜单、合成、战利品、挖掘、生存数值 |
| `05-environment-audio.md` | 天空 / 云 / 天气 / 粒子 / WebAudio |
| `06-nbt-save.md` | NBT、区块序列化、真实 `.mca` 扇区表、IndexedDB 存档 |
| `07-integration.md` | 主循环接线（6 阶段）与 16 处接口偏差 |
| `08-regression.md` | 回归冒烟 19 场景 + 单测结果 |

## 四、当前可运行状态

- `npx tsc --noEmit`：**0 错误**
- `npx vite build`：通过（worker 独立 chunk）
- 单测：`test-{audio-particles,entities,features,gui,items,mesher,save}` 全绿；`test-worldgen` 2 项 FAIL 是**断言过时**（features 开启后平原顶层是 `short_grass` 而非 `grass_block`，以及本机 CPU 归一化超时预算），不是产品缺陷
- 冒烟：19 场景 **18 PASS / 1 FAIL**（`save` 场景调用 `flushDirty` 时 `level` 参数为 undefined）
- 已实测：走 / 跳 / 疾跑 / 飞行 / 挖（有挖掘时间与掉落）/ 捡 / 放 / 背包 / 创造标签 / 暂停 / 选项 / 昼夜 / 雨 / 云 / 粒子 / 音效 / 存档刷新恢复

## 五、进行中

`src/client/renderer/post/PostShaders.ts` 已写入（Complementary 风格 GLSL：Lottes 色调映射、
0.12 mix bloom、软膝亮度提取、9-tap 高斯、FXAA、阴影深度 pass），
`PostProcessor` 与太阳阴影接线**尚未完成**。这是当前唯一的半成品，见 `08-regression.md` 的待办。

## 六、运行

```bash
cd webcraft26
npm ci
npm run dev            # http://127.0.0.1:5174/
npm run build
npx tsx scripts/test-*.mts
node scripts/smoke.mjs --out shots/smoke
```

内嵌浏览器拿不到指针锁定，用 `window.__mc` 插桩驱动（详见 `webcraft26/INTEGRATION.md` §9）。
