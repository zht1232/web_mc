param(
  [int]$JavaPid = 0,
  [switch]$F2,
  [string]$Chat = '',
  [string]$Text = '',
  [int]$VK = -1,
  [int]$ClickX = -1,
  [int]$ClickY = -1,
  [int]$MoveX = -1,
  [int]$MoveY = -1,
  [switch]$Close,
  [switch]$NoResize,
  [int]$ScreenW = 1280,
  [int]$ScreenH = 720,
  [string]$Seq = '',
  [int]$SleepAfter = 300
)

$src = @'
using System;
using System.Text;
using System.Runtime.InteropServices;
public class RefIn {
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

$script:found = [IntPtr]::Zero
$script:foundPid = 0
$script:pidFilter = [uint32]$JavaPid
$cb = [RefIn+EnumWindowsProc]{
  param($h, $l)
  if (-not [RefIn]::IsWindowVisible($h)) { return $true }
  $len = [RefIn]::GetWindowTextLength($h)
  if ($len -le 0) { return $true }
  $sb = New-Object System.Text.StringBuilder ($len + 2)
  [void][RefIn]::GetWindowText($h, $sb, $len + 2)
  $t = $sb.ToString()
  if ($t -notmatch '^Minecraft [0-9]+\.[0-9]+') { return $true }
  $wpid = 0
  [void][RefIn]::GetWindowThreadProcessId($h, [ref]$wpid)
  if ($script:pidFilter -ne 0 -and $wpid -ne $script:pidFilter) { return $true }
  $script:found = $h
  $script:foundPid = $wpid
  return $false
}
[void][RefIn]::EnumWindows($cb, [IntPtr]::Zero)
$hwnd = $script:found
if ($hwnd -eq [IntPtr]::Zero) { Write-Output 'NOWINDOW'; exit 2 }
Write-Output "TARGET hwnd=$hwnd pid=$($script:foundPid)"

if (-not $NoResize) {
  $wr = New-Object 'RefIn+RECT'
  $cr = New-Object 'RefIn+RECT'
  [void][RefIn]::GetWindowRect($hwnd, [ref]$wr)
  [void][RefIn]::GetClientRect($hwnd, [ref]$cr)
  $cw = $cr.Right - $cr.Left
  $ch = $cr.Bottom - $cr.Top
  if ($cw -ne $ScreenW -or $ch -ne $ScreenH) {
    if ($wr.Left -le -30000) { [void][RefIn]::ShowWindow($hwnd, 9); Start-Sleep -Milliseconds 400 }
    [void][RefIn]::GetWindowRect($hwnd, [ref]$wr)
    [void][RefIn]::GetClientRect($hwnd, [ref]$cr)
    $dw = ($wr.Right - $wr.Left) - ($cr.Right - $cr.Left)
    $dh = ($wr.Bottom - $wr.Top) - ($cr.Bottom - $cr.Top)
    [void][RefIn]::MoveWindow($hwnd, $wr.Left, $wr.Top, ($ScreenW + $dw), ($ScreenH + $dh), $true)
    Start-Sleep -Milliseconds 700
    Write-Output "RESIZED ${ScreenW}x${ScreenH}"
  }
}

function Send-Key([int]$code) {
  $scan = [RefIn]::MapVirtualKey([uint32]$code, 0)
  $down = [IntPtr](1 -bor ($scan -shl 16))
  $up = [IntPtr](0xC0000001 -bor ($scan -shl 16))
  [void][RefIn]::PostMessage($hwnd, 0x0100, [IntPtr]$code, $down)
  Start-Sleep -Milliseconds 40
  [void][RefIn]::PostMessage($hwnd, 0x0101, [IntPtr]$code, $up)
}

function Key-Down([int]$code) {
  $scan = [RefIn]::MapVirtualKey([uint32]$code, 0)
  $down = [IntPtr](1 -bor ($scan -shl 16))
  [void][RefIn]::PostMessage($hwnd, 0x0100, [IntPtr]$code, $down)
}

function Key-Up([int]$code) {
  $scan = [RefIn]::MapVirtualKey([uint32]$code, 0)
  $up = [IntPtr](0xC0000001 -bor ($scan -shl 16))
  [void][RefIn]::PostMessage($hwnd, 0x0101, [IntPtr]$code, $up)
}

function Send-Text([string]$s) {
  foreach ($ch in $s.ToCharArray()) {
    [void][RefIn]::PostMessage($hwnd, 0x0102, [IntPtr][int]$ch, [IntPtr]1)
    Start-Sleep -Milliseconds 12
  }
}

if ($Close) {
  $r = [RefIn]::PostMessage($hwnd, 0x0010, [IntPtr]::Zero, [IntPtr]::Zero)
  Write-Output "CLOSE posted=$r"
}

if ($Seq -ne '') {
  foreach ($step in $Seq.Split(';')) {
    $s = $step.Trim()
    if ($s -eq '') { continue }
    if ($s -eq 'f2') { Send-Key 113; Start-Sleep -Milliseconds 1300; Write-Output 'SEQ f2' }
    elseif ($s -eq 'enter') { Send-Key 13; Start-Sleep -Milliseconds 300; Write-Output 'SEQ enter' }
    elseif ($s -eq 'esc') { Send-Key 27; Start-Sleep -Milliseconds 300; Write-Output 'SEQ esc' }
    elseif ($s -eq 'bs') { Send-Key 8; Start-Sleep -Milliseconds 200; Write-Output 'SEQ bs' }
    elseif ($s -eq 'selall') {
      Key-Down 17; Start-Sleep -Milliseconds 60
      Send-Key 65
      Start-Sleep -Milliseconds 60; Key-Up 17
      Start-Sleep -Milliseconds 200
      Write-Output 'SEQ selall'
    }
    elseif ($s -match '^k(\d+)$') { Send-Key ([int]$Matches[1]); Start-Sleep -Milliseconds 250; Write-Output "SEQ key $($Matches[1])" }
    elseif ($s -match '^w(\d+)$') { Start-Sleep -Milliseconds ([int]$Matches[1]) }
    elseif ($s -match '^c(\d+),(\d+)$') {
      $px = [int]$Matches[1]; $py = [int]$Matches[2]
      $lp = [IntPtr](($py -shl 16) -bor ($px -band 0xFFFF))
      [void][RefIn]::PostMessage($hwnd, 0x0200, [IntPtr]::Zero, $lp)
      Start-Sleep -Milliseconds 120
      [void][RefIn]::PostMessage($hwnd, 0x0201, [IntPtr]1, $lp)
      Start-Sleep -Milliseconds 80
      [void][RefIn]::PostMessage($hwnd, 0x0202, [IntPtr]::Zero, $lp)
      Start-Sleep -Milliseconds 400
      Write-Output "SEQ click $px,$py"
    }
    elseif ($s -match '^m(\d+),(\d+)$') {
      $px = [int]$Matches[1]; $py = [int]$Matches[2]
      $lp = [IntPtr](($py -shl 16) -bor ($px -band 0xFFFF))
      [void][RefIn]::PostMessage($hwnd, 0x0200, [IntPtr]::Zero, $lp)
      Start-Sleep -Milliseconds 120
      Write-Output "SEQ move $px,$py"
    }
    elseif ($s -match '^t:(.*)$') {
      $txt = $Matches[1]
      Send-Text $txt
      Start-Sleep -Milliseconds 250
      Write-Output "SEQ text [$txt]"
    }
  }
  Start-Sleep -Milliseconds $SleepAfter
  exit 0
}

if ($MoveX -ge 0 -and $MoveY -ge 0) {
  $lp = [IntPtr](($MoveY -shl 16) -bor ($MoveX -band 0xFFFF))
  [void][RefIn]::PostMessage($hwnd, 0x0200, [IntPtr]::Zero, $lp)
  Write-Output "MOVE $MoveX,$MoveY"
}

if ($ClickX -ge 0 -and $ClickY -ge 0) {
  $lp = [IntPtr](($ClickY -shl 16) -bor ($ClickX -band 0xFFFF))
  [void][RefIn]::PostMessage($hwnd, 0x0200, [IntPtr]::Zero, $lp)
  Start-Sleep -Milliseconds 80
  [void][RefIn]::PostMessage($hwnd, 0x0201, [IntPtr]1, $lp)
  Start-Sleep -Milliseconds 70
  [void][RefIn]::PostMessage($hwnd, 0x0202, [IntPtr]::Zero, $lp)
  Write-Output "CLICK $ClickX,$ClickY"
}

if ($Text -ne '') {
  Send-Text $Text
  Write-Output "TEXT [$Text]"
}

if ($Chat -ne '') {
  Send-Key 84
  Start-Sleep -Milliseconds 350
  Send-Text $Chat
  Start-Sleep -Milliseconds 200
  Send-Key 13
  Write-Output "CHAT [$Chat]"
  Start-Sleep -Milliseconds 400
}

if ($VK -ge 0) {
  Send-Key $VK
  Write-Output "VK $VK"
}

if ($F2) {
  Send-Key 113
  Write-Output 'F2'
  Start-Sleep -Milliseconds 1200
}

Start-Sleep -Milliseconds $SleepAfter
