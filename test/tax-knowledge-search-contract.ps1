$ErrorActionPreference = 'Stop'
. (Join-Path $PSScriptRoot '../powershell/tax-knowledge.ps1')
$realKnowledgeCandidates = (Get-Command Get-SSEKnowledgeCandidates).ScriptBlock
$realKnowledgeIdentity = (Get-Command Get-SSEKnowledgeIdentity).ScriptBlock
$realKnowledgePoint = (Get-Command Test-SSEKnowledgePoint).ScriptBlock
$realKnowledgeSnapshot = (Get-Command Read-SSEKnowledgeSnapshot).ScriptBlock
if ($null -ne ('System.Windows.Forms.SendKeys' -as [type])) { throw 'The input contract requires an isolated process without WinForms.' }
Add-Type @'
using System;
using System.Collections.Generic;
public static class SW {
  public static long Foreground=100, Tick=10;
  public static int WindowPid=42, Clicks=0, DpiEntries=0, DpiRestores=0;
  public static bool Visible=true, Iconic=false, Acquire=true, LoseAfterClick=false, DpiAvailable=true, Hung=false;
  public static IntPtr EnterPhysicalDpiContext() { if(!DpiAvailable)return IntPtr.Zero;DpiEntries++;return new IntPtr(-1); }
  public static bool RestoreDpiContext(IntPtr previous) { DpiRestores++;return previous==new IntPtr(-1); }
  public static bool IsWindowVisible(IntPtr value) { return Visible; }
  public static bool IsIconic(IntPtr value) { return Iconic; }
  public static bool IsHungAppWindow(IntPtr value) { return Hung; }
  public static IntPtr GetForegroundWindow() { return (IntPtr)Foreground; }
  public static bool SetForegroundWindow(IntPtr value) { if(Acquire) Foreground=value.ToInt64(); return Acquire; }
  public static uint GetWindowThreadProcessId(IntPtr value, out int pid) { pid=WindowPid; return 1; }
  public static void mouse_event(uint flags,uint x,uint y,uint data,IntPtr extra) {
    Clicks++; Tick++; if(flags==4 && LoseAfterClick) Foreground=999;
  }
}
public sealed class KnowledgeFakeAcc {
  public int Role=42, State=1048580, X=10, Y=20, W=100, H=25;
  public string Name="Suchbegriff";
  public string OverrideValue;
  public string Value { get { return OverrideValue ?? System.Windows.Forms.SendKeys.Value; } }
}
public static class SSEAccessible {
  public static KnowledgeFakeAcc Focused, Hit;
  public static long LastHitHwnd;
  public static object Document;
  public static bool InterfereOnFocus;
  public static int FocusDelayReads;
  public static KnowledgeFakeAcc DescribeDocumentFocus(long hwnd) {
    if(InterfereOnFocus)SW.Tick++;
    Focused.OverrideValue=FocusDelayReads>0 ? "pending" : null;
    if(FocusDelayReads>0)FocusDelayReads--;
    return Focused;
  }
  public static KnowledgeFakeAcc DescribeDocumentHit(long hwnd,int x,int y) { LastHitHwnd=hwnd;return Hit; }
  public static object DescribeDocument(long hwnd,int nodes,int ms,int depth) { return Document; }
}
public sealed class KnowledgeFakeProcess {
  public int Id=42;
  public string Path="C:\\Synthetic\\SteuerBerater.exe", ProcessName="SteuerBerater";
  public DateTime StartTime=new DateTime(2025,1,1,0,0,0,DateTimeKind.Utc);
  public bool Disposed=false, ThrowRefresh=false;
  public void Refresh() { if(ThrowRefresh) throw new InvalidOperationException("Unreadable process"); }
  public void Dispose() { Disposed=true; }
}
namespace System.Windows.Forms {
  public static class SendKeys {
    public static List<string> Keys=new List<string>();
    public static int LoseAfter=0, LoseFieldAfter=0;
    public static bool Uppercase=false;
    public static string Value="";
    public static bool Submitted=false;
    public static string SubmittedTerm=null;
    public static List<string> QueryTerms=new List<string>();
    public static void SendWait(string key) {
      Keys.Add(key); SW.Tick++;
      if(key=="^a") Value="";
      else if(key=="{ENTER}") { Submitted=true;SubmittedTerm=Value;QueryTerms.Add(Value); }
      else Value+=Uppercase ? key.ToUpperInvariant() : key;
      if(LoseAfter!=0 && Keys.Count==LoseAfter) SW.Foreground=999;
      if(LoseFieldAfter!=0 && Keys.Count==LoseFieldAfter) FocusedElsewhere();
    }
    static void FocusedElsewhere() { SSEAccessible.Focused=new KnowledgeFakeAcc { Name="other" }; }
  }
}
'@
if (-not [System.Windows.Forms.SendKeys].GetField('Keys') -or
    [System.Windows.Forms.SendKeys].Assembly.GetName().Name -eq 'System.Windows.Forms') {
  throw 'Real SendKeys must never be used by this contract.'
}
function Fail { param($Message,$Kind) throw "$Kind`: $Message" }
function Arg($Object,[string]$Name,$Default=$null) {
  if ($Object.ContainsKey($Name)) { return $Object[$Name] }; $Default
}
function Get-SSEBoundedIntegerArg($Object,$Name,$Default,$Minimum,$Maximum) {
  $value = Arg $Object $Name $Default
  if ($value -lt $Minimum -or $value -gt $Maximum) { throw 'bad-args' }; [int]$value
}
function Get-SSEWindowTitleText { 'Steuerwissen' }
function Get-SSELastInputTick {
  $script:tickReads++
  if ($script:tickReads -eq $script:nullTickAt) { return $null }
  [SW]::Tick
}
function Test-SSELastInputUnchanged($Expected) { $Expected -eq [SW]::Tick }
function Set-SSECursorPoint { [SW]::Tick++ }
function Assert-SSECursorPoint {}
function ConvertTo-SendKeysLiteral($Text) { & $script:onLiteral; $Text }
function Get-Process {
  [CmdletBinding()]param($Name,$Id)
  $script:fakeProcesses | Where-Object { -not $PSBoundParameters.ContainsKey('Id') -or $_.Id -eq $Id }
}
function Get-SSEKnowledgeWindows { $script:fakeWindows }
function Get-SSEKnowledgeCandidates { $script:candidates }
function Get-SSEKnowledgeIdentity { $script:identity }
function Get-SSEPointObstruction { @{isBoundTarget=$script:unobstructed;hitPid=$script:hitPid;hitWindow=200} }
function Test-SSEKnowledgePoint { $script:exactPoint }
function New-Identity([long]$Hwnd=100,[int]$ProcessId=42) {
  [pscustomobject]@{pid=$ProcessId;hwnd=$Hwnd;title='Steuerwissen';processName='SteuerBerater';startedTicks=500;path='C:\Synthetic\SteuerBerater.exe'}
}
function Reset-Scenario {
  $script:DESKTOP_NAME=''
  $script:candidates=@(New-Identity)
  $script:identity=New-Identity
  $script:unobstructed=$true; $script:exactPoint=$true; $script:hitPid=42
  $script:mode='fresh'; $script:reads=0
  $script:tickReads=0; $script:nullTickAt=-1; $script:onLiteral={}
  $script:baselineText='A previous unrelated paragraph with sufficient length to resemble actual knowledge content.'
  $script:resultText='Alpha is the requested term in a new manufacturer paragraph with sufficient meaningful content.'
  $script:initialCount=1; $script:resultCount=1
  [SW]::Foreground=100; [SW]::Tick=10; [SW]::WindowPid=42; [SW]::Clicks=0
  [SW]::Visible=$true; [SW]::Iconic=$false; [SW]::Acquire=$true; [SW]::LoseAfterClick=$false
  [SW]::Hung=$false
  [SW]::DpiAvailable=$true; [SW]::DpiEntries=0; [SW]::DpiRestores=0
  [System.Windows.Forms.SendKeys]::Keys.Clear()
  [System.Windows.Forms.SendKeys]::LoseAfter=0
  [System.Windows.Forms.SendKeys]::LoseFieldAfter=0; [System.Windows.Forms.SendKeys]::Uppercase=$false
  [System.Windows.Forms.SendKeys]::Value=''; [System.Windows.Forms.SendKeys]::Submitted=$false
  [System.Windows.Forms.SendKeys]::SubmittedTerm=$null; [System.Windows.Forms.SendKeys]::QueryTerms.Clear()
  [SSEAccessible]::Focused=New-Object KnowledgeFakeAcc
  [SSEAccessible]::Hit=New-Object KnowledgeFakeAcc
  [SSEAccessible]::InterfereOnFocus=$false
  [SSEAccessible]::FocusDelayReads=0
}
function Read-SSEKnowledgeSnapshot($Binding) {
  Assert-SSEKnowledgeTarget $Binding
  $script:reads++
  $text=$script:baselineText; $count=$script:initialCount
  $submitted=[System.Windows.Forms.SendKeys]::SubmittedTerm
  if ([System.Windows.Forms.SendKeys]::Submitted -and $script:mode -ne 'stale') {
    $text=$script:resultText; $count=$script:resultCount
    if ($submitted.StartsWith('zzsse')) { $count=0; $text='' }
    if ($submitted -ceq 'Steuer') { $count=1; $text='Steuer is the positive control in a separate confirmed result paragraph.' }
  }
  $views=@([pscustomobject]@{i=0;p=-1;type='Edit';name='Suchbegriff';rid='search';on=$true;x=10;y=20;w=100;h=25;val=[System.Windows.Forms.SendKeys]::Value})
  if ($script:mode -eq 'moved' -and $script:reads -ge 2) { $views[0].x=40 }
  if ($script:mode -eq 'rebound' -and $script:reads -ge 2) { $views[0].rid='other-search' }
  $header="Ihre Suche ergab $count Treffer"
  if ($script:mode -eq 'not-result') { $header='No documents were found for Alpha; this echo is not a confirmed search result.' }
  $views += @(
    [pscustomobject]@{i=1;p=-1;type='Text';name='A long unrelated navigation label must never exhaust the result limit.'},
    [pscustomobject]@{i=10;p=-1;type='Custom';name=''},
    [pscustomobject]@{i=11;p=10;type='Custom';name=''},
    [pscustomobject]@{i=12;p=11;type='Custom';name=''},
    [pscustomobject]@{i=13;p=12;type='Text';name=$header},
    [pscustomobject]@{i=14;p=10;type='List';name=''}
  )
  if ($count -gt 0 -and $script:mode -ne 'empty') {
    $views += @(
      [pscustomobject]@{i=15;p=14;type='ListItem';name=''},
      [pscustomobject]@{i=16;p=15;type='Custom';name=''},
      [pscustomobject]@{i=17;p=16;type='Text';name=$text}
    )
  }
  [pscustomobject]@{views=$views;complete=($script:mode -ne 'incomplete');nodeCount=$views.Count}
}
function Must-Fail([scriptblock]$Action,[string]$Kind,[string]$MessagePart='') {
  $failure=$null
  try { & $Action | Out-Null } catch { $failure=$_ }
  if (-not $failure -or $failure.Exception.Message -notlike "$Kind*" ) { throw "Expected $Kind, got $failure" }
  if ($MessagePart -and -not $failure.Exception.Message.Contains($MessagePart)) { throw "Wrong guard for $Kind`: $failure" }
  if ([SW]::DpiEntries -ne [SW]::DpiRestores) { throw 'A rejected search leaked its physical DPI context.' }
}
function Assert-NoInput {
  if ([SW]::Clicks -ne 0 -or [System.Windows.Forms.SendKeys]::Keys.Count -ne 0) { throw 'Rejected target received physical input.' }
}

