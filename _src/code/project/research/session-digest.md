# 两次会话调研成果总纲（2026-11-01）

这份文档是"崩溃会话 4194ac07 + 当前会话 fff2a91d"的全部调研结论汇总。细节证据在
`sessions/*/reports/*.md`（22 份子 agent 报告原文）与本目录其它文件里；这里只放**可以直接指导实现的结论**，
每条都标了来源。数字一律来自本机官方文件或反编译源码，不来自 wiki 记忆。

## 0. 项目定位与验收标准

- 目标不是"看着像"，是**逐项 1:1**：Steve 的手、手持方块的位置、库存图标角度这类细节都要按原版来。
- 视觉类改动必须和**真实原版截图并排比**；只逐项比外观，不逐像素比地形（我们的生成器不是原版的）。
- 基线：先关光影对原版，再开光影对 Complementary。
- 光影不许自己编，直接用解包出来的 Complementary Reimagined 的实现与默认参数。

## 1. 现状审计（代码证据，2026-11-01）

本质是**创造模式渲染器 + 菜单壳子**，不是生存游戏。五个架构级卡点：

1. 运行时没有 blockstate 系统（旧构建脚本每方块只烘一个固定朝向，遇 multipart 直接 throw）→ M1b 已离线解决，见 §6。
2. 没有物品/堆叠模型（快捷栏是 `BlockDef[9]`，无数量/耐久/组件/纯物品）→ 合成、容器、掉落、食物全部无处可挂。
3. 世界是死的 13×13 chunk，每列固定 384 格高（≈49MB typed array），改一个方块要重建 3×3 全高网格 + 41³ 重光照；渲染距离滑杆超过 6 只是拉雾。
4. 没有世界 tick（无随机刻、无树叶衰减、无重力方块、无邻居更新）。
5. 多人是空壳：Paper 插件端 1,205 行是真的（协议/调色板 RLE 区块/盔甲架分身/限流），但 `src/` 里 `WebSocket` 出现 0 次，"加入服务器"是 2.8 秒假进度条。

**"看着有、其实没接线"**：硬度数据已烘进 manifest 但零引用（所有方块一下破坏，基岩也能挖）；`rain.png`/`snow.png`/`vignette.png`、经验条/副手贴图、`tab_item_search.png`、熔炉/工作台/箱子界面贴图全部下载但无绘制路径；生存背包只有底部 9 格可点；4 个创造分类是空数组；生物死亡不掉任何东西（`onMobDeath` 从未赋值）；阴影只画地形（生物和水不投影）；天气、饥饿、氧气、经验、游戏模式、存档全部 ABSENT（世界不保存，时间固定从 1000 tick 起）。

## 2. 原版 26.2 实测规模（"要做多少"的底）

| 面 | 原版实测 | 我们（当时） |
|---|---|---|
| blockstate | 1,198（1,096 variant + 102 multipart），61 种属性、7,296 变体条目 | 85 方块各 1 朝向 |
| 方块模型/贴图 | 2,657 模型（1,183 元素 / 4,227 面）、1,269 张 block 贴图 | 103 张贴图 |
| 物品定义 | 1,537 个 `items/*.json`（组件选择器层） | 0 |
| 配方 | 1,585 / 21 种类型（合成 733、无序 323、切石 319、熔炼 73…） | 0 |
| 生物群系 | 66（含 pale_garden、sulfur_caves、deep_dark），tint/天空/雾/音乐已迁到新的 **attributes** 注册表 | 硬编码 12 |
| 结构 | 34 结构 + 20 set + 188 pool + **1,212 个 .nbt 模板打进客户端 jar（3.7MB，村庄 483 件）** | 手搓盒子村庄 |
| 实体 | 0 个 JSON 模型（纯代码）、725 贴图 / 79 家族、1,210 实体类 | 4 种手搓立方体 |
| 战利品表 | 1,355（方块掉落 1,113） | 0 |
| 语言键 | 8,123 + 454 条 splash | 硬编码英文串 |
| GUI 贴图 | 466 独立 sprite / 24 组 | 用了 8 张 |
| 粒子 | 112 种 / 288 贴图 | 1 种 |
| 音效 | **jar 里没有 ogg、没有 sounds.json**（必须从远端 assets index 拉） | 28 事件 |

## 3. 被实测推翻的假设（不要再重复它们）

