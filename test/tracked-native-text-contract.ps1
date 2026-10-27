$ErrorActionPreference = 'Stop'
$repo=Split-Path -Parent $PSScriptRoot
$WorkerPath=Join-Path $repo 'powershell/sse-worker.ps1'
. (Join-Path $repo 'powershell/table-values.ps1')

# Run the production commit against deterministic native/UIA boundaries. These
# types cannot send real input or operate a desktop window.
Add-Type -TypeDefinition @'
using System;
using System.Collections.Generic;
namespace System.Windows.Automation {
  public sealed class ValueState { public bool IsReadOnly; public string Value; }
  public sealed class ValuePattern {
    public static readonly object Pattern = new object();
    public ValueState Current = new ValueState();
    public void SetValue(string value) {
      SW.Events.Add("focusless-set"); Current.Value=value;
      if(SW.UpdateNameOnSet) SW.BoundTarget.Current.Name=value;
      if(SW.SetRawOverrideEnabled) Current.Value=SW.SetRaw;
    }
  }
  public sealed class SelectionState { public bool IsSelected; }
  public sealed class SelectionItemPattern {
    public static readonly object Pattern = new object();
    public SelectionState Current = new SelectionState();
    public void Select() {
      SW.SelectionCalls++; Current.IsSelected=SW.SelectionAccepted;
      if(SW.SelectMutationEnabled) SW.Value.Current.Value=SW.SelectNull?null:SW.SelectRaw;
      if(SW.SelectNameMutationEnabled) SW.BoundTarget.Current.Name=SW.SelectName;
    }
  }
  public static class ControlType {
    public static readonly CommitControlType Table=new CommitControlType { ProgrammaticName="ControlType.Table" };
    public static readonly CommitControlType DataItem=new CommitControlType { ProgrammaticName="ControlType.DataItem" };
  }
  public sealed class AutomationElement {
    public static object FocusedElement;
    public static CommitMain FromHandle(IntPtr value) { return new CommitMain(); }
  }
}
namespace System.Windows.Forms {
  public static class SendKeys {
    public static void SendWait(string keys) {
      SW.Events.Add(keys); SW.Tick++;
      if (keys == "^a") SW.Selected=true;
      if (keys == "{BACKSPACE}") { SW.Value.Current.Value = ""; SW.Selected=false; }
    }
  }
}
public sealed class CommitRectangle { public double X=20, Y=30, Width=80, Height=20; }
public sealed class CommitMainCurrent { public int ProcessId=100; }
public sealed class CommitMain {
  public CommitMainCurrent Current=new CommitMainCurrent();
  public void SetFocus() { }
}
public sealed class CommitControlType { public string ProgrammaticName = "ControlType.Edit"; }
public sealed class CommitCurrent {
  public int ProcessId=99;
  public string Name="";
  public CommitRectangle BoundingRectangle = new CommitRectangle();
  public bool HasKeyboardFocus = true;
  public string AutomationId = "bound-field";
  public CommitControlType ControlType = new CommitControlType();
}
public sealed class CommitTarget {
  public CommitCurrent Current = new CommitCurrent();
  public bool TryGetCurrentPattern(object pattern, out object value) {
    value=null;
    if(ReferenceEquals(pattern,System.Windows.Automation.ValuePattern.Pattern)) { value=SW.Value; return true; }
    if(ReferenceEquals(pattern,System.Windows.Automation.SelectionItemPattern.Pattern) && SW.SelectionAvailable) {
      value=SW.Selection; return true;
    }
    return false;
  }
  public void SetFocus() {
    if(SW.FocusMutationEnabled) SW.Value.Current.Value=SW.FocusNull?null:SW.FocusRaw;
    if(SW.FocusNameMutationEnabled) Current.Name=SW.FocusName;
    if(SW.FocusReadOnly) SW.Value.Current.IsReadOnly=true;
  }
  public int[] GetRuntimeId() { return new int[] { 7, 1 }; }
}
public sealed class CommitWalker {
  public CommitTarget GetParent(object value) {
    SW.ParentReads++;
    return ReferenceEquals(value,SW.BoundTarget)?SW.TableParent:null;
  }
}
public static class SW {
  public static bool FocusMutationEnabled=false, FocusNull=false;
  public static string FocusRaw="";
  public static bool FocusNameMutationEnabled=false, FocusReadOnly=false;
  public static string FocusName="";
  public static bool ClickMutationEnabled=false, ClickNull=false, ClickFocusAccepted=true;
  public static string ClickRaw="";
  public static bool ClickNameMutationEnabled=false;
  public static string ClickName="";
  public static bool SelectMutationEnabled=false, SelectNull=false, SelectNameMutationEnabled=false;
  public static string SelectRaw="", SelectName="";
  public static bool SelectionAvailable=true, SelectionAccepted=true, UpdateNameOnSet=false, SetRawOverrideEnabled=false;
  public static string SetRaw="";
  public static int SelectionCalls=0, ParentReads=0;
  public static System.Windows.Automation.SelectionItemPattern Selection=new System.Windows.Automation.SelectionItemPattern();
  public static CommitTarget TableParent;
  public static CommitTarget BoundTarget;
  public static void SetRawNull(){Value.Current.Value=null;}
  public static void SetNameNull(){BoundTarget.Current.Name=null;}
  public struct PT { public int X, Y; }
  public static System.Windows.Automation.ValuePattern Value = new System.Windows.Automation.ValuePattern();
  public static List<string> Events = new List<string>();
  public static uint Tick = 1;
  public static IntPtr Foreground = new IntPtr(7);
  public static bool Valid = true, ForeignHit = false, Selected = false, QueuedModel = false;
  public static bool CursorAccepted = true, CursorReadable = true, CursorDrift = false;
  public static int CursorX, CursorY;
  public static string Outcome = "success", LastText, Pending="";
  public static bool IsWindow(IntPtr hwnd) { return Valid; }
  public static IntPtr GetForegroundWindow() { return Foreground; }
  public static uint GetWindowThreadProcessId(IntPtr hwnd, out int pid) { pid=hwnd.ToInt64()==7?100:200; return 1; }
  public static IntPtr WindowFromPoint(PT point) { return new IntPtr(ForeignHit?8:7); }
  public static IntPtr GetAncestor(IntPtr hwnd, uint flags) { return hwnd; }
  public static bool PostMessage(IntPtr hwnd, uint message, IntPtr wparam, IntPtr lparam) {
    Events.Add(message==0x0100?"post-tab-down":"post-tab-up"); return true;
  }
  public static bool SetCursorPos(int x, int y) {
    Events.Add("cursor"); if(CursorAccepted) { CursorX=x; CursorY=y; } return CursorAccepted;
  }
  public static bool GetCursorPos(out PT point) {
    point=new PT { X=CursorX+(CursorDrift?1:0),Y=CursorY }; return CursorReadable;
  }
  public static void mouse_event(uint flags, uint x, uint y, uint data, IntPtr extra) {
    Events.Add("mouse");
    if(flags==0x0004) {
      Tick++;
      if(ClickFocusAccepted) {
        BoundTarget.Current.HasKeyboardFocus=true;
        System.Windows.Automation.AutomationElement.FocusedElement=BoundTarget;
      }
      if(ClickMutationEnabled) Value.Current.Value=ClickNull?null:ClickRaw;
      if(ClickNameMutationEnabled) BoundTarget.Current.Name=ClickName;
    }
  }
  public static bool SendUnicodeText(string text) {
    Events.Add("unicode"); LastText+=text; Tick++;
    if (Selected) { Value.Current.Value=""; Pending=""; Selected=false; }
    if (QueuedModel && Outcome=="success") {
      for (int i=0;i<text.Length;i++) {
        if (char.IsHighSurrogate(text[i]) && i+1<text.Length && char.IsLowSurrogate(text[i+1])) {
          Value.Current.Value+=text.Substring(i,2); i++;
        } else { Pending+=text[i]; }
      }
    } else { Value.Current.Value+=Outcome=="success"?text:text.Substring(0,1); }
    if (Outcome=="throw") throw new InvalidOperationException("partial native failure");
    return Outcome=="success";
  }
  public static void FlushModel() { if(!string.IsNullOrEmpty(Pending)) Value.Current.Value+=Pending; Pending=""; }
}
'@

