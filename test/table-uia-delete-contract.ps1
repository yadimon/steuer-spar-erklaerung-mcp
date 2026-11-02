param([string]$Repo=(Join-Path $PSScriptRoot '..'))
$ErrorActionPreference='Stop'
. (Join-Path $Repo 'powershell/table-grid-read.ps1')
. (Join-Path $Repo 'powershell/table-uia-delete.ps1')
$actualTableFocus=(Get-Command Assert-SSEUiaDeleteTableFocus).ScriptBlock
$actualOwnEditor=(Get-Command Close-SSEUiaDeleteOwnEditor).ScriptBlock
# All input endpoints below are scalar recorders. No UIA/Win32 assembly or
# desktop is loaded, and no API or product process is started.
Add-Type @'
using System;
using System.Collections.Generic;
namespace Windows {public class Point {public Point(int x,int y){}}}
namespace Windows.Automation {
 public static class ControlType {public static string DataItem="DataItem",Table="Table",DataGrid="DataGrid",Edit="Edit",ComboBox="ComboBox",Spinner="Spinner",Window="Window",Header="Header",HeaderItem="HeaderItem";}
 public static class AutomationElement {public static object FocusedElement,Hit;public static object FromPoint(Windows.Point point){if(SW.ForeignTickDuringPoint)SW.Tick++;if(SW.MoveCursorDuringPoint)SW.CursorX=999;return Hit;}}
 public class ValuePattern {public static object Pattern=new object();}
 public class SelectionItemPattern {
  public static object Pattern=new object();public SelectionInfo Current=new SelectionInfo();
  public static int Selects,Removes;public void Select(){Selects++;}public void RemoveFromSelection(){Removes++;Current.IsSelected=false;}
 }
 public class SelectionInfo {public bool IsSelected;}
 public class EditorRect {public bool IsEmpty;public double X=100,Y=100,Width=100,Height=20;}
 public class EditorInfo {public int ProcessId;public string ControlType,AutomationId;public bool IsOffscreen,HasKeyboardFocus;public EditorRect BoundingRectangle=new EditorRect();}
 public class EditorNode {
  public EditorInfo Current=new EditorInfo();public string Id;public EditorNode Parent;
  public List<EditorNode> Children=new List<EditorNode>();
  public EditorNode(string id,string type,string aid,int pid){Id=id;Current.ControlType=type;Current.AutomationId=aid;Current.ProcessId=pid;}
  public string[] GetRuntimeId(){return Id.Split('.');}
 }
 public class TreeWalker {
  public static TreeWalker RawViewWalker=new TreeWalker();
  public EditorNode GetFirstChild(EditorNode node){return node.Children.Count==0?null:node.Children[0];}
  public EditorNode GetNextSibling(EditorNode node){if(node.Parent==null)return null;int i=node.Parent.Children.IndexOf(node);return i>=0&&i+1<node.Parent.Children.Count?node.Parent.Children[i+1]:null;}
  public EditorNode GetParent(EditorNode node){return node.Parent;}
 }
}
namespace Windows.Forms {
 public static class SendKeys {
  public static List<string> Calls=new List<string>();
  public static object EscapeFocus,AfterDeleteFocus,AfterUndoFocus;
  public static void SendWait(string keys){Calls.Add(keys);SW.Tick++;if(keys=="{ESC}")Windows.Automation.AutomationElement.FocusedElement=EscapeFocus;if(keys=="^+{DEL}"&&AfterDeleteFocus!=null)Windows.Automation.AutomationElement.FocusedElement=AfterDeleteFocus;if(keys=="^z"&&AfterUndoFocus!=null)Windows.Automation.AutomationElement.FocusedElement=AfterUndoFocus;if(SW.LoseFocusAfterDelete&&keys=="^+{DEL}")SW.Foreground=new IntPtr(99);}
 }
}
public static class SW {
 public class RC {public int L=0,T=0,R=1000,B=1000;}
 public static int ProcessId;public static ulong Tick=10;public static IntPtr Foreground=new IntPtr(1);public static bool LoseFocusAfterDelete;
 public static int Clicks,CursorX,CursorY;public static bool ForeignTickDuringPoint,MoveCursorDuringPoint;
 public static bool IsWindow(IntPtr hwnd){return hwnd==new IntPtr(1);}
 public static IntPtr GetForegroundWindow(){return Foreground;}
 public static int GetWindowThreadProcessId(IntPtr hwnd,out int pid){pid=ProcessId;return 1;}
 public static uint GetDoubleClickTime(){return 0;}
 public static bool GetWindowRect(IntPtr hwnd,out RC rect){rect=new RC();return true;}
 public static void keybd_event(int a,int b,int c,IntPtr d){Tick++;}
 public static void mouse_event(int a,int b,int c,int d,IntPtr e){Tick++;if(a==4)Clicks++;}
}
'@
function Assert($Condition,[string]$Message){if(-not $Condition){throw $Message}}
function Same($Actual,$Expected,[string]$Message){if(($Actual|ConvertTo-Json -Depth 15 -Compress) -cne ($Expected|ConvertTo-Json -Depth 15 -Compress)){throw $Message}}
function Arg($Arguments,$Name,$Default=$null){if($Arguments.ContainsKey($Name)){$Arguments[$Name]}else{$Default}}
function Get-SSELastInputTick {[SW]::Tick}
function Test-SSELastInputUnchanged($Epoch){$null -ne $Epoch -and $Epoch -eq [SW]::Tick}
function Get-SSEInteractionWindowSet {if($script:tickDuringWindowInventory){[SW]::Tick++};[pscustomobject]@{fingerprint=$(if($script:windowSetChanged){'synthetic-changed-window-set'}else{'synthetic-fixed-window-set'});windows=@([pscustomobject]@{role='main';hwnd=1})} }
function Show-SSEWindow {
 if($script:activationEditor){[Windows.Automation.AutomationElement]::FocusedElement=$script:activationEditor}
 if($script:activationInput){[SW]::Tick++}
}
function Test-SSEScalarEqual($Left,$Right){[string]$Left -ceq [string]$Right}
function Set-SSEForegroundLeaseInputCheckpoint { }
function Get-SSEPointObstruction {[pscustomobject]@{isBoundTarget=$true}}
function Set-SSECursorPoint {param($X,$Y) [SW]::CursorX=$X;[SW]::CursorY=$Y;[SW]::Tick++}
function Assert-SSECursorPoint {param($X,$Y) if([SW]::CursorX -ne $X -or [SW]::CursorY -ne $Y){throw 'synthetic-cursor-drift'}}
function Test-SSETableFocusedSource {param($Hwnd,$ProcessId,$Tree,$TableAid,$TableRid,[switch]$AllowPositionNameSource,[ref]$FailureReason,[ref]$PositionNameProof) if($script:raiseCaptureSentinel){throw [InvalidOperationException]::new($script:SSE_CAPTURE_SENTINEL)};$script:sourceAllowed}
function Wait-SSEUiaDeleteRows { }
function Get-SSEUiaDeleteCell {
 param($State,[int]$ProcessId,[int]$Row,[int]$Column)
 Assert ($Row -eq 1 -and $Column -eq 0) 'Fixture target cell used the wrong model row or column.'
 $script:target
}
function Assert-SSEUiaDeleteSelection {param($State,$ProcessId,$Row,$Column,[switch]$RequireUnselected,[switch]$SelectionOnly)
 if($script:selectionFails -and -not $RequireUnselected){throw 'synthetic-selection-refused'}
 if(-not $RequireUnselected -and -not $SelectionOnly){$script:selectionProofs++;if($script:interfereFinalSelection -and $script:selectionProofs -eq 2){[SW]::Tick++}}
 if($script:selectionProofs -eq 2 -and $script:changeWindowsFinalSelection){$script:windowSetChanged=$true}
 if($script:selectionProofs -eq 2 -and $script:tickInFinalInventory){$script:tickDuringWindowInventory=$true}
}
function Assert-SSEUiaDeleteTableFocus {param($State,$ProcessId)
 if($script:undoFocusFails -and $script:reads -ge 6){throw 'synthetic-undo-focus-unbound'}
 & $actualTableFocus $State $ProcessId
 if($script:reads -ge 6){$script:undoFocusProofs++;if($script:interfereFinalUndo -and $script:undoFocusProofs -eq 2){[SW]::Tick++}}
}
function Close-SSEUiaDeleteOwnEditor {param($Binding,$Before,$Clicked,$Row,$Column,[int]$RemovedRow=-1,[switch]$ExistingNumberEditor) & $actualOwnEditor $Binding $Before $Clicked $Row $Column -RemovedRow $RemovedRow -ExistingNumberEditor:$ExistingNumberEditor}
function Read-SSEUiaDeleteState {
 param($Binding,[switch]$AllowOwnEditor)
 if(-not (Test-SSEUiaDeleteEpoch $Binding)){throw 'synthetic-provider-epoch-lost'}
 $script:reads++
 if($script:editorMismatch -and $script:reads -eq 1){
  $Binding.transaction.editorEvidence=[pscustomobject]@{rawEditorCount=1;focusAdded=$true}
  throw 'The exact table contains an unaccounted editor.'
 }
 $duration=$(if($script:reads -eq $script:slowRead){20000.0}else{1.0})
 $Binding.maxReadMs=[Math]::Max($Binding.maxReadMs,$duration)
 $Binding.maxRawMs=$(if($script:reads -eq $script:slowRawRead){2600.0}else{[Math]::Max($Binding.maxRawMs,1.0)})
 if($script:reads -eq $script:failRead){throw 'synthetic-provider-failure'}
 if($script:reads -gt $script:states.Count){throw 'Unexpected read beyond fixture'}
 $state=$script:states[$script:reads-1]
 if(-not $AllowOwnEditor -and $state.editors.Count){throw 'The exact table contains an unaccounted editor.'}
 $state
}
$script:target=[pscustomobject]@{Current=[pscustomobject]@{ProcessId=0;ControlType='DataItem';IsOffscreen=$false;HasKeyboardFocus=$true;AutomationId='Synthetic.Table';BoundingRectangle=[pscustomobject]@{IsEmpty=$false;X=100.0;Y=100.0;Width=100.0;Height=20.0}}}
$script:target|Add-Member ScriptMethod TryGetCurrentPattern {param($Pattern,[ref]$Result)$Result.Value=New-Object Windows.Automation.SelectionItemPattern;return $true}
$script:target|Add-Member ScriptMethod GetRuntimeId {@('Cell',1)}
function Focus([string]$Type='Table',[string]$Rid='Table.1',[string]$Aid='Synthetic.Table',[int]$ProcessId=[SW]::ProcessId){
 $node=[pscustomobject]@{rid=$Rid;Current=[pscustomobject]@{ControlType=$Type;ProcessId=$ProcessId;HasKeyboardFocus=$true;IsOffscreen=$false;AutomationId=$Aid;
  BoundingRectangle=$script:target.Current.BoundingRectangle}}
 $node|Add-Member ScriptMethod GetRuntimeId {$this.rid.Split('.')};$node
}
function Model([string[]]$Rows){
 $structure='synthetic-complete-grid';$key=$structure+'|'+(ConvertTo-Json -InputObject @($Rows) -Compress)
 [pscustomobject]@{structure=$structure;rows=[int]$Rows.Count;rowKeys=@($Rows);key=$key;fingerprint=(Get-SSEGridLogicalFingerprint $key)}
}
function State($Model,[string]$Summary='300,00',[bool]$Dirty=$false){
 $cells=@(for($row=0;$row -lt $Model.rows;$row++){[pscustomobject]@{row=$row;column=0;name=$(if($Model.rowKeys[$row] -ceq 'input-slot'){''}else{'Duplicate'});rid=('Cell.'+$row);semantic=[pscustomobject]@{type='text'}}})
 [pscustomobject]@{model=$Model;summary=$Summary;dirty=$Dirty;root=[pscustomobject]@{i=10;aid='Synthetic.Table';rid='Table.1'};
  scan=[pscustomobject]@{rows=$Model.rows;columns=1;cells=$cells;headers=@([pscustomobject]@{visible=$true;rect=[pscustomobject]@{y=10;height=20}})};
  table=[pscustomobject]@{Current=[pscustomobject]@{BoundingRectangle=[pscustomobject]@{X=0;Y=0;Width=500;Height=800}}};
  summaryAid='Synthetic.Summary';tree=$null;editors=@();inputState=[pscustomobject]@{ok=$true;editorFree=$true;editorNodes=@()}}
}
$before=Model @('alpha-complete-row','beta-complete-row','input-slot');$removed=Model @('alpha-complete-row','input-slot')
function Run($After,$Restored=$null,[string]$ExpectedAfter='100,00',[int]$FailRead=0,[switch]$NoRid,[switch]$RefuseSource,[switch]$RefuseSelection,[switch]$Interference,[switch]$RefuseUndoFocus,[switch]$ToggleTarget,[switch]$HiddenTarget,[switch]$Clipped,[switch]$WrongPoint,[switch]$InterfereFinalSelection,[switch]$InterfereFinalUndo,[switch]$InterferePoint,[switch]$MovePointCursor,[int]$SlowRead=0,[bool]$InitialDirty=$false,[switch]$PostEditor,[switch]$AmbiguousEditorCell,[switch]$MissingEditorCell,[switch]$MissingEditorRid,[switch]$ChangedEditorValue,[int]$SlowRawRead=0,[switch]$EditorAfterUndo,[switch]$IndependentCellAid,[switch]$ChangeWindowsFinalSelection,[switch]$TickInFinalInventory,[string]$ActivationScenario=''){
 $prefix=@((State $before '300,00' $InitialDirty),(State $before '300,00' $InitialDirty),(State $before '300,00' $InitialDirty),(State $before '300,00' $InitialDirty))
 [Windows.Forms.SendKeys]::AfterDeleteFocus=$null
 if($PostEditor){
  $closedAfter=State $After.model $After.summary $After.dirty
  $editor=Editor ([string]$After.scan.cells[1].name)
  if($ChangedEditorValue){$editor.valuePattern.Current.Value='Changed editor value'}
  $After.editors=@($editor)
  $node=[pscustomobject]@{type='DataItem';p=10;aid='Synthetic.Table';rid='Cell.1';x=100.0;y=100.0;w=100.0;h=20.0}
  if($IndependentCellAid){$node.aid='Synthetic.Independent.Cell'}
  $After.tree=[pscustomobject]@{nodes=@($node)}
  if($AmbiguousEditorCell){$After.tree.nodes+=@([pscustomobject]@{type='DataItem';p=10;aid='Synthetic.Table';rid='Cell.0';x=100.0;y=100.0;w=100.0;h=20.0})}
  if($MissingEditorCell){$After.tree.nodes=@()}
  if($MissingEditorRid){$node.rid='Missing.Rid'}
  $script:states=$prefix+@($After,$closedAfter,$closedAfter)
  [Windows.Forms.SendKeys]::AfterDeleteFocus=$editor
 }else{$script:states=$prefix+@($After,$After)}
 if($Restored){$script:states+=@($Restored)}
 $script:activationEditor=$null;$script:activationInput=$false
 if($ActivationScenario){
  $editor=Editor 'Duplicate';$active=$script:states[1];$active.editors=@($editor)
  $active.tree=[pscustomobject]@{nodes=@([pscustomobject]@{type='DataItem';p=10;aid='Synthetic.Table';rid='Cell.1';x=100.0;y=100.0;w=100.0;h=20.0})}
  $closed=State $before '300,00' $InitialDirty
  $script:states=@($script:states[0],$active,$closed)+@($script:states|Select-Object -Skip 2)
  foreach($state in $script:states){$state.scan.headers[0]|Add-Member NoteProperty name 'Nr.' -Force}
  $script:activationEditor=$editor
  switch($ActivationScenario){
   'unchanged' { }
   'changed-value' {$editor.valuePattern.Current.Value='Uncommitted input'}
   'changed-dirty' {$active.dirty=-not $InitialDirty}
   'changed-model' {$active.model=Model @('changed-alpha','beta-complete-row','input-slot')}
   'changed-root' {$active.root.rid='Other.Table'}
   'other-column' {$active.scan.headers[0].name='Amount'}
   'hidden-column' {$active.scan.headers[0].visible=$false}
   'hidden-editor' {$editor.Current.IsOffscreen=$true}
   'foreign-focus' {$editor.Current.ProcessId=999}
   'combo-editor' {$editor.Current.ControlType='ComboBox'}
   'ambiguous-cell' {$active.tree.nodes+=@($active.tree.nodes[0])}
   'missing-cell' {$active.tree.nodes[0].rid='Unknown.Cell'}
   'foreign-input' {$script:activationInput=$true}
   'unmapped-pre-existing' {$script:states[0].editors=@($editor)}
   'not-closed' {$closed.editors=@($editor)}
   default {throw 'Unknown activation scenario.'}
  }
 }
 if($script:initialEditorScenario){
  $editor=Editor 'Duplicate';$initial=$script:states[0];$initial.editors=@($editor)
  $initial.tree=[pscustomobject]@{nodes=@([pscustomobject]@{type='DataItem';p=10;aid='Synthetic.Table';rid='Cell.1';x=100.0;y=100.0;w=100.0;h=20.0})}
  $closed=State $before '300,00' $InitialDirty
  $script:states=@($initial,$closed)+@($script:states|Select-Object -Skip 1)
  foreach($state in $script:states){$state.scan.headers[0]|Add-Member NoteProperty name 'Nr.' -Force}
  switch($script:initialEditorScenario){
   'unchanged' { }
   'changed-value' {$editor.valuePattern.Current.Value='Uncommitted input'}
   'other-column' {$initial.scan.headers[0].name='Amount'}
   'hidden-column' {$initial.scan.headers[0].visible=$false}
   'hidden-editor' {$editor.Current.IsOffscreen=$true}
   'combo-editor' {$editor.Current.ControlType='ComboBox'}
   'ambiguous-cell' {$initial.tree.nodes+=@($initial.tree.nodes[0])}
   'missing-cell' {$initial.tree.nodes[0].rid='Unknown.Cell'}
   'not-closed' {$closed.editors=@($editor)}
   'background' { }
   'runtime-id-drift' {
     $editor|Add-Member NoteProperty runtimeReads 0
     $editor|Add-Member ScriptMethod GetRuntimeId {$this.runtimeReads++;@('Editor',[string]($this.runtimeReads%2))} -Force
   }
   default {throw 'Unknown initial editor scenario.'}
  }
 }
 $script:reads=0;$script:failRead=$FailRead;$script:sourceAllowed=-not $RefuseSource;$script:selectionFails=[bool]$RefuseSelection
 $script:undoFocusFails=[bool]$RefuseUndoFocus
 $script:interfereFinalSelection=[bool]$InterfereFinalSelection;$script:interfereFinalUndo=[bool]$InterfereFinalUndo
 $script:selectionProofs=0;$script:undoFocusProofs=0;$script:slowRead=$SlowRead
 $script:slowRawRead=$SlowRawRead;$script:SSE_CURSOR_PRESERVE_UNPROVEN_FOCUS=$false
 $script:windowSetChanged=$false;$script:tickDuringWindowInventory=$false;$script:changeWindowsFinalSelection=[bool]$ChangeWindowsFinalSelection;$script:tickInFinalInventory=[bool]$TickInFinalInventory
 if($ToggleTarget){$script:states[0].scan.cells[1].semantic.type='boolean'}
 if($HiddenTarget){$script:states[0].scan.headers[0].visible=$false}
 [Windows.Forms.SendKeys]::Calls.Clear();[SW]::Tick=10;[SW]::Foreground=[IntPtr]1;[SW]::Clicks=0;[SW]::LoseFocusAfterDelete=[bool]$Interference
 [SW]::ForeignTickDuringPoint=[bool]$InterferePoint;[SW]::MoveCursorDuringPoint=[bool]$MovePointCursor
 [Windows.Automation.SelectionItemPattern]::Selects=0;[Windows.Automation.SelectionItemPattern]::Removes=0
 $a=@{text='Duplicate';expectedPage='Synthetic page';sumLabel='Synthetic sum';sumOccurrence=1;expectedBefore='300,00';expectedAfter=$ExpectedAfter}
 if(-not $NoRid){$a.targetRid='Cell.1'}
 $process=[Diagnostics.Process]::GetCurrentProcess();[SW]::ProcessId=$process.Id
 $script:target.Current.ProcessId=$process.Id;[Windows.Automation.AutomationElement]::Hit=$script:target
 $script:target.Current.BoundingRectangle.Y=$(if($Clipped){5.0}else{100.0})
 [Windows.Automation.AutomationElement]::FocusedElement=$(if($script:initialEditorScenario){$editor}else{Focus})
 if($script:initialEditorScenario -ceq 'background'){[SW]::Foreground=[IntPtr]99}
 [Windows.Forms.SendKeys]::EscapeFocus=Focus
 [Windows.Forms.SendKeys]::AfterUndoFocus=$(if($EditorAfterUndo){Focus 'Edit' 'Other.Editor' 'Other.Editor'}else{$null})
 if($WrongPoint){[Windows.Automation.AutomationElement]::Hit=Focus 'DataItem' 'Other.cell'}
 try{$result=Invoke-SSEUiaTableDelete ([IntPtr]1) $process.Id $a $process}finally{$process.Dispose()}
 [pscustomobject]@{result=$result;keys=@([Windows.Forms.SendKeys]::Calls);reads=$script:reads;clicks=[SW]::Clicks;focusPreserved=$script:SSE_CURSOR_PRESERVE_UNPROVEN_FOCUS}
}
$script:editorMismatch=$true
$diagnosed=Run (State $removed '100,00' $true)
$script:editorMismatch=$false
Same $diagnosed.result.error 'The exact table contains an unaccounted editor.' 'Diagnostics replaced the original editor refusal.'
Same $diagnosed.result.phase 'initial' 'The editor refusal lost its transaction phase.'
Same $diagnosed.result.mutationState.editorMismatch ([pscustomobject]@{rawEditorCount=1;focusAdded=$true}) 'The refusal dropped its value-free editor observations.'
Same $diagnosed.result.mutationStarted $false 'An editor observation began deletion.'
Same $diagnosed.result.outcomeUnknown $false 'A pre-input editor refusal became an unknown mutation.'
Same $diagnosed.result.resultingState 'unchanged' 'The diagnosed no-input refusal claimed changed state.'
Same $diagnosed.keys @() 'Editor diagnostics dispatched keyboard input.'
Same $diagnosed.clicks 0 'Editor diagnostics clicked a row.'
$success=Run (State $removed '100,00' $true)
Assert $success.result.ok 'Exact one-row deletion was not accepted.'
Same $success.keys @('^+{DEL}') 'A successful deletion was replayed or undone.'
Same $success.result.mutationPostProof.outcome 'deleted-exact' 'Complete model proof missing.'
$zero=Run (State $removed '300,00' $true) -ExpectedAfter '300,00'
Assert $zero.result.ok 'Equal before/after summary hid a verified zero-amount deletion.'
Same $zero.keys @('^+{DEL}') 'Zero-amount deletion triggered undo.'
$unchanged=Run (State $before)
Same $unchanged.result.outcomeUnknown $true 'A lack of observed removal claimed consumed input.'
Same $unchanged.result.geloescht $null 'A timed-out observation claimed a known deletion outcome.'
Same $unchanged.keys @('^+{DEL}') 'An ineffective command undid an older action.'
$rollback=Run (State $removed '200,00' $true) (State $before)
Same $rollback.result.resultingState 'restored' 'Exact full restoration was not accepted.'
Same $rollback.result.rolledBack $true 'Verified restoration lost its flag.'
Same $rollback.keys @('^+{DEL}','^z') 'Owned exact removal must authorize exactly one undo.'
$ineffective=Run (State $removed '200,00' $true) (State $removed '300,00' $false)
Same $ineffective.result.outcomeUnknown $true 'A remaining duplicate and old sum hid an ineffective undo.'
Same $ineffective.result.rolledBack $null 'An ineffective undo claimed successful restoration.'
Same $ineffective.keys @('^+{DEL}','^z') 'An ineffective undo was repeated.'
foreach($wrong in @((Model @('beta-complete-row','input-slot')),(Model @('changed-alpha','input-slot')),(Model @('alpha-complete-row')))){
 $rejected=Run (State $wrong '100,00' $true)
 Same $rejected.result.outcomeUnknown $true 'Wrong or multiple-row removal was accepted.'
 Same $rejected.keys @('^+{DEL}') 'An unexpected full model triggered blind undo.'
}
$dirty=Run (State $before '300,00' $true)
Same $dirty.result.outcomeUnknown $true 'Changed dirty state was accepted as unchanged.'
Same $dirty.keys @('^+{DEL}') 'Unexpected dirty change authorized undo.'
$reordered=Run (State $removed '200,00' $true) (State (Model @('beta-complete-row','alpha-complete-row','input-slot')))
Same $reordered.result.rolledBack $null 'Rows restored in another order were accepted.'
$readFailure=Run (State $removed '100,00' $true) -FailRead 5
Same $readFailure.result.outcomeUnknown $true 'A failed post-read claimed a known result.'
Same $readFailure.keys @('^+{DEL}') 'A failed read retried or undid the write.'
$interference=Run (State $removed '100,00' $true) -Interference
Same $interference.result.outcomeUnknown $true 'Focus interference after dispatch was hidden.'
Same $interference.keys @('^+{DEL}') 'Focus interference authorized blind undo.'
$ambiguous=Run (State $removed '100,00' $true) -NoRid
Same $ambiguous.result.mutationStarted $false 'Ambiguous caller text began a mutation.'
Same $ambiguous.result.outcomeUnknown $false 'A pre-action refusal lost its known no-dispatch result.'
Same $ambiguous.keys @() 'Ambiguous caller text dispatched input.'
Same $ambiguous.clicks 0 'Ambiguous caller text clicked a row.'
$source=Run (State $removed '100,00' $true) -RefuseSource
Same $source.keys @() 'An unproven source received a delete shortcut.'
Same $source.clicks 0 'An unproven editor source was committed by a click.'
$selection=Run (State $removed '100,00' $true) -RefuseSelection
Same $selection.keys @() 'A failed final selection proof dispatched deletion.'
Same $selection.clicks 1 'The selection fixture did not reach the actual own click boundary.'
$undoFocus=Run (State $removed '200,00' $true) (State $before) -RefuseUndoFocus
Same $undoFocus.result.outcomeUnknown $true 'Unbound undo focus was hidden.'
Same $undoFocus.keys @('^+{DEL}') 'An unrelated widget received the table undo command.'
$toggle=Run (State $removed '100,00' $true) -ToggleTarget
Same $toggle.clicks 0 'A checkbox target was clicked before rejecting it.'
Same $toggle.keys @() 'A checkbox target dispatched deletion.'
Same $toggle.result.outcomeUnknown $false 'A pre-action checkbox refusal was mislabeled.'
$hidden=Run (State $removed '100,00' $true) -HiddenTarget
Same $hidden.clicks 0 'A hidden target was clicked.'
Same $hidden.result.outcomeUnknown $false 'A pre-action hidden-column refusal was mislabeled.'
$clipped=Run (State $removed '100,00' $true) -Clipped
Same $clipped.clicks 0 'A clipped row overlapping the header was clicked.'
Same $clipped.keys @() 'A clipped row dispatched deletion.'
$point=Run (State $removed '100,00' $true) -WrongPoint
Same $point.clicks 0 'A root-bound point on another cell was clicked.'
Same $point.keys @() 'Another hit cell dispatched deletion.'
$lateSelection=Run (State $removed '100,00' $true) -InterfereFinalSelection
Same $lateSelection.keys @() 'Input during the final UIA selection proof was captured as our own delete input.'
$lateWindows=Run (State $removed '100,00' $true) -ChangeWindowsFinalSelection
Same $lateWindows.keys @() 'A changed window inventory after the final UIA proof dispatched deletion.'
$inventoryInput=Run (State $removed '100,00' $true) -TickInFinalInventory
Same $inventoryInput.keys @() 'Input during window inventory was hidden after the first cheap guard.'
$lateUndo=Run (State $removed '200,00' $true) (State $before) -InterfereFinalUndo
Same $lateUndo.keys @('^+{DEL}') 'Input during the final UIA undo-focus proof was ignored.'
$latePoint=Run (State $removed '100,00' $true) -InterferePoint
Same $latePoint.clicks 0 'Input during FromPoint was overwritten by the own-click checkpoint.'
$movedCursor=Run (State $removed '100,00' $true) -MovePointCursor
Same $movedCursor.clicks 0 'The cursor moved after the earlier cursor proof and still received mouse-down.'
$initialBudget=Run (State $removed '100,00' $true) -SlowRead 1
Same $initialBudget.clicks 0 'An oversized observed read budget activated or clicked the table.'
Same $initialBudget.result.mutationStarted $false 'Insufficient initial read budget began deletion.'
$finalBudget=Run (State $removed '100,00' $true) -SlowRead 4
Same $finalBudget.keys @() 'A slow final read dispatched deletion without enough readback/undo reserve.'
Same $finalBudget.result.kind 'uia-delete-budget' 'The post-preparation budget refusal lost its specific reason.'
Same $finalBudget.result.outcomeUnknown $false 'A complete unchanged pre-delete frame lost its no-dispatch outcome.'
$script:SSE_CAPTURE_OPERATION_RESULT=$true;$script:SSE_CAPTURE_SENTINEL='synthetic-capture-sentinel';$script:raiseCaptureSentinel=$true;$captured=$false
try{$null=Run (State $removed '100,00' $true)}catch{if($_.Exception.Message -cne $script:SSE_CAPTURE_SENTINEL){throw};$captured=$true}
finally{$script:raiseCaptureSentinel=$false;$script:SSE_CAPTURE_OPERATION_RESULT=$false}
Assert $captured 'A composed operation result sentinel was swallowed by transaction error normalization.'

