$ErrorActionPreference='Stop'
Add-Type -AssemblyName UIAutomationClient,UIAutomationTypes,WindowsBase
Add-Type @'
using System;
public static class PageScrollTestAutomation {
 public static object Root;
 public static object AutomationIdProperty=new object();
 public static int Reads, ChangeAt;
 public static Action BeforeRead;
 public static object FromHandle(IntPtr h){if(h.ToInt64()!=111)throw new InvalidOperationException();Reads++;if(Reads==ChangeAt&&BeforeRead!=null)BeforeRead();return Root;}
}
'@
$script:AE=[PageScrollTestAutomation]
$workerPath=Join-Path $PSScriptRoot '..\powershell\sse-worker.ps1'
$tokens=$null;$errors=$null
$ast=[Management.Automation.Language.Parser]::ParseFile($workerPath,[ref]$tokens,[ref]$errors)
if($errors.Count){throw 'Production worker syntax is invalid'}
foreach($name in @('Arg','Test-SSEElementIdentity','Get-SSEPageRangeBinding','Read-SSEPageRangeState','Invoke-SSEPageRangeScroll','Assert-SSEFullReadRange','Assert-SSEFullReadStageCoverage')){
 $definitions=@($ast.FindAll({param($node)$node -is [Management.Automation.Language.FunctionDefinitionAst] -and $node.Name -ceq $name},$true))
 if($definitions.Count -ne 1){throw 'Production page-scroll helper is missing or ambiguous'}
 . ([scriptblock]::Create($definitions[0].Extent.Text))
}
function Test-SSEMainContentAncestry { $script:ancestryValid }
function Get-LiveElement {throw 'A page scroll must not search outside its exact snapshot cache'}
function Start-Sleep {param($Milliseconds) if($Milliseconds -ne 450){throw 'Unexpected wait'};$script:waits++}
function Assert-Equal($Actual,$Expected,$Message){if($Actual -cne $Expected){throw $Message}}
function New-Rect($X,$Y,$Width,$Height){[pscustomobject]@{X=[double]$X;Y=[double]$Y;Width=[double]$Width;Height=[double]$Height;IsEmpty=$false}}
function New-Element($Id,$Aid,$Type,$Bounds,$Parent){
 $e=[pscustomobject]@{Id=$Id;Parent=$Parent;Current=[pscustomobject]@{AutomationId=$Aid;ProcessId=7;ControlType=$Type;BoundingRectangle=$Bounds;IsEnabled=$true;IsOffscreen=$false;NativeWindowHandle=0}}
 $e|Add-Member ScriptMethod GetRuntimeId {,$this.Id}
 $e|Add-Member ScriptMethod GetCurrentPropertyValue {param($Property) $this.Current.AutomationId}
 $e|Add-Member ScriptMethod TryGetCurrentPattern {param($Kind,$Output) $Output.Value=$script:pattern;$script:patternSupported}
 $e
}
function New-Fixture([double]$Scale=1,[double]$Value=0){
 $script:sets=0;$script:waits=0;$script:ancestryValid=$true;$script:patternSupported=$true;$script:afterSet='normal';$script:scale=$Scale;$script:valueFailure='none'
 $script:targets=New-Object 'Collections.Generic.List[double]'
 [PageScrollTestAutomation]::Reads=0;[PageScrollTestAutomation]::ChangeAt=0;[PageScrollTestAutomation]::BeforeRead=$null
 $root=New-Element 'root' 'SyntheticRoot' ([Windows.Automation.ControlType]::Window) (New-Rect 0 0 800 800) ''
 $root.Current.NativeWindowHandle=111;[PageScrollTestAutomation]::Root=$root
 $areaAid='SyntheticRoot.centralWidget.SearchSplitter.TopLevelHSplitter.RedThreadContent.ClientFrameSSE.DialogWidget.DialogScrollArea'
 $script:elements=@{
  area=(New-Element 'area' $areaAid ([Windows.Automation.ControlType]::Group) (New-Rect 100 100 300 400) 'root');
  viewport=(New-Element 'viewport' ($areaAid+'.qt_scrollarea_viewport') ([Windows.Automation.ControlType]::Group) (New-Rect 100 100 288 400) 'area');
  body=(New-Element 'body' ($areaAid+'.qt_scrollarea_viewport.DialogUI') ([Windows.Automation.ControlType]::Group) (New-Rect 100 (100-$Value*$Scale) 288 (400+925*$Scale)) 'viewport');
  container=(New-Element 'container' ($areaAid+'.qt_scrollarea_vcontainer') ([Windows.Automation.ControlType]::Group) (New-Rect 388 100 12 400) 'area');
  bar=(New-Element 'bar' ($areaAid+'.qt_scrollarea_vcontainer.QScrollBar') ([Windows.Automation.ControlType]::ScrollBar) (New-Rect 388 100 12 400) 'container');
 }
 $script:pattern=[pscustomobject]@{Current=[pscustomobject]@{Minimum=0.0;Maximum=925.0;Value=$Value;IsReadOnly=$false;SmallChange=20.0;LargeChange=20.0}}
 $script:pattern|Add-Member ScriptMethod SetValue {
  param([double]$Value)
  $script:sets++
  $script:targets.Add($Value)
  $oldValue=$this.Current.Value
  $this.Current.Value=$Value
  if($script:afterSet -cne 'no-movement'){$script:elements.body.Current.BoundingRectangle.Y=100-$Value*$script:scale}
  switch($script:afterSet){
   'throw' {throw 'Synthetic provider outcome unknown'}
   'wrong-value' {$this.Current.Value=$Value-1}
   'changed-range' {$this.Current.Maximum++}
   'changed-root' {[PageScrollTestAutomation]::Root.Current.ProcessId=8}
   'changed-viewport' {$script:elements.viewport.Current.BoundingRectangle.Height++}
   'reverse-movement' {$script:elements.body.Current.BoundingRectangle.Y=100-$oldValue*$script:scale+($Value-$oldValue)*$script:scale}
   'restore-fail' {if($Value -eq 0 -and $script:sets -gt 1){throw 'Synthetic final restore outcome unknown'}}
  }
 }
 $script:UIAElementCache=@{}
 foreach($element in $script:elements.Values){$script:UIAElementCache[$element.Id]=$element}
 $script:WLK=[pscustomobject]@{}
 $script:WLK|Add-Member ScriptMethod GetParent {param($Element) if($Element.Parent -ceq 'root'){return [PageScrollTestAutomation]::Root};$script:elements[$Element.Parent]}
 $order=@('area','viewport','body','container','bar');$nodes=@()
 for($i=0;$i -lt $order.Count;$i++){
  $key=$order[$i];$e=$script:elements[$key]
  $nodes+=@([pscustomobject]@{i=$i;p=$order.IndexOf($e.Parent);rid=$e.Id;aid=$e.Current.AutomationId;type=$e.Current.ControlType.ProgrammaticName.Replace('ControlType.','')})
 }
 $script:tree=[pscustomobject]@{nodes=$nodes;stats=[pscustomobject]@{truncated=$false;depthLimited=$false;err=0;cyc=0;valErr=0}}
}
function Run-Scroll($Arguments){try{$binding=Get-SSEPageRangeBinding 111 $script:tree}catch{return [pscustomobject]@{ok=$false;kind='bind-failed'}};if(-not $binding){throw 'Expected exact Qt binding'};Invoke-SSEPageRangeScroll $binding $Arguments}

