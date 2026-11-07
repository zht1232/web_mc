// Collects everything that makes this project reproducible after a session is
// lost: the code, the derived state indexes, every session transcript, the
// subagent research reports pulled out of those transcripts, the local tooling,
// and the memory files. Official Mojang assets are excluded by default —
// regenerate them with `npm run assets` from your own client jar.
//
//   node scripts/export-bundle.mjs --out G:/ck-web26/export
//
import fs from 'node:fs/promises';
import path from 'node:path';
import { createReadStream, createWriteStream, existsSync } from 'node:fs';
import { createHash } from 'node:crypto';
import { execSync } from 'node:child_process';

const ROOT = path.resolve(process.cwd());
const argv = process.argv.slice(2);
const outArg = argv.indexOf('--out');
const OUT_BASE = outArg >= 0 ? path.resolve(argv[outArg + 1]) : path.resolve(ROOT, 'bundle');
const WITH_ASSETS = argv.includes('--with-assets');
const QODER = path.join(process.env.USERPROFILE || 'C:/Users/zht', '.qoder');

// Session stores live under a folder named after the workspace the session was
// opened in, which is not this repo's folder — locate them by session id.
async function sessionHome(sessionId) {
  for (const entry of await fs.readdir(path.join(QODER, 'projects'), { withFileTypes: true })) {
    if (!entry.isDirectory()) continue;
    const projDir = path.join(QODER, 'projects', entry.name);
    if (existsSync(path.join(projDir, sessionId))) return { sessDir: path.join(projDir, sessionId), projDir };
  }
  return null;
}

// Sessions that worked on this project, newest first. Labels become directory
// names, so no colons (the real titles have them).
const SESSIONS = [
  { id: '4194ac07-3388-461d-bacb-992b30d1733b', label: '01-crashed-4194ac07-1to1复刻26.2mc游戏', title: '1:1复刻26.2mc游戏（已崩溃）' },
  { id: 'fff2a91d-b0c8-4d8d-bf51-c2324b964d3a', label: '02-current-fff2a91d-抽离子agent并逐源码复刻', title: '抽离子agent并逐源码复刻（当前）' },
];

const SKIP_DIRS = new Set(['node_modules', 'dist', '.git', '.vite', 'bundle', 'public']);
const GENERATED = ['manifest.json', 'states.json', 'states.bin', 'atlas.json'];
const TOOLS = [
  ['G:/ck-web26/tools/vineflower.jar', 'tools/vineflower-1.11.2.jar'],
  ['G:/ck-web26/make_launch.py', 'tools/make_launch.py'],
  ['G:/ck-web26/launch.args', 'tools/launch.args'],
];
const THIRD_PARTY = [
  ['G:/ck-web26/src-vanilla', 'thirdparty/src-vanilla'],
  ['D:/tmp/shaderport/pack', 'thirdparty/complementary-reimagined-r5.9.3'],
];

const STAMP = new Date().toISOString().slice(0, 10);
const OUT = path.join(OUT_BASE, `webcraft26-bundle-${STAMP}`);

async function copyTree(src, dst, skip = SKIP_DIRS) {
  let files = 0, bytes = 0;
  await fs.mkdir(dst, { recursive: true });
  const walk = async (from, to) => {
    await fs.mkdir(to, { recursive: true });
    for (const entry of await fs.readdir(from, { withFileTypes: true })) {
      const s = path.join(from, entry.name), d = path.join(to, entry.name);
      if (entry.isDirectory()) {
        if (skip.has(entry.name)) continue;
        await walk(s, d);
      } else if (entry.isFile()) {
        await fs.copyFile(s, d);
        files++;
        bytes += (await fs.stat(d)).size;
      }
    }
  };
  await walk(src, dst);
  return { files, bytes };
}

async function copyOne(src, dst) {
  if (!existsSync(src)) return null;
  await fs.mkdir(path.dirname(path.join(OUT, dst)), { recursive: true });
  await fs.copyFile(src, path.join(OUT, dst));
  return (await fs.stat(path.join(OUT, dst))).size;
}

function textOf(message) {
  const c = message?.content;
  if (typeof c === 'string') return c;
  if (Array.isArray(c)) return c.filter(b => b?.type === 'text').map(b => b.text).join('\n');
  return '';
}

