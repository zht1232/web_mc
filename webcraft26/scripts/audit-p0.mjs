// Structural P0 audit for the coverage pipeline.
//
// This is deliberately not a pass/fail unit test: several checks describe known
// gaps. `GAP` means "the current source still has the problem the review found",
// so the audit doubles as a burn-down list. Run:
//   node scripts/audit-p0.mjs
// Outputs REPORTS/coverage/p0-audit.md and .json.
import fs from 'node:fs';
import path from 'node:path';

const ROOT = process.cwd();
const OUT = path.join(ROOT, 'REPORTS', 'coverage');
const read = (p) => fs.readFileSync(path.join(ROOT, p), 'utf8');
const has = (p) => fs.existsSync(path.join(ROOT, p));
/** Strip // and /* *\/ comments so prose like "food" or "cube map" does not fool a check. */
const code = (src) => src.replace(/\/\*[\s\S]*?\*\//g, '').replace(/\/\/.*$/gm, '');

const results = [];
function check(id, area, title, fn) {
  let status = 'PASS';
  let evidence = '';
  try {
    const r = fn();
    status = r.status;
    evidence = r.evidence;
  } catch (err) {
    status = 'ERROR';
    evidence = String(err?.message ?? err);
  }
  results.push({ id, area, title, status, evidence });
}

// ---- P0-01 dropped items ---------------------------------------------------
check('P0-01', 'entities', '掉落物渲染使用占位 cube，而不是物品模型/图标', () => {
  const src = read('src/client/renderer/entity/ItemEntityRenderer.ts');
  const placeholder = /ItemCubeModel/.test(src) && /hash|charCodeAt/.test(src);
  return {
    status: placeholder ? 'GAP' : 'PASS',
    evidence: placeholder
      ? 'ItemEntityRenderer 仍用 ItemCubeModel + 物品名哈希 tint；没有 ItemIconAtlas/物品模型路径'
      : '已使用真实物品模型',
  };
});

// ---- P0-02 creative equipment ---------------------------------------------
check('P0-02', 'inventory', '创造物品栏没有盔甲/副手/合成/预览槽位', () => {
  const src = read('src/client/gui/screens/inventory/CreativeModeInventoryScreen.ts');
  const onlyGridHotbar = /CREATIVE_NUM_ROWS \* CREATIVE_NUM_COLS \+ i/.test(src)
    && !/MENU_ARMOR|armor|offhand|preview/i.test(src);
  return {
    status: onlyGridHotbar ? 'GAP' : 'PASS',
    evidence: onlyGridHotbar
      ? 'buildSlots() 只生成 45 个物品格 + 9 个热栏格；没有 armor/offhand/2x2/preview'
      : '创造屏包含装备/副手/合成/预览槽位',
  };
});

// ---- P0-03 creative drag state --------------------------------------------
check('P0-03', 'inventory', '创造格点击绕过父类拖放状态机，抬起不会 PICKUP', () => {
  const src = read('src/client/gui/screens/inventory/CreativeModeInventoryScreen.ts');
  const gridClickReturns = /idx >= 0 && idx < CREATIVE_NUM_ROWS \* CREATIVE_NUM_COLS[\s\S]{0,600}this\.menu\.click\(idx[\s\S]{0,200}return true;/.test(src);
  const setsPressed = /this\.pressedSlot\s*=/.test(src);
  return {
    status: gridClickReturns && !setsPressed ? 'GAP' : 'PASS',
    evidence: gridClickReturns && !setsPressed
      ? 'mouseEvent 在创造格 down 中直接 return true，未设置父类 pressedSlot/containerDragButton'
      : '创造格点击复用父类状态机',
  };
});

// ---- P0-04 empty stack -----------------------------------------------------
check('P0-04', 'inventory', '空栈（count=0 但 item 非空）仍被手部和 HUD 当成有物品', () => {
  const hand = read('src/client/renderer/hand/HandRenderer.ts');
  const hud = read('src/client/Game.ts');
  const handBad = /getSelectedStack\(\)\.item\?\.namespacedId/.test(hand);
  const hudBad = /item:\s*s\.item \? s\.item\.id : -1/.test(hud);
  const splitBad = /split\(amount: number\)[\s\S]{0,220}this\.shrink\(real\)/.test(read('src/vanilla/world/item/ItemStack.ts'))
    && !/split\(amount: number\)[\s\S]{0,300}ItemStack\.EMPTY/.test(read('src/vanilla/world/item/ItemStack.ts'));
  return {
    status: handBad || hudBad || splitBad ? 'GAP' : 'PASS',
    evidence: [
      handBad ? 'HandRenderer 用 .item 而非 isEmpty()' : '',
      hudBad ? 'HUD toSlot 用 s.item 而非 isEmpty()' : '',
      splitBad ? 'ItemStack.split 到 0 不写回 EMPTY' : '',
    ].filter(Boolean).join('；') || '空栈已统一按 isEmpty() 处理',
  };
});

// ---- P0-05 mob temptation --------------------------------------------------
check('P0-05', 'mobs', 'TemptGoal 不检查玩家手持食物，动物无条件跟随', () => {
  const src = code(read('src/vanilla/world/entity/ai/goal/TemptGoal.ts'));
  const noFood = !/food|isHeld|heldItem|isEdible|temptItems/i.test(src);
  return {
    status: noFood ? 'GAP' : 'PASS',
    evidence: noFood ? 'TemptGoal 只检查玩家距离/随机数，没有食物 predicate' : 'TemptGoal 检查食物',
  };
});

// ---- P0-06 creative targeting ---------------------------------------------
check('P0-06', 'mobs', 'NearestAttackableTargetGoal 没有创造/旁观/Peaceful 过滤', () => {
  const src = read('src/vanilla/world/entity/ai/goal/NearestAttackableTargetGoal.ts');
  const noCreative = !/creative|spectator|peaceful/i.test(src);
  return {
    status: noCreative ? 'GAP' : 'PASS',
    evidence: noCreative ? '目标选择只检查 isAlive() 和 predicate；创造玩家仍可被选为目标' : '目标选择过滤创造/旁观',
  };
});

// ---- P0-07 creeper creative -----------------------------------------------
check('P0-07', 'mobs', '苦力怕膨胀/爆炸没有创造模式、难度、mobGriefing 判定', () => {
  const swell = read('src/vanilla/world/entity/ai/goal/CreeperSwellGoal.ts');
  const creeper = read('src/vanilla/world/entity/monster/Creeper.ts');
  const game = read('src/client/Game.ts');
  const missing = !/creative|spectator|peaceful|mobGriefing|mob_griefing/i.test(swell + creeper)
    && !/private explode\([\s\S]{0,1200}(creative|mobGriefing|mob_griefing)/i.test(game);
  return {
    status: missing ? 'GAP' : 'PASS',
    evidence: missing ? 'CreeperSwellGoal/Creeper.explode/Game.explode 均无创造/难度/mobGriefing 判定' : '爆炸有模式/规则判定',
  };
});

// ---- P1-08 sheep fur -------------------------------------------------------
check('P1-08', 'models', '羊毛层 body 膨胀 0.6，原版 1.75', () => {
  const src = read('src/client/renderer/entity/model/EntityModels.ts');
  const body = /P\('body'[\s\S]{0,160}B\(-4, -10, -7, 8, 16, 6, 28, 8, false, 0\.6\)/.test(src);
  return {
    status: body ? 'GAP' : 'PASS',
    evidence: body ? 'SheepFurModel body 仍为 grow 0.6；应为 1.75（腿 0.5）' : '羊毛 body 尺寸已修正',
  };
});

// ---- P0-09 skeleton bow ----------------------------------------------------
check('P0-09', 'models', '骷髅弓是模型内置件，isHoldingBow 永远为 true', () => {
  const model = read('src/client/renderer/entity/model/EntityModels.ts');
  const renderer = read('src/client/renderer/entity/EntityRenderer.ts');
  const builtIn = /name: 'bow'/.test(model) && /BOW_AND_ARROW/.test(model);
  const always = /isHoldingBow = e\.getTypeName\(\) === 'skeleton'/.test(renderer);
  return {
    status: builtIn && always ? 'GAP' : 'PASS',
    evidence: [
      builtIn ? 'SkeletonModel 内置 bow 子节点' : '',
      always ? 'ctx.isHoldingBow 对 skeleton 恒真' : '',
      !/getHandLayers|equipment/i.test(renderer) ? '没有生物手持物 layer' : '',
    ].filter(Boolean).join('；') || '弓来自装备层',
  };
});

// ---- P1-10 music -----------------------------------------------------------
check('P1-10', 'audio', '没有 music/record 资源，music.* 被别名到水/水下音效', () => {
  const soundDir = path.join(ROOT, 'public/mc/sounds');
  const dirs = fs.existsSync(soundDir) ? fs.readdirSync(soundDir, { withFileTypes: true }).filter((e) => e.isDirectory()).map((e) => e.name) : [];
  const hasMusic = dirs.some((d) => /^music|^record/.test(d));
  const index = JSON.parse(read('public/mc/sounds/index.json')).events ?? {};
  const events = Object.keys(index);
  const musicEvents = events.filter((e) => e.startsWith('music.') || e.startsWith('record.'));
  const aliasSrc = read('src/client/audio/SoundEvents.ts');
  const badAlias = /'music\.(game|menu|creative|nether|end)'/.test(aliasSrc);
  return {
    status: !hasMusic && musicEvents.length === 0 && badAlias ? 'GAP' : 'PASS',
    evidence: `music/record 目录=${hasMusic}，索引事件=${musicEvents.length}，music 别名=${badAlias}`,
  };
});

// ---- P1-11 sky fog ---------------------------------------------------------
check('P1-11', 'render', '天空/地形同期，但 GL clear 与天空 disc 边缘可能在日落露底', () => {
  const level = code(read('src/client/renderer/LevelRenderer.ts'));
  const game = code(read('src/client/Game.ts'));
  const sky = code(read('src/client/renderer/environment/SkyRenderer.ts'));
  // Verified 2026-11-21: terrain does pass cameraForward/sunrise (the earlier report claim was wrong).
  const terrainForward = /computeFog\(\{[\s\S]{0,700}cameraForward/.test(level);
  const skyForward = /computeFogColor\(\{[\s\S]{0,700}cameraForward/.test(sky);
  const clearRaw = /gl\.clearColor\(skyState\.fogColor\[0\]/.test(game);
  const discDiscard = /dist > 512\.0\) discard/.test(sky);
  const gap = !terrainForward || !skyForward || clearRaw || discDiscard;
  return {
    status: gap ? 'GAP' : 'PASS',
    evidence: `terrainForward=${terrainForward}，skyForward=${skyForward}，clear 用原始 fog=${clearRaw}，skyDisc 512 裁边=${discDiscard}`,
  };
});

// ---- P1-12 torch shadow ----------------------------------------------------
check('P1-12', 'render', '阴影乘子作用在整张 lightmap，火把光被硬切', () => {
  const src = read('src/client/renderer/Shaders.ts');
  const combined = /vec3 color = tex\.rgb \* vColor\.rgb \* light;/.test(src)
    && /color \*= mix\(1\.0, mix\(0\.55, 1\.0, lit\), skyMask \* ndl \* sunUp\)/.test(src);
  return {
    status: combined ? 'GAP' : 'PASS',
    evidence: combined ? 'shadow 乘子直接乘在 sky+block 合成后的 color 上' : '阴影只影响天光项',
  };
});

// ---- P1-13 panorama --------------------------------------------------------
check('P1-13', 'gui', '主界面全景是 2D strip，不是 cube map', () => {
  const src = code(read('src/client/gui/components/PanoramaRenderer.ts'));
  const strip = /strip|SIDE_FACES|drawImage/.test(src) && !/texture_cube|cubeMap|createCube/i.test(src);
  return {
    status: strip ? 'GAP' : 'PASS',
    evidence: strip ? 'PanoramaRenderer 仍是 4 面 2D strip + cross-fade' : '已使用 cube map',
  };
});

const gaps = results.filter((r) => r.status === 'GAP');
const json = {
  generatedAt: new Date().toISOString(),
  total: results.length,
  gaps: gaps.length,
  results,
};
fs.mkdirSync(OUT, { recursive: true });
fs.writeFileSync(path.join(OUT, 'p0-audit.json'), JSON.stringify(json, null, 2) + '\n');

const rows = results.map((r) => `| ${r.id} | ${r.area} | ${r.title} | **${r.status}** | ${r.evidence} |`).join('\n');
const md = `# P0 行为/结构审计（自动生成）

> 生成时间：${json.generatedAt}
> 这不是单元测试；\`GAP\` 表示“review 发现的问题在源码里仍然存在”，用作 burn-down 清单。
> 重新生成：\`node scripts/audit-p0.mjs\`

共 ${results.length} 项，GAP ${gaps.length} 项。

| ID | 域 | 检查 | 状态 | 证据 |
|---|---|---|---|---|
${rows}

## GAP 清单

${gaps.length ? gaps.map((g) => `- **${g.id}** ${g.title} — ${g.evidence}`).join('\n') : '- 无'}
`;
fs.writeFileSync(path.join(OUT, 'p0-audit.md'), md + '\n');

for (const r of results) console.log(`${r.status.padEnd(5)} ${r.id}  ${r.title}`);
console.log(`\n${results.length} checks, ${gaps.length} gaps`);
