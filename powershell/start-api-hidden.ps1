param(
  [Parameter(Mandatory = $true)]
  [string]$RepoRoot,
  [Parameter(Mandatory = $true)]
  [string]$ConfigPath
)

$ErrorActionPreference = 'Stop'
. (Join-Path $PSScriptRoot 'api-task-common.ps1')
$repo = [IO.Path]::GetFullPath($RepoRoot)
$config = [IO.Path]::GetFullPath($ConfigPath)
$apiMain = Join-Path $repo 'dist\api-main.js'
if (-not (Test-Path -LiteralPath $apiMain -PathType Leaf)) { throw "API fehlt: $apiMain" }
if (-not (Test-Path -LiteralPath $config -PathType Leaf)) { throw "Konfiguration fehlt: $config" }
$node = Resolve-SseNodePath -RepoRoot $repo

Set-Location -LiteralPath $repo
& $node $apiMain --config $config
exit $LASTEXITCODE
