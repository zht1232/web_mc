import fs from 'node:fs';
import { PNG } from 'pngjs';
const [file] = process.argv.slice(2);
const img = PNG.sync.read(fs.readFileSync(file));
let minX = 1e9, minY = 1e9, maxX = -1, maxY = -1;
for (let y = 0; y < img.height; y++) for (let x = 0; x < img.width; x++) {
  const i = (y * img.width + x) * 4;
  const r = img.data[i], g = img.data[i+1], b = img.data[i+2];
  // vanilla container background #c6c6c6
  if (Math.abs(r-198)<6 && Math.abs(g-198)<6 && Math.abs(b-198)<6) {
    if (x<minX) minX=x; if (x>maxX) maxX=x; if (y<minY) minY=y; if (y>maxY) maxY=y;
  }
}
console.log(file, img.width, img.height, 'panel bbox', minX, minY, maxX, maxY, 'size', maxX-minX+1, maxY-minY+1);
