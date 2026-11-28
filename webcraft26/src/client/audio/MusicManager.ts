// Port of net.minecraft.client.sounds.MusicManager: random-interval background
// music with situation-dependent track selection and a starting delay of 100
// ticks. The launcher asset set now ships the music/*.ogg files and
// public/mc/sounds/index.json exposes music.game / music.creative / music.menu ...,
// so tracks resolve directly; setTracks() can still override a situation.

import { XoroshiroRandomSource } from '../../vanilla/core/Random.js';
import type { SoundEngine, SoundLevel } from './SoundEngine.js';

export type MusicSituation = 'day' | 'night' | 'nether' | 'end' | 'creative' | 'menu' | 'underwater';

/** Vanilla music event ids (imported from the launcher assets by scripts/build-sounds.mjs). */
export const DEFAULT_MUSIC_TRACKS: Record<MusicSituation, readonly string[]> = {
  day: ['music.game', 'music.creative'],
  night: ['music.game', 'music.creative'],
  nether: ['music.nether.nether_wastes', 'music.nether.crimson_forest', 'music.nether.soul_sand_valley', 'music.nether.basalt_deltas'],
  end: ['music.end'],
  creative: ['music.creative'],
  menu: ['music.menu'],
  underwater: ['music.game'],
};

const STARTING_DELAY = 100;          // vanilla MusicManager.STARTING_DELAY
const DEFAULT_MIN_DELAY = 6000;      // ~5 min at 20 tps
const DEFAULT_MAX_MINUTES = 20;      // vanilla MusicFrequency.DEFAULT

function detectSituation(level?: SoundLevel): MusicSituation {
  if (!level) return 'menu';
  if (level.underwater) return 'underwater';
  if (level.creative) return 'creative';
  const d = level.dimension;
  if (d === 'the_nether' || d === 'nether') return 'nether';
  if (d === 'the_end' || d === 'end') return 'end';
  let day = true;
  if (typeof level.isDay === 'function') day = level.isDay();
  else if (typeof level.getTimeOfDay === 'function') day = level.getTimeOfDay() < 0.5;
  return day ? 'day' : 'night';
}

export class MusicManager {
  private readonly rand = new XoroshiroRandomSource(0x4d55531an);
  private nextSongDelay = STARTING_DELAY;
  private current: string | null = null;

  situation: MusicSituation = 'day';
  /** Playback volume for music instances. */
  volume = 0.35;
  /** Minutes between songs (vanilla MusicFrequency.DEFAULT = 20). */
  minutesBetweenSongs = DEFAULT_MAX_MINUTES;
  readonly tracks: Record<MusicSituation, string[]>;

  constructor(private readonly engine: SoundEngine) {
    this.tracks = {} as Record<MusicSituation, string[]>;
    for (const k of Object.keys(DEFAULT_MUSIC_TRACKS) as MusicSituation[]) {
      this.tracks[k] = [...DEFAULT_MUSIC_TRACKS[k]];
    }
  }

  private get maxDelayTicks(): number { return this.minutesBetweenSongs * 1200; }

  /** Replaces (or adds) the track list for a situation. */
  setTracks(situation: MusicSituation, names: readonly string[]): void {
    this.tracks[situation] = [...names];
  }

  private pickTrack(): string | null {
    const list = this.tracks[this.situation] ?? [];
    const available = list.filter((t) => this.engine.hasEvent(t));
    if (!available.length) return null;
    return available[this.rand.nextInt(available.length)];
  }

  /** Mirrors MusicManager.tick(): decrements the delay, starts a song at 0. */
  tick(level?: SoundLevel): void {
    this.situation = detectSituation(level);
    const musicVolume = this.engine.getVolume('music');
    if (musicVolume <= 0) {
      this.nextSongDelay = Math.max(this.nextSongDelay, STARTING_DELAY);
      return;
    }
    const track = this.pickTrack();
    if (!track) {
      // No playable track (missing music assets): keep waiting, retry later.
      this.nextSongDelay = Math.max(this.nextSongDelay, STARTING_DELAY);
      return;
    }
    this.nextSongDelay = Math.min(this.nextSongDelay, this.maxDelayTicks);
    if (--this.nextSongDelay <= 0) this.startPlaying(track);
  }

  private startPlaying(track: string): void {
    this.current = track;
    // Non-positional: omit x/y/z so no PannerNode is created.
    this.engine.play(track, undefined, undefined, undefined, this.volume);
    const min = Math.min(DEFAULT_MIN_DELAY, this.maxDelayTicks);
    const span = Math.max(1, this.maxDelayTicks - min);
    this.nextSongDelay = min + this.rand.nextInt(span);
  }

  stopPlaying(): void {
    this.current = null;
    this.nextSongDelay = STARTING_DELAY;
  }

  get currentTrack(): string | null { return this.current; }
}