// Pulls the delegated task and the agent's final report out of a JSONL transcript.
async function extractReport(file) {
  const lines = (await fs.readFile(file, 'utf8')).split('\n').filter(Boolean);
  let task = '', started = '', ended = '', model = '';
  const assistantTexts = [];
  const tools = new Map();
  for (const line of lines) {
    let o;
    try { o = JSON.parse(line); } catch { continue; }
    const msg = o.message || {};
    if (!started && o.timestamp) started = o.timestamp;
    if (o.timestamp) ended = o.timestamp;
    if (msg.role === 'user' && !task && typeof msg.content === 'string') task = msg.content;
    if (msg.role === 'assistant') {
      if (msg.model) model = msg.model;
      const t = textOf(msg);
      if (t.trim()) assistantTexts.push(t);
      for (const b of Array.isArray(msg.content) ? msg.content : []) {
        if (b?.type === 'tool_use') tools.set(b.name, (tools.get(b.name) || 0) + 1);
      }
    }
  }
  // The closing message is the report; keep the last few so nothing is lost.
  const report = assistantTexts.slice(-3).join('\n\n---\n\n');
  return {
    id: path.basename(file, '.jsonl').replace(/^agent-/, ''),
    lines: lines.length, started, ended, model,
    task: task.trim(),
    tools: [...tools.entries()].sort((a, b) => b[1] - a[1]).map(([k, v]) => `${k}×${v}`).join(' '),
    report: report || '(no assistant text captured)',
    allTexts: assistantTexts.length,
  };
}

async function sha256(file) {
  return new Promise((resolve, reject) => {
    const h = createHash('sha256');
    createReadStream(file).on('data', d => h.update(d)).on('end', () => resolve(h.digest('hex'))).on('error', reject);
  });
}

const report = { sections: [], notes: [] };
async function section(name, detail) {
  report.sections.push(`| ${name} | ${detail} |`);
}

await fs.mkdir(OUT, { recursive: true });

// 1. source, scripts, research, docs
const proj = await copyTree(ROOT, path.join(OUT, 'project'));
await section('project/', `${proj.files} 文件 ${(proj.bytes / 1048576).toFixed(2)} MB — src/ scripts/ research/ bridge/ README 等，排除 node_modules、dist、public（官方素材）`);

// 2. derived indexes (regenerable, but expensive to rebuild and version-critical)
let genBytes = 0, genFiles = 0;
for (const f of GENERATED) {
  const src = path.join(ROOT, 'public/mc', f);
  if (!existsSync(src)) continue;
  const size = await copyOne(src, `generated/${f}`);
  if (size) { genBytes += size; genFiles++; }
}
await section('generated/', `${genFiles} 文件 ${(genBytes / 1048576).toFixed(2)} MB — states.json / states.bin / manifest.json（由官方资源导出的索引与几何，非官方 PNG）`);

// 3. sessions: transcript + subagent transcripts + task list + state
const sessionHomes = new Map();
let sessFiles = 0, sessBytes = 0;
for (const s of SESSIONS) {
  const home = await sessionHome(s.id);
  if (home) sessionHomes.set(s.id, home); else report.notes.push(`未找到会话存储：${s.id}`);
  const sessDir = home ? home.sessDir : null;
  const projDir = home ? home.projDir : null;
  const dstDir = path.join(OUT, 'sessions', s.label);
  const transcript = sessDir ? sessDir + '.jsonl' : null;
  if (transcript && existsSync(transcript)) {
    await fs.mkdir(dstDir, { recursive: true });
    await fs.copyFile(transcript, path.join(dstDir, 'transcript.jsonl'));
    sessFiles++; sessBytes += (await fs.stat(path.join(dstDir, 'transcript.jsonl'))).size;
  }
  if (sessDir) {
    const r = await copyTree(sessDir, path.join(dstDir, 'session-store'), new Set());
    sessFiles += r.files; sessBytes += r.bytes;
  }
  const tasksDir = path.join(QODER, 'tasks', s.id);
  if (existsSync(tasksDir)) {
    const r = await copyTree(tasksDir, path.join(dstDir, 'tasks'), new Set());
    sessFiles += r.files; sessBytes += r.bytes;
  }
  if (projDir) {
    const memDir = path.join(projDir, 'memory');
    if (existsSync(memDir)) {
      const r = await copyTree(memDir, path.join(dstDir, 'memory'), new Set());
      sessFiles += r.files; sessBytes += r.bytes;
    }
  }
}
await section('sessions/', `${sessFiles} 文件 ${(sessBytes / 1048576).toFixed(2)} MB — 两个会话的完整 transcript、子 agent 转录、任务列表、会话记忆`);

