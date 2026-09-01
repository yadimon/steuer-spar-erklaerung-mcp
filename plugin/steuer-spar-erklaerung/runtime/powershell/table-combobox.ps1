<#
Pure binding helpers for semantic ComboBox editors exposed by Qt table cells.

The caller opens the editor through the cell's InvokePattern and supplies only
already captured UIA trees. These helpers never access the desktop, never use
FindAll and never click. A popup is accepted only when one List is attached to
the exact cell geometry and belongs either to the main window or to exactly one
new same-process popup window.
#>

function Get-SSETableComboExpectedBefore {
  param([Parameter(Mandatory)]$Args, [Parameter(Mandatory)][int]$ColumnIndex)

  # Do not use value truthiness here: an empty string is the legitimate value
  # of a not-yet-assigned Qt category cell. Presence of the outer argument and
  # the numeric property is the complete syntactic contract.
  $mapProperty = @($Args.PSObject.Properties | Where-Object {
    [string]$_.Name -ceq 'comboExpectedBefore'
  } | Select-Object -First 1)
  if (-not $mapProperty.Count -or $null -eq $mapProperty[0].Value) {
    return [pscustomobject]@{ present=$false; value=$null }
  }
  $map = $mapProperty[0].Value
  $columnName = [string]$ColumnIndex
  if ($map -is [Collections.IDictionary]) {
    $present = [bool]$map.Contains($columnName)
    return [pscustomobject]@{
      present=$present; value=$(if ($present) { [string]$map[$columnName] } else { $null })
    }
  }
  $columnProperty = @($map.PSObject.Properties | Where-Object {
    [string]$_.Name -ceq $columnName
  } | Select-Object -First 1)
  [pscustomobject]@{
    present=[bool]$columnProperty.Count
    value=$(if ($columnProperty.Count) { [string]$columnProperty[0].Value } else { $null })
  }
}

function Test-SSETableRowFreeWithProfileDefaults {
  param(
    [Parameter(Mandatory)]$Cells,
    $TableProfile = $null
  )
  $rowCells = @($Cells | Sort-Object x)
  for ($columnIndex = 0; $columnIndex -lt $rowCells.Count; $columnIndex++) {
    $cell = $rowCells[$columnIndex]
    $cellName = [string]$cell.name
    if (-not $cellName) { continue }
    if ($cellName -in @('0,00','0')) { continue }
    $neutralTaxSelector = $cellName -in @('7','19') -and [int]$cell.w -le 80
    if ($neutralTaxSelector) { continue }

    $neutralProfileDefault = $false
    if ($TableProfile -and $TableProfile.known -and $TableProfile.bindingOk) {
      $columnProfile = @($TableProfile.columns | Where-Object {
        [int]$_.index -eq $columnIndex -and $_.PSObject.Properties['emptyRowDefault']
      } | Select-Object -First 1)
      $neutralProfileDefault = [bool]($columnProfile.Count -eq 1 -and
        [string]$columnProfile[0].emptyRowDefault -ceq $cellName)
    }
    if (-not $neutralProfileDefault) { return $false }
  }
  $true
}

function Test-SSETableComboAttachedRectangle {
  param([Parameter(Mandatory)]$Cell, [Parameter(Mandatory)]$Rectangle)
  if ($Cell.w -le 0 -or $Cell.h -le 0 -or $Rectangle.w -le 0 -or $Rectangle.h -le 0) { return $false }
  $cellLeft = [int]$Cell.x; $cellRight = [int]($Cell.x + $Cell.w)
  $rectLeft = [int]$Rectangle.x; $rectRight = [int]($Rectangle.x + $Rectangle.w)
  $horizontalOverlap = [Math]::Min($cellRight, $rectRight) - [Math]::Max($cellLeft, $rectLeft)
  if ($horizontalOverlap -le 0) { return $false }
  $cellTop = [int]$Cell.y; $cellBottom = [int]($Cell.y + $Cell.h)
  $rectTop = [int]$Rectangle.y; $rectBottom = [int]($Rectangle.y + $Rectangle.h)
  $derivedTolerance = [Math]::Max(2, [int]$Cell.h)
  [bool]($rectTop -le ($cellBottom + $derivedTolerance) -and $rectBottom -ge ($cellTop - $derivedTolerance))
}

