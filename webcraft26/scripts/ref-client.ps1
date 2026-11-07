param(
  [string]$Out = '',
  [int]$JavaPid = 0,
  [int]$ResizeW = 0,
  [int]$ResizeH = 0,
  [int]$MoveToX = 0,
  [int]$MoveToY = 0,
  [switch]$Foreground,
  [switch]$Rect,
  [int]$WaitWindowSec = 0,
  [int]$SleepAfter = 250
)

Add-Type -AssemblyName System.Windows.Forms
Add-Type -AssemblyName System.Drawing

$src = @'
using System;
using System.Text;
using System.Runtime.InteropServices;
public class RefWin {
  public delegate bool EnumWindowsProc(IntPtr hWnd, IntPtr lParam);
  [DllImport("user32.dll")] public static extern bool EnumWindows(EnumWindowsProc lpEnumFunc, IntPtr lParam);
  [DllImport("user32.dll", CharSet = CharSet.Unicode)] public static extern int GetWindowText(IntPtr hWnd, StringBuilder s, int n);
  [DllImport("user32.dll", CharSet = CharSet.Unicode)] public static extern int GetWindowTextLength(IntPtr hWnd);
  [DllImport("user32.dll")] public static extern uint GetWindowThreadProcessId(IntPtr hWnd, out uint pid);
  [DllImport("user32.dll")] public static extern bool IsWindowVisible(IntPtr hWnd);
  [DllImport("user32.dll")] public static extern bool GetWindowRect(IntPtr hWnd, out RECT r);
  [DllImport("user32.dll")] public static extern bool GetClientRect(IntPtr hWnd, out RECT r);
  [DllImport("user32.dll")] public static extern bool ClientToScreen(IntPtr hWnd, ref POINT p);
  [DllImport("user32.dll")] public static extern bool SetForegroundWindow(IntPtr hWnd);
  [DllImport("user32.dll")] public static extern bool ShowWindow(IntPtr hWnd, int cmd);
  [DllImport("user32.dll")] public static extern bool BringWindowToTop(IntPtr hWnd);
  [DllImport("user32.dll")] public static extern bool MoveWindow(IntPtr hWnd, int x, int y, int w, int h, bool repaint);
  public struct RECT { public int Left, Top, Right, Bottom; }
  public struct POINT { public int X, Y; }
}
'@
Add-Type $src

$script:found = [IntPtr]::Zero
$script:foundPid = 0
$script:pidFilter = [uint32]$JavaPid
function Find-RefWindow {
  $script:found = [IntPtr]::Zero
  $cb = [RefWin+EnumWindowsProc]{
    param($h, $l)
    if (-not [RefWin]::IsWindowVisible($h)) { return $true }
    $len = [RefWin]::GetWindowTextLength($h)
    if ($len -le 0) { return $true }
    $sb = New-Object System.Text.StringBuilder ($len + 2)
    [void][RefWin]::GetWindowText($h, $sb, $len + 2)
    $t = $sb.ToString()
    if ($t -notmatch '^Minecraft [0-9]+\.[0-9]+') { return $true }
    $wpid = 0
    [void][RefWin]::GetWindowThreadProcessId($h, [ref]$wpid)
    if ($script:pidFilter -ne 0 -and $wpid -ne $script:pidFilter) { return $true }
    $script:found = $h
    $script:foundPid = $wpid
    return $false
  }
  [void][RefWin]::EnumWindows($cb, [IntPtr]::Zero)
  return $script:found
}

$deadline = (Get-Date).AddSeconds($WaitWindowSec)
$hwnd = [IntPtr]::Zero
while ($true) {
  $hwnd = Find-RefWindow
  if ($hwnd -ne [IntPtr]::Zero) { break }
  if ((Get-Date) -ge $deadline) { Write-Output 'NOWINDOW'; exit 2 }
  Start-Sleep -Milliseconds 1000
}
Write-Output "TARGET hwnd=$hwnd pid=$($script:foundPid)"

$wr = New-Object 'RefWin+RECT'
[void][RefWin]::GetWindowRect($hwnd, [ref]$wr)
if ($wr.Left -le -30000) {
  [void][RefWin]::ShowWindow($hwnd, 9)
  Start-Sleep -Milliseconds 500
  [void][RefWin]::GetWindowRect($hwnd, [ref]$wr)
}

if ($ResizeW -gt 0 -and $ResizeH -gt 0) {
  [void][RefWin]::ShowWindow($hwnd, 1)
  [void][RefWin]::MoveWindow($hwnd, $MoveToX, $MoveToY, $ResizeW, $ResizeH, $true)
  Start-Sleep -Milliseconds 600
  [void][RefWin]::GetWindowRect($hwnd, [ref]$wr)
}

if ($Foreground) {
  [void][RefWin]::ShowWindow($hwnd, 9)
  [void][RefWin]::BringWindowToTop($hwnd)
  [void][RefWin]::SetForegroundWindow($hwnd)
  Start-Sleep -Milliseconds 250
}

$cr = New-Object 'RefWin+RECT'
[void][RefWin]::GetClientRect($hwnd, [ref]$cr)
$origin = New-Object 'RefWin+POINT'
$origin.X = 0; $origin.Y = 0
[void][RefWin]::ClientToScreen($hwnd, [ref]$origin)

if ($Rect) {
  Write-Output ("WINDOW {0},{1},{2},{3} size={4}x{5} client={6}x{7} clientorigin={8},{9}" -f `
    $wr.Left, $wr.Top, $wr.Right, $wr.Bottom, ($wr.Right - $wr.Left), ($wr.Bottom - $wr.Top), `
    ($cr.Right - $cr.Left), ($cr.Bottom - $cr.Top), $origin.X, $origin.Y)
}

if ($Out -ne '') {
  $w = $wr.Right - $wr.Left
  $h = $wr.Bottom - $wr.Top
  try {
    $bmp = New-Object System.Drawing.Bitmap $w, $h
    $g = [System.Drawing.Graphics]::FromImage($bmp)
    $g.CopyFromScreen($wr.Left, $wr.Top, 0, 0, $bmp.Size)
    $g.Dispose()
    $bmp.Save($Out, [System.Drawing.Imaging.ImageFormat]::Png)
    $bmp.Dispose()
    Write-Output "SAVED $Out ${w}x${h}"
  } catch {
    Write-Output "CAPTUREFAIL $($_.Exception.Message)"
  }
}

Start-Sleep -Milliseconds $SleepAfter
