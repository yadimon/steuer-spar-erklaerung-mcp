$ErrorActionPreference='Stop'
$workerPath=Join-Path $PSScriptRoot '..\powershell\sse-worker.ps1'
$launcherPath=Join-Path $PSScriptRoot '..\powershell\run-on-desktop.ps1'
$ast=[Management.Automation.Language.Parser]::ParseFile($workerPath,[ref]$null,[ref]$null)
$launch=@($ast.FindAll({param($n) $n -is [Management.Automation.Language.SwitchStatementAst]},$true) |
  ForEach-Object {$_.Clauses} | Where-Object {$_.Item1.Extent.Text -ceq "'launch'"})
if($launch.Count -ne 1){throw 'Productive launch branch not unique.'}
$launchText=$launch[0].Item2.Extent.Text
$body=[scriptblock]::Create($launchText.Substring(1,$launchText.Length-2))
Add-Type -TypeDefinition @'
using System;
using System.Text;
using System.Runtime.InteropServices;
public static class DSK {
 [StructLayout(LayoutKind.Sequential)] public struct SI {public int cb,flags;public short show;public string desktop;}
 public struct PI {public IntPtr hProcess,hThread;public int pid,tid;}
 public static int Calls,Closed;public static bool Fail;public static uint Flags;public static string App,Command,Directory;
 public static bool CreateProcess(string app,StringBuilder cmd,IntPtr pa,IntPtr ta,bool inherit,uint flags,IntPtr env,string dir,ref SI si,out PI pi){
  Calls++;App=app;Command=cmd.ToString();Directory=dir;Flags=flags;
  if(inherit || si.flags!=1 || si.show!=1 || si.desktop!=null)throw new Exception("Unsafe startup, desktop override or inherited handles");
  pi=new PI();if(Fail)return false;pi.pid=7;pi.hProcess=new IntPtr(101);pi.hThread=new IntPtr(102);return true;
 }
 public static bool CloseHandle(IntPtr handle){if(handle.ToInt64()!=101 && handle.ToInt64()!=102)throw new Exception("Unowned handle");Closed++;return true;}
 public static IntPtr[] Windows=new IntPtr[0];
 public static IntPtr[] ListDesktopWindows(IntPtr desktop){return Windows;}
 public static int DesktopCloses;
 public static IntPtr OpenDesktop(string name,int flags,bool inherit,uint access){
  if(name!="SyntheticOwned" || flags!=0 || inherit || access!=0x10000000)throw new Exception("Unowned desktop open");
  return new IntPtr(1);
 }
 public static bool CloseDesktop(IntPtr desktop){if(desktop.ToInt64()!=1)throw new Exception("Unowned desktop close");DesktopCloses++;return true;}
}
public static class SW {
 public static int WorkerPid;
 public static uint GetWindowThreadProcessId(IntPtr hwnd,out int pid){pid=hwnd.ToInt64()==300?WorkerPid:(hwnd.ToInt64()==100?7:8);return 1;}
 public static bool IsWindowVisible(IntPtr hwnd){return hwnd.ToInt64()!=400;}
 public static int GetWindowTextW(IntPtr hwnd,StringBuilder title,int size){title.Append("Synthetic peer");return title.Length;}
}
'@
function Get-SSEStartModeType {param($Mode) if($Mode -cne 'einur'){throw 'Unexpected mode.'}}
function Assert-SSEExecutable {param($Exe) $script:validated++;[pscustomobject]@{path='C:\synthetic\SSE.exe'}}
function Get-SSECaseIdentity {param($File,$Mode) $script:validated++;[pscustomobject]@{path='C:\synthetic\a case.Gew2025'}}
function Start-Process {param($FilePath,$ArgumentList,$WindowStyle,[switch]$PassThru) $script:ordinary++;[pscustomobject]@{Id=8}}
function Emit {param($Result) $script:result=$Result;throw 'captured'}
function Fail {param($Message,$Kind,$Details) $script:result=[pscustomobject]@{ok=$false;kind=$Kind;mutationStarted=$Details.mutationStarted;resultingState=$Details.resultingState;details=$Details};throw 'captured'}
function Invoke-LaunchScenario([bool]$Persistent,[bool]$Rejected){
  $a=[pscustomobject]@{mode='einur';file='a case'};$script:SSE_DEFAULT_EXE='configured'
  $PersistentGuiChild=$Persistent;$script:result=$null;$script:ordinary=0;$script:validated=0
  [DSK]::Calls=0;[DSK]::Closed=0;[DSK]::Fail=$Rejected
  try {& $body}catch{if($_.Exception.Message -ne 'captured'){throw}}
  if($script:validated -ne 2){throw 'GUI start bypassed executable or case validation.'}
  [pscustomobject]@{result=$script:result;calls=[DSK]::Calls;closed=[DSK]::Closed;ordinary=$script:ordinary;flags=[DSK]::Flags;
    app=[DSK]::App;command=[DSK]::Command;directory=[DSK]::Directory}
}
$persistent=Invoke-LaunchScenario $true $false
if($persistent.result.pid -ne 7 -or $persistent.calls -ne 1 -or $persistent.flags -ne 0x01000000 -or
  $persistent.closed -ne 2 -or $persistent.ordinary -ne 0 -or $persistent.app -cne 'C:\synthetic\SSE.exe' -or
  $persistent.command -cne '"C:\synthetic\SSE.exe" -meinur "C:\synthetic\a case.Gew2025"' -or
  $persistent.directory -cne 'C:\synthetic'){throw 'Persistent GUI creation evidence differs from the validated command.'}
