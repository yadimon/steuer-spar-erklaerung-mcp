# Read-only enumeration of the coordinates exposed by one exactly bound UIA
# Grid. Two equal scans establish observed stability, never an atomic snapshot.
# This module performs no focus, selection, scrolling or value-setting actions.

function ConvertTo-SSEGridRect($Rect) {
  $result=[ordered]@{empty=[bool]$Rect.IsEmpty}
  foreach($property in @('X','Y','Width','Height')) {
    $value=[double]$Rect.$property
    $result[$property.ToLowerInvariant()]=$(if([double]::IsNaN($value) -or [double]::IsInfinity($value)){$null}else{$value})
  }
  [pscustomobject]$result
}

function Read-SSEGridTableScan {
  param($Table,[int]$ProcessId,[string]$TableRid,[string]$TableAid,[int]$MaxRows,
    [scriptblock]$Guard,[Diagnostics.Stopwatch]$Watch,[int]$BudgetMs=20000)
  if(-not $Table -or $ProcessId -le 0 -or -not $TableRid -or -not $TableAid -or $MaxRows -lt 1 -or $MaxRows -gt 1000 -or
      -not $Guard -or -not $Watch) {throw 'Grid read requires an exact bounded table binding.'}
  $check={
    if($Watch.ElapsedMilliseconds -ge $BudgetMs) {throw 'Read-only Grid enumeration exceeded its budget.'}
    if(-not (& $Guard)) {throw 'Read-only Grid window or input binding changed.'}
  }
  & $check
  $current=$Table.Current
  if([int]$current.ProcessId -ne $ProcessId -or ($Table.GetRuntimeId() -join '.') -cne $TableRid -or
      [string]$current.AutomationId -cne $TableAid -or -not $current.IsEnabled) {throw 'Exact Grid identity changed.'}
  $gridObject=$null;$tableObject=$null
  if(-not $Table.TryGetCurrentPattern([Windows.Automation.GridPattern]::Pattern,[ref]$gridObject) -or
      -not $Table.TryGetCurrentPattern([Windows.Automation.TablePattern]::Pattern,[ref]$tableObject)) {
    throw 'Exact table does not expose both Grid and Table header patterns.'
  }
  $grid=[Windows.Automation.GridPattern]$gridObject
  $rows=[int]$grid.Current.RowCount;$columns=[int]$grid.Current.ColumnCount
  if($rows -lt 0 -or $rows -gt 10000 -or $columns -lt 1 -or $columns -gt 100) {throw 'Grid dimensions exceed the read contract.'}
  $readRows=[Math]::Min($rows,$MaxRows)
  if($readRows*$columns -gt 100000) {throw 'Grid enumeration exceeds the cell bound.'}
  # Qt's TablePattern.GetColumnHeaders allocates new accessible headers on
  # each call. Its raw direct children use the table's cached child objects,
  # including the headers of a model with no rows. Never call that allocating
  # provider here or replace its ephemeral IDs with weaker comparisons.
  $walker=[Windows.Automation.TreeWalker]::RawViewWalker
  $header=$walker.GetFirstChild($Table);$headerSteps=0
  $headerData=New-Object System.Collections.ArrayList
  $headerIds=New-Object 'Collections.Generic.HashSet[string]'
  $null=$headerIds.Add($TableRid)
  for($column=0;$column -lt $columns;) {
    & $check
    if(-not $header -or ++$headerSteps -gt $columns+2) {throw 'Cached Grid header walk is missing columns or exceeds its bound.'}
    $hc=$header.Current;$rid=$header.GetRuntimeId() -join '.'
    if([int]$hc.ProcessId -ne $ProcessId -or -not $rid -or -not $headerIds.Add($rid)) {throw 'Grid header identity is missing, foreign or repeated.'}
    $parent=$walker.GetParent($header)
    if(-not $parent -or [int]$parent.Current.ProcessId -ne $ProcessId -or
        $parent.Current.ControlType -notin @([Windows.Automation.ControlType]::Table,[Windows.Automation.ControlType]::DataGrid) -or
        ($parent.GetRuntimeId() -join '.') -cne $TableRid -or [string]$parent.Current.AutomationId -cne $TableAid) {
      throw 'Cached Grid header is not a direct child of the exact table.'
    }
    if($headerSteps -eq 1 -and $column -eq 0 -and $hc.ControlType -eq [Windows.Automation.ControlType]::Pane -and
        -not [string]$hc.Name -and $hc.BoundingRectangle.IsEmpty) {
      $header=$walker.GetNextSibling($header);continue
    }
    if($hc.ControlType -notin @([Windows.Automation.ControlType]::Header,[Windows.Automation.ControlType]::HeaderItem)) {
      throw 'Cached Grid column header type is unknown or out of order.'
    }
    $rect=ConvertTo-SSEGridRect $hc.BoundingRectangle
    $visible=[bool](-not $rect.empty -and $null -ne $rect.width -and $rect.width -gt 0 -and $null -ne $rect.height -and $rect.height -gt 0)
    # A hidden raw column has an empty rectangle. IsOffscreen alone does not
    # distinguish hidden columns from virtualized offscreen model cells.
    $null=$headerData.Add([pscustomobject]@{column=$column;name=[string]$hc.Name;rid=$rid;visible=$visible;rect=$rect})
    $column++
    if($column -lt $columns) {$header=$walker.GetNextSibling($header)}
  }
  if(-not @($headerData | Where-Object {$_.visible}).Count) {throw 'No displayed Grid header columns were proven.'}
  $cells=New-Object System.Collections.ArrayList
  $cellIds=New-Object 'Collections.Generic.HashSet[string]'
  foreach($identity in $headerIds) {$null=$cellIds.Add($identity)}
  for($row=0;$row -lt $readRows;$row++) {
    & $check
    for($column=0;$column -lt $columns;$column++) {
      if($Watch.ElapsedMilliseconds -ge $BudgetMs) {throw 'Read-only Grid enumeration exceeded its budget.'}
      $cell=$grid.GetItem($row,$column)
      if(-not $cell) {throw 'Grid coordinate has no element.'}
      $cc=$cell.Current;$rid=$cell.GetRuntimeId() -join '.'
      if([int]$cc.ProcessId -ne $ProcessId -or -not $rid -or $rid -ceq $TableRid -or -not $cellIds.Add($rid)) {throw 'Grid coordinate identity is missing, foreign or aliased.'}
      $itemObject=$null
      if(-not $cell.TryGetCurrentPattern([Windows.Automation.GridItemPattern]::Pattern,[ref]$itemObject)) {throw 'Grid coordinate has no independent GridItem proof.'}
      $item=$itemObject.Current;$container=$item.ContainingGrid
      if($item.Row -ne $row -or $item.Column -ne $column -or $item.RowSpan -ne 1 -or $item.ColumnSpan -ne 1 -or
          -not $container -or [int]$container.Current.ProcessId -ne $ProcessId -or
          ($container.GetRuntimeId() -join '.') -cne $TableRid -or [string]$container.Current.AutomationId -cne $TableAid) {
        throw 'Grid coordinate, span or containing-table binding changed.'
      }
      $toggle=$null;$semantic=$null
      if($cell.TryGetCurrentPattern([Windows.Automation.TogglePattern]::Pattern,[ref]$toggle)) {
        $state=[string]$toggle.Current.ToggleState
        if($state -cnotin @('Off','On','Indeterminate')) {throw 'Grid checkbox state is unknown.'}
        $semantic=[pscustomobject]@{ok=$true;type='boolean';value=$(if($state -ceq 'On'){$true}elseif($state -ceq 'Off'){$false}else{$null});checkboxState=$state}
      } else {
        $semantic=[pscustomobject]@{ok=$true;type='text';value=[string]$cc.Name;checkboxState=$null}
      }
      $null=$cells.Add([pscustomobject]@{row=$row;column=$column;rid=$rid;name=[string]$cc.Name;semantic=$semantic})
    }
  }
  & $check
  if([int]$grid.Current.RowCount -ne $rows -or [int]$grid.Current.ColumnCount -ne $columns -or
      -not $Table.Current.IsEnabled -or [int]$Table.Current.ProcessId -ne $ProcessId -or ($Table.GetRuntimeId() -join '.') -cne $TableRid -or
      [string]$Table.Current.AutomationId -cne $TableAid) {throw 'Grid dimensions or identity changed during enumeration.'}
  [pscustomobject]@{rows=$rows;readRows=$readRows;columns=$columns;headers=@($headerData);cells=@($cells)}
}

