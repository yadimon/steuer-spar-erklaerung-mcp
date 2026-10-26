$ErrorActionPreference='Stop'
. (Join-Path $PSScriptRoot '..\powershell\table-values.ps1')
$source=[IO.File]::ReadAllText((Join-Path $PSScriptRoot '..\powershell\sse-worker.ps1'))
$errors=$null
$ast=[Management.Automation.Language.Parser]::ParseInput($source,[ref]$null,[ref]$errors)
if (@($errors).Count) {throw 'Worker source does not parse.'}
foreach ($name in @('Test-SSEExactProperties','Test-SSETableNumberPolicy','Get-SSETableMutationTargetProof','Get-SSETableMutationTargetLocation','Get-SSEInputEpochEvidence',
  'Test-SSETableMutationInheritedContext','Test-SSETableMutationActionEpoch','Initialize-SSETableMutationFocus')) {
  $found=@($ast.FindAll({param($node) $node -is [Management.Automation.Language.FunctionDefinitionAst] -and $node.Name -ceq $name},$true))
  if ($found.Count -ne 1) {throw 'Private mutation proof must be unique.'}
  . ([scriptblock]::Create($found[0].Extent.Text))
}
# Fake UIA/Win32 records only; the actual worker/DLL/desktop is never loaded.
Add-Type -TypeDefinition @'
using System;
public static class SW {
 public static long Foreground=111;
 public static IntPtr GetForegroundWindow(){return new IntPtr(Foreground);}
 public static int GetDpiForWindow(IntPtr h){return 96;}
 public static int[] GetPhysicalClientOrigin(IntPtr h){return new[]{100,200};}
}
namespace System.Windows.Automation {
 public static class AutomationElement {public static object Root,FocusedElement;public static object FromHandle(IntPtr h){return Root;}}
 public static class ControlType {public const string Table="Table",DataGrid="DataGrid",DataItem="DataItem",Window="Window";}
 public static class GridItemPattern {public static object Pattern=new object();}
 public static class TogglePattern {public static object Pattern=new object();}
 public static class SelectionPattern {public static object Pattern=new object();}
}
'@
$AE=[System.Windows.Automation.AutomationElement]
$tableAid='Synthetic.RedThreadContent.DialogUI./.Synthetic.Expenses'
$headerNames=@('Nr.','Datum','Bezeichnung','Betrag','N','%','Netto')
$table=[pscustomobject]@{i=0;p=-1;type='Table';name='';rid='10.1';aid=$tableAid;on=$true;x=100;y=100;w=700;h=200}
$headerNodes=@(0..6 | ForEach-Object {[pscustomobject]@{i=1+$_;p=0;type='Header';name=$headerNames[$_];
  rid='10.'+(20+$_);aid=$tableAid+'.Header'+$_;on=$true;x=100+100*$_;y=100;w=100;h=24}})
$cellNames=@('','01.01','Target','10,00','','0','10,00')
$baseCells=@(0..6 | ForEach-Object {[pscustomobject]@{i=10+$_;p=0;type='DataItem';name=$cellNames[$_];val=$cellNames[$_];
  rid='10.'+(60+$_);aid=$tableAid;on=$true;x=100+100*$_;y=164;w=100;h=24}})
$prior=@(0..6 | ForEach-Object {[pscustomobject]@{nativeColumn=[int]$_;display=$cellNames[$_];edit=$cellNames[$_];
  flags=[int]$(if ($_ -eq 4) {51} elseif ($_ -eq 6) {1} else {35});checkState=$(if ($_ -eq 4) {[int]0} else {$null})}})
$prior[4].edit=$false
$baseTarget=[pscustomobject]@{row=[int]7;column=[int]2;text='Target';tableAid=$tableAid;tableRid='10.1';
  headers=$headerNames;cells=$prior;modelFingerprint=('a'*64)}
function Copy-Json($Value) {$Value | ConvertTo-Json -Depth 12 -Compress | ConvertFrom-Json}
function Get-SSETableSnapshotInputState {
  param($Tree,$Aid,$Rid)
  [pscustomobject]@{ok=[bool]($Aid -ceq $tableAid -and $Rid -ceq '10.1');editorFree=$script:editorFree;table=$script:tree.nodes[0]}
}
function Get-SSETableReadOnlyModelCells {
  param($Window,$ProcessId,$Aid,$Rids)
  [pscustomobject]@{ok=[bool]($Window -eq [IntPtr]111 -and $ProcessId -eq 7 -and $Aid -ceq $tableAid -and
    @($Rids | Where-Object {-not $script:elements.ContainsKey($_)}).Count -eq 0);elements=$script:elements}
}
function New-SyntheticCellElement($Cell,$Container,$Column) {
  $element=[pscustomobject]@{Current=[pscustomobject]@{Name=$Cell.name;ControlType='DataItem';ProcessId=7;HasKeyboardFocus=$false;IsEnabled=[bool]($Column -ne 6);BoundingRectangle=[pscustomobject]@{
    X=$Cell.x;Y=$Cell.y;Width=$Cell.w;Height=$Cell.h}};
    grid=[pscustomobject]@{Current=[pscustomobject]@{Row=[int]7;Column=[int]$Column;ContainingGrid=$Container}};
    toggle=$(if ($Column -eq 4) {[pscustomobject]@{Current=[pscustomobject]@{ToggleState='Off'}}} else {$null});runtimeId=$Cell.rid}
  $element | Add-Member ScriptMethod GetRuntimeId {$this.runtimeId -split '\.'}
  $element | Add-Member ScriptMethod TryGetCurrentPattern {
    param($Pattern,$Result)
    if ($Pattern -eq [System.Windows.Automation.GridItemPattern]::Pattern -and $this.grid) {$Result.Value=$this.grid;return $true}
    if ($Pattern -eq [System.Windows.Automation.TogglePattern]::Pattern -and $this.toggle) {$Result.Value=$this.toggle;return $true}
    $false
  }
  $element
}
function Set-SyntheticHiddenColumnBeforeTarget($Target,$Cells,$Elements) {
  # Native column 1 is hidden; visible index 2 therefore refers to native column 3.
  $nativeColumns=@(0,2,3,4,5,6,7)
  $Target.column=[int]3
  for ($index=0;$index -lt $nativeColumns.Count;$index++) {
    $Target.cells[$index].nativeColumn=[int]$nativeColumns[$index]
    $Elements[$Cells[$index].rid].grid.Current.Column=[int]$nativeColumns[$index]
  }
}
$expectedReject=@{
  'wrong-row'=@('grid-row-equal','grid-identity',0);'wrong-column'=@('grid-column-equal','grid-identity',3)
  'foreign-grid'=@('grid-pid-equal','grid-identity',0);'grid-rid'=@('grid-rid-equal','grid-identity',0)
  'grid-aid'=@('grid-aid-equal','grid-identity',0);'other-text'=@('unique-text-target','target-unique',$null)
  'changed-cell'=@('display-equal','display',1);'changed-checkbox'=@('toggle-value-equal','toggle',4)
  'missing-checkbox'=@('toggle-pattern-present','toggle',4);'duplicate'=@('unique-text-target','target-unique',$null)
  'caller-rid-stale'=@('unique-text-target','target-unique',$null);'clipped'=@('table-bottom-contained','cell-schema-geometry',0)
  'hidden-column'=@('grid-column-equal','grid-identity',5);'extra-prior-field'=@('cell-schema-exact','cell-schema-geometry',0)
  'bad-native-flags'=@('cell-selectable','cell-schema-geometry',1);'active-editor'=@('editor-free','table-editor',$null)
  'extra-target-field'=@('schema-exact','target-schema',$null);'bad-row-type'=@('row-type','target-schema',$null)
  'bad-column-type'=@('column-type','target-schema',$null);'model-count'=@('model-cell-count','target-schema',$null)
  'table-state'=@('table-state','table-editor',$null);'header-count'=@('header-count','header-count',$null)
  'shared-row'=@('row-cell-count','shared-row',$null);'row-rids'=@('row-rids-unique','shared-row',$null)
  'raw-missing'=@('raw-resolve','raw-resolve',$null);'header-name'=@('header-name-equal','cell-schema-geometry',1)
  'header-x'=@('header-x-equal','cell-schema-geometry',1);'header-width'=@('header-width-contained','cell-schema-geometry',1);
  'cell-inset-two'=@('header-width-contained','cell-schema-geometry',1)
  'table-left'=@('table-left-contained','cell-schema-geometry',0);'table-right'=@('table-right-contained','cell-schema-geometry',6)
  'header-bottom'=@('header-bottom-contained','cell-schema-geometry',0);'live-bounds'=@('live-width-equal','live-metadata',1)
  'live-name'=@('live-name-equal','live-metadata',1);'grid-pattern'=@('grid-pattern-present','grid-pattern',1)
  'grid-absent'=@('grid-present','grid-identity',1);'grid-type'=@('grid-type-bound','grid-identity',0)
  'bad-checkbox-state'=@('toggle-state-valid','toggle',4);'target-disabled'=@('target-enabled','target-capability',2)
  'target-flags'=@('target-flags-enabled-selectable','target-capability',2)
  'target-column'=@('target-column-header','target-unique',$null);'target-other-cell'=@('unique-text-target','target-unique',$null)
  'caller-rid-other-column'=@('unique-text-target','target-unique',$null)
  'hidden-before-target-wrong-rid'=@('unique-text-target','target-unique',$null)
  'native-column-duplicate'=@('native-column-unique','cell-schema-geometry',1)
  'native-column-order'=@('native-column-order','cell-schema-geometry',1)
  'many-candidates'=@('unique-text-target','target-unique',$null)
  'proof-exception'=@('proof-exception','grid-identity',0)
}
$allowedChecks=@('schema-exact','row-type','row-lower-bound','row-upper-bound','column-type','column-lower-bound','column-upper-bound',
  'text-type','text-present','fingerprint-format','headers-lower-bound','headers-upper-bound','model-cell-count','table-state','editor-free',
  'header-count','target-column-header','unique-text-target','row-cell-count','row-rids-unique','raw-resolve','cell-schema-exact','native-column-type',
  'native-column-lower-bound','native-column-upper-bound','native-column-unique','native-column-order','flags-type','cell-selectable',
  'header-name-equal','header-x-equal','header-width-contained','table-left-contained','table-right-contained','header-bottom-contained',
  'table-bottom-contained','live-x-equal','live-y-equal','live-width-equal','live-height-equal','live-name-equal','grid-pattern-present',
  'grid-row-equal','grid-column-equal','grid-present','grid-pid-equal','grid-type-bound','grid-rid-equal','grid-aid-equal',
  'toggle-state-valid','toggle-pattern-present','toggle-value-equal','display-equal','target-rid-equal','target-display-equal',
  'target-flags-enabled-selectable','target-enabled','target-not-toggle','target-check-state-absent','target-column-bound',
  'selection-pattern-present','selection-count-bounded','selection-row-members','selection-target-present','selection-grid-row','selection-keyboard-focus')
