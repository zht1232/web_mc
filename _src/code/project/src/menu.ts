/// <reference types="vite/client" />
import './menu.css';
import { loadMenuAssets, MENU_URLS } from './menuAssets.js';
import type { VanillaFont } from './font.js';
export type Quality = 'auto' | 'low' | 'medium' | 'high' | 'ultra';
export type TouchControls = 'auto' | 'on' | 'off';
export type PixelFiltering = 0 | 1 | 2;
export interface MenuSettings {
  quality: Quality; renderDistance: number; fov: number; filtering: PixelFiltering;
  shaders: boolean; touch: TouchControls; volume: number;
}
export interface StartOptions { name: string; seed: string; mode: 'survival' }
export interface ConnectOptions { name: string; address: string }
export interface MenuServer { name: string; address: string }
export interface VanillaMenuOptions { autoOpen?: boolean }
const DEFAULT_SETTINGS: MenuSettings = {
  quality: 'auto', renderDistance: 8, fov: 70, filtering: 0, shaders: true, touch: 'auto', volume: 70,
};
const QUALITIES: readonly Quality[] = ['auto', 'low', 'medium', 'high', 'ultra'];
const TOUCH_MODES: readonly TouchControls[] = ['auto', 'on', 'off'];
const FILTERING_NAMES = ['Off', 'Nearest', 'Linear'] as const;
const SETTINGS_KEY = 'webcraft.menu.settings';
const SERVERS_KEY = 'webcraft.menu.servers';
const BUILTIN_SERVER: MenuServer = { name: 'Local Paper', address: 'ws://127.0.0.1:8765' };
const DEFAULT_WORLD = { name: 'World', seed: '2602c0de' } as const;
const IMG_URLS = {
  logo: MENU_URLS.logo, dirt: MENU_URLS.dirt, button: MENU_URLS.button,
  buttonHl: MENU_URLS.buttonHighlighted, buttonOff: MENU_URLS.buttonDisabled,
  slider: MENU_URLS.slider, sliderHl: MENU_URLS.sliderHighlighted,
  handle: MENU_URLS.sliderHandle, handleHl: MENU_URLS.sliderHandleHighlighted,
  field: MENU_URLS.textField, fieldHl: MENU_URLS.textFieldHighlighted,
} as const;
type Screen = 'main' | 'single' | 'create' | 'multi' | 'add' | 'direct' | 'options';
type ImgKey = keyof typeof IMG_URLS;
type Border = number | [number, number, number, number];
interface FieldHooks {
  get: () => string; set: (value: string) => void; placeholder: string; submit: () => void; maxLength: number;
}
interface Widget {
  id: string; kind: 'button' | 'slider' | 'field' | 'server';
  x: number; y: number; w: number; h: number; label: string;
  detail?: string; value?: number; min?: number; max?: number; disabled?: boolean; selected?: boolean;
  act?: () => void; set?: (value: number) => void; field?: FieldHooks;
}
interface Layout { widgets: Widget[]; decor: (c: CanvasRenderingContext2D, time: number) => void }
interface GLInfo {
  gl: WebGL2RenderingContext; program: WebGLProgram; cube: WebGLTexture;
  res: WebGLUniformLocation | null; yaw: WebGLUniformLocation | null;
}
const clamp = (n: number, a: number, b: number) => Math.min(b, Math.max(a, n));
const cap = (s: string) => s.charAt(0).toUpperCase() + s.slice(1);
function integer(value: unknown, min: number, max: number, fallback: number): number {
  const n = typeof value === 'number' ? value : Number(value);
  return Number.isFinite(n) ? clamp(Math.round(n), min, max) : fallback;
}
function pick<T>(value: unknown, allowed: readonly T[], fallback: T): T {
  return allowed.includes(value as T) ? value as T : fallback;
}
function step<T>(values: readonly T[], value: T, dir = 1): T {
  return values[(Math.max(0, values.indexOf(value)) + dir + values.length) % values.length];
}
function randomSeed(): string {
  try {
    const words = new Uint32Array(2); crypto.getRandomValues(words);
    return `${words[0].toString(16)}${words[1].toString(16)}`;
  } catch { return Math.floor(Math.random() * 0xffffffff).toString(16); }
}
function addressName(address: string): string {
  const match = /^wss?:\/\/([^/]+)/i.exec(address);
  return (match ? match[1] : address).slice(0, 32) || 'Server';
}
function normalizeAddress(value: string): string {
  let a = value.trim().replace(/\s+/g, '');
  if (!a) return '';
  if (/^https:\/\//i.test(a)) a = `wss://${a.slice(8)}`;
  else if (/^http:\/\//i.test(a)) a = `ws://${a.slice(7)}`;
  else if (!/^wss?:\/\//i.test(a)) a = `ws://${a}`;
  return a.slice(0, 128);
}
function readJSON(key: string, fallback: unknown): unknown {
  try { const raw = localStorage.getItem(key); return raw ? JSON.parse(raw) : fallback; } catch { return fallback; }
}
function writeJSON(key: string, value: unknown): void {
  try { localStorage.setItem(key, JSON.stringify(value)); } catch { /* storage unavailable */ }
}
const VS = `#version 300 es
void main() {
  vec2 p = vec2(float((gl_VertexID << 1) & 2), float(gl_VertexID & 2));
  gl_Position = vec4(p * 2.0 - 1.0, 0.0, 1.0);
}`;
const FS = `#version 300 es
precision highp float;
uniform samplerCube uCube;
uniform vec2 uRes;
uniform float uYaw;
out vec4 outColor;
void main() {
  vec2 p = (gl_FragCoord.xy * 2.0 - uRes) / uRes.y;
  vec3 d = normalize(vec3(p.x * 0.78, p.y * 0.78 + 0.02, -1.0));
  float c = cos(uYaw), s = sin(uYaw);
  d = vec3(c * d.x + s * d.z, d.y, -s * d.x + c * d.z);
  outColor = vec4(texture(uCube, d).rgb, 1.0);
}`;
/** A fullscreen, canvas-drawn vanilla menu shell. */
export class VanillaMenu {
  private doc: Document;
  private overlay: HTMLDivElement;
  private bgCanvas: HTMLCanvasElement;
  private uiCanvas: HTMLCanvasElement;
  private ui: CanvasRenderingContext2D;
  private input: HTMLInputElement;
  private opened = false;
  private assetsLoaded = false;
  private font: VanillaFont | null = null;
  private imgs: Partial<Record<ImgKey, HTMLImageElement>> = {};
  private faces: (ImageBitmap | null)[] = [];
  private splash = '';
  private cssW = 1; private cssH = 1; private dpr = 1; private scale = 2;
  private animTime = 0; private lastFrame = 0; private lastUi = 0; private raf = 0; private dirty = true;
  private screen: Screen = 'main';
  private stack: Screen[] = [];
  private focusId: string | null = null;
  private hoverId: string | null = null;
  private pressedId: string | null = null;
  private widgets: Widget[] = [];
  private activeField: string | null = null;
  private loading: { text: string; fraction: number; source: 'assets' | 'api' } | null = null;
  private settings: MenuSettings;
  private servers: MenuServer[];
  private selectedServer: string;
  private serverScroll = 0;
  private serverView: { x: number; y: number; w: number; h: number; count: number; visible: number } | null = null;
  private worldName = 'New World';
  private worldSeed = '';
  private address = '';
  private formError = '';
  private dragging: { id: string; pointer: number } | null = null;
  private bgMode: 'none' | 'webgl' | '2d' = 'none';
  private glInfo: GLInfo | null = null;
  private strip: HTMLCanvasElement | null = null;
  private startCbs = new Set<(o: StartOptions) => void>();
  private connectCbs = new Set<(o: ConnectOptions) => void>();
  private quitCbs = new Set<(value?: void) => void>();
  private settingsCbs = new Set<(s: MenuSettings) => void>();
  constructor(root: HTMLElement, options: VanillaMenuOptions = {}) {
    this.doc = root.ownerDocument;
    this.settings = this.loadSettings();
    this.servers = this.loadServers();
    this.selectedServer = this.servers[0]?.address ?? '';
    this.overlay = this.doc.createElement('div');
    this.overlay.className = 'mc-menu';
    this.overlay.hidden = true;
    this.overlay.setAttribute('role', 'dialog');
    this.overlay.setAttribute('aria-label', 'Minecraft main menu');
    this.bgCanvas = this.doc.createElement('canvas');
    this.bgCanvas.className = 'mc-menu-bg';
    this.uiCanvas = this.doc.createElement('canvas');
    this.uiCanvas.className = 'mc-menu-ui';
    this.input = this.doc.createElement('input');
    this.input.className = 'mc-menu-input';
    this.input.type = 'text';
    this.input.autocomplete = 'off';
    this.input.spellcheck = false;
    this.input.setAttribute('autocapitalize', 'off');
    this.input.setAttribute('aria-label', 'Menu text field');
    this.overlay.append(this.bgCanvas, this.uiCanvas, this.input);
    root.append(this.overlay);
    const ctx = this.uiCanvas.getContext('2d');
    if (!ctx) throw new Error('A 2D canvas context is required for the menu');
    this.ui = ctx;
    this.loading = { text: 'Loading Minecraft', fraction: 0, source: 'assets' };
    this.bindEvents();
    void this.loadAll();
    if (options.autoOpen !== false) this.open();
  }
  open(): void {
    if (this.opened) return;
    this.opened = true;
    this.overlay.hidden = false;
    this.resize();
    if (this.assetsLoaded) this.initBackground();
    this.lastFrame = performance.now();
    this.dirty = true;
    this.raf = requestAnimationFrame(this.frame);
  }
  close(): void {
    if (!this.opened) return;
    this.opened = false;
    this.overlay.hidden = true;
    cancelAnimationFrame(this.raf);
    this.raf = 0;
    this.blurField();
    this.dragging = this.pressedId = this.hoverId = null;
  }
  isOpen(): boolean { return this.opened; }
  showLoading(text: string, fraction: number): void {
    this.loading = { text, fraction: Number.isFinite(fraction) ? clamp(fraction, 0, 1) : 0, source: 'api' };
    this.dirty = true;
  }
  hideLoading(): void { this.loading = null; this.dirty = true; }
  getSettings(): MenuSettings { return { ...this.settings }; }
  onStart(cb: (o: StartOptions) => void): () => void { this.startCbs.add(cb); return () => { this.startCbs.delete(cb); }; }
  onConnect(cb: (o: ConnectOptions) => void): () => void { this.connectCbs.add(cb); return () => { this.connectCbs.delete(cb); }; }
  onQuit(cb: () => void): () => void { this.quitCbs.add(cb); return () => { this.quitCbs.delete(cb); }; }
  onSettingsChange(cb: (s: MenuSettings) => void): () => void { this.settingsCbs.add(cb); return () => { this.settingsCbs.delete(cb); }; }
  private async loadAll(): Promise<void> {
    try {
      const assets = await loadMenuAssets((fraction, label) => {
        if (this.loading?.source === 'assets') {
          this.loading = { text: label, fraction: clamp(fraction, 0, 1), source: 'assets' };
          this.dirty = true;
        }
      });
      this.font = assets.font;
      this.faces = assets.panorama;
      this.splash = assets.splashes[Math.floor(Math.random() * assets.splashes.length)] ?? 'Minecraft!';
    } catch (err) { console.warn('Menu assets could not be loaded:', err); }
    await Promise.all((Object.keys(IMG_URLS) as ImgKey[]).map(key => new Promise<void>(resolve => {
      const img = new Image();
      img.onload = () => { this.imgs[key] = img; resolve(); };
      img.onerror = () => resolve();
      img.src = IMG_URLS[key];
    })));
    this.assetsLoaded = true;
    if (this.loading?.source === 'assets') this.loading = null;
    if (this.opened) this.initBackground();
    this.resizeBackground();
    this.dirty = true;
  }
  private loadSettings(): MenuSettings {
    const raw = readJSON(SETTINGS_KEY, {}) as Record<string, unknown>;
    if (!raw || typeof raw !== 'object') return { ...DEFAULT_SETTINGS };
    return {
      quality: pick(raw.quality, QUALITIES, DEFAULT_SETTINGS.quality),
      renderDistance: integer(raw.renderDistance, 4, 16, 8),
      fov: integer(raw.fov, 30, 110, 70),
      filtering: integer(raw.filtering, 0, 2, 0) as PixelFiltering,
      shaders: typeof raw.shaders === 'boolean' ? raw.shaders : true,
      touch: pick(raw.touch, TOUCH_MODES, DEFAULT_SETTINGS.touch),
      volume: integer(raw.volume, 0, 100, 70),
    };
  }
  private loadServers(): MenuServer[] {
    const raw = readJSON(SERVERS_KEY, []);
    const result: MenuServer[] = [{ ...BUILTIN_SERVER }];
    const seen = new Set<string>([BUILTIN_SERVER.address]);
    if (!Array.isArray(raw)) return result;
    for (const item of raw) {
      if (!item || typeof item !== 'object') continue;
      const entry = item as Record<string, unknown>;
      const address = typeof entry.address === 'string' ? entry.address.trim().slice(0, 128) : '';
      if (!address || seen.has(address)) continue;
      const name = typeof entry.name === 'string' ? entry.name.trim().slice(0, 32) : '';
      seen.add(address);
      result.push({ name: name || addressName(address), address });
      if (result.length >= 40) break;
    }
    return result;
  }
  private patchSettings(patch: Partial<MenuSettings>): void {
    let changed = false;
    for (const key of Object.keys(patch) as (keyof MenuSettings)[]) {
      if (this.settings[key] !== patch[key]) changed = true;
    }
    if (!changed) return;
    this.settings = { ...this.settings, ...patch };
    writeJSON(SETTINGS_KEY, this.settings);
    this.notify(this.settingsCbs, this.getSettings());
    this.dirty = true;
  }
  private notify<T>(callbacks: Set<(value: T) => void>, value: T): void {
    for (const cb of [...callbacks]) { try { cb(value); } catch (err) { console.error(err); } }
  }
  private initBackground(): void {
    if (this.bgMode !== 'none') return;
    if (this.faces.some(Boolean) && this.initGL()) this.bgMode = 'webgl';
    else {
      this.bgMode = '2d';
      this.bgCanvas.style.display = 'none';
      this.buildStrip();
    }
    this.resizeBackground();
  }
  private initGL(): boolean {
    const gl = this.bgCanvas.getContext('webgl2', {
      alpha: false, antialias: false, depth: false, stencil: false, powerPreference: 'low-power',
    });
    if (!gl) return false;
    const shader = (type: number, source: string): WebGLShader | null => {
      const s = gl.createShader(type);
      if (!s) return null;
      gl.shaderSource(s, source); gl.compileShader(s);
      if (!gl.getShaderParameter(s, gl.COMPILE_STATUS)) { console.warn(gl.getShaderInfoLog(s)); return null; }
      return s;
    };
    const vs = shader(gl.VERTEX_SHADER, VS), fs = shader(gl.FRAGMENT_SHADER, FS);
    const program = vs && fs ? gl.createProgram() : null;
    if (!program || !vs || !fs) return false;
    gl.attachShader(program, vs); gl.attachShader(program, fs); gl.linkProgram(program);
    if (!gl.getProgramParameter(program, gl.LINK_STATUS)) return false;
    const first = this.faces.find((face): face is ImageBitmap => Boolean(face));
    if (!first) return false;
    const size = Math.min(1024, Math.max(2, first.width));
    const solid = this.doc.createElement('canvas');
    solid.width = solid.height = size;
    const sc = solid.getContext('2d');
    if (!sc) return false;
    sc.fillStyle = '#252a1d'; sc.fillRect(0, 0, size, size);
    sc.fillStyle = 'rgba(255,255,255,0.05)'; sc.fillRect(0, 0, size, size * 0.42);
    sc.fillStyle = 'rgba(0,0,0,0.2)'; sc.fillRect(0, size * 0.62, size, size * 0.38);
    const texture = gl.createTexture();
    if (!texture) return false;
    gl.bindTexture(gl.TEXTURE_CUBE_MAP, texture);
    gl.pixelStorei(gl.UNPACK_FLIP_Y_WEBGL, false);
    // Minecraft's front, right, back, left, up, down map to +X, -X, +Y, -Y, +Z, -Z.
    const order = [1, 3, 4, 5, 2, 0];
    for (let i = 0; i < 6; i++) {
      gl.texImage2D(gl.TEXTURE_CUBE_MAP_POSITIVE_X + i, 0, gl.RGBA, gl.RGBA, gl.UNSIGNED_BYTE,
        this.faces[order[i]] ?? solid);
    }
    gl.texParameteri(gl.TEXTURE_CUBE_MAP, gl.TEXTURE_MIN_FILTER, gl.LINEAR_MIPMAP_LINEAR);
    gl.texParameteri(gl.TEXTURE_CUBE_MAP, gl.TEXTURE_MAG_FILTER, gl.LINEAR);
    gl.texParameteri(gl.TEXTURE_CUBE_MAP, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
    gl.texParameteri(gl.TEXTURE_CUBE_MAP, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
    gl.generateMipmap(gl.TEXTURE_CUBE_MAP);
    gl.useProgram(program);
    gl.uniform1i(gl.getUniformLocation(program, 'uCube'), 0);
    gl.clearColor(0.025, 0.035, 0.025, 1);
    gl.disable(gl.DEPTH_TEST); gl.disable(gl.CULL_FACE);
    this.glInfo = {
      gl, program, cube: texture, res: gl.getUniformLocation(program, 'uRes'),
      yaw: gl.getUniformLocation(program, 'uYaw'),
    };
    return true;
  }
  private buildStrip(): void {
    if (!this.faces.some(Boolean)) return;
    const canvas = this.doc.createElement('canvas');
    canvas.width = 1024; canvas.height = 256;
    const ctx = canvas.getContext('2d');
    if (!ctx) return;
    for (let i = 0; i < 4; i++) {
      const face = this.faces[i];
      if (face) ctx.drawImage(face, i * 256, 0, 256, 256);
      else { ctx.fillStyle = '#11140e'; ctx.fillRect(i * 256, 0, 256, 256); }
    }
    this.strip = canvas;
  }
  private resize(): void {
    if (!this.opened) return;
    const rect = this.overlay.getBoundingClientRect();
    this.cssW = Math.max(1, rect.width);
    this.cssH = Math.max(1, rect.height);
    this.dpr = Math.min(2, this.doc.defaultView?.devicePixelRatio || 1);
    this.scale = clamp(Math.floor(Math.min(this.cssW / 320, this.cssH / 240)), 2, 4);
    this.uiCanvas.width = Math.max(1, Math.round(this.cssW * this.dpr));
    this.uiCanvas.height = Math.max(1, Math.round(this.cssH * this.dpr));
    this.resizeBackground();
    this.dirty = true;
  }
  private resizeBackground(): void {
    if (!this.opened) return;
    this.bgCanvas.width = Math.max(1, Math.round(this.cssW));
    this.bgCanvas.height = Math.max(1, Math.round(this.cssH));
    this.glInfo?.gl.viewport(0, 0, this.bgCanvas.width, this.bgCanvas.height);
  }
  private frame = (now: number): void => {
    if (!this.opened) return;
    const dt = Math.min(100, Math.max(0, now - this.lastFrame));
    this.lastFrame = now;
    this.animTime += dt;
    this.drawBackground(this.animTime);
    if (this.dirty || now - this.lastUi >= 33) {
      this.drawUI(this.animTime);
      this.lastUi = now;
      this.dirty = false;
    }
    this.raf = requestAnimationFrame(this.frame);
  };
  private drawBackground(time: number): void {
    const info = this.glInfo;
    if (this.bgMode !== 'webgl' || !info) return;
    const { gl } = info;
    gl.useProgram(info.program);
    gl.bindTexture(gl.TEXTURE_CUBE_MAP, info.cube);
    if (info.res) gl.uniform2f(info.res, gl.drawingBufferWidth, gl.drawingBufferHeight);
    if (info.yaw) gl.uniform1f(info.yaw, 0.45 + time * 0.00010472);
    gl.drawArrays(gl.TRIANGLES, 0, 3);
  }
  private drawPan(c: CanvasRenderingContext2D, time: number): void {
    const w = this.vw, h = this.vh;
    c.fillStyle = '#090c09';
    c.fillRect(0, 0, w, h);
    if (this.strip) {
      const faceW = Math.max(w * 0.55, h * 0.9);
      const dw = faceW * 4;
      const shift = (time * 0.004) % dw;
      c.save();
      c.imageSmoothingEnabled = true;
      for (let x = shift - dw; x < w; x += dw) c.drawImage(this.strip, x, (h - faceW) / 2, dw, faceW);
      c.restore();
      const shade = c.createLinearGradient(0, 0, 0, h);
      shade.addColorStop(0, 'rgba(3,7,10,0.58)');
      shade.addColorStop(0.55, 'rgba(0,0,0,0.18)');
      shade.addColorStop(1, 'rgba(0,0,0,0.72)');
      c.fillStyle = shade; c.fillRect(0, 0, w, h);
    } else {
      const sky = c.createLinearGradient(0, 0, 0, h);
      sky.addColorStop(0, '#101b20'); sky.addColorStop(0.58, '#152019'); sky.addColorStop(1, '#080b07');
      c.fillStyle = sky; c.fillRect(0, 0, w, h);
      c.fillStyle = 'rgba(0,0,0,0.3)'; c.fillRect(0, h * 0.58, w, h * 0.42);
    }
  }
  private get vw(): number { return this.cssW / this.scale; }
  private get vh(): number { return this.cssH / this.scale; }
  private get narrow(): boolean { return this.vw < 300; }
  private get compact(): boolean { return this.vh < 220; }
  private get bh(): number { return this.scale === 2 ? 24 : 20; }
  private get footerTop(): number { return this.vh - (this.narrow ? 26 : 24); }
  private textWidth(text: string): number { return this.font ? this.font.width(text) : text.length * 6; }
  private line(
    c: CanvasRenderingContext2D, text: string, x: number, y: number,
    color = '#ffffff', size = 1, align: 'left' | 'center' | 'right' = 'left',
  ): void {
    if (this.font) {
      const width = this.font.width(text) * size;
      const drawX = align === 'center' ? x - width / 2 : align === 'right' ? x - width : x;
      if (size === 1) this.font.draw(c, text, drawX, y, color, true);
      else {
        c.save(); c.translate(Math.round(drawX), Math.round(y)); c.scale(size, size);
        this.font.draw(c, text, 0, 0, color, true); c.restore();
      }
      return;
    }
    c.save();
    c.font = `${8 * size}px "Courier New", monospace`;
    c.textAlign = align; c.textBaseline = 'top';
    c.fillStyle = 'rgba(0,0,0,0.65)'; c.fillText(text, x + 1, y + 1);
    c.fillStyle = color; c.fillText(text, x, y);
    c.restore();
  }
  private heading(c: CanvasRenderingContext2D, title: string): void {
    const size = this.textWidth(title) * 2 <= this.vw - 20 ? 2 : 1;
    this.line(c, title, this.vw / 2, this.compact ? 8 : 14, '#ffffff', size, 'center');
  }
  private footer(c: CanvasRenderingContext2D): void {
    const left = 'Minecraft 26.2 / Web Edition';
    const note = 'Unofficial fan recreation';
    const share = !this.narrow && this.textWidth(left) + this.textWidth(note) + 24 <= this.vw;
    if (share) {
      this.line(c, left, 6, this.vh - 14, '#d8d8d8');
      this.line(c, note, this.vw - 6, this.vh - 14, '#a8a8a8', 1, 'right');
    } else {
      this.line(c, note, this.vw - 6, this.vh - 21, '#a8a8a8', 1, 'right');
      this.line(c, left, 6, this.vh - 9, '#d8d8d8');
    }
  }
  private panel(c: CanvasRenderingContext2D, x: number, y: number, w: number, h: number): void {
    c.fillStyle = 'rgba(0,0,0,0.45)'; c.fillRect(x, y, w, h);
    c.strokeStyle = 'rgba(255,255,255,0.4)'; c.lineWidth = 1;
    c.strokeRect(x + 0.5, y + 0.5, w - 1, h - 1);
  }
  private drawLoading(c: CanvasRenderingContext2D): void {
    if (!this.loading) return;
    const w = this.vw, h = this.vh, pw = Math.min(300, w - 24), ph = 64;
    const x = Math.round((w - pw) / 2), y = Math.round((h - ph) / 2);
    c.fillStyle = 'rgba(0,0,0,0.55)'; c.fillRect(0, 0, w, h);
    if (this.imgs.dirt) {
      const pattern = c.createPattern(this.imgs.dirt, 'repeat');
      if (pattern) { c.fillStyle = pattern; c.fillRect(x, y, pw, ph); }
    } else { c.fillStyle = '#4a4136'; c.fillRect(x, y, pw, ph); }
    c.fillStyle = 'rgba(12,10,8,0.5)'; c.fillRect(x, y, pw, ph);
    c.strokeStyle = '#080808'; c.lineWidth = 2; c.strokeRect(x + 1, y + 1, pw - 2, ph - 2);
    c.strokeStyle = 'rgba(255,255,255,0.22)'; c.lineWidth = 1; c.strokeRect(x + 3.5, y + 3.5, pw - 7, ph - 7);
    const text = this.loading.text.length > 42 ? `${this.loading.text.slice(0, 42)}...` : this.loading.text;
    this.line(c, text, x + pw / 2, y + 16, '#ffffff', 1, 'center');
    const barW = pw - 32, barH = 10, bx = x + 16, by = y + ph - 24;
    c.fillStyle = '#080808'; c.fillRect(bx - 2, by - 2, barW + 4, barH + 4);
    c.fillStyle = '#3c3c3c'; c.fillRect(bx, by, barW, barH);
    c.fillStyle = '#6cbe49'; c.fillRect(bx, by, Math.round(barW * clamp(this.loading.fraction, 0, 1)), barH);
    c.fillStyle = 'rgba(255,255,255,0.15)'; c.fillRect(bx, by, barW, 2);
  }
  private buildLayout(): Layout {
    switch (this.screen) {
      case 'single': return this.layoutSingle();
      case 'create': return this.layoutCreate();
      case 'multi': return this.layoutMulti();
      case 'add': return this.layoutAddress('Add Server', () => this.addServer());
      case 'direct': return this.layoutAddress('Connect', () => this.connectDirect());
      case 'options': return this.layoutOptions();
      default: return this.layoutMain();
    }
  }
  private drawUI(time: number): void {
    const c = this.ui;
    c.setTransform(this.dpr * this.scale, 0, 0, this.dpr * this.scale, 0, 0);
    c.imageSmoothingEnabled = false;
    c.clearRect(0, 0, this.vw, this.vh);
    if (this.bgMode !== 'webgl') this.drawPan(c, time);
    else {
      const shade = c.createLinearGradient(0, 0, 0, this.vh);
      shade.addColorStop(0, 'rgba(0,0,0,0.14)');
      shade.addColorStop(0.65, 'rgba(0,0,0,0.02)');
      shade.addColorStop(1, 'rgba(0,0,0,0.42)');
      c.fillStyle = shade; c.fillRect(0, 0, this.vw, this.vh);
    }
    if (this.screen !== 'main') { c.fillStyle = 'rgba(6,10,7,0.5)'; c.fillRect(0, 0, this.vw, this.vh); }
    const titles: Record<Screen, string> = {
      main: '', single: 'Singleplayer', create: 'Create New World', multi: 'Multiplayer',
      add: 'Add Server', direct: 'Direct Connect', options: 'Options',
    };
    if (titles[this.screen]) this.heading(c, titles[this.screen]);
    const layout = this.buildLayout();
    this.widgets = layout.widgets;
    layout.decor(c, time);
    for (const widget of this.widgets) this.drawWidget(c, widget, time);
    this.footer(c);
    if (this.loading) this.drawLoading(c);
  }
  private frameInfo(): { top: number; colW: number } {
    const headingY = this.compact ? 8 : 14;
    return { top: headingY + (this.compact ? 18 : 20), colW: Math.floor(Math.min(300, this.vw - 24)) };
  }
  private button(
    id: string, label: string, x: number, y: number, w: number, h: number, act: () => void, disabled = false,
  ): Widget { return { id, kind: 'button', label, x, y, w, h, act, disabled }; }
  private bottom(x: number, w: number, defs: Array<[string, string, () => void, boolean?]>): Widget[] {
    const n = defs.length, bh = this.bh, gap = 4;
    return defs.map(([id, label, act, off], i) =>
      this.button(id, label, x, Math.round(this.footerTop - 8 - (n - i) * bh - (n - 1 - i) * gap), w, bh, act, !!off));
  }
  private layoutMain(): Layout {
    const vw = this.vw, gap = this.compact ? 3 : 4, bh = this.bh;
    const bw = Math.floor(Math.min(200, vw - 24));
    const logoW = Math.min(this.compact ? 170 : 256, vw - 16), logoH = logoW / 4;
    const logoX = Math.round((vw - logoW) / 2);
    const total = logoH + (this.compact ? 8 : 12) + bh * 4 + gap * 3;
    const logoY = Math.round(Math.max(this.compact ? 4 : 10, Math.min(
      (this.footerTop - 8 - total) * 0.42, this.footerTop - 8 - total,
    )));
    const stackTop = Math.round(logoY + logoH + (this.compact ? 8 : 12));
    const x = Math.round((vw - bw) / 2);
    const line = (i: number) => Math.round(stackTop + i * (bh + gap));
    const widgets = [
      this.button('main.single', 'Singleplayer', x, line(0), bw, bh, () => this.go('single')),
      this.button('main.multi', 'Multiplayer', x, line(1), bw, bh, () => this.go('multi')),
      this.button('main.options', 'Options...', x, line(2), bw, bh, () => this.go('options')),
      this.button('main.quit', 'Quit Game', x, line(3), bw, bh, () => this.quit()),
    ];
    const decor = (c: CanvasRenderingContext2D, time: number): void => {
      if (this.imgs.logo) {
        c.save(); c.imageSmoothingEnabled = true;
        c.drawImage(this.imgs.logo, logoX, Math.round(logoY), Math.round(logoW), Math.round(logoH));
        c.restore();
      } else this.line(c, 'MINECRAFT', vw / 2, logoY + logoH / 2 - 12, '#ffffff', 3, 'center');
      if (this.splash) {
        const pulse = 1 + Math.sin(time * 0.005) * 0.04;
        c.save();
        c.translate(logoX + logoW - 2, logoY + logoH - 3);
        c.rotate(-0.3 + Math.sin(time * 0.0018) * 0.03);
        c.scale(pulse, pulse);
        this.line(c, this.splash, -5, -11, '#ffff3f', 1, 'right');
        c.restore();
      }
    };
    return { widgets, decor };
  }
  private layoutSingle(): Layout {
    const { top, colW } = this.frameInfo(), x = Math.round((this.vw - colW) / 2);
    const widgets = this.bottom(x, colW, [
      ['single.play', 'Play Selected World', () => this.notify(this.startCbs, {
        name: DEFAULT_WORLD.name, seed: DEFAULT_WORLD.seed, mode: 'survival',
      })],
      ['single.create', 'Create New World', () => this.go('create')],
      ['single.back', 'Back', () => this.back()],
    ]);
    const cardY = top, cardH = Math.max(32, Math.min(84, widgets[0].y - 12 - cardY));
    const decor = (c: CanvasRenderingContext2D): void => {
      this.panel(c, x, cardY, colW, cardH);
      this.line(c, 'World', x + 10, cardY + cardH / 2 - (colW > 260 ? 16 : 10), '#ffffff', colW > 260 ? 2 : 1);
      this.line(c, `Seed: ${DEFAULT_WORLD.seed}`, x + 10, cardY + cardH / 2 + 4, '#b8b8b8');
    };
    return { widgets, decor };
  }
  private layoutCreate(): Layout {
    const { top, colW } = this.frameInfo(), x = Math.round((this.vw - colW) / 2), bh = this.bh;
    const nameY = Math.round(top + 11), seedLabelY = Math.round(nameY + bh + 8), seedY = Math.round(seedLabelY + 11);
    const submit = (): void => this.createWorld();
    const widgets = [
      this.field('form.name', 'World Name', x, nameY, colW, bh, {
        get: () => this.worldName,
        set: v => { this.worldName = v.slice(0, 32); this.dirty = true; },
        placeholder: 'New World', submit, maxLength: 32,
      }),
      this.field('form.seed', 'Seed', x, seedY, colW, bh, {
        get: () => this.worldSeed,
        set: v => { this.worldSeed = v.slice(0, 32); this.dirty = true; },
        placeholder: 'Leave blank for random', submit, maxLength: 32,
      }),
      ...this.bottom(x, colW, [['create.create', 'Create World', submit], ['create.cancel', 'Cancel', () => this.back()]]),
    ];
    const decor = (c: CanvasRenderingContext2D): void => {
      this.line(c, 'World Name', x, top, '#b8b8b8');
      this.line(c, 'Seed (optional)', x, seedLabelY, '#b8b8b8');
    };
    return { widgets, decor };
  }
  private layoutMulti(): Layout {
    const { top, colW } = this.frameInfo(), x = Math.round((this.vw - colW) / 2), bh = this.bh, gap = 4;
    let widgets: Widget[], listBottom: number;
    if (this.vw >= 300) {
      const backY = Math.round(this.footerTop - 8 - bh), secondY = Math.round(backY - bh - gap);
      const bw = Math.floor((colW - gap * 2) / 3);
      widgets = [
        this.button('multi.join', 'Join Server', x, secondY, bw, bh, () => this.joinSelected(), !this.selectedServer),
        this.button('multi.direct', 'Direct Connect', x + bw + gap, secondY, bw, bh, () => this.go('direct')),
        this.button('multi.add', 'Add Server', x + (bw + gap) * 2, secondY, colW - (bw + gap) * 2, bh, () => this.go('add')),
        this.button('multi.back', 'Back', x, backY, colW, bh, () => this.back()),
      ];
      listBottom = secondY - 8;
    } else {
      widgets = this.bottom(x, colW, [
        ['multi.join', 'Join Server', () => this.joinSelected(), !this.selectedServer],
        ['multi.direct', 'Direct Connect', () => this.go('direct')],
        ['multi.add', 'Add Server', () => this.go('add')],
        ['multi.back', 'Back', () => this.back()],
      ]);
      listBottom = widgets[0].y - 8;
    }
    const listH = Math.max(26, listBottom - top);
    const rowH = this.scale === 2 ? 30 : 26, rowGap = 2;
    const visible = Math.max(1, Math.floor((listH - 8 + rowGap) / (rowH + rowGap)));
    const maxScroll = Math.max(0, this.servers.length - visible);
    this.serverScroll = clamp(this.serverScroll, 0, maxScroll);
    this.serverView = { x, y: top, w: colW, h: listH, count: this.servers.length, visible };
    for (let i = 0; i < visible; i++) {
      const server = this.servers[this.serverScroll + i];
      if (!server) break;
      widgets.unshift({
        id: `server:${server.address}`, kind: 'server',
        x: x + 4, y: top + 4 + i * (rowH + rowGap), w: colW - 8, h: rowH,
        label: server.name, detail: server.address, selected: server.address === this.selectedServer,
        act: () => { this.selectedServer = server.address; this.dirty = true; },
      });
    }
    const decor = (c: CanvasRenderingContext2D): void => {
      this.panel(c, x, top, colW, listH);
      if (this.servers.length <= visible) return;
      const trackY = top + 5, trackH = listH - 10;
      const thumbH = Math.max(10, Math.round((visible / this.servers.length) * trackH));
      const thumbY = trackY + Math.round((this.serverScroll / Math.max(1, maxScroll)) * (trackH - thumbH));
      c.fillStyle = 'rgba(0,0,0,0.6)'; c.fillRect(x + colW - 6, trackY, 3, trackH);
      c.fillStyle = 'rgba(220,220,220,0.55)'; c.fillRect(x + colW - 6, thumbY, 3, thumbH);
    };
    return { widgets, decor };
  }
  private layoutAddress(primary: string, submit: () => void): Layout {
    const { top, colW } = this.frameInfo(), x = Math.round((this.vw - colW) / 2), bh = this.bh;
    const fieldY = Math.round(top + 11), hintY = Math.round(fieldY + bh + 4);
    const widgets = [
      this.field('form.address', 'Server Address', x, fieldY, colW, bh, {
        get: () => this.address,
        set: v => { this.address = v.slice(0, 128); this.formError = ''; this.dirty = true; },
        placeholder: 'ws://host:port', submit, maxLength: 128,
      }),
      ...this.bottom(x, colW, [['address.primary', primary, submit], ['address.cancel', 'Cancel', () => this.back()]]),
    ];
    const decor = (c: CanvasRenderingContext2D): void => {
      this.line(c, 'Server Address', x, top, '#b8b8b8');
      this.line(c, this.formError || 'Example: ws://127.0.0.1:8765', x, hintY,
        this.formError ? '#ff6a6a' : '#8f8f8f');
    };
    return { widgets, decor };
  }
  private layoutOptions(): Layout {
    const { top } = this.frameInfo(), vw = this.vw, gap = 3, rowH = this.bh;
    const wide = vw >= 300;
    const totalW = Math.floor(Math.min(wide ? 380 : 300, vw - 24));
    const colW = wide ? Math.floor((totalW - gap) / 2) : totalW;
    const x0 = Math.round((vw - totalW) / 2);
    const widgets: Widget[] = [];
    const add = (i: number, make: (x: number, y: number, w: number) => Widget): void => {
      widgets.push(make(Math.round(x0 + (wide ? Math.floor(i / 4) : 0) * (colW + gap)),
        Math.round(top + (wide ? i % 4 : i) * (rowH + gap)), colW));
    };
    const cycleQuality = () => this.patchSettings({ quality: step(QUALITIES, this.settings.quality) });
    const cycleFilter = () => this.patchSettings({ filtering: step([0, 1, 2] as const, this.settings.filtering) as PixelFiltering });
    const cycleTouch = () => this.patchSettings({ touch: step(TOUCH_MODES, this.settings.touch) });
    const shaders = () => this.patchSettings({ shaders: !this.settings.shaders });
    add(0, (x, y, w) => this.button('opt.quality', `Quality: ${cap(this.settings.quality)}`, x, y, w, rowH, cycleQuality));
    add(1, (x, y, w) => this.slider('opt.rd', `Render Distance: ${this.settings.renderDistance}`, x, y, w, rowH,
      this.settings.renderDistance, 4, 16, v => this.patchSettings({ renderDistance: v })));
    add(2, (x, y, w) => this.slider('opt.fov', `FOV: ${this.settings.fov}`, x, y, w, rowH,
      this.settings.fov, 30, 110, v => this.patchSettings({ fov: v })));
    add(3, (x, y, w) => this.button('opt.filter', `Pixel Filtering: ${FILTERING_NAMES[this.settings.filtering]}`, x, y, w, rowH, cycleFilter));
    add(4, (x, y, w) => this.button('opt.shaders', `Shader Effects: ${this.settings.shaders ? 'On' : 'Off'}`, x, y, w, rowH, shaders));
    add(5, (x, y, w) => this.button('opt.touch', `Touch Controls: ${cap(this.settings.touch)}`, x, y, w, rowH, cycleTouch));
    add(6, (x, y, w) => this.slider('opt.volume', `Master Volume: ${this.settings.volume}%`, x, y, w, rowH,
      this.settings.volume, 0, 100, v => this.patchSettings({ volume: v })));
    add(7, (x, y, w) => this.button('opt.done', 'Done', x, y, w, rowH, () => this.back()));
    return { widgets, decor: () => {} };
  }
  private slider(
    id: string, label: string, x: number, y: number, w: number, h: number,
    value: number, min: number, max: number, set: (value: number) => void,
  ): Widget { return { id, kind: 'slider', label, x, y, w, h, value, min, max, set }; }
  private field(id: string, label: string, x: number, y: number, w: number, h: number, hooks: FieldHooks): Widget {
    return { id, kind: 'field', label, x, y, w, h, field: hooks };
  }
  private drawWidget(c: CanvasRenderingContext2D, w: Widget, time: number): void {
    const focused = this.focusId === w.id, hot = this.hoverId === w.id || focused, mid = w.y + (w.h - 8) / 2;
    if (w.kind === 'button') {
      this.nine(c, w.disabled ? this.imgs.buttonOff : hot ? this.imgs.buttonHl : this.imgs.button,
        w.x, w.y, w.w, w.h, 3, '#3b3b3b');
      this.line(c, w.label, w.x + w.w / 2, mid, w.disabled ? '#9a9a9a' : '#ffffff', 1, 'center');
    } else if (w.kind === 'slider') {
      this.nine(c, hot ? this.imgs.sliderHl : this.imgs.slider, w.x, w.y, w.w, w.h, 1, '#222222');
      const ratio = clamp(((w.value ?? 0) - (w.min ?? 0)) / Math.max(1, (w.max ?? 1) - (w.min ?? 0)), 0, 1);
      this.nine(c, hot ? this.imgs.handleHl : this.imgs.handle, Math.round(w.x + ratio * (w.w - 8)), w.y, 8, w.h, [2, 2, 2, 3], '#777777');
      this.line(c, w.label, w.x + w.w / 2, mid, '#ffffff', 1, 'center');
    } else if (w.kind === 'field') {
      const active = this.activeField === w.id;
      this.nine(c, active || focused ? this.imgs.fieldHl : this.imgs.field, w.x, w.y, w.w, w.h, 1, '#101010');
      if (!w.field) return;
      const value = w.field.get(), shown = value || (active ? '' : w.field.placeholder);
      const width = this.textWidth(shown), textX = width > w.w - 10 ? w.x + w.w - 5 - width : w.x + 5;
      c.save(); c.beginPath(); c.rect(w.x + 3, w.y + 2, w.w - 6, w.h - 4); c.clip();
      this.line(c, shown, textX, mid, value ? '#ffffff' : active ? '#bbbbbb' : '#808080');
      if (active && Math.floor(time / 500) % 2 === 0) {
        c.fillStyle = '#ffffff';
        c.fillRect(Math.round(textX + width + 1), Math.round(mid), 1, 8);
      }
      c.restore();
    } else {
      c.fillStyle = w.selected ? 'rgba(67,89,46,0.9)' : hot ? 'rgba(255,255,255,0.15)' : 'rgba(0,0,0,0.35)';
      c.fillRect(w.x, w.y, w.w, w.h);
      c.strokeStyle = w.selected ? 'rgba(255,255,255,0.9)' : 'rgba(255,255,255,0.2)';
      c.lineWidth = 1; c.strokeRect(w.x + 0.5, w.y + 0.5, w.w - 1, w.h - 1);
      const textY = w.y + Math.round((w.h - 18) / 2);
      c.save(); c.beginPath(); c.rect(w.x + 4, w.y, w.w - 8, w.h); c.clip();
      this.line(c, w.label, w.x + 6, textY, '#ffffff');
      this.line(c, w.detail ?? '', w.x + 6, textY + 10, '#b4b4b4');
      c.restore();
    }
    if (focused) {
      c.strokeStyle = 'rgba(255,255,255,0.95)'; c.lineWidth = 1;
      c.strokeRect(w.x - 2.5, w.y - 2.5, w.w + 5, w.h + 5);
    }
  }
  private nine(
    c: CanvasRenderingContext2D, image: HTMLImageElement | undefined,
    x: number, y: number, w: number, h: number, border: Border, fallback: string,
  ): void {
    if (!image) {
      c.fillStyle = fallback; c.fillRect(x, y, w, h);
      c.strokeStyle = 'rgba(255,255,255,0.35)'; c.lineWidth = 1;
      c.strokeRect(x + 0.5, y + 0.5, w - 1, h - 1);
      return;
    }
    const [l, t, r, b] = typeof border === 'number' ? [border, border, border, border] : border;
    if (w < l + r || h < t + b) { c.drawImage(image, x, y, w, h); return; }
    const iw = image.width, ih = image.height, sw = iw - l - r, sh = ih - t - b;
    c.drawImage(image, 0, 0, l, t, x, y, l, t);
    c.drawImage(image, iw - r, 0, r, t, x + w - r, y, r, t);
    c.drawImage(image, 0, ih - b, l, b, x, y + h - b, l, b);
    c.drawImage(image, iw - r, ih - b, r, b, x + w - r, y + h - b, r, b);
    c.drawImage(image, l, 0, sw, t, x + l, y, w - l - r, t);
    c.drawImage(image, l, ih - b, sw, b, x + l, y + h - b, w - l - r, b);
    c.drawImage(image, 0, t, l, sh, x, y + t, l, h - t - b);
    c.drawImage(image, iw - r, t, r, sh, x + w - r, y + t, r, h - t - b);
    c.drawImage(image, l, t, sw, sh, x + l, y + t, w - l - r, h - t - b);
  }
  private toMenu(e: PointerEvent): { x: number; y: number } {
    const rect = this.uiCanvas.getBoundingClientRect();
    return { x: (e.clientX - rect.left) / this.scale, y: (e.clientY - rect.top) / this.scale };
  }
  private hit(x: number, y: number): Widget | null {
    for (let i = this.widgets.length - 1; i >= 0; i--) {
      const w = this.widgets[i];
      if (x >= w.x && x <= w.x + w.w && y >= w.y && y <= w.y + w.h) return w;
    }
    return null;
  }
  private updateSlider(w: Widget, x: number): void {
    if (w.kind !== 'slider' || !w.set || w.min == null || w.max == null) return;
    const ratio = clamp((x - w.x - 4) / Math.max(1, w.w - 8), 0, 1);
    const value = Math.round(w.min + ratio * (w.max - w.min));
    if (value === w.value) return;
    w.value = value;
    w.set(value);
    this.dirty = true;
  }
  private activate(w: Widget | null): void {
    if (!w || w.disabled) return;
    if (w.kind === 'field') this.beginEdit(w);
    else w.act?.();
  }
  private bindEvents(): void {
    this.doc.addEventListener('keydown', this.onKey, true);
    this.doc.defaultView?.addEventListener('resize', () => { if (this.opened) this.resize(); });
    this.uiCanvas.addEventListener('pointerdown', this.onPointerDown);
    this.uiCanvas.addEventListener('pointermove', this.onPointerMove);
    this.uiCanvas.addEventListener('pointerup', this.onPointerUp);
    this.uiCanvas.addEventListener('pointercancel', this.onPointerCancel);
    this.uiCanvas.addEventListener('pointerleave', this.onPointerLeave);
    this.uiCanvas.addEventListener('wheel', this.onWheel, { passive: false });
    this.input.addEventListener('input', this.onInput);
    this.input.addEventListener('blur', () => { if (this.activeField) { this.activeField = null; this.dirty = true; } });
  }
  private onKey = (e: KeyboardEvent): void => {
    if (!this.opened) return;
    if (this.doc.activeElement === this.input) {
      if (e.key === 'Escape') { e.preventDefault(); this.blurField(); }
      else if (e.key === 'Enter') { e.preventDefault(); this.submitActiveField(); }
      else if (e.key === 'Tab') { e.preventDefault(); this.blurField(); this.moveFocus(e.shiftKey ? -1 : 1); }
      return;
    }
    if (e.key === 'Escape') { e.preventDefault(); this.back(); }
    else if (e.key === 'Tab') { e.preventDefault(); this.moveFocus(e.shiftKey ? -1 : 1); }
    else if (e.key === 'Enter' || e.key === ' ') {
      const w = this.widgets.find(widget => widget.id === this.focusId);
      if (w && w.kind !== 'slider') { e.preventDefault(); this.activate(w); }
    }
  };
  private onPointerDown = (e: PointerEvent): void => {
    if (!this.opened || (e.button !== undefined && e.button !== 0)) return;
    const point = this.toMenu(e), w = this.hit(point.x, point.y);
    if (!w) {
      this.blurField(); this.focusId = null; this.hoverId = null; this.pressedId = null; this.dirty = true;
      return;
    }
    this.focusId = w.id; this.hoverId = w.id;
    if (w.kind === 'field') { this.beginEdit(w); e.preventDefault(); return; }
    this.blurField();
    if (w.kind === 'slider') {
      this.dragging = { id: w.id, pointer: e.pointerId };
      this.uiCanvas.setPointerCapture(e.pointerId);
      this.updateSlider(w, point.x);
    } else {
      this.pressedId = w.id;
      this.uiCanvas.setPointerCapture(e.pointerId);
      if (w.kind === 'server') { this.selectedServer = w.detail ?? this.selectedServer; this.dirty = true; }
    }
    e.preventDefault();
  };
  private onPointerMove = (e: PointerEvent): void => {
    if (!this.opened) return;
    const point = this.toMenu(e);
    if (this.dragging) {
      const w = this.widgets.find(widget => widget.id === this.dragging?.id);
      if (w) this.updateSlider(w, point.x);
      return;
    }
    const w = this.hit(point.x, point.y), id = w?.id ?? null;
    if (id !== this.hoverId) { this.hoverId = id; this.dirty = true; }
    this.uiCanvas.style.cursor = !w ? 'default' : w.kind === 'field' ? 'text' : w.kind === 'slider' ? 'ew-resize' : 'pointer';
  };
  private onPointerUp = (e: PointerEvent): void => {
    if (!this.opened) return;
    if (this.dragging && e.pointerId === this.dragging.pointer) { this.dragging = null; this.dirty = true; }
    if (this.pressedId) {
      const point = this.toMenu(e), w = this.hit(point.x, point.y), pressed = this.pressedId;
      this.pressedId = null;
      if (w && w.id === pressed) this.activate(w);
      if (e.pointerType !== 'mouse') this.hoverId = null;
      this.dirty = true;
    }
  };
  private onPointerCancel = (): void => { this.dragging = null; this.pressedId = null; this.dirty = true; };
  private onPointerLeave = (): void => {
    if (this.dragging) return;
    this.hoverId = null; this.dirty = true;
  };
  private onWheel = (e: WheelEvent): void => {
    if (!this.opened || this.screen !== 'multi' || !this.serverView) return;
    const rect = this.uiCanvas.getBoundingClientRect();
    const x = (e.clientX - rect.left) / this.scale, y = (e.clientY - rect.top) / this.scale, view = this.serverView;
    if (x < view.x || x > view.x + view.w || y < view.y || y > view.y + view.h || view.count <= view.visible) return;
    e.preventDefault();
    this.serverScroll = clamp(this.serverScroll + (e.deltaY > 0 ? 1 : -1), 0, view.count - view.visible);
    this.dirty = true;
  };
  private onInput = (): void => {
    if (!this.activeField) return;
    const w = this.widgets.find(widget => widget.id === this.activeField);
    if (!w?.field) return;
    const value = this.input.value.slice(0, w.field.maxLength);
    if (this.input.value !== value) this.input.value = value;
    w.field.set(value);
  };
  private beginEdit(w: Widget): void {
    if (!w.field) return;
    this.activeField = w.id; this.focusId = w.id;
    this.input.value = w.field.get();
    this.input.maxLength = w.field.maxLength;
    this.input.setAttribute('aria-label', w.label);
    this.input.focus({ preventScroll: true });
    this.input.setSelectionRange(this.input.value.length, this.input.value.length);
    this.dirty = true;
  }
  private blurField(): void {
    if (!this.activeField) return;
    this.activeField = null;
    if (this.doc.activeElement === this.input) this.input.blur();
    this.dirty = true;
  }
  private submitActiveField(): void {
    const w = this.widgets.find(widget => widget.id === this.activeField);
    const submit = w?.field?.submit;
    this.blurField();
    submit?.();
  }
  private moveFocus(dir: number): void {
    const list = this.widgets.filter(w => !w.disabled);
    if (!list.length) return;
    const current = list.findIndex(w => w.id === this.focusId);
    const index = current < 0 ? (dir > 0 ? 0 : list.length - 1) : (current + dir + list.length) % list.length;
    this.focusId = list[index].id;
    this.hoverId = null;
    this.dirty = true;
  }
  private show(next: Screen, push: boolean): void {
    this.blurField();
    if (push) this.stack.push(this.screen);
    this.screen = next;
    this.hoverId = null; this.pressedId = null; this.dragging = null; this.formError = '';
    if (next === 'create') { this.worldName = 'New World'; this.worldSeed = ''; }
    if (next === 'add' || next === 'direct') this.address = '';
    this.widgets = this.buildLayout().widgets;
    const first = this.widgets.find(w => !w.disabled && w.kind !== 'field' && w.kind !== 'server')
      ?? this.widgets.find(w => !w.disabled);
    this.focusId = first?.id ?? null;
    this.dirty = true;
  }
  private go(next: Screen): void { this.show(next, true); }
  private back(): void {
    if (!this.stack.length) return;
    this.show(this.stack[this.stack.length - 1], false);
    this.stack.pop();
  }
  private createWorld(): void {
    this.blurField();
    this.notify(this.startCbs, {
      name: this.worldName.trim().slice(0, 32) || 'New World',
      seed: this.worldSeed.trim().slice(0, 32) || randomSeed(), mode: 'survival',
    });
  }
  private addServer(): void {
    this.blurField();
    const address = normalizeAddress(this.address);
    if (!address) { this.formError = 'Enter a server address.'; this.dirty = true; return; }
    const existing = this.servers.find(server => server.address === address);
    if (existing) { this.selectedServer = existing.address; this.back(); return; }
    const server = { name: addressName(address), address };
    this.servers.push(server);
    writeJSON(SERVERS_KEY, this.servers);
    this.selectedServer = server.address;
    this.serverScroll = Math.max(0, this.servers.length - 1);
    this.back();
  }
  private connectDirect(): void {
    this.blurField();
    const address = normalizeAddress(this.address);
    if (!address) { this.formError = 'Enter a server address.'; this.dirty = true; return; }
    this.notify(this.connectCbs, { name: addressName(address), address });
  }
  private joinSelected(): void {
    const server = this.servers.find(entry => entry.address === this.selectedServer) ?? this.servers[0];
    if (server) this.notify(this.connectCbs, { name: server.name, address: server.address });
  }
  private quit(): void { this.notify(this.quitCbs, undefined); }
}
