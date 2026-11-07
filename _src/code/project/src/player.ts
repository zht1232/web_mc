import type { World } from './world.js';
import { WORLD_MAX_Y } from './world.js';
import type { BlockRegistry, BlockDef } from './blocks.js';
import { basisFromYawPitch } from './math.js';

export interface Hit {
  x: number; y: number; z: number;
  nx: number; ny: number; nz: number;
}

const TICK = 1 / 20;
// Vanilla models motion in blocks/tick with per-tick drag, so a fixed 20 Hz step
// reproduces the real game's feel at any frame rate. Speeds below are blocks/tick.
const WALK = 0.2159;
const SPRINT = 0.2806;
const FLY = 0.5395;
const FLY_SPRINT = 1.079;
const SNEAK = 0.0648;
const GRAVITY = 0.08;
const WATER_GRAVITY = 0.008;
const JUMP = 0.42;
const DRAG_GROUND = 0.546;
const DRAG_AIR = 0.98;
const DRAG_WATER = 0.8;
const MAX_FALL = 3.92;
const EYE = 1.62;
const HALF_W = 0.3;
const HEIGHT = 1.8;
const STEP_HEIGHT = 0.6;
const MAX_SUBSTEP = 0.2;
const DOUBLE_TAP_MS = 320;

export class Player {
  pos = { x: 8.5, y: 80, z: 8.5 };
  prev = { x: 8.5, y: 80, z: 8.5 };
  vel = { x: 0, y: 0, z: 0 };
  private acc = 0;
  yaw = Math.PI;
  pitch = 0.08;
  flying = false;
  onGround = false;
  sprinting = false;
  inWater = false;
  locked = false;
  touchEnabled = false;
  touchMoveX = 0;
  touchMoveY = 0;
  touchJumpHeld = false;
  touchSneak = false;
  touchSprint = false;
  touchFlyUp = false;
  touchFlyDown = false;
  health = 20;
  maxHealth = 20;
  hurtTime = 0;
  invulnerable = 0;
  target: Hit | null = null;
  hotbar: BlockDef[];
  selected = 0;
  selectedSince = 0;
  private keys = new Set<string>();
  private lastSpace = -1000;
  private canvas: HTMLCanvasElement | null = null;
  private onBlockChanged: ((x: number, y: number, z: number, oldId: number, newId: number) => void) | null = null;

  constructor(private world: World, private rocks: BlockRegistry, spawn: { x: number, y: number, z: number }) {
    this.pos = { x: spawn.x + 0.5, y: spawn.y, z: spawn.z + 0.5 };
    this.prev = { ...this.pos };
    this.hotbar = rocks.hotbar();
  }

  setBlockChangeHandler(fn: (x: number, y: number, z: number, oldId: number, newId: number) => void) { this.onBlockChanged = fn; }

  isInputActive(): boolean { return this.locked || this.touchEnabled; }

  setTouchInput(moveX: number, moveY: number, jump: boolean, sneak: boolean, sprint: boolean, flyUp: boolean, flyDown: boolean): void {
    this.touchMoveX = moveX;
    this.touchMoveY = moveY;
    this.touchJumpHeld = jump;
    this.touchSneak = sneak;
    this.touchSprint = sprint;
    this.touchFlyUp = flyUp;
    this.touchFlyDown = flyDown;
  }

  tryBreak(): void { this.breakBlock(); }
  tryPlace(): void { this.placeBlock(); }
  tryPick(): void { this.pickBlock(); }

  damage(amount: number): void {
    if (this.invulnerable > 0 || amount <= 0) return;
    this.health = Math.max(0, this.health - amount);
    this.hurtTime = 0.4;
    this.invulnerable = 0.45;
    if (this.health <= 0) {
      const spawn = this.world.findSpawn();
      this.pos = { x: spawn.x + 0.5, y: spawn.y + 1, z: spawn.z + 0.5 };
      this.vel = { x: 0, y: 0, z: 0 };
      this.health = this.maxHealth;
      this.hurtTime = 0.8;
    }
  }

  attach(canvas: HTMLCanvasElement): void {
    this.canvas = canvas;
    document.addEventListener('pointerlockchange', this.onLockChange);
    document.addEventListener('keydown', this.onKeyDown);
    document.addEventListener('keyup', this.onKeyUp);
    document.addEventListener('mousemove', this.onMouseMove);
    canvas.addEventListener('mousedown', this.onMouseDown);
    canvas.addEventListener('contextmenu', e => e.preventDefault());
    canvas.addEventListener('wheel', this.onWheel, { passive: false });
  }

  requestLock(): void {
    if (!this.canvas) return;
    if (document.pointerLockElement !== this.canvas) this.canvas.requestPointerLock();
  }

