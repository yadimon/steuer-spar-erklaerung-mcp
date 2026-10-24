$ErrorActionPreference='Stop'
Add-Type -AssemblyName UIAutomationClient,WindowsBase
. (Join-Path $PSScriptRoot '../powershell/table-boolean.ps1')
$tokens=$null;$errors=$null
$ast=[Management.Automation.Language.Parser]::ParseFile((Join-Path $PSScriptRoot '../powershell/sse-worker.ps1'),[ref]$tokens,[ref]$errors)
if($errors.Count){throw 'Worker parse failed.'}
$definition=@($ast.FindAll({param($n)$n -is [Management.Automation.Language.FunctionDefinitionAst] -and $n.Name -ceq 'Read-SSEToggleState'},$true))
if($definition.Count -ne 1){throw 'No unique production toggle reader.'}
. ([scriptblock]::Create($definition[0].Extent.Text))
Add-Type @'
using System;
public static class SW {
 public static int Entries,Restores;
 public static long Foreground=100;
 public static bool DpiAvailable=true;
 public static IntPtr GetForegroundWindow(){return new IntPtr(Foreground);}
 public static IntPtr EnterPhysicalDpiContext(){if(!DpiAvailable)return IntPtr.Zero;Entries++;return new IntPtr(-1);}
 public static bool RestoreDpiContext(IntPtr previous){Restores++;return previous==new IntPtr(-1);}
}
public static class TableBooleanPoint {
 public static object Element;
 public static object FromPoint(object point){return Element;}
}
'@
$script:AE=[TableBooleanPoint]
$script:WLK=[pscustomobject]@{}
$script:WLK | Add-Member ScriptMethod GetParent {param($Element) $Element.parent}
function Get-SSEPointObstruction($Window,$X,$Y) { $script:lastPoint=@($X,$Y);[pscustomobject]@{isBoundTarget=(-not $script:obstructed)} }
function Get-LiveElement { $script:element }
function Test-SSELastInputUnchanged($Expected) { $Expected -eq $script:tick }
function Get-SSELastInputTick { if($script:nullTick){return $null};$script:tick }
function Start-Sleep {}
function Click-VerifiedPoint {
 [CmdletBinding()]param($Window,$Node,$ExpectedInputTick,[switch]$RequireForeground,[int]$ForegroundAttempts,[string]$ExpectedRuntimeId,[switch]$ThrowOnFailure,$BeforeClickCheck,$BeforeClickBinding)
 if($ExpectedInputTick -ne $script:tick -or -not $RequireForeground -or -not $ThrowOnFailure -or $ForegroundAttempts -ne 1 -or $ExpectedRuntimeId -cne $script:cell.rid){throw 'Click lost its exact input/field binding.'}
 if(-not (& $BeforeClickCheck $Window $BeforeClickBinding 25 32)){throw 'Last checkbox state binding failed.'}
 $script:clicks++;$script:tick++
 if($script:clickError){throw 'Intentional last-point rejection.'}
 $script:current.ToggleState=$script:afterClick
 if($script:loseFocus){[SW]::Foreground=999}
 if($script:moveAfterClick){$script:element.Current.BoundingRectangle=New-Object Windows.Rect(40,20,30,25)}
 [pscustomobject]@{inputTickAfterClick=$(if($script:nullTick){$null}else{$script:tick})}
}
function Reset-Case {
 $script:testInputState=[pscustomobject]@{guard=$true;tick=10}
 $script:DESKTOP_NAME='';$script:tick=10;$script:clicks=0;$script:nullTick=$false;$script:loseFocus=$false
 $script:clickError=$false;$script:moveAfterClick=$false;$script:afterClick='On';$script:patternAvailable=$true
 $script:obstructed=$false
 [SW]::Foreground=100;[SW]::Entries=0;[SW]::Restores=0;[SW]::DpiAvailable=$true
 $script:cell=[pscustomobject]@{rid='row-cell';aid='table';x=10;y=20;w=30;h=25;source='uia'}
 $script:current=[pscustomobject]@{ToggleState='Off'}
 $script:pattern=[pscustomobject]@{Current=$script:current}
 $script:pattern|Add-Member ScriptMethod Toggle {throw 'Programmatic Toggle must not be used as a table write.'}
 $script:element=[pscustomobject]@{Current=[pscustomobject]@{IsEnabled=$true;BoundingRectangle=(New-Object Windows.Rect(10,20,30,25))}}
 $script:element|Add-Member ScriptMethod TryGetCurrentPattern {
  param($Requested,$Output)
  if($Requested -ne [System.Windows.Automation.TogglePattern]::Pattern){throw 'A Boolean cell must never use ValuePattern.'}
  $Output.Value=$script:pattern
  $script:patternAvailable
 }
 $script:pointElement=[pscustomobject]@{parent=$null;rid='row-cell'}
 $script:pointElement|Add-Member ScriptMethod GetRuntimeId {@($this.rid)}
 [TableBooleanPoint]::Element=$script:pointElement
}
function Reject([scriptblock]$Action,[string]$Kind,[int]$Clicks=0) {
 $caught=$null;try{& $Action|Out-Null}catch{$caught=$_}
 if(-not $caught -or $caught.Exception.Data['kind'] -cne $Kind){throw "Expected $Kind, got $caught"}
 if($script:clicks -ne $Clicks){throw 'Unexpected checkbox click/replay count.'}
 if([SW]::Entries -ne [SW]::Restores){throw 'Failed checkbox operation leaked its DPI context.'}
}
Reset-Case
$testInputState=[pscustomobject]@{guard=$true;tick=10}
$noop=Invoke-SSETableBooleanWrite ([IntPtr]100) $script:cell 'false' 'false' $testInputState
if($noop.after -cne 'false' -or $noop.mutationAttempted -or $script:clicks -ne 0 -or [SW]::Entries -ne 0){throw 'A confirmed false state was unnecessarily changed.'}
$written=Invoke-SSETableBooleanWrite ([IntPtr]100) $script:cell 'false' 'true' $testInputState
if($written.after -cne 'true' -or $written.method -cne 'verified-cell-click' -or $script:clicks -ne 1 -or $testInputState.tick -ne 11 -or [SW]::Restores -ne 1){throw 'Typed true transition or own input attribution failed.'}
$script:afterClick='Off'
$restored=Invoke-SSETableBooleanWrite ([IntPtr]100) $script:cell 'true' 'false' $testInputState
if($restored.after -cne 'false' -or $script:clicks -ne 2 -or [SW]::Restores -ne 2){throw 'Typed false/rollback transition failed.'}

