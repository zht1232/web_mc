#!/usr/bin/env node
// Real Minecraft 26.2 client reference-screenshot capture (repeatable).
//
// Why this exists: the webcraft26 renderer is validated against real vanilla
// frames. This script boots the untouched 26.2 client from G:/ck-web26 with a
// clean gameDir, auto-joins a prepared superflat world, and drives the in-game
// chat/scene setup through scripts/ref-scenes.ps1 (PostMessage input + F2).
//
// The workstation may be locked (no interactive desktop): therefore ALL input
// is injected with PostMessage/WH_CHAR into the GLFW window and all screenshots
// are taken by the game itself (F2 -> shotdir/screenshots), never by screen
// grabbing.
//
// Usage:
//   node scripts/ref-capture.mjs                 # full scene suite
//   node scripts/ref-capture.mjs --only=ref-night-18000-level
//   node scripts/ref-capture.mjs --attach=12345  # reuse a running client
//   node scripts/ref-capture.mjs --no-close      # leave client running
//
// Prerequisites (already on disk): G:/ck-web26/{client-26.2.jar,launch.args,nat},
// Java 25 at .minecraft/runtime/java-runtime-epsilon, and a world named
// "New World" in G:/ck-web26/shotdir/saves (created once through the vanilla GUI).

import { spawn, spawnSync } from 'node:child_process';
import { existsSync, mkdirSync, writeFileSync, readFileSync } from 'node:fs';

const JAVA = process.env.REF_JAVA
  || 'C:\\Users\\zht\\AppData\\Roaming\\.minecraft\\runtime\\java-runtime-epsilon\\bin\\java.exe';
const CK = 'G:/ck-web26';
const SHOTDIR = `${CK}/shotdir`;
const WORK = 'G:/tmp';
const WORLD = process.env.REF_WORLD || 'New World';
const OUT = 'G:/web_mc/webcraft26/shots/ref';
const SCRIPTS = 'G:/web_mc/webcraft26/scripts';

const argv = process.argv.slice(2);
const opt = (name, def = null) => {
  const hit = argv.find((a) => a === `--${name}` || a.startsWith(`--${name}=`));
  if (!hit) return def;
  return hit.includes('=') ? hit.split('=').slice(1).join('=') : true;
};
const only = opt('only', '');
const attach = opt('attach', 0);
const noClose = opt('no-close', false);

const LOG4J = `<?xml version="1.0" encoding="UTF-8"?>
<Configuration status="WARN">
  <Appenders>
    <Console name="SysOut" target="SYSTEM_OUT">
      <PatternLayout pattern="[%d{HH:mm:ss}] [%t/%level]: %msg%n" />
    </Console>
    <File name="File" fileName="G:/ck-web26/shotdir/logs/latest.log" append="false">
      <PatternLayout pattern="[%d{HH:mm:ss}] [%t/%level]: %msg%n" />
    </File>
  </Appenders>
  <Loggers>
    <Logger name="net.minecraft.client.sounds.SoundEngine" level="OFF" />
    <Logger name="com.mojang.blaze3d.audio" level="OFF" />
    <Root level="info">
      <AppenderRef ref="SysOut" />
      <AppenderRef ref="File" />
    </Root>
  </Loggers>
</Configuration>
`;

function writeArgs() {
  mkdirSync(WORK, { recursive: true });
  writeFileSync(`${WORK}/ref-log4j2.xml`, LOG4J);
  const base = readFileSync(`${CK}/launch.args`, 'utf8');
  const args = `-Dlog4j.configurationFile=file:///G:/tmp/ref-log4j2.xml\r\n`
    + base.replace(/\r?\n$/, '\r\n')
    + `--quickPlaySingleplayer\r\n"${WORLD}"\r\n`;
  writeFileSync(`${WORK}/launch-ref.args`, args);
}

function ps(script, args) {
  return spawnSync('powershell.exe', ['-NoProfile', '-File', script, ...args], {
    stdio: 'inherit',
    windowsHide: true,
  });
}

function psQuiet(script, args) {
  return spawnSync('powershell.exe', ['-NoProfile', '-File', script, ...args], {
    encoding: 'utf8',
    windowsHide: true,
  });
}

function waitForWindow(pid, timeoutMs = 300000) {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    const r = psQuiet(`${SCRIPTS}/ref-client.ps1`, ['-JavaPid', String(pid), '-Rect']);
    if (r.status === 0 && /WINDOW /.test(r.stdout || '')) return true;
    spawnSync('powershell.exe', ['-NoProfile', '-Command', 'Start-Sleep -Seconds 5'], { windowsHide: true });
  }
  return false;
}

function waitForWorld(pid, timeoutMs = 300000) {
  const deadline = Date.now() + timeoutMs;
  const log = `${SHOTDIR}/logs/latest.log`;
  while (Date.now() < deadline) {
    try {
      const text = readFileSync(log, 'utf8');
      if (/joined the game|Loaded \d+ advancements|Saving chunks/.test(text)) return true;
    } catch { /* log not created yet */ }
    spawnSync('powershell.exe', ['-NoProfile', '-Command', 'Start-Sleep -Seconds 5'], { windowsHide: true });
  }
  return false;
}

async function main() {
  if (!existsSync(JAVA)) throw new Error(`Java not found: ${JAVA}`);
  if (!existsSync(`${CK}/launch.args`)) throw new Error('missing G:/ck-web26/launch.args');

  let pid = Number(attach) || 0;
  if (!pid) {
    writeArgs();
    const child = spawn(JAVA, ['@G:/tmp/launch-ref.args'], { detached: true, stdio: 'ignore', windowsHide: false });
    child.unref();
    pid = child.pid;
    console.log(`[ref] launched client pid=${pid}`);
    if (!waitForWindow(pid)) throw new Error('client window did not appear');
    console.log('[ref] window up, waiting for world join ...');
    waitForWorld(pid);
  } else {
    console.log(`[ref] attaching to pid=${pid}`);
  }

  const sceneArgs = ['-JavaPid', String(pid)];
  if (only) sceneArgs.push('-Only', String(only));
  const r = ps(`${SCRIPTS}/ref-scenes.ps1`, sceneArgs);
  if (r.status !== 0) console.warn(`[ref] ref-scenes.ps1 exit=${r.status}`);

  if (!noClose) ps(`${SCRIPTS}/ref-input.ps1`, ['-JavaPid', String(pid), '-Close']);
  console.log(`[ref] screenshots -> ${OUT}`);
}

main().catch((e) => {
  console.error(`[ref] failed: ${e.message}`);
  process.exit(1);
});