function Assert-SafeTargetDiagnostic($Proof) {
  if (@($Proof.diagnostic.PSObject.Properties.Name | Sort-Object) -join ',' -cne 'checks,columnIndex,counts,phase') {
    throw 'Target diagnostics contain undeclared fields.'
  }
  if ($null -ne $Proof.diagnostic.columnIndex -and
      ($Proof.diagnostic.columnIndex -isnot [int] -or $Proof.diagnostic.columnIndex -lt 0 -or $Proof.diagnostic.columnIndex -ge 100)) {
    throw 'Target diagnostic column is unbounded.'
  }
  foreach ($key in $Proof.diagnostic.counts.Keys) {
    if ($key -cnotin @('headerExpected','headerActual','candidate','rowActual') -or
        $Proof.diagnostic.counts[$key] -isnot [int] -or $Proof.diagnostic.counts[$key] -lt 0 -or $Proof.diagnostic.counts[$key] -gt 2048) {
      throw 'Target diagnostic count is undeclared or unbounded.'
    }
  }
  foreach ($key in $Proof.diagnostic.checks.Keys) {
    if ($key -cnotin $allowedChecks -or $Proof.diagnostic.checks[$key] -isnot [bool]) {
      throw 'Target diagnostic comparison contains non-boolean or undeclared data.'
    }
  }
  if ($Proof.reason -cnotin @($allowedChecks | ForEach-Object {'native-mutation-target-'+$_})+@('native-mutation-target-proof-exception')) {
    throw 'Target diagnostic reason contains free text.'
  }
  if ($Proof.diagnostic.phase -cnotin @('target-schema','table-editor','header-count','target-unique','shared-row','raw-resolve',
      'cell-schema-geometry','live-metadata','grid-pattern','grid-identity','toggle','display','target-capability','target-column','selection')) {
    throw 'Target diagnostic phase contains free text.'
  }
  $safe=[pscustomobject]@{reason=$Proof.reason;diagnostic=$Proof.diagnostic} | ConvertTo-Json -Depth 8 -Compress
  foreach ($forbidden in @($tableAid,'10.1','Target','01.01','10,00',('a'*64),'synthetic-private-exception')) {
    if ($safe.Contains($forbidden)) {throw 'Target diagnostics disclose model values, identities or exception text.'}
  }
}
foreach ($case in @('exact-seven-columns','duplicate-calculated-column','caller-rid-other-column','hidden-before-target','hidden-before-target-wrong-rid','cell-grid-line','cell-inset-two','wrong-row','wrong-column','foreign-grid','grid-rid','grid-aid','other-text','changed-cell',
  'changed-checkbox','missing-checkbox','duplicate','caller-rid-stale','clipped','hidden-column','extra-prior-field','bad-native-flags','active-editor',
  'extra-target-field','bad-row-type','bad-column-type','model-count','table-state','header-count','shared-row','row-rids','raw-missing',
  'header-name','header-x','header-width','table-left','table-right','header-bottom','live-bounds','live-name','grid-pattern','grid-absent',
  'grid-type','bad-checkbox-state','target-disabled','target-flags','target-column','target-other-cell','native-column-duplicate',
  'native-column-order','many-candidates','proof-exception')) {
  $target=Copy-Json $baseTarget;$cells=@($baseCells | ForEach-Object {$_.PSObject.Copy()})
  $headers=@($headerNodes | ForEach-Object {$_.PSObject.Copy()});$script:tree=[pscustomobject]@{nodes=@($table.PSObject.Copy())+$headers+$cells}
  $cells[6].on=$false
  $container=[pscustomobject]@{Current=[pscustomobject]@{ProcessId=7;ControlType='Table';AutomationId=$tableAid};rid='10.1'}
  $container | Add-Member ScriptMethod GetRuntimeId {$this.rid -split '\.'}
  $script:elements=@{};$script:editorFree=$true;$rid=''
  for ($column=0;$column -lt 7;$column++) {$script:elements[$cells[$column].rid]=New-SyntheticCellElement $cells[$column] $container $column}
  switch ($case) {
    'hidden-before-target' {
      Set-SyntheticHiddenColumnBeforeTarget $target $cells $script:elements
      $rid=$cells[2].rid
    }
    'hidden-before-target-wrong-rid' {
      Set-SyntheticHiddenColumnBeforeTarget $target $cells $script:elements
      $cells[3].name='Target';$cells[3].val='Target';$target.cells[3].display='Target';$target.cells[3].edit='Target'
      $script:elements[$cells[3].rid].Current.Name='Target';$rid=$cells[3].rid
    }
    'duplicate-calculated-column' {
      $cells[6].on=$true;$cells[6].name='Target';$cells[6].val='Target';
      $target.cells[6].display='Target';$target.cells[6].edit='Target';
      $script:elements[$cells[6].rid].Current.Name='Target'
    }
    'caller-rid-other-column' {
      $cells[6].on=$true;$cells[6].name='Target';$rid=$cells[6].rid
    }
    'wrong-row' {$script:elements[$cells[0].rid].grid.Current.Row=[int]6}
    'wrong-column' {$script:elements[$cells[3].rid].grid.Current.Column=[int]2}
    'foreign-grid' {$container.Current.ProcessId=8}
    'grid-rid' {$container.rid='10.9'}
    'grid-aid' {$container.Current.AutomationId=$tableAid+'.other'}
    'other-text' {$target.text='Other'}
    'changed-cell' {$cells[1].name='02.01';$script:elements[$cells[1].rid].Current.Name='02.01'}
    'changed-checkbox' {$script:elements[$cells[4].rid].toggle.Current.ToggleState='On'}
    'missing-checkbox' {$script:elements[$cells[4].rid].toggle=$null}
    'duplicate' {$script:tree.nodes+=@($cells[2].PSObject.Copy())}
    'caller-rid-stale' {$rid='Caller.stale.rid'}
    'clipped' {$script:tree.nodes[0]=$table.PSObject.Copy();$script:tree.nodes[0].h=80}
    'hidden-column' {$target.cells[5].nativeColumn=[int]8}
    'extra-prior-field' {$target.cells[0] | Add-Member NoteProperty bypass $true}
    'bad-native-flags' {$target.cells[1].flags=[int]0}
    'active-editor' {$script:editorFree=$false}
    'extra-target-field' {$target | Add-Member NoteProperty bypass 'synthetic-private-exception'}
    'bad-row-type' {$target.row='7';$script:editorFree=$false}
    'bad-column-type' {$target.column='2'}
    'model-count' {$target.cells=@($target.cells | Select-Object -First 6)}
    'table-state' {$target.tableRid='Other'}
    'header-count' {$script:tree.nodes=@($script:tree.nodes | Where-Object {$_.rid -cne $headers[1].rid})}
    'shared-row' {$cells[1].y++}
    'row-rids' {$cells[1].rid=$cells[0].rid}
    'raw-missing' {$script:elements.Remove($cells[1].rid)}
    'header-name' {$headers[1].name='Other'}
    'header-x' {$headers[1].x++}
    'header-width' {$headers[1].w--}
    'cell-grid-line' {foreach($cell in $cells) {$cell.w--;$script:elements[$cell.rid].Current.BoundingRectangle.Width--}}
    'cell-inset-two' {$cells[1].w-=2;$script:elements[$cells[1].rid].Current.BoundingRectangle.Width-=2}
    'table-left' {$script:tree.nodes[0].x++}
    'table-right' {$script:tree.nodes[0].w--}
    'header-bottom' {$headers[0].h=65}
    'live-bounds' {$script:elements[$cells[1].rid].Current.BoundingRectangle.Width--}
    'live-name' {$script:elements[$cells[1].rid].Current.Name='Other'}
    'grid-pattern' {$script:elements[$cells[1].rid].grid=$null}
    'grid-absent' {$script:elements[$cells[1].rid].grid.Current.ContainingGrid=$null}
    'grid-type' {$container.Current.ControlType='Other'}
    'bad-checkbox-state' {$target.cells[4].checkState=3}
    'target-disabled' {$script:elements[$cells[2].rid].Current.IsEnabled=$false}
    'target-flags' {$target.cells[2].flags=3}
    'target-column' {$target.column=99}
    'target-other-cell' {$target.column=1}
    'native-column-duplicate' {$target.cells[1].nativeColumn=0}
    'native-column-order' {$target.cells[0].nativeColumn=1;$target.cells[1].nativeColumn=0;
      $script:elements[$cells[0].rid].grid.Current.Column=1}
    'many-candidates' {$script:tree.nodes+=@(1..2050 | ForEach-Object {$cells[2].PSObject.Copy()})}
    'proof-exception' {$container | Add-Member ScriptMethod GetRuntimeId {throw 'synthetic-private-exception'} -Force}
  }
  $result=Get-SSETableMutationTargetProof ([IntPtr]111) 7 $script:tree $target $rid
  if ($result.ok -ne ($case -cin @('exact-seven-columns','duplicate-calculated-column','hidden-before-target','cell-grid-line'))) {throw "$case native row/GridItem/checkbox proof disagreed."}
  if ($result.ok -and ($result.cells.Count -ne 7 -or $result.target.rid -cne $cells[2].rid)) {throw 'Exact seven-column model target was not returned.'}
  if ($result.ok) {
    if (@($result.PSObject.Properties.Name | Sort-Object) -join ',' -cne 'cells,ok,reason,target') {throw 'Successful target proof changed its output contract.'}
  } else {
    $expected=$expectedReject[$case]
    if ($result.reason -cne ('native-mutation-target-'+$expected[0]) -or $result.diagnostic.phase -cne $expected[1] -or
        $result.diagnostic.columnIndex -ne $expected[2]) {throw "$case rejection did not identify the original failing comparison."}
    if ($case -cne 'proof-exception' -and $result.diagnostic.checks[$expected[0]] -ne $false) {throw 'Failed comparison was not recorded as false.'}
    if ($case -ceq 'bad-row-type' -and $result.diagnostic.checks.Contains('editor-free')) {throw 'Schema rejection stopped short-circuiting before live checks.'}
    if ($case -ceq 'many-candidates' -and $result.diagnostic.counts.candidate -ne 2048) {throw 'Malformed snapshot diagnostic count was not capped.'}
    Assert-SafeTargetDiagnostic $result
  }
}
# Execute the real private response and Fail projection; no full worker dispatch or desktop is loaded.
$targetResponses=@($ast.FindAll({param($node)
  $node -is [Management.Automation.Language.IfStatementAst] -and
  $node.Clauses[0].Item1.Extent.Text -ceq '$cursorPhase -ceq ''mutation-target'''
},$true))
if ($targetResponses.Count -ne 1) {throw 'Private mutation-target response is not unique.'}
$failDefinition=@($ast.FindAll({param($node)
  $node -is [Management.Automation.Language.FunctionDefinitionAst] -and $node.Name -ceq 'Fail'
},$true))
if ($failDefinition.Count -ne 1) {throw 'Worker Fail projection is not unique.'}
. ([scriptblock]::Create($failDefinition[0].Extent.Text))
$targetResponse=[scriptblock]::Create($targetResponses[0].Extent.Text)
function Emit {param($Value) $script:emitted=$Value;throw 'synthetic-emit-stopped'}
foreach ($case in @('valid','target-disabled','private-value-reject','diagnostic-exception')) {
  $cells=@($baseCells | ForEach-Object {$_.PSObject.Copy()});$script:tree=[pscustomobject]@{nodes=@($table)+$headerNodes+$cells}
  $script:editorFree=$true;$script:elements=@{};$script:emitted=$null
  $container=[pscustomobject]@{Current=[pscustomobject]@{ProcessId=7;ControlType='Table';AutomationId=$tableAid};rid='10.1'}
  $container | Add-Member ScriptMethod GetRuntimeId {$this.rid -split '\.'}
  for ($column=0;$column -lt 7;$column++) {$script:elements[$cells[$column].rid]=New-SyntheticCellElement $cells[$column] $container $column}
  $cursorPhase='mutation-target';$hwnd=[IntPtr]111;$main=[pscustomobject]@{pid=7}
  $latestTableSnapshot=[pscustomobject]@{tree=$script:tree}
  $cursorPlan=[pscustomobject]@{target=(Copy-Json $baseTarget);targetRid=''}
  switch ($case) {
    'target-disabled' {$script:elements[$cells[2].rid].Current.IsEnabled=$false}
    'private-value-reject' {$cursorPlan.target.text='synthetic-private-exception'}
    'diagnostic-exception' {$container | Add-Member ScriptMethod GetRuntimeId {throw 'synthetic-private-exception'} -Force}
  }
  try {& $targetResponse;throw 'Private response failed to emit.'} catch {
    if ($_.Exception.Message -cne 'synthetic-emit-stopped') {throw}
  }
  $response=$script:emitted
  if ($response.ok -ne ($case -ceq 'valid') -or $response.steps -ne 0 -or $response.physicalInputUsed -ne $false) {
    throw 'Passive mutation-target response changed its outcome or physical-input contract.'
  }
  if ($case -ceq 'valid') {
    if (@($response.PSObject.Properties.Name | Sort-Object) -join ',' -cne 'mutationTarget,ok,physicalInputUsed,steps' -or
        $response.mutationTarget.targetRid -cne $cells[2].rid) {throw 'Successful private target response changed.'}
  } else {
    if ($response.kind -cne 'stale' -or $response.mutationStarted -ne $false -or $response.retryable -ne $false -or
        $response.cursorActivation.activationAttempted -ne $false -or $response.PSObject.Properties.Name -ccontains 'mutationTarget') {
      throw 'Rejected target response lost its no-write/no-retry boundary or leaked authority.'
    }
    if (@($response.cursorActivation.PSObject.Properties.Name | Sort-Object) -join ',' -cne
        'activationAttempted,source,subphase,targetProof') {throw 'Target diagnostic envelope has unexpected data.'}
    $projection=$response.cursorActivation.targetProof
    if (@($projection.PSObject.Properties.Name | Sort-Object) -join ',' -cne 'checks,columnIndex,counts,phase,reason') {
      throw 'Public target diagnostic projection contains undeclared fields.'
    }
    Assert-SafeTargetDiagnostic ([pscustomobject]@{reason=$projection.reason;diagnostic=[pscustomobject]@{
      phase=$projection.phase;columnIndex=$projection.columnIndex;counts=$projection.counts;checks=$projection.checks}})
    $serialized=$response | ConvertTo-Json -Depth 10 -Compress
    foreach ($forbidden in @($tableAid,'10.1','Target','01.01','10,00',('a'*64),'synthetic-private-exception')) {
      if ($serialized.Contains($forbidden)) {throw 'Passive rejection leaks caller/model/exception data.'}
    }
  }
}
$script:tree=[pscustomobject]@{nodes=@($table)+$headerNodes+$baseCells};$script:editorFree=$true
$policy=[pscustomobject]@{tableName='/.Synthetic.Expenses';headers=$headerNames}
if (-not (Test-SSETableNumberPolicy $policy $tableAid $headerNodes)) {throw 'Verified seven-column native Nr policy was rejected.'}
foreach ($case in @('other-table','wrong-header','extra-field','missing-header')) {
  $bad=Copy-Json $policy
  switch ($case) {'other-table' {$bad.tableName='/.Other'};'wrong-header' {$bad.headers[4]='Other'};
    'extra-field' {$bad | Add-Member NoteProperty fieldName 'OtherEditor'};'missing-header' {$bad.headers=@($bad.headers | Select-Object -First 6)}}
  if (Test-SSETableNumberPolicy $bad $tableAid $headerNodes) {throw "$case private Nr policy widened its proof."}
}
function Get-DirtyStateFast {$script:dirty}
function Get-SSEWindowTitleText {'Synthetic case'}
function Test-SSELastInputUnchanged($Expected) {$Expected -eq $script:tick}
function Get-SSEInteractionWindowSet {[pscustomobject]@{fingerprint=('a'*64)}}
function Get-CurrentHeading {'EDV-Kosten'}
$read=[pscustomobject]@{value='100,00';selected=[pscustomobject]@{rid='10.90';aid='Synthetic.Sum'}}
$region=[pscustomobject]@{ok=$true;scopePrefix='Synthetic.Scope';selectionMethod='synthetic'}
$baseAuthority=[pscustomobject]@{schemaVersion=1;operation='table_update';target=$baseTarget;binding=[pscustomobject]@{
  hwnd=111;pid=7;inputEpoch=10;dirty=$true;windowTitle='Synthetic case';dpi=96;clientOrigin=@(100,200);windowFingerprint=('a'*64);
  snapshot=[pscustomobject]@{kopf=$headerNames;navigationBinding=[pscustomobject]@{complete=$true;editorFree=$true;tableRootAid=$tableAid;tableRootRid='10.1';
    heading='EDV-Kosten';summaryValue='100,00';summaryRid='10.90';summaryAid='Synthetic.Sum';scopePrefix='Synthetic.Scope';
    selectionMethod='synthetic';headers=@($headerNodes | ForEach-Object {[pscustomobject]@{name=$_.name;rid=$_.rid;aid=$_.aid}})}}}}
