// Browser probe for music/record wiring (Batch 2):
//   * the launcher asset set exposes the real music + music_disc events;
//   * JukeboxBlock.useItemOn inserts a disc (has_record=true, disc consumed, record event at
//     volume 4) and popping it back with an empty hand restores has_record=false and drops it.
//
//   node scripts/test-jukebox.mjs [--url http://127.0.0.1:5174]
import { chromium } from 'playwright';
import { launchOptions } from './lib/browser.mjs';
import { prepareStage, waitTicks } from './lib/stage.mjs';

const args = process.argv.slice(2);
const urlArg = args.indexOf('--url');
const base = urlArg >= 0 ? args[urlArg + 1] : 'http://127.0.0.1:5174';

const browser = await chromium.launch(launchOptions());
const page = await (await browser.newContext({ viewport: { width: 1000, height: 700 } })).newPage();
const errors = [];
page.on('pageerror', (e) => errors.push(String(e).slice(0, 300)));
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const ev = (fn, arg) => page.evaluate(fn, arg);
const results = [];
const check = (name, ok, detail) => {
  results.push({ name, ok });
  console.log(`${ok ? 'PASS' : 'FAIL'} ${name}${detail === undefined ? '' : ' :: ' + JSON.stringify(detail)}`);
};

try {
  await page.goto(`${base}/?play&perf=0`, { waitUntil: 'domcontentloaded', timeout: 120000 });
  await page.waitForFunction(() => window.__mc?.running === true, null, { timeout: 120000 });
  await page.waitForFunction(() => window.__mc?.sounds?.isReady === true, null, { timeout: 60000 });
  await sleep(800);
  const stage = await prepareStage(page, { radius: 6, floor: 'stone' });

  const events = await ev(() => {
    const s = window.__mc.sounds;
    return {
      musicGame: s.hasEvent('music.game'),
      menu: s.hasEvent('music.menu'),
      discCat: s.hasEvent('music_disc.cat'),
      disc13: s.hasEvent('music_disc.13'),
      tracks: window.__mc.sounds.music.tracks.day,
    };
  });
  check('real music and record events are present in the sound index',
    events.musicGame && events.menu && events.discCat && events.disc13
    && events.tracks.includes('music.game'), events);

  const insert = await ev(async (s) => {
    const m = window.__mc;
    m.options.gamemode = 'survival';
    const x = s.x + 2, y = s.floorY, z = s.z;
    m.level.setBlockState(x, y, z, m.mc.stateOf('jukebox'));
    const mod = await import('/src/vanilla/world/item/ItemStack.ts');
    const disc = new mod.ItemStack(m.survival.registry.byName('music_disc_cat'), 1);
    m.survival.inventory.setSelectedItem(disc);
    const before = m.sounds.stats['music_disc.cat'] ?? 0;
    const used = m.useJukebox({ x, y, z });
    const state = m.level.getBlockState(x, y, z);
    return {
      used,
      hasRecord: m.mc.getProp(state, 'has_record'),
      statDelta: (m.sounds.stats['music_disc.cat'] ?? 0) - before,
      held: m.survival.getSelectedStack().getCount(),
      handle: !!m.recordHandle,
      song: m.jukeboxSongs.get(`${x},${y},${z}`),
    };
  }, stage);
  check('inserting a disc starts playback and consumes the item',
    insert.used === true && insert.hasRecord === 'true' && insert.statDelta === 1
    && insert.held === 0 && insert.handle === true && insert.song === 'cat', insert);

  const eject = await ev(async (s) => {
    const m = window.__mc;
    const x = s.x + 2, y = s.floorY, z = s.z;
    const mod = await import('/src/vanilla/world/item/ItemStack.ts');
    m.survival.inventory.setSelectedItem(mod.ItemStack.EMPTY);
    const used = m.useJukebox({ x, y, z });
    const state = m.level.getBlockState(x, y, z);
    return {
      used,
      hasRecord: m.mc.getProp(state, 'has_record'),
      handle: m.recordHandle === null,
      song: m.jukeboxSongs.get(`${x},${y},${z}`) ?? null,
    };
  }, stage);
  await waitTicks(page, 1);
  const dropped = await ev(async () => {
    const m = window.__mc;
    const item = m.entityManager.getEntities().find((e) => e.getTypeName() === 'item');
    return item ? { name: item.getItem().item?.name ?? '', count: item.getItem().getCount() } : null;
  });
  check('popping the record restores has_record=false and drops the disc',
    eject.used === true && eject.hasRecord === 'false' && eject.handle === true
    && eject.song === null && dropped?.name === 'music_disc_cat', { eject, dropped });

  check('no page errors', errors.length === 0, errors.slice(0, 2));
} finally {
  const failed = results.filter((r) => !r.ok).length;
  console.log(`\n${results.length - failed}/${results.length} checks passed`);
  await browser.close();
  if (failed > 0) process.exitCode = 1;
}
