# skin-backview-sheets.ps1 — review sheets for every skin's back-facing tracks.
# One row per skin: rot.<dir> reference first, then every walk.<dir> frame, straight
# from the manifest (so the sheet can never drift from what the engine plays).
# Sheets are batched 6 skins tall; separate sheet sets for north / north-east / north-west.
Add-Type -AssemblyName System.Drawing
$root = Join-Path $PSScriptRoot "..\frontend\assets\sprites"
$outDir = Join-Path $PSScriptRoot ".astro-visor\sweep"
New-Item -ItemType Directory -Force $outDir | Out-Null
$man = (Get-Content (Join-Path $root "manifest.json") -Raw | ConvertFrom-Json).sprites

# skin sets in catalog order (matches DATA.SKINS in data-shim.js)
$sets = @('bear','pepe','alien','skeleton','crewmate','capybara','robot','vaultboy',
          'blank','blank_blue','blank_green','blank_red','blank_amber','heisenberg',
          'crthead','astronaut','endoskeleton','ultrondroid','xenomorph','voidwizard',
          'samaltman','dario','secretagent','grimreaper','plaguedoctor','freddyfazbear',
          'ghostface','morpheus','ricksanchez','ninjaturtle','robocop','minionchar',
          'masterchief','pikachu','caseyjones','finn')

$S = 3; $W = 92; $H = 92
foreach ($dirName in @('north','north-east','north-west')) {
  $rows = @()
  foreach ($set in $sets) {
    $rot  = $man.PSObject.Properties["$set.rot.$dirName"]
    $walk = $man.PSObject.Properties["$set.walk.$dirName"]
    if ($null -eq $walk) { continue }   # sets without this facing (pikachu has no diagonals)
    $cells = @()
    if ($rot) { $cells += $rot.Value[0] }
    $cells += $walk.Value
    $rows += ,@($set, $cells)
  }
  $batch = 0
  for ($b = 0; $b -lt $rows.Count; $b += 6) {
    $batchRows = @($rows[$b..([Math]::Min($b+5, $rows.Count-1))])
    $maxCols = 0
    foreach ($br in $batchRows) { $n = @($br[1]).Count; if ($n -gt $maxCols) { $maxCols = $n } }
    Write-Host "batch $batch dir=$dirName rows=$($batchRows.Count) maxCols=$maxCols"
    $bmp = New-Object System.Drawing.Bitmap(($maxCols*$W*$S), ($batchRows.Count*$H*$S))
    $g = [System.Drawing.Graphics]::FromImage($bmp)
    $g.InterpolationMode = [System.Drawing.Drawing2D.InterpolationMode]::NearestNeighbor
    $g.PixelOffsetMode = [System.Drawing.Drawing2D.PixelOffsetMode]::Half
    $g.Clear([System.Drawing.Color]::FromArgb(255,32,32,40))
    $font = New-Object System.Drawing.Font("Consolas", 11)
    $brush = [System.Drawing.Brushes]::White
    for ($r = 0; $r -lt $batchRows.Count; $r++) {
      $set = $batchRows[$r][0]; $cells = $batchRows[$r][1]
      for ($c = 0; $c -lt $cells.Count; $c++) {
        $p = Join-Path $root ($cells[$c] -replace '/', '\')
        if (Test-Path $p) {
          $im = [System.Drawing.Image]::FromFile($p)
          $g.DrawImage($im, ($c*$W*$S), ($r*$H*$S), ($W*$S), ($H*$S))
          $im.Dispose()
        }
      }
      $g.DrawString($set, $font, $brush, 4, ($r*$H*$S) + 4)
    }
    $g.Dispose()
    $name = "sweep_{0}_{1}.png" -f $dirName, $batch
    $bmp.Save((Join-Path $outDir $name), [System.Drawing.Imaging.ImageFormat]::Png)
    $bmp.Dispose()
    $batch++
  }
  "$dirName -> $batch sheet(s)"
}
