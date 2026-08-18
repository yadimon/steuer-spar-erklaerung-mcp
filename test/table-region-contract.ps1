$ErrorActionPreference = 'Stop'

. (Join-Path $PSScriptRoot '..\powershell\table-region.ps1')

function Assert-True([bool]$Condition, [string]$Message) {
  if (-not $Condition) { throw $Message }
}

function Node([string]$Type, [string]$Name, [int]$X, [int]$Y, [int]$W = 80, [string]$Value = $null, [string]$Rid = '', [string]$Aid = '') {
  [pscustomobject]@{ type=$Type; name=$Name; x=$X; y=$Y; w=$W; h=20; val=$Value; rid=$Rid; aid=$Aid }
}

$bounds = [pscustomobject]@{ minX=100; maxX=900 }

# Zwei Tabellen mit demselben Summenlabel: occurrence=2 muss ausschliesslich
# die zweite Region zwischen erster und zweiter Summenzeile liefern.
$sameLabelNodes = @(
  (Node 'DataItem' 'A-1' 300 100 100 $null 'same-a1')
  (Node 'DataItem' 'A-2' 500 100 100 $null 'same-a2')
  (Node 'Text' 'Summe' 300 200)
  (Node 'Edit' '' 700 200 100 '10,00' 'same-sum-1')
  (Node 'DataItem' 'B-1' 300 300 100 $null 'same-b1')
  (Node 'DataItem' 'B-2' 500 300 100 $null 'same-b2')
  (Node 'Text' 'Summe' 300 400)
  (Node 'Edit' '' 700 400 100 '20,00' 'same-sum-2')
  (Node 'DataItem' 'after' 300 450 100 $null 'same-after')
)
$sameSecond = Select-SSESummaryFromNodes $sameLabelNodes $bounds 'Summe' 2
Assert-True ($sameSecond.candidateCount -eq 2) 'Gleiches Summenlabel wurde nicht zweimal erkannt.'
Assert-True ($sameSecond.selected.rid -eq 'same-sum-2') 'sumOccurrence=2 band nicht die zweite Summenzeile.'
$sameRegion = Get-SSETableRegionFromNodes $sameLabelNodes $bounds $sameSecond
$sameIds = @($sameRegion.cells | ForEach-Object rid)
Assert-True $sameRegion.ok 'Zweite Region mit gleichem Summenlabel blieb leer.'
Assert-True ($sameRegion.previousSummaryY -eq 200 -and $sameRegion.targetSumY -eq 400) 'Grenzen der zweiten gleichen Summenregion sind falsch.'
Assert-True (($sameIds -join ',') -eq 'same-b1,same-b2') "Gleiche Summenlabels vermischten Tabellenzellen: $($sameIds -join ',')"

# Exakte Labels haben Vorrang vor laengeren Prefix-Treffern. Sonst wuerde
# "Summe im Zeitraum" die Occurrence-Zaehlung fuer "Summe" verschieben.
$exactPriorityNodes = @(
  (Node 'Text' 'Summe' 300 100)
  (Node 'Edit' '' 700 100 100 '1,00' 'exact-1')
  (Node 'Text' 'Summe im Zeitraum' 300 150)
  (Node 'Edit' '' 700 150 100 '2,00' 'prefix-only')
  (Node 'Text' 'Summe' 300 200)
  (Node 'Edit' '' 700 200 100 '3,00' 'exact-2')
)
$exactSecond = Select-SSESummaryFromNodes $exactPriorityNodes $bounds 'Summe' 2
Assert-True ($exactSecond.candidateCount -eq 2) 'Laengeres Prefix-Label wurde als exaktes Summenlabel gezaehlt.'
Assert-True ($exactSecond.selected.rid -eq 'exact-2') 'Exakte Summenlabel-Prioritaet band die falsche Zeile.'

# Qt liefert für einige Summenfelder ein vorhandenes, aber leeres
# ValuePattern. Der sichtbare Name bleibt dann die einzige lesbare Summe und
# muss für Tabellen-Vorbedingungen genutzt werden.
$emptyValueNodes = @(
  (Node 'Text' 'Summe' 300 100)
  (Node 'Edit' '1,50' 700 100 100 '' 'empty-value-sum')
)
$emptyValueSummary = Select-SSESummaryFromNodes $emptyValueNodes $bounds 'Summe' 1
Assert-True ($emptyValueSummary.value -eq '1,50') 'Leeres ValuePattern fiel nicht auf den sichtbaren Summennamen zurück.'