foreach ($case in @('valid','wrong-operation','root','pid','epoch','dirty','dpi','origin','windowset','page','sum','header','extra-field')) {
  $authority=Copy-Json $baseAuthority;$script:dirty=$true;$script:tick=10
  switch ($case) {
    'wrong-operation' {$authority.operation='table_delete'}
    'root' {$authority.binding.hwnd=222}
    'pid' {$authority.binding.pid=8}
    'epoch' {$script:tick=11}
    'dirty' {$script:dirty=$false}
    'dpi' {$authority.binding.dpi=144}
    'origin' {$authority.binding.clientOrigin[0]=101}
    'windowset' {$authority.binding.windowFingerprint='other'}
    'page' {$authority.binding.snapshot.navigationBinding.heading='Other'}
    'sum' {$authority.binding.snapshot.navigationBinding.summaryValue='101,00'}
    'header' {$authority.binding.snapshot.navigationBinding.headers[4].rid='10.99'}
    'extra-field' {$authority | Add-Member NoteProperty fallback $true}
  }
  $ok=Test-SSETableMutationInheritedContext ([IntPtr]111) 7 $script:tree $read $region $authority 'table_update'
  if ($ok -ne ($case -ceq 'valid')) {throw "$case inherited root/page/model/epoch guard disagreed."}
}
foreach ($case in @('valid','epoch','window','foreground')) {
  $script:tick=10;[SW]::Foreground=111
  if ($case -eq 'epoch') {$script:tick=11}
  if ($case -eq 'foreground') {[SW]::Foreground=222}
  $fingerprint=$(if ($case -eq 'window') {'other'} else {'a'*64})
  $ok=Test-SSETableMutationActionEpoch ([IntPtr]111) 7 10 $fingerprint -RequireForeground
  if ($ok -ne ($case -ceq 'valid')) {throw "$case immediately-before-action inherited epoch was rebased."}
}
[SW]::Foreground=111
function Test-SSEForegroundIsLockScreen {$false}
function Get-SSELastInputTick {$script:baselineReads++;$script:tick}
function Show-SSEWindow {$script:shows++}
function Walk-BoundTree {param($Window,[switch]$WithValues) $script:tree}
function Read-LabeledValueFromTree {$read}
function Get-SSETableRegion {$region}
function Resolve-SSETableProfile {[pscustomobject]@{known=$false}}
function Get-SSETableContentSignature {'unchanged'}
function Set-SSEForegroundLeaseInputCheckpoint {}
foreach ($case in @('stable','foreign-before-acquisition')) {
  $script:tick=$(if ($case -eq 'stable') {10} else {11});$script:shows=0;$script:baselineReads=0
  function Fail {param($Message,$Kind) throw 'synthetic-inherited-epoch-rejected'}
  try {
    $focus=Initialize-SSETableMutationFocus ([IntPtr]111) 7 'EDV-Kosten' 'Summe' 1 '100,00' $script:tree $read $region ([pscustomobject]@{known=$false}) 10
    if ($case -cne 'stable' -or $focus.inputBaseline -ne 10) {throw 'Inherited focus baseline was not preserved.'}
  } catch {if ($case -ceq 'stable' -or $_.Exception.Message -cne 'synthetic-inherited-epoch-rejected') {throw}}
  if ($script:shows -ne $(if ($case -ceq 'stable') {1} else {0}) -or $script:baselineReads -ne 0) {throw 'Inherited focus path acquired a fresh input baseline.'}
}
# The actual compiled collector and its PowerShell entry point are verified in
# fresh-raw-resolver-contract.ps1, including disabled passive calculated cells.
# The independent row/grid/model/context proof tests above retain this boundary
# stub and all zero-action rejection assertions.
function Reset-LocationFixture {
  $script:editorFree=$true;$script:requestedRawCells=0;$script:selectionSupported=$true
  $script:container=[pscustomobject]@{Current=[pscustomobject]@{ProcessId=7;ControlType='Table';AutomationId=$tableAid;HasKeyboardFocus=$true};rid='10.1'}
  $script:container | Add-Member ScriptMethod GetRuntimeId {$this.rid -split '\.'}
  $script:container | Add-Member ScriptMethod TryGetCurrentPattern {
    param($Pattern,$Result)
    if($Pattern -eq [System.Windows.Automation.SelectionPattern]::Pattern -and $script:selectionSupported){
      $selection=[pscustomobject]@{Current=[pscustomobject]@{}}
      $selection.Current | Add-Member ScriptMethod GetSelection {$script:selectionEntries}
      $Result.Value=$selection;return $true
    }
    $false
  }
  $script:rowSeven=Copy-Json $baseCells
  $script:rowEight=Copy-Json $baseCells
  foreach($cell in $script:rowEight){$cell.y=188;$cell.rid='20.'+(($cell.i-10)+60);$cell.i+=100}
  $script:elements=@{}
  foreach($row in @(@($script:rowSeven),@($script:rowEight))){
    for($column=0;$column -lt $row.Count;$column++){
      $element=New-SyntheticCellElement $row[$column] $script:container $column
      $element.grid.Current.Row=[int]$(if($row[$column].y -eq 188){8}else{7})
      $script:elements[$row[$column].rid]=$element
    }
  }
  $script:tree=[pscustomobject]@{nodes=@($table)+@($headerNodes)+@($script:rowSeven)+@($script:rowEight)}
  $script:binding=[pscustomobject]@{snapshot=[pscustomobject]@{navigationBinding=[pscustomobject]@{tableRootAid=$tableAid;tableRootRid='10.1'}}}
  $script:selectionEntries=@($script:rowSeven | ForEach-Object {$script:elements[$_.rid]})
  $script:elements[$script:rowSeven[0].rid].Current.HasKeyboardFocus=$true
  $AE::FocusedElement=$script:elements[$script:rowSeven[0].rid]
}
function Get-SSETableReadOnlyModelCells {
  param($Window,$ProcessId,$Aid,$Rids)
  $script:requestedRawCells=@($Rids).Count
  if (@($Rids).Count -lt 2) {throw 'Actual production raw resolver requires at least two cells.'}
  [pscustomobject]@{ok=[bool]($Window -eq [IntPtr]111 -and $ProcessId -eq 7 -and $Aid -ceq $tableAid -and
    @($Rids | Where-Object {-not $script:elements.ContainsKey($_)}).Count -eq 0);elements=$script:elements}
}
Reset-LocationFixture
$location=Get-SSETableMutationTargetLocation ([IntPtr]111) 7 $script:tree $script:binding 'Target' $script:rowEight[2].rid
if(-not $location.ok -or $location.row -ne 8 -or $location.column -ne 2 -or $location.targetRid -cne $script:rowEight[2].rid -or $script:requestedRawCells -ne 7){throw 'Exact duplicate RID did not locate the second model row via a complete raw row.'}
$checks=1
foreach($case in @('empty-rid','wrong-text','snapshot-disabled','incomplete-row','disabled','toggle','missing-grid','foreign-pid','wrong-grid-rid','wrong-grid-aid','duplicate-rid','foreign-table','invalid-row','changed-bounds')){
  Reset-LocationFixture
  $rid=$script:rowEight[2].rid;$wanted='Target'
  switch($case){
    'empty-rid' {$rid=''}
    'wrong-text' {$wanted='Other'}
    'snapshot-disabled' {$script:rowEight[2].on=$false}
    'incomplete-row' {$script:tree.nodes=@($script:tree.nodes|Where-Object rid -CNE $script:rowEight[6].rid)}
    'disabled' {$script:elements[$rid].Current.IsEnabled=$false}
    'toggle' {$script:elements[$rid].toggle=[pscustomobject]@{}}
    'missing-grid' {$script:elements[$rid].grid=$null}
    'foreign-pid' {$script:container.Current.ProcessId=8}
    'wrong-grid-rid' {$script:container.rid='10.9'}
    'wrong-grid-aid' {$script:container.Current.AutomationId='Other'}
    'duplicate-rid' {$script:tree.nodes+=@(Copy-Json $script:rowEight[2])}
    'foreign-table' {$script:rowEight[2].p=99}
    'invalid-row' {$script:elements[$rid].grid.Current.Row=1000}
    'changed-bounds' {$script:elements[$rid].Current.BoundingRectangle.Y=189}
  }
  $result=Get-SSETableMutationTargetLocation ([IntPtr]111) 7 $script:tree $script:binding $wanted $rid
  if($result.ok -or @($result.PSObject.Properties.Name | Sort-Object) -join ',' -cne 'ok,reason' -or $result.reason -cne 'native-mutation-location-unbound'){throw ('Unsafe preliminary location: '+$case)}
  $checks++
}
Reset-LocationFixture
foreach($row in @($script:rowSeven,$script:rowEight)){
  for($index=0;$index -lt $row.Count;$index++){$script:elements[$row[$index].rid].grid.Current.Column=[int](@(0,2,3,4,5,6,7)[$index])}
}
$hiddenLocation=Get-SSETableMutationTargetLocation ([IntPtr]111) 7 $script:tree $script:binding 'Target' $script:rowEight[2].rid
if(-not $hiddenLocation.ok -or $hiddenLocation.column -ne 3){throw 'Location confused visible header order with a native column after a hidden column.'}
$selectionRejects=@{
  'missing-pattern'='selection-pattern-present';'empty'='selection-count-bounded';'foreign-row'='selection-row-members'
  'without-target'='selection-target-present';'duplicate-selection'='selection-row-members'
  'changed-row'='selection-grid-row';'changed-bounds'='selection-grid-row';'missing-grid'='selection-grid-row'
}
foreach($case in @('valid','table-focus-valid','missing-pattern','empty','foreign-row','without-target','duplicate-selection','changed-row','changed-bounds','missing-grid',
  'focus-other-row','focus-absent','focus-flag-lost','focus-wrong-grid-row','focus-missing-grid','focus-edit-delegate','focus-edit-shared-rid',
  'table-focus-other-row','table-focus-none','table-focus-multiple','table-focus-wrong-rid','table-focus-wrong-aid','table-focus-flag-lost',
  'table-focus-foreign-pid','table-focus-wrong-type')){
  Reset-LocationFixture
  switch($case){
    'missing-pattern' {$script:selectionSupported=$false}
    'empty' {$script:selectionEntries=@()}
    'foreign-row' {$script:selectionEntries[0]=$script:elements[$script:rowEight[0].rid]}
    'without-target' {$script:selectionEntries=@($script:elements[$script:rowSeven[0].rid])}
    'duplicate-selection' {$script:selectionEntries=@($script:elements[$script:rowSeven[2].rid],$script:elements[$script:rowSeven[2].rid])}
    'table-focus-valid' {$AE::FocusedElement=$script:container}
    {$_ -cin @('table-focus-other-row','table-focus-none','table-focus-multiple','table-focus-flag-lost')} {
      $AE::FocusedElement=$script:container
      if($case -cin @('table-focus-other-row','table-focus-none')){$script:elements[$script:rowSeven[0].rid].Current.HasKeyboardFocus=$false}
      if($case -ceq 'table-focus-other-row'){$script:elements[$script:rowEight[0].rid].Current.HasKeyboardFocus=$true}
      if($case -ceq 'table-focus-multiple'){$script:elements[$script:rowSeven[1].rid].Current.HasKeyboardFocus=$true}
      if($case -ceq 'table-focus-flag-lost'){$script:container.Current.HasKeyboardFocus=$false}
    }
    {$_ -cin @('table-focus-wrong-rid','table-focus-wrong-aid','table-focus-foreign-pid','table-focus-wrong-type')} {
      $otherRoot=[pscustomobject]@{Current=$script:container.Current.PSObject.Copy();rid='10.1'}
      $otherRoot|Add-Member ScriptMethod GetRuntimeId {$this.rid -split '\.'}
      if($case -ceq 'table-focus-wrong-rid'){$otherRoot.rid='10.9'}
      if($case -ceq 'table-focus-wrong-aid'){$otherRoot.Current.AutomationId='Synthetic other table'}
      if($case -ceq 'table-focus-foreign-pid'){$otherRoot.Current.ProcessId=8}
      if($case -ceq 'table-focus-wrong-type'){$otherRoot.Current.ControlType='Window'}
      $AE::FocusedElement=$otherRoot
    }
    'focus-other-row' {$AE::FocusedElement=$script:elements[$script:rowEight[0].rid];$AE::FocusedElement.Current.HasKeyboardFocus=$true}
    'focus-absent' {$AE::FocusedElement=$null}
    {$_ -cin @('focus-edit-delegate','focus-edit-shared-rid')} {
      $delegate=New-SyntheticCellElement $script:rowSeven[2] $script:container 2
      $delegate.Current.ControlType='Edit';$delegate.Current.HasKeyboardFocus=$true
      if($case -ceq 'focus-edit-delegate'){$delegate.runtimeId='10.88';$delegate.grid=$null}
      $script:elements[$script:rowSeven[2].rid].Current.HasKeyboardFocus=$true
      $AE::FocusedElement=$delegate
    }
    'focus-flag-lost' {$AE::FocusedElement.Current.HasKeyboardFocus=$false}
    {$_ -cin @('focus-wrong-grid-row','focus-missing-grid')} {
      $newFocus=New-SyntheticCellElement $script:rowSeven[0] $script:container 0
      $newFocus.Current.HasKeyboardFocus=$true
      if($case -ceq 'focus-wrong-grid-row'){$newFocus.grid.Current.Row=8}
      if($case -ceq 'focus-missing-grid'){$newFocus.grid=$null}
      $AE::FocusedElement=$newFocus
    }
    {$_ -cin @('changed-row','changed-bounds','missing-grid')} {
      # A separately read selection object can change after the full row read.
      $changed=New-SyntheticCellElement $script:rowSeven[2] $script:container 2
      if($case -ceq 'changed-row'){$changed.grid.Current.Row=8}
      if($case -ceq 'changed-bounds'){$changed.Current.BoundingRectangle.Y=165}
      if($case -ceq 'missing-grid'){$changed.grid=$null}
      $script:selectionEntries=@($changed)
    }
  }
  $proof=Get-SSETableMutationTargetProof ([IntPtr]111) 7 $script:tree (Copy-Json $baseTarget) $script:rowSeven[2].rid -RequireSelection
  if($proof.ok -ne ($case -cin @('valid','table-focus-valid'))){throw ('Fresh delete selection proof disagreed: '+$case)}
  if(-not $proof.ok){
    Assert-SafeTargetDiagnostic $proof
    $expectedCheck=$(if($selectionRejects.ContainsKey($case)){$selectionRejects[$case]}else{'selection-keyboard-focus'})
    if($proof.reason -cne ('native-mutation-target-'+$expectedCheck) -or $proof.diagnostic.phase -cne 'selection' -or
      $proof.diagnostic.checks[$expectedCheck] -ne $false){throw ('Selection/focus case rejected for the wrong reason: '+$case)}
    if($expectedCheck -ceq 'selection-keyboard-focus' -and $proof.diagnostic.checks['selection-grid-row'] -ne $true){throw 'Focus refusal bypassed the successful selected-row proof.'}
  }
}
# Execute the actual private dispatcher result, including its Fail projection.
$locationResponses=@($ast.FindAll({param($node) $node -is [Management.Automation.Language.IfStatementAst] -and
  $node.Clauses[0].Item1.Extent.Text -ceq '$cursorPhase -ceq ''mutation-target-locate'''},$true))
