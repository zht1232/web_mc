# Horizon 对照覆盖率报告（2026-11-21）

> 目的：回答“Horizon 到底 clone 完整了吗、除用户问题外的功能是否真的逐项对照过”。
> 结论先说：**上一轮没有做到真正全量对照。** 本地 Horizon 是完整 Git clone，但 `sparse-checkout` 只勾选了
> `crates/horizon-client-render` 一个 crate；其余 70+ crate 没有检出，所以上一轮只对照了客户端渲染/UI/音频，
> 生物 AI、世界生成、物品栏语义、村民/进度/酿造/附魔等大量功能**没有做 Horizon 代码级对照**。
> 现在已通过镜像下载完整源码并补做了关键对照；本文件明确区分“代码级 / 清单级 / 未对照”。

---

## 1. 源码获取状态

| 项 | 结果 |
|---|---|
| 原仓库 | `https://github.com/horizon-rust/horizon.git` |
| 原本地目录 | `horizon`（完整 Git clone，`blob:none` partial clone） |
| 原 sparse-checkout | **只有 `crates/horizon-client-render`**；`Cargo.toml` 列出的 70+ crate 未检出 |
| 加速镜像 | `https://mirror.mikus.ink/` + 原 GitHub URL（来自用户提供的 mikus 博客） |
| `git clone` 镜像 | 失败：`HTTP 500` / `expected flush after ref listing` |
| 源码压缩包镜像 | **成功**：`horizon/archive/refs/heads/main.tar.gz`，60,297,930 bytes |
| 解压位置 | `horizon-main` |
| 解压结果 | 75 个 crate；`horizon-client/src` 2,745 个文件；`horizon-client-render/src` 548 个；`horizon-items/src` 50 个；`horizon-world/src` 414 个；`horizon-core/src` 93 个 |
| 备注 | 解压时根目录 `CLAUDE.md` 在 Windows 上创建失败（大小写/保留名冲突），源码主体完整；关键路径已抽查 |

**以后引用 Horizon 全量代码请用 `horizon-main`，不要再用 sparse 的 `refs\horizon` 判断“Horizon 有没有实现”。**

---

## 2. 覆盖率定义

| 标记 | 含义 |
|---|---|
| **代码级** | 双方实现都读了关键代码，能指出具体行为差异（本报告只对少数子系统做到） |
| **清单级** | 只确认 Horizon 是否有对应模块/文件，未逐行为对照 |
| **未对照** | 没有读 Horizon 对应实现，结论只来自本项目代码或原版常识 |

---

## 3. 覆盖率矩阵