1. **multipart 不是边角料**：102 文件 / 1,132 条目，栅栏、玻璃板、墙、铁栏杆、红石线、火、藤蔓、书架全靠它。原来以为"做 variant 分发器就吃下 90%"是不对的。
2. **`weight` 基本不存在**：variants 里 0 次，multipart 里 6 次且恒为 2（只在 chorus_plant）。随机变体的权重是**数组里重复条目**（56 个键是数组，46 个是同模型×4 旋转，`netherrack` 是 16 项）。
3. **`CombinedCondition` 只有 AND/OR**，26.2 已无 `INVERT`；`face` 上也没有 `uvlock`/`uvscale` 字段，uvlock 只存在于 blockstate 变体对象（2,528 次，恒 true）。
4. **`builtin/generated` 已死**（1,271 个物品模型里只剩 1 个）：26.2 的物品外观走 `items/*.json` 组件选择器，"物品=一张平面贴图"的做法不成立。
5. **空气/水/火都有 blockstate 文件**（1,196 个注册方块全部有）；真正的分类是"有 blockstate 但父链无几何"= 59 个模型（水/岩浆/气/头颅/箱/潜影盒/`light_00..15`/活塞头…），必须走特殊渲染。
6. **火把模型只有柱体一个元素**（`template_torch` = [7,0,7]-[9,10,9]，6 面，`ambientocclusion:false`）：火焰不在方块几何里，26.2 用元素级 `light_emission` + 第二层 `cross_emissive` 槽。

## 4. 天空/光照/雾/云/天气权威规格（来源：反编译 jar + jar 内自带 GLSL）

已验证我们**对的**：光照曲线 `l/(4-3l)` 与 `core/lightmap.fsh` 的 `get_brightness` 完全一致；雾色 `#c0d8ff`、天空 `#78a7ff`、水雾 `#050533`（end=96）、云高 192.33、云漂移 0.6 格/秒、方块光强度系数 1.4。

高影响差异（M6 待落地）：
1. **夜晚**：原版把天空光**等级降到 4**（曲线值 0.083）、`sky_light_factor` 保持 1.0；我们用"等级 15 × 0.24"假扮夜晚 → 夜是一片平灰。昼夜切换窗口：天空光在 12040→13670 tick 降级；敌对生成窗口 13188–23031。
2. **火把不漂白**：原版 `mix(BlockLightTint, vec3(1), 0.9*(2l-1)²)`，等级 15 时趋近白色；我们固定 `#ffd88c` → 一切都糊成深橙。
3. **天空不是渐变**：两片**平色圆盘**（顶 `#78a7ff` / 底 `#282828`）+ 地平线靠 `FogSkyEnd=512` 的雾去混；我们的 `pow(up,0.55)` 斜坡一看就不是原版。
4. **日月**：原版 `scale(30,1,30)` / `scale(20,1,20)`（我们小了 3–7 倍），月亮有 **8 个月相**贴图（我们写死满月）。
5. **云是立体盒子**：每格挤出 12.0/4.0，面光照 顶1.0/侧0.9·0.8/底0.7，按 0→2048 淡出；我们是一张贴地平面（对"廉价感"贡献很大）。
6. **雾形状**：圆柱 `max(|xz|,|y|)` 与球形 0→1024 包络取大；环境色 `#0a0a0a`；星星是 1,500 颗池按 `star_brightness` 淡入。
7. **天气**：`environment/rain.png`、`snow.png` 是 **64×256 动画列**，约 32×512 区域，alpha 0.8/0.5/0.25，配 `ambient.rain/snow` 循环音。

## 5. 物理与游戏性权威常量（已落地）

原版是**固定 20Hz tick 模型**，单位 block/tick：
- `v = v·damping + input·accel`，地面阻尼 0.546、空中 0.98、空中推力只有地面的 1/5（这才是"空中发飘"的真原因，连续 dt 模仿不出来）。
- 跳跃 `0.42 b/t` + `v=(v−0.08)·0.98`；落地 `vy=−0.08`；下落末速钳 3.92 b/t。
- 走 0.2159 / 疾跑 0.2806 / 潜行 0.0648 / 飞行 0.5395 / 飞行疾跑 1.079 b/t（= 4.317/5.612/1.295/10.79/21.58 b/s）。
- 帧率不再影响跳跃高度（旧实现 30Hz 1.165 → 144Hz 1.295 会漂）；渲染用 tick 间插值。
- 方块交互距离 5.0（创造原版值，生存应 4.5）；疾跑 FOV 倍率 **1.1 且只在疾跑生效**（飞行不加）。
- 僵尸伤害 3；骷髅弓箭 3–6、每 3 秒一射；猪高 0.9、骷髅 1.99；两者白天燃烧；溺水 = 300 tick 空气后每秒 2 点（我们原来完全没有）。

## 6. HUD/界面权威度量

