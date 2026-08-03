<#
Reine Geometriehelfer fuer Tabellenregionen.

Die Funktionen enthalten absichtlich keine UIA-/Fensterzugriffe. Der Worker
liefert ihnen einen bereits gelesenen Knotenbestand und die Inhaltsgrenzen;
dadurch laesst sich derselbe Vertrag mit synthetischen Zwei-Tabellen-Seiten
testen, ohne eine Steuerdatei oder die laufende SSE zu beruehren.
#>

function Select-SSESummaryFromNodes {
  param(
    [Parameter(Mandatory)]$Nodes,
    [Parameter(Mandatory)]$Bounds,
    [Parameter(Mandatory)][string]$Label,
    [int]$Occurrence = 1
  )

  $texts = @($Nodes | Where-Object {
    $_.type -eq 'Text' -and $_.name -and
    $_.x -ge $Bounds.minX -and $_.x -le $Bounds.maxX
  })
  $found = New-Object System.Collections.ArrayList
  foreach ($field in ($Nodes | Where-Object {
    $_.type -in @('Edit','ComboBox','Spinner') -and
    $_.x -ge $Bounds.minX -and $_.x -le $Bounds.maxX
  } | Sort-Object y, x)) {
    $lab = ($texts | Where-Object {
      [Math]::Abs($_.y - $field.y) -le 14 -and $_.x -lt $field.x
    } | Sort-Object { $field.x - $_.x } | Select-Object -First 1).name
    if ($lab -and ($lab -eq $Label -or $lab.StartsWith($Label))) {
      $value = $(if ($null -ne $field.val) { "$($field.val)" } else { "$($field.name)" })
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

  $texts = @($Nodes | Where-Object {
    $_.type -eq 'Text' -and $_.name -and
    $_.x -ge $Bounds.minX -and $_.x -le $Bounds.maxX
  })
  $summaryYs = New-Object System.Collections.ArrayList
  foreach ($field in ($Nodes | Where-Object {
    $_.type -in @('Edit','ComboBox','Spinner') -and
    $_.x -ge $Bounds.minX -and $_.x -le ($Bounds.maxX + 200)
  })) {
    $label = ($texts | Where-Object {
      [Math]::Abs($_.y - $field.y) -le 14 -and $_.x -lt $field.x
    } | Sort-Object { $field.x - $_.x } | Select-Object -First 1).name
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
