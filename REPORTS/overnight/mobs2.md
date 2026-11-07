# §8-1 补生物模型并解除隐形生成限制 — 交付报告

日期：2026-11-08 07:0x（夜班收尾）
分支/工作区：`G:\web_mc\webcraft26`（与 Lead 共享工作区，未做任何 git 写操作）

## 0. 结论（先看这里）

- **12 个「有工厂但没渲染器」的生物全部补齐**：slime、witch、cave_spider、zombie_villager、fox、cat、ocelot、parrot、squid、glow_squid、cod、salmon。
- 做法 = 在 `MODEL_REGISTRY` 注册模型 + 纹理；`EntityRenderDispatcher.canRender()` 因此变 true，`Game.init` 里
  「有 factory 但无渲染器 → factory = null」的通用白名单自动失效 —— **没有改 Game.ts**，也没有改任何 vanilla 实体类。
- 模型不是凭记忆近似：本机有 26.2 官方反编译源 `G:\ck-web26\src-vanilla`（只读使用），所有 box/UV/pose/`setupAnim`
  都逐行对照 `createBodyLayer()` / `setupAnim()` / `ModelLayers` 抄的。复杂模型（witch 帽子、squid 触手、fish 鳍、
  villager 头）都是**原版几何**，不是近似盒子堆。
- 验收全绿：`npx tsc --noEmit` 0 错误；`npx tsx scripts/test-mobs-render.mts` **19/19 PASS**（原有 12 项 + 新增 7 项）；
  新截图脚本 `scripts/shot-newmobs.mjs` 跑通（12 个 canRender 全 true、12 个全部生成成功、白天/夜晚/夜晚火把三张图）；
  回归 `node scripts/shot-mobs.mjs` 跑通（原 13 种生物视觉无变化）。
- 仍存在的近似全部列在第 5 节（slime 无半透明层、glow squid 不自发光、鱼类出水不侧躺、无幼年/变体等）。

## 1. 运行时如何解除隐形限制

`src/client/renderer/entity/model/ModelRegistry.ts` 的 `MODEL_REGISTRY` 是唯一开关：

- `EntityRenderDispatcher` 构造时遍历 `MODEL_REGISTRY` 建 `MobRenderer`，`canRender(name)` = 是否能取到渲染器；
- `Game.init` 里 `ENTITY_TYPES.forEach(t => { if (t.factory && !entityRenderer.canRender(t.name)) t.factory = null; })`
  对没有渲染器的类型做「隐形→禁生成」；
- 因此新增 12 条 registry 条目后，自然生成与 `/summon` 自动恢复，**Game.ts 一行未改**。

浏览器里实测（`scripts/shot-newmobs.mjs` 第一个探针）：

```
canRender: slime=true witch=true cave_spider=true zombie_villager=true fox=true cat=true
           ocelot=true parrot=true squid=true glow_squid=true cod=true salmon=true
day setup spawned: 12 个全部 ok:true（EntityManager.spawn 内部走 createEntity，能生成 ⇔ factory 未被置 null）
day:  drawCalls=12  batchFloats=50112  sky=(factor 1, light 15)
night: drawCalls=12  batchFloats=50112  sky=(factor 0.24, light 4)
```

## 2. 生物 → 模型 → 纹理 对照表

