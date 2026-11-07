param(
  [int]$JavaPid = 0,
  [string]$OutDir = 'G:\web_mc\webcraft26\shots\ref',
  [string]$ShotDir = 'G:\ck-web26\shotdir\screenshots',
  [string]$LogFile = 'G:\web_mc\webcraft26\shots\ref\_capture.log',
  [string]$Only = '',
  [int]$GapMs = 10500,
  [int]$ScreenW = 1280,
  [int]$ScreenH = 720
)

$ErrorActionPreference = 'Continue'
Add-Type -AssemblyName System.Drawing

$src = @'
using System;
using System.Text;
using System.Runtime.InteropServices;
public class RefCap {
  public delegate bool EnumWindowsProc(IntPtr hWnd, IntPtr lParam);
  [DllImport("user32.dll")] public static extern bool EnumWindows(EnumWindowsProc lpEnumFunc, IntPtr lParam);
  [DllImport("user32.dll", CharSet = CharSet.Unicode)] public static extern int GetWindowText(IntPtr hWnd, StringBuilder s, int n);
  [DllImport("user32.dll", CharSet = CharSet.Unicode)] public static extern int GetWindowTextLength(IntPtr hWnd);
  [DllImport("user32.dll")] public static extern uint GetWindowThreadProcessId(IntPtr hWnd, out uint pid);
  [DllImport("user32.dll")] public static extern bool IsWindowVisible(IntPtr hWnd);
  [DllImport("user32.dll")] public static extern bool PostMessage(IntPtr hWnd, uint msg, IntPtr wParam, IntPtr lParam);
  [DllImport("user32.dll")] public static extern uint MapVirtualKey(uint code, uint mapType);
  [DllImport("user32.dll")] public static extern bool ShowWindow(IntPtr hWnd, int cmd);
  [DllImport("user32.dll")] public static extern bool GetWindowRect(IntPtr hWnd, out RECT r);
  [DllImport("user32.dll")] public static extern bool GetClientRect(IntPtr hWnd, out RECT r);
  [DllImport("user32.dll")] public static extern bool MoveWindow(IntPtr hWnd, int x, int y, int w, int h, bool repaint);
  public struct RECT { public int Left, Top, Right, Bottom; }
}
'@
Add-Type $src

$script:log = New-Object System.Collections.ArrayList
function Log([string]$m) {
  $line = "[{0:HH:mm:ss}] {1}" -f (Get-Date), $m
  [void]$script:log.Add($line)
  Write-Output $line
}

function Find-Window {
  $script:found = [IntPtr]::Zero
  $script:foundPid = 0
  $script:pidFilter = [uint32]$JavaPid
  $cb = [RefCap+EnumWindowsProc]{
    param($h, $l)
    if (-not [RefCap]::IsWindowVisible($h)) { return $true }
    $len = [RefCap]::GetWindowTextLength($h)
    if ($len -le 0) { return $true }
    $sb = New-Object System.Text.StringBuilder ($len + 2)
    [void][RefCap]::GetWindowText($h, $sb, $len + 2)
    $t = $sb.ToString()
    if ($t -notmatch '^Minecraft [0-9]+\.[0-9]+') { return $true }
    $wpid = 0
    [void][RefCap]::GetWindowThreadProcessId($h, [ref]$wpid)
    if ($script:pidFilter -ne 0 -and $wpid -ne $script:pidFilter) { return $true }
    $script:found = $h
    $script:foundPid = $wpid
    return $false
  }
  [void][RefCap]::EnumWindows($cb, [IntPtr]::Zero)
  return $script:found
}