| # | 功能域 | 本项目状态 | Horizon 对应（horizon-main） | 本轮对照深度 | 主要结论 |
|---|---|---|---|---|---|
| 1 | 启动/加载屏 | ✅ | `horizon-client/src/game/interface/startup_menu.rs` | 清单级 | 双方都有；Horizon 还带 narrator/quick-play/模组浏览器 |
| 2 | 标题屏/旋转全景 | ⚠️ 2D strip | `horizon-client-render/src/gfx/panorama.rs`、`panorama.wgsl`、`title_edition.rs` | **代码级** | Horizon 是真 cube map（85° 透视、可俯仰）；我们是 4 面 2D 长卷 + cross-fade |
| 3 | 单人游戏/世界选择/创建/编辑/删除/备份 | ⚠️ 占位图标、无搜索、Edit toast、整页刷新 | `horizon-client/src/title/{world_management,create_world,edit_world,world_folder,world_toast}.rs`、`game/interface/startup_menu.rs` | **代码级** | Horizon 有完整世界目录操作、level.dat 改名、session.lock、ZIP 备份；我们进入不同世界靠 `location.href` 整页刷新 |
| 4 | 选项/控制/语言/音频/资源包/无障碍 | ⚠️ 部分 | `options_ui*.rs`、`game/interface/options.rs`、`narrator.rs` | 清单级 | Horizon 选项体系完整；我们视频/音频/语言有，资源包/无障碍/叙述者多为占位 |
| 5 | HUD/聊天/字幕/进度/统计 | ⚠️ HUD/聊天有，进度/统计/字幕缺 | `game/interface/{hud_render,chat,subtitles,advancements_screen,stats_screen}.rs` | 清单级 | 我们进度/统计只弹 toast；Horizon 有完整界面与数据 |
| 6 | 背包/容器/创造/装备/快捷栏 | ❌ 创造装备/拖放有严重缺口 | `container_screen.rs`、`game/interface/{creative_screen,inventory_input,inventory_slots}.rs`、`horizon-client-render/src/containers.rs` | **代码级** | Horizon 有完整 quick-craft/double-click/250ms 状态机、创造页签/搜索/Inventory 页/盔甲/副手/销毁槽/工具提示；我们创造屏只有 45+9 格，且格子点击绕过父类状态机 |
| 7 | 合成/熔炉/酿造/附魔/铁砧/村民交易 | ⚠️ 合成/熔炉有，其余缺 | `game/blocks/stations/*`、`game/items/{table_enchant,enchant_effects}.rs`、`mobs/villager_trades_tests.rs` | 清单级 | Horizon 有酿造/附魔/村民交易；我们没有这些行为 |
| 8 | 掉落物/经验球/弹射物 | ❌ 掉落物渲染占位 | `horizon-client-render/src/render_slots.rs`、`mobs/drops.rs`、`projectiles/*` | 代码级（掉落物）/清单级 | 我们的 ItemEntityRenderer 是 4px tint cube；Horizon 用物品模型 + bob/spin/stack |
| 9 | 玩家移动/飞行/游泳/骑乘/船/矿车 | ⚠️ 基础移动有；骑乘/船/矿车缺 | `game/interface/{play_input,perspective,fov}.rs`、`mobs/equine.rs` | 部分代码级 | 飞行上限数值接近，但垂直速度瞬时赋值、双击 280ms、悬停冲刺取消等手感不同；Horizon 有完整骑乘 |
| 10 | 方块交互/放置/破坏/工具/耐久 | ⚠️ 基础有 | `horizon-world/src/{block_placement,block_survival,block_support,component_durability}.rs` | 清单级 | 我们放置/破坏有，但空栈残留 `item` 导致手上还有方块；Horizon 用 `ItemStack.isEmpty()` 统一判定 |
| 11 | 生物 AI/繁殖/驯服/幼年/村民/铁傀儡/首领 | ❌ 大量缺 | `horizon-client/src/mobs`（214 文件）、`game/mobs`（140 文件）、`mobs/ai.rs`、`animal_brain.rs` | **代码级（关键路径）** | Horizon 明确 `creative/spectator/Peaceful` 不成为目标（`mobs/ai.rs:1016-1023`），有食物 tempt 传感器、繁殖、村民、装备、mobGriefing；我们 TemptGoal 是桩、无创造过滤、苦力怕无保护 |
| 12 | 苦力怕/爆炸/方块破坏规则 | ❌ | `mobs/creatures/mob_griefing_tests.rs`、`explosion/*` | **代码级** | Horizon 有 `can_entity_grief` / `mob_griefing` 规则与模组事件；我们无创造/难度/mobGriefing 判定 |
| 13 | 世界生成/洞穴/结构/群系/下界/末地 | ⚠️ 核心密度图 + 村庄近似 | `horizon-world/src/worldgen/{generator,carver,carving,cave,density,biome,generator_structures,...}.rs`、`horizon-core/src/{noise,density}/*` | **代码级（存在性/管线）** | Horizon 有 carvers/caves/structures/feature graph/含水层/blending；我们明确未移植 carvers/OreVeinifier/Beardifier/Blender/biome zoom，结构只有程序化村庄 |
| 14 | 同种子一致性 | ❌ 无 golden test | `horizon-core/src/bin/noise_parity.rs`、`horizon-world/src/bin/worldgen_parity.rs`、`horizon-core/src/random/worldgen/oracle_tests.rs` | **代码级（工具存在性）** | Horizon 建了 Java noise/worldgen 对照二进制；我们只有“本项目内同种子可重复”，没有 Java 逐位对照 |
| 15 | 光照/天空/天气/粒子/云/水 | ⚠️ lightmap + 自研阴影；天空有缝 | `light.rs`、`custom_sky.rs`、`environment.rs`、`weather.rs`、`clouds.rs`、`terrain.wgsl` | **代码级（天空/阴影）** | 地形与天空都已传 `cameraForward`/sunrise（已复核）；剩余风险是 GL clear 用原始 fog + sky disc 512 裁边，日落近地平线可能露底；阴影乘子压到方块光，火把被硬切；Horizon 有统一环境管线 |
| 16 | 音效/音乐/唱片 | ❌ 无 music/record 资源 | `horizon-client-render/src/{sound_engine,sound_events}.rs`、`game/interface/music.rs` | **代码级（音乐）** | Horizon 有完整 MusicManager、situational music、music toast、Music 选项页；我们 `public/mc/sounds` 没有 music/record 目录，`music.*` 被别名到水/水下音效 |
| 17 | 存档/多人/LAN/命令/权限 | ⚠️ IndexedDB/.mca；多人未接 | `horizon-client/src/lan/*`、`multiplayer.rs`、`game/network/*`、`horizon-server` | 未对照/清单级 | Horizon 有完整 LAN/服务器/协议；我们的 `bridge/` 未接线 |
| 18 | 性能/动态分辨率/光影包 | ⚠️ 自研后处理 | `dynamic_resolution.rs`、`post_chain.rs`、`shader_pack_list.rs`、`pack_post/*` | 部分代码级 | 我们有 HDR/bloom/SSAO/TAA/FXAA，但不是 Complementary/光影包管线；Horizon 支持 shader pack host |
| 19 | 模组/资源包/皮肤/遥测/手柄/无障碍 | ❌ 大部分缺 | `mod_*` crates、`packs.rs`、`skins.rs`、`pad/*`、`narrator.rs` | 未对照/清单级 | 不在本轮范围；Horizon 覆盖远大于我们 |
| 20 | 反作弊/服务器专用系统 | ❌ | `horizon-anticheat`、`horizon-server*` | 未对照 | 本项目没有对应层 |

