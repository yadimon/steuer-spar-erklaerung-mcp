$Repository=Join-Path $PSScriptRoot '..'
$ErrorActionPreference='Stop'
$source=[IO.File]::ReadAllText((Join-Path $Repository 'powershell/sse-worker.ps1'))
$tokens=$null;$errors=$null
$ast=[Management.Automation.Language.Parser]::ParseInput($source,[ref]$tokens,[ref]$errors)
if($errors.Count){throw 'Invalid production worker syntax'}
$caption=@($ast.FindAll({param($n)$n -is [Management.Automation.Language.FunctionDefinitionAst] -and $n.Name -ceq 'Get-SSEPageFieldLabel'},$true))
if($caption.Count -ne 1){throw 'Missing production caption helper'}
. ([scriptblock]::Create($caption[0].Extent.Text))
foreach($name in @('Test-SSEUstvaTreeComplete','New-SSEUstvaReadBudget','Get-SSEUstvaReadRemaining','Get-SSEUstvaDialogState','Read-SSEUstvaPage')){
  $definitions=@($ast.FindAll({param($n)$n -is [Management.Automation.Language.FunctionDefinitionAst] -and $n.Name -ceq $name},$true))
  if($definitions.Count -ne 1){throw 'Missing production UStVA helper'}
  . ([scriptblock]::Create($definitions[0].Extent.Text))
}
function Assert-Equal($Actual,$Expected,[string]$Message){if($Actual -cne $Expected){throw $Message}}
function New-Stats([int]$Count){[pscustomobject]@{n=$Count;err=0;cyc=0;valErr=0;scrollErr=0;truncated=$false;depthLimited=$false}}
$shortBudget=New-SSEUstvaReadBudget ([pscustomobject]@{__ustvaReadDeadlineUnixMs=11000L}) 1000L
Assert-Equal $shortBudget.limitMs 10000 'Caller deadline was replaced with a full default budget'
$longBudget=New-SSEUstvaReadBudget ([pscustomobject]@{__ustvaReadDeadlineUnixMs=101000L}) 1000L
Assert-Equal $longBudget.limitMs 45000 'Read cap increased'
foreach($deadline in @($null,0,1000L,'11000')){
  $rejected=$false
  try{$null=New-SSEUstvaReadBudget ([pscustomobject]@{__ustvaReadDeadlineUnixMs=$deadline}) 1000L}catch{$rejected=$true}
  Assert-Equal $rejected $true 'Missing/expired/untyped deadline was accepted'
}
. (Join-Path $Repository 'powershell/window-scope.ps1')
$rawNodes=@(
  [pscustomobject]@{i=0;p=-1;type='Text';name='Own'},
  [pscustomobject]@{i=1;p=-1;type='Window';name='Own auxiliary';rid='auxiliary'},
  [pscustomobject]@{i=2;p=1;type='Text';name='Foreign subtree'}
)
$split=Split-SSEWindowScope $rawNodes
$scoped=[pscustomobject]@{nodes=$split.own;fremdeFenster=$split.foreign;stats=(New-Stats $rawNodes.Count)}
Assert-Equal (Test-SSEUstvaTreeComplete $scoped) $true 'Actual split scope counters were rejected'
Assert-Equal @($scoped.nodes).Count 1 'Foreign nodes were not actually excluded'
function New-Fixture {
  $script:formMissing=$false;$script:libraryMissing=$false;$script:headingChanged=$false;$script:changeHeadingAfterLibrary=$false
  $script:ancestryValid=$true;$script:dialogs=@();$script:windows=@(1);$script:formReads=0;$script:libraryReads=0
  $script:clock=[pscustomobject]@{timer=[pscustomobject]@{ElapsedMilliseconds=0};limitMs=45000}
  $script:elapsedAfterForm=0;$script:elapsedAfterLibrary=0
  $script:libraryChanged=$false;$script:changeLibraryAfterRead=$false
  $script:heading=[pscustomobject]@{type='Text';rid='heading';aid='SyntheticRoot.ClientFrameSSE.ClientHeader.Heading';name='Umsatzsteuer-Voranmeldungen 2025'}
  $script:UIAElementCache=@{heading=[pscustomobject]@{key='heading'}}
  $script:form=[pscustomobject]@{
    nodes=@(
      $script:heading,
      [pscustomobject]@{type='Text';name='Umsatzsteuerzahllast';aid='SyntheticRoot.Settlement.Caption';p=2;x=100;y=100;w=200;h=20},
      [pscustomobject]@{type='Edit';name='';aid='SyntheticRoot.Settlement.Wert';p=2;x=400;y=100;w=100;h=20;rid='value';val='12,34';ro=$true}
    );stats=(New-Stats 3)
    contentBinding=[pscustomobject]@{hwnd=111;pid=7;windowAid='SyntheticRoot';windowRid='root'}
    contentBounds=[pscustomobject]@{minX=100;maxX=700}
  }
  $script:library=[pscustomobject]@{
    root=[pscustomobject]@{x=720;y=0;w=100;h=400;rid='library';aid='SyntheticRoot.centralWidget.SearchSplitter.TopLevelHSplitter.LibraryFrameSSE';type='Group';on=$true};windowKey='root|7|111'
    tree=[pscustomobject]@{nodes=@(
      [pscustomobject]@{type='TreeItem';name='Synthetic warning';x=750},
      [pscustomobject]@{type='TreeItem';name='Eingabehilfe';x=750}
    );stats=(New-Stats 2)}
  }
  $script:libraryElement=[pscustomobject]@{key='library'}
  $script:elster=[pscustomobject]@{type='Button';name='ELSTER versenden';aid='SyntheticRoot.MainToolBar.tb_elster';rid='elster'}
}
function New-SSEUstvaReadBudget {$script:clock}
function Get-SSEMainContentTree {param($Window,[switch]$WithValues,[int]$TimeoutSec)
  Assert-Equal $Window 111 'Unbound form window';Assert-Equal $WithValues.IsPresent $true 'Form values were not requested'
  Assert-Equal ($TimeoutSec -gt 0 -and $TimeoutSec -le 45) $true 'Form did not inherit the shared remaining budget'
  $script:clock.timer.ElapsedMilliseconds=$script:elapsedAfterForm
  $script:formReads++;if($script:formMissing){return $null};$script:form
}
function Read-SSESearchRegion {param($Window,$RelativeAid,$Binding,[int]$TimeoutSec)
  Assert-Equal $Window 111 'Unbound status window'
  Assert-Equal $RelativeAid '.centralWidget.SearchSplitter.TopLevelHSplitter.LibraryFrameSSE' 'Wrong status region'
  Assert-Equal $Binding.rid 'root' 'Wrong status binding';$script:libraryReads++
  Assert-Equal ($TimeoutSec -gt 0 -and $TimeoutSec -le 5) $true 'Status did not inherit the bounded remaining time'
  if($script:libraryMissing){throw 'Synthetic provider secret must be redacted'}
  $script:headingChanged=$script:changeHeadingAfterLibrary;$script:clock.timer.ElapsedMilliseconds=$script:elapsedAfterLibrary;$script:library
}
function Get-SSEContainerChild {param($Nodes,$Suffix,$Type) $script:heading}
function Get-SSEMainWindowSelectors {[pscustomobject]@{heading='.ClientHeader'}}
function Test-SSEElementIdentity {param($Element,$Rid,$Aid,$Name) -not (($Rid -ceq 'heading' -and $script:headingChanged) -or ($Rid -ceq 'library' -and $script:libraryChanged))}
function Test-SSEElementVisible {param($Element) -not ($Element.key -ceq 'library' -and $script:libraryChanged)}
function Test-SSEMainContentAncestry {$script:ancestryValid}
function Find-ExactAutomationElement {param($Window,$Aid,[switch]$VisibleOnly)
  Assert-Equal $Window 111 'Unbound exact window'
  if($Aid -ceq '.centralWidget.SearchSplitter.TopLevelHSplitter.LibraryFrameSSE'){return $script:libraryElement}
  Assert-Equal $Aid '.MainToolBar.tb_elster' 'Unexpected toolbar read'
  $script:libraryChanged=$script:changeLibraryAfterRead;$script:elster
}
function Convert-ExactElementToNode {param($Element) if($Element.key -ceq 'library'){return $script:library.root};$Element}
function Test-Versand {param($Name) $Name -like '*ELSTER*'}
function Get-DialogInventory {param([int]$TargetPid,[switch]$RejectHung)
  Assert-Equal $TargetPid 7 'Dialog inventory was not process-bound'
  Assert-Equal $RejectHung.IsPresent $true 'Hung dialog inventory was not rejected'
  $script:dialogs
}
function Resolve-SSEMainWindowDescriptor {param($Arguments) Assert-Equal $Arguments.hwnd 111 'Wrong window descriptor';[pscustomobject]@{pid=7;hwnd=111}}
function Get-Windows {param($Name) Assert-Equal $Name 'SSE' 'Unbound window inventory';$script:windows}
function Walk-Tree {throw 'UStVA must not traverse global navigation'}
function Walk-BoundTree {throw 'UStVA must not traverse global navigation'}

