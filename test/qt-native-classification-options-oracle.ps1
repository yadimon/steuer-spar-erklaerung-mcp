param([string]$InputPath, [string]$OutputPath)
$ErrorActionPreference = 'Stop'
$tokens = $null; $errors = $null
$ast = [Management.Automation.Language.Parser]::ParseFile(
    (Join-Path $PSScriptRoot '..\powershell\sse-worker.ps1'), [ref]$tokens, [ref]$errors)
if ($errors.Count) { throw 'Worker AST could not be parsed' }
$functions = @($ast.FindAll({ param($node)
    $node -is [Management.Automation.Language.FunctionDefinitionAst]
}, $true))
$hash = @($functions | Where-Object Name -eq 'Get-SSETextSha256')
$optionsFunction = @($functions | Where-Object Name -eq 'Get-SSEReceiptManagerClassificationOptions')
if ($hash.Count -ne 1 -or $optionsFunction.Count -ne 1) { throw 'Ambiguous worker functions' }
. ([scriptblock]::Create($hash[0].Extent.Text))
$assignments = @($optionsFunction[0].FindAll({ param($node)
    $node -is [Management.Automation.Language.AssignmentStatementAst] -and $node.Left.Extent.Text -eq '$fingerprint'
}, $true))
if ($assignments.Count -ne 1) { throw 'Ambiguous actual option fingerprint projection' }
$projection = [scriptblock]::Create($assignments[0].Extent.Text)
$cases = Get-Content -LiteralPath $InputPath -Raw -Encoding UTF8 | ConvertFrom-Json
$results = @()
foreach ($case in $cases) {
    $options = @($case)
    . $projection
    $results += $fingerprint
}
[IO.File]::WriteAllText($OutputPath, (ConvertTo-Json -InputObject $results), [Text.UTF8Encoding]::new($false))
