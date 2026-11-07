# ageneral-purpose-2d06c0967c196d08

- 会话：抽离子agent并逐源码复刻（当前）
- 时间：2026-11-01T05:09:57.216Z → 2026-11-01T06:21:16.324Z
- 模型：qfmodel
- 转录行数：735（助手文本 2 条）
- 工具使用：Bash×131 Read×62

## 派发的任务

你在协助一个把 Minecraft Java 26.2 在浏览器里 1:1 复刻的项目（webcraft26，TypeScript + WebGL2）。官方客户端 jar（Mojang-mapped）已被 Vineflower 反编译成 Java 源码，位于 G:\ck-web26\src-vanilla（7,055 个文件）。项目目录：C:\Users\zht\Documents\Qoder\2026-11-01\4194ac07\webcraft26。

## 背景与目标
项目现在没有 blockstate 系统：构建脚本只给每个方块烘焙一个固定朝向、且遇到 multipart 直接抛错，所以楼梯/半砖/栅栏/玻璃板/床全都不可能对。我们准备按原版源码逐块复刻"blockstate → 模型 → 烘焙四边形"这条管线（先做 variant 派发，multipart 随后）。**你的任务是当"源码翻译官"**：把原版 Java 的算法读成可以直接改写成 Node/TypeScript 的精确规格，包括所有常量、边界条件和容易猜错的地方。不要写项目代码，只写规格文档。

## 需要精读并转写的源码（26.2 已重构，路径按此为准）
- 派发层：net\minecraft\client\resources\model\BlockStateModelLoader.java、net\minecraft\data\models\blockstates\MultiVariantGenerator.java、MultiPartGenerator.java、net\minecraft\data\models\MultiVariant.java、net\minecraft\client\renderer\block\dispatch\ 下的 Variant.java / Variants.java / WeightedVariants.java / MultiCondition.java / Condition.java / SubCondition.java / When.java / BlockStatePredicate.java / BooleanPredicate.java / PropertyValueCheck.java / SingleVariant.java / BlockModelDispatch.java / VariantMutator.java / VariantSelector.java / BlockModels.java 以及 dispatch\multipart\MultiPartModel.java（文件名请以实际目录为准，先 ls 一遍再读）。
  要说清：属性在变体键字符串里的**排序规则**、键的解析方式、multipart 的 AND/OR/INVERT 语义、apply 的 weight 随机选择如何用**方块位置做确定性种子**（原版用什么 hash，具体是哪个方法）、Variant 的 x/y 旋转与 uvlock 如何合成最终变换（旋转顺序、角度是否允许非 90 倍数）。
- 烘焙层：net\minecraft\client\resources\model\ModelBakery.java、ModelBaker.java、UnbakedModel.java、ResolvedModel.java、ResolvableModel.java、ModelDiscovery.java，net\minecraft\client\resources\model\cuboid\ 下的 UnbakedCuboidGeometry.java、CuboidModelElement.java、CuboidFace.java、FaceBakery.java、CuboidDirection.java，以及 net\minecraft\client\renderer\model\ 相关（若存在）与 net\minecraft\client\renderer\FaceInfo.java、FacingEncoding.java。
  要说清：parent 继承时 textures map 的**合并与覆盖优先级**（子覆盖父？默认变量如何填充，例如父模型声明 texture/texture_all 之类）、`#` 变量解引用与缺失变量时的行为、gui_light 的传递、ambientocclusion 与 compile 字段的作用、元素 from/to 的取值范围与越界裁剪、face uv 缺省时的自动生成公式、uv 旋转与 uvscale 的精确计算（谁先谁后、如何归一化到 0..1 或 16 空间）、FaceBakery.bakeQuad 的完整步骤（顶点顺序、法线/朝向索引、shade 如何影响 AO 与光照、tintindex 怎么传给光照着色器）、**模型旋转（variant x/y + uvlock）时顶点与 UV 各自怎么处理**（uvlock 为真时 UV 是否随之旋转、绕哪个轴、如何避免跨贴图接缝）、cullface 与"面在方块外被裁剪"的判定。
- AO 与光照：net\minecraft\client\renderer\block\model\ 下若有 AoHelper / ModelBlock 相关；以及 net\minecraft\client\renderer\LightTexture.java 或 LightmapTextureManager.java 里烘焙顶点亮度如何与 AO 相乘（顶点色 0xFFAAAAAA 之类常量的确切值）。
- 特殊模型：net\minecraft\client\resources\model\ 下的特殊生成器（例如 item 的 generated / composite、SpecialBlockModelWrapper.java、CompositeBlockModel.java、EmptyBlockModel.java、BlockDisplayContext.java）。重点：BlockDisplayContext 里各类变换（none/thirdperson_righthand/firstperson_righthand/gui/head/ground/fixed）如何被读取与应用，因为第一人称手持方块与 GUI 图标的位置/角度全靠它。

## 交叉验证要求
凡是规格里出现的具体数值（枚举顺序、位移、默认值、hash 常量），都要给出 **file:line 引用**。如果某处逻辑依赖运行时注册表（例如属性定义在 BlockBehaviour/StateDefinition 里），请到 G:\ck-web26\src-vanilla\net\minecraft\world\level\block\state\properties\ 下核对。若两个来源冲突，明确写"源码里是 A，但数据文件里表现为 B"。

## 产出（唯一允许你新建/写入的代码之外文件）
C:\Users\zht\Documents\Qoder\2026-11-01\4194ac07\webcraft26\research\vanilla-model-pipeline-spec.md
结构建议：① 管线总览（blockstate 文件 → 派发 → 模型解析 → 烘焙 → 顶点格式）；② 派发规格（含伪代码）；③ 烘焙规格（含伪代码，重点是 FaceBakery 的每一步）；④ 顶点/四边形数据格式与我们现有 manifest（读 C:\Users\zht\Documents\Qoder\2026-11-01\4194ac07\webcraft26\src\types.ts 与 scripts\build-assets.mjs 的 bakeModel）之间的**逐项差异清单**，标出我们现有实现已经正确的地方和错的、漏的地方（漏的按影响排序）；⑤ 建议的 manifest 数据结构扩展（state→model 索引、模型池去重、multipart 表达），要能同时服务 variant 和 multipart；⑥ 风险与未知项。

## 约束
- 只读，不改 src/ 与 scripts/；只新建那一份 research 文档（可另存你自己的草稿笔记在 research/ 下）。
- 中文；不要抄大段 Java，转写成伪代码或规则条目；带 file:line 证据。
- 报告控制在 700 行以内，最有影响的结论放最前面。你会被用来直接指导实现，所以宁可精确而少，不要笼统而全。

## 报告（转录末段）

Now let me check the AO/light side and vertex format.



---

Now I have the full picture. Let me write the spec document.