function ConvertTo-SSEGridTableProjection {
  param($First,$Second,[int]$MaxRows)
  $rejectObservation={param([string]$Category,[string]$Collection='scan',[int]$Index=-1)
    $failure=New-Object InvalidOperationException ('Consecutive Grid observations differ or have incomplete dimensions: '+$Category+'.')
    $failure.Data['SSEGridDifference']=[pscustomobject]@{category=$Category;collection=$Collection;index=$Index}
    throw $failure
  }
  if(-not $First -or -not $Second -or $MaxRows -lt 1 -or $MaxRows -gt 1000) {
    & $rejectObservation 'arguments'
  }
  if(
      ($First.rows -isnot [int] -and $First.rows -isnot [long]) -or
      ($First.columns -isnot [int] -and $First.columns -isnot [long]) -or
      ($First.readRows -isnot [int] -and $First.readRows -isnot [long])) {& $rejectObservation 'dimension-type'}
  if($First.rows -lt 0 -or $First.rows -gt 10000 -or $First.columns -lt 1 -or $First.columns -gt 100) {
    & $rejectObservation 'dimension-range'
  }
  foreach($name in @('rows','columns','readRows')) {
    if($First.$name -ne $Second.$name) {& $rejectObservation ('dimension-'+$name)}
  }
  if($First.readRows -ne [Math]::Min([int]$First.rows,$MaxRows)) {& $rejectObservation 'read-row-limit'}
  if($First.headers.Count -ne $First.columns -or $Second.headers.Count -ne $Second.columns) {& $rejectObservation 'header-count'}
  if($First.cells.Count -ne $First.readRows*$First.columns -or $Second.cells.Count -ne $Second.readRows*$Second.columns) {
    & $rejectObservation 'cell-count'
  }
  if(($First | ConvertTo-Json -Depth 12 -Compress) -cne ($Second | ConvertTo-Json -Depth 12 -Compress)) {
  for($index=0;$index -lt $First.headers.Count;$index++) {
    $before=$First.headers[$index];$after=$Second.headers[$index]
    foreach($name in @('column','name','rid','visible')) {
      if(($before.$name | ConvertTo-Json -Compress) -cne ($after.$name | ConvertTo-Json -Compress)) {
        & $rejectObservation ('header-'+$name) 'headers' $index
      }
    }
    if(($before.rect | ConvertTo-Json -Depth 3 -Compress) -cne ($after.rect | ConvertTo-Json -Depth 3 -Compress)) {
      & $rejectObservation 'header-geometry' 'headers' $index
    }
  }
  for($index=0;$index -lt $First.cells.Count;$index++) {
    $before=$First.cells[$index];$after=$Second.cells[$index]
    foreach($name in @('row','column','rid','name')) {
      if(($before.$name | ConvertTo-Json -Compress) -cne ($after.$name | ConvertTo-Json -Compress)) {
        & $rejectObservation ('cell-'+$name) 'cells' $index
      }
    }
    if(($before.semantic | ConvertTo-Json -Depth 3 -Compress) -cne ($after.semantic | ConvertTo-Json -Depth 3 -Compress)) {
      & $rejectObservation 'cell-semantic' 'cells' $index
    }
  }
    & $rejectObservation 'observation-shape'
  }
  $firstIdentities=New-Object 'Collections.Generic.HashSet[string]'
  $secondIdentities=New-Object 'Collections.Generic.HashSet[string]'
  $observationIndex=0
  foreach($observation in @($First,$Second)) {
  if($observationIndex -eq 0) {$identities=$firstIdentities}else{$identities=$secondIdentities}
  for($column=0;$column -lt $observation.columns;$column++) {
    $header=$observation.headers[$column]
    if(-not $header -or ($header.column -isnot [int] -and $header.column -isnot [long]) -or
        $header.column -ne $column -or $header.name -isnot [string] -or
        $header.rid -isnot [string] -or [string]::IsNullOrWhiteSpace($header.rid) -or
        -not $identities.Add($header.rid) -or $header.visible -isnot [bool] -or
        -not $header.rect -or $header.rect.empty -isnot [bool]) {
      throw 'Grid headers have incomplete or repeated column identities.'
    }
    foreach($property in @('x','y','width','height')) {
      $value=$header.rect.$property
      if($null -ne $value -and (($value -isnot [double] -and $value -isnot [single] -and
          $value -isnot [int] -and $value -isnot [long] -and $value -isnot [decimal]) -or
          [double]::IsNaN([double]$value) -or [double]::IsInfinity([double]$value))) {
        throw 'Grid header geometry is not a finite observation.'
      }
    }
    $visibleGeometry=[bool](-not $header.rect.empty -and $null -ne $header.rect.x -and
      $null -ne $header.rect.y -and $null -ne $header.rect.width -and $header.rect.width -gt 0 -and
      $null -ne $header.rect.height -and $header.rect.height -gt 0)
    if($header.visible -ne $visibleGeometry) {throw 'Grid header visibility differs from its observed geometry.'}
  }
  $observationIndex++
  }
  $visible=@($First.headers | Where-Object {$_.visible})
  if($visible.Count -eq 0) {throw 'Grid projection has no displayed header columns.'}
  $rows=New-Object System.Collections.ArrayList;$details=New-Object System.Collections.ArrayList
  for($row=0;$row -lt $First.readRows;$row++) {
    $raw=@(for($column=0;$column -lt $First.columns;$column++) {
      $cell=$First.cells[$row*$First.columns+$column]
      if(-not $cell -or ($cell.row -isnot [int] -and $cell.row -isnot [long]) -or
          ($cell.column -isnot [int] -and $cell.column -isnot [long]) -or
          $cell.row -ne $row -or $cell.column -ne $column -or $cell.rid -isnot [string] -or
          [string]::IsNullOrWhiteSpace($cell.rid) -or -not $firstIdentities.Add($cell.rid) -or
          -not $secondIdentities.Add($cell.rid) -or $cell.name -isnot [string]) {
        throw 'Grid row coordinates or identities are incomplete or repeated.'
      }
      $semantic=$cell.semantic
      if(-not $semantic -or $semantic.ok -isnot [bool] -or -not $semantic.ok -or
          $semantic.type -cnotin @('text','boolean')) {throw 'Grid cell has no complete typed semantic observation.'}
      if($semantic.type -ceq 'text') {
        if($semantic.value -isnot [string] -or $semantic.value -cne $cell.name -or $null -ne $semantic.checkboxState) {
          throw 'Grid text cell semantic value differs from its observed name.'
        }
      } elseif($semantic.checkboxState -cnotin @('Off','On','Indeterminate') -or
          ($semantic.checkboxState -ceq 'Off' -and ($semantic.value -isnot [bool] -or $semantic.value)) -or
          ($semantic.checkboxState -ceq 'On' -and ($semantic.value -isnot [bool] -or -not $semantic.value)) -or
          ($semantic.checkboxState -ceq 'Indeterminate' -and $null -ne $semantic.value)) {
        throw 'Grid checkbox state and typed value differ.'
      }
      $cell
    })
    $values=@($visible | ForEach-Object {[string]$raw[[int]$_.column].name})
    $semantics=@($visible | ForEach-Object {$raw[[int]$_.column].semantic})
    $null=$rows.Add([string[]]$values)
    $detail=New-SSETableRowDetails $row $semantics
    $detail | Add-Member NoteProperty gridRowIndex $row
    $null=$details.Add($detail)
  }
  # Expose every enumerated row, including an input slot. A blank/zero amount
  # is never evidence that a business record may be discarded.
  [pscustomobject]@{kopf=@($visible | ForEach-Object {$_.name});zeilen=@($rows);rowDetails=@($details);anzahl=$rows.Count;
    vollstaendig=($First.readRows -eq $First.rows);limitReached=($First.readRows -lt $First.rows);
    stopKind=$(if($First.readRows -eq $First.rows){'end-of-grid'}else{'max-rows'});
    gridRead=[pscustomobject]@{method='uia-grid';consistency='two-equal-observations';atomic=$false;
      modelRows=$First.rows;readModelRows=$First.readRows;modelColumns=$First.columns;
      visibleColumns=@($visible | ForEach-Object {$_.column});rowFilter='none';inputSlotsIncluded=$true}}
}