已修：准星改用原版 `RenderPipelines.CROSSHAIR` 的 **INVERT 混合**（canvas `difference`，否则浅色天空下几乎看不见）；心在 `H-39`、x=`W/2-91+i*8`、低血量 ±1px 抖动；换格 5 tick 挤压弹跳 `f=1+pop/5, scale(1/f,(f+1)/2)` 绕 `(x+8,y+12)`；物品名提示 `H-59`、淡出 `min(255, timer*256/10)` 共 40 tick；标题全景 **每帧 0.1°**（≈6°/s，原来 1°/s 看着像静止）；Logo 256×64。
已确认正确：快捷栏几何 `W/2-91, H-22`、182×22、选中框 24×23 画在 `-1,-1`、物品 16px。

待做（按可见影响排序）：护甲 `(left+i*8, H-49)`、饥饿从右往左 `(W/2+91-i*8-9, H-39)`、气泡、经验条 `(W/2-91,H-29)` 182×5 + 等级绿字；生存背包真 176×166 面板 + `InventoryMenu` 槽位坐标（护甲 `(8,8+18i)`、2×2 合成 `(98,18)`、产物 `(154,28)`、27 格 `(8+18c,84+18r)`、副手 `(77,62)`、头像区 `(26,8)-(75,78)`）；tooltip 用 sprite 背景 + 3px 边框 + 稀有度色 + 多行；堆叠数量文字；创造标签页/滚动条/搜索框精确坐标；toast 右上 160×32；GUI scale 取偶数。

注：bloom / 神光 / 饱和 / 对比 / 暗角这套**不是原版**（原版 post 只有 blur/creeper/entity_outline/invert/spider/transparency），是我们额外要的 Complementary 风格，放在光影开关后面。

## 7. Complementary Reimagined r5.9.3 解包结论（`thirdparty/complementary-reimagined-r5.9.3`）

Modrinth slug 是 `complementary-reimagined`（`complementary-shaders` 会 404）。**包里没有 `settings.glsl`**，默认值全是 `shaders/lib/common.glsl` 顶上的 `#define`（14–300 行，派生 define 361–660），函数在 `lib/**`，每个 `program/**` 一个阶段。它的 GLSL 依赖 Iris 内建（`shadowtex0/1`、`colortex*`、`gbuffers_*`），**无法直接粘进 WebGL2**，能搬的是算法与默认参数。

- **Bloom**：强度 **0.12 且是 mix（混入）**；我们是 0.34 加法叠加 → 画面发白像蒙奶。
- **色调映射**：**Modified Lottes 2016**（contrast 1.05、hdrMax 8、mid 0.25）+ 暗部提升 + 白路径 + 暗部去饱和 0.25；**包里完全没有自动曝光**（`vsBrightness` 只是 gamma）→ 我们的 exposure 模型该整个删掉。
- **火把光**：两项幂曲线 `pow((lmX⁴)^(2.8−0.6vb) + lmX·(2.8+0.6vb), 2.25)` × `blocklightCol (0.1775,0.104,0.077)`。
- **水**：默认 `WATER_STYLE 1` **不用法线贴图**，波浪是顶点阶段两条正弦（`worldPos.xz*14`，`sin(t*0.7−z*0.14+x*0.07)+sin(t*0.5−z*0.10+x*0.05)`），透明度按深度 `1−exp(Δ·0.075)`。我们从贴图梯度求法线，方向就错了。
- **影子不动的正解**：不靠纹素对齐，而是分形畸变（`d = 1−25.6/192`）+ 双层深度图 + 交错梯度噪声 + **TAA**（`DETAIL_QUALITY 2` 会强制打开），再叠 FXAA 3.11。
- 另有：SSAO 默认开、暗角是亮度感知的、4 抽稀化锐化、日落/正午/夜晚各有明确颜色与非线性日钟曲线。

实施顺序（改动小→观感大）：火把曲线 → 日光颜色/日钟 → 太阳淡出 → 水波 → 暗角/锐化/抖动 → Lambert+GGX 高光 → 最终合成 → Lottes 调色 → bloom 改 mix → 阴影三件套 → TAA+FXAA（单独一步，同时治闪烁和质感）→ SSAO → 体积光 → 体积云（要生成噪声贴图，最后）。

## 8. 原版参考截图（可行，已备好但默认不启动）

本机真实 26.2 客户端**可启动**：Java 25 运行时 + 88/88 libraries + 5057/5057 assets 已校验。
harness：`tools/make_launch.py` → `tools/launch.args`（88 个库 + G: 的 jar 上 classpath），钉死 `shotdir/options.txt`（ao、fancy、mipmaps 4、RD 12、fov 1.0、guiScale 4、entityShadows、minimal particles、clouds on、60fps、en_us），F2 写 `shotdir/screenshots`。
**必须用干净 `--gameDir`**：已安装实例带 Fabric + Sodium/Iris/Voxy/Xaero/REI，会改变渲染。
要截的 10 个场景：第一人称持方块待机与挥击、持平面物品、创造背包、生存背包含合成格、火把夜景、日出、水下、水面俯视与水下仰视、从下往上看云、村庄、破坏粒子、GUI 字体按钮。

