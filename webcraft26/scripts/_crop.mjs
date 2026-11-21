import fs from 'node:fs';
import { PNG } from 'pngjs';
const [src, dst, x, y, w, h, scale] = process.argv.slice(2);
const img = PNG.sync.read(fs.readFileSync(src));
const sx = +x, sy = +y, sw = +w, sh = +h, k = +(scale || 1);
const out = new PNG({ width: sw * k, height: sh * k });
for (let j = 0; j < sh * k; j++) for (let i = 0; i < sw * k; i++) {
  const si = ((sy + Math.floor(j / k)) * img.width + (sx + Math.floor(i / k))) * 4;
  const di = (j * out.width + i) * 4;
  out.data[di] = img.data[si]; out.data[di+1] = img.data[si+1];
  out.data[di+2] = img.data[si+2]; out.data[di+3] = img.data[si+3];
}
fs.writeFileSync(dst, PNG.sync.write(out));
console.log(dst, out.width, out.height);