function Test-SSETableComboCellAidProfileFragment {
  param(
    [Parameter(Mandatory)][AllowEmptyString()][string]$AutomationId,
    [Parameter(Mandatory)][AllowEmptyString()][string]$AutomationIdSection
  )
  if (-not $AutomationId -or -not $AutomationIdSection) { return $false }
  # Nicht den bloßen Section-Namen suchen: beide Qt-Pfadkomponenten samt
  # Trennzeichen muessen exakt vorkommen. Dadurch passt grpEmpf13b weder auf
  # grpEmpf13bX noch auf irgendeinen freien Textteil einer Automation-ID.
  $exactFragment = "/.$AutomationIdSection./.$AutomationIdSection."
  [bool]($AutomationId.IndexOf($exactFragment, [StringComparison]::Ordinal) -ge 0)
}

function Get-SSETableComboDropArrowPoint {
  param(
    [Parameter(Mandatory)]$Cell,
    $NextCell = $null
  )
  $left=[int]$Cell.x; $top=[int]$Cell.y; $width=[int]$Cell.w; $height=[int]$Cell.h
  $right=$left + $width; $bottom=$top + $height
  if ($width -lt 8 -or $height -lt 6) {
    return [pscustomobject]@{ ok=$false; reason='cell-too-small' }
  }
  $inset=[Math]::Min(12, [Math]::Max(4, [int][Math]::Floor($height / 3)))
  $x=$right - $inset; $y=[int][Math]::Floor($top + ($height / 2))
  $inside=[bool]($x -gt $left -and $x -lt $right -and $y -gt $top -and $y -lt $bottom)
  $beforeNext=[bool](-not $NextCell -or $x -lt [int]$NextCell.x)
  if (-not $inside -or -not $beforeNext) {
    return [pscustomobject]@{ ok=$false; reason=$(if (-not $inside) { 'point-outside-cell' } else { 'point-not-before-next-column' }) }
  }
  [pscustomobject]@{
    ok=$true; x=$x; y=$y; inset=$inset
    cellRight=$right; nextColumnX=$(if ($NextCell) { [int]$NextCell.x } else { $null })
    node=[pscustomobject]@{ x=$x - 1; y=$y - 1; w=2; h=2; source='profile-bound-table-combobox-drop-arrow' }
  }
}