| 实体 | 模型（`EntityModels.ts`） | 纹理（`/mc/textures/entity/…png`，均已确认存在） | 缩放 / 备注 |
|---|---|---|---|
| slime | `SlimeModel`（64×32，外层壳 8³ + 内层眼/嘴） | `slime/slime` | entity.scale=2 → 1 格方块（原版 size 2） |
| witch | `WitchModel`（64×128，村民身体 + 4 层帽子 + 鼻子/痣） | `witch/witch` | 渲染时 ×0.9375（= ModelLayers.WITCH villagerLikeScale） |
| cave_spider | 复用 `SpiderModel`（64×32） | `spider/cave_spider` | entity.scale=0.7 → 原版 CAVE_SPIDER 层 0.7 |
| zombie_villager | `ZombieVillagerModel`（64×64，村民头/鼻/帽/袍 + 僵尸手臂） | `zombie_villager/zombie_villager` | 原版该层无额外缩放 |
| fox | `FoxModel`（48×32） | `fox/fox`（红狐） | 渲染时 ×1.25 抵消实体的 0.8 → 原版大小 |
| cat | `FelineModel`（64×32） | `cat/cat_tabby` | entity.scale=0.8 = 原版 CAT 层 CAT_TRANSFORMER 0.8 |
| ocelot | 复用 `FelineModel` | `cat/ocelot` | 渲染时 ×1.25 抵消猫共享的 0.8（原版 ocelot 层无缩放） |
| parrot | `ParrotModel`（32×32） | `parrot/parrot_red_blue` | 渲染时 ×5/3 抵消实体 0.6 → 原版大小 |
| squid | `SquidModel`（64×32，8 条触手） | `squid/squid` | 渲染时 ×1.25 抵消实体 0.8 |
| glow_squid | 复用 `SquidModel` | `squid/glow_squid` | 同上；不自发光（见第 5 节） |
| cod | `CodModel`（32×32） | `fish/cod` | 渲染时 ×5/3 抵消实体 0.6 |
| salmon | `SalmonModel`（32×32，medium 变体） | `fish/salmon` | 渲染时 ×10/7 抵消实体 0.7 |

`MODEL_REGISTRY`：18 → 30 条；`ALL_TEXTURE_KEYS` 增加 12 张纹理（现有 29 个 PNG + 1 个 `__white__`），启动时各加载一次。

## 3. 26.2 原版对应关系（精确抄写清单）

本地反编译源（只读）：`G:\ck-web26\src-vanilla`
（`client/model/**`、`client/renderer/entity/**`、`client/model/geom/LayerDefinitions.java`）

- Slime：`SlimeModel.createOuterBodyLayer()` + `createInnerBodyLayer()`；尺寸缩放规则来自
  `AbstractCubeMobRenderer.applySizeAndSquish`（本作只有一个 size=2，等于实体 scale=2）。
- Witch：`WitchModel.createBodyLayer()`（含 `VillagerModel.createBodyModel()` 继承的帽子宽檐/鼻子、
  `hat2/hat3/hat4` 四层、痣）+ `WitchModel.setupAnim`。
- ZombieVillager：`ZombieVillagerModel.createBodyLayer()` + `AnimationUtils.animateZombieArms`。
- Fox：`AdultFoxModel.createBodyLayer()` + `FoxModel.setupAnim` / `AdultFoxModel.setWalkingPose`。
- Cat/Ocelot：`AdultFelineModel.createBodyMesh(CubeDeformation.NONE)`、`AdultCatModel`/`AdultOcelotModel`；
  `LayerDefinitions` 中 CAT 层 `CAT_TRANSFORMER=0.8`、OCELOT 层不缩放。
- Parrot：`ParrotModel.createBodyLayer()` + `setupAnim`（FLYING/Pose 分支）。
- Squid / GlowSquid：`SquidModel.createBodyLayer()` + `setupAnim`；`SquidRenderer.setupRotations` 的
  `translate(0,0.5,0)`/`translate(0,-1.2,0)` 净 -0.7 格，按 26.2 `MeshTransformer.scaling` 的等价关系等价为
  「整模型绕脚点缩放」，所以 squid 模型坐标里预加了 +11.2 texel 的 Y 偏移（否则触手会插进地面 0.7 格）。
- Cod / Salmon：`CodModel.createBodyLayer()`、`SalmonModel.createBodyLayer()`（medium）+ 各自 `setupAnim`。
- CaveSpider：`LayerDefinitions` 里 `CAVE_SPIDER = SpiderModel.createSpiderBodyLayer().apply(scaling(0.7))`，
  正好等于实体 scale=0.7，所以直接复用 `SpiderModel`。

缩放/Pose 的通用说明：26.2 `MeshTransformer.scaling(s)` 会给每个 PartPose 加 `yOffset = 24.016*(1-s)`，
数学上**等价于**「把成品模型绕脚点整体缩放 s」。本作 `EntityRenderer` 已按 `entity.scale` 在脚点做整体缩放，
所以 CAT 0.8 / CAVE_SPIDER 0.7 直接由实体 scale 完成；其余类型在 `MobRenderer.EXTRA_SCALE` 里补系数
（见第 2 节表格）。witch 的 0.9375 也走这里。

