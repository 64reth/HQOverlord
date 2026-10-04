# astro-visor-fix.ps1 — repair the astronaut's back-facing walk frames.
#
# Defect: the 8-direction rebuild (25bcb6c7e) regenerated walk.north and the two
# new walk.north-* diagonals with the gold FRONT VISOR painted on several frames,
# so the helmet flickers visor/no-visor while the body walks away. The pre-rebuild
# walk_north art was a clean back-of-helmet on every frame.
#
# Fix: transplant the helmet band (rows contentTop..contentTop+15 — measured: the
# visor lives in rows 6..14, the shoulders start at row 18) from a CLEAN frame of
# the same facing onto each defective frame, x-aligned by the band's opaque
# centroid so the stride bob doesn't shear the helmet.
#   walk_north       0,1,2,4  <- donor walk_north_3   (clean back, same track)
#   walk_north-west  any warm <- donor rot_north-west (clean back, same facing)
#   walk_north-east  any warm <- donor rot_north-east
Add-Type -AssemblyName System.Drawing
$dir = Join-Path $PSScriptRoot "..\frontend\assets\sprites\astronaut"
$BAND = 16

function ContentTop($bmp) {
  for ($y = 0; $y -lt $bmp.Height; $y++) {
    for ($x = 0; $x -lt $bmp.Width; $x++) { if ($bmp.GetPixel($x,$y).A -gt 16) { return $y } }
  }
  return -1
}
function BandWarm($bmp, $top) {
  $c = 0
  $yEnd = [Math]::Min($bmp.Height - 1, $top + $BAND - 1)
  for ($y = $top; $y -le $yEnd; $y++) {
    for ($x = 0; $x -lt $bmp.Width; $x++) {
      $p = $bmp.GetPixel($x,$y)
      if ($p.A -gt 16 -and $p.R -gt 140 -and ($p.R - $p.B) -gt 60) { $c++ }
    }
  }
  return $c
}
function BandCentroidX($bmp, $top) {
  $sum = 0; $n = 0
  $yEnd = [Math]::Min($bmp.Height - 1, $top + $BAND - 1)
  for ($y = $top; $y -le $yEnd; $y++) {
    for ($x = 0; $x -lt $bmp.Width; $x++) {
      if ($bmp.GetPixel($x,$y).A -gt 16) { $sum += $x; $n++ }
    }
  }
  if ($n -eq 0) { return 0 }
  return $sum / $n
}

function FixFrame($targetFile, $donorFile) {
  $tPath = Join-Path $dir $targetFile
  $target = New-Object System.Drawing.Bitmap($tPath)
  $donor  = New-Object System.Drawing.Bitmap((Join-Path $dir $donorFile))
  $tTop = ContentTop $target
  $dTop = ContentTop $donor
  $warm = BandWarm $target $tTop
  if ($warm -eq 0) { $target.Dispose(); $donor.Dispose(); return "skip  $targetFile (clean)" }
  $dx = [int][Math]::Round((BandCentroidX $target $tTop) - (BandCentroidX $donor $dTop))
  # replace the full-width helmet band; rows are pure helmet at this height, so the
  # donor's transparency pattern (helmet silhouette) comes across with it
  for ($r = 0; $r -lt $BAND; $r++) {
    $ty = $tTop + $r; $dy = $dTop + $r
    if ($ty -ge $target.Height -or $dy -ge $donor.Height) { break }
    for ($tx = 0; $tx -lt $target.Width; $tx++) {
      $sx = $tx - $dx
      if ($sx -ge 0 -and $sx -lt $donor.Width) { $p = $donor.GetPixel($sx,$dy) }
      else { $p = [System.Drawing.Color]::FromArgb(0,0,0,0) }
      $target.SetPixel($tx,$ty,$p)
    }
  }
  $donor.Dispose()
  # save via a copy: Bitmap keeps the source file locked while open
  $outBmp = New-Object System.Drawing.Bitmap($target)
  $target.Dispose()
  $outBmp.Save($tPath, [System.Drawing.Imaging.ImageFormat]::Png)
  $outBmp.Dispose()
  return "FIXED $targetFile (warm=$warm, dx=$dx, donor=$donorFile)"
}

foreach ($i in 0..5) { FixFrame "walk_north_$i.png"      "walk_north_3.png" }
foreach ($i in 0..5) { FixFrame "walk_north-west_$i.png" "rot_north-west.png" }
foreach ($i in 0..5) { FixFrame "walk_north-east_$i.png" "rot_north-east.png" }
