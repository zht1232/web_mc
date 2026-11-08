// Port contract for net.minecraft.client.gui.screens.worldselection.WorldSelectionList /
// LevelStorageSource. The real IndexedDB-backed implementation is supplied by
// another agent through ScreenDeps.worlds; this file only defines the interface
// (re-exported) and a tiny in-memory fallback used when no provider is injected.
//
// Pure module: no DOM, no IndexedDB at import time.

import type { WorldListProvider, WorldSummary, CreateWorldOptions } from './Types.js';

export type { WorldListProvider, WorldSummary, CreateWorldOptions };

/**
 * Fallback provider. Persists nothing; lets SelectWorldScreen / CreateWorldScreen
 * be exercised standalone before the IndexedDB agent is wired in.
 */
export class MemoryWorldListProvider implements WorldListProvider {
  private readonly worlds: WorldSummary[] = [];

  async list(): Promise<WorldSummary[]> {
    return this.worlds.slice().sort((a, b) => (b.lastPlayed ?? 0) - (a.lastPlayed ?? 0));
  }

  async create(options: CreateWorldOptions): Promise<WorldSummary> {
    const summary: WorldSummary = {
      id: `world-${Date.now().toString(36)}-${Math.floor(Math.random() * 1e6).toString(36)}`,
      name: options.name || 'New World',
      seed: options.seed,
      gameMode: options.gameMode,
      difficulty: options.difficulty,
      lastPlayed: Date.now(),
      version: '26.2',
      hardcore: false,
    };
    this.worlds.push(summary);
    return summary;
  }

  async delete(id: string): Promise<void> {
    const i = this.worlds.findIndex((w) => w.id === id);
    if (i >= 0) this.worlds.splice(i, 1);
  }

  async load(id: string): Promise<void> {
    const w = this.worlds.find((x) => x.id === id);
    if (w) w.lastPlayed = Date.now();
  }

  /** In-memory fallback cannot produce a portable archive. */
  async exportWorld(_id: string): Promise<Uint8Array> {
    throw new Error('no persistence');
  }

  async importWorld(_data: ArrayBuffer): Promise<string> {
    throw new Error('no persistence');
  }
}