## 4. 动画

`EntityRenderer` 的 `AnimContext`（ageInTicks / limbSwing / limbSwingAmount / headYaw / headPitch / attackTime /
isAggressive / flapAngle / isResting）驱动，新增模型的 animator：

- 猫/豹猫：四腿 `cos(limbSwing*0.6662)*speed` 摆动 + 尾巴 `1.7278761 + π/4*cos*amount`，头部视线跟随；
- 狐狸：四腿 `cos*1.4*amount` 行走 + 头视线；
- 女巫：头视线、腿 `*0.5` 半幅摆动、鼻子按固定速度 `sin/cos` 抖动；
- 僵尸村民：人形行走/头视线 + `animateZombieArms`（与现成 ZombieModel 相同的摆臂）；
- 鹦鹉：飞行姿态（腿收起 2π/9、翅膀 `±(0.0873+flapAngle)`、身体/头/尾随机翼上下浮动、尾随走路摆动）；
  `EntityRenderer` 里 `flapAngle` 原先只对 chicken 计算，现改为 chicken+parrot 共用同一近似；
- 鱿鱼/发光鱿鱼：8 条触手 `xRot = tentacleAngle`，本作实体没有 `tentacleAngle`，用 `|sin(age*0.15)|*π/4` 近似；
- 鳕鱼：尾鳍 `-0.45*sin(0.6*age)`；鲑鱼：后段身体 `-0.25*sin(0.6*age)`；
- 受伤红闪 / 白色闪 / 死亡 90° 倒地：沿用现有 `EntityRenderer` 通用逻辑，新增类型自动生效（测试覆盖）。

另外补了 `MobRenderer` 的阴影半径表（除以实体 scale 后乘回，得到原版半径）：slime 0.5、cave_spider 0.56、
fox/cat/ocelot 0.4、parrot/cod 0.3、squid/glow_squid 0.7、salmon 0.4，其余沿用 0.5。

## 5. 近似 / 未实现（诚实清单）

模型几何本身是原版精确抄写；下面是**本作渲染管线或实体类能力**导致的近似/缺失：

1. **slime**：管线的 entity shader 只做 alpha-test、没有半透明混合（`c.a < 0.1 discard`，混合关闭），
   原版外层壳的 alpha 是 180/255，会被画成不透明绿壳。所以：
   - 只画外层壳（不透明）+ 内层眼睛/嘴，并把眼/嘴向 -Z 前移 1 texel 让它们露在壳外（否则被壳挡住）；
   - 原版「内层深绿核心」省略（会被不透明壳完全遮住）；
   - 没有 squash 挤压动画（实体类未模拟 squish）；只有 size=2 一档。
2. **glow_squid**：不自发光。原版用 emissive/自发光渲染，本作统一走 lightmap，夜里只是普通生物亮度
   （截图夜晚里可见，但不会像原版那样发荧光）。
3. **squid**：无 `xBodyRot`/`zBodyRot`（俯仰/滚转），水中姿态只有 yaw；触手角是近似正弦（见第 4 节）。
   由于复刻了原版 -0.7 格下沉，**在陆地上触手会插进地面**（原版它们本来住在水里）；截图里水生物是抬高放的。
4. **cod / salmon**：原版出水会旋转 90° 侧躺（`CodRenderer`/`SalmonRenderer.setupRotations`），本作没有
   in-water 状态，所以永远保持水平姿态；salmon 只有 medium 变体（small/large 的 0.5×/1.5× MeshTransformer
   未接，实体也没有尺寸字段）。
5. **parrot**：只有 FLYING 姿态。本作 Parrot 是 `noGravity` 悬浮（和 Bat 一样），不会落地站立，也不做
   SITTING / PARTY / ON_SHOULDER；`flapAngle` 用 (sin(age)+1)*speed 近似（原版用实体 flap 计数器）。
6. **witch**：鼻子抖动速度用固定 0.05 rad/tick（原版 `0.01*(entityId % 10)`，render state 没带 entityId）；
   没有「手持药水时鼻子位置/角度变化」（本作女巫用箭代替药水，无手持物品渲染）。
