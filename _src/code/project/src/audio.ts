import type { SoundRec } from './types.js';
import { clamp } from './math.js';

export class GameAudio {
  private ctx: AudioContext | null = null;
  private master: GainNode | null = null;
  private buffers = new Map<string, AudioBuffer>();
  private pending = new Map<string, Promise<AudioBuffer | null>>();
  private events: Record<string, SoundRec[]>;
  private failed = new Set<string>();
  private volume = 0.8;

  constructor(events: Record<string, SoundRec[]>) {
    this.events = events;
  }

  setVolume(percent: number): void {
    this.volume = clamp(percent / 100, 0, 1);
    if (this.master) this.master.gain.value = this.volume;
  }

  async init(): Promise<void> {
    if (!this.ctx) {
      this.ctx = new AudioContext();
      this.master = this.ctx.createGain();
      this.master.gain.value = this.volume;
      this.master.connect(this.ctx.destination);
    }
    if (this.ctx.state === 'suspended') {
      try { await this.ctx.resume(); } catch { /* ignore */ }
    }
    // Warm the most common events while the first frames are still cheap.
    const warm = ['block.grass.step', 'block.stone.step', 'block.wood.step', 'block.grass.break', 'block.stone.break',
      'block.wood.break', 'block.grass.place', 'block.stone.place', 'block.wood.place', 'ui.button.click'];
    for (const event of warm) void this.preloadEvent(event);
  }

  private async load(rec: SoundRec): Promise<AudioBuffer | null> {
    if (!this.ctx) return null;
    const cached = this.buffers.get(rec.path);
    if (cached) return cached;
    let p = this.pending.get(rec.path);
    if (!p) {
      p = (async () => {
        try {
          const res = await fetch(rec.path);
          if (!res.ok) throw new Error('sound fetch ' + res.status);
          const data = await res.arrayBuffer();
          const buf = await this.ctx!.decodeAudioData(data);
          this.buffers.set(rec.path, buf);
          return buf;
        } catch (err) {
          this.failed.add(rec.path);
          console.warn('sound load failed', rec.path, err);
          return null;
        } finally {
          this.pending.delete(rec.path);
        }
      })();
      this.pending.set(rec.path, p);
    }
    return p;
  }

  async preloadEvent(event: string): Promise<void> {
    if (!this.ctx) return;
    const list = this.events[event];
    if (!list) return;
    await Promise.all(list.map(rec => this.load(rec)));
  }

  play(event: string, volume = 1, pitch = 1): void {
    if (!this.ctx || !this.master) return;
    if (this.ctx.state !== 'running') { void this.ctx.resume(); }
    const list = this.events[event];
    if (!list || !list.length) return;
    let total = 0;
    for (const rec of list) total += Math.max(0.01, rec.weight);
    let r = Math.random() * total;
    let rec = list[0];
    for (const item of list) {
      r -= Math.max(0.01, item.weight);
      if (r <= 0) { rec = item; break; }
    }
    const cached = this.buffers.get(rec.path);
    if (cached) { this.start(cached, rec, volume, pitch); return; }
    if (this.failed.has(rec.path)) return;
    void this.load(rec).then(buf => { if (buf) this.start(buf, rec, volume, pitch); });
  }

  private start(buffer: AudioBuffer, rec: SoundRec, volume: number, pitch: number): void {
    if (!this.ctx || !this.master) return;
    const source = this.ctx.createBufferSource();
    source.buffer = buffer;
    const jitter = 0.94 + Math.random() * 0.12;
    source.playbackRate.value = clamp(pitch * rec.pitch * jitter, 0.5, 2);
    const gain = this.ctx.createGain();
    gain.gain.value = clamp(volume * rec.volume, 0, 1);
    source.connect(gain);
    gain.connect(this.master);
    source.start();
  }

  stopAll(): void {
    if (!this.ctx) return;
    void this.ctx.close();
    this.ctx = null;
    this.master = null;
    this.buffers.clear();
    this.pending.clear();
  }
}