New-Fixture
$info=Run-Scroll ([pscustomobject]@{})
Assert-Equal $info.ok $true 'Default info failed'
Assert-Equal $info.position 0 'Default info lost its actual position'
Assert-Equal $script:sets 0 'Default info moved the page'
New-Fixture
$script:pattern.Current.IsReadOnly=$true
Assert-Equal (Run-Scroll ([pscustomobject]@{mode='info'})).ok $true 'Read-only info unnecessarily required write permission'
Assert-Equal $script:sets 0 'Read-only info attempted a change'
Assert-Equal (Run-Scroll ([pscustomobject]@{mode='percent';vPercent=0})).ok $true 'An already-proved no-op required write permission'
Assert-Equal $script:sets 0 'Read-only no-op attempted a change'
foreach($percent in @(0,37,100)){
 New-Fixture
 $result=Run-Scroll ([pscustomobject]@{mode='percent';vPercent=$percent})
 Assert-Equal $result.ok $true 'Percent scroll failed'
 $expected=[Math]::Round(925*$percent/100.0,[MidpointRounding]::AwayFromZero)
 Assert-Equal $script:pattern.Current.Value $expected 'Percent did not use an integral exact target'
 Assert-Equal $script:sets $(if($percent -eq 0){0}else{1}) 'Percent scroll repeated an action or dispatched a no-op'
}
New-Fixture 1.5
$amount=Run-Scroll ([pscustomobject]@{mode='amount';direction='down'})
Assert-Equal $amount.ok $true 'Scaled amount scroll failed'
Assert-Equal $script:pattern.Current.Value 267 'Amount used provider LargeChange or an assumed Windows DPI instead of the bound viewport scale'
Assert-Equal $script:sets 1 'Amount repeated its action'
New-Fixture 1 900
Assert-Equal (Run-Scroll ([pscustomobject]@{mode='amount';direction='down'})).ok $true 'Boundary amount failed'
Assert-Equal $script:pattern.Current.Value 925 'Amount did not clamp at the actual maximum'
New-Fixture 1 20
Assert-Equal (Run-Scroll ([pscustomobject]@{mode='amount';direction='up'})).ok $true 'Upward amount failed'
Assert-Equal $script:pattern.Current.Value 0 'Upward amount did not clamp at zero'