## 9. M1b：blockstate/模型烘焙管线（今天完成，逐源码复刻的第一块）

移植来源（全部在 `thirdparty/src-vanilla`）：`client/resources/model/cuboid/{FaceBakery,CuboidModelElement,CuboidFace,CuboidRotation,UnbakedCuboidGeometry}`、`client/resources/model/{ResolvedModel,ModelBakery,BlockStateModelLoader}`、`client/resources/model/sprite/TextureSlots`、`client/renderer/block/dispatch/{Variant,ModelState,WeightedVariants,BlockModelRotation}`、`client/renderer/FaceInfo`、`core/BlockMath`、`core/Direction`、`com/mojang/math/{OctahedralGroup,Quadrant,SymmetricGroup3,Transformation}`。

产出与校验（`npm run states` 然后 `npm run verify:states`）：
- 1,198 blockstate = 1,096 variant + 102 multipart；7,296 变体键；7,476 变体对象；1,132 multipart 条目；**6,816 baked model / 67,566 面**；1,230 面纹理；59 个无几何模型；**0 悬空纹理引用**；与 `research/blockstate-inventory.json` 的实测数逐项吻合。
- 二进制：`generated/states.bin` 3.20MB（量化 typed array，pos 1/1024、uv 1/256）+ `states.json` 1.38MB（同数据出 JSON 是 10.7MB，浏览器里会变成上百 MB 对象树，所以必须二进制）。全量往返校验通过。
- 20 项语义抽查全绿：半砖 bottom/top/double、楼梯四朝向互为 90° 旋转 + inner/outer/straight 三模型（15/11/11 面）、雪层 1–8 递增到满格、原木 axis 三向轴置换、栅栏 multipart 四向连接体贴对边（46 = 柱 6 + 4×10）、火把柱 0.4375–0.5625 / 高 0.625 / AO 关闭。

踩到的两个真错误（值得记住）：
1. joml 的元素命名是 `m<col><row>`，所以 `SymmetricGroup3.transformation()` 里 `.set(permute(i), i, 1.0f)` 得到的置换矩阵是 `(M·v)[r] = v[permute(r)]`（gather），不是我第一版写的 scatter。写反会让所有楼梯/栅栏/原木朝向系统性偏 90°。抓出它的是"48 群 × 6 方向：置换表路径 vs 矩阵路径必须一致"这条交叉验证——**移植数学库时优先找原版里的两条独立实现互相验证**。
2. 旧 `rotateUv` 用转置实现 face `rotation`，原版是 `(index + shift) % 4` 的索引环；顺带 `heavy_core` 的裸槽名（无 `#`）和"未解析槽→missingno+warn"两条原版容错也被旧脚本当异常抛掉。

## 10. 建造顺序（依赖驱动）

M1 blockstate+模型管线 →（**M6 光照/天空/天气 与 M10 Complementary 插队**，它们不依赖 M1 且是"劣质感"的最大来源）→ M2 物品/堆叠/组件选择器 → M3 生存循环（挖掘时间·破坏贴图·掉落·合成·容器·饥饿经验·游戏模式）→ M4 无限流式区块 + 存档 → M5 用 1,212 个官方 NBT 模板做真结构 → M7 生物模型/AI/生成规则 → M8 多人客户端接现有 Paper 桥接 → M9 全部界面/lang/粒子/音频 → M11 原版截图对照验收基线。

M1 的离线一半已完成；**运行时还没消费它**（M1c：贴图闭包从 103 补到 1,230、世界存属性状态、mesher/HUD/图标走状态→模型）。

## 11. 操作与验收注意

- 内嵌浏览器**拿不到指针锁定**，靠 `window.__mc` 插桩（`player, world, renderer, hud, mobs, mobRenderer, particles, audio, openInventory, setTicks, setQuality, setRenderDistance`）：设 `player.locked = true` 跑物理，设 `pos/yaw/pitch` 构图截图。
- 世界生成 + 网格化单跑 10–25 秒，多 agent 并发时要几分钟；着色器编译错误只在加载页显示 `Load failed:`，要轮询 `window.__mc` 而不是假设页面活着。
- 官方素材与反编译源码仅限本机私人使用：不提交仓库、不公开部署。
- 线上 Paper 服务器未经批准不得安装/重启插件，桥接测试用独立副本。
