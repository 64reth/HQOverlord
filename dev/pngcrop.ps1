# dev/pngcrop.ps1 — nearest-neighbour crop/zoom out of a baked station PNG, for before/after
# comparison without re-running the CDP probe. Coordinates are BAKE PIXELS.
#   pwsh dev/pngcrop.ps1 -In a.png -Out a.crop.png -X 240 -Y 192 -W 72 -H 72 -Zoom 10
param(
  [Parameter(Mandatory=$true)][string]$In,
  [Parameter(Mandatory=$true)][string]$Out,
  [Parameter(Mandatory=$true)][int]$X,
  [Parameter(Mandatory=$true)][int]$Y,
  [Parameter(Mandatory=$true)][int]$W,
  [Parameter(Mandatory=$true)][int]$H,
  [int]$Zoom = 10
)
Add-Type -AssemblyName System.Drawing
$src = [System.Drawing.Bitmap]::FromFile((Resolve-Path $In).Path)
$dst = New-Object System.Drawing.Bitmap -ArgumentList ($W * $Zoom), ($H * $Zoom)
$g = [System.Drawing.Graphics]::FromImage($dst)
$g.InterpolationMode = [System.Drawing.Drawing2D.InterpolationMode]::NearestNeighbor
$g.PixelOffsetMode = [System.Drawing.Drawing2D.PixelOffsetMode]::Half
$destRect = New-Object System.Drawing.Rectangle -ArgumentList 0, 0, ($W * $Zoom), ($H * $Zoom)
$srcRect = New-Object System.Drawing.Rectangle -ArgumentList $X, $Y, $W, $H
$g.DrawImage($src, $destRect, $srcRect, [System.Drawing.GraphicsUnit]::Pixel)
$g.Dispose()
$outAbs = [System.IO.Path]::GetFullPath((Join-Path (Get-Location).Path $Out))
$dst.Save($outAbs, [System.Drawing.Imaging.ImageFormat]::Png)
$dst.Dispose(); $src.Dispose()
Write-Output "$Out"