---

## 4. 上一轮报告需要更正的说法

| 上一轮说法 | 更正 |
|---|---|
| “Horizon 是单个 crate `horizon-client-render`” | 错。仓库有 75 个 crate；只是 sparse-checkout 只勾选了渲染 crate |
| “Horizon 未包含完整世界选择 UI” | 错。`title/world_management.rs`、`create_world.rs`、`edit_world.rs`、`startup_menu.rs` 都在 |
| “Horizon 没有完整世界生成” | 错。`horizon-world/src/worldgen` 有 carver/cave/generator_structures/density/feature graph，`horizon-core` 有 noise/density 与 parity 二进制 |
| “Horizon 未包含村民/进度/统计/酿造/附魔” | 错。`game/interface/advancements_screen.rs`、`stats_screen.rs`、`mobs/villager*`、`brewing_*`、`enchant*` 都在 |
| “Horizon 未包含音乐管理” | 错。`game/interface/music.rs` 有完整 situational music/MusicManager |

**上一轮仍然有效的部分**：对我们自己代码的 bug 结论（掉落物占位、创造装备缺失、拖放状态机断裂、空栈 `item` 残留、TemptGoal 桩、无创造过滤、羊毛 0.6、内置弓、阴影压方块光、无 music 资源）都在本项目代码中逐条验证过，不依赖 Horizon。“天空三套雾色”已更正为“clear 与 sky disc 边缘风险”（地形/天空实际都传了 cameraForward）。