Reset-Scenario
$script:fakeProcesses=@(New-Object KnowledgeFakeProcess)
$script:fakeWindows=@(@{Pid=42;Hwnd=100;Title='Steuerwissen'},@{Pid=42;Hwnd=101;Title='Steuerwissen'},@{Pid=42;Hwnd=102;Title='Other'})
$discovered=@(& $realKnowledgeCandidates)
if ($discovered.Count -ne 2 -or -not $script:fakeProcesses[0].Disposed) { throw 'Actual window discovery or process disposal failed.' }
Must-Fail { Select-SSEKnowledgeWindow $discovered $null } 'ambiguous'
if ((Select-SSEKnowledgeWindow $discovered 101).hwnd -ne 101) { throw 'A second window in one process was not selectable.' }
$actualIdentity=& $realKnowledgeIdentity 42
if ($actualIdentity.pid -ne 42 -or $actualIdentity.path -cne 'C:\Synthetic\SteuerBerater.exe' -or $actualIdentity.PSObject.Properties.Name -contains 'hwnd') {
  throw 'Process lifetime identity depends on a guessed main window.'
}
$script:fakeProcesses[0].ThrowRefresh=$true
Must-Fail { & $realKnowledgeCandidates } 'precondition-failed' 'Prozess'
if (-not $script:fakeProcesses[0].Disposed) { throw 'Failed process discovery leaked its process wrapper.' }