function Test-SSETableComboOpenFallbackBinding {
  param(
    [Parameter(Mandatory)]$InitialState,
    [Parameter(Mandatory)]$FreshState,
    [Parameter(Mandatory)]$TableBinding,
    [Parameter(Mandatory)][AllowEmptyString()][string]$ExpectedCurrent,
    [Parameter(Mandatory)][int]$ColumnIndex,
    [Parameter(Mandatory)][int]$SumOccurrence
  )

  if (-not $InitialState.ok -or -not $FreshState.ok) {
    return [pscustomobject]@{ ok=$false; reason='initial-or-fresh-state-unbound' }
  }
  $section = [string]$TableBinding.automationIdSection
  $expectedScopeSuffix = "/.$section./.$section."
  $initialScope = [string]$InitialState.region.scopePrefix
  $freshScope = [string]$FreshState.region.scopePrefix
  $regionProfileBound = [bool]($TableBinding.known -and $TableBinding.aidBound -and
    $initialScope -and $initialScope -ceq [string]$TableBinding.observedScopePrefix -and
    $freshScope -ceq $initialScope -and
    $freshScope.EndsWith($expectedScopeSuffix, [StringComparison]::Ordinal))
  $cellProfileBound = [bool]($TableBinding.known -and $TableBinding.aidFallback -and
    (Test-SSETableComboCellAidProfileFragment ([string]$InitialState.cell.aid) $section) -and
    (Test-SSETableComboCellAidProfileFragment ([string]$FreshState.cell.aid) $section))
  $checks = [ordered]@{
    initialRidPresent=[bool]$InitialState.cell.rid
    freshVisible=[bool]([int]$FreshState.cell.w -gt 0 -and [int]$FreshState.cell.h -gt 0)
    headingSame=[bool]([string]$InitialState.heading -ceq [string]$FreshState.heading)
    sumRidPresent=[bool]$InitialState.sumRead.selected.rid
    sumRidSame=[bool]([string]$InitialState.sumRead.selected.rid -ceq [string]$FreshState.sumRead.selected.rid)
    scopeSame=[bool]($freshScope -ceq $initialScope)
    profileKnown=[bool]$TableBinding.known
    profileEvidenceBound=[bool]($regionProfileBound -or $cellProfileBound)
    rowYSame=[bool]([int]$InitialState.cell.y -eq [int]$FreshState.cell.y)
    cellRidSame=[bool]([string]$InitialState.cell.rid -ceq [string]$FreshState.cell.rid)
    cellAidSame=[bool]([string]$InitialState.cell.aid -ceq [string]$FreshState.cell.aid)
    rectangleSame=[bool]([int]$InitialState.cell.x -eq [int]$FreshState.cell.x -and
      [int]$InitialState.cell.y -eq [int]$FreshState.cell.y -and
      [int]$InitialState.cell.w -eq [int]$FreshState.cell.w -and
      [int]$InitialState.cell.h -eq [int]$FreshState.cell.h)
    valueSameAsExpected=[bool]([string]$FreshState.value -ceq $ExpectedCurrent)
  }
  $mismatches = @($checks.GetEnumerator() | Where-Object { -not [bool]$_.Value } | ForEach-Object { [string]$_.Key })
  $sameBinding = [bool](-not $mismatches.Count)
  [pscustomobject]@{
    ok=$sameBinding
    reason=$(if ($sameBinding) { $null } else { 'identity-mismatch: ' + ($mismatches -join ',') })
    evidence=[pscustomobject]@{
      expected=[pscustomobject]@{
        sumOccurrence=$SumOccurrence; columnIndex=$ColumnIndex; value=$ExpectedCurrent
        automationIdSection=$section; scopePrefix=[string]$TableBinding.observedScopePrefix
      }
      profileEvidence=[pscustomobject]@{
        method=$(if ($regionProfileBound) { 'summary-region-scope-prefix' } elseif ($cellProfileBound) { 'initial+fresh-cell-automation-id-fragment' } else { $null })
        regionScopeBound=$regionProfileBound; cellAidFallbackBound=$cellProfileBound
        known=[bool]$TableBinding.known; aidBound=[bool]$TableBinding.aidBound; aidFallback=[bool]$TableBinding.aidFallback
        exactCellAidFragment=$expectedScopeSuffix
      }
      initial=[pscustomobject]@{
        heading=[string]$InitialState.heading; sumRid=[string]$InitialState.sumRead.selected.rid
        scopePrefix=$initialScope; rowY=[int]$InitialState.cell.y; columnIndex=$ColumnIndex
        cellRid=[string]$InitialState.cell.rid; cellAid=[string]$InitialState.cell.aid
        rectangle=[pscustomobject]@{ x=[int]$InitialState.cell.x; y=[int]$InitialState.cell.y; w=[int]$InitialState.cell.w; h=[int]$InitialState.cell.h }
        value=[string]$InitialState.value; rowCellCount=[int]$InitialState.rowCellCount; ridMatchCount=[int]$InitialState.ridMatchCount
      }
      fresh=[pscustomobject]@{
        heading=[string]$FreshState.heading; sumRid=[string]$FreshState.sumRead.selected.rid
        scopePrefix=$freshScope; rowY=[int]$FreshState.cell.y; columnIndex=$ColumnIndex
        cellRid=[string]$FreshState.cell.rid; cellAid=[string]$FreshState.cell.aid
        rectangle=[pscustomobject]@{ x=[int]$FreshState.cell.x; y=[int]$FreshState.cell.y; w=[int]$FreshState.cell.w; h=[int]$FreshState.cell.h }
        value=[string]$FreshState.value; rowCellCount=[int]$FreshState.rowCellCount; ridMatchCount=[int]$FreshState.ridMatchCount
      }
      checks=[pscustomobject]$checks; mismatches=$mismatches
    }
  }
}

