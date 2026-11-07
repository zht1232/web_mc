/**
 * TouchControls — Bedrock-style touch overlay for WebCraft 26.2.
 * Mount with new TouchControls(document.body, options) and load ./touch.css.
 * Poll getMove() / consumeLook() / is*Held() in the frame loop, and
 * consume*Pressed() for one-shot actions (or use the optional callbacks).
 * Auto-enables on touch hardware or ?touch=1; setVisible(false) while a
 * menu/inventory/pause screen is open, and setFlying() to reveal fly buttons.
 */

export interface TouchControlOptions {
  /** Auto-enable on touch devices. Defaults to isTouchDevice(). */
  autoEnable?: boolean;
  /** Initial visibility once enabled. Default true. */
  visible?: boolean;
  /** Multiplies consumeLook() deltas (CSS pixels). Default 1. */
  sensitivity?: number;
  /** Joystick base radius in CSS px. Default 56 (see touch.css). */
  joystickRadius?: number;
  /** Joystick dead zone as a fraction of travel. Default 0.14. */
  deadZone?: number;
  /** Short vibration on presses where supported. Default false. */
  haptics?: boolean;
  onJump?: () => void;
  onAttackStart?: () => void;
  onAttackEnd?: () => void;
  onUse?: () => void;
  onInventory?: () => void;
  onChat?: () => void;
  onPause?: () => void;
  onSprintChange?: (sprint: boolean) => void;
}

type Action =
  | 'jump'
  | 'sneak'
  | 'flyUp'
  | 'flyDown'
  | 'attack'
  | 'use'
  | 'inventory'
  | 'chat'
  | 'pause';

const ATTACK_TAP_MS = 120;
const JOY_TAP_MS = 300;

const HELD_ACTIONS: readonly Action[] = ['jump', 'sneak', 'flyUp', 'flyDown', 'attack'];

/** True on coarse-pointer/mobile devices, or when the URL has touch=1. */
export function isTouchDevice(): boolean {
  if (typeof window === 'undefined') return false;
  let forced: string | null = null;
  try {
    forced = new URLSearchParams(window.location.search).get('touch');
  } catch {
    forced = null;
  }
  if (forced === '0' || forced === 'false') return false;
  if (forced === '1' || forced === 'true') return true;
  if (typeof window.matchMedia === 'function' && window.matchMedia('(pointer: coarse)').matches) return true;
  return (navigator.maxTouchPoints ?? 0) > 0;
}

const icon = (body: string): string =>
  `<svg viewBox="0 0 32 32" aria-hidden="true" focusable="false">${body}</svg>`;

/* Simple white line icons; stroke styling lives in touch.css. */
const ICONS = {
  jump: icon('<path d="M8 21l8-9 8 9"/>'),
  sneak: icon('<path d="M16 5v13"/><path d="M9 12l7 7 7-7"/><path d="M7 27h18"/>'),
  flyUp: icon('<path d="M16 27V6"/><path d="M7 15l9-9 9 9"/>'),
  flyDown: icon('<path d="M16 5v21"/><path d="M7 17l9 9 9-9"/>'),
  attack: icon(
    '<path d="M27 5l1 1-12 12-2-2z"/><path d="M10 12l10 10"/><path d="M14 18l-5 5"/>' +
    '<circle cx="7.5" cy="24.5" r="1.6"/>'
  ),
  use: icon('<path d="M16 4l10 6v12l-10 6-10-6V10z"/><path d="M6 10l10 6 10-6M16 16v12"/>'),
  inventory: icon('<path d="M6 6h8v8H6zM18 6h8v8h-8zM6 18h8v8H6zM18 18h8v8h-8z"/>'),
  chat: icon('<path d="M6 7h20v13H15l-5 5v-5H6z"/><path d="M11 12h10M11 16h6"/>'),
  pause: icon('<path d="M12 8v16" stroke-width="4"/><path d="M20 8v16" stroke-width="4"/>'),
};

