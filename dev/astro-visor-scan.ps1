# astro-visor-scan.ps1 — count visor-gold pixels inside the helmet band of every
# north-ish astronaut frame. The astronaut's suit is orange too, so the scan is
# restricted to the HELMET BAND: rows contentTop .. contentTop+bandRows-1.
# A clean back-of-helmet has zero warm pixels there; any warm pixel = front visor.
Add-Type -AssemblyName System.Drawing
$dir = Join-Path $PSScriptRoot "..\frontend\assets\sprites\astronaut"
$bandRows = 26   # helmet vertical extent on the 92px master, measured from content top

function Scan($file) {
  $bmp = New-Object System.Drawing.Bitmap((Join-Path $dir $file))
  $top = -1
  for ($y = 0; $y -lt $bmp.Height -and $top -lt 0; $y++) {
    for ($x = 0; $x -lt $bmp.Width; $x++) {
      if ($bmp.GetPixel($x, $y).A -gt 16) { $top = $y; break }
    }
  }
  $warm = 0
  if ($top -ge 0) {
    $yEnd = [Math]::Min($bmp.Height - 1, $top + $bandRows - 1)
    for ($y = $top; $y -le $yEnd; $y++) {
      for ($x = 0; $x -lt $bmp.Width; $x++) {
        $p = $bmp.GetPixel($x, $y)
        if ($p.A -gt 16 -and $p.R -gt 150 -and ($p.R - $p.B) -gt 70 -and $p.G -lt 210) { $warm++ }
      }
    }
  }
  $bmp.Dispose()
  "{0,-28} top={1,2} visorPx={2}" -f $file, $top, $warm
}

$files = @('rot_north.png','rot_north-east.png','rot_north-west.png')
$files += (0..5 | ForEach-Object { "walk_north_$_.png" })
$files += (0..5 | ForEach-Object { "walk_north-east_$_.png" })
$files += (0..5 | ForEach-Object { "walk_north-west_$_.png" })
$files += (0..8 | ForEach-Object { "gesture_north_$_.png" })
$files += @('sit_north.png')
foreach ($f in $files) { if (Test-Path (Join-Path $dir $f)) { Scan $f } }