if($locationResponses.Count -ne 1){throw 'Private target location response must be unique.'}
$inheritedGates=@($ast.FindAll({param($node) $node -is [Management.Automation.Language.IfStatementAst] -and
  $node.Clauses[0].Item1.Extent.Text.Contains('Test-SSETableReadSnapshotBinding $inherited.snapshot')},$true))
if($inheritedGates.Count -ne 1 -or $inheritedGates[0].Extent.EndOffset -ge $locationResponses[0].Extent.StartOffset){throw 'Location escaped the shared inherited-context proof.'}
. ([scriptblock]::Create($failDefinition[0].Extent.Text))
$locationResponse=[scriptblock]::Create($locationResponses[0].Extent.Text)
foreach($case in @('valid','stale-rid','private-text')){
  Reset-LocationFixture
  $cursorPhase='mutation-target-locate';$hwnd=[IntPtr]111;$main=[pscustomobject]@{pid=7}
  $latestTableSnapshot=[pscustomobject]@{tree=$script:tree};$inherited=$script:binding
  $cursorPlan=[pscustomobject]@{text='Target';targetRid=$script:rowEight[2].rid}
  if($case -ceq 'stale-rid'){$cursorPlan.targetRid='Synthetic.stale.rid'}
  if($case -ceq 'private-text'){$cursorPlan.text='Synthetic private field'}
  $script:emitted=$null
  try{& $locationResponse;throw 'Location did not emit.'}catch{if($_.Exception.Message -cne 'synthetic-emit-stopped'){throw}}
  $response=$script:emitted
  if($response.ok -ne ($case -ceq 'valid') -or $response.physicalInputUsed -ne $false -or $response.steps -ne 0){throw 'Location lost its passive outcome contract.'}
  if($case -ceq 'valid'){
    if(@($response.PSObject.Properties.Name|Sort-Object) -join ',' -cne 'mutationTarget,ok,physicalInputUsed,steps' -or
      $response.mutationTarget.row -ne 8 -or $response.mutationTarget.column -ne 2 -or $response.mutationTarget.targetRid -cne $script:rowEight[2].rid){throw 'Location response is not strictly bounded.'}
  }else{
    if($response.kind -cne 'stale' -or $response.mutationStarted -ne $false -or $response.retryable -ne $false -or
      $response.PSObject.Properties.Name -ccontains 'mutationTarget'){throw 'Location refusal leaks authority or permits mutation/retry.'}
    $serialized=$response|ConvertTo-Json -Depth 8 -Compress
    foreach($forbidden in @($tableAid,'20.62','Synthetic.stale.rid','Synthetic private field')){if($serialized.Contains($forbidden)){throw 'Location refusal leaks model or caller data.'}}
  }
}
$bindingAssignments=@($ast.FindAll({param($node) $node -is [Management.Automation.Language.AssignmentStatementAst] -and
  $node.Left.Extent.Text -ceq '$inherited' -and $node.Right.Extent.Text -ceq '$cursorPlan.binding'},$true))
