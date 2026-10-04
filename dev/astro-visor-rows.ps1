# astro-visor-rows.ps1 — per-row warm counts (relative to content top) for the
# defective frames, to size the transplant band: it must cover the visor's last
# row but stop above the shoulders.
Add-Type -AssemblyName System.Drawing
$dir = Join-Path $PSScriptRoot "..\frontend\assets\sprites\astronaut"
foreach ($f in @('walk_north_0.png','walk_north-west_0.png','walk_north-west_5.png','rot_north.png')) {
  $bmp = New-Object System.Drawing.Bitmap((Join-Path $dir $f))
  $top = -1
  for ($y = 0; $y -lt $bmp.Height -and $top -lt 0; $y++) {
    for ($x = 0; $x -lt $bmp.Width; $x++) { if ($bmp.GetPixel($x,$y).A -gt 16) { $top = $y; break } }
  }
  $rows = @()
  for ($r = 0; $r -lt 34; $r++) {
    $y = $top + $r; if ($y -ge $bmp.Height) { break }
    $c = 0
    for ($x = 0; $x -lt $bmp.Width; $x++) {
      $p = $bmp.GetPixel($x,$y)
      if ($p.A -gt 16 -and $p.R -gt 140 -and ($p.R - $p.B) -gt 60) { $c++ }
    }
    if ($c -gt 0) { $rows += "r$r=$c" }
  }
  "{0,-24} top={1}  {2}" -f $f, $top, ($rows -join ' ')
  $bmp.Dispose()
}
