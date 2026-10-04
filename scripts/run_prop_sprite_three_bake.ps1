$ErrorActionPreference = "Stop"

$root = Resolve-Path -LiteralPath (Join-Path $PSScriptRoot "..")
$nodeModules = Join-Path $env:USERPROFILE ".cache\codex-runtimes\codex-primary-runtime\dependencies\node\node_modules"
$playwrightCore = Join-Path $nodeModules ".pnpm\playwright-core@1.61.0\node_modules"
$playwright = Join-Path $nodeModules ".pnpm\playwright@1.61.0\node_modules"

$paths = @($nodeModules, $playwrightCore, $playwright) | Where-Object { Test-Path -LiteralPath $_ }
if ($paths.Count -lt 3) {
  throw "Codex bundled Playwright packages were not found under $nodeModules"
}

$env:NODE_PATH = ($paths -join ";")
Push-Location $root
try {
  node scripts\prop_sprite_three_bake.cjs
  if ($LASTEXITCODE -ne 0) {
    exit $LASTEXITCODE
  }
} finally {
  Pop-Location
}
