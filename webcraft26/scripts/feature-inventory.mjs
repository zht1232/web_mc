// Builds a side-by-side feature inventory for webcraft26 and Horizon.
//
// Why: manual review missed whole crates (the first pass only had
// horizon-client-render checked out). This script makes the checklist
// reproducible: every run lists what exists on each side, so "did we compare
// everything?" can be answered with counts and file names instead of memory.
//
// Usage:
//   node scripts/feature-inventory.mjs
//   HORIZON_DIR=/path/to/horizon node scripts/feature-inventory.mjs
//
// Outputs:
//   REPORTS/coverage/feature-inventory.json
//   REPORTS/coverage/feature-inventory.md
import fs from 'node:fs';
import path from 'node:path';

const ROOT = process.cwd();
const HORIZON = process.env.HORIZON_DIR ?? path.resolve(ROOT, '..', 'horizon-main');
const OUT_DIR = path.join(ROOT, 'REPORTS', 'coverage');

const read = (p) => fs.readFileSync(p, 'utf8');
const exists = (p) => fs.existsSync(p);
const rel = (p) => path.relative(ROOT, p).replace(/\\/g, '/');

function walk(dir, filter = () => true) {
  if (!exists(dir)) return [];
  const out = [];
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) out.push(...walk(full, filter));
    else if (filter(full, entry.name)) out.push(full);
  }
  return out;
}

const baseName = (p) => path.basename(p, path.extname(p));
const camelToSnake = (s) => s.replace(/([a-z0-9])([A-Z])/g, '$1_$2').replace(/([A-Z])([A-Z][a-z])/g, '$1_$2').toLowerCase();

// ---------------------------------------------------------------- webcraft
const entityTypePath = path.join(ROOT, 'src/vanilla/world/entity/EntityType.ts');
const entityFactoryPath = path.join(ROOT, 'src/vanilla/world/entity/EntityFactory.ts');
const entityTypeSrc = read(entityTypePath);
const entityFactorySrc = read(entityFactoryPath);

