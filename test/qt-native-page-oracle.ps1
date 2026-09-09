param([string]$InputPath, [string]$OutputPath)
$ErrorActionPreference = 'Stop'
$inputData = Get-Content -LiteralPath $InputPath -Raw -Encoding UTF8 | ConvertFrom-Json
$tokens = $null; $errors = $null
$ast = [Management.Automation.Language.Parser]::ParseFile((Join-Path $PSScriptRoot '..\powershell\sse-worker.ps1'), [ref]$tokens, [ref]$errors)
if ($errors.Count) { throw 'Worker AST could not be parsed' }
. (Join-Path $PSScriptRoot '..\powershell\structure-binding.ps1')
# Differential oracle: execute the actual worker's projection bodies against supplied observations.
# Only the OS observation boundaries are supplied by the fixture; no product branch is copied.
foreach ($name in @('Get-ContentBounds','Get-SSEHeading','ConvertTo-Vergleichsform','Test-Versand')) {
    $definitions = @($ast.FindAll({ param($node) $node -is [Management.Automation.Language.FunctionDefinitionAst] -and $node.Name -eq $name }, $true))
    if ($definitions.Count -ne 1) { throw "Ambiguous worker function $name" }
    $definition = $definitions[0].Extent.Text
    if ($name -eq 'Get-ContentBounds') {
        $original = '$r = New-Object SW+RC; [SW]::GetWindowRect($hwnd, [ref]$r) | Out-Null'
        if (-not $definition.Contains($original)) { throw 'Window observation adapter changed' }
        $definition = $definition.Replace($original, '$r = $script:observedRect')
    }
    . ([scriptblock]::Create($definition))
}
$assignments = @($ast.FindAll({ param($node) $node -is [Management.Automation.Language.AssignmentStatementAst] -and $node.Left.Extent.Text -eq '$script:VERSAND' }, $true))
if ($assignments.Count -ne 1) { throw 'Transmission list changed' }
. ([scriptblock]::Create($assignments[0].Extent.Text))
$branches = @{}
foreach ($operation in @('read_page','subpages','find')) {
    $matches = @($ast.FindAll({ param($node) $node -is [Management.Automation.Language.SwitchStatementAst] }, $true) |
        ForEach-Object { $_.Clauses } | Where-Object { $_.Item1.Extent.Text -eq "'$operation'" })
    if ($matches.Count -ne 1) { throw "Ambiguous worker operation $operation" }
    $branches[$operation] = [scriptblock]::Create($matches[0].Item2.Extent.Text.Trim().Substring(1).TrimEnd().TrimEnd('}'))
}
function Arg($argsObject, $key, $default = $null) {
    if ($argsObject.PSObject.Properties.Name -contains $key) { return $argsObject.$key }
    return $default
}
function Get-SSEBoundedIntegerArg($argsObject, $key, $default, $min, $max) {
    $value = Arg $argsObject $key $default
    if ($value -lt $min -or $value -gt $max) { throw 'Invalid fixture bound' }
    [int]$value
}
function Get-SSEMainWindowSelectors { [pscustomobject]@{ heading = '.ClientFrameSSE.ClientHeader' } }
function Resolve-Window { [IntPtr]42 }
function Test-Canary { [pscustomobject]@{ ok = $true } }
function Walk-Tree { param($hwnd, [switch]$WithValues) $script:observedTree }
function Emit($value) { $value }
function Fail($message, $kind) { throw "$kind`: $message" }
$results = @()
foreach ($case in $inputData.cases) {
    $script:observedTree = [pscustomobject]@{ nodes = @($case.nodes); stats = $case.stats }
    $script:observedRect = [pscustomobject]@{ L=$case.rect.x; T=$case.rect.y; R=($case.rect.x+$case.rect.w); B=($case.rect.y+$case.rect.h) }
    $a = $case.args
    $results += & $branches[$case.operation]
}
$wildcards = @()
foreach ($case in $inputData.wildcards) {
    try { $wildcards += [pscustomobject]@{ match = [bool]($case.text -like $case.pattern) } }
    catch { $wildcards += [pscustomobject]@{ invalid = $true } }
}
[IO.File]::WriteAllText($OutputPath, (ConvertTo-Json -InputObject @{ results=$results; wildcards=$wildcards } -Depth 20), [Text.UTF8Encoding]::new($false))
