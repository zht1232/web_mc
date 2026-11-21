// Source: net.minecraft.world.entity.animal.Sheep

import { Animal } from './Animal.js';
import { entityType } from '../EntityType.js';
import type { RandomSource } from '../../../core/Random.js';
import type { ClientLevel } from '../../level/ClientLevel.js';

/**
 * DyeColor.getTextureDiffuseColors(), indexed by Sheep.DATA_WOOL_ID (0..15).
 * The renderer multiplies the white sheep_wool texture by this colour.
 */
export const SHEEP_WOOL_RGB: readonly (readonly [number, number, number])[] = [
  [0.9764706, 1.0, 0.99607843],        // 0 white (0xF9FFFE)
  [0.9764706, 0.5019608, 0.11372549],  // 1 orange (0xF9801D)
  [0.78039217, 0.30588236, 0.7411765], // 2 magenta (0xC74EBD)
  [0.22745098, 0.7019608, 0.85490197], // 3 light_blue (0x3AB3DA)
  [0.99607843, 0.84705883, 0.23921569], // 4 yellow (0xFED83D)
  [0.5019608, 0.78039217, 0.12156863], // 5 lime (0x80C71F)
  [0.9529412, 0.54509807, 0.6666667],  // 6 pink (0xF38BAA)
  [0.2784314, 0.30980393, 0.32156864], // 7 gray (0x474F52)
  [0.6156863, 0.6156863, 0.5921569],   // 8 light_gray (0x9D9D97)
  [0.08627451, 0.6117647, 0.6117647],  // 9 cyan (0x169C9C)
  [0.5372549, 0.19607843, 0.72156864], // 10 purple (0x8932B8)
  [0.23529412, 0.26666668, 0.6666667], // 11 blue (0x3C44AA)
  [0.5137255, 0.32941177, 0.19607843], // 12 brown (0x835432)
  [0.36862746, 0.4862745, 0.08627451], // 13 green (0x5E7C16)
  [0.6901961, 0.18039216, 0.14901961], // 14 red (0xB02E26)
  [0.11372549, 0.11372549, 0.12941177], // 15 black (0x1D1D21)
];

/** DyeColor.getName() in the same order as woolColor / SHEEP_WOOL_RGB. */
const WOOL_ITEM_NAMES = [
  'white_wool', 'orange_wool', 'magenta_wool', 'light_blue_wool',
  'yellow_wool', 'lime_wool', 'pink_wool', 'gray_wool',
  'light_gray_wool', 'cyan_wool', 'purple_wool', 'blue_wool',
  'brown_wool', 'green_wool', 'red_wool', 'black_wool',
] as const;

/** Source: Sheep.getColor() -> DyeColor, used by ShearsItem's drop. */
export function woolItemName(color: number): string {
  return WOOL_ITEM_NAMES[color] ?? WOOL_ITEM_NAMES[0];
}

/** Source: Sheep.getRandomSheepColor (natural spawn distribution). */
function randomWoolColor(random: RandomSource): number {
  const i = random.nextInt(100);
  if (i < 5) return 15;  // black
  if (i < 10) return 7;  // gray
  if (i < 15) return 8;  // light gray
  if (i < 18) return 12; // brown
  return random.nextInt(500) === 0 ? 6 : 0; // rare pink, otherwise white
}

export class Sheep extends Animal {
  /** wool colour index, exposed for the renderer */
  woolColor = 0;
  sheared = false;

  constructor(level: ClientLevel) {
    super(entityType('sheep'), level);
    this.speed = 0.23;
    this.maxHealth = 8; this.health = 8;
  }

  /** Source: Sheep.finalizeSpawn -> getRandomSheepColor(random). */
  override finalizeSpawn(): void {
    super.finalizeSpawn();
    this.woolColor = randomWoolColor(this.random);
  }

  /** Source: Sheep.getColor(). */
  get woolItem(): string { return woolItemName(this.woolColor); }

  /** ItemTags.SHEEP_FOOD. */
  protected getTemptingItems(): readonly string[] { return ['wheat']; }
}