$field=@{rid='search';name='Suchbegriff';x=10;y=20;w=100;h=25;val=''}
$binding=New-Identity
if (-not (& $realKnowledgePoint $binding $field 10 20) -or [SSEAccessible]::LastHitHwnd -ne 200) { throw 'Exact field hit did not use the observed child window.' }
[SSEAccessible]::Hit.Name='unrelated'
if (& $realKnowledgePoint $binding $field 10 20) { throw 'An unrelated point was accepted.' }
[SSEAccessible]::Hit.Name='Suchbegriff';[SSEAccessible]::Hit.X=30
if (& $realKnowledgePoint $binding $field 10 20) { throw 'A moved point target was accepted.' }
[SSEAccessible]::Hit.X=10;$script:hitPid=43
if (& $realKnowledgePoint $binding $field 10 20) { throw 'A native hit in another process was accepted.' }
Reset-Scenario
$raw=[pscustomobject]@{Nodes=@([pscustomobject]@{Index=0;ParentIndex=-1;Role=42;Name='Suchbegriff';Value='';Path=@(0,1);X=10;Y=20;W=100;H=25;State=1048576});Errors=0;CycleHits=0;Truncated=$false;DepthLimited=$false}
[SSEAccessible]::Document=$raw
if (-not (& $realKnowledgeSnapshot $binding).complete -or (Get-SSEKnowledgeField (& $realKnowledgeSnapshot $binding)).rid -cne 'acc:0.1') { throw 'The complete document/field projection changed.' }
$raw.Errors=1
if ((& $realKnowledgeSnapshot $binding).complete) { throw 'A provider error became a complete snapshot.' }
$raw.Errors=0;$raw.CycleHits=1
if ((& $realKnowledgeSnapshot $binding).complete) { throw 'A cycle became a complete snapshot.' }
$raw.CycleHits=0;$raw.Truncated=$true
if ((& $realKnowledgeSnapshot $binding).complete) { throw 'A truncated document became a complete snapshot.' }
$raw.Truncated=$false;$raw.DepthLimited=$true
if ((& $realKnowledgeSnapshot $binding).complete) { throw 'A depth-limited document became a complete snapshot.' }
$raw.DepthLimited=$false;$raw.Nodes[0].State=1114112
if ($null -ne (Get-SSEKnowledgeField (& $realKnowledgeSnapshot $binding))) { throw 'An off-screen search field became an input target.' }
$raw.Nodes=@([pscustomobject]@{Index=0;ParentIndex=-1;Role=41;Name='An off-screen manufacturer paragraph must remain in the complete returned content.';Value='';Path=@(0);X=10;Y=20;W=100;H=25;State=65536})
if ((Get-SSEKnowledgeSections (& $realKnowledgeSnapshot $binding).views 20 12).abschnitte.Count -ne 1) { throw 'Off-screen article content was silently dropped.' }
$raw.Nodes[0].State=32768
if ((Get-SSEKnowledgeSections (& $realKnowledgeSnapshot $binding).views 20 12).abschnitte.Count -ne 0) { throw 'Invisible template text became article content.' }

