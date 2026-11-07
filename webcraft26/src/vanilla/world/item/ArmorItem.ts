// Source: net.minecraft.world.item.equipment.ArmorMaterial / ArmorMaterials (26.2)
//         net.minecraft.world.entity.LivingEntity#doHurtEquipment / Player#hurtArmor
//
// 26.2 no longer has an ArmorItem class: armor is an Equippable component whose
// attributes come from an ArmorMaterial. The material table below is a direct
// transcription of ArmorMaterials.makeDefense(boots, legs, chest, helm, body).

export type ArmorType = 'HELMET' | 'CHESTPLATE' | 'LEGGINGS' | 'BOOTS' | 'BODY';

export interface ArmorMaterial {
  readonly name: string;
  readonly durability: number;
  readonly defense: Readonly<Record<ArmorType, number>>;
  readonly enchantmentValue: number;
  readonly toughness: number;
  readonly knockbackResistance: number;
}

function material(
  name: string, durability: number,
  boots: number, legs: number, chest: number, helm: number, body: number,
  enchantmentValue: number, toughness: number, knockbackResistance: number,
): ArmorMaterial {
  return {
    name, durability, enchantmentValue, toughness, knockbackResistance,
    defense: { BOOTS: boots, LEGGINGS: legs, CHESTPLATE: chest, HELMET: helm, BODY: body },
  };
}

/** ArmorMaterials (26.2), defense order boots/legs/chest/helm/body. */
export const ARMOR_MATERIALS: Readonly<Record<string, ArmorMaterial>> = {
  leather: material('leather', 5, 1, 2, 3, 1, 3, 15, 0, 0),
  copper: material('copper', 11, 1, 3, 4, 2, 4, 8, 0, 0),
  chainmail: material('chainmail', 15, 1, 4, 5, 2, 4, 12, 0, 0),
  iron: material('iron', 15, 2, 5, 6, 2, 5, 9, 0, 0),
  gold: material('gold', 7, 1, 3, 5, 2, 7, 25, 0, 0),
  diamond: material('diamond', 33, 3, 6, 8, 3, 11, 10, 2, 0),
  turtle: material('turtle', 25, 2, 5, 6, 2, 5, 9, 0, 0),
  netherite: material('netherite', 37, 3, 6, 8, 3, 19, 15, 3, 0.1),
  armadillo: material('armadillo', 4, 3, 6, 8, 3, 11, 10, 0, 0),
};

/** Vanilla durability per armor slot (ArmorMaterial.durability * this). */
export const ARMOR_SLOT_DURABILITY: Readonly<Record<ArmorType, number>> = {
  HELMET: 11, CHESTPLATE: 16, LEGGINGS: 15, BOOTS: 13, BODY: 16,
};

function armorTypeFromEquip(equip: string): ArmorType | null {
  switch (equip) {
    case 'HEAD': return 'HELMET';
    case 'CHEST': return 'CHESTPLATE';
    case 'LEGS': return 'LEGGINGS';
    case 'FEET': return 'BOOTS';
    case 'BODY': return 'BODY';
    default: return null;
  }
}

function materialFromName(name: string): ArmorMaterial | null {
  for (const key of Object.keys(ARMOR_MATERIALS)) {
    if (name.startsWith(`${key}_`) || name === key) return ARMOR_MATERIALS[key];
  }
  if (name.startsWith('golden_')) return ARMOR_MATERIALS.gold;
  if (name.startsWith('turtle_')) return ARMOR_MATERIALS.turtle;
  if (name.startsWith('armadillo_') || name.startsWith('wolf_')) return ARMOR_MATERIALS.armadillo;
  return null;
}

/** Armor definition attached to an Item. */
export class ArmorItem {
  readonly material: ArmorMaterial;
  readonly type: ArmorType;
  readonly equip: string;

  constructor(name: string, equip: string) {
    this.equip = equip;
    this.type = armorTypeFromEquip(equip) ?? 'BODY';
    this.material = materialFromName(name) ?? ARMOR_MATERIALS.leather;
  }

  get defense(): number { return this.material.defense[this.type]; }
  get toughness(): number { return this.material.toughness; }
  get knockbackResistance(): number { return this.material.knockbackResistance; }
  get durability(): number { return this.material.durability * ARMOR_SLOT_DURABILITY[this.type]; }
  get enchantmentValue(): number { return this.material.enchantmentValue; }
}

/** Build an ArmorItem for a humanoid armor piece, or null for other equipment. */
export function createArmor(name: string, equip: string): ArmorItem | null {
  const type = armorTypeFromEquip(equip);
  if (type === null || equip === 'BODY' || equip === 'SADDLE' || equip === 'OFFHAND' || equip === '') return null;
  return new ArmorItem(name, equip);
}