foreach($prepare in @(
 {$script:tree.stats.truncated=$true},
 {$script:tree.stats.depthLimited=$true},
  {$script:tree.stats.depthLimited=$null},
 {$script:tree.stats.err=1},
 {$script:tree.stats.cyc=1},
 {$script:tree.nodes+=@($script:tree.nodes[0])},
 {$script:tree.nodes+=@($script:tree.nodes[4])},
 {$script:tree.nodes=$script:tree.nodes|Where-Object rid -ne 'viewport'},
 {$script:tree.nodes[4].p=0},
  {$script:tree.nodes[2].p=$null},
  {$script:tree.nodes[1].i=$null},
  {$script:tree.nodes[1].i=0},
 {$script:tree.nodes[4].type='Button'},
 {[PageScrollTestAutomation]::Root.Current.NativeWindowHandle=222},
 {$script:ancestryValid=$false}
  {$script:UIAElementCache.Remove('bar')}
)){
 New-Fixture;& $prepare;$rejected=$false
 try{$null=Get-SSEPageRangeBinding 111 $script:tree}catch{$rejected=$true}
 Assert-Equal $rejected $true 'Invalid binding was accepted'
 Assert-Equal $script:sets 0 'Invalid binding moved the page'
}
foreach($prepare in @(
 {$script:pattern.Current.Value=[double]::NaN},
  {$script:pattern.Current.Value='0'},
  {$script:pattern.Current.Value=$false},
 {$script:pattern.Current.Maximum=[double]::PositiveInfinity},
 {$script:pattern.Current.Maximum=925.5},
 {$script:pattern.Current.Minimum=1},
 {$script:pattern.Current.Value=926},
 {$script:pattern.Current.Maximum=0},
 {$script:pattern.Current.IsReadOnly=$true},
 {$script:elements.bar.Current.IsEnabled=$false},
 {$script:elements.bar.Current.IsOffscreen=$true},
  {$script:elements.bar.Current.IsOffscreen=$null},
  {$script:elements.bar.Current.IsEnabled=$null},
  {$script:pattern.Current.IsReadOnly=$null},
  {$script:elements.body.Current.BoundingRectangle.IsEmpty=$null},
 {$script:elements.bar.Current.ProcessId=8},
 {$script:elements.body.Current.AutomationId='Changed'},
 {$script:elements.body.Parent='area'},
 {$script:elements.body.Current.BoundingRectangle.Y=110},
 {$script:patternSupported=$false}
)){
 New-Fixture;& $prepare
 Assert-Equal (Run-Scroll ([pscustomobject]@{mode='percent';vPercent=100})).ok $false 'Unsafe range state was accepted'
 Assert-Equal $script:sets 0 'Unsafe range state moved the page'
}
foreach($arguments in @(
 [pscustomobject]@{mode='unknown'},
 [pscustomobject]@{mode='percent';vPercent=[double]::NaN},
 [pscustomobject]@{mode='percent';vPercent=-1},
 [pscustomobject]@{mode='percent';vPercent=101},
 [pscustomobject]@{mode='amount';direction='elsewhere'}
)){
 New-Fixture
 Assert-Equal (Run-Scroll $arguments).kind 'bad-args' 'Invalid arguments were not rejected'
 Assert-Equal $script:sets 0 'Invalid arguments moved the page'
}
foreach($failure in @('throw','wrong-value','changed-range','changed-root','changed-viewport','no-movement')){
 New-Fixture;$script:afterSet=$failure
 $result=Run-Scroll ([pscustomobject]@{mode='percent';vPercent=100})
 Assert-Equal $result.ok $false 'An unverified move was reported as success'
 Assert-Equal $result.outcomeUnknown $true 'An unverified move lost conservative outcome evidence'
 Assert-Equal $result.retryable $false 'An unverified move allowed replay'
 Assert-Equal $script:sets 1 'An unverified move was retried'
}
foreach($failure in @('no-movement','reverse-movement')){
 New-Fixture 1 924;$script:afterSet=$failure
 $result=Run-Scroll ([pscustomobject]@{mode='percent';vPercent=100})
 Assert-Equal $result.ok $false 'A small or reversed unproved movement was accepted within the pixel tolerance'
 Assert-Equal $result.outcomeUnknown $true 'A small unproved movement lost conservative outcome evidence'
 Assert-Equal $script:sets 1 'A small unproved movement was retried'
}
New-Fixture
[PageScrollTestAutomation]::ChangeAt=3
[PageScrollTestAutomation]::BeforeRead=[Action]{$script:pattern.Current.Value=1.0;$script:elements.body.Current.BoundingRectangle.Y=99.0}
$race=Run-Scroll ([pscustomobject]@{mode='percent';vPercent=100})
Assert-Equal $race.ok $false 'A matching value/content change between state reads was accepted as a new baseline'
Assert-Equal $race.mutationStarted $false 'A preflight race invented an attempted action'
Assert-Equal $script:sets 0 'A preflight race dispatched a scroll'
New-Fixture
$script:pattern.Current.IsReadOnly=$true
[PageScrollTestAutomation]::ChangeAt=3
[PageScrollTestAutomation]::BeforeRead=[Action]{$script:pattern.Current.IsReadOnly=$false}
Assert-Equal (Run-Scroll ([pscustomobject]@{mode='percent';vPercent=100})).ok $false 'Write permission appearing mid-call replaced the original precondition'
Assert-Equal $script:sets 0 'Changed write permission dispatched a scroll'
New-Fixture
[PageScrollTestAutomation]::ChangeAt=4
[PageScrollTestAutomation]::BeforeRead=[Action]{$script:elements.body.Current.BoundingRectangle.Y=101.0}
Assert-Equal (Run-Scroll ([pscustomobject]@{mode='percent';vPercent=0})).ok $false 'A no-op concealed an independently moving body'
Assert-Equal $script:sets 0 'An unstable no-op dispatched a scroll'
New-Fixture
$script:tree.nodes=$script:tree.nodes|Where-Object rid -notin @('bar','container')
Assert-Equal (Run-Scroll ([pscustomobject]@{mode='info'})).ok $false 'Missing scrollbar hid actual overflow'
Assert-Equal $script:sets 0 'Missing scrollbar dispatched an action'
New-Fixture
$script:tree.nodes=$script:tree.nodes|Where-Object rid -notin @('bar','container')
$script:elements.body.Current.BoundingRectangle.Height=300.0
$fits=Run-Scroll ([pscustomobject]@{mode='info'})
Assert-Equal $fits.ok $true 'Positively proved fitting content failed'
Assert-Equal $fits.scrollbar $false 'Fitting content invented a scrollbar'
Assert-Equal $script:sets 0 'Fitting content moved'
New-Fixture
$script:tree.nodes=@()
Assert-Equal ($null -eq (Get-SSEPageRangeBinding 111 $script:tree)) $true 'Absent Qt area was invented'
$originalCulture=[Threading.Thread]::CurrentThread.CurrentCulture
try{
 [Threading.Thread]::CurrentThread.CurrentCulture=[Globalization.CultureInfo]::GetCultureInfo('de-DE')
 New-Fixture
 Assert-Equal (Run-Scroll ([pscustomobject]@{mode='percent';vPercent=37.5})).ok $true 'Numeric percent became culture-dependent'
 Assert-Equal $script:pattern.Current.Value 347 'Fractional percent was not quantized deterministically'
}finally{[Threading.Thread]::CurrentThread.CurrentCulture=$originalCulture}

