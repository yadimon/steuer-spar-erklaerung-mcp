# Direkter Optionsklick in `combo_select`.
#
# Engine 31 quittiert SelectionItem.Select auf einer Option der aufgeklappten
# Liste, uebernimmt die Auswahl aber nicht. Auf dem sichtbaren Desktop wird die
# exakt gefundene Option deshalb direkt angeklickt. Dieser Vertrag haelt fest:
#
#   1. Punkt und Identitaet kommen aus der unmittelbar vor dem Klick frisch
#      gelesenen Option.
#   2. Hat sich die Option seit dem Baumlauf veraendert oder ist sie nicht mehr
#      lesbar, wird nichts geklickt: Liste zuklappen und 'stale' melden.
#   3. Ein eigenes Qt-Popup braucht eine frische Prozess-, Klassen-, Listen-
#      und Geometriebindung. Ein fremdes Fenster ist kein erlaubtes Ziel.
#   4. Andere Engines und der versteckte Desktop behalten SelectionItem.Select.
$ErrorActionPreference = 'Stop'
Add-Type -AssemblyName UIAutomationClient, UIAutomationTypes

$root = Split-Path $PSScriptRoot -Parent
$workerPath = Join-Path $root 'powershell\sse-worker.ps1'
$errors = $null
$ast = [Management.Automation.Language.Parser]::ParseFile($workerPath, [ref]$null, [ref]$errors)
if ($errors.Count) { throw "Worker-Parserfehler: $($errors[0].Message)" }

function Assert-True([bool]$Condition, [string]$Message) {
  if (-not $Condition) { throw $Message }
}

$comboClauses = @($ast.FindAll({
  param($node)
  $node -is [Management.Automation.Language.SwitchStatementAst] -and
  @($node.Clauses | Where-Object { $_.Item1.Extent.Text -ceq "'combo_select'" }).Count -eq 1
}, $true))
Assert-True ($comboClauses.Count -eq 1) 'Der combo_select-Zweig ist nicht eindeutig vorhanden.'
$comboBody = @($comboClauses[0].Clauses | Where-Object { $_.Item1.Extent.Text -ceq "'combo_select'" })[0].Item2
$optionChoices = @($comboBody.FindAll({
  param($node)
  $node -is [Management.Automation.Language.IfStatementAst] -and $node.Clauses.Count -eq 2 -and
  $node.Clauses[0].Item1.Extent.Text -ceq '$matches.Count -eq 0' -and
  $node.Clauses[1].Item1.Extent.Text -ceq '$matches.Count -eq 1'
}, $true))
Assert-True ($optionChoices.Count -eq 1) 'Die Auswahl einer eindeutig gefundenen Option ist nicht eindeutig vorhanden.'
$block = [scriptblock]::Create((@($optionChoices[0].Clauses[1].Item2.Statements | ForEach-Object { $_.Extent.Text }) -join "`n"))

$optionAid = 'SSE_Application.AAV4GLEngineWindow31.centralWidget.Zeitraum.QComboBoxPrivateContainer.QComboBoxListView'
Invoke-Expression (@($ast.FindAll({param($n) $n -is [Management.Automation.Language.FunctionDefinitionAst] -and
 $n.Name -ceq 'Test-SSEComboPopupRoot'},$true))[0].Extent.Text)
function OptionNode {
  [pscustomobject]@{ type='ListItem'; name='2. Vierteljahr'; aid=$optionAid; x=600; y=340; w=180; h=24; on=$true; rid='42.7' }
}
# Frisch gelesener Zustand der Option unmittelbar vor dem Klick; ohne
# Abweichung identisch mit dem Baumlauf.
function FreshOption([hashtable]$Changes = @{}) {
  $node = OptionNode
  foreach ($key in @($Changes.Keys)) { $node.$key = $Changes[$key] }
  $node
}

