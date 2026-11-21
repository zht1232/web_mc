import { chromium } from 'playwright';
import { launchOptions } from './lib/browser.mjs';
const b = await chromium.launch(launchOptions());
const p = await (await b.newContext({ viewport: { width: 800, height: 600 } })).newPage();
await p.goto('http://127.0.0.1:5174/?play', { waitUntil: 'load' });
await p.waitForFunction(() => !!window.__mc?.running, null, { timeout: 120000 });
await p.waitForTimeout(12000);
const out = await p.evaluate(() => {
  const g = window.__mc;
  const isLog = (s) => /_log$|_wood$/.test(g.mc.blockOf(s)?.name ?? '');
  const solidGround = (s) => {
    const n = g.mc.blockOf(s)?.name ?? '';
    return /dirt|grass_block|podzol|sand|stone|gravel|moss|mycelium|snow|mud|clay/.test(n);
  };
  let logs = 0, floating = 0, samples = [];
  for (const chunk of g.level.chunks.values()) {
    for (let y = chunk.minY; y < chunk.minY + chunk.height; y++) {
      for (let z = 0; z < 16; z += 3) {
        for (let x = 0; x < 16; x += 3) {
          const s = chunk.getBlockState(x, y, z);
          if (!s || !isLog(s)) continue;
          logs++;
          const below = chunk.getBlockState(x, y - 1, z);
          if (!below || g.mc.isAir(below)) {
            floating++;
            if (samples.length < 5) samples.push([chunk.x * 16 + x, y, chunk.z * 16 + z]);
          }
        }
      }
    }
  }
  return { logs, floating, samples, chunks: g.level.chunks.size };
});
console.log(JSON.stringify(out));
await b.close();