$ast = [Management.Automation.Language.Parser]::ParseFile($workerPath, [ref]$null, [ref]$null)
foreach ($name in @('Commit-TrackedValue','Commit-TrackedValueFocusless','New-SSECommitResult','Send-SSETrackedLiteralText','Get-SSETrackedDateParts','Test-SSETrackedValueEquivalent','Test-SSETrackedFieldValue','Test-SSETrackedCommitPrecondition')) {
  $definition = @($ast.FindAll({ param($node)
    $node -is [Management.Automation.Language.FunctionDefinitionAst] -and $node.Name -ceq $name
  }, $true))
  if ($definition.Count -ne 1) { throw "Ambiguous production function: $name" }
  Invoke-Expression $definition[0].Extent.Text
}

function Show-SSEWindow { param($Hwnd) $true }
function Get-LiveElement { param($Hwnd, $Rid, $Aid) $script:target }
function Get-SSELastInputTick { [SW]::Tick }
function Test-SSELastInputUnchanged {
  param($Expected)
  $script:guardChecks++
  ($script:failGuard -ne $script:guardChecks) -and $Expected -eq [SW]::Tick
}
function Set-SSEForegroundLeaseInputCheckpoint { param($Tick, $Point) $script:checkpoints.Add($Tick) }
function Complete-SSEPhysicalSection { param($Hwnd) $script:completed++ }
function Start-Sleep {
  param($Milliseconds)
  $script:sleeps.Add([int]$Milliseconds); [SW]::FlushModel()
  # Only the table-focus fixture uses the production 500 ms focus timeout.
  # Bound its polling without changing the production clock or focus logic.
  if ($script:tableFocusWait) { [Threading.Thread]::Sleep([int]$Milliseconds) }
}
function Get-SSEWindowClassName { param($Hwnd) 'foreign-test-window' }
function Get-SSEWindowTitleText { param($Hwnd) 'foreign-test-window' }
function Get-SSETextSha256 { param($Text) 'test-fingerprint' }

function Reset-TestState {
  $script:DESKTOP_NAME = ''
  [SW]::FocusMutationEnabled=$false;[SW]::FocusNull=$false;[SW]::FocusRaw=''
  [SW]::FocusNameMutationEnabled=$false;[SW]::FocusName='';[SW]::FocusReadOnly=$false
  [SW]::ClickNameMutationEnabled=$false;[SW]::ClickName=''
  [SW]::SelectMutationEnabled=$false;[SW]::SelectNull=$false;[SW]::SelectRaw=''
  [SW]::SelectNameMutationEnabled=$false;[SW]::SelectName=''
  [SW]::SelectionAvailable=$true;[SW]::SelectionAccepted=$true
  [SW]::Selection=new-object System.Windows.Automation.SelectionItemPattern
  [SW]::SelectionCalls=0;[SW]::ParentReads=0
  [SW]::UpdateNameOnSet=$false;[SW]::SetRawOverrideEnabled=$false;[SW]::SetRaw=''
  $script:target = New-Object CommitTarget
  [SW]::BoundTarget=$script:target;[SW]::ClickMutationEnabled=$false;[SW]::ClickNull=$false;[SW]::ClickRaw='';[SW]::ClickFocusAccepted=$true
  [System.Windows.Automation.AutomationElement]::FocusedElement=$null
  [SW]::TableParent=New-Object CommitTarget
  [SW]::TableParent.Current.ControlType=[System.Windows.Automation.ControlType]::Table
  $script:WLK=New-Object CommitWalker;$script:tableFocusWait=$false
  $script:node = [pscustomobject]@{ rid='7.1'; aid='bound-field'; x=20; y=30; w=80; h=20 }
  [SW]::Value.Current.Value = 'before'; [SW]::Value.Current.IsReadOnly = $false
  [SW]::Events.Clear(); [SW]::LastText=$null; [SW]::Tick=1
  [SW]::Foreground=[IntPtr]7; [SW]::Valid=$true; [SW]::ForeignHit=$false; [SW]::Outcome='success'
  [SW]::Selected=$false; [SW]::QueuedModel=$false; [SW]::Pending=''
  [SW]::CursorAccepted=$true; [SW]::CursorReadable=$true; [SW]::CursorDrift=$false
  $script:guardChecks=0; $script:failGuard=0; $script:completed=0
  $script:sleeps = New-Object 'System.Collections.Generic.List[int]'
  $script:checkpoints = New-Object 'System.Collections.Generic.List[uint32]'
}
function Assert-True { param($Condition, $Message) if (-not $Condition) { throw $Message } }