// 4. readable research reports extracted from the subagent transcripts
const index = [];
for (const s of SESSIONS) {
  const home = sessionHomes.get(s.id);
  if (!home) continue;
  const subDir = path.join(home.sessDir, 'subagents');
  if (!existsSync(subDir)) continue;
  const dir = path.join(OUT, 'sessions', s.label, 'reports');
  await fs.mkdir(dir, { recursive: true });
  for (const f of (await fs.readdir(subDir)).filter(x => x.endsWith('.jsonl')).sort()) {
    const r = await extractReport(path.join(subDir, f));
    const title = (r.task.split('\n')[0] || '').slice(0, 110);
    const body = [
      `# ${r.id}`,
      '',
      `- 会话：${s.title}`,
      `- 时间：${r.started} → ${r.ended || r.started}`,
      `- 模型：${r.model || '?'}`,
      `- 转录行数：${r.lines}（助手文本 ${r.allTexts} 条）`,
      `- 工具使用：${r.tools || '—'}`,
      '',
      '## 派发的任务',
      '',
      r.task || '(未记录)',
      '',
      '## 报告（转录末段）',
      '',
      r.report,
      '',
    ].join('\n');
    const safe = title.replace(/[\\/:*?"<>|]/g, '_').slice(0, 70) || r.id.slice(-12);
    const file = `${r.id.slice(-12)}-${safe}.md`;
    await fs.writeFile(path.join(dir, file), body);
    index.push({ session: s.label, file, id: r.id, title, tools: r.tools });
  }
}
for (const s of SESSIONS) {
  const dir = path.join(OUT, 'sessions', s.label, 'reports');
  if (!existsSync(dir)) continue;
  const mine = index.filter(i => i.session === s.label);
  await fs.writeFile(path.join(dir, 'INDEX.md'),
    `# ${s.title} — 子 agent 调研报告索引\n\n共 ${mine.length} 份。\n\n` +
    mine.map(i => `- [${i.title || i.id}](./${i.file}) — \`${i.id.slice(-12)}\`${i.tools ? '，' + i.tools : ''}`).join('\n') + '\n');
}
await section('sessions/*/reports/', `${index.length} 份可读报告 + 各自 INDEX.md — 从子 agent JSONL 转录抽出的任务原文与最终报告`);

// 5. user memory (preferences and feedback that outlive any single project)
const userMem = path.join(QODER, 'memory');
if (existsSync(userMem)) {
  const r = await copyTree(userMem, path.join(OUT, 'memory/user'), new Set());
  await section('memory/user/', `${r.files} 文件 — 跨项目的用户偏好与协作反馈`);
}

// 6. local tooling
let toolBytes = 0;
for (const [src, dst] of TOOLS) {
  const size = await copyOne(src, dst);
  if (size) toolBytes += size; else report.notes.push(`缺少工具：${src}`);
}
await fs.writeFile(path.join(OUT, 'tools/README.md'), [
  '# 本机工具',
  '',
  '- `vineflower-1.11.2.jar`：反编译官方客户端 jar（来自 Maven Central 官方构件）。',
  '- 重新生成源码树（约 2 分钟，产出 7,055 个 Java 文件）：',
  '  ```',
  '  "C:/Users/zht/AppData/Roaming/.minecraft/runtime/java-runtime-epsilon/bin/java.exe" -Xmx4G \\\n    -jar vineflower-1.11.2.jar -ae G:/ck-web26/client-26.2.jar G:/ck-web26/src-vanilla',
  '  ```',
  '- `make_launch.py` / `launch.args`：以干净 gameDir 启动真实 26.2 客户端截图用（默认不启动）。',
  '',
].join('\n'));
await section('tools/', `${TOOLS.length} 项 ${(toolBytes / 1048576).toFixed(2)} MB — Vineflower、反编译命令、原版客户端截图启动器`);

// 7. third-party trees (local-private only)
if (WITH_ASSETS) {
  for (const [src, dst] of THIRD_PARTY) {
    if (!existsSync(src)) { report.notes.push(`缺少：${src}`); continue; }
    const r = await copyTree(src, path.join(OUT, dst), new Set());
    await section(dst + '/', `${r.files} 文件 ${(r.bytes / 1048576).toFixed(2)} MB — 第三方/官方派生物，仅限本机`);
  }
  if (existsSync(path.join(ROOT, 'public/mc'))) {
    const r = await copyTree(path.join(ROOT, 'public/mc'), path.join(OUT, 'thirdparty/official-assets-mc'), new Set());
    await section('thirdparty/official-assets-mc/', `${r.files} 文件 ${(r.bytes / 1048576).toFixed(2)} MB — Mojang 官方素材，禁止公开分发`);
  }
} else {
  report.notes.push('未包含官方素材与 src-vanilla：加 --with-assets 重新导出');
}

// 8. bundle manifest
const key = ['project/scripts/vanmodel.mjs', 'project/scripts/build-states.mjs', 'project/scripts/statepack.mjs',
  'generated/states.json', 'generated/states.bin', 'project/package.json'];
const sums = [];
for (const k of key) {
  const p = path.join(OUT, k);
  if (existsSync(p)) sums.push(`\`${await sha256(p)}\`  ${k}`);
}
await fs.writeFile(path.join(OUT, '00-BUNDLE.md'), [
  `# webcraft26 交付包（${STAMP}）`,
  '',
  'Minecraft Java 26.2 的浏览器 1:1 复刻工程 + 全部会话调研记录 + 本机工具。',
  '',
  '## 内容',
  '',
  '| 目录 | 内容 |',
  '|---|---|',
  ...report.sections,
  '',
  '## 恢复步骤',
  '',
  '```',
  'cd project',
  'npm install                 # 只依赖 pngjs / typescript / vite',
  'npm run assets              # 从你自己的 26.2 客户端重建 public/mc（官方素材不随包分发）',
  'npm run verify:states       # 20 项几何语义抽查',
  'npm run dev                 # http://127.0.0.1:5174/?preview',
  '```',
  '',
  '`generated/` 里的 states.json/states.bin 已经和 `npm run states` 的产出做过全量往返校验，',
  '直接复制进 `public/mc/` 也能立即使用（前提：贴图闭包已补齐，见 README 的 M1c 待办）。',
  '',
  '## 校验和',
  '',
  ...sums.map(s => '- ' + s),
  '',
  '## 分发拆分',
  '',
  `- 代码包（可直接分享/备份）：project/ generated/ sessions/ memory/ tools/ 本文件。`,
  '- 第三方包（仅本机）：thirdparty/ 里的 Mojang 反编译源码、官方贴图导出、Complementary 解包。',
  '- 两个包分别压缩为 `webcraft26-code-*.zip` 与 `webcraft26-thirdparty-local-only-*.zip`。',
  WITH_ASSETS ? '- 本目录已包含 thirdparty/。' : '- 本目录未包含 thirdparty/，用 `--with-assets` 重新导出。',
  '',
  '## 授权边界',
  '',
  '- `public/mc`、`thirdparty/official-assets-mc`、`thirdparty/src-vanilla` 属 Mojang/Microsoft；',
  '- `thirdparty/complementary-reimagined-r5.9.3` 属其作者；',
  '- 以上仅限本机私人游玩，不得提交仓库、不得公开部署。用户已明确：本项目不分析第三方许可条款。',
  '',
  report.notes.length ? '## 备注\n\n' + report.notes.map(n => '- ' + n).join('\n') : '',
].join('\n'));

console.log(`bundle: ${OUT}`);
console.log(report.sections.join('\n'));
if (report.notes.length) console.log('notes:\n  ' + report.notes.join('\n  '));