function ConvertTo-SSETableComboBoundedDiagnosticValue {
  param(
    $Value,
    [Parameter(Mandatory)][ref]$Nodes,
    [int]$Depth = 0
  )
  if ($null -eq $Value) { return $null }
  if ([int]$Nodes.Value -ge 512) { return '[diagnostic-node-budget-exhausted]' }
  $Nodes.Value = [int]$Nodes.Value + 1
  if ($Value -is [string]) {
    $text = [string]$Value
    if ($text.Length -le 2048) { return $text }
    return $text.Substring(0, 2048) + '[truncated]'
  }
  if ($Value -is [ValueType]) { return $Value }
  if ($Depth -ge 8) { return '[diagnostic-depth-limit]' }
  if ($Value -is [Collections.IDictionary]) {
    $result = [ordered]@{}
    $entries = @($Value.GetEnumerator())
    foreach ($entry in @($entries | Select-Object -First 64)) {
      $result[[string]$entry.Key] = ConvertTo-SSETableComboBoundedDiagnosticValue $entry.Value $Nodes ($Depth + 1)
    }
    if ($entries.Count -gt 64) { $result['__truncatedProperties'] = $entries.Count - 64 }
    return [pscustomobject]$result
  }
  if ($Value -is [Array]) {
    $items = @($Value)
    $result = New-Object System.Collections.ArrayList
    foreach ($item in @($items | Select-Object -First 64)) {
      $null = $result.Add((ConvertTo-SSETableComboBoundedDiagnosticValue $item $Nodes ($Depth + 1)))
    }
    if ($items.Count -gt 64) { $null = $result.Add([pscustomobject]@{ __truncatedItems=$items.Count - 64 }) }
    return @($result)
  }
  if ($Value -is [pscustomobject]) {
    $result = [ordered]@{}
    $properties = @($Value.PSObject.Properties)
    foreach ($property in @($properties | Select-Object -First 64)) {
      $result[[string]$property.Name] = ConvertTo-SSETableComboBoundedDiagnosticValue $property.Value $Nodes ($Depth + 1)
    }
    if ($properties.Count -gt 64) { $result['__truncatedProperties'] = $properties.Count - 64 }
    return [pscustomobject]$result
  }
  $fallback = [string]$Value
  if ($fallback.Length -gt 2048) { $fallback = $fallback.Substring(0, 2048) + '[truncated]' }
  $fallback
}

function Get-SSETableComboDiagnosticProjection {
  param([Parameter(Mandatory)]$ComboResult)
  $nodes = 0
  $kind = [string]$ComboResult.kind
  if (-not $kind -and $ComboResult.popupBinding) { $kind = [string]$ComboResult.popupBinding.kind }
  if (-not $kind) { $kind = $(if ($ComboResult.ok) { 'ok' } else { 'typed-table-combo-failed' }) }
  $editorClosed = $null
  if ($null -ne $ComboResult.editorClosed) { $editorClosed = [bool]$ComboResult.editorClosed }
  elseif ($null -ne $ComboResult.popupClosed) { $editorClosed = [bool]$ComboResult.popupClosed }
  [pscustomobject]@{
    error=ConvertTo-SSETableComboBoundedDiagnosticValue ([string]$ComboResult.error) ([ref]$nodes)
    kind=ConvertTo-SSETableComboBoundedDiagnosticValue $kind ([ref]$nodes)
    mutationStarted=[bool]$ComboResult.mutationStarted
    interference=[bool]$ComboResult.interference
    editorClosed=$editorClosed
    openEvidence=ConvertTo-SSETableComboBoundedDiagnosticValue $ComboResult.openEvidence ([ref]$nodes)
    popupBinding=ConvertTo-SSETableComboBoundedDiagnosticValue $ComboResult.popupBinding ([ref]$nodes)
    diagnosticBounds=[pscustomobject]@{ maxDepth=8; maxItemsPerCollection=64; maxNodes=512; maxStringChars=2048 }
  }
}