# Every assertion below runs the actual parsed commit, with non-native types.
$rawCases=@(
 @{id='default-case';kind='';actual='test';expected='Test';nullRaw=$false;focus=$false;method='epoch-value-changed'},
 @{id='text-case';kind='text';actual='test';expected='Test';nullRaw=$false;focus=$false;method='epoch-value-changed'},
 @{id='text-space';kind='text';actual='T est';expected='Test';nullRaw=$false;focus=$false;method='epoch-value-changed'},
 @{id='text-punctuation';kind='text';actual='a,b';expected='a.b';nullRaw=$false;focus=$false;method='epoch-value-changed'},
 @{id='text-number';kind='text';actual='1.000';expected='1000';nullRaw=$false;focus=$false;method='epoch-value-changed'},
 @{id='text-null';kind='text';actual='';expected='';nullRaw=$true;focus=$false;method='epoch-value-changed'},
 @{id='expected-null';kind='text';actual='';expected='';expectedNull=$true;nullRaw=$false;focus=$false;method='epoch-value-changed'},
 @{id='focus-case';kind='text';actual='test';expected='Test';nullRaw=$false;focus=$true;method='epoch-value-changed-after-focus'},
 @{id='focus-space';kind='text';actual='T est';expected='Test';nullRaw=$false;focus=$true;method='epoch-value-changed-after-focus'},
 @{id='focus-null';kind='text';actual='';expected='';nullRaw=$true;focus=$true;method='epoch-value-changed-after-focus'},
 @{id='click-case';kind='text';actual='test';expected='Test';nullRaw=$false;point=$true;events='cursor|mouse|mouse';method='epoch-value-changed-after-focus'},
 @{id='click-space';kind='text';actual='T est';expected='Test';nullRaw=$false;point=$true;events='cursor|mouse|mouse';method='epoch-value-changed-after-focus'},
 @{id='click-null';kind='text';actual='';expected='';nullRaw=$true;point=$true;events='cursor|mouse|mouse';method='epoch-value-changed-after-focus'},
 @{id='currency-comma-dot';kind='currency';actual='1,000';expected='1.000';nullRaw=$false;method='epoch-value-changed'},
 @{id='currency-different';kind='currency';actual='13,00';expected='12,00';nullRaw=$false;method='epoch-value-changed'},
 @{id='currency-focus-magnitude';kind='currency';actual='1,000';expected='1.000';nullRaw=$false;focus=$true;method='epoch-value-changed-after-focus'},
 @{id='currency-click-magnitude';kind='currency';actual='1,000';expected='1.000';nullRaw=$false;point=$true;events='cursor|mouse|mouse';method='epoch-value-changed-after-focus'}
)
foreach($case in $rawCases){
 Reset-TestState
 [SW]::Value.Current.Value=$case.expected
 if($case.point){$script:target.Current.HasKeyboardFocus=$false;[SW]::ClickMutationEnabled=$true;[SW]::ClickRaw=$case.actual;[SW]::ClickNull=$case.nullRaw}
 elseif($case.focus){[SW]::FocusMutationEnabled=$true;[SW]::FocusRaw=$case.actual;[SW]::FocusNull=$case.nullRaw}
 else{[SW]::Value.Current.Value=$case.actual;if($case.nullRaw){[SW]::SetRawNull()}}
 $expectedArgument=$case.expected
 if($case.expectedNull){$expectedArgument=$null}
 $result=Commit-TrackedValue ([IntPtr]7) $script:node 'Synthetic New' $expectedArgument $case.kind
 Assert-True ($result.method -ceq $case.method) ('Fresh value guard did not refuse '+$case.id+'; method='+$result.method+'; events='+[SW]::Events.Count)
 Assert-True (([SW]::Events -join '|') -ceq [string]$case.events) ('Rejected raw precondition sent value input: '+$case.id)
 Assert-True ($result.interference -and -not $result.inputInterference) 'Value drift must stop without claiming foreign input.'
 Assert-True (-not $result.details.mutationStarted -and $script:completed -eq 1) 'Refused raw precondition lost cleanup or began value input.'
}
foreach($case in @(
 @{kind='currency';actual='1234,00';expected='1.234,00';requested='2345,00';focus=$false},
 @{kind='date';actual='15.07';expected='15.07.2026';requested='16.07.2026';focus=$false},
 @{kind='currency';actual='1234,00';expected='1.234,00';requested='2345,00';focus=$true},
 @{kind='date';actual='15.07';expected='15.07.2026';requested='16.07.2026';focus=$true},
 @{kind='currency';actual='1234,00';expected='1.234,00';requested='2345,00';point=$true;events='cursor|mouse|mouse|^a|unicode|{TAB}'},
 @{kind='date';actual='15.07';expected='15.07.2026';requested='16.07.2026';point=$true;events='cursor|mouse|mouse|^a|unicode|{TAB}'}
)){
 Reset-TestState;[SW]::Value.Current.Value=$case.expected
 if($case.point){$script:target.Current.HasKeyboardFocus=$false;[SW]::ClickMutationEnabled=$true;[SW]::ClickRaw=$case.actual}
 elseif($case.focus){[SW]::FocusMutationEnabled=$true;[SW]::FocusRaw=$case.actual}
 else{[SW]::Value.Current.Value=$case.actual}
 $result=Commit-TrackedValue ([IntPtr]7) $script:node $case.requested $case.expected $case.kind
 Assert-True ($result.method -ceq 'verified-keyboard-replace') 'Explicit currency/date precondition formatting was rejected.'
 $expectedEvents=$(if($case.point){$case.events}else{'^a|unicode|{TAB}'})
 Assert-True (([SW]::Events -join '|') -ceq $expectedEvents) 'Positive formatted control replayed input.'
}
Reset-TestState;[SW]::Value.Current.Value=''
$emptyCurrent=Commit-TrackedValue ([IntPtr]7) $script:node 'Synthetic New' '' 'text'
Assert-True ($emptyCurrent.method -ceq 'verified-keyboard-replace' -and ([SW]::Events -join '|') -ceq '^a|unicode|{TAB}') 'A readable empty original value was confused with an unknown original.'
foreach($case in @(
 @{actual='Test';expected='Test';nullRaw=$false;method='focusless-process-mismatch'},
 @{actual='test';expected='Test';nullRaw=$false;method='epoch-value-changed'},
 @{actual='T est';expected='Test';nullRaw=$false;method='epoch-value-changed'},
 @{actual='';expected='';nullRaw=$true;method='epoch-value-changed'},
 @{actual='';expected='';nullRaw=$false;expectedNull=$true;method='epoch-value-changed'},
 @{actual='';expected='';business='15.07';name='15.07';type='DataItem';nullRaw=$true;method='epoch-value-changed'},
 @{actual='';expected='';business='15.07';name='15.07';type='DataItem';nullRaw=$false;method='focusless-process-mismatch'}
)){
 Reset-TestState;$script:DESKTOP_NAME='synthetic'
 $script:node|Add-Member NoteProperty type ([string]$case.type)
 $script:target.Current.Name=[string]$case.name
 [SW]::Value.Current.Value=$case.actual;if($case.nullRaw){[SW]::SetRawNull()}
 $expectedArgument=$case.expected;if($case.expectedNull){$expectedArgument=$null}
 if($case.type -ceq 'DataItem'){$expectedArgument=[pscustomobject]@{raw=$case.expected;name=$case.name;value=$case.business}}
 $result=Commit-TrackedValueFocusless ([IntPtr]7) $script:node 'Synthetic New' $expectedArgument 'text'
 Assert-True ($result.method -ceq $case.method) 'Focusless raw guard did not stop at its explicit non-native boundary.'
 Assert-True ([SW]::Events.Count -eq 0) 'Focusless raw guard emitted input.'
}
foreach($case in @(
 @{kind='text';before='Test';current='test';nullRaw=$false;method='epoch-value-changed-after-focus';events=''},
 @{kind='text';before='';current='';nullRaw=$true;method='epoch-value-changed-after-focus';events=''},
 @{kind='currency';before='1.234,00';current='1234,00';nullRaw=$false;method='verified-focusless-value-pattern-tab';events='focusless-set|post-tab-down|post-tab-up'}
)){
 Reset-TestState;$script:DESKTOP_NAME='synthetic';$script:target.Current.ProcessId=100
 $script:node|Add-Member NoteProperty type 'Edit'
 [SW]::Value.Current.Value=$case.before;[SW]::FocusMutationEnabled=$true;[SW]::FocusRaw=$case.current;[SW]::FocusNull=$case.nullRaw
 $result=Commit-TrackedValueFocusless ([IntPtr]7) $script:node 'Synthetic New' $case.before $case.kind
 Assert-True ($result.method -ceq $case.method) ('Focusless commit did not recheck after focus; method='+$result.method+'; events='+[SW]::Events.Count)
 Assert-True (([SW]::Events -join '|') -ceq $case.events) 'Focusless commit wrote an unowned value or replayed its queue.'
}
Write-Output 'Fresh commit preconditions: text/raw drift and null rejected, explicit format controls passed.'