$ordinary=Invoke-LaunchScenario $false $false
if($ordinary.result.pid -ne 8 -or $ordinary.calls -ne 0 -or $ordinary.ordinary -ne 1){throw 'Ordinary visible start changed.'}
$rejected=Invoke-LaunchScenario $true $true
if($rejected.result.ok -ne $false -or $rejected.result.kind -cne 'launch-error' -or $rejected.result.mutationStarted -ne $false -or
  $rejected.result.resultingState -cne 'unchanged' -or $rejected.calls -ne 1 -or $rejected.closed -ne 0 -or $rejected.ordinary -ne 0){throw 'Rejected explicit creation retried or lost its no-start evidence.'}
$launcherAst=[Management.Automation.Language.Parser]::ParseFile($launcherPath,[ref]$null,[ref]$null)
$base=@($launcherAst.FindAll({param($n) $n -is [Management.Automation.Language.AssignmentStatementAst] -and $n.Left.Extent.Text -ceq '$jobBasic.LimitFlags'},$true) | Where-Object {$_.Right.Extent.Text -ceq '0x00002000'})
$checks=@($launcherAst.FindAll({param($n) $n -is [Management.Automation.Language.IfStatementAst] -and $n.Clauses[0].Item1.Extent.Text -ceq '$Op -ieq ''launch'''},$true))
if($base.Count -ne 1 -or $checks.Count -ne 2){throw 'Launcher persistence boundary not unique.'}
foreach($case in @(@{op='launch';flags=0x2800;persistent=$true},@{op='LAUNCH';flags=0x2800;persistent=$true},
  @{op='launch_probe';flags=0x2000;persistent=$false},@{op='table_update';flags=0x2000;persistent=$false},@{op='health';flags=0x2000;persistent=$false})){
  $Op=$case.op;$cmd=New-Object Text.StringBuilder;$jobBasic=[pscustomobject]@{LimitFlags=0}
  & ([scriptblock]::Create($base[0].Extent.Text))
  foreach($check in $checks){& ([scriptblock]::Create($check.Extent.Text))}
  if($jobBasic.LimitFlags -ne $case.flags -or
    ($jobBasic.LimitFlags -band 0x1000) -ne 0 -or $cmd.ToString().Contains('-PersistentGuiChild') -ne $case.persistent){throw 'Other operation or silent child obtained job escape permission.'}
}
$transport=@($ast.FindAll({param($n) $n -is [Management.Automation.Language.FunctionDefinitionAst] -and $n.Name -ceq 'Initialize-SSEWorkerTransport'},$true))
function Resolve-SSEWorkerOutputFile([string]$Path){$script:outputResolved=$Path;return $Path}
. ([scriptblock]::Create($transport[0].Extent.Text))
$PersistentGuiChild=$true;$Op='launch';$OutFile='synthetic-private-output';$B64='';$ArgsFile='';$script:outputResolved=$null
Initialize-SSEWorkerTransport
if($script:outputResolved -cne 'synthetic-private-output'){throw 'Private desktop launch bypassed output validation.'}
foreach($operation in @('launch','health','table_update')){
  $output=& powershell.exe -NoLogo -NoProfile -NonInteractive -File $workerPath -Op $operation -PersistentGuiChild -B64 'e30=' 2>$null
  if($LASTEXITCODE -ne 1 -or ($output | ConvertFrom-Json).kind -cne 'bad-args'){throw 'Persistent switch escaped its private desktop launch transport.'}
}
$prewarmProbe=New-Object Diagnostics.Process
$prewarmProbe.StartInfo=New-Object Diagnostics.ProcessStartInfo
$prewarmProbe.StartInfo.FileName='powershell.exe'
$prewarmProbe.StartInfo.Arguments='-NoLogo -NoProfile -NonInteractive -File "'+$workerPath+'" -Prewarm -PersistentGuiChild'
$prewarmProbe.StartInfo.UseShellExecute=$false;$prewarmProbe.StartInfo.CreateNoWindow=$true
$prewarmProbe.StartInfo.RedirectStandardError=$true;$prewarmProbe.StartInfo.RedirectStandardOutput=$true
try {
  $null=$prewarmProbe.Start()
  if(-not $prewarmProbe.WaitForExit(10000)){$prewarmProbe.Kill();throw 'Prewarm persistent authority did not reject promptly.'}
  if($prewarmProbe.ExitCode -ne 1){throw 'Prewarm parameter set accepted persistent GUI authority.'}
}finally{$prewarmProbe.Dispose()}
foreach($name in @('Get-SSEDesktopPeerWindows','Assert-SSEDesktopHasNoPeers')){
  $definition=@($ast.FindAll({param($n) $n -is [Management.Automation.Language.FunctionDefinitionAst] -and $n.Name -ceq $name},$true))
  if($definition.Count -ne 1){throw 'Productive peer guard is missing.'}
  . ([scriptblock]::Create($definition[0].Extent.Text))
}
[SW]::WorkerPid=$PID
[DSK]::Windows=@([IntPtr]100,[IntPtr]300,[IntPtr]400)
Assert-SSEDesktopHasNoPeers ([IntPtr]1) 7
[DSK]::Windows=@([IntPtr]100,[IntPtr]200,[IntPtr]300,[IntPtr]400)
try{Assert-SSEDesktopHasNoPeers ([IntPtr]1) 7;throw 'Peer stop was accepted.'}catch{if($_.Exception.Message -ne 'captured'){throw}}
if($script:result.kind -cne 'desktop-other-instances' -or $script:result.details.markerBeibehalten -ne $true -or
  @($script:result.details.weitereInstanzen).Count -ne 1 -or $script:result.details.weitereInstanzen[0].pid -ne 8 -or
  $script:result.details.weitereInstanzen[0].hwnd -ne 200){throw 'Peer inventory lost its marker or exact peer binding.'}