const ACTION_BUTTONS: ReadonlyArray<{ action: Action; label: string; className: string; icon: string }> = [
  { action: 'flyUp', label: 'Fly up', className: 'tc-btn-fly tc-btn-fly-up', icon: ICONS.flyUp },
  { action: 'flyDown', label: 'Fly down', className: 'tc-btn-fly tc-btn-fly-down', icon: ICONS.flyDown },
  { action: 'sneak', label: 'Sneak', className: 'tc-btn-sneak', icon: ICONS.sneak },
  { action: 'use', label: 'Place block or use', className: 'tc-btn-use', icon: ICONS.use },
  { action: 'attack', label: 'Mine or attack', className: 'tc-btn-attack', icon: ICONS.attack },
  { action: 'jump', label: 'Jump', className: 'tc-btn-jump', icon: ICONS.jump },
];

const UTILITY_BUTTONS: ReadonlyArray<{ action: Action; label: string; className: string; icon: string }> = [
  { action: 'inventory', label: 'Inventory', className: 'tc-btn-inventory', icon: ICONS.inventory },
  { action: 'chat', label: 'Chat', className: 'tc-btn-chat', icon: ICONS.chat },
  { action: 'pause', label: 'Pause', className: 'tc-btn-pause', icon: ICONS.pause },
];

function buttonMarkup(spec: { action: Action; label: string; className: string; icon: string }, utility: boolean): string {
  const pressed = !utility && HELD_ACTIONS.includes(spec.action) ? ' aria-pressed="false"' : '';
  return (
    `<div class="tc-btn ${spec.className}" data-action="${spec.action}" role="button" ` +
    `aria-label="${spec.label}"${pressed} tabindex="-1">${spec.icon}</div>`
  );
}

export class TouchControls {
  static isTouchDevice = isTouchDevice;

  /** The overlay element (appended to the root passed to the constructor). */
  readonly element: HTMLDivElement;

  private readonly el: HTMLDivElement;
  private look!: HTMLDivElement;
  private joy!: HTMLDivElement;
  private nub!: HTMLDivElement;
  private readonly buttonEls = new Map<Action, HTMLDivElement>();
  private readonly buttonPointers = new Map<Action, number>();
  private options: TouchControlOptions;

  private enabled = false;
  private visible = false;
  private disposed = false;

  private move = { x: 0, y: 0 };
  private lookAccum = { dx: 0, dy: 0 };
  private lookPointer: number | null = null;
  private lookLastX = 0;
  private lookLastY = 0;

  private joyPointer: number | null = null;
  private joyCenterX = 0;
  private joyCenterY = 0;
  private joyTravel = 34;
  private lastJoyDownAt = -Infinity;
  private sprintArmed = false;
  private sprintHeld = false;

  private jumpHeld = false;
  private jumpPressed = false;
  private sneakHeld = false;
  private flyUpHeld = false;
  private flyDownHeld = false;
  private attackHeld = false;
  private attackPulseUntil = 0;
  private attackTimer: number | null = null;
  private usePressed = false;
  private inventoryPressed = false;
  private chatPressed = false;
  private pausePressed = false;