function Initialize-DataItemFixture {
  param($Raw, $Name)
  Reset-TestState
  $script:node | Add-Member NoteProperty type 'DataItem'
  $script:target.Current.ControlType=[System.Windows.Automation.ControlType]::DataItem
  $script:target.Current.ProcessId=100
  $script:target.Current.Name=$Name
  [SW]::Value.Current.Value=$Raw
  [SW]::UpdateNameOnSet=$true
}

# A DataItem can keep an empty/opaque raw placeholder while its actual Name
# changes. Run both physical focus paths, not just the high-level mock.
foreach ($phase in @('initial','focus','point')) {
  foreach ($case in @(
    @{kind='date';raw='';name='15.07';business='15.07.2026';changed='16.07'},
    @{kind='date';raw='15.07';name='15.07.2026';business='15.07';changed='15.07';changedRaw='15.07.2027';changeRaw=$true},
    @{kind='date';raw='15.07.2026';name='15.07';business='15.07';changed='15.07.2027';changedRaw='15.07';changeRaw=$true},
    @{kind='text';raw='opaque';name='Test';business='Test';changed='test'},
    @{kind='currency';raw='1000';name='1.000,00';business='1000';changed='2.000,00'},
    @{kind='date';raw='15.07';name='15.07';business='15.07.2026';changed='15.07.2027'}
  )) {
    Initialize-DataItemFixture $case.raw $case.name
    $snapshot=[pscustomobject]@{raw=$case.raw;name=$case.name;value=$case.business}
    switch ($phase) {
      'initial' { $script:target.Current.Name=$case.changed;if($case.changeRaw){[SW]::Value.Current.Value=$case.changedRaw} }
      'focus' { [SW]::FocusNameMutationEnabled=$true;[SW]::FocusName=$case.changed;if($case.changeRaw){[SW]::FocusMutationEnabled=$true;[SW]::FocusRaw=$case.changedRaw} }
      'point' {
        $script:target.Current.HasKeyboardFocus=$false
        [SW]::ClickNameMutationEnabled=$true;[SW]::ClickName=$case.changed
        if($case.changeRaw){[SW]::ClickMutationEnabled=$true;[SW]::ClickRaw=$case.changedRaw}
      }
    }
    $result=Commit-TrackedValue ([IntPtr]7) $script:node 'Synthetic New' $snapshot $case.kind
    $expectedMethod=$(if($phase -ceq 'initial'){'epoch-value-changed'}else{'epoch-value-changed-after-focus'})
    $expectedEvents=$(if($phase -ceq 'point'){'cursor|mouse|mouse'}else{''})
    Assert-True ($result.method -ceq $expectedMethod) ('DataItem Name drift passed physical boundary: '+$phase+'/'+$case.kind)
    Assert-True (([SW]::Events -join '|') -ceq $expectedEvents) 'DataItem refusal sent value input.'
    Assert-True ($result.interference -and -not $result.inputInterference -and -not $result.details.mutationStarted) 'DataItem value drift lost its guard-only classification.'
    Assert-True ($script:completed -eq 1) 'DataItem refusal did not complete its physical section.'
  }
}

# The profiled focusless amount is a currency DataItem. Model ValuePattern and
# SelectionItemPattern separately, including a selected cell in a focused table.
foreach ($phase in @('select','focus','table')) {
  foreach ($case in @(
    @{kind='currency';raw='';name='12,00';business='12,00';changedName='13,00';changeName=$true},
    @{kind='date';raw='15.07';name='15.07.2026';business='15.07';changedName='15.07';changeName=$true;changeRaw=$true;changedRaw='15.07.2027'},
    @{kind='date';raw='15.07.2026';name='15.07';business='15.07';changedName='15.07.2027';changeName=$true;changeRaw=$true;changedRaw='15.07'},
    @{kind='currency';raw='12';name='12,00';business='12';changedName='13,00';changeName=$true},
    @{kind='currency';raw='';name='12,00';business='12,00';nullRaw=$true},
    @{kind='date';raw='15.07';name='15.07';business='15.07.2026';changedName='15.07.2027';changeName=$true}
  )) {
    Initialize-DataItemFixture $case.raw $case.name
    $script:DESKTOP_NAME='synthetic'
    $snapshot=[pscustomobject]@{raw=$case.raw;name=$case.name;value=$case.business}
    switch ($phase) {
      'select' {
        [SW]::SelectNameMutationEnabled=[bool]$case.changeName;[SW]::SelectName=[string]$case.changedName
        [SW]::SelectMutationEnabled=([bool]$case.nullRaw -or [bool]$case.changeRaw);[SW]::SelectNull=[bool]$case.nullRaw;[SW]::SelectRaw=[string]$case.changedRaw
      }
      'focus' {
        [SW]::FocusNameMutationEnabled=[bool]$case.changeName;[SW]::FocusName=[string]$case.changedName
        [SW]::FocusMutationEnabled=([bool]$case.nullRaw -or [bool]$case.changeRaw);[SW]::FocusNull=[bool]$case.nullRaw;[SW]::FocusRaw=[string]$case.changedRaw
      }
      'table' {
        $script:target.Current.HasKeyboardFocus=$false;$script:tableFocusWait=$true
        [SW]::FocusNameMutationEnabled=[bool]$case.changeName;[SW]::FocusName=[string]$case.changedName
        [SW]::FocusMutationEnabled=([bool]$case.nullRaw -or [bool]$case.changeRaw);[SW]::FocusNull=[bool]$case.nullRaw;[SW]::FocusRaw=[string]$case.changedRaw
      }
    }
    $result=Commit-TrackedValueFocusless ([IntPtr]7) $script:node '24,00' $snapshot $case.kind
    Assert-True ($result.method -ceq 'epoch-value-changed-after-focus') ('DataItem focusless drift passed boundary: '+$phase+'/'+$case.kind+'; '+$result.method)
    Assert-True ([SW]::SelectionCalls -eq 1 -and [SW]::Selection.Current.IsSelected) 'DataItem did not execute its actual selection branch.'
    Assert-True ([SW]::Events.Count -eq 0) 'DataItem late refusal called SetValue or queued TAB.'
    Assert-True ($result.interference -and -not $result.inputInterference -and -not $result.details.mutationStarted) 'Focusless DataItem drift blamed foreign input.'
    if($phase -ceq 'table'){Assert-True ([SW]::ParentReads -eq 1) 'Selected-cell table-focus branch was not exercised.'}
  }
}

