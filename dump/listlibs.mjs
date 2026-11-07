// Parses tools/launch.args -> Maven coordinates for the vanilla library set,
// then downloads the ones a headless Bootstrap needs (no natives / no LWJGL).
import fs from 'node:fs';
import path from 'node:path';

const argsPath = 'C:/Users/Administrator/WorkBuddy/2026-11-07-12-41-04/_src/code/tools/launch.args';
const txt = fs.readFileSync(argsPath, 'utf8');
const m = txt.match(/-cp\s*"?([^"\n]+)"?/);
if (!m) throw new Error('no -cp');
const cp = m[1].split(';');
const libs = [];
for (const p of cp) {
  const i = p.indexOf('/libraries/');
  if (i < 0) continue;
  libs.push(p.slice(i + '/libraries/'.length).replace(/\\/g, '/'));
}
fs.writeFileSync('libs.txt', libs.join('\n'));
console.log('total libs', libs.length);

const skip = /natives-|lwjgl|jtracy|text2speech|jna|msal4j|azure|oshi|icu4j|blocklist|jopt-simple|lz4|jorbis|spvc|shaderc|vulkan|vma|freetype|stb|glfw|openal|tracy/;
const wanted = libs.filter((l) => !skip.test(l) && l.endsWith('.jar'));
fs.writeFileSync('wanted.txt', wanted.join('\n'));
console.log('wanted', wanted.length);
console.log(wanted.join('\n'));
