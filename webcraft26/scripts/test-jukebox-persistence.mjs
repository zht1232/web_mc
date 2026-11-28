// Browser probe for jukebox block-entity persistence.
//
// A playing record used to be session-only: has_record survived in the block state but the song
// id (comparator output) and the playback position were lost on reload. This probe:
//   * inserts a disc and checks the minecraft:jukebox block entity record (song + ticks);
//   * saves the world, waits, reloads it;
//   * verifies has_record, the restored song (comparator output 2 for cat) and that playback
//     resumed from the saved tick;
//   * checks popping the restored disc still works and clears the record.
//
//   node scripts/test-jukebox-persistence.mjs [--url http://127.0.0.1:5174]
import { chromium } from 'playwright';
import { launchOptions } from './lib/browser.mjs';
import { prepareStage, waitTicks } from './lib/stage.mjs';

const args = process.argv.slice(2);
const urlArg = args.indexOf('--url');
const base = urlArg >= 0 ? args[urlArg + 1] : 'http://127.0.0.1:5174';

const browser = await chromium.launch(launchOptions());
const page = await (await browser.newContext({ viewport: { width: 1000, height: 700 } })).newPage();
const errors = [];
page.on('pageerror', (e) => errors.push(String(e).slice(0, 400)));
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const ev = (fn, arg) => page.evaluate(fn, arg);
const results = [];
const check = (name, ok, detail) => {
  results.push({ name, ok });
  console.log(`${ok ? 'PASS' : 'FAIL'} ${name}${detail === undefined ? '' : ' :: ' + JSON.stringify(detail)}`);
};

async function boot(url) {
  await page.goto(url, { waitUntil: 'domcontentloaded', timeout: 120000 });
  await page.waitForFunction(() => window.__mc?.running === true, null, { timeout: 120000 });
  await page.waitForFunction(() => window.__mc?.sounds?.isReady === true, null, { timeout: 60000 });
  await sleep(800);
}

