// node scripts/mgr-sidebyside.mjs out.png ours.png ref.png [scale=2]  -> ours | ref at 1/scale size
import { PNG } from 'pngjs';
import fs from 'node:fs';
const [out, a, b, sc = '2'] = process.argv.slice(2);
const s = Number(sc);
const A = PNG.sync.read(fs.readFileSync(a)), B = PNG.sync.read(fs.readFileSync(b));
const w = Math.floor(A.width / s), h = Math.floor(A.height / s);
const O = new PNG({ width: w * 2 + 4, height: h });
O.data.fill(255);
const blit = (src, ox) => {
  for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) {
    let r = 0, g = 0, bl = 0, n = 0;
    for (let dy = 0; dy < s; dy++) for (let dx = 0; dx < s; dx++) { const i = ((y * s + dy) * src.width + x * s + dx) * 4; r += src.data[i]; g += src.data[i + 1]; bl += src.data[i + 2]; n++; }
    const o = (y * O.width + ox + x) * 4; O.data[o] = r / n; O.data[o + 1] = g / n; O.data[o + 2] = bl / n; O.data[o + 3] = 255;
  }
};
blit(A, 0); blit(B, w + 4);
fs.writeFileSync(out, PNG.sync.write(O));
console.log(out, O.width + 'x' + O.height);
