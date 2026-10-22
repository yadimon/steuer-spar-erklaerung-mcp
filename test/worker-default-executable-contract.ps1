param([string]$WorkerPath = (Join-Path $PSScriptRoot '../powershell/sse-worker.ps1'))
$ErrorActionPreference = 'Stop'

# Load only the real profile initializer and its pure file readers. Never run
# worker top-level initialization, a controller, a desktop or an executable.
function Read-SourceAst([string]$Path) {
  $tokens = $null; $errors = $null
  $parsed = [Management.Automation.Language.Parser]::ParseFile($Path, [ref]$tokens, [ref]$errors)
  if ($errors.Count) { throw "Cannot parse fixture source: $Path" }
  $parsed
}
$workerAst = Read-SourceAst $WorkerPath
$transportAst = Read-SourceAst (Join-Path $PSScriptRoot '../powershell/worker-transport-common.ps1')
foreach ($entry in @(
  @{ast=$transportAst; name='Read-SSEBoundedUtf8File'},
  @{ast=$workerAst; name='Read-SSEJsonFileStrict'},
  @{ast=$workerAst; name='Test-SSEExactProperties'},
  @{ast=$workerAst; name='Initialize-SSEProductProfile'},
  @{ast=$workerAst; name='Get-SSEExecutableIdentity'}
)) {
  $definitions = @($entry.ast.FindAll({param($node)
    $node -is [Management.Automation.Language.FunctionDefinitionAst]
  }, $true) | Where-Object {$_.Name -ceq $entry.name})
  if ($definitions.Count -ne 1) { throw "Expected one production function: $($entry.name)" }
  . ([scriptblock]::Create($definitions[0].Extent.Text))
}
function Fail($Message, $Kind) { $script:failureKind = $Kind; throw $Message }
function Assert-Equal($Actual, $Expected, [string]$Message) {
  if ($Actual -cne $Expected) { throw $Message }
}
function New-ExecutableFixture([string]$Root) {
  $path = [IO.Path]::GetFullPath((Join-Path $Root $relativeExe))
  $null = [IO.Directory]::CreateDirectory([IO.Path]::GetDirectoryName($path))
  [IO.File]::WriteAllBytes($path, [byte[]]@())
  $path
}
function Invoke-ProfileFixture([string]$ProgramFiles, [string]$ProgramFilesX86, [string]$Explicit) {
  $env:ProgramFiles = $ProgramFiles
  ${env:ProgramFiles(x86)} = $ProgramFilesX86
  $env:SSE_EXECUTABLE = $Explicit
  $script:SSE_DEFAULT_EXE = $null
  $script:SSE_EXE_IDENTITY_CACHE = @{}
  $script:failureKind = $null
  Initialize-SSEProductProfile
  $script:SSE_DEFAULT_EXE
}