Reset-Scenario
$binding=Select-SSEKnowledgeWindow $script:candidates $null
if ($binding.hwnd -ne 100) { throw 'Unique target did not bind.' }
Must-Fail { Select-SSEKnowledgeWindow @() $null } 'not-found'
Must-Fail { Select-SSEKnowledgeWindow @((New-Identity),(New-Identity 101 43)) $null } 'ambiguous'
$selected=Select-SSEKnowledgeWindow @((New-Identity),(New-Identity 101 43)) 101
if ($selected.pid -ne 43) { throw 'Explicit target chose another process.' }
Must-Fail { Select-SSEKnowledgeWindow $script:candidates 999 } 'not-found'
Must-Fail { Select-SSEKnowledgeWindow $script:candidates 0 } 'bad-args'
Must-Fail { Select-SSEKnowledgeWindow $script:candidates 1.5 } 'bad-args'
Assert-NoInput
$script:identity.startedTicks=501
Must-Fail { Assert-SSEKnowledgeTarget $binding } 'precondition-failed'
Reset-Scenario
[SW]::WindowPid=43
Must-Fail { Assert-SSEKnowledgeTarget $binding } 'precondition-failed'
Reset-Scenario
[SW]::Visible=$false
Must-Fail { Assert-SSEKnowledgeTarget $binding } 'precondition-failed'
Reset-Scenario
[SW]::Iconic=$true
Must-Fail { Assert-SSEKnowledgeTarget $binding } 'minimized'
Reset-Scenario
[SW]::Hung=$true
Must-Fail { Assert-SSEKnowledgeTarget $binding } 'precondition-failed' 'reagiert'
Reset-Scenario
$script:identity.path='C:\Changed\SteuerBerater.exe'
Must-Fail { Assert-SSEKnowledgeTarget $binding } 'precondition-failed'
Assert-NoInput

