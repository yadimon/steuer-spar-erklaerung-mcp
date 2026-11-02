$ErrorActionPreference='Stop'
$menuWorker=Join-Path (Split-Path $PSScriptRoot -Parent) 'powershell/sse-worker.ps1'
$menuAst=[Management.Automation.Language.Parser]::ParseFile($menuWorker,[ref]$null,[ref]$null)
$menuSwitch=@($menuAst.FindAll({param($n)$n -is [Management.Automation.Language.SwitchStatementAst] -and
 @($n.Clauses|Where-Object{$_.Item1.Extent.Text -ceq "'menu_click'"}).Count -eq 1},$true))
if($menuSwitch.Count -ne 1){throw 'Actual menu_click dispatcher is ambiguous.'}
$menuBody=@($menuSwitch[0].Clauses|Where-Object{$_.Item1.Extent.Text -ceq "'menu_click'"})[0].Item2.Extent.Text
Add-Type -TypeDefinition @'
namespace MenuClickContract {
 public sealed class Clock {
  public static long Now;
  private long started;
  public static Clock StartNew(){return new Clock{started=Now};}
  public long ElapsedMilliseconds {get{return Now-started;}}
 }
}
'@
$menuCandidate=$menuBody.Substring(1,$menuBody.Length-2).Replace('[Diagnostics.Stopwatch]','[MenuClickContract.Clock]').Replace('Start-Sleep -Milliseconds','Step-MenuClock -Milliseconds')
function Assert-MenuClick([bool]$Condition,[string]$Message){if(-not $Condition){throw $Message}}
function Invoke-MenuClickCase([string]$Mode,[int]$AppearsAt=0){
 $state=@{mode=$Mode;clicks=0;reads=0;tickReads=0;appearsAt=$AppearsAt;clickArgs=$null;readTimes=(New-Object Collections.ArrayList)}
 [MenuClickContract.Clock]::Now=0
 $a=[pscustomobject]@{name=$(if($Mode -ceq 'generic'){'Synthetic command'}else{'BelegManager'});waitMs=250;hwnd=101}
 function Arg($ArgsObject,[string]$Name,$Default=$null){$p=$ArgsObject.PSObject.Properties[$Name];if($p){return $p.Value};return $Default}
 function Get-SSEBoundedIntegerArg($ArgsObject,$Name,$Default,$Min,$Max){Arg $ArgsObject $Name $Default}
 function Test-Versand {return $false}
 function Assert-SSEDestructiveAcknowledgement {}
 function Resolve-SSEMainWindowDescriptor($Arguments,[switch]$RestoreMinimized){[pscustomobject]@{pid=55;hwnd=101}}
 function Get-SSELastInputTick {$state.tickReads++;return [uint64]37}
 function Get-SSEMenuPopupWindows {return [pscustomobject]@{hwnd=202;pid=55}}
 function Get-SSEOpenMenuEntryMatches {
  [pscustomobject]@{hwnd=[IntPtr]202;node=[pscustomobject]@{rid='menu-item';aid='menu-aid';name=$a.name;type='MenuItem';on=$true;x=20;y=40;w=100;h=20}}
 }
 function Get-LiveElement {return [pscustomobject]@{readable=$true}}
 function Get-DirtyStateFast {return $true}
 function Get-SSEReceiptManagerPolicy {
  if($state.mode -ceq 'policy-error'){throw 'Synthetic unreadable catalogue'}
  [pscustomobject]@{title='BelegManager';classPattern='^Qt\d+QWindowToolSaveBits$'}
 }
 function Click-VerifiedPoint($Window,$Node,$ExpectedInputTick,[string]$ExpectedRuntimeId,[switch]$ThrowOnFailure){
  $state.clicks++;$state.clickArgs=@{window=[int64]$Window;rid=$Node.rid;tick=$ExpectedInputTick;expectedRid=$ExpectedRuntimeId;throws=[bool]$ThrowOnFailure}
  if($state.mode -in @('before-click','after-click','unknown-point-error')){
   $e=[InvalidOperationException]::new('Synthetic point refusal')
   if($state.mode -cne 'unknown-point-error'){$e.Data['kind']='interference';$e.Data['inputDispatched']=($state.mode -ceq 'after-click')}
   throw $e
  }
  [pscustomobject]@{inputTickAfterClick=[uint64]38}
 }
 function Step-MenuClock([int]$Milliseconds){[MenuClickContract.Clock]::Now+=$Milliseconds}
 function Get-Windows {
  $state.reads++;$null=$state.readTimes.Add([MenuClickContract.Clock]::Now)
  if($state.mode -ceq 'read-error'){throw 'Synthetic unreadable windows'}
  $tool=[pscustomobject]@{hwnd=303;pid=55;title='BelegManager';cls='Qt692QWindowToolSaveBits';minimiert=$false;hung=$false}
  switch($state.mode){
   'zero' {return}
   'wrong-pid' {$tool.pid=56}
   'wrong-class' {$tool.cls='Qt692QWindowIcon'}
   'wrong-title' {$tool.title='belegmanager'}
   'minimized' {$tool.minimiert=$true}
   'hung' {$tool.hung=$true}
   'two' {return @($tool,([pscustomobject]@{hwnd=304;pid=55;title='BelegManager';cls=$tool.cls;minimiert=$false;hung=$false}))}
  }
  if([MenuClickContract.Clock]::Now -ge $state.appearsAt){return $tool}
 }
 function Emit($Object){$e=[InvalidOperationException]::new('Menu contract complete');$e.Data['MenuClickResult']=$Object;throw $e}
 function Fail($Message,$Kind='error',$Details=$null){
  $payload=[ordered]@{ok=$false;kind=$Kind;error=$Message}
  foreach($p in @($Details.PSObject.Properties)){$payload[$p.Name]=$p.Value}
  Emit ([pscustomobject]$payload)
 }
 try{& ([scriptblock]::Create($menuCandidate));throw 'Actual menu dispatcher did not emit.'}
 catch{
  if($_.Exception.Data.Contains('MenuClickResult')){return [pscustomobject]@{result=$_.Exception.Data['MenuClickResult'];state=$state;error=$null}}
  return [pscustomobject]@{result=$null;state=$state;error=$_.Exception.Message}
 }
}
# The old dispatcher reports success after its already existing wait expires.
$missing=Invoke-MenuClickCase 'zero'
Assert-MenuClick ($missing.result.ok -eq $false -and $missing.result.kind -ceq 'postcondition-failed') 'A dispatched menu click without its catalogued window must not report success.'
foreach($mode in @('zero','two','wrong-pid','wrong-class','wrong-title','minimized','hung','read-error')){
 $case=Invoke-MenuClickCase $mode
 Assert-MenuClick ($case.result.ok -eq $false -and $case.result.inputDispatched -eq $true -and
  $case.result.outcomeUnknown -eq $true -and $case.result.retryable -eq $false) ('Unknown post-click outcome lost: '+$mode)
 Assert-MenuClick ($case.state.clicks -eq 1) ('A menu action was repeated: '+$mode)
}
foreach($at in @(0,200,250)){
 $case=Invoke-MenuClickCase 'success' $at
 Assert-MenuClick ($case.result.ok -eq $true -and $case.state.clicks -eq 1) 'A unique correctly bound window did not complete the menu action.'
 Assert-MenuClick ($case.state.tickReads -eq 1 -and $case.state.clickArgs.tick -eq 37 -and
  $case.state.clickArgs.expectedRid -ceq 'menu-item' -and $case.state.clickArgs.window -eq 202 -and
  $case.state.clickArgs.throws) 'The exact item RID and original epoch were not passed to the real point helper.'
}
$late=Invoke-MenuClickCase 'success' 251
Assert-MenuClick ($late.result.ok -eq $false -and $late.result.outcomeUnknown -eq $true -and $late.state.clicks -eq 1) 'A window first appearing after the deadline was accepted or clicked again.'
foreach($mode in @('before-click','after-click','unknown-point-error')){
 $case=Invoke-MenuClickCase $mode
 Assert-MenuClick ($case.result.ok -eq $false -and $case.state.clicks -eq 1 -and $case.state.reads -eq 0) 'A refused or unknown point action was followed by more work.'
 Assert-MenuClick ($case.result.outcomeUnknown -eq ($mode -cne 'before-click')) 'Known unsent and unknown sent point actions were conflated.'
}
$policy=Invoke-MenuClickCase 'policy-error'
Assert-MenuClick ($policy.state.clicks -eq 0 -and $policy.error -ceq 'Synthetic unreadable catalogue') 'The receipt policy was first read after physical input.'
$generic=Invoke-MenuClickCase 'generic'
Assert-MenuClick ($generic.result.ok -eq $true -and $generic.state.clicks -eq 1) 'A generic menu entry changed its dispatch contract.'
Write-Output 'Menu click: actual dispatcher, exact item/epoch, bounded window proof and no replay after unknown outcomes passed.'