function Test-SSETableComboNodeDescendant {
  param([Parameter(Mandatory)]$Nodes, [Parameter(Mandatory)][int]$NodeIndex, [Parameter(Mandatory)][int]$AncestorIndex)
  $cursor = $NodeIndex
  for ($depth = 0; $depth -lt 12; $depth++) {
    if ($cursor -lt 0 -or $cursor -ge $Nodes.Count) { return $false }
    if ($cursor -eq $AncestorIndex) { return $true }
    $cursor = [int]$Nodes[$cursor].p
  }
  $false
}

function Resolve-SSETableComboPopup {
  param(
    [Parameter(Mandatory)]$Sources,
    [Parameter(Mandatory)]$Cell,
    [Parameter(Mandatory)][string]$Wanted,
    [Parameter(Mandatory)][AllowEmptyString()][string]$ExpectedCurrent,
    [Parameter(Mandatory)]$TableBinding
  )

  $automationIdSection = [string]$TableBinding.automationIdSection
  $expectedScopeSuffix = "/.$automationIdSection./.$automationIdSection."
  $cellAidBound = [bool]($Cell.rid -and $TableBinding.known -and $TableBinding.aidFallback -and
    (Test-SSETableComboCellAidProfileFragment ([string]$Cell.aid) $automationIdSection))
  $regionAidBound = [bool]($Cell.rid -and $TableBinding.known -and $automationIdSection -and $TableBinding.aidBound -and
    [string]$TableBinding.observedScopePrefix -and
    ([string]$TableBinding.observedScopePrefix).EndsWith($expectedScopeSuffix, [StringComparison]::Ordinal))
  if (-not $cellAidBound -and -not $regionAidBound) {
    return [pscustomobject]@{
      ok=$false; kind='profile-binding-mismatch'
      error='Weder Tabellenregion noch Tabellenzelle ist an den Automation-ID-Abschnitt des Produktprofils gebunden.'
      candidates=@()
    }
  }

  $candidates = New-Object System.Collections.ArrayList
  foreach ($source in @($Sources)) {
    $nodes = @($source.tree.nodes)
    if (-not $nodes.Count) { continue }
    foreach ($list in @($nodes | Where-Object { $_.type -eq 'List' -and $_.rid -and $_.w -gt 0 -and $_.h -gt 0 })) {
      $items = @($nodes | Where-Object {
        $_.type -eq 'ListItem' -and $_.name -and $_.rid -and
        (Test-SSETableComboNodeDescendant $nodes ([int]$_.i) ([int]$list.i))
      })
      if (-not $items.Count) { continue }
      $attached = Test-SSETableComboAttachedRectangle $Cell $list
      if (-not $attached -and $source.isNewPopup -and $source.window) {
        $attached = Test-SSETableComboAttachedRectangle $Cell $source.window
      }
      if (-not $attached) { continue }
      if (-not $source.isMain -and -not $source.isNewPopup) { continue }

      $wantedMatches = @($items | Where-Object { [string]$_.name -ceq $Wanted })
      $currentMatches = @($items | Where-Object { [string]$_.name -ceq $ExpectedCurrent })
      $duplicateNames = @($items | Group-Object { [string]$_.name } | Where-Object { $_.Count -ne 1 })
      $null = $candidates.Add([pscustomobject]@{
        sourceHwnd=[int64]$source.hwnd; isMain=[bool]$source.isMain; isNewPopup=[bool]$source.isNewPopup
        list=$list; items=$items; wantedMatches=$wantedMatches; currentMatches=$currentMatches
        duplicateNames=$duplicateNames
      })
    }
  }

  $complete = @($candidates | Where-Object {
    $_.wantedMatches.Count -eq 1 -and $_.currentMatches.Count -eq 1 -and $_.duplicateNames.Count -eq 0
  })
  if ($complete.Count -ne 1) {
    return [pscustomobject]@{
      ok=$false; kind=$(if (-not $complete.Count) { 'option-binding-not-found' } else { 'option-binding-ambiguous' })
      error="Exakt eine gebundene Optionsliste mit Ziel '$Wanted' und Vorwert '$ExpectedCurrent' ist erforderlich; gefunden: $($complete.Count)."
      candidates=@($candidates | ForEach-Object {
        [pscustomobject]@{
          sourceHwnd=$_.sourceHwnd; listRid=$_.list.rid; listAid=$_.list.aid
          options=@($_.items | ForEach-Object { [string]$_.name })
          wantedCount=$_.wantedMatches.Count; currentCount=$_.currentMatches.Count
          duplicateNames=@($_.duplicateNames | ForEach-Object { [string]$_.Name })
        }
      })
    }
  }
  $selected = $complete[0]
  [pscustomobject]@{
    ok=$true; kind='bound'; sourceHwnd=$selected.sourceHwnd
    list=$selected.list; target=$selected.wantedMatches[0]; rollback=$selected.currentMatches[0]
    options=@($selected.items | ForEach-Object { [string]$_.name })
    binding=[pscustomobject]@{
      cellRid=$Cell.rid; cellAid=$Cell.aid; automationIdSection=$automationIdSection
      profileEvidence=$(if ($regionAidBound) { 'summary-region-scope-prefix' } else { 'cell-automation-id' })
      observedScopePrefix=[string]$TableBinding.observedScopePrefix
      listRid=$selected.list.rid; listAid=$selected.list.aid
      sourceHwnd=$selected.sourceHwnd; source=$(if ($selected.isMain) { 'main-tree' } else { 'new-same-process-popup' })
    }
  }
}