Reset-Scenario
[SW]::Acquire=$false; [SW]::Foreground=999
Must-Fail { Invoke-SSETaxKnowledgeSearch @{begriff='Alpha'} } 'precondition-failed'
Assert-NoInput
Reset-Scenario
$script:unobstructed=$false
Must-Fail { Invoke-SSETaxKnowledgeSearch @{begriff='Alpha'} } 'precondition-failed'
Assert-NoInput
Reset-Scenario
$script:exactPoint=$false
Must-Fail { Invoke-SSETaxKnowledgeSearch @{begriff='Alpha'} } 'precondition-failed'
Assert-NoInput
Reset-Scenario
[SW]::LoseAfterClick=$true
Must-Fail { Invoke-SSETaxKnowledgeSearch @{begriff='Alpha'} } 'precondition-failed'
if ([SW]::Clicks -ne 2 -or [System.Windows.Forms.SendKeys]::Keys.Count -ne 0) { throw 'Keys continued after click lost focus.' }
Reset-Scenario
[System.Windows.Forms.SendKeys]::LoseAfter=1
Must-Fail { Invoke-SSETaxKnowledgeSearch @{begriff='Alpha'} } 'precondition-failed'
if ([System.Windows.Forms.SendKeys]::Keys.Count -ne 1) { throw 'Keys continued after Ctrl+A lost focus.' }
Reset-Scenario
[System.Windows.Forms.SendKeys]::LoseAfter=4
Must-Fail { Invoke-SSETaxKnowledgeSearch @{begriff='Alpha'} } 'precondition-failed'
if ([System.Windows.Forms.SendKeys]::Keys.Count -ne 4 -or [System.Windows.Forms.SendKeys]::Submitted) { throw 'Term input continued after focus loss.' }
Reset-Scenario
$inputState=[pscustomobject]@{tick=0}
Must-Fail { Send-SSEKnowledgeInput $binding $field '^a' $inputState } 'interference'
Assert-NoInput
$inputState.tick=$null
Must-Fail { Send-SSEKnowledgeInput $binding $field '^a' $inputState } 'interference'
Assert-NoInput
Reset-Scenario
[System.Windows.Forms.SendKeys]::Value='Alpha'
[SSEAccessible]::FocusDelayReads=2
Wait-SSEKnowledgeInputValue $binding $field 'Alpha' ([pscustomobject]@{tick=10})
Assert-NoInput