if($bindingAssignments.Count -ne 1){throw 'Location must receive the actual inherited private plan binding.'}
$boundLocation=[scriptblock]::Create($bindingAssignments[0].Extent.Text+"`n"+$inheritedGates[0].Extent.Text+"`n"+$locationResponses[0].Extent.Text)
& {
  function Test-SSETableReadSnapshotBinding {
    param($Before,$After,[switch]$BeforeNavigation)
    $script:bindingReads++
    if(-not $BeforeNavigation -or -not [object]::ReferenceEquals($Before,$cursorPlan.binding.snapshot) -or
      -not [object]::ReferenceEquals($After,$erst)){throw 'Location did not compare the actual inherited and current snapshots.'}
    $script:bindingMatch
  }
  foreach($case in @('valid','missing-binding','wrong-windowset','snapshot-changed')){
    Reset-LocationFixture
    $cursorPhase='mutation-target-locate';$hwnd=[IntPtr]111;$main=[pscustomobject]@{pid=7}
    $cursorPlan=[pscustomobject]@{binding=(Copy-Json $baseAuthority.binding);text='Target';targetRid=$script:rowEight[2].rid}
    if($case -ceq 'missing-binding'){$cursorPlan.binding=$null}
    if($case -ceq 'wrong-windowset'){$cursorPlan.binding.windowFingerprint='Synthetic changed fingerprint'}
    $dirtyBefore=$true;$phaseWindows=[pscustomobject]@{fingerprint=('a'*64)};$script:tick=10
    $erst=[pscustomobject]@{marker='Synthetic current snapshot'};$latestTableSnapshot=[pscustomobject]@{tree=$script:tree}
    $script:bindingMatch=$case -cne 'snapshot-changed';$script:bindingReads=0;$script:emitted=$null
    try{& $boundLocation;throw 'Bound location did not emit.'}catch{if($_.Exception.Message -cne 'synthetic-emit-stopped'){throw}}
    if($script:emitted.ok -ne ($case -ceq 'valid')){throw ('Inherited dispatcher/location sequence disagreed: '+$case)}
    if($case -ceq 'valid'){
      if($script:bindingReads -ne 1 -or $script:requestedRawCells -ne 7 -or $script:emitted.mutationTarget.row -ne 8){throw 'Bound location skipped current snapshot or complete raw row proof.'}
    }elseif($script:emitted.kind -cne 'interference' -or $script:requestedRawCells -ne 0){throw 'A stale inherited context reached the location provider.'}
  }
}
$planClauses=@($ast.FindAll({param($node) $node -is [Management.Automation.Language.IfStatementAst]},$true) |
  ForEach-Object {$_.Clauses} | Where-Object {$_.Item1.Extent.Text -ceq '$cursorPhase -ceq ''mutation-target-locate''' -and
    $_.Item2.Extent.Text.Contains('$allowedPlanFields')})
