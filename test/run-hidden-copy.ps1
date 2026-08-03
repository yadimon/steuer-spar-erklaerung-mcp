param(
  [Parameter(Mandatory = $true)]
  [string]$Source,
  [string]$TestScript = 'hidden-console-smoke.mjs',
  [switch]$HiddenTables
)

$ErrorActionPreference = 'Stop'
$repoRoot = [IO.Path]::GetFullPath((Join-Path $PSScriptRoot '..'))
$tempRoot = [IO.Path]::GetFullPath((Join-Path $repoRoot '.tmp'))
$target = [IO.Path]::GetFullPath((Join-Path $tempRoot 'codex-api-hidden-test.Gew2025'))

if (-not (Test-Path -LiteralPath $Source -PathType Leaf)) {
  throw "Fixture-Quelle fehlt: $Source"
}
if (-not $target.StartsWith($tempRoot + [IO.Path]::DirectorySeparatorChar, [StringComparison]::OrdinalIgnoreCase)) {
  throw 'Temp-Ziel liegt ausserhalb des Repo-Tempordners.'
}
if (Test-Path -LiteralPath $target) {
  throw "Temp-Ziel existiert bereits: $target"
}

New-Item -ItemType Directory -Path $tempRoot -Force | Out-Null
$sourceHash = (Get-FileHash -LiteralPath $Source -Algorithm SHA256).Hash
$testExit = 1
try {
  Copy-Item -LiteralPath $Source -Destination $target
  $copyHash = (Get-FileHash -LiteralPath $target -Algorithm SHA256).Hash
  if ($copyHash -ne $sourceHash) { throw 'Arbeitskopie ist nicht bytegleich.' }

  $testPath = [IO.Path]::GetFullPath((Join-Path $PSScriptRoot $TestScript))
  if (-not $testPath.StartsWith($PSScriptRoot + [IO.Path]::DirectorySeparatorChar, [StringComparison]::OrdinalIgnoreCase)) {
    throw 'Testskript liegt ausserhalb des Testordners.'
  }
  if (-not (Test-Path -LiteralPath $testPath -PathType Leaf)) { throw "Testskript fehlt: $testPath" }
  switch ([IO.Path]::GetFileName($testPath)) {
    'hidden-console-smoke.mjs' { $env:SSE_HIDDEN_FIXTURE = $target }
    'hidden-start-page.mjs' { $env:SSE_HIDDEN_FIXTURE = $target }
    'hidden-desktop-lifecycle.mjs' { $env:SSE_HIDDEN_FIXTURE = $target }
    'table-add-transaction.mjs' {
      $env:SSE_TABLE_ADD_FIXTURE = $target
      if (-not $HiddenTables) { $env:SSE_TABLE_VISIBLE = '1' } else { Remove-Item Env:SSE_TABLE_VISIBLE -ErrorAction SilentlyContinue }
    }
    'table-update-transaction.mjs' {
      $env:SSE_TABLE_UPDATE_FIXTURE = $target
      if (-not $HiddenTables) { $env:SSE_TABLE_VISIBLE = '1' } else { Remove-Item Env:SSE_TABLE_VISIBLE -ErrorAction SilentlyContinue }
    }
    'table-delete-transaction.mjs' { $env:SSE_TABLE_DELETE_FIXTURE = $target }
    default { throw "Testskript ist fuer den geschuetzten Fixture-Lauf nicht freigegeben: $testPath" }
  }
  & node (Join-Path $PSScriptRoot 'with-api.mjs') node $testPath
  $testExit = $LASTEXITCODE

  $copyHashAfter = (Get-FileHash -LiteralPath $target -Algorithm SHA256).Hash
  $sourceHashAfter = (Get-FileHash -LiteralPath $Source -Algorithm SHA256).Hash
  if ($copyHashAfter -ne $copyHash -or $sourceHashAfter -ne $sourceHash) {
    throw 'Quelle oder Arbeitskopie wurde durch den Test veraendert.'
  }
} finally {
  if (Test-Path -LiteralPath $target) {
    Remove-Item -LiteralPath $target -Force
  }
}

exit $testExit
