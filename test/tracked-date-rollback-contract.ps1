$ErrorActionPreference = 'Stop'

$root = Split-Path $PSScriptRoot -Parent
$workerPath = Join-Path $root 'powershell\sse-worker.ps1'
$tableValuesPath = Join-Path $root 'powershell\table-values.ps1'
$schemaPath = Join-Path $root 'src\mcp-schemas-interaction.ts'
$worker = [IO.File]::ReadAllText($workerPath)
$schema = [IO.File]::ReadAllText($schemaPath)

. $tableValuesPath
$tokens = $null; $errors = $null
$ast = [Management.Automation.Language.Parser]::ParseFile($workerPath, [ref]$tokens, [ref]$errors)
if ($errors.Count) { throw "Worker-Parserfehler: $($errors[0].Message)" }
foreach ($functionName in @('Get-SSETrackedDateParts','Test-SSETrackedValueEquivalent')) {
  $definition = @($ast.FindAll({
    param($node)
    $node -is [Management.Automation.Language.FunctionDefinitionAst] -and $node.Name -eq $functionName
  }, $true))
  if ($definition.Count -ne 1) { throw "Funktion $functionName ist nicht eindeutig vorhanden." }
  Invoke-Expression $definition[0].Extent.Text
}

if (-not (Test-SSETrackedValueEquivalent '15.07' '15.07.2026' 'date')) {
  throw 'SSE-Datumsanzeige ohne Jahr wird trotz explizitem date-Vertrag nicht erkannt.'
}
if (-not (Test-SSETrackedValueEquivalent '15.07.26' '15.07.2026' 'date')) {
  throw 'Zweistelliges und vierstelliges Jahr werden nicht gleichgesetzt.'
}
if (Test-SSETrackedValueEquivalent '15.07.2025' '15.07.2026' 'date') {
  throw 'Zwei sichtbare unterschiedliche Jahre duerfen nie gleich sein.'
}
if (Test-SSETrackedValueEquivalent '15.07' '15.07.2026' 'text') {
  throw 'Ohne date-Vertrag darf die gekuerzte Anzeige nicht als Textgleichheit gelten.'
}
if (Test-SSETrackedValueEquivalent '31.19' '31.19.2026' 'date') {
  throw 'Ungueltige Datumsbestandteile duerfen nicht akzeptiert werden.'
}

$marker = "`n  'tracked_set_value' {"
$start = $worker.IndexOf($marker, [StringComparison]::Ordinal)
if ($start -lt 0) { throw 'tracked_set_value fehlt.' }
$next = $worker.IndexOf("`n  '", $start + $marker.Length, [StringComparison]::Ordinal)
$block = $worker.Substring($start, $(if ($next -ge 0) { $next - $start } else { $worker.Length - $start }))
foreach ($required in @(
  '$beforeRaw = [string]$vp.Current.Value',
  'Commit-TrackedValue $hwnd $liveNode $requested $beforeRaw',
  '$afterRaw = [string]$afterVp.Current.Value',
  'Commit-TrackedValue $hwnd $rollbackNode $beforeRaw $rollbackCurrentRaw',
  'Test-SSEScalarEqual $restoredRaw $beforeRaw',
  'Rollback zum rohen Ausgangswert ist NICHT bewiesen'
)) {
  if (-not $block.Contains($required)) { throw "tracked_set_value-Vertrag fehlt: $required" }
}
if ($block.Contains('$restoredRaw = $verifyNode.name')) {
  throw 'Sichtbarer Fallbackname darf nie den rohen Rollback-Beweis ersetzen.'
}
if ($block.IndexOf('$rollbackPreflightOk', [StringComparison]::Ordinal) -gt
    $block.IndexOf('Commit-TrackedValue $hwnd $rollbackNode', [StringComparison]::Ordinal)) {
  throw 'Rollback-Interferenz wird erst nach der Mutation geprueft.'
}
if (-not $schema.Contains('valueKind: z.enum(["text", "currency", "date"])')) {
  throw 'Generischer MCP-Vertrag exponiert valueKind=date nicht.'
}

Write-Output 'Tracked-Date-Rollback: Formatvertrag und leerer Raw-Rollback sind fail-closed.'
