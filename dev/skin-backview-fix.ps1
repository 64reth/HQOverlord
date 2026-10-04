# skin-backview-fix.ps1 — repair every back-facing walk track the 8-direction
# rebuild (25bcb6c7e) regressed. Three repair modes, least invasive that works:
#
#  RESTORE   whole track from pre-rebuild git (defect is full-frame: front pose
#            in a north slot, and the old art is clean + style-consistent):
#              secretagent.walk.north, ninjaturtle.walk.north, finn.walk.north
#  TRANSPLANT head band from the same-facing rot frame (defect is face features
#            on the head only; no accessory crosses the band):
#              ninjaturtle NE/NW, bear NW, heisenberg NW, secretagent NW
#  RECOLOR   just the defect pixels, healed from the same row's local shading
#            (defect is a few feature pixels; a transplant would risk an
#            accessory crossing the band — grimreaper's scythe — or is overkill):
#              grimreaper NW (skull), masterchief NE (visor gold),
#              ultrondroid NW (red eye), plaguedoctor NW (cyan lenses)
Add-Type -AssemblyName System.Drawing
$repo = Split-Path $PSScriptRoot
$dir = Join-Path $repo "frontend\assets\sprites"
$PRE = "25bcb6c7e~1"

function ContentTop($bmp) {
  for ($y = 0; $y -lt $bmp.Height; $y++) {
    for ($x = 0; $x -lt $bmp.Width; $x++) { if ($bmp.GetPixel($x,$y).A -gt 16) { return $y } }
  }
  return -1
}
function BandCentroidX($bmp, $top, $band) {
  $sum = 0; $n = 0
  $yEnd = [Math]::Min($bmp.Height - 1, $top + $band - 1)
  for ($y = $top; $y -le $yEnd; $y++) {
    for ($x = 0; $x -lt $bmp.Width; $x++) { if ($bmp.GetPixel($x,$y).A -gt 16) { $sum += $x; $n++ } }
  }
  if ($n -eq 0) { return 46 }
  return $sum / $n
}
function SaveOver($bmp, $path) {
  $out = New-Object System.Drawing.Bitmap($bmp)
  $bmp.Dispose()
  $out.Save($path, [System.Drawing.Imaging.ImageFormat]::Png)
  $out.Dispose()
}

# ---- 1. RESTORE pre-rebuild tracks ----
foreach ($set in @('secretagent','ninjaturtle','finn')) {
  foreach ($i in 0..5) {
    $rel = "frontend/assets/sprites/$set/walk_north_$i.png"
    $dst = Join-Path $repo ($rel -replace '/', '\')
    cmd /c "git -C `"$repo`" show ${PRE}:$rel > `"$dst`""
    if ($LASTEXITCODE -ne 0) { throw "git show failed for $rel" }
  }
  "restored $set walk_north 0-5"
}

# ---- 2. TRANSPLANT head bands ----
function Transplant($set, $frameFile, $donorFile, $band) {
  $tPath = Join-Path $dir "$set\$frameFile"
  $target = New-Object System.Drawing.Bitmap($tPath)
  $donor  = New-Object System.Drawing.Bitmap((Join-Path $dir "$set\$donorFile"))
  $tTop = ContentTop $target; $dTop = ContentTop $donor
  $dx = [int][Math]::Round((BandCentroidX $target $tTop $band) - (BandCentroidX $donor $dTop $band))
  for ($r = 0; $r -lt $band; $r++) {
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
  SaveOver $target $tPath
  "transplant $set/$frameFile <- $donorFile (band=$band, dx=$dx)"
}
foreach ($i in 0..5) { Transplant 'ninjaturtle' "walk_north-east_$i.png" 'rot_north-east.png' 22 }
foreach ($i in 0..5) { Transplant 'ninjaturtle' "walk_north-west_$i.png" 'rot_north-west.png' 22 }
foreach ($i in 0..5) { Transplant 'bear'        "walk_north-west_$i.png" 'rot_north-west.png' 18 }
foreach ($i in 0..5) { Transplant 'heisenberg'  "walk_north-west_$i.png" 'rot_north-west.png' 18 }
foreach ($i in 0..5) { Transplant 'secretagent' "walk_north-west_$i.png" 'rot_north-west.png' 16 }

# ---- 3. RECOLOR defect pixels from row-local shading ----
function HealRow($bmp, $x, $y, $isBad) {
  for ($d = 1; $d -lt 20; $d++) {
    foreach ($sx in @(($x - $d), ($x + $d))) {
      if ($sx -lt 0 -or $sx -ge $bmp.Width) { continue }
      $p = $bmp.GetPixel($sx, $y)
      if ($p.A -gt 16 -and -not (& $isBad $p)) { return $p }
    }
  }
  return $null
}
function Recolor($set, $frameFile, $band, $isBad) {
  $tPath = Join-Path $dir "$set\$frameFile"
  $bmp = New-Object System.Drawing.Bitmap($tPath)
  $top = ContentTop $bmp
  $fixed = 0
  $yEnd = [Math]::Min($bmp.Height - 1, $top + $band - 1)
  for ($y = $top; $y -le $yEnd; $y++) {
    for ($x = 0; $x -lt $bmp.Width; $x++) {
      $p = $bmp.GetPixel($x,$y)
      if ($p.A -gt 16 -and (& $isBad $p)) {
        $h = HealRow $bmp $x $y $isBad
        if ($h) { $bmp.SetPixel($x,$y,$h); $fixed++ }
      }
    }
  }
  SaveOver $bmp $tPath
  "recolor $set/$frameFile fixed=$fixed"
}
$skull  = { param($p) ($p.R -gt 170 -and $p.G -gt 170 -and $p.B -gt 170) }
$gold   = { param($p) ($p.R -gt 150 -and ($p.R - $p.B) -gt 60) }
$redeye = { param($p) ($p.R -gt 110 -and $p.R -gt ($p.G * 1.6) -and $p.R -gt ($p.B * 1.6)) }
$cyan   = { param($p) ($p.B -gt 80 -and $p.B -gt ($p.R * 1.25)) }   # lenses measured at (5,178,171)/(5,79,161)/(6,37,97)
foreach ($i in 0..5) { Recolor 'grimreaper'   "walk_north-west_$i.png" 26 $skull }
foreach ($i in 0..5) { Recolor 'masterchief'  "walk_north-east_$i.png" 18 $gold }
foreach ($i in 0..5) { Recolor 'ultrondroid'  "walk_north-west_$i.png" 16 $redeye }
foreach ($i in 0..5) { Recolor 'plaguedoctor' "walk_north-west_$i.png" 20 $cyan }