  constructor(root: HTMLElement, options: TouchControlOptions = {}) {
    this.options = { ...options };
    const shouldEnable = options.autoEnable ?? isTouchDevice();
    const shouldShow = shouldEnable && (options.visible ?? true);

    this.el = document.createElement('div');
    this.el.className = 'tc-root';
    this.el.dataset.enabled = shouldEnable ? 'true' : 'false';
    this.el.dataset.visible = shouldShow ? 'true' : 'false';
    this.el.dataset.flying = 'false';
    this.el.dataset.underwater = 'false';
    this.el.setAttribute('role', 'group');
    this.el.setAttribute('aria-label', 'Touch controls');
    this.el.innerHTML = `
      <div class="tc-look" aria-hidden="true"></div>
      <div class="tc-joy" role="group" aria-label="Move">
        <span class="tc-joy-nub" aria-hidden="true"></span>
      </div>
      <div class="tc-cluster" role="group" aria-label="Touch actions">
        ${ACTION_BUTTONS.map(spec => buttonMarkup(spec, false)).join('')}
        <div class="tc-utils">
          ${UTILITY_BUTTONS.map(spec => buttonMarkup(spec, true)).join('')}
        </div>
      </div>`;
    this.element = this.el;

    this.look = this.query('.tc-look');
    this.joy = this.query('.tc-joy');
    this.nub = this.query('.tc-joy-nub');
    for (const btn of this.el.querySelectorAll<HTMLDivElement>('.tc-btn')) {
      const action = btn.dataset.action as Action;
      this.buttonEls.set(action, btn);
      btn.addEventListener('pointerdown', e => this.onButtonDown(action, btn, e));
      btn.addEventListener('pointerup', e => this.onButtonFinish(action, btn, e));
      btn.addEventListener('pointercancel', e => this.onButtonFinish(action, btn, e));
      btn.addEventListener('lostpointercapture', e => this.onButtonFinish(action, btn, e));
      btn.addEventListener('contextmenu', e => e.preventDefault());
    }

    this.look.addEventListener('pointerdown', this.onLookDown);
    this.look.addEventListener('pointermove', this.onLookMove);
    this.look.addEventListener('pointerup', this.onLookUp);
    this.look.addEventListener('pointercancel', this.onLookUp);
    this.look.addEventListener('lostpointercapture', this.onLookUp);

    this.joy.addEventListener('pointerdown', this.onJoyDown);
    this.joy.addEventListener('pointermove', this.onJoyMove);
    this.joy.addEventListener('pointerup', this.onJoyUp);
    this.joy.addEventListener('pointercancel', this.onJoyUp);
    this.joy.addEventListener('lostpointercapture', this.onJoyUp);

    this.el.addEventListener('contextmenu', this.onContextMenu);
    this.el.addEventListener('selectstart', this.onSelectStart);
    this.el.addEventListener('dragstart', this.onSelectStart);

    window.addEventListener('resize', this.onResize);
    window.addEventListener('orientationchange', this.onResize);
    window.addEventListener('blur', this.onBlur);
    document.addEventListener('visibilitychange', this.onVisibilityChange);
    document.addEventListener('pointerup', this.onGlobalPointerEnd);
    document.addEventListener('pointercancel', this.onGlobalPointerEnd);

    root.appendChild(this.el);
    this.enabled = shouldEnable;
    this.visible = shouldShow;
    if (this.options.joystickRadius !== undefined) this.applyJoystickSize();
    this.updateMetrics();
    this.syncAriaHidden();
  }

  /* ------------------------------------------------------------------ public API */

  enable(): void {
    if (this.disposed) return;
    this.enabled = true;
    this.el.dataset.enabled = 'true';
    this.setVisible(true);
    this.updateMetrics();
  }

  disable(): void {
    if (this.disposed) return;
    this.releaseAll();
    this.enabled = false;
    this.el.dataset.enabled = 'false';
    this.syncAriaHidden();
  }

  setVisible(visible: boolean): void {
    if (this.disposed) return;
    this.visible = visible;
    if (!visible) this.releaseAll();
    this.el.dataset.visible = visible ? 'true' : 'false';
    this.syncAriaHidden();
  }

  isEnabled(): boolean {
    return this.enabled;
  }

  /** Effective visibility (enabled and not hidden by a menu). */
  isVisible(): boolean {
    return this.enabled && this.visible;
  }

  setOptions(patch: TouchControlOptions): void {
    this.options = { ...this.options, ...patch };
    if (patch.joystickRadius !== undefined) this.applyJoystickSize();
    if (patch.visible !== undefined) this.setVisible(patch.visible);
  }