$validationGates=@($ast.FindAll({param($node) $node -is [Management.Automation.Language.IfStatementAst] -and
  $node.Clauses[0].Item1.Extent.Text.Contains('$cursorPlan.schemaVersion -ne 1')},$true))
if($planClauses.Count -ne 1 -or $validationGates.Count -ne 1){throw 'Private location plan schema must be unique.'}
$planFields=[scriptblock]::Create(($planClauses[0].Item2.Statements.Extent.Text -join "`n"))
$planValidation=[scriptblock]::Create($validationGates[0].Extent.Text)
& {
  function Arg($Arguments,$Name){$Arguments[$Name]}
  function Fail {throw 'synthetic-plan-rejected'}
  foreach($extra in @('','target','tableAid','tableRid')){
    $cursorPhase='mutation-target-locate';$allowedPlanFields=@('schemaVersion','phase');. $planFields
    if(@($allowedPlanFields|Sort-Object) -join ',' -cne 'binding,phase,schemaVersion,targetRid,text'){throw 'Location plan admits undeclared authority.'}
    $cursorPlan=[pscustomobject]@{schemaVersion=1;phase=$cursorPhase;binding=$script:binding;text='Target';targetRid='10.62'}
    if($extra){$cursorPlan|Add-Member NoteProperty $extra 'Synthetic forbidden authority'}
    $a=@{noKeys=$false};$sumLabel='Summe';$rejected=$false
    try{& $planValidation}catch{if($_.Exception.Message -cne 'synthetic-plan-rejected'){throw};$rejected=$true}
    if($rejected -ne [bool]$extra){throw 'Actual location plan validator widened its allowed fields.'}
  }
}
$proofCalls=@($ast.FindAll({param($node) $node -is [Management.Automation.Language.CommandAst] -and
  $node.GetCommandName() -ceq 'Get-SSETableMutationTargetProof'},$true))