# Execute the actual dispatcher bodies as well as the extracted helpers.
# All window, provider and traversal boundaries below are explicit canaries.
$cases=@{}
foreach($name in @('scroll_page','read_full')){
 $clauses=@($ast.FindAll({param($node)$node -is [Management.Automation.Language.SwitchStatementAst]},$true)|ForEach-Object{$_.Clauses}|Where-Object{$_.Item1.Value -ceq $name})
 if($clauses.Count -ne 1){throw 'Production scroll dispatcher is missing or ambiguous'}
 $body=$clauses[0].Item2.Extent.Text
 $cases[$name]=[scriptblock]::Create($body.Substring(1,$body.Length-2))
}
function Resolve-Window { [IntPtr]111 }
function Get-ContentBounds { [pscustomobject]@{minX=0;maxX=1000} }
function Get-SSEHeading { [pscustomobject]@{text=$(if($script:valueFailure -ceq 'late-heading' -and $script:pattern.Current.Value -eq 185){'Different page'}else{'Synthetic scroll page'})} }
function Emit($Result){$script:emitted=$Result;throw 'PAGE_SCROLL_TEST_EMIT'}
function Fail($Message,$Kind){$script:emitted=[pscustomobject]@{ok=$false;kind=$Kind};throw 'PAGE_SCROLL_TEST_EMIT'}
function Walk-Tree {
 param($Hwnd,$MaxNodes,$TimeoutSec,$MaxDepth,[switch]$WithValues,[switch]$WithScroll)
 $script:walks++
 $nodes=@($script:tree.nodes)
 if($WithValues){
   switch($script:valueFailure){
    'null-depth' {$script:tree.stats.depthLimited=$null}
    'late-value' {if($script:pattern.Current.Value -eq 185){$script:tree.stats.valErr=1}}
    'late-traversal' {if($script:pattern.Current.Value -eq 185){$script:tree.stats.err=1}}
    'coherent-growth' {if($script:pattern.Current.Value -eq 185){$script:pattern.Current.Maximum=1850.0;$script:elements.body.Current.BoundingRectangle.Height=2250.0}}
    'fitting-growth' {$script:pattern.Current.Maximum=925.0;$script:elements.body.Current.BoundingRectangle.Height=1325.0}
   }
  $marker=if($script:pattern.Current.Value -eq 0){'Top marker'}elseif($script:pattern.Current.Value -eq 925){'Bottom marker'}else{'Middle marker'}
  $nodes+=@([pscustomobject]@{type='Text';name=$marker;x=150;y=150;w=120;h=20})
 }
 [pscustomobject]@{nodes=$nodes;stats=$script:tree.stats}
}
function Run-Operation($Name,$Arguments){
 $script:a=$Arguments;$script:emitted=$null;$script:walks=0
 try{& $cases[$Name]}catch{if($_.Exception.Message -cne 'PAGE_SCROLL_TEST_EMIT'){throw}}
 if(-not $script:emitted){throw 'Production operation never emitted its result'}
 $script:emitted
}
New-Fixture
Assert-Equal (Run-Operation 'scroll_page' ([pscustomobject]@{})).position 0 'Actual omitted-mode dispatcher moved instead of informing'
Assert-Equal $script:sets 0 'Actual omitted-mode dispatcher called SetValue'
New-Fixture
$script:tree.nodes=$script:tree.nodes|Where-Object rid -ne 'viewport'
Assert-Equal (Run-Operation 'scroll_page' ([pscustomobject]@{mode='percent';vPercent=100})).ok $false 'Actual dispatcher fell through a partial exact Qt binding'
Assert-Equal $script:sets 0 'Partial dispatcher binding wrote a scrollbar'
New-Fixture
$script:tree.nodes=@()
Assert-Equal (Run-Operation 'scroll_page' ([pscustomobject]@{mode='percent';vPercent=100})).kind 'no-scroll-pattern' 'Missing scroll support was reported as a successful movement'
Assert-Equal $script:sets 0 'Missing support dispatched a movement'
New-Fixture 1 925
$full=Run-Operation 'read_full' ([pscustomobject]@{})
Assert-Equal $full.ok $true 'Actual full reader failed'
Assert-Equal $full.gerollt $true 'Actual full reader concealed scrolling'
Assert-Equal $full.stufen 5 'Actual full reader did not visit every bounded stage'
Assert-Equal ($script:targets -join ',') '0,185,370,555,740,925,0' 'Full reader did not start at the top, visit every stage and restore the top'
Assert-Equal ($full.zeilen -contains 'Top marker') $true 'Full reader missed the top of an initially scrolled page'
Assert-Equal ($full.zeilen -contains 'Bottom marker') $true 'Full reader missed the bottom'
foreach($failure in @('throw','no-movement')){
 New-Fixture;$script:afterSet=$failure
 $result=Run-Operation 'read_full' ([pscustomobject]@{})
 Assert-Equal $result.ok $false 'Full reader concealed an unverified stage as complete'
 Assert-Equal $script:sets 1 'Full reader retried or restored after an unverified stage'
}
New-Fixture
$script:tree.stats.valErr=1
Assert-Equal (Run-Operation 'read_full' ([pscustomobject]@{})).kind 'incomplete' 'Full reader concealed an unreadable value'
Assert-Equal $script:sets 0 'Incomplete value read continued scrolling'
New-Fixture
$script:pattern.Current.Maximum=3600.0;$script:elements.body.Current.BoundingRectangle.Height=4000.0
Assert-Equal (Run-Operation 'read_full' ([pscustomobject]@{})).kind 'incomplete' 'Fixed full-read stages silently skipped a long-page interval'
Assert-Equal $script:sets 0 'An uncovered long-page interval dispatched a scroll'
New-Fixture
$script:valueFailure='null-depth'
Assert-Equal (Run-Operation 'read_full' ([pscustomobject]@{})).kind 'incomplete' 'Unknown value-stage completeness was accepted'
Assert-Equal $script:sets 0 'Unknown value-stage completeness continued scrolling'
New-Fixture
$script:pattern.Current.Maximum=0.0;$script:elements.body.Current.BoundingRectangle.Height=300.0
Assert-Equal (Run-Operation 'read_full' ([pscustomobject]@{})).ok $true 'Stable fitting content was rejected'
Assert-Equal $script:sets 0 'Fitting content triggered a movement'
New-Fixture
$script:pattern.Current.Maximum=0.0;$script:elements.body.Current.BoundingRectangle.Height=300.0;$script:valueFailure='fitting-growth'
Assert-Equal (Run-Operation 'read_full' ([pscustomobject]@{})).kind 'incomplete' 'Initially fitting content grew into unobserved overflow without failing'
Assert-Equal $script:sets 0 'A fitting-to-overflow transition triggered a movement'
foreach($failure in @('late-value','late-traversal','coherent-growth','late-heading')){
 New-Fixture;$script:valueFailure=$failure
 Assert-Equal (Run-Operation 'read_full' ([pscustomobject]@{})).kind 'incomplete' 'Full-read stage failure or coherent layout growth was concealed'
 Assert-Equal $script:sets 1 'A failed value stage or changed range dispatched the next movement or restore'
}
New-Fixture;$script:afterSet='restore-fail'
$restoreFailure=Run-Operation 'read_full' ([pscustomobject]@{})
Assert-Equal $restoreFailure.ok $false 'An unconfirmed final restore was reported as complete'
Assert-Equal $restoreFailure.outcomeUnknown $true 'An unconfirmed final restore lost conservative outcome evidence'
Assert-Equal $script:sets 6 'The final restore was retried'
Write-Output 'Production page scroll: bounded binding, typed state, exact movement, no replay, default-info dispatcher and complete top-to-bottom read/restore passed.'
