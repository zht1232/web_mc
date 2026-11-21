# Coverage pipeline（自动清单 + 行为审计 + parity）

这套目录对应 `REPORTS/HORIZON-COVERAGE-2026-11-21.md` 第 6 节的落地版本。

## 文件

| 文件 | 说明 |
|---|---|
| `feature-inventory.md` / `.json` | 双方功能清单（自动扫描）。回答“有什么/在哪里”，不证明行为 |
| `p0-audit.md` / `.json` | P0/P1 结构审计。`GAP` = review 问题仍在源码里 |
| `behavior-p0.md` / `.json` | 浏览器实机探针。`GAP` = 问题在运行时复现 |
| `parity/rng-webcraft-seed12345.json` | 本项目 WorldgenRandom 的样本（**不是 Java golden**） |
| `../scripts/parity/` | parity 格式、比较器、RNG 导出器、Java golden 生成说明 |

## 一键运行

```bash
# 1. 双方功能清单
node scripts/feature-inventory.mjs

# 2. 源码结构审计（13 项）
node scripts/audit-p0.mjs

# 3. 实机行为探针（需要 npm run dev，5174）
node scripts/audit-behavior-p0.mjs

# 4. parity 前三层：RNG + named noise + final_density
npx tsx scripts/parity/dump-rng.mts 12345 REPORTS/coverage/parity/rng-webcraft-seed12345.json
npx tsx scripts/parity/dump-noise.mts 12345 minecraft:aquifer_barrier REPORTS/coverage/parity/noise-webcraft-seed12345.json
npx tsx scripts/parity/dump-density.mts 12345 final_density REPORTS/coverage/parity/density-webcraft-seed12345.json
node scripts/parity/compare-parity.mjs <java-or-horizon.json> REPORTS/coverage/parity/rng-webcraft-seed12345.json
```

## 当前基线（2026-11-21）

- 功能清单：本项目 158 个 EntityType / 29 个 mob 工厂 / 22 个 screen / 26 个 feature / 959 个音效；
  Horizon 75 个 crate / 6,218 个 `.rs` / 90 个 Species / 83 个 worldgen 模块 / 995 个测试文件。
- 结构审计：13 项全部 `GAP`（掉落物占位、创造装备/拖放、空栈、TemptGoal、创造目标、苦力怕、羊毛、骷髅弓、music、clear/disc、阴影、全景）。
- 实机行为：B-01 空栈仍显示、B-02 创造拖放后光标仍持有、B-03 创造玩家被僵尸选为目标，均已复现。
- parity：RNG 48 个样本 + `minecraft:aquifer_barrier` 7 个噪声样本 + `final_density` 8 个密度样本已导出并自比较 PASS；Java golden 尚未接入，不能声称“同种子一致”。

## 扩展顺序

1. `dump-chunk.mts`：chunk block-state hash；
2. 每层与 Java golden 对比，先修 RNG/noise/density，再修 surface/carver/feature/structure。

> 不要用本项目输出冒充 Java golden；`source` 字段必须如实填写。
