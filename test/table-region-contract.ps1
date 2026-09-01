$ErrorActionPreference = 'Stop'

. (Join-Path $PSScriptRoot '..\powershell\table-region.ps1')

function Assert-True([bool]$Condition, [string]$Message) {
  if (-not $Condition) { throw $Message }
}

function Node([string]$Type, [string]$Name, [int]$X, [int]$Y, [int]$W = 80, [string]$Value = $null, [string]$Rid = '', [string]$Aid = '') {
  [pscustomobject]@{ type=$Type; name=$Name; x=$X; y=$Y; w=$W; h=20; val=$Value; rid=$Rid; aid=$Aid }
}

# Eingefrorene Referenz des ersetzten quadratischen Label-Scans. Zufallsfaelle
# vermeiden nur den in Windows PowerShell 5.1 instabilen Gleich-X-Sort-Tie.
function Get-LegacyFieldLabelBindings($Nodes, $Bounds, $FieldMaxX) {
  $texts = @($Nodes | Where-Object {
    $_.type -eq 'Text' -and $_.name -and
    $_.x -ge $Bounds.minX -and $_.x -le $Bounds.maxX
  })
  foreach ($field in ($Nodes | Where-Object {
    $_.type -in @('Edit','ComboBox','Spinner') -and
    $_.x -ge $Bounds.minX -and $_.x -le $FieldMaxX
  })) {
    $labelNode = @($texts | Where-Object {
      [Math]::Abs($_.y - $field.y) -le 14 -and $_.x -lt $field.x
    } | Sort-Object { $field.x - $_.x } | Select-Object -First 1)
    [pscustomobject]@{
      field=$field; labelNode=$(if ($labelNode.Count) { $labelNode[0] } else { $null })
      x=$field.x; y=$field.y
    }
  }
}

function Select-LegacySummary($Nodes, $Bounds, [string]$Label, [int]$Occurrence) {
  $found = New-Object System.Collections.ArrayList
  $bindings = @(Get-LegacyFieldLabelBindings $Nodes $Bounds $Bounds.maxX)
  foreach ($binding in ($bindings | Sort-Object y, x)) {
    $field = $binding.field
    $lab = $(if ($binding.labelNode) { $binding.labelNode.name } else { $null })
    if ($lab -and ($lab -eq $Label -or $lab.StartsWith($Label))) {
      $value = [string]$field.val
      if (-not $value) { $value = [string]$field.name }
      $null = $found.Add([pscustomobject]@{
        label=$lab; value=$value; y=$field.y; rid=$field.rid; aid=$field.aid
      })
    }
  }
  $exactFound = @($found | Where-Object { $_.label -eq $Label })
  $selectedFound = $(if ($exactFound.Count) { $exactFound } else { @($found) })
  $unique = @($selectedFound | Group-Object { "$($_.y)|$($_.value)" } |
    ForEach-Object { $_.Group[0] } | Sort-Object y)
  if ($Occurrence -lt 1 -or $Occurrence -gt $unique.Count) {
    return [pscustomobject]@{ value=$null; selected=$null; candidateCount=$unique.Count; candidates=$unique }
  }
  $selected = $unique[$Occurrence - 1]
  [pscustomobject]@{ value=$selected.value; selected=$selected; candidateCount=$unique.Count; candidates=$unique }
}

