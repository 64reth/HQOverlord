# astro-visor-scan2.ps1 — per-row warm-pixel histogram of the helmet band, and a
# marked-up contact sheet (warm pixels inside the band painted magenta) so the
# detector's idea of "visor" can be checked by eye before any repaint trusts it.
Add-Type -AssemblyName System.Drawing
$dir = Join-Path $PSScriptRoot "..\frontend\assets\sprites\astronaut"
$out = Join-Path $PSScriptRoot "..\dev\.astro-visor"
New-Item -ItemType Directory -Force $out | Out-Null
$bandRows = 18   # tighter: the visor sits in the upper helmet, above the shoulder rows

function IsWarm($p) {
  return ($p.A -gt 16 -and $p.R -gt 140 -and ($p.R - $p.B) -gt 60)
}

$files = @('rot_north.png','walk_north_0.png','walk_north_3.png',
           'rot_north-west.png','walk_north-west_1.png','walk_north-west_4.png',
           'rot_north-east.png','walk_north-east_1.png',
           'gesture_north_4.png','sit_north.png')
$S = 5; $W = 92; $H = 92
$sheet = New-Object System.Drawing.Bitmap(($files.Count * $W * $S), ($H * $S))
$g = [System.Drawing.Graphics]::FromImage($sheet)
$g.InterpolationMode = [System.Drawing.Drawing2D.InterpolationMode]::NearestNeighbor
$g.PixelOffsetMode = [System.Drawing.Drawing2D.PixelOffsetMode]::Half
$g.Clear([System.Drawing.Color]::FromArgb(255,32,32,40))
$magenta = [System.Drawing.Color]::FromArgb(255,255,0,255)

for ($i = 0; $i -lt $files.Count; $i++) {
  $bmp = New-Object System.Drawing.Bitmap((Join-Path $dir $files[$i]))
  $top = -1
  for ($y = 0; $y -lt $bmp.Height -and $top -lt 0; $y++) {
    for ($x = 0; $x -lt $bmp.Width; $x++) { if ($bmp.GetPixel($x,$y).A -gt 16) { $top = $y; break } }
  }
  $marked = New-Object System.Drawing.Bitmap($bmp)
  $count = 0
  $yEnd = [Math]::Min($bmp.Height - 1, $top + $bandRows - 1)
  for ($y = $top; $y -le $yEnd; $y++) {
    for ($x = 0; $x -lt $bmp.Width; $x++) {
      if (IsWarm $bmp.GetPixel($x,$y)) { $marked.SetPixel($x,$y,$magenta); $count++ }
    }
  }
  "{0,-26} top={1,2} band18warm={2}" -f $files[$i], $top, $count
  $g.DrawImage($marked, ($i*$W*$S), 0, ($W*$S), ($H*$S))
  $bmp.Dispose(); $marked.Dispose()
}
$g.Dispose()
$sheet.Save((Join-Path $out "marked.png"), [System.Drawing.Imaging.ImageFormat]::Png)
$sheet.Dispose()
"sheet: $out\marked.png"