# Exercise the actual focus proof independently of the transaction provider.
$state=State $before
foreach($focus in @((Focus),(Focus 'DataItem' 'Cell.1'))){[Windows.Automation.AutomationElement]::FocusedElement=$focus;& $actualTableFocus $state ([SW]::ProcessId)}
foreach($focus in @((Focus 'Edit' 'Cell.1'),(Focus 'Table' 'Other.table'),(Focus 'Table' 'Table.1' 'Other.Aid'),(Focus 'Table' 'Table.1' 'Synthetic.Table' 999),$null)){
 [Windows.Automation.AutomationElement]::FocusedElement=$focus;$refused=$false
 try{& $actualTableFocus $state ([SW]::ProcessId)}catch{$refused=$true}
 Assert $refused 'An editor, foreign table/process or absent focus authorized table undo.'
}

# Actual raw reader: the focused editor has an exact upward table chain but
# is deliberately omitted from downward provider children, as Qt can do.
$table=New-Object Windows.Automation.EditorNode('Table.1','Table','Synthetic.Table',[SW]::ProcessId)
$viewport=New-Object Windows.Automation.EditorNode('Viewport.1','Group','Synthetic.Viewport',[SW]::ProcessId);$viewport.Parent=$table
$editorNode=New-Object Windows.Automation.EditorNode('Editor.1','Edit','Synthetic.Table.editor',[SW]::ProcessId);$editorNode.Parent=$viewport
[Windows.Automation.AutomationElement]::FocusedElement=$editorNode
$raw=Get-SSEUiaDeleteRawEditors $table ([SW]::ProcessId) {$true} 128
Same $raw.Count 1 'The active editor omitted by downward enumeration was not detected.'
Same ($raw[0].GetRuntimeId() -join '.') 'Editor.1' 'The upward reader bound another editor.'
$observation=@{}
$observedRaw=Get-SSEUiaDeleteRawEditors $table ([SW]::ProcessId) {$true} 128 $observation
Same $observedRaw.Count 1 'Editor diagnostics changed the raw editor inventory.'
Same $observation.descendantCount 0 'An upward-only editor was labelled as a descendant.'
Same $observation.focusAdded $true 'The omitted focused editor lost its observation source.'
Same $observation.focusDepth 2 'The focused editor lost its exact upward table depth.'
$editorNode.Current.HasKeyboardFocus=$true
$snapshotEvidence=[pscustomobject]@{ok=$true;editorFree=$true;editorNodes=@()}
$visibleEvidence=Get-SSEUiaDeleteEditorEvidence $snapshotEvidence $observedRaw $observation
Same $visibleEvidence.rawEditorCount 1 'A visible omitted editor lost its evidence count.'
Same $visibleEvidence.firstEditor.offscreen $false 'A visible editor was labelled offscreen.'
Same $visibleEvidence.firstEditor.hasKeyboardFocus $true 'The editor focus observation was lost.'
Same $visibleEvidence.firstEditor.positiveBounds $true 'A visible editor lost its positive bounds observation.'
$editorNode.Current.IsOffscreen=$true;$editorNode.Current.HasKeyboardFocus=$false;$editorNode.Current.BoundingRectangle.IsEmpty=$true
$hiddenObservation=@{}
$hiddenRaw=Get-SSEUiaDeleteRawEditors $table ([SW]::ProcessId) {$true} 128 $hiddenObservation
Same $hiddenRaw.Count 1 'A hidden editor with the exact focused ancestry disappeared from the inventory.'
Same $hiddenObservation.descendantCount 0 'A hidden focused editor was labelled as a visible descendant.'
Same $hiddenObservation.focusAdded $true 'The hidden focused editor lost its observation source.'
Same $hiddenObservation.focusDepth 2 'The hidden focused editor lost its exact table depth.'
$hiddenEvidence=Get-SSEUiaDeleteEditorEvidence $snapshotEvidence $hiddenRaw $hiddenObservation
Same $hiddenEvidence.firstEditor.offscreen $true 'An offscreen editor was labelled visible.'
Same $hiddenEvidence.firstEditor.hasKeyboardFocus $false 'An unfocused editor was labelled focused.'
Same $hiddenEvidence.firstEditor.boundsEmpty $true 'Empty editor geometry was lost.'
Assert (-not (Test-SSEUiaDeleteEditorAgreement $snapshotEvidence $hiddenRaw)) 'Diagnostics authorized a hidden pre-existing editor.'
foreach($evidence in @($visibleEvidence,$hiddenEvidence)){
 $text=$evidence|ConvertTo-Json -Depth 6 -Compress
 Assert (-not $text.Contains('Synthetic.') -and -not $text.Contains('Editor.1') -and -not $text.Contains('Table.1')) 'Editor evidence leaked an automation identity.'
 foreach($property in $evidence.firstEditor.PSObject.Properties){Assert ($property.Value -is [bool]) 'Editor evidence contains a non-boolean provider value.'}
}
$editorNode.Current.IsOffscreen=$false;$editorNode.Current.BoundingRectangle.IsEmpty=$false
$staleEditor=[pscustomobject]@{}
$staleEditor|Add-Member ScriptProperty Current {throw 'synthetic-sensitive-provider-error'}
$staleEvidence=Get-SSEUiaDeleteEditorEvidence $snapshotEvidence @($staleEditor) $observation
Same $staleEvidence.observationIncomplete $true 'A stale diagnostic provider replaced the refusal.'
Assert (-not ($staleEvidence|ConvertTo-Json -Depth 6 -Compress).Contains('synthetic-sensitive-provider-error')) 'A raw provider error escaped into editor evidence.'
$partialInformation=[pscustomobject]@{ControlType='Edit';HasKeyboardFocus=$true;BoundingRectangle=$editorNode.Current.BoundingRectangle}
$partialInformation|Add-Member ScriptProperty IsOffscreen {throw 'synthetic-partial-provider-error'}
$partialEvidence=Get-SSEUiaDeleteEditorEvidence $snapshotEvidence @([pscustomobject]@{Current=$partialInformation}) $observation
Same $partialEvidence.observationIncomplete $true 'A failed provider property was silently projected as false.'
Same $partialEvidence.firstEditor $null 'A partially stale provider produced misleading editor flags.'
Assert (-not ($partialEvidence|ConvertTo-Json -Depth 6 -Compress).Contains('synthetic-partial-provider-error')) 'A partial getter failure leaked provider text.'
[Windows.Automation.AutomationElement]::FocusedElement=$null
for($index=0;$index -lt 2500;$index++){$cell=New-Object Windows.Automation.EditorNode(('Cell.'+$index),'DataItem','Synthetic.Table',[SW]::ProcessId);$cell.Parent=$table;$table.Children.Add($cell)}
Same (Get-SSEUiaDeleteRawBound 1000 100) 101228 'The largest raw bound differs from the actual Grid dimensions.'
Same (Get-SSEUiaDeleteRawBound 0 7) 135 'An empty Grid lost its header/editor margin.'
$largeEditors=Get-SSEUiaDeleteRawEditors $table ([SW]::ProcessId) {$true} (Get-SSEUiaDeleteRawBound 300 7)
Same $largeEditors.Count 0 'A valid large model was restricted by the former 2048-element ceiling.'
Assert (Test-SSEUiaDeleteBudget 10000 1000 8 100) 'A well-bounded cold read was refused.'
Assert (-not (Test-SSEUiaDeleteBudget 50000 1500 4 100)) 'Remaining reads were allowed without the fixed settling margin.'
Assert (-not (Test-SSEUiaDeleteBudget 60000 1 1 1)) 'An expired transaction got a new reserve.'
Assert (-not (Test-SSEUiaDeleteBudget 0 ([double]::NaN) 4 1)) 'An invalid duration authorized a write.'
Assert (-not (Test-SSEUiaDeleteBudget 0 6000 8 2500)) 'A raw walk too close to its own deadline authorized mutation.'
Assert (Test-SSEUiaDeleteBudget 0 6000 8 2499) 'Raw headroom below the explicit threshold was refused.'
$script:slowRawGuardCalls=0;$rawExpired=$false
try{$null=Get-SSEUiaDeleteRawEditors $table ([SW]::ProcessId) {$script:slowRawGuardCalls++;Start-Sleep -Milliseconds 25;$true} (Get-SSEUiaDeleteRawBound 300 7)}
catch{$rawExpired=$true}
Assert $rawExpired 'The actual raw reader ignored its elapsed-time budget.'
Assert ($script:slowRawGuardCalls -lt $table.Children.Count) 'The raw timeout completed an unbounded slow walk first.'
$snapshot=[pscustomobject]@{ok=$true;editorFree=$true;editorNodes=@()}
Assert (Test-SSEUiaDeleteEditorAgreement $snapshot @()) 'A complete editor-free state was refused.'
Assert (-not (Test-SSEUiaDeleteEditorAgreement $snapshot $raw)) 'An existing raw editor was treated as absent.'
Assert (Test-SSEUiaDeleteEditorAgreement $snapshot $raw -AllowOwnEditor) 'A single raw-only delegate was not available for exact ownership proof.'
$snapshot.editorFree=$false;$snapshot.editorNodes=@([pscustomobject]@{rid='Other.Editor';aid='Other.Aid';type='Custom'})
Assert (-not (Test-SSEUiaDeleteEditorAgreement $snapshot $raw -AllowOwnEditor)) 'A snapshot-only unknown editor authorized Escape.'
Assert (-not (Test-SSEUiaDeleteEditorAgreement $snapshot @() -AllowOwnEditor)) 'A non-free snapshot with no raw editor authorized Select.'