function Get-LegacyGeometryRegion($Nodes, $Bounds, $TargetSumRead) {
  if (-not $TargetSumRead -or -not $TargetSumRead.selected) {
    return [pscustomobject]@{
      ok=$false; error='Die gewaehlte Summenzeile ist nicht sichtbar oder nicht eindeutig.'
      cells=@(); targetSumY=$null; previousSummaryY=$null
    }
  }
  $targetSumY = [int]$TargetSumRead.selected.y
  $summaryYs = New-Object System.Collections.ArrayList
  foreach ($binding in @(Get-LegacyFieldLabelBindings $Nodes $Bounds ($Bounds.maxX + 200))) {
    $label = $(if ($binding.labelNode) { $binding.labelNode.name } else { $null })
    if ($label -match '^(?:Summe|Gesamtsumme)\b') { $null = $summaryYs.Add([int]$binding.field.y) }
  }
  $previousSummary = @($summaryYs | Where-Object { $_ -lt $targetSumY } |
    Sort-Object -Descending | Select-Object -First 1)
  $previousSummaryY = $(if ($previousSummary.Count) { [int]$previousSummary[0] } else { [int]::MinValue })
  $cells = @($Nodes | Where-Object {
    $_.type -eq 'DataItem' -and $_.w -gt 0 -and
    $_.x -ge $Bounds.minX -and $_.x -le ($Bounds.maxX + 200) -and
    $_.y -gt $previousSummaryY -and $_.y -lt $targetSumY
  } | Sort-Object y, x)
  [pscustomobject]@{
    ok=[bool]$cells.Count
    error=$(if ($cells.Count) { $null } else { 'Zwischen der vorherigen und der gewaehlten Summenzeile wurden keine Tabellenzellen gefunden.' })
    cells=$cells; targetSumY=$targetSumY
    previousSummaryY=$(if ($previousSummary.Count) { $previousSummaryY } else { $null })
    selectionMethod='geometry'; scopePrefix=$null
  }
}

function Json($Value) { ConvertTo-Json $Value -Depth 8 -Compress }

