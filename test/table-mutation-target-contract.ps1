$ErrorActionPreference='Stop'
. (Join-Path $PSScriptRoot '..\powershell\table-values.ps1')
$source=[IO.File]::ReadAllText((Join-Path $PSScriptRoot '..\powershell\sse-worker.ps1'))
$errors=$null
$ast=[Management.Automation.Language.Parser]::ParseInput($source,[ref]$null,[ref]$errors)
if (@($errors).Count) {throw 'Worker source does not parse.'}
foreach ($name in @('Test-SSEExactProperties','Test-SSETableNumberPolicy','Get-SSETableMutationTargetProof',
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
 public static class AutomationElement {public static object Root;public static object FromHandle(IntPtr h){return Root;}}
 public static class ControlType {public const string Table="Table",DataGrid="DataGrid",DataItem="DataItem",Window="Window";}
 public static class GridItemPattern {public static object Pattern=new object();}
 public static class TogglePattern {public static object Pattern=new object();}
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
  $element=[pscustomobject]@{Current=[pscustomobject]@{Name=$Cell.name;IsEnabled=[bool]($Column -ne 6);BoundingRectangle=[pscustomobject]@{
    X=$Cell.x;Y=$Cell.y;Width=$Cell.w;Height=$Cell.h}};
    grid=[pscustomobject]@{Current=[pscustomobject]@{Row=[int]7;Column=[int]$Column;ContainingGrid=$Container}};
    toggle=$(if ($Column -eq 4) {[pscustomobject]@{Current=[pscustomobject]@{ToggleState='Off'}}} else {$null})}
  $element | Add-Member ScriptMethod TryGetCurrentPattern {
    param($Pattern,$Result)
    if ($Pattern -eq [System.Windows.Automation.GridItemPattern]::Pattern -and $this.grid) {$Result.Value=$this.grid;return $true}
    if ($Pattern -eq [System.Windows.Automation.TogglePattern]::Pattern -and $this.toggle) {$Result.Value=$this.toggle;return $true}
    $false
  }
  $element
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
  'header-x'=@('header-x-equal','cell-schema-geometry',1);'header-width'=@('header-width-equal','cell-schema-geometry',1)
  'table-left'=@('table-left-contained','cell-schema-geometry',0);'table-right'=@('table-right-contained','cell-schema-geometry',6)
  'header-bottom'=@('header-bottom-contained','cell-schema-geometry',0);'live-bounds'=@('live-width-equal','live-metadata',1)
  'live-name'=@('live-name-equal','live-metadata',1);'grid-pattern'=@('grid-pattern-present','grid-pattern',1)
  'grid-absent'=@('grid-present','grid-identity',1);'grid-type'=@('grid-type-bound','grid-identity',0)
  'bad-checkbox-state'=@('toggle-state-valid','toggle',4);'target-disabled'=@('target-enabled','target-capability',2)
  'target-flags'=@('target-flags-enabled-selectable','target-capability',2)
  'target-column'=@('target-column-bound','target-column',6);'target-other-cell'=@('target-rid-equal','target-capability',1)
  'native-column-duplicate'=@('native-column-unique','cell-schema-geometry',1)
  'native-column-order'=@('native-column-order','cell-schema-geometry',1)
  'many-candidates'=@('unique-text-target','target-unique',$null)
  'proof-exception'=@('proof-exception','grid-identity',0)
}
$allowedChecks=@('schema-exact','row-type','row-lower-bound','row-upper-bound','column-type','column-lower-bound','column-upper-bound',
  'text-type','text-present','fingerprint-format','headers-lower-bound','headers-upper-bound','model-cell-count','table-state','editor-free',
  'header-count','unique-text-target','row-cell-count','row-rids-unique','raw-resolve','cell-schema-exact','native-column-type',
  'native-column-lower-bound','native-column-upper-bound','native-column-unique','native-column-order','flags-type','cell-selectable',
  'header-name-equal','header-x-equal','header-width-equal','table-left-contained','table-right-contained','header-bottom-contained',
  'table-bottom-contained','live-x-equal','live-y-equal','live-width-equal','live-height-equal','live-name-equal','grid-pattern-present',
  'grid-row-equal','grid-column-equal','grid-present','grid-pid-equal','grid-type-bound','grid-rid-equal','grid-aid-equal',
  'toggle-state-valid','toggle-pattern-present','toggle-value-equal','display-equal','target-rid-equal','target-display-equal',
  'target-flags-enabled-selectable','target-enabled','target-not-toggle','target-check-state-absent','target-column-bound')
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
      'cell-schema-geometry','live-metadata','grid-pattern','grid-identity','toggle','display','target-capability','target-column')) {
    throw 'Target diagnostic phase contains free text.'
  }
  $safe=[pscustomobject]@{reason=$Proof.reason;diagnostic=$Proof.diagnostic} | ConvertTo-Json -Depth 8 -Compress
  foreach ($forbidden in @($tableAid,'10.1','Target','01.01','10,00',('a'*64),'synthetic-private-exception')) {
    if ($safe.Contains($forbidden)) {throw 'Target diagnostics disclose model values, identities or exception text.'}
  }
}
foreach ($case in @('exact-seven-columns','wrong-row','wrong-column','foreign-grid','grid-rid','grid-aid','other-text','changed-cell',
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
  if ($result.ok -ne ($case -ceq 'exact-seven-columns')) {throw "$case native row/GridItem/checkbox proof disagreed."}
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
$collector=@($ast.FindAll({param($node) $node -is [Management.Automation.Language.FunctionDefinitionAst] -and
  $node.Name -ceq 'Get-SSETableReadOnlyModelCells'},$true))
if ($collector.Count -ne 1) {throw 'Read-only model collector is absent.'}
. ([scriptblock]::Create($collector[0].Extent.Text.Replace('function Get-SSETableReadOnlyModelCells','function Invoke-SyntheticModelCells')))
$RAW=[pscustomobject]@{}
$RAW | Add-Member ScriptMethod GetFirstChild {param($element) if ($element.children.Count) {$element.children[0]} else {$null}}
$RAW | Add-Member ScriptMethod GetNextSibling {
  param($element)
  if (-not $element.parent) {return $null}
  $children=$element.parent.children
  for ($index=0;$index -lt $children.Count;$index++) {if ($children[$index] -eq $element -and $index+1 -lt $children.Count) {return $children[$index+1]}}
  $null
}
foreach ($case in @('disabled-passive','foreign-root-pid','foreign-root-hwnd','foreign-cell','wrong-aid','offscreen','duplicate-rid','missing-rid')) {
  $root=[pscustomobject]@{rid='10.0';parent=$null;children=@();Current=[pscustomobject]@{ProcessId=7;ControlType='Window';NativeWindowHandle=111}}
  $root | Add-Member ScriptMethod GetRuntimeId {$this.rid -split '\.'}
  $nodes=@()
  for ($column=0;$column -lt 7;$column++) {
    $element=New-SyntheticCellElement $baseCells[$column] $null $column
    $element | Add-Member NoteProperty rid $baseCells[$column].rid
    $element | Add-Member NoteProperty parent $root
    $element | Add-Member NoteProperty children @()
    $element | Add-Member ScriptMethod GetRuntimeId {$this.rid -split '\.'}
    $element.Current | Add-Member NoteProperty ProcessId 7
    $element.Current | Add-Member NoteProperty ControlType 'DataItem'
    $element.Current | Add-Member NoteProperty AutomationId $tableAid
    $element.Current | Add-Member NoteProperty IsOffscreen $false
    $nodes+=@($element)
  }
  $root.children=$nodes;$AE::Root=$root
  switch ($case) {
    'foreign-root-pid' {$root.Current.ProcessId=8}
    'foreign-root-hwnd' {$root.Current.NativeWindowHandle=222}
    'foreign-cell' {$nodes[2].Current.ProcessId=8}
    'wrong-aid' {$nodes[2].Current.AutomationId='Other'}
    'offscreen' {$nodes[2].Current.IsOffscreen=$true}
    'duplicate-rid' {$nodes[2].rid=$nodes[1].rid}
    'missing-rid' {$nodes[2].rid='10.99'}
  }
  $proof=Invoke-SyntheticModelCells ([IntPtr]111) 7 $tableAid @($baseCells.rid)
  if ($proof.ok -ne ($case -ceq 'disabled-passive')) {throw "$case bounded fresh passive model row proof disagreed."}
  if ($proof.ok -and ($proof.elements.Count -ne 7 -or $proof.elements[$baseCells[6].rid].Current.IsEnabled)) {
    throw 'Disabled calculated output was omitted or upgraded to an active focus target.'
  }
}
Write-Output 'table-mutation-target-contract: PASS (actual helpers/response, bounded private diagnostics, strict grid/model/context guards)'