foreach ($mode in @('exact-element','selected-item-focused-table')) {
  foreach ($case in @(
    @{kind='currency';raw='1234';name='1.234,00';business='1234';formatted='1234,00';requested='2345,00'},
    @{kind='currency';raw='';name='12,00';business='12';formatted='12,00';requested='24,00'},
    @{kind='currency';raw='0';name='0,00';business='0';formatted='0,000';requested='1,00'},
    @{kind='currency';raw='';name='';business='';formatted='';requested='1,00'},
    @{kind='date';raw='';name='';business='';formatted='';requested='16.07.2026'},
    @{kind='date';raw='15.07';name='15.07';business='15.07';formatted='15.07.2027';requested='16.07.2027'},
    @{kind='currency';raw='3';name='3,00 EUR';business='3';formatted='3,00 EUR';requested='4,00'}
  )) {
    Initialize-DataItemFixture $case.raw $case.name
    $script:DESKTOP_NAME='synthetic'
    $snapshot=[pscustomobject]@{raw=$case.raw;name=$case.name;value=$case.business}
    [SW]::FocusNameMutationEnabled=$true;[SW]::FocusName=$case.formatted
    if($mode -ceq 'selected-item-focused-table'){
      $script:target.Current.HasKeyboardFocus=$false;$script:tableFocusWait=$true
    }
    $result=Commit-TrackedValueFocusless ([IntPtr]7) $script:node $case.requested $snapshot $case.kind
    Assert-True ($result.method -ceq 'verified-focusless-value-pattern-tab' -and $result.details.focusMode -ceq $mode) ('DataItem positive focusless control failed: '+$mode+'/'+$case.kind+'; '+$result.method)
    Assert-True ($result.details.selectedByPattern -and [SW]::SelectionCalls -eq 1) 'Positive DataItem control bypassed selection.'
    Assert-True (([SW]::Events -join '|') -ceq 'focusless-set|post-tab-down|post-tab-up') 'DataItem input was skipped, reordered or replayed.'
    Assert-True ([SW]::Value.Current.Value -ceq $case.requested -and $script:target.Current.Name -ceq $case.requested) 'Positive DataItem model did not retain the requested value.'
  }
}

foreach ($denial in @('selection-unavailable','selection-denied','table-unfocused')) {
  Initialize-DataItemFixture '12' '12,00'
  $script:DESKTOP_NAME='synthetic';$script:target.Current.HasKeyboardFocus=$false;$script:tableFocusWait=$true
  $snapshot=[pscustomobject]@{raw='12';name='12,00';value='12'}
  switch($denial){
    'selection-unavailable' {[SW]::SelectionAvailable=$false}
    'selection-denied' {[SW]::SelectionAccepted=$false}
    'table-unfocused' {[SW]::TableParent.Current.HasKeyboardFocus=$false}
  }
  $result=Commit-TrackedValueFocusless ([IntPtr]7) $script:node '24,00' $snapshot 'currency'
  Assert-True ($result.method -ceq 'focus-mismatch' -and [SW]::Events.Count -eq 0) ('Unproved DataItem table focus allowed SetValue: '+$denial)
}

foreach ($case in @(
  @{kind='currency';raw='0';name='0,00';business='0,00';requested='1,00'},
  @{kind='currency';raw='';name='';business='';requested='1,00'},
  @{kind='date';raw='';name='';business='';requested='16.07.2026'},
  @{kind='currency';raw='3';name='3,00 EUR';business='3';requested='4,00'}
)) {
  Initialize-DataItemFixture $case.raw $case.name
  $snapshot=[pscustomobject]@{raw=$case.raw;name=$case.name;value=$case.business}
  $result=Commit-TrackedValue ([IntPtr]7) $script:node $case.requested $snapshot $case.kind
  Assert-True ($result.method -ceq 'verified-keyboard-replace' -and ([SW]::Events -join '|') -ceq '^a|unicode|{TAB}') 'Physical DataItem empty/zero/suffix positive control failed or replayed.'
}

foreach ($commitName in @('Commit-TrackedValue','Commit-TrackedValueFocusless')) {
  foreach ($case in @(
    @{kind='currency';raw='0,00';name='0,00';business='0';formatted=''},
    @{kind='currency';raw='';name='';business='';formatted='0,00'}
  )) {
    Initialize-DataItemFixture $case.raw $case.name
    $snapshot=[pscustomobject]@{raw=$case.raw;name=$case.name;value=$case.business}
    [SW]::FocusMutationEnabled=$true;[SW]::FocusRaw=$case.formatted
    [SW]::FocusNameMutationEnabled=$true;[SW]::FocusName=$case.formatted
    if($commitName -ceq 'Commit-TrackedValueFocusless'){$script:DESKTOP_NAME='synthetic'}
    $result=& $commitName ([IntPtr]7) $script:node '1,00' $snapshot $case.kind
    Assert-True ($result.method -ceq 'epoch-value-changed-after-focus' -and [SW]::Events.Count -eq 0) 'Empty and zero became interchangeable at the commit boundary.'
  }
  Initialize-DataItemFixture '12' '12,00'
  $snapshot=[pscustomobject]@{raw='12';name='12,00';value='12'}
  [SW]::FocusReadOnly=$true
  if($commitName -ceq 'Commit-TrackedValueFocusless'){$script:DESKTOP_NAME='synthetic'}
  $result=& $commitName ([IntPtr]7) $script:node '24,00' $snapshot 'currency'
  Assert-True ($result.method -ceq 'epoch-value-changed-after-focus' -and [SW]::Events.Count -eq 0) 'Readonly drift after focus allowed a value write.'
}
Write-Output 'DataItem commits: fresh Name/raw/business guards and exact/table focus paths passed without native input.'