7. **fox**：只有行走姿态；sleep / sit / crouch / pounce / faceplant、`headRollAngle` 未模拟。
8. **cat / ocelot**：只有站立/行走；坐、躺下（`lieDownAmount`）、项圈层未实现。
9. **zombie_villager**：没有职业服装 overlay layer、没有转化抖动（isConverting）、没有盔甲层
   （本作所有 humanoid 都没有盔甲层）。
10. 通用：所有新增类型都**没有幼年变体**（本作没有 baby 系统）；没有各生物专属 RenderLayer
    （猫项圈、狐狸叼东西、女巫手持物、发光轮廓等）。

## 6. 验证结果（全部亲自跑）

环境：dev server 已在 `http://127.0.0.1:5174/` 运行（Lead 维护，**未启动任何新 server**）；主菜单改造后 URL 一律加
`?play`；浏览器同时只开 1 个 headless。

### 6.1 类型检查

```
cd G:\web_mc\webcraft26
npx tsc --noEmit        → 0 errors（EXIT=0）
```
（注：tsconfig 只 include `src`，所以 scripts/*.mts 由 tsx 运行时检查；两个脚本都实际跑通了。）

### 6.2 数值测试 `npx tsx scripts/test-mobs-render.mts` → 19/19 PASS

原有 12 项全过（zombie 等 13 种原有生物的几何/走路/受伤/死亡/光照/苦力怕膨胀/蝙蝠倒挂）。
新增 7 项：

```
PASS  [13] 12 new types in MODEL_REGISTRY (canRender true)  12 types
PASS  [14] registry textures exist on disk and in ALL_TEXTURE_KEYS  29 entity png keys
PASS  [15] 12 new mobs render finite geometry at vanilla size
      slime=1.00 witch=2.56 cave_spider=0.57 zombie_villager=2.16 fox=0.72 cat=0.60
      ocelot=0.75 parrot=0.93 squid=0.80 glow_squid=0.80 cod=0.31 salmon=0.53
PASS  [16] slime 1 block, witch hat > 2 blocks, cave spider < 0.8 * spider
      slime=1.002 witch=2.565 cave_spider=0.569 spider=0.813
PASS  [17] quadruped walk swing moves fox/cat/ocelot legs  fox=0.72 cat=0.71 ocelot=0.88 wolf=0.89
PASS  [18] witch head look / parrot wing flap / squid tentacle idle animation
      witch=0.99 parrot=0.25 squid=0.76
PASS  [19] 12 new mobs x 5 render states produce finite vertices  states=60

ALL CHECKS PASSED  EXIT=0
```

新增断言覆盖：12 个 registry 条目与预期纹理映射；每个 registry 纹理在 `public/mc/textures/entity/` 真实存在且
在 `ALL_TEXTURE_KEYS` 里（漏纹理=静默隐形，所以显式测）；12 个类型按真实 `entity.scale` 渲染后的包围盒
（squid 因原版 setupRotations 下沉单独断言 -1.4..-1.0）；slime=1 格、女巫帽高 >2 格、cave_spider < 0.8×spider；
狐狸/猫/豹猫走路摆腿；女巫视线/鹦鹉振翅/鱿鱼触手动画；12×5 状态 fuzz 无 NaN。

### 6.3 新截图 `node scripts/shot-newmobs.mjs` → EXIT=0

产出（1280×720，Clear weather，12 只生物两排、面朝镜头）：

| 截图 | 时间 | 内容 |
|---|---|---|
| `shots/mobs2/day.png` | t=6000 | 12 种新生物全部可见，day drawCalls=12 |
| `shots/mobs2/night.png` | t=18000 | 同一排生物，夜间 lightmap 下全部可见（不隐形） |
| `shots/mobs2/night-torch.png` | t=18000 + 火把 | 水生物排附近放火把，验证 block light 生效 |

脚本同时打印：12/12 `canRender=true`、12/12 spawn 成功、`glError=0`、fps=60、drawCalls=12。

### 6.4 回归 `node scripts/shot-mobs.mjs` → EXIT=0

原有 7 个场景重跑通过（day/night/night-torch/walk-a/walk-b/hurt/death/shadow-close），
`shots/mobs/*.png` 已刷新；肉眼对比原 13 种生物渲染无变化（`shots/mobs/day.png`）。

`shots/mobs2/_ref/` 是临时核对目录：12 张官方实体纹理的 10× 放大 + 8px 网格标注图（用来核对 UV 布局），
以及生成它们的临时 python 脚本；**只读 `public/mc/textures/entity/`，未改任何素材**，收尾可整目录删除。

## 7. 改动文件

| 类型 | 文件 | 说明 |
|---|---|---|
| 修改 | `src/client/renderer/entity/model/EntityModels.ts` | +284 行：10 个新模型（9 个 export + 复用）+ 4 个 animator；纯追加，未动原有内容 |
| 修改 | `src/client/renderer/entity/model/ModelRegistry.ts` | 12 条新 registry（model+texture）与 import |
| 修改 | `src/client/renderer/entity/MobRenderer.ts` | `EXTRA_SCALE`（7 类型）、`SHADOW_RADIUS`（10 类型）、getExtraScale/getShadowRadius 改为按类型取值；creeper 膨胀逻辑不变 |
| 修改 | `src/client/renderer/entity/EntityRenderer.ts` | 4 行：`flapAngle` 由 chicken 扩到 chicken+parrot |
| 修改 | `scripts/test-mobs-render.mts` | +176 行：新增 7 项断言（registry/纹理/尺寸/动画/fuzz）；原有 12 项不变 |
| 新增 | `scripts/shot-newmobs.mjs` | 新生物截图脚本（day/night/night-torch + canRender 探针） |
| 新增 | `shots/mobs2/day.png`、`night.png`、`night-torch.png`（+`_ref/` 临时核对图） | 验收截图 |
| 刷新 | `shots/mobs/*.png` | 回归重跑产物（非代码改动） |
| 新增 | 本报告 `G:\web_mc\REPORTS\overnight\mobs2.md` | — |

**没有改**：`src/client/Game.ts`、`src/main.ts`、`src/client/gui/**`、`src/client/touch*`、`src/vanilla/**`、
`scripts/smoke.mjs`、`scripts/shot.mjs`、`scripts/mgr-*.mjs`、`package.json`、`vite.config.ts`、`public/**`；
没有 git add/commit/push；没有启动/重启任何 dev server；没有碰 `G:\Minecraftserver` 或线上服务；
`G:\ck-web26\src-vanilla` 只读引用。

## 8. 遗留问题 / 后续建议

1. **半透明实体层**：要还原 slime 的半透明外壳，需要 entity 管线支持按纹理或按类型的 blend pass（或在 shader 里
   对 slime 纹理做 alpha 输出 + 单独 draw call）。本次按「不透明近似」交付，视觉可辨识但与原版有差别。
2. **glow_squid 自发光**：需要实体 shader 支持 emissive（或给该类型顶点加发光标记），本次未做。
3. **幼年变体 / 变体纹理**（狐狸雪狐、鹦鹉 5 色、鲑鱼 small/large、猫多毛色）：实体类本身没有变体/年龄字段，
   等实体系统补齐后再接 `MODEL_REGISTRY` 的多条目/多模型。
4. **水生物的出水姿态**（鱼侧躺、鱿鱼俯仰）需要 `AnimContext` 增加 `isInWater`/身体角度，属于实体状态扩展。
5. 新类型现在会**参与自然生成**（这是本任务的目的）；如果后续做刷怪平衡/密度测试，注意这几类已不再被跳过。
   `scripts/test-spawn.mts`/`test-entities.mts` 不经过 `Game.init` 的渲染器过滤，逻辑不受影响（未改动、本次未跑，
   不属本任务验收范围）。
6. `MobRenderer.EXTRA_SCALE` 的系数是「本作实体 scale 值 vs 原版渲染尺寸」的补偿表；若之后有人把这些实体类的
   `scale` 改成 1，需要同步删掉对应表项，否则会放大一倍。表上有注释说明。

## 9. 复现命令

```powershell
cd G:\web_mc\webcraft26
npx tsc --noEmit
npx tsx scripts/test-mobs-render.mts
# dev server 由 Lead 维护在 http://127.0.0.1:5174/ ，不要另起；主菜单改造后必须带 ?play
node scripts/shot-newmobs.mjs            # 新生物 -> shots/mobs2/
node scripts/shot-mobs.mjs               # 原有生物回归 -> shots/mobs/
```