---

## 5. 还没有做到“逐项对照”的部分（明确清单）

1. **1537 个物品/方块的逐项行为**：没有逐个对照放置、工具、耐久、堆叠、食物、燃料、附魔、药水。
2. **所有生物物种**：Horizon `mobs` 有 214 个文件（含村民、灾厄、Boss、马/骆驼、水生、幼年、繁殖、装备），我们只抽查了 Tempt/LookAt/Nearest/Creeper/Sheep/Skeleton。
3. **所有结构/群系/feature**：没有逐个结构模板、拼片、生物群系参数、矿脉/植被表对照。
4. **所有 GUI 屏幕/控件**：Horizon `game/interface` 192 个文件，我们 22 个 screen；没有逐屏逐控件对照。
5. **协议/多人/服务器/模组/手柄/无障碍**：完全没有代码级对照。
6. **Java 原版逐位 parity**：没有建立 noise/worldgen/区块 hash golden test；Horizon 有，我们没有。
7. **音效事件全表**：只确认了 index 959 事件与 music 缺失，没有逐事件对照原版 `sounds.json`/分类/音量/衰减。
8. **渲染管线全量**：只对照了天空/阴影/后处理参数，没有逐 shader pass、材质、粒子、云、水。

---

## 6. 覆盖流水线（已落地）

2026-11-21 晚已按“自动清单 → 行为审计 → parity”开始落地，产物在 `REPORTS/coverage/`：

| 层 | 脚本/产物 | 当前结果 |
|---|---|---|
| 自动清单 | `scripts/feature-inventory.mjs` → `coverage/feature-inventory.{md,json}` | 本项目 158 EntityType / 29 mob 工厂 / 22 screen / 26 feature / 959 音效；Horizon 75 crate / 6,218 `.rs` / 90 Species / 83 worldgen 模块 / 995 测试文件 |
| 源码结构审计 | `scripts/audit-p0.mjs` → `coverage/p0-audit.{md,json}` | 13 项检查，13 项 `GAP`（逐项对应本报告前面的问题） |
| 实机行为审计 | `scripts/audit-behavior-p0.mjs` → `coverage/behavior-p0.{md,json}` | B-01 空栈仍显示、B-02 创造拖放后光标仍持有、B-03 创造玩家被僵尸选为目标，均已复现 |
| parity 前三层 | `scripts/parity/dump-rng.mts`、`dump-noise.mts`、`dump-density.mts` + `compare-parity.mjs` | RNG 48 + `minecraft:aquifer_barrier` 7 + `final_density` 8 样本导出/自比较 PASS；**还没有 Java golden**，不能声称同种子一致 |

运行方式见 `REPORTS/coverage/README.md`。

### 6.1 下一步

1. **parity 继续往下**：
   - `dump-chunk.mts`：chunk block-state hash；
   - 先接 Java golden，再修 RNG/noise/density，最后修 surface/carver/feature/structure。
2. **行为审计扩到全部 P0**：
   - 掉落物真实模型/数量/bob-spin；
   - 创造屏装备/副手/2x2/预览；
   - 苦力怕创造模式不膨胀、不伤害、不破坏；
   - 羊羊毛 body 1.75、骷髅空手/持弓两态。
3. **每个修复配一个 Horizon 对应测试名**：`mob_griefing_tests.rs`、`inventory_changed_tests.rs`、`breeder` 相关测试等，直接作为用例清单。

---

## 7. 一句话总结

**Horizon 现在已经完整拿到（75 crate，`refs/horizon-main`），但“所有功能都逐项对照过”在此之前并不成立。**
上一轮是“围绕用户报告 + 客户端渲染/vanilla 的定向审计”；现在补上了关键子系统的代码级对照，并明确了 8 类仍未覆盖的区域。
后续如果要把“全量对照”做实，应按本文件第 6 节的自动清单 + 行为对照 + parity 工具推进，而不是再靠人工抽样。