$unicode = -join [char[]]@(0x00e4,0x00d6,0x00df,0x20ac,0x0395,0x03bb,0x03bb,0x0423,0x043a,0x0440,0xd83d,0xde80)
foreach ($text in @('literal +^%~(){}[]', '15.01.2025', '12,34')) {
  Reset-TestState
  $result = Commit-TrackedValue ([IntPtr]7) $script:node $text 'before'
  Assert-True ($result.method -ceq 'verified-keyboard-replace') "Commit failed: $text"
  Assert-True ([SW]::LastText -ceq $text -and [SW]::Value.Current.Value -ceq $text) 'Literal text changed in transport.'
  Assert-True (([SW]::Events -join '|') -ceq '^a|unicode|{TAB}') 'Input was replayed or committed out of order.'
  Assert-True ($result.details.mutationStarted -and $result.details.settledEarly) 'Fresh readback or mutation state missing.'
  Assert-True ($script:completed -eq 1 -and $script:checkpoints.Count -ge 3) 'Physical section/checkpoint ownership changed.'
  Assert-True (($script:sleeps -join ',') -ceq '60,40,60,50') 'Existing guard/settle waits changed.'
}

foreach ($text in @($unicode, ('prefix ' + $unicode + ' suffix'))) {
  Reset-TestState; [SW]::QueuedModel=$true
  $result = Commit-TrackedValue ([IntPtr]7) $script:node $text 'before'
  Assert-True ($result.method -ceq 'verified-keyboard-replace' -and $result.details.settledEarly) 'Queued Unicode input did not settle.'
  Assert-True ([SW]::LastText -ceq $text -and [SW]::Value.Current.Value -ceq $text) 'A synchronous surrogate overtook its queued prefix.'
  Assert-True ([SW]::Events[0] -ceq '^a' -and [SW]::Events[[SW]::Events.Count-1] -ceq '{TAB}') 'Unicode input was committed out of order.'
}

Reset-TestState
$result = Commit-TrackedValue ([IntPtr]7) $script:node '' 'before'
Assert-True ($result.method -ceq 'verified-keyboard-replace' -and [SW]::Value.Current.Value -ceq '') 'Empty text was not deleted and committed.'
Assert-True (([SW]::Events -join '|') -ceq '^a|{BACKSPACE}|{TAB}') 'Empty text must not invoke Unicode transport.'

foreach ($outcome in @('incomplete','throw')) {
  Reset-TestState; [SW]::Outcome=$outcome
  $result = Commit-TrackedValue ([IntPtr]7) $script:node 'requested' 'before'
  $expected = $(if ($outcome -ceq 'throw') { 'failed' } else { 'native-input-incomplete' })
  Assert-True ($result.method -ceq $expected -and $result.details.mutationStarted) 'Partial native input was hidden.'
  Assert-True ([SW]::Value.Current.Value -ceq 'r') 'Partial failure fixture did not mutate.'
  Assert-True (([SW]::Events -join '|') -ceq '^a|unicode') 'Unknown native input must not be replayed or followed by TAB.'
  Assert-True ($script:completed -eq 1) 'Failed native transport left its physical section open.'
}

foreach ($guard in @(1,2,3,4)) {
  Reset-TestState; $script:failGuard=$guard
  $result = Commit-TrackedValue ([IntPtr]7) $script:node 'requested' 'before'
  Assert-True ($result.interference -and -not [SW]::Events.Contains('unicode')) 'A failed input guard allowed native text.'
  Assert-True ($script:completed -eq 1) 'Failed guard left its physical section open.'
}
foreach ($guard in @(5,6)) {
  Reset-TestState; $script:failGuard=$guard
  $result = Commit-TrackedValue ([IntPtr]7) $script:node 'requested' 'before'
  Assert-True ($result.interference -and $result.details.mutationStarted) 'Interference after input lost mutation uncertainty.'
  Assert-True (@([SW]::Events | Where-Object { $_ -ceq 'unicode' }).Count -eq 1) 'Interference replayed text.'
}

foreach ($precondition in @('readonly','changed-value','moved','stale','foreign-hit','wrong-focus','hidden')) {
  Reset-TestState
  switch ($precondition) {
    'readonly' { [SW]::Value.Current.IsReadOnly=$true }
    'changed-value' { [SW]::Value.Current.Value='other' }
    'moved' { $script:target.Current.BoundingRectangle.X=50 }
    'stale' { [SW]::Valid=$false }
    'foreign-hit' { [SW]::ForeignHit=$true }
    'wrong-focus' { $script:target.Current.HasKeyboardFocus=$false;[SW]::ClickFocusAccepted=$false }
    'hidden' { $script:DESKTOP_NAME='hidden' }
  }
  $result = Commit-TrackedValue ([IntPtr]7) $script:node 'requested' 'before'
  Assert-True ($result.method -cne 'verified-keyboard-replace' -and -not [SW]::Events.Contains('unicode')) "Unsafe native input: $precondition"
}
foreach ($failure in @('denied','unreadable','drift')) {
  Reset-TestState; $script:target.Current.HasKeyboardFocus=$false
  [SW]::CursorAccepted=($failure -cne 'denied')
  [SW]::CursorReadable=($failure -cne 'unreadable')
  [SW]::CursorDrift=($failure -ceq 'drift')
  $result = Commit-TrackedValue ([IntPtr]7) $script:node 'requested' 'before'
  Assert-True ($result.method -ceq 'interference-cursor-position' -and $result.interference) "Unverified cursor was accepted: $failure"
  Assert-True (-not $result.details.mutationStarted -and [SW]::Value.Current.Value -ceq 'before') 'Cursor failure hid or began a field mutation.'
  Assert-True (-not [SW]::Events.Contains('mouse') -and -not [SW]::Events.Contains('unicode')) 'Cursor failure dispatched physical input.'
  Assert-True ($script:completed -eq 1) 'Cursor failure left its physical section open.'
}
# Exercise the real receipt failure/rollback blocks, including a transport that
# wrote only a prefix. No rollback may replace an unknown or interfered value.
$failedCommit = @($ast.FindAll({ param($node)
  $node -is [Management.Automation.Language.IfStatementAst] -and
  $node.Clauses[0].Item1.Extent.Text.Contains('[string]$commit.method') -and
  $node.Extent.Text.Contains('Feldcommit meldete')
}, $true))
$rollback = @($ast.FindAll({ param($node)
  $node -is [Management.Automation.Language.IfStatementAst] -and
  $node.Extent.Text.StartsWith('if ($failedField)') -and
  $node.Extent.Text.Contains('cleanupRequired')
}, $true))
Assert-True ($failedCommit.Count -eq 1 -and $rollback.Count -eq 1) 'Receipt rollback production blocks are ambiguous.'
function Get-SSEReceiptManagerLiveEditableField { param($Hwnd, $Binding) $Binding }
function Get-SSEReceiptManagerFieldValue { param($Resolved) [SW]::Value.Current.Value }
function Test-SSEReceiptManagerFieldValue { param($Actual, $Expected, $Kind) [string]$Actual -ceq [string]$Expected }
function Wait-SSEReceiptManagerLiveFieldValue {
  param($Hwnd, $Resolved, $Expected, $Kind, $WaitMs)
  [pscustomobject]@{ ok=([SW]::Value.Current.Value -ceq [string]$Expected);resolved=$Resolved }
}
function Emit { param($Result) $script:emitted=$Result; throw 'receipt-test-emitted' }

