param(
  [string]$Dir = 'G:\web_mc\webcraft26\shots\ref'
)

Add-Type -AssemblyName System.Drawing

function Avg([System.Drawing.Bitmap]$bmp, [int]$x0, [int]$y0, [int]$x1, [int]$y1) {
  [long]$r = 0; [long]$g = 0; [long]$b = 0; [long]$n = 0
  $stepX = [Math]::Max(1, [int](($x1 - $x0) / 40))
  $stepY = [Math]::Max(1, [int](($y1 - $y0) / 40))
  for ($y = $y0; $y -le $y1; $y += $stepY) {
    for ($x = $x0; $x -le $x1; $x += $stepX) {
      $c = $bmp.GetPixel($x, $y)
      $r += $c.R; $g += $c.G; $b += $c.B; $n++
    }
  }
  if ($n -eq 0) { return '#000000' }
  return ('#{0:X2}{1:X2}{2:X2}' -f [int]($r / $n), [int]($g / $n), [int]($b / $n))
}

foreach ($f in Get-ChildItem $Dir -Filter 'ref-*.png' | Sort-Object Name) {
  $bmp = [System.Drawing.Bitmap]::FromFile($f.FullName)
  $top = Avg $bmp 200 20 1080 60
  $mid = Avg $bmp 200 150 1080 200
  $hor = Avg $bmp 200 300 1080 330
  $far = Avg $bmp 200 370 1080 390
  $near = Avg $bmp 80 650 250 700
  Write-Output ("{0};{1};{2};{3};{4};{5}" -f $f.BaseName, $top, $mid, $hor, $far, $near)
  $bmp.Dispose()
}
