// Source: net.minecraft.world.food.FoodProperties (26.2)
//         net.minecraft.world.food.FoodConstants (saturationByModifier)
//         net.minecraft.world.item.component.Consumable
//
// items.json stores food as the string "nutrition:saturation" (saturation is the
// already-computed value, i.e. FoodConstants.saturationByModifier(nutrition, mod)).

export class FoodProperties {
  readonly nutrition: number;
  readonly saturation: number;
  readonly canAlwaysEat: boolean;

  constructor(nutrition: number, saturation: number, canAlwaysEat = false) {
    this.nutrition = nutrition;
    this.saturation = saturation;
    this.canAlwaysEat = canAlwaysEat;
  }

  /** FoodConstants.saturationByModifier(nutrition, modifier) = nutrition * modifier * 2. */
  static fromModifier(nutrition: number, saturationModifier: number, canAlwaysEat = false): FoodProperties {
    return new FoodProperties(nutrition, nutrition * saturationModifier * 2, canAlwaysEat);
  }

  /** Parse the items.json `food` field ("4:2.4"). */
  static parse(raw: string): FoodProperties | null {
    if (!raw) return null;
    const i = raw.indexOf(':');
    if (i < 0) return new FoodProperties(Number(raw) || 0, 0);
    const nutrition = Number(raw.slice(0, i)) || 0;
    const saturation = Number(raw.slice(i + 1)) || 0;
    return new FoodProperties(nutrition, saturation);
  }
}

/** Port of net.minecraft.world.food.Foods / FoodItem-style helpers. */
export class FoodItem {
  readonly properties: FoodProperties;

  constructor(properties: FoodProperties) {
    this.properties = properties;
  }

  get nutrition(): number { return this.properties.nutrition; }
  get saturation(): number { return this.properties.saturation; }
  get canAlwaysEat(): boolean { return this.properties.canAlwaysEat; }

  /** Vanilla FoodData.eat(FoodProperties): add(nutrition, saturation). */
  static nutritionOf(item: { food: FoodProperties | null }): number {
    return item.food ? item.food.nutrition : 0;
  }
}