function Ensure-Size {
  $wr = New-Object 'RefCap+RECT'
  $cr = New-Object 'RefCap+RECT'
  [void][RefCap]::GetWindowRect($script:hwnd, [ref]$wr)
  [void][RefCap]::GetClientRect($script:hwnd, [ref]$cr)
  $cw = $cr.Right - $cr.Left
  $ch = $cr.Bottom - $cr.Top
  if ($cw -ne $ScreenW -or $ch -ne $ScreenH) {
    if ($wr.Left -le -30000) {
      [void][RefCap]::ShowWindow($script:hwnd, 9)
      Start-Sleep -Milliseconds 500
      [void][RefCap]::GetWindowRect($script:hwnd, [ref]$wr)
    }
    $dw = ($wr.Right - $wr.Left) - $cw
    $dh = ($wr.Bottom - $wr.Top) - $ch
    [void][RefCap]::MoveWindow($script:hwnd, $wr.Left, $wr.Top, ($ScreenW + $dw), ($ScreenH + $dh), $true)
    Start-Sleep -Milliseconds 800
    Log ("RESIZED to {0}x{1}" -f $ScreenW, $ScreenH)
  }
}

function Key-Down([int]$code) {
  $scan = [RefCap]::MapVirtualKey([uint32]$code, 0)
  $down = [IntPtr](1 -bor ($scan -shl 16))
  [void][RefCap]::PostMessage($script:hwnd, 0x0100, [IntPtr]$code, $down)
}
function Key-Up([int]$code) {
  $scan = [RefCap]::MapVirtualKey([uint32]$code, 0)
  $up = [IntPtr](0xC0000001 -bor ($scan -shl 16))
  [void][RefCap]::PostMessage($script:hwnd, 0x0101, [IntPtr]$code, $up)
}
function Send-Key([int]$code) {
  Key-Down $code
  Start-Sleep -Milliseconds 40
  Key-Up $code
}
function Send-Text([string]$s) {
  foreach ($ch in $s.ToCharArray()) {
    [void][RefCap]::PostMessage($script:hwnd, 0x0102, [IntPtr][int]$ch, [IntPtr]1)
    Start-Sleep -Milliseconds 14
  }
}
function Send-Chat([string]$cmd) {
  $body = $cmd
  if ($body.StartsWith('/')) { $body = $body.Substring(1) }
  Send-Key 191          # slash key opens chat prefilled with '/'
  Start-Sleep -Milliseconds 380
  Send-Text $body
  Start-Sleep -Milliseconds 200
  Send-Key 13           # Enter
  Start-Sleep -Milliseconds 500
}

function Grab([string]$name) {
  $t0 = (Get-Date).AddSeconds(-4)
  $before = @(Get-ChildItem $ShotDir -Filter *.png -ErrorAction SilentlyContinue | Select-Object -ExpandProperty Name)
  Send-Key 113          # F2
  $newFile = $null
  for ($i = 0; $i -lt 25; $i++) {
    Start-Sleep -Milliseconds 400
    $cand = Get-ChildItem $ShotDir -Filter *.png -ErrorAction SilentlyContinue |
      Sort-Object LastWriteTime -Descending | Select-Object -First 1
    if ($cand -and ($before -notcontains $cand.Name) -and $cand.LastWriteTime -gt $t0) { $newFile = $cand; break }
  }
  if (-not $newFile) { Log "GRABFAIL $name"; return $false }
  $img = [System.Drawing.Image]::FromFile($newFile.FullName)
  $w = $img.Width; $h = $img.Height; $img.Dispose()
  if ($w -ne $ScreenW -or $h -ne $ScreenH) {
    Log "RETRY $name (was ${w}x${h})"
    Ensure-Size
    $before2 = @(Get-ChildItem $ShotDir -Filter *.png | Select-Object -ExpandProperty Name)
    Send-Key 113
    for ($i = 0; $i -lt 25; $i++) {
      Start-Sleep -Milliseconds 400
      $cand = Get-ChildItem $ShotDir -Filter *.png | Sort-Object LastWriteTime -Descending | Select-Object -First 1
      if ($cand -and ($before2 -notcontains $cand.Name)) { $newFile = $cand; break }
    }
    $img = [System.Drawing.Image]::FromFile($newFile.FullName)
    $w = $img.Width; $h = $img.Height; $img.Dispose()
  }
  if (-not (Test-Path $OutDir)) { New-Item -ItemType Directory -Force $OutDir | Out-Null }
  $dst = Join-Path $OutDir ($name + '.png')
  Copy-Item $newFile.FullName $dst -Force
  Log ("SHOT {0} <- {1} {2}x{3}" -f $name, $newFile.Name, $w, $h)
  return $true
}

