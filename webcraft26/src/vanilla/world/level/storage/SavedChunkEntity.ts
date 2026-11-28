// A compact entity record stored in a chunk's `Entities` NBT list.
//
// Vanilla writes each entity's full NBT under `Entities` and reloads them with
// the chunk. This port keeps the same list/key but stores a small schema: the
// common transform + health, plus a type-specific `data` record (item stack,
// vehicle slots, sheep wool, age). Villagers and tamed pets stay in the world
// record because their serializers already cover professions/offers/ownership.

export interface SavedChunkEntity {
  /** Vanilla entity type name, e.g. "cow", "oak_chest_boat", "item". */
  type: string;
  x: number;
  y: number;
  z: number;
  yaw: number;
  pitch: number;
  vx: number;
  vy: number;
  vz: number;
  /** Mob health (LivingEntity.getHealth). */
  health?: number;
  /** Type-specific payload (ItemEntity stack, vehicle slots, sheep wool, age...). */
  data?: Record<string, unknown>;
}