# Zwei Tabellen mit unterschiedlichen Summenlabels: die eindeutige zweite
# Beschriftung muss trotzdem die vorherige (anders benannte) Summenzeile als
# untere geometrische Grenze verwenden.
$differentLabelNodes = @(
  (Node 'DataItem' 'E-1' 300 110 100 $null 'diff-e1')
  (Node 'Text' 'Summe Einnahmen' 300 210)
  (Node 'Edit' '' 700 210 100 '30,00' 'diff-sum-income')
  (Node 'DataItem' 'K-1' 300 310 100 $null 'diff-k1')
  (Node 'DataItem' 'K-2' 500 310 100 $null 'diff-k2')
  (Node 'Text' 'Gesamtsumme Kosten' 300 410)
  (Node 'Edit' '' 700 410 100 '12,00' 'diff-sum-cost')
)
$differentSecond = Select-SSESummaryFromNodes $differentLabelNodes $bounds 'Gesamtsumme Kosten' 1
Assert-True ($differentSecond.candidateCount -eq 1) 'Eindeutiges unterschiedliches Summenlabel wurde nicht erkannt.'
Assert-True ($differentSecond.selected.rid -eq 'diff-sum-cost') 'Unterschiedliches Summenlabel band die falsche Zeile.'
$differentRegion = Get-SSETableRegionFromNodes $differentLabelNodes $bounds $differentSecond
$differentIds = @($differentRegion.cells | ForEach-Object rid)
Assert-True ($differentRegion.previousSummaryY -eq 210 -and $differentRegion.targetSumY -eq 410) 'Anders benannte vorherige Summenzeile begrenzte die zweite Tabelle nicht.'
Assert-True (($differentIds -join ',') -eq 'diff-k1,diff-k2') "Unterschiedliche Summenlabels vermischten Tabellenzellen: $($differentIds -join ',')"

# Nicht vorhandenes Vorkommen muss fail-closed bleiben.
$missing = Select-SSESummaryFromNodes $sameLabelNodes $bounds 'Summe' 3
Assert-True ($null -eq $missing.selected -and $missing.candidateCount -eq 2) 'Nicht vorhandenes sumOccurrence wurde nicht abgewiesen.'
$missingRegion = Get-SSETableRegionFromNodes $sameLabelNodes $bounds $missing
Assert-True (-not $missingRegion.ok -and $missingRegion.cells.Count -eq 0) 'Fehlende Summenzeile lieferte trotzdem eine Tabellenregion.'

# Die ZM zeigt drei Tabellen auf einer Seite. Dort ist der gemeinsame
# AutomationId-Abschnitt stabiler als die Geometrie, besonders wenn die
# zweite Summenzeile am unteren Fensterrand liegt.
$zmPrefix = 'Root./.SonstigeLeistungEU./.SonstigeLeistungEU.'
$zmNodes = @(
  (Node 'DataItem' '' 950 1230 55 $null 'zm-date' ($zmPrefix + 'Tab'))
  (Node 'DataItem' '' 1005 1230 200 $null 'zm-land' ($zmPrefix + 'Tab'))
  (Node 'DataItem' '' 1205 1230 200 $null 'zm-id' ($zmPrefix + 'Tab'))
  (Node 'DataItem' '0,00' 1405 1230 100 $null 'zm-amount' ($zmPrefix + 'Tab'))
  (Node 'Text' 'Summe' 300 1424)
  (Node 'Edit' '' 700 1424 100 '0,00' 'zm-sum' ($zmPrefix + 'SummeTab./.Wert'))
  (Node 'DataItem' 'fremd' 300 1300 100 $null 'other-cell' 'Root./.InnergemDreieck./.InnergemDreieck.Tab')
)
$zmSum = Select-SSESummaryFromNodes $zmNodes $bounds 'Summe' 1
$zmRegion = Get-SSETableRegionFromNodes $zmNodes $bounds $zmSum
$zmIds = @($zmRegion.cells | ForEach-Object rid)
Assert-True $zmRegion.ok 'AutomationId-gebundene ZM-Tabelle blieb leer.'
Assert-True ($zmRegion.selectionMethod -eq 'automation-id-scope') 'ZM-Tabelle fiel unerwartet auf Geometrie zurueck.'
Assert-True (($zmIds -join ',') -eq 'zm-date,zm-land,zm-id,zm-amount') "ZM-Scope vermischte Tabellenzellen: $($zmIds -join ',')"

Write-Output 'OK: Tabellenregionen sind bei gleichen und unterschiedlichen Summenlabels geometrisch getrennt.'