$hwnd = Find-Window
if ($hwnd -eq [IntPtr]::Zero) { Log 'NOWINDOW'; exit 2 }
$script:hwnd = $hwnd
Log ("TARGET hwnd={0} pid={1}" -f $hwnd, $script:foundPid)
Ensure-Size

# ---- one-time world setup (26.2 renamed gamerules to namespaced ids) ------
$setup = @(
  'difficulty peaceful',
  'gamerule advance_time false',
  'gamerule spawn_mobs false',
  'gamerule spawn_monsters false',
  'gamerule send_command_feedback false',
  'weather clear',
  'kill @e[type=!player]',
  'gamemode survival'
)
if ($Only -eq '') {
  Log 'SETUP'
  foreach ($c in $setup) { Send-Chat $c; Start-Sleep -Milliseconds 250 }
  Send-Chat 'tp @s 1000 -60 1000 0 0'
  Start-Sleep -Milliseconds 6000
}

# ---- scene list ----------------------------------------------------------
$scenes = @(
  @{ name = 'ref-day-6000-level';        cmds = @('time set 6000','tp @s 1000 -60 1000 0 0');                   keysBefore = @();    keysAfter = @();    wait = 2000 },
  @{ name = 'ref-sunset-11800-sun';      cmds = @('time set 11800','tp @s 1000 -60 1000 90 6');                 keysBefore = @();    keysAfter = @();    wait = 2000 },
  @{ name = 'ref-dusk-12500-level';      cmds = @('time set 12500','tp @s 1000 -60 1000 90 6');                 keysBefore = @();    keysAfter = @();    wait = 2000 },
  @{ name = 'ref-night-18000-level';     cmds = @('time set 18000','tp @s 1000 -60 1000 0 0');                   keysBefore = @();    keysAfter = @();    wait = 2000 },
  @{ name = 'ref-night-18000-sky';       cmds = @('tp @s 1000 -60 1000 0 -55');                                  keysBefore = @();    keysAfter = @();    wait = 1200 },
  @{ name = 'ref-night-18000-sky-nohud'; cmds = @();                                                            keysBefore = @(112); keysAfter = @(112); wait = 900 },
  @{ name = 'ref-night-13000-moonrise';  cmds = @('time set 13000','tp @s 1000 -60 1000 -90 8');                 keysBefore = @();    keysAfter = @();    wait = 2000 },
  @{ name = 'ref-night-18000-torch';     cmds = @('time set 18000','tp @s 1000 -60 1000 0 32','setblock 1000 -60 1002 minecraft:torch','item replace entity @s hotbar.0 with minecraft:torch'); keysBefore = @(49); keysAfter = @(); wait = 2000 },
  @{ name = 'ref-day-6000-hand-stone';   cmds = @('time set 6000','tp @s 1000 -60 1000 30 22','item replace entity @s hotbar.0 with minecraft:stone'); keysBefore = @(49); keysAfter = @(); wait = 6500 },
  @{ name = 'ref-day-6000-inventory';    cmds = @('time set 6000','tp @s 1000 -60 1000 0 0','item replace entity @s hotbar.1 with minecraft:stone','item replace entity @s hotbar.2 with minecraft:torch'); keysBefore = @(69); keysAfter = @(27); wait = 2200 }
)

$scenes = $scenes | Where-Object { $Only -eq '' -or $_.name -eq $Only }
$first = $true
foreach ($s in $scenes) {
  if (-not $first) { Start-Sleep -Milliseconds $GapMs }
  $first = $false
  Log ("SCENE {0}" -f $s.name)
  Ensure-Size
  foreach ($c in $s.cmds) { Send-Chat $c }
  foreach ($k in $s.keysBefore) { Send-Key $k; Start-Sleep -Milliseconds 600 }
  Start-Sleep -Milliseconds $s.wait
  [void](Grab $s.name)
  foreach ($k in $s.keysAfter) { Send-Key $k; Start-Sleep -Milliseconds 500 }
}

Set-Content -Path $LogFile -Value $script:log -Encoding UTF8
Log 'DONE'