try {
  await boot(`${base}/?play&perf=0`);
  const stage = await prepareStage(page, { radius: 8, floor: 'stone' });

  const inserted = await ev(async (s) => {
    const m = window.__mc;
    m.options.gamemode = 'survival';
    const x = s.x + 2, y = s.floorY, z = s.z;
    m.level.setBlockState(x, y, z, m.mc.stateOf('jukebox'));
    // Comparator chain so the restored comparator output is observable.
    m.level.setBlockState(x - 1, y, z, m.mc.stateOf('comparator', { facing: 'east', mode: 'compare', powered: 'false' }));
    m.level.setBlockState(x - 2, y, z, m.mc.stateOf('redstone_wire'));
    m.level.setBlockState(x - 3, y, z, m.mc.stateOf('redstone_lamp'));
    m.updateNeighbors(x - 1, y, z);
    const mod = await import('/src/vanilla/world/item/ItemStack.ts');
    const disc = new mod.ItemStack(m.survival.registry.byName('music_disc_cat'), 1);
    m.survival.inventory.setSelectedItem(disc);
    const used = m.useJukebox({ x, y, z });
    const chunk = m.level.getChunk(x >> 4, z >> 4);
    const rec = chunk?.getBlockEntity(x & 15, y, z & 15);
    return {
      used,
      hasRecord: m.mc.getProp(m.level.getBlockState(x, y, z), 'has_record'),
      song: m.jukeboxSongs.get(`${x},${y},${z}`) ?? null,
      entity: rec ? { type: rec.type, record: rec.data.record } : null,
      songStats: m.sounds.stats['music_disc.cat'] ?? 0,
      pos: { x, y, z },
    };
  }, stage);
  check('inserting a disc writes the jukebox block entity',
    inserted.used === true && inserted.hasRecord === 'true' && inserted.song === 'cat'
    && inserted.entity?.type?.endsWith('jukebox') && inserted.entity?.record === 'cat'
    && inserted.songStats > 0, inserted);

  // Let the record play, then save: beforeSave must freeze the elapsed ticks into the record.
  await waitTicks(page, 24);
  await sleep(600);
  const saved = await ev(async () => {
    const m = window.__mc;
    await m.autosave.flushNow('manual');
    return { worldId: m.saveManager.currentWorldId };
  });
  check('the world saved with a bound id', !!saved.worldId, saved);

  // Reload the same world.
  await boot(`${base}/?play&perf=0&world=${encodeURIComponent(saved.worldId)}`);
  await waitTicks(page, 6);
  await sleep(400);
  // The restored comparator must feed the wire/lamp again once the network is refreshed.
  await ev((p) => { window.__mc.updateNeighbors(p.x - 1, p.y, p.z); }, inserted.pos);
  await waitTicks(page, 3);

  const restored = await ev((p) => {
    const m = window.__mc;
    const key = `${p.x},${p.y},${p.z}`;
    const x = p.x, y = p.y, z = p.z;
    const chunk = m.level.getChunk(x >> 4, z >> 4);
    const rec = chunk?.getBlockEntity(x & 15, y, z & 15);
    return {
      state: m.mc.blockOf(m.level.getBlockState(x, y, z)).name,
      hasRecord: m.mc.getProp(m.level.getBlockState(x, y, z), 'has_record'),
      song: m.jukeboxSongs.get(key) ?? null,
      ticks: rec ? Number(rec.data.ticks ?? -1) : -1,
      output: m.redstone.comparatorOutputAt(x - 1, y, z),
      wire: m.mc.getProp(m.level.getBlockState(x - 2, y, z), 'power'),
      lamp: m.mc.getProp(m.level.getBlockState(x - 3, y, z), 'lit'),
      playing: m.playingJukeboxKey === key,
      handle: !!m.recordHandle,
      offsetTicks: Math.round((performance.now() - m.recordStartMs) / 50),
      songStats: m.sounds.stats['music_disc.cat'] ?? 0,
    };
  }, inserted.pos);
  check('the jukebox and its disc survive the reload',
    restored.state === 'jukebox' && restored.hasRecord === 'true' && restored.song === 'cat', restored);
  check('the saved playback position restores (ticks >= 20)',
    restored.ticks >= 20 && restored.ticks < 1200, { ticks: restored.ticks });
  check('the restored jukebox drives the comparator again',
    restored.output === 2 && restored.wire === '2' && restored.lamp === 'true', restored);
  check('playback resumes from the saved position',
    restored.playing === true && restored.handle === true && restored.songStats > 0
    && restored.offsetTicks >= 15, restored);

  // Popping the restored disc clears the record and the comparator.
  const popped = await ev(async (p) => {
    const m = window.__mc;
    const mod = await import('/src/vanilla/world/item/ItemStack.ts');
    m.survival.inventory.setSelectedItem(mod.ItemStack.EMPTY);
    const used = m.useJukebox(p);
    const chunk = m.level.getChunk(p.x >> 4, p.z >> 4);
    const rec = chunk?.getBlockEntity(p.x & 15, p.y, p.z & 15);
    return {
      used,
      hasRecord: m.mc.getProp(m.level.getBlockState(p.x, p.y, p.z), 'has_record'),
      record: rec ? rec.data.record : null,
      song: m.jukeboxSongs.get(`${p.x},${p.y},${p.z}`) ?? null,
    };
  }, inserted.pos);
  await waitTicks(page, 3);
  const afterPop = await ev((p) => {
    const m = window.__mc;
    return { output: m.redstone.comparatorOutputAt(p.x - 1, p.y, p.z) };
  }, inserted.pos);
  check('popping the restored disc clears the block entity and comparator',
    popped.used === true && popped.hasRecord === 'false' && popped.record === null
    && popped.song === null && afterPop.output === 0, { popped, afterPop });

  check('no page errors', errors.length === 0, errors.slice(0, 3));
} finally {
  const failed = results.filter((r) => !r.ok).length;
  console.log(`\n${results.length - failed}/${results.length} checks passed`);
  await browser.close();
  if (failed > 0) process.exitCode = 1;
}