Reset-Case
$script:patternAvailable=$false
Reject {Invoke-SSETableBooleanWrite ([IntPtr]100) $script:cell 'false' 'true' $testInputState} 'precondition-failed'
Reset-Case
$script:current.ToggleState='Indeterminate'
Reject {Invoke-SSETableBooleanWrite ([IntPtr]100) $script:cell 'false' 'true' $testInputState} 'precondition-failed'
Reset-Case
Reject {Invoke-SSETableBooleanWrite ([IntPtr]100) $script:cell 'true' 'false' $testInputState} 'precondition-failed'
Reset-Case
$script:DESKTOP_NAME='owned-hidden'
Reject {Invoke-SSETableBooleanWrite ([IntPtr]100) $script:cell 'false' 'true' $testInputState} 'hidden-desktop'
Reset-Case
$testInputState=[pscustomobject]@{guard=$false;tick=10}
Reject {Invoke-SSETableBooleanWrite ([IntPtr]100) $script:cell 'false' 'true' $testInputState} 'interference'
Reset-Case
$testInputState=[pscustomobject]@{guard=$true;tick=$null}
Reject {Invoke-SSETableBooleanWrite ([IntPtr]100) $script:cell 'false' 'true' $testInputState} 'interference'
Reset-Case
$testInputState=[pscustomobject]@{guard=$true;tick=9}
Reject {Invoke-SSETableBooleanWrite ([IntPtr]100) $script:cell 'false' 'true' $testInputState} 'interference'
Reset-Case
$testInputState=[pscustomobject]@{guard=$true;tick=10};[SW]::Foreground=999
Reject {Invoke-SSETableBooleanWrite ([IntPtr]100) $script:cell 'false' 'true' $testInputState} 'interference'
Reset-Case
$script:element.Current.BoundingRectangle=New-Object Windows.Rect(40,20,30,25)
Reject {Invoke-SSETableBooleanWrite ([IntPtr]100) $script:cell 'false' 'true' $testInputState} 'precondition-failed'
Reset-Case
[SW]::DpiAvailable=$false
Reject {Invoke-SSETableBooleanWrite ([IntPtr]100) $script:cell 'false' 'true' $testInputState} 'unsupported'
Reset-Case
$script:afterClick='Off'
Reject {Invoke-SSETableBooleanWrite ([IntPtr]100) $script:cell 'false' 'true' $testInputState} 'postcondition-failed' 1
Reset-Case
$script:afterClick='Indeterminate'
Reject {Invoke-SSETableBooleanWrite ([IntPtr]100) $script:cell 'false' 'true' $testInputState} 'postcondition-failed' 1
Reset-Case
$script:moveAfterClick=$true
Reject {Invoke-SSETableBooleanWrite ([IntPtr]100) $script:cell 'false' 'true' $testInputState} 'postcondition-failed' 1
Reset-Case
$script:nullTick=$true
Reject {Invoke-SSETableBooleanWrite ([IntPtr]100) $script:cell 'false' 'true' $testInputState} 'interference' 1
Reset-Case
$script:loseFocus=$true
Reject {Invoke-SSETableBooleanWrite ([IntPtr]100) $script:cell 'false' 'true' $testInputState} 'interference' 1
Reset-Case
$support=Get-SSETableBooleanWriteSupport ([IntPtr]100) $script:cell 'false' 'true' $testInputState
if(-not $support.ok -or $script:clicks -ne 0 -or [SW]::Entries -ne [SW]::Restores){throw 'Visible checkbox preflight changed input or leaked DPI.'}
$script:pointElement.rid='different-cell'
$support=Get-SSETableBooleanWriteSupport ([IntPtr]100) $script:cell 'false' 'true' $testInputState
if($support.ok -or $support.kind -cne 'offscreen' -or $script:clicks -ne 0){throw 'Partly clipped Qt checkbox was accepted as clickable.'}
$script:obstructed=$true
$support=Get-SSETableBooleanWriteSupport ([IntPtr]100) $script:cell 'false' 'true' $testInputState
if($support.ok -or $support.kind -cne 'obstructed'){throw 'Foreign obstruction was treated as append clipping.'}
Reset-Case
$script:pointElement.parent=[pscustomobject]@{rid='row-cell';parent=$null}
$script:pointElement.parent|Add-Member ScriptMethod GetRuntimeId {@($this.rid)}
$script:pointElement.rid='child'
if(-not (Get-SSETableBooleanWriteSupport ([IntPtr]100) $script:cell 'false' 'true' $testInputState).ok){throw 'A child of the exact checkbox lost its bounded point binding.'}
Reset-Case
$script:pointElement|Add-Member ScriptMethod GetRuntimeId {throw 'Synthetic stale point'} -Force
$support=Get-SSETableBooleanWriteSupport ([IntPtr]100) $script:cell 'false' 'true' $testInputState
if($support.ok -or $support.kind -cne 'stale' -or [SW]::Entries -ne [SW]::Restores){throw 'Unreadable point was treated as a safe append seek.'}
Reset-Case
[TableBooleanPoint]::Element=$null
if((Get-SSETableBooleanWriteSupport ([IntPtr]100) $script:cell 'false' 'true' $testInputState).kind -cne 'stale'){throw 'Null point was treated as append clipping.'}
Reset-Case
$script:current.ToggleState='On'
if((Get-SSETableBooleanWriteSupport ([IntPtr]100) $script:cell 'false' 'true' $testInputState).kind -cne 'precondition-failed'){throw 'Changed checkbox state was accepted for seek.'}
Reset-Case
$script:cell.x=1778;$script:cell.y=691;$script:cell.w=55;$script:cell.h=32
$script:element.Current.BoundingRectangle=New-Object Windows.Rect(1778,691,55,32)
$null=Get-SSETableBooleanWriteSupport ([IntPtr]100) $script:cell 'false' 'true' $testInputState
if(($script:lastPoint -join ',') -cne '1806,707'){throw 'Checkbox point rounding differs from the verified physical click.'}
# Execute the actual append preparation consumer before its first write. The
# final continue only advances the surrounding preparation loop, so omit it.
$add=@($ast.FindAll({param($node) $node -is [Management.Automation.Language.SwitchStatementAst]},$true) |
 ForEach-Object {$_.Clauses | Where-Object {$_.Item1.Extent.Text -ceq "'table_add'"} | ForEach-Object {$_.Item2}})
