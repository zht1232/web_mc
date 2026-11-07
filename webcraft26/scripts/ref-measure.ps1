param(
  [string]$Dir = 'G:\web_mc\webcraft26\shots\ref'
)

Add-Type -AssemblyName System.Drawing

function BBox([System.Drawing.Bitmap]$bmp, [int]$x0, [int]$y0, [int]$x1, [int]$y1, [int]$minLum) {
  $minX = 99999; $minY = 99999; $maxX = -1; $maxY = -1; $count = 0
  for ($y = $y0; $y -le $y1; $y++) {
    for ($x = $x0; $x -le $x1; $x++) {
      $c = $bmp.GetPixel($x, $y)
      $lum = [int](0.299 * $c.R + 0.587 * $c.G + 0.114 * $c.B)
      if ($lum -ge $minLum) {
        $count++
        if ($x -lt $minX) { $minX = $x }
        if ($x -gt $maxX) { $maxX = $x }
        if ($y -lt $minY) { $minY = $y }
        if ($y -gt $maxY) { $maxY = $y }
      }
    }
  }
  if ($count -eq 0) { return 'none' }
  return ("x={0}..{1} y={2}..{3} w={4} h={5} px={6}" -f $minX, $maxX, $minY, $maxY, ($maxX - $minX + 1), ($maxY - $minY + 1), $count)
}

# moon core + glow in the pitch=-55 sky shot
$bmp = [System.Drawing.Bitmap]::FromFile((Join-Path $Dir 'ref-night-18000-sky-nohud.png'))
Write-Output ("moon glow lum>=80  : " + (BBox $bmp 500 100 800 300 80))
Write-Output ("moon core lum>=200 : " + (BBox $bmp 500 100 800 300 200))
$bmp.Dispose()

# sun core in the sunset shot (restrict to upper-middle to avoid clouds near frame edges)
$bmp = [System.Drawing.Bitmap]::FromFile((Join-Path $Dir 'ref-sunset-11800-sun.png'))
Write-Output ("sun  core lum>=250 : " + (BBox $bmp 300 60 1200 320 250))
Write-Output ("sun  glow lum>=140 : " + (BBox $bmp 300 60 1200 320 140))
$bmp.Dispose()

# horizon scan at x=300 (clear of the centered crosshair)
foreach ($n in @('ref-day-6000-level', 'ref-dusk-12500-level', 'ref-night-18000-level')) {
  $bmp = [System.Drawing.Bitmap]::FromFile((Join-Path $Dir ($n + '.png')))
  $prev = $null
  for ($y = 300; $y -le 400; $y += 2) {
    $c = $bmp.GetPixel(300, $y)
    $line = ("{0} x=300 y={1} #{2:X2}{3:X2}{4:X2}" -f $n, $y, $c.R, $c.G, $c.B)
    if ($y % 10 -eq 0) { Write-Output $line }
  }
  $bmp.Dispose()
}
