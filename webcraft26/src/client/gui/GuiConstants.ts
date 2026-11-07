// Constants transcribed from the 26.2 decompiled sources.
// Sources: net.minecraft.client.gui.components.Button,
//          net.minecraft.client.gui.screens.Screen,
//          net.minecraft.client.gui.screens.TitleScreen,
//          net.minecraft.client.gui.screens.DeathScreen,
//          net.minecraft.client.gui.screens.PauseScreen,
//          net.minecraft.client.gui.screens.inventory.AbstractContainerScreen,
//          net.minecraft.client.gui.screens.inventory.CreativeModeInventoryScreen,
//          net.minecraft.client.gui.components.LogoRenderer,
//          net.minecraft.client.gui.screens.inventory.tooltip.TooltipRenderUtil,
//          net.minecraft.world.inventory.InventoryMenu / AbstractContainerMenu.

// ---- Button.java -----------------------------------------------------------
export const BUTTON_SMALL_WIDTH = 120;
export const BUTTON_DEFAULT_WIDTH = 150;
export const BUTTON_BIG_WIDTH = 200;
export const BUTTON_DEFAULT_HEIGHT = 20;
export const BUTTON_DEFAULT_SPACING = 8;

// ---- TitleScreen.java ------------------------------------------------------
/** int topPos = this.height / 4 + 48; */
export const TITLE_TOP_OFFSET = 48;
/** int spacing = 24; */
export const TITLE_SPACING = 24;
/** .bounds(this.width / 2 - 100, topPos, 200, 20) */
export const TITLE_BIG_BUTTON_WIDTH = 200;
export const TITLE_BIG_BUTTON_HEIGHT = 20;
/** .bounds(this.width / 2 - 100, topPos, 98, 20) / .bounds(this.width / 2 + 2, ...) */
export const TITLE_HALF_BUTTON_WIDTH = 98;
/** getHorizontalPosition(..., 3, 20): 3 icon buttons of 20px with 4px gaps */
export const TITLE_ICON_BUTTON_SIZE = 20;
export const TITLE_ICON_BUTTON_COUNT = 3;
export const TITLE_ICON_BUTTON_GAP = 4;

// ---- LogoRenderer.java -----------------------------------------------------
export const LOGO_WIDTH = 256;
export const LOGO_HEIGHT = 44;
export const LOGO_DEFAULT_HEIGHT_OFFSET = 30;
export const EDITION_WIDTH = 128;
export const EDITION_HEIGHT = 14;
export const EDITION_LOGO_OVERLAP = 7;

// ---- Screen.java -----------------------------------------------------------
/** extractTransparentBackground: fillGradient(0,0,w,h, -1072689136, -804253680) */
export const SCREEN_TRANSPARENT_BG_TOP = -1072689136;   // 0xC0101010
export const SCREEN_TRANSPARENT_BG_BOTTOM = -804253680; // 0xD0101010
/** classic semi-transparent black used by renderBackground / dirt overlay */
export const MENU_SHADE_COLOR = 0x60000000;
/** 32x32 tiled menu background (Screen.extractMenuBackgroundTexture) */
export const MENU_BACKGROUND_SIZE = 32;
export const MENU_BACKGROUND = 'gui/menu_background';
export const INWORLD_MENU_BACKGROUND = 'gui/inworld_menu_background';
export const HEADER_SEPARATOR = 'gui/header_separator';
export const FOOTER_SEPARATOR = 'gui/footer_separator';

// ---- DeathScreen.java ------------------------------------------------------
/** extractDeathBackground: fillGradient(0,0,w,h, 1615855616, -1602211792) */
export const DEATH_BG_TOP = 1615855616;     // 0x60500000
export const DEATH_BG_BOTTOM = -1602211792; // 0xA0803030
export const DEATH_BUTTON_Y = 72;           // height / 4 + 72
export const DEATH_TITLE_BUTTON_Y = 96;     // height / 4 + 96

// ---- PauseScreen.java ------------------------------------------------------
export const PAUSE_COLUMNS = 2;
export const PAUSE_MENU_PADDING_TOP = 50;
export const PAUSE_BUTTON_PADDING = 4;
export const PAUSE_BUTTON_WIDTH_FULL = 204;
export const PAUSE_BUTTON_WIDTH_HALF = 98;