foreach($command in $proofCalls){
  if($command.CommandElements[5] -is [Management.Automation.Language.StringConstantExpressionAst] -and
    $command.CommandElements[5].Value -ceq ''){throw 'A worker reproof discarded its fresh RuntimeId.'}
}
$finalDelete=@($proofCalls|Where-Object {$_.CommandElements[5].Extent.Text -ceq '$preDeleteMatches[0].rid'})
if($finalDelete.Count -ne 1 -or @($finalDelete[0].CommandElements|Where-Object {$_ -is [Management.Automation.Language.CommandParameterAst] -and $_.ParameterName -ceq 'RequireSelection'}).Count -ne 1){throw 'Delete lost its current selection proof.'}
$deleteKeys=@($ast.FindAll({param($node) $node -is [Management.Automation.Language.InvokeMemberExpressionAst] -and
  $node.Member.Extent.Text -ceq 'SendWait' -and $node.Arguments.Count -eq 1 -and
  $node.Arguments[0] -is [Management.Automation.Language.StringConstantExpressionAst] -and $node.Arguments[0].Value -ceq '^+{DEL}'},$true))
if($deleteKeys.Count -ne 1 -or $finalDelete[0].Extent.StartOffset -ge $deleteKeys[0].Extent.StartOffset){throw 'Current selection proof moved behind the delete action.'}
$deleteChecks=@($ast.FindAll({param($node) $node -is [Management.Automation.Language.AssignmentStatementAst] -and $node.Left.Extent.Text -ceq '$preDeleteOk'},$true))
if($deleteChecks.Count -ne 1){throw 'Delete final geometry check must be unique.'}
$deleteCheck=[scriptblock]::Create($deleteChecks[0].Right.Extent.Text)
foreach($case in @('valid','final-cell-moved','selection-moved')){
  $mutationAuthority=[pscustomobject]@{};$preDeleteHeading='EDV-Kosten';$expectedPage=$preDeleteHeading
  $preDeleteRead=[pscustomobject]@{value='100,00'};$expectedBefore='100,00';$preDeleteMatches=@([pscustomobject]@{y=164})
  $zelle=[pscustomobject]@{y=164};$selectionYs=@(164,164);$preDeleteForegroundAfter=[int64]111;$hwnd=[IntPtr]111
  $interactionBeforeDelete=[pscustomobject]@{fingerprint='Synthetic stable'};$preDeleteWindows=$interactionBeforeDelete;$preDeleteInputUnchanged=$true
  if($case -ceq 'final-cell-moved'){$preDeleteMatches[0].y=188}
  if($case -ceq 'selection-moved'){$selectionYs=@(164,165)}
  if((& $deleteCheck) -ne ($case -ceq 'valid')){throw ('Final delete geometry binding disagreed: '+$case)}
}
$pendingDelete=@($ast.FindAll({param($node)$node -is [Management.Automation.Language.IfStatementAst] -and
  $node.Clauses[0].Item1.Extent.Text -ceq '$mutationAuthority' -and
  $node.Clauses[0].Item2.Extent.Text.Contains('nativeVerificationPending=$true')},$true))
