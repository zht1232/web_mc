import { loadAssets } from './assets.js';
import { BlockRegistry } from './blocks.js';
import { World } from './world.js';
import { Renderer } from './renderer.js';
import { Player } from './player.js';
import { Hud } from './hud.js';
import { GameAudio } from './audio.js';
import { TouchControls } from './touch.js';
import { MobManager } from './mobs.js';
import { MobRenderer } from './mobRenderer.js';
import { ParticleSystem } from './particles.js';
import { smoothstep, hexToRgb } from './math.js';
import { VanillaMenu, type MenuSettings } from './menu.js';

async function boot(): Promise<void> {
  const gameCanvas = document.getElementById('game') as HTMLCanvasElement;
  const uiCanvas = document.getElementById('ui') as HTMLCanvasElement;
  const loading = document.getElementById('loading')!;
  const label = document.getElementById('loading-label')!;
  const bar = document.getElementById('loading-bar')!;

  const setProgress = (f: number, text: string) => {
    bar.style.width = `${Math.round(Math.min(1, Math.max(0, f)) * 100)}%`;
    label.textContent = text;
  };

  const gl = gameCanvas.getContext('webgl2', {
    alpha: false,
    antialias: true,
    depth: true,
    powerPreference: 'high-performance',
    preserveDrawingBuffer: false,
  });
  if (!gl) {
    label.textContent = 'WebGL2 is not available in this browser.';
    return;
  }
  gl.clearColor(0.47, 0.65, 1, 1);

  const params = new URLSearchParams(location.search);
  const preview = params.has('preview');
  const dbgInfo = gl.getExtension('WEBGL_debug_renderer_info');
  const gpuName = dbgInfo ? String(gl.getParameter(dbgInfo.UNMASKED_RENDERER_WEBGL)) : 'unknown';
  const softwareRenderer = /swiftshader|llvmpipe|software|basic render/i.test(gpuName);
  const touchDevice = TouchControls.isTouchDevice();
  const qualityNames = ['low', 'medium', 'high', 'ultra'] as const;
  type Quality = typeof qualityNames[number];
  const requestedQuality = params.get('quality');
  const initialQuality: Quality = qualityNames.includes(requestedQuality as Quality)
    ? requestedQuality as Quality
    : softwareRenderer ? 'low' : touchDevice ? 'medium' : 'high';
  const t0 = performance.now();
  try {
    setProgress(0.01, 'Loading official 26.2 resources');
    const assets = await loadAssets(gl, setProgress);
    const tAssets = performance.now();
    const rocks = new BlockRegistry(assets.manifest);
    const audio = new GameAudio(assets.manifest.audio?.events ?? {});
    setProgress(0.71, 'Preparing world');
    const world = new World(rocks, assets, 0x2602c0de);
    await world.generate(setProgress);
    const spawn = world.findSpawn();
    world.decorateSpawn(spawn);
    const tWorld = performance.now();
    const renderer = new Renderer(gl, assets, rocks);
    const particles = new ParticleSystem(gl, assets, rocks, world);
    let mipmapMode = 0;
    renderer.setTextureFilter(mipmapMode);
    await renderer.buildAll(world, setProgress);
    const tMesh = performance.now();
    console.log(`[timing] assets ${(tAssets - t0).toFixed(0)}ms world ${(tWorld - tAssets).toFixed(0)}ms mesh ${(tMesh - tWorld).toFixed(0)}ms total ${(tMesh - t0).toFixed(0)}ms`);
    const player = new Player(world, rocks, spawn);
    player.yaw = Number(params.get('yaw') ?? spawn.yaw ?? world.suggestYaw(spawn.x, spawn.z));
    player.pitch = Number(params.get('pitch') ?? 0.12);
    player.attach(gameCanvas);
    const knownSounds = new Set(['stone', 'grass', 'wood', 'sand', 'gravel', 'glass', 'snow', 'wool']);
    const soundFor = (id: number): string => {
      const s = rocks.get(id).flags?.sound ?? 'stone';
      return knownSounds.has(s) ? s : (s === 'lantern' ? 'glass' : 'stone');
    };
    player.setBlockChangeHandler((x, y, z, oldId, newId) => {
      if (oldId) audio.play(`block.${soundFor(oldId)}.break`, 0.65);
      if (oldId) particles.destroyBlock(x, y, z, oldId);
      if (newId) audio.play(`block.${soundFor(newId)}.place`, 0.6);
      world.relightAround(x, y, z, 20);
      renderer.invalidateArea(x >> 4, z >> 4, world, 1);
    });

    const hud = new Hud(uiCanvas, assets, rocks, world);
    const mobs = new MobManager(world, rocks);
    const mobRenderer = new MobRenderer(gl, world, rocks);
    try {
      await mobRenderer.ready;
    } catch (err) {
      console.warn('mob textures unavailable', err);
    }
    const nightSky = hexToRgb('#7a7aff');
    const torchLight = hexToRgb('#ffd88c');
    renderer.setWorldExtraRenderer((g, vp, eye, time, day) => {
      mobRenderer.render(g, vp, { x: eye[0], y: eye[1], z: eye[2] }, mobs.mobs, time, day, mobs.arrows);
      particles.render(g, vp, eye,
        [nightSky[0] + (1 - nightSky[0]) * day, nightSky[1] + (1 - nightSky[1]) * day, nightSky[2] + (1 - nightSky[2]) * day],
        torchLight, 0.24 + 0.76 * day);
    });
    mobs.spawnPassive(player.pos, 4);
    mobs.onPlayerDamage = (amount, source) => {
      player.damage(amount);
      hud.toast(`${source.replace(/_/g, ' ')} hit you for ${amount.toFixed(1)}`);
    };
    let started = preview;
    let inventoryOpen = false;
    let inventoryOpenedAt = 0;
    let touchPaused = false;
    let menuOpen = false;
    let menu: VanillaMenu | null = null;
    let touch: TouchControls | null = null;
    let lastTouchJump = -1e9;
    let touchBreakTimer = 0;
    let debug = false;
    let timeFrozen = false;
    const qualityPresets: Record<Quality, { distance: number; scale: number; shadows: boolean; shadowSize: number; post: boolean; bloom: boolean; rays: boolean }> = {
      low: { distance: 4, scale: 0.62, shadows: false, shadowSize: 512, post: false, bloom: false, rays: false },
      medium: { distance: 6, scale: 0.82, shadows: true, shadowSize: 1024, post: true, bloom: false, rays: false },
      high: { distance: 8, scale: 1, shadows: true, shadowSize: 2048, post: true, bloom: true, rays: false },
      ultra: { distance: 10, scale: 1, shadows: true, shadowSize: 4096, post: true, bloom: true, rays: true },
    };
    let currentQuality = initialQuality;
    let renderDistance = Number(params.get('rd') ?? qualityPresets[currentQuality].distance);
    let resolutionScale = qualityPresets[currentQuality].scale;
    let ticks = 1000;
    let elapsed = 0;
    let fps = 60;
    let last = performance.now();
    let underwater = false;
    let stepTimer = 0;
    let baseFov = 70;
    let fovCurrent = 70;

    const resize = () => {
      const dpr = Math.min(window.devicePixelRatio || 1, 1.5) * resolutionScale;
      const w = Math.max(1, Math.floor(window.innerWidth * dpr));
      const h = Math.max(1, Math.floor(window.innerHeight * dpr));
      if (gameCanvas.width !== w || gameCanvas.height !== h) {
        gameCanvas.width = w;
        gameCanvas.height = h;
        gameCanvas.style.width = window.innerWidth + 'px';
        gameCanvas.style.height = window.innerHeight + 'px';
        renderer.setViewport(w, h);
      }
      hud.resize(window.innerWidth, window.innerHeight);
    };
    window.addEventListener('resize', resize);
    resize();

    const applyQuality = (q: Quality, presetDistance = true) => {
      currentQuality = q;
      const p = qualityPresets[q];
      renderer.setShadowQuality(p.shadows, p.shadowSize);
      renderer.setPostQuality(p.bloom, p.rays);
      renderer.setPostEnabled(p.post);
      resolutionScale = p.scale;
      if (presetDistance) renderDistance = Number(params.get('rd') ?? p.distance);
      resize();
    };
    applyQuality(currentQuality);

    const openInventory = () => {
      if (!started || inventoryOpen) return;
      inventoryOpen = true;
      inventoryOpenedAt = performance.now();
      hud.setInventory(true);
      hud.setMouse(window.innerWidth / 2, window.innerHeight / 2);
      audio.play('ui.button.click', 0.25);
      if (document.pointerLockElement === gameCanvas) document.exitPointerLock();
    };
    const closeInventory = () => {
      if (!inventoryOpen) return;
      inventoryOpen = false;
      hud.setInventory(false);
      audio.play('ui.button.click', 0.25);
      if (!player.touchEnabled) player.requestLock();
    };

    touch = new TouchControls(document.body, {
      autoEnable: touchDevice,
      visible: false,
      onInventory: () => { if (!inventoryOpen && !touchPaused) openInventory(); },
      onPause: () => {
        if (inventoryOpen) { closeInventory(); return; }
        touchPaused = !touchPaused;
        touch?.setVisible(started && !inventoryOpen && !touchPaused);
      },
      onChat: () => hud.toast('Chat is available in multiplayer'),
    });
    if (touch.isEnabled()) {
      player.touchEnabled = true;
      started = true;
    }

    gameCanvas.addEventListener('click', (e) => {
      if (touchPaused) {
        touchPaused = false;
        touch?.setVisible(started && !inventoryOpen);
        return;
      }
      if (inventoryOpen) {
        if (performance.now() - inventoryOpenedAt < 400) return;
        hud.setMouse(e.clientX, e.clientY);
        const hit = hud.inventoryHit(e.clientX, e.clientY);
        if (!hit) {
          if (hud.getCarried()) { hud.clearCarried(); return; }
          if (player.touchEnabled) closeInventory();
          return;
        }
        void audio.init();
        audio.play('ui.button.click', 0.25);
        if ('close' in hit) { closeInventory(); return; }
        if ('category' in hit || 'scroll' in hit) return;
        if ('block' in hit) return;
        if ('hotbar' in hit) {
          const carried = hud.getCarried();
          if (carried) {
            player.hotbar[hit.hotbar] = rocks.get(carried);
            hud.clearCarried();
          }
          player.selected = hit.hotbar;
          player.selectedSince = performance.now();
          return;
        }
        return;
      }
      void audio.init();
      audio.play('ui.button.click', 0.3);
      if (!player.touchEnabled && document.pointerLockElement !== gameCanvas) player.requestLock();
    });
    gameCanvas.addEventListener('pointerdown', (e) => {
      if (inventoryOpen || !player.locked) return;
      if (e.button === 0 || e.button === 2) {
        renderer.swing();
        void audio.init();
      }
    });
    document.addEventListener('mousedown', (e) => {
      if (e.button !== 0 || inventoryOpen || touchPaused || !player.locked) return;
      const hit = mobs.playerAttackFromLook(player.eye(), player.yaw, player.pitch, 4, 4.5);
      if (!hit) return;
      renderer.swing();
      e.preventDefault();
      e.stopPropagation();
    }, true);
    document.addEventListener('mousemove', (e) => {
      if (inventoryOpen) hud.setMouse(e.clientX, e.clientY);
    });
    window.addEventListener('wheel', (e) => {
      if (!inventoryOpen) return;
      e.preventDefault();
      hud.inventoryScroll(Math.sign(e.deltaY));
    }, { passive: false });
    document.addEventListener('pointerlockchange', () => {
      if (document.pointerLockElement === gameCanvas) started = true;
    });

    document.addEventListener('keydown', (e) => {
      if (inventoryOpen) {
        if (e.code === 'KeyE' || e.code === 'Escape') {
          e.preventDefault();
          closeInventory();
        } else if (e.code === 'ArrowLeft') {
          hud.cycleCategory(-1);
        } else if (e.code === 'ArrowRight') {
          hud.cycleCategory(1);
        } else if (e.code === 'ArrowUp') {
          hud.inventoryScroll(-1);
        } else if (e.code === 'ArrowDown') {
          hud.inventoryScroll(1);
        }
        return;
      }
      if (!player.locked) return;
      if (e.code === 'KeyE') {
        e.preventDefault();
        openInventory();
      } else if (e.code === 'F3') {
        e.preventDefault();
        debug = !debug;
      } else if (e.code === 'KeyN') {
        ticks = 6000;
      } else if (e.code === 'KeyM') {
        ticks = 18000;
      } else if (e.code === 'KeyT' && !e.repeat) {
        timeFrozen = !timeFrozen;
      } else if (e.code === 'KeyV' && !e.repeat) {
        mipmapMode = (mipmapMode + 1) % 4;
        renderer.setTextureFilter(mipmapMode);
        hud.toast(['Mipmap: Off (pixel)', 'Mipmap: Nearest', 'Mipmap: Linear blend', 'Mipmap: Smooth'][mipmapMode]);
      }
    });

    const applyMenuSettings = (s: MenuSettings): void => {
      const q: Quality = s.quality === 'auto' ? initialQuality : s.quality;
      applyQuality(q, false);
      renderDistance = s.quality === 'auto'
        ? qualityPresets[q].distance
        : Math.max(4, Math.min(16, Math.round(s.renderDistance)));
      renderer.setPostEnabled(s.shaders && q !== 'low');
      renderer.setPostQuality(s.shaders && (q === 'high' || q === 'ultra'), s.shaders && q === 'ultra');
      renderer.setFov(s.fov);
      baseFov = s.fov;
      renderer.setTextureFilter(s.filtering === 2 ? 3 : s.filtering);
      audio.setVolume(s.volume);
      const wantTouch = s.touch === 'on' || (s.touch === 'auto' && touchDevice);
      if (touch) {
        if (wantTouch) touch.enable();
        else touch.disable();
      }
      player.touchEnabled = wantTouch;
      resize();
    };

    if (!preview) {
      menu = new VanillaMenu(document.body, { autoOpen: true });
      menuOpen = true;
      touch?.setVisible(false);
      applyMenuSettings(menu.getSettings());
      menu.onSettingsChange(applyMenuSettings);
      menu.onStart((opts) => {
        menu?.close();
        menuOpen = false;
        started = true;
        inventoryOpen = false;
        touchPaused = false;
        hud.setInventory(false);
        void audio.init();
        hud.toast(`World: ${opts.name}  ·  seed ${opts.seed}`);
        if (player.touchEnabled) touch?.setVisible(true);
        else player.requestLock();
      });
      menu.onConnect(({ name }) => {
        menu?.showLoading(`Connecting to ${name} requires the Paper bridge plugin`, 0);
        window.setTimeout(() => menu?.hideLoading(), 2800);
      });
      menu.onQuit(() => {
        window.close();
      });
    }

    loading.classList.add('hidden');
    document.body.classList.add('ready');
    (window as any).__mc = {
      player, world, renderer, hud, mobs, mobRenderer, particles, menu,
      getTicks: () => ticks,
      setTicks: (v: number) => { ticks = v; },
      setDebug: (v: boolean) => { debug = v; },
      setTimeFrozen: (v: boolean) => { timeFrozen = v; },
      audio, getUnderwater: () => underwater, setTextureFilter: (m: number) => { mipmapMode = m; renderer.setTextureFilter(m); },
      setRenderDistance: (n: number) => { renderDistance = Math.max(2, Math.min(16, n)); },
      setQuality: (q: Quality) => applyQuality(q),
      getQuality: () => currentQuality,
      setDebugMode: (mode: number) => renderer.setDebugMode(mode),
      gpuName,
      openInventory, closeInventory, isInventoryOpen: () => inventoryOpen,
      preview,
    };
    window.addEventListener('contextmenu', e => e.preventDefault());
    document.addEventListener('pointerdown', e => {
      if (!touch || !touch.isEnabled() || !started || inventoryOpen || touchPaused) return;
      if (e.pointerType !== 'touch' && e.pointerType !== 'pen') return;
      const slot = hud.hotbarHit(e.clientX, e.clientY);
      if (slot < 0) return;
      player.selected = slot;
      player.selectedSince = performance.now();
      audio.play('ui.button.click', 0.18);
      e.stopPropagation();
      e.preventDefault();
    }, true);

    const loop = (now: number) => {
      const dt = Math.min(0.1, Math.max(0, (now - last) / 1000));
      last = now;
      if (menuOpen) {
        requestAnimationFrame(loop);
        return;
      }
      elapsed += dt;
      if (dt > 0) fps = fps * 0.9 + (1 / dt) * 0.1;
      const touchActive = !!touch && player.touchEnabled && started && !inventoryOpen && !touchPaused;
      if (touch) {
        if (touchActive) {
          const look = touch.consumeLook();
          if (look.dx || look.dy) {
            player.yaw += look.dx * 0.0026;
            player.pitch = Math.max(-1.56, Math.min(1.56, player.pitch + look.dy * 0.0026));
          }
          if (touch.consumeJumpPressed()) {
            const nowMs = performance.now();
            if (nowMs - lastTouchJump < 320) {
              player.flying = !player.flying;
              player.vel.y = 0;
            }
            lastTouchJump = nowMs;
          }
          const move = touch.getMove();
          player.setTouchInput(move.x, move.y, touch.isJumpHeld(), touch.isSneakHeld(),
            touch.isSprintHeld(), touch.isFlyUpHeld(), touch.isFlyDownHeld());
        } else {
          player.setTouchInput(0, 0, false, false, false, false, false);
        }
      }
      if (started && !touchPaused) {
        player.update(dt, !inventoryOpen);
        if (!timeFrozen) ticks += dt * 20;
        const sunY = Math.sin((ticks / 24000) * Math.PI * 2);
        mobs.tick(dt, player.pos, smoothstep(-0.16, 0.16, sunY));
        particles.tick(dt);
        const horiz = Math.hypot(player.vel.x, player.vel.z) * 20;
        if (player.onGround && horiz > 0.7) {
          stepTimer -= dt;
          if (stepTimer <= 0) {
            const under = world.getBlock(Math.floor(player.pos.x), Math.floor(player.pos.y - 0.1), Math.floor(player.pos.z));
            const snd = soundFor(under);
            if (under) audio.play(`block.${snd}.step`, 0.32, 1);
            stepTimer = horiz > 5 ? 0.29 : 0.38;
          }
        } else {
          stepTimer = 0.05;
        }
        if (touch && touchActive) {
          if (touch.consumeUsePressed()) {
            player.tryPlace();
            renderer.swing();
          }
          if (touch.isAttackHeld()) {
            const hitMob = mobs.playerAttackFromLook(player.eye(), player.yaw, player.pitch, 4, 4.5);
            if (hitMob) {
              renderer.swing();
              touchBreakTimer = 0.3;
            } else if (player.target) {
              touchBreakTimer -= dt;
              if (touchBreakTimer <= 0) {
                player.tryBreak();
                renderer.swing();
                touchBreakTimer = 0.22;
              }
            }
          } else {
            touchBreakTimer = 0;
          }
        }
      }
      const eye = player.eyeLerp();
      const eyeId = world.getBlock(Math.floor(eye.x), Math.floor(eye.y), Math.floor(eye.z));
      const wasUnderwater = underwater;
      underwater = eyeId !== 0 && rocks.byName.get('water')?.id === eyeId;
      if (underwater !== wasUnderwater && started) {
        audio.play(underwater ? 'ambient.underwater.enter' : 'ambient.underwater.exit', 0.45);
      }
      if (touch) {
        touch.setFlying(player.flying);
        touch.setUnderwater(underwater);
        touch.setVisible(started && !inventoryOpen && !touchPaused);
      }
      const speedFov = player.isInputActive() && player.sprinting ? 1.1 : 1;
      fovCurrent += (baseFov * speedFov - fovCurrent) * Math.min(1, dt * 9);
      renderer.setFov(fovCurrent);
      renderer.setHeldBlock(player.hotbar[player.selected]?.id ?? 0);
      renderer.setViewmodelTouchMode(player.touchEnabled);
      renderer.setViewmodelMotion(Math.hypot(player.vel.x, player.vel.z) * 20, player.onGround);
      renderer.setViewmodelVisible(started && !inventoryOpen && !touchPaused);
      renderer.render(world, eye.x, eye.y, eye.z, player.yaw, player.pitch,
        player.isInputActive() && !touchPaused ? player.target : null, ticks, elapsed, renderDistance);
      hud.render({
        started,
        paused: started && !inventoryOpen && (touchPaused || (!player.touchEnabled && !player.locked && !preview)),
        player,
        fps,
        ticks,
        debug,
        underwater,
        renderer,
        elapsed,
        inventoryOpen,
      });
      requestAnimationFrame(loop);
    };
    requestAnimationFrame(loop);
  } catch (err) {
    console.error(err);
    label.textContent = 'Load failed: ' + (err instanceof Error ? err.message : String(err));
    bar.style.background = '#b33';
  }
}

boot();