  /** Shows/hides the fly up/down buttons and clears stale fly input. */
  setFlying(flying: boolean): void {
    this.el.dataset.flying = flying ? 'true' : 'false';
    if (!flying) {
      this.flyUpHeld = false;
      this.flyDownHeld = false;
      this.setHeldVisual('flyUp', false);
      this.setHeldVisual('flyDown', false);
    }
  }

  /** Optional cosmetic/accessibility hint: jump becomes "swim up". */
  setUnderwater(underwater: boolean): void {
    this.el.dataset.underwater = underwater ? 'true' : 'false';
    this.buttonEls.get('jump')?.setAttribute('aria-label', underwater ? 'Swim up' : 'Jump');
  }

  getMove(): { x: number; y: number } {
    return { x: this.move.x, y: this.move.y };
  }

  /** Returns accumulated look delta in CSS pixels (sensitivity applied) and resets it. */
  consumeLook(): { dx: number; dy: number } {
    const s = Math.max(0.1, Math.min(4, this.options.sensitivity ?? 1));
    const dx = this.lookAccum.dx * s;
    const dy = this.lookAccum.dy * s;
    this.lookAccum.dx = 0;
    this.lookAccum.dy = 0;
    return { dx, dy };
  }

  isJumpHeld(): boolean {
    return this.jumpHeld;
  }

  consumeJumpPressed(): boolean {
    const pressed = this.jumpPressed;
    this.jumpPressed = false;
    return pressed;
  }

  isSneakHeld(): boolean {
    return this.sneakHeld;
  }

  isSprintHeld(): boolean {
    return this.sprintHeld;
  }

  isFlyUpHeld(): boolean {
    return this.flyUpHeld;
  }

  isFlyDownHeld(): boolean {
    return this.flyDownHeld;
  }

  isAttackHeld(): boolean {
    return this.attackHeld;
  }

  consumeUsePressed(): boolean {
    const pressed = this.usePressed;
    this.usePressed = false;
    return pressed;
  }

  consumeInventoryPressed(): boolean {
    const pressed = this.inventoryPressed;
    this.inventoryPressed = false;
    return pressed;
  }

  consumeChatPressed(): boolean {
    const pressed = this.chatPressed;
    this.chatPressed = false;
    return pressed;
  }

  consumePausePressed(): boolean {
    const pressed = this.pausePressed;
    this.pausePressed = false;
    return pressed;
  }

  dispose(): void {
    if (this.disposed) return;
    this.releaseAll();
    this.disposed = true;
    this.enabled = false;
    window.removeEventListener('resize', this.onResize);
    window.removeEventListener('orientationchange', this.onResize);
    window.removeEventListener('blur', this.onBlur);
    document.removeEventListener('visibilitychange', this.onVisibilityChange);
    document.removeEventListener('pointerup', this.onGlobalPointerEnd);
    document.removeEventListener('pointercancel', this.onGlobalPointerEnd);
    this.el.remove();
  }

  /* ------------------------------------------------------------------ setup helpers */

  private query<T extends Element>(selector: string): T {
    const el = this.el.querySelector<T>(selector);
    if (!el) throw new Error(`TouchControls: missing ${selector}`);
    return el;
  }

  private applyJoystickSize(): void {
    const radius = Math.max(36, Math.min(96, this.options.joystickRadius ?? 56));
    const size = Math.round(radius * 2);
    this.el.style.setProperty('--tc-joy', `${size}px`);
    this.el.style.setProperty('--tc-nub', `${Math.round(size * 0.42)}px`);
  }

  /**
   * Match the HUD's hotbar height: hud.ts uses scale 2..4 and draws a
   * 22 GUI-px hotbar at the bottom. Keeping controls above it also keeps
   * them clear of the home indicator via env(safe-area-inset-bottom).
   */
  private updateMetrics(): void {
    if (this.disposed) return;
    const w = Math.max(1, window.innerWidth);
    const h = Math.max(1, window.innerHeight);
    const hudScale = Math.max(2, Math.min(4, Math.floor(Math.min(w / 320, h / 240))));
    this.el.style.setProperty('--tc-hotbar', `${Math.round(22 * hudScale)}px`);
  }