  private onLockChange = () => {
    this.locked = document.pointerLockElement === this.canvas;
    if (!this.locked) this.keys.clear();
  };

  private onKeyDown = (e: KeyboardEvent) => {
    if (!this.locked) return;
    if (['Space', 'ControlLeft', 'ShiftLeft', 'Tab'].includes(e.code)) e.preventDefault();
    this.keys.add(e.code);
    if (e.code === 'Space' && !e.repeat) {
      const now = performance.now();
      if (now - this.lastSpace < DOUBLE_TAP_MS) {
        this.flying = !this.flying;
        this.vel.y = 0;
      }
      this.lastSpace = now;
    }
    if (e.code === 'KeyF' && !e.repeat) {
      this.flying = !this.flying;
      this.vel.y = 0;
    }
    if (e.code.startsWith('Digit')) {
      const n = Number(e.code.slice(5));
      if (n >= 1 && n <= 9) { this.selected = n - 1; this.selectedSince = performance.now(); }
    }
  };

  private onKeyUp = (e: KeyboardEvent) => {
    this.keys.delete(e.code);
  };

  private onMouseMove = (e: MouseEvent) => {
    if (!this.locked) return;
    const sens = 0.0022;
    this.yaw += e.movementX * sens;
    this.pitch += e.movementY * sens;
    this.pitch = Math.max(-Math.PI / 2 + 0.001, Math.min(Math.PI / 2 - 0.001, this.pitch));
    if (this.yaw > Math.PI * 2) this.yaw -= Math.PI * 2;
    if (this.yaw < 0) this.yaw += Math.PI * 2;
  };

  private onMouseDown = (e: MouseEvent) => {
    if (!this.locked) return;
    e.preventDefault();
    if (e.button === 0) this.breakBlock();
    else if (e.button === 2) this.placeBlock();
    else if (e.button === 1) this.pickBlock();
  };

  private onWheel = (e: WheelEvent) => {
    if (!this.locked) return;
    e.preventDefault();
    const dir = Math.sign(e.deltaY);
    this.selected = (this.selected + dir + 9) % 9;
    this.selectedSince = performance.now();
  };

  eye(): { x: number, y: number, z: number } {
    return { x: this.pos.x, y: this.pos.y + EYE, z: this.pos.z };
  }

  update(dt: number, allowInput = true): void {
    this.hurtTime = Math.max(0, this.hurtTime - dt);
    this.invulnerable = Math.max(0, this.invulnerable - dt);
    this.acc = Math.min(this.acc + dt, 0.25);
    while (this.acc >= TICK) {
      this.prev = { x: this.pos.x, y: this.pos.y, z: this.pos.z };
      this.tickStep(allowInput);
      this.acc -= TICK;
    }
    this.target = this.raycast();
  }

  /** Interpolated eye position so 20 Hz logic still renders smoothly at any frame rate. */
  eyeLerp(): { x: number, y: number, z: number } {
    const a = Math.max(0, Math.min(1, this.acc / TICK));
    return {
      x: this.prev.x + (this.pos.x - this.prev.x) * a,
      y: this.prev.y + (this.pos.y - this.prev.y) * a + EYE,
      z: this.prev.z + (this.pos.z - this.prev.z) * a,
    };
  }