function Invoke-OptionChoice {
  param([int]$Engine, [string]$DesktopName = '', $Fresh = (FreshOption),
    $Obstruction = ([pscustomobject]@{isBoundTarget=$true}), [switch]$MissingList)
  $script:clicks = New-Object System.Collections.ArrayList
  $script:liveReads = New-Object System.Collections.ArrayList
  $script:conversions = 0
  $script:selects = 0
  $script:collapses = 0
  $script:failed = $null
  $script:emitted = $null
  $script:SSE_ENGINE_MAJOR = $Engine
  $script:DESKTOP_NAME = $DesktopName
  $hwnd = [IntPtr]4242
  $wanted = '2. Vierteljahr'
  $matches = @(OptionNode)
  $method = 'select'
  $expectedPage = 'Umsatzsteuer-Voranmeldungen'
  $before = '1. Vierteljahr'
  $expectedCurrent=$before
  $expectedAfter = $wanted
  $combo = [pscustomobject]@{ rid='42.1'; aid='SSE_Application.AAV4GLEngineWindow31.centralWidget.Zeitraum' }
  $prefix=$combo.aid
  $targetPid=42
  $list=[pscustomobject]@{type='List';aid=$optionAid;rid='42.9';on=$true;x=590;y=330;w=210;h=100}
  $expanded=[pscustomobject]@{nodes=@($list)}
  if($MissingList){$expanded.nodes=@()}
  $ec = [pscustomobject]@{}
  $ec | Add-Member -MemberType ScriptMethod -Name Collapse -Value { $script:collapses++ }
  $selection = [pscustomobject]@{}
  $selection | Add-Member -MemberType ScriptMethod -Name Select -Value { $script:selects++ }
  $liveOption = [pscustomobject]@{ selection=$selection }
  $liveOption | Add-Member -MemberType ScriptMethod -Name TryGetCurrentPattern -Value {
    param($Pattern, $Out)
    $Out.Value = $this.selection
    $true
  }
  function Test-Versand { param([string]$name) $false }
  function Get-LiveElement {
    param([IntPtr]$hwnd, [string]$Rid, [string]$Aid = '')
    $null = $script:liveReads.Add([pscustomobject]@{ window=[int64]$hwnd; rid=$Rid })
    $liveOption
  }
  function Convert-ExactElementToNode { param($Element) $script:conversions++; $Fresh }
  function Get-SSEPointObstruction {param($Window,$X,$Y) $Obstruction}
  function Click-VerifiedPoint {
    param([IntPtr]$Window, $Node, $ExpectedInputTick = $null, [switch]$RequireForeground, [int]$SettleMs = 250,
          [int]$ClickCount = 1, [int]$ForegroundAttempts = 3, [string]$ExpectedRuntimeId = '',
          $BeforeClickCheck=$null, $BeforeClickBinding=$null)
    $null = $script:clicks.Add([pscustomobject]@{
      window=[int64]$Window; x=$Node.x; y=$Node.y; w=$Node.w; h=$Node.h; count=$ClickCount; rid=$ExpectedRuntimeId
      binding=$BeforeClickBinding
    })
  }
  function Get-SSELastInputTick { 7 }
  function Test-SSELastInputUnchanged { param($Baseline) $true }
  function Emit { param($result) $script:emitted = $result; throw 'combo-option-emitted' }
  function Fail { param($msg, $kind = 'error', $details = $null) $script:failed = [pscustomobject]@{ kind=$kind; error=$msg }; throw 'combo-option-failed' }
  try { . $block } catch {
    Assert-True ($_.Exception.Message -in @('combo-option-emitted', 'combo-option-failed')) `
      "Die Optionsauswahl warf unerwartet: $($_.Exception.Message)"
  }
  [pscustomobject]@{
    clicks=@($script:clicks); liveReads=@($script:liveReads); conversions=$script:conversions; selects=$script:selects
    collapses=$script:collapses; failed=$script:failed; emitted=$script:emitted; method=$method
  }
}

# 1. Engine 31 auf dem sichtbaren Desktop: genau ein Klick auf die frisch
#    gelesene Option, ohne FromPoint-Bindung und ohne Select.
$direct = Invoke-OptionChoice 31
Assert-True ($direct.liveReads.Count -eq 1 -and $direct.liveReads[0].rid -ceq '42.7' -and $direct.liveReads[0].window -eq 4242 -and
             $direct.conversions -eq 1) `
  "Die Option wurde vor dem Klick nicht frisch gelesen: $($direct.liveReads | ConvertTo-Json -Compress)"
Assert-True ($direct.clicks.Count -eq 1 -and $direct.clicks[0].count -eq 1 -and $direct.clicks[0].window -eq 4242 -and
             $direct.clicks[0].x -eq 600 -and $direct.clicks[0].y -eq 340 -and $direct.clicks[0].w -eq 180 -and $direct.clicks[0].h -eq 24) `
  "Der Direktklick traf nicht genau einmal die gebundene Option: $($direct.clicks | ConvertTo-Json -Compress)"
Assert-True ($direct.clicks[0].rid -ceq '') `
  "Der Direktklick verlangt eine FromPoint-Bindung, die am offenen Popup nie gelingt: '$($direct.clicks[0].rid)'"
Assert-True ($direct.selects -eq 0 -and $direct.method -ceq 'verified-point' -and $null -eq $direct.failed -and
             $null -eq $direct.emitted -and $direct.collapses -eq 0) `
  'Der Direktklick lief nicht als einziger Auswahlweg ohne Fehler.'

$popup=[pscustomobject]@{isBoundTarget=$false;boundPid=42;hitPid=42;hitRoot=5252
 className='Qt692QWindowPopupDropShadowSaveBits';rootRect=[pscustomobject]@{x=590;y=330;w=210;h=100}}
$popupClick=Invoke-OptionChoice 31 -Obstruction $popup
Assert-True ($null -eq $popupClick.failed -and $popupClick.clicks.Count -eq 1 -and
 $popupClick.clicks[0].window -eq 5252 -and $popupClick.clicks[0].binding.mainHwnd -eq 4242 -and
 $popupClick.clicks[0].binding.listRid -ceq '42.9' -and $popupClick.clicks[0].binding.expectedCurrent -ceq '1. Vierteljahr') 'Direct option must target its exact own Qt popup with the original combo, list and prior value.'
foreach($problem in @('pid','bound-pid','class','geometry','missing-list')){
 $badPopup=$popup | ConvertTo-Json -Depth 5 | ConvertFrom-Json
 switch($problem){
  'pid'{$badPopup.hitPid=43}
  'bound-pid'{$badPopup.boundPid=43}
  'class'{$badPopup.className='UnrelatedWindow'}
  'geometry'{$badPopup.rootRect.x=900}
 }
 $refused=Invoke-OptionChoice 31 -Obstruction $badPopup -MissingList:($problem -ceq 'missing-list')
 Assert-True ($refused.clicks.Count -eq 0 -and $refused.selects -eq 0 -and $refused.failed.kind -ceq 'obstructed') ('Unsafe direct popup click: '+$problem)
}

# 2. Die Option ist seit dem Baumlauf verrutscht: geklickt wird ihr frisches
#    Rechteck.
$moved = Invoke-OptionChoice 31 -Fresh (FreshOption @{ y=388 })
Assert-True ($moved.clicks.Count -eq 1 -and $moved.clicks[0].y -eq 388 -and $moved.clicks[0].x -eq 600 -and
             $null -eq $moved.failed) `
  "Der Direktklick nahm nicht das frische Rechteck: $($moved.clicks | ConvertTo-Json -Compress)"

# 3. Die Option hat sich veraendert oder ist nicht mehr lesbar: kein Klick,
#    kein Select, Liste zu, 'stale'.
$changedOptions = [ordered]@{
  'umbenannt'         = (FreshOption @{ name='3. Vierteljahr' })
  'anderer Typ'       = (FreshOption @{ type='Text' })
  'andere RuntimeId'  = (FreshOption @{ rid='42.9' })
  'andere AutomationId' = (FreshOption @{ aid='Synthetic.Replaced' })
  'nicht mehr lesbar' = $null
}
foreach ($case in $changedOptions.GetEnumerator()) {
  $changed = Invoke-OptionChoice 31 -Fresh $case.Value
  Assert-True ($changed.clicks.Count -eq 0 -and $changed.selects -eq 0) `
    "Fall '$($case.Key)': eine veraenderte Option wurde trotzdem ausgewaehlt."
  Assert-True ($changed.failed.kind -ceq 'stale' -and $null -eq $changed.emitted -and $changed.collapses -eq 1) `
    "Fall '$($case.Key)': eine veraenderte Option endete nicht als 'stale' mit zugeklappter Liste: $($changed.failed | ConvertTo-Json -Compress)"
}

# 4. Andere Engines und der versteckte Desktop behalten Select und lesen die
#    Option nicht fuer einen Klick neu.
foreach ($case in @(
  [pscustomobject]@{ name='Engine 30'; engine=30; desktop='' }
  [pscustomobject]@{ name='versteckter Desktop'; engine=31; desktop='sse-hidden' }
)) {
  $selected = Invoke-OptionChoice $case.engine $case.desktop
  Assert-True ($selected.selects -eq 1 -and $selected.clicks.Count -eq 0 -and $selected.conversions -eq 0 -and
               $selected.method -ceq 'select' -and $null -eq $selected.failed) `
    "Fall '$($case.name)': Select wurde nicht als einziger Auswahlweg verwendet."
}

Write-Output 'combo_select: Direktklick nur auf die frisch gelesene, unveraenderte Option - bestanden'

# Execute the real initial expansion, including foreground acquisition. A Qt
# popup opened from the background can change the Windows input epoch before
# any option is chosen. Activation must precede Expand, without a new baseline.
$statements=@($comboBody.Statements)
$first=@(0..($statements.Count-1) | Where-Object {$statements[$_].Extent.Text.StartsWith('$interactionBefore = Get-SSEInteractionWindowSet')})
$last=@(0..($statements.Count-1) | Where-Object {$statements[$_].Extent.Text.StartsWith('$expanded = Walk-Tree')})
Assert-True ($first.Count -eq 1 -and $last.Count -eq 1) 'Initial combo expansion is not uniquely bounded.'
$openBlock=[scriptblock]::Create((@($statements[$first[0]..($last[0]-1)] | ForEach-Object {$_.Extent.Text}) -join "`n"))
Add-Type -TypeDefinition @'
using System;
public static class ComboForegroundContract {
 public static IntPtr Foreground;
 public static IntPtr GetForegroundWindow(){return Foreground;}
}
'@
$foregroundHelper=@($ast.FindAll({param($n)
 $n -is [Management.Automation.Language.FunctionDefinitionAst] -and $n.Name -in @('Enter-SSEMenuForeground','Enter-SSEPopupForeground')
},$true))
Assert-True ($foregroundHelper.Count -eq 1) 'Popup foreground helper must remain unique.'
Invoke-Expression ($foregroundHelper[0].Extent.Text.Replace('[SW]::','[ComboForegroundContract]::'))
function Invoke-InitialComboExpansion([string]$Scenario) {
 $script:comboScenario=$Scenario;$script:comboTick=7;$script:comboExpands=0;$script:comboCollapses=0
 $script:comboShows=0;$script:comboStoredTick=$null;$script:comboFailure=$null;$script:comboReads=0
 [ComboForegroundContract]::Foreground=[IntPtr]99
 $hwnd=[IntPtr]4242;$targetPid=42;$guardUserInput=$true;$inputBaseline=7
 $combo=[pscustomobject]@{rid='42.1';aid='Synthetic.Period'};$expectedCurrent='Januar';$expectedPage='Synthetic page'
 $script:comboValue=[pscustomobject]@{Current=[pscustomobject]@{Value='Januar'}}
 $script:comboExpand=[pscustomobject]@{Current=[pscustomobject]@{ExpandCollapseState=[System.Windows.Automation.ExpandCollapseState]::Collapsed}}
 $script:comboExpand | Add-Member ScriptMethod Expand {
  $script:comboExpands++
  if([ComboForegroundContract]::Foreground -ne [IntPtr]4242 -or $script:comboScenario -eq 'input-during-expand'){$script:comboTick++}
  $this.Current.ExpandCollapseState=[System.Windows.Automation.ExpandCollapseState]::Expanded
 }
 $script:comboExpand | Add-Member ScriptMethod Collapse {$script:comboCollapses++}
 function Get-SSELastInputTick {$script:comboTick}
 function Test-SSELastInputUnchanged {param($Expected) $Expected -eq $script:comboTick}
 function Set-SSEForegroundLeaseInputCheckpoint {param($InputTick,$CursorPoint,[string]$Context) $script:comboStoredTick=$InputTick}
 function Show-SSEWindow {
  param([IntPtr]$Window)
  $script:comboShows++
  if($script:comboScenario -eq 'activation-refused'){return $false}
  [ComboForegroundContract]::Foreground=$Window
  if($script:comboScenario -eq 'input-during-activation'){$script:comboTick++}
  $true
 }
 function Get-SSEInteractionWindowSet {param($ProcessId,$Window) [pscustomobject]@{fingerprint='same'}}
 function Get-CurrentHeading {param($Window) 'Synthetic page'}
 function Wait-SSEComboExpansionState {param($Pattern,$Expanded,$TimeoutMs) $true}
 function Get-LiveElement {
  param($Window,$RuntimeId,$AutomationId)
  $script:comboReads++
  $aid='Synthetic.Period'
  if($script:comboScenario -eq 'binding-after-activation' -and $script:comboShows -gt 0){$aid='Synthetic.Replaced'}
  $live=[pscustomobject]@{Current=[pscustomobject]@{AutomationId=$aid}}
  $live | Add-Member ScriptMethod TryGetCurrentPattern {
   param($Pattern,$Out)
   if($Pattern -eq [System.Windows.Automation.ValuePattern]::Pattern){$Out.Value=$script:comboValue}
   else{$Out.Value=$script:comboExpand}
   $true
  }
  $live
 }
 function Fail {param($Message,$Kind='error',$Details=$null) $script:comboFailure=$Kind;throw 'combo-expansion-stopped'}
 try{. $openBlock}catch{Assert-True ($_.Exception.Message -ceq 'combo-expansion-stopped') "Unexpected expansion error: $($_.Exception.Message)"}
 [pscustomobject]@{failure=$script:comboFailure;expands=$script:comboExpands;collapses=$script:comboCollapses
  shows=$script:comboShows;checkpoint=$script:comboStoredTick;reads=$script:comboReads}
}
$opened=Invoke-InitialComboExpansion 'background'
Assert-True ($null -eq $opened.failure -and $opened.shows -eq 1 -and $opened.expands -eq 1 -and
 $opened.collapses -eq 0 -and $opened.checkpoint -eq 7 -and $opened.reads -eq 2) 'Combo must activate and rebind before its one Expand, retaining the original input epoch.'
foreach($case in @(
 @{scenario='activation-refused';kind='foreground-failed';expands=0;collapses=0},
 @{scenario='input-during-activation';kind='interference';expands=0;collapses=0},
 @{scenario='binding-after-activation';kind='precondition-failed';expands=0;collapses=0},
 @{scenario='input-during-expand';kind='interference';expands=1;collapses=1}
)){
 $stopped=Invoke-InitialComboExpansion $case.scenario
 Assert-True ($stopped.failure -ceq $case.kind -and $stopped.expands -eq $case.expands -and
  $stopped.collapses -eq $case.collapses -and $stopped.shows -eq 1 -and $stopped.checkpoint -eq 7) ('Unsafe combo expansion: '+$case.scenario)
}
Write-Output 'combo_select: foreground before Expand, fresh binding, original epoch and no retry passed.'