foreach ($scenario in @(
  @{ value='r'; interference=$false; cleanup=$true; writes=0 },
  @{ value='external'; interference=$false; cleanup=$true; writes=0 },
  @{ value='before'; interference=$false; cleanup=$false; writes=0 },
  @{ value='requested'; interference=$false; cleanup=$false; writes=1 },
  @{ value='requested'; interference=$true; cleanup=$true; writes=0 }
)) {
  Reset-TestState; [SW]::Value.Current.Value=$scenario.value
  $transactions = @([pscustomobject]@{
    name='title'; kind='text'; before='before'; requested='requested'; changed=$false
    binding=[pscustomobject]@{ node=$script:node }
  })
  $failedField=$null; $failedReason=$null; $uncertainFieldMutation=$false; $failedInputGuard=$false
  $commit = [pscustomobject]@{
    method='native-input-incomplete'; interference=$scenario.interference
    details=[pscustomobject]@{ mutationStarted=$true }
  }
  foreach ($transaction in $transactions) {
    Invoke-Expression $failedCommit[0].Extent.Text
    throw 'Failed native commit did not stop the field transaction.'
  }
  Assert-True ($failedField -ceq 'title' -and $uncertainFieldMutation) 'Failed field was omitted from rollback accounting.'
  $toolHwnd=[IntPtr]7; $mainHwnd=[IntPtr]7; $targetPid=100; $waitMs=3500
  $valuesBefore=[ordered]@{ title='before' }; $requestedValues=[ordered]@{ title='requested' }
  $changedFields=@(); $script:emitted=$null
  try { Invoke-Expression $rollback[0].Extent.Text } catch {
    if ($_.Exception.Message -cne 'receipt-test-emitted') { throw }
  }
  Assert-True ($script:emitted -and -not $script:emitted.verified) 'Partial transport emitted success.'
  Assert-True ($script:emitted.cleanupRequired -eq $scenario.cleanup) 'Partial input cleanup status is inaccurate.'
  Assert-True ($script:emitted.rollback.fields.Count -eq 1) 'Failed field was not independently accounted for.'
  Assert-True (@([SW]::Events | Where-Object { $_ -ceq 'unicode' }).Count -eq $scenario.writes) 'Unsafe rollback wrote an unknown/interfered field.'
}
$receiptForward=@($ast.FindAll({param($node)
 $node -is [Management.Automation.Language.AssignmentStatementAst] -and
 $node.Left.Extent.Text -ceq '$commit' -and
 $node.Right.Extent.Text.StartsWith('Commit-TrackedValue $toolHwnd $resolved.node')
},$true))
Assert-True ($receiptForward.Count -eq 1) 'Actual receipt forward commit assignment is ambiguous.'
foreach($case in @(
 @{kind='currency';before='1.234,00';formatted='1234,00';requested='2345,00'},
 @{kind='date';before='15.07.2026';formatted='15.07';requested='16.07.2026'}
)){
 Reset-TestState;[SW]::Value.Current.Value=$case.before
 [SW]::FocusMutationEnabled=$true;[SW]::FocusRaw=$case.formatted
 $toolHwnd=[IntPtr]7;$resolved=[pscustomobject]@{node=$script:node}
 $transaction=[pscustomobject]@{before=$case.before;requested=$case.requested;kind=$case.kind};$currentValue=$case.before
 Invoke-Expression $receiptForward[0].Extent.Text
 Assert-True ($commit.method -ceq 'verified-keyboard-replace' -and [SW]::Value.Current.Value -ceq $case.requested) 'Receipt forward commit lost its explicit format contract.'
 Assert-True (([SW]::Events -join '|') -ceq '^a|unicode|{TAB}') 'Receipt forward format control replayed input.'
}
Reset-TestState;[SW]::Value.Current.Value='2000,00'
[SW]::FocusMutationEnabled=$true;[SW]::FocusRaw='2.000,00'
$transactions=@([pscustomobject]@{name='amount';kind='currency';before='1.234,00';requested='2000,00';changed=$false;binding=[pscustomobject]@{node=$script:node}})
$failedField=$null;$failedReason=$null;$uncertainFieldMutation=$false;$failedInputGuard=$false
$commit=[pscustomobject]@{method='native-input-incomplete';interference=$false;details=[pscustomobject]@{mutationStarted=$true}}
foreach($transaction in $transactions){Invoke-Expression $failedCommit[0].Extent.Text;throw 'Failure block did not stop the receipt transaction.'}
$toolHwnd=[IntPtr]7;$mainHwnd=[IntPtr]7;$targetPid=100;$waitMs=3500
$valuesBefore=[ordered]@{amount='1.234,00'};$requestedValues=[ordered]@{amount='2000,00'}
$changedFields=@();$script:emitted=$null
try{Invoke-Expression $rollback[0].Extent.Text}catch{if($_.Exception.Message -cne 'receipt-test-emitted'){throw}}
Assert-True ($script:emitted.rollback.fields.Count -eq 1 -and $script:emitted.rollback.fields[0].ok -and -not $script:emitted.cleanupRequired) 'Receipt rollback lost its explicit currency contract.'
Assert-True ([SW]::Value.Current.Value -ceq '1.234,00' -and ([SW]::Events -join '|') -ceq '^a|unicode|{TAB}') 'Receipt formatted rollback did not restore once.'

