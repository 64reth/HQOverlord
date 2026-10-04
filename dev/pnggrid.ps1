# dev/pnggrid.ps1 — lay labelled PNGs out in a grid contact sheet.
#   pwsh dev/pnggrid.ps1 -Out sheet.png -Title "..." -Cells "label=a.png" "label2=b.png" -Cols 5
param(
  [Parameter(Mandatory=$true)][string]$Out,
  [Parameter(Mandatory=$true)][string[]]$Cells,
  [string]$Title = '',
  [int]$Cols = 5,
  [int]$Gap = 10,
  [int]$Head = 22
)
Add-Type -AssemblyName System.Drawing

$items = @()
foreach ($c in $Cells) {
  $label, $file = $c -split '=', 2
  $items += [pscustomobject]@{ Label = $label; Img = [System.Drawing.Bitmap]::FromFile((Resolve-Path $file).Path) }
}
$cw = ($items | ForEach-Object { $_.Img.Width } | Measure-Object -Maximum).Maximum
$ch = ($items | ForEach-Object { $_.Img.Height } | Measure-Object -Maximum).Maximum
# [int] casts are load-bearing: Ceiling returns a double, and the Bitmap ctor rejects a double
# with a bare "Parameter is not valid" that points at the constructor, not at the arithmetic.
$rows = [int][Math]::Ceiling($items.Count / $Cols)
$top = if ($Title) { 30 } else { 4 }
$w = [int]($Cols * $cw + ($Cols + 1) * $Gap)
$h = [int]($top + $rows * ($ch + $Head + $Gap) + $Gap)

$dst = New-Object System.Drawing.Bitmap -ArgumentList $w, $h
$g = [System.Drawing.Graphics]::FromImage($dst)
$g.InterpolationMode = [System.Drawing.Drawing2D.InterpolationMode]::NearestNeighbor
$g.PixelOffsetMode = [System.Drawing.Drawing2D.PixelOffsetMode]::Half
$g.Clear([System.Drawing.Color]::FromArgb(255, 12, 12, 14))
$fT = New-Object System.Drawing.Font 'Consolas', 14, ([System.Drawing.FontStyle]::Bold)
$fL = New-Object System.Drawing.Font 'Consolas', 12
$white = New-Object System.Drawing.SolidBrush ([System.Drawing.Color]::FromArgb(255, 235, 232, 226))
$amber = New-Object System.Drawing.SolidBrush ([System.Drawing.Color]::FromArgb(255, 255, 200, 90))
if ($Title) { $g.DrawString($Title, $fT, $white, 8, 6) }

for ($i = 0; $i -lt $items.Count; $i++) {
  $r = [Math]::Floor($i / $Cols); $c = $i % $Cols
  $x = $Gap + $c * ($cw + $Gap)
  $y = $top + $r * ($ch + $Head + $Gap)
  $g.DrawString($items[$i].Label, $fL, $amber, $x, $y)
  $g.DrawImage($items[$i].Img, $x, ($y + $Head), $items[$i].Img.Width, $items[$i].Img.Height)
}
$g.Dispose()
$outAbs = [System.IO.Path]::GetFullPath((Join-Path (Get-Location).Path $Out))
$dst.Save($outAbs, [System.Drawing.Imaging.ImageFormat]::Png)
$dst.Dispose()
foreach ($it in $items) { $it.Img.Dispose() }
Write-Output $outAbs