function Editor([string]$Value='Duplicate'){
 $node=Focus 'Edit' 'Editor.own' 'Synthetic.Table.editor'
 $current=[pscustomobject]@{IsReadOnly=$false;storedValue=$Value;reads=0}
 $current|Add-Member ScriptProperty Value {$this.reads++;if($script:interfereCancelRead -and $this.reads -eq 2){[SW]::Tick++};$this.storedValue} {param($Value)$this.storedValue=$Value}
 $node|Add-Member NoteProperty valuePattern ([pscustomobject]@{Current=$current})
 $node|Add-Member ScriptMethod TryGetCurrentPattern {param($Pattern,[ref]$Result)$Result.Value=$this.valuePattern;return $true}
 $node
}
function Cancel($Change=$null,[switch]$AfterDelete,[switch]$InterfereFinalProof,[switch]$ChangeAfterEscape){
 $prior=State $before;$next=$(if($AfterDelete){State $removed '100,00' $true}else{State $before})
 $editor=Editor $(if($AfterDelete){''}else{'Duplicate'});$next.editors=@($editor)
 if($Change){& $Change $prior $next $editor}
 [Windows.Automation.AutomationElement]::FocusedElement=$editor;[Windows.Forms.SendKeys]::EscapeFocus=Focus
 [Windows.Forms.SendKeys]::Calls.Clear();[SW]::Foreground=[IntPtr]1;$script:undoFocusFails=$false;$script:selectionFails=$false
 $script:windowSetChanged=$false;$script:tickDuringWindowInventory=$false
 $script:interfereCancelRead=[bool]$InterfereFinalProof
 $script:states=@($(if($AfterDelete){State $removed '100,00' $true}else{State $before}));$script:reads=0;$script:failRead=0
 if($ChangeAfterEscape){$script:states[0].dirty=-not $script:states[0].dirty}
 $binding=[pscustomobject]@{guard=$null;maxReadMs=1.0;maxRawMs=1.0;processId=[SW]::ProcessId;hwnd=[IntPtr]1;
  transaction=[pscustomobject]@{epoch=[SW]::Tick;windows=(Get-SSEInteractionWindowSet);touched=$false}}
 $binding.guard={Test-SSELastInputUnchanged $binding.transaction.epoch}.GetNewClosure()
 $error=$null;$result=$null
 try{$result=& $actualOwnEditor $binding $prior $next 1 0 -RemovedRow $(if($AfterDelete){1}else{-1})}catch{$error=$_}
 [pscustomobject]@{result=$result;failed=[bool]$error;keys=@([Windows.Forms.SendKeys]::Calls)}
}
$script:target.Current.BoundingRectangle.Y=100.0
$cancelled=Cancel
Assert (-not $cancelled.failed) 'The exact new unchanged clicked-cell editor could not be cancelled.'
Same $cancelled.keys @('{ESC}') 'Own editor cancellation was repeated or changed values.'
$postEditor=Cancel -AfterDelete
Assert (-not $postEditor.failed) 'An exact new post-removal editor with unchanged cell value could not be cancelled.'
Same $postEditor.keys @('{ESC}') 'Post-delete editor cancellation was replayed.'
foreach($post in @($false,$true)){
 $late=Cancel -AfterDelete:$post -InterfereFinalProof
 Assert $late.failed 'Input during the final editor value proof was hidden.'
 Same $late.keys @() 'A late input epoch change dispatched Escape.'
 $changedAfter=Cancel -AfterDelete:$post -ChangeAfterEscape
 Assert $changedAfter.failed 'Changed dirty state after Escape claimed complete preservation.'
 Same $changedAfter.keys @('{ESC}') 'The dirty-change fixture must reach exactly one own cancellation.'
}
foreach($change in @(
 {param($prior,$next,$editor)$editor.valuePattern.Current.Value='Changed text'},
 {param($prior,$next,$editor)$editor.Current.ProcessId=999},
 {param($prior,$next,$editor)$editor.Current.ControlType='ComboBox'},
 {param($prior,$next,$editor)$editor.Current.AutomationId='Other.Editor'},
 {param($prior,$next,$editor)$editor.Current.HasKeyboardFocus=$false},
 {param($prior,$next,$editor)$next.dirty=$true},
 {param($prior,$next,$editor)$prior.editors=@($editor)},
 {param($prior,$next,$editor)$next.editors=@($editor,$editor)},
 {param($prior,$next,$editor)$next.inputState.editorFree=$false;$next.inputState.editorNodes=@([pscustomobject]@{rid='Other.Editor';aid='Other.Aid'})}
)){
 $blocked=Cancel $change;Assert $blocked.failed 'An unowned or changed editor was cancelled.'
 Same $blocked.keys @() 'Unproven editor ownership dispatched Escape.'
}
$script:interfereCancelRead=$false
foreach($change in @(
 {param($prior,$next,$editor)$editor.valuePattern.Current.Value='Changed text'},
 {param($prior,$next,$editor)$editor.Current.ProcessId=999},
 {param($prior,$next,$editor)$editor.Current.ControlType='ComboBox'},
 {param($prior,$next,$editor)$editor.Current.AutomationId='Other.Editor'},
 {param($prior,$next,$editor)$editor.Current.HasKeyboardFocus=$false},
 {param($prior,$next,$editor)$next.model=$prior.model},
 {param($prior,$next,$editor)$next.model=Model @('beta-complete-row','input-slot')},
 {param($prior,$next,$editor)$next.model=Model @('input-slot')},
 {param($prior,$next,$editor)$next.scan.cells[1].semantic.type='boolean'},
 {param($prior,$next,$editor)$next.inputState.editorFree=$false;$next.inputState.editorNodes=@([pscustomobject]@{rid='Other.Editor';aid='Other.Aid'})}
)){
 $blocked=Cancel $change -AfterDelete;Assert $blocked.failed 'An unproven post-removal editor was cancelled.'
 Same $blocked.keys @() 'Invalid post-removal ownership sent Escape.'
}
$postSuccess=Run (State $removed '100,00' $true) -PostEditor
Assert $postSuccess.result.ok 'The actual transaction did not complete after its exactly bound post-delete editor.'
Same $postSuccess.keys @('^+{DEL}','{ESC}') 'Post-delete cancellation did not happen exactly once before success.'
$postRollback=Run (State $removed '200,00' $true) (State $before) -PostEditor
Same $postRollback.result.rolledBack $true 'Post-delete cancellation lost the exact guarded undo path.'
Same $postRollback.keys @('^+{DEL}','{ESC}','^z') 'The post-editor rollback path replayed an action.'
foreach($case in @(
 @{after=(State (Model @('beta-complete-row','input-slot')) '100,00' $true);args=@{}},
 @{after=(State $before);args=@{}},
 @{after=(State $removed '100,00' $true);args=@{AmbiguousEditorCell=$true}},
 @{after=(State $removed '100,00' $true);args=@{MissingEditorCell=$true}},
 @{after=(State $removed '100,00' $true);args=@{MissingEditorRid=$true}},
 @{after=(State $removed '100,00' $true);args=@{ChangedEditorValue=$true}}
)){
 $args=$case.args;$blocked=Run $case.after -PostEditor @args
 Same $blocked.result.outcomeUnknown $true 'An unexpected post-delete model or cell mapping was accepted.'
 Same $blocked.keys @('^+{DEL}') 'Unproven post-delete state dispatched Escape or undo.'
}
foreach($case in @(
 @{before=$false;deleted=$false;restored=$false;expected=$true},
 @{before=$false;deleted=$false;restored=$true;expected=$false},
 @{before=$false;deleted=$true;restored=$false;expected=$true},
 @{before=$false;deleted=$true;restored=$true;expected=$true},
 @{before=$true;deleted=$false;restored=$false;expected=$false},
 @{before=$true;deleted=$false;restored=$true;expected=$true},
 @{before=$true;deleted=$true;restored=$false;expected=$false},
 @{before=$true;deleted=$true;restored=$true;expected=$true},
 @{before=$false;deleted=$true;restored='false';expected=$false}
)){
 Same (Test-SSEUiaDeleteRestoredDirty $case.before $case.deleted $case.restored) $case.expected 'Dirty restoration accepted an unexplained transition or unreadable flag.'
}
$dirtyRestored=Run (State $removed '200,00' $true) (State $before '300,00' $true)
Same $dirtyRestored.result.rolledBack $true 'Complete observed values were mislabeled unknown solely because the own delete left the dirty marker set.'
Same $dirtyRestored.result.ungespeichertVorher $false 'The original dirty flag was not reported.'
Same $dirtyRestored.result.ungespeichertNachher $true 'The remaining dirty marker was hidden.'
Same $dirtyRestored.result.dirtyStateUnchanged $false 'Changed application dirty state was claimed unchanged.'
$dirtyCleared=Run (State $removed '200,00' $true) (State $before) -InitialDirty $true
Same $dirtyCleared.result.outcomeUnknown $true 'Clearing a pre-existing dirty marker claimed a known full restoration.'
Same $dirtyCleared.result.rolledBack $null 'An unexplained dirty clear claimed rollback.'
$rawReserve=Run (State $removed '100,00' $true) -SlowRawRead 1
Same $rawReserve.clicks 0 'An initial raw walk near its deadline activated the target.'
$finalRawReserve=Run (State $removed '100,00' $true) -SlowRawRead 4
Same $finalRawReserve.keys @() 'A late raw walk near its deadline dispatched deletion.'
$undoEditor=Run (State $removed '200,00' $true) (State $before) -EditorAfterUndo
Same $undoEditor.result.outcomeUnknown $true 'An outside editor after Undo was released as a restored passive source.'
Assert $undoEditor.focusPreserved 'An unproven post-Undo focus was not preserved for cleanup.'
$ownCellAid=Run (State $removed '100,00' $true) -PostEditor -IndependentCellAid
Assert $ownCellAid.result.ok 'A correctly bound post-delete cell was rejected because its AutomationId differed from the table.'
foreach($initialDirty in @($false,$true)){
 $activated=Run (State $removed '100,00' $true) -ActivationScenario 'unchanged' -InitialDirty $initialDirty
 Assert $activated.result.ok 'An unchanged Nr. editor created by this request activation blocked deletion.'
 Same $activated.keys @('{ESC}','^+{DEL}') 'Activation must cancel exactly one owned unchanged editor, then delete once.'
 Same $activated.clicks 1 'Activation editor handling added a target click or repeated selection.'
}
foreach($scenario in @('changed-value','changed-dirty','changed-model','changed-root','other-column','hidden-column','hidden-editor','foreign-focus','combo-editor','ambiguous-cell','missing-cell','foreign-input','unmapped-pre-existing')){
 $blockedActivation=Run (State $removed '100,00' $true) -ActivationScenario $scenario
 Assert (-not $blockedActivation.result.ok) ('Unproven activation editor was accepted: '+$scenario)
 Same $blockedActivation.keys @() ('Unproven activation dispatched input: '+$scenario)
 Same $blockedActivation.clicks 0 ('Unproven activation clicked the deletion target: '+$scenario)
 if($scenario -ceq 'unmapped-pre-existing'){Assert ($blockedActivation.result.error -match 'no unique observed cell') 'Unmapped pre-existing editor failed for an unexpected reason.'}
}
$stillEditing=Run (State $removed '100,00' $true) -ActivationScenario 'not-closed'
 Assert (-not $stillEditing.result.ok) 'Unconfirmed editor closure proceeded to deletion.'
 Same $stillEditing.keys @('{ESC}') 'An unconfirmed own closure was replayed or followed by deletion.'
 Same $stillEditing.clicks 0 'Unconfirmed activation editor closure clicked the target.'
