param([string]$InputPath, [string]$OutputPath)
$ErrorActionPreference = 'Stop'
. (Join-Path $PSScriptRoot '..\powershell\goto-route.ps1')
. (Join-Path $PSScriptRoot '..\powershell\structure-binding.ps1')
. (Join-Path $PSScriptRoot '..\powershell\table-region.ps1')
$ast = [Management.Automation.Language.Parser]::ParseFile(
  (Join-Path $PSScriptRoot '..\powershell\sse-worker.ps1'), [ref]$null, [ref]$null)
$definitions = @($ast.FindAll({ param($node)
  $node -is [Management.Automation.Language.FunctionDefinitionAst] -and $node.Name -eq 'Test-KnownPageHeading'
}, $true))
if ($definitions.Count -ne 1) { throw 'Known-heading worker body is ambiguous' }
. ([scriptblock]::Create($definitions[0].Extent.Text))
$inputData = Get-Content -LiteralPath $InputPath -Raw -Encoding UTF8 | ConvertFrom-Json
$order = @(Get-SSEPagingOrder $inputData.year)
$routes = @(); $landings = @(); $hits = @(); $navigation = @(); $summaries = @()
foreach ($case in $inputData.routes) {
  $route = Get-SSEGotoRoute $order $case.start $case.target -Direction $case.direction -MaxSteps $case.maxSteps
  $routes += $route
  foreach ($landing in $case.landings) {
    $result = Test-SSEGotoLanding $route $order $landing.position $landing.from $landing.heading
    $landings += [pscustomobject]@{ verdict=$result.verdict; position=$result.position }
  }
}
foreach ($case in $inputData.search) {
  $accept = $(if ($case.page) { { param($title) Test-KnownPageHeading $title $case.page } } else { $null })
  $hit = Select-SSESearchHit $case.nodes $case.target -Accept $accept
  $hits += $(if ($hit) { $hit.rid } else { $null })
}
foreach ($case in $inputData.navigation) {
  $hit = Get-SSEVisibleNavigationItem $case.nodes $case.target
  $navigation += $(if ($hit) { $hit.rid } else { $null })
}
foreach ($case in $inputData.summaries) {
  $result = Select-SSESummaryFromNodes $case.nodes $case.bounds $case.label $case.occurrence
  $summaries += $(if ($result.selected) {
    [pscustomobject]@{label=$result.selected.label;value=$result.value;y=$result.selected.y}
  } else { $null })
}
$outputData = [pscustomobject]@{ order=$order; repeated=@(Get-SSERepeatedPagingTitles); routes=$routes;
  landings=$landings; hits=$hits; navigation=$navigation; summaries=$summaries }
[IO.File]::WriteAllText($OutputPath, (ConvertTo-Json -InputObject $outputData -Depth 30), [Text.UTF8Encoding]::new($false))
