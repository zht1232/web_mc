// Source: net.minecraft.world.inventory.MenuType (26.2)
//
// Registry of menu kinds. The Java class also carries a MenuSupplier, but in this
// port the menus are constructed directly by SurvivalState / the GUI; what the
// screens need here is a stable type id and the grid dimensions.

export const MenuType = {
  INVENTORY: 'minecraft:inventory',
  CRAFTING: 'minecraft:crafting',
  FURNACE: 'minecraft:furnace',
  BLAST_FURNACE: 'minecraft:blast_furnace',
  SMOKER: 'minecraft:smoker',
  GENERIC_9x1: 'minecraft:generic_9x1',
  GENERIC_9x2: 'minecraft:generic_9x2',
  GENERIC_9x3: 'minecraft:generic_9x3',
  GENERIC_9x4: 'minecraft:generic_9x4',
  GENERIC_9x5: 'minecraft:generic_9x5',
  GENERIC_9x6: 'minecraft:generic_9x6',
  CREATIVE: 'minecraft:creative',
  STONECUTTER: 'minecraft:stonecutter',
  SMITHING: 'minecraft:smithing',
} as const;
export type MenuType = typeof MenuType[keyof typeof MenuType];

export interface MenuLayout {
  readonly type: MenuType;
  /** Number of container-side slots before the player inventory (result included). */
  readonly containerSlots: number;
  readonly rows: number;
  readonly cols: number;
}

export function chestMenuType(rows: number): MenuType {
  switch (rows) {
    case 1: return MenuType.GENERIC_9x1;
    case 2: return MenuType.GENERIC_9x2;
    case 3: return MenuType.GENERIC_9x3;
    case 4: return MenuType.GENERIC_9x4;
    case 5: return MenuType.GENERIC_9x5;
    default: return MenuType.GENERIC_9x6;
  }
}

export function chestRows(type: MenuType): number {
  switch (type) {
    case MenuType.GENERIC_9x1: return 1;
    case MenuType.GENERIC_9x2: return 2;
    case MenuType.GENERIC_9x3: return 3;
    case MenuType.GENERIC_9x4: return 4;
    case MenuType.GENERIC_9x5: return 5;
    case MenuType.GENERIC_9x6: return 6;
    default: return 3;
  }
}