  private tickStep(allowInput: boolean): void {
    const active = allowInput && this.isInputActive();
    const keys = this.keys;
    const held = (code: string) => active && keys.has(code);
    const forward = (held('KeyW') ? 1 : 0) - (held('KeyS') ? 1 : 0) + (active ? this.touchMoveY : 0);
    const strafe = (held('KeyD') ? 1 : 0) - (held('KeyA') ? 1 : 0) + (active ? this.touchMoveX : 0);
    const sprint = active && (held('ControlLeft') || held('ControlRight') || this.touchSprint);
    const sneak = active && (held('ShiftLeft') || held('ShiftRight') || this.touchSneak);
    const jumpHeld = active && (held('Space') || this.touchJumpHeld);
    this.sprinting = sprint && forward > 0.1;
    const eyeBlock = this.world.getBlock(Math.floor(this.pos.x), Math.floor(this.pos.y + 0.2), Math.floor(this.pos.z));
    const inWater = eyeBlock !== 0 && this.rocks.byName.get('water')?.id === eyeBlock;
    this.inWater = inWater;
    const grounded = this.onGround;

    const basis = basisFromYawPitch(this.yaw, 0);
    let moveX = basis.fx * forward + basis.rx * strafe;
    let moveZ = basis.fz * forward + basis.rz * strafe;
    const len = Math.hypot(moveX, moveZ);
    if (len > 1) { moveX /= len; moveZ /= len; }

    if (this.flying) {
      const speed = sprint ? FLY_SPRINT : FLY;
      this.vel.x = moveX * speed;
      this.vel.z = moveZ * speed;
      this.vel.y = 0;
      if (jumpHeld || this.touchFlyUp) this.vel.y = speed * 0.8;
      if (sneak || this.touchFlyDown) this.vel.y = -speed * 0.8;
    } else {
      const target = inWater ? WALK * 0.5 : sneak ? SNEAK : sprint ? SPRINT : WALK;
      const damping = inWater ? DRAG_WATER : grounded ? DRAG_GROUND : DRAG_AIR;
      // In air the player keeps 98% of momentum but only gets a fifth of the push,
      // which is exactly why vanilla feels floaty once you leave the ground.
      const accel = inWater ? target * 0.1 : (grounded ? 1 : 0.2) * target * (1 - DRAG_GROUND);
      this.vel.x = this.vel.x * damping + moveX * accel;
      this.vel.z = this.vel.z * damping + moveZ * accel;
      if (inWater) {
        if (jumpHeld || this.touchFlyUp) this.vel.y = 0.06;
        else this.vel.y = Math.max(this.vel.y - WATER_GRAVITY, -0.05);
      } else if (jumpHeld && grounded) {
        this.vel.y = JUMP;
      }
    }

    this.onGround = false;
    this.moveVertical(this.vel.y);
    this.moveHorizontal('x', this.vel.x);
    this.moveHorizontal('z', this.vel.z);
    this.clampToBounds();

    if (!this.flying && !inWater) {
      if (this.onGround) this.vel.y = -GRAVITY;
      else this.vel.y = Math.max((this.vel.y - GRAVITY) * DRAG_AIR, -MAX_FALL);
    }

    if (this.pos.y < -80) {
      const spawn = this.world.findSpawn();
      this.pos = { x: spawn.x + 0.5, y: spawn.y + 1, z: spawn.z + 0.5 };
      this.prev = { ...this.pos };
      this.vel = { x: 0, y: 0, z: 0 };
    }
  }

  /** Moves on the vertical axis, stopping at contact and reporting ground state. */
  private moveVertical(delta: number): void {
    if (delta === 0) return;
    if (this.slide('y', delta)) {
      if (delta < 0) this.onGround = true;
      this.vel.y = 0;
    }
  }

  /**
   * Horizontal move with the vanilla 0.6-block step-up, so slabs and single
   * stair steps are walked over instead of stopping the player.
   */
  private moveHorizontal(axis: 'x' | 'z', delta: number): void {
    if (delta === 0) return;
    const start = this.pos[axis];
    if (!this.slide(axis, delta)) return;
    const partial = this.pos[axis];
    let stepped = false;
    if (!this.flying && this.onGround) {
      const y0 = this.pos.y;
      this.pos[axis] = start;
      this.pos.y = y0 + STEP_HEIGHT;
      if (!this.collidesAt(this.pos.x, this.pos.y, this.pos.z)) {
        const stillBlocked = this.slide(axis, delta);
        const gain = Math.abs(this.pos[axis] - start);
        stepped = !stillBlocked || gain > Math.abs(partial - start) + 1e-3;
        if (stepped) {
          let drop = 0;
          while (drop < STEP_HEIGHT && !this.collidesAt(this.pos.x, this.pos.y - 0.02, this.pos.z)) {
            this.pos.y -= 0.02;
            drop += 0.02;
          }
          this.onGround = true;
        }
      }
    }
    if (!stepped) {
      this.pos[axis] = partial;
      this.vel[axis] = 0;
    }
  }

  /** Sweeps one axis in sub-block steps so fast falls cannot tunnel through floors. */
  private slide(axis: 'x' | 'y' | 'z', delta: number): boolean {
    const steps = Math.max(1, Math.ceil(Math.abs(delta) / MAX_SUBSTEP));
    const inc = delta / steps;
    for (let i = 0; i < steps; i++) {
      const nx = this.pos.x + (axis === 'x' ? inc : 0);
      const ny = this.pos.y + (axis === 'y' ? inc : 0);
      const nz = this.pos.z + (axis === 'z' ? inc : 0);
      if (this.collidesAt(nx, ny, nz)) return true;
      this.pos.x = nx;
      this.pos.y = ny;
      this.pos.z = nz;
    }
    return false;
  }

  private collidesAt(x: number, y: number, z: number): boolean {
    const minX = Math.floor(x - HALF_W), maxX = Math.floor(x + HALF_W);
    const minY = Math.floor(y + 1e-4), maxY = Math.floor(y + HEIGHT - 1e-4);
    const minZ = Math.floor(z - HALF_W), maxZ = Math.floor(z + HALF_W);
    for (let cy = minY; cy <= maxY; cy++) {
      for (let cz = minZ; cz <= maxZ; cz++) {
        for (let cx = minX; cx <= maxX; cx++) {
          const id = this.world.getBlock(cx, cy, cz);
          if (id !== 0 && this.rocks.solid[id]) return true;
        }
      }
    }
    return false;
  }

