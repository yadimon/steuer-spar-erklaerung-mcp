$ErrorActionPreference = 'Stop'

. (Join-Path $PSScriptRoot '..\powershell\table-values.ps1')

function Assert-True([bool]$Condition, [string]$Message) {
  if (-not $Condition) { throw $Message }
}

foreach ($case in @(
  @('1.234,56', 1234.56),
  @('1234,5', 1234.5),
  @('108.90', 108.90),
  @('1.234', 1234),
  @('1.234.567', 1234567),
  @('-12,34', -12.34)
)) {
  $actual = ConvertTo-SSETableNumber ([string]$case[0])
  Assert-True ($null -ne $actual -and $actual -eq [decimal]$case[1]) "Zahl '$($case[0])' wurde falsch normalisiert."
}

foreach ($invalid in @('1.2.3', '12.34.56', '12.34,56', '1,2,3', 'abc', '')) {
  Assert-True ($null -eq (ConvertTo-SSETableNumber $invalid)) "Mehrdeutige Zahl '$invalid' wurde akzeptiert."
}

Assert-True (Test-SSEScalarEqual '0' '0,00') 'Numerisch gleiches Nullformat wurde abgewiesen.'
Assert-True (Test-SSEScalarEqual '1.234,50' '1234.5') 'Gleicher deutscher/API-Betrag wurde abgewiesen.'
Assert-True (-not (Test-SSEScalarEqual '1' '10')) 'Prefixwerte 1 und 10 wurden faelschlich gleichgesetzt.'
Assert-True (-not (Test-SSEScalarEqual 'abc' 'abcd')) 'Textprefixe wurden faelschlich gleichgesetzt.'
Assert-True (Test-SSETableCellEquivalent '01.07' '01.07.2025') 'Qt-Datum ohne Jahr wurde nicht gebunden verglichen.'
Assert-True (-not (Test-SSETableCellEquivalent '29.01.2025' '29.01.2026')) 'Unterschiedliche sichtbare Jahre wurden gleichgesetzt.'
Assert-True (-not (Test-SSETableCellEquivalent '31.02' '31.02.2025')) 'Ein ungueltiger Kalendertag wurde bestaetigt.'
Assert-True (-not (Test-SSETableCellEquivalent '29.02' '29.02.2025')) 'Ein Schalttag in einem Nichtschaltjahr wurde bestaetigt.'
Assert-True (Test-SSETableCellEquivalent '29.02' '29.02.2024') 'Ein gueltiger Schalttag wurde abgewiesen.'
Assert-True (Test-SSETableCellEquivalent '1.7.2025' '01.07.2025') 'Gleiche volle Daten mit unterschiedlichen fuehrenden Nullen wurden abgewiesen.'
Assert-True (-not (Test-SSETableCellEquivalent '31.02.2025' '31.02.2025')) 'Identische ungueltige volle Daten wurden bestaetigt.'
Assert-True (-not (Test-SSETableCellEquivalent '1.2.3' '123')) 'Mehrdeutiger Tabellenwert wurde numerisch bestaetigt.'

$tokens = $null; $parseErrors = $null
$workerAst = [Management.Automation.Language.Parser]::ParseFile(
  (Join-Path $PSScriptRoot '..\powershell\sse-worker.ps1'), [ref]$tokens, [ref]$parseErrors)