Reset-Scenario
$script:nullTickAt=2
Must-Fail { Invoke-SSETaxKnowledgeSearch @{begriff='Alpha'} } 'interference' 'Epoche'
Assert-NoInput
Reset-Scenario
$script:nullTickAt=3
Must-Fail { Invoke-SSETaxKnowledgeSearch @{begriff='Alpha'} } 'interference' 'Epoche'
if ([SW]::Clicks -ne 2 -or [System.Windows.Forms.SendKeys]::Keys.Count -ne 0) { throw 'Keys were sent after a missing post-click epoch.' }
Reset-Scenario
[System.Windows.Forms.SendKeys]::LoseFieldAfter=1
Must-Fail { Invoke-SSETaxKnowledgeSearch @{begriff='Alpha'} } 'precondition-failed' 'Tastaturfokus'
if ([System.Windows.Forms.SendKeys]::Keys.Count -ne 1) { throw 'Typing continued after in-window focus changed.' }
Reset-Scenario
$script:onLiteral={ [SW]::Tick++ }
Must-Fail { Invoke-SSETaxKnowledgeSearch @{begriff='Alpha'} } 'interference' 'Epoche'
if ([System.Windows.Forms.SendKeys]::Keys.Count -ne 1 -or [System.Windows.Forms.SendKeys]::Submitted) { throw 'External inter-step input was absorbed.' }
Reset-Scenario
[SSEAccessible]::InterfereOnFocus=$true
Must-Fail { Invoke-SSETaxKnowledgeSearch @{begriff='Alpha'} } 'interference' 'Epoche'
if ([System.Windows.Forms.SendKeys]::Keys.Count -ne 0) { throw 'Input during focus verification was absorbed before SendWait.' }
Reset-Scenario
[System.Windows.Forms.SendKeys]::Uppercase=$true
Must-Fail { Invoke-SSETaxKnowledgeSearch @{begriff='Alpha'} } 'precondition-failed' 'Suchbegriff'
if ([System.Windows.Forms.SendKeys]::Submitted) { throw 'An unverified field value was submitted.' }
Reset-Scenario
$script:mode='moved'
Must-Fail { Invoke-SSETaxKnowledgeSearch @{begriff='Alpha'} } 'precondition-failed' 'Lage'
Assert-NoInput
Reset-Scenario
$script:mode='rebound'
Must-Fail { Invoke-SSETaxKnowledgeSearch @{begriff='Alpha'} } 'precondition-failed' 'Lage'
Assert-NoInput

Reset-Scenario
$baseline=Get-SSEKnowledgeResults (Read-SSEKnowledgeSnapshot $binding) 20 12
[System.Windows.Forms.SendKeys]::Value='Alpha'; [System.Windows.Forms.SendKeys]::Submitted=$true; [System.Windows.Forms.SendKeys]::SubmittedTerm='Alpha'
$script:mode='empty'
Must-Fail { Wait-SSEKnowledgeResult $binding $baseline 'Alpha' 20 12 $false 80 1 } 'timeout'
$script:mode='stale'
Must-Fail { Wait-SSEKnowledgeResult $binding $baseline 'Alpha' 20 12 $false 80 1 } 'timeout'
$script:baselineText='Alpha appeared in an older paragraph that must not count as a new successful search result.'
$baseline=Get-SSEKnowledgeResults (Read-SSEKnowledgeSnapshot $binding) 20 12
Must-Fail { Wait-SSEKnowledgeResult $binding $baseline 'Alpha' 20 12 $false 80 1 } 'timeout'
$script:mode='fresh'; $script:resultText='Changed text without the requested search word, still long enough for an article.'
Must-Fail { Wait-SSEKnowledgeResult $binding $baseline 'Alpha' 20 12 $false 80 1 } 'timeout'
$script:resultText='Alpha is correctly present but an incomplete tree cannot establish a successful final result.'
$script:mode='incomplete'
Must-Fail { Wait-SSEKnowledgeResult $binding $baseline 'Alpha' 20 12 $false 80 1 } 'timeout'
$script:mode='not-result'
Must-Fail { Wait-SSEKnowledgeResult $binding $baseline 'Alpha' 20 12 $false 80 1 } 'timeout'

