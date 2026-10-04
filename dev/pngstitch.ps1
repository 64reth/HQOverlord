# dev/pngstitch.ps1 — stitch labelled BEFORE/AFTER panels into one comparison sheet.
#   pwsh dev/pngstitch.ps1 -Out sheet.png -Pairs "label=before.png|after.png" "label2=b2.png|a2.png"
param(
  [Parameter(Mandatory=$true)][string]$Out,
  [Parameter(Mandatory=$true)][string[]]$Pairs,
  [int]$Gap = 14,
  [int]$Head = 30
)
Add-Type -AssemblyName System.Drawing

$rows = @()
foreach ($p in $Pairs) {
  $label, $files = $p -split '=', 2
  $b, $a = $files -split '\|', 2
  $rows += [pscustomobject]@{
    Label = $label
    B = [System.Drawing.Bitmap]::FromFile((Resolve-Path $b).Path)
    A = [System.Drawing.Bitmap]::FromFile((Resolve-Path $a).Path)
  }
}
$w = 0; $h = $Head
foreach ($r in $rows) {
  $rw = $r.B.Width + $Gap + $r.A.Width
  if ($rw -gt $w) { $w = $rw }
  $h += $Head + [Math]::Max($r.B.Height, $r.A.Height) + $Gap
}

$dst = New-Object System.Drawing.Bitmap -ArgumentList $w, $h
$g = [System.Drawing.Graphics]::FromImage($dst)
$g.InterpolationMode = [System.Drawing.Drawing2D.InterpolationMode]::NearestNeighbor
$g.PixelOffsetMode = [System.Drawing.Drawing2D.PixelOffsetMode]::Half
$g.Clear([System.Drawing.Color]::FromArgb(255, 12, 12, 14))
$fontHead = New-Object System.Drawing.Font 'Consolas', 15, ([System.Drawing.FontStyle]::Bold)
$font = New-Object System.Drawing.Font 'Consolas', 13
$white = New-Object System.Drawing.SolidBrush ([System.Drawing.Color]::FromArgb(255, 235, 232, 226))
$amber = New-Object System.Drawing.SolidBrush ([System.Drawing.Color]::FromArgb(255, 255, 190, 70))
$green = New-Object System.Drawing.SolidBrush ([System.Drawing.Color]::FromArgb(255, 130, 230, 150))

$y = 6
$g.DrawString('STATION WALL CORNERS -- BEFORE / AFTER (bake pixels, nearest-neighbour zoom)', $fontHead, $white, 8, $y)
$y += $Head
foreach ($r in $rows) {
  $g.DrawString($r.Label, $font, $white, 8, $y)
  $g.DrawString('BEFORE', $font, $amber, 8, ($y + 14))
  $g.DrawString('AFTER', $font, $green, ($r.B.Width + $Gap + 8), ($y + 14))
  $top = $y + $Head
  $g.DrawImage($r.B, 0, $top, $r.B.Width, $r.B.Height)
  $g.DrawImage($r.A, ($r.B.Width + $Gap), $top, $r.A.Width, $r.A.Height)
  $y = $top + [Math]::Max($r.B.Height, $r.A.Height) + $Gap
}
$g.Dispose()
$outAbs = [System.IO.Path]::GetFullPath((Join-Path (Get-Location).Path $Out))
$dst.Save($outAbs, [System.Drawing.Imaging.ImageFormat]::Png)
$dst.Dispose()
foreach ($r in $rows) { $r.B.Dispose(); $r.A.Dispose() }
Write-Output $outAbs