Assert-True ($parseErrors.Count -eq 0) 'Worker konnte fuer den semantischen Zellvertrag nicht geparst werden.'
$rowFunction = @($workerAst.FindAll({
  param($node)
  $node -is [Management.Automation.Language.FunctionDefinitionAst] -and $node.Name -eq 'New-SSETableRowDetails'
}, $true))
Assert-True ($rowFunction.Count -eq 1) 'Semantischer Zeilenprojektor fehlt oder ist mehrdeutig.'
Invoke-Expression $rowFunction[0].Extent.Text
$cells = @(
  [pscustomobject]@{ok=$true;type='text';value='';checkboxState=$null},
  [pscustomobject]@{ok=$true;type='boolean';value=$false;checkboxState='Off'},
  [pscustomobject]@{ok=$true;type='boolean';value=$true;checkboxState='On'},
  [pscustomobject]@{ok=$true;type='boolean';value=$null;checkboxState='Indeterminate'},
  [pscustomobject]@{ok=$false;type='unknown';value=$null;checkboxState=$null;error='stale'},
  $null
)
$detail = New-SSETableRowDetails 3 $cells
$serialized = $detail | ConvertTo-Json -Depth 6 | ConvertFrom-Json
Assert-True ($serialized.rowIndex -eq 3 -and $serialized.typedValues.Count -eq 6) 'Zeilenindex oder Spaltenposition ging bei JSON-Serialisierung verloren.'
Assert-True ($serialized.typedValues[0] -ceq '') 'Leerer Zelltext wurde als Checkbox interpretiert.'
Assert-True ($serialized.typedValues[1] -is [bool] -and $serialized.typedValues[1] -eq $false) 'Off wurde beim JSON-Readback zu Text oder null.'
Assert-True ($serialized.typedValues[2] -is [bool] -and $serialized.typedValues[2] -eq $true) 'On wurde beim JSON-Readback zu Text oder null.'
Assert-True ($null -eq $serialized.typedValues[3] -and $serialized.checkboxStates[3] -ceq 'Indeterminate') 'Unbestimmte Checkbox wurde als boolescher Wert geraten.'
Assert-True (-not $serialized.semanticsComplete -and $serialized.semanticReadErrors.Count -eq 2) 'Nicht gelesene Zellen wurden als vollstaendig bestaetigt.'
Assert-True ($serialized.semanticReadErrors[0].column -eq 4 -and $serialized.semanticReadErrors[1].column -eq 5) 'Fehler wurden der falschen Spalte zugeordnet.'
$single = New-SSETableRowDetails 0 @($cells[1]) | ConvertTo-Json -Depth 6 | ConvertFrom-Json
Assert-True ($single.typedValues -is [array] -and $single.typedValues.Count -eq 1) 'Einzellige Zeile verlor ihre Arrayform.'
Assert-True ($single.semanticsComplete -and $single.semanticReadErrors.Count -eq 0) 'Verifizierte Off-Zelle wurde als unvollstaendig gemeldet.'

$addedValues = @('', '03.02.2025', 'Synthetic vehicle receipt', '3,21', '0', '')
$addedCells = @(0..5 | ForEach-Object {
  [pscustomobject]@{ x=100 + ($_ * 100); y=220; name=@('18','03.02','Synthetic vehicle receipt','3,21','0','3,21')[$_]; val=''; rid="synthetic-cell-$_" }
})
$addedRegion = [pscustomobject]@{ ok=$true; profileMappingId='vehicle_costs_without_input_tax'; cells=$addedCells }
$addedRowProof = Resolve-SSEVehicleCostAddedRow $addedRegion $addedValues
Assert-True ($addedRowProof.ok -and $addedRowProof.rowY -eq 220 -and $addedRowProof.row.Count -eq 6) 'Complete zero-tax receipt did not bind independently of old Y.'
$shiftedCells = @($addedCells | ForEach-Object { $copy=$_.PSObject.Copy(); $copy.y=180; $copy })
$shiftedProof = Resolve-SSEVehicleCostAddedRow ([pscustomobject]@{ ok=$true; profileMappingId=$addedRegion.profileMappingId; cells=$shiftedCells }) $addedValues
Assert-True ($shiftedProof.ok -and $shiftedProof.rowY -eq 180) 'Layout shift was mistaken for receipt identity loss.'
$duplicateProof = Resolve-SSEVehicleCostAddedRow ([pscustomobject]@{
  ok=$true; profileMappingId=$addedRegion.profileMappingId; cells=@($addedCells) + @($shiftedCells)
}) $addedValues
Assert-True (-not $duplicateProof.ok -and $duplicateProof.matchCount -eq 2) 'Ambiguous complete receipt rows were accepted.'
$wrongNet = @($addedCells | ForEach-Object { $_.PSObject.Copy() }); $wrongNet[5].name='3,20'
$wrongNetProof = Resolve-SSEVehicleCostAddedRow ([pscustomobject]@{ ok=$true; profileMappingId=$addedRegion.profileMappingId; cells=$wrongNet }) $addedValues
Assert-True (-not $wrongNetProof.ok) 'Description and date alone overrode a mismatching net amount.'
$incompleteProof = Resolve-SSEVehicleCostAddedRow ([pscustomobject]@{ ok=$true; profileMappingId=$addedRegion.profileMappingId; cells=@($addedCells[0..4]) }) $addedValues
Assert-True (-not $incompleteProof.ok) 'Incomplete row was presented as a full receipt proof.'

Write-Output 'OK: Tabellenwerte sind exakt, gruppierungsgebunden und nicht prefix-tolerant.'
