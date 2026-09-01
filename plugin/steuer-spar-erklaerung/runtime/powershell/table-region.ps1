<#
Reine Geometriehelfer fuer Tabellenregionen.

Die Funktionen enthalten absichtlich keine UIA-/Fensterzugriffe. Der Worker
liefert ihnen einen bereits gelesenen Knotenbestand und die Inhaltsgrenzen;
dadurch laesst sich derselbe Vertrag mit synthetischen Zwei-Tabellen-Seiten
testen, ohne eine Steuerdatei oder die laufende SSE zu beruehren.
#>

function Get-SSEFieldLabelBindings {
  param(
    [Parameter(Mandatory)]$Nodes,
    [Parameter(Mandatory)]$Bounds,
    [Parameter(Mandatory)]$FieldMaxX
  )

  # Die Bindung eines links stehenden Textes an ein Feld ist ein reines
  # Naechster-Nachbar-Problem: groesstes Text-X, dessen ganzzahliges UIA-Y
  # hoechstens 14 Pixel abweicht. Ein X-Sweep aktiviert nur strikt links
  # liegende Texte und merkt pro Text-Y nur den besten Kandidaten. Jedes Feld
  # prueft danach genau seine 29 kompatiblen Y-Zeilen. Der Index lebt
  # ausschliesslich fuer diesen Aufruf.
  $texts = New-Object System.Collections.ArrayList
  $fields = New-Object System.Collections.ArrayList
  $ordinal = 0
  foreach ($node in @($Nodes)) {
    if ($node.type -eq 'Text' -and $node.name -and
        $node.x -ge $Bounds.minX -and $node.x -le $Bounds.maxX) {
      $null = $texts.Add([pscustomobject]@{
        node=$node; ordinal=$ordinal; x=[long]$node.x; y=[long]$node.y
      })
    }
    if ($node.type -in @('Edit','ComboBox','Spinner') -and
        $node.x -ge $Bounds.minX -and $node.x -le $FieldMaxX) {
      $null = $fields.Add([pscustomobject]@{
        node=$node; ordinal=$ordinal; x=[long]$node.x; y=[long]$node.y
      })
    }
    $ordinal++
  }

  if (-not $fields.Count) {
    return
  }

  $boundLabels = @{}
  if ($texts.Count) {
    $sortedTexts = @($texts | Sort-Object x, ordinal)
    $sortedFields = @($fields | Sort-Object x, ordinal)
    $bestByTextY = @{}
    $textIndex = 0

    foreach ($fieldEntry in $sortedFields) {
      # Strikt links: Texte mit demselben X werden erst fuer ein spaeteres
      # Feld aktiv. Bei identischem Kandidaten-X gewinnt bewusst die erste
      # Node-Ordinalzahl; das vermeidet die instabilen PS-5.1-Sort-Ties.
      while ($textIndex -lt $sortedTexts.Count -and
             $sortedTexts[$textIndex].x -lt $fieldEntry.x) {
        $textEntry = $sortedTexts[$textIndex]
        $current = $bestByTextY[$textEntry.y]
        if ($null -eq $current -or $textEntry.x -gt $current.x -or
            ($textEntry.x -eq $current.x -and $textEntry.ordinal -lt $current.ordinal)) {
          $bestByTextY[$textEntry.y] = $textEntry
        }
        $textIndex++
      }

      $best = $null
      for ($candidateY = $fieldEntry.y - 14;
           $candidateY -le $fieldEntry.y + 14; $candidateY++) {
        $candidate = $bestByTextY[$candidateY]
        if ($null -ne $candidate -and
            ($null -eq $best -or $candidate.x -gt $best.x -or
             ($candidate.x -eq $best.x -and $candidate.ordinal -lt $best.ordinal))) {
          $best = $candidate
        }
      }
      if ($null -ne $best) { $boundLabels[$fieldEntry.ordinal] = $best.node }
    }
  }

  # Wrapper bleiben in der Reihenfolge des urspruenglichen Snapshots. Damit
  # sieht das nachfolgende Sort-Object y,x dieselbe Eingangsreihenfolge wie
  # vor dem Index; nur der oben dokumentierte Label-X-Tie ist deterministisch.
  foreach ($fieldEntry in $fields) {
    $labelNode = $null
    if ($boundLabels.ContainsKey($fieldEntry.ordinal)) {
      $labelNode = $boundLabels[$fieldEntry.ordinal]
    }
    [pscustomobject]@{
      field=$fieldEntry.node; labelNode=$labelNode
      ordinal=$fieldEntry.ordinal; x=$fieldEntry.node.x; y=$fieldEntry.node.y
    }
  }
}

