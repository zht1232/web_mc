// Sound event constants generated from the real 26.2 ogg directory
// (official-assets-mc/sounds/<event>/<variant>.ogg, 28 events / 112 files).
//
// 26.2 ships NO sounds.json, so the event list is derived from directory names
// (language independent). SoundEngine reads /mc/sounds/index.json which is the
// generated index of exactly these events.

import type { SoundCategory } from './SoundEngine.js';

/** All events that actually have ogg files in this resource pack. */
export const SoundEvents = {
  AMBIENT_UNDERWATER_ENTER: 'ambient.underwater.enter',
  AMBIENT_UNDERWATER_EXIT: 'ambient.underwater.exit',
  BLOCK_GLASS_BREAK: 'block.glass.break',
  BLOCK_GLASS_PLACE: 'block.glass.place',
  BLOCK_GLASS_STEP: 'block.glass.step',
  BLOCK_GRASS_BREAK: 'block.grass.break',
  BLOCK_GRASS_PLACE: 'block.grass.place',
  BLOCK_GRASS_STEP: 'block.grass.step',
  BLOCK_GRAVEL_BREAK: 'block.gravel.break',
  BLOCK_GRAVEL_PLACE: 'block.gravel.place',
  BLOCK_GRAVEL_STEP: 'block.gravel.step',
  BLOCK_SAND_BREAK: 'block.sand.break',
  BLOCK_SAND_PLACE: 'block.sand.place',
  BLOCK_SAND_STEP: 'block.sand.step',
  BLOCK_SNOW_BREAK: 'block.snow.break',
  BLOCK_SNOW_PLACE: 'block.snow.place',
  BLOCK_SNOW_STEP: 'block.snow.step',
  BLOCK_STONE_BREAK: 'block.stone.break',
  BLOCK_STONE_PLACE: 'block.stone.place',
  BLOCK_STONE_STEP: 'block.stone.step',
  BLOCK_WATER_AMBIENT: 'block.water.ambient',
  BLOCK_WOOD_BREAK: 'block.wood.break',
  BLOCK_WOOD_PLACE: 'block.wood.place',
  BLOCK_WOOD_STEP: 'block.wood.step',
  BLOCK_WOOL_BREAK: 'block.wool.break',
  BLOCK_WOOL_PLACE: 'block.wool.place',
  BLOCK_WOOL_STEP: 'block.wool.step',
  UI_BUTTON_CLICK: 'ui.button.click',
} as const;

export type SoundEventName = typeof SoundEvents[keyof typeof SoundEvents];

/** The 28 real event ids, in stable order. */
export const ALL_SOUND_EVENTS: readonly string[] = Object.values(SoundEvents);

/**
 * Common events named in the task / vanilla that have NO ogg in this resource
 * pack. They are mapped to the closest available sound so callers never crash.
 * These are approximations, not 1:1 vanilla assets (see the report).
 */
export const SOUND_ALIASES: Readonly<Record<string, string>> = {
  'block.stone.hit': SoundEvents.BLOCK_STONE_STEP,
  'block.stone.fall': SoundEvents.BLOCK_STONE_STEP,
  'block.generic.break': SoundEvents.BLOCK_STONE_BREAK,
  'block.generic.place': SoundEvents.BLOCK_STONE_PLACE,
  'block.generic.step': SoundEvents.BLOCK_STONE_STEP,
  'block.grass.hit': SoundEvents.BLOCK_GRASS_STEP,
  'block.wood.hit': SoundEvents.BLOCK_WOOD_STEP,
  'entity.player.step': SoundEvents.BLOCK_STONE_STEP,
  'entity.player.hurt': SoundEvents.BLOCK_WOOL_BREAK,
  'entity.item.pickup': SoundEvents.UI_BUTTON_CLICK,
  'entity.item.break': SoundEvents.BLOCK_GLASS_BREAK,
  'entity.zombie.ambient': SoundEvents.AMBIENT_UNDERWATER_ENTER,
  'entity.zombie.hurt': SoundEvents.BLOCK_WOOL_STEP,
  'entity.zombie.step': SoundEvents.BLOCK_STONE_STEP,
  'entity.lightning_bolt.thunder': SoundEvents.BLOCK_GRAVEL_BREAK,
  'entity.lightning_bolt.impact': SoundEvents.BLOCK_GLASS_BREAK,
  'ambient.cave': SoundEvents.AMBIENT_UNDERWATER_ENTER,
  'weather.rain': SoundEvents.BLOCK_WATER_AMBIENT,
  'weather.rain.above': SoundEvents.BLOCK_WATER_AMBIENT,
  'music.creative': SoundEvents.AMBIENT_UNDERWATER_ENTER,
  'music.game': SoundEvents.BLOCK_WATER_AMBIENT,
  'music.menu': SoundEvents.AMBIENT_UNDERWATER_EXIT,
  'music.nether': SoundEvents.AMBIENT_UNDERWATER_ENTER,
  'music.end': SoundEvents.AMBIENT_UNDERWATER_EXIT,
  'ui.toast.challenge_complete': SoundEvents.UI_BUTTON_CLICK,
};

/** Volume categories matching vanilla SoundSource. */
export const SOUND_CATEGORIES: readonly SoundCategory[] = [
  'master', 'music', 'record', 'weather', 'block',
  'hostile', 'neutral', 'player', 'ambient', 'voice',
];

/** Prefix-based category lookup (26.2 has no sounds.json category metadata). */
export function categoryOf(event: string): SoundCategory {
  if (event.startsWith('music.') || event === 'music.creative') return 'music';
  if (event.startsWith('record.')) return 'record';
  if (event.startsWith('weather.') || event.startsWith('entity.lightning')) return 'weather';
  if (event.startsWith('block.')) return 'block';
  if (event.startsWith('entity.player')) return 'player';
  if (event.startsWith('entity.')) {
    return /zombie|skeleton|creeper|spider|ender|witch|pillager|blaze|ghast|wither|dragon|phantom|drowned|husk|stray|vindicator|evoker|vex|guardian|shulker|slime|magma|hoglin|piglin/.test(event)
      ? 'hostile' : 'neutral';
  }
  if (event.startsWith('ambient.') || event.startsWith('environment.')) return 'ambient';
  if (event.startsWith('voice.')) return 'voice';
  return 'master';
}