  /** The generated region is finite, so keep the player inside it instead of falling into the void. */
  private clampToBounds(): void {
    const w = this.world;
    const lo = w.minWorldX + HALF_W, hi = w.maxWorldX + 1 - HALF_W;
    if (this.pos.x < lo || this.pos.x > hi) {
      this.pos.x = Math.max(lo, Math.min(hi, this.pos.x));
      this.vel.x = 0;
    }
    if (this.pos.z < lo || this.pos.z > hi) {
      this.pos.z = Math.max(lo, Math.min(hi, this.pos.z));
      this.vel.z = 0;
    }
    const ceil = WORLD_MAX_Y - HEIGHT - 1;
    if (this.pos.y > ceil) {
      this.pos.y = ceil;
      this.vel.y = Math.min(this.vel.y, 0);
    }
  }

  raycast(): Hit | null {
    const eye = this.eye();
    const { fx, fy, fz } = basisFromYawPitch(this.yaw, this.pitch);
    let x = Math.floor(eye.x), y = Math.floor(eye.y), z = Math.floor(eye.z);
    const stepX = Math.sign(fx), stepY = Math.sign(fy), stepZ = Math.sign(fz);
    const tDeltaX = stepX === 0 ? Infinity : Math.abs(1 / fx);
    const tDeltaY = stepY === 0 ? Infinity : Math.abs(1 / fy);
    const tDeltaZ = stepZ === 0 ? Infinity : Math.abs(1 / fz);
    let tMaxX = stepX === 0 ? Infinity : ((stepX > 0 ? x + 1 - eye.x : eye.x - x) / Math.abs(fx));
    let tMaxY = stepY === 0 ? Infinity : ((stepY > 0 ? y + 1 - eye.y : eye.y - y) / Math.abs(fy));
    let tMaxZ = stepZ === 0 ? Infinity : ((stepZ > 0 ? z + 1 - eye.z : eye.z - z) / Math.abs(fz));
    let nx = 0, ny = 0, nz = 0;
    const reach = 5.0;
    for (let i = 0; i < 128; i++) {
      const id = this.world.getBlock(x, y, z);
      if (id !== 0 && !this.rocks.liquid[id]) return { x, y, z, nx, ny, nz };
      if (tMaxX < tMaxY && tMaxX < tMaxZ) {
        if (tMaxX > reach) break;
        x += stepX; tMaxX += tDeltaX; nx = -stepX; ny = 0; nz = 0;
      } else if (tMaxY < tMaxZ) {
        if (tMaxY > reach) break;
        y += stepY; tMaxY += tDeltaY; nx = 0; ny = -stepY; nz = 0;
      } else {
        if (tMaxZ > reach) break;
        z += stepZ; tMaxZ += tDeltaZ; nx = 0; ny = 0; nz = -stepZ;
      }
    }
    return null;
  }

  currentBlock(): BlockDef | null {
    return this.hotbar[this.selected] ?? null;
  }

  private breakBlock(): void {
    if (!this.target) return;
    const { x, y, z } = this.target;
    const oldId = this.world.getBlock(x, y, z);
    if (oldId === 0) return;
    this.world.setBlock(x, y, z, 0);
    this.onBlockChanged?.(x, y, z, oldId, 0);
  }

  private placeBlock(): void {
    if (!this.target) return;
    const def = this.currentBlock();
    if (!def) return;
    const x = this.target.x + this.target.nx;
    const y = this.target.y + this.target.ny;
    const z = this.target.z + this.target.nz;
    if (y < -64 || y >= 320) return;
    if (this.world.getBlock(x, y, z) !== 0) return;
    if (this.rocks.solid[def.id] && this.blockIntersectsPlayer(x, y, z)) return;
    const oldId = this.world.getBlock(x, y, z);
    this.world.setBlock(x, y, z, def.id);
    this.onBlockChanged?.(x, y, z, oldId, def.id);
  }

  private blockIntersectsPlayer(x: number, y: number, z: number): boolean {
    return x + 1 > this.pos.x - 0.3 && x < this.pos.x + 0.3 &&
      y + 1 > this.pos.y && y < this.pos.y + 1.8 &&
      z + 1 > this.pos.z - 0.3 && z < this.pos.z + 0.3;
  }

  private pickBlock(): void {
    if (!this.target) return;
    const id = this.world.getBlock(this.target.x, this.target.y, this.target.z);
    const def = this.rocks.get(id);
    if (!def || def.id === 0) return;
    const existing = this.hotbar.findIndex(b => b.id === def.id);
    if (existing >= 0) this.selected = existing;
    else this.hotbar[this.selected] = def;
    this.selectedSince = performance.now();
  }
}