$togglePrep=@($add[0].FindAll({param($node) $node -is [Management.Automation.Language.IfStatementAst] -and
 $node.Extent.Text.StartsWith('if ($requested -match')},$true))
if($add.Count -ne 1 -or $togglePrep.Count -ne 1){throw 'No unique real append checkbox preparation.'}
$continue=@($togglePrep[0].Clauses[0].Item2.Statements | Where-Object {$_ -is [Management.Automation.Language.ContinueStatementAst]})
if($continue.Count -ne 1){throw 'Unexpected checkbox preparation loop boundary.'}
$preparationText=$togglePrep[0].Extent.Text.Remove($continue[0].Extent.StartOffset-$togglePrep[0].Extent.StartOffset,$continue[0].Extent.Text.Length)
$preparation=[scriptblock]::Create($preparationText)
function Emit($Value){$script:preflightFailure=$Value;throw 'Synthetic preparation stop'}
function Fail($Message,$Kind){throw "$Kind`: $Message"}
foreach($scenario in @('visible','noop','clipped','obstructed','stale','hidden','foreign','unguarded')){
 Reset-Case
 $script:preflightFailure=$null
 $hwnd=[IntPtr]100;$cell=$script:cell;$el=$script:element;$i=4;$requested='true';$toggle=$null
 $guardUserInput=$true;$inputBaseline=10;$prepared=New-Object Collections.ArrayList
 switch($scenario){
  'noop' {$requested='false';$script:pointElement.rid='not-visible'}
  'clipped' {$script:pointElement.rid='not-visible'}
  'obstructed' {$script:obstructed=$true}
  'stale' {$script:pointElement|Add-Member ScriptMethod GetRuntimeId {throw 'Synthetic stale point'} -Force}
  'hidden' {$script:DESKTOP_NAME='owned-hidden'}
  'foreign' {[SW]::Foreground=999}
  'unguarded' {$guardUserInput=$false}
 }
 try{& $preparation}catch{if($_.Exception.Message -cne 'Synthetic preparation stop'){throw}}
 if($script:clicks -ne 0 -or [SW]::Entries -ne [SW]::Restores){throw 'Append preparation performed input or leaked DPI.'}
 if($scenario -cin @('visible','noop')){
  if($prepared.Count -ne 1 -or $prepared[0].mode -cne 'toggle' -or $script:preflightFailure){throw 'Typed checkbox was not prepared without ValuePattern.'}
 }else{
  $failure=$script:preflightFailure
  if(-not $failure -or $prepared.Count -ne 0 -or $failure.mutationStarted -ne $false -or $failure.outcomeUnknown -ne $false -or
     $failure.resultingState -cne 'unchanged' -or $failure.physicalInputAttempted -ne $false -or $failure.physicalInputUsed -ne $false){throw 'Rejected append preparation did not prove its unchanged state.'}
  if(($failure.kind -ceq 'not-found') -ne ($scenario -ceq 'clipped')){throw 'Only a provably unclickable append cell may request the existing guarded seek.'}
  if($scenario -ceq 'clipped' -and -not $failure.error.Contains('Keine freie Tabellenzeile')){throw 'Clipped append lost the exact executor seek trigger.'}
 }
}
Write-Output 'Table checkbox: true/false/no-op, one bound physical click, typed readback, DPI restoration and no uncertain replay checked.'