// ---- AbstractContainerScreen.java -----------------------------------------
export const CONTAINER_TEXTURE_WIDTH = 256;
export const CONTAINER_TEXTURE_HEIGHT = 256;
export const CONTAINER_DEFAULT_IMAGE_WIDTH = 176;
export const CONTAINER_DEFAULT_IMAGE_HEIGHT = 166;
export const CONTAINER_TITLE_LABEL_X = 8;
export const CONTAINER_TITLE_LABEL_Y = 6;
export const CONTAINER_INVENTORY_LABEL_Y_OFFSET = 94; // imageHeight - 94
/** graphics.text(..., -12566464, false) */
export const LABEL_COLOR = -12566464; // 0xFF404040
export const INVENTORY_LOCATION = 'gui/container/inventory';
export const SLOT_HIGHLIGHT_BACK = 'container/slot_highlight_back';
export const SLOT_HIGHLIGHT_FRONT = 'container/slot_highlight_front';

// ---- InventoryMenu / AbstractContainerMenu -------------------------------
export const SLOT_SIZE = 16;
export const SLOT_GRID = 18;
/** addStandardInventorySlots(inventory, 8, 84) */
export const PLAYER_INV_LEFT = 8;
export const PLAYER_INV_TOP = 84;
/** addInventoryHotbarSlots(container, left, top + 58) */
export const HOTBAR_TOP_OFFSET = 58;
export const PLAYER_INV_HOTBAR_TOP = PLAYER_INV_TOP + HOTBAR_TOP_OFFSET; // 142
export const PLAYER_INV_COLS = 9;
export const PLAYER_INV_ROWS = 3;
/** container slot indices */
export const HOTBAR_SLOT_START = 0;
export const HOTBAR_SLOT_END = 9;
export const MAIN_INV_SLOT_START = 9;
export const MAIN_INV_SLOT_END = 36;
export const ARMOR_SLOT_START = 36;
export const OFFHAND_SLOT = 40;
/** InventoryMenu.addResultSlot(owner, 154, 28), addCraftingGridSlots(98, 18) */
export const CRAFT_RESULT_X = 154;
export const CRAFT_RESULT_Y = 28;
export const CRAFT_GRID_X = 98;
export const CRAFT_GRID_Y = 18;
/** ArmorSlot(inventory, owner, slot, 39 - i, 8, 8 + i * 18) */
export const ARMOR_SLOT_X = 8;
export const ARMOR_SLOT_Y = 8;
export const OFFHAND_SLOT_X = 77;
export const OFFHAND_SLOT_Y = 62;
/** InventoryScreen: this.titleLabelX = 97 */
export const INVENTORY_TITLE_LABEL_X = 97;

// ---- CreativeModeInventoryScreen.java -------------------------------------
export const CREATIVE_NUM_ROWS = 5;
export const CREATIVE_NUM_COLS = 9;
export const CREATIVE_TAB_WIDTH = 26;
export const CREATIVE_TAB_HEIGHT = 32;
export const CREATIVE_SCROLLER_WIDTH = 12;
export const CREATIVE_SCROLLER_HEIGHT = 15;
/** this.searchBox = new EditBox(font, leftPos + 82, topPos + 6, 80, 9, ...) */
export const CREATIVE_SEARCH_X = 82;
export const CREATIVE_SEARCH_Y = 6;
export const CREATIVE_SEARCH_WIDTH = 80;
export const CREATIVE_SEARCH_HEIGHT = 9;

// ---- TooltipRenderUtil.java ------------------------------------------------
export const TOOLTIP_MOUSE_OFFSET = 12;
export const TOOLTIP_PADDING = 3;
export const TOOLTIP_MARGIN = 9;
export const TOOLTIP_BACKGROUND = 'tooltip/background';
export const TOOLTIP_FRAME = 'tooltip/frame';
export const TOOLTIP_BG_COLOR = 0xf0100010;
export const TOOLTIP_BORDER_START = 0x505000ff;
export const TOOLTIP_BORDER_END = 0x5028007f;

// ---- ChatScreen.java -------------------------------------------------------
/** new EditBox(..., 4, this.height - 12, this.width - 4, 12, ...) */
export const CHAT_EDIT_X = 4;
export const CHAT_EDIT_HEIGHT = 12;
export const CHAT_EDIT_MAX_LENGTH = 256;

// ---- Font / colours --------------------------------------------------------
export const COLOR_WHITE = 0xffffffff;
export const COLOR_BLACK = 0xff000000;
export const COLOR_GRAY = 0xffa0a0a0;
export const COLOR_DARK_GRAY = 0xff404040;
export const COLOR_YELLOW = 0xffffff55;
export const COLOR_GREEN = 0xff55ff55;
export const COLOR_RED = 0xffff5555;

/** Sprite names are relative to textures/gui/sprites/. */
export function spritePath(name: string): string {
  return `gui/sprites/${name}`;
}

/** Container background textures are relative to textures/. */
export function texturePath(name: string): string {
  return `gui/container/${name}`;
}