Reset-Scenario
$success=Invoke-SSETaxKnowledgeSearch @{begriff='Alpha';fenster=100}
if (-not $success.ok -or $success.pid -ne 42 -or $success.fenster -ne 100 -or $success.abschnitte.Count -ne 1) { throw 'Genuine new content was not returned.' }
if ($success.trefferAnzahl -ne 1 -or $success.abschnitte[0].text -cne $script:resultText) { throw 'Navigation leaked into the scoped search result.' }
if (-not [System.Windows.Forms.SendKeys]::Submitted) { throw 'Successful search was not submitted.' }
if (([System.Windows.Forms.SendKeys]::Keys -join '|') -cne '^a|A|l|p|h|a|{ENTER}' -or [SW]::Clicks -ne 2) { throw 'Unexpected successful input sequence.' }
if ([SW]::DpiEntries -ne 1 -or [SW]::DpiRestores -ne 1) { throw 'Successful search did not restore its DPI context.' }
Reset-Scenario
$script:baselineText=$script:resultText
[System.Windows.Forms.SendKeys]::Value='Alpha'
$repeat=Invoke-SSETaxKnowledgeSearch @{begriff='Alpha'}
if (-not $repeat.ok) { throw 'An already confirmed identical query lost compatibility.' }
if ([System.Windows.Forms.SendKeys]::QueryTerms.Count -ne 3 -or
    [System.Windows.Forms.SendKeys]::QueryTerms[0] -cne 'Alpha' -or
    -not [System.Windows.Forms.SendKeys]::QueryTerms[1].StartsWith('zzsse') -or
    [System.Windows.Forms.SendKeys]::QueryTerms[2] -cne 'Alpha') { throw 'An unchanged result was returned without an independently changed result state.' }
Reset-Scenario
$script:resultCount=0
$empty=Invoke-SSETaxKnowledgeSearch @{begriff='Alpha'}
if (-not $empty.ok -or $empty.trefferAnzahl -ne 0 -or $empty.abschnitte.Count -ne 0) { throw 'A structurally confirmed empty result was not represented explicitly.' }
Reset-Scenario
$script:initialCount=0; $script:resultCount=0
$emptyRepeat=Invoke-SSETaxKnowledgeSearch @{begriff='Alpha'}
if (-not $emptyRepeat.ok -or $emptyRepeat.trefferAnzahl -ne 0 -or [System.Windows.Forms.SendKeys]::QueryTerms.Count -ne 3 -or
    [System.Windows.Forms.SendKeys]::QueryTerms[1] -cne 'Steuer') { throw 'An unchanged empty result did not require a verified positive control.' }
Reset-Scenario
$parts=@(
  @{type='Text';name='A sufficiently long passage about the ';p='article'},
  @{type='Text';name='Reverse-Charge';p='article'},
  @{type='Text';name=' procedure and its original surrounding content.';p='article'}
)
$grouped=Get-SSEKnowledgeSections $parts 60 1
if ($grouped.abschnitte.Count -ne 1 -or $grouped.abschnitte[0].teile.Count -ne 3 -or
    $grouped.abschnitte[0].text -cne (($parts.name)-join '') -or -not (Test-SSEKnowledgeTerm $grouped.abschnitte 'Reverse Charge')) {
  throw 'Highlight joining or search-term evidence changed.'
}
if (Test-SSEKnowledgeTerm @(@{text='ab cd'}) 'bc') {
  throw 'Search evidence crossed a word boundary.'
}
if (-not (Test-SSEKnowledgeTerm @(@{text='abcd'}) 'bc')) { throw 'Evidence within a German compound word changed.' }
$script:DESKTOP_NAME='isolated'
Must-Fail { Invoke-SSETaxKnowledgeSearch @{begriff='Alpha'} } 'hidden-desktop'
Reset-Scenario
[SW]::DpiAvailable=$false
Must-Fail { Invoke-SSETaxKnowledgeSearch @{begriff='Alpha'} } 'unsupported' 'DPI'
Assert-NoInput
Reset-Scenario
Must-Fail { Invoke-SSETaxKnowledgeSearch @{begriff='x'} } 'bad-args'
Must-Fail { Invoke-SSETaxKnowledgeSearch @{begriff="Alpha`nBeta"} } 'bad-args'
Assert-NoInput
Write-Output 'Steuerwissen: Fenster-/Lebenszeitbindung, Feldfokus, Eingabe-Epochen zwischen Schritten und Ergebnisvertrag deterministisch geprueft.'
