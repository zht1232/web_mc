// Source: net.minecraft.world.entity.EquipmentSlot
//
// The six humanoid slots plus the generic BODY slot used by animals. Each slot
// has a type (HAND / HUMANOID_ARMOR / ANIMAL_ARMOR) and an index used by the
// equipment array in LivingEntity.

export enum EquipmentSlotType { HAND, HUMANOID_ARMOR, ANIMAL_ARMOR }

export class EquipmentSlot {
  static readonly MAINHAND = new EquipmentSlot('mainhand', EquipmentSlotType.HAND, 0, 0, 'mainhand');
  static readonly OFFHAND = new EquipmentSlot('offhand', EquipmentSlotType.HAND, 1, 0, 'offhand');
  // armorIndex selects the equipment[] slot via 2 + armorIndex (feet=2 .. head=5).
  static readonly FEET = new EquipmentSlot('feet', EquipmentSlotType.HUMANOID_ARMOR, 0, 0, 'feet');
  static readonly LEGS = new EquipmentSlot('legs', EquipmentSlotType.HUMANOID_ARMOR, 1, 1, 'legs');
  static readonly CHEST = new EquipmentSlot('chest', EquipmentSlotType.HUMANOID_ARMOR, 2, 2, 'chest');
  static readonly HEAD = new EquipmentSlot('head', EquipmentSlotType.HUMANOID_ARMOR, 3, 3, 'head');
  static readonly BODY = new EquipmentSlot('body', EquipmentSlotType.ANIMAL_ARMOR, 0, 1, 'body');

  static readonly HUMAN_ARMOR_SLOTS: readonly EquipmentSlot[] = [
    EquipmentSlot.FEET, EquipmentSlot.LEGS, EquipmentSlot.CHEST, EquipmentSlot.HEAD,
  ];
  static readonly ARMOR_SLOTS: readonly EquipmentSlot[] = EquipmentSlot.HUMAN_ARMOR_SLOTS;
  static readonly ALL: readonly EquipmentSlot[] = [
    EquipmentSlot.MAINHAND, EquipmentSlot.OFFHAND,
    EquipmentSlot.FEET, EquipmentSlot.LEGS, EquipmentSlot.CHEST, EquipmentSlot.HEAD,
    EquipmentSlot.BODY,
  ];

  constructor(
    readonly name: string,
    readonly type: EquipmentSlotType,
    readonly index: number,
    readonly armorIndex: number,
    readonly serializedName: string,
  ) {}

  getType(): EquipmentSlotType { return this.type; }
  getIndex(): number { return this.index; }
  isArmor(): boolean { return this.type !== EquipmentSlotType.HAND; }

  static byName(name: string): EquipmentSlot {
    return EquipmentSlot.ALL.find(s => s.name === name) ?? EquipmentSlot.MAINHAND;
  }

  toString(): string { return this.name; }
}