New-Fixture
$read=Read-SSEUstvaPage 111
Assert-Equal $read.ok $true 'Complete regions failed'
Assert-Equal $read.felder[0].label 'Umsatzsteuerzahllast' 'Caption was lost'
Assert-Equal $read.felder[0].wert '12,34' 'Amount was lost'
Assert-Equal $read.blockiert $true 'Real warning was dropped'
Assert-Equal $read.prueferMeldungen.Count 1 'Checker noise was not filtered'
Assert-Equal $read.aktionen[0].gesperrt $true 'Toolbar transmission boundary was lost'
Assert-Equal $read.stats.n 5 'Measured region counters were not summed'
Assert-Equal $script:formReads 1 'Form was retried'
Assert-Equal $script:libraryReads 1 'Status was retried'

foreach($region in @('form','library')){
  foreach($key in @('err','cyc','valErr','scrollErr','n','truncated','depthLimited')){
    New-Fixture
    $stats=$(if($region -ceq 'form'){$script:form.stats}else{$script:library.tree.stats})
    if($key -in @('truncated','depthLimited')){$stats.$key=$true}else{$stats.$key=99}
    $read=Read-SSEUstvaPage 111
    Assert-Equal $read.ok $false 'Incomplete region emitted values'
    Assert-Equal $read.felder $null 'Incomplete region leaked amounts'
  }
}
foreach($alter in @(
  {$script:formMissing=$true},
  {$script:libraryMissing=$true},
  {$script:library.windowKey='foreign|8|112'},
  {$script:changeHeadingAfterLibrary=$true},
  {$script:ancestryValid=$false},
  {$script:library.root.x=600},
  {$script:form.stats.valErr='0'},
  {$script:library.tree.stats.depthLimited='false'},
  {$script:changeLibraryAfterRead=$true},
  {$script:elapsedAfterForm=45000},
  {$script:elapsedAfterLibrary=45000},
  {$script:dialogs=@([pscustomobject]@{pid=7;kind='other';uiaReadOk=$false})}
)){
  New-Fixture;& $alter
  $read=Read-SSEUstvaPage 111
  Assert-Equal $read.ok $false 'Unbound or changed region emitted success'
  Assert-Equal $read.felder $null 'Unbound region leaked amounts'
  Assert-Equal ($read.error -like '*Synthetic provider secret*') $false 'Provider details leaked'
}
New-Fixture;$script:dialogs=@([pscustomobject]@{pid=7;kind='qt-dialog';hwnd=222;title='Synthetic dialog';fingerprint='synthetic';buttons=@();unsupportedButtons=@();uiaError='Synthetic detail'})
$modalRead=Read-SSEUstvaPage 111
Assert-Equal $modalRead.kind 'dialog-open' 'Own modal was ignored'
Assert-Equal $modalRead.dialogs[0].hwnd 222 'Established dialogs key changed'
Assert-Equal @($modalRead.dialogs[0].PSObject.Properties).Count 5 'Raw dialog descriptor leaked'
Assert-Equal $modalRead.dialoge $null 'Internal dialog key escaped into the public result'
New-Fixture;$script:dialogs=@([pscustomobject]@{pid=7;kind='qt-dialog'});$script:form.stats.valErr=1
Assert-Equal (Read-SSEUstvaPage 111).kind 'dialog-open' 'Own modal lost priority over incomplete fields'
New-Fixture;$script:dialogs=@([pscustomobject]@{pid=8;kind='qt-dialog'});$script:library.tree.nodes[0].name='Eingabehilfe'
Assert-Equal (Read-SSEUstvaPage 111).blockiert $false 'Foreign modal or checker noise blocked the form'
New-Fixture;$script:windows=@(1,2,3);$script:library.tree.nodes[0].name='Eingabehilfe'
Assert-Equal (Read-SSEUstvaPage 111).blockiert $true 'Existing extra-window blocking semantics changed'
New-Fixture;$script:library.tree.nodes[0].name=('Long warning '+('x'*100));$script:library.tree.nodes[0].x=700
$longRead=Read-SSEUstvaPage 111
Assert-Equal $longRead.blockiert $true 'Long or edge-aligned warning was discarded'
Assert-Equal $longRead.prueferMeldungen[0] $script:library.tree.nodes[0].name 'Warning was truncated'
New-Fixture;$script:clock.limitMs=3000
Assert-Equal (Read-SSEUstvaPage 111).ok $true 'Short caller budget unnecessarily required five spare seconds'
New-Fixture;$script:elapsedAfterForm=45000
$expired=Read-SSEUstvaPage 111
Assert-Equal ($expired.error -like '*Lesebudget*') $true 'Budget exhaustion had a wrong remedy'
Assert-Equal ($expired.error -like '*einblenden*') $false 'Budget failure recommended an unrelated UI action'
Write-Output 'Bound UStVA regions: warnings, values, real counters and incomplete/changed scopes passed.'