  /* ------------------------------------------------------------------ buttons */

  private onButtonDown(action: Action, btn: HTMLDivElement, e: PointerEvent): void {
    if (!this.canInteract()) return;
    if (e.pointerType === 'mouse' && e.button !== 0) return;
    if (this.buttonPointers.has(action)) return;
    e.preventDefault();
    e.stopPropagation();
    this.buttonPointers.set(action, e.pointerId);
    btn.classList.add('is-pressed');
    try {
      btn.setPointerCapture(e.pointerId);
    } catch {
      /* capture is best-effort */
    }
    this.pressAction(action);
  }

  private onButtonFinish(action: Action, btn: HTMLDivElement, e: PointerEvent): void {
    if (this.buttonPointers.get(action) !== e.pointerId) return;
    this.buttonPointers.delete(action);
    btn.classList.remove('is-pressed');
    if (btn.hasPointerCapture(e.pointerId)) {
      try {
        btn.releasePointerCapture(e.pointerId);
      } catch {
        /* ignore */
      }
    }
    this.releaseAction(action);
  }

  private pressAction(action: Action): void {
    this.haptic();
    switch (action) {
      case 'jump':
        this.jumpHeld = true;
        this.jumpPressed = true;
        this.setHeldVisual('jump', true);
        this.options.onJump?.();
        break;
      case 'sneak':
        this.sneakHeld = true;
        this.setHeldVisual('sneak', true);
        break;
      case 'flyUp':
        this.flyUpHeld = true;
        this.setHeldVisual('flyUp', true);
        break;
      case 'flyDown':
        this.flyDownHeld = true;
        this.setHeldVisual('flyDown', true);
        break;
      case 'attack':
        this.startAttack();
        break;
      case 'use':
        this.usePressed = true;
        this.options.onUse?.();
        break;
      case 'inventory':
        this.inventoryPressed = true;
        this.options.onInventory?.();
        break;
      case 'chat':
        this.chatPressed = true;
        this.options.onChat?.();
        break;
      case 'pause':
        this.pausePressed = true;
        this.options.onPause?.();
        break;
    }
  }

  private releaseAction(action: Action): void {
    switch (action) {
      case 'jump':
        this.jumpHeld = false;
        this.setHeldVisual('jump', false);
        break;
      case 'sneak':
        this.sneakHeld = false;
        this.setHeldVisual('sneak', false);
        break;
      case 'flyUp':
        this.flyUpHeld = false;
        this.setHeldVisual('flyUp', false);
        break;
      case 'flyDown':
        this.flyDownHeld = false;
        this.setHeldVisual('flyDown', false);
        break;
      case 'attack':
        this.releaseAttack();
        break;
      default:
        break;
    }
  }

  private startAttack(): void {
    if (this.attackTimer !== null) {
      clearTimeout(this.attackTimer);
      this.attackTimer = null;
    }
    if (this.attackHeld) this.options.onAttackEnd?.();
    this.attackHeld = true;
    this.attackPulseUntil = performance.now() + ATTACK_TAP_MS;
    this.setHeldVisual('attack', true);
    this.options.onAttackStart?.();
  }

  /** Taps stay "held" briefly so a frame-based loop never misses a quick tap. */
  private releaseAttack(): void {
    if (!this.attackHeld) return;
    const remain = this.attackPulseUntil - performance.now();
    if (remain > 0) {
      if (this.attackTimer !== null) clearTimeout(this.attackTimer);
      this.attackTimer = window.setTimeout(() => {
        this.attackTimer = null;
        this.endAttack();
      }, Math.max(16, remain));
    } else {
      this.endAttack();
    }
  }

  private endAttack(): void {
    if (this.attackTimer !== null) {
      clearTimeout(this.attackTimer);
      this.attackTimer = null;
    }
    if (!this.attackHeld) return;
    this.attackHeld = false;
    this.setHeldVisual('attack', false);
    this.options.onAttackEnd?.();
  }