$savedEnvironment = @{
  ProgramFiles=$env:ProgramFiles
  'ProgramFiles(x86)'=${env:ProgramFiles(x86)}
  SSE_EXECUTABLE=$env:SSE_EXECUTABLE
}
$temporaryParent = [IO.Path]::GetFullPath([IO.Path]::GetTempPath()).TrimEnd('\') + '\'
$temporaryRoot = [IO.Path]::GetFullPath((Join-Path $temporaryParent ('sse-executable-fixture-' + [guid]::NewGuid().ToString('N'))))
$script:SSE_PROFILE_ID = '2025'
$script:SSE_PROFILE_DIR = [IO.Path]::GetFullPath((Join-Path $PSScriptRoot '../profiles/2025'))
$manifest = Get-Content -LiteralPath (Join-Path $script:SSE_PROFILE_DIR 'profile.json') -Raw | ConvertFrom-Json
$relativeExe = ([string]$manifest.executable.defaultRelativePath).Replace('/', '\')
try {
  $null = [IO.Directory]::CreateDirectory($temporaryRoot)
  $nativeRoot = Join-Path $temporaryRoot 'Native'
  $x86Root = Join-Path $temporaryRoot 'X86'
  $nativeExe = New-ExecutableFixture $nativeRoot
  $x86Exe = New-ExecutableFixture $x86Root
  $missingRoot = Join-Path $temporaryRoot 'Missing'

  Assert-Equal (Invoke-ProfileFixture $nativeRoot $missingRoot '') $nativeExe 'The ProgramFiles installation must be found.'
  Assert-Equal (Invoke-ProfileFixture $missingRoot $x86Root '') $x86Exe 'An x86-only installation must be found.'
  Assert-Equal (Invoke-ProfileFixture $nativeRoot '' '') $nativeExe 'An absent optional x86 root must be accepted.'

  $missingExe = [IO.Path]::GetFullPath((Join-Path $missingRoot $relativeExe))
  Assert-Equal (Invoke-ProfileFixture $missingRoot (Join-Path $temporaryRoot 'AlsoMissing') '') $missingExe 'No installation must retain the deterministic missing default.'
  $missingIdentity = Get-SSEExecutableIdentity $script:SSE_DEFAULT_EXE
  if ($missingIdentity.exists -or $missingIdentity.supported -or $missingIdentity.reason -cne 'Programmdatei existiert nicht.') {
    throw 'The missing-installation identity must remain explicit and unsupported.'
  }

  $duplicateRoot = Join-Path ($nativeRoot.ToUpperInvariant()) 'child\..'
  Assert-Equal (Invoke-ProfileFixture $nativeRoot $duplicateRoot '') $nativeExe 'Canonical case-insensitive duplicate roots must not create ambiguity.'

  $caught = $null
  try { $null = Invoke-ProfileFixture $nativeRoot $x86Root '' } catch { $caught = $_ }
  if (-not $caught -or $script:failureKind -cne 'ambiguous-installation' -or $null -ne $script:SSE_DEFAULT_EXE -or
      $caught.Exception.Message -notmatch 'SSE_EXECUTABLE') {
    throw 'Two existing installations must fail closed and require an explicit executable.'
  }

  $explicitExe = New-ExecutableFixture (Join-Path $temporaryRoot 'Explicit')
  Assert-Equal (Invoke-ProfileFixture $nativeRoot $x86Root $explicitExe) $explicitExe 'The explicit executable must override two existing installations.'
  Assert-Equal (Invoke-ProfileFixture $nativeRoot $x86Root $missingExe) $missingExe 'A missing explicit executable must not silently select an installed candidate.'
  $explicitRelative = '.\missing-explicit\SSE.exe'
  Assert-Equal (Invoke-ProfileFixture $nativeRoot $x86Root $explicitRelative) ([IO.Path]::GetFullPath($explicitRelative)) 'Explicit relative paths must retain normal canonicalization.'

  $directoryRoot = Join-Path $temporaryRoot 'DirectoryOnly'
  $null = [IO.Directory]::CreateDirectory((Join-Path $directoryRoot $relativeExe))
  Assert-Equal (Invoke-ProfileFixture $directoryRoot $x86Root '') $x86Exe 'An executable-named directory must not count as an installation.'

  # Evaluate only the real health-advice expression, with synthetic values.
  $health = @($workerAst.FindAll({param($node)
    $node -is [Management.Automation.Language.SwitchStatementAst]
  }, $true) | ForEach-Object {$_.Clauses} | Where-Object {$_.Item1.Extent.Text -ceq "'health'"})
  if ($health.Count -ne 1) { throw 'Expected one real health dispatcher.' }
  $adviceEntries = @($health[0].Item2.FindAll({param($node)
    $node -is [Management.Automation.Language.HashtableAst]
  }, $true) | ForEach-Object {$_.KeyValuePairs} | Where-Object {$_.Item1.Extent.Text -ceq 'advice'})
  if ($adviceEntries.Count -ne 1) { throw 'Expected one real health-advice expression.' }
  $adviceExpression = [scriptblock]::Create($adviceEntries[0].Item2.Extent.Text)
  foreach ($hung in @($true, $false)) {
    $wins = @([pscustomobject]@{hung=$hung})
    $dialogInventory = @()
    $canary = [pscustomobject]@{ok=$false}
    $advice = & $adviceExpression
    if ($advice -match 'sse_restart' -or $advice -notmatch 'Zielinstanz' -or
        $advice -notmatch 'ungespeicherten Zustand' -or $advice -notmatch 'ausdruecklich' -or
        $advice -notmatch 'sse_api_control' -or $advice -notmatch 'API') {
      throw 'Health advice must require verified target/state and an explicit product restart, distinct from API control.'
    }
  }
} finally {
  foreach ($entry in $savedEnvironment.GetEnumerator()) {
    [Environment]::SetEnvironmentVariable($entry.Key, $entry.Value, 'Process')
  }
  $resolvedTemporaryRoot = [IO.Path]::GetFullPath($temporaryRoot)
  if (-not $resolvedTemporaryRoot.StartsWith($temporaryParent, [StringComparison]::OrdinalIgnoreCase) -or
      [IO.Path]::GetFileName($resolvedTemporaryRoot) -notmatch '^sse-executable-fixture-[0-9a-f]{32}$') {
    throw 'Refusing to remove an unexpected fixture directory.'
  }
  Remove-Item -LiteralPath $resolvedTemporaryRoot -Recurse -Force
}
Write-Output 'Worker executable defaults: both roots, x86-only, missing, duplicates, ambiguity, explicit override and safe health advice passed; no product executed.'