$postOpen=@($ast.FindAll({param($n) $n -is [Management.Automation.Language.AssignmentStatementAst] -and $n.Left.Extent.Text -ceq '$peerRecheck'},$true))
$postCheck=@($ast.FindAll({param($n) $n -is [Management.Automation.Language.TryStatementAst] -and $n.Body.Extent.Text.Contains('Assert-SSEDesktopHasNoPeers $peerRecheck')},$true))
$failDefinition=@($ast.FindAll({param($n) $n -is [Management.Automation.Language.FunctionDefinitionAst] -and $n.Name -ceq 'Fail'},$true))
if($postOpen.Count -ne 1 -or $postCheck.Count -ne 1 -or $failDefinition.Count -ne 1){throw 'Productive post-exit peer check is not unique.'}
. ([scriptblock]::Create($failDefinition[0].Extent.Text))
$postBody=[scriptblock]::Create($postOpen[0].Extent.Text+"`n"+$postCheck[0].Extent.Text)
foreach($forced in @($false,$true)){
  $script:DESKTOP_NAME='SyntheticOwned';$ownedPid=7;$beendet=$forced;$antwort='Nein';$antwortMethode='uia-invoke'
  $dialogFehler=$null;$gracefulWaitMs=250;$discard=$true;$hauptfensterVorher=1
  $auxiliaryClosed=@([pscustomobject]@{hwnd=101;closed=$true})
  $script:result=$null;[DSK]::DesktopCloses=0
  try{& $postBody;throw 'Post-exit peer was accepted.'}catch{if($_.Exception.Message -ne 'captured'){throw}}
  if($script:result.kind -cne 'desktop-other-instances' -or $script:result.pid -ne 7 -or
    $script:result.hartBeendet -ne $forced -or $script:result.processExited -ne $true -or
    $script:result.mutationAttempted -ne $true -or $script:result.outcomeUnknown -ne $false -or
    $script:result.desktopMarkeEntfernt -ne $false -or $script:result.markerBeibehalten -ne $true -or
    $script:result.speichernAntwort -cne 'Nein' -or $script:result.antwortMethode -cne 'uia-invoke' -or
    @($script:result.hilfsfenster).Count -ne 1 -or [DSK]::DesktopCloses -ne 1){
    throw 'Post-exit peer refusal lost known process exit, discard evidence or desktop-handle cleanup.'
  }
}
Write-Output 'Desktop GUI launch: explicit breakaway, contained helpers, exact peer guards and preserved post-exit outcomes.'