function Test-SSETableComboPopupBindingEquivalent {
  param([Parameter(Mandatory)]$Expected, [Parameter(Mandatory)]$Fresh)
  [bool]($Expected.ok -and $Fresh.ok -and
    [int64]$Expected.sourceHwnd -eq [int64]$Fresh.sourceHwnd -and
    [string]$Expected.list.rid -ceq [string]$Fresh.list.rid -and
    [string]$Expected.list.aid -ceq [string]$Fresh.list.aid -and
    [string]$Expected.target.rid -ceq [string]$Fresh.target.rid -and
    [string]$Expected.target.aid -ceq [string]$Fresh.target.aid -and
    [string]$Expected.rollback.rid -ceq [string]$Fresh.rollback.rid -and
    [string]$Expected.rollback.aid -ceq [string]$Fresh.rollback.aid)
}

function Test-SSETableComboBoundListPresent {
  param([Parameter(Mandatory)]$Sources, [Parameter(Mandatory)]$BoundPopup)
  foreach ($source in @($Sources)) {
    if ([int64]$source.hwnd -ne [int64]$BoundPopup.sourceHwnd) { continue }
    $matches = @($source.tree.nodes | Where-Object {
      $_.type -eq 'List' -and
      [string]$_.rid -ceq [string]$BoundPopup.list.rid -and
      [string]$_.aid -ceq [string]$BoundPopup.list.aid
    })
    if ($matches.Count -eq 1) { return $true }
  }
  $false
}
