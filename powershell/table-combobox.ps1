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

function Get-SSETableRowDefaultEvidence {
  param(
    [Parameter(Mandatory)]$Cells,
    $TableProfile = $null,
    $ExpectedArgs = $null
  )
  $rowCells = @($Cells | Sort-Object x)
  $expected=$(if ($null -ne $ExpectedArgs) { Get-SSETableComboExpectedBefore $ExpectedArgs 3 }
    else { [pscustomobject]@{ present=$false; value=$null } })
  $rowValues=@($rowCells | ForEach-Object { if ([string]$_.val) { [string]$_.val } else { [string]$_.name } })
  $categoryColumn=@($TableProfile.columns | Where-Object {
    [int]$_.index -eq 3 -and $_.header -ceq 'Kategorie' -and $_.controlType -ceq 'ComboBox' -and
    $_.writePolicy -ceq 'typed-selection-required'
  })
  $exactCellScope=[bool]($rowCells.Count -eq 6 -and $TableProfile.automationIdSection -ceq 'grpEmpf13b' -and
    @($rowCells | Where-Object {
      $_.type -cne 'DataItem' -or -not $_.rid -or
      -not (Test-SSETableComboCellAidProfileFragment ([string]$_.aid) 'grpEmpf13b')
    }).Count -eq 0 -and @($rowCells.rid | Select-Object -Unique).Count -eq 6)
  $checks=[ordered]@{
    profileBound=[bool]($TableProfile.known -and $TableProfile.bindingOk)
    categoryColumnBound=[bool]($categoryColumn.Count -eq 1)
    aidBound=[bool]($TableProfile.aidBound -or ($TableProfile.aidFallback -and $exactCellScope))
    sixCells=[bool]($rowCells.Count -eq 6)
    numberDateDescriptionEmpty=[bool]($rowCells.Count -eq 6 -and
      @(0,1,2 | Where-Object { $rowValues[$_] -cne '' }).Count -eq 0)
    rateDefault=[bool]($rowCells.Count -eq 6 -and $rowValues[4] -ceq '19')
    amountZero=[bool]($rowCells.Count -eq 6 -and $rowValues[5] -cin @('0','0,00','0.00'))
    expectedCategoryPresent=[bool]$expected.present
    categoryMatches=[bool]($rowCells.Count -eq 6 -and $expected.present -and [string]$expected.value -ceq $rowValues[3])
    categoryConfirmed=[bool]($expected.present -and
      [string]$expected.value -cin @($TableProfile.confirmedEmptyRowCategoryDefaults))
  }
  [pscustomobject]@{
    free=[bool](@($checks.Values | Where-Object { -not $_ }).Count -eq 0)
    checks=[pscustomobject]$checks; exactCellScope=$exactCellScope
    profileKnown=[bool]$TableProfile.known; profileAidBound=[bool]$TableProfile.aidBound
    profileAidFallback=[bool]$TableProfile.aidFallback
  }
}

