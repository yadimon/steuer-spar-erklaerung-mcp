param([string]$InputPath, [string]$OutputPath)
$ErrorActionPreference = 'Stop'
$inputData = Get-Content -LiteralPath $InputPath -Raw -Encoding UTF8 | ConvertFrom-Json
$tokens = $null; $errors = $null
$ast = [Management.Automation.Language.Parser]::ParseFile((Join-Path $PSScriptRoot '..\powershell\sse-worker.ps1'), [ref]$tokens, [ref]$errors)
if ($errors.Count) { throw 'Worker AST could not be parsed' }
# Index the worker once. Repeated full-tree delegate walks become the dominant
# cost as the differential oracle adds projection bodies and their helpers.
$oracleAstNodes = @($ast.FindAll({ param($node)
    $node -is [Management.Automation.Language.FunctionDefinitionAst] -or
    $node -is [Management.Automation.Language.AssignmentStatementAst] -or
    $node -is [Management.Automation.Language.SwitchStatementAst]
}, $true))
$functionDefinitions = @($oracleAstNodes | Where-Object { $_ -is [Management.Automation.Language.FunctionDefinitionAst] })
$assignmentStatements = @($oracleAstNodes | Where-Object { $_ -is [Management.Automation.Language.AssignmentStatementAst] })
$switchClauses = @($oracleAstNodes | Where-Object { $_ -is [Management.Automation.Language.SwitchStatementAst] } |
    ForEach-Object { $_.Clauses })
