# 原版 GUI 系统移植报告

`src/client/gui/**` 共 52 个 `.ts`（3 既有 + 49 新增，约 6,250 行），
`scripts/test-gui.mts`。既有 `FontRenderer.ts` / `Hud.ts` / `ItemIconAtlas.ts` 的 API 未破坏。

## 移植的 Java 类（对照）

| TS | Java FQCN |
|---|---|
| `GuiGraphics.ts` | `client.gui.GuiGraphics` / `GuiGraphicsExtractor` |
| `GuiSpriteAtlas.ts` | `blitSprite` / `GuiSpriteScaling` |
| `GuiScale.ts` | `Window#calculateScale`, `Options`(911) |
| `Language.ts` | `client.resources.language.I18n` / `Language` |
| `components/*` | `AbstractWidget`, `Button`, `WidgetSprites`, `EditBox`, `AbstractSliderButton`, `Checkbox`, `CycleButton`, `AbstractSelectionList`, `Tooltip`, `Toast`, `ToastManager`, `TabButton`, `LogoRenderer`, `SplashRenderer`, `Panorama` |
| `screens/*` | `Screen`, `TitleScreen`, `CreateWorldScreen`, `SelectWorldScreen`, `OptionsScreen`, `VideoSettingsScreen`, `KeyBindsScreen`, `LanguageSelectScreen`, `SoundOptionsScreen`, `PauseScreen`, `DeathScreen`, `ChatScreen`, `AbstractContainerScreen`, `InventoryScreen`, `CreativeModeInventoryScreen`, `CraftingScreen`, `FurnaceScreen`, `ChestMenu` 界面, `RecipeBookComponent` |
| `ScreenManager.ts` | `client.gui.Gui#setScreen` + `GuiRenderer` |

抄入断言的 Java 常量：`height/4+48`、spacing 24、`width/2-100`、200×20、98×20、
slot `(8,84)`、18px 网格、`(154,28)` 结果槽、`(98,18)` 合成格、
`imageWidth/Height=176/166`、`0x60000000` 遮罩、tooltip `12/3/9`。

## 精灵 / 字体方案（查证结论）

- 本资源包**没有** `assets/minecraft/atlases/gui.json`；九宫格元数据在每个 sprite 旁的
  `.mcmeta`：`{"gui":{"scaling":{"type":"nine_slice","width":200,"height":20,"border":3}}}`。
  `border` 有数字与对象两种形式，`GuiSpriteAtlas.parseScaling()` 都支持并按 `img.width/meta.width` 缩放。
- 渲染用 **Canvas2D 覆盖层**（`game.guiCanvas`）：`FontRenderer`、`ItemIconAtlas.draw`、`Hud`
  都基于 `CanvasRenderingContext2D`，混用 GL 正交批需要第二 FBO 且每字形回读。
- `createPattern` 一次 fill 平铺菜单泥土背景；`CORE_SPRITES` 预加载；按路径分组批量绘制。
- 修了一个坑：`FontRenderer.draw()` 内部覆写 `ctx.globalAlpha`，
  所以 `GuiGraphics` 把 alpha 作为第 6 个参数传入而非预设 globalAlpha。
- 本包 `panorama_0..5.png` 是 1×1 占位、容器背景是 22 色占位图：
  `PanoramaRenderer` 采样 6 面颜色生成旋转色带 + `blur(4px)` + 淡入 + 压暗；
  容器在 `#C6C6C6` 底板之上 blit 原图并程序化补绘原版槽位框。
  **没有自造渐变按钮** —— 按钮全部走 `widget/button*` 九宫格精灵。

## 测试输出（`npx tsx scripts/test-gui.mts`）

```
PASS  JAVA_TITLE_CONSTANTS match the decompiled literals
PASS  TitleScreen 8 widgets / button rectangles / 3 icon buttons / copyright / logo
PASS  guiScale 1920x1080=4, 1280x720=3, 800x600=2 (matches Java while-loop)
PASS  calcGuiScale matches javaCalculateScale over 320..3840 sweep
PASS  survivalInventorySlotXY(0..40) matches Java for every slot
PASS  InventoryMenu slots / result slot / craft grid / container origin
PASS  14 creative tabs, every tab icon & item id exists in items.json (1537 items)
PASS  wrapText / wrapTooltipLines / Button hit test / disabled buttons
PASS  button.png.mcmeta nine_slice 200x20 border 3 -> 9 patches
PASS  tab.png.mcmeta object-form border {2,2,2,0}
ALL PASS: 73/73 checks passed
```

## ScreenManager 集成

```ts
new ScreenManager(game.guiCanvas, game.gl, {
  mc, models, font, textures, sprites?, icons, options,
  i18n?, worlds?, creativeTabs?, container?, shaderQuality?, callbacks
});
manager.open('title'|'selectWorld'|'createWorld'|'options'|'video'|'pause'|
             'inventory'|'creative'|'crafting'|'furnace'|'chest'|'chat'|'death', ...args);
manager.render(partial);   // 必须在 HUD 之后
manager.onKey(code, char, mods) -> boolean;
manager.onMouse(mx, my, button, 'down'|'up'|'move'|'wheel', deltaY) -> boolean;
manager.resize(innerWidth, innerHeight);
```

`render()` 会重置 `globalAlpha` / `globalCompositeOperation` 并清空 GUI canvas；
菜单打开时隐藏 HUD，`ChatScreen.preserveHud=true` 则保留 HUD。
`VideoSettingsScreen` 通过 `OptionsBridge` 读写 `deps.shaderQuality` /
`window.__mc.renderer.shaderQuality`，供后续光影档位接入。

## 未完成

未建独立 Screen：`ChatOptions`、`Accessibility`、`SkinCustomization`、`MouseSettings`、
`WorldOptions`/GameRules、`PackSelection`、`Credits`、`Confirm/Alert/Disconnected`、
多人/Realms、社交、`Advancements`、`Stats`。
容器界面未移植：铁砧、附魔、酿造、信标、砂轮、织布机、制图台、锻造、切石机、
发射器、潜影盒、马、村民交易、书与告示牌编辑。
`RecipeBookComponent` 为简化面板，`SelectWorldScreen` 的 provider 由存档模块提供。