function Select-SSESummaryFromNodes {
  param(
    [Parameter(Mandatory)]$Nodes,
    [Parameter(Mandatory)]$Bounds,
    [Parameter(Mandatory)][string]$Label,
    [int]$Occurrence = 1
  )

  $bindings = @(Get-SSEFieldLabelBindings $Nodes $Bounds $Bounds.maxX)
  $found = New-Object System.Collections.ArrayList
  foreach ($binding in ($bindings | Sort-Object y, x)) {
    $field = $binding.field
    $lab = $(if ($binding.labelNode) { $binding.labelNode.name } else { $null })
    if ($lab -and ($lab -eq $Label -or $lab.StartsWith($Label))) {
      # Qt liefert bei manchen Summenfeldern ein vorhandenes, aber leeres
      # ValuePattern. Der sichtbare Name trägt dann weiterhin den Betrag;
      # leer ist kein brauchbarer Summenwert und darf die sichere Vorbedingung
      # einer Tabellenmutation nicht fälschlich scheitern lassen.
      $value = [string]$field.val
      if (-not $value) { $value = [string]$field.name }
      $null = $found.Add([pscustomobject]@{
        label=$lab; value=$value; y=$field.y; rid=$field.rid; aid=$field.aid
      })
    }
  }

  # Ein exaktes Label darf nicht durch laengere Labels wie
  # "Summe im Zeitraum" zusaetzliche, verschobene Occurrences bekommen.
  # Prefix-Matching bleibt nur der Rueckfall fuer dynamisch ergaenzte Labels.
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

function Get-SSETableRegionFromNodes {
  param(
    [Parameter(Mandatory)]$Nodes,
    [Parameter(Mandatory)]$Bounds,
    [Parameter(Mandatory)]$TargetSumRead
  )

  if (-not $TargetSumRead -or -not $TargetSumRead.selected) {
    return [pscustomobject]@{
      ok=$false; error='Die gewaehlte Summenzeile ist nicht sichtbar oder nicht eindeutig.'
      cells=@(); targetSumY=$null; previousSummaryY=$null
    }
  }

  $targetSumY = [int]$TargetSumRead.selected.y

  # Auf Seiten mit mehreren gleich aufgebauten Tabellen (insbesondere der ZM)
  # liegen Tabellenzellen und Summenfeld unter demselben stabilen Qt-Abschnitt,
  # z. B. SonstigeLeistungEU.Tab und SonstigeLeistungEU.SummeTab. Diese
  # AutomationId-Bindung ist genauer als reine Bildschirmgeometrie und
  # funktioniert auch dann, wenn die Summenzeile am unteren Fensterrand liegt.
  $targetAid = [string]$TargetSumRead.selected.aid
  $scopePrefix = $null
  if ($targetAid -match '^(?<prefix>.+?/\.(?<section>[A-Za-z0-9_]+)\./\.\k<section>\.)(?:SummeTab|SummeImZeitraum|VergleichSummeImZeitraum)(?:\.|/|$)') {
    $scopePrefix = [string]$Matches.prefix
  }
  if ($scopePrefix) {
    $scopedCells = @($Nodes | Where-Object {
      $_.type -eq 'DataItem' -and $_.w -gt 0 -and $_.aid -and
      ([string]$_.aid).StartsWith($scopePrefix, [StringComparison]::Ordinal)
    } | Sort-Object y, x)
    if ($scopedCells.Count) {
      return [pscustomobject]@{
        ok=$true; error=$null; cells=$scopedCells; targetSumY=$targetSumY
        previousSummaryY=$null; selectionMethod='automation-id-scope'; scopePrefix=$scopePrefix
      }
    }
  }

  $bindings = @(Get-SSEFieldLabelBindings $Nodes $Bounds ($Bounds.maxX + 200))
  $summaryYs = New-Object System.Collections.ArrayList
  foreach ($binding in $bindings) {
    $field = $binding.field
    $label = $(if ($binding.labelNode) { $binding.labelNode.name } else { $null })
    if ($label -match '^(?:Summe|Gesamtsumme)\b') { $null = $summaryYs.Add([int]$field.y) }
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