  private setHeldVisual(action: Action, held: boolean): void {
    const btn = this.buttonEls.get(action);
    if (btn?.hasAttribute('aria-pressed')) btn.setAttribute('aria-pressed', held ? 'true' : 'false');
  }

  private haptic(): void {
    if (!this.options.haptics) return;
    try {
      navigator.vibrate?.(8);
    } catch {
      /* unsupported */
    }
  }

  /* ------------------------------------------------------------------ look */

  private onLookDown = (e: PointerEvent): void => {
    if (!this.canInteract()) return;
    if (e.pointerType === 'mouse' && e.button !== 0) return;
    if (this.lookPointer !== null) return; // one look finger at a time
    e.preventDefault();
    e.stopPropagation();
    this.lookPointer = e.pointerId;
    this.lookLastX = e.clientX;
    this.lookLastY = e.clientY;
    this.look.classList.add('is-active');
    try {
      this.look.setPointerCapture(e.pointerId);
    } catch {
      /* ignore */
    }
  };

  private onLookMove = (e: PointerEvent): void => {
    if (e.pointerId !== this.lookPointer) return;
    this.lookAccum.dx += e.clientX - this.lookLastX;
    this.lookAccum.dy += e.clientY - this.lookLastY;
    this.lookLastX = e.clientX;
    this.lookLastY = e.clientY;
    e.preventDefault();
  };

  private onLookUp = (e: PointerEvent): void => {
    if (e.pointerId !== this.lookPointer) return;
    this.lookPointer = null;
    this.look.classList.remove('is-active');
  };

  /* ------------------------------------------------------------------ joystick */

  private onJoyDown = (e: PointerEvent): void => {
    if (!this.canInteract()) return;
    if (e.pointerType === 'mouse' && e.button !== 0) return;
    if (this.joyPointer !== null) return;
    e.preventDefault();
    e.stopPropagation();
    this.joyPointer = e.pointerId;

    const base = this.joy.getBoundingClientRect();
    const nub = this.nub.getBoundingClientRect();
    this.joyCenterX = base.left + base.width / 2;
    this.joyCenterY = base.top + base.height / 2;
    this.joyTravel = Math.max(12, (base.width - nub.width) / 2 - 3);

    const now = performance.now();
    this.sprintArmed = now - this.lastJoyDownAt < JOY_TAP_MS;
    this.lastJoyDownAt = now;
    this.joy.classList.add('is-active');
    try {
      this.joy.setPointerCapture(e.pointerId);
    } catch {
      /* ignore */
    }
    this.haptic();
    this.updateJoystick(e.clientX, e.clientY);
  };

  private onJoyMove = (e: PointerEvent): void => {
    if (e.pointerId !== this.joyPointer) return;
    e.preventDefault();
    this.updateJoystick(e.clientX, e.clientY);
  };

  private onJoyUp = (e: PointerEvent): void => {
    if (e.pointerId !== this.joyPointer) return;
    this.joyPointer = null;
    this.endJoystick();
  };

  private updateJoystick(x: number, y: number): void {
    const dx = x - this.joyCenterX;
    const dy = y - this.joyCenterY;
    const dist = Math.hypot(dx, dy);
    const travel = this.joyTravel;
    const dead = Math.max(3, travel * Math.max(0, Math.min(0.5, this.options.deadZone ?? 0.14)));
    const ux = dist > 0 ? dx / dist : 0;
    const uy = dist > 0 ? dy / dist : 0;
    const mag = dist <= dead ? 0 : Math.min(1, (dist - dead) / Math.max(1, travel - dead));

    this.move.x = ux * mag;
    this.move.y = -uy * mag; // screen up is forward

    const vis = Math.min(dist, travel);
    this.nub.style.transform = `translate3d(${ux * vis}px, ${uy * vis}px, 0)`;

    if (this.sprintArmed && !this.sprintHeld && Math.hypot(this.move.x, this.move.y) > 0.3) {
      this.setSprint(true);
    }
  }