const entityRows = [...entityTypeSrc.matchAll(/^\s*\['([^']+)',([\d.]+),([\d.]+),(\d),'([A-Z_]+)'\]/gm)]
  .map((m) => ({ name: m[1], width: +m[2], height: +m[3], fireImmune: m[4] === '1', category: m[5] }));

const implementedFactories = [...entityFactorySrc.matchAll(/^\s{2}([a-z_]+): l =>/gm)].map((m) => m[1]);
const nonMobFactories = ['item', 'experience_orb', 'arrow'];
const implementedMobs = implementedFactories.filter((n) => !nonMobFactories.includes(n));

const screenFiles = walk(path.join(ROOT, 'src/client/gui/screens'), (p) => p.endsWith('.ts'))
  .map(rel).sort();

const featureFiles = walk(path.join(ROOT, 'src/vanilla/world/level/levelgen/feature/features'), (p) => p.endsWith('.ts'))
  .map(baseName).sort();

const structureFiles = walk(path.join(ROOT, 'src/vanilla/world/level/levelgen/structure'), (p) => p.endsWith('.ts'))
  .map(baseName).sort();

const rendererModules = walk(path.join(ROOT, 'src/client/renderer'), (p) => p.endsWith('.ts'))
  .map(rel).sort();

const postModules = walk(path.join(ROOT, 'src/client/renderer/post'), (p) => p.endsWith('.ts'))
  .map(baseName).sort();

const soundIndexPath = path.join(ROOT, 'public/mc/sounds/index.json');
const soundEvents = exists(soundIndexPath) ? Object.keys(JSON.parse(read(soundIndexPath)).events ?? {}) : [];
const musicEvents = soundEvents.filter((e) => e.startsWith('music.') || e.startsWith('record.'));

const blockData = exists(path.join(ROOT, 'public/mc/blocks.json'))
  ? JSON.parse(read(path.join(ROOT, 'public/mc/blocks.json')))
  : { blocks: [], items: [], entities: [] };
const itemModels = exists(path.join(ROOT, 'public/mc/itemmodels.json'))
  ? JSON.parse(read(path.join(ROOT, 'public/mc/itemmodels.json'))).items ?? {}
  : {};

const testScripts = walk(path.join(ROOT, 'scripts'), (p, name) => /^test-.*\.(mjs|mts)$/.test(name))
  .map((p) => rel(p)).sort();

// ---------------------------------------------------------------- horizon
const cratesDir = path.join(HORIZON, 'crates');
const crates = exists(cratesDir)
  ? fs.readdirSync(cratesDir, { withFileTypes: true }).filter((e) => e.isDirectory()).map((e) => e.name).sort()
  : [];
const horizonFiles = crates.flatMap((c) => walk(path.join(cratesDir, c, 'src'), (p) => p.endsWith('.rs')));
const horizonRsCount = horizonFiles.length;
const horizonTestFiles = horizonFiles.filter((p) => /(_tests|tests)\.rs$/.test(path.basename(p)));

const interfaceDir = path.join(HORIZON, 'crates/horizon-client/src/game/interface');
const interfaceScreens = exists(interfaceDir)
  ? walk(interfaceDir, (p) => p.endsWith('.rs'))
      .filter((p) => /screen|menu|hud|chat|music|advancement|stats|subtitle|creative|inventory|container/i.test(path.basename(p)))
      .map(baseName).sort()
  : [];

const titleDir = path.join(HORIZON, 'crates/horizon-client/src/title');
const titleModules = exists(titleDir) ? walk(titleDir, (p) => p.endsWith('.rs')).map(baseName).sort() : [];

const mobsDir = path.join(HORIZON, 'crates/horizon-client/src/mobs');
const mobFiles = walk(mobsDir, (p) => p.endsWith('.rs'));
const mobModuleNames = [...new Set(mobFiles.map(baseName))].sort();

const speciesPath = path.join(mobsDir, 'species.rs');
let horizonSpecies = [];
if (exists(speciesPath)) {
  const src = read(speciesPath);
  const start = src.indexOf('pub enum Species {');
  const end = src.indexOf('}', start);
  if (start >= 0 && end > start) {
    horizonSpecies = [...src.slice(start, end).matchAll(/^\s{4}([A-Z][A-Za-z0-9]*),/gm)]
      .map((m) => camelToSnake(m[1]));
  }
}

const worldgenDir = path.join(HORIZON, 'crates/horizon-world/src/worldgen');
const horizonWorldgenModules = exists(worldgenDir)
  ? fs.readdirSync(worldgenDir, { withFileTypes: true })
      .filter((e) => e.isFile() && e.name.endsWith('.rs')).map((e) => baseName(e.name)).sort()
  : [];

const horizonItemModules = exists(path.join(HORIZON, 'crates/horizon-items/src'))
  ? walk(path.join(HORIZON, 'crates/horizon-items/src'), (p) => p.endsWith('.rs')).map(baseName).sort()
  : [];

const horizonCrateSizes = Object.fromEntries(crates.map((c) => {
  const files = walk(path.join(cratesDir, c, 'src'), (p) => p.endsWith('.rs'));
  return [c, files.length];
}));

// ---------------------------------------------------------------- compare
const mobCategories = new Set(['MONSTER', 'CREATURE', 'AMBIENT', 'WATER_CREATURE', 'WATER_AMBIENT', 'AXOLOTLS', 'MISC']);
const ourEntityNames = new Set(entityRows.map((e) => e.name));
const ourMobs = entityRows.filter((e) => e.category !== 'MISC');
const horizonMobSet = new Set(horizonSpecies);
const missingInOurs = horizonSpecies.filter((s) => !ourEntityNames.has(s));
const implementedNotInHorizon = implementedFactories.filter((n) => !horizonMobSet.has(n) && !['item', 'experience_orb', 'arrow'].includes(n));
const missingFactories = ourMobs.filter((e) => !implementedFactories.includes(e.name)).map((e) => e.name);

const result = {
  generatedAt: new Date().toISOString(),
  paths: { project: path.basename(ROOT), horizon: path.basename(HORIZON) },
  webcraft: {
    entityTypes: entityRows.length,
    mobTypes: ourMobs.length,
    implementedFactories: implementedFactories.length,
    implementedMobs: implementedMobs.length,
    missingFactories,
    screens: screenFiles,
    features: featureFiles,
    structures: structureFiles,
    rendererFiles: rendererModules.length,
    postModules,
    blocks: blockData.blocks?.length ?? 0,
    items: blockData.items?.length ?? Object.keys(itemModels).length,
    itemModels: Object.keys(itemModels).length,
    soundEvents: soundEvents.length,
    musicRecordEvents: musicEvents.length,
    tests: testScripts,
  },
  horizon: {
    crates,
    crateSourceFiles: horizonCrateSizes,
    rustSourceFiles: horizonRsCount,
    testFiles: horizonTestFiles.length,
    interfaceScreens,
    titleModules,
    mobModules: mobModuleNames,
    species: horizonSpecies,
    worldgenModules: horizonWorldgenModules,
    itemModules: horizonItemModules,
  },
  diff: {
    horizonSpeciesNotInOurEntityRegistry: missingInOurs.sort(),
    ourFactoriesNotInHorizonSpecies: implementedNotInHorizon.sort(),
    ourMobTypesWithoutFactory: missingFactories.sort(),
  },
};

fs.mkdirSync(OUT_DIR, { recursive: true });
fs.writeFileSync(path.join(OUT_DIR, 'feature-inventory.json'), JSON.stringify(result, null, 2) + '\n');

const list = (items, n = 80) => items.length ? items.slice(0, n).map((x) => `- \`${x}\``).join('\n') + (items.length > n ? `\n- … 还有 ${items.length - n} 项` : '') : '- （无）';
const md = `# Feature Inventory（自动生成）

> 生成时间：${result.generatedAt}
> 本项目：\`${ROOT}\`
> Horizon：\`${HORIZON}\`
> 这个文件只回答“有什么/在哪里”，不证明行为一致；行为对照见 \`REPORTS/HORIZON-COVERAGE-2026-11-21.md\`。

## 1. 规模对比

| 维度 | webcraft26 | Horizon |
|---|---:|---:|
| crate 数 | — | ${crates.length} |
| Rust/TS 源文件 | ${rendererModules.length + screenFiles.length}（renderer+screens） | ${horizonRsCount} |
| 实体类型 | ${entityRows.length} | ${horizonSpecies.length}（Species） |
| 非 MISC 实体类型 | ${ourMobs.length} | — |
| 已实现 mob 工厂 | ${implementedMobs.length} | ${horizonSpecies.length}（Species） |
| 工厂总数（含 item/XP/arrow） | ${implementedFactories.length} | — |
| 屏幕文件 | ${screenFiles.length} | ${interfaceScreens.length}（interface 相关） |
| 地形 feature | ${featureFiles.length} | ${horizonWorldgenModules.length}（worldgen 模块） |
| 结构模块 | ${structureFiles.length} | 见 worldgen（${horizonWorldgenModules.filter((m) => /structure|template|jigsaw|village|fortress|mineshaft|monument|ruin/.test(m)).length} 个相关） |
| 方块 / 物品 | ${result.webcraft.blocks} / ${result.webcraft.items} | 由 assets 提供（运行时读取） |
| 音效事件 | ${soundEvents.length} | 由 sounds.json/assets 提供 |
| 音乐/唱片事件 | ${musicEvents.length} | 完整 MusicManager |
| 测试文件 | ${testScripts.length} | ${horizonTestFiles.length} |

## 2. 我们注册了但还没有 factory 的 mob

${list(missingFactories, 120)}

## 3. Horizon 有、我们 EntityType 表里没有的物种

${list(result.diff.horizonSpeciesNotInOurEntityRegistry, 120)}

## 4. 我们的 factory 不在 Horizon Species 里的（非 mob 或命名差异）

${list(result.diff.ourFactoriesNotInHorizonSpecies, 80)}

## 5. 我们的屏幕

${list(screenFiles, 120)}

## 6. Horizon 的界面/屏幕相关模块

${list(interfaceScreens, 160)}

## 7. Horizon title 模块（世界选择/创建/编辑）

${list(titleModules, 80)}

## 8. 我们的地形 feature 模块

${list(featureFiles, 120)}

## 9. Horizon worldgen 模块

${list(horizonWorldgenModules, 160)}

## 10. 音效

- 事件总数：${soundEvents.length}
- music/record 事件：${musicEvents.length}
${musicEvents.length ? list(musicEvents, 40) : '- **没有 music/record 事件**（运行时 \`public/mc/sounds\` 也没有对应 ogg）'}

## 11. 测试入口

${list(testScripts, 80)}
`;

fs.writeFileSync(path.join(OUT_DIR, 'feature-inventory.md'), md);

console.log(`[inventory] webcraft: ${entityRows.length} entity types, ${implementedMobs.length} mob factories (+${nonMobFactories.length} non-mob), ${screenFiles.length} screens, ${featureFiles.length} features, ${soundEvents.length} sounds`);
console.log(`[inventory] horizon: ${crates.length} crates, ${horizonRsCount} rs files, ${horizonSpecies.length} species, ${horizonWorldgenModules.length} worldgen modules, ${horizonTestFiles.length} test files`);
console.log(`[inventory] wrote ${path.join(OUT_DIR, 'feature-inventory.json')}`);
console.log(`[inventory] wrote ${path.join(OUT_DIR, 'feature-inventory.md')}`);
