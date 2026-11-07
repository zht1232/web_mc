// Compatibility re-export.
//
// The vanilla source class is
//   net.minecraft.client.gui.screens.inventory.AbstractContainerScreen
// so the implementation lives in screens/inventory/AbstractContainerScreen.ts
// (matching the Java package). The delivery spec also names a
// `container/AbstractContainerScreen.ts` path; this thin module re-exports the
// same symbols so either import path resolves.
//
// Source: net.minecraft.client.gui.screens.inventory.AbstractContainerScreen (26.2).

export {
  AbstractContainerScreen,
  MemoryContainerMenu,
  type SlotDef,
} from '../inventory/AbstractContainerScreen.js';
