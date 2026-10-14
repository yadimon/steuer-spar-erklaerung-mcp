$ErrorActionPreference='Stop'
$workerPath=Join-Path $PSScriptRoot '..\powershell\sse-worker.ps1'
$errors=$null
$ast=[Management.Automation.Language.Parser]::ParseFile($workerPath,[ref]$null,[ref]$errors)
if ($errors.Count) {throw 'Worker syntax is invalid.'}
foreach ($name in @('Get-SSECaseFileMatch','Get-SSECheckerStartPolicy','Resolve-SSECheckerStartNode','Invoke-SSECheckerStart')) {
  $definition=@($ast.FindAll({param($node) $node -is [Management.Automation.Language.FunctionDefinitionAst] -and $node.Name -ceq $name},$true))
  if ($definition.Count -ne 1) {throw 'Productive checker helper is absent or ambiguous.'}
  . ([scriptblock]::Create($definition[0].Extent.Text))
}
Add-Type -AssemblyName UIAutomationClient,UIAutomationTypes
$catalog=Get-Content -LiteralPath (Join-Path $PSScriptRoot '..\profiles\2025\page-objects.json') -Raw -Encoding UTF8 | ConvertFrom-Json
$script:SSE_CASE_FILE_REGEX=[regex]'\.(?<type>ESt|Prog|Gew|GewErfass)(?<year>\d{4})$'
$script:casePath='C:\synthetic\business.GewErfass2026'
$script:caseYearAllowed=$true
function Get-CasePathFromTitle { $script:casePath }
function Get-CasePathFromCommandLine { $script:commandCasePath }
function Test-SSECaseYearAllowed {param($Type,$Year) $script:observedCase=@($Type,$Year);$script:caseYearAllowed}
function Get-CurrentHeading {
  param([IntPtr]$Hwnd,$Tree)
  if ($Hwnd -ne [IntPtr]111 -or $Tree -ne $script:tree) {throw 'Heading lost its exact window and fresh snapshot binding.'}
  $script:heading
}
function Assert-Equal($Actual,$Expected,[string]$Message) {
  if ($Actual -cne $Expected) {throw $Message}
}
$window=[pscustomobject]@{hwnd=111;pid=7;title='Synthetic business';titleFingerprint='original'}
$business=Get-SSECheckerStartPolicy $window $catalog
Assert-Equal $business.ok $true 'The business case has no profiled start.'
Assert-Equal $business.policy.id 'business_checker_toolbar' 'Business incorrectly uses an income-tax page.'
Assert-Equal $script:observedCase[0] 'GewErfass' 'Case type was not derived from the exact file identity.'
Assert-Equal $script:observedCase[1] 2026 'Case year was not checked.'
$script:casePath='C:\synthetic\income.ESt2025'
$income=Get-SSECheckerStartPolicy $window $catalog
Assert-Equal $income.policy.id 'income_tax_checker_page' 'Income tax lost its explicit page route.'
$script:casePath='C:\synthetic\business.GewErfass2026'
$script:caseYearAllowed=$false
Assert-Equal (Get-SSECheckerStartPolicy $window $catalog).kind 'case-unbound' 'Unsupported year was accepted.'
$script:caseYearAllowed=$true
Assert-Equal (Get-SSECheckerStartPolicy $window ([pscustomobject]@{checkerStartBindings=@($business.policy,$business.policy)})).ok $false 'Ambiguous case policy was accepted.'
Assert-Equal (Get-SSECheckerStartPolicy ([pscustomobject]@{title='Synthetic (Wiederhergestellt)'}) $catalog).kind 'recovered-case' 'Recovered state was accepted.'
$script:casePath=$null;$script:commandCasePath=$null
Assert-Equal (Get-SSECheckerStartPolicy $window $catalog).kind 'case-unbound' 'An unknown case type was inferred.'

function New-SyntheticStart($Policy) {
  $script:heading=[string]$Policy.heading
  $script:invocations=0;$script:toggles=0;$script:patternReads=0;$script:patternAvailable=$true;$script:actionThrows=$false
  $script:freshWindow=$window
  $script:pattern=[pscustomobject]@{Current=[pscustomobject]@{ToggleState=[System.Windows.Automation.ToggleState]::Off}}
  $script:pattern | Add-Member ScriptMethod Toggle {$script:toggles++;if ($script:actionThrows) {throw 'Synthetic unknown outcome'}}
  $script:pattern | Add-Member ScriptMethod Invoke {$script:invocations++;if ($script:actionThrows) {throw 'Synthetic unknown outcome'}}
  $script:node=[pscustomobject]@{type=$Policy.controlType;name=$Policy.name;aid='Synthetic'+$Policy.automationIdSuffix;rid='10.1';on=$true;w=120;h=40}
  $script:tree=[pscustomobject]@{nodes=@($script:node);stats=[pscustomobject]@{truncated=$false;depthLimited=$false;err=0;cyc=0;valErr=0}}
  $script:element=[pscustomobject]@{Current=[pscustomobject]@{ProcessId=7;Name=$Policy.name;AutomationId=$script:node.aid;IsEnabled=$true;IsOffscreen=$false;
    ControlType=[pscustomobject]@{ProgrammaticName='ControlType.'+$Policy.controlType}}}
  $script:element | Add-Member ScriptMethod TryGetCurrentPattern {
    param($Kind,$Output)
    $script:patternReads++
    $Output.Value=$script:pattern
    $script:observedPattern=$Kind
    $script:patternAvailable
  }
}
function Resolve-SSEMainWindowDescriptor { $script:freshWindow }
function Get-LiveElement { $script:element }
New-SyntheticStart $business.policy
$lookalike=[pscustomobject]@{type='CheckBox';name=$business.policy.name;aid='Synthetic.Library.Pruefer';rid='10.2';on=$true;w=120;h=40}
$script:tree.nodes+=@($lookalike)
Assert-Equal (Invoke-SSECheckerStart 111 $window $script:tree $business.policy).ok $true 'Exact business toolbar start failed.'
Assert-Equal $script:toggles 0 'Changing only the toolbar check state does not activate the global checker.'
Assert-Equal $script:invocations 1 'Business toolbar must invoke its command exactly once.'
Assert-Equal $script:observedPattern ([System.Windows.Automation.InvokePattern]::Pattern) 'Wrong business command pattern was requested.'
Assert-Equal $script:patternReads 2 'Business command must first prove Off, then bind Invoke.'
New-SyntheticStart $income.policy
Assert-Equal (Invoke-SSECheckerStart 111 $window $script:tree $income.policy).ok $true 'Exact income-tax page start failed.'
Assert-Equal $script:invocations 1 'Income-tax page must invoke exactly once.'
Assert-Equal $script:toggles 0 'Income-tax page toggled a toolbar.'

