// Pure layout port of net.minecraft.client.gui.screens.TitleScreen#init and
// #createNormalMenuOptions (26.2 decompiled source). No DOM: safe for Node tests.
//
// Java literals transcribed verbatim:
//   int spacing = 24;
//   int topPos = this.height / 4 + 48;
//   singleplayer .bounds(this.width / 2 - 100, topPos, 200, 20)
//   multiplayer  .bounds(this.width / 2 - 100, topPos + spacing, 200, 20)
//   online       .bounds(this.width / 2 - 100, topPos + spacing * 2, 200, 20)
//   topPos += 24;  // icon row (friends / language / accessibility)
//   getHorizontalPosition(i, 3, 20): totalWidth = 3*20 + (3-1)*4 = 68
//   topPos += 24;  // options / quit row
//   options  .bounds(this.width / 2 - 100, topPos, 98, 20)
//   quit     .bounds(this.width / 2 + 2,   topPos, 98, 20)
//   copyright PlainTextButton(copyrightX = width - copyrightWidth - 2, height - 10, copyrightWidth, 10)

import type { Rect } from '../Types.js';
import {
  TITLE_TOP_OFFSET,
  TITLE_SPACING,
  TITLE_BIG_BUTTON_WIDTH,
  TITLE_BIG_BUTTON_HEIGHT,
  TITLE_HALF_BUTTON_WIDTH,
  TITLE_ICON_BUTTON_SIZE,
  TITLE_ICON_BUTTON_COUNT,
  TITLE_ICON_BUTTON_GAP,
  LOGO_WIDTH,
  LOGO_HEIGHT,
  LOGO_DEFAULT_HEIGHT_OFFSET,
  EDITION_WIDTH,
  EDITION_HEIGHT,
  EDITION_LOGO_OVERLAP,
} from '../GuiConstants.js';

/** The literal Java constants, exported so the test can assert against the source. */
export const JAVA_TITLE_CONSTANTS = {
  SPACING: 24,
  TOP_OFFSET: 48,
  TOP_DIVISOR: 4,
  BIG_BUTTON_WIDTH: 200,
  BIG_BUTTON_HEIGHT: 20,
  BIG_BUTTON_X_OFFSET: 100, // width / 2 - 100
  HALF_BUTTON_WIDTH: 98,
  QUIT_X_OFFSET: 2, // width / 2 + 2
  ICON_BUTTON_COUNT: 3,
  ICON_BUTTON_SIZE: 20,
  ICON_BUTTON_GAP: 4,
  COPYRIGHT_Y_FROM_BOTTOM: 10,
} as const;

function rect(x: number, y: number, width: number, height: number): Rect {
  return { x, y, width, height };
}

/** Java int division (truncation toward zero; all inputs here are non-negative). */
function half(n: number): number {
  return Math.floor(n / 2);
}

/** Mirrors TitleScreen#getHorizontalPosition(currentButton, numberOfButtons, buttonWidth). */
export function getHorizontalPosition(
  width: number,
  currentButton: number,
  numberOfButtons: number,
  buttonWidth: number,
): number {
  const totalWidth = numberOfButtons * buttonWidth + (numberOfButtons - 1) * TITLE_ICON_BUTTON_GAP;
  return half(width) - half(totalWidth) + (currentButton - 1) * (buttonWidth + TITLE_ICON_BUTTON_GAP);
}

export interface TitleLayout {
  /** height / 4 + 48 */
  firstRowY: number;
  singleplayer: Rect;
  multiplayer: Rect;
  online: Rect;
  /** three 20x20 icon buttons */
  iconButtons: Rect[];
  options: Rect;
  quit: Rect;
  copyright: Rect;
  /** LogoRenderer: logoX = width / 2 - 128, y = 30, 256x44 */
  logo: Rect;
  /** edition badge: width / 2 - 64, y = 30 + 44 - 7, 128x14 */
  edition: Rect;
  /** splash text anchor (SplashRenderer uses width / 2 + 90, height / 4 + 48 - 6) */
  splashX: number;
  splashY: number;
  versionX: number;
  versionY: number;
}

/**
 * @param copyrightWidth font.width("title.credits") in GUI pixels; defaults to 0
 *   (the real screen measures it with FontRenderer before calling this).
 */
export function computeTitleScreenLayout(width: number, height: number, copyrightWidth = 0): TitleLayout {
  const firstRowY = Math.floor(height / JAVA_TITLE_CONSTANTS.TOP_DIVISOR) + TITLE_TOP_OFFSET;
  const bigX = half(width) - JAVA_TITLE_CONSTANTS.BIG_BUTTON_X_OFFSET;

  const singleplayer = rect(bigX, firstRowY, TITLE_BIG_BUTTON_WIDTH, TITLE_BIG_BUTTON_HEIGHT);
  const multiplayer = rect(bigX, firstRowY + TITLE_SPACING, TITLE_BIG_BUTTON_WIDTH, TITLE_BIG_BUTTON_HEIGHT);
  const online = rect(bigX, firstRowY + TITLE_SPACING * 2, TITLE_BIG_BUTTON_WIDTH, TITLE_BIG_BUTTON_HEIGHT);

  // createNormalMenuOptions returns firstRowY + 2*spacing; init() then does topPos += 24.
  const iconRowY = firstRowY + TITLE_SPACING * 2 + TITLE_SPACING;
  const iconButtons: Rect[] = [];
  for (let i = 1; i <= TITLE_ICON_BUTTON_COUNT; i++) {
    iconButtons.push(
      rect(getHorizontalPosition(width, i, TITLE_ICON_BUTTON_COUNT, TITLE_ICON_BUTTON_SIZE),
        iconRowY, TITLE_ICON_BUTTON_SIZE, TITLE_ICON_BUTTON_SIZE),
    );
  }

  const bottomRowY = iconRowY + TITLE_SPACING;
  const options = rect(bigX, bottomRowY, TITLE_HALF_BUTTON_WIDTH, TITLE_BIG_BUTTON_HEIGHT);
  const quit = rect(half(width) + JAVA_TITLE_CONSTANTS.QUIT_X_OFFSET, bottomRowY,
    TITLE_HALF_BUTTON_WIDTH, TITLE_BIG_BUTTON_HEIGHT);

  const copyright = rect(width - copyrightWidth - 2, height - 10, copyrightWidth, 10);

  const logo = rect(half(width) - half(LOGO_WIDTH), LOGO_DEFAULT_HEIGHT_OFFSET, LOGO_WIDTH, LOGO_HEIGHT);
  const edition = rect(
    half(width) - half(EDITION_WIDTH),
    LOGO_DEFAULT_HEIGHT_OFFSET + LOGO_HEIGHT - EDITION_LOGO_OVERLAP,
    EDITION_WIDTH,
    EDITION_HEIGHT,
  );

  return {
    firstRowY,
    singleplayer,
    multiplayer,
    online,
    iconButtons,
    options,
    quit,
    copyright,
    logo,
    edition,
    // SplashRenderer: width / 2 + 123, absolute y=69 (SplashRenderer.java:17-18,32)
    splashX: half(width) + 123,
    splashY: 69,
    // graphics.text(font, versionString, 2, this.height - 10, ...)
    versionX: 2,
    versionY: height - 10,
  };
}