  private endJoystick(): void {
    this.move.x = 0;
    this.move.y = 0;
    // Drop is-active first so the nub animates back instead of snapping.
    this.joy.classList.remove('is-active');
    this.nub.style.transform = 'translate3d(0px, 0px, 0)';
    this.sprintArmed = false;
    this.setSprint(false);
  }

  private setSprint(sprint: boolean): void {
    if (this.sprintHeld === sprint) return;
    this.sprintHeld = sprint;
    this.joy.classList.toggle('is-sprinting', sprint);
    this.options.onSprintChange?.(sprint);
  }

  /* ------------------------------------------------------------------ lifecycle */

  private canInteract(): boolean {
    return this.enabled && this.visible && !this.disposed;
  }

  private releaseAll(): void {
    const joyId = this.joyPointer;
    this.joyPointer = null;
    if (joyId !== null && this.joy.hasPointerCapture(joyId)) {
      try {
        this.joy.releasePointerCapture(joyId);
      } catch {
        /* ignore */
      }
    }
    const lookId = this.lookPointer;
    this.lookPointer = null;
    if (lookId !== null && this.look.hasPointerCapture(lookId)) {
      try {
        this.look.releasePointerCapture(lookId);
      } catch {
        /* ignore */
      }
    }

    const buttonPointers = [...this.buttonPointers];
    this.buttonPointers.clear();
    for (const [action, id] of buttonPointers) {
      const btn = this.buttonEls.get(action);
      if (!btn) continue;
      btn.classList.remove('is-pressed');
      if (btn.hasPointerCapture(id)) {
        try {
          btn.releasePointerCapture(id);
        } catch {
          /* ignore */
        }
      }
    }

    if (this.attackTimer !== null) {
      clearTimeout(this.attackTimer);
      this.attackTimer = null;
    }
    const wasAttacking = this.attackHeld;
    this.attackHeld = false;
    this.attackPulseUntil = 0;

    this.move.x = 0;
    this.move.y = 0;
    this.lookAccum.dx = 0;
    this.lookAccum.dy = 0;
    this.jumpHeld = false;
    this.jumpPressed = false;
    this.sneakHeld = false;
    this.flyUpHeld = false;
    this.flyDownHeld = false;
    this.usePressed = false;
    this.inventoryPressed = false;
    this.chatPressed = false;
    this.pausePressed = false;
    this.sprintArmed = false;
    this.setSprint(false);

    for (const action of HELD_ACTIONS) this.setHeldVisual(action, false);
    this.nub.style.transform = 'translate3d(0px, 0px, 0)';
    this.joy.classList.remove('is-active');
    this.look.classList.remove('is-active');
    if (wasAttacking) this.options.onAttackEnd?.();
  }

  private syncAriaHidden(): void {
    this.el.setAttribute('aria-hidden', this.enabled && this.visible ? 'false' : 'true');
  }

  private onResize = (): void => {
    this.updateMetrics();
  };

  private onBlur = (): void => {
    this.releaseAll();
  };

  private onVisibilityChange = (): void => {
    if (document.visibilityState !== 'visible') this.releaseAll();
  };

  /** Safety net for browsers where pointer capture fails: finishes stale gestures. */
  private onGlobalPointerEnd = (e: PointerEvent): void => {
    for (const [action, btn] of this.buttonEls) {
      if (this.buttonPointers.get(action) === e.pointerId) this.onButtonFinish(action, btn, e);
    }
    if (this.joyPointer === e.pointerId) {
      this.joyPointer = null;
      this.endJoystick();
    }
    if (this.lookPointer === e.pointerId) {
      this.lookPointer = null;
      this.look.classList.remove('is-active');
    }
  };

  private onContextMenu = (e: Event): void => {
    if (this.canInteract()) e.preventDefault();
  };

  private onSelectStart = (e: Event): void => {
    e.preventDefault();
  };
}