$negativeCases=@(
  { $script:tree.stats.truncated=$true },
  { $script:tree.stats.err=1 },
  { $script:tree.nodes+=@($script:node) },
  { $script:node.on=$false },
  { $script:node.w=0 },
  { $script:node.name='Lookalike' },
  { $script:node.aid='Synthetic.Library.Pruefer' },
  { $script:freshWindow=[pscustomobject]@{hwnd=111;pid=8;titleFingerprint='original'} },
  { $script:freshWindow=[pscustomobject]@{hwnd=111;pid=7;titleFingerprint='changed'} },
  { $script:element.Current.ProcessId=8 },
  { $script:element.Current.Name='Changed' },
  { $script:element.Current.AutomationId='Changed' },
  { $script:element.Current.IsOffscreen=$true },
  { $script:element.Current.ControlType.ProgrammaticName='ControlType.Button' },
  { $script:patternAvailable=$false },
  { $script:pattern.Current.ToggleState=[System.Windows.Automation.ToggleState]::On },
  { $script:pattern.Current.ToggleState=[System.Windows.Automation.ToggleState]::Indeterminate }
)
foreach ($prepare in $negativeCases) {
  New-SyntheticStart $business.policy
  & $prepare
  Assert-Equal (Invoke-SSECheckerStart 111 $window $script:tree $business.policy).ok $false 'Unsafe business start was accepted.'
  Assert-Equal $script:toggles 0 'A failed binding toggled the checker.'
  Assert-Equal $script:invocations 0 'A failed binding invoked the checker.'
}
New-SyntheticStart $income.policy
$script:heading='Different page'
Assert-Equal (Invoke-SSECheckerStart 111 $window $script:tree $income.policy).ok $false 'Income tax started from an unrelated page.'
Assert-Equal $script:invocations 0 'Wrong page dispatched a start.'
New-SyntheticStart $business.policy
$script:actionThrows=$true
$unknown=Invoke-SSECheckerStart 111 $window $script:tree $business.policy
Assert-Equal $unknown.ok $false 'Unknown dispatch was reported as success.'
Assert-Equal $unknown.outcomeUnknown $true 'Unknown dispatch lost its outcome evidence.'
Assert-Equal $unknown.retryable $false 'Unknown dispatch permitted a replay.'
Assert-Equal $script:toggles 0 'Unknown dispatch used Toggle instead of the command.'
Assert-Equal $script:invocations 1 'Unknown dispatch was retried.'
Write-Output 'Checker start: exact case/profile, page/toolbar, stale/ambiguous/off-state and unknown-no-replay contracts passed.'

# The earlier engine uses its explicit global toolbar for both supported
# manufacturer case types. It must not borrow the newer income-tax page route.
$catalog2024=Get-Content -LiteralPath (Join-Path $PSScriptRoot '..\profiles\2024\page-objects.json') -Raw -Encoding UTF8 | ConvertFrom-Json
foreach($casePath in @('C:\synthetic\income.ESt2024','C:\synthetic\business.Gew2024')){
  $script:casePath=$casePath
  $policy2024=Get-SSECheckerStartPolicy $window $catalog2024
  Assert-Equal $policy2024.ok $true 'The earlier engine lacks its own explicit checker route.'
  Assert-Equal $policy2024.policy.id 'global_checker_toolbar' 'The earlier engine borrowed a newer page route.'
  New-SyntheticStart $policy2024.policy
  $script:actionThrows=$false
  Assert-Equal (Invoke-SSECheckerStart 111 $window $script:tree $policy2024.policy).ok $true 'Bound earlier-engine toolbar did not start.'
  Assert-Equal $script:invocations 1 'Earlier-engine checker did not invoke exactly once.'
  Assert-Equal $script:toggles 0 'Earlier-engine checker used Toggle instead of its explicit command.'
}
$script:casePath='C:\synthetic\unknown.Prog2024'
Assert-Equal (Get-SSECheckerStartPolicy $window $catalog2024).ok $false 'An unprofiled earlier-engine case acquired a checker route.'