. (Join-Path $PSScriptRoot '..\powershell\structure-binding.ps1')
. (Join-Path $PSScriptRoot '..\powershell\window-scope.ps1')
# Differential oracle: execute the actual worker's projection bodies against supplied observations.
# Only the OS observation boundaries are supplied by the fixture; no product branch is copied.
foreach ($name in @('Get-ContentBounds','Get-SSEHeading','ConvertTo-Vergleichsform','Test-Versand','Get-SSETextSha256',
    'Get-CaptionMinX','Get-DirtyState','Get-SSECheckerTreeItems','Get-CheckerResults','Test-CheckerResultComplete',
    'Read-CheckerComplete','Convert-SSEComparableNumber','Read-ResultDetailsFromTree','New-SSETableRowDetails',
    'Resolve-SSEToolWindowKind','Get-SSEMainWindowCandidates','Resolve-SSEMainWindowDescriptor','Get-CurrentHeading')) {
    $definitions = @($functionDefinitions | Where-Object { $_.Name -eq $name })
    if ($definitions.Count -ne 1) { throw "Ambiguous worker function $name" }
    $definition = $definitions[0].Extent.Text
    if ($name -eq 'Get-ContentBounds') {
        $original = '$r = New-Object SW+RC; [SW]::GetWindowRect($hwnd, [ref]$r) | Out-Null'
        if (-not $definition.Contains($original)) { throw 'Window observation adapter changed' }
        $definition = $definition.Replace($original, '$r = $script:observedRect')
    }
    . ([scriptblock]::Create($definition))
}
foreach ($variable in @('$script:VERSAND', '$script:SSE_CHECKER_TREE_SUFFIX', '$script:WERTE_INFO_TITEL')) {
    $assignments = @($assignmentStatements | Where-Object { $_.Left.Extent.Text -eq $variable })
    if ($assignments.Count -ne 1) { throw "Worker constant $variable changed" }
    . ([scriptblock]::Create($assignments[0].Extent.Text))
}
$branches = @{}
foreach ($operation in @('read_page','subpages','find','page','help','read_table','checker_results','ui_state')) {
    $matches = @($switchClauses | Where-Object { $_.Item1.Extent.Text -eq "'$operation'" })
    if ($matches.Count -ne 1) { throw "Ambiguous worker operation $operation" }
    $body = $matches[0].Item2.Extent.Text.Trim().Substring(1).TrimEnd().TrimEnd('}')
    if ($operation -eq 'page') {
        # The page branch reads two Win32 facts directly; the fixture supplies both observations.
        $rectCall = '$r0 = New-Object SW+RC; [SW]::GetWindowRect($hwnd, [ref]$r0) | Out-Null'
        $pidCall = '[SW]::GetWindowThreadProcessId($hwnd, [ref]$targetPid) | Out-Null'
        if (-not $body.Contains($rectCall) -or -not $body.Contains($pidCall)) { throw 'Page observation adapter changed' }
        $body = $body.Replace($rectCall, '$r0 = $script:observedRect').Replace($pidCall, '$targetPid = $script:observedPid')
    }
    $branches[$operation] = [scriptblock]::Create($body)
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
function Walk-Tree { param($hwnd, $MaxNodes, $TimeoutSec, $MaxDepth, [switch]$WithValues, [switch]$WithScroll) $script:observedTree }
function Walk-BoundTree {
    param($hwnd, $MaxNodes, $TimeoutSec, $MaxDepth, [switch]$WithValues, [switch]$WithScroll)
    $scope = Split-SSEWindowScope $script:observedTree.nodes
    [pscustomobject]@{ nodes = @($scope.own); stats = $script:observedTree.stats; fremdeFenster = @($scope.foreign) }
}
# SSEWindowEnumerator.Describe orders by area, largest first, then by enumeration order.
function Get-Windows {
    param([string]$ProcName = 'SSE')
    @($script:observedWindows | Sort-Object @{ Expression = { -([int64]$_.w * [int64]$_.h) } }, @{ Expression = { [int]$_.order } })
}
function Get-DialogInventory { param([int]$TargetPid = 0) @() }
# The descriptor's UIA/MSAA read is an OS boundary; the fixture names the kind it would have produced.
# Only kinds the worker decides without UIA (tips, known-nonmodal, main) are admitted, with the worker's flags.
function Get-DialogDescriptor($Window, [IntPtr]$MainHwnd) {
    $kind = [string]$script:observedKinds.([string]$Window.hwnd)
    if ($kind -notin @('tips', 'known-nonmodal', 'main')) {
        # The ui_state branch catches this and lists the window as unreadable; the violation is re-raised after the branch.
        $script:fixtureError = "Fixture supplies no descriptor kind for window $($Window.hwnd)"
        throw $script:fixtureError
    }
    [pscustomobject]@{
        hwnd = [int64]$Window.hwnd; pid = [int]$Window.pid; cls = $Window.cls; title = $Window.title
        titleFingerprint = $Window.titleFingerprint; kind = $kind
        x = $Window.x; y = $Window.y; w = $Window.w; h = $Window.h; minimiert = [bool]$Window.minimiert
        buttons = @(); unsupportedButtons = @(); texts = @(); fingerprint = $null; tree = $null
        uiaReadOk = $false; uiaError = $null; msaaReadOk = $false; msaaError = $null
        recoveryPrompt = $false; requiresCaseBinding = $false; updatePrompt = $false
    }
}
# The Qt snapshot answers a checkable cell's toggle state directly; the worker asks the UIA toggle pattern.
function Read-SSETableCellSemantic($Cell) {
    if ($null -ne $Cell.checked) {
        $state = $(if ($Cell.checked -eq $true) { 'On' } elseif ($Cell.checked -eq $false) { 'Off' } else { 'Indeterminate' })
        return [pscustomobject]@{
            type = 'boolean'; value = $(if ($state -eq 'On') { $true } elseif ($state -eq 'Off') { $false } else { $null })
            checkboxState = $state; ok = $true; error = $null
        }
    }
    [pscustomobject]@{ type = 'text'; value = [string]$Cell.name; checkboxState = $null; ok = $true; error = $null }
}
function Emit($value) { $value }
function Fail($message, $kind) { throw "$kind`: $message" }
$results = @()
foreach ($case in $inputData.cases) {
    $script:observedTree = [pscustomobject]@{ nodes = @($case.nodes); stats = $case.stats }
    $script:observedRect = [pscustomobject]@{ L=$case.rect.x; T=$case.rect.y; R=($case.rect.x+$case.rect.w); B=($case.rect.y+$case.rect.h) }
    $script:observedWindows = @($case.windows | Where-Object { $null -ne $_ } | ForEach-Object {
        [pscustomobject]@{
            hwnd = [int64]$_.hwnd; order = [int]$_.order; pid = [int]$_.pid; cls = [string]$_.class; title = [string]$_.title
            titleFingerprint = Get-SSETextSha256 ([string]$_.title)
            x = [int]$_.x; y = [int]$_.y; w = [int]$_.w; h = [int]$_.h; hung = [bool]$_.hung; minimiert = [bool]$_.minimized
        }
    })
    $script:observedKinds = $(if ($null -ne $case.kinds) { $case.kinds } else { [pscustomobject]@{} })
    $script:observedPid = 99
    $a = $case.args
    $script:fixtureError = $null
    $results += & $branches[$case.operation]
    if ($script:fixtureError) { throw $script:fixtureError }
}
$helpers = @()
foreach ($case in $inputData.helpers) {
    $tree = [pscustomobject]@{ nodes = @($case.nodes); stats = $case.stats }
    $helpers += $(switch ($case.helper) {
        'checkerResults' { Get-CheckerResults $tree }
        'resultDetails' { Read-ResultDetailsFromTree $tree }
        'windowScope' { Split-SSEWindowScope $tree.nodes }
        default { throw "Unknown helper oracle $($case.helper)" }
    })
}
$wildcards = @()
foreach ($case in $inputData.wildcards) {
    try { $wildcards += [pscustomobject]@{ match = [bool]($case.text -like $case.pattern) } }
    catch { $wildcards += [pscustomobject]@{ invalid = $true } }
}
$receiptFingerprintJson = $inputData.receiptFingerprintValue | ConvertTo-Json -Depth 4 -Compress
$receiptFingerprint = Get-SSETextSha256 $receiptFingerprintJson
[IO.File]::WriteAllText($OutputPath, (ConvertTo-Json -InputObject @{
    results=$results
    helpers=$helpers
    wildcards=$wildcards
    receiptFingerprintJson=$receiptFingerprintJson
    receiptFingerprint=$receiptFingerprint
  } -Depth 20), [Text.UTF8Encoding]::new($false))
