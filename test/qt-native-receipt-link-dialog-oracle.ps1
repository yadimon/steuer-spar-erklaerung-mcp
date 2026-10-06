param([string]$InputPath, [string]$OutputPath)
$ErrorActionPreference = 'Stop'
$tokens = $null; $errors = $null
$ast = [Management.Automation.Language.Parser]::ParseFile(
    (Join-Path $PSScriptRoot '..\powershell\sse-worker.ps1'), [ref]$tokens, [ref]$errors)
if ($errors.Count) { throw 'Worker AST could not be parsed' }
$definitions = @($ast.FindAll({ param($node)
    $node -is [Management.Automation.Language.FunctionDefinitionAst] -or
    $node -is [Management.Automation.Language.AssignmentStatementAst]
}, $true))
foreach ($name in @('Get-SSEDialogFingerprint', 'ConvertTo-SSEDialogButtonName')) {
    $matches = @($definitions | Where-Object {
        $_ -is [Management.Automation.Language.FunctionDefinitionAst] -and $_.Name -eq $name
    })
    if ($matches.Count -ne 1) { throw "Ambiguous worker function $name" }
    . ([scriptblock]::Create($matches[0].Extent.Text))
}
$constants = @($definitions | Where-Object {
    $_ -is [Management.Automation.Language.AssignmentStatementAst] -and $_.Left.Extent.Text -eq '$script:DIALOG_BUTTONS'
})
if ($constants.Count -ne 1) { throw 'Ambiguous dialog button catalogue' }
. ([scriptblock]::Create($constants[0].Extent.Text))
$projections = @()
$descriptors = @($definitions | Where-Object {
    $_ -is [Management.Automation.Language.FunctionDefinitionAst] -and $_.Name -eq 'Get-DialogDescriptor'
})
if ($descriptors.Count -ne 1) { throw 'Ambiguous dialog descriptor function' }
$descriptorAssignments = @($descriptors[0].FindAll({ param($node)
    $node -is [Management.Automation.Language.AssignmentStatementAst]
}, $true))
foreach ($variable in @('$observedButtonNames', '$buttons', '$texts', '$unsupportedButtons')) {
    $matches = @($descriptorAssignments | Where-Object {
        $_ -is [Management.Automation.Language.AssignmentStatementAst] -and $_.Left.Extent.Text -eq $variable -and
        $(if ($variable -eq '$unsupportedButtons') { $_.Right.Extent.Text.Contains('$observedButtonNames | Where-Object') }
          else { $_.Right.Extent.Text.Contains('$tree.nodes | Where-Object') })
    })
    if ($matches.Count -ne 1) { throw "Ambiguous actual worker projection $variable" }
    $projections += [scriptblock]::Create($matches[0].Extent.Text)
}
$cases = Get-Content -LiteralPath $InputPath -Raw -Encoding UTF8 | ConvertFrom-Json
$results = @()
foreach ($case in $cases) {
    $tree = [pscustomobject]@{ nodes = @($case.nodes) }
    foreach ($projection in $projections) { . $projection }
    $results += Get-SSEDialogFingerprint $case.title $buttons $unsupportedButtons $texts
}
[IO.File]::WriteAllText($OutputPath, (ConvertTo-Json -InputObject $results), [Text.UTF8Encoding]::new($false))