function Get-SSEGridLogicalFingerprint {
  param([string]$Key)
  if([string]::IsNullOrWhiteSpace($Key)){throw 'Logical Grid fingerprint requires a complete observation key.'}
  $hash=[Security.Cryptography.SHA256]::Create()
  try {([BitConverter]::ToString($hash.ComputeHash([Text.Encoding]::UTF8.GetBytes($Key)))).Replace('-','').ToLowerInvariant()}
  finally {$hash.Dispose()}
}

function ConvertTo-SSEGridLogicalModel {
  param($First,$Second,[int]$MaxRows,[int]$ProcessId,[string]$TableAid)
  if($ProcessId -le 0 -or [string]::IsNullOrWhiteSpace($TableAid)){throw 'Logical Grid requires an exact process and table identity.'}
  $projection=ConvertTo-SSEGridTableProjection $First $Second $MaxRows
  if(-not $projection.vollstaendig -or $First.readRows -ne $First.rows){throw 'Logical Grid requires every exposed row and column.'}
  $headers=@($First.headers|ForEach-Object{[pscustomobject]@{column=[int]$_.column;name=[string]$_.name;visible=[bool]$_.visible}})
  $rowKeys=@(for($row=0;$row -lt $First.rows;$row++){
    $values=@(for($column=0;$column -lt $First.columns;$column++){
      $cell=$First.cells[$row*$First.columns+$column]
      ,@([string]$cell.name,[string]$cell.semantic.type,$cell.semantic.value,$cell.semantic.checkboxState)
    })
    ConvertTo-Json -InputObject $values -Depth 5 -Compress
  })
  $structure=ConvertTo-Json -InputObject ([pscustomobject]@{pid=$ProcessId;tableAid=$TableAid;columns=[int]$First.columns;headers=$headers}) -Depth 5 -Compress
  $key=$structure+'|'+(ConvertTo-Json -InputObject @($rowKeys) -Compress)
  [pscustomobject]@{structure=$structure;rows=[int]$First.rows;rowKeys=$rowKeys;key=$key;fingerprint=(Get-SSEGridLogicalFingerprint $key)}
}

