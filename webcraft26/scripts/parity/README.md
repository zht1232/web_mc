# Parity harness（Java 逐位对照）

目的：把“同种子同地形”从口头承诺变成可重复的数值对照。

这不是一个“跑一遍截图看起来像”的工具，而是：

```text
Java 原版 / Horizon 输出（golden）
        vs
webcraft26 TS 实现输出
        ↓
逐位比较（f32/f64 的 IEEE bits、nextLong 的 64 位、最终 block state hash）
```

## 三层数据

| 层 | 输出 | 用途 |
|---|---|---|
| RNG | `nextLong/nextInt/nextFloat/nextDouble` 序列 | 先证明随机流一致 |
| Noise / density | 固定 seed、固定坐标的 `final_density`、`preliminary_surface_level` 等采样 | 定位地形形状第一处偏差 |
| Chunk hash | 固定 seed、固定 chunk 的方块状态哈希 | 最终验收 |

## 文件格式

`*.parity.json`：

```json
{
  "kind": "rng",
  "seed": "12345",
  "source": "java-26.2 | horizon | webcraft",
  "samples": [
    { "op": "nextLong", "i": 0, "bits": "0x1f2e3d4c5b6a7988" },
    { "op": "nextInt", "i": 1, "bound": 1000, "value": 512 },
    { "op": "nextFloat", "i": 2, "bits": "0x3f000000" },
    { "op": "nextDouble", "i": 3, "bits": "0x3fe0000000000000" }
  ]
}
```

- `bits` 用十六进制字符串，避免 JSON 数字精度问题。
- 浮点必须用 bits 比较，不能用 `===`（NaN、-0、精度都不可靠）。
- `kind` 将来扩展为 `noise` / `density` / `chunk`，每条 sample 带 `x,y,z` 或 `chunkX,chunkZ`。

## 命令

```bash
# 1) 生成 webcraft 侧的 RNG 样本（tsx）
npx tsx scripts/parity/dump-rng.mts 12345 REPORTS/coverage/parity/rng-webcraft-seed12345.json

# 1b) 生成某个 named noise 的样本
npx tsx scripts/parity/dump-noise.mts 12345 minecraft:aquifer_barrier REPORTS/coverage/parity/noise-webcraft-seed12345.json

# 1c) 生成 overworld final_density 样本
npx tsx scripts/parity/dump-density.mts 12345 final_density REPORTS/coverage/parity/density-webcraft-seed12345.json

# 2) 与 Java/Horizon 的 golden 对比
node scripts/parity/compare-parity.mjs \
  REPORTS/coverage/parity/rng-java-seed12345.json \
  REPORTS/coverage/parity/rng-webcraft-seed12345.json

# 3) 只看前 N 个差异
node scripts/parity/compare-parity.mjs expected.json actual.json --max 10
```

## Java 侧怎么生成 golden

1. 用原版 26.2 / 26.3 客户端或服务端的 `WorldgenRandom`/`XoroshiroRandomSource`：
   ```java
   WorldgenRandom r = new WorldgenRandom(new XoroshiroRandomSource(seed));
   long v = r.nextLong();
   ```
2. 按同样的 `op` 顺序输出 `Long.toHexString` / `Float.floatToRawIntBits` / `Double.doubleToRawLongBits`；
3. 存成 `rng-java-seed<seed>.json`，提交到 `REPORTS/coverage/parity/`。

**不要用本项目自己的输出冒充 Java golden。** `source` 字段必须诚实标记；`compare-parity` 只比较数值，不判断来源。

## 下一步扩展

- `dump-chunk.mts`：固定 seed 生成 chunk，输出 block state hash；
- 每次修复地形相关代码，先跑 RNG，再跑 noise/density，最后跑 chunk，避免“改了地表但其实 RNG 早就错了”。
