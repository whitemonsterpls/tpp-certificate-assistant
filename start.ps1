param([switch]$NoBrowser)

$ErrorActionPreference = 'Stop'
$projectDir = Split-Path -Parent $MyInvocation.MyCommand.Path
$runtimeRoot = Join-Path $env:USERPROFILE '.cache\codex-runtimes\codex-primary-runtime\dependencies'
$bundledNode = Join-Path $runtimeRoot 'node\bin\node.exe'
$bundledModules = Join-Path $runtimeRoot 'node\node_modules'

if (Test-Path -LiteralPath (Join-Path $projectDir 'node_modules')) {
    $node = (Get-Command node -ErrorAction SilentlyContinue).Source
} elseif ((Test-Path -LiteralPath $bundledNode) -and (Test-Path -LiteralPath $bundledModules)) {
    $node = $bundledNode
    $env:NODE_PATH = $bundledModules
} else {
    $node = (Get-Command node -ErrorAction SilentlyContinue).Source
}

if (-not $node) {
    Write-Host 'Node.js was not found. Install Node.js 20 or newer, then run: npm install' -ForegroundColor Red
    Read-Host 'Press Enter to close'
    exit 1
}

Set-Location -LiteralPath $projectDir
$serverArgs = @('src\server.js')
if ($NoBrowser) { $serverArgs += '--no-browser' }
& $node $serverArgs