function Test-SSETableRowFreeWithProfileDefaults {
  param([Parameter(Mandatory)]$Cells, $TableProfile = $null, $ExpectedArgs = $null)
  $rowCells = @($Cells | Sort-Object x)
  # Some repeated cost subpages use the same second summary as Material but
  # populate a category default. Accept only the profiled six-column empty
  # shape and an explicitly supplied, exact expected category, never an
  # arbitrary non-empty selector or a partially entered receipt.
  if ($ExpectedArgs -and (Get-SSETableRowDefaultEvidence $rowCells $TableProfile $ExpectedArgs).free) { return $true }
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

function Get-SSETableComboViewportEvidence {
  param([Parameter(Mandatory)]$Tree, [Parameter(Mandatory)]$Cell, [Parameter(Mandatory)]$Region)
  $matches = @($Tree.nodes | Where-Object { [string]$_.rid -ceq [string]$Cell.rid })
  $viewport = $null
  if ($Cell.rid -and $matches.Count -eq 1) {
    $parentIndex = [int]$matches[0].p
    $seen = New-Object 'System.Collections.Generic.HashSet[int]'
    for ($level=0; $level -lt 32 -and $parentIndex -ge 0 -and $seen.Add($parentIndex); $level++) {
      $parents = @($Tree.nodes | Where-Object { [int]$_.i -eq $parentIndex })
      if ($parents.Count -ne 1) { break }
      $parent = $parents[0]
      if ($parent.type -in @('Table','DataGrid') -and $parent.w -gt 0 -and $parent.h -gt 0) { $viewport=$parent; break }
      $parentIndex = [int]$parent.p
    }
  }
  $cellRectangle = [pscustomobject]@{ x=[int]$Cell.x; y=[int]$Cell.y; w=[int]$Cell.w; h=[int]$Cell.h }
  $viewportRectangle = $null; $fullyContained = $null; $centerInside = $null
  if ($viewport) {
    $viewportRectangle = [pscustomobject]@{ x=[int]$viewport.x; y=[int]$viewport.y; w=[int]$viewport.w; h=[int]$viewport.h }
    $fullyContained = [bool]($Cell.x -ge $viewport.x -and $Cell.y -ge $viewport.y -and
      ($Cell.x + $Cell.w) -le ($viewport.x + $viewport.w) -and ($Cell.y + $Cell.h) -le ($viewport.y + $viewport.h))
    $centerX = $Cell.x + $Cell.w / 2; $centerY = $Cell.y + $Cell.h / 2
    $centerInside = [bool]($centerX -ge $viewport.x -and $centerY -ge $viewport.y -and
      $centerX -lt ($viewport.x + $viewport.w) -and $centerY -lt ($viewport.y + $viewport.h))
  }
  [pscustomobject]@{
    known=[bool]$viewport; method=$(if ($viewport) { 'exact-cell-table-ancestor' } else { 'table-ancestor-not-proven' })
    cellRectangle=$cellRectangle; tableRectangle=$viewportRectangle
    cellFullyContained=$fullyContained; cellCenterInside=$centerInside
    tableRid=$(if ($viewport) { [string]$viewport.rid } else { $null })
    targetSumY=$Region.targetSumY; visibleRowCount=@($Region.cells | Group-Object y).Count
    scopePrefix=$Region.scopePrefix
  }
}

function Get-SSETableComboSourceDiagnostics {
  param([Parameter(Mandatory)][AllowEmptyCollection()][object[]]$Sources, $Cell = $null)
  @($Sources | ForEach-Object {
    $source = $_; $stats = $source.tree.stats
    $nodes = @($source.tree.nodes | Where-Object { $null -ne $_ })
    $complete = [bool]($source.tree -and $stats -and -not $source.captureError -and
      -not $stats.truncated -and -not $stats.depthLimited -and -not $stats.err -and -not $stats.cyc)
    [pscustomobject]@{
      sourceHwnd=[int64]$source.hwnd; isMain=[bool]$source.isMain; isNewPopup=[bool]$source.isNewPopup
      captureComplete=$complete; captureError=$source.captureError; statsPresent=[bool]$stats
      nodeCount=$nodes.Count; listCount=@($nodes | Where-Object { $_.type -eq 'List' }).Count
      listItemCount=@($nodes | Where-Object { $_.type -eq 'ListItem' }).Count
      truncated=[bool]$stats.truncated; depthLimited=[bool]$stats.depthLimited
      traversalErrors=[int]$stats.err; cycles=[int]$stats.cyc
      captureLimits=$source.captureLimits
      lists=@($nodes | Where-Object { $_.type -eq 'List' } | Select-Object -First 8 | ForEach-Object {
        $list = $_
        [pscustomobject]@{
          rid=[string]$list.rid; rectangle=[pscustomobject]@{ x=[int]$list.x; y=[int]$list.y; w=[int]$list.w; h=[int]$list.h }
          attachedToCell=$(if ($Cell) { Test-SSETableComboAttachedRectangle $Cell $list } else { $null })
          descendantItemCount=@($nodes | Where-Object {
            $_.type -eq 'ListItem' -and (Test-SSETableComboNodeDescendant $nodes ([int]$_.i) ([int]$list.i))
          }).Count
        }
      })
    }
  })
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
        viewport=$InitialState.viewportEvidence
      }
      fresh=[pscustomobject]@{
        heading=[string]$FreshState.heading; sumRid=[string]$FreshState.sumRead.selected.rid
        scopePrefix=$freshScope; rowY=[int]$FreshState.cell.y; columnIndex=$ColumnIndex
        cellRid=[string]$FreshState.cell.rid; cellAid=[string]$FreshState.cell.aid
        rectangle=[pscustomobject]@{ x=[int]$FreshState.cell.x; y=[int]$FreshState.cell.y; w=[int]$FreshState.cell.w; h=[int]$FreshState.cell.h }
        value=[string]$FreshState.value; rowCellCount=[int]$FreshState.rowCellCount; ridMatchCount=[int]$FreshState.ridMatchCount
        viewport=$FreshState.viewportEvidence
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

function Get-SSETableRowSnapshotValues($Cells) {
  @($Cells | Sort-Object x | ForEach-Object {
    if ([string]$_.val) { [string]$_.val } else { [string]$_.name }
  })
}

function Get-SSETableContentSignature($Region) {
  if (-not $Region.ok -or -not @($Region.cells).Count) { return $null }
  $rows = @($Region.cells | Group-Object y | Sort-Object { [int]$_.Name } | ForEach-Object {
    [pscustomobject]@{ values=@(Get-SSETableRowSnapshotValues $_.Group) }
  })
  ConvertTo-Json -InputObject $rows -Depth 4 -Compress
}

function Get-SSETableSnapshotInputState {
  param($Tree, [string]$TableAid, [string]$TableRid)
  $reject=[pscustomobject]@{ok=$false; editorFree=$false; editorCount=0; table=$null; reason='table-snapshot-unbound'}
  $stats=$Tree.stats
  if (-not $stats -or $stats.truncated -or $stats.depthLimited -or $stats.err -or $stats.cyc -or $stats.valErr -or
      -not $TableAid -or -not $TableRid) { return $reject }
  $roots=@($Tree.nodes | Where-Object { $_.rid -ceq $TableRid -and $_.aid -ceq $TableAid -and $_.type -cin @('Table','DataGrid') })
  if ($roots.Count -ne 1 -or @($Tree.nodes.i | Select-Object -Unique).Count -ne @($Tree.nodes).Count) { return $reject }
  $byIndex=@{}; foreach ($node in @($Tree.nodes)) { $byIndex[[int]$node.i]=$node }
  $editors=New-Object System.Collections.ArrayList
  foreach ($node in @($Tree.nodes | Where-Object { $_.on -and $_.w -gt 0 -and $_.h -gt 0 -and $_.type -cin @('ComboBox','Edit','Spinner','List','ListItem','Custom') })) {
    $probe=$node; $seen=New-Object 'System.Collections.Generic.HashSet[int]'
    for ($level=0; $level -lt 64 -and $probe; $level++) {
      if (-not $seen.Add([int]$probe.i)) { return $reject }
      if ([int]$probe.i -eq [int]$roots[0].i) { $null=$editors.Add($node); break }
      if ([int]$probe.p -lt 0) { break }
      if (-not $byIndex.ContainsKey([int]$probe.p)) { return $reject }
      $probe=$byIndex[[int]$probe.p]
    }
  }
  [pscustomobject]@{ok=$true; editorFree=[bool]($editors.Count -eq 0); editorCount=$editors.Count; editorNodes=@($editors); table=$roots[0];
    reason=$(if ($editors.Count) {'active-table-editor'} else {'complete-bound-table-without-editor'})}
}

function Resolve-SSETableFooterFocusNode {
  param($Tree,[string]$TableAid,$Policy)
  $stats=$Tree.stats
  $suffix='.RedThreadContent.ClientFrameSSE.ClientFooterSSE.HoverButton'
  if (-not $stats -or $stats.truncated -or $stats.depthLimited -or $stats.err -or $stats.cyc -or $stats.valErr -or
      $Policy.id -cne 'main_footer_next_focus' -or $Policy.controlType -cne 'Button' -or $Policy.name -cne 'Weiter' -or
      $Policy.automationIdSuffix -cne $suffix -or $Policy.action -cne 'SetFocus' -or
      $Policy.policy -cne 'own-typed-table-editor-only') { return $null }
  $matches=@($Tree.nodes | Where-Object {
    $_.type -ceq 'Button' -and $_.name -ceq 'Weiter' -and $_.on -and $_.w -gt 0 -and $_.h -gt 0 -and $_.rid -and
    ([string]$_.aid).EndsWith($suffix,[StringComparison]::Ordinal)
  })
  if ($matches.Count -ne 1) { return $null }
  $button=$matches[0]
  $root=([string]$button.aid).Substring(0,([string]$button.aid).Length-'.ClientFooterSSE.HoverButton'.Length)
  if (-not $TableAid.StartsWith($root+'.',[StringComparison]::Ordinal)) { return $null }
  $button
}

function Test-SSETableFooterFocusSource {
  param($Tree,[string]$FocusedRid,[string]$FocusedAid,[string]$TableAid,[string]$TableRid,$OwnedCell)
  $state=Get-SSETableSnapshotInputState $Tree $TableAid $TableRid
  $focused=@($Tree.nodes | Where-Object {$_.rid -ceq $FocusedRid -and $_.aid -ceq $FocusedAid -and $_.on -and $_.w -gt 0 -and $_.h -gt 0})
  if (-not $state.ok -or $focused.Count -ne 1) {return $false}
  if ($state.editorFree) {
    # Only positively typed passive controls may lose focus. An arbitrary
    # Custom/Edit widget outside the table is never a commit authority.
    return [bool]($focused[0].type -cin @('Table','DataGrid','DataItem','Button','Tree','TreeItem'))
  }
  if (-not $OwnedCell -or $OwnedCell.type -cne 'DataItem' -or $OwnedCell.aid -cne $TableAid) {return $false}
  foreach ($editor in @($state.editorNodes)) {
    if ($editor.type -cnotin @('ComboBox','Edit') -or
        -not ([string]$editor.aid).StartsWith($TableAid+'.',[StringComparison]::Ordinal) -or
        $editor.x -lt $OwnedCell.x-2 -or $editor.y -lt $OwnedCell.y-2 -or
        $editor.x+$editor.w -gt $OwnedCell.x+$OwnedCell.w+2 -or
        $editor.y+$editor.h -gt $OwnedCell.y+$OwnedCell.h+2) {return $false}
  }
  if ($focused[0].type -cin @('ComboBox','Edit')) {
    return [bool](@($state.editorNodes | Where-Object {$_.rid -ceq $FocusedRid -and $_.aid -ceq $FocusedAid}).Count -eq 1)
  }
  [bool]($focused[0].type -cin @('Table','DataGrid','DataItem') -and
    ($FocusedAid -ceq $TableAid))
}

function Resolve-SSETablePositionNameFocusSource {
  param($Tree,[string]$TableAid,[string]$TableRid,[string]$FocusedRid,[string]$FocusedAid,$Policy,[string]$Heading)
  $tableSuffix='.RedThreadContent.ClientFrameSSE.DialogWidget.DialogScrollArea.qt_scrollarea_viewport.DialogUI././.Tabelle./.Tabelle.Tab'
  $sourceSuffix='.RedThreadContent.ClientFrameSSE.DialogWidget.DialogScrollArea.qt_scrollarea_viewport.DialogUI././.AngabenZumUmsatz./.AngabenZumUmsatz.Bezeichnung./.AngabenZumUmsatz.Bezeichnung.Text'
  if (-not $Policy -or $Policy.id -cne 'income_position_name' -or $Policy.controlType -cne 'Edit' -or
      $Policy.automationIdSuffix -cne $sourceSuffix -or $Policy.tableAutomationIdSuffix -cne $tableSuffix -or
      $Policy.headingPrefix -cne 'Einnahmen: ' -or $Policy.policy -cne 'unchanged-position-name-only' -or
      -not $TableAid.EndsWith($tableSuffix,[StringComparison]::Ordinal) -or
      -not $Heading.StartsWith('Einnahmen: ',[StringComparison]::Ordinal)) {return $null}
  $name=$Heading.Substring('Einnahmen: '.Length)
  if ($name.Length -lt 1 -or $name.Length -gt 80 -or $name -cne $name.Trim() -or $name -match '[\r\n\t]') {return $null}
  $state=Get-SSETableSnapshotInputState $Tree $TableAid $TableRid
  $headers=@($Tree.nodes | Where-Object {$_.p -eq $state.table.i -and $_.type -ceq 'Header' -and [string]$_.name -and $_.on -and $_.w -gt 0 -and $_.h -gt 0} | Sort-Object x)
  $expectedHeaders=@('Nr.','Datum','Bezeichnung','Betrag','N','Netto')
  if (-not $state.ok -or -not $state.editorFree -or
      (@($headers.name) | ConvertTo-Json -Compress) -cne ($expectedHeaders | ConvertTo-Json -Compress) -or
      (@($Policy.headers) | ConvertTo-Json -Compress) -cne ($expectedHeaders | ConvertTo-Json -Compress)) {return $null}
  $prefix=$TableAid.Substring(0,$TableAid.Length-$tableSuffix.Length)
  if (-not $prefix -or $FocusedAid -cne ($prefix+$sourceSuffix)) {return $null}
  $sources=@($Tree.nodes | Where-Object {$_.rid -ceq $FocusedRid -and $_.aid -ceq $FocusedAid -and
    $_.type -ceq 'Edit' -and $_.on -and $_.w -gt 0 -and $_.h -gt 0 -and $_.ro -is [bool] -and -not $_.ro -and
    [string]$_.val -ceq $name})
  if ($sources.Count -ne 1 -or @($Tree.nodes | Where-Object {$_.aid -ceq $FocusedAid}).Count -ne 1) {return $null}
  [pscustomobject]@{node=$sources[0];expectedValue=$name}
}

function Get-SSETableRowRoot {
  param($Tree, $Cells)
  if (@($Cells).Count -ne 6) { return $null }
  $roots=New-Object System.Collections.ArrayList
  foreach ($cell in @($Cells)) {
    $matches=@($Tree.nodes | Where-Object { $_.rid -ceq $cell.rid -and $_.aid -ceq $cell.aid -and $_.type -ceq 'DataItem' })
    if ($matches.Count -ne 1) { return $null }
    $probe=$matches[0]; $found=$null
    for ($level=0; $level -lt 16 -and $probe; $level++) {
      if ($probe.type -cin @('Table','DataGrid')) { $found=$probe; break }
      $parents=@($Tree.nodes | Where-Object { [int]$_.i -eq [int]$probe.p })
      if ($parents.Count -ne 1) { return $null }
      $probe=$parents[0]
    }
    if (-not $found -or -not $found.rid -or -not $found.aid) { return $null }
    $null=$roots.Add($found)
  }
  if (@($roots.rid | Select-Object -Unique).Count -ne 1 -or @($roots.aid | Select-Object -Unique).Count -ne 1) { return $null }
  $roots[0]
}

function Resolve-SSETableComboEditorAuthority {
  param($State,$Row,$TableProfile,$Popup,[string]$Wanted,[int]$ColumnIndex,$ModelCell)
  $reject=[pscustomobject]@{ok=$false;reason='typed-editor-authority-unbound'}
  $cells=@($Row | Sort-Object x)
  $root=Get-SSETableRowRoot $State.tree $cells
  $column=@($TableProfile.columns | Where-Object {$_.index -eq 3 -and $_.header -ceq 'Kategorie' -and
    $_.controlType -ceq 'ComboBox' -and $_.writePolicy -ceq 'typed-selection-required'})
  if ($ColumnIndex -ne 3 -or $column.Count -ne 1 -or -not $root -or
      -not (Test-SSETableComboRowProfileBinding $cells $TableProfile ([string]$State.region.scopePrefix)) -or
      -not $Popup.ok -or $Popup.kind -cne 'bound' -or $Popup.list.type -cne 'List' -or
      $Popup.binding.automationIdSection -cne 'grpEmpf13b' -or $Popup.binding.cellAid -cne $root.aid -or
      -not $Popup.binding.cellRid -or $Popup.binding.listAid -cne $Popup.list.aid -or
      $Popup.binding.listRid -cne $Popup.list.rid -or $Popup.target.type -cne 'ListItem' -or
      [string]$Popup.target.name -cne $Wanted -or -not $Popup.target.rid -or
      [string](Get-SSETableRowSnapshotValues $cells)[$ColumnIndex] -cne $Wanted) {return $reject}
  # The delegate identity comes from the list actually bound for this selection,
  # never from an arbitrary focused control or a guessed row number.
  if (-not ([string]$Popup.list.aid).StartsWith([string]$root.aid+'.',[StringComparison]::Ordinal)) {return $reject}
  $pattern='\.\(([1-9][0-9]{0,3})\)\.Kategorie13b\.QComboBoxListView$'
  $match=[regex]::Match([string]$Popup.list.aid,$pattern)
  if (-not $match.Success) {$reject.reason='typed-editor-popup-field-unbound';return $reject}
  $rowIndex=[int]$match.Groups[1].Value-1
  if ($rowIndex -ge 1000 -or -not $ModelCell.ok -or $ModelCell.tableAid -cne $root.aid -or
      $ModelCell.tableRid -cne $root.rid -or $ModelCell.row -isnot [int] -or $ModelCell.row -ne $rowIndex -or
      $ModelCell.column -isnot [int] -or $ModelCell.column -lt 3 -or $ModelCell.column -ge 100 -or
      $ModelCell.cellAid -cne $Popup.binding.cellAid -or $ModelCell.cellRid -cne $Popup.binding.cellRid) {
    $reject.reason='typed-editor-initial-model-cell-unbound';return $reject
  }
  [pscustomobject]@{ok=$true;reason='own-bound-category-popup-and-full-row';tableAid=$root.aid;tableRid=$root.rid;
    editorAid=([string]$Popup.list.aid).Substring(0,([string]$Popup.list.aid).Length-'.QComboBoxListView'.Length);
    modelRow=$rowIndex;modelColumn=$ModelCell.column;columnIndex=3;wanted=$Wanted;cell=$cells[3];row=$cells;
    rowValues=@(Get-SSETableRowSnapshotValues $cells);tableProfile=$TableProfile;scopePrefix=[string]$State.region.scopePrefix}
}

function Test-SSETableComboRowProfileBinding {
  param($Cells, $TableProfile, [AllowEmptyString()][string]$ScopePrefix)
  $row=@($Cells | Sort-Object x)
  if (-not $TableProfile.known -or -not $TableProfile.bindingOk -or
      $TableProfile.automationIdSection -cne 'grpEmpf13b' -or $row.Count -ne 6 -or
      @($row.rid | Select-Object -Unique).Count -ne 6 -or
      @($row | Where-Object {
        $_.type -cne 'DataItem' -or -not $_.rid -or $_.w -le 0 -or $_.h -le 0 -or
        [Math]::Abs([int]$_.y - [int]$row[0].y) -gt 4 -or
        -not (Test-SSETableComboCellAidProfileFragment ([string]$_.aid) 'grpEmpf13b')
      }).Count) { return $false }
  if ($ScopePrefix) {
    return [bool]($TableProfile.aidBound -and
      $ScopePrefix -ceq [string]$TableProfile.observedScopePrefix -and
      $ScopePrefix.EndsWith('/.grpEmpf13b./.grpEmpf13b.',[StringComparison]::Ordinal) -and
      @($row | Where-Object { -not ([string]$_.aid).StartsWith($ScopePrefix,[StringComparison]::Ordinal) }).Count -eq 0)
  }
  [bool]($TableProfile.aidFallback -and -not [string]$TableProfile.observedScopePrefix)
}

function Resolve-SSETableComboNoopRow {
  param($State, $TableProfile, [string]$Wanted, [int]$ColumnIndex)
  $reject=[pscustomobject]@{ ok=$false; row=@(); reason='noop-full-row-unbound' }
  $stats=$State.tree.stats
  $row=@($State.rowCells | Sort-Object x)
  $column=@($TableProfile.columns | Where-Object {
    [int]$_.index -eq 3 -and $_.header -ceq 'Kategorie' -and $_.controlType -ceq 'ComboBox' -and
    $_.writePolicy -ceq 'typed-selection-required'
  })
  if (-not $State.ok -or -not $State.region.ok -or -not $stats -or
      $stats.truncated -or $stats.depthLimited -or $stats.err -or $stats.cyc -or $stats.valErr -or
      $ColumnIndex -ne 3 -or $column.Count -ne 1 -or
      -not (Test-SSETableComboRowProfileBinding $row $TableProfile ([string]$State.region.scopePrefix)) -or
      $row[$ColumnIndex].rid -cne $State.cell.rid -or $row[$ColumnIndex].aid -cne $State.cell.aid -or
      [string](Get-SSETableRowSnapshotValues $row)[$ColumnIndex] -cne $Wanted) { return $reject }
  [pscustomobject]@{ ok=$true; row=$row; rowY=[int]$row[0].y; reason='exact-profiled-full-row-already-target' }
}

function Resolve-SSETableUpdateFocusRow {
  param($InitialTarget, $InitialCells, $FreshRegion)
  $before=@($InitialCells | Sort-Object x)
  $reject=[pscustomobject]@{ ok=$false; row=@(); target=$null; matchCount=0; reason='initial-full-row-unbound' }
  if (-not $FreshRegion.ok -or -not $before.Count -or
      @($before.rid | Select-Object -Unique).Count -ne $before.Count -or
      @($before | Where-Object { -not $_.rid -or -not $_.aid -or $_.type -cne 'DataItem' -or $_.w -le 0 -or $_.h -le 0 }).Count) { return $reject }
  $targetColumns=@(for ($i=0; $i -lt $before.Count; $i++) {
    if ($before[$i].rid -ceq $InitialTarget.rid -and $before[$i].aid -ceq $InitialTarget.aid) { $i }
  })
  if ($targetColumns.Count -ne 1) { return $reject }
  $beforeValues=@(Get-SSETableRowSnapshotValues $before)
  $matches=New-Object System.Collections.ArrayList
  foreach ($group in @($FreshRegion.cells | Group-Object y)) {
    $row=@($group.Group | Sort-Object x)
    if ($row.Count -ne $before.Count -or @($row.rid | Select-Object -Unique).Count -ne $row.Count) { continue }
    $afterValues=@(Get-SSETableRowSnapshotValues $row)
    $same=$true
    for ($i=0; $i -lt $before.Count; $i++) {
      if (-not $row[$i].rid -or $row[$i].w -le 0 -or $row[$i].h -le 0 -or
          $row[$i].type -cne $before[$i].type -or $row[$i].aid -cne $before[$i].aid -or
          $afterValues[$i] -cne $beforeValues[$i]) { $same=$false; break }
    }
    if ($same) { $null=$matches.Add([pscustomobject]@{row=$row;target=$row[$targetColumns[0]]}) }
  }
  [pscustomobject]@{
    ok=[bool]($matches.Count -eq 1); matchCount=$matches.Count
    row=$(if ($matches.Count -eq 1) {@($matches[0].row)} else {@()})
    target=$(if ($matches.Count -eq 1) {$matches[0].target} else {$null})
    reason=$(if ($matches.Count -eq 1) {'exact-full-row-values-types-and-cell-aids'} else {'full-row-absent-or-ambiguous'})
  }
}

function Resolve-SSETableComboSelectedRow {
  param($InitialState, $FreshState, $TableProfile, [string]$ExpectedCurrent, [string]$Wanted, [int]$ColumnIndex)
  $reject = [pscustomobject]@{ ok=$false; matchCount=0; row=@(); reason='full-row-profile-or-region-unbound' }
  $stats = $FreshState.tree.stats
  if (-not $InitialState.ok -or -not $FreshState.region.ok -or -not $stats -or
      $stats.truncated -or $stats.depthLimited -or $stats.err -or $stats.cyc -or
      -not $TableProfile.known -or -not $TableProfile.bindingOk -or
      $TableProfile.automationIdSection -cne 'grpEmpf13b' -or $ColumnIndex -ne 3 -or
      $InitialState.heading -cne $FreshState.heading -or -not $InitialState.sumRead.selected.aid -or
      $InitialState.sumRead.selected.aid -cne $FreshState.sumRead.selected.aid -or
      $InitialState.sumRead.value -cne $FreshState.sumRead.value -or
      $InitialState.region.scopePrefix -cne $FreshState.region.scopePrefix -or
      -not (Test-SSETableComboRowProfileBinding $InitialState.rowCells $TableProfile ([string]$InitialState.region.scopePrefix))) { return $reject }
  $columns = @($TableProfile.columns | Where-Object {
    $_.index -eq 3 -and $_.header -ceq 'Kategorie' -and $_.writePolicy -ceq 'typed-selection-required'
  })
  $before = @(Get-SSETableRowSnapshotValues $InitialState.rowCells)
  if ($columns.Count -ne 1 -or $before.Count -ne 6 -or $before[3] -cne $ExpectedCurrent) { return $reject }
  $emptyArgs = [pscustomobject]@{ comboExpectedBefore=@{ '3'=$ExpectedCurrent } }
  $mayAssignNumber = [bool]($before[0] -ceq '' -and $before[1] -ceq '' -and $before[2] -ceq '' -and
    $before[4] -ceq '19' -and $before[5] -cin @('0','0,00','0.00') -and
    (Test-SSETableRowFreeWithProfileDefaults $InitialState.rowCells $TableProfile $emptyArgs))
  $rowMatches = New-Object System.Collections.ArrayList
  $oldNumbers=@($InitialState.region.cells | Group-Object y | ForEach-Object {
    $oldRow=@($_.Group | Sort-Object x)
    if ($oldRow.Count -eq 6) { [string](Get-SSETableRowSnapshotValues $oldRow)[0] }
  })
  $freshNumbers=@($FreshState.region.cells | Group-Object y | ForEach-Object {
    $freshRow=@($_.Group | Sort-Object x)
    if ($freshRow.Count -eq 6) { [string](Get-SSETableRowSnapshotValues $freshRow)[0] }
  })
  foreach ($group in @($FreshState.region.cells | Group-Object y)) {
    $row = @($group.Group | Sort-Object x)
    if (-not (Test-SSETableComboRowProfileBinding $row $TableProfile ([string]$FreshState.region.scopePrefix))) { continue }
    $after = @(Get-SSETableRowSnapshotValues $row)
    if ($after[3] -cne $Wanted) { continue }
    $same = $true
    foreach ($column in @(0,1,2,4,5)) {
      if ($column -eq 0 -and $mayAssignNumber -and $after[0] -cne $before[0]) {
        if ($after[0] -match '^[1-9][0-9]*$' -and $after[0] -cnotin $oldNumbers -and
            @($freshNumbers | Where-Object { $_ -ceq $after[0] }).Count -eq 1) { continue }
        $same=$false; break
      }
      if ($after[$column] -cne $before[$column]) { $same=$false; break }
    }
    if ($same) { $null=$rowMatches.Add([pscustomobject]@{ row=$row; rowY=[int]$group.Name; assignedNumber=($after[0] -cne $before[0]) }) }
  }
  [pscustomobject]@{
    ok=[bool]($rowMatches.Count -eq 1); matchCount=$rowMatches.Count
    row=$(if ($rowMatches.Count -eq 1) { @($rowMatches[0].row) } else { @() })
    rowY=$(if ($rowMatches.Count -eq 1) { $rowMatches[0].rowY } else { $null })
    assignedNumber=$(if ($rowMatches.Count -eq 1) { [bool]$rowMatches[0].assignedNumber } else { $false })
    reason=$(if ($rowMatches.Count -eq 1) { 'exact-profiled-full-row-after-selection' } else { 'full-row-absent-or-ambiguous' })
  }
}

function Get-SSETableComboInterferenceEvidence {
  param(
    [bool]$GuardUserInput, $InputBaseline, $InputObserved, $InteractionBefore, $InteractionAfter,
    [bool]$PopupClosed, $StateAfter, [int]$RowY, [int]$ColumnIndex
  )
  $readable = [bool]($null -ne $InputBaseline -and $null -ne $InputObserved)
  $inputUnchanged = [bool]($readable -and [uint64]$InputBaseline -eq [uint64]$InputObserved)
  $inputGuardChanged = [bool]($GuardUserInput -and -not $inputUnchanged)
  $windowChanged = [bool]($InteractionAfter.fingerprint -ne $InteractionBefore.fingerprint)
  $cellReadbackInvalid = [bool](-not $StateAfter.ok -and $StateAfter.interference)
  $popupClosureUnproved = [bool](-not $PopupClosed)
  $reasons = @(
    if ($inputGuardChanged) { 'input-epoch-changed-or-unreadable' }
    if ($windowChanged) { 'interaction-window-set-changed' }
    if ($popupClosureUnproved) { 'popup-closure-not-proven' }
    if ($cellReadbackInvalid) { 'cell-readback-binding-not-proven' }
  )
  [pscustomobject]@{
    interference=[bool]($inputGuardChanged -or $windowChanged -or $popupClosureUnproved -or $cellReadbackInvalid)
    reasons=$reasons; inputGuardChanged=$inputGuardChanged; windowChanged=$windowChanged
    popupClosureUnproved=$popupClosureUnproved; cellReadbackInvalid=$cellReadbackInvalid
    inputEpoch=[pscustomobject]@{
      source='GetLastInputInfo'; baseline=$InputBaseline; observed=$InputObserved; readable=$readable
      unchanged=$inputUnchanged; changed=[bool]($readable -and -not $inputUnchanged); attribution='undetermined'
      lastOwnAction='typed-table-option-selection'
    }
    windowGuard=[pscustomobject]@{ before=$InteractionBefore.fingerprint; after=$InteractionAfter.fingerprint }
    cellGuard=[pscustomobject]@{
      readOk=[bool]$StateAfter.ok; error=[string]$StateAfter.error; heading=[string]$StateAfter.heading
      expectedRowY=$RowY; columnIndex=$ColumnIndex; rowCellCount=$StateAfter.rowCellCount
      cellRid=[string]$StateAfter.cell.rid; cellAid=[string]$StateAfter.cell.aid
    }
  }
}

function Get-SSETableComboDiagnosticProjection {
  param([Parameter(Mandatory)]$ComboResult)
  $nodes = 0
  $kind = [string]$ComboResult.kind
  if (-not $kind -and $ComboResult.popupBinding) { $kind = [string]$ComboResult.popupBinding.kind }
  if (-not $kind) { $kind = $(if ($ComboResult.ok) { 'ok' } else { 'typed-table-combo-failed' }) }
  $editorClosed = $null
  if ($null -ne $ComboResult.editorClosed) { $editorClosed = [bool]$ComboResult.editorClosed }
  [pscustomobject]@{
    error=ConvertTo-SSETableComboBoundedDiagnosticValue ([string]$ComboResult.error) ([ref]$nodes)
    kind=ConvertTo-SSETableComboBoundedDiagnosticValue $kind ([ref]$nodes)
    mutationStarted=[bool]$ComboResult.mutationStarted
    interference=[bool]$ComboResult.interference
    editorClosed=$editorClosed
    interferenceEvidence=ConvertTo-SSETableComboBoundedDiagnosticValue $ComboResult.interferenceEvidence ([ref]$nodes)
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

  $sourceDiagnostics = @(Get-SSETableComboSourceDiagnostics @($Sources) $Cell)
  if (-not $sourceDiagnostics.Count -or @($sourceDiagnostics | Where-Object { -not $_.captureComplete }).Count) {
    return [pscustomobject]@{
      ok=$false; kind='popup-snapshot-incomplete'
      error='Optionsquellen sind unvollstaendig oder nicht lesbar; keine Auswahl und kein weiterer Oeffnungsklick.'
      candidates=@(); sourceDiagnostics=$sourceDiagnostics
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
      sourceDiagnostics=$sourceDiagnostics
    }
  }
  $selected = $complete[0]
  [pscustomobject]@{
    ok=$true; kind='bound'; sourceHwnd=$selected.sourceHwnd
    list=$selected.list; target=$selected.wantedMatches[0]; rollback=$selected.currentMatches[0]
    options=@($selected.items | ForEach-Object { [string]$_.name })
    sourceDiagnostics=$sourceDiagnostics
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