# The real receipt loop routes vatRate separately in BOTH directions. Its
# catalog kind must never enter the typed text/currency/date transport.
$receiptLoop=@($ast.FindAll({param($node)
 $node -is [Management.Automation.Language.ForEachStatementAst] -and
 $node.Variable.Extent.Text -ceq '$transaction' -and
 $node.Body.Extent.Text.Contains('$vatState = Get-SSEReceiptManagerState') -and
 $node.Body.Extent.Text.Contains('$commit = Commit-TrackedValue')
},$true))
Assert-True ($receiptLoop.Count -eq 1) 'Actual receipt forward loop is ambiguous.'
function Get-SSEReceiptManagerState {param($Hwnd,$Policy,[switch]$WithValues) [pscustomobject]@{}}
function Resolve-SSEReceiptManagerEditableFieldNode {param($State,$Policy,$Field) $script:vatBinding}
function Set-SSEReceiptManagerVatRateSelection {
 param($Hwnd,$ProcessId,$State,$Policy,$Resolved,$ExpectedCurrent,$Wanted,$WaitMs)
 Assert-True ([SW]::Value.Current.Value -ceq $ExpectedCurrent) 'Typed VAT branch lost its current-value binding.'
 $script:vatSelections.Add(([string]$ExpectedCurrent+' -> '+[string]$Wanted))
 [SW]::Value.Current.Value=$Wanted
 [pscustomobject]@{ok=$true;method='synthetic-typed-vat-selection';mutationStarted=$true}
}
Reset-TestState;[SW]::Value.Current.Value='19 %'
$script:vatBinding=[pscustomobject]@{node=$script:node}
$script:vatSelections=New-Object 'System.Collections.Generic.List[string]'
$transactions=@([pscustomobject]@{name='vatRate';kind='vat-rate';before='19 %';requested='7 %';changed=$false;binding=$script:vatBinding})
$toolHwnd=[IntPtr]7;$mainHwnd=[IntPtr]7;$targetPid=100;$waitMs=3500;$policy=[pscustomobject]@{}
$changedFields=New-Object Collections.ArrayList
$failedField=$null;$failedReason=$null;$uncertainFieldMutation=$false;$failedInputGuard=$false
Invoke-Expression $receiptLoop[0].Extent.Text
Assert-True (-not $failedField -and $transactions[0].changed -and [SW]::Value.Current.Value -ceq '7 %') 'Actual receipt VAT forward branch entered the generic commit.'
$failedField='vatRate';$failedReason='Synthetic rollback request';$uncertainFieldMutation=$false;$failedInputGuard=$false
$valuesBefore=[ordered]@{vatRate='19 %'};$requestedValues=[ordered]@{vatRate='7 %'};$script:emitted=$null
try{Invoke-Expression $rollback[0].Extent.Text}catch{if($_.Exception.Message -cne 'receipt-test-emitted'){throw}}
Assert-True ($script:emitted.rollback.ok -and [SW]::Value.Current.Value -ceq '19 %') 'Actual receipt VAT reverse branch entered the generic commit.'
Assert-True (($script:vatSelections -join '|') -ceq '19 % -> 7 %|7 % -> 19 %' -and [SW]::Events.Count -eq 0) 'VAT routing sent text input or replayed selection.'

$searchCapture=@($ast.FindAll({param($node)
 $node -is [Management.Automation.Language.AssignmentStatementAst] -and $node.Left.Extent.Text -ceq '$currentSearchText'
},$true))
$searchCommitCall=@($ast.FindAll({param($node)
 $node -is [Management.Automation.Language.AssignmentStatementAst] -and $node.Left.Extent.Text -ceq '$searchCommit'
},$true))
Assert-True ($searchCapture.Count -eq 1 -and $searchCommitCall.Count -eq 1) 'Actual receipt-search capture or commit is ambiguous.'
Reset-TestState;[SW]::SetRawNull()
$searchValueObject=[SW]::Value;$modeBefore=[pscustomobject]@{hwnd=[IntPtr]7};$searchNodes=@($script:node);$Text='Synthetic Search'
Invoke-Expression $searchCapture[0].Extent.Text
Invoke-Expression $searchCommitCall[0].Extent.Text
Assert-True ($null -eq $currentSearchText -and $searchCommit.method -ceq 'epoch-value-changed' -and [SW]::Events.Count -eq 0) 'Receipt search converted unknown raw into an editable empty value.'
Reset-TestState;[SW]::Value.Current.Value=''
$searchValueObject=[SW]::Value;$searchNodes=@($script:node)
Invoke-Expression $searchCapture[0].Extent.Text
Invoke-Expression $searchCommitCall[0].Extent.Text
Assert-True ($currentSearchText -ceq '' -and $searchCommit.method -ceq 'verified-keyboard-replace' -and ([SW]::Events -join '|') -ceq '^a|unicode|{TAB}') 'Receipt search refused a readable empty current value or replayed input.'

foreach($commitName in @('Commit-TrackedValue','Commit-TrackedValueFocusless')){
 Reset-TestState;$script:node|Add-Member NoteProperty type 'Edit';$script:target.Current.ProcessId=100
 $script:target.Current.Name='15.07.2025';[SW]::Value.Current.Value='15.07.2026'
 $snapshot=[pscustomobject]@{raw='15.07.2026';name='15.07.2025';value='15.07.2026'}
 if($commitName -ceq 'Commit-TrackedValueFocusless'){$script:DESKTOP_NAME='synthetic'}
 $result=& $commitName ([IntPtr]7) $script:node '16.07.2026' $snapshot 'date'
 $expectedMethod=$(if($commitName -ceq 'Commit-TrackedValue'){'verified-keyboard-replace'}else{'verified-focusless-value-pattern-tab'})
 $expectedEvents=$(if($commitName -ceq 'Commit-TrackedValue'){'^a|unicode|{TAB}'}else{'focusless-set|post-tab-down|post-tab-up'})
 Assert-True ($result.method -ceq $expectedMethod -and ([SW]::Events -join '|') -ceq $expectedEvents) 'A date-like Edit label became a business-year precondition.'
}
Reset-TestState;$script:node|Add-Member NoteProperty type 'Edit'
$strictSnapshot=[pscustomobject]@{raw='before';value='before'}
$strictProof=& {Set-StrictMode -Version Latest;Test-SSETrackedCommitPrecondition $script:target ([SW]::Value) $script:node $strictSnapshot 'text'}
Assert-True $strictProof 'An Edit snapshot without optional Name failed under strict mode.'
Write-Output 'Tracked native text: literal transport, readback, guards, partial failures and receipt rollback passed.'
