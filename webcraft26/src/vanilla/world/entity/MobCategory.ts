// Source: net.minecraft.world.entity.MobCategory
//
// Spawn categories. The numeric ids match the strings used in entities.json /
// worldgen.json (`biomes[].spawners` keys). Vanilla caps the number of mobs of
// each category that may be loaded per chunk and defines despawn distances.

export class MobCategory {
  static readonly MONSTER = new MobCategory('MONSTER', 'monster', 70, false, false, 128);
  static readonly CREATURE = new MobCategory('CREATURE', 'creature', 10, true, true, 128);
  static readonly AMBIENT = new MobCategory('AMBIENT', 'ambient', 15, true, false, 128);
  static readonly AXOLOTLS = new MobCategory('AXOLOTLS', 'axolotls', 5, true, true, 128);
  static readonly WATER_CREATURE = new MobCategory('WATER_CREATURE', 'water_creature', 5, true, false, 128);
  static readonly WATER_AMBIENT = new MobCategory('WATER_AMBIENT', 'water_ambient', 20, true, false, 64);
  static readonly UNDERGROUND_WATER_CREATURE = new MobCategory('UNDERGROUND_WATER_CREATURE', 'underground_water_creature', 5, true, false, 128);
  static readonly MISC = new MobCategory('MISC', 'misc', -1, true, true, 128);

  static readonly ALL: readonly MobCategory[] = [
    MobCategory.MONSTER, MobCategory.CREATURE, MobCategory.AMBIENT, MobCategory.AXOLOTLS,
    MobCategory.WATER_CREATURE, MobCategory.WATER_AMBIENT, MobCategory.UNDERGROUND_WATER_CREATURE,
    MobCategory.MISC,
  ];

  private static readonly BY_NAME = new Map<string, MobCategory>(
    MobCategory.ALL.map(c => [c.name, c]),
  );
  private static readonly BY_SPAWNER = new Map<string, MobCategory>(
    MobCategory.ALL.map(c => [c.spawnerKey, c]),
  );

  constructor(
    readonly name: string,
    readonly spawnerKey: string,
    readonly maxInstancesPerChunk: number,
    readonly friendly: boolean,
    readonly persistent: boolean,
    readonly despawnDistance: number,
  ) {}

  static byName(name: string): MobCategory {
    return MobCategory.BY_NAME.get(name) ?? MobCategory.MISC;
  }

  /** Resolves a `biomes[].spawners` key (e.g. "monster") to a category. */
  static bySpawnerKey(key: string): MobCategory | undefined {
    return MobCategory.BY_SPAWNER.get(key);
  }

  isFriendly(): boolean { return this.friendly; }
  isPersistent(): boolean { return this.persistent; }
  getDespawnDistance(): number { return this.despawnDistance; }
  getMaxInstancesPerChunk(): number { return this.maxInstancesPerChunk; }

  toString(): string { return this.name; }
}