function Resolve-SSEGridCellCoordinate {
  param($Scan,[string]$Rid)
  if(-not $Scan -or [string]::IsNullOrWhiteSpace($Rid)){return $null}
  $matches=@($Scan.cells|Where-Object{[string]$_.rid -ceq $Rid})
  if($matches.Count -ne 1){return $null}
  $cell=$matches[0]
  if($cell.row -isnot [int] -or $cell.column -isnot [int] -or $cell.row -lt 0 -or $cell.row -ge $Scan.rows -or
    $cell.column -lt 0 -or $cell.column -ge $Scan.columns -or $cell.name -isnot [string]){return $null}
  [pscustomobject]@{row=[int]$cell.row;column=[int]$cell.column;name=[string]$cell.name}
}

function Test-SSEGridRowUnique {
  param($Model,[int]$Row)
  if(-not $Model -or $Model.rows -isnot [int] -or $Row -lt 0 -or $Row -ge $Model.rows -or
    @($Model.rowKeys).Count -ne $Model.rows){return $false}
  [bool](@($Model.rowKeys|Where-Object{$_ -ceq $Model.rowKeys[$Row]}).Count -eq 1)
}

function Get-SSEGridDeleteOutcome {
  param($Before,$After,[int]$Row)
  foreach($model in @($Before,$After)){
    if(-not $model -or $model.rows -isnot [int] -or $model.rows -lt 0 -or $model.rows -gt 1000 -or
      $model.structure -isnot [string] -or -not $model.structure -or @($model.rowKeys).Count -ne $model.rows -or
      @($model.rowKeys|Where-Object{$_ -isnot [string]}).Count -or
      $model.key -cne ($model.structure+'|'+(ConvertTo-Json -InputObject @($model.rowKeys) -Compress)) -or
      $model.fingerprint -cne (Get-SSEGridLogicalFingerprint $model.key)){return 'unexpected'}
  }
  if($Row -lt 0 -or $Row -ge $Before.rows -or $Before.structure -cne $After.structure){return 'unexpected'}
  if($After.key -ceq $Before.key){return 'unchanged'}
  if(-not (Test-SSEGridRowUnique $Before $Row) -or $After.rows -ne $Before.rows-1){return 'unexpected'}
  $expected=@(for($index=0;$index -lt $Before.rows;$index++){if($index -ne $Row){$Before.rowKeys[$index]}})
  for($index=0;$index -lt $expected.Count;$index++){if($After.rowKeys[$index] -cne $expected[$index]){return 'unexpected'}}
  'deleted-exact'
}
