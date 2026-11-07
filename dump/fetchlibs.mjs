import fs from 'node:fs';
import path from 'node:path';
import https from 'node:https';

const libs = fs.readFileSync('wanted.txt', 'utf8').trim().split('\n');
const outDir = path.resolve('libs');
fs.mkdirSync(outDir, { recursive: true });

function download(url, dest, redirects = 0) {
  return new Promise((resolve, reject) => {
    https.get(url, (res) => {
      if (res.statusCode >= 300 && res.statusCode < 400 && res.headers.location) {
        res.resume();
        if (redirects > 5) return reject(new Error('too many redirects'));
        return download(res.headers.location, dest, redirects + 1).then(resolve, reject);
      }
      if (res.statusCode !== 200) {
        res.resume();
        return reject(new Error(`${url} -> ${res.statusCode}`));
      }
      const f = fs.createWriteStream(dest);
      res.pipe(f);
      f.on('finish', () => f.close(() => resolve(dest)));
      f.on('error', reject);
    }).on('error', reject);
  });
}

let ok = 0, skip = 0, fail = 0;
for (const rel of libs) {
  const dest = path.join(outDir, path.basename(rel));
  if (fs.existsSync(dest) && fs.statSync(dest).size > 1000) { skip++; continue; }
  const url = 'https://libraries.minecraft.net/' + rel;
  try {
    await download(url, dest);
    ok++;
  } catch (e) {
    // fallback to maven central for non-mojang artifacts
    try {
      const parts = rel.split('/');
      const file = parts.pop();
      const ver = parts.pop();
      const art = parts.pop();
      const group = parts.join('.');
      const url2 = `https://repo1.maven.org/maven2/${group.replace(/\./g, '/')}/${art}/${ver}/${file}`;
      await download(url2, dest);
      ok++;
    } catch (e2) {
      fail++;
      console.error('FAIL', rel, e.message, '|', e2.message);
    }
  }
}
console.log({ ok, skip, fail });