function Assert-PropertyNames($Value, [string]$Expected, [string]$Message) {
  $actual = @($Value.PSObject.Properties | ForEach-Object Name) -join ','
  Assert-True ($actual -eq $Expected) "$Message Property-Shape: $actual"
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

# Der Sweep bewahrt alle harten Geometriegrenzen: Text-Y +/-14 ist inklusiv,
# +/-15 nicht, Label muessen strikt links stehen und Text/Feld-X bleiben in
# ihren unterschiedlichen Bounds. Die Rueckgabe folgt der Node-Reihenfolge.
$boundaryNodes = @(
  (Node 'Text' 'dy14' 300 86 80 $null 'text-dy14')
  (Node 'Edit' '' 700 100 80 '1' 'field-dy14')
  (Node 'Text' 'dy15' 300 185 80 $null 'text-dy15')
  (Node 'Edit' '' 700 200 80 '2' 'field-dy15')
  (Node 'Text' 'same-x' 700 300 80 $null 'text-same-x')
  (Node 'Edit' '' 700 300 80 '3' 'field-same-x')
  (Node 'Text' 'at-min' 100 400 80 $null 'text-at-min')
  (Node 'Edit' '' 101 400 80 '4' 'field-after-min')
  (Node 'Text' 'at-max' 900 500 80 $null 'text-at-max')
  (Node 'Edit' '' 1100 500 80 '5' 'field-at-region-max')
  (Node 'Text' 'before-max' 899 600 80 $null 'text-before-max')
  (Node 'Edit' '' 900 600 80 '6' 'field-at-select-max')
  (Node 'Edit' '' 100 700 80 '7' 'field-at-min')
  (Node 'Edit' '' 1101 800 80 '8' 'field-outside-region')
)
$boundaryBindings = @(Get-SSEFieldLabelBindings $boundaryNodes $bounds ($bounds.maxX + 200))
Assert-True (($boundaryBindings | ForEach-Object { $_.field.rid }) -join ',' -eq
  'field-dy14,field-dy15,field-same-x,field-after-min,field-at-region-max,field-at-select-max,field-at-min') 'Feldgrenzen oder Wrapper-Quellreihenfolge wurden veraendert.'
$boundLabels = @{}
foreach ($binding in $boundaryBindings) {
  $boundLabels[$binding.field.rid] = $(if ($binding.labelNode) { $binding.labelNode.name } else { $null })
}
Assert-True ($boundLabels['field-dy14'] -eq 'dy14') 'Y-Abstand 14 wurde ausgeschlossen.'
Assert-True ($null -eq $boundLabels['field-dy15']) 'Y-Abstand 15 wurde eingeschlossen.'
Assert-True ($null -eq $boundLabels['field-same-x']) 'Label mit demselben X wurde nicht strikt ausgeschlossen.'
Assert-True ($boundLabels['field-after-min'] -eq 'at-min' -and $boundLabels['field-at-region-max'] -eq 'at-max') 'Inklusive Text-X-Grenzen wurden veraendert.'
Assert-True ($boundLabels['field-at-select-max'] -eq 'before-max') 'Inklusive Feld-maxX-Grenze wurde veraendert.'

# Nur der zuvor instabile Equal-X-Tie ist absichtlich determinisiert: die
# kleinere urspruengliche Node-Ordinalzahl gewinnt in beiden Eingabereihenfolgen.
$tieGood = @(
  (Node 'Text' 'Summe' 300 100), (Node 'Text' 'Wrong' 300 101),
  (Node 'Edit' '' 700 100 80 '1' 'tie-good')
)
$tieBad = @(
  (Node 'Text' 'Wrong' 300 101), (Node 'Text' 'Summe' 300 100),
  (Node 'Edit' '' 700 100 80 '1' 'tie-bad')
)
Assert-True ((Select-SSESummaryFromNodes $tieGood $bounds 'Summe' 1).candidateCount -eq 1) 'Equal-X-Tie nutzte nicht die erste passende Node-Ordinalzahl.'
Assert-True ((Select-SSESummaryFromNodes $tieBad $bounds 'Summe' 1).candidateCount -eq 0) 'Equal-X-Tie uebersprang die erste unpassende Node-Ordinalzahl.'

# Exakt bleibt case-insensitive, Prefix bewusst case-sensitive; Group-Object
# dedupliziert wie zuvor case-insensitive und der String "0" bleibt ein Wert.
$caseExact = Select-SSESummaryFromNodes @(
  (Node 'Text' 'SUMME' 300 100), (Node 'Edit' '' 700 100 80 '1' 'case-exact')
) $bounds 'summe' 1
Assert-True ($caseExact.candidateCount -eq 1) 'Case-insensitives exaktes Label ging verloren.'
$casePrefix = Select-SSESummaryFromNodes @(
  (Node 'Text' 'Summe dynamisch' 300 100), (Node 'Edit' '' 700 100 80 '1' 'case-prefix')
) $bounds 'Summe' 1
$casePrefixMismatch = Select-SSESummaryFromNodes @(
  (Node 'Text' 'Summe dynamisch' 300 100), (Node 'Edit' '' 700 100 80 '1' 'case-prefix-mismatch')
) $bounds 'summe' 1
Assert-True ($casePrefix.candidateCount -eq 1 -and $casePrefixMismatch.candidateCount -eq 0) 'Case-sensitive Prefix-Semantik wurde veraendert.'
$deduped = Select-SSESummaryFromNodes @(
  (Node 'Text' 'Summe' 300 100)
  (Node 'Edit' '' 700 100 80 'ABC' 'dedupe-a')
  (Node 'Edit' '' 800 100 80 'abc' 'dedupe-b')
) $bounds 'Summe' 1
Assert-True ($deduped.candidateCount -eq 1) 'Group-Object deduplizierte Werte nicht mehr case-insensitive.'
$zeroValue = Select-SSESummaryFromNodes @(
  (Node 'Text' 'Summe' 300 100), (Node 'Edit' 'fallback' 700 100 80 '0' 'zero')
) $bounds 'Summe' 1
Assert-True ($zeroValue.value -eq '0') 'Der Wert "0" fiel faelschlich auf den Feldnamen zurueck.'

# Public Shapes, Array-Erhalt und Referenzen bleiben exakt. Die geometrischen
# Zellgrenzen sind an X/Y strikt beziehungsweise inklusiv wie zuvor.
Assert-PropertyNames $caseExact 'value,selected,candidateCount,candidates' 'Summenresultat'
Assert-True ($caseExact.candidates -is [array]) 'Ein einzelner Summenkandidat wurde nicht als Array geliefert.'
Assert-True ([object]::ReferenceEquals($caseExact.selected, $caseExact.candidates[0])) 'selected verweist nicht auf das Kandidatenobjekt.'
$earlyRegion = Get-SSETableRegionFromNodes @() $bounds ([pscustomobject]@{ selected=$null })
Assert-PropertyNames $earlyRegion 'ok,error,cells,targetSumY,previousSummaryY' 'Frueher Regionsfehler'
Assert-True ($earlyRegion.cells -is [array]) 'Leere Zellen des fruehen Fehlers sind kein Array.'

$insideLow = Node 'DataItem' 'inside-low' 100 101 1 $null 'inside-low'
$insideHigh = Node 'DataItem' 'inside-high' 1100 199 1 $null 'inside-high'
$geometryNodes = @(
  (Node 'Text' 'Summe' 900 100)
  (Node 'Edit' '' 1100 100 80 '10' 'previous-at-region-max')
  $insideLow
  $insideHigh
  (Node 'DataItem' 'x-low' 99 150 1 $null 'x-low')
  (Node 'DataItem' 'x-high' 1101 150 1 $null 'x-high')
  (Node 'DataItem' 'at-previous' 500 100 1 $null 'at-previous')
  (Node 'DataItem' 'at-target' 500 200 1 $null 'at-target')
  (Node 'DataItem' 'zero-width' 500 150 0 $null 'zero-width')
)
$directTarget = [pscustomobject]@{ selected=[pscustomobject]@{ y=200; aid=''; rid='target' } }
$geometryRegion = Get-SSETableRegionFromNodes $geometryNodes $bounds $directTarget
Assert-PropertyNames $geometryRegion 'ok,error,cells,targetSumY,previousSummaryY,selectionMethod,scopePrefix' 'Geometrieregion'
Assert-True ($geometryRegion.previousSummaryY -eq 100) 'Feld bei maxX+200 wurde nicht als vorherige Summe erkannt.'
Assert-True (($geometryRegion.cells | ForEach-Object rid) -join ',' -eq 'inside-low,inside-high') 'Strikte Y-, inklusive X- oder w>0-Zellgrenzen wurden veraendert.'
Assert-True ([object]::ReferenceEquals($geometryRegion.cells[0], $insideLow)) 'Geometriezelle wurde kopiert statt referenziert.'
$noPrevious = Get-SSETableRegionFromNodes @((Node 'DataItem' 'only' 100 10 1 $null 'only')) $bounds ([pscustomobject]@{ selected=[pscustomobject]@{ y=50; aid='' } })
Assert-True ($null -eq $noPrevious.previousSummaryY) 'Fehlende vorherige Summe gab nicht null zurueck.'
$emptyGeometry = Get-SSETableRegionFromNodes @() $bounds ([pscustomobject]@{ selected=[pscustomobject]@{ y=50; aid='' } })
Assert-True ($emptyGeometry.error -eq 'Zwischen der vorherigen und der gewaehlten Summenzeile wurden keine Tabellenzellen gefunden.') 'Geometriefehlertext wurde veraendert.'

# Bei gleichen Sort-Schluesseln bleibt die PS-5.1-Reihenfolge unangetastet:
# Wrapper kommen in Quellreihenfolge, Zellen bleiben die Originalreferenzen.
$orderLabel = Node 'Text' 'Summe' 300 100 1 $null 'order-label'
$orderFieldA = Node 'Edit' '' 700 100 1 'A' 'order-field-a'
$orderFieldB = Node 'Edit' '' 700 100 1 'B' 'order-field-b'
$orderCellA = Node 'DataItem' 'A' 500 150 1 $null 'order-cell-a'
$orderCellB = Node 'DataItem' 'B' 500 150 1 $null 'order-cell-b'
foreach ($orderNodes in @(
  @($orderLabel, $orderFieldA, $orderFieldB, $orderCellA, $orderCellB),
  @($orderCellB, $orderFieldB, $orderLabel, $orderCellA, $orderFieldA)
)) {
  $legacyOrderSummary = Select-LegacySummary $orderNodes $bounds 'Summe' 1
  $indexedOrderSummary = Select-SSESummaryFromNodes $orderNodes $bounds 'Summe' 1
  Assert-True ((Json $legacyOrderSummary) -eq (Json $indexedOrderSummary)) 'Equal-y/x-Felder aenderten ihre Legacy-Reihenfolge.'
  $legacyOrderRegion = Get-LegacyGeometryRegion $orderNodes $bounds $directTarget
  $indexedOrderRegion = Get-SSETableRegionFromNodes $orderNodes $bounds $directTarget
  Assert-True ((@($legacyOrderRegion.cells | ForEach-Object rid) -join ',') -eq (@($indexedOrderRegion.cells | ForEach-Object rid) -join ',')) 'Equal-y/x-Zellen aenderten ihre Legacy-Reihenfolge.'
  for ($cellIndex = 0; $cellIndex -lt $indexedOrderRegion.cells.Count; $cellIndex++) {
    Assert-True ([object]::ReferenceEquals($indexedOrderRegion.cells[$cellIndex], $legacyOrderRegion.cells[$cellIndex])) 'Equal-y/x-Zelle verlor ihre Quellreferenz.'
  }
}

# Der AID-Fast-Path muss vor jedem Geometrieindex zurueckkehren. Der Textknoten
# wuerde bei einem versehentlichen Indexaufbau bereits beim X-Zugriff werfen.
$bomb = [pscustomobject]@{ type='Text'; name='nicht lesen'; y=1; w=1; h=1; val=''; rid='bomb'; aid='' }
$bomb | Add-Member -MemberType ScriptProperty -Name x -Value { throw 'Geometrieindex wurde trotz AID-Treffer gebaut.' }
$aidPrefix = 'Root./.Section./.Section.'
$aidCell = Node 'DataItem' 'aid-cell' 500 999 1 $null 'aid-cell' ($aidPrefix + 'Tab')
$aidTarget = [pscustomobject]@{ selected=[pscustomobject]@{ y=100; aid=($aidPrefix + 'SummeTab./.Wert') } }
$aidEarly = Get-SSETableRegionFromNodes @($bomb, $aidCell) $bounds $aidTarget
Assert-True ($aidEarly.selectionMethod -eq 'automation-id-scope' -and [object]::ReferenceEquals($aidEarly.cells[0], $aidCell)) 'AID-Fast-Path baute den Geometrieindex oder kopierte Zellen.'

# Regressionsguard gegen den alten per-field Rescan: Die Text-X-Property darf
# nur beim einmaligen Snapshot-Aufbau gelesen werden, nicht je Feld erneut.
$script:tableRegionTextXReads = 0
$complexityNodes = New-Object System.Collections.ArrayList
for ($i = 0; $i -lt 80; $i++) {
  $text = [pscustomobject]@{ type='Text'; name='Summe'; _x=(100 + $i); y=(100 + ($i % 20)); w=1; h=1; val=''; rid="cx-t-$i"; aid='' }
  $text | Add-Member -MemberType ScriptProperty -Name x -Value { $script:tableRegionTextXReads++; $this._x }
  $null = $complexityNodes.Add($text)
}
for ($i = 0; $i -lt 120; $i++) {
  $null = $complexityNodes.Add((Node 'Edit' '' (1000 + $i) (100 + ($i % 20)) 1 '1' "cx-f-$i"))
}
$complexityBindings = @(Get-SSEFieldLabelBindings $complexityNodes ([pscustomobject]@{ minX=0; maxX=2000 }) 2000)
Assert-True ($complexityBindings.Count -eq 120) 'Komplexitaetsfixture verlor Felder.'
Assert-True ($script:tableRegionTextXReads -le 320) "Label-X wurde $script:tableRegionTextXReads-mal gelesen; ein per-field Rescan ist wahrscheinlich."

# Deterministische Legacy-Differenz: eindeutige Text-X vermeiden nur den oben
# explizit geaenderten Tie; alle Shapes, Kandidaten und Geometriezellen muessen
# ansonsten bitgenau gleich bleiben. SSE_TABLE_REGION_SEED spielt einen Fall ab.
$baseSeed = $(if ($env:SSE_TABLE_REGION_SEED) { [int]$env:SSE_TABLE_REGION_SEED } else { 1592598566 })
$caseCount = $(if ($env:SSE_TABLE_REGION_SEED) { 1 } else { 64 })
$geometrySuccessCount = 0
for ($caseIndex = 0; $caseIndex -lt $caseCount; $caseIndex++) {
  $caseSeed = $baseSeed + $caseIndex
  $random = New-Object System.Random($caseSeed)
  $nodes = New-Object System.Collections.ArrayList
  for ($row = 0; $row -lt 12; $row++) {
    $y = 80 + ($row * 35)
    $labels = @('Summe','Summe im Zeitraum','Gesamtsumme','Andere')
    $labelName = $labels[$random.Next(0, $labels.Count)]
    $null = $nodes.Add((Node 'Text' $labelName (120 + ($row * 11)) ($y + $random.Next(-14, 15)) 1 $null "r$caseIndex-t$row"))
    $fieldTypes = @('Edit','ComboBox','Spinner')
    $fieldValue = @('', '0', 'ABC', 'abc', "$row,00")[$random.Next(0, 5)]
    $null = $nodes.Add((Node $fieldTypes[$random.Next(0, 3)] "name-$row" (600 + ($row * 5)) $y 1 $fieldValue "r$caseIndex-f$row"))
    $null = $nodes.Add((Node 'DataItem' "cell-$row" (200 + ($row % 3) * 100) ($y - 10) 1 $null "r$caseIndex-c$row"))
  }
  for ($noise = 0; $noise -lt 4; $noise++) {
    $null = $nodes.Add((Node 'Text' 'Noise' (350 + ($noise * 11)) $random.Next(50, 500) 1 $null "r$caseIndex-n$noise"))
  }
  for ($i = $nodes.Count - 1; $i -gt 0; $i--) {
    $j = $random.Next(0, $i + 1)
    $tmp = $nodes[$i]; $nodes[$i] = $nodes[$j]; $nodes[$j] = $tmp
  }
  $label = @('Summe','Gesamtsumme')[$random.Next(0, 2)]
  $occurrence = $random.Next(0, 5)
  $legacySummary = Select-LegacySummary $nodes $bounds $label $occurrence
  $indexedSummary = Select-SSESummaryFromNodes $nodes $bounds $label $occurrence
  if ((Json $legacySummary) -ne (Json $indexedSummary)) {
    throw "Summary-Differenz seed=$caseSeed label=$label occurrence=$occurrence bounds=$(Json $bounds) nodes=$(Json @($nodes))"
  }
  $legacyRegion = Get-LegacyGeometryRegion $nodes $bounds $legacySummary
  $indexedRegion = Get-SSETableRegionFromNodes $nodes $bounds $indexedSummary
  if ((Json $legacyRegion) -ne (Json $indexedRegion)) {
    throw "Region-Differenz seed=$caseSeed label=$label occurrence=$occurrence bounds=$(Json $bounds) nodes=$(Json @($nodes))"
  }
  if ($legacyRegion.ok -and $legacyRegion.selectionMethod -eq 'geometry') { $geometrySuccessCount++ }
}
if (-not $env:SSE_TABLE_REGION_SEED) {
  Assert-True ($geometrySuccessCount -gt 0) 'Die 64-seed-Differenz uebte keinen erfolgreichen Geometry-Pfad aus.'
}

Write-Output "OK: Tabellenregionen, X-Sweep-Grenzen und $caseCount deterministische Legacy-Differenzfaelle sind stabil."