if($pendingDelete.Count -ne 1){throw 'Native delete must hand off exactly one provisional result.'}
$undoKeys=@($ast.FindAll({param($node)$node -is [Management.Automation.Language.InvokeMemberExpressionAst] -and
  $node.Member.Extent.Text -ceq 'SendWait' -and $node.Arguments.Count -eq 1 -and
  $node.Arguments[0] -is [Management.Automation.Language.StringConstantExpressionAst] -and $node.Arguments[0].Value -ceq '^z' -and
  $node.Extent.StartOffset -gt $deleteKeys[0].Extent.EndOffset},$true))
if($undoKeys.Count -ne 1 -or $pendingDelete[0].Extent.EndOffset -ge $undoKeys[0].Extent.StartOffset){throw 'Native pending result must stop before legacy undo.'}
$pendingBlock=[scriptblock]::Create($pendingDelete[0].Extent.Text)
foreach($case in @('duplicate-remains','no-text-remains','wrong-summary')){
  $mutationAuthority=[pscustomobject]@{};$script:emitted=$null;$script:dirty=$true
  $text='Synthetic duplicate';$expectedPage='Synthetic page';$headingAfter=$expectedPage;$sumLabel='Summe';$sumOccurrence=1
  $before='100,00';$expectedBefore=$before;$after='90,00';$expectedAfter=$after;$deleteInputBaseline=10
  $nochDa=$case -ceq 'duplicate-remains';if($case -ceq 'wrong-summary'){$after='80,00'}
  try{& $pendingBlock;throw 'Native delete did not hand off.'}catch{if($_.Exception.Message -cne 'synthetic-emit-stopped'){throw}}
  $pending=$script:emitted
  if(-not $pending.ok -or $pending.verified -ne $false -or $null -ne $pending.geloescht -or $null -ne $pending.nochVorhanden -or
    $pending.PSObject.Properties.Name -ccontains 'rolledBack' -or $pending.PSObject.Properties.Name -ccontains 'rollbackAttempted'){
    throw ('Native delete claimed a result before complete model verification: '+$case)
  }
  if(@($pending.mutationPostProof.PSObject.Properties.Name|Sort-Object) -join ',' -cne 'dirty,inputEpoch,nativeVerificationPending' -or
    $pending.mutationPostProof.nativeVerificationPending -ne $true -or $pending.mutationPostProof.inputEpoch -ne 10 -or
    $pending.mutationPostProof.dirty -ne $true){throw 'Provisional delete lost its strict epoch/dirty handoff.'}
}
$deleteClauses=@($ast.FindAll({param($node)$node -is [Management.Automation.Language.SwitchStatementAst]},$true)|
  ForEach-Object {$_.Clauses}|Where-Object {$_.Item1 -is [Management.Automation.Language.StringConstantExpressionAst] -and $_.Item1.Value -ceq 'table_delete'})
if($deleteClauses.Count -ne 1){throw 'Actual delete operation must be unique.'}
$selectionCalls=@($deleteClauses[0].Item2.FindAll({param($node)$node -is [Management.Automation.Language.InvokeMemberExpressionAst] -and
  $node.Expression.Extent.Text -ceq '$selectionItem' -and $node.Member.Extent.Text -ceq 'Select'},$true))
if($selectionCalls.Count -ne 1){throw 'Delete exclusive selection must be unique.'}
$deleteClicks=@($ast.FindAll({param($node)$node -is [Management.Automation.Language.InvokeMemberExpressionAst] -and
  $node.Member.Extent.Text -ceq 'mouse_event' -and $node.Extent.StartOffset -gt $selectionCalls[0].Extent.EndOffset -and
  $node.Extent.EndOffset -lt $deleteKeys[0].Extent.StartOffset},$true))
if($deleteClicks.Count -ne 2){throw 'Legacy delete click pair changed unexpectedly.'}
$pointerSteps=@($deleteClauses[0].Item2.FindAll({param($node)
  (($node -is [Management.Automation.Language.CommandAst] -and $node.GetCommandName() -cin @('Set-SSECursorPoint','Assert-SSECursorPoint')) -or
   ($node -is [Management.Automation.Language.InvokeMemberExpressionAst] -and $node.Expression.Extent.Text -ceq '$targetElement' -and $node.Member.Extent.Text -ceq 'SetFocus')) -and
  $node.Extent.StartOffset -gt $selectionCalls[0].Extent.EndOffset -and $node.Extent.EndOffset -lt $deleteKeys[0].Extent.StartOffset},$true))
if($pointerSteps.Count -ne 3){throw 'Legacy delete focus/cursor steps changed unexpectedly.'}
foreach($action in (@($deleteClicks)+@($pointerSteps))){
  $parent=$action.Parent;$legacyOnly=$false
  while($parent){
    if($parent -is [Management.Automation.Language.IfStatementAst] -and $parent.Clauses[0].Item1.Extent.Text -ceq '-not $mutationAuthority'){$legacyOnly=$true;break}
    $parent=$parent.Parent
  }
  if(-not $legacyOnly){throw 'Native delete can click an already selected editable cell.'}
}
foreach($phase in @('postDeleteInterference','postCheckInterference')){
  $branches=@($deleteClauses[0].Item2.FindAll({param($node)$node -is [Management.Automation.Language.IfStatementAst] -and
    $node.Clauses[0].Item1.Extent.Text -ceq ('$'+$phase)},$true))
  if($branches.Count -ne 1){throw 'Actual post-shortcut interference branch must be unique.'}
  foreach($native in @($false,$true)){
    $mutationAuthority=$(if($native){[pscustomobject]@{schemaVersion=1}}else{$null})
    $postDeleteInterference=$true;$postCheckInterference=$true;$script:emitted=$null;$nochDa=$true
    $deleteInputBaseline=10;$deleteInputAfter=11;$postCheckInputBefore=10;$postCheckInputAfter=11
    $deleteForegroundAfter=111;$targetPid=7;$hwnd=[IntPtr]111
    $interactionBeforeDelete=[pscustomobject]@{fingerprint=('a'*64)};$interactionAfterDelete=[pscustomobject]@{fingerprint=('b'*64)};$postCheckWindows=$interactionAfterDelete
    try{& ([scriptblock]::Create($branches[0].Extent.Text));throw 'Post-shortcut failure did not stop.'}catch{if($_.Exception.Message -cne 'synthetic-emit-stopped'){throw}}
    $failure=$script:emitted
    if($failure.ok -ne $false -or $failure.mutationStarted -ne $true -or $failure.outcomeUnknown -ne $true -or
      $failure.resultingState -cne 'unknown' -or $failure.reconciliationRequired -ne $true -or $failure.retryable -ne $false -or
      $null -ne $failure.nochVorhanden -or $null -ne $failure.geloescht){throw 'Post-shortcut failure claimed a clean refusal or text-only target presence.'}
  }
}
Write-Output 'table-mutation-target-contract: PASS (complete raw rows, exact focus/selection, no native delete click or text-only undo, strict pending handoff)'