foreach($initialDirty in @($false,$true)){
 $script:initialEditorScenario='unchanged'
 $initialEditor=Run (State $removed '100,00' $true) -InitialDirty $initialDirty
 Assert $initialEditor.result.ok 'An existing unchanged Nr. delegate blocked deletion.'
 Same $initialEditor.keys @('{ESC}','^+{DEL}') 'An existing unchanged Nr. delegate was cancelled or deleted more than once.'
}
foreach($scenario in @('changed-value','other-column','hidden-column','hidden-editor','combo-editor','ambiguous-cell','missing-cell','background','runtime-id-drift')){
 $script:initialEditorScenario=$scenario
 $blocked=Run (State $removed '100,00' $true)
 Assert (-not $blocked.result.ok) ('An unproven existing editor was accepted: '+$scenario)
 Same $blocked.keys @() ('An unproven existing editor received input: '+$scenario)
 Same $blocked.clicks 0 ('An unproven existing editor allowed a deletion click: '+$scenario)
}
$script:initialEditorScenario='not-closed'
$stillOpen=Run (State $removed '100,00' $true)
Assert (-not $stillOpen.result.ok) 'An existing Nr. delegate with unconfirmed closure proceeded to deletion.'
Same $stillOpen.keys @('{ESC}') 'An unconfirmed existing Nr. delegate closure was replayed.'
$script:initialEditorScenario=$null
$script:target.Current.BoundingRectangle.X=0.0
$missingBounds=Cancel {param($prior,$next,$editor)
 $editor.Current.BoundingRectangle=[pscustomobject]@{IsEmpty=$false;X=$null;Y=100.0;Width=100.0;Height=20.0}
}
Assert $missingBounds.failed 'An unreadable editor coordinate was treated as zero.'
Same $missingBounds.keys @() 'An unreadable editor geometry authorized Escape.'
$script:target.Current.BoundingRectangle.X=100.0
Write-Output 'UIA delete transaction: exact and zero removal, ineffective command, full/failed undo, wrong rows, provider failure, focus interference and no replay passed.'
